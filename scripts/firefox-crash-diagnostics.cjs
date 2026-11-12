// Opt-in, synthetic Firefox diagnostics. Raw process memory never enters artifacts.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const LIMIT = 32 * 1024 * 1024;
const MAX_FILES = 8;
function parseDump(bytes) {
    function range(offset, length) {
        if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            length < 0 ||
            offset + length > bytes.length
        )
            throw new Error("invalid-minidump");
    }
    range(0, 32);
    if (bytes.length > LIMIT || bytes.readUInt32LE(0) !== 0x504d444d)
        throw new Error("invalid-minidump");
    const count = bytes.readUInt32LE(8),
        directory = bytes.readUInt32LE(12);
    if (count > 128) throw new Error("invalid-minidump");
    range(directory, count * 12);
    let exception, modules, system;
    for (let i = 0; i < count; i++) {
        const entry = directory + i * 12,
            type = bytes.readUInt32LE(entry);
        const size = bytes.readUInt32LE(entry + 4),
            offset = bytes.readUInt32LE(entry + 8);
        range(offset, size);
        if (type === 6) {
            if (exception || size < 168) throw new Error("invalid-minidump");
            exception = {
                address: bytes.readBigUInt64LE(offset + 24),
                code: bytes.readUInt32LE(offset + 8),
                contextBytes: bytes.readUInt32LE(offset + 160),
                contextOffset: bytes.readUInt32LE(offset + 164),
            };
        }
        if (type === 7) {
            if (system || size < 56) throw new Error("invalid-minidump");
            system = {
                architecture: bytes.readUInt16LE(offset),
                platform: bytes.readUInt32LE(offset + 20),
            };
        }
        if (type === 4) {
            if (modules || size < 4) throw new Error("invalid-minidump");
            const total = bytes.readUInt32LE(offset);
            if (total > 2048 || 4 + total * 108 > size)
                throw new Error("invalid-minidump");
            modules = { count: total, offset: offset + 4 };
        }
    }
    if (!exception) return { status: "no-exception-stream" };
    const result = {
        exceptionCode: "0x" + exception.code.toString(16),
        status: "exception",
    };
    // Do not extract memory strings, module filenames, absolute addresses or URLs.
    for (let i = 0; modules && i < modules.count; i++) {
        const entry = modules.offset + i * 108,
            base = bytes.readBigUInt64LE(entry);
        const size = bytes.readUInt32LE(entry + 8);
        if (
            exception.address < base ||
            exception.address - base >= BigInt(size)
        )
            continue;
        result.moduleOffset = "0x" + (exception.address - base).toString(16);
        result.moduleImageBytes = size;
        const length = bytes.readUInt32LE(entry + 76),
            offset = bytes.readUInt32LE(entry + 80);
        if (length) {
            range(offset, length);
            if (
                length >= 4 &&
                length <= 68 &&
                bytes.readUInt32LE(offset) === 0x4270454c
            ) {
                result.buildId = bytes
                    .subarray(offset + 4, offset + length)
                    .toString("hex");
            } else if (
                length >= 24 &&
                bytes.readUInt32LE(offset) === 0x53445352
            ) {
                result.codeViewGuid = bytes
                    .subarray(offset + 4, offset + 20)
                    .toString("hex");
                result.codeViewAge = bytes.readUInt32LE(offset + 20);
            }
        }
        break;
    }
    // Linux AMD64 context layout is fixed by Breakpad. Only CONTROL marks RIP valid.
    // This is a single module-relative instruction signature, never a stack unwind.
    range(exception.contextOffset, exception.contextBytes);
    if (
        system?.architecture === 9 &&
        system.platform === 0x8201 &&
        exception.contextBytes
    ) {
        if (exception.contextBytes < 256) throw new Error("invalid-minidump");
        const flags = bytes.readUInt32LE(exception.contextOffset + 48);
        if ((flags & 0xffffff00) === 0x00100000 && flags & 1) {
            const instruction = bytes.readBigUInt64LE(
                exception.contextOffset + 248
            );
            for (let i = 0; modules && i < modules.count; i++) {
                const entry = modules.offset + i * 108;
                const base = bytes.readBigUInt64LE(entry),
                    size = bytes.readUInt32LE(entry + 8);
                if (instruction < base || instruction - base >= BigInt(size))
                    continue;
                result.instructionModuleOffset =
                    "0x" + (instruction - base).toString(16);
                const length = bytes.readUInt32LE(entry + 76),
                    offset = bytes.readUInt32LE(entry + 80);
                if (length) {
                    range(offset, length);
                    if (
                        length > 4 &&
                        length <= 68 &&
                        bytes.readUInt32LE(offset) === 0x4270454c
                    )
                        result.instructionBuildId = bytes
                            .subarray(offset + 4, offset + length)
                            .toString("hex");
                }
                break;
            }
        }
    }
    return result;
}
function owned(root, token) {
    if (
        !root ||
        !token ||
        !path.isAbsolute(root) ||
        !/^[a-f0-9]{32}$/.test(token)
    )
        throw new Error("invalid-owner");
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
        throw new Error("invalid-owner");
    const marker = path.join(root, ".owner");
    const fd = fs.openSync(
        marker,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    );
    try {
        if (
            fs.fstatSync(fd).size !== 32 ||
            fs.readFileSync(fd, "utf8") !== token
        )
            throw new Error("invalid-owner");
    } finally {
        fs.closeSync(fd);
    }
}
function session(env = process.env, platform = process.platform) {
    if (platform !== "linux" || env.CI_FIREFOX_CRASH_DIAGNOSTICS !== "1")
        return null;
    const root = env.CI_FIREFOX_CRASH_ROOT,
        token = env.CI_FIREFOX_CRASH_TOKEN;
    owned(root, token);
    return { root, token };
}
function create(engine, env = process.env, platform = process.platform) {
    if (
        platform !== "linux" ||
        engine !== "firefox" ||
        env.CI_FIREFOX_CRASH_DIAGNOSTICS !== "1"
    )
        return null;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ott-firefox-crash-"));
    fs.chmodSync(root, 0o700);
    const token = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(path.join(root, ".owner"), token, {
        flag: "wx",
        mode: 0o600,
    });
    for (const name of ["tmp", "data", "retained"])
        fs.mkdirSync(path.join(root, name), { mode: 0o700 });
    return { root, token };
}
function launchEnvironment(owner, env = process.env) {
    if (!owner) return undefined;
    owned(owner.root, owner.token);
    const result = {
        ...env,
        MOZ_CRASHREPORTER: "1",
        MOZ_CRASHREPORTER_DATA_DIRECTORY: path.join(owner.root, "data"),
        MOZ_CRASHREPORTER_NO_REPORT: "1",
        TMPDIR: path.join(owner.root, "tmp"),
    };
    for (const key of [
        "MOZ_CRASHREPORTER_DISABLE",
        "MOZ_CRASHREPORTER_FULLDUMP",
        "MOZ_CRASHREPORTER_SHUTDOWN",
        "MOZ_CRASHREPORTER_URL",
        "MINIDUMP_SAVE_PATH",
    ])
        delete result[key];
    return result;
}
function childEnvironment(owner, env = process.env) {
    if (!owner && env.CI_FIREFOX_CRASH_DIAGNOSTICS === "1") {
        const result = { ...env };
        for (const key of [
            "CI_FIREFOX_CRASH_DIAGNOSTICS",
            "CI_FIREFOX_CRASH_ROOT",
            "CI_FIREFOX_CRASH_TOKEN",
        ])
            delete result[key];
        return result;
    }
    return owner
        ? {
              ...launchEnvironment(owner, env),
              CI_FIREFOX_CRASH_ROOT: owner.root,
              CI_FIREFOX_CRASH_TOKEN: owner.token,
          }
        : env;
}
function dumps(owner) {
    owned(owner.root, owner.token);
    const found = [],
        stack = [[owner.root, 0]],
        seen = new Set();
    let readBytes = 0,
        uniqueBytes = 0;
    let entries = 0;
    while (stack.length) {
        const [directory, depth] = stack.pop();
        const directoryStat = fs.lstatSync(directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
            throw new Error("invalid-owner");
        for (const item of fs.readdirSync(directory)) {
            if (++entries > 512) throw new Error("diagnostic-limit");
            const file = path.join(directory, item),
                stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory() && depth < 6) stack.push([file, depth + 1]);
            else if (stat.isFile() && /^[a-zA-Z0-9_-]+\.dmp$/.test(item)) {
                if (
                    stat.size > LIMIT ||
                    readBytes + stat.size > 128 * 1024 * 1024
                )
                    throw new Error("diagnostic-limit");
                const fd = fs.openSync(
                    file,
                    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
                );
                try {
                    const current = fs.fstatSync(fd);
                    if (
                        !current.isFile() ||
                        current.size !== stat.size ||
                        current.ino !== stat.ino ||
                        current.dev !== stat.dev
                    )
                        throw new Error("invalid-owner");
                    const bytes = Buffer.alloc(stat.size);
                    let offset = 0;
                    while (offset < bytes.length) {
                        const count = fs.readSync(
                            fd,
                            bytes,
                            offset,
                            bytes.length - offset,
                            offset
                        );
                        if (!count) throw new Error("incomplete-minidump");
                        offset += count;
                    }
                    readBytes += bytes.length;
                    const hash = crypto
                        .createHash("sha256")
                        .update(bytes)
                        .digest("hex");
                    if (!seen.has(hash)) {
                        if (
                            found.length >= MAX_FILES ||
                            uniqueBytes + bytes.length > 64 * 1024 * 1024
                        )
                            throw new Error("diagnostic-limit");
                        uniqueBytes += bytes.length;
                        seen.add(hash);
                        found.push({ bytes, hash });
                    }
                } finally {
                    fs.closeSync(fd);
                }
            }
        }
        const after = fs.lstatSync(directory);
        if (
            after.isSymbolicLink() ||
            after.ino !== directoryStat.ino ||
            after.dev !== directoryStat.dev
        )
            throw new Error("invalid-owner");
    }
    owned(owner.root, owner.token);
    return found;
}
function retain(owner) {
    if (!owner) return;
    for (const dump of dumps(owner)) {
        const file = path.join(owner.root, "retained", dump.hash + ".dmp");
        try {
            fs.writeFileSync(file, dump.bytes, { flag: "wx", mode: 0o600 });
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
        }
    }
}
function finish(
    owner,
    output,
    { engine, env = process.env, platform = process.platform } = {}
) {
    if (!owner) {
        if (engine === "firefox" && env.CI_FIREFOX_CRASH_DIAGNOSTICS === "1") {
            const report = {
                dumps: [],
                enabled: true,
                schema: 1,
                status:
                    platform === "linux"
                        ? "initialization-unavailable"
                        : "unsupported-platform",
            };
            fs.writeFileSync(
                path.join(output, "firefox-crash-summary.json"),
                JSON.stringify(report, null, 2) + "\n",
                { flag: "wx", mode: 0o600 }
            );
            return report;
        }
        return;
    }
    const report = {
        dumps: [],
        enabled: true,
        schema: 1,
        status: "unavailable",
    };
    try {
        const seen = new Set();
        for (const dump of dumps(owner)) {
            if (seen.has(dump.hash)) continue;
            seen.add(dump.hash);
            let signature;
            try {
                signature = parseDump(dump.bytes);
            } catch (_) {
                signature = { status: "invalid-minidump" };
            }
            report.dumps.push({
                bytes: dump.bytes.length,
                sha256: dump.hash,
                ...signature,
            });
        }
        if (report.dumps.length) report.status = "captured";
    } catch (_) {
        report.status = "unavailable-or-limit";
    } finally {
        // Only delete the nonce-owned private tree. Never follow an ownership replacement.
        try {
            owned(owner.root, owner.token);
            fs.rmSync(owner.root, { recursive: true });
        } catch (_) {
            report.cleanup = "ownership-check-failed";
        }
    }
    fs.writeFileSync(
        path.join(output, "firefox-crash-summary.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx", mode: 0o600 }
    );
    return report;
}
module.exports = {
    childEnvironment,
    create,
    finish,
    launchEnvironment,
    parseDump,
    retain,
    session,
};

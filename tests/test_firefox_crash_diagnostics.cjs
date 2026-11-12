const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const diagnostics = require("../scripts/firefox-crash-diagnostics.cjs");
const enabled = { CI_FIREFOX_CRASH_DIAGNOSTICS: "1" };
function dump() {
    const bytes = Buffer.alloc(512);
    bytes.writeUInt32LE(0x504d444d, 0);
    bytes.writeUInt32LE(2, 8);
    bytes.writeUInt32LE(32, 12);
    bytes.writeUInt32LE(6, 32);
    bytes.writeUInt32LE(168, 36);
    bytes.writeUInt32LE(64, 40);
    bytes.writeUInt32LE(4, 44);
    bytes.writeUInt32LE(112, 48);
    bytes.writeUInt32LE(232, 52);
    bytes.writeUInt32LE(11, 72);
    bytes.writeBigUInt64LE(0x1012n, 88);
    bytes.writeUInt32LE(1, 232);
    bytes.writeBigUInt64LE(0x1000n, 236);
    bytes.writeUInt32LE(4096, 244);
    bytes.writeUInt32LE(12, 312);
    bytes.writeUInt32LE(344, 316);
    bytes.writeUInt32LE(0x4270454c, 344);
    Buffer.from("0102030405060708", "hex").copy(bytes, 348);
    bytes.write("SECRET /home/private/token?password=hidden", 380);
    return bytes;
}
function scope(t) {
    const owner = diagnostics.create("firefox", enabled, "linux");
    const output = fs.mkdtempSync(
        path.join(os.tmpdir(), "ott-crash-test-report-")
    );
    t.after(() => {
        fs.rmSync(owner.root, { force: true, recursive: true });
        fs.rmSync(output, { force: true, recursive: true });
    });
    return { output, owner };
}
test("strict opt-in and Firefox-only launch; inherited disable is removed", () => {
    assert.equal(diagnostics.create("firefox", {}), null);
    assert.equal(diagnostics.create("chromium", enabled), null);
    assert.equal(diagnostics.session({}), null);
    assert.equal(diagnostics.launchEnvironment(null), undefined);
});
test("launch environment isolates storage without full dumps or submissions", (t) => {
    const { owner } = scope(t);
    const env = diagnostics.childEnvironment(owner, {
        ...enabled,
        MINIDUMP_SAVE_PATH: "/private",
        MOZ_CRASHREPORTER_DISABLE: "0",
        MOZ_CRASHREPORTER_FULLDUMP: "1",
        MOZ_CRASHREPORTER_URL: "https://private.invalid/",
        ordinary: "kept",
    });
    assert.equal(env.MOZ_CRASHREPORTER_DISABLE, undefined);
    assert.equal(env.MOZ_CRASHREPORTER_FULLDUMP, undefined);
    assert.equal(env.MOZ_CRASHREPORTER_URL, undefined);
    assert.equal(env.MINIDUMP_SAVE_PATH, undefined);
    assert.equal(env.MOZ_CRASHREPORTER, "1");
    assert.equal(env.MOZ_CRASHREPORTER_NO_REPORT, "1");
    assert.equal(env.TMPDIR, path.join(owner.root, "tmp"));
    assert.equal(
        env.MOZ_CRASHREPORTER_DATA_DIRECTORY,
        path.join(owner.root, "data")
    );
    assert.equal(env.ordinary, "kept");
    assert.deepEqual(diagnostics.session(env, "linux"), owner);
    assert.equal(
        Object.keys(env).some((key) => key.includes("SANDBOX")),
        false
    );
});
test("binary signature never includes memory strings, names or absolute addresses", () => {
    assert.deepEqual(diagnostics.parseDump(dump()), {
        buildId: "0102030405060708",
        exceptionCode: "0xb",
        moduleImageBytes: 4096,
        moduleOffset: "0x12",
        status: "exception",
    });
    assert.doesNotMatch(
        JSON.stringify(diagnostics.parseDump(dump())),
        /SECRET|private|password|1012|1000/
    );
});
test("malformed offsets, stream duplicates, module counts and missing exception", () => {
    for (const mutate of [
        (b) => b.writeUInt32LE(999999, 40),
        (b) => b.writeUInt32LE(6, 44),
        (b) => b.writeUInt32LE(2049, 232),
        (b) => b.writeUInt32LE(129, 8),
        (b) => b.writeUInt32LE(0, 0),
        (b) => b.writeUInt32LE(999999, 316),
    ]) {
        const bytes = dump();
        mutate(bytes);
        assert.throws(() => diagnostics.parseDump(bytes), /invalid-minidump/);
    }
    const bytes = dump();
    bytes.writeUInt32LE(0, 8);
    assert.deepEqual(diagnostics.parseDump(bytes), {
        status: "no-exception-stream",
    });
    assert.throws(
        () => diagnostics.parseDump(Buffer.alloc(31)),
        /invalid-minidump/
    );
    assert.throws(
        () => diagnostics.parseDump(Buffer.alloc(32 * 1024 * 1024 + 1)),
        /invalid-minidump/
    );
});
test("retention survives profile deletion, deduplicates, publishes scalar receipt and removes raw data", (t) => {
    const { owner, output } = scope(t);
    const file = path.join(owner.root, "tmp", "profile.dmp");
    fs.writeFileSync(file, dump());
    diagnostics.retain(owner);
    diagnostics.retain(owner);
    fs.unlinkSync(file);
    const report = diagnostics.finish(owner, output);
    assert.equal(report.status, "captured");
    assert.equal(report.dumps.length, 1);
    assert.equal(report.dumps[0].buildId, "0102030405060708");
    assert.equal(fs.existsSync(owner.root), false);
    assert.deepEqual(fs.readdirSync(output), ["firefox-crash-summary.json"]);
    assert.doesNotMatch(
        fs.readFileSync(
            path.join(output, "firefox-crash-summary.json"),
            "utf8"
        ),
        /SECRET|private|token|password|ott-firefox-crash/
    );
});
test("no dumps is unavailable, not a fabricated crash signature", (t) => {
    const { owner, output } = scope(t);
    assert.deepEqual(diagnostics.finish(owner, output), {
        dumps: [],
        enabled: true,
        schema: 1,
        status: "unavailable",
    });
    assert.equal(fs.existsSync(owner.root), false);
});
test("symlink dumps are not read or removed outside owned tree", (t) => {
    const { owner, output } = scope(t);
    const outside = path.join(output, "secret.dmp");
    fs.writeFileSync(outside, dump());
    fs.symlinkSync(outside, path.join(owner.root, "tmp", "link.dmp"));
    fs.symlinkSync(output, path.join(owner.root, "tmp", "directory"));
    assert.equal(diagnostics.finish(owner, output).status, "unavailable");
    assert.equal(fs.existsSync(outside), true);
});
test("ownership replacement prevents reads and recursive deletion", (t) => {
    const { owner, output } = scope(t);
    fs.writeFileSync(path.join(owner.root, ".owner"), "0".repeat(32));
    assert.throws(
        () =>
            diagnostics.session(
                {
                    ...enabled,
                    CI_FIREFOX_CRASH_ROOT: owner.root,
                    CI_FIREFOX_CRASH_TOKEN: owner.token,
                },
                "linux"
            ),
        /invalid-owner/
    );
    const report = diagnostics.finish(owner, output);
    assert.equal(report.status, "unavailable-or-limit");
    assert.equal(report.cleanup, "ownership-check-failed");
    assert.equal(fs.existsSync(owner.root), true);
});
test("count and file-size bounds fail closed and still clean private files", (t) => {
    const { owner, output } = scope(t);
    for (let i = 0; i < 9; i++) {
        const bytes = dump();
        bytes[511] = i;
        fs.writeFileSync(path.join(owner.root, "tmp", `${i}.dmp`), bytes);
    }
    assert.equal(
        diagnostics.finish(owner, output).status,
        "unavailable-or-limit"
    );
    assert.equal(fs.existsSync(owner.root), false);
    const second = scope(t);
    const fd = fs.openSync(
        path.join(second.owner.root, "tmp", "huge.dmp"),
        "w"
    );
    fs.ftruncateSync(fd, 32 * 1024 * 1024 + 1);
    fs.closeSync(fd);
    assert.equal(
        diagnostics.finish(second.owner, second.output).status,
        "unavailable-or-limit"
    );
    assert.equal(fs.existsSync(second.owner.root), false);
});

test("unsupported platforms do not create or validate Linux-owned sessions and publish explicit unavailability", (t) => {
    for (const platform of ["win32", "darwin"]) {
        const env = {
            ...enabled,
            CI_FIREFOX_CRASH_ROOT: "/nonexistent-private-root",
            CI_FIREFOX_CRASH_TOKEN: "not-an-owner",
        };
        assert.equal(diagnostics.create("firefox", env, platform), null);
        assert.equal(diagnostics.session(env, platform), null);
        assert.equal(diagnostics.launchEnvironment(null, env), undefined);
        const child = diagnostics.childEnvironment(null, env);
        assert.equal(child.CI_FIREFOX_CRASH_DIAGNOSTICS, undefined);
        assert.equal(child.CI_FIREFOX_CRASH_ROOT, undefined);
        assert.equal(child.CI_FIREFOX_CRASH_TOKEN, undefined);
        assert.equal(diagnostics.session(child, "linux"), null);
        const output = fs.mkdtempSync(
            path.join(os.tmpdir(), "ott-crash-unsupported-")
        );
        t.after(() => fs.rmSync(output, { force: true, recursive: true }));
        const report = diagnostics.finish(null, output, {
            engine: "firefox",
            env,
            platform,
        });
        assert.deepEqual(report, {
            dumps: [],
            enabled: true,
            schema: 1,
            status: "unsupported-platform",
        });
        assert.doesNotMatch(JSON.stringify(report), /nonexistent|not-an-owner/);
        assert.equal(
            JSON.parse(
                fs.readFileSync(
                    path.join(output, "firefox-crash-summary.json"),
                    "utf8"
                )
            ).status,
            "unsupported-platform"
        );
    }
});

function instructionDump() {
    const original = dump(),
        bytes = Buffer.alloc(1024);
    original.copy(bytes);
    original.copy(bytes, 80, 64, 232);
    original.copy(bytes, 248, 232, 344);
    original.copy(bytes, 360, 344, 356);
    bytes.writeUInt32LE(3, 8);
    bytes.writeUInt32LE(80, 40);
    bytes.writeUInt32LE(248, 52);
    bytes.writeUInt32LE(7, 56);
    bytes.writeUInt32LE(56, 60);
    bytes.writeUInt32LE(600, 64);
    bytes.writeBigUInt64LE(0n, 104); // Null fault address must not hide a valid RIP signature.
    bytes.writeUInt32LE(256, 240);
    bytes.writeUInt32LE(700, 244);
    bytes.writeUInt32LE(12, 328);
    bytes.writeUInt32LE(360, 332);
    bytes.writeUInt16LE(9, 600);
    bytes.writeUInt32LE(0x8201, 620);
    bytes.writeUInt32LE(0x00100001, 748);
    bytes.writeBigUInt64LE(0x1034n, 948);
    bytes.write("SECRET absolute RIP 0x1034 private module /home/private", 962);
    return bytes;
}
test("Linux AMD64 CONTROL context yields only module-relative instruction and build ID despite null fault address", () => {
    const report = diagnostics.parseDump(instructionDump());
    assert.deepEqual(report, {
        exceptionCode: "0xb",
        instructionBuildId: "0102030405060708",
        instructionModuleOffset: "0x34",
        status: "exception",
    });
    assert.doesNotMatch(
        JSON.stringify(report),
        /SECRET|private|1034|absolute|home/
    );
});
test("instruction signature requires Linux AMD64 architecture and valid CONTROL flags, never assumes another layout", () => {
    for (const mutate of [
        (b) => b.writeUInt16LE(0, 600),
        (b) => b.writeUInt16LE(12, 600),
        (b) => b.writeUInt32LE(2, 620),
        (b) => b.writeUInt32LE(0x00100002, 748),
        (b) => b.writeUInt32LE(0x00010001, 748),
        (b) => b.writeBigUInt64LE(0x5000n, 948),
        (b) => b.writeUInt32LE(0, 240),
    ]) {
        const bytes = instructionDump();
        mutate(bytes);
        const report = diagnostics.parseDump(bytes);
        assert.equal(report.instructionModuleOffset, undefined);
        assert.equal(report.instructionBuildId, undefined);
    }
});
test("truncated or malformed context and system-info descriptors fail closed", () => {
    for (const mutate of [
        (b) => b.writeUInt32LE(255, 240),
        (b) => b.writeUInt32LE(999999, 244),
        (b) => b.writeUInt32LE(999999, 240),
        (b) => b.writeUInt32LE(55, 60),
        (b) => b.writeUInt32LE(999999, 64),
        (b) => b.writeUInt32LE(999999, 332),
    ]) {
        const bytes = instructionDump();
        mutate(bytes);
        assert.throws(() => diagnostics.parseDump(bytes), /invalid-minidump/);
    }
    assert.throws(
        () => diagnostics.parseDump(instructionDump().subarray(0, 955)),
        /invalid-minidump/
    );
});

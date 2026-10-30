#!/usr/bin/env node
// A deterministic, unprivileged hosted-app IPK. No vendor CLI is installed.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gzipSync, gunzipSync } = require("node:zlib");

const APP_ID = "com.openottplay.player";
const TARGET = "https://player.ottplay.here.now/";
const MAX_BYTES = 4 * 1024 * 1024;
const NAMES = {
    checksum: "ottplay-foss-webos.sha256",
    ipk: "ottplay-foss-webos.ipk",
    metadata: "ottplay-foss-webos.json",
};
const APP_ROOT = "usr/palm/applications/" + APP_ID + "/";
const PACKAGE_PATH = "usr/palm/packages/" + APP_ID + "/packageinfo.json";
const INPUTS = ["appinfo.json", "index.html", "icon.png", "largeIcon.png"];
const IDENTITY_KEYS = [
    "buildNumber",
    "local",
    "packageVersion",
    "planSha256",
    "releaseTag",
    "source",
    "webosVersion",
];

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
    return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}

function readFile(file, limit = MAX_BYTES) {
    const info = fs.lstatSync(file);
    assert(
        info.isFile() && !info.isSymbolicLink(),
        "Expected a regular file: " + file
    );
    assert(
        info.size > 0 && info.size <= limit,
        "File exceeds bounded size: " + file
    );
    const result = fs.readFileSync(file);
    assert(
        result.length === info.size && result.length <= limit,
        "File changed while reading"
    );
    return result;
}

function validateIdentity(identity) {
    assert.equal(
        typeof identity.local,
        "boolean",
        "Missing local/release identity"
    );
    assert.match(identity.source, /^[a-f0-9]{40}$/);
    assert.match(
        identity.packageVersion,
        /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-z0-9.-]+)?$/
    );
    assert(Number.isSafeInteger(identity.buildNumber), "Invalid build number");
    assert(
        identity.buildNumber >= 0 && identity.buildNumber <= 999999999,
        "webOS build number exceeds nine digits"
    );
    assert.equal(identity.webosVersion, "1.0." + identity.buildNumber);
    if (identity.local) {
        assert.equal(identity.buildNumber, 0);
        assert.equal(identity.releaseTag, "");
        assert.equal(identity.planSha256, "");
    } else {
        assert(
            identity.buildNumber > 0,
            "A release requires a positive build number"
        );
        assert.match(
            identity.releaseTag,
            /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:beta|rc)\.[1-9]\d*|-nightly\.\d{14}\.[1-9]\d*\.[1-9]\d*)?$/
        );
        assert.match(identity.planSha256, /^[a-f0-9]{64}$/);
    }
    return Object.fromEntries(IDENTITY_KEYS.map((key) => [key, identity[key]]));
}

function identityFromPlan(
    root,
    planPath = path.join(root, ".release-plan.json")
) {
    // Use the project's existing source/overlay verifier and version projection.
    // An alternate path may select the same frozen plan, never another overlay.
    readFile(planPath, 2_000_000);
    const source = `
import importlib.util, json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve(strict=True)
selected = pathlib.Path(sys.argv[2])
canonical = root / '.release-plan.json'
if selected.is_symlink() or not selected.is_file() or canonical.is_symlink():
    raise ValueError('Release plan must be a regular file')
plan = json.loads(selected.read_bytes())
if plan != json.loads(canonical.read_bytes()):
    raise ValueError('Selected plan differs from the applied root plan')
spec = importlib.util.spec_from_file_location('webos_source', root / 'scripts/verify-player-build-source.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
head = module.verify(root)
if plan != json.loads(canonical.read_bytes()) or plan != json.loads(selected.read_bytes()):
    raise ValueError('Release plan changed during source verification')
import version_plan
print(json.dumps({'source':head,'packageVersion':version_plan.projections(plan)['package'],
    'buildNumber':plan['build_number'],'releaseTag':plan['tag'],
    'planSha256':version_plan.plan_digest(plan)}))
`;
    const projected = JSON.parse(
        execFileSync(
            "python3",
            ["-I", "-B", "-c", source, root, path.resolve(planPath)],
            {
                cwd: root,
                encoding: "utf8",
                maxBuffer: 1024 * 1024,
                stdio: ["ignore", "pipe", "pipe"],
                timeout: 30000,
            }
        )
    );
    return validateIdentity({
        ...projected,
        local: false,
        webosVersion: "1.0." + projected.buildNumber,
    });
}

function localIdentity(root) {
    const source = execFileSync(
        "git",
        ["--no-optional-locks", "rev-parse", "HEAD"],
        {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 10000,
        }
    ).trim();
    return validateIdentity({
        buildNumber: 0,
        local: true,
        packageVersion: JSON.parse(
            readFile(path.join(root, "package.json"), 1024 * 1024)
        ).version,
        planSha256: "",
        releaseTag: "",
        source,
        webosVersion: "1.0.0",
    });
}

function safeName(name) {
    assert(typeof name === "string" && name.length > 0 && name.length < 100);
    assert(
        /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/"),
        "Unsafe archive path"
    );
    assert(
        !name
            .replace(/\/$/, "")
            .split("/")
            .some((part) => !part || part === "." || part === ".."),
        "Unsafe archive path"
    );
}

function octal(value, length) {
    const text = value.toString(8);
    assert(text.length < length, "Archive numeric field overflow");
    return text.padStart(length - 1, "0") + "\0";
}

function tar(files) {
    const entries = new Map();
    for (const [name, value] of files) {
        safeName(name);
        assert(!entries.has(name), "Duplicate archive path");
        const parts = name.split("/");
        for (let i = 1; i < parts.length; i++)
            entries.set(parts.slice(0, i).join("/") + "/", null);
        entries.set(name, value);
    }
    const chunks = [];
    for (const [name, data] of [...entries].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0
    )) {
        safeName(name);
        const directory = data === null;
        const bytes = directory ? Buffer.alloc(0) : Buffer.from(data);
        const header = Buffer.alloc(512);
        header.write(name, 0, 100, "ascii");
        header.write(octal(directory ? 0o755 : 0o644, 8), 100, 8, "ascii");
        header.write(octal(0, 8), 108, 8, "ascii");
        header.write(octal(0, 8), 116, 8, "ascii");
        header.write(octal(bytes.length, 12), 124, 12, "ascii");
        header.write(octal(0, 12), 136, 12, "ascii");
        header.fill(32, 148, 156);
        header.write(directory ? "5" : "0", 156, 1, "ascii");
        header.write("ustar\0", 257, 6, "ascii");
        header.write("00", 263, 2, "ascii");
        const sum = header.reduce((total, byte) => total + byte, 0);
        header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
        chunks.push(
            header,
            bytes,
            Buffer.alloc((512 - (bytes.length % 512)) % 512)
        );
    }
    chunks.push(Buffer.alloc(1024));
    const result = Buffer.concat(chunks);
    assert(result.length <= MAX_BYTES, "Tar exceeds bounded size");
    return result;
}

function gzip(bytes) {
    const result = gzipSync(bytes, { level: 9 });
    // A platform-neutral gzip header, with the default zero timestamp.
    result[9] = 255;
    return result;
}

function ar(members) {
    const parts = [Buffer.from("!<arch>\n")];
    for (const [name, bytes] of members) {
        assert(/^[a-z.-]{1,16}$/.test(name));
        const header =
            name.padEnd(16) +
            "0".padEnd(12) +
            "0".padEnd(6) +
            "0".padEnd(6) +
            "100644".padEnd(8) +
            String(bytes.length).padEnd(10) +
            "`\n";
        parts.push(Buffer.from(header, "ascii"), bytes);
        if (bytes.length % 2) parts.push(Buffer.from("\n"));
    }
    return Buffer.concat(parts);
}

function unpackAr(bytes) {
    assert(
        bytes.length <= MAX_BYTES &&
            bytes.subarray(0, 8).toString() === "!<arch>\n",
        "Invalid IPK archive"
    );
    const result = new Map();
    let at = 8;
    for (const expected of ["debian-binary", "control.tar.gz", "data.tar.gz"]) {
        assert(at + 60 <= bytes.length, "Truncated ar header");
        const header = bytes.subarray(at, at + 60).toString("ascii");
        assert.equal(
            header.slice(0, 16).trim(),
            expected,
            "Unexpected ar member"
        );
        assert.equal(header.slice(58), "`\n", "Invalid ar header");
        assert(/^\d+ *$/.test(header.slice(48, 58)), "Invalid ar size");
        const size = Number(header.slice(48, 58).trim());
        assert(
            size > 0 && size <= MAX_BYTES && at + 60 + size <= bytes.length,
            "Truncated ar member"
        );
        at += 60;
        result.set(expected, bytes.subarray(at, at + size));
        at += size;
        if (size % 2) assert.equal(bytes[at++], 10, "Invalid ar padding");
    }
    assert.equal(at, bytes.length, "Extra ar data");
    assert.equal(result.get("debian-binary").toString(), "2.0\n");
    return result;
}

function unpackTar(compressed) {
    const bytes = gunzipSync(compressed, { maxOutputLength: MAX_BYTES });
    assert(bytes.length % 512 === 0, "Invalid tar length");
    const files = new Map();
    const seen = new Set();
    const directories = new Set();
    const field = (header, start, count) =>
        header
            .subarray(start, start + count)
            .toString("ascii")
            .replace(/\0.*$/, "");
    const number = (header, start, count) => {
        const text = field(header, start, count).trim();
        assert(/^[0-7]+$/.test(text), "Invalid tar number");
        return parseInt(text, 8);
    };
    let at = 0;
    while (at + 512 <= bytes.length && bytes[at] !== 0) {
        const header = bytes.subarray(at, at + 512);
        const name = field(header, 0, 100);
        safeName(name);
        assert(!seen.has(name), "Duplicate tar member");
        seen.add(name);
        assert(seen.size <= 32, "Too many tar members");
        const recorded = number(header, 148, 8);
        const check = Buffer.from(header);
        check.fill(32, 148, 156);
        assert.equal(
            recorded,
            check.reduce((total, byte) => total + byte, 0),
            "Tar checksum mismatch"
        );
        assert.equal(field(header, 257, 6), "ustar");
        assert.equal(field(header, 263, 2), "00");
        assert.equal(number(header, 108, 8), 0, "Unexpected tar owner");
        assert.equal(number(header, 116, 8), 0, "Unexpected tar group");
        assert.equal(number(header, 136, 12), 0, "Unexpected tar timestamp");
        assert.equal(field(header, 157, 100), "", "Tar links are not allowed");
        assert.equal(
            field(header, 345, 155),
            "",
            "Tar prefixes are not allowed"
        );
        const type = field(header, 156, 1);
        assert(
            type === "0" || type === "5",
            "Tar entry must be a regular file or directory"
        );
        const size = number(header, 124, 12);
        assert(
            size <= MAX_BYTES && at + 512 + size <= bytes.length,
            "Truncated tar entry"
        );
        assert.equal(
            number(header, 100, 8),
            type === "5" ? 0o755 : 0o644,
            "Unexpected tar mode"
        );
        if (type === "5") {
            assert(size === 0 && name.endsWith("/"), "Invalid tar directory");
            directories.add(name);
        } else files.set(name, bytes.subarray(at + 512, at + 512 + size));
        at += 512 + Math.ceil(size / 512) * 512;
    }
    assert(
        bytes.length - at >= 1024 &&
            bytes.subarray(at).every((byte) => byte === 0),
        "Invalid tar terminator"
    );
    const expectedDirectories = new Set();
    for (const name of files.keys()) {
        const parts = name.split("/");
        for (let i = 1; i < parts.length; i++)
            expectedDirectories.add(parts.slice(0, i).join("/") + "/");
    }
    assert.deepEqual(
        [...directories].sort(),
        [...expectedDirectories].sort(),
        "Unexpected tar directories"
    );
    return files;
}

function pngSize(bytes, size) {
    assert(
        bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        "Expected a PNG icon"
    );
    assert(bytes.length >= 33 && bytes.toString("ascii", 12, 16) === "IHDR");
    assert.equal(bytes.readUInt32BE(16), size, "Wrong icon width");
    assert.equal(bytes.readUInt32BE(20), size, "Wrong icon height");
}

function productFiles(root, identity) {
    const directory = path.join(root, "webos");
    assert(
        fs.lstatSync(directory).isDirectory() &&
            !fs.lstatSync(directory).isSymbolicLink(),
        "webos must be a real directory"
    );
    const result = new Map(
        INPUTS.map((name) => [name, readFile(path.join(directory, name))])
    );
    result.set("LICENSE", readFile(path.join(root, "LICENSE"), 32768));
    const appinfo = JSON.parse(result.get("appinfo.json"));
    assert.deepEqual(
        appinfo,
        {
            appDescription:
                "Hosted IPTV and media player. Network connection required.",
            disableBackHistoryAPI: true,
            handlesRelaunch: false,
            icon: "icon.png",
            id: APP_ID,
            largeIcon: "largeIcon.png",
            main: "index.html",
            title: "OTT-play FOSS",
            type: "web",
            vendor: "open-ott-play",
            version: "1.0.0",
        },
        "Unexpected launcher appinfo template"
    );
    const html = result.get("index.html").toString("utf8");
    assert(
        html.includes('var target = "' + TARGET + '";') &&
            html.includes("window.location.replace(target)"),
        "Launcher target is not canonical"
    );
    assert(!/<iframe\b/i.test(html), "Hosted launcher must not use an iframe");
    pngSize(result.get("icon.png"), 80);
    pngSize(result.get("largeIcon.png"), 130);
    appinfo.version = identity.webosVersion;
    result.set("appinfo.json", jsonBytes(appinfo));
    result.set(
        "build-info.json",
        jsonBytes({ appId: APP_ID, schema: 1, target: TARGET, ...identity })
    );
    return result;
}

function packageInfo(version) {
    return {
        app: APP_ID,
        id: APP_ID,
        loc_name: "OTT-play FOSS",
        package_format_version: 2,
        vendor: "open-ott-play",
        version,
    };
}

function control(version, installedSize) {
    return Buffer.from(
        "Package: " +
            APP_ID +
            "\nVersion: " +
            version +
            "\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: " +
            Math.ceil(installedSize / 1024) +
            "\nMaintainer: open-ott-play\nDescription: OTT-play FOSS hosted web player\nwebOS-Package-Format-Version: 2\n\n"
    );
}

function buildBytes(root, inputIdentity) {
    const identity = validateIdentity(inputIdentity);
    const product = productFiles(root, identity);
    const files = new Map(
        [...product].map(([name, bytes]) => [APP_ROOT + name, bytes])
    );
    files.set(PACKAGE_PATH, jsonBytes(packageInfo(identity.webosVersion)));
    const installedSize = [...files.values()].reduce(
        (total, bytes) => total + bytes.length,
        0
    );
    const ipk = ar([
        ["debian-binary", Buffer.from("2.0\n")],
        [
            "control.tar.gz",
            gzip(
                tar(
                    new Map([
                        [
                            "control",
                            control(identity.webosVersion, installedSize),
                        ],
                    ])
                )
            ),
        ],
        ["data.tar.gz", gzip(tar(files))],
    ]);
    const metadata = {
        appId: APP_ID,
        schema: 1,
        target: TARGET,
        ...identity,
        bytes: ipk.length,
        installedSize,
        largeIconSha256: sha256(product.get("largeIcon.png")),
        sha256: sha256(ipk),
    };
    return { ipk, metadata };
}

function verifyPackage(ipkPath, sidecarPath, expectedIdentity) {
    const ipk = readFile(ipkPath);
    const metadata = JSON.parse(readFile(sidecarPath, 32768));
    const identity = validateIdentity(metadata);
    assert.deepEqual(
        Object.keys(metadata).sort(),
        [
            "schema",
            "appId",
            "target",
            ...IDENTITY_KEYS,
            "bytes",
            "installedSize",
            "sha256",
            "largeIconSha256",
        ].sort(),
        "Unexpected metadata fields"
    );
    assert.equal(metadata.schema, 1);
    assert.equal(metadata.appId, APP_ID);
    assert.equal(metadata.target, TARGET);
    assert.equal(metadata.bytes, ipk.length);
    assert.equal(metadata.sha256, sha256(ipk), "IPK digest mismatch");
    if (expectedIdentity)
        assert.deepEqual(
            identity,
            validateIdentity(expectedIdentity),
            "IPK differs from the expected release identity"
        );
    const members = unpackAr(ipk);
    const controls = unpackTar(members.get("control.tar.gz"));
    const files = unpackTar(members.get("data.tar.gz"));
    const expected = INPUTS.concat("build-info.json", "LICENSE")
        .map((name) => APP_ROOT + name)
        .concat(PACKAGE_PATH);
    assert.deepEqual(
        [...files.keys()].sort(),
        expected.sort(),
        "Unexpected IPK payload"
    );
    assert.deepEqual(
        [...controls.keys()],
        ["control"],
        "Install hooks are not allowed"
    );
    const appinfo = JSON.parse(files.get(APP_ROOT + "appinfo.json"));
    const expectedProduct = productFiles(
        path.resolve(__dirname, ".."),
        identity
    );
    for (const [name, bytes] of expectedProduct)
        assert(
            files.get(APP_ROOT + name).equals(bytes),
            "Packaged product differs: " + name
        );
    assert(
        files
            .get(PACKAGE_PATH)
            .equals(jsonBytes(packageInfo(identity.webosVersion))),
        "Package descriptor mismatch"
    );
    const installedSize = [...files.values()].reduce(
        (total, bytes) => total + bytes.length,
        0
    );
    assert.equal(metadata.installedSize, installedSize);
    assert.equal(
        metadata.largeIconSha256,
        sha256(files.get(APP_ROOT + "largeIcon.png"))
    );
    assert(
        controls
            .get("control")
            .equals(control(identity.webosVersion, installedSize)),
        "Control metadata mismatch"
    );
    return { ...metadata, appinfo };
}

function outputDirectory(root) {
    let directory = root;
    for (const component of ["build", "packages"]) {
        directory = path.join(directory, component);
        if (!fs.existsSync(directory)) fs.mkdirSync(directory);
        const info = fs.lstatSync(directory);
        assert(
            info.isDirectory() && !info.isSymbolicLink(),
            "Output directory must not be a symlink"
        );
    }
    return directory;
}

function writeProduct(root, identity) {
    const { ipk, metadata } = buildBytes(root, identity);
    const directory = outputDirectory(root);
    const products = [
        [NAMES.ipk, ipk],
        [NAMES.metadata, jsonBytes(metadata)],
        [
            NAMES.checksum,
            Buffer.from(metadata.sha256 + "  " + NAMES.ipk + "\n"),
        ],
    ];
    // Never follow a pre-existing output link. Unrelated build files are retained.
    for (const [name] of products) {
        const file = path.join(directory, name);
        let info;
        try {
            info = fs.lstatSync(file);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        if (info) {
            assert(
                info.isFile() && !info.isSymbolicLink(),
                "Output must be a regular file"
            );
        }
    }
    for (const [name, bytes] of products) {
        const file = path.join(directory, name);
        const descriptor = fs.openSync(
            file,
            fs.constants.O_WRONLY |
                fs.constants.O_CREAT |
                fs.constants.O_TRUNC |
                (fs.constants.O_NOFOLLOW || 0),
            0o644
        );
        try {
            fs.writeFileSync(descriptor, bytes);
        } finally {
            fs.closeSync(descriptor);
        }
    }
    return verifyPackage(
        path.join(directory, NAMES.ipk),
        path.join(directory, NAMES.metadata),
        identity
    );
}

function main(args, root = path.resolve(__dirname, "..")) {
    let local = false,
        verify = false,
        plan;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--local" && !local) local = true;
        else if (args[i] === "--verify" && !verify) verify = true;
        else if (
            args[i] === "--plan" &&
            !plan &&
            args[i + 1] &&
            !args[i + 1].startsWith("--")
        )
            plan = path.resolve(args[++i]);
        else
            throw new Error(
                "Usage: package-webos.cjs [--verify] (--plan PATH | --local)"
            );
    }
    assert(!local || !plan, "--local and --plan are mutually exclusive");
    const identity = local ? localIdentity(root) : identityFromPlan(root, plan);
    const directory = path.join(root, "build", "packages");
    const result = verify
        ? verifyPackage(
              path.join(directory, NAMES.ipk),
              path.join(directory, NAMES.metadata),
              identity
          )
        : writeProduct(root, identity);
    if (!local)
        assert.deepEqual(
            identityFromPlan(root, plan),
            identity,
            "Release source changed during packaging"
        );
    console.log(
        (verify ? "Verified " : "Packaged ") +
            NAMES.ipk +
            " (" +
            result.webosVersion +
            ", " +
            result.bytes +
            " bytes)"
    );
    return result;
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error("webOS packaging failed: " + error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    APP_ID,
    APP_ROOT,
    buildBytes,
    identityFromPlan,
    localIdentity,
    MAX_BYTES,
    main,
    NAMES,
    PACKAGE_PATH,
    TARGET,
    validateIdentity,
    verifyPackage,
    writeProduct,
};

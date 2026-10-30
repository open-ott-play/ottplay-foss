#!/usr/bin/env node
// A release-bound Samsung TV package. Signing stays on the user's computer.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const webos = require("./package-webos.cjs");
const {
    CLASSIC_PROVIDER_BUNDLES,
    CLASSIC_OPTIONAL_BUNDLES,
} = require("./classic-bundle.cjs");

const APP_ID = "OttPlayFss.Player";
const PACKAGE_ID = "OttPlayFss";
const PROFILE = "tv-samsung";
const REQUIRED_VERSION = "5.5";
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED = 128 * 1024 * 1024;
const NAMES = {
    checksum: "ottplay-foss-tizen.sha256",
    installer: "ottplay-foss-tizen-install.py",
    metadata: "ottplay-foss-tizen.json",
    wgt: "ottplay-foss-tizen-unsigned.wgt",
};
// Mode A carries js/licenses; retain the additional notices for its legacy
// libraries and web fonts, including the documented provenance limitations.
const NOTICE_FILES = Object.freeze([
    "THIRD-PARTY-NOTICES.md",
    "licenses/android/Apache-2.0.txt",
    "licenses/android/Caveat-OFL.txt",
    "licenses/android/Gabriela-OFL.txt",
    "licenses/android/PT-Sans-Narrow-OFL.txt",
    "licenses/android/bundled-font-metadata.txt",
    "licenses/android/bundled-javascript-copyrights.txt",
    "licenses/android/jquery-1.11.1-LICENSE.txt",
    "licenses/android/shaka-player-3.3.19-LICENSE.txt",
]);
const MARKER =
    "<script>window.__OTTPLAY_TIZEN_PACKAGE__ = {schema: 1};</script>\n";
const IDENTITY_KEYS = [
    "buildNumber",
    "local",
    "packageVersion",
    "planSha256",
    "releaseTag",
    "source",
    "tizenVersion",
];

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
    return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}

function versionForBuild(build) {
    assert(Number.isSafeInteger(build) && build >= 0 && build <= 999999999);
    return [
        1 + Math.floor(build / 16777216),
        Math.floor(build / 65536) % 256,
        build % 65536,
    ].join(".");
}

function validateIdentity(value) {
    // Reuse the source/plan identity contract already qualified for TV packages.
    // Only the platform-specific numeric version projection differs.
    const common = webos.validateIdentity({
        ...value,
        webosVersion: "1.0." + value.buildNumber,
    });
    assert.equal(value.tizenVersion, versionForBuild(common.buildNumber));
    return Object.fromEntries(IDENTITY_KEYS.map((key) => [key, value[key]]));
}

function projectIdentity(identity) {
    const value = {
        ...identity,
        tizenVersion: versionForBuild(identity.buildNumber),
    };
    delete value.webosVersion;
    return validateIdentity(value);
}

function identityFromPlan(root, plan) {
    return projectIdentity(webos.identityFromPlan(root, plan));
}

function localIdentity(root) {
    return projectIdentity(webos.localIdentity(root));
}

function readRegular(file, limit = MAX_UNPACKED, allowEmpty = false) {
    const info = fs.lstatSync(file);
    assert(info.isFile() && !info.isSymbolicLink(), "Expected a regular file");
    assert(
        info.size >= (allowEmpty ? 0 : 1) && info.size <= limit,
        "File exceeds bounded size"
    );
    const result = fs.readFileSync(file);
    assert.equal(result.length, info.size, "File changed while reading");
    return result;
}

function python(root, code, args = [], input) {
    return execFileSync("python3", ["-I", "-B", "-c", code, ...args], {
        cwd: root,
        input,
        maxBuffer: MAX_UNPACKED * 2,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120000,
    });
}

function adaptIndex(bytes) {
    const html = bytes.toString("utf8");
    assert(
        !html.includes("window.__OTTPLAY_TIZEN_PACKAGE__ ="),
        "Index already adapted"
    );
    const polyfill =
        /(<script\b[^>]*\bsrc=["'])\/js\/runtime-polyfills\.js(?=[?"'])/g;
    assert.equal(
        [...html.matchAll(polyfill)].length,
        1,
        "Missing unique initial runtime polyfill"
    );
    assert(/<script\b/.test(html), "Missing player scripts");
    return Buffer.from(
        html
            .replace(polyfill, "$1js/runtime-polyfills.js")
            .replace(/<script\b/, MARKER + "<script")
    );
}

function configBytes(root, identity) {
    const template = readRegular(
        path.join(root, "tizen/config.xml"),
        16384
    ).toString("utf8");
    assert.equal(
        template.split("@TIZEN_VERSION@").length,
        2,
        "Invalid version placeholder"
    );
    return Buffer.from(
        template.replace("@TIZEN_VERSION@", identity.tizenVersion)
    );
}

function collectFiles(directory) {
    const files = new Map();
    let total = 0;
    function walk(relative) {
        const current = path.join(directory, relative);
        assert(
            !fs.lstatSync(current).isSymbolicLink(),
            "Links are not allowed"
        );
        for (const name of fs.readdirSync(current).sort()) {
            const child = relative ? relative + "/" + name : name;
            const file = path.join(directory, child);
            const info = fs.lstatSync(file);
            assert(!info.isSymbolicLink(), "Links are not allowed");
            if (info.isDirectory()) walk(child);
            else {
                // Empty provider about pages are valid Mode A payloads. Other
                // source inputs retain readRegular's nonempty requirement.
                const bytes = readRegular(file, MAX_UNPACKED, true);
                total += bytes.length;
                assert(
                    total <= MAX_UNPACKED && files.size < 10000,
                    "Player package exceeds limits"
                );
                files.set(child, bytes);
            }
        }
    }
    walk("");
    return files;
}

function classicFiles(root, identity) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-tizen-"));
    try {
        const destination = path.join(temporary, "web");
        // The same bounded Mode A validator is used by browser acceptance.
        const prepared = JSON.parse(
            python(
                root,
                `
import contextlib, importlib.util, json, sys
spec = importlib.util.spec_from_file_location('candidate', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with contextlib.redirect_stdout(sys.stderr):
    result = module.prepare(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
print(json.dumps(result))
`,
                [
                    path.join(root, "scripts/prepare_browser_candidate.py"),
                    path.join(root, "build/packages"),
                    destination,
                    path.join(temporary, "diagnostics"),
                    identity.source,
                ]
            ).toString("utf8")
        );
        const files = collectFiles(destination);
        const classic = JSON.parse(
            files.get("build-info.json").toString("utf8")
        );
        assert.equal(
            classic.version,
            identity.packageVersion,
            "Stale Mode A player version"
        );
        for (const [field, expected] of [
            ["providerBundles", CLASSIC_PROVIDER_BUNDLES],
            ["optionalBundles", CLASSIC_OPTIONAL_BUNDLES],
        ]) {
            assert.deepEqual(
                Object.keys(classic[field] || {}).sort(),
                Object.keys(expected).sort(),
                "Incomplete classic bundle inventory"
            );
            for (const entry of Object.values(classic[field])) {
                assert(files.has(entry.file), "Missing classic bundle");
                assert.equal(
                    sha256(files.get(entry.file)),
                    entry.sha256,
                    "Stale classic bundle"
                );
            }
        }
        assert(
            !files.has("config.xml") && !files.has("tizen-build-info.json"),
            "Unexpected native metadata in Mode A"
        );
        files.set("index.html", adaptIndex(files.get("index.html")));
        files.set("config.xml", configBytes(root, identity));
        files.set(
            "icon.png",
            readRegular(path.join(root, "tizen/icon.png"), 1024 * 1024)
        );
        files.set("tizen-build-info.json", jsonBytes(identity));
        for (const name of ["LICENSE", ...NOTICE_FILES]) {
            const bytes = readRegular(path.join(root, name), 1024 * 1024);
            assert(
                !files.has(name) || files.get(name).equals(bytes),
                "Mode A notice differs from source: " + name
            );
            files.set(name, bytes);
        }
        const archive = readRegular(
            path.join(root, "build/packages/ottplay-foss-modea.tar.gz"),
            MAX_BYTES
        );
        assert.equal(
            sha256(archive),
            prepared.sha256,
            "Mode A changed during packaging"
        );
        return {
            files,
            modea: { bytes: archive.length, sha256: prepared.sha256 },
        };
    } finally {
        fs.rmSync(temporary, { force: true, recursive: true });
    }
}

function buildBytes(root, value) {
    const identity = validateIdentity(value);
    const { files, modea } = classicFiles(root, identity);
    const installer = readRegular(
        path.join(root, "scripts/tizen-install.py"),
        1024 * 1024
    );
    const zip = python(
        root,
        `
import base64, json, runpy, sys
module = runpy.run_path(sys.argv[1])
files = {name: base64.b64decode(value, validate=True) for name, value in json.load(sys.stdin)}
sys.stdout.buffer.write(module['write_zip'](files))
`,
        [path.join(root, "scripts/tizen-install.py")],
        jsonBytes(
            [...files]
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([name, bytes]) => [name, bytes.toString("base64")])
        )
    );
    assert(zip.length <= MAX_BYTES, "WGT exceeds size limit");
    const metadata = {
        appId: APP_ID,
        packageId: PACKAGE_ID,
        profile: PROFILE,
        requiredVersion: REQUIRED_VERSION,
        schema: 1,
        unsigned: true,
        ...identity,
        bytes: zip.length,
        entries: [...files]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([name, bytes]) => ({
                bytes: bytes.length,
                path: name,
                sha256: sha256(bytes),
            })),
        installerSha256: sha256(installer),
        modea,
        sha256: sha256(zip),
    };
    return { installer, metadata, zip };
}

function verifyPackage(root, directory, expectedIdentity) {
    const result = python(
        root,
        `
import json, pathlib, runpy, sys
module = runpy.run_path(sys.argv[1])
directory = pathlib.Path(sys.argv[2])
meta, files = module['verify_unsigned'](directory / module['UNSIGNED_NAME'], directory / module['METADATA_NAME'], directory / module['CHECKSUM_NAME'])
print(json.dumps({'metadata':meta, 'config':files['config.xml'].decode(), 'icon':module['digest'](files['icon.png'])}))
`,
        [path.join(root, "scripts/tizen-install.py"), directory]
    );
    const verified = JSON.parse(result.toString("utf8"));
    const metadata = verified.metadata;
    const identity = validateIdentity(metadata);
    if (expectedIdentity)
        assert.deepEqual(
            identity,
            validateIdentity(expectedIdentity),
            "Wrong release identity"
        );
    assert.equal(
        verified.config,
        configBytes(root, identity).toString("utf8"),
        "Wrong package configuration"
    );
    assert.equal(
        verified.icon,
        sha256(readRegular(path.join(root, "tizen/icon.png"))),
        "Wrong package icon"
    );
    assert.equal(
        metadata.installerSha256,
        sha256(readRegular(path.join(directory, NAMES.installer))),
        "Wrong installer helper"
    );
    assert.equal(
        metadata.installerSha256,
        sha256(readRegular(path.join(root, "scripts/tizen-install.py"))),
        "Installer differs from source"
    );
    const expected = classicFiles(root, identity);
    assert.deepEqual(metadata.modea, expected.modea, "Wrong Mode A candidate");
    assert.deepEqual(
        metadata.entries,
        [...expected.files]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([name, bytes]) => ({
                bytes: bytes.length,
                path: name,
                sha256: sha256(bytes),
            })),
        "Package differs from the source Mode A candidate"
    );
    return metadata;
}

function outputDirectory(root) {
    let directory = root;
    for (const component of ["build", "packages"]) {
        directory = path.join(directory, component);
        if (!fs.existsSync(directory)) fs.mkdirSync(directory);
        const info = fs.lstatSync(directory);
        assert(
            info.isDirectory() && !info.isSymbolicLink(),
            "Unsafe output directory"
        );
    }
    return directory;
}

function writeProduct(root, identity) {
    const product = buildBytes(root, identity);
    const directory = outputDirectory(root);
    const outputs = [
        [NAMES.wgt, product.zip],
        [NAMES.metadata, jsonBytes(product.metadata)],
        [
            NAMES.checksum,
            Buffer.from(product.metadata.sha256 + "  " + NAMES.wgt + "\n"),
        ],
        [NAMES.installer, product.installer],
    ];
    for (const [name] of outputs) {
        try {
            const info = fs.lstatSync(path.join(directory, name));
            assert(
                info.isFile() && !info.isSymbolicLink(),
                "Unsafe existing output file"
            );
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
    for (const [name, bytes] of outputs) {
        const descriptor = fs.openSync(
            path.join(directory, name),
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
    return verifyPackage(root, directory, identity);
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
                "Usage: package-tizen.cjs [--verify] (--local | --plan PATH)"
            );
    }
    assert(!local || !plan, "--local and --plan are mutually exclusive");
    const identity = local ? localIdentity(root) : identityFromPlan(root, plan);
    const result = verify
        ? verifyPackage(root, path.join(root, "build/packages"), identity)
        : writeProduct(root, identity);
    if (!local)
        assert.deepEqual(
            identityFromPlan(root, plan),
            identity,
            "Release source changed during packaging"
        );
    console.log(
        (verify ? "Verified " : "Packaged ") +
            NAMES.wgt +
            " (" +
            result.tizenVersion +
            ", unsigned)"
    );
    return result;
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error("Tizen packaging failed: " + error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    APP_ID,
    adaptIndex,
    buildBytes,
    classicFiles,
    configBytes,
    identityFromPlan,
    localIdentity,
    MARKER,
    MAX_BYTES,
    main,
    NAMES,
    NOTICE_FILES,
    PACKAGE_ID,
    PROFILE,
    projectIdentity,
    REQUIRED_VERSION,
    validateIdentity,
    verifyPackage,
    versionForBuild,
    writeProduct,
};

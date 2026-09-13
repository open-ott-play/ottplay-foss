#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parse } = require("acorn");
const { inlineScripts } = require("./html-scripts.cjs");
const { PLAY_PROVIDERS } = require("./android-distribution.cjs");
const { containsPrivateUse } = require("./play-system-icons.cjs");
const { auditNativeRuntime } = require("./native-runtime.cjs");

function auditAssets(directory, flavor) {
    assert(
        ["full", "play"].includes(flavor),
        "Expected full or play distribution"
    );
    const read = (file) => fs.readFileSync(path.join(directory, file), "utf8");
    const config = JSON.parse(read("capacitor.config.json"));
    const manifest = JSON.parse(read("public/android-distribution.json"));
    const appId = "play.ott.foss" + (flavor === "play" ? ".play" : "");
    auditNativeRuntime(path.join(directory, "public"));
    assert.equal(config.appId, appId);
    assert.equal(manifest.applicationId, appId);
    assert.equal(manifest.distribution, flavor);
    assert(
        read("public/third-party-notices.txt").includes("jQuery"),
        "Third-party attribution is missing"
    );
    for (const license of [
        "project-MIT.txt",
        "Apache-2.0.txt",
        "Capacitor-App-8.1.1-LICENSE.txt",
        "Cordova-14.0.1-NOTICE.txt",
    ]) {
        assert(
            read("public/licenses/" + license).length > 100,
            "License text is missing: " + license
        );
    }
    assert(
        !config.server?.url && !config.server?.allowNavigation?.length,
        "Remote app code is forbidden"
    );
    assert(
        JSON.parse(read("capacitor.plugins.json")).some(
            (p) => p.classpath === "com.capacitorjs.plugins.app.AppPlugin"
        )
    );
    const bundle = read("public/dist/stbPlayer.js");
    assert.equal(
        bundle,
        read("public/stbPlayer.js"),
        "Nested boot bundle must match"
    );
    assert(
        bundle.includes('providerDistribution="' + flavor + '"'),
        "Runtime distribution mismatch"
    );
    const playerAssets = fs.readdirSync(
        path.join(directory, "public/stbPlayer")
    );
    assert.equal(
        playerAssets.includes("icon.png"),
        flavor === "full",
        "Startup icon must be present only in Full"
    );
    assert(playerAssets.includes("1280.css"), "Player stylesheet is missing");
    for (const name of playerAssets) {
        assert(
            (flavor === "full" && name === "icon.png") ||
                name === "1280.css" ||
                /^_.*\.js$/i.test(name),
            "Unused or unreviewed player asset in package: " + name
        );
    }
    const providers = fs
        .readdirSync(path.join(directory, "public/prov"))
        .sort();
    if (flavor === "play") {
        assert(
            read("public/stbPlayer/1280.css").includes(".system-icons") &&
                read("public/stbPlayer/1280.css").includes("sans-serif"),
            "Play must use system text symbols"
        );
        assert(
            !bundle.includes("/stbPlayer/icon.png"),
            "Play must not contain startup-logo rendering code"
        );
        assert(
            !fs.existsSync(path.join(directory, "public/favicon.ico")) &&
                !read("public/index.html").includes("favicon.ico"),
            "Play must not package or reference the legacy favicon"
        );
        assert.deepEqual(
            fs.readdirSync(path.join(directory, "public/stb")).sort(),
            ["android", "pc"]
        );
        assert(
            read("public/privacy-policy.txt").includes(
                "liminal-sketch-vv8r.here.now/demo/"
            ),
            "Demo data flow must be disclosed offline"
        );
        assert.deepEqual(providers, PLAY_PROVIDERS);
        // Catch a hidden catalog even if it is absent from the packaged prov tree.
        for (const label of [
            "OTTCLUB",
            "iLookTV",
            "cbilling",
            "sharavoz",
            "ottprime",
            "diamondtv",
        ]) {
            assert(
                !bundle.includes(label),
                "Branded provider code retained: " + label
            );
        }
        for (const provider of providers) {
            assert.deepEqual(
                fs
                    .readdirSync(path.join(directory, "public/prov", provider))
                    .sort(),
                provider === "demo"
                    ? ["about.html", "about_rus.html", "prov.js"]
                    : ["about.html", "prov.js"]
            );
        }
    } else {
        assert(
            providers.includes("edem") && providers.includes("ottclub"),
            "Full catalog is missing"
        );
    }
    let checked = 0;
    function scan(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            assert(!entry.isSymbolicLink(), "Symlink in packaged assets");
            assert(
                !entry.name.startsWith("."),
                "Private file in packaged assets"
            );
            const file = path.join(dir, entry.name);
            if (flavor === "play" && entry.isFile()) {
                assert(
                    !/fontello/i.test(entry.name),
                    "Icon font file retained in Play"
                );
                assert(
                    !/\.(map|ts|tsx|zip|apk|aab|mp4|ts)$/i.test(entry.name),
                    "Unreviewed source/archive/media asset"
                );
                if (/\.(js|html|css)$/i.test(entry.name)) {
                    const text = fs.readFileSync(file, "utf8");
                    assert(
                        !/ipify\.org/i.test(text),
                        "Play must not contain public-IP lookup code: " +
                            entry.name
                    );
                    const vendor = path
                        .relative(path.join(directory, "public"), file)
                        .startsWith("js" + path.sep);
                    assert(
                        !/fontello/i.test(text) &&
                            (vendor || !containsPrivateUse(text)),
                        "Bundled icon font or private-use symbol retained in Play: " +
                            entry.name
                    );
                    assert(
                        !/\b(?:OTTCLUB|iLookTV|cbilling|sharavoz|ottprime|diamondtv|edem|shura)\b/i.test(
                            text
                        ),
                        "Branded code or content outside provider catalog: " +
                            entry.name
                    );
                }
            }
            if (entry.isDirectory()) scan(file);
            else if (entry.name.endsWith(".js")) {
                parse(fs.readFileSync(file, "utf8"), {
                    ecmaVersion: "latest",
                    sourceType: "script",
                });
                checked++;
            } else if (entry.name.endsWith(".html")) {
                for (const script of inlineScripts(
                    fs.readFileSync(file, "utf8")
                )) {
                    parse(script, {
                        ecmaVersion: "latest",
                        sourceType: "script",
                    });
                }
            }
        }
    }
    scan(path.join(directory, "public"));
    console.log(
        "PASS " +
            flavor +
            ": package identity, providers, pinned native code and system fonts (" +
            checked +
            " scripts)"
    );
}

function auditTarget(target, flavor) {
    if (fs.statSync(target).isDirectory()) return auditAssets(target, flavor);
    if (target.endsWith(".aab")) {
        const { ensureBundletool } = require("./android/ensure-bundletool.cjs");
        execFileSync(
            "python3",
            [
                path.join(__dirname, "android/verify-bundle-manifest.py"),
                path.resolve(target),
                flavor,
                "--bundletool",
                ensureBundletool(),
            ],
            { stdio: "inherit" }
        );
    }
    const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), "ottplay-package-audit-")
    );
    try {
        // Extract only assets from the APK/AAB with traversal and duplicate checks.
        execFileSync(
            "python3",
            [
                "-c",
                [
                    "import pathlib, sys, zipfile",
                    "root = pathlib.Path(sys.argv[2])",
                    "seen = set()",
                    "with zipfile.ZipFile(sys.argv[1]) as archive:",
                    " for info in archive.infolist():",
                    "  name = info.filename",
                    "  prefix = 'base/assets/' if name.startswith('base/assets/') else 'assets/'",
                    "  if not name.startswith(prefix) or info.is_dir(): continue",
                    "  relative = pathlib.PurePosixPath(name[len(prefix):])",
                    "  assert not relative.is_absolute() and '..' not in relative.parts",
                    "  assert str(relative) not in seen, 'Duplicate asset'",
                    "  seen.add(str(relative))",
                    "  output = root.joinpath(*relative.parts)",
                    "  output.parent.mkdir(parents=True, exist_ok=True)",
                    "  output.write_bytes(archive.read(info))",
                ].join("\n"),
                path.resolve(target),
                temporary,
            ],
            { stdio: "inherit" }
        );
        auditAssets(temporary, flavor);
    } finally {
        fs.rmSync(temporary, { force: true, recursive: true });
    }
}
if (require.main === module) {
    try {
        auditTarget(process.argv[2], process.argv[3]);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
module.exports = { auditAssets, auditTarget };

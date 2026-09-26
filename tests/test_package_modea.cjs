const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CLASSIC_PROVIDER_BUNDLES } = require("../scripts/classic-bundle.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-package-test-"));
try {
    const git = (...args) =>
        execFileSync(
            "git",
            [
                "-c",
                "core.hooksPath=" + path.join(root, "empty-hooks"),
                "-c",
                "commit.gpgSign=false",
                "-c",
                "tag.gpgSign=false",
                ...args,
            ],
            {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            }
        ).trim();
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(
        path.join(__dirname, "../scripts/package-modea.cjs"),
        path.join(root, "scripts/package-modea.cjs")
    );
    fs.writeFileSync(
        path.join(root, "scripts/classic-bundle.cjs"),
        "module.exports = " +
            JSON.stringify({ CLASSIC_PROVIDER_BUNDLES }) +
            ";\n"
    );
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ version: "1.2.3" })
    );
    for (const directory of ["fonts", "js", "stb", "stbPlayer", "prov"])
        fs.mkdirSync(path.join(root, "dist", directory), { recursive: true });
    const bundle = "var fixture = true;\n";
    fs.writeFileSync(
        path.join(root, "dist/index.html"),
        "<!doctype html><title>fixture</title>"
    );
    fs.writeFileSync(path.join(root, "dist/stbPlayer.js"), bundle);
    const providerBundles = Object.keys(CLASSIC_PROVIDER_BUNDLES).map(
        (kind) => {
            const file = "provider-" + kind + ".js";
            const bytes = Buffer.from(
                'var providerFixture = "' + kind + '";\n'
            );
            fs.writeFileSync(path.join(root, "dist", file), bytes);
            return { bytes, file, kind };
        }
    );
    fs.writeFileSync(path.join(root, "dist/provider-obsolete.js"), "stale");
    fs.writeFileSync(path.join(root, "dist/favicon.ico"), "icon");
    const browserAssets = path.resolve(__dirname, "../js/browser-app");
    fs.cpSync(browserAssets, path.join(root, "dist/js/browser-app"), {
        recursive: true,
    });
    git("init", "--quiet");
    git("add", ".");
    git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Tagged package"
    );
    const taggedSha = git("rev-parse", "HEAD");
    git("tag", "v1.2.3");
    fs.writeFileSync(
        path.join(root, "event-only.txt"),
        "Dispatch ref differs from package ref"
    );
    git("add", ".");
    git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Event ref"
    );
    const eventSha = git("rev-parse", "HEAD");
    git("checkout", "--quiet", "v1.2.3");
    const packageAndRead = () => {
        execFileSync(process.execPath, ["scripts/package-modea.cjs"], {
            cwd: root,
            env: { ...process.env, GITHUB_SHA: eventSha },
            stdio: "pipe",
        });
        const archive = path.join(
            root,
            "build/packages/ottplay-foss-modea.tar.gz"
        );
        return JSON.parse(
            execFileSync("tar", ["-xOf", archive, "./build-info.json"], {
                encoding: "utf8",
            })
        );
    };
    const metadata = packageAndRead();
    assert.equal(metadata.revision, taggedSha);
    assert.notEqual(metadata.revision, eventSha);
    assert.equal(metadata.version, "1.2.3");
    assert.equal(
        metadata.bundleSha256,
        createHash("sha256").update(bundle).digest("hex")
    );
    const archive = path.join(root, "build/packages/ottplay-foss-modea.tar.gz");
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
        .trim()
        .split("\n");
    assert.deepEqual(
        Object.keys(metadata.providerBundles).sort(),
        Object.keys(CLASSIC_PROVIDER_BUNDLES).sort()
    );
    for (const { bytes, file, kind } of providerBundles) {
        const entry = "./dist/" + file;
        assert.equal(
            entries.filter((name) => name === entry).length,
            1,
            "Package each provider family exactly once: " + kind
        );
        assert.deepEqual(execFileSync("tar", ["-xOf", archive, entry]), bytes);
        assert.deepEqual(metadata.providerBundles[kind], {
            bytes: bytes.length,
            file: "dist/" + file,
            sha256: createHash("sha256").update(bytes).digest("hex"),
        });
    }
    assert.equal(entries.includes("./dist/provider-obsolete.js"), false);
    for (const [file, entry] of [
        ["manifest.webmanifest", "/"],
        ["index.webmanifest", "/index.html"],
        ["pc.webmanifest", "/f/pc/"],
        ["pc-plain.webmanifest", "/f/pc"],
    ]) {
        const bytes = execFileSync("tar", [
            "-xOf",
            archive,
            "./js/browser-app/" + file,
        ]);
        assert.deepEqual(
            bytes,
            fs.readFileSync(path.join(browserAssets, file))
        );
        const manifest = JSON.parse(bytes);
        assert.equal(manifest.id, entry, "Keep installed shortcut identity");
        assert.equal(
            manifest.start_url,
            entry,
            "Keep the selected device route"
        );
        assert.equal(manifest.scope, "/");
        assert.equal(manifest.lang, "en");
        assert.equal(manifest.display, "standalone");
        assert.deepEqual(manifest.display_override, [
            "window-controls-overlay",
        ]);
        assert.deepEqual(manifest.icons, [
            {
                purpose: "any",
                sizes: "512x512",
                src: "/js/browser-app/icon-512.png",
                type: "image/png",
            },
        ]);
    }
    const icon = execFileSync("tar", [
        "-xOf",
        archive,
        "./js/browser-app/icon-512.png",
    ]);
    assert.deepEqual(
        icon,
        fs.readFileSync(path.join(browserAssets, "icon-512.png"))
    );
    assert.deepEqual(
        icon.subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
    assert.equal(icon.readUInt32BE(16), 512);
    assert.equal(icon.readUInt32BE(20), 512);
    for (const file of ["window-controls.js", "window-controls.css"])
        assert.deepEqual(
            execFileSync("tar", ["-xOf", archive, "./js/browser-app/" + file]),
            fs.readFileSync(path.join(browserAssets, file)),
            "Package the current browser window behavior and layout: " + file
        );
    fs.rmSync(path.join(root, ".git"), { recursive: true });
    assert.equal(
        packageAndRead().revision,
        "unknown",
        "A source archive must not borrow the workflow event SHA"
    );
    for (const { bytes, file } of providerBundles) {
        const built = path.join(root, "dist", file);
        fs.unlinkSync(built);
        assert.throws(
            packageAndRead,
            (error) => error.message.includes("Missing dist/" + file),
            "An absent provider family must fail packaging: " + file
        );
        fs.mkdirSync(built);
        assert.throws(
            packageAndRead,
            (error) =>
                error.message.includes("Unexpected file type: dist/" + file),
            "A provider directory must not masquerade as a built script: " +
                file
        );
        fs.rmdirSync(built);
        fs.writeFileSync(built, bytes);
    }
    for (const file of [
        "pc.webmanifest",
        "window-controls.js",
        "window-controls.css",
    ]) {
        const staged = path.join(root, "dist/js/browser-app", file);
        fs.unlinkSync(staged);
        assert.throws(
            packageAndRead,
            (error) =>
                error.message.includes("Missing dist/js/browser-app/" + file),
            "Missing built installation assets must fail packaging: " + file
        );
        fs.copyFileSync(path.join(browserAssets, file), staged);
    }
    console.log(
        "PASS actual Mode A archive metadata and browser installation assets: checked-out tag, main/provider hashes and bytes, unique provider entries, required asset rejection, route identity, icon/helper/CSS bytes, no misleading event-SHA fallback"
    );
} finally {
    fs.rmSync(root, { force: true, recursive: true });
}

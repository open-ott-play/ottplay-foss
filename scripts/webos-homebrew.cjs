#!/usr/bin/env node
// Publish a Homebrew Channel index for the exact verified release package.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repository = "https://github.com/open-ott-play/ottplay-foss";
const metadataOrigin = "https://ottplay-webos.igw-2560801.workers.dev";
const names = {
    description: "ottplay-foss-webos-description.html",
    icon: "ottplay-foss-webos-icon.png",
    ipk: "ottplay-foss-webos.ipk",
    manifest: "ottplay-foss-webos-manifest.json",
    metadata: "ottplay-foss-webos.json",
    repository: "ottplay-foss-webos-repository.json",
};

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
        return {
            "'": "&#39;",
            '"': "&quot;",
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
        }[character];
    });
}

function documents(metadata) {
    assert.equal(
        metadata.local,
        false,
        "Local packages cannot enter a release feed"
    );
    assert.equal(metadata.appId, "com.openottplay.player");
    assert.match(metadata.source, /^[a-f0-9]{40}$/);
    assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
    assert.match(
        metadata.releaseTag,
        /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:beta|rc)\.[1-9]\d*|-nightly\.\d{14}\.[1-9]\d*\.[1-9]\d*)?$/
    );
    assert(Number.isSafeInteger(metadata.buildNumber));
    assert(metadata.buildNumber > 0 && metadata.buildNumber <= 999999999);
    assert.equal(metadata.webosVersion, "1.0." + metadata.buildNumber);
    assert(Number.isSafeInteger(metadata.bytes) && metadata.bytes > 0);
    assert(
        Number.isSafeInteger(metadata.installedSize) &&
            metadata.installedSize > 0
    );
    const base = repository + "/releases/download/" + metadata.releaseTag + "/";
    // Homebrew reads metadata with browser XHR; GitHub release redirects lack CORS.
    const metadataBase = metadataOrigin + "/v1/" + metadata.releaseTag + "/";
    const title = "OTT-play FOSS";
    const manifest = {
        appDescription:
            "Hosted IPTV and media player. Network connection required.",
        iconUri: metadataBase + names.icon,
        id: metadata.appId,
        installedSize: metadata.installedSize,
        ipkHash: { sha256: metadata.sha256 },
        ipkSize: metadata.bytes,
        ipkUrl: base + names.ipk,
        rootRequired: false,
        sourceUrl: repository + "/tree/" + metadata.source,
        title,
        type: "web",
        version: metadata.webosVersion,
    };
    const index = {
        packages: [
            {
                fullDescriptionUrl: metadataBase + names.description,
                iconUri: metadataBase + names.icon,
                id: metadata.appId,
                manifestUrl: metadataBase + names.manifest,
                shortDescription:
                    "Hosted IPTV and media player. Network connection required.",
                title,
            },
        ],
    };
    const description =
        '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        "<title>OTT-play FOSS for LG webOS</title></head><body>" +
        "<h1>OTT-play FOSS</h1><p>A hosted web player installed as a TV app. " +
        'It opens <a href="https://player.ottplay.here.now/">player.ottplay.here.now</a> ' +
        "and requires a working network connection. Hosted player updates and IPK updates are separate.</p>" +
        "<p>Package " +
        escapeHtml(metadata.releaseTag) +
        "; webOS version " +
        escapeHtml(metadata.webosVersion) +
        ".</p>" +
        "<p>Use Developer Mode or an already installed Homebrew Channel. " +
        "No root access or background service is required by this app. " +
        "Playback formats depend on your TV and media source.</p>" +
        '<p><a href="' +
        repository +
        "/blob/" +
        metadata.source +
        '/docs/lg-webos-installation.md">Installation and update guide</a></p>' +
        "</body></html>\n";
    return {
        [names.manifest]: JSON.stringify(manifest, null, 2) + "\n",
        [names.repository]: JSON.stringify(index, null, 2) + "\n",
        [names.description]: description,
    };
}

function generate(root, planPath) {
    const { identityFromPlan, verifyPackage } = require("./package-webos.cjs");
    const identity = identityFromPlan(root, planPath);
    const directory = path.join(root, "build/packages");
    for (const folder of [path.join(root, "build"), directory])
        assert(
            fs.lstatSync(folder).isDirectory(),
            "Feed output directory must not be a symlink"
        );
    const metadata = verifyPackage(
        path.join(directory, names.ipk),
        path.join(directory, names.metadata),
        identity
    );
    const outputs = documents(metadata);
    const iconPath = path.join(root, "webos/largeIcon.png");
    assert(fs.lstatSync(iconPath).isFile(), "Feed icon must be a regular file");
    const icon = fs.readFileSync(iconPath);
    assert.equal(
        createHash("sha256").update(icon).digest("hex"),
        metadata.largeIconSha256,
        "Feed icon differs from the verified package"
    );
    outputs[names.icon] = icon;
    for (const name of Object.keys(outputs)) {
        const target = path.join(directory, name);
        const info = fs.lstatSync(target, { throwIfNoEntry: false });
        assert(!info || info.isFile(), "Feed output must be a regular file");
    }
    for (const [name, content] of Object.entries(outputs)) {
        const descriptor = fs.openSync(
            path.join(directory, name),
            fs.constants.O_WRONLY |
                fs.constants.O_CREAT |
                fs.constants.O_TRUNC |
                (fs.constants.O_NOFOLLOW || 0),
            0o644
        );
        try {
            fs.writeFileSync(descriptor, content);
        } finally {
            fs.closeSync(descriptor);
        }
    }
    return Object.keys(outputs);
}

if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        assert(
            args.length === 2 && args[0] === "--plan",
            "Usage: webos-homebrew.cjs --plan PATH"
        );
        const root = path.resolve(__dirname, "..");
        const written = generate(root, path.resolve(args[1]));
        console.log("Homebrew Channel release files: " + written.join(", "));
    } catch (error) {
        console.error("Homebrew Channel packaging failed: " + error.message);
        process.exitCode = 1;
    }
}

module.exports = { documents, generate, names };

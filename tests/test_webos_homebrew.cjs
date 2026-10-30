const assert = require("node:assert/strict");
const { documents, names } = require("../scripts/webos-homebrew.cjs");

const fixture = {
    appId: "com.openottplay.player",
    buildNumber: 10527,
    bytes: 8192,
    installedSize: 16384,
    local: false,
    packageVersion: "1.1.62-beta.3",
    releaseTag: "v1.1.62-beta.3",
    sha256: "cd".repeat(32),
    source: "ab".repeat(20),
    webosVersion: "1.0.10527",
};
const generated = documents(fixture);
const index = JSON.parse(generated[names.repository]);
const manifest = JSON.parse(generated[names.manifest]);
assert.equal(index.packages.length, 1);
assert.equal(index.packages[0].id, manifest.id);
assert.equal(index.packages[0].iconUri, manifest.iconUri);
assert(index.packages[0].shortDescription.length <= 80);
const prefix =
    "https://github.com/open-ott-play/ottplay-foss/releases/download/v1.1.62-beta.3/";
assert.equal(index.packages[0].manifestUrl, prefix + names.manifest);
assert.equal(index.packages[0].fullDescriptionUrl, prefix + names.description);
assert.equal(manifest.ipkUrl, prefix + names.ipk);
assert.equal(manifest.iconUri, prefix + names.icon);
assert.equal(manifest.ipkHash.sha256, fixture.sha256);
assert.equal(manifest.ipkSize, 8192);
assert.equal(manifest.installedSize, 16384); // Manifest units are bytes, not control-file KiB.
assert.equal(manifest.rootRequired, false);
assert.equal(manifest.type, "web");
assert.equal(manifest.version, "1.0.10527");
assert.equal(
    manifest.sourceUrl,
    "https://github.com/open-ott-play/ottplay-foss/tree/" + fixture.source
);
assert(
    generated[names.description].includes(
        "requires a working network connection"
    )
);
assert(generated[names.description].includes("player.ottplay.here.now"));
assert(!JSON.stringify(generated).includes("releases/latest"));

// A later beta advances the package manager version without changing the app ID.
const next = JSON.parse(
    documents({
        ...fixture,
        buildNumber: 10528,
        packageVersion: "1.1.62-beta.4",
        releaseTag: "v1.1.62-beta.4",
        webosVersion: "1.0.10528",
    })[names.manifest]
);
assert.equal(next.id, manifest.id);
assert(
    Number(next.version.split(".")[2]) > Number(manifest.version.split(".")[2])
);

// Promotion uploads these same documents: every dependency remains available at the RC tag.
const rc = documents({
    ...fixture,
    packageVersion: "1.1.62",
    releaseTag: "v1.1.62-rc.1",
});
assert(JSON.parse(rc[names.manifest]).ipkUrl.includes("/v1.1.62-rc.1/"));
assert.deepEqual(
    rc,
    documents({
        ...fixture,
        packageVersion: "1.1.62",
        releaseTag: "v1.1.62-rc.1",
    })
);
for (const change of [
    { local: true },
    { appId: "com.other.player" },
    { source: "not-a-commit" },
    { sha256: "not-a-digest" },
    { releaseTag: "../other" },
    { releaseTag: "v1.1.62?bad=1" },
    { webosVersion: "1.1.62-beta.3" },
    { buildNumber: 1000000000, webosVersion: "1.0.1000000000" },
    { buildNumber: 0, webosVersion: "1.0.0" },
    { bytes: 0 },
    { installedSize: 0 },
])
    assert.throws(() => documents({ ...fixture, ...change }));
console.log(
    "PASS webOS Homebrew release URLs, manifest units, identity and version ordering"
);

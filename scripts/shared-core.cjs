"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const engineLicenses = ["rquickjs-LICENSE.txt", "QuickJS-NG-LICENSE.txt"];
const files = ["ottplay-core.js", "ottplay-core.LICENSE.txt"];
function check() {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(root, "vendor/ottplay-core.manifest.json"))
    );
    assert.equal(manifest.name, "ottplay-shared-core");
    assert.match(manifest.source.sha256, /^[a-f0-9]{64}$/);
    for (const file of files) {
        const bytes = fs.readFileSync(path.join(root, "vendor", file));
        assert.equal(
            digest(bytes),
            manifest.artifacts[file].sha256,
            "Modified shared core: " + file
        );
    }
}
function stage(destination = root) {
    check();
    fs.mkdirSync(path.join(destination, "js/licenses"), { recursive: true });
    for (const file of engineLicenses)
        fs.copyFileSync(
            path.join(root, "licenses/native", file),
            path.join(destination, "js/licenses", file)
        );
    for (const file of [...files, "ottplay-core.manifest.json"])
        fs.copyFileSync(
            path.join(root, "vendor", file),
            path.join(destination, "js", file)
        );
}
function checkStaged(directory) {
    check();
    for (const file of [...files, "ottplay-core.manifest.json"])
        assert.equal(
            digest(fs.readFileSync(path.join(directory, "js", file))),
            digest(fs.readFileSync(path.join(root, "vendor", file))),
            "Stale staged shared core: " + file
        );
    for (const file of engineLicenses)
        assert.equal(
            digest(fs.readFileSync(path.join(directory, "js/licenses", file))),
            digest(fs.readFileSync(path.join(root, "licenses/native", file))),
            "Missing native engine notice: " + file
        );
}
module.exports = { check, checkStaged, stage };
if (require.main === module) {
    check();
    require("node:child_process").execFileSync(
        process.execPath,
        [path.join(root, "scripts/generate-m3u-user-agents.cjs"), "--check"],
        { cwd: root, stdio: "inherit" }
    );
    // Bulk library/reference migration is performance-held; its local host paths
    // are exercised separately until the full-state ABI is qualified.
    for (const [file, apis, displaced] of [
        [
            "src/settings/cloud-codec.ts",
            ["readClassicCloudStorage", "cloudStorageEntry"],
            /function cloudCodecEncode/,
        ],
        [
            "src/offline/playback-selection.ts",
            ["localSourceScanStatus"],
            /row.generation > 9007199254740991/,
        ],
        [
            "src/provider/source-identity.ts",
            ["utf16Dual32Fingerprint"],
            /2166136261/,
        ],
        [
            "src/settings/global-favorites-portable.ts",
            ["createClassicGlobalFavoritesPortableCodec"],
            /function locatorKey/,
        ],
        [
            "src/guide/reminders.ts",
            [
                "classicReminderValid",
                "classicReminderAction",
                "classicReminderNext",
            ],
            /Math\.ceil\(\(record\.start - now\)/,
        ],
        [
            "src/playback/live-recovery.ts",
            ["classicLiveStallLimits", "classicLiveStallPlan"],
            /Math\.ceil\(\(limit\.timeout - age\)/,
        ],
        [
            "src/core/index.ts",
            [
                "classicPlaybackMode",
                "classicPlaybackAutoMode",
                "PlaybackRecovery",
            ],
            /var _networkRetries|var _mediaRecovered|var _liveRestartUsed/,
        ],
        [
            "src/channels/favorites-lists.ts",
            [
                "favoriteListChange",
                "loadClassicFavoriteLists",
                "favoriteListOrder",
            ],
            /favoritesLists\.order\.splice/,
        ],
        [
            "providers/edem/provider.js",
            ["OperatorPortalCatalogClient", "operatorPortalNavigate"],
            /JSON\.stringify\(data\.items/,
        ],
        [
            "src/storage/index.ts",
            [
                "classicPortableKey",
                "classicPortableSnapshot",
                "classicInstallationState",
            ],
            /const INSTALLATION_SETTINGS/,
        ],
        [
            "src/provider/operator.ts",
            ["OperatorPlaylistClient", "OperatorClient", "operatorVodCatalog"],
            /function addChan2cat/,
        ],
    ]) {
        const source = fs.readFileSync(path.join(root, file), "utf8");
        for (const api of apis)
            assert(source.includes("." + api + "("), file + " must use " + api);
        assert(
            !displaced.test(source),
            "Displaced domain implementation reintroduced: " + file
        );
    }
    console.log("PASS shared core distribution receipt");
}

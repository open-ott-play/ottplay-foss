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
    console.log("PASS shared core distribution receipt");
}

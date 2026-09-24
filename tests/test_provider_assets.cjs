const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    isManagedProviderScript,
    managedProviderIds,
} = require("../scripts/provider-assets.cjs");
const { stagePlayProviders } = require("../scripts/android-distribution.cjs");
const root = path.resolve(__dirname, "..");
const ids = managedProviderIds();
assert.equal(ids.length, 40);
for (const id of ["bestlist/stalker", "1ott", "only4", "shara-tv", "tvteam"])
    assert(ids.includes(id), "new independent driver asset boundary: " + id);
function compatibilityProviders(directory, prefix = "") {
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const name = prefix ? prefix + "/" + entry.name : entry.name;
            if (entry.isDirectory())
                return compatibilityProviders(
                    path.join(directory, entry.name),
                    name
                );
            return entry.name === "prov.js" && !ids.includes(prefix)
                ? [prefix]
                : [];
        });
}
assert.deepEqual(compatibilityProviders(path.join(root, "prov")).sort(), [
    "antifriz",
    "edem",
    "itv",
    "kb-team",
    "m3u",
    "ottclub",
    "shura",
    "stalker",
]);
assert(ids.includes("demo") && ids.includes("xtream"));
for (const id of ids) {
    assert.equal(
        isManagedProviderScript(path.join(root, "prov", id, "prov.js")),
        true
    );
    assert.equal(
        isManagedProviderScript(
            "C:\\runtime\\prov\\" + id.replace(/\//g, "\\") + "\\prov.js"
        ),
        true
    );
    assert.equal(
        isManagedProviderScript(path.join(root, "prov", id, "logo.png")),
        false
    );
    assert.equal(
        isManagedProviderScript(path.join(root, "prov", id, "about.html")),
        false
    );
}
assert.equal(isManagedProviderScript("prov/m3u/prov.js"), false);
assert.equal(isManagedProviderScript("prov/stalker/prov.js"), false);
assert.equal(isManagedProviderScript("prov/unknown/prov.js"), false);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-driver-assets-"));
try {
    stagePlayProviders(root, stage);
    for (const id of ["demo", "xtream"]) {
        assert(
            !fs.existsSync(path.join(stage, id, "prov.js")),
            "Play does not ship retired executable " + id
        );
        assert(
            fs.existsSync(path.join(stage, id, "about.html")),
            "UI metadata remains available"
        );
    }
    for (const id of ["m3u", "stalker"])
        assert(fs.existsSync(path.join(stage, id, "prov.js")));
} finally {
    fs.rmSync(stage, { force: true, recursive: true });
}
if (process.argv.includes("--bundle")) {
    for (const target of ["dist", "dist-mobile", "src-tauri/frontend"]) {
        assert(
            fs.existsSync(path.join(root, target)),
            "Missing built artifact: " + target
        );
        for (const id of ids)
            assert(
                !fs.existsSync(path.join(root, target, "prov", id, "prov.js")),
                target + " still contains retired script " + id
            );
        for (const id of ["m3u", "stalker"])
            assert(
                fs.existsSync(path.join(root, target, "prov", id, "prov.js")),
                target + " missing retained compatibility driver " + id
            );
    }
}
console.log(
    "PASS provider assets: " +
        ids.length +
        " managed scripts excluded, retained compatibility and UI assets preserved" +
        (process.argv.includes("--bundle") ? " in all built roots" : "")
);

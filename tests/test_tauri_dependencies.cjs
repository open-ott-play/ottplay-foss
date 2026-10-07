const assert = require("node:assert/strict");
const {
    checkDependencies,
    readDependencies,
} = require("../scripts/check-tauri-dependencies.cjs");

const current = readDependencies();
checkDependencies(current);
function rejects(change, message) {
    const fixture = structuredClone(current);
    change(fixture);
    assert.throws(() => checkDependencies(fixture), message);
}

// Both direct updater updates and its transitive API updates can break the
// native protocol, even when npm installs successfully.
for (const name of ["@tauri-apps/plugin-updater", "@tauri-apps/api"]) {
    rejects((f) => {
        const location = Object.keys(f.npmLock.packages).find((key) =>
            key.endsWith(`node_modules/${name}`)
        );
        f.npmLock.packages[location].version = "2.99.0";
    }, /must match Rust/);
}
rejects((f) => {
    f.npmLock.packages["node_modules/nested/node_modules/@tauri-apps/api"] = {
        version: "2.99.0",
    };
}, /must match Rust/);
rejects((f) => {
    f.cargoLock = f.cargoLock.replace(
        /name = "tauri-plugin-updater"\nversion = "[^"]+"/,
        'name = "tauri-plugin-updater"\nversion = "2.99.0"'
    );
}, /must match Rust/);

for (const [name, version] of [
    ["wry", "0.55.1"],
    ["tao", "0.35.3"],
    ["glib", "0.18.5"],
]) {
    const entry = `name = "${name}"\nversion = "${version}"`;
    // Keeping the patch stanza must not mask a registry-resolved package.
    rejects((f) => {
        f.cargoLock = f.cargoLock.replace(
            entry,
            entry +
                '\nsource = "registry+https://github.com/rust-lang/crates.io-index"'
        );
    }, /must resolve locally/);
    // Cargo can leave a retired path patch under [[patch.unused]]. It is not
    // a selected package, even if its name/version still appears in the lock.
    rejects((f) => {
        f.cargoLock = f.cargoLock.replace(
            `[[package]]\n${entry}`,
            `[[patch.unused]]\n${entry}`
        );
    }, /must have one resolved package/);
    rejects((f) => {
        f.cargoLock += `\n[[package]]\nname = "${name}"\nversion = "99.0.0"\n`;
    }, /must have one resolved package/);
    rejects((f) => {
        f.workspace = f.workspace.replace(
            `path = "vendor/${name}-${version}"`,
            `path = "../unreviewed/${name}"`
        );
    }, /reviewed vendor directory/);
}
console.log("PASS Tauri dependency regression and unused/registry patch cases");

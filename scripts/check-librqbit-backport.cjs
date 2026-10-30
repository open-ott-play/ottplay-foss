const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
function files(directory, prefix = "") {
    return fs.readdirSync(directory).flatMap((name) => {
        const full = path.join(directory, name);
        const entry = fs.lstatSync(full);
        assert.ok(
            !entry.isSymbolicLink(),
            "vendored source cannot use symlinks"
        );
        return entry.isDirectory()
            ? files(full, prefix + name + "/")
            : [prefix + name];
    });
}

// Reverse the documented single-file diff in memory. This verifies the exact
// change without writing to the checkout or requiring platform-specific tools.
function originalSource(patched, patch, source) {
    const input = patched.split("\n");
    const diff = patch.trimEnd().split("\n");
    assert.equal(diff.shift(), "--- a/" + source);
    assert.equal(diff.shift(), "+++ b/" + source);
    let cursor = 0;
    const output = [];
    let hunkCount = 0;
    for (let index = 0; index < diff.length; ) {
        const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(
            diff[index++]
        );
        assert.ok(hunk, "patch must contain only ordinary unified hunks");
        const next = Number(hunk[3]) - 1;
        assert.ok(next >= cursor, "patch hunks must not overlap");
        output.push(...input.slice(cursor, next));
        cursor = next;
        assert.equal(output.length, Number(hunk[1]) - 1);
        let oldCount = 0;
        let newCount = 0;
        while (index < diff.length && !diff[index].startsWith("@@ ")) {
            const line = diff[index++];
            const kind = line[0];
            assert.ok(" +-".includes(kind), "unexpected patch directive");
            if (kind !== "-") {
                assert.equal(input[cursor++], line.slice(1));
                newCount++;
            }
            if (kind !== "+") {
                output.push(line.slice(1));
                oldCount++;
            }
        }
        assert.equal(oldCount, Number(hunk[2] ?? 1));
        assert.equal(newCount, Number(hunk[4] ?? 1));
        hunkCount++;
    }
    assert.ok(hunkCount > 0, "a safety patch must be present");
    return output.concat(input.slice(cursor)).join("\n");
}

const directory = "librqbit-9.1.0";
const sourceRoot = path.join(root, "vendor", directory);
const manifest = JSON.parse(
    fs.readFileSync(sourceRoot + ".provenance.json", "utf8")
);
assert.equal(manifest.crate, "librqbit");
assert.equal(manifest.version, "9.1.0");
assert.equal(
    manifest.archiveSha256,
    "4e35a06e481e854f69141928d067406397b3ad7a47bfdc095bc31325f44f5d13"
);
assert.deepEqual(
    files(sourceRoot).sort(),
    [...Object.keys(manifest.files), ...Object.keys(manifest.addedFiles)].sort()
);
assert.deepEqual(Object.keys(manifest.patchedFiles).sort(), [
    "src/dht_utils.rs",
    "src/peer_info_reader/mod.rs",
]);
assert.deepEqual(Object.keys(manifest.addedFiles).sort(), [
    "LICENSE",
    "PATCHES.md",
]);
for (const [name, hash] of Object.entries({
    ...manifest.files,
    ...manifest.addedFiles,
})) {
    assert.equal(
        sha256(fs.readFileSync(path.join(sourceRoot, name))),
        manifest.patchedFiles[name] || hash,
        name + " hash"
    );
}
const patch = fs.readFileSync(
    path.join(root, "vendor", manifest.patch),
    "utf8"
);
assert.equal(sha256(patch), manifest.patchSha256);
const chunks = patch.split(/(?=^--- a\/)/m).filter(Boolean);
assert.equal(chunks.length, 2);
for (const chunk of chunks) {
    const source = /^--- a\/(.+)$/m.exec(chunk)[1];
    assert.ok(Object.hasOwn(manifest.patchedFiles, source));
    const patched = fs.readFileSync(path.join(sourceRoot, source), "utf8");
    assert.equal(
        sha256(originalSource(patched, chunk, source)),
        manifest.files[source],
        source + " reverses to published source"
    );
}
const cargo = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
assert.ok(
    cargo
        .split("[patch.crates-io]")[1]
        ?.includes('librqbit = { path = "vendor/librqbit-9.1.0" }')
);
const records = fs
    .readFileSync(path.join(root, "Cargo.lock"), "utf8")
    .split("[[package]]")
    .filter((record) => record.includes('\nname = "librqbit"\n'));
assert.equal(records.length, 1);
assert.ok(records[0].includes('\nversion = "9.1.0"\n'));
assert.doesNotMatch(records[0], /\n(?:source|checksum) =/);
const harness = path.join(root, "tests/librqbit-resource-regression");
const expectedManifest =
    fs
        .readFileSync(path.join(sourceRoot, "Cargo.toml"), "utf8")
        .replace(
            /^(build|readme|path) = "([^"]+)"$/gm,
            (_, key, file) => `${key} = "../../vendor/librqbit-9.1.0/${file}"`
        ) +
    "\n# Isolated harness: compile the actual vendored library tests only.\n[workspace]\n";
assert.equal(
    fs.readFileSync(path.join(harness, "Cargo.toml"), "utf8"),
    expectedManifest,
    "harness must derive from the published package without changing dependencies"
);
const productLock = fs.readFileSync(path.join(root, "Cargo.lock"), "utf8");
const harnessLock = fs.readFileSync(path.join(harness, "Cargo.lock"), "utf8");
function torrentPackages(lock) {
    return lock.split("[[package]]").flatMap((record) => {
        const name = /^name = "([^"]+)"$/m.exec(record)?.[1];
        if (!name || !name.startsWith("librqbit")) return [];
        return [
            [
                name,
                ["version", "source", "checksum"].map(
                    (key) =>
                        new RegExp(`^${key} = "([^"]+)"$`, "m").exec(
                            record
                        )?.[1] || ""
                ),
            ],
        ];
    });
}
const production = new Map(torrentPackages(productLock));
for (const [name, identity] of torrentPackages(harnessLock)) {
    if (production.has(name))
        assert.deepEqual(
            identity,
            production.get(name),
            name + " harness identity"
        );
}
console.log(
    "OK: librqbit published inventory, resource patch, license, path override and isolated harness"
);

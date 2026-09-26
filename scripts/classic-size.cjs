#!/usr/bin/env node
// Measure final artifacts, including native transformations, in UTF-8 bytes.
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gzipSync } = require("node:zlib");

// Bound the shipped outputs after settings and codec deduplication, including
// PLi-HD/Studio layouts, settings fixes and offline credit controls. Allow
// candidate-version suffixes and Node/zlib variation: CI Node 22 compresses
// these bundles less than local Node 26. ES5, persisted menu identities and
// final-artifact checks remain enforced.
// Localized keyboard paging/case-safe cells, translated menus and eight new
// selector entries add <1 KB after shared label reuse. Dictionaries stay external.
const BUDGET = Object.freeze({ bytes: 560000, gzipBytes: 168100 });
// Count every optional family as well, so moving code out of the entry bundle
// cannot disguise growth of the complete player payload.
// Classic MAG support adds ~5 KB to the optional Stalker family and a small
// cancellable URL resolver to the shared backend (including release suffix room).
const TOTAL_BUDGET = Object.freeze({ bytes: 623000, gzipBytes: 192100 });
const ARTIFACTS = Object.freeze([
    "dist/stbPlayer.js",
    "src-tauri/frontend/dist/stbPlayer.js",
    "dist-mobile/dist/stbPlayer.js",
]);

function measureBundle(source, name, budget = BUDGET) {
    const buffer = Buffer.isBuffer(source)
        ? source
        : Buffer.from(source, "utf8");
    const result = {
        bytes: buffer.length,
        gzipBytes: gzipSync(buffer, { level: 9 }).length,
        path: name,
        sha256: createHash("sha256").update(buffer).digest("hex"),
    };
    if (!result.bytes) throw new Error("Empty classic bundle: " + name);
    for (const key of ["bytes", "gzipBytes"]) {
        if (result[key] > budget[key])
            throw new Error(
                `${name}: ${key} ${result[key]} exceeds budget ${budget[key]}`
            );
    }
    return result;
}

function inspectBundles(root, artifacts = ARTIFACTS) {
    return artifacts.map((file) =>
        measureBundle(fs.readFileSync(path.join(root, file)), file)
    );
}

function inspectBundleSets(root, artifacts = ARTIFACTS, providerKinds) {
    const { CLASSIC_PROVIDER_BUNDLES } = require("./classic-bundle.cjs");
    const kinds = providerKinds || Object.keys(CLASSIC_PROVIDER_BUNDLES);
    if (
        new Set(kinds).size !== kinds.length ||
        kinds.some(
            (kind) =>
                !Object.prototype.hasOwnProperty.call(
                    CLASSIC_PROVIDER_BUNDLES,
                    kind
                )
        )
    )
        throw new Error("Invalid expected provider bundle kinds");
    return inspectBundles(root, artifacts).map((entry) => {
        const directory = path.dirname(entry.path);
        const expected = kinds.map((kind) => "provider-" + kind + ".js");
        for (const name of fs.readdirSync(path.join(root, directory))) {
            if (/^provider-.*\.js$/.test(name) && !expected.includes(name))
                throw new Error(
                    "Unexpected provider bundle: " + path.join(directory, name)
                );
        }
        const providers = expected.map((name) => {
            const file = path.join(directory, name);
            return measureBundle(fs.readFileSync(path.join(root, file)), file);
        });
        const total = [entry, ...providers].reduce(
            (sum, item) => ({
                bytes: sum.bytes + item.bytes,
                gzipBytes: sum.gzipBytes + item.gzipBytes,
            }),
            { bytes: 0, gzipBytes: 0 }
        );
        for (const key of ["bytes", "gzipBytes"]) {
            if (total[key] > TOTAL_BUDGET[key])
                throw new Error(
                    `${entry.path}: complete player ${key} ${total[key]} exceeds budget ${TOTAL_BUDGET[key]}`
                );
        }
        return { entry: entry.path, providers, total };
    });
}

function writeBundleReport(
    root,
    optimizer,
    modules,
    artifacts = ARTIFACTS,
    providerKinds
) {
    const { CLASSIC_PRIVATE_MODULES } = require("./classic-bundle.cjs");
    const measured = inspectBundles(root, artifacts);
    if (measured[0].sha256 !== optimizer.outputSha256)
        throw new Error(
            "Classic optimizer report does not match the server bundle"
        );
    const report = {
        artifacts: measured,
        budget: BUDGET,
        modules,
        optimizer,
        privateModules: Object.fromEntries(
            Object.entries(CLASSIC_PRIVATE_MODULES).filter(([file]) =>
                modules.includes(file)
            )
        ),
        providerBundles: inspectBundleSets(root, artifacts, providerKinds),
        schema: 1,
        toolchain: { node: process.versions.node, zlib: process.versions.zlib },
        totalBudget: TOTAL_BUDGET,
    };
    const output = path.join(root, "build/reports/classic-bundle.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    return report;
}

if (require.main === module) {
    try {
        for (const result of inspectBundles(path.resolve(__dirname, "..")))
            console.log(
                `${result.path}: ${result.bytes} bytes; gzip ${result.gzipBytes} bytes`
            );
        for (const result of inspectBundleSets(path.resolve(__dirname, "..")))
            console.log(
                `${result.entry}: complete player ${result.total.bytes} bytes; gzip ${result.total.gzipBytes} bytes`
            );
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
module.exports = {
    ARTIFACTS,
    BUDGET,
    inspectBundleSets,
    inspectBundles,
    measureBundle,
    TOTAL_BUDGET,
    writeBundleReport,
};

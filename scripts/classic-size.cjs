#!/usr/bin/env node
// Measure final artifacts, including native transformations, in UTF-8 bytes.
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gzipSync } = require("node:zlib");

// Full measures 649659 raw / 184198 gzip on CI Node22; native copies gzip to184273.
// Node26 compresses the identical bytes to183620. Preserve the raw limit and
// allow 500 bytes for the verified compressor variation (docs/runtime-ownership-migration.md).
const BUDGET = Object.freeze({ bytes: 650000, gzipBytes: 184500 });
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

function writeBundleReport(root, optimizer, modules, artifacts = ARTIFACTS) {
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
        schema: 1,
        toolchain: { node: process.versions.node, zlib: process.versions.zlib },
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
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
module.exports = {
    ARTIFACTS,
    BUDGET,
    inspectBundles,
    measureBundle,
    writeBundleReport,
};

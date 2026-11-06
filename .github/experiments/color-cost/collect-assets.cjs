#!/usr/bin/env node
"use strict";

// Evidence collection only. Existing build/size exit codes remain authoritative.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const FAMILIES = Object.freeze([
    { name: "web", assetRoot: "dist", javaScriptRoot: "dist" },
    { name: "tauri", assetRoot: "src-tauri/frontend", javaScriptRoot: "src-tauri/frontend/dist" },
    { name: "mobile", assetRoot: "dist-mobile", javaScriptRoot: "dist-mobile/dist" },
]);
// Exact source inventory at FOSS 14ea5da; each family stages this same set.
const EXPECTED_LOCALES = Object.freeze((
    "afrikaans albanian amharic arabic armenian assamese azerbaijani basque " +
    "belarusian bengali bosnian bulgarian burmese catalan chinese croatian czech " +
    "danish dutch english estonian filipino finnish french galician georgian " +
    "german greek gujarati hausa hebrew hindi hungarian icelandic igbo indonesian " +
    "irish italian japanese kannada kazakh khmer kinyarwanda korean kurdish " +
    "kyrgyz lao latvian lithuanian macedonian malagasy malay malayalam maltese " +
    "marathi mongolian nepali norwegian odia pashto persian polish portuguese " +
    "punjabi romanian russian serbian sindhi sinhala slovak slovenian somali " +
    "spanish swahili swedish tajik tamil telugu thai turkish turkmen ukrainian " +
    "urdu uzbek vietnamese xhosa yoruba zulu"
).split(" ").map(name => name + ".js").sort());
const CATEGORIES = Object.freeze(["rootJavaScript", "stylesheets", "locales"]);
const LIMITS = Object.freeze({
    directoryEntries: 20000,
    directories: 2048,
    depth: 12,
    selectedFiles: 2400,
    fileBytes: 32 * 1024 * 1024,
    totalBytes: 128 * 1024 * 1024,
    measurementModuleBytes: 1024 * 1024,
    errors: 64,
});
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const within = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
};

function noLinks(absolute) {
    if (!path.isAbsolute(absolute)) throw new Error("Absolute path required");
    const parsed = path.parse(absolute);
    let current = parsed.root;
    const components = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
    let result = fs.lstatSync(current);
    for (let i = 0; i < components.length; i++) {
        current = path.join(current, components[i]);
        result = fs.lstatSync(current);
        if (result.isSymbolicLink()) throw new Error("Symlink forbidden");
        if (i < components.length - 1 && !result.isDirectory()) throw new Error("Non-directory ancestor");
    }
    return result;
}

function safePath(root, relative) {
    if (typeof relative !== "string" || relative === "" || path.isAbsolute(relative) ||
        relative.split(/[\\/]/).some(part => part === ".." || part === "" || part === "."))
        throw new Error("Invalid relative path");
    const result = path.join(root, relative);
    if (!within(root, result)) throw new Error("Path escaped root");
    return result;
}

function stableRead(filename, maximum) {
    const before = noLinks(filename);
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > maximum)
        throw new Error("Not a regular bounded file");
    const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    const fd = fs.openSync(filename, flags);
    try {
        const opened = fs.fstatSync(fd);
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
            throw new Error("File changed before read");
        const data = Buffer.alloc(opened.size);
        let at = 0;
        while (at < data.length) {
            const count = fs.readSync(fd, data, at, data.length - at, at);
            if (!count) throw new Error("File shortened during read");
            at += count;
        }
        if (fs.readSync(fd, Buffer.alloc(1), 0, 1, at)) throw new Error("File grew during read");
        const after = fs.fstatSync(fd);
        const named = noLinks(filename);
        for (const stat of [after, named]) {
            if (stat.dev !== opened.dev || stat.ino !== opened.ino || stat.size !== opened.size ||
                stat.mtimeMs !== opened.mtimeMs || stat.ctimeMs !== opened.ctimeMs)
                throw new Error("File changed during read");
        }
        return data;
    } finally {
        fs.closeSync(fd);
    }
}

function emptyTotal() { return { files: 0, bytes: 0, gzipBytes: 0 }; }
function add(total, record) {
    total.files++;
    total.bytes += record.bytes;
    total.gzipBytes += record.gzipBytes;
}

function collectAssets(armArgument, outputArgument) {
    const armRoot = path.resolve(armArgument);
    const evidenceOut = path.resolve(outputArgument);
    if (!noLinks(armRoot).isDirectory()) throw new Error("Arm root is not a directory");
    if (within(armRoot, evidenceOut) || within(evidenceOut, armRoot))
        throw new Error("Evidence and source roots must be disjoint");
    if (!noLinks(path.dirname(evidenceOut)).isDirectory()) throw new Error("Evidence parent is not a directory");
    // A new directory is our ownership boundary. Never overwrite prior evidence.
    fs.mkdirSync(evidenceOut, { mode: 0o700 });
    const report = {
        version: 1,
        purpose: "Paired emitted-asset cost evidence; not build, budget or release qualification",
        complete: false,
        node: process.versions.node,
        zlib: process.versions.zlib,
        limits: LIMITS,
        measurement: null,
        expectedLocalesPerFamily: EXPECTED_LOCALES.length,
        expectedLocaleNames: EXPECTED_LOCALES,
        records: [],
        families: FAMILIES.map(family => ({ ...family, totals: Object.fromEntries(CATEGORIES.map(name => [name, emptyTotal()])) })),
        totals: Object.fromEntries(CATEGORIES.map(name => [name, emptyTotal()])),
        errors: [],
        omittedErrors: 0,
    };
    function error(code, relative, detail) {
        const item = { code, path: relative, detail: String(detail).slice(0, 300) };
        if (report.errors.length < LIMITS.errors) report.errors.push(item);
        else report.omittedErrors++;
    }
    function save() {
        report.records.sort((a, b) => compare(a.path, b.path));
        const temporary = path.join(evidenceOut, "inventory.json.tmp");
        fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        fs.renameSync(temporary, path.join(evidenceOut, "inventory.json"));
    }
    function preserve(relative, data) {
        const destination = safePath(evidenceOut, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
        noLinks(path.dirname(destination));
        fs.writeFileSync(destination, data, { flag: "wx", mode: 0o600 });
    }
    save();
    let selectedBytes = 0;
    let entries = 0;
    let directories = 0;
    let exhausted = false;
    try {
        const scriptRelative = "scripts/classic-size.cjs";
        const script = safePath(armRoot, scriptRelative);
        const moduleBytes = stableRead(script, LIMITS.measurementModuleBytes);
        // Use the real exported measurement function, not a mirror compressor.
        // Source/overlay hashes must be admitted by the parent harness before this call.
        const resolved = require.resolve(script);
        delete require.cache[resolved];
        const { collectBundleMeasurement } = require(resolved);
        if (typeof collectBundleMeasurement !== "function") throw new Error("Measurement export unavailable");
        if (sha(stableRead(script, LIMITS.measurementModuleBytes)) !== sha(moduleBytes))
            throw new Error("Measurement module changed while loading");
        preserve("measurement/classic-size.cjs", moduleBytes);
        report.measurement = { path: scriptRelative, sha256: sha(moduleBytes), export: "collectBundleMeasurement", gzipLevel: 9 };

        function collectFile(family, category, relative) {
            if (report.records.length >= LIMITS.selectedFiles) {
                exhausted = true;
                throw new Error("Selected file count exceeded");
            }
            const data = stableRead(safePath(armRoot, relative), LIMITS.fileBytes);
            if (selectedBytes + data.length > LIMITS.totalBytes) {
                exhausted = true;
                throw new Error("Selected byte count exceeded");
            }
            const measured = collectBundleMeasurement(data, relative);
            if (!measured || measured.path !== relative || measured.bytes !== data.length ||
                measured.sha256 !== sha(data) || !Number.isSafeInteger(measured.gzipBytes) || measured.gzipBytes <= 0)
                throw new Error("Invalid measurement result");
            const record = { family: family.name, category, ...measured, preservedPath: "raw/" + relative };
            preserve(record.preservedPath, data);
            report.records.push(record);
            selectedBytes += data.length;
            add(report.totals[category], record);
            add(family.totals[category], record);
        }

        function walk(family, relative, depth) {
            if (exhausted) return;
            if (depth > LIMITS.depth || ++directories > LIMITS.directories) {
                exhausted = true;
                throw new Error("Directory traversal bound exceeded");
            }
            const directory = safePath(armRoot, relative);
            if (!noLinks(directory).isDirectory()) throw new Error("Expected directory");
            // opendir keeps directory admission bounded even for maliciously large fixtures.
            const handle = fs.opendirSync(directory);
            const names = [];
            try {
                let item;
                while ((item = handle.readSync())) {
                    if (++entries > LIMITS.directoryEntries) {
                        exhausted = true;
                        throw new Error("Directory entry count exceeded");
                    }
                    names.push(item.name);
                }
            } finally { handle.closeSync(); }
            names.sort(compare);
            for (const name of names) {
                if (exhausted) return;
                const child = relative + "/" + name;
                try {
                    const stat = noLinks(safePath(armRoot, child));
                    if (stat.isDirectory()) {
                        if (["node_modules", ".git"].includes(name)) throw new Error("Non-runtime directory forbidden");
                        walk(family, child, depth + 1);
                    } else if (stat.isFile()) {
                        const parent = path.posix.dirname(child);
                        const category = parent === family.javaScriptRoot && /\.js$/i.test(name)
                            ? "rootJavaScript"
                            : /\.css$/i.test(name) ? "stylesheets"
                                : parent === family.assetRoot + "/locales" && /\.js$/i.test(name) ? "locales" : null;
                        if (category) collectFile(family, category, child);
                    } else throw new Error("Non-regular runtime entry forbidden");
                } catch (failure) {
                    error("asset_unavailable", child, failure.message);
                }
            }
        }

        for (const family of report.families) {
            try { walk(family, family.assetRoot, 0); }
            catch (failure) { error("family_unavailable", family.assetRoot, failure.message); }
            const own = report.records.filter(record => record.family === family.name);
            if (!own.some(record => record.path === family.javaScriptRoot + "/player.js"))
                error("missing_entry", family.javaScriptRoot + "/player.js", "Required final entry not measured");
            if (!own.some(record => record.path === family.assetRoot + "/styles/player.css"))
                error("missing_stylesheet", family.assetRoot + "/styles/player.css", "Required final stylesheet not measured");
            const actualLocales = own.filter(record => record.category === "locales").map(record => path.posix.basename(record.path)).sort(compare);
            if (JSON.stringify(actualLocales) !== JSON.stringify(EXPECTED_LOCALES))
                error("locale_inventory_mismatch", family.assetRoot + "/locales", "Expected exact 88-file locale set; measured " + actualLocales.length);
            save();
        }
    } catch (failure) {
        error("collector_failed", "", failure.message);
    }
    report.complete = report.errors.length === 0 && report.omittedErrors === 0;
    save();
    return report;
}

if (require.main === module) {
    try {
        if (process.argv.length !== 4) throw new Error("Usage: node collect-assets.cjs <armRoot> <evidenceOut>");
        if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted")
            throw new Error("Production collection requires a GitHub-hosted Actions runner");
        const report = collectAssets(process.argv[2], process.argv[3]);
        console.log(JSON.stringify({ complete: report.complete, files: report.records.length, errors: report.errors.length, omittedErrors: report.omittedErrors }));
        if (!report.complete) process.exitCode = 1;
    } catch (failure) {
        console.error("Asset collection failed: " + failure.message);
        process.exitCode = 1;
    }
}

// The parent harness is the source-admission boundary. Exports also permit tiny
// synthetic filesystem tests without running a build or bypassing the CLI gate.
module.exports = { collectAssets, FAMILIES, EXPECTED_LOCALES, LIMITS };

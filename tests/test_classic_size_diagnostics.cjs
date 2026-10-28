// Exercise the real diagnostic collector against tiny files and an injected
// optional inventory. No production build or guessed optional budget is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const filename = path.resolve(__dirname, "../scripts/classic-size.cjs");
const realRequire = createRequire(filename);
const catalog = Object.freeze({
    CLASSIC_OPTIONAL_BUNDLES: Object.freeze({
        "control-transport": [],
        "test-unbudgeted-optional": [],
    }),
    CLASSIC_PROVIDER_BUNDLES: Object.freeze({ m3u: [] }),
});
const moduleObject = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Buffer,
    console,
    module: moduleObject,
    process,
    require: (name) =>
        name === "./classic-bundle.cjs" ? catalog : realRequire(name),
});
const api = moduleObject.exports;
const caps = () =>
    JSON.stringify({
        base: api.BASE_TOTAL_BUDGET,
        entry: api.BUDGET,
        legacy: api.LEGACY_TOTAL_BUDGET,
        optional: api.OPTIONAL_BUDGETS,
        provider: api.PROVIDER_BUDGET,
        total: api.TOTAL_BUDGET,
    });
const beforeCaps = caps();
for (const value of [
    api.BUDGET,
    api.LEGACY_TOTAL_BUDGET,
    api.TOTAL_BUDGET,
    api.BASE_TOTAL_BUDGET,
    api.PROVIDER_BUDGET,
    api.OPTIONAL_BUDGETS,
    ...Object.values(api.OPTIONAL_BUDGETS),
])
    assert(Object.isFrozen(value));
const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ottplay-unbudgeted-diagnostic-")
);
const success = path.join(root, "build/reports/classic-bundle.json");
const diagnostic = path.join(
    root,
    "build/reports/classic-size-diagnostics.json"
);
const entry = Buffer.from("var tinyEntry = 1;\n");
const unknown = Buffer.from("var newOptional = 'measured Ω 😀';\n");
try {
    for (const artifact of api.ARTIFACTS) {
        const directory = path.join(root, path.dirname(artifact));
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(root, artifact), entry);
        fs.writeFileSync(
            path.join(directory, "provider-m3u.js"),
            "var provider = 1;"
        );
        fs.writeFileSync(
            path.join(directory, "control-transport.js"),
            "var transport = 1;"
        );
        fs.writeFileSync(
            path.join(directory, "test-unbudgeted-optional.js"),
            unknown
        );
    }
    const optimizer = {
        outputSha256: api.collectBundleMeasurement(entry, "entry").sha256,
    };
    // Strict APIs remain unchanged and still refuse the absent policy.
    assert.throws(
        () => api.inspectBundleSets(root, api.ARTIFACTS, ["m3u"]),
        /Missing optional budget: test-unbudgeted-optional/
    );
    assert.throws(
        () => api.writeBundleReport(root, optimizer, []),
        /Missing optional budget: test-unbudgeted-optional/
    );
    function collect() {
        fs.mkdirSync(path.dirname(success), { recursive: true });
        fs.writeFileSync(success, '{"stale":true}');
        assert.throws(
            () =>
                api.writeBuildBundleReport(root, optimizer, [], api.ARTIFACTS, [
                    "m3u",
                ]),
            /Classic bundle validation failed/
        );
        assert.equal(
            fs.existsSync(success),
            false,
            "never keep or emit an accepted report"
        );
        const result = JSON.parse(fs.readFileSync(diagnostic, "utf8"));
        assert.equal(result.diagnostic, true);
        assert.equal(
            result.complete,
            false,
            "unbudgeted measured data is explicitly incomplete"
        );
        assert.equal(caps(), beforeCaps);
        assert.equal(
            Object.hasOwn(api.OPTIONAL_BUDGETS, "test-unbudgeted-optional"),
            false
        );
        return result;
    }
    const report = collect();
    assert.equal(
        report.inputErrors.filter(
            (row) =>
                row.error ===
                "Missing optional budget: test-unbudgeted-optional"
        ).length,
        3
    );
    assert.equal(
        report.violations.length,
        0,
        "no zero, unlimited, or guessed optional cap is applied"
    );
    for (const set of report.providerBundles) {
        const asset = set.optionalAssets.find(
            (row) => row && row.path.endsWith("/test-unbudgeted-optional.js")
        );
        assert(
            asset,
            "unknown optional bytes are present for each independent variant"
        );
        const expected = api.collectBundleMeasurement(unknown, asset.path);
        assert.deepEqual(asset, JSON.parse(JSON.stringify(expected)));
        const measuredEntry = report.artifacts.find(
            (row) => row.path === set.entry
        );
        for (const key of ["bytes", "gzipBytes"])
            assert.equal(
                set.total[key],
                [measuredEntry, ...set.providers, ...set.optionalAssets].reduce(
                    (sum, row) => sum + row[key],
                    0
                ),
                "complete observed total includes the unbudgeted asset"
            );
    }
    const known = path.join(root, "dist/control-transport.js");
    fs.writeFileSync(
        known,
        "x".repeat(api.OPTIONAL_BUDGETS["control-transport"].bytes + 1)
    );
    assert(
        collect().violations.some(
            (row) =>
                row.path === "dist/control-transport.js" &&
                row.metric === "bytes"
        ),
        "known optional caps remain enforced"
    );
    // Missing or unsafe new files never turn into guessed zero measurements.
    const missing = path.join(
        root,
        "dist-mobile/dist/test-unbudgeted-optional.js"
    );
    fs.unlinkSync(missing);
    const incomplete = collect();
    assert.equal(incomplete.providerBundles[2].total, null);
    assert(
        incomplete.inputErrors.some(
            (row) =>
                row.path === "dist-mobile/dist/test-unbudgeted-optional.js" &&
                row.error !==
                    "Missing optional budget: test-unbudgeted-optional"
        )
    );
    assert(
        incomplete.providerBundles[0].optionalAssets.some(
            (row) => row && row.path.endsWith("test-unbudgeted-optional.js")
        ),
        "later input failure does not discard earlier measurements"
    );
    fs.symlinkSync(path.join(root, api.ARTIFACTS[0]), missing);
    assert(
        collect().inputErrors.some(
            (row) =>
                row.path === "dist-mobile/dist/test-unbudgeted-optional.js" &&
                /Symlink/.test(row.error)
        )
    );
} finally {
    fs.rmSync(root, { force: true, recursive: true });
}
console.log(
    "PASS unbudgeted optional diagnostics: actual bytes/gzip/hash and totals, explicit incomplete failure, strict APIs, stale-success removal and immutable caps"
);

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const {
    ARTIFACTS,
    BUDGET,
    OPTIONAL_BUDGETS,
    PROVIDER_BUDGET,
    TOTAL_BUDGET,
    LEGACY_TOTAL_BUDGET,
    inspectBundleSets,
    inspectBundles,
    measureBundle,
    writeBundleReport,
} = require("../scripts/classic-size.cjs");
const {
    CLASSIC_PROVIDER_BUNDLES,
    CLASSIC_OPTIONAL_BUNDLES,
} = require("../scripts/classic-bundle.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-size-test-"));
const androidOutput = fs.mkdtempSync(
    path.join(os.tmpdir(), "ottplay-size-android-output-")
);
try {
    const source = "var title = 'Программа';";
    const measurement = measureBundle(source, "unicode.js");
    assert.equal(measurement.bytes, Buffer.byteLength(source));
    assert.ok(measurement.bytes > source.length);
    assert.throws(() => measureBundle("", "empty"), /Empty classic bundle/);
    assert.throws(
        () => measureBundle(source, "raw", { bytes: 1, gzipBytes: 1000 }),
        /bytes .* exceeds budget/
    );
    assert.throws(
        () => measureBundle(source, "gzip", { bytes: 1000, gzipBytes: 1 }),
        /gzipBytes .* exceeds budget/
    );
    assert.throws(() => inspectBundles(root), /ENOENT/);
    for (const file of ARTIFACTS) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), source);
    }
    assert.equal(inspectBundles(root).length, 3);
    assert.throws(() => inspectBundleSets(root), /ENOENT/);
    for (const file of ARTIFACTS) {
        for (const kind of Object.keys(CLASSIC_PROVIDER_BUNDLES))
            fs.writeFileSync(
                path.join(root, path.dirname(file), "provider-" + kind + ".js"),
                source
            );
    }
    for (const file of ARTIFACTS)
        for (const name of Object.keys(CLASSIC_OPTIONAL_BUNDLES))
            fs.writeFileSync(
                path.join(root, path.dirname(file), name + ".js"),
                source
            );
    assert.deepEqual(
        Object.keys(OPTIONAL_BUDGETS).sort(),
        Object.keys(CLASSIC_OPTIONAL_BUNDLES).sort()
    );
    assert.deepEqual(OPTIONAL_BUDGETS["subtitle-appearance"], {
        bytes: 8100,
        gzipBytes: 3400,
    });
    assert.deepEqual(OPTIONAL_BUDGETS["remote-settings-extras"], {
        bytes: 7000,
        gzipBytes: 2800,
    });
    assert.deepEqual(OPTIONAL_BUDGETS["remote-provider-fields"], {
        bytes: 18000,
        gzipBytes: 6200,
    });
    assert.equal(
        TOTAL_BUDGET.bytes,
        LEGACY_TOTAL_BUDGET.bytes +
            Object.values(OPTIONAL_BUDGETS).reduce(
                (sum, budget) => sum + budget.bytes,
                0
            )
    );
    assert.equal(
        TOTAL_BUDGET.gzipBytes,
        LEGACY_TOTAL_BUDGET.gzipBytes +
            Object.values(OPTIONAL_BUDGETS).reduce(
                (sum, budget) => sum + budget.gzipBytes,
                0
            )
    );
    for (const name of Object.keys(OPTIONAL_BUDGETS)) {
        const file = path.join(root, "dist", name + ".js");
        fs.writeFileSync(file, "x".repeat(OPTIONAL_BUDGETS[name].bytes + 1));
        assert.throws(() => inspectBundleSets(root), /bytes .* exceeds budget/);
        fs.writeFileSync(file, source);
    }
    assert.deepEqual(OPTIONAL_BUDGETS["runtime-debug-details"], {
        bytes: 3800,
        gzipBytes: 1900,
    });
    assert.deepEqual(OPTIONAL_BUDGETS["perf-capture"], {
        bytes: 22200,
        gzipBytes: 8528,
    });
    const providerFieldsPath = path.join(
        root,
        "dist/remote-provider-fields.js"
    );
    const crypto = require("node:crypto");
    const denseFields = Buffer.concat(
        Array.from({ length: 288 }, (_, index) =>
            crypto.createHash("sha256").update(String(index)).digest()
        )
    ).toString("base64");
    assert(
        denseFields.length < OPTIONAL_BUDGETS["remote-provider-fields"].bytes
    );
    fs.writeFileSync(providerFieldsPath, denseFields);
    assert.throws(
        () => inspectBundleSets(root),
        /remote-provider-fields\.js: gzipBytes .* exceeds budget 6200/
    );
    fs.writeFileSync(providerFieldsPath, source);
    const perfPath = path.join(root, "dist/perf-capture.js");
    fs.writeFileSync(perfPath, denseFields);
    assert.throws(
        () => inspectBundleSets(root),
        /perf-capture\.js: gzipBytes .* exceeds budget 8528/
    );
    fs.writeFileSync(perfPath, source);
    const extrasPath = path.join(root, "dist/remote-settings-extras.js");
    const denseExtras = denseFields.slice(0, 4000);
    assert(
        denseExtras.length < OPTIONAL_BUDGETS["remote-settings-extras"].bytes
    );
    fs.writeFileSync(extrasPath, denseExtras);
    assert.throws(
        () => inspectBundleSets(root),
        /remote-settings-extras\.js: gzipBytes .* exceeds budget 2800/
    );
    fs.writeFileSync(extrasPath, source);
    const sets = inspectBundleSets(root);
    assert.equal(sets.length, 3);
    assert.equal(sets[0].providers.length, 8);
    const optionalCount = Object.keys(CLASSIC_OPTIONAL_BUNDLES).length;
    assert.equal(sets[0].total.bytes, measurement.bytes * (9 + optionalCount));
    assert.equal(
        sets[0].total.gzipBytes,
        measurement.gzipBytes * (9 + optionalCount)
    );
    const extra = path.join(root, "dist/provider-old.js");
    fs.writeFileSync(extra, source);
    assert.throws(() => inspectBundleSets(root), /Unexpected provider bundle/);
    fs.unlinkSync(extra);
    const oversizedSet = path.join(root, "dist/provider-m3u.js");
    // Entry-only growth must not silently relax the existing provider limit.
    const providerBudget = { bytes: 863400, gzipBytes: 268490 };
    assert.deepEqual(PROVIDER_BUDGET, providerBudget);
    const entryOnlyGrowth = "x".repeat(providerBudget.bytes + 1);
    assert.doesNotThrow(() => measureBundle(entryOnlyGrowth, "entry"));
    fs.writeFileSync(oversizedSet, entryOnlyGrowth);
    assert.throws(
        () => inspectBundleSets(root),
        /provider-m3u\.js: bytes .* exceeds budget 863400/
    );
    fs.writeFileSync(oversizedSet, "x".repeat(providerBudget.bytes - 1));
    const additional = path.join(root, "dist/provider-edem.js");
    fs.writeFileSync(
        additional,
        "y".repeat(TOTAL_BUDGET.bytes - providerBudget.bytes)
    );
    assert.throws(
        () => inspectBundleSets(root),
        /complete player bytes .* exceeds budget/
    );
    fs.writeFileSync(oversizedSet, source);
    fs.writeFileSync(additional, source);
    fs.writeFileSync(oversizedSet, "x".repeat(800000));
    fs.writeFileSync(
        additional,
        "y".repeat(LEGACY_TOTAL_BUDGET.bytes - 800000)
    );
    assert.throws(
        () => inspectBundleSets(root),
        new RegExp(
            `legacy complete player bytes .* exceeds budget ${LEGACY_TOTAL_BUDGET.bytes}`
        ),
        "legacy payload cannot borrow unused optional-asset headroom"
    );
    fs.writeFileSync(oversizedSet, source);
    fs.writeFileSync(additional, source);
    const optimizer = { outputSha256: measurement.sha256 };
    // Android Play ships exactly the four permitted provider families.
    // Check both its retained flat export and the nested Capacitor entry point.
    const playArtifacts = ["play/player.js", "play/dist/player.js"];
    const playKinds = ["m3u", "plex", "stalker", "vportal"];
    for (const file of playArtifacts) {
        const directory = path.join(root, path.dirname(file));
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(root, file), source);
        for (const name of Object.keys(CLASSIC_OPTIONAL_BUNDLES))
            fs.writeFileSync(path.join(directory, name + ".js"), source);
        for (const kind of playKinds)
            fs.writeFileSync(
                path.join(directory, "provider-" + kind + ".js"),
                source
            );
    }
    const playSets = inspectBundleSets(root, playArtifacts, playKinds);
    assert.equal(playSets.length, 2);
    assert.equal(playSets[0].providers.length, 4);
    assert.equal(
        playSets[0].total.bytes,
        measurement.bytes * (5 + optionalCount)
    );
    assert.equal(
        playSets[0].total.gzipBytes,
        measurement.gzipBytes * (5 + optionalCount)
    );
    // Android's configured output may be outside the repository entirely.
    // Both inventories are relative to that output root, not the default dist.
    const androidArtifacts = ["player.js", "dist/player.js"];
    for (const file of androidArtifacts) {
        const directory = path.join(androidOutput, path.dirname(file));
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(androidOutput, file), source);
        for (const name of Object.keys(CLASSIC_OPTIONAL_BUNDLES))
            fs.writeFileSync(path.join(directory, name + ".js"), source);
        for (const kind of playKinds)
            fs.writeFileSync(
                path.join(directory, "provider-" + kind + ".js"),
                source
            );
    }
    const config = ts.createSourceFile(
        "vite.config.ts",
        fs.readFileSync(path.join(__dirname, "../vite.config.ts"), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    // Exercise the actual staging functions, not just the final size inventory.
    const helpers = config.statements
        .filter(
            (node) =>
                ts.isFunctionDeclaration(node) &&
                ["stageTauriFrontend", "removeDuplicatePlayerAssets"].includes(
                    node.name?.text
                )
        )
        .map((node) => node.getText(config))
        .join("\n");
    const packaging = {
        ...fs,
        autoPlaybackScript: () => "fixture",
        CLASSIC_OPTIONAL_BUNDLES,
        CLASSIC_PROVIDER_BUNDLES,
        console: { log() {} },
        copyRuntimeAssets() {},
        join: path.join,
        stageNativeRuntime() {},
        stagePlayerAssets() {},
    };
    vm.createContext(packaging);
    vm.runInContext(
        ts.transpileModule(helpers, {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES2020,
            },
        }).outputText,
        packaging
    );
    const nativeStage = path.join(root, "native-stage");
    packaging.stageTauriFrontend(root, path.join(root, "dist"), nativeStage);
    assert.equal(
        fs.readFileSync(
            path.join(nativeStage, "dist/subtitle-appearance.js"),
            "utf8"
        ),
        source
    );
    const nestedLoops = [];
    function findNestedLoop(node) {
        if (
            ts.isForOfStatement(node) &&
            node.getText(config).includes("providerKinds.map") &&
            node.getText(config).includes("CLASSIC_OPTIONAL_BUNDLES")
        )
            nestedLoops.push(node);
        ts.forEachChild(node, findNestedLoop);
    }
    findNestedLoop(config);
    assert.equal(nestedLoops.length, 1);
    const mobileStage = path.join(root, "mobile-stage");
    fs.cpSync(path.join(root, "dist"), mobileStage, { recursive: true });
    fs.mkdirSync(path.join(mobileStage, "dist"));
    fs.copyFileSync(
        path.join(mobileStage, "player.js"),
        path.join(mobileStage, "dist/player.js")
    );
    vm.runInNewContext(nestedLoops[0].getText(config), {
        ...packaging,
        outDir: mobileStage,
        providerKinds: Object.keys(CLASSIC_PROVIDER_BUNDLES),
    });
    assert.equal(
        fs.readFileSync(
            path.join(mobileStage, "dist/subtitle-appearance.js"),
            "utf8"
        ),
        source
    );
    assert.equal(
        fs.readFileSync(
            path.join(nativeStage, "dist/remote-settings.js"),
            "utf8"
        ),
        source
    );
    assert.equal(
        fs.readFileSync(
            path.join(mobileStage, "dist/remote-settings.js"),
            "utf8"
        ),
        source
    );
    packaging.removeDuplicatePlayerAssets(mobileStage);
    assert(!fs.existsSync(path.join(mobileStage, "remote-settings.js")));
    assert(fs.existsSync(path.join(mobileStage, "dist/remote-settings.js")));
    assert(!fs.existsSync(path.join(mobileStage, "subtitle-appearance.js")));
    assert(
        fs.existsSync(path.join(mobileStage, "dist/subtitle-appearance.js"))
    );
    const androidGates = [];
    function findAndroidGate(node) {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "inspectBundleSets"
        )
            androidGates.push(node.getText(config));
        ts.forEachChild(node, findAndroidGate);
    }
    findAndroidGate(config);
    assert.equal(androidGates.length, 1);
    const inspectAndroid = () =>
        vm.runInNewContext(androidGates[0], {
            __dirname: root,
            inspectBundleSets,
            outDir: androidOutput,
            providerKinds: playKinds,
        });
    const androidSets = inspectAndroid();
    assert.deepEqual(
        Array.from(androidSets, (set) => set.entry),
        androidArtifacts
    );
    assert.equal(
        androidSets[1].total.bytes,
        measurement.bytes * (5 + optionalCount)
    );
    const externalChunk = path.join(androidOutput, "dist/provider-m3u.js");
    fs.unlinkSync(externalChunk);
    assert.throws(
        inspectAndroid,
        (error) => error.code === "ENOENT" && error.path === externalChunk
    );
    assert.equal(
        writeBundleReport(root, optimizer, [], playArtifacts, playKinds)
            .providerBundles[0].providers.length,
        4
    );
    assert.throws(() => inspectBundleSets(root, playArtifacts), /ENOENT/);
    assert.throws(
        () => inspectBundleSets(root, playArtifacts, ["m3u", "unknown"]),
        /Invalid expected provider bundle kinds/
    );
    assert.throws(
        () => inspectBundleSets(root, playArtifacts, ["m3u", "m3u"]),
        /Invalid expected provider bundle kinds/
    );
    const fullOnly = path.join(root, "play/dist/provider-edem.js");
    fs.writeFileSync(fullOnly, source);
    assert.throws(
        () => inspectBundleSets(root, playArtifacts, playKinds),
        /Unexpected provider bundle/
    );
    fs.unlinkSync(fullOnly);
    const required = path.join(root, "play/dist/provider-stalker.js");
    fs.unlinkSync(required);
    assert.throws(
        () => inspectBundleSets(root, playArtifacts, playKinds),
        /ENOENT/
    );
    fs.writeFileSync(required, source);
    fs.writeFileSync(required, "x".repeat(providerBudget.bytes - 1));
    const otherRequired = path.join(root, "play/dist/provider-m3u.js");
    fs.writeFileSync(
        otherRequired,
        "y".repeat(TOTAL_BUDGET.bytes - providerBudget.bytes)
    );
    assert.throws(
        () => inspectBundleSets(root, playArtifacts, playKinds),
        /complete player bytes .* exceeds budget/
    );
    const report = writeBundleReport(root, optimizer, ["entry.js"]);
    assert.deepEqual(
        JSON.parse(
            fs.readFileSync(
                path.join(root, "build/reports/classic-bundle.json")
            )
        ),
        report
    );
    assert.throws(
        () => writeBundleReport(root, { outputSha256: "stale" }, []),
        /does not match/
    );
    // A previously valid report must never allow an oversized staged artifact.
    fs.writeFileSync(
        path.join(root, ARTIFACTS[2]),
        "x".repeat(BUDGET.bytes + 1)
    );
    assert.throws(() => inspectBundles(root), /dist-mobile.* exceeds budget/);
    assert.throws(
        () => writeBundleReport(root, optimizer, []),
        /dist-mobile.* exceeds budget/
    );
    fs.unlinkSync(path.join(root, ARTIFACTS[1]));
    assert.throws(() => inspectBundles(root), /ENOENT/);
    console.log(
        "PASS classic bundle budgets: bytes, gzip, missing/stale/oversized artifacts"
    );
} finally {
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(androidOutput, { force: true, recursive: true });
}

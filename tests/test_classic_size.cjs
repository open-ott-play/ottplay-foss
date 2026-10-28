const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const {
    FAVORITES_RECOVERY_ENTRY_ALLOWANCE,
    FAVORITES_RECOVERY_OPTIONAL_ALLOWANCE,
    DESKTOP_FAVORITES_KEY_ALLOWANCE,
    FAVORITES_TRANSFER_ENTRY_ALLOWANCE,
    FAVORITES_TRANSFER_PLEX_ALLOWANCE,
    FAVORITES_TRANSFER_OPTIONAL_ALLOWANCE,
    ARTIFACTS,
    clearBuildSizeReports,
    collectBundleMeasurement,
    writeBuildBundleReport,
    BUDGET,
    BASE_TOTAL_BUDGET,
    LOCAL_COMPATIBILITY_ALLOWANCE,
    LOCAL_STALL_RECOVERY_ALLOWANCE,
    LOCAL_COMMAND_SESSION_ALLOWANCE,
    LOCAL_STARTUP_PREVIEW_ALLOWANCE,
    OPTIONAL_BUDGET,
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
        BASE_TOTAL_BUDGET.bytes,
        LEGACY_TOTAL_BUDGET.bytes +
            // Relocated assets share the existing complete payload allowance;
            // their independent caps do not allocate additional TOTAL bytes.
            Object.entries(OPTIONAL_BUDGETS)
                .filter(
                    ([name]) =>
                        ![
                            "local-compatibility",
                            "local-media-ui",
                            "remote-local-runner",
                        ].includes(name)
                )
                .map(([, budget]) => budget)
                .reduce((sum, budget) => sum + budget.bytes, 0)
    );
    assert.equal(
        BASE_TOTAL_BUDGET.gzipBytes,
        LEGACY_TOTAL_BUDGET.gzipBytes +
            // Relocated assets share the existing complete payload allowance;
            // their independent caps do not allocate additional TOTAL bytes.
            Object.entries(OPTIONAL_BUDGETS)
                .filter(
                    ([name]) =>
                        ![
                            "local-compatibility",
                            "local-media-ui",
                            "remote-local-runner",
                        ].includes(name)
                )
                .map(([, budget]) => budget)
                .reduce((sum, budget) => sum + budget.gzipBytes, 0)
    );
    assert.deepEqual(BASE_TOTAL_BUDGET, { bytes: 1463582, gzipBytes: 460184 });
    assert.deepEqual(LOCAL_COMMAND_SESSION_ALLOWANCE, {
        bytes: 5632,
        gzipBytes: 1792,
    });
    assert.deepEqual(LOCAL_STALL_RECOVERY_ALLOWANCE, {
        bytes: 2048,
        gzipBytes: 640,
    });
    assert.deepEqual(LOCAL_COMPATIBILITY_ALLOWANCE, {
        bytes: 4480,
        gzipBytes: 2304,
    });
    assert.deepEqual(TOTAL_BUDGET, { bytes: 1468062, gzipBytes: 462488 });
    assert.deepEqual(BUDGET, { bytes: 1097382, gzipBytes: 338206 });
    assert.deepEqual(LEGACY_TOTAL_BUDGET, {
        bytes: 1240682,
        gzipBytes: 390256,
    });
    assert.deepEqual(OPTIONAL_BUDGETS["local-media-ui"], {
        bytes: 8500,
        gzipBytes: 3400,
    });
    assert.deepEqual(OPTIONAL_BUDGETS["local-compatibility"], {
        bytes: 4800,
        gzipBytes: 1900,
    });
    assert.deepEqual(OPTIONAL_BUDGETS["remote-local-runner"], {
        bytes: 2700,
        gzipBytes: 1300,
    });
    assert.deepEqual(LOCAL_STARTUP_PREVIEW_ALLOWANCE, {
        bytes: 8192,
        gzipBytes: 2560,
    });
    assert(Object.isFrozen(LOCAL_STARTUP_PREVIEW_ALLOWANCE));
    const recoveryEvidence = require("../docs/evidence/favorites-recovery-size-20261028.json");
    const recoveryDelta = (budget, metric) =>
        FAVORITES_RECOVERY_ENTRY_ALLOWANCE[metric] +
        (budget === BASE_TOTAL_BUDGET || budget === TOTAL_BUDGET
            ? FAVORITES_RECOVERY_OPTIONAL_ALLOWANCE[metric]
            : 0);
    assert.deepEqual(FAVORITES_RECOVERY_ENTRY_ALLOWANCE, {
        bytes: 4800,
        gzipBytes: 1400,
    });
    assert.deepEqual(FAVORITES_RECOVERY_OPTIONAL_ALLOWANCE, {
        bytes: 23300,
        gzipBytes: 4900,
    });
    assert(Object.isFrozen(FAVORITES_RECOVERY_ENTRY_ALLOWANCE));
    assert(Object.isFrozen(FAVORITES_RECOVERY_OPTIONAL_ALLOWANCE));
    for (const [name, budget] of Object.entries({
        BASE_TOTAL_BUDGET,
        BUDGET,
        LEGACY_TOTAL_BUDGET,
        TOTAL_BUDGET,
    }))
        for (const metric of ["bytes", "gzipBytes"])
            assert.equal(
                budget[metric] - recoveryEvidence.previousCaps[name][metric],
                recoveryDelta(budget, metric),
                "recovery counted exactly once: " + name
            );
    assert.deepEqual(
        PROVIDER_BUDGET,
        recoveryEvidence.previousCaps.PROVIDER_BUDGET
    );
    assert.deepEqual(
        OPTIONAL_BUDGET,
        recoveryEvidence.previousCaps.OPTIONAL_BUDGET
    );
    for (const [file, hash] of Object.entries(
        recoveryEvidence.historicalEvidenceSha256
    ))
        assert.equal(
            require("node:crypto")
                .createHash("sha256")
                .update(
                    fs.readFileSync(
                        path.join(__dirname, "../docs/evidence", file)
                    )
                )
                .digest("hex"),
            hash,
            "historical evidence byte-immutable: " + file
        );
    for (const [name, old] of Object.entries(
        recoveryEvidence.previousCaps.OPTIONAL_BUDGETS
    ))
        for (const metric of ["bytes", "gzipBytes"])
            assert.equal(
                OPTIONAL_BUDGETS[name][metric] - old[metric],
                name === "favorites-transfer"
                    ? FAVORITES_RECOVERY_OPTIONAL_ALLOWANCE[metric]
                    : 0,
                "only favorites envelope gains recovery: " + name
            );
    assert.deepEqual(
        recoveryEvidence.baseline.toolchain,
        recoveryEvidence.candidate.toolchain
    );
    for (const [kind, budget, observed] of [
        ["entries", BUDGET, recoveryEvidence.measurement.measuredEntryDelta],
        [
            "legacy",
            LEGACY_TOTAL_BUDGET,
            recoveryEvidence.measurement.measuredEntryDelta,
        ],
        [
            "complete",
            TOTAL_BUDGET,
            recoveryEvidence.measurement.measuredCompleteDelta,
        ],
    ])
        for (let i = 0; i < 3; i++) {
            const before = recoveryEvidence.baseline[kind][i],
                after = recoveryEvidence.candidate[kind][i];
            assert.equal(after.bytes - before.bytes, observed.bytes);
            assert.equal(
                after.gzipBytes - before.gzipBytes,
                i === 0 ? observed.webGzipBytes : observed.nativeGzipBytes
            );
            for (const metric of ["bytes", "gzipBytes"]) {
                assert(
                    after[metric] <= budget[metric],
                    "measured final variant fits independent feature allocation"
                );
                const old =
                    recoveryEvidence.previousCaps[
                        kind === "entries"
                            ? "BUDGET"
                            : kind === "legacy"
                              ? "LEGACY_TOTAL_BUDGET"
                              : "TOTAL_BUDGET"
                    ];
                assert(
                    budget[metric] - after[metric] >=
                        old[metric] - before[metric],
                    "prior release headroom retained: " + kind
                );
            }
        }
    for (let i = 0; i < 3; i++) {
        const before = recoveryEvidence.baseline.favoritesOptional[i],
            after = recoveryEvidence.candidate.favoritesOptional[i];
        for (const metric of ["bytes", "gzipBytes"]) {
            assert.equal(
                after[metric] - before[metric],
                recoveryEvidence.measurement.measuredOptionalDelta[metric]
            );
            assert(
                OPTIONAL_BUDGETS["favorites-transfer"][metric] -
                    after[metric] >=
                    recoveryEvidence.previousCaps.OPTIONAL_BUDGETS[
                        "favorites-transfer"
                    ][metric] -
                        before[metric],
                "prior optional headroom retained"
            );
        }
    }
    const favoritesEvidence = require("../docs/evidence/favorites-transfer-size-20261028.json");
    const favoritesDelta = (budget, metric) =>
        FAVORITES_TRANSFER_ENTRY_ALLOWANCE[metric] +
        (budget === BUDGET ? 0 : FAVORITES_TRANSFER_PLEX_ALLOWANCE[metric]) +
        (budget === BASE_TOTAL_BUDGET || budget === TOTAL_BUDGET
            ? FAVORITES_TRANSFER_OPTIONAL_ALLOWANCE[metric]
            : 0);
    for (const [name, budget] of Object.entries({
        BASE_TOTAL_BUDGET,
        BUDGET,
        LEGACY_TOTAL_BUDGET,
        TOTAL_BUDGET,
    }))
        for (const metric of ["bytes", "gzipBytes"])
            assert.equal(
                budget[metric] -
                    DESKTOP_FAVORITES_KEY_ALLOWANCE[metric] -
                    recoveryDelta(budget, metric) -
                    favoritesEvidence.previousCaps[name][metric],
                favoritesDelta(budget, metric),
                "favorites allocation counted exactly once: " + name
            );
    assert.deepEqual(
        PROVIDER_BUDGET,
        favoritesEvidence.previousCaps.PROVIDER_BUDGET
    );
    for (const [name, budget] of Object.entries(
        favoritesEvidence.previousCaps.OPTIONAL_BUDGETS
    ))
        assert.deepEqual(
            OPTIONAL_BUDGETS[name],
            budget,
            "existing optional cap unchanged: " + name
        );
    assert.deepEqual(FAVORITES_TRANSFER_ENTRY_ALLOWANCE, {
        bytes: 9300,
        gzipBytes: 2400,
    });
    assert.deepEqual(FAVORITES_TRANSFER_PLEX_ALLOWANCE, {
        bytes: 500,
        gzipBytes: 150,
    });
    assert.deepEqual(FAVORITES_TRANSFER_OPTIONAL_ALLOWANCE, {
        bytes: 86000,
        gzipBytes: 24400,
    });
    for (const metric of ["bytes", "gzipBytes"])
        assert.equal(
            OPTIONAL_BUDGETS["favorites-transfer"][metric] -
                FAVORITES_RECOVERY_OPTIONAL_ALLOWANCE[metric],
            FAVORITES_TRANSFER_OPTIONAL_ALLOWANCE[metric]
        );
    for (const allowance of [
        FAVORITES_TRANSFER_ENTRY_ALLOWANCE,
        FAVORITES_TRANSFER_PLEX_ALLOWANCE,
        FAVORITES_TRANSFER_OPTIONAL_ALLOWANCE,
    ])
        assert(Object.isFrozen(allowance));
    assert.deepEqual(DESKTOP_FAVORITES_KEY_ALLOWANCE, {
        bytes: 4650,
        gzipBytes: 1100,
    });
    assert(Object.isFrozen(DESKTOP_FAVORITES_KEY_ALLOWANCE));
    for (const [actual, previous] of [
        [BUDGET, { bytes: 1078632, gzipBytes: 333306 }],
        [LEGACY_TOTAL_BUDGET, { bytes: 1221432, gzipBytes: 385206 }],
        [BASE_TOTAL_BUDGET, { bytes: 1335032, gzipBytes: 425834 }],
        [TOTAL_BUDGET, { bytes: 1339512, gzipBytes: 428138 }],
    ])
        for (const key of ["bytes", "gzipBytes"])
            assert.equal(
                actual[key] -
                    favoritesDelta(actual, key) -
                    recoveryDelta(actual, key) -
                    previous[key],
                DESKTOP_FAVORITES_KEY_ALLOWANCE[key],
                "desktop favorites counted exactly once"
            );
    const favoriteEvidence = require("../docs/evidence/desktop-favorites-key-size-20261028.json");
    assert.deepEqual(
        favoriteEvidence.allocation,
        DESKTOP_FAVORITES_KEY_ALLOWANCE
    );
    assert.deepEqual(
        favoriteEvidence.baseline.toolchain,
        favoriteEvidence.candidate.toolchain
    );
    for (let i = 0; i < favoriteEvidence.candidate.entries.length; i++) {
        const after = favoriteEvidence.candidate.entries[i],
            before = favoriteEvidence.baseline.entries[i];
        assert.equal(
            after.bytes - before.bytes,
            favoriteEvidence.observedDelta.bytes
        );
        assert.equal(
            after.gzipBytes - before.gzipBytes,
            i === 0
                ? favoriteEvidence.observedDelta.webGzipBytes
                : favoriteEvidence.observedDelta.nativeAndMobileGzipBytes
        );
        assert(
            after.bytes <= BUDGET.bytes && after.gzipBytes <= BUDGET.gzipBytes
        );
        const total = favoriteEvidence.candidate.complete[i];
        assert(
            total.bytes <= TOTAL_BUDGET.bytes &&
                total.gzipBytes <= TOTAL_BUDGET.gzipBytes
        );
    }

    for (const [actual, previous] of [
        [BUDGET, { bytes: 1070440, gzipBytes: 330746 }],
        [LEGACY_TOTAL_BUDGET, { bytes: 1213240, gzipBytes: 382646 }],
        [BASE_TOTAL_BUDGET, { bytes: 1326840, gzipBytes: 423274 }],
        [TOTAL_BUDGET, { bytes: 1331320, gzipBytes: 425578 }],
    ])
        for (const key of ["bytes", "gzipBytes"])
            assert.equal(
                actual[key] -
                    favoritesDelta(actual, key) -
                    recoveryDelta(actual, key) -
                    DESKTOP_FAVORITES_KEY_ALLOWANCE[key] -
                    previous[key],
                LOCAL_STARTUP_PREVIEW_ALLOWANCE[key],
                "startup preview counted exactly once"
            );
    const startupEvidence = require("../docs/evidence/local-startup-preview-size-20261027.json");
    assert.deepEqual(
        startupEvidence.allocation,
        LOCAL_STARTUP_PREVIEW_ALLOWANCE
    );
    assert.equal(
        startupEvidence.featureHeadroom.bytes,
        LOCAL_STARTUP_PREVIEW_ALLOWANCE.bytes -
            startupEvidence.observedDelta.bytes
    );
    assert.equal(
        startupEvidence.featureHeadroom.minimumGzipBytes,
        LOCAL_STARTUP_PREVIEW_ALLOWANCE.gzipBytes -
            Math.max(
                startupEvidence.observedDelta.webGzipBytes,
                startupEvidence.observedDelta.nativeAndMobileGzipBytes
            )
    );
    for (const metric of ["bytes", "gzipBytes"]) {
        assert.equal(
            startupEvidence.minimumCompleteHeadroom[metric],
            Math.min(
                ...startupEvidence.canonical.complete.map(
                    (item) =>
                        TOTAL_BUDGET[metric] -
                        favoritesDelta(TOTAL_BUDGET, metric) -
                        recoveryDelta(TOTAL_BUDGET, metric) -
                        DESKTOP_FAVORITES_KEY_ALLOWANCE[metric] -
                        item[metric]
                )
            )
        );
        assert(
            startupEvidence.canonical.entries.every(
                (item) =>
                    item[metric] <=
                    BUDGET[metric] -
                        favoritesDelta(BUDGET, metric) -
                        recoveryDelta(BUDGET, metric) -
                        DESKTOP_FAVORITES_KEY_ALLOWANCE[metric]
            )
        );
    }
    assert(Object.isFrozen(BASE_TOTAL_BUDGET));
    assert(Object.isFrozen(LOCAL_COMPATIBILITY_ALLOWANCE));
    assert(Object.isFrozen(TOTAL_BUDGET));
    for (const key of ["bytes", "gzipBytes"])
        assert.equal(
            TOTAL_BUDGET[key],
            BASE_TOTAL_BUDGET[key] + LOCAL_COMPATIBILITY_ALLOWANCE[key]
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
    // A complete distribution can use exactly one approved allowance; even a
    // one-byte overrun must fail while all component/legacy caps still pass.
    const distribution = [
        "dist/player.js",
        ...Object.keys(CLASSIC_PROVIDER_BUNDLES).map(
            (name) => "dist/provider-" + name + ".js"
        ),
        ...Object.keys(CLASSIC_OPTIONAL_BUNDLES).map(
            (name) => "dist/" + name + ".js"
        ),
    ];
    const originals = new Map(
        distribution.map((file) => [
            file,
            fs.readFileSync(path.join(root, file)),
        ])
    );
    function restoreDistribution() {
        for (const [file, bytes] of originals)
            fs.writeFileSync(path.join(root, file), bytes);
    }
    try {
        for (const file of distribution)
            fs.writeFileSync(path.join(root, file), "x");
        fs.writeFileSync(
            path.join(root, "dist/player.js"),
            "x".repeat(BUDGET.bytes)
        );
        const m3u = path.join(root, "dist/provider-m3u.js");
        fs.writeFileSync(
            m3u,
            "x".repeat(LEGACY_TOTAL_BUDGET.bytes - BUDGET.bytes - 7)
        );
        let remaining = TOTAL_BUDGET.bytes - LEGACY_TOTAL_BUDGET.bytes;
        let spare;
        const optionalNames = Object.keys(OPTIONAL_BUDGETS);
        optionalNames.forEach((name, index) => {
            const bytes = Math.min(
                OPTIONAL_BUDGETS[name].bytes,
                remaining - (optionalNames.length - index - 1)
            );
            fs.writeFileSync(
                path.join(root, "dist/" + name + ".js"),
                "x".repeat(bytes)
            );
            remaining -= bytes;
            if (bytes < OPTIONAL_BUDGETS[name].bytes)
                spare = path.join(root, "dist/" + name + ".js");
        });
        assert.equal(remaining, 0);
        assert(spare);
        assert.equal(
            inspectBundleSets(root)[0].total.bytes,
            TOTAL_BUDGET.bytes
        );
        fs.appendFileSync(spare, "x");
        assert.throws(
            () =>
                writeBuildBundleReport(
                    root,
                    {
                        outputSha256: collectBundleMeasurement(
                            fs.readFileSync(path.join(root, "dist/player.js")),
                            "entry"
                        ).sha256,
                    },
                    []
                ),
            /validation failed/
        );
        const aggregateFailure = JSON.parse(
            fs.readFileSync(
                path.join(root, "build/reports/classic-size-diagnostics.json")
            )
        );
        assert(
            aggregateFailure.violations.some(
                (item) => item.scope === "total" && item.metric === "bytes"
            )
        );
        assert.throws(
            () => inspectBundleSets(root),
            new RegExp(
                "complete player bytes .* exceeds budget " + TOTAL_BUDGET.bytes
            )
        );
    } finally {
        restoreDistribution();
    }
    // Independently exercise the aggregate gzip gate with incompressible small
    // fixtures; every per-file and legacy limit must remain satisfied.
    try {
        for (const file of distribution)
            fs.writeFileSync(path.join(root, file), "x");
        function dense(target) {
            const bytes = crypto.randomBytes(target - 128);
            return bytes;
        }
        const members = [
            {
                budget: BUDGET,
                // Track entry-only feature allocations while retaining room
                // under the per-file and legacy limits tested below.
                bytes: dense(BUDGET.gzipBytes - 8000),
                file: "dist/player.js",
            },
            ...Object.keys(CLASSIC_PROVIDER_BUNDLES).map((name) => ({
                budget: PROVIDER_BUDGET,
                bytes: name === "m3u" ? dense(59000) : Buffer.from("x"),
                file: "dist/provider-" + name + ".js",
            })),
            ...Object.entries(OPTIONAL_BUDGETS).map(([name, budget]) => ({
                budget,
                bytes: dense(budget.gzipBytes),
                file: "dist/" + name + ".js",
            })),
        ];
        const measured = members.map((member) => {
            fs.writeFileSync(path.join(root, member.file), member.bytes);
            return measureBundle(member.bytes, member.file, member.budget);
        });
        const legacy = measured.slice(0, 9);
        assert(
            legacy.reduce((sum, item) => sum + item.gzipBytes, 0) <
                LEGACY_TOTAL_BUDGET.gzipBytes
        );
        assert(
            measured.reduce((sum, item) => sum + item.bytes, 0) <
                TOTAL_BUDGET.bytes
        );
        assert(
            measured.reduce((sum, item) => sum + item.gzipBytes, 0) >
                TOTAL_BUDGET.gzipBytes
        );
        assert.throws(
            () =>
                writeBuildBundleReport(
                    root,
                    {
                        outputSha256: collectBundleMeasurement(
                            fs.readFileSync(path.join(root, "dist/player.js")),
                            "entry"
                        ).sha256,
                    },
                    []
                ),
            /validation failed/
        );
        const gzipFailure = JSON.parse(
            fs.readFileSync(
                path.join(root, "build/reports/classic-size-diagnostics.json")
            )
        );
        assert(
            gzipFailure.violations.some(
                (item) => item.scope === "total" && item.metric === "gzipBytes"
            )
        );
        assert(
            !gzipFailure.violations.some(
                (item) => item.scope === "asset" || item.scope === "legacyTotal"
            )
        );
        assert.throws(
            () => inspectBundleSets(root),
            new RegExp(
                "complete player gzipBytes .* exceeds budget " +
                    TOTAL_BUDGET.gzipBytes
            )
        );
    } finally {
        restoreDistribution();
    }
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
        () =>
            writeBuildBundleReport(
                root,
                { outputSha256: measurement.sha256 },
                []
            ),
        /validation failed/
    );
    const legacyFailure = JSON.parse(
        fs.readFileSync(
            path.join(root, "build/reports/classic-size-diagnostics.json")
        )
    );
    assert(
        legacyFailure.violations.some(
            (item) => item.scope === "legacyTotal" && item.metric === "bytes"
        )
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
    const diagnosticFile = path.join(
        root,
        "build/reports/classic-size-diagnostics.json"
    );
    function diagnose(artifacts = ARTIFACTS, kinds) {
        const first = fs.existsSync(path.join(root, artifacts[0]))
            ? collectBundleMeasurement(
                  fs.readFileSync(path.join(root, artifacts[0])),
                  artifacts[0]
              )
            : measurement;
        assert.throws(
            () =>
                writeBuildBundleReport(
                    root,
                    { outputSha256: first.sha256 },
                    [],
                    artifacts,
                    kinds,
                    {
                        attempt: "fresh-attempt",
                        mode: "fixture",
                        source: "exact-source",
                    }
                ),
            /Classic bundle validation failed/
        );
        assert(
            !fs.existsSync(path.join(root, "build/reports/classic-bundle.json"))
        );
        return JSON.parse(fs.readFileSync(diagnosticFile));
    }
    // Valid collection is byte/schema identical to the original strict report.
    const strictReport = writeBundleReport(root, optimizer, []);
    assert.deepEqual(writeBuildBundleReport(root, optimizer, []), strictReport);
    assert(!fs.existsSync(diagnosticFile));
    // Entry overflow cannot stop collection of later variants or either metric.
    const denseEntry = crypto.randomBytes(BUDGET.bytes + 1);
    fs.writeFileSync(path.join(root, ARTIFACTS[0]), denseEntry);
    fs.writeFileSync(
        path.join(root, ARTIFACTS[2]),
        "x".repeat(BUDGET.bytes + 1)
    );
    fs.writeFileSync(
        path.join(root, "dist/provider-m3u.js"),
        "x".repeat(PROVIDER_BUDGET.bytes + 1)
    );
    fs.writeFileSync(
        path.join(root, "dist/local-media-ui.js"),
        "x".repeat(OPTIONAL_BUDGETS["local-media-ui"].bytes + 1)
    );
    const failed = diagnose();
    assert.equal(failed.diagnostic, true);
    assert.equal(failed.complete, true);
    assert.equal(failed.source, "exact-source");
    assert.equal(failed.attempt, "fresh-attempt");
    assert.equal(failed.artifacts.length, 3);
    assert.deepEqual(failed.budget, BUDGET);
    assert.deepEqual(failed.totalBudget, TOTAL_BUDGET);
    assert.deepEqual(
        failed.favoritesRecoveryEntryAllowance,
        FAVORITES_RECOVERY_ENTRY_ALLOWANCE
    );
    assert.deepEqual(
        failed.favoritesRecoveryOptionalAllowance,
        FAVORITES_RECOVERY_OPTIONAL_ALLOWANCE
    );
    for (const metric of ["bytes", "gzipBytes"])
        assert(
            failed.violations.some(
                (item) => item.path === ARTIFACTS[0] && item.metric === metric
            )
        );
    for (const file of [
        ARTIFACTS[2],
        "dist/provider-m3u.js",
        "dist/local-media-ui.js",
    ])
        assert(failed.violations.some((item) => item.path === file));
    for (const set of failed.providerBundles) {
        assert.equal(
            set.providers.length,
            Object.keys(CLASSIC_PROVIDER_BUNDLES).length
        );
        assert.equal(set.optionalAssets.length, optionalCount);
        const entry = failed.artifacts.find((item) => item.path === set.entry);
        for (const metric of ["bytes", "gzipBytes"]) {
            assert.equal(
                set.legacyTotal[metric],
                [entry, ...set.providers].reduce(
                    (sum, item) => sum + item[metric],
                    0
                )
            );
            assert.equal(
                set.total[metric],
                [entry, ...set.providers, ...set.optionalAssets].reduce(
                    (sum, item) => sum + item[metric],
                    0
                )
            );
        }
    }
    restoreDistribution();
    fs.writeFileSync(path.join(root, ARTIFACTS[2]), source);
    // Missing data produces null totals, never zeros or a stale complete report.
    const missing = path.join(root, "dist-mobile/dist/local-media-ui.js");
    fs.unlinkSync(missing);
    let incomplete = diagnose();
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.providerBundles[2].total, null);
    assert(incomplete.providerBundles[2].legacyTotal);
    assert(
        incomplete.inputErrors.some(
            (item) => item.path === "dist-mobile/dist/local-media-ui.js"
        )
    );
    fs.writeFileSync(missing, source);
    // Bounded input errors do not prevent independent variant collection.
    const unsafe = path.join(root, "dist/provider-m3u.js");
    for (const kind of ["empty", "directory", "symlink", "excessive"]) {
        fs.unlinkSync(unsafe);
        if (kind === "directory") fs.mkdirSync(unsafe);
        else if (kind === "symlink")
            fs.symlinkSync(path.join(root, ARTIFACTS[2]), unsafe);
        else if (kind === "excessive") {
            const fd = fs.openSync(unsafe, "w");
            fs.ftruncateSync(fd, 16 * 1024 * 1024 + 1);
            fs.closeSync(fd);
        } else fs.writeFileSync(unsafe, "");
        incomplete = diagnose();
        assert.equal(incomplete.complete, false, kind);
        assert.equal(incomplete.providerBundles[0].legacyTotal, null, kind);
        assert(incomplete.providerBundles[2].total, kind);
        fs.rmSync(unsafe, { force: true, recursive: true });
        fs.writeFileSync(unsafe, source);
    }
    const originalRead = fs.readSync;
    let destabilized = false;
    fs.readSync = function (fd, buffer, ...args) {
        const count = originalRead.call(this, fd, buffer, ...args);
        if (!destabilized) {
            destabilized = true;
            fs.appendFileSync(path.join(root, ARTIFACTS[0]), "changed");
        }
        return count;
    };
    try {
        assert.throws(
            () => writeBuildBundleReport(root, optimizer, []),
            /validation failed/
        );
        incomplete = JSON.parse(fs.readFileSync(diagnosticFile));
        assert(
            incomplete.inputErrors.some((item) => /Unstable/.test(item.error))
        );
        assert.equal(incomplete.providerBundles[0].total, null);
    } finally {
        fs.readSync = originalRead;
        fs.writeFileSync(path.join(root, ARTIFACTS[0]), source);
    }
    fs.writeFileSync(path.join(root, "dist/provider-unexpected.js"), source);
    incomplete = diagnose();
    assert.equal(incomplete.providerBundles[0].total, null);
    assert(
        incomplete.inputErrors.some((item) =>
            /Unexpected provider/.test(item.error)
        )
    );
    fs.unlinkSync(path.join(root, "dist/provider-unexpected.js"));
    assert.throws(
        () => writeBuildBundleReport(root, { outputSha256: "wrong" }, []),
        /validation failed/
    );
    assert(
        JSON.parse(fs.readFileSync(diagnosticFile)).inputErrors.some((item) =>
            /optimizer/.test(item.error)
        )
    );
    const originalWrite = fs.writeFileSync;
    fs.writeFileSync = function (file, ...args) {
        if (file === diagnosticFile) throw new Error("fixture write failure");
        return originalWrite.call(this, file, ...args);
    };
    try {
        assert.throws(
            () => writeBuildBundleReport(root, { outputSha256: "wrong" }, []),
            /validation failed.*diagnostics write failed: fixture write failure/
        );
    } finally {
        fs.writeFileSync = originalWrite;
    }
    writeBuildBundleReport(root, optimizer, []);
    fs.writeFileSync(diagnosticFile, "stale");
    clearBuildSizeReports(root);
    assert(!fs.existsSync(diagnosticFile));
    assert(
        !fs.existsSync(path.join(root, "build/reports/classic-bundle.json"))
    );
    const serverReport = writeBuildBundleReport(
        root,
        optimizer,
        [],
        [ARTIFACTS[0]],
        undefined,
        { mode: "server" }
    );
    assert.equal(serverReport.artifacts.length, 1);
    assert.equal(serverReport.providerBundles.length, 1);
    const serverOnly = path.join(root, "server-only");
    fs.mkdirSync(serverOnly);
    fs.cpSync(path.join(root, "dist"), path.join(serverOnly, "dist"), {
        recursive: true,
    });
    assert.equal(
        writeBuildBundleReport(serverOnly, optimizer, [], ["dist/player.js"])
            .artifacts.length,
        1
    );
    fs.writeFileSync(
        path.join(serverOnly, "dist/player.js"),
        "x".repeat(BUDGET.bytes + 1)
    );
    assert.throws(
        () =>
            writeBuildBundleReport(
                serverOnly,
                {
                    outputSha256: collectBundleMeasurement(
                        fs.readFileSync(
                            path.join(serverOnly, "dist/player.js")
                        ),
                        "entry"
                    ).sha256,
                },
                [],
                ["dist/player.js"],
                undefined,
                { mode: "server" }
            ),
        /validation failed/
    );
    const serverFailure = JSON.parse(
        fs.readFileSync(
            path.join(serverOnly, "build/reports/classic-size-diagnostics.json")
        )
    );
    assert.equal(serverFailure.mode, "server");
    assert.equal(serverFailure.complete, true);
    assert.equal(serverFailure.artifacts.length, 1);
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
    const pipelineSource = fs.readFileSync(
        path.join(__dirname, "../vite.config.ts"),
        "utf8"
    );
    assert(pipelineSource.includes("const size = collectBundleMeasurement("));
    assert(!/\bmeasureBundle\(/.test(pipelineSource));
    assert(
        pipelineSource.indexOf('stageNativeRuntime(mobileDir, "capacitor")') <
            pipelineSource.lastIndexOf("writeBuildBundleReport(")
    );
    const androidGates = [];
    function findAndroidGate(node) {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "writeBuildBundleReport" &&
            node.arguments[0]?.getText(config) === "outDir"
        )
            androidGates.push(node.getText(config));
        ts.forEachChild(node, findAndroidGate);
    }
    findAndroidGate(config);
    assert.equal(androidGates.length, 1);
    const inspectAndroid = () =>
        vm.runInNewContext(androidGates[0], {
            __dirname: root,
            androidFlavor: "play",
            CLASSIC_MAIN_MODULES: [],
            outDir: androidOutput,
            providerKinds: playKinds,
            result: { code: source, report: optimizer },
            sizeContext: { attempt: "fixture", source: "fixture" },
            writeBuildBundleReport,
        });
    const androidSets = inspectAndroid().providerBundles;
    assert.deepEqual(
        Array.from(androidSets, (set) => set.entry),
        androidArtifacts
    );
    assert.equal(
        androidSets[1].total.bytes,
        measurement.bytes * (5 + optionalCount)
    );
    const {
        transformPlaySystemIcons,
    } = require("../scripts/play-system-icons.cjs");
    const iconSource = 'var icon="\\ue810";';
    const transformed = transformPlaySystemIcons(iconSource);
    assert.notEqual(transformed, iconSource);
    const iconOptimizer = {
        outputSha256: collectBundleMeasurement(iconSource, "entry").sha256,
    };
    for (const file of androidArtifacts)
        fs.writeFileSync(path.join(androidOutput, file), transformed);
    assert.equal(
        writeBuildBundleReport(
            androidOutput,
            iconOptimizer,
            [],
            androidArtifacts,
            playKinds,
            { mode: "android-play", nativeEntrySource: iconSource }
        ).artifacts[0].sha256,
        collectBundleMeasurement(transformed, "entry").sha256
    );
    assert.throws(
        () =>
            writeBuildBundleReport(
                androidOutput,
                { outputSha256: "wrong" },
                [],
                androidArtifacts,
                playKinds,
                { mode: "android-play", nativeEntrySource: iconSource }
            ),
        /validation failed/
    );
    // Native icon rewriting cannot grant headroom to oversized optimizer output.
    const rawBoundary =
        iconSource +
        "x".repeat(BUDGET.bytes + 1 - Buffer.byteLength(iconSource));
    const iconPrefix = iconSource.repeat(4096);
    const densePayload = Buffer.concat(
        Array.from({ length: 12000 }, (_, index) =>
            crypto.createHash("sha256").update(String(index)).digest()
        )
    ).toString("base64");
    const gzipCandidate = (length) =>
        iconPrefix + 'var payload="' + densePayload.slice(0, length) + '";';
    let low = 0,
        high = densePayload.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (
            collectBundleMeasurement(gzipCandidate(middle), "optimizer-output")
                .gzipBytes > BUDGET.gzipBytes
        )
            high = middle;
        else low = middle + 1;
    }
    for (const [metric, original] of [
        ["bytes", rawBoundary],
        ["gzipBytes", gzipCandidate(low)],
    ]) {
        const originalSize = collectBundleMeasurement(
            original,
            "optimizer-output"
        );
        assert(originalSize[metric] > BUDGET[metric]);
        assert.throws(
            () => measureBundle(original, "entry"),
            new RegExp(metric + ".*exceeds budget")
        );
        const staged = transformPlaySystemIcons(original);
        assert.doesNotThrow(() => measureBundle(staged, "native-entry"));
        for (const file of androidArtifacts)
            fs.writeFileSync(path.join(androidOutput, file), staged);
        assert.throws(
            () =>
                writeBuildBundleReport(
                    androidOutput,
                    { outputSha256: originalSize.sha256 },
                    [],
                    androidArtifacts,
                    playKinds,
                    { mode: "android-play", nativeEntrySource: original }
                ),
            /validation failed/
        );
        const boundaryFailure = JSON.parse(
            fs.readFileSync(
                path.join(
                    androidOutput,
                    "build/reports/classic-size-diagnostics.json"
                )
            )
        );
        assert.equal(boundaryFailure.complete, true);
        assert.equal(boundaryFailure.inputErrors.length, 0);
        assert(
            boundaryFailure.violations.some(
                (item) =>
                    item.scope === "optimizer" &&
                    item.metric === metric &&
                    item.actual === originalSize[metric] &&
                    item.budget === BUDGET[metric]
            )
        );
        assert(
            !boundaryFailure.violations.some((item) => item.scope === "asset")
        );
        assert.equal(boundaryFailure.providerBundles.length, 2);
        assert(
            !fs.existsSync(
                path.join(androidOutput, "build/reports/classic-bundle.json")
            )
        );
    }
    for (const file of androidArtifacts)
        fs.writeFileSync(path.join(androidOutput, file), source);
    const externalChunk = path.join(androidOutput, "dist/provider-m3u.js");
    fs.unlinkSync(externalChunk);
    assert.throws(inspectAndroid, /Classic bundle validation failed/);
    const androidFailure = JSON.parse(
        fs.readFileSync(
            path.join(
                androidOutput,
                "build/reports/classic-size-diagnostics.json"
            )
        )
    );
    assert.equal(androidFailure.complete, false);
    assert(
        androidFailure.inputErrors.some(
            (item) =>
                item.path === "dist/provider-m3u.js" &&
                /ENOENT/.test(item.error)
        )
    );
    assert.equal(androidFailure.providerBundles[1].total, null);
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
    assert.deepEqual(report.baseTotalBudget, BASE_TOTAL_BUDGET);
    assert.deepEqual(
        report.localCompatibilityAllowance,
        LOCAL_COMPATIBILITY_ALLOWANCE
    );
    assert.deepEqual(report.totalBudget, TOTAL_BUDGET);
    assert.deepEqual(
        report.favoritesRecoveryEntryAllowance,
        FAVORITES_RECOVERY_ENTRY_ALLOWANCE
    );
    assert.deepEqual(
        report.favoritesRecoveryOptionalAllowance,
        FAVORITES_RECOVERY_OPTIONAL_ALLOWANCE
    );
    assert.deepEqual(
        report.localStallRecoveryAllowance,
        LOCAL_STALL_RECOVERY_ALLOWANCE
    );
    assert.deepEqual(
        report.localStartupPreviewAllowance,
        LOCAL_STARTUP_PREVIEW_ALLOWANCE
    );
    assert.deepEqual(
        report.localCommandSessionAllowance,
        LOCAL_COMMAND_SESSION_ALLOWANCE
    );
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

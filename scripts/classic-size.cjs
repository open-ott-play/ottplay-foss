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
// The optional PC2 engine port also fits within these measured budgets.
// Owned episode looping and the natural-ended bridge add about 1.8 KB raw.
// Persistent page-title filtering adds about 1.5 KB, including its TV editor.
// Hosted EPG orchestration and encrypted same-Site input add ~14 KB raw;
// gzip/XML parsing remains in separately loaded worker assets.
// Visible hosted EPG diagnostics and retry add ~5.6 KB raw / 1.5 KB gzip.
// Remote CLI queries, result delivery and provider adapters add ~9 KB raw.
// Discovery, secure pairing and its UI measure 603103 raw / 182299 gzip
// for web 1.1.50 on Node 22.23.3 (native gzip 182353). Retain release headroom.
// Protected iOS sources retain cancellation and session checks after transport
// helper deduplication. Native Node 22 output exceeded the previous gzip cap by
// 16 bytes; allocate 50 bytes for this reviewed feature cost without raising raw
// or complete-payload limits.
// CSP-safe playback controls plus shared color-picker layout reduce raw output
// by 119 bytes and add 210 gzip bytes to native output on Node 22.23.2. The beta
// artifact measures 183726 gzip bytes; allow this reviewed feature cost and
// version suffix headroom while retaining raw and complete-payload limits.
// Producer-owned EPG/LG remote snapshots add 863 raw / 277 gzip bytes over
// published beta.7 (605567 / 183673 on Node 22.23.2). The measured candidate
// is 606430 / 183950 for web and 606388 / 184004 for native. Allocate 500 raw
// and 50 gzip entry bytes for this reviewed feature and version suffix room.
// Unicode remote matching on Node 22.23.3 measures 606636 raw / 184035 gzip
// for web and 606594 raw / 184089 gzip for both native variants. Allocate its
// measured cost plus candidate suffix room; retain the complete gzip limit.
// Native list swipes retain gesture ownership across paginated row replacement.
// Node 26 measures 608740 raw / 184260 gzip (web), 608698 / 184317 (native).
// Include release suffix room and the established Node 22 gzip variation.
// Remote VPortal collection, cancellation and per-visit URL renewal measure
// 615932 raw / 186854 gzip on Node 26.8.2 (native 615890 / 186913).
// Removing redundant canonicalization and metadata work saves 400 raw bytes.
// Budget the new feature explicitly,
// retaining candidate suffix room and the established Node 22 gzip allowance.
// Server EPG metadata snapshots and catalogue-bound playback add 1885 raw /
// 535 gzip bytes: 617817 / 187389 web on Node 26.8.2, without guide downloads.
// M3U profile management and acknowledged playback restarts add 8539 raw /
// at most 2585 gzip bytes on Node 22.23.2: web 626025 / 190382 and native
// 625983 / 190440. Include explicit paused startup for the core and PC2 engines.
// With inline video and native single-tap rows, the combined build measures
// 626111 / 190420 for web and 626069 / 190480 for native, within these limits.
// Cancellable iOS sign-in/proxy requests, peak touch movement and immediate PiP
// Stop add 995 raw / 384 gzip bytes to fe79de1 on Node 22.23.2. With the accepted
// EPG changes, web measures 627267 / 190842 and native 627225 / 190902. Allocate
// this reviewed lifecycle cost while retaining release-version headroom.
// NAS discovery and per-client Plex add bounded library boot and playback routing.
// Folder shuffle and explicit repeat add owned collection/EOS transitions,
// parental checks and source-scoped preference storage. Keep those guards;
// Plex pagination stays in its optional provider asset. Account for this
// reviewed feature cost: Node 26.8.2 web 640894 / 194762 gzip, native
// 640852 / 194822; retain native, Node 22 and release suffix headroom.
// This includes exact Plex cold resume, its guarded startup intent and exit flush.
// One-time VPortal queue shuffling also fits within these entry limits.
// Plex folder restoration retains bounded route metadata and rebuilds sibling
// queues with cancellation guards. Node 26.8.2 measures 644120 raw / 195549
// gzip for web, 644078 / 195613 native; retain Node 22 and release suffix room.
// Continuous catalog browsing adds owned page append/cancellation and a retry
// row without copying catalogs on each highlight. Node 26.8.2 measures
// 647536 raw / 196635 gzip for web; include native, Node 22 and suffix room.
// Visible shuffle/repeat modes, ordered-queue restoration and DOM digit fallback
// measure 650817 raw / 197647 gzip on Node 26.8.2. Preserve the established
// native, Node 22 and candidate-suffix allowance for this control-state feature.
const BUDGET = Object.freeze({ bytes: 651200, gzipBytes: 198400 });
// Count every optional family as well, so moving code out of the entry bundle
// cannot disguise growth of the complete player payload.
// Classic MAG support adds ~5 KB to the optional Stalker family and a small
// cancellable URL resolver to the shared backend (including release suffix room).
// The combined localization and PC2 changes need 85 more raw bytes; retain
// release suffix room without increasing the complete compressed budget.
// Stalker recovery and settings re-entry measure 192100 gzip bytes in native
// outputs on CI Node 22.23.2 (192106 with a beta version). Keep suffix headroom.
// VOD-owned native metadata and the late-guide guard measure 192222 on Node 22.
// Include the VPortal automatic-quality resolver as part of episode looping.
// The same candidate plus every provider totals 667727 / 206833 for web;
// native variants total 667685 / 206887. All complete payloads remain bounded.
// The same bounded diagnostics addition needs 100 raw complete-payload bytes.
// The same candidate with every provider measures 671260 / 208569 for web
// and 671218 / 208623 for native outputs; retain bounded suffix headroom.
// The gesture candidate totals 673493 raw / 208815 gzip before version suffixes.
// Including the Edem queue bridge, the VPortal candidate totals 681416 raw /
// 211638 gzip (native 681374 / 211697); all provider families remain counted.
// The metadata RPCs add the same measured cost to the complete payload.
// The same profile/restart candidate totals 691509 / 215210 for web and
// 691467 / 215268 for native; all five provider assets remain byte-identical.
// The combined inline-video/tap build totals 691595 / 215248 for web and
// 691553 / 215308 for native, still retaining bounded release suffix room.
// The same combined source plus every provider totals 692751 / 215670 for web
// and 692709 / 215730 for native on Node 22.23.2. Provider assets are unchanged;
// retain the complete-payload guard and release-version headroom.
// Include direct Plex catalogs, PIN sign-in, roaming connections and session cleanup.
// Include bounded, independently cancellable Plex folder collection and title
// fallbacks in the complete payload: web 733963 / 229802 gzip, native
// 733921 / 229862, retaining comparable complete-payload headroom.
// Include complete Plex folder records: 737347 / 230655 web
// and 737305 / 230719 native, with the same bounded release headroom.
// Include independent Plex/VPortal page transports and stable cursor IDs:
// the complete web payload is 742619 raw / 232209 gzip on Node 26.8.2.
// The same control-state change adds 3281 raw / 1012 gzip bytes; provider payloads
// remain unchanged and count toward this complete-output bound.
const TOTAL_BUDGET = Object.freeze({ bytes: 746600, gzipBytes: 234250 });
const ARTIFACTS = Object.freeze([
    "dist/player.js",
    "src-tauri/frontend/dist/player.js",
    "dist-mobile/dist/player.js",
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

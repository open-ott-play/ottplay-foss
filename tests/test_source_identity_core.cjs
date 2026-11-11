"use strict";
// IDs captured before extraction from source-identity.ts at 61df4e99a5541712b24b6ec334699921f4daa65a.
// All account/URL/token values below are synthetic; this is not a cryptographic guarantee.
const assert = require("node:assert/strict");
const fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm");
const test = require("node:test"),
    ts = require("typescript");
const realm = vm.createContext({});
realm.window = realm;
require("./helpers/shared-core-runtime.cjs")(realm, { vendorOnly: true });
vm.runInContext(
    ts.transpileModule(
        fs.readFileSync(
            path.join(__dirname, "../src/provider/source-identity.ts"),
            "utf8"
        ),
        {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }
    ).outputText,
    realm
);
const identity = realm.__ottSourceIdentity;
const cases = [
    {
        create: () => ({}),
        expected: { current: "classic", legacy: "classic", media: "classic" },
        name: "frozen host case 1",
    },
    {
        create: () => ({
            m3uArr: {
                active: 2,
                M3Us: [
                    {},
                    {},
                    {
                        medSourceId: "video",
                        www: "https://synthetic.test/list?token=fixture",
                    },
                ],
            },
            p_pref: "m3u",
        }),
        expected: {
            current: "m3u:2@901e6c2a.6aea2fc",
            legacy: "m3u:2",
            media: "m3u:2@f0d20fed.64ae0621",
        },
        name: "frozen host case 2",
    },
    {
        create: () => ({
            m3uArr: { active: -1, M3Us: [{ www: "not-selected" }] },
            p_pref: "m3u",
        }),
        expected: {
            current: "m3u:0@f0c8fa28.d51b56d2",
            legacy: "m3u:0",
            media: "m3u:0@38b30c82.b2bd7b9e",
        },
        name: "frozen host case 3",
    },
    {
        create: () => ({
            __ottOfflineProfiles: { namespace: () => "offline:fixture" },
            p_pref: "offline",
        }),
        expected: {
            current: "offline:fixture",
            legacy: "offline:fixture",
            media: "offline:fixture",
        },
        name: "frozen host case 4",
    },
    {
        create: () => ({
            __ottActiveProviderDriver: {
                configuration: () => ({ active: 3 }),
                credentials: () => ({
                    password: "excluded",
                    playlist: "tv",
                    server: "https://synthetic.test",
                    username: "fixture",
                }),
                id: "vportal",
                mediaSource: () => "films",
            },
            p_pref: "vportal",
        }),
        expected: {
            current: "vportal:3@8ebb8790.2f113ce4",
            legacy: "vportal:3",
            media: "vportal:3@8f4a2ed5.ce2963f7",
        },
        name: "frozen host case 5",
    },
    {
        create: () => ({
            __ottActiveProviderDriver: {
                configuration: () => ({ active: 0 }),
                credentials: () => ({
                    password: "fixture-token",
                    server: "https://synthetic.test",
                }),
                id: "stalker",
            },
            p_pref: "stalker",
        }),
        expected: {
            current: "stalker@c3745d20.2302d692",
            legacy: "stalker",
            media: "stalker@c3745d20.2302d692",
        },
        name: "frozen host case 6",
    },
    {
        create: () => ({
            __ottActiveProviderDriver: {
                configuration: () => ({ active: 4 }),
                credentials: () => ({
                    password: "ignored-token",
                    server: "https://synthetic.test",
                    username: "fixture",
                }),
                id: "stalker",
            },
            p_pref: "stalker",
        }),
        expected: {
            current: "stalker:4@8ebb8790.2f113ce4",
            legacy: "stalker:4",
            media: "stalker:4@8ebb8790.2f113ce4",
        },
        name: "frozen host case 7",
    },
    {
        create: () => ({
            __ottActiveProviderDriver: {
                credentials: () => ({
                    password: "fixture",
                    plexAccount: { id: "account-fixture" },
                    server: "unused",
                }),
                id: "plex",
                mediaSource: () => "library",
            },
            p_pref: "plex",
        }),
        expected: {
            current: "plex@18a4438f.5fc28b23",
            legacy: "plex",
            media: "plex@e1c04680.c0224c10",
        },
        name: "frozen host case 8",
    },
    {
        create: () => ({
            __ottActiveProviderDriver: {
                credentials: () => {
                    throw Error("synthetic");
                },
            },
            providerId: "custom",
        }),
        expected: { current: "custom", legacy: "custom", media: "custom" },
        name: "frozen host case 9",
    },
    {
        create: () => ({
            m3uArr: {
                active: 0,
                M3Us: [{ medSourceId: "\udc00", www: "\ud800\u0000😃" }],
            },
            p_pref: "m3u",
        }),
        expected: {
            current: "m3u:0@a769a541.aa218f61",
            legacy: "m3u:0",
            media: "m3u:0@1f0dd09b.ab52b723",
        },
        name: "frozen host case 10",
    },
    {
        create: () => ({
            __ottActiveProviderDriver: {
                credentials: () => ({
                    password: "",
                    playlist: "",
                    server: "",
                    username: "",
                }),
                id: "xtream",
            },
            p_pref: "xtream",
        }),
        expected: { current: "xtream", legacy: "xtream", media: "xtream" },
        name: "frozen host case 11",
    },
    {
        create: () => ({
            __ottActiveProviderDriver: {
                credentials: () => ({
                    password: "ignored",
                    playlist: "one",
                    server: "https://synthetic.test",
                    username: "fixture",
                }),
                id: "custom",
            },
            p_pref: "custom",
        }),
        expected: {
            current: "custom@457cab56.2fe349a0",
            legacy: "custom",
            media: "custom@457cab56.2fe349a0",
        },
        name: "frozen host case 12",
    },
];
for (const fixture of cases)
    test("UTF-16 source fingerprint keeps " + fixture.name, () => {
        for (const method of ["legacy", "current", "media"])
            assert.equal(
                identity[method](fixture.create()),
                fixture.expected[method],
                method
            );
    });

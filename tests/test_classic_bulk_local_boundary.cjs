const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadLocalSource(relative, trapCore) {
    const calls = [];
    const window = {};
    if (trapCore) {
        window.OttPlayCore = new Proxy(
            {},
            {
                get(_target, name) {
                    if (
                        String(name).startsWith("classicChannelLibrary") ||
                        name === "createClassicChannelReferences"
                    ) {
                        calls.push(name);
                        assert.fail("Unqualified bulk Core API: " + name);
                    }
                    return undefined;
                },
            }
        );
    }
    const context = vm.createContext({ window });
    const compiled = ts.transpileModule(
        fs.readFileSync(path.join(root, relative), "utf8"),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    );
    // Deliberately bypass the shared-Core fixture bootstrap: these two bulk
    // consumers remain local until their browser ABI is separately qualified.
    vm.runInContext(compiled.outputText, context, { filename: relative });
    return { calls, window };
}

for (const trapCore of [false, true]) {
    const mode = trapCore ? "trapped bulk Core" : "no Core";
    test(
        "local library preserves graph and storage ownership with " + mode,
        () => {
            const { calls, window } = loadLocalSource(
                "src/channels/library.ts",
                trapCore
            );
            const sourceId = "fixture:account-😀";
            const key = "channelLibrary:" + sourceId;
            const saved = new Map();
            const writes = [];
            let current = true;
            let broken = false;
            const ports = {
                current: () => current,
                get: (name) => saved.get(name) ?? null,
                getPersisted: (name) => saved.get(name) ?? null,
                set(name, value) {
                    if (broken) throw new Error("Storage unavailable");
                    writes.push(name);
                    saved.set(name, value);
                },
                sourceId,
            };
            const rows = [
                {
                    groupId: "genre:7",
                    groupLabel: "News",
                    id: 11,
                    itemId: "stream:😀",
                    label: "One",
                    locked: true,
                },
                {
                    groupId: "genre:7",
                    groupLabel: "News",
                    id: 12,
                    itemId: "stream:20",
                    label: "Two",
                },
                {
                    groupId: "genre:9",
                    groupLabel: "Movies",
                    id: 13,
                    itemId: "stream:30",
                    label: "Three",
                },
            ];
            const create = window.__ottChannelLibrary.create;
            const library = create(ports, rows);
            assert.deepEqual(plain(library.snapshot().all), [11, 12, 13]);
            assert.deepEqual(plain(library.snapshot().locks), [11]);
            assert.deepEqual(
                writes,
                [],
                "reading the catalog must not persist it"
            );

            assert.equal(library.setPreference("audio", 11, 2, true), true);
            assert.deepEqual(writes, ["channelLibrarySource", key]);
            assert.equal(saved.get("channelLibrarySource"), sourceId);
            assert.equal(
                JSON.parse(saved.get(key)).preferences.audio["stream:😀"],
                2
            );
            assert.equal(library.select("genre:7", 12), true);
            const custom = library.createGroup("Weekend", "genre:7");
            assert.equal(custom, "user:1");
            assert.equal(library.createGroup("Weekend"), null);
            assert.equal(library.changeMember(custom, 11, "remove"), true);
            assert.equal(library.changeMember(custom, 13, "add"), true);
            assert.equal(library.moveGroup(custom, 1), true);
            assert.deepEqual(
                plain(library.snapshot().groups).map((group) => group.id),
                ["genre:7", custom, "genre:9"]
            );
            assert.deepEqual(
                plain(library.snapshot().groups).find(
                    (group) => group.id === custom
                ).members,
                [12, 13]
            );
            assert.equal(library.lock(11, false), true);
            assert.deepEqual(plain(library.snapshot().locks), []);

            const reopened = create(ports, rows);
            assert.deepEqual(
                plain(reopened.snapshot()),
                plain(library.snapshot())
            );
            assert.equal(reopened.preference("audio", 11), 2);
            assert.deepEqual(plain(reopened.snapshot().selected), {
                groupId: "genre:7",
                itemId: "stream:20",
            });
            const before = plain(library.snapshot());
            const persisted = saved.get(key);
            const count = writes.length;
            broken = true;
            assert.equal(library.renameGroup(custom, "Unsaved"), false);
            assert.deepEqual(plain(library.snapshot()), before);
            assert.equal(saved.get(key), persisted);
            broken = false;
            current = false;
            assert.equal(library.setPreference("audio", 11, 3, true), false);
            assert.equal(library.lock(11, true), false);
            assert.equal(
                writes.length,
                count,
                "a retired owner must not write"
            );
            assert.deepEqual(plain(library.snapshot()), before);
            assert.deepEqual(calls, []);
        }
    );

    test(
        "local channel references reject ambiguous aliases with " + mode,
        () => {
            const { calls, window } = loadLocalSource(
                "src/channels/channel-references.ts",
                trapCore
            );
            const references = window.__ottChannelReferences.create(
                {
                    11: { itemId: "stream:😀", legacyChannelId: 1 },
                    12: { itemId: "stream:20", legacyChannelId: 2 },
                    13: { itemId: "stream:30", legacyChannelId: 2 },
                    14: { itemId: "duplicate" },
                    15: { itemId: "duplicate" },
                },
                { 3: 4, 4: 3, 6: "invalid", 7: 13, 11: 12 }
            );
            assert.deepEqual(plain(references.resolve("001", "raw")), {
                ambiguous: true,
                legacyId: "001",
                origin: "raw",
            });
            assert.deepEqual(plain(references.resolve(11, "canonical")), {
                itemId: "stream:😀",
            });
            assert.equal(references.project({ itemId: "stream:😀" }), 11);
            assert.deepEqual(plain(references.resolve("007", "raw")), {
                itemId: "stream:30",
            });
            for (const id of [2, 3, 6]) {
                assert.deepEqual(plain(references.resolve(id, "raw")), {
                    ambiguous: true,
                    legacyId: id,
                    origin: "raw",
                });
            }
            assert.equal(references.project({ itemId: "duplicate" }), null);
            assert.deepEqual(plain(references.resolve(99, "raw")), {
                legacyId: 99,
                origin: "raw",
            });
            assert.deepEqual(calls, []);
        }
    );
}

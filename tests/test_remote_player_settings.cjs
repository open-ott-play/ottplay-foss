"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const clone = (value) => JSON.parse(JSON.stringify(value));
function source(path) {
    const code = ts.transpileModule(fs.readFileSync(path, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    return code;
}
function productionSetting(id) {
    const ast = ts.createSourceFile(
        "settings.ts",
        fs.readFileSync("src/settings/index.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const schema = ast.statements
        .filter(ts.isVariableStatement)
        .flatMap((node) => [...node.declarationList.declarations])
        .find(
            (node) => node.name.getText(ast) === "settingsSchema"
        ).initializer;
    const definition = schema.elements.find((node) =>
        node.properties?.some(
            (property) =>
                property.name?.getText(ast) === "id" &&
                property.initializer?.text === id
        )
    );
    assert(definition, "Use the production setting validator: " + id);
    const helpers = ast.statements
        .filter(
            (node) =>
                ts.isFunctionDeclaration(node) &&
                node.name?.text === "normalizeTorrentStreamAddons"
        )
        .map((node) => node.getText(ast).replace(/^export /, ""))
        .join("\n");
    return vm.runInNewContext(
        ts.transpileModule(helpers + "\n(" + definition.getText(ast) + ")", {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        { URL }
    );
}
const domain = { exports: {} };
vm.runInNewContext(source("src/settings/store.ts"), domain);
const plugin = source("src/plugins/remote-settings.ts");
function fixture(extraSchema = []) {
    const data = new Map(),
        writes = [],
        effects = [];
    let now = 1000000;
    const f = {
        config: { active: 0 },
        locked: false,
        runtime: "page-123",
        scope: "m3u:1",
    };
    function number(id, max, scope = "application") {
        return {
            defaultValue: 0,
            effects: [id],
            id,
            key: id,
            rules: { range: [0, max] },
            scope,
            validate: (v) => Number.isInteger(v) && v >= 0 && v <= max,
        };
    }
    const schema = [
        number("bufSize", 3600),
        number("players", 3, "provider"),
        number("uiFontScale", 200),
        {
            defaultValue: "",
            effects: [],
            id: "commandServerToken",
            key: "token",
            rules: {},
            scope: "application",
            validate: (v) => typeof v === "string",
        },
        ...Array.from({ length: 22 }, (_, i) => number("option" + i, 10)),
        ...extraSchema,
    ];
    const store = domain.exports.createSettingsStore(schema, {
        context: () => f.scope,
        effect(name) {
            effects.push([name, Object.fromEntries(data)]);
            if (f.onEffect) f.onEffect(name);
            if (f.effectError) throw new Error("PRIVATE effect detail");
        },
        storage(entry) {
            const key =
                (entry.scope === "provider" ? f.scope + ":" : "") + entry.key;
            return {
                read() {
                    const value = data.get(key) ?? null;
                    if (f.onRead) f.onRead(key);
                    return value;
                },
                remove() {
                    data.delete(key);
                },
                write(value) {
                    writes.push([key, value]);
                    if (f.reject !== key) data.set(key, value);
                    if (f.onWrite) f.onWrite(key);
                },
            };
        },
    });
    const w = {
        __ottActiveProviderDriver: {
            configuration: () => f.config,
            id: "m3u",
            storageKey: (key) => f.scope + key,
        },
        __ottKiosk: { enabled: () => f.locked },
        __ottParental: { needs: () => f.pinLocked },
        __ottPlayerSettingsHost: { schema, source: () => f.scope, store },
    };
    vm.runInNewContext(plugin, { Date: { now: () => now }, window: w });
    const api = w.__ottPlayerSettingsFactory.create(w, () => f.runtime);
    return Object.assign(f, {
        advance(ms) {
            now += ms;
        },
        data,
        effects,
        get(id) {
            return this.request({ id, op: "get", runtime: this.runtime });
        },
        request(params, extra = {}) {
            let result,
                replies = 0;
            api.request(
                { action: "player_settings", params, ...extra },
                (r) => {
                    replies++;
                    result = clone(r);
                }
            );
            assert.equal(replies, 1);
            return result;
        },
        set(get, value) {
            return this.request({
                context: get.data.context.token,
                id: get.data.setting.id,
                op: "set",
                revision: get.data.setting.revision,
                runtime: get.data.runtime,
                value,
            });
        },
        store,
        w,
        writes,
    });
}
let passed = 0;
function check(name, run) {
    run();
    passed++;
    console.log("OK: " + name);
}
check(
    "schema is bounded, paginated and source-bound without a loaded catalogue",
    () => {
        const f = fixture();
        f.w.__ottActiveProviderDriver.configuration = () => {
            throw new Error("catalogue unavailable");
        };
        const first = f.request({ op: "schema", runtime: f.runtime });
        assert.equal(first.status, "ok");
        assert.equal(first.data.settings.length, 20);
        const next = f.request({
            cursor: first.data.next_cursor,
            op: "schema",
            runtime: f.runtime,
        });
        assert.equal(next.data.settings.length, 6);
        assert.equal(next.data.next_cursor, null);
        f.scope = "m3u:2";
        assert.equal(
            f.request({
                cursor: first.data.next_cursor,
                op: "schema",
                runtime: f.runtime,
            }).data.reason,
            "source_changed"
        );
        assert.equal(f.set(f.get("bufSize"), 3).status, "ok");
    }
);
check(
    "buffer reads default separately and saves exact bytes before effects",
    () => {
        const f = fixture(),
            get = f.get("bufSize");
        assert.equal(get.data.setting.storage, "default");
        assert.equal(get.data.setting.persisted_value, undefined);
        assert.equal(get.data.descriptor.unit, "seconds");
        const set = f.set(get, 3);
        assert.equal(set.status, "ok");
        assert.equal(set.data.persisted, true);
        assert.equal(set.data.setting.persisted_value, 3);
        assert.equal(set.data.application.state, "deferred");
        assert.deepEqual(f.effects, [["bufSize", { bufSize: "3" }]]);
        assert.equal(
            f.set(f.get("bufSize"), 121).data.setting.effective_value,
            0
        );
    }
);
check("players exposes stable aliases and LG effective automatic mode", () => {
    const f = fixture();
    f.w.ott_device = "lg/webos";
    const get = f.get("players");
    assert.equal(get.data.descriptor.choices[1].aliases[0], "hls.js");
    const set = f.set(get, 1);
    assert.equal(set.data.setting.value, 1);
    assert.equal(set.data.setting.effective_value, 3);
    assert.equal(set.data.application.reason, "next_stream");
});
check(
    "interface mode distinguishes saved preference from active presentation",
    () => {
        const f = fixture([
            {
                defaultValue: 0,
                effects: ["setInterfaceMode"],
                id: "interfaceMode",
                key: "sInterfaceMode",
                rules: { range: [0, 1] },
                scope: "application",
                validate: (value) => value === 0 || value === 1,
            },
        ]);
        f.w.setInterfaceMode = () => {};
        f.w.__ottInterfaceModeState = { effective: 0, status: "classic" };
        f.onEffect = () => {
            f.w.__ottInterfaceModeState.status = "loading";
        };
        const get = f.get("interfaceMode");
        assert.equal(get.data.descriptor.choices[1].aliases[0], "modern");
        const saved = f.set(get, 1);
        assert.equal(saved.status, "ok");
        assert.equal(saved.data.setting.value, 1);
        assert.equal(saved.data.setting.effective_value, 0);
        assert.deepEqual(saved.data.application, {
            reason: "view_loading",
            state: "deferred",
        });
        f.w.__ottInterfaceModeState = { effective: 1, status: "modern" };
        assert.equal(f.get("interfaceMode").data.setting.effective_value, 1);
        f.onEffect = () => {
            f.w.__ottInterfaceModeState = { effective: 0, status: "fallback" };
        };
        const failed = f.set(f.get("interfaceMode"), 1);
        assert.equal(failed.data.application.state, "failed");
        assert.equal(failed.data.setting.value, 1);
        assert.equal(failed.data.setting.effective_value, 0);
        f.onEffect = () => {
            f.w.__ottInterfaceModeState = { effective: 0, status: "classic" };
        };
        const classic = f.set(f.get("interfaceMode"), 0);
        assert.equal(classic.data.application.state, "completed");
    }
);
check("strict types and ranges reject without saving", () => {
    for (const value of [-1, 3601, 1.5, "3", null, true, [], {}]) {
        const f = fixture();
        assert.equal(f.set(f.get("bufSize"), value).status, "rejected");
        assert.equal(f.writes.length, 0);
    }
});
check("secrets remain redacted in get, schema and failure", () => {
    const f = fixture();
    f.data.set("token", "PRIVATE_TOKEN");
    const get = f.get("commandServerToken");
    assert.equal(get.data.setting.redacted, true);
    assert.equal(get.data.setting.configured, true);
    assert.equal(get.data.setting.value, undefined);
    assert.equal(get.data.descriptor.default_value, undefined);
    assert(!JSON.stringify(f.set(get, "PRIVATE_NEW")).includes("PRIVATE"));
});
check(
    "companion endpoint remains writable through masked remote settings",
    () => {
        const f = fixture([productionSetting("companionEndpoint")]);
        const endpoint =
            "http://127.0.0.1:8793/companion/" + "a".repeat(48) + "/v1";
        const get = f.get("companionEndpoint");
        assert.equal(get.data.descriptor.scope, "application");
        assert.equal(get.data.descriptor.sensitive, true);
        assert.equal(get.data.descriptor.access.read, false);
        assert.equal(get.data.descriptor.access.write, true);
        assert.equal(get.data.descriptor.apply, "next_stream");
        const set = f.set(get, endpoint);
        assert.equal(set.status, "ok");
        assert.equal(f.data.get("sCompanionEndpoint"), endpoint);
        assert(!JSON.stringify(set).includes(endpoint));
        const saved = f.get("companionEndpoint");
        assert.equal(saved.data.setting.redacted, true);
        assert.equal(saved.data.setting.configured, true);
        assert.equal(saved.data.setting.value, undefined);
        assert.equal(saved.data.setting.persisted_value, undefined);
        assert.equal(saved.data.descriptor.default_value, undefined);
        assert(!JSON.stringify(saved).includes(endpoint));
        assert.equal(
            f.set(saved, "https://invalid.example/").status,
            "rejected"
        );
        assert.equal(f.data.get("sCompanionEndpoint"), endpoint);
        assert.equal(f.set(f.get("companionEndpoint"), "").status, "ok");
        assert.equal(f.data.get("sCompanionEndpoint"), "");
    }
);
check("catalog base remains private and validates operator input", () => {
    const f = fixture([productionSetting("torrentCatalogEndpoint")]);
    const endpoint = "https://catalog.invalid/PRIVATE_PATH_TOKEN";
    const get = f.get("torrentCatalogEndpoint");
    assert.equal(get.data.descriptor.scope, "application");
    assert.equal(get.data.descriptor.sensitive, true);
    assert.equal(get.data.descriptor.access.read, false);
    assert.equal(get.data.descriptor.access.write, true);
    assert.equal(f.set(get, endpoint).status, "ok");
    assert.equal(f.data.get("sTorrentCatalogEndpoint"), endpoint);
    const saved = f.get("torrentCatalogEndpoint");
    assert.equal(saved.data.setting.redacted, true);
    assert.equal(saved.data.setting.configured, true);
    assert.equal(saved.data.setting.value, undefined);
    assert.equal(saved.data.setting.persisted_value, undefined);
    assert.equal(saved.data.descriptor.default_value, undefined);
    assert(!JSON.stringify(saved).includes("PRIVATE"));
    assert(
        !JSON.stringify(
            f.request({ op: "schema", runtime: f.runtime })
        ).includes("PRIVATE")
    );
    for (const invalid of [
        "http://catalog.invalid",
        "https://user:PRIVATE@catalog.invalid",
        "https://catalog.invalid?token=PRIVATE",
        "https://catalog.invalid/#PRIVATE",
        "https://catalog.invalid?",
        "https://catalog.invalid#",
        "https://catalog.invalid/manifest.json",
        "https://catalog.invalid/%xx",
        "https://catalog.invalid/private%00path",
        "https://catalog.invalid/private%5cpath",
        "https://catalog.invalid/%6danifest.json/",
        "https://catalog.invalid/\n",
        "https:\\catalog.invalid",
        "https://catalog.invalid/" + "a".repeat(4096),
        null,
        7,
    ]) {
        const rejected = f.set(f.get("torrentCatalogEndpoint"), invalid);
        assert.equal(rejected.status, "rejected", String(invalid));
        assert(!JSON.stringify(rejected).includes("PRIVATE"));
        assert.equal(f.data.get("sTorrentCatalogEndpoint"), endpoint);
    }
    for (const valid of [
        "https://catalog.invalid",
        "https://catalog.invalid/service/",
        "HTTPS://catalog.invalid/private-path",
        "https://catalog.invalid/%7B%22language%22%3A%22ru%22%7D",
        "https://catalog.invalid/private%20path",
        "",
    ]) {
        assert.equal(
            f.set(f.get("torrentCatalogEndpoint"), valid).status,
            "ok"
        );
        assert.equal(f.data.get("sTorrentCatalogEndpoint"), valid);
    }
});
check(
    "stream addon manifests are bounded, normalized and never disclosed",
    () => {
        const f = fixture([productionSetting("torrentStreamAddons")]);
        const id = "torrentStreamAddons";
        const configured =
            "https://streams.invalid/%7B%22token%22%3A%22PRIVATE%20KEY%22%7D/manifest.json";
        const get = f.get(id);
        assert.equal(get.data.descriptor.scope, "application");
        assert.equal(get.data.descriptor.sensitive, true);
        assert.equal(get.data.descriptor.access.read, false);
        assert.equal(get.data.descriptor.access.write, true);
        assert.deepEqual(clone(get.data.descriptor.constraints), {
            max_utf8_bytes: 4096,
        });
        const input = JSON.stringify([
            "  " + configured + "///  ",
            configured,
            "HTTPS://other.invalid/manifest.json",
        ]);
        const saved = f.set(get, input);
        assert.equal(saved.status, "ok");
        const canonical = JSON.stringify([
            configured,
            "HTTPS://other.invalid/manifest.json",
        ]);
        assert.equal(f.data.get("sTorrentStreamAddons"), canonical);
        assert(!JSON.stringify(saved).includes("PRIVATE"));
        const masked = f.get(id);
        assert.equal(masked.data.setting.redacted, true);
        assert.equal(masked.data.setting.value, undefined);
        assert.equal(masked.data.setting.persisted_value, undefined);
        assert.equal(masked.data.descriptor.default_value, undefined);
        assert(!JSON.stringify(masked).includes("PRIVATE"));
        assert(
            !JSON.stringify(
                f.request({ op: "schema", runtime: f.runtime })
            ).includes("PRIVATE")
        );
        for (const invalid of [
            "",
            "{}",
            "[",
            "null",
            null,
            [],
            JSON.stringify([null]),
            JSON.stringify(Array(9).fill(configured)),
            ...[
                "http://streams.invalid/manifest.json",
                "https://user:PRIVATE@streams.invalid/manifest.json",
                "https://@streams.invalid/manifest.json",
                "https://streams.invalid/manifest.json?",
                "https://streams.invalid/manifest.json#",
                "https://streams.invalid/private path/manifest.json",
                "https://streams.invalid/private\u00a0path/manifest.json",
                "https://streams.invalid/%xx/manifest.json",
                "https://streams.invalid/%00/manifest.json",
                "https://streams.invalid/%0a/manifest.json",
                "https://streams.invalid/%5c/manifest.json",
                "https://streams.invalid/private\\path/manifest.json",
                "https://streams.invalid/Manifest.json",
                "https://streams.invalid/manifest.json/extra",
                "https://streams.invalid/%6danifest.json",
                "https://streams.invalid/" +
                    "a".repeat(4096) +
                    "/manifest.json",
                "https://streams.invalid/" +
                    "ж".repeat(2048) +
                    "/manifest.json",
            ].map((url) => JSON.stringify([url])),
        ]) {
            const rejected = f.set(f.get(id), invalid);
            assert.equal(rejected.status, "rejected", String(invalid));
            assert(!JSON.stringify(rejected).includes("PRIVATE"));
            assert.equal(f.data.get("sTorrentStreamAddons"), canonical);
        }
        const url = (index, length) => {
            const prefix = "https://streams.invalid/" + index + "/";
            const suffix = "/manifest.json";
            return (
                prefix +
                "a".repeat(length - prefix.length - suffix.length) +
                suffix
            );
        };
        const largest = JSON.stringify(
            Array.from({ length: 8 }, (_, i) => url(i, i === 7 ? 571 : 500))
        );
        assert.equal(Buffer.byteLength(largest), 4096);
        assert.equal(
            f.set(f.get(id), largest).status,
            "ok",
            "the full documented wire budget is accepted"
        );
        assert.equal(f.data.get("sTorrentStreamAddons"), largest);
        assert.equal(f.set(f.get(id), largest + " ").status, "rejected");
        assert.equal(f.data.get("sTorrentStreamAddons"), largest);
        assert.equal(f.set(f.get(id), "[]").status, "ok");
        assert.equal(f.data.get("sTorrentStreamAddons"), "[]");
    }
);
check(
    "addon HTTP exceptions use exact loopback authorities without DNS",
    () => {
        for (const id of ["torrentCatalogEndpoint", "torrentStreamAddons"]) {
            const f = fixture([productionSetting(id)]);
            const value = (base) =>
                id === "torrentStreamAddons"
                    ? JSON.stringify([base + "/manifest.json"])
                    : base;
            const key =
                id === "torrentStreamAddons"
                    ? "sTorrentStreamAddons"
                    : "sTorrentCatalogEndpoint";
            for (const base of [
                "http://localhost",
                "http://localhost:8794/private",
                "HTTP://LOCALHOST:8794/private",
                "http://127.0.0.1:8794",
                "http://[::1]:8794/private",
                "https://external.invalid/private",
            ]) {
                assert.equal(
                    f.set(f.get(id), value(base)).status,
                    "ok",
                    id + ": " + base
                );
                assert.equal(f.data.get(key), value(base));
                assert.equal(f.get(id).data.setting.value, undefined);
            }
            const before = f.data.get(key);
            for (const base of [
                "http://external.invalid",
                "http://192.168.1.2",
                "http://127.0.0.2",
                "http://127.1",
                "http://127.000.000.001",
                "http://2130706433",
                "http://0x7f000001",
                "http://0177.0.0.1",
                "http://[::ffff:127.0.0.1]",
                "http://[0:0:0:0:0:0:0:1]",
                "http://localhost.",
                "http://a.localhost",
                "http://localhost.external.invalid",
                "http://%6cocalhost",
                "http://@localhost",
                "http://user@localhost",
                "https://@localhost",
                "http://localhost@external.invalid",
                "http://localhost:65536",
                "http://localhost?private",
                "http://localhost#private",
                "ftp://localhost",
            ]) {
                assert.equal(
                    f.set(f.get(id), value(base)).status,
                    "rejected",
                    id + ": " + base
                );
                assert.equal(f.data.get(key), before);
            }
        }
    }
);
check(
    "runtime, provider, profile and saved-byte changes invalidate receipts",
    () => {
        for (const mutation of [
            (f) => {
                f.runtime = "page-new";
            },
            (f) => {
                f.scope = "m3u:2";
            },
            (f) => {
                f.config.active = 1;
            },
            (f) => {
                f.data.set("bufSize", "8");
            },
        ]) {
            const f = fixture(),
                get = f.get("bufSize");
            mutation(f);
            assert.equal(f.set(get, 3).status, "rejected");
            assert.equal(f.writes.length, 0);
        }
    }
);
check(
    "same-setting ABA changes and expired receipts reject; unrelated edits survive",
    () => {
        const f = fixture(),
            get = f.get("bufSize");
        f.store.observe("bufSize", 8);
        f.store.observe("bufSize", 0);
        assert.equal(f.set(get, 3).data.reason, "revision_conflict");
        const rollback = f.get("bufSize");
        f.advance(-1);
        assert.equal(f.set(rollback, 3).data.reason, "revision_conflict");
        f.advance(1);
        const expired = f.get("bufSize");
        f.advance(120000);
        assert.equal(f.set(expired, 3).data.reason, "revision_conflict");
        const fresh = f.get("bufSize");
        f.store.observe("players", 2);
        assert.equal(f.set(fresh, 3).status, "ok");
    }
);
check(
    "open local draft cannot overwrite remote changes; unrelated local changes commit",
    () => {
        const f = fixture(),
            draft = f.store.begin(),
            independent = f.store.begin();
        draft.set("bufSize", 4);
        independent.set("players", 2);
        assert.equal(f.set(f.get("bufSize"), 3).status, "ok");
        assert.equal(draft.commit(), false);
        assert.equal(draft.errorCode(), "concurrent_edit");
        assert.equal(independent.commit(), true);
        assert.equal(f.data.get("bufSize"), "3");
    }
);
check("failed persistence applies no runtime or external effects", () => {
    const f = fixture();
    f.reject = "bufSize";
    const set = f.set(f.get("bufSize"), 3);
    assert.equal(set.data.reason, "storage_failed");
    assert.equal(f.store.get("bufSize"), 0);
    assert.deepEqual(f.effects, []);
});
check(
    "effect failure is reported separately after successful durable save",
    () => {
        const f = fixture();
        f.effectError = true;
        const set = f.set(f.get("bufSize"), 3);
        assert.equal(set.status, "ok");
        assert.equal(set.data.persisted, true);
        assert.deepEqual(set.data.application, {
            reason: "effect_failed",
            state: "failed",
        });
        assert(!JSON.stringify(set).includes("PRIVATE"));
    }
);
check("kiosk and PIN lock writes but permit schema and redacted reads", () => {
    for (const key of ["locked", "pinLocked"]) {
        const f = fixture(),
            get = f.get("bufSize");
        f[key] = true;
        assert.equal(f.get("bufSize").status, "ok");
        assert.equal(f.set(get, 3).data.reason, "policy_restricted");
        assert.equal(f.writes.length, 0);
    }
});
check("invalid stored bytes never enter readback", () => {
    const f = fixture();
    f.data.set("bufSize", "PRIVATE_INVALID");
    const get = f.get("bufSize");
    assert.equal(get.data.setting.storage, "invalid");
    assert.equal(get.data.setting.persisted_value, undefined);
    assert(!JSON.stringify(get).includes("PRIVATE"));
    assert.equal(f.set(get, 3).status, "ok");
});
check("receipt can be consumed only once", () => {
    const f = fixture(),
        get = f.get("bufSize");
    assert.equal(f.set(get, 3).status, "ok");
    assert.equal(f.set(get, 5).data.reason, "revision_conflict");
    assert.equal(f.writes.length, 1);
});
check(
    "provider preferences remain unavailable without a source while app repair works",
    () => {
        const f = fixture();
        f.w.__ottActiveProviderDriver = null;
        const provider = f.get("players");
        assert.equal(provider.status, "ok");
        assert.equal(provider.data.descriptor.access.write, false);
        assert.equal(provider.data.setting.storage, "unavailable");
        assert.equal(provider.data.setting.value, undefined);
        assert.equal(f.set(provider, 1).data.reason, "unsupported");
        assert.equal(f.set(f.get("bufSize"), 3).status, "ok");
    }
);
check("an explicit default value is persisted and confirmed", () => {
    const f = fixture(),
        set = f.set(f.get("bufSize"), 0);
    assert.equal(set.status, "ok");
    assert.equal(set.data.setting.storage, "stored");
    assert.equal(set.data.setting.persisted_value, 0);
    assert.equal(f.data.get("bufSize"), "0");
});
check(
    "post-effect value replacement cannot confirm a different value as requested",
    () => {
        const f = fixture();
        f.onEffect = () => {
            f.data.set("bufSize", "4");
            f.store.observe("bufSize", 4);
        };
        assert.equal(f.set(f.get("bufSize"), 3).data.reason, "storage_failed");
    }
);
check(
    "track defaults defer to next stream and missing apply hooks remain explicit",
    () => {
        const f = fixture();
        const definition = f.w.__ottPlayerSettingsHost.schema.find(
            (row) => row.id === "option0"
        );
        definition.id = "preferredAudioLanguage";
        definition.key = definition.id;
        definition.defaultValue = "";
        definition.effects = [];
        definition.rules = { language: "audio" };
        const schema = f.request({ op: "schema", runtime: f.runtime });
        assert.equal(
            schema.data.settings.find(
                (row) => row.id === "preferredAudioLanguage"
            ).apply,
            "next_stream"
        );
        assert.equal(
            schema.data.settings.find((row) => row.id === "uiFontScale").apply,
            "manual"
        );
    }
);
console.log("OK: " + passed + " typed player settings scenarios");

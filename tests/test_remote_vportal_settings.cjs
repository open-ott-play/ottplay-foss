"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
const runtime = require("./helpers/private-runtime.cjs");
const portal = "portal::[key:PRIVATE_ONE]https://portal.example/api/";
const other = "portal::[key:PRIVATE_TWO]https://other.example/api/";
function create(active = false) {
    const config = {
        active: 0,
        portals: Array.from({ length: 15 }, (_, i) => ({
            link: i ? "" : portal,
            name: "Slot " + (i + 1),
            sections: [],
        })),
    };
    const f = fixture({ vportalprofiles: JSON.stringify(config) }),
        w = f.host;
    const ast = ts.createSourceFile(
        "vportal.ts",
        fs.readFileSync("src/plugins/vportal.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const parse = ast.statements.find(
        (n) =>
            ts.isFunctionDeclaration(n) && n.name?.text === "parseVPortalLink"
    );
    vm.runInContext(
        ts.transpileModule(parse.getText(ast).replace(/^export /, ""), {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        w
    );
    w.__ottVPortal = { parse: w.parseVPortalLink };
    const state = {
        locked: false,
        runtime: "page-123",
        scope: "scope-1",
        standby: false,
    };
    w.__ottPlayerSettingsHost = { source: () => state.scope };
    w.__ottStandby = { blocked: () => state.standby };
    w.__ottKiosk = { enabled: () => state.locked };
    if (active) f.mount("vportal");
    else
        w.__ottActiveProviderDriver = {
            configuration: () => ({ active: 0 }),
            id: "m3u",
        };
    runtime(w, "src/plugins/remote-provider-settings.ts");
    const api = w.__ottRemoteProviderSettings.create(w, () => state.runtime, {
        allowed: () => true,
        url: (url) => {
            if (state.onValidate) state.onValidate();
            return !url.includes("forbidden");
        },
    });
    function request(action, params) {
        let result,
            replies = 0;
        api.request({ action, params }, (value) => {
            result = JSON.parse(JSON.stringify(value));
            replies++;
        });
        assert.equal(replies, 1);
        assert(!JSON.stringify(result).includes("PRIVATE"));
        return result;
    }
    return Object.assign(f, {
        compare(number = 1, settings = { vportal: other }) {
            return request("settings_compare", {
                number,
                provider: "vportal",
                runtime: state.runtime,
                settings,
            });
        },
        config,
        state,
        write(compare, settings = { vportal: other }) {
            return request("provider_settings", {
                context: compare.data.context,
                provider: "vportal",
                revision: compare.data.revision,
                runtime: compare.data.runtime,
                settings: { profile: compare.data.number, ...settings },
            });
        },
    });
}
let passed = 0;
function check(name, test) {
    test();
    passed++;
    console.log("OK: " + name);
}
check(
    "inactive VPortal save preserves active provider, slot names and no network",
    () => {
        const f = create(),
            before = f.host.__ottActiveProviderDriver;
        const compare = f.compare();
        assert.equal(compare.data.matched, false);
        const save = f.write(compare);
        assert.equal(save.status, "ok");
        assert.equal(save.data.reloaded, false);
        assert.equal(save.data.reload_required, false);
        assert.equal(f.host.__ottActiveProviderDriver, before);
        assert.equal(f.reloads, 0);
        assert.equal(f.requests.length, 0);
        const saved = JSON.parse(f.saved.get("vportalprofiles"));
        assert.equal(saved.portals[0].name, "Slot 1");
        assert.equal(saved.portals[0].link, other);
        assert.equal(f.compare().data.matched, true);
    }
);
check("active awake slot reloads once after verified save", () => {
    const f = create(true),
        save = f.write(f.compare());
    assert.equal(save.status, "ok");
    assert.equal(save.data.reloaded, true);
    assert.equal(save.data.reload_required, false);
    assert.equal(f.reloads, 1);
});
check("active sleeping slot defers reload without fetching media", () => {
    const f = create(true);
    f.state.standby = true;
    const save = f.write(f.compare());
    assert.equal(save.status, "ok");
    assert.equal(save.data.reloaded, false);
    assert.equal(save.data.reload_required, true);
    assert.equal(f.reloads, 0);
    assert.equal(f.requests.length, 0);
});
check("inactive slot of active provider does not disturb playback", () => {
    const f = create(true),
        save = f.write(f.compare(2));
    assert.equal(save.status, "ok");
    assert.equal(save.data.reloaded, false);
    assert.equal(f.reloads, 0);
});
check(
    "stale runtime, source and captured bytes reject without overwrite",
    () => {
        for (const mutate of [
            (f) => {
                f.state.runtime = "page-456";
            },
            (f) => {
                f.state.scope = "scope-2";
            },
            (f) => {
                const c = JSON.parse(f.saved.get("vportalprofiles"));
                c.portals[0].name = "Changed";
                f.saved.set("vportalprofiles", JSON.stringify(c));
            },
        ]) {
            const f = create(),
                before = f.compare();
            mutate(f);
            const retained = f.saved.get("vportalprofiles");
            assert.equal(f.write(before).status, "rejected");
            assert.equal(f.saved.get("vportalprofiles"), retained);
        }
    }
);
check("write rejection leaves saved bytes and reload count unchanged", () => {
    const f = create(true),
        write = f.host.stbSetItem;
    f.host.stbSetItem = () => {};
    const before = f.saved.get("vportalprofiles"),
        save = f.write(f.compare());
    assert.equal(save.status, "rejected");
    assert.equal(f.saved.get("vportalprofiles"), before);
    assert.equal(f.reloads, 0);
    f.host.stbSetItem = write;
});
check(
    "normal link validation, policy and duplicate receipt guards remain active",
    () => {
        const f = create(),
            before = f.saved.get("vportalprofiles");
        assert.equal(
            f.write(f.compare(1, { vportal: "invalid" }), {
                vportal: "invalid",
            }).status,
            "rejected"
        );
        assert.equal(f.saved.get("vportalprofiles"), before);
        const compare = f.compare();
        f.state.locked = true;
        assert.equal(f.write(compare).data.reason, "policy_restricted");
        f.state.locked = false;
        const next = f.compare();
        assert.equal(f.write(next).status, "ok");
        assert.equal(f.write(next).status, "rejected");
    }
);
check(
    "source change during normal validation cannot write stale configuration",
    () => {
        const f = create(),
            compare = f.compare(),
            before = f.saved.get("vportalprofiles");
        f.state.onValidate = () => {
            f.state.scope = "scope-new";
        };
        assert.equal(f.write(compare).status, "rejected");
        assert.equal(f.saved.get("vportalprofiles"), before);
    }
);
check(
    "reentrant reload cannot acknowledge a different source or replaced saved value",
    () => {
        for (const mutate of [
            (f) => {
                f.state.scope = "other";
            },
            (f) => {
                f.host.__ottActiveProviderDriver = { id: "m3u" };
            },
            (f) => {
                f.saved.set("vportalprofiles", "{}");
            },
        ]) {
            const f = create(true);
            f.host.loadChannels = () => mutate(f);
            assert.equal(f.write(f.compare()).status, "rejected");
        }
    }
);
console.log("OK: " + passed + " VPortal remote settings scenarios");

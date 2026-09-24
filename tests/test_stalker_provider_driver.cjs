"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fixture = require("./helpers/stalker-driver-fixture.cjs");
const clone = (value) => JSON.parse(JSON.stringify(value));
let groups = 0;
function test(label, action) {
    action();
    groups++;
    console.log("PASS Stalker driver: " + label);
}
function catalog(id = 42, name = "News") {
    return {
        result: [
            {
                archive: 24,
                id,
                logo: "/logo.png",
                name,
                url: "https://live.test/" + id,
            },
        ],
    };
}
function loaded(options) {
    const f = fixture(options);
    let result;
    f.driver.load((value) => {
        result = value;
    });
    f.requests[0].done({ result: {} });
    f.requests[1].done(catalog());
    f.catalog = result;
    return f;
}

test("19 captured JSON session/catalog/guide contracts", () => {
    const captured = require("./fixtures/stalker/legacy.json").cases;
    assert.equal(captured.length, 19);
    for (const [index, contract] of captured.entries()) {
        const f = fixture({ config: contract.input.config });
        let callbacks = 0,
            value,
            epg;
        const errors = [];
        f.driver.load((result, error) => {
            callbacks++;
            value = result;
            if (error)
                errors.push(
                    error === "stalker-connect"
                        ? "Failed to connect to Stalker portal"
                        : "Failed to load channels from Stalker portal"
                );
        });
        for (let i = 0; i < f.requests.length; i++) {
            assert(i < 15, "bounded protocol exchange");
            f.requests[i].done(contract.input.responses[i]);
        }
        if (contract.input.guide && value.ids.length) {
            f.driver.guide(value.ids[0], (data) => {
                epg = { data, id: value.ids[0] };
            });
            f.requests.at(-1).done(contract.input.responses.at(-1));
        }
        assert(
            f.requests.every(
                (r) => r.settings.contentType === "application/json"
            )
        );
        assert.deepEqual(
            clone({
                callbacks,
                calls: f.requests.map(({ settings }) => ({
                    data: JSON.parse(settings.data),
                    method: settings.type,
                    timeout: settings.timeout,
                    url: settings.url,
                })),
                channels: value.channels,
                epg,
                errors,
                groupOrder: value.groupOrder,
                groups: value.groups,
                ids: value.ids,
            }),
            contract.expected,
            "captured contract " + index
        );
    }
});

test("14 captured archive edge contracts call the shipped core", () => {
    const rows = require("./fixtures/archive/providers.json").fixtures.filter(
        (row) => row.provider === "stalker"
    );
    assert.equal(rows.length, 14);
    for (const row of rows) {
        // These fixtures begin at the catalog edge: parsing has separate captured tests above.
        const f = loaded({
            catalog: {
                channels: { 42: row.channel },
                groupOrder: [],
                groups: {},
                ids: [42],
            },
            dune: row.dune,
            now: row.now,
        });
        assert.equal(f.driver.archive(42, row.start, row.end), row.expected);
        assert.equal(f.driver.archive("missing", row.start, row.end), "");
    }
});

test("owned catalogs cannot be mutated through legacy snapshots", () => {
    const f = loaded();
    assert.equal(f.driver.stream(42), "https://live.test/42");
    assert.equal(f.driver.logo(42), "https://portal.test/logo.png");
    f.catalog.channels[42].url = "corrupted";
    f.catalog.channels[42].category.name = "corrupted";
    f.catalog.ids.length = 0;
    f.catalog.groups.Other.length = 0;
    assert.equal(f.driver.stream(42), "https://live.test/42");
    assert.equal(f.driver.capabilities.media, false);
});

test("catalog replacement cancels old catalog and guide even after abort", () => {
    const f = loaded();
    let guide = 0,
        stale = 0,
        current = 0;
    f.driver.guide(42, () => guide++);
    const oldGuide = f.requests.at(-1);
    f.driver.load(() => stale++);
    const oldLoad = f.requests.at(-1);
    assert.equal(oldGuide.aborts, 1);
    f.driver.load(() => current++);
    assert.equal(oldLoad.aborts, 1);
    oldGuide.done({ result: [] });
    oldLoad.done({ result: {} });
    assert.equal(guide, 0);
    assert.equal(stale, 0);
    assert.equal(f.driver.stream(42), "");
    f.requests.at(-1).done({ result: {} });
    f.requests.at(-1).done(catalog(7));
    assert.equal(current, 1);
    assert.equal(f.driver.stream(7), "https://live.test/7");
});

test("provider disposal and credentials changes retire requests and URLs", () => {
    for (const mode of ["save", "replace", "dispose"]) {
        const f = loaded();
        let callbacks = 0;
        f.driver.guide(42, () => callbacks++);
        const request = f.requests.at(-1);
        if (mode === "save")
            f.driver.saveCredentials({
                password: "ignored",
                server: "https://other.test",
                username: "other-mac",
            });
        if (mode === "replace") f.registry.activate("stalker");
        if (mode === "dispose") f.driver.dispose();
        assert.equal(request.aborts, 1);
        request.done({ result: [] });
        request.fail();
        assert.equal(callbacks, 0);
        assert.equal(f.driver.stream(42), "");
        assert.equal(f.driver.logo(42), "");
        assert.equal(f.driver.archive(42, 1, 2), "");
        if (mode === "save")
            assert.deepEqual(JSON.parse(f.saved.get("stalker_data")), {
                data: null,
                mac: "other-mac",
                portal: "https://other.test",
                token: "",
            });
    }
});

test("external account replacement cannot reuse catalog or publish old requests", () => {
    const f = loaded();
    let count = 0;
    f.driver.guide(42, () => count++);
    const request = f.requests.at(-1);
    f.saved.set(
        "stalker_data",
        JSON.stringify({ mac: "different", portal: "https://portal.test/" })
    );
    request.done({ result: [] });
    assert.equal(count, 0);
    assert.equal(f.driver.stream(42), "");
    f.driver.guide(42, (value) => {
        count++;
        assert.equal(value, null);
    });
    assert.equal(count, 1);
});

test("synchronous and duplicate transport completions settle once", () => {
    const f = fixture({ synchronous: [{ result: {} }, catalog()] });
    let calls = 0;
    f.driver.load(() => calls++);
    assert.equal(calls, 1);
    assert.equal(f.driver.stream(42), "https://live.test/42");
    f.requests[0].done({ result: null });
    f.requests[1].done(catalog(7));
    f.requests[1].fail();
    f.driver.dispose();
    assert.equal(calls, 1);
    assert(f.requests.every((r) => r.aborts === 0));
});

test("abort reentry and progress reentry leave the newest operation in control", () => {
    const f = fixture();
    let old = 0,
        outer = 0,
        inner = 0;
    f.driver.load(() => old++);
    f.requests[0].onAbort = () => f.driver.load(() => inner++);
    f.driver.load(() => outer++);
    f.requests.at(-1).done({ result: {} });
    f.requests.at(-1).done(catalog(9));
    assert.deepEqual([old, outer, inner], [0, 0, 1]);
    assert.equal(f.driver.stream(9), "https://live.test/9");
    const g = fixture();
    let first = true;
    g.ports.progress = () => {
        if (first) {
            first = false;
            g.driver.load(() => inner++);
        }
    };
    g.driver.load(() => outer++);
    assert.equal(g.requests.length, 1);
    g.requests[0].done({ result: {} });
    g.requests[1].done(catalog());
    assert.deepEqual([outer, inner], [0, 2]);
});

test("missing or malformed configuration opens settings without network", () => {
    for (const value of [
        null,
        "not-json",
        "null",
        "[]",
        JSON.stringify({ mac: "x" }),
        JSON.stringify({ portal: "https://p.test" }),
    ]) {
        const f = fixture();
        f.saved.set("stalker_data", value);
        let outcome;
        f.driver.load((catalog, error) => {
            outcome = [catalog, error];
        });
        assert.deepEqual(outcome, [null, "credentials"]);
        assert.equal(f.requests.length, 0);
    }
    const f = fixture();
    f.ports.validateUrl = () => false;
    f.driver.load((catalog, error) =>
        assert.deepEqual([catalog, error], [null, "credentials"])
    );
    assert.equal(f.requests.length, 0);
});

test("driver factory only receives injected ports", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../src/provider/stalker-driver.ts"),
        "utf8"
    );
    const factory = source.slice(
        source.indexOf("function createStalkerProviderDriver"),
        source.indexOf("/** Retained menu projection")
    );
    assert(
        !/\b(window|document|localStorage|stalkerApiCall|getChanelsArray|chanels|stbGetItem|stbSetItem|setTimeout)\b/.test(
            factory
        )
    );
});

function settingsFixture() {
    const f = loaded();
    const host = f.host;
    let reloads = 0;
    Object.assign(host, {
        $: () => ({ hide() {} }),
        keys: { ENTER: 13, RETURN: 27 },
        listCaption: {},
        listDetail: {},
        listFooter: {},
        loadChannels: () => reloads++,
        popupActions: [],
        popupArray: [],
        popupDetail: [],
        popupList() {},
        renderButtonHint: () => "",
        showEditKey() {},
        showPage() {},
        strRETURN: "Return",
        toggleProviderSettingsVisibility() {},
    });
    const ui = host.__ottStalkerDriver.mountSettings(host, f.driver, f.owner);
    ui.mount(0);
    return {
        ...f,
        get reloads() {
            return reloads;
        },
        ui,
    };
}

test("portal/MAC editor preserves UI, normalization and canonical persistence", () => {
    const f = settingsFixture(),
        w = f.host;
    assert.equal(
        w.popupArray[0],
        "Stalker portal settings: portal.test (00:1a:79:01:02:03)"
    );
    w.popupActions[0]();
    assert.equal(w.listCaption.innerHTML, "Stalker Portal Provider");
    assert.deepEqual(clone(w.listArray), [
        "Portal URL: https://portal.test/",
        "MAC address: 00:1a:79:01:02:03",
        "",
        "Save and load channels",
    ]);
    w.listKeyHandler(w.keys.ENTER);
    w.editvar = " https://other.test/path/// ";
    w.setEdit();
    w.selIndex = 1;
    w.listKeyHandler(w.keys.ENTER);
    w.editvar = " 00:1a:2b:3c:4d:5e ";
    w.setEdit();
    assert.equal(f.driver.credentials().server, "https://portal.test/");
    w.selIndex = 3;
    const save = w.listKeyHandler;
    save(w.keys.ENTER);
    save(w.keys.ENTER);
    assert.equal(f.reloads, 1);
    assert.deepEqual(JSON.parse(f.saved.get("stalker_data")), {
        data: null,
        mac: "00:1A:2B:3C:4D:5E",
        portal: "https://other.test/path",
        token: "",
    });
    assert.equal(
        w.popupArray[0],
        "Stalker portal settings: other.test (00:1A:2B:3C:4D:5E)"
    );
});

test("editor cancellation, replacement and duplicate callbacks cannot write", () => {
    for (const mode of ["cancel", "editor", "owner"]) {
        const f = settingsFixture(),
            w = f.host;
        const original = f.saved.get("stalker_data");
        f.ui.edit();
        w.listKeyHandler(w.keys.ENTER);
        const complete = w.setEdit;
        const oldKeys = w.listKeyHandler;
        if (mode === "cancel") w.listKeyHandler(w.keys.RETURN);
        if (mode === "editor") f.ui.edit();
        if (mode === "owner") f.registry.activate("stalker");
        const display = clone(w.listArray);
        w.editvar = "https://stale.test";
        complete();
        w.selIndex = 3;
        oldKeys(w.keys.ENTER);
        assert.equal(f.saved.get("stalker_data"), original);
        assert.deepEqual(clone(w.listArray), display);
        assert.equal(f.reloads, 0);
    }
    const f = settingsFixture(),
        w = f.host;
    f.ui.edit();
    w.listKeyHandler(w.keys.ENTER);
    const first = w.setEdit;
    w.editvar = "https://first.test";
    first();
    w.editvar = "https://duplicate.test";
    first();
    assert.equal(w.listArray[0], "Portal URL: https://first.test");
    w.selIndex = 1;
    w.listKeyHandler(w.keys.ENTER);
    first();
    assert.equal(w.listArray[0], "Portal URL: https://first.test");
});

test("injected hash reentry cannot publish the displaced catalog", () => {
    const f = fixture();
    let old = 0,
        current = 0;
    const hash = f.ports.hash;
    f.ports.hash = (value) => {
        f.driver.load(() => current++);
        return hash(value);
    };
    f.driver.load(() => old++);
    f.requests[0].done({ result: {} });
    f.requests[1].done({ result: [{ name: "Hashed" }] });
    assert.equal(old, 0);
    f.requests[2].done({ result: {} });
    f.requests[3].done(catalog());
    assert.equal(current, 1);
});

const { integrationFixture } = require("./helpers/provider-driver-fixture.cjs");
function startup(settings = {}) {
    return integrationFixture("stalker", {
        stalkerstalker_data: JSON.stringify({
            mac: "00:1A:2B:3C:4D:5E",
            portal: "https://portal.test/",
        }),
        ...settings,
    });
}

test("actual loadProv/loadChannels startup binds a private instance without scripts or ajax mutation", () => {
    const f = startup();
    f.host.loadProv();
    assert.equal(f.host.__ottActiveProviderDriver.id, "stalker");
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve({ result: {} });
    f.requests[1].resolve(catalog());
    assert.equal(f.completed, 1);
    assert.deepEqual(Array.from(f.host.cList), [42]);
    assert.equal(f.host.getChannelUrl(42), "https://live.test/42");
    assert.equal(f.host.getChannelPicon(42), "https://portal.test/logo.png");
    let guide;
    f.host.getChannelEpg(42, (id, rows) => {
        guide = { id, rows };
    });
    assert.equal(f.requests[2].settings.timeout, 10000);
    f.requests[2].resolve({
        result: [{ end: 20, name: "Programme", start: 10 }],
    });
    assert.equal(guide.id, 42);
    assert.equal(guide.rows[0].name, "Programme");
    assert.deepEqual(f.scripts, []);
    assert.equal(f.ajaxWrites, 0);
    assert.equal(f.host.getMediaArray, null);
    f.host.providerSetItem("continueWatch", "bookmark");
    assert.equal(f.saved.get("stalkercontinueWatch"), "bookmark");
});

test("actual startup reports protocol failures and opens the preserved editor for missing credentials", () => {
    for (const channels of [false, true]) {
        const f = startup();
        f.host.loadProv();
        f.requests[0].resolve({ result: channels ? {} : null });
        f.requests[1].resolve({ result: null });
        assert.equal(f.completed, 1);
        assert.deepEqual(f.errors, [
            channels
                ? "Failed to load channels from Stalker portal"
                : "Failed to connect to Stalker portal",
        ]);
    }
    const f = startup({ stalkerstalker_data: "{}" });
    f.host.loadProv();
    assert.equal(f.requests.length, 0);
    assert.equal(f.completed, 0);
    assert.equal(f.host.listCaption.innerHTML, "Stalker Portal Provider");
    assert.equal(f.host.listArray.length, 4);
    assert.equal(f.host.listArray[0], "Portal URL: ");
});

test("actual host reload and replacement reject every displaced Stalker stage", () => {
    for (const stage of ["handshake", "retry", "catalog", "guide"]) {
        const f = startup();
        f.host.loadProv();
        if (stage === "retry") f.requests[0].resolve({ result: null });
        if (stage === "catalog" || stage === "guide")
            f.requests[0].resolve({ result: {} });
        let guides = 0;
        if (stage === "guide") {
            f.requests[1].resolve(catalog());
            f.host.getChannelEpg(42, () => guides++);
        }
        const pending = f.requests.at(-1);
        f.host.loadProv("demo");
        assert.equal(pending.aborts, 1);
        const count = f.requests.length;
        const completed = f.completed;
        pending.resolve(catalog(7));
        pending.reject();
        assert.equal(f.requests.length, count);
        assert.equal(f.completed, completed);
        assert.equal(guides, 0);
        assert.equal(f.host.__ottActiveProviderDriver.id, "demo");
        assert.deepEqual(Array.from(f.host.cList), [900000001, 900000002]);
    }
    const f = startup();
    f.host.loadProv();
    f.requests[0].resolve({ result: {} });
    f.requests[1].resolve(catalog());
    f.host.loadChannels();
    f.requests[2].resolve({ result: {} });
    f.requests[3].resolve({ result: null });
    assert.deepEqual(Array.from(f.host.cList), []);
    assert.equal(f.host.getChannelUrl(42), "");
    assert.equal(f.completed, 2);
});

test("teardown reentry keeps newer managed or legacy source selection authoritative", () => {
    for (const newer of ["demo", "stalker", "m3u"]) {
        const f = startup();
        f.host.loadProv();
        const pending = f.requests[0];
        const abort = pending.abort.bind(pending);
        pending.abort = () => {
            abort();
            if (newer !== "demo") f.saved.set("ottplayprov", newer);
            f.host.loadProv(newer);
        };
        f.saved.set("ottplayprov", "xtream");
        f.host.loadProv("xtream");
        assert.equal(pending.aborts, 1);
        assert.equal(
            f.host.__ottActiveProviderDriver?.id ?? null,
            newer === "m3u" ? null : newer
        );
        const requestCount = f.requests.length;
        const command = f.host.__ottCommandChannelLoad;
        pending.resolve(catalog(7));
        pending.reject();
        assert.equal(f.requests.length, requestCount);
        assert.equal(f.host.__ottCommandChannelLoad, command);
        if (newer === "demo") {
            assert.deepEqual(Array.from(f.host.cList), [900000001, 900000002]);
            assert.equal(f.completed, 1);
            assert.equal(f.host.commandChannelsReady, true);
            assert.equal(f.requests.length, 1);
        } else if (newer === "stalker") {
            assert.equal(f.requests.length, 2);
            f.requests[1].resolve({ result: {} });
            f.requests[2].resolve(catalog(9));
            assert.equal(f.completed, 1);
            assert.deepEqual(Array.from(f.host.cList), [9]);
            assert.equal(f.host.commandChannelsReady, true);
        } else {
            assert.equal(f.requests.length, 1);
            assert.equal(f.scripts.length, 1);
            assert.equal(
                f.scripts[0].url,
                "https://player.test/prov/m3u/prov.js?test"
            );
            assert.equal(f.completed, 0);
            assert.equal(f.host.commandChannelsReady, false);
        }
    }
});

console.log("PASS " + groups + " Stalker driver scenario groups");

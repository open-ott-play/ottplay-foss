"use strict";
const assert = require("node:assert/strict");
const fixture = require("./helpers/m3u-driver-fixture.cjs");
const clone = (value) => JSON.parse(JSON.stringify(value));
const playlist =
    '#EXTM3U url-tvg="https://xml.test/main.xml"\n#EXTINF:-1 tvg-id="one" group-title="News",One\nhttps://cdn.test/one/index.m3u8\n#EXTINF:-1 tvg-id="two" group-title="News",Two\nhttps://cdn.test/two/index.m3u8\n';
const portal = "portal::[key:PRIVATE_FIXTURE]https://portal.test/api/v1/";
const secondPortal = "portal::[key:OTHER_FIXTURE]https://second.test/api/v1/";
let passed = 0;
function test(name, run) {
    run();
    passed++;
    console.log("PASS M3U driver: " + name);
}
function load(f, body = playlist) {
    const driver = f.start();
    let completed = 0;
    f.host.getChannelsArray(() => completed++);
    f.requests[0].resolve(body);
    return { completed, driver };
}
function key(f, index, value, slot = 0) {
    f.host.doEditListData(slot);
    f.host.selIndex = index;
    f.host.listKeyHandler(f.host.keys.ENTER);
    f.host.editvar = value;
    f.host.setEdit();
}

test("14 captured M3U catalogs and matching request bodies retain legacy channel identity", () => {
    for (const row of require("./fixtures/playlist/legacy.json").cases) {
        const f = fixture(),
            { completed } = load(f, row.input);
        const actual = clone({
            callbacks: completed,
            channels: f.host.channels,
            groupOrder: f.host.catsArray,
            groups: f.host.cats,
            ids: f.host.cList,
        });
        const expected = clone(row.main);
        delete expected.epgConfig;
        delete expected.epgBody;
        delete expected.logoBody;
        assert.deepEqual(actual, expected, row.input);
        for (const [suffix, body] of [
            ["channels", row.main.epgBody],
            ["logos", row.main.logoBody],
        ]) {
            const request = f.requests.find((item) =>
                item.settings.url.endsWith("/match-" + suffix)
            );
            assert.equal(
                request?.settings.data.split("\n\t\n")[2] || "",
                body,
                suffix + ":" + row.input
            );
        }
        f.dom.window.close();
    }
});

test("15 slots normalize corrupt configurations and preserve per-slot history/journal namespaces", () => {
    for (const raw of [
        "invalid",
        "null",
        "[]",
        '{"active":999,"M3Us":[null]}',
    ]) {
        const f = fixture({ storage: { m3um3uArr: raw } }),
            driver = f.start();
        assert.equal(driver.configuration().active, 0);
        assert.equal(driver.configuration().M3Us.length, 15);
        assert.equal(
            f.saved.get("m3um3uArr"),
            raw,
            "normalization on read is nondestructive"
        );
    }
    const f = fixture(),
        driver = f.start();
    for (let index = 0; index < 15; index++) {
        const cfg = driver.configuration();
        cfg.active = index;
        driver.saveConfiguration(cfg);
        f.host.providerSetItem("medHistory", String(index));
        f.host.providerSetItem("playbackJournal", String(index));
        assert.equal(
            f.saved.get("m3umedHistory" + (index || "")),
            String(index)
        );
        assert.equal(
            f.saved.get("m3uplaybackJournal" + (index || "")),
            String(index)
        );
        assert.equal(driver.storageKey("m3uArr"), "m3um3uArr");
        assert.equal(f.host.m3uArr.active, index);
    }
    const detached = driver.configuration();
    detached.M3Us[14].www = "corrupt";
    assert.notEqual(driver.configuration().M3Us[14].www, "corrupt");
});

test("direct timeout/proxy fallback/interception/local files retain request contract and finish once", () => {
    const intercepted = [],
        f = fixture({ intercept: (value) => intercepted.push(value) });
    const driver = f.start();
    let completed = 0;
    driver.load(() => completed++);
    assert.deepEqual(intercepted, ["https://playlist.test/list.m3u"]);
    assert.equal(f.requests[0].settings.timeout, 5000);
    assert(f.requests[0].settings.url.includes("?url=https%3A"));
    f.requests[0].reject();
    assert.deepEqual(clone(f.requests[1].settings), {
        data: { url: "@https://playlist.test/list.m3u" },
        dataType: "text",
        method: "post",
        timeout: 15000,
        url: "https://relay.test/m3u/cp.php",
    });
    f.requests[1].resolve(playlist);
    f.requests[1].reject();
    assert.equal(completed, 1);
    const local = fixture({
        config: { active: 0, M3Us: [{ www: "/sdcard/a.m3u" }] },
        readFile: (path) => {
            assert.equal(path, "/sdcard/a.m3u");
            return playlist;
        },
    });
    local.start();
    local.host.getChannelsArray(() => {});
    assert.equal(local.host.cList.length, 2);
    assert(local.requests.every((r) => r.settings.type === "POST"));
});

test("matching companion uses the relay hostname and preserves custom and relative relays without URL", () => {
    for (const [relay, crossOrigin, origin, expected] of [
        ["https://ottp.eu.org", true, "player.test", "http://ottp.eu.org"],
        [
            "https://ottp.eu.org:8443/api",
            false,
            "player.test:8080",
            "http://player.test:8080",
        ],
        ["https://OTTP.EU.ORG/api", true, "player.test", "http://ottp.eu.org"],
        ["//ottp.eu.org/api", true, "player.test", "http://ottp.eu.org"],
        [
            "https://user:pass@ottp.eu.org/api",
            true,
            "player.test",
            "http://ottp.eu.org",
        ],
        [
            "https://relay.test/ottp.eu.org",
            true,
            "player.test",
            "https://relay.test/ottp.eu.org",
        ],
        [
            "https://relay.test?host=ottp.eu.org",
            true,
            "player.test",
            "https://relay.test?host=ottp.eu.org",
        ],
        [
            "https://ottp.eu.org.relay.test",
            true,
            "player.test",
            "https://ottp.eu.org.relay.test",
        ],
        [
            "https://prefix-ottp.eu.org",
            true,
            "player.test",
            "https://prefix-ottp.eu.org",
        ],
        [
            "https://ottp.eu.org@relay.test",
            true,
            "player.test",
            "https://ottp.eu.org@relay.test",
        ],
        [
            "https://private.test/companion",
            false,
            "player.test",
            "https://private.test/companion",
        ],
        [
            "//private.test/companion",
            false,
            "player.test",
            "//private.test/companion",
        ],
        ["/proxy/ottp.eu.org", true, "player.test", "/proxy/ottp.eu.org"],
        ["./ottp.eu.org", false, "player.test", "./ottp.eu.org"],
        ["", false, "player.test:8080", "http://player.test:8080"],
        ["", false, "ottp.eu.org", "http://ottp.eu.org"],
    ]) {
        const f = fixture({ crossOrigin });
        f.host.host = relay;
        f.host.location.host = origin;
        f.host.URL = undefined;
        load(f);
        const matches = f.requests.filter((request) =>
            /\/m3u\/match-(channels|logos)$/.test(request.settings.url)
        );
        assert(matches.length > 0, relay);
        for (const request of matches)
            assert.equal(
                request.settings.url.split("/m3u/")[0],
                expected,
                relay
            );
        f.dom.window.close();
    }
});

test("native XMLTV metadata carries source aliases while browser protocol stays minimal", () => {
    const text =
        '#EXTM3U url-tvg="https://xml.test/one.xml,//xml.test/two.xml" foss-tvg="alias::https://xml.test/custom.xml"\n#EXTINF:-1 tvg-id="one" tvg-source="#2,#alias" tvg-name="Native name",One\nhttps://cdn.test/live\n';
    for (const native of [false, true]) {
        const f = fixture({ native }),
            { driver } = load(f, text);
        const post = f.requests.find((r) =>
            r.settings.url.endsWith("/match-channels")
        );
        const metadata = JSON.parse(post.settings.data.split("\n\t\n")[0]);
        if (native) {
            const id = f.host.cList[0];
            assert.deepEqual(metadata.native_channels[id].xmltv_urls, [
                "https://xml.test/two.xml",
                "https://xml.test/custom.xml",
            ]);
            assert.equal(metadata.native_channels[id].tvg_name, "Native name");
        } else assert.deepEqual(metadata, {});
        assert(driver.stream(f.host.cList[0]));
    }
});

test("late matching patches owned route/logo only, refreshes missing EPG and retains valid schedule state", () => {
    const f = fixture({ crossOrigin: false }),
        { driver } = load(f);
    const ids = f.host.cList;
    f.host.curList = ids.slice();
    f.host.primaryIndex = 0;
    for (const id of ids)
        Object.assign(f.host.channels[id], {
            name: "Old programme",
            time: 10,
            time_request: Date.now() / 1000 + 3600,
        });
    const guide = f.requests.find((r) =>
        r.settings.url.endsWith("/match-channels")
    );
    guide.resolve(
        "{}\n\t\n" +
            ids.map((id, i) => id + "~s~c" + i).join("\n") +
            "\n\t\ns~http://epg.ottp.eu.org/"
    );
    assert.equal(f.host.channels[ids[1]].time_request, 0);
    assert(f.events.some((e) => e[0] === "refresh" && e[1] === ids[1]));
    assert.equal(f.host.channels[ids[0]].name, "Old programme");
    assert.equal(f.host.channels[ids[0]].time, 10);
    let rows;
    driver.guide(ids[0], (value) => (rows = value));
    const pending = f.requests.at(-1);
    assert.equal(
        pending.settings.url,
        "http://player.test/e/epg/c0.json?hours=48"
    );
    const response = { epg_data: [{ name: "New", time: 100, time_to: 200 }] };
    pending.resolve(response);
    assert.equal(rows[0].name, "New");
    rows[0].time = -1;
    assert.equal(response.epg_data[0].time, 100);
    const logo = f.requests.find((r) =>
        r.settings.url.endsWith("/match-logos")
    );
    logo.resolve("{}\n\t\n" + ids[0] + "~https://icons.test/new.png");
    assert.equal(driver.logo(ids[0]), "https://icons.test/new.png");
    f.host.channels[ids[0]].url = "corrupt";
    f.host.channels[ids[0]].epg_url = "corrupt";
    assert.notEqual(driver.stream(ids[0]), "corrupt");
    assert(!driver.currentGuideUrl(ids[0]).includes("corrupt"));
});

test("slot/provider/reload replacement cancels every playlist and matching stage, ignoring hostile late responses", () => {
    for (const phase of ["direct", "proxy", "guide", "logo", "epg"])
        for (const retire of ["slot", "provider", "reload"]) {
            const f = fixture(),
                driver = f.start();
            let calls = 0;
            driver.load(() => calls++);
            if (phase === "proxy") f.requests[0].reject();
            if (["guide", "logo", "epg"].includes(phase))
                f.requests[0].resolve(playlist);
            let pending = phase === "guide" ? f.requests[1] : f.requests.at(-1);
            if (phase === "epg") {
                const catalog = f.host.OttPlayCore.parseProviderPlaylist(
                    playlist,
                    "m3u",
                    (url) => f.host.murmurhash3_32_gc(url, 10),
                    48
                );
                const id = catalog.ids[0];
                f.requests[1].resolve(
                    "{}\n\t\n" + id + "~s~one\n\t\ns~http://epg.test/"
                );
                driver.guide(id, () => calls++);
                pending = f.requests.at(-1);
            }
            if (retire === "provider") f.mount("demo");
            if (retire === "reload") driver.load(() => {});
            if (retire === "slot") {
                const cfg = driver.configuration();
                cfg.active = 1;
                cfg.M3Us[1].www = "https://second.test/list";
                driver.saveConfiguration(cfg);
            }
            assert.equal(pending.aborts, 1, phase + ":" + retire);
            const count = f.requests.length,
                before = calls;
            pending.resolve(playlist);
            pending.reject();
            assert.equal(f.requests.length, count);
            assert.equal(calls, before);
        }
});

test("failed reload clears stale streams and external raw slot changes invalidate requests without publication", () => {
    const f = fixture(),
        { driver } = load(f),
        id = f.host.cList[0];
    driver.load(() => {});
    f.requests.at(-1).reject();
    f.requests.at(-1).reject();
    assert.equal(driver.stream(id), "");
    let complete = 0;
    driver.load(() => complete++);
    const pending = f.requests.at(-1);
    f.saved.set(
        "m3um3uArr",
        JSON.stringify({ active: 1, M3Us: [{}, { www: "https://new.test/" }] })
    );
    pending.resolve(playlist);
    assert.equal(complete, 0);
    assert.equal(driver.storageKey("medHistory"), "m3umedHistory1");
});

test("settings editors mask portal keys, guard stale handlers, import files and scope reset to edited active slot", () => {
    const f = fixture({
            config: {
                active: 0,
                M3Us: [
                    { medUrl: portal, www: "https://playlist.test/old" },
                    { www: "https://other.test/" },
                ],
            },
            readFile: () => playlist,
        }),
        driver = f.start();
    f.host.providerSetItem("playbackJournal", "old");
    f.saved.set("m3uplaybackJournal1", "keep");
    f.host.doEditListData(0);
    assert(!f.host.listArray.join(" ").includes("PRIVATE_FIXTURE"));
    f.host.selIndex = 2;
    f.host.listKeyHandler(f.host.keys.ENTER);
    f.host.editvar = "/sdcard/new.m3u";
    f.host.setEdit();
    assert.equal(driver.configuration().M3Us[0].www, "/sdcard/new.m3u");
    assert.equal(f.saved.get("m3uplaybackJournal"), undefined);
    assert.equal(f.saved.get("m3uplaybackJournal1"), "keep");
    assert(f.events.some((e) => e[0] === "suspend-journal"));
    f.host.doEditListData(0);
    f.host.selIndex = 0;
    f.host.listKeyHandler(f.host.keys.ENTER);
    const old = f.host.setEdit;
    f.host.doEditListData(1);
    f.host.editvar = "stale";
    old();
    assert.notEqual(driver.configuration().M3Us[0].name, "stale");
    key(f, 4, "invalid portal");
    const reopen = Array.from(f.timers.values()).at(-1);
    const count = f.edits.length;
    f.mount("demo");
    reopen();
    assert.equal(f.edits.length, count);
});

test("VPortal cold initialization, unchanged refresh, slot cancellation and source-history identity use real client", () => {
    const f = fixture({
            config: {
                active: 0,
                M3Us: [
                    { medUrl: portal, name: "Home", www: "https://tv.test/" },
                    { medUrl: secondPortal, www: "https://tv.test/" },
                ],
            },
        }),
        driver = f.start();
    const client = f.host.providerMediaClient;
    assert(client);
    const sourceId = driver.configuration().M3Us[0].medSourceId;
    assert(sourceId);
    let completed = 0;
    f.host.getMediaArray("", () => completed++);
    assert.equal(f.requests[0].settings.url, "https://relay.test/vportal/api");
    assert.equal(
        JSON.parse(f.requests[0].settings.data).params.key,
        "PRIVATE_FIXTURE"
    );
    f.host.duneAddSettings(0);
    assert.equal(f.host.providerMediaClient, client);
    assert.equal(f.requests[0].aborts, 0);
    f.requests[0].resolve({
        items: [
            { request: { cmd: "play", id: 1 }, title: "Movie", type: "stream" },
        ],
        type: "category",
    });
    assert.equal(completed, 1);
    const oldItem = f.host.mediaRecords[0];
    f.host.providerSetItem("medHistory", "saved-history");
    f.host.getMediaArray("", () => completed++);
    const pending = f.requests.at(-1);
    f.host.selectAndRestart(1);
    assert.equal(pending.aborts, 1);
    assert.equal(f.host.providerGetItem("medHistory"), null);
    assert.equal(f.saved.get("m3umedHistory"), "saved-history");
    pending.resolve({
        items: [
            { title: "Stale", type: "stream", url: "https://old.test/a.mp4" },
        ],
        type: "category",
    });
    assert.equal(completed, 1);
    assert.equal(f.host.mediaRecords.length, 0);
    const count = f.requests.length;
    f.host.playMedia(oldItem);
    assert.equal(f.requests.length, count);
    client.play(oldItem);
    assert.equal(f.requests.length, count);
    key(f, 3, "", 1);
    assert.equal(f.host.getMediaArray, null);
    assert.equal(f.host.playMedia, f.host._playMedia);
});

test("public HTML params retain15 slots and tolerate malformed escapes; Dune n parameter pins selected slot", () => {
    const f = fixture(),
        driver = f.start();
    assert.equal(f.host.getProviderParams(), "https://playlist.test/list.m3u");
    f.forms["#www0"] = "https://new.test/%broken";
    f.forms["#rechours0"] = "72";
    f.forms["input[name=odin]:checked"] = 0;
    assert.equal(f.host.setProviderParams(), true);
    assert.equal(
        driver.configuration().M3Us[0].www,
        "https://new.test/%broken"
    );
    assert.equal(driver.configuration().M3Us.length, 15);
    const d = fixture({
            config: { active: 1, M3Us: [] },
            dune: true,
            href: "http://player.test/?m3u&n=15",
        }),
        dd = d.start();
    assert.equal(dd.configuration().active, 14);
    d.host.selectAndRestart(1);
    assert.equal(dd.configuration().active, 14);
});

test("Dune saved XML/JSON/M3U catalogs use owned media transport with MAC and stale navigation guards", () => {
    for (const format of ["json", "xml", "m3u"]) {
        const f = fixture({
            config: {
                active: 0,
                M3Us: [
                    {
                        medUrl: "https://catalog.test/root",
                        www: "https://tv.test/",
                    },
                ],
            },
            dune: true,
        });
        f.start();
        let complete = 0;
        f.host.mediaUrls = [""];
        f.host.getMediaArray("", () => complete++);
        const request = f.requests[0];
        assert(request.settings.url.includes("box_mac=001122334455"));
        const body =
            format === "json"
                ? JSON.stringify({
                      channels: [
                          { stream_url: "https://video.test/a", title: "Film" },
                      ],
                      next_page_url: "next",
                      title: "Library",
                  })
                : format === "xml"
                  ? "<items><playlist_name>Library</playlist_name><channels><channel><title>Film</title><stream_url>https://video.test/a</stream_url></channel></channels><next_page_url>next</next_page_url></items>"
                  : "#EXTM3U\n#EXTINF:-1,Film\nhttps://video.test/a\n";
        request.resolve(body);
        assert.equal(complete, 1);
        assert.equal(f.host.mediaRecords[0].title, "Film");
        f.host.getMediaArray("next", () => complete++);
        const pending = f.requests.at(-1);
        f.mount("demo");
        pending.resolve(body);
        assert.equal(complete, 1);
        assert.equal(pending.aborts, 1);
    }
});

test("actual loadProv/loadChannels boot owns M3U without dynamic script or source callback resurrection", () => {
    const f = fixture({ integration: true });
    f.start();
    assert.equal(f.host.__ottActiveProviderDriver.id, "m3u");
    f.requests[0].resolve(playlist);
    assert.equal(f.completed, 1);
    assert.equal(f.host.cList.length, 2);
    assert.deepEqual(f.scripts, []);
    f.host.loadChannels();
    const pending = f.requests.at(-1);
    f.host.loadProv("demo");
    pending.resolve(playlist);
    assert.equal(f.host.__ottActiveProviderDriver.id, "demo");
    assert.equal(f.completed, 2);
});

test("54 captured archive rules use owned metadata with real core and current clock", () => {
    for (const row of require("./fixtures/archive/providers.json").fixtures.filter(
        (row) => row.provider === "m3u"
    )) {
        const f = fixture({ dune: row.dune });
        require("node:vm").runInContext(
            "Date.now=function(){return " + row.now * 1000 + ";};",
            f.host
        );
        f.host.OttPlayCore.parseProviderPlaylist = () => ({
            channels: { 42: clone(row.channel) },
            entries: [],
            groupOrder: [],
            groups: {},
            header: "#EXTM3U",
            ids: [42],
        });
        const { driver } = load(f);
        assert.equal(
            driver.archive(42, row.start, row.end),
            row.expected,
            JSON.stringify(row)
        );
        assert.equal(driver.archive("missing", row.start, row.end), "");
    }
});

test("direct guide aliases and archive lookback shift detached programme timestamps once", () => {
    const f = fixture(),
        { driver } = load(
            f,
            '#EXTM3U foss-tvg="=fixed::https://direct.test/epg/"\n#EXTINF:-1 tvg-id="one" tvg-source="=fixed" tvg-shift="2" tvg-logo="https://icons.test/logo.png",One\nhttps://cdn.test/one\n'
        );
    const id = f.host.cList[0];
    assert.equal(f.requests.length, 1);
    assert(driver.currentGuideUrl(id).startsWith("https://direct.test/epg/"));
    const callbacks = [];
    driver.guide(id, (value) => callbacks.push(value));
    const request = f.requests.at(-1);
    assert(request.settings.url.endsWith(".json?hours=48"));
    const input = {
        epg_data: [{ name: "Shifted", time: 100, time_to: 200 }, null],
    };
    request.resolve(input);
    request.resolve(input);
    request.reject();
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0][0].time, -7100);
    assert.equal(input.epg_data[0].time, 100);
    driver.guide(id, (value) => callbacks.push(value));
    f.requests.at(-1).resolve({ epg_data: { malformed: true } });
    assert.equal(callbacks[1], null);
});

test("empty/portal/local-read-failure startup finishes safely or opens preserved editor", () => {
    for (const url of ["", portal, "/broken.m3u"]) {
        const f = fixture({
            config: { active: 0, M3Us: [{ www: url }] },
            readFile: () => {
                throw Error("file");
            },
        });
        f.start();
        let completed = 0;
        assert.doesNotThrow(() => f.host.getChannelsArray(() => completed++));
        assert.equal(completed, url ? 1 : 0);
        assert.equal(f.requests.length, 0);
        if (!url)
            assert.equal(f.host.listCaption.innerHTML, "Edit playlist data");
        else assert.equal(f.errors.length, 1);
    }
});

test("catalog teardown, editor save and injected hashing reentry preserve newer work", () => {
    const f = fixture(),
        driver = f.start();
    driver.load(() => {});
    const pending = f.requests[0],
        abort = pending.abort.bind(pending);
    pending.abort = () => {
        abort();
        f.mount("demo");
    };
    const before = f.saved.get("m3um3uArr");
    key(f, 1, "https://changed.test/");
    assert.equal(f.saved.get("m3um3uArr"), before);
    assert.equal(f.host.__ottActiveProviderDriver.id, "demo");
    assert.equal(f.reloads, 0);
    const h = fixture(),
        d = h.start(),
        hash = h.host.murmurhash3_32_gc;
    let first = true,
        old = 0,
        newer = 0;
    h.host.murmurhash3_32_gc = (...args) => {
        if (first) {
            first = false;
            d.load(() => newer++);
            h.requests
                .at(-1)
                .resolve(
                    '#EXTM3U foss-tvg="=new::https://new.test/epg/"\n#EXTINF:-1 tvg-id="new" tvg-source="=new" tvg-logo="https://icons.test/n.png",New\nhttps://new.test/live\n'
                );
        }
        return hash(...args);
    };
    d.load(() => old++);
    h.requests[0].resolve(
        '#EXTM3U foss-tvg="=old::https://old.test/epg/"\n#EXTINF:-1 tvg-id="old" tvg-source="=old",Old\nhttps://old.test/live\n'
    );
    assert.equal(old, 0);
    assert.equal(newer, 1);
    assert.equal(h.requests.length, 2);
    assert.equal(d.stream(hash("https://old.test/live", 10)), "");
    assert(
        d
            .currentGuideUrl(hash("https://new.test/live", 10))
            .startsWith("https://new.test/epg/")
    );
});

test("replacing active portal preserves history but rejects old source requests and pending UI", () => {
    const f = fixture({
            config: {
                active: 0,
                M3Us: [{ medUrl: portal, www: "https://tv.test/" }],
            },
        }),
        driver = f.start();
    const original = driver.configuration().M3Us[0].medSourceId;
    f.host.getMediaArray("", () => {});
    f.requests[0].resolve({
        items: [
            { request: { cmd: "play", id: 1 }, title: "Movie", type: "stream" },
        ],
        type: "category",
    });
    const old = f.host.mediaRecords[0];
    f.host.providerSetItem("medHistory", JSON.stringify([old]));
    const history = f.saved.get("m3umedHistory");
    f.host.getMediaArray("", () => {});
    const pending = f.requests.at(-1);
    key(f, 3, secondPortal);
    assert.equal(pending.aborts, 1);
    assert.notEqual(driver.configuration().M3Us[0].medSourceId, original);
    assert.equal(f.saved.get("m3umedHistory"), history);
    const count = f.requests.length;
    f.host.playMedia(old);
    assert.equal(f.requests.length, count);
});

test("Dune busy view closes on cancel/Return/source change without hiding a replacement dialog", () => {
    for (const action of ["cancel", "return", "source", "foreign"]) {
        const f = fixture({
            config: {
                active: 0,
                M3Us: [
                    {
                        medUrl: "https://vod.test/root",
                        www: "https://tv.test/",
                    },
                ],
            },
            dune: true,
        });
        f.start();
        let calls = 0;
        const previous = () => true;
        f.host.dialogBoxKeyHandler = previous;
        f.host.getMediaArray("", () => calls++);
        const pending = f.requests[0],
            handler = f.host.dialogBoxKeyHandler;
        if (action === "foreign") {
            f.host.dialogBoxKeyHandler = () => true;
            f.panels["#dialogbox"].html = "Other view";
        }
        if (action === "source") f.mount("demo");
        else if (action === "return") handler(f.host.keys.RETURN);
        else f.host.providerMediaClient.cancel();
        assert.equal(pending.aborts, 1);
        assert.equal(f.panels["#dialogbox"].visible, action === "foreign");
        if (action !== "foreign")
            assert.equal(f.host.dialogBoxKeyHandler, previous);
        pending.resolve('{"channels":[{"title":"Late"}]}');
        assert.equal(calls, 0);
        if (action === "foreign")
            assert.equal(f.panels["#dialogbox"].html, "Other view");
    }
});

test("guide projection stops refreshing the old view when a row callback replaces source or catalog", () => {
    for (const replace of ["source", "catalog"]) {
        const f = fixture(),
            { driver } = load(
                f,
                playlist +
                    '#EXTINF:-1 tvg-id="three",Three\nhttps://cdn.test/three\n'
            );
        const ids = f.host.cList;
        f.host.curList = ids.slice();
        f.host.primaryIndex = 0;
        for (const id of ids)
            f.host.channels[id].time_request = Date.now() / 1000 + 50;
        let refresh = 0;
        f.host.getCurProgData = () => {
            refresh++;
            if (replace === "source") f.mount("demo");
            else driver.load(() => {});
        };
        const before = f.events.filter((e) => e[0] === "info").length;
        f.requests[1].resolve(
            "{}\n\t\n" +
                ids.map((id) => id + "~s~" + id).join("\n") +
                "\n\t\ns~https://epg.test/"
        );
        assert.equal(refresh, 1);
        assert.equal(f.events.filter((e) => e[0] === "info").length, before);
    }
});

test("programmatic and raw portal replacement rotate media identity and reject retained old requests", () => {
    for (const raw of [false, true]) {
        const f = fixture({
                config: {
                    active: 0,
                    M3Us: [{ medUrl: portal, www: "https://tv.test/" }],
                },
            }),
            driver = f.start();
        f.host.getMediaArray("", () => {});
        f.requests[0].resolve({
            items: [
                {
                    request: { cmd: "play", id: 7 },
                    title: "Movie",
                    type: "stream",
                },
            ],
            type: "category",
        });
        const item = f.host.mediaRecords[0],
            oldId = driver.configuration().M3Us[0].medSourceId,
            cfg = driver.configuration();
        cfg.M3Us[0].medUrl = secondPortal;
        if (raw) {
            f.saved.set("m3um3uArr", JSON.stringify(cfg));
            f.host.m3uUpdateMedia();
        } else driver.saveConfiguration(cfg);
        assert.notEqual(driver.configuration().M3Us[0].medSourceId, oldId);
        const count = f.requests.length;
        f.host.playMedia(item);
        assert.equal(f.requests.length, count);
    }
});

console.log("PASS M3U provider driver: " + passed + " scenario groups");

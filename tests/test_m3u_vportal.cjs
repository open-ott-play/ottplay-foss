const {
    attachSourceAliases,
    sourceNames,
} = require("./helpers/english-source-fixture.cjs");
/* Exercise the shipped M3U settings and loader against the shared VPortal client. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const bundled = process.argv.includes("--bundle");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const adapter = read("prov/m3u/prov.js");
const portal = "portal::[key:FIXTURE_PRIVATE_KEY]http://portal.invalid/api/v1/";
const otherPortal =
    "portal::[key:OTHER_PRIVATE_KEY]https://other.invalid/api/v1/";
const playlist = "https://television.invalid/live.m3u";
acorn.parse(adapter, { ecmaVersion: 5 });

function transpile(source) {
    return ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
}

function declarations(file, names) {
    names = sourceNames(file, names);
    const ast = ts.createSourceFile(
        file,
        read(file),
        ts.ScriptTarget.Latest,
        true
    );
    const selected = ast.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) && names.includes(node.name.text)
    );
    assert.equal(
        selected.length,
        names.length,
        "all production functions found"
    );
    return transpile(
        selected
            .map((node) => node.getText(ast).replace(/^export\s+/, ""))
            .join("\n")
    );
}

const clientCode = bundled
    ? read("dist/stbPlayer.js")
    : declarations("src/utils/helpers.ts", [
          "metadataText",
          "metadataImageUrl",
      ]) +
      transpile(
          read("src/plugins/vportal.ts")
              .replace(/^import[^;]+;\s*/gm, "")
              .replace(/^export\s+/gm, "")
      );
const cancellationCode = declarations("src/channels/index.ts", [
    "rememberMediaView",
    "cancelMediaLoad",
]);
const editorCode = declarations("src/ui/index.ts", ["editKey2"]);

function fixture(
    slots = [{ medUrl: portal, name: "Home", rechours: 0, www: playlist }],
    browser = "chrome"
) {
    const dom = new JSDOM(
        "<!doctype html><video id='video'></video><div id='dialogbox'></div>",
        {
            runScripts: "outside-only",
            url: "https://player.invalid/",
        }
    );
    const w = dom.getInternalVMContext();
    w.setTimeout = w.setInterval = () => 1;
    w.console = { error() {}, log() {}, warn() {} };
    vm.runInContext(clientCode, w);
    if (!process.argv.includes("--bundle")) attachSourceAliases(w);
    const saved = new Map([
        ["m3um3uArr", JSON.stringify({ active: 0, M3Us: slots })],
    ]);
    const requests = [];
    const alerts = [];
    const played = [];
    const created = [];
    const chain = {
        append() {
            return this;
        },
        hide() {
            return this;
        },
        html() {
            return this;
        },
        show() {
            return this;
        },
    };
    const jq = () => chain;
    jq.ajax = (options) => {
        const call = {
            aborted: false,
            options,
            reply(data) {
                if (options.success) options.success(data, "success", {});
                if (options.complete) options.complete();
            },
        };
        requests.push(call);
        return {
            abort() {
                call.aborted = true;
                if (options.error) options.error({}, "abort");
                if (options.complete) options.complete();
            },
            always() {
                return this;
            },
            done() {
                return this;
            },
            fail() {
                return this;
            },
        };
    };
    Object.assign(w, {
        _: (text) => text,
        _playMedia: (item) => played.push(item),
        $: jq,
        alert: (message) => alerts.push(message),
        browserName: () => browser,
        btnDiv: () => "",
        cats: {},
        catsArray: [],
        chanels: {},
        checkProviderUrl: () => true,
        cList: [],
        client_can: { crossxhr: false },
        closeList() {},
        curColor: "white",
        curList: [],
        getMediaArray: null,
        host: "https://player.invalid",
        jQuery: jq,
        keys: { ENTER: 13, RETURN: 27, STOP: 19 },
        launch_id: "#launch",
        listCaption: {},
        listDetail: {},
        listPodval: {},
        loadChannels() {},
        medFavorites: [],
        medHistory: [],
        mediaName: "",
        mediaNames: [],
        mediaRecords: [],
        mediaRecordsPar: null,
        mediaSelects: [0],
        mediaUrls: null,
        murmurhash3_32_gc: () => 123,
        noProvParam() {},
        pdsa: ["medHistory", "medFavorites"],
        popupActions: [],
        popupArray: [],
        popupDetail: [],
        primaryIndex: 0,
        providerMediaClient: null,
        StripHttp: (value) => value.replace(/^https?:/, ""),
        showEditKey() {},
        showPage() {},
        sNoNumbersKeys: false,
        sPageSize: 30,
        stb: { getMacAddress: () => "00:11:22:33:44:55" },
        stbDelItem: (key) => saved.delete(key),
        stbGetItem: (key) => (saved.has(key) ? saved.get(key) : null),
        stbSetItem: (key, value) => saved.set(key, String(value)),
        strENTER: "Enter",
        strNew: "",
        strRETURN: "Return",
        updateChanelInfo() {},
        version: "fixture",
        xxHash32S: () => 1,
        xxHash32Si: () => 2,
    });
    w.playMedia = w._playMedia;
    const create = w.createVPortalClient;
    assert.equal(
        typeof create,
        "function",
        "the shared client is present in the selected runtime"
    );
    w.createVPortalClient = (link, options) => {
        const client = create(link, options);
        created.push(client);
        return client;
    };
    if (!bundled) vm.runInContext(cancellationCode, w);
    vm.runInContext(adapter, w);
    if (!process.argv.includes("--bundle")) attachSourceAliases(w);
    w.duneAddSettings(0);
    return { alerts, created, dom, played, requests, saved, w };
}

let cases = 0;
function test(name, run) {
    run();
    cases++;
    console.log("PASS M3U VPortal: " + name);
}

test("saved portal initializes in a cold browser and uses the companion POST endpoint", () => {
    const { created, requests, w } = fixture();
    assert.equal(created.length, 1);
    assert.equal(w.getMediaArray, created[0].load);
    assert.equal(w.playMedia, created[0].play);
    let completed = 0;
    w.getMediaArray("", () => completed++);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.url, "https://player.invalid/vportal/api");
    assert.equal(requests[0].options.type, "POST");
    const body = JSON.parse(requests[0].options.data);
    assert.equal(body.url, "http://portal.invalid/api/v1/");
    assert.equal(body.params.key, "FIXTURE_PRIVATE_KEY");
    requests[0].reply({
        items: [
            {
                request: { cmd: "category", id: 7 },
                title: "Films",
                type: "category",
            },
        ],
        type: "videoportal",
    });
    assert.equal(completed, 1);
    assert.equal(w.mediaName, "Home");
    assert.equal(w.mediaRecords[0].title, "Films");
    assert.equal(w.mediaRecords[0].playlist_url.request.id, 7);
});

test("refreshing unchanged settings preserves the active client and pending view", () => {
    const { created, requests, w } = fixture();
    const client = w.providerMediaClient;
    const navigation = [""];
    w.mediaUrls = navigation;
    w.getMediaArray("", () => {});
    w.duneAddSettings(0);
    assert.equal(created.length, 1);
    assert.equal(w.providerMediaClient, client);
    assert.equal(w.mediaUrls, navigation);
    assert.equal(requests[0].aborted, false);
});

test("slot switch aborts pending media, resets navigation, and scopes saved history", () => {
    const { created, requests, saved, w } = fixture([
        { medUrl: portal, www: playlist },
        { medUrl: otherPortal, www: playlist },
    ]);
    w.providerSetItem("medHistory", '[{"title":"First library"}]');
    const old = w.providerMediaClient;
    let completed = 0;
    w.mediaUrls = ["", { request: { id: 7 } }];
    w.mediaNames = ["Home", "Films"];
    w.mediaRecordsPar = [{ title: "Old parent" }];
    w.getMediaArray("", () => completed++);
    w.selectAndRestart(1);
    assert.equal(created.length, 2);
    assert.notEqual(w.providerMediaClient, old);
    assert.equal(requests[0].aborted, true);
    assert.equal(w.mediaUrls, null);
    assert.equal(w.mediaNames.length, 0);
    assert.equal(w.mediaRecordsPar, null);
    assert.equal(w.providerGetItem("medHistory"), null);
    w.providerSetItem("medHistory", '[{"title":"Second library"}]');
    assert.equal(saved.get("m3umedHistory"), '[{"title":"First library"}]');
    assert.equal(saved.get("m3umedHistory1"), '[{"title":"Second library"}]');
    requests[0].reply({
        items: [
            {
                title: "Stale",
                type: "stream",
                url: "https://old.invalid/movie.mp4",
            },
        ],
        type: "category",
    });
    assert.equal(completed, 0);
    assert.equal(w.mediaRecords.length, 0);
    old.play({ request: { id: 8 }, title: "Stale" });
    assert.equal(
        requests.length,
        1,
        "retired clients cannot start playback requests"
    );
});

test("closing the media view aborts the client and rejects a late completion", () => {
    const { requests, w } = fixture();
    let completed = 0;
    w.mediaUrls = [""];
    w.rememberMediaView(true);
    w.getMediaArray("", () => completed++);
    w.cancelMediaLoad();
    assert.equal(requests[0].aborted, true);
    requests[0].reply({
        items: [
            {
                title: "Stale",
                type: "stream",
                url: "https://old.invalid/movie.mp4",
            },
        ],
        type: "category",
    });
    assert.equal(completed, 0);
    assert.equal(w.mediaRecords.length, 0);
});

function editField(w, index, value) {
    w.doEditListData(0);
    w.selIndex = index;
    w.listKeyHandler(w.keys.ENTER);
    w.editvar = value;
    w.setEdit();
}

test("settings mask saved portal credentials and reject unsupported new values", () => {
    const { alerts, saved, w } = fixture();
    w.doEditListData(0);
    assert.match(w.listArray[3], /^VPortal link: /);
    assert(!w.listArray.join(" ").includes("FIXTURE_PRIVATE_KEY"));
    w.doEditM3Ua(0);
    w.detailListAction();
    assert(!w.listDetail.innerHTML.includes("FIXTURE_PRIVATE_KEY"));
    const before = saved.get("m3um3uArr");
    editField(w, 3, "https://catalog.invalid/library.json");
    assert.equal(saved.get("m3um3uArr"), before);
    assert.equal(w.m3uArr.M3Us[0].medUrl, portal);
    assert.equal(alerts.length, 1);
    assert(!alerts[0].includes("FIXTURE_PRIVATE_KEY"));
    editField(w, 3, "  " + otherPortal + "  ");
    assert.equal(w.m3uArr.M3Us[0].medUrl, otherPortal);
    assert.equal(
        JSON.parse(saved.get("m3um3uArr")).M3Us[0].medUrl,
        otherPortal
    );
    assert(!w.listArray.join(" ").includes("OTHER_PRIVATE_KEY"));
});

test("invalid HTML editor submissions reopen after editor teardown with their typed value intact", () => {
    for (const [index, typed] of [
        [3, "https://catalog.invalid/library.json"],
        [1, otherPortal],
    ]) {
        const { saved, w } = fixture();
        if (!bundled) vm.runInContext(editorCode, w);
        const before = saved.get("m3um3uArr");
        const events = [];
        const timers = [];
        w.setTimeout = (callback) => timers.push(callback);
        w.showEditKey = () => events.push(["open", w.editvar]);
        w.restoreCPD = () => events.push(["restore"]);
        w.doEditListData(0);
        w.selIndex = index;
        w.listKeyHandler(w.keys.ENTER);
        events.length = 0;
        w.$ = (selector) => ({
            hide() {
                events.push(["hide", selector]);
            },
            val: () => typed,
        });
        w.editKey2(w.keys.ENTER);
        assert.deepEqual(events, [["hide", "#listEdit"], ["restore"]]);
        assert.equal(saved.get("m3um3uArr"), before);
        assert.equal(timers.length, 1);
        timers.shift()();
        assert.deepEqual(events[2], ["open", typed]);
    }
});

test("clearing the portal restores ordinary playback and removes the media loader", () => {
    const { requests, w } = fixture();
    const old = w.providerMediaClient;
    w.getMediaArray("", () => {});
    editField(w, 3, "  ");
    assert.equal(w.providerMediaClient, null);
    assert.equal(w.getMediaArray, null);
    assert.equal(w.playMedia, w._playMedia);
    assert.equal(requests[0].aborted, true);
    old.play({ request: { cmd: "play", id: 7 } });
    assert.equal(requests.length, 1);
});

test("ordinary television loading retains M3U parsing alongside a configured portal", () => {
    const { requests, w } = fixture();
    let completed = 0;
    w.getChanelsArray(() => completed++);
    assert.equal(requests[0].options.url, playlist);
    requests[0].reply(
        '#EXTM3U\n#EXTINF:-1 group-title="News" tvg-logo="https://tv.invalid/logo.png",News HD\nhttps://tv.invalid/live.m3u8\n'
    );
    assert.equal(completed, 1);
    assert.equal(w.cList.length, 1);
    assert.equal(w.chanels[w.cList[0]].channel_name, "News HD");
    assert.equal(w.chanels[w.cList[0]].url, "https://tv.invalid/live.m3u8");
    assert.equal(w.getMediaArray, w.providerMediaClient.load);
});

test("a portal pasted into Playlist URL is rejected before any network request", () => {
    const { alerts, requests, saved, w } = fixture([{ www: portal }]);
    let completed = 0;
    w.getChanelsArray(() => completed++);
    assert.equal(completed, 1);
    assert.equal(requests.length, 0);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /VPortal link/);
    assert(!alerts[0].includes("FIXTURE_PRIVATE_KEY"));
    assert(!w.popupArray.join(" ").includes("FIXTURE_PRIVATE_KEY"));
    w.doEditM3Ua(0);
    assert(!w.getListItem(w.m3uArr.M3Us[0], 0).includes("FIXTURE_PRIVATE_KEY"));
    w.detailListAction();
    assert(!w.listDetail.innerHTML.includes("FIXTURE_PRIVATE_KEY"));
    w.doEditListData(0);
    assert(!w.listArray.join(" ").includes("FIXTURE_PRIVATE_KEY"));
    w.m3uArr.M3Us[0].www = playlist;
    w.providerSetItem("m3uArr", JSON.stringify(w.m3uArr));
    const before = saved.get("m3um3uArr");
    editField(w, 1, portal);
    assert.equal(w.m3uArr.M3Us[0].www, playlist);
    assert.equal(saved.get("m3um3uArr"), before);
    assert.equal(requests.length, 0);
});

test("replacing a portal keeps saved history but cannot replay its requests against the new source", () => {
    const { requests, played, saved, w } = fixture();
    const originalId = w.m3uArr.M3Us[0].medSourceId;
    assert(originalId);
    w.getMediaArray("", () => {});
    requests[0].reply({
        items: [
            {
                request: { cmd: "play", id: 7 },
                title: "Shared title",
                type: "stream",
            },
            {
                request: { cmd: "category", id: 7 },
                title: "Films",
                type: "category",
            },
        ],
        type: "category",
    });
    const oldItem = w.mediaRecords[0];
    const oldFolder = w.mediaRecords[1].playlist_url;
    oldItem.stream_url = "https://old.invalid/signed.mp4";
    oldItem.current = 120;
    w.medHistory = [oldItem];
    w.providerSetItem("medHistory", JSON.stringify(w.medHistory));
    const history = saved.get("m3umedHistory");
    editField(w, 3, otherPortal);
    assert.notEqual(w.m3uArr.M3Us[0].medSourceId, originalId);
    assert.equal(
        saved.get("m3umedHistory"),
        history,
        "changing a source does not erase saved history"
    );
    w.playMedia(oldItem);
    w.getMediaArray(oldFolder, () => {});
    assert.equal(
        requests.length,
        1,
        "old source requests must not reach the replacement portal"
    );
    assert.equal(played.length, 0);
    w.getMediaArray("", () => {});
    requests[1].reply({
        items: [
            {
                request: { cmd: "play", id: 7 },
                title: "Shared title",
                type: "stream",
            },
        ],
        type: "category",
    });
    const currentItem = w.mediaRecords[0];
    w.playMedia(currentItem);
    assert.equal(requests.length, 3);
    assert.equal(
        JSON.parse(requests[2].options.data).params.key,
        "OTHER_PRIVATE_KEY"
    );
    requests[2].reply({ url: "https://new.invalid/signed.mp4" });
    assert.equal(played.length, 1);
    assert.equal(played[0].stream_url, "https://new.invalid/signed.mp4");
    assert.equal(
        oldItem.stream_url,
        "https://old.invalid/signed.mp4",
        "a matching title/id from another portal keeps its own history"
    );
});

test("saved legacy catalogs retain their Dune-only loader", () => {
    const slots = [
        { medUrl: "https://catalog.invalid/library.json", www: playlist },
    ];
    const browser = fixture(slots);
    assert.equal(browser.w.getMediaArray, null);
    const dune = fixture(slots, "dune");
    assert.equal(dune.w.getMediaArray, dune.w._getMediaArray);
    assert.equal(dune.w.playMedia, dune.w._playMedia);
});

console.log(
    "PASS M3U VPortal integration (" +
        cases +
        " cases" +
        (bundled ? ", classic bundle" : ", source") +
        ")"
);

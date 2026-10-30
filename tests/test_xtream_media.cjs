const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const code = ts.transpileModule(
    fs.readFileSync("src/provider/xtream-media.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(code, { ecmaVersion: 5 });
const context = vm.createContext({
    decodeURIComponent,
    encodeURIComponent,
    URL,
});
context.window = context;
require("./helpers/shared-core-runtime.cjs")(context, { vendorOnly: true });
let current = true,
    pending = [],
    requests = [],
    errors = [];
let credentials = {
    password: "secret",
    server: "https://xc.invalid",
    username: "name",
};
const cleanups = [];
const driver = { credentials: () => credentials };
Object.assign(context, {
    _: (value) => value,
    __ottActiveProviderDriver: driver,
    __ottSourceIdentity: { media: () => "xtream@one" },
    $: {
        ajax(options) {
            requests.push(options.url);
            const request = {
                abort() {
                    this.aborted = true;
                },
                done(fn) {
                    this.success = fn;
                    return this;
                },
                fail(fn) {
                    this.failure = fn;
                    return this;
                },
            };
            pending.push(request);
            return request;
        },
    },
    infoBox: (value) => errors.push(value),
    murmurhash3_32_gc: (s) =>
        [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 0),
});
vm.runInContext(code, context);
context.__ottXtreamMedia.mount(context, driver, {
    active: () => current,
    own: (fn) => cleanups.push(fn),
});
let delivered = 0;
context.getMediaArray("", () => delivered++);
assert.equal(delivered, 1);
assert.equal(context.mediaRecords.length, 2);
assert.equal(
    requests.length,
    0,
    "TV/root startup does not fetch media catalogs"
);
const movieRoute = context.mediaRecords[0].playlist_url;
context.getMediaArray(movieRoute, () => delivered++);
pending.shift().success({ user_info: { auth: 1, status: "Active" } });
assert(requests.at(-1).includes("get_vod_categories"));
pending.shift().success([{ category_id: "4", category_name: "Movies" }]);
pending.shift().success([
    {
        category_id: "4",
        container_extension: "mp4",
        name: "Fixture",
        stream_id: 42,
    },
]);
assert.equal(delivered, 2);
assert.equal(context.mediaRecords.length, 1);
const movie = context.mediaRecords[0];
assert(movie.stream_url.endsWith("/movie/name/secret/42.mp4"));
assert.equal(movie.description, "", "Absent movie metadata stays empty");
assert.equal(movie.logo_30x30, "");
assert(!requests.some((url) => /get_live|get_series/.test(url)));
const saved = context.providerMediaClient.persist(movie);
assert(
    !JSON.stringify(saved).includes("secret"),
    "Journal uses an ID, not an authenticated URL"
);
let resolved;
context.providerMediaClient.resolve(saved, (value) => {
    resolved = value;
});
pending.shift().success({ user_info: { auth: 1 } });
pending.shift().success([]);
pending.shift().success([]);
assert.equal(
    resolved,
    null,
    "Removed movie must not revive from the previous cache"
);
context.getMediaArray({ kind: "series" }, () => delivered++);
pending.shift().success({ user_info: { auth: 1 } });
pending.shift().success([]);
pending.shift().success([{ name: "Show", series_id: 8 }]);
const series = context.mediaRecords[0];
context.getMediaArray(series.playlist_url, () => delivered++);
pending.shift().success({ user_info: { auth: 1 } });
pending.shift().success([]);
pending.shift().success([{ name: "Show", series_id: 8 }]);
assert(requests.at(-1).includes("get_series_info"));
pending.shift().success({
    episodes: {
        1: [
            {
                container_extension: "mp4",
                episode_num: 1,
                id: "81",
                season: 1,
                title: "Episode",
            },
        ],
    },
});
assert.equal(context.mediaRecords.length, 1);
assert(
    context.mediaRecords[0].stream_url.endsWith("/series/name/secret/81.mp4")
);
context.getMediaArray(movieRoute, () => delivered++);
const late = pending.shift();
const count = delivered;
credentials = { ...credentials, password: "new" };
late.success({ user_info: { auth: 1 } });
assert.equal(delivered, count, "Changed account invalidates old callbacks");
current = false;
cleanups.forEach((fn) => fn());
assert.equal(errors.length, 0);
console.log(
    "PASS Xtream media: lazy catalogs, shared protocol, fresh resolve, episodes, secret-free journal, account cancellation"
);

// Exercise the real UI/library/PIN/journal handshake, not only the provider codec.
const { JSDOM } = require("jsdom");
const { fixture, sourceFunctions } = require("./test_port_vod.cjs");
function integrated() {
    const host = fixture(),
        pending = [],
        requests = [];
    const account = {
        password: "secret",
        server: "https://xc.invalid",
        username: "name",
    };
    const driver = { credentials: () => account };
    host.p_pref = "xtream";
    host.__ottActiveProviderDriver = driver;
    host.$.ajax = (options) => {
        requests.push(options.url);
        const request = {
            abort() {
                this.aborted = true;
            },
            done(fn) {
                this.success = fn;
                return this;
            },
            fail(fn) {
                this.failure = fn;
                return this;
            },
        };
        pending.push(request);
        return request;
    };
    vm.runInContext(code, host);
    host.__ottXtreamMedia.mount(host, driver, { active: () => true, own() {} });
    function reply(value) {
        assert(pending.length, "A real provider request must precede a reply");
        pending.shift().success(value);
    }
    function catalog(rows) {
        reply({ user_info: { auth: 1 } });
        reply([]);
        reply(rows);
    }
    function movie(adult = 0) {
        return {
            container_extension: "mp4",
            is_adult: adult,
            name: "Movie",
            stream_icon: "https://xc.invalid/poster?password=secret",
            stream_id: 42,
        };
    }
    function series(adult = 0) {
        return { is_adult: adult, name: "Show", series_id: 8 };
    }
    function episodes() {
        return {
            episodes: {
                1: [
                    {
                        container_extension: "mp4",
                        episode_num: 1,
                        id: "81",
                        season: 1,
                        title: "Episode",
                    },
                ],
            },
        };
    }
    function count(type) {
        return host.calls.filter((call) => call[0] === type).length;
    }
    return {
        account,
        catalog,
        count,
        episodes,
        host,
        movie,
        pending,
        reply,
        requests,
        series,
    };
}
for (const kind of ["movie", "series", "episode"]) {
    const f = integrated(),
        c = f.host,
        dom = new JSDOM("");
    c.document.implementation = dom.window.document.implementation;
    vm.runInContext(
        sourceFunctions("src/utils/helpers.ts", ["getThumbnail"]),
        c
    );
    c.sThumbnail = 1;
    const plot =
        kind + ' <b data-provider="format">description</b> &amp; detail';
    const poster = "https://art.invalid/" + kind + ".jpg?size=large&crop=fit";
    c.mediaList(null);
    c.selectMedia(kind === "movie" ? 0 : 1);
    f.catalog([
        kind === "movie"
            ? { ...f.movie(), plot, stream_icon: poster }
            : { ...f.series(), cover: poster, plot },
    ]);
    if (kind === "episode") {
        c.selectMedia(0);
        f.catalog([
            {
                ...f.series(),
                cover: "https://art.invalid/series.jpg",
                plot: "Parent plot",
            },
        ]);
        const response = f.episodes();
        response.episodes[1][0].info = { movie_image: poster, plot };
        f.reply(response);
    }
    const item = c.listArray[0];
    assert.equal(
        item.description,
        plot,
        kind + " keeps the bundled core description"
    );
    assert.equal(
        item.logo_30x30,
        poster,
        kind + " keeps the bundled core poster"
    );
    const requestsBeforeDetails = f.requests.length;
    c.detailListActionFn();
    const rendered = dom.window.document.createElement("div");
    rendered.innerHTML = c.elements["#listDetail"].innerHTML;
    assert(rendered.textContent.includes(kind + " description & detail"));
    assert.equal(
        rendered.querySelector("b").getAttribute("data-provider"),
        null
    );
    assert(
        rendered.querySelector(".img").style.backgroundImage.includes(poster)
    );
    assert.equal(
        f.requests.length,
        requestsBeforeDetails,
        "Details use already loaded metadata"
    );
    const persisted = c.providerMediaClient.persist(item);
    assert.equal(persisted.description, undefined);
    assert.equal(persisted.logo_30x30, undefined);
    dom.window.close();
}
{
    const f = integrated(),
        c = f.host;
    const prototype = c.OttPlayCore.XtreamClient.prototype,
        series = prototype.series;
    let seasonDescription;
    prototype.series = function (data, parent) {
        const result = series.call(this, data, parent);
        seasonDescription = result.folders[0].description;
        return result;
    };
    c.mediaList(null);
    c.selectMedia(1);
    f.catalog([{ ...f.series(), plot: "Cached parent plot" }]);
    c.selectMedia(0);
    f.catalog([
        {
            ...f.series(),
            cover: "https://art.invalid/parent.jpg",
            plot: "Fresh parent plot",
        },
    ]);
    f.reply(f.episodes());
    prototype.series = series;
    assert.equal(
        seasonDescription,
        "Fresh parent plot",
        "Core receives the refreshed series description"
    );
    assert.equal(
        c.listArray[0].description,
        "",
        "A missing episode plot stays empty"
    );
    assert.equal(
        c.listArray[0].logo_30x30,
        "https://art.invalid/parent.jpg",
        "Core owns parent poster fallback"
    );
}
{
    const f = integrated(),
        c = f.host;
    c.mediaList(null);
    c.selectMedia(1);
    f.catalog([f.series()]);
    c.__ottMedia.favorite(c.listArray[0]);
    const saved = c.documentState().favorites[0].payload;
    assert.equal(saved.playlist_url.series, "8");
    assert.equal(saved.request, undefined);
    c.__ottMedia.back();
    c.selectMedia(
        c.listArray.findIndex((item) => item.__ottMediaRoute === "favorites")
    );
    c.selectMedia(0);
    f.catalog([f.series()]);
    f.reply(f.episodes());
    assert.equal(
        c.listArray[0].title,
        "Episode",
        "A saved series folder must reopen"
    );
    assert.equal(c.listArray[0].adult, 0);
}
{
    const f = integrated(),
        c = f.host;
    c.mediaList(null);
    c.selectMedia(0);
    f.catalog([f.movie()]);
    c.__ottMedia.favorite(c.listArray[0]);
    assert(
        !JSON.stringify(c.documentState()).includes("secret"),
        "Authenticated artwork is not durable history"
    );
    c.selectMedia(0);
    f.catalog([f.movie(1)]);
    assert.equal(f.count("pin"), 1, "Freshly adult movie requires a PIN");
    assert.equal(f.count("play"), 0);
    c.parentAccess = true;
    c.unlock();
    assert.equal(f.count("play"), 1);
    assert.equal(c.documentState().history[0].payload.adult, 1);
    assert(!JSON.stringify(c.documentState()).includes("secret"));
}
for (const action of ["cancel", "account"]) {
    const f = integrated(),
        c = f.host;
    c.mediaList(null);
    c.selectMedia(0);
    f.catalog([f.movie()]);
    c.selectMedia(0);
    f.catalog([f.movie(1)]);
    assert.equal(f.count("pin"), 1);
    if (action === "cancel") c.__ottMedia.cancel();
    else f.account.password = "replacement";
    c.parentAccess = true;
    c.unlock();
    assert.equal(
        f.count("play"),
        0,
        "A stale PIN cannot start a replaced request"
    );
}
{
    const f = integrated(),
        c = f.host;
    c.mediaList(null);
    c.selectMedia(0);
    f.catalog([f.movie()]);
    const movie = c.listArray[0];
    let result = "pending";
    c.providerMediaClient.resolve(
        movie,
        (value) => {
            result = value;
        },
        true
    );
    f.catalog([f.movie(1)]);
    assert.equal(
        result,
        null,
        "Automatic playback rejects a freshly locked item"
    );
    assert.equal(
        f.count("pin"),
        0,
        "Automatic resolution does not open a new PIN prompt"
    );
}
{
    const f = integrated(),
        c = f.host;
    c.mediaList(null);
    c.selectMedia(1);
    f.catalog([f.series()]);
    c.selectMedia(0);
    f.catalog([f.series()]);
    f.reply(f.episodes());
    const saved = c.providerMediaClient.persist(c.listArray[0]);
    assert.equal(saved.adult, 0);
    c.selectMedia(0);
    f.catalog([f.series(1)]);
    f.reply(f.episodes());
    assert.equal(
        f.count("pin"),
        1,
        "Episodes inherit the fresh parent policy, not persisted adult:0"
    );
    assert.equal(f.count("play"), 0);
    c.parentAccess = true;
    c.unlock();
    assert.equal(f.count("play"), 1);
    assert.equal(c.documentState().history[0].payload.adult, 1);
    let result = "pending";
    c.providerMediaClient.resolve(saved, (value) => {
        result = value;
    });
    f.catalog([]);
    assert.equal(
        result,
        null,
        "A removed parent cannot revive a saved episode"
    );
    assert.equal(
        f.pending.length,
        0,
        "No episode request after authoritative parent removal"
    );
}
{
    const f = integrated(),
        c = f.host;
    c.mediaList(null);
    c.selectMedia(0);
    f.catalog([f.movie()]);
    c.selectMedia(0);
    f.catalog([f.movie()]);
    c.__ottMedia.checkpoint(c.__ottMedia.current().ref, 125, true);
    const cold = integrated(),
        fresh = cold.host;
    Object.assign(fresh.stored, c.stored);
    fresh.mediaList(null);
    fresh.selectMedia(
        fresh.listArray.findIndex((item) => item.__ottMediaRoute === "history")
    );
    fresh.selectMedia(0);
    cold.catalog([cold.movie()]);
    assert.equal(
        cold.count("confirm"),
        1,
        "Freshly resolved history retains its stable resume identity"
    );
    fresh.confirm();
    assert(fresh.calls.some((call) => call[0] === "seek" && call[1] === 120));
}
console.log(
    "PASS Xtream integration: escaped movie/series/episode metadata, parent artwork, folder favorites, secret-free persistence, fresh parental policy, stale PIN cancellation, removed series and resume"
);

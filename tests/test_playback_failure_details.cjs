const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const compile = (source) =>
    ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
const source = fs.readFileSync("src/core/playback-feedback.ts", "utf8");
const keySource = ts.createSourceFile(
    "keys.ts",
    fs.readFileSync("src/key-handler/index.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true
);
const mainKey = keySource.statements
    .find(
        (node) =>
            ts.isFunctionDeclaration(node) && node.name.text === "handleMainKey"
    )
    .getText(keySource);
function fixture() {
    const dom = new JSDOM(
        '<div id="info1" style="display:none"><div id="video_res"></div></div><div id="buffering"></div><div id="dialogbox" style="display:none"></div><video></video>',
        { runScripts: "outside-only" }
    );
    const w = dom.window,
        video = w.document.querySelector("video"),
        root = w.document.getElementById("dialogbox");
    let clock = 0,
        generation = 1,
        owner = null,
        callback = null,
        retries = 0,
        blocked = false,
        locked = false,
        kind = "live",
        phase = "playing",
        infos = 0;
    let currentHandle;
    w.Date.now = () => clock;
    w.forcePlay = true;
    w._ = (value) => value;
    w.keys = { ENTER: 13, EXIT: 8, INFO: 73, RETURN: 27 };
    w.$ = () => ({
        show() {
            root.style.display = "block";
        },
    });
    w.renderButtonHint = (key, unused, label) =>
        '<button data-ott-key="' + key + '">' + label + "</button>";
    w.__ottKiosk = { enabled: () => blocked };
    w.hasParentalLock = (id) => locked && id === 7;
    w.__ottParental = { needs: () => true };
    w.__ottClassicPlayback = {
        context: () => {
            const captured = generation;
            return { isCurrentBackend: () => captured === generation };
        },
        snapshot: () => ({
            generation,
            phase,
            target: { channelId: "7", kind, sourceId: "source-a" },
        }),
    };
    const handle = {
        active: () => true,
        restart() {
            retries++;
            w.__ottPlaybackFeedback.begin();
            return { accepted: true };
        },
    };
    currentHandle = handle;
    const backend = { current: () => currentHandle };
    w.__ottCoreBackendPeek = () => backend;
    w.__ottCoreTransport = { play() {} };
    w.stbPlay = w.__ottCoreTransport.play;
    w.__ottClassicScreenPort = {
        close() {
            owner = null;
            callback = null;
            root.style.display = "none";
        },
        keyEvent: () => null,
        normalize: () => ({ id: "info" }),
        owner: () => owner,
        screens: { current: () => owner },
        setOwnedCallback(type, action) {
            owner = { foreground: () => true };
            callback = action;
            action.owner = owner;
            return action;
        },
    };
    w.settings = { infoTimeout: 5 };
    w.globalNumber = null;
    w.showChannelInfo = () => infos++;
    w.toggleMainPlayback = () => {};
    Object.defineProperty(video, "paused", { get: () => false });
    video.src = "https://example.invalid/channel-a";
    w.eval(compile(source + "\n" + mainKey));
    const api = w.__ottPlaybackFeedback;
    api.bind(video);
    api.begin();
    video.dispatchEvent(new w.Event("loadstart"));
    return {
        api,
        block: () => (blocked = true),
        callback: () => callback,
        choose: (key) => callback(key),
        close: () => dom.window.close(),
        info: () => w.handleMainKey(73, new w.Event("keydown")),
        infos: () => infos,
        label: w.document.getElementById("video_res"),
        lock: () => (locked = true),
        modal: () => (owner = { other: true }),
        nextGeneration: () => generation++,
        pause: () => (phase = "paused"),
        progress() {
            clock += 1000;
            video.currentTime += 1;
            video.dispatchEvent(new w.Event("timeupdate"));
        },
        replace: () => (currentHandle = { ...handle }),
        retries: () => retries,
        root,
        video,
        vod: () => (kind = "vod"),
        w,
    };
}
for (const [kind, status, text] of [
    ["network", 401, /sign-in/],
    ["network", 403, /sign-in/],
    ["network", 404, /Not found/],
    ["network", 429, /busy/],
    ["network", 503, /connection failed/],
    ["decode", 0, /format/],
    ["parse", 0, /format/],
    ["drm", 0, /protected/],
    ["quality", 0, /quality limits/],
    [
        "https://user:secret@private.invalid/secret",
        0,
        /^Stream could not be played$/,
    ],
]) {
    const f = fixture();
    f.api.fail(kind, status);
    assert.equal(
        f.root.style.display,
        "none",
        "failure never automatically opens details"
    );
    assert.equal(
        f.w.document.getElementById("info1").style.display,
        "none",
        "failure does not open or pin the footer"
    );
    assert.equal(
        f.label.textContent,
        "ERROR!",
        "existing compact label is retained"
    );
    assert.match(f.label.title, text);
    assert.equal(f.label.getAttribute("role"), "button");
    assert.equal(f.api.details(), true);
    assert.match(f.root.querySelector("#dialogMessage").textContent, text);
    assert.doesNotMatch(f.root.textContent, /secret|private\.invalid/);
    assert.match(f.root.textContent, /Retry/);
    f.close();
}
{
    const f = fixture();
    f.info();
    assert.equal(f.infos(), 1, "healthy INFO preserves channel info action");
    f.api.fail("network");
    f.info();
    assert.equal(
        f.infos(),
        1,
        "terminal INFO opens details instead of changing channel info"
    );
    const obsolete = f.callback();
    f.choose(f.w.keys.ENTER);
    assert.equal(f.retries(), 1);
    assert.equal(f.root.style.display, "none");
    obsolete(f.w.keys.ENTER);
    assert.equal(
        f.retries(),
        1,
        "repeated obsolete callback cannot restart again"
    );
    f.close();
}
for (const invalidate of [
    "replace",
    "nextGeneration",
    "block",
    "lock",
    "vod",
    "pause",
]) {
    const f = fixture();
    f.api.fail("network");
    f.api.details();
    f[invalidate]();
    f.choose(f.w.keys.ENTER);
    assert.equal(
        f.retries(),
        0,
        invalidate + " invalidates Retry before dispatch"
    );
    f.close();
}
{
    const f = fixture();
    f.api.fail("network");
    f.api.details();
    f.w.__ottClassicScreenPort.keyEvent = () => ({ repeat: true });
    f.choose(f.w.keys.ENTER);
    assert.equal(f.retries(), 0, "a held key does not activate Retry");
    assert.equal(f.root.style.display, "block");
    f.w.__ottClassicScreenPort.keyEvent = () => null;
    f.w.forcePlay = false;
    f.choose(f.w.keys.ENTER);
    assert.equal(
        f.retries(),
        0,
        "pause intent blocks a previously offered Retry"
    );
    f.api.stop();
    assert.equal(f.api.details(), false);
    f.close();
}
{
    const f = fixture();
    f.api.fail("network");
    f.video.src = "https://example.invalid/channel-b";
    assert.equal(
        f.api.details(),
        false,
        "source replacement cannot expose obsolete error"
    );
    f.close();
}
for (const invalidate of ["vod", "pause"]) {
    const f = fixture();
    f.api.fail("network");
    f[invalidate]();
    assert.equal(f.api.details(), true);
    assert.doesNotMatch(
        f.root.textContent,
        /Retry/,
        "latest playback state suppresses Retry"
    );
    f.choose(f.w.keys.ENTER);
    assert.equal(f.retries(), 0);
    f.close();
}
for (const invalidate of ["vod", "lock"]) {
    const f = fixture();
    f[invalidate]();
    f.api.fail("decode");
    assert.equal(f.api.details(), true);
    assert.doesNotMatch(
        f.root.textContent,
        /Retry/,
        invalidate + " has explanation only"
    );
    f.choose(f.w.keys.ENTER);
    assert.equal(f.retries(), 0);
    f.close();
}
for (const change of ["block", "modal"]) {
    const f = fixture();
    f.api.fail("network");
    f[change]();
    assert.equal(f.api.details(), false, change + " owns input");
    f.close();
}
{
    const f = fixture();
    f.api.fail("decode");
    f.video.dispatchEvent(new f.w.Event("waiting"));
    assert.match(
        f.label.title,
        /format/,
        "late waiting preserves the known terminal cause"
    );
    f.label.dispatchEvent(
        new f.w.MouseEvent("click", { bubbles: true, cancelable: true })
    );
    assert.equal(
        f.root.style.display,
        "block",
        "pointer can open the same details"
    );
    f.progress();
    assert.equal(
        f.root.style.display,
        "none",
        "actual recovered playback clears its own details"
    );
    assert.equal(f.label.getAttribute("role"), null);
    assert.equal(f.api.details(), false);
    f.close();
}
{
    const f = fixture();
    f.api.fail();
    f.api.details();
    f.modal();
    f.progress();
    assert.equal(
        f.root.style.display,
        "block",
        "recovery does not dismiss a newer dialog"
    );
    f.close();
}
{
    const f = fixture();
    f.w.eval(fs.readFileSync("js/jquery-1.11.1.min.js", "utf8"));
    const originalIs = f.w.$.fn.is;
    f.w.$.fn.is = function (query) {
        return query === ":visible"
            ? !!this[0] && this[0].style.display !== "none"
            : originalIs.call(this, query);
    };
    delete f.w.__ottClassicScreenPort;
    require("./helpers/screen-runtime.cjs")(f.w);
    const port = f.w.__ottClassicScreenPort;
    f.api.fail("network");
    assert.equal(f.api.details(), true);
    const stale = f.w.dialogBoxKeyHandler;
    assert.equal(port.screens.current().kind, "dialog");
    port.dispatch(f.w.keys.RETURN, {}, () => {});
    assert.equal(port.screens.current(), null);
    assert.equal(f.retries(), 0, "real owned Back closes without retry");
    assert.equal(f.api.details(), true);
    stale(f.w.keys.ENTER);
    assert.equal(
        f.retries(),
        0,
        "retired real callback cannot reach new dialog"
    );
    assert.equal(port.screens.current().kind, "dialog");
    port.dispatch(f.w.keys.ENTER, {}, () => {});
    assert.equal(f.retries(), 1, "real owned Enter dispatches current Retry");
    assert.equal(port.screens.current(), null);
    f.close();
}
console.log(
    "PASS playback failure details: compact explicit UI, typed causes, INFO/pointer, current-session retry, policy and stale-action guards"
);

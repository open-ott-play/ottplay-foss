const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function compile(file) {
    return ts
        .transpileModule(read(file), {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.replace(/^import[^;]*;\s*/gm, "")
        .replace(/^export\s*\{[^}]*\};?\s*/gm, "")
        .replace(/^export\s+/gm, "");
}
const helper = compile("src/plugins/jquery-bridge.ts");
acorn.parse(helper, { ecmaVersion: 5 });
const variants = [
    ["js/jquery-1.11.1.min.js", "1.11.1"],
    ["node_modules/jquery/dist/jquery.min.js", "4.0.0"],
];

function fixture(file, expectedVersion) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
        runScripts: "outside-only",
        url: "https://native.invalid/",
    });
    const w = dom.window;
    w.eval(read(file));
    assert.equal(w.$.fn.jquery, expectedVersion);
    w.eval(helper);
    return { close: () => w.close(), w };
}

function controlledThenable() {
    const pending = {};
    return {
        pending,
        thenable: {
            then(resolve, reject) {
                pending.resolve = resolve;
                pending.reject = reject;
            },
        },
    };
}

function callbackContract(w, reject) {
    const events = [];
    const value = reject ? "portal unavailable" : { body: "Native response" };
    const { pending, thenable } = controlledThenable();
    let returned;
    const opts = {
        complete(dfd, status) {
            assert.equal(this, opts);
            assert.equal(arguments.length, 2);
            assert.equal(dfd, returned);
            assert.equal(dfd.state(), "pending");
            events.push("complete:" + status);
            throw new Error("consumer complete failure");
        },
        // The old shims invoke option callbacks as opts methods, even when
        // context is present. Do not silently substitute $.ajax semantics.
        context: { unrelated: true },
        error(xhr, status, message) {
            assert.equal(this, opts);
            assert.equal(arguments.length, 3);
            assert.equal(xhr.status, 0);
            assert.equal(xhr.responseText, value);
            assert.equal(message, value);
            events.push(status);
            throw new Error("consumer error failure");
        },
        success(data, status, dfd) {
            assert.equal(this, opts);
            assert.equal(arguments.length, 3);
            assert.equal(data, value);
            assert.equal(dfd, returned);
            events.push(status);
            throw new Error("consumer success failure");
        },
    };
    returned = w.nativePromiseToJq(w.$, thenable, opts, "fallback");
    assert.equal(returned.state(), "pending");
    assert.equal(typeof returned.resolve, "function");
    returned
        .done(function (result) {
            assert.equal(arguments.length, 1);
            assert.equal(result, value);
            events.push("done");
        })
        .fail(function (result) {
            assert.equal(arguments.length, 1);
            assert.equal(result, value);
            events.push("fail");
        })
        .always(function (result) {
            assert.equal(arguments.length, 1);
            assert.equal(result, value);
            events.push("always");
        });
    pending[reject ? "reject" : "resolve"](value);
    assert.deepEqual(
        events,
        reject
            ? ["error", "complete:error", "fail", "always"]
            : ["success", "complete:success", "done", "always"]
    );
    assert.equal(returned.state(), reject ? "rejected" : "resolved");
    let late;
    returned[reject ? "fail" : "done"]((result) => {
        late = result;
    });
    assert.equal(late, value, "Deferred retains settlement for late listeners");
}

function synchronousBoundaries(w) {
    for (const error of [null, undefined, 0, false, "", new Error("native")]) {
        for (const fallback of ["proxy_fetch failed", "portalRequest failed"]) {
            const expected = error == null ? fallback : String(error);
            const jq = w.nativePromiseToJq(
                w.$,
                {
                    then(_resolve, reject) {
                        reject(error);
                    },
                },
                {},
                fallback
            );
            assert.equal(jq.state(), "rejected");
            jq.fail((message) => assert.equal(message, expected));
        }
    }
    const events = [];
    const opts = {
        complete() {
            events.push("complete");
        },
        get success() {
            throw new Error("success getter");
        },
    };
    const jq = w.nativePromiseToJq(
        w.$,
        {
            then(resolve) {
                events.push("then");
                resolve("value");
            },
        },
        opts,
        "fallback"
    );
    events.push("returned");
    assert.equal(jq.state(), "resolved");
    assert.deepEqual(events, ["then", "complete", "returned"]);

    const failure = new Error("then getter");
    assert.throws(
        () =>
            w.nativePromiseToJq(
                w.$,
                {
                    get then() {
                        throw failure;
                    },
                },
                {},
                "fallback"
            ),
        (error) => error === failure
    );
    // Only option callbacks are isolated. A synchronous Deferred listener
    // failure still propagates through the original thenable invocation.
    const controlled = controlledThenable();
    const deferred = w.nativePromiseToJq(
        w.$,
        controlled.thenable,
        {},
        "fallback"
    );
    deferred.done(() => {
        throw failure;
    });
    assert.throws(
        () => controlled.pending.resolve("value"),
        (error) => error === failure
    );
}

async function promiseTiming(w) {
    const events = [];
    const nativeResponse = { body: "native text", status: 200 };
    const jq = w.nativePromiseToJq(
        w.$,
        Promise.resolve(nativeResponse),
        {
            complete() {
                events.push("complete");
            },
            success(value) {
                assert.equal(value, nativeResponse);
                events.push("success");
            },
        },
        "fallback"
    );
    jq.done(() => events.push("done"));
    events.push("returned");
    assert.equal(jq.state(), "pending");
    await Promise.resolve();
    assert.deepEqual(events, ["returned", "success", "complete", "done"]);
}

function outcome(jq) {
    return new Promise((resolve) => {
        jq.done((value) => resolve({ ok: true, value }));
        jq.fail((value) => resolve({ ok: false, value }));
    });
}

async function nativeRoutes(w) {
    let response = {
        body: '{"channels":["fixture"]}',
        contentType: "application/json",
        status: 200,
    };
    const calls = [];
    const portal = {
        portalRequest(args) {
            calls.push(args);
            return Promise.resolve(response);
        },
    };
    w.resolveNativePlugin = (name) => {
        if (name === "StalkerPortal") return portal;
        assert.equal(name, "M3UProxy");
        return {
            proxyFetch(args) {
                calls.push(args);
                return Promise.resolve({ body: "#EXTM3U\nnative fixture" });
            },
        };
    };
    w.installCapacitorHttpTransport = () => {};
    w.eval(compile("src/plugins/stalker-portal.ts"));
    w.setupStalkerPortalShim();
    let result = await outcome(
        w.$.ajax({
            dataType: "json",
            url: "https://portal.invalid/stalker_portal/api/",
        })
    );
    assert.equal(result.ok, true);
    assert.equal(result.value.channels[0], "fixture");
    response = { body: "denied", contentType: "text/plain", status: 403 };
    result = await outcome(
        w.$.ajax({ url: "https://portal.invalid/stalker_portal/api/" })
    );
    assert.equal(result.ok, false);
    assert.match(result.value, /stalker HTTP 403: denied/);

    w.__TAURI__ = {
        core: {
            invoke(command, args) {
                assert.equal(command, "stalker_portal_fetch");
                calls.push(args);
                return Promise.resolve({
                    body: "native tauri text",
                    status: 200,
                });
            },
        },
    };
    result = await outcome(
        w.$.ajax({ url: "https://portal.invalid/stalker_portal/stream/" })
    );
    assert.deepEqual(result, { ok: true, value: "native tauri text" });
    delete w.__TAURI__;

    w.eval(compile("src/plugins/m3u-proxy.ts"));
    w.setupCapacitorCompanionShim();
    result = await outcome(
        w.$.ajax({
            data: { url: "https://stream.invalid/list.m3u" },
            url: "/m3u/cp.php",
        })
    );
    assert.deepEqual(result, { ok: true, value: "#EXTM3U\nnative fixture" });
    assert.equal(
        calls.length,
        4,
        "all response checks use actual native route wrappers"
    );
    assert.equal(calls[3].url, "https://stream.invalid/list.m3u");
}

(async () => {
    for (const [file, version] of variants) {
        const { w, close } = fixture(file, version);
        try {
            callbackContract(w, false);
            callbackContract(w, true);
            synchronousBoundaries(w);
            await promiseTiming(w);
            await nativeRoutes(w);
            console.log(
                "PASS native jQuery bridge " +
                    version +
                    ": callback order, receivers, failures, timing and native response routes"
            );
        } finally {
            close();
        }
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

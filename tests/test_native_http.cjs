const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compile = (source) =>
    ts
        .transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.replace(/^import .*\n/gm, "")
        .replace(/^export /gm, "");
function functions(file, names) {
    const source = ts.createSourceFile(
        file,
        read(file),
        ts.ScriptTarget.Latest,
        true
    );
    return names
        .map((name) => {
            const node = source.statements.find(
                (node) => node.name?.text === name
            );
            assert.ok(node, `${file}: missing ${name}`);
            return node.getText(source);
        })
        .join("\n");
}
const shim = compile(
    functions("src/index.ts", [
        "isTauriEmbedMode",
        "isRemoteHttpUrlForProxy",
        "setupTauriCompanionShim",
    ])
);
function response(body, status = 200, contentType = "application/json") {
    return {
        body,
        headers: `Content-Type: ${contentType}\r\nX-Upstream: yes\r\n`,
        status,
        statusText: status === 200 ? "OK" : "Forbidden",
    };
}
function runtime(invoke, native = true) {
    const dom = new JSDOM(
        "<!doctype html><html><head></head><body></body></html>",
        { runScripts: "outside-only", url: "http://tauri.localhost/" }
    );
    const w = dom.window;
    w.eval(read("js/jquery-1.11.1.min.js"));
    if (native) w.__TAURI__ = {};
    w.tauriInvoke = invoke;
    w.eval(compile(read("src/plugins/native-http.ts")));
    w.eval(shim);
    const originalAjax = w.$.ajax;
    w.setupTauriCompanionShim();
    return { $: w.$, close: () => w.close(), originalAjax, w };
}
function finished(xhr) {
    return new Promise((resolve) => {
        xhr.done(function (data, status, jqXHR) {
            resolve({
                count: arguments.length,
                data,
                ok: true,
                status,
                xhr: jqXHR,
            });
        });
        xhr.fail(function (jqXHR, status, error) {
            resolve({
                count: arguments.length,
                error,
                ok: false,
                status,
                xhr: jqXHR,
            });
        });
    });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
    const calls = [];
    let reply = () => response('{"epg_data":[{"name":"Programme"}]}');
    const r = runtime(async (command, args) => {
        calls.push({ args, command });
        return reply(args);
    });
    const { $, w } = r;
    try {
        const context = { request: "provider" };
        const order = [];
        const xhr = $.ajax("https://provider.example/api#fragment", {
            beforeSend(q) {
                q.setRequestHeader("X-Provider", "custom");
            },
            complete(q, status) {
                assert.equal(q, xhr);
                assert.equal(status, "success");
                order.push("complete");
            },
            context,
            data: {
                channel: "BBC + Мир",
                filter: { day: "today" },
                ids: [1, 2],
            },
            dataType: "json",
            headers: { Authorization: "Bearer test" },
            statusCode: {
                200() {
                    order.push("statusCode");
                },
            },
            success(data, status, q) {
                assert.equal(this, context);
                assert.equal(q, xhr);
                assert.equal(status, "success");
                assert.equal(data.epg_data[0].name, "Programme");
                order.push("success");
            },
            timeout: 1000,
            url: "https://must-not-override.example/",
        })
            .done(function () {
                assert.equal(this, context);
                assert.equal(arguments.length, 3);
                order.push("done");
            })
            .always(() => order.push("always"));
        let result = await finished(xhr);
        assert.equal(result.ok, true);
        assert.equal(result.count, 3);
        assert.equal(result.xhr.status, 200);
        assert.equal(result.xhr.readyState, 4);
        assert.equal(result.xhr.responseJSON.epg_data[0].name, "Programme");
        assert.equal(result.xhr.getResponseHeader("X-Upstream"), "yes");
        assert.deepEqual(order, [
            "success",
            "done",
            "always",
            "statusCode",
            "complete",
        ]);
        const request = calls.pop();
        assert.equal(request.command, "proxy_http");
        const sent = new URL(request.args.url);
        assert.equal(sent.hostname, "provider.example");
        assert.equal(sent.hash, "");
        assert.equal(sent.searchParams.get("channel"), "BBC + Мир");
        assert.deepEqual(sent.searchParams.getAll("ids[]"), ["1", "2"]);
        assert.equal(sent.searchParams.get("filter[day]"), "today");
        assert.equal(request.args.headers.Authorization, "Bearer test");
        assert.equal(request.args.headers["X-Provider"], "custom");
        assert.equal(request.args.body, undefined);

        // Real OTTCLUB provider: complete must see the object parsed in success.
        w.ottwww = "ottclub.example";
        w.eval(functions("prov/ottclub/prov.js", ["getEPGchanel"]));
        const epg = await new Promise((resolve) =>
            w.getEPGchanel("bbc", (id, data) => resolve({ data, id }))
        );
        assert.equal(epg.id, "bbc");
        assert.equal(epg.data[0].name, "Programme");

        reply = () => response('{"error":"denied"}', 403);
        result = await finished(
            $.ajax({ dataType: "json", url: "https://provider.example/api" })
        );
        assert.equal(result.ok, false);
        assert.equal(result.status, "error");
        assert.equal(result.xhr.status, 403);
        assert.equal(result.error, "Forbidden");
        assert.equal(result.xhr.responseJSON.error, "denied");
        assert.equal(result.xhr.responseText, '{"error":"denied"}');

        reply = () => response("{invalid-json");
        result = await finished(
            $.ajax({ dataType: "json", url: "https://provider.example/api" })
        );
        assert.equal(result.ok, false);
        assert.equal(result.status, "parsererror");
        assert.equal(result.xhr.status, 200);
        assert.equal(result.xhr.responseText, "{invalid-json");

        // Some playlist requests omit dataType. Never infer executable script
        // from the upstream MIME type, including jQuery 1.x HTTP-error conversion.
        for (const status of [200, 403]) {
            reply = () =>
                response(
                    "window.remoteCodeExecuted = true",
                    status,
                    "text/javascript"
                );
            result = await finished(
                $.ajax({ url: "https://provider.example/playlist" })
            );
            assert.equal(result.ok, status === 200);
            assert.equal(
                result.xhr.responseText,
                "window.remoteCodeExecuted = true"
            );
            if (status === 200)
                assert.equal(result.data, "window.remoteCodeExecuted = true");
            assert.equal(w.remoteCodeExecuted, undefined);
        }

        // Actual Shura JSONP provider chains week + archive from complete().
        const seenJsonp = [];
        reply = (args) => {
            const url = new URL(args.url);
            const callback = url.searchParams.get("callback");
            assert.ok(callback);
            assert.ok(url.searchParams.has("_"));
            seenJsonp.push(url.pathname);
            return response(
                `/**/${callback}(${JSON.stringify([{ duration: 60, name: url.pathname, start_time: 100, text: "Description" }])});`,
                200,
                "text/javascript"
            );
        };
        $.globalEval = () => {
            throw Error("Native JSONP must never evaluate remote JavaScript");
        };
        w.shserver = 1;
        w.chanels = { bbc: { rec: "1" } };
        w.eval(functions("prov/shura/prov.js", ["val2epg", "getEPGchanel"]));
        const shura = await new Promise((resolve) =>
            w.getEPGchanel("bbc", (id, data) => resolve({ data, id }))
        );
        assert.deepEqual(seenJsonp, [
            "/bbc/epg/week.jsonp",
            "/bbc/epg/archive.jsonp",
        ]);
        assert.equal(shura.data.length, 2);
        assert.equal(shura.data[0].time_to, 160);
        assert.equal(shura.data[0].name, "/bbc/epg/archive.jsonp");

        // JSONP opts.data is serialized before callback/cache parameters are appended.
        reply = (args) => {
            const url = new URL(args.url);
            assert.equal(url.searchParams.get("type"), "jsonp");
            assert.equal(url.searchParams.get("uid"), "sh123");
            return response(
                `${url.searchParams.get("callback")}([]);`,
                200,
                "text/javascript"
            );
        };
        result = await finished(
            $.ajax({
                data: { type: "jsonp", uid: "sh123" },
                dataType: "jsonp",
                url: "http://pl.tvshka.net",
            })
        );
        assert.equal(result.ok, true);
        assert.equal(result.data.length, 0);
        reply = (args) =>
            response(
                `${new URL(args.url).searchParams.get("callback")}([]); window.compromised = true;`,
                200,
                "text/javascript"
            );
        result = await finished(
            $.ajax({ dataType: "jsonp", url: "https://provider.example/epg" })
        );
        assert.equal(result.ok, false);
        assert.equal(result.status, "parsererror");
        assert.equal(w.compromised, undefined);

        reply = () => response("#EXTM3U", 200, "text/plain");
        result = await finished(
            $.ajax({
                data: { url: "@http://provider.example/list?a=1&b=2" },
                type: "POST",
                url: "/m3u/cp.php",
            })
        );
        assert.equal(result.data, "#EXTM3U");
        assert.equal(
            calls.at(-1).args.url,
            "@http://provider.example/list?a=1&b=2"
        );
        assert.equal(calls.at(-1).args.method, "GET");
        assert.equal(calls.at(-1).args.body, undefined);

        result = await finished(
            $.ajax({
                data: "{}\n\t\nchannels",
                processData: false,
                type: "POST",
                url: "https://epg.example/m3u/match-channels",
            })
        );
        assert.equal(result.ok, true);
        assert.equal(calls.at(-1).command, "proxy_http");
        assert.equal(
            calls.at(-1).args.url,
            "https://epg.example/m3u/match-channels"
        );
        assert.equal(calls.at(-1).args.body, "{}\n\t\nchannels");
        assert.equal(calls.at(-1).args.method, "POST");

        let settle;
        let successes = 0;
        let completions = 0;
        reply = () =>
            new Promise((resolve) => {
                settle = resolve;
            });
        const pending = $.ajax({
            complete() {
                completions++;
            },
            success() {
                successes++;
            },
            url: "https://provider.example/api",
        });
        const pendingResult = finished(pending);
        pending.abort();
        result = await pendingResult;
        assert.equal(result.status, "abort");
        assert.equal(result.xhr.status, 0);
        settle(response("{}"));
        await delay(5);
        assert.equal(successes, 0);
        assert.equal(completions, 1);
        result = await finished(
            $.ajax({
                complete() {
                    completions++;
                },
                timeout: 5,
                url: "https://provider.example/api",
            })
        );
        assert.equal(result.status, "timeout");
        settle(response("{}"));
        await delay(5);
        assert.equal(completions, 2);
        const count = calls.length;
        result = await finished(
            $.ajax({
                beforeSend() {
                    return false;
                },
                url: "https://provider.example/api",
            })
        );
        assert.equal(result.status, "canceled");
        assert.equal(calls.length, count);
    } finally {
        r.close();
    }

    const browser = runtime(() => {
        throw Error("Browser must not invoke native transport");
    }, false);
    assert.equal(browser.$.ajax, browser.originalAjax);
    browser.close();
    console.log(
        "OK: native HTTP with real jQuery 1.11.1, provider JSON/JSONP, status, callbacks, abort/timeout and browser isolation"
    );
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

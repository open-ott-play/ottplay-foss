// Cross-repository acceptance: actual Go server, TS transport/queries and Python CLI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const ts = require("typescript");
const net = require("node:net");
const binary = process.env.OTT_CONTROL_BINARY,
    cli = process.env.OTT_CLI;
assert(binary && cli, "Set OTT_CONTROL_BINARY and OTT_CLI");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ott-remote-test-"));
function moduleOf(file, requireFn, window) {
    const context = {
        console,
        Date,
        exports: {},
        require: requireFn,
        URL,
        window,
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        context
    );
    return context.exports;
}
(async () => {
    const listener = net.createServer();
    await new Promise((r) => listener.listen(0, "127.0.0.1", r));
    const port = listener.address().port;
    await new Promise((r) => listener.close(r));
    const serverConfig = {
        admin_token: "a".repeat(32),
        devices: [{ id: "dev_test", token: "b".repeat(32) }],
        listen: "127.0.0.1:" + port,
    };
    fs.writeFileSync(
        path.join(dir, "server.json"),
        JSON.stringify(serverConfig),
        { mode: 0o600 }
    );
    fs.writeFileSync(
        path.join(dir, "cli.json"),
        JSON.stringify({
            players: { tv: "dev_test" },
            server: "http://127.0.0.1:" + port,
            server_config: path.join(dir, "server.json"),
        })
    );
    const server = spawn(
        binary,
        ["serve", "--config", path.join(dir, "server.json")],
        { stdio: "ignore" }
    );
    let controller;
    try {
        for (let i = 0; i < 40; i++) {
            try {
                if ((await fetch("http://127.0.0.1:" + port + "/readyz")).ok)
                    break;
            } catch {}
            await new Promise((r) => setTimeout(r, 50));
        }
        let volume = 30,
            dispatches = 0,
            dropped = false;
        const host = {
            __ottClassicGuide: {
                peek: (id) =>
                    id === "a"
                        ? [
                              {
                                  name: "НОВОСТИ",
                                  time: Date.now() / 1000 - 60,
                                  time_to: Date.now() / 1000 + 600,
                              },
                          ]
                        : [],
                request: (id, cb) => {
                    cb(id, []);
                    return () => {};
                },
                source: () => "demo",
            },
            cats: { one: ["a", "b"] },
            catsArray: ["one"],
            channels: {
                a: { channel_name: "Первый" },
                b: { channel_name: "Кино" },
            },
            cList: ["a", "b"],
            clearTimeout,
            commandChannelsReady: true,
            curList: ["a", "b"],
            deviceUUID: "dev_test",
            location: { protocol: "http:" },
            playChannel: () => {},
            setTimeout,
            stbGetItem: () => "demo",
            stbGetVolume: () => volume,
        };
        const dispatch = (command) => {
            dispatches++;
            if (command.volume_step !== undefined)
                volume = Math.max(
                    0,
                    Math.min(100, volume + command.volume_step)
                );
            else if (command.volume !== undefined) volume = command.volume;
            return "accepted";
        };
        const execute = moduleOf(
            "src/commands/remote-requests.ts",
            (name) =>
                name === "../provider"
                    ? {
                          checkProviderUrl: () => true,
                          isProviderAllowed: () => true,
                          providerIds: ["demo"],
                          providerLabels: null,
                          selectProviderByIndex: () => true,
                      }
                    : { handleCommand: dispatch },
            host
        ).executeRemoteRequest;
        const transport = moduleOf(
            "src/plugins/command-server.ts",
            () => require("../tests/load-wire.cjs")(),
            host
        );
        const send = (request, complete) => {
            let aborted = false;
            fetch(request.url, {
                body: request.body,
                headers: request.headers,
                method: request.method,
            }).then(
                async (response) => {
                    const body = await response.text();
                    if (aborted) return;
                    if (
                        request.url.endsWith("/api/responses") &&
                        request.body.includes('"volume":35') &&
                        !dropped
                    ) {
                        dropped = true;
                        complete();
                        return;
                    }
                    complete({ body, status: response.status });
                },
                () => {
                    if (!aborted) complete();
                }
            );
            return () => (aborted = true);
        };
        controller = transport.createCommandServer(
            host,
            send,
            () => {},
            dispatch,
            execute
        );
        controller.configure({
            address: "http://127.0.0.1:" + port,
            enabled: true,
            token: "b".repeat(32),
        });
        async function run(...args) {
            return execFile("python3", [
                cli,
                "--config",
                path.join(dir, "cli.json"),
                "--timeout",
                "8",
                "tv",
                ...args,
            ]);
        }
        assert.equal((await run("v")).stdout.trim(), "30%");
        assert.equal((await run("v", "+5")).stdout.trim(), "35%");
        assert.equal(dispatches, 1);
        assert(dropped, "must exercise a lost response");
        assert.equal((await run("v", "-3")).stdout.trim(), "32%");
        assert.equal((await run("s", "ПЕРВ")).stdout.trim(), "1: Первый");
        assert.equal(
            (await run("p", "новости")).stdout.trim(),
            "Первый — НОВОСТИ"
        );
        assert.match((await run("2")).stdout, /Кино/);
        assert.match((await run("первый")).stdout, /Первый/);
        assert.match((await run("providers")).stdout, /demo/);
        console.log(
            "PASS real Go + TS + Python round trip, volume delta deduplication after lost response, Russian searches, EPG, numbering and provider list"
        );
    } finally {
        if (controller)
            controller.configure({ address: "", enabled: false, token: "" });
        server.kill();
        fs.rmSync(dir, { force: true, recursive: true });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

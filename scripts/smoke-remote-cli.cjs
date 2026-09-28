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
const http = require("node:http");
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
    vm.createContext(context);
    require("../tests/helpers/shared-core-runtime.cjs")(context, {
        vendorOnly: true,
    });
    vm.runInContext(
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
        devices: [
            { id: "dev_test", token: "b".repeat(32) },
            { id: "dev_second", token: "c".repeat(32) },
        ],
        listen: "127.0.0.1:" + port,
    };
    fs.writeFileSync(
        path.join(dir, "server.json"),
        JSON.stringify(serverConfig),
        { mode: 0o600 }
    );
    const server = spawn(
        binary,
        ["serve", "--config", path.join(dir, "server.json")],
        { stdio: "ignore" }
    );
    const controllers = [];
    const prefix = "/ott-control";
    const proxy = http.createServer((request, response) => {
        if (!request.url.startsWith(prefix + "/")) {
            response.writeHead(404).end();
            return;
        }
        const upstream = http.request(
            "http://127.0.0.1:" + port + request.url.slice(prefix.length),
            { headers: request.headers, method: request.method },
            (incoming) => {
                response.writeHead(incoming.statusCode, incoming.headers);
                incoming.pipe(response);
            }
        );
        upstream.on("error", () => response.writeHead(502).end());
        request.pipe(upstream);
    });
    try {
        await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
        const address = "http://127.0.0.1:" + proxy.address().port + prefix;
        fs.writeFileSync(
            path.join(dir, "cli.json"),
            JSON.stringify({
                players: { mac: "dev_second", tv: "dev_test" },
                server: address,
                server_config: path.join(dir, "server.json"),
            })
        );
        for (let i = 0; i < 40; i++) {
            try {
                if ((await fetch("http://127.0.0.1:" + port + "/readyz")).ok)
                    break;
            } catch {}
            await new Promise((r) => setTimeout(r, 50));
        }
        function player(device, token, initialVolume) {
            let volume = initialVolume,
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
                deviceUUID: device,
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
            const controller = transport.createCommandServer(
                host,
                send,
                () => {},
                dispatch,
                execute
            );
            controller.configure({
                address,
                enabled: true,
                token,
            });
            controllers.push(controller);
            return () => ({ dispatches, dropped, volume });
        }
        const television = player("dev_test", "b".repeat(32), 30);
        const desktop = player("dev_second", "c".repeat(32), 70);
        async function runOn(name, ...args) {
            return execFile("python3", [
                cli,
                "--config",
                path.join(dir, "cli.json"),
                "--timeout",
                "8",
                name,
                ...args,
            ]);
        }
        const run = (...args) => runOn("tv", ...args);
        assert.equal((await run("v")).stdout.trim(), "30%");
        assert.equal((await run("v", "+5")).stdout.trim(), "35%");
        assert.equal(television().dispatches, 1);
        assert(television().dropped, "must exercise a lost response");
        assert.equal((await run("v", "-3")).stdout.trim(), "32%");
        assert.equal((await run("s", "ПЕРВ")).stdout.trim(), "1: Первый");
        assert.equal(
            (await run("p", "новости")).stdout.trim(),
            "Первый — НОВОСТИ"
        );
        assert.match((await run("2")).stdout, /Кино/);
        assert.match((await run("первый")).stdout, /Первый/);
        assert.match((await run("providers")).stdout, /demo/);
        const pair = await Promise.all([
            runOn("TV", "v", "+2"),
            runOn("MaC", "v", "-10"),
        ]);
        assert.equal(pair[0].stdout.trim(), "34%");
        assert.equal(pair[1].stdout.trim(), "60%");
        assert.equal(television().volume, 34);
        assert.equal(desktop().volume, 60);
        assert.equal(desktop().dispatches, 1);
        console.log(
            "PASS real Go + TS + Python through reverse-proxy prefix: two-player isolation, volume delta deduplication after lost response, Russian searches, EPG, numbering and providers"
        );
    } finally {
        for (const controller of controllers)
            controller.configure({ address: "", enabled: false, token: "" });
        proxy.closeAllConnections();
        await new Promise((resolve) => proxy.close(resolve));
        server.kill();
        fs.rmSync(dir, { force: true, recursive: true });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

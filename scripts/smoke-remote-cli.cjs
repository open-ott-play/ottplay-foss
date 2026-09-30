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
                dropped = false,
                playlistLoads = 0,
                reloads = 0,
                streamRestarts = 0,
                droppedReload = false;
            let configuration = {
                active: 0,
                M3Us: Array.from({ length: 15 }, (_, index) => ({
                    medUrl: "",
                    name: "Profile " + (index + 1),
                    rechours: 0,
                    www: index === 0 ? "https://example.com/one.m3u" : "",
                })),
            };
            const clone = (value) => JSON.parse(JSON.stringify(value));
            const host = {
                __ottActiveProviderDriver: {
                    configuration: () => clone(configuration),
                    fixedSlot: () => -1,
                    id: "m3u",
                    saveConfiguration: (value) => {
                        value.M3Us.forEach((slot, index) => {
                            if (
                                slot.medUrl !== configuration.M3Us[index].medUrl
                            )
                                slot.medSourceId = "test-media-source-" + index;
                        });
                        configuration = clone(value);
                        return true;
                    },
                },
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
                loadPlaylist: () => playlistLoads++,
                location: { protocol: "http:" },
                playChannel: () => {},
                restart: () => reloads++,
                setTimeout,
                stbGetItem: () => "demo",
                stbGetVolume: () => volume,
            };
            host.stbPlay = () => {};
            host.__ottCoreTransport = { play: host.stbPlay };
            host.__ottCoreBackend = () => ({
                restart: () => {
                    streamRestarts++;
                    return {
                        accepted: true,
                        dispatched: true,
                        target: "stream",
                    };
                },
            });
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
            const dependencies = (name) =>
                name === "../provider"
                    ? {
                          checkProviderUrl: () => true,
                          isProviderAllowed: () => true,
                          providerIds: ["demo", "m3u"],
                          providerLabels: null,
                          selectProviderByIndex: () => true,
                      }
                    : name === "./remote-profiles"
                      ? moduleOf(
                            "src/commands/remote-profiles.ts",
                            dependencies,
                            host
                        )
                      : name === "../plugins/vportal"
                        ? moduleOf("src/plugins/vportal.ts", dependencies, host)
                        : name === "./remote-restart"
                          ? moduleOf(
                                "src/commands/remote-restart.ts",
                                dependencies,
                                host
                            )
                          : name === "../utils/caseless"
                            ? moduleOf("src/utils/caseless.ts", () => {}, host)
                            : { handleCommand: dispatch };
            const execute = moduleOf(
                "src/commands/remote-requests.ts",
                dependencies,
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
                            request.body.includes(
                                '"effect":"reload-after-ack"'
                            ) &&
                            !droppedReload
                        ) {
                            assert.equal(
                                reloads,
                                0,
                                "reload must wait for response delivery acknowledgement"
                            );
                            droppedReload = true;
                            complete();
                            return;
                        }
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
            return () => ({
                configuration: clone(configuration),
                dispatches,
                dropped,
                droppedReload,
                playlistLoads,
                reloads,
                streamRestarts,
                volume,
            });
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
        const original = television().configuration;
        const settingsFile = path.join(dir, "profile.json");
        fs.writeFileSync(
            settingsFile,
            JSON.stringify({
                history_hours: 72,
                name: "Movies",
                playlist: "https://example.com/two.m3u?token=TEST_ONLY_TOKEN",
                vportal:
                    "portal::[key:TEST_ONLY_KEY]https://example.com/api/v1/",
            }),
            { mode: 0o600 }
        );
        const configured = await run("profile-config", "2", settingsFile);
        assert(
            !/TEST_ONLY/.test(configured.stdout + configured.stderr),
            "configuration replies must not expose credentials"
        );
        assert.equal(television().configuration.active, 0);
        assert.equal(
            television().playlistLoads,
            0,
            "editing another profile must not reload playback"
        );
        assert.deepEqual(television().configuration.M3Us[0], original.M3Us[0]);
        assert.deepEqual(
            television().configuration.M3Us.slice(2),
            original.M3Us.slice(2)
        );
        assert.equal(television().configuration.M3Us[1].rechours, 72);
        const listed = await run("profiles");
        assert.match(listed.stdout, /Movies/);
        assert(!/TEST_ONLY/.test(listed.stdout + listed.stderr));
        await run("profile", "2");
        assert.equal(television().configuration.active, 1);
        assert.equal(television().playlistLoads, 1);
        await run("profile", "2", "name", "Cinema");
        assert.equal(
            television().playlistLoads,
            1,
            "renaming must not reload playback"
        );
        assert.equal(television().configuration.M3Us[1].name, "Cinema");
        assert.equal(
            desktop().configuration.active,
            0,
            "profile commands must remain device-scoped"
        );
        assert.deepEqual(desktop().configuration.M3Us[1], original.M3Us[1]);
        await run("restart");
        assert.equal(television().streamRestarts, 1);
        const restart = await run("restart", "player");
        assert.match(restart.stdout, /accepted/);
        for (let attempt = 0; attempt < 30 && !television().reloads; attempt++)
            await new Promise((resolve) => setTimeout(resolve, 100));
        assert(
            television().droppedReload,
            "must exercise a lost reload receipt acknowledgement"
        );
        assert.equal(
            television().reloads,
            1,
            "a retried receipt must deliver the reload effect once"
        );
        assert.equal(desktop().reloads, 0);
        assert.equal(desktop().streamRestarts, 0);
        console.log(
            "PASS real Go + TS + Python through reverse-proxy prefix: device isolation, lost-response deduplication, searches, providers, atomic M3U profile edits, secret-free replies and acknowledged restarts"
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

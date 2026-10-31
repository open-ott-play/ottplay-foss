// Real Go queue + compiled TS collector/transport/dispatcher + Python workbench.
// Only the DOM/media host is synthetic. No user devices or external providers.
// Run npm run build first: lazy diagnostic modules use their real built assets.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, execFile: callbackExecFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFile = promisify(callbackExecFile);
const binary = process.env.OTT_CONTROL_BINARY;
const cli = process.env.OTT_CLI;
assert(binary && cli, "Set OTT_CONTROL_BINARY and OTT_CLI");
const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ott-workbench-"))
);
const emitted = path.join(directory, "player");
const admin = "a".repeat(32);
const token = "b".repeat(32);
const secret = "synthetic-private-url-token";
const version = "1.1.53-beta.13+workbench-smoke";
const source = "1".repeat(40);
let server, controller, runtimeDebug;
let transportFailure = null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    await execFile(process.execPath, [
        require.resolve("typescript/bin/tsc"),
        "--project",
        "tsconfig.json",
        "--module",
        "commonjs",
        "--outDir",
        emitted,
    ]);
    const reserve = net.createServer();
    await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const origin = "http://127.0.0.1:" + port;
    const credentials = path.join(directory, "server.json");
    const config = path.join(directory, "cli.json");
    fs.writeFileSync(
        credentials,
        JSON.stringify({
            admin_token: admin,
            devices: [{ id: "workbench", token }],
            listen: "127.0.0.1:" + port,
        }),
        { mode: 0o600 }
    );
    fs.writeFileSync(
        config,
        JSON.stringify({
            players: { fixture: "workbench" },
            server: origin,
            server_config: credentials,
        }),
        { mode: 0o600 }
    );
    server = spawn(binary, ["serve", "--config", credentials], {
        stdio: "ignore",
    });
    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt++) {
        try {
            ready = (await fetch(origin + "/readyz")).ok;
        } catch {}
        if (!ready) await delay(100);
    }
    assert(ready, "Go controller did not become ready");
    const started = Date.now();
    const state = {
        changeAt: null,
        generation: 3,
        handle: 9,
        hidden: false,
        inject: false,
        injections: 0,
        inspections: 0,
        mutations: 0,
        overlay: false,
        phase: "playing",
        position: null,
        resumes: 0,
    };
    const position = () =>
        state.position === null
            ? 10 + (Date.now() - started) / 1000
            : state.position;
    const listeners = new Map();
    const events = (prefix) => ({
        addEventListener(name, callback) {
            const key = prefix + name;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key).add(callback);
        },
        removeEventListener(name, callback) {
            listeners.get(prefix + name)?.delete(callback);
        },
    });
    const buffered = { end: () => 600, length: 1, start: () => 0 };
    const video = {
        ...events("media:"),
        buffered,
        get currentTime() {
            return position();
        },
        ended: false,
        getBoundingClientRect: () => ({
            height: 720,
            left: 0,
            top: 0,
            width: 1280,
        }),
        networkState: 2,
        parentElement: null,
        get paused() {
            return state.phase === "paused";
        },
        playbackRate: 1,
        readyState: 4,
        seeking: false,
        videoHeight: 360,
        videoWidth: 640,
    };
    const dialog = {
        getBoundingClientRect: () => ({
            height: 250,
            left: 20,
            top: 30,
            width: 400,
        }),
        parentElement: null,
    };
    const loadedAssets = [];
    const body = {
        appendChild(script) {
            const match =
                /^\/dist\/(runtime-debug-details|perf-capture)\.js\?/.exec(
                    script.src
                );
            assert(match, "Unexpected lazy asset: " + script.src);
            // Execute the real emitted asset; do not bypass the feature loader.
            vm.runInNewContext(
                fs.readFileSync(path.join("dist", match[1] + ".js"), "utf8"),
                { console, Date, window: host },
                { filename: script.src }
            );
            loadedAssets.push(match[1]);
            queueMicrotask(() => script.onload());
            return script;
        },
        parentElement: null,
    };
    const host = {
        __ottClassicPlayback: {
            snapshot: () => ({
                generation: state.generation,
                phase: state.phase,
                target: { kind: "vod" },
            }),
        },
        __ottClassicScreenPort: {
            revision: () => (state.overlay ? 2 : 1),
            screens: {
                current: () =>
                    state.overlay ? { id: 5, kind: "dialog" } : null,
            },
        },
        __ottParental: { needs: () => false },
        __ottRemoteLifecycle: { platform: "browser" },
        $: () => ({ is: () => false }),
        clearTimeout,
        commandChannelsReady: true,
        console,
        deviceUUID: "workbench",
        document: {
            ...events("document:"),
            activeElement: video,
            body,
            createElement: (tag) => {
                assert.equal(tag, "script");
                return {};
            },
            getElementById: (id) =>
                id === "video"
                    ? video
                    : id === "dialogbox" && state.overlay
                      ? dialog
                      : null,
            hasFocus: () => true,
            visibilityState: "visible",
        },
        getComputedStyle: (element) => ({
            display: element === video && state.hidden ? "none" : "block",
            opacity: "1",
            visibility: "visible",
        }),
        Hls: require("hls.js"),
        location: { protocol: "http:" },
        performance: { now: () => Date.now() - started },
        restart: () => {
            state.mutations++;
        },
        setTimeout,
        stbGetItem: () => secret,
        stbIsStandby: () => false,
        stbPlay: () => {
            state.mutations++;
        },
    };
    host.__ottCoreTransport = { play: host.stbPlay };
    const hls = {
        config: { maxBufferLength: 30, maxBufferSize: 33554432 },
        currentLevel: 0,
        latestLevelDetails: { edge: 600, targetduration: 10 },
        levels: [{ bitrate: 200000000, maxBitrate: 200000000 }],
        loadLevel: 0,
        maxBufferLength: 30,
        off: events("hls:").removeEventListener,
        on: events("hls:").addEventListener,
    };
    const handle = {
        active: () => true,
        diagnosticEngine: () => "hls.js",
        diagnosticMedia: () => ({ hls, media: video }),
        get id() {
            return state.handle;
        },
        pause: () => {
            state.phase = "paused";
            state.mutations++;
        },
        resume: () => {
            state.phase = "playing";
            state.resumes++;
            state.mutations++;
        },
        snapshot: () => ({
            duration: 600,
            phase: state.phase,
            position: position(),
        }),
    };
    const backend = {
        current: (lane) => (lane === "pip" ? null : handle),
    };
    host.__ottCoreBackend = host.__ottCoreBackendPeek = () => backend;
    const modules = new Map();
    function load(file) {
        if (modules.has(file)) return modules.get(file);
        // Only unrelated host/provider ports are stubs; tested logic is emitted TS.
        if (file === "provider.js")
            return { providerIds: [], providerLabels: null };
        if (file === "commands/index.js")
            return {
                handleCommand: () => {
                    throw new Error("Unexpected legacy mutation");
                },
            };
        const exports = {};
        modules.set(file, exports);
        const context = {
            console,
            Date,
            document: host.document,
            exports,
            require: (name) => {
                assert(
                    name.startsWith("."),
                    "Unexpected external runtime dependency"
                );
                const resolved =
                    path.posix.normalize(
                        path.posix.join(path.posix.dirname(file), name)
                    ) + ".js";
                assert(!resolved.startsWith("../"));
                return load(resolved);
            },
            URL,
            window: host,
        };
        vm.createContext(context);
        require("../tests/helpers/shared-core-runtime.cjs")(context, {
            vendorOnly: true,
        });
        // The normal bundler substitutes these identity constants too.
        const code = fs
            .readFileSync(path.join(emitted, file), "utf8")
            .replaceAll("__OTTP_VERSION__", version)
            .replaceAll("__OTTP_SOURCE_REVISION__", source)
            .replaceAll("__OTTP_BUILD_ID__", "workbench-smoke");
        vm.runInContext(code, context, { filename: file });
        return exports;
    }
    const inspection = load(
        "plugins/remote-inspect.js"
    ).installRemoteInspection(host);
    runtimeDebug = host.__ottRuntimeDebug = load(
        "plugins/runtime-debug.js"
    ).installRuntimeDebug(host, {
        getConfig: () => ({ address: origin, enabled: true, token }),
        runtime: () =>
            load("commands/remote-restart.js").remotePlayerInfo(host).runtime,
    });
    runtimeDebug.configurationChanged();
    const execute = load("commands/remote-requests.js").executeRemoteRequest;
    const transport = load("plugins/command-server.js");
    const executed = [];
    const mutationIDs = [];
    async function raw(endpoint, method = "GET", data, credential = admin) {
        const response = await fetch(origin + endpoint, {
            headers: {
                Authorization: "Bearer " + credential,
                "Content-Type": "application/json",
            },
            method,
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        return { data: await response.json(), status: response.status };
    }
    async function injectStaleResponses(request) {
        for (const data of [
            { error: "Unsupported legacy action" },
            {
                error: "unsupported",
                runtime: "other-page",
                section: request.params.section,
                version: 1,
            },
        ]) {
            const result = await raw(
                "/api/responses",
                "POST",
                { data, id: request.id, status: "unsupported" },
                token
            );
            assert.equal(
                result.status,
                400,
                "Unbound/wrong-runtime reply must not consume inspection"
            );
            const pending = await raw(
                "/api/requests?device_id=workbench&id=" + request.id
            );
            assert.equal(pending.status, 202);
            assert.equal(pending.data.status, "pending");
            state.injections++;
        }
    }
    const send = (request, complete) => {
        let aborted = false;
        fetch(request.url, {
            body: request.body,
            headers: request.headers,
            method: request.method,
        })
            .then(async (response) => {
                const text = await response.text();
                if (aborted) return;
                if (
                    state.inject &&
                    request.url.includes("/api/webhook/commands")
                ) {
                    const payload = JSON.parse(text);
                    const item = payload.requests?.find(
                        (item) => item.action === "inspect"
                    );
                    if (item) {
                        state.inject = false;
                        await injectStaleResponses(item);
                    }
                }
                complete({ body: text, status: response.status });
            })
            .catch((error) => {
                if (!aborted) {
                    transportFailure = error;
                    complete();
                }
            });
        return () => {
            aborted = true;
        };
    };
    controller = transport.createCommandServer(
        host,
        send,
        () => {},
        () => {
            throw new Error("Unexpected legacy command");
        },
        (request, done, afterReply) => {
            executed.push(JSON.parse(JSON.stringify(request)));
            if (
                request.action === "inspect" &&
                request.params.section === "snapshot"
            ) {
                state.inspections++;
                if (state.inspections === state.changeAt) state.generation++;
            }
            if (request.action === "playback") mutationIDs.push(request.id);
            return inspection.execute(request, done, afterReply, execute);
        },
        inspection.accept
    );
    controller.configure({ address: origin, enabled: true, token });
    async function run(args, expected = 0) {
        let result;
        try {
            result = await execFile(
                "python3",
                [cli, "-c", config, "-t", "12", "fixture", ...args, "--json"],
                { timeout: 20000 }
            );
            assert.equal(expected, 0, "Expected a nonzero workbench verdict");
        } catch (error) {
            assert.equal(
                error.code,
                expected,
                error.stderr || error.stdout || error.message
            );
            result = error;
        }
        assert.equal(result.stderr, "");
        assert(
            !result.stdout.includes(secret),
            "Private host data escaped workbench output"
        );
        if (transportFailure) throw transportFailure;
        return JSON.parse(result.stdout);
    }
    state.inject = true;
    const doctor = await run(["doctor", "--lane", "web"]);
    const initial = doctor.observations[0];
    assert.equal(initial.status, "observed");
    assert.equal(initial.data.build.version, version);
    assert.equal(initial.data.build.sourceRevision, source);
    assert.equal(initial.data.consistent, true);
    assert.equal(initial.data.media.generation, 3);
    assert.equal(initial.data.media.displayEvidence, "unavailable");
    assert.equal(state.injections, 2);
    assert.equal(state.mutations, 0, "Read-only doctor invoked a media effect");
    assert.deepEqual(initial.capabilities.inspect.sections, [
        "doctor",
        "snapshot",
        "operation",
    ]);
    const debug = await run(["debug"]);
    assert.equal(debug.observations[0].status, "observed");
    assert.equal(debug.observations[0].data.native.state, "unsupported");
    assert.equal(debug.observations[0].data.media[0].generation, 3);
    assert.equal(debug.observations[0].data.events[0].code, "started");
    assert.equal(debug.observations[0].data.version, 1);
    assert.deepEqual(loadedAssets, ["runtime-debug-details"]);
    assert(!Object.hasOwn(debug.observations[0].data.media[0], "engine"));
    if (process.env.OTT_DEBUG_ENGINE_V2 === "1") {
        const extended = await run(["debug", "--engine"]);
        // The current CLI negotiates attempt-aware v3 when explicitly offered.
        assert.equal(extended.observations[0].data.version, 3);
        assert.equal(extended.observations[0].data.media[0].engine, "hls.js");
        assert.equal(extended.observations[0].data.media[0].generation, 3);
    } else if (process.env.OTT_DEBUG_ENGINE_V2 === "unsupported-controller") {
        const unavailable = await run(["debug", "--engine"], 3);
        assert.equal(
            unavailable.observations[0].reason,
            "unsupported_controller"
        );
        assert(!Object.hasOwn(unavailable.observations[0], "data"));
    }
    assert.equal(state.mutations, 0, "Debug request changed playback");
    if (process.env.OTT_PERF_CAPTURE === "unsupported-controller") {
        const unsupported = await run(
            ["perf", "start", "--duration", "10", "--hls-details"],
            3
        );
        assert.equal(unsupported.reason, "unsupported_controller");
        assert.equal(host.__ottPerfCaptureFactory, undefined);
    } else if (process.env.OTT_PERF_CAPTURE === "1") {
        const count = () =>
            [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
        const before = count();
        assert.equal(host.__ottPerfCaptureFactory, undefined);
        const idle = await run(["perf", "status"]);
        assert.equal(idle.data.session, null);
        assert.equal(count(), before, "Idle collector attached sensors");
        const start = await run([
            "perf",
            "start",
            "--duration",
            "30",
            "--hls-details",
        ]);
        assert.equal(start.version, 2);
        assert.equal(start.data.session.state, "active");
        assert(count() > before, "Explicit capture did not attach sensors");
        const now = host.performance.now();
        const frag = {
            cc: 0,
            elementaryStreams: { video: { endPTS: 20.001, startPTS: 10.001 } },
            end: 20,
            endPTS: 20.001,
            level: 0,
            sn: 7,
            start: 10,
            startPTS: 10.001,
            stats: {
                loaded: 5000000,
                loading: { end: now - 10, first: now - 20, start: now - 30 },
            },
            url: secret,
        };
        const emit = (name, data) =>
            [...(listeners.get("hls:" + name) || [])].forEach((fn) =>
                fn(name, data)
            );
        emit("hlsFragLoaded", { frag, networkDetails: { status: 200 } });
        emit("hlsFragBuffered", { frag });
        emit("hlsBufferAppended", {
            timeRanges: { audio: buffered, video: buffered },
        });
        await delay(1100);
        const id = start.session_id;
        const active = await run(["perf", "status", "--session", id]);
        assert.equal(active.data.session.state, "active");
        const read = await run(["perf", "read", id]);
        const kinds = new Set(read.data.events.map((event) => event.kind));
        for (const kind of [
            "sample",
            "loop",
            "hls",
            "hls_fragment",
            "hls_buffer",
            "hls_config",
            "hls_live",
        ])
            assert(
                kinds.has(kind),
                "Missing end-to-end performance event: " + kind
            );
        const fragment = read.data.events.find(
            (event) => event.kind === "hls" && event.data.event === "fragment"
        );
        assert.equal(fragment.data.bytes, 5000000);
        assert.equal(fragment.data.load_duration_ms, 20);
        assert.equal(
            read.data.events.find((event) => event.kind === "hls_fragment").data
                .start_pts_seconds,
            10.001
        );
        assert.equal(
            read.data.events.find((event) => event.kind === "hls_config").data
                .max_buffer_length_seconds,
            30
        );
        assert.equal(
            read.data.events.find((event) => event.kind === "hls_live").data
                .current_level.max_bitrate,
            200000000
        );
        const stop = await run(["perf", "stop", id]);
        assert.equal(stop.data.session.state, "stopped");
        assert.equal(stop.data.session.reason, "requested");
        assert.equal(count(), before, "Stopped capture retained sensors");
        const exported = await run([
            "perf",
            "export",
            id,
            "--out",
            path.join(directory, "performance"),
        ]);
        assert.equal(exported.capture.complete, true);
        assert.equal(exported.capture.last_session.state, "stopped");
        const evidence = path.join(directory, "performance", "result.json");
        assert.equal(fs.statSync(evidence).mode & 0o777, 0o600);
        assert(!fs.readFileSync(evidence, "utf8").includes(secret));
        assert.deepEqual(loadedAssets, [
            "runtime-debug-details",
            "perf-capture",
        ]);
        assert.equal(
            state.mutations,
            0,
            "Performance diagnostics changed playback"
        );
        console.log(
            "PASS real perf-v2 start/status/read/stop/export, lazy assets, HLS timings, idle and stopped sensor cleanup"
        );
    }
    state.hidden = state.overlay = true;
    const hidden = await run([
        "inspect",
        "--lane",
        "web",
        "--view",
        "ui,media",
    ]);
    assert.equal(hidden.observations[0].data.ui.owner.kind, "dialog");
    assert(hidden.observations[0].data.reasons.includes("owned_overlay_open"));
    assert(hidden.observations[0].data.reasons.includes("video_css_hidden"));
    state.hidden = state.overlay = false;
    const health = await run([
        "test",
        "run",
        "health",
        "--lane",
        "web",
        "--report",
        path.join(directory, "health"),
    ]);
    assert.equal(health.verdict, "pass");
    const progress = await run([
        "test",
        "run",
        "media-progress",
        "--lane",
        "web",
        "--duration",
        "1",
        "--report",
        path.join(directory, "progress"),
    ]);
    assert.equal(progress.verdict, "pass");
    assert.equal(progress.evidence_level, "decoder_progress_only");
    state.changeAt = state.inspections + 2;
    const changed = await run(
        [
            "test",
            "run",
            "media-progress",
            "--lane",
            "web",
            "--duration",
            "1",
            "--report",
            path.join(directory, "changed"),
        ],
        3
    );
    assert.equal(changed.reason, "media_identity_changed_or_unavailable");
    assert.equal(state.mutations, 0);
    // Ordinary CLI controls use -j before the player, unlike workbench-local flags.
    await execFile("python3", [
        cli,
        "-c",
        config,
        "-t",
        "12",
        "-j",
        "fixture",
        "pause",
    ]);
    await execFile("python3", [
        cli,
        "-c",
        config,
        "-t",
        "12",
        "-j",
        "fixture",
        "resume",
    ]);
    assert.equal(state.resumes, 1);
    const resumed = await run(["operation", mutationIDs.at(-1)]);
    assert.equal(resumed.operation_state, "invoked");
    assert.equal(
        resumed.observations[0].data.evidence.kind,
        "handler_completed"
    );
    assert.equal(state.resumes, 1, "Reading the receipt repeated resume");
    const unknown = await run(["operation", "f".repeat(32)], 3);
    assert.equal(unknown.operation_state, "unknown");
    const output = path.join(directory, "bundle");
    const debugRequestsBeforeBundle = executed.filter(
        (request) =>
            request.action === "inspect" && request.params.section === "debug"
    ).length;
    const statusRequestsBeforeBundle = executed.filter(
        (request) => request.action === "status"
    ).length;
    const bundle = await run(["bundle", "--lane", "web", "--out", output]);
    assert.equal(bundle.verdict, "observed");
    if (bundle.provider_observations !== undefined) {
        assert.equal(bundle.provider_observations.length, 1);
        const observation = bundle.provider_observations[0];
        assert.equal(observation.status, "observed");
        assert.equal(observation.data.version, 1);
        assert.equal(observation.data.runtime, observation.runtime);
        assert.equal(typeof observation.runtime, "string");
        assert(observation.runtime.length > 0);
        assert.equal(observation.data.available, false);
        assert.equal(observation.data.provider, null);
        assert.equal(observation.data.catalog, null);
        assert.equal(observation.data.lookup, null);
        assert.deepEqual(observation.data.requests, []);
        assert.equal(observation.data.requestsDropped, 0);
        assert.equal(
            executed.filter((request) => request.action === "status").length -
                statusRequestsBeforeBundle,
            1,
            "The provider observation uses one read-only status request"
        );
    }
    if (process.env.OTT_DEBUG_ENGINE_V2 === "unsupported-controller") {
        // Bundle auto-selects the advertised debug version; an old controller
        // rejects it without a second request for the legacy debug payload.
        assert.equal(bundle.debug_observations[0].status, "unknown");
        assert.equal(
            bundle.debug_observations[0].reason,
            "unsupported_controller"
        );
        assert(!Object.hasOwn(bundle.debug_observations[0], "data"));
        assert.equal(
            executed.filter(
                (request) =>
                    request.action === "inspect" &&
                    request.params.section === "debug"
            ).length,
            debugRequestsBeforeBundle,
            "rejected bundle debug must not be delivered or downgraded"
        );
    } else assert.equal(bundle.debug_observations[0].status, "observed");
    const verified = await execFile("python3", [
        cli,
        "report",
        "verify",
        output,
        "--json",
    ]);
    assert.equal(JSON.parse(verified.stdout).valid, true);
    assert.equal(JSON.parse(verified.stdout).integrity, "verified");
    const bytes = fs.readFileSync(path.join(output, "result.json"));
    const manifest = JSON.parse(
        fs.readFileSync(path.join(output, "manifest.json"), "utf8")
    );
    assert.equal(
        manifest.files[0].sha256,
        crypto.createHash("sha256").update(bytes).digest("hex")
    );
    assert.equal(manifest.files[0].bytes, bytes.length);
    assert.equal(
        fs.statSync(path.join(output, "result.json")).mode & 0o777,
        0o600
    );
    assert(!bytes.includes(Buffer.from(secret)));
    assert.equal(
        state.mutations,
        2,
        "Workbench issued a mutation outside explicit pause/resume"
    );
    assert(
        executed.every(
            (request) =>
                [
                    "capabilities",
                    "inspect",
                    "playback",
                    "perf_capture",
                ].includes(request.action) ||
                (request.action === "status" &&
                    request.params !== null &&
                    typeof request.params === "object" &&
                    !Array.isArray(request.params) &&
                    Object.keys(request.params).length === 0)
        )
    );
    console.log(
        "PASS real Go + compiled TS collector/inspection/transport + Python doctor/inspect/operation/scenarios/bundle: bound receipts, rejected stale responses, SemVer metadata, visibility, identity continuity, no read-only effects and private artifact hashes"
    );
})()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (runtimeDebug) runtimeDebug.dispose();
        if (controller)
            controller.configure({ address: "", enabled: false, token: "" });
        if (server) {
            server.kill();
            await Promise.race([
                new Promise((resolve) => server.once("exit", resolve)),
                delay(2000),
            ]);
        }
        fs.rmSync(directory, { force: true, recursive: true });
    });

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("src/core/buffer-policy.ts", "utf8");
const context = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText,
    context
);
const {
    createBufferPolicy: policy,
    coreBufferPolicy,
    snapshotInitialHlsBufferPolicy,
    isAceStreamSource,
} = context.exports;
const desktop = policy({ deviceMemory: 8, live: true });
const merged = {
    backBufferLength: 15,
    get loader() {
        throw Error("unrelated HLS fields must not be read");
    },
    maxBufferLength: 20,
    maxBufferSize: 32000000,
    maxMaxBufferLength: 60,
};
const initial = snapshotInitialHlsBufferPolicy({ config: merged });
merged.maxMaxBufferLength = 5.005;
assert.equal(initial.max_max_buffer_length_seconds, 60);
assert.equal(initial.max_buffer_size_bytes, 32000000);
assert.deepEqual(Object.keys(initial).sort(), [
    "back_buffer_length_seconds",
    "max_buffer_length_seconds",
    "max_buffer_size_bytes",
    "max_max_buffer_length_seconds",
]);
assert.equal(snapshotInitialHlsBufferPolicy(null), null);
assert.equal(
    snapshotInitialHlsBufferPolicy({
        get config() {
            throw Error("unavailable");
        },
    }),
    null
);
const unavailable = snapshotInitialHlsBufferPolicy({
    config: {
        get backBufferLength() {
            throw Error("unavailable");
        },
        maxBufferLength: Infinity,
        maxBufferSize: 2.5,
        maxMaxBufferLength: -1,
    },
});
assert(Object.values(unavailable).every((value) => value === null));
assert.equal(desktop.hls.maxBufferLength, 30);
assert.equal(desktop.hls.maxBufferSize, 120000000);
assert.equal(desktop.hls.maxMaxBufferLength, 60);
const low = policy({ android: true, deviceMemory: 2 });
assert.equal(low.profile, "low-memory/live");
assert.equal(low.hls.maxBufferSize, 32000000);
assert.equal(low.hls.backBufferLength, 15);
assert.equal(
    policy({ android: true }).profile,
    "android/live",
    "missing memory is not proof of low RAM"
);
assert.equal(policy({ android: true }).hls.maxBufferSize, 64000000);
assert.equal(
    policy({ android: true, deviceMemory: 8, lowMemoryDevice: true }).profile,
    "low-memory/live",
    "a native low-RAM signal must not be overridden by a larger browser hint"
);
assert.equal(
    policy({ android: true, deviceMemory: 2, lowMemoryDevice: false }).profile,
    "low-memory/live",
    "a native standard-device hint must not raise the browser's memory budget"
);
assert.equal(
    policy({ android: true, lowMemoryDevice: "true" }).profile,
    "android/live",
    "the native classification must be a boolean"
);
for (const memory of [undefined, NaN, -1, 0, Infinity])
    assert.equal(policy({ deviceMemory: memory }).profile, "standard/live");
for (const url of [
    "acestream://012345",
    "http://127.0.0.1:6878/ace/getstream?id=x",
    "https://engine/ace/manifest.m3u8?id=x",
])
    assert.equal(isAceStreamSource(url), true, url);
for (const url of [
    "https://example/test?name=acestream",
    "https://example/acestream/movie.mp4",
    "https://example/ace/getstream-not-this",
])
    assert.equal(isAceStreamSource(url), false, url);
const ace = policy({ deviceMemory: 2, url: "acestream://id" });
assert.ok(
    ace.hls.maxBufferLength > low.hls.maxBufferLength,
    "jitter tolerance retained on a constrained device"
);
assert.equal(
    ace.hls.maxBufferSize,
    low.hls.maxBufferSize,
    "transport cannot bypass memory budget"
);
const resolved = policy({
    originalUrl: "acestream://id",
    url: "http://proxy/live.m3u8",
});
assert.equal(resolved.profile, "standard/acestream");
const vod = policy({ live: false });
assert.equal(vod.profile, "standard/vod");
assert.equal(vod.hls.maxBufferLength, 60);
for (const seconds of [1, 10, 120]) {
    const explicit = policy({ seconds, url: "acestream://id" });
    assert.equal(explicit.hls.maxBufferLength, seconds);
    assert.equal(explicit.shaka.bufferingGoal, seconds);
    assert.ok(explicit.shaka.rebufferingGoal <= seconds);
    assert.ok(explicit.hls.maxMaxBufferLength >= seconds);
}
for (const seconds of [undefined, "invalid", -10, Infinity, 121])
    assert.equal(policy({ seconds }).explicit, false);
const pip = policy({ android: true, deviceMemory: 2, pip: true });
assert.equal(pip.hls.backBufferLength, 0);
assert.equal(pip.hls.maxBufferSize, 16000000);
assert.equal(
    coreBufferPolicy(
        { navigator: { deviceMemory: 2, userAgent: "Android" } },
        "movie.mp4",
        "movie.mp4",
        0,
        false
    ).profile,
    "low-memory/vod"
);
assert.equal(
    Object.keys(desktop.hls).some((k) => /retry|timeout/i.test(k)),
    false,
    "buffer policy never changes retries"
);
console.log(
    "buffer policy: bounded device/source profiles, explicit settings, PiP and URL detection passed"
);

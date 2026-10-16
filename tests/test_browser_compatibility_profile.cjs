const assert = require("node:assert/strict");
const { test } = require("node:test");
const inventory = require("../.github/browser-compatibility.json");
const {
    scenarioPattern,
    selectProfile,
    verifyCapabilities,
} = require("../scripts/browser-compatibility-profile.cjs");
const mse = {
    mediaSource: true,
    webkitMediaSource: false,
    managedMediaSource: false,
    h264Mse: true,
    aacMse: true,
    nativeHls: "",
};
const unavailable = {
    mediaSource: false,
    webkitMediaSource: false,
    managedMediaSource: false,
    h264Mse: false,
    aacMse: false,
    nativeHls: "",
};
test("scenario matching treats regex punctuation literally", () => {
    const pattern = scenarioPattern(["hls.js", "a(b)c", "[x]+?", "a\\b"]);
    for (const title of ["hls.js", "a(b)c", "[x]+?", "a\\b"]) {
        assert.equal(pattern.test("suite " + title), true, title);
    }
    for (const title of ["hlsXjs", "abc", "xxx", "hls.js extra"]) {
        assert.equal(pattern.test(title), false, title);
    }
});
function runtime(row) {
    return {
        target: row.id,
        engine: row.engine,
        channel: row.channel || "",
        playwrightVersion: row.playwright,
        browserVersion: row.browser_version,
        platform: row.os.startsWith("windows-")
            ? "win32"
            : row.os.startsWith("macos-")
              ? "darwin"
              : "linux",
    };
}
function profileFor(row) {
    const value = runtime(row);
    return selectProfile(value, value.platform);
}
test("all 35 exact targets retain mandatory UI with 32 HLS targets and three explicit limitations", () => {
    let uiOnly = 0,
        scenarioCount = 0,
        requiredScenarios = 0;
    assert.equal(inventory.length, 35);
    for (const row of inventory) {
        const profile = profileFor(row);
        verifyCapabilities(
            profile,
            profile.media === "required" ? mse : unavailable
        );
        scenarioCount += profile.scenarios.length;
        if (row.tier === "required")
            requiredScenarios += profile.scenarios.length;
        if (profile.media === "not-applicable") uiOnly++;
    }
    assert.equal(uiOnly, 3);
    assert.equal(scenarioCount, 166);
    assert.equal(requiredScenarios, 25);
});
test("wrong platform, engine, generation, channel and unknown target are rejected", () => {
    const row = inventory.find(
        (item) => item.id === "windows-2022-webkit-1-64-0"
    );
    for (const patch of [
        { platform: "linux" },
        { engine: "chromium" },
        { playwrightVersion: "1.63.0" },
        { browserVersion: "26.6" },
        { channel: "chrome" },
        { target: "windows-2022-webkit-future" },
    ]) {
        assert.throws(() =>
            selectProfile({ ...runtime(row), ...patch }, "win32")
        );
    }
    assert.throws(() => selectProfile(runtime(row), "linux"));
});
test("a newly available Windows WebKit capability requires an explicit profile upgrade", () => {
    const profile = profileFor(
        inventory.find((item) => item.id === "windows-2022-webkit-1-64-0")
    );
    for (const patch of [
        { mediaSource: true },
        { webkitMediaSource: true },
        { managedMediaSource: true },
        { nativeHls: "maybe" },
        { nativeHls: "probably" },
    ]) {
        assert.throws(() =>
            verifyCapabilities(profile, { ...unavailable, ...patch })
        );
    }
});
test("loss of required MSE or either codec cannot downgrade a full media profile", () => {
    const profile = profileFor(inventory[0]);
    for (const patch of [
        { mediaSource: false },
        { h264Mse: false },
        { aacMse: false },
    ]) {
        assert.throws(() => verifyCapabilities(profile, { ...mse, ...patch }));
    }
    assert.throws(() => verifyCapabilities(profile, unavailable));
    verifyCapabilities(profile, {
        ...mse,
        mediaSource: false,
        webkitMediaSource: true,
    });
    verifyCapabilities(profile, {
        ...mse,
        mediaSource: false,
        managedMediaSource: true,
    });
});

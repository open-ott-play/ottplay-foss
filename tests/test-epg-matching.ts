/**
 * Unit tests for EPG matching and cache functions in src/channels/index.ts
 * Run: node --import=tsx tests/test-epg-matching.ts
 */
import assert from "assert";

// Top-level regex literals for performance
const MORNING_SHOW_REGEX = /Morning Show/;
const WAKE_UP_REGEX = /Wake up/;
const EPG_ENTRY_REGEX = /epg-entry/;
const EPG_TIME_REGEX = /epg-time/;
const MOVIE_REGEX = /Movie/;
const NO_DESCR_REGEX = /epg-descr/;
const HHMM_REGEX = /^\d\d:\d\d$/;

// Build local-time epoch seconds that match whatever timezone the test runs in
function localEpoch(h: number, m: number): number {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return Math.floor(d.getTime() / 1000);
}
const T_10_00 = localEpoch(10, 0);
const T_11_00 = localEpoch(11, 0);

async function getModule() {
    return await import("../src/channels/index.ts");
}

// ---------------------------------------------------------------------------
// Mock environment setup
// ---------------------------------------------------------------------------

const mockWindow: Record<string, any> = {
    _: (s: string) => s,
    chanels: {} as Record<number, any>,
    channels: {} as Record<number, any>,
    confirmBox: null as any,
    curColor: "#fff",
    getEPGchanel: null as any,
    host: "http://localhost",
    infoBox: null as any,
    listArray: [] as any[],
    listChannel: 0,
    playTime: 0,
    playType: 0,
    primaryIndex: 0,
    selIndex: 0,
    setCurProg: null as any,
    stbGetItem: null as any,
    stbSetItem: null as any,
};

// Stub jQuery (used by epgShow_miniproc for spinner)
(global as any).$ = function (selector: string) {
    return {
        hide: () => mockWindow,
        html: () => mockWindow,
        show: () => mockWindow,
    };
};

function applyMocks(ch: Awaited<ReturnType<typeof getModule>>) {
    // The module reads the global `window` at runtime. In Node it is undefined,
    // so install our mock on the global namespace for the duration of the run.
    (global as any).window = mockWindow;
}

function clearMocks() {
    mockWindow.chanels = {};
    mockWindow.channels = mockWindow.chanels; // alias — code reads window.channels
    mockWindow.listChannel = 0;
    mockWindow.primaryIndex = 0;
    mockWindow.selIndex = 0;
    mockWindow.listArray = [];
    mockWindow.playType = 0;
    mockWindow.playTime = 0;
    mockWindow.getEPGchanel = null;
    mockWindow.setCurProg = null;
    mockWindow.stbGetItem = null;
    mockWindow.stbSetItem = null;
    mockWindow.confirmBox = null;
    mockWindow.infoBox = null;
}

// ---------------------------------------------------------------------------
// formatEpgTime tests
// ---------------------------------------------------------------------------

function testFormatEpgTime(ch: Awaited<ReturnType<typeof getModule>>) {
    const { formatEpgTime } = ch;

    // Helper: expected local HH:MM for an epoch timestamp (seconds)
    const expected = (epochSeconds: number) => {
        const d = new Date(epochSeconds * 1000);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${hh}:${mm}`;
    };

    // Unix seconds — must match local-hour rendering of the same epoch
    assert.strictEqual(
        formatEpgTime(1_733_155_200),
        expected(1_733_155_200),
        "formats Unix seconds in local time zone"
    );
    // Unix seconds (midnight)
    assert.strictEqual(
        formatEpgTime(1_733_126_400),
        expected(1_733_126_400),
        "formats Unix seconds at midnight"
    );
    // Unix milliseconds (> 1e12 triggers ms path) — must equal the seconds value
    assert.strictEqual(
        formatEpgTime(1_733_155_200_000),
        formatEpgTime(1_733_155_200),
        "converts ms to seconds"
    );
    // Edge: exactly 1e12 (boundary — treated as seconds)
    assert.strictEqual(
        formatEpgTime(1e12),
        expected(1e12),
        "1e12 treated as seconds"
    );
    // Invalid inputs
    assert.strictEqual(formatEpgTime(Number.NaN), "--:--", "NaN returns --:--");
    // Zero and negative timestamps are valid Dates; just ensure they produce HH:MM format
    assert.match(formatEpgTime(0), HHMM_REGEX, "0 returns HH:MM");
    assert.match(
        formatEpgTime(-1),
        HHMM_REGEX,
        "negative timestamp returns HH:MM"
    );
    assert.strictEqual(
        formatEpgTime(Number.POSITIVE_INFINITY),
        "--:--",
        "Infinity returns --:--"
    );

    console.log("  formatEpgTime: OK");
}

// ---------------------------------------------------------------------------
// getEPGchanelCached / getEPGchanelCurCached / getEpgFromCash tests
// ---------------------------------------------------------------------------

function testEpglCacheLookups(ch: Awaited<ReturnType<typeof getModule>>) {
    const {
        getEPGchanelCached,
        getEPGchanelCurCached,
        getEpgFromCash,
        epg,
        epgCashObj,
    } = ch;

    // Empty cache
    let received: any[] | null = [];
    getEPGchanelCached(999, (_id: number, programs: any[]) => {
        received = programs;
    });
    assert.strictEqual(
        received,
        null,
        "getEPGchanelCached returns null for missing entry"
    );

    assert.strictEqual(
        getEPGchanelCurCached(999),
        null,
        "getEPGchanelCurCached returns null for missing entry"
    );
    assert.strictEqual(
        getEpgFromCash(999),
        null,
        "getEpgFromCash returns null for missing entry"
    );

    // Populate caches
    const sample: any[] = [
        { descr: "News", name: "Evening News", time: 1000, time_to: 1100 },
        { descr: "Comedy", name: "Late Show", time: 1100, time_to: 1200 },
    ];
    epg[42] = sample;
    epgCashObj[42] = sample;

    received = [];
    getEPGchanelCached(42, (_id: number, programs: any[]) => {
        received = programs;
    });
    assert.deepStrictEqual(
        received,
        sample,
        "getEPGchanelCached returns cached array"
    );

    assert.deepStrictEqual(
        getEPGchanelCurCached(42),
        sample,
        "getEPGchanelCurCached returns cached array"
    );
    assert.deepStrictEqual(
        getEpgFromCash(42),
        sample,
        "getEpgFromCash returns cached array"
    );

    // Cleanup - use undefined assignment instead of delete
    epg[42] = undefined;
    epgCashObj[42] = undefined;

    console.log("  EPG cache lookups: OK");
}

// ---------------------------------------------------------------------------
// renderEpgHTML tests
// ---------------------------------------------------------------------------

function testRenderEpgHTML(ch: Awaited<ReturnType<typeof getModule>>) {
    const { renderEpgHTML } = ch;

    assert.strictEqual(
        renderEpgHTML(null as any),
        "",
        "returns empty string for null"
    );
    assert.strictEqual(
        renderEpgHTML([]),
        "",
        "returns empty string for empty array"
    );

    const entries = [
        {
            descr: "Wake up",
            name: "Morning Show",
            time: T_10_00,
            time_to: T_11_00,
        },
        {
            descr: "Headlines",
            name: "News",
            time: T_11_00,
            time_to: T_10_00 + 7200,
        },
    ];
    const html = renderEpgHTML(entries);
    const { formatEpgTime } = ch;
    const expectedStart = formatEpgTime(T_10_00);
    const expectedEnd = formatEpgTime(T_11_00);

    assert.match(html, MORNING_SHOW_REGEX, "contains program name");
    assert.match(
        html,
        new RegExp(expectedStart),
        "contains formatted start time"
    );
    assert.match(html, new RegExp(expectedEnd), "contains formatted end time");
    assert.match(html, WAKE_UP_REGEX, "contains description");
    assert.match(html, EPG_ENTRY_REGEX, "has CSS class");
    assert.match(html, EPG_TIME_REGEX, "has time span class");

    // Entry without description
    const noDescr = [
        { descr: "", name: "Movie", time: 50_000, time_to: 56_000 },
    ];
    const html2 = renderEpgHTML(noDescr);
    assert.match(html2, MOVIE_REGEX, "renders entry without description");
    assert.doesNotMatch(html2, NO_DESCR_REGEX, "omits descr div when empty");

    console.log("  renderEpgHTML: OK");
}

// ---------------------------------------------------------------------------
// setCurProg cache side-effects
// ---------------------------------------------------------------------------

function testSetCurProg(ch: Awaited<ReturnType<typeof getModule>>) {
    const { setCurProg, epg, epgCashObj, channels } = ch;

    const now = Math.floor(Date.now() / 1000);
    const sample: any[] = [
        { descr: "Past", name: "Prog A", time: now - 1800, time_to: now - 600 },
        {
            descr: "On now",
            name: "Current",
            time: now - 300,
            time_to: now + 1800,
        },
        {
            descr: "Next",
            name: "Prog B",
            time: now + 1800,
            time_to: now + 3600,
        },
    ];

    // Set up channel object in the global map
    const channelId = 77;
    mockWindow.chanels[channelId] = {};
    channels[channelId] = { ch_id: channelId } as any;

    setCurProg(channelId, sample);

    assert.deepStrictEqual(
        epg[channelId],
        sample,
        "setCurProg writes to primary epg cache"
    );
    assert.deepStrictEqual(
        epgCashObj[channelId],
        sample,
        "setCurProg writes to secondary epgCashObj cache"
    );

    // Verify channel object was populated with current program (reads from window.channels, setCurProg's write target)
    const chObj = mockWindow.channels[channelId];
    assert.strictEqual(
        chObj.name,
        "Current",
        "channel name set to current program"
    );
    assert.strictEqual(
        chObj.descr,
        "On now",
        "channel descr set to current program"
    );
    assert.strictEqual(
        chObj.time_request,
        0,
        "time_request cleared for current program"
    );
    assert.ok(Array.isArray(chObj.nextpr), "nextpr is an array");
    assert.strictEqual(
        chObj.nextpr.length,
        1,
        "nextpr contains one upcoming program"
    );

    // Cleanup - use undefined assignment instead of delete
    epg[channelId] = undefined;
    epgCashObj[channelId] = undefined;
    mockWindow.chanels[channelId] = undefined;
    mockWindow.channels[channelId] = undefined;
    channels[channelId] = undefined;

    console.log("  setCurProg: OK");
}

// ---------------------------------------------------------------------------
// setCurProg with no current program
// ---------------------------------------------------------------------------

function testSetCurProgNoCurrentProgram(
    ch: Awaited<ReturnType<typeof getModule>>
) {
    const { setCurProg, epg, epgCashObj, channels } = ch;

    const now = Math.floor(Date.now() / 1000);
    // All programs are in the past
    const pastEntries: any[] = [
        {
            descr: "Old show",
            name: "Old",
            time: now - 7200,
            time_to: now - 3600,
        },
    ];

    const channelId = 88;
    mockWindow.chanels[channelId] = {};
    channels[channelId] = { ch_id: channelId } as any;

    setCurProg(channelId, pastEntries);

    const chObj = mockWindow.channels[channelId];
    assert.strictEqual(chObj.name, "", "name cleared when no current program");
    assert.strictEqual(chObj.time, 0, "time cleared");
    assert.strictEqual(chObj.time_to, 0, "time_to cleared");
    assert.strictEqual(chObj.descr, "", "descr cleared");
    assert.ok(
        chObj.time_request > now,
        "time_request set to future when no current program"
    );
    assert.strictEqual(
        chObj.outdated,
        true,
        "outdated flag set when no current program"
    );

    // Cleanup - use undefined assignment instead of delete
    epg[channelId] = undefined;
    epgCashObj[channelId] = undefined;
    mockWindow.chanels[channelId] = undefined;
    mockWindow.channels[channelId] = undefined;
    channels[channelId] = undefined;

    console.log("  setCurProg no-current: OK");
}

// ---------------------------------------------------------------------------
// getCurProgData cache-hit path
// ---------------------------------------------------------------------------

function testGetCurProgDataCacheHit(ch: Awaited<ReturnType<typeof getModule>>) {
    const { getCurProgData, epg, channels } = ch;

    const now = Math.floor(Date.now() / 1000);
    const channelId = 55;

    // Case 1: channel already has time_to (sync hit)
    mockWindow.chanels[channelId] = { time_to: now + 3600 };
    channels[channelId] = { ch_id: channelId } as any;

    let callbackCalled = false;
    const result = getCurProgData(channelId, () => {
        callbackCalled = true;
    });
    assert.strictEqual(
        result,
        true,
        "returns true when channel has valid time_to"
    );
    assert.strictEqual(
        callbackCalled,
        false,
        "callback NOT called on sync hit"
    );

    // Case 2: time_request not expired yet (skip)
    mockWindow.chanels[channelId] = { time_request: now + 3600, time_to: 0 };
    callbackCalled = false;
    const result2 = getCurProgData(channelId, () => {
        callbackCalled = true;
    });
    assert.strictEqual(
        result2,
        false,
        "returns false when time_request not expired"
    );
    assert.strictEqual(
        callbackCalled,
        false,
        "callback NOT called when skipped"
    );

    // Case 3: cache hit with current program (async path)
    mockWindow.chanels[channelId] = { time_request: 0, time_to: 0 };
    epg[channelId] = [
        { descr: "", name: "Prev", time: now - 3600, time_to: now - 1800 },
        {
            descr: "Live",
            name: "Now Showing",
            time: now - 600,
            time_to: now + 600,
        },
    ];
    callbackCalled = false;
    const result3 = getCurProgData(channelId, () => {
        callbackCalled = true;
    });
    assert.strictEqual(
        result3,
        true,
        "returns true on cache hit with current program"
    );
    assert.strictEqual(
        callbackCalled,
        true,
        "callback called on async cache hit"
    );

    // Cleanup - use undefined assignment instead of delete
    epg[channelId] = undefined;
    mockWindow.chanels[channelId] = undefined;
    channels[channelId] = undefined;

    console.log("  getCurProgData cache hit: OK");
}

// ---------------------------------------------------------------------------
// epgTimer persistence (loadEpgTimers filter)
// ---------------------------------------------------------------------------

function testLoadEpgTimersFilter(ch: Awaited<ReturnType<typeof getModule>>) {
    const { loadEpgTimers } = ch;

    const now = Math.floor(Date.now() / 1000);
    const pastTimer = JSON.stringify([
        { c: 0, ci: 1, i: 0, n: "Past Show", t: now - 3600, te: now - 1800 },
    ]);
    const futureTimer = JSON.stringify([
        { c: 0, ci: 2, i: 1, n: "Future Show", t: now + 7200, te: now + 9000 },
    ]);
    const mixedTimer = JSON.stringify([
        { c: 0, ci: 3, i: 2, n: "Past", t: now - 3600, te: now - 1800 },
        { c: 0, ci: 4, i: 3, n: "Future", t: now + 7200, te: now + 9000 },
    ]);

    // Past-only (filtered out — loadEpgTimers clears timers and re-adds future ones)
    mockWindow.stbGetItem = (key: string) => {
        if (key === "epgTimers") {
            return pastTimer;
        }
        return null;
    };
    mockWindow.stbSetItem = () => {
        // no-op
    };
    const prevTimers = ch.epgTimers.length;
    loadEpgTimers();
    // After loadEpgTimers: past filtered out, only future timers remain
    assert.ok(
        ch.epgTimers.every((t) => t.t > now),
        "loadEpgTimers filters out past timers"
    );

    // Future-only (kept)
    mockWindow.stbGetItem = (key: string) => {
        if (key === "epgTimers") {
            return futureTimer;
        }
        return null;
    };
    const prevFuture = ch.epgTimers.length;
    loadEpgTimers();
    assert.ok(ch.epgTimers.length >= 1, "loadEpgTimers keeps future timers");

    // Mixed (only future kept)
    mockWindow.stbGetItem = (key: string) => {
        if (key === "epgTimers") {
            return mixedTimer;
        }
        return null;
    };
    loadEpgTimers();
    assert.ok(
        ch.epgTimers.every((t) => t.t > now),
        "loadEpgTimers filters past, keeps future in mixed data"
    );
    assert.strictEqual(
        ch.epgTimers.findIndex((t) => t.n === "Past"),
        -1,
        "Past timer removed from mixed data"
    );

    // Malformed JSON
    mockWindow.stbGetItem = () => "{ invalid json";
    assert.doesNotThrow(
        () => loadEpgTimers(),
        "loadEpgTimers handles malformed JSON gracefully"
    );

    console.log("  loadEpgTimers filter: OK");
}

// ---------------------------------------------------------------------------
// setEpgTimer add / remove
// ---------------------------------------------------------------------------

function testSetEpgTimerAddRemove(ch: Awaited<ReturnType<typeof getModule>>) {
    const { setEpgTimer, epgTimers } = ch;

    const channelId = 99;
    const programTime = Math.floor(Date.now() / 1000) + 3600;

    mockWindow.listArray = [
        { name: "Test Show", time: programTime, time_to: programTime + 1800 },
    ];
    mockWindow.selIndex = 0;
    mockWindow.listCatIndex = 0;
    mockWindow.listChannel = 0;

    let confirmMsg = "";
    let confirmCb: () => void = () => {
        // no-op default
    };

    mockWindow.confirmBox = (msg: string, cb: () => void) => {
        confirmMsg = msg;
        confirmCb = cb;
    };
    mockWindow.stbSetItem = () => {
        // no-op
    };

    const prevLen = epgTimers.length;

    // Add timer
    setEpgTimer(channelId, programTime);
    assert.strictEqual(
        confirmMsg,
        "Set timer?",
        'confirm message is "Set timer?" for new timer'
    );
    confirmCb(); // Simulate user confirming
    assert.strictEqual(
        epgTimers.length,
        prevLen + 1,
        "timer added to epgTimers array"
    );
    assert.strictEqual(
        epgTimers.at(-1).ci,
        channelId,
        "added timer has correct channel ID"
    );
    assert.strictEqual(
        epgTimers.at(-1).t,
        programTime,
        "added timer has correct program time"
    );

    // Remove timer (same channel + program)
    confirmMsg = "";
    setEpgTimer(channelId, programTime);
    assert.strictEqual(
        confirmMsg,
        "Remove timer?",
        'confirm message is "Remove timer?" for existing timer'
    );
    confirmCb();
    assert.strictEqual(
        epgTimers.length,
        prevLen,
        "timer removed from epgTimers array"
    );

    console.log("  setEpgTimer add/remove: OK");
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

async function runTests() {
    console.log("\nEPG matching tests\n");

    const ch = await getModule();
    applyMocks(ch);

    clearMocks();
    testFormatEpgTime(ch);

    clearMocks();
    testEpglCacheLookups(ch);

    clearMocks();
    testRenderEpgHTML(ch);

    clearMocks();
    testSetCurProg(ch);

    clearMocks();
    testSetCurProgNoCurrentProgram(ch);

    clearMocks();
    testGetCurProgDataCacheHit(ch);

    clearMocks();
    testLoadEpgTimersFilter(ch);

    clearMocks();
    testSetEpgTimerAddRemove(ch);

    console.log("\nAll EPG tests passed!\n");
}

runTests().catch((err) => {
    console.error("\nTest failed:", err);
    process.exit(1);
});

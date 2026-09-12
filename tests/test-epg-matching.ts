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
    mockWindow.epgCash = 10;
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

    // Populate the full cache through a provider response, never via now/next.
    const now = Date.now() / 1000;
    const sample: any[] = [
        {
            descr: "News",
            name: "Evening News",
            time: now - 100,
            time_to: now + 100,
        },
        {
            descr: "Comedy",
            name: "Late Show",
            time: now + 100,
            time_to: now + 200,
        },
    ];
    mockWindow.getEPGchanel = (id: number, done: any) => done(id, sample);
    getEPGchanelCached(42, () => {});
    mockWindow.getEPGchanel = () => {
        throw new Error("unexpected refetch");
    };

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
// setCurProg updates now/next without taking ownership of full schedules
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
        undefined,
        "setCurProg does not write a now/next slice to the full epg cache"
    );
    assert.deepStrictEqual(
        epgCashObj[channelId],
        undefined,
        "setCurProg does not write a now/next slice to the secondary cache"
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

async function testGetCurProgDataCacheHit(
    ch: Awaited<ReturnType<typeof getModule>>
) {
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
    const schedule = [
        { descr: "", name: "Prev", time: now - 3600, time_to: now - 1800 },
        {
            descr: "Live",
            name: "Now Showing",
            time: now - 600,
            time_to: now + 600,
        },
    ];
    mockWindow.getEPGchanel = (id: number, done: any) => done(id, schedule);
    ch.getEPGchanelCached(channelId, () => {});
    callbackCalled = false;
    let finishCallback: (id: number) => void = () => {};
    const callbackResult = new Promise<number>((resolve) => {
        finishCallback = resolve;
    });
    const result3 = getCurProgData(channelId, (id) => {
        callbackCalled = true;
        finishCallback(id);
    });
    assert.strictEqual(
        result3,
        false,
        "returns false on async cache hit (callback fired later)"
    );
    assert.strictEqual(
        callbackCalled,
        false,
        "cache-hit callback is deferred until the request queue runs"
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const completedId = await Promise.race([
            callbackResult,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(new Error("cache-hit callback did not run"));
                }, 1000);
            }),
        ]);
        assert.strictEqual(
            completedId,
            channelId,
            "callback receives the channel ID"
        );
        assert.strictEqual(mockWindow.chanels[channelId].name, "Now Showing");
    } finally {
        clearTimeout(timeout);
    }

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
    mockWindow.epglisted = true;
    mockWindow.epg_ch_id = channelId;

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

/** A real schedule survives rollover, refresh, reload races, and native misses. */
async function testEpgLifecycle(ch: Awaited<ReturnType<typeof getModule>>) {
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    const id = 700;
    const request = () =>
        new Promise<any>((resolve) =>
            ch.getEPGchanelCached(id, (_id, data) => resolve(data))
        );
    const schedule = (title: string) => [
        { name: "history", time: now / 1000 - 200, time_to: now / 1000 - 100 },
        { name: title, time: now / 1000 - 100, time_to: now / 1000 + 100 },
        { name: "next", time: now / 1000 + 100, time_to: now / 1000 + 200 },
        { name: "later", time: now / 1000 + 200, time_to: now / 1000 + 100000 },
    ];
    try {
        ch.invalidateEpgCache();
        mockWindow.chanels = ch.channels;
        mockWindow.channels = ch.channels;
        ch.channels[id] = { ch_id: id, channel_name: "Fixture" };
        let calls = 0;
        mockWindow.getEPGchanel = (channelId: number, done: any) => {
            calls++;
            done(channelId, schedule("current"));
        };
        const full = await request();
        ch.setCurProg(id, full);
        now += 150000;
        await new Promise<void>((resolve) =>
            ch.getCurProgData(id, () => resolve())
        );
        assert.deepStrictEqual(
            await request(),
            full,
            "rollover preserves archive and later programs"
        );
        assert.strictEqual(calls, 1, "a valid complete schedule stays cached");

        now += 12 * 60 * 60 * 1000;
        await request();
        assert.strictEqual(
            calls,
            2,
            "full schedules refresh after the legacy 12-hour TTL"
        );
        mockWindow.epgCash = 0;
        await request();
        await request();
        assert.strictEqual(
            calls,
            4,
            "epgCash=0 bypasses completed-response caching"
        );
        mockWindow.epgCash = 10;

        ch.invalidateEpgCache();
        const pending: Array<(id: number, data: any) => void> = [];
        mockWindow.getEPGchanel = (_id: number, done: any) =>
            pending.push(done);
        let staleCallback = false;
        ch.getEPGchanelCached(id, () => {
            staleCallback = true;
        });
        ch.invalidateEpgCache();
        ch.channels[id] = { ch_id: id, channel_name: "Replacement provider" };
        const first = request();
        const second = request();
        assert.strictEqual(
            pending.length,
            2,
            "concurrent fresh requests share one fetch"
        );
        pending[0](id, schedule("stale provider"));
        assert.strictEqual(
            staleCallback,
            false,
            "late pre-reload responses cannot act on the new provider"
        );
        assert.strictEqual(
            ch.epg[id],
            undefined,
            "late responses cannot repopulate the full cache"
        );
        pending[1](id, schedule("replacement"));
        assert.deepStrictEqual(await first, await second);

        ch.invalidateEpgCache();
        const warmMenu = request();
        ch.invalidateEpgCache(true);
        assert.strictEqual(
            pending.length,
            4,
            "backend warm-up reissues an in-flight menu request"
        );
        pending[2](id, schedule("pre-warm"));
        pending[3](id, schedule("post-warm"));
        assert.strictEqual(
            (await warmMenu)[1].name,
            "post-warm",
            "the waiting menu receives fresh backend data"
        );

        ch.invalidateEpgCache();
        ch.channels[id].epg = "xmltv-channel-id";
        ch.channels[id].epg_url = 123456;
        const nativeArgs: any[] = [];
        mockWindow.p_pref = "m3u";
        mockWindow.Capacitor = {
            Plugins: {
                MobileXmltvEpg: {
                    getEpg: async (args: any) => {
                        nativeArgs.push(args);
                        return nativeArgs.length === 1
                            ? { epg_data: [] }
                            : { epg_data: schedule("native warm") };
                    },
                },
            },
        };
        assert.strictEqual(
            await request(),
            null,
            "empty native cold response is a miss"
        );
        assert.ok(
            await request(),
            "the native warm response can be fetched after an empty miss"
        );
        assert.strictEqual(
            nativeArgs[0].xmltv_url,
            "",
            "companion hash is never used as an XMLTV URL"
        );
        assert.strictEqual(
            nativeArgs[0].hash,
            "xmltv-channel-id",
            "native matching receives tvg-id"
        );
        ch.invalidateEpgCache();
        ch.channels[id].xmltv_url = "https://example.test/guide.xml.gz";
        await request();
        assert.strictEqual(
            nativeArgs[2].xmltv_url,
            "https://example.test/guide.xml.gz"
        );

        const { applyTimezoneSetting } = await import(
            "../src/settings/index.ts"
        );
        const originalSetter = (Date as any).setTimezoneOffset;
        const offsets: number[] = [];
        (Date as any).setTimezoneOffset = (value: number) =>
            offsets.push(value);
        try {
            applyTimezoneSetting(4);
            applyTimezoneSetting(14);
            applyTimezoneSetting(0);
            assert.deepStrictEqual(offsets, [
                -180,
                60,
                new Date().getTimezoneOffset(),
            ]);
        } finally {
            (Date as any).setTimezoneOffset = originalSetter;
        }
    } finally {
        delete mockWindow.Capacitor;
        delete mockWindow.p_pref;
        mockWindow.epgCash = 10;
        Date.now = realNow;
        ch.invalidateEpgCache();
        delete ch.channels[id];
    }
    console.log("  EPG lifecycle, native source contract, timezone: OK");
}

/** Backend warm-up must retain the EPG view's channel and refresh its rows. */
async function testWarmEpgView(ch: Awaited<ReturnType<typeof getModule>>) {
    const id = 701;
    const category = "Warm view fixture";
    const catIdx = ch.catsArray.length;
    const savedDollar = (global as any).$;
    const savedDocument = (global as any).document;
    const savedWindow = { ...mockWindow };
    const savedIdDescriptor = Object.getOwnPropertyDescriptor(
        mockWindow,
        "epg_ch_id"
    );
    const timerCount = ch.epgTimers.length;
    const jq = { hide: () => jq, html: () => jq, show: () => jq };
    const pending: Array<(channelId: number, data: any[]) => void> = [];
    const now = Math.floor(Date.now() / 1000);
    const schedule = (name: string) => [
        { descr: "", name, time: now - 60, time_to: now + 60 },
        { descr: "", name: "Future show", time: now + 60, time_to: now + 3600 },
    ];
    try {
        ch.invalidateEpgCache();
        ch.channels[id] = { ch_id: id, channel_name: category, rec: 24 };
        ch.catsArray.push(category);
        ch.cats[category] = [id];
        (global as any).$ = () => jq;
        (global as any).document = { getElementById: () => null };
        Object.assign(mockWindow, {
            cats: ch.cats,
            catsArray: ch.catsArray,
            chanels: ch.channels,
            channels: ch.channels,
            getEPGchanel: (_id: number, done: any) => pending.push(done),
            getEPGchanelCached: ch.getEPGchanelCached,
            isListVisible: false,
            showPage: () => {
                mockWindow.isListVisible = true;
            },
        });
        // Classic-bundle globals share storage with window; reproduce that alias.
        Object.defineProperty(mockWindow, "epg_ch_id", {
            configurable: true,
            get: () => ch.epg_ch_id,
            set: () => {},
        });
        ch.epgList(catIdx, 0, false);
        ch.invalidateEpgCache(true);
        assert.strictEqual(
            pending.length,
            2,
            "warm-up reissues the menu fetch"
        );
        pending[0](id, schedule("Stale"));
        pending[1](id, schedule("Warm current"));
        assert.strictEqual(
            ch.epg_ch_id,
            id,
            "a refetched menu keeps its archive channel identity"
        );
        assert.strictEqual(mockWindow.listArray[0].name, "Warm current");
        mockWindow.selIndex = 1;
        mockWindow.confirmBox = (_message: string, confirm: () => void) =>
            confirm();
        ch.setEpgTimer();
        assert.strictEqual(
            ch.epgTimers.at(-1)?.ci,
            id,
            "timers retain the channel after warm-up"
        );

        ch.invalidateEpgCache(true);
        assert.strictEqual(
            pending.length,
            3,
            "an already displayed EPG refetches after cache-ready"
        );
        pending[2](id, schedule("Updated current"));
        assert.strictEqual(mockWindow.listArray[0].name, "Updated current");
        assert.strictEqual(ch.epg_ch_id, id);

        ch.epgListAlpha(catIdx, 0, false);
        ch.invalidateEpgCache(true);
        pending[3](id, schedule("Z current"));
        assert.strictEqual(
            ch.epglisted,
            2,
            "warm-up preserves alphabetical mode"
        );
        assert.strictEqual(mockWindow.listArray[0].name, "Future show");
    } finally {
        for (const timer of ch.epgTimers.splice(timerCount)) {
            clearTimeout(timer.ti);
            clearTimeout(timer.ri);
        }
        delete mockWindow.epg_ch_id;
        for (const key of Object.keys(mockWindow)) delete mockWindow[key];
        Object.assign(mockWindow, savedWindow);
        if (savedIdDescriptor)
            Object.defineProperty(mockWindow, "epg_ch_id", savedIdDescriptor);
        (global as any).$ = savedDollar;
        (global as any).document = savedDocument;
        delete ch.channels[id];
        delete ch.cats[category];
        ch.catsArray.splice(catIdx, 1);
        ch.invalidateEpgCache();
    }
    console.log("  Warm EPG view identity, timers and refresh: OK");
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
    await testGetCurProgDataCacheHit(ch);

    clearMocks();
    await testEpgLifecycle(ch);

    clearMocks();
    await testWarmEpgView(ch);

    clearMocks();
    testLoadEpgTimersFilter(ch);

    clearMocks();
    testSetEpgTimerAddRemove(ch);

    console.log("\nAll EPG tests passed!\n");
}

// Reminder tests schedule future timers; release them after each script run.
const originalSetTimeout = globalThis.setTimeout;
const scheduledTimers = new Set<ReturnType<typeof setTimeout>>();
globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSetTimeout(...args);
    scheduledTimers.add(timer);
    return timer;
}) as typeof setTimeout;

runTests()
    .finally(() => {
        for (const timer of scheduledTimers) clearTimeout(timer);
        globalThis.setTimeout = originalSetTimeout;
    })
    .catch((err) => {
        console.error("\nTest failed:", err);
        process.exit(1);
    });

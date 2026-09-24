const assert = require("node:assert/strict");
const fixture = require("./helpers/guide-runtime-fixture.cjs");
let count = 0;
function check(name, run) {
    run();
    count++;
    console.log("PASS guide integration: " + name);
}
check(
    "provider response coalesces and cache values cannot mutate owned schedules",
    () => {
        const f = fixture(),
            h = f.host,
            out = [];
        h.getChannelEpgCached(1, (_id, rows) => out.push(rows));
        h.getChannelEpgCached(1, (_id, rows) => out.push(rows));
        f.tick();
        assert.equal(f.requests.length, 1);
        f.complete([f.row()]);
        assert.equal(out.length, 2);
        out[0][0].name = "bad";
        assert.equal(h.getCachedChannelEpg(1)[0].name, "Programme");
        assert.equal(h.channels[1].name, "Programme");
        h.channels[1].name = "bad";
        assert.equal(h.channels[1].name, "Programme");
        assert.equal(h.epg[1][0].name, "Programme");
    }
);
check(
    "now/next seed does not become a full response cache and preserves next item",
    () => {
        const f = fixture(),
            h = f.host;
        h.setCurProg(1, [f.row(), f.row(f.now() + 100, f.now() + 200, "Next")]);
        assert.equal(h.channels[1].name, "Programme");
        assert.equal(h.channels[1].nextpr[0].name, "Next");
        assert.equal(h.getCachedChannelEpg(1), null);
    }
);
check("current subscribers repaint asynchronously and miss cannot spin", () => {
    const f = fixture(),
        h = f.host;
    let repaint = 0;
    h.getCurProgData(1, () => {
        repaint++;
        h.getCurProgData(1, () => {});
    });
    f.tick();
    f.complete(null);
    assert.equal(repaint, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(h.channels[1].time_request, f.now() + 3600);
});
check("source replacement cancels backend and refuses late schedule", () => {
    const f = fixture(),
        h = f.host;
    let seen = 0;
    h.getChannelEpgCached(1, () => seen++);
    f.tick();
    h.p_pref = "provider-b";
    h.invalidateEpgCache();
    assert.equal(f.requests[0].aborts, 1);
    f.complete([f.row()]);
    assert.equal(seen, 0);
    assert.equal(h.getCachedChannelEpg(1), null);
});
check(
    "warm invalidation preserves pending UI consumer but rejects old response",
    () => {
        const f = fixture(),
            h = f.host;
        h.epgList(0, 0, false);
        f.tick();
        h.invalidateEpgCache(true);
        f.tick();
        f.complete([f.row(undefined, undefined, "Old")], 0);
        assert.equal(h.listArray.length, 0);
        f.complete([f.row(undefined, undefined, "Fresh")], 1);
        assert.equal(h.listArray[0].name, "Fresh");
    }
);
check(
    "replacement guide screen cannot be hijacked by a canceled EPG response",
    () => {
        const f = fixture(),
            h = f.host;
        h.epgList(0, 0, false);
        f.tick();
        h.epgList(0, 1, false);
        f.tick();
        f.complete([f.row(undefined, undefined, "Old")], 0);
        assert.equal(h.listArray.length, 0);
        f.complete([f.row(undefined, undefined, "B")], 1);
        assert.equal(h.epg_ch_id, 2);
        assert.equal(h.listArray[0].name, "B");
    }
);
check("half-open latest-start screen selection has one current row", () => {
    const f = fixture(),
        h = f.host;
    h.epgList(0, 0, false);
    f.tick();
    f.complete([
        f.row(f.now() - 50, f.now() + 100, "Long"),
        f.row(f.now() - 10, f.now() + 10, "Overlap"),
        f.row(f.now() + 10, f.now() + 30, "Next"),
    ]);
    assert.equal(h.listArray[h.selIndex].name, "Overlap");
    assert(h.itemEPG(h.listArray[1], 1).includes("btn red"));
    assert(!h.itemEPG(h.listArray[0], 0).includes("btn red"));
});
check(
    "alphabet and records derive from same model; latest duplicate recording wins",
    () => {
        const f = fixture(),
            h = f.host;
        h.recordsList(0, 0, false);
        f.tick();
        f.complete([
            f.row(f.now() - 100, f.now() - 50, "Same"),
            f.row(f.now() - 40, f.now() - 20, "Same"),
            f.row(f.now() - 20, f.now() + 40, "Current"),
        ]);
        assert.equal(h.listArray.length, 1);
        assert.equal(h.listArray[0].time, f.now() - 40);
        h.epgListAlpha(0, 0, false);
        assert.deepEqual(
            Array.from(h.listArray, (r) => r.name),
            ["Current", "Same", "Same"]
        );
    }
);
check(
    "PIN selection survives category reorder through stable channel identity",
    () => {
        const f = fixture({ pin: true }),
            h = f.host;
        h.epgList(1, 0, false);
        f.tick();
        f.complete([f.row(f.now() - 100, f.now() - 20)]);
        h.selectEpg();
        h.cats.Group = [2, 1];
        f.prompts[0].yes();
        assert.deepEqual(
            f.calls.filter((x) => x[0] === "select"),
            [["select", 1, true]]
        );
        assert.deepEqual(
            f.calls.filter((x) => x[0] === "archive"),
            [["archive", f.now() - 100]]
        );
    }
);
check(
    "PIN source replacement, row change and archive expiry revoke play",
    () => {
        for (const mutate of [
            (h) => {
                h.p_pref = "provider-b";
            },
            (h) => {
                h.selIndex = 1;
            },
            (h, f) => {
                f.tick(f.now() + 49 * 3600);
            },
        ]) {
            const f = fixture({ pin: true }),
                h = f.host;
            h.epgList(0, 0, false);
            f.tick();
            f.complete([
                f.row(f.now() - 100, f.now() - 20),
                f.row(f.now() - 20, f.now() - 10, "Second"),
            ]);
            h.selIndex = 0;
            h.selectEpg();
            mutate(h, f);
            f.prompts[0].yes();
            assert.equal(f.calls.filter((x) => x[0] === "archive").length, 0);
        }
    }
);
check(
    "reminder record has stable IDs and no category offsets or runtime handles",
    () => {
        const f = fixture(),
            h = f.host;
        h.epgList(0, 0, false);
        f.tick();
        f.complete([
            f.row(f.now() + 120, f.now() + 240, "Future", "broadcast:7"),
        ]);
        h.setEpgTimer();
        f.prompts[0].yes();
        assert.equal(h.epgTimers.length, 1);
        const key = [...f.saved.keys()].find((x) =>
            x.includes("guideReminders:")
        );
        const record = JSON.parse(f.saved.get(key)).records[0];
        assert.equal(record.channelId, "station:a");
        assert.equal(record.id, record.programmeId);
        for (const field of ["ci", "c", "i", "ti", "ri"])
            assert.equal(record[field], undefined);
    }
);
check(
    "reminder confirmation and PIN re-resolve channel after category reorder",
    () => {
        const f = fixture({ pin: true }),
            h = f.host;
        h.startEpgTimer({
            ci: 1,
            n: "Future",
            t: f.now() + 120,
            te: f.now() + 240,
        });
        f.tick(f.now() + 120);
        const prompt = f.prompts[0];
        prompt.yes();
        assert.equal(f.prompts[1].pin, true);
        h.cats.All = [2, 1];
        h.cats.Group = [];
        f.prompts[1].yes();
        assert.deepEqual(
            f.calls.filter((x) => x[0] === "play"),
            [["play", 1]]
        );
    }
);
check("reminder removal and source replacement revoke visible prompt", () => {
    for (const remove of [false, true]) {
        const f = fixture(),
            h = f.host;
        h.startEpgTimer({
            ci: 1,
            n: "Future",
            t: f.now() + 10,
            te: f.now() + 200,
        });
        f.tick(f.now() + 10);
        const prompt = f.prompts[0];
        if (remove) h.__ottClassicReminders.dispose();
        else {
            h.p_pref = "provider-b";
            h.invalidateEpgCache();
        }
        prompt.yes();
        assert.equal(f.calls.filter((x) => x[0] === "play").length, 0);
        assert.equal(h.dialogBoxKeyHandler, null);
    }
});
check(
    "legacy saved handles are never canceled and missing reminders are retained",
    () => {
        const f = fixture({
                saved: {
                    "provider-a:epgTimers": JSON.stringify([
                        {
                            ci: 99,
                            n: "Missing",
                            ri: 2,
                            t: 10100,
                            te: 10200,
                            ti: 1,
                        },
                        { ci: 1, n: "Present", t: 10300, te: 10400 },
                    ]),
                },
            }),
            h = f.host;
        h.loadEpgTimers();
        assert.equal(h.epgTimers.length, 2);
        assert.equal(h.epgTimers[0].ci, null);
        h.channels[99] = { channel_name: "Back", rec: 48 };
        h.cats.All.push(99);
        h.loadEpgTimers();
        f.tick(10100);
        assert.equal(f.prompts.length, 1);
    }
);
check(
    "warm refresh does not redirect timer toggle into newly selected channel",
    () => {
        const f = fixture(),
            h = f.host;
        h.epgList(0, 0, false);
        f.tick();
        f.complete([f.row(f.now() + 100, f.now() + 200)]);
        h.setEpgTimer();
        const prompt = f.prompts[0];
        h.epgList(0, 1, false);
        f.tick();
        f.complete([f.row(f.now() + 100, f.now() + 200, "B")]);
        prompt.yes();
        assert.equal(h.epgTimers.length, 0);
    }
);
check(
    "legacy import claims its account before use and cannot follow account switch",
    () => {
        const f = fixture({
                saved: {
                    "provider-a:epgTimers": JSON.stringify([
                        { ci: 1, n: "Old", t: 10100, te: 10200 },
                    ]),
                },
            }),
            h = f.host;
        h.sourceId = "account-a";
        h.__ottSourceIdentity = { current: () => h.sourceId };
        h.loadEpgTimers();
        assert.equal(h.epgTimers.length, 1);
        assert.equal(
            f.saved.get("provider-a:guideReminderSource"),
            "account-a"
        );
        h.sourceId = "account-b";
        h.loadEpgTimers();
        assert.equal(h.epgTimers.length, 0);
        f.tick(10100);
        assert.equal(f.prompts.length, 0);
    }
);
check(
    "legacy claim write rejection/readback mismatch/reentrant replacement cannot schedule",
    () => {
        for (const mode of ["throw", "ignore", "reenter"]) {
            const f = fixture({
                    saved: {
                        "provider-a:epgTimers": JSON.stringify([
                            { ci: 1, n: "Old", t: 10100, te: 10200 },
                        ]),
                    },
                }),
                h = f.host;
            h.sourceId = "account-a";
            h.__ottSourceIdentity = { current: () => h.sourceId };
            h.providerSetItem = () => {
                if (mode === "throw") throw Error("blocked");
                if (mode === "reenter") {
                    h.sourceId = "account-b";
                    h.providerGetItem = () => null;
                    h.loadEpgTimers();
                }
            };
            h.loadEpgTimers();
            assert.equal(h.epgTimers.length, 0);
            f.tick(10100);
            assert.equal(f.prompts.length, 0);
        }
    }
);
check(
    "legacy hash resolves a unique stable channel alias and does not duplicate provider programme ID",
    () => {
        const f = fixture({
                saved: {
                    "provider-a:epgTimers": JSON.stringify([
                        { ci: 99, n: "Old", t: 10100, te: 10200 },
                    ]),
                },
            }),
            h = f.host;
        h.channels[1].legacyChannelId = 99;
        h.loadEpgTimers();
        assert.equal(h.epgTimers[0].ci, 1);
        h.epgList(0, 0, false);
        f.tick();
        f.complete([f.row(10100, 10200, "Updated", "provider-programme")]);
        h.setEpgTimer();
        assert.equal(f.prompts[0].text, "Remove timer?");
        f.prompts[0].yes();
        assert.equal(h.epgTimers.length, 0);
    }
);
check(
    "ambiguous legacy hashes remain unresolved instead of choosing another channel",
    () => {
        const f = fixture({
                saved: {
                    "provider-a:epgTimers": JSON.stringify([
                        { ci: 99, n: "Old", t: 10100, te: 10200 },
                    ]),
                },
            }),
            h = f.host;
        h.channels[1].legacyChannelId = h.channels[2].legacyChannelId = 99;
        h.loadEpgTimers();
        assert.equal(h.epgTimers[0].ci, null);
        f.tick(10100);
        assert.equal(f.prompts.length, 0);
    }
);
check(
    "guide request is canceled by list disposal and publication binds replacement owner",
    () => {
        const f = fixture(),
            h = f.host;
        let cleanup = null;
        h.__ottClassicScreenPort = {
            onDispose(fn) {
                cleanup = fn;
                let active = true;
                return () => {
                    if (active) {
                        active = false;
                        if (cleanup === fn) cleanup = null;
                        fn();
                    }
                };
            },
        };
        h.epgList(0, 0, false);
        f.tick();
        cleanup();
        f.complete([f.row()]);
        assert.equal(h.listArray.length, 0);
        h.showPage = () => {
            if (cleanup) cleanup();
        };
        h.epgList(0, 1, false);
        f.tick();
        f.complete([f.row()]);
        assert.equal(h.epg_ch_id, 2);
        assert(h.__ottClassicGuideScreen.current());
        cleanup();
        assert.equal(h.__ottClassicGuideScreen.current(), null);
    }
);
check(
    "global legacy backup can be claimed by only one provider namespace",
    () => {
        const f = fixture({
                saved: {
                    epgTimers: JSON.stringify([
                        { ci: 1, n: "Global", t: 10100, te: 10200 },
                    ]),
                },
            }),
            h = f.host;
        h.loadEpgTimers();
        assert.equal(h.epgTimers.length, 1);
        assert(f.saved.get("guideReminderSource"));
        h.p_pref = "provider-b";
        h.loadEpgTimers();
        assert.equal(h.epgTimers.length, 0);
        f.tick(10100);
        assert.equal(f.prompts.length, 0);
    }
);
check("projection scalar getters do not serialize programme payloads", () => {
    const f = fixture(),
        h = f.host;
    h.setCurProg(1, [f.row(), f.row(f.now() + 100, f.now() + 200, "Next")]);
    h.serializationCount = 0;
    require("node:vm").runInContext(
        "var savedStringify=JSON.stringify; JSON.stringify=function(value){serializationCount++;return savedStringify(value);};",
        h
    );
    for (let i = 0; i < 100; i++) {
        assert.equal(h.channels[1].name, "Programme");
        assert(h.channels[1].time_to > 0);
        assert.equal(h.channels[1].descr, "Description");
    }
    assert.equal(h.serializationCount, 0);
    const next = h.channels[1].nextpr;
    next[0].name = "corrupt";
    assert.equal(h.channels[1].nextpr[0].name, "Next");
});
check(
    "string provider transport IDs seed owned programmes without a mutable cache copy",
    () => {
        const f = fixture(),
            h = f.host;
        h.channels = { one: { channel_name: "One", rec: 24 } };
        h.cList = h.curList = ["one"];
        h.cats.All = ["one"];
        h.epgCacheCapacity = 0;
        h.__ottClassicGuide.seed("one", [f.row()]);
        assert.equal(h.channels.one.name, "Programme");
        assert.equal(
            h.getCurProgData("one", () => {}),
            true
        );
        assert.equal(h.getCachedChannelEpg("one"), null);
        f.tick();
        assert.equal(f.requests.length, 0);
        h.getChannelEpgCached("one", () => {});
        f.tick();
        assert.equal(f.requests[0].id, "one");
    }
);
check(
    "retimed reminder revokes a parental continuation even when programme ID is unchanged",
    () => {
        const f = fixture({ pin: true }),
            h = f.host;
        const record = {
            ci: 1,
            n: "Programme",
            t: f.now() + 10,
            te: f.now() + 200,
        };
        h.startEpgTimer(record);
        f.tick(f.now() + 10);
        f.prompts[0].yes();
        assert.equal(f.prompts[1].pin, true);
        h.startEpgTimer({ ...record, te: record.te + 10 });
        f.prompts[1].yes();
        assert.equal(f.calls.filter((x) => x[0] === "play").length, 0);
    }
);
check(
    "abort reentry keeps a newer guide view instead of replacing it with the outer open",
    () => {
        const f = fixture(),
            h = f.host;
        h.epgList(0, 0, false);
        f.tick();
        f.requests[0].onCancel = () => h.epgList(0, 1, false);
        h.epgList(1, 0, false);
        f.tick();
        const latest = f.requests.at(-1);
        assert.equal(latest.id, 2);
        f.complete([f.row(undefined, undefined, "Newer")]);
        assert.equal(h.epg_ch_id, 2);
        assert.equal(h.listArray[0].name, "Newer");
    }
);
check(
    "switching sort modes and refreshing preserves selected programme identity",
    () => {
        const f = fixture(),
            h = f.host;
        h.epgList(0, 0, false);
        f.tick();
        f.complete([
            f.row(f.now() - 10, f.now() + 40, "Zulu"),
            f.row(f.now() + 40, f.now() + 100, "Alpha"),
        ]);
        h.selIndex = 1;
        const id = h.listArray[1].programmeId;
        h.epgListAlpha(0, 0, false);
        assert.equal(h.listArray[h.selIndex].programmeId, id);
        h.epgList(0, 0, false);
        assert.equal(h.selIndex, 1);
        h.invalidateEpgCache(true);
        f.tick();
        f.complete([
            f.row(f.now() - 10, f.now() + 40, "Zulu"),
            f.row(f.now() + 40, f.now() + 100, "Edited Alpha"),
        ]);
        assert.equal(h.listArray[h.selIndex].programmeId, id);
    }
);

console.log("PASS " + count + " guide integration scenarios");

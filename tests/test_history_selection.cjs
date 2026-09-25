const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const sharedCore = require("./helpers/shared-core-runtime.cjs");
const root = path.resolve(__dirname, "..");

function include(context, file, names) {
    const ast = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const declarations = ast.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    );
    assert.equal(
        declarations.length,
        names.length,
        "Use actual implementation declarations"
    );
    const code = ts
        .transpileModule(
            declarations.map((node) => node.getText(ast)).join("\n"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.ES2015,
                    target: ts.ScriptTarget.ES5,
                },
            }
        )
        .outputText.replace(/^export /gm, "");
    vm.runInContext(code, context, { filename: file });
}

function fixture() {
    const effects = [],
        requests = [],
        prompts = [],
        storage = {};
    const c = {
        _: (value) => value,
        catIndex: 0,
        cats: { All: [101, 202, 303], Group: [202] },
        catsArray: ["All", "Group"],
        channels: { 101: { rec: 24 }, 202: { rec: 48 }, 303: { rec: 24 } },
        clearTimeout() {},
        console,
        curList: [101, 202, 303],
        Date: class extends Date {
            static now() {
                return 1000000000;
            }
        },
        enterPinAndSetAccess: (callback) => {
            prompts.push(callback);
        },
        getChannelEpgCached: (id, callback) => {
            requests.push({ callback, id });
        },
        medHistory: [],
        p_pref: "source-a",
        parentAccess: false,
        parentalArray: [],
        parentPIN: "2468",
        playArchive: (epoch) => {
            effects.push(["archive", epoch]);
            c.playType = epoch;
            c.__ottClassicPlayback.cancel();
        },
        playChannel: (category, index) => {
            effects.push(["live", category, index]);
            c.setCurrent(category, index);
        },
        playTime: 0,
        playType: 0,
        prevArr: [{ c: 1, ci: 202, i: 0, t: 990000 }],
        primaryIndex: 0,
        providerGetItem: (key) => storage[key],
        providerSetItem: (key, value) => {
            storage[key] = value;
        },
        setCurProg: (id, data) => effects.push(["programme", id, data]),
        setTimeout: () => 1,
        settings: { prevCount: 4, psChannels: true },
        sFavorites: 0,
        stbGetLen: () => 0,
        stbGetPosTime: () => 0,
    };
    c.window = c;
    vm.createContext(c);
    require("./helpers/english-source-fixture.cjs").attachSourceAliases(c);
    sharedCore(c);
    include(c, "src/channels/index.ts", [
        "setCurrent",
        "ifParentalAccess",
        "ifParentalAccessChId",
        "hasParentalLock",
    ]);
    include(c, "src/keyhandler/index.ts", ["onPrevSelect"]);
    c.effects = effects;
    c.requests = requests;
    c.prompts = prompts;
    c.complete = (
        index = 0,
        data = [{ time: 999100 }, { time: 900000 }, { time: 999000 }]
    ) => requests[index].callback(requests[index].id, data);
    c.grant = (index = 0) => {
        c.parentAccess = true;
        prompts[index]();
    };
    return c;
}

// Actual history selection uses the stable ID after a category moves/disappears.
{
    const c = fixture();
    c.prevArr[0].c = 99;
    c.onPrevSelect(0);
    assert.equal(c.catIndex, 0);
    assert.equal(c.primaryIndex, 1);
    assert.equal(c.requests[0].id, 202);
    c.complete();
    assert.deepEqual(
        c.effects.filter((row) => row[0] === "archive"),
        [["archive", 990000]]
    );
    assert.deepEqual(
        Array.from(c.epgArray, (item) => item.time),
        [900000, 999000, 999100]
    );
    c.complete();
    assert.equal(
        c.effects.filter((row) => row[0] === "archive").length,
        1,
        "EPG completion is one-shot"
    );
}
{
    const c = fixture();
    c.catsArray = ["Current", "Moved"];
    c.cats = { Current: [101], Moved: [202] };
    c.prevArr[0].c = 19;
    c.onPrevSelect(0);
    assert.equal(c.catIndex, 1);
    assert.equal(c.primaryIndex, 0);
    c.complete();
    assert.equal(c.effects.at(-1)[0], "archive");
}

// Missing lists, missing channels and invalid persisted entries produce no effects.
for (const mutate of [
    (c) => {
        c.cats = {};
    },
    (c) => {
        c.catsArray = null;
    },
    (c) => {
        delete c.channels[202];
    },
    (c) => {
        c.prevArr = {};
    },
    (c) => {
        c.prevArr[0].t = "bad";
    },
    (c) => {
        c.prevArr[0].ci = null;
    },
]) {
    const c = fixture();
    mutate(c);
    assert.doesNotThrow(() => c.onPrevSelect(0));
    assert.equal(c.requests.length, 0);
    assert.equal(c.effects.length, 0);
}

// A valid journal entry can restore playback when the current selection is absent.
for (const archive of [false, true]) {
    for (const missing of ["out-of-range", "unset"]) {
        const c = fixture();
        if (missing === "out-of-range") c.primaryIndex = 99;
        else delete c.primaryIndex;
        if (!archive) delete c.prevArr[0].t;
        c.onPrevSelect(0);
        assert.equal(c.catIndex, 1);
        assert.equal(c.primaryIndex, 0);
        if (archive) {
            assert.equal(c.requests.length, 1);
            assert.equal(c.requests[0].id, 202);
            c.complete();
            assert.deepEqual(
                c.effects.filter((row) => row[0] === "archive"),
                [["archive", 990000]]
            );
        } else {
            assert.deepEqual(c.effects, [["live", 1, 0]]);
            assert.equal(c.requests.length, 0);
        }
    }
}

// Null current targets still carry provider ownership while a PIN decision is pending.
for (const archive of [false, true]) {
    const c = fixture();
    c.primaryIndex = 99;
    c.p_pref = "";
    c.providerId = "provider-a";
    c.parentalArray = [202];
    if (!archive) delete c.prevArr[0].t;
    c.onPrevSelect(0);
    assert.equal(c.prompts.length, 1);
    c.providerId = "provider-b";
    c.grant();
    assert.equal(
        c.requests.length,
        0,
        "A stale PIN callback cannot load EPG for the replacement provider"
    );
    assert.equal(
        c.effects.length,
        0,
        "A stale PIN callback cannot start playback for the replacement provider"
    );
    assert.equal(c.primaryIndex, 99);
}

// Stop, a different selection and provider/resource replacement revoke pending EPG work.
for (const mutate of [
    (c) => c.__ottClassicPlayback.cancel(),
    (c) => c.setCurrent(0, 2),
    (c) => {
        c.p_pref = "source-b";
    },
    (c) => {
        c.channels = { ...c.channels };
    },
    (c) => {
        c.channels[202] = { rec: 48 };
    },
    (c) => {
        c.cats.Group = [202];
    },
    (c) => {
        c.providerSetItem = () => {};
    },
]) {
    const c = fixture();
    c.onPrevSelect(0);
    mutate(c);
    c.complete();
    assert.equal(
        c.effects.length,
        0,
        "A stale EPG result must not reopen archive or update programme state"
    );
}

// A new history request wins even if it targets the same channel and timestamp.
{
    const c = fixture();
    c.onPrevSelect(0);
    c.prevArr = [{ c: 1, ci: 202, i: 0, t: 990000 }];
    c.onPrevSelect(0);
    c.complete(0);
    assert.equal(c.effects.length, 0);
    c.complete(1);
    assert.equal(c.effects.filter((row) => row[0] === "archive").length, 1);
}

// The selected entry is bound before PIN; a changing journal cannot redirect authorization.
{
    const c = fixture();
    c.parentalArray = [202];
    c.onPrevSelect(0);
    assert.equal(c.prompts.length, 1);
    assert.equal(c.requests.length, 0);
    assert.equal(c.primaryIndex, 0);
    c.prevArr[0].ci = 303;
    c.prevArr[0].t = 980000;
    c.prevArr = [{ c: 0, ci: 303, t: 970000 }];
    c.grant();
    assert.equal(c.requests[0].id, 202);
    c.complete();
    assert.deepEqual(
        c.effects.filter((row) => row[0] === "archive"),
        [["archive", 990000]]
    );
}
for (const mutate of [
    (c) => c.__ottClassicPlayback.cancel(),
    (c) => c.setCurrent(0, 2),
    (c) => {
        c.p_pref = "source-b";
    },
    (c) => {
        c.channels[202] = { rec: 48 };
    },
]) {
    const c = fixture();
    c.parentalArray = [202];
    c.onPrevSelect(0);
    mutate(c);
    c.grant();
    assert.equal(c.requests.length, 0);
    assert.equal(c.effects.length, 0);
}

// Authorization expiring during the fetch is rechecked before any archive effect.
{
    const c = fixture();
    c.parentalArray = [202];
    c.parentAccess = true;
    c.onPrevSelect(0);
    c.parentAccess = false;
    c.complete();
    assert.equal(c.prompts.length, 1);
    assert.equal(c.effects.length, 0);
    c.grant();
    assert.deepEqual(
        c.effects.filter((row) => row[0] === "archive"),
        [["archive", 990000]]
    );
}

// Live history selection uses the same bound PIN decision before playChannel.
{
    const c = fixture();
    delete c.prevArr[0].t;
    c.parentalArray = [202];
    c.onPrevSelect(0);
    assert.equal(c.effects.length, 0);
    assert.equal(c.prompts.length, 1);
    c.prevArr = [{ c: 0, ci: 303 }];
    c.grant();
    assert.deepEqual(c.effects, [["live", 1, 0]]);
    assert.equal(c.requests.length, 0);
}

// In-place reordering while PIN is open changes position, not the selected identity.
{
    const c = fixture();
    delete c.prevArr[0].t;
    c.parentalArray = [202];
    c.onPrevSelect(0);
    c.cats.Group.unshift(303);
    c.grant();
    assert.deepEqual(c.effects, [["live", 1, 1]]);
}

console.log(
    "PASS history selection: stable identity, scoped EPG/PIN callbacks and parental access"
);

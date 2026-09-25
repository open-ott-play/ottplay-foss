const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const modules = {
    "access/classic-adapter": "__ottParental",
    "access/session": "__ottAccessSession",
    "channels/classic-library": "__ottChannels",
    "channels/classic-search": "__ottChannelSearch",
    "channels/library": "__ottChannelLibrary",
    "provider/source-identity": "__ottSourceIdentity",
    "ui/classic-screen-port": "__ottClassicScreenPort",
    "ui/input-router": "__ottInputRouter",
    "ui/screen-controller": "__ottScreenController",
};
const wrappers = [
    "searchChannel",
    "hasParentalLock",
    "ifParentalAccess",
    "ifParentalAccessChId",
    "enterPinAndSetAccess",
    "saveListPanelState",
    "restoreListPanelState",
];
const assignments = ["addChannel2bucket"];
function compile(text) {
    const code = ts.transpileModule(text.replace(/^export /gm, ""), {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    return code;
}
function walk(node, visit) {
    if (!node || typeof node !== "object") return;
    if (node.type) visit(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
        else if (value && typeof value === "object") walk(value, visit);
    }
}
function property(node) {
    return node.computed ? node.property.value : node.property.name;
}
function sourceRuntime() {
    const order = require("../scripts/classic-bundle.cjs")
        .CLASSIC_MODULES.map((file) =>
            file.replace(/^build\//, "").replace(/\.js$/, "")
        )
        .filter((file) => Object.hasOwn(modules, file));
    assert.equal(order.length, Object.keys(modules).length);
    const code = order.map(
        (file) =>
            "(function(){" +
            compile(
                fs.readFileSync(path.join(root, "src/" + file + ".ts"), "utf8")
            ) +
            "}).call(this);"
    );
    let extracted = 0;
    for (const file of ["channels/index", "ui/index", "index"]) {
        const text = fs.readFileSync(
            path.join(root, "src/" + file + ".ts"),
            "utf8"
        );
        const ast = ts.createSourceFile(
            file + ".ts",
            text,
            ts.ScriptTarget.Latest,
            true
        );
        const functions = ast.statements.filter((node) => {
            if (ts.isFunctionDeclaration(node))
                return wrappers.includes(node.name?.text);
            if (
                !ts.isExpressionStatement(node) ||
                !ts.isBinaryExpression(node.expression)
            )
                return false;
            return assignments.some(
                (name) => node.expression.left.getText(ast) === "window." + name
            );
        });
        extracted += functions.length;
        code.push(
            compile(functions.map((node) => node.getText(ast)).join("\n"))
        );
    }
    assert.equal(extracted, wrappers.length + assignments.length);
    return code.join("\n");
}
function bundleRuntime(file) {
    // Extract complete shipped private scopes, never source replacements.
    // Preserve their artifact order and the real public ABI wrappers.
    const text = fs.readFileSync(path.resolve(root, file), "utf8");
    const ast = acorn.parse(text, { ecmaVersion: 5 });
    const wanted = new Set(Object.values(modules));
    // The classic linker lowers English declaration names but publishes the
    // public API via real window assignments. Resolve those emitted bindings,
    // retaining both the actual declaration and its actual export statement.
    const names = Object.fromEntries(wrappers.map((name) => [name, name]));
    const aliases = [];
    walk(ast, (node) => {
        if (
            node.type === "AssignmentExpression" &&
            node.left.type === "MemberExpression" &&
            node.left.object.type === "Identifier" &&
            node.left.object.name === "window" &&
            wrappers.includes(property(node.left)) &&
            node.right.type === "Identifier" &&
            property(node.left) !== node.right.name
        ) {
            const name = property(node.left);
            assert.equal(
                names[name],
                name,
                file + ": unique public ABI binding " + name
            );
            names[name] = node.right.name;
            aliases.push(node);
        }
    });
    const declarations = Object.values(names);
    const scopes = [],
        found = new Set(),
        functions = [],
        assigned = [];
    walk(ast, (node) => {
        if (
            node.type === "FunctionDeclaration" &&
            declarations.includes(node.id?.name)
        )
            functions.push(node);
        if (
            node.type === "AssignmentExpression" &&
            node.left.type === "MemberExpression" &&
            node.left.object.type === "Identifier" &&
            node.left.object.name === "window" &&
            assignments.includes(property(node.left))
        )
            assigned.push(node);
        if (
            node.type !== "CallExpression" ||
            node.callee.type !== "MemberExpression" ||
            property(node.callee) !== "call" ||
            node.callee.object.type !== "FunctionExpression"
        )
            return;
        const published = new Set();
        walk(node.callee.object.body, (child) => {
            const left = child.type === "AssignmentExpression" && child.left;
            if (
                left &&
                left.type === "MemberExpression" &&
                left.object.type === "Identifier" &&
                left.object.name === "window" &&
                wanted.has(property(left))
            )
                published.add(property(left));
        });
        if (!published.size) return;
        for (const name of published) {
            assert(
                !found.has(name),
                file + ": duplicate private boundary " + name
            );
            found.add(name);
        }
        scopes.push(node);
    });
    assert.deepEqual(
        [...found].sort(),
        [...wanted].sort(),
        file + ": all real private scopes"
    );
    assert.deepEqual(
        functions.map((node) => node.id.name).sort(),
        declarations.slice().sort()
    );
    assert.deepEqual(
        assigned.map((node) => property(node.left)).sort(),
        assignments.slice().sort()
    );
    return scopes
        .concat(functions, assigned, aliases)
        .sort((a, b) => a.start - b.start)
        .map((node) => text.slice(node.start, node.end) + ";")
        .join("\n");
}
function fixture(code) {
    const timers = new Map(),
        allTimers = [],
        events = [],
        saved = new Map(),
        elements = {};
    let timerId = 0;
    let credentials = {
        server: "https://provider.invalid",
        username: "account-a",
    };
    const hooks = {};
    function effect(name, ...args) {
        events.push([name, ...args]);
        if (hooks[name]) {
            const callback = hooks[name];
            delete hooks[name];
            callback();
        }
    }
    function element(id) {
        if (!elements[id])
            elements[id] = {
                firstChild: {},
                innerHTML: "",
                style: {},
                textContent: "",
                value: "",
            };
        return elements[id];
    }
    const host = {
        _: (text) => text,
        __ottActiveProviderDriver: {
            credentials: () => credentials,
            id: "fixture",
        },
        addToFavorites(id) {
            effect("favorite", id);
        },
        catIndex: 0,
        channels: {
            11: {
                category: { name: "News" },
                channel_name: "News One",
                groupId: "provider:news",
                itemId: "station:one",
                name: "Programme one",
            },
            22: {
                category: { name: "News" },
                channel_name: "News Two",
                groupId: "provider:news",
                itemId: "station:two",
                name: "Programme two",
            },
            33: {
                category: { name: "Sport" },
                channel_name: "Sport",
                groupId: "provider:sport",
                itemId: "station:sport",
                name: "Programme sport",
            },
        },
        cList: [11, 22, 33],
        clearTimeout(id) {
            timers.delete(id);
        },
        console,
        document: { getElementById: element },
        favoritesArray: [],
        keys: {
            DOWN: 40,
            ENTER: 13,
            EXIT: 27,
            FF: 70,
            GREEN: 71,
            INFO: 73,
            LEFT: 37,
            NEXT: 78,
            PAUSE: 80,
            PLAY: 81,
            PREV: 82,
            RETURN: 8,
            RIGHT: 39,
            RW: 83,
            TOOLS: 84,
            UP: 38,
            YELLOW: 89,
            ...Object.fromEntries(
                Array.from({ length: 10 }, (_, d) => ["N" + d, 100 + d])
            ),
        },
        listCaptionElement: element("listCaption"),
        listCatIndex: 1,
        listChannel: 0,
        listDetailElement: element("listDetail"),
        listFooterElement: element("listPodval"),
        // Emitted legacy DOM ABI used by saveCPD/restoreCPD.
        listPodvalElement: element("listPodval"),
        p_pref: "fixture",
        parentalArray: [],
        parentPIN: "2468",
        playType: 0,
        primaryIndex: 2,
        providerGetItem(key) {
            return saved.get("provider:" + key) ?? null;
        },
        providerSetItem(key, value) {
            saved.set("provider:" + key, value);
        },
        renderButtonHint: () => "",
        sArrowFun: 2,
        saveChannelsCats() {
            effect("save-cats");
        },
        setTimeout(fn, delay) {
            const timer = { delay: delay || 0, fn, id: ++timerId };
            timers.set(timer.id, timer);
            allTimers.push(timer);
            return timer.id;
        },
        sFavorites: 0,
        showChannelInfo(value) {
            effect("info", value);
        },
        showProgramInfo(value) {
            effect("programme", value);
        },
        showShift(value) {
            effect("notice", value);
        },
        sInfoSwitch: 1,
        sPNFun: 1,
        sPreview: 0,
        sPSchannels: 1,
        sRewFun: 1,
        stbGetItem(key) {
            effect("read", key);
            return saved.get(key) || "";
        },
        stbSetItem(key, value) {
            saved.set(key, value);
            effect("write", key, value);
        },
        updateChannelInfo(id) {
            effect("update", id);
        },
    };
    host.$ = (selector) => {
        const node = element(selector.slice(1));
        const chain = {
            hide() {
                node.visible = false;
                return chain;
            },
            html(value) {
                node.innerHTML = value;
                return chain;
            },
            is() {
                return !!node.visible;
            },
            length: 1,
            show() {
                node.visible = true;
                return chain;
            },
        };
        return chain;
    };
    host.window = host;
    vm.createContext(host);
    vm.runInContext(code, host);
    const port = host.__ottClassicScreenPort;
    host.showPage = () => {
        port.commitList();
        effect("render", Array.from(host.listArray));
    };
    host.closeList = () => {
        port.closeList();
        effect("close");
    };
    host.showEditKey = () => {
        port.openEditor();
        effect("editor");
    };
    host.setCurrent = (category, index) => {
        host.catIndex = category;
        host.primaryIndex = index;
        host.curList = host.cats[host.catsArray[category]];
        effect("current", host.curList[index]);
    };
    host.playChannel = (category, index) => {
        const id = host.cats[host.catsArray[category]]?.[index];
        effect("play-request", id);
        if (
            host.ifParentalAccessChId(id, () =>
                host.playChannel(category, index)
            )
        )
            return;
        effect("play", id);
    };
    host.previewChId = (id) => {
        host.previewChan = { ch_id: id };
        effect("preview", id);
    };
    function mount() {
        host.__ottChannels.mount(host);
    }
    function showChannels(groupId = "provider:news", index = 0) {
        const category = host.__ottChannels.index(groupId);
        host.listCatIndex = category;
        host.listChannel = index;
        host.listArray = host.cats[host.catsArray[category]].slice();
        host.listDataArray = host.listArray;
        host.listKeyHandler = () => false;
        host.selIndex = index;
        host.showPage();
    }
    host.channelsList = (category, index) => {
        effect("back", host.__ottChannels.group(category), index);
        showChannels(host.__ottChannels.group(category), index);
    };
    mount();
    host.catIndex = 0;
    host.primaryIndex = 2;
    host.curList = host.cats[host.catsArray[0]];
    showChannels();
    events.length = 0;
    return {
        allTimers,
        change(action, value, extra) {
            return host.__ottChannels.change(action, value, extra);
        },
        element,
        events,
        flush() {
            for (let n = 0; n < 50; n++) {
                const timer = [...timers.values()].find(
                    (value) => value.delay <= 10
                );
                if (!timer) return;
                timers.delete(timer.id);
                timer.fn();
            }
            throw Error("unbounded search timers");
        },
        hooks,
        host,
        key(name) {
            return port.dispatch(host.keys[name], null, () =>
                effect("main", name)
            );
        },
        mount,
        open() {
            element("editvar").value = "";
            host.searchChannel();
            return host.setEdit;
        },
        pin(value = "2468") {
            for (const digit of value) this.key("N" + digit);
            this.key("ENTER");
        },
        port,
        replaceSource(account = "account-b", repaint = true) {
            port.invalidate();
            credentials = { ...credentials, username: account };
            host.__ottActiveProviderDriver = {
                credentials: () => credentials,
                id: "fixture",
            };
            mount();
            if (repaint) showChannels();
        },
        saved,
        search(query = "News One") {
            this.open();
            this.submit(query);
            this.flush();
        },
        showChannels,
        submit(query, nativeValue = "") {
            element("editvar").value = nativeValue;
            host.editvar = query;
            port.finishEditor(true, () => {});
        },
        take(kind) {
            return events.filter((event) => event[0] === kind);
        },
    };
}
const bundleIndex = process.argv.indexOf("--bundle");
const profiles =
    bundleIndex >= 0
        ? (process.argv[bundleIndex + 1]
              ? [process.argv[bundleIndex + 1]]
              : [
                    "dist/stbPlayer.js",
                    "src-tauri/frontend/dist/stbPlayer.js",
                    "dist-mobile/dist/stbPlayer.js",
                ]
          ).map((file) => [file, bundleRuntime(file)])
        : [["source", sourceRuntime()]];
let passed = 0;
const failures = [];
for (const [profile, code] of profiles) {
    function check(name, run) {
        try {
            run(fixture(code));
            passed++;
        } catch (error) {
            failures.push(profile + ": " + name + "\n" + error.stack);
        }
    }
    check(
        "search publishes native input once and uses real list owner",
        (f) => {
            const save = f.open();
            f.submit("Sport", "News One");
            save();
            f.flush();
            assert.deepEqual(Array.from(f.host.listArray), [11]);
            assert.equal(f.saved.get("chSearch"), "News One");
            assert.equal(f.take("write").length, 1);
            assert(f.port.listOwner().foreground());
        }
    );
    check("cancelled editor callback cannot write or publish", (f) => {
        const save = f.open();
        f.host.editvar = "News";
        f.port.finishEditor(false, () => {});
        save();
        f.flush();
        assert.equal(f.take("write").length, 0);
        assert.equal(f.take("render").length, 0);
    });
    check("empty submission has no persistence or search effects", (f) => {
        f.open();
        f.submit("");
        f.flush();
        assert.equal(f.take("write").length, 0);
        assert.equal(f.take("render").length, 0);
    });
    for (const event of [
        "source",
        "source ABA",
        "close",
        "new editor",
        "catalog replacement",
    ]) {
        check(event + " retires old editor submission", (f) => {
            const save = f.open();
            f.host.editvar = "News One";
            if (event === "source" || event === "source ABA") f.replaceSource();
            if (event === "source ABA") f.replaceSource("account-a");
            if (event === "close") f.host.closeList();
            if (event === "new editor") {
                f.open();
                f.port.finishEditor(false, () => {});
            }
            if (event === "catalog replacement") {
                f.host.channels = { ...f.host.channels };
                f.mount();
            }
            const before = f.take("render").length;
            save();
            f.port.finishEditor(true, () => {});
            f.flush();
            assert.equal(f.take("write").length, 0);
            assert.equal(f.take("render").length, before);
        });
    }
    check("newest search stays current after obsolete callbacks", (f) => {
        const first = f.open();
        f.host.editvar = "News Two";
        f.open();
        f.submit("News One");
        first();
        f.flush();
        assert.deepEqual(Array.from(f.host.listArray), [11]);
        assert.equal(f.take("write").length, 1);
    });
    check("cancelling repeated search leaves previous results usable", (f) => {
        f.search();
        f.key("YELLOW");
        f.port.finishEditor(false, () => {});
        f.key("ENTER");
        f.flush();
        assert.deepEqual(f.take("play"), [["play", 11]]);
    });
    check("member reorder during delay plays stable item", (f) => {
        f.search();
        f.key("ENTER");
        assert(
            f.change("member", {
                action: "move",
                channelId: 11,
                delta: 1,
                groupId: "provider:news",
            })
        );
        f.flush();
        assert.deepEqual(f.take("play"), [["play", 11]]);
    });
    check("group reorder and rename during delay preserve target", (f) => {
        f.search();
        f.key("ENTER");
        assert(f.change("move", "provider:news", 1));
        assert(f.change("rename", "provider:news", "Changed"));
        f.flush();
        assert.deepEqual(f.take("play"), [["play", 11]]);
    });
    for (const event of [
        "source",
        "source ABA",
        "catalog",
        "item",
        "group",
        "new screen",
        "new screen ABA",
    ]) {
        check(
            event + " cancels delayed playback even if queued timer fires",
            (f) => {
                f.search();
                f.key("ENTER");
                const timer = f.allTimers.find((item) => item.delay === 10);
                assert(timer, "normal acceptance scheduled playback");
                if (event === "source" || event === "source ABA")
                    f.replaceSource();
                if (event === "source ABA") f.replaceSource("account-a");
                if (event === "catalog") {
                    f.host.channels = { ...f.host.channels };
                    f.mount();
                }
                if (event === "item")
                    f.change("member", {
                        action: "remove",
                        channelId: 11,
                        groupId: "provider:news",
                    });
                if (event === "group") f.change("remove", "provider:news");
                if (event === "new screen" || event === "new screen ABA")
                    f.showChannels();
                if (event === "new screen ABA") f.host.closeList();
                timer.fn();
                f.flush();
                assert.deepEqual(f.take("play-request"), []);
            }
        );
    }
    check("removed visible item never selects the neighbour", (f) => {
        f.search();
        f.change("member", {
            action: "remove",
            channelId: 11,
            groupId: "provider:news",
        });
        f.key("ENTER");
        f.flush();
        assert.deepEqual(f.take("play-request"), []);
    });
    check(
        "same numeric ID with different canonical item is not accepted",
        (f) => {
            f.search();
            f.host.channels[11] = {
                ...f.host.channels[11],
                itemId: "replacement",
            };
            f.key("ENTER");
            f.flush();
            assert.deepEqual(f.take("play-request"), []);
        }
    );
    check(
        "preview2 previews once, then confirms same item after reorder",
        (f) => {
            f.host.sPreview = 2;
            f.search();
            f.key("ENTER");
            assert.deepEqual(f.take("preview"), [["preview", 11]]);
            assert.deepEqual(f.take("current"), []);
            f.change("member", {
                action: "move",
                channelId: 11,
                delta: 1,
                groupId: "provider:news",
            });
            f.key("ENTER");
            f.flush();
            assert.deepEqual(f.take("current"), [["current", 11]]);
            assert.deepEqual(f.take("play-request"), []);
        }
    );
    check(
        "PIN acceptance re-resolves channel after member and group reorder",
        (f) => {
            f.change("lock", 11, true);
            f.search();
            f.key("ENTER");
            assert(f.port.owner("dialog"));
            assert.deepEqual(f.take("play-request"), []);
            f.change("member", {
                action: "move",
                channelId: 11,
                delta: 1,
                groupId: "provider:news",
            });
            f.change("move", "provider:news", 1);
            f.pin();
            f.flush();
            assert.deepEqual(f.take("play"), [["play", 11]]);
        }
    );
    check("cancelled PIN never plays", (f) => {
        f.change("lock", 11, true);
        f.search();
        f.key("ENTER");
        f.key("RETURN");
        f.flush();
        assert.deepEqual(f.take("play-request"), []);
    });
    check("changed PIN invalidates pending acceptance", (f) => {
        f.change("lock", 11, true);
        f.search();
        f.key("ENTER");
        f.host.parentPIN = "1357";
        f.pin("2468");
        f.flush();
        assert.deepEqual(f.take("play-request"), []);
    });
    for (const event of ["source ABA", "catalog", "item", "close"]) {
        check(event + " retires an outstanding PIN result", (f) => {
            f.change("lock", 11, true);
            f.search();
            f.key("ENTER");
            const handler = f.host.dialogBoxKeyHandler;
            assert.equal(typeof handler, "function");
            if (event === "source ABA") {
                f.replaceSource();
                f.replaceSource("account-a");
            }
            if (event === "catalog") {
                f.host.channels = { ...f.host.channels };
                f.mount();
            }
            if (event === "item")
                f.change("member", {
                    action: "remove",
                    channelId: 11,
                    groupId: "provider:news",
                });
            if (event === "close") f.host.closeList();
            for (const digit of "2468") handler(f.host.keys["N" + digit]);
            handler(f.host.keys.ENTER);
            f.flush();
            assert.deepEqual(f.take("play-request"), []);
        });
    }
    check("lock added during playback delay is enforced", (f) => {
        f.search();
        f.key("ENTER");
        f.change("lock", 11, true);
        f.flush();
        assert.deepEqual(f.take("play"), []);
        assert(f.port.owner("dialog"));
        f.pin();
        assert.deepEqual(f.take("play"), [["play", 11]]);
    });
    check("preview confirmation rechecks changed parental lock", (f) => {
        f.host.sPreview = 2;
        f.search();
        f.key("ENTER");
        f.change("lock", 11, true);
        f.key("ENTER");
        assert.deepEqual(f.take("current"), []);
        f.key("RETURN");
        assert.deepEqual(f.take("current"), []);
    });
    for (const boundary of ["read", "write"]) {
        check(
            "storage " + boundary + " reentry cannot overwrite replacement",
            (f) => {
                if (boundary === "read") f.hooks.read = () => f.replaceSource();
                f.open();
                if (boundary === "write")
                    f.hooks.write = () => f.replaceSource();
                const before = f.take("render").length;
                f.submit("News One");
                f.flush();
                assert.equal(
                    f.take("render").length,
                    before + (boundary === "write" ? 1 : 0)
                );
                assert(!f.port.owner("editor"));
                assert.equal(
                    f.take("write").length,
                    boundary === "write" ? 1 : 0
                );
            }
        );
    }
    check(
        "input getter reentry cannot persist old query into new source",
        (f) => {
            f.open();
            Object.defineProperty(f.element("editvar"), "value", {
                configurable: true,
                get() {
                    f.replaceSource();
                    return "News One";
                },
            });
            f.port.finishEditor(true, () => {});
            f.flush();
            assert.deepEqual(f.take("write"), []);
        }
    );
    check("close cleanup replacement prevents delayed play", (f) => {
        f.search();
        f.port.listOwner().own(() => f.showChannels("provider:sport"));
        f.key("ENTER");
        f.flush();
        assert.deepEqual(f.take("play-request"), []);
        assert.equal(
            f.host.__ottChannels.group(f.host.listCatIndex),
            "provider:sport"
        );
    });
    check("preview effect replacement retains new screen", (f) => {
        f.host.sPreview = 2;
        f.search();
        f.hooks.preview = () => f.replaceSource();
        f.key("ENTER");
        f.flush();
        assert(f.port.listOwner().foreground());
        assert.deepEqual(f.take("current"), []);
    });
    check("selection effect replacement stops old information updates", (f) => {
        f.host.sPreview = 1;
        f.search();
        f.hooks.current = () => f.replaceSource();
        f.key("ENTER");
        f.flush();
        assert.deepEqual(f.take("update"), []);
        assert.deepEqual(f.take("info"), []);
        assert(f.port.listOwner().foreground());
    });
    check(
        "return follows captured group and previous channel after reorder",
        (f) => {
            f.host.listChannel = 1;
            f.search();
            f.change("member", {
                action: "move",
                channelId: 22,
                delta: -1,
                groupId: "provider:news",
            });
            f.change("move", "provider:news", 1);
            f.key("RETURN");
            assert.deepEqual(f.take("back"), [["back", "provider:news", 0]]);
        }
    );
    check("information and favorite key actions keep selected result", (f) => {
        f.host.sFavorites = 1;
        f.search();
        f.key("INFO");
        f.key("GREEN");
        assert.deepEqual(f.take("programme"), [["programme", "Programme one"]]);
        assert.deepEqual(f.take("favorite"), [["favorite", 11]]);
    });
    for (const boundary of ["saveListPanelState", "renderButtonHint"]) {
        for (const replacement of ["source", "screen"]) {
            check(
                "picker setup " +
                    boundary +
                    " respects replacement " +
                    replacement,
                (f) => {
                    f.search();
                    const original = f.host[boundary];
                    const snapshot = () =>
                        JSON.stringify({
                            categories: f.host.cats,
                            events: f.events,
                            rows: f.host.listArray,
                        });
                    let expected;
                    f.host[boundary] = function () {
                        const result = original.apply(this, arguments);
                        if (replacement === "source") f.replaceSource();
                        else f.showChannels("provider:sport");
                        expected = snapshot();
                        return result;
                    };
                    f.key("GREEN");
                    f.flush();
                    assert(
                        expected,
                        "real picker setup called the external boundary"
                    );
                    assert.equal(snapshot(), expected);
                }
            );
        }
    }
    for (const key of ["ENTER", "RETURN"]) {
        check(
            "cancelled repeated search then picker " +
                key +
                " preserves selected result",
            (f) => {
                f.search("News");
                f.host.selIndex = 1;
                f.key("YELLOW");
                f.port.finishEditor(false, () => {});
                f.key("GREEN");
                assert(f.host.listArray.includes("Sport"));
                f.host.selIndex = f.host.listArray.indexOf("Sport");
                f.key(key);
                assert.deepEqual(Array.from(f.host.listArray), [11, 22]);
                assert.equal(f.host.selIndex, 1);
                f.key("ENTER");
                f.flush();
                assert.deepEqual(f.take("play"), [["play", 22]]);
            }
        );
        check(
            "real category picker " + key + " restores usable search results",
            (f) => {
                f.search();
                f.key("GREEN");
                assert(
                    f.host.listArray.includes("Sport"),
                    "real picker opened"
                );
                f.host.selIndex = f.host.listArray.indexOf("Sport");
                f.key(key);
                assert.deepEqual(Array.from(f.host.listArray), [11]);
                assert.equal(f.host.cats.Sport.includes(11), key === "ENTER");
                f.key("ENTER");
                f.flush();
                assert.deepEqual(f.take("play"), [["play", 11]]);
            }
        );
        for (const event of ["account", "account ABA", "screen", "close"]) {
            check("retired picker " + key + " is inert after " + event, (f) => {
                f.search();
                f.key("GREEN");
                f.host.selIndex = f.host.listArray.indexOf("Sport");
                const handler = f.host.listKeyHandlerFn;
                assert.equal(typeof handler, "function");
                if (event === "account" || event === "account ABA")
                    f.replaceSource();
                if (event === "account ABA") f.replaceSource("account-a");
                if (event === "screen") f.showChannels("provider:sport");
                if (event === "close") f.host.closeList();
                const before = JSON.stringify({
                    categories: f.host.cats,
                    events: f.events,
                    rows: f.host.listArray,
                });
                handler(f.host.keys[key]);
                f.flush();
                assert.equal(
                    JSON.stringify({
                        categories: f.host.cats,
                        events: f.events,
                        rows: f.host.listArray,
                    }),
                    before
                );
            });
        }
    }
    console.log("Channel search profile checked: " + profile);
}
for (const failure of failures) console.error("FAIL " + failure);
console.log(
    "Channel search: " + passed + " passed; " + failures.length + " failed"
);
if (failures.length) process.exitCode = 1;

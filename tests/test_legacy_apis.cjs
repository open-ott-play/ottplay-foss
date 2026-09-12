const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function compile(file, names) {
    const ast = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const statements = ast.statements.filter(
        (node) =>
            !ts.isImportDeclaration(node) &&
            (!names ||
                (ts.isFunctionDeclaration(node) &&
                    names.includes(node.name.text)))
    );
    if (names) assert.equal(statements.length, names.length);
    return ts.transpileModule(
        statements
            .map((node) => node.getText(ast).replace(/^export\s+/, ""))
            .join("\n"),
        {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
}

const storageCode = compile("src/storage/index.ts");
function storageFixture(mode, cookiesDenied = false) {
    const saved = { original: "keep me" };
    const cookies = { malformed: "%ZZ", valid: "stored" };
    const document = {};
    Object.defineProperty(document, "cookie", {
        get() {
            if (cookiesDenied) throw new Error("Cookie SecurityError");
            return Object.keys(cookies)
                .map((key) => key + "=" + cookies[key])
                .join("; ");
        },
        set(value) {
            if (cookiesDenied) throw new Error("Cookie SecurityError");
            const pair = value.split(";")[0];
            const equals = pair.indexOf("=");
            const key = pair.slice(0, equals);
            if (value.includes("1970")) delete cookies[key];
            else cookies[key] = pair.slice(equals + 1);
        },
    });
    const local = {
        clear() {
            for (const key of Object.keys(saved)) delete saved[key];
        },
        getItem(key) {
            if (mode === "read") throw new Error("SecurityError");
            return Object.hasOwn(saved, key) ? saved[key] : null;
        },
        key(index) {
            return Object.keys(saved)[index];
        },
        get length() {
            return Object.keys(saved).length;
        },
        removeItem(key) {
            delete saved[key];
        },
        setItem(key, value) {
            if (mode === "write") throw new Error("QuotaExceededError");
            saved[key] = value;
        },
    };
    const c = vm.createContext({ console, document, localStorage: local });
    c.window = c;
    if (mode === "access")
        Object.defineProperty(c, "localStorage", {
            get() {
                throw new Error("SecurityError");
            },
        });
    if (mode === "missing") c.localStorage = undefined;
    vm.runInContext(storageCode, c);
    return c.storage;
}
for (const mode of ["native", "access", "read", "write", "missing"]) {
    for (const cookiesDenied of [false, true]) {
        const storage = storageFixture(mode, cookiesDenied);
        const key = "provider/[name] ä=key";
        storage.set(key, "value & %; preserved");
        assert.equal(storage.get(key), "value & %; preserved", mode);
        assert(storage.has(key));
        assert(storage.hasValue(key));
        if (mode === "write")
            assert.equal(
                storage.get("original"),
                "keep me",
                "Quota failover keeps readable native keys"
            );
        storage.set("empty", "");
        assert(storage.has("empty"));
        assert(!storage.hasValue("empty"));
        storage.setI("count", 17);
        assert.equal(storage.getI("count"), 17);
        assert.equal(storage.getI("missing", 9), 9);
        assert.equal(storage.dump()[key], "value & %; preserved");
        storage.del(key);
        assert.equal(storage.get(key), null);
        assert(!storage.has(key));
        storage.clear();
        assert.equal(Object.keys(storage.dump()).length, 0);
        assert.equal(storage.get("original"), null);
        storage.set("after-clear", "works");
        assert.equal(storage.get("after-clear"), "works");
    }
}
const cookieStorage = storageFixture("missing");
assert.equal(cookieStorage.get("valid"), "stored");
assert.equal(cookieStorage.get("malformed"), null);

// A native performance.now does not imply Date.now exists in the host engine.
const dateContext = vm.createContext({
    performance: {
        now() {
            return 42;
        },
    },
});
dateContext.window = dateContext;
vm.runInContext(
    "Date.now = undefined;" +
        compile("src/polyfills/index.ts", ["polyfillPerformanceNow"]) +
        "polyfillPerformanceNow();",
    dateContext
);
assert.equal(vm.runInContext("typeof Date.now()", dateContext), "number");
assert.equal(dateContext.performance.now(), 42);

// Old WebKit mouse events have no Element.closest; the installed jQuery provides it.
const handlers = {};
const nodes = {};
function node(id) {
    return (nodes[id] ||= {
        addEventListener(type, callback) {
            handlers[id + ":" + type] = callback;
        },
        contains() {
            return true;
        },
        focus() {},
        getAttribute(name) {
            return this[name] || null;
        },
        id,
        nodeType: 1,
        removeEventListener() {},
        style: {},
        value: "",
    });
}
function $(target) {
    const chain = new Proxy(
        {},
        {
            get(_obj, key) {
                if (key === "val") return () => node("editvar").value;
                if (key === "closest")
                    return (selector) => {
                        let current = target;
                        while (current) {
                            if (current.selector === selector) return [current];
                            current = current.parent;
                        }
                        return [];
                    };
                return () => chain;
            },
        }
    );
    return chain;
}
$.each = (items, callback) =>
    items.forEach((item, index) => callback(index, item));
$.fn = { hide() {}, show() {} };
const selected = [];
const keys = [];
const savedValues = [];
const c = vm.createContext({
    _doKey(key) {
        keys.push(key);
    },
    $,
    console,
    document: {
        getElementById: node,
        querySelector() {
            return {};
        },
    },
    jQuery: $,
    keys: { ENTER: 13, EXIT: 27, RETURN: 8 },
    list_OnClick() {},
    restoreCPD() {},
    saveCPD() {},
    setEdit() {
        savedValues.push(c.editvar);
    },
    setSelect(index) {
        selected.push(index);
    },
});
c.window = c;
vm.runInContext(
    compile("src/ui/index.ts", ["uiInit", "showEditKey2", "editKey2"]),
    c
);
c.uiInit();
const row = {
    getAttribute(name) {
        return name === "data-idx" ? "3" : null;
    },
    nodeType: 1,
    selector: ".item",
};
const button = {
    getAttribute() {
        return "_doKey(13)";
    },
    nodeType: 1,
    selector: "span[onclick]",
};
function click(target) {
    return {
        preventDefault() {},
        stopImmediatePropagation() {},
        stopPropagation() {},
        target,
    };
}
handlers["listIn:click"](click({ nodeType: 1, parent: row }));
assert.deepEqual(selected, [3]);
handlers["listPodval:click"](click({ nodeType: 1, parent: button }));
assert.deepEqual(keys, [13]);
handlers["listIn:click"](click({ nodeType: 1, selector: ".list-scroll" }));
assert.deepEqual(selected, [3]);

c.editvar = 'password&copy;="quoted"<literal>';
c.showEditKey2();
assert.equal(
    node("editvar").value,
    c.editvar,
    "Input values must not be decoded as HTML entities"
);
const inputKey = handlers["editvar:keydown"];
let compositionStopped = false;
inputKey({
    ...click(node("editvar")),
    isComposing: true,
    key: "Enter",
    preventDefault() {
        assert.fail("IME composition default must be preserved");
    },
    stopPropagation() {
        compositionStopped = true;
    },
});
assert(
    compositionStopped,
    "IME Enter must not bubble into the player key router"
);
inputKey({ ...click(node("editvar")), keyCode: 229 });
assert.equal(
    savedValues.length,
    0,
    "IME composition must not submit the input"
);
inputKey({ ...click(node("editvar")), keyCode: 13 });
assert.deepEqual(
    savedValues,
    [c.editvar],
    "Old keyCode-only events submit exactly once"
);
console.log(
    "PASS: denied/quota storage with cookie/memory fallback, legacy Date/mouse APIs and exact native input"
);

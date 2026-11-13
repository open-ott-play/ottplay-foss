const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const prepareSourceRealm = require("./helpers/source-core-runtime.cjs");

const relative = "src/settings/global-favorites-portable.ts";
const box = { encodeURIComponent, exports: {} };
const compiled = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "..", relative), "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
);
vm.runInNewContext(compiled.outputText, prepareSourceRealm(box, relative));
const codec = box.exports.createGlobalFavoritesPortableCodec();
const plain = (value) => JSON.parse(JSON.stringify(value));

function entry() {
    return {
        locator: { channelId: "001", kind: "channel" },
        origin: {
            profile: "Family",
            provider: "m3u",
            sourceAlias: "Living room",
            subprofile: null,
        },
        title: "News 日本語😀",
    };
}

function boundedArrayDag() {
    let indexedReads = 0;
    const count = (key) => {
        if (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key)) {
            indexedReads++;
            if (indexedReads > 64)
                throw new Error("Bounded malformed-array traversal stopped");
        }
    };
    let value = "synthetic private leaf";
    // Eight shared arrays, not an expanded binary tree. Both access paths are
    // bounded even if a snapshot copier runs before schema validation.
    for (let depth = 0; depth < 8; depth++) {
        value = new Proxy([value, value], {
            get(target, key, receiver) {
                count(key);
                return Reflect.get(target, key, receiver);
            },
            getOwnPropertyDescriptor(target, key) {
                count(key);
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
    }
    return { reads: () => indexedReads, value };
}

for (const method of ["normalize", "identity", "document"]) {
    test(
        method + " rejects malformed schema leaves before array traversal",
        () => {
            for (const field of ["title", "profile", "channelId"]) {
                const row = entry();
                const dag = boundedArrayDag();
                const target =
                    field === "profile"
                        ? row.origin
                        : field === "channelId"
                          ? row.locator
                          : row;
                target[field] = dag.value;
                const input =
                    method === "document"
                        ? { entries: [row], version: 1 }
                        : row;
                assert.equal(
                    codec[method](input),
                    method === "identity" ? "" : null
                );
                assert.equal(
                    dag.reads(),
                    0,
                    method +
                        ": invalid " +
                        field +
                        " must not expand nested arrays"
                );
            }
        }
    );
}

test("valid portable origin and locator retain exact canonical identity", () => {
    const row = entry();
    const normalized = codec.normalize(row);
    assert.deepEqual(plain(normalized), row);
    assert.equal(
        codec.identity(row),
        JSON.stringify({ locator: row.locator, origin: row.origin })
    );
    assert.deepEqual(plain(codec.document({ entries: [row], version: 1 })), {
        entries: [row],
        version: 1,
    });
    row.origin.profile = "Changed";
    row.locator.channelId = "002";
    assert.equal(normalized.origin.profile, "Family");
    assert.equal(normalized.locator.channelId, "001");
});

test("inherited array data slots preserve document and capability parity", () => {
    function inheritedSlot(value) {
        const array = new Array(1);
        const prototype = Object.create(Array.prototype);
        Object.defineProperty(prototype, "0", { enumerable: true, value });
        Object.setPrototypeOf(array, prototype);
        assert.equal(Object.hasOwn(array, "0"), false);
        return array;
    }
    const row = entry();
    const document = { entries: inheritedSlot(row), version: 1 };
    assert.deepEqual(plain(codec.document(document)), {
        entries: [row],
        version: 1,
    });
    assert.equal(codec.supports(document, inheritedSlot("channel")), true);
    assert.equal(codec.supports(document, inheritedSlot("plex-media")), false);
});

test("invalid public shape does not invoke getters or expose private values", () => {
    for (const privateField of [false, true]) {
        const row = entry();
        let calls = 0;
        Object.defineProperty(row, privateField ? "token" : "title", {
            enumerable: true,
            get() {
                calls++;
                return "synthetic private value";
            },
        });
        assert.equal(codec.normalize(row), null);
        assert.equal(codec.identity(row), "");
        assert.equal(codec.document({ entries: [row], version: 1 }), null);
        assert.equal(calls, 0, "public validation must not invoke getters");
    }
});

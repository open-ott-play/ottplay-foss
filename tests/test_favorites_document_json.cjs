const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const test = require("node:test");
const compiled = ts.transpileModule(
    fs.readFileSync("src/commands/favorites-document-json.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
require("acorn").parse(compiled, { ecmaVersion: 5 });
const context = { exports: {}, Uint8Array };
vm.runInNewContext(compiled, context);
const parse = context.exports.parseFavoritesDocumentJson;
const encode = context.exports.encodeFavoritesDocumentJson;
const bytes = (s) => new Uint8Array(Buffer.from(s));
const plain = (v) => JSON.parse(JSON.stringify(v));
test("strict Unicode roundtrip and exact JSON data", () => {
    const value = {
        a: [null, true, false, 1, -1, 1.25, 'ASCII / \\ " \n Привет 日本 😀'],
        empty: {},
    };
    assert.deepEqual(plain(parse(encode(value))), value);
    assert.deepEqual(plain(parse(bytes(' \r\n {"x": 1e2}\t'))), { x: 100 });
});
test("duplicate decoded keys rejected at every object level", () => {
    for (const s of [
        '{"x":1,"x":2}',
        '{"x":1,"\\u0078":2}',
        '{"a":[{"x":1,"x":2}]}',
        '{"__proto__":1,"__proto__":2}',
    ])
        assert.throws(() => parse(bytes(s)), /codec_error/);
    const v = parse(bytes('{"__proto__":{"polluted":true},"constructor":1}'));
    assert(Object.hasOwn(v, "__proto__"));
    assert.equal(Object.getPrototypeOf(v).polluted, undefined);
});
test("invalid UTF8, overlong, truncated, surrogate and out-of-range scalars refused", () => {
    for (const raw of [
        [0xc0, 0x80],
        [0xc1, 0xbf],
        [0x80],
        [0xe0, 0x80, 0x80],
        [0xed, 0xa0, 0x80],
        [0xf0, 0x80, 0x80, 0x80],
        [0xf4, 0x90, 0x80, 0x80],
        [0xf5, 0x80, 0x80, 0x80],
        [0xe2, 0x82],
        [0xe2, 0x41, 0xac],
        [0xff],
    ])
        assert.throws(
            () => parse(new Uint8Array([34, ...raw, 34])),
            /codec_error/
        );
    assert.throws(() => parse(bytes("\ufeff{}")), /codec_error/);
});
test("unpaired surrogate keys and values refused including JSON escapes", () => {
    for (const s of ['"\\ud800"', '"\\udfff"', '"\\ud800x"', '{"\\ud800":1}'])
        assert.throws(() => parse(bytes(s)), /codec_error/);
    for (const v of ["\ud800", "\udfff", { ["\ud800"]: 1 }, { a: "\ud800" }])
        assert.throws(() => encode(v), /codec_error/);
    assert.equal(parse(bytes('"\\ud83d\\ude00"')), "😀");
});
test("JSON grammar and nonfinite parse numbers fail closed", () => {
    for (const s of [
        "",
        "undefined",
        "01",
        "1.",
        "+1",
        "1e",
        "1e999",
        "NaN",
        "[1,]",
        '{"a":1,}',
        '{"a" 1}',
        "true false",
        '"x\n"',
        '"\\v"',
        '"\\u12zz"',
        '"unterminated',
    ])
        assert.throws(() => parse(bytes(s)), /codec_error/);
});
test("depth limit is identical for parse and encode", () => {
    let v = 0;
    for (let i = 0; i < 19; i++) v = [v];
    assert.doesNotThrow(() => parse(encode(v)));
    v = [v];
    assert.throws(() => encode(v), /codec_error/);
    assert.throws(
        () => parse(bytes("[".repeat(20) + "0" + "]".repeat(20))),
        /codec_error/
    );
});
test("node limit includes root and each array/member value", () => {
    const v = Array(32767).fill(null);
    assert.equal(parse(encode(v)).length, 32767);
    v.push(null);
    assert.throws(() => encode(v), /codec_error/);
    assert.throws(() => parse(bytes(JSON.stringify(v))), /codec_error/);
});
test("byte limit applies to serialized and UTF8-expanded documents", () => {
    const v = "x".repeat(1048574);
    assert.equal(encode(v).length, 1048576);
    assert.equal(parse(encode(v)), v);
    assert.throws(() => encode(v + "x"), /codec_error/);
    assert.throws(() => parse(new Uint8Array(1048577)), /codec_error/);
    assert.throws(() => encode("😀".repeat(262144)), /codec_error/);
    assert.throws(() => encode("\0".repeat(200000)), /codec_error/);
});
test("encode refuses lossy JSON, cycles, sparse arrays and executable hooks", () => {
    const cycle = {};
    cycle.x = cycle;
    let invoked = 0;
    const accessor = {};
    Object.defineProperty(accessor, "x", {
        enumerable: true,
        get() {
            invoked++;
            return 1;
        },
    });
    const hook = {};
    Object.defineProperty(hook, "toJSON", {
        get() {
            invoked++;
            return () => 1;
        },
    });
    for (const v of [
        undefined,
        NaN,
        Infinity,
        () => 1,
        { a: undefined },
        [undefined],
        Array(1),
        new Date(),
        cycle,
        accessor,
        hook,
        { [Symbol("x")]: 1 },
        Object.assign([1], { extra: 2 }),
    ])
        assert.throws(() => encode(v), /codec_error/);
    assert.equal(invoked, 0);
});

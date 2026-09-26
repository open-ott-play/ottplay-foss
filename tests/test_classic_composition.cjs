const assert = require("node:assert/strict");
const { minify } = require("terser");
const {
    argumentsFor,
    attributeModules,
    measureSource,
} = require("../scripts/measure-classic-composition.cjs");

async function main() {
    const source =
        'function greet(value) { return "Привет 😀" + value; }\n// comment\nvar result = greet(2);';
    const measured = measureSource(source);
    assert.equal(measured.bytes, Buffer.byteLength(source));
    assert.equal(measured.functions, 1);
    assert(
        measured.bytes > source.length,
        "measure UTF-8 bytes, not UTF-16 positions"
    );
    assert.equal(
        Object.values(measured.tokenBytes).reduce(
            (sum, value) => sum + value,
            0
        ),
        measured.bytes
    );
    assert(measured.tokenBytes.spacing > 0);
    assert(measured.gzipBytes > 0);
    assert.match(measured.sha256, /^[a-f0-9]{64}$/);

    const emitted = await minify(
        {
            "first.js": 'function greet(value) { return "Привет 😀" + value; }',
            "second.js": "window.result = greet(2);",
        },
        {
            compress: false,
            ecma: 5,
            format: { beautify: true },
            mangle: false,
            sourceMap: { asObject: true },
        }
    );
    const modules = attributeModules(emitted.code, emitted.decoded_map);
    const first = modules.find((entry) => entry.module === "first.js");
    const second = modules.find((entry) => entry.module === "second.js");
    assert.equal(first.functions, 1);
    assert.equal(second.functions, 0);
    assert(first.tokenBytes.strings >= Buffer.byteLength('"Привет 😀"'));
    assert(second.tokenBytes.identifiers > 0);
    assert.equal(
        modules.reduce((sum, entry) => sum + entry.bytes, 0),
        Buffer.byteLength(emitted.code)
    );
    assert(
        modules.find((entry) => entry.module === "<unmapped>").bytes > 0,
        "unmapped line breaks are counted explicitly"
    );

    const partial = attributeModules("var x=1;", {
        mappings: [[[4, 0, 0, 0], [5]]],
        sources: ["partial.js"],
    });
    assert.equal(
        partial.find((entry) => entry.module === "partial.js").bytes,
        1
    );
    assert.equal(
        partial.find((entry) => entry.module === "<unmapped>").bytes,
        7
    );
    assert.deepEqual(attributeModules("", { mappings: [], sources: [] }), []);
    assert.throws(() => attributeModules("x", null), /decoded source map/);
    assert.throws(() =>
        attributeModules("x", {
            mappings: [[[2, 0, 0, 0]]],
            sources: ["bad.js"],
        })
    );
    assert.deepEqual(argumentsFor([]), {
        comparison: undefined,
        output: "build/reports/classic-composition.json",
    });
    assert.deepEqual(
        argumentsFor(["--compare", "reference.js", "--output", "result.json"]),
        { comparison: "reference.js", output: "result.json" }
    );
    assert.throws(() => argumentsFor(["--compare"]), /Usage:/);
    assert.throws(() => argumentsFor(["--unknown", "file"]), /Usage:/);
    console.log(
        "Classic composition: UTF-8 accounting, source maps, function attribution and arguments passed"
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

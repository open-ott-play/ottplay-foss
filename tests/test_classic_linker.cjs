const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const { assembleClassic } = require("../scripts/classic-bundle.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-linker-"));
function write(name, source) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
}
try {
    write(
        "dep.js",
        "export var video = null; export function setVideo(v) { video = v; }"
    );
    write(
        "entry.js",
        `
        import {
            video as videoElement,
            setVideo
        } from "./dep";
        export function read(video) { return videoElement; }
        export function shadow(videoElement) { return videoElement; }
        export function record() { return { videoElement }; }
        export function property(object) { return object.videoElement; }
        export function valueType() { return typeof videoElement; }
    `
    );
    const linked = assembleClassic(root, ["dep.js", "entry.js"]);
    acorn.parse(linked, { ecmaVersion: 5 });
    const context = vm.createContext({});
    vm.runInContext(linked, context);
    assert.equal(context.read("wrong captured parameter"), null);
    const player = { position: 12 };
    context.setVideo(player);
    assert.equal(
        context.read("wrong captured parameter"),
        player,
        "Imported mutable binding stays live"
    );
    assert.equal(
        context.shadow("local"),
        "local",
        "Do not rewrite locally shadowed bindings"
    );
    assert.equal(
        context.record().videoElement,
        player,
        "Preserve shorthand property keys"
    );
    assert.equal(
        context.property({ videoElement: 5 }),
        5,
        "Do not rewrite member names"
    );
    assert.equal(context.valueType(), "object");
    assert.throws(
        () => assembleClassic(root, ["entry.js"]),
        /not in CLASSIC_MODULES/
    );
    write(
        "external.js",
        'import { video } from "unknown-package"; export function read() { return video; }'
    );
    assert.throws(
        () => assembleClassic(root, ["external.js"]),
        /not in CLASSIC_MODULES/
    );
    write(
        "namespace.js",
        'import * as data from "./dep"; export function read() { return data.video; }'
    );
    assert.throws(
        () => assembleClassic(root, ["dep.js", "namespace.js"]),
        /named imports/
    );
    write(
        "build/app/state.js",
        "export var popupActions = []; export var arbitrary = 1;"
    );
    write(
        "build/index.js",
        'var popupActions = ["provided by classic entry"];'
    );
    write(
        "build/provider.js",
        'import { popupActions as actions } from "./app/state"; export function getActions() { return actions; }'
    );
    const bridgeContext = vm.createContext({});
    vm.runInContext(
        assembleClassic(root, ["build/provider.js", "build/index.js"]),
        bridgeContext
    );
    assert.equal(bridgeContext.getActions()[0], "provided by classic entry");
    assert.throws(
        () => assembleClassic(root, ["build/provider.js"]),
        /missing explicit classic bridge/
    );
    write(
        "build/provider.js",
        'import { arbitrary } from "./app/state"; export function get() { return arbitrary; }'
    );
    assert.throws(
        () => assembleClassic(root, ["build/provider.js", "build/index.js"]),
        /missing explicit classic bridge/
    );
    console.log(
        "PASS: classic ES5 linker preserves live aliases and lexical bindings, validates dependencies and explicit ABI bridges"
    );
} finally {
    fs.rmSync(root, { force: true, recursive: true });
}

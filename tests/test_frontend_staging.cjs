/* Exercise the actual Vite staging functions without rebuilding the player. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const configPath = path.resolve(__dirname, "../vite.config.ts");
const text = fs.readFileSync(configPath, "utf8");
const config = ts.createSourceFile(
    configPath,
    text,
    ts.ScriptTarget.Latest,
    true
);
const names = new Set([
    "privateAssetDirectories",
    "copyRuntimeAssets",
    "stagePlayerAssets",
    "autoPlaybackScript",
    "stageTauriFrontend",
]);
const selected = config.statements.filter((node) => {
    if (ts.isFunctionDeclaration(node)) return names.has(node.name?.text);
    return (
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((item) =>
            names.has(item.name.text)
        )
    );
});
assert.equal(selected.length, names.size, "Vite staging implementation moved");
const code = ts.transpileModule(
    selected.map((node) => node.getText(config)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
// This suite isolates copying/privacy filters; actual native modernization and
// byte/typography gates are exercised in test_native_runtime.cjs.
const context = vm.createContext({
    ...fs,
    ...path,
    console: { log() {} },
    isRetiredRuntimeScript: require("../scripts/runtime-assets.cjs")
        .isRetiredRuntimeScript,
    stageNativeRuntime() {},
});
vm.runInContext(code, context);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-staging-test-"));
function write(name, data = name) {
    const file = path.join(fixture, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
}
function exists(name) {
    return fs.existsSync(path.join(fixture, name));
}
try {
    const demoFiles = [
        "pattern.mp4",
        "pattern.m3u8",
        ...Array.from({ length: 12 }, (_, i) => `pattern${i}.ts`),
    ];
    for (const name of demoFiles) write("src/demo/" + name);
    write("src/demo/private-recording.mp4");
    write("src/demo/debug.ts");
    write("src/demo/logs/private.json");
    for (const name of [
        "src/stb/lg/webos.js",
        "src/stb/core.js",
        "src/stb/tizen/config.json",
        "src/stb/logs/pre_tool_use.json",
        "src/stb/lg/.private/file.json",
        "src/stb/lg/node_modules/dependency.js",
        "src/stb/lg/build/source.js",
        "src/stb/lg/.env",
        "src/stb/lg/private.key",
        "src/fonts/player.woff2",
        "src/fonts/logs/debug.json",
        "src/prov/provider.js",
        "src/prov/about.html",
        "src/prov/get_about.sh",
        "src/prov/.hidden.json",
        "src/stbPlayer/1280.css",
        "src/stbPlayer/_eng.js",
        "src/stbPlayer/_rus.js",
        "src/stbPlayer/icon.png",
        "src/stbPlayer/mute.png",
        "src/stbPlayer/beta.png",
        "src/stbPlayer/blue_short.png",
        "src/stbPlayer/no_image.png",
        "src/stbPlayer/future-unused-art.png",
        "src/stbPlayer/logo.png",
        "src/stbPlayer/debug.js",
        "src/stbPlayer/logs/private.json",
        "src/stbPlayer/.hidden.png",
        "src/js/hls.min.js",
        "src/js/jquery-1.11.1.min.js",
        "src/js/shaka-player.compiled.js",
        "src/js/browser-app/manifest.webmanifest",
        "src/js/browser-app/index.webmanifest",
        "src/js/browser-app/pc.webmanifest",
        "src/js/browser-app/pc-plain.webmanifest",
        "src/js/browser-app/icon-512.png",
        "src/favicon.ico",
        "src/src-tauri/pip/pip.html",
        "src/src-tauri/pip/pip-player.js",
        "dist/index.html",
        "dist/stbPlayer.js",
        "stage/stb/logs/previous-build.json",
    ])
        write(name);
    write(
        "src/build/core/auto-playback.js",
        "export function watchAutoNativePlayback() { return 'same shared helper'; }\n"
    );
    context.stageTauriFrontend(
        path.join(fixture, "src"),
        path.join(fixture, "dist"),
        path.join(fixture, "stage")
    );
    for (const name of [
        "stb/lg/webos.js",
        "stb/tizen/config.json",
        "fonts/player.woff2",
        "prov/provider.js",
        "prov/about.html",
        "stbPlayer/1280.css",
        "stbPlayer/_eng.js",
        "stbPlayer/_rus.js",
        "stbPlayer/icon.png",
        "js/hls.min.js",
        "js/jquery-1.11.1.min.js",
        "js/shaka-player.compiled.js",
        "favicon.ico",
    ]) {
        assert.equal(
            fs.readFileSync(path.join(fixture, "stage", name), "utf8"),
            fs.readFileSync(path.join(fixture, "src", name), "utf8"),
            name
        );
    }
    for (const name of ["pip.html", "pip-player.js"]) {
        assert.equal(
            fs.readFileSync(path.join(fixture, "stage", name), "utf8"),
            fs.readFileSync(
                path.join(fixture, "src/src-tauri/pip", name),
                "utf8"
            ),
            "PiP runtime asset must be embedded: " + name
        );
    }
    assert.equal(
        fs.readFileSync(path.join(fixture, "stage/auto-playback.js"), "utf8"),
        "function watchAutoNativePlayback() { return 'same shared helper'; }\n",
        "PiP loads the compiled shared watchdog as a classic script"
    );
    assert.equal(
        exists("stage/demo"),
        false,
        "Remote demo media must not enter native bundles"
    );
    for (const name of [
        "stb/core.js",
        "stb/logs",
        "stb/lg/.private",
        "stb/lg/node_modules",
        "stb/lg/build",
        "stb/lg/.env",
        "stb/lg/private.key",
        "fonts/logs",
        "prov/get_about.sh",
        "prov/.hidden.json",
        "stbPlayer/.hidden.png",
        "stbPlayer/mute.png",
        "stbPlayer/beta.png",
        "stbPlayer/blue_short.png",
        "stbPlayer/no_image.png",
        "stbPlayer/future-unused-art.png",
        "stbPlayer/logo.png",
        "stbPlayer/debug.js",
        "stbPlayer/logs",
        "js/browser-app",
    ])
        assert.equal(exists(`stage/${name}`), false, name);
    assert.equal(exists("src/stb/logs/pre_tool_use.json"), true);
    assert.equal(
        fs.readFileSync(path.join(fixture, "stage/index.html"), "utf8"),
        "dist/index.html"
    );
    assert.equal(
        fs.readFileSync(path.join(fixture, "stage/dist/stbPlayer.js"), "utf8"),
        "dist/stbPlayer.js"
    );

    // Capacitor retains its dist root between builds; copying a tree must
    // remove already staged private/stale files, not merely filter new copies.
    write("cap/stb/logs/old.json");
    write("cap/stb/removed-adapter.js");
    context.copyRuntimeAssets(
        path.join(fixture, "src/stb"),
        path.join(fixture, "cap/stb")
    );
    assert.equal(exists("cap/stb/logs"), false);
    assert.equal(exists("cap/stb/removed-adapter.js"), false);
    assert.equal(exists("cap/stb/lg/webos.js"), true);

    // Browser installations need the complete manifest tree in production;
    // native distributions must also retire browser artwork from old output.
    context.copyRuntimeAssets(
        path.join(fixture, "src/js"),
        path.join(fixture, "browser/js")
    );
    for (const name of [
        "manifest.webmanifest",
        "index.webmanifest",
        "pc.webmanifest",
        "pc-plain.webmanifest",
        "icon-512.png",
    ])
        assert.equal(
            fs.readFileSync(
                path.join(fixture, "browser/js/browser-app", name),
                "utf8"
            ),
            fs.readFileSync(
                path.join(fixture, "src/js/browser-app", name),
                "utf8"
            ),
            "Browser installation asset: " + name
        );
    context.copyRuntimeAssets(
        path.join(fixture, "src/js"),
        path.join(fixture, "browser/js"),
        false
    );
    assert.equal(
        exists("browser/js/browser-app"),
        false,
        "Native staging removes browser manifests and inherited icon artwork"
    );
    assert.equal(exists("browser/js/hls.min.js"), true);
    assert.equal(exists("src/js/browser-app/icon-512.png"), true);

    // A persistent Capacitor output can contain old permitted-looking files as
    // well as old artwork. Restage real files; do not merely skip future copies.
    write("cap/stbPlayer/icon.png", "stale icon");
    write("cap/stbPlayer/1280.css", "stale CSS");
    write("cap/stbPlayer/_removed.js", "stale locale");
    write("cap/stbPlayer/mute.png", "old unused art");
    write("cap/stbPlayer/future-unused-art.png", "old unknown art");
    write("cap/stbPlayer/logs/previous.json");
    write("cap/stbPlayer/.private/previous.json");
    context.stagePlayerAssets(
        path.join(fixture, "src/stbPlayer"),
        path.join(fixture, "cap/stbPlayer")
    );
    assert.deepEqual(
        fs.readdirSync(path.join(fixture, "cap/stbPlayer")).sort(),
        fs.readdirSync(path.join(fixture, "stage/stbPlayer")).sort(),
        "Capacitor restaging and the full Tauri staging produce the same player assets"
    );
    for (const name of ["icon.png", "1280.css", "_eng.js", "_rus.js"])
        assert.equal(
            fs.readFileSync(path.join(fixture, "cap/stbPlayer", name), "utf8"),
            fs.readFileSync(path.join(fixture, "src/stbPlayer", name), "utf8"),
            "fresh player runtime bytes: " + name
        );
    for (const name of [
        "_removed.js",
        "mute.png",
        "future-unused-art.png",
        "logs",
        ".private",
    ])
        assert.equal(
            exists("cap/stbPlayer/" + name),
            false,
            "retired output: " + name
        );

    // Switching a previously staged Full directory to Play must retire the
    // startup image even while it remains available in the source tree.
    context.stagePlayerAssets(
        path.join(fixture, "src/stbPlayer"),
        path.join(fixture, "cap/stbPlayer"),
        "play"
    );
    assert.equal(
        exists("cap/stbPlayer/icon.png"),
        false,
        "Play removes the stale Full startup image"
    );
    assert.equal(
        exists("src/stbPlayer/icon.png"),
        true,
        "Play staging preserves the Full source image"
    );
    assert.deepEqual(
        fs
            .readdirSync(path.join(fixture, "cap/stbPlayer"))
            .filter((name) => /\.(png|gif|jpe?g|webp|svg)$/i.test(name)),
        [],
        "Play stages no startup artwork"
    );
    for (const name of ["1280.css", "_eng.js", "_rus.js"])
        assert.equal(
            fs.readFileSync(path.join(fixture, "cap/stbPlayer", name), "utf8"),
            fs.readFileSync(
                path.join(fixture, "stage/stbPlayer", name),
                "utf8"
            ),
            "Play keeps required CSS and locale bytes: " + name
        );

    // Locales are discovered from current inputs, not a hard-coded language
    // list. Removing a previously staged locale must remove it from the output.
    fs.unlinkSync(path.join(fixture, "src/stbPlayer/_rus.js"));
    write("src/stbPlayer/_new-locale.js", "new locale bytes");
    context.stagePlayerAssets(
        path.join(fixture, "src/stbPlayer"),
        path.join(fixture, "cap/stbPlayer")
    );
    assert.equal(exists("cap/stbPlayer/_rus.js"), false);
    assert.equal(
        fs.readFileSync(
            path.join(fixture, "cap/stbPlayer/_new-locale.js"),
            "utf8"
        ),
        "new locale bytes"
    );
    assert.equal(
        exists("src/stbPlayer/future-unused-art.png"),
        true,
        "staging leaves source artwork intact"
    );

    // A similarly named image and a previous output icon cannot substitute for
    // the actual startup icon. Missing required input must stop packaging.
    write("missing-icon/1280.css");
    write("missing-icon/_eng.js");
    write("missing-icon/logo.png");
    write("missing-icon-output/icon.png", "previous successful build");
    assert.throws(
        () =>
            context.stagePlayerAssets(
                path.join(fixture, "missing-icon"),
                path.join(fixture, "missing-icon-output")
            ),
        /Missing player runtime asset: icon\.png/
    );
    assert.equal(exists("missing-icon-output/icon.png"), false);
    assert.equal(exists("missing-icon-output/logo.png"), false);

    // The same source that is invalid for Full is sufficient for Play: its
    // startup does not request an icon. Old output must not supply a hidden one.
    write("missing-icon-play/icon.png", "stale Full image");
    context.stagePlayerAssets(
        path.join(fixture, "missing-icon"),
        path.join(fixture, "missing-icon-play"),
        "play"
    );
    assert.equal(exists("missing-icon-play/icon.png"), false);
    assert.equal(exists("missing-icon-play/logo.png"), false);
    assert.equal(
        fs.readFileSync(
            path.join(fixture, "missing-icon-play/1280.css"),
            "utf8"
        ),
        "missing-icon/1280.css"
    );
    assert.equal(
        fs.readFileSync(
            path.join(fixture, "missing-icon-play/_eng.js"),
            "utf8"
        ),
        "missing-icon/_eng.js"
    );
    write("missing-css/_eng.js");
    assert.throws(
        () =>
            context.stagePlayerAssets(
                path.join(fixture, "missing-css"),
                path.join(fixture, "missing-css-play"),
                "play"
            ),
        /Missing player runtime asset: 1280\.css/
    );

    // Both required assets and discovered locales must still pass through the
    // shared symlink guard instead of exposing a file outside the asset tree.
    write("outside-player.js", "private fixture");
    for (const linkedAsset of ["icon.png", "_external.js"]) {
        const source = "player-link-" + linkedAsset;
        write(source + "/1280.css");
        if (linkedAsset !== "icon.png") write(source + "/icon.png");
        fs.symlinkSync(
            path.join(fixture, "outside-player.js"),
            path.join(fixture, source, linkedAsset)
        );
        assert.throws(
            () =>
                context.stagePlayerAssets(
                    path.join(fixture, source),
                    path.join(fixture, source + "-output")
                ),
            /must not be a symlink/
        );
        assert.equal(exists(source + "-output/" + linkedAsset), false);
    }

    write("outside.json", "private fixture");
    fs.symlinkSync(
        path.join(fixture, "outside.json"),
        path.join(fixture, "src/stb/public.json")
    );
    assert.throws(
        () =>
            context.copyRuntimeAssets(
                path.join(fixture, "src/stb"),
                path.join(fixture, "rejected")
            ),
        /must not be a symlink/
    );
    assert.equal(exists("rejected/public.json"), false);
    console.log(
        "Frontend staging: Full icon required, Play icon retired; browser manifests preserved and native browser artwork excluded; CSS/locales preserved; unused/private/stale assets excluded; required assets and symlinks guarded"
    );
} finally {
    fs.rmSync(fixture, { force: true, recursive: true });
}

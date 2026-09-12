import { parse } from "acorn";
import { execSync } from "child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { minify } from "terser";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Same module order as build-concat.cjs
const MODULES = [
    "build/polyfills/index.js",
    "build/utils/lzstring.js",
    "build/storage/index.js",
    "build/localization/index.js",
    "build/settings/cloud.js",
    "build/settings/index.js",
    "build/utils/helpers.js",
    "build/utils/encoding.js",
    "build/utils/qrcode.js",
    "build/channels/types.js",
    "build/channels/favorites-lists.js",
    "build/channels/search.js",
    "build/channels/index.js",
    "build/debug/playback-debug.js",
    "build/core/index.js",
    "build/swop/index.js",
    "build/ui/index.js",
    "build/keyhandler/index.js",
    "build/provider/index.js",
    "build/commands/index.js",
    "build/app/init.js",
    "build/app/device.js",
    "build/settings/sleepTimer.js",
    "build/plugins/native-bridge.js",
    "build/plugins/mobile-native-media.js",
    "build/plugins/dash-exo-player.js",
    "build/plugins/m3u-proxy.js",
    "build/plugins/stalker-portal.js",
    "build/index.js",
];

// Strip ES module syntax — same logic as build-concat.cjs
const EXPORT_BRACE_RE = /^export\s*\{[^}]*\};?\s*$/;
const EXPORT_RE = /^(\s*)export\s+/;

function stripModule(code: string): string {
    return code
        .split("\n")
        .filter((line) => !line.trim().startsWith("import "))
        .map((line) => {
            const t = line.trim();
            if (t.startsWith("export ")) {
                if (EXPORT_BRACE_RE.test(t)) return "// " + line;
                return line.replace(EXPORT_RE, "$1");
            }
            return line;
        })
        .join("\n");
}

// Stage a Mode A-like web root for Tauri Mode B (frontendDist).
// Boot resolves host + "/dist/stbPlayer.js", "/stb/...", "/fonts/...", etc.
// Vite still writes Mode A artifacts to dist/ (stbPlayer.js + index.html);
// Tauri serves the *contents* of frontendDist as "/", so we nest
// dist/stbPlayer.js inside the stage dir instead of pointing at ../dist.
// Capacitor webDir "dist" gets the same nested path via dist/dist/stbPlayer.js
// (written in generateBundle) so Cap keeps the identical boot URL contract.
function stageTauriFrontend(
    srcRoot: string,
    distDir: string,
    stageDir: string
): void {
    rmSync(stageDir, { force: true, recursive: true });
    mkdirSync(stageDir, { recursive: true });

    // index.html at web root (version already substituted in dist/)
    const indexSrc = join(distDir, "index.html");
    if (existsSync(indexSrc)) {
        cpSync(indexSrc, join(stageDir, "index.html"));
    }

    // Nested dist/stbPlayer.js so /dist/stbPlayer.js resolves
    const bundleSrc = join(distDir, "stbPlayer.js");
    if (existsSync(bundleSrc)) {
        mkdirSync(join(stageDir, "dist"), { recursive: true });
        cpSync(bundleSrc, join(stageDir, "dist", "stbPlayer.js"));
    }

    // stb/<vendor>/stb.js
    const stbDir = join(srcRoot, "stb");
    if (existsSync(stbDir)) {
        const vendors = readdirSync(stbDir, { withFileTypes: true })
            .filter((dent) => dent.isDirectory())
            .map((dent) => dent.name);
        for (const vendor of vendors) {
            const srcFile = join(stbDir, vendor, "stb.js");
            if (existsSync(srcFile)) {
                const destDir = join(stageDir, "stb", vendor);
                mkdirSync(destDir, { recursive: true });
                cpSync(srcFile, join(destDir, "stb.js"));
            }
        }
    }

    // stbPlayer: CSS, images, language packs (_*.js)
    const stbPlayerSrc = join(srcRoot, "stbPlayer");
    if (existsSync(stbPlayerSrc)) {
        const dest = join(stageDir, "stbPlayer");
        mkdirSync(dest, { recursive: true });
        for (const file of readdirSync(stbPlayerSrc)) {
            if (
                file === "1280.css" ||
                /^_.*\.js$/i.test(file) ||
                /\.(png|gif|ico|jpg|jpeg)$/i.test(file)
            ) {
                cpSync(join(stbPlayerSrc, file), join(dest, file));
            }
        }
    }

    // js player libs
    const jsSrc = join(srcRoot, "js");
    if (existsSync(jsSrc)) {
        const jsDest = join(stageDir, "js");
        mkdirSync(jsDest, { recursive: true });
        for (const file of [
            "hls.min.js",
            "jquery-1.11.1.min.js",
            "shaka-player.compiled.js",
        ]) {
            const srcFile = join(jsSrc, file);
            if (existsSync(srcFile)) {
                cpSync(srcFile, join(jsDest, file));
            }
        }
    }

    // fonts/ + prov/ (full trees used at runtime)
    for (const dir of ["fonts", "prov"] as const) {
        const src = join(srcRoot, dir);
        if (existsSync(src)) {
            cpSync(src, join(stageDir, dir), { recursive: true });
        }
    }

    const faviconSrc = join(srcRoot, "favicon.ico");
    if (existsSync(faviconSrc)) {
        cpSync(faviconSrc, join(stageDir, "favicon.ico"));
    }

    console.log("Staged Tauri frontend at", stageDir);
}

// Vite wrapper: run tsc → concatenate (same as build-concat.cjs) → minify with terser.
// Vite's role is orchestration — Rollup's bundler is not used because the
// rewrite build needs ES module syntax stripped to expose ~130 window globals.
export default defineConfig({
    appType: "custom",
    build: {
        emptyOutDir: false,
        outDir: "dist",
        rollupOptions: {
            // Use src/index.ts as placeholder entry (exists, compiles OK).
            // generateBundle() overwrites dist/stbPlayer.js anyway.
            input: resolve(__dirname, "src/index.ts"),
        },
        write: false,
    },
    plugins: [
        {
            apply: "build",
            enforce: "post",
            async generateBundle() {
                // Step 1: tsc compile (produces build/*.js)
                console.log("Step 1: tsc compile...");
                execSync("npx tsc", { cwd: __dirname, stdio: "inherit" });

                // Step 2: concatenate with stripModule
                console.log("Step 2: concatenate...");
                const outDir = resolve(__dirname, "dist");
                mkdirSync(outDir, { recursive: true });

                let bundle = "";
                for (const mod of MODULES) {
                    const full = join(__dirname, mod);
                    if (!existsSync(full)) {
                        throw new Error("Required bundle module missing: " + mod);
                    }
                    bundle += stripModule(readFileSync(full, "utf8")) + "\n";
                }

                const pkg = JSON.parse(readFileSync("package.json", "utf8"));
                const version = pkg.version || "local";
                bundle = bundle.replace(/__OTTP_VERSION__/g, version);

                const outPath = join(outDir, "stbPlayer.js");
                writeFileSync(outPath, bundle);
                console.log(
                    "Concatenated: dist/stbPlayer.js (" +
                        bundle.length +
                        " bytes)"
                );

                // Step 3: minify with terser (same options as rewrite)
                console.log("Step 3: minify with terser...");
                const result = await minify(bundle, {
                    ecma: 5,
                    compress: { defaults: false },
                    mangle: false,
                    module: false,
                    output: { comments: false },
                });
                if (result.error) throw result.error;
                // Parsing the final output catches syntax that minification cannot downlevel.
                parse(result.code, { ecmaVersion: 5, sourceType: "script" });
                writeFileSync(outPath, result.code);
                console.log(
                    "Minified: dist/stbPlayer.js (" +
                        result.code.length +
                        " bytes)"
                );

                // Copy index.html with version substituted
                const indexSrc = resolve(__dirname, "index.html");
                if (existsSync(indexSrc)) {
                    const html = readFileSync(indexSrc, "utf8").replace(
                        /__OTTP_VERSION__/g,
                        version
                    );
                    writeFileSync(join(outDir, "index.html"), html);
                    console.log(
                        "Wrote dist/index.html with version=" + version
                    );
                }

                // Cap webDir is "dist" (contents served as "/"). Boot still
                // loads host+"/dist/stbPlayer.js" (Mode A / Tauri contract), so
                // nest a copy at dist/dist/stbPlayer.js for Capacitor.
                mkdirSync(join(outDir, "dist"), { recursive: true });
                cpSync(outPath, join(outDir, "dist", "stbPlayer.js"));
                console.log("Nested Cap contract: dist/dist/stbPlayer.js");

                // Cap webDir lacks Tauri stage's fonts/prov — copy for CSS @font-face.
                for (const dir of ["fonts", "prov"] as const) {
                    const src = join(__dirname, dir);
                    if (existsSync(src)) {
                        cpSync(src, join(outDir, dir), { recursive: true });
                    }
                }

                // Cap webDir must also ship stbPlayer language packs (_*.js) +
                // CSS/images. Previously only stageTauriFrontend got them, so
                // Cap iOS loaded /stbPlayer/_eng.js → 404 → "lang loading fail".
                const stbPlayerSrc = join(__dirname, "stbPlayer");
                if (existsSync(stbPlayerSrc)) {
                    const dest = join(outDir, "stbPlayer");
                    mkdirSync(dest, { recursive: true });
                    for (const file of readdirSync(stbPlayerSrc)) {
                        if (
                            file === "1280.css" ||
                            /^_.*\.js$/i.test(file) ||
                            /\.(png|gif|ico|jpg|jpeg)$/i.test(file)
                        ) {
                            cpSync(join(stbPlayerSrc, file), join(dest, file));
                        }
                    }
                    console.log(
                        "Copied Cap stbPlayer assets → dist/stbPlayer/"
                    );
                }

                // Stage Mode A-like tree for Tauri Mode B (src-tauri/frontend).
                // Mode A companion still serves dist/stbPlayer.js + repo-root
                // stb/fonts/prov/js — URL shapes unchanged.
                stageTauriFrontend(
                    __dirname,
                    outDir,
                    resolve(__dirname, "src-tauri/frontend")
                );
            },
            name: "vite-concat-pipeline",
        },
    ],
    root: ".",
});

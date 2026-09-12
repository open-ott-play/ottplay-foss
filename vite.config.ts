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
import { assembleClassic, CLASSIC_MODULES } from "./scripts/classic-bundle.cjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

    // Preserve nested vendor paths (lg/webos, samsung/tizen, etc.).
    const stbDir = join(srcRoot, "stb");
    if (existsSync(stbDir)) {
        cpSync(stbDir, join(stageDir, "stb"), { recursive: true });
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

// Vite wrapper: compile, link the classic global ABI, then minify as ES5.
// Vite's role is orchestration — Rollup's bundler is not used because the
// device/provider scripts still use the published classic globals.
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

                let bundle = assembleClassic(__dirname, CLASSIC_MODULES);

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
                    compress: { defaults: false },
                    ecma: 5,
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

                // Ship the same local device and library fallbacks in Capacitor as on the web.
                for (const dir of ["fonts", "prov", "stb", "js"] as const) {
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
                // All build entry points (including mobile/cap:copy) enforce ES5.
                execSync("node scripts/check-es5.cjs", {
                    cwd: __dirname,
                    stdio: "inherit",
                });
            },
            name: "vite-concat-pipeline",
        },
    ],
    root: ".",
});

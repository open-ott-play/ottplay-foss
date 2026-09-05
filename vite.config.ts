import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
    "build/settings/index.js",
    "build/utils/helpers.js",
    "build/utils/encoding.js",
    "build/channels/types.js",
    "build/channels/index.js",
    "build/debug/playback-debug.js",
    "build/core/index.js",
    "build/ui/index.js",
    "build/keyhandler/index.js",
    "build/provider/index.js",
    "build/commands/index.js",
    "build/app/init.js",
    "build/app/device.js",
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

// Vite wrapper: run tsc → concatenate (same as build-concat.cjs) → minify with terser.
// Vite's role is orchestration — Rollup's bundler is not used because the
// legacy build needs ES module syntax stripped to expose ~130 window globals.
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
                        console.warn("WARN:", mod, "not found");
                        continue;
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

                // Step 3: minify with terser (same options as legacy)
                console.log("Step 3: minify with terser...");
                const result = await minify(bundle, {
                    compress: { defaults: false },
                    mangle: false,
                    module: false,
                    output: { comments: false },
                });
                if (result.error) throw result.error;
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
            },
            name: "vite-concat-pipeline",
        },
    ],
    root: ".",
});

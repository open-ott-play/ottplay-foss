#!/usr/bin/env node
// Parse every shared browser/STB asset with an ES5 grammar, including boot HTML.
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const { inlineScripts } = require("./html-scripts.cjs");
const { auditNativeRuntime } = require("./native-runtime.cjs");
const root = path.resolve(__dirname, "..");
let checked = 0;
const failures = [];
function check(code, name) {
    try {
        parse(code, { ecmaVersion: 5, sourceType: "script" });
        checked++;
    } catch (error) {
        failures.push(name + ": " + error.message);
    }
}
function tree(directory) {
    for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name);
        if (fs.statSync(file).isDirectory()) tree(file);
        else if (file.endsWith(".js"))
            check(fs.readFileSync(file, "utf8"), path.relative(root, file));
    }
}
const bundle = path.join(root, "dist/stbPlayer.js");
if (!fs.existsSync(bundle)) {
    console.error("Missing dist/stbPlayer.js; run the build first.");
    process.exit(1);
}
// The server and its clients retain ES5. Native engines use independently
// pinned current libraries and must not be compared with legacy vendor bytes.
for (const directory of ["dist"]) tree(path.join(root, directory));
for (const directory of ["stb", "prov", "js", "stbPlayer"])
    tree(path.join(root, directory));
for (const html of ["index.html", "dist/index.html"]) {
    const text = fs.readFileSync(path.join(root, html), "utf8");
    let number = 0;
    for (const script of inlineScripts(text)) {
        if (script.trim()) check(script, html + " inline script " + ++number);
    }
}
// A successful syntax check must not hide missing or stale packaged fallbacks.
function checkCopies(directory) {
    for (const name of fs.readdirSync(path.join(root, directory))) {
        const relative = path.join(directory, name);
        const source = path.join(root, relative);
        if (fs.statSync(source).isDirectory()) checkCopies(relative);
        else if (name.endsWith(".js")) {
            for (const stage of ["dist"]) {
                const target = path.join(root, stage, relative);
                if (
                    !fs.existsSync(target) ||
                    !fs.readFileSync(source).equals(fs.readFileSync(target))
                ) {
                    failures.push(
                        stage +
                            "/" +
                            relative +
                            ": missing or stale staged script"
                    );
                }
            }
        }
    }
}
for (const directory of ["stb", "js", "prov"]) checkCopies(directory);
const serverOnly = process.argv.includes("--server-only");
if (!serverOnly) {
    for (const directory of ["dist-mobile", "src-tauri/frontend"])
        auditNativeRuntime(path.join(root, directory));
}
if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log(
    "OK: ES5 grammar for " +
        checked +
        " legacy player/device/provider/library/boot scripts" +
        (serverOnly ? " (server only)" : "; native runtime manifests verified")
);

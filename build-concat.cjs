#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Terser = require("terser");

console.log("Step 1: tsc compile...");
execSync("npx tsc", { stdio: "inherit", cwd: __dirname });

const modules = [
  "build/polyfills/index.js",
  "build/utils/lzstring.js",
  "build/storage/index.js",
  "build/localization/index.js",
  "build/settings/index.js",
  "build/utils/helpers.js",
  "build/utils/encoding.js",
  "build/channels/types.js",
  "build/channels/index.js",
  "build/core/index.js",
  "build/ui/index.js",
  "build/keyhandler/index.js",
  "build/provider/index.js",
  "build/commands/index.js",
  "build/index.js",
];

function stripModule(code) {
  return code
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith("import ")) return false;
      return true;
    })
    .map((line) => {
      const t = line.trim();
      if (t.startsWith("export ")) {
        if (/^export\s*\{[^}]*\};?\s*$/.test(t)) return "// " + line;
        return line.replace(/^(\s*)export\s+/, "$1");
      }
      return line;
    })
    .join("\n");
}

console.log("Step 2: concatenate...");
const outDir = path.join(__dirname, "dist");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let bundle = "";
for (const mod of modules) {
  const full = path.join(__dirname, mod);
  if (!fs.existsSync(full)) {
    console.warn("WARN:", mod, "not found");
    continue;
  }
  bundle += stripModule(fs.readFileSync(full, "utf8")) + "\n";
}

const outFile = path.join(outDir, "stbPlayer.js");
fs.writeFileSync(outFile, bundle);
console.log("Build:", outFile, "(" + fs.statSync(outFile).size + " bytes)");

console.log("Step 3: minify with terser...");
Terser.minify(fs.readFileSync(outFile, "utf8"), {
  module: false,
  compress: { defaults: false },
  mangle: false,
  output: { comments: false },
}).then(function (result) {
  if (result.error) throw result.error;
  fs.writeFileSync(outFile, result.code);
  console.log("Minified:", outFile, "(" + result.code.length + " bytes)");
});

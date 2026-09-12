#!/usr/bin/env node
// Package the current classic web build for deployment on non-development PCs/STBs.
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const archiveName = "ottplay-foss-modea.tar.gz";
const archivePath = path.join(dist, archiveName);
const checksumPath = path.join(dist, "ottplay-foss-modea.sha256");

function requirePath(relativePath, directory) {
    const source = path.join(root, relativePath);
    if (!fs.existsSync(source)) {
        throw new Error(
            "Missing " +
                relativePath +
                "; run the production build before packaging."
        );
    }
    const stat = fs.statSync(source);
    if (directory ? !stat.isDirectory() : !stat.isFile()) {
        throw new Error("Unexpected file type: " + relativePath);
    }
    return source;
}

function sha256(file) {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function revision() {
    if (process.env.GITHUB_SHA && process.env.GITHUB_SHA.trim()) {
        return process.env.GITHUB_SHA.trim();
    }
    try {
        return (
            execFileSync("git", ["rev-parse", "HEAD"], {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim() || "unknown"
        );
    } catch (_) {
        return "unknown";
    }
}

let staging;
try {
    const index = requirePath("dist/index.html", false);
    const bundle = requirePath("dist/stbPlayer.js", false);
    const assets = ["favicon.ico", "fonts", "js", "stb", "stbPlayer", "prov"];
    const sources = assets.map((name) =>
        requirePath(name, name !== "favicon.ico")
    );
    const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8")
    );
    staging = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-modea-"));
    const webRoot = path.join(staging, "web");
    fs.mkdirSync(path.join(webRoot, "dist"), { recursive: true });
    fs.copyFileSync(index, path.join(webRoot, "index.html"));
    fs.copyFileSync(bundle, path.join(webRoot, "dist", "stbPlayer.js"));
    assets.forEach((name, i) => {
        fs.cpSync(sources[i], path.join(webRoot, name), {
            preserveTimestamps: true,
            recursive: true,
        });
    });
    const metadata = {
        bundleSha256: sha256(path.join(webRoot, "dist", "stbPlayer.js")),
        revision: revision(),
        version: pkg.version,
    };
    fs.writeFileSync(
        path.join(webRoot, "build-info.json"),
        JSON.stringify(metadata, null, 2) + "\n"
    );

    // Tar only the fresh web root: no Capacitor nested output, server, or native binaries.
    const stagedArchive = path.join(staging, archiveName);
    execFileSync("tar", ["-czf", stagedArchive, "-C", webRoot, "."], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
        stdio: "inherit",
    });
    fs.copyFileSync(stagedArchive, archivePath);
    fs.writeFileSync(
        checksumPath,
        sha256(stagedArchive) + "  " + archiveName + "\n"
    );
    console.log("Packaged " + archivePath);
    console.log("SHA256 " + checksumPath);
} catch (error) {
    console.error("Mode A packaging failed: " + error.message);
    process.exitCode = 1;
} finally {
    if (staging) fs.rmSync(staging, { force: true, recursive: true });
}

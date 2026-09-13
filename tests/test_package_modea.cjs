const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-package-test-"));
try {
    const git = (...args) =>
        execFileSync(
            "git",
            [
                "-c",
                "core.hooksPath=" + path.join(root, "empty-hooks"),
                "-c",
                "commit.gpgSign=false",
                "-c",
                "tag.gpgSign=false",
                ...args,
            ],
            {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            }
        ).trim();
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(
        path.join(__dirname, "../scripts/package-modea.cjs"),
        path.join(root, "scripts/package-modea.cjs")
    );
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ version: "1.2.3" })
    );
    for (const directory of ["fonts", "js", "stb", "stbPlayer", "prov"])
        fs.mkdirSync(path.join(root, "dist", directory), { recursive: true });
    const bundle = "var fixture = true;\n";
    fs.writeFileSync(
        path.join(root, "dist/index.html"),
        "<!doctype html><title>fixture</title>"
    );
    fs.writeFileSync(path.join(root, "dist/stbPlayer.js"), bundle);
    fs.writeFileSync(path.join(root, "dist/favicon.ico"), "icon");
    git("init", "--quiet");
    git("add", ".");
    git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Tagged package"
    );
    const taggedSha = git("rev-parse", "HEAD");
    git("tag", "v1.2.3");
    fs.writeFileSync(
        path.join(root, "event-only.txt"),
        "Dispatch ref differs from package ref"
    );
    git("add", ".");
    git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Event ref"
    );
    const eventSha = git("rev-parse", "HEAD");
    git("checkout", "--quiet", "v1.2.3");
    const packageAndRead = () => {
        execFileSync(process.execPath, ["scripts/package-modea.cjs"], {
            cwd: root,
            env: { ...process.env, GITHUB_SHA: eventSha },
            stdio: "pipe",
        });
        const archive = path.join(
            root,
            "build/packages/ottplay-foss-modea.tar.gz"
        );
        return JSON.parse(
            execFileSync("tar", ["-xOf", archive, "./build-info.json"], {
                encoding: "utf8",
            })
        );
    };
    const metadata = packageAndRead();
    assert.equal(metadata.revision, taggedSha);
    assert.notEqual(metadata.revision, eventSha);
    assert.equal(metadata.version, "1.2.3");
    assert.equal(
        metadata.bundleSha256,
        createHash("sha256").update(bundle).digest("hex")
    );
    fs.rmSync(path.join(root, ".git"), { recursive: true });
    assert.equal(
        packageAndRead().revision,
        "unknown",
        "A source archive must not borrow the workflow event SHA"
    );
    console.log(
        "PASS actual Mode A archive metadata: checked-out tag, bundle hash, no misleading event-SHA fallback"
    );
} finally {
    fs.rmSync(root, { force: true, recursive: true });
}

const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

// The identifier belongs to these compiled bytes, not a later manifest fetch.
// A dirty checkout still gets a useful content identity, but no clean-source claim.
function embedPlayerBuildIdentity(source, root) {
    const buildId =
        "bundle-" + createHash("sha256").update(source).digest("hex");
    let revision = "";
    try {
        const git = (args) =>
            execFileSync("git", args, {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
        const head = git(["rev-parse", "HEAD"]);
        const dirty = git([
            "status",
            "--porcelain",
            "--untracked-files=normal",
        ]);
        if (!dirty && /^[0-9a-f]{40}$/.test(head)) revision = head;
    } catch (_) {
        /* Source archives have no Git metadata. */
    }
    return source
        .replace(/__OTTP_SOURCE_REVISION__/g, revision)
        .replace(/__OTTP_BUILD_ID__/g, buildId);
}

module.exports = { embedPlayerBuildIdentity };

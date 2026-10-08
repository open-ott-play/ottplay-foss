const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

// The identifier belongs to these compiled bytes, not a later manifest fetch.
// A dirty checkout still gets a useful content identity, but no clean-source claim.
function createPlayerBuildIdentity(source, root) {
    const buildId =
        "bundle-" + createHash("sha256").update(source).digest("hex");
    let sourceHead = "";
    let sourceRevision = "";
    try {
        const git = (args) =>
            execFileSync("git", args, {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
        const head = git(["rev-parse", "HEAD"]);
        if (/^[0-9a-f]{40}$/.test(head)) sourceHead = head;
        const dirty = git([
            "status",
            "--porcelain",
            "--untracked-files=normal",
        ]);
        if (!dirty) sourceRevision = sourceHead;
    } catch (_) {
        /* Source archives have no Git metadata. */
    }
    return { buildId, sourceHead, sourceRevision };
}

function applyPlayerBuildIdentity(source, identity) {
    return source
        .replace(/__OTTP_SOURCE_REVISION__/g, identity.sourceRevision)
        .replace(/__OTTP_BUILD_ID__/g, identity.buildId);
}

function embedPlayerBuildIdentity(source, root) {
    return applyPlayerBuildIdentity(
        source,
        createPlayerBuildIdentity(source, root)
    );
}

module.exports = {
    applyPlayerBuildIdentity,
    createPlayerBuildIdentity,
    embedPlayerBuildIdentity,
};

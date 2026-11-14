// Audit before build/test preparation can regenerate the checked-in runtime.
function checkCommittedMedia(audit, output = console) {
    try {
        audit();
        output.log("Committed media runtime matches the locked inputs");
        return 0;
    } catch (error) {
        output.error(error);
        output.error(
            "Committed media audit failed. Run npm ci --ignore-scripts, " +
                "npm run build:media, then npm run check:media. " +
                "Review and commit the generated js assets, manifest, licenses " +
                "and both index.html and src-tauri/pip/pip.html; update " +
                "THIRD-PARTY-NOTICES.md when dependency versions change. " +
                "This check does not regenerate files."
        );
        return 1;
    }
}

module.exports = { checkCommittedMedia };
if (require.main === module) {
    process.exitCode = checkCommittedMedia(() =>
        require("./media-runtime.cjs").auditMediaRuntime()
    );
}

// Pinned official Android decoder used to inspect compiled AAB manifests.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const version = "1.18.3";
// GitHub Releases API: google/bundletool, tag 1.18.3, asset.digest.
const digest =
    "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29";
function ensureBundletool() {
    const directory = path.resolve(__dirname, "../../android/build/tools");
    const jar =
        process.env.BUNDLETOOL_JAR ||
        path.join(directory, "bundletool-all-" + version + ".jar");
    if (!fs.existsSync(jar)) {
        if (process.env.BUNDLETOOL_JAR)
            throw new Error("BUNDLETOOL_JAR does not exist");
        fs.mkdirSync(directory, { recursive: true });
        const temp = fs.mkdtempSync(path.join(directory, "download-"));
        try {
            const downloaded = path.join(temp, "bundletool.jar");
            execFileSync(
                "curl",
                [
                    "--fail",
                    "--location",
                    "--silent",
                    "--show-error",
                    "--retry",
                    "3",
                    "https://github.com/google/bundletool/releases/download/" +
                        version +
                        "/bundletool-all-" +
                        version +
                        ".jar",
                    "--output",
                    downloaded,
                ],
                { stdio: "inherit" }
            );
            verify(downloaded);
            fs.renameSync(downloaded, jar);
        } finally {
            fs.rmSync(temp, { force: true, recursive: true });
        }
    }
    verify(jar);
    return path.resolve(jar);
}
function verify(jar) {
    if (
        createHash("sha256").update(fs.readFileSync(jar)).digest("hex") !==
        digest
    ) {
        throw new Error(
            "Bundletool SHA256 mismatch; require official version " + version
        );
    }
}
module.exports = { ensureBundletool };

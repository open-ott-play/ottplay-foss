const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensureMediaRuntime } = require("../scripts/media-runtime-cache.cjs");

const project = path.resolve(__dirname, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-media-cache-"));
const names = [
    "core-js",
    "hls.js",
    "typescript",
    "rollup",
    "terser",
    "@rollup/plugin-commonjs",
    "@rollup/plugin-node-resolve",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function read(file) {
    return fs.readFileSync(path.join(root, file));
}
function write(file, value) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, value);
}

function createFixture() {
    // Use the actual production auditor against a small independent source tree.
    // Only the expensive compiler is replaced by a deterministic fixture writer.
    write(
        "scripts/media-runtime.cjs",
        fs.readFileSync(path.join(project, "scripts/media-runtime.cjs"))
    );
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.symlinkSync(
        path.dirname(require.resolve("acorn/package.json")),
        path.join(root, "node_modules/acorn"),
        "dir"
    );
    const packages = {};
    for (const name of names) {
        packages["node_modules/" + name] = {
            integrity: "fixture-integrity-" + name,
            version: "1.0.0",
        };
        write(
            "node_modules/" + name + "/package.json",
            JSON.stringify({ name, version: "1.0.0" })
        );
    }
    write("package-lock.json", JSON.stringify({ packages }));
    write("src/polyfills/runtime.ts", "export function fixtureRuntime() {}\n");
    write(
        "node_modules/hls.js/dist/hls.min.js",
        "var Hls = function Hls() {};\n"
    );
    write(
        "node_modules/hls.js/dist/hls.worker.js",
        "self.onmessage = function () {};\n"
    );
    write("node_modules/core-js/LICENSE", "Fixture core-js license\n");
    write("node_modules/hls.js/LICENSE", "Fixture HLS license\n");
    write("LICENSE", "Fixture project license\n");
    write("licenses/android/Apache-2.0.txt", "Fixture Apache license\n");
}

function fixtureBuild() {
    const lock = JSON.parse(read("package-lock.json"));
    const packages = {};
    for (const name of names) {
        const installed = JSON.parse(
            read("node_modules/" + name + "/package.json")
        );
        packages[name] = {
            integrity: lock.packages["node_modules/" + name].integrity,
            version: installed.version,
        };
    }
    const source = {
        builderSha256: sha(read("scripts/media-runtime.cjs")),
        lockfileSha256: sha(read("package-lock.json")),
        packages,
        webPolyfillsSha256: sha(read("src/polyfills/runtime.ts")),
    };
    const runtimeVersion = sha(JSON.stringify(source)).slice(0, 16);
    const runtime =
        "var fixtureRuntimeVersion = " + JSON.stringify(runtimeVersion) + ";\n";
    const outputs = {
        "hls.min.js": read("node_modules/hls.js/dist/hls.min.js"),
        "hls.worker.js": Buffer.concat([
            Buffer.from(
                "/*! OTT-play ES5 worker bootstrap; shared runtime and licenses in js/. */\n" +
                    'importScripts("./runtime-polyfills.js?v=' +
                    runtimeVersion +
                    '");\n' +
                    "if (self.__ottRuntimePolyfillsReady !== true || self.__ottMediaRuntimeVersion !== " +
                    JSON.stringify(runtimeVersion) +
                    ') { throw new Error("OTT-play worker runtime mismatch"); }\n' +
                    "/* Upstream hls.js worker follows unchanged. */\n"
            ),
            read("node_modules/hls.js/dist/hls.worker.js"),
        ]),
        "runtime-polyfills.js": runtime,
    };
    const assets = {};
    for (const [name, value] of Object.entries(outputs)) {
        write("js/" + name, value);
        assets[name] = sha(value);
    }
    write(
        "js/media-runtime.json",
        JSON.stringify({ schema: 1, ...source, assets, runtimeVersion })
    );
    for (const name of ["core-js", "hls.js"])
        write(
            "js/licenses/" + name + "-LICENSE.txt",
            read("node_modules/" + name + "/LICENSE")
        );
    write("js/licenses/project-LICENSE.txt", read("LICENSE"));
    write(
        "js/licenses/Apache-2.0.txt",
        read("licenses/android/Apache-2.0.txt")
    );
    for (const name of ["index.html", "src-tauri/pip/pip.html"])
        write(
            name,
            '<script src="/js/runtime-polyfills.js?v=' +
                runtimeVersion +
                '"></script>'
        );
}

async function main() {
    createFixture();
    fixtureBuild();
    const { auditMediaRuntime } = require(
        path.join(root, "scripts/media-runtime.cjs")
    );
    let audits = 0;
    let builds = 0;
    const dependencies = {
        auditMediaRuntime(directory) {
            audits++;
            assert.equal(directory, root);
            return auditMediaRuntime(directory);
        },
        async buildMediaRuntime() {
            builds++;
            fixtureBuild();
        },
    };
    assert.equal((await ensureMediaRuntime(root)).rebuilt, false);
    const first = await ensureMediaRuntime(root, dependencies);
    const second = await ensureMediaRuntime(root, dependencies);
    assert.equal(first.rebuilt, false);
    assert.deepEqual(first.manifest, second.manifest);
    assert.equal(audits, 2, "Every hit reruns the complete production audit");
    assert.equal(builds, 0, "Valid artifacts are never rebuilt");
    console.log("PASS media cache: complete fresh audit permits reuse");

    async function invalidates(name, mutate) {
        const beforeAudits = audits;
        const beforeBuilds = builds;
        mutate();
        const result = await ensureMediaRuntime(root, dependencies);
        assert.equal(result.rebuilt, true, name);
        assert.equal(builds, beforeBuilds + 1, name + " must rebuild once");
        assert.equal(audits, beforeAudits + 2, name + " must audit the repair");
        assert.deepEqual(result.manifest, auditMediaRuntime(root));
        assert.equal(
            (await ensureMediaRuntime(root, dependencies)).rebuilt,
            false
        );
        console.log("PASS media cache: " + name);
    }
    await invalidates("changed web runtime input", () => {
        write(
            "src/polyfills/runtime.ts",
            "export function changedRuntime() {}\n"
        );
    });
    await invalidates("changed lockfile input", () => {
        write(
            "package-lock.json",
            Buffer.concat([read("package-lock.json"), Buffer.from("\n")])
        );
    });
    await invalidates("changed builder input", () => {
        write(
            "scripts/media-runtime.cjs",
            Buffer.concat([
                read("scripts/media-runtime.cjs"),
                Buffer.from("\n// Fixture input changed.\n"),
            ])
        );
    });
    await invalidates("corrupted runtime bytes", () => {
        write("js/runtime-polyfills.js", "var corrupted = true;\n");
    });
    await invalidates("missing worker", () => {
        fs.unlinkSync(path.join(root, "js/hls.worker.js"));
    });
    function rewriteWorker(rewrite) {
        const worker = rewrite(read("js/hls.worker.js").toString());
        write("js/hls.worker.js", worker);
        const manifest = JSON.parse(read("js/media-runtime.json"));
        manifest.assets["hls.worker.js"] = sha(worker);
        write("js/media-runtime.json", JSON.stringify(manifest));
    }
    // Even a matching asset hash cannot authorize a different loader or upstream
    // suffix. The auditor reconstructs the entire versioned worker recipe.
    await invalidates(
        "worker imports stale runtime despite matching hash",
        () => {
            rewriteWorker((worker) =>
                worker.replace(
                    /runtime-polyfills\.js\?v=[a-f0-9]+/,
                    "runtime-polyfills.js?v=old"
                )
            );
        }
    );
    await invalidates(
        "worker readiness guard removed despite matching hash",
        () => {
            rewriteWorker((worker) =>
                worker.replace(
                    /^if \(self\.__ottRuntimePolyfillsReady[^\n]*\n/m,
                    ""
                )
            );
        }
    );
    await invalidates("worker upstream modified despite matching hash", () => {
        rewriteWorker(
            (worker) => worker + "\nself.extraWorkerBehavior = true;\n"
        );
    });
    await invalidates("changed upstream worker bytes", () => {
        write(
            "node_modules/hls.js/dist/hls.worker.js",
            "self.onmessage = function changedWorker() {};\n"
        );
    });
    await invalidates("changed upstream HLS bytes", () => {
        write(
            "node_modules/hls.js/dist/hls.min.js",
            "var Hls = function ChangedHls() {};\n"
        );
    });
    await invalidates("stale bootstrap version", () => {
        write(
            "index.html",
            '<script src="/js/runtime-polyfills.js?v=old"></script>'
        );
    });
    for (const file of ["index.html", "src-tauri/pip/pip.html"]) {
        await invalidates("missing source entry point " + file, () => {
            fs.unlinkSync(path.join(root, file));
        });
    }
    await invalidates("commented bootstrap is not an executable script", () => {
        write("index.html", "<!--" + read("index.html") + "-->");
    });
    await invalidates(
        "inert template bootstrap cannot satisfy the audit",
        () => {
            write(
                "index.html",
                "<template>" + read("index.html") + "</template>"
            );
        }
    );
    await invalidates("bootstrap must precede other scripts", () => {
        write(
            "index.html",
            "<script>beforeRuntime();</script>" + read("index.html")
        );
    });
    for (const attribute of [
        "async",
        "defer",
        "nomodule",
        'type="module"',
        'type="text/plain"',
    ]) {
        await invalidates("bootstrap must be blocking: " + attribute, () => {
            write(
                "index.html",
                read("index.html")
                    .toString()
                    .replace("<script ", "<script " + attribute + " ")
            );
        });
    }
    await invalidates("missing license", () => {
        fs.unlinkSync(path.join(root, "js/licenses/hls.js-LICENSE.txt"));
    });
    await invalidates("missing manifest", () => {
        fs.unlinkSync(path.join(root, "js/media-runtime.json"));
    });

    write("js/runtime-polyfills.js", "var broken = true;\n");
    const buildError = new Error("Fixture compiler failed");
    await assert.rejects(
        ensureMediaRuntime(root, {
            auditMediaRuntime,
            async buildMediaRuntime() {
                throw buildError;
            },
        }),
        (error) => error === buildError
    );
    await assert.rejects(
        ensureMediaRuntime(root, {
            auditMediaRuntime,
            async buildMediaRuntime() {},
        }),
        /Stale media runtime asset/
    );
    for (const file of ["index.html", "src-tauri/pip/pip.html"]) {
        fixtureBuild();
        fs.unlinkSync(path.join(root, file));
        await assert.rejects(
            ensureMediaRuntime(root, {
                auditMediaRuntime,
                async buildMediaRuntime() {},
            }),
            (error) =>
                error.code === "ENOENT" && error.path === path.join(root, file),
            "A rebuild that leaves " + file + " absent must fail"
        );
    }
    fixtureBuild();
    write("index.html", "<!--" + read("index.html") + "-->");
    await assert.rejects(
        ensureMediaRuntime(root, {
            auditMediaRuntime,
            async buildMediaRuntime() {},
        }),
        /Missing or non-blocking media bootstrap/,
        "A rebuild that leaves an inert bootstrap must fail"
    );
    fixtureBuild();
    fs.unlinkSync(path.join(root, "src/polyfills/runtime.ts"));
    await assert.rejects(ensureMediaRuntime(root, dependencies), /ENOENT/);
    console.log(
        "PASS media cache: build, repaired-audit and missing-input failures propagate"
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        fs.rmSync(root, { force: true, recursive: true });
    });

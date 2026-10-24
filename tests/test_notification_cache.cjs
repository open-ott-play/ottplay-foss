const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { stageOfflineShell } = require("../scripts/offline-shell.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ott-notification-cache-"));
try {
    fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>");
    fs.mkdirSync(path.join(root, "js"));
    fs.writeFileSync(path.join(root, "js", "player.js"), "void 0");
    stageOfflineShell(root);
    const handlers = {};
    let responses = 0;
    const forbidden = () => {
        throw new Error("Private event reached offline cache/network handler");
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(root, "offline-worker.js"), "utf8"),
        {
            caches: { open: forbidden },
            fetch: forbidden,
            Request: forbidden,
            self: {
                addEventListener(type, fn) {
                    handlers[type] = fn;
                },
                location: new URL(
                    "https://player.example/app/offline-worker.js"
                ),
            },
            URL,
        }
    );
    for (const url of [
        "https://player.example/api/notifications/media?id=private&runtime=current",
        "https://player.example/app/proxy/api/notifications/media?id=private",
        "https://controller.example/api/notifications/media?id=private",
        "https://controller.example/proxy/api/notifications/media?id=private&device_id=tv",
    ])
        handlers.fetch({
            request: { method: "GET", mode: "cors", url },
            respondWith() {
                responses++;
            },
        });
    assert.equal(
        responses,
        0,
        "private same/cross-origin media bypasses generated shell worker"
    );
    console.log(
        "PASS notification media is never intercepted or persisted by the shell service worker"
    );
} finally {
    fs.rmSync(root, { force: true, recursive: true });
}

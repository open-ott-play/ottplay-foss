const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = ts.transpileModule(
    fs
        .readFileSync(
            path.join(__dirname, "../src/offline/browser-local-media.ts"),
            "utf8"
        )
        .replace(/^export /gm, ""),
    {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
require("acorn").parse(source, { ecmaVersion: 5 });

function fixture(count, extension = "mp4", brokenIndex = -1, mime) {
    let reads = 0,
        revoked = 0,
        nextUrl = 0;
    const files = Array.from({ length: count }, (_, index) => ({
        getFile: async () => {
            reads++;
            if (index === brokenIndex) {
                const error = new Error("File removed during scan");
                error.name = "NotFoundError";
                throw error;
            }
            return {
                lastModified: 1,
                name: "movie-" + index + "." + extension,
                size: index + 1,
                type:
                    mime || (extension === "mp4" ? "video/mp4" : "text/plain"),
            };
        },
        kind: "file",
        name: "movie-" + index + "." + extension,
    }));
    const folder = {
        getFileHandle: async (name) => files.find((file) => file.name === name),
        kind: "directory",
        name: "Movies",
        queryPermission: async () => "granted",
        values: () => {
            let index = 0;
            return {
                next: async () =>
                    index < files.length
                        ? { done: false, value: files[index++] }
                        : { done: true },
            };
        },
    };
    const saved = [
        { created: 1, handle: folder, id: "source-movies", name: folder.name },
    ];
    const db = {
        transaction: () => {
            const tx = {};
            tx.objectStore = () => ({
                openCursor: () => {
                    const cursor = {};
                    let index = 0;
                    const advance = () =>
                        queueMicrotask(() => {
                            cursor.result =
                                index < saved.length
                                    ? {
                                          continue: advance,
                                          value: saved[index++],
                                      }
                                    : null;
                            cursor.onsuccess();
                            if (!cursor.result) tx.oncomplete();
                        });
                    advance();
                    return cursor;
                },
            });
            return tx;
        },
    };
    const w = {
        addEventListener: () => {},
        indexedDB: {
            open: () => {
                const request = {};
                queueMicrotask(() => {
                    request.result = db;
                    request.onsuccess();
                });
                return request;
            },
        },
        navigator: {},
        setTimeout,
        showDirectoryPicker: () => {},
        URL: {
            createObjectURL: () => "blob:fixture-" + ++nextUrl,
            revokeObjectURL: () => revoked++,
        },
    };
    const context = vm.createContext({
        Array,
        Date,
        Error,
        Number,
        Object,
        Promise,
        RegExp,
        String,
    });
    vm.runInContext(source, context);
    return {
        api: context.installBrowserLocalMedia(w),
        reads: () => reads,
        revoked: () => revoked,
    };
}
(async () => {
    const f = fixture(10000);
    let publications = 0,
        firstReads = 0,
        timerRan = false,
        immutable;
    setTimeout(() => {
        timerRan = true;
    }, 0);
    const full = await f.api.list((snapshot) => {
        publications++;
        assert.equal(snapshot.scanning, true);
        if (!firstReads) {
            firstReads = f.reads();
            immutable = snapshot;
        }
    });
    assert.equal(
        firstReads,
        1,
        "first file is playable before reading the remaining 9,999"
    );
    assert.equal(
        immutable.items.length,
        1,
        "published arrays never grow behind consumers"
    );
    assert.equal(full.items.length, 10000);
    assert.equal(full.scanning, false);
    assert.ok(
        publications >= 150 && publications <= 165,
        "bounded batch publications, not one per file"
    );
    assert.equal(timerRan, true, "large traversals yield to browser tasks");
    const firstUrl = full.items[0].url;
    let preferredFirst;
    const resumed = await f.api.list((snapshot) => {
        preferredFirst ||= snapshot.items[0].id;
    }, "source-movies:movie-9999.mp4");
    assert.equal(
        preferredFirst,
        "source-movies:movie-9999.mp4",
        "saved file resolves directly before traversal"
    );
    assert.equal(new Set(resumed.items.map((item) => item.id)).size, 10000);
    assert.equal(
        resumed.items.find((item) => item.id === full.items[0].id).url,
        firstUrl,
        "unchanged files keep playback URLs"
    );
    const beforeCancel = f.reads();
    const cancelled = await f.api.list(() => false);
    assert.equal(cancelled.cancelled, true);
    assert.equal(
        f.reads() - beforeCancel,
        1,
        "consumer cancellation stops traversal"
    );
    assert.equal(
        f.revoked(),
        0,
        "cancellation never revokes active playback URLs"
    );
    const old = f.api.list();
    const newer = f.api.list();
    assert.equal((await old).cancelled, true, "superseded scan is cancelled");
    assert.equal((await newer).items.length, 10000);
    const text = fixture(10000, "txt");
    let heartbeats = 0;
    assert.equal(
        (
            await text.api.list(() => {
                heartbeats++;
            })
        ).items.length,
        0
    );
    assert.equal(
        text.reads(),
        0,
        "known nonmedia files do not require getFile"
    );
    assert.ok(heartbeats >= 150, "empty batches still publish progress");
    for (const [extension, mime] of [
        ["mkv", "video/x-matroska"],
        ["aac", "audio/aac"],
    ]) {
        const unknown = fixture(1, extension, -1, mime);
        assert.equal(
            (await unknown.api.list()).items.length,
            1,
            "unknown extension retains MIME-based media detection: " + extension
        );
        assert.equal(unknown.reads(), 1);
    }
    const changed = await fixture(10000, "mp4", 17).api.list();
    assert.equal(
        changed.items.length,
        9999,
        "a disappearing file does not hide readable siblings"
    );
    assert.equal(changed.sources[0].available, true);
    let grantFirst;
    await f.api.requestAccess((snapshot) => {
        grantFirst = snapshot.items[0].id;
        return false;
    }, "source-movies:movie-9999.mp4");
    assert.equal(
        grantFirst,
        "source-movies:movie-9999.mp4",
        "permission recovery supports immediate preferred playback"
    );
    console.log(
        "PASS progressive local media: 10,000 entries, early playback, bounded immutable batches, yielding, direct saved-file lookup, stable URLs, cancellation, and nonmedia heartbeats"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

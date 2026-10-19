/** Direct local sources: new entries store handles, never copied media bytes. */
export function installBrowserLocalMedia(w: any): any {
    if (w.__ottBrowserLocalMedia) return w.__ottBrowserLocalMedia;
    var dbPromise: Promise<any> | null = null;
    var urls: any = {};
    var knownSources: any[] = [];
    var scanGeneration = 0;
    var urlApi = w.URL || w.webkitURL;
    var available = !!(w.indexedDB && urlApi && urlApi.createObjectURL);

    function open(): Promise<any> {
        if (!available)
            return Promise.reject(
                new Error("Local media storage is unavailable in this browser")
            );
        if (!dbPromise)
            dbPromise = new Promise(function (resolve, reject) {
                var request = w.indexedDB.open("ott-local-media", 1);
                request.onupgradeneeded = function () {
                    request.result.createObjectStore("files", {
                        keyPath: "id",
                    });
                };
                request.onsuccess = function () {
                    var db = request.result;
                    db.onversionchange = function () {
                        db.close();
                        dbPromise = null;
                    };
                    resolve(db);
                };
                request.onerror = function () {
                    dbPromise = null;
                    reject(new Error("Could not open local media storage"));
                };
                request.onblocked = function () {
                    dbPromise = null;
                    reject(
                        new Error(
                            "Close other player tabs to update local media storage"
                        )
                    );
                };
            });
        return dbPromise;
    }
    function records(): Promise<any[]> {
        return open().then(function (db) {
            return new Promise<any[]>(function (resolve, reject) {
                var result: any[] = [],
                    tx = db.transaction("files", "readonly"),
                    cursor = tx.objectStore("files").openCursor();
                cursor.onsuccess = function () {
                    var c = cursor.result;
                    if (c) {
                        result.push(c.value);
                        c.continue();
                    }
                };
                tx.oncomplete = function () {
                    resolve(
                        result.sort(function (a, b) {
                            return (
                                a.created - b.created ||
                                a.id.localeCompare(b.id)
                            );
                        })
                    );
                };
                tx.onerror = tx.onabort = function () {
                    reject(new Error("Could not read local media sources"));
                };
            });
        });
    }
    function media(file: any): boolean {
        return (
            /^(video|audio)\//i.test(file.type || "") ||
            /\.(mp4|m4v|webm|mp3|m4a|ogg|wav|mov)$/i.test(file.name || "")
        );
    }
    function item(
        id: string,
        file: any,
        name: string,
        sourceId: string,
        live: any
    ): any {
        live[id] = true;
        var signature = file.size + ":" + file.lastModified;
        if (urls[id] && (urls[id] as any).signature !== signature) {
            urlApi.revokeObjectURL((urls[id] as any).url);
            delete urls[id];
        }
        if (!urls[id])
            (urls as any)[id] = {
                signature: signature,
                url: urlApi.createObjectURL(file),
            };
        return {
            access: "granted",
            available: true,
            id: id,
            mime: file.type || "application/octet-stream",
            name: name,
            size: file.size,
            source: sourceId.indexOf("source-") === 0 ? "linked" : "imported",
            sourceId: sourceId,
            url: (urls[id] as any).url,
        };
    }
    // Snapshots are cumulative. A false callback or newer scan cancels traversal;
    // cancelling never prunes URLs that the current player may still be using.
    function list(
        onProgress?: (catalog: any) => boolean | void,
        preferredId?: string
    ): Promise<any> {
        if (typeof onProgress !== "function") onProgress = undefined;
        var generation = ++scanGeneration;
        var items: any[] = [],
            sources: any[] = [],
            live: any = {};
        var scanned = 0,
            published = 0,
            lastPublish = Date.now();
        var stopped = false,
            firstPlayable = false;
        function active(): boolean {
            return !stopped && generation === scanGeneration;
        }
        function catalog(scanning: boolean): any {
            return {
                available: available,
                cancelled: !active(),
                directSources: !!w.showDirectoryPicker,
                items: items.slice(),
                offlineReady: !!(
                    w.navigator.serviceWorker &&
                    w.navigator.serviceWorker.controller &&
                    /\/offline-worker\.js(?:[?#]|$)/.test(
                        w.navigator.serviceWorker.controller.scriptURL
                    )
                ),
                persistent: false,
                scanned: scanned,
                scanning: scanning,
                sources: sources.map(function (source) {
                    return Object.assign({}, source);
                }),
                storage: "browser",
            };
        }
        function progress(force = false): void {
            if (!active() || !onProgress) return;
            if (
                !force &&
                scanned - published < 64 &&
                Date.now() - lastPublish < 100
            )
                return;
            published = scanned;
            lastPublish = Date.now();
            if (onProgress(catalog(true)) === false) stopped = true;
        }
        function add(
            id: string,
            file: any,
            name: string,
            sourceId: string
        ): void {
            if (!active() || live[id]) return;
            items.push(item(id, file, name, sourceId, live));
            if (!firstPlayable) {
                firstPlayable = true;
                progress(true);
            }
        }
        function visit(): Promise<void> {
            scanned++;
            progress();
            return scanned % 64 === 0
                ? new Promise(function (resolve) {
                      w.setTimeout(resolve, 0);
                  })
                : Promise.resolve();
        }
        // Manual async iteration keeps legacy ES5 bundles compatible. Push into
        // one result array instead of copying a growing array for every file.
        function walk(
            handle: any,
            prefix: string,
            sourceId: string
        ): Promise<void> {
            var iterator = handle.values();
            function next(): Promise<void> {
                if (!active()) return Promise.resolve();
                return Promise.resolve(iterator.next()).then(function (step) {
                    if (step.done || !active()) return;
                    var child = step.value,
                        name = prefix + child.name;
                    var work: Promise<any>;
                    if (child.kind === "directory")
                        work = Promise.resolve().then(function () {
                            return walk(child, name + "/", sourceId);
                        });
                    // A known non-media extension cannot become playable by
                    // reading its bytes. Unknown extensions still use MIME.
                    else if (
                        /\.(txt|json|xml|csv|log|md|srt|vtt|jpg|jpeg|png|gif|webp|pdf|zip|rar)$/i.test(
                            child.name
                        )
                    )
                        work = Promise.resolve();
                    else
                        work = Promise.resolve()
                            .then(function () {
                                return child.getFile();
                            })
                            .then(function (file) {
                                if (media(file))
                                    add(
                                        sourceId + ":" + name,
                                        file,
                                        name,
                                        sourceId
                                    );
                            });
                    return work
                        .catch(function (error) {
                            // Files can disappear or have narrower permissions than
                            // their parent. Keep scanning readable siblings.
                            if (
                                !error ||
                                !/^(NotFoundError|NotAllowedError|SecurityError|NotReadableError)$/.test(
                                    error.name
                                )
                            )
                                throw error;
                        })
                        .then(visit)
                        .then(next);
                });
            }
            return next();
        }
        function preferred(record: any): Promise<void> {
            var prefix = record.id + ":";
            if (
                !preferredId ||
                preferredId.indexOf(prefix) !== 0 ||
                record.handle.kind !== "directory"
            )
                return Promise.resolve();
            var path = preferredId.slice(prefix.length),
                parts = path.split("/");
            if (
                parts.some(function (part) {
                    return !part || part === "." || part === "..";
                })
            )
                return Promise.resolve();
            var handle = Promise.resolve(record.handle);
            parts.slice(0, -1).forEach(function (part) {
                handle = handle.then(function (directory) {
                    return active()
                        ? directory.getDirectoryHandle(part)
                        : Promise.reject();
                });
            });
            return handle
                .then(function (directory) {
                    return directory.getFileHandle(parts[parts.length - 1]);
                })
                .then(function (fileHandle) {
                    return fileHandle.getFile();
                })
                .then(function (file) {
                    if (media(file)) add(preferredId!, file, path, record.id);
                })
                .catch(function () {
                    /* Missing paths fall back to the full scan. */
                });
        }
        if (!available) return Promise.resolve(catalog(false));
        return records()
            .then(function (saved) {
                if (!active()) return;
                knownSources = saved.filter(function (record) {
                    return !!record.handle;
                });
                // Resolve the saved item before enumeration, even in a later source.
                if (preferredId)
                    saved.sort(function (a, b) {
                        return (
                            Number(
                                preferredId === b.id ||
                                    preferredId!.indexOf(b.id + ":") === 0
                            ) -
                            Number(
                                preferredId === a.id ||
                                    preferredId!.indexOf(a.id + ":") === 0
                            )
                        );
                    });
                var chain = Promise.resolve();
                saved.forEach(function (record) {
                    chain = chain.then(function () {
                        if (!active()) return;
                        if (record.blob) {
                            add(record.id, record.blob, record.name, record.id);
                            return visit();
                        }
                        var source = {
                            access: "granted",
                            available: true,
                            id: record.id,
                            kind:
                                record.handle.kind === "directory"
                                    ? "folder"
                                    : "file",
                            name: record.name,
                        };
                        sources.push(source);
                        return Promise.resolve(
                            record.handle.queryPermission({ mode: "read" })
                        )
                            .then(function (access) {
                                if (!active()) return;
                                if (access !== "granted") {
                                    source.access = "permission-required";
                                    return;
                                }
                                if (record.handle.kind === "directory")
                                    return preferred(record).then(function () {
                                        return walk(
                                            record.handle,
                                            "",
                                            record.id
                                        );
                                    });
                                return record.handle
                                    .getFile()
                                    .then(function (file) {
                                        add(
                                            record.id,
                                            file,
                                            file.name,
                                            record.id
                                        );
                                    });
                            })
                            .catch(function (error) {
                                source.access =
                                    error && error.name === "NotAllowedError"
                                        ? "permission-required"
                                        : "missing";
                            })
                            .then(function () {
                                source.available = source.access === "granted";
                                record.access = source.access;
                                if (!source.available && active())
                                    items.push({
                                        access: source.access,
                                        available: false,
                                        id: record.id,
                                        name: record.name,
                                        size: 0,
                                        source: "linked",
                                        sourceId: record.id,
                                        url: "",
                                    });
                                return visit();
                            });
                    });
                });
                return chain;
            })
            .then(function () {
                if (active())
                    Object.keys(urls).forEach(function (id) {
                        if (!live[id]) {
                            urlApi.revokeObjectURL((urls[id] as any).url);
                            delete urls[id];
                        }
                    });
                return catalog(false);
            });
    }
    function save(handles: any[]): Promise<any> {
        return open()
            .then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction("files", "readwrite");
                    handles.forEach(function (handle, index) {
                        tx.objectStore("files").add({
                            created: Date.now(),
                            handle: handle,
                            id:
                                "source-" +
                                Date.now().toString(36) +
                                "-" +
                                index +
                                "-" +
                                Math.random().toString(36).slice(2),
                            name: handle.name,
                        });
                    });
                    tx.oncomplete = function () {
                        resolve(null);
                    };
                    tx.onerror = tx.onabort = function () {
                        reject(
                            new Error("Could not save local source permissions")
                        );
                    };
                });
            })
            .then(list);
    }
    function cancelled(error: any): Promise<any> {
        if (error && error.name === "AbortError") return list();
        return Promise.reject(error);
    }
    function importFiles(files?: any): Promise<any> {
        if (files)
            return Promise.reject(
                new Error(
                    "Direct sources require the file picker; media copying is disabled"
                )
            );
        if (!w.showOpenFilePicker)
            return Promise.reject(
                new Error(
                    "Direct file access is unavailable in this browser. Use Chrome or Edge on desktop, or the Android app."
                )
            );
        return w
            .showOpenFilePicker({
                multiple: true,
                types: [
                    {
                        accept: {
                            "audio/*": [".mp3", ".m4a", ".ogg", ".wav"],
                            "video/*": [".mp4", ".m4v", ".webm", ".mov"],
                        },
                        description: "Video and audio",
                    },
                ],
            })
            .then(function (handles: any[]) {
                return Promise.all(
                    handles.map(function (handle) {
                        return handle.getFile().then(function (file) {
                            if (!media(file))
                                throw new Error(
                                    "Choose supported video or audio files"
                                );
                            return handle;
                        });
                    })
                );
            })
            .then(save)
            .catch(cancelled);
    }
    function importFolder(): Promise<any> {
        if (!w.showDirectoryPicker)
            return Promise.reject(
                new Error(
                    "Direct folder access is unavailable in this browser. Use Chrome or Edge on desktop, or the Android app."
                )
            );
        return w
            .showDirectoryPicker({ mode: "read" })
            .then(function (handle) {
                return save([handle]);
            })
            .catch(cancelled);
    }
    function requestAccess(
        onProgress?: (catalog: any) => boolean | void,
        preferredId?: string
    ): Promise<any> {
        function resume(): Promise<any> {
            return list(onProgress, preferredId);
        }
        // A restored Chrome grant can cover all previously connected handles.
        // Request just one in this click: parallel prompts can consume activation
        // and dismiss each other. list() then observes the grant on every source.
        var pending = knownSources.filter(function (record) {
            return record.access === "permission-required";
        });
        if (!pending.length) return resume();
        try {
            return Promise.resolve(
                pending[0].handle.requestPermission({ mode: "read" })
            ).then(resume, resume);
        } catch (_) {
            return resume();
        }
    }
    function remove(id: string): Promise<any> {
        return open()
            .then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction("files", "readwrite");
                    tx.objectStore("files").delete(id);
                    tx.oncomplete = function () {
                        resolve(null);
                    };
                    tx.onerror = tx.onabort = function () {
                        reject(new Error("Could not remove local media file"));
                    };
                });
            })
            .then(list);
    }
    var api = {
        importFiles: importFiles,
        importFolder: importFolder,
        list: list,
        remove: remove,
        removeSource: remove,
        requestAccess: requestAccess,
    };
    w.__ottBrowserLocalMedia = api;
    w.addEventListener("unload", function () {
        Object.keys(urls).forEach(function (id) {
            urlApi.revokeObjectURL((urls[id] as any).url);
        });
    });
    return api;
}

/** Native shells already bundle their UI. Only HTTPS/localhost web builds install a worker. */
export function installOfflineShell(w: any): Promise<any> {
    if (
        !w.navigator.serviceWorker ||
        !w.isSecureContext ||
        w.Capacitor ||
        w.__TAURI_INTERNALS__
    )
        return Promise.resolve(null);
    if (
        w.location.protocol !== "https:" &&
        !/^localhost$|^127\.0\.0\.1$|^\[::1\]$/.test(w.location.hostname)
    )
        return Promise.resolve(null);
    // Player routes such as /f/pc/ still load the shared assets from the origin root.
    var worker = new w.URL("/offline-worker.js", w.location.href);
    return w.navigator.serviceWorker
        .register(worker.href, { scope: new w.URL("/", worker).href })
        .catch(function () {
            return null;
        });
}

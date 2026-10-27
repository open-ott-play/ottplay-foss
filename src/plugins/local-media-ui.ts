// Private factory keys: a=browser, b=catalogRevision, c=close, d=current, e=failureMessage, f=finishLoading, g=formatLocalMediaProgress, h=getEndpoint, i=http, j=isNative, k=isTauri, l=last, m=list, n=locked, o=native, p=nativeLibrary, q=pendingFileKey, r=playbackSelection, s=remember, t=remoteEndpoint, u=retireRemotePlayback, v=settingsLocked, w=state, x=title, y=updateLoading
// UI state keys: a=handler, b=importedSelection, c=loading, d=nextImportSelection, e=opened, f=owner, g=progressState, h=resuming, i=revision
/** Loaded only when this local-media feature is used. */
function createLocalMediaUi(w: any, p: any): any {
    var browser = p.a,
        close = p.c,
        current = p.d,
        failureMessage = p.e,
        finishLoading = p.f,
        formatLocalMediaProgress = p.g,
        getEndpoint = p.h,
        http = p.i,
        isNative = p.j,
        isTauri = p.k,
        list = p.m,
        locked = p.n,
        native = p.o,
        nativeLibrary = p.p,
        pendingFileKey = p.q,
        playbackSelection = p.r,
        remember = p.s,
        remoteEndpoint = p.t,
        retireRemotePlayback = p.u,
        settingsLocked = p.v,
        state = p.w,
        title = p.x,
        updateLoading = p.y,
        boundedCatalogRequest = p.boundedCatalogRequest;

    // Reuse exact protocol/error strings; no messages or wire values change.
    var localText0 = "pickerCancelled",
        localText1 = "picker-folder",
        localText2 = "permission-required";

    function localField(owner: any, key: string): any {
        return owner == null ? undefined : owner[key];
    }
    function text(value: any): string {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    function playable(): boolean {
        return !!(
            p.l &&
            p.l.items.some(function (item: any) {
                return item.available !== false && !!item.url;
            })
        );
    }
    function activate(): void {
        if (locked()) return;
        if (!playable()) {
            open();
            return;
        }
        var selected = state.b;
        finishLoading();
        state.e = false;
        state.i++;
        if (typeof w.closeList === "function") w.closeList();
        w.stbSetItem("ottplayprov", "offline");
        state.d = selected;
        state.b = "";
        w.loadProv("offline");
    }
    function importFiles(folder = false): Promise<any> {
        if (locked() || settingsLocked())
            return Promise.reject(
                new Error(
                    "Unlock settings and kiosk mode to change local sources"
                )
            );
        function scanImported(result: any): Promise<any> {
            if (request !== p.b)
                return Promise.resolve({
                    cancelled: true,
                    pickerCancelled: true,
                });
            if (result && result.pickerCancelled)
                return Promise.resolve({ pickerCancelled: true });
            playbackSelection.clear();
            var pending = list(
                function (value) {
                    updateLoading(value);
                    return !value.items.some(function (item: any) {
                        return item.available !== false && !!item.url;
                    });
                },
                undefined,
                result && result.sourceIds
            );
            var scanRequest = p.b;
            return pending.then(function (value) {
                if (
                    scanRequest === p.b &&
                    p.l === value &&
                    result &&
                    result.sourceIds
                ) {
                    var item = value.items.filter(function (item: any) {
                        return (
                            result.sourceIds.indexOf(item.sourceId) >= 0 &&
                            item.available !== false &&
                            !!item.url
                        );
                    })[0];
                    state.b = item ? "local-" + item.id : "";
                }
                return value;
            });
        }
        if (nativeLibrary())
            return remember(
                (folder ? native.importFolder() : native.importFiles()).then(
                    function (value: any) {
                        if (!localField(value, localText0))
                            playbackSelection.clear();
                        return value;
                    }
                )
            );
        // A picker may outlive its screen. Its saved handle is still valid, but
        // its completion must not replace a newer catalog or start playback.
        var request = ++p.b;
        state.b = "";
        state.d = "";
        if (isTauri())
            return p
                .tauriInvoke(
                    folder
                        ? "offline_media_import_folder"
                        : "offline_media_import_files",
                    {}
                )
                .then(scanImported);
        if (remoteEndpoint())
            return Promise.reject(
                new Error(
                    "Connect folders on the server itself, or select this device's library."
                )
            );
        state.g = {
            items: [],
            phase: folder ? localText1 : "picker-files",
        };
        return (
            folder
                ? browser.importFolder({ deferScan: true })
                : browser.importFiles(undefined, { deferScan: true })
        ).then(scanImported);
    }
    function removeSource(id: string): Promise<any> {
        if (locked() || settingsLocked())
            return Promise.reject(
                new Error("Unlock settings to disconnect sources")
            );
        function removed(value: any): any {
            if (playbackSelection.clearSource(id)) retireRemotePlayback();
            return value;
        }
        if (nativeLibrary())
            return remember(native.removeSource({ id: id }).then(removed));
        if (isTauri())
            return p
                .tauriInvoke("offline_media_remove_source", {
                    id: id,
                })
                .then(removed)
                .then(function () {
                    return list();
                });
        if (remoteEndpoint())
            return Promise.reject(
                new Error("Manage sources on the server itself.")
            );
        return remember(browser.removeSource(id).then(removed));
    }
    function reconnectSource(id: string): Promise<any> {
        if (locked() || settingsLocked())
            return Promise.reject(
                new Error("Unlock settings to reconnect sources")
            );
        if (isNative() || isTauri() || remoteEndpoint())
            return Promise.reject(
                new Error("Reconnect this folder on the device that owns it.")
            );
        var request = ++p.b;
        state.g = { items: [], phase: localText1 };
        // Invoke the picker synchronously inside the user's Enter/click action.
        return browser.reconnectSource(id).then(function (value: any) {
            if (request !== p.b || localField(value, localText0)) return value;
            if (
                localField(value, "sourceReconnected") &&
                value.requiresReload
            ) {
                // Old native filesystem reads cannot be aborted by JavaScript.
                // A fresh document uses the new handle without pretending that
                // those old reads have drained or freeing their safety budget.
                w.location.reload();
            }
            return value;
        });
    }
    function startWithFile(sourceId: string): void {
        if (locked() || settingsLocked()) return;
        finishLoading();
        state.i++;
        w.editCaption = w._("Start with file");
        w.editvar = "";
        w.setEdit = function () {
            if (!current() || locked() || settingsLocked()) return;
            var path = String(w.editvar || "").trim();
            if (!path) {
                render("Enter a file path relative to this folder.");
                return;
            }
            run(function () {
                var request = ++p.b;
                state.b = "";
                var namespace = w.__ottOfflineProfiles.namespace();
                return browser.bootstrapFile(sourceId, path).then(
                    function (value: any) {
                        if (request !== p.b)
                            return { cancelled: true, items: [] };
                        p.l = value;
                        var item = value.items.filter(function (entry: any) {
                            return entry.available !== false && !!entry.url;
                        })[0];
                        state.b = item ? "local-" + item.id : "";
                        return value;
                    },
                    function (error: any) {
                        if (
                            request === p.b &&
                            current() &&
                            !locked() &&
                            !settingsLocked() &&
                            localField(error, "name") === "TimeoutError" &&
                            namespace === w.__ottOfflineProfiles.namespace()
                        ) {
                            w.stbSetItem(
                                pendingFileKey,
                                JSON.stringify({
                                    id: "local-" + sourceId + ":" + path,
                                    namespace: namespace,
                                })
                            );
                            throw new Error(
                                "The file is remembered. Restart Chrome completely, then reopen the player."
                            );
                        }
                        throw error;
                    }
                );
            }, true);
        };
        w.showEditKey(null);
    }
    function requestAccess(
        onProgress?: (value: any) => boolean | void
    ): Promise<any> {
        if (locked() || settingsLocked())
            return Promise.reject(new Error("Unlock settings to grant access"));
        if (nativeLibrary()) return remember(native.requestAccess());
        if (isTauri()) {
            var missing =
                p.l &&
                (p.l.sources || []).filter(function (source: any) {
                    return !source.available;
                })[0];
            return importFiles(!!missing && missing.kind === "folder");
        }
        if (remoteEndpoint()) return list(onProgress);
        var request = ++p.b;
        return browser
            .requestAccess(
                onProgress
                    ? function (value: any) {
                          if (request !== p.b) return false;
                          p.l = value;
                          return onProgress(value);
                      }
                    : undefined
            )
            .then(function (value: any) {
                if (request === p.b) p.l = value;
                return value;
            });
    }
    function remove(id: string): Promise<any> {
        if (locked())
            return Promise.reject(
                new Error("Unlock kiosk mode to change local files")
            );
        if (settingsLocked())
            return Promise.reject(
                new Error("Unlock settings to change local files")
            );
        if (nativeLibrary()) return remember(native.remove({ id: id }));
        return remember(
            getEndpoint().then(function (base) {
                return base
                    ? http(base + "/" + encodeURIComponent(id), {
                          method: "DELETE",
                      })
                    : browser.remove(id);
            })
        );
    }
    function editServer(): void {
        if (locked() || settingsLocked()) return;
        finishLoading();
        state.i++;
        w.editCaption = w._("Media Library URL");
        w.editvar = remoteEndpoint();
        var originalCatalogue = p.b;
        w.setEdit = function () {
            if (
                !current() ||
                locked() ||
                settingsLocked() ||
                originalCatalogue !== p.b
            )
                return;
            var value = String(w.editvar || "")
                .trim()
                .replace(/\/+$/, "");
            if (value) {
                try {
                    var parsed = new URL(value);
                    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname)
                        throw new Error("Invalid server URL");
                } catch (_) {
                    render("Use a complete HTTP or HTTPS URL.");
                    return;
                }
            }
            w.stbSetItem("localMediaEndpoint", value);
            p.b++;
            run(list);
        };
        w.showEditKey(null);
    }
    function restorePlayback(): void {
        run(function () {
            return requestAccess(function () {
                if (!state.h || !current()) return false;
                if (!playable()) return true;
                activate();
                return false;
            }).then(function (value) {
                if (state.h && current() && playable()) activate();
                return value;
            });
        });
    }
    function render(message?: string): void {
        if (!current()) return;
        if (locked() || settingsLocked()) {
            close();
            return;
        }
        if (localField(p.l, "reconnectRequired") && !isNative() && !isTauri())
            message =
                (message ? message + " " : "") +
                "Reconnect the saved folder to renew its access after a drive or network change.";
        var readOnly = !!(remoteEndpoint() && localField(p.l, "readOnly"));
        var selected = w.selIndex || 0;
        var rows: any[] = [];
        function row(
            id: string,
            name: string,
            description: string,
            action: () => void
        ): void {
            rows.push({
                action: action,
                description: description,
                id: id,
                name: name,
            });
        }
        if (state.h)
            row(
                "resume",
                "Continue playback",
                p.l &&
                    (p.l.sources || []).some(function (source: any) {
                        return source.access === localText2;
                    })
                    ? "Chrome needs permission to read your saved folder again. Choose Allow on every visit in its prompt to resume automatically on later visits. No video files are copied."
                    : "Reconnect the original folder or drive, then continue playback. The saved source and video selection are preserved.",
                restorePlayback
            );
        if (!readOnly) {
            row(
                "add-folder",
                "Add folder",
                !isNative() && !isTauri()
                    ? "Chrome may ask to view and copy files. This grants read access; OTT plays the originals without storing another media copy."
                    : "Play files directly from the selected folder without copying them.",
                function () {
                    run(function () {
                        return importFiles(true);
                    }, !isNative());
                }
            );
            row(
                "add-files",
                "Add files",
                "Play selected files directly without copying them.",
                function () {
                    run(function () {
                        return importFiles();
                    }, !isNative());
                }
            );
        }
        if (
            !readOnly &&
            p.l &&
            (p.l.sources || []).some(function (source: any) {
                return !source.available;
            })
        )
            row(
                "grant-access",
                "Grant access",
                "Allow access to previously connected sources.",
                function () {
                    if (state.h) restorePlayback();
                    else run(requestAccess);
                }
            );
        var profiles = w.__ottOfflineProfiles;
        if (profiles && profiles.current())
            row(
                "bind-profile",
                "Bind loaded profile to connected sources",
                "Explicitly match this profile's source names and saved video to folders connected on this device. Ambiguous or missing sources are rejected.",
                function () {
                    run(function () {
                        return profiles.bindCurrent();
                    });
                }
            );
        row("refresh", "Refresh", "Read connected folders again.", function () {
            run(function () {
                if (readOnly) {
                    var request = ++p.b;
                    var url = new URL(remoteEndpoint());
                    url.searchParams.set("refresh", "true");
                    return boundedCatalogRequest(url.href, 60000).then(
                        function () {
                            return request === p.b
                                ? list()
                                : { cancelled: true, items: [] };
                        }
                    );
                }
                return isTauri()
                    ? getEndpoint(true).then(function () {
                          return list();
                      })
                    : list();
            });
        });
        row(
            "play",
            "Play local videos",
            playable()
                ? "Open the local video channel list."
                : "No playable local videos. Add a folder or grant access to a connected source.",
            function () {
                if (playable()) activate();
            }
        );
        ((p.l && p.l.sources) || []).forEach(function (source: any) {
            if (readOnly) {
                row(
                    "readonly-source",
                    source.name,
                    "Read-only source. Manage folders in the helper configuration.",
                    function () {}
                );
                return;
            }
            if (
                source.kind === "folder" &&
                !isNative() &&
                !isTauri() &&
                !remoteEndpoint() &&
                typeof browser.reconnectSource === "function"
            )
                row(
                    "reconnect-source",
                    "Reconnect: " + source.name,
                    "Choose the same folder again after reconnecting the drive or NAS. The player reloads with renewed access; saved profiles and file references are preserved.",
                    function () {
                        run(function () {
                            return reconnectSource(source.id);
                        });
                    }
                );
            if (
                source.kind === "folder" &&
                !isNative() &&
                !isTauri() &&
                !remoteEndpoint() &&
                typeof browser.bootstrapFile === "function"
            )
                row(
                    "start-with-file",
                    "Start with file…: " + source.name,
                    "Enter a known video path inside this folder, for example Movies/video.mp4. Play it without waiting for the full folder scan; no files are copied.",
                    function () {
                        startWithFile(source.id);
                    }
                );
            row(
                "disconnect-source",
                "Disconnect: " + source.name,
                (source.available
                    ? "Connected. "
                    : source.access === localText2
                      ? "Read permission is needed again; the source is still saved. "
                      : "Source unavailable. ") +
                    "Disconnecting leaves the original files untouched.",
                function () {
                    run(function () {
                        return removeSource(source.id);
                    });
                }
            );
        });
        ((p.l && p.l.items) || []).forEach(function (item: any) {
            if (localField(item.playback, "mode") === "unsupported") {
                row(
                    "unsupported-" + item.id,
                    "Unavailable: " + item.name,
                    "This file needs compatibility playback. Use a compatible native or Server library backend; the original is not uploaded.",
                    function () {}
                );
                return;
            }
            if (readOnly || item.source === "linked") return;
            row(
                "remove-copy",
                "Remove copy: " + item.name,
                "Remove this previously imported copy from the library.",
                function () {
                    run(function () {
                        return remove(item.id);
                    });
                }
            );
        });
        if (!isTauri())
            row(
                "server-library",
                "Server library…",
                remoteEndpoint()
                    ? "A server library is selected. Clear its URL to use files on this device."
                    : "Optional: use compatible playback from your Server library without uploading originals. Network access is required.",
                editServer
            );
        row("close", "Close", "Return to player settings.", close);
        w.listArray = rows;
        w.listDataArray = rows;
        w.selIndex = Math.min(selected, rows.length - 1);
        w.getListItem = function (item: any) {
            return (
                '&nbsp;&nbsp;<span data-local-media-action="' +
                item.id +
                '">' +
                text(w._ ? w._(item.name) : item.name) +
                "</span>"
            );
        };
        w.detailListAction = function () {
            var item = rows[w.selIndex];
            w.listDetail.innerHTML = text(
                message || (item && item.description) || ""
            );
            w.listFooter.innerHTML =
                w.renderButtonHint(w.keys.RETURN, w.strRETURN, "Close") +
                w.renderButtonHint(w.keys.ENTER, w.strENTER, "Ok");
        };
        state.a = function (key: number) {
            if (!current()) return false;
            if (key === w.keys.RETURN || key === w.keys.EXIT) {
                close();
                return true;
            }
            if (key !== w.keys.ENTER) return false;
            if (locked() || settingsLocked()) {
                close();
                return true;
            }
            var item = rows[w.selIndex];
            if (item) item.action();
            return true;
        };
        w.listKeyHandler = state.a;
        w.listCaption.innerHTML = text(title());
        w.$("#listPopUp").hide();
        w.showPage();
        state.f = w.__ottClassicScreenPort
            ? w.__ottClassicScreenPort.listOwner()
            : null;
        if (state.f && state.f.model) state.f.model.localOnlyInput = true;
    }
    function run(action: () => Promise<any>, startPlayback = false): void {
        var request = ++state.i;
        finishLoading();
        state.g = null;
        // Start the picker inside the user gesture, before rendering or awaiting.
        var pending: Promise<any>;
        try {
            pending = action();
        } catch (error: any) {
            render(error.message || String(error));
            return;
        }
        // Use the same owned loading dialog as provider/media loading. Its
        // parent list automatically disposes it when another screen replaces us.
        var active: any = null;
        if (current() && w.__ottClassicScreenPort) {
            active = w.__ottClassicScreenPort.setOwnedCallback(
                "dialog",
                function (key: number) {
                    if (key === w.keys.RETURN || key === w.keys.EXIT) close();
                }
            ).owner;
            state.c = active;
            active.model = active.model || {};
            active.model.cancelOnPower = close;
            w.$("#dialogbox")
                .html(
                    '<center><div class="ott-spinner" aria-hidden="true"><span class="blob"></span><span class="blob"></span><span class="blob"></span><span class="blob"></span></div></center><br/>' +
                        text(w._("Loading. Please wait...")) +
                        '<div id="local-media-progress">' +
                        text(
                            formatLocalMediaProgress(
                                state.g || { items: [] },
                                w._
                            )
                        ) +
                        "</div><br/><br/>" +
                        w.renderButtonHint(w.keys.RETURN, w.strRETURN, "Cancel")
                )
                .show();
        }
        pending.then(
            function (value) {
                finishLoading(active);
                if (request === state.i) {
                    if (
                        startPlayback &&
                        !(value && value.pickerCancelled) &&
                        current() &&
                        playable()
                    )
                        activate();
                    else render();
                }
            },
            function (error) {
                finishLoading(active);
                if (request === state.i) render(error.message || String(error));
            }
        );
    }
    function open(recovery = false, skipScan = false, message = ""): void {
        if (locked()) return;
        if (settingsLocked()) {
            if (typeof w.enterPinAndSetAccess === "function")
                w.enterPinAndSetAccess(open);
            return;
        }
        finishLoading();
        state.h = recovery;
        state.e = true;
        state.a = null;
        state.f = null;
        w.selIndex = 0;
        if (skipScan) p.b++;
        render(message || failureMessage(p.l));
        if (!skipScan) run(list);
    }
    return { activate, importFiles, open, remove };
}
(window as any).__ottLocalMediaUiFactory = createLocalMediaUi;

/** Loaded only when this local-media feature is used. */
function createLocalMediaUi(w: any, p: any): any {
    function text(value: any): string {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    function playable(): boolean {
        return !!(
            p.last &&
            p.last.items.some(function (item: any) {
                return item.available !== false && !!item.url;
            })
        );
    }
    function activate(): void {
        if (p.locked()) return;
        if (!playable()) {
            open();
            return;
        }
        var selected = p.state.importedSelection;
        p.finishLoading();
        p.state.opened = false;
        p.state.revision++;
        if (typeof w.closeList === "function") w.closeList();
        w.stbSetItem("ottplayprov", "offline");
        p.state.nextImportSelection = selected;
        p.state.importedSelection = "";
        w.loadProv("offline");
    }
    function importFiles(folder = false): Promise<any> {
        if (p.locked() || p.settingsLocked())
            return Promise.reject(
                new Error(
                    "Unlock settings and kiosk mode to change local sources"
                )
            );
        function scanImported(result: any): Promise<any> {
            if (request !== p.catalogRevision)
                return Promise.resolve({
                    cancelled: true,
                    pickerCancelled: true,
                });
            if (result && result.pickerCancelled)
                return Promise.resolve({ pickerCancelled: true });
            p.playbackSelection.clear();
            var pending = p.list(
                function (value) {
                    p.updateLoading(value);
                    return !value.items.some(function (item: any) {
                        return item.available !== false && !!item.url;
                    });
                },
                undefined,
                result && result.sourceIds
            );
            var scanRequest = p.catalogRevision;
            return pending.then(function (value) {
                if (
                    scanRequest === p.catalogRevision &&
                    p.last === value &&
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
                    p.state.importedSelection = item ? "local-" + item.id : "";
                }
                return value;
            });
        }
        if (p.nativeLibrary())
            return p.remember(
                (folder
                    ? p.native.importFolder()
                    : p.native.importFiles()
                ).then(function (value: any) {
                    if (!value?.pickerCancelled) p.playbackSelection.clear();
                    return value;
                })
            );
        // A picker may outlive its screen. Its saved handle is still valid, but
        // its completion must not replace a newer catalog or start playback.
        var request = ++p.catalogRevision;
        p.state.importedSelection = "";
        p.state.nextImportSelection = "";
        if (p.isTauri())
            return p
                .tauriInvoke(
                    folder
                        ? "offline_media_import_folder"
                        : "offline_media_import_files",
                    {}
                )
                .then(scanImported);
        if (p.remoteEndpoint())
            return Promise.reject(
                new Error(
                    "Connect folders on the server itself, or select this device's library."
                )
            );
        p.state.progressState = {
            items: [],
            phase: folder ? "picker-folder" : "picker-files",
        };
        return (
            folder
                ? p.browser.importFolder({ deferScan: true })
                : p.browser.importFiles(undefined, { deferScan: true })
        ).then(scanImported);
    }
    function removeSource(id: string): Promise<any> {
        if (p.locked() || p.settingsLocked())
            return Promise.reject(
                new Error("Unlock settings to disconnect sources")
            );
        function removed(value: any): any {
            if (p.playbackSelection.clearSource(id)) p.retireRemotePlayback();
            return value;
        }
        if (p.nativeLibrary())
            return p.remember(p.native.removeSource({ id: id }).then(removed));
        if (p.isTauri())
            return p
                .tauriInvoke("offline_media_remove_source", {
                    id: id,
                })
                .then(removed)
                .then(function () {
                    return p.list();
                });
        if (p.remoteEndpoint())
            return Promise.reject(
                new Error("Manage sources on the server itself.")
            );
        return p.remember(p.browser.removeSource(id).then(removed));
    }
    function reconnectSource(id: string): Promise<any> {
        if (p.locked() || p.settingsLocked())
            return Promise.reject(
                new Error("Unlock settings to reconnect sources")
            );
        if (p.isNative() || p.isTauri() || p.remoteEndpoint())
            return Promise.reject(
                new Error("Reconnect this folder on the device that owns it.")
            );
        var request = ++p.catalogRevision;
        p.state.progressState = { items: [], phase: "picker-folder" };
        // Invoke the picker synchronously inside the user's Enter/click action.
        return p.browser.reconnectSource(id).then(function (value: any) {
            if (request !== p.catalogRevision || value?.pickerCancelled)
                return value;
            if (value?.sourceReconnected && value.requiresReload) {
                // Old native filesystem reads cannot be aborted by JavaScript.
                // A fresh document uses the new handle without pretending that
                // those old reads have drained or freeing their safety budget.
                w.location.reload();
            }
            return value;
        });
    }
    function startWithFile(sourceId: string): void {
        if (p.locked() || p.settingsLocked()) return;
        p.finishLoading();
        p.state.revision++;
        w.editCaption = w._("Start with file");
        w.editvar = "";
        w.setEdit = function () {
            if (!p.current() || p.locked() || p.settingsLocked()) return;
            var path = String(w.editvar || "").trim();
            if (!path) {
                render("Enter a file path relative to this folder.");
                return;
            }
            run(function () {
                var request = ++p.catalogRevision;
                p.state.importedSelection = "";
                var namespace = w.__ottOfflineProfiles.namespace();
                return p.browser.bootstrapFile(sourceId, path).then(
                    function (value: any) {
                        if (request !== p.catalogRevision)
                            return { cancelled: true, items: [] };
                        p.last = value;
                        var item = value.items.filter(function (entry: any) {
                            return entry.available !== false && !!entry.url;
                        })[0];
                        p.state.importedSelection = item
                            ? "local-" + item.id
                            : "";
                        return value;
                    },
                    function (error: any) {
                        if (
                            request === p.catalogRevision &&
                            p.current() &&
                            !p.locked() &&
                            !p.settingsLocked() &&
                            error?.name === "TimeoutError" &&
                            namespace === w.__ottOfflineProfiles.namespace()
                        ) {
                            w.stbSetItem(
                                p.pendingFileKey,
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
        if (p.locked() || p.settingsLocked())
            return Promise.reject(new Error("Unlock settings to grant access"));
        if (p.nativeLibrary()) return p.remember(p.native.requestAccess());
        if (p.isTauri()) {
            var missing =
                p.last &&
                (p.last.sources || []).filter(function (source: any) {
                    return !source.available;
                })[0];
            return importFiles(!!missing && missing.kind === "folder");
        }
        if (p.remoteEndpoint()) return p.list(onProgress);
        var request = ++p.catalogRevision;
        return p.browser
            .requestAccess(
                onProgress
                    ? function (value: any) {
                          if (request !== p.catalogRevision) return false;
                          p.last = value;
                          return onProgress(value);
                      }
                    : undefined
            )
            .then(function (value: any) {
                if (request === p.catalogRevision) p.last = value;
                return value;
            });
    }
    function remove(id: string): Promise<any> {
        if (p.locked())
            return Promise.reject(
                new Error("Unlock kiosk mode to change local files")
            );
        if (p.settingsLocked())
            return Promise.reject(
                new Error("Unlock settings to change local files")
            );
        if (p.nativeLibrary()) return p.remember(p.native.remove({ id: id }));
        return p.remember(
            p.getEndpoint().then(function (base) {
                return base
                    ? p.http(base + "/" + encodeURIComponent(id), {
                          method: "DELETE",
                      })
                    : p.browser.remove(id);
            })
        );
    }
    function editServer(): void {
        if (p.locked() || p.settingsLocked()) return;
        p.finishLoading();
        p.state.revision++;
        w.editCaption = w._("Media Library URL");
        w.editvar = p.remoteEndpoint();
        var originalCatalogue = p.catalogRevision;
        w.setEdit = function () {
            if (
                !p.current() ||
                p.locked() ||
                p.settingsLocked() ||
                originalCatalogue !== p.catalogRevision
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
            p.catalogRevision++;
            run(p.list);
        };
        w.showEditKey(null);
    }
    function restorePlayback(): void {
        run(function () {
            return requestAccess(function () {
                if (!p.state.resuming || !p.current()) return false;
                if (!playable()) return true;
                activate();
                return false;
            }).then(function (value) {
                if (p.state.resuming && p.current() && playable()) activate();
                return value;
            });
        });
    }
    function render(message?: string): void {
        if (!p.current()) return;
        if (p.locked() || p.settingsLocked()) {
            p.close();
            return;
        }
        if (p.last?.reconnectRequired && !p.isNative() && !p.isTauri())
            message =
                (message ? message + " " : "") +
                "Reconnect the saved folder to renew its access after a drive or network change.";
        var readOnly = !!(p.remoteEndpoint() && p.last?.readOnly);
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
        if (p.state.resuming)
            row(
                "resume",
                "Continue playback",
                p.last &&
                    (p.last.sources || []).some(function (source: any) {
                        return source.access === "permission-required";
                    })
                    ? "Chrome needs permission to read your saved folder again. Choose Allow on every visit in its prompt to resume automatically on later visits. No video files are copied."
                    : "Reconnect the original folder or drive, then continue playback. The saved source and video selection are preserved.",
                restorePlayback
            );
        if (!readOnly) {
            row(
                "add-folder",
                "Add folder",
                !p.isNative() && !p.isTauri()
                    ? "Chrome may ask to view and copy files. This grants read access; OTT plays the originals without storing another media copy."
                    : "Play files directly from the selected folder without copying them.",
                function () {
                    run(function () {
                        return importFiles(true);
                    }, !p.isNative());
                }
            );
            row(
                "add-files",
                "Add files",
                "Play selected files directly without copying them.",
                function () {
                    run(function () {
                        return importFiles();
                    }, !p.isNative());
                }
            );
        }
        if (
            !readOnly &&
            p.last &&
            (p.last.sources || []).some(function (source: any) {
                return !source.available;
            })
        )
            row(
                "grant-access",
                "Grant access",
                "Allow access to previously connected sources.",
                function () {
                    if (p.state.resuming) restorePlayback();
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
                    var request = ++p.catalogRevision;
                    var url = new URL(p.remoteEndpoint());
                    url.searchParams.set("refresh", "true");
                    return p
                        .boundedCatalogRequest(url.href, 60000)
                        .then(function () {
                            return request === p.catalogRevision
                                ? p.list()
                                : { cancelled: true, items: [] };
                        });
                }
                return p.isTauri()
                    ? p.getEndpoint(true).then(function () {
                          return p.list();
                      })
                    : p.list();
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
        ((p.last && p.last.sources) || []).forEach(function (source: any) {
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
                !p.isNative() &&
                !p.isTauri() &&
                !p.remoteEndpoint() &&
                typeof p.browser.reconnectSource === "function"
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
                !p.isNative() &&
                !p.isTauri() &&
                !p.remoteEndpoint() &&
                typeof p.browser.bootstrapFile === "function"
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
                    : source.access === "permission-required"
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
        ((p.last && p.last.items) || []).forEach(function (item: any) {
            if (item.playback?.mode === "unsupported") {
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
        if (!p.isTauri())
            row(
                "server-library",
                "Server library…",
                p.remoteEndpoint()
                    ? "A server library is selected. Clear its URL to use files on this device."
                    : "Optional: use compatible playback from your Server library without uploading originals. Network access is required.",
                editServer
            );
        row("close", "Close", "Return to player settings.", p.close);
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
        p.state.handler = function (key: number) {
            if (!p.current()) return false;
            if (key === w.keys.RETURN || key === w.keys.EXIT) {
                p.close();
                return true;
            }
            if (key !== w.keys.ENTER) return false;
            if (p.locked() || p.settingsLocked()) {
                p.close();
                return true;
            }
            var item = rows[w.selIndex];
            if (item) item.action();
            return true;
        };
        w.listKeyHandler = p.state.handler;
        w.listCaption.innerHTML = text(p.title());
        w.$("#listPopUp").hide();
        w.showPage();
        p.state.owner = w.__ottClassicScreenPort
            ? w.__ottClassicScreenPort.listOwner()
            : null;
        if (p.state.owner && p.state.owner.model)
            p.state.owner.model.localOnlyInput = true;
    }
    function run(action: () => Promise<any>, startPlayback = false): void {
        var request = ++p.state.revision;
        p.finishLoading();
        p.state.progressState = null;
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
        if (p.current() && w.__ottClassicScreenPort) {
            active = w.__ottClassicScreenPort.setOwnedCallback(
                "dialog",
                function (key: number) {
                    if (key === w.keys.RETURN || key === w.keys.EXIT) p.close();
                }
            ).owner;
            p.state.loading = active;
            active.model = active.model || {};
            active.model.cancelOnPower = p.close;
            w.$("#dialogbox")
                .html(
                    '<center><div class="ott-spinner" aria-hidden="true"><span class="blob"></span><span class="blob"></span><span class="blob"></span><span class="blob"></span></div></center><br/>' +
                        text(w._("Loading. Please wait...")) +
                        '<div id="local-media-progress">' +
                        text(
                            p.formatLocalMediaProgress(
                                p.state.progressState || { items: [] },
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
                p.finishLoading(active);
                if (request === p.state.revision) {
                    if (
                        startPlayback &&
                        !(value && value.pickerCancelled) &&
                        p.current() &&
                        playable()
                    )
                        activate();
                    else render();
                }
            },
            function (error) {
                p.finishLoading(active);
                if (request === p.state.revision)
                    render(error.message || String(error));
            }
        );
    }
    function open(recovery = false, skipScan = false, message = ""): void {
        if (p.locked()) return;
        if (p.settingsLocked()) {
            if (typeof w.enterPinAndSetAccess === "function")
                w.enterPinAndSetAccess(open);
            return;
        }
        p.finishLoading();
        p.state.resuming = recovery;
        p.state.opened = true;
        p.state.handler = null;
        p.state.owner = null;
        w.selIndex = 0;
        if (skipScan) p.catalogRevision++;
        render(message || p.failureMessage(p.last));
        if (!skipScan) run(p.list);
    }
    return { activate, importFiles, open, remove };
}
(window as any).__ottLocalMediaUiFactory = createLocalMediaUi;

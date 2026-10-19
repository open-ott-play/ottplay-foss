import {
    installBrowserLocalMedia,
    installOfflineShell,
} from "../offline/browser-local-media";
import { installOfflineProfiles } from "../offline/profiles";
import { resolveNativePlugin, tauriInvoke } from "./native-bridge";

/** Stable item IDs belong to storage; playback URLs are resolved anew each launch. */
export function installLocalMedia(w: any): any {
    if (w.__ottLocalMedia) return w.__ottLocalMedia;
    var browser = installBrowserLocalMedia(w);
    installOfflineShell(w);
    var native = resolveNativePlugin<any>("LocalMedia", function () {
        return browser;
    });
    var opened = false;
    var revision = 0;
    var handler: any = null;
    var owner: any = null;
    var loading: any = null;
    var catalogRevision = 0;
    var pendingList: Promise<any> | null = null;
    var pendingListRevision = 0;
    var pendingListLibrary = "";
    var resuming = false;
    var last: any = null;
    var endpoint = "";
    function isNative(): boolean {
        return !!(
            w.Capacitor &&
            w.Capacitor.isNativePlatform &&
            w.Capacitor.isNativePlatform()
        );
    }
    function isTauri(): boolean {
        return !!(w.__TAURI__ || w.__TAURI_INTERNALS__);
    }
    function remoteEndpoint(): string {
        try {
            return String(
                w.stbGetItem ? w.stbGetItem("localMediaEndpoint") || "" : ""
            );
        } catch (_) {
            return "";
        }
    }
    function getEndpoint(): Promise<string> {
        if (isTauri())
            return tauriInvoke<any>("offline_media_endpoint", {}).then(
                function (value) {
                    endpoint = value.endpoint;
                    return endpoint;
                }
            );
        endpoint = remoteEndpoint().replace(/\/+$/, "");
        return Promise.resolve(endpoint);
    }
    function http(url: string, options?: any): Promise<any> {
        return w.fetch(url, options).then(function (response: any) {
            if (!response.ok)
                throw new Error(
                    "Local media request failed (" + response.status + ")"
                );
            return response.json().then(function (value: any) {
                if (value && Array.isArray(value.items))
                    value.items.forEach(function (item: any) {
                        if (item.url) item.url = new URL(item.url, url).href;
                    });
                if (value && value.uploadUrl)
                    value.uploadUrl = new URL(value.uploadUrl, url).href;
                return value;
            });
        });
    }
    function remember(pending: Promise<any>): Promise<any> {
        var request = ++catalogRevision;
        return pending.then(function (value: any) {
            if (!value || !Array.isArray(value.items))
                throw new Error("Invalid local media catalog");
            if (request === catalogRevision) last = value;
            return value;
        });
    }
    function list(
        onProgress?: (value: any) => boolean | void,
        preferredId?: string,
        reuseCurrent = false
    ): Promise<any> {
        var library = isNative()
            ? "capacitor"
            : isTauri()
              ? "tauri"
              : "browser:" + remoteEndpoint();
        // Profile snapshots wait for an existing scan instead of cancelling
        // playback's progressive catalog and leaving its visible list truncated.
        if (
            reuseCurrent &&
            pendingList &&
            pendingListRevision === catalogRevision &&
            pendingListLibrary === library
        )
            return pendingList;
        var request = ++catalogRevision;
        var timer: any = null;
        var expired = false;
        var expire: (error: Error) => void;
        function clearTimer(): void {
            if (timer !== null) w.clearTimeout(timer);
            timer = null;
        }
        function heartbeat(): void {
            clearTimer();
            if (typeof w.setTimeout === "function")
                timer = w.setTimeout(function () {
                    expired = true;
                    if (request === catalogRevision) catalogRevision++;
                    expire(new Error("Local source did not respond"));
                }, 60000);
        }
        function accept(value: any): boolean {
            if (expired || request !== catalogRevision) return false;
            if (!value || !Array.isArray(value.items))
                throw new Error("Invalid local media catalog");
            heartbeat();
            last = value;
            return !onProgress || onProgress(value) !== false;
        }
        var pending = isNative()
            ? native.list()
            : getEndpoint().then(function (base) {
                  return base ? http(base) : browser.list(accept, preferredId);
              });
        var result = new Promise<any>(function (resolve, reject) {
            expire = reject;
            heartbeat();
            pending.then(
                function (value: any) {
                    clearTimer();
                    if (expired) return;
                    if (request !== catalogRevision) {
                        reject(
                            new Error(
                                "Local catalog was replaced while scanning"
                            )
                        );
                        return;
                    }
                    if (!value || !Array.isArray(value.items)) {
                        reject(new Error("Invalid local media catalog"));
                        return;
                    }
                    last = value;
                    resolve(value);
                },
                function (error: any) {
                    clearTimer();
                    reject(error);
                }
            );
        });
        pendingList = result;
        pendingListRevision = request;
        pendingListLibrary = library;
        function clear(): void {
            if (pendingList === result) pendingList = null;
        }
        result.then(clear, clear);
        return result;
    }
    function importFiles(folder = false): Promise<any> {
        if (locked() || settingsLocked())
            return Promise.reject(
                new Error(
                    "Unlock settings and kiosk mode to change local sources"
                )
            );
        if (isNative())
            return remember(
                folder ? native.importFolder() : native.importFiles()
            );
        if (isTauri())
            return tauriInvoke<any>(
                folder
                    ? "offline_media_import_folder"
                    : "offline_media_import_files",
                {}
            ).then(function () {
                return list();
            });
        if (remoteEndpoint())
            return Promise.reject(
                new Error(
                    "Connect folders on the server itself, or select this device's library."
                )
            );
        return remember(
            folder ? browser.importFolder() : browser.importFiles()
        );
    }
    function removeSource(id: string): Promise<any> {
        if (locked() || settingsLocked())
            return Promise.reject(
                new Error("Unlock settings to disconnect sources")
            );
        if (isNative()) return remember(native.removeSource({ id: id }));
        if (isTauri())
            return tauriInvoke<any>("offline_media_remove_source", {
                id: id,
            }).then(function () {
                return list();
            });
        if (remoteEndpoint())
            return Promise.reject(
                new Error("Manage sources on the server itself.")
            );
        return remember(browser.removeSource(id));
    }
    function requestAccess(
        onProgress?: (value: any) => boolean | void
    ): Promise<any> {
        if (locked() || settingsLocked())
            return Promise.reject(new Error("Unlock settings to grant access"));
        if (isNative()) return remember(native.requestAccess());
        if (isTauri()) {
            var missing =
                last &&
                (last.sources || []).filter(function (source: any) {
                    return !source.available;
                })[0];
            return importFiles(!!missing && missing.kind === "folder");
        }
        if (remoteEndpoint()) return list(onProgress);
        var request = ++catalogRevision;
        return browser
            .requestAccess(
                onProgress
                    ? function (value: any) {
                          if (request !== catalogRevision) return false;
                          last = value;
                          return onProgress(value);
                      }
                    : undefined
            )
            .then(function (value: any) {
                if (request === catalogRevision) last = value;
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
        if (isNative()) return remember(native.remove({ id: id }));
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
    function title(): string {
        return w._ ? w._("Local videos") : "Local videos";
    }
    function locked(): boolean {
        return !!(w.__ottKiosk && w.__ottKiosk.locked());
    }
    function settingsLocked(): boolean {
        return !!(w.__ottParental && w.__ottParental.needs("settings"));
    }
    function text(value: any): string {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    function current(): boolean {
        return (
            opened &&
            (!handler || w.listKeyHandler === handler) &&
            (!owner ||
                owner.foreground() ||
                (loading && loading.foreground() && owner.active()))
        );
    }
    function finishLoading(active = loading): void {
        if (!active) return;
        if (loading === active) loading = null;
        active.close();
    }
    function close(): void {
        finishLoading();
        opened = false;
        revision++;
        if (
            !locked() &&
            !settingsLocked() &&
            typeof w.optionsList === "function"
        )
            w.optionsList(w.popLocalMedia);
        else if (typeof w.closeList === "function") w.closeList();
    }
    function playable(): boolean {
        return !!(
            last &&
            last.items.some(function (item: any) {
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
        finishLoading();
        opened = false;
        revision++;
        if (typeof w.closeList === "function") w.closeList();
        w.stbSetItem("ottplayprov", "offline");
        w.loadProv("offline");
    }
    function editServer(): void {
        if (locked() || settingsLocked()) return;
        finishLoading();
        revision++;
        w.editCaption = w._("Media Library URL");
        w.editvar = remoteEndpoint();
        w.setEdit = function () {
            if (!current() || locked() || settingsLocked()) return;
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
            run(list);
        };
        w.showEditKey(null);
    }
    function restorePlayback(): void {
        run(function () {
            return requestAccess(function () {
                if (!resuming || !current()) return false;
                if (!playable()) return true;
                activate();
                return false;
            }).then(function (value) {
                if (resuming && current() && playable()) activate();
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
        if (resuming)
            row(
                "resume",
                "Continue playback",
                last &&
                    (last.sources || []).some(function (source: any) {
                        return source.access === "permission-required";
                    })
                    ? "Chrome needs permission to read your saved folder again. Choose Allow on every visit in its prompt to resume automatically on later visits. No video files are copied."
                    : "Reconnect the original folder or drive, then continue playback. The saved source and video selection are preserved.",
                restorePlayback
            );
        row(
            "add-folder",
            "Add folder",
            !isNative() && !isTauri()
                ? "Chrome may ask to view and copy files. This grants read access; OTT plays the originals without storing another media copy."
                : "Play files directly from the selected folder without copying them.",
            function () {
                run(function () {
                    return importFiles(true);
                });
            }
        );
        row(
            "add-files",
            "Add files",
            "Play selected files directly without copying them.",
            function () {
                run(function () {
                    return importFiles();
                });
            }
        );
        if (
            last &&
            (last.sources || []).some(function (source: any) {
                return !source.available;
            })
        )
            row(
                "grant-access",
                "Grant access",
                "Allow access to previously connected sources.",
                function () {
                    if (resuming) restorePlayback();
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
            run(list);
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
        ((last && last.sources) || []).forEach(function (source: any) {
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
        ((last && last.items) || []).forEach(function (item: any) {
            if (item.source === "linked") return;
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
        if (!isNative() && !isTauri())
            row(
                "server-library",
                "Server library…",
                remoteEndpoint()
                    ? "A server library is selected. Clear its URL to use files on this device."
                    : "Optional: connect a library stored on your server. Network access is required.",
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
        handler = function (key: number) {
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
        w.listKeyHandler = handler;
        w.listCaption.innerHTML = text(title());
        w.$("#listPopUp").hide();
        w.showPage();
        owner = w.__ottClassicScreenPort
            ? w.__ottClassicScreenPort.listOwner()
            : null;
        if (owner && owner.model) owner.model.localOnlyInput = true;
    }
    function run(action: () => Promise<any>): void {
        var request = ++revision;
        finishLoading();
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
            loading = active;
            w.$("#dialogbox")
                .html(
                    '<center><div class="ott-spinner" aria-hidden="true"><span class="blob"></span><span class="blob"></span><span class="blob"></span><span class="blob"></span></div></center><br/>' +
                        text(w._("Loading. Please wait...")) +
                        "<br/><br/>" +
                        w.renderButtonHint(w.keys.RETURN, w.strRETURN, "Cancel")
                )
                .show();
        }
        pending.then(
            function () {
                finishLoading(active);
                if (request === revision) render();
            },
            function (error) {
                finishLoading(active);
                if (request === revision)
                    render(error.message || String(error));
            }
        );
    }
    function open(recovery = false, skipScan = false): void {
        if (locked()) return;
        if (settingsLocked()) {
            if (typeof w.enterPinAndSetAccess === "function")
                w.enterPinAndSetAccess(open);
            return;
        }
        finishLoading();
        resuming = recovery;
        opened = true;
        handler = null;
        owner = null;
        w.selIndex = 0;
        if (skipScan) catalogRevision++;
        render();
        if (!skipScan) run(list);
    }
    var api = {
        activate: activate,
        available: function () {
            return isNative() || isTauri() || !!w.indexedDB;
        },
        didRestoreLibrary: function () {
            catalogRevision++;
            last = null;
        },
        importFiles: importFiles,
        isPlaybackUrl: function (url: string) {
            return !!(
                last &&
                last.items.some(function (item: any) {
                    return item.url === url;
                })
            );
        },
        libraryIdentity: function () {
            return isNative()
                ? "capacitor"
                : isTauri()
                  ? "tauri"
                  : "browser:" + remoteEndpoint();
        },
        libraryWrite: function (identity: string) {
            if (isNative() || isTauri() || identity.indexOf("browser:") !== 0)
                throw new Error(
                    "This local library belongs to another platform"
                );
            var value = identity.slice(8);
            if (value) {
                var parsed = new URL(value);
                if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname)
                    throw new Error("Invalid saved server library URL");
            }
            return { key: "localMediaEndpoint", value: value };
        },
        list: list,
        open: open,
        remove: remove,
        resume: function (skipScan = false) {
            open(true, skipScan);
        },
        snapshot: function () {
            return list(undefined, undefined, true);
        },
        title: title,
    };
    w.__ottLocalMedia = api;
    installOfflineProfiles(w, api);
    w.popLocalMedia = open;
    return api;
}

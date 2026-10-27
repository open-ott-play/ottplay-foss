import { loadRemoteFeature } from "../commands/remote-feature";
import {
    installBrowserLocalMedia,
    installOfflineShell,
} from "../offline/browser-local-media";
import {
    formatLocalMediaProgress,
    localMediaProgressTimeout,
} from "../offline/local-media-progress";
import {
    createLocalPlaybackSelection,
    localSourceScan,
} from "../offline/playback-selection";
import { installOfflineProfiles } from "../offline/profiles";
import { resolveNativePlugin, tauriInvoke } from "./native-bridge";
/** Stable item IDs belong to storage; playback URLs are resolved anew each launch. */
export function installLocalMedia(w: any): any {
    // Reuse exact protocol/error strings; no messages or wire values change.
    var localText0 = "localMediaEndpoint",
        localText1 = "local-compatibility" as const,
        localText2 = "local-media-ui" as const,
        localText3 = "Local media feature could not be loaded",
        localText4 = "a",
        localText5 = "Local playback request cancelled",
        localText6 = "Local media request cancelled",
        localText7 = "Local source unavailable",
        localText8 = "Local media scan stopped responding",
        localText9 = "Invalid local media catalog",
        localText10 = "Local source did not respond",
        localText11 = "runtime_changed",
        localText12 = "catalog_loading";
    function localCall(
        owner: any,
        key: string,
        args: any[],
        flags: number
    ): any {
        if (flags & 1 && owner == null) return;
        var fn = owner[key];
        if (flags & 2 && fn == null) return;
        return fn.apply(owner, args);
    }
    function localField(owner: any, key: string): any {
        return owner == null ? undefined : owner[key];
    }
    var uiState: any = {
        a: null,
        b: "",
        c: null,
        d: "",
        e: false,
        f: null,
        g: null,
        h: false,
        i: 0,
    };
    if (w.__ottLocalMedia) return w.__ottLocalMedia;
    var browser = installBrowserLocalMedia(w);
    installOfflineShell(w);
    var native = resolveNativePlugin<any>("LocalMedia", function () {
        return browser;
    });
    var catalogRevision = 0;
    var activeNativeCancel: (() => void) | null = null;
    function cancelNativeList(): void {
        if (activeNativeCancel) activeNativeCancel();
    }
    var last: any = null;
    var endpoint = "";
    var remoteHandoff: any = null;
    var remoteOrderCurrent: (() => boolean) | null = null;
    var remoteGeneration = 0;
    var nativeSourcePaths = false;
    var remoteLinkSequence = 0;
    var playbackSelection = createLocalPlaybackSelection(w, function () {
        var profiles = w.__ottOfflineProfiles;
        return (
            libraryIdentity() +
            ":" +
            (localCall(profiles, "namespace", [], 3) || "offline") +
            ":" +
            (localField(localCall(profiles, "current", [], 3), "binding_id") ||
                "")
        );
    });
    var pendingFileKey = "localMediaPendingFile";
    function playbackIntentContext(): string {
        var profiles = w.__ottOfflineProfiles;
        return JSON.stringify([
            libraryIdentity(),
            localCall(profiles, "namespace", [], 3) || "offline",
            localCall(profiles, "current", [], 3) || null,
            w.stbGetItem("offlineProfileBindings") || "",
        ]);
    }
    function retireRemotePlayback(): void {
        remoteGeneration++;
        remoteHandoff = null;
        remoteOrderCurrent = null;
        playbackSelection.ordered();
        uiState.d = "";
    }
    function libraryIdentity(): string {
        if (serverLibrary()) return "browser:" + remoteEndpoint();
        return isNative()
            ? "capacitor"
            : isTauri()
              ? "tauri"
              : "browser:" + remoteEndpoint();
    }
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
            return String(w.stbGetItem ? w.stbGetItem(localText0) || "" : "");
        } catch (_) {
            return "";
        }
    }
    function serverLibrary(): boolean {
        return !isTauri() && !!remoteEndpoint();
    }
    function nativeLibrary(): boolean {
        return isNative() && !serverLibrary();
    }
    function getEndpoint(
        refresh = false,
        preferredId?: string,
        sourceId?: string
    ): Promise<string> {
        if (isTauri())
            return tauriInvoke<any>("offline_media_endpoint", {
                ...(refresh ? { refresh: true } : {}),
                ...(preferredId ? { preferredId } : {}),
                ...(sourceId ? { sourceId } : {}),
            }).then(function (value) {
                endpoint = value.endpoint;
                return endpoint;
            });
        endpoint = remoteEndpoint().replace(/\/+$/, "");
        return Promise.resolve(endpoint);
    }
    function normalizePlayback(value: any): any {
        (localField(value, "items") || []).forEach(function (item: any) {
            if (localField(item.playback, "mode") === "unsupported") {
                item.available = false;
                item.url = "";
            }
        });
        return value;
    }
    function http(url: string, options?: any): Promise<any> {
        return w.fetch(url, options).then(function (response: any) {
            if (!response.ok)
                throw new Error(
                    "Local media request failed (" + response.status + ")"
                );
            return response.json().then(function (value: any) {
                normalizePlayback(value);
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
    var compatibility: any = null,
        localUi: any = null;
    var compatibilityEpoch = 0,
        loadingCompatibility: any[] = [];
    function loadLocalFeature(
        kind: "local-compatibility" | "local-media-ui"
    ): Promise<any> {
        function factory(): any {
            return kind === localText1
                ? w.__ottLocalCompatibilityFactory
                : w.__ottLocalMediaUiFactory;
        }
        return new Promise(function (resolve, reject) {
            function finish(error?: string): void {
                if (error || typeof factory() !== "function") {
                    reject(new Error(localText3));
                    return;
                }
                try {
                    if (kind === localText1) {
                        if (!compatibility)
                            compatibility = factory()(w, {
                                get a() {
                                    return catalogRevision;
                                },
                                get b() {
                                    return last;
                                },
                                c: libraryIdentity,
                            });
                        resolve(compatibility);
                    } else {
                        if (!localUi)
                            localUi = factory()(w, {
                                a: browser,
                                get b() {
                                    return catalogRevision;
                                },
                                set b(value: any) {
                                    catalogRevision = value;
                                },
                                boundedCatalogRequest: boundedCatalogRequest,
                                c: close,
                                d: current,
                                e: failureMessage,
                                f: finishLoading,
                                g: formatLocalMediaProgress,
                                h: getEndpoint,
                                i: http,
                                j: isNative,
                                k: isTauri,
                                get l() {
                                    return last;
                                },
                                set l(value: any) {
                                    last = value;
                                },
                                m: list,
                                n: locked,
                                o: native,
                                p: nativeLibrary,
                                q: pendingFileKey,
                                r: playbackSelection,
                                s: remember,
                                t: remoteEndpoint,
                                tauriInvoke: tauriInvoke,
                                u: retireRemotePlayback,
                                v: settingsLocked,
                                w: uiState,
                                x: title,
                                y: updateLoading,
                            });
                        resolve(localUi);
                    }
                } catch (_) {
                    reject(new Error(localText3));
                }
            }
            if (factory()) finish();
            else loadRemoteFeature(w, kind, finish);
        });
    }
    function playbackItem(url: string): any {
        return compatibility
            ? compatibility.d(url)
            : last?.items.filter(function (item: any) {
                  return item.url === url;
              })[0];
    }
    function compatibilityPlayback(url: string): boolean {
        return (
            localField(localField(playbackItem(url), "playback"), "mode") ===
            "compatibility"
        );
    }
    function cancelPlayback(url?: string): void {
        loadingCompatibility.slice().forEach(function (pending: any) {
            if (!url || pending.url === url) pending.cancel();
        });
        if (!url) compatibilityEpoch++;
        localCall(compatibility, localText4, [url], 1);
    }
    function preparePlayback(url: string, current?: () => boolean): any {
        if (!compatibility && w.__ottLocalCompatibilityFactory)
            loadLocalFeature(localText1).catch(function () {});
        if (compatibility) return compatibility.f(url, current);
        if (
            localField(localField(playbackItem(url), "playback"), "mode") ===
            "unsupported"
        )
            return Promise.reject(
                new Error(
                    "AVI/MKV compatibility is unavailable on this library"
                )
            );
        if (!compatibilityPlayback(url)) return Promise.resolve(url);
        if (
            localCall(w.__ottStandby, "blocked", [], 1) ||
            (current && !current()) ||
            loadingCompatibility.length >= 2
        )
            return Promise.reject(new Error(localText5));
        var cancelled = false,
            inner: any = null,
            rejectPending: any,
            epoch = compatibilityEpoch,
            scan = catalogRevision,
            identity = libraryIdentity();
        function admitted(): boolean {
            return (
                !cancelled &&
                epoch === compatibilityEpoch &&
                scan === catalogRevision &&
                identity === libraryIdentity() &&
                !localCall(w.__ottStandby, "blocked", [], 1) &&
                (!current || current())
            );
        }
        function retire(): void {
            loadingCompatibility = loadingCompatibility.filter(function (
                entry: any
            ) {
                return entry !== pending;
            });
        }
        var pending: any = {
            cancel: function () {
                if (cancelled) return;
                cancelled = true;
                retire();
                if (localField(inner, "cancel")) inner.cancel();
                rejectPending(new Error(localText5));
            },
            url: url,
        };
        var result: any = new Promise(function (resolve, reject) {
            rejectPending = reject;
            loadingCompatibility.push(pending);
            loadLocalFeature(localText1)
                .then(function (owner: any) {
                    if (!admitted()) throw new Error(localText5);
                    inner = owner.f(url, admitted);
                    return inner;
                })
                .then(
                    function (value: any) {
                        retire();
                        if (admitted()) resolve(value);
                        else {
                            localCall(compatibility, localText4, [value], 1);
                            reject(new Error(localText5));
                        }
                    },
                    function (error: any) {
                        retire();
                        reject(error);
                    }
                );
        });
        result.cancel = pending.cancel;
        return result;
    }
    function localUiAction(name: string, args: any[]): any {
        if (!localUi && w.__ottLocalMediaUiFactory)
            loadLocalFeature(localText2).catch(function () {});
        if (localUi) return localUi[name].apply(localUi, args);
        var request = uiState.i,
            scan = catalogRevision,
            input = w.listKeyHandler;
        return loadLocalFeature(localText2).then(function (owner: any) {
            if (
                request !== uiState.i ||
                scan !== catalogRevision ||
                input !== w.listKeyHandler ||
                localCall(w.__ottStandby, "blocked", [], 1)
            )
                throw new Error(localText6);
            return owner[name].apply(owner, args);
        });
    }
    function activate(): any {
        return localUiAction("activate", []);
    }
    function importFiles(...args: any[]): any {
        return localUiAction("importFiles", args);
    }
    function remove(...args: any[]): any {
        return localUiAction("remove", args);
    }
    function open(...args: any[]): any {
        var result = localUiAction("open", args);
        if (localField(result, "catch"))
            return result.catch(function (error: any) {
                if (
                    localField(error, "message") !== localText6 &&
                    typeof w.showShift === "function"
                )
                    w.showShift(w._(localText7));
            });
        return result;
    }
    function boundedCatalogRequest(url: string, timeout: number): Promise<any> {
        return new Promise(function (resolve, reject) {
            var controller = w.AbortController ? new w.AbortController() : null;
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                if (controller) controller.abort();
                reject(new Error(localText8));
            }, timeout);
            function finish(error: any, value?: any): void {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve(value);
            }
            // Include response.json() in the deadline: headers alone do not
            // establish progress when a local server stops sending its body.
            try {
                http(
                    url,
                    controller ? { signal: controller.signal } : undefined
                ).then(
                    function (value) {
                        finish(null, value);
                    },
                    function (error) {
                        finish(error);
                    }
                );
            } catch (error) {
                finish(error);
            }
        });
    }
    function remember(pending: Promise<any>): Promise<any> {
        var request = ++catalogRevision;
        return pending.then(function (value: any) {
            if (!value || !Array.isArray(value.items))
                throw new Error(localText9);
            if (request === catalogRevision) last = normalizePlayback(value);
            return value;
        });
    }
    function nativeList(
        progress: (value: any) => boolean,
        preferredId: string | undefined,
        request: number
    ): Promise<any> {
        cancelNativeList();
        var requestId = "local-" + request + "-" + Date.now();
        return new Promise(function (resolve, reject) {
            var listener: any = null;
            var settled = false;
            var started = false;
            function cleanup(): void {
                if (activeNativeCancel === cancel) activeNativeCancel = null;
                if (listener) {
                    var handle = listener;
                    listener = null;
                    try {
                        Promise.resolve(handle.remove()).catch(function () {});
                    } catch (_) {}
                }
            }
            function finish(error: any, value?: any): void {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve(value);
            }
            function cancel(): void {
                if (settled) return;
                if (started && typeof native.cancelList === "function") {
                    try {
                        Promise.resolve(
                            native.cancelList({ requestId: requestId })
                        ).catch(function () {});
                    } catch (_) {}
                }
                finish(null, { cancelled: true, items: [] });
            }
            activeNativeCancel = cancel;
            function start(): void {
                if (settled) return;
                if (request !== catalogRevision) {
                    cancel();
                    return;
                }
                started = true;
                try {
                    Promise.resolve(
                        native.list({
                            preferredId: preferredId,
                            requestId: requestId,
                        })
                    ).then(
                        function (value: any) {
                            finish(null, value);
                        },
                        function (error: any) {
                            finish(error);
                        }
                    );
                } catch (error) {
                    finish(error);
                }
            }
            if (typeof native.addListener !== "function") {
                start();
                return;
            }
            Promise.resolve(
                native.addListener("localMediaProgress", function (event: any) {
                    if (settled || !event || event.requestId !== requestId)
                        return;
                    if (request !== catalogRevision || !progress(event.catalog))
                        cancel();
                })
            ).then(function (handle: any) {
                listener = handle;
                if (settled) {
                    cleanup();
                    return;
                }
                start();
            }, start);
        });
    }
    function list(
        onProgress?: (value: any) => boolean | void,
        preferredId?: string,
        prioritySources?: string[],
        admitted?: () => boolean,
        sourceId?: string
    ): Promise<any> {
        if (localCall(w.__ottStandby, "blocked", [], 1))
            return Promise.reject(w.__ottStandby.error());
        var initial: any = null;
        if (remoteHandoff) {
            var handoff = remoteHandoff;
            remoteHandoff = null;
            if (
                localField(w.__ottActiveProviderDriver, "id") === "offline" &&
                handoff.current()
            ) {
                handoff.bindCatalog();
                last = handoff.catalog;
                var scan = localSourceScan(handoff.catalog, sourceId || "");
                if (
                    scan ? scan.state === "complete" : !handoff.catalog.scanning
                )
                    return Promise.resolve(handoff.catalog);
                initial = handoff.catalog;
            } else {
                playbackSelection.ordered();
                remoteOrderCurrent = null;
            }
        }
        var request = ++catalogRevision;
        last = null;
        function accept(value: any): boolean {
            if (request !== catalogRevision) return false;
            if (!value || !Array.isArray(value.items))
                throw new Error(localText9);
            last = normalizePlayback(value);
            updateLoading(value);
            return !onProgress || onProgress(value) !== false;
        }
        // Publish the accepted prefix immediately. Continue the same native
        // scan so later discoveries extend the list without replacing playback.
        if (initial && !accept(initial))
            return Promise.resolve({ ...initial, cancelled: true });
        var initialScan =
            initial && sourceId ? localSourceScan(initial, sourceId) : null;
        var pending = nativeLibrary()
            ? boundedLocalRead(function (progress) {
                  return nativeList(progress, preferredId, request);
              })
            : boundedLocalRead(function () {
                  return getEndpoint(false, preferredId, sourceId);
              }).then(function (base) {
                  if (request !== catalogRevision)
                      return { cancelled: true, items: [] };
                  return base
                      ? pollCatalog(
                            base,
                            request,
                            accept,
                            !!onProgress,
                            preferredId,
                            admitted,
                            sourceId,
                            null,
                            initialScan && initialScan.generation
                        )
                      : boundedLocalRead(function (progress) {
                            return browser.list(
                                progress,
                                preferredId,
                                prioritySources
                            );
                        });
              });
        // Native bridges and browser filesystem reads cannot always be aborted.
        // Native and browser progress extend the idle deadline while actual
        // discovery advances. Late events remain bound to this catalog owner.
        // Retire ownership on expiry so late results cannot populate a completed
        // snapshot or revive a closed loading dialog.
        function boundedLocalRead(
            start: (progress: (value: any) => boolean) => Promise<any>
        ): Promise<any> {
            return new Promise(function (resolve, reject) {
                var timer: any = null;
                var settled = false;
                var signature = "";
                function clear(): void {
                    if (timer !== null) clearTimeout(timer);
                    timer = null;
                }
                function heartbeat(timeout = 60000): void {
                    clear();
                    timer = setTimeout(function () {
                        if (settled) return;
                        settled = true;
                        timer = null;
                        if (request === catalogRevision) {
                            catalogRevision++;
                            // Retain the saved source rows so a stalled read
                            // can be reconnected without deleting its identity.
                            if (last)
                                last = {
                                    ...last,
                                    reconnectRequired: true,
                                    scanning: false,
                                };
                            cancelNativeList();
                            browser.suspend();
                        }
                        reject(new Error(localText10));
                    }, timeout);
                }
                function finish(error: any, value?: any): void {
                    if (settled) return;
                    settled = true;
                    clear();
                    if (error) {
                        cancelNativeList();
                        reject(error);
                    } else resolve(value);
                }
                heartbeat();
                try {
                    start(function (value) {
                        if (settled || request !== catalogRevision)
                            return false;
                        var admitted = accept(value);
                        var next = JSON.stringify([
                            value.scanned,
                            value.total,
                            value.items.length,
                            value.sources && value.sources.length,
                            value.phase,
                            value.scanning,
                        ]);
                        if (next !== signature) {
                            signature = next;
                            heartbeat(localMediaProgressTimeout(value));
                        }
                        return admitted;
                    }).then(
                        function (value) {
                            finish(null, value);
                        },
                        function (error) {
                            finish(error);
                        }
                    );
                } catch (error) {
                    finish(error);
                }
            });
        }
        return pending.then(function (value: any) {
            if (!value || !Array.isArray(value.items))
                throw new Error(localText9);
            if (request !== catalogRevision)
                return { ...value, cancelled: true };
            last = value;
            return value;
        });
    }
    // Poll snapshots of a native background scan. Reading the catalog never
    // starts a replacement scan, and unchanged snapshots are not progress.
    function pollCatalog(
        base: string,
        request: number | null,
        accept: (value: any) => boolean,
        progressive: boolean,
        preferredId?: string,
        admitted?: () => boolean,
        sourceId?: string,
        firstPlayable: ((value: any) => boolean) | null = null,
        generation = 0
    ): Promise<any> {
        var catalogUrl = base;
        var preferredSent = !preferredId || isTauri();
        var signature = "";
        var changedAt = Date.now();
        var sourceGeneration = generation;
        function read(): Promise<any> {
            if (admitted && !admitted())
                return Promise.resolve({ cancelled: true, items: [] });
            return boundedCatalogRequest(
                catalogUrl,
                Math.max(1, 60000 - (Date.now() - changedAt))
            ).then(function (value) {
                if (!value || !Array.isArray(value.items))
                    throw new Error(localText9);
                if (
                    (request !== null && request !== catalogRevision) ||
                    (admitted && !admitted())
                )
                    return { ...value, cancelled: true };
                if (!preferredSent && value.readOnly) {
                    var url = new URL(base);
                    url.searchParams.set("preferredId", preferredId!);
                    catalogUrl = url.href;
                    preferredSent = true;
                    return read();
                }
                var scan = sourceId ? localSourceScan(value, sourceId) : null;
                if (scan && scan.generation) {
                    if (
                        sourceGeneration &&
                        sourceGeneration !== scan.generation
                    )
                        throw {
                            localMediaCode: localText11,
                            message: "Local source changed while loading",
                        };
                    sourceGeneration = scan.generation;
                }
                if (
                    scan &&
                    !(value.sources || []).some(function (source: any) {
                        return (
                            source.id === sourceId &&
                            source.kind === "folder" &&
                            source.available !== false
                        );
                    })
                )
                    throw {
                        localMediaCode: "source_unavailable",
                        message: "The selected local source is unavailable",
                    };
                var sourceComplete = !!scan && scan.state === "complete";
                if (scan && scan.state === "error")
                    throw {
                        localMediaCode: "catalog_unavailable",
                        message:
                            "The selected local source could not be scanned",
                    };
                var next = JSON.stringify([
                    value.scanning,
                    value.scanned,
                    value.total,
                    value.items.length,
                    value.scanError,
                    value.preferred && value.preferred.id,
                    value.preferred && value.preferred.state,
                    scan && scan.generation,
                    scan && scan.state,
                ]);
                if (next !== signature) {
                    signature = next;
                    changedAt = Date.now();
                    if (!accept(value)) return { ...value, cancelled: true };
                }
                if (value.scanError && !(scan && scan.generation))
                    throw new Error(value.scanError);
                if (
                    sourceComplete ||
                    (!value.scanning && !scan) ||
                    (firstPlayable &&
                        scan &&
                        scan.generation > 0 &&
                        firstPlayable(value))
                )
                    return value;
                if (Date.now() - changedAt >= 60000)
                    throw new Error(localText8);
                // A one-shot server catalog remains compatible. Only Tauri's
                // explicit background-scan protocol needs repeated requests.
                if (!isTauri() && !progressive) return value;
                return new Promise(function (resolve) {
                    setTimeout(resolve, 250);
                }).then(function () {
                    if (request !== null && request !== catalogRevision)
                        return { ...value, cancelled: true };
                    return read();
                });
            });
        }
        return read();
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
    function current(): boolean {
        return (
            uiState.e &&
            (!uiState.a || w.listKeyHandler === uiState.a) &&
            (!uiState.f ||
                uiState.f.foreground() ||
                (uiState.c && uiState.c.foreground() && uiState.f.active()))
        );
    }
    function failureMessage(value: any): string {
        if (
            value?.items?.some(function (item: any) {
                return localField(item.playback, "mode") === "unsupported";
            })
        )
            return "Some AVI/MKV files need a compatible native or Server library backend. Direct formats remain available; originals are not uploaded.";
        var name = value && value.readErrorName;
        if (
            !/^(NotFoundError|NotAllowedError|SecurityError|NotReadableError|AbortError|InvalidStateError|QuotaExceededError|TimeoutError|TypeError|UnknownError|Error)$/.test(
                name
            )
        )
            return "";
        var stage = (
            {
                enumerating: "Reading folder entries",
                files: "Reading local files",
                metadata: "Reading file information",
                permission: "Checking folder permission",
                sources: "Reading saved sources",
            } as any
        )[value.readErrorPhase];
        if (typeof stage !== "string") stage = localText7;
        return (w._ ? w._(stage) : stage) + ": " + name;
    }
    function updateLoading(value: any): void {
        uiState.g = value;
        if (!uiState.c || !current()) return;
        var node =
            w.document && w.document.getElementById("local-media-progress");
        if (node) node.textContent = formatLocalMediaProgress(value, w._);
    }
    function finishLoading(active = uiState.c): void {
        if (!active) return;
        if (uiState.c === active) uiState.c = null;
        active.close();
    }
    function close(): void {
        uiState.b = "";
        uiState.d = "";
        cancelNativeList();
        browser.suspend();
        finishLoading();
        uiState.e = false;
        uiState.i++;
        catalogRevision++;
        if (
            !locked() &&
            !settingsLocked() &&
            typeof w.optionsList === "function"
        )
            w.optionsList(w.popLocalMedia);
        else if (typeof w.closeList === "function") w.closeList();
    }
    var api = {
        activate: activate,
        available: function () {
            return isNative() || isTauri() || serverLibrary() || !!w.indexedDB;
        },
        bindPlaybackOwner: function (active: () => boolean): void {
            if (!remoteHandoff) return;
            if (remoteHandoff.current()) remoteHandoff.bindOwner(active);
            else retireRemotePlayback();
        },
        cancelNativeList: cancelNativeList,
        cancelPlayback: cancelPlayback,
        cancelScan: function () {
            catalogRevision++;
            cancelNativeList();
            browser.suspend();
        },
        compatibilityFailure: function () {
            if (typeof w.showShift === "function") w.showShift(w._(localText7));
        },
        compatibilityPlayback: compatibilityPlayback,
        completedSources: function () {
            if (
                !last ||
                last.cancelled ||
                last.scanning ||
                last.scanError ||
                last.reconnectRequired
            )
                return null;
            return (last.sources || []).map(function (source: any) {
                return { id: source.id, kind: source.kind, name: source.name };
            });
        },
        didRestoreLibrary: function () {
            retireRemotePlayback();
            catalogRevision++;
            last = null;
        },
        failureMessage: failureMessage,
        importFiles: importFiles,
        isPlaybackUrl: function (url: string) {
            if (localCall(compatibility, "c", [url], 1)) return true;
            return !!(
                last &&
                last.items.some(function (item: any) {
                    return item.url === url;
                })
            );
        },
        libraryIdentity: libraryIdentity,
        libraryWrite: function (identity: string) {
            if (isNative() && identity === "capacitor")
                return { key: localText0, value: "" };
            if (
                isTauri() ||
                (isNative() && identity === "browser:") ||
                identity.indexOf("browser:") !== 0
            )
                throw new Error(
                    "This local library belongs to another platform"
                );
            var value = identity.slice(8);
            if (value) {
                var parsed = new URL(value);
                if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname)
                    throw new Error("Invalid saved server library URL");
            }
            return { key: localText0, value: value };
        },
        list: list,
        open: open,
        playbackFilter: playbackSelection.filter,
        playbackList: function (
            onProgress?: (value: any) => boolean | void,
            preferredId?: string
        ): Promise<any> {
            return list(
                onProgress,
                preferredId,
                undefined,
                undefined,
                playbackSelection.source()
            );
        },
        playbackOrder: function () {
            if (remoteOrderCurrent && !remoteOrderCurrent()) {
                retireRemotePlayback();
            }
            return localField(w.__ottActiveProviderDriver, "id") ===
                "offline" && remoteOrderCurrent?.()
                ? playbackSelection.order()
                : null;
        },
        playbackOrdered: function () {
            playbackSelection.ordered();
            remoteOrderCurrent = null;
        },
        playbackSourceUrl: function (url: string) {
            return localCall(compatibility, "e", [url], 1) || url;
        },
        preferredState: function (id: string) {
            return last && last.preferred && last.preferred.id === id
                ? last.preferred.state
                : undefined;
        },
        preparePlayback: preparePlayback,
        progressText: function (value: any) {
            return formatLocalMediaProgress(value, w._);
        },
        progressTimeout: localMediaProgressTimeout,
        remoteActivate: function (
            source: string,
            ids: string[],
            catalog: any,
            admitted: () => boolean,
            seed: number | null = null
        ): void {
            if (
                !admitted() ||
                locked() ||
                settingsLocked() ||
                typeof w.loadProv !== "function"
            )
                throw { localMediaCode: "restricted" };
            var generation = ++remoteGeneration;
            var activating = true;
            var expectedLoad: any;
            var playbackOwner: (() => boolean) | null = null;
            var catalogLoad: any = null;
            var selectionContext = playbackIntentContext();
            function ownsActivation(): boolean {
                try {
                    return (
                        generation === remoteGeneration &&
                        admitted() &&
                        !localCall(w.__ottStandby, "blocked", [], 3) &&
                        selectionContext === playbackIntentContext() &&
                        (playbackOwner
                            ? playbackOwner() &&
                              (!catalogLoad ||
                                  catalogLoad === w.__ottCommandChannelLoad)
                            : activating ||
                              expectedLoad === w.__ottCommandChannelLoad)
                    );
                } catch (_) {
                    return false;
                }
            }
            playbackSelection.select(source, ids, seed);
            if (!ownsActivation()) throw { localMediaCode: localText11 };
            remoteOrderCurrent = ownsActivation;
            uiState.d = "local-" + ids[0];
            remoteHandoff = {
                bindCatalog: function () {
                    catalogLoad = w.__ottCommandChannelLoad;
                },
                bindOwner: function (active: () => boolean) {
                    playbackOwner = active;
                },
                catalog: catalog,
                current: ownsActivation,
            };
            finishLoading();
            uiState.e = false;
            uiState.i++;
            if (typeof w.closeList === "function") w.closeList();
            w.stbSetItem("ottplayprov", "offline");
            try {
                // Only the accepted provider handoff retires the previous
                // playback reader; waiting for another folder must not do so.
                catalogRevision++;
                w.loadProv("offline");
            } finally {
                expectedLoad = w.__ottCommandChannelLoad;
                activating = false;
            }
        },
        remoteCapabilities: function () {
            if (!api.available()) return undefined;
            return {
                absolute_paths: nativeSourcePaths,
                max_items: 50000,
                max_sources: 32,
                operations: ["sources", "play", "shuffle", "connect"],
                version: 1,
            };
        },
        remoteCatalog: function (
            current?: () => boolean,
            sourceId?: string,
            firstPlayable: ((value: any) => boolean) | null = null
        ): Promise<any> {
            if (isTauri() && sourceId) {
                var owner = catalogRevision;
                var cancelled = false;
                var active = function (): boolean {
                    return (
                        !cancelled &&
                        owner === catalogRevision &&
                        (!current || current())
                    );
                };
                var selected: any = getEndpoint(false, undefined, sourceId)
                    .then(function (base) {
                        if (!active()) return { cancelled: true, items: [] };
                        return pollCatalog(
                            base,
                            null,
                            active,
                            true,
                            undefined,
                            active,
                            sourceId,
                            firstPlayable
                        );
                    })
                    .then(function (value) {
                        if (!active()) return { ...value, cancelled: true };
                        if (!value.cancelled) last = value;
                        return value;
                    });
                selected.cancel = function () {
                    cancelled = true;
                };
                return selected;
            }
            if (
                localField(w.__ottActiveProviderDriver, "id") === "offline" &&
                localField(last, "scanning")
            )
                return Promise.reject({ localMediaCode: localText12 });
            var pending: any = list(
                function () {
                    return !current || current();
                },
                undefined,
                undefined,
                current,
                sourceId
            );
            var request = catalogRevision;
            pending.cancel = function () {
                if (request !== catalogRevision) return;
                catalogRevision++;
                last = null;
                cancelNativeList();
                browser.suspend();
            };
            return pending;
        },
        remoteConnect: function (
            path: string,
            current?: () => boolean,
            deadline?: number
        ): Promise<any> {
            if (!isTauri() || !nativeSourcePaths)
                return Promise.reject({ localMediaCode: "unsupported" });
            var request = catalogRevision;
            var requestId =
                "local-link-" + Date.now() + "-" + ++remoteLinkSequence;
            var cancelled = false;
            var settled = false;
            var pending: any = tauriInvoke<any>("local_media_link_folder", {
                path: path,
                requestId: requestId,
                ...(deadline === undefined
                    ? {}
                    : { deadlineMs: Math.floor(deadline) }),
            }).then(
                function (value) {
                    settled = true;
                    if (
                        !cancelled &&
                        request === catalogRevision &&
                        (!current || current())
                    )
                        last = null;
                    return value;
                },
                function (error) {
                    settled = true;
                    throw error;
                }
            );
            pending.cancel = function () {
                if (cancelled || settled) return;
                cancelled = true;
                try {
                    tauriInvoke("local_media_cancel_request", {
                        requestId: requestId,
                    }).catch(function () {});
                } catch (_) {
                    // Older native shells may not expose request cancellation.
                    // The response remains fenced by this request's lifetime.
                }
            };
            return pending;
        },
        remoteSources: function (
            includePaths = false,
            path?: string,
            current?: () => boolean,
            selection?: string
        ): Promise<any> {
            if (isTauri() && nativeSourcePaths)
                return tauriInvoke<any>("local_media_sources", {
                    includePaths: includePaths,
                    ...(path === undefined ? {} : { path: path }),
                    ...(selection === undefined
                        ? {}
                        : { selection: selection }),
                });
            if (includePaths || path)
                return Promise.reject(
                    new Error("Native source paths are unavailable")
                );
            if (last && !last.scanning && !last.cancelled)
                return Promise.resolve({ sources: last.sources || [] });
            if (localField(w.__ottActiveProviderDriver, "id") === "offline")
                return Promise.reject({ localMediaCode: localText12 });
            var pending: any = api.remoteCatalog(current);
            var result: any = pending.then(function (value: any) {
                return { sources: value.sources || [] };
            });
            result.cancel = pending.cancel;
            return result;
        },
        remove: remove,
        resume: function (skipScan = false, message = "") {
            // Backend exception text may contain private file paths. Keep only
            // our fixed timeout message or the sanitized filesystem error code.
            open(
                true,
                skipScan,
                message === localText10 ? message : failureMessage(last)
            );
        },
        settingsRevision: function () {
            return catalogRevision;
        },
        snapshot: function () {
            // Profile operations must never replace the provider's active scan.
            // Only a completed catalog describes every connected source.
            if (
                !last ||
                last.cancelled ||
                last.scanning ||
                last.scanError ||
                last.reconnectRequired
            )
                return Promise.reject(
                    new Error(
                        "Wait for the local media scan to finish before saving or binding a profile"
                    )
                );
            return Promise.resolve(JSON.parse(JSON.stringify(last)));
        },
        suspend: function () {
            cancelPlayback();
            retireRemotePlayback();
            cancelNativeList();
            catalogRevision++;
            uiState.i++;
            close();
        },
        takeImportSelection: function () {
            if (remoteHandoff && !remoteHandoff.current())
                retireRemotePlayback();
            var selected = uiState.d;
            uiState.d = "";
            try {
                var pending = w.stbGetItem(pendingFileKey);
                if (pending) {
                    var hint = JSON.parse(pending);
                    if (hint.namespace === w.__ottOfflineProfiles.namespace()) {
                        w.stbSetItem(pendingFileKey, "");
                        if (
                            !selected &&
                            typeof hint.id === "string" &&
                            hint.id.indexOf("local-") === 0
                        )
                            selected = hint.id;
                    }
                }
            } catch (_) {}
            return selected;
        },
        title: title,
    };
    w.__ottLocalMedia = api;
    if (isTauri())
        tauriInvoke<any>("local_media_capabilities", {}).then(
            function (value) {
                nativeSourcePaths = !!(
                    value &&
                    value.version === 1 &&
                    value.absolutePaths === true &&
                    value.sourcePaths === true
                );
            },
            function () {}
        );
    installOfflineProfiles(w, api);
    w.popLocalMedia = open;
    return api;
}

import {
    createDroppedPlaylists,
    hasDroppedPlaylist,
} from "../offline/dropped-playlist";
import { createDroppedVideos } from "../offline/dropped-video";

/** Desktop file gestures use the same temporary Local playback as remote commands. */
export function installLocalDrop(w: any): any {
    if (w.__ottLocalDrop) return w.__ottLocalDrop;
    var disposed = false;
    var sequence = 0;
    var pending: any = null;
    var active: any = null;
    var unlisten: (() => void) | null = null;
    var subscribed = false;
    var readySent = false;
    var native = !!(w.__TAURI__ || w.__TAURI_INTERNALS__);

    function ready(): void {
        if (
            disposed ||
            !native ||
            !subscribed ||
            readySent ||
            !w.__ottDesktopOpenReady
        )
            return;
        readySent = true;
        invoke("local_media_drop_ready", {}).catch(function () {
            readySent = false;
        });
    }

    function allowed(): boolean {
        try {
            return (
                !disposed &&
                !!w.__ottLocalMedia?.playDroppedVideo &&
                !w.__ottStandby?.blocked?.() &&
                !w.__ottKiosk?.enabled?.() &&
                !w.__ottKiosk?.locked?.() &&
                !w.__ottParental?.needs?.("providers") &&
                !w.__ottParental?.needs?.("settings")
            );
        } catch (_) {
            return false;
        }
    }
    function message(text: string): void {
        if (!disposed && typeof w.showShift === "function") w.showShift(text);
    }
    function failure(error: any): void {
        // Never surface native paths, signed URLs, or arbitrary IPC errors.
        var text = typeof error === "string" ? error : error?.message;
        var codes: any = {
            playlist_hls_local_unsupported: 0,
            playlist_invalid: 3,
            playlist_limit: 4,
            playlist_link_blocked: 6,
            playlist_link_unavailable: 7,
            playlist_local_unavailable: 1,
            playlist_unsupported: 2,
        };
        if (
            error &&
            Object.prototype.hasOwnProperty.call(
                codes,
                error.droppedPlaylistCode
            )
        )
            text = codes[error.droppedPlaylistCode];
        if (
            text ===
            "Local HLS manifests are not supported; add the HTTP(S) manifest URL as a playlist entry"
        )
            text = codes.playlist_hls_local_unsupported;
        if (text === "Dropped playlist must be UTF-8") text = 5;
        if (
            text ===
                "Dropped playlist exceeds the 8 MiB file or 16 MiB batch limit" ||
            text === "Dropped playlists exceed 20000 entries or 128 local files"
        )
            text = codes.playlist_limit;
        if (
            text === "Dropped playlist contains no playable entries" ||
            text === "Dropped playlist contains an invalid entry"
        )
            text = codes.playlist_invalid;
        // Keep literal translation keys visible to the catalog audit. Only the
        // closed diagnostic labels above may reach this switch.
        var _ = w._
            ? w._.bind(w)
            : function (value: string): string {
                  return value;
              };
        switch (text) {
            case 0:
            case "Local HLS manifests are not supported; use an HTTP(S) manifest URL":
                text = _(
                    "Local HLS manifests are not supported; use an HTTP(S) manifest URL"
                );
                break;
            case 1:
            case "Playlist local files must be dropped together with the playlist":
                text = _(
                    "Playlist local files must be dropped together with the playlist"
                );
                break;
            case 2:
            case "Playlist contains unsupported sources":
                text = _("Playlist contains unsupported sources");
                break;
            case 3:
            case "Playlist is empty or invalid":
                text = _("Playlist is empty or invalid");
                break;
            case 4:
            case "Playlist is too large":
                text = _("Playlist is too large");
                break;
            case 5:
            case "Playlist must use UTF-8":
                text = _("Playlist must use UTF-8");
                break;
            case 6:
                text = _("Playlist link is not public");
                break;
            case 7:
                text = _("Playlist link could not be loaded");
                break;
            default:
                text = _("Unsupported source");
        }
        message(text);
    }
    // A dropped playlist link that stayed one stream carries a closed reason;
    // a plain single-stream drop carries none and stays silent.
    function notice(catalog: any): void {
        if (!catalog) return;
        if (catalog.notice === "playlist_link_blocked")
            failure({ droppedPlaylistCode: "playlist_link_blocked" });
        else if (catalog.notice === "playlist_link_unavailable")
            failure({ droppedPlaylistCode: "playlist_link_unavailable" });
    }
    function invoke(name: string, args: any): Promise<any> {
        var bridge = w.__TAURI__?.core || w.__TAURI__;
        try {
            if (!bridge?.invoke) throw new Error("Native playback unavailable");
            return Promise.resolve(bridge.invoke(name, args));
        } catch (error) {
            return Promise.reject(error);
        }
    }
    function release(lease: any): void {
        if (!lease || lease.released) return;
        lease.released = true;
        if (active === lease) active = null;
        try {
            lease.release();
        } catch (_) {}
    }
    function cancelPending(): void {
        sequence++;
        if (!pending) return;
        var old = pending;
        pending = null;
        w.clearTimeout(old.timer);
        release(old);
    }
    function play(lease: any): void {
        if (!allowed()) {
            release(lease);
            return;
        }
        var previous = active;
        active = lease;
        try {
            w.__ottLocalMedia.playDroppedVideo(
                lease.catalog,
                function () {
                    return active === lease && !lease.released && allowed();
                },
                function () {
                    release(lease);
                }
            );
            notice(lease.catalog);
        } catch (_) {
            release(lease);
            if (previous && !previous.released) active = previous;
            message(
                w._
                    ? w._("Local source unavailable")
                    : "Local source unavailable"
            );
        }
    }
    function hasFiles(event: any): boolean {
        var transfer = event.dataTransfer;
        if (!transfer) return false;
        if (transfer.files?.length) return true;
        var types = transfer.types || [];
        for (var i = 0; i < types.length; i++)
            if (types[i] === "Files") return true;
        return false;
    }
    function dragOver(event: any): void {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = allowed() ? "copy" : "none";
    }
    function drop(event: any): void {
        if (!hasFiles(event)) return;
        // Never let the browser navigate away to the dropped file.
        event.preventDefault();
        event.stopPropagation();
        if (native || !allowed()) return;
        var files = event.dataTransfer.files;
        if (!files || files.length < 1 || files.length > 128) {
            failure(null);
            return;
        }
        if (hasDroppedPlaylist(files)) {
            // Capture the gesture's File references before the first await.
            var captured: any[] = [];
            for (var i = 0; i < files.length; i++) captured.push(files[i]);
            cancelPending();
            var request = sequence;
            var load = w.__ottCommandChannelLoad;
            var waiting: any = { release: function () {} };
            pending = waiting;
            waiting.timer = w.setTimeout(function () {
                if (pending === waiting) {
                    cancelPending();
                    failure(null);
                }
            }, 20000);
            createDroppedPlaylists(w, captured).then(
                function (lease) {
                    if (
                        pending !== waiting ||
                        request !== sequence ||
                        !allowed() ||
                        load !== w.__ottCommandChannelLoad
                    ) {
                        if (pending === waiting) {
                            pending = null;
                            w.clearTimeout(waiting.timer);
                        }
                        release(lease);
                        return;
                    }
                    pending = null;
                    w.clearTimeout(waiting.timer);
                    play(lease);
                },
                function (error) {
                    if (pending !== waiting) return;
                    pending = null;
                    w.clearTimeout(waiting.timer);
                    failure(error);
                }
            );
            return;
        }
        var lease: any;
        try {
            // Capture every File synchronously while the gesture owns DataTransfer.
            lease = createDroppedVideos(w, files);
        } catch (_) {
            message(w._ ? w._("Unsupported source") : "Unsupported source");
            return;
        }
        cancelPending();
        play(lease);
    }
    function nativeDrop(event: any): void {
        var grant = event?.payload?.grant;
        if (typeof grant !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(grant))
            return;
        var lease: any = {
            release: function () {
                invoke("local_media_release_drop", { grant: grant }).catch(
                    function () {}
                );
            },
        };
        if (!allowed()) {
            release(lease);
            return;
        }
        cancelPending();
        var request = sequence;
        // Startup may mount its optional provider after ready() has delivered
        // the OS file. The command generation owns the intent, not that driver
        // instance; a real subsequent source selection replaces this token.
        var load = w.__ottCommandChannelLoad;
        pending = lease;
        lease.timer = w.setTimeout(function () {
            if (pending !== lease) return;
            cancelPending();
            message(
                w._
                    ? w._("Local source unavailable")
                    : "Local source unavailable"
            );
        }, 20000);
        invoke("local_media_take_drop", { grant: grant }).then(
            function (catalog) {
                if (
                    pending !== lease ||
                    request !== sequence ||
                    !allowed() ||
                    load !== w.__ottCommandChannelLoad
                ) {
                    if (pending === lease) {
                        pending = null;
                        w.clearTimeout(lease.timer);
                    }
                    release(lease);
                    return;
                }
                pending = null;
                w.clearTimeout(lease.timer);
                lease.catalog = catalog;
                play(lease);
            },
            function (error) {
                if (pending !== lease) return;
                pending = null;
                w.clearTimeout(lease.timer);
                release(lease);
                failure(error);
            }
        );
    }
    function dispose(): void {
        if (disposed) return;
        disposed = true;
        cancelPending();
        release(active);
        try {
            if (unlisten) unlisten();
        } catch (_) {}
        w.removeEventListener("dragover", dragOver, true);
        w.removeEventListener("drop", drop, true);
        w.removeEventListener("pagehide", pageHide);
        if (w.__ottLocalDrop === api) delete w.__ottLocalDrop;
    }
    function pageHide(event: any): void {
        dispose();
        if (event?.persisted) {
            var restore = function (): void {
                w.removeEventListener("pageshow", restore);
                installLocalDrop(w);
            };
            w.addEventListener("pageshow", restore);
        }
    }
    var api = { dispose: dispose, ready: ready };
    w.__ottLocalDrop = api;
    w.addEventListener("dragover", dragOver, true);
    w.addEventListener("drop", drop, true);
    w.addEventListener("pagehide", pageHide);
    if (native && w.__TAURI__?.event?.listen) {
        try {
            Promise.resolve(
                w.__TAURI__.event.listen("local-media-drop", nativeDrop)
            )
                .then(function (remove: () => void) {
                    if (disposed) remove();
                    else {
                        unlisten = remove;
                        subscribed = true;
                        ready();
                    }
                })
                .catch(function () {});
        } catch (_) {}
    }
    return api;
}

if (typeof window !== "undefined") installLocalDrop(window);

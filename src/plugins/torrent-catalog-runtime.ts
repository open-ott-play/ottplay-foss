import { createTorrentCatalogRuntime } from "../provider/torrent-catalog";
import {
    encodeTorrentCatalog,
    normalizeTorrentCatalog,
} from "../provider/torrent-catalog-codec";

/** Browser adapter for the optional catalog service. Storage operations never mount a provider. */
export function createTorrentCatalogHost(w: any, options: any) {
    var runtime = options.runtime(),
        disposed = false;
    function native(): boolean {
        return !disposed && !!w.__ottMediaCompanion?.providerAvailable();
    }
    function restricted(op: string): boolean {
        if (["read", "read_chunk", "status", "cancel"].indexOf(op) >= 0)
            return false;
        return !!(
            w.__ottStandby?.blocked() ||
            w.__ottKiosk?.enabled() ||
            (w.__ottParental
                ? w.__ottParental.needs("settings") ||
                  w.__ottParental.needs("providers") ||
                  (op === "play" && w.__ottParental.needs("channels"))
                : (w.sPSoptions ||
                      w.sPSprovs ||
                      (op === "play" && w.sPSchannels)) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess)
        );
    }
    function current(): boolean {
        return !disposed && runtime === options.runtime();
    }
    function base64(bytes: Uint8Array): string {
        var parts: string[] = [];
        for (var i = 0; i < bytes.length; i += 8192)
            parts.push(
                String.fromCharCode.apply(
                    null,
                    Array.prototype.slice.call(bytes.subarray(i, i + 8192))
                )
            );
        return w.btoa(parts.join(""));
    }
    function digest(bytes: Uint8Array): Promise<string> {
        return w.crypto.subtle.digest("SHA-256", bytes).then(function (
            result: ArrayBuffer
        ) {
            return Array.prototype.map
                .call(new Uint8Array(result), function (value: number) {
                    return ("0" + value.toString(16)).slice(-2);
                })
                .join("");
        });
    }
    function uuid(): string {
        var bytes = new Uint8Array(16);
        w.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.prototype.map
            .call(bytes, function (value: number) {
                return ("0" + value.toString(16)).slice(-2);
            })
            .join("");
        return (
            hex.slice(0, 8) +
            "-" +
            hex.slice(8, 12) +
            "-" +
            hex.slice(12, 16) +
            "-" +
            hex.slice(16, 20) +
            "-" +
            hex.slice(20)
        );
    }
    function invalidate(): void {
        var driver = w.__ottActiveProviderDriver;
        if (driver?.id === "torrent" && driver.invalidateCatalog)
            driver.invalidateCatalog();
    }
    function play(
        target: any,
        guard: () => boolean,
        done: (ok: boolean) => void
    ): () => void {
        var timer: any = null,
            closed = false,
            accepted = false,
            starting = true,
            driver: any = null,
            session: any = null,
            load: any;
        var marker: any = {},
            expected =
                "torrent:" +
                target.catalog_id +
                ":" +
                target.entry_id +
                ":" +
                target.file_index;
        function valid(): boolean {
            return (
                current() &&
                guard() &&
                !restricted("play") &&
                !marker.cancelled &&
                (starting || w.stbGetItem("ottplayprov") === "torrent") &&
                (!session || session.active()) &&
                (!driver || driver === w.__ottActiveProviderDriver) &&
                (!driver || load === w.__ottCommandChannelLoad)
            );
        }
        marker.current = function () {
            return w.__ottGlobalFavoritesHandoff === marker && valid();
        };
        marker.blocks = function () {
            return (
                w.__ottGlobalFavoritesHandoff === marker &&
                (!closed || marker.cancelled) &&
                (!session || session.active())
            );
        };
        marker.accept = function (command: any): boolean {
            var selected =
                command.channelSelection === undefined
                    ? command.channelId
                    : command.channelSelection;
            if (!valid() || !driver || String(selected) !== expected) {
                marker.cancelled = true;
                return false;
            }
            return true;
        };
        function finish(ok: boolean): void {
            if (closed) return;
            accepted = ok && valid();
            closed = true;
            if (timer !== null) w.clearTimeout(timer);
            if (w.__ottGlobalFavoritesHandoff === marker) {
                marker.cancelled = !accepted;
                if (
                    accepted ||
                    w.commandChannelsReady ||
                    (session && !session.active())
                )
                    w.__ottGlobalFavoritesHandoff = null;
            }
            done(accepted);
        }
        function step(): void {
            timer = null;
            if (!valid()) {
                finish(false);
                return;
            }
            var active = w.__ottActiveProviderDriver;
            if (active && active.id === "torrent") {
                if (!driver) {
                    driver = active;
                    load = w.__ottCommandChannelLoad;
                }
                if (w.commandChannelsReady) {
                    var group = w.__ottChannels?.index("system:all"),
                        members = group >= 0 && w.cats[w.catsArray[group]],
                        index = Array.isArray(members)
                            ? members.indexOf(expected)
                            : -1;
                    if (
                        index < 0 ||
                        typeof w.playChannel !== "function" ||
                        !valid()
                    ) {
                        finish(false);
                        return;
                    }
                    var result = w.playChannel(
                        group,
                        index,
                        true,
                        valid,
                        undefined,
                        false,
                        false,
                        finish,
                        valid
                    );
                    if (result !== true) finish(false);
                    return;
                }
            }
            timer = w.setTimeout(step, 50);
        }
        if (!valid() || w.__ottGlobalFavoritesHandoff?.current()) {
            finish(false);
            return function () {};
        }
        w.__ottClassicPlayback?.checkpointNow();
        if (!valid()) {
            finish(false);
            return function () {};
        }
        w.__ottGlobalFavoritesHandoff = marker;
        if (w.__ottActiveProviderDriver?.id === "torrent") w.loadChannels();
        else if (!options.select()) {
            finish(false);
            return function () {};
        }
        session = w.__ottProviderRuntime?.classic.current?.();
        starting = false;
        step();
        return function () {
            if (!accepted) finish(false);
        };
    }
    var service = createTorrentCatalogRuntime({
        capture: function () {
            var driver = w.__ottActiveProviderDriver,
                load = w.__ottCommandChannelLoad,
                generation = w.__ottClassicPlayback?.snapshot?.()?.generation;
            return {
                current: function () {
                    return (
                        current() &&
                        driver === w.__ottActiveProviderDriver &&
                        load === w.__ottCommandChannelLoad &&
                        generation ===
                            w.__ottClassicPlayback?.snapshot?.()?.generation
                    );
                },
            };
        },
        clearTimeout: function (timer) {
            w.clearTimeout(timer);
        },
        decodeBase64: function (value) {
            if (
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                    value
                )
            )
                throw new Error("invalid_request");
            var binary = w.atob(value),
                bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++)
                bytes[i] = binary.charCodeAt(i);
            if (base64(bytes) !== value) throw new Error("invalid_request");
            return bytes;
        },
        encodeBase64: base64,
        invalidate: invalidate,
        metadata: function (source, done) {
            var cancelled = false,
                release = function () {};
            w.__ottMediaCompanion.ensure(true).then(
                function (client: any) {
                    if (cancelled) return;
                    release = client.metadata(
                        source,
                        function (files: any, reason?: string) {
                            if (!cancelled) done(files, reason);
                        }
                    );
                    if (cancelled) release();
                },
                function () {
                    if (!cancelled) done(null, "metadata_failed");
                }
            );
            return function () {
                cancelled = true;
                release();
            };
        },
        nativeAvailable: native,
        now: function () {
            return Date.now();
        },
        play: play,
        restricted: restricted,
        runtime: options.runtime,
        setTimeout: function (callback, delay) {
            return w.setTimeout(callback, delay);
        },
        sha256: digest,
        storage: options.storage,
        uuid: uuid,
    });
    function dispose(): void {
        disposed = true;
        service.dispose();
    }
    if (w.addEventListener) w.addEventListener("pagehide", dispose);
    return {
        dispose: dispose,
        request: service.request,
        save: async function (
            value: any,
            before: string | null,
            guard: () => boolean
        ): Promise<boolean> {
            try {
                encodeTorrentCatalog(value);
                var after = JSON.stringify(normalizeTorrentCatalog(value)),
                    grant = options.storage();
                var admitted = function (): boolean {
                    return (
                        current() &&
                        native() &&
                        !restricted("write_commit") &&
                        guard()
                    );
                };
                if (!grant || !admitted()) return false;
                var result = await grant.exclusive(function (owned: any) {
                    return owned.compareAndSwap(
                        "torrentcfg",
                        before,
                        after,
                        admitted
                    );
                });
                if (
                    result !== "confirmed" ||
                    !admitted() ||
                    grant.read("torrentcfg") !== after
                )
                    return false;
                invalidate();
                return true;
            } catch (_) {
                return false;
            }
        },
    };
}
if (typeof window !== "undefined")
    (window as any).__ottTorrentCatalogRuntime = {
        create: createTorrentCatalogHost,
    };

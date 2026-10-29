import { captureGlobalFavorite } from "./global-favorites-capture";
/** Incremental migration of the already-loaded source only. Originals are never removed. */
export async function captureGlobalFavoriteMigration(
    w: any,
    player: any,
    codec: any
): Promise<any> {
    var driver = w.__ottActiveProviderDriver,
        load = w.__ottCommandChannelLoad;
    if (!driver || !w.commandChannelsReady || driver.catalogLoading?.())
        return null;
    if (driver.id === "offline") {
        var local = w.__ottLocalMedia?.favoriteSnapshot();
        if (!local || !local.current() || local.catalog.scanning) return null;
    }
    var tv = w.__ottFavoritesLibrary?.captureGlobal(),
        media = w.__ottMedia?.captureGlobalFavorites();
    if (!tv && !media) return null;
    var capturedGuards: (() => boolean)[] = [],
        complete = false;
    function current() {
        return (
            driver === w.__ottActiveProviderDriver &&
            load === w.__ottCommandChannelLoad &&
            w.commandChannelsReady &&
            !driver.catalogLoading?.() &&
            player.allowed() &&
            (!tv || tv.current()) &&
            (!media || media.current()) &&
            (!complete ||
                capturedGuards.every(function (guard) {
                    return guard();
                }))
        );
    }
    if (!current()) return null;
    var payloads: any[] = [],
        pending: any[] = [];
    var refs =
        driver.id === "plex" &&
        driver.favoritesSource?.() &&
        w.__ottFavoritesPlexReferences
            ? w.__ottFavoritesPlexReferences.create(
                  w.channels,
                  driver.favoritesSource()
              )
            : w.__ottChannelReferences.create(
                  w.channels,
                  w.__ottLegacyChannelAliases
              );
    if (tv)
        tv.document.lists.order.forEach(function (name: string) {
            (tv.document.lists.lists[name] || []).forEach(function (
                reference: any
            ) {
                var id = refs.project(reference),
                    channel = id !== null && w.channels[id];
                if (!channel) {
                    pending.push({ title: name, reason: "missing" });
                    return;
                }
                payloads.push(
                    channel.__ottMediaItem || { __ottGlobalChannel: id }
                );
            });
        });
    if (media)
        media.favorites.forEach(function (row: any) {
            var payload = row.payload;
            if (driver.id === "offline") {
                var snapshot = w.__ottLocalMedia?.favoriteSnapshot();
                var matches =
                    snapshot &&
                    snapshot.current() &&
                    snapshot.catalog.items.filter(function (item: any) {
                        return (
                            payload &&
                            String(item.id) === String(payload.id) &&
                            item.available !== false
                        );
                    });
                if (!matches || matches.length !== 1) {
                    pending.push({
                        title: payload?.title || "Favorites",
                        reason: "missing",
                    });
                    return;
                }
                payload = Object.assign({}, payload, {
                    __ottGlobalChannel: "local-" + matches[0].id,
                });
            }
            payloads.push(payload);
        });
    var entries: any[] = [],
        identities: any = Object.create(null);
    for (var i = 0; i < payloads.length; i++) {
        if (!current()) return null;
        var captured = await captureGlobalFavorite(
            w,
            player,
            codec,
            payloads[i]
        );
        if (!current()) return null;
        if (!captured || !captured.current()) {
            pending.push({
                title: payloads[i]?.title || "Favorites",
                reason: "unresolved",
            });
            continue;
        }
        capturedGuards.push(captured.current);
        var id = codec.identity(captured.value);
        if (!identities[id]) {
            identities[id] = true;
            entries.push(captured.value);
        }
    }
    complete = true;
    return current()
        ? {
              entries: entries,
              pending: pending,
              current: current,
              identity: globalFavoriteMigrationSource(w),
          }
        : null;
}

/** Stable private namespace shared by migration and explicit removal tombstones. */
export function globalFavoriteMigrationSource(w: any): string {
    return JSON.stringify([
        "global-favorites-source-membership-v1",
        w.__ottSourceIdentity.current(w),
    ]);
}

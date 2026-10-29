import {
    globalFavoriteBuiltin,
    globalFavoriteBuiltinSlot,
    globalFavoriteProviderName,
} from "./global-favorites-providers";
import {
    globalFavoriteChannelId,
    globalFavoriteProviderId,
} from "./global-favorites-identities";
/** Capture only current, provider-owned identities; no stream URLs enter global Favorites. */
export async function captureGlobalFavorite(
    w: any,
    player: any,
    codec: any,
    payload?: any
): Promise<any> {
    var driver = w.__ottActiveProviderDriver,
        state = w.__ottClassicPlayback?.snapshot();
    var generation = state?.generation,
        source = w.__ottSourceIdentity.current(w);
    var load = w.__ottCommandChannelLoad,
        catalogCurrent: (() => boolean) | null = null;
    function current(): boolean {
        return (
            driver === w.__ottActiveProviderDriver &&
            load === w.__ottCommandChannelLoad &&
            source === w.__ottSourceIdentity.current(w) &&
            generation === w.__ottClassicPlayback?.snapshot().generation &&
            (!catalogCurrent || catalogCurrent()) &&
            player.allowed()
        );
    }
    if (!driver || !current()) return null;
    if (payload?.adult === 1 && w.__ottParental?.needs("channels")) return null;
    var provider = driver.id,
        config = driver.configuration?.();
    var builtin = globalFavoriteBuiltin(w, provider);
    var slot =
        provider === "plex"
            ? null
            : config?.active === undefined
              ? globalFavoriteBuiltinSlot(w, builtin || {})
              : config.active;
    if (provider === "offline") {
        var active = w.__ottOfflineProfiles?.read().active;
        slot = typeof active === "number" && active >= 0 ? active : null;
    }
    var selected = player.selected(provider, slot);
    var profile = provider === "offline" ? selected?.profile : selected;
    var profileName =
        provider === "plex"
            ? "Plex"
            : provider === "offline" && slot === null
              ? "Local videos"
              : profile?.name || builtin?.title;
    if (!profileName || typeof profileName !== "string") return null;
    var origin: any = {
        provider: globalFavoriteProviderName(provider),
        profile: profileName,
        subprofile: null,
        sourceAlias: profileName,
    };
    var locator: any = null,
        root: any = null,
        title = "";
    if (!payload) {
        var playing = w.__ottMedia?.current();
        if (
            playing &&
            state?.target?.kind === "vod" &&
            playing.ref.sourceId === state.target.sourceId &&
            playing.ref.itemId === state.target.channelId
        )
            payload = playing.payload;
    }
    if (provider === "offline") {
        var view = w.__ottLocalMedia?.favoriteSnapshot();
        if (!view) return null;
        var catalog = view.catalog;
        catalogCurrent = view.current;
        if (
            !current() ||
            !catalog ||
            catalog.cancelled ||
            (!selected.binding && slot !== null)
        )
            return null;
        var id = String(
            payload?.__ottGlobalChannel === undefined
                ? state?.target?.channelId || ""
                : payload.__ottGlobalChannel
        )
            .replace(/^channel:/, "")
            .replace(/^local-/, "");
        var items = catalog.items.filter(function (item: any) {
            return item.id === id && item.available !== false;
        });
        if (items.length !== 1) return null;
        var item = items[0];
        var keys =
            slot === null
                ? ["s0"]
                : Object.keys(selected.binding.sources).filter(function (key) {
                      return selected.binding.sources[key] === item.sourceId;
                  });
        if (keys.length !== 1) return null;
        var roots =
            slot === null
                ? catalog.sources.filter(function (candidate: any) {
                      return candidate.id === item.sourceId;
                  })
                : selected.profile.sources.filter(function (candidate: any) {
                      return candidate.key === keys[0];
                  });
        if (roots.length !== 1 || roots[0].kind !== "folder") return null;
        origin.sourceAlias = roots[0].name;
        root = { alias: roots[0].name, key: keys[0], id: item.sourceId };
        locator = {
            kind: "local-media",
            rootAlias: root.alias,
            relativePath: item.name,
        };
        title = item.name;
    } else if (provider === "plex") {
        if (
            !payload ||
            payload.plexSource !== w.__ottSourceIdentity.media(w) ||
            (payload.__ottMediaRef &&
                payload.__ottMediaRef.sourceId !==
                    w.__ottSourceIdentity.media(w))
        )
            return null;
        var proof = driver.favoritesSource?.();
        var match =
            payload?.request &&
            /^\/library\/metadata\/([1-9][0-9]{0,19})$/.exec(
                payload.request.path
            );
        if (!proof || !proof.current() || !match) return null;
        origin.sourceAlias = proof.serverId;
        locator = {
            kind: "plex-media",
            serverId: proof.serverId,
            ratingKey: match[1],
        };
        title = payload.title;
    } else if (
        provider === "m3u" &&
        payload?.vportalSource &&
        w.__ottEmbeddedVPortal?.current()
    ) {
        var embedded = w.__ottEmbeddedVPortal;
        if (payload.vportalSource !== w.__ottSourceIdentity.media(w))
            return null;
        var attested = payload.__ottFavoriteId;
        if (!attested || globalFavoriteProviderId(attested.value) === null)
            return null;
        origin.subprofile = payload.__ottMediaCategory?.name || null;
        locator = {
            kind: "vportal-media",
            idField: attested.field,
            id: globalFavoriteProviderId(attested.value),
        };
        title = payload.title;
    } else if (provider === "vportal") {
        if (driver.catalogLoading?.() || driver.catalogError?.()) return null;
        if (
            !payload ||
            payload.vportalSource !== w.__ottSourceIdentity.media(w) ||
            (payload.__ottMediaRef &&
                payload.__ottMediaRef.sourceId !==
                    w.__ottSourceIdentity.media(w))
        )
            return null;
        // The collector provides the full nested folder label; it is not an endpoint or request.
        var category = payload.__ottMediaCategory;
        if (category && typeof category.name === "string")
            origin.subprofile = category.name;
        var attested = payload.__ottFavoriteId;
        if (attested && globalFavoriteProviderId(attested.value) !== null) {
            var providerItemId = globalFavoriteProviderId(attested.value);
            if (providerItemId === null) return null;
            var matches = (w.cList || []).filter(function (channel: any) {
                var item = w.channels[channel]?.__ottMediaItem,
                    proof = item?.__ottFavoriteId;
                return (
                    item?.vportalSource === w.__ottSourceIdentity.media(w) &&
                    proof?.field === attested.field &&
                    globalFavoriteProviderId(proof?.value) === providerItemId &&
                    (origin.subprofile === null ||
                        (item.__ottMediaCategories || []).some(function (
                            category: any
                        ) {
                            return category.name === origin.subprofile;
                        }))
                );
            });
            if (matches.length === 1)
                locator = {
                    kind: "vportal-media",
                    idField: attested.field,
                    id: providerItemId,
                };
        }
        title = payload.title;
    } else if (
        (provider === "m3u" || builtin) &&
        provider !== "offline" &&
        provider !== "plex" &&
        provider !== "vportal"
    ) {
        if (builtin?.kind === "edem" || provider === "kb-team")
            origin.subprofile = "Playlist " + (slot + 1);

        if (
            payload?.__ottGlobalChannel === undefined &&
            (!state?.target ||
                state.target.sourceId !== source ||
                state.phase === "idle" ||
                state.phase === "stopped")
        )
            return null;
        var references = w.__ottChannelReferences.create(
            w.channels,
            w.__ottLegacyChannelAliases
        );
        var channelId =
            payload?.__ottGlobalChannel === undefined
                ? state.target.channelId
                : payload.__ottGlobalChannel;
        var reference = /^-?\d+$/.test(String(channelId))
            ? references.resolve(channelId, "canonical")
            : { itemId: channelId };
        var projected = references.project(reference),
            channel = projected !== null && w.channels[projected];
        var stable = globalFavoriteChannelId(provider, channel);
        if (
            stable &&
            (w.cList || []).filter(function (id: any) {
                return (
                    globalFavoriteChannelId(provider, w.channels[id]) === stable
                );
            }).length === 1
        )
            locator = { kind: "channel", channelId: stable };
        else {
            if (
                !channel ||
                typeof channel.channel_name !== "string" ||
                !channel.channel_name
            )
                return null;
            var names = (w.cList || []).filter(function (id: any) {
                return w.channels[id]?.channel_name === channel.channel_name;
            });
            locator = {
                kind: "channel-name",
                name: channel.channel_name,
                group: null,
            };
            if (names.length !== 1) {
                var group = channel.category?.name;
                if (
                    typeof group !== "string" ||
                    !group ||
                    names.filter(function (id: any) {
                        return w.channels[id]?.category?.name === group;
                    }).length !== 1
                )
                    return null;
                locator.group = group;
            }
        }
        title = channel.channel_name;
    }
    var value = codec.normalize({
        title: title,
        origin: origin,
        locator: locator,
    });
    if (!value || !current()) return null;
    var selector = await player.captureSelector(value.origin, slot, root);
    if (!selector || !current()) return null;
    var captured = {
        value: value,
        selector: selector,
        slot: slot,
        root: root,
        current: current,
    };
    return player.canonicalizeFavorite
        ? player.canonicalizeFavorite(captured)
        : captured;
}

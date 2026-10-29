/** Track controls loaded with Shaka, outside the default player payload. */
(function (host: any) {
    host.__ottShakaTracks = function (
        player: any,
        selected?: number,
        audio?: boolean
    ): any[] {
        var modern = typeof player.getAudioTracks === "function";
        var source = audio
            ? modern
                ? player.getAudioTracks()
                : player.getVariantTracks()
            : player.getTextTracks();
        if (audio && !modern)
            source.sort(function (a: any, b: any) {
                return +b.active - +a.active;
            });
        var seen: string[] = [],
            rows: any[] = [],
            active = false;
        var registry =
            player.__ottTrackKeys || (player.__ottTrackKeys = [[], []]);
        var known: string[] = registry[audio ? 0 : 1];
        var visible = !player.isTextTrackVisible || player.isTextTrackVisible();
        for (var i = 0; i < source.length; i++) {
            var track = source[i],
                roles = track.audioRoles || track.roles || [],
                key = String(track.id);
            active = active || track.active;
            if (audio) {
                key = JSON.stringify(
                    modern
                        ? [
                              track.language,
                              roles,
                              track.label,
                              track.channelsCount,
                              track.codecs,
                              track.spatialAudio,
                          ]
                        : [track.language, roles]
                );
                if (seen.indexOf(key) >= 0) continue;
                seen.push(key);
            }
            var id = known.indexOf(key);
            if (id < 0) id = known.push(key) - 1;
            if (!audio) id++;
            if (selected !== undefined) {
                if (id !== selected) continue;
                // These APIs preserve adaptation and avoid choosing an arbitrary video quality.
                if (audio && !track.active) {
                    if (modern) player.selectAudioTrack(track);
                    else player.selectAudioLanguage(track.language, roles[0]);
                } else if (!audio) {
                    if (!track.active) player.selectTextTrack(track);
                    if (!visible && player.setTextTrackVisibility)
                        player.setTextTrackVisibility(true);
                }
            } else
                rows.push({
                    id: id,
                    language: track.language || "?",
                    name:
                        track.label ||
                        roles.join(",") ||
                        track.language ||
                        "#" + id,
                    selected: !!track.active && (audio || visible),
                });
        }
        if (!audio && selected === 0) {
            if (player.setTextTrackVisibility) {
                if (visible) player.setTextTrackVisibility(false);
            } else if (active) player.selectTextTrack(null);
        }
        return rows;
    };
})(window);

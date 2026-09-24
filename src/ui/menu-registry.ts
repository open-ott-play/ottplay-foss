interface ScreenMenuRecord {
    action: () => void;
    color?: string;
    detail: string;
    hint?: string;
    id: string;
    legacyId: string;
    number?: string;
    sourceIndex: number;
    title: string;
}
/** Stable command identities are independent of translated labels and function names. */
var screenMenuDefinitions: Array<
    [string, string, string, string?, string?, string?, string?]
> = [
    [
        "video.aspect",
        "toggleAspectRatio",
        "Toggle Aspect Ratio",
        "",
        "",
        "",
        "strAspect",
    ],
    ["video.zoom", "toggleZoom", "Toggle Zoom Mode", "", "", "", "strZoom"],
    [
        "audio.track",
        "toggleAudioTrack",
        "Switch sound track",
        "",
        "1",
        "",
        "strAudio",
    ],
    [
        "subtitle.track",
        "toggleSubtitle",
        "Switch subtitle",
        "",
        "",
        "",
        "strSubt",
    ],
    [
        "channel.previous",
        "popPrevProg",
        "Return to previous channel",
        "",
        "3",
        "",
        "strPRECH",
    ],
    ["playback.toggle", "popPause", "Pause/Play", "", "", "", "strPlayPause"],
    [
        "playback.live",
        "popStop",
        "Restart stream / Live",
        "",
        "7",
        "",
        "strSTOP",
    ],
    ["archive.seek", "popShift", "Rewind", "Show rewind window", "4"],
    [
        "pip.toggle",
        "popTogglePip",
        "Call PiP / PiP exchange",
        "",
        "5",
        "",
        "strPip",
    ],
    ["pip.close", "popStopPip", "Close PiP", "", "6"],
    ["channels.categories", "popBuckets", "Category selection", "", "", "blue"],
    ["guide.open", "popEpg", "Show EPG and archive for channel", "", "", "red"],
    [
        "archive.records",
        "popRecords",
        "Show list of channel archive records",
        "Show list of channel archive records without duplication",
        "",
        "green",
    ],
    ["media.open", "popMedia", "Show Media Library", "", "", "yellow"],
    ["provider.unlock", "toggleProviderSettingsVisibility", ""],
    ["provider.settings", "noop", ""],
    ["settings.open", "optionsList", "Settings", "", "9", "", "strTools"],
    ["app.restart", "restart", "Restart player", "", "8"],
    ["app.exit", "exitPortal", "Exit player", "", "0"],
    ["information.open", "infoList", "Information", "", "2", "", "strInfo"],
    ["favorites.open", "popFavLists", "Favorite lists"],
];
function createScreenMenuRegistry() {
    function defaults(host: any) {
        return {
            actions: screenMenuDefinitions.map(function (record) {
                return host[record[1]];
            }),
            details: screenMenuDefinitions.map(function (record) {
                return record[3] || null;
            }),
            labels: screenMenuDefinitions.map(function (record) {
                return record[2];
            }),
        };
    }
    function importClassic(host: any): ScreenMenuRecord[] {
        // Existing provider codecs are an explicit input codec, never menu policy.
        var records: ScreenMenuRecord[] = [];
        (host.popupActions || []).forEach(function (
            action: any,
            index: number
        ) {
            if (typeof action !== "function") return;
            var definition: any = null;
            screenMenuDefinitions.some(function (candidate) {
                if (host[candidate[1]] !== action) return false;
                definition = candidate;
                return true;
            });
            var title = String((host.popupArray || [])[index] || "");
            var legacyNames: any = {
                "provider.settings": "nofun",
                "provider.unlock": "noProvParam",
            };
            var legacyId = host.popupActionId
                ? host.popupActionId(action)
                : definition
                  ? legacyNames[definition[0]] || definition[1]
                  : action.name || "";
            records.push({
                action: action,
                color: definition && definition[5],
                detail: String((host.popupDetail || [])[index] || title),
                hint: definition && host[definition[6]],
                id: definition
                    ? definition[0]
                    : "provider:" + String(host.p_pref || "") + ":" + index,
                legacyId: legacyId,
                number: definition && definition[4],
                sourceIndex: index,
                title: title,
            });
        });
        return records;
    }
    function available(record: ScreenMenuRecord, host: any): boolean {
        var channelId = (host.curList || [])[host.primaryIndex];
        var channel = (host.channels || {})[channelId];
        var predicate: any = {
            "archive.records": archive,
            "archive.seek": archive,
            "audio.track": function () {
                return (
                    !!channelId &&
                    host.stbAudioTracksExists &&
                    host.stbAudioTracksExists()
                );
            },
            "media.open": function () {
                return typeof host.getMediaArray === "function";
            },
            "pip.close": function () {
                return host.pipIndex != null;
            },
            "playback.toggle": archive,
            "subtitle.track": function () {
                return (
                    !!channelId &&
                    host.stbSubtitleExists &&
                    host.stbSubtitleExists()
                );
            },
        };
        function archive() {
            return host.playType < 0 || !channelId || !channel || !!channel.rec;
        }
        return !predicate[record.id] || !!predicate[record.id]();
    }
    function open(host: any, selected: any) {
        var records = importClassic(host);
        var hidden = host.sHideMenus || [];
        var focus = 0;
        var rows = records
            .filter(function (record) {
                return (
                    hidden.indexOf(record.id) < 0 &&
                    hidden.indexOf(record.legacyId) < 0 &&
                    available(record, host)
                );
            })
            .map(function (record, index) {
                if (
                    selected === record.id ||
                    selected === record.action ||
                    selected == record.sourceIndex
                )
                    focus = index;
                var name = record.title;
                var toggles: any = {
                    "pip.toggle": host.pipIndex != null,
                    "playback.live": !!host.playType,
                    "playback.toggle": !!(
                        host.stbIsPlaying && host.stbIsPlaying()
                    ),
                };
                if (toggles[record.id] !== undefined && name.indexOf("/") >= 0)
                    name = name.split("/")[toggles[record.id] ? 1 : 0].trim();
                if (!host.sNoNumbersKeys && record.number)
                    name =
                        '<div class="btn">' + record.number + "</div> " + name;
                if (!host.sNoColorKeys && record.color)
                    name =
                        '<div class="btn ' +
                        record.color +
                        '">&nbsp;</div> ' +
                        name;
                if (record.hint)
                    name = '<div class="btn">' + record.hint + "</div> " + name;
                return {
                    action: record.action,
                    desc: record.detail,
                    id: record.id,
                    name: name,
                };
            });
        return {
            command: function (code: number) {
                var keys = host.keys;
                var bindings: Array<[string, string]> = [
                    ["ZOOM", "video.zoom"],
                    ["ASPECT", "video.aspect"],
                    ["N0", "app.exit"],
                    ["N1", "audio.track"],
                    ["AUDIO", "audio.track"],
                    ["N2", "information.open"],
                    ["N3", "channel.previous"],
                    ["N4", "archive.seek"],
                    ["N5", "pip.toggle"],
                    ["N6", "pip.close"],
                    ["N7", "playback.live"],
                    ["N8", "app.restart"],
                    ["N9", "settings.open"],
                    ["TOOLS", "settings.open"],
                    ["SUBTITLE", "subtitle.track"],
                    ["EPG", "guide.open"],
                    ["RED", "guide.open"],
                    ["GREEN", "archive.records"],
                    ["BLUE", "channels.categories"],
                    ["PREV", "channels.categories"],
                ];
                for (var i = 0; i < bindings.length; i++)
                    if (keys[bindings[i][0]] && code === keys[bindings[i][0]])
                        return bindings[i][1];
                return "";
            },
            focus: focus,
            invoke: function (id: string) {
                var record = records.filter(function (entry) {
                    return entry.id === id;
                })[0];
                if (record) record.action();
            },
            records: records,
            rows: rows,
        };
    }
    return { defaults: defaults, importClassic: importClassic, open: open };
}
(window as any).__ottMenuRegistry = createScreenMenuRegistry();

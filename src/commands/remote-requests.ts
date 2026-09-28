import {
    checkProviderUrl,
    isProviderAllowed,
    providerIds,
    providerLabels,
    selectProviderByIndex,
} from "../provider";
import { handleCommand } from "./index";

/** Queries expose metadata only: never URLs, credentials or the settings store. */
export function executeRemoteRequest(
    request: any,
    done: (result: any) => void
): (() => void) | void {
    var w = window as any;
    var params = request.params || {};
    function reply(data: any): void {
        done({ data: data, status: "ok" });
    }
    function reject(message: string, matches?: any[]): void {
        done({
            data: { error: message, matches: matches || [] },
            status: "rejected",
        });
    }
    function volume(): number | null {
        var value =
            typeof w.stbGetVolume === "function" ? w.stbGetVolume() : null;
        return typeof value === "number" &&
            isFinite(value) &&
            value >= 0 &&
            value <= 100
            ? value
            : null;
    }
    function activeProvider(): string {
        return w.__ottActiveProviderDriver
            ? w.__ottActiveProviderDriver.id
            : String(w.stbGetItem("ottplayprov") || "");
    }
    function channels(): any[] {
        var ids = w.cList || w.curList || [];
        var seen: Record<string, boolean> = Object.create(null);
        return ids
            .filter(function (id: any) {
                if (seen[String(id)] || !(w.channels || {})[id]) return false;
                seen[String(id)] = true;
                return true;
            })
            .map(function (id: any, index: number) {
                return {
                    id: id,
                    name: String(w.channels[id].channel_name || ""),
                    number: index + 1,
                };
            });
    }
    function includes(value: string, search: any): boolean {
        return (
            value.toLowerCase().indexOf(String(search || "").toLowerCase()) !==
            -1
        );
    }
    function providers(): any[] {
        return providerIds
            .map(function (id, index) {
                return {
                    active: id === activeProvider(),
                    id: id,
                    index: index,
                    name: (providerLabels && providerLabels[index]) || id,
                };
            })
            .filter(function (row) {
                return row.id && isProviderAllowed(row.id);
            });
    }
    function settingsLocked(): boolean {
        return w.__ottParental
            ? w.__ottParental.needs("providers") ||
                  w.__ottParental.needs("options")
            : (w.sPSprovs || w.sPSoptions) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess;
    }
    if (request.action === "status") {
        reply({
            channels: channels().length,
            provider: activeProvider(),
            ready: w.commandChannelsReady === true,
            uuid: w.deviceUUID || "",
            volume: volume(),
        });
        return;
    }
    if (request.action === "providers") {
        reply({ providers: providers() });
        return;
    }
    if (request.action === "provider") {
        var query = String(params.query).toLowerCase();
        var all = providers();
        var found = all.filter(function (row) {
            return (
                row.id.toLowerCase() === query || String(row.index) === query
            );
        });
        if (!found.length)
            found = all.filter(function (row) {
                return includes(row.name, query);
            });
        if (found.length !== 1) {
            reject("Choose one provider by ID or index.", found);
            return;
        }
        if (!selectProviderByIndex(found[0].index)) {
            reject(
                "Provider switch rejected; check parental access and platform policy."
            );
            return;
        }
        reply({ dispatched: true, provider: found[0].id });
        return;
    }
    if (request.action === "provider_settings") {
        var driver = w.__ottActiveProviderDriver;
        if (!driver || driver.id !== params.provider) {
            reject("Select this provider before changing its settings.");
            return;
        }
        if (!isProviderAllowed(driver.id) || settingsLocked()) {
            reject("Unlock provider settings on the player first.");
            return;
        }
        var schemas: Record<string, string[]> = {
            m3u: ["playlist"],
            ottclub: ["server", "key"],
            stalker: ["server", "mac"],
            xtream: ["server", "username", "password"],
        };
        var schema = schemas[driver.id];
        var fields = Object.keys(params.settings || {});
        if (
            !schema ||
            !fields.length ||
            fields.some(function (key) {
                return (
                    schema.indexOf(key) < 0 ||
                    typeof params.settings[key] !== "string" ||
                    params.settings[key].length > 8192
                );
            })
        ) {
            reject("Unsupported provider settings fields.");
            return;
        }
        var config = driver.credentials();
        fields.forEach(function (key) {
            config[key === "mac" || key === "key" ? "username" : key] =
                params.settings[key];
        });
        var endpoint = driver.id === "m3u" ? config.playlist : config.server;
        if (endpoint) {
            try {
                var club = driver.id === "ottclub";
                if (club && /[\s/\\?#@]/.test(endpoint)) throw new Error();
                var parsed = new URL(club ? "http://" + endpoint : endpoint);
                if (
                    !/^https?:$/.test(parsed.protocol) ||
                    !parsed.hostname ||
                    parsed.username ||
                    parsed.password ||
                    !checkProviderUrl(parsed.href)
                )
                    throw new Error();
                // The OTTClub driver prepends HTTP to its stored host.
                if (club) config.server = parsed.host;
            } catch (_error) {
                reject(
                    driver.id === "ottclub"
                        ? "Use an OTTClub host, optionally with a port, without a URL scheme or path."
                        : "Use a valid HTTP(S) provider URL."
                );
                return;
            }
        }
        if (
            driver.id === "stalker" &&
            !/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(config.username)
        ) {
            reject("Use a MAC address such as 00:1A:79:00:00:01.");
            return;
        }
        if (driver.saveCredentials(config) === false) {
            reject("Could not save provider settings.");
            return;
        }
        if (typeof w.loadPlaylist === "function") w.loadPlaylist();
        reply({ fields: fields, provider: driver.id, saved: true });
        return;
    }
    if (request.action === "command") {
        var outcome = handleCommand(params);
        if (outcome !== "accepted") {
            reject(
                "Command " + outcome + ". Check the player state and settings."
            );
            return;
        }
        reply({
            dispatched: true,
            volume: params.command === "set_volume" ? volume() : undefined,
        });
        return;
    }
    if (w.commandChannelsReady !== true) {
        reject("Channels are still loading. Try again shortly.");
        return;
    }
    var rows = channels();
    if (request.action === "channels") {
        reply({
            channels: rows.filter(function (row) {
                return includes(row.name, params.search);
            }),
        });
        return;
    }
    if (request.action === "play") {
        var text = String(params.query).trim();
        var matches = /^\d+$/.test(text)
            ? rows.filter(function (row) {
                  return row.number === Number(text);
              })
            : rows.filter(function (row) {
                  return row.name.toLowerCase() === text.toLowerCase();
              });
        if (!matches.length && !/^\d+$/.test(text))
            matches = rows.filter(function (row) {
                return includes(row.name, text);
            });
        if (matches.length !== 1) {
            reject(
                matches.length
                    ? "Several channels match. Use a channel number."
                    : "Channel not found.",
                matches
            );
            return;
        }
        for (var c = 0; c < (w.catsArray || []).length; c++) {
            var list = w.cats[w.catsArray[c]] || [];
            for (var i = 0; i < list.length; i++) {
                if (String(list[i]) === String(matches[0].id)) {
                    if (typeof w.playChannel !== "function") {
                        reject("Playback is unavailable.");
                        return;
                    }
                    w.playChannel(c, i);
                    reply({ channel: matches[0], dispatched: true });
                    return;
                }
            }
        }
        reject("Channel is unavailable in the current categories.");
        return;
    }
    if (request.action !== "programs") {
        done({
            data: { error: "Unsupported request." },
            status: "unsupported",
        });
        return;
    }
    var guide = w.__ottClassicGuide;
    if (!guide) {
        done({
            data: { error: "This player has no EPG query service." },
            status: "unsupported",
        });
        return;
    }
    var source = guide.source();
    var channelLoad = w.__ottCommandChannelLoad;
    var asOf = Date.now() / 1000;
    var programs: any[] = [];
    var position = 0,
        running = 0,
        checked = 0;
    var stopped = false;
    var pumpTimer: any = null;
    var cancels: Array<() => void> = [];
    function cancel(): void {
        stopped = true;
        w.clearTimeout(timer);
        w.clearTimeout(pumpTimer);
        pumpTimer = null;
        cancels.forEach(function (fn) {
            fn();
        });
    }
    function changed(): boolean {
        return (
            source !== guide.source() ||
            channelLoad !== w.__ottCommandChannelLoad ||
            w.commandChannelsReady !== true
        );
    }
    function finish(): void {
        if (stopped) return;
        var stale = changed();
        cancel();
        if (stale || changed()) {
            reject("Channels or provider changed while reading EPG. Retry.");
            return;
        }
        reply({
            as_of: asOf,
            checked: checked,
            partial: checked < rows.length,
            programs: programs.sort(function (a, b) {
                return a.number - b.number;
            }),
            total: rows.length,
        });
    }
    var timer = w.setTimeout(finish, 25000);
    function consume(row: any, entries: any): void {
        checked++;
        if (!entries || !entries.length) return;
        var current = w.OttPlayCore.guideScheduleSelection(
            entries.map(function (entry: any) {
                return { end: entry.time_to, row: entry, start: entry.time };
            }),
            asOf,
            0
        ).current;
        if (!current || !current.row.name) return;
        var entry = current.row;
        if (includes(String(entry.name), params.search))
            programs.push({
                channel: row.name,
                end: entry.time_to,
                number: row.number,
                start: entry.time,
                title: String(entry.name),
            });
    }
    function schedulePump(): void {
        if (stopped || pumpTimer !== null) return;
        pumpTimer = w.setTimeout(function () {
            pumpTimer = null;
            pump();
        }, 0);
    }
    // Yield between batches even when cached callbacks complete synchronously.
    function pump(): void {
        if (stopped) return;
        if (changed()) {
            finish();
            return;
        }
        var batch = 0;
        while (
            !stopped &&
            running < 4 &&
            position < rows.length &&
            batch++ < 64
        ) {
            (function (row) {
                var cached = guide.peek(row.id);
                if (cached && cached.length) {
                    consume(row, cached);
                    return;
                }
                running++;
                var completed = false;
                var release = guide.request(
                    row.id,
                    function (_id: any, entries: any) {
                        if (completed || stopped) return;
                        completed = true;
                        running--;
                        consume(row, entries);
                        schedulePump();
                    }
                );
                cancels.push(release);
            })(rows[position++]);
        }
        if (!running && position === rows.length) finish();
        else if (running < 4 && position < rows.length) schedulePump();
    }
    pump();
    return cancel;
}

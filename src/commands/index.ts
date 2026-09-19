import { checkProviderUrl, selectProviderByIndex } from "../provider";

/**
 * Command handler — dispatches push commands received via webhook poll.
 *
 * Commands are JSON objects with a "command" field. The player polls the
 * central server (Variant 1) or a local proxy (Variant 2) and calls
 * handleCommand() for each received object.
 *
 * Supported commands:
 *   popup_message          — show notification popup (top-right, configurable duration)
 *   channel_by_number      — switch to channel by its number in the list
 *   channel_by_name        — fuzzy-match channel name (first substring hit)
 *   random_channel         — switch to a random channel (optional range)
 *   change_provider        — switch IPTV provider by index
 *   change_provider_settings — update provider config (JSON string)
 *   change_playlist        — load a new M3U playlist URL
 */

// ─── External declarations (set by other modules at runtime) ───────────────────

declare let $: any;
declare let window: any;

// ─── Command interface ─────────────────────────────────────────────────────────

export interface Command {
    channel_name?: string;
    channel_number?: number;
    command: string;
    message?: string;
    playlist?: string;
    popup_duration?: number;
    provider?: number;
    provider_settings?: string;
    random_range?: [number, number];
    volume?: number; // 0-100, absolute volume level
    volume_step?: number; // relative change, e.g. +5 or -5
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Show a popup notification in the top-right corner.
 * Creates a <div class="notify"> element, appends it to #notifications,
 * and auto-removes it after `durationSec` seconds.
 *
 * @param text     - Message text to display.
 * @param durationSec — How long (seconds) the popup stays visible. Default 5.
 */
export function showPopup(text: string, durationSec = 5) {
    if (!text) {
        return;
    }
    const container = document.getElementById("notifications");
    if (!container) {
        return;
    }
    const el = document.createElement("div");
    el.className = "notify";
    el.textContent = text;
    container.appendChild(el);
    setTimeout(function () {
        el.classList.add("notify-out");
        setTimeout(function () {
            el.remove();
        }, 300);
    }, durationSec * 1000);
}

/**
 * Find the category index and channel index for a given channel ID.
 * Searches through all categories in window.catsArray / window.cats.
 *
 * @param chId - Channel ID to find.
 * @returns [catIdx, chIdx] or [-1, -1] if not found.
 */
function findChannelIndices(chId: number): [number, number] {
    var w = window;
    for (var ci = 0; w.catsArray && w.cats && ci < w.catsArray.length; ci++) {
        var cat = w.catsArray[ci];
        var list = w.cats[cat] || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] === chId) return [ci, i];
        }
    }
    return [-1, -1];
}

// ─── Command implementations ───────────────────────────────────────────────────

/**
 * Switch to a channel by its position number in the current list.
 * Uses window.curList which is the flat list of channel IDs.
 *
 * @param num - 1-based channel number.
 */
function channelByNumber(num: number): void {
    var w = window;
    if (!(w.curList && w.curList.length)) {
        showPopup("No channels loaded");
        return;
    }
    // Channel numbers are 1-based
    var idx = num - 1;
    if (idx < 0 || idx >= w.curList.length) {
        showPopup(
            "Channel #" + num + " not found (total: " + w.curList.length + ")"
        );
        return;
    }
    var chId = w.curList[idx];
    var indices = findChannelIndices(chId);
    if (indices[0] === -1) {
        showPopup("Channel #" + num + " not in any category");
        return;
    }
    if (typeof w.playChannel === "function") {
        w.playChannel(indices[0], indices[1]);
    }
    var chName =
        w.channels && w.channels[chId] ? w.channels[chId].channel_name : "";
    showPopup("Channel #" + num + (chName ? ": " + chName : ""));
}

/**
 * Switch to a channel by (partial) name match.
 * Case-insensitive substring search. First match wins.
 *
 * @param name - Channel name or partial name to search for.
 */
function channelByName(name: string): void {
    if (!name) return;
    var w = window;
    var needle = name.toLowerCase();
    var bestChId: number | string | null = null;
    var bestCatIdx = -1;
    var bestChIdx = -1;

    // Search all categories
    for (var ci = 0; w.catsArray && w.cats && ci < w.catsArray.length; ci++) {
        var cat = w.catsArray[ci];
        var list = w.cats[cat] || [];
        for (var i = 0; i < list.length; i++) {
            var chId = list[i];
            var ch = w.channels && w.channels[chId];
            if (
                ch &&
                ch.channel_name &&
                ch.channel_name.toLowerCase().indexOf(needle) !== -1
            ) {
                bestChId = chId;
                bestCatIdx = ci;
                bestChIdx = i;
                break;
            }
        }
        if (bestChId !== null) break;
    }

    if (bestChId === null) {
        showPopup('Channel "' + name + '" not found');
        return;
    }

    if (typeof w.playChannel === "function") {
        w.playChannel(bestCatIdx, bestChIdx);
    }
    var chName =
        w.channels && w.channels[bestChId]
            ? w.channels[bestChId].channel_name
            : "";
    showPopup("Playing: " + chName);
}

/**
 * Switch to a random channel.
 * If range is provided ([start, end]), picks from that 1-based range.
 * Otherwise picks from all channels in curList.
 *
 * @param rangeStart - Optional 1-based start of range.
 * @param rangeEnd   - Optional 1-based end of range.
 */
function randomChannel(rangeStart?: number, rangeEnd?: number): void {
    var w = window;
    if (!(w.curList && w.curList.length)) {
        showPopup("No channels loaded");
        return;
    }

    var total = w.curList.length;
    var startIdx: number;
    var endIdx: number;

    if (rangeStart !== undefined && rangeEnd !== undefined) {
        // Convert 1-based to 0-based, clamp to valid range
        startIdx = Math.max(0, rangeStart - 1);
        endIdx = Math.min(total - 1, rangeEnd - 1);
        if (startIdx > endIdx) {
            showPopup("Invalid range: " + rangeStart + "-" + rangeEnd);
            return;
        }
    } else {
        startIdx = 0;
        endIdx = total - 1;
    }

    var pickIdx =
        startIdx + Math.floor(Math.random() * (endIdx - startIdx + 1));
    var chId = w.curList[pickIdx];
    var indices = findChannelIndices(chId);
    if (indices[0] === -1) {
        showPopup("Random channel not in any category");
        return;
    }

    if (typeof w.playChannel === "function") {
        w.playChannel(indices[0], indices[1]);
    }
    var chName =
        w.channels && w.channels[chId] ? w.channels[chId].channel_name : "";
    showPopup("Random #" + (pickIdx + 1) + (chName ? ": " + chName : ""));
}

/**
 * Switch IPTV provider by index in the provider array.
 *
 * @param providerIdx - Index in window.providerIds.
 */
function changeProvider(providerIdx: number): void {
    if (selectProviderByIndex(providerIdx)) {
        showPopup("Switching provider...");
    } else {
        showPopup("Provider switching not available");
    }
}

/** Provider configuration schemas differ; no generic remote replacement is supported. */
function changeProviderSettings(): string {
    showPopup(
        "Remote provider settings are not supported. Use the player's provider settings."
    );
    return "unsupported";
}

/** Update only the active M3U entry through the provider's existing persistence/reload contract. */
function changePlaylist(url: string): string {
    var w = window;
    if (
        w.p_pref !== "m3u" ||
        typeof w.providerSetItem !== "function" ||
        typeof w.loadPlaylist !== "function" ||
        !w.m3uArr ||
        !Array.isArray(w.m3uArr.M3Us)
    ) {
        showPopup("Remote playlist changes require the M3U provider.");
        return "unsupported";
    }
    if (
        (w.sPSprovs || w.sPSoptions) &&
        w.parentPIN !== "*" &&
        !w.parentAccess
    ) {
        showPopup("Unlock the player's settings before changing its playlist.");
        return "rejected";
    }
    try {
        var parsed = new URL(url);
        if (
            !/^https?:$/.test(parsed.protocol) ||
            !parsed.hostname ||
            !checkProviderUrl(url)
        )
            return "rejected";
        var active = Number(w.m3uArr.active);
        if (
            !isFinite(active) ||
            active < 0 ||
            Math.floor(active) !== active ||
            !w.m3uArr.M3Us[active]
        )
            return "rejected";
        var next = JSON.parse(JSON.stringify(w.m3uArr));
        next.M3Us[active].www = url;
        w.providerSetItem("m3uArr", JSON.stringify(next));
        w.loadPlaylist();
        showPopup("Loading the new playlist...");
        return "accepted";
    } catch (_error) {
        showPopup("Could not change the playlist.");
        return "rejected";
    }
}

/**
 * Set or adjust volume.
 * Supports absolute level (0-100) via `volume` or relative step via `volume_step`.
 * Gracefully ignored if the client doesn't support volume control.
 *
 * @param level - Absolute volume 0-100.
 * @param step  - Relative change, e.g. +10 or -5.
 */
function setVolume(level?: number, step?: number): void {
    var w = window;
    var supported =
        typeof w.stbSetVolume === "function" &&
        typeof w.stbGetVolume === "function";
    if (!supported) return; // silently ignore on clients without volume control

    if (level !== undefined) {
        var clamped = Math.max(0, Math.min(100, level));
        w.stbSetVolume(clamped);
        showPopup("Volume: " + clamped + "%");
    } else if (step !== undefined) {
        var current = w.stbGetVolume();
        if (current === undefined || current === null) return;
        var next = Math.max(0, Math.min(100, current + step));
        w.stbSetVolume(next);
        showPopup("Volume: " + next + "%");
    }
}

/**
 * Exit / shutdown the player.
 * Tries stbToggleStandby first (if supported), then exitPortal.
 */
function exitPlayer(): void {
    var w = window;
    var didSomething = false;
    if (typeof w.stbToggleStandby === "function") {
        w.stbToggleStandby();
        didSomething = true;
    }
    if (didSomething) {
        showPopup("Standby mode");
    } else {
        showPopup("Exiting player...");
        if (typeof w.stbExit === "function") {
            w.stbExit();
        }
    }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * Dispatch a command object to the appropriate handler.
 * Called by the webhook poller for each received command.
 *
 * @param cmd - Command object with a "command" field.
 */
export function handleCommand(cmd: Command): string {
    if (!(cmd && typeof cmd.command === "string")) return "rejected";
    function finite(value: any): boolean {
        return typeof value === "number" && isFinite(value);
    }
    function integer(value: any, minimum: number): boolean {
        return finite(value) && Math.floor(value) === value && value >= minimum;
    }
    if (
        cmd.popup_duration !== undefined &&
        (!finite(cmd.popup_duration) ||
            cmd.popup_duration <= 0 ||
            cmd.popup_duration > 3600)
    )
        return "rejected";
    if (cmd.channel_number !== undefined && !integer(cmd.channel_number, 1))
        return "rejected";
    if (cmd.provider !== undefined && !integer(cmd.provider, 0))
        return "rejected";
    if (cmd.volume !== undefined && !finite(cmd.volume)) return "rejected";
    if (cmd.volume_step !== undefined && !finite(cmd.volume_step))
        return "rejected";
    if (
        cmd.random_range !== undefined &&
        (!Array.isArray(cmd.random_range) ||
            cmd.random_range.length !== 2 ||
            !integer(cmd.random_range[0], 1) ||
            !integer(cmd.random_range[1], 1) ||
            cmd.random_range[0] > cmd.random_range[1])
    )
        return "rejected";
    if (cmd.channel_name !== undefined && typeof cmd.channel_name !== "string")
        return "rejected";
    if (cmd.message !== undefined && typeof cmd.message !== "string")
        return "rejected";
    if (cmd.playlist !== undefined && typeof cmd.playlist !== "string")
        return "rejected";
    if (
        cmd.provider_settings !== undefined &&
        typeof cmd.provider_settings !== "string"
    )
        return "rejected";

    if (
        cmd.command === "channel_by_number" ||
        cmd.command === "channel_by_name" ||
        cmd.command === "random_channel"
    ) {
        var w = window;
        if (
            w.commandChannelsReady === false ||
            (w.commandChannelsReady !== true &&
                !(
                    w.catsArray &&
                    w.catsArray.length &&
                    w.curList &&
                    w.curList.length
                ))
        )
            return "deferred";
    }
    switch (cmd.command) {
        case "popup_message":
            showPopup(cmd.message || "", cmd.popup_duration || 5);
            break;

        case "channel_by_number":
            if (cmd.channel_number !== undefined) {
                channelByNumber(cmd.channel_number);
            }
            break;

        case "channel_by_name":
            if (cmd.channel_name) {
                channelByName(cmd.channel_name);
            }
            break;

        case "random_channel":
            if (cmd.random_range && cmd.random_range.length === 2) {
                randomChannel(cmd.random_range[0], cmd.random_range[1]);
            } else {
                randomChannel();
            }
            break;

        case "change_provider":
            if (cmd.provider !== undefined) {
                changeProvider(cmd.provider);
            }
            break;

        case "change_provider_settings":
            if (cmd.provider_settings) {
                return changeProviderSettings();
            }
            break;

        case "change_playlist":
            if (cmd.playlist) {
                return changePlaylist(cmd.playlist);
            }
            break;

        case "set_volume":
            setVolume(cmd.volume, cmd.volume_step);
            break;

        case "exit_player":
            exitPlayer();
            break;

        default:
            showPopup("This remote command is not supported by the player.");
            return "unsupported";
    }
    return "accepted";
}

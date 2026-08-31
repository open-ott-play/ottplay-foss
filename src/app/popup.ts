/**
 * Popup menu data for OTT-play FOSS.
 *
 * `popupActions` is the live, mutable list of functions invoked by the
 * popup menu; `popupArray` is the matching label list; `popupDetail`
 * is an optional per-entry description (e.g. "Show rewind window").
 * `savedPopup` is a snapshot used to restore the menu after a
 * provider switch.
 */

import { PLAYER_VERSION } from "./state";

export const popupActions: any[] = [];
export const popupArray: string[] = (window as any).popupArray || [
    "Toggle Aspect Ratio",
    "Toggle Zoom Mode",
    "Switch sound track",
    "Switch subtitle",
    "Return to previous channel",
    "Pause/Play",
    "Restart stream / Live",
    "Rewind",
    "Call PiP / PiP exchange",
    "Close PiP",
    "Category selection",
    "Show EPG and archive for channel",
    "Show list of channel archive records",
    "Show Media Library",
    "",
    "",
    "Settings",
    "Restart player",
    "Exit player",
    "Information",
];
export const popupDetail: any[] = (window as any).popupDetail || [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "Show rewind window",
    null,
    null,
    null,
    null,
    "Show list of channel archive records without duplication",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
];

export const savedPopup: {
    ver: string;
    popupActions: any[];
    popupArray: string[];
    popupDetail: any[];
} = {
    popupActions: [],
    popupArray: [],
    popupDetail: [],
    ver: PLAYER_VERSION,
};

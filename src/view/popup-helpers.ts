/**
 * Popup menu helpers for OTT-play FOSS
 * Handles popup menu actions, arrays, and details
 */

// Import required functions from their respective modules
import { PLAYER_VERSION } from "../version";
import {
    popPause,
    popPrevProg,
    popShift,
    popStop,
    popStopPip,
    popTogglePip,
} from "./channels";
import { restart } from "./commands";
import {
    toggleAspectRatio,
    toggleAudioTrack,
    toggleSubtitle,
    toggleZoom,
} from "./core";
import { noProvParam } from "./provider";
import {
    exitPortal,
    infoList,
    nofun,
    popBuckets,
    popEpg,
    popMedia,
    popRecords,
} from "./ui";
import { optionsList } from "./view/options-helpers";

// Popup menu
export const popupActions: any[] = [
    toggleAspectRatio,
    toggleZoom,
    toggleAudioTrack,
    toggleSubtitle,
    popPrevProg,
    popPause,
    popStop,
    popShift,
    popTogglePip,
    popStopPip,
    popBuckets,
    popEpg,
    popRecords,
    popMedia,
    noProvParam,
    nofun,
    optionsList,
    restart,
    exitPortal,
    infoList,
];
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
    null,
    null,
];
export const savedPopup: {
    ver: string;
    popupActions: any[];
    popupArray: string[];
    popupDetail: string[];
} = { ver: PLAYER_VERSION, popupActions: [], popupArray: [], popupDetail: [] };
export const version: string = PLAYER_VERSION;

/**
 * Channel list display + archive playback entrypoints
 * for OTT-play FOSS.
 */

import {
    setDetailListActionFn,
    setGetListItemFn,
    setIsListVisible,
    setListDataArray,
    setListSelectionIndex,
} from "../app/state";
import { catIndex, catsArray, playArchive } from "../channels";
import { closeList, showPage } from "../ui";

/**
 * Show the channel list (category chooser) overlay.
 * Provider module replaces the key handler when its channels load.
 */
export function showChanelsList(): void {
    setIsListVisible(true);
    setListDataArray(catsArray.slice());
    setListSelectionIndex(catIndex >= 0 ? catIndex : 0);
    setGetListItemFn((item: any, _idx: number) => "&nbsp;&nbsp;" + item);
    setDetailListActionFn(() => undefined);
    (window as any).listKeyHandler = function (key: number): boolean {
        switch (key) {
            case 13: // ENTER — close list; playback stays on current channel
                closeList();
                setIsListVisible(false);
                return true;
            case 8: // RETURN
            case 27: // EXIT
                closeList();
                setIsListVisible(false);
                return true;
            default:
                break;
        }
        return false;
    };
    showPage();
}

/**
 * Start archive (timeshift) playback at the given timestamp.
 * Delegates to playArchive() from the channels module.
 */
export function playArchiveMode(timestamp: number): void {
    playArchive(timestamp);
}

/**
 * Update the #video_res element with the current video resolution
 * (videoWidth × videoHeight) from the <video> element, if available.
 */
export function updateMediaInfoDisplay(): void {
    var resEl = document.getElementById("video_res");
    var video = (window as any).video;
    if (resEl && video && video.videoWidth)
        resEl.innerHTML = "<br/>" + video.videoWidth + "x" + video.videoHeight;
}

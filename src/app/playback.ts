/**
 * Playback logic (channel and media library) for OTT-play FOSS.
 */

import {
    cats,
    catsArray,
    curList,
    getChannelUrl,
    getMediaDescr,
    ifParentalAccessChId,
    medHistory,
    mediaSelects,
    mediaUrls,
    setCurrent,
} from "../channels";
import { stbPlay, stbSetPosTime, stbStop } from "../core";
import { settings } from "../settings";
import { providerGetJson } from "../storage";
import { confirmBox, infoBox, showChanelInfo, step2text } from "../ui";
import { checkMedia } from "./lifecycle";

/** Internal implementation — starts playback of a channel by index. */
export function _playChannel(catIdx: number, chIdx: number): void {
    console.log(
        "[playChannel] catIdx=" +
            catIdx +
            " chIdx=" +
            chIdx +
            " catsArray.length=" +
            catsArray.length
    );
    if (catsArray[catIdx] === undefined) {
        infoBox(
            "ERROR: Category #" +
                catIdx +
                " does not exist!<br /> Please select other"
        );
        (window as any).client_feedb(
            "category_trouble_playChannel: " +
                catIdx +
                " / " +
                catsArray.length +
                " / " +
                Object.keys(providerGetJson("cats", {})).length
        );
    }
    if (
        ifParentalAccessChId(cats[catsArray[catIdx]][chIdx], function () {
            (window as any).playChannel(catIdx, chIdx);
        })
    ) {
        console.log("[playChannel] blocked by parental");
        return;
    }
    if ((window as any).sStopPlay) stbStop();
    setCurrent(catIdx, chIdx);
    var channelId = curList[(window as any).primaryIndex];
    console.log(
        "[playChannel] channelId=" +
            channelId +
            " url=" +
            getChannelUrl(channelId)
    );
    (window as any).updateChanelInfo(channelId);
    if ((window as any).sInfoSwitch) showChanelInfo(1);
    (window as any).playType = 0;
    stbPlay(getChannelUrl(channelId));
    clearTimeout((window as any)._tmedia);
    (window as any)._tmedia = setTimeout(checkMedia, 2000);
}

/** Internal implementation — starts playback of a media library item. */
export function _playMedia(item: any): void {
    // biome-ignore lint/style/useAtIndex: legacy concat pattern from index.ts
    if (mediaUrls && mediaUrls[mediaUrls.length - 1] === -1)
        mediaSelects[0] = 0;
    setCurrent((window as any).catIndex, -1);
    var resumePos = 0;
    var historyIdx = medHistory.findIndex(function (e: any) {
        return e.stream_url === item.stream_url;
    });
    if (historyIdx !== -1) {
        if (historyIdx === 0 && (window as any).playType === -1e11) return;
        resumePos =
            Math.floor((medHistory[historyIdx]?.current ?? 0) / 60) * 60;
        medHistory.splice(historyIdx, 1);
    }
    medHistory.unshift(item);
    var maxMedCount = [0, 10, 20, 30, 40, 50][(window as any).sMedCount] || 10;
    medHistory.splice(maxMedCount);
    ($ as any)("#picon").css(
        "background-image",
        'url("' + (item.logo_30x30 || "") + '")'
    );
    ($ as any)("#channel_number").text(" ");
    ($ as any)("#channel_name").html(item.title);
    ($ as any)("#nprogramm_name").html("&nbsp; ");
    ($ as any)("#nbegin_time").text("");
    ($ as any)("#nend_time").text("");
    ($ as any)("#programm_name").html("&nbsp; ");
    (window as any)._prog100 = 0;
    ($ as any)("#progress_div").css("background-color", "#446");
    ($ as any)("#progress_r").css("width", "0%");
    ($ as any)("#progress").css("width", "0%");
    ($ as any)("#begin_time").text("");
    ($ as any)("#end_time").text("");
    ($ as any)("#programm_name2").text("");
    ($ as any)("#programm_duration").text("");
    ($ as any)("#programm_descr").html(getMediaDescr(item));
    if ((window as any).sInfoSwitch) showChanelInfo(settings.infoTimeout);
    (window as any).playTime = 0;
    (window as any).playType = -1e11;
    (window as any).forcePlay = true;
    if ((window as any).sStopPlay) stbStop();
    if (typeof item.stream_url === "function")
        item.stream_url = item.stream_url();
    stbPlay(item.stream_url);
    if (resumePos)
        confirmBox(
            (window as any)._(
                "Continue watching?<br><br>" + step2text(resumePos)
            ),
            function () {
                stbSetPosTime(resumePos);
            }
        );
}

/**
 * Display helper functions for UI manipulation
 */

import { pullSettingsFromWindow } from "../app/apply-settings";
import { bodyColor, curColor, curColorB, fontFamilyList } from "../app/state";
import { sEditor } from "../channels";
import { setPipPosition, stbToggleStandby } from "../core";
import { settings } from "../settings";
import { hsvToRgb } from "../ui";

// Globals used by setColor / setEditor / setSleepTimeout
declare var $tooltipSpan: any;
declare var tooltip: any;

/**
 * Set font size for various UI elements based on window dimensions and settings
 */
export function setFontSize(): void {
    pullSettingsFromWindow(settings);
    (window as any).pageSize = settings.pageSize;
    const e = window.innerHeight / 720;
    const t = window.innerWidth / 1280;
    let r =
        (window.innerHeight - 90 * e) / (window as any).pageSize -
        settings.fontShift * e;
    r = Math.max(r, 16 * e);
    r = Math.min(r, 40 * e);
    $("#list").css("font-size", r + "px");
    $("#testFont").css("font-size", r + "px");
    $("#permanentTime").css("font-size", r + "px");

    r = Math.max(r, 22 * e);
    if ((window as any).$i1 && typeof (window as any).$i1.css === "function") {
        (window as any).$i1.css("font-size", r + "px");
    }
    $("#numprog").css("font-size", r + "px");
    $("#dialogbox").css("font-size", r + "px");

    r = Math.min(r, 25 * e);
    $("#listCaption").css("font-size", r + "px");
    $("#listPodval").css("font-size", r + "px");
    $("#permanentTime")
        .toggle(settings.permanentTime !== 0)
        .toggleClass("osd", settings.permanentTime !== 2)
        .css("background-color", "");

    const s = "Helvetica, Arial, sans-serif";
    $("body").css("font-family", fontFamilyList[settings.fontSize] + s);

    $("#info").css("padding", 20 * e + "px");
    $("#numprog").css({
        left: 20 * e + "px",
        padding: 10 * e + "px",
        top: 20 * e + "px",
    });
    $("#permanentTime").css({
        padding: 10 * e + "px " + 10 * t + "px",
        right: 20 * e + "px",
        top: 20 * t + "px",
    });
    $("#launch").css({ "font-size": 16 * e + "px", padding: 100 * e + "px" });
    $("logo").css({ margin: 100 * e + "px" });
    $("#list").css({ margin: 10 * e + "px " + 10 * t + "px" });
    $("#listCaption").css({ height: 30 * e + "px" });
    $("#listTime").css({ "font-size": 22 * e + "px", width: 80 * t + "px" });
    $("#list_s").css({ "font-size": 16 * e + "px" });
    $("#listPodval").css({ height: 30 * e + "px" });
    $("#listDetail").css({
        bottom: 30 * e + 1 + "px",
        padding: 4 * e + "px " + 4 * t + "px",
        top: 330 * e + "px",
        width: 514 * t + 1 + "px",
    });
    $("#listPopUp").css({
        bottom: 30 * e + 1 + "px",
        margin: 10 * e + "px",
        padding: 10 * e + "px",
    });
    $("#listIn").css({
        bottom: 30 * e + 1 + "px",
        left: 522 * t + "px",
        padding: 4 * e + "px 0px",
        top: 30 * e + 1 + "px",
    });
    $("#listAbout").css({
        bottom: 30 * e + 1 + "px",
        left: 522 * t + "px",
        padding: 10 * e + "px " + 10 * t + "px",
        top: 30 * e + 1 + "px",
    });
    $("#listEdit").css({
        bottom: 30 * e + 1 + "px",
        left: 522 * t + "px",
        padding: 10 * e + "px " + 10 * t + "px",
        top: 30 * e + 1 + "px",
    });
    $("#info1").css({ padding: 20 * e + "px " + 20 * t + "px" });
    $("#picon").css({ height: 80 * e + "px", width: 80 * t + "px" });
    $("#channel").css({
        padding: "0px 0px 0px " + 20 * t + "px",
        width: 1040 * t + "px",
    });
    $("#channel_number").css({ width: 70 * t + "px" });
    $("#progress_div").css({ margin: 6 * e + "px 0px " + 4 * e + "px 0px" });
    $("#progress").css({ height: 8 * e + "px" });
    $("#progress_r").css({ height: 8 * e + "px" });
    $("#begin_time").css({ "font-size": 22 * e + "px", width: 70 * t + "px" });
    $("#end_time").css({ "font-size": 22 * e + "px", width: 70 * t + "px" });
    $("#programm_name").css({ width: 900 * t + "px" });
    $("#nbegin_time").css({ "font-size": 20 * e + "px", width: 70 * t + "px" });
    $("#nend_time").css({ "font-size": 20 * e + "px", width: 70 * t + "px" });
    $("#nprogramm_name").css({ width: 900 * t + "px" });
    $("#data").css({ "font-size": 22 * e + "px", width: 80 * t + "px" });
    $("#current_s").css({ "font-size": 16 * e + "px" });
    $("#video_res").css({ "font-size": 16 * e + "px" });
    $("#descr").css({
        margin: "0px 0px " + 20 * e + "px 0px",
        padding: "0px " + 100 * t + "px",
    });
    $("#buffering").css({
        "background-size": 30 * e + "px",
        height: 30 * e + "px",
        left: 10 * e + "px",
        top: 10 * e + "px",
        width: 30 * e + "px",
    });
    $("#pip_buffering").css({
        "background-size": 30 * e + "px",
        height: 30 * e + "px",
        right: 10 * e + "px",
        top: 10 * e + "px",
        width: 30 * e + "px",
    });
    $("#mute").css({
        "background-size": 20 * e + "px",
        height: 40 * e + "px",
        width: 40 * e + "px",
    });
    $("#volume_div").css({
        border: 5 * e + "px solid black",
        left: 10 * t + "px",
        width: 15 * t + "px",
    });
    $("#dialogbox").css({ margin: 10 * e + "px", padding: 10 * e + "px" });
    $("btn").css({
        "border-radius": 6 * e + "px",
        padding: "0px " + 6 * t + "px",
    });

    try {
        if (tooltip && tooltip.style) {
            tooltip.style.width = 12 * e + "px";
            tooltip.style.height = 12 * e + "px";
            tooltip.style.border = 3 * e + "px solid " + curColor;
        }
    } catch (ex) {
        console.error(ex);
    }

    // Dynamic picon/data/listTime width based on font metrics
    try {
        const n = $("#testFont");
        const i = n.css("font-size");
        n.css("font-size", 22 * e).text("9");
        const a = n.width() ?? 0;
        n.text("").css("font-size", i);
        const o = a * 7;
        if (o) {
            $("#picon").css({ width: o + "px" });
            $("#data").css({ width: o + "px" });
            $("#listTime").css({ width: o + "px" });
            $("#channel").css({ width: 1200 * t - o * 2 + "px" });
            $("#descr").css({ padding: "0px " + (o + 20 * t) + "px" });
        }
    } catch (ex) {
        console.error(ex);
    }

    // Dynamic channel_number/begin/end_time/programm_name width
    try {
        const n2 = $("#testFont");
        const i2 = n2.css("font-size");
        const l2 =
            (window as any).$i1 && (window as any).$i1.css
                ? (window as any).$i1.css("font-size")
                : "22px";
        n2.css("font-size", l2).text("9");
        const a2 = n2.width();
        n2.text("").css("font-size", i2);
        if (a2) {
            const w = a2 * 6;
            $("#channel_number").css({ width: w + "px" });
            $("#begin_time").css({ "font-size": "inherit", width: w + "px" });
            $("#end_time").css({ "font-size": "inherit", width: w + "px" });
            $("#programm_name").css({ width: 1200 * t - w - 20 * t + "px" });
            $("#nbegin_time").css({ "font-size": "inherit", width: w + "px" });
            $("#nend_time").css({ "font-size": "inherit", width: w + "px" });
            $("#nprogramm_name").css({ width: 1200 * t - w - 20 * t + "px" });
        }
    } catch (ex) {
        console.error(ex);
    }

    // Hide elements in small-screen mode
    if (settings.noSmall) {
        $(".no_small").hide();
    }

    try {
        if (typeof (window as any).stbCSS === "function")
            (window as any).stbCSS();
        $("#descr").css(
            "max-height",
            (660 - ($("#channel").height() ?? 0)) * e + "px"
        );
    } catch (ex) {
        console.error(ex);
    }
}

/**
 * Position the channel list panel on the left or right side of the screen
 */
export function setListPos(): void {
    pullSettingsFromWindow(settings);
    const e = window.innerWidth / 1280;
    const t = window.innerHeight / 720;
    const r = settings.listPosition ? 0 : 522 * e;
    const s = settings.listPosition ? 522 * e : 0;
    let n = settings.listPosition ? 738 * e : 0;
    $("#listIn").css({ left: r + "px", right: s + "px" });
    $("#listAbout").css({ left: r + "px", right: s + "px" });
    $("#listEdit").css({ left: r + "px", right: s + "px" });
    $("#listDetail").css({ left: n + "px" });
    $("#listPopUp").css({ left: n + "px" });
    n = settings.noSmall ? 30 * t + 1 : 330 * t;
    $("#listDetail").css({ top: n + "px" });
}

/**
 * Apply highlight colors from HSV settings to the DOM.
 */
export function setColor(): void {
    pullSettingsFromWindow(settings);
    $("body").css("color", bodyColor);
    const selCv = settings.highlightColorSel.split(",");
    (window as any).curColorB =
        "rgb(" +
        hsvToRgb(Number.parseInt(selCv[0]), Number.parseInt(selCv[1]), 50).join(
            ","
        ) +
        ")";
    const fgCv = settings.highlightColor.split(",");
    (window as any).curColor =
        "rgb(" +
        hsvToRgb(Number.parseInt(fgCv[0]), Number.parseInt(fgCv[1]), 100).join(
            ","
        ) +
        ")";

    $("#listCaption").css(
        "border-bottom",
        "1px solid " + (window as any).curColor
    );
    $("#listPodval").css("border-top", "1px solid " + (window as any).curColor);
    $("#listPopUp").css("border", "1px solid " + (window as any).curColor);
    $("#progress").css("background-color", (window as any).curColor);
    if ($tooltipSpan && typeof $tooltipSpan.css === "function") {
        $tooltipSpan.css({
            "background-color": (window as any).curColorB,
            color: (window as any).curColor,
        });
    }
    $("#programm_name2").css("color", (window as any).curColor);
    $("#dialogbox").css("border", "1px solid " + (window as any).curColor);
    try {
        if (tooltip && tooltip.style)
            tooltip.style.border =
                3 * (window.innerHeight / 720) +
                "px solid " +
                (window as any).curColor;
    } catch (e) {
        console.error(e);
    }
    stbSetOsdOpacity(settings.osdOpacity * 10);

    const e = window.innerHeight / 720;
    const t = window.innerWidth / 1280;
    $("#_t").css("height", 50 * e);
    $("#_b").css("top", (50 + 288) * e);
    const listFrameLeft = settings.listPosition ? 758 : 10;
    $("#_l").css("width", listFrameLeft * t);
    $("#_r").css("left", (listFrameLeft + 512) * t);

    const bgCv = settings.highlightColorB.split(",");
    const bgColor =
        "rgb(" +
        hsvToRgb(Number.parseInt(bgCv[0]), 100, Number.parseInt(bgCv[1])).join(
            ","
        ) +
        ")";
    $(".list_back").css("background-color", bgColor);
    $("#listPopUp").css("background-color", bgColor);
}

/**
 * Set the OSD background opacity.
 */
export function stbSetOsdOpacity(val: number): void {
    const cv = settings.highlightColorB.split(",");
    $(".osd").css(
        "background-color",
        "rgba(" +
            hsvToRgb(Number.parseInt(cv[0]), 100, Number.parseInt(cv[1])).join(
                ","
            ) +
            "," +
            val / 100 +
            ")"
    );
}

/**
 * Select the editor implementation based on sEditor.
 */
export function setEditor(): void {
    if (sEditor && typeof (window as any).showEditKey2 === "function") {
        (window as any).editKey = (window as any).editKey2;
        (window as any).showEditKey = (window as any).showEditKey2;
    } else {
        (window as any).editKey = (window as any).editKey1;
        (window as any).showEditKey = (window as any).showEditKey1;
    }
}

/**
 * Apply the configured PiP window position and size.
 */
export function setPipPosBuf(): void {
    pullSettingsFromWindow(settings);
    setPipPosition();
}

/**
 * Set (or clear) the sleep timer.
 */
export function setSleepTimeout(): void {
    if ((window as any).sleepTimer) clearTimeout((window as any).sleepTimer);
    if (settings.sleepTimeout > 0) {
        (window as any).sleepTimer = setTimeout(
            function () {
                stbToggleStandby();
            },
            settings.sleepTimeout * 60 * 1000
        );
    }
}

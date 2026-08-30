/**
 * Info screens (plugin info, buttons description) for OTT-play FOSS
 */

import { _ } from "../localization";

/** A no-op function used as a placeholder callback in list entries and popup menus. */
// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
export function nofun(): void {}

/**
 * Show player version, install ID, HTTPS support, OTT host, and device info.
 *
 * Side effects: Saves CPD; writes to #listAbout; calls stbInfo() if available;
 * sets aboutKeyHandler to dismiss on any key.
 */
export function pluginInfo(): void {
    var w = window as any;
    var v = w.version || "<br/>Version: " + w.PLAYER_VERSION;
    var host = w.host || "-";
    var __iid = w.__iid || "-";
    var canHttps = w.client_can_https ? "Yes" : "No";
    var html =
        _("Player info:") +
        "<br/>" +
        v +
        "<br/>" +
        "<br/>Install ID: " +
        __iid +
        "<br/>" +
        "HTTPS support: " +
        canHttps +
        "<br/>" +
        "OTT / APP host: " +
        host +
        " / " +
        w.location.host +
        "<br/><br/>" +
        _("Device info:") +
        "<br/>";
    w.saveCPD();
    $("#listAbout").show().html(html);
    if (typeof w.stbInfo === "function") w.stbInfo();
    w.aboutKeyHandler = function () {
        return false;
    };
}

/**
 * Display the remote control buttons description screen.
 * Lists all button functions for live and archive modes.
 *
 * Side effects: Saves CPD; writes to #listAbout; calls scrollUp();
 * sets aboutKeyHandler to dismiss on RETURN.
 */
export function buttonsInfo(): void {
    var w = window as any;
    var e = '<br/><div class="btn">';
    var t = "</div> - ";
    var strYellow = w.strTools || "";
    var strRed = w.strEPG || "";
    var html =
        e +
        w.strENTER +
        t +
        _("Show channel selection list") +
        e +
        w.strRETURN +
        t +
        _("Hide / Return") +
        e +
        w.strEXIT +
        t +
        _(" Exit player") +
        "<br/><br/>" +
        _("In live mode: <br/>") +
        e +
        w.strSTOP +
        t +
        _("Restart stream") +
        e +
        w.strPLAY +
        " / " +
        w.strPAUSE +
        " / 0" +
        t +
        _("Pause/Play") +
        e +
        w.strPREV +
        t +
        _("Timeshift: to start of TV program") +
        e +
        w.strRW +
        t +
        _("Timeshift: one minute back") +
        e +
        w.strFF +
        " / " +
        w.strNEXT +
        t +
        _("Show rewind window") +
        _("In archive mode:<br/>") +
        e +
        w.strPLAY +
        " / " +
        w.strPAUSE +
        " / 0" +
        t +
        _("Pause/Play") +
        e +
        w.strSTOP +
        " / 8" +
        t +
        _("Stop playback and return to live") +
        e +
        w.strPREV +
        " / 2" +
        t +
        _("To start of TV program / Previous TV program") +
        e +
        w.strNEXT +
        " / 5" +
        t +
        _("Next TV program") +
        e +
        w.strRW +
        " / " +
        w.strFF +
        t +
        _("Back / Forward for 1 minute") +
        (strYellow ? "<br/>" + e + strYellow + t + _("Show player menu") : "") +
        (strRed
            ? "<br/>" + e + strRed + t + _("Show EPG and archive for channel")
            : "");
    w.saveCPD();
    $("#listAbout")
        .html('<div id="_prd">' + html + "</div>")
        .show();
    var a = ($("#_prd").height() ?? 0) + 10 - ($("#listAbout").height() ?? 0);
    w.scrollUp("_prd", a, 10000);
    w.aboutKeyHandler = function (ev: number): boolean {
        if (ev === w.keys.RETURN) {
            w.restoreCPD();
            $("#listAbout").hide().text("");
            clearTimeout(w.detailTimer);
        }
        return true;
    };
}

export const infoArr: any[] = [
    { action: buttonsInfo, name: "Description of remote control buttons" },
    { action: nofun },
    { action: pluginInfo, name: "About", desc: "Player and device info" },
];

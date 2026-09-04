/**
 * Sync the typed PlayerSettings object onto window.* globals.
 *
 * Required because the legacy settings submenu system (stbOptions,
 * settingsInterface, etc.) reads/writes values from window.* properties
 * rather than the typed settings object.
 */

import type { PlayerSettings } from "../settings";

/**
 * Mirror every PlayerSettings field onto window.* so legacy providers
 * and the settings submenu can read them by their legacy names.
 */
export function applySettingsToWindow(s: PlayerSettings): void {
    var w = window as any;
    w.sNoSmall = s.noSmall;
    w.sStopPlay = s.stopPlay;
    w.sPipSize = s.pipSize;
    w.sPipPos = s.pipPosition;
    w.sPageSize = s.pageSize;
    w.sFontShift = s.fontShift;
    w.sFont = s.fontSize;
    w.sArrowFun = s.arrowFun;
    w.sRewFun = s.rewFun;
    w.sPNFun = s.pnFun;
    w.sRfun = s.rFun;
    w.sGfun = s.gFun;
    w.sYfun = s.yFun;
    w.sBfun = s.bFun;
    w.sALfun = s.alFun;
    w.sARfun = s.arFun;
    w.sAUfun = s.auFun;
    w.sADfun = s.adFun;
    w.sRWfun = s.rwFun;
    w.sFFfun = s.ffFun;
    w.sPREVfun = s.prevFun;
    w.sNEXTfun = s.nextFun;
    w.sEfun = s.eFun;
    w.sOkfun = s.okFun;
    w.s13dur = s.seek13Duration;
    w.s46dur = s.seek46Duration;
    w.s79dur = s.seek79Duration;
    w.sNoColorKeys = s.noColorKeys;
    w.sNoNumbersKeys = s.noNumbersKeys;
    w.sTimezone = s.timezone;
    w.sSleepTimeout = s.sleepTimeout;
    w.sVolumeStep = s.volumeStep;
    w.sInfoTimeout = s.infoTimeout;
    w.sInfoSlide = s.infoSlide;
    w.sInfoSwitch = s.infoSwitch;
    w.sInfoChange = s.infoChange;
    w.sInfoRew = s.infoRew;
    w.sThumbnail = s.thumbnail;
    w.sOsdOpacity = s.osdOpacity;
    w.sListPos = s.listPosition;
    w.sEditor = s.editor;
    w.sShowNum = s.showNumber;
    w.sShowPikon = s.showPicon;
    w.sShowName = s.showName;
    w.sShowProgress = s.showProgress;
    w.sShowArchive = s.showArchive;
    w.sShowScroll = s.showScroll;
    w.sShowDescr = s.showDescription;
    w.sShowProgram = s.showProgram;
    w.sPreview = s.preview;
    w.sNextCount = s.nextCount;
    w.sNextCountL = s.nextCountList;
    w.sFavorites = s.favorites;
    w.sPermanentTime = s.permanentTime;
    w.s10resum = s.res10Resume;
    w.sPrevCount = s.prevCount;
    w.sMedCount = s.medCount;
    w.sPSchannels = s.psChannels;
    w.sPSoptions = s.psOptions;
    w.sPSprovs = s.psProvs;
    w.sHDMIsupport = s.hdmiSupport;
    w.sAutorun = s.autorun;
    w.sPlayers = s.players;
    w.sBufSize = s.bufSize;
    w.sGrapI = s.grapI;
    w.parentPIN = s.parentPin;
    w.sSHLcolSel = s.highlightColorSel;
    w.sSHLcolor = s.highlightColor;
    w.sSHLcolorB = s.highlightColorB;
    w.sLocalCmdUrl = s.localCmdUrl;
}

/**
 * Copy window.s* globals (updated by settings menus / saveIfChanged) back
 * into the typed settings object so apply helpers use the values just saved.
 */
export function pullSettingsFromWindow(s: PlayerSettings): PlayerSettings {
    var w = window as any;
    function num(v: any, fallback: number): number {
        var n = typeof v === "number" ? v : parseInt(v, 10);
        return isNaN(n) ? fallback : n;
    }
    if (w.sNoSmall !== undefined) s.noSmall = num(w.sNoSmall, s.noSmall);
    if (w.sStopPlay !== undefined) s.stopPlay = num(w.sStopPlay, s.stopPlay);
    if (w.sPipSize !== undefined) s.pipSize = num(w.sPipSize, s.pipSize);
    if (w.sPipPos !== undefined) s.pipPosition = num(w.sPipPos, s.pipPosition);
    if (w.sPageSize !== undefined) s.pageSize = num(w.sPageSize, s.pageSize);
    if (w.sFontShift !== undefined)
        s.fontShift = num(w.sFontShift, s.fontShift);
    if (w.sFont !== undefined) s.fontSize = num(w.sFont, s.fontSize);
    if (w.sArrowFun !== undefined) s.arrowFun = num(w.sArrowFun, s.arrowFun);
    if (w.sRewFun !== undefined) s.rewFun = num(w.sRewFun, s.rewFun);
    if (w.sPNFun !== undefined) s.pnFun = num(w.sPNFun, s.pnFun);
    if (w.sTimezone !== undefined) s.timezone = num(w.sTimezone, s.timezone);
    if (w.sSleepTimeout !== undefined)
        s.sleepTimeout = num(w.sSleepTimeout, s.sleepTimeout);
    if (w.sVolumeStep !== undefined)
        s.volumeStep = num(w.sVolumeStep, s.volumeStep);
    if (w.sInfoTimeout !== undefined)
        s.infoTimeout = num(w.sInfoTimeout, s.infoTimeout);
    if (w.sOsdOpacity !== undefined)
        s.osdOpacity = num(w.sOsdOpacity, s.osdOpacity);
    if (w.sListPos !== undefined)
        s.listPosition = num(w.sListPos, s.listPosition);
    if (w.sEditor !== undefined) s.editor = num(w.sEditor, s.editor);
    if (w.sPermanentTime !== undefined)
        s.permanentTime = num(w.sPermanentTime, s.permanentTime);
    if (w.sGrapI !== undefined) s.grapI = num(w.sGrapI, s.grapI);
    if (w.s10resum !== undefined)
        s.res10Resume = num(w.s10resum, s.res10Resume);
    if (w.sPrevCount !== undefined)
        s.prevCount = num(w.sPrevCount, s.prevCount);
    if (w.sMedCount !== undefined) s.medCount = num(w.sMedCount, s.medCount);
    if (w.sPlayers !== undefined) s.players = num(w.sPlayers, s.players);
    if (w.sBufSize !== undefined) s.bufSize = num(w.sBufSize, s.bufSize);
    if (w.sAutorun !== undefined) s.autorun = num(w.sAutorun, s.autorun);
    if (typeof w.sSHLcolor === "string") s.highlightColor = w.sSHLcolor;
    if (typeof w.sSHLcolSel === "string") s.highlightColorSel = w.sSHLcolSel;
    if (typeof w.sSHLcolorB === "string") s.highlightColorB = w.sSHLcolorB;
    if (w.sShowNum !== undefined) s.showNumber = num(w.sShowNum, s.showNumber);
    if (w.sShowPikon !== undefined)
        s.showPicon = num(w.sShowPikon, s.showPicon);
    if (w.sShowName !== undefined) s.showName = num(w.sShowName, s.showName);
    if (w.sShowProgress !== undefined)
        s.showProgress = num(w.sShowProgress, s.showProgress);
    if (w.sShowArchive !== undefined)
        s.showArchive = num(w.sShowArchive, s.showArchive);
    if (w.sShowScroll !== undefined)
        s.showScroll = num(w.sShowScroll, s.showScroll);
    if (w.sShowDescr !== undefined)
        s.showDescription = num(w.sShowDescr, s.showDescription);
    if (w.sShowProgram !== undefined)
        s.showProgram = num(w.sShowProgram, s.showProgram);
    if (w.sPreview !== undefined) s.preview = num(w.sPreview, s.preview);
    if (w.sNextCount !== undefined)
        s.nextCount = num(w.sNextCount, s.nextCount);
    if (w.sNextCountL !== undefined)
        s.nextCountList = num(w.sNextCountL, s.nextCountList);
    if (w.sFavorites !== undefined)
        s.favorites = num(w.sFavorites, s.favorites);
    if (w.sInfoSlide !== undefined)
        s.infoSlide = num(w.sInfoSlide, s.infoSlide);
    if (w.sInfoSwitch !== undefined)
        s.infoSwitch = num(w.sInfoSwitch, s.infoSwitch);
    if (w.sInfoChange !== undefined)
        s.infoChange = num(w.sInfoChange, s.infoChange);
    if (w.sInfoRew !== undefined) s.infoRew = num(w.sInfoRew, s.infoRew);
    if (w.sThumbnail !== undefined)
        s.thumbnail = num(w.sThumbnail, s.thumbnail);
    return s;
}

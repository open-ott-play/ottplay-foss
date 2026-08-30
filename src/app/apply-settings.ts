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

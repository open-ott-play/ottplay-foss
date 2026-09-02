/**
 * UI management — info bar, dialogs, lists, volume, color, time display.
 */

import { getCurProgData } from "../channels";
import { video } from "../core";
import { dispatchKey, keys } from "../keyhandler";
import { translate as _ } from "../localization";
import { settings } from "../settings";
import {
    formatTwoDigits,
    getHeightK,
    getThumbnail,
    getWidthK,
    time2time,
} from "../utils/helpers";

declare var $: any;
declare var jQuery: any;

// Globals from other modules
declare var selIndex: number;
declare var isListVisible: boolean;
declare var listPopUpElement: HTMLElement | null;
declare var addBtn2menu: (arr: any[], action: any, label: string) => void;
declare var dialogBoxKeyHandler: ((key: number) => void) | null;
declare var listArray: any[];
declare var curList: any[];
declare var primaryIndex: number;
declare var sHideMenus: string[];
declare var sNoNumbersKeys: number;
declare var sNoColorKeys: number;
declare var nprovparams: number;

// DOM element references
var $infoBar: any;
var infoTimeout: any = null;
var listElement: HTMLElement | null = null;
var listInElement: HTMLElement | null = null;
var listCaptionElement: HTMLElement | null = null;
var listPodvalElement: HTMLElement | null = null;
var listDetailElement: HTMLElement | null = null;
var numprogElement: HTMLElement | null = null;

// State
var listDataArray: any[] = [];
var getListItemFn: ((item: any, idx: number) => string) | null = null;
var detailListActionFn: (() => void) | null = null;
var listKeyHandlerFn: ((key: any) => boolean) | null = null;
// Forward old-style global names (set by provider scripts) to new-style module variables
Object.defineProperty(window, "listKeyHandler", {
    configurable: true,
    enumerable: true,
    get: function (): any {
        return listKeyHandlerFn;
    },
    set: function (v: any) {
        listKeyHandlerFn = v;
    },
});
Object.defineProperty(window, "getListItem", {
    configurable: true,
    enumerable: true,
    get: function (): any {
        return getListItemFn;
    },
    set: function (v: any) {
        getListItemFn = v;
    },
});
Object.defineProperty(window, "detailListAction", {
    configurable: true,
    enumerable: true,
    get: function (): any {
        return detailListActionFn;
    },
    set: function (v: any) {
        detailListActionFn = v;
    },
});
var itemWidth = 735;
declare var curColor: string;
declare var curColorB: string;

// Edit mode state — use window.editvar so provider scripts can set it directly
if (typeof (window as any).editvar === "undefined")
    (window as any).editvar = "";
if (typeof (window as any).editCaption === "undefined")
    (window as any).editCaption = "";
var editPos = 0;
var cursorInterval: any = null;
var _keyCur = 0;
var _keyP = false;

// Keyboard layout (from original stbPlayer)
var _keys1 = "1234567890";
var _keysA = "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09";
var _keysL = "abcdefghijklmnopqrstuvwxyz";
var _keysP = ".:/@,!?<>#$%^&*()-=_+;'\"[]{}`~";
var _keys = "";
var _keysSymbol: any[] = [
    {
        a: function () {
            _setCase(!_keyUp);
            showEdit();
        },
        s: "",
    },
    {
        a: function () {
            if (!_keysSymbol[1].s) return;
            _keyP = false;
            _setLang(!_keyE);
            showEdit();
        },
        s: "",
    },
    {
        a: function () {
            _setPunct(!_keyP);
            showEdit();
        },
        s: "",
    },
    { a: (window as any).loadValue || function () {}, s: "&hearts;&trade;" },
    {
        a: function () {
            if (editPos) {
                editPos--;
                _changeEdit();
            }
        },
        s: "&larr;",
    },
    {
        a: function () {
            if (editPos < (window as any).editvar.length) {
                editPos++;
                _changeEdit();
            }
        },
        s: "&rarr;",
    },
    {
        a: function () {
            (window as any).editvar =
                (window as any).editvar.substr(0, editPos) +
                " " +
                (window as any).editvar.substr(editPos);
            editPos++;
            _changeEdit();
        },
        s: "_",
    },
    {
        a: function () {
            if (editPos) {
                (window as any).editvar =
                    (window as any).editvar.substr(0, editPos - 1) +
                    (window as any).editvar.substr(editPos);
                editPos--;
                _changeEdit();
            }
        },
        s: "",
    },
    { a: function () {}, s: "" },
    {
        a: function () {
            clearInterval(cursorInterval);
            (window as any).restoreCPD();
            $("#listEdit").hide();
            if (typeof (window as any).setEdit === "function")
                (window as any).setEdit();
        },
        s: "Ok",
    },
];
var _keyUp = false;
var _keyE = false;

// Select/value state
var _curVal = 0;
var aboutKeyHandler: ((key: number) => boolean) | null = null;

// Volume
var volumeTimeout: any = null;

// UI state for save/restore
var ui_state: any = {};

// String constants for button hints
export var strUP = '<span class="fontello">&#xe80b;</span>';
export var strDOWN = '<span class="fontello">&#xe80a;</span>';
export var strLEFT = '<span class="fontello">&#xe80c;</span>';
export var strRIGHT = '<span class="fontello">&#xe80d;</span>';
export var strSTOP = '<span class="fontello">&#xe812;</span>';
export var strPLAY = '<span class="fontello">&#xe811;</span>';
export var strPAUSE = '<span class="fontello">&#xe813;</span>';
export var strPlayPause = '<span class="fontello">&#xe811;&#xe813;</span>';
export var strRW = '<span class="fontello">&#xe803;</span>';
export var strFF = '<span class="fontello">&#xe802;</span>';
export var strPREV = '<span class="fontello">&#xe806;</span>';
export var strNEXT = '<span class="fontello">&#xe805;</span>';
export var strInfo = "INFO";
export var strEPG = "EPG";
export var strSubt = "";
export var strNew = ' <span style="color:red;font-size:60%;">NEW</span>';
export var strRETURN = '<span class="fontello">&#xe804;</span>';
export var strSETUP = "§";
export var strLANG = "SHIFT";
export var strENTER = "ENTER";
export var strTools = '<span class="fontello">&#xe808;</span>';
export var strPip = "W";
export var strAspect = "A";
export var strZoom = "E";
export var strAudio = "S";
export var strPRECH = "?";

/**
 * Initialize UI module — cache DOM element references, load CSS, patch jQuery show/hide,
 * bind click/wheel/progress-bar event handlers.
 *
 * @returns void
 * @sideeffect Hides the info bar and numprog element on init. Appends a `<link>` stylesheet to `<head>`.
 *             Patches `$.fn.show` and `$.fn.hide` to trigger custom events. Binds mousewheel on list
 *             and click/mousemove on the progress bar.
 * @analysis The jQuery show/hide patch allows other handlers to react to visibility changes via `on('show')`/`on('hide')`.
 *             Progress bar click supports seeking for both timeshift (playType < 0) and archive (playType > 0) playback.
 */
export function uiInit(): void {
    $infoBar = $("#info1");
    $infoBar.hide();
    listElement = document.getElementById("list");
    listInElement = document.getElementById("listIn");
    listCaptionElement = document.getElementById("listCaption");
    listPodvalElement = document.getElementById("listPodval");
    listDetailElement = document.getElementById("listDetail");
    listPopUpElement = document.getElementById("listPopUp");
    numprogElement = document.getElementById("numprog");
    if (numprogElement) numprogElement.style.display = "none";

    var host = (window as any).__host || "";
    var version = (window as any).__av || "local";

    if (!document.querySelector('link[href*="1280.css"]')) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = host + "/stbPlayer/1280.css?" + version;
        document.head.appendChild(link);
    }

    // Patch jQuery show/hide to trigger events
    (function ($) {
        $.each(["show", "hide"], function (_i, ev) {
            var orig = $.fn[ev];
            $.fn[ev] = function () {
                this.triggerHandler(ev);
                return orig.apply(this, arguments);
            };
        });
    })(jQuery);

    $("#listAbout").on("show", function () {
        $("#listIn").hide();
    });
    $("#listAbout").on("hide", function () {
        $("#listIn").show();
    });
    $("#listEdit").on("show", function () {
        $("#listIn").hide();
    });
    $("#listEdit").on("hide", function () {
        $("#listIn").show();
        $("#listEdit").text("");
    });
    $("#dialogbox").on("show", function () {
        $(this)
            .css({ height: "auto", left: 0, top: 0, width: "auto" })
            .css({
                left: (1260 * getWidthK() - $(this).width()) / 2,
                top: (720 * getHeightK() - $(this).height()) / 2,
            });
    });

    // Click on info bar toggles channel info display
    $infoBar.click(function (e: any) {
        if (!e) e = event;
        e.stopPropagation();
        if (typeof (window as any).showChanelInfo === "function")
            (window as any).showChanelInfo();
    });

    // Mousewheel on list
    var listInEl = listInElement;
    if (listInEl) {
        var onWheel = function (e: any): void {
            if (!e) e = event;
            var t = e.deltaY || e.detail || -e.wheelDelta;
            if (e.preventDefault) e.preventDefault();
            else e.returnValue = false;
            if (
                t < 0 &&
                (window as any).selIndex > 0 &&
                typeof (window as any).changeSelect === "function"
            )
                (window as any).changeSelect(-1);
            if (
                t > 0 &&
                (window as any).selIndex <
                    ((window as any).listArray || []).length - 1 &&
                typeof (window as any).changeSelect === "function"
            )
                (window as any).changeSelect(1);
        };
        if ("onwheel" in document) {
            (listInEl as any).onwheel = onWheel;
        } else if ("onmousewheel" in document) {
            (listInEl as any).onmousewheel = onWheel;
        }
    }

    // Progress bar drag-to-seek — press on progress bar and drag to seek, release to seek
    var $progressDiv = $("#progress_div");
    var seekInProgress = false;
    var seekStartX = 0;

    $progressDiv.mousedown(function (e: any) {
        if (!e) e = event;
        if (e.clientX === undefined) {
            console.error("$progress_div[mousedown] evt.clientX not exist");
            return;
        }
        seekInProgress = true;
        seekStartX = e.clientX;
    });

    $progressDiv.mouseup(function (e: any) {
        if (!seekInProgress) return;
        seekInProgress = false;
        if (!e) e = event;
        if (e.clientX === undefined) {
            console.error("$progress_div[mouseup] evt.clientX not exist");
            return;
        }
        e.stopPropagation();
        var w = window as any;
        if (
            !(
                w.playType ||
                (w.chanels &&
                    w.curList &&
                    w.chanels[w.curList[w.primaryIndex]] &&
                    w.chanels[w.curList[w.primaryIndex]].rec)
            )
        )
            return;
        var t =
            (e.clientX - $progressDiv.position().left) / $progressDiv.width();
        if (w.playType < 0) {
            var r = Math.max(Math.round(t * w.stbGetLen()), 0);
            var hr = Math.floor(r / 3600);
            var mn = Math.floor((r % 3600) / 60);
            var sc = r % 60;
            if (typeof w.showShift === "function")
                w.showShift(
                    ">> " +
                        (hr ? hr + ":" : "") +
                        _t2(mn) +
                        ":" +
                        _t2(sc) +
                        " <<"
                );
            if (typeof w.stbSetPosTime === "function") w.stbSetPosTime(r);
            return;
        }
        var r2 = Math.round(
            t * (w._prog100.time_to - w._prog100.time) + w._prog100.time
        );
        if (r2 < Date.now() / 1e3) {
            if (!w.playType) {
                if (typeof w.timeShift === "function")
                    w.timeShift(Math.round(Date.now() / 1e3 - r2));
                return;
            }
            if (typeof w.showShift === "function")
                w.showShift(">> " + pos2text(r2) + " <<");
            if (typeof w.playArchive === "function") w.playArchive(r2);
        } else {
            if (typeof w.showShift === "function")
                w.showShift(w._(w.playType ? "Live" : "Restart stream"));
            if (typeof w.playChannel === "function")
                w.playChannel(w.catIndex, w.primaryIndex);
        }
    });

    // Progress bar click — seek (for press-and-release at same position)
    $progressDiv.click(function (e: any) {
        if (!e) e = event;
        if (e.clientX === undefined) {
            console.error("$progress_div[click] evt.clientX not exist");
            return;
        }
        e.stopPropagation();
        var w = window as any;
        if (
            !(
                w.playType ||
                (w.chanels &&
                    w.curList &&
                    w.chanels[w.curList[w.primaryIndex]] &&
                    w.chanels[w.curList[w.primaryIndex]].rec)
            )
        )
            return;
        var t =
            (e.clientX - $progressDiv.position().left) / $progressDiv.width();
        if (w.playType < 0) {
            var r = Math.max(Math.round(t * w.stbGetLen()), 0);
            var hr = Math.floor(r / 3600);
            var mn = Math.floor((r % 3600) / 60);
            var sc = r % 60;
            if (typeof w.showShift === "function")
                w.showShift(
                    ">> " +
                        (hr ? hr + ":" : "") +
                        _t2(mn) +
                        ":" +
                        _t2(sc) +
                        " <<"
                );
            if (typeof w.stbSetPosTime === "function") w.stbSetPosTime(r);
            return;
        }
        var r2 = Math.round(
            t * (w._prog100.time_to - w._prog100.time) + w._prog100.time
        );
        if (r2 < Date.now() / 1e3) {
            if (!w.playType) {
                if (typeof w.timeShift === "function")
                    w.timeShift(Math.round(Date.now() / 1e3 - r2));
                return;
            }
            if (typeof w.showShift === "function")
                w.showShift(">> " + pos2text(r2) + " <<");
            if (typeof w.playArchive === "function") w.playArchive(r2);
        } else {
            if (typeof w.showShift === "function")
                w.showShift(w._(w.playType ? "Live" : "Restart stream"));
            if (typeof w.playChannel === "function")
                w.playChannel(w.catIndex, w.primaryIndex);
        }
    });

    // Progress bar mousemove — show tooltip
    var tooltipEl = document.getElementById("progress_span");
    $progressDiv.mousemove(function (e: any) {
        if (!e) e = event;
        if (e.clientX === undefined) {
            console.error("$progress_div[mousemove] evt.clientX not exist");
            return;
        }
        var w = window as any;
        if (
            !(
                w.playType ||
                (w.chanels &&
                    w.curList &&
                    w.chanels[w.curList[w.primaryIndex]] &&
                    w.chanels[w.curList[w.primaryIndex]].rec)
            )
        )
            return;
        var clientX = e.clientX;
        if (tooltipEl) {
            tooltipEl.style.display = "block";
            tooltipEl.style.top =
                $progressDiv.offset().top - $progressDiv.height() + "px";
            tooltipEl.style.left = clientX - tooltipEl.offsetWidth / 2 + "px";
        }
        var $tooltipSpan = $("span", tooltipEl);
        var frac =
            (clientX - $progressDiv.position().left) / $progressDiv.width();
        if (w.playType < 0) {
            var r = Math.max(Math.round(frac * w.stbGetLen()), 0);
            var hr = Math.floor(r / 3600);
            var mn = Math.floor((r % 3600) / 60);
            var sc = r % 60;
            $tooltipSpan.text((hr ? hr + ":" : "") + _t2(mn) + ":" + _t2(sc));
        } else {
            var r2 = Math.round(
                frac * (w._prog100.time_to - w._prog100.time) + w._prog100.time
            );
            $tooltipSpan.text(pos2text(r2));
        }
    });
}

/**
 * Hide the info bar after a conditional delay. If the player is buffering, not playing, or in step mode,
 * re-checks after 5 seconds. Otherwise hides immediately.
 *
 * @returns void
 * @sideeffect Calls `infoBarHide()` immediately or schedules itself again via `setTimeout`.
 * @analysis This is a polling-style hide: it keeps retrying every 5s until conditions are right for immediate hide.
 */
export function infoBarHideT(): void {
    if (typeof (window as any).stbIsPlaying === "function") {
        if (
            $("#buffering").is(":visible") ||
            !(window as any).stbIsPlaying() ||
            $("#step").is(":visible")
        ) {
            infoTimeout = setTimeout(infoBarHideT, 5000);
        } else {
            infoBarHide();
        }
    }
}

/**
 * Immediately hide the info bar and clear the progress tooltip.
 *
 * @returns void
 * @sideeffect Clears `infoTimeout`. Hides `$infoBar`. Sets progress_span tooltip display to '' (shows it by clearing).
 * @analysis Hides the info bar unconditionally, even if it is already hidden.
 */
export function infoBarHide(): void {
    try {
        var tooltip = document.getElementById("progress_span");
        if (tooltip) tooltip.style.display = "";
    } catch (e) {
        console.error(e);
    }
    clearTimeout(infoTimeout);
    if ((window as any).sInfoSlide) {
        $infoBar.slideUp();
    } else {
        $infoBar.hide();
    }
    $("#descr").hide();
}

/**
 * Show the channel info bar and schedule its auto-hide after `timeoutSec` seconds.
 *
 * @param timeoutSec - Number of seconds before the info bar is hidden (multiplied by 1000 for setTimeout).
 * @returns void
 * @sideeffect Shows `$infoBar`, clears any existing `infoTimeout`, and sets a new timeout to call `infoBarHide`.
 */
export function showChanelInfo(timeoutSec: number): void {
    var w = window as any;
    clearTimeout(detailTimer);
    clearTimeout(infoTimeout);
    if (timeoutSec === undefined) timeoutSec = 0;
    // If called with timeoutSec=1 and bar is already visible with descr hidden, just reset timeout
    if (
        timeoutSec === 1 &&
        $infoBar.is(":visible") &&
        !$("#descr").is(":visible")
    ) {
        infoTimeout = setTimeout(infoBarHideT, (w.sInfoTimeout || 5) * 1000);
        return;
    }
    // Hide first for animated re-show (when timeoutSec is 1 or 2)
    if (timeoutSec) $infoBar.hide();
    $("#programm_descr").stop(true).css("margin-top", 0);
    if (!$infoBar.is(":visible")) {
        if (timeoutSec !== 2) $("#descr").hide();
        else $("#descr").show();
        if (w.sInfoSlide) {
            $infoBar.slideDown(400, function () {
                if (typeof w.scrollUpDescr === "function") w.scrollUpDescr();
            });
        } else {
            $infoBar.show(0, function () {
                if (typeof w.scrollUpDescr === "function") w.scrollUpDescr();
            });
        }
        if (timeoutSec !== 2) {
            infoTimeout = setTimeout(
                infoBarHideT,
                (timeoutSec > 0 ? timeoutSec : w.sInfoTimeout || 5) * 1000
            );
        }
    } else if (!$("#descr").is(":visible")) {
        if (w.sInfoSlide) {
            $("#descr").slideDown(400, function () {
                if (typeof w.scrollUpDescr === "function") w.scrollUpDescr();
            });
        } else {
            $("#descr").show(0, function () {
                if (typeof w.scrollUpDescr === "function") w.scrollUpDescr();
            });
        }
    } else {
        infoBarHide();
    }
}

/**
 * Render the current page of items in the list overlay.
 * Calculates page boundaries from `selIndex` and `settings.pageSize`, builds HTML for visible items,
 * and renders a scrollbar thumbnail when content exceeds one page.
 *
 * @returns void
 * @sideeffect Hides info bar and permanentTime. Shows `list_osd` or `list_window`. Sets `listInElement.innerHTML`.
 *             Calls `detailListActionWithTimeOut()` after rendering.
 * @analysis Falls back to `window.listDataArray` if the module-level `listDataArray` is empty.
 *             Each item is rendered as a `<div id="it{i}">` with the result of `getListItemFn(item, i)`.
 *             The scrollbar shows the current page position as a colored bar.
 */
export function showPage(): void {
    isListVisible = true;
    $infoBar.hide();
    $("#permanentTime").hide();
    if (listInElement) listInElement.innerHTML = "";
    try {
        if (settings.noSmall) {
            $("#list_osd").show();
        } else {
            $("#list_window").show();
            if (typeof (window as any).stbSetWindow === "function")
                (window as any).stbSetWindow();
        }
    } catch (e) {
        console.error(e);
    }
    if (listElement) listElement.style.display = "";
    var dataArr = listDataArray.length
        ? listDataArray
        : (window as any).listDataArray || [];
    var pageStart =
        Math.floor(selIndex / settings.pageSize) * settings.pageSize;
    var pageEnd = Math.min(pageStart + settings.pageSize, dataArr.length);
    var itemHeight =
        (window.innerHeight - 90 * getHeightK()) / settings.pageSize;
    var html = "";
    if (dataArr.length > settings.pageSize) {
        itemWidth = getWidthK() * 720;
        (window as any).itemWith = itemWidth;
        var scrollWidth = 10 * getWidthK();
        var totalPages =
            Math.floor(dataArr.length / settings.pageSize) +
            (dataArr.length % settings.pageSize ? 1 : 0);
        var currentPage = Math.floor(selIndex / settings.pageSize);
        html +=
            '<div onclick="event.stopPropagation();changeSelect(' +
            settings.pageSize +
            ');" style="float:right;height:100%;width:' +
            scrollWidth +
            'px; border: 1px solid #f0f0f0;">';
        html +=
            '<div onclick="event.stopPropagation();changeSelect(-' +
            settings.pageSize +
            ');" style="width:100%;height:' +
            (currentPage / totalPages) * 100 +
            '%;"></div>';
        html +=
            '<div style="background-color: #888;width:100%;height:' +
            100 / totalPages +
            '%;"></div></div>';
    } else {
        itemWidth = getWidthK() * 735;
        (window as any).itemWith = itemWidth;
    }
    for (var i = pageStart; i < pageEnd; i++) {
        var selected = i === selIndex;
        html +=
            '<div id="it' +
            i +
            '" onclick="event.stopPropagation();setSelect(' +
            i +
            ')" class="item"';
        html +=
            ' style="height:' +
            itemHeight +
            "px; line-height:" +
            itemHeight +
            "px; width:" +
            itemWidth +
            "px;";
        if (selected)
            html +=
                "color:" +
                (curColor || "gold") +
                "; background-color:" +
                (curColorB || "#668") +
                ";";
        html += '">';
        try {
            html += getListItemFn ? getListItemFn(dataArr[i], i) : "";
        } catch (e) {
            html += "ERROR:" + (e as any).message;
        }
        html += "</div>";
    }
    if (listInElement) listInElement.innerHTML = html;
    detailListActionWithTimeOut();
}

/**
 * Change the list selection by a delta offset. Wraps around at boundaries.
 * Visually updates the highlight on the old and new items. If the new item is not in the current page,
 * calls `showPage()` to re-render.
 *
 * @param delta - Number of positions to move (positive = down, negative = up). Large values (pageSize) skip pages.
 * @returns void — early return if the data array is empty.
 * @sideeffect Modifies `selIndex`. Updates DOM element styles for old/new selection. Calls `detailListActionWithTimeOut()`.
 * @analysis Wrapping behavior differs for delta ±1 (wrap to opposite end) vs larger jumps (clamp at boundary).
 *             `showPage()` is called if the new index is not yet rendered on the current page.
 */
export function changeSelect(delta: number): void {
    var dataArr = listDataArray.length
        ? listDataArray
        : (window as any).listDataArray || [];
    if (!dataArr.length) return;
    var oldIndex = selIndex;
    selIndex += delta;
    if (selIndex < 0) selIndex = delta === -1 ? dataArr.length - 1 : 0;
    else if (selIndex >= dataArr.length)
        selIndex = delta === 1 ? 0 : dataArr.length - 1;
    var newItem = document.getElementById("it" + selIndex);
    if (newItem) {
        var oldItem = document.getElementById("it" + oldIndex);
        if (oldItem) {
            oldItem.style.backgroundColor = "";
            oldItem.style.color = "";
        }
        newItem.style.backgroundColor = curColorB || "#668";
        newItem.style.color = curColor || "gold";
        detailListActionWithTimeOut();
    } else {
        showPage();
    }
}

/**
 * Set list selection to a specific index (from click or programmatic call).
 * If the clicked item is already selected, dispatches ENTER (confirm). Otherwise moves selection
 * and updates highlighting.
 *
 * @param index - The target item index to select.
 * @returns void
 * @sideeffect Dispatches ENTER key if already on the target. Updates DOM styles for old/new selection.
 *             Calls `detailListActionWithTimeOut()`.
 */
export function setSelect(index: number): void {
    if (selIndex === index) {
        dispatchKey(keys.ENTER);
    } else {
        var oldItem = document.getElementById("it" + selIndex);
        selIndex = index;
        var newItem = document.getElementById("it" + selIndex);
        if (oldItem) {
            oldItem.style.backgroundColor = "";
            oldItem.style.color = "";
        }
        if (newItem) {
            newItem.style.backgroundColor = curColorB || "#668";
            newItem.style.color = curColor || "gold";
        }
        detailListActionWithTimeOut();
    }
}

/**
 * Close the list overlay (OSD or window) and return to full-screen video.
 *
 * @returns void
 * @sideeffect Sets `isListVisible = false`. Hides list element, `list_osd`, `list_window`.
 *             Shows `permanentTime` if `settings.permanentTime !== 0`. Calls `window.stbToFullScreen()`.
 * @analysis Errors during DOM manipulation are silently caught and logged.
 */
export function closeList(): void {
    isListVisible = false;
    try {
        if (listElement) listElement.style.display = "none";
        $("#list_osd").hide();
        $("#list_window").hide();
        $("#permanentTime").toggle(settings.permanentTime !== 0);
        if (typeof (window as any).stbToFullScreen === "function")
            (window as any).stbToFullScreen();
    } catch (e) {
        console.error(e);
    }
}

/**
 * Show a temporary notification/message at the bottom of the screen (the `#info` element).
 * Auto-hides after 3 seconds.
 *
 * @param message - HTML string to display.
 * @returns void
 * @sideeffect Sets `#info` innerHTML and display style, then hides it after 3000ms via setTimeout.
 */
export function showShift(message: string): void {
    var info = document.getElementById("info");
    if (info) {
        info.innerHTML = message;
        info.style.display = "";
    }
    setTimeout(function () {
        if (info) info.style.display = "none";
    }, 3000);
}

/**
 * Show a modal info dialog box with a single OK button.
 * Any key press dismisses it.
 *
 * @param message - HTML string for the dialog body.
 * @returns void
 * @sideeffect Shows `#dialogbox` with the message and an ENTER button. Registers a one-shot `dialogBoxKeyHandler`.
 */
export function infoBox(message: string): void {
    $("#dialogbox")
        .html(message + "<br/><br/>" + btnDiv(keys.ENTER, strENTER, "Ok"))
        .show();
    (window as any).dialogBoxKeyHandler = function (_e: number): void {
        $("#dialogbox").hide();
        (window as any).dialogBoxKeyHandler = null;
    };
}

/**
 * Show a confirmation dialog with Yes (ENTER) and No (RETURN) buttons.
 * Calls the appropriate callback based on the user's key press.
 *
 * @param message - HTML string for the dialog body.
 * @param onYes - Callback invoked when ENTER is pressed.
 * @param onNo - Optional callback invoked when RETURN/EXIT is pressed.
 * @returns void
 * @sideeffect Shows `#dialogbox`. Registers a one-shot `dialogBoxKeyHandler` that hides the box and calls the callback.
 */
export function confirmBox(
    message: string,
    onYes: () => void,
    onNo?: () => void
): void {
    $("#dialogbox")
        .html(
            message +
                "<br/><br/>" +
                btnDiv(keys.ENTER, strENTER, "Yes") +
                btnDiv(keys.RETURN, strRETURN, "No")
        )
        .show();
    (window as any).dialogBoxKeyHandler = function (e: number): void {
        $("#dialogbox").hide();
        (window as any).dialogBoxKeyHandler = null;
        if (e === keys.ENTER) {
            if (onYes) onYes();
        } else {
            if (onNo) onNo();
        }
    };
}

/**
 * Show a temporary select box (value picker) using the `numprog` element.
 * Supports single-item auto-select, timed auto-dismiss, and arrow-key navigation.
 *
 * @param s - Initial selected index.
 * @param n - Array of label strings to display.
 * @param i - Callback invoked with the selected index when confirmed.
 * @param a - Timeout in ms (default 3000). -1 = no auto-confirm (stay open until ENTER). 0 = auto-confirm after 2s.
 * @returns void
 * @sideeffect Clears `window.numTimeout`. Calls `closeList()`. Shows/hides `numprogElement`.
 *             Registers `window.selectBoxKeyHandler` for key events.
 * @analysis Single-element arrays call `showShift` and return early. The internal `r()` function re-renders
 *             the selection with highlighting. When `a === 0`, the current selection is auto-confirmed after 2s.
 */
export function showSelectBox(
    s: number,
    n: string[],
    i: (val: number) => void,
    a?: number
): void {
    clearTimeout((window as any).numTimeout);
    if (n.length === 0) return;
    if (n.length === 1) {
        showShift(n[0]);
        return;
    }
    if (typeof a === "undefined") a = 3000;

    /**
     * Internal: re-render the select box with a new selection index, update highlighting, and invoke the callback.
     *
     * @param e - New selection index (may wrap).
     * @returns void
     * @sideeffect Updates `numprogElement.innerHTML`. Sets timeout for auto-hide when `a` is truthy.
     */
    function r(e: number) {
        if (e === n.length) s = 0;
        else if (e < 0) s = n.length - 1;
        else s = e;
        if (a) i(s);
        var html = "";
        n.forEach(function (val, t) {
            html +=
                '<div style="' +
                (t === s
                    ? "color:" +
                      (window as any).curColor +
                      ";background-color:" +
                      (window as any).curColorB
                    : "") +
                '" onclick="_doKey(' +
                (-100 + t) +
                ');">&nbsp;&nbsp;' +
                val +
                "&nbsp;&nbsp;</div>";
        });
        if (numprogElement) numprogElement.innerHTML = html;
        if (a)
            (window as any).numTimeout = setTimeout(function () {
                if (numprogElement) numprogElement.style.display = "none";
                (window as any).selectBoxKeyHandler = null;
            }, a);
    }
    closeList();
    if (a === -1) {
        a = 0;
        r(s);
    } else if (a) {
        r(s + 1);
    } else {
        r(s);
        (window as any).numTimeout = setTimeout(function () {
            i(s);
            if (numprogElement) numprogElement.style.display = "none";
            (window as any).selectBoxKeyHandler = null;
        }, 2000);
    }
    if (numprogElement) numprogElement.style.display = "";
    (window as any).selectBoxKeyHandler = function (e: number): boolean {
        clearTimeout((window as any).numTimeout);
        switch (e) {
            case keys.ENTER:
                if (!a) i(s);
            case keys.RETURN:
                if (numprogElement) numprogElement.style.display = "none";
                (window as any).selectBoxKeyHandler = null;
                return true;
            case keys.UP:
                r(s - 1);
                return true;
            case keys.DOWN:
                r(s + 1);
                return true;
        }
        return false;
    };
}

/**
 * Update all channel-info UI elements (number, name, picon, current program, progress bar, next program).
 * Called periodically or when the channel changes.
 *
 * @param channelId - The channel identifier from `curList[primaryIndex]`.
 * @returns void — early return if channelId is null/undefined or doesn't match the current primary channel.
 * @sideeffect Modifies innerHTML/textContent/style of many DOM elements: channel_number, channel_name, picon,
 *             programm_name, programm_name2, programm_descr, programm_duration, begin_time, end_time,
 *             nprogramm_name, nbegin_time, nend_time, progress, progress_r, progress_div.
 *             Sets `window._prog100` to the current EPG program or 0.
 * @analysis If EPG data (name/time/time_to) exists on the channel object, it renders current and next program info.
 *             Otherwise clears all program fields. When the channel is unavailable, shows "Channel is not available!!!".
 *             Progress percentage is clamped to 0-100.
 */
export function updateChanelInfo(channelId: number): void {
    if (channelId == null) return;
    var curList = (window as any).curList || [];
    var primaryIndex = (window as any).primaryIndex;
    if (channelId !== curList[primaryIndex]) return;
    // Trigger EPG data load if needed; callback re-invokes when data arrives
    // Only fetch if channel doesn't already have valid EPG (prevents infinite recursion)
    var _ch = (window as any).chanels
        ? (window as any).chanels[channelId]
        : undefined;
    if (!(_ch && _ch.time_to) || _ch.time_to < Date.now() / 1000) {
        getCurProgData(channelId, function () {
            setTimeout(function () {
                updateChanelInfo(channelId);
            }, 0);
        });
    }
    var channelNumEl = document.getElementById("channel_number");
    var channelNameEl = document.getElementById("channel_name");
    var piconEl = document.getElementById("picon");
    var programNameEl = document.getElementById("programm_name");
    var programName2El = document.getElementById("programm_name2");
    var programDescrEl = document.getElementById("programm_descr");
    var programDurationEl = document.getElementById("programm_duration");
    var beginTimeEl = document.getElementById("begin_time");
    var endTimeEl = document.getElementById("end_time");
    var nprogramNameEl = document.getElementById("nprogramm_name");
    var nbeginTimeEl = document.getElementById("nbegin_time");
    var nendTimeEl = document.getElementById("nend_time");
    var progressEl = document.getElementById("progress");
    var progressREl = document.getElementById("progress_r");
    var progressDivEl = document.getElementById("progress_div");

    // Channel number
    if (channelNumEl)
        channelNumEl.innerHTML =
            "" + ((primaryIndex != null ? primaryIndex : -1) + 1);

    // Channel info from global chanels
    var t = (window as any).chanels
        ? (window as any).chanels[channelId]
        : undefined;
    if (t) {
        if (channelNameEl) channelNameEl.innerHTML = t.channel_name || "";
        if (piconEl)
            piconEl.style.backgroundImage =
                typeof (window as any).getChannelPicon === "function"
                    ? 'url("' +
                      (window as any).getChannelPicon(channelId) +
                      '")'
                    : t.logo
                      ? 'url("' + t.logo + '")'
                      : "";
    } else {
        if (channelNameEl)
            channelNameEl.innerHTML =
                (typeof _ === "function"
                    ? _("Channel is not available!!!")
                    : "N/A") +
                " id=" +
                channelId;
        if (piconEl) piconEl.style.backgroundImage = 'url("")';
    }

    // Reset progress & next program
    if (progressDivEl) progressDivEl.style.backgroundColor = "#446";
    if (progressREl) progressREl.style.width = "0%";
    if (nprogramNameEl) nprogramNameEl.innerHTML = "&nbsp; ";
    if (nbeginTimeEl) nbeginTimeEl.textContent = "";
    if (nendTimeEl) nendTimeEl.textContent = "";

    // EPG data (the channel object may have name/time/time_to from getCurProgData)
    if (t && t.name && t.time && t.time_to) {
        // Has current EPG program
        if (programNameEl) programNameEl.innerHTML = t.name;
        if (programName2El) programName2El.innerHTML = t.name;
        (window as any)._prog100 = t;
        var nowSec = Date.now() / 1000;
        var pct = ((nowSec - t.time) / (t.time_to - t.time)) * 100;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;
        if (progressEl) progressEl.style.width = pct + "%";
        if (beginTimeEl) beginTimeEl.textContent = time2time(t.time);
        var remainingMin = Math.round((t.time_to - nowSec) / 60);
        if (endTimeEl)
            endTimeEl.textContent = "+" + (remainingMin > 0 ? remainingMin : 0);
        if (programDurationEl) {
            programDurationEl.innerHTML =
                time2str(t.time) +
                " - " +
                time2time(t.time_to) +
                ' (<span id="cur_time">' +
                Math.round((nowSec - t.time) / 60) +
                "/</span>" +
                Math.round((t.time_to - t.time) / 60) +
                " " +
                (typeof _ === "function" ? _("min") : "min") +
                ")";
        }
        if (programDescrEl) {
            programDescrEl.innerHTML =
                (typeof getThumbnail === "function"
                    ? getThumbnail(t.icon || t.logo)
                    : "") + (t.descr || "");
        }
        // Next program
        if (t.nextpr && t.nextpr.length) {
            if (nprogramNameEl) nprogramNameEl.innerHTML = t.nextpr[0].name;
            if (nbeginTimeEl)
                nbeginTimeEl.textContent = time2time(t.nextpr[0].time);
            var nextDur = Math.round(
                (t.nextpr[0].time_to - t.nextpr[0].time) / 60
            );
            if (nendTimeEl)
                nendTimeEl.textContent = "" + (nextDur > 0 ? nextDur : 0);
        }
    } else {
        // No EPG — clear program fields
        if (programNameEl) programNameEl.innerHTML = "&nbsp; ";
        (window as any)._prog100 = 0;
        if (progressEl) progressEl.style.width = "0%";
        if (beginTimeEl) beginTimeEl.textContent = "";
        if (endTimeEl) endTimeEl.textContent = "";
        if (programName2El) programName2El.textContent = "";
        if (programDurationEl) programDurationEl.textContent = "";
        if (programDescrEl) programDescrEl.textContent = "";
    }
}

/**
 * Zero-pad a number to two digits for time display.
 *
 * @param n - A number (0-99 typically).
 * @returns string — Two-digit string, e.g. "05" or "12".
 */
function _t2(n: number): string {
    return n.toString().length === 1 ? "0" + n : "" + n;
}

/**
 * Start periodic timers:
 * 1. Every 1s — update clock displays and increment `window.playTime` when playing.
 * 2. Every 30s — refresh channel info via `updateChanelInfo`.
 *
 * @returns void
 * @sideeffect Sets up two `setInterval` calls that run indefinitely. Updates DOM elements `current_t`,
 *             `current_s`, `list_t`, `list_s`, `permanentTime`. Increments `window.playTime`.
 * @analysis The 1s timer also handles playTime tracking for archive playback. The 30s timer keeps EPG data fresh.
 */
export function initBackgroundIntervals(): void {
    setInterval(function () {
        var now = new Date();
        var timeStr = _t2(now.getHours()) + ":" + _t2(now.getMinutes());
        var secStr = ":" + _t2(now.getSeconds());
        var currentTEl = document.getElementById("current_t");
        var currentSEl = document.getElementById("current_s");
        var listTEl = document.getElementById("list_t");
        var listSEl = document.getElementById("list_s");
        var permTEl = document.getElementById("permanentTime");
        if (currentTEl) currentTEl.innerHTML = timeStr;
        if (currentSEl) currentSEl.innerHTML = secStr;
        if (listTEl) listTEl.innerHTML = timeStr;
        if (listSEl) listSEl.innerHTML = secStr;
        if (permTEl) permTEl.innerHTML = timeStr;
        if (
            typeof (window as any).playType !== "undefined" &&
            (window as any).playType &&
            typeof (window as any).stbIsPlaying === "function" &&
            (window as any).stbIsPlaying()
        ) {
            (window as any).playTime = ((window as any).playTime || 0) + 1;
        }
    }, 1000);
    setInterval(function () {
        if (typeof (window as any).updateChanelInfo === "function") {
            (window as any).updateChanelInfo((window as any).listChannel);
        }
    }, 30000);
}

/**
 * Update the video resolution display in the `#video_res` element from the video element's dimensions.
 *
 * @returns void
 * @sideeffect Sets `#video_res.innerHTML` to `<br/>WxH` if video dimensions are available.
 */
export function updateMediaInfo(): void {
    var resEl = document.getElementById("video_res");
    if (resEl && video && video.videoWidth)
        resEl.innerHTML = "<br/>" + video.videoWidth + "x" + video.videoHeight;
}

/**
 * Save the current list caption, podval (footer), and detail elements into `ui_state` and clear them.
 * Used before showing a temporary overlay (e.g., info, edit, color dialog) so the state can be restored later.
 *
 * @returns void
 * @sideeffect Stores innerHTML of listCaptionElement, listPodvalElement, listDetailElement in `ui_state` object.
 *             Clears the innerHTML of all three elements.
 */
export function saveCPD(): void {
    ui_state.lc = listCaptionElement ? listCaptionElement.innerHTML : "";
    ui_state.lp = listPodvalElement ? listPodvalElement.innerHTML : "";
    ui_state.ld = listDetailElement ? listDetailElement.innerHTML : "";
    if (listCaptionElement) listCaptionElement.innerHTML = "";
    if (listPodvalElement) listPodvalElement.innerHTML = "";
    if (listDetailElement) listDetailElement.innerHTML = "";
}

/**
 * Restore the list caption, podval, and detail elements from `ui_state` and reset the state object.
 *
 * @returns void
 * @sideeffect Restores innerHTML of listCaptionElement, listPodvalElement, listDetailElement from saved values.
 *             Resets `ui_state` to an empty object.
 */
export function restoreCPD(): void {
    if (listCaptionElement) listCaptionElement.innerHTML = ui_state.lc || "";
    if (listPodvalElement) listPodvalElement.innerHTML = ui_state.lp || "";
    if (listDetailElement) listDetailElement.innerHTML = ui_state.ld || "";
    ui_state = {};
}

/**
 * Render an HTML snippet for a button hint (used in info bars and list footers).
 * The hint shows the key label, optional numeric/symbolic badge, color class, and translated description.
 *
 * @param keyLabel - The key code (used for color class and onclick dispatch).
 * @param label - The display label (e.g. HTML entity for arrow icon). Empty for color keys.
 * @param description - The button's function description text (passed through translate).
 * @param num - Optional numeric badge (e.g. "2", "8"). Hidden if sNoNumbersKeys is set.
 * @param extra - Optional extra badge text. Hidden if sNoNumbersKeys is set.
 * @returns string — HTML string for the button hint span. Returns empty string if description or keyLabel is falsy.
 * @analysis Color keys (RED/GREEN/YELLOW/BLUE) get a CSS class `.red`/`.green`/`.yellow`/`.blue` respectively.
 *             If both label and badges are empty, the description itself is wrapped in a plain `.btn` div.
 *             The entire span has an onclick that calls `_doKey(keyLabel)`.
 */
export function btnDiv(
    keyLabel: number,
    label: string,
    description: string,
    num?: string,
    extra?: string
): string {
    if (!(description && keyLabel)) return "";
    description = _(description);
    var cls = "btn";
    switch (keyLabel) {
        case keys.RED:
            cls += " red";
            if (!label) label = "&nbsp;";
            break;
        case keys.GREEN:
            cls += " green";
            if (!label) label = "&nbsp;";
            break;
        case keys.YELLOW:
            cls += " yellow";
            if (!label) label = "&nbsp;";
            break;
        case keys.BLUE:
            cls += " blue";
            if (!label) label = "&nbsp;";
            break;
    }
    if ((window as any).sNoNumbersKeys) {
        if ("0123456789".indexOf(num!) !== -1) num = undefined;
        if ("0123456789".indexOf(extra!) !== -1) extra = undefined;
    }
    var a = label ? '<div class="' + cls + '">' + label + "</div>&nbsp;" : "";
    if (
        (window as any).sNoColorKeys &&
        [keys.RED, keys.GREEN, keys.YELLOW, keys.BLUE].indexOf(keyLabel) !== -1
    )
        a = "";
    if (num) a += '<div class="btn">' + num + "</div>&nbsp;";
    if (extra) a += '<div class="btn">' + extra + "</div>&nbsp;";
    if (!a) description = '<div class="btn">' + description + "</div>";
    return (
        '<span onclick="_doKey(' +
        keyLabel +
        ');">' +
        a +
        description +
        "</span>&nbsp;&nbsp;"
    );
}

var detailTimer: any = null;

/**
 * Debounced trigger for the detail-list action callback.
 * Clears any pending timeout, clears the detail element, then schedules `detailListActionFn` to run after 200ms.
 *
 * @returns void
 * @sideeffect Clears `detailTimer`. Clears `listDetailElement.innerHTML`. Calls `detailListActionFn` after delay.
 * @analysis This prevents rapid selection changes from producing excessive detail re-renders.
 */
function detailListActionWithTimeOut(): void {
    clearTimeout(detailTimer);
    if (listDetailElement) listDetailElement.innerHTML = "";
    detailTimer = setTimeout(function () {
        clearTimeout(detailTimer);
        if (detailListActionFn) detailListActionFn();
    }, 200);
}

/* ---------------------------------------------------------------------------
 * Time / position helpers
 * --------------------------------------------------------------------------- */

/**
 * Convert a Unix timestamp (seconds since epoch) to a "HH:MM:SS" time string.
 *
 * @param e - Unix timestamp in seconds.
 * @returns string — Formatted as "HH:MM:SS".
 */
export function pos2text(e: number): string {
    var t = new Date(e * 1e3);
    return (
        _t2(t.getHours()) +
        ":" +
        _t2(t.getMinutes()) +
        ":" +
        _t2(t.getSeconds())
    );
}

/**
 * Convert a time offset in seconds to a human-readable string like ">> 5 m 30 s" or "<< 2 m".
 * Positive values get ">> " prefix, negative get "<< " prefix.
 *
 * @param e - Offset in seconds (positive = forward, negative = backward).
 * @returns string — HTML string, or `&nbsp;` if offset is 0.
 */
export function step2text(e: number): string {
    var t = Math.floor(Math.abs(e) / 60);
    var r = Math.abs(e) % 60;
    return !e
        ? "&nbsp;"
        : (e > 0 ? ">> " : "<< ") +
              (t ? t + _(" m ") : "") +
              (r ? r + _(" s") : "");
}

/**
 * Convert a Unix timestamp to a locale-formatted date+time string: "Su 12.05 14:30".
 * Day names are from the translations of "Su Mo Tu We Th Fr Sa".
 *
 * @param e - Unix timestamp in seconds.
 * @returns string — Formatted as "Day dd.mm HH:MM".
 */
export function time2str(e: number): string {
    var days = _("Su Mo Tu We Th Fr Sa").split(" ");
    var d = new Date(e * 1e3);
    return (
        days[d.getDay()] +
        "&nbsp;" +
        _t2(d.getDate()) +
        "." +
        _t2(d.getMonth() + 1) +
        "&nbsp;" +
        _t2(d.getHours()) +
        ":" +
        _t2(d.getMinutes())
    );
}

/* ---------------------------------------------------------------------------
 * Scroll helpers
 * --------------------------------------------------------------------------- */

/**
 * Initiate auto-scroll of the program description text.
 * Repositions the tooltip, resets description margin, calculates scroll distance, and starts the animation.
 *
 * @returns void
 * @sideeffect Calls `scrollUp()` which animates `#programm_descr` margin-top and schedules the animation.
 * @analysis The scroll distance is calculated as the overflow of description content beyond its container.
 */
export function scrollUpDescr(): void {
    var tooltip = document.getElementById("progress_span");
    var $progress_div = $("#progress_div");
    if (tooltip && tooltip.style.display) {
        tooltip.style.top =
            $progress_div.offset().top - $progress_div.height() + "px";
    }
    $("#programm_descr").stop(true).css("margin-top", 0);
    var e =
        $("#programm_descr").height() -
        $("#descr").height() +
        $("#programm_name2").height() +
        $("#programm_duration").height();
    scrollUp("programm_descr", e, 10000);
}

/**
 * Animate an element's `margin-top` upward by `px` pixels after a delay, for scrolling long content.
 *
 * @param el - The element ID (without `#`).
 * @param px - The number of pixels to scroll up.
 * @param delay - Delay in ms before starting the animation.
 * @returns void
 * @sideeffect Clears `detailTimer` and sets a new timeout. Uses jQuery `animate()` on the element.
 * @analysis The animation duration is `px * 80` milliseconds (linear). Only animates if `px > 0`.
 */
export function scrollUp(el: string, px: number, delay: number): void {
    clearTimeout(detailTimer);
    if (px > 0) {
        detailTimer = setTimeout(function () {
            $("#" + el).animate({ "margin-top": "-=" + px }, px * 80);
        }, delay);
    }
}

/* ---------------------------------------------------------------------------
 * Info displays
 * --------------------------------------------------------------------------- */

/**
 * Show program info in the `#listAbout` overlay. Displays the title, description, and
 * buttons for TMDb search and close.
 *
 * @param title - The program title to display. If falsy, shows "no epg at current time" in an infoBox.
 * @returns void
 * @sideeffect Hides `listPopUp`. Calls `saveCPD()`. Sets caption/podval elements.
 *             Registers `aboutKeyHandler` for TMDb search and close. Shows `#listAbout`.
 */
export function infoProgramm(title: string): void {
    if (!title) {
        infoBox(_("no epg at current time"));
        return;
    }
    $("#listPopUp").hide();
    saveCPD();
    if (listCaptionElement) listCaptionElement.innerHTML = title;
    if (listPodvalElement) {
        var extra = "";
        if ((window as any).sArrowFun === 2) extra = strRIGHT;
        else if ((window as any).sRewFun === 1) extra = strFF;
        else if ((window as any).sPNFun === 1) extra = strNEXT;
        listPodvalElement.innerHTML =
            btnDiv(keys.RETURN, strRETURN, "Close") +
            (title ? btnDiv(keys.N2, strInfo, "TMDb", extra) : "");
    }
    aboutKeyHandler = function (e: number): boolean {
        if (title) {
            switch (e) {
                case keys.RIGHT:
                    if ((window as any).sArrowFun !== 2) break;
                case keys.N2:
                case keys.INFO:
                    if (
                        (window as any).TMDb &&
                        typeof (window as any).TMDb.search === "function"
                    )
                        (window as any).TMDb.search(title);
                    return true;
            }
        }
        return false;
    };
    $("#listAbout").show();
}

/**
 * Show media item info in the `#listAbout` overlay. Displays the selected media item's
 * title and description with TMDb search and close buttons.
 *
 * @returns void — early return if the selected item has no description.
 * @sideeffect Hides `listPopUp`. Calls `saveCPD()`. Sets caption/podval elements.
 *             Registers `aboutKeyHandler` for TMDb search and close. Shows `#listAbout`.
 */
export function infoMedia(): void {
    var la = (window as any).listArray || [];
    var si = (window as any).selIndex || 0;
    if (!(la[si] && la[si].description)) return;
    $("#listPopUp").hide();
    saveCPD();
    var t = la[si].title || "";
    if (listCaptionElement) listCaptionElement.innerHTML = t;
    if (listPodvalElement) {
        var extra = "";
        if ((window as any).sArrowFun === 2) extra = strRIGHT;
        else if ((window as any).sRewFun === 1) extra = strFF;
        else if ((window as any).sPNFun === 1) extra = strNEXT;
        listPodvalElement.innerHTML =
            btnDiv(keys.RETURN, strRETURN, "Close") +
            (t ? btnDiv(keys.N2, strInfo, "TMDb", extra) : "");
    }
    aboutKeyHandler = function (e: number): boolean {
        if (t) {
            switch (e) {
                case keys.RIGHT:
                    if ((window as any).sArrowFun !== 2) break;
                case keys.N2:
                case keys.INFO:
                    if (
                        (window as any).TMDb &&
                        typeof (window as any).TMDb.search === "function"
                    )
                        (window as any).TMDb.search(t);
                    return true;
            }
        }
        return false;
    };
    $("#listAbout").show();
}

/**
 * Show the "Info" list — a generic list of information items with actions.
 * Populates the list from `window.infoArr`. Supports number-key and color-key shortcuts.
 *
 * @param e - Optional action name to pre-select. If provided, searches `infoArr` for a matching `.action` and selects it.
 * @returns void
 * @sideeffect Sets up `listDataArray`, `getListItemFn`, `detailListActionFn`, `listKeyHandlerFn`.
 *             Sets caption/podval. Calls `showPage()`.
 * @analysis Info items are rendered from `infoArr`; each has `.name` and `.action`. N2/INFO triggers pluginInfo.
 */
export function infoList(e?: string): void {
    var infoArr = (window as any).infoArr || [];
    listDataArray = [];
    infoArr.forEach(function (item: any) {
        listDataArray.push(_(item.name || ""));
    });
    if (!(window as any).sNoNumbersKeys) {
        addBtn2menu(infoArr, (window as any).pluginInfo, "2");
        addBtn2menu(infoArr, (window as any).betaPage, "8");
    }
    addBtn2menu(infoArr, (window as any).pluginInfo, strInfo);
    selIndex = 0;
    if (typeof e !== "undefined") {
        for (var t = 0; t < infoArr.length; t++) {
            if (infoArr[t].action === e) {
                selIndex = t;
                break;
            }
        }
    }
    getListItemFn = function (item: any, _idx: number) {
        return "&nbsp;&nbsp;" + item;
    };
    detailListActionFn = function () {
        var arr = (window as any).infoArr || [];
        var item = arr[selIndex];
        if (item)
            listDetailElement!.innerHTML = _(item.desc || item.name || "");
    };
    listKeyHandlerFn = function (key: number): boolean {
        switch (key) {
            case keys.RETURN:
                closeList();
                return true;
            case keys.ENTER: {
                var arr = (window as any).infoArr || [];
                if (arr[selIndex] && arr[selIndex].action)
                    arr[selIndex].action();
                return true;
            }
            case keys.N2:
            case keys.INFO:
                if (typeof (window as any).pluginInfo === "function")
                    (window as any).pluginInfo();
                return true;
        }
        return false;
    };
    if (listCaptionElement) listCaptionElement.innerHTML = _("Info");
    if (listPodvalElement)
        listPodvalElement.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    showPage();
}

/* ---------------------------------------------------------------------------
 * Popup menu
 * --------------------------------------------------------------------------- */

/**
 * Show (or execute a specific action from) the popup menu.
 * Builds the full popup list from `window.popupActions`, filtering hidden items, adding
 * numeric/color/symbolic button labels, and registering key handlers.
 *
 * @param i - Optional: a numerical index (1-based) or action function to execute directly.
 *             If 0 or undefined, the full popup list is displayed.
 * @returns void
 * @sideeffect Hides `#listAbout` if visible and restores CPD. Builds `listArray` and `listDataArray`.
 *             Registers `listKeyHandlerFn` for all popup interactions. Shows `#list_window` and calls `showPage()`.
 * @analysis Items are filtered by `sHideMenus` array. Behavior switches (e.g. play/pause toggle) use `splitSlash` to
 *             show the active label. Number-key and color-key bindings are added conditionally based on settings.
 *             PIN-check items (noProvParam) toggle `window.nprovparams`.
 */
export function popupList(i?: any): void {
    // Hide any loading spinner before showing menu
    $("#dialogbox").hide();
    $("#buffering").hide();
    if ($("#listAbout").is(":visible")) {
        $("#listAbout").hide();
        restoreCPD();
    }

    var popupActions: any[] = (window as any).popupActions || [];
    if (typeof i !== "undefined" && i !== 0) {
        var action = typeof i === "number" ? popupActions[i - 1] : i;
        if (action) {
            if (typeof action === "function") action();
            return;
        }
    }

    var a = 0,
        o = 0; // для PIN проверки

    /**
     * Split a label string on "/" and return either the left or right part based on a condition.
     * Used for toggling labels (e.g., "Play/Pause").
     *
     * @param e - The label string containing "/" as a separator.
     * @param t - If true, return the right part (after "/"); if false, return the left part (before "/").
     * @returns string — The chosen segment, trimmed.
     */
    function splitSlash(e: string, t: boolean): string {
        try {
            e = e.split("/")[t ? 1 : 0].trim();
        } catch (ex) {
            console.error(ex);
        }
        return e;
    }

    if (typeof i === "undefined") i = 0;
    selIndex = 0;
    listArray = [];
    listDataArray = [];

    var c: any = false;
    try {
        c = curList[primaryIndex];
    } catch (e) {
        console.error(e);
    }

    var u = -1; // counter для добавленных элементов
    var playType: number = (window as any).playType || 0;
    var chanels: any = (window as any).chanels || {};
    var popStop: any = (window as any).popStop;
    var popPause: any = (window as any).popPause;
    var popTogglePip: any = (window as any).popTogglePip;
    var toggleAudioTrack: any = (window as any).toggleAudioTrack;
    var toggleSubtitle: any = (window as any).toggleSubtitle;
    var popShift: any = (window as any).popShift;
    var popRecords: any = (window as any).popRecords;
    var popStopPip: any = (window as any).popStopPip;
    var popMedia: any = (window as any).popMedia;
    var popPrevProg: any = (window as any).popPrevProg;
    var restart: any = (window as any).restart;
    var optionsList: any = (window as any).optionsList;
    var exitPortal: any = (window as any).exitPortal;
    var infoList: any = (window as any).infoList;
    var noProvParam: any = (window as any).noProvParam;
    var popBuckets: any = (window as any).popBuckets;
    var popEpg: any = (window as any).popEpg;

    var sHideMenus: string[] = (window as any).sHideMenus || [];
    var popupActions: any[] = (window as any).popupActions || [];
    var popupArray: string[] = (window as any).popupArray || [];
    var popupDetail: any[] = (window as any).popupDetail || [];

    popupActions.forEach(function (action: any, t: number) {
        if (!action) return;
        if (sHideMenus.indexOf(popupActions[t].name) !== -1) return;
        var r = popupArray[t] ? popupArray[t] : "";

        try {
            switch (action) {
                case toggleAudioTrack:
                    if (
                        !c ||
                        typeof (window as any).stbAudioTracksExists !==
                            "function" ||
                        !(window as any).stbAudioTracksExists()
                    )
                        return;
                    break;
                case toggleSubtitle:
                    if (
                        !c ||
                        typeof (window as any).stbSubtitleExists !==
                            "function" ||
                        !(window as any).stbSubtitleExists()
                    )
                        return;
                    break;
                case popPause:
                    r = splitSlash(
                        r,
                        !(window as any).stbIsPlaying
                            ? false
                            : (window as any).stbIsPlaying()
                    );
                case popShift:
                case popRecords:
                    if (playType < 0 || !c || !chanels[c] || chanels[c].rec)
                        break;
                    return;
                case popTogglePip:
                    r = splitSlash(r, (window as any).pipIndex != null);
                    break;
                case popStopPip:
                    if ((window as any).pipIndex == null) return;
                    break;
                case popStop:
                    r = splitSlash(r, playType >= 0);
                    break;
                case popMedia:
                    if (typeof (window as any).getMediaArray !== "function")
                        return;
                    break;
                case popPrevProg:
                    if (playType >= 0) return;
                    break;
            }
        } catch (e) {
            console.error(e);
        }

        var s = popupDetail[t] || r;
        u++;
        if (i == t || i == action) selIndex = u;

        // Добавляем кнопки (номерные)
        var n = "";
        if (!sNoNumbersKeys) {
            switch (action) {
                case toggleAudioTrack:
                    n = "1";
                    break;
                case infoList:
                    n = "2";
                    break;
                case popPrevProg:
                    n = "3";
                    break;
                case popShift:
                    n = "4";
                    break;
                case popTogglePip:
                    n = "5";
                    break;
                case popStopPip:
                    n = "6";
                    break;
                case popStop:
                    n = "7";
                    break;
                case restart:
                    n = "8";
                    break;
                case optionsList:
                    n = "9";
                    break;
                case exitPortal:
                    n = "0";
                    break;
            }
            if (n) r = '<div class="btn">' + n + "</div> " + r;
        }

        // Добавляем цветные кнопки
        if (!sNoColorKeys) {
            n = "";
            switch (action) {
                case popBuckets:
                    n = "blue";
                    break;
                case popEpg:
                    n = "red";
                    break;
                case popRecords:
                    n = "green";
                    break;
                case popMedia:
                    n = "yellow";
                    break;
            }
            if (n) r = '<div class="btn ' + n + '">&nbsp;</div> ' + r;
        }

        // Подписи кнопок
        n = "";
        switch (action) {
            case infoList:
                n = strInfo || "Info";
                break;
            case popPrevProg:
                n = strPRECH || "Prev";
                break;
            case popTogglePip:
                n = strPip || "PiP";
                break;
            case toggleAudioTrack:
                n = strAudio || "Audio";
                break;
            case toggleSubtitle:
                n = strSubt || "Subt";
                break;
            case (window as any).toggleZoom:
                n = strZoom || "Zoom";
                break;
            case (window as any).toggleAspectRatio:
                n = strAspect || "Aspect";
                break;
            case optionsList:
                n = strTools || "Tools";
                break;
            case popPause:
                n = strPlayPause || "Play";
                break;
            case popStop:
                n = strSTOP || "Stop";
                break;
        }
        if (n) r = '<div class="btn">' + n + "</div> " + r;

        // Пуш в массив как ОБЪЕКТ (не строку!)
        listArray.push({ action: action, desc: s, name: r });
        listDataArray.push(r); // для совместимости с showPage

        if (action == noProvParam) a = listArray.length - 1;
        if (action == optionsList) o = listArray.length;
    });

    getListItemFn = function (item: any, _idx: number) {
        // item может быть строкой (listDataArray) или объектом (listArray)
        return "&nbsp;&nbsp;" + (item.name || item);
    };

    detailListActionFn = function () {
        var item = listArray[selIndex];
        if (item && listDetailElement) {
            listDetailElement.innerHTML = item.desc || "";
        }
        if (item && item.action == noProvParam) {
            (window as any).nprovparams = 0;
        }
    };

    listKeyHandlerFn = function (key: any): boolean {
        console.log(
            "DBG popupList handler: key=" +
                key +
                " selIndex=" +
                selIndex +
                " listArray.len=" +
                listArray.length +
                " item=" +
                (listArray[selIndex] ? "exists" : "null")
        );
        switch (typeof key === "number" ? key : key.keyCode) {
            case keys.RETURN:
                closeList();
                return true;
            case keys.ENTER: {
                var item = listArray[selIndex];
                console.log(
                    "DBG popupList ENTER: item=" +
                        (item ? "exists" : "null") +
                        " item.action=" +
                        (item && item.action ? typeof item.action : "undefined")
                );
                if (item && item.action && typeof item.action === "function") {
                    console.log("DBG popupList ENTER: calling action");
                    item.action();
                    console.log("DBG popupList ENTER: action returned");
                }
                return true;
            }
            case keys.ZOOM:
                if (typeof (window as any).toggleZoom === "function")
                    (window as any).toggleZoom();
                return true;
            case keys.ASPECT:
                if (typeof (window as any).toggleAspectRatio === "function")
                    (window as any).toggleAspectRatio();
                return true;
            case keys.N0:
                if (typeof exitPortal === "function") exitPortal();
                return true;
            case keys.N1:
            case keys.AUDIO:
                if (typeof (window as any).toggleAudioTrack === "function")
                    (window as any).toggleAudioTrack();
                return true;
            case keys.N2:
                if (typeof (window as any).infoList === "function")
                    (window as any).infoList();
                return true;
            case keys.N3:
                if (typeof (window as any).popPrevProg === "function")
                    (window as any).popPrevProg();
                return true;
            case keys.N4:
                if (typeof (window as any).popShift === "function")
                    (window as any).popShift();
                return true;
            case keys.N5:
                if (typeof (window as any).popTogglePip === "function")
                    (window as any).popTogglePip();
                return true;
            case keys.N6:
                if (typeof (window as any).popStopPip === "function")
                    (window as any).popStopPip();
                return true;
            case keys.N7:
                if (typeof (window as any).popStop === "function")
                    (window as any).popStop();
                return true;
            case keys.N8:
                if (typeof restart === "function") restart();
                return true;
            case keys.N9:
            case keys.TOOLS:
                if (typeof optionsList === "function") optionsList();
                return true;
            case keys.SUBTITLE:
                if (typeof (window as any).toggleSubtitle === "function")
                    (window as any).toggleSubtitle();
                return true;
            case keys.EPG:
            case keys.RED:
                if (typeof (window as any).epgList === "function")
                    (window as any).epgList(
                        (window as any).catIndex,
                        (window as any).primaryIndex,
                        false
                    );
                return true;
            case keys.GREEN:
                if (typeof (window as any).recordsList === "function")
                    (window as any).recordsList(
                        (window as any).catIndex,
                        (window as any).primaryIndex,
                        false
                    );
                return true;
            case keys.BLUE:
            case keys.PREV:
                if (typeof (window as any).bucketsList === "function")
                    (window as any).bucketsList((window as any).catIndex);
                return true;
        }
        return false;
    };

    if (listCaptionElement) listCaptionElement.innerHTML = _("Menu");
    if (listPodvalElement)
        listPodvalElement.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");

    // Явно показываем list_window перед showPage
    $("#list_window").show();
    if (typeof (window as any).stbSetWindow === "function")
        (window as any).stbSetWindow();
    showPage();
}

/* ---------------------------------------------------------------------------
 * Pop* shortcuts
 * --------------------------------------------------------------------------- */

/**
 * Shortcut: delegate to `window.bucketsList(catIndex)`.
 *
 * @returns void
 * @sideeffect Calls `window.bucketsList` with the current category index.
 */
export function popBuckets(): void {
    if (typeof (window as any).bucketsList === "function")
        (window as any).bucketsList((window as any).catIndex);
}

/**
 * Shortcut: delegate to `window.epgList(catIndex, primaryIndex, false)`.
 *
 * @returns void
 * @sideeffect Calls `window.epgList` with current category and primary indices.
 */
export function popEpg(): void {
    if (typeof (window as any).epgList === "function")
        (window as any).epgList(
            (window as any).catIndex,
            (window as any).primaryIndex,
            false
        );
}

/**
 * Shortcut: delegate to `window.recordsList(catIndex, primaryIndex, false)`.
 *
 * @returns void
 * @sideeffect Calls `window.recordsList` with current category and primary indices.
 */
export function popRecords(): void {
    if (typeof (window as any).recordsList === "function")
        (window as any).recordsList(
            (window as any).catIndex,
            (window as any).primaryIndex,
            false
        );
}

/**
 * Shortcut: delegate to `window.mediaList(null)` if both `getMediaArray` and `mediaList` are available.
 *
 * @returns void
 * @sideeffect Calls `window.mediaList(null)`.
 */
export function popMedia(): void {
    if (
        typeof (window as any).getMediaArray === "function" &&
        typeof (window as any).mediaList === "function"
    )
        (window as any).mediaList(null);
}

/**
 * Shortcut: close the list and show the previous-programs selector.
 *
 * @returns void
 * @sideeffect Calls `closeList()` then `window.prevProg()`.
 */
export function popPrevProg(): void {
    closeList();
    if (typeof (window as any).prevProg === "function")
        (window as any).prevProg();
}

/**
 * Shortcut: close the list and open the timeshift/archive selector at offset 0.
 *
 * @returns void
 * @sideeffect Calls `closeList()` then `window.shiftArchiveSelect(0)`.
 */
export function popShift(): void {
    closeList();
    if (typeof (window as any).shiftArchiveSelect === "function")
        (window as any).shiftArchiveSelect(0);
}

/**
 * Shortcut: close the list and dispatch N0 key (play/pause toggle).
 *
 * @returns void
 * @sideeffect Calls `closeList()` then `window._doKey(keys.N0)`.
 */
export function popPause(): void {
    closeList();
    if (typeof (window as any)._doKey === "function")
        (window as any)._doKey((window as any).keys.N0);
}

/**
 * Shortcut: close the list and dispatch STOP key.
 *
 * @returns void
 * @sideeffect Calls `closeList()` then `window._doKey(keys.STOP)`.
 */
export function popStop(): void {
    closeList();
    if (typeof (window as any)._doKey === "function")
        (window as any)._doKey((window as any).keys.STOP);
}

/**
 * Shortcut: close the list and toggle PiP.
 *
 * @returns void
 * @sideeffect Calls `closeList()` then the local `togglePip()` function.
 */
export function popTogglePip(): void {
    closeList();
    if (typeof togglePip === "function") togglePip();
}

/**
 * Shortcut: stop PiP (clear pipIndex, call stbStopPip) and close the list.
 *
 * @returns void
 * @sideeffect Sets `window.pipIndex = null`. Calls `window.stbStopPip()`. Calls `closeList()`.
 */
export function popStopPip(): void {
    (window as any).pipIndex = null;
    if (typeof (window as any).stbStopPip === "function")
        (window as any).stbStopPip();
    closeList();
}

/* ---------------------------------------------------------------------------
 * Volume / mute / pip
 * --------------------------------------------------------------------------- */

/**
 * Toggle mute on the STB and show/hide the mute overlay.
 *
 * @returns void — early return if `stbToggleMute` is not a function.
 * @sideeffect Calls `window.stbToggleMute()` and toggles `#mute` visibility.
 */
export function toggleMute(): void {
    if (typeof (window as any).stbToggleMute !== "function") return;
    (window as any).stbToggleMute();
    $("#mute").toggle();
}

/**
 * Change the volume by a relative delta, clamped to [0, 100].
 *
 * @param delta - Signed integer to add to the current volume.
 * @returns void — early return if `stbGetVolume` is not a function.
 * @sideeffect Calls `window.stbGetVolume()`, `window.stbSetVolume()`, and `_showVolume()`.
 */
export function changeVolume(delta: number): void {
    if (typeof (window as any).stbGetVolume !== "function") return;
    var t = (window as any).stbGetVolume() + delta;
    t = Math.max(t, 0);
    t = Math.min(t, 100);
    if (typeof (window as any).stbSetVolume === "function")
        (window as any).stbSetVolume(t);
    _showVolume(t);
}

/**
 * Show the volume indicator overlay with the given level and auto-hide after 2 seconds.
 *
 * @param v - Volume level (0-100).
 * @returns void
 * @sideeffect Sets `#volume` height percentage. Shows `#volume_div`. Hides `#mute`. Sets a 2s timeout to hide.
 */
function _showVolume(v: number): void {
    $("#volume").css("height", 100 - v + "%");
    $("#volume_div").show();
    $("#mute").hide();
    clearTimeout(volumeTimeout);
    volumeTimeout = setTimeout(function () {
        $("#volume_div").hide();
    }, 2000);
}

/**
 * Toggle Picture-in-Picture mode. If no PiP is active, starts PiP with the current channel.
 * If PiP is active and the channel changed, swaps the main and PiP channels.
 * If PiP is active on the same channel, does nothing.
 *
 * @returns void
 * @sideeffect Sets `window.pipIndex` and `window.pipCatIndex`. Calls `window.stbPlayPip()` with the channel URL.
 * @analysis When PiP is active and the user switches to a different channel, the current main channel becomes PiP
 *             and the old PiP channel becomes main.
 */
export function togglePip(): void {
    if ((window as any).pipIndex == null) {
        (window as any).pipIndex = (window as any).primaryIndex;
        (window as any).pipCatIndex = (window as any).catIndex;
        if (typeof (window as any).stbPlayPip === "function")
            (window as any).stbPlayPip(
                (window as any).getChannelUrl(
                    (window as any).curList[(window as any).pipIndex]
                )
            );
    } else {
        if (
            (window as any).pipCatIndex === (window as any).catIndex &&
            (window as any).pipIndex === (window as any).primaryIndex
        )
            return;
        var e = (window as any).pipIndex;
        (window as any).pipIndex = (window as any).primaryIndex;
        (window as any).pipCatIndex = (window as any).catIndex;
        if (typeof (window as any).stbPlayPip === "function")
            (window as any).stbPlayPip(
                (window as any).getChannelUrl((window as any).curList[e])
            );
    }
}

/* ---------------------------------------------------------------------------
 * Color dialogs
 * --------------------------------------------------------------------------- */

/**
 * Convert HSV color values to RGB.
 *
 * @param h - Hue (0-360).
 * @param s - Saturation (0-100).
 * @param v - Value / brightness (0-100).
 * @returns number[] — Array of [R, G, B] each in range 0-255.
 * @analysis All inputs are clamped to their valid range before conversion.
 */
export function hsvToRgb(h: number, s: number, v: number): number[] {
    h = Math.max(0, Math.min(360, h));
    s = Math.max(0, Math.min(100, s));
    v = Math.max(0, Math.min(100, v));
    s /= 100;
    v /= 100;
    if (s === 0) {
        var g = Math.round(v * 255);
        return [g, g, g];
    }
    h /= 60;
    var a = Math.floor(h);
    var o = h - a;
    var l = v * (1 - s);
    var c = v * (1 - s * o);
    var u = v * (1 - s * (1 - o));
    var r: number, g2: number, b: number;
    switch (a) {
        case 0:
            r = v;
            g2 = u;
            b = l;
            break;
        case 1:
            r = c;
            g2 = v;
            b = l;
            break;
        case 2:
            r = l;
            g2 = v;
            b = u;
            break;
        case 3:
            r = l;
            g2 = c;
            b = v;
            break;
        case 4:
            r = u;
            g2 = l;
            b = v;
            break;
        default:
            r = v;
            g2 = l;
            b = c;
            break;
    }
    return [Math.round(r * 255), Math.round(g2 * 255), Math.round(b * 255)];
}

/**
 * Open the foreground color picker dialog (HSV selector).
 * The user adjusts hue (LEFT/RIGHT) and saturation (UP/DOWN) with presets via color keys.
 * The selected color is stored in `window.eSHLcolor` as "hue,saturation".
 *
 * @returns void
 * @sideeffect Calls `saveCPD()`. Modifies list caption/podval/detail. Shows `#listAbout` with color controls.
 *             Registers `aboutKeyHandler` for color adjustment keys.
 * @analysis The live preview updates the `#step` span's CSS color. YELLOW/GREEN/BLUE keys set predefined hues.
 *             ENTER saves and closes; RETURN closes without saving (fall-through in switch).
 */
export function colorDialog(): void {
    var s = 50,
        n = 85;
    s = Number.parseInt(((window as any).eSHLcolor || "50,85").split(",")[0]);
    n = Number.parseInt(((window as any).eSHLcolor || "50,85").split(",")[1]);
    saveCPD();
    if (listCaptionElement) listCaptionElement.innerHTML = _("Color spectrum");
    if (listPodvalElement)
        listPodvalElement.innerHTML =
            btnDiv(keys.RETURN, strRETURN, "Close") +
            btnDiv(keys.ENTER, strENTER, "Set");
    if (listDetailElement) listDetailElement.innerHTML = "";
    $("#listAbout")
        .html(
            '<div style="font-size:larger;">' +
                _("Color") +
                ':<br/><br/>&nbsp;<span id="step" style="font-size: 150%;">&nbsp;1234567890&nbsp;<span style="background-color:' +
                (window as any).curColorB +
                '">&nbsp;1234567890&nbsp;</span></span>&nbsp;<br/>' +
                '<br><div class="btn" onclick="_doKey(keys.LEFT);">' +
                strLEFT +
                '</div>&nbsp;<div class="btn" onclick="_doKey(keys.RIGHT);">' +
                strRIGHT +
                "</div>&nbsp;" +
                _("Color") +
                '<br><div class="btn" onclick="_doKey(keys.UP);">' +
                strUP +
                '</div>&nbsp;<div class="btn" onclick="_doKey(keys.DOWN);">' +
                strDOWN +
                "</div>&nbsp;" +
                _("Saturation") +
                "<br>" +
                btnDiv(keys.YELLOW, "", "Yellow") +
                "<br>" +
                btnDiv(keys.GREEN, "", "Green") +
                "<br>" +
                btnDiv(keys.BLUE, "", "Blue") +
                "</div>"
        )
        .show();
    aboutKeyHandler = function (e: number): boolean {
        switch (e) {
            case keys.UP:
                n = Math.min(n + 5, 100);
                break;
            case keys.DOWN:
                n = Math.max(n - 5, 0);
                break;
            case keys.RIGHT:
                s += 10;
                if (s > 360) s = 0;
                break;
            case keys.LEFT:
                s -= 10;
                if (s < 0) s = 360;
                break;
            case keys.YELLOW:
                s = 50;
                n = 85;
                break;
            case keys.GREEN:
                s = 90;
                n = 85;
                break;
            case keys.BLUE:
                s = 180;
                n = 85;
                break;
            case keys.ENTER:
                (window as any).eSHLcolor = s + "," + n;
            case keys.RETURN:
                $("#listAbout").text("").hide();
                restoreCPD();
                return true;
            default:
                return false;
        }
        var rgb = hsvToRgb(s, n, 100);
        $("#step").css(
            "color",
            "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")"
        );
        return true;
    };
    var rgb0 = hsvToRgb(s, n, 100);
    $("#step").css(
        "color",
        "rgb(" + rgb0[0] + "," + rgb0[1] + "," + rgb0[2] + ")"
    );
}

/**
 * Open the selection/background text color picker (HSV with fixed value=50).
 * Hue (LEFT/RIGHT) and saturation (UP/DOWN) are adjustable. The selected color is stored
 * in `window.eSHLcolSel`.
 *
 * @returns void
 * @sideeffect Calls `saveCPD()`. Modifies list caption/podval. Shows `#listAbout` with preview.
 *             Registers `aboutKeyHandler`. Updates `#step` background-color in real time.
 * @analysis Unlike `colorDialog`, this one modifies background-color (not color) and uses V=50.
 */
export function selColorDialog(): void {
    var s = Number.parseInt(
        ((window as any).eSHLcolSel || "50,85").split(",")[0]
    );
    var n = Number.parseInt(
        ((window as any).eSHLcolSel || "50,85").split(",")[1]
    );
    saveCPD();
    if (listCaptionElement) listCaptionElement.innerHTML = _("Select color");
    if (listPodvalElement)
        listPodvalElement.innerHTML =
            btnDiv(keys.RETURN, strRETURN, "Close") +
            btnDiv(keys.ENTER, strENTER, "Set");
    if (listDetailElement) listDetailElement.innerHTML = "";
    $("#listAbout")
        .html(
            '<div style="font-size:larger;">' +
                _("Color") +
                ':<br/><br/>&nbsp;<span id="step" style="font-size: 150%;background-color:' +
                (window as any).curColorB +
                '">&nbsp;1234567890&nbsp;</span>&nbsp;</div>'
        )
        .show();
    aboutKeyHandler = function (e: number): boolean {
        switch (e) {
            case keys.UP:
                n = Math.min(n + 5, 100);
                break;
            case keys.DOWN:
                n = Math.max(n - 5, 0);
                break;
            case keys.RIGHT:
                s += 10;
                if (s > 360) s = 0;
                break;
            case keys.LEFT:
                s -= 10;
                if (s < 0) s = 360;
                break;
            case keys.YELLOW:
                s = 50;
                n = 85;
                break;
            case keys.GREEN:
                s = 90;
                n = 85;
                break;
            case keys.BLUE:
                s = 180;
                n = 85;
                break;
            case keys.ENTER:
                (window as any).eSHLcolSel = s + "," + n;
            case keys.RETURN:
                $("#listAbout").text("").hide();
                restoreCPD();
                return true;
            default:
                return false;
        }
        var rgb = hsvToRgb(s, n, 50);
        $("#step").css(
            "background-color",
            "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")"
        );
        return true;
    };
    var rgb0 = hsvToRgb(s, n, 50);
    $("#step").css(
        "background-color",
        "rgb(" + rgb0[0] + "," + rgb0[1] + "," + rgb0[2] + ")"
    );
}

/**
 * Open the background color picker dialog. Same interface as `colorDialog` but stores
 * the result in `window.eSHLcolorB` and applies it as background-color.
 *
 * @returns void
 * @sideeffect Calls `saveCPD()`. Modifies list caption/podval. Shows `#listAbout`.
 *             Registers `aboutKeyHandler`. Updates `#step` background-color preview.
 */
export function backColorDialog(): void {
    var s = Number.parseInt(
        ((window as any).eSHLcolorB || "255,0").split(",")[0]
    );
    var n = Number.parseInt(
        ((window as any).eSHLcolorB || "255,0").split(",")[1]
    );
    saveCPD();
    if (listCaptionElement)
        listCaptionElement.innerHTML = _("Background color");
    if (listPodvalElement)
        listPodvalElement.innerHTML =
            btnDiv(keys.RETURN, strRETURN, "Close") +
            btnDiv(keys.ENTER, strENTER, "Set");
    if (listDetailElement) listDetailElement.innerHTML = "";
    $("#listAbout")
        .html(
            '<div style="font-size:larger;">' +
                _("Color") +
                ':<br/><br/>&nbsp;<span id="step" style="font-size: 150%;background-color:' +
                (window as any).curColorB +
                '">&nbsp;1234567890&nbsp;</span>&nbsp;</div>'
        )
        .show();
    aboutKeyHandler = function (e: number): boolean {
        switch (e) {
            case keys.UP:
                n = Math.min(n + 5, 100);
                break;
            case keys.DOWN:
                n = Math.max(n - 5, 0);
                break;
            case keys.RIGHT:
                s += 10;
                if (s > 360) s = 0;
                break;
            case keys.LEFT:
                s -= 10;
                if (s < 0) s = 360;
                break;
            case keys.YELLOW:
                s = 50;
                n = 85;
                break;
            case keys.GREEN:
                s = 90;
                n = 85;
                break;
            case keys.BLUE:
                s = 180;
                n = 85;
                break;
            case keys.ENTER:
                (window as any).eSHLcolorB = s + "," + n;
            case keys.RETURN:
                $("#listAbout").text("").hide();
                restoreCPD();
                return true;
            default:
                return false;
        }
        var rgb = hsvToRgb(s, n, 100);
        $("#step").css(
            "background-color",
            "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")"
        );
        return true;
    };
    var rgb0 = hsvToRgb(s, n, 100);
    $("#step").css(
        "background-color",
        "rgb(" + rgb0[0] + "," + rgb0[1] + "," + rgb0[2] + ")"
    );
}

/* ---------------------------------------------------------------------------
 * Joystick menu
 * --------------------------------------------------------------------------- */

/**
 * Show the joystick/remote-control overlay — a visual grid of directional buttons
 * with mapped actions (rewind, menu, pause, live, close, etc.).
 *
 * @returns void
 * @sideeffect Shows `#dialogbox` with button grid. Registers a one-shot `dialogBoxKeyHandler`.
 * @analysis Arrow keys are mapped to common actions (UP = archive select, DOWN = stop/live, etc.).
 *             RETURN dismisses the overlay without action.
 */
export function joyMenu(): void {
    var btn = '<td align="center" valign="top" width="30%">';
    $("#dialogbox")
        .html(
            '<table style="font-size:inherit">' +
                "<tr><td></td>" +
                btn +
                btnDiv(keys.UP, strUP, "<br>Rewind<br>") +
                "</td><td></td></tr>" +
                "<tr>" +
                btn +
                btnDiv(keys.LEFT, strLEFT, "<br>Menu") +
                "</td>" +
                btn +
                btnDiv(keys.ENTER, strENTER, "<br>Pause<br>") +
                "</td>" +
                btn +
                btnDiv(keys.RIGHT, strRIGHT, "<br>Toggle<br>sound track") +
                "</td></tr>" +
                "<tr><td></td>" +
                btn +
                btnDiv(
                    keys.DOWN,
                    strDOWN,
                    (window as any).playType
                        ? "<br>Live"
                        : "<br>Previous<br>channel"
                ) +
                "</td><td></td></tr>" +
                "</table>" +
                btnDiv(keys.RETURN, strRETURN, "Close")
        )
        .show();
    dialogBoxKeyHandler = function (e: number): void {
        $("#dialogbox").hide();
        switch (e) {
            case keys.ENTER:
                if (typeof (window as any)._doKey === "function")
                    (window as any)._doKey((window as any).keys.PLAY);
                return;
            case keys.UP:
                if (typeof (window as any).shiftArchiveSelect === "function")
                    (window as any).shiftArchiveSelect(0);
                return;
            case keys.DOWN:
                (window as any).playType
                    ? typeof (window as any)._doKey === "function" &&
                      (window as any)._doKey((window as any).keys.STOP)
                    : typeof (window as any).prevProg === "function" &&
                      (window as any).prevProg();
                return;
            case keys.RIGHT:
                if (typeof (window as any).toggleAudioTrack === "function")
                    (window as any).toggleAudioTrack();
                return;
            case keys.LEFT:
                if (typeof popupList === "function") popupList();
                return;
            case keys.RETURN:
                return;
        }
    };
}

/* ---------------------------------------------------------------------------
 * Edit key dialog
 * --------------------------------------------------------------------------- */

/**
 * Set the keyboard case (upper/lower). Updates `_keyUp` flag, transforms `_keys`, and updates the
 * shift-key symbol. Also adds a red underline indicator if color keys are enabled.
 *
 * @param e - true for uppercase, false for lowercase.
 * @returns void — early return if punctuation mode is active (`_keyP`).
 * @sideeffect Modifies `_keys`, `_keyUp`, `_keysSymbol[0].s`.
 */
function _setCase(e: boolean): void {
    if (_keyP) return;
    _keyUp = e;
    _keys = _keyUp ? _keys.toUpperCase() : _keys.toLowerCase();
    _keysSymbol[0].s = _keyUp ? "&darr;a" : "&uarr;A";
    if (!(window as any).sNoColorKeys)
        _keysSymbol[0].s =
            '<span style="border-bottom:3px solid red;">' +
            _keysSymbol[0].s +
            "</span>";
}

/**
 * Set the keyboard language/layout. Builds the `_keys` string from the current alphabet,
 * digits, and control symbols.
 *
 * @param e - true for English layout (default `_keysL`), false for localized layout.
 * @returns void
 * @sideeffect Modifies `_keys`, `_keyCur`, `_keyE`, `_keysSymbol[2].s`.
 * @analysis The layout is calculated to fit into 10-column rows. If the alphabet is short, punctuation is appended.
 */
function _setLang(e: boolean): void {
    var t: string = (window as any)._("alhabet") || _keysL;
    _keyE = e;
    var r = e ? _keysL : t;
    var s = Math.floor(r.length / 10);
    if (r.length % 10) r = (r + _keysP).substr(0, (s + 1) * 10);
    _keys = _keys1 + r + _keysA;
    _keysSymbol[2].s = "!,?";
    _setCase(_keyUp);
    _keyCur = _keys.length - 9;
}

/**
 * Toggle punctuation/symbol keyboard mode.
 *
 * @param _p - true to show punctuation layout, false to revert to letter layout.
 * @returns void
 * @sideeffect Modifies `_keys`, `_keyCur`, `_keyP`, `_keysSymbol[0].s`, `_keysSymbol[2].s`.
 * @analysis When entering punctuation mode, the shift and lang indicators are cleared. Exiting re-calls `_setLang`.
 */
function _setPunct(_p: boolean): void {
    _keyP = _p;
    if (_p) {
        _keys = _keys1 + _keysP + _keysA;
        _keysSymbol[0].s = "";
        _keysSymbol[2].s = "abc";
    } else {
        _setLang(_keyE);
    }
    _keyCur = _keys.length - 8;
}

/** Global alias – defaults to showEditKey1, providers can swap it */
var showEditKey: any = showEditKey1;

/**
 * Initialize and show the graphical on-screen keyboard (edit mode variant 1).
 * Sets up key symbols, color indicators, cursor position, and keyboard mode.
 *
 * @param _initKeys - Ignored (accepts any value for API compatibility with `showEdit`).
 * @returns void
 * @sideeffect Calls `saveCPD()`. Modifies `_keysSymbol` entries. Sets `editPos`, `_keyCur`. Calls `_setPunct` and `showEdit`.
 * @analysis Checks `window.stbGetItem('ottplaylang') === '_eng'` to determine initial language.
 *             Color-key underlines are added to shift/lang/backspace/ok symbols if color keys are enabled.
 */
export function showEditKey1(_initKeys: any): void {
    saveCPD();
    if (
        typeof (window as any).stbGetItem === "function" &&
        (window as any).stbGetItem("ottplaylang") === "_eng"
    )
        _keyE = true;
    _keysSymbol[1].s =
        typeof (window as any).stbGetItem === "function" &&
        (window as any).stbGetItem("ottplaylang") === "_eng"
            ? ""
            : '<span style="font-family:fontello;padding:0.2em;">&#xe80E;</span>';
    _keysSymbol[7].s =
        '<span style="font-family:fontello;padding:0.2em;">&#xe804;</span>';
    _keysSymbol[9].s = "Ok";
    if (!(window as any).sNoColorKeys) {
        if (_keysSymbol[1].s)
            _keysSymbol[1].s =
                '<span style="border-bottom:3px solid green;">' +
                _keysSymbol[1].s +
                "</span>";
        if (_keysSymbol[7].s)
            _keysSymbol[7].s =
                '<span style="border-bottom:3px solid #bb0;">' +
                _keysSymbol[7].s +
                "</span>";
        if (_keysSymbol[9].s)
            _keysSymbol[9].s =
                '<span style="border-bottom:3px solid blue;">' +
                _keysSymbol[9].s +
                "</span>";
    }
    editPos = (window as any).editvar.length;
    if (_keyCur > _keys.length - 10) _keyCur = 14;
    var r = _keyCur;
    _setPunct(_keyP);
    _keyCur = r;
    showEdit();
}

/**
 * Render the on-screen keyboard (`#listEdit`) with all key cells, the current edit value,
 * and the cursor. Highlights the currently focused key.
 *
 * @returns void
 * @sideeffect Sets `#listEdit` innerHTML. Calls `_changeEdit()` to update the edit preview.
 *             Sets podval buttons for close/case/lang/delete/ok.
 * @analysis Keys are laid out in rows of 10. Each key cell has an `onclick` that calls `clickKey(s)`.
 *             Symbol keys (indices 0-9) use their custom render function; others show the raw character.
 */
export function showEdit(): void {
    var e = $("#listEdit");
    var t = (e.width() || 600) / 12;
    var r = ((window as any).editCaption || "") + ":<br/><br/>";
    r +=
        '<div id="ee" style="width:100%;white-space:pre-wrap;word-wrap:break-word;"></div>';
    for (var s = 0; s < _keys.length; s++) {
        if (s % 10 === 0) r += "<br/>";
        var sym = _keysSymbol[_keys.charCodeAt(s)];
        var n = sym ? sym.s : _keys[s];
        r +=
            '<div id="ik' +
            s +
            '" onclick="clickKey(' +
            s +
            ');" style="display:inline-block;width:' +
            t +
            "px;height:" +
            t +
            "px;text-align:center;vertical-align:middle;line-height:" +
            t +
            'px;">' +
            n +
            "</div>";
    }
    e.html(r).show();
    _changeEdit();
    $("#ik" + _keyCur).css({
        "background-color": (window as any).curColorB,
        color: (window as any).curColor,
    });
    if (listPodvalElement)
        listPodvalElement.innerHTML =
            btnDiv(keys.RETURN, strRETURN, "Close") +
            btnDiv(
                keys.RED,
                "",
                _keysSymbol[0] ? (_keyUp ? "&darr;a" : "&uarr;A") : "",
                strTools
            ) +
            btnDiv(
                keys.GREEN,
                "",
                _keysSymbol[1] ? (_keyE ? _("lang") : "English") : "",
                strFF
            ) +
            btnDiv(keys.YELLOW, "", "Delete", strRW) +
            btnDiv(keys.BLUE, "", "Ok", strPlayPause);
}

/**
 * Update the edit text preview in the `#ee` element, placing a blinking cursor div at the current position.
 *
 * @returns void
 * @sideeffect Sets `#ee` innerHTML with text before cursor + cursor div + text after cursor.
 *             Clears and restarts the cursor blink interval (500ms toggle).
 */
export function _changeEdit(): void {
    $("#ee").html(
        (window as any).editvar.substr(0, editPos) +
            '<div id="cursor" style="display:inline-block;vertical-align:top;background-color:' +
            (window as any).curColor +
            ';width:3px;height:1.2em;"></div>' +
            (window as any).editvar.substr(editPos)
    );
    clearInterval(cursorInterval);
    var blink = true;
    var cursor = $("#cursor");
    cursorInterval = setInterval(function () {
        blink = !blink;
        cursor.css(
            "background-color",
            blink ? (window as any).curColor : "inherit"
        );
    }, 500);
}

/**
 * Handle a click on an on-screen keyboard key. Highlights the clicked key and
 * delegates to `editKey1` with ENTER to type it.
 *
 * @param e - The key index in the `_keys` string.
 * @returns void
 * @sideeffect Stops event propagation. Updates key highlight styles. Calls `editKey1(keys.ENTER)`.
 */
export function clickKey(e: number): void {
    if (
        typeof (window as any).event !== "undefined" &&
        (window as any).event &&
        (window as any).event.stopPropagation
    )
        (window as any).event.stopPropagation();
    $("#ik" + _keyCur).css({ "background-color": "", color: "" });
    _keyCur = e;
    $("#ik" + _keyCur).css({
        "background-color": (window as any).curColorB,
        color: (window as any).curColor,
    });
    editKey1((window as any).keys.ENTER);
}

/**
 * Handle a key press on the on-screen keyboard. Manages cursor movement, character insertion,
 * and special key actions (case, lang, punctuation, backspace, ok).
 *
 * @param e - The numeric key code from the remote/keyboard.
 * @returns void
 * @sideeffect Modifies `(window as any).editvar` and `editPos`. Updates key highlight styles. Calls `_changeEdit()`.
 *             Special keys: UP/DOWN/LEFT/RIGHT move keyboard focus. RED=case, GREEN=lang, YELLOW=delete,
 *             BLUE/PLAY=ok. ENTER types the focused character or invokes the symbol action.
 *             RETURN/EXIT closes the editor and calls `restoreCPD()`.
 * @analysis If the pressed key maps to a character in `_keys`, the behavior depends on whether that index
 *             is the currently focused key: if same, type it; if different, move focus and type.
 *             Symbol keys (charCode <= 9) invoke their action function instead of typing.
 */
export function editKey1(e: number): void {
    // Physical keyboard: if keyCode maps to a char in _keys, type it directly
    var ch = String.fromCharCode(e);
    if (ch && _keys.indexOf(ch) !== -1) {
        var idx = _keys.indexOf(ch);
        if (idx === _keyCur) {
            // already on this key — type it
            if (_keys.charCodeAt(idx) > 9) {
                (window as any).editvar =
                    (window as any).editvar.substr(0, editPos) +
                    _keys[idx] +
                    (window as any).editvar.substr(editPos);
                editPos++;
                _changeEdit();
            } else {
                if (
                    _keysSymbol[_keys.charCodeAt(idx)] &&
                    typeof _keysSymbol[_keys.charCodeAt(idx)].a === "function"
                )
                    _keysSymbol[_keys.charCodeAt(idx)].a();
            }
        } else {
            // move cursor to the key and type
            $("#ik" + _keyCur).css({ "background-color": "", color: "" });
            _keyCur = idx;
            $("#ik" + _keyCur).css({
                "background-color": (window as any).curColorB,
                color: (window as any).curColor,
            });
            (window as any).editvar =
                (window as any).editvar.substr(0, editPos) +
                _keys[_keyCur] +
                (window as any).editvar.substr(editPos);
            editPos++;
            _changeEdit();
        }
        return;
    }
    function mv(d: number) {
        $("#ik" + _keyCur).css({ "background-color": "", color: "" });
        _keyCur += d;
        $("#ik" + _keyCur).css({
            "background-color": (window as any).curColorB,
            color: (window as any).curColor,
        });
    }
    switch (e) {
        case (window as any).keys.UP:
            mv(_keyCur > 9 ? -10 : _keys.length - 10);
            return;
        case (window as any).keys.DOWN:
            mv(_keyCur < _keys.length - 10 ? 10 : -_keys.length + 10);
            return;
        case (window as any).keys.LEFT:
            mv(_keyCur % 10 > 0 ? -1 : 9);
            return;
        case (window as any).keys.RIGHT:
            mv(_keyCur % 10 < 9 ? 1 : -9);
            return;
        case (window as any).keys.TOOLS:
        case (window as any).keys.RED:
            if (_keysSymbol[0] && typeof _keysSymbol[0].a === "function")
                _keysSymbol[0].a();
            return;
        case (window as any).keys.FF:
        case (window as any).keys.GREEN:
            if (_keysSymbol[1] && typeof _keysSymbol[1].a === "function")
                _keysSymbol[1].a();
            return;
        case (window as any).keys.RW:
        case (window as any).keys.YELLOW:
            if (_keysSymbol[7] && typeof _keysSymbol[7].a === "function")
                _keysSymbol[7].a();
            return;
        case (window as any).keys.PLAY:
        case (window as any).keys.PAUSE:
        case (window as any).keys.BLUE:
            if (_keysSymbol[9] && typeof _keysSymbol[9].a === "function")
                _keysSymbol[9].a();
            return;
        case (window as any).keys.ENTER:
            if (_keys.charCodeAt(_keyCur) > 9) {
                (window as any).editvar =
                    (window as any).editvar.substr(0, editPos) +
                    _keys[_keyCur] +
                    (window as any).editvar.substr(editPos);
                editPos++;
                _changeEdit();
            } else {
                if (
                    _keysSymbol[_keys.charCodeAt(_keyCur)] &&
                    typeof _keysSymbol[_keys.charCodeAt(_keyCur)].a ===
                        "function"
                )
                    _keysSymbol[_keys.charCodeAt(_keyCur)].a();
            }
            return;
        case (window as any).keys.EXIT:
        case (window as any).keys.RETURN:
            clearInterval(cursorInterval);
            if (typeof (window as any).restoreCPD === "function")
                (window as any).restoreCPD();
            $("#listEdit").hide();
            return;
        default: {
            var idx = _keys.indexOf(String.fromCharCode(e));
            if (idx > -1) {
                mv(idx - _keyCur);
                editKey1((window as any).keys.ENTER);
            }
            return;
        }
    }
}

/**
 * Handle key events for the native HTML input editor (edit mode variant 2).
 * ENTER saves the value via `setEdit`, RETURN/EXIT discards and restores.
 *
 * @param code - The numeric key code.
 * @returns void
 * @sideeffect Reads `#(window as any).editvar` value on ENTER and calls `window.setEdit()`. On RETURN/EXIT, hides `#listEdit`
 *             and calls `window.restoreCPD()`.
 */
export function editKey2(code: number): void {
    switch (code) {
        case (window as any).keys.ENTER:
            (window as any).editvar = ($("#editvar").val() as string) || "";
            if (typeof (window as any).setEdit === "function")
                (window as any).setEdit();
            break;
        case (window as any).keys.EXIT:
        case (window as any).keys.RETURN:
            $("#listEdit").hide();
            if (typeof (window as any).restoreCPD === "function")
                (window as any).restoreCPD();
            break;
    }
}

/**
 * Show the native HTML `<input>` editor (edit mode variant 2) as an alternative to the
 * graphical on-screen keyboard.
 *
 * @param _initKeys - Optional array of initial key values (unused, for API compatibility).
 * @returns void
 * @sideeffect Calls `window.saveCPD()` if available. Renders `#listEdit` with an `<input>` field
 *             and save/discard buttons. Focuses the input field.
 */
export function showEditKey2(_initKeys?: number[]): void {
    if (typeof (window as any).saveCPD === "function")
        (window as any).saveCPD();
    var caption = (window as any).editCaption || "";
    var val = (window as any).editvar || "";
    var keys = (window as any).keys || {};
    var strExit = (window as any).strEXIT || "Esc";
    var strEnter = (window as any).strENTER || "ENTER";
    if ((window as any).listCaptionElement)
        (window as any).listCaptionElement.innerHTML = caption;
    var html = caption + ":<br/><br/>";
    html +=
        '<br/><input type="text" id="editvar" value="' +
        val.replace(/"/g, "&quot;") +
        '" style="background-color: black; color:' +
        ((window as any).curColor || "#fff") +
        '; font-size:150%; width: 95%;" autofocus><br/><br/>';
    html +=
        "<br/>" +
        (
            (window as any).btnDiv ||
            function () {
                return "";
            }
        )(keys.EXIT || 27, strExit, "- return without save");
    html +=
        "<br/>" +
        (
            (window as any).btnDiv ||
            function () {
                return "";
            }
        )(keys.ENTER || 13, strEnter, "- save");
    $("#listEdit").show().html(html);
    document.getElementById("editvar")?.focus();
}

/* ---------------------------------------------------------------------------
 * Media list
 * --------------------------------------------------------------------------- */

declare function showMediaList(): void;
declare function getMediaDescr(item: any): string;
declare function mediaKeyHandler(keyCode: number): boolean;

/**
 * Render the media library list from the already-loaded `window.mediaRecords`
 * (no provider refetch). Used by `mediaList()` for folder (submenu) navigation
 * and for the refresh path, where the records are in place and only the view
 * needs rebuilding. Mirrors the chrome of the fetching variant (`showMediaList`).
 *
 * @sideeffect Sets `window.listArray`, `window.getListItemFn`,
 *             `window.detailListActionFn`, `window.listKeyHandlerFn`; updates
 *             #listCaption / #listPodval; calls `window.showPage`.
 */
function showMediaList1(): void {
    var w = window as any;
    var data: any[] = w.mediaRecords || [];
    w.listArray = data;
    w.getListItemFn = function (item: any, _idx: number) {
        return "&nbsp;&nbsp;" + (item.name || item.title || "");
    };
    w.detailListActionFn = function () {
        var detailEl = document.getElementById("listDetail");
        if (detailEl)
            detailEl.innerHTML = getMediaDescr(w.listArray[w.selIndex]);
    };
    w.listKeyHandlerFn = mediaKeyHandler;

    var captionEl = document.getElementById("listCaption");
    if (captionEl) captionEl.innerHTML = w.mediaName || w._("Media Library");

    var podvalEl = document.getElementById("listPodval");
    if (podvalEl) {
        podvalEl.innerHTML =
            w.btnDiv(w.keys.RETURN, w.strRETURN, "Close") +
            w.btnDiv(w.keys.GREEN, "", "Favorites") +
            w.btnDiv(w.keys.YELLOW, "", "TMDb");
    }

    if (typeof w.showPage === "function") w.showPage();
}

/**
 * Navigate the media library hierarchy. Handles submenu entries, info/alert commands,
 * history/favorites lists, and fetching media arrays.
 *
 * @param e - The navigation target: null to refresh, a URL string to navigate into a folder,
 *            -1 for history, -2 for favorites, "submenu" for sub-level navigation.
 * @returns void
 * @sideeffect Modifies `window.mediaUrls`, `window.mediaNames`, `window.mediaSelects`,
 *             `window.mediaRecords`, `window.mediaRecordsPar`. Calls `showMediaList` or `showMediaList1`.
 * @analysis Tracks navigation state in parallel arrays (urls/names/selects) to support breadcrumb-style
 *             backwards navigation. "cmd:info" and "alert" commands show an infoBox instead of navigating.
 */
export function mediaList(e: any): void {
    var mediaUrls = (window as any).mediaUrls;
    var mediaNames = (window as any).mediaNames;
    var mediaSelects = (window as any).mediaSelects;
    var mediaRecords = (window as any).mediaRecords;
    var mediaRecordsPar = (window as any).mediaRecordsPar;
    var selIndex = (window as any).selIndex;
    var medHistory = (window as any).medHistory;
    var medFavorites = (window as any).medFavorites;
    if (mediaUrls && mediaUrls.length && e == mediaUrls[0]) {
        (window as any).mediaName = "Медиатека";
        (window as any).mediaUrls = [];
        (window as any).mediaNames = [];
        (window as any).mediaSelects = [mediaSelects.pop()];
    }
    if (e === null) {
        if (mediaUrls === null) {
            (window as any).mediaName = "Медиатека";
            e = "";
            (window as any).mediaUrls = [];
            (window as any).mediaNames = [];
            (window as any).mediaSelects = [0];
        } else {
            showMediaList1();
            return;
        }
    }
    if (typeof e === "string") {
        if (e === "submenu") {
            mediaSelects.shift();
            var t = mediaRecords[selIndex].submenu;
            if (t === undefined || t.length === 0) {
                infoBox("Error: Bad fXML Submenu!");
                return;
            }
            var r =
                mediaRecords[selIndex].title ||
                mediaRecords[selIndex].playlist_name ||
                undefined;
            mediaRecordsPar = mediaRecords;
            (window as any).mediaRecords = t;
            if (r) {
                t = mediaNames;
                (window as any).mediaNames = [r];
            }
            var s = mediaSelects[0];
            mediaSelects[0] = 0;
            showMediaList1();
            mediaSelects[0] = s;
            if (r) (window as any).mediaNames = t;
            return;
        }
        if (e.indexOf("cmd:info") === 0 || e.indexOf("alert") === 0) {
            mediaSelects.shift();
            var n = /(?:cmd:info|alert)\(([^)]+)\)/;
            var match = n.exec(e);
            var i = match === null ? e : match[1];
            infoBox(i);
            return;
        }
    }
    mediaUrls.push(e);
    (window as any).mediaRecords = [];
    if (mediaRecordsPar !== null) (window as any).mediaRecordsPar = null;
    if (e == -1) {
        (window as any).mediaRecords = medHistory;
        showMediaList();
        return;
    }
    if (e == -2) {
        (window as any).mediaRecords = medFavorites;
        showMediaList();
        return;
    }
    if (typeof (window as any).getMediaArray === "function")
        (window as any).getMediaArray(e, showMediaList);
}

/* ---------------------------------------------------------------------------
 * Select value dialog
 * --------------------------------------------------------------------------- */

/**
 * Handle a click on a value option in the `selectValue` grid. If the clicked value is
 * already selected, dispatches ENTER to confirm it.
 *
 * @param e - The zero-based index of the clicked option.
 * @returns void
 * @sideeffect Stops event propagation. Updates highlight styles for old and new selection.
 *             Calls `aboutKeyHandler(keys.ENTER)` if clicking the already-selected item.
 */
export function clickVal(e: number): void {
    if (
        typeof (window as any).event !== "undefined" &&
        (window as any).event &&
        (window as any).event.stopPropagation
    )
        (window as any).event.stopPropagation();
    if (_curVal === e && aboutKeyHandler)
        aboutKeyHandler((window as any).keys.ENTER);
    $("#ik" + _curVal).css({ "background-color": "", color: "" });
    _curVal = e;
    $("#ik" + _curVal).css({
        "background-color": (window as any).curColorB,
        color: (window as any).curColor,
    });
}

/**
 * Show a grid-based value selection dialog in `#listAbout`. Values are laid out in a dynamically
 * calculated column count based on the longest text. Supports arrow-key navigation and ENTER to confirm.
 *
 * @param t - An object with `.name` (dialog title), `.values` (array of value strings), and `.val` (current value index).
 * @returns void
 * @sideeffect Calls `saveCPD()`. Sets caption/podval/detail. Shows `#listAbout` with a grid of clickable divs.
 *             Registers `aboutKeyHandler` for keyboard navigation.
 * @analysis Values containing "@@@" are filtered out. Column count is calculated by measuring the widest label
 *             text against `#listAbout` width. UP/DOWN/LEFT/RIGHT navigate the grid; ENTER saves the value;
 *             RETURN/EXIT discards and calls `restoreCPD()`.
 */
export function selectValue(t: any): void {
    var r = t.values.filter(function (v: any) {
        return v !== "@@@";
    });
    _curVal = r.indexOf(t.values[t.val]);
    if (_curVal < 0) _curVal = 0;
    saveCPD();
    if (listCaptionElement) listCaptionElement.innerHTML = t.name;
    if (listPodvalElement)
        listPodvalElement.innerHTML =
            btnDiv(keys.RETURN, strRETURN, "Close") +
            btnDiv(keys.ENTER, strENTER, "Set");
    if (listDetailElement) listDetailElement.innerHTML = "";

    /* Measure longest text to calculate column count */
    var testEl = $("#testFont");
    var maxW = 0;
    for (var i = 0; i < r.length; i++) {
        testEl.html("&nbsp;" + r[i] + "&nbsp;");
        maxW = maxW > testEl.width() ? maxW : testEl.width();
        testEl.text("");
    }
    var listAboutW = $("#listAbout").width();
    var n = 6;
    if (maxW > 0 && listAboutW > 0) {
        n = Math.max(
            Math.min(Math.round(listAboutW / maxW) - 1, r.length),
            Math.round(r.length / 6) + 1
        );
    }

    var lineHeight = Math.floor((800 * getHeightK()) / settings.pageSize);

    var html = "";
    for (var i = 0; i < r.length; i++) {
        if (i % n === 0) html += "<br/>";
        html +=
            '<div id="ik' +
            i +
            '" onclick="clickVal(' +
            i +
            ');" style="display:inline-block;width:' +
            98 / n +
            "%;overflow:hidden;text-align:center;vertical-align:middle;line-height:" +
            lineHeight +
            'px;">' +
            r[i] +
            "</div>";
    }
    $("#listAbout")
        .html('<div style="font-size:larger;">' + html + "</div>")
        .show();
    $("#ik" + _curVal).css({
        "background-color": (window as any).curColorB,
        color: (window as any).curColor,
    });
    if (listDetailElement) listDetailElement.innerHTML = r[_curVal];

    /**
     * Move the selection cursor by `delta` positions in the grid, wrapping at edges.
     *
     * @param delta - The number of positions to move (can be negative).
     * @returns void
     * @sideeffect Updates `_curVal` and highlight styles. Refreshes `listDetailElement`.
     */
    function move(delta: number): void {
        $("#ik" + _curVal).css({ "background-color": "", color: "" });
        _curVal += delta;
        if (_curVal < 0) _curVal = r.length - 1;
        if (_curVal >= r.length) _curVal = 0;
        $("#ik" + _curVal).css({
            "background-color": (window as any).curColorB,
            color: (window as any).curColor,
        });
        if (listDetailElement) listDetailElement.innerHTML = r[_curVal];
    }

    aboutKeyHandler = function (e: number): boolean {
        switch (e) {
            case keys.UP:
                move(
                    _curVal >= n
                        ? -n
                        : r.length -
                              (r.length % n) +
                              (_curVal + 1 > r.length % n ? -n : 0)
                );
                return true;
            case keys.DOWN:
                move(_curVal < r.length - n ? n : -_curVal + (_curVal % n));
                return true;
            case keys.LEFT:
                move(
                    _curVal % n > 0
                        ? -1
                        : _curVal + n - 1 > r.length - 1
                          ? r.length - _curVal - 1
                          : n - 1
                );
                return true;
            case keys.RIGHT:
                move(
                    _curVal % n < n - 1
                        ? _curVal + 1 == r.length
                            ? -_curVal % n
                            : 1
                        : -n + 1
                );
                return true;
            case keys.ENTER:
                t.val = t.values.indexOf(r[_curVal]);
            /* fall through */
            case keys.RETURN:
            case keys.EXIT:
                $("#listAbout").text("").hide();
                restoreCPD();
                showPage();
                return true;
            default:
                return false;
        }
    };
}

/* ---------------------------------------------------------------------------
 * Settings helpers
 * --------------------------------------------------------------------------- */

/**
 * Show a confirmation dialog asking whether to exit the player. On confirm, saves the current
 * channel state, resets playType, and calls `stbExit()`.
 *
 * @returns void
 * @sideeffect Shows a `confirmBox`. On yes: calls `window.setCurrent()`, sets `window.playType = 0`,
 *             calls `window.stbExit()`.
 */
export function exitPortal(): void {
    confirmBox(_("Do you want to exit player?"), function () {
        var w = window as any;
        if (typeof w.setCurrent === "function")
            w.setCurrent(w.catIndex, w.primaryIndex);
        w.playType = 0;
        if (typeof w.stbExit === "function") w.stbExit();
    });
}

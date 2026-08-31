/**
 * Language selection UI for OTT-play FOSS.
 *
 * Renders a list of 20 languages, saves the selection to stb storage,
 * loads the matching /stbPlayer/{code}.js, then proceeds to loadProv()
 * or optionsList depending on duneAddSettings availability.
 */

import { stbExit } from "../core";
import { keys } from "../keyhandler";
import { loadLanguage } from "../localization";
import { loadProv } from "../provider";
import { stbGetItem, stbSetItem } from "../storage";
import { btnDiv, closeList, infoBox, showPage, strRETURN } from "../ui";
import { hostUrl, PLAYER_VERSION, selIndex } from "./state";

declare var duneAddSettings: ((_index: number) => void) | null;
declare var listDataArray: any[];
declare var getListItemFn: ((item: any, idx: number) => string) | null;
declare var detailListActionFn: (() => void) | null;
declare var listKeyHandlerFn: ((key: any) => boolean) | null;

const LANG_CODES = [
    "_eng",
    "_arm",
    "_bel",
    "_bul",
    "_fra",
    "_ger",
    "_gre",
    "_heb",
    "_hun",
    "_ita",
    "_lat",
    "_lit",
    "_pol",
    "_por",
    "_rou",
    "_rus",
    "_spa",
    "_tur",
    "_ukr",
    "_uzb",
];

const LANG_NAMES = [
    "English",
    "Armenian - Հայերեն",
    "Belarusian - Беларуская",
    "Bulgarian - Български",
    "French - Français",
    "German - Deutsch",
    "Greek - Ελληνικά",
    "Hebrew - עברית",
    "Hungarian - Magyar",
    "Italian - Italiano",
    "Latvian - Latviski",
    "Lithuanian - Lietuvių",
    "Polish - Polski",
    "Portuguese - Português",
    "Romanian - Română",
    "Russian - Русский",
    "Spanish - Español",
    "Turkish - Türkçe",
    "Ukrainian - Українська",
    "Uzbek - O'zbekcha",
];

/**
 * Show the language selection list. Saves the chosen language to stb
 * storage, loads the matching language JS, and proceeds to loadProv().
 */
export function selectLang(): void {
    // ponytail: state variables imported as let → write through the global aliases
    // since strict ES modules forbid reassigning imported let bindings.
    (window as any).selIndex = LANG_CODES.indexOf(
        stbGetItem("ottplaylang") || ""
    );
    var prevSelIndex = (window as any).selIndex;
    if ((window as any).selIndex === -1) (window as any).selIndex = 0;
    listDataArray = LANG_NAMES;
    getListItemFn = function (item: any, _idx: number) {
        return "&nbsp;&nbsp;" + item;
    };
    detailListActionFn = function (): void {
        /* ponytail: legacy default — no detail panel for language list */
    };
    listKeyHandlerFn = function (key: number): boolean {
        switch (key) {
            case keys.ENTER:
                console.log(
                    "TRACE selectLang ENTER prevSelIndex=" +
                        prevSelIndex +
                        " selIndex=" +
                        (window as any).selIndex
                );
                if (prevSelIndex === (window as any).selIndex) {
                    if (typeof duneAddSettings !== "function") loadProv();
                    else if (typeof (window as any).optionsList === "function")
                        (window as any).optionsList(selectLang);
                } else {
                    stbSetItem(
                        "ottplaylang",
                        LANG_CODES[(window as any).selIndex]
                    );
                    loadLanguage(
                        LANG_CODES[(window as any).selIndex],
                        function () {
                            if (typeof duneAddSettings !== "function") {
                                loadProv();
                            } else if (
                                typeof (window as any).optionsList ===
                                "function"
                            )
                                (window as any).optionsList(selectLang);
                        },
                        function () {
                            console.log("TRACE langJS load FAILED");
                            infoBox("ERR: lang loading fail!");
                        }
                    );
                }
                return true;
            case keys.EXIT:
                if (typeof duneAddSettings === "function") return false;
            case keys.RETURN:
                if (typeof duneAddSettings !== "function") {
                    closeList();
                    stbExit();
                } else if (typeof (window as any).optionsList === "function")
                    (window as any).optionsList(selectLang);
                return true;
            default:
                break;
        }
        return false;
    };
    var listDetailEl = document.getElementById("listDetail");
    if (listDetailEl) listDetailEl.innerHTML = "";
    var listCaptionEl = document.getElementById("listCaption");
    if (listCaptionEl)
        listCaptionEl.innerHTML = (window as any)._("Choose language");
    var listPodvalEl = document.getElementById("listPodval");
    if (listPodvalEl)
        listPodvalEl.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    var listPopUpEl = document.getElementById("listPopUp");
    if (listPopUpEl) listPopUpEl.style.display = "none";
    showPage();
}

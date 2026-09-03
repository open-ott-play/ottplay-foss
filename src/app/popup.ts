/**
 * Popup menu data for OTT-play FOSS — compatibility shim.
 *
 * The canonical definitions of `popupArray` (labels), `popupActions`
 * (handlers), `popupDetail` (descriptions) and `savedPopup` live in
 * `./state`. This module only re-exports them so existing
 * `import { popupActions } from "./popup"` call sites keep working.
 *
 * Do NOT add a second copy of the label/detail/action literals here — they
 * are index-aligned 1:1 and drifted out of sync the last time they were
 * duplicated. Edit `./state` instead.
 */

export {
    initPopupActions,
    POPUP_ACTION_NAMES,
    POPUP_DETAILS,
    POPUP_LABELS,
    popupActions,
    popupArray,
    popupDetail,
    savedPopup,
} from "./state";

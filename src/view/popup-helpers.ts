/**
 * Popup menu helpers for OTT-play FOSS — compatibility shim.
 *
 * This module used to carry its own copy of the popup label / action /
 * detail literals. That copy had drifted out of alignment: its
 * `popupDetail` was 23 entries long and put "Show rewind window" at index 8
 * and "Show list of channel archive records without duplication" at index
 * 13, one slot past the "Rewind" (7) and "Show list of channel archive
 * records" (12) labels they describe.
 *
 * The canonical, index-aligned definitions now live in `../app/state`.
 * This module re-exports them so nothing has to change import paths.
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
    version,
} from "../app/state";

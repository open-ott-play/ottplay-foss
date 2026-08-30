// UI-related DOM element references and helper functions

declare var $: any;

/**
 * Cache jQuery references to frequently-used DOM elements.
 * Must be called after the DOM is ready and #info1 / #progress_span exist.
 *
 * Side effects: Assigns module-level $i1, tooltip, $tooltipSpan.
 */
export function initUIReferences(): void {
    (window as any).$i1 = $("#info1");
    (window as any).tooltip = document.getElementById("progress_span");
    if ((window as any).tooltip) {
        (window as any).$tooltipSpan = $("span", (window as any).tooltip);
    }
}

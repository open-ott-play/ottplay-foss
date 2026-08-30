// Options system helpers and menu utilities

declare var listArray: any[];

/**
 * Find the index of an action function within an array of { action } objects.
 */
export function indexOfAction(arr: any[], action: any): number {
    for (var i = 0; i < arr.length; i++) if (arr[i].action === action) return i;
    return -1;
}

/**
 * Convenience wrapper: find the index of `action` in the global optionsArr.
 */
export function optIndexOf(optionsArr: any[], action: any): number {
    return indexOfAction(optionsArr, action);
}

/**
 * Remove an option entry from optionsArr by its action function.
 */
export function delOption(optionsArr: any[], action: any): void {
    var idx = optIndexOf(optionsArr, action);
    if (idx > -1) optionsArr.splice(idx, 1);
}

/**
 * Prepend a styled button label to a list item whose action matches.
 */
export function addBtn2menu(arr: any[], action: any, label: string): void {
    if (!label) return;
    var idx = indexOfAction(arr, action);
    if (idx > -1)
        (listArray as any)[idx] =
            '<div class="btn">' + label + "</div> " + (listArray as any)[idx];
}

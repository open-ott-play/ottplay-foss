/** Show one useful count; the enclosing dialog already owns the loading title. */
export function formatLocalMediaProgress(
    value: any,
    translate: (text: string) => string
): string {
    var playable = (value.items || []).filter(function (item: any) {
        return item.available !== false && !!item.url;
    }).length;
    return translate("Local videos") + ": " + playable;
}

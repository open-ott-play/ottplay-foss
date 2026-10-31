/** Navigation projects the current screen's actions; it never owns a catalogue. */
export function createModernActions(host: any, ports: any) {
    return function () {
        var owner = host.__ottClassicScreenPort?.listOwner();
        function admitted(): boolean {
            return !!(
                owner &&
                owner === host.__ottClassicScreenPort?.listOwner() &&
                owner.foreground() &&
                !host.__ottKiosk?.locked()
            );
        }
        if (!admitted()) return [];
        var actions: any[] = [];
        function add(id: string, label: string, icon: string, run: () => void) {
            actions.push({
                icon: icon,
                id: id,
                label: label,
                run: function () {
                    if (admitted()) run();
                },
            });
        }
        add("library", host._("Channel list"), "▦", function () {
            if (host.__ottActiveProviderDriver?.catalogBrowser?.restore())
                return;
            if (host.__ottChannels?.restoreBrowsing?.()) return;
            if (typeof host.channelsList === "function")
                host.channelsList(host.catIndex, host.primaryIndex);
        });
        if (typeof host.openGlobalFavorites === "function")
            add("favorites", host._("Favorites"), "☆", function () {
                host.openGlobalFavorites();
            });
        if (typeof host.bucketsList === "function")
            add("categories", host._("Category selection"), "≡", function () {
                host.bucketsList(
                    host.__ottChannels?.browsingIndex?.() ?? host.catIndex
                );
            });
        if (host.__ottChannelSearch?.open)
            add("search", host._("Search"), "⌕", function () {
                // The shared search entrypoint delegates to the active provider.
                host.__ottChannelSearch.open();
            });
        if (ports.providersAvailable())
            add("providers", host._("Choose provider"), "◫", ports.providers);
        add("settings", host._("Settings"), "⚙", ports.settings);
        return actions;
    };
}

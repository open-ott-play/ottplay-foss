/** Storage authority, portable filtering and PIN preparation stay in the host. */
function cloudCodecFailure(): never {
    throw new Error("Invalid cloud settings document");
}
function cloudCodecKey(key: string): void {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
        cloudCodecFailure();
}
function cloudCodecPortable(
    items: Record<string, string>,
    portable: (key: string) => boolean
): Record<string, string> {
    var result: Record<string, string> = Object.create(null);
    Object.keys(items).forEach(function (key) {
        if (portable(key))
            result[key] =
                key === "parentPIN"
                    ? (window as any).__ottPinSecurity.prepare(items[key])
                    : items[key];
    });
    return result;
}
function readCloudSettings(
    xml: string,
    portable: (key: string) => boolean
): Record<string, string> {
    return cloudCodecPortable(
        (window as any).OttPlayCore.readClassicCloudStorage(xml),
        portable
    );
}
function writeCloudSettings(
    items: Record<string, string>,
    portable: (key: string) => boolean
): string {
    if (!items || typeof items !== "object" || Array.isArray(items))
        cloudCodecFailure();
    var copy: Record<string, string> = Object.create(null);
    Object.keys(items).forEach(function (key) {
        cloudCodecKey(key);
        var value = items[key];
        if (typeof value !== "string") cloudCodecFailure();
        copy[key] = value;
    });
    copy = cloudCodecPortable(copy, portable);
    var core = (window as any).OttPlayCore;
    var lines = [core.cloudStorageHeader()];
    Object.keys(copy).forEach(function (key) {
        lines.push(core.cloudStorageEntry(key, copy[key]));
    });
    lines.push("</properties>");
    return lines.join("\n");
}
(window as any).__ottCloudSettingsCodec = {
    read: function (xml: string) {
        return readCloudSettings(xml, function (key) {
            return (window as any).isPortableSettingsKey(key);
        });
    },
    write: function (items: Record<string, string>) {
        return writeCloudSettings(items, function (key) {
            return (window as any).isPortableSettingsKey(key);
        });
    },
};

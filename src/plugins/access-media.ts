/** iOS owns source credentials and returns only a per-launch loopback media URL. */
export function accessMediaPlugin(): any {
    var cap = (window as any).Capacitor;
    return cap &&
        typeof cap.getPlatform === "function" &&
        cap.getPlatform() === "ios" &&
        cap.Plugins
        ? cap.Plugins.AccessMedia
        : undefined;
}

export function prepareAccessMedia(
    url: string,
    ready: (url: string) => void,
    failed: () => void
): void {
    var plugin = accessMediaPlugin();
    if (!plugin || !/^https:\/\//i.test(url)) {
        ready(url);
        return;
    }
    plugin.prepare({ url: url }).then(function (result: { url: string }) {
        if (!result || typeof result.url !== "string") {
            failed();
            return;
        }
        // Do not turn a native bridge error into navigation to another origin.
        if (
            result.url !== url &&
            !/^http:\/\/127\.0\.0\.1:\d+\/access\/[A-Za-z0-9_-]{43}\//.test(
                result.url
            )
        ) {
            failed();
            return;
        }
        ready(result.url);
    }, failed);
}

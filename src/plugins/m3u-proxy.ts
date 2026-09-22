import { nativePromiseToJq } from "./jquery-bridge";
import { resolveNativePlugin } from "./native-bridge";
import { installCapacitorHttpTransport } from "./native-http";
import { StalkerPortal } from "./stalker-portal";
import { nativeWebFallback } from "./web-fallback";

export interface M3UProxyPlugin {
    /**
     * Fetch a remote URL with injected User-Agent and Referer headers.
     * Mirrors Tauri `proxy_fetch` and Mode A `cp.php` behavior.
     *
     * @param opts.url - Target URL. Leading `@` is stripped (provider form).
     * @param opts.referer - Optional Referer header. Defaults to the URL's origin.
     * @param opts.userAgent - Optional UA preset or custom string.
     *   Presets: webos, tizen, viera, mag, dune. Falls back to custom or `OTT-play-FOSS/1.0`.
     * @returns Response body as text.
     */
    proxyFetch(opts: {
        url: string;
        referer?: string;
        userAgent?: string;
    }): Promise<{ body: string }>;
}

const UA_PRESETS: Record<string, string> = {
    dune: "Mozilla/5.0 (Dune HD; DuneOS) AppleWebKit/537.36 (KHTML, like Gecko) DuneHD/1.0 Chrome/68.0.3440.106 Safari/537.36",
    mag: "Mozilla/5.0 (STB; Infomir MAG524) Maple 6.0 QtWebKit/3.0",
    tizen: "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungTV/3.0 Chrome/76.0.3809.146 Safari/537.36",
    viera: "Mozilla/5.0 (Unknown; Linux; Viera/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36",
    webos: "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 LG Browser/9.00.00",
};

function resolveUA(input?: string): string {
    if (!input) return "OTT-play-FOSS/1.0";
    const key = input.toLowerCase();
    return UA_PRESETS[key] ?? input;
}

class M3UProxyWeb {
    proxyFetch(_opts: {
        url: string;
        referer?: string;
        userAgent?: string;
    }): Promise<{ body: string }> {
        return nativeWebFallback(function () {
            console.warn(
                "[M3UProxy] native impl not available, returning empty body"
            );
            return { body: "" };
        });
    }
}

const M3UProxy = resolveNativePlugin<M3UProxyPlugin>(
    "M3UProxy",
    () => new M3UProxyWeb()
);

interface NativeXmltvChannel {
    icon?: string;
    id: string;
    name: string;
    names?: string[];
}

/** Data conversion only: ordered ID/alias/fuzzy decisions belong to the shared core. */
function createNativeXmltvMatcher(
    entries: NativeXmltvChannel[]
): (
    id: string,
    tvgName: string,
    name: string
) => NativeXmltvChannel | undefined {
    var rows: string[][] = [];
    entries.forEach(function (entry) {
        // Retain explicit IDs even when a channel has no searchable aliases.
        var aliases = entry.names || [entry.name];
        (aliases.length ? aliases : [""]).forEach(function (alias) {
            rows.push([entry.id, alias]);
        });
    });
    var index = new (window as any).OttPlayCore.NativeGuide(
        rows,
        "web",
        function (value: string) {
            return value.length;
        },
        function (value: number) {
            return value;
        }
    );
    return function (id: string, tvgName: string, name: string) {
        var resolved = index.resolve(id, [tvgName, name]);
        return entries.filter(function (entry) {
            return entry.id === resolved;
        })[0];
    };
}

export function matchNativeXmltvChannel(
    entries: NativeXmltvChannel[],
    id: string,
    tvgName: string,
    name: string
): NativeXmltvChannel | undefined {
    return createNativeXmltvMatcher(entries)(id, tvgName, name);
}

function nativeLogoFallback(name: string): string {
    var letter = (name.trim().charAt(0) || "?").replace(/[<>&"']/g, "?");
    return (
        "data:image/svg+xml," +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" rx="8" fill="#334155"/><text x="60" y="60" text-anchor="middle" font-family="sans-serif" font-size="48" fill="white">' +
                letter +
                "</text></svg>"
        )
    );
}

/** Adapt the existing FOSS text protocol to the native XMLTV index. */
export async function matchCapacitorM3u(
    body: string,
    logos: boolean
): Promise<string> {
    var parts = body.split("\n\t\n");
    var header = JSON.parse(parts[0] || "{}");
    var metadata = header.native_channels || {};
    var groups: Record<
        string,
        Promise<ReturnType<typeof createNativeXmltvMatcher>>
    > = {};
    var plugin = (window as any).Capacitor.Plugins.MobileXmltvEpg;
    var lines = (parts[2] || "").split("\n").filter(Boolean);
    var rows = await Promise.all(
        lines.map(async function (line) {
            var id = line.split("-")[0];
            var info = metadata[id] || {};
            var name =
                info.name ||
                decodeURIComponent(line.slice(line.lastIndexOf("~") + 1));
            var sources = Array.isArray(info.xmltv_urls) ? info.xmltv_urls : [];
            var key = JSON.stringify(sources);
            if (!groups[key])
                groups[key] = plugin
                    .getChannels({ xmltv_urls: sources })
                    .then(function (result: {
                        channels: NativeXmltvChannel[];
                    }) {
                        return createNativeXmltvMatcher(result.channels);
                    });
            var index = await groups[key];
            var found = index(
                String(info.tvg_id || ""),
                info.tvg_name || "",
                name
            );
            if (logos)
                return (
                    id +
                    "~" +
                    ((found && found.icon) || nativeLogoFallback(name))
                );
            return found ? id + "~local~" + id : "";
        })
    );
    return (
        "{}\n\t\n" +
        rows.filter(Boolean).join("\n") +
        (logos ? "" : "\n\t\nlocal~/")
    );
}

function isLocalCapacitorCompanionUrl(url: string): boolean {
    try {
        var target = new URL(url, window.location.href);
        var current = new URL(window.location.href);
        return (
            target.protocol === current.protocol && target.host === current.host
        );
    } catch (_e) {
        return false;
    }
}

function setupCapacitorCompanionShim(): void {
    const $ = (window as any).$;
    if (
        !$ ||
        typeof $.ajax !== "function" ||
        typeof $.Deferred !== "function"
    ) {
        console.warn("[Capacitor] companion shim: jQuery ajax unavailable");
        return;
    }
    if ((window as any).__ottCapacitorAjaxShim) return;
    (window as any).__ottCapacitorAjaxShim = true;
    installCapacitorHttpTransport($, StalkerPortal);
    const origAjax = $.ajax.bind($);

    $.ajax = function (urlOrOpts: any, maybeOpts?: any): any {
        let opts: any;
        if (typeof urlOrOpts === "string") {
            opts = Object.assign({ url: urlOrOpts }, maybeOpts || {});
        } else {
            opts = Object.assign({}, urlOrOpts || {});
        }
        const url = String(opts.url || "");

        if (
            isLocalCapacitorCompanionUrl(url) &&
            /\/m3u\/match-(channels|logos)(?:[?#]|$)/.test(url)
        ) {
            return nativePromiseToJq(
                $,
                matchCapacitorM3u(
                    typeof opts.data === "string" ? opts.data : "",
                    url.indexOf("match-logos") >= 0
                ),
                opts,
                "proxy_fetch failed"
            );
        }
        if (
            isLocalCapacitorCompanionUrl(url) &&
            url.indexOf("/m3u/cp.php") !== -1
        ) {
            let target = "";
            const data = opts.data;
            if (typeof data === "string") {
                const m = /(?:^|&)url=([^&]*)/.exec(data);
                if (m) target = decodeURIComponent(m[1].replace(/\+/g, " "));
            } else if (data && typeof data === "object") {
                target = String((data as any).url || "");
            }
            if (!target) {
                const dfd = $.Deferred();
                dfd.reject("proxy_fetch: missing url");
                try {
                    if (typeof opts.error === "function") {
                        opts.error({ status: 0 }, "error", "missing url");
                    }
                } catch (_e) {}
                return dfd.promise(dfd) as any;
            }
            const ua = extractUA(data);
            const referer = extractReferer(data);
            return nativePromiseToJq(
                $,
                M3UProxy.proxyFetch({
                    referer,
                    url: target,
                    userAgent: ua,
                }).then((res) => res.body),
                opts,
                "proxy_fetch failed"
            );
        }

        return origAjax(urlOrOpts, maybeOpts);
    };
}

function extractUA(data: any): string | undefined {
    if (!data) return undefined;
    if (typeof data === "string") {
        const m = /(?:^|&)ua=([^&]*)/.exec(data);
        if (m) return decodeURIComponent(m[1].replace(/\+/g, " ")) || undefined;
        return undefined;
    }
    const ua = (data as any).ua;
    if (typeof ua === "string" && ua) return ua;
    return undefined;
}

function extractReferer(data: any): string | undefined {
    if (!data) return undefined;
    if (typeof data === "string") {
        const m = /(?:^|&)referer=([^&]*)/.exec(data);
        if (m) return decodeURIComponent(m[1].replace(/\+/g, " ")) || undefined;
        return undefined;
    }
    const ref = (data as any).referer;
    if (typeof ref === "string" && ref) return ref;
    return undefined;
}

export { M3UProxy, resolveUA, setupCapacitorCompanionShim, UA_PRESETS };

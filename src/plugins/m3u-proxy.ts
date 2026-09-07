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

import { registerPlugin } from "@capacitor/core";

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
    async proxyFetch(_opts: {
        url: string;
        referer?: string;
        userAgent?: string;
    }): Promise<{ body: string }> {
        console.warn(
            "[M3UProxy] native impl not available, returning empty body"
        );
        return { body: "" };
    }
}

const M3UProxy: any =
    typeof (window as any).Capacitor !== "undefined"
        ? registerPlugin("M3UProxy", {
              web: M3UProxyWeb,
          })
        : M3UProxyWeb;

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
    const origAjax = $.ajax.bind($);

    function jqFromPromise(promise: Promise<string>, opts: any): any {
        const dfd = $.Deferred();
        promise.then(
            (text: string) => {
                try {
                    if (typeof opts.success === "function") {
                        opts.success(text, "success", dfd);
                    }
                } catch (_e) {}
                try {
                    if (typeof opts.complete === "function") {
                        opts.complete(dfd, "success");
                    }
                } catch (_e3) {}
                dfd.resolve(text);
            },
            (err: any) => {
                const msg = err != null ? String(err) : "proxy_fetch failed";
                try {
                    if (typeof opts.error === "function") {
                        opts.error(
                            { responseText: msg, status: 0 },
                            "error",
                            msg
                        );
                    }
                } catch (_e2) {}
                try {
                    if (typeof opts.complete === "function") {
                        opts.complete(dfd, "error");
                    }
                } catch (_e3) {}
                dfd.reject(msg);
            }
        );
        return dfd.promise(dfd) as any;
    }

    $.ajax = function (urlOrOpts: any, maybeOpts?: any): any {
        let opts: any;
        if (typeof urlOrOpts === "string") {
            opts = Object.assign({ url: urlOrOpts }, maybeOpts || {});
        } else {
            opts = Object.assign({}, urlOrOpts || {});
        }
        const url = String(opts.url || "");

        if (url.indexOf("/m3u/cp.php") !== -1) {
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
            return jqFromPromise(
                M3UProxy.proxyFetch({
                    referer,
                    url: target,
                    userAgent: ua,
                }).then((res) => res.body),
                opts
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

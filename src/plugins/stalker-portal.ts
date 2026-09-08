/**
 * Stalker portal + host_ott swop shim — Mode B native HTTP transport.
 *
 * Covers:
 * - Stalker provider scripts (`prov/stalker/prov.js`) POST JSON-RPC to
 *   `<portal>/stalker_portal/api/` (and `/stalker_portal/stream/` text).
 * - Dealer/cloud entry (`edit_dealer_remote`, cloud settings) POST
 *   form-urlencoded bodies to `host_ott/swop/a.php`.
 *
 * Native apps have no companion HTTP server and WebView CORS blocks those
 * origins. This module:
 * - exposes Capacitor `StalkerPortal.portalRequest` (native HTTP);
 * - `setupStalkerPortalShim()` intercepts jQuery `$.ajax` for the paths
 *   above and routes through Tauri `stalker_portal_fetch` or Cap
 *   `portalRequest`.
 *
 * Mode A (browser + companion) never installs this shim.
 * Hard rule: never fake a successful portal/swop response.
 *
 * Still out of scope: Mag `c/portal` / `load.php`, VOD, proprietary host
 * defaults (caller must set `host_ott` / `host_ott_proto` as STB firmware
 * does).
 */

import { registerPlugin } from "@capacitor/core";

export interface StalkerPortalPlugin {
    portalRequest(opts: {
        url: string;
        method?: string;
        body?: string;
        contentType?: string;
    }): Promise<{
        status: number;
        body: string;
        contentType: string;
    }>;
}

class StalkerPortalWeb implements StalkerPortalPlugin {
    async portalRequest(_opts: {
        url: string;
        method?: string;
        body?: string;
        contentType?: string;
    }): Promise<{
        status: number;
        body: string;
        contentType: string;
    }> {
        // Web fallback must not pretend the portal answered.
        throw new Error(
            "[StalkerPortal] native plugin unavailable (web fallback)"
        );
    }
}

const StalkerPortal: any =
    typeof (window as any).Capacitor !== "undefined"
        ? registerPlugin<StalkerPortalPlugin>("StalkerPortal", {
              web: StalkerPortalWeb,
          })
        : new StalkerPortalWeb();

function isStalkerPortalUrl(url: string): boolean {
    return (
        url.indexOf("/stalker_portal/api/") !== -1 ||
        url.indexOf("/stalker_portal/stream/") !== -1
    );
}

/** STB dealer/cloud handshake endpoint (`host_ott_proto + host_ott + /swop/a.php`). */
function isHostOttSwopUrl(url: string): boolean {
    return url.indexOf("/swop/a.php") !== -1;
}

function isShimmedUrl(url: string): boolean {
    return isStalkerPortalUrl(url) || isHostOttSwopUrl(url);
}

function tauriInvoke<T>(
    command: string,
    args: Record<string, unknown>
): Promise<T> {
    const core = (window as any).__TAURI__?.core;
    if (core?.invoke) {
        return core.invoke(command, args) as Promise<T>;
    }
    return (window as any).__TAURI__.invoke(command, args) as Promise<T>;
}

/**
 * Encode ajax `data` the way jQuery would for the target URL.
 * Stalker JSON-RPC uses JSON bodies; swop/a.php uses form-urlencoded
 * (jQuery default for object `data` without `contentType: application/json`).
 */
function encodeAjaxBody(
    opts: any,
    url: string
): { body: string | undefined; contentType: string } {
    const swop = isHostOttSwopUrl(url);
    const explicitCt =
        typeof opts.contentType === "string" ? opts.contentType : "";
    const defaultCt = swop
        ? "application/x-www-form-urlencoded; charset=UTF-8"
        : "application/json";
    const contentType = explicitCt || defaultCt;

    if (typeof opts.data === "string") {
        return { body: opts.data, contentType };
    }
    if (opts.data == null) {
        return { body: undefined, contentType };
    }
    if (typeof opts.data === "object") {
        const wantForm =
            swop ||
            contentType.indexOf("application/x-www-form-urlencoded") !== -1;
        if (wantForm) {
            const $ = (window as any).$;
            try {
                if ($ && typeof $.param === "function") {
                    return { body: $.param(opts.data), contentType };
                }
            } catch (_e) {}
            // Minimal fallback if $.param missing
            try {
                const parts: string[] = [];
                for (const key of Object.keys(opts.data)) {
                    const val = opts.data[key];
                    parts.push(
                        encodeURIComponent(key) +
                            "=" +
                            encodeURIComponent(val == null ? "" : String(val))
                    );
                }
                return { body: parts.join("&"), contentType };
            } catch (_e2) {
                return { body: undefined, contentType };
            }
        }
        try {
            return { body: JSON.stringify(opts.data), contentType };
        } catch (_e3) {
            return { body: undefined, contentType };
        }
    }
    return { body: undefined, contentType };
}

/**
 * Install `$.ajax` wrapper that routes Stalker portal + host_ott swop URLs
 * through native transport. Other URLs keep the previous ajax implementation
 * (Mode B companion shim or raw jQuery).
 */
export function setupStalkerPortalShim(): void {
    const $ = (window as any).$;
    if (
        !$ ||
        typeof $.ajax !== "function" ||
        typeof $.Deferred !== "function"
    ) {
        console.warn("[Stalker] shim: jQuery ajax unavailable");
        return;
    }
    if ((window as any).__ottStalkerPortalShim) return;
    (window as any).__ottStalkerPortalShim = true;
    const origAjax = $.ajax.bind($);

    function jqFromPromise(promise: Promise<any>, opts: any): any {
        const dfd = $.Deferred();
        promise.then(
            (val: any) => {
                try {
                    if (typeof opts.success === "function") {
                        opts.success(val, "success", dfd);
                    }
                } catch (_e) {}
                try {
                    if (typeof opts.complete === "function") {
                        opts.complete(dfd, "success");
                    }
                } catch (_e3) {}
                dfd.resolve(val);
            },
            (err: any) => {
                const msg = err != null ? String(err) : "portalRequest failed";
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

    function parseResponseBody(
        body: string,
        opts: any,
        url: string,
        respContentType: string
    ): any {
        const wantJson =
            opts.dataType === "json" ||
            isHostOttSwopUrl(url) ||
            (respContentType &&
                respContentType.indexOf("application/json") !== -1);
        if (wantJson && typeof body === "string" && body) {
            try {
                return JSON.parse(body);
            } catch (_e) {
                return body;
            }
        }
        return body;
    }

    $.ajax = function (urlOrOpts: any, maybeOpts?: any): any {
        let opts: any;
        if (typeof urlOrOpts === "string") {
            opts = Object.assign({ url: urlOrOpts }, maybeOpts || {});
        } else {
            opts = Object.assign({}, urlOrOpts || {});
        }
        const url = String(opts.url || "");

        if (!isShimmedUrl(url)) {
            return origAjax(urlOrOpts, maybeOpts);
        }

        const method = String(opts.type || opts.method || "GET").toUpperCase();
        const encoded = encodeAjaxBody(opts, url);
        const body = encoded.body;
        const contentType = encoded.contentType;

        const isTauri = typeof (window as any).__TAURI__ !== "undefined";

        if (isTauri) {
            const invokePromise = tauriInvoke<{
                status: number;
                body: string;
                contentType: string;
            }>("stalker_portal_fetch", {
                body,
                contentType,
                method,
                url,
            }).then((res) => {
                if (!(res.status >= 200 && res.status < 300)) {
                    throw new Error(
                        "stalker HTTP " +
                            res.status +
                            ": " +
                            (res.body || "").slice(0, 200)
                    );
                }
                return parseResponseBody(
                    res.body || "",
                    opts,
                    url,
                    res.contentType || ""
                );
            });
            return jqFromPromise(invokePromise, opts);
        }

        const capPromise = StalkerPortal.portalRequest({
            body,
            contentType,
            method,
            url,
        }).then((res) => {
            if (!(res.status >= 200 && res.status < 300)) {
                throw new Error(
                    "stalker HTTP " +
                        res.status +
                        ": " +
                        (res.body || "").slice(0, 200)
                );
            }
            return parseResponseBody(
                res.body || "",
                opts,
                url,
                res.contentType || ""
            );
        });
        return jqFromPromise(capPromise, opts);
    };
}

export { StalkerPortal };

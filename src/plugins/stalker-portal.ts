/**
 * Stalker portal shim — Mode B native transport for portal JSON-RPC.
 *
 * Stalker provider scripts (`prov/stalker/prov.js`) POST to
 * `<portal>/stalker_portal/api/`. Native apps have no companion HTTP
 * server and WebView CORS blocks the portal origin. This module:
 *
 * - exposes Capacitor `StalkerPortal.portalRequest` (native HTTP);
 * - `setupStalkerPortalShim()` intercepts jQuery `$.ajax` for
 *   `/stalker_portal/api/` (and `/stalker_portal/stream/` text fetches)
 *   and routes through Tauri `stalker_portal_fetch` or Cap `portalRequest`.
 *
 * Mode A (browser + companion) never installs this shim.
 * Hard rule: never fake a successful portal response.
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
 * Install `$.ajax` wrapper that routes Stalker portal URLs through native
 * transport. Other URLs keep the previous ajax implementation (Mode B
 * companion shim or raw jQuery).
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

    function parseBodyIfJson(body: string, opts: any): any {
        if (opts.dataType === "json" && typeof body === "string" && body) {
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

        if (!isStalkerPortalUrl(url)) {
            return origAjax(urlOrOpts, maybeOpts);
        }

        const method = String(opts.type || opts.method || "GET").toUpperCase();
        let body: string | undefined;
        if (typeof opts.data === "string") {
            body = opts.data;
        } else if (opts.data != null && typeof opts.data === "object") {
            try {
                body = JSON.stringify(opts.data);
            } catch (_e) {
                body = undefined;
            }
        }

        const isTauri = typeof (window as any).__TAURI__ !== "undefined";

        if (isTauri) {
            const invokePromise = tauriInvoke<{
                status: number;
                body: string;
                contentType: string;
            }>("stalker_portal_fetch", { url, method, body }).then((res) => {
                if (!(res.status >= 200 && res.status < 300)) {
                    throw new Error(
                        "stalker HTTP " +
                            res.status +
                            ": " +
                            (res.body || "").slice(0, 200)
                    );
                }
                return parseBodyIfJson(res.body || "", opts);
            });
            return jqFromPromise(invokePromise, opts);
        }

        const contentType =
            typeof opts.contentType === "string"
                ? opts.contentType
                : "application/json";
        const capPromise = StalkerPortal.portalRequest({
            url,
            method,
            body,
            contentType,
        }).then((res) => {
            if (!(res.status >= 200 && res.status < 300)) {
                throw new Error(
                    "stalker HTTP " +
                        res.status +
                        ": " +
                        (res.body || "").slice(0, 200)
                );
            }
            return parseBodyIfJson(res.body || "", opts);
        });
        return jqFromPromise(capPromise, opts);
    };
}

export { StalkerPortal };

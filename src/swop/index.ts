/**
 * Remote text entry (swop) — Cloudflare Worker session handoff for the ♥™ VKB key.
 *
 * Uses a server-authenticated same-origin relay against `settings.swopBaseUrl`.
 * The Device UUID identifies sessions; installation credentials stay on the server.
 * Optional same-origin `/local/swop.json` (gitignored; written by local install) can
 * inject base URL + clientId without committing private operator hostnames.
 */

import { translate as _ } from "../localization";
import { saveSettings, settings } from "../settings";
import {
    type SwopSessionResponse as SessionResponse,
    type SwopValueResponse as ValResponse,
    validSwopClientId,
    wire,
} from "../shared/wire-contracts";
import { makeQrSvg } from "../utils/qr-code";

declare var $: any;
declare var keys: any;
declare var renderButtonHint: (
    keyLabel: number,
    label: string,
    description: string,
    num?: string,
    extra?: string
) => string;
declare var strRETURN: string;
declare var curColor: string;
declare var showEditKey1: (_initKeys?: any) => void;

const POLL_MS = 2500;
const SESSION_TIMEOUT_MS = 6e5;

type AuthenticatedSessionResponse = SessionResponse & {
    clientId?: string;
    sessionToken?: string;
};

interface LocalSwopConfig {
    clientId?: string;
    swopBaseUrl?: string;
}

/**
 * Ensure a stable Device UUID suitable for the Worker allowlist charset.
 * Prefers an explicit id, then window/localStorage/settings; generates a secure id if possible.
 * Returns empty when no id is provisioned and the engine has no secure random API.
 */
export function ensureDeviceClientId(preferred?: string): string {
    var w = window as any;
    var id = "";
    if (preferred && String(preferred).trim()) id = String(preferred).trim();
    if (!id && w.deviceUUID) id = String(w.deviceUUID).trim();
    if (!id) {
        try {
            if (typeof localStorage !== "undefined") {
                id = (
                    localStorage.getItem("ott_device_uuid") ||
                    localStorage.getItem("deviceId") ||
                    ""
                ).trim();
            }
        } catch (_readError) {
            // Privacy modes may throw even when accessing the storage property.
        }
    }
    if (!id && settings.deviceUuid) id = String(settings.deviceUuid).trim();
    if (!validSwopClientId(id)) {
        var random = w.crypto;
        if (!random || typeof random.getRandomValues !== "function") {
            random = w.msCrypto;
        }
        if (
            !random ||
            typeof random.getRandomValues !== "function" ||
            typeof w.Uint8Array !== "function"
        ) {
            return "";
        }
        var bytes: Uint8Array;
        try {
            bytes = new w.Uint8Array(16);
            random.getRandomValues(bytes);
        } catch (_error) {
            return "";
        }
        var hex = "";
        for (var j = 0; j < bytes.length; j++) {
            hex += ("0" + bytes[j].toString(16)).slice(-2);
        }
        id = "dev_" + hex;
    }
    w.deviceUUID = id;
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("ott_device_uuid", id);
            localStorage.setItem("deviceId", id);
        }
    } catch (_e) {
        /* private mode */
    }
    settings.deviceUuid = id;
    if (typeof w.stbSetItem === "function") w.stbSetItem("sDeviceUuid", id);
    return id;
}

/** Resolve Worker base URL (settings / window override). Empty = disabled. */
export function getSwopBaseUrl(): string {
    var w = window as any;
    var u =
        (typeof w.sSwopBaseUrl === "string" && w.sSwopBaseUrl) ||
        settings.swopBaseUrl ||
        "";
    return String(u).trim().replace(/\/+$/, "");
}

function persistSwopBaseUrl(url: string): void {
    var w = window as any;
    settings.swopBaseUrl = url;
    w.sSwopBaseUrl = url;
    if (typeof w.stbSetItem === "function") w.stbSetItem("sSwopBaseUrl", url);
    try {
        saveSettings(settings);
    } catch (_e) {
        /* storage may be unavailable early */
    }
}

/**
 * Fetch optional same-origin `/local/swop.json` and apply base URL + clientId.
 * Safe no-op on 404 / network errors (public builds have no such file).
 */
export function applyLocalSwopConfig(done?: () => void): void {
    var finish = typeof done === "function" ? done : function () {};
    try {
        $.ajax({
            cache: false,
            dataType: "json",
            error: function () {
                finish();
            },
            success: function (data: LocalSwopConfig) {
                try {
                    if (data && typeof data.swopBaseUrl === "string") {
                        var base = data.swopBaseUrl.trim().replace(/\/+$/, "");
                        if (base) persistSwopBaseUrl(base);
                    }
                    if (data && typeof data.clientId === "string") {
                        ensureDeviceClientId(data.clientId);
                    } else {
                        ensureDeviceClientId();
                    }
                } catch (e) {
                    console.error(e);
                }
                finish();
            },
            timeout: 5000,
            type: "GET",
            url: "/local/swop.json",
        });
    } catch (_e) {
        finish();
    }
}

function swopHeaders(clientId: string): Record<string, string> {
    return { [wire.swopClientHeader]: clientId };
}

function authErrorMessage(status: number, body: any): string {
    var detail =
        (body && (body.error || body.message)) ||
        (status === 401
            ? "missing client id"
            : status === 403
              ? "client not allowed"
              : "HTTP " + status);
    if (status === 401 || status === 403) {
        return (
            _("Remote text entry denied") +
            " (" +
            detail +
            "). " +
            _("Check this server's SWOP configuration.")
        );
    }
    return _("Remote text entry error") + ": " + detail;
}

/**
 * ♥™ key handler: start a swop session, show code/URL, poll until phone submits,
 * then fill `editvar` and return to the on-screen keyboard.
 */
export function swopLoadValue(): void {
    var base = getSwopBaseUrl();
    if (!base) {
        alert(_("Remote text entry not configured"));
        return;
    }

    var clientId = ensureDeviceClientId();
    // Legacy TV engines can obtain a secure ID from the trusted installation.
    if (!clientId && base !== "/swop") {
        alert(_("Remote text entry needs a Device ID."));
        return;
    }
    var cancelled = false;
    var code = "";
    // Read access is scoped to this session and is never stored or put in the QR.
    var sessionToken = "";
    var pollTimer: any = null;
    var w = window as any;
    var prevEditKey = w.editKey;

    function cleanup(): void {
        cancelled = true;
        sessionToken = "";
        if (pollTimer) clearTimeout(pollTimer);
        clearTimeout(sessionTimer);
        if (prevEditKey) w.editKey = prevEditKey;
        $("#listEdit").hide();
    }

    var sessionTimer = setTimeout(cleanup, SESSION_TIMEOUT_MS);

    function escapeHtml(s: string): string {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function showMsg(msg: string, isError?: boolean, asHtml?: boolean): void {
        var listEdit = $("#listEdit");
        listEdit
            .html(
                '<div style="text-align:center;font-size:larger;' +
                    (isError ? "color:red;" : "") +
                    '"><br/><br/><span class="swop-msg-text"></span></div>'
            )
            .show();
        var el = listEdit.find(".swop-msg-text");
        var s = msg == null ? "" : String(msg);
        // Success UI needs <br/> + styled spans; plain errors stay text-escaped.
        if (asHtml) el.html(s);
        else el.text(s);
    }

    function returnToVkb(value: string): void {
        cancelled = true;
        sessionToken = "";
        if (pollTimer) clearTimeout(pollTimer);
        clearTimeout(sessionTimer);
        w.editvar = value == null ? "" : String(value);
        if (typeof w.showEditKey === "function") w.showEditKey(null);
        else if (typeof showEditKey1 === "function") showEditKey1(null);
    }

    function poll(): void {
        if (cancelled || !code) return;
        $.ajax({
            cache: false,
            contentType: "application/json",
            data: JSON.stringify({
                clientId: clientId,
                code: code,
                sessionToken: sessionToken,
            }),
            dataType: "json",
            error: function (jqXHR: any) {
                if (cancelled) return;
                var body: any = null;
                try {
                    body = jqXHR.responseJSON || JSON.parse(jqXHR.responseText);
                } catch (_e) {
                    /* ignore */
                }
                if (jqXHR.status === 401 || jqXHR.status === 403) {
                    showMsg(authErrorMessage(jqXHR.status, body), true);
                    return;
                }
                pollTimer = setTimeout(poll, POLL_MS);
            },
            headers: swopHeaders(clientId),
            success: function (data: ValResponse) {
                if (cancelled) return;
                var st = data && data.status;
                if (st === "waiting") {
                    pollTimer = setTimeout(poll, POLL_MS);
                } else if (st === "ready") {
                    returnToVkb(data.value != null ? String(data.value) : "");
                } else if (st === "gone") {
                    showMsg(_("Remote session expired"), true);
                } else {
                    pollTimer = setTimeout(poll, POLL_MS);
                }
            },
            timeout: 10000,
            type: "POST",
            url: base + wire.swopValuePath,
        });
    }

    var footerElement = document.getElementById("listPodval");
    if (footerElement)
        footerElement.innerHTML = renderButtonHint(
            keys.RETURN,
            strRETURN,
            "Close"
        );

    showMsg(_("Send request") + "...");
    w.editKey = function (key: number): boolean {
        if (key === keys.RETURN || key === keys.EXIT) {
            cleanup();
            if (typeof w.showEditKey === "function") w.showEditKey(null);
            else if (typeof showEditKey1 === "function") showEditKey1(null);
            return true;
        }
        return true;
    };

    var caption =
        (typeof w.editCaption === "string" && w.editCaption) ||
        _("Enter value");
    var draft = typeof w.editvar === "string" ? w.editvar : "";

    $.ajax({
        cache: false,
        contentType: "application/json",
        data: JSON.stringify({
            caption: caption,
            clientId: clientId,
            draft: draft,
        }),
        dataType: "json",
        error: function (jqXHR: any) {
            var body: any = null;
            try {
                body = jqXHR.responseJSON || JSON.parse(jqXHR.responseText);
            } catch (_e) {
                /* ignore */
            }
            showMsg(
                authErrorMessage(jqXHR.status || 0, body) ||
                    jqXHR.responseText ||
                    "error",
                true
            );
        },
        headers: swopHeaders(clientId),
        success: function (data: AuthenticatedSessionResponse) {
            if (cancelled) return;
            if (!data || !data.code) {
                showMsg(_("Error Code!"), true);
                return;
            }
            if (
                !clientId &&
                data.clientId &&
                validSwopClientId(data.clientId)
            ) {
                clientId = ensureDeviceClientId(data.clientId);
            }
            if (!clientId) {
                showMsg(_("Remote text entry returned no Device ID"), true);
                return;
            }
            code = String(data.code);
            sessionToken = data.sessionToken ? String(data.sessionToken) : "";
            var url =
                (data.url && String(data.url)) ||
                base + "/?c=" + encodeURIComponent(code);
            var color = curColor || "gold";
            var qrSvg = "";
            try {
                qrSvg = makeQrSvg(url, 240);
            } catch (_qrErr) {
                qrSvg = "";
            }
            showMsg(
                _("Request sended!") +
                    "<br/><br/>" +
                    _("For enter value open") +
                    '<br/><span style="font-size:larger;word-break:break-all;color:' +
                    color +
                    '">' +
                    escapeHtml(url) +
                    "</span><br/><br/>" +
                    (qrSvg
                        ? '<div style="margin:8px auto;padding:12px;background:#ffffff;display:inline-block;line-height:0;border-radius:4px">' +
                          qrSvg +
                          "</div><br/><br/>"
                        : "") +
                    _("and enter code") +
                    ' <span style="font-size:200%;color:' +
                    color +
                    '">' +
                    escapeHtml(code) +
                    "</span>",
                false,
                true
            );
            pollTimer = setTimeout(poll, 3000);
        },
        timeout: 10000,
        type: "POST",
        url: base + wire.swopSessionPath,
    });
}

/** Alias for OSK / window.loadValue wiring. */
export function remoteLoadValue(): void {
    swopLoadValue();
}

(window as any).swopLoadValue = swopLoadValue;
(window as any).remoteLoadValue = remoteLoadValue;
(window as any).ensureDeviceClientId = ensureDeviceClientId;
(window as any).applyLocalSwopConfig = applyLocalSwopConfig;
// OSK historically looked up window.loadValue for ♥™ — keep alias (not storage.loadValue).
(window as any).loadValue = swopLoadValue;

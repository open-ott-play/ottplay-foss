/**
 * Cloud settings helpers — upload/download settings via the
 * host_ott/swop/a.php service (STB firmware only).
 *
 * Moved from src/index.ts as a leaf module (Phase B).
 *
 * Edge case: Returns early if host_ott / host_ott_proto are not set
 * (non-STB environment).
 */

/**
 * Upload current settings to the cloud service (host_ott/swop/a.php).
 * Serialises all stb storage items as XML properties, POSTs them,
 * and displays a QR code + code for download on another device.
 *
 * Inner function cleanup() clears the 10-minute timeout and hides the
 * overlay.
 *
 * Side effects: AJAX POST; DOM mutations to #listAbout; sets
 * window.aboutKeyHandler.
 */
export function cloudSendSettings(): void {
    var w: any = window as any;
    /**
     * Cancel the cloud send operation and hide the about overlay.
     * Called on success, error, user cancel, or 10-minute timeout.
     */
    function cleanup(): void {
        clearTimeout(timer);
        if (typeof jQuery !== "undefined") jQuery("#listAbout").hide();
    }
    var timer = setTimeout(cleanup, 600000);
    if (
        typeof w.host_ott === "undefined" ||
        typeof w.host_ott_proto === "undefined"
    ) {
        if (typeof jQuery !== "undefined") {
            jQuery("#listAbout")
                .html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>Cloud save/load requires STB firmware (host_ott not set)</div>'
                )
                .show();
        }
        return;
    }
    if (typeof jQuery !== "undefined") {
        jQuery("#listAbout")
            .html(
                '<div style="text-align:center;font-size:larger;"><br/><br/>' +
                    (w._("Send settings") || "Send settings") +
                    "...</div>"
            )
            .show();
    }
    w.aboutKeyHandler = function (e: number): boolean {
        if (e === w.keys.RETURN || e === w.keys.EXIT) cleanup();
        return true;
    };
    var xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">\n<properties>\n<comment>OTT-Play Preferences</comment>';
    var items =
        typeof w.stbGetAllItems === "function" ? w.stbGetAllItems() : {};
    for (var prop in items) {
        if (Object.prototype.hasOwnProperty.call(items, prop))
            xml += '\n<entry key="' + prop + '">' + items[prop] + "</entry>";
    }
    xml += "\n</properties>";
    if (typeof jQuery !== "undefined") {
        jQuery.ajax({
            cache: false,
            data: { c: "send", d: xml },
            error: function (jqXHR: any) {
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                        jqXHR.responseText +
                        "</div>"
                );
            },
            success: function (data: any) {
                cleanup();
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;"><br/>' +
                        (w._("Settings sended!") || "Settings sended!") +
                        "<br/><br/>" +
                        (w._("For download settings file open") ||
                            "For download settings file open") +
                        '<br/><span style="font-size:larger;color:' +
                        w.curColor +
                        '">' +
                        w.host_ott +
                        "/swop</span> " +
                        (w._("and enter code") || "and enter code") +
                        ' <span style="font-size:larger;color:' +
                        w.curColor +
                        '">' +
                        data.code +
                        "</span><br/><br/>" +
                        (w._("or scan") || "or scan") +
                        ':<br/><br/><div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://' +
                        w.host_ott +
                        "/swop/?" +
                        data.code +
                        '" style="height:30%;"/></div></div>'
                );
            },
            timeout: 10000,
            type: "POST",
            url: w.host_ott_proto + w.host_ott + "/swop/a.php",
        });
    }
}

/**
 * Download settings from the cloud service by polling for a user-entered
 * code. Displays a QR code, polls the server every 5-10s, and when the
 * settings XML arrives, clears all current items and restores the received
 * values.
 *
 * Inner functions:
 * - cleanup(): Cancels polling and hides overlay.
 * - poll(): AJAX GET to check if code has been submitted.
 *
 * Side effects: AJAX POST/GET; DOM mutations to #listAbout; calls
 * stbClearAllItems() and stbSetItem() for each restored entry; calls
 * restart() on success.
 *
 * Edge case: Validates that the received XML contains the expected
 * "<comment>OTT-Play Preferences</comment>" marker.
 */
export function cloudLoadSettings(): void {
    var w: any = window as any;
    var cancelled = false;
    var code: string;
    /**
     * Cancel the cloud load operation and hide the about overlay.
     * Sets cancelled flag to stop polling.
     */
    function cleanup(): void {
        clearTimeout(timer);
        cancelled = true;
        if (typeof jQuery !== "undefined") jQuery("#listAbout").hide();
    }
    var timer = setTimeout(cleanup, 600000);
    if (
        typeof w.host_ott === "undefined" ||
        typeof w.host_ott_proto === "undefined"
    ) {
        if (typeof jQuery !== "undefined") {
            jQuery("#listAbout")
                .html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>Cloud save/load requires STB firmware (host_ott not set)</div>'
                )
                .show();
        }
        return;
    }
    /**
     * Poll the cloud server for the submitted settings code.
     * On 'forbidden' status, retries after 5s. On 'success', validates
     * the XML format and restores all settings.
     *
     * Side effects: AJAX POST; may call stbClearAllItems(), stbSetItem()
     * for each restored entry, and restart() on completion.
     */
    function poll(): void {
        if (cancelled) return;
        if (typeof jQuery !== "undefined") {
            jQuery.ajax({
                cache: false,
                data: { c: "get", d: code },
                error: function (jqXHR: any) {
                    if (typeof jQuery !== "undefined")
                        jQuery("#listAbout").html(
                            '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                                jqXHR.responseText +
                                "</div>"
                        );
                },
                success: function (data: any) {
                    if (cancelled) return;
                    if (data.status === "forbidden") setTimeout(poll, 5000);
                    else if (data.status === "success") {
                        var xml = data.data;
                        if (
                            xml.indexOf(
                                "<comment>OTT-Play Preferences</comment>"
                            ) !== -1
                        ) {
                            if (typeof jQuery !== "undefined")
                                jQuery("#listAbout").html(
                                    '<div style="text-align:center;font-size:200%;"><br/><br/>OTT-Play Preferences received!<br/>Restart player...</div>'
                                );
                            var entries = xml.split('<entry key="');
                            entries.shift();
                            try {
                                if (typeof w.stbClearAllItems === "function")
                                    w.stbClearAllItems();
                            } catch (e) {
                                console.error(e);
                            }
                            entries.forEach(function (entry: string) {
                                var parts = entry
                                    .split("</entry>")[0]
                                    .split('">');
                                if (typeof w.stbSetItem === "function")
                                    w.stbSetItem(parts[0], parts[1]);
                            });
                            if (typeof w.restart === "function") w.restart();
                        } else {
                            if (typeof jQuery !== "undefined")
                                jQuery("#listAbout").html(
                                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>File not OTT-Play Preferences!!!</div>'
                                );
                        }
                    }
                },
                timeout: 10000,
                type: "POST",
                url: w.host_ott_proto + w.host_ott + "/swop/a.php",
            });
        }
    }

    if (typeof jQuery !== "undefined") {
        jQuery.ajax({
            cache: false,
            data: { c: "get_code" },
            error: function (jqXHR: any) {
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                        jqXHR.responseText +
                        "</div>"
                );
            },
            success: function (data: any) {
                code = data.code;
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;"><br/>' +
                        (w._("Request sended!") || "Request sended!") +
                        "<br/><br/>" +
                        (w._("For upload settings file open") ||
                            "For upload settings file open") +
                        '<br/><span style="font-size:larger;color:' +
                        w.curColor +
                        '">' +
                        w.host_ott +
                        "/swop</span> " +
                        (w._("and enter code") || "and enter code") +
                        ' <span style="font-size:larger;color:' +
                        w.curColor +
                        '">' +
                        code +
                        "</span><br/><br/>" +
                        (w._("or scan") || "or scan") +
                        ':<br/><br/><div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://' +
                        w.host_ott +
                        "/swop/?" +
                        code +
                        '" style="height:30%;"/></div></div>'
                );
                setTimeout(poll, 10000);
            },
            timeout: 10000,
            type: "POST",
            url: w.host_ott_proto + w.host_ott + "/swop/a.php",
        });
    }
}

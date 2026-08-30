/**
 * Cloud settings synchronization for OTT-play FOSS
 * Handles upload/download of settings to/from cloud service (host_ott/swop/a.php)
 */

export function cloudSendSettings(): void {
    const w = window as any;

    function cleanup() {
        clearTimeout(timer);
        if (typeof jQuery !== "undefined") jQuery("#listAbout").hide();
    }
    const timer = setTimeout(cleanup, 600000);
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
            url: w.host_ott_proto + w.host_ott + "/swop/a.php",
            data: { c: "send", d: xml },
            type: "POST",
            timeout: 10000,
            cache: false,
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
            error: function (jqXHR: any) {
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                        jqXHR.responseText +
                        "</div>"
                );
            },
        });
    }
}

export function cloudLoadSettings(): void {
    const w = window as any;
    let cancelled = false;
    let code: string;

    function cleanup() {
        clearTimeout(timer);
        cancelled = true;
        if (typeof jQuery !== "undefined") jQuery("#listAbout").hide();
    }
    const timer = setTimeout(cleanup, 600000);
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
    function poll() {
        if (cancelled) return;
        if (typeof jQuery !== "undefined") {
            jQuery.ajax({
                url: w.host_ott_proto + w.host_ott + "/swop/a.php",
                data: { c: "get", d: code },
                type: "POST",
                timeout: 10000,
                cache: false,
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
                error: function (jqXHR: any) {
                    if (typeof jQuery !== "undefined")
                        jQuery("#listAbout").html(
                            '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                                jqXHR.responseText +
                                "</div>"
                        );
                },
            });
        }
    }
    if (typeof jQuery !== "undefined") {
        jQuery("#listAbout")
            .html(
                '<div style="text-align:center;font-size:larger;"><br/><br/>' +
                    (w._("Send request") || "Send request") +
                    "...</div>"
            )
            .show();
    }
    w.aboutKeyHandler = function (e: number): boolean {
        if (e === w.keys.RETURN || e === w.keys.EXIT) cleanup();
        return true;
    };
    if (typeof jQuery !== "undefined") {
        jQuery.ajax({
            url: w.host_ott_proto + w.host_ott + "/swop/a.php",
            data: { c: "get_code" },
            type: "POST",
            timeout: 10000,
            cache: false,
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
            error: function (jqXHR: any) {
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                        jqXHR.responseText +
                        "</div>"
                );
            },
        });
    }
}

export function attachCloudSettingsToWindow(): void {
    const w = window as any;
    w.cloudSendSettings = cloudSendSettings;
    w.cloudLoadSettings = cloudLoadSettings;
}

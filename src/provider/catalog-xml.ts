/** xml2json — Stefan Goessner / Creative Commons GNU LGPL 2.1.
 * Retained third-party DOM codec, isolated from retired provider transport helpers. */
function licensedXmlToJson(xml: any, tab: any): string {
    var X: any = {
        escape: function (txt: any): any {
            return txt
                .replace(/[\\]/g, "\\\\")
                .replace(/[\"]/g, '\\"')
                .replace(/[\n]/g, "\\n")
                .replace(/[\r]/g, "\\r");
        },
        innerXml: function (node: any): any {
            var s = "";
            if ("innerHTML" in node) s = node.innerHTML;
            else {
                var asXml = function (n: any): any {
                    var s = "";
                    if (n.nodeType == 1) {
                        s += "<" + n.nodeName;
                        for (var i = 0; i < n.attributes.length; i++)
                            s +=
                                " " +
                                n.attributes[i].nodeName +
                                '="' +
                                (n.attributes[i].nodeValue || "").toString() +
                                '"';
                        if (n.firstChild) {
                            s += ">";
                            for (var c = n.firstChild; c; c = c.nextSibling)
                                s += asXml(c);
                            s += "</" + n.nodeName + ">";
                        } else s += "/>";
                    } else if (n.nodeType == 3) s += n.nodeValue;
                    else if (n.nodeType == 4)
                        s += "<![CDATA[" + n.nodeValue + "]]>";
                    return s;
                };
                for (var c = node.firstChild; c; c = c.nextSibling)
                    s += asXml(c);
            }
            return s;
        },
        removeWhite: function (e: any): any {
            e.normalize();
            for (var n = e.firstChild; n; ) {
                if (n.nodeType == 3) {
                    if (!n.nodeValue.match(/[^ \f\n\r\t\v]/)) {
                        var nxt = n.nextSibling;
                        e.removeChild(n);
                        n = nxt;
                    } else n = n.nextSibling;
                } else if (n.nodeType == 1) {
                    X.removeWhite(n);
                    n = n.nextSibling;
                } else n = n.nextSibling;
            }
            return e;
        },
        toJson: function (o: any, name: any, ind: any): any {
            var json = name ? '"' + name + '"' : "";
            if (o instanceof Array) {
                for (var i = 0, n = o.length; i < n; i++)
                    o[i] = X.toJson(o[i], "", ind + "\t");
                json +=
                    (name ? ":[" : "[") +
                    (o.length > 1
                        ? "\n" +
                          ind +
                          "\t" +
                          o.join(",\n" + ind + "\t") +
                          "\n" +
                          ind
                        : o.join("")) +
                    "]";
            } else if (o == null) json += (name && ":") + "null";
            else if (typeof o == "object") {
                var arr: string[] = [];
                for (var m in o)
                    arr[arr.length] = X.toJson(o[m], m, ind + "\t");
                json +=
                    (name ? ":{" : "{") +
                    (arr.length > 1
                        ? "\n" +
                          ind +
                          "\t" +
                          arr.join(",\n" + ind + "\t") +
                          "\n" +
                          ind
                        : arr.join("")) +
                    "}";
            } else if (typeof o == "string")
                json += (name && ":") + '"' + o.toString() + '"';
            else json += (name && ":") + o.toString();
            return json;
        },
        toObj: function (xml: any): any {
            var o: any = {};
            if (xml.nodeType == 1) {
                if (xml.attributes.length)
                    for (var i = 0; i < xml.attributes.length; i++)
                        o["@" + xml.attributes[i].nodeName] = (
                            xml.attributes[i].nodeValue || ""
                        ).toString();
                if (xml.firstChild) {
                    var textChild = 0,
                        cdataChild = 0,
                        hasElementChild = false;
                    for (var n = xml.firstChild; n; n = n.nextSibling) {
                        if (n.nodeType == 1) hasElementChild = true;
                        else if (
                            n.nodeType == 3 &&
                            n.nodeValue.match(/[^ \f\n\r\t\v]/)
                        )
                            textChild++;
                        else if (n.nodeType == 4) cdataChild++;
                    }
                    if (hasElementChild) {
                        if (textChild < 2 && cdataChild < 2) {
                            X.removeWhite(xml);
                            for (
                                var n2 = xml.firstChild;
                                n2;
                                n2 = n2.nextSibling
                            ) {
                                if (n2.nodeType == 3)
                                    o["#text"] = X.escape(n2.nodeValue);
                                else if (n2.nodeType == 4)
                                    o["#cdata"] = X.escape(n2.nodeValue);
                                else if (o[n2.nodeName]) {
                                    if (o[n2.nodeName] instanceof Array)
                                        o[n2.nodeName][o[n2.nodeName].length] =
                                            X.toObj(n2);
                                    else
                                        o[n2.nodeName] = [
                                            o[n2.nodeName],
                                            X.toObj(n2),
                                        ];
                                } else o[n2.nodeName] = X.toObj(n2);
                            }
                        } else {
                            if (!xml.attributes.length)
                                o = X.escape(X.innerXml(xml));
                            else o["#text"] = X.escape(X.innerXml(xml));
                        }
                    } else if (textChild) {
                        if (!xml.attributes.length)
                            o = X.escape(X.innerXml(xml));
                        else o["#text"] = X.escape(X.innerXml(xml));
                    } else if (cdataChild) {
                        if (cdataChild > 1) o = X.escape(X.innerXml(xml));
                        else
                            for (
                                var n3 = xml.firstChild;
                                n3;
                                n3 = n3.nextSibling
                            )
                                o = X.escape(n3.nodeValue);
                    }
                }
                if (!(xml.attributes.length || xml.firstChild)) o = null;
            } else if (xml.nodeType == 9) o = X.toObj(xml.documentElement);
            return o;
        },
    };
    if (xml.nodeType == 9) xml = xml.documentElement;
    var json = X.toJson(X.toObj(X.removeWhite(xml)), xml.nodeName, "\t");
    return (
        "{\n" +
        tab +
        (tab ? json.replace(/\t/g, tab) : json.replace(/\t|\n/g, "")) +
        "\n}"
    );
}

/** DOM decoding is a host effect; the media session receives plain catalog data. */
function decodeProviderCatalogXml(
    host: any,
    text: string,
    profile?: string
): any {
    if (profile !== "m3u") {
        var query = host.jQuery || host.$;
        return JSON.parse(licensedXmlToJson(query.parseXML(text), " "));
    }
    function parse(value: string): any {
        var document = new host.DOMParser().parseFromString(value, "text/xml");
        return document.querySelector("parsererror") ? null : document;
    }
    var document = parse(text);
    if (!document) {
        var entity = host.document.createElement("textarea");
        text = text.replace(/&[a-z0-9]+;/gi, function (value) {
            entity.innerHTML = value;
            return "&#" + entity.textContent.charCodeAt(0) + ";";
        });
        document = parse(text);
    }
    if (!document) {
        text = text.replace(
            /(title|description)>([^<>\n]+)</gi,
            function (_all, tag, value) {
                return tag + "><![CDATA[" + value + "]]><";
            }
        );
        document = parse(text);
    }
    if (!document) throw new Error("Error: Cannot parse fXML!");
    var result: any = { channels: [] };
    var fields = [
        "search_on",
        "adult",
        "title",
        "logo_30x30",
        "description",
        "playlist_url",
        "stream_url",
    ];
    var headings = ["playlist_name", "title", "next_page_url", "prev_page_url"];
    function append(node: any): void {
        if (node.tagName !== "channel" && node.tagName !== "menu") return;
        var record: any = { t: node.tagName };
        var found = false;
        for (
            var child = node.firstElementChild;
            child;
            child = child.nextElementSibling
        ) {
            if (fields.indexOf(child.tagName) === -1) continue;
            record[child.tagName] = child.textContent;
            found = true;
        }
        if (!found) return;
        if (!record.title) record.title = "<Без названия>";
        result.channels.push(record);
    }
    var first = document.documentElement;
    if (first && first.tagName === "items") first = first.firstElementChild;
    for (var node = first; node; node = node.nextElementSibling) {
        if (headings.indexOf(node.tagName) !== -1)
            result[node.tagName] = node.textContent;
        if (node.tagName === "channels" || node.tagName === "menu")
            for (
                var entry = node.firstElementChild;
                entry;
                entry = entry.nextElementSibling
            )
                append(entry);
        append(node);
    }
    if (!result.channels.length) throw new Error("Error: Bad fXML!");
    return result;
}

(window as any).__ottCatalogXml = { decode: decodeProviderCatalogXml };

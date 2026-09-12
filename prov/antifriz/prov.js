version += " antifriz-0906";
var key, mpeg;
p_pref = "az";
parental = /XXX|Взрослые|Для взрослых|Эротика|18\+|Adults/i;
mp4 = false;

if (typeof stbGetItem === "function") {
    providerGetItem = function (e) {
        return stbGetItem(p_pref + e);
    };
    providerSetItem = function (e, r) {
        stbSetItem(p_pref + e, r);
    };
} else {
    providerGetItem = function (e) {
        return localStorage.getItem(p_pref + e);
    };
    providerSetItem = function (e, r) {
        localStorage.setItem(p_pref + e, r);
    };
}
providerDelItem = function (e) {
    return ottpStorage.del(p_pref + e);
};
providerHasItem = function (e) {
    return ottpStorage.has(p_pref + e);
};
providerHasItemValue = function (e) {
    return ottpStorage.hasValue(p_pref + e);
};

function _getParams() {
    key = providerGetItem("key") || "";
    mpeg = parseInt(providerGetItem("mpeg"), 10) || 0;
}

function getChannelPicon(ch_id) {
    return chanels[ch_id] ? chanels[ch_id].logo || "" : "";
}

function getServ(ch_id) {
    return chanels[ch_id] ? chanels[ch_id].server : "";
}

var __hls = navigator.userAgent.indexOf("Tizen") === -1 ? 0 : 2;

function getChannelUrl(ch_id) {
    var _m = mpeg || __hls;
    return (
        "http://" +
        getServ(ch_id) +
        ":80/" +
        ch_id +
        "/" +
        ["index.m3u8", "mpegts", "video.m3u8", "mono.m3u8", "index.mpd"][_m] +
        "?token=" +
        chanels[ch_id].token
    );
}

function getArchiveUrl(ch_id, time, time_to) {
    var _m = mpeg || __hls;
    if (time_to < time) time_to = Date.now() / 1000 + 600;
    if (_m == 1 || time > Date.now() / 1000 - 600)
        return (
            "http://" +
            getServ(ch_id) +
            ":80/" +
            ch_id +
            "/" +
            [
                "timeshift_abs-",
                "timeshift_abs/",
                "video-timeshift_abs-",
                "mono-timeshift_abs-",
                "timeshift_abs-",
            ][_m] +
            Math.floor(time) +
            [".m3u8", "", ".m3u8", ".m3u8", ".mpd"][_m] +
            "?token=" +
            chanels[ch_id].token
        );
    if (browserName() == "dune") time_to = Math.floor(time_to) + 7200;
    return (
        "http://" +
        getServ(ch_id) +
        ":80/" +
        ch_id +
        "/" +
        ["index-", "", "video-", "mono-", "index-"][_m] +
        Math.floor(time) +
        "-" +
        Math.floor(time_to - time) +
        [".m3u8", "", ".m3u8", ".m3u8", ".mpd"][_m] +
        "?token=" +
        chanels[ch_id].token
    );
}

if (typeof catsArray == "undefined") var catsArray = [];

function addChan2cat(cat, ci) {
    if (!(cat && ci)) return;
    if (!cats[cat]) {
        catsArray.push(cat);
        cats[cat] = [];
    }
    cats[cat].push(ci);
}

function getAttribute(text, attribute) {
    var a = text.split(attribute + "=");
    if (a.length == 1 || a[1].length == 0) return "";
    if (a[1][0] == '"') return a[1].split('"')[1] || "";
    return a[1].split(/[ ,]+/)[0] || "";
}

function getChanelsArray(callback) {
    _getParams();

    function loadPlaylist(url, success, cb) {
        if (typeof launch_id == "undefined") launch_id = "#launch";
        if (!url) {
            cb();
            return;
        }
        var cpurl = url;
        if (typeof stbInterceptRequest === "function") {
            stbInterceptRequest(url);
            url +=
                (url.indexOf("?") == -1 ? "?" : "&") +
                "url=" +
                encodeURIComponent(url);
        }
        $.ajax({
            dataType: "text",
            error: function () {
                $(launch_id).append("p...");
                $.ajax({
                    data: { url: "@" + cpurl },
                    dataType: "text",
                    error: function (jqXHR, textStatus, errorThrown) {
                        console.log(
                            "channels : jqXHR:" +
                                JSON.stringify(jqXHR) +
                                "; textStatus: " +
                                textStatus +
                                ", errorThrown: " +
                                errorThrown
                        );
                        alert(_("Failed to load channel list!"));
                        cb();
                    },
                    method: "post",
                    success: success,
                    timeout: 30000,
                    url: host + "/m3u/cp.php",
                });
            },
            success: success,
            timeout: 30000,
            url: url,
        });
    }

    function aSuccess(data) {
        try {
            cList = [];
            chanels = {};
            cats = {};
            catsArray = [];
            var arrEXTINF = data.split("#EXTINF:");
            arrEXTINF.shift();
            arrEXTINF.forEach(function (val) {
                var e = val.split(","),
                    cat = getAttribute(e[0], "group-title"),
                    rec = parseInt(getAttribute(e[0], "tvg-rec"), 10) || 0,
                    epg = getAttribute(e[0], "tvg-id"),
                    logo = getAttribute(e[0], "tvg-logo").replace(
                        "https:",
                        "http:"
                    ),
                    e1 = e[1].split("\n"),
                    cn = e1[0],
                    url = e1[2] || e1[1] || "",
                    parts = url.split("/"),
                    ci = (parts[5] || "").split(".")[0],
                    serv = (parts[2] || "").split(":")[0],
                    token = parts[4] || "";
                if (!ci || !url) return;
                addChan2cat(cat, ci);
                if (cList.indexOf(ci) == -1) {
                    cList.push(ci);
                    chanels[ci] = {
                        category: {
                            class: catsArray.indexOf(cat) + 2,
                            name: cat,
                        },
                        channel_name: cn,
                        epg: epg,
                        epg_id: epg,
                        logo: logo,
                        rec: rec * 24,
                        server: serv,
                        time: 0,
                        time_to: 0,
                        token: token,
                        url: url,
                    };
                }
            });
            if (key.length != 8) {
                try {
                    popupList(popupActions.indexOf(noProvParam) + 1);
                } catch (ex) {}
                infoBox(
                    "Для доступа необходимо ввести ключ! (Ключ доступа для приложений - 8 символов)"
                );
            }
        } catch (e) {
            console.log(
                "Exception: name " +
                    e.name +
                    ", message " +
                    e.message +
                    ", typeof " +
                    typeof e
            );
            alert(_("Failed to load channel list!"));
        }
        callback();
    }

    if (key.length != 8) {
        try {
            popupList(popupActions.indexOf(noProvParam) + 1);
        } catch (ex) {}
        infoBox(
            "Для доступа необходимо ввести ключ! (Ключ доступа для приложений - 8 символов)"
        );
        callback();
        return;
    }

    loadPlaylist(
        "http://af-play.com/playlist/" + key + ".m3u8",
        aSuccess,
        callback
    );
}

if (typeof sNextCount == "undefined") sNextCount = -1;

function _getEPGchanel(ch_id, callback, all) {
    var d = [];
    var epgId = chanels[ch_id]
        ? chanels[ch_id].epg_id || chanels[ch_id].epg || ""
        : "";
    if (!epgId) {
        callback(ch_id, d);
        return;
    }
    $.ajax({
        cache: false,
        complete: function () {
            callback(ch_id, d);
        },
        dataType: "json",
        success: function (data) {
            if (data)
                data.forEach(function (val) {
                    d.push({
                        descr: val.descr,
                        name: val.name,
                        time: val.time,
                        time_to: val.time_to,
                    });
                });
        },
        timeout: 30000,
        url:
            "http://protected-api.com/epg/" +
            (all
                ? epgId + "?date="
                : "current/" + epgId + "?num=" + (sNextCount + 1)),
    });
}

function getEPGchanel(ch_id, callback) {
    _getEPGchanel(ch_id, callback, true);
}

function getEPGchanelCur(ch_id, callback) {
    _getEPGchanel(ch_id, callback, false);
}

/* xml2json — Stefan Goessner / Creative Commons GNU LGPL 2.1 */
function xml2json1(xml, tab) {
    var X = {
        escape: function (txt) {
            return txt
                .replace(/[\\]/g, "\\\\")
                .replace(/[\"]/g, '\\"')
                .replace(/[\n]/g, "\\n")
                .replace(/[\r]/g, "\\r");
        },
        innerXml: function (node) {
            var s = "";
            if ("innerHTML" in node) s = node.innerHTML;
            else {
                var asXml = function (n) {
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
        removeWhite: function (e) {
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
        toJson: function (o, name, ind) {
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
                var arr = [];
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
        toObj: function (xml) {
            var o = {};
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
                            for (var n = xml.firstChild; n; n = n.nextSibling) {
                                if (n.nodeType == 3)
                                    o["#text"] = X.escape(n.nodeValue);
                                else if (n.nodeType == 4)
                                    o["#cdata"] = X.escape(n.nodeValue);
                                else if (o[n.nodeName]) {
                                    if (o[n.nodeName] instanceof Array)
                                        o[n.nodeName][o[n.nodeName].length] =
                                            X.toObj(n);
                                    else
                                        o[n.nodeName] = [
                                            o[n.nodeName],
                                            X.toObj(n),
                                        ];
                                } else o[n.nodeName] = X.toObj(n);
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
                            for (var n = xml.firstChild; n; n = n.nextSibling)
                                o = X.escape(n.nodeValue);
                    }
                }
                if (!xml.attributes.length && !xml.firstChild) o = null;
            } else if (xml.nodeType == 9) {
                o = X.toObj(xml.documentElement);
            }
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

function getMediaArrayXML(murl, callback) {
    mediaUrls[mediaUrls.length - 1] = murl;
    if (murl === "") {
        callback();
        return;
    }
    $("#dialogbox")
        .html(
            '<img src="' +
                host +
                '/stbPlayer/buffering.gif" height="40"> ' +
                _("Download! Wait ...")
        )
        .show();
    if (typeof box_mac !== "undefined" && box_mac)
        murl +=
            (murl.indexOf("?") == -1 ? "?" : "&") +
            "box_client=ott-foss&box_mac=" +
            box_mac;
    $.ajax({
        complete: function () {
            if (callback.isCurrent && !callback.isCurrent()) return;
            $("#dialogbox").hide();
            callback();
        },
        dataType: "text",
        success: function (data) {
            if (callback.isCurrent && !callback.isCurrent()) return;
            try {
                var i = data.indexOf("<?xml");
                if (i !== -1) {
                    if (i > 0) data = data.substr(i);
                    var jj;
                    try {
                        data = xml2json1(jQuery.parseXML(data), " ");
                    } catch (e) {
                        alert("Error XML !!!");
                        return;
                    }
                } else {
                    i = data.indexOf("#EXTM3U");
                    if (i !== -1) {
                        getMediaArrayEXTM3U(data);
                        return;
                    }
                }
                try {
                    jj = JSON.parse(data);
                } catch (e) {
                    alert("Error JSON !!!");
                    return;
                }
                if (jj.items) jj = jj.items;
                mediaName = jj.playlist_name || jj.title || mediaName || "?";
                var cc = jj.channel || jj.channels;
                mediaRecords = !cc ? [] : Array.isArray(cc) ? cc : [cc];
                if (jj.next_page_url)
                    mediaRecords.push({
                        description: "...",
                        logo_30x30: "",
                        playlist_url: jj.next_page_url,
                        title: "...",
                    });
            } catch (e) {
                console.log(e);
            }
        },
        timeout: 60000,
        url: murl,
    });
}

function getMediaArrayEXTM3U(data) {
    function item2descr(n, i) {
        return (
            "<table>" +
            "<h2><center>" +
            n +
            "</center></h2>" +
            (i
                ? '<img id="detal" height="285" src="' +
                  i +
                  '" style="float: left; margin-right: 5px; margin-bottom: 5px; border-width: 0px; border-style: solid;" width="210">'
                : "") +
            "</table>"
        );
    }
    try {
        mediaName = mediaName || "?";
        mediaRecords = [];
        var arrEXTINF = data.split("#EXTINF:");
        arrEXTINF.shift();
        arrEXTINF.forEach(function (val) {
            var e = val.split("\n");
            var logo = getAttribute(e[0], "tvg-logo");
            var cn = "??? Нет названия";
            try {
                cn = e[0].split(",")[1].trim();
            } catch (ex) {}
            var url = "",
                n = 1;
            try {
                url = e[1].trim();
            } catch (ex) {}
            while (url.indexOf("#") === 0) {
                try {
                    url = e[++n].trim();
                } catch (ex) {
                    url = "";
                }
            }
            if (url)
                mediaRecords.push({
                    description: item2descr(cn, logo),
                    logo_30x30: logo,
                    stream_url: url,
                    title: cn,
                });
        });
    } catch (e) {
        alert("Error M3U !!!");
    }
}

function getMediaArray(murl, callback) {
    _getParams();
    if (murl === "") murl = "http://media.af-play.com/" + key + ".xml";
    getMediaArrayXML(murl, callback);
}

var cbTarr = ["HLS", "MPEGTS"];

function duneAddSettings(ind) {
    if (isNaN(parseInt(providerGetItem("sShowArchive"), 10)))
        providerSetItem("sShowArchive", 1);
    _getParams();
    popupArray.splice(ind, 0, "Ключ доступа", "Тип потоков: " + cbTarr[mpeg]);
    popupDetail.splice(
        ind,
        0,
        "Ввод ключа доступа для приложений",
        "Выберите тип потоков: HLS или MPEGTS"
    );
    popupActions.splice(ind, 0, doEditKey, doEditType);
}

function doEditKey() {
    editCaption = "Редактирование ключа доступа для приложений";
    editvar = key;
    setEdit = function () {
        if (key == editvar) return;
        if (editvar.length != 8) {
            alert(
                "Для доступа необходимо ввести ключ! (Ключ доступа для приложений - 8 символов)"
            );
            showEditKey([0, 1, 2]);
            return;
        }
        providerSetItem("key", editvar);
        restart();
    };
    showEditKey([0, 1, 2]);
}

function doEditType() {
    if (++mpeg == 2) mpeg = 0;
    providerSetItem("mpeg", mpeg);
    popupArray[popupActions.indexOf(doEditType)] =
        "Тип потоков: " + cbTarr[mpeg];
    popupList(doEditType);
    if (!playType) playChannel(catIndex, primaryIndex);
    else if (playType > 0) playArchive(playType + playTime);
}

_getParams();

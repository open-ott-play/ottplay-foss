version += " kbc-0906";
p_pref = "kbc";
parental = /XXX|Взрослые|Для взрослых|Эротика|18\+|ХХХ|Adults/i;
sPlayers = 0;

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

function _scheme() {
    if (typeof scheme === "string" && scheme) return scheme;
    try {
        if (
            typeof window !== "undefined" &&
            window.location &&
            window.location.protocol &&
            window.location.protocol.indexOf("http") === 0
        ) {
            return window.location.protocol + "//";
        }
    } catch (e) {}
    return "https://";
}

function getChannelPicon(ch_id) {
    return chanels[ch_id] ? chanels[ch_id].logo || "" : "";
}

function getChannelUrl(ch_id) {
    return chanels[ch_id] ? chanels[ch_id].url || "" : "";
}

function getArchiveUrl(ch_id, time, time_to) {
    function insPar(u) {
        return u
            .replace(/\$\{start\}/g, Math.floor(time))
            .replace(/\$\{end\}/g, Math.floor(time_to))
            .replace(/\$\{timestamp\}/g, Math.floor(Date.now() / 1000))
            .replace(
                /\$\{offset\}/g,
                Math.floor(Date.now() / 1000) - Math.floor(time)
            )
            .replace(/\$\{duration\}/g, Math.floor(time_to - time));
    }
    if (time_to < time) time_to = Date.now() / 1000;
    if (browserName() == "dune") time_to += 7200;
    if (chanels[ch_id].ca && chanels[ch_id].ca.indexOf("flussonic") != -1) {
        var spl = "",
            ts_hls = 0,
            url = chanels[ch_id].url;
        if (url.indexOf("mpegts") != -1) {
            spl = "mpegts";
            ts_hls = 0;
        } else if (url.indexOf("video.m3u8") != -1) {
            spl = "video.m3u8";
            ts_hls = 1;
        } else if (url.indexOf("index.m3u8") != -1) {
            spl = "index.m3u8";
            ts_hls = 2;
        } else if (url.indexOf("index.mpd") != -1) {
            spl = "index.mpd";
            ts_hls = 3;
        }
        if (spl) {
            var u = url.split(spl);
            if (!ts_hls || time > Date.now() / 1000 - 600)
                return (
                    u[0] +
                    [
                        "timeshift_abs/",
                        "timeshift_abs_video-",
                        "timeshift_abs-",
                        "timeshift_abs-",
                    ][ts_hls] +
                    Math.floor(time) +
                    ["", ".m3u8", ".m3u8", ".mdp"][ts_hls] +
                    u[1]
                );
            return (
                u[0] +
                ["", "video-", "index-", "archive-"][ts_hls] +
                Math.floor(time) +
                "-" +
                Math.floor(time_to - time) +
                ["", ".m3u8", ".m3u8", ".mdp"][ts_hls] +
                u[1]
            );
        }
    }
    if (chanels[ch_id].caso)
        switch (chanels[ch_id].ca) {
            case "append":
                return insPar(chanels[ch_id].url + chanels[ch_id].caso);
            default:
                return insPar(chanels[ch_id].caso);
        }
    var c = chanels[ch_id].url.indexOf("?") == -1 ? "?" : "&";
    return (
        chanels[ch_id].url +
        c +
        "utc=" +
        Math.floor(time) +
        "&lutc=" +
        Math.floor(Date.now() / 1000)
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

function getAint(text, attribute) {
    return parseInt(getAttribute(text, attribute), 10) || 0;
}

function getChanelsArray(callback) {
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
                    error: function () {
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

    function getEpgList(cepg, cb) {
        if (!cList.length) {
            cb();
            return;
        }
        $(launch_id).append(_("epgs..."));
        $.ajax({
            complete: function () {
                cb();
            },
            data: { list: JSON.stringify(cepg) },
            method: "post",
            success: function (data) {
                if (data)
                    cList.forEach(function (val) {
                        if (data[val]) chanels[val].epg_url = data[val];
                    });
            },
            timeout: 120000,
            url: _scheme() + "epg.drm-play.com/m3u/gelist.php",
        });
    }

    function getLogoList(cepg, cb) {
        if (!cList.length) {
            cb();
            return;
        }
        $(launch_id).append(_("logos..."));
        $.ajax({
            complete: function () {
                cb();
            },
            data: { list: JSON.stringify(cepg) },
            method: "post",
            success: function (data) {
                if (data)
                    cList.forEach(function (val) {
                        if (data[val]) chanels[val].logo = data[val];
                    });
            },
            timeout: 120000,
            url: _scheme() + "epg.drm-play.com/m3u/geicons.php",
        });
    }

    function aSuccess(data) {
        var ccat = "",
            cepg = {},
            clogo = false;
        try {
            cList = [];
            chanels = {};
            cats = {};
            catsArray = [];
            var arrEXTINF = data.split("#EXTINF:"),
                l1 = arrEXTINF[0],
                g_utvg = "kbc",
                gRec =
                    l1.indexOf("catchup-days") > -1
                        ? getAint(l1, "catchup-days") * 24
                        : l1.indexOf("timeshift") > -1
                          ? getAint(l1, "timeshift") * 24
                          : l1.indexOf("tvg-rec") > -1
                            ? getAint(l1, "tvg-rec") * 24
                            : "",
                gC =
                    getAttribute(l1, "catchup") ||
                    getAttribute(l1, "catchup-type"),
                gCS = getAttribute(l1, "catchup-source");
            arrEXTINF.shift();
            arrEXTINF.forEach(function (val) {
                var e = val.split("\n"),
                    drm = getAttribute(e[0], "drm"),
                    cat = getAttribute(e[0], "group-title"),
                    epg = getAttribute(e[0], "tvg-id"),
                    tn = getAttribute(e[0], "tvg-name"),
                    logo = getAttribute(e[0], "tvg-logo");
                logo =
                    logo.indexOf("//") === 0 ||
                    logo.toLowerCase().indexOf("http") === 0
                        ? logo
                        : "";
                var rec =
                        e[0].indexOf("catchup-days") > -1
                            ? getAint(e[0], "catchup-days") * 24
                            : e[0].indexOf("timeshift") > -1
                              ? getAint(e[0], "timeshift") * 24
                              : e[0].indexOf("tvg-rec") > -1
                                ? getAint(e[0], "tvg-rec") * 24
                                : gRec,
                    ca =
                        getAttribute(e[0], "catchup") ||
                        getAttribute(e[0], "catchup-type") ||
                        gC,
                    caso = getAttribute(e[0], "catchup-source") || gCS,
                    utvg = getAttribute(e[0], "url-tvg") || g_utvg,
                    cn = _("??? No channel name"),
                    url = "",
                    n = 1;
                try {
                    var comma = e[0].indexOf(",");
                    cn = comma > 0 ? e[0].substr(comma + 1).trim() : cn;
                } catch (ex) {}
                try {
                    url = e[1].trim();
                } catch (ex) {}
                while (url.indexOf("#") === 0) {
                    if (url.indexOf("#EXTGRP:") != -1)
                        if (!cat) cat = url.split("#EXTGRP:")[1].trim();
                    try {
                        url = e[++n].trim();
                    } catch (ex) {
                        url = "";
                    }
                }
                if (cat == "") cat = ccat;
                else ccat = cat;
                var url_m = url.split("?");
                var ci = murmurhash3_32_gc(url_m[0], 10);
                addChan2cat(cat, ci);
                if (url && cList.indexOf(ci) == -1) {
                    cList.push(ci);
                    chanels[ci] = {
                        ca: ca,
                        caso: caso,
                        category: {
                            class: catsArray.indexOf(cat) + 2,
                            name: cat,
                        },
                        channel_name: cn,
                        drm: drm,
                        epg: epg,
                        logo: logo,
                        rec: rec,
                        time: 0,
                        time_to: 0,
                        tn: tn,
                        url: url,
                        utvg: utvg,
                    };
                    if (epg && utvg)
                        cepg[ci] = { e: epg, n: tn || cn, u: utvg };
                    else if (utvg) cepg[ci] = { n: cn, u: utvg };
                    else cepg[ci] = { n: tn || cn };
                    if (!logo) {
                        if (!clogo) clogo = {};
                        var tn_l = tn + "|" + utvg,
                            cn_l = cn + "|" + utvg;
                        clogo[ci] = utvg ? cn_l || tn_l : tn || cn;
                    }
                }
            });
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
        getEpgList(cepg, function () {
            try {
                if (
                    typeof curList !== "undefined" &&
                    curList &&
                    curList[primaryIndex] &&
                    chanels[curList[primaryIndex]]
                ) {
                    chanels[curList[primaryIndex]].time_request = 0;
                    updateChanelInfo(curList[primaryIndex]);
                }
            } catch (ex) {}
        });
        if (clogo)
            getLogoList(clogo, function () {
                try {
                    if (
                        typeof curList !== "undefined" &&
                        curList &&
                        curList[primaryIndex]
                    )
                        updateChanelInfo(curList[primaryIndex]);
                } catch (ex) {}
            });
    }

    if (!box_mac) {
        alert(_("Device MAC is required for KBC (Kinoboom) playlists"));
        callback();
        return;
    }
    var playlistUrl = "";
    if (v_list == 0)
        playlistUrl =
            "http://kb-team.club/?do=/plugin&id=iptvkino&m3u&box_mac=" +
            box_mac;
    else if (v_list == 1)
        playlistUrl =
            "http://kb-team.club/?do=/plugin&bid=federaltv&m3u&box_mac=" +
            box_mac;
    else if (v_list == 2)
        playlistUrl =
            "http://kb-team.club/?do=/plugin&bid=iptvk&m3u&box_mac=" + box_mac;
    loadPlaylist(playlistUrl, aSuccess, callback);
}

function getEPGurl(ch_id) {
    return chanels[ch_id] ? chanels[ch_id].epg_url : null;
}

var _epgDomen = null;
function getEPGchanel(ch_id, callback) {
    if (!_epgDomen) _epgDomen = _scheme() + "epg.drm-play.com/";
    var d = null,
        epg_url = getEPGurl(ch_id);
    if (!epg_url) {
        callback(ch_id, d);
        return;
    }
    $.ajax({
        complete: function () {
            callback(ch_id, d);
        },
        dataType: "json",
        success: function (data) {
            if (data !== null) d = data.epg_data;
        },
        timeout: 10000,
        url: _epgDomen + encodeURIComponent(epg_url) + ".json",
    });
}

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
            "box_client=ott-play&box_mac=" +
            box_mac;
    $.ajax({
        complete: function () {
            $("#dialogbox").hide();
            callback();
        },
        dataType: "text",
        success: function (data) {
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
            var cn = _("??? No channel name");
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

var getMediaArray = function (murl, callback) {
    if (murl === "") murl = "http://89.163.215.125";
    getMediaArrayXML(murl, callback);
};

var box_mac = "",
    edTlist = ["IPTV #1", "IPTV #2", "IPTV #3"];
p_pref = "kbc";
var v_list = parseInt(providerGetItem("v_list"), 10) || 0;

function _m3u2popup() {
    var b = _("Load:") + " " + edTlist[v_list];
    popupArray[popupActions.indexOf(doEditList)] =
        _("Built-in playlist:") + " " + edTlist[v_list];
    popupArray[popupActions.indexOf(loadVlist)] = b;
}

function duneAddSettings(ind) {
    try {
        if (
            typeof AndroidInterface !== "undefined" &&
            typeof AndroidInterface.getMac === "function"
        ) {
            if (AndroidInterface.getMac() == "02:00:00:00:00:00") {
                stb.getMacAddress = function () {
                    var m = stbGetItem("mac") || "";
                    if (!m) {
                        m = "44:5c:e9:XX:XX:XX".replace(/X/g, function () {
                            return "0123456789abcdef".charAt(
                                Math.floor(Math.random() * 16)
                            );
                        });
                        stbSetItem("mac", m);
                    }
                    return m;
                };
            }
        }
    } catch (e) {}

    box_mac = stb.getMacAddress().replace(/:/g, "");
    p_pref = "kbc";
    v_list = parseInt(providerGetItem("v_list"), 10) || 0;
    p_pref = "kbc" + v_list;
    if (isNaN(parseInt(providerGetItem("sShowArchive"), 10))) {
        providerSetItem("sShowArchive", 1);
    }
    if (isNaN(parseInt(stbGetItem("sNoSmall"), 10))) {
        stbSetItem("sNoSmall", 1);
        sNoSmall = 1;
    }
    box_mac = box_mac.toLowerCase();
    popupArray.splice(ind, 1, "", "", _("KBC (Kinoboom) access data"));
    popupDetail.splice(
        ind,
        1,
        _("Built-in playlists"),
        _("Load built-in playlist:") + " " + edTlist[v_list],
        _("KBC (Kinoboom) access data")
    );
    popupActions.splice(ind, 1, doEditList, loadVlist, doUserInfo);
    _m3u2popup();
}

function doEditList() {
    if (++v_list == edTlist.length) v_list = 0;
    _m3u2popup();
    popupList(doEditList);
}

function loadVlist() {
    p_pref = "kbc";
    providerSetItem("v_list", v_list);
    p_pref = "kbc" + v_list;
    providerSetItem("v_list", v_list);
    if (isNaN(parseInt(providerGetItem("sShowArchive"), 10)))
        providerSetItem("sShowArchive", 1);
    _m3u2popup();
    loadChannels();
}

function doUserInfo() {
    saveCPD();
    listCaption.innerHTML = _("KBC (Kinoboom) access data");
    aboutKeyHandler = function () {
        restoreCPD();
        $("#listAbout").hide();
        return true;
    };
    $("#listAbout").html(_("Loading. Please wait...")).show();
    $.ajax({
        dataType: "json",
        error: function (jqXHR, textStatus, errorThrown) {
            $("#listAbout").html(
                _("ERROR!") +
                    "<br/><br/>jqXHR:" +
                    JSON.stringify(jqXHR) +
                    "<br/>textStatus: " +
                    textStatus +
                    "<br/>errorThrown: " +
                    errorThrown
            );
        },
        success: function (data) {
            if (data && data.title == "KinoBoom User Info" && data.channels) {
                var s = "";
                data.channels.forEach(function (val) {
                    if (val.title != "Speedtest") s += val.title + "<br/>";
                });
                $("#listAbout").html(s);
            } else $("#listAbout").html(_("Failed to get user data!!!"));
        },
        timeout: 5000,
        url:
            "http://kb-team.club/info.php?box_client=ott-play&box_mac=" +
            box_mac,
    });
}

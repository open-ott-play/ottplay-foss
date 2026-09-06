version += " edem-0220";
var edkey,
    edlist,
    vpurl,
    edurl,
    edsp,
    edcdn,
    provName = "Edem.tv / iLook.tv";
p_pref = "ed";
parental = /XXX|Взрослые|Для взрослых|Эротика|18\+|Adults|взрослые/i;

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
    return typeof scheme === "string" && scheme ? scheme : "http://";
}

function _getParams() {
    edkey = providerGetItem("key") || "";
    edlist = parseInt(providerGetItem("list"), 10) || 0;
    vpurl = providerGetItem("vpurl") || "";
    edurl = providerGetItem("edurl") || "";
    edsp = parseInt(providerGetItem("edsp"), 10) || 0;
    edcdn = providerGetItem("edcdn") || "drmplay.rostelekom.xyz";
}

function getChannelPicon(ch_id) {
    return chanels[ch_id] ? chanels[ch_id].logo || "" : "";
}

function getChannelUrl(ch_id) {
    if (edsp == 1) {
        return chanels[ch_id] ? chanels[ch_id].url || "" : "";
    }
    var url = chanels[ch_id] ? chanels[ch_id].url || "" : "";
    if (url) {
        return url
            .replace("localhost", edcdn || "drmplay.rostelekom.xyz")
            .replace("00000000000000", edkey || "1");
    }
    return (
        "http://" +
        (edcdn || "drmplay.rostelekom.xyz") +
        "/iptv/" +
        (edkey || "1") +
        "/" +
        ch_id +
        "/index.m3u8"
    );
}

function getArchiveUrl(ch_id, time, time_to) {
    return (
        getChannelUrl(ch_id) +
        "?utc=" +
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

function murmurhash3_32_gc(key, seed) {
    var remainder, bytes, h1, h1b, c1, c2, k1, i;
    remainder = key.length & 3;
    bytes = key.length - remainder;
    h1 = seed;
    c1 = 0xcc9e2d51;
    c2 = 0x1b873593;
    i = 0;
    while (i < bytes) {
        k1 =
            (key.charCodeAt(i) & 0xff) |
            ((key.charCodeAt(++i) & 0xff) << 8) |
            ((key.charCodeAt(++i) & 0xff) << 16) |
            ((key.charCodeAt(++i) & 0xff) << 24);
        ++i;
        k1 =
            (((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) &
                0xffffffff) >>>
            0;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 =
            (((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) &
                0xffffffff) >>>
            0;
        h1 ^= k1;
        h1 = (h1 << 13) | (h1 >>> 19);
        h1b =
            (((h1 & 0xffff) * 5 + ((((h1 >>> 16) * 5) & 0xffff) << 16)) &
                0xffffffff) >>>
            0;
        h1 =
            (((h1b & 0xffff) +
                0x6b64 +
                ((((h1b >>> 16) + 0xe654) & 0xffff) << 16)) &
                0xffffffff) >>>
            0;
    }
    k1 = 0;
    switch (remainder) {
        case 3:
            k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
        case 2:
            k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
        case 1:
            k1 ^= key.charCodeAt(i) & 0xff;
            k1 =
                (((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) &
                    0xffffffff) >>>
                0;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 =
                (((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) &
                    0xffffffff) >>>
                0;
            h1 ^= k1;
    }
    h1 ^= key.length;
    h1 ^= h1 >>> 16;
    h1 =
        (((h1 & 0xffff) * 0x85ebca6b +
            ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) &
            0xffffffff) >>>
        0;
    h1 ^= h1 >>> 13;
    h1 =
        (((h1 & 0xffff) * 0xc2b2ae35 +
            ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) &
            0xffffffff) >>>
        0;
    h1 ^= h1 >>> 16;
    return h1 >>> 0;
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

    function getLogoList(clogo, cb) {
        if (!cList.length) {
            cb();
            return;
        }
        $(launch_id).append(_("logos..."));
        $.ajax({
            complete: function () {
                cb();
            },
            data: { list: JSON.stringify(clogo) },
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
        try {
            cList = [];
            chanels = {};
            cats = {};
            catsArray = [];
            var ccat = "",
                cepg = {},
                clogo = false;
            var arrEXTINF = data.split("#EXTINF:"),
                l1 = arrEXTINF[0],
                g_utvg =
                    getAttribute(l1, "url-tvg") ||
                    getAttribute(l1, "x-tvg-url"),
                gRec =
                    l1.indexOf("catchup-days") > -1
                        ? getAint(l1, "catchup-days") * 24
                        : l1.indexOf("timeshift") > -1
                          ? getAint(l1, "timeshift") * 24
                          : l1.indexOf("tvg-rec") > -1
                            ? getAint(l1, "tvg-rec") * 24
                            : "0",
                gC =
                    getAttribute(l1, "catchup") ||
                    getAttribute(l1, "catchup-type"),
                gCS = getAttribute(l1, "catchup-source");
            arrEXTINF.shift();
            arrEXTINF.forEach(function (val) {
                var e = val.split("\n"),
                    lutvg = "edem",
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
                var ci;
                if (edsp == 1) ci = murmurhash3_32_gc(url, 10);
                else ci = (e[1] || url).split("/")[5];
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
                        epg: epg,
                        logo: logo,
                        rec: rec,
                        time: 0,
                        time_to: 0,
                        tn: tn,
                        url: url,
                        utvg: utvg,
                    };
                    cepg[ci] =
                        epg && utvg
                            ? { e: epg, n: tn || cn, u: utvg }
                            : utvg
                              ? { n: cn, u: utvg }
                              : { n: tn || cn };
                    if (!logo) {
                        if (!clogo) clogo = {};
                        var tn_l = tn + "|" + lutvg,
                            cn_l = cn + "|" + lutvg;
                        clogo[ci] = lutvg ? cn_l || tn_l : tn || cn;
                    }
                }
            });
            if (edsp == 0 && !edkey) {
                doEditData();
                infoBox(
                    "<br>Необходимо ввести ключ доступа!<br><br>" +
                        btnDiv(keys.ENTER, strENTER, "Close")
                );
            } else if (edsp == 1 && !edurl) {
                doEditData();
                infoBox(
                    "<br>Необходимо ввести ссылку на плейлист!<br><br>" +
                        btnDiv(keys.ENTER, strENTER, "Close")
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
        if (edsp == 1) {
            getEpgList(cepg, function () {
                if (
                    typeof curList !== "undefined" &&
                    curList &&
                    curList[primaryIndex] &&
                    chanels[curList[primaryIndex]]
                ) {
                    chanels[curList[primaryIndex]].time_request = 0;
                    if (typeof updateChanelInfo === "function")
                        updateChanelInfo(curList[primaryIndex]);
                }
            });
            if (clogo)
                getLogoList(clogo, function () {
                    if (
                        typeof curList !== "undefined" &&
                        curList &&
                        curList[primaryIndex] &&
                        typeof updateChanelInfo === "function"
                    )
                        updateChanelInfo(curList[primaryIndex]);
                });
        }
    }

    var u;
    if (edsp == 1) u = edurl;
    else
        u =
            _scheme() +
            "epg.drm-play.com/edem/edem_epg_ico" +
            (edlist ? edlist : "") +
            ".m3u8";

    loadPlaylist(u, aSuccess, callback);
}

function getEPGurl(ch_id) {
    if (edsp == 1) return chanels[ch_id] ? chanels[ch_id].epg_url : null;
    if (!(chanels[ch_id] && chanels[ch_id].epg)) return null;
    return (
        (edlist == 1 ? "iptv-e2-soveni" : "edem") + "/epg/" + chanels[ch_id].epg
    );
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

function item2descr(item, parent) {
    function it(val, title) {
        return val ? "<b>" + _(title) + ": </b>" + val + "<br>" : "";
    }
    function im(val) {
        return val
            ? '<img height="285" width="210" src="' +
                  val +
                  '" style="float: left; margin-right: 5px; margin-bottom: 5px; border-width: 0px; border-style: solid;" onerror="this.width=0;this.height=0;">'
            : "";
    }
    function id(val) {
        return val
            ? "<p><hr><b>" + _("Description") + ": </b>" + val + "</p>"
            : "";
    }
    if (parent) {
        if (parent.title) item.title = parent.title + " - " + item.title;
        if (!(item.img || item.imglr)) item.img = parent.img || parent.imglr;
        if (!item.year) item.year = parent.year;
        if (!item.duration) item.duration = parent.duration;
        if (!item.agelimit) item.agelimit = parent.agelimit;
        if (!item.description) item.description = parent.description;
    }
    return (
        '<table><center><b><span style="font-size: 140%;">' +
        item.title +
        "</span></b></center><p>" +
        im(item.img || item.imglr) +
        it(item.year, "Release date") +
        (item.duration
            ? it(Math.round(item.duration) + " " + _("min"), "Duration")
            : "") +
        it(item.agelimit, "Age") +
        id(item.description) +
        "</table>"
    );
}

var __curKey = 0;
function _selV(sh) {
    if (typeof event !== "undefined" && event && event.stopPropagation)
        event.stopPropagation();
    if (__curKey == sh) dialogBoxKeyHandler(keys.ENTER);
    $("#k" + __curKey).css({ "background-color": "", color: "" });
    __curKey = sh;
    $("#k" + __curKey).css({
        "background-color": curColorB,
        color: curColor,
    });
}

function selectVariant(z, variants, callback) {
    var sk = "";
    function setKey(sh) {
        $("#k" + __curKey).css({ "background-color": "", color: "" });
        __curKey = sh;
        if (__curKey < 0) __curKey = variants.length - 1;
        else if (__curKey > variants.length - 1) __curKey = 0;
        $("#k" + __curKey).css({
            "background-color": curColorB,
            color: curColor,
        });
    }
    variants.forEach(function (item, i) {
        sk +=
            '<div id="k' +
            i +
            '" style="display:inline-block;padding:6px 16px;" onclick="_selV(' +
            i +
            ');">' +
            item +
            "</div>&nbsp;&nbsp;";
    });
    $("#dialogbox")
        .html(_("Quality") + ":<br/><br/>" + sk)
        .show();
    setKey(z);
    dialogBoxKeyHandler = function (code) {
        switch (code) {
            case keys.EXIT:
            case keys.RETURN:
                $("#dialogbox").hide();
                callback(-1);
                return;
            case keys.LEFT:
                setKey(__curKey - 1);
                return;
            case keys.RIGHT:
                setKey(__curKey + 1);
                return;
            case keys.UP:
                setKey(1);
                return;
            case keys.DOWN:
                setKey(0);
                return;
            case keys.ENTER:
                $("#dialogbox").hide();
                callback(__curKey);
                return;
        }
    };
}

var parentMedia = null,
    _vpurl,
    _vpkey;
if (typeof sPageSize == "undefined") sPageSize = 30;

function createMedia(val, parent) {
    switch (val.type) {
        case "stream":
            return {
                description: item2descr(val, parent),
                logo_30x30: val.imglr || val.img,
                request: val.request,
                stream_url: val.url,
                title: val.title,
            };
        case "category":
        case "multistream":
            return {
                description: item2descr(val, parent),
                logo_30x30: val.imglr || val.img,
                playlist_url: {
                    mediaName: val.title,
                    request: val.request,
                },
                title: val.title,
            };
    }
}

function addMedias2(params) {
    params.offset = Math.floor(selIndex / params.limit) * params.limit;
    $("#dialogbox")
        .html(
            '<img src="' +
                host +
                '/stbPlayer/buffering.gif" height="40"> ' +
                _("Download! Wait ...")
        )
        .show();
    $.ajax({
        complete: function () {
            while (
                mediaRecords[selIndex] &&
                typeof mediaRecords[selIndex].description === "function"
            ) {
                mediaRecords.length = selIndex;
                selIndex--;
            }
            showPage();
            $("#dialogbox").hide();
        },
        data: JSON.stringify(params),
        success: function (data) {
            try {
                if (data !== null)
                    if (data.type == "error") alert(data.description);
                    else
                        data.items.forEach(function (val, i) {
                            if (val.type != "next")
                                mediaRecords[params.offset + i] = createMedia(
                                    val,
                                    data
                                );
                        });
            } catch (e) {}
        },
        type: "post",
        url: _vpurl,
    });
    return _("Download! Wait ...");
}

function edem_playMedia(med) {
    var imed = medHistory.findIndex(function (val) {
        return val.title == med.title;
    });
    if (imed == 0 && playType == -100000000000) return;

    showPage();
    $("#dialogbox")
        .html(
            '<img src="' +
                host +
                '/stbPlayer/buffering.gif" height="40"> ' +
                _("Download! Wait ...")
        )
        .show();
    var z = 0,
        av = [],
        i = 0,
        variants;
    var params = { app: "ott-play", key: _vpkey };
    for (var key in med.request) {
        params[key] = med.request[key];
    }
    $.ajax({
        async: false,
        data: JSON.stringify(params),
        error: function (jqXHR) {
            alert("Error: " + JSON.stringify(jqXHR));
        },
        success: function (data) {
            if (data !== null)
                if (data.type == "error") alert(data.description);
                else {
                    med.stream_url = data.url;
                    variants = data.variants;
                }
        },
        type: "post",
        url: _vpurl,
    });
    $("#dialogbox").hide();
    if (variants)
        for (var vkey in variants) {
            av.push(vkey);
            if (variants[vkey] == med.stream_url) z = i;
            i++;
        }
    function _play() {
        closeList();
        if (imed != -1) medHistory[imed].stream_url = med.stream_url;
        _playMedia(med);
    }
    if (av.length < 2) _play();
    else
        selectVariant(z, av, function (val) {
            if (val == -1) return;
            med.stream_url = variants[av[val]];
            _play();
        });
}

// FOSS: enable VPortal media on all platforms when vpurl is set (not dune-only).
var _getMediaArray = function (murl, callback) {
    if (typeof mediaRecords === "undefined") {
        if (typeof callback === "function") callback();
        return;
    }
    if (murl === "") {
        murl = { mediaName: "Media from " + provName, request: {} };
        _vpurl = vpurl.split("]")[1];
        _vpkey = vpurl.split("portal::[key:")[1].split("]")[0];
    } else if (typeof murl === "string" && murl.indexOf("search") == 0) {
        var ss = murl.split("=")[1];
        murl = {
            mediaName: "[" + ss + "]",
            request: { cmd: "search", query: ss },
        };
    } else if (murl.a == "filters") {
        mediaRecords = [];
        murl.filters.forEach(function (val) {
            mediaRecords.push({
                description: val.title,
                logo_30x30: "",
                playlist_url: {
                    a: "filter",
                    items: val.items,
                    mediaName: val.title,
                },
                title: val.title,
            });
        });
        callback();
        return;
    } else if (murl.a == "filter") {
        mediaRecords = [];
        murl.items.forEach(function (val) {
            mediaRecords.push({
                description: val.title,
                logo_30x30: "",
                playlist_url: {
                    mediaName: val.title,
                    request: val.request,
                },
                title: val.title,
            });
        });
        callback();
        return;
    }
    var params = { app: "ott-play", key: _vpkey };
    for (var key in murl.request) {
        params[key] = murl.request[key];
    }
    params.limit = sPageSize * 10;

    $("#dialogbox")
        .html(
            '<img src="' +
                host +
                '/stbPlayer/buffering.gif" height="40"> ' +
                _("Download! Wait ...")
        )
        .show();
    $.ajax({
        complete: function () {
            $("#dialogbox").hide();
            callback();
        },
        data: JSON.stringify(params),
        error: function (jqXHR) {
            alert("medias : jqXHR:" + JSON.stringify(jqXHR));
        },
        success: function (data) {
            try {
                mediaRecords = [];
                if (data !== null)
                    switch (data.type) {
                        case "error":
                            alert(data.description);
                            break;
                        case "videoportal":
                        case "category":
                        case "multistream":
                            mediaName = murl.mediaName;
                            if (data.items)
                                data.items.forEach(function (val) {
                                    if (val.type != "next")
                                        mediaRecords.push(
                                            createMedia(val, data)
                                        );
                                    else
                                        for (
                                            var j = mediaRecords.length;
                                            j < data.count;
                                            j++
                                        ) {
                                            mediaRecords.push({
                                                description: function () {
                                                    return addMedias2(params);
                                                },
                                                logo_30x30: "",
                                                stream_url: "",
                                                title:
                                                    j +
                                                    1 +
                                                    " " +
                                                    _("Download! Wait ..."),
                                            });
                                        }
                                });
                            if (data.controls) {
                                if (data.controls.search)
                                    mediaRecords.push({
                                        description: _("Search"),
                                        playlist_url: "search",
                                        search_on: 1,
                                        title: _("Search"),
                                    });
                                if (data.controls.filters)
                                    mediaRecords.push({
                                        description: _("Filters"),
                                        playlist_url: {
                                            a: "filters",
                                            filters: data.controls.filters,
                                        },
                                        title: _("Filters"),
                                    });
                            }
                            break;
                    }
                return;
            } catch (e) {
                alert(e);
            }
        },
        type: "post",
        url: _vpurl,
    });
};

if (typeof playMedia !== "undefined" || typeof _playMedia !== "undefined") {
    playMedia = edem_playMedia;
}

var edTlist = [
    "epg.one (Стандартный)",
    "soveni",
    "epg.one (Тематический)",
    "epg.one (Упорядоченный)",
];
var vpAlert =
    "Введите ссылку VPortal так как она выглядит кабинете:<br><b>portal::[key:...";
var edsp_v = [" Ключ доступа", " Ссылка на плейлист"];

function duneAddSettings(ind) {
    _getParams();
    popupArray.splice(ind, 1, _("Access settings") + " " + provName);
    popupDetail.splice(ind, 1, "");
    popupActions.splice(ind, 1, doEditData);
    getMediaArray = vpurl ? _getMediaArray : null;
}

function doEditData() {
    selIndex = 0;
    _getParams();
    var r = _(" (after changing, load playlist)"),
        aDetail = [
            "Выбор входа в " +
                provName +
                ' по ключу доступа или по ссылке на плейлист из личного кабинета <br><br> После изменения, перезагрузите плейлист.<br>Выбор "Ссылка на плейлист" доступен после ввода ссылки в разделе "Ссылка плейлист"',
            "Ввод ключа доступа " + provName,
            "Выберите источник шаблона плейлиста, епг и логотипов:<br>" +
                edTlist.join(", ") +
                "<br><br>" +
                r,
            vpAlert,
            "Введите ссылку на плейлист iLook из личного кабинета",
            "",
            _("Load playlist"),
        ];
    listArray = [
        'Вход по: <span style="color:red;font-size:100%;"> ' +
            edsp_v[edsp] +
            "</span>",
        "Ключ доступа",
        "Тип листа: " + edTlist[edlist],
        "Ссылка VPortal",
        "Ссылка плейлист",
        "",
        (sNoNumbersKeys ? "" : '<div class="btn">8</div> ') +
            _("Load playlist"),
    ];
    getListItem = function (item, i) {
        return "&nbsp;&nbsp;" + item;
    };
    detailListAction = function () {
        listDetail.innerHTML = aDetail[selIndex] || "";
        listPodval.innerHTML =
            btnDiv(keys.RETURN, strRETURN, "Close") +
            ([0, 2].indexOf(selIndex) == -1
                ? ""
                : btnDiv(
                      keys.ENTER,
                      strENTER,
                      "Change value",
                      strLEFT,
                      strRIGHT
                  )) +
            (selIndex != 1
                ? ""
                : btnDiv(
                      keys.ENTER,
                      strENTER,
                      "Change value",
                      strLEFT,
                      strRIGHT
                  ));
    };
    listKeyHandler = function (code) {
        var a = 1;
        switch (code) {
            case keys.LEFT:
                a = -1;
            case keys.RIGHT:
                // Allow LEFT/RIGHT to rotate entry mode / list type (0,2);
                // on key row (1) same as ENTER (open editor).
                if (code != keys.ENTER && [0, 1, 2].indexOf(selIndex) == -1)
                    return false;
            case keys.ENTER:
                switch (selIndex) {
                    case 0:
                        doEditEdsp(a);
                        return true;
                    case 1:
                        edemKey();
                        return true;
                    case 2:
                        doEditList(a);
                        return true;
                    case 3:
                        vportal();
                        return true;
                    case 4:
                        edplaylist();
                        return true;
                    case 6:
                        loadChannels();
                        return true;
                }
                return true;
            case keys.RETURN:
                popupList(popupActions.indexOf(noProvParam) + 1);
                return true;
            case keys.N8:
                loadChannels();
                return true;
            default:
                return false;
        }
    };
    listDetail.innerHTML = "";
    listCaption.innerHTML = _("Access settings") + " " + provName;
    $("#listPopUp").hide();
    showPage();
}

function edemKey() {
    editCaption = "Редактирование ключа доступа";
    editvar = edkey;
    setEdit = function () {
        if (edkey == editvar) return;
        edkey = editvar;
        providerSetItem("key", edkey);
        if (typeof playChannel === "function")
            playChannel(catIndex, primaryIndex);
        showPage();
    };
    showEditKey();
}

function doEditList(a) {
    edlist += a;
    if (edlist == edTlist.length) edlist = 0;
    if (edlist < 0) edlist = edTlist.length - 1;
    providerSetItem("list", edlist);
    listArray[2] = "Тип листа: " + edTlist[edlist];
    showPage();
}

function doEditEdsp(a) {
    edsp += a;
    if (edsp == edsp_v.length) edsp = 0;
    if (edsp < 0) edsp = edsp_v.length - 1;
    if (edurl == "") edsp = 0;
    providerSetItem("edsp", edsp);
    listArray[0] =
        'Вход по: <span style="color:red;font-size:100%;"> ' +
        edsp_v[edsp] +
        "</span>";
    showPage();
}

function vportal() {
    editCaption = "Редактирование ссылки VPortal";
    editvar = vpurl;
    setEdit = function () {
        if (vpurl == editvar) return;
        editvar = editvar.replace("%5B", "[").replace("%5D", "]");
        if (editvar && editvar.indexOf("portal::[key:") != 0) {
            alert(vpAlert);
            showEditKey();
            return;
        }
        vpurl = editvar;
        providerSetItem("vpurl", vpurl);
        getMediaArray = vpurl ? _getMediaArray : null;
        mediaUrls = null;
        mediaNames = [];
        mediaSelects = [0];
    };
    showEditKey();
}

function edplaylist() {
    editCaption = "Редактирование ссылки плейлиста из личного кабинета iLook";
    editvar = edurl;
    setEdit = function () {
        if (edurl == editvar) return;
        edurl = editvar;
        providerSetItem("edurl", edurl);
        if (edurl == "" || edurl == 0 || edurl === -1) {
            edsp = 0;
            providerSetItem("edsp", edsp);
        }
    };
    showEditKey();
}

_getParams();

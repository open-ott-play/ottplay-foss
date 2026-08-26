var m3u_defaults = { epg_server: "http://ottp.eu.org" };
// Local FOSS: always point EPG requests to local server
if (typeof host === "string" && host.indexOf("ottp.eu.org") === -1) {
    m3u_defaults.epg_server = host;
} else if (!client_can.crossxhr && window.location.host !== "ottp.eu.org") {
    m3u_defaults.epg_server = "http://" + window.location.host;
}
var epg_sources = {};

function postMatch(a, e, r, t) {
    $.ajax({
        type: "POST",
        url: a,
        data: e,
        contentType: "text/plain",
        dataType: "text",
        timeout: 120000
    }).done(function(e) {
        if (!e) return;
        if (e) r(e);
    }).fail(function(e, r, t) {
        var i = "!!! ERROR LOADING: " + a.split("/").pop() + " - " + r + "/" + e.status + "/" + t;
        console.error(i);
    }).always(function() { t(); });
}

function getEpgList(e, r, t) {
    if (!cList.length || !r) { t(); return; }
    $(launch_id).append(_("epgs..."));
    var i = e.epg_server === void 0 ? m3u_defaults.epg_server : e.epg_server;
    var a = {};
    var n = JSON.stringify(a) + "\n\t\n";
    if (e.raw.length !== 0) { n += e.raw.join("\n"); }
    n += "\n\t\n" + r;
    postMatch(i + "/m3u/match-channels", n, function(e) {
        var r = e.split("\n\t\n");
        if (r.length != 3) return;
        var t, i, a, n;
        n = r[2].split("\n");
        for (t = 0; t < n.length; t++) {
            a = n[t].split("~");
            if (a.length == 2) {
                epg_sources[a[0]] = a[1] + "epg/";
                if (!client_can.crossxhr) {
                    epg_sources[a[0]] = epg_sources[a[0]].replace("//epg.ottp.eu.org/", "//" + window.location.host + "/e/");
                }
            }
        }
        n = r[1].split("\n");
        for (t = 0; t < n.length; t++) {
            a = n[t].split("~");
            if (a.length !== 3) continue;
            i = chanels[a[0]];
            if (i === undefined) continue;
            i.epg_src = a[1];
            i.epg_url = a[2];
        }
    }, t);
}

function getLogoList(e, r, t) {
    if (!cList.length || !r) { t(); return; }
    $(launch_id).append(_("logos..."));
    var i = e.ico_server === undefined ? m3u_defaults.epg_server : e.ico_server;
    var a = {};
    var n = JSON.stringify(a) + "\n\t\n";
    if (e.raw.length !== 0) { n += e.raw.join("\n"); }
    n += "\n\t\n" + r;
    postMatch(i + "/m3u/match-logos", n, function(e) {
        var r = e.split("\n\t\n");
        if (r.length != 2) return;
        var t, i, a, n;
        n = r[1].split("\n");
        for (t = 0; t < n.length; t++) {
            a = n[t].split("~");
            if (a.length !== 2) continue;
            i = chanels[a[0]];
            if (i === undefined) continue;
            i.logo = a[1];
        }
    }, t);
}

function getEPGurl(e) {
    var r = chanels[e];
    if (r !== undefined && r.epg_src && r.epg_url) {
        var t = epg_sources[r.epg_src];
        if (t !== undefined) { t += r.epg_url + ".json"; return t; }
    }
    return null;
}

function getEPGchanel(s, e) {
    var o = null,
        r = getEPGurl(s);
    if (!r) { e(s, o); return; }
    $.ajax({
        type: "GET",
        url: r,
        dataType: "json",
        timeout: 1e4
    }).done(function(e) {
        var r = e;
        if (r !== null && r.epg_data !== undefined) {
            o = r.epg_data;
            if (chanels[s].ts !== undefined) {
                var t = chanels[s].ts;
                var i = void 0;
                var a = o.length;
                for (var n = 0; n < a; n++) {
                    i = o[n];
                    if (i.time > 0 && i.time_to > 0) { i.time += t;
                        i.time_to += t; }
                }
            }
        }
    }).fail(function(e, r, t) {
        console.log("NOTICE: Loaded epg.json with status=" + r + "/" + e.status + "/" + t);
    }).always(function() { e(s, o); });
}

function provEpgLoader(e, r) {
    if (r !== "") getEpgList(e, r, function() {
        var e = curList[primaryIndex];
        if (e !== undefined) { chanels[e].time_request = 0;
            updateChanelInfo(e); }
    });
}

version += " m3u-0218";
var m3uArr, _number = 0,
    m3uCap = 15;
p_pref = "m3u";
parental = /XXX|\u0412\u0437\u0440\u043e\u0441\u043b\u044b\u0435|\u0414\u043b\u044f \u0432\u0437\u0440\u043e\u0441\u043b\u044b\u0445|\u042d\u0440\u043e\u0442\u0438\u043a\u0430|18\+|Adults/i;

function keyNames4(e) {
    if (pdsa.indexOf(e) != -1) e += m3uArr.active || "";
    return e;
}
if (typeof stbGetItem === "function") {
    providerGetItem = function(e) { return stbGetItem(p_pref + keyNames4(e)); };
    providerSetItem = function(e, r) { stbSetItem(p_pref + keyNames4(e), r); };
} else {
    providerGetItem = function(e) { return localStorage.getItem(p_pref + keyNames4(e)); };
    providerSetItem = function(e, r) { localStorage.setItem(p_pref + keyNames4(e), r); };
}
providerDelItem = function(e) { return ottpStorage.del(p_pref + keyNames4(e)); };
providerHasItem = function(e) { return ottpStorage.has(p_pref + keyNames4(e)); };
providerHasItemValue = function(e) { return ottpStorage.hasValue(p_pref + keyNames4(e)); };

function loadM3Uparams() {
    m3uArr = providerGetItem("m3uArr");
    if (!m3uArr) m3uArr = { active: 0, M3Us: [] };
    else try { m3uArr = JSON.parse(m3uArr); } catch (e) { m3uArr = { active: 0, M3Us: [] }; }
    for (var e = m3uArr.M3Us.length; e < m3uCap; e++) m3uArr.M3Us[e] = { www: "", rechours: 0 };
    if (browserName() == "dune") try {
        var r = window.location.href.split("?")[1].split("&");
        r.forEach(function(e) {
            var r = e.split("=");
            if (r[0] == "n") { _number = parseInt(r[1]); throw {}; }
        });
    } catch (e) {}
    if (_number > 0 && _number <= m3uCap) m3uArr.active = _number - 1;
}

function getProviderParams() {
    loadM3Uparams();
    for (var e = 0; e < m3uCap; e++) {
        $("#www" + e).val(m3uArr.M3Us[e].www);
        $("#rechours" + e).val(m3uArr.M3Us[e].rechours);
    }
    $("input:radio[name=odin]").filter("[value=" + m3uArr.active + "]").prop("checked", true);
    return m3uArr.M3Us[m3uArr.active].www;
}

function setProviderParams() {
    for (var e = 0; e < m3uCap; e++) {
        m3uArr.M3Us[e].www = decodeURIComponent($("#www" + e).val().trim());
        m3uArr.M3Us[e].rechours = $("#rechours" + e).val().trim();
    }
    m3uArr.active = $("input[name=odin]:checked").val();
    var r = JSON.stringify(m3uArr) != providerGetItem("m3uArr");
    providerSetItem("m3uArr", JSON.stringify(m3uArr));
    loadM3Uparams();
    if (m3uArr.M3Us[m3uArr.active].www.length < 8) alert("\u0414\u043b\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u043e \u0432\u0432\u0435\u0441\u0442\u0438 \u0430\u0434\u0440\u0435\u0441 \u043f\u043b\u0435\u0439\u043b\u0438\u0441\u0442\u0430!");
    return r;
}

function getChannelPicon(e) { return chanels[e].logo || ""; }

function getChannelUrl(e) { return chanels[e].url || ""; }

function getArchiveUrl(e, r, t) {
    function i(e) {
        return e.replace(/\$\{start\}/g, Math.floor(r)).replace(/\$\{end\}/g, Math.floor(t)).replace(/\$\{timestamp\}/g, Math.floor(Date.now() / 1e3)).replace(/\$\{offset\}/g, Math.floor(Date.now() / 1e3) - Math.floor(r)).replace(/\$\{duration\}/g, Math.floor(t - r));
    }
    if (t < r) t = Date.now() / 1e3;
    if (browserName() == "dune") t += 7200;
    if (chanels[e].ca.indexOf("flussonic") != -1) {
        var a = chanels[e].url,
            n = "",
            s = "",
            o = "";
        if (a.indexOf("mpegts") != -1) { n = "mpegts";
            s = "archive-{}-{}.ts";
            o = "timeshift_abs-{}.ts"; } else if (a.indexOf("video.m3u8") != -1) { n = "video.m3u8";
            s = "video-{}-{}.m3u8";
            o = "video-timeshift_abs-{}.m3u8"; } else if (a.indexOf("mono.m3u8") != -1) { n = "mono.m3u8";
            s = "mono-{}-{}.m3u8";
            o = "mono-timeshift_abs-{}.m3u8"; } else if (a.indexOf("index.m3u8") != -1) { n = "index.m3u8";
            s = "archive-{}-{}.m3u8";
            o = "timeshift_abs-{}.m3u8"; } else if (a.indexOf("index.mpd") != -1) { n = "index.mpd";
            s = "archive-{}-{}.mpd";
            o = "timeshift_abs-{}.mpd"; }
        if (n) {
            var l = a.split(n);
            if (r > Date.now() / 1e3 - 600) return l[0] + o.replace("{}", Math.floor(r).toString(10)) + l[1];
            else return l[0] + s.replace("{}", Math.floor(r).toString(10)).replace("{}", Math.floor(t - r).toString(10)) + l[1];
        }
    }
    if (chanels[e].caso) switch (chanels[e].ca) {
        case "append":
            return i(chanels[e].url + chanels[e].caso);
        default:
            return i(chanels[e].caso);
    }
    var u = chanels[e].url.indexOf("?") == -1 ? "?" : "&";
    return chanels[e].url + u + "utc=" + Math.floor(r) + "&lutc=" + Math.floor(Date.now() / 1e3);
}

if (typeof catsArray == "undefined") var catsArray = [];

function addChan2cat(e, r) {
    if (!e || !r) return;
    if (!cats[e]) { catsArray.push(e);
        cats[e] = []; }
    cats[e].push(r);
}

function getChanelsArray(a) {
    function O(e, r) {
        var t = e.split(r + "=");
        if (t.length == 1 || t[1].length == 0) return "";
        if (t[1][0] == '"') return t[1].split('"')[1] || "";
        else return t[1].split(/[ ,]+/)[0] || "";
    }

    function I(e, r) { return parseInt(O(e, r), 10) || 0; }

    function e(e, i, a) {
        if (typeof launch_id == "undefined") launch_id = "#launch";
        if (!e) { a(); return; }
        var n = e;
        if (typeof stbInterceptRequest === "function") {
            stbInterceptRequest(e);
            e += (e.indexOf("?") == -1 ? "?" : "&") + "url=" + encodeURIComponent(e);
        }
        $.ajax({
            url: e,
            timeout: 5e3,
            success: i,
            error: function(e, r, t) {
                $(launch_id).append(_("Playlist is not loading directly...Loading via server..."));
                $.ajax({
                    url: host + "/m3u/cp.php",
                    data: { url: "@" + n },
                    method: "post",
                    dataType: "text",
                    timeout: 15e3,
                    success: i,
                    error: function(e, r, t) {
                        console.log("channels : jqXHR:" + JSON.stringify(e) + "; textStatus: " + r + ", errorThrown: " + t);
                        alert(_("Failed to load channel list!"));
                        a();
                    }
                });
            }
        });
    }

    function r(e) {
        epg_sources = {};
        var r = function(t, e) {
            if (!e) { return; }
            e.split(",").map(function(e) {
                var r = e.trim().split("::");
                if (r.length !== 2) { return; }
                if (r[0] === "!epg-server") { t.epg_server = r[1]; }
                if (r[0] === "!ico-server") { t.ico_server = r[1]; } else if (r[0].charCodeAt(0) === 61) {
                    epg_sources[r[0]] = r[1];
                } else { t.foss[r[0]] = r[1]; }
            });
        };
        var w = function(n, e, s) {
            if (!e) { return; }
            if (e.charCodeAt(0) === 61) {
                if (epg_sources[e] !== void 0) { n.splice(0);
                    n.push(e); return; }
            }
            e.split(",").map(function(e) {
                var r;
                var t = e.trim();
                if (t.length < 2) { return; }
                if (s !== void 0) {
                    if (t.charCodeAt(0) === 35) {
                        var i = parseInt(t.slice(1), 10);
                        var a = isNaN(i) ? s.foss[t.slice(1)] : s.raw[i - 1];
                        if (a === void 0) { return; }
                        r = xxHash32Si(StripHttp(a));
                    } else { r = xxHash32Si(StripHttp(t)); }
                } else { r = StripHttp(t); }
                if (n.indexOf(r) === -1) { n.push(r); }
            });
        };
        var M = "",
            E = "",
            N = "",
            b = { raw: [], foss: {} };
        try {
            var t = e.split("#EXTINF:"),
                i = t[0],
                U = i.indexOf("catchup-days") > -1 ? I(i, "catchup-days") * 24 : i.indexOf("timeshift") > -1 ? I(i, "timeshift") * 24 : i.indexOf("tvg-rec") > -1 ? I(i, "tvg-rec") * 24 : parseInt(m3uArr.M3Us[m3uArr.active].rechours),
                L = O(i, "catchup") || O(i, "catchup-type"),
                S = O(i, "catchup-source");
            r(b, O(i, "foss-tvg"));
            w(b.raw, O(i, "url-tvg"));
            w(b.raw, O(i, "x-tvg-url"));
            t.shift();
            t.forEach(function(e, r, t) {
                var i = e.split("\n"),
                    a = O(i[0], "group-title"),
                    n = O(i[0], "tvg-id"),
                    s = O(i[0], "tvg-name"),
                    o = O(i[0], "tvg-shift"),
                    l = O(i[0], "tvg-logo");
                l = l.indexOf("//") === 0 || l.toLowerCase().indexOf("http") === 0 ? l : "";
                var u = i[0].indexOf("catchup-days") > -1 ? I(i[0], "catchup-days") * 24 : i[0].indexOf("timeshift") > -1 ? I(i[0], "timeshift") * 24 : i[0].indexOf("tvg-rec") > -1 ? I(i[0], "tvg-rec") * 24 : U,
                    c = O(i[0], "catchup") || O(i[0], "catchup-type") || L,
                    f = O(i[0], "catchup-source") || S,
                    p = [],
                    d = _("??? No channel name"),
                    m = 0,
                    h = "",
                    v = 1;
                w(p, O(i[0], "tvg-source"), b);
                w(p, O(i[0], "url-tvg"), b);
                try {
                    var r = i[0].indexOf(",");
                    if (r > 0) {
                        var g = i[0].substr(r + 1).trim();
                        if (g) { d = g;
                            m = xxHash32S(d, true); } else if (s) { d = s; } else if (n) { d = n; }
                    }
                } catch (i) { console.log(i); }
                try { h = i[1].trim(); } catch (i) {}
                while (h.indexOf("#") === 0) {
                    if (h.indexOf("#EXTGRP:") != -1)
                        if (!a) a = h.split("#EXTGRP:")[1].trim();
                    try { h = i[++v].trim(); } catch (i) { h = ""; }
                }
                if (a == "") a = M;
                else M = a;
                var y = murmurhash3_32_gc(h, 10);
                addChan2cat(a, y);
                if (h && cList.indexOf(y) == -1) {
                    var x;
                    cList.push(y);
                    chanels[y] = {
                        channel_name: d,
                        category: { "class": catsArray.indexOf(a) + 2, "name": a },
                        rec: u,
                        time: 0,
                        time_to: 0,
                        url: h,
                        logo: l,
                        epg: n,
                        tn: s,
                        ca: c,
                        caso: f
                    };
                    if (o !== "") {
                        var A = parseFloat(o);
                        if (!isNaN(A) && A != 0) chanels[y].ts = Math.floor(A * -3600);
                    }
                    if (p.length === 1 && n && typeof p[0] === "string" && p[0].charCodeAt(0) === 61) {
                        chanels[y].epg_src = p[0];
                        chanels[y].epg_url = xxHash32Si(n);
                    } else if (m != 0 || n || s) {
                        x = [y, xxHash32Si(n), xxHash32Si(s), m].join("-");
                        if (p.length !== 0) { x += "~" + p.join("-"); }
                        E += x + "~" + encodeURIComponent(d) + "\n";
                    }
                    if (!l && (m != 0 || n || s)) {
                        if (x === void 0) {
                            x = [y, xxHash32Si(n), xxHash32Si(s), m].join("-");
                            if (p.length !== 0 && p[0].charCodeAt(0) !== 61) { x += "~" + p.join("-"); }
                        }
                        N += x + "~" + encodeURIComponent(d) + "\n";
                    }
                }
            });
        } catch (e) {
            console.error(e);
            console.log("Exception: name " + e.name + ", message " + e.message + ", typeof " + typeof e);
            alert(_("Failed to load channel list!"));
        }
        a();
        provEpgLoader(b, E);
        if (N !== "") getLogoList(b, N, function() { updateChanelInfo(curList[primaryIndex]); });
    }
    var t = m3uArr.M3Us[m3uArr.active].www;
    if (!t) { doEditM3Ua(); return; }
    if (typeof readFile === "function" && t && t[0] === "/") r(readFile(t));
    else e(t, r, a);
}

function _m3u2popup() {
    var e = parseInt(m3uArr.active),
        r = m3uArr.M3Us[e];
    popupArray[popupActions.indexOf(doEditM3Ua)] = _("Select playlist") + ": " + (e + 1 + " - " + (r.name || r.www || ""));
}

function duneAddSettings(e) {
    loadM3Uparams();
    if (_number > 0 && _number <= m3uCap) { doEditM3Ua = doEditListData; }
    popupArray.splice(e, 1, "");
    popupDetail.splice(e, 1, _("Select playlist"));
    popupActions.splice(e, 1, doEditM3Ua);
    _m3u2popup();
    getMediaArray = m3uArr.M3Us[m3uArr.active].medUrl ? _getMediaArray : null;
}

function selectAndRestart(e) {
    var r = m3uArr.active;
    m3uArr.active = e;
    providerSetItem("m3uArr", JSON.stringify(m3uArr));
    m3uArr.active = r;
    loadPlaylist();
}

function loadPlaylist() {
    loadM3Uparams();
    _m3u2popup();
    getMediaArray = m3uArr.M3Us[m3uArr.active].medUrl ? _getMediaArray : null;
    loadChannels();
}
var doEditM3Ua = function(e) {
    if (typeof e === "undefined") e = m3uArr.active;
    selIndex = e;
    listArray = m3uArr.M3Us;
    listDataArray = listArray;
    getListItem = function(e, r) {
        return "&nbsp;&nbsp;" + (sNoNumbersKeys || r >= 6 ? r + 1 + ":&nbsp;" : '<div class="btn">' + (r + 1) + "</div>&nbsp;") + (e.name || e.www || "");
    };
    detailListAction = function() {
        var e = m3uArr.M3Us[selIndex];
        listDetail.innerHTML = _("Playlist Name") + ': <span " style="color:' + curColor + ';">' + (e.name || "") + "</span><br/>" + _("Playlist URL") + ':<br/><span " style="color:' + curColor + ';">' + (e.www || "") + "</span><br/>" + _("Archive hours") + ': <span " style="color:' + curColor + ';">' + (e.rechours || 0) + "</span><br/>" + _("Media Library URL") + ':<br/><span " style="color:' + curColor + ';">' + (e.medUrl || "") + "</span>";
        listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close") + btnDiv(keys.ENTER, strENTER, m3uArr.active == selIndex || !m3uArr.M3Us[selIndex].www ? "Edit" : "Load");
    };
    listKeyHandler = function(e) {
        switch (e) {
            case keys.RETURN:
                _m3u2popup();
                popupList(popupActions.indexOf(noProvParam) + 1);
                return true;
            case keys.N1: case keys.N2: case keys.N3: case keys.N4: case keys.N5: case keys.N6:
                selIndex = e - 49;
            case keys.ENTER:
                if (m3uArr.active == selIndex || !m3uArr.M3Us[selIndex].www) doEditListData(selIndex);
                else selectAndRestart(selIndex);
                return true;
            default:
                return false;
        }
    };
    listDetail.innerHTML = "";
    listCaption.innerHTML = _("Select playlist");
    listPodval.innerHTML = "";
    $("#listPopUp").hide();
    showPage();
};

function doEditListData(r) {
    function n() {
        var e = 0;
        listArray[e++] = _("Playlist Name") + ": " + (s.name || "");
        listArray[e++] = _("Playlist URL") + ": " + (s.www || "");
        if (typeof readFile === "function") {
            var r = "";
            if (s.www && s.www[0] === "/") { var t = s.www.split("/");
                r = t[t.length - 1]; }
            listArray[e++] = _("Playlist file") + ": " + r + strNew;
        }
        listArray[e++] = _("Archive hours") + ": " + (s.rechours || 0);
        listArray[e] = _("Media Library URL") + ": " + (s.medUrl || "");
        listDataArray = listArray;
    }

    function t(e, r, t, i, a) {
        editCaption = _(e);
        editvar = (s[r] || "").toString();
        setEdit = function() {
            if (s[r] == editvar.trim()) return;
            if (a) pdsa.forEach(function(e) { providerDelItem(e); });
            s[r] = i ? parseInt(editvar) || 0 : editvar;
            providerSetItem("m3uArr", JSON.stringify(m3uArr));
            n();
            getMediaArray = m3uArr.M3Us[m3uArr.active].medUrl ? _getMediaArray : null;
            showPage();
        };
        showEditKey(t);
    }
    if (typeof r === "undefined") r = m3uArr.active;
    var s = m3uArr.M3Us[r];
    selIndex = 0;
    var e = _(" (after changing, load playlist)"),
        i = [_("Enter playlist Name"), _("Enter playlist URL") + e, _("Enter playlist archive hours") + e, _("Enter Media Library URL"), "", _("Load playlist")],
        a = 2,
        o = 3,
        l = 5,
        u = 1e3;
    listArray = ["", "", "", "", "", _("Load playlist")];
    if (typeof readFile == "function") {
        listArray.splice(2, 0, "");
        i.splice(2, 0, _("Select playlist file") + e);
        a = 3;
        o = 4;
        l = 6;
        u = 2;
    }
    n();
    getListItem = function(e, r) { return "&nbsp;&nbsp;" + e; };
    detailListAction = function() { listDetail.innerHTML = i[selIndex]; };
    listKeyHandler = function(e) {
        switch (e) {
            case keys.ENTER:
                switch (selIndex) {
                    case 0:
                        t("Enter playlist Name", "name");
                        return true;
                    case 1:
                        t("Enter playlist URL", "www", null, false, m3uArr.active == r);
                        return true;
                    case u:
                        if (typeof showFileDialog !== "function") {
                            alert(_("File selection is not supported on this device"));
                            return true;
                        }
                        editvar = (s["www"] || "").toString();
                        setEdit = function() { s.www = editvar;
                            providerSetItem("m3uArr", JSON.stringify(m3uArr));
                            n();
                            showPage(); };
                        showFileDialog(editvar, "m3u,m3u8");
                        return true;
                    case a:
                        t("Enter playlist archive hours", "rechours", [0], true);
                        return true;
                    case o:
                        t("Enter Media Library URL", "medUrl");
                        return true;
                    case l:
                        if (_number > 0 && _number <= m3uCap) loadPlaylist();
                        else selectAndRestart(r);
                        return true;
                }
                return true;
            case keys.RETURN:
                if (_number > 0 && _number <= m3uCap) { _m3u2popup();
                    popupList(popupActions.indexOf(noProvParam) + 1); } else doEditM3Ua(r);
                return true;
            default:
                return false;
        }
    };
    listDetail.innerHTML = "";
    listCaption.innerHTML = _("Edit playlist data");
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    $("#listPopUp").hide();
    showPage();
}

function Text2Dom(e) {
    var r = new DOMParser();
    return r.parseFromString(e, "text/xml");
}

function fXMLCh2Json(e, r) {
    var t = { t: e.tagName };
    var i = true;
    for (var a = e.firstElementChild; a; a = a.nextElementSibling) {
        if (r.indexOf(a.tagName) !== -1) { t[a.tagName] = a.textContent; if (i === true) i = false; }
    }
    if (!t.title) t.title = "<\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f>";
    return i === true ? null : t;
}

function fXML_to_JSON(e, r) {
    var t = ["channels", "menu"];
    var i = ["playlist_name", "title", "next_page_url", "prev_page_url"];
    var a = ["channel", "menu"];
    var n = ["search_on", "adult", "title", "logo_30x30", "description", "playlist_url", "stream_url"];
    if (e.childNodes.length === 0) return false;
    var s = true;
    var o;
    for (o = e.firstChild; o; o = o.nextSibling) { if (o.nodeType === 1) break; }
    if (!o) return false;
    e = o;
    if (e.tagName == "items") e = e.firstElementChild;
    var l;
    if (r.channels === undefined) r.channels = [];

    function u(e) {
        if (a.indexOf(e.tagName) !== -1) {
            l = fXMLCh2Json(e, n);
            if (l !== null) { if (s === true) s = false;
                r.channels.push(l); }
        }
    }
    for (o = e; o; o = o.nextElementSibling) {
        if (t.indexOf(o.tagName) !== -1) { for (var c = o.firstElementChild; c; c = c.nextElementSibling) { u(c); } }
        u(o);
        if (i.indexOf(o.tagName) !== -1) { r[o.tagName] = o.textContent; }
    }
    return !s;
}

function getMediaArrayXML(e, r) {
    mediaUrls[mediaUrls.length - 1] = e;
    if (e === "") { r(); return; }
    $("#dialogbox").html('<img src="' + host + '/stbPlayer/buffering.gif" height="40"> ' + _("Download! Wait ...")).show();
    if (typeof box_mac !== "undefined" && box_mac) e += (e.indexOf("?") == -1 ? "?" : "&") + "box_client=ott-foss&box_mac=" + box_mac;
    $.ajax({
        url: e,
        dataType: "text",
        timeout: 6e4,
        success: function(e, r, t) {
            var i = e.slice(0, 16);
            if (i.length < 7) { alert("Error: Bad response length!"); return; }
            var a = "";
            if (i[0] === "<") a = "xml";
            else if (i.indexOf("#EXTM3U") !== -1) a = "m3u";
            else if (i[0] === "{") a = "json";
            else { alert("Bad data header: " + i + "!"); return; }
            var n = {};
            try {
                if (a === "xml") {
                    var s = Text2Dom(e);
                    var o = s.querySelector("parsererror");
                    if (o) {
                        var l = document.createElement("textarea");
                        e = e.replace(/&[a-z0-9]+;/gi, function(e) { l.innerHTML = e; return "&#" + l.textContent.charCodeAt(0).toString(10) + ";"; });
                        s = Text2Dom(e);
                        o = s.querySelector("parsererror");
                        if (o) {
                            e = e.replace(/(title|description)>([^<>\n]+)</gi, function(e, r, t) { return r + "><![CDATA[" + t + "]]><"; });
                            s = Text2Dom(e);
                            o = s.querySelector("parsererror");
                            if (o) { alert("Error: Cannot parse fXML!");
                                console.error("Cannot parse fXML: " + e + "\n\n" + o.innerHTML); return; }
                        }
                    }
                    if (fXML_to_JSON(s, n) === false) { alert("Error: Bad fXML!");
                        console.error("Bad fXML: " + e); return; }
                    mediaRecords = n.channels;
                } else if (a === "m3u") { getMediaArrayEXTM3U(e); return; } else if (a === "json") {
                    n = JSON.parse(e);
                    var u = ["menu", "channels"];
                    mediaRecords = [];
                    var c = void 0,
                        f = void 0;
                    for (var p in n) {
                        if (n.hasOwnProperty(p) && u.indexOf(p) !== -1) {
                            c = n[p];
                            if (Array.isArray(c)) { f = p; if (f === "channels") f = "channel"; for (var d = 0; d < c.length; d++) { c[d].t = f;
                                    mediaRecords.push(c[d]); } }
                        }
                    }
                }
                mediaName = n.playlist_name || n.title || mediaName || "?";
                if (n.next_page_url) mediaRecords.push({ title: "...", logo_30x30: "", description: "...", playlist_url: n.next_page_url });
            } catch (e) { console.error(e); }
        },
        error: function(e, r, t) { alert("Error: " + e.status); },
        complete: function() { $("#dialogbox").hide();
            r(); }
    });
}

function getMediaArrayEXTM3U(e) {
    function l(e, r) {
        var t = e.split(r + "=");
        if (t.length == 1 || t[1].length == 0) return "";
        if (t[1][0] == '"') return t[1].split('"')[1] || "";
        else return t[1].split(/[ ,]+/)[0] || "";
    }

    function u(e, r) {
        return "<table>" + "<h2><center>" + e + "</center></h2>" + (r ? '<img id="detal" height="285" src="' + r + '" style="float: left; margin-right: 5px; margin-bottom: 5px; border-width: 0px; border-style: solid;" width="210">' : "") + "</table>";
    }
    try {
        mediaName = mediaName || "?";
        mediaRecords = [];
        var r = e.split("#EXTINF:");
        r.shift();
        r.forEach(function(e, r, t) {
            var i = e.split("\n");
            var a = l(i[0], "tvg-logo");
            var n = "??? \u041d\u0435\u0442 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f";
            try { n = i[0].split(",")[1].trim(); } catch (i) {}
            var s = "",
                o = 1;
            try { s = i[1].trim(); } catch (i) {}
            while (s.indexOf("#") === 0) { try { s = i[++o].trim(); } catch (i) { s = ""; } }
            if (s) mediaRecords.push({ title: n, logo_30x30: a, description: u(n, a), stream_url: s });
        });
    } catch (e) { alert("Error M3U !!!"); }
}
if (browserName() == "dune") {
    var _getMediaArray = function(e, r) {
        if (e === "") e = m3uArr.M3Us[m3uArr.active].medUrl || "";
        getMediaArrayXML(e, r);
    };
    var box_mac = stb.getMacAddress().replace(/:/g, "");
}

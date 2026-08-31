version += " ultifl1x-0219";
p_pref = "ultifl1x";
parental = /XXX|Взрослые|Для взрослых|Эротика|18\+|Adults/i;
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
var _ultifl1x_cfg = { m3u: "", pass: "", server: "", user: "" };
function _ultifl1x_load() {
    try {
        var d = providerGetItem("cfg");
        if (d) _ultifl1x_cfg = JSON.parse(d);
    } catch (e) {}
    if (!(_ultifl1x_cfg.server || _ultifl1x_cfg.m3u))
        _ultifl1x_cfg = { m3u: "", pass: "", server: "", user: "" };
}
function _ultifl1x_save() {
    providerSetItem("cfg", JSON.stringify(_ultifl1x_cfg));
}
function getChannelPicon(e) {
    return chanels[e] ? chanels[e].logo || "" : "";
}
function getChannelUrl(e) {
    return chanels[e] ? chanels[e].url || "" : "";
}
function getEPGchanel(s, e) {
    e(s, null);
}
function addChan2cat(catName, hash) {
    if (!(catName && hash)) return;
    if (!cats[catName]) {
        catsArray.push(catName);
        cats[catName] = [];
    }
    cats[catName].push(hash);
}
function getChanelsArray(cb) {
    _ultifl1x_load();
    if (_ultifl1x_cfg.server && _ultifl1x_cfg.user && _ultifl1x_cfg.pass)
        _ultifl1x_xtream(cb);
    else if (_ultifl1x_cfg.m3u) _ultifl1x_m3u(cb);
    else {
        alert(_("Configure ULTIFL1X in Settings -> Provider Settings"));
        cb();
    }
}
function _ultifl1x_m3u(cb) {
    $(launch_id).append(_("Loading M3U..."));
    $.ajax({
        error: function () {
            $.ajax({
                data: { url: "@" + _ultifl1x_cfg.m3u },
                dataType: "text",
                error: function () {
                    alert(_("Failed to load!"));
                    cb();
                },
                method: "post",
                success: function (d) {
                    _ultifl1x_parseM3U(d, cb);
                },
                timeout: 15e3,
                url: host + "/m3u/cp.php",
            });
        },
        success: function (d) {
            _ultifl1x_parseM3U(d, cb);
        },
        timeout: 15e3,
        url: _ultifl1x_cfg.m3u,
    });
}
function _ultifl1x_parseM3U(data, cb) {
    cList = [];
    chanels = {};
    cats = {};
    catsArray = [];
    try {
        var lines = data.split("#EXTINF:");
        var hdr = lines[0] || "";
        lines.shift();
        var lc = "";
        lines.forEach(function (b) {
            var p = b.split("\n");
            var inf = p[0] || "";
            var url = "";
            for (var i = 1; i < p.length; i++) {
                if (p[i].trim() && p[i].trim()[0] !== "#") {
                    url = p[i].trim();
                    break;
                }
            }
            if (!url) return;
            var name = "???";
            var ci = inf.indexOf(",");
            if (ci > 0) name = inf.substr(ci + 1).trim();
            var cat = "";
            var gm = inf.match(/group-title="([^"]*)"/i);
            if (gm) cat = gm[1];
            var logo = "";
            var lm = inf.match(/tvg-logo="([^"]*)"/i);
            if (lm) logo = lm[1];
            if (!cat) cat = lc || "Other";
            lc = cat;
            var h = xxHash32S(url, true);
            addChan2cat(cat, h);
            if (cList.indexOf(h) === -1) {
                cList.push(h);
                chanels[h] = {
                    ca: "",
                    caso: "",
                    category: { class: catsArray.indexOf(cat) + 2, name: cat },
                    channel_name: name,
                    epg: "",
                    logo: logo,
                    rec: 0,
                    time: 0,
                    time_to: 0,
                    tn: name,
                    url: url,
                };
            }
        });
    } catch (e) {
        console.error(e);
    }
    cb();
}
function _ultifl1x_xtream(cb) {
    $(launch_id).append(_("Loading from API..."));
    var api =
        _ultifl1x_cfg.server +
        "/player_api.php?username=" +
        encodeURIComponent(_ultifl1x_cfg.user) +
        "&password=" +
        encodeURIComponent(_ultifl1x_cfg.pass);
    $.ajax({ dataType: "json", timeout: 15e3, type: "GET", url: api })
        .done(function (r) {
            cList = [];
            chanels = {};
            cats = {};
            catsArray = [];
            if (!(r && r.live_streams)) {
                _ultifl1x_cfg.m3u =
                    api.replace("/player_api.php", "/get.php") +
                    "&type=m3u_plus&output=ts";
                _ultifl1x_m3u(cb);
                return;
            }
            var cm = {};
            if (r.categories)
                r.categories.forEach(function (c) {
                    cm[c.category_id] = c.category_name || "Unknown";
                });
            r.live_streams.forEach(function (s) {
                var h = xxHash32S(s.name, true);
                var cn = cm[s.category_id] || "Other";
                addChan2cat(cn, h);
                if (cList.indexOf(h) === -1) {
                    cList.push(h);
                    chanels[h] = {
                        ca: "",
                        caso: "",
                        category: {
                            class: catsArray.indexOf(cn) + 2,
                            name: cn,
                        },
                        channel_name: s.name,
                        epg: String(s.stream_id),
                        logo: s.stream_icon || "",
                        rec: 0,
                        time: 0,
                        time_to: 0,
                        tn: s.name,
                        url:
                            _ultifl1x_cfg.server +
                            "/live/" +
                            encodeURIComponent(_ultifl1x_cfg.user) +
                            "/" +
                            encodeURIComponent(_ultifl1x_cfg.pass) +
                            "/" +
                            s.stream_id +
                            ".m3u8",
                    };
                }
            });
            cb();
        })
        .fail(function () {
            _ultifl1x_cfg.m3u =
                _ultifl1x_cfg.server.replace(/\/+$/, "") +
                "/get.php?username=" +
                encodeURIComponent(_ultifl1x_cfg.user) +
                "&password=" +
                encodeURIComponent(_ultifl1x_cfg.pass) +
                "&type=m3u_plus&output=ts";
            _ultifl1x_m3u(cb);
        });
}
function duneAddSettings(e) {
    _ultifl1x_load();
    popupArray.splice(e, 1, "");
    popupDetail.splice(e, 1, _("ULTIFL1X settings"));
    popupActions.splice(e, 1, _ultifl1x_edit);
    var idx = popupActions.indexOf(_ultifl1x_edit);
    if (idx > -1) {
        var lbl = _("ULTIFL1X settings");
        if (_ultifl1x_cfg.server && _ultifl1x_cfg.user)
            lbl +=
                ": " +
                _ultifl1x_cfg.server.replace(/^https?:\/\//, "").split("/")[0] +
                " (" +
                _ultifl1x_cfg.user +
                ")";
        else if (_ultifl1x_cfg.m3u)
            lbl += ": " + _ultifl1x_cfg.m3u.substr(0, 40) + "...";
        popupArray[idx] = lbl;
    }
}
function _ultifl1x_edit() {
    selIndex = 0;
    _ultifl1x_load();
    var srv = _ultifl1x_cfg.server,
        usr = _ultifl1x_cfg.user,
        pwd = _ultifl1x_cfg.pass,
        m3u = _ultifl1x_cfg.m3u;
    function bl() {
        listArray = [
            _("Server") + ": " + (srv || ""),
            _("Login") + ": " + (usr || ""),
            _("Password") + ": " + (pwd ? "********" : ""),
            _("M3U") + ": " + (m3u ? m3u.substr(0, 45) : ""),
            "",
            _("Save and load"),
        ];
    }
    var ii = [
        _("API server URL"),
        _("Username"),
        _("Password"),
        _("M3U URL (fallback)"),
        "",
        _("Save & load channels"),
    ];
    bl();
    getListItem = function (e, r) {
        return "&nbsp;&nbsp;" + e;
    };
    detailListAction = function () {
        listDetail.innerHTML = ii[selIndex] || "";
    };
    listKeyHandler = function (e) {
        switch (e) {
            case keys.ENTER:
                switch (selIndex) {
                    case 0:
                        editCaption = _("Server URL");
                        editvar = srv;
                        setEdit = function () {
                            srv = editvar.trim();
                            bl();
                            showPage();
                        };
                        showEditKey(keys.ENTER);
                        return true;
                    case 1:
                        editCaption = _("Username");
                        editvar = usr;
                        setEdit = function () {
                            usr = editvar.trim();
                            bl();
                            showPage();
                        };
                        showEditKey(keys.ENTER);
                        return true;
                    case 2:
                        editCaption = _("Password");
                        editvar = pwd;
                        setEdit = function () {
                            pwd = editvar.trim();
                            bl();
                            showPage();
                        };
                        showEditKey(keys.ENTER);
                        return true;
                    case 3:
                        editCaption = _("M3U URL");
                        editvar = m3u;
                        setEdit = function () {
                            m3u = editvar.trim();
                            bl();
                            showPage();
                        };
                        showEditKey(keys.ENTER);
                        return true;
                    case 5:
                        _ultifl1x_cfg.server = srv;
                        _ultifl1x_cfg.user = usr;
                        _ultifl1x_cfg.pass = pwd;
                        _ultifl1x_cfg.m3u = m3u;
                        _ultifl1x_save();
                        duneAddSettings(0);
                        loadChannels();
                        return true;
                }
                return true;
            case keys.RETURN:
                popupList(popupActions.indexOf(noProvParam) + 1);
                return true;
            default:
                return false;
        }
    };
    listDetail.innerHTML = "";
    listCaption.innerHTML = _("ULTIFL1X");
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    $("#listPopUp").hide();
    showPage();
}

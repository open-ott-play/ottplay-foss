version += " drvao-0219";
p_pref = "drvao";
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
var _drvao_cfg = { server: "", user: "", pass: "", m3u: "" };
function _drvao_load() {
    try {
        var d = providerGetItem("cfg");
        if (d) _drvao_cfg = JSON.parse(d);
    } catch (e) {}
    if (!(_drvao_cfg.server || _drvao_cfg.m3u))
        _drvao_cfg = { server: "", user: "", pass: "", m3u: "" };
}
function _drvao_save() {
    providerSetItem("cfg", JSON.stringify(_drvao_cfg));
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
    _drvao_load();
    if (_drvao_cfg.server && _drvao_cfg.user && _drvao_cfg.pass)
        _drvao_xtream(cb);
    else if (_drvao_cfg.m3u) _drvao_m3u(cb);
    else {
        alert(_("Configure DRVAO in Settings -> Provider Settings"));
        cb();
    }
}
function _drvao_m3u(cb) {
    $(launch_id).append(_("Loading M3U..."));
    $.ajax({
        url: _drvao_cfg.m3u,
        timeout: 15e3,
        success: function (d) {
            _drvao_parseM3U(d, cb);
        },
        error: function () {
            $.ajax({
                url: host + "/m3u/cp.php",
                data: { url: "@" + _drvao_cfg.m3u },
                method: "post",
                dataType: "text",
                timeout: 15e3,
                success: function (d) {
                    _drvao_parseM3U(d, cb);
                },
                error: function () {
                    alert(_("Failed to load!"));
                    cb();
                },
            });
        },
    });
}
function _drvao_parseM3U(data, cb) {
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
                    channel_name: name,
                    category: { class: catsArray.indexOf(cat) + 2, name: cat },
                    rec: 0,
                    time: 0,
                    time_to: 0,
                    url: url,
                    logo: logo,
                    epg: "",
                    tn: name,
                    ca: "",
                    caso: "",
                };
            }
        });
    } catch (e) {
        console.error(e);
    }
    cb();
}
function _drvao_xtream(cb) {
    $(launch_id).append(_("Loading from API..."));
    var api =
        _drvao_cfg.server +
        "/player_api.php?username=" +
        encodeURIComponent(_drvao_cfg.user) +
        "&password=" +
        encodeURIComponent(_drvao_cfg.pass);
    $.ajax({ type: "GET", url: api, dataType: "json", timeout: 15e3 })
        .done(function (r) {
            cList = [];
            chanels = {};
            cats = {};
            catsArray = [];
            if (!(r && r.live_streams)) {
                _drvao_cfg.m3u =
                    api.replace("/player_api.php", "/get.php") +
                    "&type=m3u_plus&output=ts";
                _drvao_m3u(cb);
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
                        channel_name: s.name,
                        category: {
                            class: catsArray.indexOf(cn) + 2,
                            name: cn,
                        },
                        rec: 0,
                        time: 0,
                        time_to: 0,
                        url:
                            _drvao_cfg.server +
                            "/live/" +
                            encodeURIComponent(_drvao_cfg.user) +
                            "/" +
                            encodeURIComponent(_drvao_cfg.pass) +
                            "/" +
                            s.stream_id +
                            ".m3u8",
                        logo: s.stream_icon || "",
                        epg: String(s.stream_id),
                        tn: s.name,
                        ca: "",
                        caso: "",
                    };
                }
            });
            cb();
        })
        .fail(function () {
            _drvao_cfg.m3u =
                _drvao_cfg.server.replace(/\/+$/, "") +
                "/get.php?username=" +
                encodeURIComponent(_drvao_cfg.user) +
                "&password=" +
                encodeURIComponent(_drvao_cfg.pass) +
                "&type=m3u_plus&output=ts";
            _drvao_m3u(cb);
        });
}
function duneAddSettings(e) {
    _drvao_load();
    popupArray.splice(e, 1, "");
    popupDetail.splice(e, 1, _("DRVAO settings"));
    popupActions.splice(e, 1, _drvao_edit);
    var idx = popupActions.indexOf(_drvao_edit);
    if (idx > -1) {
        var lbl = _("DRVAO settings");
        if (_drvao_cfg.server && _drvao_cfg.user)
            lbl +=
                ": " +
                _drvao_cfg.server.replace(/^https?:\/\//, "").split("/")[0] +
                " (" +
                _drvao_cfg.user +
                ")";
        else if (_drvao_cfg.m3u)
            lbl += ": " + _drvao_cfg.m3u.substr(0, 40) + "...";
        popupArray[idx] = lbl;
    }
}
function _drvao_edit() {
    selIndex = 0;
    _drvao_load();
    var srv = _drvao_cfg.server,
        usr = _drvao_cfg.user,
        pwd = _drvao_cfg.pass,
        m3u = _drvao_cfg.m3u;
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
                        _drvao_cfg.server = srv;
                        _drvao_cfg.user = usr;
                        _drvao_cfg.pass = pwd;
                        _drvao_cfg.m3u = m3u;
                        _drvao_save();
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
    listCaption.innerHTML = _("DRVAO");
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    $("#listPopUp").hide();
    showPage();
}

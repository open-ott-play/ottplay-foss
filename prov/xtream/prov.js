version += " xtream-0219";
p_pref = "xtream";
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

var xtream = {
    data: null,
    password: "",
    server: "",
    username: "",
};

function loadXtreamParams() {
    try {
        var d = providerGetItem("xtream_data");
        if (d) xtream = JSON.parse(d);
    } catch (e) {}
    if (!xtream.server)
        xtream = { data: null, password: "", server: "", username: "" };
}

function saveXtreamParams() {
    var d = {
        data: null,
        password: xtream.password,
        server: xtream.server,
        username: xtream.username,
    };
    providerSetItem("xtream_data", JSON.stringify(d));
}

function getChannelPicon(e) {
    return chanels[e] ? chanels[e].logo || "" : "";
}
function getChannelUrl(e) {
    return chanels[e] ? chanels[e].url || "" : "";
}

function getArchiveUrl(e, r, t) {
    if (t < r) t = Date.now() / 1e3;
    if (!(chanels[e] && chanels[e].caso)) return "";
    var src = chanels[e].caso;
    return src
        .replace(/\${start}/g, Math.floor(r))
        .replace(/\${end}/g, Math.floor(t))
        .replace(/\${timestamp}/g, Math.floor(Date.now() / 1e3))
        .replace(/\${offset}/g, Math.floor(Date.now() / 1e3) - Math.floor(r))
        .replace(/\${duration}/g, Math.floor(t - r));
}

function getEPGchanel(s, e) {
    loadXtreamParams();
    if (!(xtream.server && xtream.username && xtream.password)) {
        e(s, null);
        return;
    }
    var streamId = chanels[s] ? chanels[s].epg : "";
    if (!streamId) {
        e(s, null);
        return;
    }
    var url =
        xtream.server +
        "/player_api.php?username=" +
        encodeURIComponent(xtream.username) +
        "&password=" +
        encodeURIComponent(xtream.password) +
        "&action=get_short_epg&stream_id=" +
        streamId;
    $.ajax({
        dataType: "json",
        timeout: 1e4,
        type: "GET",
        url: url,
    })
        .done(function (r) {
            var o = null;
            if (r && Array.isArray(r.epg_listings)) {
                o = [];
                r.epg_listings.forEach(function (epg) {
                    var start = new Date(epg.start).getTime() / 1e3;
                    var end = new Date(epg.end).getTime() / 1e3;
                    if (!(isNaN(start) || isNaN(end))) {
                        o.push({
                            descr: epg.description || "",
                            icon: "",
                            name: epg.title || "No title",
                            time: start,
                            time_to: end,
                        });
                    }
                });
            }
            e(s, o);
        })
        .fail(function () {
            e(s, null);
        });
}

function addChan2cat(catName, hash) {
    if (!(catName && hash)) return;
    if (!cats[catName]) {
        catsArray.push(catName);
        cats[catName] = [];
    }
    cats[catName].push(hash);
}

function getChanelsArray(callback) {
    loadXtreamParams();
    if (!(xtream.server && xtream.username && xtream.password)) {
        editXtreamSettings();
        return;
    }
    $(launch_id).append(_("Loading channels from Xtream API..."));
    var apiUrl =
        xtream.server +
        "/player_api.php?username=" +
        encodeURIComponent(xtream.username) +
        "&password=" +
        encodeURIComponent(xtream.password);
    $.ajax({
        dataType: "json",
        timeout: 15e3,
        type: "GET",
        url: apiUrl,
    })
        .done(function (r) {
            cList = [];
            chanels = {};
            cats = {};
            catsArray = [];
            if (!(r && r.live_streams)) {
                alert(_("Failed to load channels from Xtream API"));
                callback();
                return;
            }
            var catMap = {};
            if (r.categories) {
                r.categories.forEach(function (c) {
                    catMap[c.category_id] = c.category_name || "Unknown";
                });
            }
            r.live_streams.forEach(function (s) {
                var h = xxHash32S(s.name, true);
                var catName = catMap[s.category_id] || "Other";
                addChan2cat(catName, h);
                if (cList.indexOf(h) === -1) {
                    cList.push(h);
                    chanels[h] = {
                        ca: "",
                        caso: "",
                        category: {
                            class: catsArray.indexOf(catName) + 2,
                            name: catName,
                        },
                        channel_name: s.name,
                        epg: String(s.stream_id),
                        logo: s.stream_icon || "",
                        rec: 0,
                        time: 0,
                        time_to: 0,
                        tn: s.name,
                        url:
                            xtream.server +
                            "/live/" +
                            encodeURIComponent(xtream.username) +
                            "/" +
                            encodeURIComponent(xtream.password) +
                            "/" +
                            s.stream_id +
                            ".m3u8",
                    };
                }
            });
            callback();
        })
        .fail(function (e, r, t) {
            console.error("Xtream API error:", r, e.status, t);
            alert(_("Failed to connect to Xtream API server"));
            callback();
        });
}

function duneAddSettings(e) {
    loadXtreamParams();
    popupArray.splice(e, 1, "");
    popupDetail.splice(e, 1, _("Xtream Codes settings"));
    popupActions.splice(e, 1, editXtreamSettings);
    updateXtreamPopup();
}

function updateXtreamPopup() {
    loadXtreamParams();
    var idx = popupActions.indexOf(editXtreamSettings);
    if (idx === -1) return;
    var label = _("Xtream Codes settings");
    if (xtream.server) {
        var hostname = xtream.server.replace(/^https?:\/\//, "").split("/")[0];
        label += ": " + hostname + " (" + xtream.username + ")";
    }
    popupArray[idx] = label;
}

function editXtreamSettings() {
    selIndex = 0;
    var i = [
        _("Enter Xtream server URL"),
        _("Enter username"),
        _("Enter password"),
        "",
        _("Save and load channels"),
    ];
    listArray = ["", "", "", "", _("Save and load channels")];
    loadXtreamParams();
    var srv = xtream.server,
        usr = xtream.username,
        pwd = xtream.password;
    function buildList() {
        listArray = [
            _("Server") + ": " + (srv || ""),
            _("Username") + ": " + (usr || ""),
            _("Password") + ": " + (pwd ? "********" : ""),
            "",
            _("Save and load channels"),
        ];
        listDataArray = listArray;
        i = [
            _("Enter Xtream server URL (e.g. http://your-server:8080)"),
            _("Enter username"),
            _("Enter password"),
            "",
            _("Save settings and load channel list"),
        ];
    }
    buildList();
    getListItem = function (e, r) {
        return "&nbsp;&nbsp;" + e;
    };
    detailListAction = function () {
        listDetail.innerHTML = i[selIndex] || "";
    };
    listKeyHandler = function (e) {
        switch (e) {
            case keys.ENTER:
                switch (selIndex) {
                    case 0:
                        editCaption = _("Enter Xtream server URL");
                        editvar = srv;
                        setEdit = function () {
                            srv = editvar.trim();
                            buildList();
                            showPage();
                        };
                        showEditKey(keys.ENTER);
                        return true;
                    case 1:
                        editCaption = _("Enter username");
                        editvar = usr;
                        setEdit = function () {
                            usr = editvar.trim();
                            buildList();
                            showPage();
                        };
                        showEditKey(keys.ENTER);
                        return true;
                    case 2:
                        editCaption = _("Enter password");
                        editvar = pwd;
                        setEdit = function () {
                            pwd = editvar.trim();
                            buildList();
                            showPage();
                        };
                        showEditKey(keys.ENTER);
                        return true;
                    case 4:
                        xtream.server = srv;
                        xtream.username = usr;
                        xtream.password = pwd;
                        saveXtreamParams();
                        updateXtreamPopup();
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
    listCaption.innerHTML = _("Xtream Codes Provider");
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    $("#listPopUp").hide();
    showPage();
}

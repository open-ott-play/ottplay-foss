version += " edem-0219";
p_pref = "edem";
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

// codeql[js/cleartext-storage-of-credentials] false positive — provider config field, not a credential, stored in localStorage by design
var edem = {
    server: "",
    username: "",
    password: "",
    m3u_url: "",
};

function loadEdemParams() {
    try {
        var d = providerGetItem("edem_data");
        if (d) edem = JSON.parse(d);
    } catch (e) {}
    if (!(edem.server || edem.m3u_url))
        edem = { server: "", username: "", password: "", m3u_url: "" };
}

function saveEdemParams() {
    providerSetItem(
        "edem_data",
        JSON.stringify({
            server: edem.server,
            username: edem.username,
            password: edem.password,
            m3u_url: edem.m3u_url,
        })
    );
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

function getChanelsArray(callback) {
    loadEdemParams();
    if (edem.server && edem.username && edem.password) {
        loadFromXtreamAPI(callback);
    } else if (edem.m3u_url) {
        loadFromM3U(callback);
    } else {
        editEdemSettings();
    }
}

function loadFromM3U(callback) {
    $(launch_id).append(_("Loading M3U playlist..."));
    $.ajax({
        url: edem.m3u_url,
        timeout: 15e3,
        success: function (data) {
            parseM3U(data, callback);
        },
        error: function (e, r, t) {
            $(launch_id).append(_("Loading via proxy..."));
            $.ajax({
                url: host + "/m3u/cp.php",
                data: { url: "@" + edem.m3u_url },
                method: "post",
                dataType: "text",
                timeout: 15e3,
                success: function (data) {
                    parseM3U(data, callback);
                },
                error: function () {
                    alert(_("Failed to load playlist!"));
                    callback();
                },
            });
        },
    });
}

function parseM3U(data, callback) {
    cList = [];
    chanels = {};
    cats = {};
    catsArray = [];
    try {
        var lines = data.split("#EXTINF:");
        var header = lines[0] || "";
        lines.shift();
        var lastCat = "";
        lines.forEach(function (block) {
            var parts = block.split("\n");
            var info = parts[0] || "";
            var url = "";
            for (var i = 1; i < parts.length; i++) {
                if (parts[i].trim() && parts[i].trim()[0] !== "#") {
                    url = parts[i].trim();
                    break;
                }
            }
            if (!url) return;
            var name = "???";
            var commaIdx = info.indexOf(",");
            if (commaIdx > 0) name = info.substr(commaIdx + 1).trim();
            var cat = "";
            var grpMatch = info.match(/group-title="([^"]*)"/i);
            if (grpMatch) cat = grpMatch[1];
            var logo = "";
            var logoMatch = info.match(/tvg-logo="([^"]*)"/i);
            if (logoMatch) logo = logoMatch[1];
            if (!cat) cat = lastCat || "Other";
            lastCat = cat;
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
        alert(_("Failed to parse playlist!"));
    }
    callback();
}

function loadFromXtreamAPI(callback) {
    $(launch_id).append(_("Loading from Edem API..."));
    var apiUrl =
        edem.server +
        "/player_api.php?username=" +
        encodeURIComponent(edem.username) +
        "&password=" +
        encodeURIComponent(edem.password);
    $.ajax({
        type: "GET",
        url: apiUrl,
        dataType: "json",
        timeout: 15e3,
    })
        .done(function (r) {
            cList = [];
            chanels = {};
            cats = {};
            catsArray = [];
            if (!(r && r.live_streams)) {
                edem.m3u_url =
                    apiUrl.replace("/player_api.php", "/get.php") +
                    "&type=m3u_plus&output=ts";
                loadFromM3U(callback);
                return;
            }
            var catMap = {};
            if (r.categories)
                r.categories.forEach(function (c) {
                    catMap[c.category_id] = c.category_name || "Unknown";
                });
            r.live_streams.forEach(function (s) {
                var h = xxHash32S(s.name, true);
                var catName = catMap[s.category_id] || "Other";
                addChan2cat(catName, h);
                if (cList.indexOf(h) === -1) {
                    cList.push(h);
                    chanels[h] = {
                        channel_name: s.name,
                        category: {
                            class: catsArray.indexOf(catName) + 2,
                            name: catName,
                        },
                        rec: 0,
                        time: 0,
                        time_to: 0,
                        url:
                            edem.server +
                            "/live/" +
                            encodeURIComponent(edem.username) +
                            "/" +
                            encodeURIComponent(edem.password) +
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
            callback();
        })
        .fail(function () {
            $(launch_id).append(_("API failed, trying M3U..."));
            edem.m3u_url =
                edem.server.replace(/\/+$/, "") +
                "/get.php?username=" +
                encodeURIComponent(edem.username) +
                "&password=" +
                encodeURIComponent(edem.password) +
                "&type=m3u_plus&output=ts";
            loadFromM3U(callback);
        });
}

function duneAddSettings(e) {
    loadEdemParams();
    popupArray.splice(e, 1, "");
    popupDetail.splice(e, 1, _("Edem / iLookTV settings"));
    popupActions.splice(e, 1, editEdemSettings);
    updateEdemPopup();
}

function updateEdemPopup() {
    loadEdemParams();
    var idx = popupActions.indexOf(editEdemSettings);
    if (idx === -1) return;
    var label = _("Edem / iLookTV settings");
    if (edem.server && edem.username) {
        var hostname = edem.server.replace(/^https?:\/\//, "").split("/")[0];
        label += ": " + hostname + " (" + edem.username + ")";
    } else if (edem.m3u_url) {
        label += ": " + edem.m3u_url.substr(0, 40) + "...";
    }
    popupArray[idx] = label;
}

function editEdemSettings() {
    selIndex = 0;
    loadEdemParams();
    var srv = edem.server,
        usr = edem.username,
        pwd = edem.password,
        m3u = edem.m3u_url;
    function buildList() {
        listArray = [
            _("API Server") + ": " + (srv || ""),
            _("Username") + ": " + (usr || ""),
            _("Password") + ": " + (pwd ? "********" : ""),
            _("M3U URL") + ": " + (m3u ? m3u.substr(0, 50) : ""),
            "",
            _("Save and load channels"),
        ];
        listDataArray = listArray;
    }
    var i = [
        _("Enter API server URL (or leave empty for M3U only)"),
        _("Enter username"),
        _("Enter password"),
        _("Enter M3U playlist URL (fallback)"),
        "",
        _("Save settings and load channel list"),
    ];
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
                        editCaption = _("Enter API server URL");
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
                    case 3:
                        editCaption = _("Enter M3U playlist URL");
                        editvar = m3u;
                        setEdit = function () {
                            m3u = editvar.trim();
                            buildList();
                            showPage();
                        };
                        showEditKey(keys.ENTER);
                        return true;
                    case 5:
                        edem.server = srv;
                        edem.username = usr;
                        edem.password = pwd;
                        edem.m3u_url = m3u;
                        saveEdemParams();
                        updateEdemPopup();
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
    listCaption.innerHTML = _("Edem / iLookTV Provider");
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    $("#listPopUp").hide();
    showPage();
}

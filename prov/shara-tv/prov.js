version += " sharatv-0906";
var login, pass;
p_pref = "shtv";
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

function _getParams() {
    login = providerGetItem("login") || "";
    pass = providerGetItem("pass") || "";
}

function getProviderParams() {
    _getParams();
    try {
        $("#login").val(login);
        $("#pass").val(pass);
    } catch (e) {}
    if (login.length != 8 || pass.length != 8)
        alert("Для доступа необходимо ввести Логин и пароль!");
    return login.length == 8 && pass.length == 8;
}

function setProviderParams() {
    providerSetItem("login", decodeURIComponent($("#login").val().trim()));
    var changed = login != providerGetItem("login");
    providerSetItem("pass", decodeURIComponent($("#pass").val().trim()));
    changed = changed || pass != providerGetItem("pass");
    _getParams();
    if (login.length != 8 || pass.length != 8)
        alert("Для доступа необходимо ввести Логин и пароль!");
    return changed;
}

function getChannelPicon(ch_id) {
    return chanels[ch_id] ? chanels[ch_id].logo || "" : "";
}

function getChannelUrl(ch_id) {
    return chanels[ch_id] ? chanels[ch_id].url || "" : "";
}

function getArchiveUrl(ch_id, time, time_to) {
    return getChannelUrl(ch_id) + "?utc=" + Math.floor(time);
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
                var e = val.split("\n"),
                    cat = getAttribute(e[0], "group-title"),
                    epg = getAttribute(e[0], "tvg-id"),
                    logo = getAttribute(e[0], "tvg-logo"),
                    rec = getAint(e[0], "catchup-days") * 24,
                    aurl = getAttribute(e[0], "catchup-source"),
                    cn = "??? Нет названия канала",
                    url = "";
                try {
                    cn = e[0].split(",")[1].trim();
                } catch (ex) {}
                try {
                    url = e[1].trim();
                } catch (ex) {}
                if (url.indexOf("#EXTGRP:") != -1) {
                    try {
                        url = e[2].trim();
                    } catch (ex) {}
                    if (!cat) {
                        try {
                            cat = e[1].split("#EXTGRP:")[1].trim();
                        } catch (ex) {}
                    }
                }
                var ci = "";
                try {
                    ci = url.split("/")[3] || "";
                } catch (ex) {}
                if (url && ci && cList.indexOf(ci) == -1) {
                    addChan2cat(cat, ci);
                    cList.push(ci);
                    chanels[ci] = {
                        aurl: aurl,
                        category: {
                            class: catsArray.indexOf(cat) + 2,
                            name: cat,
                        },
                        channel_name: cn,
                        ch_id: ci,
                        epg: epg,
                        logo: logo,
                        rec: rec,
                        time: 0,
                        time_to: 0,
                        url: url,
                    };
                }
            });
            if (login.length != 8 || pass.length != 8) {
                try {
                    popupList(popupActions.indexOf(noProvParam) + 1);
                } catch (ex) {}
                infoBox("Для доступа необходимо ввести Логин и пароль!");
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
            alert(
                "Ошибка обработки списка каналов! Проверьте правильность данных!!"
            );
        }
        callback();
    }

    if (!login || !pass || login.length != 8 || pass.length != 8) {
        try {
            popupList(popupActions.indexOf(noProvParam) + 1);
        } catch (ex) {}
        infoBox(
            !login || !pass
                ? "Логин или пароль отсутсвуют!"
                : "Для доступа необходимо ввести Логин и пароль!"
        );
        callback();
        return;
    }

    loadPlaylist(
        "http://tvfor.pro/g/" + login + ":" + pass + "/1/playlist.m3u",
        aSuccess,
        callback
    );
}

function getEPGchanel(ch_id, callback) {
    var d = null;
    if (!(chanels[ch_id] && chanels[ch_id].epg)) {
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
        url:
            "http://epg.drm-play.com/shara-tv/epg/" +
            chanels[ch_id].epg +
            ".json",
    });
}

var provName = "shara-tv";

function duneAddSettings(ind) {
    if (isNaN(parseInt(providerGetItem("sShowArchive"), 10)))
        providerSetItem("sShowArchive", 1);
    _getParams();
    popupArray.splice(ind, 0, provName + ": Логин", provName + ": Пароль");
    popupDetail.splice(
        ind,
        0,
        "Ввод логина " +
            provName +
            " (после изменения нужно перезапустить плеер)",
        "Ввод пароля " +
            provName +
            " (после изменения нужно перезапустить плеер)"
    );
    popupActions.splice(ind, 0, edit_login, edit_pass);
}

function edit_login() {
    editCaption = "Редактирование логина " + provName;
    editvar = login;
    setEdit = function () {
        if (editvar.length != 8) {
            alert("Для доступа необходимо ввести Логин (8 символов)!");
            showEditKey([0, 2]);
            return;
        }
        login = editvar;
        providerSetItem("login", login);
    };
    showEditKey([0, 2]);
}

function edit_pass() {
    editCaption = "Редактирование пароля " + provName;
    editvar = pass;
    setEdit = function () {
        if (editvar.length != 8) {
            alert("Для доступа необходимо ввести Пароль (8 символов)!");
            showEditKey([0, 2]);
            return;
        }
        pass = editvar;
        providerSetItem("pass", pass);
    };
    showEditKey([0, 2]);
}

_getParams();

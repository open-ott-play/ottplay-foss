version += " itv-0906";
var itvkey,
    itvmpeg,
    wwwapi = "http://api.01cdn.wf/";
p_pref = "itv";
parental = /XXX|Взрослые|Для взрослых|Эротика|18\+|Adults|Взрослый/i;

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
    itvkey = providerGetItem("key") || "";
    itvmpeg = parseInt(providerGetItem("mpeg"), 10) || 0;
}

function getProviderParams() {
    _getParams();
    try {
        $("#itvkey").val(itvkey);
    } catch (e) {}
    if (itvkey.length < 10 || itvkey.length > 12)
        alert(
            "Для доступа необходимо ввести ключ! (Ключ для плеера 10-12 символов)"
        );
    return itvkey;
}

function setProviderParams() {
    providerSetItem("key", decodeURIComponent($("#itvkey").val().trim()));
    var changed = itvkey != providerGetItem("key");
    _getParams();
    if (itvkey.length < 10 || itvkey.length > 12)
        alert(
            "Для доступа необходимо ввести ключ! (Ключ для плеера 10-12 символов)"
        );
    return changed;
}

function getChannelPicon(ch_id) {
    return wwwapi + "icon/" + ch_id;
}

function getChannelUrl(ch_id) {
    return (
        "http://" +
        chanels[ch_id].server_cdn +
        "/" +
        ch_id +
        "/" +
        ["index.m3u8", "mpegts", "video.m3u8"][itvmpeg] +
        "?token=" +
        chanels[ch_id].token
    );
}

function getArchiveUrl(ch_id, time, time_to) {
    if (time_to < time) time_to = Date.now() / 1000 + 600;
    // MPEGTS or last 10 minutes → absolute timeshift
    if (itvmpeg == 1 || time > Date.now() / 1000 - 600)
        return (
            "http://" +
            chanels[ch_id].server_cdn +
            "/" +
            ch_id +
            "/" +
            ["timeshift_abs-", "timeshift_abs/", "timeshift_abs_video-"][
                itvmpeg
            ] +
            Math.floor(time) +
            [".m3u8", "", ".m3u8"][itvmpeg] +
            "?token=" +
            chanels[ch_id].token
        );
    if (browserName() == "dune") time_to = Math.floor(time_to) + 7200;
    return (
        "http://" +
        chanels[ch_id].server_cdn +
        "/" +
        ch_id +
        "/" +
        ["index-", "", "video-"][itvmpeg] +
        Math.floor(time) +
        "-" +
        Math.floor(time_to - time) +
        ".m3u8?token=" +
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

function getChanelsArray(callback) {
    _getParams();
    cList = [];
    chanels = {};
    cats = {};
    catsArray = [];

    if (itvkey.length < 10 || itvkey.length > 12) {
        try {
            popupList(popupActions.indexOf(noProvParam) + 1);
        } catch (ex) {}
        infoBox(
            "Для доступа необходимо ввести ключ! (Ключ для плеера 10-12 символов)"
        );
        callback();
        return;
    }

    $.ajax({
        complete: function () {
            callback();
        },
        dataType: "json",
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
        },
        success: function (data) {
            if (!(data && data.channels)) return;
            data.channels.forEach(function (val) {
                if (cList.indexOf(val.ch_id) == -1) {
                    addChan2cat(val.cat_name, val.ch_id);
                    cList.push(val.ch_id);
                    chanels[val.ch_id] = {
                        category: {
                            class: catsArray.indexOf(val.cat_name) + 2,
                            name: val.cat_name,
                        },
                        channel_name: val.channel_name,
                        rec: val.rec_time,
                        server_cdn: val.server_cdn,
                        time: 0,
                        time_to: 0,
                        token: val.token,
                    };
                }
            });
        },
        timeout: 30000,
        url: wwwapi + "data/" + itvkey,
    });
}

if (typeof sNextCount == "undefined") sNextCount = -1;

function _getEPGchanel(ch_id, callback, all) {
    var d = [];
    $.ajax({
        complete: function () {
            callback(ch_id, d);
        },
        dataType: "json",
        success: function (data) {
            try {
                data.res.forEach(function (val) {
                    d.push({
                        descr: val.desc,
                        name: val.title,
                        time: val.startTime,
                        time_to: val.stopTime,
                    });
                });
            } catch (e) {}
        },
        timeout: 10000,
        url: wwwapi + "epg/" + ch_id + (all ? "" : "/" + (sNextCount + 2)),
    });
}

function getEPGchanel(ch_id, callback) {
    _getEPGchanel(ch_id, callback, true);
}

function getEPGchanelCur(ch_id, callback) {
    _getEPGchanel(ch_id, callback, false);
}

var itvTarr = ["HLS(a)", "MPEGTS", "HLS(v)"];

function duneAddSettings(ind) {
    if (
        isNaN(parseInt(providerGetItem("mpeg"), 10)) &&
        navigator.userAgent.indexOf("Tizen") != -1
    )
        providerSetItem("mpeg", 2);
    if (isNaN(parseInt(providerGetItem("sShowArchive"), 10)))
        providerSetItem("sShowArchive", 1);
    _getParams();
    popupArray.splice(
        ind,
        0,
        "Ключ доступа iTV.Live",
        "Тип потоков: " + itvTarr[itvmpeg],
        "Информация о подписке"
    );
    popupDetail.splice(
        ind,
        0,
        "Ввод ключа доступа iTV.Live (Ключ для плеера)",
        "Выберите тип потоков:<br>" + itvTarr.join(", "),
        ""
    );
    popupActions.splice(ind, 0, doEditKey, doEditType, doUserInfo);
}

function doEditKey() {
    editCaption = "Редактирование ключа доступа iTV.Live (Ключ для плеера)";
    editvar = itvkey;
    setEdit = function () {
        if (itvkey == editvar) return;
        if (editvar.length < 10 || editvar.length > 12) {
            alert(
                "Для доступа необходимо ввести ключ! (Ключ для плеера 10-12 символов)"
            );
            showEditKey([0, 1]);
            return;
        }
        providerSetItem("key", editvar);
        restart();
    };
    showEditKey([0, 1]);
}

function doEditType() {
    if (++itvmpeg == itvTarr.length) itvmpeg = 0;
    providerSetItem("mpeg", itvmpeg);
    popupArray[popupActions.indexOf(doEditType)] =
        "Тип потоков: " + itvTarr[itvmpeg];
    try {
        listArray[selIndex].name = "Тип потоков: " + itvTarr[itvmpeg];
    } catch (e) {}
    showPage();
    if (!playType) playChannel(catIndex, primaryIndex);
    else if (playType > 0) playArchive(playType + playTime);
}

function doUserInfo() {
    aboutKeyHandler = function () {
        $("#listAbout").hide();
        return true;
    };
    $("#listAbout").html("Загрузка. Подождите...").show();
    $.ajax({
        dataType: "json",
        error: function (jqXHR, textStatus, errorThrown) {
            $("#listAbout").html(
                "get_user_info failed!<br/><br/>jqXHR:" +
                    JSON.stringify(jqXHR) +
                    "<br/>textStatus: " +
                    textStatus +
                    "<br/>errorThrown: " +
                    errorThrown
            );
        },
        success: function (data) {
            if (data !== null) {
                var pi = [];
                try {
                    data.package_info.forEach(function (val) {
                        pi.push(val.name);
                    });
                } catch (e) {}
                var ui = data.user_info || {};
                $("#listAbout").html(
                    "Информация о подписке:<br/>" +
                        "<br/>Логин: " +
                        (ui.login || "") +
                        "<br/>Баланс,$: " +
                        (ui.cash || "") +
                        "<br/>Система: " +
                        ["", "Предоплата", "Постоплата"][ui.pay_system || 0] +
                        "<br/>Пакеты: " +
                        pi.join(", ")
                );
            }
        },
        timeout: 30000,
        url: wwwapi + "data/" + itvkey,
    });
}

_getParams();

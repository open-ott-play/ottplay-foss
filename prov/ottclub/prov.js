version += " ottclub-0220";
var ottwww, ottkey;
p_pref = "";
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
    ottwww = providerGetItem("ottwww") || "";
    ottkey = providerGetItem("ottkey") || "";
}

function getChannelPicon(ch_id) {
    if (!(chanels[ch_id] && chanels[ch_id].img)) return "";
    return "http://" + ottwww + "/images/" + chanels[ch_id].img;
}

function getChannelUrl(ch_id) {
    return "http://" + ottwww + "/stream/" + ottkey + "/" + ch_id + ".m3u8";
}

function getArchiveUrl(ch_id, time, time_to) {
    return (
        getChannelUrl(ch_id) +
        (time_to < Date.now() / 1000 && browserName() != "dune"
            ? "?archive=" + time + "&archive_end=" + time_to
            : "?timeshift=" + time + "&timenow=" + Date.now() / 1000)
    );
}

$.support.cors = true;

function _ottclub_addCats() {
    if (typeof catsArray == "undefined") catsArray = [];
    if (typeof cats == "undefined") cats = {};
    cList.forEach(function (ch_id) {
        var ch = chanels[ch_id];
        if (!ch) return;
        if (!ch.channel_name && ch.name) ch.channel_name = ch.name;
        var cat = "";
        if (ch.category) {
            if (typeof ch.category === "string") cat = ch.category;
            else if (ch.category.name) cat = ch.category.name;
        } else if (ch.group) cat = ch.group;
        else if (ch.group_title) cat = ch.group_title;
        if (!cat) return;
        if (!cats[cat]) {
            catsArray.push(cat);
            cats[cat] = [];
        }
        cats[cat].push(ch_id);
        ch.category = {
            class: catsArray.indexOf(cat) + 2,
            name: cat,
        };
    });
}

function getChanelsArray(callback) {
    _getParams();
    $.ajax({
        complete: function () {
            if (ottwww.length < 4 || ottkey.length < 8) {
                try {
                    popupList(popupActions.indexOf(noProvParam) + 1);
                } catch (e) {}
                infoBox(
                    "Для доступа необходимо ввести ключ и адрес плейлиста!"
                );
            }
            callback();
        },
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
            alert(
                "Не удалось загрузить список каналов! Проверьте правильность адреса плейлиста!!"
            );
        },
        success: function (data) {
            try {
                cList = data.split('"ch_id":"');
                cList.shift();
                cList.forEach(function (val, i) {
                    cList[i] = val.split('","')[0];
                });
                chanels = JSON.parse(data);
                cats = {};
                catsArray = [];
                cList.forEach(function (ch_id) {
                    if (!chanels[ch_id]) return;
                    chanels[ch_id].rec = chanels[ch_id].rec ? 7 * 24 : 0;
                    if (!chanels[ch_id].channel_name && chanels[ch_id].name)
                        chanels[ch_id].channel_name = chanels[ch_id].name;
                    epg[ch_id] = [chanels[ch_id]];
                });
                _ottclub_addCats();
            } catch (e) {
                cList = [];
                chanels = {};
                console.log(
                    "Exception: name " +
                        e.name +
                        ", message " +
                        e.message +
                        ", typeof " +
                        typeof e
                );
                alert(
                    "Не удалось обработать список каналов! Проверьте правильность адреса плейлиста!!"
                );
            }
        },
        url: "http://" + ottwww + "/api/channel_now",
    });
}

function getEPGchanel(ch_id, callback) {
    var d = null;
    $.ajax({
        complete: function () {
            callback(ch_id, d);
        },
        dataType: "json",
        success: function (data) {
            if (data) d = data.epg_data;
        },
        timeout: 30000,
        url: "http://" + ottwww + "/api/channel/" + ch_id,
    });
}

function duneAddSettings(ind) {
    if (typeof delPopup === "function") delPopup(restart);
    _getParams();
    popupArray.splice(
        ind,
        0,
        "OTTCLUB: Адрес плейлиста",
        "OTTCLUB: Ключ доступа"
    );
    popupDetail.splice(
        ind,
        0,
        "Ввод адреса плейлиста OTTCLUB (После изменения плеер перезапустится!)",
        ""
    );
    popupActions.splice(ind, 0, edit_ottwww, edit_ottkey);
}

function edit_ottwww() {
    editCaption = "Редактирование адреса плейлиста OTTCLUB";
    editvar = ottwww;
    setEdit = function () {
        if (ottwww == editvar) return;
        providerSetItem("ottwww", editvar);
        restart();
    };
    showEditKey([0, 2]);
}

function edit_ottkey() {
    editCaption = "Редактирование ключа доступа OTTCLUB";
    editvar = ottkey;
    setEdit = function () {
        if (ottkey == editvar) return;
        ottkey = editvar;
        providerSetItem("ottkey", ottkey);
        playChannel(catIndex, primaryIndex);
    };
    showEditKey([0, 1]);
}

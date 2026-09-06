version += " shura-0906";
var shserver, shkey, mpeg;
p_pref = "sh";
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
    shkey = providerGetItem("key") || "";
    shserver = providerGetItem("server");
    if (!shserver) shserver = "1";
    mpeg = parseInt(providerGetItem("mpeg"), 10) || 0;
}

function getChannelPicon(ch_id) {
    return "http://s" + shserver + ".tvshka.net:81/picon/" + ch_id + ".png";
}

function getChannelUrl(ch_id) {
    return (
        "http://s" +
        shserver +
        ".tvshka.net/~" +
        shkey +
        "/" +
        ch_id +
        "/" +
        (mpeg ? "" : "hls/pl.m3u8")
    );
}

function getArchiveUrl(ch_id, time, time_to) {
    return getChannelUrl(ch_id) + "?archive=" + Math.floor(time);
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

function getChanelsArray(callback) {
    _getParams();

    function aSuccess(data) {
        try {
            var arrEXTINF = data.split("#EXTINF:");
            arrEXTINF.shift();
            cats = {};
            catsArray = [];
            arrEXTINF.forEach(function (val) {
                var e = val.split("\n"),
                    cat = getAttribute(e[0], "group-title"),
                    ci = null;
                try {
                    ci = e[1].split("/")[4];
                } catch (ex) {}
                if (ci && chanels[ci]) {
                    addChan2cat(cat, ci);
                    chanels[ci].category = {
                        class: catsArray.indexOf(cat) + 2,
                        name: cat,
                    };
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
        }
        if (!shkey || shkey.length < 8) {
            try {
                popupList(popupActions.indexOf(noProvParam) + 1);
            } catch (ex) {}
            infoBox("Для доступа необходимо ввести ключ!");
        }
        callback();
    }

    function loadCategories() {
        var www =
            "http://pl.tvshka.net/?uid=shxxxxxxxxxxx&srv=1&type=halva";
        $.ajax({
            dataType: "text",
            error: function () {
                $.ajax({
                    data: { url: "@" + www },
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
                        if (!shkey || shkey.length < 8) {
                            try {
                                popupList(
                                    popupActions.indexOf(noProvParam) + 1
                                );
                            } catch (ex) {}
                            infoBox("Для доступа необходимо ввести ключ!");
                        }
                        callback();
                    },
                    method: "post",
                    success: aSuccess,
                    timeout: 10000,
                    url: host + "/m3u/cp.php",
                });
            },
            success: aSuccess,
            timeout: 10000,
            url: www,
        });
    }

    cList = [];
    chanels = {};
    cats = {};
    catsArray = [];

    $.ajax({
        complete: function () {
            loadCategories();
        },
        data: { type: "jsonp", uid: "shxxxxxxxxxxx" },
        dataType: "jsonp",
        error: function (jqXHR, textStatus, errorThrown) {
            console.log(
                "channels : jqXHR:" +
                    JSON.stringify(jqXHR) +
                    "; textStatus:" +
                    textStatus +
                    " ,errorThrown: " +
                    errorThrown
            );
        },
        success: function (data) {
            if (!data || !data.forEach) return;
            data.forEach(function (val) {
                cList.push(val.id);
                chanels[val.id] = {
                    category: { class: 0 },
                    channel_name: val.name,
                    rec: val.archive,
                    time: 0,
                    time_to: 0,
                };
            });
        },
        timeout: 10000,
        url: "http://pl.tvshka.net",
    });
}

function val2epg(v) {
    return {
        descr: v.text,
        duration: v.duration,
        name: v.name,
        time: v.start_time,
        time_to: v.start_time + v.duration,
    };
}

function getEPGchanel(ch_id, callback) {
    var d = null;
    $.ajax({
        complete: function () {
            $.ajax({
                complete: function () {
                    callback(ch_id, d);
                },
                dataType: "jsonp",
                success: function (data) {
                    if (data !== null) {
                        if (!d) d = [];
                        if (chanels[ch_id] && chanels[ch_id].rec == "0")
                            data.pop();
                        data.forEach(function (val) {
                            d.unshift(val2epg(val));
                        });
                    }
                },
                timeout: 10000,
                url:
                    "http://s" +
                    shserver +
                    ".tvshka.net/" +
                    ch_id +
                    "/epg/" +
                    (chanels[ch_id] && chanels[ch_id].rec == "0"
                        ? "pf.jsonp"
                        : "archive.jsonp"),
            });
        },
        dataType: "jsonp",
        success: function (data) {
            if (data !== null) {
                d = [];
                data.forEach(function (val) {
                    d.push(val2epg(val));
                });
            }
        },
        timeout: 10000,
        url:
            "http://s" + shserver + ".tvshka.net/" + ch_id + "/epg/week.jsonp",
    });
}

function getEPGchanelCur(ch_id, callback) {
    var d = null;
    $.ajax({
        complete: function () {
            callback(ch_id, d);
        },
        dataType: "jsonp",
        success: function (data) {
            if (data !== null) {
                d = [];
                data.forEach(function (val) {
                    d.push(val2epg(val));
                });
            }
        },
        timeout: 10000,
        url: "http://s" + shserver + ".tvshka.net/" + ch_id + "/epg/pf.jsonp",
    });
}

var cbTarr = ["HLS", "MPEGTS"];

function duneAddSettings(ind) {
    if (isNaN(parseInt(providerGetItem("sShowArchive"), 10)))
        providerSetItem("sShowArchive", 1);
    _getParams();
    popupArray.splice(
        ind,
        0,
        "Шура ТВ: номер сервера",
        "Шура ТВ: Ключ доступа",
        "Шура ТВ: Тип потоков: " + cbTarr[mpeg]
    );
    popupDetail.splice(
        ind,
        0,
        "Ввод номера сервера Шура ТВ",
        "Ввод ключа доступа Шура ТВ",
        "Выберите тип потоков: HLS или MPEGTS"
    );
    popupActions.splice(ind, 0, edit_shserver, edit_shkey, doEditType);
}

function edit_shserver() {
    editCaption =
        "Редактирование номера сервера Шура ТВ<br/>Только 1, 2, 3 или 5 !!!";
    editvar = shserver;
    setEdit = function () {
        shserver = editvar;
        providerSetItem("server", shserver);
        playChannel(catIndex, primaryIndex);
    };
    showEditKey([0]);
}

function edit_shkey() {
    editCaption = "Редактирование ключа доступа Шура ТВ";
    editvar = shkey;
    setEdit = function () {
        if (editvar && editvar.length < 8) {
            alert("Для доступа необходимо ввести ключ!");
            setTimeout(function () {
                showEditKey([0, 1, 2]);
            });
            return;
        }
        shkey = editvar;
        providerSetItem("key", shkey);
        playChannel(catIndex, primaryIndex);
    };
    showEditKey([0, 1, 2]);
}

function doEditType() {
    if (++mpeg == 2) mpeg = 0;
    providerSetItem("mpeg", mpeg);
    popupArray[popupActions.indexOf(doEditType)] =
        "Шура ТВ: Тип потоков: " + cbTarr[mpeg];
    popupList(doEditType);
    if (!playType) playChannel(catIndex, primaryIndex);
    else if (playType > 0) playArchive(playType + playTime);
}

_getParams();

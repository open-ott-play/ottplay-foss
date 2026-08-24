version += ' stalker-0219';
p_pref = 'stalker';
parental = /XXX|Взрослые|Для взрослых|Эротика|18\+|Adults/i;

if (typeof stbGetItem === 'function') {
    providerGetItem = function(e) { return stbGetItem(p_pref + e); };
    providerSetItem = function(e, r) { stbSetItem(p_pref + e, r); };
} else {
    providerGetItem = function(e) { return localStorage.getItem(p_pref + e); };
    providerSetItem = function(e, r) { localStorage.setItem(p_pref + e, r); };
}
providerDelItem = function(e) { return ottpStorage.del(p_pref + e); };
providerHasItem = function(e) { return ottpStorage.has(p_pref + e); };
providerHasItemValue = function(e) { return ottpStorage.hasValue(p_pref + e); };

var stalker = {
    portal: '',
    mac: '',
    token: '',
    data: null
};

function loadStalkerParams() {
    try {
        var d = providerGetItem('stalker_data');
        if (d) stalker = JSON.parse(d);
    } catch(e) {}
    if (!stalker.portal) stalker = { portal: '', mac: '', token: '', data: null };
}

function saveStalkerParams() {
    var d = { portal: stalker.portal, mac: stalker.mac, token: '', data: null };
    providerSetItem('stalker_data', JSON.stringify(d));
}

function getChannelPicon(e) { return chanels[e] ? chanels[e].logo || '' : ''; }
function getChannelUrl(e) { return chanels[e] ? chanels[e].url || '' : ''; }

function getArchiveUrl(e, r, t) {
    if (t < r) t = Date.now() / 1e3;
    if (!chanels[e] || !chanels[e].caso) return '';
    return chanels[e].caso.replace(/\${start}/g, Math.floor(r))
        .replace(/\${end}/g, Math.floor(t))
        .replace(/\${timestamp}/g, Math.floor(Date.now() / 1e3))
        .replace(/\${offset}/g, Math.floor(Date.now() / 1e3) - Math.floor(r))
        .replace(/\${duration}/g, Math.floor(t - r));
}

function getEPGchanel(s, e) {
    loadStalkerParams();
    if (!stalker.portal || !stalker.mac) { e(s, null); return; }
    var chId = chanels[s] ? chanels[s].epg : '';
    if (!chId) { e(s, null); return; }
    var apiUrl = stalker.portal.replace(/\/+$/, '') + '/stalker_portal/api/';
    var data = {
        jsonrpc: '2.0',
        id: 1,
        method: 'get_epg',
        params: { ch_id: chId, mac: stalker.mac, from: Math.floor(Date.now() / 1e3 - 86400), to: Math.floor(Date.now() / 1e3 + 86400) }
    };
    $.ajax({
        type: 'POST',
        url: apiUrl,
        data: JSON.stringify(data),
        contentType: 'application/json',
        dataType: 'json',
        timeout: 1e4
    }).done(function(r) {
        var o = null;
        if (r && r.result && Array.isArray(r.result)) {
            o = [];
            r.result.forEach(function(epg) {
                var start = parseInt(epg.start_timestamp) || parseInt(epg.start) || 0;
                var end = parseInt(epg.end_timestamp) || parseInt(epg.end) || 0;
                if (start && end) {
                    o.push({
                        time: start,
                        time_to: end,
                        name: epg.name || epg.title || 'No title',
                        descr: epg.descr || epg.description || '',
                        icon: ''
                    });
                }
            });
        }
        e(s, o);
    }).fail(function() { e(s, null); });
}

function addChan2cat(catName, hash) {
    if (!catName || !hash) return;
    if (!cats[catName]) { catsArray.push(catName); cats[catName] = []; }
    cats[catName].push(hash);
}

function stalkerApiCall(method, params, callback) {
    loadStalkerParams();
    var apiUrl = stalker.portal.replace(/\/+$/, '') + '/stalker_portal/api/';
    if (!params) params = {};
    if (!params.mac) params.mac = stalker.mac;
    var data = { jsonrpc: '2.0', id: 1, method: method, params: params };
    $.ajax({
        type: 'POST',
        url: apiUrl,
        data: JSON.stringify(data),
        contentType: 'application/json',
        dataType: 'json',
        timeout: 15e3
    }).done(callback).fail(function(e, r, t) {
        console.error('Stalker API error:', method, r, e.status);
        callback(null);
    });
}

function getChanelsArray(callback) {
    loadStalkerParams();
    if (!stalker.portal || !stalker.mac) {
        editStalkerSettings();
        return;
    }
    $(launch_id).append(_('Connecting to Stalker portal...'));
    stalkerApiCall('handshake', {}, function(r) {
        if (!r || !r.result) {
            var mac = stalker.mac.replace(/:/g, '').toUpperCase();
            stalkerApiCall('handshake', { mac: stalker.mac }, function(r2) {
                if (!r2 || !r2.result) {
                    alert(_('Failed to connect to Stalker portal'));
                    callback();
                    return;
                }
                loadChannelsFromStalker(callback);
            });
            return;
        }
        loadChannelsFromStalker(callback);
    });
}

function loadChannelsFromStalker(callback) {
    $(launch_id).append(_('Loading channels...'));
    stalkerApiCall('get_channels', {}, function(r) {
        if (!r || !r.result) {
            alert(_('Failed to load channels from Stalker portal'));
            callback();
            return;
        }
        cList = [];
        chanels = {};
        cats = {};
        catsArray = [];
        var channels = r.result;
        if (!Array.isArray(channels)) {
            if (typeof channels === 'object') {
                var items = channels.data || channels.items || channels.channels || [];
                if (Array.isArray(items)) channels = items;
                else {
                    var tmp = [];
                    for (var k in channels) {
                        if (channels.hasOwnProperty(k) && typeof channels[k] === 'object' && channels[k].name) tmp.push(channels[k]);
                    }
                    channels = tmp;
                }
            }
        }
        if (!Array.isArray(channels)) channels = [];
        channels.forEach(function(ch) {
            if (!ch || !ch.name) return;
            var h = ch.id ? Number(ch.id) : xxHash32S(ch.name, true);
            var catName = ch.genre || ch.categories || ch.category || 'Other';
            if (Array.isArray(catName)) catName = catName[0] || 'Other';
            if (typeof catName !== 'string') catName = 'Other';
            addChan2cat(catName, h);
            if (cList.indexOf(h) === -1) {
                cList.push(h);
                var streamUrl = '';
                if (ch.url) streamUrl = ch.url;
                else streamUrl = stalker.portal.replace(/\/+$/, '') + '/stalker_portal/stream/' + ch.id + '.m3u8?mac=' + stalker.mac;
                var logoUrl = ch.logo || ch.icon || ch.tv_icon || '';
                if (logoUrl && logoUrl.indexOf('http') !== 0 && logoUrl.indexOf('//') === 0) {
                    logoUrl = (stalker.portal.indexOf('https') === 0 ? 'https:' : 'http:') + logoUrl;
                } else if (logoUrl && logoUrl.indexOf('http') !== 0 && logoUrl.indexOf('/') === 0) {
                    logoUrl = stalker.portal.replace(/\/+$/, '') + logoUrl;
                }
                chanels[h] = {
                    channel_name: ch.name,
                    category: { class: catsArray.indexOf(catName) + 2, name: catName },
                    rec: parseInt(ch.archive) || parseInt(ch.archive_duration) || 0,
                    time: 0,
                    time_to: 0,
                    url: streamUrl,
                    logo: logoUrl,
                    epg: String(ch.id || ch.ch_id || ''),
                    tn: ch.name,
                    ca: ch.archive ? 'append' : '',
                    caso: ''
                };
            }
        });
        callback();
    });
}

function duneAddSettings(e) {
    loadStalkerParams();
    popupArray.splice(e, 1, '');
    popupDetail.splice(e, 1, _('Stalker portal settings'));
    popupActions.splice(e, 1, editStalkerSettings);
    updateStalkerPopup();
}

function updateStalkerPopup() {
    loadStalkerParams();
    var idx = popupActions.indexOf(editStalkerSettings);
    if (idx === -1) return;
    var label = _('Stalker portal settings');
    if (stalker.portal) {
        var hostname = stalker.portal.replace(/^https?:\/\//, '').split('/')[0];
        label += ': ' + hostname + ' (' + stalker.mac + ')';
    }
    popupArray[idx] = label;
}

function editStalkerSettings() {
    selIndex = 0;
    loadStalkerParams();
    var portal = stalker.portal, mac = stalker.mac;
    function buildList() {
        listArray = [
            _('Portal URL') + ': ' + (portal || ''),
            _('MAC address') + ': ' + (mac || ''),
            '',
            _('Save and load channels')
        ];
        listDataArray = listArray;
    }
    var i = [
        _('Enter Stalker portal URL (e.g. http://your-portal:8800)'),
        _('Enter MAC address (e.g. 00:1A:2B:3C:4D:5E)'),
        '',
        _('Save settings and load channel list')
    ];
    buildList();
    getListItem = function(e, r) { return '&nbsp;&nbsp;' + e; };
    detailListAction = function() { listDetail.innerHTML = i[selIndex] || ''; };
    listKeyHandler = function(e) {
        switch (e) {
            case keys.ENTER:
                switch (selIndex) {
                    case 0:
                        editCaption = _('Enter Stalker portal URL');
                        editvar = portal;
                        setEdit = function() { portal = editvar.trim().replace(/\/+$/, ''); buildList(); showPage(); };
                        showEditKey(keys.ENTER);
                        return true;
                    case 1:
                        editCaption = _('Enter MAC address');
                        editvar = mac;
                        setEdit = function() { mac = editvar.trim().toUpperCase(); buildList(); showPage(); };
                        showEditKey(keys.ENTER);
                        return true;
                    case 3:
                        stalker.portal = portal;
                        stalker.mac = mac;
                        saveStalkerParams();
                        updateStalkerPopup();
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
    listDetail.innerHTML = '';
    listCaption.innerHTML = _('Stalker Portal Provider');
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, 'Close');
    $('#listPopUp').hide();
    showPage();
}

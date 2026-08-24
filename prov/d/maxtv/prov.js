version += ' d_maxtv-0219';
p_pref = 'd_maxtv';
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
var _d_maxtv_cfg = { server: '', user: '', pass: '', m3u: '' };
function _d_maxtv_load() {
    try { var d = providerGetItem('cfg'); if (d) _d_maxtv_cfg = JSON.parse(d); } catch(e) {}
    if (!_d_maxtv_cfg.server && !_d_maxtv_cfg.m3u) _d_maxtv_cfg = { server: '', user: '', pass: '', m3u: '' };
}
function _d_maxtv_save() { providerSetItem('cfg', JSON.stringify(_d_maxtv_cfg)); }
function getChannelPicon(e) { return chanels[e] ? chanels[e].logo || '' : ''; }
function getChannelUrl(e) { return chanels[e] ? chanels[e].url || '' : ''; }
function getEPGchanel(s, e) { e(s, null); }
function addChan2cat(catName, hash) {
    if (!catName || !hash) return;
    if (!cats[catName]) { catsArray.push(catName); cats[catName] = []; }
    cats[catName].push(hash);
}
function getChanelsArray(cb) {
    _d_maxtv_load();
    if (_d_maxtv_cfg.server && _d_maxtv_cfg.user && _d_maxtv_cfg.pass) _d_maxtv_xtream(cb);
    else if (_d_maxtv_cfg.m3u) _d_maxtv_m3u(cb);
    else { alert(_('Configure MaxTV in Settings -> Provider Settings')); cb(); }
}
function _d_maxtv_m3u(cb) {
    $(launch_id).append(_('Loading M3U...'));
    $.ajax({ url: _d_maxtv_cfg.m3u, timeout: 15e3,
        success: function(d) { _d_maxtv_parseM3U(d, cb); },
        error: function() {
            $.ajax({ url: host + '/m3u/cp.php', data: { url: '@' + _d_maxtv_cfg.m3u }, method: 'post', dataType: 'text', timeout: 15e3,
                success: function(d) { _d_maxtv_parseM3U(d, cb); },
                error: function() { alert(_('Failed to load!')); cb(); }
            });
        }
    });
}
function _d_maxtv_parseM3U(data, cb) {
    cList = []; chanels = {}; cats = {}; catsArray = [];
    try {
        var lines = data.split('#EXTINF:'); var hdr = lines[0] || ''; lines.shift(); var lc = '';
        lines.forEach(function(b) {
            var p = b.split('\n'); var inf = p[0] || ''; var url = '';
            for (var i = 1; i < p.length; i++) { if (p[i].trim() && p[i].trim()[0] !== '#') { url = p[i].trim(); break; } }
            if (!url) return;
            var name = '???'; var ci = inf.indexOf(','); if (ci > 0) name = inf.substr(ci + 1).trim();
            var cat = ''; var gm = inf.match(/group-title="([^"]*)"/i); if (gm) cat = gm[1];
            var logo = ''; var lm = inf.match(/tvg-logo="([^"]*)"/i); if (lm) logo = lm[1];
            if (!cat) cat = lc || 'Other'; lc = cat;
            var h = xxHash32S(url, true); addChan2cat(cat, h);
            if (cList.indexOf(h) === -1) {
                cList.push(h);
                chanels[h] = { channel_name: name, category: { class: catsArray.indexOf(cat) + 2, name: cat }, rec: 0, time: 0, time_to: 0, url: url, logo: logo, epg: '', tn: name, ca: '', caso: '' };
            }
        });
    } catch(e) { console.error(e); }
    cb();
}
function _d_maxtv_xtream(cb) {
    $(launch_id).append(_('Loading from API...'));
    var api = _d_maxtv_cfg.server + '/player_api.php?username=' + encodeURIComponent(_d_maxtv_cfg.user) + '&password=' + encodeURIComponent(_d_maxtv_cfg.pass);
    $.ajax({ type: 'GET', url: api, dataType: 'json', timeout: 15e3
    }).done(function(r) {
        cList = []; chanels = {}; cats = {}; catsArray = [];
        if (!r || !r.live_streams) { _d_maxtv_cfg.m3u = api.replace('/player_api.php', '/get.php') + '&type=m3u_plus&output=ts'; _d_maxtv_m3u(cb); return; }
        var cm = {}; if (r.categories) r.categories.forEach(function(c) { cm[c.category_id] = c.category_name || 'Unknown'; });
        r.live_streams.forEach(function(s) {
            var h = xxHash32S(s.name, true); var cn = cm[s.category_id] || 'Other';
            addChan2cat(cn, h);
            if (cList.indexOf(h) === -1) {
                cList.push(h);
                chanels[h] = { channel_name: s.name, category: { class: catsArray.indexOf(cn) + 2, name: cn }, rec: 0, time: 0, time_to: 0, url: _d_maxtv_cfg.server + '/live/' + encodeURIComponent(_d_maxtv_cfg.user) + '/' + encodeURIComponent(_d_maxtv_cfg.pass) + '/' + s.stream_id + '.m3u8', logo: s.stream_icon || '', epg: String(s.stream_id), tn: s.name, ca: '', caso: '' };
            }
        });
        cb();
    }).fail(function() {
        _d_maxtv_cfg.m3u = _d_maxtv_cfg.server.replace(/\/+$/, '') + '/get.php?username=' + encodeURIComponent(_d_maxtv_cfg.user) + '&password=' + encodeURIComponent(_d_maxtv_cfg.pass) + '&type=m3u_plus&output=ts';
        _d_maxtv_m3u(cb);
    });
}
function duneAddSettings(e) {
    _d_maxtv_load();
    popupArray.splice(e, 1, ''); popupDetail.splice(e, 1, _('MaxTV settings'));
    popupActions.splice(e, 1, _d_maxtv_edit);
    var idx = popupActions.indexOf(_d_maxtv_edit);
    if (idx > -1) {
        var lbl = _('MaxTV settings');
        if (_d_maxtv_cfg.server && _d_maxtv_cfg.user) lbl += ': ' + _d_maxtv_cfg.server.replace(/^https?:\/\//, '').split('/')[0] + ' (' + _d_maxtv_cfg.user + ')';
        else if (_d_maxtv_cfg.m3u) lbl += ': ' + _d_maxtv_cfg.m3u.substr(0, 40) + '...';
        popupArray[idx] = lbl;
    }
}
function _d_maxtv_edit() {
    selIndex = 0; _d_maxtv_load();
    var srv = _d_maxtv_cfg.server, usr = _d_maxtv_cfg.user, pwd = _d_maxtv_cfg.pass, m3u = _d_maxtv_cfg.m3u;
    function bl() {
        listArray = [
            _('Server') + ': ' + (srv || ''),
            _('Login') + ': ' + (usr || ''),
            _('Password') + ': ' + (pwd ? '********' : ''),
            _('M3U') + ': ' + (m3u ? m3u.substr(0, 45) : ''),
            '',
            _('Save and load')
        ];
    }
    var ii = [_('API server URL'), _('Username'), _('Password'), _('M3U URL (fallback)'), '', _('Save & load channels')];
    bl();
    getListItem = function(e, r) { return '&nbsp;&nbsp;' + e; };
    detailListAction = function() { listDetail.innerHTML = ii[selIndex] || ''; };
    listKeyHandler = function(e) {
        switch (e) {
            case keys.ENTER:
                switch (selIndex) {
                    case 0: editCaption = _('Server URL'); editvar = srv; setEdit = function() { srv = editvar.trim(); bl(); showPage(); }; showEditKey(keys.ENTER); return true;
                    case 1: editCaption = _('Username'); editvar = usr; setEdit = function() { usr = editvar.trim(); bl(); showPage(); }; showEditKey(keys.ENTER); return true;
                    case 2: editCaption = _('Password'); editvar = pwd; setEdit = function() { pwd = editvar.trim(); bl(); showPage(); }; showEditKey(keys.ENTER); return true;
                    case 3: editCaption = _('M3U URL'); editvar = m3u; setEdit = function() { m3u = editvar.trim(); bl(); showPage(); }; showEditKey(keys.ENTER); return true;
                    case 5: _d_maxtv_cfg.server = srv; _d_maxtv_cfg.user = usr; _d_maxtv_cfg.pass = pwd; _d_maxtv_cfg.m3u = m3u; _d_maxtv_save(); duneAddSettings(0); loadChannels(); return true;
                }
                return true;
            case keys.RETURN: popupList(popupActions.indexOf(noProvParam) + 1); return true;
            default: return false;
        }
    };
    listDetail.innerHTML = ''; listCaption.innerHTML = _('MaxTV');
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, 'Close');
    $('#listPopUp').hide(); showPage();
}

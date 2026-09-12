import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual classic-bundle functions, not a reimplementation of their contracts.
function functions(path: string, names: string[]) {
    const source = fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const nodes = file.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
    assert.equal(nodes.length, names.length);
    return ts.transpileModule(nodes.map(node => node.getText(file).replace(/^export\s+/, '')).join('\n'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    }).outputText;
}
function context(values: Record<string, any>) { return vm.createContext({ console, ...values }); }
const schedule = [{ name: 'Provider programme', time: 10000, time_to: 11000 }];
const channelFunctions = functions('src/channels/index.ts', ['usesNativeXmltv', 'channelXmltvUrls', 'epgTimezoneHours', 'epgArchiveHours', 'applyChannelTvgShift', 'getEPGchanelCached']);

for (const platform of ['browser', 'tauri', 'capacitor']) {
    for (const provider of ['xtream', 'stalker', 'm3u-external', 'm3u-direct-source', 'm3u']) {
        let providerCalls = 0;
        const native: any[] = [];
        const channel = { channel_name: 'Private +4', epg: 'private-id', tn: 'Private', epg_url: 'companion-hash', rec: 168,
            xmltv_urls: ['http://private.test/feed.xml', 'https://backup.test/feed.gz'], ts: -3600,
            epg_external: provider === 'm3u-external', epg_src: provider === 'm3u-direct-source' ? '=private' : 'local' };
        const w: any = { p_pref: provider.startsWith('m3u') ? 'm3u' : provider,
            getEPGchanel(id: number, callback: Function) { providerCalls++; callback(id, schedule); } };
        const fetch = async (args: any) => { native.push(args); return { epg_data: schedule.map(row => ({ ...row })) }; };
        if (platform === 'tauri') w.__TAURI__ = { core: { invoke: (_cmd: string, args: any) => fetch(args) } };
        if (platform === 'capacitor') w.Capacitor = { Plugins: { MobileXmltvEpg: { getEpg: fetch } } };
        const ctx = context({ window: w, channels: { 42: channel }, epgPending: {}, epgCacheGeneration: 0,
            readEpgCache: () => null, cacheFetchedEpg() {} });
        vm.runInContext(channelFunctions, ctx);
        const result: any = await new Promise(resolve => ctx.getEPGchanelCached(42, (_id: number, rows: any) => resolve(rows)));
        const useNative = platform !== 'browser' && provider === 'm3u';
        assert.equal(native.length, useNative ? 1 : 0, `${platform}/${provider}: native route`);
        assert.equal(providerCalls, useNative ? 0 : 1, `${platform}/${provider}: provider route`);
        assert.equal(result[0].time, useNative ? 6400 : 10000, 'tvg-shift belongs only to native XMLTV result; provider result is already shifted');
        if (useNative) {
            assert.deepEqual(Array.from(native[0].xmltv_urls || native[0].xmltvUrls), channel.xmltv_urls);
            assert.equal(native[0].tvgId || native[0].hash, 'private-id');
            assert.equal(native[0].archiveHours || native[0].archive_hours, 168);
        }
    }
}
const providerEpg = () => {};
const override = context({ window: { __TAURI__: {}, getEPGchanel: providerEpg }, getEPGchanelCached() {} });
vm.runInContext(functions('src/index.ts', ['setupTauriEpgOverride']), override);
override.setupTauriEpgOverride();
assert.equal(override.window.getEPGchanel, providerEpg, 'boot never replaces the provider EPG function');

const playlist = '#EXTM3U x-tvg-url="http://first.test/private.xml,https://second.test/guide.gz" foss-tvg="alt::https://alias.test/feed.xml"\n' +
    '#EXTINF:-1 tvg-id="private-id" group-title="Private" tvg-logo="https://logo.test/icon.png",Private +4\nhttps://stream.test/one\n' +
    '#EXTINF:-1 tvg-id="two" tvg-source="#2" group-title="Private" tvg-logo="https://logo.test/icon.png",Second\nhttps://stream.test/two\n' +
    '#EXTINF:-1 tvg-id="three" tvg-source="#alt" group-title="Private" tvg-logo="https://logo.test/icon.png",Third\nhttps://stream.test/three\n';
for (const native of [false, true]) {
    const ctx: any = context({ window: native ? { Capacitor: {} } : {}, cList: [], chanels: {}, cats: {}, catsArray: [],
        _: (value: string) => value, StripHttp: (value: string) => value.replace(/^https?:\/\//, ''), xxHash32Si: (value: string) => value.length,
        xxHash32S: (value: string) => value.length, murmurhash3_32_gc: (value: string) => value.endsWith('one') ? 42 : value.endsWith('two') ? 43 : 44,
        updateChanelInfo() {}, curList: [], primaryIndex: 0, alert: (message: string) => assert.fail(message),
        m3u_defaults: { epg_server: 'capacitor://localhost' }, m3uArr: { active: 0, M3Us: [{ www: '/fixture', rechours: 0 }] },
        readFile: () => playlist, provEpgLoader() {} });
    vm.runInContext(functions('prov/m3u/prov.js', ['getChanelsArray', 'addChan2cat', 'nativeXmltvSources', 'nativeMatchMetadata']), ctx);
    ctx.getChanelsArray(() => {});
    assert.equal(ctx.chanels[42].epg, 'private-id');
    if (!native) {
        assert.equal(ctx.chanels[42].xmltv_urls, undefined, 'browser provider object remains unchanged');
        assert.deepEqual(JSON.parse(JSON.stringify(ctx.nativeMatchMetadata())), {});
    } else {
        assert.deepEqual(Array.from(ctx.chanels[42].xmltv_urls), ['http://first.test/private.xml', 'https://second.test/guide.gz']);
        assert.deepEqual(Array.from(ctx.chanels[43].xmltv_urls), ['https://second.test/guide.gz']);
        assert.deepEqual(Array.from(ctx.chanels[44].xmltv_urls), ['https://alias.test/feed.xml']);
        assert.equal(ctx.nativeMatchMetadata().native_channels['42'].tvg_id, 'private-id');
    }
}

const calls: any[] = [];
const matcher = context({ window: { Capacitor: { Plugins: { MobileXmltvEpg: { getChannels: async (args: any) => {
    calls.push(args); return { channels: [
        { id: 'wrong', name: 'Private +4', names: ['Private'], icon: 'https://logo.test/wrong.png' },
        { id: 'private-id', name: 'Provider original name', names: ['Alias'], icon: 'https://logo.test/right.png' },
    ] };
} } } } } });
vm.runInContext(functions('src/plugins/m3u-proxy.ts', ['normalizeNativeEpgName', 'nativeEpgMatchScore', 'matchNativeXmltvChannel', 'nativeLogoFallback', 'matchCapacitorM3u']), matcher);
const body = JSON.stringify({ native_channels: { '42': { tvg_id: 'private-id', name: 'Private +4', xmltv_urls: ['http://first.test/private.xml'] } } }) + '\n\t\nignored-old-hashes\n\t\n42-1-2-3~Private%20%2B4';
assert.equal(await matcher.matchCapacitorM3u(body, false), '{}\n\t\n42~local~42\n\t\nlocal~/');
assert.equal(await matcher.matchCapacitorM3u(body, true), '{}\n\t\n42~https://logo.test/right.png');
assert.deepEqual(Array.from(calls[0].xmltv_urls), ['http://first.test/private.xml']);
const missing = body.replace('private-id', 'missing').replace('Private +4', 'Unrelated').replace('Private%20%2B4', 'Unrelated');
assert.match(await matcher.matchCapacitorM3u(missing, true), /42~data:image\/svg\+xml,/);
matcher.window.location = { href: 'capacitor://localhost/index.html' };
matcher.URL = URL;
vm.runInContext(functions('src/plugins/m3u-proxy.ts', ['isLocalCapacitorCompanionUrl']), matcher);
assert.equal(matcher.isLocalCapacitorCompanionUrl('/m3u/match-channels'), true);
assert.equal(matcher.isLocalCapacitorCompanionUrl('https://chosen.test/m3u/match-channels'), false, 'selected remote EPG services use normal jQuery/native HTTP transport');
console.log('PASS native EPG parity: provider ownership, sources/aliases, browser invariance, M3U matching and logos');

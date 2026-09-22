"use strict";
const { context, declarations } = require("./playlist-fixture.cjs");
function run(input) {
    const ctx = context(), calls = [];
    const config = input.config || { server: "https://xc.test/folder", username: "a/b", password: "x?&" };
    Object.assign(ctx, { xtream: config, loadXtreamParams() {}, launch_id: "#launch", checkProviderUrl: () => true,
        editXtreamSettings: () => calls.push("settings"), alert: value => ctx.errors.push(value) });
    ctx.$ = () => ({ append() {} });
    ctx.$.ajax = request => {
        calls.push(request.url);
        return { done(callback) { callback(input.account); return this; }, fail() { return this; } };
    };
    const vm = require("node:vm");
    vm.runInContext(declarations("prov/xtream/prov.js").filter(row => ["getChanelsArray", "xtreamCore"].includes(row.name)).map(row => row.text).join("\n"), ctx);
    ctx.getChanelsArray(() => ctx.callbacks++);
    return JSON.parse(JSON.stringify({ calls, ids: ctx.cList, channels: ctx.chanels, groups: ctx.cats, groupOrder: ctx.catsArray, errors: ctx.errors, callbacks: ctx.callbacks }));
}
module.exports = { run };
function guide(input) {
    const ctx = context(), calls = [];
    Object.assign(ctx, { xtream: { server: 'https://xc.test', username: 'a/b', password: 'x?&' }, loadXtreamParams() {}, chanels: { channel: { epg: '42' } } });
    ctx.$ = { ajax(request) { calls.push(request.url); return { done(callback) { callback(input); return this; }, fail() { return this; } }; } };
    const vm = require('node:vm');
    vm.runInContext(declarations('prov/xtream/prov.js').filter(row => ['getEPGchanel', 'xtreamCore'].includes(row.name)).map(row => row.text).join('\n'), ctx);
    let output; ctx.getEPGchanel('channel', (id, data) => { output = { id, data }; });
    return JSON.parse(JSON.stringify({ calls, output }));
}
module.exports.guide = guide;

"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const root = path.resolve(__dirname, "../..");
function ast(file) { return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true); }
function declarations(file) { const source = ast(file); return source.statements.filter(ts.isFunctionDeclaration).map(node => ({ name: node.name.text, text: node.getText(source), node, source })); }
const encoding = ast("src/utils/encoding.ts");
const encodingCode = ts.transpileModule(encoding.statements.map(node => node.getText(encoding).replace(/^export\s+/, "")).join("\n"), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES5 } }).outputText;
function context() {
    const ctx = vm.createContext({ console: { log() {}, error() {} }, _: value => value, callbacks: 0, errors: [], alert: value => { throw new Error(value); }, cList: [], chanels: {}, cats: {}, catsArray: [] });
    ctx.window = ctx;
    vm.runInContext(fs.readFileSync(path.join(root, "vendor/ottplay-core.js"), "utf8"), ctx);
    vm.runInContext(encodingCode, ctx);
    ctx.StripHttp = ctx.stripHttpScheme;
    return ctx;
}
function snapshot(ctx) { return JSON.parse(JSON.stringify({ ids: ctx.cList, channels: ctx.chanels, groups: ctx.cats, groupOrder: ctx.catsArray, callbacks: ctx.callbacks })); }
function parsers(directory = "prov") {
    return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
        const file = directory + "/" + entry.name;
        if (entry.isDirectory()) return parsers(file);
        if (entry.name !== "prov.js") return [];
        return declarations(file).filter(row => /_parseM3U$/.test(row.name)).map(row => ({ file, name: row.name }));
    });
}
function generic(parser, input) {
    const ctx = context(), code = declarations(parser.file).filter(row => [parser.name, "addChan2cat"].includes(row.name)).map(row => row.text).join("\n");
    vm.runInContext(code, ctx);
    ctx[parser.name](input, () => ctx.callbacks++);
    return snapshot(ctx);
}
function main(input, fallback = "48") {
    const ctx = context(), top = declarations("prov/m3u/prov.js"), get = top.find(row => row.name === "getChanelsArray");
    const local = get.node.body.statements.filter(ts.isFunctionDeclaration).filter(node => ["O", "I", "r"].includes(node.name.text)).map(node => node.getText(get.source)).join("\n");
    Object.assign(ctx, { m3uArr: { active: 0, M3Us: [{ rechours: fallback }] }, a: () => ctx.callbacks++, provEpgLoader: (config, body) => { ctx.epgConfig = config; ctx.epgBody = body; }, getLogoList: (config, body) => { ctx.logoBody = body; } });
    vm.runInContext(top.find(row => row.name === "addChan2cat").text + "\n" + local, ctx);
    ctx.r(input);
    return { ...snapshot(ctx), epgConfig: JSON.parse(JSON.stringify(ctx.epgConfig)), epgBody: ctx.epgBody, logoBody: ctx.logoBody || "" };
}
module.exports = { parsers, generic, main, declarations };
function operator(profile, input) {
    const ctx = context(), file = 'prov/' + profile + '/prov.js', top = declarations(file);
    const get = top.find(row => row.name === 'getChanelsArray');
    const success = get.node.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'aSuccess');
    ctx.alert = message => ctx.errors.push(message);
    Object.assign(ctx, { callback: () => ctx.callbacks++, __id: 'fixture', __pin: 'fixture', token: '1234567890', key: '12345678', login: '12345678', pass: '12345678', shkey: '12345678', tvteamwww: 'https://fixture.test/',
        getEpgList: value => { ctx.epgBody = value; }, getLogoList: value => { ctx.logoBody = value; } });
    if (profile === 'shura') { ctx.cList = ['one', 'two']; ctx.chanels = { one: { channel_name: 'One' }, two: { channel_name: 'Two' } }; }
    vm.runInContext(top.filter(row => ['getAttribute','getAint','addChan2cat'].includes(row.name)).map(row => row.text).join('\n') + '\n' + success.getText(get.source), ctx);
    ctx.aSuccess(input);
    return JSON.parse(JSON.stringify({ ...snapshot(ctx), errors: ctx.errors, epgBody: ctx.epgBody, logoBody: ctx.logoBody }));
}
function media(profile, input) {
    const ctx = context(), top = declarations('prov/' + profile + '/prov.js');
    ctx.mediaName = ''; ctx.alert = message => ctx.errors.push(message);
    vm.runInContext(top.filter(row => ['getMediaArrayEXTM3U', 'getAttribute'].includes(row.name)).map(row => row.text).join('\n'), ctx);
    ctx.getMediaArrayEXTM3U(input);
    return JSON.parse(JSON.stringify({ records: ctx.mediaRecords, name: ctx.mediaName, errors: ctx.errors }));
}
module.exports.operator = operator;
module.exports.media = media;
module.exports.context = context;

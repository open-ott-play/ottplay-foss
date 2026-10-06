const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
const runtime = require("./helpers/private-runtime.cjs");
const portal = "portal::[key:PRIVATE_ONE]https://portal.example/api/";
const other = "portal::[key:PRIVATE_TWO]https://other.example/api/";
function config() {
    return {
        active: 0,
        portals: Array.from({ length: 15 }, (_, i) => ({
            link: i ? "" : portal,
            name: i ? "" : "Films",
        })),
    };
}
function create(initial = {}) {
    const f = fixture(initial);
    const ast = ts.createSourceFile(
        "vportal.ts",
        fs.readFileSync("src/plugins/vportal.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const parse = ast.statements.find(
        (n) =>
            ts.isFunctionDeclaration(n) && n.name?.text === "parseVPortalLink"
    );
    vm.runInContext(
        ts.transpileModule(parse.getText(ast).replace(/^export /, ""), {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        f.host
    );
    const clients = [];
    f.host.__ottVPortal = {
        create: (link, options) => {
            const c = {
                dispose() {
                    this.disposed++;
                },
                disposed: 0,
                link,
                load() {},
                options,
                resolve() {},
            };
            clients.push(c);
            return c;
        },
        parse: f.host.parseVPortalLink,
    };
    runtime(f.host, "src/provider/vportal-driver.ts");
    runtime(f.host, "src/provider/source-identity.ts");
    const driver = f.mount("vportal");
    f.host.duneAddSettings(0);
    return { ...f, clients, driver };
}
{
    const f = create({ m3um3uArr: "M3U_UNTOUCHED" });
    let done = 0;
    f.host.getChannelsArray(() => done++);
    assert.equal(done, 0);
    assert.equal(f.host.listCaption.innerHTML, "VPortal profiles");
    assert.equal(f.driver.capabilities.libraryOnly, true);
    assert.equal(f.clients.length, 0);
    assert.equal(f.saved.get("m3um3uArr"), "M3U_UNTOUCHED");
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    let done = 0;
    f.host.getChannelsArray(() => done++);
    assert.equal(done, 1);
    assert.equal(f.host.cList.length, 0);
    assert.equal(f.host.providerMediaClient, f.clients[0]);
    assert.equal(f.driver.libraryReady(), true);
    assert.equal(f.clients[0].options.title, "Films");
    const identity = f.host.__ottSourceIdentity.current(f.host);
    assert.match(identity, /^vportal:0@/);
    assert(!identity.includes("PRIVATE"));
    const snapshot = f.driver.configuration();
    snapshot.portals[0].link = other;
    assert.equal(
        f.driver.configuration().portals[0].link,
        portal,
        "configuration is detached"
    );
    const value = f.driver.configuration();
    value.portals[1] = { link: other, name: "Second" };
    assert.equal(f.driver.saveConfiguration(value), true);
    assert.equal(
        f.clients[0].disposed,
        0,
        "editing an inactive slot preserves playback"
    );
    value.active = 1;
    assert.equal(f.driver.saveConfiguration(value), true);
    assert.equal(f.clients[0].disposed, 1);
    assert.equal(f.clients[0].options.isCurrent(), false);
    f.host.getChannelsArray(() => done++);
    assert.notEqual(f.host.__ottSourceIdentity.current(f.host), identity);
    assert.equal(f.host.providerMediaClient, f.clients[1]);
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.getChannelsArray(() => {});
    const before = f.saved.get("vportalprofiles");
    for (const bad of [
        "https://ordinary.example/file.m3u",
        "portal::[key:bad]javascript:alert(1)",
        "\n" + portal,
    ]) {
        const value = f.driver.configuration();
        value.portals[0].link = bad;
        assert.equal(f.driver.saveConfiguration(value), false);
        assert.equal(f.saved.get("vportalprofiles"), before);
    }
    f.host.checkProviderUrl = () => false;
    const value = f.driver.configuration();
    value.portals[0].link = other;
    assert.equal(f.driver.saveConfiguration(value), false);
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    const request = (action, params) =>
        f.driver.remoteProfiles({ action, params });
    const listing = request("profiles", {});
    assert.equal(listing.status, "ok");
    assert.equal(listing.data.provider, "vportal");
    assert.equal(listing.data.profiles.length, 15);
    assert(!JSON.stringify(listing).includes("PRIVATE"));
    assert(!JSON.stringify(listing).includes("https:"));
    assert.equal(request("profile", { number: 2 }).status, "rejected");
    assert.equal(
        request("profile_settings", {
            number: 2,
            settings: { name: "Cartoons", vportal: other },
        }).status,
        "ok"
    );
    assert.equal(request("profile", { number: 2 }).data.profile.active, true);
    assert.equal(
        request("profile_settings", {
            number: 1,
            settings: { playlist: "https://tv.example/" },
        }).status,
        "rejected"
    );
    f.host.__ottKiosk = { enabled: () => true };
    assert.equal(request("profiles", {}).status, "ok");
    assert.equal(request("profile", { number: 1 }).status, "rejected");
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    const before = f.saved.get("vportalprofiles");
    f.host.__ottEditProvider();
    f.host.selIndex = 0;
    f.host.listKeyHandler(f.host.keys.ENTER);
    f.host.selIndex = 1;
    f.host.listKeyHandler(f.host.keys.ENTER);
    const late = f.host.setEdit;
    const result = f.driver.remoteProfiles({
        action: "profile_settings",
        params: { number: 1, settings: { vportal: other } },
    });
    assert.equal(result.status, "ok");
    f.host.editvar = portal;
    late();
    assert.notEqual(f.saved.get("vportalprofiles"), before);
    assert.equal(f.driver.configuration().portals[0].link, other);
    assert(!JSON.stringify(f.host.listArray).includes("PRIVATE"));
}
console.log(
    "VPortal provider profiles, isolation, validation, redaction and editor lifetime tests passed"
);

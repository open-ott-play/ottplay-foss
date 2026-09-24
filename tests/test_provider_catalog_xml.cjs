"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { declarations } = require("./helpers/playlist-fixture.cjs");
const dom = new JSDOM("", { runScripts: "outside-only" });
const w = dom.window;
const realm = dom.getInternalVMContext();
require("./helpers/private-runtime.cjs")(realm, "src/provider/catalog-xml.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const decode = (text, profile = "m3u") =>
    w.__ottCatalogXml.decode(w, text, profile);
vm.runInContext(
    declarations("prov/m3u/prov.js")
        .filter((entry) => ["fXMLCh2Json", "fXML_to_JSON"].includes(entry.name))
        .map((entry) => entry.text)
        .join("\n"),
    realm
);
const cases = [
    "<items><playlist_name>Library</playlist_name><channel><title>One</title><stream_url>https://media.test/1</stream_url></channel></items>",
    "<items><title>Nested</title><channels><channel><title>A &amp; B</title><adult>1</adult><description><![CDATA[<b>Text</b>]]></description></channel></channels><next_page_url>page2</next_page_url></items>",
    "<menu><menu><title>Folder</title><playlist_url>folder</playlist_url></menu><channel><stream_url>movie</stream_url></channel></menu>",
    "<channels><channel><ignored>hidden</ignored></channel><channel><logo_30x30>icon</logo_30x30></channel></channels>",
    "<items><menu><title>Root menu</title><playlist_url>root</playlist_url></menu><prev_page_url>previous</prev_page_url></items>",
    '<?xml version="1.0"?><!-- preamble --><items><channel><title>Unicode — Ж</title><search_on>1</search_on></channel></items>',
];
for (const text of cases) {
    const expected = {};
    assert(
        w.fXML_to_JSON(
            new w.DOMParser().parseFromString(text, "text/xml"),
            expected
        )
    );
    assert.deepEqual(plain(decode(text)), plain(expected));
}
assert.equal(
    decode("<items><channel><title>A&nbsp;B</title></channel></items>")
        .channels[0].title,
    "A\u00a0B"
);
assert.equal(
    decode(
        "<items><channel><title>A & B</title><description>X & Y</description></channel></items>"
    ).channels[0].description,
    "X & Y"
);
assert.throws(
    () => decode("<items><channel><title>unclosed"),
    /Cannot parse fXML/
);
assert.throws(
    () => decode("<items><channel><ignored>empty</ignored></channel></items>"),
    /Bad fXML/
);
assert.throws(() => decode("<items/>"), /Bad fXML/);
const first = decode(cases[0]);
first.channels[0].title = "changed";
assert.equal(decode(cases[0]).channels[0].title, "One");
// The private decoder retains attribution and works without old global helpers.
assert.equal(w.operatorXmlToJson, undefined);
w.jQuery = {
    parseXML: (text) => new w.DOMParser().parseFromString(text, "text/xml"),
};
const operator = decode(
    '<items><channel id="7"><title><![CDATA[Film]]></title></channel></items>',
    "antifriz"
);
assert.equal(operator.items.channel["@id"], "7");
assert.equal(operator.items.channel.title, "Film");
dom.window.close();
console.log(
    "PASS catalog XML: retained format projections, entity/text repairs, malformed/empty rejection and isolated results"
);

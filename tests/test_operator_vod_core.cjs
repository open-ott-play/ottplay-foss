"use strict";
const assert = require("node:assert/strict");
const runner = require("./helpers/operator-vod-fixture.cjs");
const fixture = require("./fixtures/operator/vod-before-core.json");
for (const row of fixture.cases)
    assert.deepEqual(
        runner.run(row.profile, row.input),
        row.expected,
        row.profile + " " + JSON.stringify(row.input)
    );
console.log(
    "PASS " +
        fixture.cases.length +
        " captured operator XML/JSON/M3U media contracts"
);

/* Synthetic guide-navigation comparison, no device timing claims. */
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const privateRuntime = require("../tests/helpers/private-runtime.cjs");
const host = vm.createContext({});
host.window = host;
privateRuntime(host, "src/guide/screen.ts");
const rows = Array.from({ length: 10000 }, (_, i) => ({
    end: i + 60,
    id: "p" + i,
    start: i,
    title: "Program " + i,
}));
const screen = host.__ottGuideScreen.create({
    current: () => true,
    now: () => 0,
    request(_r, notify) {
        notify(rows);
        return () => {};
    },
    select: () => ({ current: rows[0] }),
});
screen.open({}, 1, 0, 0, () => {});
const count = 1000;
let start = performance.now();
for (let i = 0; i < count; i++)
    JSON.parse(JSON.stringify(rows.filter((row) => row.id === "p9999")[0]));
const baseline = performance.now() - start;
start = performance.now();
for (let i = 0; i < count; i++) screen.select("p9999");
console.log(
    JSON.stringify(
        {
            baselineMs: baseline,
            indexedMs: performance.now() - start,
            note: "Both paths return detached rows; excludes cold schedule/index construction.",
            scenario: "1,000 last-row selections in a 10,000-programme guide",
        },
        null,
        2
    )
);

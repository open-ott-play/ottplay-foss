const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");

function load(relative, globals = {}, imports = {}) {
    const file = path.resolve(__dirname, "../..", relative);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    const exports = {};
    vm.runInNewContext(code, {
        exports,
        require(name) {
            assert.ok(
                Object.hasOwn(imports, name),
                "Unexpected dependency: " + name
            );
            return imports[name];
        },
        ...globals,
    });
    return exports;
}

function clock() {
    let now = 1000000;
    let next = 0;
    const jobs = new Map();
    return {
        advance(ms) {
            const until = now + ms;
            let limit = 1000;
            while (true) {
                const due = [...jobs]
                    .filter(([, job]) => job.at <= until)
                    .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (!due) break;
                assert.ok(--limit > 0, "Unexpected unbounded timer loop");
                now = due[1].at;
                jobs.delete(due[0]);
                due[1].fn();
            }
            now = until;
        },
        clearTimeout(id) {
            jobs.delete(id);
        },
        Date: { now: () => now },
        jobs,
        now: () => now,
        setTimeout(fn, delay) {
            assert.ok(Number.isFinite(delay) && delay >= 0);
            const id = ++next;
            jobs.set(id, { at: now + delay, fn });
            return id;
        },
    };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

module.exports = { clock, load, plain };

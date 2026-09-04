import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function makeRedefinable(
    target: Record<string, unknown>,
    name: string,
    get: () => unknown,
    set: (v: unknown) => void
): void {
    Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        get,
        set,
    });
}

const w: Record<string, unknown> = {};
let listKeyHandlerFn: ((key: number) => boolean) | null = null;
makeRedefinable(w, "listKeyHandler", () => listKeyHandlerFn, (v) => { listKeyHandlerFn = v as any; });
makeRedefinable(w, "listKeyHandlerFn", () => listKeyHandlerFn, (v) => { listKeyHandlerFn = v as any; });
const enter = (key: number): boolean => key === 13;
w.listKeyHandler = enter;
assert.strictEqual(w.listKeyHandlerFn, enter);
assert.strictEqual(listKeyHandlerFn, enter);
const esc = (key: number): boolean => key === 27;
w.listKeyHandlerFn = esc;
assert.strictEqual(w.listKeyHandler, esc);
const ui = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/ui/index.ts"), "utf8");
assert.match(ui, /makeRedefinable\(\s*"listKeyHandler"/);
assert.match(ui, /makeRedefinable\(\s*"listKeyHandlerFn"/);
console.log("OK: listKeyHandler alias fixture");

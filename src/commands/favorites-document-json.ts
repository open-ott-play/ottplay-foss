/** Bounded strict JSON/UTF-8 boundary. Pure helper; no runtime registration. */
const MAX_BYTES = 1048576;
const MAX_NODES = 32768;
const MAX_DEPTH = 20;
function invalid(): never {
    throw new Error("codec_error");
}
function utf8Decode(bytes: Uint8Array): string {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) invalid();
    var result: string[] = [],
        i = 0;
    while (i < bytes.length) {
        var a = bytes[i++],
            code: number,
            count: number,
            min: number;
        if (a < 128) {
            code = a;
            count = 0;
            min = 0;
        } else if (a >= 194 && a <= 223) {
            code = a & 31;
            count = 1;
            min = 128;
        } else if (a >= 224 && a <= 239) {
            code = a & 15;
            count = 2;
            min = 2048;
        } else if (a >= 240 && a <= 244) {
            code = a & 7;
            count = 3;
            min = 65536;
        } else return invalid();
        for (var n = 0; n < count; n++) {
            if (i >= bytes.length || (bytes[i] & 192) !== 128) invalid();
            code = code * 64 + (bytes[i++] & 63);
        }
        if (code < min || code > 1114111 || (code >= 55296 && code <= 57343))
            invalid();
        if (code < 65536) result.push(String.fromCharCode(code));
        else {
            code -= 65536;
            result.push(
                String.fromCharCode(55296 + (code >> 10), 56320 + (code & 1023))
            );
        }
    }
    return result.join("");
}
function checkString(text: string, maxBytes = MAX_BYTES): void {
    if (
        typeof maxBytes !== "number" ||
        maxBytes < 1 ||
        maxBytes > 2097152 ||
        Math.floor(maxBytes) !== maxBytes
    )
        invalid();
    if (text.length > maxBytes) invalid();
    for (var i = 0; i < text.length; i++) {
        var c = text.charCodeAt(i);
        if (c >= 55296 && c <= 56319) {
            var next = text.charCodeAt(++i);
            if (!(next >= 56320 && next <= 57343)) invalid();
        } else if (c >= 56320 && c <= 57343) invalid();
    }
}
export function utf8Encode(text: string, maxBytes = MAX_BYTES): Uint8Array {
    checkString(text, maxBytes);
    // Calculate before allocation; serialized JSON can expand escaped control characters.
    var length = 0,
        i: number,
        c: number;
    for (i = 0; i < text.length; i++) {
        c = text.charCodeAt(i);
        if (c < 128) length++;
        else if (c < 2048) length += 2;
        else if (c >= 55296 && c <= 56319) {
            length += 4;
            i++;
        } else length += 3;
        if (length > maxBytes) invalid();
    }
    var bytes = new Uint8Array(length),
        at = 0;
    for (i = 0; i < text.length; i++) {
        c = text.charCodeAt(i);
        if (c < 128) bytes[at++] = c;
        else if (c < 2048) {
            bytes[at++] = 192 | (c >> 6);
            bytes[at++] = 128 | (c & 63);
        } else if (c >= 55296 && c <= 56319) {
            c = 65536 + ((c - 55296) << 10) + text.charCodeAt(++i) - 56320;
            bytes[at++] = 240 | (c >> 18);
            bytes[at++] = 128 | ((c >> 12) & 63);
            bytes[at++] = 128 | ((c >> 6) & 63);
            bytes[at++] = 128 | (c & 63);
        } else {
            bytes[at++] = 224 | (c >> 12);
            bytes[at++] = 128 | ((c >> 6) & 63);
            bytes[at++] = 128 | (c & 63);
        }
    }
    return bytes;
}
export function parseFavoritesDocumentJson(bytes: Uint8Array): any {
    var text = utf8Decode(bytes),
        at = 0,
        nodes = 0;
    function whitespace(): void {
        while (at < text.length && /[\x20\t\r\n]/.test(text.charAt(at))) at++;
    }
    function string(): string {
        var start = at++;
        while (at < text.length) {
            var c = text.charCodeAt(at++);
            if (c === 34) {
                var value: string;
                try {
                    value = JSON.parse(text.slice(start, at));
                } catch (_) {
                    return invalid();
                }
                checkString(value);
                return value;
            }
            if (c < 32) invalid();
            if (c === 92) {
                if (at >= text.length) invalid();
                var escape = text.charAt(at++);
                if (escape === "u") {
                    if (!/^[0-9a-fA-F]{4}$/.test(text.slice(at, at + 4)))
                        invalid();
                    at += 4;
                } else if ('"\\/bfnrt'.indexOf(escape) < 0) invalid();
            }
        }
        return invalid();
    }
    function value(depth: number): any {
        if (depth > MAX_DEPTH || ++nodes > MAX_NODES) invalid();
        whitespace();
        var c = text.charAt(at),
            result: any;
        if (c === '"') return string();
        if (c === "{" || c === "[") {
            var object = c === "{";
            result = object ? {} : [];
            at++;
            whitespace();
            if (text.charAt(at) === (object ? "}" : "]")) {
                at++;
                return result;
            }
            while (true) {
                whitespace();
                if (object) {
                    if (text.charAt(at) !== '"') invalid();
                    var key = string();
                    if (Object.prototype.hasOwnProperty.call(result, key))
                        invalid();
                    whitespace();
                    if (text.charAt(at++) !== ":") invalid();
                    // Define own data properties: __proto__ must never mutate prototypes.
                    Object.defineProperty(result, key, {
                        configurable: true,
                        enumerable: true,
                        value: value(depth + 1),
                        writable: true,
                    });
                } else result.push(value(depth + 1));
                whitespace();
                var delimiter = text.charAt(at++);
                if (delimiter === (object ? "}" : "]")) return result;
                if (delimiter !== ",") invalid();
            }
        }
        for (var l = 0; l < 3; l++) {
            var literal = ["true", "false", "null"][l];
            if (text.substr(at, literal.length) === literal) {
                at += literal.length;
                return l === 0 ? true : l === 1 ? false : null;
            }
        }
        var start = at;
        while (at < text.length && /[0-9eE+.\-]/.test(text.charAt(at))) at++;
        var token = text.slice(start, at);
        if (
            !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(
                token
            )
        )
            return invalid();
        result = Number(token);
        if (!isFinite(result)) invalid();
        return result;
    }
    var result = value(1);
    whitespace();
    if (at !== text.length) invalid();
    return result;
}
export function encodeFavoritesDocumentJson(value: any): Uint8Array {
    var nodes = 0,
        ancestors: any[] = [];
    function inspect(item: any, depth: number): void {
        if (depth > MAX_DEPTH || ++nodes > MAX_NODES) invalid();
        if (item === null || typeof item === "boolean") return;
        if (typeof item === "string") {
            checkString(item);
            return;
        }
        if (typeof item === "number") {
            if (!isFinite(item)) invalid();
            return;
        }
        if (
            typeof item !== "object" ||
            ancestors.indexOf(item) >= 0 ||
            "toJSON" in item
        )
            invalid();
        if (
            !Array.isArray(item) &&
            Object.prototype.toString.call(item) !== "[object Object]"
        )
            invalid();
        if (
            Object.getOwnPropertySymbols &&
            Object.getOwnPropertySymbols(item).length
        )
            invalid();
        ancestors.push(item);
        var keys = Object.keys(item);
        if (Array.isArray(item) && keys.length !== item.length) invalid();
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            checkString(key);
            if (Array.isArray(item) && key !== String(i)) invalid();
            var descriptor = Object.getOwnPropertyDescriptor(item, key);
            if (!descriptor || !("value" in descriptor)) invalid();
            inspect(descriptor.value, depth + 1);
        }
        ancestors.pop();
    }
    inspect(value, 1);
    return utf8Encode(JSON.stringify(value));
}

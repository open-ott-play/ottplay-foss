/** TextEncoder polyfill using UTF-8 encoding */
export function polyfillTextEncoder(): void {
    /* removed */ if (typeof TextEncoder !== "undefined") return;

    var Utf8Encoder = function () {} as any;
    Utf8Encoder.prototype.encode = function (str: string): Uint8Array {
        var bytes: number[] = [];
        var pos = -1;
        var len = str.length;
        while (++pos < len) {
            var code = str.charCodeAt(pos);
            if (code <= 0x7f) {
                bytes.push(code);
            } else if (code <= 0x7ff) {
                bytes.push(0xc0 | ((code >>> 6) & 0x1f));
                bytes.push(0x80 | (code & 0x3f));
            } else {
                var surrogate = code;
                if (
                    surrogate >= 0xd800 &&
                    surrogate <= 0xdbff &&
                    pos + 1 < len
                ) {
                    var nextCode = str.charCodeAt(pos + 1);
                    if (0xdc00 <= nextCode && nextCode <= 0xdfff) {
                        surrogate =
                            0x10000 +
                            ((surrogate & 0x3ff) << 10) +
                            (nextCode & 0x3ff);
                        pos++;
                    }
                }
                if (surrogate <= 0xffff) {
                    bytes.push(0xe0 | ((surrogate >>> 12) & 0x0f));
                    bytes.push(0x80 | ((surrogate >>> 6) & 0x3f));
                    bytes.push(0x80 | (surrogate & 0x3f));
                } else if (surrogate <= 0x1fffff) {
                    bytes.push(0xf0 | ((surrogate >>> 18) & 0x07));
                    bytes.push(0x80 | ((surrogate >>> 12) & 0x3f));
                    bytes.push(0x80 | ((surrogate >>> 6) & 0x3f));
                    bytes.push(0x80 | (surrogate & 0x3f));
                }
            }
        }
        return new Uint8Array(bytes);
    };
    (window as any).TextEncoder = Utf8Encoder;
}

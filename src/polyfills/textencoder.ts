/** TextEncoder polyfill using UTF-8 encoding */
export function polyfillTextEncoder(): void {
  /* removed */ if (typeof TextEncoder !== 'undefined') return;

  var Utf8Encoder = function () {} as any;
  Utf8Encoder.prototype.encode = function (str: string): Uint8Array {
    var bytes: number[] = [];
    var pos = -1;
    var len = str.length;
    while (++pos < len) {
      var code = str.charCodeAt(pos);
      if (code <= 0x7F) {
        bytes.push(code);
      } else if (code <= 0x7FF) {
        bytes.push(0xC0 | ((code >>> 6) & 0x1F));
        bytes.push(0x80 | (code & 0x3F));
      } else {
        var surrogate = code;
        if (0xD800 <= surrogate && surrogate <= 0xDBFF && pos + 1 < len) {
          var nextCode = str.charCodeAt(pos + 1);
          if (0xDC00 <= nextCode && nextCode <= 0xDFFF) {
            surrogate = 0x10000 + ((surrogate & 0x3FF) << 10) + (nextCode & 0x3FF);
            pos++;
          }
        }
        if (surrogate <= 0xFFFF) {
          bytes.push(0xE0 | ((surrogate >>> 12) & 0x0F));
          bytes.push(0x80 | ((surrogate >>> 6) & 0x3F));
          bytes.push(0x80 | (surrogate & 0x3F));
        } else if (surrogate <= 0x1FFFFF) {
          bytes.push(0xF0 | ((surrogate >>> 18) & 0x07));
          bytes.push(0x80 | ((surrogate >>> 12) & 0x3F));
          bytes.push(0x80 | ((surrogate >>> 6) & 0x3F));
          bytes.push(0x80 | (surrogate & 0x3F));
        }
      }
    }
    return new Uint8Array(bytes);
  };
  (window as any).TextEncoder = Utf8Encoder;
}

/** String.prototype.trim polyfill for IE8- */
export function polyfillStringTrim(): void {
    if (!String.prototype.trim) {
        String.prototype.trim = function (this: string): string {
            return this.replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, "");
        };
    }
}

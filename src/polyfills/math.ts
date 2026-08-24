/** Math.imul polyfill for IE */
export function polyfillMathImul(): void {
    if (!(Math as any).imul) {
        (Math as any).imul = function (a: number, b: number): number {
            const aHi = (a >>> 16) & 0xffff;
            const aLo = a & 0xffff;
            const bHi = (b >>> 16) & 0xffff;
            const bLo = b & 0xffff;
            return (aLo * bLo + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) | 0;
        };
    }
}

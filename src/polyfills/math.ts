/** Math.imul polyfill for IE */
export function polyfillMathImul(): void {
  if (!(Math as any).imul) {
    (Math as any).imul = function (a: number, b: number): number {
      const aHi = (a >>> 16) & 0xFFFF;
      const aLo = a & 0xFFFF;
      const bHi = (b >>> 16) & 0xFFFF;
      const bLo = b & 0xFFFF;
      return (aLo * bLo + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) | 0;
    };
  }
}

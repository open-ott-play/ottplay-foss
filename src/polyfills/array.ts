/** Array.prototype.findIndex polyfill */
export function polyfillArrayFindIndex(): void {
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (
      this: any[],
      predicate: (value: any, index: number, obj: any[]) => boolean,
      thisArg?: any
    ): number {
      if (this == null) {
        throw new TypeError('"this" is null or not defined');
      }
      var obj = Object(this);
      var len = obj.length >>> 0;
      if (typeof predicate !== 'function') {
        throw new TypeError('predicate must be a function');
      }
      var index = 0;
      while (index < len) {
        var value = obj[index];
        if (predicate.call(thisArg, value, index, obj)) {
          return index;
        }
        index++;
      }
      return -1;
    };
  }
}

/** Array.isArray polyfill */
export function polyfillArrayIsArray(): void {
  if (!Array.isArray) {
    Array.isArray = function (arg: any): arg is any[] {
      return Object.prototype.toString.call(arg) === '[object Array]';
    };
  }
}

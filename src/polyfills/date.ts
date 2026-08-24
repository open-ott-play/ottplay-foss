/** Date.timezoneOffset polyfill for old STBs */
export function polyfillDateTimezone(): void {
  var baseDate = new Date();
  (Date.prototype as any).timezoneOffset = baseDate.getTimezoneOffset();

  (Date as any).setTimezoneOffset = function (offset: number): number {
    return ((this as any).prototype.timezoneOffset = offset);
  };
  (Date.prototype as any).setTimezoneOffset = function (offset: number): number {
    return ((this as any).timezoneOffset = offset);
  };
  (Date as any).getTimezoneOffset = function (_offset?: number): number {
    return (this as any).prototype.timezoneOffset;
  };
  (Date.prototype as any).getTimezoneOffset = function (): number {
    return (this as any).timezoneOffset;
  };
  (Date.prototype as any).toString = function (): string {
    var offsetMs = (this as any).timezoneOffset * 60 * 1000;
    baseDate.setTime(this.getTime() - offsetMs);
    return baseDate.toUTCString();
  };

  var dateParts = [
    'Milliseconds', 'Seconds', 'Minutes', 'Hours',
    'Date', 'Month', 'FullYear', 'Year', 'Day'
  ];
  dateParts.forEach(function (part: string) {
    (Date.prototype as any)['get' + part] = function () {
      var offsetMs = (this as any).timezoneOffset * 60 * 1000;
      baseDate.setTime(this.getTime() - offsetMs);
      return (baseDate as any)['getUTC' + part]();
    };
    (Date.prototype as any)['set' + part] = function (value: number) {
      var offsetMs = (this as any).timezoneOffset * 60 * 1000;
      baseDate.setTime(this.getTime() - offsetMs);
      (baseDate as any)['setUTC' + part](value);
      var result = baseDate.getTime() + offsetMs;
      this.setTime(result);
      return result;
    };
  });
}

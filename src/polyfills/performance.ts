/** performance.now() polyfill for old STB devices */
export function polyfillPerformanceNow(): void {
  if (!(window as any).performance || !(window as any).performance.now) {
    if (!Date.now) {
      Date.now = function (this: any): number {
        return new this().getTime();
      };
    }
    var perf = (window as any).performance || ((window as any).performance = {});
    var timing = perf.timing || (perf.timing = {});
    var navStart = timing.navigationStart || (timing.navigationStart = Date.now());
    perf.now = function (): number {
      return Date.now() - navStart;
    };
  }
}

/** Native PiP has a request identity even while its asynchronous decoder is starting. */
function createNativePipPort(ports: any) {
    var sequence = ports.seed || 0;
    var pending: any = null;
    function invoke(action: string, args: any, active?: () => boolean): any {
        function run() {
            if (!active || active()) return ports.invoke(action, args);
        }
        var task: any;
        try {
            task = ports.serial
                ? (pending || Promise.resolve()).then(run)
                : Promise.resolve(run());
        } catch (error) {
            task = Promise.reject(error);
        }
        if (ports.serial) {
            pending = task.then(
                function () {},
                function () {}
            );
            var saved = pending;
            pending.then(function () {
                if (pending === saved) pending = null;
            });
        }
        return task;
    }
    return {
        open: function (
            request: any,
            fallback: () => MediaEngineLease
        ): MediaEngineLease {
            var id = ++sequence;
            var alive = true;
            var css: MediaEngineLease | null = null;
            function current() {
                return alive && sequence === id;
            }
            function fail(error: any) {
                if (!current()) return;
                ports.error(error);
                if (!current()) return;
                var opened = fallback();
                if (!current()) opened.dispose();
                else css = opened;
            }
            invoke("play", ports.request(request.url, id), current).then(
                function (response: any) {
                    if (!current()) return;
                    if (
                        (response &&
                            (response.ok === false || response.unsupported)) ||
                        (ports.requireOk && (!response || !response.ok))
                    ) {
                        fail(response);
                        return;
                    }
                    ports.ready();
                },
                fail
            );
            return {
                dispose: function (replaced?: boolean) {
                    if (!alive) return;
                    alive = false;
                    if (css) css.dispose();
                    if (sequence !== id) return;
                    var stopId = ++sequence;
                    function stop() {
                        if (sequence === stopId)
                            invoke("stop", { requestId: stopId }).catch(
                                ports.error
                            );
                    }
                    // A replacing native open supersedes the old request itself. If it
                    // is abandoned reentrantly, the retired decoder still gets stopped.
                    if (replaced) Promise.resolve().then(stop);
                    else stop();
                },
                pause: function () {
                    if (current() && css) css.pause();
                },
                resume: function () {
                    if (current() && css) css.resume();
                },
                sample: function () {
                    return css
                        ? css.sample()
                        : {
                              duration: NaN,
                              paused: false,
                              position: 0,
                              ready: 2,
                          };
                },
                seek: function (position: number) {
                    if (current() && css) css.seek(position);
                },
            };
        },
    };
}
(window as any).__ottNativePip = { create: createNativePipPort };

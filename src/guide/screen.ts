interface GuideScreenPorts {
    current(reference: GuideReference): boolean;
    now(): number;
    request(
        reference: GuideReference,
        notify: (rows: GuideProgramme[] | null) => void
    ): () => void;
    select(rows: GuideProgramme[], now: number, count: number): GuideProjection;
}
/** One guide view owns its request, programme identity and filtered schedule. */
function createGuideScreen(ports: GuideScreenPorts) {
    var revision = 0,
        cancel: (() => void) | null = null,
        state: any = null;
    function close(): void {
        revision++;
        state = null;
        var old = cancel;
        cancel = null;
        if (old) old();
    }
    function snapshot(): any {
        return state
            ? JSON.parse(
                  JSON.stringify({
                      mode: state.mode,
                      rows: state.rows,
                      schedule: state.schedule,
                      selectedId: state.selectedId,
                  })
              )
            : null;
    }
    return {
        close: close,
        current: function () {
            return !!state && ports.current(state.reference);
        },
        guard: function (callback: any) {
            var expected = revision,
                current = state;
            return function () {
                if (
                    revision === expected &&
                    current === state &&
                    current &&
                    ports.current(current.reference)
                )
                    callback();
            };
        },
        open: function (
            reference: GuideReference,
            mode: number,
            archiveHours: number,
            playhead: number,
            notify: any,
            selectedId?: string
        ) {
            var expected = revision + 1;
            close();
            if (expected !== revision) return;
            if (!ports.current(reference)) return;
            state = {
                mode: mode,
                reference: reference,
                rows: [],
                schedule: [],
                selectedId: selectedId || "",
            };
            var completed = false;
            var stop = ports.request(reference, function (rows) {
                if (expected !== revision || !ports.current(reference)) return;
                completed = true;
                cancel = null;
                var now = ports.now(),
                    all = rows || [];
                var schedule = all
                    .filter(function (row) {
                        return archiveHours > 0
                            ? row.start > now - archiveHours * 3600
                            : row.end > now - 7200;
                    })
                    .sort(function (a, b) {
                        return a.start - b.start;
                    });
                var visible = schedule.slice();
                if (mode === 2)
                    visible = visible.filter(function (row) {
                        return archiveHours > 0 || row.end > now;
                    });
                if (mode === 0) {
                    var titles: Record<string, boolean> = Object.create(null);
                    visible = visible
                        .slice()
                        .reverse()
                        .filter(function (row) {
                            if (row.end > now || titles[row.title])
                                return false;
                            titles[row.title] = true;
                            return true;
                        });
                }
                if (mode !== 1)
                    visible.sort(function (a, b) {
                        return a.title < b.title
                            ? -1
                            : a.title > b.title
                              ? 1
                              : a.start - b.start;
                    });
                var current = ports.select(all, playhead, 0).current;
                state.schedule = schedule;
                state.rows = visible;
                if (
                    !visible.some(function (row) {
                        return row.id === state.selectedId;
                    })
                )
                    state.selectedId =
                        current &&
                        visible.some(function (row) {
                            return row.id === current!.id;
                        })
                            ? current.id
                            : visible.length
                              ? visible[0].id
                              : "";
                notify(snapshot());
            });
            if (!completed && expected === revision) cancel = stop;
            else stop();
        },
        reference: function () {
            return state && state.reference;
        },
        select: function (id: string) {
            if (!state || !ports.current(state.reference)) return null;
            var row = state.rows.filter(function (item: GuideProgramme) {
                return item.id === id;
            })[0];
            if (!row) return null;
            state.selectedId = id;
            return JSON.parse(JSON.stringify(row));
        },
        snapshot: snapshot,
    };
}
(window as any).__ottGuideScreen = { create: createGuideScreen };

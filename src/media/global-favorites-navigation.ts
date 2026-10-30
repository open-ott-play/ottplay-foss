/** Mixed Favorites order is independent of whichever provider currently owns the decoder. */
export function createGlobalFavoritesNavigation(ports: any): any {
    var currentId: string | null = null,
        epoch = 0,
        pending: any = null,
        ending: any = null,
        completedGeneration: number | null = null;
    function proof(): any {
        if (!currentId || !ports.current() || !ports.allowed()) return null;
        var value = ports.capture();
        return value && value.id === currentId && value.current()
            ? value
            : null;
    }
    function locate(rows: any[], value: any): number {
        var identity = ports.identity(value.value),
            found = -1;
        for (var i = 0; i < rows.length; i++) {
            if (ports.identity(rows[i]) !== identity) continue;
            if (found >= 0) return -1;
            found = i;
        }
        return found;
    }
    function retire(): void {
        epoch++;
        ending = null;
        currentId = null;
        var previous = pending;
        pending = null;
        if (previous && previous.route) previous.route.cancel();
        ports.cancel();
    }
    function routeState(state: any): void {
        if (state.phase === "loading") {
            ending = null;
            if (pending && pending.target === state.id) return;
            pending = { epoch: ++epoch, external: true, target: state.id };
        } else if (state.phase === "playing") {
            var value = ports.capture();
            if (
                !value ||
                value.id !== state.id ||
                !value.current() ||
                !ports.current() ||
                !ports.allowed()
            ) {
                retire();
                return;
            }
            currentId = state.id;
            pending = null;
        } else if (pending && pending.external && pending.target === state.id) {
            currentId = null;
            pending = null;
        }
    }
    function advance(captured: any, direction: number, mode?: string): void {
        var token: any = {
            epoch: ++epoch,
            external: false,
            route: null,
            target: null,
        };
        pending = token;
        function owned(): boolean {
            return (
                pending === token &&
                epoch === token.epoch &&
                ports.current() &&
                ports.allowed()
            );
        }
        function failed(reason: string): void {
            if (!owned()) return;
            retire();
            ports.failed(reason);
        }
        Promise.resolve()
            .then(async function () {
                var snapshot = await ports.snapshot();
                if (!owned()) return;
                if (!snapshot.current() || !captured.current()) {
                    failed("changed");
                    return;
                }
                var index = locate(snapshot.entries, captured);
                if (index < 0 || !snapshot.entries.length) {
                    failed("missing");
                    return;
                }
                if (mode === "off" && index + 1 === snapshot.entries.length) {
                    retire();
                    return;
                }
                var next =
                    mode === "one"
                        ? index
                        : (index + direction + snapshot.entries.length) %
                          snapshot.entries.length;
                token.target = snapshot.entries[next].id;
                if (!snapshot.current() || !owned()) {
                    failed("changed");
                    return;
                }
                token.route = ports.select(token.target);
                var result = await token.route.result;
                if (!owned()) return;
                if (!result || result.status !== "ok") {
                    failed((result && result.status) || "unavailable");
                    return;
                }
                routeState({ id: token.target, phase: "playing" });
            })
            .catch(function () {
                failed("unavailable");
            });
    }
    function move(direction: number): boolean {
        if (direction !== 1 && direction !== -1) return false;
        if (!ports.current() || !ports.allowed()) {
            retire();
            return false;
        }
        if (pending) return true;
        var captured = proof();
        if (!captured) {
            if (currentId) retire();
            return false;
        }
        ending = null;
        advance(captured, direction);
        return true;
    }
    function active(): boolean {
        return !!(ports.current() && ports.allowed() && (pending || proof()));
    }
    // Pin the displayed portable prefix once, rather than re-reading its ordinal
    // after the number-entry timer. Legacy/pending rows cannot dispatch here.
    function captureNumber(): any {
        var captured = proof(),
            revision = epoch;
        if (!captured || pending) return null;
        function current(): boolean {
            return (
                revision === epoch &&
                ports.current() &&
                ports.allowed() &&
                captured.current()
            );
        }
        var snapshot = ports.snapshot();
        return {
            current: current,
            select: async function (
                index: number,
                admitted: () => boolean
            ): Promise<void> {
                var value = await snapshot;
                if (!current() || !value.current() || !admitted()) return;
                if (
                    !Number.isInteger(index) ||
                    index < 0 ||
                    index >= value.entries.length
                ) {
                    ports.failed("missing");
                    return;
                }
                // select() enters the normal owned route, including all target guards.
                var token: any = {
                    epoch: ++epoch,
                    external: false,
                    route: null,
                    target: value.entries[index].id,
                };
                pending = token;
                function owned(): boolean {
                    return (
                        pending === token &&
                        epoch === token.epoch &&
                        ports.current() &&
                        ports.allowed()
                    );
                }
                try {
                    token.route = ports.select(token.target);
                    var result = await token.route.result;
                    if (!owned()) return;
                    if (!result || result.status !== "ok") {
                        retire();
                        ports.failed(
                            (result && result.status) || "unavailable"
                        );
                    } else routeState({ id: token.target, phase: "playing" });
                } catch (_) {
                    if (owned()) {
                        retire();
                        ports.failed("unavailable");
                    }
                }
            },
            title: async function (index: number): Promise<string> {
                var value = await snapshot;
                return current() && value.current() && value.entries[index]
                    ? value.entries[index].title
                    : "";
            },
        };
    }
    // Called only by the guarded decoder EOF callback, before its Stop transition.
    function prepareEnded(generation: number): any {
        if (pending || !proof()) return null;
        var captured = ports.captureEnding(generation);
        ending = captured
            ? { captured: captured, epoch: epoch, generation: generation + 1 }
            : null;
        return ending;
    }
    function complete(generation: number, token: any, mode: string): boolean {
        if (completedGeneration === generation) return true;
        if (!currentId && !pending && !ending) return false;
        // An explicit selection already in flight wins over the old decoder EOF.
        if (pending) {
            ending = null;
            completedGeneration = generation;
            return true;
        }
        var accepted =
            token &&
            token === ending &&
            token.epoch === epoch &&
            token.generation === generation &&
            token.captured.id === currentId &&
            ports.current() &&
            ports.allowed() &&
            token.captured.current();
        ending = null;
        completedGeneration = generation;
        if (!accepted || mode === "pending") {
            retire();
            return true;
        }
        advance(token.captured, 1, mode);
        return true;
    }
    function selected(rows?: any[]): string | null {
        if (pending && ports.current() && ports.allowed())
            return pending.target || currentId;
        var value = proof();
        if (!value) return null;
        if (!rows) return currentId;
        var index = locate(rows, value);
        return index < 0 ? null : rows[index].id;
    }
    return {
        active: active,
        captureNumber: captureNumber,
        complete: complete,
        currentId: selected,
        isPlaying: function (id: string, rows: any[]): boolean {
            return !pending && selected(rows) === id;
        },
        move: move,
        prepareEnded: prepareEnded,
        retire: retire,
        routeState: routeState,
    };
}

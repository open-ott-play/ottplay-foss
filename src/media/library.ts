/** Navigation and request ownership have no dependency on DOM, globals or provider scripts. */
interface MediaRef {
    itemId: string;
    sourceId: string;
}
interface MediaLibraryItem {
    payload: any;
    ref: MediaRef;
    title: string;
}
interface MediaRoute {
    kind: "catalog" | "history" | "favorites" | "variants";
    target?: any;
    title: string;
}
interface MediaLibraryFrame {
    items: MediaLibraryItem[];
    route: MediaRoute;
    selected: number;
}
interface MediaLibraryView {
    frame: MediaLibraryFrame | null;
    frames: MediaLibraryFrame[];
    loading: boolean;
    revision: number;
}
interface MediaLibraryPorts {
    describe(records: any[], route: MediaRoute): MediaLibraryItem[];
    items(route: MediaRoute): MediaLibraryItem[];
    load(route: MediaRoute, done: any): (() => void) | void;
    render(view: MediaLibraryView): void;
}

function mediaLibraryCopy(value: any, seen?: any[]): any {
    if (!value || typeof value !== "object") return value;
    var parents = seen || [];
    if (parents.indexOf(value) !== -1) return undefined;
    var copy: any = Array.isArray(value) ? [] : {};
    Object.keys(value).forEach(function (key) {
        Object.defineProperty(copy, key, {
            configurable: true,
            enumerable: true,
            value: mediaLibraryCopy(value[key], parents.concat([value])),
            writable: true,
        });
    });
    return copy;
}

function createMediaLibrary(ports: MediaLibraryPorts) {
    var frames: MediaLibraryFrame[] = [];
    var revision = 0;
    var loading = false;
    var cleanup: (() => void) | null = null;
    function cancel() {
        var token = ++revision;
        var previous = cleanup;
        cleanup = null;
        loading = false;
        if (previous) previous();
        return token;
    }
    function snapshot(): MediaLibraryView {
        var copy = mediaLibraryCopy(frames);
        return {
            frame: copy.length ? copy[copy.length - 1] : null,
            frames: copy,
            loading: loading,
            revision: revision,
        };
    }
    function render() {
        ports.render(snapshot());
    }
    function open(route: MediaRoute, reset = false) {
        var token = cancel();
        if (token !== revision) return;
        if (reset) frames = [];
        var frame: MediaLibraryFrame = {
            items: [],
            route: mediaLibraryCopy(route),
            selected: 0,
        };
        frames.push(frame);
        if (route.kind !== "catalog") {
            frame.items = mediaLibraryCopy(ports.items(route));
            if (token === revision) render();
            return;
        }
        loading = true;
        var settled = false;
        var done: any = function (records: any[], title?: string) {
            if (!done.isCurrent()) return;
            settled = true;
            loading = false;
            cleanup = null;
            frame.items = ports.describe(records || [], frame.route);
            if (typeof title === "string" && title) frame.route.title = title;
            if (token === revision) render();
        };
        done.isCurrent = function () {
            return (
                token === revision &&
                !settled &&
                frames[frames.length - 1] === frame
            );
        };
        done.active = function () {
            return token === revision && frames[frames.length - 1] === frame;
        };
        done.update = function (
            records: any[],
            title?: string,
            selected?: number
        ) {
            if (!done.active()) return;
            frame.items = ports.describe(records || [], frame.route);
            if (typeof title === "string") frame.route.title = title;
            if (typeof selected === "number") frame.selected = selected;
            render();
        };
        var abort = ports.load(frame.route, done);
        if (typeof abort === "function") {
            if (token !== revision && !settled) abort();
            else if (!settled) cleanup = abort;
        }
    }
    return {
        back: function () {
            var token = cancel();
            if (token !== revision) return false;
            if (frames.length <= 1) return false;
            frames.pop();
            render();
            return true;
        },
        cancel: cancel,
        capture: function () {
            var token = revision;
            var frame = frames[frames.length - 1];
            var selected = frame && frame.selected;
            return function () {
                return (
                    token === revision &&
                    frame === frames[frames.length - 1] &&
                    (!frame || selected === frame.selected)
                );
            };
        },
        close: function () {
            var pending = loading;
            var token = cancel();
            if (pending && token === revision) frames.pop();
        },
        open: open,
        replaceItems: function (items: MediaLibraryItem[]) {
            if (!frames.length) return;
            frames[frames.length - 1].items = mediaLibraryCopy(items);
            render();
        },
        resolve: function (
            execute: (done: any) => (() => void) | void,
            accept: (item: any) => void
        ) {
            var token = cancel();
            if (token !== revision) return;
            var settled = false;
            var done: any = function (item: any) {
                if (!done.isCurrent()) return;
                settled = true;
                cleanup = null;
                accept(item);
            };
            done.isCurrent = function () {
                return token === revision && !settled;
            };
            var abort = execute(done);
            if (typeof abort === "function") {
                if (token !== revision && !settled) abort();
                else if (!settled) cleanup = abort;
            }
        },
        select: function (index: number): MediaLibraryItem | null {
            var frame = frames[frames.length - 1];
            if (!frame || !frame.items[index]) return null;
            frame.selected = index;
            return mediaLibraryCopy(frame.items[index]);
        },
        show: render,
        snapshot: snapshot,
    };
}

(window as any).__ottMediaLibrary = {
    copy: mediaLibraryCopy,
    create: createMediaLibrary,
};

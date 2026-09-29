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
interface MediaOwnedFrame extends MediaLibraryFrame {
    catalog: MediaLibraryItem[];
}
interface MediaLibraryView {
    frame: MediaLibraryFrame | null;
    frames: MediaLibraryFrame[];
    loading: boolean;
    revision: number;
}
interface MediaLibraryPorts {
    describe(records: any[], route: MediaRoute): MediaLibraryItem[];
    filter?(items: MediaLibraryItem[], route: MediaRoute): MediaLibraryItem[];
    items(route: MediaRoute): MediaLibraryItem[];
    load(route: MediaRoute, done: any): (() => void) | void;
    render(view: MediaLibraryView): void;
}

function mediaLibraryCopy(value: any, seen?: any[]): any {
    if (!value || typeof value !== "object") return value;
    var parents = seen || [];
    if (parents.indexOf(value) !== -1) return undefined;
    parents = parents.concat([value]);
    var copy: any = Array.isArray(value) ? [] : {};
    Object.keys(value).forEach(function (key) {
        Object.defineProperty(copy, key, {
            configurable: true,
            enumerable: true,
            value: mediaLibraryCopy(value[key], parents),
            writable: true,
        });
    });
    return copy;
}

function createMediaLibrary(ports: MediaLibraryPorts) {
    var frames: MediaOwnedFrame[] = [];
    var filterRevision = 0;
    var revision = 0;
    var viewRevision = 0;
    var loading = false;
    var resolving = false;
    var cleanup: (() => void) | null = null;
    function cancel() {
        var token = ++revision;
        viewRevision++;
        var previous = cleanup;
        cleanup = null;
        loading = false;
        resolving = false;
        if (previous) previous();
        return token;
    }
    // Public snapshots retain every page. Rendering needs only the current
    // page's payloads; navigation decisions need detached route metadata.
    function snapshot(
        items: "all" | "current" | "none" = "all"
    ): MediaLibraryView {
        var copy = frames.map(function (frame, index) {
            return mediaLibraryCopy({
                items:
                    items === "none" ||
                    (items === "current" && index !== frames.length - 1)
                        ? []
                        : frame.items,
                route: frame.route,
                selected: frame.selected,
            });
        });
        return {
            frame: copy.length ? copy[copy.length - 1] : null,
            frames: copy,
            loading: loading,
            revision: viewRevision,
        };
    }
    function applyFilter(
        frame: MediaOwnedFrame,
        selected: MediaLibraryItem = frame.items[frame.selected]
    ) {
        frame.items = ports.filter
            ? ports.filter(frame.catalog, frame.route)
            : frame.catalog;
        frame.selected = 0;
        if (selected && !selected.payload.__ottMediaFilter)
            frame.items.some(function (item, index) {
                if (item.ref.itemId !== selected.ref.itemId) return false;
                frame.selected = index;
                return true;
            });
    }
    function setItems(
        frame: MediaOwnedFrame,
        items: MediaLibraryItem[],
        selected?: MediaLibraryItem
    ) {
        viewRevision++;
        frame.catalog = items;
        applyFilter(frame, selected);
    }
    function render() {
        ports.render(snapshot("current"));
    }
    function selectItem(index: number): MediaLibraryItem | null {
        var frame = frames[frames.length - 1];
        if (!frame || !frame.items[index]) return null;
        frame.selected = index;
        return frame.items[index];
    }
    function open(route: MediaRoute, reset = false) {
        var token = cancel();
        if (token !== revision) return;
        if (reset) frames = [];
        var frame: MediaOwnedFrame = {
            catalog: [],
            items: [],
            route: mediaLibraryCopy(route),
            selected: 0,
        };
        frames.push(frame);
        if (route.kind !== "catalog") {
            setItems(frame, mediaLibraryCopy(ports.items(route)));
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
            setItems(frame, ports.describe(records || [], frame.route));
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
            var items = ports.describe(records || [], frame.route);
            setItems(
                frame,
                items,
                typeof selected === "number" ? items[selected] : undefined
            );
            if (typeof title === "string") frame.route.title = title;
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
            var filtered = filterRevision;
            var frame = frames[frames.length - 1];
            var selected = frame && frame.selected;
            var item = frame && frame.items[selected];
            return function () {
                var current = frame && frame.items[frame.selected];
                return (
                    token === revision &&
                    filtered === filterRevision &&
                    frame === frames[frames.length - 1] &&
                    (!frame || selected === frame.selected) &&
                    (item
                        ? current &&
                          current.ref.itemId === item.ref.itemId &&
                          current.ref.sourceId === item.ref.sourceId
                        : !current)
                );
            };
        },
        catalog: function () {
            var frame = frames[frames.length - 1];
            return frame ? mediaLibraryCopy(frame.catalog) : [];
        },
        close: function () {
            var pending = loading;
            var token = cancel();
            if (pending && token === revision) frames.pop();
        },
        // Highlight changes owned selection without publishing item data.
        highlight: function (index: number) {
            selectItem(index);
        },
        open: open,
        refilter: function (commit?: () => void) {
            if (resolving && cancel() !== revision) return;
            if (commit) commit();
            filterRevision++;
            viewRevision++;
            frames.forEach(function (frame) {
                applyFilter(frame);
            });
            render();
        },
        replaceItems: function (items: MediaLibraryItem[]) {
            if (!frames.length) return;
            setItems(frames[frames.length - 1], mediaLibraryCopy(items));
            render();
        },
        resolve: function (
            execute: (done: any) => (() => void) | void,
            accept: (item: any) => void
        ) {
            var token = cancel();
            if (token !== revision) return;
            resolving = true;
            var settled = false;
            var done: any = function (item: any) {
                if (!done.isCurrent()) return;
                settled = true;
                resolving = false;
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
        revision: function () {
            return viewRevision;
        },
        select: function (index: number): MediaLibraryItem | null {
            return mediaLibraryCopy(selectItem(index));
        },
        show: render,
        snapshot: snapshot,
    };
}

(window as any).__ottMediaLibrary = {
    copy: mediaLibraryCopy,
    create: createMediaLibrary,
};

/** Screen and input codec; async selection carries identities, never array offsets. */
var classicGuideScreen: any = null;
var classicGuideView: any = null;
function currentGuideScreen(): any {
    var host = window as any,
        guide = host.__ottClassicGuide;
    if (!classicGuideScreen)
        classicGuideScreen = host.__ottGuideScreen.create({
            current: guide.valid,
            now: function () {
                return Date.now() / 1000;
            },
            request: function (ref: any, callback: any) {
                guide.bind(ref);
                return guide.owner().request(ref, callback);
            },
            select: function (rows: any, now: number, count: number) {
                return host.OttPlayCore.guideScheduleSelection(
                    rows,
                    now,
                    count
                );
            },
        });
    return classicGuideScreen;
}
function guidePosition(id: any, preferred?: string): [number, number] | null {
    var host = window as any,
        names = host.catsArray || [],
        groups = host.cats || {};
    var order = names.slice();
    if (preferred && order.indexOf(preferred) >= 0) {
        order.splice(order.indexOf(preferred), 1);
        order.unshift(preferred);
    }
    for (var c = 0; c < order.length; c++) {
        var at = (groups[order[c]] || []).indexOf(id);
        if (at >= 0) return [names.indexOf(order[c]), at];
    }
    return null;
}
function openClassicGuide(
    mode: number,
    category: number,
    index: number,
    returnToList: boolean,
    selectedId?: string,
    after?: any
): void {
    var host = window as any,
        guide = host.__ottClassicGuide,
        group = (host.catsArray || [])[category],
        id = ((host.cats || {})[group] || [])[index],
        reference = guide.reference(id);
    if (!reference || (mode === 0 && !(Number(reference.token.rec) > 0)))
        return;
    if (
        !selectedId &&
        classicGuideView &&
        classicGuideView.reference.channelId === reference.channelId &&
        classicGuideView.reference.sourceId === reference.sourceId
    ) {
        var previousChoice = selectedClassicGuide();
        if (previousChoice) selectedId = previousChoice.row.id;
    }
    var screen = currentGuideScreen(),
        view = {
            after: after,
            group: group,
            mode: mode,
            publishing: false,
            reference: reference,
            release: null as any,
            returnToList: returnToList,
            selectedId: selectedId,
        };
    var previous = classicGuideView;
    classicGuideView = view;
    if (previous && previous.release) {
        previous.publishing = true;
        previous.release();
    }
    if (classicGuideView !== view || !guide.valid(reference)) return;
    function bindOwner(): void {
        if (!host.__ottClassicScreenPort) return;
        view.release = host.__ottClassicScreenPort.onDispose(function () {
            if (!view.publishing && classicGuideView === view) {
                classicGuideView = null;
                screen.close();
            }
        });
    }
    bindOwner();
    if (host.jQuery)
        host.jQuery("#listPopUp")
            .html(
                '<div class="ott-spinner" aria-hidden="true"><span class="blob"></span><span class="blob"></span><span class="blob"></span><span class="blob"></span></div>'
            )
            .show();
    var playhead =
        host.playType > 0 && id === (host.curList || [])[host.primaryIndex]
            ? host.playType + host.playTime
            : Date.now() / 1000;
    if (classicGuideView !== view || !guide.valid(reference)) return;
    screen.open(
        reference,
        mode,
        Number(reference.token.rec) || 0,
        playhead,
        function (model: any) {
            if (classicGuideView !== view || !screen.current()) return;
            var position = guidePosition(id, group);
            if (!position) return;
            view.publishing = true;
            if (view.release) view.release();
            try {
                host.renderGuideView(mode, id, model, returnToList, position);
            } finally {
                view.publishing = false;
            }
            if (classicGuideView !== view || !screen.current()) return;
            bindOwner();
            if (after) screen.guard(after)();
        },
        selectedId
    );
}
function selectedClassicGuide(): any {
    var host = window as any,
        screen = currentGuideScreen(),
        reference = screen.reference(),
        item = (host.listArray || [])[host.selIndex];
    if (!item || !reference || !screen.current()) return null;
    var row = screen.select(String(item.programmeId || ""));
    return row
        ? { reference: reference, row: row, view: classicGuideView }
        : null;
}
(window as any).__ottClassicGuideScreen = {
    close: function () {
        var previous = classicGuideView;
        classicGuideView = null;
        if (classicGuideScreen) classicGuideScreen.close();
        if (previous && previous.release) previous.release();
    },
    current: selectedClassicGuide,
    guard: function (callback: any) {
        return currentGuideScreen().guard(callback);
    },
    open: openClassicGuide,
    position: guidePosition,
    refresh: function () {
        var view = classicGuideView;
        if (!view) return;
        selectedClassicGuide();
        var at = guidePosition(view.reference.id, view.group);
        if (at)
            openClassicGuide(
                view.mode,
                at[0],
                at[1],
                view.returnToList,
                currentGuideScreen().snapshot().selectedId
            );
    },
    select: function () {
        var host = window as any,
            guide = host.__ottClassicGuide,
            choice = selectedClassicGuide();
        if (!choice) return;
        var reference = choice.reference,
            row = choice.row,
            used = false;
        if (
            !(Number(reference.token.rec) > 0) ||
            row.start > Date.now() / 1000
        ) {
            if (host.showProgramInfo) host.showProgramInfo(row.title);
            return;
        }
        var schedule = guide.encodeRows(
            currentGuideScreen().snapshot().schedule
        );
        var accept = currentGuideScreen().guard(function () {
            var selected = selectedClassicGuide(),
                now = Date.now() / 1000,
                position = guidePosition(reference.id, choice.view.group);
            if (
                used ||
                !selected ||
                selected.row.id !== row.id ||
                !position ||
                !guide.valid(reference) ||
                !(Number(reference.token.rec) > 0) ||
                row.start > now ||
                row.start <= now - Number(reference.token.rec) * 3600
            )
                return;
            used = true;
            if (host.closeList) host.closeList();
            if (!guide.valid(reference)) return;
            host.setCurrent(position[0], position[1], true);
            host.epgArray = schedule;
            host.playArchive(row.start);
        });
        if (host.__ottClassicPlayback)
            accept = host.__ottClassicPlayback.guard(accept);
        if (
            host.ifParentalAccessChId &&
            host.ifParentalAccessChId(reference.id, accept)
        )
            return;
        accept();
    },
};

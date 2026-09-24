/**
 * Transitional codec/effect boundary for the classic UI and provider ABI.
 * Numeric modes and positional records never enter the common playback model.
 * Remove this module when the remaining classic views consume typed state.
 */
var classicPlaybackController: any = null;

function classicPlaybackHost(): any {
    return window as any;
}

function classicPlaybackSource(w: any): string {
    return String(w.p_pref || w.providerId || "classic").trim() || "classic";
}

function classicPlaybackIdentity(value: any): boolean {
    return (
        (typeof value === "number" && isFinite(value)) ||
        (typeof value === "string" && value.trim().length > 0)
    );
}

function classicPlaybackChannel(w: any, category: number, index: number): any {
    var key = (w.catsArray || [])[category];
    return ((w.cats || {})[key] || [])[index];
}

function classicPlaybackVisit(w: any, selection = false): PlaybackVisit | null {
    var mode = Number(w.playType) || 0;
    if (!isFinite(mode)) mode = 0;
    var id = classicPlaybackChannel(w, w.catIndex, w.primaryIndex);
    if (mode < 0 && (!selection || mode === -1e11)) {
        var media = mode === -1e11 ? (w.medHistory || [])[0] : null;
        return {
            channelId: String(
                (media && media.stream_url) ||
                    (classicPlaybackIdentity(id) ? "channel:" + id : "media")
            ),
            kind: "vod",
            payload: media,
            sourceId: classicPlaybackSource(w),
        };
    }
    if (!classicPlaybackIdentity(id)) return null;
    return {
        archiveStart: mode > 0 ? mode : undefined,
        channelId: String(id),
        kind: mode > 0 ? "archive" : "live",
        payload: {
            c: w.catIndex,
            ci: id,
            e: w._prog100 && w._prog100.name,
            i: w.primaryIndex,
        },
        sourceId: classicPlaybackSource(w),
    };
}

function classicPlaybackObservation(): PlaybackObservation {
    var w = classicPlaybackHost();
    var target = classicPlaybackVisit(w);
    var id = classicPlaybackChannel(w, w.catIndex, w.primaryIndex);
    var channel = (w.channels || {})[id];
    var catalog = w.channels;
    var categories = w.catsArray;
    var lists = w.cats;
    var list = (lists || {})[(categories || [])[w.catIndex]];
    var get = w.providerGetItem;
    var set = w.providerSetItem;
    var prefix = w.p_pref;
    var source = classicPlaybackSource(w);
    var media = (w.medHistory || [])[0];
    var retention = Number(channel && channel.rec) || 0;
    var now = Date.now() / 1000;
    return {
        archiveAvailable:
            retention > 0 || (!!target && target.kind === "archive"),
        archiveEarliest:
            retention > 0 ? Math.max(0, now - retention * 3600) : undefined,
        duration: typeof w.stbGetLen === "function" ? w.stbGetLen() : 0,
        isCurrent: function (): boolean {
            return (
                catalog === w.channels &&
                categories === w.catsArray &&
                lists === w.cats &&
                list === (w.cats || {})[(w.catsArray || [])[w.catIndex]] &&
                channel === (w.channels || {})[id] &&
                get === w.providerGetItem &&
                set === w.providerSetItem &&
                prefix === w.p_pref &&
                source === classicPlaybackSource(w) &&
                (w.playType !== -1e11 || media === (w.medHistory || [])[0])
            );
        },
        now: now,
        position:
            target && target.kind === "archive"
                ? Number(w.playTime) || 0
                : typeof w.stbGetPosTime === "function"
                  ? w.stbGetPosTime()
                  : 0,
        target: target,
    };
}

function classicPlaybackAnnounce(intent: PlaybackIntent): void {
    var w = classicPlaybackHost();
    if (w.sInfoRew && typeof w.showChannelInfo === "function")
        w.showChannelInfo(1);
    if (typeof w.showShift !== "function") return;
    if (intent.intent === "begin")
        w.showShift(w._ ? w._("To begining") : "To beginning");
    else if (typeof w.formatSeekOffset === "function")
        w.showShift(w.formatSeekOffset(intent.value || 0));
}

function classicPlaybackRuntime(): any {
    if (classicPlaybackController) return classicPlaybackController;
    var w = classicPlaybackHost();
    classicPlaybackController = w.__ottPlaybackSession.create(w.OttPlayCore, {
        apply: function (plan: any, intent: PlaybackIntent): void {
            if (plan.action === "seek") {
                if (typeof w.stbSetPosTime === "function")
                    w.stbSetPosTime(plan.position);
                classicPlaybackAnnounce(intent);
            } else if (plan.action === "open-archive") {
                if (
                    Number(w.playType) === 0 &&
                    typeof w.timeShift === "function"
                )
                    w.timeShift(
                        Math.max(0, Date.now() / 1000 - plan.archiveStart)
                    );
                else {
                    classicPlaybackAnnounce(intent);
                    w.playArchive(plan.archiveStart);
                }
            } else if (plan.action === "go-live" || plan.action === "restart") {
                if (typeof w.showShift === "function") {
                    var message =
                        plan.action === "go-live" ? "Live" : "Restart stream";
                    w.showShift(w._ ? w._(message) : message);
                }
                w.playChannel(w.catIndex, w.primaryIndex);
            }
        },
        observe: classicPlaybackObservation,
        preview: classicPlaybackAnnounce,
        schedule: function (callback: () => void, delay: number): any {
            return setTimeout(callback, delay);
        },
        unschedule: function (timer: any): void {
            clearTimeout(timer);
        },
    });
    return classicPlaybackController;
}

function classicPlaybackSelect(
    category: number,
    index: number,
    archive?: boolean
): void {
    var w = classicPlaybackHost();
    var observation = classicPlaybackObservation();
    var id = classicPlaybackChannel(w, category, index);
    var next: PlaybackVisit | null =
        index === -1 || !classicPlaybackIdentity(id)
            ? null
            : {
                  archiveStart: archive
                      ? observation.target &&
                        observation.target.kind === "archive"
                          ? observation.target.archiveStart
                          : observation.now
                      : undefined,
                  channelId: String(id),
                  kind: archive ? "archive" : "live",
                  sourceId: classicPlaybackSource(w),
              };
    var history: PlaybackVisit[] = [];
    (Array.isArray(w.prevArr) ? w.prevArr : []).forEach(function (
        entry: any
    ): void {
        if (
            !entry ||
            typeof entry !== "object" ||
            !classicPlaybackIdentity(entry.ci)
        )
            return;
        if (
            entry.t !== undefined &&
            (typeof entry.t !== "number" || !isFinite(entry.t) || entry.t < 0)
        )
            return;
        history.push({
            archiveStart: entry.t,
            channelId: String(entry.ci),
            kind: entry.t !== undefined ? "archive" : "live",
            payload: entry,
            sourceId: classicPlaybackSource(w),
        });
    });
    var limit =
        [1, 5, 10, 15, 20][w.settings ? w.settings.prevCount : w.sPrevCount] ||
        10;
    var result = classicPlaybackRuntime().transition(
        classicPlaybackVisit(w, true),
        next,
        history,
        observation.position,
        limit,
        ["live", "archive"]
    );
    w.prevArr = result.history.map(function (visit: PlaybackVisit): any {
        var record: any = {};
        Object.keys(visit.payload || {}).forEach(function (key: string): void {
            if (key !== "t") record[key] = visit.payload[key];
        });
        if (visit.kind === "archive") record.t = visit.archiveStart;
        return record;
    });
    result.effects.forEach(function (effect: any): void {
        // Other negative classic modes are platform-owned files, not medHistory.
        if (
            effect.type !== "save-position" ||
            w.playType !== -1e11 ||
            !(w.medHistory || []).length
        )
            return;
        w.medHistory[0].current = Math.max(0, Math.floor(effect.position) || 0);
        if (w.sFavorites !== -1)
            w.providerSetItem("medHistory", JSON.stringify(w.medHistory));
    });
    // A departure-only call does not change the classic selection or bookmark.
    if (index === -1) return;
    w.catIndex = category;
    w.curList = (w.cats || {})[(w.catsArray || [])[category]] || [];
    w.primaryIndex = index;
    w.providerSetItem("primaryIndex", String(index));
    w.providerSetItem("catIndex", String(category));
    w.providerSetItem("prevArr", JSON.stringify(w.prevArr));
    try {
        // Preserve the v1 persistence contract until the versioned importer ships.
        var mode = w.playType > 0 ? "archive" : w.playType < 0 ? "vod" : "live";
        var bookmark: any = {
            catIndex: category,
            channelId: w.curList[index],
            channelIndex: index,
            mode: mode,
            updatedAt: Date.now(),
            v: 1,
        };
        if (mode !== "live") {
            bookmark.playType = w.playType;
            bookmark.playTime = w.playTime;
        }
        w.providerSetItem("continueWatch", JSON.stringify(bookmark));
    } catch (_error) {
        /* Bookmark persistence must not interrupt playback. */
    }
}

(window as any).__ottClassicPlayback = {
    cancel: function (): void {
        if (classicPlaybackController) classicPlaybackController.cancel();
    },
    guard: function (
        callback: (...args: any[]) => void
    ): (...args: any[]) => void {
        return classicPlaybackRuntime().guard(callback);
    },
    select: classicPlaybackSelect,
    shift: function (delta: number): void {
        classicPlaybackRuntime().request(
            delta === -6e6
                ? { intent: "begin" }
                : { intent: "offset", value: delta }
        );
    },
};

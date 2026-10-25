/** Bounded edits of the saved Plex selection; no playback or network requests. */
function createRemotePlexFolders(w: any, runtime: () => string): any {
    var serial = 0,
        driver: any = null,
        fields: any = null,
        context: any = null,
        stamp = "",
        receipts: any[] = [],
        busy = false;
    var tokenPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
    var pathPattern =
        /^\/library\/(?:sections\/[1-9][0-9]{0,19}\/(?:all(?:\?type=(?:[134]|10))?|folder(?:\?parent=[0-9]{1,20})?)|metadata\/[1-9][0-9]{0,19}\/children)$/;
    function token(kind: string): string {
        return kind + Date.now().toString(36) + ":" + ++serial;
    }
    function text(value: any, maximum: number): boolean {
        if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value))
            return false;
        try {
            return (
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= maximum
            );
        } catch (_) {
            return false;
        }
    }
    function identity(active: any): string {
        return JSON.stringify([runtime(), active && active.configuration()]);
    }
    function refresh(): void {
        var active = w.__ottActiveProviderDriver;
        if (!active || active.id !== "plex" || !w.__ottRemoteProviderFields)
            throw new Error("unsupported");
        var next = identity(active);
        if (driver !== active || next !== stamp) {
            driver = active;
            stamp = next;
            fields = w.__ottRemoteProviderFields.create(w, driver);
            receipts = [];
            context = {
                profile: null,
                provider: "plex",
                token: token("folders:"),
            };
        }
        if (!fields) throw new Error("unsupported");
    }
    function locked(): boolean {
        return !!(
            (w.__ottKiosk && w.__ottKiosk.enabled()) ||
            (w.__ottParental
                ? w.__ottParental.needs("settings") ||
                  w.__ottParental.needs("providers")
                : (w.sPSoptions || w.sPSprovs) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess)
        );
    }
    function remember(snapshot: any): any {
        var now = Date.now();
        receipts = receipts.filter(function (row) {
            return row.created <= now && row.expires > now;
        });
        while (receipts.length >= 8) receipts.shift();
        var row = {
            created: now,
            expires: now + 120000,
            revision: token("selection:"),
            snapshot: snapshot,
        };
        receipts.push(row);
        return row;
    }
    function request(request: any, done: (result: any) => void): void {
        var p = request.params || {},
            op = p.op,
            expectedRuntime =
                typeof p.runtime === "string" ? p.runtime : runtime(),
            completed = false;
        function fail(reason: string): void {
            if (completed) return;
            completed = true;
            done({
                data: {
                    error: "The Plex folder request could not be completed.",
                    op: op,
                    reason: reason,
                    runtime: expectedRuntime,
                    version: 1,
                },
                status: reason === "unsupported" ? "unsupported" : "rejected",
            });
        }
        function reply(data: any): void {
            if (completed) return;
            data.version = 1;
            data.op = op;
            data.runtime = expectedRuntime;
            data.context = context;
            if (!text(JSON.stringify(data), 65536)) {
                fail("unsupported");
                return;
            }
            completed = true;
            done({ data: data, status: "ok" });
        }
        if (busy) {
            fail("revision_conflict");
            return;
        }
        busy = true;
        try {
            if (
                !p ||
                typeof p !== "object" ||
                Array.isArray(p) ||
                !tokenPattern.test(p.runtime) ||
                typeof p.runtime !== "string"
            )
                throw new Error("invalid_request");
            if (expectedRuntime !== runtime())
                throw new Error("runtime_changed");
            refresh();
            var original = driver,
                admittedContext = context.token;
            function current(): boolean {
                return (
                    runtime() === expectedRuntime &&
                    w.__ottActiveProviderDriver === original &&
                    !(
                        typeof request.expires_at === "number" &&
                        Date.now() >= request.expires_at * 1000
                    )
                );
            }
            if (!current()) throw new Error("source_changed");
            var names = Object.keys(p).sort().join(","),
                row: any = null,
                offset = 0;
            if (op === "list") {
                if (
                    Object.keys(p).some(function (key) {
                        return (
                            ["op", "runtime", "cursor", "limit"].indexOf(key) <
                            0
                        );
                    }) ||
                    (p.limit !== undefined &&
                        (typeof p.limit !== "number" ||
                            p.limit < 1 ||
                            p.limit > 10 ||
                            Math.floor(p.limit) !== p.limit))
                )
                    throw new Error("invalid_request");
                if (p.cursor !== undefined) {
                    if (
                        typeof p.cursor !== "string" ||
                        !tokenPattern.test(p.cursor)
                    )
                        throw new Error("invalid_request");
                    receipts.forEach(function (candidate) {
                        if (p.cursor.indexOf(candidate.revision + ":") === 0)
                            row = candidate;
                    });
                    if (
                        !row ||
                        !/^\d+$/.test(p.cursor.slice(row.revision.length + 1))
                    )
                        throw new Error("source_changed");
                    offset = Number(p.cursor.slice(row.revision.length + 1));
                    if (offset <= 0 || offset >= row.snapshot.items.length)
                        throw new Error("source_changed");
                } else row = remember(fields.folderSnapshot());
                if (
                    !row.snapshot.capture.current() ||
                    row.created > Date.now() ||
                    row.expires <= Date.now() ||
                    !current()
                )
                    throw new Error("source_changed");
                var end = Math.min(
                    row.snapshot.items.length,
                    offset + (p.limit || 10)
                );
                reply({
                    items: row.snapshot.items.slice(offset, end),
                    max_items: 1000,
                    next_cursor:
                        end < row.snapshot.items.length
                            ? row.revision + ":" + end
                            : null,
                    revision: row.revision,
                    total: row.snapshot.items.length,
                });
                return;
            }
            if (
                names !==
                    (op === "add"
                        ? "context,op,path,revision,runtime,title"
                        : op === "remove"
                          ? "context,op,path,revision,runtime"
                          : op === "clear"
                            ? "context,op,revision,runtime"
                            : "") ||
                typeof p.context !== "string" ||
                !tokenPattern.test(p.context) ||
                typeof p.revision !== "string" ||
                !tokenPattern.test(p.revision)
            )
                throw new Error("invalid_request");
            if (
                op !== "clear" &&
                (typeof p.path !== "string" || !pathPattern.test(p.path))
            )
                throw new Error("invalid_value");
            if (op === "add" && (!text(p.title, 4096) || p.title.length > 1024))
                throw new Error("invalid_value");
            if (p.context !== admittedContext)
                throw new Error("source_changed");
            if (locked()) throw new Error("policy_restricted");
            for (var i = 0; i < receipts.length; i++)
                if (receipts[i].revision === p.revision) {
                    row = receipts.splice(i, 1)[0];
                    break;
                }
            if (
                !row ||
                row.created > Date.now() ||
                row.expires <= Date.now() ||
                !row.snapshot.capture.current()
            )
                throw new Error("revision_conflict");
            var items = row.snapshot.items.slice(),
                found = -1;
            items.forEach(function (item, index) {
                if (item.path === p.path) found = index;
            });
            if (op === "clear") items = [];
            else if (op === "remove" && found >= 0) items.splice(found, 1);
            else if (op === "add" && found < 0) {
                if (items.length >= 1000) throw new Error("capacity_exceeded");
                items.push({ path: p.path, title: p.title.trim() });
            }
            var changed =
                    JSON.stringify(items) !==
                    JSON.stringify(row.snapshot.items),
                saved: any;
            if (changed)
                saved = fields.saveFolders(
                    items,
                    row.snapshot.capture,
                    function () {
                        return current() && !locked();
                    }
                );
            else
                saved = {
                    effectFailed: false,
                    snapshot: fields.folderSnapshot(),
                };
            if (!current() || !saved.snapshot.capture.current())
                throw new Error("source_changed");
            stamp = identity(driver);
            receipts = [];
            var next = remember(saved.snapshot);
            reply({
                application: saved.effectFailed
                    ? { reason: "effect_failed", state: "failed" }
                    : { reason: "next_catalogue", state: "deferred" },
                changed: changed,
                persisted: true,
                revision: next.revision,
                total: items.length,
            });
        } catch (error) {
            var reason = (error as any).message;
            fail(
                /^(invalid_request|invalid_value|runtime_changed|source_changed|revision_conflict|policy_restricted|unsupported|storage_failed|capacity_exceeded)$/.test(
                    reason
                )
                    ? reason
                    : "storage_failed"
            );
        } finally {
            busy = false;
        }
    }
    return { request: request };
}
(window as any).__ottRemotePlexFolders = { create: createRemotePlexFolders };

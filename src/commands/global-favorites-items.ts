import {
    parseFavoritesDocumentJson,
    utf8Encode,
} from "./favorites-document-json";

const ITEM_ERRORS = [
    "invalid_request",
    "envelope_too_large",
    "unsupported",
    "runtime_changed",
    "expired",
    "cancelled",
    "policy_denied",
    "busy",
    "storage_unavailable",
    "unsupported_persistence",
    "limits_exceeded",
    "invalid_cursor",
    "revision_conflict",
    "context_changed",
    "favorite_not_found",
    "source_unavailable",
    "ambiguous_source",
    "item_unavailable",
    "ambiguous_item",
    "unsupported_item",
    "playback_failed",
];
const ITEM_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const ITEM_HASH = /^[0-9a-f]{64}(?![\s\S])/;
function exactItems(value: any, keys: string[]): boolean {
    return (
        !!value && Object.keys(value).sort().join(",") === keys.sort().join(",")
    );
}
function itemsFail(code: string): never {
    throw new Error(code);
}
/** Read-only catalog/current and guarded dispatch; membership changes use the staged protocol. */
export function createGlobalFavoritesItems(ports: any) {
    var cancelled = false,
        play: any = null;
    function current(
        runtime: string,
        deadline: number,
        admission: () => boolean
    ) {
        if (cancelled) itemsFail("cancelled");
        if (!ports.current() || ports.runtime() !== runtime || !admission())
            itemsFail("runtime_changed");
        if (ports.now() >= deadline) itemsFail("expired");
    }
    function cursor(revision: string, context: string, offset: number): string {
        return ports
            .base64Encode(
                utf8Encode(JSON.stringify([revision, context, offset]))
            )
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }
    async function execute(
        p: any,
        envelopeBytes: number,
        expiresAt: number,
        admission: () => boolean
    ): Promise<any> {
        var runtime = ports.runtime(),
            op = p && p.op,
            deadline = Math.floor(expiresAt * 1000);
        var base = { op: op, runtime: runtime, subject: "global", version: 1 };
        try {
            if (
                typeof envelopeBytes !== "number" ||
                Math.floor(envelopeBytes) !== envelopeBytes ||
                envelopeBytes < 1 ||
                envelopeBytes > 16384
            )
                itemsFail("envelope_too_large");
            if (
                !p ||
                p.runtime !== runtime ||
                p.subject !== "global" ||
                ["list", "current", "play"].indexOf(op) < 0 ||
                !isFinite(deadline)
            )
                itemsFail("invalid_request");
            current(runtime, deadline, admission);
            if (!ports.authorized(op)) itemsFail("policy_denied");
            if (
                op === "current" &&
                exactItems(p, ["op", "runtime", "subject"])
            ) {
                var item = await ports.host.currentItem();
                current(runtime, deadline, admission);
                if (!item.current()) itemsFail("context_changed");
                return Object.assign(base, {
                    context_revision: item.context_revision,
                    entry: item.entry,
                    revision: item.revision,
                    unavailable_reason: item.unavailable_reason,
                });
            }
            if (
                op === "play" &&
                exactItems(p, [
                    "op",
                    "runtime",
                    "subject",
                    "id",
                    "expected_revision",
                    "expected_context_revision",
                ])
            ) {
                if (
                    !ITEM_UUID.test(p.id) ||
                    !ITEM_HASH.test(p.expected_revision) ||
                    !ITEM_HASH.test(p.expected_context_revision)
                )
                    itemsFail("invalid_request");
                play = ports.host.playUUID(
                    p.id,
                    p.expected_revision,
                    p.expected_context_revision,
                    function () {
                        try {
                            current(runtime, deadline, admission);
                            return true;
                        } catch (_) {
                            return false;
                        }
                    }
                );
                var result = await play.result;
                current(runtime, deadline, admission);
                if (!result || result.status !== "ok") {
                    var status = result && result.status,
                        errors: any = {
                            ambiguous: "ambiguous_source",
                            blocked: "policy_denied",
                            changed: "context_changed",
                            missing: "favorite_not_found",
                            timeout: "expired",
                            unavailable: "item_unavailable",
                            unsupported: "unsupported_item",
                        };
                    itemsFail(errors[status] || status || "playback_failed");
                }
                return Object.assign(base, {
                    context_revision: p.expected_context_revision,
                    dispatched: true,
                    id: p.id,
                    revision: p.expected_revision,
                });
            }
            if (
                op !== "list" ||
                !exactItems(p, [
                    "op",
                    "runtime",
                    "subject",
                    "cursor",
                    "max_entries",
                ]) ||
                typeof p.max_entries !== "number" ||
                Math.floor(p.max_entries) !== p.max_entries ||
                p.max_entries < 1 ||
                p.max_entries > 100
            )
                itemsFail("invalid_request");
            var context = await ports.host.captureContext(),
                snapshot = await ports.host.store.snapshot(),
                offset = 0;
            current(runtime, deadline, admission);
            if (!context.current() || !snapshot.current())
                itemsFail("context_changed");
            if (p.cursor !== null) {
                if (
                    typeof p.cursor !== "string" ||
                    !/^[A-Za-z0-9_-]{1,512}$/.test(p.cursor)
                )
                    itemsFail("invalid_cursor");
                var decoded: any;
                try {
                    var text = p.cursor.replace(/-/g, "+").replace(/_/g, "/");
                    while (text.length % 4) text += "=";
                    decoded = parseFavoritesDocumentJson(
                        ports.base64Decode(text)
                    );
                } catch (_) {
                    itemsFail("invalid_cursor");
                }
                if (
                    !Array.isArray(decoded) ||
                    decoded.length !== 3 ||
                    !ITEM_HASH.test(decoded[0]) ||
                    !ITEM_HASH.test(decoded[1]) ||
                    typeof decoded[2] !== "number" ||
                    Math.floor(decoded[2]) !== decoded[2] ||
                    decoded[2] < 1 ||
                    decoded[2] > snapshot.entries.length ||
                    cursor(decoded[0], decoded[1], decoded[2]) !== p.cursor
                )
                    itemsFail("invalid_cursor");
                if (decoded[0] !== snapshot.revision)
                    itemsFail("revision_conflict");
                if (decoded[1] !== context.revision)
                    itemsFail("context_changed");
                offset = decoded[2];
            }
            var response: any = Object.assign(base, {
                context_revision: context.revision,
                cursor: p.cursor,
                entries: [],
                next_cursor: null,
                page_offset: offset,
                revision: snapshot.revision,
                total: snapshot.entries.length,
                unresolved_legacy_count: snapshot.unresolvedLegacy.length,
            });
            for (
                var index = offset;
                index < snapshot.entries.length &&
                response.entries.length < p.max_entries;
                index++
            ) {
                var row = snapshot.entries[index],
                    entry = ports.codec.normalize({
                        locator: row.locator,
                        origin: row.origin,
                        title: row.title,
                    });
                if (!entry || !ITEM_UUID.test(row.id))
                    itemsFail("storage_unavailable");
                response.entries.push({ entry: entry, id: row.id });
                response.next_cursor =
                    index + 1 < snapshot.entries.length
                        ? cursor(snapshot.revision, context.revision, index + 1)
                        : null;
                if (utf8Encode(JSON.stringify(response)).length > 65536) {
                    response.entries.pop();
                    if (!response.entries.length) itemsFail("limits_exceeded");
                    response.next_cursor = cursor(
                        snapshot.revision,
                        context.revision,
                        index
                    );
                    break;
                }
            }
            current(runtime, deadline, admission);
            if (!snapshot.current()) itemsFail("revision_conflict");
            if (!context.current()) itemsFail("context_changed");
            return response;
        } catch (error: any) {
            var code = error && (error.code || error.message);
            return Object.assign(base, {
                error:
                    ITEM_ERRORS.indexOf(code) >= 0
                        ? code
                        : "storage_unavailable",
            });
        }
    }
    return {
        cancel: function () {
            cancelled = true;
            if (play) play.cancel();
        },
        execute: execute,
    };
}

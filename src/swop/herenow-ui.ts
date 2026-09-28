import {
    HERENOW_SWOP_TTL,
    hereNowBase64,
    hereNowCryptoAvailable,
    hereNowPairLink,
    hereNowRandom,
    hereNowReceiver,
    hereNowSeal,
    hereNowStore,
    hereNowSwopConfig,
    hereNowValidValue,
} from "./herenow";

var hereNowActiveClose: (() => void) | null = null;

/** Uses the same editvar/showEditKey continuation as the existing ♥ input. */
export function openHereNowSwop(
    w: any,
    translate: (value: string) => string,
    qr: (value: string, size: number) => string
): void {
    if (hereNowActiveClose) hereNowActiveClose();
    var config = hereNowSwopConfig(w);
    if (!config) throw new Error("configuration");
    if (!hereNowCryptoAvailable(w)) {
        w.alert(
            translate(
                "Secure remote input is unavailable on this device. Use the on-screen keyboard."
            )
        );
        return;
    }
    var draft = typeof w.editvar === "string" ? w.editvar : "";
    if (!hereNowValidValue(draft)) {
        w.alert(translate("Text is too long for remote input."));
        return;
    }
    var caption =
        typeof w.editCaption === "string"
            ? w.editCaption.slice(0, 120)
            : translate("Enter value");
    var jq = w.jQuery || w.$;
    var previous = w.editKey;
    var closed = false;
    var recordId = "";
    var timer: any = null;
    var timeout: any = null;
    var receiver: any = null;
    var store = hereNowStore(w, config.collection);
    var started = Date.now();
    var monotonic =
        w.performance && typeof w.performance.now === "function"
            ? w.performance.now()
            : null;
    var pair = {
        deadline: started + HERENOW_SWOP_TTL,
        origin: w.location.origin,
        recordId: "",
        secret: hereNowRandom(w, 32),
        sid: hereNowBase64(w, hereNowRandom(w, 16)),
    };
    function expired(): boolean {
        return (
            Date.now() >= pair.deadline ||
            (monotonic !== null &&
                w.performance.now() - monotonic >= HERENOW_SWOP_TTL)
        );
    }
    function message(value: string): void {
        jq("#listEdit")
            .empty()
            .append(
                jq("<div>")
                    .css({ padding: "1em", "text-align": "center" })
                    .text(value)
            )
            .show();
    }
    function cleanup(): void {
        if (closed) return;
        closed = true;
        if (timer) w.clearTimeout(timer);
        if (timeout) w.clearTimeout(timeout);
        if (receiver) receiver.cancel();
        if (w.editKey === handler) w.editKey = previous;
        if (hereNowActiveClose === cleanup) hereNowActiveClose = null;
        jq("#listEdit").hide().empty();
        for (var i = 0; i < pair.secret.length; i++) pair.secret[i] = 0;
        if (recordId) store.remove(recordId).catch(function () {});
    }
    function resume(): void {
        if (typeof w.showEditKey === "function")
            w.showEditKey(null, undefined, true);
        else if (typeof w.showEditKey1 === "function")
            w.showEditKey1(null, undefined, true);
    }
    function handler(code: number): boolean {
        if (code === w.keys.RETURN || code === w.keys.EXIT) {
            cleanup();
            resume();
        }
        return true;
    }
    function fail(value: string): void {
        cleanup();
        resume();
        w.alert(value);
    }
    function schedule(delay: number): void {
        if (!closed) timer = w.setTimeout(poll, delay);
    }
    function poll(): void {
        if (closed) return;
        if (expired()) {
            fail(
                translate(
                    "Remote input expired. Open a new session to try again."
                )
            );
            return;
        }
        store
            .get(recordId)
            .then(function (data: any) {
                if (closed) return;
                if (!data.reply) {
                    schedule(5000);
                    return;
                }
                receiver.receive(data.reply).then(function (result: string) {
                    if (result === "accepted") return;
                    if (result === "expired")
                        fail(
                            translate(
                                "Remote input expired. Open a new session to try again."
                            )
                        );
                    else schedule(5000);
                });
            })
            .catch(function (error: any) {
                if (closed) return;
                if (error.message === "gone")
                    fail(
                        translate(
                            "Remote input session is unavailable. Open a new session to try again."
                        )
                    );
                else schedule(error.message === "rate_limit" ? 15000 : 7000);
            });
    }
    hereNowActiveClose = cleanup;
    w.editKey = handler;
    message(translate("Preparing secure remote input..."));
    timeout = w.setTimeout(function () {
        fail(
            translate("Remote input expired. Open a new session to try again.")
        );
    }, HERENOW_SWOP_TTL);
    store
        .create()
        .then(async function (id: string) {
            recordId = id;
            if (closed) {
                await store.remove(id).catch(function () {});
                return;
            }
            pair.recordId = id;
            var offer = await hereNowSeal(w, pair, "offer", {
                caption: caption,
                draft: draft,
            });
            if (closed) return;
            await store.patch(id, { offer: offer });
            if (closed) return;
            receiver = hereNowReceiver(w, pair, expired, function (value) {
                // Consume locally before callbacks. Delete is cleanup, never authorization.
                cleanup();
                w.editvar = value;
                resume();
            });
            var link = hereNowPairLink(w, pair, config!.entryUrl);
            var panel = jq("<div>").css({
                padding: "0.5em",
                "text-align": "center",
            });
            panel.append(
                jq("<div>").text(
                    translate(
                        "Scan this QR code with your phone to enter text."
                    )
                )
            );
            try {
                panel.append(jq("<div>").html(qr(link, 240)));
            } catch (_) {}
            panel.append(
                jq("<div>").text(
                    translate(
                        "Or open this complete private link on another device:"
                    )
                )
            );
            panel.append(
                jq("<div>")
                    .css({ "font-size": "0.6em", "word-break": "break-all" })
                    .text(link)
            );
            panel.append(
                jq("<div>").text(
                    translate("Valid for 10 minutes. Back closes this session.")
                )
            );
            jq("#listEdit").empty().append(panel).show();
            schedule(5000);
        })
        .catch(function () {
            if (!closed)
                fail(
                    translate(
                        "Secure remote input could not start. Please try again or use the on-screen keyboard."
                    )
                );
        });
}

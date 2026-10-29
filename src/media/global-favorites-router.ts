/** Exact, cancellable handoff. Private targets/locators are never inferred from labels. */
export function createGlobalFavoritesRouter(ports: any): any {
    var running: any = null,
        playing: any = null;
    function sameOrigin(a: any, b: any): boolean {
        return (
            !!a &&
            !!b &&
            a.provider === b.provider &&
            a.profile === b.profile &&
            a.subprofile === b.subprofile &&
            a.sourceAlias === b.sourceAlias
        );
    }
    function portable(row: any): any {
        return { title: row.title, origin: row.origin, locator: row.locator };
    }
    function cancel(): void {
        if (running) running.finish("cancelled");
    }
    function select(id: string, externalCurrent?: () => boolean): any {
        cancel();
        playing = null;
        var active = true,
            session: any = null,
            target: any = null;
        var timer: any = null,
            releaseDone = false,
            played = false;
        var resolveResult: (value: any) => void;
        var result = new Promise(function (resolve) {
            resolveResult = resolve;
        });
        var ticket: any = { finish: finish };
        running = ticket;
        var snapshot: any, record: any, canonical: any, identity: string;
        var expires = ports.now() + 30000;
        function publish(phase: string, reason?: string): void {
            try {
                ports.changed({ id: id, phase: phase, reason: reason });
            } catch (_) {}
        }
        function release(): void {
            if (releaseDone || !session) return;
            releaseDone = true;
            // Releases only this preparation owner, never a replacement player.
            try {
                session.release();
            } catch (_) {}
        }
        function finish(reason: string): void {
            if (!active) return;
            active = false;
            if (timer !== null) ports.clearTimer(timer);
            if (running === ticket) running = null;
            if (!played) release();
            publish(reason === "ok" ? "playing" : "unresolved", reason);
            resolveResult({ id: id, status: reason });
        }
        function guard(skipSession = false): boolean {
            if (!active || running !== ticket) return false;
            if (ports.now() >= expires) {
                finish("timeout");
                return false;
            }
            if (
                (externalCurrent && !externalCurrent()) ||
                !ports.current() ||
                !ports.allowed(record)
            ) {
                finish("blocked");
                return false;
            }
            if (!snapshot.current()) {
                finish("changed");
                return false;
            }
            if (target && !target.current()) {
                finish("changed");
                return false;
            }
            if (
                !skipSession &&
                session &&
                (!session.current() ||
                    !sameOrigin(session.origin, canonical.origin))
            ) {
                finish("changed");
                return false;
            }
            return active;
        }
        timer = ports.setTimer(function () {
            finish("timeout");
        }, 30000);
        publish("loading");
        Promise.resolve()
            .then(async function () {
                snapshot = await ports.snapshot();
                if (!active) return;
                var matches = snapshot.entries.filter(function (row: any) {
                    return row.id === id;
                });
                if (matches.length !== 1) {
                    finish("missing");
                    return;
                }
                record = matches[0];
                canonical = ports.codec.normalize(portable(record));
                if (!canonical) {
                    finish("unsupported");
                    return;
                }
                identity = ports.codec.identity(canonical);
                if (!guard()) return;
                var targets = await ports.targets(
                    canonical.origin,
                    guard,
                    canonical.locator
                );
                if (!guard()) return;
                var exact = targets.filter(function (candidate: any) {
                    return (
                        candidate &&
                        sameOrigin(candidate.origin, canonical.origin)
                    );
                });
                if (exact.length !== 1) {
                    finish(exact.length ? "ambiguous" : "missing");
                    return;
                }
                target = exact[0];
                if (!guard()) return;
                session = await ports.activate(target, function () {
                    return guard(true);
                });
                if (!active) {
                    release();
                    return;
                }
                if (!session || !guard()) {
                    finish("unavailable");
                    return;
                }
                var resolved = await session.resolve(
                    canonical.locator,
                    function () {
                        return guard(true);
                    }
                );
                if (!guard()) return;
                if (
                    !resolved ||
                    !resolved.available ||
                    ports.codec.identity({
                        title: canonical.title,
                        origin: session.origin,
                        locator: resolved.locator,
                    }) !== identity
                ) {
                    finish("unavailable");
                    return;
                }
                if (!guard()) return;
                var accepted = await session.play(resolved, function () {
                    return guard(true);
                });
                if (!active || !guard()) return;
                if (accepted !== true) {
                    finish("unavailable");
                    return;
                }
                played = true;
                var playback = session.capturePlayback
                    ? session.capturePlayback()
                    : null;
                session.complete();
                playing =
                    playback && playback.current()
                        ? {
                              id: id,
                              prepareEnded: playback.prepareEnded,
                              value: JSON.parse(JSON.stringify(canonical)),
                              current: playback.current,
                              matches: playback.matches,
                          }
                        : null;
                finish("ok");
            })
            .catch(function () {
                finish("unavailable");
            });
        return {
            result: result,
            cancel: function () {
                finish("cancelled");
            },
        };
    }
    return {
        captureCurrent: function (payload?: any) {
            if (!playing || !playing.current()) {
                playing = null;
                return null;
            }
            if (
                payload !== undefined &&
                (!playing.matches || !playing.matches(payload))
            )
                return null;
            return {
                id: playing.id,
                value: JSON.parse(JSON.stringify(playing.value)),
                current: playing.current,
                bound: true,
            };
        },
        captureEnding: function (generation: number) {
            var ended = playing;
            if (!ended || !ended.prepareEnded) return null;
            var postStopCurrent = ended.prepareEnded(generation);
            if (!postStopCurrent) return null;
            playing = null;
            return {
                id: ended.id,
                value: JSON.parse(JSON.stringify(ended.value)),
                current: postStopCurrent,
            };
        },
        select: select,
        cancel: cancel,
        busy: function () {
            return !!running;
        },
    };
}

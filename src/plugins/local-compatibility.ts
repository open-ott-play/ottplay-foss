/** Loaded only when this local-media feature is used. */
function createLocalCompatibility(w: any, p: any): any {
    var compatibilityLeases: any[] = [];
    var compatibilityPending: any[] = [];
    function playbackItem(url: string): any {
        var lease = compatibilityLeases.filter(function (entry) {
            return entry.url === url;
        })[0];
        return (
            p.last &&
            p.last.items.filter(function (item: any) {
                return item.url === (lease ? lease.sourceUrl : url);
            })[0]
        );
    }
    function compatibilityPlayback(url: string): boolean {
        return playbackItem(url)?.playback?.mode === "compatibility";
    }
    function cancelLease(entry: any): void {
        if (!entry.active) return;
        entry.active = false;
        var controller = w.AbortController ? new w.AbortController() : null;
        var timer = setTimeout(function () {
            if (controller) controller.abort();
        }, 5000);
        function finished(): void {
            clearTimeout(timer);
        }
        try {
            Promise.resolve(
                w.fetch(entry.cancelUrl, {
                    headers: { "X-OTT-Playback-Lease": entry.lease },
                    method: "POST",
                    ...(controller ? { signal: controller.signal } : {}),
                })
            ).then(finished, finished);
        } catch (_) {
            finished();
        }
    }
    function cancelPlayback(url?: string): void {
        compatibilityPending.slice().forEach(function (pending) {
            if (!url || pending.sourceUrl === url) pending.cancel();
        });
        compatibilityLeases.forEach(function (entry) {
            if (!url || entry.url === url || entry.sourceUrl === url)
                cancelLease(entry);
        });
    }
    function preparePlayback(url: string, current?: () => boolean): any {
        if (w.__ottStandby?.blocked() || (current && !current()))
            return Promise.reject(
                new Error("Local playback request cancelled")
            );
        var item = playbackItem(url);
        if (
            item?.playback?.mode === "unsupported" ||
            (item?.playback?.mode === "compatibility" &&
                p.last?.compatibility?.available === false)
        )
            return Promise.reject(
                new Error(
                    "AVI/MKV compatibility is unavailable on this library"
                )
            );
        if (!item || item.playback?.mode !== "compatibility")
            return Promise.resolve(url);
        var existing = compatibilityLeases.filter(function (entry) {
            return entry.url === url && entry.active && entry.verified;
        })[0];
        if (existing) return Promise.resolve(url);
        if (compatibilityPending.length >= 2)
            return Promise.reject(
                new Error("Too many local playback requests")
            );
        var capturedRevision = p.catalogRevision,
            identity = p.libraryIdentity();
        var controller = w.AbortController ? new w.AbortController() : null;
        var stopped = false,
            settled = false,
            timer: any,
            rejectRequest: any;
        var sourceUrl = item.url;
        var pending: any = {
            cancel: function () {
                if (stopped) return;
                stopped = true;
                if (controller) controller.abort();
                finish(new Error("Local playback request cancelled"));
            },
            sourceUrl: sourceUrl,
        };
        function admitted(): boolean {
            return (
                !stopped &&
                (!current || current()) &&
                !w.__ottStandby?.blocked() &&
                capturedRevision === p.catalogRevision &&
                identity === p.libraryIdentity() &&
                playbackItem(sourceUrl)?.id === item.id
            );
        }
        function finish(error?: any): void {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            compatibilityPending = compatibilityPending.filter(
                function (entry) {
                    return entry !== pending;
                }
            );
            if (error) rejectRequest(error);
        }
        var result: any = new Promise<string>(function (resolve, reject) {
            rejectRequest = reject;
            timer = setTimeout(function () {
                pending.cancel();
            }, 35000);
            compatibilityPending.push(pending);
            try {
                if (!admitted())
                    throw new Error("Local playback request cancelled");
                var prepare = new URL(item.playback.prepareUrl, sourceUrl);
                var original = new URL(sourceUrl);
                if (
                    !/^https?:$/.test(prepare.protocol) ||
                    prepare.origin !== original.origin ||
                    !/^[a-f0-9]{32}$/.test(item.id) ||
                    !prepare.pathname.endsWith(
                        "/compat/" + item.id + "/prepare"
                    ) ||
                    item.playback.mime !== "application/vnd.apple.mpegurl" ||
                    prepare.search ||
                    prepare.hash
                )
                    throw new Error("Invalid local compatibility endpoint");
                var cancel = new URL("cancel", prepare);
                Promise.resolve(
                    w.fetch(prepare.href, {
                        method: "POST",
                        ...(controller ? { signal: controller.signal } : {}),
                    })
                )
                    .then(function (response: any) {
                        if (!response.ok)
                            throw new Error(
                                "Local compatibility playback is unavailable"
                            );
                        return response.json();
                    })
                    .then(function (value: any) {
                        var leaseUrl = new URL(value.url, prepare);
                        if (
                            !/^[a-f0-9]{32}$/.test(value.lease || "") ||
                            leaseUrl.origin !== prepare.origin ||
                            leaseUrl.search ||
                            leaseUrl.hash ||
                            leaseUrl.pathname !==
                                prepare.pathname.replace(
                                    /prepare$/,
                                    value.lease + "/index.m3u8"
                                )
                        )
                            throw new Error(
                                "Invalid local compatibility lease"
                            );
                        var entry = {
                            active: true,
                            cancelUrl: cancel.href,
                            duration: value.duration,
                            id: item.id,
                            lease: value.lease,
                            sourceUrl: sourceUrl,
                            url: leaseUrl.href,
                            verified: false,
                        };
                        compatibilityLeases.push(entry);
                        if (compatibilityLeases.length > 32) {
                            var expired = -1;
                            for (
                                var n = 0;
                                n < compatibilityLeases.length - 1;
                                n++
                            )
                                if (
                                    !compatibilityLeases[n].active &&
                                    compatibilityLeases[n].url !==
                                        w.__ottCoreCompatibilityUrl &&
                                    compatibilityLeases[n].url !==
                                        w.__ottCorePipCompatibilityUrl
                                ) {
                                    expired = n;
                                    break;
                                }
                            if (expired >= 0)
                                compatibilityLeases.splice(expired, 1);
                            else {
                                compatibilityLeases.pop();
                                cancelLease(entry);
                                throw new Error(
                                    "Too many local playback leases"
                                );
                            }
                        }
                        if (!admitted() || settled) {
                            cancelLease(entry);
                            finish(
                                new Error("Local playback request cancelled")
                            );
                            return;
                        }
                        if (
                            (value.mode !== "remux" &&
                                value.mode !== "transcode") ||
                            value.finite !== true ||
                            value.timeline !== "vod" ||
                            value.timeOrigin !== 0 ||
                            typeof value.duration !== "number" ||
                            !isFinite(value.duration) ||
                            value.duration <= 0 ||
                            value.mime !== "application/vnd.apple.mpegurl"
                        ) {
                            cancelLease(entry);
                            throw new Error(
                                "Compatibility playback must have a finite source timeline"
                            );
                        }
                        entry.verified = true;
                        finish();
                        resolve(entry.url);
                    })
                    .catch(function () {
                        finish(
                            new Error(
                                "Local compatibility playback could not be prepared"
                            )
                        );
                    });
            } catch (_) {
                finish(
                    new Error(
                        "Local compatibility playback could not be prepared"
                    )
                );
            }
        });
        result.cancel = pending.cancel;
        return result;
    }
    return {
        cancelPlayback,
        compatibilityPlayback,
        isPlaybackUrl: function (url: string) {
            return compatibilityLeases.some(function (entry: any) {
                return (
                    entry.verified &&
                    entry.url === url &&
                    playbackItem(url)?.id === entry.id
                );
            });
        },
        playbackItem,
        playbackSourceUrl: function (url: string) {
            return (
                compatibilityLeases.filter(function (entry: any) {
                    return entry.url === url;
                })[0]?.sourceUrl || url
            );
        },
        preparePlayback,
    };
}
(window as any).__ottLocalCompatibilityFactory = createLocalCompatibility;

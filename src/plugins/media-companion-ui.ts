/** Companion controls use the player list, editor and playback metadata path. */
var mediaCompanionManualSerial = 0;
function showMediaCompanionUi(w: any, client: any, editText: any): void {
    function locked(): boolean {
        return (
            !!(w.__ottKiosk && w.__ottKiosk.enabled()) ||
            !!(
                w.__ottParental &&
                (w.__ottParental.needs("settings") ||
                    w.__ottParental.needs("providers"))
            )
        );
    }
    if (locked()) return;
    var generation = 0;
    var rows: any[] = [];
    var renderItem: any;
    function current(): boolean {
        return (
            !locked() &&
            w.getListItem === renderItem &&
            w.isListVisible !== false
        );
    }
    function text(value: any): string {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    function close(): void {
        generation++;
        if (w.optionsList) w.optionsList(w.settingsMediaCompanion);
        else w.closeList();
    }
    function play(source: string, title: string): void {
        if (!current() || !client.isSource(source)) return;
        var media = w.__ottMedia;
        var playback = w.__ottClassicPlayback;
        if (!media || !media.beginSource || !playback || !playback.snapshot) {
            render("Media playback is unavailable.");
            return;
        }
        var token = ++generation;
        var sourceId = "companion:manual:" + ++mediaCompanionManualSerial;
        var values: any = Object.create(null);
        var item = {
            __ottMediaRef: { itemId: "manual", sourceId: sourceId },
            itemId: "manual",
            stream_url: source,
            title: title,
        };
        // This transient source must never use the selected provider's journal
        // or resolver (a Plex resolver intentionally removes direct URLs).
        var context: any = {
            catalog: function () {
                return [item];
            },
            client: {
                cancel: function () {},
                load: function (_target: any, done: any) {
                    if (!media.usesSource(context)) return;
                    w.mediaRecords = [item];
                    w.mediaName = title;
                    done();
                },
                resolve: function (payload: any, done: any) {
                    done(payload);
                },
                stop: function () {},
            },
            read: function (key: string) {
                return values[key] || null;
            },
            readPersisted: function () {
                return null;
            },
            sourceId: sourceId,
            title: "Media companion",
            write: function (key: string, value: string) {
                values[key] = value;
            },
        };
        var handoff: any;
        try {
            var previous = playback.snapshot().generation;
            handoff = media.beginSource(context);
            w._playMedia(item);
            var state = playback.snapshot();
            if (
                token === generation &&
                media.usesSource(context) &&
                state.generation !== previous &&
                state.phase !== "stopped" &&
                state.target &&
                state.target.kind === "vod" &&
                state.target.sourceId === sourceId &&
                state.target.channelId === item.__ottMediaRef.itemId &&
                handoff.commit()
            ) {
                w.closeList();
                return;
            }
        } catch (_) {
            // Rejected admission restores the previous source and its runtime.
        }
        if (handoff) handoff.rollback();
        if (token === generation && current())
            render("Media playback could not start.");
    }
    function editor(
        caption: string,
        value: string,
        accept: (value: string) => void
    ): void {
        var token = ++generation;
        editText(
            caption,
            value,
            function (saved: string) {
                if (token !== generation || !current()) return;
                accept(String(saved || "").trim());
            },
            undefined,
            caption === "Companion endpoint"
        );
    }

    function pluginInput(id: string, title: string): void {
        editor(title, "", function (input) {
            var value: any;
            try {
                value = JSON.parse(input);
            } catch (_) {
                value =
                    id === "direct-url"
                        ? { title: title, url: input }
                        : { value: input };
            }
            render();
            if (!value || typeof value !== "object" || Array.isArray(value)) {
                render("Enter a JSON object or a source URL.");
                return;
            }
            play(
                "ottplay-plugin:" +
                    id +
                    "?json=1&input=" +
                    encodeURIComponent(JSON.stringify(value)),
                title
            );
        });
    }
    function plugins(): void {
        var token = ++generation;
        render("Loading plugins…");
        client.plugins().then(
            function (value: any) {
                if (token !== generation || !current()) return;
                var plugins =
                    value && value.schema === 1 && Array.isArray(value.plugins)
                        ? value.plugins
                        : [];
                var entries = plugins
                    .filter(function (p: any) {
                        return p && /^[A-Za-z0-9_-]{1,64}$/.test(p.id);
                    })
                    .map(function (p: any) {
                        return {
                            action: function () {
                                pluginInput(p.id, p.name || p.id);
                            },
                            description: "Open a packaged source resolver.",
                            name: p.name || p.id,
                        };
                    });
                render(
                    entries.length ? "" : "No packaged plugins are available.",
                    entries
                );
            },
            function () {
                if (token === generation && current())
                    render(
                        "Media companion unavailable. Check the configured endpoint."
                    );
            }
        );
    }
    function render(message?: string, entries?: any[]): void {
        if (locked()) return;
        rows = entries || [
            {
                action: function () {
                    editor(
                        "Companion endpoint",
                        w.settings.companionEndpoint || "",
                        function (value) {
                            try {
                                if (value) value = client.endpointValue(value);
                            } catch (_) {
                                render(
                                    "Use a complete companion URL including its access token."
                                );
                                return;
                            }
                            if (
                                w.saveSettings({ companionEndpoint: value }) ===
                                false
                            ) {
                                render("Settings could not be saved.");
                                return;
                            }
                            render("Settings saved");
                        }
                    );
                },
                description:
                    "Leave empty to use the native desktop service. Other devices require a configured service URL.",
                name: "Companion endpoint…",
            },
            {
                action: function () {
                    editor("Open source", "", function (value) {
                        render();
                        if (client.isSource(value))
                            play(value, "Companion media");
                        else render("Unsupported source URL");
                    });
                },
                description:
                    "Enter a magnet link, a torrent file URL or a packaged plugin reference. Media is read by the companion service.",
                name: "Open torrent or plugin source…",
            },
            {
                action: plugins,
                description:
                    "Resolve sources with installed, isolated plugins.",
                name: "Packaged plugins",
            },
        ];
        if (!entries)
            client.choices().forEach(function (choice: any) {
                rows.push({
                    action: function () {
                        play(choice.source, choice.name);
                    },
                    description:
                        "Play this file or stream using a new session.",
                    name: choice.name,
                });
            });
        rows.push({
            action: close,
            description: "Return to player settings.",
            name: "Close",
        });
        w.listArray = rows;
        w.listDataArray = rows;
        w.selIndex = 0;
        renderItem = function (item: any) {
            return "&nbsp;&nbsp;" + text(item.name);
        };
        w.getListItem = renderItem;
        w.detailListAction = function () {
            if (w.listDetail)
                w.listDetail.textContent =
                    message ||
                    (rows[w.selIndex] && rows[w.selIndex].description) ||
                    "";
        };
        w.listKeyHandler = function (key: number) {
            if (!current()) return false;
            if (key === w.keys.RETURN || key === w.keys.EXIT) {
                close();
                return true;
            }
            if (key === w.keys.ENTER) {
                if (rows[w.selIndex]) rows[w.selIndex].action();
                return true;
            }
            return false;
        };
        if (w.listCaption) w.listCaption.textContent = "Media companion";
        if (w.listFooter)
            w.listFooter.innerHTML =
                w.renderButtonHint(w.keys.RETURN, w.strRETURN, "Close") +
                w.renderButtonHint(w.keys.ENTER, w.strENTER, "Open");
        w.showPage();
        var owner =
            w.__ottClassicScreenPort && w.__ottClassicScreenPort.listOwner();
        if (owner && owner.model) owner.model.localOnlyInput = true;
    }
    render();
}
(window as any).__ottMediaCompanionUi = showMediaCompanionUi;

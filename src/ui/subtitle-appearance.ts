/** Optional settings UI and cue styling; default playback never executes this asset. */
(function (host: any): void {
    var keys = [
        "subtitleFontFamily",
        "subtitleFontSize",
        "subtitleTextColor",
        "subtitleOutline",
        "subtitleBackground",
    ];
    var fonts = [
        "",
        "Arial,Helvetica,sans-serif",
        "Georgia,serif",
        "Courier New,monospace",
    ];
    var sizes = [0, 0.75, 1, 1.25, 1.5, 2];
    var colors = ["", "#ffffff", "#ffff00", "#000000", "#00ffff", "#00ff00"];
    var style: HTMLStyleElement | null = null;
    var watching = false;
    var observer: any = null;
    var observed: HTMLVideoElement[] = [];
    var fontUnits = /(^|[^a-z\d_-])(-?\d*\.?\d+)(px|vh|vw|pt)\b/gi;
    function scaleFonts(): void {
        var doc = host.document;
        if (!doc || !doc.styleSheets || !host.location) return;
        var value = (host.settings || {}).uiFontScale;
        var scale =
            typeof value === "number" &&
            value >= 50 &&
            value <= 200 &&
            value % 1 === 0
                ? value / 100
                : 1;
        function visit(rules: any): void {
            for (var i = 0; rules && i < rules.length; i++) {
                var rule = rules[i],
                    css = rule.style;
                if (
                    css &&
                    css.fontSize &&
                    css.fontSize.search(fontUnits) >= 0 &&
                    !/::cue|shaka-text|vjs-text-track/.test(
                        rule.selectorText || ""
                    )
                ) {
                    var original =
                        css.__ottFontBase ||
                        (css.__ottFontBase = [
                            css.fontSize,
                            css.getPropertyPriority("font-size"),
                        ]);
                    css.setProperty(
                        "font-size",
                        scale === 1
                            ? original[0]
                            : original[0].replace(
                                  fontUnits,
                                  function (
                                      _match: string,
                                      prefix: string,
                                      number: string,
                                      unit: string
                                  ) {
                                      return (
                                          prefix + Number(number) * scale + unit
                                      );
                                  }
                              ),
                        original[1]
                    );
                }
                visit(rule.cssRules);
            }
        }
        for (var i = 0; i < doc.styleSheets.length; i++) {
            var sheet = doc.styleSheets[i];
            try {
                var url = new URL(sheet.href, host.location.href);
                if (
                    (!sheet.href &&
                        sheet.ownerNode &&
                        /^(ott-interface|ott-tauri-loading-logs)-style$/.test(
                            sheet.ownerNode.id
                        )) ||
                    (sheet.href &&
                        url.origin === host.location.origin &&
                        /\/styles\/player\.css$/.test(url.pathname))
                )
                    visit(sheet.cssRules);
            } catch (_) {}
        }
    }
    function index(values: any, key: string, max: number): number {
        var n = values && values[key];
        return typeof n === "number" &&
            isFinite(n) &&
            Math.floor(n) === n &&
            n >= 0 &&
            n <= max
            ? n
            : 0;
    }
    function declarations(video: HTMLVideoElement, values?: any): string {
        values = values || host.settings || {};
        var rules: string[] = [];
        var family = index(values, keys[0], 3),
            size = index(values, keys[1], 5),
            color = index(values, keys[2], 5),
            outline = index(values, keys[3], 4),
            background = index(values, keys[4], 5);
        if (family) rules.push("font-family:" + fonts[family]);
        if (size) {
            var rect = video.getBoundingClientRect();
            var height = rect.height;
            var fit = host.getComputedStyle
                ? host.getComputedStyle(video).objectFit
                : "contain";
            if (
                fit !== "cover" &&
                video.videoWidth > 0 &&
                video.videoHeight > 0
            )
                height = Math.min(
                    height,
                    (rect.width * video.videoHeight) / video.videoWidth
                );
            if (height > 0)
                rules.push(
                    "font-size:" +
                        Math.max(
                            1,
                            Math.round(height * 0.04 * sizes[size] * 100) / 100
                        ) +
                        "px"
                );
        }
        if (color) rules.push("color:" + colors[color]);
        if (outline) {
            var width = outline - 1;
            var shadows: string[] = [];
            if (width)
                for (var x = -1; x <= 1; x++)
                    for (var y = -1; y <= 1; y++)
                        if (x || y)
                            shadows.push(
                                x * width + "px " + y * width + "px 0 #000"
                            );
            rules.push(
                "text-shadow:" + (shadows.length ? shadows.join(",") : "none")
            );
        }
        if (background)
            rules.push(
                "background-color:rgba(0,0,0," + (background - 1) / 4 + ")"
            );
        return rules
            .map(function (rule) {
                return rule + " !important;";
            })
            .join("");
    }
    function apply(): void {
        scaleFonts();
        var doc = host.document;
        if (!doc || !doc.querySelectorAll || !doc.createElement) return;
        var videos = doc.querySelectorAll("video"),
            css: string[] = [];
        observed = observed.filter(function (old) {
            for (var i = 0; i < videos.length; i++)
                if (videos[i] === old) return true;
            if (observer) observer.unobserve(old);
            return false;
        });
        for (var i = 0; i < videos.length; i++) {
            var video = videos[i],
                rules = declarations(video);
            video.setAttribute("data-ott-subtitle-style", String(i));
            var selector = 'video[data-ott-subtitle-style="' + i + '"]';
            if (rules) css.push(selector + "::cue{" + rules + "}");
            var wrapper = video.closest
                ? video.closest(".video-js")
                : video.parentElement;
            if (wrapper && /(?:^|\s)video-js(?:\s|$)/.test(wrapper.className)) {
                wrapper.setAttribute("data-ott-subtitle-wrapper", String(i));
                if (rules)
                    css.push(
                        '[data-ott-subtitle-wrapper="' +
                            i +
                            '"] .vjs-text-track-display > div > div{' +
                            rules +
                            "}"
                    );
            }
            if (observer && observed.indexOf(video) < 0) {
                observed.push(video);
                observer.observe(video);
            }
        }
        if (!style && css.length) {
            var created: HTMLStyleElement = doc.createElement("style");
            created.id = "ott-subtitle-appearance";
            (doc.head || doc.body).appendChild(created);
            style = created;
        }
        if (style && style.textContent !== css.join("\n"))
            style.textContent = css.join("\n");
        if (!watching && host.addEventListener) {
            watching = true;
            host.addEventListener("resize", apply);
            doc.addEventListener("loadedmetadata", apply, true);
            if (typeof host.ResizeObserver === "function")
                observer = new host.ResizeObserver(apply);
            if (observer) apply();
        }
    }
    function open(): void {
        var page = host.__ottAppearanceHost.page(
            host,
            "settingsSubtitles",
            "Subtitle appearance",
            true,
            false
        );
        var label = page.label,
            defaults = [label("Player default")];
        var rows = [
            page.choice(
                label("Font type"),
                keys[0],
                defaults.concat(["Arial", "Georgia", "Courier New"])
            ),
            page.choice(
                label("Font size"),
                keys[1],
                defaults.concat(["75%", "100%", "125%", "150%", "200%"])
            ),
            page.choice(
                label("Text color"),
                keys[2],
                defaults.concat([
                    "#FFFFFF",
                    "#FFFF00",
                    "#000000",
                    "#00FFFF",
                    "#00FF00",
                ])
            ),
            page.choice(
                label("Outline thickness"),
                keys[3],
                defaults.concat([label("Off"), "1 px", "2 px", "3 px"])
            ),
            page.choice(
                label("Background opacity"),
                keys[4],
                defaults.concat(["0%", "25%", "50%", "75%", "100%"])
            ),
            {
                cur: label("select"),
                name: label("Reset to default"),
                val: 0,
                values: function () {
                    rows.forEach(function (row: any) {
                        if (row.settingId) row.val = 0;
                    });
                    host.showPage();
                },
            },
        ];
        host.__ottAppearanceHost.list(host, page.rows(rows));
        page.attach();
    }
    function interfaceSettings(): void {
        var w = window as any;
        var showPlayerChoice =
            w.ott_device !== "lg/webos" &&
            !(w.ott_device === "pc2" && typeof w.videojs === "function");
        /**
         * Persist all interface settings and re-apply them.
         * Conditionally saves PiP, OSD opacity, volume step, and editor
         * settings based on capability. Calls all apply-functions after saving.
         */
        var page = host.__ottAppearanceHost.page(
            w,
            "settingsInterface",
            "Interface settings",
            true,
            false
        );
        var choice = page.choice;
        var label = page.label;

        var mediaLanguageCodes = Object.keys(
            host.__ottAppearanceHost.languages
        );
        var mediaLanguageLabels = mediaLanguageCodes.map(function (code) {
            return host.__ottAppearanceHost.languages[code];
        });
        var noyes = [label("no"), label("yes")];
        var fontScales: number[] = [];
        for (var scale = 50; scale <= 200; scale += 10) fontScales.push(scale);
        // Keep an exact value supplied by the remote settings API selectable.
        var currentScale = w.sUiFontScale;
        if (
            fontScales.indexOf(currentScale) < 0 &&
            currentScale >= 50 &&
            currentScale <= 200
        )
            fontScales.push(currentScale);
        fontScales.sort(function (a, b) {
            return a - b;
        });
        var tz = (w.arrTimezone || ["system", "0"]).slice();
        tz[0] = w._(tz[0]) || tz[0];
        host.__ottAppearanceHost.list(
            w,
            page.rows([
                choice(w._("Interface theme"), "interfaceTheme", [
                    w._("Classic"),
                    "PLi-HD",
                    "Studio 2026",
                ]),
                {
                    name: label("Preferred audio language"),
                    settingId: "preferredAudioLanguage",
                    settingValues: [""].concat(mediaLanguageCodes),
                    values: [label("Player default")].concat(
                        mediaLanguageLabels
                    ),
                },
                {
                    name: label("Preferred subtitle language"),
                    settingId: "preferredSubtitleLanguage",
                    settingValues: ["", "off"].concat(mediaLanguageCodes),
                    values: [label("Player default"), label("Off")].concat(
                        mediaLanguageLabels
                    ),
                },
                {
                    cur: label("select"),
                    name: label("Subtitle appearance"),
                    val: 0,
                    values: host.settingsSubtitles,
                },
                choice(
                    label("Black screen while switching the channel"),
                    "stopPlay",
                    noyes
                ),
                choice(label("PiP window size"), "pipSize", [
                    label("small"),
                    label("medium"),
                    label("large"),
                ]),
                choice(label("PiP window position"), "pipPosition", [
                    label("top-right"),
                    label("bottom-right"),
                    label("left-bottom"),
                    label("top-left"),
                ]),
                choice(
                    label("Font type"),
                    "fontSize",
                    w.__ottNativeFontOptions || [
                        '<span style="font-family:Helvetica, Arial, sans-serif;">' +
                            label("system") +
                            "</span>",
                        '<span style="font-family:Roboto;">Roboto</span>',
                        '<span style="font-family:RobotoCondensed;">Roboto Condensed</span>',
                        '<span style="font-family:Caveat;">Caveat</span>',
                        '<span style="font-family:Liberation;">Liberation</span>',
                        '<span style="font-family:Gabriela;">Gabriela</span>',
                        '<span style="font-family:PTSansNarrow;">PTSansNarrow</span>',
                    ]
                ),
                choice(label("Timezone"), "timezone", tz),
                {
                    name: label("Font size") + ", %",
                    settingId: "uiFontScale",
                    settingValues: fontScales,
                    values: fontScales.map(function (value) {
                        return value + "%";
                    }),
                },
                choice(label("Sleep timer"), "sleepTimeout", [
                    label("off"),
                    label("30 minutes"),
                    label("1 hour"),
                    label("2 hours"),
                    label("3 hours"),
                ]),
                choice(label("Interface transparency"), "osdOpacity", [
                    "100%",
                    "90%",
                    "80%",
                    "70%",
                    "60%",
                    "50%",
                    "40%",
                    "30%",
                    "20%",
                    "10%",
                    "0%",
                ]),
                {
                    name: label("Volume step, %"),
                    settingId: "volumeStep",
                    settingOffset: 3,
                    values: [3, 4, 5, 6, 7, 8, 9, 10],
                },
                {
                    cur: label("select"),
                    name: w._("Color spectrum") + " (" + w._("Classic") + ")",
                    settingId: "highlightColor",
                    values: w.colorDialog,
                },
                {
                    cur: label("select"),
                    name:
                        w._("Background color of selected item") +
                        " (" +
                        w._("Classic") +
                        ")",
                    settingId: "highlightColorSel",
                    values: w.selColorDialog,
                },
                {
                    cur: label("select"),
                    name: w._("Background color") + " (" + w._("Classic") + ")",
                    settingId: "highlightColorB",
                    values: w.backColorDialog,
                },
                choice(label("Permanent clock on screen"), "permanentTime", [
                    label("no"),
                    label("yes"),
                    label("transparent"),
                ]),
                choice(
                    label("Graphical indication"),
                    "useGraphicalIndicators",
                    noyes
                ),
                choice(
                    label("Position shift -10 seconds after pause"),
                    "resumeWithTenSecondRewind",
                    noyes
                ),
                choice(
                    label("Remember previous channels"),
                    "prevCount",
                    [1, 5, 10, 15, 20]
                ),
                choice(label("History in Media Library"), "medCount", [
                    label("no"),
                    10,
                    20,
                    30,
                    40,
                    50,
                ]),
                choice(label("Editor"), "editor", [
                    label("built-in"),
                    label("native"),
                ]),
                choice(
                    label("Type of player for streaming"),
                    "players",
                    w.playerModeNames
                ),
                {
                    name: label("Maximum video height") + " (HLS/Shaka)",
                    settingId: "streamMaxHeight",
                    settingValues: [0, 360, 480, 720, 1080, 2160],
                    values: [
                        label("Automatic"),
                        "360p",
                        "480p",
                        "720p",
                        "1080p",
                        "2160p",
                    ],
                },
                {
                    name: label("Maximum stream bitrate") + " (HLS/Shaka)",
                    settingId: "streamMaxBitrate",
                    settingValues: [
                        0, 1000000, 2000000, 4000000, 8000000, 16000000,
                    ],
                    values: [
                        label("Automatic"),
                        "1 Mbps",
                        "2 Mbps",
                        "4 Mbps",
                        "8 Mbps",
                        "16 Mbps",
                    ],
                },
                choice(label("Buffer Size, s"), "bufSize", w.bufferSizes),
            ])
        );
        host.__ottAppearanceHost.list(
            w,
            w.listArray.filter(function (row: any): boolean {
                if (
                    row.settingId === "preferredAudioLanguage" ||
                    row.settingId === "preferredSubtitleLanguage"
                )
                    return (
                        !!w.__ottCoreTransport &&
                        w.stbPlay === w.__ottCoreTransport.play
                    );
                if (row.settingId === "players") {
                    if (Array.isArray(w.stbPlayers)) row.values = w.stbPlayers;
                    return showPlayerChoice;
                }
                if (row.settingId === "bufSize") {
                    if (w.stbBufferSizes) row.values = w.stbBufferSizes;
                    return typeof w.stbSetBuffer === "function";
                }
                if (row.settingId === "editor")
                    return typeof w.showEditKey2 === "function";
                if (row.settingId === "medCount")
                    return (
                        typeof w.getMediaArray === "function" ||
                        !!(w.__ottNasLibrary && w.__ottNasLibrary.available())
                    );
                if (row.settingId === "volumeStep")
                    return typeof w.stbGetVolume === "function";
                if (row.settingId === "osdOpacity")
                    return typeof w.stbSetOsdOpacity === "function";
                if (
                    row.settingId === "pipSize" ||
                    row.settingId === "pipPosition"
                )
                    return typeof w.stbPlayPip === "function";
                return true;
            })
        );
        page.attach();
    }
    host.__ottSubtitleAppearance = {
        apply: apply,
        declarations: declarations,
        interface: interfaceSettings,
        open: open,
        scaleFonts: scaleFonts,
    };
})(window as any);

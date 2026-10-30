/** Optional presentation adapter. Catalogues, actions and playback stay owned by the host. */
function createModernInterface(w: any) {
    var rows: any[] = [],
        formatter: any = null,
        layout: any = null,
        shapeFormatter: any = null,
        shapeGrid = false;
    function supported(): boolean {
        if (w.CSS && typeof w.CSS.supports === "function")
            return w.CSS.supports("display", "grid");
        var probe = w.document.createElement("div");
        probe.style.display = "grid";
        return probe.style.display === "grid";
    }
    function enabled(): boolean {
        return (
            Number(w.settings ? w.settings.interfaceMode : w.sInterfaceMode) ===
                1 &&
            (!w.__ottInterfaceModeState ||
                w.__ottInterfaceModeState.effective === 1)
        );
    }
    function escape(value: any): string {
        return String(value == null ? "" : value).replace(
            /[&<>"']/g,
            function (character) {
                return {
                    "'": "&#39;",
                    '"': "&quot;",
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                }[character]!;
            }
        );
    }
    function text(value: any): string {
        return String(value == null ? "" : value)
            .replace(/\s+/g, " ")
            .trim();
    }
    function artwork(value: any): string {
        var url = String(value || "").trim();
        if (/[\u0000-\u001f\u007f]/.test(url)) return "";
        if (
            /^[a-z][a-z0-9+.-]*:/i.test(url) &&
            !/^(https?:|blob:|data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml);)/i.test(
                url
            )
        )
            return "";
        return url;
    }
    function project(item: any): any {
        var catalog = formatter && formatter.__ottCatalog;
        var channel = catalog ? catalog.row(item) : null;
        var media = channel
            ? channel.__ottMediaItem
            : formatter && formatter.__ottMediaRows
              ? item
              : null;
        if (!channel && !media) return null;
        return {
            channel: channel,
            id: item,
            image: artwork(
                (media && (media.logo_30x30 || media.poster)) ||
                    (catalog && catalog.picon
                        ? catalog.picon(item)
                        : channel && (channel.logo || channel.icon))
            ),
            media: !!media,
            meta: text(
                media
                    ? media.__ottMediaCollection || media.year || ""
                    : channel.modernMeta || channel.name || ""
            ),
            playing: !!(catalog && catalog.playing && catalog.playing(item)),
            title: text(
                channel
                    ? channel.modernTitle || channel.channel_name
                    : media.title || media.name
            ),
        };
    }
    function clearDetail(): void {
        var detail = w.document.getElementById("listDetail");
        if (detail) {
            detail.classList.remove("modern-detail");
            var decorated = detail.querySelectorAll(
                ".modern-detail-title, .modern-description, .modern-detail-art"
            );
            for (var index = 0; index < decorated.length; index++)
                decorated[index].classList.remove(
                    "modern-detail-title",
                    "modern-description",
                    "modern-detail-art"
                );
        }
    }
    function reset(container: HTMLElement | null): void {
        layout = null;
        clearDetail();
        if (!container) return;
        container.classList.remove(
            "modern-catalog",
            "modern-grid",
            "modern-live"
        );
        container.style.display = "";
        container.style.gridTemplateColumns = "";
        container.style.gridAutoRows = "";
        container.style.gap = "";
    }
    function prepare(
        items: any[],
        render: any,
        container: HTMLElement | null
    ): any {
        reset(container);
        rows = items;
        formatter = render;
        if (
            !enabled() ||
            !container ||
            !render ||
            !(render.__ottCatalog || render.__ottMediaRows)
        )
            return null;
        // Choose one shape per source formatter, never from selection. Mixed
        // Favorites must not jump between rows and cards on page changes.
        if (shapeFormatter !== render) {
            var sample: any = null;
            for (var at = 0; at < Math.min(items.length, 16) && !sample; at++)
                sample = project(items[at]);
            shapeGrid =
                render.__ottCatalog?.kind !== "mixed" &&
                !!(render.__ottMediaRows || (sample && sample.media));
            if (sample || render.__ottMediaRows) shapeFormatter = render;
        }
        var grid = shapeGrid;
        var scale = Math.max(
            0.7,
            Math.min(2, Number(w.sUiFontScale || 100) / 100)
        );
        // clientWidth/clientHeight include the Classic theme's inline padding.
        // Grid tracks occupy the content box; counting that padding again can
        // clip the final row and leave the host retrying its layout forever.
        var style = w.getComputedStyle ? w.getComputedStyle(container) : null;
        function inset(name: string): number {
            return style ? parseFloat(style[name]) || 0 : 0;
        }
        var width = Math.max(
            1,
            (container.clientWidth || w.innerWidth * 0.55) -
                inset("paddingLeft") -
                inset("paddingRight")
        );
        var height = Math.max(
            1,
            (container.clientHeight || w.innerHeight * 0.7) -
                inset("paddingTop") -
                inset("paddingBottom")
        );
        var gap = Math.max(8, Math.round((w.innerWidth / 1280) * 12));
        var columns = grid
            ? Math.max(
                  1,
                  Math.min(5, Math.floor((width + gap) / (155 * scale + gap)))
              )
            : 1;
        var cellWidth = Math.max(
            1,
            Math.floor((width - gap * (columns - 1) - 2) / columns)
        );
        var preferredHeight = grid
            ? cellWidth * 1.2 + 48 * scale
            : 66 * Math.max(0.75, w.innerHeight / 720) * scale;
        var count = Math.max(
            1,
            Math.min(
                grid ? 3 : 12,
                Math.floor((height + gap) / (preferredHeight + gap))
            )
        );
        var cellHeight = Math.max(
            1,
            Math.floor((height - gap * (count - 1) - 2) / count)
        );
        layout = {
            cellHeight: cellHeight,
            cellWidth: cellWidth,
            columns: columns,
            gap: gap,
            grid: grid,
            pageSize: columns * count,
        };
        container.classList.add(
            "modern-catalog",
            grid ? "modern-grid" : "modern-live"
        );
        container.style.display = "grid";
        container.style.gridTemplateColumns =
            "repeat(" + columns + ", minmax(0, 1fr))";
        container.style.gridAutoRows = cellHeight + "px";
        container.style.gap = gap + "px";
        return layout;
    }
    function render(item: any, index: number): string | null {
        if (!layout || !enabled()) return null;
        var row = project(item);
        if (!row) return null;
        var image = row.image
            ? '<img alt="" loading="lazy" decoding="async" src="' +
              escape(row.image) +
              '">'
            : "";
        var art =
            '<span class="modern-art"><span class="modern-art-fallback" aria-hidden="true">' +
            escape((row.title || "?").slice(0, 1)) +
            "</span>" +
            image +
            "</span>";
        var programme = row.media
            ? '<span class="modern-meta">' + escape(row.meta) + "</span>"
            : '<span class="modern-meta modern-programme" id="pn' +
              escape(item) +
              '">' +
              escape(row.meta) +
              "</span>";
        return (
            '<span class="modern-number">' +
            (index + 1) +
            "</span>" +
            art +
            '<span class="modern-copy"><span class="modern-title">' +
            escape(row.title) +
            "</span>" +
            programme +
            "</span>" +
            (!row.media
                ? '<span class="modern-progress"><span id="pr' +
                  escape(item) +
                  '"></span></span>'
                : "")
        );
    }
    function decorate(
        container: HTMLElement,
        start: number,
        end: number
    ): void {
        if (!layout) return;
        for (var index = start; index < end; index++) {
            var element = w.document.getElementById("it" + index);
            var row = project(rows[index]);
            if (!element || !row) continue;
            element.classList.add(
                layout.grid ? "modern-card" : "modern-channel"
            );
            element.classList.toggle("ott-playing", row.playing);
            element.style.width = "100%";
            element.style.height = layout.cellHeight + "px";
            element.style.minHeight = "0";
            element.style.maxHeight = layout.cellHeight + "px";
            element.style.lineHeight = "normal";
            var image = element.querySelector(".modern-art img");
            if (image)
                image.onerror = function () {
                    this.style.display = "none";
                };
            if (!row.media && row.channel) {
                var channel = row.channel,
                    fill = element.querySelector(".modern-progress > span");
                if (fill)
                    fill.style.width =
                        (channel.time_to > channel.time
                            ? Math.max(
                                  0,
                                  Math.min(
                                      100,
                                      ((Date.now() / 1000 - channel.time) /
                                          (channel.time_to - channel.time)) *
                                          100
                                  )
                              )
                            : 0) + "%";
            }
        }
    }
    function beforeDetail(): HTMLElement | null {
        var row = layout && enabled() ? project(rows[w.selIndex]) : null,
            element = w.document.getElementById("listDetail");
        if (!element || !row || !row.media) {
            clearDetail();
            return null;
        }
        // Set typography before the shared renderer measures its description.
        element.classList.add("modern-detail");
        return element;
    }
    function detail(): void {
        var element = beforeDetail();
        if (!element) return;
        // Keep the shared detail DOM and its controls/owned callbacks intact.
        // In particular switching presentation must not re-run preview playback.
        var title = element.querySelector("#_name");
        var description = element.querySelector("#_prd");
        var image = element.querySelector("img");
        if (title) title.classList.add("modern-detail-title");
        if (description) description.classList.add("modern-description");
        if (image) image.classList.add("modern-detail-art");
    }
    function reflowDetail(): void {
        if (
            !w.isListVisible ||
            !formatter ||
            !(formatter.__ottCatalog || formatter.__ottMediaRows) ||
            !w.$
        )
            return;
        var element = w.document.getElementById("listDetail");
        var description = element && element.querySelector("#_prd");
        if (!description) return;
        var $ = w.$,
            body = $(description),
            wrapper = $(element).find("#_descr"),
            next = $(element).find("#_nextpr"),
            nextItems = $(element).find("#_nextitems"),
            height = $(element).height() || 0;
        body.stop(true).css("margin-top", 0);
        nextItems.stop(true).css("margin-top", 0);
        var target = "_prd",
            overflow;
        if (wrapper.length) {
            var titleHeight = $(element).find("#_name").outerHeight(true) || 0;
            next.css("max-height", Math.max(0, height - titleHeight) + "px");
            var available =
                w.settings && w.settings.showDescription
                    ? Math.max(
                          0,
                          height - titleHeight - (next.outerHeight(true) || 0)
                      )
                    : 0;
            wrapper.height(available);
            var nextOverflow = (nextItems.height() || 0) - (next.height() || 0);
            if (nextOverflow > 0) {
                target = "_nextitems";
                overflow = nextOverflow;
            } else overflow = (body.height() || 0) + 10 - available;
        } else {
            overflow =
                (body.height() || 0) +
                10 +
                ($(element).find("#mediaPlaybackControls").outerHeight(true) ||
                    0) -
                height;
        }
        // Changing presentation can resize retained text. Renew only its scroll
        // geometry, never the detail callback that also owns preview playback.
        if (typeof w.scrollUp === "function")
            w.scrollUp(target, overflow, 5000);
    }
    function activeGrid(owner: any): boolean {
        return !!(
            enabled() &&
            layout &&
            layout.grid &&
            owner &&
            owner.foreground() &&
            w.isListVisible &&
            owner.model.render === formatter
        );
    }
    function touchMetrics(owner: any): any {
        return activeGrid(owner)
            ? { height: layout.cellHeight + layout.gap, stride: layout.columns }
            : null;
    }
    function navigation(command: any, owner: any): boolean {
        if (!activeGrid(owner)) return false;
        var delta =
            command.id === "left"
                ? -1
                : command.id === "right"
                  ? 1
                  : command.id === "up"
                    ? -layout.columns
                    : command.id === "down"
                      ? layout.columns
                      : 0;
        if (!delta) return false;
        var current = Number(w.selIndex) || 0;
        var next = Math.max(0, Math.min(rows.length - 1, current + delta));
        if (next !== current && typeof w.changeSelect === "function")
            w.changeSelect(next - current);
        return true;
    }
    function refresh(): void {
        // Repaint only. Do not close the screen, reload the source or touch the decoder.
        if (!enabled()) reset(w.document.getElementById("listIn"));
        if (w.isListVisible && typeof w.showPage === "function")
            w.showPage(true);
        if (enabled()) detail();
        reflowDetail();
    }
    return {
        beforeDetail: beforeDetail,
        decorate: decorate,
        detail: detail,
        navigation: navigation,
        prepare: prepare,
        refresh: refresh,
        render: render,
        supported: supported,
        touchMetrics: touchMetrics,
    };
}
(window as any).__ottModernUiFactory = createModernInterface;
(window as any).__ottModernUi = createModernInterface(window);

/** Optional presentation adapter. Catalogues, actions and playback stay owned by the host. */
function createModernInterface(w: any) {
    var rows: any[] = [],
        formatter: any = null,
        layout: any = null,
        shapeFormatter: any = null,
        shapeGrid = false,
        shell: HTMLElement | null = null,
        shellParent: HTMLElement | null = null,
        actions: any[] = [],
        railFocus = -1,
        shellFormatter: any = null;
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
        var mixed = catalog && catalog.kind === "mixed";
        return {
            channel: channel,
            id: item,
            image: artwork(
                (media && (media.poster || media.logo_30x30)) ||
                    (catalog && catalog.picon
                        ? catalog.picon(item)
                        : channel && (channel.logo || channel.icon))
            ),
            media: !!media || !!mixed,
            meta: text(
                mixed
                    ? channel.modernMeta || ""
                    : media
                      ? media.__ottMediaCollection || media.year || ""
                      : channel.modernMeta || channel.name || ""
            ),
            playing: !!(catalog && catalog.playing && catalog.playing(item)),
            summary: text(
                media
                    ? media.description || media.summary || media.plot || ""
                    : channel.description || channel.descr || ""
            ),
            title: text(
                channel
                    ? channel.modernTitle || channel.channel_name
                    : media.title || media.name
            ),
        };
    }
    function label(value: string): string {
        if (typeof w._ !== "function") return value;
        if (value === "Menu") return w._("Menu");
        if (value === "Channel list") return w._("Channel list");
        if (value === "Media Library") return w._("Media Library");
        if (value === "Channels") return w._("Channels");
        if (value === "Favorites") return w._("Favorites");
        return value;
    }
    function foreground(): any {
        var owner = w.__ottClassicScreenPort?.listOwner?.();
        return owner && owner.foreground() && w.isListVisible ? owner : null;
    }
    function locked(): boolean {
        return !!(w.__ottKiosk?.locked?.() || w.__ottKiosk?.enabled?.());
    }
    function removeShell(): void {
        railFocus = -1;
        actions = [];
        if (shell && shell.parentNode) shell.parentNode.removeChild(shell);
        if (shellParent)
            shellParent.classList.remove(
                "modern-screen",
                "modern-screen-catalog",
                "modern-screen-grid",
                "modern-screen-live",
                "modern-screen-menu",
                "modern-empty",
                "modern-rail-focused",
                "modern-has-controls"
            );
        shell = shellParent = null;
        shellFormatter = null;
    }
    function focusRail(index: number): void {
        if (!shell || !actions.length || locked()) return;
        var direction = index < railFocus ? -1 : 1;
        var target = Math.max(0, Math.min(actions.length - 1, index));
        while (actions[target].disabled) {
            target += direction;
            if (target < 0 || target >= actions.length) return;
        }
        railFocus = target;
        shellParent?.classList.add("modern-rail-focused");
        var buttons = shell.querySelectorAll(".modern-rail-action");
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i] as HTMLElement;
            button.classList.toggle("modern-rail-selected", i === railFocus);
            button.tabIndex = i === railFocus ? 0 : -1;
            if (i === railFocus) button.focus();
        }
    }
    function focusContent(): void {
        railFocus = -1;
        shellParent?.classList.remove("modern-rail-focused");
        if (shell) {
            var buttons = shell.querySelectorAll(".modern-rail-action");
            for (var i = 0; i < buttons.length; i++) {
                buttons[i].classList.remove("modern-rail-selected");
                (buttons[i] as HTMLElement).tabIndex = 0;
            }
        }
        var selected = w.document.getElementById("it" + w.selIndex);
        if (selected) selected.focus();
    }
    function invokeAction(index: number, event?: Event): void {
        var owner = foreground();
        var action = actions[index];
        if (!enabled() || !owner || !action || action.disabled || locked())
            return;
        // Buttons retained by a settings/confirmation overlay are never active.
        if (owner.model.render !== formatter) return;
        railFocus = -1;
        shellParent?.classList.remove("modern-rail-focused");
        if (action.key && typeof w._doKey === "function")
            w._doKey(action.key, event);
        else if (typeof action.run === "function") action.run();
    }
    function makeShell(): boolean {
        var parent = w.document.getElementById("list");
        if (!enabled() || !parent) {
            removeShell();
            return false;
        }
        if (shell && shellParent !== parent) removeShell();
        shellParent = parent;
        if (!shell) {
            shell = w.document.createElement("div") as HTMLElement;
            shell.id = "modernShell";
            shell.innerHTML =
                '<nav id="modernRail"><div class="modern-brand">OTT<span>PLAY</span></div><div class="modern-rail-actions"></div></nav>' +
                '<section id="modernHero"><div class="modern-hero-art"></div><div class="modern-hero-copy"><span class="modern-eyebrow"></span><h1 class="modern-hero-title"></h1><div class="modern-hero-meta"></div><p class="modern-hero-summary"></p></div></section>' +
                '<header id="modernLibraryHeading"><span class="modern-library-title"></span><span class="modern-library-count"></span></header>';
            shell
                .querySelector("#modernRail")!
                .setAttribute("aria-label", label("Menu"));
            parent.insertBefore(shell, parent.firstChild);
        }
        parent.classList.add("modern-screen");
        return true;
    }
    function syncActions(): void {
        if (!shell) return;
        var supplied =
            typeof w.__ottModernActions === "function"
                ? w.__ottModernActions()
                : [];
        var next: any[] = [];
        var used: any = Object.create(null);
        function add(action: any): void {
            if (!action || !action.id || !action.label || used[action.id])
                return;
            var name = "label:" + text(action.label).toLowerCase();
            if (used[name]) return;
            used[action.id] = used[name] = true;
            next.push(action);
        }
        if (!Array.isArray(supplied)) supplied = [];
        var browse = supplied.filter(function (action) {
            return action?.id === "browse";
        })[0];
        var library = supplied.filter(function (action) {
            return action?.id === "library";
        })[0];
        add(
            browse ||
                library || {
                    icon: "▦",
                    id: "browse",
                    label: label("Channel list"),
                    run: focusContent,
                }
        );
        supplied.slice(0, 10).forEach(add);
        var footer = w.document.getElementById("listPodval");
        var buttons = footer && footer.querySelectorAll("[data-ott-key]");
        if (typeof w.__ottModernActions !== "function" && buttons)
            for (var i = 0; i < Math.min(buttons.length, 8); i++) {
                var key = Number(buttons[i].getAttribute("data-ott-key"));
                var title =
                    buttons[i].getAttribute("aria-label") ||
                    buttons[i].getAttribute("title") ||
                    text(buttons[i].textContent);
                if (key && title)
                    add({
                        icon: "•",
                        id: "key-" + key,
                        key: key,
                        label: title,
                    });
            }
        actions = next;
        var root = shell.querySelector(".modern-rail-actions")!;
        var controlOwner = foreground();
        root.textContent = "";
        next.forEach(function (action, index) {
            var button = w.document.createElement("button");
            button.type = "button";
            button.className = "modern-rail-action";
            button.setAttribute("data-modern-action", action.id);
            button.setAttribute("aria-label", action.label);
            button.setAttribute("title", action.label);
            if (action.active) button.setAttribute("aria-current", "page");
            button.disabled = !!action.disabled || locked();
            var icon = button.appendChild(w.document.createElement("span"));
            icon.className = "modern-rail-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = action.icon || "•";
            var caption = button.appendChild(w.document.createElement("span"));
            caption.className = "modern-rail-label";
            caption.textContent = action.label;
            function activate(event: Event): void {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (actions[index] !== action || foreground() !== controlOwner)
                    return;
                invokeAction(index, event);
            }
            button.onclick = activate;
            button.onkeydown = function (event) {
                if (event.key === "Enter" || event.key === " ") activate(event);
            };
            button.onfocus = function () {
                if (actions[index] === action && railFocus !== index)
                    focusRail(index);
            };
            root.appendChild(button);
        });
        if (railFocus >= 0 && actions.length) focusRail(railFocus);
    }
    function syncControls(): void {
        if (!shellParent) return;
        var controls = w.document.querySelector(
            "#listDetail #mediaPlaybackControls"
        );
        shellParent.classList.toggle(
            "modern-has-controls",
            !!(
                controls &&
                !controls.hidden &&
                controls.style.display !== "none" &&
                controls.querySelector("[data-ott-key]")
            )
        );
    }
    function syncScreen(): void {
        if (!makeShell()) return;
        var isCatalog = !!(
            formatter &&
            (formatter.__ottCatalog || formatter.__ottMediaRows)
        );
        shellParent!.classList.toggle("modern-screen-catalog", isCatalog);
        shellParent!.classList.toggle("modern-screen-menu", !isCatalog);
        shellParent!.classList.toggle(
            "modern-screen-grid",
            isCatalog && shapeGrid
        );
        shellParent!.classList.toggle(
            "modern-screen-live",
            isCatalog && !shapeGrid
        );
        if (shellFormatter !== formatter) {
            railFocus = -1;
            shellParent!.classList.remove("modern-rail-focused");
            shellFormatter = formatter;
        }
        syncActions();
        syncControls();
        var title = w.document.getElementById("listCaption");
        var heading = shell!.querySelector(".modern-library-title")!;
        var caption = title && title.cloneNode(true);
        if (caption) {
            var clock = caption.querySelector("#listTime");
            if (clock) clock.remove();
        }
        var captionText = caption
            ? text(caption.textContent)
            : label("Channel list");
        var prefix = text(
            typeof w._ === "function"
                ? w._("Channel list. Category: ")
                : "Channel list. Category: "
        );
        heading.textContent =
            captionText.indexOf(prefix) === 0
                ? text(captionText.slice(prefix.length))
                : captionText;
        var count = shell!.querySelector(".modern-library-count")!;
        count.textContent = rows.length
            ? Math.min(rows.length, Math.max(0, Number(w.selIndex) || 0) + 1) +
              " / " +
              rows.length
            : "";
        updateHero();
    }
    function updateHero(): void {
        if (!shell) return;
        var catalog = !!(
            formatter &&
            (formatter.__ottCatalog || formatter.__ottMediaRows)
        );
        var row =
            catalog && enabled() && w.selIndex >= 0 && w.selIndex < rows.length
                ? project(rows[w.selIndex])
                : null;
        shellParent!.classList.toggle("modern-empty", catalog && !row);
        var hero = shell.querySelector("#modernHero") as HTMLElement;
        hero.hidden = !row;
        if (!row) return;
        shell.querySelector(".modern-library-count")!.textContent =
            Math.max(0, Number(w.selIndex) || 0) + 1 + " / " + rows.length;
        shell.querySelector(".modern-eyebrow")!.textContent =
            formatter.__ottCatalog?.kind === "mixed"
                ? label("Favorites")
                : row.media
                  ? label("Media Library")
                  : label("Channels");
        shell.querySelector(".modern-hero-title")!.textContent = row.title;
        shell.querySelector(".modern-hero-meta")!.textContent = row.meta;
        shell.querySelector(".modern-hero-summary")!.textContent = row.summary;
        var art = shell.querySelector(".modern-hero-art")!;
        var existing = art.querySelector("img");
        if (
            (existing && existing.getAttribute("src")) !== (row.image || null)
        ) {
            art.textContent = "";
            if (row.image) {
                var image = w.document.createElement("img");
                image.alt = "";
                image.decoding = "async";
                image.src = row.image;
                image.onerror = function () {
                    image.hidden = true;
                };
                art.appendChild(image);
            }
        }
        hero.classList.toggle("modern-hero-with-art", !!row.image);
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
        shellParent?.classList.remove("modern-empty");
        clearDetail();
        if (!container) return;
        container.classList.remove(
            "modern-catalog",
            "modern-grid",
            "modern-live",
            "modern-options"
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
        if (!enabled() || !container || !render) {
            removeShell();
            return null;
        }
        var menu = !(render.__ottCatalog || render.__ottMediaRows);
        // Choose one shape per source formatter, never from selection. Mixed
        // Favorites must not jump between rows and cards on page changes.
        if (!menu && shapeFormatter !== render) {
            var sample: any = null;
            for (var at = 0; at < Math.min(items.length, 16) && !sample; at++)
                sample = project(items[at]);
            shapeGrid = !!(
                render.__ottCatalog?.kind === "mixed" ||
                render.__ottMediaRows ||
                (sample && sample.media)
            );
            if (sample || render.__ottMediaRows) shapeFormatter = render;
        }
        syncScreen();
        var grid = !menu && shapeGrid;
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
                  Math.min(8, Math.floor((width + gap) / (150 * scale + gap)))
              )
            : 1;
        var cellWidth = Math.max(
            1,
            Math.floor((width - gap * (columns - 1) - 2) / columns)
        );
        var preferredHeight = grid
            ? cellWidth * 1.32 + 48 * scale
            : (menu ? 50 : 66) * Math.max(0.75, w.innerHeight / 720) * scale;
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
            menu: menu,
            pageSize: columns * count,
        };
        if (menu) container.classList.add("modern-options");
        else
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
        if (!layout || layout.menu || !enabled()) return null;
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
            var row = layout.menu ? null : project(rows[index]);
            if (!element || (!layout.menu && !row)) continue;
            element.classList.add(
                layout.menu
                    ? "modern-option"
                    : layout.grid
                      ? "modern-card"
                      : "modern-channel"
            );
            element.classList.toggle("ott-playing", !!(row && row.playing));
            element.style.width = "100%";
            element.style.height = layout.cellHeight + "px";
            element.style.minHeight = "0";
            element.style.maxHeight = layout.cellHeight + "px";
            element.style.lineHeight = "normal";
            if (layout.menu) continue;
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
        var row =
                layout &&
                enabled() &&
                w.selIndex >= 0 &&
                w.selIndex < rows.length
                    ? project(rows[w.selIndex])
                    : null,
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
        syncControls();
        updateHero();
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
        if (
            !enabled() ||
            !owner ||
            !owner.foreground() ||
            !w.isListVisible ||
            owner.model.render !== formatter
        )
            return false;
        if (railFocus >= 0 && shell) {
            if (command.id === "up" || command.id === "down") {
                focusRail(railFocus + (command.id === "up" ? -1 : 1));
                return true;
            }
            if (command.id === "accept") {
                invokeAction(railFocus, command.event);
                return true;
            }
            if (
                command.id === "right" ||
                command.id === "back" ||
                command.id === "exit"
            ) {
                focusContent();
                return true;
            }
            return command.id === "left";
        }
        if (
            shell &&
            actions.length &&
            command.id === "left" &&
            !locked() &&
            (!layout ||
                !layout.grid ||
                (Number(w.selIndex) || 0) % layout.columns === 0)
        ) {
            focusRail(0);
            return true;
        }
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
        var player = w.__ottModernPlayer;
        if (player && typeof player.refresh === "function") player.refresh();
        if (!enabled()) {
            reset(w.document.getElementById("listIn"));
            removeShell();
        }
        if (w.isListVisible && typeof w.showPage === "function")
            w.showPage(true);
        if (enabled()) {
            syncScreen();
            detail();
        }
        reflowDetail();
    }
    return {
        beforeDetail: beforeDetail,
        decorate: decorate,
        detail: detail,
        hide: function (): void {
            railFocus = -1;
            shellParent?.classList.remove("modern-rail-focused");
        },
        navigation: navigation,
        prepare: prepare,
        refresh: refresh,
        render: render,
        supported: supported,
        syncScreen: syncScreen,
        touchMetrics: touchMetrics,
    };
}
(window as any).__ottModernUiFactory = createModernInterface;
(window as any).__ottModernUi = createModernInterface(window);
(window as any).__ottModernPlayer =
    typeof (window as any).__ottModernPlayerFactory === "function"
        ? (window as any).__ottModernPlayerFactory(window)
        : null;

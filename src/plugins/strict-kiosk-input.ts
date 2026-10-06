/** Consume the entire gesture before legacy touch, mouse and keyboard handlers. */
export function createStrictKioskInput(w: any, active: () => boolean): any {
    var gesture: any = null;
    var lastTouch = -10000;
    var lastPointer = -10000;
    function now(): number {
        return w.performance && w.performance.now
            ? w.performance.now()
            : Date.now();
    }
    function consume(event: any): void {
        if (event.preventDefault) event.preventDefault();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    function info(): void {
        if (typeof w.showChannelInfo === "function") w.showChannelInfo(5);
    }
    function revoke(event: any): boolean {
        if (!w.document || !w.document.getElementById) return false;
        var button = w.document.getElementById("remoteDiagnosticsIndicator");
        if (!button || button.nodeName !== "BUTTON" || event.target !== button)
            return false;
        // Retain the local right to revoke diagnostic access, never to grant it.
        w.__ottKiosk.stopDiagnostics();
        return true;
    }
    function key(event: any, code?: number): void {
        if (!active()) return;
        consume(event);
        if (event.type && event.type !== "keydown") return;
        var keys = w.keys || {};
        if (code === undefined) {
            var device = w.__ottDevice;
            code =
                device && device.eventToKeyCode
                    ? device.eventToKeyCode(event)
                    : event.keyCode || event.which;
        }
        if (code && code === keys.INFO) info();
        else if (code && code === keys.STOP) w.__ottKiosk.stopDiagnostics();
        else if (event.key === "Enter" || event.key === " ") revoke(event);
    }
    function start(point: any, kind: string, id: any): void {
        gesture = {
            id: id,
            kind: kind,
            moved: false,
            time: now(),
            x: point.clientX,
            y: point.clientY,
        };
    }
    function move(point: any): void {
        if (
            gesture &&
            point &&
            (Math.abs(point.clientX - gesture.x) > 12 ||
                Math.abs(point.clientY - gesture.y) > 12)
        )
            gesture.moved = true;
    }
    function finish(point: any): void {
        move(point);
        if (gesture && !gesture.moved && now() - gesture.time < 600) info();
        gesture = null;
    }
    function input(event: any): void {
        if (!active()) return;
        consume(event);
        var type = event.type;
        var time = now();
        if (type.indexOf("key") === 0) {
            key(event);
            return;
        }
        if (type === "touchstart") {
            lastTouch = time;
            if (revoke(event)) gesture = null;
            else if (event.touches.length === 1 && !gesture)
                start(event.touches[0], "touch", event.touches[0].identifier);
            else gesture = null;
        } else if (type === "touchmove") {
            if (gesture && gesture.kind === "touch") move(event.touches[0]);
        } else if (type === "touchend") {
            lastTouch = time;
            if (
                gesture &&
                gesture.kind === "touch" &&
                !event.touches.length &&
                event.changedTouches[0].identifier === gesture.id
            )
                finish(event.changedTouches[0]);
            else gesture = null;
        } else if (type === "pointerdown" || type === "mousedown") {
            if (event.pointerType === "touch" || time - lastTouch < 800) return;
            if (type === "mousedown" && w.PointerEvent) return;
            if (revoke(event)) gesture = null;
            else if (
                (event.button === undefined || event.button === 0) &&
                !gesture
            )
                start(event, "pointer", event.pointerId);
            else gesture = null;
        } else if (type === "pointermove" || type === "mousemove") {
            if (gesture && gesture.kind === "pointer") move(event);
        } else if (type === "pointerup" || type === "mouseup") {
            if (event.pointerType === "touch" || time - lastTouch < 800) return;
            if (type === "mouseup" && w.PointerEvent) return;
            lastPointer = time;
            if (
                gesture &&
                gesture.kind === "pointer" &&
                event.pointerId === gesture.id
            )
                finish(event);
        } else if (type === "click") {
            // Keyboard/accessibility clicks have no pointer sequence. Compatibility
            // clicks following touch/pointer releases must not show the footer twice.
            if (
                time - lastTouch >= 800 &&
                time - lastPointer >= 800 &&
                event.detail <= 1 &&
                !revoke(event)
            )
                info();
        } else if (
            type === "pointercancel" ||
            type === "touchcancel" ||
            type === "contextmenu"
        ) {
            gesture = null;
        }
    }
    var target = w.addEventListener ? w : w.document;
    if (target && target.addEventListener) {
        [
            "keydown",
            "keyup",
            "keypress",
            "click",
            "dblclick",
            "contextmenu",
            "pointerdown",
            "pointermove",
            "pointerup",
            "pointercancel",
            "mousedown",
            "mousemove",
            "mouseup",
            "touchstart",
            "touchmove",
            "touchend",
            "touchcancel",
            "wheel",
            "dragstart",
            "selectstart",
        ].forEach(function (name) {
            target.addEventListener(name, input, {
                capture: true,
                passive: false,
            });
        });
    }
    return {
        key: key,
        sync: function (): void {
            gesture = null;
            var root = w.document && w.document.documentElement;
            if (root && root.classList) {
                root.classList.toggle("ott-kiosk-strict", active());
                if (active()) {
                    var focused = w.document.activeElement;
                    if (focused && focused.blur) focused.blur();
                }
            }
        },
    };
}

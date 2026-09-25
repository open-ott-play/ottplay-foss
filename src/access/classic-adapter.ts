/**
 * Classic functions and the unchanged keypad render through one access owner.
 * Grants belong to the provider storage/configuration and PIN policy. A catalog
 * repaint retains the grant; replacing a provider or changing its policy revokes it.
 */
function createClassicAccess(host: any) {
    var context: any = null;
    function policy(kind: string): any {
        if (kind === "control") return true;
        var field =
            kind === "providers"
                ? "sPSprovs"
                : kind === "settings"
                  ? "sPSoptions"
                  : "sPSchannels";
        var setting =
            kind === "providers"
                ? "requirePinForProviderSelection"
                : kind === "settings"
                  ? "psOptions"
                  : "psChannels";
        return host[field] === undefined && host.settings
            ? host.settings[setting]
            : host[field];
    }
    function scope(): any {
        var fingerprint = JSON.stringify([
            host.__ottSourceIdentity.current(host),
            host.parentPIN,
            policy("channels"),
            policy("settings"),
            policy("providers"),
        ]);
        if (
            !context ||
            context.fingerprint !== fingerprint ||
            context.get !== host.providerGetItem ||
            context.set !== host.providerSetItem
        )
            context = {
                fingerprint: fingerprint,
                get: host.providerGetItem,
                set: host.providerSetItem,
            };
        return context;
    }
    var session = host.__ottAccessSession.create({
        cancel: function (timer: any) {
            host.clearTimeout(timer);
        },
        context: scope,
        now: function () {
            return Date.now();
        },
        schedule: function (callback: () => void, delay: number) {
            return host.setTimeout(callback, delay);
        },
    });
    function notify(): void {
        if (typeof host.showShift === "function")
            host.showShift(host._("Wrong parental code !!!"));
    }
    function setAccess(granted: boolean, callback: () => void): void {
        if (session.grant(granted)) callback();
        else if (!granted) notify();
    }
    function pin(prompt: string, callback: (value: string) => void): void {
        var port = host.__ottClassicScreenPort;
        var element = host.$("#dialogbox");
        if (!element.length) return;
        var ticket = session.begin();
        var model = host.__ottAccessSession.createPin();
        var completing = false;
        var highlighted = 1;
        var owner: any = null;
        function render(): void {
            if (!owner.active() || !ticket.active()) return;
            var state = model.snapshot();
            var old = host.document.getElementById("k" + highlighted);
            if (old) {
                old.style.backgroundColor = "";
                old.style.color = "";
            }
            highlighted = state.cursor;
            var next = host.document.getElementById("k" + highlighted);
            if (next) {
                next.style.backgroundColor = host.curColorB || "#668";
                next.style.color = host.curColor || "gold";
            }
            var mask = host.document.getElementById("pin");
            if (mask) mask.innerHTML = "# # # # ".slice(0, state.length * 2);
        }
        var handler = port.setOwnedCallback("dialog", function (code: number) {
            if (!ticket.active()) {
                port.close("dialog");
                return;
            }
            var kind = "";
            var value = 0;
            for (var digit = 0; digit < 10; digit++)
                if (code === host.keys["N" + digit]) {
                    kind = "digit";
                    value = digit;
                    break;
                }
            if (!kind) {
                if (code === host.keys.RETURN || code === host.keys.EXIT)
                    kind = "cancel";
                else if (code === host.keys.ENTER) kind = "accept";
                else if (code === host.keys.LEFT || code === host.keys.UP) {
                    kind = "move";
                    value = -1;
                } else if (
                    code === host.keys.RIGHT ||
                    code === host.keys.DOWN
                ) {
                    kind = "move";
                    value = 1;
                }
            }
            var result = model.input(kind, value);
            render();
            if (result === null) return;
            completing = true;
            port.close("dialog");
            if (ticket.complete()) callback(result);
        });
        owner = handler.owner;
        if (!owner || !owner.active() || !ticket.active()) return;
        owner.own(function () {
            if (!completing) ticket.cancel();
        });
        var buttons = "";
        for (var position = 1; position <= 10; position++) {
            var digit = position % 10;
            buttons +=
                '<div id="k' +
                digit +
                '" style="display:inline-block;padding:6px;"><div class="btn">' +
                digit +
                "</div></div>";
        }
        element.html(
            prompt +
                '<br/><br/><span id="pin" style="font-size: 200%;">&nbsp;</span><br><br>' +
                buttons
        );
        if (!owner.active() || !ticket.active()) return;
        function click(digit: number): () => void {
            return function () {
                if (owner.foreground()) handler(host.keys["N" + digit]);
            };
        }
        for (var digit = 0; digit < 10; digit++) {
            var cell = host.document.getElementById("k" + digit);
            if (cell && cell.firstChild) cell.firstChild.onclick = click(digit);
        }
        element.show();
        render();
    }
    function needs(kind: string): boolean {
        return !!policy(kind) && host.parentPIN !== "*" && !session.allowed();
    }
    function request(callback: () => void): void {
        var expected = scope();
        var secret = String(host.parentPIN);
        pin(host._("Enter parental code"), function (value) {
            if (!value || scope() !== expected) return;
            setAccess(value === secret, callback);
        });
    }
    function guard(channelId: number, callback: () => void): () => void {
        var expected = scope();
        var catalog = host.channels;
        var channel = catalog && catalog[channelId];
        return function () {
            if (
                channel &&
                scope() === expected &&
                host.channels === catalog &&
                catalog[channelId] === channel
            )
                callback();
        };
    }
    var initial = host.parentAccess === true;
    Object.defineProperty(host, "parentAccess", {
        configurable: true,
        get: session.allowed,
        set: function (value: boolean) {
            session.grant(value === true);
        },
    });
    if (initial) session.grant(true);
    return {
        allowed: session.allowed,
        guard: guard,
        needs: needs,
        pin: pin,
        request: request,
        require: function (kind: string, callback: () => void): boolean {
            if (!needs(kind)) return false;
            // Retain the public prompt hook used by device/provider integrations.
            host.enterPinAndSetAccess(callback);
            return true;
        },
        revoke: session.revoke,
        setAccess: setAccess,
    };
}

(window as any).__ottParental = createClassicAccess(window);

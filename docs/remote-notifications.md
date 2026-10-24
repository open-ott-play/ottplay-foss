# Remote notification presentation

Home Assistant events appear as temporary cards over an active player. The
controller supplies the title and message; the player adds the English severity
label **Home update**, **Attention**, or **Alert**. Translate controller templates
at their source rather than changing entity names or translating incoming text
inside the player.

The cards size themselves against the viewport, independently of the player
skin's text size. Text ranges from 13 to 20 CSS pixels in current browsers, with
a 14-pixel fallback. A card is at most 24 text units wide and stays within the
window margins. Compact windows reduce padding and the number of visible text
lines. Long titles and messages are clipped to bounded previews so three
simultaneous notifications fit normal small windows. This is a transient preview,
not a complete event history; keep controller messages concise.

Only the dark surface is translucent; text and icons retain full opacity.
The default information footer has alpha 0.70 (30% transparency). Notification
surfaces add 0.08 opacity, giving alpha 0.78 (22% transparency), capped at 1.0.
The value updates with the footer's opacity setting. Older WebViews without CSS
custom properties use the same 0.78 default surface. The solid RGB base is
22,28,39; no gradient or container opacity dilutes text contrast.

Severity has a text label, decorative badge and a uniformly thin, closed
1 CSS pixel outline in the same accent color. Older WebViews retain fixed-font,
word-wrap and bounded-height fallbacks. Layout does not require backdrop filters,
flex gap, JavaScript resize handlers or external fonts. Reduced-motion settings
disable the entrance animation.

Presentation does not change delivery: cards never take focus or pointer input,
never wake a sleeping player, retain the bounded three-card queue and existing
expiry/deduplication rules, and disappear when the player becomes inactive.
All remote text is rendered literally with `textContent`.

## Verification

```sh
npm run build
node tests/test_remote_notifications.cjs
node tests/test_command_server.cjs
npx playwright test tests/browser/remote-notifications.spec.cjs
```

The browser suite checks 640×360 (including installed-app titlebar geometry),
960×540, 320×568, 844×390 and 1920×1080 viewports. It forces the surrounding
player font to 48 pixels to detect inherited-size regressions and tests three
cards, long unbroken strings, literal HTML-like input, reduced motion and
standby clearing. It saves screenshots of the built player over synthetic
bright and dark backgrounds; these are contrast/layout fixtures, not footage
or physical-device certification. Native Tauri/LG/Android acceptance remains
part of release validation.

### Layout examples

These are rendered screenshots of the built player with synthetic backgrounds
and deliberately long test messages. Physical device playback is not simulated.

Compact 640×360 window with installed-app titlebar spacing:

![Compact notification layout](images/remote-notifications/compact.png)

1920×1080 viewport:

![Fullscreen notification layout](images/remote-notifications/fullscreen.png)

320×568 portrait viewport:

![Portrait notification layout](images/remote-notifications/portrait.png)

## Per-install receive switch

One durable installation setting, `sNotificationsEnabled`, controls both text
and camera snapshots. A missing value means enabled. It is not a provider or
media-profile preference, is not exported with profiles, and profile/local
backup restore cannot overwrite it.

The runtime-fenced `notifications` RPC accepts
`{version:1, operation:"get", runtime}` or
`{version:1, operation:"set", runtime, enabled:boolean}`. A successful reply
contains `{version:1, runtime, operation, enabled, persisted:true}`. A set first
writes and verifies persistent storage; only then does it change the receiver.
The command works during standby and strict kiosk without waking the player.
Storage failure is reported, not presented as a saved preference. Startup
distinguishes an absent preference from an unreadable durable store and disables
reception in the latter case. A rejected stale-runtime request echoes its
validated original runtime, so the controller can acknowledge the failure.

Turning reception off aborts pending notification/media requests, removes cards
and image URLs, and retires the viewing-session identity. Command reception
continues, so remote re-enable remains possible. Turning reception back on starts
a fresh session: expired or previous-session events are not replayed.

The first poll uses the legacy `runtime` and `active` query only. A controller
may advertise `capabilities:{enabled:true,media:["jpeg-v1"]}` in its response.
Only then are the corresponding `enabled` and `media=jpeg-v1` query parameters
sent. Disabled reception always advertises `active=false`, including to older
controllers. A controller rollback rejecting optional fields triggers a legacy
retry instead of breaking the command lane.

## Motion snapshots

The initial media format is one JPEG snapshot, not a second video stream. A media notification creates no label, title, message or icon DOM nodes. Its card stays hidden until JPEG decoding succeeds, then displays only the complete image edge to edge inside the thin rounded border. Width is bounded by the normal card width, viewport width and 40% of viewport height while preserving the validated JPEG aspect ratio, including 4:3 and portrait images. Resizing recomputes these bounds. Fetch/decode failure, expiry or replacement removes the media card entirely; no empty frame or text fallback remains. Standalone notifications without a media descriptor retain the normal text layout (including controller-side text fallback when no snapshot was obtained).
Motion-cleared events are filtered by the controller; light, outlet and occupancy
off events are unaffected. The player does not infer event types from translated
message text. Motion templates use the title `Motion` and the entity name alone
as the message (for example, `Front door`). The controller owns this wording;
the renderer does not strip suffixes from incoming text.

An optional `media` descriptor contains an opaque 32-hex `id`, `kind:"image"`,
`content_type:"image/jpeg"`, `width` (1–640), `height` (1–360), and `bytes`
(1–163840). No camera URL or credentials are sent to the player. It obtains
`/api/notifications/media?id=…&runtime=…` under the configured controller base,
preserving an optional `device_id`, and sends device authorization in a header.
The response is bounded to 224 KiB JSON with the same identity/dimensions/length,
`data_base64`, `server_time` and `expires_at` (seconds).

Media requires a bounded, abortable Fetch stream, rejected redirects and temporary
Blob URLs. The controller must allow the authorized browser request through
CORS. Unsupported browser/WebView transports do not advertise JPEG support and
receive ordinary text notifications. If an unusable media descriptor nevertheless
arrives, its hidden card is removed. The client never uses the unbounded
command-string transport or an unauthenticated image URL.
Only one image request/preview is owned at a time. New media retires the previous
preview; expiry, off, standby, hidden state and reconfiguration dispose it. JPEG
frame dimensions are checked before browser decode. Late async callbacks cannot
attach images to a retired receiver/session. Snapshots are never written to
persistent storage and do not change the primary player source or audio.

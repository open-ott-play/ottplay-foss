# Quality limits and live stream recovery

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Decoder ownership](device-media-backend.md)

The managed HTML5/HLS/Shaka player retains one playback lease while recovering
from a failed source. It can also use up to three explicitly configured backup
URLs for a live channel. It never discovers, guesses or substitutes a channel
by its title.

![Recovery flow: one lease, finite retries, explicit backups](diagrams/stream-recovery.svg)

## Set a quality ceiling

Open **Settings → Interface settings** and set **Maximum video height
(HLS/Shaka)** and/or **Maximum stream bitrate (HLS/Shaka)**. The two constraints
apply together. **Automatic** removes that constraint. Supported choices are
360/480/720/1080/2160 pixels and 1/2/4/8/16 Mbps. Settings are stored locally,
participate in the normal settings save/cancel flow and take effect on the next
playback start, including a recovery restart.

These are ceilings, not transcoding settings. A 1080p-only stream cannot become
720p. If no advertised variant fits, the player reports **No stream meets the
quality limits** and stops retrying that request. Unknown height/bitrate cannot
prove that a constrained HLS variant fits.

HLS variant filtering happens before fragment loading. Current hls.js removes
ineligible variants; older builds without `removeLevel` can only retain a safe
contiguous prefix and may reject a manifest with otherwise eligible later
variants. Shaka uses application `maxHeight`/`maxBandwidth` restrictions.
Automatic adaptation continues among the remaining variants.

These settings apply to the managed HLS and Shaka engines. Plain HTML5, native
platform decoders and retained TV/STB engines do not expose the same controls.
Auto mode can select native playback; the setting does not force it into MSE.
The player will not switch an already constrained HLS request to unconstrained
native playback just to evade a decode error. No native transcoder, automatic
hardware benchmark or claim of physical 720p output is implied.

## Configure explicit backups

1. Start the intended live channel.
2. Open **Information → Backup streams**.
3. Select slot 1, 2 or 3 and enter a complete HTTP/HTTPS media URL.
4. Reopen an occupied slot to **Edit** or **Delete** it. Start the channel again
   to use the updated list.

Each slot belongs to the current provider storage namespace and the exact
`sourceId`/`channelId` pair. The current playback generation and source
configuration fence the editor. Switching sources while a dialog is open
prevents that dialog from saving to the replacement source. A concurrent change
to the same slot is rejected instead of overwritten.

The first URL remains the channel's ordinary source. Duplicate and empty slots
are skipped. A maximum of 256 channel records and 256 KiB of configuration are
accepted. URLs with user-info credentials, whitespace, control characters,
backslashes or an invalid port are rejected. Provider-supplied query tokens can
still be part of a media URL: backup settings are local source configuration,
not a mechanism to share credentials or make them public.

Backups are **live only**. Archive and VOD requests never use a live alternative:
the recording, time origin, rights and seek semantics can differ. The owner must
supply equivalent, authorized live endpoints. A matching channel title is not
proof of equivalence. The stored channel identity, favourites and EPG binding
remain unchanged when its transport endpoint changes.

## Recovery guarantees

- The request has at most **two delayed transient same-URL retries in total** and
  at most one forward move to each of its three backup slots: at most five
  recreations after the initial start. This budget is not reset by a new decoder
  instance or a successful manifest. Existing bounded in-engine HLS network and
  decode recovery runs before this outer recovery policy.
- HLS manifest/level parsing failures allow at most one same-URL reconnect
  per request, counted within the same two-retry total. A new decoder or backup
  endpoint does not reset this limit.
- Network failures without a status, HTTP 408/429 and 5xx can use the transient
  budget. Other HTTP 4xx can move to a configured alternative but do not retry
  the same URL. HTTP **401/403 and source sign-in errors terminate**, without
  probing alternative credentials or backup endpoints.
- Decode failures can move forward to an explicit backup. Impossible quality
  limits terminate. There is no cycling back to the primary source.
- Delay is 500 ms, 1 s, 1.5 s, then at most 2 s. Repeated callbacks coalesce.
- Pause removes the scheduled timer while retaining its pending retry; Resume
  schedules it again. Stop, standby, source replacement and channel replacement
  invalidate delayed callbacks. A failed terminal request requires explicit
  reselection rather than autoplaying its retired decoder.
- Shaka load failures and critical error events share this path; cancellation
  errors are ignored. Reattachment waits for asynchronous Shaka destruction.
- Recovery re-resolves an opaque Stalker reference and prepares protected source
  access again. It does not reuse an expired iOS loopback URL. VOD/archive
  position is sampled before teardown; live backups start at their live edge.

The policy does not introduce a second stalled-frame watchdog. Existing kiosk,
Auto/native and HLS recovery still cover their own observed failure cases. A
stream that stalls silently without any existing detector reporting an error
needs separate diagnosis.

## Verification and observability

`window.__ottStreamPolicy.snapshot()` exposes engine name, requested limits,
capability/availability, retry count, endpoint index and recovery state. It
contains no stream URL or provider credentials. Index zero means the ordinary
source; later indexes refer to nonempty unique alternatives. This is diagnostic
state, not a stable remote-control API.

Run:

```sh
node tests/test_stream_policy.cjs
node tests/test_port_engine_lifecycle.cjs
node tests/test_settings_parity.cjs
node tests/test_media_backend.cjs
npm run test:localization
npm run typecheck
npm run build:server
node scripts/check-es5.cjs --server-only
```

Tests exercise quality filtering with non-monotonic variant order, unavailable
metadata, source-scoped editing, slot conflicts, duplicate errors, bounded
budgets, HTTP authorization failures, pause/stop/source cancellation, Shaka
teardown and VOD position retention. The five new playback labels are translated
in all 88 shipped language packs; automated parity is not native-speaker review.
Physical TV/D1 playback and provider-specific manifests still require device
validation. [Editable diagram source](diagrams/stream-recovery.mmd).

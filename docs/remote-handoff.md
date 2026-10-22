# Explicit playback handoff

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Improvements](roadmap-delivery.md)

With updated player and control CLI, run `ott handoff SOURCE TARGET`.
The source continues playing. The target needs the same configured source/account
and a unique stable channel ID. Channel references are versioned local fingerprints, never raw provider item IDs.
Classic M3U rows use the exact stream URL only as local hash input. Independently
signed or rewritten URLs therefore fail to match safely. No fuzzy name matching,
credentials or playable URL are transferred. Version 1 supports live/archive for M3U, Xtream and Stalker;
VOD/series and continuous watch-history synchronization are not supported.

`playback_handoff_export` accepts empty parameters and returns `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Archive references use `kind: "archive"` and integer `archive_start` (current
playback point as Unix seconds). `playback_handoff_import` accepts only
`{"handoff": ...}`. The target enforces catalogue identity, archive availability,
parental/kiosk policy and current ownership before dispatch. It resolves streams
through its own provider. An accepted import returns
`{"status":"ok","data":{"dispatched":true,"kind":"live"}}`.
Dispatch is not confirmation of decoded video or audible HDMI sound.

Rejections expose only an error code: `unsupported`, `invalid_request`,
`no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`,
`policy_denied`, `busy`, `playback_failed` or `context_changed`. References are
bounded; the receiver rejects additional fields. Use scoped operator permissions
for export/import and protect the controller connection. Source identity is an
opaque matching key, not a transferable access credential.

Run `node tests/test_remote_handoff.cjs`. See the
[control guide](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md)
for authentication, outcomes and command TTL behavior.

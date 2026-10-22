<a id="explicit-playback-handoff"></a>

# 明示的な再生の引き継ぎ

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[改善点](roadmap-delivery.ja.md)

更新済みのプレーヤーと制御CLIで `ott handoff SOURCE TARGET` を実行します。転送元の再生は継続します。転送先には同じソース／アカウントの設定と、一意で安定したチャンネルIDが必要です。チャンネル参照はバージョン付きのローカル指紋であり、プロバイダーの生の項目IDではありません。従来のM3U行では、正確なストリームURLをローカルハッシュの入力としてのみ使用します。そのため、個別に署名または書き換えられたURLは、安全のため一致しない扱いになります。名前のあいまい照合は行わず、認証情報や再生可能なURLも転送しません。バージョン1はM3U、Xtream、Stalkerのライブ／アーカイブに対応します。VOD／シリーズおよび視聴履歴の継続的な同期には対応しません。

`playback_handoff_export` は空のパラメーターを受け取り、`data.handoff` を返します。

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

アーカイブ参照は `kind: "archive"` と整数の `archive_start`（現在の再生位置をUnix秒で表した値）を使用します。`playback_handoff_import` が受け取るのは `{"handoff": ...}` のみです。転送先は指示を送出する前に、カタログの同一性、アーカイブの利用可否、保護者／キオスクのポリシー、および現在の制御所有権を確認します。ストリームは自身のプロバイダー経由で解決します。インポートが受理されると `{"status":"ok","data":{"dispatched":true,"kind":"live"}}` を返します。送出されたことは、動画のデコードやHDMI音声が聞こえることの確認にはなりません。

拒否時に公開するのはエラーコードのみです：`unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`。参照には上限があり、受信側は追加フィールドを拒否します。エクスポート／インポートには範囲を限定したオペレーター権限を使用し、コントローラーへの接続を保護してください。ソース識別子は照合用の不透明なキーであり、移転可能なアクセス認証情報ではありません。

`node tests/test_remote_handoff.cjs` を実行してください。認証、結果、コマンドのTTL動作については、[制御ガイド](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md)を参照してください。

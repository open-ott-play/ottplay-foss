<a id="explicit-playback-handoff"></a>

# 明確移交播放

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[改進](roadmap-delivery.zh-Hant.md)

使用更新後的播放器和控制 CLI，執行 `ott handoff SOURCE TARGET`。來源裝置會繼續播放。目標裝置必須設定相同的來源／帳戶，並具有唯一、穩定的頻道 ID。頻道參照是帶有版本的本機指紋，絕不是供應商的原始項目 ID。傳統 M3U 列僅將完整正確的串流 URL 用作本機雜湊輸入。因此，獨立簽署或改寫的 URL 會基於安全考量無法配對。不進行模糊名稱比對，也不傳輸憑證或可播放的 URL。版本 1 支援 M3U、Xtream 和 Stalker 的直播／回看；不支援 VOD／影集或持續同步觀看紀錄。

`playback_handoff_export` 接受空白參數，並傳回 `data.handoff`：

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

回看參照使用 `kind: "archive"` 和整數 `archive_start`（以 Unix 秒表示的目前播放位置）。`playback_handoff_import` 只接受 `{"handoff": ...}`。目標裝置在送出指令前，會檢查目錄身分、回看可用性、家長／資訊站原則及目前的控制擁有權。它透過自己的供應商解析串流。接受匯入後會傳回 `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`。送出指令不代表已確認影片成功解碼或能聽到 HDMI 聲音。

拒絕時僅公開錯誤碼：`unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`。參照有大小限制；接收端會拒絕額外欄位。匯出／匯入應使用範圍受限的操作員權限，並保護與控制器的連線。來源身分是用於配對的不透明索引鍵，不是可轉移的存取憑證。

執行 `node tests/test_remote_handoff.cjs`。如需驗證、結果與命令 TTL 行為的資訊，請參閱[控制指南](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md)。

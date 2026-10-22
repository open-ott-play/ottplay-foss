<a id="explicit-playback-handoff"></a>

# 显式移交播放

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[改进](roadmap-delivery.zh-Hans.md)

使用更新后的播放器和控制 CLI，运行 `ott handoff SOURCE TARGET`。源设备会继续播放。目标设备需要配置相同的来源／账户，并具有唯一、稳定的频道 ID。频道引用是带版本的本地指纹，绝不是提供商的原始条目 ID。经典 M3U 行仅将完整准确的流 URL 用作本地哈希输入。因此，独立签名或重写的 URL 会出于安全考虑无法匹配。不进行模糊名称匹配，也不传输凭据或可播放的 URL。版本 1 支持 M3U、Xtream 和 Stalker 的直播／回看；不支持 VOD／剧集或持续同步观看历史。

`playback_handoff_export` 接受空参数，并返回 `data.handoff`：

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

回看引用使用 `kind: "archive"` 和整数 `archive_start`（以 Unix 秒表示的当前播放位置）。`playback_handoff_import` 仅接受 `{"handoff": ...}`。目标设备在发出指令之前，会检查目录身份、回看可用性、家长／自助终端策略以及当前的控制所有权。它通过自身的提供商解析流。接受导入后返回 `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`。发出指令不代表已确认视频成功解码或能听到 HDMI 声音。

拒绝时只公开错误码：`unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`。引用有大小限制；接收方会拒绝额外字段。导出／导入应使用范围受限的操作员权限，并保护与控制器的连接。来源身份是用于匹配的不透明键，不是可转移的访问凭据。

运行 `node tests/test_remote_handoff.cjs`。有关身份验证、结果和命令 TTL 行为，请参阅[控制指南](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md)。

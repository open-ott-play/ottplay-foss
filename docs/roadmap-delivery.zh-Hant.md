# 可靠性與媒體功能改進

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.zh-Hant.md) · [架構](architecture.md)

本指南描述的是本頁對應原始碼修訂版中的實現，而不是舊版已安裝軟體的能力。播放器、控制服務/CLI 和原生 Android 應用是獨立產物。更新其中一個不會更新其他產物。

![職責與信任邊界](diagrams/roadmap-components.svg)

參見[實測位元組開銷與對比圖](roadmap-size.zh-Hant.md)；執行速度和裝置播放是獨立的驗收專案。

<a id="what-is-implemented"></a>

## 已實現的功能

1. **已知的音影片樣本。** [資訊 → 音訊](audio-video-check.zh-Hant.md)從 here.now 播放八秒短片（需要網際網路），包含左右聲道音調和對應閃光。只有選擇**播放**才會獲取，啟動時不會載入；播放器軟體包不包含該媒體檔案。它僅在空閒或觀看直播時臨時借用主 HTML5 解碼器，不寫入觀看歷史。[樣本規格](../diagnostics/README.md)。
2. **可恢復的 Local/Home 設定。** 控制 CLI 可以規劃、應用、繼續和驗證預設。在重試結果不確定的寫入之前，它會比較已儲存的設定。[控制流程](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md)。
3. **有界的播放恢復。** HLS/Shaka 的暫時故障共享有限的恢復策略。身份驗證錯誤和不支援的 DRM 會終止請求。Stop、換臺和更換來源會取消過時的工作。
4. **儲存的質量限制。** 最大高度和位元速率約束自適應選擇；回退到原生播放不得悄悄繞過正在生效的上限。
5. **原生 Android 音軌偏好。** 獨立 Android 應用按語言/角色/標籤記住使用者意圖，包括 Auto 和關閉字幕，而不是沿用其他流的軌道索引。
6. **限定範圍的命令操作員。** 控制器可以授予憑據訪問特定裝置/操作的許可權，而無需交出管理員憑據。
7. **顯式 XMLTV 繫結。** 播放列表範圍內的頻道可以繫結到特定資料來源和 XMLTV ID。[節目指南繫結與無障礙](guide-binding-accessibility.zh-Hant.md)。
8. **Xtream 電影與劇集。** 媒體庫按需獲取所選目錄，然後獲取某個劇集的分集。[媒體庫契約](xtream-media.zh-Hant.md)。
9. **無障礙經典控制元件。** 頻道列表提供選擇語義；模態對話方塊保持並恢復鍵盤焦點；通知使用動態播報區域。
10. **持久的命令結果。** 控制器可選的有界日誌保留去重和結果後設資料。重啟絕不會盲目重放命令。
11. **顯式裝置接力。** 直播/回看引用傳遞到配置了相同來源的播放器。目標自行解析 URL。[契約](remote-handoff.zh-Hant.md)。
12. **顯式備用流。** 直播頻道可以在同一有限恢復策略內使用已配置的替代地址。[限制、恢復與備用流](playback-stream-policy.zh-Hant.md)。
13. **可恢復的設定批次。** 原生 localStorage 對支援的多鍵寫入使用撤銷日誌。[儲存保證](settings-recovery.zh-Hant.md)。

<a id="language-and-compatibility-coverage"></a>

## 語言與相容性覆蓋

播放器隨附 88 個翻譯目錄。七個新增質量/媒體標籤在每個目錄中均已翻譯；其他新選單複用已有譯文。目錄檢查覆蓋鍵一致性、預留位置和已稽核的例外。配套工程指南以[24 種文件語言](manual-translations.md)說明同樣的實現限制。[本地化入口](readme/README.md)是快速入門指南，並不表示每份歷史工程文件都有 88 種完整譯文。

經典輸出仍使用 ES5 語法。這不代表每臺裝置都支援所有編解碼器、Web API、儲存保證或原生整合。A/V 預覽僅限主託管 HTML5 路徑；PC2/Video.js 和原生引擎等裝置引擎替代實現被排除。顯式節目指南繫結使用託管或原生 XMLTV 實現；可選的外部 companion 協議可能不支援。針對裝置的驗收仍需要真實裝置。

<a id="reproduce-the-checks"></a>

## 復現檢查

```sh
npm ci
npm run typecheck
npm run test:localization
npm test
npm run build:server
npm run check:es5
npm run check:size
python3 scripts/check-av-diagnostic.py diagnostics/av-v1.mp4
```

媒體驗證器需要 FFmpeg/FFprobe。它解碼兩個聲道並檢查能量、聲道分離和靜音；僅有 AAC 軌道不代表有可聽內容。常規 JavaScript 測試覆蓋取消、寫入失敗、重啟恢復、來源變化和無效輸入。最終打包檢查包含可選提供商系列，而不僅是主入口。

在控制器中執行 `go test -race ./...`、`go vet ./...` 和 `python3 -m unittest discover -s tests`。在原生 Android 中執行軌道偏好和設定備份的單元測試，並建置除錯 APK。每個儲存庫的 CI 只對相應提交具有證明力，不對之後修改過的程式碼樹負責。

<a id="physical-acceptance-before-promotion"></a>

## 晉級釋出前的實機驗收

- 在目標電視上執行 A/V 檢查，確認左右聲道、可見閃光、Stop 和返回直播。解碼器測試無法證明 HDMI 聲音或播放流暢度。
- 測試允許/拒絕的流、失效備用流，以及等待重試時切換頻道。在實際後端確認所選質量限制。
- 使用鍵盤、遙控器和可用的螢幕閱讀器檢查列表/對話方塊焦點。
- 將兩個相似頻道名繫結到不同 XMLTV ID，並驗證節目資料。
- 中斷測試預設的應用，重啟控制器、繼續並驗證。分別向配置匹配和不匹配的來源進行接力。
- 在原生 Android 上切換軌道順序不同的流，重啟應用，並確認顯式 Auto/Off 和首選語言行為。

傳送成功、設定儲存、樣本解碼和單元測試透過是不同的證據。釋出晉級必須保留這一區別；參見[釋出策略](../RELEASING.md)。

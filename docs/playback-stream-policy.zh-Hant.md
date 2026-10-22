# 畫質限制與直播流恢復

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[解碼器所有權](device-media-backend.md)

託管 HTML5/HLS/Shaka 播放器在故障來源恢復過程中保留唯一的播放租約。它還可為直播頻道使用最多三個顯式配置的備用 URL。絕不會按頻道名稱自動發現、猜測或替換頻道。

![恢復流程：一個租約、有限重試、顯式備用流](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## 設定畫質上限

開啟**設定 → 介面設定**，設定**最大影片高度（HLS/Shaka）**和/或**最大流位元速率（HLS/Shaka）**。兩項約束同時生效。**自動**會移除對應約束。支援 360/480/720/1080/2160 畫素和 1/2/4/8/16 Mbps。設定儲存在本地，遵循普通的儲存/取消流程，並在下一次開始播放時生效，包括恢復時的重啟。

這些是上限，不是轉碼設定。只有 1080p 的流不能變成 720p。如果沒有宣告的變體符合條件，播放器會報告 **No stream meets the quality limits** 並停止重試該請求。未知的高度/位元速率不能證明受限 HLS 變體符合條件。

HLS 變體過濾在載入分片之前進行。當前 hls.js 會移除不合格變體；不支援 `removeLevel` 的舊版本只能保留安全、連續的列表字首，可能拒絕後面仍有合格變體的清單。Shaka 使用應用級 `maxHeight`/`maxBandwidth` 限制。自動適應會在剩餘變體之間繼續。

這些設定適用於託管 HLS 和 Shaka 引擎。普通 HTML5、平臺原生解碼器以及保留的 TV/STB 引擎不提供同樣的控制。Auto 模式可以選擇原生播放；該設定不會強制改用 MSE。播放器不會只為避開解碼錯誤，就把已受限的 HLS 請求切換到不受限的原生播放。這不意味著存在原生轉碼器、自動硬體基準測試，也不宣告物理輸出為 720p。

<a id="configure-explicit-backups"></a>

## 配置顯式備用流

1. 開始播放目標直播頻道。
2. 開啟**資訊 → 備用流**。
3. 選擇槽位 1、2 或 3，輸入完整 HTTP/HTTPS 媒體 URL。
4. 重新開啟已有槽位即可**編輯**或**刪除**。重新開始播放該頻道以使用更新後的列表。

每個槽位屬於當前提供商的儲存名稱空間及精確的 `sourceId`/`channelId` 對。當前播放代次與來源配置限制編輯器的作用範圍。對話方塊開啟時切換來源，會阻止該對話方塊向替換後的來源儲存。同一槽位的併發更改會被拒絕，而不是被覆蓋。

第一個 URL 仍是頻道的常規來源。重複和空槽位會跳過。最多接受 256 條頻道記錄和 256 KiB 配置。含 user-info 憑據、空白、控制字元、反斜槓或無效埠的 URL 會被拒絕。提供商的查詢令牌仍可作為媒體 URL 的組成部分：備用設定是本地來源配置，不是分享或公開憑據的機制。

備用流**僅適用於直播**。回看與 VOD 請求絕不會使用直播替代：錄影、時間原點、許可權和定位語義可能不同。所有者必須提供等價且獲授權的直播端點。頻道名稱相同並不能證明等價。傳輸端點變化時，已儲存的頻道身份、收藏和 EPG 繫結保持不變。

<a id="recovery-guarantees"></a>

## 恢復保證

- 每個請求合計最多有**兩次延遲的同 URL 臨時錯誤重試**，並最多向三個備用槽位各前進一次：初次啟動後最多重新建立五次。新的解碼器例項或成功的清單不會重置預算。引擎內部已有的有限 HLS 網路和解碼恢復先於這層外部恢復策略執行。
- HLS 清單/層級解析失敗允許每個請求最多一次同 URL 重連，計入相同的兩次重試總數。新解碼器或備用端點不會重置該限制。
- 沒有狀態碼的網路故障、HTTP 408/429 和 5xx 可使用臨時重試預算。其他 HTTP 4xx 可以前進到已配置的替代端點，但不重試同一 URL。**HTTP 401/403 和來源登入錯誤會終止請求**，不會探測其他憑據或備用端點。
- 解碼失敗可以前進到顯式備用流。無法滿足的畫質限制會終止請求。不會迴圈回到主來源。
- 延遲依次為 500 ms、1 s、1.5 s，之後最多 2 s。重複回撥會合並。
- Pause 移除已安排的定時器，但保留待重試操作；Resume 重新安排。Stop、待機、更換來源或頻道會使延遲迴調失效。最終失敗的請求需要顯式重新選擇，而不是自動播放已退役的解碼器。
- Shaka 載入失敗和嚴重錯誤事件共享此路徑；取消錯誤會忽略。重新掛接會等待 Shaka 非同步銷燬完成。
- 恢復時重新解析不透明的 Stalker 引用，並再次準備受保護來源訪問。不會複用已過期的 iOS loopback URL。VOD/回看位置在拆除前取樣；直播備用流從各自當前直播邊緣開始。

該策略不會新增第二個停幀監視器。現有 kiosk、Auto/native 和 HLS 恢復仍處理各自已觀察到的故障。若流靜默停住，且現有檢測器未報告錯誤，需要另行診斷。

<a id="verification-and-observability"></a>

## 驗證與可觀測性

`window.__ottStreamPolicy.snapshot()` 提供引擎名、請求的限制、能力/可用性、重試次數、端點索引和恢復狀態。不含流 URL 或提供商憑據。索引零代表常規來源，後續索引代表非空且唯一的替代端點。這是診斷狀態，不是穩定的遠端控制 API。

執行：

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

測試覆蓋非單調變體順序下的畫質過濾、缺少後設資料、按來源限制編輯、槽位衝突、重複錯誤、有界預算、HTTP 授權失敗、暫停/停止/來源取消、Shaka 拆除和 VOD 位置保留。五個新增播放標籤已在全部 88 個隨附語言包中翻譯；自動一致性檢查不是母語審校。真實 TV/D1 播放和提供商特有清單仍需要裝置驗證。[可編輯圖表原始檔](diagrams/stream-recovery.mmd)。

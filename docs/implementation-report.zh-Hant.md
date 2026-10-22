# 從功能列表到經過驗證的行為

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[功能契約](roadmap-delivery.zh-Hant.md) · [體積證據](roadmap-size.zh-Hant.md)

本報告記錄實現和加固過程，並非釋出公告。測量的播放器快照為 `652726f8`；單獨構建的原生 Android 快照為 `be0d800`。CI、合併和版本晉級仍是獨立關卡。後續僅修改文件或測試的提交，不能把本地檢查變成已安裝裝置得到更新的證明。下列關卡狀態屬於這些歷史快照，並非實時釋出跟蹤。已釋出的構建見 [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases)。

![實現流程及其驗收關卡](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## 如何檢查工作

最初需求被拆為 13 個可用功能單元，分佈在經典播放器、控制服務/CLI 和獨立原生 Android 應用中。按元件分配負責人，以便審查和整合併行更改，而不覆蓋其他元件的工作。新介面複用已有翻譯標籤，或為全部 88 種語言增加目錄條目；完整工程指南最初以英語和俄語編寫。主手冊及成對功能指南現已提供 [24 種文件語言](manual-translations.md)的完整版本。

實現後進行獨立交叉審查和可執行迴歸測試。修改程式碼前，先在實際回撥、解碼器、儲存或焦點路徑上驗證報告的問題。將測試失敗分為行為迴歸和過時的測試選擇器。例如，把經典行從 `button` 改為 `option` 需要更新選擇器，但不能據此放寬預期點選行為。

隨後透過乾淨的生產構建檢查生成的 ES5 產物及完整 JavaScript 體積，包括可選提供方模組。定向瀏覽器測試使用實際交付的載入器、程式碼包和裝置介面卡。原生 Android 單獨執行 Gradle 測試、lint 和打包。推送後還要重新檢查 PR 檢查項及審查討論；本地構建透過不能代替它們。

<a id="what-changed-during-review"></a>

## 審查期間的修改

![五項行為修復與測得的 JavaScript 體積](diagrams/implementation-results.svg)

- **HLS 解析和重試：**解析失敗最初歸入通用網路分類。現在同一 URL 最多重連一次，計入總共兩次臨時故障重試預算；新解碼器和備用 URL 不會重置預算。終止性的認證/DRM 失敗也會取消已經排隊的臨時重試。
- **原生 Auto 回退：**當 Auto 已擁有回退流程時，原生錯誤處理可能提前結束請求。現在由現有所有者保留該轉換；取消仍會使其延遲迴調失效。
- **模態對話方塊 Enter：**自動聚焦第一個取消按鈕，會把 Plex 等待對話方塊中的 Enter 變成取消。現在對話方塊開啟時焦點在對話方塊本身，Tab 明確進入按鈕；普通訊息和確認對話方塊保留 Enter 與 Escape/返回行為。
- **PC 指標選擇：**滑鼠焦點在點選處理器之前改變選擇，導致第一次點選直接啟用。指標觸發的焦點現在不再預選行。PC 仍先選擇再啟用；LG 保持單擊行為。鍵盤焦點仍跟隨選擇。
- **Android 音軌/字幕軌：**目前媒體項目無標籤的選擇可能被自身 Auto 確認或字幕偏好更新擦除，也可能洩漏到具有相同 `TrackGroup` 的另一個媒體項目。現在它只對目前媒體項目在延遲寫入後保留。語義偏好使用語言/角色/標籤；持久化由 ViewModel 擁有，因此關閉面板不會取消寫入。

交付的 13 個單元為：A/V 示例；可恢復的 Local/Home 設定；有界恢復；質量上限；Android 軌道偏好；限定作用域的控制金鑰；XMLTV 繫結；Xtream 電影/劇集；經典介面無障礙；持久命令結果；顯式交接；備用流；可恢復設定批次。[功能指南](roadmap-delivery.zh-Hant.md)定義每項的範圍和限制。

<a id="evidence-and-remaining-gates"></a>

## 證據及剩餘關卡

對於 `652726f8`，五個定向瀏覽器場景均透過：LG webOS 指標導航、LG NetCast 指標導航、PC 兩次點選行為、對話方塊鍵盤語義，以及 Plex 集合/解析/取消/重試。TypeScript、無障礙單元測試夾具、限定範圍的 lint、ES5 和程式碼包預算檢查均透過。該構建的完整瀏覽器執行結果為 **194 項透過、1 項跳過**：原生 HLS 需要 WebKit，而此次使用 Chromium。託管 CI 和約定的合併順序仍是獨立關卡。

修正個別測試夾具後，透過分段恢復執行完成剩餘的 `test:port` 與 `test:unified` 鏈。每個失敗目標均重新執行成功，剩餘命令也成功完成；這並不聲稱進行過一次完整、不間斷的 `npm test`。Android 橋接 CI 中精確的九條命令步驟也在本地透過。

對於 Android `be0d800`，**101 項應用測試和 62 項共享核心測試**在本地透過，debug/release lint、Debug/Release/Full APK 組裝、釋出 bundle 和 androidTest APK 編譯亦透過。編譯插樁測試 APK 不等於在裝置上執行。三項已確認審查意見在 [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68) 中得到答覆和解決。該 PR 透過檢查並以 `5b644b94` 合併；合併後 CI 單獨跟蹤。圖中仍將播放器總體 CI/釋出關卡標為待完成。

完整網頁 JavaScript 總量由原始/gzip **964,459 / 305,344** 位元組變為 **995,858 / 315,207**：**+31,399 / +9,863 位元組**（約 3.26% / 3.23%）。功能候選版為 995,587 / 315,103；後續加固增加 271 / 104。該快照最終主入口為 875,197 / 270,425。參見[基線測量](evidence/roadmap-size-20261015.json)、[最終產物測量](evidence/roadmap-final-size-20261015.json)和[測量方法](roadmap-size.zh-Hant.md)。

這些是歷史 JavaScript 位元組成本，**不是測得的提速**。總量不含媒體引擎、詞典、CSS、圖片和影片。該快照的播放器包另外攜帶了 464,652 位元組的 A/V 片段。[託管變更](audio-video-check.zh-Hant.md)後，`diagnostics/av-v1.mp4` 及其生成器、驗證器仍留在倉庫以便復現，但被排除在 Web/OTTPlay Server、Tauri、Capacitor 和 Docker 包之外。播放器僅在顯式 A/V 檢查時從 here.now 獲取它，該檢查需要網際網路；啟動播放不會獲取它。移除 464,652 原始媒體位元組並不能確定壓縮安裝包的節省量，也不會改變歷史 JavaScript 測量。啟動時間、幀間隔穩定性、記憶體、螢幕閱讀器體驗、真實 HDMI 音訊及提供方行為都需在目標裝置上各自測量。本報告不聲稱有新的實體裝置結果或 beta 釋出。[實體驗收清單](roadmap-delivery.zh-Hant.md#physical-acceptance-before-promotion)與[釋出策略](../RELEASING.md)仍是晉級標準。

<a id="post-beta-integration-and-review"></a>

## Beta 後的整合與審查

beta.4 釋出後，將原始碼 `39287792` 整合到此分支。執行時修訂 `9663b681` 還修復了 HLS 質量限制下恢復到直播邊緣的問題，並使損壞的設定日誌可在正常啟動前恢復。恢復介面阻止賬戶狀態部分載入，支援重試和確認後重置，保留無關 cookie，並防止重置後舊 cookie 設定重新出現。參見[恢復流程](settings-recovery.zh-Hant.md)及其 SVG 圖。

![Beta 後完整 JavaScript 對比](diagrams/post-beta-size.svg)

使用 Node 26.8.2、Rollup 4.64.5 和 Terser 5.51.2 復現兩套原始碼，beta.4 原始碼得到原始/gzip **964,876 / 305,452** 位元組，整合版為 **1,000,388 / 316,600**：**+35,512 / +11,148 位元組**（3.68% / 3.65%）。總量包括所有可選提供方：基線七個、整合版八個。新入口為 879,533 / 271,761。這與上方較早凍結的圖表是獨立比較。

兩個本地生產構建都重新生成五個已跟蹤執行時檔案，並省略乾淨原始碼修訂宣告。報告記錄該限制，而不是把這些本地檔案當作已釋出產物：[基線](evidence/post-beta-baseline-size-20261015.json)和[整合版](evidence/post-beta-candidate-size-20261015.json)。整合構建與 ES5/原生檢查透過。六個定向瀏覽器檢查也透過：日誌恢復/重置、對話方塊鍵盤行為、LG webOS 與 NetCast 指標輸入、PC 兩次點選選擇，以及有所有者的 Plex 等待。

<a id="browser-gate-integration"></a>

## 瀏覽器關卡整合

![已確認的本地瀏覽器驗證結果](diagrams/browser-verification-results.svg)

原始碼 `c52f4d07` 納入 main `1ecbc0e7` 的 PR 779。保留兩分支的測試命令、恢復檢查和 Plex 對話方塊斷言。TypeScript、lint、文件、打包/連結器契約、生產構建及完整編譯程式碼包檢查透過。生成的全部 27 個播放器/提供方 JavaScript 檔案與上面測量的產物逐位元組一致。該構建的完整裝置瀏覽器測試套件以 **196 項透過、1 項預期 Chromium 跳過**結束；跳過的是需要 WebKit 的原生 HLS 場景。

精確的已打包 Mode A 歸檔只在檢查其來源、校驗和及程式碼包/提供方清單後才解壓。Chromium 156.0.8078.4、Firefox 157.0 和 WebKit 27.2 各自透過全部五個配置場景，沒有跳過或重試：使用 Playwright 1.64.0 共 **15 項本地透過**。實際主機是 macOS 26.7.1，不是所選配置中標註的 `macos-15` runner。憑證明確記錄這一區別，**不構成託管矩陣或釋出資格驗證**。參見[本地摘要](evidence/post779-local-acceptance/summary.json)和[復現步驟](evidence/post779-local-acceptance/reproduce.sh)；後者要求已有生產構建，並拒絕替換已解壓的候選目錄。

[瀏覽器策略](browser-compatibility.zh-Hant.md)要求 PR/beta 檢查覆蓋五個託管目標、執行 25 個場景；完整 RC 為 35 個目標、166 次執行。這是配置要求，並非測得的覆蓋情況。

![候選驗證如何生成證據](diagrams/candidate-verification-flow.svg)

main `1ecbc0e7` 的獨立 [beta 流水線](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467)已成功完成。它不包含此 PR。整合仍需自己的託管 CI 和審查透過，然後協調發布；以上本地結果不聲稱這些交付關卡已經透過。

<a id="delivery"></a>

## 交付

- [播放器、文件和 i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781)。
- [控制伺服器和 CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106)。
- [Android 軌道偏好 — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68)。

這些 PR 承載當前 CI 和合併狀態。播放器變更會作為獨立交付批次，跟隨約定的當前 Plex 修復及其 beta 釋出。

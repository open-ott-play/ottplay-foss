<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# 手動 XMLTV 繫結與鍵盤無障礙操作

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[節目指南架構](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## 不必編輯播放清單即可修復頻道的節目指南

播放受影響的 M3U 頻道，開啟 **資訊 → EPG**，然後編輯 EPG 來源 URL 與 **XMLTV ID**。請輸入 XMLTV 檔案中 `<channel id="…">` 的精確 ID，而非顯示名稱。選擇 **設定** 可儲存繫結並重新載入播放清單。**自動** 會移除此頻道的覆寫設定，並重新載入播放清單的原始對應。單純移動方向鍵不會儲存或重設繫結。返回操作不會更動已儲存的繫結。

此編輯器適用於託管的瀏覽器部署，以及原生 XMLTV 容器（Tauri 與 Capacitor）。它不會覆寫供應商管理的節目指南、明確指定的 `=source` JSON 端點或外部伴隨伺服器。使用遠端伴隨服務的一般舊版瀏覽器仍沿用既有比對協定。第一版接受精確 ID；不會下載或顯示所有 XMLTV 頻道的可搜尋清單。

![手動繫結將播放清單來源與穩定頻道連接到一個 XMLTV 資料來源及精確 ID；否則仍使用一般比對。](images/guide-binding.svg)

繫結儲存播放清單來源指紋、穩定頻道鍵、明確指定的資料來源 URL 與 XMLTV ID。只要頻道身分保持不變，重新命名顯示標籤或變更列順序都不會改變繫結。替換播放清單 URL 或帳戶會變更來源命名空間。對於沒有 `itemId` 的舊式 M3U 項目，系統使用既有的、由 URL 衍生的頻道 ID；變更該 URL 會改變其身分。

所選頻道保留顯示名稱與播放 URL。節目指南查詢只使用一個明確指定的資料來源，不按名稱回退，因此 ID 缺漏時不會悄悄套用其他頻道的節目。根據頻道名稱推斷的自動區域時差不適用於此精確繫結；播放清單中明確設定的 `tvg-shift` 仍然有效。請設定正確的區域 XMLTV ID。如果自訂的 HTTPS 託管資料來源因 CORS 或混合內容規則而無法讀取，一般 EPG 診斷會回報該錯誤。

本機記錄限制為每個來源 500 個繫結、512 KiB；每次載入播放清單只剖析一次，而不是每個頻道剖析一次。寫入時會比較先前的值，並在重新載入前讀回已儲存的結果。延遲到達的編輯器回呼不能儲存至已替換的來源。這是本機偏好設定，並非跨裝置同步。資料來源 URL 可能包含憑證；請勿公開分享儲存匯出檔。

<a id="accessible-classic-controls"></a>

## 傳統控制項的無障礙支援

- 虛擬化主清單提供有名稱的清單方塊、已選取選項、完整項目數與項目的絕對位置。只有已選取且可見的列進入 Tab 順序。方向鍵導覽同時更新視覺選取與語義狀態；清單已有焦點時，換頁後焦點仍跟隨清單。
- 標準資訊/確認對話框、編輯器與關於面板提供模態角色及本地化名稱。Tab 與 Shift+Tab 在前景模態視窗內循環。關閉巢狀模態視窗時，會回到仍可見的父層控制項；已過期的排程開啟操作無法在關閉後搶走焦點。
- 資訊與確認訊息描述其對話框。暫時通知使用禮貌播報的狀態區域。
- 所有新增標籤均來自既有翻譯目錄。XMLTV 與 ID 是協定識別碼；頻道名稱與資料來源主機名稱仍屬來源中繼資料。

應用程式保留遙控器操作路徑與 ES5 語法。語義 DOM 檢查不代表完整的 WCAG 認證：裝置特定焦點、VoiceOver/TalkBack 語音與電視瀏覽器行為仍需實機測試。

<a id="verification"></a>

## 驗證

執行：

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

也應在整合分支上執行一般建置、ES5 與套件大小檢查。瀏覽器檢查應涵蓋：跨頁的長清單；巢狀確認；編輯時替換來源；正確、缺漏及已移除的繫結；以及 EPG 下載失敗。原生 Android 應用程式的語義軌道偏好設定在其獨立儲存庫中實作，與這些傳統控制項相互獨立。

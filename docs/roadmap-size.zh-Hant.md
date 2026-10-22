<a id="measured-javascript-cost"></a>

# JavaScript 成本實測

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[功能指南](roadmap-delivery.zh-Hant.md) · [原始依據](evidence/roadmap-size-20261015.json)

![使用相同工具鏈比較播放器全部 JavaScript](diagrams/roadmap-size.svg)

本頁保留以下原始碼快照的 JavaScript 測量結果。它們不衡量目前修訂版、安裝套件或網路流量。

初次比較中，主入口加上所有選用供應商系列合計增加 **31 128 原始位元組 / 9 759 gzip 位元組**，約 **3.23% / 3.20%**。這是功能成本增加，並非宣稱體積或執行速度改善。Xtream 仍採隨需載入；將其移出入口不會把它排除於總量之外。

測量使用 Node 26.8.2、TypeScript 5.9.3、Terser 5.51.2 與 zlib 1.2.12，比較乾淨的原始碼封存 `bbf9ca7b` 及 `cae971da`，兩者均為 1.1.55 版。它使用正式環境的 ES5 組裝器、最佳化工具、命名政策與正確的乾淨原始碼識別資訊。gzip 等級 9 分別套用到每個輸出資源。

- Web 入口：848 092 / 262 392 → 874 926 / 270 321 原始/gzip 位元組。
- Web 入口 + 所有供應商：964 459 / 305 344 → 995 587 / 315 103。
- 原生入口：848 050 / 262 460 → 874 884 / 270 372。
- 原生入口 + 所有供應商：964 417 / 305 412 → 995 545 / 315 154。
- 選用 M3U 增加 184 原始 / 82 gzip 位元組；新增 Xtream 為 4 110 / 1 748。其餘六個選用系列逐位元組相同。

片段遷移至 here.now 之前，將 URL 改成從根目錄開始的本機路徑，在這段歷史變更中增加了一個原始 JavaScript 位元組。這不是對後來託管 URL 的測量。有界 HLS 剖析重試修正在同一快照的獨立比較中增加 37 原始 / 36 gzip 位元組（[依據](evidence/parse-recovery-size-20261015.json)）。原生 Auto 交接擁有權修正再增加 101 原始 / 39 gzip 位元組（[依據](evidence/auto-recovery-size-20261015.json)）。無障礙回歸修正前的原始總量因此為 995 726 位元組；最終提交的建置識別資訊與 gzip 位元組數可能改變。準確交付修訂版的權威依據仍為最終 `build/reports/classic-bundle.json` 和 `npm run check:size`。隨後包含指標/對話框焦點修正的乾淨建置 `652726f8`，完整 Web 播放器測得 **995 858 原始 / 315 207 gzip 位元組**（[最終產物依據](evidence/roadmap-final-size-20261015.json)）。入口為 875 197 / 270 425；原生總量為 995 816 / 315 259。該快照上限保留先前原生環境/Node/發行後綴的餘裕：入口 875 300 原始 / 271 600 gzip；入口加供應商 996 100 / 316 400。

<a id="post-beta-integration"></a>

## Beta 之後的整合

![beta.4 整合後的全部 JavaScript](diagrams/post-beta-size.svg)

後續比較使用相同的 Node 26.8.2、Rollup 4.64.5 和 Terser 5.51.2，重現 beta.4 原始碼 `39287792`，對照包含 Plex 整合與損壞設定復原的執行階段 `9663b681`：

- Web 入口：848 315 / 262 443 → 879 533 / 271 761 原始/gzip 位元組。
- Web 入口 + 所有供應商：964 876 / 305 452 → 1 000 388 / 316 600。
- 原生入口 + 所有供應商：964 834 / 305 520 → 1 000 346 / 316 654。
- 完整 Web 負載增加：**35 512 / 11 148 位元組（3.68% / 3.65%）**。

基準計算七個供應商系列；整合版計算八個，包括隨需載入的 Xtream。該快照的入口上限為 879 900 / 273 000，總上限為 1 000 800 / 317 800，為原生環境、Node 與發行識別資訊保留餘裕。兩次本機正式建置都重新產生五個受版本控制的執行階段檔案，並省略乾淨原始碼修訂版的宣稱。這些是本機重現的產物，而非已發行的 beta 二進位檔。工具版本、雜湊及此限制記錄於[基準依據](evidence/post-beta-baseline-size-20261015.json)和[整合依據](evidence/post-beta-candidate-size-20261015.json)。[實作報告](implementation-report.zh-Hant.md#post-beta-integration-and-review)說明修正及驗證。

**範圍：**這些 JavaScript 總量不包括外部媒體引擎、語言字典、CSS、影像與影片。歷史播放器套件還附有 **464 652 位元組的 A/V 片段**，未列入上述總量。目前交付方式與這些測量分開處理：

- **儲存庫：**保留 `diagnostics/av-v1.mp4` 及其產生器和驗證器以便重現。保留原始檔不代表把它納入套件。
- **套件：**Web/OTTPlay Server、Tauri、Capacitor 和 Docker 排除片段。這移除了 464 652 原始媒體資源位元組，不代表壓縮安裝程式實測縮小 464 652 位元組。封存格式及其他建置變更會影響安裝程式大小。
- **網路：**只有使用者啟動 [A/V 檢查](audio-video-check.zh-Hant.md)時，播放器才從 here.now 擷取片段。檢查需要網際網路；啟動播放時不會擷取片段。

上述歷史 JavaScript 測量保持不變。衡量託管 URL 對 JavaScript 或目前安裝程式的影響需要新的比較。88 份本地化 README 是儲存庫文件，不是播放器負載。這次位元組比較不能支持啟動時間、影格率、記憶體或目錄規模效能的宣稱；這些需要在目標裝置上分別測量。

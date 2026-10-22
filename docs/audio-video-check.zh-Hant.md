# 手動音影片檢查

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[流恢復](playback-stream-policy.zh-Hant.md) · [樣本規格](../diagnostics/README.md)

透過**播放器選單 → 資訊 → 音訊 → 播放**，用已知的八秒短片檢查畫面和聲音。這是有聲的 A/V 檢查；首次使用介紹中的移動圖案演示是無聲的。

![A/V 檢查：儲存庫原始檔、託管短片和顯式播放](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## 開始檢查

1. 將電視、揚聲器或耳機設為舒適音量。檢查使用播放器當前音量，並暫時取消其影片靜音；不會提高電視系統音量。
2. 開啟播放器選單，選擇**資訊**、**音訊**，再選擇**播放**。只開啟選單不會下載或播放短片。
3. 觀察螢幕並聆聽下述順序。要提前結束，選擇**資訊 → 音訊 → 停止**。

檢查在播放器空閒、直播正在播放或暫停時使用託管核心 HTML5 播放路徑。它拒絕正在進行的 VOD/回看請求、仍在載入的直播請求以及待機狀態。如果裝置介接程式替換了核心引擎，包括 **PC2/Video.js** 和原生引擎覆蓋，檢查也不可用；僅使用 HTML5 video 元素並不代表介接程式符合條件。拒絕不會替換現有播放。要從空閒狀態測試，請先停止當前請求；這不會在上述介接程式上啟用檢查。選單名稱隨所選介面語言變化。

<a id="what-you-should-see-and-hear"></a>

## 應看到和聽到的內容

背景是移動測試圖案。短暫的白色標記在左上或右上半區閃爍，與輕柔、約 150 ms 的聲音脈衝同步：

- **0–2 秒：**左聲道每秒有一次 440 Hz 脈衝，同時左側標記閃爍。
- **2–4 秒：**右聲道發出 880 Hz 脈衝，同時顯示右側標記。
- **4–6 秒：**兩個聲道都有脈衝，兩個標記同時出現。
- **6–8 秒：**圖案繼續移動，但沒有聲音。這段靜音是有意安排的。

單聲道電視或混縮可能從同一個揚聲器播放兩個聲道。請自行檢查實際螢幕和音訊輸出。播放器不會測量揚聲器輸出，也不會自動給出 A/V 透過/失敗結論。

<a id="where-the-clip-comes-from"></a>

## 短片來源

播放器使用以下絕對 HTTPS 地址：

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

只有選擇**播放**才會請求短片，啟動時絕不預載入。檔案大小為 **464 652 位元組**，影片為 H.264 baseline、640×360 / 25 fps，音訊為 AAC 立體聲。該檔案不包含在 Web、OTTPlay Server、Tauri、Capacitor 或容器軟體包中。[原始檔](../diagnostics/av-v1.mp4)、生成器和驗證器保留在儲存庫裡，但不是已安裝播放器的離線備用方案。

需要網際網路訪問以及到該主機的正常 HTTPS 連線。沒有內建備用檔案或替代診斷 URL。在瀏覽器中開啟上述連結可以幫助檢查檔案是否可用，但不會驗證播放器的解碼器所有權或返回頻道行為。託管服務會接收普通連線資訊；參見[隱私詳情](privacy-policy.md#optional-hosted-audio-video-check)。

<a id="how-playback-returns"></a>

## 如何返回原來的播放

檢查使用主解碼器，暫時替換直播畫面。短片結束、選擇**音訊 → 停止**或發生媒體錯誤時結束。**從檢查被接受時起，15 秒安全期限開始計時**，載入也計入期限；因此下載緩慢時，可能尚未播完八秒就結束。

在這些路徑上，只有儲存的直播請求仍屬於當前來源、且沒有替代播放接管時，播放器才嘗試在當前直播邊緣恢復該請求，包括其暫停狀態。直播 URL 會重新解析，恢復仍依賴提供商和網路。從空閒開始的檢查會返回空閒。

普通播放的 **Stop** 命令、待機或選擇其他頻道會取消檢查，不重新啟動儲存的頻道。更換來源或其會話也會防止過時的恢復。退出時檢查會撤銷自己臨時取消靜音的操作；如果執行中手動靜音，該靜音仍然有效。它不會改變儲存的引擎偏好，不會把測試秒數寫入頻道歷史，也不會向作業系統釋出虛假的頻道完成事件或測試後設資料。

<a id="if-the-result-is-unexpected"></a>

## 結果不符合預期時

- **檢查無法啟動：**確認播放器空閒，或在已播放/暫停的直播頻道上使用託管核心 HTML5 路徑，且沒有裝置引擎覆蓋。不支援的狀態或媒體錯誤可能顯示 **“Stream could not be played”**。
- **沒有載入，或檢查提前關閉：**檢查網際網路和直接 HTTPS 連結。網路錯誤或期限到期不代表解碼器或揚聲器損壞。恢復連線後再選擇播放。
- **有畫面但無聲音：**最後兩秒有意靜音。前六秒內，請檢查播放器靜音/音量、電視音量和所選音訊輸出，以及揚聲器/耳機連線。
- **只有一個實際揚聲器發聲：**先檢查電視是否使用單聲道輸出或混縮，再判斷是否是聲道路由故障。

這是透過託管核心 HTML5 畫面/聲音路徑對已知 MP4 進行的短時檢查。它不證明提供商流、HLS/DASH、DRM、多聲道音訊或更高解析度播放能夠工作，也不測量網路容量或同步延遲。畫質上限和直播備用流設定不會改變此診斷短片。

所有權和清理行為由 [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) 和 [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs) 覆蓋。自動解碼和生命週期檢查不能代替在真實裝置上觀看、聆聽；本指南不宣告任何新的實機測試結果。

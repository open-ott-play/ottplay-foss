# 音声と映像の手動確認

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[ストリーム復旧](playback-stream-policy.ja.md) · [テスト素材の仕様](../diagnostics/README.md)

**プレイヤーメニュー → 情報 → 音声 → 再生**で、既知の 8 秒クリップを使って映像と音声を確認します。こちらが音の出る A/V チェックです。初回案内の動くパターンのデモは無音です。

![A/V チェック：リポジトリの素材、ホストされたクリップ、明示的な再生](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## 確認を開始する

1. テレビ、スピーカー、ヘッドホンを聞きやすい音量に設定します。確認はプレイヤーの現在の音量を使い、その動画のミュートを一時解除します。テレビのシステム音量は上げません。
2. プレイヤーメニューから**情報**、**音声**、**再生**の順に選びます。メニューを開くだけではクリップをダウンロードも再生もしません。
3. 画面を見て、以下の順序の音を聞きます。途中で終えるには**情報 → 音声 → 停止**を使います。

確認は、プレイヤーがアイドル状態、またはライブ TV が再生中か一時停止中の場合に、管理されたコア HTML5 再生経路を使います。実行中の VOD/アーカイブ要求、まだ読み込み中のライブ要求、スタンバイでは拒否します。**PC2/Video.js** やネイティブエンジンへの置き換えなど、機器アダプターがコアエンジンを置き換える場合も利用できません。HTML5 video 要素を使っているだけでは対象になりません。拒否しても既存の再生は置き換えません。アイドル状態から試すには、まず現在の要求を停止してください。ただし、それで上記アダプターの確認が有効になるわけではありません。メニューの表記は選択された表示言語に従います。

<a id="what-you-should-see-and-hear"></a>

## 見えるものと聞こえるもの

背景は動くテストパターンです。上部の左半分または右半分に短い白い印が点滅し、約 150 ms の静かな音のパルスと同期します。

- **0–2 秒：**毎秒、左チャンネルに 440 Hz のパルスが鳴り、左の印が点滅します。
- **2–4 秒：**右チャンネルに 880 Hz のパルスが鳴り、右の印が点滅します。
- **4–6 秒：**両チャンネルにパルスが鳴り、両方の印が点滅します。
- **6–8 秒：**パターンは無音で動き続けます。この無音は意図したものです。

モノラルのテレビやダウンミックスでは、1 つのスピーカーから両チャンネルが出る場合があります。物理的な画面と音声出力は自分で確認してください。プレイヤーはスピーカー出力を測定せず、自動の A/V 合否判定も行いません。

<a id="where-the-clip-comes-from"></a>

## クリップの取得元

プレイヤーは次の絶対 HTTPS アドレスを使います。

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

**再生**を選んだときだけ要求し、起動時には先読みしません。ファイルは **464 652 バイト**で、640×360 / 25 fps の H.264 baseline 映像と AAC ステレオ音声です。Web、OTTPlay Server、Tauri、Capacitor、コンテナの各パッケージから除外されています。[元ファイル](../diagnostics/av-v1.mp4)、生成器、検証器はリポジトリに残りますが、インストール済みプレイヤーのオフライン代替ではありません。

インターネット接続と当該ホストへの正常な HTTPS 接続が必要です。同梱の代替や別の診断 URL はありません。上記リンクをブラウザーで開くとファイルの可用性を確認できますが、プレイヤーのデコーダー所有権やチャンネルへの復帰動作は確認できません。ホスティングサービスは通常の接続情報を受け取ります。[プライバシーの詳細](privacy-policy.md#optional-hosted-audio-video-check)を参照してください。

<a id="how-playback-returns"></a>

## 再生への復帰

確認はメインデコーダーを使い、ライブ映像を一時的に置き換えます。クリップ終了、**音声 → 停止**、メディアエラーのいずれかで終了します。**確認が受け付けられた時点から 15 秒の安全期限が始まり**、読み込み時間も含みます。そのため、ダウンロードが遅いと 8 秒全部を再生する前に終了する場合があります。

これらの場合、記録したライブ要求が現在のソースに属し、別の再生に引き継がれていないときに限り、プレイヤーは一時停止状態も含めてライブの現在位置に復帰を試みます。ライブ URL は再解決され、復帰の成否は引き続きプロバイダーとネットワークに依存します。アイドル状態から始めた確認はアイドル状態に戻ります。

通常の再生 **Stop** コマンド、スタンバイ、別チャンネルの選択は、記録したチャンネルを再起動せずに確認を取り消します。ソースやそのセッションの変更も古い復帰を防ぎます。終了時には確認による一時的なミュート解除を元に戻しますが、実行中に自分でミュートした場合はそのミュートが維持されます。保存されたエンジン設定を変えず、テストの秒数をチャンネル履歴に書き込まず、誤ったチャンネル完了やテスト用メタデータを OS に通知しません。

<a id="if-the-result-is-unexpected"></a>

## 期待どおりでない場合

- **確認を開始できない：**管理されたコア HTML5 経路を使い、機器によるエンジン置き換えなしで、アイドル状態または既に再生中/一時停止中のライブチャンネルであることを確認します。未対応状態やメディアエラーで **“Stream could not be played”** が表示される場合があります。
- **読み込まれない、または早く閉じる：**インターネット接続と直接 HTTPS リンクを確認します。ネットワークエラーや期限切れはデコーダーやスピーカーの故障を意味しません。接続を回復してから再び再生してください。
- **映像はあるが音がない：**最後の 2 秒は意図的に無音です。最初の 6 秒でプレイヤーのミュート/音量、テレビの音量と選択された音声出力、スピーカー/ヘッドホンの接続を確認します。
- **物理スピーカーが片方だけ鳴る：**チャンネル配線の不具合と判断する前に、テレビがモノラル出力やダウンミックスを使っていないか確認します。

これは既知の MP4 を、管理されたコア HTML5 の映像/音声経路で短く確認するものです。プロバイダーストリーム、HLS/DASH、DRM、多チャンネル音声、高解像度再生の動作を証明せず、ネットワーク容量や同期遅延も測定しません。画質上限とライブ予備ストリーム設定は、この診断クリップに影響しません。

所有権と後処理は [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) および [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs) で検証します。自動デコード・ライフサイクル確認は実機で見聞きする代わりにはなりません。このガイドは新しい実機結果を主張しません。

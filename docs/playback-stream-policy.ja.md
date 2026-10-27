# 画質制限とライブストリームの復旧

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[デコーダーの所有権](device-media-backend.md)

管理された HTML5/HLS/Shaka プレイヤーは、障害が起きたソースから復旧する間も 1 つの再生リースを維持します。ライブチャンネルには、明示的に設定した予備 URL を最大 3 つ使用できます。チャンネル名から自動発見、推測、置換することはありません。

![復旧フロー：1 つのリース、有限の再試行、明示的な予備](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## 画質上限を設定する

**設定 → インターフェース設定**で、**最大映像高さ（HLS/Shaka）**、**最大ストリームビットレート（HLS/Shaka）**の一方または両方を設定します。2 つの制約は同時に適用されます。**自動**は該当する制約を解除します。選択肢は 360/480/720/1080/2160 ピクセルと 1/2/4/8/16 Mbps です。設定はローカルに保存され、通常の保存/取消フローに従い、復旧による再起動を含む次の再生開始時から有効になります。

これは上限であり、トランスコード設定ではありません。1080p しかないストリームは 720p にはなりません。公開されたバリアントに適合するものがなければ、プレイヤーは **No stream meets the quality limits** と報告してその要求の再試行を止めます。高さ/ビットレートが不明なことは、制限付き HLS バリアントが適合する証拠にはなりません。

HLS バリアントはフラグメントを読み込む前に絞り込みます。現行 hls.js は不適合なバリアントを削除します。`removeLevel` がない旧ビルドでは、安全な連続した先頭部分しか残せず、後方に適合バリアントがあるマニフェストも拒否する場合があります。Shaka はアプリケーションの `maxHeight`/`maxBandwidth` 制限を使用します。自動適応は残ったバリアント間で続きます。

この設定は管理された HLS と Shaka エンジンに適用されます。通常の HTML5、プラットフォームのネイティブデコーダー、維持されている TV/STB エンジンは同じ制御を公開しません。Auto はネイティブ再生を選ぶ場合があり、この設定で MSE を強制するわけではありません。プレイヤーはデコードエラーを避けるためだけに、既に制限された HLS 要求を無制限のネイティブ再生へ切り替えません。ネイティブトランスコーダー、自動ハードウェア測定、物理的な 720p 出力を意味するものではありません。

<a id="configure-explicit-backups"></a>

## 明示的な予備を設定する

1. 対象のライブチャンネルを再生します。
2. **情報 → 予備ストリーム**を開きます。
3. スロット 1、2、3 のいずれかを選び、完全な HTTP/HTTPS メディア URL を入力します。
4. 使用中のスロットを再度開くと**編集**または**削除**できます。更新したリストを使うにはチャンネルを再生し直します。

各スロットは現在のプロバイダーの保存名前空間と、正確な `sourceId`/`channelId` の組に属します。現在の再生世代とソース設定が編集対象を制限します。ダイアログが開いたままソースを変えると、そのダイアログは交換後のソースへ保存できません。同じスロットへの同時変更は上書きせず拒否します。

最初の URL はチャンネルの通常ソースのままです。重複と空のスロットは飛ばします。最大 256 チャンネルレコードと 256 KiB の設定を受け付けます。user-info 資格情報、空白、制御文字、バックスラッシュ、不正なポートを含む URL は拒否します。プロバイダーのクエリトークンはメディア URL に含められます。予備設定はローカルなソース設定であり、資格情報を共有・公開する仕組みではありません。

予備は**ライブ専用**です。アーカイブと VOD 要求にライブ代替を使うことはありません。録画、時間の起点、権利、シークの意味が異なる場合があるためです。所有者は同等で許可されたライブ接続先を指定する必要があります。チャンネル名の一致は同等性の証明ではありません。転送接続先が変わっても保存されたチャンネル識別情報、お気に入り、EPG 紐付けは変わりません。

<a id="recovery-guarantees"></a>

## 復旧の保証

- 要求全体で**同じ URL への遅延付き一時エラー再試行は最大 2 回**、3 つの各予備スロットへの前進は最大 1 回です。最初の開始後の再作成は最大 5 回です。新しいデコーダーインスタンスや成功したマニフェストで予算はリセットされません。エンジン内の既存の有限な HLS ネットワーク/デコード復旧が、この外側の方針より先に動作します。
- HLS マニフェスト/レベル解析失敗では、要求あたり同じ URL への再接続を最大 1 回許し、同じ合計 2 回の予算に数えます。新しいデコーダーや予備接続先で上限はリセットされません。
- ステータスのないネットワーク障害、HTTP 408/429、5xx は一時エラー予算を使用できます。その他の HTTP 4xx は設定した代替へ進めますが、同じ URL は再試行しません。**HTTP 401/403 とソースへのサインインエラーは要求を終了**し、別の資格情報や予備接続先を試しません。
- デコード失敗では明示的な予備へ前進できます。満たせない画質制限は要求を終了します。主ソースへ循環して戻りません。
- 遅延は 500 ms、1 s、1.5 s、その後は最大 2 s です。重複するコールバックは統合します。
- Pause は待機中の再試行を保持したまま予定タイマーを削除し、Resume が再設定します。Stop、スタンバイ、ソース置換、チャンネル置換は遅延コールバックを無効にします。最終失敗した要求は、退役したデコーダーを自動再生せず、明示的な再選択を必要とします。
- Shaka の読み込み失敗と重大エラーイベントはこの経路を共有します。取消エラーは無視します。再接続は Shaka の非同期破棄を待ちます。
- 復旧は不透明な Stalker 参照を再解決し、保護されたソースへのアクセスを再準備します。期限切れ iOS ループバック URL は再利用しません。VOD/アーカイブ位置は解体前に取得し、ライブ予備はそれぞれのライブ端から始めます。

ライブのメディアクロック停止に対する任意の復旧機能については、以下で説明します。既存の kiosk、Auto/native、HLS 復旧は、それぞれの対象範囲とエンジンの動作を維持します。

<a id="verification-and-observability"></a>

## 検証と観測

`window.__ottStreamPolicy.snapshot()` はエンジン名、要求した上限、機能/可用性、再試行回数、接続先インデックス、復旧状態を公開します。ストリーム URL やプロバイダー資格情報は含みません。インデックス 0 は通常ソースで、以降は空でない一意な代替です。診断状態であり、安定した遠隔操作 API ではありません。

実行するコマンド：

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

テストは、非単調なバリアント順序の画質フィルター、欠けたメタデータ、ソース限定編集、スロット競合、重複エラー、有限の予算、HTTP 認証失敗、pause/stop/ソースによる取消、Shaka 解体、VOD 位置保持を検証します。5 つの新しい再生ラベルは、同梱の 88 言語パックすべてで翻訳されています。自動の一致検査は母語話者のレビューではありません。実物の TV/D1 再生とプロバイダー固有マニフェストには引き続き実機検証が必要です。[編集可能な図のソース](diagrams/stream-recovery.mmd)。

<a id="live-stall-recovery"></a>

## ライブ停止からの復旧

**設定 → インターフェース設定**で、**ライブ復旧の試行回数**（0–5）と
**ライブ停止のタイムアウト（秒）**（10/15/20/30）を選択します。既定値は 0 回と 15 秒です。
0 にすると、この監視機構だけが無効になります。既存のエンジンエラー復旧は変わりません。
設定には通常の保存/キャンセル操作を使います。

再生の進行を確認した後、メインのライブ再生のメディアクロックが停止すると、
既存の `backend.restart()` を呼び出します。一時停止、シーク、非表示ページ、
オフライン状態、kiosk では監視を中断します。アーカイブ、VOD、PiP レーンは対象外です。
ネイティブ PiP では HTML OSD を非表示にします。チャンネル、ソース、世代の変更は
以前の監視を取り消します。一度も進行しない初期再生には、既存の起動/エラー処理が
引き続き適用されます。デコーダーの交換や短時間の進行では試行回数の上限はリセット
されません。10 秒間連続して進行するとリセットされます。上限に達すると、その停止に
対する監視機構による再起動を打ち切ります。保留中のエンジン復旧が優先され、
終端となる認可/DRM/品質エラーを回避することはできません。
監視するのはメディア時間です。実際の映像表示や、メディアクロックが進み続けている
間のフレームの静止は監視しません。

サブスクリプション不要のスモークテストには、**デモを試す**を選択します。再生が
始まったら、テスト用タブの DevTools で一時的に
`document.getElementById("video").playbackRate = 0` を設定し、後で 1 に戻します。
一時停止は、意図的に停止復旧の対象外としています。

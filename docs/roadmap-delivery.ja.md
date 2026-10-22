# 信頼性とメディア機能の改善

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.ja.md) · [アーキテクチャ](architecture.md)

このガイドは、このページに対応するソースリビジョンの実装を説明します。インストール済みの旧リリースの機能を示すものではありません。プレイヤー、制御サービス/CLI、ネイティブ Android アプリは別々の成果物です。1 つを更新しても他は更新されません。

![責務と信頼境界](diagrams/roadmap-components.svg)

[実測バイトコストと比較グラフ](roadmap-size.ja.md)を参照してください。実行速度と実機再生は別の受け入れ確認です。

<a id="what-is-implemented"></a>

## 実装済みの機能

1. **既知の音声・映像サンプル。** [情報 → 音声](audio-video-check.ja.md)で、左右の音と対応する点滅を含む 8 秒のクリップを here.now から再生します（インターネットが必要）。取得するのは**再生**を選んだ後だけで、起動時には取得しません。メディアファイルはプレイヤーパッケージに含まれません。アイドル時またはライブ TV 視聴中だけメインの HTML5 デコーダーを一時的に使用し、視聴履歴は書き込みません。[サンプル仕様](../diagnostics/README.md)。
2. **再開可能な Local/Home 設定。** 制御 CLI はプリセットの計画、適用、再開、検証を行えます。結果が不確かな書き込みを再試行する前に、保存済みの設定を比較します。[制御ワークフロー](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md)。
3. **回数を制限した再生復旧。** HLS/Shaka の一時的な障害には共通の有限な復旧ポリシーを使います。認証エラーと未対応 DRM は終了条件です。Stop、チャンネル変更、ソース置換は古い処理を取り消します。
4. **保存される画質制限。** 最大高さとビットレートが適応選択を制限します。ネイティブ再生へのフォールバックで有効な上限を黙って回避してはいけません。
5. **ネイティブ Android のトラック設定。** 独立した Android アプリは、別のストリームのトラック番号を持ち越すのではなく、Auto と字幕 Off を含む言語/役割/ラベルによる意図を記憶します。
6. **範囲を限定したコマンド操作者。** コントローラーは管理者資格情報を渡さずに、特定の機器/操作だけを許可する資格情報を発行できます。
7. **明示的な XMLTV 紐付け。** プレイリスト内のチャンネルを特定のフィードと XMLTV ID に紐付けできます。[番組表の紐付けとアクセシビリティ](guide-binding-accessibility.ja.md)。
8. **Xtream の映画とシリーズ。** メディアライブラリは選択したカタログを必要時に取得し、その後シリーズのエピソードを取得します。[ライブラリ契約](xtream-media.ja.md)。
9. **アクセシブルな従来型操作部。** チャンネル一覧は選択状態の意味を公開し、モーダルダイアログはキーボードフォーカスを保持・復元し、通知はライブリージョンを持ちます。
10. **永続的なコマンド結果。** 任意の上限付きコントローラージャーナルが重複排除と結果のメタデータを保持します。再起動でコマンドを無条件に再実行することはありません。
11. **明示的な機器間引き継ぎ。** ライブ/アーカイブ参照を同じソースが設定されたプレイヤーへ渡します。受信側が自分の URL を解決します。[契約](remote-handoff.ja.md)。
12. **明示的な予備ストリーム。** ライブチャンネルは同じ有限の復旧ポリシー内で設定済みの代替先を利用できます。[制限、復旧、予備](playback-stream-policy.ja.md)。
13. **復旧可能な設定バッチ。** ネイティブ localStorage は、対応する複数キー書き込みに取り消しジャーナルを使用します。[保存の保証](settings-recovery.ja.md)。

<a id="language-and-compatibility-coverage"></a>

## 言語と互換性の範囲

プレイヤーには 88 の翻訳カタログがあります。新しい画質/メディアのラベル 7 個はすべてのカタログで翻訳され、その他の新しいメニューは既存の翻訳済みラベルを再利用します。カタログ検査はキーの一致、プレースホルダー、確認済みの例外を扱います。対応する技術ガイドは同じ実装上の制限を[24 の文書言語](manual-translations.md)で説明します。[ローカライズされた入口](readme/README.md)はクイックスタートであり、過去のすべての技術文書に 88 言語の完全翻訳があるという意味ではありません。

従来型出力は ES5 構文を維持します。すべての機器がすべてのコーデック、Web API、保存保証、ネイティブ連携に対応するという意味ではありません。A/V プレビューは管理されたメイン HTML5 経路だけに限定され、PC2/Video.js やネイティブエンジンなどの機器側の置き換えは対象外です。明示的な番組表の紐付けはホスト型またはネイティブ XMLTV 実装を使用し、任意の外部 companion プロトコルでは未対応の場合があります。機器固有の受け入れには引き続き実機が必要です。

<a id="reproduce-the-checks"></a>

## 確認手順の再現

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

メディア検証には FFmpeg/FFprobe が必要です。両方の音声チャンネルをデコードし、エネルギー、分離、無音を確認します。AAC トラックがあるだけでは聞こえる内容の証明になりません。通常の JavaScript テストは取消、書き込み失敗、再起動後の復旧、ソース変更、不正な入力を検証します。最終バンドル検査にはメインの入口だけでなく任意のプロバイダー群も含まれます。

コントローラーで `go test -race ./...`、`go vet ./...`、`python3 -m unittest discover -s tests` を実行します。ネイティブ Android ではトラック設定と設定バックアップの単体テストを実行し、デバッグ APK をビルドします。各リポジトリの CI が証明するのは該当コミットであり、その後変更されたツリーではありません。

<a id="physical-acceptance-before-promotion"></a>

## リリース昇格前の実機受け入れ

- 対象 TV で A/V チェックを実行し、左右音声、見える点滅、Stop、ライブ TV への復帰を確認します。デコーダーテストは HDMI 音声や滑らかさの証明にはなりません。
- 許可/拒否されるストリーム、失敗する予備、再試行待ち中のチャンネル変更を試します。実際のバックエンドで選択した画質上限を確認します。
- キーボード、リモコン、利用可能なスクリーンリーダーで一覧/ダイアログのフォーカスをテストします。
- 似た名前の 2 チャンネルを別の XMLTV ID に紐付け、番組データを確認します。
- テスト用プリセットの適用を中断し、コントローラーを再起動して再開・検証します。設定が一致するソースと一致しないソースの両方へ引き継ぎます。
- ネイティブ Android でトラック順序の異なるストリームを切り替え、アプリを再起動し、明示的な Auto/Off と優先言語の動作を確認します。

送信成功、保存済み設定、デコード済みサンプル、単体テスト成功は異なる証拠です。リリース昇格でもこの違いを維持する必要があります。[リリース戦略](../RELEASING.md)を参照してください。

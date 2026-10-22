<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# XMLTVの手動関連付けとキーボードアクセシビリティ

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[番組ガイドのアーキテクチャ](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## プレイリストを編集せずにチャンネルの番組ガイドを修正する

対象のM3Uチャンネルを再生し、**Information → EPG** を開いてEPGソースURLと **XMLTV ID** を編集します。XMLTVファイルの `<channel id="…">` にある正確なIDを入力してください。表示名ではありません。**Set** を選ぶと関連付けを保存してプレイリストを再読み込みします。**Automatic** はそのチャンネルの上書きを削除し、元のプレイリストの対応付けを再読み込みします。矢印による移動だけでは、関連付けを保存したりリセットしたりしません。戻る操作は保存済みの関連付けを変更しません。

このエディターは、ホストされたブラウザー版とネイティブXMLTVシェル（TauriとCapacitor）で利用できます。プロバイダー所有のガイド、明示的な `=source` JSONエンドポイント、外部の補助サーバーは上書きしません。遠隔の補助サーバーを使う通常の旧式ブラウザーは既存の照合プロトコルを維持します。初版は正確なIDを受け付ける方式であり、すべてのXMLTVチャンネルを検索できる一覧をダウンロードしたり表示したりしません。

![手動関連付けはプレイリストのソースと安定したチャンネルを1つのXMLTVフィードと正確なIDに接続し、それ以外では通常の照合を維持します。](images/guide-binding.svg)

関連付けには、プレイリストソースの指紋、安定したチャンネルキー、明示的なフィードURL、XMLTV IDを保存します。チャンネルの識別が変わらなければ、表示名や行順を変更しても関連付けは変わりません。プレイリストのURL／アカウントを置き換えるとソースの名前空間が変わります。`itemId` のない従来のM3U項目では既存のURL由来のチャンネルIDを使用するため、そのURLを変えると識別も変わります。

選択したチャンネルは表示名と再生URLを維持します。番組ガイドの検索は1つの明示的フィードを使い、名前によるフォールバックを行いません。そのため、IDが見つからなくても別のチャンネルの番組を黙って借りることはありません。チャンネル名から推測する自動地域時差は、この正確な関連付けには適用しません。プレイリストで明示した `tvg-shift` は引き続き適用します。正しい地域のXMLTV IDを設定してください。独自のHTTPSフィードをCORSや混在コンテンツ規則で読めない場合、通常のEPG診断がその失敗を報告します。

ローカル記録の上限はソースごとに500関連付け、512 KiBです。解析はチャンネルごとではなく、プレイリストを読み込むごとに1回行います。書き込みは前の値を比較し、再読み込み前に保存結果を読み戻します。遅れて届いたエディターのコールバックが置き換え後のソースへ保存することはできません。これはローカル設定であり、デバイス間同期ではありません。フィードURLに認証情報が含まれる可能性があるため、ストレージのエクスポートを公開しないでください。

<a id="accessible-classic-controls"></a>

## アクセシブルな従来の操作部

- 仮想化されたメインリストは、名前付きリストボックス、選択中の項目、全項目数、絶対位置を公開します。Tabで停止するのは、選択され表示中の行だけです。矢印操作は視覚的選択と意味上の状態を更新し、ページの差し替え時にはすでにフォーカスのあるリストにフォーカスが追従します。
- 標準の情報／確認ダイアログ、エディター、Aboutパネルはモーダルの役割とローカライズ済みの名前を公開します。TabとShift+Tabは最前面のモーダル内を循環します。入れ子のモーダルを閉じると、まだ表示されている親の操作部へ戻ります。古い予約済みの開く処理が、閉じた後にフォーカスを奪うことはありません。
- 情報・確認メッセージは各ダイアログを説明します。一時的な通知は、割り込みを抑えた読み上げのステータス領域を使います。
- 追加したラベルはすべて既存の翻訳カタログから供給します。XMLTVとIDはプロトコル識別子であり、チャンネル名やフィードのホスト名は引き続きソースのメタデータです。

アプリケーションはリモコンの操作経路とES5構文を維持します。意味上のDOM検査は完全なWCAG認証を意味しません。機器固有のフォーカス、VoiceOver／TalkBackの音声、TVブラウザーの挙動には引き続き実機テストが必要です。

<a id="verification"></a>

## 検証

次を実行します。

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

統合ブランチでは通常のビルド／ES5／バンドルサイズの検査も行ってください。ブラウザー検査では、ページ境界をまたぐ長いリスト、入れ子の確認、編集中のソース交換、正しい・存在しない・削除済みの関連付け、EPGのダウンロード失敗を確認します。ネイティブAndroidアプリの意味ベースのトラック設定は別リポジトリに実装されており、この従来の操作部とは独立しています。

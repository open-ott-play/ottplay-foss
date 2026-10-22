# 機能一覧から検証済みの動作へ

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[機能の契約](roadmap-delivery.ja.md) · [サイズの根拠](roadmap-size.ja.md)

この報告書は実装と堅牢化の過程を記録するもので、リリース告知ではありません。測定したプレーヤーのスナップショットは `652726f8`、別途ビルドしたネイティブAndroidのスナップショットは `be0d800` です。CI、マージ、リリース昇格は独立した判定段階です。後続のドキュメントのみ、またはテストのみのコミットによって、ローカル確認がインストール済み端末の更新を証明するものになるわけではありません。以下の状態はこれらの過去のスナップショットに属し、現在のリリース追跡ではありません。公開済みビルドは [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases) を参照してください。

![実装工程と受け入れ判定](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## 作業をどのように検証したか

最初の要望を、クラシックプレーヤー、制御サービス/CLI、独立したネイティブAndroidアプリにまたがる13の利用可能な機能単位に分割しました。別コンポーネントの作業を置き換えずに並行変更をレビュー・統合できるよう、コンポーネントごとに担当を割り当てました。新しいUIは既存の翻訳ラベルを再利用するか、全88言語のカタログに項目を追加しました。完全な技術ガイドは当初英語とロシア語で作成しました。現在、主マニュアルと対になった機能ガイドには、[24のドキュメント言語](manual-translations.md)による完全版があります。

実装後には独立した相互レビューと実行可能な回帰テストを行いました。報告された問題はコードを変更する前に、実際のコールバック、デコーダー、ストレージ、フォーカス経路で確認しました。テスト失敗は動作の回帰と古いセレクターに分けました。たとえばクラシック行を `button` から `option` に変える場合はセレクターの更新が必要ですが、期待するクリック動作を弱める理由にはなりません。

続いてクリーンな本番ビルドで、出力されたES5成果物と、任意のプロバイダーモジュールを含むJavaScript全体の負担を確認しました。対象を絞ったブラウザーテストは、配布されるローダー、バンドル、端末アダプターを使いました。ネイティブAndroidには別途Gradleテスト、lint、パッケージ生成を実施しました。プッシュ後はPRチェックとレビュースレッドを再確認します。ローカルビルド成功はその代わりになりません。

<a id="what-changed-during-review"></a>

## レビューで変わった点

![修正した5つの動作と測定済みJavaScriptサイズ](diagrams/implementation-results.svg)

- **HLS解析と再試行：**解析失敗は当初、一般的なネットワーク分類と共通でした。現在は同じURLへの再接続を最大1回に制限し、一時的エラーの再試行総数2回に含めます。新しいデコーダーや予備URLで上限はリセットされません。終端の認証/DRM失敗は、すでに予約済みの一時的再試行もキャンセルします。
- **ネイティブAutoフォールバック：**Autoがすでにフォールバックを所有しているのに、ネイティブエラー処理がリクエストを終了させる場合がありました。現在は既存の所有者がその遷移を維持します。キャンセルは従来どおり遅延コールバックを無効化します。
- **モーダルのEnter：**最初のキャンセルボタンへの自動フォーカスにより、Plex待機ダイアログでEnterがキャンセルになっていました。現在はダイアログ自体にフォーカスを置いて開始します。Tabで明示的にボタンへ移動し、通常の情報・確認ダイアログはEnterとEscape/戻るの動作を維持します。
- **PCのポインター選択：**マウスフォーカスがクリックハンドラーより先に選択を変え、最初のクリックを実行に変えていました。ポインターによるフォーカスは行を事前選択しなくなりました。PCは選択してから実行し、LGは1クリック動作を維持します。キーボードフォーカスは引き続き選択に従います。
- **Androidトラック：**現在の項目のラベルなし選択が、自身のAuto確認や字幕設定の更新で消えたり、同じ `TrackGroup` を持つ別項目へ漏れたりする場合がありました。現在はその項目に限り、遅延書き込み後も維持されます。意味に基づく設定は言語/役割/ラベルを使用し、永続化はViewModelが所有するため、ペインを閉じても書き込みはキャンセルされません。

提供した13単位は、A/Vサンプル、再開可能なLocal/Home設定、回数制限付き復旧、画質上限、Androidトラック設定、範囲を限定した制御キー、XMLTV関連付け、Xtream映画/シリーズ、クラシックのアクセシビリティ、永続的なコマンド結果、明示的な引き継ぎ、予備ストリーム、復旧可能な設定バッチです。[機能ガイド](roadmap-delivery.ja.md)がそれぞれの範囲と制限を定義します。

<a id="evidence-and-remaining-gates"></a>

## 根拠と残りの判定段階

`652726f8` では、LG webOSポインターナビゲーション、LG NetCastポインターナビゲーション、PCの2クリック動作、ダイアログのキーボード意味論、Plexのコレクション/解決/キャンセル/再試行という5つの重点シナリオが成功しました。TypeScript、アクセシビリティ単体フィクスチャ、範囲限定lint、ES5、バンドル容量上限チェックも成功しました。このビルドでの全ブラウザーテストは **194件成功、1件スキップ** でした。ネイティブHLSにはWebKitが必要ですが、この実行はChromiumでした。ホスト型CIと合意したマージ順序は別段階です。

残りの `test:port` と `test:unified` の連鎖は、個別のフィクスチャ修正後、再開した区間ごとに完了しました。失敗した各対象を再実行して成功し、残りのコマンドも成功しましたが、これは単一の連続した `npm test` 実行を主張するものではありません。AndroidブリッジCIの正確な9コマンドのステップもローカルで成功しました。

Android `be0d800` では **アプリ101件と共有コア62件のテスト** がローカルで成功しました。debug/releaseのlint、Debug/Release/Full APK組み立て、リリースバンドル、androidTest APKコンパイルも成功しました。計測テストAPKのコンパイルは端末上での実行ではありません。確認済みのレビュー指摘3件は [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68) で回答・解決されました。このPRはチェックを通過し、`5b644b94` としてマージされました。マージ後CIは別に追跡します。図ではプレーヤー全体のCI/リリース判定を保留のままにしています。

ウェブJavaScript総量はraw/gzipで **964,459 / 305,344** バイトから **995,858 / 315,207** へ変化しました。差は **+31,399 / +9,863バイト**（約3.26% / 3.23%）です。機能候補は995,587 / 315,103で、その後の堅牢化が271 / 104を追加しました。このスナップショットの最終メインエントリーは875,197 / 270,425です。[基準測定](evidence/roadmap-size-20261015.json)、[最終成果物測定](evidence/roadmap-final-size-20261015.json)、[測定方法](roadmap-size.ja.md)を参照してください。

これらは過去のJavaScriptバイトコストであり、**測定済みの高速化ではありません**。総量からメディアエンジン、辞書、CSS、画像、動画は除外しています。そのスナップショットのパッケージには、別途464,652バイトのA/Vクリップが含まれていました。[ホスティング変更](audio-video-check.ja.md)後も、再現性のため `diagnostics/av-v1.mp4` と生成器・検証器はリポジトリに残りますが、Web/OTTPlay Server、Tauri、Capacitor、Dockerのパッケージからは除外されます。インターネットが必要な明示的A/Vチェック時だけhere.nowから取得し、起動時の再生では取得しません。rawメディア464,652バイトの削除から、圧縮インストーラーの削減量は確定できず、過去のJavaScript測定も変わりません。起動時間、フレーム間隔、メモリ、スクリーンリーダー体験、実際のHDMI音声、プロバイダー動作には、対象端末で別の測定が必要です。本報告は新しい実機結果やベータ公開を主張しません。[実機受け入れ一覧](roadmap-delivery.ja.md#physical-acceptance-before-promotion)と[リリース戦略](../RELEASING.md)が引き続き昇格基準です。

<a id="post-beta-integration-and-review"></a>

## ベータ後の統合とレビュー

beta.4公開後、このブランチにソース `39287792` を統合しました。ランタイム修訂 `9663b681` はHLS画質制限下のライブエッジ復帰も修正し、壊れた設定ジャーナルを通常起動前に復旧可能にします。復旧画面はアカウント状態の部分的な取り込みを防ぎ、再試行と確認付きリセットを提供し、無関係なCookieを保ち、リセット後に古いCookie設定が戻るのを防ぎます。[復旧手順](settings-recovery.ja.md)とSVG図を参照してください。

![ベータ後のJavaScript全体比較](diagrams/post-beta-size.svg)

Node 26.8.2、Rollup 4.64.5、Terser 5.51.2で両ソースを再現すると、beta.4ソースはraw/gzip **964,876 / 305,452** バイト、統合版は **1,000,388 / 316,600** になります。差は **+35,512 / +11,148バイト**（3.68% / 3.65%）です。基準の7件、統合版の8件というすべての任意プロバイダーを含みます。新エントリーは879,533 / 271,761です。これは上記の固定済み旧グラフとは別の比較です。

両方のローカル本番ビルドは追跡対象のランタイムファイル5件を再生成し、クリーンなソース修訂という表示を省略します。レポートはこの制限を記録し、ローカルファイルを公開リリース成果物と同一視しません。[基準](evidence/post-beta-baseline-size-20261015.json)と[統合版](evidence/post-beta-candidate-size-20261015.json)を参照してください。統合ビルドとES5/ネイティブチェックは成功します。ジャーナル復旧/リセット、ダイアログキーボード、LG webOSとNetCastのポインター、PCの2クリック選択、所有者付きPlex待機という6つの対象ブラウザーチェックも成功します。

<a id="browser-gate-integration"></a>

## ブラウザー判定の統合

![確認済みのローカルブラウザー検証結果](diagrams/browser-verification-results.svg)

ソース `c52f4d07` はmain `1ecbc0e7` のPR 779を取り込みます。両ブランチのテストコマンド、復旧チェック、Plexダイアログのアサーションを維持します。TypeScript、lint、ドキュメント、パッケージング/リンカー契約、本番ビルド、コンパイル済みバンドル全体チェックが成功します。出力されたプレーヤー/プロバイダーJavaScript全27ファイルは、上記測定成果物とバイト単位で同一です。このビルドの端末ブラウザー全テストは **196件成功、Chromiumで想定内の1件スキップ** となり、対象はWebKitが必要なネイティブHLSです。

正確なパッケージ済みMode Aアーカイブは、ソース、チェックサム、バンドル/プロバイダー一覧の確認後にだけ展開しました。Chromium 156.0.8078.4、Firefox 157.0、WebKit 27.2は各5つのプロファイルシナリオをスキップや再試行なしで通過しました。Playwright 1.64.0で **ローカル15件成功** です。実際のホストはmacOS 26.7.1であり、選択したプロファイルに記載された `macos-15` ランナーではありません。記録はその違いを明示し、**ホスト型マトリクスやリリースの適格性確認ではありません**。[ローカル概要](evidence/post779-local-acceptance/summary.json)と[再現手順](evidence/post779-local-acceptance/reproduce.sh)を参照してください。後者は既存の本番ビルドを前提とし、展開済み候補ディレクトリの置換を拒否します。

[ブラウザーポリシー](browser-compatibility.ja.md)はPR/ベータでホスト型5ターゲットと25シナリオ実行を要求し、完全RCは35ターゲットと166実行です。これは設定された要件であり、測定済みカバレッジではありません。

![候補検証から証拠が生まれる仕組み](diagrams/candidate-verification-flow.svg)

main `1ecbc0e7` 用の別の[ベータパイプライン](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467)は成功しました。これに本PRは含まれません。統合には引き続き独自のホスト型CI成功とレビュー、その後のリリース調整が必要です。上記ローカル結果は、これらの提供段階を通過したと主張しません。

<a id="delivery"></a>

## 提供

- [プレーヤー、ドキュメント、i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781)。
- [制御サーバーとCLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106)。
- [Androidトラック設定 — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68)。

これらのPRが現在のCIとマージ状態を保持します。プレーヤー変更は、合意済みの現行Plex修正とそのベータ公開に続く、別の提供段階になります。

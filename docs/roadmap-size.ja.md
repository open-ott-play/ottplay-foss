<a id="measured-javascript-cost"></a>

# JavaScript の実測コスト

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[機能ガイド](roadmap-delivery.ja.md) · [生の測定資料](evidence/roadmap-size-20261015.json)

![同じツールチェーンによるプレーヤー全体の JavaScript 比較](diagrams/roadmap-size.svg)

このページは、以下のソーススナップショットの JavaScript 測定値を保存しています。現在のリビジョン、インストールパッケージ、ネットワーク通信量を測定したものではありません。

初回比較では、メインエントリーとすべての任意プロバイダーファミリーの合計が **非圧縮 31 128 バイト / gzip 9 759 バイト**、約 **3.23% / 3.20%** 増えました。これは機能追加のコスト増であり、サイズ縮小や実行速度向上の主張ではありません。Xtream は引き続き遅延読み込みです。エントリーから分離しても総量からは除かれません。

測定では、どちらもバージョン 1.1.55 のクリーンなソースアーカイブ `bbf9ca7b` と `cae971da` を、Node 26.8.2、TypeScript 5.9.3、Terser 5.51.2、zlib 1.2.12 で比較しています。本番 ES5 アセンブラー、最適化ツール、命名ポリシー、正しいクリーンソース識別情報を使用します。出力アセットごとに個別に gzip レベル 9 を適用します。

- Web エントリー：848 092 / 262 392 → 874 926 / 270 321 非圧縮/gzip バイト。
- Web エントリー＋全プロバイダー：964 459 / 305 344 → 995 587 / 315 103。
- ネイティブエントリー：848 050 / 262 460 → 874 884 / 270 372。
- ネイティブエントリー＋全プロバイダー：964 417 / 305 412 → 995 545 / 315 154。
- 任意の M3U は非圧縮 184 / gzip 82 バイト増加、新しい Xtream は 4 110 / 1 748 です。他の任意の 6 ファミリーはバイト単位で同一です。

クリップを here.now に移す前、この履歴では URL をルート起点のローカルパスに変えたことで非圧縮 JavaScript が 1 バイト増えました。後のホスト型 URL の測定ではありません。HLS 解析の有限再試行の修正は、同一スナップショットを隔離比較すると非圧縮 37 / gzip 36 バイト増えます（[根拠](evidence/parse-recovery-size-20261015.json)）。ネイティブ Auto 引き継ぎの所有権修正はさらに非圧縮 101 / gzip 39 バイト増えます（[根拠](evidence/auto-recovery-size-20261015.json)）。アクセシビリティ回帰修正前の非圧縮合計は 995 726 バイトです。ビルド識別情報と gzip バイト数は最終コミットで変わり得ます。正確に配布されたリビジョンの判断基準は最終的な `build/reports/classic-bundle.json` と `npm run check:size` です。ポインターとダイアログのフォーカス修正を含む次のクリーンビルド `652726f8` は、Web プレーヤー全体で **非圧縮 995 858 / gzip 315 207 バイト**です（[最終成果物の根拠](evidence/roadmap-final-size-20261015.json)）。エントリーは 875 197 / 270 425、ネイティブ合計は 995 816 / 315 259 です。そのスナップショットの上限は、従来のネイティブ/Node/リリース接尾辞の余裕を維持し、エントリーが非圧縮 875 300 / gzip 271 600、エントリー＋プロバイダーが 996 100 / 316 400 でした。

<a id="post-beta-integration"></a>

## ベータ後の統合

![beta.4 統合後の全 JavaScript](diagrams/post-beta-size.svg)

後の比較では、Plex 統合と破損設定の復旧を含むランタイム `9663b681` に対し beta.4 ソース `39287792` を再現し、同じ Node 26.8.2、Rollup 4.64.5、Terser 5.51.2 を使います。

- Web エントリー：848 315 / 262 443 → 879 533 / 271 761 非圧縮/gzip バイト。
- Web エントリー＋全プロバイダー：964 876 / 305 452 → 1 000 388 / 316 600。
- ネイティブエントリー＋全プロバイダー：964 834 / 305 520 → 1 000 346 / 316 654。
- Web ペイロード全体の増加：**35 512 / 11 148 バイト（3.68% / 3.65%）**。

基準は 7 プロバイダーファミリー、統合版は遅延読み込みの Xtream を含む 8 ファミリーを数えます。そのスナップショットのエントリー上限は 879 900 / 273 000、総量上限は 1 000 800 / 317 800 で、ネイティブ、Node、リリース識別情報の余裕を残しました。両ローカル本番ビルドは追跡対象のランタイムファイル 5 個を再生成し、クリーンソースリビジョンという表示を省きます。これらはローカルで再現した成果物で、公開済みベータのバイナリではありません。ツールのバージョン、ハッシュ、この制限は[基準の根拠](evidence/post-beta-baseline-size-20261015.json)と[統合の根拠](evidence/post-beta-candidate-size-20261015.json)に記録されています。[実装レポート](implementation-report.ja.md#post-beta-integration-and-review)が修正と検証を説明します。

**対象範囲：**これらの JavaScript 合計には外部メディアエンジン、言語辞書、CSS、画像、動画を含みません。過去のプレーヤーパッケージには、上記合計とは別に **464 652 バイトの A/V クリップ**も含まれていました。現在の配布方法はその測定と分けて扱います。

- **リポジトリ：**再現性のため `diagnostics/av-v1.mp4` を生成器と検証器とともに残します。ソースファイルを残してもパッケージに含まれるわけではありません。
- **パッケージ：**Web/OTTPlay Server、Tauri、Capacitor、Docker はクリップを除外します。これにより非圧縮メディアアセット 464 652 バイトを除きますが、圧縮インストーラーが実測で 464 652 バイト縮むという意味ではありません。アーカイブ形式や他のビルド変更がそのサイズに影響します。
- **ネットワーク：**ユーザーが [A/V チェック](audio-video-check.ja.md)を開始したときだけ here.now から取得します。チェックにはインターネットが必要です。起動時の再生のためには取得しません。

上記の過去の JavaScript 測定値は変わりません。ホスト型 URL が JavaScript や現在のインストーラーに与える影響を測るには新しい比較が必要です。88 言語の README はリポジトリ文書であり、プレーヤーのペイロードではありません。このバイト比較から起動時間、フレームレート、メモリ、カタログ規模の性能を主張することはできません。対象機器で別途測定する必要があります。

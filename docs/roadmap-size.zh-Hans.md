<a id="measured-javascript-cost"></a>

# JavaScript 成本实测

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[功能指南](roadmap-delivery.zh-Hans.md) · [原始依据](evidence/roadmap-size-20261015.json)

![使用相同工具链比较播放器全部 JavaScript](diagrams/roadmap-size.svg)

本页保存以下源代码快照的 JavaScript 测量结果。它们不衡量当前修订版、安装包或网络流量。

初次比较中，主入口加上所有可选提供商系列总共增加 **31 128 原始字节 / 9 759 gzip 字节**，约 **3.23% / 3.20%**。这是功能成本的增加，并不代表体积或执行速度有所改善。Xtream 仍按需加载；将其移出入口不会将其排除在总量之外。

测量以 Node 26.8.2、TypeScript 5.9.3、Terser 5.51.2 和 zlib 1.2.12 比较干净的源代码归档 `bbf9ca7b` 与 `cae971da`，两者均为 1.1.55 版。它使用生产 ES5 组装器、优化器、命名规则和正确的干净源码标识。gzip 级别 9 分别应用于每个输出资源。

- Web 入口：848 092 / 262 392 → 874 926 / 270 321 原始/gzip 字节。
- Web 入口 + 所有提供商：964 459 / 305 344 → 995 587 / 315 103。
- 原生入口：848 050 / 262 460 → 874 884 / 270 372。
- 原生入口 + 所有提供商：964 417 / 305 412 → 995 545 / 315 154。
- 可选 M3U 增加 184 原始 / 82 gzip 字节；新增 Xtream 为 4 110 / 1 748。其余六个可选系列逐字节相同。

在片段迁移到 here.now 之前，将其 URL 改为从根目录开始的本地路径，在这段历史变更中增加了一个原始 JavaScript 字节。这不是对后来的托管 URL 的测量。有界 HLS 解析重试修复在同一快照的独立比较中增加 37 原始 / 36 gzip 字节（[依据](evidence/parse-recovery-size-20261015.json)）。原生 Auto 交接所有权修复又增加 101 原始 / 39 gzip 字节（[依据](evidence/auto-recovery-size-20261015.json)）。无障碍回归修复前的原始总量因此为 995 726 字节；最终提交的构建标识和 gzip 字节数可能变化。准确交付修订版的权威依据仍是最终的 `build/reports/classic-bundle.json` 和 `npm run check:size`。随后包含指针/对话框焦点修复的干净构建 `652726f8`，完整 Web 播放器测得 **995 858 原始 / 315 207 gzip 字节**（[最终产物依据](evidence/roadmap-final-size-20261015.json)）。其入口为 875 197 / 270 425；原生总量为 995 816 / 315 259。该快照的上限保留了此前原生环境/Node/发布后缀的余量：入口 875 300 原始 / 271 600 gzip；入口加提供商 996 100 / 316 400。

<a id="post-beta-integration"></a>

## Beta 之后的集成

![beta.4 集成后的全部 JavaScript](diagrams/post-beta-size.svg)

后续比较使用相同的 Node 26.8.2、Rollup 4.64.5 和 Terser 5.51.2，复现 beta.4 源码 `39287792`，并与包含 Plex 集成和损坏设置恢复的运行时 `9663b681` 对照：

- Web 入口：848 315 / 262 443 → 879 533 / 271 761 原始/gzip 字节。
- Web 入口 + 所有提供商：964 876 / 305 452 → 1 000 388 / 316 600。
- 原生入口 + 所有提供商：964 834 / 305 520 → 1 000 346 / 316 654。
- 完整 Web 载荷增加：**35 512 / 11 148 字节（3.68% / 3.65%）**。

基线计算七个提供商系列；集成版计算八个，包括按需加载的 Xtream。该快照的入口上限为 879 900 / 273 000，总上限为 1 000 800 / 317 800，为原生环境、Node 和发布标识保留余量。两次本地生产构建都重新生成五个受版本控制的运行时文件，并省略干净源码修订版声明。这些是本地复现的产物，不是已发布的 beta 二进制文件。工具版本、哈希及此限制记录在[基线依据](evidence/post-beta-baseline-size-20261015.json)和[集成依据](evidence/post-beta-candidate-size-20261015.json)中。[实现报告](implementation-report.zh-Hans.md#post-beta-integration-and-review)解释修复与验证。

**范围：**这些 JavaScript 总量不包括外部媒体引擎、语言词典、CSS、图像和视频。历史播放器包还携带一个 **464 652 字节的 A/V 片段**，未计入上述总量。其当前交付方式与这些测量分开处理：

- **仓库：**保留 `diagnostics/av-v1.mp4` 及其生成器和验证器，以便复现。保留源文件并不意味着将其放入包中。
- **包：**Web/OTTPlay Server、Tauri、Capacitor 和 Docker 排除该片段。这移除了 464 652 原始媒体资源字节，并不代表压缩安装程序实测缩小了 464 652 字节。归档格式和其他构建变化会影响安装程序大小。
- **网络：**仅在用户启动 [A/V 检查](audio-video-check.zh-Hans.md)时，播放器才从 here.now 获取片段。检查需要互联网；启动播放时不会获取该片段。

上述历史 JavaScript 测量值保持不变。测量托管 URL 对 JavaScript 或当前安装程序的影响需要重新比较。88 个本地化 README 是仓库文档，不是播放器载荷。此次字节比较不能支持启动时间、帧率、内存或目录规模性能的声明；这些需要在目标设备上单独测量。

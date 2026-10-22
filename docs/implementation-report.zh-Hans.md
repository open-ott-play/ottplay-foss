# 从功能列表到经过验证的行为

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[功能契约](roadmap-delivery.zh-Hans.md) · [体积证据](roadmap-size.zh-Hans.md)

本报告记录实现和加固过程，并非发布公告。测量的播放器快照为 `652726f8`；单独构建的原生 Android 快照为 `be0d800`。CI、合并和版本晋级仍是独立关卡。后续仅修改文档或测试的提交，不能把本地检查变成已安装设备得到更新的证明。下列关卡状态属于这些历史快照，并非实时发布跟踪。已发布的构建见 [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases)。

![实现流程及其验收关卡](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## 如何检查工作

最初需求被拆为 13 个可用功能单元，分布在经典播放器、控制服务/CLI 和独立原生 Android 应用中。按组件分配负责人，以便审查和整合并行更改，而不覆盖其他组件的工作。新界面复用已有翻译标签，或为全部 88 种语言增加目录条目；完整工程指南最初以英语和俄语编写。主手册及成对功能指南现已提供 [24 种文档语言](manual-translations.md)的完整版本。

实现后进行独立交叉审查和可执行回归测试。修改代码前，先在实际回调、解码器、存储或焦点路径上验证报告的问题。将测试失败分为行为回归和过时的测试选择器。例如，把经典行从 `button` 改为 `option` 需要更新选择器，但不能据此放宽预期点击行为。

随后通过干净的生产构建检查生成的 ES5 产物及完整 JavaScript 体积，包括可选提供方模块。定向浏览器测试使用实际交付的加载器、代码包和设备适配器。原生 Android 单独运行 Gradle 测试、lint 和打包。推送后还要重新检查 PR 检查项及审查讨论；本地构建通过不能代替它们。

<a id="what-changed-during-review"></a>

## 审查期间的修改

![五项行为修复与测得的 JavaScript 体积](diagrams/implementation-results.svg)

- **HLS 解析和重试：**解析失败最初归入通用网络分类。现在同一 URL 最多重连一次，计入总共两次临时故障重试预算；新解码器和备用 URL 不会重置预算。终止性的认证/DRM 失败也会取消已经排队的临时重试。
- **原生 Auto 回退：**当 Auto 已拥有回退流程时，原生错误处理可能提前结束请求。现在由现有所有者保留该转换；取消仍会使其延迟回调失效。
- **模态对话框 Enter：**自动聚焦第一个取消按钮，会把 Plex 等待对话框中的 Enter 变成取消。现在对话框打开时焦点在对话框本身，Tab 明确进入按钮；普通信息和确认对话框保留 Enter 与 Escape/返回行为。
- **PC 指针选择：**鼠标焦点在点击处理器之前改变选择，导致第一次点击直接激活。指针触发的焦点现在不再预选行。PC 仍先选择再激活；LG 保持单击行为。键盘焦点仍跟随选择。
- **Android 音轨/字幕轨：**当前媒体项无标签的选择可能被自身 Auto 确认或字幕偏好更新擦除，也可能泄漏到具有相同 `TrackGroup` 的另一媒体项。现在它只对当前媒体项在延迟写入后保留。语义偏好使用语言/角色/标签；持久化由 ViewModel 拥有，因此关闭面板不会取消写入。

交付的 13 个单元为：A/V 示例；可恢复的 Local/Home 设置；有界恢复；质量上限；Android 轨道偏好；限定作用域的控制密钥；XMLTV 绑定；Xtream 电影/剧集；经典界面无障碍；持久命令结果；显式交接；备用流；可恢复设置批次。[功能指南](roadmap-delivery.zh-Hans.md)定义每项的范围和限制。

<a id="evidence-and-remaining-gates"></a>

## 证据及剩余关卡

对于 `652726f8`，五个定向浏览器场景均通过：LG webOS 指针导航、LG NetCast 指针导航、PC 两次点击行为、对话框键盘语义，以及 Plex 集合/解析/取消/重试。TypeScript、无障碍单元测试夹具、限定范围的 lint、ES5 和代码包预算检查均通过。该构建的完整浏览器运行结果为 **194 项通过、1 项跳过**：原生 HLS 需要 WebKit，而此次使用 Chromium。托管 CI 和约定的合并顺序仍是独立关卡。

修正个别测试夹具后，通过分段恢复运行完成剩余的 `test:port` 与 `test:unified` 链。每个失败目标均重新运行成功，剩余命令也成功完成；这并不声称进行过一次完整、不间断的 `npm test`。Android 桥接 CI 中精确的九条命令步骤也在本地通过。

对于 Android `be0d800`，**101 项应用测试和 62 项共享核心测试**在本地通过，debug/release lint、Debug/Release/Full APK 组装、发布 bundle 和 androidTest APK 编译亦通过。编译插桩测试 APK 不等于在设备上执行。三项已确认审查意见在 [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68) 中得到答复和解决。该 PR 通过检查并以 `5b644b94` 合并；合并后 CI 单独跟踪。图中仍将播放器总体 CI/发布关卡标为待完成。

完整网页 JavaScript 总量由原始/gzip **964,459 / 305,344** 字节变为 **995,858 / 315,207**：**+31,399 / +9,863 字节**（约 3.26% / 3.23%）。功能候选版为 995,587 / 315,103；后续加固增加 271 / 104。该快照最终主入口为 875,197 / 270,425。参见[基线测量](evidence/roadmap-size-20261015.json)、[最终产物测量](evidence/roadmap-final-size-20261015.json)和[测量方法](roadmap-size.zh-Hans.md)。

这些是历史 JavaScript 字节成本，**不是测得的提速**。总量不含媒体引擎、词典、CSS、图片和视频。该快照的播放器包另外携带了 464,652 字节的 A/V 片段。[托管变更](audio-video-check.zh-Hans.md)后，`diagnostics/av-v1.mp4` 及其生成器、验证器仍留在仓库以便复现，但被排除在 Web/OTTPlay Server、Tauri、Capacitor 和 Docker 包之外。播放器仅在显式 A/V 检查时从 here.now 获取它，该检查需要互联网；启动播放不会获取它。移除 464,652 原始媒体字节并不能确定压缩安装包的节省量，也不会改变历史 JavaScript 测量。启动时间、帧间隔稳定性、内存、屏幕阅读器体验、真实 HDMI 音频及提供方行为都需在目标设备上各自测量。本报告不声称有新的实体设备结果或 beta 发布。[实体验收清单](roadmap-delivery.zh-Hans.md#physical-acceptance-before-promotion)与[发布策略](../RELEASING.md)仍是晋级标准。

<a id="post-beta-integration-and-review"></a>

## Beta 后的整合与审查

beta.4 发布后，将源码 `39287792` 整合到此分支。运行时修订 `9663b681` 还修复了 HLS 质量限制下恢复到直播边缘的问题，并使损坏的设置日志可在正常启动前恢复。恢复界面阻止账户状态部分载入，支持重试和确认后重置，保留无关 cookie，并防止重置后旧 cookie 设置重新出现。参见[恢复流程](settings-recovery.zh-Hans.md)及其 SVG 图。

![Beta 后完整 JavaScript 对比](diagrams/post-beta-size.svg)

使用 Node 26.8.2、Rollup 4.64.5 和 Terser 5.51.2 复现两套源码，beta.4 源码得到原始/gzip **964,876 / 305,452** 字节，整合版为 **1,000,388 / 316,600**：**+35,512 / +11,148 字节**（3.68% / 3.65%）。总量包括所有可选提供方：基线七个、整合版八个。新入口为 879,533 / 271,761。这与上方较早冻结的图表是独立比较。

两个本地生产构建都重新生成五个已跟踪运行时文件，并省略干净源码修订声明。报告记录该限制，而不是把这些本地文件当作已发布产物：[基线](evidence/post-beta-baseline-size-20261015.json)和[整合版](evidence/post-beta-candidate-size-20261015.json)。整合构建与 ES5/原生检查通过。六个定向浏览器检查也通过：日志恢复/重置、对话框键盘行为、LG webOS 与 NetCast 指针输入、PC 两次点击选择，以及有所有者的 Plex 等待。

<a id="browser-gate-integration"></a>

## 浏览器关卡整合

![已确认的本地浏览器验证结果](diagrams/browser-verification-results.svg)

源码 `c52f4d07` 纳入 main `1ecbc0e7` 的 PR 779。保留两分支的测试命令、恢复检查和 Plex 对话框断言。TypeScript、lint、文档、打包/链接器契约、生产构建及完整编译代码包检查通过。生成的全部 27 个播放器/提供方 JavaScript 文件与上面测量的产物逐字节一致。该构建的完整设备浏览器测试套件以 **196 项通过、1 项预期 Chromium 跳过**结束；跳过的是需要 WebKit 的原生 HLS 场景。

精确的已打包 Mode A 归档只在检查其来源、校验和及代码包/提供方清单后才解压。Chromium 156.0.8078.4、Firefox 157.0 和 WebKit 27.2 各自通过全部五个配置场景，没有跳过或重试：使用 Playwright 1.64.0 共 **15 项本地通过**。实际主机是 macOS 26.7.1，不是所选配置中标注的 `macos-15` runner。凭证明确记录这一区别，**不构成托管矩阵或发布资格验证**。参见[本地摘要](evidence/post779-local-acceptance/summary.json)和[复现步骤](evidence/post779-local-acceptance/reproduce.sh)；后者要求已有生产构建，并拒绝替换已解压的候选目录。

[浏览器策略](browser-compatibility.zh-Hans.md)要求 PR/beta 检查覆盖五个托管目标、执行 25 个场景；完整 RC 为 35 个目标、166 次执行。这是配置要求，并非测得的覆盖情况。

![候选验证如何生成证据](diagrams/candidate-verification-flow.svg)

main `1ecbc0e7` 的独立 [beta 流水线](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467)已成功完成。它不包含此 PR。整合仍需自己的托管 CI 和审查通过，然后协调发布；以上本地结果不声称这些交付关卡已经通过。

<a id="delivery"></a>

## 交付

- [播放器、文档和 i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781)。
- [控制服务器和 CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106)。
- [Android 轨道偏好 — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68)。

这些 PR 承载当前 CI 和合并状态。播放器变更会作为独立交付批次，跟随约定的当前 Plex 修复及其 beta 发布。

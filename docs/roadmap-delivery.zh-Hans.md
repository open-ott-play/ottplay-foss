# 可靠性与媒体功能改进

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.zh-Hans.md) · [架构](architecture.md)

本指南描述的是本页对应源代码修订版中的实现，而不是旧版已安装软件的能力。播放器、控制服务/CLI 和原生 Android 应用是独立产物。更新其中一个不会更新其他产物。

![职责与信任边界](diagrams/roadmap-components.svg)

参见[实测字节开销与对比图](roadmap-size.zh-Hans.md)；运行速度和设备播放是独立的验收项目。

<a id="what-is-implemented"></a>

## 已实现的功能

1. **已知的音视频样本。** [信息 → 音频](audio-video-check.zh-Hans.md)从 here.now 播放八秒短片（需要互联网），包含左右声道音调和对应闪光。只有选择**播放**才会获取，启动时不会加载；播放器软件包不包含该媒体文件。它仅在空闲或观看直播时临时借用主 HTML5 解码器，不写入观看历史。[样本规格](../diagnostics/README.md)。
2. **可恢复的 Local/Home 设置。** 控制 CLI 可以规划、应用、继续和验证预设。在重试结果不确定的写入之前，它会比较已保存的设置。[控制流程](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md)。
3. **有界的播放恢复。** HLS/Shaka 的暂时故障共享有限的恢复策略。身份验证错误和不支持的 DRM 会终止请求。Stop、换台和更换来源会取消过时的工作。
4. **保存的质量限制。** 最大高度和码率约束自适应选择；回退到原生播放不得悄悄绕过正在生效的上限。
5. **原生 Android 音轨偏好。** 独立 Android 应用按语言/角色/标签记住用户意图，包括 Auto 和关闭字幕，而不是沿用其他流的轨道索引。
6. **限定范围的命令操作员。** 控制器可以授予凭据访问特定设备/操作的权限，而无需交出管理员凭据。
7. **显式 XMLTV 绑定。** 播放列表范围内的频道可以绑定到特定数据源和 XMLTV ID。[节目指南绑定与无障碍](guide-binding-accessibility.zh-Hans.md)。
8. **Xtream 电影与剧集。** 媒体库按需获取所选目录，然后获取某个剧集的分集。[媒体库契约](xtream-media.zh-Hans.md)。
9. **无障碍经典控件。** 频道列表提供选择语义；模态对话框保持并恢复键盘焦点；通知使用动态播报区域。
10. **持久的命令结果。** 控制器可选的有界日志保留去重和结果元数据。重启绝不会盲目重放命令。
11. **显式设备接力。** 直播/回看引用传递到配置了相同来源的播放器。目标自行解析 URL。[契约](remote-handoff.zh-Hans.md)。
12. **显式备用流。** 直播频道可以在同一有限恢复策略内使用已配置的替代地址。[限制、恢复与备用流](playback-stream-policy.zh-Hans.md)。
13. **可恢复的设置批次。** 原生 localStorage 对支持的多键写入使用撤销日志。[存储保证](settings-recovery.zh-Hans.md)。

<a id="language-and-compatibility-coverage"></a>

## 语言与兼容性覆盖

播放器随附 88 个翻译目录。七个新增质量/媒体标签在每个目录中均已翻译；其他新菜单复用已有译文。目录检查覆盖键一致性、占位符和已审核的例外。配套工程指南以[24 种文档语言](manual-translations.md)说明同样的实现限制。[本地化入口](readme/README.md)是快速入门指南，并不表示每份历史工程文档都有 88 种完整译文。

经典输出仍使用 ES5 语法。这不代表每台设备都支持所有编解码器、Web API、存储保证或原生集成。A/V 预览仅限主托管 HTML5 路径；PC2/Video.js 和原生引擎等设备引擎替代实现被排除。显式节目指南绑定使用托管或原生 XMLTV 实现；可选的外部 companion 协议可能不支持。针对设备的验收仍需要真实设备。

<a id="reproduce-the-checks"></a>

## 复现检查

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

媒体验证器需要 FFmpeg/FFprobe。它解码两个声道并检查能量、声道分离和静音；仅有 AAC 轨道不代表有可听内容。常规 JavaScript 测试覆盖取消、写入失败、重启恢复、来源变化和无效输入。最终打包检查包含可选提供商系列，而不仅是主入口。

在控制器中运行 `go test -race ./...`、`go vet ./...` 和 `python3 -m unittest discover -s tests`。在原生 Android 中运行轨道偏好和设置备份的单元测试，并构建调试 APK。每个仓库的 CI 只对相应提交具有证明力，不对之后修改过的代码树负责。

<a id="physical-acceptance-before-promotion"></a>

## 晋级发布前的实机验收

- 在目标电视上执行 A/V 检查，确认左右声道、可见闪光、Stop 和返回直播。解码器测试无法证明 HDMI 声音或播放流畅度。
- 测试允许/拒绝的流、失效备用流，以及等待重试时切换频道。在实际后端确认所选质量限制。
- 使用键盘、遥控器和可用的屏幕阅读器检查列表/对话框焦点。
- 将两个相似频道名绑定到不同 XMLTV ID，并验证节目数据。
- 中断测试预设的应用，重启控制器、继续并验证。分别向配置匹配和不匹配的来源进行接力。
- 在原生 Android 上切换轨道顺序不同的流，重启应用，并确认显式 Auto/Off 和首选语言行为。

发送成功、设置保存、样本解码和单元测试通过是不同的证据。发布晋级必须保留这一区别；参见[发布策略](../RELEASING.md)。

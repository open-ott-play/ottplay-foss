# 画质限制与直播流恢复

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[解码器所有权](device-media-backend.md)

托管 HTML5/HLS/Shaka 播放器在故障来源恢复过程中保留唯一的播放租约。它还可为直播频道使用最多三个显式配置的备用 URL。绝不会按频道名称自动发现、猜测或替换频道。

![恢复流程：一个租约、有限重试、显式备用流](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## 设置画质上限

打开**设置 → 界面设置**，设置**最大视频高度（HLS/Shaka）**和/或**最大流码率（HLS/Shaka）**。两项约束同时生效。**自动**会移除对应约束。支持 360/480/720/1080/2160 像素和 1/2/4/8/16 Mbps。设置保存在本地，遵循普通的保存/取消流程，并在下一次开始播放时生效，包括恢复时的重启。

这些是上限，不是转码设置。只有 1080p 的流不能变成 720p。如果没有声明的变体符合条件，播放器会报告 **No stream meets the quality limits** 并停止重试该请求。未知的高度/码率不能证明受限 HLS 变体符合条件。

HLS 变体过滤在加载分片之前进行。当前 hls.js 会移除不合格变体；不支持 `removeLevel` 的旧版本只能保留安全、连续的列表前缀，可能拒绝后面仍有合格变体的清单。Shaka 使用应用级 `maxHeight`/`maxBandwidth` 限制。自动适应会在剩余变体之间继续。

这些设置适用于托管 HLS 和 Shaka 引擎。普通 HTML5、平台原生解码器以及保留的 TV/STB 引擎不提供同样的控制。Auto 模式可以选择原生播放；该设置不会强制改用 MSE。播放器不会只为避开解码错误，就把已受限的 HLS 请求切换到不受限的原生播放。这不意味着存在原生转码器、自动硬件基准测试，也不声明物理输出为 720p。

<a id="configure-explicit-backups"></a>

## 配置显式备用流

1. 开始播放目标直播频道。
2. 打开**信息 → 备用流**。
3. 选择槽位 1、2 或 3，输入完整 HTTP/HTTPS 媒体 URL。
4. 重新打开已有槽位即可**编辑**或**删除**。重新开始播放该频道以使用更新后的列表。

每个槽位属于当前提供商的存储命名空间及精确的 `sourceId`/`channelId` 对。当前播放代次与来源配置限制编辑器的作用范围。对话框打开时切换来源，会阻止该对话框向替换后的来源保存。同一槽位的并发更改会被拒绝，而不是被覆盖。

第一个 URL 仍是频道的常规来源。重复和空槽位会跳过。最多接受 256 条频道记录和 256 KiB 配置。含 user-info 凭据、空白、控制字符、反斜杠或无效端口的 URL 会被拒绝。提供商的查询令牌仍可作为媒体 URL 的组成部分：备用设置是本地来源配置，不是分享或公开凭据的机制。

备用流**仅适用于直播**。回看与 VOD 请求绝不会使用直播替代：录像、时间原点、权限和定位语义可能不同。所有者必须提供等价且获授权的直播端点。频道名称相同并不能证明等价。传输端点变化时，已保存的频道身份、收藏和 EPG 绑定保持不变。

<a id="recovery-guarantees"></a>

## 恢复保证

- 每个请求合计最多有**两次延迟的同 URL 临时错误重试**，并最多向三个备用槽位各前进一次：初次启动后最多重新创建五次。新的解码器实例或成功的清单不会重置预算。引擎内部已有的有限 HLS 网络和解码恢复先于这层外部恢复策略执行。
- HLS 清单/层级解析失败允许每个请求最多一次同 URL 重连，计入相同的两次重试总数。新解码器或备用端点不会重置该限制。
- 没有状态码的网络故障、HTTP 408/429 和 5xx 可使用临时重试预算。其他 HTTP 4xx 可以前进到已配置的替代端点，但不重试同一 URL。**HTTP 401/403 和来源登录错误会终止请求**，不会探测其他凭据或备用端点。
- 解码失败可以前进到显式备用流。无法满足的画质限制会终止请求。不会循环回到主来源。
- 延迟依次为 500 ms、1 s、1.5 s，之后最多 2 s。重复回调会合并。
- Pause 移除已安排的定时器，但保留待重试操作；Resume 重新安排。Stop、待机、更换来源或频道会使延迟回调失效。最终失败的请求需要显式重新选择，而不是自动播放已退役的解码器。
- Shaka 加载失败和严重错误事件共享此路径；取消错误会忽略。重新挂接会等待 Shaka 异步销毁完成。
- 恢复时重新解析不透明的 Stalker 引用，并再次准备受保护来源访问。不会复用已过期的 iOS loopback URL。VOD/回看位置在拆除前采样；直播备用流从各自当前直播边缘开始。

下文介绍基于直播媒体时钟的可选恢复功能。现有 kiosk、Auto/native 和 HLS 恢复机制保留各自的作用范围和引擎行为。

<a id="verification-and-observability"></a>

## 验证与可观测性

`window.__ottStreamPolicy.snapshot()` 提供引擎名、请求的限制、能力/可用性、重试次数、端点索引和恢复状态。不含流 URL 或提供商凭据。索引零代表常规来源，后续索引代表非空且唯一的替代端点。这是诊断状态，不是稳定的远程控制 API。

运行：

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

测试覆盖非单调变体顺序下的画质过滤、缺少元数据、按来源限制编辑、槽位冲突、重复错误、有界预算、HTTP 授权失败、暂停/停止/来源取消、Shaka 拆除和 VOD 位置保留。五个新增播放标签已在全部 88 个随附语言包中翻译；自动一致性检查不是母语审校。真实 TV/D1 播放和提供商特有清单仍需要设备验证。[可编辑图表源文件](diagrams/stream-recovery.mmd)。

<a id="live-stall-recovery"></a>

## 直播停滞恢复

在**设置 → 界面设置**中，选择**直播恢复尝试次数**（0–5）和**直播停滞超时，秒**（10/15/20/30）。默认值为 0 次尝试和 15 秒。设为零只会禁用此监控机制；现有引擎错误恢复保持不变。设置沿用正常的保存/取消流程。

确认播放曾有进展后，如果主直播流的媒体时钟停滞，就会调用现有的 `backend.restart()`。暂停、跳转位置、隐藏页面、离线状态和 kiosk 会暂停监测；回看、VOD 和 PiP 播放通道不在监测范围内。原生 PiP 会隐藏 HTML OSD。频道、来源或代际发生变化时，旧监测会被取消。首次播放若从未取得进展，仍由现有启动/错误处理机制负责。更换解码器和短暂进展不会重置尝试预算：只有连续进展十秒才会重置。达到次数上限后，监控机制不会再针对这次停滞重启。等待中的引擎恢复优先；无法绕过最终的授权、DRM 或质量限制错误。此机制观察的是媒体时间，而不是实际画面输出，也不是媒体时钟仍在前进时的画面冻结。

要进行无需订阅的基本测试，请选择**试用演示**。开始播放后，在测试标签页的 DevTools 中临时设置 `document.getElementById("video").playbackRate = 0`；随后恢复为 1。暂停被有意排除在停滞恢复之外。

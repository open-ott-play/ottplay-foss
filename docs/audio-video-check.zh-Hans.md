# 手动音视频检查

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[流恢复](playback-stream-policy.zh-Hans.md) · [样本规格](../diagnostics/README.md)

通过**播放器菜单 → 信息 → 音频 → 播放**，用已知的八秒短片检查画面和声音。这是有声的 A/V 检查；首次使用介绍中的移动图案演示是无声的。

![A/V 检查：仓库源文件、托管短片和显式播放](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## 开始检查

1. 将电视、扬声器或耳机设为舒适音量。检查使用播放器当前音量，并暂时取消其视频静音；不会提高电视系统音量。
2. 打开播放器菜单，选择**信息**、**音频**，再选择**播放**。只打开菜单不会下载或播放短片。
3. 观察屏幕并聆听下述顺序。要提前结束，选择**信息 → 音频 → 停止**。

检查在播放器空闲、直播正在播放或暂停时使用托管核心 HTML5 播放路径。它拒绝正在进行的 VOD/回看请求、仍在加载的直播请求以及待机状态。如果设备适配器替换了核心引擎，包括 **PC2/Video.js** 和原生引擎覆盖，检查也不可用；仅使用 HTML5 video 元素并不代表适配器符合条件。拒绝不会替换现有播放。要从空闲状态测试，请先停止当前请求；这不会在上述适配器上启用检查。菜单名称随所选界面语言变化。

<a id="what-you-should-see-and-hear"></a>

## 应看到和听到的内容

背景是移动测试图案。短暂的白色标记在左上或右上半区闪烁，与轻柔、约 150 ms 的声音脉冲同步：

- **0–2 秒：**左声道每秒有一次 440 Hz 脉冲，同时左侧标记闪烁。
- **2–4 秒：**右声道发出 880 Hz 脉冲，同时显示右侧标记。
- **4–6 秒：**两个声道都有脉冲，两个标记同时出现。
- **6–8 秒：**图案继续移动，但没有声音。这段静音是有意安排的。

单声道电视或混缩可能从同一个扬声器播放两个声道。请自行检查实际屏幕和音频输出。播放器不会测量扬声器输出，也不会自动给出 A/V 通过/失败结论。

<a id="where-the-clip-comes-from"></a>

## 短片来源

播放器使用以下绝对 HTTPS 地址：

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

只有选择**播放**才会请求短片，启动时绝不预加载。文件大小为 **464 652 字节**，视频为 H.264 baseline、640×360 / 25 fps，音频为 AAC 立体声。该文件不包含在 Web、OTTPlay Server、Tauri、Capacitor 或容器软件包中。[源文件](../diagnostics/av-v1.mp4)、生成器和验证器保留在仓库里，但不是已安装播放器的离线备用方案。

需要互联网访问以及到该主机的正常 HTTPS 连接。没有内置备用文件或替代诊断 URL。在浏览器中打开上述链接可以帮助检查文件是否可用，但不会验证播放器的解码器所有权或返回频道行为。托管服务会接收普通连接信息；参见[隐私详情](privacy-policy.md#optional-hosted-audio-video-check)。

<a id="how-playback-returns"></a>

## 如何返回原来的播放

检查使用主解码器，暂时替换直播画面。短片结束、选择**音频 → 停止**或发生媒体错误时结束。**从检查被接受时起，15 秒安全期限开始计时**，加载也计入期限；因此下载缓慢时，可能尚未播完八秒就结束。

在这些路径上，只有保存的直播请求仍属于当前来源、且没有替代播放接管时，播放器才尝试在当前直播边缘恢复该请求，包括其暂停状态。直播 URL 会重新解析，恢复仍依赖提供商和网络。从空闲开始的检查会返回空闲。

普通播放的 **Stop** 命令、待机或选择其他频道会取消检查，不重新启动保存的频道。更换来源或其会话也会防止过时的恢复。退出时检查会撤销自己临时取消静音的操作；如果运行中手动静音，该静音仍然有效。它不会改变保存的引擎偏好，不会把测试秒数写入频道历史，也不会向操作系统发布虚假的频道完成事件或测试元数据。

<a id="if-the-result-is-unexpected"></a>

## 结果不符合预期时

- **检查无法启动：**确认播放器空闲，或在已播放/暂停的直播频道上使用托管核心 HTML5 路径，且没有设备引擎覆盖。不支持的状态或媒体错误可能显示 **“Stream could not be played”**。
- **没有加载，或检查提前关闭：**检查互联网和直接 HTTPS 链接。网络错误或期限到期不代表解码器或扬声器损坏。恢复连接后再选择播放。
- **有画面但无声音：**最后两秒有意静音。前六秒内，请检查播放器静音/音量、电视音量和所选音频输出，以及扬声器/耳机连接。
- **只有一个实际扬声器发声：**先检查电视是否使用单声道输出或混缩，再判断是否是声道路由故障。

这是通过托管核心 HTML5 画面/声音路径对已知 MP4 进行的短时检查。它不证明提供商流、HLS/DASH、DRM、多声道音频或更高分辨率播放能够工作，也不测量网络容量或同步延迟。画质上限和直播备用流设置不会改变此诊断短片。

所有权和清理行为由 [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) 和 [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs) 覆盖。自动解码和生命周期检查不能代替在真实设备上观看、聆听；本指南不声明任何新的实机测试结果。

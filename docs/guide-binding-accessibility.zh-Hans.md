<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# 手动 XMLTV 绑定与键盘无障碍操作

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[节目指南架构](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## 无需编辑播放列表即可修复频道的节目指南

播放受影响的 M3U 频道，打开 **信息 → EPG**，然后编辑 EPG 来源 URL 和 **XMLTV ID**。请输入 XMLTV 文件中 `<channel id="…">` 的精确 ID，而不是显示名称。选择 **设置** 可保存绑定并重新加载播放列表。**自动** 会移除此频道的覆盖设置并重新加载播放列表的原始映射。仅移动方向键不会保存或重置绑定。返回操作不会更改已保存的绑定。

此编辑器可用于托管的浏览器部署以及原生 XMLTV 容器（Tauri 和 Capacitor）。它不会覆盖提供商管理的节目指南、显式 `=source` JSON 端点或外部伴随服务器。使用远程伴随服务的普通旧版浏览器仍沿用现有匹配协议。首个版本接受精确 ID；不会下载或展示所有 XMLTV 频道的可搜索列表。

![手动绑定将播放列表来源和稳定频道关联到一个 XMLTV 数据源及精确 ID；否则继续使用常规匹配。](images/guide-binding.svg)

绑定记录播放列表来源指纹、稳定频道键、显式数据源 URL 和 XMLTV ID。只要频道身份不变，重命名显示标签或更改行顺序不会改变绑定。替换播放列表 URL 或账户会更改来源命名空间。对于没有 `itemId` 的旧式 M3U 条目，系统使用现有的、由 URL 派生的频道 ID；更改该 URL 会改变其身份。

所选频道保留显示名称和播放 URL。节目指南查找只使用一个显式数据源，不按名称回退，因此 ID 缺失时不会悄悄借用其他频道的节目。根据频道名称推断的自动区域时差不适用于此精确绑定；播放列表中显式设置的 `tvg-shift` 仍然有效。请设置正确的区域 XMLTV ID。如果自定义 HTTPS 托管数据源因 CORS 或混合内容规则而无法读取，常规 EPG 诊断会报告该故障。

本地记录限制为每个来源 500 个绑定、512 KiB；每次加载播放列表只解析一次，而不是每个频道解析一次。写入时会比较先前值，并在重新加载前读回已存储的结果。迟到的编辑器回调不能保存到已替换的来源中。这是本地偏好设置，不是跨设备同步。数据源 URL 可能包含凭据；请勿公开分享存储导出文件。

<a id="accessible-classic-controls"></a>

## 经典控件的无障碍支持

- 虚拟化主列表提供有名称的列表框、选中的选项、总项目数和项目的绝对位置。只有选中的可见行进入 Tab 顺序。方向键导航同时更新视觉选择和语义状态；列表已获得焦点时，换页后焦点仍跟随列表。
- 标准信息/确认对话框、编辑器和关于面板提供模态角色及本地化名称。Tab 和 Shift+Tab 在前台模态窗口内循环。关闭嵌套模态窗口时，会恢复到仍可见的父级控件；已过期的计划打开操作不能在关闭后抢走焦点。
- 信息和确认消息描述其对话框。临时通知使用礼貌播报的状态区域。
- 新增标签全部来自现有翻译目录。XMLTV 和 ID 是协议标识符；频道名称和数据源主机名保留为来源元数据。

应用保留遥控器操作路径和 ES5 语法。语义 DOM 检查并不构成完整的 WCAG 认证：设备特定焦点、VoiceOver/TalkBack 语音及电视浏览器行为仍需真机测试。

<a id="verification"></a>

## 验证

运行：

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

还应在集成分支上运行常规构建、ES5 和包体积检查。浏览器检查应覆盖：跨页的长列表；嵌套确认；编辑期间替换来源；正确、缺失和已移除的绑定；以及 EPG 下载失败。原生 Android 应用的语义轨道偏好设置在其独立仓库中实现，与这些经典控件相互独立。

# Subtitle appearance

Open **Settings → Interface settings → Subtitle appearance**. Choose the font,
font size, text color, black outline thickness and black background opacity,
then use the standard **Save Settings** action. Back cancels the draft. **Reset
to default** resets all five draft choices; save to apply the reset.

Each choice starts at **Player default**. Default settings leave the renderer's
appearance untouched. Custom rules change only the cue's font, color, shadow and
background: they do not change its position, line, alignment or timing. Font size
is proportional to the rendered video image, including a reduced preview or PiP,
rather than the application window. Size percentages use a base of four percent
of image height. Outline choices are one, two or three CSS pixels; background
choices range from transparent to opaque in quarter steps.

Settings apply to native HTML video captions and Video.js rendered captions where
the browser supports the relevant cue CSS properties. Platform-controlled PiP,
external native video surfaces and captions embedded in the picture may not accept
web CSS. These controls cannot create missing subtitle languages or change text
already embedded in video pixels.

The five application settings are part of ordinary profile export/import. Invalid
indices fall back to their defaults. Switching channels does not reset them.
The editor and style implementation are a separate, versioned
`dist/subtitle-appearance.js` asset: default playback does not execute it. The
player loads it when the settings page is opened, or when saved custom appearance
must be applied. An installed web app may independently precache this static
asset with its offline shell. Navigating Back or changing source while that request is pending cannot
reopen the cancelled page.

The build measures the optional asset separately and includes it in complete
payload totals for web, server and native distributions. The eager player and
existing provider budgets are unchanged. Existing interface settings move into
this same optional asset to keep the startup budget intact.

## Shaka audio and subtitle tracks

When Shaka is the selected playback engine, **Menu → Audio track** lists audio
renditions and **Menu → Subtitles** lists text tracks with **Off**. This works in
both the current native runtime and the bundled legacy web runtime. Selecting an
audio language uses Shaka's audio adaptation API and leaves automatic video
quality enabled. A source that offers a language only at another video quality
may still require Shaka to change quality.

An explicit selection, including **Off**, survives late track-list updates in the
same playback session. Stored channel preferences continue to apply when a new
session starts. Shaka-rendered native captions retain the cue's own position and
use the same appearance settings as other HTML-video captions.

The track adapter downloads only when Shaka is requested, after the engine and
before its playback-ready callback. A missing adapter fails that attempt and can
be retried; it does not block the initial player interface or HLS playback.

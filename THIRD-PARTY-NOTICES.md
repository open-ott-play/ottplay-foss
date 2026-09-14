# Third-party notices

This inventory covers native and web player libraries, retained web fonts, legacy
images and Android template artwork reviewed on 2026-09-12. The project's root MIT license
does not replace their licenses or establish permission for material whose
provenance remains unverified. This is not a complete inventory of transitive
native dependencies or a statement of store approval.

## Native runtime: Tauri and Capacitor

Native builds use the exact npm-locked releases **jQuery 4.0.0**, **hls.js 1.7.3**
and **Shaka Player 5.2.10**. This applies to Tauri, iOS, Android Full and Android
Play. Their package license files are copied into `licenses/native/` in the native
frontend by the asset preparer; `native-runtime.json` records the versions and
file hashes. Verify those outputs against the release artifact, not the older web
vendor filenames.

- **jQuery 4.0.0:** MIT; [official release license](https://github.com/jquery/jquery/blob/4.0.0/LICENSE.txt).
- **hls.js 1.7.3:** Apache 2.0; [official release license](https://github.com/video-dev/hls.js/blob/v1.7.3/LICENSE).
- **Shaka Player 5.2.10:** Apache 2.0 with the additional notices retained in its
  [official release license](https://github.com/shaka-project/shaka-player/blob/v5.2.10/LICENSE).
  Its additional MIT notices and `third_party/SUMMARY.txt` are retained in
  `licenses/native/shaka-player-LICENSE.txt` and
  `licenses/native/shaka-third-party/SUMMARY.txt`; other upstream license/notice
  files under `third_party` retain their relative paths in that directory.
- **Capacitor core, Android, iOS and CLI/template 8.5.2:** MIT;
  [official release license](https://github.com/ionic-team/capacitor/blob/8.5.2/LICENSE).
- **Capacitor App 8.1.1:** MIT, with its separate Ionic copyright.
  [Complete license](licenses/android/Capacitor-App-8.1.1-LICENSE.txt), copied
  unchanged from the installed package and checked against its
  [release commit](https://github.com/ionic-team/capacitor-plugins/blob/0bfde98313dbd0312224c0a4896648b9fa6d57c3/app/LICENSE).
- **Apache Cordova Android 14.0.1:** Apache 2.0, included through Capacitor Android.
  The [original NOTICE](licenses/android/Cordova-14.0.1-NOTICE.txt) is copied from
  [the official release](https://github.com/apache/cordova-android/blob/rel/14.0.1/NOTICE).
  The [complete Apache 2.0 text](licenses/android/Apache-2.0.txt) is included too.
- **Tauri JavaScript updater plugin 2.11.0:** MIT or Apache 2.0; both installed
  license texts are copied to the native license directory.
  [Official repository](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater).

This is not a complete native dependency inventory. Preserve the notices of
resolved transitive dependencies when updating packages. An MIT notice for
Capacitor core does not replace the App plugin's different copyright statement.

## Shared ES5 media runtime

Every profile ships the same npm-locked **hls.js 1.7.3** UMD distribution.
`js/runtime-polyfills.js` contains **core-js 3.50.0** (MIT) and the project's web
API shims (MIT). It executes before third-party libraries in each page and is
prepended to the standalone `js/hls.worker.js`. The worker is a modified
distribution with its compatibility prelude identified in the generated file.
`js/media-runtime.json` records inputs and output hashes. Runtime packages retain
[core-js notices](js/licenses/core-js-LICENSE.txt),
[hls.js notices](js/licenses/hls.js-LICENSE.txt),
[the full Apache 2.0 license](js/licenses/Apache-2.0.txt), and
[the project license](js/licenses/project-LICENSE.txt).

## Web and legacy player libraries

- **jQuery 1.11.1** (`js/jquery-1.11.1.min.js`): MIT.
  [Complete license](licenses/android/jquery-1.11.1-LICENSE.txt), copied from
  [upstream 1.11.1](https://github.com/jquery/jquery/blob/1.11.1/MIT-LICENSE.txt).
- **hls.js 1.7.3** (`js/hls.min.js`): Apache 2.0, unchanged upstream UMD bytes.
  The shared media-runtime notices above apply to browser and native packages.
- **Shaka Player 3.3.19** (`js/shaka-player.compiled.js`): Apache 2.0, with an
  additional MIT notice for language-mapping-list by Ali Al Dallal.
  [Complete upstream license and additional notice](licenses/android/shaka-player-3.3.19-LICENSE.txt),
  copied from [upstream v3.3.19](https://github.com/shaka-project/shaka-player/blob/v3.3.19/LICENSE).
  Google and Closure copyright headers remain in the shipped JavaScript.
- **Retained Capacitor 8.5.1 template artwork**: MIT.
  [Complete license](licenses/android/Capacitor-8.5.1-LICENSE.txt), copied unchanged
  from the reviewed 8.5.1 packages, whose license files matched each other.
  This historical file describes the retained artwork, not the current native runtime.
  [Upstream v8.5.1](https://github.com/ionic-team/capacitor/blob/8.5.1/LICENSE).

[Bundled JavaScript copyright headers](licenses/android/bundled-javascript-copyrights.txt)
preserve the notices from the actual player files. The version declarations and
headers identify these libraries; this inventory does not assert that the
locally maintained JavaScript files are byte-identical to upstream builds.

## Retained web text fonts

Native Tauri and Capacitor packages do not include these font files. The web
and legacy profile retains them.

[Embedded font metadata](licenses/android/bundled-font-metadata.txt) records each
file's exact version, copyright, license fields and SHA256. The complete upstream
family licenses below supplement those retained metadata fields.

- **Roboto Regular 2.001047 (2015)** and **Roboto Condensed 3.008 (2023)** declare
  Apache 2.0 in their embedded metadata. The [complete license](licenses/android/Apache-2.0.txt)
  is copied from the [Roboto project at revision 38062f4](https://github.com/googlefonts/roboto/blob/38062f4b4a0be4346d07a928408da21602545e9e/LICENSE).
  `fonts/LiberationSans-Regular.ttf` is byte-identical to `fonts/Roboto-Regular.ttf`
  and internally identifies itself as Roboto; it is not identified here as a
  Liberation font.
- **Caveat Regular 2.000**: embedded metadata points to the SIL Open Font License.
  [OFL 1.1 and family copyright](licenses/android/Caveat-OFL.txt), from the
  [Caveat project at revision 59745e8](https://github.com/googlefonts/caveat/blob/59745e818ef7973e11e70cb1358d0e902b56c5fc/OFL.txt).
- **Gabriela Regular 2.001**: embedded metadata points to the SIL Open Font License
  and names the Gabriela Project Authors, with reserved font name Gabriela.
  [OFL 1.1 and family copyright](licenses/android/Gabriela-OFL.txt), from
  [Google Fonts at revision 809e4d8](https://github.com/google/fonts/blob/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/gabriela/OFL.txt).
- **PT Sans Narrow Regular 2.003W OFL**: embedded metadata points to the SIL Open
  Font License and records ParaType's 2009 copyright. The
  [upstream OFL 1.1 family notice](licenses/android/PT-Sans-Narrow-OFL.txt), from
  [Google Fonts at revision 809e4d8](https://github.com/google/fonts/blob/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/ptsansnarrow/OFL.txt),
  records 2010 and reserved names PT Sans and ParaType. Both notices are retained;
  the different dates have not been treated as interchangeable.

The upstream Caveat, Gabriela and PT Sans Narrow font files checked at those
revisions differ from the bundled files. Their family licenses and embedded
declarations are documented, but the exact download, subsetting or modification
history of the bundled fonts remains unverified. A binary difference alone does
not establish a license violation. Confirm license coverage of any modifications
and retain required notices; the included texts do not reconstruct that history.

## Native system fonts and symbols

All Tauri and Capacitor packages, including Android Full and Play, exclude the
text font files and all five `fontello.{ttf,eot,woff,woff2,svg}` files. The build replaces
Fontello classes, inline font-family declarations and private-use codepoints with
ordinary Unicode text, and removes the Fontello `@font-face` declaration. Controls
use symbols such as `▸`, `■`, `‖`, `«`, `»`, `□` and `✓` with the system
`sans-serif` font and its symbol fallback. Their appearance can vary by Android
version and device. No custom text or icon font is needed or loaded by a native build.

## Retained web Fontello icon font

The web and legacy profile retains the existing Fontello files. The 19 glyphs in
`fonts/fontello.{ttf,woff,woff2,svg}` were matched by normalized outlines to five
official Fontello collections. Nine SVG matches are exact;
the others differ by at most two units in a 1,000-unit em, consistent with
export rounding. This identifies the collections without establishing the exact
historical export or recovering its original configuration and generated LICENSE.

- **Font Awesome, Dave Gandy:** 13 navigation, menu and checkbox glyphs match the
  [Fontello 4.7.0 collection](https://github.com/fontello/awesome-uni.font/blob/29d4e3ff028fc850a21b5eaafde0a83f22f59cf1/config.yml).
  Its font license is [SIL OFL 1.1](https://fontawesome.com/v4/license/); the
  separate MIT license for CSS/code does not replace it.
- **Entypo 2.0, Daniel Bruce:** `info`. The
  [author's README](https://github.com/danielbruce/entypo/blob/f94e077449daa87321aa0df5643889460ba8291b/README.md)
  licenses the font under SIL OFL and distinguishes it from icon artwork under
  CC BY-SA 3.0.
- **Elusive, Aristeides Stathopoulos:** `play-1`, `stop-1` and `pause-1`.
  [The original project](https://github.com/dovy/elusive-iconfont/blob/3d086b9cfec7f3639ff7aa6699a89724b8d23372/README.md)
  identifies SIL; the [official font license](https://elusiveicons.com/license/)
  specifies OFL 1.1. The exact historical release is not established.
- **Zocial, Sam Collins:** `myspace`, under the
  [MIT license](https://github.com/smcllns/css-social-buttons/blob/306c065c85a23bd45676db8a52fef23613b49b6d/LICENSE).
- **Linecons, Designmodo for Smashing Magazine:** `globe`. The
  [Fontello collection](https://github.com/fontello/linecons.font/blob/34571415702bef18012f08eeec6ffc8e837a6dc4/config.yml)
  says CC BY without a version, and [Designmodo](https://designmodo.com/linecons-free/)
  permits commercial and mobile-interface use. However, the README in the
  [original release archive](https://www.smashingmagazine.com/2013/02/freebie-user-interface-kit-icons/)
  also restricts redistribution of the icon set. The precise license version and
  permission to redistribute this transformed font remain a scoped open question.

The TTF, WOFF and WOFF2 have identical glyph inventories, outlines and widths;
SVG has the same inventory with small conversion differences. `fontello.eot` is
a separate 2014 export containing only `down-big`, `up-big` and `trash` from
Font Awesome. Its `U+E802` differs from the current font's `fast-fw`; it remains
referenced by the legacy CSS fallback and must not be treated as an equivalent
format of the current font.

Before distributing the retained web Fontello files, include the required original copyright statements and
complete license notices for these font components and resolve the Linecons
question. These Fontello questions do not apply to native system-font symbols.
This inventory is not a substitute for the required notices.
[Fontello's guidance](https://github.com/fontello/fontello/wiki/What-about-license%3F)
assigns licensing to the original authors, and the
[OFL FAQ](https://openfontlicense.org/ofl-faq/) explains mobile-app bundling and
retention of copyright/license information. OFL font bundling does not require
relicensing the application itself under OFL.

## Provenance still requiring confirmation

- **Legacy player code:** source comments identify ports of `stbPlayer.js` and
  `stb/core.js`. A grant from the original authors for the imported code has not
  been established by this inventory. Publication and the root MIT declaration
  alone do not establish that grant. See the [source and permission record](docs/legacy-provenance.md)
  for the verified import history and the specific evidence still needed.
- **Legacy startup artwork (Full only):** `stbPlayer/icon.png` and the matching
  `favicon.ico` remain in Full and the shared web/desktop distributions. Play
  excludes both files and the code/HTML that displays or requests them. Their
  authorship and redistribution permission remain unverified; no new license is
  assigned here. The unused
  `mute.png`, `beta.png`, `blue_short.png` and `no_image.png` were removed from the
  current source and packages, along with the superseded `buffering.gif`.

## Android template artwork

The existing launcher and splash files match the Capacitor 8.5.1 template, whose
MIT notice is included above. The unreferenced Android robot drawable
`android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml` and the unused
`drawable/ic_launcher_background.xml` grid were removed. The manifest and adaptive icons use the retained `mipmap` launcher images and
`color/ic_launcher_background`; they do not depend on that removed drawable.

## Demo media

`scripts/generate-demo-media.sh` generates a silent 24-second test pattern with
FFmpeg `testsrc2`, encodes it with libx264 and remuxes it to HLS. The recipe does
not download broadcast footage, music, logos or external images. The Android
provider links to hosted output; the reviewed APK contains no demo video or
FFmpeg executable. This describes the media's reproducible source and does not
assign the licenses of the generation tools to the rest of the application.

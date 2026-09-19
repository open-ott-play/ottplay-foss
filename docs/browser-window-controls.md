# Browser window controls

OTT-play FOSS supports Window Controls Overlay in installed desktop browser apps.
When enabled, video extends into the title-bar area while the operating system's
window buttons and the browser's app menu remain available. This feature applies
to a separate installed app window; an ordinary browser tab keeps its usual
browser frame. See the [Chrome feature documentation](https://web.dev/articles/window-controls-overlay).

## Enable or restore the title bar

1. Open a supported player URL in Chrome and install the page as an app.
2. Open that installed app. If Chrome presents **Hide title bar**, choose it to
   enable the overlay. Use **Show title bar** to restore the separate bar.
3. For an existing installation, open its original player URL after the server
   update, then close and reopen the app so Chrome can apply refreshed manifest
   metadata. Chrome controls manifest update timing; reloading a page alone may
   not immediately add the title-bar control.
   If Chrome offers **Review App Update**, apply it and reopen the app. Chrome
   can replace a custom shortcut name with the manifest name, **OTT-play FOSS**;
   each origin still keeps its separate player settings.

The player cannot force Chrome's title-bar preference or remove the remaining
system controls. Its current desktop fullscreen bindings stay in place: **L**
toggles fullscreen, and **Esc** leaves fullscreen. The overlay's drag area and
layout adjustments are inactive during fullscreen.

## Installation identity and supported URLs

The optional browser bootstrap supports exactly `/`, `/index.html`, `/f/pc`, and
`/f/pc/`, without a query string or fragment. Each path has its own static manifest
under `/js/browser-app/`, with `id` and `start_url` equal to that exact path. The
root route retains device autodetection; the two PC routes retain the explicit PC
adapter. An installed PC shortcut therefore does not silently become a root-route
installation.

All four manifests use scope `/`, English installation metadata, the existing
product icon, `display: standalone`, and `display_override: window-controls-overlay`.
Different origins, including different ports, remain separate installations and
keep their existing origin-specific player settings. To update an existing app,
use its original origin and path.

Other device routes, URLs with parameters, and URLs with fragments do not opt in.
Their installation identity and device selection are left alone. No service
worker or offline cache is introduced; the installed app still needs its player
server and configured media sources.

## Layout and compatibility

The player uses the browser's reported title-bar rectangle for a narrow draggable
area. Video, channel navigation, dialogs and playback controls retain their normal
mouse behavior outside that rectangle. Channel lists, their preview video, and
the relevant on-screen information are positioned below the native controls;
expanded programme information and tall dialogs remain scrollable.

The bootstrap and helper remain ES5 scripts. Browsers without the overlay API,
explicit TV routes, Tauri, Capacitor, Android bridges and non-HTTP(S) native
origins do not load the optional browser assets. Modern overlay CSS is isolated
from the legacy layout and only takes effect while the overlay is visible.
Native staging excludes the browser installation assets, including its icon;
the archived Play distribution's artwork exclusion remains intact.

## Deployment and verification

The production browser build includes the manifests, icon, stylesheet and helper
under `/js/browser-app/`. The Mode A archive carries that tree, and packaging
rejects missing required installation assets. The existing `/js` static route
serves these files; no companion API or native window change is required.

A targeted local update can deploy the optional browser bootstrap and its asset
tree together while preserving the installed player version, pinned runtime
references, server configuration and user settings. That local patch is not a
new release or evidence that another deployment already contains the change.

Relevant checks are:

```bash
node tests/test_browser_window_controls.cjs
node tests/test_frontend_staging.cjs
node tests/test_package_modea.cjs
npx playwright test tests/browser/window-controls.spec.cjs
```

The browser regression uses the built classic player, actual HLS fixture decoding,
channel navigation and fullscreen transitions. It simulates macOS and Windows
overlay geometry and display-mode signals because a normal automated browser tab
does not provide an installed app's native frame. Those checks complement an
installed-app check of title-bar toggling, window dragging, closing/reopening, and
fullscreen; they do not establish native window behavior on every operating
system or playback on physical TVs.

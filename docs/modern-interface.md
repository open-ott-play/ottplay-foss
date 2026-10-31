# Modern interface

Modern is an optional presentation of the same OTT-play catalogue, playback
session and controls. Classic remains available and remains the default for
new and existing installations.

## Enable or return to Classic

Open **Settings → Interface settings → Interface mode**, choose **Modern** or
**Classic**, and save. Cancelling the settings draft keeps the previous mode.
The preference is stored for the client, so selecting a provider or restarting
the player does not reset it.

The matching remote setting is `interfaceMode`:

```sh
ott t1 setting interfaceMode
ott t1 setting interfaceMode 1
ott t1 setting interfaceMode 0
```

`1` requests Modern; `0` selects Classic. Replace `t1` with the target player.
The stored key is `sInterfaceMode`; only integer values `0` and `1` are valid.
Unset or invalid saved values use Classic. The setting is application-scoped,
not part of an individual provider's settings.

Remote setting responses separate the saved value from `effective_value`.
While the renderer loads, application is reported as deferred with
`view_loading`; a failed load reports `effect_failed` while Classic remains
active. Read the setting again to confirm the effective mode.

**Interface mode** and **Interface theme** are separate settings. The theme
continues to control the existing palette, background and opacity settings.
Studio 2026 remains the default theme. Switching presentation preserves the
theme, including saved Classic custom colours. Modern adds its own consistent
card selection treatment and surface shapes.

## What changes

- The library fills the window, with persistent navigation to the current
  library, Favorites, categories, search, providers and settings. Available
  navigation follows the same provider and access rules as Classic.
- A selected-item header presents the title, artwork, collection and available
  description above the catalogue. The old split-screen preview does not take
  space away from the catalogue; playback continues in the same session.
- Live channel catalogues use larger rows with a number, channel identity,
  logo when available, programme text and progress. The focused row and the
  playing channel have distinct indicators.
- Media catalogues and mixed Favorites use a bounded poster grid. A card shows its title and
  available collection metadata. Missing or failed artwork leaves a readable
  title and a simple letter placeholder.
- Settings and categories use a spacious single-column list inside the same
  navigation shell. Search and text entry use a scrollable editor with visible
  confirmation and cancellation controls. Context menus, dialogs, track
  selection and the playback OSD use the same surfaces and focus treatment.
- Media descriptions, existing controls and their callbacks retain their
  original ownership. Actions and input handling remain shared with Classic.

This is a new presentation of the existing libraries, not a separate library
or recommendation service. System file pickers and operating-system permission
dialogs retain their native appearance.

## Navigation and shared state

In a poster grid, Left/Right move between cards and Up/Down move by the visible
column count. At list boundaries the selection stays within the available
items. Enter/OK activates the selected item through the same action as Classic.
Back, category selection, search and context actions retain their existing
behavior. Channel catalogues retain their linear navigation.

Left from the first grid column enters the navigation rail. Up/Down select a
navigation action and Right returns to the selected catalogue item. Clicking
a navigation action uses the same routes as keyboard operation. An open text
editor or confirmation dialog keeps input ownership until it closes; covered
navigation cannot change the provider behind it.

The full-screen video shortcuts are unchanged: the presentation mode does not
remap volume, seeking, previous/next or Favorites. Kiosk restrictions remain in
force and are not relaxed by switching the presentation.

The two modes share the current provider, category, global Favorites, selected
item, source order, playback position, volume and track choices. Switching the
mode redraws the visible catalogue; it does not reload the playlist, restart
the decoder or create a new Favorites store. A different number of visible
cards may move the selected item's screen position while keeping the same
selection.

## Large libraries and small screens

The grid renders only the current page. It does not create an image element
for every item in a large local, Plex or VPortal catalogue. Existing background
catalogue loading and source availability rules still apply.

Column and row capacity adapt to the available catalogue area and interface
font scale, with at most 24 cards mounted at once. On narrow windows the rail
becomes a compact horizontal navigation bar; text editors and dialogs remain
scrollable. Modern does not overwrite the saved Classic row count. The
existing font family and **Font size, %** setting continue to apply; subtitle
styling remains separate. Focus decoration avoids layout-changing animation,
and the small decoration transitions are disabled when the platform requests
reduced motion. No backdrop blur, new web font or external artwork service is
required.

## Availability and fallback

The shared browser, OTT-server, Tauri and Capacitor frontend uses the same
Modern presentation asset. TV wrappers loading that frontend use the same
setting. A device must receive the updated frontend and its matching optional
asset before Modern can be used; this is not a claim that every physical TV
model has been certified.

Classic startup does not load the Modern JavaScript asset. When Modern is
requested, the player loads that asset with a bounded timeout. If it cannot be
loaded or initialized, or the rendering engine lacks CSS Grid support, Classic
remains usable and the player displays a message. The requested preference is
retained separately from the effective
mode. Select Classic, then Modern to retry; verify the installed frontend
version and asset availability if the message returns.

## Design reference and implementation

The visual study used [PlxNative](https://github.com/GLinnik21/plx-native):
artwork-led catalogues, readable detail hierarchy, clear remote focus and
compact playback controls. OTT-play's implementation uses its own HTML/CSS,
existing fonts, data models and actions. No PlxNative source code, logo,
screenshots or demonstration artwork is bundled for this feature. Runtime
artwork comes from the selected provider or media source.

The reference's native rendering performance and hardware support do not
transfer to a browser/WebView implementation. Release validation must cover
the actual frontend bundles, settings persistence, switching while playing,
keyboard/pointer navigation, missing artwork and responsive layouts.

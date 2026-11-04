# Native window aspect constraint

The optional main-window constraint requests 16:9 **content dimensions during interactive resizing**. It is independent of video aspect/zoom, topmost state, and the separate PiP window. The preference defaults off and is saved in the instance data directory as `window-aspect-lock`; window position/size restoration keeps its existing owner.

The native commands are `get_window_aspect_lock` and `set_window_aspect_lock({enabled})`. Their confirmed result is `{ok, supported, enabled, active}`. `enabled` is the requested preference; `active` means the native interactive constraint is armed/applicable now, not that current pixels are already 16:9. Fullscreen/maximize suspension retains the requested preference. Unsupported SET and native or persistence failures reject. A successful native mutation followed by a persistence failure is not silently rolled back. Main-only command authorization does not grant control over PiP or another window.

Windows edits the native `WM_SIZING` proposal, keeping the opposite anchor and respecting real OS-initialized `WM_GETMINMAXINFO` bounds after Tao overrides. DPI/display changes invalidate cached bounds; no valid fresh bounds means ordinary OS handling. Content/frame insets are current physical pixels. Snap remains OS-owned. macOS uses AppKit content aspect constraints and restores prior aspect/increment settings when disabled. GTK X11 composes aspect and existing size hints. Wayland currently reports unsupported because its first fixed-state configure precedes the state callback used here; this is not a claim that GDK Wayland ignores aspect hints. See the [GTK 3.24.49 configure ordering](https://github.com/GNOME/gtk/blob/3.24.49/gdk/wayland/gdkwindow-wayland.c#L1678); GTK is a system dependency, so this inspected upstream source is not a pinned-runtime guarantee.

This implementation requires native acceptance before the issue can be closed. In particular [GTK's hint setter queues layout](https://github.com/GNOME/gtk/blob/3.24.49/gtk/gtkwindow.c#L3843), so unchanged initial X11 geometry has not yet been proved. The intended behavior preserves current/restored geometry on enable and constrains subsequent interactive sizing. A reviewed implementation and passing arithmetic tests do not establish every desktop/window-manager behavior.

## Existing Windows smoke gate

The existing `window_controls_smoke` executable and `scripts/check-window-controls.py` exercise production handlers through WebView2 JavaScript IPC. They use only owned main/PiP fixture HWNDs, isolated data directories, the existing 30-second internal/40-second parent deadlines, and PID-scoped cleanup. No installed player, user profile, or network endpoint is used.

The fixture starts with non-16:9 geometry and checks default-off state; repeated true/true/false/false SET; unchanged geometry; production versus missing permissions; denied PiP GET/SET; six native fullscreen/restore transitions; and three fresh-process preference phases. The runner requires exact confirmed replies and saved preference bytes, so incomplete native evidence cannot be reported as a pass.

The sizing probe observes real OS `WM_GETMINMAXINFO` traffic from a bounded owned-window size/restore, then dispatches `WM_SIZING` to the actual subclass for all eight edges. It verifies ratio, current bounds, opposite anchors, and disabled passthrough. This is an **owned-HWND native message probe**, not a human drag gesture or multi-monitor/DPI acceptance. The observer is removed before fixture completion; removal failure fails the probe.

Existing Windows Native Shells steps build the fixture, validate its manifest, run the Python parent, and upload `build/windows-window-controls-report/`. The additional `cargo test --locked -p ottplay-tauri window_aspect::` step executes geometry and IPC-contract unit tests; existing preference tests and the macOS full crate test remain enabled. The same commands can be used by an authorized native acceptance runner:

```text
cargo test --locked -p ottplay-tauri window_aspect::
cargo test --locked -p ottplay-tauri window_preferences::tests
python tests/test_window_controls_smoke.py
cargo build --locked -p ottplay-tauri --example window_controls_smoke
python scripts/check-windows-manifest.py --binary target/debug/examples/window_controls_smoke.exe --output build/windows-window-controls-report/fixture-manifest.json
python scripts/check-window-controls.py
```

The commands above are a gate definition, not an assertion that they ran. Windows real drag edges, maximize/restore, fractional DPI and monitor transfer; macOS native transitions; X11 behavior; and any future Wayland support still need execution evidence. No new workflow or duplicate fixture launcher is added.

// Included only by the owned Linux/X11 smoke fixture. No production hooks.
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tao::platform::unix::x11::ffi as x11;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
struct X11Snapshot {
    label: String,
    xid: u64,
    pid: u32,
    rect: [i32; 4],
    hints: i64,
    min_size: [i32; 2],
    max_size: [i32; 2],
    min_aspect: [i32; 2],
    max_aspect: [i32; 2],
    fullscreen: bool,
    maximized: bool,
    above: bool,
    wm_present: bool,
}

// The ABI and dynamic symbols are the same existing x11-dl exports used by Tao.
// All calls stay on the UI thread. The XID is borrowed from a live owned window;
// this query connection owns and closes its display instead of requesting a
// non-owning Tao raw display handle (which opens a fresh connection).
struct X11Connection {
    api: x11::Xlib,
    display: *mut x11::Display,
}
impl X11Connection {
    fn open() -> Result<Self, String> {
        let api = x11::Xlib::open().map_err(|e| e.to_string())?;
        let display = unsafe { (api.XOpenDisplay)(std::ptr::null()) };
        if display.is_null() { return Err("Cannot open fixture X11 display".into()); }
        Ok(Self { api, display })
    }
}
impl Drop for X11Connection {
    fn drop(&mut self) { unsafe { (self.api.XCloseDisplay)(self.display); } }
}
unsafe fn x11_property(
    api: &x11::Xlib, display: *mut x11::Display, window: x11::Window,
    name: &[u8], expected_type: x11::Atom,
) -> Result<Vec<libc::c_ulong>, String> {
    let atom = (api.XInternAtom)(display, name.as_ptr().cast(), 1);
    if atom == 0 { return Ok(Vec::new()); }
    let mut actual_type = 0;
    let mut format = 0;
    let mut count = 0;
    let mut remaining = 0;
    let mut data = std::ptr::null_mut();
    let status = (api.XGetWindowProperty)(display, window, atom, 0, 32, 0,
        expected_type, &mut actual_type, &mut format, &mut count, &mut remaining, &mut data);
    let valid = status == 0 && remaining == 0 && count <= 32
        && (count == 0 || (actual_type == expected_type && format == 32 && !data.is_null()));
    let result = if valid {
        if count == 0 { Ok(Vec::new()) }
        else { Ok(std::slice::from_raw_parts(data.cast::<libc::c_ulong>(), count as usize).to_vec()) }
    } else { Err("Malformed or oversized owned X11 property".into()) };
    if !data.is_null() { (api.XFree)(data.cast()); }
    result
}

fn x11_snapshot_now(window: &tauri::WebviewWindow) -> Result<X11Snapshot, String> {
    if !matches!(window.label(), "main" | "pip") {
        return Err("X11 observation requires an owned fixture window".into());
    }
    let native = window.window_handle().map_err(|e| e.to_string())?;
    let RawWindowHandle::Xlib(native) = native.as_raw() else {
        return Err("This acceptance requires the X11 backend, not Wayland".into());
    };
    let connection = X11Connection::open()?;
    let api = &connection.api;
    let display = connection.display;
    // SAFETY: the XID remains borrowed from the live fixture on its UI thread;
    // the query connection owns this display and output storage uses x11-dl ABI.
    // No foreign window is mutated, and all returns close the connection.
    unsafe {
        (api.XSync)(display, 0);
        let pid = x11_property(api, display, native.window, b"_NET_WM_PID\0", x11::XA_CARDINAL)?;
        if pid.as_slice() != [std::process::id() as libc::c_ulong] {
            return Err("X11 PID does not match this fixture process".into());
        }
        let mut root = 0;
        let (mut x, mut y) = (0, 0);
        let (mut width, mut height, mut border, mut depth) = (0, 0, 0, 0);
        if (api.XGetGeometry)(display, native.window, &mut root, &mut x, &mut y,
            &mut width, &mut height, &mut border, &mut depth) == 0 {
            return Err("Owned X11 geometry unavailable".into());
        }
        let mut child = 0;
        if (api.XTranslateCoordinates)(display, native.window, root, 0, 0, &mut x, &mut y, &mut child) == 0
            || width == 0 || height == 0 || width > i32::MAX as u32 || height > i32::MAX as u32 {
            return Err("Invalid owned X11 client geometry".into());
        }
        let mut hints: x11::XSizeHints = std::mem::zeroed();
        let mut supplied = 0;
        if (api.XGetWMNormalHints)(display, native.window, &mut hints, &mut supplied) == 0 {
            return Err("Owned X11 WM_NORMAL_HINTS unavailable".into());
        }
        let states = x11_property(api, display, native.window, b"_NET_WM_STATE\0", x11::XA_ATOM)?;
        let has = |name: &[u8]| {
            let atom = (api.XInternAtom)(display, name.as_ptr().cast(), 1);
            atom != 0 && states.contains(&atom)
        };
        let manager = x11_property(api, display, root, b"_NET_SUPPORTING_WM_CHECK\0", x11::XA_WINDOW)?;
        Ok(X11Snapshot {
            label: window.label().to_owned(), xid: native.window as u64, pid: pid[0] as u32,
            rect: [x, y, width as i32, height as i32], hints: hints.flags as i64,
            min_size: [hints.min_width, hints.min_height], max_size: [hints.max_width, hints.max_height],
            min_aspect: [hints.min_aspect.x, hints.min_aspect.y],
            max_aspect: [hints.max_aspect.x, hints.max_aspect.y],
            fullscreen: has(b"_NET_WM_STATE_FULLSCREEN\0"),
            maximized: has(b"_NET_WM_STATE_MAXIMIZED_HORZ\0") && has(b"_NET_WM_STATE_MAXIMIZED_VERT\0"),
            above: has(b"_NET_WM_STATE_ABOVE\0"),
            wm_present: manager.len() == 1 && manager[0] != 0,
        })
    }
}

async fn x11_snapshot(window: &tauri::WebviewWindow) -> Result<X11Snapshot, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window.run_on_main_thread(move || { let _ = sender.send(x11_snapshot_now(&target)); })
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(4), receiver).await
        .map_err(|_| "X11 observation deadline".to_owned())?
        .map_err(|_| "X11 observation channel closed".to_owned())?
}

fn x11_ratio(rect: [i32; 4]) -> bool {
    (i64::from(rect[2]) * 9 - i64::from(rect[3]) * 16).abs() <= 16
}

fn x11_hints_match(value: &X11Snapshot, active: bool, bounds: [[i32; 2]; 2]) -> bool {
    let mask = (x11::PMinSize | x11::PMaxSize) as i64;
    let ratio = |pair: [i32; 2]| pair[0] > 0 && pair[1] > 0
        && i64::from(pair[0]) * 9 == i64::from(pair[1]) * 16;
    value.wm_present && value.hints & mask == mask
        && value.min_size == bounds[0] && value.max_size == bounds[1]
        && ((value.hints & x11::PAspect as i64 != 0) == active)
        && (!active || (ratio(value.min_aspect) && ratio(value.max_aspect)))
}

async fn x11_settled_bounds(window: &tauri::WebviewWindow, active: bool,
    fullscreen: bool, maximized: bool, geometry: Option<[i32; 4]>, original_size: bool,
    bounds: [[i32; 2]; 2],
) -> Result<X11Snapshot, String> {
    let start = Instant::now();
    let mut previous = None;
    let mut stable = 0;
    trace("x11-settle-start", json!({
        "window": window.label(), "expected_active": active,
        "expected_fullscreen": fullscreen, "expected_maximized": maximized,
        "expected_geometry": geometry, "original_size": original_size,
        "expected_bounds": bounds,
    }));
    loop {
        // Observe actual X11 state before GET; GET must not supply the evidence.
        let value = x11_snapshot(window).await?;
        let position_matches = geometry.map(|rect| value.rect.iter().zip(rect)
            .all(|(a, b)| (i64::from(*a) - i64::from(b)).abs() <= 2)).unwrap_or(true);
        let requested_size = !original_size || (value.rect[2] - 640).abs() <= 2 && (value.rect[3] - 400).abs() <= 2;
        let bounded = fullscreen || maximized || (value.rect[2] >= bounds[0][0]
            && value.rect[3] >= bounds[0][1] && value.rect[2] <= bounds[1][0]
            && value.rect[3] <= bounds[1][1]);
        if x11_hints_match(&value, active, bounds) && value.fullscreen == fullscreen
            && value.maximized == maximized && position_matches && requested_size && bounded
            && (!active || x11_ratio(value.rect)) {
            if previous.as_ref() == Some(&value) { stable += 1; } else { stable = 0; }
            if stable >= 2 {
                trace("x11-settle-success", json!({
                    "window": window.label(), "stable_count": stable, "actual": &value,
                }));
                return Ok(value);
            }
            previous = Some(value.clone());
        } else { stable = 0; previous = None; }
        if start.elapsed() >= Duration::from_secs(4) {
            return Err(format!("X11 native state did not settle (expected_active={active}, expected_fullscreen={fullscreen}, expected_maximized={maximized}, expected_geometry={geometry:?}, original_size={original_size}, expected_bounds={bounds:?}, stable_count={stable}): {value:?}"));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn x11_settled(window: &tauri::WebviewWindow, active: bool,
    fullscreen: bool, maximized: bool, geometry: Option<[i32; 4]>, original_size: bool,
) -> Result<X11Snapshot, String> {
    x11_settled_bounds(window, active, fullscreen, maximized, geometry, original_size,
        [[320, 180], [1600, 1000]]).await
}

async fn denied(window: &tauri::WebviewWindow, command: &str, args: Value) -> Result<Value, String> {
    let before = x11_snapshot(window).await?;
    let reply = invoke(window, command, args).await?;
    let error = reply["error"].as_str().unwrap_or("");
    if reply["ok"] != false || !error.contains("not allowed") {
        return Err(format!("Expected ACL rejection for {command}, received {reply}"));
    }
    if x11_snapshot(window).await? != before { return Err(format!("Denied {command} changed X11 state")); }
    Ok(json!({"window": window.label(), "command": command, "error": error}))
}

async fn x11_aspect(window: &tauri::WebviewWindow, requested: Option<bool>,
    enabled: bool, active: bool,
) -> Result<Value, String> {
    let value = if let Some(requested) = requested {
        allowed(window, "set_window_aspect_lock", json!({"enabled": requested})).await?
    } else {
        allowed(window, "get_window_aspect_lock", json!({})).await?
    };
    if value != json!({"ok": true, "supported": true, "enabled": enabled, "active": active}) {
        return Err(format!("Wrong native X11 aspect response: {value}"));
    }
    Ok(value)
}

// This subprocess is an input driver, not a size setter. No shell is involved.
// Every child is reaped, including the timeout/error path. Its own two-second
// deadline does not replace or renew the fixture's existing 30-second watchdog.
fn xdotool_bounded(args: &[String]) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    let deadline = Instant::now() + Duration::from_secs(2);
    let owner = std::process::id() as libc::pid_t;
    let mut command = Command::new("xdotool");
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    // The fixture watchdog uses process::exit, so Rust destructors alone cannot
    // own the driver. Install the kernel guard before exec, then close the race
    // where the original parent exited between fork and prctl. This hook uses
    // only libc syscalls and raw error codes: no allocation, logging or locks.
    unsafe {
        command.pre_exec(move || {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong,
                0 as libc::c_ulong, 0 as libc::c_ulong, 0 as libc::c_ulong) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::getppid() != owner {
                return Err(std::io::Error::from_raw_os_error(libc::ESRCH));
            }
            Ok(())
        });
    }
    let mut child = command.spawn().map_err(|error| format!("Cannot start X11 input driver: {error}"))?;
    let error = loop {
        match child.try_wait() {
            Ok(Some(status)) => return if status.success() { Ok(()) }
                else { Err(format!("X11 input driver failed: {status}")) },
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            Ok(None) => break "X11 input driver exceeded two seconds".to_owned(),
            Err(error) => break format!("Cannot observe X11 input driver: {error}"),
        }
    };
    let _ = child.kill();
    child.wait().map_err(|error| format!("Cannot reap X11 input driver: {error}"))?;
    Err(error)
}

async fn x11_input_drag(before: &X11Snapshot, edge: u8) -> Result<([i32; 2], [i32; 2]), String> {
    if before.label != "main" || before.pid != std::process::id() || before.xid == 0 {
        return Err("Input driver requires the verified owned main XID".into());
    }
    let [x, y, width, height] = before.rect;
    // Windows WM_SIZING order, with inward motion to stay inside the Xvfb
    // screen and above minimum size: left/right/top/TL/TR/bottom/BL/BR.
    let (sx, sy, dx, dy) = match edge {
        1 => (2, height / 2, 96, 0),
        2 => (width - 2, height / 2, -96, 0),
        3 => (width / 2, 2, 0, 61),
        4 => (2, 2, 96, 61),
        5 => (width - 2, 2, -96, 61),
        6 => (width / 2, height - 2, 0, -61),
        7 => (2, height - 2, 96, -61),
        8 => (width - 2, height - 2, -96, -61),
        _ => return Err("Unknown owned X11 edge".into()),
    };
    let input_start = [x + sx, y + sy];
    let input_end = [x + sx + dx, y + sy + dy];
    let xid = before.xid.to_string();
    let args: Vec<String> = [
        "windowactivate".into(), "--sync".into(), xid.clone(),
        "mousemove".into(), "--sync".into(), "--window".into(), xid,
        sx.to_string(), sy.to_string(), "mousedown".into(), "1".into(),
        "sleep".into(), "0.08".into(), "mousemove".into(), "--sync".into(),
        input_end[0].to_string(), input_end[1].to_string(),
        "sleep".into(), "0.08".into(), "mouseup".into(), "1".into(),
    ].into();
    tauri::async_runtime::spawn_blocking(move || {
        let result = xdotool_bounded(&args);
        if result.is_err() {
            // Release only the button this driver may have pressed. The parent
            // owns this isolated Xvfb display; never leave its grab held on error.
            xdotool_bounded(&["mouseup".into(), "1".into()])?;
        }
        result
    }).await.map_err(|error| format!("X11 input task failed: {error}"))??;
    Ok((input_start, input_end))
}

async fn x11_restore(window: &tauri::WebviewWindow, rect: [i32; 4], active: bool) -> Result<X11Snapshot, String> {
    // Restoring between samples is explicit setup, never evidence of a drag.
    window.set_size(tauri::PhysicalSize::new(rect[2] as u32, rect[3] as u32))
        .map_err(|error| error.to_string())?;
    window.set_position(tauri::PhysicalPosition::new(rect[0], rect[1]))
        .map_err(|error| error.to_string())?;
    x11_settled(window, active, false, false, Some(rect), false).await
}

async fn x11_drag_probe(window: &tauri::WebviewWindow, baseline: [i32; 4], enabled: bool) -> Result<Value, String> {
    let mut samples = Vec::new();
    for edge in 1..=8 {
        let before = x11_restore(window, baseline, enabled).await?;
        let (input_start, input_end) = x11_input_drag(&before, edge).await?;
        let after = x11_settled(window, enabled, false, false, None, false).await?;
        let b = before.rect;
        let a = after.rect;
        let near = |a: i32, b: i32| (i64::from(a) - i64::from(b)).abs() <= 2;
        let anchored = match edge {
            1 => near(a[0] + a[2], b[0] + b[2]),
            2 => near(a[0], b[0]),
            3 => near(a[1] + a[3], b[1] + b[3]),
            4 => near(a[0] + a[2], b[0] + b[2]) && near(a[1] + a[3], b[1] + b[3]),
            5 => near(a[0], b[0]) && near(a[1] + a[3], b[1] + b[3]),
            6 => near(a[1], b[1]),
            7 => near(a[0] + a[2], b[0] + b[2]) && near(a[1], b[1]),
            8 => near(a[0], b[0]) && near(a[1], b[1]),
            _ => false,
        };
        let horizontal = matches!(edge, 1 | 2 | 4 | 5 | 7 | 8);
        let vertical = matches!(edge, 3 | 4 | 5 | 6 | 7 | 8);
        let moved_axis = (!horizontal || a[2] < b[2] - 2) && (!vertical || a[3] < b[3] - 2);
        let free_axis = enabled || ((!horizontal || vertical || near(a[3], b[3]))
            && (!vertical || horizontal || near(a[2], b[2])));
        if before.xid != after.xid || before.pid != after.pid || a[2..] == b[2..]
            || a[2] < 320 || a[3] < 180 || a[2] > 1600 || a[3] > 1000 || !anchored
            || !moved_axis || !free_axis || x11_ratio(a) != enabled {
            return Err(format!("Owned X11 drag edge {edge}, enabled={enabled}, failed: before={before:?}, after={after:?}"));
        }
        samples.push(json!({"edge": edge, "before": before, "after": after,
            "input_start": input_start, "input_end": input_end}));
    }
    x11_restore(window, baseline, enabled).await?;
    Ok(json!({"kind": "owned-x11-xtest-edge-drag", "enabled": enabled, "samples": samples}))
}

async fn exercise(main: tauri::WebviewWindow, missing: bool) -> Result<Value, String> {
    let baseline = x11_settled(&main, true, false, false, None, false).await?;
    let aux = main.app_handle().get_webview_window("pip").ok_or("Auxiliary fixture missing")?;
    let aux_before = x11_settled(&aux, false, false, false, None, true).await?;
    let mut denials = Vec::new();
    if missing {
        for (command, args) in [("set_always_on_top", json!({"alwaysOnTop": true})),
            ("set_fullscreen", json!({"fullscreen": true})), ("toggle_fullscreen", json!({})),
            ("get_window_aspect_lock", json!({})), ("set_window_aspect_lock", json!({"enabled": true}))] {
            denials.push(denied(&main, command, args).await?);
        }
        return Ok(json!({"status": "pass", "platform": "linux-x11", "mode": "missing-permission",
            "denials": denials, "baseline": baseline, "requested_content": [640,400]}));
    }
    for (command, args) in [("set_always_on_top", json!({"alwaysOnTop": true})),
        ("set_fullscreen", json!({"fullscreen": true})), ("toggle_fullscreen", json!({})),
        ("get_window_aspect_lock", json!({})), ("set_window_aspect_lock", json!({"enabled": true}))] {
        denials.push(denied(&aux, command, args).await?);
    }
    let initial_state = x11_aspect(&main, None, true, true).await?;
    x11_aspect(&main, Some(false), false, false).await?;
    let mut original = baseline.rect;
    original[2] = 640;
    original[3] = 400;
    let manual_before = x11_restore(&main, original, false).await?;
    let manual_state = x11_aspect(&main, Some(true), true, true).await?;
    let manual_after = x11_settled(&main, true, false, false, None, false).await?;
    if manual_before.rect[2..] == manual_after.rect[2..] {
        return Err("Manual enable did not normalize the non-16:9 native size".into());
    }
    let manual_enable = json!({"before": manual_before, "after": manual_after, "state": manual_state});
    x11_restore(&main, baseline.rect, true).await?;
    let mut sequence = Vec::new();
    for enabled in [true, true, false, false] {
        let before = x11_snapshot(&main).await?;
        let state = x11_aspect(&main, Some(enabled), enabled, enabled).await?;
        let native = x11_settled(&main, enabled, false, false, Some(before.rect), false).await?;
        sequence.push(json!({"requested": enabled, "before": before, "state": state, "native": native}));
    }
    x11_aspect(&main, Some(true), true, true).await?;
    let mut transitions = Vec::new();
    for explicit in [false, true] {
        for target in [true, false] {
            let reply = if explicit { allowed(&main, "set_fullscreen", json!({"fullscreen": target})).await? }
                else { allowed(&main, "toggle_fullscreen", json!({})).await? };
            if reply != json!({"ok": true, "fullscreen": target}) { return Err("Unconfirmed fullscreen transition".into()); }
            let native = x11_settled(&main, !target, target, false,
                if target { None } else { Some(baseline.rect) }, false).await?;
            let state = x11_aspect(&main, None, true, !target).await?;
            transitions.push(json!({"kind": if explicit { "set_fullscreen" } else { "toggle_fullscreen" },
                "target": target, "native": native, "state": state}));
        }
    }
    for target in [true, false] {
        (if target { main.maximize() } else { main.unmaximize() }).map_err(|e| e.to_string())?;
        let native = x11_settled(&main, !target, false, target,
            if target { None } else { Some(baseline.rect) }, false).await?;
        let state = x11_aspect(&main, None, true, !target).await?;
        transitions.push(json!({"kind": "maximize", "target": target, "native": native, "state": state}));
    }
    main.set_min_size(Some(tauri::PhysicalSize::new(400_u32, 225))).map_err(|e| e.to_string())?;
    main.set_max_size(Some(tauri::PhysicalSize::new(1280_u32, 720))).map_err(|e| e.to_string())?;
    let tight = x11_settled_bounds(&main, true, false, false, Some(baseline.rect), false,
        [[400, 225], [1280, 720]]).await?;
    main.set_min_size(Some(tauri::PhysicalSize::new(320_u32, 180))).map_err(|e| e.to_string())?;
    main.set_max_size(Some(tauri::PhysicalSize::new(1600_u32, 1000))).map_err(|e| e.to_string())?;
    let restored_bounds = x11_settled(&main, true, false, false, Some(baseline.rect), false).await?;
    let sizing_enabled = x11_drag_probe(&main, baseline.rect, true).await?;
    x11_aspect(&main, Some(false), false, false).await?;
    let sizing_disabled = x11_drag_probe(&main, baseline.rect, false).await?;
    let final_native = x11_settled(&main, false, false, false, Some(baseline.rect), false).await?;
    let final_state = x11_aspect(&main, None, false, false).await?;
    if x11_snapshot(&aux).await? != aux_before { return Err("Main changes altered the auxiliary X11 window".into()); }
    Ok(json!({"status": "pass", "platform": "linux-x11", "mode": "production-permissions",
        "requested_content": [640,400], "baseline": baseline, "initial_state": initial_state,
        "manual_enable": manual_enable, "set_sequence": sequence, "transitions": transitions,
        "bounds_updates": [tight, restored_bounds], "sizing_enabled": sizing_enabled,
        "sizing_disabled": sizing_disabled, "final": final_native,
        "final_state": final_state, "denials": denials, "aux_unchanged": true,
        "observation": "native X11 geometry and hints, with owned XTEST mouse drags through Tao edges"}))
}

async fn exercise_preference(main: tauri::WebviewWindow, phase: PreferencePhase) -> Result<Value, String> {
    let cold_off = matches!(phase, PreferencePhase::ColdOff);
    let initially_on = matches!(phase, PreferencePhase::Pin | PreferencePhase::Unpin);
    let initial = x11_settled(&main, initially_on, false, false, None, !initially_on).await?;
    let aux = main.app_handle().get_webview_window("pip").ok_or("Auxiliary fixture missing")?;
    let aux_before = x11_settled(&aux, false, false, false, None, true).await?;
    // Cold-off deliberately issues SET(false) before any GET/initialize, despite
    // saved ON. Its first snapshot proves the untouched 640x400 starting size.
    let initial_state = if cold_off { Value::Null }
        else { x11_aspect(&main, None, initially_on, initially_on).await? };
    let target = matches!(phase, PreferencePhase::Pin);
    let first_set = if !matches!(phase, PreferencePhase::VerifyOff) {
        Some(x11_aspect(&main, Some(target), target, target).await?)
    } else { None };
    let final_native = x11_settled(&main, target, false, false, Some(initial.rect), false).await?;
    let final_state = x11_aspect(&main, None, target, target).await?;
    if x11_snapshot(&aux).await? != aux_before { return Err("Saved state altered auxiliary X11 window".into()); }
    let mut report = json!({"status": "pass", "platform": "linux-x11", "mode": "preference-restoration",
        "phase": phase.name(), "requested_content": [640,400], "initial": initial,
        "initial_state": initial_state, "final": final_native, "final_state": final_state,
        "first_command": if cold_off { Some("set_window_aspect_lock") } else { None },
        "first_set": first_set, "aux_unchanged": true});
    if cold_off { report["startup_initialization_skipped"] = json!(true); }
    Ok(report)
}

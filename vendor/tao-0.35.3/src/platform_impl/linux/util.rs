use crate::{
  dpi::{LogicalPosition, LogicalSize, PhysicalPosition},
  error::ExternalError,
  window::WindowSizeConstraints,
};
use gtk::{
  gdk::{
    self,
    prelude::{DeviceExt, SeatExt},
    Display,
  },
  glib::{self},
  prelude::*,
};
use std::{cell::RefCell, rc::Rc};

#[inline]
pub fn cursor_position(is_wayland: bool) -> Result<PhysicalPosition<f64>, ExternalError> {
  if is_wayland {
    Ok((0, 0).into())
  } else {
    Display::default()
      .map(|d| {
        (
          d.default_seat().and_then(|s| s.pointer()),
          d.default_group(),
        )
      })
      .map(|(p, g)| {
        p.map(|p| {
          let (_, x, y) = p.position_double();
          LogicalPosition::new(x, y).to_physical(g.scale_factor() as _)
        })
      })
      .map(|p| p.ok_or(ExternalError::Os(os_error!(super::OsError))))
      .ok_or(ExternalError::Os(os_error!(super::OsError)))?
  }
}

pub fn set_size_constraints<W: GtkWindowExt + WidgetExt>(
  window: &W,
  constraints: WindowSizeConstraints,
) {
  let window = window.upcast_ref::<gtk::Window>();
  let state = match geometry_state(window) {
    Some(state) => state,
    None => {
      let state = Rc::new(RefCell::new(GeometryState {
        constraints,
        aspect: AspectState::default(),
        observed: false,
        applied: None,
      }));
      // This private key always owns this exact type, on GTK's main thread.
      unsafe { window.set_data(GEOMETRY_STATE, state.clone()) };
      state
    }
  };
  state.borrow_mut().constraints = constraints;
  publish_geometry(window, &state, true);
}

const GEOMETRY_STATE: &str = "tao-x11-geometry-state-v1";

#[derive(Clone, Copy, Default)]
struct AspectState {
  enabled: bool,
  fullscreen: Option<bool>,
  maximized: Option<bool>,
}

impl AspectState {
  fn active(self, native: gdk::WindowState, resizable: bool) -> bool {
    self.enabled
      && resizable
      && self.fullscreen.is_none()
      && self.maximized.is_none()
      && !native.intersects(
        gdk::WindowState::FULLSCREEN | gdk::WindowState::MAXIMIZED | gdk::WindowState::TILED,
      )
  }

  fn observe(&mut self, changed: gdk::WindowState, native: gdk::WindowState) {
    for (flag, pending) in [
      (gdk::WindowState::FULLSCREEN, &mut self.fullscreen),
      (gdk::WindowState::MAXIMIZED, &mut self.maximized),
    ] {
      if changed.contains(flag) && *pending == Some(native.contains(flag)) {
        *pending = None;
      }
    }
  }
}

struct GeometryState {
  constraints: WindowSizeConstraints,
  aspect: AspectState,
  observed: bool,
  applied: Option<bool>,
}

fn geometry_state(window: &gtk::Window) -> Option<Rc<RefCell<GeometryState>>> {
  // Clone the owner before any GTK call; signal reentry never holds a qdata borrow.
  unsafe {
    window
      .data::<Rc<RefCell<GeometryState>>>(GEOMETRY_STATE)
      .map(|state| state.as_ref().clone())
  }
}

fn native_state(window: &gtk::Window) -> gdk::WindowState {
  window
    .window()
    .map(|native| native.state())
    .unwrap_or_else(gdk::WindowState::empty)
}

fn publish_geometry(window: &gtk::Window, state: &Rc<RefCell<GeometryState>>, force: bool) {
  let (constraints, active, observed) = {
    let mut state = state.borrow_mut();
    let active = state
      .aspect
      .active(native_state(window), window.is_resizable());
    if !force && state.applied == Some(active) {
      return;
    }
    state.applied = Some(active);
    (state.constraints, active, state.observed)
  };
  let mut geom_mask = gdk::WindowHints::empty();
  if constraints.has_min() {
    geom_mask |= gdk::WindowHints::MIN_SIZE;
  }
  if constraints.has_max() {
    geom_mask |= gdk::WindowHints::MAX_SIZE;
  }
  if active {
    geom_mask |= gdk::WindowHints::ASPECT;
  }

  let scale_factor = window.scale_factor() as f64;

  let min_size: LogicalSize<i32> = constraints.min_size_logical(scale_factor);
  let max_size: LogicalSize<i32> = constraints.max_size_logical(scale_factor);

  let picky_none: Option<&gtk::Window> = None;
  window.set_geometry_hints(
    picky_none,
    Some(&gdk::Geometry::new(
      min_size.width,
      min_size.height,
      max_size.width,
      max_size.height,
      0,
      0,
      0,
      0,
      if active { 16.0 / 9.0 } else { 0.0 },
      if active { 16.0 / 9.0 } else { 0.0 },
      gdk::Gravity::Center,
    )),
    geom_mask,
  );
  if observed {
    // Flush GTK's own complete hints, including its requisition/min/max rules.
    // This may normalize the current size. Do not pump events or issue a second
    // competing GDK/Xlib hints write; later GTK layout uses this same geometry.
    #[allow(deprecated)]
    window.check_resize();
  }
}

/// Suspend before the native request, not after its first configure. Only the
/// matching state event may retire this barrier; an unrelated focus event cannot
/// re-arm the ratio while a fullscreen/maximize request is still pending.
/// If a WM ignores/coalesces the request without a state event, remain inactive;
/// a timeout or a passive query cannot prove the native transition is complete.
pub(crate) fn aspect_transition<W: GtkWindowExt + WidgetExt>(
  window: &W,
  flag: gdk::WindowState,
  enabled: bool,
) {
  let window = window.upcast_ref::<gtk::Window>();
  let Some(state) = geometry_state(window) else {
    return;
  };
  {
    let mut state = state.borrow_mut();
    let pending = if flag == gdk::WindowState::FULLSCREEN {
      &mut state.aspect.fullscreen
    } else {
      &mut state.aspect.maximized
    };
    if pending.is_some() || native_state(window).contains(flag) != enabled {
      *pending = Some(enabled);
    }
  }
  publish_geometry(window, &state, false);
}

pub(crate) fn gtk_window_aspect_lock(
  window: &gtk::ApplicationWindow,
  enabled: Option<bool>,
) -> Result<Option<(bool, bool)>, String> {
  let window = window.upcast_ref::<gtk::Window>();
  if !cfg!(feature = "x11") || !window.display().backend().is_x11() {
    // GTK3 Wayland retains ASPECT during fixed-state configure processing. Its
    // missing preconfigure policy must not be replaced with a late resize loop.
    return Ok(None);
  }
  let state = geometry_state(window).ok_or("Window has no Tao geometry owner")?;
  if enabled.is_some() && !state.borrow().observed {
    {
      let native = native_state(window);
      let mut state = state.borrow_mut();
      state.observed = true;
      state.aspect.observe(
        gdk::WindowState::FULLSCREEN | gdk::WindowState::MAXIMIZED,
        native,
      );
    }
    window.connect_window_state_event(|window, event| {
      if let Some(state) = geometry_state(window) {
        let native = native_state(window);
        state
          .borrow_mut()
          .aspect
          .observe(event.changed_mask(), native);
        publish_geometry(window, &state, false);
      }
      glib::Propagation::Proceed
    });
    window.connect_resizable_notify(|window| {
      if let Some(state) = geometry_state(window) {
        publish_geometry(window, &state, false);
      }
    });
    window.connect_scale_factor_notify(|window| {
      if let Some(state) = geometry_state(window) {
        publish_geometry(window, &state, true);
      }
    });
  }
  let previous = state.borrow().aspect.enabled;
  if let Some(enabled) = enabled {
    state.borrow_mut().aspect.enabled = enabled;
    publish_geometry(window, &state, true);
  }
  let aspect = state.borrow().aspect;
  let expected = aspect.active(native_state(window), window.is_resizable());
  let actual = x11_aspect(window).and_then(|actual| {
    if enabled.is_some() && actual != Some(expected) {
      Err("GTK did not publish the requested native aspect constraint".into())
    } else {
      Ok(actual)
    }
  });
  let actual = match actual {
    Ok(actual) => actual,
    Err(error) => {
      if enabled.is_some() {
        // Do not leave a failed SET queued in GTK or remembered by later native
        // state callbacks. Geometry already changed by a WM is not rolled back.
        state.borrow_mut().aspect.enabled = previous;
        publish_geometry(window, &state, true);
      }
      return Err(error);
    }
  };
  // A passive read does not publish hints, normalize size, or infer the native
  // constraint from our preference. A mismatched/foreign hint is never active.
  Ok(Some((aspect.enabled, expected && actual == Some(true))))
}

#[cfg(feature = "x11")]
fn x11_aspect(window: &gtk::Window) -> Result<Option<bool>, String> {
  use x11_dl::xlib;

  let native = window.window().ok_or("Native window is not realized")?;
  let display = window.display();
  let xlib = xlib::Xlib::open().map_err(|_| "X11 hints reader unavailable")?;
  // The caller proved this is an X11 GTK window. Use GTK's connection and its
  // error trap; do not open a second display or install a global X error handler.
  unsafe {
    let gd = display.as_ptr() as *mut gdkx11_sys::GdkX11Display;
    let xdisplay = gdkx11_sys::gdk_x11_display_get_xdisplay(gd);
    let xid =
      gdkx11_sys::gdk_x11_window_get_xid(native.as_ptr() as *mut gdkx11_sys::GdkX11Window);
    if xdisplay.is_null() || xid == 0 {
      return Err("Native X11 window is unavailable".into());
    }
    let mut hints: xlib::XSizeHints = std::mem::zeroed();
    let mut supplied = 0;
    gdkx11_sys::gdk_x11_display_error_trap_push(gd);
    let found = (xlib.XGetWMNormalHints)(xdisplay.cast(), xid, &mut hints, &mut supplied);
    let error = gdkx11_sys::gdk_x11_display_error_trap_pop(gd);
    if error != 0 || found == 0 {
      return Err("Native X11 geometry hints are unavailable".into());
    }
    if hints.flags & xlib::PAspect == 0 {
      return Ok(Some(false));
    }
    let exact = |x: i32, y: i32| x > 0 && y > 0 && i64::from(x) * 9 == i64::from(y) * 16;
    Ok((exact(hints.min_aspect.x, hints.min_aspect.y)
      && exact(hints.max_aspect.x, hints.max_aspect.y))
      .then_some(true))
  }
}

#[cfg(not(feature = "x11"))]
fn x11_aspect(_window: &gtk::Window) -> Result<Option<bool>, String> {
  Err("X11 support is unavailable".into())
}

pub struct WindowMaximizeProcess<W: GtkWindowExt + WidgetExt> {
  window: W,
  resizable: bool,
  step: u8,
}

impl<W: GtkWindowExt + WidgetExt> WindowMaximizeProcess<W> {
  pub fn new(window: W, resizable: bool) -> Rc<RefCell<Self>> {
    aspect_transition(&window, gdk::WindowState::MAXIMIZED, true);
    Rc::new(RefCell::new(Self {
      window,
      resizable,
      step: 0,
    }))
  }

  pub fn next_step(&mut self) -> glib::ControlFlow {
    match self.step {
      0 => {
        self.window.set_resizable(true);
        self.step += 1;
        glib::ControlFlow::Continue
      }
      1 => {
        self.window.maximize();
        self.step += 1;
        glib::ControlFlow::Continue
      }
      2 => {
        self.window.set_resizable(self.resizable);
        glib::ControlFlow::Break
      }
      _ => glib::ControlFlow::Break,
    }
  }
}

#[cfg(test)]
mod aspect_tests {
  use super::AspectState;
  use gtk::gdk::WindowState;

  #[test]
  fn fixed_state_request_does_not_rearm_on_stale_or_unrelated_native_events() {
    for flag in [WindowState::FULLSCREEN, WindowState::MAXIMIZED] {
      let mut state = AspectState {
        enabled: true,
        ..AspectState::default()
      };
      if flag == WindowState::FULLSCREEN {
        state.fullscreen = Some(true);
      } else {
        state.maximized = Some(true);
      }
      state.observe(WindowState::FOCUSED, WindowState::empty());
      state.observe(flag, WindowState::empty());
      assert!(!state.active(WindowState::empty(), true));
      state.observe(flag, flag);
      assert!(!state.active(flag, true));
      if flag == WindowState::FULLSCREEN {
        state.fullscreen = Some(false);
      } else {
        state.maximized = Some(false);
      }
      state.observe(WindowState::FOCUSED, WindowState::empty());
      assert!(!state.active(WindowState::empty(), true));
      state.observe(flag, WindowState::empty());
      assert!(state.active(WindowState::empty(), true));
    }
  }

  #[test]
  fn explicit_off_survives_restore_and_does_not_change_another_window() {
    let other = AspectState {
      enabled: true,
      ..AspectState::default()
    };
    let mut state = AspectState {
      enabled: false,
      fullscreen: Some(false),
      maximized: Some(false),
    };
    state.observe(
      WindowState::FULLSCREEN | WindowState::MAXIMIZED,
      WindowState::empty(),
    );
    assert!(!state.active(WindowState::empty(), true));
    assert!(other.active(WindowState::empty(), true));
    for native in [WindowState::FULLSCREEN, WindowState::MAXIMIZED, WindowState::TILED] {
      assert!(!other.active(native, true));
    }
    assert!(!other.active(WindowState::empty(), false));
  }
}

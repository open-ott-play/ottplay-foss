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
  glib::{self, prelude::ObjectExt},
  traits::{GtkWindowExt, WidgetExt},
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

// This private qdata is shared by Tao size-constraint updates and the explicit
// desktop aspect control, so neither can erase the other's geometry hints.
const ASPECT_STATE: &str = "ottplay-tao-content-aspect-v1";
struct GeometryState {
  constraints: WindowSizeConstraints,
  enabled: bool,
  active: bool,
}
fn geometry_state<W: GtkWindowExt + WidgetExt>(window: &W) -> Option<Rc<RefCell<GeometryState>>> {
  // Only this module sets the private key, with exactly this concrete type.
  unsafe {
    window
      .data::<Rc<RefCell<GeometryState>>>(ASPECT_STATE)
      .map(|v| v.as_ref().clone())
  }
}
fn aspect_active(enabled: bool, state: gdk::WindowState) -> bool {
  enabled
    && !state.intersects(
      gdk::WindowState::ICONIFIED
        | gdk::WindowState::MAXIMIZED
        | gdk::WindowState::FULLSCREEN
        | gdk::WindowState::TILED
        | gdk::WindowState::TOP_TILED
        | gdk::WindowState::RIGHT_TILED
        | gdk::WindowState::BOTTOM_TILED
        | gdk::WindowState::LEFT_TILED,
    )
}
fn apply_geometry<W: GtkWindowExt + WidgetExt>(
  window: &W,
  value: &mut GeometryState,
  state: gdk::WindowState,
) -> bool {
  let constraints = &value.constraints;
  let mut geom_mask = gdk::WindowHints::empty();
  if constraints.has_min() {
    geom_mask |= gdk::WindowHints::MIN_SIZE;
  }
  if constraints.has_max() {
    geom_mask |= gdk::WindowHints::MAX_SIZE;
  }
  let active = aspect_active(value.enabled, state);
  if active {
    geom_mask |= gdk::WindowHints::ASPECT;
  }
  let ratio = if active { 16.0 / 9.0 } else { 0.0 };
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
      ratio,
      ratio,
      gdk::Gravity::Center,
    )),
    geom_mask,
  );
  value.active = active;
  active
}
pub fn set_size_constraints<W: GtkWindowExt + WidgetExt>(
  window: &W,
  constraints: WindowSizeConstraints,
) {
  let value = match geometry_state(window) {
    Some(value) => {
      value.borrow_mut().constraints = constraints;
      value
    }
    None => {
      let value = Rc::new(RefCell::new(GeometryState {
        constraints,
        enabled: false,
        active: false,
      }));
      unsafe {
        window.set_data(ASPECT_STATE, value.clone());
      }
      // Native state notifications only replace hints; they never resize the window.
      window.connect_window_state_event(|window, event| {
        if let Some(value) = geometry_state(window) {
          let mut value = value.borrow_mut();
          if value.active != aspect_active(value.enabled, event.new_window_state()) {
            apply_geometry(window, &mut value, event.new_window_state());
          }
        }
        glib::Propagation::Proceed
      });
      value
    }
  };
  let state = window
    .window()
    .map(|w| w.state())
    .unwrap_or_else(gdk::WindowState::empty);
  apply_geometry(window, &mut value.borrow_mut(), state);
}
pub(crate) fn set_content_aspect_lock(
  window: &gtk::ApplicationWindow,
  enabled: Option<bool>,
) -> Result<Option<(bool, bool)>, &'static str> {
  if !gtk::is_initialized_main_thread() {
    return Err("Aspect constraint requires the GTK thread");
  }
  let native = window.window().ok_or("Native window unavailable")?;
  // GDK Wayland does apply aspect hints, but applies the first fixed-state
  // configure before its state event. Clearing ASPECT here is too late for that
  // transition. Do not claim support until that lifecycle seam is qualified.
  if native.display().type_().name() != "GdkX11Display" {
    return Ok(None);
  }
  let value = geometry_state(window).ok_or("Tao geometry state unavailable")?;
  let mut value = value.borrow_mut();
  if let Some(enabled) = enabled {
    if value.enabled != enabled {
      value.enabled = enabled;
      apply_geometry(window, &mut value, native.state());
    }
  }
  // Queries do not enqueue GTK resize/layout work.
  Ok(Some((
    value.enabled,
    value.active && aspect_active(value.enabled, native.state()),
  )))
}

pub struct WindowMaximizeProcess<W: GtkWindowExt + WidgetExt> {
  window: W,
  resizable: bool,
  step: u8,
}

impl<W: GtkWindowExt + WidgetExt> WindowMaximizeProcess<W> {
  pub fn new(window: W, resizable: bool) -> Rc<RefCell<Self>> {
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

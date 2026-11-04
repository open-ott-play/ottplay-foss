pub fn apply(
    window: &tauri::Window,
    enabled: Option<bool>,
) -> Result<Option<(bool, bool)>, String> {
    let native = window.gtk_window().map_err(|e| e.to_string())?;
    tao::platform::unix::set_content_aspect_lock(&native, enabled)
        .map_err(|error| error.to_string())
}

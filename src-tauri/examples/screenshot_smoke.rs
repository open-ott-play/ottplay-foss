//! Run on a logged-in macOS desktop:
//! cargo run -p ottplay-tauri --example screenshot_smoke --locked -- /tmp/ottplay-screenshot-smoke
//!
//! This opens only its own incognito fixture window. It does not launch the
//! installed player, use player profiles, access the network or capture a desktop.

#[cfg(target_os = "macos")]
#[path = "../src/commands/screenshot.rs"]
mod screenshot;

#[cfg(target_os = "macos")]
mod smoke {
    use super::screenshot;
    use base64::Engine;
    use objc2_app_kit::NSBitmapImageRep;
    use objc2_foundation::NSData;
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;
    use tauri::Manager;

    static STARTED: AtomicBool = AtomicBool::new(false);

    async fn frame(
        window: &tauri::WebviewWindow,
        name: &str,
        expected: [usize; 3],
        output: &std::path::Path,
    ) -> Result<Value, String> {
        let value = screenshot::capture_screenshot(window.clone()).await?;
        let value = serde_json::to_value(value).map_err(|error| error.to_string())?;
        let png = base64::engine::general_purpose::STANDARD
            .decode(value["image"].as_str().ok_or("Image missing")?)
            .map_err(|error| error.to_string())?;
        let width = value["width"].as_u64().ok_or("Width missing")?;
        let height = value["height"].as_u64().ok_or("Height missing")?;
        if width == 0 || height == 0 || width > 1280 || height > 720 || png.len() > 1048576 {
            return Err(format!(
                "Invalid image bounds: {width}x{height}, {} bytes",
                png.len()
            ));
        }
        let bitmap = NSBitmapImageRep::imageRepWithData(&NSData::with_bytes(&png))
            .ok_or("Native capture is not a decodable PNG")?;
        if bitmap.pixelsWide() != width as isize || bitmap.pixelsHigh() != height as isize {
            return Err("PNG dimensions do not match the native response".into());
        }
        let mut rgb = [0usize; 4];
        if bitmap.samplesPerPixel() < 3 || bitmap.samplesPerPixel() > 4 {
            return Err("Unexpected captured PNG color format".into());
        }
        // SAFETY: the four-component destination is large enough for RGB(A).
        unsafe {
            bitmap.getPixel_atX_y(std::ptr::NonNull::new(rgb.as_mut_ptr()).unwrap(), 20, 20);
        }
        for channel in 0..3 {
            if rgb[channel].abs_diff(expected[channel]) > 4 {
                return Err(format!("{name}: expected {expected:?}, captured {rgb:?}"));
            }
        }
        if value["source"] != "player-view" || value["video"] != "unknown" {
            return Err("Native capture returned incorrect provenance".into());
        }
        std::fs::write(output.join(format!("{name}.png")), &png)
            .map_err(|error| error.to_string())?;
        Ok(json!({"phase": name, "width": width, "height": height,
            "bytes": png.len(), "rgb": &rgb[..3], "source": value["source"], "video": value["video"]}))
    }

    async fn exercise(window: tauri::WebviewWindow, output: PathBuf) -> Result<Value, String> {
        let caps = screenshot::screenshot_capabilities(window.clone())?;
        let caps = serde_json::to_value(caps).map_err(|error| error.to_string())?;
        if caps != json!({"supported": true, "source": "player-view"}) {
            return Err("Native screenshot capability probe failed".into());
        }
        let other = window
            .app_handle()
            .get_webview_window("not-main")
            .ok_or("Auxiliary fixture missing")?;
        if screenshot::screenshot_capabilities(other.clone()).is_ok()
            || screenshot::capture_screenshot(other).await.is_ok()
        {
            return Err("A non-main view could capture pixels".into());
        }
        // Wait for the test document's first paint; capture itself still goes
        // through the production with_webview + asynchronous WKWebView callback.
        tokio::time::sleep(Duration::from_millis(350)).await;
        let red = frame(&window, "red", [220, 35, 45], &output).await?;
        window
            .eval("document.body.style.background='rgb(30,80,230)'")
            .map_err(|error| error.to_string())?;
        tokio::time::sleep(Duration::from_millis(150)).await;
        let blue = frame(&window, "blue", [30, 80, 230], &output).await?;
        window
            .set_size(tauri::LogicalSize::new(320.0, 640.0))
            .map_err(|error| error.to_string())?;
        tokio::time::sleep(Duration::from_millis(150)).await;
        let portrait = frame(&window, "portrait", [30, 80, 230], &output).await?;
        if portrait["height"].as_u64().unwrap() <= portrait["width"].as_u64().unwrap() {
            return Err(
                "Resized portrait view was stretched to previous landscape dimensions".into(),
            );
        }
        Ok(
            json!({"status": "pass", "implementation": "production screenshot.rs",
            "capabilities": caps, "non_main_rejected": true,
            "incognito": true, "profile": "isolated fixture", "frames": [red, blue, portrait]}),
        )
    }

    pub fn run() -> Result<i32, Box<dyn std::error::Error>> {
        let output = std::env::args()
            .nth(1)
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir()
                    .join(format!("ottplay-screenshot-smoke-{}", std::process::id()))
            });
        std::fs::create_dir_all(&output)?;
        let result_output = output.clone();
        let app = tauri::Builder::default()
            .setup(|app| {
                tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("OttPlay own-view screenshot regression")
                .inner_size(640.0, 360.0)
                .decorations(false)
                .incognito(true)
                .build()?;
                tauri::WebviewWindowBuilder::new(
                    app,
                    "not-main",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .visible(false)
                .incognito(true)
                .build()?;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(25)).await;
                    eprintln!("Native screenshot smoke watchdog timed out");
                    handle.exit(1);
                });
                Ok(())
            })
            .on_page_load(move |view, payload| {
                if view.label() != "main"
                    || payload.event() != tauri::webview::PageLoadEvent::Finished
                    || STARTED.swap(true, Ordering::SeqCst)
                {
                    return;
                }
                let handle = view.app_handle().clone();
                let window = handle
                    .get_webview_window("main")
                    .expect("main fixture window");
                let output = result_output.clone();
                tauri::async_runtime::spawn(async move {
                    let result = exercise(window, output.clone()).await;
                    let code = if result.is_ok() { 0 } else { 1 };
                    let report =
                        result.unwrap_or_else(|error| json!({"status": "fail", "error": error}));
                    let report = serde_json::to_string_pretty(&report).unwrap();
                    let _ = std::fs::write(output.join("result.json"), &report);
                    println!("{report}");
                    handle.exit(code);
                });
            })
            .build(tauri::generate_context!(
                "examples/screenshot-smoke/tauri.conf.json"
            ))?;
        Ok(app.run_return(|_, _| {}))
    }
}

#[cfg(target_os = "macos")]
fn main() {
    match smoke::run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("Native screenshot smoke failed: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This real WKWebView regression requires a logged-in macOS desktop.");
    std::process::exit(2);
}

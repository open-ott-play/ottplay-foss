//! Lazily started, instance-owned media services. No listener or swarm at app launch.
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tokio::sync::{watch, Mutex};

struct Runtime {
    generation: u64,
    endpoint: String,
    service: ottplay_core::companion::Companion,
    stop: watch::Sender<bool>,
}

#[derive(Default)]
pub struct CompanionState(Mutex<Option<Runtime>>, AtomicU64);

impl CompanionState {
    pub fn advance_page(&self) -> u64 {
        self.1.fetch_add(1, Ordering::SeqCst) + 1
    }
    pub async fn stop_before(&self, generation: u64) {
        let mut state = self.0.lock().await;
        if state
            .as_ref()
            .is_some_and(|runtime| runtime.generation < generation)
        {
            if let Some(runtime) = state.take() {
                runtime.service.shutdown().await;
                let _ = runtime.stop.send(true);
            }
        }
    }
    pub async fn stop(&self) {
        let mut state = self.0.lock().await;
        if let Some(runtime) = state.take() {
            runtime.service.shutdown().await;
            let _ = runtime.stop.send(true);
        }
    }
}

#[derive(Serialize)]
pub struct Endpoint {
    endpoint: String,
}

#[derive(Serialize)]
pub struct Capabilities {
    schema: u8,
    local: bool,
    available: bool,
    torrent: bool,
    plugins: bool,
}

fn installed_capabilities(window_label: &str) -> Result<Capabilities, String> {
    if window_label != "main" {
        return Err("Media services are controlled by the main player".into());
    }
    Ok(Capabilities {
        schema: 1,
        local: true,
        available: true,
        torrent: true,
        plugins: true,
    })
}

/// Reports compiled-in support without touching storage, listeners or sessions.
#[tauri::command]
pub fn companion_capabilities(window: WebviewWindow) -> Result<Capabilities, String> {
    installed_capabilities(window.label())
}

#[tauri::command]
pub async fn companion_endpoint(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, CompanionState>,
) -> Result<Endpoint, String> {
    if window.label() != "main" {
        return Err("Media services are controlled by the main player".into());
    }
    let background = app.state::<ottplay_core::background_work::BackgroundWork>();
    let work = background.enter().map_err(str::to_string)?;
    let generation = state.1.load(Ordering::SeqCst);
    let mut current = work.run(state.0.lock()).await.map_err(str::to_string)?;
    if generation != state.1.load(Ordering::SeqCst) {
        return Err("Media service request belongs to a previous page".into());
    }
    if let Some(runtime) = current.as_ref() {
        if runtime.generation == generation {
            return Ok(Endpoint {
                endpoint: runtime.endpoint.clone(),
            });
        }
    }
    if let Some(runtime) = current.take() {
        runtime.service.shutdown().await;
        let _ = runtime.stop.send(true);
    }
    let root = crate::instance::app_data_dir(&app)?.join("media-companion");
    let plugin_dir = root.join("plugins");
    work.run(tokio::fs::create_dir_all(&plugin_dir))
        .await
        .map_err(str::to_string)?
        .map_err(|_| "Media services storage unavailable")?;
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let service = work
        .run(ottplay_core::companion::Companion::new(
            root,
            token,
            Some(plugin_dir),
        ))
        .await
        .map_err(str::to_string)?
        .map_err(|_| "Media services unavailable")?;
    let listener = work
        .run(tokio::net::TcpListener::bind("127.0.0.1:0"))
        .await
        .map_err(str::to_string)?
        .map_err(|_| "Media services listener unavailable")?;
    let address = listener
        .local_addr()
        .map_err(|_| "Media services listener unavailable")?;
    let endpoint = format!("http://{address}{}", service.endpoint());
    let router = service.routes();
    let (stop, mut stopped) = watch::channel(false);
    if generation != state.1.load(Ordering::SeqCst) {
        service.shutdown().await;
        return Err("Media service request belongs to a previous page".into());
    }
    work.publish(|| {
        tauri::async_runtime::spawn(async move {
            let result = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    while !*stopped.borrow_and_update() {
                        if stopped.changed().await.is_err() {
                            break;
                        }
                    }
                })
                .await;
            if result.is_err() {
                tracing::warn!("Media services listener stopped");
            }
        });
        *current = Some(Runtime {
            generation,
            endpoint: endpoint.clone(),
            service,
            stop,
        });
    })
    .map_err(str::to_string)?;
    Ok(Endpoint { endpoint })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn capabilities_report_support_without_starting_a_runtime() {
        let state = CompanionState::default();
        let capabilities = installed_capabilities("main").unwrap();
        assert_eq!(
            serde_json::to_value(capabilities).unwrap(),
            serde_json::json!({
                "schema": 1, "local": true, "available": true, "torrent": true, "plugins": true
            })
        );
        assert!(state.0.lock().await.is_none());
        assert!(installed_capabilities("pip").is_err());
    }

    #[tokio::test]
    async fn delayed_old_page_cleanup_preserves_current_runtime() {
        let state = CompanionState::default();
        let generation = state.advance_page();
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let service = ottplay_core::companion::Companion::new(root.clone(), "x".repeat(64), None)
            .await
            .unwrap();
        let (stop, stopped) = watch::channel(false);
        *state.0.lock().await = Some(Runtime {
            generation,
            endpoint: String::new(),
            service,
            stop,
        });
        state.stop_before(generation).await;
        assert!(state.0.lock().await.is_some());
        assert!(!*stopped.borrow());
        let next = state.advance_page();
        state.stop_before(next).await;
        assert!(state.0.lock().await.is_none());
        assert!(*stopped.borrow());
        let _ = tokio::fs::remove_dir_all(root).await;
    }
}

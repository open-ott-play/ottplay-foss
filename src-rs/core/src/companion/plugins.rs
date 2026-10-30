//! Packaged, bounded resolver execution. Scripts are installed by the operator,
//! never uploaded by an HTTP caller. Each request receives a fresh QuickJS VM.
//!
//! No module loader, timers or filesystem API is exposed. A local manifest may
//! opt into bounded HTTPS text reads restricted to exact public hostnames.

#[path = "plugin_network.rs"]
mod network;

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rquickjs::{Context, Function, Runtime, Value};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub const MAX_INPUT_BYTES: usize = 64 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 128 * 1024;
pub const MAX_STREAMS: usize = 128;
const MAX_PLUGINS: usize = 32;
const MAX_DIRECTORY_ENTRIES: usize = 128;
const MAX_MANIFEST_BYTES: usize = 8 * 1024;
const MAX_SCRIPT_BYTES: usize = 64 * 1024;
const MAX_HOSTS: usize = 16;
const MEMORY_BYTES: usize = 16 * 1024 * 1024;
const STACK_BYTES: usize = 256 * 1024;
const CONCURRENCY: usize = 2;
const EXECUTION_TIMEOUT: Duration = Duration::from_secs(2);
const DIRECT_SCRIPT: &str = include_str!("../../../../plugins/examples/direct-url.js");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginError {
    InvalidManifest,
    InvalidScript,
    NotFound,
    InvalidInput,
    InvalidOutput,
    Busy,
    Cancelled,
    TimedOut,
    ExecutionFailed,
    NetworkDenied,
    NetworkFailed,
    NetworkLimit,
}

impl PluginError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidManifest => "plugin_invalid_manifest",
            Self::InvalidScript => "plugin_invalid_script",
            Self::NotFound => "plugin_not_found",
            Self::InvalidInput => "plugin_invalid_input",
            Self::InvalidOutput => "plugin_invalid_output",
            Self::Busy => "plugin_busy",
            Self::Cancelled => "plugin_cancelled",
            Self::TimedOut => "plugin_timed_out",
            Self::ExecutionFailed => "plugin_execution_failed",
            Self::NetworkDenied => "plugin_network_denied",
            Self::NetworkFailed => "plugin_network_failed",
            Self::NetworkLimit => "plugin_network_limit",
        }
    }
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for PluginError {}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub api_version: u8,
    pub builtin: bool,
    pub network: bool,
    pub allowed_hosts: Vec<String>,
    pub max_input_bytes: usize,
    pub max_output_bytes: usize,
    pub max_streams: usize,
    pub memory_limit_bytes: usize,
    pub timeout_ms: u64,
    pub max_network_calls: usize,
    pub max_fetch_bytes: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    id: String,
    name: String,
    api_version: u8,
    script: String,
    sha256: String,
    allowed_hosts: Vec<String>,
    #[serde(default)]
    network: bool,
}

#[derive(Clone)]
struct Plugin {
    info: PluginInfo,
    source: Arc<str>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PluginStream {
    pub title: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PluginOutput {
    pub streams: Vec<PluginStream>,
}

#[derive(Clone)]
pub struct PluginService {
    plugins: Arc<BTreeMap<String, Plugin>>,
    slots: Arc<Semaphore>,
}

fn info(id: String, name: String, builtin: bool, allowed_hosts: Vec<String>) -> PluginInfo {
    PluginInfo {
        id,
        name,
        api_version: 1,
        builtin,
        network: false,
        allowed_hosts,
        max_input_bytes: MAX_INPUT_BYTES,
        max_output_bytes: MAX_OUTPUT_BYTES,
        max_streams: MAX_STREAMS,
        memory_limit_bytes: MEMORY_BYTES,
        timeout_ms: EXECUTION_TIMEOUT.as_millis() as u64,
        max_network_calls: 0,
        max_fetch_bytes: 0,
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn valid_text(value: &str, limit: usize) -> bool {
    !value.is_empty()
        && value.len() <= limit
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn normalize_host(value: &str) -> Result<String, PluginError> {
    // A hostname is not a URL, glob, path, userinfo or host:port expression.
    if value.is_empty()
        || value.len() > 253
        || !value.is_ascii()
        || value
            .bytes()
            .any(|b| !(b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.')))
        || value.starts_with('.')
        || value.ends_with('.')
        || value.split('.').any(|label| {
            label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-')
        })
    {
        return Err(PluginError::InvalidManifest);
    }
    let url = reqwest::Url::parse(&format!("https://{value}/"))
        .map_err(|_| PluginError::InvalidManifest)?;
    let host = url.host_str().ok_or(PluginError::InvalidManifest)?;
    // Reject alternate IP spellings, including integer and octal forms.
    if host != value.to_ascii_lowercase() {
        return Err(PluginError::InvalidManifest);
    }
    Ok(host.to_owned())
}

fn read_regular(path: &Path, max_bytes: usize) -> Result<Vec<u8>, PluginError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| PluginError::InvalidManifest)?;
    if !metadata.is_file() || metadata.len() > max_bytes as u64 {
        return Err(PluginError::InvalidManifest);
    }
    let file = File::open(path).map_err(|_| PluginError::InvalidManifest)?;
    if !file
        .metadata()
        .map_err(|_| PluginError::InvalidManifest)?
        .is_file()
    {
        return Err(PluginError::InvalidManifest);
    }
    let mut bytes = Vec::new();
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PluginError::InvalidManifest)?;
    if bytes.len() > max_bytes {
        return Err(PluginError::InvalidManifest);
    }
    Ok(bytes)
}

fn load_plugin(directory: &Path) -> Result<Plugin, PluginError> {
    let bytes = read_regular(&directory.join("manifest.json"), MAX_MANIFEST_BYTES)?;
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| PluginError::InvalidManifest)?;
    if !valid_id(&manifest.id)
        || !valid_text(&manifest.name, 128)
        || manifest.api_version != 1
        || manifest.allowed_hosts.len() > MAX_HOSTS
        || manifest.sha256.len() != 64
        || !manifest.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || !manifest.script.ends_with(".js")
        || manifest.script.len() > 128
        || !manifest
            .script
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        || manifest.script.starts_with('.')
    {
        return Err(PluginError::InvalidManifest);
    }
    let mut hosts = BTreeSet::new();
    for host in manifest.allowed_hosts {
        if !hosts.insert(normalize_host(&host)?) {
            return Err(PluginError::InvalidManifest);
        }
    }
    let source = read_regular(&directory.join(&manifest.script), MAX_SCRIPT_BYTES)
        .map_err(|_| PluginError::InvalidScript)?;
    if source.is_empty()
        || format!("{:x}", Sha256::digest(&source)) != manifest.sha256.to_ascii_lowercase()
    {
        return Err(PluginError::InvalidScript);
    }
    let source = String::from_utf8(source).map_err(|_| PluginError::InvalidScript)?;
    if manifest.network && hosts.is_empty() {
        return Err(PluginError::InvalidManifest);
    }
    let mut descriptor = info(
        manifest.id,
        manifest.name,
        false,
        hosts.into_iter().collect(),
    );
    descriptor.network = manifest.network;
    if descriptor.network {
        descriptor.max_network_calls = network::MAX_CALLS;
        descriptor.max_fetch_bytes = network::MAX_FETCH_BYTES;
    }
    Ok(Plugin {
        info: descriptor,
        source: Arc::from(source),
    })
}

impl PluginService {
    /// Read immutable resolver packages from immediate subdirectories. Failure
    /// rejects the configured set rather than silently hiding a broken package.
    pub fn load(directory: Option<&Path>) -> Result<Self, PluginError> {
        let builtin = Plugin {
            info: info(
                "direct-url".into(),
                "Direct video URL".into(),
                true,
                Vec::new(),
            ),
            source: Arc::from(DIRECT_SCRIPT),
        };
        let mut plugins = BTreeMap::from([(builtin.info.id.clone(), builtin)]);
        if let Some(directory) = directory {
            if !fs::symlink_metadata(directory)
                .map_err(|_| PluginError::InvalidManifest)?
                .is_dir()
            {
                return Err(PluginError::InvalidManifest);
            }
            for (count, entry) in fs::read_dir(directory)
                .map_err(|_| PluginError::InvalidManifest)?
                .enumerate()
            {
                if count >= MAX_DIRECTORY_ENTRIES {
                    return Err(PluginError::InvalidManifest);
                }
                let entry = entry.map_err(|_| PluginError::InvalidManifest)?;
                let kind = entry
                    .file_type()
                    .map_err(|_| PluginError::InvalidManifest)?;
                if kind.is_symlink() {
                    return Err(PluginError::InvalidManifest);
                }
                if !kind.is_dir() {
                    continue;
                }
                if plugins.len() > MAX_PLUGINS {
                    return Err(PluginError::InvalidManifest);
                }
                let plugin = load_plugin(&entry.path())?;
                if plugins.insert(plugin.info.id.clone(), plugin).is_some() {
                    return Err(PluginError::InvalidManifest);
                }
            }
        }
        Ok(Self {
            plugins: Arc::new(plugins),
            slots: Arc::new(Semaphore::new(CONCURRENCY)),
        })
    }

    pub fn list(&self) -> Vec<PluginInfo> {
        self.plugins
            .values()
            .map(|plugin| plugin.info.clone())
            .collect()
    }

    /// Admission has no unbounded waiting queue. A dropped HTTP request cancels
    /// its VM, but its slot stays occupied until the blocking worker has exited.
    pub async fn resolve(
        &self,
        id: &str,
        input: JsonValue,
        cancel: CancellationToken,
    ) -> Result<PluginOutput, PluginError> {
        let plugin = self.plugins.get(id).cloned().ok_or(PluginError::NotFound)?;
        if !input.is_object() {
            return Err(PluginError::InvalidInput);
        }
        let input = serde_json::to_vec(&input).map_err(|_| PluginError::InvalidInput)?;
        if input.len() > MAX_INPUT_BYTES {
            return Err(PluginError::InvalidInput);
        }
        if cancel.is_cancelled() {
            return Err(PluginError::Cancelled);
        }
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| PluginError::Busy)?;
        let cancel = cancel.child_token();
        let _cancel_on_drop = CancelOnDrop(cancel.clone());
        let worker_cancel = cancel.clone();
        let deadline = Instant::now() + EXECUTION_TIMEOUT;
        let runtime = tokio::runtime::Handle::current();
        let worker = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            execute(&plugin, &input, worker_cancel, deadline, Some(runtime))
        });
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(PluginError::Cancelled),
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => Err(PluginError::TimedOut),
            result = worker => result.map_err(|_| PluginError::ExecutionFailed)?,
        }
    }
}

struct CancelOnDrop(CancellationToken);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

fn check_budget(cancel: &CancellationToken, deadline: Instant) -> Result<(), PluginError> {
    if cancel.is_cancelled() {
        Err(PluginError::Cancelled)
    } else if Instant::now() >= deadline {
        Err(PluginError::TimedOut)
    } else {
        Ok(())
    }
}

fn validate_output(plugin: &Plugin, bytes: &[u8]) -> Result<PluginOutput, PluginError> {
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err(PluginError::InvalidOutput);
    }
    let output: PluginOutput =
        serde_json::from_slice(bytes).map_err(|_| PluginError::InvalidOutput)?;
    if output.streams.len() > MAX_STREAMS {
        return Err(PluginError::InvalidOutput);
    }
    for stream in &output.streams {
        if !valid_text(&stream.title, 256) || !valid_text(&stream.url, 8192) {
            return Err(PluginError::InvalidOutput);
        }
        if stream.url.starts_with("magnet:") {
            super::source::validate(&stream.url).map_err(|_| PluginError::InvalidOutput)?;
            continue;
        }
        let parsed = reqwest::Url::parse(&stream.url).map_err(|_| PluginError::InvalidOutput)?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || (!plugin.info.builtin
                && !plugin
                    .info
                    .allowed_hosts
                    .iter()
                    .any(|host| Some(host.as_str()) == parsed.host_str()))
        {
            return Err(PluginError::InvalidOutput);
        }
    }
    Ok(output)
}

fn execute(
    plugin: &Plugin,
    input: &[u8],
    cancel: CancellationToken,
    deadline: Instant,
    async_runtime: Option<tokio::runtime::Handle>,
) -> Result<PluginOutput, PluginError> {
    check_budget(&cancel, deadline)?;
    let runtime = Runtime::new().map_err(|_| PluginError::ExecutionFailed)?;
    runtime.set_memory_limit(MEMORY_BYTES);
    runtime.set_max_stack_size(STACK_BYTES);
    let interrupt_cancel = cancel.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        interrupt_cancel.is_cancelled() || Instant::now() >= deadline
    })));
    // No module loader or process/filesystem functions are installed. Only an
    // explicitly enabled, bounded HTTPS bridge may access the network.
    let context = Context::full(&runtime).map_err(|_| PluginError::ExecutionFailed)?;
    let result = context.with(|ctx| -> Result<PluginOutput, PluginError> {
        let js_error = |_| {
            check_budget(&cancel, deadline)
                .err()
                .unwrap_or(PluginError::ExecutionFailed)
        };
        if plugin.info.network {
            let host = network::NetworkHost::new(
                async_runtime.ok_or(PluginError::NetworkFailed)?,
                plugin.info.allowed_hosts.clone(),
                cancel.clone(),
                deadline,
            );
            let fetch = Function::new(ctx.clone(), move |ctx: rquickjs::Ctx<'_>, url: String| {
                host.fetch(&url)
                    .map_err(|error| rquickjs::Exception::throw_message(&ctx, error.code()))
            })
            .map_err(js_error)?;
            ctx.globals().set("fetchText", fetch).map_err(js_error)?;
        }
        ctx.eval::<(), _>(plugin.source.as_bytes())
            .map_err(js_error)?;
        check_budget(&cancel, deadline)?;
        let resolve: Function = ctx.globals().get("resolve").map_err(js_error)?;
        let argument = ctx.json_parse(input).map_err(js_error)?;
        let mut value: Value = resolve.call((argument,)).map_err(js_error)?;
        if let Some(promise) = value.as_promise() {
            loop {
                check_budget(&cancel, deadline)?;
                if let Some(result) = promise.result::<Value>() {
                    value = result.map_err(js_error)?;
                    break;
                }
                // There are no timers or asynchronous host tasks, so a pending
                // promise without queued jobs cannot make progress.
                if !ctx.execute_pending_job() {
                    return Err(PluginError::ExecutionFailed);
                }
            }
        }
        check_budget(&cancel, deadline)?;
        let json = ctx
            .json_stringify(value)
            .map_err(js_error)?
            .ok_or(PluginError::InvalidOutput)?;
        let bytes = json.to_cstring().map_err(js_error)?;
        check_budget(&cancel, deadline)?;
        validate_output(plugin, bytes.as_bytes())
    });
    check_budget(&cancel, deadline)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Directory(std::path::PathBuf);
    impl Directory {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("ottplay-plugin-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }

        fn plugin(&self, id: &str, source: &str) -> std::path::PathBuf {
            let directory = self.0.join(id);
            fs::create_dir(&directory).unwrap();
            fs::write(directory.join("resolve.js"), source).unwrap();
            let manifest = serde_json::json!({
                "id": id, "name": "Test resolver", "apiVersion": 1,
                "script": "resolve.js", "sha256": format!("{:x}", Sha256::digest(source.as_bytes())),
                "allowedHosts": ["media.example"]
            });
            fs::write(
                directory.join("manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
            directory
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_plugin(source: &str) -> Plugin {
        Plugin {
            info: info(
                "test".into(),
                "Test".into(),
                false,
                vec!["media.example".into()],
            ),
            source: Arc::from(source),
        }
    }

    fn run(source: &str) -> Result<PluginOutput, PluginError> {
        execute(
            &test_plugin(source),
            b"{}",
            CancellationToken::new(),
            Instant::now() + EXECUTION_TIMEOUT,
            None,
        )
    }

    #[tokio::test]
    async fn packaged_resolver_runs_and_describes_its_capabilities() {
        let service = PluginService::load(None).unwrap();
        let listed = service.list();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].builtin);
        assert!(!listed[0].network);
        let output = service
            .resolve(
                "direct-url",
                serde_json::json!({"title":"Video", "url":"https://media.example/video.mp4"}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(output.streams[0].title, "Video");
        assert_eq!(output.streams[0].url, "https://media.example/video.mp4");
    }

    #[tokio::test]
    async fn invalid_input_and_unknown_resolver_are_rejected() {
        let service = PluginService::load(None).unwrap();
        assert_eq!(
            service
                .resolve("missing", serde_json::json!({}), CancellationToken::new())
                .await
                .unwrap_err(),
            PluginError::NotFound
        );
        assert_eq!(
            service
                .resolve(
                    "direct-url",
                    serde_json::json!([]),
                    CancellationToken::new()
                )
                .await
                .unwrap_err(),
            PluginError::InvalidInput
        );
        assert_eq!(
            service
                .resolve(
                    "direct-url",
                    serde_json::json!({"value":"x".repeat(MAX_INPUT_BYTES)}),
                    CancellationToken::new()
                )
                .await
                .unwrap_err(),
            PluginError::InvalidInput
        );
    }

    #[test]
    fn operator_packages_are_digest_verified_and_loaded_once() {
        let directory = Directory::new();
        let plugin = directory.plugin("custom", "function resolve() { return {streams: []}; }");
        let service = PluginService::load(Some(&directory.0)).unwrap();
        assert_eq!(service.list().len(), 2);
        fs::write(plugin.join("resolve.js"), "changed").unwrap();
        assert!(matches!(
            PluginService::load(Some(&directory.0)),
            Err(PluginError::InvalidScript)
        ));
        assert!(service.plugins["custom"]
            .source
            .contains("function resolve"));
    }

    #[test]
    fn manifest_cannot_escape_package_or_replace_builtin() {
        let directory = Directory::new();
        directory.plugin("direct-url", "function resolve() { return {streams: []}; }");
        assert!(matches!(
            PluginService::load(Some(&directory.0)),
            Err(PluginError::InvalidManifest)
        ));
        let directory = Directory::new();
        let path = directory.plugin("custom", "function resolve() { return {streams: []}; }");
        let manifest_path = path.join("manifest.json");
        let mut manifest: JsonValue =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        for script in [
            "../outside.js",
            "/outside.js",
            "a\\outside.js",
            ".hidden.js",
        ] {
            manifest["script"] = script.into();
            fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
            assert!(matches!(
                PluginService::load(Some(&directory.0)),
                Err(PluginError::InvalidManifest)
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_packages_and_scripts_are_rejected() {
        use std::os::unix::fs::symlink;
        let directory = Directory::new();
        let path = directory.plugin("custom", "function resolve() { return {streams: []}; }");
        fs::rename(path.join("resolve.js"), path.join("actual.js")).unwrap();
        symlink("actual.js", path.join("resolve.js")).unwrap();
        assert!(matches!(
            PluginService::load(Some(&directory.0)),
            Err(PluginError::InvalidScript)
        ));
    }

    #[test]
    fn only_exact_normalized_hosts_are_accepted() {
        assert_eq!(normalize_host("MEDIA.example").unwrap(), "media.example");
        for host in [
            "*.example",
            "user@media.example",
            "media.example:443",
            "media.example/",
            "127.1",
            "2130706433",
            "media.example.",
            "bad..example",
        ] {
            assert_eq!(
                normalize_host(host).unwrap_err(),
                PluginError::InvalidManifest
            );
        }
    }

    #[test]
    fn globals_are_isolated_and_no_native_apis_are_exposed() {
        let source = "function resolve() { if (typeof process !== 'undefined' || typeof require !== 'undefined' || typeof fetch !== 'undefined' || typeof fetchText !== 'undefined' || typeof setTimeout !== 'undefined' || typeof console !== 'undefined') throw Error('native capability'); globalThis.calls = (globalThis.calls || 0) + 1; return {streams:[{title:String(globalThis.calls),url:'https://media.example/video'}]}; }";
        for _ in 0..2 {
            assert_eq!(run(source).unwrap().streams[0].title, "1");
        }
    }

    #[test]
    fn pure_async_resolvers_are_supported_without_external_tasks() {
        assert!(
            run("async function resolve() { await Promise.resolve(); return {streams:[]}; }")
                .unwrap()
                .streams
                .is_empty()
        );
        assert_eq!(
            run("function resolve() { return new Promise(function() {}); }").unwrap_err(),
            PluginError::ExecutionFailed
        );
    }

    #[test]
    fn infinite_scripts_and_microtasks_are_interrupted() {
        for source in [
            "while (true) {}",
            "function resolve() { while (true) {} }",
            "async function resolve() { while (true) { await Promise.resolve(); } }",
        ] {
            let result = execute(
                &test_plugin(source),
                b"{}",
                CancellationToken::new(),
                Instant::now() + Duration::from_millis(30),
                None,
            );
            assert_eq!(result.unwrap_err(), PluginError::TimedOut);
        }
    }

    #[test]
    fn memory_and_stack_failures_are_contained() {
        assert_eq!(run("function resolve() { var values=[]; while(true) values.push(new Array(100000).fill('x')); }").unwrap_err(), PluginError::ExecutionFailed);
        assert_eq!(
            run("function resolve() { return resolve(); }").unwrap_err(),
            PluginError::ExecutionFailed
        );
        assert!(run("function resolve() { return {streams:[]}; }").is_ok());
    }

    #[test]
    fn results_have_shape_size_and_destination_limits() {
        for source in [
            "function resolve() { return {streams:[], extra:true}; }",
            "function resolve() { return {streams:Array(129).fill({title:'Video',url:'https://media.example/v'})}; }",
            "function resolve() { return {streams:[{title:'x'.repeat(257),url:'https://media.example/v'}]}; }",
            "function resolve() { return {streams:[{title:'Video',url:'file:///tmp/video'}]}; }",
            "function resolve() { return {streams:[{title:'Video',url:'https://user:secret@media.example/v'}]}; }",
            "function resolve() { return {streams:[{title:'Video',url:'https://media.example.evil/v'}]}; }",
            "function resolve() { return {streams:[{title:'Video',url:'https://elsewhere.example/v'}]}; }",
            "function resolve() { return {streams:[{title:'Video',url:'https://media.example/'+ 'x'.repeat(140000)}]}; }",
        ] {
            assert_eq!(run(source).unwrap_err(), PluginError::InvalidOutput);
        }
    }

    #[tokio::test]
    async fn request_cancellation_interrupts_worker_and_releases_admission() {
        let directory = Directory::new();
        directory.plugin("loop", "function resolve() { while (true) {} }");
        let service = PluginService::load(Some(&directory.0)).unwrap();
        let cancel = CancellationToken::new();
        let cloned = service.clone();
        let worker_cancel = cancel.clone();
        let task = tokio::spawn(async move {
            cloned
                .resolve("loop", serde_json::json!({}), worker_cancel)
                .await
        });
        while service.slots.available_permits() == CONCURRENCY {
            tokio::task::yield_now().await;
        }
        cancel.cancel();
        assert_eq!(task.await.unwrap().unwrap_err(), PluginError::Cancelled);
        tokio::time::timeout(Duration::from_secs(1), async {
            while service.slots.available_permits() != CONCURRENCY {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn dropping_caller_cancels_vm_without_releasing_an_active_slot_early() {
        let directory = Directory::new();
        directory.plugin("loop", "function resolve() { while (true) {} }");
        let service = PluginService::load(Some(&directory.0)).unwrap();
        let cloned = service.clone();
        let task = tokio::spawn(async move {
            cloned
                .resolve("loop", serde_json::json!({}), CancellationToken::new())
                .await
        });
        while service.slots.available_permits() == CONCURRENCY {
            tokio::task::yield_now().await;
        }
        task.abort();
        let _ = task.await;
        tokio::time::timeout(Duration::from_secs(1), async {
            while service.slots.available_permits() != CONCURRENCY {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn admission_is_bounded_without_a_waiting_queue() {
        let service = PluginService::load(None).unwrap();
        let _one = service.slots.clone().acquire_owned().await.unwrap();
        let _two = service.slots.clone().acquire_owned().await.unwrap();
        assert_eq!(
            service
                .resolve(
                    "direct-url",
                    serde_json::json!({}),
                    CancellationToken::new()
                )
                .await
                .unwrap_err(),
            PluginError::Busy
        );
    }

    #[tokio::test]
    async fn explicit_network_permission_exposes_only_bounded_text_fetch() {
        let directory = Directory::new();
        let path = directory.plugin("network", "function resolve() { var message=''; for(var i=0;i<3;i++){ try { fetchText('http://media.example/catalog'); } catch(error) { message=error.message; } } return {streams:[{title:message,url:'https://media.example/video'}]}; }");
        let manifest_path = path.join("manifest.json");
        let mut manifest: JsonValue =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["network"] = true.into();
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let service = PluginService::load(Some(&directory.0)).unwrap();
        let network = service
            .list()
            .into_iter()
            .find(|p| p.id == "network")
            .unwrap();
        assert!(network.network);
        assert_eq!(network.max_network_calls, 2);
        assert_eq!(network.max_fetch_bytes, 512 * 1024);
        let result = service
            .resolve("network", serde_json::json!({}), CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(result.streams[0].title, "plugin_network_limit");
        manifest["allowedHosts"] = serde_json::json!([]);
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(matches!(
            PluginService::load(Some(&directory.0)),
            Err(PluginError::InvalidManifest)
        ));
    }

    #[test]
    fn resolver_magnets_use_shared_validation_without_bypassing_scheme_policy() {
        let magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";
        let plugin = test_plugin("");
        let output = serde_json::json!({"streams":[{"title":"Test","url":magnet}]});
        assert!(validate_output(&plugin, &serde_json::to_vec(&output).unwrap()).is_ok());
        for url in [
            "magnet:?xt=invalid",
            "javascript:alert(1)",
            "ottplay-plugin:direct-url",
            "file:///movie.mp4",
        ] {
            let output = serde_json::json!({"streams":[{"title":"Test","url":url}]});
            assert_eq!(
                validate_output(&plugin, &serde_json::to_vec(&output).unwrap()).unwrap_err(),
                PluginError::InvalidOutput
            );
        }
    }

    #[test]
    fn cancellation_interrupts_executing_javascript() {
        let cancel = CancellationToken::new();
        let thread_cancel = cancel.clone();
        let thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            thread_cancel.cancel();
        });
        let result = execute(
            &test_plugin("function resolve() { while (true) {} }"),
            b"{}",
            cancel,
            Instant::now() + EXECUTION_TIMEOUT,
            None,
        );
        thread.join().unwrap();
        assert_eq!(result.unwrap_err(), PluginError::Cancelled);
    }

    #[test]
    fn shipped_example_digests_and_manifests_match() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/examples");
        let service = PluginService::load(Some(&root)).unwrap();
        assert_eq!(service.list().len(), 3);
        assert!(service.plugins["network-catalog"].info.network);
        assert!(!service.plugins["catalog-map"].info.network);
    }
}

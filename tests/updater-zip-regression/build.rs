use std::{env, fs, path::PathBuf};

fn main() {
    let source = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .join("../../vendor/tauri-plugin-updater-2.12.0/src/updater.rs");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(source).expect("read the actual vendored updater");
    let start = "    fn extract_zip(&self, bytes: &[u8]) -> Result<WindowsUpdaterType> {";
    let end = "    fn extract_exe(&self, bytes: &[u8]) -> Result<WindowsUpdaterType> {";
    assert_eq!(text.matches(start).count(), 1, "review changed updater API");
    assert_eq!(text.matches(end).count(), 1, "review changed updater API");
    let body = text.split_once(start).unwrap().1.split_once(end).unwrap().0;
    // Compile the exact production method, not a handwritten copy of its logic.
    // Only Update's temporary directory and installer result types are adapted.
    let generated = format!("impl Update {{\n{start}{body}}}\n");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("extract_zip.rs"),
        generated,
    )
    .expect("write extracted production method");

    let tls_start = "fn enforce_tls_verification(builder: ClientBuilder) -> ClientBuilder {";
    let tls_end = "\n}\n";
    assert_eq!(
        text.matches(tls_start).count(),
        1,
        "review changed TLS policy"
    );
    let tls_body = text
        .split_once(tls_start)
        .unwrap()
        .1
        .split_once(tls_end)
        .unwrap()
        .0;
    let tls = format!("{tls_start}{tls_body}\n}}\n");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("tls_policy.rs"),
        tls,
    )
    .expect("write extracted production TLS policy");
}

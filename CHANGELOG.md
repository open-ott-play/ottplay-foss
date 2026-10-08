# Changelog

## [1.1.53] - Development line

### Changes

- Translate remote-command notifications and touchscreen-lock messages in all
  88 interface languages. Use the same Unicode search rules for remote channel
  selection and media-library filtering, including filtered shuffle playback.
- Retry the dictionary download when a saved system language fails to load at
  startup. Keep generated phone-input captions translatable when the browser
  dictionary arrives after a legacy TV offer.
- Recognize standard French, Romanian and Latvian audio/subtitle language tags
  without confusing Latin with Latvian.

- Update SQLx and tauri-utils within their existing version requirements and use
  Rustls PKI types for PEM input, removing seven unmaintained packages from the
  application lockfile.

- The 1.1.53 development line adds ordered remote Plex queues, preserves an
  explicit native Play request while buffering, and improves contextual Unicode
  search and grapheme-safe editor input.
- Remote diagnostics now expose read-only UI/media snapshots, capability
  reasons, loaded-bundle identity and a bounded journal of operation receipts.
  Inspection does not create a playback backend, capture a screen or change
  saved settings.
- The webOS Simulator launcher now selects the newest matching installed LG
  Simulator using Node built-ins and passes the app path without a shell.
  Automatic installation of the external webOS CLI is removed.
- Python CI dependencies now use a complete SHA-256 archive lock.
- Security analysis now includes Python release tools, Actions workflows, Rust
  source and the compiled iOS Swift application.
- Release publication now reads this version's reviewed notes from the exact
  source commit and verifies them before writing publication evidence or
  advancing the durable publication counter.

- Version updates preserve quoted TOML keys containing `=` or `#`, including
  unrelated keys, without changing comments or surrounding file layout.

- Release notes accept optional closing hashes in Markdown headings while
  continuing to reject duplicate version sections.

### Upgrade

Rebuild with the committed Cargo lockfile. The Rust server now rejects supplied
certificate chains with RSA keys below 2048 bits, unsupported or undersized EC
curves, unknown key algorithms or malformed encodings before opening a listener.
Replace affected certificates before upgrading. Certificate PEM and PKCS#8 key
formats are unchanged; malformed later PEM sections still reject startup. No
database migration is required. See the
[supported certificate policy](docs/security-design.md#rust-server-certificate-configuration).

Retain provider profiles and exported settings before replacing a web, desktop or
container installation. Follow the platform-specific build/install instructions;
Android APK/AAB packages are maintained in ottplay-android. Automatic updating is
not configured, and unsigned iOS packages require operator signing/sideloading.
Validate playback, remote input and saved settings on the intended TV/STB/native
platform; automated tests do not establish physical-device acceptance.

Use a controller and CLI revision supporting `inspect` v1 for the new workbench
commands. Older combinations report unsupported capabilities. The operation
journal retains at most 128 request IDs; retained entries expire after ten
minutes, while eviction or reload makes them unknown. Never replay a mutation
automatically because its receipt is missing.

Default Simulator SDK discovery and automatic installation of the official
Simulator ZIP remain available. Use `--sdk` or `WEBOS_SDK_PATH` for a custom
location. The explicit `--cli` or `WEBOS_CLI` override uses an operator-maintained
external CLI; setup `--cli-only` is now a compatibility no-op. Existing external
CLI installations are left in place.

### Security

The archived Python server handles unmatched parentheses in channel names in a
linear pass, avoiding excessive CPU use from malformed EPG names. Its HTTPS
listener and proxy explicitly require TLS 1.2 or newer while retaining normal
upstream certificate and hostname verification. Archived-server users must
ensure HTTPS peers support TLS 1.2.

The Rust server validates key strength in every supplied TLS certificate,
including intermediates and included roots. This prevents weak server
configuration from being accepted; it does not inspect omitted client trust
anchors or replace clients' normal certificate and hostname verification.

The application dependency update removes seven maintenance warnings while
retaining the existing Tauri/Wry/Tao/GLib patches. Three upstream maintenance
warnings, the already-backported GLib version warning and historical vendor
lockfile findings remain documented in the
[Rust dependency security review](docs/rust-dependency-security.md). No advisory
ignore list is added.

Release artifacts retain their immutable build provenance and checksums. The new
notes validation rejects incomplete publication metadata before modifying durable
publication state. It does not announce a new application CVE. Protect provider
credentials and remote-control consent codes, and keep local server access within
the documented trust boundary.

Diagnostic snapshots omit DOM text, media titles/URLs, settings and credentials.
Runtime and section checks validate inspection responses under the existing
authorized connection; they do not introduce a new authentication mechanism or
exclusive routing for mutation commands. An `accepted` receipt records a queued
effect and can remain after transport cancellation. `invoked` is not proof of
the effect, and the journal does not emit `observed`. Decoder progress does not
prove physical screen or audio output.

The default Simulator setup no longer installs the vulnerable external CLI
dependency tree. Paths are passed as separate process arguments. This does not
repair an external CLI chosen explicitly by the operator; see
[the CLI audit and override boundary](docs/webos-cli-security.md). Automated
launcher tests do not establish a physical TV or vendor Simulator display result.

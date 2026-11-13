//! Protected, startup-only operator configuration for the private broker.
//!
//! The serving layer must compare the declared listener with its actual socket
//! and TLS configuration before mounting routes. This loader does not establish
//! network authority or enroll media sources. Keep this file outside public and
//! synchronized trees; arbitrary synchronization software cannot be detected.

use std::{collections::BTreeSet, net::IpAddr, path::Path};

use ottplay_core::multiview::broker::wire::{self, Permission};
use serde::Deserialize;

use crate::multiview_broker::{CredentialConfig, Enrollment, ListenerPolicy, OperatorConfig};

const MAX_CONFIG_BYTES: u64 = 64 * 1024;

// Deliberately no Debug or Serialize on documents containing credentials.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u8,
    server_id: String,
    origin: String,
    listener: ListenerDocument,
    allowed_origins: Vec<String>,
    signing_key: String,
    credentials: Vec<CredentialDocument>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListenerDocument {
    bind_ip: IpAddr,
    https: bool,
    #[serde(default)]
    lan_approved: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialDocument {
    installation_id: String,
    control_bearer: String,
    subject: String,
    revision: u64,
    expires_at_ms: u64,
}

fn invalid(reason: &'static str) -> anyhow::Error {
    anyhow::anyhow!("multiview operator configuration: {reason}")
}

pub(crate) fn load(path: &Path) -> anyhow::Result<OperatorConfig> {
    let public_directory = std::env::current_dir()
        .and_then(std::fs::canonicalize)
        .map_err(|_| invalid("cannot determine public directory"))?;
    load_for_public_directory(path, &public_directory)
}

fn load_for_public_directory(
    path: &Path,
    public_directory: &Path,
) -> anyhow::Result<OperatorConfig> {
    let bytes = read_private(path, public_directory)?;
    // Never attach a serde/OS error: it may contain a credential, path or input.
    let document: Document =
        serde_json::from_slice(&bytes).map_err(|_| invalid("invalid document"))?;
    if document.version != 1
        || !document.signing_key.is_ascii()
        || !(32..=64).contains(&document.signing_key.len())
    {
        return Err(invalid("invalid document"));
    }
    let credentials = document
        .credentials
        .into_iter()
        .map(|value| CredentialConfig {
            enrollment: Enrollment {
                server_id: document.server_id.clone(),
                origin: document.origin.clone(),
                audience: wire::AUDIENCE.to_owned(),
                installation_id: value.installation_id,
                control_bearer: value.control_bearer,
            },
            subject: value.subject,
            permissions: BTreeSet::from([Permission::MultiviewControl]),
            revision: value.revision,
            expires_at_ms: value.expires_at_ms,
        })
        .collect();
    // Broker::new remains the authority for identity, origin, credential and
    // listener-policy validation. Restarting never restores an old epoch.
    Ok(OperatorConfig {
        server_id: document.server_id,
        server_epoch: uuid::Uuid::new_v4().to_string(),
        origin: document.origin,
        listener: ListenerPolicy {
            bind_ip: document.listener.bind_ip,
            https: document.listener.https,
            lan_approved: document.listener.lan_approved,
        },
        allowed_origins: document.allowed_origins,
        signing_key: document.signing_key.into_bytes(),
        credentials,
    })
}

#[cfg(not(unix))]
fn read_private(_path: &Path, _public_directory: &Path) -> anyhow::Result<Vec<u8>> {
    Err(invalid(
        "protected file loading is unsupported on this platform",
    ))
}

#[cfg(unix)]
fn read_private(path: &Path, public_directory: &Path) -> anyhow::Result<Vec<u8>> {
    use std::{
        ffi::CString,
        fs::{File, Metadata, OpenOptions},
        io::Read,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::{
                ffi::OsStrExt,
                fs::{MetadataExt, OpenOptionsExt},
            },
        },
        path::Component,
    };

    fn metadata(file: &File) -> anyhow::Result<Metadata> {
        file.metadata().map_err(|_| invalid("cannot inspect file"))
    }

    fn protected_file(value: &Metadata, uid: u32) -> bool {
        value.is_file()
            && value.uid() == uid
            && value.mode() & 0o7777 == 0o600
            && value.nlink() == 1
            && value.len() > 0
            && value.len() <= MAX_CONFIG_BYTES
    }

    if !path.is_absolute() {
        return Err(invalid("absolute path required"));
    }
    let public_path = std::fs::canonicalize(public_directory)
        .map_err(|_| invalid("cannot determine public directory"))?;
    let public_metadata =
        std::fs::metadata(&public_path).map_err(|_| invalid("cannot inspect public directory"))?;
    if path.starts_with(&public_path) {
        return Err(invalid("file must be outside the public directory"));
    }
    let mut components = path.components();
    if components.next() != Some(Component::RootDir) {
        return Err(invalid("absolute path required"));
    }
    let names = components
        .map(|component| match component {
            Component::Normal(name) => {
                CString::new(name.as_bytes()).map_err(|_| invalid("invalid path"))
            }
            _ => Err(invalid("invalid path")),
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    if names.is_empty() {
        return Err(invalid("invalid path"));
    }

    // Open each ancestor relative to the already verified directory handle.
    // O_NOFOLLOW applies to every component, not only the final filename.
    let directory_flags = libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
    let mut directory = OpenOptions::new()
        .read(true)
        .custom_flags(directory_flags)
        .open("/")
        .map_err(|_| invalid("cannot open protected directory"))?;
    // SAFETY: geteuid takes no pointers and has no failure case.
    let uid = unsafe { libc::geteuid() };
    for (index, name) in names.iter().enumerate() {
        let parent = metadata(&directory)?;
        if !parent.is_dir()
            || (parent.uid() != 0 && parent.uid() != uid)
            || parent.mode() & 0o022 != 0
        {
            return Err(invalid("unprotected ancestor directory"));
        }
        if parent.dev() == public_metadata.dev() && parent.ino() == public_metadata.ino() {
            return Err(invalid("file must be outside the public directory"));
        }
        let final_component = index + 1 == names.len();
        let flags = if final_component {
            // Nonblocking open prevents a regular-file/FIFO substitution from
            // hanging startup before fstat can reject the opened object.
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK
        } else {
            libc::O_RDONLY | directory_flags
        };
        // SAFETY: the live directory fd and NUL-terminated component are valid;
        // no creation flag is used, so openat does not need a mode argument.
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(invalid("cannot open protected file"));
        }
        // SAFETY: successful openat returned a new, uniquely owned descriptor.
        let file = unsafe { File::from_raw_fd(fd) };
        if !final_component {
            directory = file;
            continue;
        }
        let before = metadata(&file)?;
        if !protected_file(&before, uid) {
            return Err(invalid("file must be private, regular and bounded"));
        }
        let mut bytes = Vec::with_capacity(before.len() as usize);
        (&file)
            .take(MAX_CONFIG_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid("cannot read protected file"))?;
        let after = metadata(&file)?;
        if !protected_file(&after, uid)
            || bytes.len() as u64 != after.len()
            || before.len() != after.len()
            || before.mtime() != after.mtime()
            || before.mtime_nsec() != after.mtime_nsec()
            || before.ctime() != after.ctime()
            || before.ctime_nsec() != after.ctime_nsec()
        {
            return Err(invalid("file changed while reading"));
        }
        return Ok(bytes);
    }
    Err(invalid("invalid path"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        ffi::CString,
        fs::{self, DirBuilder, OpenOptions, Permissions},
        io::Write,
        os::unix::{
            ffi::OsStrExt,
            fs::{symlink, DirBuilderExt, OpenOptionsExt, PermissionsExt},
        },
        path::PathBuf,
        time::{Duration, Instant},
    };

    const TOKEN: &str = "unit-control-credential-never-print-0001";
    const SIGNING: &str = "unit-signing-material-never-print-0001";

    struct Fixture {
        root: PathBuf,
        public: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            // Test-only override lets the isolated runner reuse its owned
            // artifact directory. Production has no environment override.
            let base = std::env::var_os("OTTPLAY_OPERATOR_TEST_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/tmp"));
            DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(&base)
                .unwrap();
            let base = fs::canonicalize(base).unwrap();
            let root = base.join(format!("operator-unit-{}", uuid::Uuid::new_v4()));
            DirBuilder::new().mode(0o700).create(&root).unwrap();
            let public = root.join("public");
            DirBuilder::new().mode(0o700).create(&public).unwrap();
            Self { root, public }
        }

        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.root.join(name);
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .unwrap();
            file.write_all(bytes).unwrap();
            path
        }

        fn load(&self, path: &Path) -> anyhow::Result<OperatorConfig> {
            load_for_public_directory(path, &self.public)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // Only the unique directory created by this fixture is removed.
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn document() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "server_id": "operator-test-server",
            "origin": "http://127.0.0.1:18080",
            "listener": {"bind_ip": "127.0.0.1", "https": false},
            "allowed_origins": ["http://127.0.0.1:18080"],
            "signing_key": SIGNING,
            "credentials": [{
                "installation_id": "operator-test-installation",
                "control_bearer": TOKEN,
                "subject": "operator-test-subject",
                "revision": 7,
                "expires_at_ms": 4_102_444_800_000_u64
            }]
        })
    }

    fn rejected(result: anyhow::Result<OperatorConfig>) -> String {
        let error = match result {
            Ok(_) => panic!("unsafe operator configuration was accepted"),
            Err(error) => error,
        };
        let diagnostic = format!("{error:#}");
        assert!(diagnostic.starts_with("multiview operator configuration: "));
        assert!(!diagnostic.contains(TOKEN));
        assert!(!diagnostic.contains(SIGNING));
        diagnostic
    }

    #[test]
    fn operator_valid_document_has_fresh_epoch_and_only_control_permission() {
        let fixture = Fixture::new();
        let path = fixture.write("operator.json", &serde_json::to_vec(&document()).unwrap());
        let first = fixture.load(&path).unwrap();
        let second = fixture.load(&path).unwrap();
        assert_ne!(first.server_epoch, second.server_epoch);
        assert!(uuid::Uuid::parse_str(&first.server_epoch).is_ok());
        assert_eq!(first.server_id, "operator-test-server");
        assert_eq!(
            first.listener.bind_ip,
            "127.0.0.1".parse::<IpAddr>().unwrap()
        );
        assert!(!first.listener.https);
        assert!(!first.listener.lan_approved);
        assert_eq!(first.credentials.len(), 1);
        let credential = &first.credentials[0];
        assert_eq!(
            credential.permissions,
            BTreeSet::from([Permission::MultiviewControl])
        );
        assert_eq!(credential.enrollment.audience, wire::AUDIENCE);
        assert_eq!(credential.enrollment.server_id, first.server_id);
        assert_eq!(credential.enrollment.origin, first.origin);
        assert_eq!(credential.revision, 7);
        // Boolean comparisons avoid printing credential material on failure.
        assert!(credential.enrollment.control_bearer == TOKEN);
        assert!(first.signing_key == SIGNING.as_bytes());
    }

    #[test]
    fn operator_schema_is_closed_and_diagnostics_are_redacted() {
        let fixture = Fixture::new();
        let mutations: &[(&str, serde_json::Value)] = &[
            ("/version", serde_json::json!(2)),
            ("/signing_key", serde_json::json!("short")),
            ("/signing_key", serde_json::json!("s".repeat(65))),
            ("/signing_key", serde_json::json!("é".repeat(20))),
            ("/credentials/0/control_bearer", serde_json::json!(123)),
        ];
        let mut cases = Vec::new();
        for (pointer, value) in mutations {
            let mut item = document();
            *item.pointer_mut(pointer).unwrap() = value.clone();
            cases.push(serde_json::to_vec(&item).unwrap());
        }
        for (pointer, key) in [
            ("", "server_epoch"),
            ("", "sources"),
            ("/listener", "public_origin"),
            ("/credentials/0", "permissions"),
            ("/credentials/0", "audience"),
        ] {
            let mut item = document();
            item.pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(key.to_owned(), serde_json::json!(TOKEN));
            cases.push(serde_json::to_vec(&item).unwrap());
        }
        let valid = serde_json::to_string(&document()).unwrap();
        cases.push(format!("{{\"version\":1,{}", &valid[1..]).into_bytes());
        cases.push(format!("{valid} {TOKEN}").into_bytes());
        for (index, bytes) in cases.iter().enumerate() {
            let path = fixture.write(&format!("invalid-{index}.json"), bytes);
            assert_eq!(
                rejected(fixture.load(&path)),
                "multiview operator configuration: invalid document"
            );
        }
    }

    #[test]
    fn operator_rejects_public_paths_and_unsafe_files_without_fifo_wait() {
        let fixture = Fixture::new();
        let bytes = serde_json::to_vec(&document()).unwrap();
        let valid = fixture.write("valid.json", &bytes);
        let public = fixture.write("public/config.json", &bytes);
        assert!(rejected(fixture.load(&public)).contains("outside the public directory"));
        assert!(rejected(fixture.load(Path::new("relative.json"))).contains("absolute path"));
        let actual_cwd = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        assert!(
            rejected(load(&actual_cwd.join("unused-private-config.json")))
                .contains("outside the public directory")
        );
        assert!(
            rejected(load(&actual_cwd.join("subtree/unused-private-config.json")))
                .contains("outside the public directory")
        );

        let link = fixture.root.join("symlink.json");
        symlink(&valid, &link).unwrap();
        rejected(fixture.load(&link));
        let ancestor_link = fixture.root.join("alias");
        symlink(&fixture.public, &ancestor_link).unwrap();
        rejected(fixture.load(&ancestor_link.join("config.json")));

        let hardlink = fixture.root.join("hardlink.json");
        fs::hard_link(&valid, &hardlink).unwrap();
        rejected(fixture.load(&hardlink));
        rejected(fixture.load(&valid));
        fs::remove_file(hardlink).unwrap();

        for (name, mode) in [
            ("readable.json", 0o644),
            ("readonly.json", 0o400),
            ("sticky.json", 0o1600),
        ] {
            let path = fixture.write(name, &bytes);
            fs::set_permissions(&path, Permissions::from_mode(mode)).unwrap();
            rejected(fixture.load(&path));
        }
        let empty = fixture.write("empty.json", &[]);
        rejected(fixture.load(&empty));
        let oversized = fixture.write("large.json", &vec![b' '; MAX_CONFIG_BYTES as usize + 1]);
        rejected(fixture.load(&oversized));
        rejected(fixture.load(&fixture.public));

        let unsafe_parent = fixture.root.join("writable");
        DirBuilder::new()
            .mode(0o700)
            .create(&unsafe_parent)
            .unwrap();
        let unsafe_file = fixture.write("writable/config.json", &bytes);
        fs::set_permissions(&unsafe_parent, Permissions::from_mode(0o722)).unwrap();
        assert!(rejected(fixture.load(&unsafe_file)).contains("unprotected ancestor"));

        let fifo = fixture.root.join("pipe");
        let fifo_c = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        // SAFETY: the path is a valid C string in the fixture's owned directory.
        assert_eq!(unsafe { libc::mkfifo(fifo_c.as_ptr(), 0o600) }, 0);
        let started = Instant::now();
        rejected(fixture.load(&fifo));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}

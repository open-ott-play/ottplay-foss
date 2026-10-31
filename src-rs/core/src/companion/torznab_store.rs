//! Private, instance-owned configuration and stable torrent references.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_REFS: usize = 128;
const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MARKER: &[u8] = b"ottplay-torznab-private-v1\n";
pub(super) fn source_id(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|v| v.is_ascii_lowercase() || v.is_ascii_digit() || v == b'-')
}
pub(super) fn reference(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
pub(super) fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Config {
    pub id: String,
    pub label: String,
    pub endpoint: String,
    pub api_key: String,
    pub generation: String,
}
#[derive(Clone)]
pub(super) enum Payload {
    Torrent(Vec<u8>),
    Magnet(String),
}
impl Payload {
    fn bytes(&self) -> &[u8] {
        match self {
            Self::Torrent(v) => v,
            Self::Magnet(v) => v.as_bytes(),
        }
    }
    fn kind(&self) -> &'static str {
        match self {
            Self::Torrent(_) => "torrent",
            Self::Magnet(_) => "magnet",
        }
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            Self::Torrent(bytes) => super::source::validate_metainfo(bytes),
            Self::Magnet(value) if value.starts_with("magnet:") => super::source::validate(value),
            _ => Err("invalid_source"),
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Reference {
    id: String,
    source_id: String,
    generation: String,
    kind: String,
    digest: String,
    size: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct State {
    schema: u8,
    sources: Vec<Config>,
    references: Vec<Reference>,
}
pub(super) struct Store {
    root: PathBuf,
    state: State,
    owner: Option<File>,
}
fn regular(path: &Path) -> Result<(), &'static str> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "torznab_store_unavailable")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("torznab_store_unavailable");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("torznab_store_unavailable");
        }
    }
    Ok(())
}
fn open(path: &Path, create: bool) -> Result<File, &'static str> {
    let mut options = OpenOptions::new();
    options.read(true).write(create);
    if create {
        options.create_new(true);
    } else {
        regular(path)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path).map_err(|_| "torznab_store_unavailable")
}
fn read(path: &Path, max: u64) -> Result<Vec<u8>, &'static str> {
    let file = open(path, false)?;
    if file
        .metadata()
        .map_err(|_| "torznab_store_unavailable")?
        .len()
        > max
    {
        return Err("torznab_store_unavailable");
    }
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "torznab_store_unavailable")?;
    if bytes.len() as u64 > max {
        return Err("torznab_store_unavailable");
    }
    Ok(bytes)
}
impl Store {
    pub fn load(root: PathBuf) -> Result<Self, &'static str> {
        std::fs::create_dir_all(&root).map_err(|_| "torznab_store_unavailable")?;
        let metadata = std::fs::symlink_metadata(&root).map_err(|_| "torznab_store_unavailable")?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("torznab_store_unavailable");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "torznab_store_unavailable")?;
        }
        let marker = root.join(".owner");
        let created = match std::fs::symlink_metadata(&marker) {
            Ok(_) => false,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
            Err(_) => return Err("torznab_store_unavailable"),
        };
        if created
            && std::fs::read_dir(&root)
                .map_err(|_| "torznab_store_unavailable")?
                .next()
                .is_some()
        {
            return Err("torznab_store_unavailable");
        }
        let mut owner = open(&marker, created)?;
        owner.try_lock().map_err(|_| "torznab_store_busy")?;
        if created {
            owner
                .write_all(MARKER)
                .and_then(|_| owner.sync_all())
                .map_err(|_| "torznab_store_unavailable")?;
        } else {
            // Read through the locking handle: Windows exclusive file locks
            // also apply to a second handle opened by this process.
            let mut marker_bytes = Vec::new();
            (&mut owner)
                .take(129)
                .read_to_end(&mut marker_bytes)
                .map_err(|_| "torznab_store_unavailable")?;
            if marker_bytes != MARKER {
                return Err("torznab_store_unavailable");
            }
        }
        let state = if created {
            State {
                schema: 1,
                sources: vec![],
                references: vec![],
            }
        } else {
            serde_json::from_slice::<State>(&read(&root.join("state.json"), 128 * 1024)?)
                .map_err(|_| "torznab_store_unavailable")?
        };
        if state.schema != 1 || state.sources.len() > 8 || state.references.len() > MAX_REFS {
            return Err("torznab_store_unavailable");
        }
        let mut ids = std::collections::HashSet::new();
        for config in &state.sources {
            if !source_id(&config.id) || !reference(&config.generation) || !ids.insert(&config.id) {
                return Err("torznab_store_unavailable");
            }
            super::torznab::validate_config(
                &config.id,
                &config.label,
                &config.endpoint,
                &config.api_key,
            )?;
        }
        let mut refs = std::collections::HashSet::new();
        let mut total = 0u64;
        for item in &state.references {
            if !reference(&item.id)
                || !refs.insert(&item.id)
                || !matches!(item.kind.as_str(), "torrent" | "magnet")
                || item.size > 1024 * 1024
                || item.digest.len() != 64
                || !state
                    .sources
                    .iter()
                    .any(|s| s.id == item.source_id && s.generation == item.generation)
            {
                return Err("torznab_store_unavailable");
            }
            total = total
                .checked_add(item.size)
                .ok_or("torznab_store_unavailable")?;
            if total > MAX_BYTES {
                return Err("torznab_store_unavailable");
            }
            regular(&root.join(format!("{}.bin", item.id)))?;
        }
        let mut leftovers = Vec::new();
        for (index, entry) in std::fs::read_dir(&root)
            .map_err(|_| "torznab_store_unavailable")?
            .enumerate()
        {
            if index >= 512 {
                return Err("torznab_store_limit");
            }
            let entry = entry.map_err(|_| "torznab_store_unavailable")?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "torznab_store_unavailable")?;
            regular(&entry.path())?;
            if name == ".owner" || name == "state.json" {
                continue;
            }
            if name == "state.pending" || name.strip_suffix(".bin").is_some_and(reference) {
                if !name
                    .strip_suffix(".bin")
                    .is_some_and(|id| refs.contains(&id.to_owned()))
                {
                    leftovers.push(entry.path());
                }
            } else {
                return Err("torznab_store_unavailable");
            }
        }
        let store = Self {
            root,
            state,
            owner: Some(owner),
        };
        for path in leftovers {
            std::fs::remove_file(path).map_err(|_| "torznab_store_unavailable")?;
        }
        if created {
            store.save(&store.state)?;
        }
        Ok(store)
    }
    fn save(&self, state: &State) -> Result<(), &'static str> {
        let bytes = serde_json::to_vec(state).map_err(|_| "torznab_store_unavailable")?;
        if bytes.len() > 128 * 1024 {
            return Err("torznab_store_limit");
        }
        let pending = self.root.join("state.pending");
        let result = (|| {
            let mut file = open(&pending, true)?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "torznab_store_unavailable")?;
            std::fs::rename(&pending, self.root.join("state.json"))
                .map_err(|_| "torznab_store_unavailable")?;
            #[cfg(unix)]
            File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| "torznab_store_unavailable")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(pending);
        }
        result
    }
    pub fn sources(&self) -> Vec<Config> {
        self.state.sources.clone()
    }
    pub fn release_owner(&mut self) {
        self.owner.take();
    }
    pub fn source(&self, id: &str) -> Result<Config, &'static str> {
        self.state
            .sources
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or("torznab_source_missing")
    }
    pub fn configure(&mut self, mut config: Config) -> Result<bool, &'static str> {
        let mut state = self.state.clone();
        let old = state.sources.iter().position(|s| s.id == config.id);
        let changed = old.is_none_or(|i| {
            state.sources[i].endpoint != config.endpoint
                || state.sources[i].api_key != config.api_key
        });
        if let Some(i) = old {
            if !changed {
                config.generation = state.sources[i].generation.clone();
            }
            state.sources[i] = config.clone();
        } else {
            if state.sources.len() >= 8 {
                return Err("torznab_source_limit");
            }
            state.sources.push(config.clone());
        }
        state
            .references
            .retain(|r| r.source_id != config.id || r.generation == config.generation);
        self.replace(state)?;
        Ok(changed)
    }
    pub fn remove(&mut self, id: &str) -> Result<(), &'static str> {
        self.source(id)?;
        let mut state = self.state.clone();
        state.sources.retain(|s| s.id != id);
        state.references.retain(|r| r.source_id != id);
        self.replace(state)
    }
    fn replace(&mut self, state: State) -> Result<(), &'static str> {
        self.save(&state)?;
        let old = std::mem::replace(&mut self.state, state);
        for item in old.references {
            if !self.state.references.iter().any(|r| r.id == item.id) {
                let _ = std::fs::remove_file(self.root.join(format!("{}.bin", item.id)));
            }
        }
        Ok(())
    }
    pub fn prepare(&mut self, source: &Config, payload: Payload) -> Result<String, &'static str> {
        if self.source(&source.id)?.generation != source.generation {
            return Err("torznab_source_changed");
        }
        payload.validate()?;
        let digest = format!("{:x}", Sha256::digest(payload.bytes()));
        if let Some(item) = self.state.references.iter().find(|r| {
            r.source_id == source.id
                && r.generation == source.generation
                && r.digest == digest
                && r.kind == payload.kind()
        }) {
            return Ok(item.id.clone());
        }
        if self.state.references.len() >= MAX_REFS
            || self.state.references.iter().map(|r| r.size).sum::<u64>()
                + payload.bytes().len() as u64
                > MAX_BYTES
        {
            return Err("torznab_store_limit");
        }
        let id = new_id();
        let path = self.root.join(format!("{id}.bin"));
        let mut file = open(&path, true)?;
        file.write_all(payload.bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "torznab_store_unavailable")?;
        let mut state = self.state.clone();
        state.references.push(Reference {
            id: id.clone(),
            source_id: source.id.clone(),
            generation: source.generation.clone(),
            kind: payload.kind().into(),
            digest,
            size: payload.bytes().len() as u64,
        });
        if let Err(error) = self.save(&state) {
            let _ = std::fs::remove_file(path);
            return Err(error);
        }
        self.state = state;
        Ok(id)
    }
    pub fn payload(&self, source_id: &str, id: &str) -> Result<Payload, &'static str> {
        let source = self.source(source_id)?;
        let item = self
            .state
            .references
            .iter()
            .find(|r| r.id == id && r.source_id == source_id && r.generation == source.generation)
            .ok_or("torznab_reference_missing")?;
        let bytes = read(&self.root.join(format!("{}.bin", item.id)), 1024 * 1024)?;
        if bytes.len() as u64 != item.size || format!("{:x}", Sha256::digest(&bytes)) != item.digest
        {
            return Err("torznab_store_unavailable");
        }
        let payload = if item.kind == "torrent" {
            Payload::Torrent(bytes)
        } else {
            Payload::Magnet(String::from_utf8(bytes).map_err(|_| "torznab_store_unavailable")?)
        };
        payload.validate()?;
        Ok(payload)
    }
}

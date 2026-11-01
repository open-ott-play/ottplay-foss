//! Optional local restart cache for the one fixed public XMLTV source.
use super::{now_ms, REFRESH_MS, SOURCE_URL, WIRE_LIMIT};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
};

const MAGIC: &[u8] = b"OTT-EPG-1\n";
const HEADER: usize = MAGIC.len() + 8 + 32 + 32;

#[derive(Clone)]
pub(super) struct DiskCache {
    directory: PathBuf,
}

impl DiskCache {
    pub(super) fn configured() -> anyhow::Result<Option<Self>> {
        let Some(directory) = std::env::var_os("EPG_CACHE_DIR") else {
            return Ok(None);
        };
        anyhow::ensure!(!directory.is_empty(), "EPG_CACHE_DIR must not be empty");
        Ok(Some(Self {
            directory: PathBuf::from(directory),
        }))
    }

    pub(super) fn load(&self) -> anyhow::Result<(Vec<u8>, u64)> {
        let path = self.directory.join("snapshot.bin");
        anyhow::ensure!(
            fs::symlink_metadata(&path)?.file_type().is_file(),
            "EPG_CACHE_FILE"
        );
        let file = fs::File::open(path)?;
        anyhow::ensure!(file.metadata()?.file_type().is_file(), "EPG_CACHE_FILE");
        let mut body = Vec::new();
        file.take((HEADER + WIRE_LIMIT + 1) as u64)
            .read_to_end(&mut body)?;
        anyhow::ensure!(
            body.len() >= HEADER && body.len() <= HEADER + WIRE_LIMIT && body.starts_with(MAGIC),
            "EPG_CACHE_FORMAT"
        );
        let fetched = u64::from_be_bytes(body[MAGIC.len()..MAGIC.len() + 8].try_into()?);
        anyhow::ensure!(
            Sha256::digest(SOURCE_URL.as_bytes()).as_slice()
                == &body[MAGIC.len() + 8..MAGIC.len() + 8 + 32],
            "EPG_CACHE_SOURCE"
        );
        let now = now_ms();
        anyhow::ensure!(
            fetched > 0 && fetched <= now && now - fetched < REFRESH_MS,
            "EPG_CACHE_EXPIRED"
        );
        let payload = &body[HEADER..];
        let digest = Sha256::digest(payload);
        anyhow::ensure!(
            digest.as_slice() == &body[MAGIC.len() + 8 + 32..HEADER],
            "EPG_CACHE_CHECKSUM"
        );
        body.drain(..HEADER);
        Ok((body, fetched))
    }

    pub(super) fn save(&self, body: &[u8], fetched: u64) -> anyhow::Result<()> {
        anyhow::ensure!(body.len() <= WIRE_LIMIT, "EPG_CACHE_LIMIT");
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&self.directory)?;
        let temporary = self
            .directory
            .join(format!(".snapshot-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(MAGIC)?;
            file.write_all(&fetched.to_be_bytes())?;
            file.write_all(&Sha256::digest(SOURCE_URL.as_bytes()))?;
            file.write_all(&Sha256::digest(body))?;
            file.write_all(body)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, self.directory.join("snapshot.bin"))?;
            Ok(())
        })();
        let _ = fs::remove_file(temporary);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_checks_freshness_checksum_and_preserves_original_fetch_time() {
        let directory =
            std::env::temp_dir().join(format!("ott-epg-cache-{}", uuid::Uuid::new_v4()));
        let cache = DiskCache {
            directory: directory.clone(),
        };
        let fetched = now_ms() - 1000;
        cache.save(b"accepted-feed", fetched).unwrap();
        assert_eq!(cache.load().unwrap(), (b"accepted-feed".to_vec(), fetched));
        let path = directory.join("snapshot.bin");
        let mut corrupt = fs::read(&path).unwrap();
        *corrupt.last_mut().unwrap() ^= 1;
        fs::write(&path, corrupt).unwrap();
        assert!(cache.load().is_err());
        cache.save(b"accepted-feed", fetched).unwrap();
        let mut wrong_source = fs::read(&path).unwrap();
        wrong_source[MAGIC.len() + 8] ^= 1;
        fs::write(&path, wrong_source).unwrap();
        assert!(cache.load().is_err());
        cache.save(b"old-feed", now_ms() - REFRESH_MS - 1).unwrap();
        assert!(cache.load().is_err());
        cache.save(b"future-feed", now_ms() + 60000).unwrap();
        assert!(cache.load().is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn cache_rejects_directory_and_named_pipe_without_reading() {
        let directory =
            std::env::temp_dir().join(format!("ott-epg-cache-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(directory.join("snapshot.bin")).unwrap();
        let cache = DiskCache {
            directory: directory.clone(),
        };
        assert!(cache.load().is_err());
        fs::remove_dir(directory.join("snapshot.bin")).unwrap();
        #[cfg(unix)]
        {
            let status = std::process::Command::new("mkfifo")
                .arg(directory.join("snapshot.bin"))
                .status()
                .unwrap();
            assert!(status.success());
            assert!(cache.load().is_err());
            fs::remove_file(directory.join("snapshot.bin")).unwrap();
        }
        fs::remove_dir(directory).unwrap();
    }
}

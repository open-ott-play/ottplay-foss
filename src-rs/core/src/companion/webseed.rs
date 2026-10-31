//! BEP 19 fallback: only SHA-1 verified torrent pieces reach the video stream.
//! Two pieces per lease are retained for small probes and MP4 tail requests.
use bencode::{BencodeValue, ByteBuf};
use reqwest::Url;
use sha1::{Digest, Sha1};
use std::{
    collections::{HashSet, VecDeque},
    future::Future,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};
use tokio_util::sync::CancellationToken;

type Result<T> = std::result::Result<T, &'static str>;
const MAX_PIECE: u64 = 16 * 1024 * 1024;
const MAX_SEEDS: usize = 8;
const MAX_SEGMENTS: usize = 64;

struct File {
    path: Vec<String>,
    start: u64,
    length: u64,
    padding: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn string(out: &mut Vec<u8>, value: &[u8]) {
        out.extend_from_slice(format!("{}:", value.len()).as_bytes());
        out.extend_from_slice(value);
    }
    fn fixture(
        files: &[(&str, Vec<u8>, bool)],
        piece: usize,
        seeds: &[&str],
        multi: bool,
    ) -> Vec<u8> {
        let all: Vec<u8> = files
            .iter()
            .flat_map(|(_, bytes, _)| bytes.iter().copied())
            .collect();
        let hashes: Vec<u8> = all
            .chunks(piece)
            .flat_map(|bytes| Sha1::digest(bytes).to_vec())
            .collect();
        let mut out = b"d4:infod".to_vec();
        if multi {
            out.extend_from_slice(b"5:filesl");
            for (name, bytes, padding) in files {
                out.extend_from_slice(b"d");
                if *padding {
                    out.extend_from_slice(b"4:attr1:p");
                }
                out.extend_from_slice(format!("6:lengthi{}e4:pathl", bytes.len()).as_bytes());
                for component in name.split('/') {
                    string(&mut out, component.as_bytes());
                }
                out.extend_from_slice(b"ee");
            }
            out.extend_from_slice(b"e4:name4:root");
        } else {
            out.extend_from_slice(format!("6:lengthi{}e4:name", files[0].1.len()).as_bytes());
            string(&mut out, files[0].0.as_bytes());
        }
        out.extend_from_slice(format!("12:piece lengthi{piece}e6:pieces").as_bytes());
        string(&mut out, &hashes);
        out.extend_from_slice(b"e8:url-listl");
        for seed in seeds {
            string(&mut out, seed.as_bytes());
        }
        out.extend_from_slice(b"ee");
        out
    }

    #[tokio::test]
    async fn verified_ranges_cover_file_boundaries_padding_and_reuse_two_pieces() {
        let files = [
            ("prefix.bin", b"abc".to_vec(), false),
            ("movie.mp4", b"defghijklmno".to_vec(), false),
            ("padding", vec![0; 3], true),
        ];
        let seed = WebSeed::from_metainfo(
            &fixture(&files, 8, &["https://example.test/base/"], true),
            1,
        )
        .unwrap()
        .unwrap();
        let requests = Mutex::new(Vec::new());
        let fetch = |url: String, start: u64, length: u64, total: u64| {
            let requests = &requests;
            let files = &files;
            async move {
                requests.lock().unwrap().push((url.clone(), start, length));
                let file = files.iter().find(|f| url.ends_with(f.0)).unwrap();
                assert_eq!(total, file.1.len() as u64);
                Ok(file.1[start as usize..(start + length) as usize].to_vec())
            }
        };
        assert_eq!(seed.read_with(0, 2, &fetch).await.unwrap(), b"de");
        assert_eq!(seed.read_with(9, 3, &fetch).await.unwrap(), b"mno");
        let count = requests.lock().unwrap().len();
        assert_eq!(seed.read_with(0, 5, &fetch).await.unwrap(), b"defgh");
        assert_eq!(
            requests.lock().unwrap().len(),
            count,
            "head/tail probes reuse verified cache"
        );
        assert!(requests
            .lock()
            .unwrap()
            .iter()
            .all(|(u, _, _)| u.starts_with("https://example.test/base/root/")
                && !u.contains("padding")));
        assert_eq!(seed.downloaded(), 12);
    }

    #[tokio::test]
    async fn corrupt_seed_is_discarded_and_fallback_is_verified_before_release() {
        let files = [("movie.mp4", b"abcdefgh".to_vec(), false)];
        let seed = WebSeed::from_metainfo(
            &fixture(
                &files,
                4,
                &["https://bad.test/", "https://good.test/"],
                false,
            ),
            0,
        )
        .unwrap()
        .unwrap();
        let calls = Mutex::new(Vec::new());
        let fetch = |url: String, start: u64, length: u64, _: u64| {
            let calls = &calls;
            async move {
                calls.lock().unwrap().push(url.clone());
                Ok(if url.contains("bad.test") {
                    vec![0; length as usize]
                } else {
                    b"abcdefgh"[start as usize..(start + length) as usize].to_vec()
                })
            }
        };
        assert_eq!(seed.read_with(0, 4, &fetch).await.unwrap(), b"abcd");
        assert_eq!(seed.read_with(4, 4, &fetch).await.unwrap(), b"efgh");
        assert_eq!(
            calls
                .lock()
                .unwrap()
                .iter()
                .filter(|url| url.contains("bad.test"))
                .count(),
            1
        );
        let corrupt = WebSeed::from_metainfo(&fixture(&files, 4, &["https://bad.test/"], false), 0)
            .unwrap()
            .unwrap();
        assert_eq!(
            corrupt.read_with(0, 4, &fetch).await.unwrap_err(),
            "webseed_hash_mismatch"
        );
        assert_eq!(corrupt.downloaded(), 0);
    }

    #[test]
    fn paths_preserve_multifile_semantics_and_encode_untrusted_segments() {
        let bytes = fixture(
            &[("sub/a%2fb?.mp4", vec![1; 8], false)],
            4,
            &["https://example.test/base"],
            true,
        );
        let seed = WebSeed::from_metainfo(&bytes, 0).unwrap().unwrap();
        assert_eq!(
            seed.file_url(&seed.bases[0], &seed.files[0])
                .unwrap()
                .as_str(),
            "https://example.test/base/root/sub/a%252fb%3F.mp4"
        );
        for invalid in ["../evil", "a/./evil", "bad\\file"] {
            assert!(WebSeed::from_metainfo(
                &fixture(
                    &[(invalid, vec![1; 8], false)],
                    4,
                    &["https://example.test/"],
                    true
                ),
                0
            )
            .is_err());
        }
        let seed = WebSeed::from_metainfo(
            &fixture(
                &[("movie.mp4", vec![1; 8], false)],
                4,
                &["https://example.test/exact"],
                false,
            ),
            0,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            seed.file_url(&seed.bases[0], &seed.files[0])
                .unwrap()
                .as_str(),
            "https://example.test/exact"
        );
    }

    #[tokio::test]
    async fn cancel_interrupts_wait_for_piece_cache_without_network() {
        let seed = WebSeed::from_metainfo(
            &fixture(
                &[("movie.mp4", vec![1; 8], false)],
                4,
                &["https://example.test/"],
                false,
            ),
            0,
        )
        .unwrap()
        .unwrap();
        let _lock = seed.cache.lock().await;
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert_eq!(
            seed.read(0, 1, &cancel).await.unwrap_err(),
            "session_stopped"
        );
    }

    #[tokio::test]
    #[ignore = "requires an explicitly supplied public torrent fixture and network"]
    async fn public_fixture_verifies_head_and_tail() {
        let path = std::env::var("OTTPLAY_WEBSEED_META").expect("fixture path");
        let index: usize = std::env::var("OTTPLAY_WEBSEED_FILE")
            .unwrap_or_else(|_| "0".into())
            .parse()
            .unwrap();
        let seed = WebSeed::from_metainfo(&std::fs::read(path).unwrap(), index)
            .unwrap()
            .expect("fixture has webseed");
        let cancel = CancellationToken::new();
        let length = seed.files[index].length;
        let started = std::time::Instant::now();
        let head = seed.read(0, 1024, &cancel).await.expect("verified head");
        let tail = seed
            .read(length.saturating_sub(1024), 1024, &cancel)
            .await
            .expect("verified tail");
        assert!(!head.is_empty() && !tail.is_empty());
        let verified = seed.downloaded();
        seed.read(0, 2, &cancel).await.expect("cached head probe");
        assert_eq!(seed.downloaded(), verified);
        eprintln!(
            "verified bytes={verified}, total={length}, elapsed_ms={}",
            started.elapsed().as_millis()
        );
    }
}
#[derive(Default)]
struct Cache {
    pieces: VecDeque<(u64, Arc<Vec<u8>>)>,
    bad: HashSet<usize>,
    verified: HashSet<u64>,
}
pub(super) struct WebSeed {
    bases: Vec<Url>,
    files: Vec<File>,
    hashes: Vec<[u8; 20]>,
    piece_length: u64,
    total: u64,
    selected: usize,
    multi: bool,
    cache: tokio::sync::Mutex<Cache>,
    pub active: AtomicBool,
    downloaded: AtomicU64,
}

fn component(bytes: &[u8]) -> Result<String> {
    let value = std::str::from_utf8(bytes).map_err(|_| "invalid_metadata")?;
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.len() > 1024
        || value
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err("invalid_metadata");
    }
    Ok(value.to_owned())
}

impl WebSeed {
    pub fn from_metainfo(bytes: &[u8], selected: usize) -> Result<Option<Arc<Self>>> {
        if bytes.len() > 1024 * 1024 {
            return Err("metadata_limit");
        }
        let root: BencodeValue<ByteBuf<'_>> =
            bencode::from_bytes(bytes).map_err(|_| "invalid_metadata")?;
        let BencodeValue::Dict(root) = root else {
            return Err("invalid_metadata");
        };
        let urls = root
            .iter()
            .find(|(k, _)| k.as_ref() == b"url-list")
            .map(|(_, v)| v);
        let list = match urls {
            None => return Ok(None),
            Some(BencodeValue::Bytes(value)) => vec![value],
            Some(BencodeValue::List(values)) if values.len() <= MAX_SEEDS => values
                .iter()
                .filter_map(|v| {
                    if let BencodeValue::Bytes(value) = v {
                        Some(value)
                    } else {
                        None
                    }
                })
                .collect(),
            _ => return Ok(None),
        };
        let bases: Vec<_> = list
            .into_iter()
            .filter_map(|v| {
                std::str::from_utf8(v.as_ref())
                    .ok()
                    .and_then(|v| crate::proxy::companion_range_url(v).ok())
            })
            .collect();
        if bases.is_empty() {
            return Ok(None);
        }
        let meta = librqbit::torrent_from_bytes(bytes).map_err(|_| "invalid_metadata")?;
        let validated = meta.info.data.validate().map_err(|_| "invalid_metadata")?;
        let info = validated.info();
        let piece_length = u64::from(info.piece_length);
        if piece_length == 0 || piece_length > MAX_PIECE {
            return Err("metadata_limit");
        }
        let multi = info.files.is_some();
        let name = info
            .name
            .as_ref()
            .map(|n| component(n.as_ref()))
            .transpose()?;
        if multi && name.is_none() {
            return Err("invalid_metadata");
        }
        let mut files = Vec::new();
        let mut total = 0u64;
        for details in validated.iter_file_details() {
            if files.len() >= 4096 {
                return Err("file_limit");
            }
            if details.attrs().symlink {
                return Ok(None);
            }
            let mut path = Vec::new();
            if multi {
                path.push(name.clone().unwrap());
            }
            for part in details.filename.iter_components_bytes() {
                path.push(component(part)?);
            }
            if path.len() > 64 || path.iter().map(|p| p.len()).sum::<usize>() > 4096 {
                return Err("invalid_metadata");
            }
            files.push(File {
                path,
                start: total,
                length: details.len,
                padding: details.attrs().padding,
            });
            total = total.checked_add(details.len).ok_or("metadata_limit")?;
        }
        if total == 0
            || files
                .get(selected)
                .is_none_or(|f| f.padding || f.length == 0)
        {
            return Ok(None);
        }
        let raw: &[u8] = info.pieces.as_ref();
        if !raw.len().is_multiple_of(20) || raw.len() as u64 / 20 != total.div_ceil(piece_length) {
            return Err("invalid_metadata");
        }
        let hashes = raw
            .chunks_exact(20)
            .map(|hash| hash.try_into().unwrap())
            .collect();
        Ok(Some(Arc::new(Self {
            bases,
            files,
            hashes,
            piece_length,
            total,
            selected,
            multi,
            cache: tokio::sync::Mutex::new(Cache::default()),
            active: AtomicBool::new(false),
            downloaded: AtomicU64::new(0),
        })))
    }

    fn file_url(&self, base: &Url, file: &File) -> Result<Url> {
        let mut url = base.clone();
        // A non-directory single-file seed is the complete resource URL.
        if self.multi || base.path().ends_with('/') {
            let mut parts = url
                .path_segments_mut()
                .map_err(|_| "webseed_network_denied")?;
            parts.pop_if_empty();
            for part in &file.path {
                parts.push(part);
            }
        }
        crate::proxy::companion_range_url(url.as_str())
    }

    pub fn downloaded(&self) -> u64 {
        self.downloaded.load(Ordering::Relaxed)
    }

    async fn read_with<F, Fut>(&self, position: u64, length: usize, fetch: F) -> Result<Vec<u8>>
    where
        F: Fn(String, u64, u64, u64) -> Fut,
        Fut: Future<Output = Result<Vec<u8>>>,
    {
        let selected = &self.files[self.selected];
        if length == 0 || length > 64 * 1024 || position >= selected.length {
            return Err("webseed_invalid_range");
        }
        let absolute = selected
            .start
            .checked_add(position)
            .ok_or("webseed_invalid_range")?;
        let index = absolute / self.piece_length;
        let start = index * self.piece_length;
        let end = (start + self.piece_length).min(self.total);
        let mut cache = self.cache.lock().await;
        let cached = cache
            .pieces
            .iter()
            .position(|(i, _)| *i == index)
            .and_then(|i| cache.pieces.remove(i));
        let bytes = if let Some((_, bytes)) = cached {
            bytes
        } else {
            let mut result = Err("webseed_unavailable");
            for (seed, base) in self.bases.iter().enumerate() {
                if cache.bad.contains(&seed) {
                    continue;
                }
                let attempt = async {
                    let mut piece = Vec::with_capacity((end - start) as usize);
                    let mut segments = 0;
                    for file in &self.files {
                        let low = start.max(file.start);
                        let high = end.min(file.start + file.length);
                        if low >= high {
                            continue;
                        }
                        segments += 1;
                        if segments > MAX_SEGMENTS {
                            return Err("webseed_invalid_range");
                        }
                        if file.padding {
                            piece.resize(piece.len() + (high - low) as usize, 0);
                        } else {
                            let data = fetch(
                                self.file_url(base, file)?.to_string(),
                                low - file.start,
                                high - low,
                                file.length,
                            )
                            .await?;
                            if data.len() as u64 != high - low {
                                return Err("webseed_invalid_range");
                            }
                            piece.extend_from_slice(&data);
                        }
                    }
                    if piece.len() as u64 != end - start
                        || Sha1::digest(&piece)[..] != self.hashes[index as usize]
                    {
                        return Err("webseed_hash_mismatch");
                    }
                    Ok(Arc::new(piece))
                }
                .await;
                match attempt {
                    Ok(bytes) => {
                        result = Ok(bytes);
                        break;
                    }
                    Err("session_stopped") => return Err("session_stopped"),
                    Err(code) => {
                        if matches!(
                            code,
                            "webseed_hash_mismatch"
                                | "webseed_network_denied"
                                | "webseed_invalid_range"
                        ) {
                            cache.bad.insert(seed);
                        }
                        result = Err(code);
                    }
                }
            }
            let bytes = result?;
            if cache.verified.insert(index) {
                self.downloaded.fetch_add(
                    end.min(selected.start + selected.length) - start.max(selected.start),
                    Ordering::Relaxed,
                );
            }
            bytes
        };
        cache.pieces.push_back((index, bytes.clone()));
        while cache.pieces.len() > 2 {
            cache.pieces.pop_front();
        }
        let offset = (absolute - start) as usize;
        let size = length
            .min(bytes.len() - offset)
            .min((selected.length - position).min(length as u64) as usize);
        Ok(bytes[offset..offset + size].to_vec())
    }

    pub async fn read(
        &self,
        position: u64,
        length: usize,
        cancel: &CancellationToken,
    ) -> Result<Vec<u8>> {
        tokio::select! {
            _ = cancel.cancelled() => Err("session_stopped"),
            result = tokio::time::timeout(std::time::Duration::from_secs(30), self.read_with(position, length, |url, start, length, total| async move {
                crate::proxy::fetch_companion_range(&url, start, length, total, cancel).await
            })) => result.map_err(|_| "webseed_timeout")?,
        }
    }
}

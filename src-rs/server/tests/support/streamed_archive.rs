//! Offline local-file archive collector. Cooperative stage deadlines are NOT
//! hard bounds on filesystem syscalls; an outer process supervisor owns that.
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
fn q(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 32 => o.push_str(&format!("\\u{:04x}", c as u32)),
            _ => o.push(c),
        }
    }
    o.push('"');
    o
}
fn directory(p: &Path) -> Result<(), String> {
    fs::create_dir(p).map_err(|e| e.to_string())?;
    fs::set_permissions(p, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())
}
pub fn sha256(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h = [
        0x6a09e667u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut data = bytes.to_vec();
    let bits = (data.len() as u64).checked_mul(8).unwrap();
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0)
    }
    data.extend_from_slice(&bits.to_be_bytes());
    for block in data.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(block[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..64 {
            let x = w[i - 15];
            let y = w[i - 2];
            let a = x.rotate_right(7) ^ x.rotate_right(18) ^ (x >> 3);
            let b = y.rotate_right(17) ^ y.rotate_right(19) ^ (y >> 10);
            w[i] = w[i - 16]
                .wrapping_add(a)
                .wrapping_add(w[i - 7])
                .wrapping_add(b);
        }
        let mut v = h;
        for i in 0..64 {
            let a = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let b = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t = v[7]
                .wrapping_add(a)
                .wrapping_add(b)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let c = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let d = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            v = [
                t.wrapping_add(c).wrapping_add(d),
                v[0],
                v[1],
                v[2],
                v[3].wrapping_add(t),
                v[4],
                v[5],
                v[6],
            ];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    h.iter().map(|v| format!("{:08x}", v)).collect::<String>()
}
#[derive(Clone, Debug)]
struct Segment {
    sequence: u64,
    name: String,
    tags: Vec<String>,
    duration: f64,
    sha: String,
    bytes: u64,
}
struct Playlist {
    sequence: u64,
    version: String,
    independent: bool,
    discontinuity_sequence: Option<String>,
    target: u64,
    segments: Vec<Segment>,
}
fn parse_playlist(text: &str) -> Result<Playlist, String> {
    if text.len() > 65536 {
        return Err("playlist_too_large".into());
    }
    let mut sequence = None;
    let mut version = None;
    let mut target = None;
    let mut independent = false;
    let mut discontinuity_sequence = None;
    let mut tags = Vec::new();
    let mut duration = None;
    let mut segments = Vec::new();
    let mut first = true;
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if first {
            if line != "#EXTM3U" {
                return Err("missing_EXTM3U".into());
            }
            first = false;
            continue;
        }
        if let Some(v) = line.strip_prefix("#EXT-X-VERSION:") {
            if version.is_some() || v.parse::<u64>().is_err() {
                return Err("invalid_version".into());
            }
            version = Some(line.to_owned());
        } else if let Some(v) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            if sequence.is_some() {
                return Err("duplicate_sequence".into());
            }
            sequence = Some(v.parse::<u64>().map_err(|_| "invalid_sequence")?);
        } else if let Some(v) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
            if target.is_some() {
                return Err("duplicate_target".into());
            }
            let value = v.parse::<u64>().map_err(|_| "invalid_target")?;
            if value == 0 || value > 10 {
                return Err("invalid_target_no_repair".into());
            }
            target = Some(value);
        } else if line == "#EXT-X-INDEPENDENT-SEGMENTS" {
            independent = true;
        } else if let Some(v) = line.strip_prefix("#EXT-X-DISCONTINUITY-SEQUENCE:") {
            if discontinuity_sequence.is_some() || v.parse::<u64>().is_err() {
                return Err("invalid_discontinuity_sequence".into());
            }
            discontinuity_sequence = Some(line.to_owned());
        } else if line == "#EXT-X-DISCONTINUITY" {
            tags.push(line.to_owned());
        } else if let Some(value) = line.strip_prefix("#EXTINF:") {
            if duration.is_some() {
                return Err("duplicate_EXTINF".into());
            }
            let d = value
                .split(',')
                .next()
                .unwrap()
                .parse::<f64>()
                .map_err(|_| "invalid_EXTINF")?;
            if !d.is_finite() || d <= 0. || d > 10. {
                return Err("EXTINF_out_of_bound".into());
            }
            duration = Some(d);
            tags.push(line.to_owned());
        } else if line.starts_with('#') {
            return Err(format!("unsupported_tag:{}", line));
        } else {
            let n = line
                .strip_prefix("segment-")
                .and_then(|v| v.strip_suffix(".ts"))
                .ok_or("not_local_segment")?;
            if n.len() != 6 || !n.bytes().all(|b| b.is_ascii_digit()) {
                return Err("invalid_segment_number".into());
            }
            let number = n.parse::<u64>().map_err(|_| "segment_overflow")?;
            let first = sequence.ok_or("missing_sequence")?;
            if number != first + segments.len() as u64 {
                return Err("playlist_sequence_gap".into());
            }
            segments.push(Segment {
                sequence: number,
                name: line.to_owned(),
                tags: std::mem::take(&mut tags),
                duration: duration.take().ok_or("missing_EXTINF")?,
                sha: String::new(),
                bytes: 0,
            });
        }
    }
    if !tags.is_empty() || duration.is_some() {
        return Err("incomplete_segment_metadata".into());
    }
    let target = target.ok_or("missing_target")?;
    if segments.iter().any(|s| s.duration.ceil() as u64 > target) {
        return Err("target_less_than_EXTINF_no_repair".into());
    }
    Ok(Playlist {
        sequence: sequence.ok_or("missing_sequence")?,
        version: version.ok_or("missing_version")?,
        target,
        independent,
        discontinuity_sequence,
        segments,
    })
}

/// Each operation emits a begin/end marker. A missing end establishes the last
/// recorded stage, not whether the syscall, scheduler or logger blocked.
pub struct Archive {
    source: PathBuf,
    root: PathBuf,
    segments: BTreeMap<u64, Segment>,
    started: Instant,
    telemetry: fs::File,
    telemetry_bytes: u64,
    observation: u64,
    attempt: u64,
    manifests: u64,
    version: Option<String>,
    target: Option<u64>,
    independent: Option<bool>,
    first_discontinuity: Option<String>,
    last_live_sequence: Option<u64>,
    last_text_sha: Option<String>,
    last_failure: Option<String>,
    total_bytes: u64,
    #[cfg(test)]
    hook: Option<Box<dyn FnMut(&str, &Path)>>,
}
impl Archive {
    pub fn new(source: PathBuf, root: PathBuf) -> Result<Self, String> {
        directory(&root)?;
        directory(&root.join("observations"))?;
        let telemetry = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(root.join("CAPTURE.jsonl"))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            source,
            root,
            segments: BTreeMap::new(),
            started: Instant::now(),
            telemetry,
            telemetry_bytes: 0,
            observation: 0,
            attempt: 0,
            manifests: 0,
            version: None,
            target: None,
            independent: None,
            first_discontinuity: None,
            last_live_sequence: None,
            last_text_sha: None,
            last_failure: None,
            total_bytes: 0,
            #[cfg(test)]
            hook: None,
        })
    }
    fn event(
        &mut self,
        stage: &str,
        outcome: &str,
        operation_us: u128,
        detail: &str,
    ) -> Result<(), String> {
        let row=format!("{{\"observation\":{},\"attempt\":{},\"elapsed_us\":{},\"wall_unix_ns\":{},\"stage\":{},\"outcome\":{},\"operation_us\":{},\"archived_segments\":{},\"archived_bytes\":{},\"detail\":{}}}\n",self.observation,self.attempt,self.started.elapsed().as_micros(),SystemTime::now().duration_since(UNIX_EPOCH).map_or(0,|v|v.as_nanos()),q(stage),q(outcome),operation_us,self.segments.len(),self.total_bytes,q(detail));
        if self.telemetry_bytes + row.len() as u64 > 8 * 1024 * 1024 {
            return Err("telemetry_limit".into());
        }
        self.telemetry
            .write_all(row.as_bytes())
            .map_err(|e| format!("telemetry_write:{}", e))?;
        self.telemetry_bytes += row.len() as u64;
        Ok(())
    }
    fn boundary(&mut self, until: Instant, stage: &str) -> Result<(), String> {
        if Instant::now() >= until {
            let reason = format!("cooperative_deadline_after:{}", stage);
            self.event(stage, "deadline", 0, &reason)?;
            return Err(reason);
        }
        Ok(())
    }
    fn read(
        &mut self,
        path: &Path,
        until: Instant,
        limit: u64,
        stage: &str,
    ) -> Result<Vec<u8>, String> {
        self.boundary(until, stage)?;
        self.event(
            stage,
            "begin",
            0,
            path.file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("nonutf8"),
        )?;
        let start = Instant::now();
        let result = (|| {
            let meta =
                fs::symlink_metadata(path).map_err(|e| format!("read_metadata:{:?}", e.kind()))?;
            if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit {
                return Err("not_bounded_regular_file".into());
            }
            let value = fs::read(path).map_err(|e| format!("read_file:{:?}", e.kind()))?;
            if value.len() as u64 > limit || value.len() as u64 != meta.len() {
                return Err("file_length_changed".into());
            }
            Ok(value)
        })();
        self.event(
            stage,
            if result.is_ok() { "ok" } else { "error" },
            start.elapsed().as_micros(),
            result.as_ref().err().map(String::as_str).unwrap_or(""),
        )?;
        self.boundary(until, stage)?;
        result
    }
    fn write_new(
        &mut self,
        path: &Path,
        data: &[u8],
        until: Instant,
        stage: &str,
    ) -> Result<(), String> {
        self.boundary(until, stage)?;
        self.event(
            stage,
            "begin",
            0,
            path.file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("nonutf8"),
        )?;
        let start = Instant::now();
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .map_err(|e| format!("create_new:{:?}", e.kind()))?;
        file.write_all(data)
            .map_err(|e| format!("write_all:{:?}", e.kind()))?;
        self.event(stage, "written", start.elapsed().as_micros(), "")?;
        self.boundary(until, stage)?;
        let sync = Instant::now();
        self.event(stage, "sync_begin", 0, "")?;
        file.sync_data()
            .map_err(|e| format!("sync_data:{:?}", e.kind()))?;
        self.event(stage, "sync_ok", sync.elapsed().as_micros(), "")?;
        self.boundary(until, stage)
    }
    fn attempt_capture(&mut self, until: Instant) -> Result<bool, String> {
        let path = self.source.join("index.m3u8");
        let metadata = match fs::symlink_metadata(&path) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.event("playlist_stat", "not_yet_present", 0, "")?;
                return Ok(false);
            }
            Err(e) => return Err(format!("playlist_stat:{:?}", e.kind())),
        };
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |v| v.as_nanos());
        self.event(
            "playlist_stat",
            "ok",
            0,
            &format!(
                "bytes={} inode={} dev={} mtime_ns={}",
                metadata.len(),
                metadata.ino(),
                metadata.dev(),
                mtime
            ),
        )?;
        let raw = self.read(&path, until, 65536, "playlist_read_before")?;
        let text = std::str::from_utf8(&raw).map_err(|_| "playlist_not_utf8")?;
        let digest = sha256(&raw);
        let playlist = parse_playlist(text)?;
        if playlist.discontinuity_sequence.is_some()
            || playlist
                .segments
                .iter()
                .any(|s| s.tags.iter().any(|t| t == "#EXT-X-DISCONTINUITY"))
        {
            return Err("discontinuity_not_supported_by_qualification".into());
        }
        self.event(
            "playlist_header",
            "ok",
            0,
            &format!(
                "media_sequence={} last_sequence={:?} segments={} target={} sha256={}",
                playlist.sequence,
                playlist.segments.last().map(|s| s.sequence),
                playlist.segments.len(),
                playlist.target,
                digest
            ),
        )?;
        if playlist.segments.is_empty() {
            return Ok(false);
        }
        if self
            .last_live_sequence
            .map_or(false, |v| playlist.sequence < v)
        {
            return Err("live_sequence_regressed".into());
        }
        if self
            .version
            .as_ref()
            .map_or(false, |v| v != &playlist.version)
            || self.target.map_or(false, |v| v != playlist.target)
            || self
                .independent
                .map_or(false, |v| v != playlist.independent)
        {
            return Err("global_header_changed".into());
        }
        let mut collected = Vec::new();
        for mut seg in playlist.segments {
            let data = self.read(
                &self.source.join(&seg.name),
                until,
                2 * 1024 * 1024,
                "segment_read",
            )?;
            if data.is_empty() {
                return Err("empty_segment".into());
            }
            let hash = Instant::now();
            seg.sha = sha256(&data);
            seg.bytes = data.len() as u64;
            self.event(
                "segment_hash",
                "ok",
                hash.elapsed().as_micros(),
                &format!(
                    "sequence={} bytes={} sha256={}",
                    seg.sequence, seg.bytes, seg.sha
                ),
            )?;
            self.boundary(until, "segment_hash")?;
            collected.push((seg, data));
        }
        #[cfg(test)]
        if let Some(ref mut hook) = self.hook {
            hook("before_playlist_recheck", &self.source);
        }
        let after = self.read(&path, until, 65536, "playlist_read_after")?;
        if raw != after {
            self.event(
                "playlist_compare",
                "retry",
                0,
                "manifest_changed_during_read",
            )?;
            return Ok(false);
        }
        let mut expected = self.segments.keys().next_back().map_or(0, |v| v + 1);
        // Validate the entire new frontier before creating segment files.
        for (seg, _) in &collected {
            if let Some(old) = self.segments.get(&seg.sequence) {
                if old.name != seg.name
                    || old.tags != seg.tags
                    || old.sha != seg.sha
                    || old.bytes != seg.bytes
                {
                    return Err("existing_segment_identity_changed".into());
                }
            } else {
                if seg.sequence != expected {
                    return Err(format!(
                        "archive_gap:expected={},observed={}",
                        expected, seg.sequence
                    ));
                }
                expected += 1;
            }
        }
        self.version = Some(playlist.version);
        self.target = Some(playlist.target);
        self.independent = Some(playlist.independent);
        if self.last_live_sequence.is_none() {
            self.first_discontinuity = playlist.discontinuity_sequence;
        }
        self.last_live_sequence = Some(playlist.sequence);
        for (seg, data) in collected {
            if self.segments.contains_key(&seg.sequence) {
                let archived = self.read(
                    &self.root.join(&seg.name),
                    until,
                    2 * 1024 * 1024,
                    "archived_segment_verify",
                )?;
                if archived != data {
                    return Err("existing_archive_bytes_changed".into());
                }
            } else {
                if self.segments.len() >= 256 || self.total_bytes + seg.bytes > 64 * 1024 * 1024 {
                    return Err("archive_resource_limit".into());
                }
                self.write_new(&self.root.join(&seg.name), &data, until, "segment_write")?;
                self.total_bytes += seg.bytes;
                self.segments.insert(seg.sequence, seg);
            }
        }

        if self.last_text_sha.as_ref() != Some(&digest) {
            if self.manifests >= 256 {
                return Err("manifest_observation_limit".into());
            }
            self.manifests += 1;
            self.write_new(
                &self
                    .root
                    .join("observations")
                    .join(format!("{:06}.m3u8", self.manifests)),
                &raw,
                until,
                "manifest_observation_write",
            )?;
            self.last_text_sha = Some(digest);
        }
        self.event(
            "observation",
            "complete",
            0,
            &format!(
                "source_sequence={} source_segments={} unique_manifests={}",
                playlist.sequence, expected, self.manifests
            ),
        )?;
        Ok(true)
    }
    pub fn capture(&mut self) -> Result<(), String> {
        self.observation += 1;
        let begin = Instant::now();
        let until = begin + Duration::from_millis(1800);
        let mut last = String::new();
        loop {
            self.attempt += 1;
            self.event("capture", "begin", 0, "")?;
            match self.attempt_capture(until) {
                Ok(true) => {
                    self.event("capture", "complete", begin.elapsed().as_micros(), "")?;
                    return Ok(());
                }
                Ok(false) => last = "manifest_not_stable_or_not_present".into(),
                Err(e)
                    if !e.starts_with("cooperative_deadline")
                        && (e.contains("NotFound") || e == "file_length_changed") =>
                {
                    last = e
                }
                Err(e) => {
                    let e = if e.starts_with("cooperative_deadline") && !last.is_empty() {
                        format!("{};last_retry={}", e, last)
                    } else {
                        e
                    };
                    self.last_failure = Some(e.clone());
                    self.event("capture", "failed", begin.elapsed().as_micros(), &e)?;
                    return Err(e);
                }
            }
            if Instant::now() >= until {
                let error = format!("cooperative_capture_deadline:last={}", last);
                self.last_failure = Some(error.clone());
                self.event("capture", "failed", begin.elapsed().as_micros(), &error)?;
                return Err(error);
            }
            self.event("capture", "retry", begin.elapsed().as_micros(), &last)?;
            thread::sleep(Duration::from_millis(20));
        }
    }
    pub fn finish(&mut self, complete: bool, reason: Option<&str>) -> Result<String, String> {
        let failure = reason
            .map(str::to_owned)
            .or_else(|| self.last_failure.clone());
        let contiguous = self
            .segments
            .keys()
            .enumerate()
            .all(|(i, v)| i as u64 == *v);
        let sum = self.segments.values().map(|s| s.duration).sum::<f64>();
        let adequate_prefix = sum >= 60.;
        let qualified = complete
            && failure.is_none()
            && contiguous
            && adequate_prefix
            && !self.segments.is_empty();
        let records=self.segments.values().map(|s|format!("{{\"sequence\":{},\"name\":{},\"sha256\":{},\"bytes\":{},\"extinf_seconds\":{}}}",s.sequence,q(&s.name),q(&s.sha),s.bytes,s.duration)).collect::<Vec<_>>();
        if !self.segments.is_empty() {
            let mut text = format!(
                "#EXTM3U\n{}\n#EXT-X-TARGETDURATION:{}\n#EXT-X-MEDIA-SEQUENCE:0\n",
                self.version.as_ref().ok_or("missing_final_version")?,
                self.target.ok_or("missing_final_target")?
            );
            if let Some(d) = &self.first_discontinuity {
                text.push_str(d);
                text.push('\n')
            }
            if self.independent == Some(true) {
                text.push_str("#EXT-X-INDEPENDENT-SEGMENTS\n")
            }
            for seg in self.segments.values() {
                for tag in &seg.tags {
                    text.push_str(tag);
                    text.push('\n')
                }
                text.push_str(&seg.name);
                text.push('\n')
            }
            text.push_str("#EXT-X-ENDLIST\n");
            fs::write(
                self.root.join(if qualified {
                    "index.m3u8"
                } else {
                    "partial-prefix.m3u8"
                }),
                text,
            )
            .map_err(|e| e.to_string())?;
        }
        let summary=format!("{{\"complete_capture\":{},\"qualified\":{},\"contiguous_from_zero\":{},\"segment_count\":{},\"last_sequence\":{},\"extinf_sum_not_decoded_duration\":{},\"at_least_60s_EXTINF\":{},\"failure_reason\":{},\"observations\":{},\"attempts\":{},\"unique_manifests\":{},\"segments\":[{}],\"deadline_scope\":\"cooperative checks between blocking filesystem calls; outer owned process supervisor enforces whole-driver bound\",\"measurement_scope\":\"closed contiguous prefix only; no missing segment fabrication, no PTS reset, no target repair; >=60 decoded selected PCM/PTS remains independent\"}}",complete,qualified,contiguous,self.segments.len(),self.segments.keys().next_back().map_or("null".into(),|n|n.to_string()),sum,adequate_prefix,failure.as_deref().map_or("null".into(),q),self.observation,self.attempt,self.manifests,records.join(","));
        fs::write(self.root.join("ARCHIVE.json"), &summary).map_err(|e| e.to_string())?;
        self.event(
            "finalize",
            if qualified {
                "capture_complete"
            } else {
                "diagnostic_prefix_only"
            },
            0,
            failure.as_deref().unwrap_or(""),
        )?;
        self.telemetry.sync_data().map_err(|e| e.to_string())?;
        if qualified {
            Ok(summary)
        } else {
            Err(format!(
                "archive_incomplete_or_short:prefix_saved;{}",
                failure.as_deref().unwrap_or("less_than60s")
            ))
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Case {
        root: PathBuf,
        live: PathBuf,
    }
    impl Case {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "archive-v2-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            directory(&root).unwrap();
            let live = root.join("live");
            directory(&live).unwrap();
            Self { root, live }
        }
        fn archive(&self) -> Archive {
            Archive::new(self.live.clone(), self.root.join("capture")).unwrap()
        }
        fn playlist(&self, first: u64, count: u64, target: u64) {
            let mut value=format!("#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:{}\n#EXT-X-MEDIA-SEQUENCE:{}\n#EXT-X-INDEPENDENT-SEGMENTS\n",target,first);
            for n in first..first + count {
                value.push_str(&format!("#EXTINF:1.000000,\nsegment-{:06}.ts\n", n));
            }
            fs::write(self.live.join("index.m3u8"), value).unwrap();
        }
        fn segments(&self, first: u64, count: u64) {
            for n in first..first + count {
                fs::write(
                    self.live.join(format!("segment-{:06}.ts", n)),
                    format!("synthetic transport bytes for{}", n),
                )
                .unwrap();
            }
        }
    }
    impl Drop for Case {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }
    #[test]
    fn unchanged_manifest_is_logged_and_not_mistaken_for_progress() {
        let c = Case::new();
        c.segments(0, 2);
        c.playlist(0, 2, 1);
        let mut a = c.archive();
        a.capture().unwrap();
        a.capture().unwrap();
        assert_eq!(a.segments.len(), 2);
        assert_eq!(a.observation, 2);
        assert_eq!(a.manifests, 1);
        assert!(a.finish(true, None).is_err());
        let text = fs::read_to_string(c.root.join("capture/ARCHIVE.json")).unwrap();
        assert!(text.contains("\"qualified\":false"));
        assert!(text.contains("\"segment_count\":2"));
        assert!(!c.root.join("capture/index.m3u8").exists());
        assert!(c.root.join("capture/partial-prefix.m3u8").exists());
    }
    #[test]
    fn normal_rotation_preserves_every_byte_and_contiguous_sixty() {
        let c = Case::new();
        let mut a = c.archive();
        for n in 0..65 {
            c.segments(n, 1);
            let start = n.saturating_sub(7);
            c.playlist(start, n - start + 1, 1);
            a.capture().unwrap();
        }
        let result = a.finish(true, None).unwrap();
        assert!(result.contains("\"qualified\":true"));
        assert!(result.contains("\"segment_count\":65"));
        let playlist = fs::read_to_string(c.root.join("capture/index.m3u8")).unwrap();
        assert!(playlist.ends_with("#EXT-X-ENDLIST\n"));
        for n in 0..65 {
            assert_eq!(
                fs::read(c.live.join(format!("segment-{:06}.ts", n))).unwrap(),
                fs::read(c.root.join("capture").join(format!("segment-{:06}.ts", n))).unwrap()
            );
        }
    }
    #[test]
    fn missing_segment_records_exact_failure_and_saves_prefix() {
        let c = Case::new();
        c.segments(0, 1);
        c.playlist(0, 1, 1);
        let mut a = c.archive();
        a.capture().unwrap();
        c.playlist(0, 2, 1);
        let error = a.capture().unwrap_err();
        assert!(error.contains("NotFound"));
        assert!(a.finish(false, Some(&error)).is_err());
        assert!(
            fs::read_to_string(c.root.join("capture/partial-prefix.m3u8"))
                .unwrap()
                .contains("segment-000000.ts")
        );
        let telemetry = fs::read_to_string(c.root.join("capture/CAPTURE.jsonl")).unwrap();
        assert!(telemetry.contains("read_metadata:NotFound"));
        assert!(telemetry.contains("cooperative_"));
    }
    #[test]
    fn missed_sequence_is_not_fabricated() {
        let c = Case::new();
        c.segments(0, 1);
        c.playlist(0, 1, 1);
        let mut a = c.archive();
        a.capture().unwrap();
        c.segments(2, 1);
        c.playlist(2, 1, 1);
        let error = a.capture().unwrap_err();
        assert!(error.contains("archive_gap"));
        assert!(a.finish(false, Some(&error)).is_err());
        assert!(!c.root.join("capture/segment-000001.ts").exists());
    }
    #[test]
    fn changed_previously_archived_source_bytes_are_rejected() {
        let c = Case::new();
        c.segments(0, 1);
        c.playlist(0, 1, 1);
        let mut a = c.archive();
        a.capture().unwrap();
        fs::write(c.live.join("segment-000000.ts"), b"changed closed segment").unwrap();
        let error = a.capture().unwrap_err();
        assert_eq!(error, "existing_segment_identity_changed");
        assert!(a.finish(false, Some(&error)).is_err());
    }
    #[test]
    fn changed_archive_bytes_are_rejected_even_with_source_hash_unchanged() {
        let c = Case::new();
        c.segments(0, 1);
        c.playlist(0, 1, 1);
        let mut a = c.archive();
        a.capture().unwrap();
        fs::write(
            c.root.join("capture/segment-000000.ts"),
            b"changed archive copy",
        )
        .unwrap();
        let error = a.capture().unwrap_err();
        assert_eq!(error, "existing_archive_bytes_changed");
    }
    #[test]
    fn invalid_target_is_never_repaired() {
        let c = Case::new();
        c.segments(0, 1);
        c.playlist(0, 1, 0);
        let mut a = c.archive();
        assert!(a.capture().unwrap_err().contains("target_no_repair"));
        assert!(a.finish(false, Some("invalid target")).is_err());
        assert!(!c.root.join("capture/index.m3u8").exists());
    }
    #[test]
    fn changed_playlist_retry_is_telemetried_then_recovers() {
        let c = Case::new();
        c.segments(0, 1);
        c.playlist(0, 1, 1);
        let mut a = c.archive();
        let mut once = true;
        a.hook = Some(Box::new(move |_, source| {
            if once {
                let p = source.join("index.m3u8");
                let text = fs::read_to_string(&p)
                    .unwrap()
                    .replace("#EXT-X-TARGETDURATION:1", "#EXT-X-TARGETDURATION:2");
                fs::write(p, text).unwrap();
                once = false;
            }
        }));
        a.capture().unwrap();
        assert!(a.attempt >= 2);
        let log = fs::read_to_string(c.root.join("capture/CAPTURE.jsonl")).unwrap();
        assert!(log.contains("manifest_changed_during_read"));
        assert_eq!(a.target, Some(2));
    }
    #[test]
    fn prior_failure_cannot_qualify_even_when_complete_is_claimed() {
        let c = Case::new();
        c.segments(0, 65);
        c.playlist(0, 65, 1);
        let mut a = c.archive();
        a.capture().unwrap();
        c.segments(66, 1);
        c.playlist(66, 1, 1);
        assert!(a.capture().unwrap_err().contains("archive_gap"));
        assert!(a.finish(true, None).is_err());
        assert!(!c.root.join("capture/index.m3u8").exists());
        let summary = fs::read_to_string(c.root.join("capture/ARCHIVE.json")).unwrap();
        assert!(summary.contains("\"qualified\":false"));
        assert!(summary.contains("archive_gap"));
    }
    #[test]
    fn metadata_dependencies_not_silently_dropped() {
        for extra in [
            "#EXT-X-KEY:METHOD=AES-128,URI=\"key\"",
            "#EXT-X-MAP:URI=\"map\"",
        ] {
            let c = Case::new();
            c.segments(0, 1);
            c.playlist(0, 1, 1);
            let p = c.live.join("index.m3u8");
            let text = fs::read_to_string(&p)
                .unwrap()
                .replace("#EXTINF:", &format!("{}\n#EXTINF:", extra));
            fs::write(p, text).unwrap();
            let mut a = c.archive();
            assert!(a.capture().unwrap_err().contains("unsupported_tag"));
        }
    }
    #[test]
    fn discontinuities_are_outside_current_encoder_qualification() {
        let c = Case::new();
        c.segments(0, 1);
        c.playlist(0, 1, 1);
        let p = c.live.join("index.m3u8");
        let text = fs::read_to_string(&p)
            .unwrap()
            .replace("#EXTINF:", "#EXT-X-DISCONTINUITY\n#EXTINF:");
        fs::write(p, text).unwrap();
        let mut a = c.archive();
        assert!(a
            .capture()
            .unwrap_err()
            .contains("discontinuity_not_supported"));
    }
    #[test]
    fn hash_vectors_and_json_quote_are_actual() {
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(q("hello\n"), "\"hello\\n\"");
    }
}

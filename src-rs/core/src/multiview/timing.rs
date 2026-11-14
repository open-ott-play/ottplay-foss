//! Strict decoder metadata/timebase parsing. No media IO or pacing clock.
//!
//! Input schema: `V {ordinal} {pts} {timebase} {bytes}` or `A ...`.
//! Each producer generation needs its own parser. Metadata does not prove that
//! its declared payload was read; the host must correlate bounded raw bytes.
//! Positive PCM timestamp gaps are reported, never filled or retimestamped here.
//! The first source PTS values and their cross-stream offset remain unchanged.

use std::{fmt, time::Duration};

pub const MAX_LINE_BYTES: usize = 256;
pub const MAX_AUDIO_BYTES: u32 = 32_768;
pub const MAX_VIDEO_BYTES: u32 = 1920 * 1080 * 3;
pub const DEFAULT_AUDIO_SAMPLE_RATE: u32 = 48_000;
const MAX_TIMEBASE_COMPONENT: u32 = 1_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StatsError {
    LineTooLong,
    Malformed,
    InvalidKind,
    NumericOverflow,
    InvalidTimeBase,
    TimeBaseChanged,
    OrdinalGap,
    NonMonotonicPts,
    AudioOverlap,
    UnexpectedVideoSize,
    InvalidPcmSize,
    MissingTimestamp,
    InvalidConfiguration,
    NegativeDuration,
    WrongStreamKind,
}

impl fmt::Display for StatsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::LineTooLong => "metadata line exceeds byte budget",
            Self::Malformed => "invalid metadata syntax",
            Self::InvalidKind => "unknown metadata stream kind",
            Self::NumericOverflow => "metadata arithmetic exceeds bounds",
            Self::InvalidTimeBase => "invalid metadata timebase",
            Self::TimeBaseChanged => "metadata timebase changed",
            Self::OrdinalGap => "metadata ordinal is discontinuous",
            Self::NonMonotonicPts => "metadata timestamp did not advance",
            Self::AudioOverlap => "metadata audio intervals overlap",
            Self::UnexpectedVideoSize => "metadata video payload size does not match",
            Self::InvalidPcmSize => "metadata PCM payload is not complete bounded stereo frames",
            Self::MissingTimestamp => "metadata timestamp is unavailable",
            Self::InvalidConfiguration => "invalid metadata parser configuration",
            Self::NegativeDuration => "negative timestamp difference is not a duration",
            Self::WrongStreamKind => "operation does not apply to this stream kind",
        })
    }
}
impl std::error::Error for StatsError {}

fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a.max(1)
}

/// Reduced signed rational seconds. No implicit wall-clock anchor or rounding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RationalTime {
    numerator: i128,
    denominator: i128,
}
impl RationalTime {
    pub fn new(numerator: i128, denominator: i128) -> Result<Self, StatsError> {
        if denominator <= 0 {
            return Err(StatsError::InvalidTimeBase);
        }
        let divisor = gcd(numerator.unsigned_abs(), denominator as u128) as i128;
        Ok(Self {
            numerator: numerator / divisor,
            denominator: denominator / divisor,
        })
    }
    pub fn numerator(self) -> i128 {
        self.numerator
    }
    pub fn denominator(self) -> i128 {
        self.denominator
    }
    fn scales(self, other: Self) -> (i128, i128) {
        let divisor = gcd(self.denominator as u128, other.denominator as u128) as i128;
        (other.denominator / divisor, self.denominator / divisor)
    }
    pub fn checked_add(self, other: Self) -> Result<Self, StatsError> {
        let (left_scale, right_scale) = self.scales(other);
        let left = self
            .numerator
            .checked_mul(left_scale)
            .ok_or(StatsError::NumericOverflow)?;
        let right = other
            .numerator
            .checked_mul(right_scale)
            .ok_or(StatsError::NumericOverflow)?;
        let numerator = left.checked_add(right).ok_or(StatsError::NumericOverflow)?;
        let denominator = self
            .denominator
            .checked_mul(left_scale)
            .ok_or(StatsError::NumericOverflow)?;
        Self::new(numerator, denominator)
    }
    pub fn checked_sub(self, other: Self) -> Result<Self, StatsError> {
        let (left_scale, right_scale) = self.scales(other);
        let left = self
            .numerator
            .checked_mul(left_scale)
            .ok_or(StatsError::NumericOverflow)?;
        let right = other
            .numerator
            .checked_mul(right_scale)
            .ok_or(StatsError::NumericOverflow)?;
        let numerator = left.checked_sub(right).ok_or(StatsError::NumericOverflow)?;
        let denominator = self
            .denominator
            .checked_mul(left_scale)
            .ok_or(StatsError::NumericOverflow)?;
        Self::new(numerator, denominator)
    }
    /// Explicit floor conversion. Keep RationalTime when sub-nanosecond precision
    /// matters; negative source PTS values are valid but are not std::Duration.
    pub fn to_duration_floor(self) -> Result<Duration, StatsError> {
        if self.numerator < 0 {
            return Err(StatsError::NegativeDuration);
        }
        let seconds = u64::try_from(self.numerator / self.denominator)
            .map_err(|_| StatsError::NumericOverflow)?;
        let remainder = self.numerator % self.denominator;
        let nanos = remainder
            .checked_mul(1_000_000_000)
            .ok_or(StatsError::NumericOverflow)?
            / self.denominator;
        Ok(Duration::new(seconds, nanos as u32))
    }
    pub fn duration_since(self, earlier: Self) -> Result<Duration, StatsError> {
        self.checked_sub(earlier)?.to_duration_floor()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeBase {
    numerator: u32,
    denominator: u32,
}
impl TimeBase {
    pub fn new(numerator: u32, denominator: u32) -> Result<Self, StatsError> {
        if numerator == 0
            || denominator == 0
            || numerator > MAX_TIMEBASE_COMPONENT
            || denominator > MAX_TIMEBASE_COMPONENT
        {
            return Err(StatsError::InvalidTimeBase);
        }
        let divisor = gcd(u128::from(numerator), u128::from(denominator)) as u32;
        Ok(Self {
            numerator: numerator / divisor,
            denominator: denominator / divisor,
        })
    }
    pub fn numerator(self) -> u32 {
        self.numerator
    }
    pub fn denominator(self) -> u32 {
        self.denominator
    }
    pub fn timestamp(self, pts: i128) -> Result<RationalTime, StatsError> {
        // Cancel before multiplying; never use floating-point PTS conversion.
        let divisor = gcd(pts.unsigned_abs(), u128::from(self.denominator)) as i128;
        let numerator = (pts / divisor)
            .checked_mul(i128::from(self.numerator))
            .ok_or(StatsError::NumericOverflow)?;
        RationalTime::new(numerator, i128::from(self.denominator) / divisor)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamKind {
    Video,
    Audio,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PacketStats {
    pub kind: StreamKind,
    pub ordinal: u64,
    pub pts: i128,
    pub time_base: TimeBase,
    pub byte_size: u32,
    /// None for the first audio packet or video; Some(0) means contiguous PCM.
    /// A positive value is an actual source-PTS presentation gap, not silence
    /// inserted by this parser and not proof of healthy continuity.
    pub audio_gap_before_frames: Option<u64>,
}
impl PacketStats {
    pub fn timestamp(self) -> Result<RationalTime, StatsError> {
        self.time_base.timestamp(self.pts)
    }
    pub fn delta_since(self, earlier: Self) -> Result<RationalTime, StatsError> {
        self.timestamp()?.checked_sub(earlier.timestamp()?)
    }
    pub fn pcm_frames(self) -> Result<u32, StatsError> {
        if self.kind != StreamKind::Audio {
            return Err(StatsError::WrongStreamKind);
        }
        if self.byte_size == 0 || self.byte_size > MAX_AUDIO_BYTES || self.byte_size % 4 != 0 {
            return Err(StatsError::InvalidPcmSize);
        }
        Ok(self.byte_size / 4)
    }
}

pub struct StatsParser {
    expected_video_frame_bytes: u32,
    audio_time_base: TimeBase,
    last_video: Option<PacketStats>,
    last_audio: Option<PacketStats>,
    first_video: Option<PacketStats>,
    first_audio: Option<PacketStats>,
}
impl StatsParser {
    pub fn new(expected_video_frame_bytes: u32) -> Result<Self, StatsError> {
        Self::with_audio_sample_rate(expected_video_frame_bytes, DEFAULT_AUDIO_SAMPLE_RATE)
    }
    pub fn with_audio_sample_rate(
        expected_video_frame_bytes: u32,
        sample_rate: u32,
    ) -> Result<Self, StatsError> {
        if expected_video_frame_bytes == 0
            || expected_video_frame_bytes > MAX_VIDEO_BYTES
            || expected_video_frame_bytes % 3 != 0
            || sample_rate == 0
            || sample_rate > 768_000
        {
            return Err(StatsError::InvalidConfiguration);
        }
        Ok(Self {
            expected_video_frame_bytes,
            audio_time_base: TimeBase::new(1, sample_rate)?,
            last_video: None,
            last_audio: None,
            first_video: None,
            first_audio: None,
        })
    }
    pub fn parse_line(&mut self, line: &[u8]) -> Result<PacketStats, StatsError> {
        if line.len() > MAX_LINE_BYTES {
            return Err(StatsError::LineTooLong);
        }
        let line = if let Some(line) = line.strip_suffix(b"\r\n") {
            line
        } else {
            line.strip_suffix(b"\n").unwrap_or(line)
        };
        if line.is_empty()
            || !line
                .iter()
                .all(|byte| byte.is_ascii_graphic() || *byte == b' ')
        {
            return Err(StatsError::Malformed);
        }
        let text = std::str::from_utf8(line).map_err(|_| StatsError::Malformed)?;
        let fields = text.split(' ').collect::<Vec<_>>();
        if fields.len() != 5 || fields.iter().any(|field| field.is_empty()) {
            return Err(StatsError::Malformed);
        }
        let kind = match fields[0] {
            "V" => StreamKind::Video,
            "A" => StreamKind::Audio,
            _ => return Err(StatsError::InvalidKind),
        };
        let ordinal = unsigned(fields[1])?;
        if fields[2] == "N/A" {
            return Err(StatsError::MissingTimestamp);
        }
        let digits = fields[2].strip_prefix('-').unwrap_or(fields[2]);
        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(StatsError::Malformed);
        }
        let pts = fields[2]
            .parse::<i128>()
            .map_err(|_| StatsError::NumericOverflow)?;
        if pts == i128::from(i64::MIN) {
            return Err(StatsError::MissingTimestamp);
        }
        // AVFrame PTS is signed 64-bit. Wider arithmetic is for exact scaling,
        // not for accepting impossible timestamp values from the child.
        i64::try_from(pts).map_err(|_| StatsError::NumericOverflow)?;
        let (numerator, denominator) = fields[3]
            .split_once('/')
            .ok_or(StatsError::InvalidTimeBase)?;
        let numerator =
            u32::try_from(unsigned(numerator)?).map_err(|_| StatsError::NumericOverflow)?;
        let denominator =
            u32::try_from(unsigned(denominator)?).map_err(|_| StatsError::NumericOverflow)?;
        let time_base = TimeBase::new(numerator, denominator)?;
        let byte_size =
            u32::try_from(unsigned(fields[4])?).map_err(|_| StatsError::NumericOverflow)?;
        let mut packet = PacketStats {
            kind,
            ordinal,
            pts,
            time_base,
            byte_size,
            audio_gap_before_frames: None,
        };
        packet.timestamp()?;
        if kind == StreamKind::Video {
            if byte_size != self.expected_video_frame_bytes {
                return Err(StatsError::UnexpectedVideoSize);
            }
        } else {
            packet.pcm_frames()?;
            if time_base != self.audio_time_base {
                return Err(StatsError::InvalidTimeBase);
            }
        }
        let previous = match kind {
            StreamKind::Video => self.last_video,
            StreamKind::Audio => self.last_audio,
        };
        if let Some(previous) = previous {
            if previous.time_base != packet.time_base {
                return Err(StatsError::TimeBaseChanged);
            }
            if previous
                .ordinal
                .checked_add(1)
                .ok_or(StatsError::NumericOverflow)?
                != ordinal
            {
                return Err(StatsError::OrdinalGap);
            }
            if pts <= previous.pts {
                return Err(StatsError::NonMonotonicPts);
            }
            if kind == StreamKind::Audio {
                let expected = previous
                    .pts
                    .checked_add(i128::from(previous.pcm_frames()?))
                    .ok_or(StatsError::NumericOverflow)?;
                if pts < expected {
                    return Err(StatsError::AudioOverlap);
                }
                packet.audio_gap_before_frames = Some(
                    u64::try_from(
                        pts.checked_sub(expected)
                            .ok_or(StatsError::NumericOverflow)?,
                    )
                    .map_err(|_| StatsError::NumericOverflow)?,
                );
            }
        } else if ordinal != 0 {
            return Err(StatsError::OrdinalGap);
        }
        // Update only after every check; a rejected record cannot desynchronize
        // the next expected payload ordinal or erase the true first source PTS.
        match kind {
            StreamKind::Video => {
                self.first_video.get_or_insert(packet);
                self.last_video = Some(packet);
            }
            StreamKind::Audio => {
                self.first_audio.get_or_insert(packet);
                self.last_audio = Some(packet);
            }
        }
        Ok(packet)
    }
    pub fn audio_start_offset_from_video(&self) -> Result<Option<RationalTime>, StatsError> {
        match (self.first_audio, self.first_video) {
            (Some(audio), Some(video)) => Ok(Some(audio.delta_since(video)?)),
            _ => Ok(None),
        }
    }
}

fn unsigned(value: &str) -> Result<u64, StatsError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(StatsError::Malformed);
    }
    value
        .parse::<u64>()
        .map_err(|_| StatsError::NumericOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parser() -> StatsParser {
        StatsParser::new(18_432).unwrap()
    }

    #[test]
    fn actual_variable_pcm_packets_use_size_not_twenty_milliseconds() {
        let mut parser = parser();
        parser.parse_line(b"V 0 0 1/10 18432\n").unwrap();
        let first = parser.parse_line(b"A 0 0 1/48000 12096\n").unwrap();
        let second = parser.parse_line(b"A 1 3024 1/48000 12288\n").unwrap();
        assert_eq!(first.pcm_frames(), Ok(3024));
        assert_eq!(second.pcm_frames(), Ok(3072));
        assert_eq!(second.delta_since(first), RationalTime::new(63, 1000));
        assert_eq!(second.audio_gap_before_frames, Some(0));
    }

    #[test]
    fn positive_gap_is_reported_and_overlap_rejected_without_retiming() {
        let mut parser = parser();
        parser.parse_line(b"A 0 0 1/48000 12096").unwrap();
        let packet = parser.parse_line(b"A 1 3504 1/48000 12288").unwrap();
        assert_eq!(packet.pts, 3504);
        assert_eq!(packet.audio_gap_before_frames, Some(480));
        assert_eq!(
            parser.parse_line(b"A 2 6000 1/48000 12288"),
            Err(StatsError::AudioOverlap)
        );
        let next = parser.parse_line(b"A 2 6576 1/48000 4").unwrap();
        assert_eq!(next.audio_gap_before_frames, Some(0));
    }

    #[test]
    fn delayed_audio_offset_is_preserved_independently_of_arrival_order() {
        for audio_first in [false, true] {
            let mut parser = parser();
            let video = b"V 0 0 1/10 18432".as_slice();
            let audio = b"A 0 19200 1/48000 12096".as_slice();
            for line in if audio_first {
                [audio, video]
            } else {
                [video, audio]
            } {
                parser.parse_line(line).unwrap();
            }
            let offset = parser.audio_start_offset_from_video().unwrap().unwrap();
            assert_eq!(offset, RationalTime::new(2, 5).unwrap());
            assert_eq!(offset.to_duration_floor(), Ok(Duration::from_millis(400)));
        }
        let mut parser = parser();
        parser.parse_line(b"V 0 100 1/10 18432").unwrap();
        parser.parse_line(b"A 0 499200 1/48000 12096").unwrap();
        assert_eq!(
            parser.audio_start_offset_from_video(),
            Ok(Some(RationalTime::new(2, 5).unwrap()))
        );
    }

    #[test]
    fn negative_preroll_and_fractional_precision_are_preserved() {
        let mut parser = parser();
        parser.parse_line(b"A 0 -4800 1/48000 12096").unwrap();
        parser.parse_line(b"V 0 0 1/10 18432").unwrap();
        let offset = parser.audio_start_offset_from_video().unwrap().unwrap();
        assert_eq!(offset, RationalTime::new(-1, 10).unwrap());
        assert_eq!(
            offset.to_duration_floor(),
            Err(StatsError::NegativeDuration)
        );
        let exact = TimeBase::new(1, 3).unwrap().timestamp(1).unwrap();
        assert_eq!(exact.numerator(), 1);
        assert_eq!(exact.denominator(), 3);
        assert_eq!(exact.to_duration_floor(), Ok(Duration::new(0, 333_333_333)));
    }

    #[test]
    fn rejects_bad_lines_without_raw_text_in_errors() {
        let cases: &[&[u8]] = &[
            b"",
            b"V\t0 0 1/10 18432",
            b" V 0 0 1/10 18432",
            b"V  0 0 1/10 18432",
            b"V 0 0 1/10 18432 extra",
            b"X 0 0 1/10 18432",
            b"V 0 +0 1/10 18432",
            b"V 0 0 1/10 18432\nA 0 0 1/48000 4",
            b"V 0 0 1/10 18432\0",
            b"V 0 0 1/10 \xff",
        ];
        for line in cases {
            let error = parser().parse_line(line).unwrap_err();
            assert!(!error.to_string().contains("18432"));
        }
        assert_eq!(
            parser().parse_line(&[b' '; 257]),
            Err(StatsError::LineTooLong)
        );
    }

    #[test]
    fn rejects_zero_huge_changing_or_wrong_pcm_timebase() {
        for line in [
            b"V 0 0 0/10 18432".as_slice(),
            b"V 0 0 1/0 18432",
            b"V 0 0 1/1000000001 18432",
            b"A 0 0 1/44100 4",
        ] {
            assert_eq!(parser().parse_line(line), Err(StatsError::InvalidTimeBase));
        }
        let mut parser = parser();
        parser.parse_line(b"V 0 0 1/10 18432").unwrap();
        assert_eq!(
            parser.parse_line(b"V 1 1 1/11 18432"),
            Err(StatsError::TimeBaseChanged)
        );
        assert!(parser.parse_line(b"V 1 1 2/20 18432").is_ok());
        let mut custom = StatsParser::with_audio_sample_rate(18_432, 44_100).unwrap();
        assert!(custom.parse_line(b"A 0 0 1/44100 4").is_ok());
    }

    #[test]
    fn pts_reset_ordinal_gap_and_partial_pcm_are_closed_and_transactional() {
        let mut parser = parser();
        parser.parse_line(b"V 0 10 1/10 18432").unwrap();
        assert_eq!(
            parser.parse_line(b"V 2 11 1/10 18432"),
            Err(StatsError::OrdinalGap)
        );
        assert_eq!(
            parser.parse_line(b"V 1 0 1/10 18432"),
            Err(StatsError::NonMonotonicPts)
        );
        assert!(parser.parse_line(b"V 1 11 1/10 18432").is_ok());
        for line in [
            b"A 0 0 1/48000 2".as_slice(),
            b"A 0 0 1/48000 32772",
            b"A 0 0 1/48000 0",
        ] {
            assert_eq!(parser.parse_line(line), Err(StatsError::InvalidPcmSize));
        }
        assert_eq!(
            parser.parse_line(b"V 2 12 1/10 18435"),
            Err(StatsError::UnexpectedVideoSize)
        );
    }

    #[test]
    fn no_pts_sentinel_and_numeric_overflow_never_become_a_zero_anchor() {
        for line in [
            b"A 0 N/A 1/48000 4".as_slice(),
            b"A 0 -9223372036854775808 1/48000 4",
        ] {
            assert_eq!(parser().parse_line(line), Err(StatsError::MissingTimestamp));
        }
        assert_eq!(
            parser().parse_line(b"V 18446744073709551616 0 1/10 18432"),
            Err(StatsError::NumericOverflow)
        );
        assert_eq!(
            parser().parse_line(b"V 0 170141183460469231731687303715884105727 1/10 18432"),
            Err(StatsError::NumericOverflow)
        );
        assert_eq!(
            TimeBase::new(2, 1).unwrap().timestamp(i128::MAX),
            Err(StatsError::NumericOverflow)
        );
        assert_eq!(
            RationalTime::new(i128::MAX, 1)
                .unwrap()
                .checked_add(RationalTime::new(1, 1).unwrap()),
            Err(StatsError::NumericOverflow)
        );
        assert_eq!(
            RationalTime::new(i128::MIN, 1)
                .unwrap()
                .checked_sub(RationalTime::new(1, 1).unwrap()),
            Err(StatsError::NumericOverflow)
        );
    }
}

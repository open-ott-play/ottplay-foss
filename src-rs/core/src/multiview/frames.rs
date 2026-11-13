//! Per-source latest-frame mailboxes and fixed-canvas RGB composition.
//! Each mailbox retains one frame; the renderer borrows snapshots for one tick.
use super::geometry::ValidatedGeometry;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameSpec {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameError {
    InvalidSpec,
    InvalidLength,
    StaleGeneration,
    InvalidGeneration,
    StaleSequence,
    InvalidTimestamp,
    Terminal,
    InvalidSlot,
}

fn byte_len(spec: FrameSpec) -> Result<usize, FrameError> {
    if spec.width == 0 || spec.height == 0 || spec.width > 1920 || spec.height > 1080 {
        return Err(FrameError::InvalidSpec);
    }
    usize::try_from(u64::from(spec.width) * u64::from(spec.height) * 3)
        .map_err(|_| FrameError::InvalidSpec)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameStatus {
    Starting,
    Stalled,
    Ended,
    Failed,
}

#[derive(Debug)]
pub struct Frame {
    pub generation: u64,
    pub sequence: u64,
    pub spec: FrameSpec,
    pub pixels: Arc<[u8]>,
    pub received_at: Instant,
}

#[derive(Clone, Debug)]
pub enum FrameView {
    Ready(Arc<Frame>),
    Slate(FrameStatus),
}

struct State {
    generation: u64,
    sequence: u64,
    latest: Option<Arc<Frame>>,
    terminal: Option<FrameStatus>,
}

pub struct LatestFrame {
    spec: FrameSpec,
    state: Mutex<State>,
}

impl LatestFrame {
    pub fn new(spec: FrameSpec, generation: u64) -> Result<Self, FrameError> {
        byte_len(spec)?;
        Ok(Self {
            spec,
            state: Mutex::new(State {
                generation,
                sequence: 0,
                latest: None,
                terminal: None,
            }),
        })
    }
    fn state(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }
    pub fn generation(&self) -> u64 {
        self.state().generation
    }
    pub fn sequence(&self) -> u64 {
        self.state().sequence
    }
    pub fn advance(&self, expected: u64, next: u64) -> Result<(), FrameError> {
        let mut state = self.state();
        if state.generation != expected {
            return Err(FrameError::StaleGeneration);
        }
        if next <= expected {
            return Err(FrameError::InvalidGeneration);
        }
        *state = State {
            generation: next,
            sequence: 0,
            latest: None,
            terminal: None,
        };
        Ok(())
    }
    pub fn publish(
        &self,
        generation: u64,
        sequence: u64,
        pixels: Vec<u8>,
        received_at: Instant,
    ) -> Result<(), FrameError> {
        if pixels.len() != byte_len(self.spec)? {
            return Err(FrameError::InvalidLength);
        }
        let mut state = self.state();
        if generation != state.generation {
            return Err(FrameError::StaleGeneration);
        }
        if state.terminal.is_some() {
            return Err(FrameError::Terminal);
        }
        if sequence <= state.sequence {
            return Err(FrameError::StaleSequence);
        }
        if state
            .latest
            .as_ref()
            .is_some_and(|frame| received_at < frame.received_at)
        {
            return Err(FrameError::InvalidTimestamp);
        }
        state.latest = Some(Arc::new(Frame {
            generation,
            sequence,
            spec: self.spec,
            pixels: pixels.into(),
            received_at,
        }));
        state.sequence = sequence;
        Ok(())
    }
    fn terminate(&self, generation: u64, status: FrameStatus) -> Result<(), FrameError> {
        let mut state = self.state();
        if generation != state.generation {
            return Err(FrameError::StaleGeneration);
        }
        // A demuxer may reach EOF before the supervisor sees its failing exit.
        // Failure can refine EOF; a later EOF must never hide a known failure.
        if state.terminal.is_none() || status == FrameStatus::Failed {
            state.terminal = Some(status);
            state.latest = None;
        }
        Ok(())
    }
    pub fn mark_ended(&self, generation: u64) -> Result<(), FrameError> {
        self.terminate(generation, FrameStatus::Ended)
    }
    pub fn mark_failed(&self, generation: u64) -> Result<(), FrameError> {
        self.terminate(generation, FrameStatus::Failed)
    }
    pub fn snapshot(&self, now: Instant, stall_timeout: Duration) -> FrameView {
        let state = self.state();
        if let Some(status) = state.terminal {
            return FrameView::Slate(status);
        }
        match &state.latest {
            Some(frame)
                if now
                    .checked_duration_since(frame.received_at)
                    .is_some_and(|age| age < stall_timeout) =>
            {
                FrameView::Ready(frame.clone())
            }
            Some(_) => FrameView::Slate(FrameStatus::Stalled),
            None => FrameView::Slate(FrameStatus::Starting),
        }
    }
}

/// Paint imported pixel rectangles in z order. Missing/stalled slots are opaque
/// black slates, including an inset over a moving PiP base. Sources are aspect-fit
/// with nearest sampling; no layout decisions or decoder restarts occur here.
pub fn compose_into(
    geometry: &ValidatedGeometry,
    frames: &[(u8, FrameView)],
    canvas: &mut Vec<u8>,
) -> Result<(), FrameError> {
    let output = geometry.canvas();
    let mut seen = [false; 9];
    for (slot, view) in frames {
        if usize::from(*slot) >= seen.len()
            || seen[usize::from(*slot)]
            || !geometry.rects().iter().any(|rect| rect.slot_id == *slot)
        {
            return Err(FrameError::InvalidSlot);
        }
        seen[usize::from(*slot)] = true;
        if let FrameView::Ready(frame) = view {
            if frame.pixels.len() != byte_len(frame.spec)? {
                return Err(FrameError::InvalidLength);
            }
        }
    }
    let length = byte_len(FrameSpec {
        width: output.width,
        height: output.height,
    })?;
    canvas.resize(length, 0);
    canvas.fill(0);
    let stride = output.width as usize * 3;
    for rect in geometry.rects() {
        for y in rect.y..rect.y + rect.height {
            let start = y as usize * stride + rect.x as usize * 3;
            canvas[start..start + rect.width as usize * 3].fill(0);
        }
        let Some((_, FrameView::Ready(frame))) =
            frames.iter().find(|(slot, _)| *slot == rect.slot_id)
        else {
            continue;
        };
        let (width, height) = if u64::from(frame.spec.width) * u64::from(rect.height)
            >= u64::from(frame.spec.height) * u64::from(rect.width)
        {
            (
                rect.width,
                (u64::from(frame.spec.height) * u64::from(rect.width) / u64::from(frame.spec.width))
                    .max(1) as u32,
            )
        } else {
            (
                (u64::from(frame.spec.width) * u64::from(rect.height)
                    / u64::from(frame.spec.height))
                .max(1) as u32,
                rect.height,
            )
        };
        let x0 = rect.x + (rect.width - width) / 2;
        let y0 = rect.y + (rect.height - height) / 2;
        for y in 0..height {
            let sy = u64::from(y) * u64::from(frame.spec.height) / u64::from(height);
            for x in 0..width {
                let sx = u64::from(x) * u64::from(frame.spec.width) / u64::from(width);
                let source = (sy as usize * frame.spec.width as usize + sx as usize) * 3;
                let target = (y0 + y) as usize * stride + (x0 + x) as usize * 3;
                canvas[target..target + 3].copy_from_slice(&frame.pixels[source..source + 3]);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::geometry::{CanvasSpec, ImportedRect, OverlapPolicy};
    use super::*;
    fn mailbox() -> LatestFrame {
        LatestFrame::new(
            FrameSpec {
                width: 2,
                height: 2,
            },
            1,
        )
        .unwrap()
    }
    #[test]
    fn latest_frame_is_bounded_and_old_generation_cannot_resurrect_after_replace() {
        let mailbox = mailbox();
        let now = Instant::now();
        let pixels = vec![1; 12];
        mailbox.publish(1, 1, pixels, now).unwrap();
        let old = match mailbox.snapshot(now, Duration::from_secs(1)) {
            FrameView::Ready(frame) => {
                assert_eq!((frame.generation, frame.sequence), (1, 1));
                Arc::downgrade(&frame)
            }
            _ => panic!(),
        };
        mailbox.publish(1, 2, vec![2; 12], now).unwrap();
        assert!(old.upgrade().is_none());
        assert_eq!(mailbox.sequence(), 2);
        assert_eq!(mailbox.advance(0, 2), Err(FrameError::StaleGeneration));
        mailbox.advance(1, 2).unwrap();
        assert_eq!(mailbox.generation(), 2);
        assert_eq!(mailbox.sequence(), 0);
        assert_eq!(
            mailbox.publish(1, 3, vec![3; 12], now),
            Err(FrameError::StaleGeneration)
        );
        assert_eq!(mailbox.mark_ended(1), Err(FrameError::StaleGeneration));
        assert!(matches!(
            mailbox.snapshot(now, Duration::from_secs(1)),
            FrameView::Slate(FrameStatus::Starting)
        ));
        mailbox.publish(2, 1, vec![4; 12], now).unwrap();
        assert_eq!(
            mailbox.publish(2, 1, vec![4; 12], now),
            Err(FrameError::StaleSequence)
        );
    }
    #[test]
    fn stale_eos_and_failed_sources_show_slates_not_last_frozen_frame() {
        let mailbox = mailbox();
        let now = Instant::now();
        mailbox.publish(1, 1, vec![1; 12], now).unwrap();
        assert!(matches!(
            mailbox.snapshot(now + Duration::from_secs(2), Duration::from_secs(1)),
            FrameView::Slate(FrameStatus::Stalled)
        ));
        mailbox.mark_ended(1).unwrap();
        assert!(matches!(
            mailbox.snapshot(now, Duration::from_secs(1)),
            FrameView::Slate(FrameStatus::Ended)
        ));
        assert_eq!(
            mailbox.publish(1, 2, vec![2; 12], now),
            Err(FrameError::Terminal)
        );
        mailbox.mark_failed(1).unwrap();
        mailbox.mark_ended(1).unwrap();
        assert!(matches!(
            mailbox.snapshot(now, Duration::from_secs(1)),
            FrameView::Slate(FrameStatus::Failed)
        ));
        mailbox.advance(1, 2).unwrap();
        mailbox.mark_failed(2).unwrap();
        assert!(matches!(
            mailbox.snapshot(now, Duration::from_secs(1)),
            FrameView::Slate(FrameStatus::Failed)
        ));
        assert_eq!(
            mailbox.publish(2, 1, vec![1; 11], now),
            Err(FrameError::InvalidLength)
        );
        assert_eq!(mailbox.advance(2, 2), Err(FrameError::InvalidGeneration));
    }
    #[test]
    fn pip_slates_cover_main_and_replacing_inset_does_not_touch_main_frames() {
        let scene = ValidatedGeometry::new(
            CanvasSpec {
                width: 4,
                height: 4,
                fps: 10,
            },
            7,
            &[
                ImportedRect {
                    slot_id: 0,
                    x: 0,
                    y: 0,
                    width: 4,
                    height: 4,
                    z: 0,
                },
                ImportedRect {
                    slot_id: 1,
                    x: 2,
                    y: 2,
                    width: 2,
                    height: 2,
                    z: 1,
                },
            ],
            OverlapPolicy::Pip,
        )
        .unwrap();
        let main = mailbox();
        let inset = mailbox();
        let now = Instant::now();
        main.publish(1, 1, [255, 0, 0].repeat(4), now).unwrap();
        inset.publish(1, 1, [0, 255, 0].repeat(4), now).unwrap();
        let views = || {
            vec![
                (0, main.snapshot(now, Duration::from_secs(1))),
                (1, inset.snapshot(now, Duration::from_secs(1))),
            ]
        };
        let mut canvas = Vec::new();
        compose_into(&scene, &views(), &mut canvas).unwrap();
        assert_eq!(&canvas[0..3], &[255, 0, 0]);
        assert_eq!(&canvas[30..33], &[0, 255, 0]);
        inset.advance(1, 2).unwrap();
        compose_into(&scene, &views(), &mut canvas).unwrap();
        assert_eq!(&canvas[0..3], &[255, 0, 0]);
        assert_eq!(&canvas[30..33], &[0, 0, 0]);
        assert_eq!(main.generation(), 1);
        assert_eq!(main.sequence(), 1);
    }
    #[test]
    fn compose_validates_inputs_and_letterboxes_without_changing_geometry() {
        let scene = ValidatedGeometry::new(
            CanvasSpec {
                width: 4,
                height: 4,
                fps: 10,
            },
            0,
            &[ImportedRect {
                slot_id: 0,
                x: 0,
                y: 0,
                width: 4,
                height: 4,
                z: 0,
            }],
            OverlapPolicy::Disjoint,
        )
        .unwrap();
        let mailbox = LatestFrame::new(
            FrameSpec {
                width: 4,
                height: 2,
            },
            1,
        )
        .unwrap();
        let now = Instant::now();
        mailbox.publish(1, 1, [1, 2, 3].repeat(8), now).unwrap();
        let view = mailbox.snapshot(now, Duration::from_secs(1));
        let mut canvas = Vec::new();
        compose_into(&scene, &[(0, view.clone())], &mut canvas).unwrap();
        assert_eq!(&canvas[..12], &[0; 12]);
        assert_eq!(&canvas[12..15], &[1, 2, 3]);
        assert_eq!(&canvas[36..], &[0; 12]);
        assert_eq!(
            compose_into(&scene, &[(0, view.clone()), (0, view)], &mut canvas),
            Err(FrameError::InvalidSlot)
        );
        compose_into(&scene, &[], &mut canvas).unwrap();
        assert!(canvas.iter().all(|byte| *byte == 0));
    }
}

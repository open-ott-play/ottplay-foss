//! Validates native-authoritative pixel geometry. No layout or rounding algorithm.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CanvasSpec {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ImportedRect {
    pub slot_id: u8,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub z: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlapPolicy {
    Disjoint,
    Pip,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeometryError {
    InvalidCanvas,
    InvalidCount,
    InvalidSlot,
    DuplicateLayer,
    InvalidRect,
    Overlap,
    InvalidPip,
}

#[derive(Clone, Debug)]
pub struct ValidatedGeometry {
    canvas: CanvasSpec,
    revision: u64,
    rects: Vec<ImportedRect>,
}

impl ValidatedGeometry {
    pub fn new(
        canvas: CanvasSpec,
        revision: u64,
        rects: &[ImportedRect],
        overlap: OverlapPolicy,
    ) -> Result<Self, GeometryError> {
        if canvas.width == 0
            || canvas.height == 0
            || canvas.width > 1920
            || canvas.height > 1080
            || canvas.fps == 0
            || canvas.fps > 30
            || canvas.width % 2 != 0
            || canvas.height % 2 != 0
        {
            return Err(GeometryError::InvalidCanvas);
        }
        if rects.is_empty() || rects.len() > 9 {
            return Err(GeometryError::InvalidCount);
        }
        let mut slots = [false; 9];
        let mut layers = [false; 256];
        for rect in rects {
            let slot = usize::from(rect.slot_id);
            if slot >= rects.len() || slots[slot] {
                return Err(GeometryError::InvalidSlot);
            }
            slots[slot] = true;
            if layers[usize::from(rect.z)] {
                return Err(GeometryError::DuplicateLayer);
            }
            layers[usize::from(rect.z)] = true;
            if rect.width == 0
                || rect.height == 0
                || (rect.x | rect.y | rect.width | rect.height) % 2 != 0
                || rect
                    .x
                    .checked_add(rect.width)
                    .is_none_or(|right| right > canvas.width)
                || rect
                    .y
                    .checked_add(rect.height)
                    .is_none_or(|bottom| bottom > canvas.height)
            {
                return Err(GeometryError::InvalidRect);
            }
        }
        match overlap {
            OverlapPolicy::Disjoint => {
                for (index, rect) in rects.iter().enumerate() {
                    for other in &rects[..index] {
                        if rect.x < other.x + other.width
                            && other.x < rect.x + rect.width
                            && rect.y < other.y + other.height
                            && other.y < rect.y + rect.height
                        {
                            return Err(GeometryError::Overlap);
                        }
                    }
                }
            }
            OverlapPolicy::Pip => {
                if rects.len() != 2 {
                    return Err(GeometryError::InvalidPip);
                }
                let base = rects.iter().find(|rect| rect.slot_id == 0).unwrap();
                let inset = rects.iter().find(|rect| rect.slot_id == 1).unwrap();
                if base.x != 0
                    || base.y != 0
                    || base.width != canvas.width
                    || base.height != canvas.height
                    || inset.z <= base.z
                    || (inset.width == base.width && inset.height == base.height)
                {
                    return Err(GeometryError::InvalidPip);
                }
            }
        }
        let mut rects = rects.to_vec();
        rects.sort_unstable_by_key(|rect| rect.z);
        Ok(Self {
            canvas,
            revision,
            rects,
        })
    }
    pub fn canvas(&self) -> CanvasSpec {
        self.canvas
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    /// Native values are unchanged; only their paint ordering is canonicalized.
    pub fn rects(&self) -> &[ImportedRect] {
        &self.rects
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn canvas() -> CanvasSpec {
        CanvasSpec {
            width: 960,
            height: 540,
            fps: 10,
        }
    }
    fn rect(slot_id: u8, x: u32, width: u32) -> ImportedRect {
        ImportedRect {
            slot_id,
            x,
            y: 0,
            width,
            height: 540,
            z: slot_id,
        }
    }
    #[test]
    fn imported_pixels_and_revision_are_preserved_without_layout_reconstruction() {
        let mut first = rect(0, 4, 100);
        first.z = 7;
        let mut second = rect(1, 200, 302);
        second.z = 3;
        let scene = ValidatedGeometry::new(canvas(), 19, &[first, second], OverlapPolicy::Disjoint)
            .unwrap();
        assert_eq!(scene.canvas(), canvas());
        assert_eq!(scene.revision(), 19);
        assert_eq!(scene.rects(), &[second, first]);
    }
    #[test]
    fn rejects_bad_slots_edges_layers_overflow_and_unpermitted_overlap() {
        let rejected = |rows: &[ImportedRect]| {
            ValidatedGeometry::new(canvas(), 0, rows, OverlapPolicy::Disjoint).is_err()
        };
        assert!(rejected(&[]));
        assert!(rejected(&[rect(1, 0, 20)]));
        assert!(rejected(&[rect(0, 0, 100), rect(0, 200, 100)]));
        assert!(rejected(&[rect(0, 0, 300), rect(1, 200, 100)]));
        let mut bad = rect(0, 0, 20);
        bad.x = u32::MAX - 1;
        bad.width = 4;
        assert!(rejected(&[bad]));
        bad = rect(0, 0, 20);
        bad.x = 1;
        assert!(rejected(&[bad]));
        bad = rect(0, 0, 0);
        assert!(rejected(&[bad]));
        let mut second = rect(1, 200, 100);
        second.z = 0;
        assert!(rejected(&[rect(0, 0, 100), second]));
        let wrong = CanvasSpec {
            fps: 31,
            ..canvas()
        };
        assert!(
            ValidatedGeometry::new(wrong, 0, &[rect(0, 0, 100)], OverlapPolicy::Disjoint).is_err()
        );
    }
    #[test]
    fn only_explicit_two_slot_pip_can_overlap_and_inset_must_be_above_base() {
        let base = rect(0, 0, 960);
        let inset = ImportedRect {
            slot_id: 1,
            x: 700,
            y: 300,
            width: 200,
            height: 200,
            z: 1,
        };
        assert!(ValidatedGeometry::new(canvas(), 0, &[inset, base], OverlapPolicy::Pip).is_ok());
        assert!(
            ValidatedGeometry::new(canvas(), 0, &[inset, base], OverlapPolicy::Disjoint).is_err()
        );
        let inset = ImportedRect { z: 0, ..inset };
        let base = ImportedRect { z: 1, ..base };
        assert!(ValidatedGeometry::new(canvas(), 0, &[inset, base], OverlapPolicy::Pip).is_err());
    }
}

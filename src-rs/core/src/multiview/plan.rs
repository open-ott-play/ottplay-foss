//! Pure bounded FFmpeg composition planning; no source URLs or process effects.
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layout {
    Grid4,
    Grid9,
    MainWithPerimeter { main_slot: u8 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InputSpec {
    pub slot: u8,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutputSpec {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Clone, Debug)]
pub struct Limits {
    pub max_inputs: usize,
    pub max_input_width: u32,
    pub max_input_height: u32,
    pub max_input_fps: u32,
    /// Full decoded input pixels/second, before scaling each tile.
    pub max_input_pixel_rate: u64,
    pub max_output_width: u32,
    pub max_output_height: u32,
    pub max_output_fps: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_inputs: 9,
            max_input_width: 1920,
            max_input_height: 1080,
            max_input_fps: 30,
            max_input_pixel_rate: 9 * 1280 * 720 * 30,
            max_output_width: 1920,
            max_output_height: 1080,
            max_output_fps: 30,
        }
    }
}

#[derive(Debug)]
pub struct Plan {
    pub filter_graph: String,
    /// FFmpeg input indices follow this canonical slot order.
    pub input_slots: Vec<u8>,
    pub output: OutputSpec,
    pub audio_owner_input: Option<usize>,
    pub rects: Vec<Rect>,
    generated: GeneratedPlan,
}

#[derive(Debug)]
struct GeneratedPlan {
    filter_graph: String,
    input_slots: Vec<u8>,
    output: OutputSpec,
    audio_owner_input: Option<usize>,
    rects: Vec<Rect>,
}

impl Plan {
    /// Reject edits to public receipts before a worker uses the generated graph.
    pub fn validate(&self) -> Result<(), PlanError> {
        if self.filter_graph != self.generated.filter_graph
            || self.input_slots != self.generated.input_slots
            || self.output != self.generated.output
            || self.audio_owner_input != self.generated.audio_owner_input
            || self.rects != self.generated.rects
        {
            return Err(PlanError::InvalidPlan);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanError {
    InvalidPlan,
    InvalidInputCount,
    InvalidSlot,
    DuplicateSlot,
    InvalidInput,
    InputBudgetExceeded,
    InvalidOutput,
    MissingAudioOwner,
    ArithmeticOverflow,
}

impl fmt::Display for PlanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidPlan => "composition plan was modified",
            Self::InvalidInputCount => "unsupported composition input count",
            Self::InvalidSlot => "invalid composition slot",
            Self::DuplicateSlot => "duplicate composition slot",
            Self::InvalidInput => "unsupported composition input dimensions or rate",
            Self::InputBudgetExceeded => "composition decode budget exceeded",
            Self::InvalidOutput => "unsupported composition output",
            Self::MissingAudioOwner => "composition audio owner is absent",
            Self::ArithmeticOverflow => "composition arithmetic overflow",
        })
    }
}
impl std::error::Error for PlanError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub slot: u8,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

fn even(value: u32) -> u32 {
    value & !1
}

fn rectangles(layout: Layout, count: usize, output: OutputSpec) -> Vec<Rect> {
    let mut result = Vec::with_capacity(count);
    match layout {
        Layout::Grid4 | Layout::Grid9 => {
            let side = if count == 4 { 2 } else { 3 };
            let width = even(output.width / side);
            let height = even(output.height / side);
            for slot in 0..count as u32 {
                result.push(Rect {
                    slot: slot as u8,
                    x: slot % side * width,
                    y: slot / side * height,
                    width,
                    height,
                });
            }
        }
        Layout::MainWithPerimeter { main_slot } => {
            let columns = if count == 4 { 3 } else { 5 };
            let rows = if count == 4 { 3 } else { 4 };
            let width = even(output.width / columns);
            let height = even(output.height / rows);
            let main_width = width * (columns - 1);
            let main_height = if count == 4 {
                height * rows
            } else {
                height * (rows - 1)
            };
            let mut small = Vec::with_capacity(count - 1);
            for row in 0..rows {
                small.push(Rect {
                    slot: 0,
                    x: main_width,
                    y: row * height,
                    width,
                    height,
                });
            }
            if count == 9 {
                for column in 0..columns - 1 {
                    small.push(Rect {
                        slot: 0,
                        x: column * width,
                        y: main_height,
                        width,
                        height,
                    });
                }
            }
            let mut next = small.into_iter();
            for slot in 0..count {
                let mut rect = if slot == usize::from(main_slot) {
                    Rect {
                        slot: slot as u8,
                        x: 0,
                        y: 0,
                        width: main_width,
                        height: main_height,
                    }
                } else {
                    // Counts are fixed above: exactly count - 1 perimeter cells.
                    next.next().expect("fixed perimeter geometry")
                };
                rect.slot = slot as u8;
                result.push(rect);
            }
        }
    }
    result
}

pub fn build(
    layout: Layout,
    inputs: &[InputSpec],
    output: OutputSpec,
    audio_owner: Option<u8>,
    limits: &Limits,
) -> Result<Plan, PlanError> {
    let count = inputs.len();
    let expected = match layout {
        Layout::Grid4 => count == 4,
        Layout::Grid9 => count == 9,
        Layout::MainWithPerimeter { .. } => count == 4 || count == 9,
    };
    if !expected || count > limits.max_inputs || count > 9 {
        return Err(PlanError::InvalidInputCount);
    }
    if output.width < 16
        || output.height < 16
        || output.width % 2 != 0
        || output.height % 2 != 0
        || output.width > limits.max_output_width.min(1920)
        || output.height > limits.max_output_height.min(1080)
        || output.fps == 0
        || output.fps > limits.max_output_fps.min(30)
    {
        return Err(PlanError::InvalidOutput);
    }
    let mut sorted = inputs.to_vec();
    sorted.sort_unstable_by_key(|input| input.slot);
    let mut previous = None;
    let mut pixels = 0u64;
    for input in &sorted {
        if usize::from(input.slot) >= count {
            return Err(PlanError::InvalidSlot);
        }
        if previous == Some(input.slot) {
            return Err(PlanError::DuplicateSlot);
        }
        previous = Some(input.slot);
        if input.width == 0
            || input.height == 0
            || input.fps == 0
            || input.width > limits.max_input_width
            || input.height > limits.max_input_height
            || input.fps > limits.max_input_fps
        {
            return Err(PlanError::InvalidInput);
        }
        let rate = u64::from(input.width)
            .checked_mul(u64::from(input.height))
            .and_then(|p| p.checked_mul(u64::from(input.fps)))
            .ok_or(PlanError::ArithmeticOverflow)?;
        pixels = pixels
            .checked_add(rate)
            .ok_or(PlanError::ArithmeticOverflow)?;
    }
    if pixels > limits.max_input_pixel_rate {
        return Err(PlanError::InputBudgetExceeded);
    }
    if let Layout::MainWithPerimeter { main_slot } = layout {
        if usize::from(main_slot) >= count {
            return Err(PlanError::InvalidSlot);
        }
    }
    let audio_owner_input = audio_owner
        .map(|slot| {
            sorted
                .iter()
                .position(|input| input.slot == slot)
                .ok_or(PlanError::MissingAudioOwner)
        })
        .transpose()?;
    let rectangles = rectangles(layout, count, output);
    let mut filters = Vec::with_capacity(count * 2 + 2);
    for (index, rect) in rectangles.iter().enumerate() {
        filters.push(format!("[{index}:v:0]scale=w={}:h={}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=w={}:h={}:x=(ow-iw)/2:y=(oh-ih)/2:color=black,setsar=1,setpts=PTS-STARTPTS,fps={}[s{index}]", rect.width, rect.height, rect.width, rect.height, output.fps));
    }
    match layout {
        Layout::Grid4 | Layout::Grid9 => {
            let labels = (0..count).map(|i| format!("[s{i}]")).collect::<String>();
            let positions = rectangles
                .iter()
                .map(|r| format!("{}_{}", r.x, r.y))
                .collect::<Vec<_>>()
                .join("|");
            filters.push(format!(
                "{labels}xstack=inputs={count}:layout={positions}:fill=black:shortest=1[stack]"
            ));
            filters.push(format!(
                "[stack]pad={}:{}:0:0:color=black,format=yuv420p[vout]",
                output.width, output.height
            ));
        }
        Layout::MainWithPerimeter { main_slot } => {
            filters.push(format!(
                "[s{main_slot}]pad={}:{}:0:0:color=black[base0]",
                output.width, output.height
            ));
            let mut base = 0;
            for (index, rect) in rectangles.iter().enumerate() {
                if index == usize::from(main_slot) {
                    continue;
                }
                filters.push(format!(
                    "[base{base}][s{index}]overlay=x={}:y={}:shortest=1:eof_action=endall[base{}]",
                    rect.x,
                    rect.y,
                    base + 1
                ));
                base += 1;
            }
            filters.push(format!("[base{base}]format=yuv420p[vout]"));
        }
    }
    let filter_graph = filters.join(";");
    let input_slots = sorted.iter().map(|input| input.slot).collect::<Vec<_>>();
    let generated = GeneratedPlan {
        filter_graph: filter_graph.clone(),
        input_slots: input_slots.clone(),
        output,
        audio_owner_input,
        rects: rectangles.clone(),
    };
    Ok(Plan {
        filter_graph,
        input_slots,
        output,
        audio_owner_input,
        rects: rectangles,
        generated,
    })
}

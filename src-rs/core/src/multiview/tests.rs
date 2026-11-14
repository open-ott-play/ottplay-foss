//! Pure planner cases; also included by the isolated fixture test crate.
use super::plan::*;

fn inputs(count: u8) -> Vec<InputSpec> {
    (0..count)
        .map(|slot| InputSpec {
            slot,
            width: 320,
            height: 180,
            fps: 15,
        })
        .collect()
}
fn output() -> OutputSpec {
    OutputSpec {
        width: 1280,
        height: 720,
        fps: 15,
    }
}
fn error(
    layout: Layout,
    rows: &[InputSpec],
    out: OutputSpec,
    audio: Option<u8>,
    limits: &Limits,
) -> PlanError {
    build(layout, rows, out, audio, limits).unwrap_err()
}

#[test]
fn grids_have_real_independent_inputs_and_canonical_audio_index() {
    for (layout, count) in [(Layout::Grid4, 4), (Layout::Grid9, 9)] {
        let mut rows = inputs(count);
        rows.reverse();
        let plan = build(layout, &rows, output(), Some(2), &Limits::default()).unwrap();
        assert_eq!(plan.input_slots, (0..count).collect::<Vec<_>>());
        assert_eq!(plan.audio_owner_input, Some(2));
        assert_eq!(plan.output, output());
        assert!(plan
            .filter_graph
            .contains(&format!("xstack=inputs={count}:")));
        for slot in 0..count {
            assert!(plan.filter_graph.contains(&format!("[{slot}:v:0]scale=")));
        }
        assert!(plan.filter_graph.ends_with("format=yuv420p[vout]"));
        assert!(!plan.filter_graph.contains(":a:"));
    }
}

#[test]
fn main_layouts_have_one_main_and_every_other_input_overlaid() {
    for count in [4, 9] {
        for main_slot in 0..count {
            let plan = build(
                Layout::MainWithPerimeter { main_slot },
                &inputs(count),
                output(),
                None,
                &Limits::default(),
            )
            .unwrap();
            assert!(plan
                .filter_graph
                .contains(&format!("[s{main_slot}]pad=1280:720")));
            assert_eq!(
                plan.filter_graph.matches("overlay=x=").count(),
                usize::from(count - 1)
            );
            assert!(!plan.filter_graph.contains("xstack"));
            assert_eq!(plan.audio_owner_input, None);
        }
    }
}

#[test]
fn count_slots_audio_and_invalid_dimensions_fail_closed() {
    let limits = Limits::default();
    for count in [0, 1, 3, 5, 8, 10] {
        assert_eq!(
            error(Layout::Grid4, &inputs(count), output(), None, &limits),
            PlanError::InvalidInputCount
        );
    }
    assert_eq!(
        error(Layout::Grid9, &inputs(4), output(), None, &limits),
        PlanError::InvalidInputCount
    );
    assert_eq!(
        error(
            Layout::MainWithPerimeter { main_slot: 4 },
            &inputs(4),
            output(),
            None,
            &limits
        ),
        PlanError::InvalidSlot
    );
    assert_eq!(
        error(Layout::Grid4, &inputs(4), output(), Some(4), &limits),
        PlanError::MissingAudioOwner
    );
    let mut rows = inputs(4);
    rows[3].slot = 2;
    assert_eq!(
        error(Layout::Grid4, &rows, output(), None, &limits),
        PlanError::DuplicateSlot
    );
    rows[3].slot = 4;
    assert_eq!(
        error(Layout::Grid4, &rows, output(), None, &limits),
        PlanError::InvalidSlot
    );
    for value in [0, 1921] {
        let mut rows = inputs(4);
        rows[0].width = value;
        assert_eq!(
            error(Layout::Grid4, &rows, output(), None, &limits),
            PlanError::InvalidInput
        );
    }
    for out in [
        OutputSpec {
            width: 1279,
            ..output()
        },
        OutputSpec {
            height: 721,
            ..output()
        },
        OutputSpec { fps: 0, ..output() },
        OutputSpec {
            fps: 31,
            ..output()
        },
        OutputSpec {
            width: 1922,
            ..output()
        },
        OutputSpec {
            height: 1082,
            ..output()
        },
        OutputSpec {
            width: 2,
            ..output()
        },
    ] {
        assert_eq!(
            error(Layout::Grid4, &inputs(4), out, None, &limits),
            PlanError::InvalidOutput
        );
    }
}

#[test]
fn input_budgets_and_checked_arithmetic_are_enforced() {
    let limits = Limits {
        max_input_pixel_rate: 4 * 320 * 180 * 15 - 1,
        ..Limits::default()
    };
    assert_eq!(
        error(Layout::Grid4, &inputs(4), output(), None, &limits),
        PlanError::InputBudgetExceeded
    );
    let limits = Limits {
        max_inputs: 3,
        ..Limits::default()
    };
    assert_eq!(
        error(Layout::Grid4, &inputs(4), output(), None, &limits),
        PlanError::InvalidInputCount
    );
    let limits = Limits {
        max_input_width: u32::MAX,
        max_input_height: u32::MAX,
        max_input_fps: u32::MAX,
        max_input_pixel_rate: u64::MAX,
        ..Limits::default()
    };
    let rows = vec![
        InputSpec {
            slot: 0,
            width: u32::MAX,
            height: u32::MAX,
            fps: u32::MAX,
        },
        inputs(4)[1],
        inputs(4)[2],
        inputs(4)[3],
    ];
    assert_eq!(
        error(Layout::Grid4, &rows, output(), None, &limits),
        PlanError::ArithmeticOverflow
    );
    let permissive = Limits {
        max_output_width: u32::MAX,
        max_output_height: u32::MAX,
        max_output_fps: u32::MAX,
        ..Limits::default()
    };
    assert_eq!(
        error(
            Layout::Grid4,
            &inputs(4),
            OutputSpec {
                width: 3840,
                height: 2160,
                fps: 60
            },
            None,
            &permissive
        ),
        PlanError::InvalidOutput
    );
}

#[test]
fn generated_geometry_stays_even_inside_output_without_overlap() {
    // Check the numeric scale/pad and placement contract for awkward even outputs.
    for out in [
        output(),
        OutputSpec {
            width: 1918,
            height: 1078,
            fps: 30,
        },
        OutputSpec {
            width: 16,
            height: 16,
            fps: 1,
        },
    ] {
        for (layout, count) in [
            (Layout::Grid4, 4),
            (Layout::Grid9, 9),
            (Layout::MainWithPerimeter { main_slot: 0 }, 4),
            (Layout::MainWithPerimeter { main_slot: 8 }, 9),
        ] {
            let plan = build(layout, &inputs(count), out, None, &Limits::default()).unwrap();
            plan.validate().unwrap();
            assert!(!plan.filter_graph.contains("reset_sar"));
            assert!(!plan.filter_graph.contains("force_original_aspect_ratio"));
            let branches = plan.filter_graph.split(';').collect::<Vec<_>>();
            for (index, rect) in plan.rects.iter().enumerate() {
                assert_eq!(branches[index], format!(
                    "[{index}:v:0]scale=w='min({},max(2,round({}*dar/2)*2))':h='min({},max(2,round({}/dar/2)*2))',setsar=1,pad=w={}:h={}:x=(ow-iw)/2:y=(oh-ih)/2:color=black,setpts=PTS-STARTPTS,fps={}[s{index}]",
                    rect.width, rect.height, rect.height, rect.width,
                    rect.width, rect.height, out.fps,
                ));
            }
            assert!(!plan.filter_graph.contains("scale=w=0:"));
            assert!(!plan.filter_graph.contains(":h=0:"));
            for (index, rect) in plan.rects.iter().enumerate() {
                assert_eq!(usize::from(rect.slot), index);
                assert!(rect.width > 0 && rect.height > 0);
                assert_eq!((rect.x | rect.y | rect.width | rect.height) % 2, 0);
                assert!(rect.x + rect.width <= out.width && rect.y + rect.height <= out.height);
                for other in &plan.rects[..index] {
                    assert!(
                        rect.x + rect.width <= other.x
                            || other.x + other.width <= rect.x
                            || rect.y + rect.height <= other.y
                            || other.y + other.height <= rect.y
                    );
                }
            }
        }
    }
}

#[test]
fn workers_can_verify_generated_graph_and_geometry_receipts() {
    let original = || {
        build(
            Layout::Grid4,
            &inputs(4),
            output(),
            Some(1),
            &Limits::default(),
        )
        .unwrap()
    };
    assert!(original().validate().is_ok());
    let mut plan = original();
    plan.filter_graph.push_str(";movie=/private/source");
    assert_eq!(plan.validate(), Err(PlanError::InvalidPlan));
    let mut plan = original();
    plan.input_slots.reverse();
    assert_eq!(plan.validate(), Err(PlanError::InvalidPlan));
    let mut plan = original();
    plan.output.fps += 1;
    assert_eq!(plan.validate(), Err(PlanError::InvalidPlan));
    let mut plan = original();
    plan.audio_owner_input = None;
    assert_eq!(plan.validate(), Err(PlanError::InvalidPlan));
    let mut plan = original();
    plan.rects[0].x = 2;
    assert_eq!(plan.validate(), Err(PlanError::InvalidPlan));
}

#[test]
fn dar_fit_rounds_to_nearest_even_and_stays_inside_each_tile() {
    // Independent positive-rational oracle for nearest-even-pixel fitting.
    // These numeric checks plus the exact graph assertion above specify the
    // expression contract; executing FFmpeg on anamorphic media is separate.
    fn rational_fit(w: u32, h: u32, n: u64, d: u64) -> (u32, u32) {
        fn nearest_two(n: u128, d: u128) -> u32 {
            u32::try_from(2 * ((n + d) / (2 * d))).unwrap().max(2)
        }
        (
            w.min(nearest_two(u128::from(h) * u128::from(n), u128::from(d))),
            h.min(nearest_two(u128::from(w) * u128::from(d), u128::from(n))),
        )
    }
    for (coded_w, coded_h, sar_n, sar_d, expected) in [
        (1920, 1080, 1, 1, (240, 136)),
        (720, 576, 16, 15, (240, 180)),
        (720, 576, 64, 45, (240, 136)),
        (1440, 1080, 4, 3, (240, 136)),
        (1080, 1440, 3, 4, (102, 180)),
        (240, 135, 1, 1, (240, 136)),
        (1, 1, 1_000_000, 1, (240, 2)),
        (1, 1, 1, 1_000_000, (2, 180)),
    ] {
        let n = coded_w * sar_n;
        let d = coded_h * sar_d;
        assert_eq!(rational_fit(240, 180, n, d), expected);
        for (w, h) in [(240, 180), (638, 358), (2, 2), (16, 8)] {
            let dar = n as f64 / d as f64;
            let evaluated = (
                f64::from(w).min((f64::from(h) * dar / 2.0).round().max(1.0) * 2.0) as u32,
                f64::from(h).min((f64::from(w) / dar / 2.0).round().max(1.0) * 2.0) as u32,
            );
            assert_eq!(evaluated, rational_fit(w, h, n, d));
            assert!(evaluated.0 >= 2 && evaluated.0 <= w);
            assert!(evaluated.1 >= 2 && evaluated.1 <= h);
            assert_eq!((evaluated.0 | evaluated.1) % 2, 0);
        }
    }
}

#[test]
fn dar_graph_keeps_coded_decode_budget_and_seal() {
    let rows = (0..4)
        .map(|slot| InputSpec {
            slot,
            width: 1440,
            height: 1080,
            fps: 15,
        })
        .collect::<Vec<_>>();
    let budget = 4 * 1440 * 1080 * 15;
    let mut limits = Limits {
        max_input_pixel_rate: budget,
        ..Limits::default()
    };
    let mut plan = build(Layout::Grid4, &rows, output(), Some(2), &limits).unwrap();
    assert_eq!(plan.input_slots, vec![0, 1, 2, 3]);
    assert_eq!(plan.audio_owner_input, Some(2));
    plan.validate().unwrap();
    limits.max_input_pixel_rate = budget - 1;
    assert_eq!(
        error(Layout::Grid4, &rows, output(), Some(2), &limits),
        PlanError::InputBudgetExceeded
    );
    plan.filter_graph = plan.filter_graph.replace("*dar/2", "*a/2");
    assert_eq!(plan.validate(), Err(PlanError::InvalidPlan));
}

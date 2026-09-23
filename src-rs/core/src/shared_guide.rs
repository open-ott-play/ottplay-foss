//! VM/type boundary only. All guide rules are compiled from the shared Kotlin core.
//! QuickJS has no network, filesystem, modules or application callbacks installed.
use rquickjs::function::{Constructor, This};
use rquickjs::{Context, Ctx, FromJs, Function, Object, Runtime};
use std::cell::RefCell;

const CORE: &str = include_str!("../../../vendor/ottplay-core.js");

#[derive(Clone)]
pub struct GuideIndex(Context);

/// Batched XML events cross the VM boundary; the shared core owns record state.
pub struct GuideRecords(Context);

/// The host executes effects; the shared core owns refresh transitions and channel ownership.
pub struct GuideRefresh(Context);

fn context() -> anyhow::Result<Context> {
    let runtime = Runtime::new()?;
    runtime.set_max_stack_size(1024 * 1024);
    let context = Context::full(&runtime)?;
    checked(&context, |ctx| ctx.eval::<(), _>(CORE))?;
    Ok(context)
}

fn checked<T>(
    context: &Context,
    action: impl for<'js> FnOnce(Ctx<'js>) -> rquickjs::Result<T>,
) -> anyhow::Result<T> {
    context.with(|ctx| {
        action(ctx.clone()).map_err(|error| {
            // Never log exception text containing provider names, URLs or credentials.
            if error.is_exception() {
                let _ = ctx.catch();
            }
            anyhow::anyhow!("Shared guide runtime: {error}")
        })
    })
}

thread_local! { static SCALAR: RefCell<Option<Context>> = const { RefCell::new(None) }; }

fn scalar<T>(action: impl for<'js> FnOnce(Ctx<'js>) -> rquickjs::Result<T>) -> anyhow::Result<T> {
    SCALAR.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_none() {
            *slot = Some(context()?);
        }
        checked(slot.as_ref().expect("initialized above"), action)
    })
}

fn core<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    ctx.globals().get("OttPlayCore")
}

pub fn text<T: for<'js> FromJs<'js>>(method: &str, value: &str) -> anyhow::Result<T> {
    scalar(|ctx| {
        core(&ctx)?
            .get::<_, Function>(method)?
            .call((value, "rust"))
    })
}

pub fn unowned(existing: Vec<String>, incoming: Vec<String>) -> anyhow::Result<Vec<String>> {
    scalar(|ctx| {
        core(&ctx)?
            .get::<_, Function>("nativeGuideUnowned")?
            .call((existing, incoming))
    })
}

pub fn source_fresh(age: u64) -> anyhow::Result<bool> {
    // Saturating clock subtraction is supplied by Rust. Every age near the TTL is exact in JS.
    scalar(|ctx| {
        core(&ctx)?
            .get::<_, Function>("nativeGuideFresh")?
            .call((age as f64,))
    })
}

pub fn source_refresh(failed: bool, empty: bool, stale: bool) -> anyhow::Result<String> {
    scalar(|ctx| {
        core(&ctx)?
            .get::<_, Function>("nativeGuideRefresh")?
            .call((failed, empty, stale))
    })
}

pub fn evict_source_set(count: usize, existing: bool) -> anyhow::Result<bool> {
    scalar(|ctx| {
        core(&ctx)?
            .get::<_, Function>("nativeGuideEvictSourceSet")?
            .call((count as i32, existing))
    })
}

pub fn refresh_interval() -> anyhow::Result<u64> {
    scalar(|ctx| {
        core(&ctx)?
            .get::<_, Function>("nativeGuideRefreshInterval")?
            .call(("rust-server",))
    })
}

impl GuideRefresh {
    pub fn new(count: usize) -> anyhow::Result<Self> {
        let context = context()?;
        checked(&context, |ctx| {
            let constructor: Constructor = core(&ctx)?.get("NativeGuideRefresh")?;
            let refresh: Object = constructor.construct((count as f64, "rust-server"))?;
            ctx.globals().set("guideRefresh", refresh)
        })?;
        Ok(Self(context))
    }

    pub fn action(&self) -> anyhow::Result<String> {
        checked(&self.0, |ctx| {
            let refresh: Object = ctx.globals().get("guideRefresh")?;
            let method: Function = refresh.get("action")?;
            method.call((This(refresh),))
        })
    }

    pub fn index(&self) -> anyhow::Result<usize> {
        checked(&self.0, |ctx| {
            let refresh: Object = ctx.globals().get("guideRefresh")?;
            let method: Function = refresh.get("index")?;
            method.call((This(refresh),))
        })
    }

    pub fn advance(&self, succeeded: bool, available: bool) -> anyhow::Result<()> {
        checked(&self.0, |ctx| {
            let refresh: Object = ctx.globals().get("guideRefresh")?;
            let method: Function = refresh.get("advance")?;
            method.call((This(refresh), succeeded, available))
        })
    }

    pub fn unowned(&self, incoming: Vec<String>) -> anyhow::Result<Vec<String>> {
        checked(&self.0, |ctx| {
            let refresh: Object = ctx.globals().get("guideRefresh")?;
            let method: Function = refresh.get("unowned")?;
            method.call((This(refresh), incoming))
        })
    }
}

impl GuideIndex {
    pub fn new(rows: Vec<Vec<String>>) -> anyhow::Result<Self> {
        let context = context()?;
        checked(&context, |ctx| {
            let measure = Function::new(ctx.clone(), |value: String| value.len() as i32)?;
            let precision = ctx.eval::<Function, _>("Math.fround")?;
            let constructor: Constructor = core(&ctx)?.get("NativeGuide")?;
            let index: Object = constructor.construct((rows, "rust", measure, precision))?;
            ctx.globals().set("guideIndex", index)
        })?;
        Ok(Self(context))
    }

    pub fn match_name(&self, name: &str) -> anyhow::Result<Option<(String, f32)>> {
        checked(&self.0, |ctx| {
            let index: Object = ctx.globals().get("guideIndex")?;
            let method: Function = index.get("match")?;
            let found: Option<Object> = method.call((This(index), name))?;
            found
                .map(|row| Ok((row.get("id")?, row.get("score")?)))
                .transpose()
        })
    }

    pub fn resolve(&self, id: &str, names: &[&str]) -> anyhow::Result<Option<String>> {
        checked(&self.0, |ctx| {
            let index: Object = ctx.globals().get("guideIndex")?;
            let method: Function = index.get("resolve")?;
            method.call((This(index), id, names.to_vec()))
        })
    }
}

impl GuideRecords {
    pub fn new(native: bool) -> anyhow::Result<Self> {
        let context = context()?;
        checked(&context, |ctx| {
            let trim = Function::new(ctx.clone(), |value: String| value.trim().to_owned())?;
            let identity = Function::new(ctx.clone(), |value: String| value)?;
            let constructor: Constructor = core(&ctx)?.get("XmltvRecords")?;
            let records: Object = constructor.construct((
                if native { "rust-native" } else { "rust" },
                trim,
                identity,
            ))?;
            ctx.globals().set("guideRecords", records)
        })?;
        Ok(Self(context))
    }

    pub fn accept(&self, rows: Vec<Vec<String>>) -> anyhow::Result<Vec<Vec<String>>> {
        checked(&self.0, |ctx| {
            let records: Object = ctx.globals().get("guideRecords")?;
            let method: Function = records.get("accept")?;
            method.call((This(records), rows))
        })
    }

    pub fn order(&self, starts: Vec<f64>) -> anyhow::Result<Vec<usize>> {
        checked(&self.0, |ctx| {
            core(&ctx)?
                .get::<_, Function>("nativeXmltvOrder")?
                .call((starts, "rust-native"))
        })
    }
}

pub fn slice(
    times: Vec<Vec<f64>>,
    now: i64,
    archive: i64,
    shift: i64,
) -> anyhow::Result<Vec<Vec<f64>>> {
    scalar(|ctx| {
        core(&ctx)?.get::<_, Function>("nativeGuideSlice")?.call((
            times,
            now as f64,
            archive as f64,
            shift as f64,
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloned_indexes_can_cross_worker_threads() -> anyhow::Result<()> {
        let index = GuideIndex::new(vec![vec!["id".into(), "News".into()]])?;
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let index = index.clone();
                scope.spawn(move || {
                    for _ in 0..20 {
                        assert_eq!(
                            index.match_name("News HD").unwrap(),
                            Some(("id".into(), 1.0))
                        );
                    }
                });
            }
        });
        Ok(())
    }

    #[test]
    fn exceptions_are_errors_without_disclosing_input_and_context_recovers() -> anyhow::Result<()> {
        let context = context()?;
        let error = checked(&context, |ctx| {
            ctx.eval::<(), _>("throw new Error('provider-secret')")
        })
        .unwrap_err();
        assert!(!error.to_string().contains("provider-secret"));
        assert_eq!(checked(&context, |ctx| ctx.eval::<i32, _>("1 + 1"))?, 2);
        Ok(())
    }

    #[test]
    fn utf8_float_precision_and_unicode_shifts_cross_the_real_bridge() -> anyhow::Result<()> {
        let index = GuideIndex::new(vec![
            vec!["first".into(), "яa".into()],
            vec!["second".into(), "abc".into()],
        ])?;
        assert_eq!(index.match_name("яabc")?, Some(("first".into(), 0.6_f32)));
        assert_eq!(text::<String>("nativeGuideName", "First +𝟜h HD")?, "first");
        assert_eq!(text::<i32>("nativeGuideShift", "First +𝟜h")?, 0);
        Ok(())
    }
}

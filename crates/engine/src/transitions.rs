//! Native style-change timelines. Events, discrete transitions and nonnumeric types remain separate work.
use std::collections::{HashMap, HashSet};

use cssparser::{Parser, ParserInput};
use dom_query::{NodeId, NodeRef};
use lightningcss::{
    properties::PropertyId,
    traits::Parse,
    values::{
        easing::{EasingFunction, StepPosition},
        time::Time,
    },
};

use crate::{Error, Result, styles::Declarations};

const NAMES: [&str; 4] = [
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
];
const DEFAULTS: [&str; 4] = ["all", "0s", "ease", "0s"];
const MAX_BYTES: usize = 2 * 1024 * 1024;

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: transition {detail}"))
}
pub(crate) fn property(name: &str) -> bool {
    NAMES.contains(&name)
}
fn list(source: &str) -> Result<Vec<String>> {
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let values = parser
        .parse_comma_separated(|input| {
            let start = input.position();
            while input.next().is_ok() {}
            Ok::<_, cssparser::ParseError<'_, ()>>(input.slice_from(start).trim().to_owned())
        })
        .map_err(|_error| unsupported("control list"))?;
    if values.is_empty() || values.len() > 64 || values.iter().any(String::is_empty) {
        return Err(Error::Limit("transition control list"));
    }
    Ok(values)
}
fn time(source: &str) -> Result<f64> {
    let value = Time::parse_string(source).map_err(|_error| unsupported("time"))?;
    let value = f64::from(value.to_ms());
    if !value.is_finite() {
        return Err(unsupported("nonfinite time"));
    }
    Ok(value)
}

#[derive(Clone)]
pub(crate) struct Controls([Vec<String>; 4]);
impl Default for Controls {
    fn default() -> Self {
        Self(DEFAULTS.map(|value| vec![value.to_owned()]))
    }
}
impl Controls {
    pub(crate) fn compute(&self, declarations: &Declarations) -> Result<Self> {
        let mut result = Self::default();
        for (((output, parent), name), default) in
            result.0.iter_mut().zip(&self.0).zip(NAMES).zip(DEFAULTS)
        {
            let value = declarations.value(name).0;
            *output = match value.as_str() {
                "inherit" => parent.clone(),
                "" | "initial" | "unset" | "revert" => vec![default.to_owned()],
                _ => list(&value)?,
            };
        }
        for value in &result.0[1] {
            if time(value)? < 0.0 {
                return Err(unsupported("negative duration"));
            }
        }
        Ok(result)
    }
    pub(crate) fn value(&self, name: &str) -> Result<String> {
        if name == "transition" {
            let [property, duration, easing, delay] =
                NAMES.map(|name| self.value(name).and_then(|value| list(&value)));
            return Ok(shorthand(&[property?, duration?, easing?, delay?]).unwrap_or_default());
        }
        let index = NAMES
            .iter()
            .position(|candidate| *candidate == name)
            .ok_or_else(|| unsupported("computed property"))?;
        let values = self
            .0
            .get(index)
            .ok_or_else(|| unsupported("computed property"))?;
        if matches!(index, 1 | 3) {
            values
                .iter()
                .map(|value| {
                    Ok(format!(
                        "{}s",
                        Time::parse_string(value)
                            .map_err(|_error| unsupported("time"))?
                            .to_ms()
                            / 1000.0
                    ))
                })
                .collect::<Result<Vec<_>>>()
                .map(|values| values.join(", "))
        } else {
            Ok(values.join(", "))
        }
    }
    fn plan(&self, property: &str) -> Result<Option<Plan>> {
        let index = self.0[0].iter().rposition(|name| {
            name == "all"
                || name == property
                || PropertyId::from(name.as_str())
                    .longhands()
                    .is_some_and(|names| names.iter().any(|name| name.name() == property))
        });
        let Some(index) = index else {
            return Ok(None);
        };
        let duration = time(control(&self.0[1], index)?)?;
        let delay = time(control(&self.0[3], index)?)?;
        if duration + delay <= 0.0 {
            return Ok(None);
        }
        Ok(Some(Plan {
            duration,
            delay,
            easing: control(&self.0[2], index)?.to_owned(),
        }))
    }
}
fn control(values: &[String], index: usize) -> Result<&str> {
    index
        .checked_rem(values.len())
        .and_then(|index| values.get(index))
        .map(String::as_str)
        .ok_or_else(|| unsupported("control list"))
}

pub(crate) fn valid(property: &lightningcss::properties::Property<'_>) -> bool {
    use lightningcss::properties::Property;
    let duration = |value: &Time| value.to_ms().is_finite() && value.to_ms() >= 0.0;
    let delay = |value: &Time| value.to_ms().is_finite();
    let easing = |value: &EasingFunction| match value {
        EasingFunction::Steps { count, position } => {
            *count > 0 && (*position != StepPosition::JumpNone || *count > 1)
        }
        EasingFunction::CubicBezier { x1, y1, x2, y2 } => {
            [*x1, *y1, *x2, *y2].iter().all(|value| value.is_finite())
                && (0.0..=1.0).contains(x1)
                && (0.0..=1.0).contains(x2)
        }
        _ => true,
    };
    match property {
        Property::TransitionDuration(values, _) => values.iter().all(duration),
        Property::TransitionDelay(values, _) => values.iter().all(delay),
        Property::TransitionTimingFunction(values, _) => values.iter().all(easing),
        Property::Transition(values, _) => values.iter().all(|value| {
            !reserved(value.property.name())
                && (value.property.name() != "none" || values.len() == 1)
                && duration(&value.duration)
                && delay(&value.delay)
                && easing(&value.timing_function)
        }),
        _ => true,
    }
}

#[derive(Clone)]
struct Plan {
    duration: f64,
    delay: f64,
    easing: String,
}
#[derive(Clone)]
struct Tween {
    from: String,
    to: String,
    reverse: String,
    factor: f64,
    start: f64,
    plan: Plan,
}
fn ease(source: &str, progress: f64) -> Result<f64> {
    match EasingFunction::parse_string(source).map_err(|_error| unsupported("easing"))? {
        EasingFunction::Steps { count, position } => {
            let count = f64::from(count);
            let (offset, divisor) = match position {
                StepPosition::Start => (1.0, count),
                StepPosition::End => (0.0, count),
                StepPosition::JumpNone => (0.0, count - 1.0),
                StepPosition::JumpBoth => (1.0, count + 1.0),
            };
            if count <= 0.0 || divisor <= 0.0 {
                return Err(unsupported("step count"));
            }
            Ok(((progress * count).floor() + offset).clamp(0.0, divisor) / divisor)
        }
        _ => crate::animations::ease(source, progress),
    }
}
impl Tween {
    fn progress(&self, now: f64) -> Result<f64> {
        let elapsed = now - self.start - self.plan.delay;
        if elapsed < 0.0 {
            return Ok(0.0);
        }
        if self.plan.duration == 0.0 || elapsed >= self.plan.duration {
            return Ok(1.0);
        }
        ease(&self.plan.easing, elapsed / self.plan.duration)
    }
    fn done(&self, now: f64) -> bool {
        now >= self.start + self.plan.delay + self.plan.duration
    }
    fn value(&self, name: &str, now: f64) -> Result<String> {
        if self.done(now) {
            return Ok(self.to.clone());
        }
        crate::animations::interpolate(name, &self.from, &self.to, self.progress(now)?)
    }
    fn retarget(
        name: &str,
        before: &str,
        to: &str,
        plan: Plan,
        now: f64,
        old: Option<&Self>,
    ) -> Result<Self> {
        let mut next = Self {
            from: before.to_owned(),
            to: to.to_owned(),
            reverse: before.to_owned(),
            factor: 1.0,
            start: now,
            plan,
        };
        if let Some(old) = old {
            next.from = old.value(name, now)?;
            if to == old.reverse {
                next.factor = (old.progress(now)? * old.factor + 1.0 - old.factor)
                    .abs()
                    .clamp(0.0, 1.0);
                next.reverse.clone_from(&old.to);
                next.plan.duration *= next.factor;
                if next.plan.delay < 0.0 {
                    next.plan.delay *= next.factor;
                }
            }
        }
        // Validate interpolation at creation, before publishing any state changes.
        crate::animations::interpolate(name, &next.from, to, 0.5)?;
        Ok(next)
    }
}
#[derive(Clone)]
struct Snapshot {
    values: HashMap<String, String>,
    controls: Controls,
    tweens: HashMap<String, Tween>,
    bytes: usize,
}
#[derive(Default)]
pub(crate) struct State {
    nodes: HashMap<NodeId, Snapshot>,
    bytes: usize,
    active: usize,
}
impl State {
    pub(crate) fn active(&self) -> bool {
        self.active > 0
    }
    pub(crate) fn sample(
        &mut self,
        node: NodeRef<'_>,
        mut declarations: Declarations,
        now: f64,
    ) -> Result<Declarations> {
        let parent = node
            .parent()
            .and_then(|parent| self.nodes.get(&parent.id))
            .map(|parent| parent.controls.clone())
            .unwrap_or_default();
        let controls = parent.compute(&declarations)?;
        let values: HashMap<_, _> = declarations
            .layout_entries()
            .filter(|(name, _, _)| {
                !property(name) && !name.starts_with("animation-") && !name.starts_with("--")
            })
            .map(|(name, value, _)| (name.to_owned(), value.to_owned()))
            .collect();
        let bytes = values
            .iter()
            .map(|(name, value)| name.len().saturating_add(value.len()))
            .sum::<usize>()
            .saturating_add(controls.0.iter().flatten().map(String::len).sum::<usize>());
        let previous = self.nodes.get(&node.id);
        let retained = self
            .bytes
            .saturating_sub(previous.map_or(0, |previous| previous.bytes));
        if (previous.is_none() && self.nodes.len() >= 8192)
            || retained.saturating_add(bytes) > MAX_BYTES
        {
            return Err(Error::Limit("transition snapshots"));
        }
        let mut tweens = previous.map_or_else(HashMap::new, |previous| previous.tweens.clone());
        if values.get("display").is_some_and(|value| value == "none") {
            tweens.clear();
        } else if let Some(previous) = previous {
            update(&previous.values, &values, &controls, &mut tweens, now)?;
        }
        for (name, tween) in &tweens {
            declarations.transition_value(name, &tween.value(name, now)?)?;
        }
        tweens.retain(|_, tween| !tween.done(now));
        self.active = self
            .active
            .saturating_sub(previous.map_or(0, |previous| previous.tweens.len()))
            .saturating_add(tweens.len());
        self.nodes.insert(
            node.id,
            Snapshot {
                values,
                controls,
                tweens,
                bytes,
            },
        );
        self.bytes = retained.saturating_add(bytes);
        Ok(declarations)
    }
}
fn initial(name: &str) -> &'static str {
    match name {
        "opacity" | "flex-shrink" => "1",
        "width" | "height" | "min-width" | "min-height" | "max-width" | "max-height" | "left"
        | "right" | "top" | "bottom" | "flex-basis" => "auto",
        "row-gap" | "column-gap" => "normal",
        _ => "0",
    }
}
fn numeric(name: &str) -> bool {
    matches!(
        name,
        "width"
            | "height"
            | "min-width"
            | "min-height"
            | "max-width"
            | "max-height"
            | "margin-top"
            | "margin-bottom"
            | "margin-left"
            | "margin-right"
            | "padding-top"
            | "padding-bottom"
            | "padding-left"
            | "padding-right"
            | "left"
            | "right"
            | "top"
            | "bottom"
            | "row-gap"
            | "column-gap"
            | "flex-basis"
            | "flex-grow"
            | "flex-shrink"
            | "opacity"
    )
}
fn update(
    before: &HashMap<String, String>,
    after: &HashMap<String, String>,
    controls: &Controls,
    tweens: &mut HashMap<String, Tween>,
    now: f64,
) -> Result<()> {
    let names: HashSet<_> = before
        .keys()
        .chain(after.keys())
        .chain(tweens.keys())
        .cloned()
        .collect();
    for name in names {
        let plan = controls.plan(&name)?;
        if plan.is_none() {
            tweens.remove(&name);
            continue;
        }
        let old = before.get(&name).map_or(initial(&name), String::as_str);
        let new = after.get(&name).map_or(initial(&name), String::as_str);
        if old == new {
            continue;
        }
        if !numeric(&name) {
            // Discrete types do not transition under Level 1. Other interpolable types are pending.
            if matches!(
                name.as_str(),
                "display" | "position" | "visibility" | "overflow-x" | "overflow-y"
            ) {
                continue;
            }
            return Err(unsupported(&format!("interpolation: {name}")));
        }
        if matches!(old, "auto" | "normal" | "none") || matches!(new, "auto" | "normal" | "none") {
            tweens.remove(&name);
            continue;
        }
        if let Some(plan) = plan {
            let tween = Tween::retarget(
                &name,
                old,
                new,
                plan,
                now,
                tweens.get(&name).filter(|tween| !tween.done(now)),
            )?;
            tweens.insert(name, tween);
        }
    }
    Ok(())
}

pub(crate) fn specified(name: &str, source: &str) -> Option<String> {
    let values = list(source).ok()?;
    let values: Option<Vec<_>> = values
        .iter()
        .map(|value| match name {
            "transition-duration" | "transition-delay" => {
                let time = Time::parse_string(value).ok()?;
                if !time.to_ms().is_finite()
                    || (name == "transition-duration" && time.to_ms() < 0.0)
                {
                    return None;
                }
                Some(match time {
                    Time::Seconds(value) => format!("{value}s"),
                    Time::Milliseconds(value) => format!("{value}ms"),
                })
            }
            "transition-timing-function" => specified_easing(value),
            "transition-property" => {
                let mut input = ParserInput::new(value);
                let mut parser = Parser::new(&mut input);
                let name = parser.expect_ident().ok()?.to_string();
                parser.expect_exhausted().ok()?;
                if reserved(&name) || (name.eq_ignore_ascii_case("none") && values.len() != 1) {
                    return None;
                }
                let name = if name.eq_ignore_ascii_case("all") || name.eq_ignore_ascii_case("none")
                {
                    name.to_ascii_lowercase()
                } else {
                    name
                };
                let mut output = String::new();
                cssparser::serialize_identifier(&name, &mut output).ok()?;
                Some(output)
            }
            _ => None,
        })
        .collect();
    Some(values?.join(", "))
}
fn reserved(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "initial" | "inherit" | "unset" | "revert" | "revert-layer" | "default"
    )
}
fn specified_easing(source: &str) -> Option<String> {
    use lightningcss::{properties::Property, vendor_prefix::VendorPrefix};
    let value = EasingFunction::parse_string(source).ok()?;
    if !valid(&Property::TransitionTimingFunction(
        vec![value.clone()].into(),
        VendorPrefix::None,
    )) {
        return None;
    }
    Some(match value {
        EasingFunction::Linear => "linear".into(),
        EasingFunction::Ease => "ease".into(),
        EasingFunction::EaseIn => "ease-in".into(),
        EasingFunction::EaseOut => "ease-out".into(),
        EasingFunction::EaseInOut => "ease-in-out".into(),
        EasingFunction::CubicBezier { x1, y1, x2, y2 } => {
            format!("cubic-bezier({x1}, {y1}, {x2}, {y2})")
        }
        EasingFunction::Steps { count, position } => match position {
            StepPosition::End => format!("steps({count})"),
            StepPosition::Start => {
                let position = step_position(source).unwrap_or_else(|| "start".into());
                format!("steps({count}, {position})")
            }
            StepPosition::JumpNone => format!("steps({count}, jump-none)"),
            StepPosition::JumpBoth => format!("steps({count}, jump-both)"),
        },
    })
}
fn step_position(source: &str) -> Option<String> {
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    parser.expect_function_matching("steps").ok()?;
    parser
        .parse_nested_block(|parser| {
            parser.expect_integer()?;
            parser.expect_comma()?;
            Ok::<_, cssparser::ParseError<'_, ()>>(parser.expect_ident()?.to_ascii_lowercase())
        })
        .ok()
}
pub(crate) fn shorthand(values: &[Vec<String>; 4]) -> Option<String> {
    let [properties, durations, easings, delays] = values;
    if properties.len() != durations.len()
        || properties.len() != easings.len()
        || properties.len() != delays.len()
    {
        return None;
    }
    let rows = properties
        .iter()
        .zip(durations)
        .zip(easings)
        .zip(delays)
        .map(|(((property, duration), easing), delay)| {
            let mut parts = Vec::new();
            let has_duration = time(duration).is_ok_and(|value| value != 0.0);
            let has_delay = time(delay).is_ok_and(|value| value != 0.0);
            if property != "all" || (!has_duration && !has_delay && easing == "ease") {
                parts.push(property.clone());
            }
            if has_duration || has_delay {
                parts.push(duration.clone());
            }
            if easing != "ease" {
                parts.push(easing.clone());
            }
            if has_delay {
                parts.push(delay.clone());
            }
            parts.join(" ")
        })
        .collect::<Vec<_>>();
    Some(rows.join(", "))
}
pub(crate) fn specified_shorthand(declarations: &Declarations) -> Option<String> {
    let [property, duration, easing, delay] =
        NAMES.map(|name| list(&declarations.value(name).0).ok());
    shorthand(&[property?, duration?, easing?, delay?])
}

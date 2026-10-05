use std::collections::{BTreeSet, HashMap};

use cssparser::{Parser, ParserInput};
use lightningcss::{
    rules::{
        CssRule,
        keyframes::{KeyframeSelector, KeyframesName},
    },
    stylesheet::{ParserOptions, PrinterOptions, StyleSheet},
    traits::Parse,
    values::{easing::EasingFunction, time::Time},
};

use crate::{
    Error, Result,
    layout::Work,
    styles::{Declarations, Variables},
};

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: animation {detail}"))
}

struct Frame {
    offset: f64,
    declarations: Declarations,
}
struct Definition {
    layer: Vec<usize>,
    frames: Vec<Frame>,
    named_range: bool,
}
#[derive(Default)]
pub(crate) struct Definitions {
    entries: HashMap<String, Definition>,
    frames: usize,
}

pub(crate) fn name(source: &str) -> Result<String> {
    let value = KeyframesName::parse_string(source).map_err(|_error| unsupported("name"))?;
    Ok(match value {
        KeyframesName::Ident(value) => value.0.to_string(),
        KeyframesName::Custom(value) => value.to_string(),
    })
}

impl Definitions {
    pub(crate) fn register(
        &mut self,
        name_source: &str,
        body: &str,
        layer: &[usize],
    ) -> Result<()> {
        let source = format!("@keyframes {name_source}{{{body}}}");
        let sheet = StyleSheet::parse(&source, ParserOptions::default())
            .map_err(|_error| unsupported("keyframes syntax"))?;
        let Some(CssRule::Keyframes(rule)) = sheet.rules.0.first() else {
            return Err(unsupported("keyframes syntax"));
        };
        let mut frames = Vec::new();
        let mut named_range = false;
        for frame in &rule.keyframes {
            let mut source = String::new();
            // Important declarations have no effect in keyframe blocks.
            for property in &frame.declarations.declarations {
                source.push_str(
                    &property
                        .to_css_string(false, PrinterOptions::default())
                        .map_err(|_error| unsupported("keyframe declaration"))?,
                );
                source.push(';');
            }
            let declarations =
                Declarations::parse(&source).map_err(|message| Error::Dom(message.into()))?;
            for selector in &frame.selectors {
                let offset = match selector {
                    KeyframeSelector::From => 0.0,
                    KeyframeSelector::To => 1.0,
                    KeyframeSelector::Percentage(value) => f64::from(value.0),
                    KeyframeSelector::TimelineRangePercentage(_) => {
                        named_range = true;
                        continue;
                    }
                };
                if !(0.0..=1.0).contains(&offset) {
                    continue;
                }
                self.frames = self.frames.saturating_add(1);
                if self.frames > 1024 {
                    return Err(Error::Limit("animation keyframes"));
                }
                frames.push(Frame {
                    offset,
                    declarations: declarations.clone(),
                });
            }
        }
        frames.sort_by(|a, b| a.offset.total_cmp(&b.offset));
        let mut rank = layer.to_vec();
        rank.push(usize::MAX);
        let name = name(name_source)?;
        if self
            .entries
            .get(&name)
            .is_some_and(|previous| previous.layer > rank)
        {
            return Ok(());
        }
        if !self.entries.contains_key(&name) && self.entries.len() >= 1024 {
            return Err(Error::Limit("animation definitions"));
        }
        self.entries.insert(
            name,
            Definition {
                layer: rank,
                frames,
                named_range,
            },
        );
        Ok(())
    }

    pub(crate) fn sample(
        &self,
        declarations: &Declarations,
        variables: &Variables,
        registrations: &crate::registrations::Definitions,
        work: &mut Work<'_>,
    ) -> Result<Declarations> {
        let mut result = declarations.clone();
        let names = list(declarations, "animation-name", "none")?;
        for (index, source) in names.iter().enumerate() {
            if source.eq_ignore_ascii_case("none") {
                continue;
            }
            let name = name(source)?;
            let Some(definition) = self.entries.get(&name) else {
                continue;
            };
            work.charge()?;
            if definition.frames.is_empty() {
                continue;
            }
            if definition.named_range {
                return Err(unsupported("named timeline range"));
            }
            let control = |name, default| control(declarations, name, default, index);
            if control("animation-play-state", "running")? != "paused" {
                return Err(unsupported("running timeline"));
            }
            if control("animation-timeline", "auto")? != "auto" {
                return Err(unsupported("timeline"));
            }
            if control("animation-composition", "replace")? != "replace" {
                return Err(unsupported("composition"));
            }
            let duration = time(&control("animation-duration", "0s")?)?;
            let delay = time(&control("animation-delay", "0s")?)?;
            let count = control("animation-iteration-count", "1")?;
            let count = if count == "infinite" {
                f64::INFINITY
            } else {
                count
                    .parse::<f64>()
                    .map_err(|_error| unsupported("iteration count"))?
            };
            let fill = control("animation-fill-mode", "none")?;
            let direction = control("animation-direction", "normal")?;
            let Some(progress) = progress(duration, delay, count, &fill, &direction)? else {
                continue;
            };
            let easing = control("animation-timing-function", "ease")?;
            let mut frames = Vec::new();
            let mut properties = BTreeSet::new();
            for frame in &definition.frames {
                work.charge()?;
                if frame
                    .declarations
                    .layout_entries()
                    .any(|(property, _, _)| property.starts_with("--"))
                {
                    return Err(unsupported("custom property interpolation"));
                }
                let (computed, _) =
                    frame
                        .declarations
                        .compute_keyframe(variables, registrations, work)?;
                for (property, _, _) in computed.layout_entries() {
                    if !property.starts_with("animation-") {
                        properties.insert(property.to_owned());
                    }
                }
                frames.push((frame.offset, computed));
            }
            for property in properties {
                work.charge()?;
                if declarations.value(&property).1 {
                    continue;
                }
                let underlying = declarations.value(&property).0;
                let Some(value) = value_at(&property, &frames, underlying, &easing, progress)?
                else {
                    continue;
                };
                result.animate(&property, &value)?;
            }
        }
        result.clear_animation_controls();
        Ok(result)
    }
}

fn value_at(
    property: &str,
    frames: &[(f64, Declarations)],
    underlying: String,
    easing: &str,
    progress: f64,
) -> Result<Option<String>> {
    let mut points: Vec<(f64, String, Option<String>)> = Vec::new();
    for (offset, frame) in frames {
        let value = frame.value(property).0;
        if value.is_empty() {
            continue;
        }
        let timing = frame.value("animation-timing-function").0;
        let timing = (!timing.is_empty()).then_some(timing);
        if let Some(previous) = points.last_mut()
            && previous.0.total_cmp(offset).is_eq()
        {
            previous.1 = value;
            if timing.is_some() {
                previous.2 = timing;
            }
        } else {
            points.push((*offset, value, timing));
        }
    }
    if points.first().is_some_and(|point| point.0 > 0.0) {
        points.insert(0, (0.0, underlying.clone(), None));
    }
    if points.last().is_some_and(|point| point.0 < 1.0) {
        points.push((1.0, underlying, None));
    }
    let Some((right, end)) = points
        .iter()
        .enumerate()
        .find(|(_, point)| point.0 >= progress)
    else {
        return Ok(None);
    };
    let value = if end.0.total_cmp(&progress).is_eq() || right == 0 {
        end.1.clone()
    } else {
        let left = right
            .checked_sub(1)
            .and_then(|index| points.get(index))
            .ok_or_else(|| unsupported("keyframe interval"))?;
        let fraction = (progress - left.0) / (end.0 - left.0);
        interpolate(
            property,
            &left.1,
            &end.1,
            ease(left.2.as_deref().unwrap_or(easing), fraction)?,
        )?
    };
    if value.is_empty() {
        return Err(unsupported("underlying value"));
    }
    Ok(Some(value))
}

fn list(declarations: &Declarations, name: &str, default: &str) -> Result<Vec<String>> {
    let value = declarations.value(name).0;
    if value.is_empty() || matches!(value.as_str(), "initial" | "unset") {
        return Ok(vec![default.into()]);
    }
    if matches!(value.as_str(), "inherit" | "revert" | "revert-layer") {
        return Err(unsupported("control inheritance"));
    }
    let mut input = ParserInput::new(&value);
    let mut parser = Parser::new(&mut input);
    parser
        .parse_comma_separated(|input| {
            let start = input.position();
            while input.next().is_ok() {}
            Ok::<_, cssparser::ParseError<'_, ()>>(input.slice_from(start).trim().to_owned())
        })
        .map_err(|_error| unsupported("control list"))
}
fn control(declarations: &Declarations, name: &str, default: &str, index: usize) -> Result<String> {
    let values = list(declarations, name, default)?;
    values
        .get(
            index
                .checked_rem(values.len())
                .ok_or_else(|| unsupported("control list"))?,
        )
        .cloned()
        .ok_or_else(|| unsupported("control list"))
}
fn time(source: &str) -> Result<f64> {
    let value = Time::parse_string(source).map_err(|_error| unsupported("time"))?;
    Ok(f64::from(value.to_ms()) / 1000.0)
}
fn progress(
    duration: f64,
    delay: f64,
    count: f64,
    fill: &str,
    direction: &str,
) -> Result<Option<f64>> {
    if duration < 0.0 || count < 0.0 || !duration.is_finite() || !delay.is_finite() {
        return Err(unsupported("timing"));
    }
    let elapsed = -delay;
    let active = if duration == 0.0 || count == 0.0 {
        0.0
    } else {
        duration * count
    };
    let (iteration, mut progress) = if elapsed < 0.0 {
        if !matches!(fill, "backwards" | "both") {
            return Ok(None);
        }
        (0.0, 0.0)
    } else if elapsed >= active {
        if !matches!(fill, "forwards" | "both") {
            return Ok(None);
        }
        if count == 0.0 {
            (0.0, 0.0)
        } else {
            (
                (count.ceil() - 1.0).max(0.0),
                if count.fract() == 0.0 {
                    1.0
                } else {
                    count.fract()
                },
            )
        }
    } else {
        let position = elapsed / duration;
        (position.floor(), position.fract())
    };
    let reverse = match direction {
        "normal" => false,
        "reverse" => true,
        "alternate" => (iteration % 2.0).total_cmp(&1.0).is_eq(),
        "alternate-reverse" => iteration % 2.0 == 0.0,
        _ => return Err(unsupported("direction")),
    };
    if reverse {
        progress = 1.0 - progress;
    }
    Ok(Some(progress))
}
pub(crate) fn ease(source: &str, progress: f64) -> Result<f64> {
    let value = EasingFunction::parse_string(source).map_err(|_error| unsupported("easing"))?;
    let (x1, y1, x2, y2) = match value {
        EasingFunction::Linear => return Ok(progress),
        EasingFunction::Ease => (0.25, 0.1, 0.25, 1.0),
        EasingFunction::EaseIn => (0.42, 0.0, 1.0, 1.0),
        EasingFunction::EaseOut => (0.0, 0.0, 0.58, 1.0),
        EasingFunction::EaseInOut => (0.42, 0.0, 0.58, 1.0),
        EasingFunction::CubicBezier { x1, y1, x2, y2 } => {
            (f64::from(x1), f64::from(y1), f64::from(x2), f64::from(y2))
        }
        EasingFunction::Steps { .. } => return Err(unsupported("step easing")),
    };
    let curve = |t: f64, a: f64, b: f64| {
        3.0 * (1.0 - t) * (1.0 - t) * t * a + 3.0 * (1.0 - t) * t * t * b + t * t * t
    };
    let (mut low, mut high) = (0.0_f64, 1.0_f64);
    for _ in 0..32 {
        let middle = low.midpoint(high);
        if curve(middle, x1, x2) < progress {
            low = middle;
        } else {
            high = middle;
        }
    }
    Ok(curve(low.midpoint(high), y1, y2))
}
pub(crate) fn interpolate(property: &str, from: &str, to: &str, progress: f64) -> Result<String> {
    if from == to {
        return Ok(from.into());
    }
    let numeric = |value: &str| -> Result<(f64, String)> {
        let mut input = ParserInput::new(value);
        let mut parser = Parser::new(&mut input);
        let (number, unit) = match parser
            .next()
            .map_err(|_error| unsupported("interpolation value"))?
        {
            cssparser::Token::Dimension { value, unit, .. } => {
                (f64::from(*value), unit.to_ascii_lowercase())
            }
            cssparser::Token::Percentage { unit_value, .. } => {
                (f64::from(*unit_value) * 100.0, "%".into())
            }
            cssparser::Token::Number { value, .. } => (f64::from(*value), String::new()),
            _ => return Err(unsupported("interpolation value")),
        };
        parser
            .expect_exhausted()
            .map_err(|_error| unsupported("interpolation value"))?;
        Ok((number, unit))
    };
    let (from, from_unit) = numeric(from)?;
    let (to, to_unit) = numeric(to)?;
    let from_unit = if from_unit.is_empty() && from == 0.0 {
        to_unit.clone()
    } else {
        from_unit
    };
    let to_unit = if to_unit.is_empty() && to == 0.0 {
        from_unit.clone()
    } else {
        to_unit
    };
    if from_unit != to_unit {
        return Err(unsupported("mixed interpolation units"));
    }
    if !matches!(
        property,
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
    ) {
        return Err(unsupported("property interpolation"));
    }
    Ok(format!("{}{from_unit}", from + (to - from) * progress))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keyframes_resolve_lazy_registered_initial_values() -> Result<()> {
        let source = Declarations::parse("animation:demo 1s linear -.5s paused both")
            .map_err(|message| Error::Dom(message.into()))?;
        let mut registrations = crate::registrations::Definitions::default();
        registrations.register(
            "--example-size",
            "syntax:'<length>';inherits:false;initial-value:40px",
            &[],
        )?;
        let mut operations = 0;
        let mut work = Work::new(&mut operations, 1000, 1024);
        let (source, variables) =
            source.compute_registered(&Variables::default(), &registrations, &mut work)?;
        let mut animations = Definitions::default();
        animations.register("demo", "from{width:var(--example-size)}to{width:80px}", &[])?;
        let sampled = animations.sample(&source, &variables, &registrations, &mut work)?;
        assert_eq!(sampled.value("width").0, "60px");
        let source =
            Declarations::parse("--example-size:50px;animation:demo 1s linear -.5s paused both")
                .map_err(|message| Error::Dom(message.into()))?;
        let (source, variables) =
            source.compute_registered(&Variables::default(), &registrations, &mut work)?;
        let sampled = animations.sample(&source, &variables, &registrations, &mut work)?;
        assert_eq!(sampled.value("width").0, "65px");
        Ok(())
    }
    #[test]
    fn paused_animation_declarations_feed_the_native_sampler() -> Result<()> {
        let declarations =
            Declarations::parse("width:11px;animation:demo 1s linear -.5s paused both")
                .map_err(|message| Error::Dom(message.into()))?;
        assert_eq!(declarations.value("animation-name").0, "demo");
        let mut definitions = Definitions::default();
        definitions.register("demo", "from{width:10px}to{width:90px}", &[])?;
        let mut operations = 0;
        let mut work = Work::new(&mut operations, 10000, 1024);
        let sampled = definitions.sample(
            &declarations,
            &Variables::default(),
            &crate::registrations::Definitions::default(),
            &mut work,
        )?;
        assert_eq!(sampled.value("width").0, "50px");
        Ok(())
    }
}

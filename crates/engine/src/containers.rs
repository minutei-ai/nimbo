//! Native container-query conditions and snapshots of actual layout boxes.
use std::{collections::HashMap, rc::Rc};

use dom_query::{NodeId, NodeRef};
use lightningcss::{
    media_query::{
        MediaFeatureComparison as Compare, MediaFeatureName, MediaFeatureValue, Operator,
        QueryFeature,
    },
    rules::{
        CssRule,
        container::{ContainerCondition, ContainerSizeFeature, ContainerSizeFeatureId as Feature},
    },
    stylesheet::{ParserOptions, StyleSheet},
    values::length::Length,
};
use taffy::prelude::*;

use crate::{Error, Result, layout::Work, styles::Declarations};

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: container {detail}"))
}

#[derive(Clone)]
enum Value {
    Number(f64),
    Length(Length),
}
impl Value {
    fn resolve(&self, container: &Container, work: &mut Work<'_>) -> Result<f64> {
        match self {
            Self::Number(value) => Ok(*value),
            Self::Length(value) => container.fonts.length(value, work),
        }
    }
}
#[derive(Clone)]
enum Condition {
    Test(Feature, Option<Compare>, Value),
    Not(Box<Self>),
    Operation(Operator, Vec<Self>),
    Unknown,
    Unsupported,
    Always,
}
#[derive(Clone)]
pub(crate) struct Query {
    name: Option<String>,
    condition: Condition,
    axes: u8,
}
#[derive(Clone, PartialEq)]
pub(crate) struct Container {
    names: Vec<String>,
    axes: u8,
    width: f32,
    height: f32,
    fonts: crate::fonts::Context,
}
pub(crate) type Snapshot = HashMap<NodeId, Container>;

fn axes(feature: Feature) -> u8 {
    match feature {
        Feature::Width | Feature::InlineSize => 1,
        Feature::Height | Feature::BlockSize => 2,
        Feature::AspectRatio | Feature::Orientation => 3,
    }
}
fn number(value: &MediaFeatureValue<'_>) -> Result<Value> {
    match value {
        MediaFeatureValue::Length(value) => {
            crate::fonts::validate(value).map_err(|error| match error {
                Error::Dom(message) => Error::Dom(message.replacen(
                    "layout unsupported: ",
                    "layout unsupported: container ",
                    1,
                )),
                other => other,
            })?;
            Ok(Value::Length(value.clone()))
        }
        MediaFeatureValue::Number(value) => Ok(Value::Number(f64::from(*value))),
        MediaFeatureValue::Ratio(value) => {
            Ok(Value::Number(f64::from(value.0) / f64::from(value.1)))
        }
        MediaFeatureValue::Ident(value) if value.0.eq_ignore_ascii_case("portrait") => {
            Ok(Value::Number(0.0))
        }
        MediaFeatureValue::Ident(value) if value.0.eq_ignore_ascii_case("landscape") => {
            Ok(Value::Number(1.0))
        }
        _ => Err(unsupported("query value")),
    }
}
fn test(
    name: &MediaFeatureName<'_, Feature>,
    operator: Option<Compare>,
    value: Value,
) -> Condition {
    match name {
        MediaFeatureName::Standard(feature) => Condition::Test(*feature, operator, value),
        _ => Condition::Unsupported,
    }
}
fn feature(value: &ContainerSizeFeature<'_>) -> Result<Condition> {
    let name = match value {
        QueryFeature::Boolean { name }
        | QueryFeature::Plain { name, .. }
        | QueryFeature::Range { name, .. }
        | QueryFeature::Interval { name, .. } => name,
    };
    if !matches!(name, MediaFeatureName::Standard(_)) {
        return Ok(Condition::Unsupported);
    }
    match value {
        QueryFeature::Boolean { name } => Ok(test(name, None, Value::Number(0.0))),
        QueryFeature::Plain { name, value } => Ok(test(name, Some(Compare::Equal), number(value)?)),
        QueryFeature::Range {
            name,
            operator,
            value,
        } => Ok(test(name, Some(*operator), number(value)?)),
        QueryFeature::Interval {
            name,
            start,
            start_operator,
            end,
            end_operator,
        } => {
            let reverse = match start_operator {
                Compare::Equal => Compare::Equal,
                Compare::GreaterThan => Compare::LessThan,
                Compare::GreaterThanEqual => Compare::LessThanEqual,
                Compare::LessThan => Compare::GreaterThan,
                Compare::LessThanEqual => Compare::GreaterThanEqual,
            };
            Ok(Condition::Operation(
                Operator::And,
                vec![
                    test(name, Some(reverse), number(start)?),
                    test(name, Some(*end_operator), number(end)?),
                ],
            ))
        }
    }
}
fn condition(value: &ContainerCondition<'_>, depth: usize) -> Result<Condition> {
    if depth > 32 {
        return Err(Error::Limit("container query nesting"));
    }
    match value {
        ContainerCondition::Feature(value) => feature(value),
        ContainerCondition::Not(value) => Ok(Condition::Not(Box::new(condition(
            value,
            depth.saturating_add(1),
        )?))),
        ContainerCondition::Operation {
            operator,
            conditions,
        } => Ok(Condition::Operation(
            *operator,
            conditions
                .iter()
                .map(|value| condition(value, depth.saturating_add(1)))
                .collect::<Result<_>>()?,
        )),
        ContainerCondition::Unknown(_) => Ok(Condition::Unknown),
        ContainerCondition::Style(_) => Err(unsupported("style query")),
        ContainerCondition::ScrollState(_) => Err(unsupported("scroll-state query")),
    }
}
impl Condition {
    fn axes(&self) -> u8 {
        match self {
            Self::Test(feature, _, _) => axes(*feature),
            Self::Not(value) => value.axes(),
            Self::Operation(_, values) => values.iter().fold(0, |axes, value| axes | value.axes()),
            Self::Unknown | Self::Unsupported | Self::Always => 0,
        }
    }
    fn supported(&self) -> bool {
        match self {
            Self::Unsupported => false,
            Self::Not(value) => value.supported(),
            Self::Operation(_, values) => values.iter().all(Self::supported),
            _ => true,
        }
    }
    fn evaluate(&self, container: &Container, work: &mut Work<'_>) -> Result<Option<bool>> {
        Ok(match self {
            Self::Always => Some(true),
            Self::Unknown | Self::Unsupported => None,
            Self::Not(value) => value.evaluate(container, work)?.map(|value| !value),
            Self::Operation(operator, values) => {
                let mut unknown = false;
                for value in values {
                    match (operator, value.evaluate(container, work)?) {
                        (Operator::And, Some(false)) => return Ok(Some(false)),
                        (Operator::Or, Some(true)) => return Ok(Some(true)),
                        (_, None) => unknown = true,
                        _ => {}
                    }
                }
                if unknown {
                    None
                } else {
                    Some(matches!(operator, Operator::And))
                }
            }
            Self::Test(feature, operator, expected) => {
                let expected = expected.resolve(container, work)?;
                let width = f64::from(container.width);
                let height = f64::from(container.height);
                let actual = match feature {
                    Feature::Width | Feature::InlineSize => width,
                    Feature::Height | Feature::BlockSize => height,
                    Feature::AspectRatio => width / height,
                    Feature::Orientation => {
                        if width > height {
                            1.0
                        } else {
                            0.0
                        }
                    }
                };
                Some(match operator {
                    None => actual > 0.0,
                    Some(Compare::Equal) => actual.total_cmp(&expected).is_eq(),
                    Some(Compare::GreaterThan) => actual > expected,
                    Some(Compare::GreaterThanEqual) => actual >= expected,
                    Some(Compare::LessThan) => actual < expected,
                    Some(Compare::LessThanEqual) => actual <= expected,
                })
            }
        })
    }
}
impl Query {
    pub(crate) fn parse(source: &str) -> Result<Rc<Self>> {
        let source = format!("@container {source} {{}}");
        let sheet = StyleSheet::parse(&source, ParserOptions::default())
            .map_err(|_error| unsupported("query syntax"))?;
        let Some(CssRule::Container(rule)) = sheet.rules.0.first() else {
            return Err(unsupported("query syntax"));
        };
        let condition = rule
            .condition
            .as_ref()
            .map_or(Ok(Condition::Always), |value| condition(value, 0))?;
        Ok(Rc::new(Self {
            name: rule.name.as_ref().map(|name| name.0.0.to_string()),
            axes: condition.axes(),
            condition,
        }))
    }
    pub(crate) fn matches(
        &self,
        node: NodeRef<'_>,
        generated: bool,
        snapshot: &Snapshot,
        work: &mut Work<'_>,
    ) -> Result<bool> {
        if !self.condition.supported() {
            return Ok(false);
        }
        for ancestor in std::iter::once(node)
            .filter(|_node| generated)
            .chain(node.ancestors_it(None))
        {
            work.charge()?;
            if let Some(container) = snapshot.get(&ancestor.id)
                && container.axes & self.axes == self.axes
                && self
                    .name
                    .as_ref()
                    .is_none_or(|name| container.names.contains(name))
            {
                return Ok(self.condition.evaluate(container, work)? == Some(true));
            }
        }
        Ok(false)
    }
}
impl Container {
    pub(crate) fn apply(
        declarations: &Declarations,
        style: &mut Style,
        parent_display: Display,
        fonts: crate::fonts::Context,
    ) -> Result<Option<Self>> {
        let (kind, _) = declarations.value("container-type");
        let axes = match kind.as_str() {
            "" | "normal" | "initial" | "unset" => 0,
            "inline-size" => 1,
            "size" => 3,
            _ => return Err(unsupported("type")),
        };
        let (names, _) = declarations.value("container-name");
        let mut input = cssparser::ParserInput::new(&names);
        let mut parser = cssparser::Parser::new(&mut input);
        let mut names = Vec::new();
        while !parser.is_exhausted() {
            let name = parser
                .expect_ident()
                .map_err(|_error| unsupported("name"))?
                .to_string();
            if matches!(name.as_str(), "inherit" | "revert" | "revert-layer") {
                return Err(unsupported("name inheritance"));
            }
            if !matches!(name.as_str(), "none" | "initial" | "unset") {
                names.push(name);
            }
        }
        if axes == 0 && names.is_empty() {
            return Ok(None);
        }
        if axes > 0 {
            // Taffy's current containment handles formatting contexts, but not
            // intrinsic size suppression. Reject dependent sizing until that
            // missing algorithm is integrated, rather than measuring children
            // as if they contributed to a size-contained box.
            if style.size.width.into_option().is_none()
                || (axes == 3 && style.size.height.into_option().is_none())
            {
                return Err(unsupported("intrinsic size containment"));
            }
            if matches!(parent_display, Display::Flex | Display::Grid) {
                return Err(unsupported("intrinsic item containment"));
            }
            style.contain = taffy::Contain::LAYOUT;
        }
        Ok(Some(Self {
            names,
            axes,
            width: 0.0,
            height: 0.0,
            fonts,
        }))
    }
    pub(crate) fn measure(&mut self, layout: &Layout) {
        self.width = (layout.size.width
            - layout.padding.left
            - layout.padding.right
            - layout.border.left
            - layout.border.right)
            .max(0.0);
        self.height = (layout.size.height
            - layout.padding.top
            - layout.padding.bottom
            - layout.border.top
            - layout.border.bottom)
            .max(0.0);
    }
}

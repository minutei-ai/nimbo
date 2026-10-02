//! Stylesheet custom-property registrations, checked before `var()` substitution.
use std::{collections::BTreeMap, rc::Rc};

use cssparser::{
    AtRuleParser, CowRcStr, DeclarationParser, ParseError, Parser, ParserInput, ParserState,
    QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser,
};
use lightningcss::{
    stylesheet::PrinterOptions,
    traits::ToCss,
    values::{
        color::CssColor,
        length::{Length, LengthPercentage},
        resolution::Resolution,
        syntax::{Multiplier, ParsedComponent, SyntaxString},
    },
};

use crate::{Error, Result, fonts, layout::Work};

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: registered {detail}"))
}

pub(crate) struct Registration {
    pub(crate) syntax: SyntaxString,
    pub(crate) inherits: bool,
    pub(crate) initial: Option<Rc<str>>,
    layer: Vec<usize>,
}
#[derive(Default)]
pub(crate) struct Definitions {
    pub(crate) entries: BTreeMap<String, Registration>,
    count: usize,
}

#[derive(Default)]
struct Descriptors {
    syntax: Option<SyntaxString>,
    inherits: Option<bool>,
    initial: Option<String>,
}
enum Descriptor {
    Syntax(SyntaxString),
    Inherits(bool),
    Initial(String),
}
impl<'i> DeclarationParser<'i> for Descriptors {
    type Declaration = Descriptor;
    type Error = ();
    fn parse_value<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
        _start: &ParserState,
    ) -> std::result::Result<Descriptor, ParseError<'i, ()>> {
        if name.eq_ignore_ascii_case("syntax") {
            let value = input.expect_string_cloned()?;
            input.expect_exhausted()?;
            return SyntaxString::parse_string(&value)
                .map(Descriptor::Syntax)
                .map_err(|_error| input.new_custom_error(()));
        }
        if name.eq_ignore_ascii_case("inherits") {
            let value = input.expect_ident_cloned()?;
            input.expect_exhausted()?;
            return if value.eq_ignore_ascii_case("true") {
                Ok(Descriptor::Inherits(true))
            } else if value.eq_ignore_ascii_case("false") {
                Ok(Descriptor::Inherits(false))
            } else {
                Err(input.new_custom_error(()))
            };
        }
        if name.eq_ignore_ascii_case("initial-value") {
            let start = input.position();
            crate::styles::components(input, 0, true)?;
            return Ok(Descriptor::Initial(input.slice_from(start).to_owned()));
        }
        Err(input.new_custom_error(()))
    }
}
impl AtRuleParser<'_> for Descriptors {
    type Prelude = ();
    type AtRule = Descriptor;
    type Error = ();
}
impl QualifiedRuleParser<'_> for Descriptors {
    type Prelude = ();
    type QualifiedRule = Descriptor;
    type Error = ();
}
impl RuleBodyItemParser<'_, Descriptor, ()> for Descriptors {
    fn parse_qualified(&self) -> bool {
        false
    }
    fn parse_declarations(&self) -> bool {
        true
    }
}

impl Definitions {
    pub(crate) fn register(&mut self, name: &str, body: &str, layer: &[usize]) -> Result<()> {
        self.count = self.count.saturating_add(1);
        if self.count > 1024 {
            return Err(Error::Limit("property registrations"));
        }
        let mut descriptors = Descriptors::default();
        let mut input = ParserInput::new(body);
        let mut parser = Parser::new(&mut input);
        let mut body = RuleBodyParser::new(&mut parser, &mut descriptors);
        while let Some(value) = body.next() {
            match value {
                Ok(Descriptor::Syntax(value)) => body.parser.syntax = Some(value),
                Ok(Descriptor::Inherits(value)) => body.parser.inherits = Some(value),
                Ok(Descriptor::Initial(value)) => body.parser.initial = Some(value),
                Err(_) => {}
            }
        }
        // Published Level 1 behavior, also verified against Chromium: both
        // descriptors are required. Later invalid descriptors are discarded.
        let (Some(syntax), Some(inherits)) = (descriptors.syntax, descriptors.inherits) else {
            return Ok(());
        };
        let mut operations = 0;
        let mut work = Work::new(&mut operations, 10_000, 1024);
        let initial = match descriptors.initial {
            Some(value) => {
                if crate::styles::wide_keyword(&value).is_some() {
                    return Ok(());
                }
                let mut input = ParserInput::new(&value);
                if crate::styles::components(&mut Parser::new(&mut input), 0, true)
                    .map_err(|_error| unsupported("initial syntax"))?
                {
                    return Ok(());
                }
                match compute(&syntax, &value, &mut work) {
                    Ok(Some(value)) => Some(value),
                    Ok(None) => return Ok(()),
                    Err(Error::Dom(message)) if message.ends_with("registered relative length") => {
                        return Ok(());
                    }
                    Err(error) => return Err(error),
                }
            }
            None if matches!(syntax, SyntaxString::Universal) => None,
            None => return Ok(()),
        };
        let mut rank = layer.to_vec();
        rank.push(usize::MAX);
        if self
            .entries
            .get(name)
            .is_some_and(|previous| previous.layer > rank)
        {
            return Ok(());
        }
        self.entries.insert(
            name.to_owned(),
            Registration {
                syntax,
                inherits,
                initial,
                layer: rank,
            },
        );
        Ok(())
    }
}

pub(crate) fn compute(
    syntax: &SyntaxString,
    source: &str,
    work: &mut Work<'_>,
) -> Result<Option<Rc<str>>> {
    work.charge()?;
    if matches!(syntax, SyntaxString::Universal) {
        return Ok(Some(Rc::from(source)));
    }
    let SyntaxString::Components(components) = syntax else {
        return Ok(None);
    };
    // Match complete alternatives. The transformer's single-component parser
    // accepts prefixes; accepting them here would lose later valid alternatives.
    for component in components {
        work.charge()?;
        let syntax = SyntaxString::Components(vec![component.clone()]);
        let mut input = ParserInput::new(source);
        let mut parser = Parser::new(&mut input);
        if let Ok(value) = syntax.parse_value(&mut parser)
            && parser.expect_exhausted().is_ok()
        {
            return serialize(&value, 0, work).map(|value| Some(Rc::from(value)));
        }
    }
    Ok(None)
}

fn number(value: f64, unit: &str) -> Result<String> {
    if !value.is_finite() {
        return Err(unsupported("non-finite value"));
    }
    Ok(format!("{value}{unit}"))
}

fn serialize(value: &ParsedComponent<'_>, depth: usize, work: &mut Work<'_>) -> Result<String> {
    work.charge()?;
    if depth > 32 {
        return Err(Error::Limit("registered value nesting"));
    }
    match value {
        ParsedComponent::Length(value) => number(fonts::absolute(value, work)?, "px"),
        ParsedComponent::LengthPercentage(LengthPercentage::Dimension(value)) => {
            number(fonts::absolute(&Length::Value(value.clone()), work)?, "px")
        }
        ParsedComponent::LengthPercentage(LengthPercentage::Percentage(value))
        | ParsedComponent::Percentage(value) => number(f64::from(value.0) * 100.0, "%"),
        ParsedComponent::Number(value) => number(f64::from(*value), ""),
        ParsedComponent::Integer(value) => Ok(value.to_string()),
        ParsedComponent::Angle(value) => number(f64::from(value.to_degrees()), "deg"),
        ParsedComponent::Time(value) => number(f64::from(value.to_ms()) / 1000.0, "s"),
        ParsedComponent::Resolution(value) => number(
            match value {
                Resolution::Dpi(value) => f64::from(*value) / 96.0,
                Resolution::Dpcm(value) => f64::from(*value) * 2.54 / 96.0,
                Resolution::Dppx(value) => f64::from(*value),
            },
            "dppx",
        ),
        ParsedComponent::Repeated {
            components,
            multiplier,
        } => {
            let mut output = Vec::new();
            for component in components {
                output.push(serialize(component, depth.saturating_add(1), work)?);
            }
            Ok(output.join(if matches!(multiplier, Multiplier::Comma) {
                ", "
            } else {
                " "
            }))
        }
        ParsedComponent::Color(CssColor::CurrentColor) => Err(unsupported("dependent color")),
        ParsedComponent::CustomIdent(_)
        | ParsedComponent::Literal(_)
        | ParsedComponent::String(_)
        | ParsedComponent::Color(CssColor::RGBA(_)) => value
            .to_css_string(PrinterOptions::default())
            .map_err(|_error| unsupported("value serialization")),
        _ => Err(unsupported("computed value type")),
    }
}

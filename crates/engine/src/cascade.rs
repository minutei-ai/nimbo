use cssparser::{
    AtRuleParser, CowRcStr, ParseError, Parser, ParserInput, ParserState, QualifiedRuleParser,
    StyleSheetParser, Token,
};
use dom_query::{Document, NodeRef};
use lightningcss::{
    selector::{Component, PseudoClass, PseudoElement, SelectorList},
    stylesheet::{ParserOptions, PrinterOptions},
    traits::{ParseWithOptions, ToCss},
};

use crate::selectors::Matcher;
use crate::{Error, MediaEnvironment, Result, layout::Work, styles::Declarations};

struct Selector {
    matcher: Matcher,
    specificity: u32,
    generated: Option<Generated>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Generated {
    Before,
    After,
}
struct Rule {
    selectors: Vec<Selector>,
    declarations: Declarations,
    layer: Vec<usize>,
}
pub(crate) struct Cascade {
    rules: Vec<Rule>,
    pub(crate) animations: crate::animations::Definitions,
}

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: {detail}"))
}

fn unknown_selector(selector: &lightningcss::selector::Selector<'_>) -> bool {
    selector
        .iter_raw_match_order()
        .any(|component| match component {
            Component::NonTSPseudoClass(
                PseudoClass::Custom { .. } | PseudoClass::CustomFunction { .. },
            )
            | Component::PseudoElement(
                PseudoElement::Custom { .. } | PseudoElement::CustomFunction { .. },
            ) => true,
            Component::Is(list)
            | Component::Where(list)
            | Component::Negation(list)
            | Component::Has(list)
            | Component::Any(_, list) => list.iter().any(unknown_selector),
            Component::NthOf(data) => data.selectors().iter().any(unknown_selector),
            _ => false,
        })
}

fn forgiving_unknown(selector: &lightningcss::selector::Selector<'_>) -> bool {
    selector
        .iter_raw_match_order()
        .any(|component| match component {
            Component::Is(list) | Component::Where(list) => list.iter().any(unknown_selector),
            Component::Negation(list) | Component::Has(list) | Component::Any(_, list) => {
                list.iter().any(forgiving_unknown)
            }
            Component::NthOf(data) => data.selectors().iter().any(forgiving_unknown),
            _ => false,
        })
}

// Scan nesting before recursive selector parsing. Invalid declaration syntax is
// still handled by the declaration parser rather than poisoning the whole sheet.
fn consume<'i>(
    input: &mut Parser<'i, '_>,
    depth: usize,
) -> std::result::Result<bool, ParseError<'i, &'static str>> {
    if depth > 32 {
        return Err(input.new_custom_error("stylesheet nesting"));
    }
    let mut curly = false;
    while !input.is_exhausted() {
        match input.next_including_whitespace_and_comments()?.clone() {
            Token::CurlyBracketBlock => {
                curly = true;
                input.parse_nested_block(|input| consume(input, depth.saturating_add(1)))?;
            }
            Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock => {
                curly |=
                    input.parse_nested_block(|input| consume(input, depth.saturating_add(1)))?;
            }
            _ => {}
        }
    }
    Ok(curly)
}

enum ParsedRule {
    Style(Rule),
    Group(Vec<Rule>),
}
enum Prelude {
    Media(bool),
    Layers(Vec<Vec<String>>),
    Keyframes(String),
}
struct Rules<'a> {
    media: &'a MediaEnvironment,
    layers: &'a mut crate::layers::Layers,
    animations: &'a mut crate::animations::Definitions,
    parent: &'a [usize],
    failure: Option<Error>,
}
impl<'i> AtRuleParser<'i> for Rules<'_> {
    type Prelude = Prelude;
    type AtRule = ParsedRule;
    type Error = &'static str;
    fn parse_prelude<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<Prelude, ParseError<'i, Self::Error>> {
        if name.eq_ignore_ascii_case("keyframes") || name.eq_ignore_ascii_case("-webkit-keyframes")
        {
            let start = input.position();
            consume(input, 0)?;
            let source = input.slice_from(start);
            crate::animations::name(source).map_err(|_error| {
                input.new_error(cssparser::BasicParseErrorKind::QualifiedRuleInvalid)
            })?;
            return Ok(Prelude::Keyframes(source.to_owned()));
        }
        if name.eq_ignore_ascii_case("layer") {
            return crate::layers::names(input).map(Prelude::Layers);
        }
        if name.eq_ignore_ascii_case("supports") {
            return crate::supports::condition(input, 0).map(Prelude::Media);
        }
        if !name.eq_ignore_ascii_case("media") {
            return Err(input.new_custom_error("stylesheet at-rule"));
        }
        let start = input.position();
        consume(input, 0)?;
        matches_media(self.media, input.slice_from(start))
            .map(Prelude::Media)
            .map_err(|_error| input.new_custom_error("stylesheet media query"))
    }
    fn parse_block<'t>(
        &mut self,
        prelude: Prelude,
        _start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<ParsedRule, ParseError<'i, Self::Error>> {
        let start = input.position();
        consume(input, 0)?;
        let parent = match prelude {
            Prelude::Keyframes(name) => {
                self.animations
                    .register(&name, input.slice_from(start), self.parent)
                    .map_err(|error| {
                        self.failure = Some(error);
                        input.new_custom_error("stylesheet keyframes")
                    })?;
                return Ok(ParsedRule::Group(Vec::new()));
            }
            Prelude::Media(false) => return Ok(ParsedRule::Group(Vec::new())),
            Prelude::Media(true) => self.parent.to_vec(),
            Prelude::Layers(names) => {
                if names.len() > 1 {
                    return Err(
                        input.new_error(cssparser::BasicParseErrorKind::QualifiedRuleInvalid)
                    );
                }
                self.layers
                    .register(self.parent, names.first().map(Vec::as_slice))
                    .map_err(|message| input.new_custom_error(message))?
            }
        };
        let rules = sheet(
            input.slice_from(start),
            self.media,
            self.layers,
            self.animations,
            &parent,
        )
        .map_err(|error| {
            // Keep the original engine error across cssparser's static
            // error boundary. Nested groups must not hide budget failures
            // or the unsupported feature behind a generic group label.
            self.failure = Some(error);
            input.new_custom_error("stylesheet group")
        })?;
        Ok(ParsedRule::Group(rules))
    }
    fn rule_without_block(
        &mut self,
        prelude: Prelude,
        _start: &ParserState,
    ) -> std::result::Result<ParsedRule, ()> {
        let Prelude::Layers(names) = prelude else {
            return Err(());
        };
        if names.is_empty() {
            return Err(());
        }
        for name in names {
            self.layers
                .register(self.parent, Some(&name))
                .map_err(|_message| ())?;
        }
        Ok(ParsedRule::Group(Vec::new()))
    }
}
impl<'i> QualifiedRuleParser<'i> for Rules<'_> {
    type Prelude = Vec<Selector>;
    type QualifiedRule = ParsedRule;
    type Error = &'static str;
    fn parse_prelude<'t>(
        &mut self,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<Self::Prelude, ParseError<'i, Self::Error>> {
        let start = input.position();
        consume(input, 0)?;
        let list = SelectorList::parse_string_with_options(
            input.slice_from(start),
            ParserOptions::default(),
        )
        .map_err(|_error| input.new_error(cssparser::BasicParseErrorKind::QualifiedRuleInvalid))?;
        if list.0.len() > 64 {
            return Err(input.new_custom_error("stylesheet selectors"));
        }
        // The transformer preserves unknown pseudo syntax for future CSS. A
        // browser must discard a non-forgiving selector list containing it.
        if list.0.iter().any(forgiving_unknown) {
            return Err(input.new_custom_error("forgiving selector recovery"));
        }
        if list.0.iter().any(unknown_selector) {
            return Err(input.new_error(cssparser::BasicParseErrorKind::QualifiedRuleInvalid));
        }
        list.0
            .iter()
            .map(|selector| {
                let source = selector
                    .to_css_string(PrinterOptions::default())
                    .map_err(|_error| input.new_custom_error("stylesheet selector"))?;
                let generated =
                    selector
                        .iter_raw_match_order()
                        .find_map(|component| match component {
                            Component::PseudoElement(PseudoElement::Before) => {
                                Some(Generated::Before)
                            }
                            Component::PseudoElement(PseudoElement::After) => {
                                Some(Generated::After)
                            }
                            _ => None,
                        });
                let origin = if let Some(generated) = generated {
                    let (double, single) = match generated {
                        Generated::Before => ("::before", ":before"),
                        Generated::After => ("::after", ":after"),
                    };
                    let origin = source
                        .strip_suffix(double)
                        .or_else(|| source.strip_suffix(single))
                        .ok_or_else(|| input.new_custom_error("generated selector"))?;
                    if origin.is_empty() {
                        "*".to_owned()
                    } else if origin.ends_with([' ', '\t', '\n', '\r', '\u{c}', '>', '+', '~']) {
                        format!("{origin}*")
                    } else {
                        origin.to_owned()
                    }
                } else {
                    source
                };
                let matcher = Matcher::new(&origin)
                    .map_err(|_error| input.new_custom_error("stylesheet selector"))?;
                Ok(Selector {
                    matcher,
                    specificity: selector.specificity(),
                    generated,
                })
            })
            .collect()
    }
    fn parse_block<'t>(
        &mut self,
        selectors: Self::Prelude,
        _start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<ParsedRule, ParseError<'i, Self::Error>> {
        let start = input.position();
        if consume(input, 0)? {
            return Err(input.new_custom_error("nested stylesheet rule"));
        }
        let declarations = Declarations::parse(input.slice_from(start))
            .map_err(|message| input.new_custom_error(message))?;
        Ok(ParsedRule::Style(Rule {
            selectors,
            declarations,
            layer: self
                .parent
                .iter()
                .copied()
                .chain(std::iter::once(usize::MAX))
                .collect(),
        }))
    }
}

fn sheet(
    source: &str,
    media: &MediaEnvironment,
    layers: &mut crate::layers::Layers,
    animations: &mut crate::animations::Definitions,
    parent: &[usize],
) -> Result<Vec<Rule>> {
    if source.len() > 262_144 {
        return Err(Error::Limit("stylesheet bytes"));
    }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    consume(&mut parser, 0).map_err(|_error| Error::Limit("stylesheet nesting"))?;
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let mut rules = Vec::new();
    let mut rule_parser = Rules {
        media,
        layers,
        animations,
        parent,
        failure: None,
    };
    let mut failure = None;
    for result in StyleSheetParser::new(&mut parser, &mut rule_parser) {
        match result {
            Ok(ParsedRule::Style(rule)) => rules.push(rule),
            Ok(ParsedRule::Group(group)) => rules.extend(group),
            Err((error, _source)) => {
                if let cssparser::ParseErrorKind::Custom(message) = error.kind {
                    failure = Some(
                        if message == "stylesheet layers" || message == "stylesheet layer depth" {
                            Error::Limit(message)
                        } else {
                            unsupported(message)
                        },
                    );
                    break;
                }
            }
        }
        if rules.len() > 1024 {
            return Err(Error::Limit("stylesheet rules"));
        }
    }
    if let Some(error) = failure {
        return Err(rule_parser.failure.unwrap_or(error));
    }
    if let Some(message) = layers.failure {
        return Err(Error::Limit(message));
    }
    Ok(rules)
}

fn matches_media(media: &MediaEnvironment, source: &str) -> Result<bool> {
    let result: serde_json::Value = serde_json::from_str(&media.query(source)?)?;
    Ok(result.get("matches").and_then(serde_json::Value::as_bool) == Some(true))
}

impl Cascade {
    pub(crate) fn collect(
        document: &Document,
        sheets: &crate::stylesheets::Sheets,
        base: Option<&str>,
        media: &MediaEnvironment,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let mut rules = Vec::new();
        let mut bytes = 0_usize;
        let mut nodes = 0_usize;
        let mut selectors = 0_usize;
        let mut layers = crate::layers::Layers::default();
        let mut animations = crate::animations::Definitions::default();
        for node in document.root().descendants_it() {
            work.charge()?;
            nodes = nodes.saturating_add(1);
            if nodes > 1024 {
                return Err(Error::Limit("layout tree"));
            }
            let external = crate::stylesheets::is_stylesheet(node);
            if !external && !node.has_name("style") {
                continue;
            }
            if node
                .attr("type")
                .is_some_and(|value| !value.is_empty() && !value.eq_ignore_ascii_case("text/css"))
            {
                continue;
            }
            if !matches_media(media, node.attr("media").as_deref().unwrap_or_default())? {
                continue;
            }
            if node.has_attr("title") {
                return Err(unsupported("stylesheet sets"));
            }
            let source = if external {
                let Some(source) = sheets.source(node, base)? else {
                    continue;
                };
                source.to_owned()
            } else {
                node.text().to_string()
            };
            if source.len() > 262_144 {
                return Err(Error::Limit("stylesheet bytes"));
            }
            bytes = bytes.saturating_add(source.len());
            if bytes > 262_144 {
                return Err(Error::Limit("stylesheet total bytes"));
            }
            let parsed = sheet(&source, media, &mut layers, &mut animations, &[])?;
            selectors = selectors.saturating_add(
                parsed
                    .iter()
                    .map(|rule| rule.selectors.len())
                    .sum::<usize>(),
            );
            if selectors > 1024 {
                return Err(Error::Limit("stylesheet selectors"));
            }
            rules.extend(parsed);
        }
        Ok(Self { rules, animations })
    }

    pub(crate) fn resolve(
        &self,
        node: NodeRef<'_>,
        inline: &Declarations,
        generated: Option<Generated>,
        work: &mut Work<'_>,
    ) -> Result<Declarations> {
        let mut sources = Vec::new();
        for rule in &self.rules {
            let mut specificity = None;
            for selector in &rule.selectors {
                if selector.generated != generated {
                    continue;
                }
                work.charge()?;
                if selector.matcher.matches(node) {
                    specificity = Some(specificity.map_or(selector.specificity, |value: u32| {
                        value.max(selector.specificity)
                    }));
                }
            }
            if let Some(specificity) = specificity {
                sources.push((
                    &rule.declarations,
                    false,
                    specificity,
                    rule.layer.as_slice(),
                ));
            }
        }
        if generated.is_none() {
            sources.push((inline, true, 0, [usize::MAX].as_slice()));
        }
        Declarations::cascade(sources).map_err(|message| Error::Dom(message.into()))
    }
}

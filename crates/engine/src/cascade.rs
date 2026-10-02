use cssparser::{
    AtRuleParser, CowRcStr, ParseError, Parser, ParserInput, ParserState, QualifiedRuleParser,
    StyleSheetParser, Token,
};
use dom_query::{Document, Matcher, NodeRef};
use lightningcss::{
    selector::{Component, PseudoClass, PseudoElement, SelectorList},
    stylesheet::{ParserOptions, PrinterOptions},
    traits::{ParseWithOptions, ToCss},
};

use crate::{Error, MediaEnvironment, Result, layout::Work, styles::Declarations};

struct Selector {
    matcher: Matcher,
    specificity: u32,
}
struct Rule {
    selectors: Vec<Selector>,
    declarations: Declarations,
}
pub(crate) struct Cascade {
    rules: Vec<Rule>,
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
struct Rules<'a> {
    media: &'a MediaEnvironment,
}
impl<'i> AtRuleParser<'i> for Rules<'_> {
    type Prelude = bool;
    type AtRule = ParsedRule;
    type Error = &'static str;
    fn parse_prelude<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<bool, ParseError<'i, Self::Error>> {
        if !name.eq_ignore_ascii_case("media") {
            return Err(input.new_custom_error("stylesheet at-rule"));
        }
        let start = input.position();
        consume(input, 0)?;
        matches_media(self.media, input.slice_from(start))
            .map_err(|_error| input.new_custom_error("stylesheet media query"))
    }
    fn parse_block<'t>(
        &mut self,
        active: bool,
        _start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<ParsedRule, ParseError<'i, Self::Error>> {
        let start = input.position();
        consume(input, 0)?;
        if !active {
            return Ok(ParsedRule::Group(Vec::new()));
        }
        let rules = sheet(input.slice_from(start), self.media)
            .map_err(|_error| input.new_custom_error("stylesheet media group"))?;
        Ok(ParsedRule::Group(rules))
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
                let matcher = Matcher::new(&source)
                    .map_err(|_error| input.new_custom_error("stylesheet selector"))?;
                Ok(Selector {
                    matcher,
                    specificity: selector.specificity(),
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
        }))
    }
}

fn sheet(source: &str, media: &MediaEnvironment) -> Result<Vec<Rule>> {
    if source.len() > 65_536 {
        return Err(Error::Limit("stylesheet bytes"));
    }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    consume(&mut parser, 0).map_err(|_error| Error::Limit("stylesheet nesting"))?;
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let mut rules = Vec::new();
    for result in StyleSheetParser::new(&mut parser, &mut Rules { media }) {
        match result {
            Ok(ParsedRule::Style(rule)) => rules.push(rule),
            Ok(ParsedRule::Group(group)) => rules.extend(group),
            Err((error, _source)) => {
                if let cssparser::ParseErrorKind::Custom(message) = error.kind {
                    return Err(unsupported(message));
                }
            }
        }
        if rules.len() > 1024 {
            return Err(Error::Limit("stylesheet rules"));
        }
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
        media: &MediaEnvironment,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let mut rules = Vec::new();
        let mut bytes = 0_usize;
        let mut nodes = 0_usize;
        let mut selectors = 0_usize;
        for node in document.root().descendants_it() {
            work.charge()?;
            nodes = nodes.saturating_add(1);
            if nodes > 1024 {
                return Err(Error::Limit("layout tree"));
            }
            if node.has_name("link")
                && node.attr("rel").is_some_and(|value| {
                    value
                        .split_ascii_whitespace()
                        .any(|part| part.eq_ignore_ascii_case("stylesheet"))
                })
            {
                return Err(unsupported("external stylesheet"));
            }
            if !node.has_name("style") {
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
            let source = node.text();
            bytes = bytes.saturating_add(source.len());
            if bytes > 262_144 {
                return Err(Error::Limit("stylesheet total bytes"));
            }
            let parsed = sheet(&source, media)?;
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
        Ok(Self { rules })
    }

    pub(crate) fn resolve(
        &self,
        node: NodeRef<'_>,
        inline: &Declarations,
        work: &mut Work<'_>,
    ) -> Result<Declarations> {
        let mut sources = Vec::new();
        for rule in &self.rules {
            let mut specificity = None;
            for selector in &rule.selectors {
                work.charge()?;
                if node.is_match(&selector.matcher) {
                    specificity = Some(specificity.map_or(selector.specificity, |value: u32| {
                        value.max(selector.specificity)
                    }));
                }
            }
            if let Some(specificity) = specificity {
                sources.push((&rule.declarations, false, specificity));
            }
        }
        sources.push((inline, true, 0));
        Declarations::cascade(sources).map_err(|message| Error::Dom(message.into()))
    }
}

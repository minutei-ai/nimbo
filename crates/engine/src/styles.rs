use cssparser::{
    AtRuleParser, CowRcStr, DeclarationParser, Delimiter, ParseError, Parser, ParserInput,
    ParserState, QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser, Token, parse_important,
};
use lightningcss::{
    declaration::DeclarationBlock,
    properties::{Property, PropertyId},
    stylesheet::{ParserOptions, PrinterOptions},
    traits::Parse,
    values::image::Image,
};
use serde::{Deserialize, Serialize};
use std::rc::Rc;

const INPUT_LIMIT: usize = 65_536;
const ENTRY_LIMIT: usize = 1024;
const DEPTH_LIMIT: usize = 32;

mod computed;
pub(crate) use computed::Variables;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Pending {
    name: String,
    value: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct Entry {
    name: String,
    value: String,
    important: bool,
    #[serde(skip)]
    pending: Option<Rc<Pending>>,
    #[serde(skip)]
    deferred: bool,
}

impl Entry {
    fn new(name: &str, value: String, important: bool) -> Self {
        Self {
            name: name.to_owned(),
            value,
            important,
            pending: None,
            deferred: false,
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct Declarations {
    entries: Vec<Entry>,
    shorthands: Vec<String>,
}

// Tokenize before invoking the grammar parser, bounding recursion and rejecting
// bad strings/URLs rather than accepting the transformer's unparsed fallback.
pub(crate) fn components<'i>(
    input: &mut Parser<'i, '_>,
    depth: usize,
    strict: bool,
) -> Result<bool, ParseError<'i, ()>> {
    if depth > DEPTH_LIMIT {
        return Err(input.new_custom_error(()));
    }
    let mut deferred = false;
    while !input.is_exhausted() {
        match input.next_including_whitespace_and_comments()?.clone() {
            Token::BadString(_)
            | Token::BadUrl(_)
            | Token::CloseParenthesis
            | Token::CloseSquareBracket
            | Token::CloseCurlyBracket => return Err(input.new_custom_error(())),
            Token::Delim('!') | Token::Semicolon if strict => {
                return Err(input.new_custom_error(()));
            }
            Token::Function(name)
                if name.eq_ignore_ascii_case("var") || name.eq_ignore_ascii_case("env") =>
            {
                input.parse_nested_block(|nested| {
                    reference(nested, &name, depth.saturating_add(1))
                })?;
                deferred = true;
            }
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                deferred |= input.parse_nested_block(|nested| {
                    components(nested, depth.saturating_add(1), false)
                })?;
            }
            _ => {}
        }
    }
    Ok(deferred)
}

fn reference<'i>(
    input: &mut Parser<'i, '_>,
    function: &str,
    depth: usize,
) -> Result<bool, ParseError<'i, ()>> {
    if depth > DEPTH_LIMIT {
        return Err(input.new_custom_error(()));
    }
    let name = input.expect_ident_cloned()?;
    if function.eq_ignore_ascii_case("var") {
        if !custom_name(&name) {
            return Err(input.new_custom_error(()));
        }
    } else {
        while let Ok(index) = input.try_parse(Parser::expect_integer) {
            if index < 0 {
                return Err(input.new_custom_error(()));
            }
        }
    }
    if input.try_parse(Parser::expect_comma).is_ok() {
        components(input, depth, true)?;
    }
    input.expect_exhausted()?;
    Ok(true)
}

fn deferred_value(value: &str) -> Option<bool> {
    let mut input = ParserInput::new(value);
    components(&mut Parser::new(&mut input), 0, true).ok()
}

fn property_name(name: &str) -> String {
    if name.starts_with("--") {
        name.to_owned()
    } else {
        name.to_ascii_lowercase()
    }
}

fn native_keyword(name: &str, value: &str) -> Option<String> {
    let mut input = ParserInput::new(value);
    let mut parser = Parser::new(&mut input);
    let keyword = parser.expect_ident().ok()?.to_ascii_lowercase();
    parser.expect_exhausted().ok()?;
    let valid = match name {
        "float" => matches!(
            keyword.as_str(),
            "left" | "right" | "none" | "inline-start" | "inline-end"
        ),
        "clear" => matches!(
            keyword.as_str(),
            "left" | "right" | "none" | "both" | "inline-start" | "inline-end"
        ),
        _ => false,
    };
    valid.then_some(keyword)
}

fn custom_name(name: &str) -> bool {
    if !name.starts_with("--") || name == "--" {
        return false;
    }
    let mut input = ParserInput::new(name);
    let mut parser = Parser::new(&mut input);
    parser
        .expect_ident()
        .is_ok_and(|ident| ident.as_ref() == name)
        && parser.expect_exhausted().is_ok()
}

fn known_name(name: &str) -> bool {
    matches!(name, "float" | "clear" | "content")
        || !matches!(PropertyId::from(name), PropertyId::Custom(_))
}

fn content_value(value: &str) -> Option<String> {
    let mut input = ParserInput::new(value);
    let mut parser = Parser::new(&mut input);
    if let Ok(keyword) = parser.try_parse(|input| {
        let keyword = input.expect_ident_cloned()?;
        input.expect_exhausted()?;
        Ok::<_, cssparser::BasicParseError<'_>>(keyword)
    }) {
        return matches!(
            keyword.to_ascii_lowercase().as_str(),
            "none" | "normal" | "open-quote" | "close-quote" | "no-open-quote" | "no-close-quote"
        )
        .then(|| keyword.to_ascii_lowercase());
    }
    let mut count = 0_usize;
    let mut alternative = false;
    while !parser.is_exhausted() {
        if !alternative
            && parser
                .try_parse(|input| {
                    let image = Image::parse(input)?;
                    if matches!(image, Image::None) {
                        return Err(
                            input.new_error(cssparser::BasicParseErrorKind::QualifiedRuleInvalid)
                        );
                    }
                    Ok(())
                })
                .is_ok()
        {
            count = count.saturating_add(1);
            continue;
        }
        match parser.next().ok()?.clone() {
            Token::QuotedString(_) => {}
            Token::UnquotedUrl(_) if !alternative => {}
            Token::Ident(name)
                if !alternative
                    && matches!(
                        name.to_ascii_lowercase().as_str(),
                        "open-quote" | "close-quote" | "no-open-quote" | "no-close-quote"
                    ) => {}
            Token::Delim('/') if !alternative && count > 0 => {
                alternative = true;
                count = 0;
                continue;
            }
            Token::Function(name) if name.eq_ignore_ascii_case("url") && !alternative => {
                parser
                    .parse_nested_block(|input| {
                        input.expect_string()?;
                        input.expect_exhausted()?;
                        Ok::<_, ParseError<'_, ()>>(())
                    })
                    .ok()?;
            }
            Token::Function(name) if name.eq_ignore_ascii_case("attr") => {
                parser
                    .parse_nested_block(|input| {
                        input.expect_ident()?;
                        input.expect_exhausted()?;
                        Ok::<_, ParseError<'_, ()>>(())
                    })
                    .ok()?;
            }
            Token::Function(name)
                if name.eq_ignore_ascii_case("counter")
                    || name.eq_ignore_ascii_case("counters") =>
            {
                parser
                    .parse_nested_block(|input| {
                        input.expect_ident()?;
                        if name.eq_ignore_ascii_case("counters") {
                            input.expect_comma()?;
                            input.expect_string()?;
                        }
                        if input.try_parse(Parser::expect_comma).is_ok() {
                            input.expect_ident()?;
                        }
                        input.expect_exhausted()?;
                        Ok::<_, ParseError<'_, ()>>(())
                    })
                    .ok()?;
            }
            _ => return None,
        }
        count = count.saturating_add(1);
    }
    (count > 0).then(|| value.to_owned())
}

fn trimmed(value: &str) -> Option<&str> {
    let mut input = ParserInput::new(value);
    let mut parser = Parser::new(&mut input);
    let mut start = None;
    let mut end = parser.position();
    while !parser.is_exhausted() {
        let position = parser.position();
        match parser
            .next_including_whitespace_and_comments()
            .ok()?
            .clone()
        {
            Token::WhiteSpace(_) | Token::Comment(_) => continue,
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                parser
                    .parse_nested_block(|input| components(input, 0, false))
                    .ok()?;
            }
            _ => {}
        }
        start.get_or_insert(position);
        end = parser.position();
    }
    Some(start.map_or("", |start| parser.slice(start..end)))
}

pub(crate) fn wide_keyword(value: &str) -> Option<String> {
    let mut input = ParserInput::new(value);
    let mut parser = Parser::new(&mut input);
    let keyword = parser.expect_ident().ok()?.to_ascii_lowercase();
    parser.expect_exhausted().ok()?;
    matches!(
        keyword.as_str(),
        "inherit" | "initial" | "unset" | "revert" | "revert-layer"
    )
    .then_some(keyword)
}

fn animation_longhand<'i>(parsed: &Property<'i>, id: &PropertyId<'_>) -> Option<Property<'i>> {
    parsed.longhand(id).or_else(|| match (parsed, id) {
        // The parser's prefixed shorthand guard omits this unprefixed field
        // even for an ordinary animation.
        (Property::Animation(values, _), PropertyId::AnimationTimeline) => {
            Some(Property::AnimationTimeline(
                values.iter().map(|value| value.timeline.clone()).collect(),
            ))
        }
        _ => None,
    })
}

fn expand(name: &str, value: &str, important: bool) -> Option<Vec<Entry>> {
    let value = trimmed(value)?;
    let id = PropertyId::from(name);
    if !known_name(name) && !custom_name(name) {
        return None;
    }
    if name == "--" || (value.is_empty() && !custom_name(name)) {
        return None;
    }
    if let Some(wide) = wide_keyword(value) {
        return Some(id.longhands().map_or_else(
            || vec![Entry::new(name, wide.clone(), important)],
            |ids| {
                ids.iter()
                    .map(|id| Entry::new(id.name(), wide.clone(), important))
                    .collect()
            },
        ));
    }
    let deferred = deferred_value(value)?;
    if deferred && !custom_name(name) {
        let pending = Rc::new(Pending {
            name: name.to_owned(),
            value: value.to_owned(),
        });
        return Some(id.longhands().map_or_else(
            || {
                vec![Entry {
                    name: name.to_owned(),
                    value: value.to_owned(),
                    important,
                    pending: None,
                    deferred: true,
                }]
            },
            |ids| {
                ids.iter()
                    .map(|id| Entry {
                        name: id.name().to_owned(),
                        value: String::new(),
                        important,
                        pending: Some(Rc::clone(&pending)),
                        deferred: true,
                    })
                    .collect()
            },
        ));
    }
    if custom_name(name) {
        return Some(vec![Entry {
            name: name.to_owned(),
            value: value.to_owned(),
            important,
            pending: None,
            deferred,
        }]);
    }
    if matches!(name, "float" | "clear") {
        return Some(vec![Entry::new(
            name,
            native_keyword(name, value)?,
            important,
        )]);
    }
    if name == "content" {
        return Some(vec![Entry::new(name, content_value(value)?, important)]);
    }
    let parsed = Property::parse_string(id.clone(), value, ParserOptions::default()).ok()?;
    // The transformer accepts invalid ordinary values as Unparsed. Only the
    // syntax-checked variable branch above may bypass a property's typed grammar.
    if matches!(parsed, Property::Unparsed(_)) {
        return None;
    }
    id.longhands().map_or_else(
        || {
            Some(vec![Entry::new(
                name,
                parsed.value_to_css_string(PrinterOptions::default()).ok()?,
                important,
            )])
        },
        |ids| {
            ids.iter()
                .map(|id| {
                    Some(Entry::new(
                        id.name(),
                        animation_longhand(&parsed, id)?
                            .value_to_css_string(PrinterOptions::default())
                            .ok()?,
                        important,
                    ))
                })
                .collect()
        },
    )
}

#[derive(Default)]
struct ListParser;
impl<'i> DeclarationParser<'i> for ListParser {
    type Declaration = (String, Vec<Entry>);
    type Error = ();
    fn parse_value<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
        _start: &ParserState,
    ) -> Result<Self::Declaration, ParseError<'i, Self::Error>> {
        let start = input.position();
        input.parse_until_before(Delimiter::Bang, |value| components(value, 0, true))?;
        let value = input.slice_from(start);
        let important = input.try_parse(parse_important).is_ok();
        input.expect_exhausted()?;
        let name = property_name(&name);
        let entries = expand(&name, value, important).ok_or_else(|| input.new_custom_error(()))?;
        Ok((name, entries))
    }
}
impl AtRuleParser<'_> for ListParser {
    type Prelude = ();
    type AtRule = (String, Vec<Entry>);
    type Error = ();
}
impl QualifiedRuleParser<'_> for ListParser {
    type Prelude = ();
    type QualifiedRule = (String, Vec<Entry>);
    type Error = ();
}
impl RuleBodyItemParser<'_, (String, Vec<Entry>), ()> for ListParser {
    fn parse_declarations(&self) -> bool {
        true
    }
    fn parse_qualified(&self) -> bool {
        false
    }
}

impl Declarations {
    pub(crate) fn supported(name: &str, value: &str) -> bool {
        let Some(entries) = expand(&property_name(name), value, false) else {
            return false;
        };
        crate::layout::supports(&Self {
            entries,
            shorthands: Vec::new(),
        })
    }
    pub(crate) fn cascade<'a>(
        sources: impl IntoIterator<Item = (&'a Self, bool, u32, &'a [usize])>,
    ) -> Result<Self, &'static str> {
        let mut winners = std::collections::HashMap::new();
        for (source, inline, specificity, layer) in sources {
            for entry in &source.entries {
                let order: Vec<_> = layer
                    .iter()
                    .map(|value| {
                        if entry.important {
                            usize::MAX.saturating_sub(*value)
                        } else {
                            *value
                        }
                    })
                    .collect();
                let rank = (entry.important, inline, order, specificity);
                let winner = winners
                    .entry(entry.name.clone())
                    .or_insert_with(|| (rank.clone(), entry.clone()));
                if rank >= winner.0 {
                    *winner = (rank, entry.clone());
                }
                if winners.len() > ENTRY_LIMIT {
                    return Err("CSS declaration limit");
                }
            }
        }
        Ok(Self {
            entries: winners.into_values().map(|(_rank, entry)| entry).collect(),
            shorthands: Vec::new(),
        })
    }
    pub(crate) fn layout_entries(&self) -> impl Iterator<Item = (&str, &str, bool)> {
        self.entries
            .iter()
            .map(|entry| (entry.name.as_str(), entry.value.as_str(), entry.deferred))
    }
    pub(crate) fn parse(source: &str) -> Result<Self, &'static str> {
        if source.len() > INPUT_LIMIT {
            return Err("CSS input limit");
        }
        let mut result = Self::default();
        let mut input = ParserInput::new(source);
        let mut parser = Parser::new(&mut input);
        for (name, entries) in RuleBodyParser::new(&mut parser, &mut ListParser).flatten() {
            result.remember(&name);
            for entry in entries {
                result.put(entry, true)?;
            }
        }
        Ok(result)
    }
    fn remember(&mut self, name: &str) {
        if PropertyId::from(name).longhands().is_some()
            && !self.shorthands.iter().any(|old| old == name)
        {
            self.shorthands.push(name.to_owned());
        }
    }
    fn put(&mut self, entry: Entry, cascading: bool) -> Result<(), &'static str> {
        if let Some(old) = self.entries.iter_mut().find(|old| old.name == entry.name) {
            if !cascading || entry.important || !old.important {
                *old = entry;
            }
        } else {
            if self.entries.len() >= ENTRY_LIMIT {
                return Err("CSS declaration limit");
            }
            self.entries.push(entry);
        }
        Ok(())
    }
    pub(crate) fn value(&self, name: &str) -> (String, bool) {
        self.get(name)
    }
    pub(crate) fn clear_animation_controls(&mut self) {
        self.entries
            .retain(|entry| !entry.name.starts_with("animation-"));
    }
    pub(crate) fn animate(&mut self, name: &str, value: &str) -> crate::Result<()> {
        if self.get(name).1 {
            return Ok(());
        }
        let entries = expand(name, value, false).ok_or_else(|| {
            crate::Error::Dom("layout unsupported: animation interpolated declaration".into())
        })?;
        for entry in entries {
            self.put(entry, false)
                .map_err(|message| crate::Error::Dom(message.into()))?;
        }
        Ok(())
    }
    fn get(&self, name: &str) -> (String, bool) {
        if let Some(entry) = self.entries.iter().find(|entry| entry.name == name) {
            return (
                if entry.pending.is_some() {
                    String::new()
                } else {
                    entry.value.clone()
                },
                entry.important,
            );
        }
        let id = PropertyId::from(name);
        let Some(ids) = id.longhands() else {
            return (String::new(), false);
        };
        let entries: Option<Vec<_>> = ids
            .iter()
            .map(|id| self.entries.iter().find(|entry| entry.name == id.name()))
            .collect();
        let Some(entries) = entries else {
            return (String::new(), false);
        };
        let Some(first) = entries.first() else {
            return (String::new(), false);
        };
        if entries
            .iter()
            .any(|entry| entry.important != first.important)
        {
            return (String::new(), false);
        }
        if let Some(pending) = &first.pending
            && pending.name == name
            && entries
                .iter()
                .all(|entry| entry.pending.as_deref() == Some(pending.as_ref()))
        {
            return (pending.value.clone(), first.important);
        }
        if entries
            .iter()
            .any(|entry| entry.deferred || entry.pending.is_some())
        {
            return (String::new(), false);
        }
        if entries.iter().all(|entry| entry.value == first.value)
            && matches!(
                first.value.as_str(),
                "inherit" | "initial" | "unset" | "revert" | "revert-layer"
            )
        {
            return (first.value.clone(), first.important);
        }
        let mut block = DeclarationBlock::default();
        for entry in &entries {
            let Ok(property) = Property::parse_string(
                PropertyId::from(entry.name.as_str()),
                &entry.value,
                ParserOptions::default(),
            ) else {
                return (String::new(), false);
            };
            block.declarations.push(property);
        }
        block
            .get(&id)
            .and_then(|(value, _important)| {
                value.value_to_css_string(PrinterOptions::default()).ok()
            })
            .map_or_else(|| (String::new(), false), |value| (value, first.important))
    }
    fn css_text(&self) -> String {
        let mut seen = Vec::new();
        let mut declarations = Vec::new();
        for entry in &self.entries {
            if seen.contains(&entry.name) {
                continue;
            }
            let shorthand = self.shorthands.iter().find_map(|name| {
                let ids = PropertyId::from(name.as_str()).longhands()?;
                if !ids.iter().any(|id| id.name() == entry.name)
                    || ids
                        .iter()
                        .any(|id| seen.iter().any(|name| name == id.name()))
                {
                    return None;
                }
                let (value, important) = self.get(name);
                if value.is_empty() {
                    return None;
                }
                Some((name, value, important, ids))
            });
            let (name, value, important) = if let Some((name, value, important, ids)) = shorthand {
                // Property identifiers returned by longhands are static.
                seen.extend(ids.iter().map(|id| id.name().to_owned()));
                (name.as_str(), value, important)
            } else {
                seen.push(entry.name.clone());
                (entry.name.as_str(), entry.value.clone(), entry.important)
            };
            declarations.push(format!(
                "{name}: {value}{};",
                if important { " !important" } else { "" }
            ));
        }
        declarations.join(" ")
    }
}

#[derive(Serialize)]
pub(crate) struct Output {
    entries: Vec<Entry>,
    pub(crate) css_text: String,
    value: String,
    important: bool,
    pub(crate) changed: bool,
}

#[derive(Deserialize)]
struct Request {
    name: String,
    value: String,
    priority: String,
}

pub(crate) fn call(
    declarations: &mut Declarations,
    operation: &str,
    request: &str,
) -> Result<Output, &'static str> {
    let request: Request = serde_json::from_str(request).map_err(|_error| "invalid CSS request")?;
    mutate(
        declarations,
        operation,
        &request.name,
        &request.value,
        &request.priority,
    )
}

fn mutate(
    declarations: &mut Declarations,
    operation: &str,
    name: &str,
    value: &str,
    priority: &str,
) -> Result<Output, &'static str> {
    if name.len() > INPUT_LIMIT || value.len() > INPUT_LIMIT || priority.len() > INPUT_LIMIT {
        return Err("CSS input limit");
    }
    let before = declarations.entries.clone();
    let name = property_name(name);
    let (old_value, old_important) = declarations.get(&name);
    match operation {
        "text" => *declarations = Declarations::parse(value)?,
        "remove" => {
            let ids = PropertyId::from(name.as_str()).longhands();
            declarations.entries.retain(|entry| {
                entry.name != name
                    && !ids
                        .as_ref()
                        .is_some_and(|ids| ids.iter().any(|id| id.name() == entry.name))
            });
        }
        "set" if value.is_empty() => {
            return mutate(declarations, "remove", &name, "", "");
        }
        "set" if priority.is_empty() || priority.eq_ignore_ascii_case("important") => {
            let mut input = ParserInput::new(value);
            let mut parser = Parser::new(&mut input);
            if parser
                .parse_until_before(Delimiter::Bang | Delimiter::Semicolon, |input| {
                    components(input, 0, true)
                })
                .is_ok()
                && parser.expect_exhausted().is_ok()
                && let Some(entries) = expand(&name, value, !priority.is_empty())
            {
                declarations.remember(&name);
                for entry in entries {
                    declarations.put(entry, false)?;
                }
            }
        }
        "get" | "name" | "set" => {}
        _ => return Err("unknown CSS operation"),
    }
    let changed = before != declarations.entries;
    let (result_value, important) = if operation == "name" {
        (
            if name != "--" && (known_name(&name) || custom_name(&name)) {
                "true".to_owned()
            } else {
                String::new()
            },
            false,
        )
    } else if operation == "remove" {
        (old_value, old_important)
    } else {
        declarations.get(&name)
    };
    Ok(Output {
        css_text: declarations.css_text(),
        entries: declarations.entries.clone(),
        value: result_value,
        important,
        changed,
    })
}

impl Declarations {
    pub(crate) fn compact(&mut self) {
        self.entries.shrink_to_fit();
        self.shorthands.shrink_to_fit();
    }
    pub(crate) fn bytes(&self) -> usize {
        let base = self
            .shorthands
            .iter()
            .fold(size_of::<Self>(), |bytes, name| {
                bytes
                    .saturating_add(size_of::<String>())
                    .saturating_add(name.capacity())
            })
            .saturating_add(self.entries.capacity().saturating_mul(size_of::<Entry>()));
        self.entries.iter().fold(base, |bytes, entry| {
            bytes
                .saturating_add(entry.name.capacity())
                .saturating_add(entry.value.capacity())
                .saturating_add(entry.pending.as_ref().map_or(0, |pending| {
                    size_of::<Pending>()
                        .saturating_add(pending.name.capacity())
                        .saturating_add(pending.value.capacity())
                }))
        })
    }
}

#[cfg(test)]
fn operate(
    operation: &str,
    source: &str,
    name: &str,
    value: &str,
    priority: &str,
) -> Result<Output, &'static str> {
    mutate(
        &mut Declarations::parse(source)?,
        operation,
        name,
        value,
        priority,
    )
}

#[cfg(test)]
mod tests {
    use super::{Declarations, mutate, operate};
    #[test]
    fn priority_order_invalid_and_shorthands() -> Result<(), &'static str> {
        let output = operate(
            "get",
            "width: 1px !important; height: 2px; width: 3px; margin: 1px 2px; invalid: 9; height: nonsense",
            "margin",
            "",
            "",
        )?;
        assert_eq!(output.value, "1px 2px");
        assert_eq!(
            output.css_text,
            "width: 1px !important; height: 2px; margin: 1px 2px;"
        );
        let changed = operate("set", &output.css_text, "width", "4px", "")?;
        assert_eq!(
            changed.css_text,
            "width: 4px; height: 2px; margin: 1px 2px;"
        );
        assert!(changed.changed);
        let invalid = operate("set", &changed.css_text, "width", "5px !important", "")?;
        assert!(!invalid.changed);
        let removed = operate("remove", &changed.css_text, "margin", "", "")?;
        assert_eq!(removed.value, "1px 2px");
        assert_eq!(removed.css_text, "width: 4px; height: 2px;");
        Ok(())
    }
    #[test]
    fn malformed_custom_names_and_values_are_atomic() -> Result<(), &'static str> {
        for name in [
            "--",
            "--x y",
            "--x; width",
            "--x: height",
            "--x\0",
            "--x\n",
            "--x)",
        ] {
            let result = operate("set", "width: 1px", name, "2px", "")?;
            assert!(!result.changed, "{name:?}");
            assert_eq!(result.css_text, "width: 1px;");
        }
        for variant in 0_u32..64 {
            let value = format!("{}px", variant.saturating_add(1));
            let result = operate("set", "", "width", &value, "important")?;
            assert_eq!(result.value, value);
            assert!(result.important);
            for invalid in ["nope", "1px; height: 2px", "1px !important", "\"broken"] {
                let rejected = operate("set", &result.css_text, "width", invalid, "")?;
                assert!(!rejected.changed, "{invalid:?}");
                assert_eq!(rejected.value, value);
            }
        }
        Ok(())
    }
    #[test]
    fn variable_grammar_preserves_values_and_rejects_invalid_references() -> Result<(), &'static str>
    {
        for value in [
            "var(--x)",
            "VAR(--x,)",
            "env(foo 0 1, var(--x,))",
            "env(initial)",
            "calc(var(--x) + 1px)",
        ] {
            let result = operate("set", "", "width", value, "")?;
            assert_eq!(result.value, value);
        }
        for value in [
            "var(--)",
            "var(x)",
            "env(foo -1)",
            "env(foo 1.5)",
            "var(--x, !bad)",
            "var(--x, ;)",
            "var(--x, var(bad))",
        ] {
            let result = operate("set", "width: 1px", "width", value, "")?;
            assert!(!result.changed, "{value}");
            assert_eq!(result.value, "1px");
        }
        Ok(())
    }
    #[test]
    fn pending_shorthands_survive_native_state_and_reset_on_reparse() -> Result<(), &'static str> {
        let mut state = Declarations::parse("margin: var(--x) !important")?;
        assert_eq!(
            mutate(&mut state, "get", "margin", "", "")?.value,
            "var(--x)"
        );
        assert_eq!(mutate(&mut state, "get", "margin-top", "", "")?.value, "");
        let output = mutate(&mut state, "set", "margin-top", "3px", "")?;
        assert_eq!(
            output.css_text,
            "margin-top: 3px; margin-right:  !important; margin-bottom:  !important; margin-left:  !important;"
        );
        assert_eq!(output.entries.len(), 4);
        assert_eq!(mutate(&mut state, "get", "margin-right", "", "")?.value, "");
        assert!(mutate(&mut state, "get", "margin-right", "", "")?.important);
        assert_eq!(Declarations::parse(&output.css_text)?.entries.len(), 1);
        Ok(())
    }
    #[test]
    fn custom_properties_and_wide_keywords() -> Result<(), &'static str> {
        let output = operate(
            "get",
            "--A: one; --a: two; --A: three !important; padding: INHERIT",
            "padding",
            "",
            "",
        )?;
        assert_eq!(output.value, "inherit");
        assert_eq!(
            output.css_text,
            "--A: three !important; --a: two; padding: inherit;"
        );
        assert_eq!(
            operate("get", &output.css_text, "--A", "", "")?.value,
            "three"
        );
        let output = operate("set", &output.css_text, "--A", "", "invalid")?;
        assert!(output.changed);
        assert_eq!(output.css_text, "--a: two; padding: inherit;");
        Ok(())
    }
}

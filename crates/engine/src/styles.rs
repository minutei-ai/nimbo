use cssparser::{
    AtRuleParser, CowRcStr, DeclarationParser, Delimiter, ParseError, Parser, ParserInput,
    ParserState, QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser, Token, parse_important,
};
use lightningcss::{
    declaration::DeclarationBlock,
    properties::{Property, PropertyId},
    stylesheet::{ParserOptions, PrinterOptions},
};
use rquickjs::{Ctx, Exception, Function};
use serde::Serialize;

const INPUT_LIMIT: usize = 65_536;
const ENTRY_LIMIT: usize = 1024;
const DEPTH_LIMIT: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct Entry {
    name: String,
    value: String,
    important: bool,
}

#[derive(Default)]
struct Declarations {
    entries: Vec<Entry>,
    shorthands: Vec<String>,
}

// Tokenize before invoking the grammar parser, bounding recursion and rejecting
// bad strings/URLs rather than accepting the transformer's unparsed fallback.
fn components<'i>(input: &mut Parser<'i, '_>, depth: usize) -> Result<(), ParseError<'i, ()>> {
    if depth > DEPTH_LIMIT {
        return Err(input.new_custom_error(()));
    }
    while !input.is_exhausted() {
        match input.next_including_whitespace_and_comments()? {
            Token::BadString(_)
            | Token::BadUrl(_)
            | Token::CloseParenthesis
            | Token::CloseSquareBracket
            | Token::CloseCurlyBracket => {
                return Err(input.new_custom_error(()));
            }
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                input.parse_nested_block(|nested| components(nested, depth.saturating_add(1)))?;
            }
            _ => {}
        }
    }
    Ok(())
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
    matches!(name, "float" | "clear") || !matches!(PropertyId::from(name), PropertyId::Custom(_))
}

fn expand(name: &str, value: &str, important: bool) -> Option<Vec<Entry>> {
    let id = PropertyId::from(name);
    if !known_name(name) && !custom_name(name) {
        return None;
    }
    if name == "--" || value.is_empty() {
        return None;
    }
    let wide = value.to_ascii_lowercase();
    if matches!(
        wide.as_str(),
        "inherit" | "initial" | "unset" | "revert" | "revert-layer"
    ) {
        return Some(id.longhands().map_or_else(
            || {
                vec![Entry {
                    name: name.to_owned(),
                    value: wide.clone(),
                    important,
                }]
            },
            |ids| {
                ids.iter()
                    .map(|id| Entry {
                        name: id.name().to_owned(),
                        value: wide.clone(),
                        important,
                    })
                    .collect()
            },
        ));
    }
    if matches!(name, "float" | "clear") {
        return Some(vec![Entry {
            name: name.to_owned(),
            value: native_keyword(name, value)?,
            important,
        }]);
    }
    let parsed = Property::parse_string(id.clone(), value, ParserOptions::default()).ok()?;
    // Lightning CSS deliberately falls back to Unparsed even for invalid known
    // values. CSSOM must reject these. Deferred var()/env() values are not yet
    // implemented here and are not advertised as computed or validated values.
    if matches!(parsed, Property::Unparsed(_)) {
        return None;
    }
    if name.starts_with("--") {
        return Some(vec![Entry {
            name: name.to_owned(),
            value: value.to_owned(),
            important,
        }]);
    }
    id.longhands().map_or_else(
        || {
            Some(vec![Entry {
                name: name.to_owned(),
                value: parsed.value_to_css_string(PrinterOptions::default()).ok()?,
                important,
            }])
        },
        |ids| {
            ids.iter()
                .map(|id| {
                    Some(Entry {
                        name: id.name().to_owned(),
                        value: parsed
                            .longhand(id)?
                            .value_to_css_string(PrinterOptions::default())
                            .ok()?,
                        important,
                    })
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
        input.parse_until_before(Delimiter::Bang, |value| components(value, 0))?;
        let value = input.slice_from(start).trim();
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
    fn parse(source: &str) -> Result<Self, &'static str> {
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
    fn get(&self, name: &str) -> (String, bool) {
        if let Some(entry) = self.entries.iter().find(|entry| entry.name == name) {
            return (entry.value.clone(), entry.important);
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
struct Output {
    entries: Vec<Entry>,
    css_text: String,
    value: String,
    important: bool,
    changed: bool,
}

fn operate(
    operation: &str,
    source: &str,
    name: &str,
    value: &str,
    priority: &str,
) -> Result<Output, &'static str> {
    if name.len() > INPUT_LIMIT || value.len() > INPUT_LIMIT || priority.len() > INPUT_LIMIT {
        return Err("CSS input limit");
    }
    let mut declarations = Declarations::parse(source)?;
    let before = declarations.entries.clone();
    let name = property_name(name);
    let (old_value, old_important) = declarations.get(&name);
    match operation {
        "text" => declarations = Declarations::parse(value)?,
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
            return operate("remove", source, &name, "", "");
        }
        "set" if priority.is_empty() || priority.eq_ignore_ascii_case("important") => {
            let mut input = ParserInput::new(value);
            let mut parser = Parser::new(&mut input);
            if parser
                .parse_until_before(Delimiter::Bang | Delimiter::Semicolon, |input| {
                    components(input, 0)
                })
                .is_ok()
                && parser.expect_exhausted().is_ok()
                && let Some(entries) = expand(&name, value.trim(), !priority.is_empty())
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
        entries: declarations.entries,
        value: result_value,
        important,
        changed,
    })
}

pub(crate) fn install(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    ctx.globals().set(
        "nimboStyle",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'_>,
             operation: String,
             source: String,
             name: String,
             value: String,
             priority: String| {
                let output = operate(&operation, &source, &name, &value, &priority)
                    .map_err(|message| Exception::throw_message(&ctx, message))?;
                serde_json::to_string(&output)
                    .map_err(|_error| Exception::throw_message(&ctx, "CSS serialization"))
            },
        )?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::operate;
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
            for invalid in [
                "nope",
                "1px; height: 2px",
                "1px !important",
                "\"broken",
                "var(--missing)",
            ] {
                let rejected = operate("set", &result.css_text, "width", invalid, "")?;
                assert!(!rejected.changed, "{invalid:?}");
                assert_eq!(rejected.value, value);
            }
        }
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

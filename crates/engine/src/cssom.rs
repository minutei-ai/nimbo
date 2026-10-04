//! Native constructed stylesheet state. Document association is a separate step.
use crate::{Error, Result, styles::Declarations};
use cssparser::{
    AtRuleParser, CowRcStr, ParseError, Parser, ParserInput, ParserState, QualifiedRuleParser,
    parse_one_rule,
};
use lightningcss::{
    selector::SelectorList,
    stylesheet::{ParserOptions, PrinterOptions},
    traits::{ParseWithOptions, ToCss},
};
use serde_json::{Value, json};

const RULES: usize = 4096;
const SHEETS: usize = 256;
const BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
struct Sheet {
    rules: Vec<usize>,
    disabled: bool,
}
#[derive(Clone)]
struct Rule {
    selector: String,
    style: Declarations,
    parent: Option<usize>,
}
#[derive(Default)]
pub(crate) struct Arena {
    sheets: Vec<Sheet>,
    rules: Vec<Rule>,
    bytes: usize,
}

fn exception(name: &str) -> Value {
    json!({"exception": name})
}
fn selector(source: &str) -> Option<String> {
    let list = SelectorList::parse_string_with_options(source, ParserOptions::default()).ok()?;
    if list.0.len() > 64
        || list
            .0
            .iter()
            .any(|s| crate::cascade::unknown_selector(s) || crate::cascade::forgiving_unknown(s))
    {
        return None;
    }
    list.to_css_string(PrinterOptions::default()).ok()
}
struct RuleParser;
impl<'i> AtRuleParser<'i> for RuleParser {
    type Prelude = ();
    type AtRule = Rule;
    type Error = &'static str;
    fn parse_prelude<'t>(
        &mut self,
        _name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<(), ParseError<'i, Self::Error>> {
        Err(input.new_custom_error("NotSupportedError"))
    }
}
impl<'i> QualifiedRuleParser<'i> for RuleParser {
    type Prelude = String;
    type QualifiedRule = Rule;
    type Error = &'static str;
    fn parse_prelude<'t>(
        &mut self,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<String, ParseError<'i, Self::Error>> {
        let start = input.position();
        crate::styles::components(input, 0, false)
            .map_err(|_error| input.new_custom_error("SyntaxError"))?;
        selector(input.slice_from(start)).ok_or_else(|| input.new_custom_error("SyntaxError"))
    }
    fn parse_block<'t>(
        &mut self,
        selector: String,
        _start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<Rule, ParseError<'i, Self::Error>> {
        let start = input.position();
        while !input.is_exhausted() {
            let token = input.next()?.clone();
            if matches!(token, cssparser::Token::CurlyBracketBlock) {
                return Err(input.new_custom_error("NotSupportedError"));
            }
            if matches!(
                token,
                cssparser::Token::Function(_)
                    | cssparser::Token::ParenthesisBlock
                    | cssparser::Token::SquareBracketBlock
            ) {
                input
                    .parse_nested_block(|nested| crate::styles::components(nested, 0, false))
                    .map_err(|_error| input.new_custom_error("SyntaxError"))?;
            }
        }
        let style = Declarations::parse(input.slice_from(start))
            .map_err(|_error| input.new_custom_error("SyntaxError"))?;
        Ok(Rule {
            selector,
            style,
            parent: None,
        })
    }
}
fn parse(source: &str) -> std::result::Result<Rule, &'static str> {
    let mut input = ParserInput::new(source);
    parse_one_rule(&mut Parser::new(&mut input), &mut RuleParser).map_err(|error| {
        match error.kind {
            cssparser::ParseErrorKind::Custom(name) => name,
            cssparser::ParseErrorKind::Basic(_) => "SyntaxError",
        }
    })
}
impl Rule {
    fn bytes(&self) -> usize {
        self.selector.len().saturating_add(self.style.bytes())
    }
    fn text(&self) -> String {
        let style = self.style.css_text();
        if style.is_empty() {
            format!("{} {{ }}", self.selector)
        } else {
            format!("{} {{ {style} }}", self.selector)
        }
    }
}
impl Arena {
    fn mutate(&mut self, operation: &str, id: usize, arg: &str, value: &str) -> Result<Value> {
        let rule = self
            .rules
            .get(id)
            .ok_or_else(|| Error::Dom("invalid CSSOM rule".into()))?;
        let old_bytes = rule.bytes();
        let mut next = rule.clone();
        let output = if operation == "selector" {
            if let Some(selector) = selector(value) {
                next.selector = selector;
            }
            Value::Null
        } else {
            serde_json::to_value(
                crate::styles::call(&mut next.style, arg, value)
                    .map_err(|message| Error::Dom(message.into()))?,
            )?
        };
        let bytes = self
            .bytes
            .saturating_sub(old_bytes)
            .saturating_add(next.bytes());
        if bytes > BYTES {
            return Err(Error::Limit("CSSOM state"));
        }
        *self
            .rules
            .get_mut(id)
            .ok_or_else(|| Error::Dom("invalid CSSOM rule".into()))? = next;
        self.bytes = bytes;
        Ok(output)
    }

    pub(crate) fn call(
        &mut self,
        operation: &str,
        id: usize,
        arg: &str,
        value: &str,
    ) -> Result<Value> {
        if arg.len() > 65_536 || value.len() > 65_536 {
            return Err(Error::Limit("CSSOM input"));
        }
        match operation {
            "new" => {
                if self.sheets.len() >= SHEETS {
                    return Err(Error::Limit("CSSOM sheets"));
                }
                let id = self.sheets.len();
                self.sheets.push(Sheet::default());
                Ok(json!(id))
            }
            "sheet" => {
                let sheet = self
                    .sheets
                    .get(id)
                    .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?;
                Ok(json!({"rules":sheet.rules,"disabled":sheet.disabled}))
            }
            "disabled" => {
                self.sheets
                    .get_mut(id)
                    .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?
                    .disabled = value == "true";
                Ok(Value::Null)
            }
            "insert" => {
                let index = arg
                    .parse::<usize>()
                    .map_err(|_error| Error::Dom("invalid CSSOM index".into()))?;
                let sheet = self
                    .sheets
                    .get(id)
                    .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?;
                if index > sheet.rules.len() {
                    return Ok(exception("IndexSizeError"));
                }
                let mut rule = match parse(value) {
                    Ok(rule) => rule,
                    Err(name) => return Ok(exception(name)),
                };
                let bytes = self.bytes.saturating_add(rule.bytes());
                if self.rules.len() >= RULES || bytes > BYTES {
                    return Err(Error::Limit("CSSOM state"));
                }
                rule.parent = Some(id);
                let rule_id = self.rules.len();
                self.sheets
                    .get_mut(id)
                    .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?
                    .rules
                    .insert(index, rule_id);
                self.rules.push(rule);
                self.bytes = bytes;
                Ok(json!(index))
            }
            "delete" => {
                let index = arg
                    .parse::<usize>()
                    .map_err(|_error| Error::Dom("invalid CSSOM index".into()))?;
                let sheet = self
                    .sheets
                    .get_mut(id)
                    .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?;
                let Some(rule_id) = sheet.rules.get(index).copied() else {
                    return Ok(exception("IndexSizeError"));
                };
                sheet.rules.remove(index);
                self.rules
                    .get_mut(rule_id)
                    .ok_or_else(|| Error::Dom("invalid CSSOM rule".into()))?
                    .parent = None;
                Ok(Value::Null)
            }
            "rule" => {
                let rule = self
                    .rules
                    .get(id)
                    .ok_or_else(|| Error::Dom("invalid CSSOM rule".into()))?;
                Ok(json!({"selector":rule.selector,"cssText":rule.text(),"parent":rule.parent}))
            }
            "selector" | "style" => self.mutate(operation, id, arg, value),
            _ => Err(Error::Dom("unknown CSSOM operation".into())),
        }
    }
}

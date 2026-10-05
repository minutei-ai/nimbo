//! Native constructed stylesheet state and document adoption.
use crate::{Error, Result, styles::Declarations};
use cssparser::{
    AtRuleParser, CowRcStr, ParseError, Parser, ParserInput, ParserState, QualifiedRuleParser,
    StyleSheetParser, parse_one_rule,
};
use dom_query::NodeId;
use lightningcss::{
    selector::SelectorList,
    stylesheet::{ParserOptions, PrinterOptions},
    traits::{ParseWithOptions, ToCss},
};
use serde_json::{Value, json};
use std::collections::HashMap;

const RULES: usize = 4096;
const SHEETS: usize = 256;
const BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
struct Sheet {
    rules: Vec<usize>,
    disabled: bool,
    owner: Option<usize>,
    replacing: bool,
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
    adopted: Vec<usize>,
    owners: HashMap<NodeId, (String, usize)>,
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
struct RuleParser {
    strict_supported: bool,
}
impl<'i> AtRuleParser<'i> for RuleParser {
    type Prelude = ();
    type AtRule = Rule;
    type Error = &'static str;
    fn parse_prelude<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<(), ParseError<'i, Self::Error>> {
        let known = [
            "media",
            "supports",
            "container",
            "layer",
            "scope",
            "font-face",
            "keyframes",
            "property",
            "page",
            "namespace",
            "import",
            "counter-style",
            "starting-style",
        ]
        .iter()
        .any(|keyword| name.eq_ignore_ascii_case(keyword));
        Err(input.new_custom_error(if known {
            "NotSupportedError"
        } else {
            "SyntaxError"
        }))
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
        let source = input.slice_from(start);
        if self.strict_supported
            && let Ok(selectors) =
                SelectorList::parse_string_with_options(source, ParserOptions::default())
            && selectors.0.iter().any(|selector| {
                crate::cascade::unknown_selector(selector)
                    || crate::cascade::forgiving_unknown(selector)
            })
        {
            return Err(input.new_custom_error("NotSupportedError"));
        }
        selector(source).ok_or_else(|| input.new_custom_error("SyntaxError"))
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
    parse_one_rule(
        &mut Parser::new(&mut input),
        &mut RuleParser {
            strict_supported: false,
        },
    )
    .map_err(|error| match error.kind {
        cssparser::ParseErrorKind::Custom(name) => name,
        cssparser::ParseErrorKind::Basic(_) => "SyntaxError",
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
fn parse_sheet(source: &str) -> Result<Vec<Rule>> {
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let mut rules = Vec::new();
    for result in StyleSheetParser::new(
        &mut parser,
        &mut RuleParser {
            strict_supported: true,
        },
    ) {
        match result {
            Ok(rule) => rules.push(rule),
            Err((error, _))
                if matches!(
                    error.kind,
                    cssparser::ParseErrorKind::Custom("NotSupportedError")
                ) =>
            {
                return Err(Error::Unsupported("CSSOM grouping and at-rules".into()));
            }
            Err(_) => {}
        }
        if rules.len() > RULES {
            return Err(Error::Limit("CSSOM rules"));
        }
    }
    Ok(rules)
}

impl Arena {
    pub(crate) fn owner_sheet(
        &mut self,
        node: NodeId,
        handle: usize,
        source: String,
    ) -> Result<usize> {
        if let Some((original, id)) = self.owners.get(&node)
            && original == &source
        {
            return Ok(*id);
        }
        let rules = parse_sheet(&source)?;
        let cost = rules
            .iter()
            .map(Rule::bytes)
            .fold(source.len(), usize::saturating_add);
        if self.sheets.len() >= SHEETS
            || self.rules.len().saturating_add(rules.len()) > RULES
            || self.bytes.saturating_add(cost) > BYTES
        {
            return Err(Error::Limit("CSSOM state"));
        }
        let id = self.sheets.len();
        let first = self.rules.len();
        self.rules.extend(rules.into_iter().map(|mut rule| {
            rule.parent = Some(id);
            rule
        }));
        self.sheets.push(Sheet {
            rules: (first..self.rules.len()).collect(),
            disabled: false,
            owner: Some(handle),
            replacing: false,
        });
        self.bytes = self.bytes.saturating_add(cost);
        self.owners.insert(node, (source, id));
        Ok(id)
    }
    fn text(&self, id: usize) -> Option<String> {
        let sheet = self.sheets.get(id)?;
        Some(if sheet.disabled {
            String::new()
        } else {
            sheet
                .rules
                .iter()
                .filter_map(|id| self.rules.get(*id))
                .map(Rule::text)
                .collect::<Vec<_>>()
                .join("\n")
        })
    }
    pub(crate) fn owner_source(&self, node: NodeId, original: &str) -> Option<String> {
        let (source, id) = self.owners.get(&node)?;
        if source != original {
            return None;
        }
        self.text(*id)
    }
    fn replace(&mut self, id: usize, source: &str) -> Result<Value> {
        let sheet = self
            .sheets
            .get(id)
            .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?;
        if sheet.owner.is_some() || sheet.replacing {
            return Ok(exception("NotAllowedError"));
        }
        let rules = parse_sheet(source)?;
        let cost = rules
            .iter()
            .map(Rule::bytes)
            .fold(0_usize, usize::saturating_add);
        if self.rules.len().saturating_add(rules.len()) > RULES
            || self.bytes.saturating_add(cost) > BYTES
        {
            return Err(Error::Limit("CSSOM state"));
        }
        for old in &sheet.rules {
            if let Some(rule) = self.rules.get_mut(*old) {
                rule.parent = None;
            }
        }
        let first = self.rules.len();
        self.rules.extend(rules.into_iter().map(|mut rule| {
            rule.parent = Some(id);
            rule
        }));
        self.sheets
            .get_mut(id)
            .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?
            .rules = (first..self.rules.len()).collect();
        self.bytes = self.bytes.saturating_add(cost);
        Ok(Value::Null)
    }
    pub(crate) fn sources(&self) -> impl Iterator<Item = String> + '_ {
        self.adopted
            .iter()
            .filter_map(|id| self.sheets.get(*id))
            .filter(|sheet| !sheet.disabled)
            .map(|sheet| {
                sheet
                    .rules
                    .iter()
                    .filter_map(|id| self.rules.get(*id))
                    .map(Rule::text)
                    .collect::<Vec<_>>()
                    .join("\n")
            })
    }

    fn adopt(&mut self, value: &str) -> Result<Value> {
        let ids: Vec<usize> = serde_json::from_str(value)?;
        if ids.len() > SHEETS {
            return Err(Error::Limit("CSSOM adopted sheets"));
        }
        if ids.iter().any(|id| self.sheets.get(*id).is_none()) {
            return Err(Error::Dom("invalid adopted stylesheet".into()));
        }
        if ids.iter().any(|id| {
            self.sheets
                .get(*id)
                .is_some_and(|sheet| sheet.owner.is_some())
        }) {
            return Ok(exception("NotAllowedError"));
        }
        self.adopted = ids;
        Ok(Value::Null)
    }

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

    fn start_replace(&mut self, id: usize) -> Result<Value> {
        let sheet = self
            .sheets
            .get_mut(id)
            .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?;
        if sheet.owner.is_some() || sheet.replacing {
            return Ok(exception("NotAllowedError"));
        }
        sheet.replacing = true;
        Ok(Value::Null)
    }

    fn finish_replace(&mut self, id: usize, value: &str) -> Result<Value> {
        self.sheets
            .get_mut(id)
            .ok_or_else(|| Error::Dom("invalid CSSOM sheet".into()))?
            .replacing = false;
        self.replace(id, value)
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
            "adopted" => Ok(json!(self.adopted)),
            "adopt" => self.adopt(value),
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
                Ok(json!({"rules":sheet.rules,"disabled":sheet.disabled,"owner":sheet.owner}))
            }
            "replace" => self.replace(id, value),
            "replaceStart" => self.start_replace(id),
            "replaceFinish" => self.finish_replace(id, value),
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
                if sheet.replacing {
                    return Ok(exception("NotAllowedError"));
                }
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
                if sheet.replacing {
                    return Ok(exception("NotAllowedError"));
                }
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

use crate::css_syntax::consume;
use crate::dom_attributes::NativeAttributes;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use cssparser::{
    AtRuleParser, CowRcStr, ParseError, Parser, ParserInput, ParserState, QualifiedRuleParser,
    StyleSheetParser,
};
use dom_query::{Document, NodeId, NodeRef};
use lightningcss::{
    selector::{Component, PseudoClass, PseudoElement, SelectorList},
    stylesheet::{ParserOptions, PrinterOptions},
    traits::{ParseWithOptions, ToCss},
};

use crate::selectors::{Key, Matcher};

const RULE_LIMIT: usize = 4096;
use crate::{Error, MediaEnvironment, Result, layout::Work, styles::Declarations};

struct Selector {
    matcher: Matcher,
    specificity: u32,
    generated: Option<Generated>,
    dynamic: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Generated {
    Before,
    After,
}
struct Rule {
    selectors: Vec<Selector>,
    declarations: Declarations,
    layer: Vec<usize>,
    containers: Vec<std::rc::Rc<crate::containers::Query>>,
}
type Matches = std::rc::Rc<Vec<(usize, u32)>>;

pub(crate) struct Cascade {
    matches: std::cell::RefCell<HashMap<(NodeId, Option<Generated>), Matches>>,
    rules: Vec<Rule>,
    attributes: BTreeSet<String>,
    index: Index,
    pub(crate) animations: crate::animations::Definitions,
    pub(crate) registrations: crate::registrations::Definitions,
    pub(crate) font_faces: crate::font_faces::Definitions,
}

type Position = (usize, usize);
#[derive(Default)]
struct Index {
    ids: HashMap<String, Vec<Position>>,
    classes: HashMap<String, Vec<Position>>,
    tags: HashMap<String, Vec<Position>>,
    attributes: HashMap<String, Vec<Position>>,
    universal: Vec<Position>,
    dynamic: Vec<Position>,
    ancestor_classes: HashMap<String, Vec<Position>>,
    ancestry: std::cell::RefCell<HashMap<NodeId, std::rc::Rc<BTreeSet<String>>>>,
}
impl Index {
    fn new(rules: &[Rule]) -> Self {
        let mut index = Self::default();
        for (rule_index, rule) in rules.iter().enumerate() {
            for (selector_index, selector) in rule.selectors.iter().enumerate() {
                let position = (rule_index, selector_index);
                if selector.dynamic {
                    index.dynamic.push(position);
                    continue;
                }
                let key = selector.matcher.key();
                // A required ancestor class is more selective than a subject
                // tag or attribute-presence key. Identity keys stay local.
                let ancestor = if key.as_ref().is_some_and(|key| key.priority() >= 3) {
                    None
                } else {
                    selector.matcher.ancestor_class()
                };
                if let Some(class) = ancestor {
                    index
                        .ancestor_classes
                        .entry(class)
                        .or_default()
                        .push(position);
                } else if let Some(key) = key {
                    index.insert(key, position);
                } else {
                    index.universal.push(position);
                }
            }
        }
        index
    }
    fn insert(&mut self, key: Key, position: Position) {
        let (map, key) = match key {
            Key::Id(key) => (&mut self.ids, key),
            Key::Class(key) => (&mut self.classes, key),
            Key::Tag(key) => (&mut self.tags, key),
            Key::Attribute(key) => (&mut self.attributes, key),
            Key::Any(keys) => {
                for key in keys {
                    self.insert(key, position);
                }
                return;
            }
        };
        map.entry(key).or_default().push(position);
    }
    fn ancestor_tokens(
        &self,
        node: NodeRef<'_>,
        work: &mut Work<'_>,
    ) -> Result<std::rc::Rc<BTreeSet<String>>> {
        if let Some(tokens) = self.ancestry.borrow().get(&node.id) {
            return Ok(std::rc::Rc::clone(tokens));
        }
        let mut tokens = BTreeSet::new();
        for parent in node.ancestors_it(None) {
            work.charge()?;
            if let Some(classes) = parent.null_attribute("class") {
                for class in classes.split_ascii_whitespace() {
                    work.charge()?;
                    tokens.insert(class.to_owned());
                }
            }
            if let Some(known) = self.ancestry.borrow().get(&parent.id) {
                tokens.extend(known.iter().cloned());
                break;
            }
        }
        // Only the queried node is memoized: the union includes its parents,
        // and must never accidentally include its own classes.
        let tokens = std::rc::Rc::new(tokens);
        self.ancestry
            .borrow_mut()
            .insert(node.id, std::rc::Rc::clone(&tokens));
        Ok(tokens)
    }
    fn candidates(&self, node: NodeRef<'_>, work: &mut Work<'_>) -> Result<BTreeSet<Position>> {
        let mut candidates: BTreeSet<_> = self.universal.iter().copied().collect();
        if !self.ancestor_classes.is_empty() {
            for class in self.ancestor_tokens(node, work)?.iter() {
                if let Some(positions) = self.ancestor_classes.get(class) {
                    candidates.extend(positions);
                }
            }
        }
        if !self.attributes.is_empty() {
            for attribute in &node.attrs() {
                work.charge()?;
                if let Some(positions) = self
                    .attributes
                    .get(&attribute.name.local.to_ascii_lowercase().to_string())
                {
                    candidates.extend(positions);
                }
            }
        }
        if let Some(id) = node.null_attribute("id")
            && let Some(positions) = self.ids.get(id.as_str())
        {
            candidates.extend(positions);
        }
        if let Some(name) = node.qual_name_ref()
            && let Some(positions) = self.tags.get(name.local.to_ascii_lowercase().as_ref())
        {
            candidates.extend(positions);
        }
        if let Some(classes) = node.null_attribute("class") {
            for class in classes.split_ascii_whitespace() {
                work.charge()?;
                if let Some(positions) = self.classes.get(class) {
                    candidates.extend(positions);
                }
            }
        }
        Ok(candidates)
    }
}

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: {detail}"))
}

pub(crate) fn unknown_selector(selector: &lightningcss::selector::Selector<'_>) -> bool {
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

pub(crate) fn forgiving_unknown(selector: &lightningcss::selector::Selector<'_>) -> bool {
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

enum ParsedRule {
    Style(Rule),
    Group(Vec<Rule>),
}
#[derive(Default)]
struct Definitions {
    layers: crate::layers::Layers,
    animations: crate::animations::Definitions,
    registrations: crate::registrations::Definitions,
    font_faces: crate::font_faces::Definitions,
}
enum Prelude {
    Import(crate::stylesheet_imports::Import),
    FontFace,
    Media(bool),
    Layers(Vec<Vec<String>>),
    Keyframes(String),
    Property(String),
    Container(std::rc::Rc<crate::containers::Query>),
}
#[derive(Clone, Copy)]
struct SheetContext<'a> {
    flattened: bool,
    max_selectors: usize,
    resources: &'a crate::stylesheets::Sheets,
    owner: Option<NodeId>,
    base: &'a str,
    identity: &'a str,
    path: &'a [String],
}

impl SheetContext<'_> {
    fn parse(
        &self,
        source: &str,
        media: &MediaEnvironment,
        definitions: &mut Definitions,
        parent: &[usize],
        containers: &[std::rc::Rc<crate::containers::Query>],
        imports_allowed: bool,
    ) -> Result<Vec<Rule>> {
        definitions
            .font_faces
            .sheet(self.identity.to_owned(), self.base.to_owned());
        sheet(
            source,
            media,
            definitions,
            parent,
            containers,
            self,
            imports_allowed,
        )
    }
}

struct Rules<'a> {
    source: &'a SheetContext<'a>,
    imports_allowed: bool,
    import_ordinal: usize,
    media: &'a MediaEnvironment,
    definitions: &'a mut Definitions,
    parent: &'a [usize],
    containers: &'a [std::rc::Rc<crate::containers::Query>],
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
        if name.eq_ignore_ascii_case("charset") {
            return Err(input.new_error(cssparser::BasicParseErrorKind::AtRuleInvalid(name)));
        }
        if name.eq_ignore_ascii_case("import") {
            if !self.imports_allowed {
                return Err(input.new_error(cssparser::BasicParseErrorKind::AtRuleInvalid(name)));
            }
            let start = input.position();
            consume(input, 0)?;
            let source = format!("@import {};", input.slice_from(start));
            let imports = crate::stylesheet_imports::parse(&source).map_err(|error| {
                self.failure = Some(error);
                input.new_custom_error("stylesheet import")
            })?;
            return imports
                .into_iter()
                .next()
                .map(Prelude::Import)
                .ok_or_else(|| {
                    input.new_error(cssparser::BasicParseErrorKind::AtRuleInvalid(name))
                });
        }
        if name.eq_ignore_ascii_case("font-face") {
            input.expect_exhausted()?;
            return Ok(Prelude::FontFace);
        }
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
        if name.eq_ignore_ascii_case("property") {
            let name = input.expect_ident_cloned()?.to_string();
            input.expect_exhausted()?;
            if !name.starts_with("--") || name == "--" {
                return Err(input.new_error(cssparser::BasicParseErrorKind::QualifiedRuleInvalid));
            }
            return Ok(Prelude::Property(name));
        }
        if name.eq_ignore_ascii_case("container") {
            let start = input.position();
            consume(input, 0)?;
            return crate::containers::Query::parse(input.slice_from(start))
                .map(Prelude::Container)
                .map_err(|error| {
                    self.failure = Some(error);
                    input.new_custom_error("stylesheet container query")
                });
        }
        if name.eq_ignore_ascii_case("layer") {
            return crate::layers::names(input).map(Prelude::Layers);
        }
        if name.eq_ignore_ascii_case("supports") {
            return crate::supports::condition(input, 0).map(Prelude::Media);
        }
        if name.starts_with('-') {
            consume(input, 0)?;
            self.imports_allowed = false;
            return Ok(Prelude::Media(false));
        }
        if !name.eq_ignore_ascii_case("media") {
            self.failure = Some(unsupported(&format!("stylesheet at-rule: {name}")));
            return Err(input.new_custom_error("stylesheet at-rule"));
        }
        let start = input.position();
        consume(input, 0)?;
        self.media
            .matches(input.slice_from(start))
            .map(Prelude::Media)
            .map_err(|_error| input.new_custom_error("stylesheet media query"))
    }
    fn parse_block<'t>(
        &mut self,
        prelude: Prelude,
        _start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<ParsedRule, ParseError<'i, Self::Error>> {
        self.imports_allowed = false;
        let start = input.position();
        consume(input, 0)?;
        let mut containers = self.containers.to_vec();
        let parent = match prelude {
            Prelude::Import(_) => {
                return Err(input.new_error(cssparser::BasicParseErrorKind::QualifiedRuleInvalid));
            }
            Prelude::FontFace => {
                self.definitions
                    .font_faces
                    .register(input.slice_from(start))
                    .map_err(|error| {
                        self.failure = Some(error);
                        input.new_custom_error("stylesheet font-face definition")
                    })?;
                return Ok(ParsedRule::Group(Vec::new()));
            }
            Prelude::Property(name) => {
                self.definitions
                    .registrations
                    .register(&name, input.slice_from(start), self.parent)
                    .map_err(|error| {
                        self.failure = Some(error);
                        input.new_custom_error("stylesheet property registration")
                    })?;
                return Ok(ParsedRule::Group(Vec::new()));
            }
            Prelude::Container(query) => {
                containers.push(query);
                self.parent.to_vec()
            }
            Prelude::Keyframes(name) => {
                self.definitions
                    .animations
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
                self.definitions
                    .layers
                    .register(self.parent, names.first().map(Vec::as_slice))
                    .map_err(|message| input.new_custom_error(message))?
            }
        };
        let rules = sheet(
            input.slice_from(start),
            self.media,
            self.definitions,
            &parent,
            &containers,
            self.source,
            false,
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
        if let Prelude::Import(import) = prelude {
            self.import_ordinal = self.import_ordinal.saturating_add(1);
            return self
                .imported(&import)
                .map(ParsedRule::Group)
                .map_err(|error| {
                    self.failure = Some(error);
                });
        }
        let Prelude::Layers(names) = prelude else {
            return Err(());
        };
        if names.is_empty() {
            return Err(());
        }
        for name in names {
            self.definitions
                .layers
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
        if list.0.len() > self.source.max_selectors {
            self.failure = Some(Error::Limit("stylesheet selectors"));
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
        let selectors = list
            .0
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
                let matcher = Matcher::new(&source)
                    .map_err(|_error| input.new_custom_error("stylesheet selector"))?;
                let matcher = if generated.is_some() {
                    if selector
                        .iter_raw_match_order()
                        .filter(|component| matches!(component, Component::PseudoElement(_)))
                        .count()
                        != 1
                    {
                        return Err(input.new_custom_error("generated selector"));
                    }
                    matcher.for_generated_box()
                } else {
                    matcher
                };
                Ok(Selector {
                    dynamic: matcher.references_dynamic(),
                    matcher,
                    specificity: selector.specificity(),
                    generated,
                })
            })
            .collect::<std::result::Result<Vec<_>, ParseError<'i, Self::Error>>>()?;
        self.imports_allowed = false;
        Ok(selectors)
    }
    fn parse_block<'t>(
        &mut self,
        selectors: Self::Prelude,
        rule_start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> std::result::Result<ParsedRule, ParseError<'i, Self::Error>> {
        let start = input.position();
        if consume(input, 0)? {
            let source = format!("{}}}", input.slice_from(rule_start.position()));
            let lowered = crate::nesting::lower(
                &source,
                self.source.resources.max_bytes(),
                self.source.flattened,
            )
            .map_err(|error| {
                self.failure = Some(error);
                input.new_custom_error("stylesheet nesting")
            })?;
            if let Some(source) = lowered {
                let context = SheetContext {
                    flattened: true,
                    ..*self.source
                };
                return sheet(
                    &source,
                    self.media,
                    self.definitions,
                    self.parent,
                    self.containers,
                    &context,
                    false,
                )
                .map(ParsedRule::Group)
                .map_err(|error| {
                    self.failure = Some(error);
                    input.new_custom_error("stylesheet nesting")
                });
            }
        }
        let declarations = Declarations::parse(input.slice_from(start))
            .map_err(|message| input.new_custom_error(message))?;
        Ok(ParsedRule::Style(Rule {
            selectors,
            declarations,
            containers: self.containers.to_vec(),
            layer: self
                .parent
                .iter()
                .copied()
                .chain(std::iter::once(usize::MAX))
                .collect(),
        }))
    }
}

impl Rules<'_> {
    fn imported(&mut self, import: &crate::stylesheet_imports::Import) -> Result<Vec<Rule>> {
        let Some(owner) = self.source.owner else {
            return Err(unsupported("stylesheet at-rule: import"));
        };
        if !import.enabled(self.media)? {
            return Ok(Vec::new());
        }
        if self.source.path.len() > 64 {
            return Err(Error::Limit("stylesheet import depth"));
        }
        let mut url = crate::machine::parse_url(self.source.base)?
            .join(&import.url)
            .map_err(|error| Error::InvalidUrl(error.to_string()))?;
        url.set_fragment(None);
        let url = url.to_string();
        let parent = match &import.layer {
            crate::stylesheet_imports::Layer::Unlayered => self.parent.to_vec(),
            crate::stylesheet_imports::Layer::Anonymous => self
                .definitions
                .layers
                .register(self.parent, None)
                .map_err(Error::Limit)?,
            crate::stylesheet_imports::Layer::Named(name) => self
                .definitions
                .layers
                .register(self.parent, Some(name))
                .map_err(Error::Limit)?,
        };
        let Some(source) = self.source.resources.imported(owner, &url) else {
            return Ok(Vec::new());
        };
        if !source.available
            || self.source.path.contains(&url)
            || self.source.path.contains(&source.base)
        {
            return Ok(Vec::new());
        }
        let mut path = self.source.path.to_vec();
        path.push(url);
        path.push(source.base.clone());
        let identity = format!("{}:{}", self.source.identity, self.import_ordinal);
        let context = SheetContext {
            flattened: false,
            max_selectors: self.source.max_selectors,
            resources: self.source.resources,
            owner: Some(owner),
            base: &source.base,
            identity: &identity,
            path: &path,
        };
        let rules = context.parse(
            &source.body,
            self.media,
            self.definitions,
            &parent,
            self.containers,
            true,
        );
        self.definitions
            .font_faces
            .sheet(self.source.identity.to_owned(), self.source.base.to_owned());
        rules
    }
}

fn sheet(
    source: &str,
    media: &MediaEnvironment,
    definitions: &mut Definitions,
    parent: &[usize],
    containers: &[std::rc::Rc<crate::containers::Query>],
    source_context: &SheetContext<'_>,
    imports_allowed: bool,
) -> Result<Vec<Rule>> {
    // Cascade::collect validates the whole sheet; nested groups are slices of it.
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    consume(&mut parser, 0).map_err(|_error| Error::Limit("stylesheet nesting"))?;
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let mut rules = Vec::new();
    let mut rule_parser = Rules {
        source: source_context,
        imports_allowed,
        import_ordinal: 0,
        media,
        definitions,
        parent,
        containers,
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
        if rules.len() > RULE_LIMIT.max(source_context.max_selectors) {
            return Err(Error::Limit("stylesheet rules"));
        }
    }
    if let Some(error) = rule_parser.failure.or(failure) {
        return Err(error);
    }
    if let Some(message) = definitions.layers.failure {
        return Err(Error::Limit(message));
    }
    Ok(rules)
}

fn append(
    rules: &mut Vec<Rule>,
    selectors: &mut usize,
    parsed: Vec<Rule>,
    limit: usize,
) -> Result<()> {
    *selectors = selectors.saturating_add(
        parsed
            .iter()
            .map(|rule| rule.selectors.len())
            .sum::<usize>(),
    );
    if *selectors > limit {
        return Err(Error::Limit("stylesheet selectors"));
    }
    rules.extend(parsed);
    Ok(())
}

impl Cascade {
    pub(crate) fn collect(
        document: &Document,
        sheets: &crate::stylesheets::Sheets,
        constructed: &crate::cssom::Arena,
        base: Option<&str>,
        media: &MediaEnvironment,
        work: &mut Work<'_>,
        max_selectors: usize,
    ) -> Result<Self> {
        let mut rules = Vec::new();
        let mut bytes = 0_usize;
        let mut selectors = 0_usize;
        let mut definitions = Definitions::default();
        for node in document.root().descendants_it() {
            work.charge()?;
            let external = crate::stylesheets::is_stylesheet(node);
            if !external && !node.has_name("style") {
                continue;
            }
            if node
                .null_attribute("type")
                .is_some_and(|value| !value.is_empty() && !value.eq_ignore_ascii_case("text/css"))
            {
                continue;
            }
            if !media.matches(node.null_attribute("media").as_deref().unwrap_or_default())? {
                continue;
            }
            if node.null_attribute("title").is_some() {
                return Err(unsupported("stylesheet sets"));
            }
            let source = if external {
                let Some(source) = sheets.source(node, base)? else {
                    continue;
                };
                constructed
                    .owner_source(node.id, source, sheets.source_base(node, base)?)
                    .unwrap_or_else(|| source.to_owned())
            } else {
                let text = node.text();
                constructed
                    .owner_source(node.id, &text, None)
                    .unwrap_or_else(|| text.to_string())
            };
            if source.len() > sheets.max_bytes() {
                return Err(Error::Limit("stylesheet bytes"));
            }
            bytes = bytes
                .saturating_add(source.len())
                .saturating_add(if external {
                    sheets.imported_bytes(node.id)
                } else {
                    0
                });
            if bytes > sheets.max_bytes() {
                return Err(Error::Limit("stylesheet total bytes"));
            }
            let source_base = if external {
                sheets
                    .source_base(node, base)?
                    .unwrap_or_default()
                    .to_owned()
            } else {
                sheets.document_base(base)
            };
            let identity = format!("{:?}", node.id);
            let path = vec![source_base.clone()];
            let context = SheetContext {
                flattened: false,
                max_selectors,
                resources: sheets,
                owner: external.then_some(node.id),
                base: &source_base,
                identity: &identity,
                path: &path,
            };
            let parsed = context.parse(&source, media, &mut definitions, &[], &[], true)?;
            append(&mut rules, &mut selectors, parsed, max_selectors)?;
        }
        for source in constructed.sources() {
            work.charge()?;
            bytes = bytes.saturating_add(source.len());
            if source.len() > sheets.max_bytes() || bytes > sheets.max_bytes() {
                return Err(Error::Limit("stylesheet total bytes"));
            }
            let source_base = sheets.document_base(base);
            let path = vec![source_base.clone()];
            let context = SheetContext {
                flattened: false,
                max_selectors,
                resources: sheets,
                owner: None,
                base: &source_base,
                identity: "constructed",
                path: &path,
            };
            let parsed = context.parse(&source, media, &mut definitions, &[], &[], true)?;
            append(&mut rules, &mut selectors, parsed, max_selectors)?;
        }
        Ok(Self::parsed(rules, definitions))
    }
    fn parsed(rules: Vec<Rule>, definitions: Definitions) -> Self {
        Self {
            attributes: rules
                .iter()
                .flat_map(|rule| &rule.selectors)
                .flat_map(|selector| selector.matcher.attributes())
                .collect(),
            matches: std::cell::RefCell::default(),
            index: Index::new(&rules),
            rules,
            animations: definitions.animations,
            registrations: definitions.registrations,
            font_faces: definitions.font_faces,
        }
    }

    pub(crate) fn references_attribute(&self, name: &str) -> bool {
        self.attributes.contains(&name.to_ascii_lowercase())
    }

    pub(crate) fn has_containers(&self) -> bool {
        self.rules.iter().any(|rule| !rule.containers.is_empty())
    }

    fn stable_matches(
        &self,
        node: NodeRef<'_>,
        generated: Option<Generated>,
        controls: Option<&crate::dom::control_selectors::View<'_>>,
        work: &mut Work<'_>,
    ) -> Result<Matches> {
        // Cascade instances are local to an immutable scene or computed-style query.
        // Container sizes may change across passes; selector matches cannot.
        if let Some(matched) = self.matches.borrow().get(&(node.id, generated)) {
            work.charge()?;
            return Ok(std::rc::Rc::clone(matched));
        }
        let mut matching = BTreeMap::<usize, u32>::new();
        for (rule_index, selector_index) in self.index.candidates(node, work)? {
            let rule = self
                .rules
                .get(rule_index)
                .ok_or_else(|| Error::Dom("invalid stylesheet index".into()))?;
            let selector = rule
                .selectors
                .get(selector_index)
                .ok_or_else(|| Error::Dom("invalid stylesheet index".into()))?;
            if selector.generated != generated {
                continue;
            }
            work.charge()?;
            if selector.matcher.matches(node, controls) {
                matching
                    .entry(rule_index)
                    .and_modify(|specificity| {
                        *specificity = (*specificity).max(selector.specificity);
                    })
                    .or_insert(selector.specificity);
            }
        }
        let matched = std::rc::Rc::new(matching.into_iter().collect());
        self.matches
            .borrow_mut()
            .insert((node.id, generated), std::rc::Rc::clone(&matched));
        Ok(matched)
    }

    fn selector_matches(
        &self,
        node: NodeRef<'_>,
        generated: Option<Generated>,
        controls: Option<&crate::dom::control_selectors::View<'_>>,
        work: &mut Work<'_>,
    ) -> Result<Matches> {
        let stable = self.stable_matches(node, generated, controls, work)?;
        if self.index.dynamic.is_empty() {
            return Ok(stable);
        }
        // Inline style updates preserve the immutable stylesheet and unrelated
        // selectors. Predicates that read style (including :has/of branches)
        // are always evaluated against the current native DOM.
        let mut matching: BTreeMap<_, _> = stable.iter().copied().collect();
        for &(rule_index, selector_index) in &self.index.dynamic {
            let selector = self
                .rules
                .get(rule_index)
                .and_then(|rule| rule.selectors.get(selector_index))
                .ok_or_else(|| Error::Dom("invalid stylesheet index".into()))?;
            if selector.generated != generated {
                continue;
            }
            work.charge()?;
            if selector.matcher.matches(node, controls) {
                matching
                    .entry(rule_index)
                    .and_modify(|specificity| {
                        *specificity = (*specificity).max(selector.specificity);
                    })
                    .or_insert(selector.specificity);
            }
        }
        Ok(std::rc::Rc::new(matching.into_iter().collect()))
    }

    pub(crate) fn resolve(
        &self,
        node: NodeRef<'_>,
        inline: &Declarations,
        generated: Option<Generated>,
        containers: &crate::containers::Snapshot,
        controls: Option<&crate::dom::control_selectors::View<'_>>,
        work: &mut Work<'_>,
    ) -> Result<Declarations> {
        let mut sources = Vec::new();
        let matched = self.selector_matches(node, generated, controls, work)?;
        let mut matching = Vec::new();
        for &(rule_index, specificity) in matched.iter() {
            let rule = self
                .rules
                .get(rule_index)
                .ok_or_else(|| Error::Dom("invalid stylesheet index".into()))?;
            let mut active = true;
            for query in &rule.containers {
                if !query.matches(node, generated.is_some(), containers, work)? {
                    active = false;
                    break;
                }
            }
            if active {
                matching.push((rule_index, specificity));
            }
        }
        // Source order resolves equal ranks; keep it independently of the
        // hash lookup order and count each rule only once.
        for (rule_index, specificity) in matching {
            let rule = self
                .rules
                .get(rule_index)
                .ok_or_else(|| Error::Dom("invalid stylesheet index".into()))?;
            sources.push((
                &rule.declarations,
                false,
                specificity,
                rule.layer.as_slice(),
            ));
        }
        if generated.is_none() {
            sources.push((inline, true, 0, [usize::MAX].as_slice()));
        }
        let declarations =
            Declarations::cascade(sources).map_err(|message| Error::Dom(message.into()))?;
        if generated.is_some() {
            Ok(declarations)
        } else {
            crate::html_boxes::defaults(node, declarations)
        }
    }
}

#[cfg(test)]
mod rule_budget_tests {
    use std::fmt::Write as _;

    use super::{Definitions, SheetContext};
    use crate::{Limits, MediaEnvironment, Result, stylesheets::Sheets};

    fn parsed_rules(count: usize, maximum: usize) -> Result<usize> {
        let mut source = String::new();
        for index in 0..count {
            write!(source, ".fixture{index}{{width:17px}}")
                .map_err(|_| crate::Error::Dom("fixture CSS formatting".into()))?;
        }
        let origin = url::Url::parse("https://example.test/")
            .map_err(|error| crate::Error::InvalidUrl(error.to_string()))?;
        let resources = Sheets::new(origin, Limits::default().max_stylesheet_bytes);
        let context = SheetContext {
            flattened: false,
            max_selectors: maximum,
            resources: &resources,
            owner: None,
            base: "https://example.test/",
            identity: "budget",
            path: &[],
        };
        context
            .parse(
                &source,
                &MediaEnvironment::default(),
                &mut Definitions::default(),
                &[],
                &[],
                true,
            )
            .map(|rules| rules.len())
    }

    #[test]
    fn stylesheet_rule_count_honors_a_larger_configured_selector_budget() -> Result<()> {
        let default = Limits::default().max_stylesheet_selectors;
        assert_eq!(parsed_rules(default, default)?, default);
        assert!(parsed_rules(default + 1, default).is_err());
        assert_eq!(parsed_rules(default + 1, default * 2)?, default + 1);
        assert_eq!(parsed_rules(default * 2, default * 2)?, default * 2);
        assert!(parsed_rules(default * 2 + 1, default * 2).is_err());
        Ok(())
    }
}

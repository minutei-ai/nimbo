use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    rc::Rc,
};

use cssparser::{ParseError, ParseErrorKind, Parser, ParserInput, Token};

use super::{Declarations, Entry, expand, wide_keyword};
use crate::{Error, Result, layout::Work};

const VALUE_LIMIT: usize = 65_536;
const TOTAL_LIMIT: usize = 262_144;
const VARIABLE_LIMIT: usize = 1024;
const CHAIN_LIMIT: usize = 128;

#[derive(Clone, Default)]
pub(crate) struct Variables(BTreeMap<String, Option<Rc<str>>>);

enum Component {
    Raw(String),
    Block(String, Vec<Self>, char),
    Var(String, Option<Vec<Self>>),
    Environment,
}

#[derive(Debug)]
enum Failure {
    Invalid,
    Engine(Error),
}

type Computed<T> = std::result::Result<T, Failure>;

fn parse<'i>(
    input: &mut Parser<'i, '_>,
    depth: usize,
    work: &mut Work<'_>,
) -> std::result::Result<Vec<Component>, ParseError<'i, Failure>> {
    if depth > 32 {
        return Err(input.new_custom_error(Failure::Engine(Error::Limit("CSS substitution depth"))));
    }
    let mut output = Vec::new();
    while !input.is_exhausted() {
        work.charge()
            .map_err(|error| input.new_custom_error(Failure::Engine(error)))?;
        let start = input.position();
        let token = input.next_including_whitespace_and_comments()?.clone();
        let prefix = input.slice_from(start).to_owned();
        let item = match token {
            Token::Function(name) if name.eq_ignore_ascii_case("var") => {
                input.parse_nested_block(|nested| {
                    let name = nested.expect_ident_cloned()?.to_string();
                    let fallback = if nested.try_parse(Parser::expect_comma).is_ok() {
                        Some(parse(nested, depth.saturating_add(1), work)?)
                    } else {
                        None
                    };
                    nested.expect_exhausted()?;
                    Ok(Component::Var(name, fallback))
                })?
            }
            Token::Function(name) if name.eq_ignore_ascii_case("env") => {
                input.parse_nested_block(|nested| parse(nested, depth.saturating_add(1), work))?;
                Component::Environment
            }
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                let close = match token {
                    Token::SquareBracketBlock => ']',
                    Token::CurlyBracketBlock => '}',
                    _ => ')',
                };
                let body = input
                    .parse_nested_block(|nested| parse(nested, depth.saturating_add(1), work))?;
                Component::Block(prefix, body, close)
            }
            Token::BadString(_)
            | Token::BadUrl(_)
            | Token::CloseParenthesis
            | Token::CloseSquareBracket
            | Token::CloseCurlyBracket => return Err(input.new_custom_error(Failure::Invalid)),
            _ => Component::Raw(prefix),
        };
        output.push(item);
    }
    Ok(output)
}

fn tokens(value: &str, work: &mut Work<'_>) -> Computed<Vec<Component>> {
    let mut input = ParserInput::new(value);
    parse(&mut Parser::new(&mut input), 0, work).map_err(|error| match error.kind {
        ParseErrorKind::Custom(error) => error,
        ParseErrorKind::Basic(_) => Failure::Invalid,
    })
}

fn dependencies(items: &[Component], output: &mut BTreeSet<String>) {
    for item in items {
        match item {
            Component::Var(name, _) => {
                output.insert(name.clone());
            }
            Component::Block(_, items, _) => dependencies(items, output),
            _ => {}
        }
    }
}

// Primary references always participate; fallback edges are added only when used.
// Inherited values are already computed and cannot form a new local cycle.
struct Cycles<'a> {
    graph: &'a BTreeMap<String, BTreeSet<String>>,
    indices: BTreeMap<String, (usize, usize)>,
    stack: Vec<String>,
    active: HashSet<String>,
    invalid: HashSet<String>,
}

impl Cycles<'_> {
    fn collect(
        graph: &BTreeMap<String, BTreeSet<String>>,
        work: &mut Work<'_>,
    ) -> Result<HashSet<String>> {
        let mut cycles = Cycles {
            graph,
            indices: BTreeMap::new(),
            stack: Vec::new(),
            active: HashSet::new(),
            invalid: HashSet::new(),
        };
        for name in graph.keys() {
            cycles.visit(name, 0, work)?;
        }
        Ok(cycles.invalid)
    }

    fn visit(&mut self, name: &str, depth: usize, work: &mut Work<'_>) -> Result<()> {
        work.charge()?;
        if self.indices.contains_key(name) {
            return Ok(());
        }
        if depth >= CHAIN_LIMIT {
            return Err(Error::Limit("CSS variable chain"));
        }
        let index = self.indices.len();
        let mut low = index;
        self.indices.insert(name.to_owned(), (index, low));
        self.stack.push(name.to_owned());
        self.active.insert(name.to_owned());
        let edges = self
            .graph
            .get(name)
            .map(|edges| edges.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for next in edges {
            work.charge()?;
            if !self.graph.contains_key(&next) {
                continue;
            }
            if !self.indices.contains_key(&next) {
                self.visit(&next, depth.saturating_add(1), work)?;
                low = low.min(
                    self.indices
                        .get(&next)
                        .ok_or_else(|| Error::Dom("CSS dependency state".into()))?
                        .1,
                );
            } else if self.active.contains(&next) {
                low = low.min(
                    self.indices
                        .get(&next)
                        .ok_or_else(|| Error::Dom("CSS dependency state".into()))?
                        .0,
                );
            }
        }
        self.indices.insert(name.to_owned(), (index, low));
        if low == index {
            let mut component = Vec::new();
            while let Some(next) = self.stack.pop() {
                self.active.remove(&next);
                let last = next == name;
                component.push(next);
                if last {
                    break;
                }
            }
            if component.len() > 1
                || self
                    .graph
                    .get(name)
                    .is_some_and(|edges| edges.contains(name))
            {
                self.invalid.extend(component);
            }
        }
        Ok(())
    }
}

struct Resolver<'a, 'b> {
    values: Variables,
    local: BTreeMap<String, Rc<[Component]>>,
    graph: BTreeMap<String, BTreeSet<String>>,
    active: Vec<String>,
    invalid: HashSet<String>,
    work: &'a mut Work<'b>,
    bytes: usize,
}

fn append(output: &mut String, value: &str) -> Computed<()> {
    if output.len().saturating_add(value.len()) > VALUE_LIMIT {
        return Err(Failure::Invalid);
    }
    output.push_str(value);
    Ok(())
}

impl Resolver<'_, '_> {
    fn settle(&mut self) -> Result<()> {
        let inherited = self.values.clone();
        let sources = self.local.clone();
        let bytes = self.bytes;
        loop {
            // Reconsider dependents when a newly used fallback closes a cycle.
            // Edges and invalid participants grow monotonically; every pass
            // is charged to the shared DOM operation budget.
            let previous = self.invalid.clone();
            self.invalid
                .extend(Cycles::collect(&self.graph, self.work)?);
            self.values = inherited.clone();
            self.local = sources.clone();
            self.bytes = bytes;
            for name in &self.invalid {
                self.local.remove(name);
                self.values.0.insert(name.clone(), None);
            }
            for name in sources.keys() {
                self.resolve(name, 0).map_err(engine_error)?;
            }
            self.invalid
                .extend(Cycles::collect(&self.graph, self.work)?);
            if self.invalid == previous {
                break;
            }
        }
        if self.bytes > TOTAL_LIMIT {
            return Err(Error::Limit("CSS computed variable bytes"));
        }
        Ok(())
    }

    fn resolve(&mut self, name: &str, depth: usize) -> Computed<Option<Rc<str>>> {
        self.work.charge().map_err(Failure::Engine)?;
        if depth >= CHAIN_LIMIT {
            return Err(Failure::Engine(Error::Limit("CSS variable chain")));
        }
        if let Some(index) = self.active.iter().position(|active| active == name) {
            self.invalid.extend(self.active.iter().skip(index).cloned());
            return Ok(None);
        }
        if let Some(value) = self.values.0.get(name) {
            return Ok(value.clone());
        }
        let Some(items) = self.local.remove(name) else {
            return Ok(None);
        };
        self.active.push(name.to_owned());
        let rendered = self.render(&items, depth.saturating_add(1));
        self.active.pop();
        let value = match rendered {
            Ok(value) if !self.invalid.contains(name) => Some(Rc::<str>::from(value)),
            Ok(_) | Err(Failure::Invalid) => None,
            Err(error) => return Err(error),
        };
        self.bytes = self
            .bytes
            .saturating_add(value.as_ref().map_or(0, |value| value.len()));
        if self.bytes > TOTAL_LIMIT {
            return Err(Failure::Engine(Error::Limit("CSS computed variable bytes")));
        }
        self.values.0.insert(name.to_owned(), value.clone());
        Ok(value)
    }

    fn render(&mut self, items: &[Component], depth: usize) -> Computed<String> {
        let mut output = String::new();
        for item in items {
            self.work.charge().map_err(Failure::Engine)?;
            match item {
                Component::Raw(value) => append(&mut output, value)?,
                Component::Block(prefix, items, close) => {
                    append(&mut output, prefix)?;
                    append(&mut output, &self.render(items, depth)?)?;
                    append(&mut output, &close.to_string())?;
                }
                Component::Var(name, fallback) => {
                    if let Some(owner) = self.active.last() {
                        self.graph
                            .entry(owner.clone())
                            .or_default()
                            .insert(name.clone());
                    }
                    let value = match self.resolve(name, depth)? {
                        Some(value) => value.to_string(),
                        None => self.render(fallback.as_ref().ok_or(Failure::Invalid)?, depth)?,
                    };
                    // Substitution inserts tokens, not characters. Separators prevent
                    // var(--number)px from becoming a dimension token, for example.
                    append(&mut output, "/**/")?;
                    append(&mut output, &value)?;
                    append(&mut output, "/**/")?;
                }
                Component::Environment => {
                    return Err(Failure::Engine(Error::Dom(
                        "layout unsupported: environment substitution".into(),
                    )));
                }
            }
        }
        Ok(output)
    }
}

impl Declarations {
    pub(crate) fn compute_variables(
        &self,
        parent: &Variables,
        work: &mut Work<'_>,
    ) -> Result<(Self, Variables)> {
        let mut values = parent.clone();
        let mut local = BTreeMap::new();
        let mut source_bytes = 0_usize;
        for entry in &self.entries {
            if !entry.name.starts_with("--") {
                continue;
            }
            work.charge()?;
            source_bytes = source_bytes.saturating_add(entry.value.len());
            if source_bytes > TOTAL_LIMIT {
                return Err(Error::Limit("CSS variable source bytes"));
            }
            match wide_keyword(&entry.value).as_deref() {
                Some("inherit" | "unset") => {}
                Some("initial") => {
                    values.0.insert(entry.name.clone(), None);
                }
                Some(_) => {
                    return Err(Error::Dom(
                        "layout unsupported: variable cascade rollback".into(),
                    ));
                }
                None => {
                    values.0.remove(&entry.name);
                    match tokens(&entry.value, work) {
                        Ok(items) => {
                            local.insert(entry.name.clone(), Rc::<[Component]>::from(items));
                        }
                        Err(Failure::Invalid) => {
                            values.0.insert(entry.name.clone(), None);
                        }
                        Err(Failure::Engine(error)) => return Err(error),
                    }
                }
            }
        }
        if values.0.len().saturating_add(local.len()) > VARIABLE_LIMIT {
            return Err(Error::Limit("CSS computed variables"));
        }
        let graph = local
            .iter()
            .map(|(name, items)| {
                let mut edges = BTreeSet::new();
                dependencies(items, &mut edges);
                (name.clone(), edges)
            })
            .collect::<BTreeMap<_, _>>();
        let bytes = values.0.values().flatten().map(|value| value.len()).sum();
        let mut resolver = Resolver {
            values,
            local,
            graph,
            active: Vec::new(),
            invalid: HashSet::new(),
            work,
            bytes,
        };
        resolver.settle()?;
        let declarations = resolver.declarations(self)?;
        Ok((declarations, resolver.values))
    }
}

impl Resolver<'_, '_> {
    fn declarations(&mut self, source: &Declarations) -> Result<Declarations> {
        let mut entries = Vec::new();
        let mut pending = BTreeMap::new();
        let mut computed_bytes = 0_usize;
        let mut expanded_entries = 0_usize;
        for entry in &source.entries {
            if entry.name.starts_with("--") {
                continue;
            }
            self.work.charge()?;
            let next = if entry.deferred {
                let (name, value) = entry
                    .pending
                    .as_ref()
                    .map_or((entry.name.as_str(), entry.value.as_str()), |pending| {
                        (pending.name.as_str(), pending.value.as_str())
                    });
                let key = (name.to_owned(), value.to_owned());
                if !pending.contains_key(&key) {
                    let expanded =
                        match tokens(value, self.work).and_then(|items| self.render(&items, 0)) {
                            Ok(value) => expand(name, &value, entry.important),
                            Err(Failure::Invalid) => None,
                            Err(Failure::Engine(error)) => return Err(error),
                        };
                    expanded_entries =
                        expanded_entries.saturating_add(expanded.as_ref().map_or(0, Vec::len));
                    if expanded_entries > VARIABLE_LIMIT {
                        return Err(Error::Limit("CSS computed declaration entries"));
                    }
                    pending.insert(key.clone(), expanded);
                }
                pending
                    .get(&key)
                    .and_then(Option::as_ref)
                    .and_then(|items| items.iter().find(|item| item.name == entry.name))
                    .cloned()
                    .unwrap_or_else(|| Entry::new(&entry.name, "unset".into(), entry.important))
            } else {
                entry.clone()
            };
            computed_bytes = computed_bytes.saturating_add(next.value.len());
            if computed_bytes > TOTAL_LIMIT {
                return Err(Error::Limit("CSS computed declaration bytes"));
            }
            entries.push(next);
        }
        Ok(Declarations {
            entries,
            shorthands: Vec::new(),
        })
    }
}

fn engine_error(error: Failure) -> Error {
    match error {
        Failure::Engine(error) => error,
        Failure::Invalid => Error::Dom("CSS substitution syntax".into()),
    }
}

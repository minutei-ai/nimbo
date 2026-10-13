use crate::{dom::control_selectors::View, dom_attributes::NativeAttributes};
use cssparser::{CowRcStr, ParseError, Parser, ParserInput, SourceLocation, ToCss};
use dom_query::{NodeData, NodeRef};
use lightningcss::{
    selector::{Component, PseudoClass, PseudoElement, SelectorList as CssSelectorList},
    stylesheet::ParserOptions,
    traits::ParseWithOptions,
};
use selectors::{
    Element, OpaqueElement,
    attr::{AttrSelectorOperation, CaseSensitivity, NamespaceConstraint},
    context::{MatchingContext, MatchingForInvalidation, MatchingMode, QuirksMode, SelectorCaches},
    matching::{ElementSelectorFlags, NeedsSelectorFlags, matches_selector_list},
    parser::{ParseRelative, SelectorImpl, SelectorList, SelectorParseErrorKind},
};
use std::fmt;

type BaseImpl = <NodeRef<'static> as Element>::Impl;
#[derive(Clone, Debug)]
struct NativeImpl;
impl SelectorImpl for NativeImpl {
    type ExtraMatchingData<'a> = ();
    type AttrValue = <BaseImpl as SelectorImpl>::AttrValue;
    type Identifier = <BaseImpl as SelectorImpl>::Identifier;
    type LocalName = <BaseImpl as SelectorImpl>::LocalName;
    type NamespaceUrl = <BaseImpl as SelectorImpl>::NamespaceUrl;
    type NamespacePrefix = <BaseImpl as SelectorImpl>::NamespacePrefix;
    type BorrowedLocalName = <BaseImpl as SelectorImpl>::BorrowedLocalName;
    type BorrowedNamespaceUrl = <BaseImpl as SelectorImpl>::BorrowedNamespaceUrl;
    type NonTSPseudoClass = BrowserPseudo;
    type PseudoElement = BrowserPseudoElement;
}
#[derive(Clone, Debug, Eq, PartialEq)]
struct BrowserPseudo(String);
#[derive(Clone, Debug, Eq, PartialEq)]
struct BrowserPseudoElement(String);
impl ToCss for BrowserPseudo {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}
impl ToCss for BrowserPseudoElement {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}
impl selectors::parser::NonTSPseudoClass for BrowserPseudo {
    type Impl = NativeImpl;
    fn is_active_or_hover(&self) -> bool {
        matches!(self.0.as_str(), ":active" | ":hover")
    }
    fn is_user_action_state(&self) -> bool {
        matches!(
            self.0.as_str(),
            ":active" | ":hover" | ":focus" | ":focus-visible" | ":focus-within"
        )
    }
}
impl selectors::parser::PseudoElement for BrowserPseudoElement {
    type Impl = NativeImpl;
    fn is_before_or_after(&self) -> bool {
        matches!(self.0.as_str(), "::before" | "::after")
    }
}
// Validate platform pseudo syntax with the existing typed CSS parser. Keep an
// owned spelling for the matcher; dynamic browser states are a separate concern.
fn known_pseudo(source: &str, element: bool) -> bool {
    let Ok(list) = CssSelectorList::parse_string_with_options(source, ParserOptions::default())
    else {
        return false;
    };
    list.0
        .iter()
        .flat_map(|s| s.iter_raw_match_order())
        .any(|c| match c {
            Component::NonTSPseudoClass(p) if !element => !matches!(
                p,
                PseudoClass::Custom { .. } | PseudoClass::CustomFunction { .. }
            ),
            Component::PseudoElement(p) if element => !matches!(
                p,
                PseudoElement::Custom { .. } | PseudoElement::CustomFunction { .. }
            ),
            _ => false,
        })
}
struct BrowserParser;
impl<'i> selectors::parser::Parser<'i> for BrowserParser {
    type Impl = NativeImpl;
    type Error = SelectorParseErrorKind<'i>;
    fn parse_is_and_where(&self) -> bool {
        true
    }
    fn parse_has(&self) -> bool {
        true
    }
    fn parse_nth_child_of(&self) -> bool {
        true
    }
    fn parse_host(&self) -> bool {
        true
    }
    fn parse_non_ts_pseudo_class(
        &self,
        location: SourceLocation,
        name: CowRcStr<'i>,
    ) -> Result<BrowserPseudo, ParseError<'i, Self::Error>> {
        let source = format!(":{}", name.to_ascii_lowercase());
        if known_pseudo(&source, false) {
            Ok(BrowserPseudo(source))
        } else {
            Err(
                location.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                    name,
                )),
            )
        }
    }
    fn parse_non_ts_functional_pseudo_class<'t>(
        &self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
        _after_part: bool,
    ) -> Result<BrowserPseudo, ParseError<'i, Self::Error>> {
        let start = input.position();
        while input.next().is_ok() {}
        let source = format!(
            ":{}({})",
            name.to_ascii_lowercase(),
            input.slice_from(start)
        );
        if known_pseudo(&source, false) {
            Ok(BrowserPseudo(source))
        } else {
            Err(
                input.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                    name,
                )),
            )
        }
    }
    fn parse_pseudo_element(
        &self,
        location: SourceLocation,
        name: CowRcStr<'i>,
    ) -> Result<BrowserPseudoElement, ParseError<'i, Self::Error>> {
        let source = format!("::{}", name.to_ascii_lowercase());
        if known_pseudo(&source, true) {
            Ok(BrowserPseudoElement(source))
        } else {
            Err(
                location.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                    name,
                )),
            )
        }
    }
    fn parse_functional_pseudo_element<'t>(
        &self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> Result<BrowserPseudoElement, ParseError<'i, Self::Error>> {
        let start = input.position();
        while input.next().is_ok() {}
        let source = format!(
            "::{}({})",
            name.to_ascii_lowercase(),
            input.slice_from(start)
        );
        if known_pseudo(&source, true) {
            Ok(BrowserPseudoElement(source))
        } else {
            Err(
                input.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                    name,
                )),
            )
        }
    }
}
#[derive(PartialEq, Eq)]
pub(crate) enum Key {
    Id(String),
    Class(String),
    Tag(String),
    Attribute(String),
    Any(Vec<Key>),
}

#[derive(Clone)]
pub(crate) struct Matcher {
    list: SelectorList<NativeImpl>,
}
impl Matcher {
    pub(crate) fn new(source: &str) -> Result<Self, ()> {
        let mut input = ParserInput::new(source);
        let list = SelectorList::parse(
            &BrowserParser,
            &mut Parser::new(&mut input),
            ParseRelative::No,
        )
        .map_err(|_error| ())?;
        Ok(Self { list })
    }
    // Every positive branch must have a required predicate. Alternatives
    // contribute a union; negation and relational predicates stay unindexed.
    pub(crate) fn key(&self) -> Option<Key> {
        let [selector] = self.list.slice() else {
            return None;
        };
        selector_key(selector)
    }
    pub(crate) fn ancestor_class(&self) -> Option<String> {
        use selectors::parser::{Combinator, Component};
        let [selector] = self.list.slice() else {
            return None;
        };
        let mut ancestor = false;
        for component in selector.iter_raw_match_order() {
            match component {
                Component::Combinator(Combinator::Child | Combinator::Descendant) => {
                    ancestor = true;
                }
                Component::Combinator(_) => break,
                Component::Class(name) if ancestor => return Some(name.to_string()),
                _ => {}
            }
        }
        None
    }
    pub(crate) fn attributes(&self) -> std::collections::BTreeSet<String> {
        let mut attributes = std::collections::BTreeSet::new();
        for selector in self.list.slice() {
            attribute_dependencies(selector, &mut attributes);
        }
        attributes
    }
    pub(crate) fn references_dynamic(&self) -> bool {
        self.list.slice().iter().any(references_dynamic)
    }
    pub(crate) fn matches(&self, node: NodeRef<'_>, view: Option<&View<'_>>) -> bool {
        let mut caches = SelectorCaches::default();
        self.matches_with_caches(node, view, &mut caches)
    }
    pub(crate) fn matches_with_caches(
        &self,
        node: NodeRef<'_>,
        view: Option<&View<'_>>,
        caches: &mut SelectorCaches,
    ) -> bool {
        if view.is_some_and(|view| !view.checkpoint()) {
            return false;
        }
        let mut context = MatchingContext::new(
            MatchingMode::Normal,
            None,
            caches,
            QuirksMode::NoQuirks,
            NeedsSelectorFlags::No,
            MatchingForInvalidation::No,
        );
        let matched = matches_selector_list(&self.list, &NativeElement(node, view), &mut context);
        matched && view.is_none_or(|view| !view.failed())
    }
}
fn attribute_dependencies(
    selector: &selectors::parser::Selector<NativeImpl>,
    attributes: &mut std::collections::BTreeSet<String>,
) {
    use selectors::parser::Component;
    for component in selector.iter_raw_match_order() {
        match component {
            Component::NonTSPseudoClass(pseudo)
                if matches!(
                    pseudo.0.as_str(),
                    ":checked" | ":indeterminate" | ":enabled" | ":disabled"
                ) =>
            {
                attributes.extend(
                    ["checked", "type", "name", "form", "id", "disabled", "value"]
                        .map(str::to_owned),
                );
            }
            Component::ID(_) => {
                attributes.insert("id".into());
            }
            Component::Class(_) => {
                attributes.insert("class".into());
            }
            Component::AttributeInNoNamespaceExists {
                local_name_lower, ..
            } => {
                attributes.insert(local_name_lower.to_string());
            }
            Component::AttributeInNoNamespace { local_name, .. } => {
                attributes.insert(local_name.to_string());
            }
            Component::AttributeOther(attribute) => {
                attributes.insert(attribute.local_name_lower.to_string());
            }
            Component::NonTSPseudoClass(pseudo)
                if matches!(
                    pseudo.0.as_str(),
                    ":any-link" | ":link" | ":-webkit-any-link" | ":-moz-any-link"
                ) =>
            {
                attributes.insert("href".into());
            }
            Component::Is(list) | Component::Where(list) | Component::Negation(list) => {
                for selector in list.slice() {
                    attribute_dependencies(selector, attributes);
                }
            }
            Component::Has(list) => {
                for relative in list {
                    attribute_dependencies(&relative.selector, attributes);
                }
            }
            Component::NthOf(data) => {
                for selector in data.selectors() {
                    attribute_dependencies(selector, attributes);
                }
            }
            Component::Host(Some(selector)) | Component::Slotted(selector) => {
                attribute_dependencies(selector, attributes);
            }
            _ => {}
        }
    }
}

fn references_dynamic(selector: &selectors::parser::Selector<NativeImpl>) -> bool {
    use selectors::parser::Component;
    selector
        .iter_raw_match_order()
        .any(|component| match component {
            Component::NonTSPseudoClass(pseudo)
                if matches!(
                    pseudo.0.as_str(),
                    ":checked" | ":indeterminate" | ":enabled" | ":disabled"
                ) =>
            {
                true
            }
            Component::AttributeInNoNamespaceExists {
                local_name_lower, ..
            } => local_name_lower.as_ref() == "style",
            Component::AttributeInNoNamespace { local_name, .. } => local_name.as_ref() == "style",
            Component::AttributeOther(attribute) => attribute.local_name_lower.as_ref() == "style",
            Component::Is(list) | Component::Where(list) | Component::Negation(list) => {
                list.slice().iter().any(references_dynamic)
            }
            Component::Has(list) => list
                .iter()
                .any(|relative| references_dynamic(&relative.selector)),
            Component::NthOf(data) => data.selectors().iter().any(references_dynamic),
            Component::Host(Some(selector)) | Component::Slotted(selector) => {
                references_dynamic(selector)
            }
            _ => false,
        })
}
impl Key {
    pub(crate) fn priority(&self) -> u8 {
        match self {
            Self::Id(_) => 4,
            Self::Class(_) => 3,
            Self::Attribute(_) => 2,
            Self::Tag(_) => 1,
            Self::Any(keys) => keys.iter().map(Self::priority).min().unwrap_or(0),
        }
    }
}
fn selector_key(selector: &selectors::parser::Selector<NativeImpl>) -> Option<Key> {
    use selectors::parser::Component;
    let mut key: Option<Key> = None;
    for component in selector
        .iter_raw_match_order()
        .take_while(|component| !component.is_combinator())
    {
        let next = match component {
            Component::ID(name) => Some(Key::Id(name.to_string())),
            Component::Class(name) => Some(Key::Class(name.to_string())),
            Component::LocalName(name) => {
                Some(Key::Tag(name.name.to_string().to_ascii_lowercase()))
            }
            Component::AttributeInNoNamespaceExists {
                local_name_lower, ..
            } => Some(Key::Attribute(local_name_lower.to_string())),
            Component::AttributeInNoNamespace { local_name, .. } => {
                Some(Key::Attribute(local_name.to_string().to_ascii_lowercase()))
            }
            Component::AttributeOther(attribute) => {
                Some(Key::Attribute(attribute.local_name_lower.to_string()))
            }
            Component::Is(list) | Component::Where(list) => {
                let branches = list
                    .slice()
                    .iter()
                    .map(selector_key)
                    .collect::<Option<Vec<_>>>();
                branches.filter(|keys| !keys.is_empty()).map(Key::Any)
            }
            _ => None,
        };
        if let Some(next) = next
            && key
                .as_ref()
                .is_none_or(|key| next.priority() > key.priority())
        {
            key = Some(next);
        }
    }
    key
}
#[derive(Clone, Copy, Debug)]
struct NativeElement<'a>(NodeRef<'a>, Option<&'a View<'a>>);
impl Element for NativeElement<'_> {
    type Impl = NativeImpl;
    fn opaque(&self) -> OpaqueElement {
        self.0
            .query_or(OpaqueElement::new(&self.0), OpaqueElement::new)
    }
    fn parent_element(&self) -> Option<Self> {
        self.0
            .ancestors_it(None)
            .take_while(|_| self.1.is_none_or(View::checkpoint))
            .find(NodeRef::is_element)
            .map(|node| Self(node, self.1))
    }
    fn parent_node_is_shadow_root(&self) -> bool {
        false
    }
    fn containing_shadow_host(&self) -> Option<Self> {
        None
    }
    fn is_pseudo_element(&self) -> bool {
        false
    }
    fn prev_sibling_element(&self) -> Option<Self> {
        std::iter::successors(self.0.prev_sibling(), NodeRef::prev_sibling)
            .take_while(|_| self.1.is_none_or(View::checkpoint))
            .find(NodeRef::is_element)
            .map(|node| Self(node, self.1))
    }
    fn next_sibling_element(&self) -> Option<Self> {
        std::iter::successors(self.0.next_sibling(), NodeRef::next_sibling)
            .take_while(|_| self.1.is_none_or(View::checkpoint))
            .find(NodeRef::is_element)
            .map(|node| Self(node, self.1))
    }
    fn is_html_element_in_html_document(&self) -> bool {
        self.0
            .qual_name_ref()
            .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml")
    }
    fn has_local_name(&self, name: &<Self::Impl as SelectorImpl>::BorrowedLocalName) -> bool {
        self.0
            .qual_name_ref()
            .is_some_and(|actual| actual.local.as_ref() == &**name)
    }
    fn has_namespace(
        &self,
        namespace: &<Self::Impl as SelectorImpl>::BorrowedNamespaceUrl,
    ) -> bool {
        self.0
            .qual_name_ref()
            .is_some_and(|actual| actual.ns.as_ref() == &**namespace)
    }
    fn is_same_type(&self, other: &Self) -> bool {
        self.0
            .qual_name_ref()
            .zip(other.0.qual_name_ref())
            .is_some_and(|(a, b)| a.ns == b.ns && a.local == b.local)
    }
    fn attr_matches(
        &self,
        namespace: &NamespaceConstraint<&<Self::Impl as SelectorImpl>::NamespaceUrl>,
        name: &<Self::Impl as SelectorImpl>::LocalName,
        operation: &AttrSelectorOperation<&<Self::Impl as SelectorImpl>::AttrValue>,
    ) -> bool {
        self.0.query_or(false, |node| {
            let NodeData::Element(element) = &node.data else {
                return false;
            };
            element.attrs.iter().any(|attribute| match namespace {
                NamespaceConstraint::Specific(url) if &***url != attribute.name.ns.as_ref() => {
                    false
                }
                _ => {
                    attribute.name.local.as_ref() == &**name
                        && operation.eval_str(attribute.value.as_ref())
                }
            })
        })
    }
    fn match_non_ts_pseudo_class(
        &self,
        pseudo: &BrowserPseudo,
        _context: &mut MatchingContext<'_, Self::Impl>,
    ) -> bool {
        if let Some(view) = self.1
            && let Some(value) = view.matches(self.0, pseudo.0.as_str())
        {
            return value;
        }
        match pseudo.0.as_str() {
            ":any-link" | ":link" | ":-webkit-any-link" | ":-moz-any-link" => self.is_link(),
            // Document scenes do not yet have native user-action, media,
            // form-control or top-layer state. Parsing is not runtime parity.
            _ => false,
        }
    }
    fn match_pseudo_element(
        &self,
        _pseudo: &BrowserPseudoElement,
        _context: &mut MatchingContext<'_, Self::Impl>,
    ) -> bool {
        false
    }
    fn apply_selector_flags(&self, _flags: ElementSelectorFlags) {}
    fn first_element_child(&self) -> Option<Self> {
        self.0
            .children_it(false)
            .take_while(|_| self.1.is_none_or(View::checkpoint))
            .find(NodeRef::is_element)
            .map(|node| Self(node, self.1))
    }
    fn has_custom_state(&self, _name: &<Self::Impl as SelectorImpl>::Identifier) -> bool {
        false
    }
    fn add_element_unique_hashes(&self, _filter: &mut selectors::bloom::BloomFilter) -> bool {
        false
    }
    fn is_link(&self) -> bool {
        self.is_html_element_in_html_document()
            && (self.0.has_name("a") || self.0.has_name("area"))
            && self.0.has_null_attribute("href")
    }
    fn is_html_slot_element(&self) -> bool {
        self.is_html_element_in_html_document() && self.0.has_name("slot")
    }
    fn has_id(
        &self,
        name: &<Self::Impl as SelectorImpl>::Identifier,
        case: CaseSensitivity,
    ) -> bool {
        self.0
            .null_attribute_matches("id", |value| case.eq(name.as_bytes(), value.as_bytes()))
    }
    fn has_class(
        &self,
        name: &<Self::Impl as SelectorImpl>::Identifier,
        case: CaseSensitivity,
    ) -> bool {
        self.0.null_attribute_matches("class", |value| {
            value
                .split([' ', '\t', '\n', '\r', '\u{c}'])
                .any(|value| case.eq(name.as_bytes(), value.as_bytes()))
        })
    }
    fn imported_part(
        &self,
        _name: &<Self::Impl as SelectorImpl>::Identifier,
    ) -> Option<<Self::Impl as SelectorImpl>::Identifier> {
        None
    }
    fn is_part(&self, _name: &<Self::Impl as SelectorImpl>::Identifier) -> bool {
        false
    }
    fn is_empty(&self) -> bool {
        self.0.is_element()
            && !self
                .0
                .children_it(false)
                .take_while(|_| self.1.is_none_or(View::checkpoint))
                .any(|child| {
                    child.query_or(false, |node| match &node.data {
                        NodeData::Element(_) => true,
                        NodeData::Text { contents } => !contents.trim().is_empty(),
                        _ => false,
                    })
                })
    }
    fn is_root(&self) -> bool {
        self.0.parent().is_some_and(|node| node.is_document())
    }
}

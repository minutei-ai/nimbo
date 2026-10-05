use dom_query::NodeRef;
use selectors::{
    Element, OpaqueElement,
    attr::{AttrSelectorOperation, CaseSensitivity, NamespaceConstraint},
    context::{MatchingContext, SelectorCaches},
    matching::ElementSelectorFlags,
    parser::SelectorImpl,
};

use crate::dom_attributes::NativeAttributes;

type Impl = <NodeRef<'static> as Element>::Impl;
#[derive(Clone)]
pub(crate) struct Matcher(dom_query::Matcher);
impl Matcher {
    pub(crate) fn new(source: &str) -> crate::Result<Self> {
        dom_query::Matcher::new(source)
            .map(Self)
            .map_err(|error| crate::Error::Dom(format!("invalid selector: {error:?}")))
    }
    pub(crate) fn matches(&self, node: NodeRef<'_>) -> bool {
        self.0.match_element(&NativeElement(node))
    }
    pub(crate) fn select<'a>(
        &'a self,
        root: NodeRef<'a>,
    ) -> impl Iterator<Item = NodeRef<'a>> + 'a {
        let mut caches = SelectorCaches::default();
        root.descendants_it()
            .filter(NodeRef::is_element)
            .filter(move |node| {
                self.0
                    .match_element_with_caches(&NativeElement(*node), &mut caches)
            })
    }
}
#[derive(Clone, Copy, Debug)]
struct NativeElement<'a>(NodeRef<'a>);
impl Element for NativeElement<'_> {
    type Impl = Impl;
    fn opaque(&self) -> OpaqueElement {
        self.0.opaque()
    }
    fn parent_element(&self) -> Option<Self> {
        self.0.parent_element().map(Self)
    }
    fn parent_node_is_shadow_root(&self) -> bool {
        self.0.parent_node_is_shadow_root()
    }
    fn containing_shadow_host(&self) -> Option<Self> {
        self.0.containing_shadow_host().map(Self)
    }
    fn is_pseudo_element(&self) -> bool {
        self.0.is_pseudo_element()
    }
    fn prev_sibling_element(&self) -> Option<Self> {
        self.0.prev_sibling_element().map(Self)
    }
    fn next_sibling_element(&self) -> Option<Self> {
        self.0.next_sibling_element().map(Self)
    }
    fn is_html_element_in_html_document(&self) -> bool {
        self.0.is_html_element_in_html_document()
    }
    fn has_local_name(&self, name: &<Impl as SelectorImpl>::BorrowedLocalName) -> bool {
        self.0.has_local_name(name)
    }
    fn has_namespace(&self, namespace: &<Impl as SelectorImpl>::BorrowedNamespaceUrl) -> bool {
        self.0.has_namespace(namespace)
    }
    fn is_same_type(&self, other: &Self) -> bool {
        self.0.is_same_type(&other.0)
    }
    fn attr_matches(
        &self,
        namespace: &NamespaceConstraint<&<Impl as SelectorImpl>::NamespaceUrl>,
        name: &<Impl as SelectorImpl>::LocalName,
        operation: &AttrSelectorOperation<&<Impl as SelectorImpl>::AttrValue>,
    ) -> bool {
        self.0.attr_matches(namespace, name, operation)
    }
    fn match_non_ts_pseudo_class(
        &self,
        pseudo: &<Impl as SelectorImpl>::NonTSPseudoClass,
        context: &mut MatchingContext<'_, Impl>,
    ) -> bool {
        self.0.match_non_ts_pseudo_class(pseudo, context)
    }
    fn match_pseudo_element(
        &self,
        pseudo: &<Impl as SelectorImpl>::PseudoElement,
        context: &mut MatchingContext<'_, Impl>,
    ) -> bool {
        self.0.match_pseudo_element(pseudo, context)
    }
    fn is_link(&self) -> bool {
        self.0.is_link() && self.0.null_attribute("href").is_some()
    }
    fn is_html_slot_element(&self) -> bool {
        self.0.is_html_slot_element()
    }
    fn has_id(&self, name: &<Impl as SelectorImpl>::Identifier, case: CaseSensitivity) -> bool {
        self.0
            .null_attribute("id")
            .is_some_and(|value| case.eq(name.as_bytes(), value.as_bytes()))
    }
    fn has_class(&self, name: &<Impl as SelectorImpl>::LocalName, case: CaseSensitivity) -> bool {
        self.0.null_attribute("class").is_some_and(|value| {
            value
                .split_ascii_whitespace()
                .any(|value| case.eq(name.as_bytes(), value.as_bytes()))
        })
    }
    fn imported_part(
        &self,
        name: &<Impl as SelectorImpl>::Identifier,
    ) -> Option<<Impl as SelectorImpl>::Identifier> {
        self.0.imported_part(name)
    }
    fn is_part(&self, name: &<Impl as SelectorImpl>::Identifier) -> bool {
        self.0.is_part(name)
    }
    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    fn is_root(&self) -> bool {
        self.0.is_root()
    }
    fn first_element_child(&self) -> Option<Self> {
        self.0.first_element_child().map(Self)
    }
    fn apply_selector_flags(&self, flags: ElementSelectorFlags) {
        self.0.apply_selector_flags(flags);
    }
    fn has_custom_state(&self, name: &<Impl as SelectorImpl>::Identifier) -> bool {
        self.0.has_custom_state(name)
    }
    fn add_element_unique_hashes(&self, filter: &mut selectors::bloom::BloomFilter) -> bool {
        self.0.add_element_unique_hashes(filter)
    }
}

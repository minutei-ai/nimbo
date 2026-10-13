use dom_query::NodeRef;
use selectors::context::SelectorCaches;

use crate::dom::control_selectors::View;

#[derive(Clone)]
pub(crate) struct Matcher(crate::selectors::Matcher);

impl Matcher {
    pub(crate) fn new(source: &str) -> crate::Result<Self> {
        crate::selectors::Matcher::new(source)
            .map(Self)
            .map_err(|()| crate::Error::Dom("invalid selector".into()))
    }

    pub(crate) fn matches(&self, node: NodeRef<'_>, view: Option<&View<'_>>) -> bool {
        self.0.matches(node, view)
    }

    pub(crate) fn select<'a>(
        &'a self,
        root: NodeRef<'a>,
        view: Option<&'a View<'a>>,
    ) -> impl Iterator<Item = NodeRef<'a>> + 'a {
        let mut caches = SelectorCaches::default();
        root.descendants_it()
            .take_while(move |_| view.is_none_or(View::checkpoint))
            .filter(NodeRef::is_element)
            .filter(move |node| self.0.matches_with_caches(*node, view, &mut caches))
    }
}

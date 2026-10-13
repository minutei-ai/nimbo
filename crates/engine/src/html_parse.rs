use std::{borrow::Cow, cell::Cell};

use dom_query::{Document, NodeId};
use html5ever::{
    Attribute, ParseOpts, QualName,
    tendril::{ByteTendril, StrTendril, TendrilSink},
    tree_builder::{ElementFlags, NodeOrText, QuirksMode, TreeSink},
};

use crate::{Error, Result};

pub(crate) fn document(
    html: &str,
    maximum: usize,
    check: &dyn Fn() -> Result<()>,
) -> Result<Document> {
    let nodes = Cell::new(1_usize);
    let sink = Counted {
        document: Document::default(),
        nodes: &nodes,
        errors: Cell::new(0),
    };
    let mut options = ParseOpts::default();
    // Match the installed Document parser's existing noscript behavior.
    options.tree_builder.scripting_enabled = false;
    let mut parser = html5ever::parse_document(sink, options).from_utf8();
    for chunk in html.as_bytes().chunks(8192) {
        check()?;
        parser.process(ByteTendril::from_slice(chunk));
        if nodes.get() > maximum {
            return Err(Error::Limit("initial DOM nodes"));
        }
    }
    let document = parser.finish();
    check()?;
    if nodes.get() > maximum {
        return Err(Error::Limit("initial DOM nodes"));
    }
    Ok(document)
}

// Delegate tree construction to Document; retain only bounded error diagnostics.
struct Counted<'a> {
    document: Document,
    nodes: &'a Cell<usize>,
    errors: Cell<usize>,
}

impl Counted<'_> {
    fn allocate(&self, count: usize) {
        self.nodes.set(self.nodes.get().saturating_add(count));
    }
}

impl TreeSink for Counted<'_> {
    type Handle = NodeId;
    type Output = Document;
    type ElemName<'a>
        = <Document as TreeSink>::ElemName<'a>
    where
        Self: 'a;

    fn finish(self) -> Document {
        self.document
    }
    fn parse_error(&self, message: Cow<'static, str>) {
        if self.errors.get() < 128 {
            self.errors.set(self.errors.get().saturating_add(1));
            self.document.parse_error(message);
        }
    }
    fn get_document(&self) -> NodeId {
        self.document.get_document()
    }
    fn elem_name<'a>(&'a self, target: &'a NodeId) -> Self::ElemName<'a> {
        self.document.elem_name(target)
    }
    fn create_element(&self, name: QualName, attrs: Vec<Attribute>, flags: ElementFlags) -> NodeId {
        self.allocate(if flags.template { 2 } else { 1 });
        self.document.create_element(name, attrs, flags)
    }
    fn create_comment(&self, text: StrTendril) -> NodeId {
        self.allocate(1);
        self.document.create_comment(text)
    }
    fn create_pi(&self, target: StrTendril, data: StrTendril) -> NodeId {
        self.allocate(1);
        self.document.create_pi(target, data)
    }
    fn append(&self, parent: &NodeId, child: NodeOrText<NodeId>) {
        if matches!(&child, NodeOrText::AppendText(_))
            && !self
                .document
                .tree
                .last_child_of(parent)
                .is_some_and(|node| node.is_text())
        {
            self.allocate(1);
        }
        self.document.append(parent, child);
    }
    fn append_before_sibling(&self, sibling: &NodeId, child: NodeOrText<NodeId>) {
        if matches!(&child, NodeOrText::AppendText(_))
            && !self
                .document
                .tree
                .prev_sibling_of(sibling)
                .is_some_and(|node| node.is_text())
        {
            self.allocate(1);
        }
        self.document.append_before_sibling(sibling, child);
    }
    fn append_based_on_parent_node(
        &self,
        element: &NodeId,
        previous: &NodeId,
        child: NodeOrText<NodeId>,
    ) {
        if self.document.tree.parent_of(element).is_some() {
            self.append_before_sibling(element, child);
        } else {
            self.append(previous, child);
        }
    }
    fn append_doctype_to_document(
        &self,
        name: StrTendril,
        public_id: StrTendril,
        system_id: StrTendril,
    ) {
        self.allocate(1);
        self.document
            .append_doctype_to_document(name, public_id, system_id);
    }
    fn get_template_contents(&self, target: &NodeId) -> NodeId {
        self.document.get_template_contents(target)
    }
    fn same_node(&self, left: &NodeId, right: &NodeId) -> bool {
        self.document.same_node(left, right)
    }
    fn set_quirks_mode(&self, mode: QuirksMode) {
        self.document.set_quirks_mode(mode);
    }
    fn add_attrs_if_missing(&self, target: &NodeId, attrs: Vec<Attribute>) {
        self.document.add_attrs_if_missing(target, attrs);
    }
    fn remove_from_parent(&self, target: &NodeId) {
        self.document.remove_from_parent(target);
    }
    fn reparent_children(&self, node: &NodeId, parent: &NodeId) {
        self.document.reparent_children(node, parent);
    }
    fn is_mathml_annotation_xml_integration_point(&self, handle: &NodeId) -> bool {
        self.document
            .is_mathml_annotation_xml_integration_point(handle)
    }
}

#[cfg(test)]
mod tests {
    use super::document;
    use crate::Error;
    use dom_query::Document;
    use std::cell::Cell;

    #[test]
    fn native_recovery_and_utf8_chunk_boundaries_preserve_the_document() -> crate::Result<()> {
        for html in [
            "<table>before<tr><td>inside</td></tr>after</table>".to_owned(),
            format!("<p>{}😀&amp;tail</p>", "a".repeat(8188)),
            "<template><p>inert</p></template><math><annotation-xml encoding=text/html><p>mixed</p></annotation-xml></math>".to_owned(),
        ] {
            let actual = document(&html, 100, &|| Ok(()))?;
            assert_eq!(actual.html(), Document::from(html.as_str()).html());
        }
        Ok(())
    }

    #[test]
    fn node_budget_includes_implied_nodes_text_and_template_fragments() -> crate::Result<()> {
        document("<p></p>", 5, &|| Ok(()))?;
        assert!(matches!(
            document("<p></p>", 4, &|| Ok(())),
            Err(Error::Limit("initial DOM nodes"))
        ));
        document("<p>x</p>", 6, &|| Ok(()))?;
        assert!(matches!(
            document("<p>x</p>", 5, &|| Ok(())),
            Err(Error::Limit("initial DOM nodes"))
        ));
        document("<template></template>", 6, &|| Ok(()))?;
        assert!(matches!(
            document("<template></template>", 5, &|| Ok(())),
            Err(Error::Limit("initial DOM nodes"))
        ));
        Ok(())
    }

    #[test]
    fn stored_parse_errors_are_bounded_without_changing_recovery() -> crate::Result<()> {
        let html = "<!bad>".repeat(1000);
        let expected = Document::from(html.as_str());
        assert!(expected.errors.borrow().len() > 128);
        let actual = document(&html, 2000, &|| Ok(()))?;
        assert_eq!(actual.errors.borrow().len(), 128);
        assert_eq!(actual.html(), expected.html());
        Ok(())
    }

    #[test]
    fn large_inputs_stop_between_chunks_and_preserve_cancellation() {
        let checks = Cell::new(0_usize);
        let html = "<p>".repeat(100_000);
        let result = document(&html, 100, &|| {
            checks.set(checks.get().saturating_add(1));
            Ok(())
        });
        assert!(matches!(result, Err(Error::Limit("initial DOM nodes"))));
        assert_eq!(checks.get(), 1);
        let cancelled = document(&html, usize::MAX, &|| Err(Error::Cancelled));
        assert!(matches!(cancelled, Err(Error::Cancelled)));
    }
}

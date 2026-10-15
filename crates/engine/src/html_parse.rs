use std::{borrow::Cow, cell::Cell, rc::Rc};

use dom_query::{Document, NodeData, NodeId};
use html5ever::{
    Attribute, ParseOpts, QualName,
    tendril::{ByteTendril, StrTendril, TendrilSink, fmt},
    tree_builder::{ElementFlags, NodeOrText, QuirksMode, TreeSink},
};

use crate::{Error, Result};

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn document(
    html: &str,
    maximum: usize,
    check: &dyn Fn() -> Result<()>,
) -> Result<ParsedDocument> {
    let mut parser = DocumentParser::new(maximum);
    for chunk in html.as_bytes().chunks(8192) {
        check()?;
        parser.process(chunk)?;
    }
    let parsed = parser.finish()?;
    check()?;
    Ok(parsed)
}

#[derive(Clone, Copy, Default)]
pub(crate) struct ControlTags {
    pub inputs: bool,
    pub options: bool,
}

pub(crate) struct ParsedDocument {
    pub document: Rc<Document>,
    pub nodes: Rc<Cell<usize>>,
    pub links: bool,
    pub bases: bool,
    pub controls: ControlTags,
}

#[derive(Clone, Copy, Default)]
struct Tags {
    links: bool,
    bases: bool,
    controls: ControlTags,
    last_parent: Option<NodeId>,
}

pub(crate) struct DocumentParser {
    document: Rc<Document>,
    nodes: Rc<Cell<usize>>,
    tags: Rc<Cell<Tags>>,
    maximum: usize,
    parser: OwnedParser,
}

type OwnedParser = html5ever::tendril::stream::Utf8LossyDecoder<html5ever::Parser<Counted>>;

impl DocumentParser {
    pub(crate) fn new(maximum: usize) -> Self {
        let document = Rc::new(Document::default());
        let nodes = Rc::new(Cell::new(1));
        let tags = Rc::new(Cell::new(Tags::default()));
        let sink = Counted {
            root: document.get_document(),
            document: Rc::clone(&document),
            nodes: Rc::clone(&nodes),
            errors: Cell::new(0),
            initial: true,
            tags: Some(Rc::clone(&tags)),
        };
        let mut options = ParseOpts::default();
        // Match the installed Document parser's existing noscript behavior.
        options.tree_builder.scripting_enabled = false;
        let parser = html5ever::parse_document(sink, options).from_utf8();
        Self {
            document,
            nodes,
            tags,
            maximum,
            parser,
        }
    }

    pub(crate) fn process(&mut self, bytes: &[u8]) -> Result<()> {
        self.parser.process(ByteTendril::from_slice(bytes));
        self.validate()
    }

    fn validate(&self) -> Result<()> {
        if self.nodes.get() > self.maximum {
            return Err(Error::Limit("initial DOM nodes"));
        }
        Ok(())
    }

    #[cfg(any(target_arch = "wasm32", test))]
    pub(crate) fn needs_yield(&self) -> bool {
        self.tags
            .get()
            .last_parent
            .and_then(|id| self.document.tree.get(&id))
            .is_some_and(|node| node.ancestors_it(None).take(128).count() == 128)
    }

    pub(crate) fn finish(self) -> Result<ParsedDocument> {
        self.parser.finish();
        if self.nodes.get() > self.maximum {
            return Err(Error::Limit("initial DOM nodes"));
        }
        let tags = self.tags.get();
        Ok(ParsedDocument {
            document: self.document,
            nodes: self.nodes,
            links: tags.links,
            bases: tags.bases,
            controls: tags.controls,
        })
    }
}

/// Parses `html` as the children of `context`, per the HTML fragment algorithm.
pub(crate) fn fragment(
    document: &Rc<Document>,
    html: &str,
    context: QualName,
    maximum: usize,
    check: &dyn Fn() -> Result<()>,
    nodes: &Rc<Cell<usize>>,
) -> Result<NodeId> {
    if nodes.get() >= maximum {
        return Err(Error::Limit("DOM nodes"));
    }
    nodes.set(nodes.get().saturating_add(1));
    let root = document.tree.create_node(NodeData::Fragment);
    let sink = Counted {
        document: Rc::clone(document),
        root,
        nodes: Rc::clone(nodes),
        errors: Cell::new(0),
        initial: false,
        tags: None,
    };
    let mut options = ParseOpts::default();
    options.tree_builder.scripting_enabled = false;
    options.tree_builder.drop_doctype = true;
    let parser = html5ever::parse_fragment(sink, options, context, Vec::new(), false).from_utf8();
    feed(parser, html, maximum, check, nodes, "DOM nodes")?;
    document
        .tree
        .first_child_of(&root)
        .map(|node| node.id)
        .ok_or_else(|| Error::Dom("missing native fragment root".into()))
}

fn feed(
    mut parser: impl TendrilSink<fmt::Bytes, Output = ()>,
    html: &str,
    maximum: usize,
    check: &dyn Fn() -> Result<()>,
    nodes: &Cell<usize>,
    label: &'static str,
) -> Result<()> {
    for chunk in html.as_bytes().chunks(8192) {
        check()?;
        parser.process(ByteTendril::from_slice(chunk));
        if nodes.get() > maximum {
            return Err(Error::Limit(label));
        }
    }
    parser.finish();
    check()?;
    if nodes.get() > maximum {
        return Err(Error::Limit(label));
    }
    Ok(())
}

// Delegate tree construction to Document; retain only bounded error diagnostics.
struct Counted {
    document: Rc<Document>,
    root: NodeId,
    nodes: Rc<Cell<usize>>,
    errors: Cell<usize>,
    initial: bool,
    tags: Option<Rc<Cell<Tags>>>,
}

impl Counted {
    fn allocate(&self, count: usize) {
        self.nodes.set(self.nodes.get().saturating_add(count));
    }

    fn parent(&self, parent: NodeId) {
        if let Some(tags) = &self.tags {
            let mut value = tags.get();
            value.last_parent = Some(parent);
            tags.set(value);
        }
    }
}

impl TreeSink for Counted {
    type Handle = NodeId;
    type Output = ();
    type ElemName<'a>
        = <Document as TreeSink>::ElemName<'a>
    where
        Self: 'a;

    fn finish(self) {}
    fn parse_error(&self, message: Cow<'static, str>) {
        if self.initial && self.errors.get() < 128 {
            self.errors.set(self.errors.get().saturating_add(1));
            self.document.parse_error(message);
        }
    }
    fn get_document(&self) -> NodeId {
        self.root
    }
    fn elem_name<'a>(&'a self, target: &'a NodeId) -> Self::ElemName<'a> {
        self.document.elem_name(target)
    }
    fn create_element(&self, name: QualName, attrs: Vec<Attribute>, flags: ElementFlags) -> NodeId {
        if let Some(tags) = &self.tags {
            let mut value = tags.get();
            value.links |=
                name.ns == html5ever::ns!(html) && name.local == html5ever::local_name!("link");
            value.controls.options |=
                name.ns == html5ever::ns!(html) && name.local == html5ever::local_name!("option");
            value.controls.inputs |=
                name.ns == html5ever::ns!(html) && name.local == html5ever::local_name!("input");
            value.bases |=
                name.ns == html5ever::ns!(html) && name.local == html5ever::local_name!("base");
            tags.set(value);
        }
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
        self.parent(*parent);
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
        if let Some(parent) = self.document.tree.parent_of(sibling) {
            self.parent(parent.id);
        }
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
        if self.initial {
            self.document.set_quirks_mode(mode);
        }
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
    use crate::Error;
    use dom_query::Document;
    use std::{cell::Cell, rc::Rc};

    #[test]
    fn incremental_blocks_preserve_utf8_recovery_and_native_tags() -> crate::Result<()> {
        let html = format!(
            "<!doctype html><base href=/next/><link rel=stylesheet href=/style.css><p>{}😀&amp;tail</p><table>before<tr><td>x</table>",
            "x".repeat(8200)
        );
        let expected = Document::from(html.as_str());
        for size in [1, 7, 8192] {
            let mut parser = super::DocumentParser::new(100);
            for bytes in html.as_bytes().chunks(size) {
                parser.process(bytes)?;
            }
            let parsed = parser.finish()?;
            assert_eq!(parsed.document.html(), expected.html());
            assert!(parsed.links && parsed.bases);
        }
        Ok(())
    }

    #[test]
    fn dropping_failed_incremental_parser_releases_its_document() {
        let mut parser = super::DocumentParser::new(5);
        let retained = Rc::downgrade(&parser.document);
        assert!(matches!(
            parser.process(b"<p><p>"),
            Err(Error::Limit("initial DOM nodes"))
        ));
        drop(parser);
        assert!(retained.upgrade().is_none());
    }

    #[test]
    fn yielding_tracks_native_ancestry_without_per_node_state() -> crate::Result<()> {
        let mut shallow = super::DocumentParser::new(1000);
        shallow.process("<p>x</p>".repeat(250).as_bytes())?;
        assert!(!shallow.needs_yield());
        let mut deep = super::DocumentParser::new(1000);
        deep.process("<div>".repeat(256).as_bytes())?;
        assert!(deep.needs_yield());
        Ok(())
    }

    fn document(
        html: &str,
        maximum: usize,
        check: &dyn Fn() -> crate::Result<()>,
    ) -> crate::Result<Rc<Document>> {
        super::document(html, maximum, check).map(|parsed| parsed.document)
    }

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
    fn fragments_in_the_owned_arena_preserve_native_serialization() -> crate::Result<()> {
        for html in [
            "<p>text</p><!--tail-->",
            "<table><tr><td>x</td></tr></table>",
            "<template><b>nested</b></template><svg><g/></svg>",
            "",
            "Olá 😀 &amp; tail",
        ] {
            let initial = "<!doctype html><main id=target><i>old</i></main>";
            let expected = Document::from(initial);
            expected
                .select("#target")
                .nodes()
                .first()
                .copied()
                .ok_or_else(|| Error::Dom("missing target".into()))?
                .set_html(html);
            let actual = document(initial, 100, &|| Ok(()))?;
            let target = actual
                .select("#target")
                .nodes()
                .first()
                .copied()
                .ok_or_else(|| Error::Dom("missing target".into()))?
                .id;
            let nodes = Rc::new(Cell::new(10));
            let body = html5ever::QualName::new(
                None,
                html5ever::ns!(html),
                html5ever::local_name!("body"),
            );
            let root = super::fragment(&actual, html, body, 100, &|| Ok(()), &nodes)?;
            actual.tree.remove_children_of(&target);
            actual.tree.reparent_children_of(&root, Some(target));
            assert_eq!(actual.html(), expected.html());
            assert!(nodes.get() >= 13);
        }
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

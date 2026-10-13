use crate::dom_attributes::NativeAttributes;
use std::collections::HashMap;

use crate::dom_selectors::Matcher;
use dom_query::{Document, NodeData, NodeId, NodeRef};
use serde_json::{Value, json};

use crate::{Error, Limits, Result};

#[path = "dom_attribute_nodes.rs"]
mod attribute_nodes;
#[path = "dom_controls.rs"]
mod controls;
#[path = "dom_documents.rs"]
mod documents;
#[path = "dom_history.rs"]
mod history;
#[path = "dom_mutations.rs"]
mod mutations;
#[path = "dom_shadow.rs"]
mod shadow;

#[derive(Clone, Copy)]
enum Handle {
    Node(NodeId),
    Attribute,
}

struct NamedProperties {
    nodes: HashMap<String, Vec<NodeId>>,
}

pub(crate) struct Dom {
    pub document: std::rc::Rc<Document>,
    pub fonts: std::rc::Rc<std::cell::RefCell<crate::font_data::Arena>>,
    handles: Vec<Handle>,
    ids: HashMap<NodeId, usize>,
    // Cache compiled selectors only; DOM results must always reflect mutations.
    matchers: HashMap<String, Matcher>,
    named: Option<NamedProperties>,
    attribute_nodes: attribute_nodes::Arena,
    documents: documents::Arena,
    shadow: shadow::Arena,
    history: history::Arena,
    mutations: std::cell::RefCell<mutations::Arena>,
    styles: HashMap<NodeId, crate::styles::Declarations>,
    computed_styles: HashMap<NodeId, crate::computed_style::Computed>,
    cascade: Option<std::rc::Rc<crate::cascade::Cascade>>,
    transitions: std::cell::RefCell<crate::transitions::State>,
    now: f64,
    style_bytes: usize,
    operations: usize,
    allocated_nodes: std::rc::Rc<std::cell::Cell<usize>>,
    control_values: HashMap<NodeId, String>,
    check: crate::BudgetCheck,
    layout_version: usize,
    layout: Option<(usize, crate::layout::Snapshot)>,
    scroll: crate::layout::ScrollState,
    sheet_scan: Option<usize>,
    // Conservative presence guard: HTML parsing and element creation are the only name producers.
    may_have_links: bool,
    may_have_bases: bool,
    sheets: crate::stylesheets::Sheets,
    cssom: crate::cssom::Arena,
    writes: usize,
    limits: Limits,
    media: crate::MediaEnvironment,
}

impl Dom {
    #[cfg(not(target_arch = "wasm32"))]
    pub(crate) fn new(
        html: &str,
        limits: Limits,
        media: crate::MediaEnvironment,
        base: url::Url,
        check: crate::BudgetCheck,
    ) -> Result<Self> {
        let parsed = crate::html_parse::document(
            html,
            limits.max_initial_dom_nodes.min(limits.max_dom_nodes),
            check.as_ref(),
        )?;
        Ok(Self::from_document(parsed, limits, media, base, check))
    }

    pub(crate) fn from_document(
        parsed: crate::html_parse::ParsedDocument,
        limits: Limits,
        media: crate::MediaEnvironment,
        base: url::Url,
        check: crate::BudgetCheck,
    ) -> Self {
        let document = parsed.document;
        let allocated_nodes = parsed.nodes;
        let root = document.root().id;
        Self {
            document,
            fonts: std::rc::Rc::default(),
            handles: vec![Handle::Node(root)],
            ids: HashMap::from([(root, 0)]),
            matchers: HashMap::new(),
            named: None,
            attribute_nodes: attribute_nodes::Arena::default(),
            documents: documents::Arena::default(),
            shadow: shadow::Arena::default(),
            history: history::Arena::new(base.clone()),
            mutations: std::cell::RefCell::default(),
            styles: HashMap::new(),
            computed_styles: HashMap::new(),
            cascade: None,
            transitions: std::cell::RefCell::default(),
            now: 0.0,
            style_bytes: 0,
            operations: 0,
            allocated_nodes,
            control_values: HashMap::new(),
            check,
            layout_version: 0,
            layout: None,
            scroll: crate::layout::ScrollState::new(),
            sheet_scan: None,
            may_have_links: parsed.links,
            may_have_bases: parsed.bases,
            sheets: crate::stylesheets::Sheets::new(base, limits.max_stylesheet_bytes),
            cssom: crate::cssom::Arena::default(),
            writes: 0,
            limits,
            media,
        }
    }

    pub(crate) fn resource_usage(&self) -> (usize, usize, usize) {
        (self.operations, self.writes, self.handles.len())
    }

    fn allocate_node(&self) -> Result<()> {
        if self.allocated_nodes.get() >= self.limits.max_dom_nodes {
            return Err(Error::Limit("DOM nodes"));
        }
        self.allocated_nodes
            .set(self.allocated_nodes.get().saturating_add(1));
        Ok(())
    }

    pub(crate) fn advance(&mut self, now: f64) {
        self.now = now;
        if self.transitions.borrow().active() {
            self.layout_version = self.layout_version.saturating_add(1);
            self.computed_styles.clear();
        }
    }

    pub(crate) fn document_url(&self) -> &url::Url {
        self.history.url()
    }

    fn arena_call(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<Option<Value>> {
        match operation {
            "history" if handle == 0 => self.history_call(arg, value).map(Some),
            "history" => Err(Error::Dom("invalid history receiver".into())),
            "mutation" => self.mutation_call(handle, arg, value).map(Some),
            _ => Ok(None),
        }
    }

    fn handle(&mut self, id: NodeId) -> usize {
        register_handle(&mut self.handles, &mut self.ids, id)
    }

    fn node_id(&self, handle: usize) -> Result<NodeId> {
        match self.handles.get(handle) {
            Some(Handle::Node(id)) => Ok(*id),
            _ => Err(Error::Dom("invalid tree node handle".into())),
        }
    }
    fn node(&self, handle: usize) -> Result<NodeRef<'_>> {
        self.document
            .tree
            .get(&self.node_id(handle)?)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))
    }

    fn unchanged_attribute(&self, operation: &str, handle: usize, arg: &str, value: &str) -> bool {
        let Ok(node) = self.node(handle) else {
            return false;
        };
        let old = match operation {
            "setAttr" | "removeAttr" => {
                crate::dom_attributes::named(node, arg, self.html_document(node.id))
            }
            "setAttrNS" | "removeAttrNS" => {
                let Ok([namespace, name]) = serde_json::from_str::<[String; 2]>(arg) else {
                    return false;
                };
                let local = if operation == "setAttrNS" {
                    name.split_once(':')
                        .map_or(name.as_str(), |(_, local)| local)
                } else {
                    name.as_str()
                };
                crate::dom_attributes::namespaced(node, &namespace, local)
            }
            _ => return false,
        };
        if matches!(operation, "removeAttr" | "removeAttrNS") {
            old.is_none()
        } else {
            old.as_deref() == Some(value)
        }
    }

    fn charge_pending_work(&mut self) -> Result<()> {
        self.operations = self
            .operations
            .saturating_add(self.history.work.replace(0))
            .saturating_add(std::mem::take(&mut self.mutations.borrow_mut().work));
        if self.operations > self.limits.max_dom_operations {
            return Err(Error::Limit("DOM operations"));
        }
        Ok(())
    }
    fn begin(&mut self, operation: &str, handle: usize, arg: &str, value: &str) -> Result<()> {
        self.charge_pending_work()?;
        if self.operations >= self.limits.max_dom_operations {
            return Err(Error::Limit("DOM operations"));
        }
        self.operations = self.operations.saturating_add(1);
        // Preserve work caches for identical writes; mutation callbacks still run.
        if matches!(
            operation,
            "setAttr" | "removeAttr" | "setAttrNS" | "removeAttrNS"
        ) && self.unchanged_attribute(operation, handle, arg, value)
        {
            return Ok(());
        }
        if matches!(
            operation,
            "set"
                | "setControlValue"
                | "attachShadow"
                | "setAttr"
                | "removeAttr"
                | "setAttrNS"
                | "removeAttrNS"
                | "append"
                | "insert"
                | "replace"
                | "removeChild"
                | "remove"
        ) || (operation == "style" && matches!(arg, "set" | "remove" | "text"))
        {
            let names_changed = if matches!(operation, "setAttr" | "removeAttr") {
                arg.eq_ignore_ascii_case("id") || arg.eq_ignore_ascii_case("name")
            } else {
                !matches!(operation, "style" | "setControlValue")
            };
            if names_changed {
                self.named = None;
            }
            self.layout_version = self.layout_version.saturating_add(1);
            self.computed_styles.clear();
            let inline_style = operation == "style"
                || (matches!(operation, "setAttr" | "removeAttr") && arg == "style");
            let irrelevant_attribute = matches!(operation, "setAttr" | "removeAttr")
                && self.node(handle).is_ok_and(|node| {
                    !["style", "link", "base"]
                        .iter()
                        .any(|name| node.has_name(name))
                })
                && self
                    .cascade
                    .as_ref()
                    .is_some_and(|cascade| !cascade.references_attribute(arg));
            if !(inline_style || irrelevant_attribute) {
                self.cascade = None;
            }
        }
        Ok(())
    }

    pub(crate) fn call(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<String> {
        let version = self.layout_version;
        self.begin(operation, handle, arg, value)?;
        if let Some(result) = self.arena_call(operation, handle, arg, value)? {
            return self.finish(&result, version);
        }
        if matches!(self.handles.get(handle), Some(Handle::Attribute)) {
            let result = self.attribute_node_call(operation, handle, arg, value)?;
            return self.finish(&result, version);
        }
        let owner = self.sync_attribute_owner(operation, handle)?;
        let fallback_slots = self.fallback_slot_targets(operation, handle, arg, value);
        let result = match operation {
            "controlValue" | "setControlValue" | "controlDefault" => {
                self.control_call(operation, handle, arg, value)?
            }
            "newDocument" => self.new_document(handle, value)?,
            "attachShadow" | "shadowRoot" | "shadowInfo" | "rootNode" | "shadowContains"
            | "elementById" | "assignedSlot" | "slotNodes" | "slotChanges" => {
                self.shadow_call(operation, handle, arg)?
            }
            "attributeNode" => self.attribute_node_bridge(handle, arg, value)?,
            "cssom" => self.cssom_call(handle, arg, value)?,
            "styleSheet" => self.style_sheet(handle)?,
            "styleSheets" => self.style_sheets(handle)?,
            "windowNamed" => self.window_named(arg)?,
            "baseHref" => json!(self.base_href()?),
            "fontFaces" => self.font_faces()?,
            "cssSupports" => json!(crate::supports::query(arg)?),
            "cssSupportsValue" => json!(crate::supports::value(arg, value)?),
            "fontResources" => self.synchronize_fonts(arg)?,
            "bounds" => self.bounds(handle)?,
            "geometry" => self.geometry(handle, arg, value)?,
            "computedStyle" => self.computed_style(handle, arg, value)?,
            "layoutVersion" => json!(self.layout_version),
            "observerMargin" => serde_json::to_value(crate::layout::Margins::parse(arg)?)?,
            "observerMeasure" => self.observe(handle, arg)?,
            "query" => self.query(handle, arg)?,
            "customCandidates" => self.custom_candidates(handle, arg)?,
            "queryOne" => self.query_one(handle, arg)?,
            "children" => self.children(handle, arg)?,
            "matches" => {
                let matcher = self.matcher(arg)?;
                json!(matcher.matches(self.node(handle)?))
            }
            "closest" => self.closest(handle, arg)?,
            "parentElement" => {
                let id = self
                    .node(handle)?
                    .parent()
                    .filter(NodeRef::is_element)
                    .map(|parent| parent.id);
                json!(id.map(|id| self.handle(id)))
            }
            "relativeElement" => self.relative_element(handle, arg)?,
            "relativeNode" => self.relative_node(handle, arg)?,
            "createText" | "createComment" => self.create_character(handle, operation, value)?,
            "createFragment" => self.create_fragment(handle)?,
            "contains" => self.contains(handle, arg)?,
            "create" => self.create(handle, arg)?,
            "createNS" => self.create_ns(handle, arg, value)?,
            "get" if matches!(arg, "innerHTML" | "outerHTML") => self.serialize(handle, arg)?,
            "get" => self.get(handle, arg)?,
            "attributes" => self.attribute_metadata(handle)?,
            "attr" | "attrInfo" | "attrNS" | "setAttrNS" | "removeAttrNS" | "attributeNames" => {
                self.attribute_call(operation, handle, arg, value)?
            }
            "style" => self.style(handle, arg, value)?,
            "set" | "setAttr" | "removeAttr" => {
                self.write_value(operation, handle, arg, value)?;
                Value::Null
            }
            "append" | "insert" | "replace" => self.insert(operation, handle, arg, value)?,
            "removeChild" => self.remove_child(handle, value)?,
            "remove" => self.remove_node(handle)?,
            _ => {
                return Err(Error::Dom(format!(
                    "unsupported DOM operation: {operation}"
                )));
            }
        };
        if let Some(owner) = owner {
            self.sync_attributes(owner);
        }
        self.history_base_mutation(operation, handle, arg, value)?;
        self.sync_control_value(operation, handle)?;
        self.signal_fallback_slots(&fallback_slots);
        self.finish(&result, version)
    }

    fn contains(&self, handle: usize, descendant: &str) -> Result<Value> {
        let descendant = descendant
            .parse::<usize>()
            .map_err(|error| Error::Dom(error.to_string()))?;
        if matches!(self.handles.get(descendant), Some(Handle::Attribute)) {
            return Ok(json!(false));
        }
        let parent = self.node(handle)?;
        let descendant = self.node(descendant)?;
        Ok(json!(
            parent.id == descendant.id
                || descendant
                    .ancestors_it(None)
                    .any(|node| node.id == parent.id)
        ))
    }

    fn synchronize_fonts(&mut self, source: &str) -> Result<Value> {
        if self.fonts.borrow_mut().synchronize(source)? {
            self.layout_version = self.layout_version.saturating_add(1);
            self.computed_styles.clear();
        }
        Ok(Value::Null)
    }
    fn attribute_metadata(&self, handle: usize) -> Result<Value> {
        Ok(json!(
            self.node(handle)?
                .attrs()
                .into_iter()
                .map(|attribute| (
                    attribute.name.local.to_string(),
                    attribute.value.to_string(),
                    if attribute.name.ns.is_empty() {
                        None
                    } else {
                        Some(attribute.name.ns.to_string())
                    }
                ))
                .collect::<Vec<_>>()
        ))
    }

    fn serialize(&mut self, handle: usize, property: &str) -> Result<Value> {
        let id = self.node_id(handle)?;
        let node = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        Ok(json!(crate::dom_serialization::serialize(
            node,
            property == "outerHTML",
            &mut self.operations,
            self.limits.max_dom_operations,
            self.limits.max_dom_write_bytes,
        )?))
    }

    fn create(&mut self, owner: usize, name: &str) -> Result<Value> {
        if !valid_element_name(name) {
            return Err(Error::DomException {
                name: "InvalidCharacterError",
                message: "invalid element name",
            });
        }
        self.charge_write(name.len())?;
        self.may_have_links |= name.eq_ignore_ascii_case("link");
        self.may_have_bases |= name.eq_ignore_ascii_case("base");
        let document = self.document_id(owner)?;
        let html = self
            .documents
            .kinds
            .get(&document)
            .is_none_or(|kind| kind.html);
        let name = if html {
            name.to_ascii_lowercase()
        } else {
            name.to_owned()
        };
        self.allocate_node()?;
        let node = self.document.tree.new_element(&name);
        if !html {
            node.update(|node| {
                if let NodeData::Element(element) = &mut node.data {
                    element.name.ns = "".into();
                }
            });
        }
        let id = node.id;
        self.own_node(owner, id)?;
        Ok(json!(self.handle(id)))
    }

    fn create_ns(&mut self, owner: usize, name: &str, namespace: &str) -> Result<Value> {
        let (prefix, local) = name
            .split_once(':')
            .map_or((None, name), |(prefix, local)| (Some(prefix), local));
        if !valid_element_name(local)
            || prefix.is_some_and(|value| {
                value.is_empty()
                    || value.chars().any(|character| {
                        matches!(
                            character,
                            '\t' | '\n' | '\r' | '\u{c}' | ' ' | '\0' | '/' | '>'
                        )
                    })
            })
        {
            return Err(Error::DomException {
                name: "InvalidCharacterError",
                message: "invalid qualified element name",
            });
        }
        let xml = "http://www.w3.org/XML/1998/namespace";
        let xmlns = "http://www.w3.org/2000/xmlns/";
        if (prefix.is_some() && namespace.is_empty())
            || (prefix == Some("xml") && namespace != xml)
            || ((name == "xmlns" || prefix == Some("xmlns")) && namespace != xmlns)
            || (namespace == xmlns && name != "xmlns" && prefix != Some("xmlns"))
        {
            return Err(Error::DomException {
                name: "NamespaceError",
                message: "inconsistent element namespace",
            });
        }
        self.charge_write(name.len().saturating_add(namespace.len()))?;
        self.may_have_links |=
            namespace == "http://www.w3.org/1999/xhtml" && local.eq_ignore_ascii_case("link");
        self.may_have_bases |= local.eq_ignore_ascii_case("base");
        self.allocate_node()?;
        let node = self.document.tree.new_element(local);
        node.update(|node| {
            if let NodeData::Element(element) = &mut node.data {
                element.name.ns = namespace.into();
                element.name.prefix = prefix.map(Into::into);
            }
        });
        let id = node.id;
        self.own_node(owner, id)?;
        Ok(json!(self.handle(id)))
    }

    fn finish(&mut self, result: &Value, version: usize) -> Result<String> {
        self.charge_pending_work()?;
        if version != self.layout_version {
            self.refresh_slots()?;
            let mut work = crate::layout::Work::new(
                &mut self.operations,
                self.limits.max_dom_operations,
                self.limits.max_layout_nodes,
            );
            self.sheets.disconnect(&self.document, &mut work)?;
        }
        Ok(serde_json::to_string(result)?)
    }

    pub(crate) fn next_sheet(&mut self) -> Result<Option<(usize, String)>> {
        self.charge_pending_work()?;
        if self.sheet_scan == Some(self.layout_version) {
            return Ok(None);
        }
        if !self.may_have_links {
            self.sheet_scan = Some(self.layout_version);
            return Ok(None);
        }
        let base = self.base_href()?;
        let mut work = crate::layout::Work::new(
            &mut self.operations,
            self.limits.max_dom_operations,
            self.limits.max_layout_nodes,
        );
        let request = self
            .sheets
            .next(&self.document, base.as_deref(), &mut work)?;
        if let Some((id, url)) = request {
            return Ok(Some((self.handle(id), url)));
        }
        self.sheet_scan = Some(self.layout_version);
        Ok(None)
    }
    pub(crate) fn sheet_response(
        &mut self,
        handle: usize,
        url: String,
        response: Option<&crate::machine::Response>,
    ) -> Result<bool> {
        let id = self.node(handle)?.id;
        let success = self.sheets.respond(id, url, response)?;
        self.layout_version = self.layout_version.saturating_add(1);
        self.computed_styles.clear();
        self.cascade = None;
        Ok(success)
    }

    fn ensure_cascade(&mut self) -> Result<std::rc::Rc<crate::cascade::Cascade>> {
        if let Some(cascade) = &self.cascade {
            return Ok(std::rc::Rc::clone(cascade));
        }
        let base = self.base_href()?;
        let mut work = crate::layout::Work::new(
            &mut self.operations,
            self.limits.max_dom_operations,
            self.limits.max_layout_nodes,
        );
        let cascade = std::rc::Rc::new(crate::cascade::Cascade::collect(
            &self.document,
            &self.sheets,
            &self.cssom,
            base.as_deref(),
            &self.media,
            &mut work,
        )?);
        self.cascade = Some(std::rc::Rc::clone(&cascade));
        Ok(cascade)
    }
    fn font_faces(&mut self) -> Result<Value> {
        let cascade = self.ensure_cascade()?;
        Ok(serde_json::to_value(&cascade.font_faces.values)?)
    }

    fn computed_style(&mut self, handle: usize, operation: &str, name: &str) -> Result<Value> {
        self.shadow_style_guard(self.node_id(handle)?)?;
        let property_name = crate::styles::property_name(name);
        let name = property_name.as_str();
        let node_id = self.node_id(handle)?;
        let node = self
            .document
            .tree
            .get(&node_id)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        if !node.is_element() {
            return Err(Error::Dom("computed style requires an element".into()));
        }
        let attached = node.ancestors_it(None).any(|node| node.is_document());
        if operation == "name" {
            return Ok(
                json!({"entries":[],"css_text":"","value":if crate::styles::known_name(name) { "true" } else { "" },"important":false,"changed":false}),
            );
        }
        let properties = if attached {
            crate::computed_style::PROPERTIES.as_slice()
        } else {
            &[]
        };
        let mut value = String::new();
        if operation == "get" && !name.is_empty() && attached {
            if (crate::styles::known_name(name) || name.starts_with("--"))
                && !crate::computed_style::property(name)
            {
                return Err(Error::Dom(format!(
                    "layout unsupported: computed style {name}"
                )));
            }
            if crate::computed_style::property(name) {
                let id = node.id;
                let cascade = self.ensure_cascade()?;
                let node = self
                    .document
                    .tree
                    .get(&id)
                    .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
                if !self.computed_styles.contains_key(&id) {
                    let mut work = crate::layout::Work::new(
                        &mut self.operations,
                        self.limits.max_dom_operations,
                        self.limits.max_layout_nodes,
                    );
                    let values = crate::computed_style::resolve(
                        node,
                        &crate::layout::Sources {
                            scroll: &self.scroll,
                            transitions: &self.transitions,
                            now: self.now,
                            inline: &self.styles,
                            cascade: &cascade,
                            fonts: &self.fonts,
                        },
                        &self.media,
                        &mut work,
                    )?;
                    self.computed_styles.insert(id, values);
                }
                if crate::layout::resolved::property(name)
                    && self
                        .computed_styles
                        .get(&id)
                        .is_some_and(|style| style.used_box.is_none())
                {
                    let mut work = crate::layout::Work::new(
                        &mut self.operations,
                        self.limits.max_dom_operations,
                        self.limits.max_layout_nodes,
                    );
                    let values = crate::layout::resolved::resolve(
                        &self.document,
                        node,
                        &crate::layout::Sources {
                            scroll: &self.scroll,
                            transitions: &self.transitions,
                            now: self.now,
                            inline: &self.styles,
                            cascade: &cascade,
                            fonts: &self.fonts,
                        },
                        &self.media,
                        &mut work,
                    )?;
                    self.computed_styles
                        .get_mut(&id)
                        .ok_or_else(|| Error::Dom("missing computed style".into()))?
                        .used_box = Some(values);
                }
                value = self
                    .computed_styles
                    .get(&id)
                    .ok_or_else(|| Error::Dom("missing computed style".into()))?
                    .value(name)?;
            }
        }
        Ok(Self::computed_metadata(properties, &value))
    }

    fn computed_metadata(properties: &[&str], value: &str) -> Value {
        json!({"entries":properties.iter().map(|name|json!({"name":name,"value":"","important":false})).collect::<Vec<_>>(),"css_text":"","value":value,"important":false,"changed":false})
    }

    fn observe(&mut self, handle: usize, request: &str) -> Result<Value> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            root: Option<usize>,
            margin: crate::layout::Margins,
        }
        let request: Request = serde_json::from_str(request)?;
        let target_id = self.node_id(handle)?;
        let root_id = request
            .root
            .filter(|handle| *handle != 0)
            .map(|handle| self.node_id(handle))
            .transpose()?;
        self.ensure_layout()?;
        let target = self
            .document
            .tree
            .get(&target_id)
            .ok_or_else(|| Error::Dom("invalid target node".into()))?;
        let root = root_id
            .map(|id| {
                self.document
                    .tree
                    .get(&id)
                    .ok_or_else(|| Error::Dom("invalid root node".into()))
            })
            .transpose()?;
        let mut work = crate::layout::Work::new(
            &mut self.operations,
            self.limits.max_dom_operations,
            self.limits.max_layout_nodes,
        );
        let (_, layout) = self
            .layout
            .as_ref()
            .ok_or_else(|| Error::Dom("missing native layout snapshot".into()))?;
        let observation =
            layout.observation(target, root, &request.margin, &self.media, &mut work)?;
        Ok(serde_json::to_value(observation)?)
    }

    fn geometry(&mut self, handle: usize, name: &str, value: &str) -> Result<Value> {
        let target = self.node(handle)?;
        if !target.is_element() {
            return Err(Error::Dom("geometry requires an element".into()));
        }
        // Viewport scrolling has a separate owner and cannot use element state.
        if target.has_name("html") {
            return Err(Error::Dom("layout unsupported: viewport geometry".into()));
        }
        let id = target.id;
        self.ensure_layout()?;
        let measured = self
            .layout
            .as_ref()
            .ok_or_else(|| Error::Dom("missing layout snapshot".into()))?
            .1
            .measurement(
                self.document
                    .tree
                    .get(&id)
                    .ok_or_else(|| Error::Dom("invalid node handle".into()))?,
            )?;
        if name == "offsetParent" {
            return Ok(json!(measured.parent.map(|id| self.handle(id))));
        }
        if !value.is_empty() && matches!(name, "scrollTop" | "scrollLeft") {
            let requested = value
                .parse::<f64>()
                .map_err(|_error| Error::Dom("invalid scroll offset".into()))?;
            if !requested.is_finite() {
                return Err(Error::Dom("invalid scroll offset".into()));
            }
            let mut next = measured.scroll;
            if name == "scrollTop" {
                next.y = requested.round().clamp(0.0, measured.maximum.y);
            } else {
                next.x = requested.round().clamp(0.0, measured.maximum.x);
            }
            if next != measured.scroll {
                self.scroll.insert(id, next);
                self.layout_version = self.layout_version.saturating_add(1);
            }
            return Ok(Value::Null);
        }
        measured
            .values
            .get(name)
            .cloned()
            .ok_or_else(|| Error::Dom("unknown geometry property".into()))
    }

    fn ensure_layout(&mut self) -> Result<()> {
        for root in self.shadow.roots.keys() {
            let root = self.tree_root(*root, true)?;
            if self
                .document
                .tree
                .get(&root)
                .is_some_and(|node| node.is_document())
            {
                return Err(Error::Unsupported("shadow style and geometry".into()));
            }
        }
        if self
            .layout
            .as_ref()
            .is_some_and(|(version, _)| *version == self.layout_version)
        {
            return Ok(());
        }
        // Drop an invalidated scene before allocating its replacement.
        self.layout = None;
        let cascade = self.ensure_cascade()?;
        let mut work = crate::layout::Work::new(
            &mut self.operations,
            self.limits.max_dom_operations,
            self.limits.max_layout_nodes,
        );
        let layout = crate::layout::snapshot(
            &self.document,
            &crate::layout::Sources {
                scroll: &self.scroll,
                transitions: &self.transitions,
                now: self.now,
                inline: &self.styles,
                cascade: &cascade,
                fonts: &self.fonts,
            },
            &self.media,
            &mut work,
        )?;
        self.layout = Some((self.layout_version, layout));
        Ok(())
    }

    fn bounds(&mut self, handle: usize) -> Result<Value> {
        self.shadow_style_guard(self.node_id(handle)?)?;
        let target = self.node(handle)?;
        if !target.is_element() {
            return Err(Error::Dom("layout unsupported: non-element owner".into()));
        }
        if !target
            .ancestors_it(None)
            .any(|ancestor| ancestor.is_document())
        {
            return Ok(serde_json::to_value(crate::layout::Bounds::default())?);
        }
        let id = target.id;
        self.ensure_layout()?;
        let target = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        let rect = self
            .layout
            .as_ref()
            .ok_or_else(|| Error::Dom("missing layout snapshot".into()))?
            .1
            .bounds(target)?;
        Ok(serde_json::to_value(rect)?)
    }

    fn invalidate_sheet(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<()> {
        if !matches!(operation, "setAttr" | "removeAttr") {
            return Ok(());
        }
        let node = self.node(handle)?;
        if !node.has_name("link")
            || !["href", "rel", "type", "disabled"]
                .iter()
                .any(|name| name.eq_ignore_ascii_case(arg))
        {
            return Ok(());
        }
        let old = node.null_attribute(arg);
        if (operation == "removeAttr" && old.is_some())
            || (operation == "setAttr" && old.as_deref() != Some(value))
        {
            self.sheets.invalidate(node.id);
        }
        Ok(())
    }

    fn write_value(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<()> {
        let style_changed = arg.eq_ignore_ascii_case("style")
            && (operation == "removeAttr"
                || (operation == "setAttr"
                    && self.node(handle)?.null_attribute("style").as_deref() != Some(value)));
        let attribute_bytes = if operation == "setAttr" { arg.len() } else { 0 };
        self.charge_write(attribute_bytes.saturating_add(value.len()))?;
        self.invalidate_sheet(operation, handle, arg, value)?;
        let control = if matches!(operation, "setAttr" | "removeAttr") {
            let name = crate::dom_attributes::normalized_name(
                self.node(handle)?,
                arg,
                self.html_document(self.node_id(handle)?),
            );
            self.control_before_type(handle, "", &name)?
        } else {
            None
        };
        let observed = self.capture_attribute_write(operation, handle, arg)?;
        if operation == "set" && arg == "innerHTML" {
            self.may_have_links |= contains_tag(value, *b"<link");
            self.may_have_bases |= contains_tag(value, *b"<base");
        }
        self.set(operation, handle, arg, value)?;
        if let Some(record) = observed {
            self.queue_mutation(&record)?;
        }
        self.control_after_type(handle, control)?;
        if style_changed {
            let id = self.node(handle)?.id;
            if let Some(previous) = self.styles.remove(&id) {
                self.style_bytes = self.style_bytes.saturating_sub(previous.bytes());
            }
        }
        Ok(())
    }

    fn style_sheet(&mut self, handle: usize) -> Result<Value> {
        self.shadow_style_guard(self.node_id(handle)?)?;
        let node = self.node(handle)?;
        if !(node.has_name("style") || node.has_name("link"))
            || node
                .qual_name_ref()
                .as_ref()
                .is_none_or(|name| name.ns.as_ref() != "http://www.w3.org/1999/xhtml")
        {
            return Err(Error::Dom(
                "stylesheet owner must be an HTML style or link element".into(),
            ));
        }
        if !node.ancestors_it(None).any(|parent| parent.is_document())
            || node
                .null_attribute("type")
                .is_some_and(|value| !value.is_empty() && !value.eq_ignore_ascii_case("text/css"))
        {
            return Ok(Value::Null);
        }
        let (source, href, accessible) = if node.has_name("link") {
            if !crate::stylesheets::is_stylesheet(node) {
                return Ok(Value::Null);
            }
            let base = self.base_href()?;
            let Some((source, href, accessible)) =
                self.sheets.associated_source(node, base.as_deref())?
            else {
                return Ok(Value::Null);
            };
            (source.to_string(), Some(href.to_string()), accessible)
        } else {
            (node.text().to_string(), None, true)
        };
        if source.len() > self.limits.max_stylesheet_bytes {
            return Err(Error::Limit("stylesheet bytes"));
        }
        let id = node.id;
        Ok(json!(
            self.cssom
                .owner_sheet(id, handle, source, href, accessible)?
        ))
    }

    fn attribute_call(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<Value> {
        if !self.node(handle)?.is_element() {
            return Err(Error::Dom("attribute target must be an element".into()));
        }
        if operation == "attr" {
            return Ok(json!(crate::dom_attributes::named(
                self.node(handle)?,
                arg,
                self.html_document(self.node_id(handle)?)
            )));
        }
        if operation == "attrInfo" {
            return Ok(json!(crate::dom_attributes::named_info(
                self.node(handle)?,
                arg,
                self.html_document(self.node_id(handle)?)
            )));
        }
        if operation == "attributeNames" {
            return Ok(json!(crate::dom_attributes::names(self.node(handle)?)));
        }
        let (namespace, name): (String, String) = serde_json::from_str(arg)?;
        if operation == "attrNS" {
            return Ok(json!(crate::dom_attributes::namespaced(
                self.node(handle)?,
                &namespace,
                &name
            )));
        }
        self.charge_write(arg.len().saturating_add(value.len()))?;
        let control = self.control_before_type(handle, &namespace, &name)?;
        if namespace.is_empty() {
            self.invalidate_sheet(
                if operation == "setAttrNS" {
                    "setAttr"
                } else {
                    "removeAttr"
                },
                handle,
                &name,
                value,
            )?;
        }
        if operation == "setAttrNS" {
            let observed = self.capture_attribute_ns(handle, &namespace, &name, false)?;
            crate::dom_attributes::set_namespaced(self.node(handle)?, &namespace, &name, value)?;
            if let Some(record) = observed {
                self.queue_mutation(&record)?;
            }
        } else {
            let observed = self.capture_attribute_ns(handle, &namespace, &name, true)?;
            crate::dom_attributes::remove_namespaced(self.node(handle)?, &namespace, &name);
            if let Some(record) = observed {
                self.queue_mutation(&record)?;
            }
        }
        if namespace.is_empty() && name == "style" {
            let id = self.node(handle)?.id;
            if let Some(previous) = self.styles.remove(&id) {
                self.style_bytes = self.style_bytes.saturating_sub(previous.bytes());
            }
        }
        self.control_after_type(handle, control)?;
        Ok(Value::Null)
    }

    fn closest(&mut self, handle: usize, arg: &str) -> Result<Value> {
        let matcher = self.matcher(arg)?;
        let node = self.node(handle)?;
        let id = std::iter::once(node)
            .chain(node.ancestors_it(None))
            .find(|candidate| candidate.is_element() && matcher.matches(*candidate))
            .map(|candidate| candidate.id);
        Ok(json!(id.map(|id| self.handle(id))))
    }

    fn ensure_window_names(&mut self) -> Result<()> {
        if self.named.is_some() {
            return Ok(());
        }
        let mut names: HashMap<String, Vec<NodeId>> = HashMap::new();
        let mut work = crate::layout::Work::new(
            &mut self.operations,
            self.limits.max_dom_operations,
            self.limits.max_layout_nodes,
        );
        for node in self.document.root().descendants_it() {
            work.charge()?;
            if !node.is_element() {
                continue;
            }
            let id = node.null_attribute("id").filter(|id| !id.is_empty());
            if let Some(id) = &id {
                names.entry(id.clone()).or_default().push(node.id);
            }
            let html = node
                .qual_name_ref()
                .as_ref()
                .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml");
            if html
                && ["embed", "form", "img", "object", "iframe"]
                    .iter()
                    .any(|tag| node.has_name(tag))
                && let Some(name) = node.null_attribute("name").filter(|name| !name.is_empty())
                && id.as_deref() != Some(name.as_ref())
            {
                names.entry(name).or_default().push(node.id);
            }
        }
        self.named = Some(NamedProperties { nodes: names });
        Ok(())
    }
    fn window_named(&mut self, name: &str) -> Result<Value> {
        self.ensure_window_names()?;
        let cache = self
            .named
            .as_ref()
            .ok_or_else(|| Error::Dom("invalid Window named state".into()))?;
        let ids = cache.nodes.get(name).cloned().unwrap_or_default();
        let mut handles = Vec::with_capacity(ids.len());
        for id in ids {
            if self.document.tree.get(&id).is_some_and(|node| {
                node.has_name("iframe")
                    && node
                        .qual_name_ref()
                        .as_ref()
                        .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml")
            }) {
                return Err(Error::Unsupported("Window named frame access".into()));
            }
            handles.push(self.handle(id));
        }
        Ok(json!(handles))
    }

    fn style_sheets(&mut self, handle: usize) -> Result<Value> {
        if !self.node(handle)?.is_document() {
            return Err(Error::Dom(
                "stylesheet list owner must be a document".into(),
            ));
        }
        let mut candidates = Vec::new();
        let mut work = crate::layout::Work::new(
            &mut self.operations,
            self.limits.max_dom_operations,
            self.limits.max_layout_nodes,
        );
        for node in self.document.root().descendants_it() {
            work.charge()?;
            if (node.has_name("style") || node.has_name("link"))
                && node
                    .qual_name_ref()
                    .as_ref()
                    .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml")
            {
                candidates.push(node.id);
            }
        }
        let mut sheets = Vec::new();
        for id in candidates {
            let handle = self.handle(id);
            let sheet = self.style_sheet(handle)?;
            if !sheet.is_null() {
                sheets.push(sheet);
            }
        }
        Ok(json!(sheets))
    }

    fn cssom_call(&mut self, handle: usize, operation: &str, request: &str) -> Result<Value> {
        let request: Value = serde_json::from_str(request)?;
        let arg = request
            .get("arg")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let value = request
            .get("value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if matches!(
            operation,
            "adopt"
                | "new"
                | "replace"
                | "replaceFinish"
                | "insert"
                | "delete"
                | "disabled"
                | "selector"
        ) || (operation == "style" && matches!(arg, "text" | "set" | "remove"))
        {
            self.charge_write(arg.len().saturating_add(value.len()))?;
        }
        let output = self.cssom.call(operation, handle, arg, value)?;
        if matches!(
            operation,
            "adopt" | "replace" | "replaceFinish" | "insert" | "delete" | "disabled" | "selector"
        ) || (operation == "style" && matches!(arg, "text" | "set" | "remove"))
        {
            self.layout_version = self.layout_version.saturating_add(1);
            self.computed_styles.clear();
            self.cascade = None;
        }
        Ok(output)
    }

    fn style(&mut self, handle: usize, operation: &str, request: &str) -> Result<Value> {
        const STATE_LIMIT: usize = 4 * 1024 * 1024;
        let node = self.node(handle)?;
        if !node.is_element() {
            return Err(Error::Dom("style owner must be an element".into()));
        }
        let id = node.id;
        let mut state = if operation == "text" {
            crate::styles::Declarations::default()
        } else if let Some(state) = self.styles.get(&id) {
            state.clone()
        } else {
            crate::styles::Declarations::parse(
                node.null_attribute("style").as_deref().unwrap_or_default(),
            )
            .map_err(|message| Error::Dom(message.into()))?
        };
        let output = crate::styles::call(&mut state, operation, request)
            .map_err(|message| Error::Dom(message.into()))?;
        state.compact();
        let bytes = self
            .style_bytes
            .saturating_sub(
                self.styles
                    .get(&id)
                    .map_or(0, crate::styles::Declarations::bytes),
            )
            .saturating_add(state.bytes());
        if bytes > STATE_LIMIT {
            return Err(Error::Limit("CSS state"));
        }
        if operation == "text" || output.changed {
            self.charge_write("style".len().saturating_add(output.css_text.len()))?;
            let observed = self.capture_attribute_ns(handle, "", "style", false)?;
            crate::dom_attributes::set_namespaced(
                self.node(handle)?,
                "",
                "style",
                &output.css_text,
            )?;
            if let Some(record) = observed {
                self.queue_mutation(&record)?;
            }
        }
        self.styles.insert(id, state);
        self.style_bytes = bytes;
        Ok(serde_json::to_value(output)?)
    }

    fn remove_node(&self, handle: usize) -> Result<Value> {
        self.mutation_removing(self.node_id(handle)?, false)?;
        self.node(handle)?.remove_from_parent();
        Ok(Value::Null)
    }

    fn remove_child(&self, handle: usize, value: &str) -> Result<Value> {
        let child = value
            .parse::<usize>()
            .map_err(|error| Error::Dom(error.to_string()))?;
        let parent = self.node(handle)?;
        let child = self.node(child)?;
        if child.parent().map(|node| node.id) != Some(parent.id) {
            return Err(not_found());
        }
        self.mutation_removing(child.id, false)?;
        child.remove_from_parent();
        Ok(Value::Null)
    }

    fn insert(&self, operation: &str, handle: usize, arg: &str, value: &str) -> Result<Value> {
        let child_handle = value
            .parse::<usize>()
            .map_err(|error| Error::Dom(error.to_string()))?;
        if matches!(self.handles.get(child_handle), Some(Handle::Attribute)) {
            return Err(hierarchy_error());
        }
        let child = self.node(child_handle)?;
        let parent = self.node(handle)?;
        if !(parent.is_element() || parent.is_fragment() || parent.is_document())
            || !(child.is_element()
                || child.is_text()
                || child.is_comment()
                || child.is_fragment()
                || child.is_doctype())
            || parent.id == child.id
            || self.shadow_contains(child.id, parent.id)?
        {
            return Err(hierarchy_error());
        }
        let reference = if arg.is_empty() {
            None
        } else {
            Some(
                self.node(
                    arg.parse()
                        .map_err(|error: std::num::ParseIntError| Error::Dom(error.to_string()))?,
                )?,
            )
        };
        if reference.is_some_and(|node| node.parent().map(|node| node.id) != Some(parent.id)) {
            return Err(not_found());
        }
        let removed = if operation == "replace" {
            reference
        } else {
            None
        };
        if operation == "replace" && removed.is_none() {
            return Err(not_found());
        }
        let mut reference = if operation == "replace" {
            reference.and_then(|node| node.next_sibling())
        } else {
            reference
        };
        if reference.is_some_and(|node| node.id == child.id) {
            reference = child.next_sibling();
        }
        let inserted = if child.is_fragment() {
            child.children()
        } else {
            vec![child]
        };
        validate_insertion(parent, &inserted, reference, removed)?;
        if self.mutations.borrow().active() {
            self.mutation_inserting(
                parent.id,
                child.id,
                &inserted.iter().map(|node| node.id).collect::<Vec<_>>(),
                removed.map(|node| node.id),
                reference.map(|node| node.id),
            )?;
        }
        let document = if parent.is_document() {
            parent.id
        } else {
            self.node_document(parent.id)
        };
        for node in inserted {
            self.adopt_tree(node.id, document)?;
            if let Some(reference) = reference {
                reference.insert_before(&node.id);
            } else {
                parent.append_child(&node.id);
            }
        }
        if let Some(removed) = removed.filter(|node| node.id != child.id) {
            removed.remove_from_parent();
        }
        Ok(Value::Null)
    }

    fn create_character(&mut self, owner: usize, operation: &str, value: &str) -> Result<Value> {
        self.charge_write(value.len())?;
        self.allocate_node()?;
        let id = if operation == "createText" {
            self.document.tree.new_text(value).id
        } else {
            self.document.tree.create_node(NodeData::Comment {
                contents: value.into(),
            })
        };
        self.own_node(owner, id)?;
        Ok(json!(self.handle(id)))
    }

    fn charge_write(&mut self, bytes: usize) -> Result<()> {
        self.writes = self.writes.saturating_add(bytes);
        if self.writes > self.limits.max_dom_write_bytes {
            return Err(Error::Limit("DOM write bytes"));
        }
        Ok(())
    }

    fn relative_node(&mut self, handle: usize, relation: &str) -> Result<Value> {
        let node = self.node(handle)?;
        let relative = match relation {
            "parent" => node.parent(),
            "first" => node.first_child(),
            "last" => node.last_child(),
            "next" => node.next_sibling(),
            "previous" => node.prev_sibling(),
            _ => return Err(Error::Dom("invalid node relation".into())),
        };
        let id = relative.map(|relative| relative.id);
        Ok(json!(id.map(|id| self.handle(id))))
    }

    fn custom_candidates(&mut self, handle: usize, name: &str) -> Result<Value> {
        let select = |node: NodeRef<'_>| {
            node.query_or(None, |node| match &node.data {
                NodeData::Element(element)
                    if element.name.ns.as_ref() == "http://www.w3.org/1999/xhtml"
                        && element.name.local.contains('-')
                        && (name.is_empty() || element.name.local.as_ref() == name) =>
                {
                    Some(node.id)
                }
                _ => None,
            })
        };
        let candidates: Vec<_> = if self.shadow.roots.is_empty() {
            let root = self.node(handle)?;
            std::iter::once(root)
                .chain(root.descendants_it())
                .filter_map(select)
                .collect()
        } else {
            self.shadow_descendants(self.node_id(handle)?)?
                .into_iter()
                .filter_map(|id| self.document.tree.get(&id))
                .filter_map(select)
                .collect()
        };
        Ok(json!(
            candidates
                .into_iter()
                .map(|id| self.handle(id))
                .collect::<Vec<_>>()
        ))
    }

    fn query(&mut self, handle: usize, selector: &str) -> Result<Value> {
        let matcher = self.matcher(selector)?;
        let id = self.node_id(handle)?;
        let node = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        let handles = &mut self.handles;
        let ids = &mut self.ids;
        let result: Vec<_> = matcher
            .select(node)
            .map(|node| register_handle(handles, ids, node.id))
            .collect();
        Ok(json!(result))
    }

    fn children(&mut self, handle: usize, kind: &str) -> Result<Value> {
        if !matches!(kind, "nodes" | "elements") {
            return Err(Error::Dom("invalid child collection".into()));
        }
        let id = self.node_id(handle)?;
        let node = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        let handles = &mut self.handles;
        let ids = &mut self.ids;
        let result: Vec<_> = node
            .children_it(false)
            .filter(|node| kind == "nodes" || node.is_element())
            .map(|node| register_handle(handles, ids, node.id))
            .collect();
        Ok(json!(result))
    }

    fn relative_element(&mut self, handle: usize, relation: &str) -> Result<Value> {
        let node = self.node(handle)?;
        let relative = match relation {
            "first" => node.children_it(false).find(NodeRef::is_element),
            "last" => node.children_it(true).find(NodeRef::is_element),
            "next" => std::iter::successors(node.next_sibling(), NodeRef::next_sibling)
                .find(NodeRef::is_element),
            "previous" => std::iter::successors(node.prev_sibling(), NodeRef::prev_sibling)
                .find(NodeRef::is_element),
            _ => return Err(Error::Dom("invalid element relation".into())),
        };
        let id = relative.map(|relative| relative.id);
        Ok(json!(id.map(|id| self.handle(id))))
    }

    fn query_one(&mut self, handle: usize, selector: &str) -> Result<Value> {
        let matcher = self.matcher(selector)?;
        let node = self.node(handle)?;
        let id = matcher.select(node).next().map(|node| node.id);
        Ok(json!(id.map(|id| self.handle(id))))
    }

    fn matcher(&mut self, selector: &str) -> Result<Matcher> {
        if let Some(matcher) = self.matchers.get(selector) {
            return Ok(matcher.clone());
        }
        let matcher = Matcher::new(selector)?;
        // Bound retained keys and parser structures without restricting valid selectors.
        if self.matchers.len() < 64 && selector.len() <= 512 {
            self.matchers.insert(selector.to_owned(), matcher.clone());
        }
        Ok(matcher)
    }

    fn get(&self, handle: usize, property: &str) -> Result<Value> {
        let node = self.node(handle)?;
        Ok(match property {
            "ownerDocument" => {
                if node.is_document() {
                    Value::Null
                } else {
                    self.owner_document_value(node.id)
                }
            }
            "contentType" if node.is_document() => json!(
                self.documents
                    .kinds
                    .get(&node.id)
                    .map_or("text/html", |kind| kind.content_type)
            ),
            "htmlDocument" => json!(if node.is_document() {
                self.documents
                    .kinds
                    .get(&node.id)
                    .is_none_or(|kind| kind.html)
            } else {
                self.html_document(node.id)
            }),
            "textContent" => {
                if node.is_document() || node.is_doctype() {
                    Value::Null
                } else if node.is_comment() {
                    character_value(node)
                } else {
                    json!(node.text().to_string())
                }
            }
            "nodeValue" => character_value(node),
            "nodeType" => node.query_or(Value::Null, |node| match node.data {
                NodeData::Element(_) => json!(1),
                NodeData::Text { .. } => json!(3),
                NodeData::ProcessingInstruction { .. } => json!(7),
                NodeData::Comment { .. } => json!(8),
                NodeData::Document => json!(9),
                NodeData::Doctype { .. } => json!(10),
                NodeData::Fragment => json!(11),
            }),
            "nodeName" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) => json!(if element.name.ns.as_ref()
                    == "http://www.w3.org/1999/xhtml"
                    && self.html_document(node.id)
                {
                    qualified_name(element).to_ascii_uppercase()
                } else {
                    qualified_name(element)
                }),
                NodeData::Text { .. } => json!("#text"),
                NodeData::Comment { .. } => json!("#comment"),
                NodeData::Document => json!("#document"),
                NodeData::Fragment => json!("#document-fragment"),
                NodeData::Doctype { name, .. } => json!(name.to_string()),
                NodeData::ProcessingInstruction { target, .. } => json!(target.to_string()),
            }),
            "tagName" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) => json!(if element.name.ns.as_ref()
                    == "http://www.w3.org/1999/xhtml"
                    && self.html_document(node.id)
                {
                    qualified_name(element).to_ascii_uppercase()
                } else {
                    qualified_name(element)
                }),
                _ => Value::Null,
            }),
            "localName" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) => json!(element.name.local.to_string()),
                _ => Value::Null,
            }),
            "namespaceURI" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) if !element.name.ns.is_empty() => {
                    json!(element.name.ns.to_string())
                }
                _ => Value::Null,
            }),
            "prefix" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) => {
                    json!(element.name.prefix.as_ref().map(ToString::to_string))
                }
                _ => Value::Null,
            }),
            "isConnected" => json!(
                self.document
                    .tree
                    .get(&self.tree_root(node.id, true)?)
                    .is_some_and(|node| node.is_document())
            ),
            _ => return Err(Error::Dom(format!("unsupported property: {property}"))),
        })
    }

    fn replace_html(&self, parent: NodeId, value: &str) -> Result<()> {
        if value.is_empty() {
            let observed = self.mutation_replacing_children(parent)?;
            self.document.tree.remove_children_of(&parent);
            return self.mutation_replaced_children(parent, observed);
        }
        let fragment = crate::html_parse::fragment(
            &self.document,
            value,
            self.limits.max_dom_nodes,
            self.check.as_ref(),
            &self.allocated_nodes,
        )?;
        let observed = self.mutation_replacing_children(parent)?;
        self.document.tree.remove_children_of(&parent);
        self.document
            .tree
            .reparent_children_of(&fragment, Some(parent));
        self.mutation_replaced_children(parent, observed)
    }

    fn set(&self, operation: &str, handle: usize, property: &str, value: &str) -> Result<()> {
        let node = self.node(handle)?;
        if operation == "set" && matches!(property, "textContent" | "nodeValue") {
            if node.is_text() || node.is_comment() {
                if self.mutations.borrow().active() {
                    self.queue_mutation(&mutations::Record::character(
                        node.id,
                        self.get(handle, "nodeValue")?
                            .as_str()
                            .unwrap_or_default()
                            .to_owned(),
                    ))?;
                }
                node.update(|node| match &mut node.data {
                    NodeData::Text { contents } | NodeData::Comment { contents } => {
                        *contents = value.into();
                    }
                    _ => {}
                });
                return Ok(());
            }
            if property == "nodeValue" || node.is_document() || node.is_doctype() {
                return Ok(());
            }
        }
        if operation == "set"
            && property == "textContent"
            && (node.is_element() || node.is_fragment())
        {
            if !value.is_empty() {
                self.allocate_node()?;
            }
            let observed = self.mutation_replacing_children(node.id)?;
            node.remove_children();
            if !value.is_empty() {
                let text = self.document.tree.new_text(value);
                node.append_child(&text.id);
            }
            self.mutation_replaced_children(node.id, observed)?;
            return Ok(());
        }
        if operation == "set" && property == "innerHTML" && self.shadow.roots.contains_key(&node.id)
        {
            self.replace_html(node.id, value)?;
            return Ok(());
        }
        if !node.is_element() {
            return Err(Error::Dom("write target must be an element".into()));
        }
        match (operation, property) {
            ("set", "innerHTML") => {
                self.replace_html(node.id, value)?;
            }
            ("setAttr", _) => crate::dom_attributes::set_named(
                node,
                property,
                value,
                self.html_document(node.id),
            )?,
            ("removeAttr", _) => {
                crate::dom_attributes::remove_named(node, property, self.html_document(node.id));
            }
            _ => return Err(Error::Dom(format!("unsupported write: {property}"))),
        }
        Ok(())
    }
}

fn hierarchy_error() -> Error {
    Error::DomException {
        name: "HierarchyRequestError",
        message: "invalid child type, document structure or DOM cycle",
    }
}

fn not_found() -> Error {
    Error::DomException {
        name: "NotFoundError",
        message: "reference node is not a child of this parent",
    }
}

fn validate_insertion(
    parent: NodeRef<'_>,
    inserted: &[NodeRef<'_>],
    reference: Option<NodeRef<'_>>,
    removed: Option<NodeRef<'_>>,
) -> Result<()> {
    if !parent.is_document() {
        if inserted.iter().any(NodeRef::is_doctype) {
            return Err(hierarchy_error());
        }
        return Ok(());
    }
    let mut children: Vec<_> = parent
        .children_it(false)
        .filter(|node| {
            !inserted.iter().any(|child| child.id == node.id)
                && removed.is_none_or(|removed| removed.id != node.id)
        })
        .collect();
    let index = reference
        .and_then(|reference| children.iter().position(|node| node.id == reference.id))
        .unwrap_or(children.len());
    children.splice(index..index, inserted.iter().copied());
    let mut element = false;
    let mut doctype = false;
    for node in children {
        if node.is_text() || node.is_fragment() || node.is_document() {
            return Err(hierarchy_error());
        }
        if node.is_element() {
            if element {
                return Err(hierarchy_error());
            }
            element = true;
        }
        if node.is_doctype() {
            if element || doctype {
                return Err(hierarchy_error());
            }
            doctype = true;
        }
    }
    Ok(())
}

fn character_value(node: NodeRef<'_>) -> Value {
    node.query_or(Value::Null, |node| match &node.data {
        NodeData::Text { contents }
        | NodeData::Comment { contents }
        | NodeData::ProcessingInstruction { contents, .. } => json!(contents.to_string()),
        _ => Value::Null,
    })
}

fn register_handle(
    handles: &mut Vec<Handle>,
    ids: &mut HashMap<NodeId, usize>,
    id: NodeId,
) -> usize {
    *ids.entry(id).or_insert_with(|| {
        let handle = handles.len();
        handles.push(Handle::Node(id));
        handle
    })
}

fn valid_element_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if first.is_ascii_alphabetic() {
        return !chars.any(|character| {
            matches!(
                character,
                '\t' | '\n' | '\r' | '\u{c}' | ' ' | '\0' | '/' | '>'
            )
        });
    }
    (matches!(first, ':' | '_') || first >= '\u{80}')
        && chars.all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '-' | '.' | ':' | '_')
                || character >= '\u{80}'
        })
}

fn qualified_name(element: &dom_query::Element) -> String {
    element.name.prefix.as_ref().map_or_else(
        || element.name.local.to_string(),
        |prefix| format!("{prefix}:{}", element.name.local),
    )
}

// Tag names do not decode HTML character references. False positives (comments,
// raw-text scripts, longer names) only retain the regular bounded discovery scan.
fn contains_tag(html: &str, tag: [u8; 5]) -> bool {
    html.as_bytes()
        .windows(5)
        .any(|bytes| bytes.eq_ignore_ascii_case(&tag))
}

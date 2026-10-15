use crate::dom_attributes::NativeAttributes;
use std::collections::{HashMap, HashSet, VecDeque};

use dom_query::{Document, NodeId, NodeRef};
use url::Url;

use crate::stylesheet_imports::Import;
use crate::{Error, MediaEnvironment, Result, layout::Work, machine::Response};

pub(crate) struct Source {
    pub body: String,
    pub base: String,
    pub imports: Vec<Import>,
    pub available: bool,
}

struct Sheet {
    url: String,
    resource: Source,
    access: Option<bool>,
    frozen: bool,
    revision: usize,
    success: bool,
    imports: HashMap<String, Source>,
    known: HashSet<String>,
    pending: VecDeque<(String, usize)>,
}

enum Pending {
    Main {
        owner: NodeId,
        url: String,
    },
    Import {
        owner: NodeId,
        url: String,
        revision: usize,
        depth: usize,
    },
}

pub(crate) struct Sheets {
    origin: Url,
    loaded: HashMap<NodeId, Sheet>,
    bytes: usize,
    max_bytes: usize,
    pending: Option<Pending>,
    revision: usize,
}

pub(crate) fn is_stylesheet(node: NodeRef<'_>) -> bool {
    node.has_name("link")
        && node.null_attribute("rel").is_some_and(|rel| {
            rel.split_ascii_whitespace()
                .any(|part| part.eq_ignore_ascii_case("stylesheet"))
        })
}

impl Sheets {
    pub(crate) fn new(origin: Url, max_bytes: usize) -> Self {
        Self {
            origin,
            loaded: HashMap::new(),
            bytes: 0,
            max_bytes,
            pending: None,
            revision: 0,
        }
    }

    pub(crate) fn freeze_urls(&mut self) {
        for sheet in self.loaded.values_mut() {
            sheet.frozen = true;
        }
    }
    pub(crate) fn unfreeze_urls(&mut self) {
        for sheet in self.loaded.values_mut() {
            sheet.frozen = false;
        }
    }
    pub(crate) fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    fn url(&self, node: NodeRef<'_>, base: Option<&str>) -> Result<Option<String>> {
        let Some(href) = node.null_attribute("href") else {
            return Ok(None);
        };
        if href.trim().is_empty() || node.null_attribute("disabled").is_some() {
            return Ok(None);
        }
        if let Some(sheet) = self.loaded.get(&node.id).filter(|sheet| sheet.frozen) {
            return Ok(Some(sheet.url.clone()));
        }
        let base =
            crate::links::base(base, self.origin.as_str()).unwrap_or_else(|| self.origin.clone());
        let mut url = crate::machine::parse_url(
            base.join(&href)
                .map_err(|error| Error::InvalidUrl(error.to_string()))?
                .as_str(),
        )?;
        url.set_fragment(None);
        Ok(Some(url.to_string()))
    }

    pub(crate) fn next(
        &mut self,
        document: &Document,
        base: Option<&str>,
        work: &mut Work<'_>,
    ) -> Result<Option<(NodeId, String)>> {
        if self.pending.is_some() {
            return Ok(None);
        }
        for node in document.root().descendants_it() {
            work.charge()?;
            if !is_stylesheet(node) {
                continue;
            }
            if node
                .null_attribute("type")
                .is_some_and(|value| !value.is_empty() && !value.eq_ignore_ascii_case("text/css"))
            {
                continue;
            }
            let Some(url) = self.url(node, base)? else {
                continue;
            };
            if node
                .null_attribute("integrity")
                .is_some_and(|value| !value.is_empty())
            {
                return Err(Error::Unsupported(
                    "stylesheet integrity is not implemented".into(),
                ));
            }
            if self
                .loaded
                .get(&node.id)
                .is_none_or(|sheet| sheet.url != url)
            {
                self.pending = Some(Pending::Main {
                    owner: node.id,
                    url: url.clone(),
                });
                return Ok(Some((node.id, url)));
            }
            if let Some(sheet) = self.loaded.get_mut(&node.id)
                && let Some((url, depth)) = sheet.pending.pop_front()
            {
                self.pending = Some(Pending::Import {
                    owner: node.id,
                    url: url.clone(),
                    revision: sheet.revision,
                    depth,
                });
                return Ok(Some((node.id, url)));
            }
        }
        Ok(None)
    }

    pub(crate) fn source(&self, node: NodeRef<'_>, base: Option<&str>) -> Result<Option<&str>> {
        let Some(url) = self.url(node, base)? else {
            return Ok(None);
        };
        Ok(self
            .loaded
            .get(&node.id)
            .filter(|sheet| sheet.url == url)
            .map(|sheet| sheet.resource.body.as_str()))
    }

    pub(crate) fn associated_source(
        &self,
        node: NodeRef<'_>,
        base: Option<&str>,
    ) -> Result<Option<(&str, &str, bool)>> {
        let Some(url) = self.url(node, base)? else {
            return Ok(None);
        };
        Ok(self
            .loaded
            .get(&node.id)
            .filter(|sheet| sheet.url == url && sheet.access.is_some())
            .map(|sheet| {
                (
                    sheet.resource.body.as_str(),
                    sheet.resource.base.as_str(),
                    sheet.access.unwrap_or(false),
                )
            }))
    }

    pub(crate) fn source_base(
        &self,
        node: NodeRef<'_>,
        base: Option<&str>,
    ) -> Result<Option<&str>> {
        let Some(url) = self.url(node, base)? else {
            return Ok(None);
        };
        Ok(self
            .loaded
            .get(&node.id)
            .filter(|sheet| sheet.url == url)
            .map(|sheet| sheet.resource.base.as_str()))
    }
    pub(crate) fn document_base(&self, base: Option<&str>) -> String {
        crate::links::base(base, self.origin.as_str())
            .unwrap_or_else(|| self.origin.clone())
            .to_string()
    }
    pub(crate) fn disconnect(&mut self, document: &Document, work: &mut Work<'_>) -> Result<()> {
        let mut removed = Vec::new();
        for id in self.loaded.keys() {
            work.charge()?;
            let mut connected = false;
            if let Some(node) = document.tree.get(id) {
                for ancestor in node.ancestors_it(None) {
                    work.charge()?;
                    if ancestor.is_document() {
                        connected = true;
                        break;
                    }
                }
            }
            if !connected {
                removed.push(*id);
            }
        }
        for id in removed {
            self.invalidate(id);
        }
        Ok(())
    }

    pub(crate) fn invalidate(&mut self, id: NodeId) {
        if let Some(sheet) = self.loaded.remove(&id) {
            self.bytes = self.bytes.saturating_sub(
                sheet.resource.body.len().saturating_add(
                    sheet
                        .imports
                        .values()
                        .map(|source| source.body.len())
                        .sum::<usize>(),
                ),
            );
        }
    }

    pub(crate) fn imported_bytes(&self, owner: NodeId) -> usize {
        self.loaded.get(&owner).map_or(0, |sheet| {
            sheet.imports.values().map(|source| source.body.len()).sum()
        })
    }

    fn check_resources(&self) -> Result<()> {
        let count = self.loaded.len().saturating_add(
            self.loaded
                .values()
                .map(|sheet| sheet.imports.len().saturating_add(sheet.pending.len()))
                .sum::<usize>(),
        );
        if count > 1024 {
            return Err(Error::Limit("stylesheet resources"));
        }
        Ok(())
    }

    pub(crate) fn imported(&self, owner: NodeId, url: &str) -> Option<&Source> {
        let sheet = self.loaded.get(&owner)?;
        sheet
            .imports
            .get(url)
            .or_else(|| sheet.imports.values().find(|source| source.base == url))
    }

    pub(crate) fn respond(
        &mut self,
        node: NodeRef<'_>,
        url: String,
        response: Option<&Response>,
        base: Option<&str>,
        media: &MediaEnvironment,
    ) -> Result<Option<bool>> {
        let Some(pending) = self.pending.take() else {
            return Err(Error::Unsupported("no pending stylesheet".into()));
        };
        let owner = node.id;
        if !node.ancestors_it(None).any(|parent| parent.is_document()) {
            self.invalidate(owner);
            return Ok(None);
        }
        match pending {
            Pending::Main {
                owner: expected,
                url: expected_url,
            } => {
                if owner != expected || url != expected_url {
                    return Err(Error::Unsupported("stylesheet response identity".into()));
                }
                if self.url(node, base)?.as_deref() != Some(url.as_str()) {
                    return Ok(None);
                }
                if !self.loaded.contains_key(&owner) && self.loaded.len() >= 1024 {
                    return Err(Error::Limit("stylesheet resources"));
                }
                self.invalidate(owner);
                let resource = self.resource(&url, response)?;
                self.revision = self.revision.saturating_add(1);
                let mut sheet = Sheet {
                    url: url.clone(),
                    access: response.map(css_mime),
                    frozen: false,
                    revision: self.revision,
                    success: resource.available,
                    known: HashSet::from([url, resource.base.clone()]),
                    imports: HashMap::new(),
                    pending: VecDeque::new(),
                    resource,
                };
                sheet.discover(
                    &sheet.resource.base.clone(),
                    sheet.resource.imports.clone(),
                    media,
                    0,
                )?;
                let complete = sheet.pending.is_empty().then_some(sheet.success);
                self.loaded.insert(owner, sheet);
                self.check_resources()?;
                Ok(complete)
            }
            Pending::Import {
                owner: expected,
                url: expected_url,
                revision,
                depth,
            } => {
                if owner != expected || url != expected_url {
                    return Err(Error::Unsupported("stylesheet response identity".into()));
                }
                if self
                    .loaded
                    .get(&owner)
                    .is_none_or(|sheet| sheet.revision != revision)
                {
                    return Ok(None);
                }
                let resource = self.resource(&url, response)?;
                let Some(sheet) = self.loaded.get_mut(&owner) else {
                    return Ok(None);
                };
                sheet.known.insert(resource.base.clone());
                sheet.pending.retain(|(url, _depth)| url != &resource.base);
                sheet.success &= resource.available;
                sheet.discover(&resource.base, resource.imports.clone(), media, depth)?;
                sheet.imports.insert(url, resource);
                let complete = sheet.pending.is_empty().then_some(sheet.success);
                self.check_resources()?;
                Ok(complete)
            }
        }
    }

    fn resource(&mut self, url: &str, response: Option<&Response>) -> Result<Source> {
        let response =
            response.filter(|response| (200..300).contains(&response.status) && css_mime(response));
        let body = response.map_or_else(String::new, |response| response.body.clone());
        if self.bytes.saturating_add(body.len()) > self.max_bytes {
            return Err(Error::Limit("stylesheet total bytes"));
        }
        self.bytes = self.bytes.saturating_add(body.len());
        let imports = crate::stylesheet_imports::parse(&body)?;
        Ok(Source {
            body,
            base: response.map_or_else(|| url.to_owned(), |response| response.url.clone()),
            imports,
            available: response.is_some(),
        })
    }
}

fn css_mime(response: &Response) -> bool {
    response
        .content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .eq_ignore_ascii_case("text/css")
}

impl Sheet {
    fn discover(
        &mut self,
        base: &str,
        imports: Vec<Import>,
        media: &MediaEnvironment,
        depth: usize,
    ) -> Result<()> {
        if imports.is_empty() {
            return Ok(());
        }
        let base = crate::machine::parse_url(base)?;
        for import in imports {
            if !import.enabled(media)? {
                continue;
            }
            let mut url = base
                .join(&import.url)
                .map_err(|error| Error::InvalidUrl(error.to_string()))?;
            url.set_fragment(None);
            let url = url.to_string();
            if self.known.insert(url.clone()) {
                if self.known.len() > 1024 {
                    return Err(Error::Limit("stylesheet resources"));
                }
                if depth >= 32 {
                    return Err(Error::Limit("stylesheet import depth"));
                }
                self.pending.push_back((url, depth.saturating_add(1)));
            }
        }
        Ok(())
    }
}

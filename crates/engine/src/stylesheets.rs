use std::collections::HashMap;

use dom_query::{Document, NodeId, NodeRef};
use url::Url;

use crate::{Error, Result, layout::Work, machine::Response};

struct Sheet {
    url: String,
    source: String,
    base: String,
    accessible: bool,
}

pub(crate) struct Sheets {
    origin: Url,
    loaded: HashMap<NodeId, Sheet>,
    bytes: usize,
    max_bytes: usize,
}

pub(crate) fn is_stylesheet(node: NodeRef<'_>) -> bool {
    node.has_name("link")
        && node.attr("rel").is_some_and(|rel| {
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
        }
    }

    pub(crate) fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    fn url(&self, node: NodeRef<'_>, base: Option<&str>) -> Result<Option<String>> {
        let Some(href) = node.attr("href") else {
            return Ok(None);
        };
        if href.trim().is_empty() || node.has_attr("disabled") {
            return Ok(None);
        }
        let base =
            crate::links::base(base, self.origin.as_str()).unwrap_or_else(|| self.origin.clone());
        let mut url = crate::machine::resolve(
            &self.origin,
            base.join(&href)
                .map_err(|error| Error::InvalidUrl(error.to_string()))?
                .as_str(),
        )?;
        url.set_fragment(None);
        Ok(Some(url.to_string()))
    }

    pub(crate) fn next(
        &self,
        document: &Document,
        base: Option<&str>,
        work: &mut Work<'_>,
    ) -> Result<Option<(NodeId, String)>> {
        for node in document.root().descendants_it() {
            work.charge()?;
            if !is_stylesheet(node) {
                continue;
            }
            if node
                .attr("type")
                .is_some_and(|value| !value.is_empty() && !value.eq_ignore_ascii_case("text/css"))
            {
                continue;
            }
            let Some(url) = self.url(node, base)? else {
                continue;
            };
            if node
                .attr("integrity")
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
            .map(|sheet| sheet.source.as_str()))
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
            .filter(|sheet| sheet.url == url)
            .map(|sheet| (sheet.source.as_str(), sheet.base.as_str(), sheet.accessible)))
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
            .map(|sheet| sheet.base.as_str()))
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
            self.bytes = self.bytes.saturating_sub(sheet.source.len());
        }
    }

    pub(crate) fn respond(
        &mut self,
        id: NodeId,
        url: String,
        response: Option<&Response>,
    ) -> Result<bool> {
        if !self.loaded.contains_key(&id) && self.loaded.len() >= 1024 {
            return Err(Error::Limit("stylesheet resources"));
        }
        let accessible = response.is_some_and(|response| {
            response
                .content_type
                .split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .eq_ignore_ascii_case("text/css")
        });
        let response = response.filter(|response| {
            (200..300).contains(&response.status)
                && response
                    .content_type
                    .split(';')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .eq_ignore_ascii_case("text/css")
        });
        let source = response.map_or_else(String::new, |response| response.body.clone());
        let previous = self.loaded.get(&id).map_or(0, |sheet| sheet.source.len());
        let bytes = self
            .bytes
            .saturating_sub(previous)
            .saturating_add(source.len());
        if bytes > self.max_bytes {
            return Err(Error::Limit("stylesheet total bytes"));
        }
        self.bytes = bytes;
        let base = response.map_or_else(|| url.clone(), |response| response.url.clone());
        self.loaded.insert(
            id,
            Sheet {
                url,
                source,
                base,
                accessible,
            },
        );
        Ok(response.is_some())
    }
}

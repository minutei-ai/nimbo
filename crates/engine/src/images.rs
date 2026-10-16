//! Image source selection, bounded decoding and request state owned by the page.
use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::Cursor,
};

use dom_query::{Document, NodeId, NodeRef};
use image::{ImageDecoder, ImageReader};
use num_traits::ToPrimitive;
use serde::Serialize;
use url::Url;

use crate::{Error, Result, dom_attributes::NativeAttributes, layout::Work, machine::Response};

pub(crate) fn element(node: NodeRef<'_>) -> bool {
    node.has_name("img")
        && node
            .qual_name_ref()
            .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml")
}

#[derive(PartialEq)]
struct Source {
    url: String,
    density: f64,
}

#[derive(Clone, Copy)]
struct Dimensions {
    width: u32,
    height: u32,
}

struct Loaded {
    source: Source,
    dimensions: Option<Dimensions>,
    retry: bool,
}

enum Settled {
    Empty(usize),
    Current(Loaded),
}

pub(crate) enum Action {
    Request { owner: NodeId, url: String },
    Error { owner: NodeId, generation: usize },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Info {
    complete: bool,
    current_src: String,
    natural_width: u32,
    natural_height: u32,
}

struct Pending {
    owner: NodeId,
    source: Source,
    current: bool,
}

pub(crate) struct Images {
    origin: Url,
    nodes: HashSet<NodeId>,
    roots: HashSet<NodeId>,
    settled: HashMap<NodeId, Settled>,
    queue: VecDeque<NodeId>,
    pending: Option<Pending>,
    generation: usize,
    maximum: usize,
    dirty: bool,
}

impl Images {
    pub(crate) fn new(root: NodeId, origin: Url, maximum: usize) -> Self {
        Self {
            origin,
            nodes: HashSet::new(),
            roots: HashSet::from([root]),
            settled: HashMap::new(),
            generation: 0,
            queue: VecDeque::new(),
            pending: None,
            maximum,
            dirty: true,
        }
    }

    pub(crate) fn observe(&mut self, id: NodeId) {
        if self.nodes.insert(id) {
            self.queue.push_back(id);
        }
    }

    pub(crate) fn observe_root(&mut self, id: NodeId) {
        self.roots.insert(id);
        self.dirty = true;
    }

    pub(crate) fn adopted(&mut self, node: NodeRef<'_>) {
        let id = node.id;
        if element(node) {
            self.observe(id);
        }
        self.settled.remove(&id);
        if let Some(pending) = self.pending.as_mut().filter(|pending| pending.owner == id) {
            pending.current = false;
        }
        self.dirty = true;
    }

    pub(crate) fn attribute_changed(&mut self, id: NodeId, namespace: &str, name: &str) {
        if !namespace.is_empty() {
            return;
        }
        if ["src", "srcset", "sizes", "crossorigin", "loading"].contains(&name) {
            self.dirty = true;
            if matches!(self.settled.get(&id), Some(Settled::Empty(_))) {
                self.settled.remove(&id);
            }
            if let Some(Settled::Current(loaded)) = self.settled.get_mut(&id)
                && loaded.dimensions.is_none()
            {
                loaded.retry = true;
            }
        }
        if name == "href" {
            self.dirty = true;
        }
    }

    pub(crate) fn tree_changed(&mut self) {
        self.dirty = true;
    }

    fn source(&self, node: NodeRef<'_>, base: Option<&str>) -> Result<Option<Source>> {
        if node
            .parent()
            .is_some_and(|parent| parent.has_name("picture"))
        {
            return Err(Error::Unsupported("picture source selection".into()));
        }
        if node.null_attribute("crossorigin").is_some() {
            return Err(Error::Unsupported("image CORS mode".into()));
        }
        if node
            .null_attribute("loading")
            .is_some_and(|value| value.eq_ignore_ascii_case("lazy"))
        {
            return Err(Error::Unsupported("lazy image loading".into()));
        }
        let srcset = node.null_attribute("srcset").unwrap_or_default();
        if srcset.len() > 65_536 {
            return Err(Error::Limit("image srcset bytes"));
        }
        let mut candidates = parse_srcset::parse_srcset(&srcset);
        if candidates
            .iter()
            .any(|candidate| candidate.width.is_some() || candidate.height.is_some())
        {
            return Err(Error::Unsupported(
                "image width descriptors and sizes".into(),
            ));
        }
        if !candidates
            .iter()
            .any(|candidate| candidate.density.unwrap_or(1.0).total_cmp(&1.0).is_eq())
            && let Some(src) = node
                .null_attribute("src")
                .filter(|src| !src.trim().is_empty())
        {
            candidates.push(parse_srcset::ImageCandidate {
                url: src,
                density: Some(1.0),
                ..parse_srcset::ImageCandidate::default()
            });
        }
        candidates.retain(|candidate| {
            candidate.density.unwrap_or(1.0).is_finite() && candidate.density.unwrap_or(1.0) >= 0.0
        });
        candidates.sort_by(|left, right| {
            left.density
                .unwrap_or(1.0)
                .total_cmp(&right.density.unwrap_or(1.0))
        });
        let Some(candidate) = candidates
            .iter()
            .find(|candidate| candidate.density.unwrap_or(1.0) >= crate::media::DEVICE_PIXEL_RATIO)
            .or_else(|| candidates.last())
        else {
            return Ok(None);
        };
        if candidate.density.unwrap_or(1.0) <= 0.0 {
            return Err(Error::Unsupported("image zero pixel density".into()));
        }
        let base =
            crate::links::base(base, self.origin.as_str()).unwrap_or_else(|| self.origin.clone());
        let url = base
            .join(&candidate.url)
            .map_err(|error| Error::InvalidUrl(error.to_string()))?;
        let mut url = crate::machine::parse_url(url.as_str())?;
        url.set_fragment(None);
        Ok(Some(Source {
            url: url.to_string(),
            density: candidate.density.unwrap_or(1.0),
        }))
    }

    pub(crate) fn discover(&mut self, document: &Document, work: &mut Work<'_>) -> Result<()> {
        if !self.dirty {
            return Ok(());
        }
        for id in std::mem::take(&mut self.roots) {
            let Some(root) = document.tree.get(&id) else {
                continue;
            };
            for node in std::iter::once(root).chain(root.descendants_it()) {
                work.charge()?;
                if element(node)
                    && !node
                        .ancestors_it(None)
                        .any(|parent| parent.has_name("noscript") || parent.has_name("template"))
                {
                    self.nodes.insert(node.id);
                }
            }
        }
        self.queue = self.nodes.iter().copied().collect();
        self.dirty = false;
        Ok(())
    }

    pub(crate) fn next(
        &mut self,
        document: &Document,
        base: Option<&str>,
        work: &mut Work<'_>,
        eligible: impl Fn(NodeId) -> bool,
    ) -> Result<Option<Action>> {
        if self.pending.is_some() {
            return Ok(None);
        }
        while let Some(id) = self.queue.pop_front() {
            work.charge()?;
            if !eligible(id) {
                self.settled.remove(&id);
                continue;
            }
            let Some(node) = document.tree.get(&id) else {
                continue;
            };
            let Some(source) = self.source(node, base)? else {
                if matches!(self.settled.get(&id), Some(Settled::Empty(_))) {
                    continue;
                }
                self.generation = self.generation.saturating_add(1);
                self.settled.insert(id, Settled::Empty(self.generation));
                if node
                    .null_attribute("src")
                    .is_some_and(|src| src.trim().is_empty())
                {
                    return Ok(Some(Action::Error {
                        owner: id,
                        generation: self.generation,
                    }));
                }
                continue;
            };
            if self
                .settled
                .get(&id)
                .is_some_and(|settled| matches!(settled, Settled::Current(loaded) if loaded.source == source && !loaded.retry))
            {
                continue;
            }
            let url = source.url.clone();
            self.pending = Some(Pending {
                owner: id,
                source,
                current: true,
            });
            return Ok(Some(Action::Request { owner: id, url }));
        }
        Ok(None)
    }

    pub(crate) fn respond(
        &mut self,
        node: NodeRef<'_>,
        base: Option<&str>,
        response: Option<&Response>,
        active_document: bool,
    ) -> Result<Option<bool>> {
        let Some(Pending {
            owner: id,
            source,
            current,
        }) = self.pending.take()
        else {
            return Err(Error::Unsupported("no pending image".into()));
        };
        if !active_document
            || !current
            || id != node.id
            || self.source(node, base)?.as_ref() != Some(&source)
        {
            return Ok(None);
        }
        let dimensions = match response.filter(|response| (200..300).contains(&response.status)) {
            Some(response) => decode(
                response.raw_body.as_deref().ok_or_else(|| {
                    Error::Unsupported("image response omitted binary bytes".into())
                })?,
                self.maximum,
            )?,
            None => None,
        };
        let dimensions = dimensions
            .map(|size| {
                let width = (f64::from(size.width) / source.density)
                    .to_u32()
                    .ok_or_else(|| {
                        Error::Unsupported("image density-corrected width range".into())
                    })?;
                let height = (f64::from(size.height) / source.density)
                    .to_u32()
                    .ok_or_else(|| {
                        Error::Unsupported("image density-corrected height range".into())
                    })?;
                Ok::<_, Error>(Dimensions { width, height })
            })
            .transpose()?;
        let success = dimensions.is_some();
        self.settled.insert(
            id,
            Settled::Current(Loaded {
                source,
                dimensions,
                retry: false,
            }),
        );
        Ok(Some(success))
    }

    pub(crate) fn error_current(&self, id: NodeId, generation: usize) -> bool {
        matches!(self.settled.get(&id), Some(Settled::Empty(current)) if *current == generation)
    }

    pub(crate) fn info(
        &mut self,
        node: NodeRef<'_>,
        base: Option<&str>,
        active_document: bool,
    ) -> Result<Info> {
        if !active_document {
            self.settled.remove(&node.id);
            return Ok(Info {
                complete: true,
                current_src: String::new(),
                natural_width: 0,
                natural_height: 0,
            });
        }
        let source = self.source(node, base)?;
        let loaded = self
            .settled
            .get(&node.id)
            .and_then(|settled| match settled {
                Settled::Current(loaded) if source.is_some() => Some(loaded),
                _ => None,
            });
        let complete = source.is_none()
            || loaded
                .is_some_and(|loaded| Some(&loaded.source) == source.as_ref() && !loaded.retry);
        let dimensions = loaded.and_then(|loaded| loaded.dimensions);
        Ok(Info {
            complete,
            current_src: loaded.map_or_else(String::new, |loaded| loaded.source.url.clone()),
            natural_width: dimensions.map_or(0, |size| size.width),
            natural_height: dimensions.map_or(0, |size| size.height),
        })
    }
}

fn decode(bytes: &[u8], maximum: usize) -> Result<Option<Dimensions>> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| Error::Unsupported(error.to_string()))?;
    if reader.format().is_none() {
        return Ok(None);
    }
    let maximum = u64::try_from(maximum).map_err(|error| Error::Unsupported(error.to_string()))?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(maximum);
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    let mut reader = reader;
    reader.limits(limits);
    let decoded = (|| {
        let mut decoder = reader.into_decoder()?;
        if decoder.total_bytes() > maximum {
            return Err(image::ImageError::Limits(
                image::error::LimitError::from_kind(
                    image::error::LimitErrorKind::InsufficientMemory,
                ),
            ));
        }
        let orientation = decoder.orientation()?;
        let bitmap = image::DynamicImage::from_decoder(decoder)?;
        let (width, height) = match orientation.to_exif() {
            5..=8 => (bitmap.height(), bitmap.width()),
            _ => (bitmap.width(), bitmap.height()),
        };
        Ok(Dimensions { width, height })
    })();
    match decoded {
        Ok(size) => Ok(Some(size)),
        Err(image::ImageError::Limits(_)) => Err(Error::Limit("decoded image bytes")),
        Err(_) => Ok(None),
    }
}

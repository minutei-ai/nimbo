use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::Cursor,
    rc::Rc,
};

use dom_query::{Document, NodeId, NodeRef};
use image::{ImageDecoder, ImageReader};
use num_traits::ToPrimitive;
use serde::Serialize;
use taffy::Size;
use url::Url;

use crate::{Error, Result, dom_attributes::NativeAttributes, layout::Work, machine::Response};

pub(crate) fn element(node: NodeRef<'_>) -> bool {
    node.has_name("img")
        && node
            .qual_name_ref()
            .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml")
}

fn candidates(node: NodeRef<'_>) -> Result<Vec<parse_srcset::ImageCandidate>> {
    let srcset = node.null_attribute("srcset").unwrap_or_default();
    if srcset.len() > 65_536 {
        return Err(Error::Limit("image srcset bytes"));
    }
    let candidates = parse_srcset::parse_srcset(&srcset);
    if candidates
        .iter()
        .any(|candidate| candidate.width.is_some() || candidate.height.is_some())
    {
        return Err(Error::Unsupported(
            "image width descriptors and sizes".into(),
        ));
    }
    Ok(candidates)
}

#[derive(PartialEq)]
struct Source {
    url: String,
    density: f64,
}

struct Loaded {
    source: Source,
    generation: usize,
    dimensions: Option<Size<f64>>,
    #[cfg(not(target_arch = "wasm32"))]
    pixels: Option<Pixels>,
    retry: bool,
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) struct Pixels {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) rgba: Vec<u8>,
}

struct Decoded {
    size: Size<f64>,
    #[cfg(not(target_arch = "wasm32"))]
    pixels: Pixels,
}

enum Settled {
    Empty(usize),
    Current(Loaded),
}

pub(crate) enum Action {
    Request { owner: NodeId, url: String },
    Inline { owner: NodeId, generation: usize },
    Error { owner: NodeId, generation: usize },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Info {
    #[serde(skip)]
    pub(crate) intrinsic: Option<Size<f64>>,
    pub(crate) complete: bool,
    pub(crate) current_src: String,
    natural_width: u32,
    natural_height: u32,
}

struct Pending {
    owner: NodeId,
    source: Source,
    current: bool,
    generation: usize,
}

pub(crate) struct Images {
    origin: Url,
    media: Rc<crate::MediaEnvironment>,
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
    pub(crate) fn new(
        root: NodeId,
        origin: Url,
        maximum: usize,
        media: Rc<crate::MediaEnvironment>,
    ) -> Self {
        Self {
            origin,
            media,
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
        if [
            "src",
            "srcset",
            "sizes",
            "crossorigin",
            "loading",
            "media",
            "type",
        ]
        .contains(&name)
        {
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

    fn picture_candidates(
        &self,
        node: NodeRef<'_>,
        work: &mut Work<'_>,
    ) -> Result<Option<Vec<parse_srcset::ImageCandidate>>> {
        let Some(parent) = node.parent().filter(|parent| {
            parent.has_name("picture")
                && parent
                    .qual_name_ref()
                    .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml")
        }) else {
            return Ok(None);
        };
        for source in parent.children_it(false) {
            work.charge()?;
            if source.id == node.id {
                break;
            }
            if !source.has_name("source")
                || source
                    .qual_name_ref()
                    .is_none_or(|name| name.ns.as_ref() != "http://www.w3.org/1999/xhtml")
            {
                continue;
            }
            if !self.media.matches(
                source
                    .null_attribute("media")
                    .as_deref()
                    .unwrap_or_default(),
            )? {
                continue;
            }
            if let Some(kind) = source.null_attribute("type") {
                let mime = kind
                    .split(';')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_lowercase();
                if !image::ImageFormat::from_mime_type(mime)
                    .is_some_and(|format| format.reading_enabled())
                {
                    continue;
                }
            }
            let candidates = candidates(source)?;
            if !candidates.is_empty() {
                return Ok(Some(candidates));
            }
        }
        Ok(None)
    }

    fn source(
        &self,
        node: NodeRef<'_>,
        base: Option<&str>,
        work: &mut Work<'_>,
    ) -> Result<Option<Source>> {
        if node.null_attribute("crossorigin").is_some() {
            return Err(Error::Unsupported("image CORS mode".into()));
        }
        if node
            .null_attribute("loading")
            .is_some_and(|value| value.eq_ignore_ascii_case("lazy"))
        {
            return Err(Error::Unsupported("lazy image loading".into()));
        }
        let picture = self.picture_candidates(node, work)?;
        let from_picture = picture.is_some();
        let mut candidates = match picture {
            Some(candidates) => candidates,
            None => candidates(node)?,
        };
        if !from_picture
            && !candidates
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
        let url = if url.scheme() == "data" {
            url
        } else {
            let mut url = crate::machine::parse_url(url.as_str())?;
            url.set_fragment(None);
            url
        };
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
            let Some(source) = self.source(node, base, work)? else {
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
            self.generation = self.generation.saturating_add(1);
            self.pending = Some(Pending {
                owner: id,
                source,
                current: true,
                generation: self.generation,
            });
            if url.starts_with("data:") {
                return Ok(Some(Action::Inline {
                    owner: id,
                    generation: self.generation,
                }));
            }
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
        work: &mut Work<'_>,
    ) -> Result<Option<bool>> {
        let Some(Pending {
            owner: id,
            source,
            current,
            generation,
        }) = self.pending.take()
        else {
            return Err(Error::Unsupported("no pending image".into()));
        };
        if !active_document
            || !current
            || id != node.id
            || self.source(node, base, work)?.as_ref() != Some(&source)
        {
            return Ok(None);
        }
        let inline = if source.url.starts_with("data:") {
            decode_data(&source.url, self.maximum)?
        } else {
            None
        };
        let decoded = match (
            inline.as_deref(),
            response.filter(|response| (200..300).contains(&response.status)),
        ) {
            (Some(bytes), _) => decode(bytes, self.maximum)?,
            (_, Some(response)) => decode(
                response.raw_body.as_deref().ok_or_else(|| {
                    Error::Unsupported("image response omitted binary bytes".into())
                })?,
                self.maximum,
            )?,
            (None, None) => None,
        };
        let dimensions = decoded
            .as_ref()
            .map(|decoded| {
                let corrected = decoded.size.map(|value| value / source.density);
                corrected.width.to_u32().ok_or_else(|| {
                    Error::Unsupported("image density-corrected width range".into())
                })?;
                corrected.height.to_u32().ok_or_else(|| {
                    Error::Unsupported("image density-corrected height range".into())
                })?;
                Ok::<_, Error>(corrected)
            })
            .transpose()?;
        #[cfg(not(target_arch = "wasm32"))]
        let pixels = decoded.map(|decoded| decoded.pixels);
        let success = dimensions.is_some();
        self.settled.insert(
            id,
            Settled::Current(Loaded {
                source,
                generation,
                dimensions,
                #[cfg(not(target_arch = "wasm32"))]
                pixels,
                retry: false,
            }),
        );
        Ok(Some(success))
    }

    pub(crate) fn event_current(
        &self,
        node: NodeRef<'_>,
        base: Option<&str>,
        generation: usize,
        work: &mut Work<'_>,
    ) -> Result<bool> {
        let source = self.source(node, base, work)?;
        Ok(match self.settled.get(&node.id) {
            Some(Settled::Empty(current)) => *current == generation && source.is_none(),
            Some(Settled::Current(loaded)) => {
                loaded.generation == generation && source.as_ref() == Some(&loaded.source)
            }
            None => false,
        })
    }

    pub(crate) fn info(
        &mut self,
        node: NodeRef<'_>,
        base: Option<&str>,
        active_document: bool,
        work: &mut Work<'_>,
    ) -> Result<Info> {
        if !active_document {
            self.settled.remove(&node.id);
            return Ok(Info {
                intrinsic: None,
                complete: true,
                current_src: String::new(),
                natural_width: 0,
                natural_height: 0,
            });
        }
        let source = self.source(node, base, work)?;
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
            intrinsic: dimensions,
            complete,
            current_src: loaded.map_or_else(String::new, |loaded| loaded.source.url.clone()),
            natural_width: dimensions.map_or(Ok(0), |size| {
                size.width
                    .to_u32()
                    .ok_or_else(|| Error::Unsupported("image density-corrected width range".into()))
            })?,
            natural_height: dimensions.map_or(Ok(0), |size| {
                size.height.to_u32().ok_or_else(|| {
                    Error::Unsupported("image density-corrected height range".into())
                })
            })?,
        })
    }

    /// Decoded RGBA of a settled image, at its natural pixel size.
    #[cfg(not(target_arch = "wasm32"))]
    pub(crate) fn bitmap(&self, id: NodeId) -> Option<Pixels> {
        match self.settled.get(&id)? {
            Settled::Current(loaded) => loaded.pixels.as_ref().map(|pixels| Pixels {
                width: pixels.width,
                height: pixels.height,
                rgba: pixels.rgba.clone(),
            }),
            Settled::Empty(_) => None,
        }
    }
}

fn decode_data(url: &str, maximum: usize) -> Result<Option<Vec<u8>>> {
    let Ok(data) = data_url::DataUrl::process(url) else {
        return Ok(None);
    };
    let mut body = Vec::with_capacity(maximum.min(url.len()));
    let result = data.decode(|bytes| {
        if bytes.len() > maximum.saturating_sub(body.len()) {
            return Err(Error::Limit("image data bytes"));
        }
        body.extend_from_slice(bytes);
        Ok(())
    });
    match result {
        Ok(_) => Ok(Some(body)),
        Err(data_url::forgiving_base64::DecodeError::InvalidBase64(_)) => Ok(None),
        Err(data_url::forgiving_base64::DecodeError::WriteError(error)) => Err(error),
    }
}

fn decode(bytes: &[u8], maximum: usize) -> Result<Option<Decoded>> {
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
        let mut bitmap = image::DynamicImage::from_decoder(decoder)?;
        bitmap.apply_orientation(orientation);
        let rgba = bitmap.into_rgba8();
        let (width, height) = rgba.dimensions();
        let samples = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| {
                image::ImageError::Limits(image::error::LimitError::from_kind(
                    image::error::LimitErrorKind::InsufficientMemory,
                ))
            })?;
        if samples > maximum {
            return Err(image::ImageError::Limits(
                image::error::LimitError::from_kind(
                    image::error::LimitErrorKind::InsufficientMemory,
                ),
            ));
        }
        let raw = rgba.into_raw();
        if u64::try_from(raw.len()).ok() != Some(samples) {
            return Err(image::ImageError::Limits(
                image::error::LimitError::from_kind(
                    image::error::LimitErrorKind::InsufficientMemory,
                ),
            ));
        }
        #[cfg(target_arch = "wasm32")]
        let _samples = raw.len();
        Ok(Decoded {
            size: Size {
                width: f64::from(width),
                height: f64::from(height),
            },
            #[cfg(not(target_arch = "wasm32"))]
            pixels: Pixels {
                width,
                height,
                rgba: raw,
            },
        })
    })();
    match decoded {
        Ok(image) => Ok(Some(image)),
        Err(image::ImageError::Limits(_)) => Err(Error::Limit("decoded image bytes")),
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod picture_tests {
    use super::{Images, element};
    use crate::{Error, Limits, MediaEnvironment, Result};
    use dom_query::Document;
    use std::rc::Rc;

    #[test]
    fn picture_selection_uses_page_media_and_preceding_supported_sources() -> Result<()> {
        let document = Document::from(
            "<picture><source media='(max-width:1px)' srcset='/ignored.png 320w'><source type='image/x-unavailable' srcset='/ignored.png'><source media='(max-width:8.25em)' srcset='/narrow.png'><source type='IMAGE/PNG; charset=utf-8' srcset='/wide.png 2x'><img src='/fallback.png'><source srcset='/ignored.png'></picture>",
        );
        let node = document
            .root()
            .descendants_it()
            .find(|node| element(*node))
            .ok_or_else(|| Error::Dom("missing fixture image".into()))?;
        for (width, path, density) in [
            (131, "/narrow.png", 1.0),
            (132, "/narrow.png", 1.0),
            (133, "/wide.png", 2.0),
        ] {
            let media = Rc::new(MediaEnvironment {
                width,
                ..MediaEnvironment::default()
            });
            let origin = url::Url::parse("https://example.test/")
                .map_err(|error| Error::InvalidUrl(error.to_string()))?;
            let images = Images::new(
                document.root().id,
                origin,
                Limits::default().max_response_bytes,
                media,
            );
            let limits = Limits::default();
            let mut operations = 0;
            let mut work = crate::layout::Work::new(
                &mut operations,
                limits.max_dom_operations,
                limits.max_layout_nodes,
            );
            let source = images
                .source(node, None, &mut work)?
                .ok_or_else(|| Error::Dom("missing selected source".into()))?;
            assert_eq!(source.url, format!("https://example.test{path}"));
            assert!(source.density.total_cmp(&density).is_eq());
            let mut bounded_operations = 0;
            let mut bounded =
                crate::layout::Work::new(&mut bounded_operations, 1, limits.max_layout_nodes);
            assert!(matches!(
                images.source(node, None, &mut bounded),
                Err(Error::Limit("DOM operations"))
            ));
        }
        Ok(())
    }
}

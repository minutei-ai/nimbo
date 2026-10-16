use crate::Result;
use taffy::LengthPercentage;

use super::unsupported;

#[derive(Clone, Copy)]
pub(super) struct Padding {
    pub index: usize,
    pub width: LengthPercentage,
}

#[derive(Clone)]
pub(super) struct Span {
    pub start: usize,
    pub end: usize,
    pub metrics: super::text::Metrics,
    pub node: Option<dom_query::NodeId>,
}

#[derive(Clone, Copy)]
pub(super) struct Atom {
    pub index: usize,
    pub id: taffy::NodeId,
}

pub(super) struct Source<'a> {
    base: &'a super::BoxContext,
    pub text: String,
    pub padding: Vec<Padding>,
    pub spans: Vec<Span>,
    pub boxes: Vec<Span>,
    pub atoms: Vec<Atom>,
}

impl<'a> Source<'a> {
    pub(super) fn new(base: &'a super::BoxContext) -> Self {
        Self {
            base,
            text: String::new(),
            padding: Vec::new(),
            spans: Vec::new(),
            boxes: Vec::new(),
            atoms: Vec::new(),
        }
    }
    pub(super) fn append(&mut self, text: &str, context: &super::BoxContext) -> Result<()> {
        let start = self.text.len();
        if start.saturating_add(text.len()) > 65_536 {
            return Err(crate::Error::Limit("layout text source"));
        }
        if text.is_empty() {
            return Ok(());
        }
        self.text.push_str(text);
        if self.spans.is_empty() && super::text::Metrics::same(context, self.base) {
            return Ok(());
        }
        if self.spans.is_empty() && start > 0 {
            self.spans.push(Span {
                start: 0,
                end: start,
                metrics: super::text::Metrics::new(self.base),
                node: None,
            });
        }
        if let Some(last) = self.spans.last_mut()
            && last.metrics.matches(context)
        {
            last.end = self.text.len();
            return Ok(());
        }
        self.spans.push(Span {
            start,
            end: self.text.len(),
            metrics: super::text::Metrics::new(context),
            node: None,
        });
        Ok(())
    }
    pub(super) fn append_atom(
        &mut self,
        id: taffy::NodeId,
        context: &super::BoxContext,
    ) -> Result<()> {
        let index = self.text.len();
        self.append("\u{fffc}", context)?;
        self.atoms.push(Atom { index, id });
        Ok(())
    }
    pub(super) fn start_inline(
        &mut self,
        width: LengthPercentage,
        context: &super::BoxContext,
    ) -> usize {
        let index = self.text.len();
        if width != LengthPercentage::length(0.0) && width != LengthPercentage::percent(0.0) {
            self.padding.push(Padding { index, width });
            self.record_inline(index, index, context);
        }
        index
    }
    pub(super) fn record_inline(&mut self, start: usize, end: usize, context: &super::BoxContext) {
        if !super::text::Metrics::same(context, self.base) {
            self.boxes.push(Span {
                start,
                end,
                metrics: super::text::Metrics::new(context),
                node: None,
            });
        }
    }
    pub(super) fn end_inline(
        &mut self,
        start: usize,
        width: LengthPercentage,
        context: &super::BoxContext,
    ) -> Result<()> {
        let preserve_breaks = context.typography.preserves_breaks();
        if width == LengthPercentage::length(0.0) || width == LengthPercentage::percent(0.0) {
            return Ok(());
        }
        let fragment = self
            .text
            .get(start..)
            .ok_or_else(|| unsupported("inline text boundary"))?;
        let trimmed = if preserve_breaks {
            fragment.trim_end_matches([' ', '\t', '\u{c}'])
        } else {
            fragment.trim_end_matches([' ', '\t', '\n', '\r', '\u{c}'])
        };
        let trimmed = if preserve_breaks {
            trimmed
                .strip_suffix("\r\n")
                .or_else(|| trimmed.strip_suffix(['\n', '\r']))
                .unwrap_or(trimmed)
        } else {
            trimmed
        };
        let index = start.saturating_add(trimmed.len());
        self.padding.push(Padding { index, width });
        self.record_inline(index, index, context);
        Ok(())
    }
}

pub(super) struct Normalized {
    pub text: String,
    pub padding: Vec<Padding>,
    pub spans: Vec<Span>,
    pub boxes: Vec<Span>,
    pub atoms: Vec<Atom>,
}

fn trim_line(
    text: &mut String,
    mappings: &mut [usize],
    trailing: Option<usize>,
    end: usize,
) -> Result<()> {
    if text.ends_with(' ') {
        text.truncate(text.len().saturating_sub(1));
    }
    if let Some(start) = trailing {
        mappings
            .get_mut(start..=end)
            .ok_or_else(|| unsupported("inline text boundary"))?
            .fill(text.len());
    }
    Ok(())
}

pub(super) fn normalize(source: &Source<'_>, preserve_breaks: bool) -> Result<Normalized> {
    let raw = &source.text;
    let padding = &source.padding;
    if padding.is_empty()
        && source.spans.is_empty()
        && source.boxes.is_empty()
        && source.atoms.is_empty()
    {
        let collapse = |line: &str| {
            line.split([' ', '\t', '\n', '\r', '\u{c}'])
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        };
        let text = if preserve_breaks {
            raw.replace("\r\n", "\n")
                .replace('\r', "\n")
                .split('\n')
                .map(collapse)
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            collapse(raw)
        };
        return Ok(Normalized {
            text,
            padding: Vec::new(),
            spans: Vec::new(),
            boxes: Vec::new(),
            atoms: Vec::new(),
        });
    }
    let (text, mappings) = mapped_whitespace(raw, preserve_breaks)?;
    let mut result = Vec::with_capacity(padding.len());
    for value in padding {
        if !raw.is_char_boundary(value.index) {
            return Err(unsupported("inline text boundary"));
        }
        let index = mappings
            .get(value.index)
            .copied()
            .ok_or_else(|| unsupported("inline text boundary"))?;
        result.push(Padding {
            index,
            width: value.width,
        });
    }
    result.sort_by_key(|value| value.index);
    let mut spans = Vec::with_capacity(source.spans.len());
    for span in &source.spans {
        let start = mappings
            .get(span.start)
            .copied()
            .ok_or_else(|| unsupported("inline text boundary"))?;
        let end = mappings
            .get(span.end)
            .copied()
            .ok_or_else(|| unsupported("inline text boundary"))?;
        if start < end {
            spans.push(Span {
                start,
                end,
                metrics: span.metrics.clone(),
                node: span.node,
            });
        }
    }
    let mut boxes = Vec::with_capacity(source.boxes.len());
    for span in &source.boxes {
        boxes.push(Span {
            start: mappings
                .get(span.start)
                .copied()
                .ok_or_else(|| unsupported("inline text boundary"))?,
            end: mappings
                .get(span.end)
                .copied()
                .ok_or_else(|| unsupported("inline text boundary"))?,
            metrics: span.metrics.clone(),
            node: span.node,
        });
    }
    boxes.sort_by_key(|span| span.end);
    let atoms = source
        .atoms
        .iter()
        .map(|atom| {
            let index = mappings
                .get(atom.index)
                .copied()
                .ok_or_else(|| unsupported("inline atom boundary"))?;
            Ok(Atom { index, id: atom.id })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Normalized {
        text,
        padding: result,
        spans,
        boxes,
        atoms,
    })
}

fn mapped_whitespace(raw: &str, preserve_breaks: bool) -> Result<(String, Vec<usize>)> {
    let mut text = String::with_capacity(raw.len());
    let mut mappings = vec![0; raw.len().saturating_add(1)];
    let mut trailing = None;
    let mut carriage_return = false;
    for (index, ch) in raw.char_indices() {
        *mappings
            .get_mut(index)
            .ok_or_else(|| unsupported("inline text boundary"))? = text.len();
        if preserve_breaks && (ch == '\r' || ch == '\n') {
            if ch == '\n' && carriage_return {
                carriage_return = false;
                continue;
            }
            trim_line(&mut text, &mut mappings, trailing, index)?;
            text.push('\n');
            trailing = None;
            carriage_return = ch == '\r';
            continue;
        }
        carriage_return = false;
        if matches!(ch, ' ' | '\t' | '\n' | '\r' | '\u{c}') {
            if !text.is_empty() && !text.ends_with([' ', '\n']) {
                text.push(' ');
                trailing = Some(index);
            }
        } else {
            text.push(ch);
            trailing = None;
        }
    }
    trim_line(&mut text, &mut mappings, trailing, raw.len())?;
    *mappings
        .last_mut()
        .ok_or_else(|| unsupported("inline text boundary"))? = text.len();
    Ok((text, mappings))
}

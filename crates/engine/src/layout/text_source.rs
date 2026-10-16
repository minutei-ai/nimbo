use crate::Result;
use taffy::LengthPercentage;

use super::unsupported;

#[derive(Clone, Copy)]
pub(super) struct Padding {
    pub index: usize,
    pub width: LengthPercentage,
}

#[derive(Default)]
pub(super) struct Source {
    pub text: String,
    pub padding: Vec<Padding>,
}

impl Source {
    pub(super) fn start_inline(&mut self, width: LengthPercentage) -> usize {
        let index = self.text.len();
        if width != LengthPercentage::length(0.0) && width != LengthPercentage::percent(0.0) {
            self.padding.push(Padding { index, width });
        }
        index
    }
    pub(super) fn end_inline(
        &mut self,
        start: usize,
        width: LengthPercentage,
        preserve_breaks: bool,
    ) -> Result<()> {
        if width == LengthPercentage::length(0.0) || width == LengthPercentage::percent(0.0) {
            return Ok(());
        }
        let content = self
            .text
            .get(start..)
            .ok_or_else(|| unsupported("inline text boundary"))?;
        let trimmed = if preserve_breaks {
            content.trim_end_matches([' ', '\t', '\u{c}'])
        } else {
            content.trim_end_matches([' ', '\t', '\n', '\r', '\u{c}'])
        };
        let trimmed = if preserve_breaks {
            trimmed
                .strip_suffix("\r\n")
                .or_else(|| trimmed.strip_suffix(['\n', '\r']))
                .unwrap_or(trimmed)
        } else {
            trimmed
        };
        self.padding.push(Padding {
            index: start.saturating_add(trimmed.len()),
            width,
        });
        Ok(())
    }
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

pub(super) fn normalize(raw: &str, padding: &[Padding], preserve_breaks: bool) -> Result<Source> {
    if padding.is_empty() {
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
        return Ok(Source {
            text,
            padding: Vec::new(),
        });
    }
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
    Ok(Source {
        text,
        padding: result,
    })
}

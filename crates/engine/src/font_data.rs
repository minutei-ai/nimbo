use std::{cell::RefCell, rc::Rc};

use harfrust::{Buffer, Font, ShapeOptions, ShaperFont};
use rquickjs::{Ctx, Exception, Function, TypedArray};
use ttf_parser::Face;

const INPUT_LIMIT: usize = 1_048_576;
const TOTAL_LIMIT: usize = 4_194_304;
const ATTEMPT_LIMIT: usize = 128;

// This is a structural TrueType parser, not an OpenType Sanitizer replacement.
fn valid(bytes: &[u8]) -> bool {
    let Ok(face) = Face::parse(bytes, 0) else {
        return false;
    };
    if !face.raw_face().table_records.into_iter().all(|record| {
        let Ok(offset) = usize::try_from(record.offset) else {
            return false;
        };
        let Ok(length) = usize::try_from(record.length) else {
            return false;
        };
        offset
            .checked_add(length)
            .is_some_and(|end| end <= bytes.len())
    }) {
        return false;
    }
    let tables = face.tables();
    tables.cmap.is_some() && tables.hmtx.is_some() && tables.glyf.is_some()
}

#[derive(Clone, PartialEq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Registered {
    resource: usize,
    supported: bool,
    #[serde(flatten)]
    description: crate::font_matching::Description,
}

struct Resource {
    font: Font,
    variable: bool,
}

#[derive(Default)]
pub(crate) struct Arena {
    fonts: Vec<Resource>,
    registered: Vec<Registered>,
    attempts: usize,
    total: usize,
    canvas_work: usize,
}

impl Arena {
    fn admit(&mut self, bytes: Vec<u8>) -> crate::Result<usize> {
        if bytes
            .get(..4)
            .is_some_and(|header| matches!(header, b"wOFF" | b"wOF2" | b"OTTO" | b"ttcf"))
        {
            return Err(crate::Error::Dom(
                "unsupported: compressed, CFF or collection fonts".into(),
            ));
        }
        if !valid(&bytes) {
            return Ok(0);
        }
        let variable = Face::parse(&bytes, 0).is_ok_and(|face| {
            face.raw_face()
                .table_records
                .into_iter()
                .any(|table| table.tag == ttf_parser::Tag::from_bytes(b"fvar"))
        });
        let Some(font) = Font::new(bytes, 0) else {
            return Ok(0);
        };
        self.fonts.push(Resource { font, variable });
        Ok(self.fonts.len())
    }
    pub(crate) fn synchronize(&mut self, source: &str) -> crate::Result<bool> {
        if source.len() > 1_048_576 {
            return Err(crate::Error::Limit("font registry payload"));
        }
        let registered: Vec<Registered> = serde_json::from_str(source)?;
        if registered.len() > 1024
            || registered
                .iter()
                .any(|face| face.resource == 0 || face.resource > self.fonts.len())
        {
            return Err(crate::Error::Dom("invalid font registry resource".into()));
        }
        if self.registered == registered {
            return Ok(false);
        }
        self.registered = registered;
        Ok(true)
    }
    pub(crate) fn select(&self, font: String, text: &str) -> crate::Result<Font> {
        let request = crate::font_matching::Request {
            font,
            text: text.encode_utf16().collect(),
            faces: self
                .registered
                .iter()
                .map(|face| face.description.clone())
                .collect(),
        };
        let selected = crate::font_matching::select(&request)?
            .ok_or_else(|| crate::Error::Dom("invalid layout font".into()))?;
        if selected.is_empty() {
            return crate::builtin_fonts::select(&request.font);
        }
        let [index] = selected.as_slice() else {
            return Err(crate::Error::Dom(
                "layout unsupported: text shaping: font selection or fallback".into(),
            ));
        };
        let face = self
            .registered
            .get(*index)
            .ok_or_else(|| crate::Error::Dom("invalid layout font index".into()))?;
        if !face.supported {
            return Err(crate::Error::Dom(
                "layout unsupported: font shaping descriptor".into(),
            ));
        }
        let resource = self
            .fonts
            .get(face.resource.saturating_sub(1))
            .ok_or_else(|| crate::Error::Dom("invalid native font resource".into()))?;
        if resource.variable
            || !crate::font_matching::without_synthesis(&request.font, &face.description)?
        {
            return Err(crate::Error::Dom(
                "layout unsupported: loaded font synthesis or variation".into(),
            ));
        }
        Ok(resource.font.clone())
    }
}

pub(crate) fn install<'js>(ctx: &Ctx<'js>, fonts: Rc<RefCell<Arena>>) -> rquickjs::Result<()> {
    let measures = Rc::clone(&fonts);
    ctx.globals().set(
        "nimboFontMeasure",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>, id: usize, text: String, size: f64| {
                let mut arena = measures.borrow_mut();
                arena.canvas_work = arena.canvas_work.saturating_add(text.len().max(1));
                if arena.canvas_work > 65_536
                    || text.len() > 1024
                    || !size.is_finite()
                    || !(0.0..=4096.0).contains(&size)
                {
                    return Err(Exception::throw_message(&ctx, "font shaping limit"));
                }
                let font = id
                    .checked_sub(1)
                    .and_then(|index| arena.fonts.get(index))
                    .ok_or_else(|| {
                        Exception::throw_message(&ctx, "invalid native font resource")
                    })?;
                if font.variable {
                    return Err(Exception::throw_message(
                        &ctx,
                        "unsupported: font variations",
                    ));
                }
                measure(&font.font, &text, size)
                    .map_err(|message| Exception::throw_message(&ctx, message))
            },
        )?,
    )?;
    ctx.globals().set(
        "nimboFontData",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>, source: TypedArray<'js, u8>| {
                let length = source.len();
                let mut arena = fonts.borrow_mut();
                arena.attempts = arena.attempts.saturating_add(1);
                arena.total = arena.total.saturating_add(length);
                if arena.attempts > ATTEMPT_LIMIT
                    || length > INPUT_LIMIT
                    || arena.total > TOTAL_LIMIT
                {
                    return Err(Exception::throw_message(&ctx, "font data limit"));
                }
                let count = u32::try_from(length)
                    .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))?;
                // Native integer-indexed elements preserve copied font ownership.
                let bytes = (0..count)
                    .map(|index| source.as_object().get::<_, u8>(index))
                    .collect::<rquickjs::Result<Vec<_>>>()?;
                arena
                    .admit(bytes)
                    .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))
            },
        )?,
    )
}

// One bounded LTR Latin run. Script itemization, bidi and glyph fallback are
// deliberately rejected until the layout engine can implement their runs.
pub(crate) fn measure(font: &Font, text: &str, size: f64) -> Result<f64, &'static str> {
    measure_spaced(font, text, size, 0.0)
}

pub(crate) fn measure_spaced(
    font: &Font,
    text: &str,
    size: f64,
    spacing: f64,
) -> Result<f64, &'static str> {
    if !text
        .chars()
        .all(|ch| matches!(u32::from(ch), 0x20..=0x024f | 0x0300..=0x036f | 0x20ac))
    {
        return Err("unsupported: text script itemization or bidi");
    }
    let mut buffer = Buffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    let features = [
        harfrust::Feature::new(harfrust::Tag::new(b"liga"), 0, ..),
        harfrust::Feature::new(harfrust::Tag::new(b"clig"), 0, ..),
    ];
    let options = ShapeOptions::new().features(if spacing == 0.0 { &[] } else { &features });
    harfrust::shape(&ShaperFont::new(font), &mut buffer, options)
        .map_err(|_error| "font shaping failed")?;
    if !buffer.allocation_successful() {
        return Err("font shaping work or allocation limit");
    }
    if buffer.glyph_infos().iter().any(|glyph| glyph.glyph_id == 0) {
        return Err("unsupported: font glyph fallback");
    }
    let advance = buffer
        .glyph_positions()
        .iter()
        .try_fold(0_i32, |sum, glyph| sum.checked_add(glyph.x_advance))
        .ok_or("font advance limit")?;
    let units = font.units_per_em();
    if units == 0 {
        return Err("invalid font units");
    }
    // For this supported Latin subset, combining marks join the preceding
    // typographic unit. Required ligatures do not erase character spacing.
    if spacing == 0.0 {
        return Ok(f64::from(advance) * size / f64::from(units));
    }
    let count = text
        .chars()
        .enumerate()
        .filter(|(index, character)| {
            *index == 0 || !matches!(u32::from(*character), 0x0300..=0x036f)
        })
        .count();
    let count = u32::try_from(count).map_err(|_error| "font character unit limit")?;
    Ok(f64::from(advance) * size / f64::from(units) + f64::from(count) * spacing)
}

#[cfg(test)]
mod tests {
    use super::{measure, valid};
    use harfrust::Font;

    #[test]
    fn measures_actual_glyph_advances_and_rejects_missing_coverage() -> Result<(), String> {
        let font = Font::new(
            include_bytes!("../tests/fixtures/synthetic-font.ttf").to_vec(),
            0,
        )
        .ok_or("font parsing")?;
        assert_eq!(measure(&font, "A B€", 16.0), Ok(37.6));
        assert_eq!(measure(&font, "", 16.0), Ok(0.0));
        assert_eq!(
            measure(&font, "C", 16.0),
            Err("unsupported: font glyph fallback")
        );
        assert_eq!(
            measure(&font, "שלום", 16.0),
            Err("unsupported: text script itemization or bidi")
        );
        Ok(())
    }

    #[test]
    fn applies_actual_gsub_gpos_and_canonical_unicode_composition() -> Result<(), String> {
        let font = Font::new(
            include_bytes!("../tests/fixtures/synthetic-shaping-font.ttf").to_vec(),
            0,
        )
        .ok_or("font parsing")?;
        assert_eq!(measure(&font, "AB", 16.0), Ok(14.4));
        assert_eq!(measure(&font, "BA", 16.0), Ok(20.0));
        assert_eq!(measure(&font, "é", 16.0), Ok(8.8));
        assert_eq!(measure(&font, "e\u{301}", 16.0), Ok(8.8));
        Ok(())
    }

    #[test]
    fn parses_real_truetype_tables_and_rejects_truncated_bytes() {
        let data = include_bytes!("../tests/fixtures/synthetic-font.ttf");
        assert!(valid(data));
        // Three final alignment bytes are not part of any table.
        for length in 0..data.len().saturating_sub(3) {
            assert!(!valid(data.get(..length).unwrap_or_default()));
        }
        assert!(!valid(&[0, 1, 0, 0]));
    }
}

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

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

pub(crate) fn install<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<()> {
    let attempts = Rc::new(Cell::new(0_usize));
    let total = Rc::new(Cell::new(0_usize));
    let fonts = Rc::new(RefCell::new(Vec::<Font>::new()));
    let measures = Rc::clone(&fonts);
    let work = Cell::new(0_usize);
    ctx.globals().set(
        "nimboFontMeasure",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>, id: usize, text: String, size: f64| {
                work.set(work.get().saturating_add(text.len().max(1)));
                if work.get() > 65_536
                    || text.len() > 1024
                    || !size.is_finite()
                    || !(0.0..=4096.0).contains(&size)
                {
                    return Err(Exception::throw_message(&ctx, "font shaping limit"));
                }
                let fonts = measures.borrow();
                let font = id
                    .checked_sub(1)
                    .and_then(|index| fonts.get(index))
                    .ok_or_else(|| {
                        Exception::throw_message(&ctx, "invalid native font resource")
                    })?;
                measure(font, &text, size)
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
                attempts.set(attempts.get().saturating_add(1));
                total.set(total.get().saturating_add(length));
                if attempts.get() > ATTEMPT_LIMIT
                    || length > INPUT_LIMIT
                    || total.get() > TOTAL_LIMIT
                {
                    return Err(Exception::throw_message(&ctx, "font data limit"));
                }
                // Reading integer-indexed native array elements avoids unsafe borrowed
                // buffer access across QuickJS calls and does not invoke page getters.
                let count = u32::try_from(length)
                    .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))?;
                let bytes = (0..count)
                    .map(|index| source.as_object().get::<_, u8>(index))
                    .collect::<rquickjs::Result<Vec<_>>>()?;
                if bytes
                    .get(..4)
                    .is_some_and(|header| matches!(header, b"wOFF" | b"wOF2" | b"OTTO" | b"ttcf"))
                {
                    return Err(Exception::throw_message(
                        &ctx,
                        "unsupported: compressed, CFF or collection fonts",
                    ));
                }
                if !valid(&bytes) {
                    return Ok(0_usize);
                }
                let Some(font) = Font::new(bytes, 0) else {
                    return Ok(0_usize);
                };
                let mut fonts = fonts.borrow_mut();
                fonts.push(font);
                Ok(fonts.len())
            },
        )?,
    )
}

// One bounded LTR Latin run. Script itemization, bidi and glyph fallback are
// deliberately rejected until the layout engine can implement their runs.
fn measure(font: &Font, text: &str, size: f64) -> Result<f64, &'static str> {
    if !text
        .chars()
        .all(|ch| matches!(u32::from(ch), 0x20..=0x024f | 0x0300..=0x036f | 0x20ac))
    {
        return Err("unsupported: text script itemization or bidi");
    }
    let mut buffer = Buffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    harfrust::shape(&ShaperFont::new(font), &mut buffer, ShapeOptions::default())
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
    Ok(f64::from(advance) * size / f64::from(units))
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

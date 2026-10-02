use std::{cell::Cell, rc::Rc};

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
                Ok(valid(&bytes))
            },
        )?,
    )
}

#[cfg(test)]
mod tests {
    use super::valid;

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

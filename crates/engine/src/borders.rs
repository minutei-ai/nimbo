//! Computed physical border widths for empty-box layout at a fixed 1 dppx scale.
use lightningcss::{
    properties::border::{BorderSideWidth, LineStyle},
    traits::Parse,
};
use taffy::prelude::{LengthPercentage, Rect};

use crate::{Error, Result, fonts::Context, layout::Work, styles::Declarations};

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: {detail}"))
}

#[derive(Clone, Default)]
struct Side {
    width: f64,
    style: LineStyle,
}

#[derive(Clone, Default)]
pub(crate) struct Borders(Rect<Side>);

pub(crate) fn property(name: &str) -> bool {
    matches!(
        name,
        "border-top-width"
            | "border-right-width"
            | "border-bottom-width"
            | "border-left-width"
            | "border-top-style"
            | "border-right-style"
            | "border-bottom-style"
            | "border-left-style"
    )
}

fn side(
    name: &str,
    parent: &Side,
    declarations: &[(&str, &str, bool)],
    fonts: &Context,
    work: &mut Work<'_>,
) -> Result<Side> {
    work.charge()?;
    let value = resolved(declarations, &format!("border-{name}-style"));
    let style = match value {
        "" | "initial" | "unset" => LineStyle::None,
        "inherit" => parent.style,
        _ => LineStyle::parse_string(value).map_err(|_error| unsupported("border style"))?,
    };
    let value = resolved(declarations, &format!("border-{name}-width"));
    let width = match value {
        "inherit" => parent.width,
        "" | "initial" | "unset" => 3.0,
        _ => match BorderSideWidth::parse_string(value)
            .map_err(|_error| unsupported("border width"))?
        {
            BorderSideWidth::Thin => 1.0,
            BorderSideWidth::Medium => 3.0,
            BorderSideWidth::Thick => 5.0,
            BorderSideWidth::Length(value) => fonts.length(&value, work)?.max(0.0),
        },
    };
    // CSS Values snapping: zero remains zero, positive values below one device
    // pixel become one, and larger values are rounded down. This engine currently
    // uses one device pixel per CSS pixel; configurable device scale is absent.
    let width = if matches!(style, LineStyle::None | LineStyle::Hidden) || width <= 0.0 {
        0.0
    } else {
        width.floor().max(1.0)
    };
    Ok(Side { width, style })
}

fn resolved<'a>(entries: &[(&str, &'a str, bool)], name: &str) -> &'a str {
    entries
        .iter()
        .find(|entry| entry.0 == name)
        .map_or("", |entry| entry.1)
}

impl Borders {
    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let entries = crate::layout::logical::entries(declarations);
        if !entries.iter().any(|(name, _, _)| property(name)) {
            return Ok(Self::default());
        }
        Ok(Self(Rect {
            top: side("top", &self.0.top, &entries, fonts, work)?,
            right: side("right", &self.0.right, &entries, fonts, work)?,
            bottom: side("bottom", &self.0.bottom, &entries, fonts, work)?,
            left: side("left", &self.0.left, &entries, fonts, work)?,
        }))
    }
    pub(crate) fn geometry(&self) -> Result<Rect<LengthPercentage>> {
        fn length(side: &Side) -> Result<LengthPercentage> {
            let value: f32 = side
                .width
                .to_string()
                .parse()
                .map_err(|_error| unsupported("border width"))?;
            if !value.is_finite() {
                return Err(unsupported("non-finite border width"));
            }
            Ok(LengthPercentage::length(value))
        }
        Ok(Rect {
            top: length(&self.0.top)?,
            right: length(&self.0.right)?,
            bottom: length(&self.0.bottom)?,
            left: length(&self.0.left)?,
        })
    }
}

// The transformer accepts negative literal border lengths. Reject them at
// declaration time, while math expressions keep their specified syntax and are
// clamped only after evaluation. Parser::next skips nested color/math blocks.
pub(crate) fn valid_literals(name: &str, value: &str) -> bool {
    if !matches!(
        crate::layout::logical::physical(name),
        "border"
            | "outline"
            | "outline-width"
            | "border-top"
            | "border-right"
            | "border-bottom"
            | "border-left"
            | "border-inline"
            | "border-block"
            | "border-inline-start"
            | "border-inline-end"
            | "border-block-start"
            | "border-block-end"
            | "border-inline-width"
            | "border-block-width"
            | "border-width"
            | "border-top-width"
            | "border-right-width"
            | "border-bottom-width"
            | "border-left-width"
    ) {
        return true;
    }
    let mut input = cssparser::ParserInput::new(value);
    let mut parser = cssparser::Parser::new(&mut input);
    while let Ok(token) = parser.next() {
        if matches!(token, cssparser::Token::Dimension { value, .. }
            | cssparser::Token::Number { value, .. } if *value < 0.0)
        {
            return false;
        }
    }
    true
}

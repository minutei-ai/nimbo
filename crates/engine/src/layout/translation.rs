//! Geometry-only CSS translations. Rotation, scale and perspective fail explicitly.
use super::{Work, lengths, unsupported};
use crate::{Result, fonts::Context, styles::Declarations};
use lightningcss::{
    properties::transform::{Transform, TransformList, Translate},
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
    values::length::LengthPercentage,
};
use taffy::{Point, style::ExpandedLengthPercentageAuto};
#[derive(Clone, Copy, Default)]
struct Axis {
    pixels: f64,
    percent: f64,
}
impl Axis {
    fn add(
        &mut self,
        value: &LengthPercentage,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<()> {
        let source = value
            .to_css_string(PrinterOptions::default())
            .map_err(|_error| unsupported("translation"))?;
        let value: taffy::LengthPercentageAuto = lengths::value("left", &source, fonts, work)?
            .parse()
            .map_err(|_error| unsupported("translation"))?;
        match value.expand() {
            ExpandedLengthPercentageAuto::Length(value) => self.pixels += f64::from(value),
            ExpandedLengthPercentageAuto::Percent(value) => self.percent += f64::from(value),
            ExpandedLengthPercentageAuto::Auto => return Err(unsupported("translation")),
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Default)]
pub(super) struct Translation {
    x: Axis,
    y: Axis,
}
impl Translation {
    pub(super) fn offset(self, width: f64, height: f64) -> Result<Point<f64>> {
        let x = self.x.pixels + self.x.percent * width;
        let y = self.y.pixels + self.y.percent * height;
        if !x.is_finite() || !y.is_finite() {
            return Err(unsupported("non-finite translation"));
        }
        Ok(Point { x, y })
    }
    pub(super) fn parse(
        declarations: &Declarations,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Option<Self>> {
        let mut translation = Self::default();
        let mut active = false;
        for (name, value, deferred) in declarations.layout_entries() {
            if !matches!(name, "transform" | "translate" | "transform-origin") {
                continue;
            }
            if deferred {
                return Err(unsupported("translation variable substitution"));
            }
            work.charge()?;
            if matches!(value, "none" | "initial" | "unset") {
                continue;
            }
            if name == "transform-origin" {
                lightningcss::values::position::Position::parse_string(value)
                    .map_err(|_error| unsupported("transform-origin"))?;
                continue;
            }
            if name == "translate" {
                if let Translate::XYZ { x, y, z } =
                    Translate::parse_string(value).map_err(|_error| unsupported("translate"))?
                {
                    if fonts.length(&z, work)? != 0.0 {
                        return Err(unsupported("3D translation"));
                    }
                    translation.x.add(&x, fonts, work)?;
                    translation.y.add(&y, fonts, work)?;
                    active = true;
                }
                continue;
            }
            let list =
                TransformList::parse_string(value).map_err(|_error| unsupported("transform"))?;
            active |= !list.0.is_empty();
            for transform in list.0 {
                match transform {
                    Transform::Translate(x, y) => {
                        translation.x.add(&x, fonts, work)?;
                        translation.y.add(&y, fonts, work)?;
                    }
                    Transform::TranslateX(x) => translation.x.add(&x, fonts, work)?,
                    Transform::TranslateY(y) => translation.y.add(&y, fonts, work)?,
                    Transform::Translate3d(x, y, z) => {
                        if fonts.length(&z, work)? != 0.0 {
                            return Err(unsupported("3D translation"));
                        }
                        translation.x.add(&x, fonts, work)?;
                        translation.y.add(&y, fonts, work)?;
                    }
                    other => {
                        let matrix = other
                            .to_matrix()
                            .and_then(|matrix| matrix.to_matrix2d())
                            .ok_or_else(|| unsupported("non-translation transform"))?;
                        if matrix.a.to_bits() != 1.0_f32.to_bits()
                            || matrix.b != 0.0
                            || matrix.c != 0.0
                            || matrix.d.to_bits() != 1.0_f32.to_bits()
                        {
                            return Err(unsupported("non-translation transform"));
                        }
                        translation.x.pixels += f64::from(matrix.e);
                        translation.y.pixels += f64::from(matrix.f);
                    }
                }
            }
        }
        Ok(active.then_some(translation))
    }
    pub(super) fn property(name: &str) -> bool {
        matches!(name, "transform" | "translate" | "transform-origin")
    }
}

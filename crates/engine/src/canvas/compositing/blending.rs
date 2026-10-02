//! Separable and luminosity/saturation blend functions from CSS Compositing 1.
use super::Mode;

fn hard_light(backdrop: f64, source: f64) -> f64 {
    if source <= 0.5 {
        2.0 * backdrop * source
    } else {
        1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source)
    }
}
fn soft_light(backdrop: f64, source: f64) -> f64 {
    if source <= 0.5 {
        backdrop - (1.0 - 2.0 * source) * backdrop * (1.0 - backdrop)
    } else {
        let curve = if backdrop <= 0.25 {
            ((16.0 * backdrop - 12.0) * backdrop + 4.0) * backdrop
        } else {
            backdrop.sqrt()
        };
        backdrop + (2.0 * source - 1.0) * (curve - backdrop)
    }
}
fn channel(backdrop: f64, source: f64, mode: Mode) -> f64 {
    match mode {
        Mode::Multiply => backdrop * source,
        Mode::Screen => backdrop + source - backdrop * source,
        Mode::Overlay => hard_light(source, backdrop),
        Mode::Darken => backdrop.min(source),
        Mode::Lighten => backdrop.max(source),
        Mode::ColorDodge => {
            if backdrop <= 0.0 {
                0.0
            } else if source >= 1.0 {
                1.0
            } else {
                (backdrop / (1.0 - source)).min(1.0)
            }
        }
        Mode::ColorBurn => {
            if backdrop >= 1.0 {
                1.0
            } else if source <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - backdrop) / source).min(1.0)
            }
        }
        Mode::HardLight => hard_light(backdrop, source),
        Mode::SoftLight => soft_light(backdrop, source),
        Mode::Difference => (backdrop - source).abs(),
        Mode::Exclusion => backdrop + source - 2.0 * backdrop * source,
        _ => source,
    }
}
fn luminosity([red, green, blue]: [f64; 3]) -> f64 {
    0.3 * red + 0.59 * green + 0.11 * blue
}
fn minimum([red, green, blue]: [f64; 3]) -> f64 {
    red.min(green).min(blue)
}
fn maximum([red, green, blue]: [f64; 3]) -> f64 {
    red.max(green).max(blue)
}
fn saturation(color: [f64; 3]) -> f64 {
    maximum(color) - minimum(color)
}
fn set_luminosity(color: [f64; 3], light: f64) -> [f64; 3] {
    let shift = light - luminosity(color);
    let mut color = color.map(|value| value + shift);
    let light = luminosity(color);
    let low = minimum(color);
    let high = maximum(color);
    if low < 0.0 {
        color = color.map(|value| light + (value - light) * light / (light - low));
    }
    if high > 1.0 {
        color = color.map(|value| light + (value - light) * (1.0 - light) / (high - light));
    }
    color.map(|value| value.clamp(0.0, 1.0))
}
fn set_saturation(color: [f64; 3], value: f64) -> [f64; 3] {
    let low = minimum(color);
    let high = maximum(color);
    if high <= low {
        return [0.0; 3];
    }
    color.map(|channel| (channel - low) * value / (high - low))
}
pub(super) fn blend(backdrop: [f64; 3], source: [f64; 3], mode: Mode) -> [f64; 3] {
    match mode {
        Mode::Hue => set_luminosity(
            set_saturation(source, saturation(backdrop)),
            luminosity(backdrop),
        ),
        Mode::Saturation => set_luminosity(
            set_saturation(backdrop, saturation(source)),
            luminosity(backdrop),
        ),
        Mode::Color => set_luminosity(source, luminosity(backdrop)),
        Mode::Luminosity => set_luminosity(backdrop, luminosity(source)),
        _ => {
            let [br, bg, bb] = backdrop;
            let [sr, sg, sb] = source;
            [
                channel(br, sr, mode),
                channel(bg, sg, mode),
                channel(bb, sb, mode),
            ]
        }
    }
}

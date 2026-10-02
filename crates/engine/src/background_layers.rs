//! Computed attachment/origin/clip lists; image clipping and painting are separate.
use crate::{Error, Result, layout::Work, styles::Declarations};
use cssparser::{Parser, ParserInput};

#[derive(Clone, Copy)]
enum Kind {
    Attachment,
    Origin,
    Clip,
}
impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Attachment => "background-attachment",
            Self::Origin => "background-origin",
            Self::Clip => "background-clip",
        }
    }
    fn initial(self) -> &'static str {
        match self {
            Self::Attachment => "scroll",
            Self::Origin => "padding-box",
            Self::Clip => "border-box",
        }
    }
    fn keyword(self, value: &str) -> Option<&'static str> {
        match (self, value.to_ascii_lowercase().as_str()) {
            (Self::Attachment, "scroll") => Some("scroll"),
            (Self::Attachment, "fixed") => Some("fixed"),
            (Self::Attachment, "local") => Some("local"),
            (Self::Origin | Self::Clip, "border-box") => Some("border-box"),
            (Self::Origin | Self::Clip, "padding-box") => Some("padding-box"),
            (Self::Origin | Self::Clip, "content-box") => Some("content-box"),
            (Self::Clip, "text") => Some("text"),
            (Self::Clip, "border-area") => Some("border-area"),
            _ => None,
        }
    }
    fn parse(self, source: &str) -> Option<Vec<&'static str>> {
        let mut source = ParserInput::new(source);
        Parser::new(&mut source)
            .parse_entirely(|input| {
                input.parse_comma_separated(|input| {
                    let value = input.expect_ident_cloned()?;
                    let first = self
                        .keyword(&value)
                        .ok_or_else(|| input.new_custom_error::<(), ()>(()))?;
                    if matches!(self, Self::Clip)
                        && matches!(first, "border-area" | "text")
                        && !input.is_exhausted()
                    {
                        let value = input.expect_ident_cloned()?;
                        let second = self.keyword(&value);
                        if matches!(
                            (first, second),
                            ("text", Some("border-area")) | ("border-area", Some("text"))
                        ) {
                            return Ok("border-area text");
                        }
                        return Err(input.new_custom_error::<(), ()>(()));
                    }
                    Ok(first)
                })
            })
            .ok()
    }
}

fn kind(name: &str) -> Option<Kind> {
    match name {
        "background-attachment" => Some(Kind::Attachment),
        "background-origin" => Some(Kind::Origin),
        "background-clip" => Some(Kind::Clip),
        _ => None,
    }
}
pub(crate) fn property(name: &str) -> bool {
    kind(name).is_some()
}
pub(crate) fn specified(name: &str, value: &str) -> Option<String> {
    Some(kind(name)?.parse(value)?.join(", "))
}

#[derive(Clone)]
struct List {
    kind: Kind,
    values: Vec<&'static str>,
}
impl List {
    fn new(kind: Kind) -> Self {
        Self {
            kind,
            values: vec![kind.initial()],
        }
    }
    fn compute(
        &self,
        declarations: &Declarations,
        count: usize,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let (value, _) = declarations.value(self.kind.name());
        let values = match value.as_str() {
            "inherit" => {
                for _value in &self.values {
                    work.charge()?;
                }
                self.values.clone()
            }
            "" | "initial" | "unset" | "revert" => vec![self.kind.initial()],
            _ => {
                let values = self.kind.parse(&value).ok_or_else(|| {
                    Error::Dom(format!("layout unsupported: {} syntax", self.kind.name()))
                })?;
                for _value in &values {
                    work.charge()?;
                }
                values
            }
        };
        let mut result = Self {
            kind: self.kind,
            values,
        };
        result.values.truncate(count);
        Ok(result)
    }
    fn value(&self, count: usize) -> Result<String> {
        let mut values = Vec::new();
        let mut bytes = 0_usize;
        for value in self.values.iter().cycle().take(count) {
            bytes = bytes.saturating_add(value.len()).saturating_add(2);
            if bytes > 2 * 1024 * 1024 {
                return Err(Error::Limit("computed background layer bytes"));
            }
            values.push(*value);
        }
        Ok(values.join(", "))
    }
}

#[derive(Clone)]
pub(crate) struct Layers {
    attachment: List,
    origin: List,
    clip: List,
}
impl Default for Layers {
    fn default() -> Self {
        Self {
            attachment: List::new(Kind::Attachment),
            origin: List::new(Kind::Origin),
            clip: List::new(Kind::Clip),
        }
    }
}
impl Layers {
    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        count: usize,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        Ok(Self {
            attachment: self.attachment.compute(declarations, count, work)?,
            origin: self.origin.compute(declarations, count, work)?,
            clip: self.clip.compute(declarations, count, work)?,
        })
    }
    pub(crate) fn value(&self, name: &str, count: usize) -> Result<String> {
        match name {
            "background-attachment" => self.attachment.value(count),
            "background-origin" => self.origin.value(count),
            "background-clip" => self.clip.value(count),
            _ => Err(Error::Dom(
                "layout unsupported: background layer property".into(),
            )),
        }
    }
}

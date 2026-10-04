//! Computed family names; font selection, shaping and glyph metrics are separate.
use crate::{Error, Result, layout::Work, styles::Declarations};
use cssparser::{Parser, ParserInput, serialize_identifier, serialize_string};
use std::rc::Rc;

const GENERICS: [&str; 7] = [
    "serif",
    "sans-serif",
    "cursive",
    "fantasy",
    "monospace",
    "system-ui",
    "math",
];
fn reserved(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "initial" | "inherit" | "unset" | "revert" | "revert-layer" | "default"
    )
}
#[derive(Clone)]
enum Item {
    Generic(&'static str),
    Name(String),
}
impl Item {
    fn value(&self) -> Result<String> {
        match self {
            Self::Generic(name) => Ok((*name).into()),
            Self::Name(name) => {
                let mut identifier = String::new();
                serialize_identifier(name, &mut identifier).map_err(|_error| unsupported())?;
                if !name.is_empty()
                    && identifier == *name
                    && !reserved(name)
                    && !GENERICS
                        .iter()
                        .any(|generic| name.eq_ignore_ascii_case(generic))
                {
                    return Ok(name.clone());
                }
                let mut value = String::new();
                serialize_string(name, &mut value).map_err(|_error| unsupported())?;
                Ok(value)
            }
        }
    }
}
fn parse(value: &str) -> Option<Vec<Item>> {
    let mut source = ParserInput::new(value);
    Parser::new(&mut source)
        .parse_entirely(|input| {
            input.parse_comma_separated(|input| {
                if let Ok(name) = input.try_parse(Parser::expect_string_cloned) {
                    return Ok(Item::Name(name.to_string()));
                }
                let first = input.expect_ident_cloned()?;
                if let Some(generic) = GENERICS
                    .iter()
                    .find(|generic| first.eq_ignore_ascii_case(generic))
                {
                    return Ok(Item::Generic(generic));
                }
                let mut name = first.to_string();
                let mut count = 1_usize;
                while let Ok(next) = input.try_parse(Parser::expect_ident_cloned) {
                    name.push(' ');
                    name.push_str(&next);
                    count = count.saturating_add(1);
                }
                if count == 1 && reserved(&name) {
                    return Err(input.new_custom_error::<(), ()>(()));
                }
                Ok(Item::Name(name))
            })
        })
        .ok()
}
pub(crate) fn specified(value: &str) -> Option<String> {
    serialize(&parse(value)?).ok()
}
fn serialize(items: &[Item]) -> Result<String> {
    let mut result = String::new();
    for item in items {
        let value = item.value()?;
        if result.len().saturating_add(value.len()).saturating_add(2) > 2 * 1024 * 1024 {
            return Err(Error::Limit("computed font family bytes"));
        }
        if !result.is_empty() {
            result.push_str(", ");
        }
        result.push_str(&value);
    }
    Ok(result)
}
#[derive(Clone)]
pub(crate) struct Family {
    items: Rc<[Item]>,
}
impl Default for Family {
    fn default() -> Self {
        Self {
            items: vec![Item::Name("Times New Roman".into())].into(),
        }
    }
}
impl Family {
    pub(crate) fn compute(&self, declarations: &Declarations, work: &mut Work<'_>) -> Result<Self> {
        let (value, _) = declarations.value("font-family");
        match value.as_str() {
            "" | "inherit" | "unset" | "revert" => {
                for _item in self.items.iter() {
                    work.charge()?;
                }
                Ok(self.clone())
            }
            "initial" => Ok(Self::default()),
            _ => {
                let items = parse(&value).ok_or_else(unsupported)?;
                for _item in &items {
                    work.charge()?;
                }
                Ok(Self {
                    items: items.into(),
                })
            }
        }
    }
    pub(crate) fn value(&self) -> Result<String> {
        serialize(&self.items)
    }
}
fn unsupported() -> Error {
    Error::Dom("layout unsupported: font-family syntax".into())
}

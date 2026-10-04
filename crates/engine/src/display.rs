//! Native computed display transformations, shared with supported box layout.
use crate::{Error, Result, styles::Declarations};
use dom_query::NodeRef;
use lightningcss::{
    properties::display::{Display, DisplayInside, DisplayKeyword, DisplayOutside, DisplayPair},
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
    vendor_prefix::VendorPrefix,
};

fn flow() -> Display {
    Display::Pair(DisplayPair {
        outside: DisplayOutside::Block,
        inside: DisplayInside::Flow,
        is_list_item: false,
    })
}
fn initial() -> Display {
    Display::Pair(DisplayPair {
        outside: DisplayOutside::Inline,
        inside: DisplayInside::Flow,
        is_list_item: false,
    })
}
fn ua(node: NodeRef<'_>, generated: bool) -> Display {
    if generated {
        return initial();
    }
    if node.has_attr("hidden")
        || ["head", "script", "style", "link", "meta", "title"]
            .iter()
            .any(|name| node.has_name(name))
    {
        return Display::Keyword(DisplayKeyword::None);
    }
    if [
        "html", "body", "div", "main", "section", "article", "aside", "header", "footer", "nav",
    ]
    .iter()
    .any(|name| node.has_name(name))
    {
        flow()
    } else {
        initial()
    }
}
fn transform(value: &mut Display, root: bool) {
    match value {
        Display::Keyword(DisplayKeyword::None) => {}
        Display::Keyword(DisplayKeyword::Contents) if !root => {}
        Display::Keyword(_) => *value = flow(),
        Display::Pair(pair) => {
            if pair.outside == DisplayOutside::Inline && pair.inside == DisplayInside::FlowRoot {
                pair.inside = DisplayInside::Flow;
            }
            pair.outside = DisplayOutside::Block;
        }
    }
}
pub(crate) fn specified(value: &str) -> Option<String> {
    let parsed = Display::parse_string(value).ok()?;
    if matches!(&parsed, Display::Pair(pair) if pair.outside == DisplayOutside::RunIn) {
        return None;
    }
    parsed.to_css_string(PrinterOptions::default()).ok()
}
#[derive(Clone)]
pub(crate) struct Computed {
    value: Display,
    container: bool,
}
impl Default for Computed {
    fn default() -> Self {
        Self {
            value: initial(),
            container: false,
        }
    }
}
impl Computed {
    pub(crate) fn compute(
        &self,
        node: NodeRef<'_>,
        declarations: &Declarations,
        root: bool,
        generated: bool,
    ) -> Result<Self> {
        let (value, _) = declarations.value("display");
        let mut value = match value.as_str() {
            "" | "revert" => ua(node, generated),
            "initial" | "unset" => initial(),
            "inherit" => self.value.clone(),
            _ => Display::parse_string(&value).map_err(|_error| unsupported())?,
        };
        let (position, _) = declarations.value("position");
        let (float, _) = declarations.value("float");
        if root
            || self.container
            || matches!(position.as_str(), "absolute" | "fixed")
            || matches!(float.as_str(), "left" | "right")
        {
            transform(&mut value, root);
        }
        let container = match &value {
            Display::Keyword(DisplayKeyword::Contents) => self.container,
            Display::Pair(pair) => {
                matches!(pair.inside, DisplayInside::Flex(_) | DisplayInside::Grid)
            }
            Display::Keyword(_) => false,
        };
        Ok(Self { value, container })
    }
    pub(crate) fn value(&self) -> Result<String> {
        self.value
            .to_css_string(PrinterOptions::default())
            .map_err(|_error| unsupported())
    }
    pub(crate) fn none(&self) -> bool {
        matches!(self.value, Display::Keyword(DisplayKeyword::None))
    }
    pub(crate) fn layout(&self) -> Result<taffy::Display> {
        match &self.value {
            Display::Keyword(DisplayKeyword::None) => Ok(taffy::Display::None),
            Display::Pair(pair) if pair.outside == DisplayOutside::Block && !pair.is_list_item => {
                match pair.inside {
                    DisplayInside::Flow => Ok(taffy::Display::Block),
                    DisplayInside::Flex(VendorPrefix::None) => Ok(taffy::Display::Flex),
                    DisplayInside::Grid => Ok(taffy::Display::Grid),
                    _ => Err(unsupported()),
                }
            }
            _ => Err(unsupported()),
        }
    }
}
fn unsupported() -> Error {
    Error::Dom("layout unsupported: display formatting".into())
}

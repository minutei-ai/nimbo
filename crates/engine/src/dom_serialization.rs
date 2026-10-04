use dom_query::{NodeData, NodeRef};

use crate::{Error, Result};

const HTML: &str = "http://www.w3.org/1999/xhtml";

fn escaped(output: &mut String, text: &str, attribute: bool) {
    for character in text.chars() {
        output.push_str(match character {
            '&' => "&amp;",
            '\u{a0}' => "&nbsp;",
            '<' => "&lt;",
            '>' => "&gt;",
            '"' if attribute => "&quot;",
            _ => {
                output.push(character);
                continue;
            }
        });
    }
}

fn qualified(output: &mut String, element: &dom_query::Element) {
    if let Some(prefix) = &element.name.prefix {
        output.push_str(prefix);
        output.push(':');
    }
    output.push_str(&element.name.local);
}

fn open(output: &mut String, element: &dom_query::Element) {
    output.push('<');
    qualified(output, element);
    for attribute in &element.attrs {
        output.push(' ');
        if let Some(prefix) = &attribute.name.prefix {
            output.push_str(prefix);
            output.push(':');
        }
        output.push_str(&attribute.name.local);
        output.push_str("=\"");
        escaped(output, &attribute.value, true);
        output.push('"');
    }
    output.push('>');
}

fn void(element: &dom_query::Element) -> bool {
    element.name.ns.as_ref() == HTML
        && matches!(
            element.name.local.as_ref(),
            "area"
                | "base"
                | "basefont"
                | "bgsound"
                | "link"
                | "meta"
                | "br"
                | "col"
                | "embed"
                | "hr"
                | "img"
                | "input"
                | "keygen"
                | "param"
                | "source"
                | "track"
                | "wbr"
        )
}

fn raw_text(node: NodeRef<'_>) -> bool {
    node.parent().is_some_and(|parent| {
        parent.query_or(false, |parent| match &parent.data {
            NodeData::Element(element) => {
                element.name.ns.as_ref() == HTML
                    && matches!(
                        element.name.local.as_ref(),
                        "script"
                            | "style"
                            | "xmp"
                            | "iframe"
                            | "noembed"
                            | "noframes"
                            | "plaintext"
                    )
            }
            _ => false,
        })
    })
}

pub(crate) fn serialize(
    node: NodeRef<'_>,
    include: bool,
    operations: &mut usize,
    operation_limit: usize,
    byte_limit: usize,
) -> Result<String> {
    let mut output = String::new();
    let mut stack = if include {
        vec![(node, false)]
    } else {
        node.children_it(true).map(|child| (child, false)).collect()
    };
    while let Some((node, closing)) = stack.pop() {
        if closing {
            node.query(|node| {
                if let NodeData::Element(element) = &node.data {
                    output.push_str("</");
                    qualified(&mut output, element);
                    output.push('>');
                }
            });
        } else {
            if *operations >= operation_limit {
                return Err(Error::Limit("DOM operations"));
            }
            *operations = operations.saturating_add(1);
            let descend = node.query_or(false, |data| match &data.data {
                NodeData::Element(element) => {
                    open(&mut output, element);
                    if void(element) {
                        false
                    } else {
                        stack.push((node, true));
                        true
                    }
                }
                NodeData::Text { contents } => {
                    if raw_text(node) {
                        output.push_str(contents);
                    } else {
                        escaped(&mut output, contents, false);
                    }
                    false
                }
                NodeData::Comment { contents } => {
                    output.push_str("<!--");
                    output.push_str(contents);
                    output.push_str("-->");
                    false
                }
                NodeData::Doctype { name, .. } => {
                    output.push_str("<!DOCTYPE ");
                    output.push_str(name);
                    output.push('>');
                    false
                }
                NodeData::ProcessingInstruction { target, contents } => {
                    output.push_str("<?");
                    output.push_str(target);
                    output.push(' ');
                    output.push_str(contents);
                    output.push('>');
                    false
                }
                NodeData::Document | NodeData::Fragment => true,
            });
            if descend {
                stack.extend(node.children_it(true).map(|child| (child, false)));
                node.query(|data| {
                    if let NodeData::Element(element) = &data.data
                        && let Some(id) = element.template_contents
                        && let Some(contents) = node.tree.get(&id)
                    {
                        stack.push((contents, false));
                    }
                });
            }
        }
        if output.len() > byte_limit {
            return Err(Error::Limit("DOM serialization bytes"));
        }
    }
    Ok(output)
}

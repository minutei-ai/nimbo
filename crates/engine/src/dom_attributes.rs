use dom_query::{Attr, NodeData, NodeRef};

use crate::{Error, Result};

pub(crate) trait NativeAttributes {
    fn null_attribute(&self, name: &str) -> Option<String>;
}
impl NativeAttributes for NodeRef<'_> {
    fn null_attribute(&self, name: &str) -> Option<String> {
        self.query_or(None, |node| {
            node.as_element()?
                .attrs
                .iter()
                .find(|attribute| {
                    attribute.name.ns.is_empty() && attribute.name.local.as_ref() == name
                })
                .map(|attribute| attribute.value.to_string())
        })
    }
}

fn qualified(attribute: &Attr, name: &str) -> bool {
    attribute.name.prefix.as_ref().map_or_else(
        || attribute.name.local.as_ref() == name,
        |prefix| {
            name.strip_prefix(prefix.as_ref())
                .and_then(|name| name.strip_prefix(':'))
                == Some(attribute.name.local.as_ref())
        },
    )
}
pub(crate) fn normalized_name(node: NodeRef<'_>, name: &str, html: bool) -> String {
    if html
        && node
            .qual_name_ref()
            .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml")
    {
        name.to_ascii_lowercase()
    } else {
        name.to_owned()
    }
}
pub(crate) fn named(node: NodeRef<'_>, name: &str, html: bool) -> Option<String> {
    named_info(node, name, html).map(|(_, _, value)| value)
}
pub(crate) fn named_info(
    node: NodeRef<'_>,
    name: &str,
    html: bool,
) -> Option<(String, Option<String>, String)> {
    let name = normalized_name(node, name, html);
    node.query_or(None, |node| {
        node.as_element()?
            .attrs
            .iter()
            .find(|attribute| qualified(attribute, &name))
            .map(|attribute| {
                (
                    attribute.name.local.to_string(),
                    if attribute.name.ns.is_empty() {
                        None
                    } else {
                        Some(attribute.name.ns.to_string())
                    },
                    attribute.value.to_string(),
                )
            })
    })
}
pub(crate) fn namespaced(node: NodeRef<'_>, namespace: &str, local: &str) -> Option<String> {
    node.query_or(None, |node| {
        node.as_element()?
            .attrs
            .iter()
            .find(|attribute| {
                attribute.name.ns.as_ref() == namespace && attribute.name.local.as_ref() == local
            })
            .map(|attribute| attribute.value.to_string())
    })
}
pub(crate) fn names(node: NodeRef<'_>) -> Vec<String> {
    node.attrs()
        .iter()
        .map(|attribute| {
            attribute.name.prefix.as_ref().map_or_else(
                || attribute.name.local.to_string(),
                |prefix| format!("{prefix}:{}", attribute.name.local),
            )
        })
        .collect()
}
pub(crate) fn set_named(node: NodeRef<'_>, name: &str, value: &str, html: bool) -> Result<()> {
    let name = normalized_name(node, name, html);
    let exists = node
        .attrs()
        .iter()
        .any(|attribute| qualified(attribute, &name));
    if !exists {
        validate_local(&name)?;
    }
    let mut qualified_name = node
        .qual_name_ref()
        .map(|name| name.clone())
        .ok_or_else(|| Error::Dom("attribute target must be an element".into()))?;
    qualified_name.local = name.as_str().into();
    qualified_name.prefix = None;
    qualified_name.ns = "".into();
    node.update(|node| {
        if let NodeData::Element(element) = &mut node.data {
            if let Some(attribute) = element
                .attrs
                .iter_mut()
                .find(|attribute| qualified(attribute, &name))
            {
                attribute.value = value.into();
            } else {
                element.attrs.push(Attr {
                    name: qualified_name,
                    value: value.into(),
                });
            }
        }
    });
    Ok(())
}
pub(crate) fn remove_named(node: NodeRef<'_>, name: &str, html: bool) {
    let name = normalized_name(node, name, html);
    node.update(|node| {
        if let NodeData::Element(element) = &mut node.data
            && let Some(index) = element
                .attrs
                .iter()
                .position(|attribute| qualified(attribute, &name))
        {
            element.attrs.remove(index);
        }
    });
}
pub(crate) fn validate_local(name: &str) -> Result<()> {
    if name.is_empty()
        || name.chars().any(|character| {
            matches!(
                character,
                '\0' | '\t' | '\n' | '\r' | '\u{c}' | ' ' | '/' | '=' | '>'
            )
        })
    {
        return Err(Error::DomException {
            name: "InvalidCharacterError",
            message: "invalid attribute local name",
        });
    }
    Ok(())
}
pub(crate) fn create_namespaced(
    node: NodeRef<'_>,
    namespace: &str,
    qualified: &str,
    value: &str,
) -> Result<Attr> {
    let (prefix, local) = qualified
        .split_once(':')
        .map_or((None, qualified), |(prefix, local)| (Some(prefix), local));
    validate_local(local)?;
    if prefix.is_some_and(|prefix| {
        prefix.is_empty()
            || prefix.chars().any(|character| {
                matches!(
                    character,
                    '\0' | '\t' | '\n' | '\r' | '\u{c}' | ' ' | '/' | '>'
                )
            })
    }) {
        return Err(Error::DomException {
            name: "InvalidCharacterError",
            message: "invalid namespace prefix",
        });
    }
    if (prefix.is_some() && namespace.is_empty())
        || (prefix == Some("xml") && namespace != "http://www.w3.org/XML/1998/namespace")
        || ((qualified == "xmlns" || prefix == Some("xmlns"))
            && namespace != "http://www.w3.org/2000/xmlns/")
        || (namespace == "http://www.w3.org/2000/xmlns/"
            && qualified != "xmlns"
            && prefix != Some("xmlns"))
    {
        return Err(Error::DomException {
            name: "NamespaceError",
            message: "inconsistent attribute namespace",
        });
    }
    let mut name = node
        .qual_name_ref()
        .map(|name| name.clone())
        .ok_or_else(|| Error::Dom("attribute target must be an element".into()))?;
    name.local = local.into();
    name.prefix = prefix.map(Into::into);
    name.ns = namespace.into();
    Ok(Attr {
        name,
        value: value.into(),
    })
}
pub(crate) fn create_named(node: NodeRef<'_>, name: &str, value: &str, html: bool) -> Result<Attr> {
    let local = normalized_name(node, name, html);
    validate_local(&local)?;
    let mut name = node
        .qual_name_ref()
        .map(|name| name.clone())
        .ok_or_else(|| Error::Dom("attribute template must be an element".into()))?;
    name.local = local.as_str().into();
    name.prefix = None;
    name.ns = "".into();
    Ok(Attr {
        name,
        value: value.into(),
    })
}
pub(crate) fn set_namespaced(
    node: NodeRef<'_>,
    namespace: &str,
    qualified: &str,
    value: &str,
) -> Result<()> {
    let attribute = create_namespaced(node, namespace, qualified, value)?;
    let name = attribute.name;
    node.update(|node| {
        if let NodeData::Element(element) = &mut node.data {
            if let Some(attribute) = element.attrs.iter_mut().find(|attribute| {
                attribute.name.ns == name.ns && attribute.name.local == name.local
            }) {
                attribute.value = value.into();
            } else {
                element.attrs.push(Attr {
                    name,
                    value: value.into(),
                });
            }
        }
    });
    Ok(())
}
pub(crate) fn remove_namespaced(node: NodeRef<'_>, namespace: &str, local: &str) {
    node.update(|node| {
        if let NodeData::Element(element) = &mut node.data {
            element.attrs.retain(|attribute| {
                attribute.name.ns.as_ref() != namespace || attribute.name.local.as_ref() != local
            });
        }
    });
}

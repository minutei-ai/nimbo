use cssparser::{BasicParseErrorKind, ParseError, Parser};

#[derive(Default)]
pub(crate) struct Layers {
    nodes: Vec<Layer>,
    pub(crate) failure: Option<&'static str>,
}
struct Layer {
    parent: Vec<usize>,
    name: Option<String>,
    path: Vec<usize>,
}

impl Layers {
    pub(crate) fn register(
        &mut self,
        parent: &[usize],
        name: Option<&[String]>,
    ) -> Result<Vec<usize>, &'static str> {
        if parent.len().saturating_add(name.map_or(1, <[String]>::len)) > 32 {
            self.failure = Some("stylesheet layer depth");
            return Err("stylesheet layer depth");
        }
        let mut path = parent.to_vec();
        if let Some(parts) = name {
            for part in parts {
                path = self.child(&path, Some(part))?;
            }
        } else {
            path = self.child(&path, None)?;
        }
        Ok(path)
    }

    fn child(&mut self, parent: &[usize], name: Option<&str>) -> Result<Vec<usize>, &'static str> {
        if let Some(name) = name
            && let Some(node) = self
                .nodes
                .iter()
                .find(|node| node.parent == parent && node.name.as_deref() == Some(name))
        {
            return Ok(node.path.clone());
        }
        if self.nodes.len() >= 1024 {
            self.failure = Some("stylesheet layers");
            return Err("stylesheet layers");
        }
        let ordinal = self
            .nodes
            .iter()
            .filter(|node| node.parent == parent)
            .count();
        let mut path = parent.to_vec();
        path.push(ordinal);
        self.nodes.push(Layer {
            parent: parent.to_vec(),
            name: name.map(str::to_owned),
            path: path.clone(),
        });
        Ok(path)
    }
}

pub(crate) fn names<'i>(
    input: &mut Parser<'i, '_>,
) -> Result<Vec<Vec<String>>, ParseError<'i, &'static str>> {
    if input.is_exhausted() {
        return Ok(Vec::new());
    }
    input.parse_comma_separated(|input| {
        let mut parts = Vec::new();
        loop {
            let name = input.expect_ident()?.to_string();
            if [
                "initial",
                "inherit",
                "unset",
                "revert",
                "revert-layer",
                "default",
            ]
            .iter()
            .any(|keyword| name.eq_ignore_ascii_case(keyword))
            {
                return Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid));
            }
            parts.push(name);
            if input.is_exhausted() {
                break;
            }
            input.expect_delim('.')?;
        }
        Ok(parts)
    })
}

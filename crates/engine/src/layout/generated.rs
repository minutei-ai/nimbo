use super::{
    BoxContext, Tree, Work, layout_error, style_for, text_source, translation, unsupported,
};
use crate::{
    Error, Result,
    styles::{Declarations, Variables},
};
use dom_query::NodeRef;
use taffy::prelude::*;

pub(super) struct Content {
    declarations: Declarations,
    text: String,
}

fn content(declarations: &Declarations, work: &mut Work<'_>) -> Result<Option<String>> {
    let (value, deferred) = declarations.value("content");
    if deferred {
        return Err(unsupported("variable substitution"));
    }
    if matches!(value.as_str(), "" | "none" | "normal" | "initial" | "unset") {
        return Ok(None);
    }
    let mut input = cssparser::ParserInput::new(&value);
    let mut parser = cssparser::Parser::new(&mut input);
    let mut text = String::new();
    let mut strings = false;
    while !parser.is_exhausted() {
        work.charge()?;
        match parser
            .next()
            .map_err(|_error| unsupported("generated content"))?
        {
            cssparser::Token::QuotedString(value) => {
                if text.len().saturating_add(value.len()) > text_source::SOURCE_LIMIT {
                    return Err(Error::Limit("layout text source"));
                }
                text.push_str(value);
                strings = true;
            }
            cssparser::Token::Delim('/') if strings => return Ok(Some(text)),
            _ => return Err(unsupported("generated content")),
        }
    }
    Ok(Some(text))
}

impl Tree<'_, '_> {
    pub(super) fn generated_source(
        &mut self,
        node: NodeRef<'_>,
        kind: crate::cascade::Generated,
        parent: &Variables,
    ) -> Result<Option<Content>> {
        let declarations = self.cascade.resolve(
            node,
            &Declarations::default(),
            Some(kind),
            self.containers,
            Some(self.controls),
            self.work,
        )?;
        let (declarations, variables) = self.computed.compute(
            &declarations,
            parent,
            &self.cascade.registrations,
            self.work,
        )?;
        let declarations = self.animate(&declarations, &variables)?;
        if declarations.value("display").0 == "none" {
            return Ok(None);
        }
        let Some(text) = content(&declarations, self.work)? else {
            return Ok(None);
        };
        Ok(Some(Content { declarations, text }))
    }
    pub(super) fn generated(
        &mut self,
        node: NodeRef<'_>,
        kind: crate::cascade::Generated,
        parent: &Variables,
        parent_display: Display,
        depth: usize,
        context: &BoxContext,
    ) -> Result<Option<NodeId>> {
        let Some(generated) = self.generated_source(node, kind, parent)? else {
            return Ok(None);
        };
        let declarations = generated.declarations;
        if !matches!(parent_display, Display::Flex | Display::Grid)
            && declarations.value("position").0 != "absolute"
            && !declarations.layout_entries().any(|(name, value, _)| {
                name == "display" && matches!(value, "block" | "flow-root" | "flex" | "grid")
            })
        {
            return Err(unsupported("generated inline formatting"));
        }
        self.visit(depth)?;
        let display = context.display.compute(node, &declarations, false, true)?;
        if display.contents() {
            if generated.text.is_empty() {
                return Ok(None);
            }
            return Err(unsupported("generated display:contents text"));
        }
        let context = context.compute(
            &declarations,
            false,
            node,
            display,
            &self.fonts.borrow(),
            self.work,
        )?;
        let (mut style, _) = style_for(
            node,
            &declarations,
            true,
            &context.display,
            &context.fonts,
            self.work,
        )?;
        style.border = context.borders.geometry()?;
        let out_of_flow = style.position == Position::Absolute;
        let mut children = Vec::new();
        if !generated.text.is_empty() {
            let mut source = text_source::Source::new(&context);
            source.append(&generated.text, &context)?;
            self.text_item(&mut source, &context, &mut children)?;
        }
        let id = self
            .boxes
            .new_with_children(style, &children)
            .map_err(|error| layout_error(&error))?;
        self.remember_padding(id)?;
        self.orders.insert(id, context.order);
        if let Some(translation) =
            translation::Translation::parse(&declarations, &context.fonts, self.work)?
        {
            self.translations.insert(id, translation);
        }
        if out_of_flow {
            // The originating element establishes the containing block when positioned.
            // Keep the generated box distinct from its owner in the DOM-to-box map.
            let containing = std::iter::once(node)
                .chain(node.ancestors_it(None))
                .find(|ancestor| {
                    self.positioned.contains(&ancestor.id)
                        || self.transformed.contains(&ancestor.id)
                })
                .map(|ancestor| ancestor.id);
            self.out_of_flow.push((id, containing));
        }
        Ok(Some(id))
    }
}

use dom_query::NodeRef;
use serde_json::Value;

use super::{Choice, Dom, options};
use crate::{Error, Result, dom_attributes::NativeAttributes};

impl Dom {
    pub(in crate::dom) fn selection_resize(
        &mut self,
        select: NodeRef<'_>,
        value: &str,
    ) -> Result<Value> {
        let length = value
            .parse::<usize>()
            .map_err(|error| Error::Dom(error.to_string()))?;
        let mut nodes = options::list(select, &self.control_view())?;
        if length == nodes.len() {
            return Ok(Value::Null);
        }
        let growth = length.saturating_sub(nodes.len());
        if self.allocated_nodes.get().saturating_add(growth) > self.limits.max_dom_nodes {
            return Err(Error::Limit("DOM nodes"));
        }
        let removed = if length < nodes.len() {
            nodes.split_off(length)
        } else {
            Vec::new()
        };
        for _ in 0..growth {
            self.control_view().charge()?;
        }
        self.charge_pending_work()?;
        self.charge_write(growth.saturating_mul(6).saturating_add(removed.len()))?;
        self.may_have_controls.options |= growth > 0;
        let document = self.node_document(select.id);
        let mut added = Vec::with_capacity(growth);
        for _ in 0..growth {
            self.allocate_node()?;
            let id = self.document.tree.new_element("option").id;
            self.adopt_tree(id, document)?;
            nodes.push(id);
            added.push(id);
        }
        let single = !select.has_null_attribute("multiple");
        let choice = if single {
            self.selection
                .borrow()
                .choice(select, &nodes, None, false, &self.control_view())?
        } else {
            Choice {
                selected: None,
                fallback: false,
            }
        };
        self.charge_pending_work()?;
        let committed = (|| {
            for id in removed {
                self.mutation_removing(id, false)?;
                self.document
                    .tree
                    .get(&id)
                    .ok_or_else(|| Error::Dom("invalid removed option".into()))?
                    .remove_from_parent();
            }
            for id in added {
                self.mutation_inserting(select.id, id, &[id], None, None)?;
                select.append_child(&id);
            }
            Ok(())
        })();
        if let Err(error) = committed {
            self.selection.borrow_mut().initialized.remove(&select.id);
            return Err(error);
        }
        if single {
            self.selection
                .borrow_mut()
                .apply(&nodes, &choice, &self.control_view())?;
        }
        Ok(Value::Null)
    }
}

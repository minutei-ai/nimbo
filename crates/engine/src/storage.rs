//! Origin-bound Web Storage owned by the engine, with atomic quota checks.

use serde_json::Value;

use crate::{Error, Result};

#[derive(Debug, Default)]
pub(crate) struct Storage {
    areas: [Area; 2],
}

#[derive(Debug, Default)]
struct Area {
    // DOMString preserves every UTF-16 code unit, including lone surrogates.
    entries: Vec<(Vec<u16>, Vec<u16>)>,
    bytes: usize,
}

impl Storage {
    pub(crate) fn call(
        &mut self,
        area: usize,
        operation: &str,
        key: &str,
        value: &str,
        quota: usize,
    ) -> Result<String> {
        let area = self
            .areas
            .get_mut(area)
            .ok_or_else(|| Error::Unsupported("invalid storage area".into()))?;
        let result = match operation {
            "length" => serde_json::to_value(area.entries.len())?,
            "keys" => {
                serde_json::to_value(area.entries.iter().map(|(key, _)| key).collect::<Vec<_>>())?
            }
            "key" => {
                let index: usize = serde_json::from_str(key)?;
                serde_json::to_value(area.entries.get(index).map(|(key, _)| key))?
            }
            "get" | "set" | "remove" => {
                let key: Vec<u16> = serde_json::from_str(key)?;
                let index = area
                    .entries
                    .iter()
                    .position(|(candidate, _)| *candidate == key);
                match operation {
                    "get" => serde_json::to_value(
                        index
                            .and_then(|index| area.entries.get(index))
                            .map(|(_, value)| value),
                    )?,
                    "set" => {
                        let value: Vec<u16> = serde_json::from_str(value)?;
                        let previous = index
                            .and_then(|index| area.entries.get(index))
                            .map_or(0, |(key, value)| {
                                key.len().saturating_add(value.len()).saturating_mul(2)
                            });
                        let next = area.bytes.saturating_sub(previous).saturating_add(
                            key.len().saturating_add(value.len()).saturating_mul(2),
                        );
                        if next > quota {
                            return Err(Error::DomException {
                                name: "QuotaExceededError",
                                message: "Web Storage quota exceeded",
                            });
                        }
                        if let Some(entry) = index.and_then(|index| area.entries.get_mut(index)) {
                            entry.1 = value;
                        } else {
                            area.entries.push((key, value));
                        }
                        area.bytes = next;
                        Value::Null
                    }
                    _ => {
                        if let Some(index) = index {
                            let (key, value) = area.entries.remove(index);
                            area.bytes = area.bytes.saturating_sub(
                                key.len().saturating_add(value.len()).saturating_mul(2),
                            );
                        }
                        Value::Null
                    }
                }
            }
            "clear" => {
                area.entries.clear();
                area.bytes = 0;
                Value::Null
            }
            _ => return Err(Error::Unsupported("unknown storage operation".into())),
        };
        Ok(serde_json::to_string(&result)?)
    }
}

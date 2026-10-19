use std::io::{self, Write};

use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};

use crate::{Error, Result};

#[derive(Debug)]
pub(crate) struct Projection {
    source: Vec<u8>,
    keys: Vec<String>,
    maximum_received: usize,
    maximum_output: usize,
}

impl Projection {
    pub(crate) fn new(
        mut keys: Vec<String>,
        maximum_received: usize,
        maximum_output: usize,
    ) -> Result<Self> {
        if keys.is_empty()
            || keys.len() > 64
            || keys
                .iter()
                .any(|key| key.is_empty() || key.encode_utf16().count() > 256)
            || maximum_received == 0
            || maximum_received > 32 * 1024 * 1024
            || maximum_output == 0
            || maximum_output > 4 * 1024 * 1024
        {
            return Err(Error::Limit("invalid JSON projection configuration"));
        }
        keys.sort_unstable();
        keys.dedup();
        Ok(Self {
            source: Vec::new(),
            keys,
            maximum_received,
            maximum_output,
        })
    }

    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Result<()> {
        if bytes.len() > self.maximum_received.saturating_sub(self.source.len()) {
            return Err(Error::Limit("JSON projection received bytes"));
        }
        self.source.extend_from_slice(bytes);
        Ok(())
    }

    pub(crate) fn finish(self) -> Result<Vec<u8>> {
        let mut output = Output {
            bytes: Vec::new(),
            maximum: self.maximum_output,
            exceeded: false,
        };
        let mut deserializer = serde_json::Deserializer::from_slice(&self.source);
        let decoded = Filter {
            keys: &self.keys,
            output: &mut output,
            comma: false,
        }
        .deserialize(&mut deserializer)
        .and_then(|()| deserializer.end());
        if output.exceeded {
            return Err(Error::Limit("JSON projection output bytes"));
        }
        decoded?;
        Ok(output.bytes)
    }
}

struct Output {
    bytes: Vec<u8>,
    maximum: usize,
    exceeded: bool,
}

impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.maximum.saturating_sub(self.bytes.len()) {
            self.exceeded = true;
            return Err(io::Error::other("JSON projection output bytes"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct Filter<'a> {
    keys: &'a [String],
    output: &'a mut Output,
    comma: bool,
}

impl<'de> DeserializeSeed<'de> for Filter<'_> {
    type Value = ();

    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> std::result::Result<(), D::Error> {
        if self.comma {
            self.output
                .write_all(b",")
                .map_err(serde::de::Error::custom)?;
        }
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Filter<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_bool<E: serde::de::Error>(self, value: bool) -> std::result::Result<(), E> {
        serde_json::to_writer(self.output, &value).map_err(E::custom)
    }

    fn visit_i64<E: serde::de::Error>(self, value: i64) -> std::result::Result<(), E> {
        serde_json::to_writer(self.output, &value).map_err(E::custom)
    }

    fn visit_u64<E: serde::de::Error>(self, value: u64) -> std::result::Result<(), E> {
        serde_json::to_writer(self.output, &value).map_err(E::custom)
    }

    fn visit_f64<E: serde::de::Error>(self, value: f64) -> std::result::Result<(), E> {
        serde_json::to_writer(self.output, &value).map_err(E::custom)
    }

    fn visit_str<E: serde::de::Error>(self, value: &str) -> std::result::Result<(), E> {
        serde_json::to_writer(self.output, value).map_err(E::custom)
    }

    fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<(), E> {
        self.output.write_all(b"null").map_err(E::custom)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> std::result::Result<(), A::Error> {
        self.output
            .write_all(b"[")
            .map_err(serde::de::Error::custom)?;
        let mut comma = false;
        while sequence
            .next_element_seed(Filter {
                keys: self.keys,
                output: self.output,
                comma,
            })?
            .is_some()
        {
            comma = true;
        }
        self.output
            .write_all(b"]")
            .map_err(serde::de::Error::custom)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<(), A::Error> {
        self.output
            .write_all(b"{")
            .map_err(serde::de::Error::custom)?;
        let mut comma = false;
        while let Some(key) = map.next_key::<String>()? {
            if self.keys.binary_search(&key).is_ok() {
                map.next_value::<IgnoredAny>()?;
                continue;
            }
            if comma {
                self.output
                    .write_all(b",")
                    .map_err(serde::de::Error::custom)?;
            }
            serde_json::to_writer(&mut *self.output, &key).map_err(serde::de::Error::custom)?;
            self.output
                .write_all(b":")
                .map_err(serde::de::Error::custom)?;
            map.next_value_seed(Filter {
                keys: self.keys,
                output: self.output,
                comma: false,
            })?;
            comma = true;
        }
        self.output
            .write_all(b"}")
            .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::Projection;
    use crate::{Error, Result};

    #[test]
    fn discards_nested_values_under_separate_received_and_output_bounds() -> Result<()> {
        let source = format!(
            r#"{{"discard":"{}","keep":[true,null,-1,1.25,"Olá 😀",{{"discard":[1,2],"keep":7}}]}}"#,
            "x".repeat(1024 * 1024)
        );
        let mut projection = Projection::new(vec!["discard".into()], 2 * 1024 * 1024, 128)?;
        for chunk in source.as_bytes().chunks(8192) {
            projection.feed(chunk)?;
        }
        assert_eq!(
            String::from_utf8(projection.finish()?).map_err(std::io::Error::other)?,
            r#"{"keep":[true,null,-1,1.25,"Olá 😀",{"keep":7}]}"#
        );
        Ok(())
    }

    #[test]
    fn refuses_received_overflow_output_overflow_and_invalid_json() -> Result<()> {
        let mut received = Projection::new(vec!["discard".into()], 3, 128)?;
        assert!(matches!(
            received.feed(b"null"),
            Err(Error::Limit("JSON projection received bytes"))
        ));
        let mut output = Projection::new(vec!["discard".into()], 128, 3)?;
        output.feed(br#"{"keep":1}"#)?;
        assert!(matches!(
            output.finish(),
            Err(Error::Limit("JSON projection output bytes"))
        ));
        let mut invalid = Projection::new(vec!["discard".into()], 128, 128)?;
        invalid.feed(br#"{"discard":[1,]}"#)?;
        assert!(matches!(invalid.finish(), Err(Error::Json(_))));
        Ok(())
    }
}

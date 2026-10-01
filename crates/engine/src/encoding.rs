use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use encoding_rs::{CoderResult, Decoder, DecoderResult, Encoding, UTF_8, UTF_16BE, UTF_16LE};
use rquickjs::{Ctx, Exception, Function, Object};
use serde_json::json;

const INPUT_LIMIT: usize = 65_536;
const PAYLOAD_LIMIT: usize = 1_048_576;
const DECODER_LIMIT: usize = 128;

struct DecoderGuard(Rc<Cell<usize>>);
impl Drop for DecoderGuard {
    fn drop(&mut self) {
        self.0.set(self.0.get().saturating_sub(1));
    }
}

struct DecoderOptions {
    fatal: bool,
    ignore_bom: bool,
}

struct DecoderState {
    encoding: &'static Encoding,
    decoder: Decoder,
    options: DecoderOptions,
    bom_seen: bool,
    streaming: bool,
    pending: Vec<u8>,
    history: Vec<u8>,
    _guard: DecoderGuard,
}

impl DecoderState {
    fn decode(&mut self, ctx: &Ctx<'_>, input: &str, stream: bool) -> rquickjs::Result<String> {
        if input.len() > PAYLOAD_LIMIT {
            return Err(Exception::throw_message(ctx, "encoding input limit"));
        }
        let bytes: Vec<u8> = serde_json::from_str(input)
            .map_err(|_error| Exception::throw_type(ctx, "invalid byte buffer"))?;
        let pending_len = if self.streaming {
            self.pending.len()
        } else {
            0
        };
        if bytes.len().saturating_add(pending_len) > INPUT_LIMIT {
            return Err(Exception::throw_message(ctx, "encoding input limit"));
        }
        if !self.streaming {
            self.decoder = self.encoding.new_decoder_without_bom_handling();
            self.bom_seen = false;
            self.pending.clear();
            self.history.clear();
        }
        self.streaming = stream;
        let mut input = std::mem::take(&mut self.pending);
        input.extend_from_slice(&bytes);
        let capacity = self
            .decoder
            .max_utf16_buffer_length(input.len())
            .filter(|capacity| *capacity <= INPUT_LIMIT.saturating_mul(2))
            .ok_or_else(|| Exception::throw_message(ctx, "encoding output limit"))?;
        let mut output = vec![0_u16; capacity];
        let written = if self.options.fatal {
            let (result, read, written) =
                self.decoder
                    .decode_to_utf16_without_replacement(&input, &mut output, !stream);
            match result {
                DecoderResult::InputEmpty => written,
                DecoderResult::OutputFull => {
                    return Err(Exception::throw_message(ctx, "encoding output limit"));
                }
                DecoderResult::Malformed(_, trailing) => {
                    // Fatal streaming errors leave the unconsumed I/O queue intact.
                    // Some restored bytes can come from a previous input chunk.
                    let mut consumed = self.history.clone();
                    consumed.extend_from_slice(input.get(..read).unwrap_or_default());
                    let split = consumed.len().saturating_sub(usize::from(trailing));
                    self.pending
                        .extend_from_slice(consumed.get(split..).unwrap_or_default());
                    self.pending
                        .extend_from_slice(input.get(read..).unwrap_or_default());
                    self.history = last_bytes(consumed.get(..split).unwrap_or_default());
                    return Err(Exception::throw_type(ctx, "malformed encoded data"));
                }
            }
        } else {
            let (result, _, written, _) =
                self.decoder.decode_to_utf16(&input, &mut output, !stream);
            if result != CoderResult::InputEmpty {
                return Err(Exception::throw_message(ctx, "encoding output limit"));
            }
            written
        };
        self.history.extend_from_slice(&input);
        self.history = last_bytes(&self.history);
        output.truncate(written);
        let strip_bom = !self.bom_seen
            && !self.options.ignore_bom
            && (self.encoding == UTF_8 || self.encoding == UTF_16LE || self.encoding == UTF_16BE)
            && output.first() == Some(&0xfeff);
        if !output.is_empty() {
            self.bom_seen = true;
        }
        let output = if strip_bom {
            output.get(1..).unwrap_or_default()
        } else {
            &output[..]
        };
        String::from_utf16(output)
            .map_err(|_error| Exception::throw_type(ctx, "invalid decoded Unicode"))
    }
}

fn last_bytes(bytes: &[u8]) -> Vec<u8> {
    bytes
        .get(bytes.len().saturating_sub(3)..)
        .unwrap_or_default()
        .to_vec()
}

pub(crate) fn install<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<()> {
    ctx.globals().set(
        "nimboEncode",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'_>, input: String, capacity: usize| {
                if input.len() > PAYLOAD_LIMIT {
                    return Err(Exception::throw_message(&ctx, "encoding input limit"));
                }
                let units: Vec<u16> = serde_json::from_str(&input)
                    .map_err(|_error| Exception::throw_type(&ctx, "invalid UTF-16 input"))?;
                if units.len() > INPUT_LIMIT {
                    return Err(Exception::throw_message(&ctx, "encoding input limit"));
                }
                let mut bytes = Vec::with_capacity(units.len().saturating_mul(3).min(capacity));
                let mut read = 0_usize;
                for character in char::decode_utf16(units) {
                    let (character, count) = character
                        .map_or((char::REPLACEMENT_CHARACTER, 1), |character| {
                            (character, character.len_utf16())
                        });
                    if bytes.len().saturating_add(character.len_utf8()) > capacity {
                        break;
                    }
                    bytes.extend_from_slice(character.encode_utf8(&mut [0_u8; 4]).as_bytes());
                    read = read.saturating_add(count);
                }
                serde_json::to_string(
                    &json!({"read": read, "written": bytes.len(), "bytes": bytes}),
                )
                .map_err(|_error| Exception::throw_message(&ctx, "encoding result serialization"))
            },
        )?,
    )?;
    let live = Rc::new(Cell::new(0_usize));
    ctx.globals().set(
        "nimboDecoder",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>, label: String, fatal: bool, ignore_bom: bool| {
                let encoding = Encoding::for_label_no_replacement(label.as_bytes())
                    .ok_or_else(|| Exception::throw_range(&ctx, "unknown encoding label"))?;
                if live.get() >= DECODER_LIMIT {
                    return Err(Exception::throw_message(&ctx, "live decoder limit"));
                }
                live.set(live.get().saturating_add(1));
                let state = RefCell::new(DecoderState {
                    encoding,
                    decoder: encoding.new_decoder_without_bom_handling(),
                    options: DecoderOptions { fatal, ignore_bom },
                    bom_seen: false,
                    streaming: false,
                    pending: Vec::new(),
                    history: Vec::new(),
                    _guard: DecoderGuard(Rc::clone(&live)),
                });
                let result = Object::new(ctx.clone())?;
                result.set("encoding", encoding.name().to_ascii_lowercase())?;
                result.set(
                    "decode",
                    Function::new(ctx, move |ctx: Ctx<'_>, input: String, stream: bool| {
                        state.borrow_mut().decode(&ctx, &input, stream)
                    })?,
                )?;
                Ok(result)
            },
        )?,
    )?;
    Ok(())
}

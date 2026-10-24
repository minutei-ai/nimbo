//! WebSocket framing and the `HTTP` handshake in front of it.
//!
//! Client frames are masked, as RFC 6455 requires. Server frames are not.

use std::{
    io::{self, ErrorKind, Read},
    net::TcpStream,
};

/// One decoded client frame.
#[derive(Debug)]
pub(super) enum Frame {
    /// A text, binary, or continuation payload.
    Data {
        /// Final fragment of this message.
        fin: bool,
        /// Opcode `0`, `1`, or `2`.
        opcode: u8,
        /// Unmasked payload.
        payload: Vec<u8>,
    },
    /// A ping that the server answers with the same payload.
    Ping(Vec<u8>),
    /// The peer asked to close the socket.
    Close,
    /// A pong. It is not part of a fragmented message.
    Pong,
}

/// Headers plus any bytes that arrived after them.
pub(super) struct Handshake {
    /// Request line and headers, without the blank line.
    pub(super) head: String,
    /// Bytes already read past the header.
    pub(super) rest: Vec<u8>,
}

const MAX_FRAME: usize = 8_388_608;

pub(super) fn read_handshake(stream: &mut TcpStream) -> io::Result<Handshake> {
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 1024];
    loop {
        if header_end(&buffer).is_some() {
            break;
        }
        if buffer.len() > 65_536 {
            return Err(io::Error::other("header too large"));
        }
        let count = stream.read(&mut temp)?;
        if count == 0 {
            return Err(io::Error::new(ErrorKind::UnexpectedEof, "header closed"));
        }
        if let Some(chunk) = temp.get(..count) {
            buffer.extend_from_slice(chunk);
        }
    }
    let end = header_end(&buffer).ok_or_else(|| io::Error::other("header"))?;
    let head_bytes = buffer
        .get(..end)
        .ok_or_else(|| io::Error::other("header"))?;
    let head = std::str::from_utf8(head_bytes)
        .map_err(|error| io::Error::new(ErrorKind::InvalidData, error))?
        .to_owned();
    let rest_at = end
        .checked_add(4)
        .ok_or_else(|| io::Error::other("header"))?;
    let rest = buffer.get(rest_at..).unwrap_or_default().to_vec();
    Ok(Handshake { head, rest })
}

pub(super) fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    for line in head.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case(name) {
            return Some(value.trim());
        }
    }
    None
}

pub(super) fn request_target(head: &str) -> Option<&str> {
    let line = head.lines().next()?;
    let mut parts = line.split_whitespace();
    let _method = parts.next()?;
    parts.next()
}

pub(super) fn is_websocket(head: &str) -> bool {
    header(head, "upgrade").is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
}

pub(super) fn is_version(path: &str) -> bool {
    let bare = path.split('?').next().unwrap_or(path);
    bare.trim_end_matches('/').ends_with("/json/version")
}

pub(super) fn http_response(status: &str, content_type: &str, body: &str) -> Vec<u8> {
    let payload = body.as_bytes();
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    let mut message = head.into_bytes();
    message.extend_from_slice(payload);
    message
}

pub(super) fn upgrade(accept: &str) -> String {
    format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    )
}

pub(super) fn accept_key(key: &str) -> Option<String> {
    const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut source = String::new();
    source.push_str(key.trim());
    source.push_str(GUID);
    Some(base64(&sha1(source.as_bytes())?))
}

pub(super) fn encode(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::new();
    frame.push(0x80 | (opcode & 0x0f));
    push_length(&mut frame, payload.len());
    frame.extend_from_slice(payload);
    frame
}

pub(super) fn pop_frame(buffer: &mut Vec<u8>) -> Result<Option<Frame>, String> {
    let Some(prefix) = prefix(buffer)? else {
        return Ok(None);
    };
    if buffer.len() < prefix.total {
        return Ok(None);
    }
    let raw = take(buffer, prefix.total).ok_or_else(|| "short frame".to_owned())?;
    let mut payload = raw
        .get(prefix.payload_at..)
        .ok_or_else(|| "short frame".to_owned())?
        .to_vec();
    if prefix.masked {
        let mask_bytes = raw
            .get(prefix.mask_at..prefix.payload_at)
            .ok_or_else(|| "short mask".to_owned())?;
        unmask(&mut payload, mask_of(mask_bytes)?);
    }
    Ok(Some(classify(prefix.fin, prefix.opcode, payload)?))
}

fn header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

struct Prefix {
    fin: bool,
    opcode: u8,
    masked: bool,
    mask_at: usize,
    payload_at: usize,
    total: usize,
}

fn prefix(buffer: &[u8]) -> Result<Option<Prefix>, String> {
    let Some(first) = buffer.first().copied() else {
        return Ok(None);
    };
    let Some(second) = buffer.get(1).copied() else {
        return Ok(None);
    };
    if first & 0x70 != 0 {
        return Err("compressed websocket frame".to_owned());
    }
    let flag = usize::from(second & 0x7f);
    let (length, mask_at): (usize, usize) = match flag {
        126 => match read_be_u16(buffer, 2) {
            Some(value) => (usize::from(value), 4),
            None => return Ok(None),
        },
        127 => match read_be_u64(buffer, 2)? {
            Some(value) => (value, 10),
            None => return Ok(None),
        },
        short => (short, 2),
    };
    if length > MAX_FRAME {
        return Err("websocket frame is too large".to_owned());
    }
    let masked = second & 0x80 != 0;
    let mask_len: usize = if masked { 4 } else { 0 };
    let payload_at = mask_at
        .checked_add(mask_len)
        .ok_or_else(|| "frame length".to_owned())?;
    let total = payload_at
        .checked_add(length)
        .ok_or_else(|| "frame length".to_owned())?;
    Ok(Some(Prefix {
        fin: first & 0x80 != 0,
        opcode: first & 0x0f,
        masked,
        mask_at,
        payload_at,
        total,
    }))
}

fn classify(fin: bool, opcode: u8, payload: Vec<u8>) -> Result<Frame, String> {
    if matches!(opcode, 8..=10) && (!fin || payload.len() > 125) {
        return Err("invalid control frame".to_owned());
    }
    match opcode {
        0..=2 => Ok(Frame::Data {
            fin,
            opcode,
            payload,
        }),
        8 => Ok(Frame::Close),
        9 => Ok(Frame::Ping(payload)),
        10 => Ok(Frame::Pong),
        _ => Err("unknown websocket opcode".to_owned()),
    }
}

fn read_be_u16(buffer: &[u8], at: usize) -> Option<u16> {
    let bytes = at.checked_add(2).and_then(|end| buffer.get(at..end))?;
    let pair = [
        bytes.first().copied().unwrap_or(0),
        bytes.get(1).copied().unwrap_or(0),
    ];
    Some(u16::from_be_bytes(pair))
}

fn read_be_u64(buffer: &[u8], at: usize) -> Result<Option<usize>, String> {
    let Some(bytes) = at.checked_add(8).and_then(|end| buffer.get(at..end)) else {
        return Ok(None);
    };
    let mut wide = [0_u8; 8];
    for (index, slot) in wide.iter_mut().enumerate() {
        *slot = bytes.get(index).copied().unwrap_or(0);
    }
    usize::try_from(u64::from_be_bytes(wide))
        .map_or_else(|_| Err("frame length".to_owned()), |value| Ok(Some(value)))
}

fn mask_of(bytes: &[u8]) -> Result<[u8; 4], String> {
    Ok([
        bytes
            .first()
            .copied()
            .ok_or_else(|| "short mask".to_owned())?,
        bytes
            .get(1)
            .copied()
            .ok_or_else(|| "short mask".to_owned())?,
        bytes
            .get(2)
            .copied()
            .ok_or_else(|| "short mask".to_owned())?,
        bytes
            .get(3)
            .copied()
            .ok_or_else(|| "short mask".to_owned())?,
    ])
}

fn unmask(payload: &mut [u8], mask: [u8; 4]) {
    for (index, byte) in payload.iter_mut().enumerate() {
        let Some(slot) = index.checked_rem(4) else {
            continue;
        };
        if let Some(key) = mask.get(slot) {
            *byte ^= *key;
        }
    }
}

fn take(buffer: &mut Vec<u8>, count: usize) -> Option<Vec<u8>> {
    let taken = buffer.get(..count)?.to_vec();
    *buffer = buffer.get(count..)?.to_vec();
    Some(taken)
}

fn push_length(frame: &mut Vec<u8>, len: usize) {
    if let Ok(short) = u8::try_from(len)
        && short < 126
    {
        frame.push(short);
        return;
    }
    if let Ok(medium) = u16::try_from(len) {
        frame.push(126);
        frame.extend(medium.to_be_bytes());
        return;
    }
    frame.push(127);
    frame.extend(u64::try_from(len).unwrap_or(u64::MAX).to_be_bytes());
}

fn sha1(message: &[u8]) -> Option<[u8; 20]> {
    let bit_len = u64::try_from(message.len()).ok()?.checked_mul(8)?;
    let mut data = message.to_vec();
    data.push(0x80);
    while data.len().checked_rem(64) != Some(56) {
        data.push(0);
        if data.len() > message.len().saturating_add(72) {
            return None;
        }
    }
    data.extend(bit_len.to_be_bytes());
    let mut state = [
        0x6745_2301_u32,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut offset = 0;
    while offset < data.len() {
        let end = offset.checked_add(64)?;
        let block = data.get(offset..end)?;
        compress(&mut state, &schedule(block)?);
        offset = end;
    }
    Some(store(&state))
}

fn schedule(block: &[u8]) -> Option<[u32; 80]> {
    let mut words = [0_u32; 80];
    for index in 0_usize..16 {
        let start = index.checked_mul(4)?;
        let end = start.checked_add(4)?;
        let chunk = block.get(start..end)?;
        let bytes = [
            chunk.first().copied()?,
            chunk.get(1).copied()?,
            chunk.get(2).copied()?,
            chunk.get(3).copied()?,
        ];
        *words.get_mut(index)? = u32::from_be_bytes(bytes);
    }
    for index in 16_usize..80 {
        let mixed = word(&words, index.checked_sub(3)?)?
            ^ word(&words, index.checked_sub(8)?)?
            ^ word(&words, index.checked_sub(14)?)?
            ^ word(&words, index.checked_sub(16)?)?;
        *words.get_mut(index)? = mixed.rotate_left(1);
    }
    Some(words)
}

fn word(words: &[u32; 80], index: usize) -> Option<u32> {
    words.get(index).copied()
}

fn compress(state: &mut [u32; 5], words: &[u32; 80]) {
    let mut values = [0_u32; 5];
    for (slot, word) in values.iter_mut().zip(state.iter().copied()) {
        *slot = word;
    }
    for index in 0..80 {
        let Some(next) = mix(&values, words, index) else {
            return;
        };
        shift(&mut values, next);
    }
    for (slot, value) in state.iter_mut().zip(values) {
        *slot = slot.wrapping_add(value);
    }
}

fn mix(values: &[u32; 5], words: &[u32; 80], index: usize) -> Option<u32> {
    let (mixed, constant) = choice(
        index,
        values.get(1).copied()?,
        values.get(2).copied()?,
        values.get(3).copied()?,
    )?;
    Some(
        values
            .first()
            .copied()?
            .rotate_left(5)
            .wrapping_add(mixed)
            .wrapping_add(values.get(4).copied()?)
            .wrapping_add(constant)
            .wrapping_add(word(words, index).unwrap_or(0)),
    )
}

fn shift(values: &mut [u32; 5], next: u32) {
    let first = values.first().copied().unwrap_or(0);
    let second = values.get(1).copied().unwrap_or(0);
    let third = values.get(2).copied().unwrap_or(0);
    let fourth = values.get(3).copied().unwrap_or(0);
    if let Some(slot) = values.get_mut(4) {
        *slot = fourth;
    }
    if let Some(slot) = values.get_mut(3) {
        *slot = third;
    }
    if let Some(slot) = values.get_mut(2) {
        *slot = second.rotate_left(30);
    }
    if let Some(slot) = values.get_mut(1) {
        *slot = first;
    }
    if let Some(slot) = values.first_mut() {
        *slot = next;
    }
}

fn choice(index: usize, second: u32, third: u32, fourth: u32) -> Option<(u32, u32)> {
    if index < 20 {
        Some(((second & third) | (!second & fourth), 0x5A82_7999))
    } else if index < 40 {
        Some((second ^ third ^ fourth, 0x6ED9_EBA1))
    } else if index < 60 {
        Some((
            (second & third) | (second & fourth) | (third & fourth),
            0x8F1B_BCDC,
        ))
    } else if index < 80 {
        Some((second ^ third ^ fourth, 0xCA62_C1D6))
    } else {
        None
    }
}

fn store(state: &[u32; 5]) -> [u8; 20] {
    let mut out = [0_u8; 20];
    for (index, word) in state.iter().enumerate() {
        let start = index.saturating_mul(4);
        for (offset, byte) in word.to_be_bytes().into_iter().enumerate() {
            if let Some(slot) = out.get_mut(start.saturating_add(offset)) {
                *slot = byte;
            }
        }
    }
    out
}

fn base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut index = 0;
    while index < data.len() {
        let first = u32::from(data.get(index).copied().unwrap_or(0));
        let second = data.get(index.saturating_add(1)).copied().map(u32::from);
        let third = data.get(index.saturating_add(2)).copied().map(u32::from);
        let combined = first
            .wrapping_shl(16)
            .wrapping_add(second.unwrap_or(0).wrapping_shl(8))
            .wrapping_add(third.unwrap_or(0));
        push_six(&mut out, TABLE, combined.wrapping_shr(18));
        push_six(&mut out, TABLE, combined.wrapping_shr(12));
        if second.is_some() {
            push_six(&mut out, TABLE, combined.wrapping_shr(6));
        } else {
            out.push('=');
        }
        if third.is_some() {
            push_six(&mut out, TABLE, combined);
        } else {
            out.push('=');
        }
        index = index.saturating_add(3);
    }
    out
}

fn push_six(out: &mut String, table: &[u8; 64], bits: u32) {
    let index = usize::try_from(bits & 0x3f).unwrap_or(0);
    if let Some(byte) = table.get(index) {
        out.push(char::from(*byte));
    }
}

#[cfg(test)]
mod tests {
    use super::{Frame, accept_key, pop_frame, sha1};

    #[test]
    fn websocket_accept_matches_the_rfc_sample() {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ==").as_deref(),
            Some("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
        );
    }

    #[test]
    fn sha1_of_abc() {
        let digest = sha1(b"abc").map(|bytes| hex(&bytes));
        assert_eq!(
            digest.as_deref(),
            Some("a9993e364706816aba3e25717850c26c9cd0d89d")
        );
    }

    #[test]
    fn reads_a_masked_text_frame() {
        let mut buffer = vec![0x81, 0x82, 1, 2, 3, 4];
        push_masked(&mut buffer, b"ok", [1, 2, 3, 4]);
        assert!(matches!(
            pop_frame(&mut buffer),
            Ok(Some(Frame::Data {
                fin: true,
                opcode: 1,
                ref payload,
            })) if payload.as_slice() == b"ok"
        ));
        assert!(buffer.is_empty());
    }

    fn push_masked(buffer: &mut Vec<u8>, plain: &[u8], mask: [u8; 4]) {
        for (index, byte) in plain.iter().enumerate() {
            let Some(slot) = index.checked_rem(4) else {
                continue;
            };
            let Some(key) = mask.get(slot) else {
                continue;
            };
            buffer.push(*byte ^ *key);
        }
    }

    fn hex(bytes: &[u8]) -> String {
        const TABLE: &[u8; 16] = b"0123456789abcdef";
        let mut text = String::new();
        for byte in bytes {
            let high = usize::from(*byte).wrapping_shr(4);
            let low = usize::from(*byte) & 0x0f;
            if let Some(digit) = TABLE.get(high) {
                text.push(char::from(*digit));
            }
            if let Some(digit) = TABLE.get(low) {
                text.push(char::from(*digit));
            }
        }
        text
    }
}

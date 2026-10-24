//! Paginate the viewport bitmap into a real PDF, one viewport height per page.
use std::fmt::Write;

use super::{Layer, raster};
use crate::{Error, Result};

/// Encode `layers` as a PDF whose first page is the viewport bitmap.
///
/// Each later page is the next viewport-height slice, including boxes that sit
/// below the fold. Image samples are `DeviceRGB`, top row first.
pub(super) fn pdf(width: u32, viewport_height: u32, layers: &[Layer]) -> Result<Vec<u8>> {
    if viewport_height == 0 {
        return Err(Error::Limit("screenshot pixels"));
    }
    let pages = page_count(viewport_height, layers)?;
    let height = viewport_height
        .checked_mul(pages)
        .ok_or(Error::Limit("screenshot pixels"))?;
    let buffer = raster(width, height, layers)?;
    write_document(width, viewport_height, pages, &buffer)
}

fn page_count(viewport_height: u32, layers: &[Layer]) -> Result<u32> {
    let bottom = painted_bottom(layers)?;
    let mut pages = 1_u32;
    let mut covered = f64::from(viewport_height);
    while bottom > covered {
        pages = pages.checked_add(1).ok_or(Error::Limit("pdf pages"))?;
        if pages > 256 {
            return Err(Error::Limit("pdf pages"));
        }
        covered += f64::from(viewport_height);
    }
    Ok(pages)
}

fn painted_bottom(layers: &[Layer]) -> Result<f64> {
    let mut bottom = 0.0_f64;
    for layer in layers {
        if layer.hidden {
            continue;
        }
        let mut edge = layer.y + layer.height;
        if let Some(shadow) = layer.shadow {
            let shadow_bottom = layer.y + shadow.y + layer.height + shadow.spread;
            if shadow_bottom > edge {
                edge = shadow_bottom;
            }
        }
        if !edge.is_finite() {
            return Err(Error::Dom("non-finite paint box".into()));
        }
        if edge > bottom {
            bottom = edge;
        }
    }
    Ok(bottom)
}

fn write_document(width: u32, page_height: u32, pages: u32, pixels: &[[u8; 4]]) -> Result<Vec<u8>> {
    let mut file = Vec::new();
    file.extend(b"%PDF-1.4\n");
    let mut offsets = vec![0_u64];
    let kids = kids(pages)?;
    push_object(
        &mut file,
        &mut offsets,
        1,
        "<< /Type /Catalog /Pages 2 0 R >>",
    )?;
    push_object(
        &mut file,
        &mut offsets,
        2,
        &format!("<< /Type /Pages /Kids {kids} /Count {pages} >>"),
    )?;
    for page in 0..pages {
        let page_id = object_id(page, 0)?;
        let content_id = object_id(page, 1)?;
        let image_id = object_id(page, 2)?;
        push_object(
            &mut file,
            &mut offsets,
            page_id,
            &format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {page_height}] /Contents {content_id} 0 R /Resources << /XObject << /Im0 {image_id} 0 R >> >> >>"
            ),
        )?;
        let content = format!("q\n{width} 0 0 -{page_height} 0 {page_height} cm\n/Im0 Do\nQ");
        push_stream(&mut file, &mut offsets, content_id, content.as_bytes())?;
        let image = image_stream(width, page_height, page, pixels)?;
        push_image(
            &mut file,
            &mut offsets,
            image_id,
            width,
            page_height,
            &image,
        )?;
    }
    write_xref(&mut file, &offsets)?;
    Ok(file)
}

fn kids(pages: u32) -> Result<String> {
    let mut kids = String::from("[");
    for page in 0..pages {
        let id = object_id(page, 0)?;
        write!(kids, "{id} 0 R ").map_err(|_error| Error::Limit("pdf bytes"))?;
    }
    kids.push(']');
    Ok(kids)
}

fn object_id(page: u32, slot: u32) -> Result<u32> {
    page.checked_mul(3)
        .and_then(|offset| offset.checked_add(slot))
        .and_then(|offset| offset.checked_add(3))
        .ok_or(Error::Limit("pdf pages"))
}

fn push_object(file: &mut Vec<u8>, offsets: &mut Vec<u64>, id: u32, body: &str) -> Result<()> {
    offsets.push(file_offset(file)?);
    file.extend(format!("{id} 0 obj\n{body}\nendobj\n").into_bytes());
    Ok(())
}

fn push_stream(file: &mut Vec<u8>, offsets: &mut Vec<u64>, id: u32, data: &[u8]) -> Result<()> {
    offsets.push(file_offset(file)?);
    file.extend(format!("{id} 0 obj\n<< /Length {} >>\nstream\n", data.len()).into_bytes());
    file.extend(data);
    file.extend(b"\nendstream\nendobj\n");
    Ok(())
}

fn push_image(
    file: &mut Vec<u8>,
    offsets: &mut Vec<u64>,
    id: u32,
    width: u32,
    height: u32,
    data: &[u8],
) -> Result<()> {
    offsets.push(file_offset(file)?);
    file.extend(
        format!(
            "{id} 0 obj\n<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length {} >>\nstream\n",
            data.len()
        )
        .into_bytes(),
    );
    file.extend(data);
    file.extend(b"\nendstream\nendobj\n");
    Ok(())
}

fn image_stream(width: u32, page_height: u32, page: u32, pixels: &[[u8; 4]]) -> Result<Vec<u8>> {
    let origin = page
        .checked_mul(page_height)
        .ok_or(Error::Limit("screenshot pixels"))?;
    let mut stream = Vec::new();
    for y in 0..page_height {
        let row = origin
            .checked_add(y)
            .ok_or(Error::Limit("screenshot pixels"))?;
        for x in 0..width {
            let index = super::pixel_index(x, row, width)?;
            let pixel = pixels.get(index).ok_or(Error::Limit("screenshot pixels"))?;
            stream.extend(format!("{:02X}{:02X}{:02X}", pixel[0], pixel[1], pixel[2]).into_bytes());
        }
        stream.push(b'\n');
    }
    stream.push(b'>');
    Ok(stream)
}

fn write_xref(file: &mut Vec<u8>, offsets: &[u64]) -> Result<()> {
    let start = file_offset(file)?;
    let size = offsets.len();
    file.extend(format!("xref\n0 {size}\n").into_bytes());
    file.extend(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        let text = format!("{offset:010}");
        if text.len() != 10 {
            return Err(Error::Limit("pdf bytes"));
        }
        file.extend(text.into_bytes());
        file.extend(b" 00000 n \n");
    }
    let start_text = format!("{start}");
    file.extend(
        format!("trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{start_text}\n%%EOF\n")
            .into_bytes(),
    );
    Ok(())
}

fn file_offset(file: &[u8]) -> Result<u64> {
    u64::try_from(file.len()).map_err(|_error| Error::Limit("pdf bytes"))
}

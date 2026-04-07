use serde::Deserialize;
use image::{Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use ab_glyph::{FontRef, PxScale};

#[derive(Deserialize)]
pub struct CellData {
    pub color_code: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Deserialize)]
pub struct ExportRequest {
    pub width: u32,
    pub height: u32,
    pub cell_size: u32,
    pub cells: Vec<Vec<Option<CellData>>>,
    pub output_path: String,
    pub format: String, // "png" or "jpeg"
}

fn luminance(r: u8, g: u8, b: u8) -> f64 {
    0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64
}

#[tauri::command]
pub fn export_image(request: ExportRequest) -> Result<String, String> {
    let img_width = request.width * request.cell_size;
    let img_height = request.height * request.cell_size;
    let mut img = RgbaImage::new(img_width, img_height);

    // Fill with white background
    for pixel in img.pixels_mut() {
        *pixel = Rgba([255, 255, 255, 255]);
    }

    // Use embedded font
    let font_data = include_bytes!("../../fonts/NotoSansMono-Regular.ttf");
    let font = FontRef::try_from_slice(font_data)
        .map_err(|e| format!("Failed to load font: {}", e))?;

    let scale = PxScale::from(request.cell_size as f32 * 0.3);

    for (row_idx, row) in request.cells.iter().enumerate() {
        for (col_idx, cell) in row.iter().enumerate() {
            let x0 = col_idx as u32 * request.cell_size;
            let y0 = row_idx as u32 * request.cell_size;

            if let Some(cell_data) = cell {
                // Fill cell with color
                for dy in 0..request.cell_size {
                    for dx in 0..request.cell_size {
                        let px = x0 + dx;
                        let py = y0 + dy;
                        if px < img_width && py < img_height {
                            img.put_pixel(px, py, Rgba([cell_data.r, cell_data.g, cell_data.b, 255]));
                        }
                    }
                }

                // Draw cell border (1px gray)
                for dx in 0..request.cell_size {
                    let px = x0 + dx;
                    if px < img_width {
                        if y0 < img_height {
                            img.put_pixel(px, y0, Rgba([200, 200, 200, 255]));
                        }
                        let by = y0 + request.cell_size - 1;
                        if by < img_height {
                            img.put_pixel(px, by, Rgba([200, 200, 200, 255]));
                        }
                    }
                }
                for dy in 0..request.cell_size {
                    let py = y0 + dy;
                    if py < img_height {
                        if x0 < img_width {
                            img.put_pixel(x0, py, Rgba([200, 200, 200, 255]));
                        }
                        let bx = x0 + request.cell_size - 1;
                        if bx < img_width {
                            img.put_pixel(bx, py, Rgba([200, 200, 200, 255]));
                        }
                    }
                }

                // Draw color code text centered
                let text_color = if luminance(cell_data.r, cell_data.g, cell_data.b) > 128.0 {
                    Rgba([0, 0, 0, 255])
                } else {
                    Rgba([255, 255, 255, 255])
                };

                let text_x = x0 as i32 + (request.cell_size as i32 / 6);
                let text_y = y0 as i32 + (request.cell_size as i32 / 3);

                draw_text_mut(&mut img, text_color, text_x, text_y, scale, &font, &cell_data.color_code);
            }
        }
    }

    match request.format.as_str() {
        "jpeg" | "jpg" => {
            img.save_with_format(&request.output_path, image::ImageFormat::Jpeg)
                .map_err(|e| format!("Failed to save JPEG: {}", e))?;
        }
        _ => {
            img.save_with_format(&request.output_path, image::ImageFormat::Png)
                .map_err(|e| format!("Failed to save PNG: {}", e))?;
        }
    }

    Ok(request.output_path)
}

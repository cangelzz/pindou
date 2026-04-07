use serde::{Deserialize, Serialize};
use image::GenericImageView;

#[derive(Serialize, Deserialize)]
pub struct PixelData {
    pub width: u32,
    pub height: u32,
    /// Flat array of [r, g, b, r, g, b, ...] for each pixel row by row
    pub pixels: Vec<u8>,
}

#[tauri::command]
pub fn import_image(path: String, target_width: u32, target_height: u32) -> Result<PixelData, String> {
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;
    let resized = img.resize_exact(target_width, target_height, image::imageops::FilterType::Lanczos3);

    let mut pixels = Vec::with_capacity((target_width * target_height * 3) as usize);
    for y in 0..target_height {
        for x in 0..target_width {
            let pixel = resized.get_pixel(x, y);
            pixels.push(pixel[0]); // R
            pixels.push(pixel[1]); // G
            pixels.push(pixel[2]); // B
        }
    }

    Ok(PixelData {
        width: target_width,
        height: target_height,
        pixels,
    })
}

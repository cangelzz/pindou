/// CIELAB color matching utilities (reserved for future Rust-side matching)
pub fn rgb_to_lab(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    // Convert to linear RGB
    let r_lin = linearize(r as f64 / 255.0);
    let g_lin = linearize(g as f64 / 255.0);
    let b_lin = linearize(b as f64 / 255.0);

    // RGB to XYZ (D65 illuminant)
    let x = 0.4124564 * r_lin + 0.3575761 * g_lin + 0.1804375 * b_lin;
    let y = 0.2126729 * r_lin + 0.7151522 * g_lin + 0.0721750 * b_lin;
    let z = 0.0193339 * r_lin + 0.1191920 * g_lin + 0.9503041 * b_lin;

    // XYZ to Lab
    let xn = 0.95047;
    let yn = 1.0;
    let zn = 1.08883;

    let fx = lab_f(x / xn);
    let fy = lab_f(y / yn);
    let fz = lab_f(z / zn);

    let l = 116.0 * fy - 16.0;
    let a = 500.0 * (fx - fy);
    let b_val = 200.0 * (fy - fz);

    (l, a, b_val)
}

fn linearize(c: f64) -> f64 {
    if c > 0.04045 {
        ((c + 0.055) / 1.055).powf(2.4)
    } else {
        c / 12.92
    }
}

fn lab_f(t: f64) -> f64 {
    let delta: f64 = 6.0 / 29.0;
    if t > delta.powi(3) {
        t.cbrt()
    } else {
        t / (3.0 * delta * delta) + 4.0 / 29.0
    }
}

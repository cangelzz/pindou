"""Compose a deterministic 3:4 Journey to the West character poster."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

if __package__:
    from .pindou_refine import load_palette, render_plain
else:
    from pindou_refine import load_palette, render_plain


CHARACTER_ORDER = ("monkey", "monk", "pig", "wujing")
DEFAULT_SIZE = (1800, 2400)
BACKGROUND_X_POSITION = 0.20


def cover_crop(
    image: Image.Image,
    size: tuple[int, int],
    x_position: float,
) -> Image.Image:
    """Resize to cover *size*, then crop with configurable horizontal focus."""
    target_width, target_height = size
    scale = max(target_width / image.width, target_height / image.height)
    resized_width = max(target_width, round(image.width * scale))
    resized_height = max(target_height, round(image.height * scale))
    resized = image.resize(
        (resized_width, resized_height),
        Image.Resampling.LANCZOS,
    )
    left = round((resized_width - target_width) * x_position)
    top = round((resized_height - target_height) / 2)
    return resized.crop((left, top, left + target_width, top + target_height))


def common_scale_sizes(
    source_sizes: list[tuple[int, int]],
    canvas_width: int,
) -> tuple[list[tuple[int, int]], float]:
    """Fit all sources across the canvas using one shared scale multiplier."""
    available_width = canvas_width * 0.94
    gap = available_width * 0.01
    scale = (available_width - gap * (len(source_sizes) - 1)) / sum(
        width for width, _height in source_sizes
    )
    sizes = [
        (max(1, round(width * scale)), max(1, round(height * scale)))
        for width, height in source_sizes
    ]
    return sizes, scale


def clean_logo(path: Path) -> Image.Image:
    """Extract dark lettering and the red seal from a baked checkerboard image."""
    with Image.open(path) as source:
        rgb = np.asarray(source.convert("RGB"), dtype=np.int16)

    red = rgb[..., 0]
    green = rgb[..., 1]
    blue = rgb[..., 2]
    luminance = (30 * red + 59 * green + 11 * blue) // 100
    dark_alpha = np.clip((185 - luminance) * 3, 0, 255)
    saturation = rgb.max(axis=2) - rgb.min(axis=2)
    red_alpha = np.where((saturation > 55) & (red > 100), 255, 0)
    alpha = np.maximum(dark_alpha, red_alpha).astype(np.uint8)

    rgba = np.dstack((rgb.astype(np.uint8), alpha))
    cleaned = Image.fromarray(rgba, mode="RGBA")
    bounds = cleaned.getchannel("A").getbbox()
    return cleaned.crop(bounds) if bounds is not None else cleaned


def render_character(root: Path, name: str) -> Image.Image:
    """Render a project's top-level canvasData without strict layer validation."""
    project_path = root / "samples" / f"xiyou-{name}.pindou"
    project = json.loads(project_path.read_text(encoding="utf-8"))
    palette = load_palette(root / "src" / "data" / "mard221.ts")
    rendered = render_plain(project["canvasData"], palette, cell_size=16)
    bounds = rendered.getchannel("A").getbbox()
    return rendered.crop(bounds) if bounds is not None else rendered


def paste_with_shadow(
    canvas: Image.Image,
    image: Image.Image,
    position: tuple[int, int],
) -> None:
    """Paste a character with a consistent, soft alpha-derived shadow."""
    blur_radius = max(4, round(image.width * 0.018))
    offset = max(3, round(image.height * 0.012))
    shadow_alpha = image.getchannel("A").filter(
        ImageFilter.GaussianBlur(radius=blur_radius)
    )
    shadow_alpha = shadow_alpha.point(lambda value: round(value * 0.38))
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow.putalpha(shadow_alpha)
    x, y = position
    canvas.paste(shadow, (x + offset, y + offset), shadow)
    canvas.paste(image, position, image)


def compose_poster(
    root: Path,
    output: Path,
    size: tuple[int, int] = DEFAULT_SIZE,
) -> None:
    """Compose and save the deterministic poster as an RGB PNG."""
    root = Path(root)
    output = Path(output)
    width, height = size

    with Image.open(root / "temp" / "xiyou_background.png") as source:
        canvas = cover_crop(
            source.convert("RGB"),
            size,
            x_position=BACKGROUND_X_POSITION,
        )

    logo = clean_logo(root / "temp" / "xiyou_logo.png")
    logo_scale = min((width * 0.74) / logo.width, (height * 0.16) / logo.height)
    logo_size = (
        max(1, round(logo.width * logo_scale)),
        max(1, round(logo.height * logo_scale)),
    )
    logo = logo.resize(logo_size, Image.Resampling.LANCZOS)
    logo_position = ((width - logo.width) // 2, round(height * 0.05))
    canvas.paste(logo, logo_position, logo)

    characters = [render_character(root, name) for name in CHARACTER_ORDER]
    character_sizes, _scale = common_scale_sizes(
        [character.size for character in characters],
        canvas_width=width,
    )
    characters = [
        character.resize(character_size, Image.Resampling.NEAREST)
        for character, character_size in zip(
            characters, character_sizes, strict=True
        )
    ]

    available_width = width * 0.94
    gap = round(available_width * 0.01)
    group_width = sum(character.width for character in characters) + gap * (
        len(characters) - 1
    )
    group_height = max(character.height for character in characters)
    x = round((width - group_width) / 2)
    group_top = round(height * 0.50 - group_height / 2)
    baseline = group_top + group_height
    for character in characters:
        paste_with_shadow(canvas, character, (x, baseline - character.height))
        x += character.width + gap

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, format="PNG")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("temp/xiyou-poster-3x4.png"),
        help="output PNG path",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = args.out if args.out.is_absolute() else root / args.out
    compose_poster(root, output)
    print(f"Saved {output} (1800x2400)")


if __name__ == "__main__":
    main()

# Xiyou Poster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible 1800×2400 PNG poster from the approved西游记 background, logo, and four character designs.

**Architecture:** Add one focused Pillow composition script with pure helpers for cover-cropping, logo extraction, character rendering, common-scale layout, and final compositing. Reuse the repository's authoritative MARD palette loader and transparent character renderer, then generate the final project-bound artifact under `temp/` without changing the source character files.

**Tech Stack:** Python 3, Pillow, NumPy, `scripts/pindou_refine.py`, pytest

---

## File Structure

- Create `scripts/make_xiyou_poster.py`: deterministic poster composition and CLI entry point.
- Create `tests/scripts/test_make_xiyou_poster.py`: unit tests for crop position, common scale, ordering, and final dimensions.
- Generate `temp/xiyou-poster-3x4.png`: final 3:4 PNG deliverable; this generated file remains outside the code commit.

### Task 1: Lock the crop and layout geometry with tests

**Files:**
- Create: `tests/scripts/test_make_xiyou_poster.py`

- [ ] **Step 1: Write failing tests for L20 crop, common scale, order, and canvas size**

```python
from pathlib import Path

from PIL import Image

from scripts.make_xiyou_poster import (
    CHARACTER_ORDER,
    common_scale_sizes,
    compose_poster,
    cover_crop,
)


ROOT = Path(__file__).resolve().parents[2]


def test_cover_crop_uses_l20_alignment():
    source = Image.new("RGB", (1440, 720))
    for x in range(source.width):
        for y in range(source.height):
            source.putpixel((x, y), (x // 6, 0, 0))

    cropped = cover_crop(source, (300, 400), x_position=0.20)

    assert cropped.size == (300, 400)
    assert 29 <= cropped.getpixel((0, 200))[0] <= 31


def test_common_scale_sizes_use_one_multiplier():
    sources = [(848, 864), (976, 1248), (720, 960), (992, 880)]
    sizes, scale = common_scale_sizes(sources, canvas_width=1800)

    for source, resized in zip(sources, sizes):
        assert abs(resized[0] / source[0] - scale) < 0.002
        assert abs(resized[1] / source[1] - scale) < 0.002


def test_character_order_is_fixed():
    assert CHARACTER_ORDER == ("monkey", "monk", "pig", "wujing")


def test_compose_poster_outputs_three_by_four(tmp_path):
    output = tmp_path / "poster.png"
    compose_poster(ROOT, output, size=(900, 1200))

    with Image.open(output) as poster:
        assert poster.size == (900, 1200)
        assert poster.mode == "RGB"
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `python -m pytest tests/scripts/test_make_xiyou_poster.py -v`

Expected: collection fails with `ModuleNotFoundError: No module named 'scripts.make_xiyou_poster'`.

- [ ] **Step 3: Commit the test**

```bash
git add tests/scripts/test_make_xiyou_poster.py
git commit -m "test: specify xiyou poster composition"
```

### Task 2: Implement deterministic poster composition

**Files:**
- Create: `scripts/make_xiyou_poster.py`
- Test: `tests/scripts/test_make_xiyou_poster.py`

- [ ] **Step 1: Implement the composition script**

Create `scripts/make_xiyou_poster.py` with these public constants and functions:

```python
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from scripts import pindou_refine


CHARACTER_ORDER = ("monkey", "monk", "pig", "wujing")
DEFAULT_SIZE = (1800, 2400)
BACKGROUND_X_POSITION = 0.20


def cover_crop(image: Image.Image, size: tuple[int, int], x_position: float) -> Image.Image:
    width, height = size
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    overflow_x = max(0, resized.width - width)
    left = round(overflow_x * x_position)
    top = max(0, (resized.height - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def common_scale_sizes(
    source_sizes: list[tuple[int, int]], canvas_width: int
) -> tuple[list[tuple[int, int]], float]:
    available = round(canvas_width * 0.94)
    gap = round(available * 0.01)
    scale = (available - gap * (len(source_sizes) - 1)) / sum(
        width for width, _ in source_sizes
    )
    sizes = [(round(width * scale), round(height * scale)) for width, height in source_sizes]
    return sizes, scale


def clean_logo(path: Path) -> Image.Image:
    logo = Image.open(path).convert("RGBA")
    pixels = np.asarray(logo).copy()
    rgb = pixels[:, :, :3].astype(np.int16)
    luminance = (rgb[:, :, 0] * 30 + rgb[:, :, 1] * 59 + rgb[:, :, 2] * 11) // 100
    saturation = rgb.max(axis=2) - rgb.min(axis=2)
    dark_alpha = np.clip((185 - luminance) * 3, 0, 255)
    red_alpha = np.where((saturation > 55) & (rgb[:, :, 0] > 100), 255, 0)
    pixels[:, :, 3] = np.maximum(dark_alpha, red_alpha).astype(np.uint8)
    cleaned = Image.fromarray(pixels, "RGBA")
    return cleaned.crop(cleaned.getbbox())


def render_character(root: Path, name: str) -> Image.Image:
    project_path = root / "samples" / f"xiyou-{name}.pindou"
    project = json.loads(project_path.read_text(encoding="utf-8"))
    palette = pindou_refine.load_palette(root / "src/data/mard221.ts")
    rendered = pindou_refine.render_plain(project["canvasData"], palette, cell_size=16)
    return rendered.crop(rendered.getbbox())


def paste_with_shadow(canvas: Image.Image, image: Image.Image, position: tuple[int, int]) -> None:
    x, y = position
    alpha = image.getchannel("A")
    shadow_alpha = alpha.filter(ImageFilter.GaussianBlur(max(3, canvas.width // 300)))
    shadow = Image.new("RGBA", image.size, (20, 48, 42, 0))
    shadow.putalpha(shadow_alpha.point(lambda value: round(value * 0.30)))
    canvas.alpha_composite(shadow, (x, y + max(4, canvas.height // 200)))
    canvas.alpha_composite(image, (x, y))


def compose_poster(root: Path, output: Path, size: tuple[int, int] = DEFAULT_SIZE) -> None:
    width, height = size
    background = Image.open(root / "temp/xiyou_background.png").convert("RGB")
    poster = cover_crop(background, size, BACKGROUND_X_POSITION).convert("RGBA")

    logo = clean_logo(root / "temp/xiyou_logo.png")
    logo_box = (round(width * 0.74), round(height * 0.16))
    logo.thumbnail(logo_box, Image.Resampling.LANCZOS)
    poster.alpha_composite(logo, ((width - logo.width) // 2, round(height * 0.05)))

    characters = [render_character(root, name) for name in CHARACTER_ORDER]
    sizes, _ = common_scale_sizes([image.size for image in characters], width)
    characters = [
        image.resize(target, Image.Resampling.NEAREST)
        for image, target in zip(characters, sizes)
    ]
    available = round(width * 0.94)
    gap = round(available * 0.01)
    group_height = max(image.height for image in characters)
    x = round(width * 0.03)
    group_top = round(height * 0.50 - group_height / 2)
    for image in characters:
        y = group_top + group_height - image.height
        paste_with_shadow(poster, image, (x, y))
        x += image.width + gap

    output.parent.mkdir(parents=True, exist_ok=True)
    poster.convert("RGB").save(output, format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("temp/xiyou-poster-3x4.png"))
    args = parser.parse_args()
    compose_poster(Path(__file__).resolve().parents[1], args.out)
    print(f"saved {args.out} {DEFAULT_SIZE[0]}x{DEFAULT_SIZE[1]}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the focused tests and verify GREEN**

Run: `python -m pytest tests/scripts/test_make_xiyou_poster.py -v`

Expected: `4 passed`.

- [ ] **Step 3: Commit the implementation**

```bash
git add scripts/make_xiyou_poster.py
git commit -m "feat: compose xiyou character poster"
```

### Task 3: Generate and visually verify the deliverable

**Files:**
- Generate: `temp/xiyou-poster-3x4.png`

- [ ] **Step 1: Generate the final poster from the latest workspace resources**

Run: `python scripts/make_xiyou_poster.py --out temp/xiyou-poster-3x4.png`

Expected: `saved temp\xiyou-poster-3x4.png 1800x2400` or the equivalent slash-separated path.

- [ ] **Step 2: Verify dimensions and required inputs**

Run:

```powershell
@'
from pathlib import Path
from PIL import Image
p = Path("temp/xiyou-poster-3x4.png")
with Image.open(p) as im:
    assert im.size == (1800, 2400)
    assert im.mode == "RGB"
print(p, im.size, im.mode)
'@ | python -
```

Expected: `temp\xiyou-poster-3x4.png (1800, 2400) RGB`.

- [ ] **Step 3: Inspect the final PNG visually**

Open `temp/xiyou-poster-3x4.png` and confirm all of the following:

- L20 background crop shows more left-side mountains and less yellow road.
- The cleaned logo is centered at the top without checkerboard residue.
- Full characters appear left-to-right as monkey, monk, pig, wujing.
- No title bar, color legend, cell codes, white card, or clipped weapon is visible.
- All four characters share one pixel-per-bead scale and the group bounding box is vertically centered.
- The latest wujing design is present.

- [ ] **Step 4: Run the complete focused verification once more**

Run: `python -m pytest tests/scripts/test_make_xiyou_poster.py -v`

Expected: `4 passed` with no warnings or errors.

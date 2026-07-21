from pathlib import Path

import pytest
from PIL import Image

import scripts.make_xiyou_poster as poster_module
from scripts.make_xiyou_poster import (
    CHARACTER_ORDER,
    common_scale_sizes,
    compose_poster,
    cover_crop,
)


def test_cover_crop_uses_l20_alignment() -> None:
    gradient = Image.new("L", (1440, 1))
    gradient.putdata([x * 255 // 1440 for x in range(1440)])
    source = gradient.resize((1440, 720)).convert("RGB")

    cropped = cover_crop(source, (300, 400), x_position=0.20)

    assert cropped.size == (300, 400)
    assert 29 <= cropped.getpixel((0, 200))[0] <= 31


def test_common_scale_sizes_use_one_multiplier() -> None:
    source_sizes = [(848, 864), (976, 1248), (720, 960), (992, 880)]

    output_sizes, scale = common_scale_sizes(source_sizes, canvas_width=1800)

    assert scale > 0
    for (source_width, source_height), (output_width, output_height) in zip(
        source_sizes, output_sizes, strict=True
    ):
        assert output_width > 0
        assert output_height > 0
        assert abs(output_width / source_width - scale) < 0.002
        assert abs(output_height / source_height - scale) < 0.002


def test_character_order_is_fixed() -> None:
    assert CHARACTER_ORDER == ("monkey", "monk", "pig", "wujing")


def test_compose_poster_outputs_three_by_four(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "root"
    temp = root / "temp"
    temp.mkdir(parents=True)
    Image.new("RGB", (90, 120), (24, 32, 48)).save(
        temp / "xiyou_background.png"
    )
    output = tmp_path / "poster.png"
    crop_positions: list[float] = []
    rendered_names: list[str] = []

    def fake_clean_logo(_source: object) -> Image.Image:
        return Image.new("RGBA", (24, 8), (255, 220, 80, 255))

    def fake_render_character(_root: Path, name: str) -> Image.Image:
        rendered_names.append(name)
        return Image.new("RGBA", (12, 16), (200, 120, 80, 255))

    def spy_cover_crop(
        source: Image.Image,
        size: tuple[int, int],
        x_position: float = 0.5,
    ) -> Image.Image:
        crop_positions.append(x_position)
        return cover_crop(source, size, x_position=x_position)

    monkeypatch.setattr(poster_module, "clean_logo", fake_clean_logo)
    monkeypatch.setattr(poster_module, "render_character", fake_render_character)
    monkeypatch.setattr(poster_module, "cover_crop", spy_cover_crop)

    compose_poster(root, output, size=(900, 1200))

    with Image.open(output) as poster:
        assert poster.format == "PNG"
        assert poster.size == (900, 1200)
        assert poster.mode == "RGB"
    assert crop_positions == [0.20]
    assert rendered_names == list(CHARACTER_ORDER)

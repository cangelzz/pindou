from pathlib import Path

from PIL import Image

from scripts.make_xiyou_poster import (
    CHARACTER_ORDER,
    common_scale_sizes,
    compose_poster,
    cover_crop,
)


ROOT = Path(__file__).resolve().parents[2]


def test_cover_crop_uses_l20_alignment() -> None:
    gradient = Image.new("L", (1440, 1))
    gradient.putdata([x * 255 // 1440 for x in range(1440)])
    source = gradient.resize((1440, 720)).convert("RGB")

    cropped = cover_crop(source, (300, 400), x_position=0.20)

    assert cropped.size == (300, 400)
    assert 29 <= cropped.getpixel((0, 200))[0] <= 31


def test_common_scale_sizes_use_one_multiplier() -> None:
    source_sizes = [(848, 864), (976, 1248), (720, 960), (992, 880)]

    scale, output_sizes = common_scale_sizes(source_sizes, canvas_width=1800)

    for (source_width, source_height), (output_width, output_height) in zip(
        source_sizes, output_sizes, strict=True
    ):
        assert abs(output_width / source_width - scale) < 0.002
        assert abs(output_height / source_height - scale) < 0.002


def test_character_order_is_fixed() -> None:
    assert CHARACTER_ORDER == ("monkey", "monk", "pig", "wujing")


def test_compose_poster_outputs_three_by_four(tmp_path: Path) -> None:
    output = tmp_path / "poster.png"

    compose_poster(ROOT, output, size=(900, 1200))

    with Image.open(output) as poster:
        assert poster.format == "PNG"
        assert poster.size == (900, 1200)
        assert poster.mode == "RGB"

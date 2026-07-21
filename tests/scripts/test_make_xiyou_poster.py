import json
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


def test_paste_with_shadow_extends_beyond_a_tightly_cropped_character() -> None:
    canvas = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    character = Image.new("RGBA", (6, 6), (200, 120, 80, 255))
    position = (9, 9)

    poster_module.paste_with_shadow(canvas, character, position)

    alpha_left_of_character = canvas.getchannel("A").crop(
        (0, 0, position[0], canvas.height)
    )
    _minimum_alpha, maximum_alpha = alpha_left_of_character.getextrema()
    assert 0 < maximum_alpha < 255


def test_clean_logo_rejects_an_image_without_foreground(tmp_path: Path) -> None:
    logo_path = tmp_path / "blank-logo.png"
    Image.new("RGB", (8, 8), (255, 255, 255)).save(logo_path)

    with pytest.raises(ValueError) as error:
        poster_module.clean_logo(logo_path)

    assert str(logo_path) in str(error.value)


def test_render_character_rejects_an_empty_canvas(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    name = "blank"
    samples = tmp_path / "samples"
    samples.mkdir()
    (samples / f"xiyou-{name}.pindou").write_text(
        json.dumps({"canvasData": [[None]]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(poster_module, "load_palette", lambda _path: object())
    monkeypatch.setattr(
        poster_module,
        "render_plain",
        lambda _grid, _palette, cell_size: Image.new(
            "RGBA", (cell_size, cell_size), (0, 0, 0, 0)
        ),
    )

    with pytest.raises(ValueError) as error:
        poster_module.render_character(tmp_path, name)

    assert name in str(error.value)


def test_render_character_loads_palette_once_per_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    samples = tmp_path / "samples"
    samples.mkdir()
    for name in ("first", "second"):
        (samples / f"xiyou-{name}.pindou").write_text(
            json.dumps({"canvasData": [[0]]}),
            encoding="utf-8",
        )
    loaded_paths: list[Path] = []

    def fake_load_palette(path: Path) -> object:
        loaded_paths.append(path)
        return object()

    monkeypatch.setattr(poster_module, "load_palette", fake_load_palette)
    monkeypatch.setattr(
        poster_module,
        "render_plain",
        lambda _grid, _palette, cell_size: Image.new(
            "RGBA", (cell_size, cell_size), (20, 30, 40, 255)
        ),
    )

    poster_module.render_character(tmp_path, "first")
    poster_module.render_character(tmp_path, "second")

    assert loaded_paths == [tmp_path / "src" / "data" / "mard221.ts"]


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

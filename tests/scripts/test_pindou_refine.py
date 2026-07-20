import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import typing
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import scripts.pindou_refine as refine
import scripts.refine_deniya as deniya
from scripts.pindou_refine import (
    load_palette,
    load_project,
    replace_grid,
    save_project,
    validate_project,
)


ROOT = Path(__file__).resolve().parents[2]


def make_project() -> dict:
    grid = [[0, None, 2], [2, 1, None]]
    return {
        "version": 3,
        "canvasSize": {"width": 3, "height": 2},
        "canvasData": copy.deepcopy(grid),
        "layers": [
            {
                "id": "layer_1",
                "name": "Beads",
                "data": copy.deepcopy(grid),
                "visible": True,
                "opacity": 1,
            }
        ],
    }


class ProjectIOTests(unittest.TestCase):
    def test_v3_round_trip_preserves_flat_cells(self) -> None:
        project = make_project()
        project["metadata"] = {"title": "恐龙拼豆"}
        with tempfile.TemporaryDirectory() as temp_dir:
            first_path = Path(temp_dir) / "nested" / "first.pindou"
            second_path = Path(temp_dir) / "nested" / "second.pindou"

            save_project(first_path, project)
            save_project(second_path, project)
            loaded = load_project(first_path)

            self.assertEqual(loaded["canvasData"], project["canvasData"])
            self.assertEqual(loaded["layers"][0]["data"], project["layers"][0]["data"])
            raw = first_path.read_bytes()
            self.assertEqual(raw, second_path.read_bytes())
            self.assertTrue(raw.endswith(b"\n"))
            self.assertNotIn(b": ", raw)
            self.assertIn("恐龙拼豆".encode("utf-8"), raw)
            self.assertNotIn(b"\\u", raw)

    def test_validate_project_rejects_canvas_layer_mismatch(self) -> None:
        project = make_project()
        project["layers"][0]["data"][1][1] = 0

        with self.assertRaisesRegex(ValueError, "canvasData/layer mismatch"):
            validate_project(project, palette_size=3)

    def test_load_palette_returns_mard_221_in_source_order(self) -> None:
        palette = load_palette(ROOT / "src/data/mard221.ts")

        self.assertEqual(len(palette), 221)
        self.assertEqual(palette[0].index, 0)
        self.assertRegex(palette[0].hex, r"^#[0-9A-Fa-f]{6}$")
        self.assertEqual(palette[0].code, "A1")
        self.assertEqual(palette[0].rgb, (250, 245, 205))
        expected_entries = {
            26: ("B1", "#DFF139", (223, 241, 57)),
            110: ("D24", "#768AE1", (118, 138, 225)),
            184: ("H2", "#FFFFFF", (255, 255, 255)),
            220: ("M15", "#747D7A", (116, 125, 122)),
        }
        for index, (code, hex_value, rgb) in expected_entries.items():
            with self.subTest(index=index):
                self.assertEqual(
                    (palette[index].index, palette[index].code, palette[index].hex, palette[index].rgb),
                    (index, code, hex_value, rgb),
                )

        expected_lab = {
            0: (96.0123901018, -4.7144731080, 19.8987220824),
            184: (100.0000038667, -0.0000166667, 0.0000066667),
            220: (51.5934592970, -3.9631790042, 0.4817455122),
        }
        for index, expected in expected_lab.items():
            with self.subTest(lab_index=index):
                for actual_component, expected_component in zip(palette[index].lab, expected):
                    self.assertAlmostEqual(actual_component, expected_component, delta=1e-8)

    def test_load_palette_only_parses_mard_colors_initializer(self) -> None:
        source = (ROOT / "src/data/mard221.ts").read_text(encoding="utf-8")
        initializer = "export const MARD_COLORS: MardColor[] = ["
        source = source.replace(
            initializer,
            initializer
            + '\n  // { code: "A0", name: "comment", hex: "#000000", rgb: [0, 0, 0] },',
            1,
        )
        source += '\nconst DECOY = { code: "A00", hex: "#FFFFFF", rgb: [255, 255, 255] };\n'

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "palette.ts"
            path.write_text(source, encoding="utf-8")

            palette = load_palette(path)

        self.assertEqual(len(palette), 221)
        self.assertEqual(palette[0].code, "A1")
        self.assertEqual(palette[-1].code, "M15")

    def test_load_palette_ignores_commented_declarations(self) -> None:
        source = (ROOT / "src/data/mard221.ts").read_text(encoding="utf-8")
        source = source.replace('name: "A1"', 'name: "https://example.test/A1//bead"', 1)
        variants = {
            "commented MARD_COLORS": """/*
export const MARD_COLORS: MardColor[] = [
  { code: "A0", name: "fake", hex: "#000000", rgb: [0, 0, 0] },
];
*/
""",
            "commented mard221 group": '// { id: "mard221", series: ["A"] },\n',
        }

        for name, prefix in variants.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp_dir:
                path = Path(temp_dir) / "palette.ts"
                path.write_text(prefix + source, encoding="utf-8")

                palette = load_palette(path)

                self.assertEqual(len(palette), 221)
                self.assertEqual(palette[0].code, "A1")
                self.assertEqual(palette[-1].code, "M15")

    def test_validate_project_rejects_non_v3_and_invalid_flat_cells(self) -> None:
        cases = {
            "version": (lambda p: p.__setitem__("version", 2), "version 3"),
            "non-integer version": (lambda p: p.__setitem__("version", 3.0), "version 3"),
            "object-form v2 cell": (
                lambda p: p["canvasData"][0].__setitem__(0, {"color": 0}),
                "object-form v2 cell",
            ),
            "bool index": (lambda p: p["canvasData"][0].__setitem__(0, True), "color index"),
            "negative index": (lambda p: p["canvasData"][0].__setitem__(0, -1), "color index"),
            "large index": (lambda p: p["canvasData"][0].__setitem__(0, 3), "color index"),
        }
        for name, (mutate, message) in cases.items():
            with self.subTest(name=name):
                project = make_project()
                mutate(project)
                with self.assertRaisesRegex(ValueError, message):
                    validate_project(project, palette_size=3)

    def test_validate_project_checks_dimensions_and_single_visible_layer(self) -> None:
        cases = {
            "height": lambda p: p["canvasSize"].__setitem__("height", 3),
            "row width": lambda p: p["canvasData"][0].pop(),
            "no layers": lambda p: p.__setitem__("layers", []),
            "multiple layers": lambda p: p["layers"].append(copy.deepcopy(p["layers"][0])),
            "hidden layer": lambda p: p["layers"][0].__setitem__("visible", False),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                project = make_project()
                mutate(project)
                with self.assertRaises(ValueError):
                    validate_project(project, palette_size=3)

    def test_replace_grid_deep_copies_project_and_grid(self) -> None:
        project = make_project()
        grid = [[2, 2, None], [None, 0, 1]]

        replaced = replace_grid(project, grid)

        self.assertIsNot(replaced, project)
        self.assertEqual(replaced["canvasData"], grid)
        self.assertEqual(replaced["layers"][0]["data"], grid)
        grid[0][0] = 1
        replaced["canvasData"][0][1] = 0
        self.assertEqual(project, make_project())
        self.assertEqual(replaced["layers"][0]["data"], [[2, 2, None], [None, 0, 1]])

    def test_public_apis_ignore_untrusted_palette_size(self) -> None:
        project = make_project()
        project["paletteSize"] = 999
        project["canvasData"][0][0] = 221
        project["layers"][0]["data"][0][0] = 221

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "project.pindou"
            path.write_text(json.dumps(project), encoding="utf-8")

            operations = {
                "load_project": lambda: load_project(path),
                "save_project": lambda: save_project(path, project),
                "replace_grid": lambda: replace_grid(project, project["canvasData"]),
            }
            for name, operation in operations.items():
                with self.subTest(name=name):
                    with self.assertRaisesRegex(ValueError, "outside palette bounds"):
                        operation()

    def test_project_types_cover_persisted_fields(self) -> None:
        self.assertEqual(
            refine.GridConfig.__optional_keys__,
            frozenset(
                {
                    "groupSize",
                    "edgePadding",
                    "startX",
                    "startY",
                    "visible",
                    "lineColor",
                    "lineWidth",
                    "groupLineColor",
                    "groupLineWidth",
                }
            ),
        )
        self.assertEqual(
            refine.ProjectInfo.__optional_keys__,
            frozenset({"title", "author", "description", "link"}),
        )
        self.assertEqual(
            refine.Project.__required_keys__,
            frozenset({"version", "canvasSize", "canvasData", "layers"}),
        )
        self.assertEqual(
            refine.Project.__optional_keys__,
            frozenset(
                {
                    "paletteSize",
                    "metadata",
                    "gridConfig",
                    "projectInfo",
                    "createdAt",
                    "updatedAt",
                }
            ),
        )
        project_hints = typing.get_type_hints(refine.Project, include_extras=True)
        self.assertEqual(typing.get_args(project_hints["gridConfig"]), (refine.GridConfig,))
        self.assertEqual(typing.get_args(project_hints["projectInfo"]), (refine.ProjectInfo,))


class MaskAndReferenceTests(unittest.TestCase):
    def test_build_mask_uses_col_row_cell_centers_and_includes_edges(self) -> None:
        polygon = [(1, 1), (4, 1), (4, 3), (1, 3)]

        mask = refine.build_mask(6, 5, [polygon])

        self.assertTrue(mask[2][2])
        self.assertFalse(mask[0][0])
        self.assertFalse(mask[4][5])
        self.assertTrue(refine.point_in_polygon(1, 2, polygon))
        self.assertFalse(refine.point_in_polygon(0.999, 2, polygon))

    def test_sample_reference_grid_discards_borders_and_uses_channel_medians(self) -> None:
        image = Image.new("RGB", (20, 10), (0, 0, 0))
        pixels = image.load()
        center_colors = [(220, 30, 40), (20, 80, 210)]
        for cell, color in enumerate(center_colors):
            for row in range(2, 8):
                for column in range(cell * 10 + 2, cell * 10 + 8):
                    pixels[column, row] = color

        sampled = refine.sample_reference_grid(image, width=2, height=1, inset=0.2)

        self.assertEqual(sampled, [center_colors])

    def test_sample_reference_grid_falls_back_to_nearest_center_for_fractional_cells(
        self,
    ) -> None:
        image = Image.new("RGB", (11, 11))
        pixels = image.load()
        for row in range(11):
            for column in range(11):
                pixels[column, row] = (column * 20, row * 20, (column + row) * 10)
        expected = [
            [
                image.getpixel(
                    (int((column + 0.5) * 11 / 10), int((row + 0.5) * 11 / 10))
                )
                for column in range(10)
            ]
            for row in range(10)
        ]

        sampled = refine.sample_reference_grid(image, width=10, height=10)

        self.assertEqual(sampled, expected)

    def test_sample_reference_grid_handles_source_equal_to_grid_size(self) -> None:
        image = Image.new("RGB", (4, 3))
        pixels = image.load()
        expected = []
        for row in range(3):
            expected_row = []
            for column in range(4):
                color = (column * 50, row * 80, column + row)
                pixels[column, row] = color
                expected_row.append(color)
            expected.append(expected_row)

        sampled = refine.sample_reference_grid(image, width=4, height=3)

        self.assertEqual(sampled, expected)

    def test_sample_reference_grid_fallback_preserves_nonempty_axis_median(self) -> None:
        image = Image.new("RGB", (11, 10))
        pixels = image.load()
        for row in range(10):
            for column in range(11):
                pixels[column, row] = (column * 20, 0, 0)
        for column in range(11):
            pixels[column, 5] = (column * 20, 255, 255)
        expected = [
            (int((column + 0.5) * 11 / 10) * 20, 0, 0)
            for column in range(10)
        ]

        sampled = refine.sample_reference_grid(image, width=10, height=1)

        self.assertEqual(sampled, [expected])

    def test_sample_reference_grid_rejects_zero_dimensions(self) -> None:
        image = Image.new("RGB", (1, 1))
        for width, height, message in ((0, 1, "width"), (1, 0, "height")):
            with self.subTest(width=width, height=height):
                with self.assertRaisesRegex(ValueError, message):
                    refine.sample_reference_grid(image, width, height)

        for size in ((0, 1), (1, 0)):
            with self.subTest(source_size=size):
                with self.assertRaisesRegex(ValueError, "source image dimensions must be positive"):
                    refine.sample_reference_grid(Image.new("RGB", size), 1, 1)

    def test_assert_protected_unchanged_reports_coordinates(self) -> None:
        before = [[0, 1], [2, 3]]
        mask = [[True, True], [False, False]]

        refine.assert_protected_unchanged(before, [[0, 1], [9, 8]], mask)

        with self.assertRaisesRegex(AssertionError, r"\(1,0\)"):
            refine.assert_protected_unchanged(before, [[0, 7], [2, 3]], mask)

    def test_assert_protected_unchanged_validates_rectangular_equal_shapes(self) -> None:
        cases = {
            "ragged before": ([[0, 1], [2]], [[0, 1], [2, 3]], [[True, False], [False, False]]),
            "different after": ([[0, 1]], [[0]], [[True, False]]),
            "different mask": ([[0, 1]], [[0, 1]], [[True]]),
        }
        for name, (before, after, mask) in cases.items():
            with self.subTest(name=name), self.assertRaises(ValueError):
                refine.assert_protected_unchanged(before, after, mask)

    def test_render_mask_overlay_marks_protection_and_keeps_none_clear(self) -> None:
        palette = [
            refine.PaletteColor(0, "A", "#C82832", (200, 40, 50), (0, 0, 0)),
            refine.PaletteColor(1, "B", "#1450D2", (20, 80, 210), (0, 0, 0)),
        ]
        grid = [[0, None], [1, 0]]
        mask = [[True, True], [False, False]]

        overlay = refine.render_mask_overlay(grid, palette, mask, cell_size=6)

        self.assertEqual(overlay.mode, "RGBA")
        self.assertEqual(overlay.size, (12, 12))
        self.assertEqual(overlay.getpixel((9, 3)), (0, 0, 0, 0))
        self.assertEqual(overlay.getpixel((3, 9)), (20, 80, 210, 255))
        protected_center = overlay.getpixel((3, 3))
        self.assertNotEqual(protected_center, (200, 40, 50, 255))
        self.assertEqual(protected_center[3], 255)
        self.assertNotEqual(overlay.getpixel((0, 0)), protected_center)

    def test_deniya_runner_mask_overlay_only_writes_no_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "output"
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts/refine_deniya.py"),
                    "--output-dir",
                    str(output_dir),
                    "--mask-overlay-only",
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=True,
            )

            overlay_path = output_dir / "protection-mask.png"
            self.assertEqual([path.name for path in output_dir.iterdir()], [overlay_path.name])
            self.assertIn(str(overlay_path), result.stdout)
            self.assertRegex(result.stdout, r"protected cells: [1-9]\d*")
            with Image.open(overlay_path) as overlay:
                self.assertEqual(overlay.mode, "RGBA")


class OutputTests(unittest.TestCase):
    @staticmethod
    def palette(*rgbs: tuple[int, int, int]) -> list[refine.PaletteColor]:
        return [
            refine.PaletteColor(
                index=index,
                code=f"T{index}",
                hex="#%02X%02X%02X" % rgb,
                rgb=rgb,
                lab=refine.rgb_to_lab(rgb),
            )
            for index, rgb in enumerate(rgbs)
        ]

    @staticmethod
    def write_fixture(
        directory: Path,
        input_name: str = "fixture.pindou",
        reference_name: str = "reference.png",
    ) -> tuple[Path, Path, list[list[int]]]:
        grid = [[0, 0, 0], [0, 0, 0]]
        project = {
            "version": 3,
            "canvasSize": {"width": 3, "height": 2},
            "canvasData": copy.deepcopy(grid),
            "layers": [{"data": copy.deepcopy(grid), "visible": True}],
        }
        input_path = directory / input_name
        reference_path = directory / reference_name
        save_project(input_path, project)
        Image.new("RGB", (30, 20), (250, 245, 205)).save(reference_path)
        return input_path, reference_path, grid

    def test_metrics_cover_changes_components_reference_and_nonempty_counts(self) -> None:
        palette = self.palette((0, 0, 0), (255, 255, 255))
        before = [[0, 1, None], [None, None, None], [0, None, None]]
        after = [[0, 0, None], [None, None, None], [0, None, None]]
        reference = [[(0, 0, 0)] * 3 for _ in range(3)]
        original = copy.deepcopy((before, after, reference, palette))

        metrics = refine.compute_metrics(before, after, reference, palette)

        self.assertEqual(
            metrics,
            {
                "unique_colors_before": 2,
                "unique_colors_after": 1,
                "changed_cells": 1,
                "colors_used_1_to_3": 1,
                "components_size_1_to_2": 2,
                "mean_reference_delta_e_before": 33.333335,
                "mean_reference_delta_e_after": 0.0,
                "non_empty_before": 3,
                "non_empty_after": 3,
            },
        )
        self.assertEqual((before, after, reference, palette), original)

    def test_plain_and_heatmap_have_exact_pixels_dimensions_and_alpha(self) -> None:
        palette = self.palette((200, 40, 50), (20, 80, 210))
        before = [[0, None], [1, 0]]
        after = [[0, 1], [0, 1]]
        original = copy.deepcopy((before, after, palette))

        plain = refine.render_plain(before, palette, cell_size=4)
        heatmap = refine.render_heatmap(before, after, palette, cell_size=4)

        self.assertEqual(plain.mode, "RGBA")
        self.assertEqual(plain.size, (8, 8))
        self.assertEqual(plain.getpixel((1, 1)), (200, 40, 50, 255))
        self.assertEqual(plain.getpixel((5, 1)), (0, 0, 0, 0))
        self.assertEqual(heatmap.mode, "RGBA")
        self.assertEqual(heatmap.size, (8, 8))
        self.assertEqual(heatmap.getpixel((1, 1)), (200, 40, 50, 76))
        self.assertEqual(heatmap.getpixel((5, 1)), (255, 0, 0, 255))
        self.assertEqual(heatmap.getpixel((1, 5)), (255, 0, 0, 255))
        self.assertEqual((before, after, palette), original)

    def test_blueprint_has_exact_extent_grid_fill_and_readable_code_ink(self) -> None:
        palette = self.palette((235, 205, 170))

        blueprint = refine.render_blueprint([[0]], palette)

        self.assertEqual(blueprint.size, (20, 20))
        pixels = list(blueprint.convert("RGB").get_flattened_data())
        self.assertIn((235, 205, 170), pixels)
        center_pixels = [
            blueprint.convert("RGB").getpixel((column, row))
            for row in range(5, 16)
            for column in range(3, 18)
        ]
        self.assertTrue(any(max(pixel) < 100 for pixel in center_pixels))
        self.assertNotEqual(
            blueprint.convert("RGB").getpixel((0, 0)),
            (235, 205, 170),
        )

    def test_h1_renderers_use_see_through_marker_distinct_from_none(self) -> None:
        palette = [
            refine.PaletteColor(
                0,
                "H1",
                "#0AC81E",
                (10, 200, 30),
                refine.rgb_to_lab((10, 200, 30)),
            ),
            refine.PaletteColor(
                1,
                "H2",
                "#FFFFFF",
                (255, 255, 255),
                refine.rgb_to_lab((255, 255, 255)),
            ),
        ]
        grid = [[0, None, 1]]
        mask = [[False, False, False]]

        plain = refine.render_plain(grid, palette, cell_size=10)
        overlay = refine.render_mask_overlay(grid, palette, mask, cell_size=10)
        blueprint = refine.render_blueprint(grid, palette, cell_size=20)
        heatmap = refine.render_heatmap(grid, grid, palette, cell_size=10)

        for image in (plain, overlay):
            h1_alpha = [image.getpixel((x, y))[3] for y in range(10) for x in range(10)]
            self.assertTrue(any(alpha > 0 for alpha in h1_alpha))
            self.assertTrue(any(alpha == 0 for alpha in h1_alpha))
            self.assertFalse(
                any(
                    image.getpixel((x, y))[:3] == (10, 200, 30)
                    and image.getpixel((x, y))[3] == 255
                    for y in range(10)
                    for x in range(10)
                )
            )
            self.assertTrue(
                all(image.getpixel((x, y))[3] == 0 for y in range(10) for x in range(10, 20))
            )

        h1_blueprint = [
            blueprint.convert("RGB").getpixel((x, y))
            for y in range(2, 18)
            for x in range(2, 18)
        ]
        self.assertTrue(any(max(pixel) < 180 for pixel in h1_blueprint))
        self.assertNotIn((10, 200, 30), h1_blueprint)
        h1_heat_alpha = [
            heatmap.getpixel((x, y))[3] for y in range(10) for x in range(10)
        ]
        self.assertTrue(any(alpha > 0 for alpha in h1_heat_alpha))
        self.assertTrue(any(alpha == 0 for alpha in h1_heat_alpha))
        self.assertTrue(
            all(heatmap.getpixel((x, y))[3] == 0 for y in range(10) for x in range(10, 20))
        )

    def test_blueprint_default_font_fallback_fits_h19_inside_cell(self) -> None:
        palette = [
            refine.PaletteColor(
                0,
                "H19",
                "#F2EEE5",
                (242, 238, 229),
                refine.rgb_to_lab((242, 238, 229)),
            )
        ]

        with patch.object(refine.ImageFont, "truetype", side_effect=OSError("no font")):
            blueprint = refine.render_blueprint([[0, None]], palette, cell_size=20)

        rgb = blueprint.convert("RGB")
        self.assertTrue(
            any(max(rgb.getpixel((x, y))) < 150 for y in range(3, 17) for x in range(2, 18))
        )
        self.assertTrue(
            all(rgb.getpixel((x, y)) == (255, 255, 255) for y in range(2, 18) for x in range(22, 38))
        )

    def test_output_apis_reject_bad_shapes_sizes_and_palette_indices(self) -> None:
        palette = self.palette((0, 0, 0), (255, 255, 255))
        reference = [[(0, 0, 0), (0, 0, 0)]]
        cases = {
            "metrics shape": lambda: refine.compute_metrics(
                [[0, 1]], [[0]], reference, palette
            ),
            "metrics reference shape": lambda: refine.compute_metrics(
                [[0, 1]], [[0, 1]], [[(0, 0, 0)]], palette
            ),
            "plain ragged": lambda: refine.render_plain([[0, 1], [0]], palette),
            "plain index": lambda: refine.render_plain([[2]], palette),
            "plain size": lambda: refine.render_plain([[0]], palette, cell_size=0),
            "blueprint index": lambda: refine.render_blueprint([[True]], palette),
            "blueprint size": lambda: refine.render_blueprint(
                [[0]], palette, cell_size=-1
            ),
            "heatmap shape": lambda: refine.render_heatmap(
                [[0, 1]], [[0]], palette
            ),
            "heatmap index": lambda: refine.render_heatmap([[0]], [[3]], palette),
            "heatmap size": lambda: refine.render_heatmap(
                [[0]], [[0]], palette, cell_size=False
            ),
        }
        for name, operation in cases.items():
            with self.subTest(name=name), self.assertRaises(ValueError):
                operation()

    def test_cli_writes_exact_deterministic_artifacts_from_outside_repo(self) -> None:
        with (
            tempfile.TemporaryDirectory(dir=ROOT) as fixture_dir,
            tempfile.TemporaryDirectory() as outside_dir,
        ):
            fixture = Path(fixture_dir)
            input_path, reference_path, grid = self.write_fixture(fixture)
            original_bytes = input_path.read_bytes()
            output_dirs = [fixture / "first", fixture / "second"]
            relative_input = input_path.relative_to(ROOT)
            relative_reference = reference_path.relative_to(ROOT)

            for output_dir in output_dirs:
                subprocess.run(
                    [
                        sys.executable,
                        str(ROOT / "scripts/refine_deniya.py"),
                        "--input",
                        str(relative_input),
                        "--reference",
                        str(relative_reference),
                        "--output-dir",
                        str(output_dir.relative_to(ROOT)),
                    ],
                    cwd=outside_dir,
                    text=True,
                    capture_output=True,
                    check=True,
                )

            expected_names = {"protection-mask.png", "metrics.json"}
            for profile in ("light", "balanced", "compact"):
                expected_names.add(f"deniya1-{profile}.pindou")
                for kind in ("plain", "blueprint", "heatmap"):
                    expected_names.add(f"deniya1-{profile}-{kind}.png")
            self.assertEqual({path.name for path in output_dirs[0].iterdir()}, expected_names)
            for profile in ("light", "balanced", "compact"):
                candidate = load_project(output_dirs[0] / f"deniya1-{profile}.pindou")
                self.assertEqual(candidate["canvasData"], candidate["layers"][0]["data"])
                self.assertEqual(candidate["canvasData"], grid)
            hashes = [
                {
                    name: hashlib.sha256((output_dir / name).read_bytes()).hexdigest()
                    for name in expected_names
                }
                for output_dir in output_dirs
            ]
            self.assertEqual(hashes[0], hashes[1])
            metrics = json.loads((output_dirs[0] / "metrics.json").read_text("utf-8"))
            self.assertEqual(list(metrics), ["balanced", "compact", "light"])
            for profile_metrics in metrics.values():
                self.assertEqual(profile_metrics["protected_mismatches"], 0)
                self.assertEqual(profile_metrics["soft_protection_changes"], 0)
                self.assertIn("protection_union_cells", profile_metrics)
                self.assertEqual(profile_metrics["transparency_mismatches"], 0)
                self.assertEqual(profile_metrics["h1_mismatches"], 0)
            self.assertEqual(input_path.read_bytes(), original_bytes)

    def test_cli_rejects_managed_artifact_collision_without_touching_input(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, _ = self.write_fixture(
                directory, input_name="deniya1-light.pindou"
            )
            original = input_path.read_bytes()

            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts/refine_deniya.py"),
                    "--input",
                    str(input_path),
                    "--reference",
                    str(reference_path),
                    "--output-dir",
                    str(directory),
                ],
                cwd=directory,
                text=True,
                capture_output=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("collides", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(input_path.read_bytes(), original)

    def test_cli_rejects_file_as_output_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, _ = self.write_fixture(directory)
            output_path = directory / "not-a-directory"
            output_path.write_text("keep", encoding="utf-8")
            for candidate in (output_path, output_path / "child"):
                with self.subTest(candidate=candidate):
                    result = subprocess.run(
                        [
                            sys.executable,
                            str(ROOT / "scripts/refine_deniya.py"),
                            "--input",
                            str(input_path),
                            "--reference",
                            str(reference_path),
                            "--output-dir",
                            str(candidate),
                        ],
                        cwd=directory,
                        text=True,
                        capture_output=True,
                    )

                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("output directory", result.stderr)
            self.assertEqual(output_path.read_text(encoding="utf-8"), "keep")

    def test_cli_malformed_reference_is_concise_and_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, _ = self.write_fixture(directory)
            reference_path.write_bytes(b"not an image")
            output_dir = directory / "output"

            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts/refine_deniya.py"),
                    "--input",
                    str(input_path),
                    "--reference",
                    str(reference_path),
                    "--output-dir",
                    str(output_dir),
                ],
                cwd=directory,
                text=True,
                capture_output=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("reference image", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertFalse(output_dir.exists())

    def test_cli_uses_untouched_baseline_for_each_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, baseline = self.write_fixture(directory)
            output_dir = directory / "output"
            calls: list[refine.Grid] = []

            def fake_refine(
                grid: refine.Grid,
                reference: refine.ReferenceGrid,
                palette: list[refine.PaletteColor],
                protected: list[list[bool]],
                region_hints: object,
                profile: refine.CleanupProfile,
            ) -> refine.Grid:
                calls.append(copy.deepcopy(grid))
                result = copy.deepcopy(grid)
                result[0][0] = {"light": 1, "balanced": 2, "compact": 3}[profile.name]
                return result

            with patch.object(deniya, "refine_grid", side_effect=fake_refine):
                self.assertEqual(
                    deniya.main(
                        [
                            "--input",
                            str(input_path),
                            "--reference",
                            str(reference_path),
                            "--output-dir",
                            str(output_dir),
                        ]
                    ),
                    0,
                )

            self.assertEqual(calls, [baseline, baseline, baseline])

    def test_cli_asserts_protected_and_transparency_topology(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, baseline = self.write_fixture(directory)

            def changed_palette(*args: object, **kwargs: object) -> refine.Grid:
                result = copy.deepcopy(baseline)
                result[0][0] = 1
                return result

            automatic = refine.AutoProtectionMasks(
                hard=[[True, False, False], [False, False, False]],
                junction_only=[[False] * 3 for _ in range(2)],
            )
            with (
                patch.object(
                    deniya,
                    "build_auto_protection_masks",
                    return_value=automatic,
                    create=True,
                ),
                patch.object(deniya, "refine_grid", side_effect=changed_palette),
                self.assertRaisesRegex(AssertionError, "protected cell changed"),
            ):
                deniya.main(
                    [
                        "--input",
                        str(input_path),
                        "--reference",
                        str(reference_path),
                        "--output-dir",
                        str(directory / "protected"),
                    ]
                )

            def changed_transparency(*args: object, **kwargs: object) -> refine.Grid:
                result = copy.deepcopy(baseline)
                result[0][0] = None
                return result

            with (
                patch.object(
                    deniya,
                    "build_auto_protection_masks",
                    return_value=refine.AutoProtectionMasks(
                        hard=[[False] * 3 for _ in range(2)],
                        junction_only=[[False] * 3 for _ in range(2)],
                    ),
                    create=True,
                ),
                patch.object(deniya, "refine_grid", side_effect=changed_transparency),
                self.assertRaisesRegex(AssertionError, "transparency"),
            ):
                deniya.main(
                    [
                        "--input",
                        str(input_path),
                        "--reference",
                        str(reference_path),
                        "--output-dir",
                        str(directory / "transparency"),
                    ]
                )

    def test_cli_allows_soft_change_and_reports_separate_protection_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, baseline = self.write_fixture(directory)
            output_dir = directory / "output"
            automatic = refine.AutoProtectionMasks(
                hard=[[False] * 3 for _ in range(2)],
                junction_only=[[True, False, False], [False, False, False]],
            )

            def change_soft(
                grid: refine.Grid,
                reference: refine.ReferenceGrid,
                palette: list[refine.PaletteColor],
                protected: list[list[bool]],
                region_hints: object,
                profile: refine.CleanupProfile,
            ) -> refine.Grid:
                self.assertFalse(protected[0][0])
                result = copy.deepcopy(baseline)
                result[0][0] = 1
                return result

            with (
                patch.object(
                    deniya,
                    "build_auto_protection_masks",
                    return_value=automatic,
                    create=True,
                ),
                patch.object(deniya, "refine_grid", side_effect=change_soft),
            ):
                self.assertEqual(
                    deniya.main(
                        [
                            "--input",
                            str(input_path),
                            "--reference",
                            str(reference_path),
                            "--output-dir",
                            str(output_dir),
                        ]
                    ),
                    0,
                )

            metrics = json.loads((output_dir / "metrics.json").read_text("utf-8"))
            for profile_metrics in metrics.values():
                self.assertEqual(profile_metrics["protected_mismatches"], 0)
                self.assertEqual(profile_metrics["soft_protection_changes"], 1)
                self.assertEqual(profile_metrics["protection_union_cells"], 1)

    @unittest.skipUnless(
        (ROOT / "temp/deniya_orig.png").is_file(),
        "real Deniya reference image is not available",
    )
    def test_real_deniya_soft_protection_integration(self) -> None:
        palette = load_palette(ROOT / "src/data/mard221.ts")
        baseline = load_project(ROOT / "samples/deniya1.pindou")["canvasData"]
        d16 = next(color.index for color in palette if color.code == "D16")
        e18 = next(color.index for color in palette if color.code == "E18")
        g16 = next(color.index for color in palette if color.code == "G16")
        h2 = next(color.index for color in palette if color.code == "H2")
        # The formal sample may be either the legacy input or the already accepted
        # Compact cleanup. Regeneration must be safe and deterministic in both states.
        target_before = baseline[56][71]
        self.assertIn(target_before, (d16, h2))
        accepted_baseline = target_before == h2
        baseline_counts = {
            color: sum(cell == color for row in baseline for cell in row)
            for color in {cell for row in baseline for cell in row if cell is not None}
        }
        baseline_unique_colors = len(baseline_counts)
        low_frequency = {color for color, count in baseline_counts.items() if count <= 3}
        width = len(baseline[0])
        height = len(baseline)
        explicit = refine.build_mask(
            width,
            height,
            list(deniya.PROTECTED_POLYGONS.values()),
        )
        automatic = refine.build_auto_protection_masks(baseline, palette)
        automatic_union = automatic.union
        hard = [
            [explicit[row][col] or automatic.hard[row][col] for col in range(width)]
            for row in range(height)
        ]
        protection_union_cells = sum(
            explicit[row][col] or automatic_union[row][col]
            for row in range(height)
            for col in range(width)
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "output"
            self.assertEqual(deniya.main(["--output-dir", str(output_dir)]), 0)
            candidates = {
                profile: load_project(output_dir / f"deniya1-{profile}.pindou")["canvasData"]
                for profile in ("light", "balanced", "compact")
            }
            metrics = json.loads((output_dir / "metrics.json").read_text("utf-8"))

        if accepted_baseline:
            self.assertNotIn(d16, (cell for row in baseline for cell in row))
            for candidate in candidates.values():
                self.assertEqual(candidate[56][71], h2)
                self.assertNotIn(d16, (cell for row in candidate for cell in row))
        else:
            self.assertEqual(candidates["light"][56][71], d16)
            self.assertEqual(candidates["balanced"][56][71], d16)
            self.assertEqual(candidates["compact"][56][71], h2)

        for profile, candidate in candidates.items():
            self.assertEqual(candidate[79][10], e18)
            self.assertEqual(candidate[52][70], g16)
            refine.assert_protected_unchanged(baseline, candidate, hard)
            self.assertEqual(
                [[cell is None for cell in row] for row in candidate],
                [[cell is None for cell in row] for row in baseline],
            )
            self.assertEqual(
                [[refine.is_h1_bead(cell, palette) for cell in row] for row in candidate],
                [[refine.is_h1_bead(cell, palette) for cell in row] for row in baseline],
            )
            candidate_unique_colors = len(
                {cell for row in candidate for cell in row if cell is not None}
            )
            self.assertEqual(
                metrics[profile]["unique_colors_after"],
                candidate_unique_colors,
            )
            self.assertLessEqual(candidate_unique_colors, baseline_unique_colors)

        if not accepted_baseline:
            self.assertEqual(metrics["light"]["unique_colors_after"], baseline_unique_colors)
            self.assertEqual(metrics["balanced"]["unique_colors_after"], baseline_unique_colors)
            self.assertEqual(
                metrics["compact"]["unique_colors_after"],
                baseline_unique_colors - 1,
            )
        for profile_metrics in metrics.values():
            self.assertEqual(profile_metrics["protected_mismatches"], 0)
            self.assertIsInstance(profile_metrics["soft_protection_changes"], int)
            self.assertEqual(
                profile_metrics["protection_union_cells"],
                protection_union_cells,
            )
        low_frequency_changes = {
            profile: {
                (col, row, baseline[row][col], candidate[row][col])
                for row in range(height)
                for col in range(width)
                if baseline[row][col] in low_frequency
                and baseline[row][col] != candidate[row][col]
            }
            for profile, candidate in candidates.items()
        }
        if not accepted_baseline:
            self.assertEqual(
                low_frequency_changes,
                {"light": set(), "balanced": set(), "compact": {(71, 56, d16, h2)}},
            )

    def test_cli_asserts_h1_topology(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, baseline = self.write_fixture(directory)
            palette = load_palette(ROOT / "src/data/mard221.ts")
            h1_index = next(color.index for color in palette if color.code == "H1")

            def changed_h1(*args: object, **kwargs: object) -> refine.Grid:
                result = copy.deepcopy(baseline)
                result[0][0] = h1_index
                return result

            with (
                patch.object(deniya, "refine_grid", side_effect=changed_h1),
                self.assertRaisesRegex(AssertionError, "H1"),
            ):
                deniya.main(
                    [
                        "--input",
                        str(input_path),
                        "--reference",
                        str(reference_path),
                        "--output-dir",
                        str(directory / "h1"),
                    ]
                )

    def test_cli_failure_does_not_publish_partial_generation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, _ = self.write_fixture(directory)
            output_dir = directory / "output"
            output_dir.mkdir()
            stale = {
                name: f"old-{name}".encode("utf-8")
                for name in deniya.MANAGED_ARTIFACT_NAMES
            }
            for name, data in stale.items():
                (output_dir / name).write_bytes(data)

            with (
                patch.object(deniya, "refine_grid", side_effect=RuntimeError("stop")),
                self.assertRaisesRegex(RuntimeError, "stop"),
            ):
                deniya.main(
                    [
                        "--input",
                        str(input_path),
                        "--reference",
                        str(reference_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            self.assertEqual(
                {
                    name: (output_dir / name).read_bytes()
                    for name in deniya.MANAGED_ARTIFACT_NAMES
                    if (output_dir / name).exists()
                },
                stale,
            )

    def test_cli_rejects_managed_directories_without_deleting_contents(self) -> None:
        cases = (
            ("deniya1-light.pindou", False),
            ("protection-mask.png", True),
        )
        for managed_name, mask_only in cases:
            with self.subTest(managed_name=managed_name), tempfile.TemporaryDirectory() as temp_dir:
                directory = Path(temp_dir)
                input_path, reference_path, _ = self.write_fixture(directory)
                output_dir = directory / "output"
                output_dir.mkdir()
                offending_path = output_dir / managed_name
                offending_path.mkdir()
                sentinel = offending_path / "sentinel.txt"
                sentinel.write_bytes(b"preserve-directory")
                metrics_path = output_dir / "metrics.json"
                metrics_path.write_bytes(b"preserve-metrics")
                argv = [
                    "--input",
                    str(input_path),
                    "--reference",
                    str(reference_path),
                    "--output-dir",
                    str(output_dir),
                ]
                if mask_only:
                    argv.append("--mask-overlay-only")

                with self.assertRaises(ValueError) as raised:
                    deniya.main(argv)

                self.assertIn(str(offending_path.resolve()), str(raised.exception))
                self.assertEqual(sentinel.read_bytes(), b"preserve-directory")
                self.assertEqual(metrics_path.read_bytes(), b"preserve-metrics")

    def test_cli_rejects_managed_symlinks_without_touching_target(self) -> None:
        with tempfile.TemporaryDirectory() as probe_dir:
            probe_root = Path(probe_dir)
            probe_target = probe_root / "target"
            probe_target.write_bytes(b"target")
            try:
                (probe_root / "link").symlink_to(probe_target)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"file symlink creation is unavailable: {error}")

        for mask_only in (False, True):
            with self.subTest(mask_only=mask_only), tempfile.TemporaryDirectory() as temp_dir:
                directory = Path(temp_dir)
                input_path, reference_path, _ = self.write_fixture(directory)
                output_dir = directory / "output"
                output_dir.mkdir()
                external_target = directory / "external-sentinel.bin"
                external_target.write_bytes(b"preserve-external")
                managed_link = output_dir / "protection-mask.png"
                managed_link.symlink_to(external_target)
                metrics_path = output_dir / "metrics.json"
                metrics_path.write_bytes(b"preserve-metrics")
                argv = [
                    "--input",
                    str(input_path),
                    "--reference",
                    str(reference_path),
                    "--output-dir",
                    str(output_dir),
                ]
                if mask_only:
                    argv.append("--mask-overlay-only")

                with self.assertRaises(ValueError) as raised:
                    deniya.main(argv)

                lexical_link = managed_link.parent.resolve() / managed_link.name
                self.assertIn(str(lexical_link), str(raised.exception))
                self.assertTrue(managed_link.is_symlink())
                self.assertEqual(external_target.read_bytes(), b"preserve-external")
                self.assertEqual(metrics_path.read_bytes(), b"preserve-metrics")

    def test_cli_mask_only_writes_no_candidates_in_fresh_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, _ = self.write_fixture(directory)
            output_dir = directory / "mask-only"

            self.assertEqual(
                deniya.main(
                    [
                        "--input",
                        str(input_path),
                        "--reference",
                        str(reference_path),
                        "--output-dir",
                        str(output_dir),
                        "--mask-overlay-only",
                    ]
                ),
                0,
            )

            self.assertEqual(
                [path.name for path in output_dir.iterdir()],
                ["protection-mask.png"],
            )

    def test_cli_mask_only_removes_stale_managed_outputs_and_preserves_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            input_path, reference_path, _ = self.write_fixture(directory)
            output_dir = directory / "output"
            output_dir.mkdir()
            for name in deniya.MANAGED_ARTIFACT_NAMES:
                (output_dir / name).write_bytes(b"stale")
            unknown_path = output_dir / "notes.txt"
            unknown_path.write_text("preserve", encoding="utf-8")

            deniya.main(
                [
                    "--input",
                    str(input_path),
                    "--reference",
                    str(reference_path),
                    "--output-dir",
                    str(output_dir),
                    "--mask-overlay-only",
                ]
            )

            managed = {
                path.name
                for path in output_dir.iterdir()
                if path.name in deniya.MANAGED_ARTIFACT_NAMES
            }
            self.assertEqual(managed, {"protection-mask.png"})
            self.assertEqual(unknown_path.read_text(encoding="utf-8"), "preserve")


class RefinementTests(unittest.TestCase):
    @staticmethod
    def palette(*rgbs: tuple[int, int, int]) -> list[refine.PaletteColor]:
        return [
            refine.PaletteColor(
                index=index,
                code=f"T{index}",
                hex="#%02X%02X%02X" % rgb,
                rgb=rgb,
                lab=refine.rgb_to_lab(rgb),
            )
            for index, rgb in enumerate(rgbs)
        ]

    @staticmethod
    def reference(grid: refine.Grid, palette: list[refine.PaletteColor]) -> refine.ReferenceGrid:
        fallback = palette[0].rgb
        return [
            [fallback if cell is None else palette[cell].rgb for cell in row]
            for row in grid
        ]

    @staticmethod
    def profile(**overrides: object) -> refine.CleanupProfile:
        values = {
            "name": "test",
            "rare_count": 2,
            "max_component": 1,
            "max_palette_delta_e": 20.0,
            "max_reference_increase": 20.0,
            "neighbor_dominance": 0.5,
            "passes": 1,
        }
        values.update(overrides)
        return refine.CleanupProfile(**values)

    def test_color_family_threshold_representatives(self) -> None:
        cases = {
            (20, 60, 180): "blue",
            (210, 60, 160): "pink",
            (225, 155, 105): "skin",
            (35, 38, 40): "neutral-dark",
            (205, 208, 210): "neutral-light",
            (100, 100, 130): "neutral-dark",  # chroma 30/255: neutral
            (100, 100, 131): "blue",  # chroma 31/255: chromatic
            (127, 127, 127): "neutral-dark",
            (128, 128, 128): "neutral-light",
            (0, 255, 212): "skin",  # immediately below the blue hue arc
            (0, 255, 213): "blue",
            (191, 0, 255): "blue",  # immediately below the pink hue arc
            (192, 0, 255): "pink",
            (255, 63, 0): "pink",  # immediately below the skin hue arc
            (255, 64, 0): "skin",
        }
        for rgb, expected in cases.items():
            with self.subTest(rgb=rgb):
                self.assertEqual(refine.color_family(rgb), expected)

    def test_semantic_region_uses_first_matching_named_hint(self) -> None:
        hints = {
            "first": [(0, 0), (3, 0), (3, 3), (0, 3)],
            "second": [(1, 1), (4, 1), (4, 4), (1, 4)],
        }

        self.assertEqual(
            refine.semantic_region(1, 1, (20, 60, 180), hints),
            ("blue", "first"),
        )
        self.assertEqual(
            refine.semantic_region(5, 5, (20, 60, 180), hints),
            ("blue", "unhinted"),
        )

    def test_h1_is_a_separate_immutable_bead_kind(self) -> None:
        palette = [
            refine.PaletteColor(
                0,
                "H1",
                "#FBFBFB",
                (251, 251, 251),
                refine.rgb_to_lab((251, 251, 251)),
            ),
            refine.PaletteColor(
                1,
                "H2",
                "#FFFFFF",
                (255, 255, 255),
                refine.rgb_to_lab((255, 255, 255)),
            ),
        ]
        cases = (
            [[1, 1, 1], [1, 0, 1], [1, 1, 1]],
            [[0, 0, 0], [0, 1, 0], [0, 0, 0]],
        )

        self.assertTrue(refine.is_h1_bead(0, palette))
        self.assertFalse(refine.is_h1_bead(1, palette))
        self.assertEqual(
            refine.semantic_region(0, 0, palette[0].rgb, {}, code="H1"),
            ("transparent-bead", "unhinted"),
        )
        for grid in cases:
            with self.subTest(center=grid[1][1]):
                result = refine.refine_grid(
                    grid,
                    self.reference(grid, palette),
                    palette,
                    [[False] * 3 for _ in range(3)],
                    {},
                    self.profile(
                        rare_count=1,
                        max_component=1,
                        max_palette_delta_e=100.0,
                        max_reference_increase=100.0,
                    ),
                )
                self.assertEqual(result, grid)

    def test_connected_components_are_row_major_and_four_connected(self) -> None:
        grid = [[0, 0, None], [None, 0, 1], [0, None, 1]]

        self.assertEqual(
            refine.connected_components(grid),
            [[(0, 0), (0, 1), (1, 1)], [(1, 2), (2, 2)], [(2, 0)]],
        )

    def test_similar_unprotected_singleton_joins_local_majority(self) -> None:
        palette = self.palette((205, 72, 145), (211, 77, 149))
        grid = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]

        self.assertFalse(refine.build_auto_protection_mask(grid, palette)[1][1])

        result = refine.merge_rare_cells(
            grid,
            self.reference(grid, palette),
            palette,
            [[False] * 3 for _ in range(3)],
            {},
            self.profile(),
        )

        self.assertEqual(result, [[1, 1, 1], [1, 1, 1], [1, 1, 1]])

    def test_explicit_protected_singleton_remains(self) -> None:
        palette = self.palette((205, 72, 145), (211, 77, 149))
        grid = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]
        protected = [[False] * 3 for _ in range(3)]
        protected[1][1] = True

        result = refine.refine_grid(
            grid, self.reference(grid, palette), palette, protected, {}, self.profile()
        )

        self.assertEqual(result, grid)

    def test_auto_mask_preserves_dark_high_contrast_outline(self) -> None:
        palette = self.palette((18, 20, 22), (230, 225, 220))
        grid = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]

        mask = refine.build_auto_protection_mask(grid, palette)
        result = refine.refine_grid(
            grid,
            self.reference(grid, palette),
            palette,
            [[False] * 3 for _ in range(3)],
            {},
            self.profile(max_palette_delta_e=100.0, max_reference_increase=100.0),
        )

        self.assertTrue(mask[1][1])
        self.assertEqual(result[1][1], 0)

    def test_auto_protection_distinguishes_hard_and_junction_only_reasons(self) -> None:
        palette = self.palette(
            (205, 72, 145),
            (211, 77, 149),
            (255, 170, 220),
        )
        grid = [[1, 1, 2], [1, 0, 1], [1, 1, 1]]

        masks = refine.build_auto_protection_masks(grid, palette)

        self.assertFalse(masks.hard[1][1])
        self.assertTrue(masks.junction_only[1][1])
        self.assertEqual(
            masks.union,
            refine.build_auto_protection_mask(grid, palette),
        )

    def test_junction_only_singleton_changes_when_reference_strictly_improves(self) -> None:
        palette = self.palette(
            (205, 72, 145),
            (211, 77, 149),
            (255, 170, 220),
        )
        grid = [[1, 1, 2], [1, 0, 1], [1, 1, 1]]
        reference = self.reference(grid, palette)
        reference[1][1] = palette[1].rgb

        result = refine.refine_grid(
            grid,
            reference,
            palette,
            [[False] * 3 for _ in range(3)],
            {},
            self.profile(),
        )

        self.assertTrue(refine.build_auto_protection_masks(grid, palette).junction_only[1][1])
        self.assertEqual(result[1][1], 1)

    def test_junction_only_singleton_stays_when_reference_is_equal_or_worse(self) -> None:
        rgb = (205, 72, 145)
        reference_lab = refine.rgb_to_lab(rgb)
        equal_palette = [
            refine.PaletteColor(
                0, "S", "#CD4891", rgb, (reference_lab[0] - 0.5, *reference_lab[1:])
            ),
            refine.PaletteColor(
                1, "C", "#CD4891", rgb, (reference_lab[0] + 0.5, *reference_lab[1:])
            ),
            refine.PaletteColor(
                2,
                "J",
                "#FFAADE",
                (255, 170, 222),
                refine.rgb_to_lab((255, 170, 222)),
            ),
        ]
        worse_palette = self.palette(
            (205, 72, 145),
            (211, 77, 149),
            (255, 170, 220),
        )
        grid = [[1, 1, 2], [1, 0, 1], [1, 1, 1]]
        cases = {
            "equal": (equal_palette, rgb),
            "worse": (worse_palette, worse_palette[0].rgb),
        }

        for name, (palette, center_reference) in cases.items():
            with self.subTest(name=name):
                reference = self.reference(grid, palette)
                reference[1][1] = center_reference
                result = refine.refine_grid(
                    grid,
                    reference,
                    palette,
                    [[False] * 3 for _ in range(3)],
                    {},
                    self.profile(),
                )
                self.assertEqual(result[1][1], 0)

    def test_junction_cell_with_hard_reason_or_explicit_mask_stays_protected(self) -> None:
        pink_palette = self.palette(
            (205, 72, 145),
            (211, 77, 149),
            (255, 170, 220),
        )
        dark_palette = self.palette(
            (18, 20, 22),
            (48, 50, 52),
            (245, 245, 245),
        )
        explicit = [[False] * 3 for _ in range(3)]
        explicit[1][1] = True
        cases = {
            "explicit": (
                [[1, 1, 2], [1, 0, 1], [1, 1, 1]],
                pink_palette,
                explicit,
            ),
            "dark contrast": (
                [[1, 2, 1], [1, 0, 1], [1, 1, 1]],
                dark_palette,
                [[False] * 3 for _ in range(3)],
            ),
            "silhouette border": (
                [[1, None, 2], [1, 0, 1], [1, 1, 1]],
                pink_palette,
                [[False] * 3 for _ in range(3)],
            ),
        }

        for name, (grid, palette, protected) in cases.items():
            with self.subTest(name=name):
                reference = self.reference(grid, palette)
                reference[1][1] = palette[1].rgb
                result = refine.refine_grid(
                    grid,
                    reference,
                    palette,
                    protected,
                    {},
                    self.profile(max_palette_delta_e=100.0),
                )
                self.assertEqual(result[1][1], 0)

    def test_soft_component_changes_only_when_every_cell_strictly_improves(self) -> None:
        palette = self.palette(
            (205, 72, 145),
            (211, 77, 149),
            (255, 170, 220),
        )
        grid = [[1, 1, 2, 2], [1, 0, 0, 1], [1, 1, 2, 2]]
        protected = [[False] * 4 for _ in range(3)]
        profile = self.profile(rare_count=2, max_component=2)
        all_improve = self.reference(grid, palette)
        all_improve[1][1] = palette[1].rgb
        all_improve[1][2] = palette[1].rgb
        one_worsens = copy.deepcopy(all_improve)
        one_worsens[1][2] = palette[0].rgb

        changed = refine.refine_grid(
            grid, all_improve, palette, protected, {}, profile
        )
        kept = refine.refine_grid(
            grid, one_worsens, palette, protected, {}, profile
        )

        self.assertEqual(changed[1][1:3], [1, 1])
        self.assertEqual(kept, grid)

    def test_auto_mask_preserves_transparency_and_subject_border(self) -> None:
        palette = self.palette((205, 72, 145), (211, 77, 149))
        grid = [[None, None, None], [None, 0, 1], [None, 1, 1]]

        mask = refine.build_auto_protection_mask(grid, palette)
        result = refine.refine_grid(
            grid,
            self.reference(grid, palette),
            palette,
            [[False] * 3 for _ in range(3)],
            {},
            self.profile(),
        )

        self.assertFalse(mask[0][0])
        self.assertTrue(mask[1][1])
        self.assertEqual(result, grid)

    def test_canvas_edge_is_not_automatically_a_subject_boundary(self) -> None:
        palette = self.palette((205, 72, 145))
        grid = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]

        mask = refine.build_auto_protection_mask(grid, palette)

        self.assertEqual(mask, [[False] * 3 for _ in range(3)])

    def test_family_mismatch_alone_rejects_merge(self) -> None:
        pink = (210, 60, 160)
        common_lab = refine.rgb_to_lab(pink)
        palette = [
            refine.PaletteColor(0, "P", "#D23CA0", pink, common_lab),
            refine.PaletteColor(1, "B", "#1446BE", (20, 70, 190), common_lab),
        ]
        grid = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]

        result = refine.merge_rare_cells(
            grid,
            self.reference(grid, palette),
            palette,
            [[False] * 3 for _ in range(3)],
            {},
            self.profile(
                rare_count=1,
                max_palette_delta_e=0.0,
                max_reference_increase=0.0,
            ),
        )

        self.assertEqual(result[1][1], 0)

    def test_spatial_region_mismatch_alone_rejects_merge(self) -> None:
        palette = self.palette((210, 60, 160), (210, 60, 160))
        grid = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]
        protected = [[False] * 3 for _ in range(3)]
        hints = {"center": [(1, 1), (2, 1), (2, 2), (1, 2)]}

        result = refine.merge_rare_cells(
            grid,
            self.reference(grid, palette),
            palette,
            protected,
            hints,
            self.profile(
                rare_count=1,
                max_palette_delta_e=0.0,
                max_reference_increase=0.0,
            ),
        )

        self.assertEqual(result[1][1], 0)

    def test_protected_neighbors_remain_valid_rare_merge_candidates(self) -> None:
        palette = self.palette((205, 72, 145), (211, 77, 149))
        grid = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]
        protected = [[True] * 3 for _ in range(3)]
        protected[1][1] = False

        result = refine.merge_rare_cells(
            grid,
            self.reference(grid, palette),
            palette,
            protected,
            {},
            self.profile(),
        )

        self.assertEqual(result[1][1], 1)

    def test_protected_neighbors_remain_valid_component_candidates(self) -> None:
        palette = self.palette((205, 72, 145), (211, 77, 149))
        grid = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]
        protected = [[True] * 3 for _ in range(3)]
        protected[1][1] = False

        result = refine.cleanup_components(
            grid,
            self.reference(grid, palette),
            palette,
            protected,
            {},
            self.profile(),
        )

        self.assertEqual(result[1][1], 1)

    def test_palette_and_reference_error_limits_reject_candidates(self) -> None:
        palette = self.palette((205, 72, 145), (212, 78, 150), (244, 155, 198))
        protected = [[False] * 3 for _ in range(3)]
        cases = {
            "palette": (
                [[2, 2, 2], [2, 0, 2], [2, 2, 2]],
                self.profile(max_palette_delta_e=2.0, max_reference_increase=100.0),
                (205, 72, 145),
            ),
            "reference": (
                [[1, 1, 1], [1, 0, 1], [1, 1, 1]],
                self.profile(max_palette_delta_e=20.0, max_reference_increase=1.0),
                (205, 72, 145),
            ),
        }
        for name, (grid, profile, center_reference) in cases.items():
            with self.subTest(name=name):
                reference = self.reference(grid, palette)
                reference[1][1] = center_reference
                result = refine.merge_rare_cells(
                    grid, reference, palette, protected, {}, profile
                )
                self.assertEqual(result[1][1], 0)

    def test_neighbor_dominance_is_enforced(self) -> None:
        palette = self.palette(
            (205, 72, 145),
            (211, 77, 149),
            (215, 81, 153),
        )
        grid = [[1, 2, 2], [2, 0, 1], [2, 1, 2]]

        result = refine.merge_rare_cells(
            grid,
            self.reference(grid, palette),
            palette,
            [[False] * 3 for _ in range(3)],
            {},
            self.profile(rare_count=1, neighbor_dominance=0.7),
        )

        self.assertEqual(result[1][1], 0)

    def test_component_cleanup_honors_maximum_size(self) -> None:
        palette = self.palette((205, 72, 145), (211, 77, 149))
        grid = [[1, 1, 1, 1], [1, 0, 0, 1], [1, 1, 1, 1]]
        protected = [[False] * 4 for _ in range(3)]

        kept = refine.cleanup_components(
            grid,
            self.reference(grid, palette),
            palette,
            protected,
            {},
            self.profile(max_component=1),
        )
        merged = refine.cleanup_components(
            grid,
            self.reference(grid, palette),
            palette,
            protected,
            {},
            self.profile(max_component=2),
        )

        self.assertEqual(kept, grid)
        self.assertEqual(merged[1], [1, 1, 1, 1])

    def test_component_cleanup_does_not_cross_semantic_regions(self) -> None:
        palette = self.palette(
            (205, 72, 145),
            (211, 77, 149),
            (20, 70, 190),
        )
        grid = [[1, 1, 2, 2], [1, 0, 0, 2], [1, 1, 2, 2]]
        hints = {"left": [(0, 0), (2, 0), (2, 3), (0, 3)]}

        result = refine.cleanup_components(
            grid,
            self.reference(grid, palette),
            palette,
            [[False] * 4 for _ in range(3)],
            hints,
            self.profile(
                max_component=2,
                max_palette_delta_e=100.0,
                max_reference_increase=100.0,
            ),
        )

        self.assertEqual(result[1][2], 0)

    def test_component_score_uses_aggregate_reference_error(self) -> None:
        pink = (210, 60, 160)
        reference_lab = refine.rgb_to_lab(pink)
        source_lab = (reference_lab[0] + 0.5, *reference_lab[1:])
        second_lab = (reference_lab[0] + 1.0, *reference_lab[1:])
        palette = [
            refine.PaletteColor(0, "S", "#D23CA0", pink, source_lab),
            refine.PaletteColor(1, "A", "#D23CA0", pink, reference_lab),
            refine.PaletteColor(2, "B", "#D23CA0", pink, second_lab),
            refine.PaletteColor(
                3,
                "X",
                "#1446BE",
                (20, 70, 190),
                refine.rgb_to_lab((20, 70, 190)),
            ),
        ]
        grid = [
            [1, 3, 2, 2, 3, 1],
            [3, 0, 0, 3, 3, 1],
            [3, 3, 3, 3, 2, 1],
        ]

        result = refine.cleanup_components(
            grid,
            self.reference(grid, palette),
            palette,
            [[False] * 6 for _ in range(3)],
            {},
            self.profile(
                max_component=2,
                max_palette_delta_e=2.0,
                max_reference_increase=2.0,
                neighbor_dominance=0.3,
            ),
        )

        self.assertEqual(result[1][1:3], [1, 1])

    def test_each_pass_reads_snapshot_without_scan_order_cascade(self) -> None:
        palette = self.palette(
            (205, 72, 145),
            (211, 77, 149),
            (216, 82, 154),
        )
        grid = [[1, 0, 2, 2]]
        reference = self.reference(grid, palette)
        protected = [[False, False, False, False]]

        result = refine.merge_rare_cells(
            grid,
            reference,
            palette,
            protected,
            {},
            self.profile(rare_count=1, neighbor_dominance=0.5),
        )

        self.assertEqual(result, [[1, 2, 2, 2]])

    def test_results_are_deterministic_and_inputs_are_not_mutated(self) -> None:
        palette = self.palette((205, 72, 145), (211, 77, 149))
        grid = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]
        reference = self.reference(grid, palette)
        protected = [[False] * 3 for _ in range(3)]
        original = copy.deepcopy((grid, reference, protected))

        first = refine.refine_grid(
            grid, reference, palette, protected, {}, self.profile()
        )
        second = refine.refine_grid(
            grid, reference, palette, protected, {}, self.profile()
        )

        self.assertEqual(first, second)
        self.assertEqual((grid, reference, protected), original)
        self.assertIsNot(first, grid)

    def test_validation_rejects_shape_and_palette_errors(self) -> None:
        palette = self.palette((205, 72, 145), (211, 77, 149))
        profile = self.profile()
        cases = {
            "ragged grid": ([[0, 1], [0]], [[palette[0].rgb] * 2] * 2, [[False] * 2] * 2),
            "reference shape": ([[0, 1]], [[palette[0].rgb]], [[False, False]]),
            "mask shape": ([[0, 1]], [[palette[0].rgb] * 2], [[False]]),
            "palette index": ([[0, 2]], [[palette[0].rgb] * 2], [[False, False]]),
        }
        for name, (grid, reference, protected) in cases.items():
            with self.subTest(name=name), self.assertRaises(ValueError):
                refine.refine_grid(
                    grid, reference, palette, protected, {}, profile
                )

    def test_runner_profiles_and_region_hints_are_exact(self) -> None:
        self.assertEqual(
            deniya.PROFILES,
            [
                refine.CleanupProfile("light", 2, 1, 7.0, 2.0, 0.66, 1),
                refine.CleanupProfile("balanced", 4, 2, 10.0, 3.0, 0.50, 2),
                refine.CleanupProfile("compact", 8, 3, 14.0, 5.0, 0.42, 3),
            ],
        )
        self.assertEqual(
            deniya.REGION_HINTS,
            {
                "face": [(29, 28), (76, 26), (83, 57), (69, 71), (39, 69), (27, 53)],
                "shoulders_left": [(0, 69), (42, 63), (51, 89), (0, 89)],
                "shoulders_right": [(75, 63), (101, 68), (101, 89), (70, 89)],
                "lower_garment": [(29, 57), (88, 55), (96, 89), (22, 89)],
            },
        )
        for previous, current in zip(deniya.PROFILES, deniya.PROFILES[1:]):
            self.assertLessEqual(previous.rare_count, current.rare_count)
            self.assertLessEqual(previous.max_component, current.max_component)
            self.assertLessEqual(previous.max_palette_delta_e, current.max_palette_delta_e)
            self.assertLessEqual(previous.max_reference_increase, current.max_reference_increase)
            self.assertGreaterEqual(previous.neighbor_dominance, current.neighbor_dominance)
            self.assertLessEqual(previous.passes, current.passes)


if __name__ == "__main__":
    unittest.main()

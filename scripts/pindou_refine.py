"""Foundational palette and v3 project I/O for Pindou refinement tools."""

import copy
import colorsys
import json
import math
import re
from collections import Counter, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, NotRequired, TypeAlias, TypedDict

from PIL import Image, ImageDraw, ImageFont, ImageStat


_MARD221_PALETTE_SIZE = 221
_MARD_COLORS_INITIALIZER_PATTERN = re.compile(
    r"\bexport\s+const\s+MARD_COLORS\s*:\s*MardColor\s*\[\s*\]\s*=\s*\["
)
_COLOR_PATTERN = re.compile(
    r"\{\s*code:\s*\"(?P<code>[^\"]+)\"[^{}]*?"
    r"hex:\s*\"(?P<hex>#[0-9A-Fa-f]{6})\"[^{}]*?"
    r"rgb:\s*\[\s*(?P<red>\d+)\s*,\s*(?P<green>\d+)\s*,\s*(?P<blue>\d+)\s*\]"
    r"[^{}]*?\}",
    re.DOTALL,
)
_MARD221_GROUP_PATTERN = re.compile(
    r"\{\s*id:\s*\"mard221\"[^{}]*?series:\s*\[(?P<series>[^\]]+)\][^{}]*?\}",
    re.DOTALL,
)
_DEFAULT_BLUEPRINT_FONT = ImageFont.load_default()
_REFERENCE_IMPROVEMENT_EPSILON = 1e-6


Cell: TypeAlias = int | None
Grid: TypeAlias = list[list[Cell]]
ReferenceGrid: TypeAlias = list[list[tuple[int, int, int]]]
Point: TypeAlias = tuple[float, float]
Polygon: TypeAlias = list[Point]


class CanvasSize(TypedDict):
    width: int
    height: int


class Layer(TypedDict):
    data: Grid
    visible: bool
    id: NotRequired[str]
    name: NotRequired[str]
    opacity: NotRequired[float]


class GridConfig(TypedDict, total=False):
    groupSize: int
    edgePadding: int
    startX: int
    startY: int
    visible: bool
    lineColor: str
    lineWidth: float
    groupLineColor: str
    groupLineWidth: float


class ProjectInfo(TypedDict, total=False):
    title: str
    author: str
    description: str
    link: str


class Project(TypedDict):
    version: int
    canvasSize: CanvasSize
    canvasData: Grid
    layers: list[Layer]
    paletteSize: NotRequired[int]
    metadata: NotRequired[dict[str, object]]
    gridConfig: NotRequired[GridConfig]
    projectInfo: NotRequired[ProjectInfo]
    createdAt: NotRequired[str]
    updatedAt: NotRequired[str]


@dataclass(frozen=True)
class PaletteColor:
    index: int
    code: str
    hex: str
    rgb: tuple[int, int, int]
    lab: tuple[float, float, float]


@dataclass(frozen=True)
class CleanupProfile:
    """Frequency and safety limits for deterministic cleanup passes."""

    name: str
    rare_count: int
    max_component: int
    max_palette_delta_e: float
    max_reference_increase: float
    neighbor_dominance: float
    passes: int

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name:
            raise ValueError("profile name must be a non-empty string")
        for field_name in ("rare_count", "max_component", "passes"):
            value = getattr(self, field_name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{field_name} must be a non-negative integer")
        for field_name in ("max_palette_delta_e", "max_reference_increase"):
            value = getattr(self, field_name)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
            ):
                raise ValueError(f"{field_name} must be a non-negative finite number")
        if (
            isinstance(self.neighbor_dominance, bool)
            or not isinstance(self.neighbor_dominance, (int, float))
            or not math.isfinite(self.neighbor_dominance)
            or not 0 <= self.neighbor_dominance <= 1
        ):
            raise ValueError("neighbor_dominance must be between 0 and 1")


@dataclass(frozen=True)
class AutoProtectionMasks:
    """Automatic protection split into immutable and reference-gated cells."""

    hard: list[list[bool]]
    junction_only: list[list[bool]]

    @property
    def union(self) -> list[list[bool]]:
        return [
            [hard or junction for hard, junction in zip(hard_row, junction_row)]
            for hard_row, junction_row in zip(self.hard, self.junction_only)
        ]


def is_h1_bead(cell: Cell, palette: list[PaletteColor]) -> bool:
    """Return whether a populated palette cell is the see-through H1 bead."""
    return (
        not isinstance(cell, bool)
        and isinstance(cell, int)
        and 0 <= cell < len(palette)
        and palette[cell].code == "H1"
    )


def point_in_polygon(x: float, y: float, polygon: Polygon) -> bool:
    """Return whether a point is inside a polygon, treating its boundary as inside."""
    if len(polygon) < 3:
        return False

    inside = False
    previous_x, previous_y = polygon[-1]
    for current_x, current_y in polygon:
        cross = (x - previous_x) * (current_y - previous_y) - (
            y - previous_y
        ) * (current_x - previous_x)
        on_segment = (
            abs(cross) <= 1e-9
            and min(previous_x, current_x) - 1e-9
            <= x
            <= max(previous_x, current_x) + 1e-9
            and min(previous_y, current_y) - 1e-9
            <= y
            <= max(previous_y, current_y) + 1e-9
        )
        if on_segment:
            return True

        if (current_y > y) != (previous_y > y):
            intersection_x = (previous_x - current_x) * (y - current_y) / (
                previous_y - current_y
            ) + current_x
            if x < intersection_x:
                inside = not inside
        previous_x, previous_y = current_x, current_y
    return inside


def build_mask(
    width: int,
    height: int,
    polygons: list[Polygon],
) -> list[list[bool]]:
    """Build a union mask by testing grid cell centers against `(col, row)` polygons."""
    if isinstance(width, bool) or not isinstance(width, int) or width <= 0:
        raise ValueError("width must be a positive integer")
    if isinstance(height, bool) or not isinstance(height, int) or height <= 0:
        raise ValueError("height must be a positive integer")
    return [
        [
            any(
                point_in_polygon(column + 0.5, row + 0.5, polygon)
                for polygon in polygons
            )
            for column in range(width)
        ]
        for row in range(height)
    ]


def sample_reference_grid(
    image: Image.Image,
    width: int,
    height: int,
    inset: float = 0.22,
) -> ReferenceGrid:
    """Sample median RGB values from inset interiors of proportional grid cells."""
    if isinstance(width, bool) or not isinstance(width, int) or width <= 0:
        raise ValueError("width must be a positive integer")
    if isinstance(height, bool) or not isinstance(height, int) or height <= 0:
        raise ValueError("height must be a positive integer")
    if (
        isinstance(inset, bool)
        or not isinstance(inset, (int, float))
        or not 0 <= inset < 0.5
    ):
        raise ValueError("inset must be at least 0 and less than 0.5")
    if image.width <= 0 or image.height <= 0:
        raise ValueError("source image dimensions must be positive")

    rgb_image = image.convert("RGB")
    cell_width = rgb_image.width / width
    cell_height = rgb_image.height / height
    sampled: ReferenceGrid = []
    for row in range(height):
        sampled_row: list[tuple[int, int, int]] = []
        for column in range(width):
            inner_left = (column + inset) * cell_width
            inner_top = (row + inset) * cell_height
            inner_right = (column + 1 - inset) * cell_width
            inner_bottom = (row + 1 - inset) * cell_height
            left = max(0, math.ceil(inner_left - 0.5))
            top = max(0, math.ceil(inner_top - 0.5))
            right = min(rgb_image.width, math.ceil(inner_right - 0.5))
            bottom = min(rgb_image.height, math.ceil(inner_bottom - 0.5))
            if left >= right:
                center_column = min(
                    rgb_image.width - 1,
                    max(0, math.floor((column + 0.5) * cell_width)),
                )
                left, right = center_column, center_column + 1
            if top >= bottom:
                center_row = min(
                    rgb_image.height - 1,
                    max(0, math.floor((row + 0.5) * cell_height)),
                )
                top, bottom = center_row, center_row + 1
            median = ImageStat.Stat(rgb_image.crop((left, top, right, bottom))).median
            sampled_row.append(tuple(int(component) for component in median))
        sampled.append(sampled_row)
    return sampled


def _rectangular_shape(grid: object, name: str) -> tuple[int, int]:
    if not isinstance(grid, list):
        raise ValueError(f"{name} must be a list of rows")
    if not grid:
        return 0, 0
    if not isinstance(grid[0], list):
        raise ValueError(f"{name}[0] must be a list")
    width = len(grid[0])
    for row_index, row in enumerate(grid):
        if not isinstance(row, list):
            raise ValueError(f"{name}[{row_index}] must be a list")
        if len(row) != width:
            raise ValueError(f"{name} must be rectangular")
    return width, len(grid)


def assert_protected_unchanged(
    before: list[list[object]],
    after: list[list[object]],
    mask: list[list[bool]],
) -> None:
    """Raise if any protected `(col, row)` cell differs between equal grids."""
    before_shape = _rectangular_shape(before, "before")
    after_shape = _rectangular_shape(after, "after")
    mask_shape = _rectangular_shape(mask, "mask")
    if before_shape != after_shape or before_shape != mask_shape:
        raise ValueError(
            f"before, after, and mask shapes must match: "
            f"{before_shape}, {after_shape}, {mask_shape}"
        )
    for row_index, mask_row in enumerate(mask):
        for column_index, protected in enumerate(mask_row):
            if not isinstance(protected, bool):
                raise ValueError(f"mask[{row_index}][{column_index}] must be boolean")
            if (
                protected
                and before[row_index][column_index] != after[row_index][column_index]
            ):
                raise AssertionError(
                    f"protected cell changed at ({column_index},{row_index}): "
                    f"{before[row_index][column_index]!r} -> {after[row_index][column_index]!r}"
                )


def render_mask_overlay(
    grid: Grid,
    palette: list[PaletteColor],
    mask: list[list[bool]],
    cell_size: int = 12,
) -> Image.Image:
    """Render palette cells with a tint and perimeter around the protected union."""
    width, height = _validate_render_inputs(grid, palette, cell_size)
    if _rectangular_shape(mask, "mask") != (width, height):
        raise ValueError("grid and mask shapes must match")

    image = Image.new("RGBA", (width * cell_size, height * cell_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tint = (255, 96, 48)
    outline = (255, 215, 0, 255)
    outline_width = max(1, min(3, cell_size // 6))
    for row_index, row in enumerate(grid):
        for column_index, cell in enumerate(row):
            protected = mask[row_index][column_index]
            if not isinstance(protected, bool):
                raise ValueError(f"mask[{row_index}][{column_index}] must be boolean")
            if cell is None:
                continue
            left = column_index * cell_size
            top = row_index * cell_size
            bounds = (left, top, left + cell_size - 1, top + cell_size - 1)
            if is_h1_bead(cell, palette):
                _draw_h1_marker(
                    draw,
                    bounds,
                    color=(255, 96, 48, 190) if protected else (80, 80, 80, 153),
                )
                continue
            rgb = palette[cell].rgb
            if protected:
                rgb = tuple(
                    round(component * 0.72 + tint_component * 0.28)
                    for component, tint_component in zip(rgb, tint)
                )
            draw.rectangle(bounds, fill=(*rgb, 255))
    for row_index, mask_row in enumerate(mask):
        for column_index, protected in enumerate(mask_row):
            if not isinstance(protected, bool):
                raise ValueError(f"mask[{row_index}][{column_index}] must be boolean")
            if not protected or grid[row_index][column_index] is None:
                continue
            left = column_index * cell_size
            top = row_index * cell_size
            right = left + cell_size - 1
            bottom = top + cell_size - 1
            edges = (
                (row_index == 0 or not mask[row_index - 1][column_index], (left, top, right, top)),
                (
                    row_index == height - 1 or not mask[row_index + 1][column_index],
                    (left, bottom, right, bottom),
                ),
                (column_index == 0 or not mask[row_index][column_index - 1], (left, top, left, bottom)),
                (
                    column_index == width - 1 or not mask[row_index][column_index + 1],
                    (right, top, right, bottom),
                ),
            )
            for visible, edge in edges:
                if visible:
                    draw.line(edge, fill=outline, width=outline_width)
    return image


def rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    """Convert an 8-bit sRGB color to CIE L*a*b* using a D65 white point."""
    _validate_rgb(rgb, "rgb")

    def linearize(component: int) -> float:
        channel = component / 255.0
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    red, green, blue = (linearize(component) for component in rgb)
    x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047
    y = red * 0.2126729 + green * 0.7151522 + blue * 0.0721750
    z = (red * 0.0193339 + green * 0.1191920 + blue * 0.9503041) / 1.08883

    def pivot(value: float) -> float:
        epsilon = 216 / 24389
        kappa = 24389 / 27
        return value ** (1 / 3) if value > epsilon else (kappa * value + 16) / 116

    fx, fy, fz = pivot(x), pivot(y), pivot(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


# Retain the original private spelling for compatibility with the foundational API.
_rgb_to_lab = rgb_to_lab


def delta_e(
    first: tuple[float, float, float],
    second: tuple[float, float, float],
) -> float:
    """Return the deterministic CIE76 distance between two Lab colors."""
    if len(first) != 3 or len(second) != 3:
        raise ValueError("Lab colors must contain exactly three components")
    if any(
        isinstance(component, bool)
        or not isinstance(component, (int, float))
        or not math.isfinite(component)
        for component in (*first, *second)
    ):
        raise ValueError("Lab components must be finite numbers")
    return math.sqrt(sum((left - right) ** 2 for left, right in zip(first, second)))


def _validate_rgb(rgb: object, name: str) -> None:
    if not isinstance(rgb, tuple) or len(rgb) != 3:
        raise ValueError(f"{name} must be an RGB tuple")
    if any(
        isinstance(component, bool)
        or not isinstance(component, int)
        or not 0 <= component <= 255
        for component in rgb
    ):
        raise ValueError(f"{name} components must be integers between 0 and 255")


def color_family(rgb: tuple[int, int, int]) -> str:
    """Classify portrait colors using fixed chroma, luma, and hue thresholds.

    Chroma at or below 0.12 is neutral; Rec. 709 luma below 0.50 divides
    neutral-dark from neutral-light. Chromatic hues in [170, 285) degrees are
    blue, hues in [285, 360) or [0, 15) are pink, and the remaining warm hues
    are skin. The final bucket intentionally covers portrait accent colors that
    fall outside the two narrower hue arcs.
    """
    _validate_rgb(rgb, "rgb")
    red, green, blue = (component / 255.0 for component in rgb)
    hue, _saturation, _value = colorsys.rgb_to_hsv(red, green, blue)
    chroma = max(red, green, blue) - min(red, green, blue)
    luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    if chroma <= 0.12:
        return "neutral-dark" if luma < 0.50 else "neutral-light"
    degrees = hue * 360.0
    if 170.0 <= degrees < 285.0:
        return "blue"
    if degrees >= 285.0 or degrees < 15.0:
        return "pink"
    return "skin"


def _validate_region_hints(region_hints: object) -> None:
    if not isinstance(region_hints, Mapping):
        raise ValueError("region_hints must be a mapping")
    for name, polygon in region_hints.items():
        if not isinstance(name, str) or not name:
            raise ValueError("region hint names must be non-empty strings")
        if not isinstance(polygon, list):
            raise ValueError(f"region hint {name!r} must be a polygon list")
        for point in polygon:
            if (
                not isinstance(point, tuple)
                or len(point) != 2
                or any(
                    isinstance(coordinate, bool)
                    or not isinstance(coordinate, (int, float))
                    or not math.isfinite(coordinate)
                    for coordinate in point
                )
            ):
                raise ValueError(f"region hint {name!r} contains an invalid point")


def semantic_region(
    row: int,
    col: int,
    color: tuple[int, int, int],
    region_hints: Mapping[str, Polygon],
    *,
    code: str | None = None,
) -> tuple[str, str]:
    """Return ``(color family, spatial hint)`` for a cell.

    Mapping insertion order is the documented priority for overlapping hints;
    the first polygon containing the cell center wins.
    """
    if isinstance(row, bool) or not isinstance(row, int) or row < 0:
        raise ValueError("row must be a non-negative integer")
    if isinstance(col, bool) or not isinstance(col, int) or col < 0:
        raise ValueError("col must be a non-negative integer")
    _validate_region_hints(region_hints)
    hint = "unhinted"
    for name, polygon in region_hints.items():
        if point_in_polygon(col + 0.5, row + 0.5, polygon):
            hint = name
            break
    return ("transparent-bead" if code == "H1" else color_family(color)), hint


_NEIGHBORS_4 = ((-1, 0), (0, -1), (0, 1), (1, 0))
_NEIGHBORS_8 = tuple(
    (row_offset, col_offset)
    for row_offset in (-1, 0, 1)
    for col_offset in (-1, 0, 1)
    if row_offset or col_offset
)


def _validate_grid_cells(grid: object, palette_size: int | None = None) -> tuple[int, int]:
    width, height = _rectangular_shape(grid, "grid")
    for row_index, row in enumerate(grid):
        for col_index, cell in enumerate(row):
            if cell is None:
                continue
            if isinstance(cell, bool) or not isinstance(cell, int) or cell < 0:
                raise ValueError(
                    f"grid[{row_index}][{col_index}] must be a non-negative palette index or None"
                )
            if palette_size is not None and cell >= palette_size:
                raise ValueError(
                    f"grid[{row_index}][{col_index}] has invalid palette index {cell}"
                )
    return width, height


def connected_components(grid: Grid) -> list[list[tuple[int, int]]]:
    """Return same-color 4-connected components as row/column coordinates.

    Both components and coordinates within each component are ordered row-major.
    Transparent cells are omitted.
    """
    width, height = _validate_grid_cells(grid)
    visited: set[tuple[int, int]] = set()
    components: list[list[tuple[int, int]]] = []
    for row in range(height):
        for col in range(width):
            if grid[row][col] is None or (row, col) in visited:
                continue
            source = grid[row][col]
            queue = deque([(row, col)])
            visited.add((row, col))
            component: list[tuple[int, int]] = []
            while queue:
                current_row, current_col = queue.popleft()
                component.append((current_row, current_col))
                for row_offset, col_offset in _NEIGHBORS_4:
                    neighbor_row = current_row + row_offset
                    neighbor_col = current_col + col_offset
                    coordinate = (neighbor_row, neighbor_col)
                    if (
                        0 <= neighbor_row < height
                        and 0 <= neighbor_col < width
                        and coordinate not in visited
                        and grid[neighbor_row][neighbor_col] == source
                    ):
                        visited.add(coordinate)
                        queue.append(coordinate)
            components.append(sorted(component))
    return components


def _validate_palette(palette: object) -> None:
    if not isinstance(palette, list) or not palette:
        raise ValueError("palette must be a non-empty list")
    for position, color in enumerate(palette):
        if not isinstance(color, PaletteColor):
            raise ValueError(f"palette[{position}] must be a PaletteColor")
        if color.index != position:
            raise ValueError(f"palette[{position}] index must equal its list position")
        _validate_rgb(color.rgb, f"palette[{position}].rgb")
        delta_e(color.lab, color.lab)


def _validate_cell_size(cell_size: object) -> int:
    if isinstance(cell_size, bool) or not isinstance(cell_size, int) or cell_size <= 0:
        raise ValueError("cell_size must be a positive integer")
    return cell_size


def _validate_render_inputs(
    grid: Grid,
    palette: list[PaletteColor],
    cell_size: object,
) -> tuple[int, int]:
    _validate_palette(palette)
    width, height = _validate_grid_cells(grid, len(palette))
    if width == 0 or height == 0:
        raise ValueError("grid must contain at least one cell")
    _validate_cell_size(cell_size)
    return width, height


def _draw_h1_marker(
    draw: ImageDraw.ImageDraw,
    bounds: tuple[int, int, int, int],
    *,
    color: tuple[int, int, int, int] = (80, 80, 80, 153),
) -> None:
    left, top, right, bottom = bounds
    width = right - left + 1
    height = bottom - top + 1
    pad_x = max(1, round(width * 0.12))
    pad_y = max(1, round(height * 0.12))
    line_width = max(1, round(min(width, height) * 0.08))
    draw.line(
        (left + pad_x, top + pad_y, right - pad_x, bottom - pad_y),
        fill=color,
        width=line_width,
    )
    if min(width, height) >= 6:
        draw.line(
            (right - pad_x, top + pad_y, left + pad_x, bottom - pad_y),
            fill=color,
            width=line_width,
        )


def _draw_fitted_code(
    image: Image.Image,
    bounds: tuple[int, int, int, int],
    code: str,
    fill: tuple[int, int, int, int],
    font: ImageFont.ImageFont,
) -> None:
    left, top, right, bottom = bounds
    available_width = max(1, right - left - 3)
    available_height = max(1, bottom - top - 3)
    probe = Image.new("L", (1, 1))
    probe_draw = ImageDraw.Draw(probe)
    text_bounds = probe_draw.textbbox((0, 0), code, font=font)
    text_width = max(1, text_bounds[2] - text_bounds[0])
    text_height = max(1, text_bounds[3] - text_bounds[1])
    mask = Image.new("L", (text_width, text_height), 0)
    ImageDraw.Draw(mask).text(
        (-text_bounds[0], -text_bounds[1]),
        code,
        font=font,
        fill=255,
    )
    if mask.width > available_width or mask.height > available_height:
        mask.thumbnail(
            (available_width, available_height),
            Image.Resampling.LANCZOS,
        )
    x = left + ((right - left + 1) - mask.width) // 2
    y = top + ((bottom - top + 1) - mask.height) // 2
    image.paste(fill, (x, y), mask)


def compute_metrics(
    before: Grid,
    after: Grid,
    reference: ReferenceGrid,
    palette: list[PaletteColor],
) -> dict[str, int | float]:
    """Compute stable summary metrics for a cleanup candidate."""
    _validate_palette(palette)
    width, height = _validate_grid_cells(before, len(palette))
    if width == 0 or height == 0:
        raise ValueError("before must contain at least one cell")
    if _validate_grid_cells(after, len(palette)) != (width, height):
        raise ValueError("before and after shapes must match")
    if _rectangular_shape(reference, "reference") != (width, height):
        raise ValueError("grid and reference shapes must match")
    for row_index, row in enumerate(reference):
        for column_index, rgb in enumerate(row):
            _validate_rgb(rgb, f"reference[{row_index}][{column_index}]")

    before_counts = Counter(cell for row in before for cell in row if cell is not None)
    after_counts = Counter(cell for row in after for cell in row if cell is not None)

    def mean_reference_error(grid: Grid) -> float:
        errors = [
            delta_e(rgb_to_lab(reference[row][column]), palette[cell].lab)
            for row in range(height)
            for column in range(width)
            if (cell := grid[row][column]) is not None
        ]
        value = sum(errors) / len(errors) if errors else 0.0
        rounded = round(value, 6)
        return 0.0 if rounded == 0 else rounded

    return {
        "unique_colors_before": len(before_counts),
        "unique_colors_after": len(after_counts),
        "changed_cells": sum(
            before[row][column] != after[row][column]
            for row in range(height)
            for column in range(width)
        ),
        "colors_used_1_to_3": sum(1 <= count <= 3 for count in after_counts.values()),
        "components_size_1_to_2": sum(
            1 <= len(component) <= 2 for component in connected_components(after)
        ),
        "mean_reference_delta_e_before": mean_reference_error(before),
        "mean_reference_delta_e_after": mean_reference_error(after),
        "non_empty_before": sum(before_counts.values()),
        "non_empty_after": sum(after_counts.values()),
    }


def render_plain(
    grid: Grid,
    palette: list[PaletteColor],
    cell_size: int = 12,
) -> Image.Image:
    """Render a grid without guides, preserving transparent cells."""
    width, height = _validate_render_inputs(grid, palette, cell_size)
    image = Image.new("RGBA", (width * cell_size, height * cell_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for row_index, row in enumerate(grid):
        for column_index, cell in enumerate(row):
            if cell is None:
                continue
            left = column_index * cell_size
            top = row_index * cell_size
            bounds = (left, top, left + cell_size - 1, top + cell_size - 1)
            if is_h1_bead(cell, palette):
                _draw_h1_marker(draw, bounds)
                continue
            draw.rectangle(
                bounds,
                fill=(*palette[cell].rgb, 255),
            )
    return image


def render_blueprint(
    grid: Grid,
    palette: list[PaletteColor],
    cell_size: int = 20,
) -> Image.Image:
    """Render palette fills, MARD codes, and five-cell blueprint guides."""
    width, height = _validate_render_inputs(grid, palette, cell_size)
    pixel_width = width * cell_size
    pixel_height = height * cell_size
    image = Image.new("RGBA", (pixel_width, pixel_height), (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    font_size = max(8, round(cell_size * 0.46))
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", font_size)
    except OSError:
        font = _DEFAULT_BLUEPRINT_FONT

    for row_index, row in enumerate(grid):
        for column_index, cell in enumerate(row):
            if cell is None:
                continue
            left = column_index * cell_size
            top = row_index * cell_size
            color = palette[cell]
            bounds = (left, top, left + cell_size - 1, top + cell_size - 1)
            if is_h1_bead(cell, palette):
                _draw_h1_marker(draw, bounds, color=(80, 80, 80, 153))
            else:
                draw.rectangle(bounds, fill=(*color.rgb, 255))
            luminance = sum(weight * component for weight, component in zip((0.299, 0.587, 0.114), color.rgb))
            ink = (20, 20, 20, 255) if luminance >= 145 else (255, 255, 255, 255)
            _draw_fitted_code(image, bounds, color.code, ink, font)

    thin = (50, 60, 70, 150)
    heavy = (20, 25, 30, 230)
    heavy_width = max(2, min(3, cell_size // 7))
    for column in range(width + 1):
        coordinate = min(column * cell_size, pixel_width - 1)
        is_group = column % 5 == 0
        draw.line(
            (coordinate, 0, coordinate, pixel_height - 1),
            fill=heavy if is_group else thin,
            width=heavy_width if is_group else 1,
        )
    for row in range(height + 1):
        coordinate = min(row * cell_size, pixel_height - 1)
        is_group = row % 5 == 0
        draw.line(
            (0, coordinate, pixel_width - 1, coordinate),
            fill=heavy if is_group else thin,
            width=heavy_width if is_group else 1,
        )
    return image


def render_heatmap(
    before: Grid,
    after: Grid,
    palette: list[PaletteColor],
    cell_size: int = 12,
) -> Image.Image:
    """Render unchanged subject cells faintly and all differences in red."""
    width, height = _validate_render_inputs(before, palette, cell_size)
    if _validate_grid_cells(after, len(palette)) != (width, height):
        raise ValueError("before and after shapes must match")
    image = Image.new("RGBA", (width * cell_size, height * cell_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for row in range(height):
        for column in range(width):
            old_cell = before[row][column]
            new_cell = after[row][column]
            if old_cell == new_cell:
                if old_cell is None:
                    continue
                left = column * cell_size
                top = row * cell_size
                bounds = (left, top, left + cell_size - 1, top + cell_size - 1)
                if is_h1_bead(old_cell, palette):
                    _draw_h1_marker(draw, bounds, color=(80, 80, 80, 76))
                    continue
                fill = (*palette[old_cell].rgb, 76)
            else:
                fill = (255, 0, 0, 255)
            left = column * cell_size
            top = row * cell_size
            draw.rectangle(
                (left, top, left + cell_size - 1, top + cell_size - 1),
                fill=fill,
            )
    return image


def _validate_refinement_inputs(
    grid: Grid,
    reference: ReferenceGrid,
    palette: list[PaletteColor],
    protected: list[list[bool]],
    region_hints: Mapping[str, Polygon],
    profile: CleanupProfile,
) -> tuple[int, int]:
    _validate_palette(palette)
    width, height = _validate_grid_cells(grid, len(palette))
    if _rectangular_shape(reference, "reference") != (width, height):
        raise ValueError("grid and reference shapes must match")
    if _rectangular_shape(protected, "protected") != (width, height):
        raise ValueError("grid and protected mask shapes must match")
    for row_index, row in enumerate(reference):
        for col_index, rgb in enumerate(row):
            _validate_rgb(rgb, f"reference[{row_index}][{col_index}]")
    for row_index, row in enumerate(protected):
        for col_index, value in enumerate(row):
            if not isinstance(value, bool):
                raise ValueError(f"protected[{row_index}][{col_index}] must be boolean")
    _validate_region_hints(region_hints)
    if not isinstance(profile, CleanupProfile):
        raise ValueError("profile must be a CleanupProfile")
    return width, height


def build_auto_protection_masks(
    grid: Grid,
    palette: list[PaletteColor],
    threshold: float = 28.0,
) -> AutoProtectionMasks:
    """Classify immutable auto protection and junction-only soft protection."""
    _validate_palette(palette)
    width, height = _validate_grid_cells(grid, len(palette))
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not math.isfinite(threshold)
        or threshold < 0
    ):
        raise ValueError("threshold must be a non-negative finite number")

    component_sizes: dict[tuple[int, int], int] = {}
    for component in connected_components(grid):
        for coordinate in component:
            component_sizes[coordinate] = len(component)

    hard = [[False for _ in range(width)] for _ in range(height)]
    junction_only = [[False for _ in range(width)] for _ in range(height)]
    for row in range(height):
        for col in range(width):
            source = grid[row][col]
            if source is None:
                continue
            if is_h1_bead(source, palette):
                hard[row][col] = True
                continue
            borders_subject = False
            four_neighbors: list[int] = []
            for row_offset, col_offset in _NEIGHBORS_4:
                neighbor_row = row + row_offset
                neighbor_col = col + col_offset
                if 0 <= neighbor_row < height and 0 <= neighbor_col < width:
                    neighbor = grid[neighbor_row][neighbor_col]
                    if neighbor is None:
                        borders_subject = True
                    else:
                        four_neighbors.append(neighbor)

            dark_contrast = palette[source].lab[0] < 38 and any(
                delta_e(palette[source].lab, palette[neighbor].lab) >= threshold
                for neighbor in four_neighbors
            )
            neighborhood_colors = {
                grid[neighbor_row][neighbor_col]
                for neighbor_row in range(max(0, row - 1), min(height, row + 2))
                for neighbor_col in range(max(0, col - 1), min(width, col + 2))
                if grid[neighbor_row][neighbor_col] is not None
            }
            color_list = sorted(neighborhood_colors)
            span = max(
                (
                    delta_e(palette[left].lab, palette[right].lab)
                    for index, left in enumerate(color_list)
                    for right in color_list[index + 1 :]
                ),
                default=0.0,
            )
            color_junction = (
                len(color_list) >= 3
                and span >= 25.0
                and component_sizes[(row, col)] <= 6
            )
            hard[row][col] = borders_subject or dark_contrast
            junction_only[row][col] = color_junction and not hard[row][col]
    return AutoProtectionMasks(hard=hard, junction_only=junction_only)


def build_auto_protection_mask(
    grid: Grid,
    palette: list[PaletteColor],
    threshold: float = 28.0,
) -> list[list[bool]]:
    """Return the full automatic protection union for overlays and compatibility."""
    return build_auto_protection_masks(grid, palette, threshold).union


def _neighbor_cells(
    row: int,
    col: int,
    width: int,
    height: int,
) -> list[tuple[int, int]]:
    return [
        (row + row_offset, col + col_offset)
        for row_offset, col_offset in _NEIGHBORS_8
        if 0 <= row + row_offset < height and 0 <= col + col_offset < width
    ]


def _select_cell_candidate(
    grid: Grid,
    reference: ReferenceGrid,
    palette: list[PaletteColor],
    region_hints: Mapping[str, Polygon],
    profile: CleanupProfile,
    counts: Counter[int],
    row: int,
    col: int,
    width: int,
    height: int,
    require_reference_improvement: bool = False,
) -> int | None:
    source = grid[row][col]
    assert source is not None
    source_region = semantic_region(
        row,
        col,
        palette[source].rgb,
        region_hints,
        code=palette[source].code,
    )
    eligible = [
        (neighbor_row, neighbor_col, grid[neighbor_row][neighbor_col])
        for neighbor_row, neighbor_col in _neighbor_cells(row, col, width, height)
        if grid[neighbor_row][neighbor_col] is not None
        and semantic_region(
            neighbor_row,
            neighbor_col,
            palette[grid[neighbor_row][neighbor_col]].rgb,
            region_hints,
            code=palette[grid[neighbor_row][neighbor_col]].code,
        )
        == source_region
    ]
    if not eligible:
        return None

    reference_lab = rgb_to_lab(reference[row][col])
    old_error = delta_e(reference_lab, palette[source].lab)
    accepted: list[tuple[float, int]] = []
    for candidate in sorted({cell for _, _, cell in eligible if cell != source}):
        candidate_cells = [item for item in eligible if item[2] == candidate]
        if counts[candidate] <= counts[source]:
            continue
        palette_distance = delta_e(palette[source].lab, palette[candidate].lab)
        if palette_distance > profile.max_palette_delta_e:
            continue
        reference_error = delta_e(reference_lab, palette[candidate].lab)
        if reference_error - old_error > profile.max_reference_increase:
            continue
        if (
            require_reference_improvement
            and reference_error > old_error - _REFERENCE_IMPROVEMENT_EPSILON
        ):
            continue
        touching_neighbors = len(candidate_cells)
        if touching_neighbors / len(eligible) < profile.neighbor_dominance:
            continue
        score = reference_error + 0.35 * palette_distance - 1.5 * touching_neighbors
        accepted.append((score, candidate))
    return min(accepted, default=(0.0, None), key=lambda item: (item[0], item[1]))[1]


def _validated_soft_mask(
    soft_protected: list[list[bool]] | None,
    width: int,
    height: int,
) -> list[list[bool]]:
    if soft_protected is None:
        return [[False for _ in range(width)] for _ in range(height)]
    if _rectangular_shape(soft_protected, "soft_protected") != (width, height):
        raise ValueError("grid and soft protection mask shapes must match")
    for row_index, row_values in enumerate(soft_protected):
        for col_index, value in enumerate(row_values):
            if not isinstance(value, bool):
                raise ValueError(
                    f"soft_protected[{row_index}][{col_index}] must be boolean"
                )
    return soft_protected


def merge_rare_cells(
    grid: Grid,
    reference: ReferenceGrid,
    palette: list[PaletteColor],
    protected: list[list[bool]],
    region_hints: Mapping[str, Polygon],
    profile: CleanupProfile,
    soft_protected: list[list[bool]] | None = None,
) -> Grid:
    """Batch-merge rare cells into eligible, locally dominant colors."""
    width, height = _validate_refinement_inputs(
        grid, reference, palette, protected, region_hints, profile
    )
    soft_protected = _validated_soft_mask(soft_protected, width, height)
    snapshot = [row.copy() for row in grid]
    result = [row.copy() for row in snapshot]
    counts = Counter(cell for row in snapshot for cell in row if cell is not None)
    deferred_soft_cells = {
        coordinate
        for component in connected_components(snapshot)
        if len(component) > 1
        and any(soft_protected[row][col] for row, col in component)
        for coordinate in component
    }
    decisions: list[tuple[int, int, int]] = []
    for row in range(height):
        for col in range(width):
            source = snapshot[row][col]
            if (
                source is None
                or protected[row][col]
                or (row, col) in deferred_soft_cells
                or counts[source] > profile.rare_count
            ):
                continue
            candidate = _select_cell_candidate(
                snapshot,
                reference,
                palette,
                region_hints,
                profile,
                counts,
                row,
                col,
                width,
                height,
                soft_protected[row][col],
            )
            if candidate is not None:
                decisions.append((row, col, candidate))
    for row, col, candidate in decisions:
        result[row][col] = candidate
    return result


def _select_component_candidate(
    grid: Grid,
    reference: ReferenceGrid,
    palette: list[PaletteColor],
    region_hints: Mapping[str, Polygon],
    profile: CleanupProfile,
    counts: Counter[int],
    component: list[tuple[int, int]],
    width: int,
    height: int,
    require_reference_improvement: bool = False,
) -> int | None:
    source = grid[component[0][0]][component[0][1]]
    assert source is not None
    component_set = set(component)
    eligible_by_coordinate: dict[tuple[int, int], int] = {}
    for row, col in component:
        source_region = semantic_region(
            row,
            col,
            palette[source].rgb,
            region_hints,
            code=palette[source].code,
        )
        for neighbor_row, neighbor_col in _neighbor_cells(row, col, width, height):
            if (neighbor_row, neighbor_col) in component_set:
                continue
            neighbor = grid[neighbor_row][neighbor_col]
            if neighbor is None:
                continue
            if (
                semantic_region(
                    neighbor_row,
                    neighbor_col,
                    palette[neighbor].rgb,
                    region_hints,
                    code=palette[neighbor].code,
                )
                == source_region
            ):
                eligible_by_coordinate[(neighbor_row, neighbor_col)] = neighbor
    if not eligible_by_coordinate:
        return None

    old_errors = {
        coordinate: delta_e(
            rgb_to_lab(reference[coordinate[0]][coordinate[1]]),
            palette[source].lab,
        )
        for coordinate in component
    }
    accepted: list[tuple[float, int]] = []
    for candidate in sorted(set(eligible_by_coordinate.values()) - {source}):
        candidate_coordinates = [
            coordinate
            for coordinate, color in eligible_by_coordinate.items()
            if color == candidate
        ]
        if counts[candidate] <= counts[source]:
            continue
        palette_distance = delta_e(palette[source].lab, palette[candidate].lab)
        if palette_distance > profile.max_palette_delta_e:
            continue
        reference_errors = [
            delta_e(rgb_to_lab(reference[row][col]), palette[candidate].lab)
            for row, col in component
        ]
        if any(
            error - old_errors[coordinate] > profile.max_reference_increase
            for coordinate, error in zip(component, reference_errors)
        ):
            continue
        if require_reference_improvement and any(
            error > old_errors[coordinate] - _REFERENCE_IMPROVEMENT_EPSILON
            for coordinate, error in zip(component, reference_errors)
        ):
            continue
        touching_neighbors = len(candidate_coordinates)
        if (
            touching_neighbors / len(eligible_by_coordinate)
            < profile.neighbor_dominance
        ):
            continue
        reference_error = sum(reference_errors)
        score = reference_error + 0.35 * palette_distance - 1.5 * touching_neighbors
        accepted.append((score, candidate))
    return min(accepted, default=(0.0, None), key=lambda item: (item[0], item[1]))[1]


def cleanup_components(
    grid: Grid,
    reference: ReferenceGrid,
    palette: list[PaletteColor],
    protected: list[list[bool]],
    region_hints: Mapping[str, Polygon],
    profile: CleanupProfile,
    soft_protected: list[list[bool]] | None = None,
) -> Grid:
    """Batch-recolor eligible small same-color components from their boundary."""
    width, height = _validate_refinement_inputs(
        grid, reference, palette, protected, region_hints, profile
    )
    soft_protected = _validated_soft_mask(soft_protected, width, height)
    snapshot = [row.copy() for row in grid]
    result = [row.copy() for row in snapshot]
    counts = Counter(cell for row in snapshot for cell in row if cell is not None)
    decisions: list[tuple[list[tuple[int, int]], int]] = []
    for component in connected_components(snapshot):
        if len(component) > profile.max_component:
            continue
        if any(protected[row][col] for row, col in component):
            continue
        source = snapshot[component[0][0]][component[0][1]]
        assert source is not None
        component_regions = {
            semantic_region(
                row,
                col,
                palette[source].rgb,
                region_hints,
                code=palette[source].code,
            )
            for row, col in component
        }
        if len(component_regions) != 1:
            continue
        candidate = _select_component_candidate(
            snapshot,
            reference,
            palette,
            region_hints,
            profile,
            counts,
            component,
            width,
            height,
            any(soft_protected[row][col] for row, col in component),
        )
        if candidate is not None:
            decisions.append((component, candidate))
    for component, candidate in decisions:
        for row, col in component:
            result[row][col] = candidate
    return result


def refine_grid(
    grid: Grid,
    reference: ReferenceGrid,
    palette: list[PaletteColor],
    protected: list[list[bool]],
    region_hints: Mapping[str, Polygon],
    profile: CleanupProfile,
) -> Grid:
    """Apply auto protection once, then deterministic rare/component passes."""
    width, height = _validate_refinement_inputs(
        grid, reference, palette, protected, region_hints, profile
    )
    automatic = build_auto_protection_masks(grid, palette)
    hard_protected = [
        [protected[row][col] or automatic.hard[row][col] for col in range(width)]
        for row in range(height)
    ]
    soft_protected = [
        [
            automatic.junction_only[row][col] and not protected[row][col]
            for col in range(width)
        ]
        for row in range(height)
    ]
    result = [row.copy() for row in grid]
    for _ in range(profile.passes):
        result = merge_rare_cells(
            result,
            reference,
            palette,
            hard_protected,
            region_hints,
            profile,
            soft_protected,
        )
        result = cleanup_components(
            result,
            reference,
            palette,
            hard_protected,
            region_hints,
            profile,
            soft_protected,
        )
    return result


def _strip_typescript_comments(source: str) -> str:
    output: list[str] = []
    quote: str | None = None
    index = 0
    while index < len(source):
        character = source[index]
        if quote is not None:
            output.append(character)
            if character == "\\" and index + 1 < len(source):
                index += 1
                output.append(source[index])
            elif character == quote:
                quote = None
            index += 1
            continue
        if character in {'"', "'", "`"}:
            quote = character
            output.append(character)
            index += 1
            continue
        if source.startswith("//", index):
            newline = source.find("\n", index + 2)
            if newline == -1:
                break
            output.append("\n")
            index = newline + 1
            continue
        if source.startswith("/*", index):
            comment_end = source.find("*/", index + 2)
            if comment_end == -1:
                raise ValueError("unterminated TypeScript comment")
            output.extend("\n" for character in source[index : comment_end + 2] if character == "\n")
            index = comment_end + 2
            continue
        output.append(character)
        index += 1
    return "".join(output)


def _mard_colors_initializer(source: str) -> str:
    match = _MARD_COLORS_INITIALIZER_PATTERN.search(source)
    if match is None:
        raise ValueError("MARD_COLORS array initializer not found")

    output: list[str] = []
    depth = 1
    quote: str | None = None
    index = match.end()
    while index < len(source):
        character = source[index]
        if quote is not None:
            output.append(character)
            if character == "\\" and index + 1 < len(source):
                index += 1
                output.append(source[index])
            elif character == quote:
                quote = None
        elif character in {'"', "'", "`"}:
            quote = character
            output.append(character)
        elif source.startswith("//", index):
            newline = source.find("\n", index + 2)
            if newline == -1:
                break
            output.append("\n")
            index = newline
        elif source.startswith("/*", index):
            comment_end = source.find("*/", index + 2)
            if comment_end == -1:
                raise ValueError("unterminated comment in MARD_COLORS initializer")
            output.extend("\n" for character in source[index:comment_end] if character == "\n")
            index = comment_end + 1
        elif character == "[":
            depth += 1
            output.append(character)
        elif character == "]":
            depth -= 1
            if depth == 0:
                return "".join(output)
            output.append(character)
        else:
            output.append(character)
        index += 1

    raise ValueError("unterminated MARD_COLORS array initializer")


def load_palette(path: Path) -> list[PaletteColor]:
    source = _strip_typescript_comments(path.read_text(encoding="utf-8"))
    group_match = _MARD221_GROUP_PATTERN.search(source)
    if group_match is None:
        raise ValueError("mard221 palette group not found")
    series = set(re.findall(r'\"([A-Z]+)\"', group_match.group("series")))
    if not series:
        raise ValueError("mard221 palette group has no series")

    colors: list[PaletteColor] = []
    for match in _COLOR_PATTERN.finditer(_mard_colors_initializer(source)):
        code = match.group("code")
        prefix_match = re.match(r"[A-Z]+", code)
        if prefix_match is None or prefix_match.group(0) not in series:
            continue
        rgb = tuple(int(match.group(channel)) for channel in ("red", "green", "blue"))
        if any(component > 255 for component in rgb):
            raise ValueError(f"invalid RGB value for palette color {code}")
        colors.append(
            PaletteColor(
                index=len(colors),
                code=code,
                hex=match.group("hex"),
                rgb=rgb,
                lab=_rgb_to_lab(rgb),
            )
        )

    if len(colors) != _MARD221_PALETTE_SIZE:
        raise ValueError(f"expected 221 mard221 colors, found {len(colors)}")
    return colors


def load_project(path: Path) -> Project:
    project = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(project, dict):
        raise ValueError("project root must be an object")
    validate_project(project, _MARD221_PALETTE_SIZE)
    return project


def _validate_grid(
    grid: object,
    *,
    name: str,
    width: int,
    height: int,
    palette_size: int,
) -> None:
    if not isinstance(grid, list):
        raise ValueError(f"{name} must be an array of rows")
    if len(grid) != height:
        raise ValueError(f"{name} height does not match declared height {height}")
    for row_index, row in enumerate(grid):
        if not isinstance(row, list):
            raise ValueError(f"{name}[{row_index}] must be an array")
        if len(row) != width:
            raise ValueError(f"{name}[{row_index}] width does not match declared width {width}")
        for column_index, cell in enumerate(row):
            location = f"{name}[{row_index}][{column_index}]"
            if isinstance(cell, dict):
                raise ValueError(f"{location}: object-form v2 cells are unsupported")
            if cell is None:
                continue
            if isinstance(cell, bool) or not isinstance(cell, int):
                raise ValueError(f"{location}: color index must be an integer or null")
            if not 0 <= cell < palette_size:
                raise ValueError(f"{location}: color index {cell} is outside palette bounds")


def validate_project(project: Project, palette_size: int) -> None:
    if not isinstance(project, dict):
        raise ValueError("project root must be an object")
    version = project.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version != 3:
        raise ValueError("only project version 3 is supported")
    if isinstance(palette_size, bool) or not isinstance(palette_size, int) or palette_size <= 0:
        raise ValueError("palette_size must be a positive integer")

    canvas_size = project.get("canvasSize")
    if not isinstance(canvas_size, dict):
        raise ValueError("canvasSize must be an object")
    width = canvas_size.get("width")
    height = canvas_size.get("height")
    if isinstance(width, bool) or not isinstance(width, int) or width <= 0:
        raise ValueError("declared width must be a positive integer")
    if isinstance(height, bool) or not isinstance(height, int) or height <= 0:
        raise ValueError("declared height must be a positive integer")

    _validate_grid(
        project.get("canvasData"),
        name="canvasData",
        width=width,
        height=height,
        palette_size=palette_size,
    )

    layers = project.get("layers")
    if not isinstance(layers, list) or not layers:
        raise ValueError("project must contain at least one visible layer")
    if len(layers) != 1:
        raise ValueError("only the single-layer workflow is supported")
    layer = layers[0]
    if not isinstance(layer, dict):
        raise ValueError("layer must be an object")
    if layer.get("visible") is not True:
        raise ValueError("project must contain at least one visible layer")
    _validate_grid(
        layer.get("data"),
        name="layers[0].data",
        width=width,
        height=height,
        palette_size=palette_size,
    )
    if project["canvasData"] != layer["data"]:
        raise ValueError("canvasData/layer mismatch")


def save_project(path: Path, project: Project) -> None:
    validate_project(project, _MARD221_PALETTE_SIZE)
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n"
    path.write_text(serialized, encoding="utf-8", newline="\n")


def replace_grid(project: Project, grid: Grid) -> Project:
    palette_size = _MARD221_PALETTE_SIZE
    validate_project(project, palette_size)
    canvas_size = project["canvasSize"]
    _validate_grid(
        grid,
        name="replacement grid",
        width=canvas_size["width"],
        height=canvas_size["height"],
        palette_size=palette_size,
    )
    replaced = copy.deepcopy(project)
    replaced["canvasData"] = copy.deepcopy(grid)
    replaced["layers"][0]["data"] = copy.deepcopy(grid)
    validate_project(replaced, palette_size)
    return replaced

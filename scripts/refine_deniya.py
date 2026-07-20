"""Deniya-specific entry point for protected-detail refinement."""

import argparse
import json
import stat
from pathlib import Path
from tempfile import TemporaryDirectory, mkdtemp

from PIL import Image

if __package__:
    from .pindou_refine import (
        CleanupProfile,
        PaletteColor,
        assert_protected_unchanged,
        build_auto_protection_masks,
        build_mask,
        compute_metrics,
        load_palette,
        load_project,
        is_h1_bead,
        refine_grid,
        render_blueprint,
        render_heatmap,
        render_mask_overlay,
        render_plain,
        replace_grid,
        sample_reference_grid,
        save_project,
        validate_project,
    )
else:
    from pindou_refine import (
        CleanupProfile,
        PaletteColor,
        assert_protected_unchanged,
        build_auto_protection_masks,
        build_mask,
        compute_metrics,
        load_palette,
        load_project,
        is_h1_bead,
        refine_grid,
        render_blueprint,
        render_heatmap,
        render_mask_overlay,
        render_plain,
        replace_grid,
        sample_reference_grid,
        save_project,
        validate_project,
    )


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "samples/deniya1.pindou"
DEFAULT_REFERENCE = ROOT / "temp/deniya_orig.png"
DEFAULT_OUTPUT_DIR = ROOT / "temp/deniya-cleanup"
PALETTE_PATH = ROOT / "src/data/mard221.ts"

PROTECTED_POLYGONS = {
    "left_eye": [(31, 43), (35, 39), (49, 39), (53, 45), (50, 52), (35, 53)],
    "right_eye": [(53, 37), (58, 33), (72, 33), (77, 39), (73, 47), (57, 47)],
    "mouth": [(47, 56), (63, 55), (65, 61), (48, 62)],
    "hair_jewel": [(65, 0), (82, 0), (84, 29), (73, 35), (64, 23)],
    "blue_bow": [(76, 0), (100, 0), (100, 24), (88, 28), (73, 18)],
    "collar_pendant": [(41, 65), (81, 65), (83, 84), (41, 85)],
    "metal_chain": [(55, 70), (90, 69), (96, 89), (53, 89)],
}

REGION_HINTS = {
    "face": [(29, 28), (76, 26), (83, 57), (69, 71), (39, 69), (27, 53)],
    "shoulders_left": [(0, 69), (42, 63), (51, 89), (0, 89)],
    "shoulders_right": [(75, 63), (101, 68), (101, 89), (70, 89)],
    "lower_garment": [(29, 57), (88, 55), (96, 89), (22, 89)],
}

PROFILES = [
    CleanupProfile("light", 2, 1, 7.0, 2.0, 0.66, 1),
    CleanupProfile("balanced", 4, 2, 10.0, 3.0, 0.50, 2),
    CleanupProfile("compact", 8, 3, 14.0, 5.0, 0.42, 3),
]
MANAGED_ARTIFACT_NAMES = tuple(
    ["protection-mask.png", "metrics.json"]
    + [f"deniya1-{profile.name}.pindou" for profile in PROFILES]
    + [
        f"deniya1-{profile.name}-{kind}.png"
        for profile in PROFILES
        for kind in ("plain", "blueprint", "heatmap")
    ]
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--mask-overlay-only", action="store_true")
    return parser.parse_args(argv)


def _repo_path(path: Path) -> Path:
    return (path if path.is_absolute() else ROOT / path).resolve()


def _output_path(path: Path) -> Path:
    lexical = path if path.is_absolute() else ROOT / path
    if lexical.name in ("", ".", ".."):
        raise ValueError(f"output directory path is invalid: {lexical}")
    return lexical.parent.resolve() / lexical.name


def _require_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"{label} file not found: {path}")


def _combine_masks(
    first: list[list[bool]],
    second: list[list[bool]],
) -> list[list[bool]]:
    return [
        [left or right for left, right in zip(first_row, second_row)]
        for first_row, second_row in zip(first, second)
    ]


def _count_mask_changes(
    before: list[list[int | None]],
    after: list[list[int | None]],
    mask: list[list[bool]],
) -> int:
    return sum(
        mask[row][column] and before[row][column] != after[row][column]
        for row in range(len(before))
        for column in range(len(before[row]))
    )


def _assert_transparency_unchanged(
    before: list[list[int | None]],
    after: list[list[int | None]],
) -> None:
    for row, (before_row, after_row) in enumerate(zip(before, after)):
        for column, (before_cell, after_cell) in enumerate(zip(before_row, after_row)):
            if (before_cell is None) != (after_cell is None):
                raise AssertionError(
                    f"transparency mismatch at ({column},{row}): "
                    f"{before_cell!r} -> {after_cell!r}"
                )


def _assert_h1_unchanged(
    before: list[list[int | None]],
    after: list[list[int | None]],
    palette: list[PaletteColor],
) -> None:
    for row, (before_row, after_row) in enumerate(zip(before, after)):
        for column, (before_cell, after_cell) in enumerate(zip(before_row, after_row)):
            if is_h1_bead(before_cell, palette) != is_h1_bead(after_cell, palette):
                raise AssertionError(
                    f"H1 bead mismatch at ({column},{row}): "
                    f"{before_cell!r} -> {after_cell!r}"
                )


def _managed_paths(output_dir: Path) -> dict[str, Path]:
    return {name: output_dir / name for name in MANAGED_ARTIFACT_NAMES}


def _lstat(path: Path):
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def _is_reparse_point(path_stat) -> bool:
    attributes = getattr(path_stat, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return bool(attributes & reparse_flag)


def _validate_output_directory(output_dir: Path) -> None:
    output_stat = _lstat(output_dir)
    if output_stat is None:
        return
    if stat.S_ISLNK(output_stat.st_mode) or _is_reparse_point(output_stat):
        raise ValueError(f"output directory must not be a link or reparse point: {output_dir}")
    if not stat.S_ISDIR(output_stat.st_mode):
        raise ValueError(f"output directory is not a directory: {output_dir}")


def _verified_regular_file(path: Path) -> bool:
    path_stat = _lstat(path)
    if path_stat is None:
        return False
    if (
        stat.S_ISLNK(path_stat.st_mode)
        or _is_reparse_point(path_stat)
        or not stat.S_ISREG(path_stat.st_mode)
    ):
        raise ValueError(f"managed artifact is not a regular file: {path}")
    return True


def _preflight_managed(managed_paths: dict[str, Path]) -> None:
    for path in managed_paths.values():
        _verified_regular_file(path)


def _validate_output_paths(
    output_dir: Path,
    managed_paths: dict[str, Path],
    input_paths: dict[str, Path],
) -> None:
    _validate_output_directory(output_dir)
    existing_parent = output_dir.parent
    while not existing_parent.exists() and existing_parent.parent != existing_parent:
        existing_parent = existing_parent.parent
    if existing_parent.exists() and not existing_parent.is_dir():
        raise ValueError(
            f"output directory parent is not a directory: {existing_parent}"
        )
    if output_dir in input_paths.values():
        raise ValueError(f"output directory collides with an input file: {output_dir}")
    for name, artifact_path in managed_paths.items():
        for label, input_path in input_paths.items():
            if artifact_path == input_path:
                raise ValueError(
                    f"managed artifact {name!r} collides with {label}: {input_path}"
                )
    _preflight_managed(managed_paths)


def _publish_managed(
    staging_paths: dict[str, Path],
    managed_paths: dict[str, Path],
    names_to_publish: tuple[str, ...],
) -> None:
    output_dir = next(iter(managed_paths.values())).parent
    _validate_output_directory(output_dir)
    _preflight_managed(managed_paths)
    output_dir.mkdir(parents=True, exist_ok=True)
    _validate_output_directory(output_dir)
    _preflight_managed(managed_paths)
    backup_dir = Path(mkdtemp(prefix=".deniya-backup-", dir=output_dir.parent))
    backed_up: list[str] = []
    published: list[str] = []
    try:
        for name, final_path in managed_paths.items():
            if _verified_regular_file(final_path):
                final_path.replace(backup_dir / name)
                backed_up.append(name)
        for name in names_to_publish:
            staging_paths[name].replace(managed_paths[name])
            published.append(name)
    except Exception:
        for name in published:
            if _verified_regular_file(managed_paths[name]):
                managed_paths[name].unlink()
        for name in backed_up:
            backup_path = backup_dir / name
            if _verified_regular_file(backup_path):
                backup_path.replace(managed_paths[name])
        backup_dir.rmdir()
        raise
    else:
        for name in backed_up:
            backup_path = backup_dir / name
            if _verified_regular_file(backup_path):
                backup_path.unlink()
        backup_dir.rmdir()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    display_output_dir = (
        args.output_dir if args.output_dir.is_absolute() else ROOT / args.output_dir
    )
    input_path = _repo_path(args.input)
    reference_path = _repo_path(args.reference)
    output_dir = _output_path(args.output_dir)
    palette_path = PALETTE_PATH.resolve()
    managed_paths = _managed_paths(output_dir)
    input_paths = {
        "input": input_path,
        "reference": reference_path,
        "palette": palette_path,
    }
    _validate_output_paths(output_dir, managed_paths, input_paths)
    _require_file(input_path, "input")
    _require_file(palette_path, "palette")
    if not args.mask_overlay_only:
        _require_file(reference_path, "reference")

    project = load_project(input_path)
    palette = load_palette(palette_path)
    validate_project(project, len(palette))
    width = project["canvasSize"]["width"]
    height = project["canvasSize"]["height"]
    baseline = project["canvasData"]
    explicit_mask = build_mask(width, height, list(PROTECTED_POLYGONS.values()))
    automatic = build_auto_protection_masks(baseline, palette)
    hard_protection_mask = _combine_masks(explicit_mask, automatic.hard)
    soft_protection_mask = [
        [
            automatic.junction_only[row][column]
            and not hard_protection_mask[row][column]
            for column in range(width)
        ]
        for row in range(height)
    ]
    protection_mask = _combine_masks(hard_protection_mask, soft_protection_mask)

    reference = None
    if not args.mask_overlay_only:
        try:
            with Image.open(reference_path) as reference_image:
                reference_image.load()
                reference = sample_reference_grid(reference_image, width, height)
        except OSError as error:
            raise ValueError(
                f"reference image could not be opened: {reference_path}: {error}"
            ) from error
        _preflight_managed(managed_paths)

    summaries: list[str] = []
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(
        prefix=".deniya-staging-",
        dir=output_dir.parent,
    ) as staging_name:
        staging_dir = Path(staging_name).resolve()
        staging_paths = {
            name: staging_dir / name
            for name in MANAGED_ARTIFACT_NAMES
        }
        render_mask_overlay(baseline, palette, protection_mask).save(
            staging_paths["protection-mask.png"]
        )

        if args.mask_overlay_only:
            names_to_publish = ("protection-mask.png",)
        else:
            assert reference is not None
            all_metrics: dict[str, dict[str, int | float]] = {}
            for profile in PROFILES:
                candidate_grid = refine_grid(
                    baseline,
                    reference,
                    palette,
                    explicit_mask,
                    REGION_HINTS,
                    profile,
                )
                assert_protected_unchanged(
                    baseline,
                    candidate_grid,
                    hard_protection_mask,
                )
                _assert_transparency_unchanged(baseline, candidate_grid)
                _assert_h1_unchanged(baseline, candidate_grid, palette)

                candidate_project = replace_grid(project, candidate_grid)
                validate_project(candidate_project, len(palette))
                prefix = f"deniya1-{profile.name}"
                save_project(staging_paths[f"{prefix}.pindou"], candidate_project)
                render_plain(candidate_grid, palette).save(
                    staging_paths[f"{prefix}-plain.png"]
                )
                render_blueprint(candidate_grid, palette).save(
                    staging_paths[f"{prefix}-blueprint.png"]
                )
                render_heatmap(baseline, candidate_grid, palette).save(
                    staging_paths[f"{prefix}-heatmap.png"]
                )

                metrics = compute_metrics(baseline, candidate_grid, reference, palette)
                # This metric covers immutable caller + automatic hard protection.
                # Junction-only changes are valid and reported separately.
                metrics["protected_mismatches"] = _count_mask_changes(
                    baseline,
                    candidate_grid,
                    hard_protection_mask,
                )
                metrics["soft_protection_changes"] = _count_mask_changes(
                    baseline,
                    candidate_grid,
                    soft_protection_mask,
                )
                metrics["protection_union_cells"] = sum(
                    sum(row) for row in protection_mask
                )
                metrics["transparency_mismatches"] = 0
                metrics["h1_mismatches"] = 0
                all_metrics[profile.name] = metrics
                summaries.append(
                    f"{profile.name}: changed={metrics['changed_cells']} "
                    f"colors={metrics['unique_colors_after']}"
                )

            staging_paths["metrics.json"].write_text(
                json.dumps(
                    all_metrics,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                + "\n",
                encoding="utf-8",
            )
            names_to_publish = MANAGED_ARTIFACT_NAMES

        _publish_managed(staging_paths, managed_paths, names_to_publish)

    output_path = display_output_dir / "protection-mask.png"
    protected_count = sum(sum(row) for row in protection_mask)
    print(output_path)
    print(f"protected cells: {protected_count}")
    for summary in summaries:
        print(summary)
    if args.mask_overlay_only:
        return 0
    print(f"output: {display_output_dir}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        raise SystemExit(f"error: {error}") from None

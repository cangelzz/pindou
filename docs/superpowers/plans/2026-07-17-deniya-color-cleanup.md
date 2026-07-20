# Deniya Color Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate three deterministic, protected-detail color-cleanup candidates for `samples/deniya1.pindou`, with renderings, blueprints, heatmaps, metrics, and a browser comparison.

**Architecture:** Add a small Python refinement module that reads v3 `.pindou` data, samples the original PNG by bead cell, protects configured semantic polygons and high-contrast boundaries, then applies frequency-aware palette merging plus connected-component cleanup. A Deniya-specific runner supplies masks and three threshold profiles, writes only to ignored `temp/deniya-cleanup/`, validates every artifact, and renders comparison images with Pillow.

**Tech Stack:** Python 3.12, Pillow 12, standard-library `unittest`, JSON, existing MARD palette data in `src/data/mard221.ts`, existing Vitest project suite.

---

## File map

- Create `scripts/pindou_refine.py`: reusable project I/O, palette/Lab helpers, masks, cleanup passes, validation, metrics, and Pillow rendering.
- Create `scripts/refine_deniya.py`: Deniya masks, Light/Balanced/Compact profiles, CLI orchestration, and artifact naming.
- Create `tests/scripts/test_pindou_refine.py`: focused unit and deterministic integration tests.
- Create `temp/deniya-cleanup/*`: ignored candidate projects and preview artifacts; never commit these files.
- Create `.superpowers/brainstorm/<session>/content/deniya-comparison.html`: ignored/persistent visual-companion comparison screen.
- Do not modify `samples/deniya1.pindou` until the user chooses a candidate.
- Do not stage `.claude/skills/pindou-poster/scripts/make_poster.py`.

### Task 1: v3 project and palette foundation

**Files:**
- Create: `scripts/pindou_refine.py`
- Create: `tests/scripts/test_pindou_refine.py`

- [ ] **Step 1: Write failing I/O and palette tests**

Add tests that create a 3×2 v3 project with matching flat `canvasData` and layer data, then assert round-trip preservation and rejection of mismatched layers:

```python
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pindou_refine import load_palette, load_project, save_project, validate_project


class ProjectIOTests(unittest.TestCase):
    def setUp(self):
        self.project = {
            "version": 3,
            "canvasSize": {"width": 3, "height": 2},
            "canvasData": [[None, 1, 2], [3, 4, None]],
            "layers": [{
                "id": "layer-1", "name": "拼豆层",
                "data": [[None, 1, 2], [3, 4, None]],
                "visible": True, "opacity": 1,
            }],
        }

    def test_v3_round_trip_preserves_flat_cells(self):
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / "in.pindou"
            output = Path(td) / "out.pindou"
            source.write_text(json.dumps(self.project), encoding="utf-8")
            loaded = load_project(source)
            save_project(output, loaded)
            saved = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(saved["canvasData"], self.project["canvasData"])
            self.assertEqual(saved["layers"][0]["data"], self.project["canvasData"])

    def test_validation_rejects_layer_mismatch(self):
        self.project["layers"][0]["data"][0][1] = 9
        with self.assertRaisesRegex(ValueError, "canvasData/layer mismatch"):
            validate_project(self.project, palette_size=221)

    def test_palette_loads_all_mard_entries(self):
        palette = load_palette(ROOT / "src/data/mard221.ts")
        self.assertEqual(len(palette), 221)
        self.assertEqual(palette[0].index, 0)
        self.assertRegex(palette[0].hex, r"^#[0-9A-Fa-f]{6}$")
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `python -m unittest tests.scripts.test_pindou_refine.ProjectIOTests -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'pindou_refine'`.

- [ ] **Step 3: Implement v3 I/O, palette parsing, and validation**

Create `PaletteColor` and the following public API in `scripts/pindou_refine.py`:

```python
@dataclass(frozen=True)
class PaletteColor:
    index: int
    code: str
    hex: str
    rgb: tuple[int, int, int]
    lab: tuple[float, float, float]


# load_palette(path: Path) -> list[PaletteColor]
# load_project(path: Path) -> dict
# validate_project(project: dict, palette_size: int) -> None
# save_project(path: Path, project: dict) -> None
# replace_grid(project: dict, grid: list[list[int | None]]) -> dict
```

Implementation requirements:

- Parse each `code`, `hex`, and `rgb` tuple from `mard221.ts` in source order and compute CIE Lab once.
- Accept only v3 flat cells (`None` or integer); emit a clear error for object-form v2 cells.
- Check declared width/height, every row width, all indices, at least one visible layer, and exact `canvasData == layers[0].data` for this single-layer workflow.
- `replace_grid` deep-copies the project and writes the same flat grid to both locations.
- `save_project` uses UTF-8, `ensure_ascii=False`, compact separators, and a trailing newline for deterministic bytes.

- [ ] **Step 4: Run I/O tests**

Run: `python -m unittest tests.scripts.test_pindou_refine.ProjectIOTests -v`

Expected: 3 tests pass.

- [ ] **Step 5: Commit the foundation**

```powershell
git add scripts/pindou_refine.py tests/scripts/test_pindou_refine.py
git commit -m "tools: add pindou refinement foundation"
```

### Task 2: Reference sampling and immutable protection masks

**Files:**
- Modify: `scripts/pindou_refine.py`
- Modify: `tests/scripts/test_pindou_refine.py`
- Create: `scripts/refine_deniya.py`

- [ ] **Step 1: Write failing sampling and mask tests**

Add tests for polygon inclusion, unchanged protected cells, and center-window image sampling:

```python
from PIL import Image
from pindou_refine import build_mask, sample_reference_grid


class MaskAndReferenceTests(unittest.TestCase):
    def test_polygon_mask_uses_col_row_coordinates(self):
        mask = build_mask(6, 5, [[(1, 1), (4, 1), (4, 3), (1, 3)]])
        self.assertTrue(mask[2][2])
        self.assertFalse(mask[0][0])
        self.assertFalse(mask[4][5])

    def test_reference_sampler_ignores_cell_borders(self):
        image = Image.new("RGB", (20, 10), "black")
        for y in range(2, 8):
            for x in range(2, 8):
                image.putpixel((x, y), (250, 10, 20))
            for x in range(12, 18):
                image.putpixel((x, y), (10, 20, 250))
        sampled = sample_reference_grid(image, width=2, height=1, inset=0.2)
        self.assertEqual(sampled, [[(250, 10, 20), (10, 20, 250)]])
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `python -m unittest tests.scripts.test_pindou_refine.MaskAndReferenceTests -v`

Expected: FAIL because `build_mask` and `sample_reference_grid` are not defined.

- [ ] **Step 3: Implement sampling and masks**

Add the following API:

```python
# point_in_polygon(x: float, y: float, polygon: list[tuple[int, int]]) -> bool
# build_mask(width: int, height: int, polygons: list[list[tuple[int, int]]]) -> list[list[bool]]
# sample_reference_grid(image: Image.Image, width: int, height: int, inset: float = 0.22) -> list[list[tuple[int, int, int]]]
# assert_protected_unchanged(before, after, mask) -> None
```

Use the ray-casting point-in-polygon rule at cell centers `(col + 0.5, row + 0.5)`. For sampling, map each bead cell to its proportional source-image rectangle, discard the outer 22%, and take the per-channel median.

- [ ] **Step 4: Add the exact Deniya protection configuration**

Create `scripts/refine_deniya.py` with these named polygons in `(col, row)` coordinates:

```python
PROTECTED_POLYGONS = {
    "left_eye": [(31, 43), (35, 39), (49, 39), (53, 45), (50, 52), (35, 53)],
    "right_eye": [(53, 37), (58, 33), (72, 33), (77, 39), (73, 47), (57, 47)],
    "mouth": [(47, 56), (63, 55), (65, 61), (48, 62)],
    "hair_jewel": [(65, 0), (82, 0), (84, 29), (73, 35), (64, 23)],
    "blue_bow": [(76, 0), (100, 0), (100, 24), (88, 28), (73, 18)],
    "collar_pendant": [(41, 65), (81, 65), (83, 84), (41, 85)],
    "metal_chain": [(55, 70), (90, 69), (96, 89), (53, 89)],
}
```

The runner must expose `--mask-overlay-only`, which renders `temp/deniya-cleanup/protection-mask.png` over the baseline without refining anything.

- [ ] **Step 5: Verify the mask overlay visually**

Run:

```powershell
python scripts/refine_deniya.py --mask-overlay-only
```

Open `temp/deniya-cleanup/protection-mask.png`. Expected: both eyes, mouth, top-right jewel/bow, collar pendant, and chain are covered; large plain hair/skin areas remain available for cleanup. If a polygon misses its named feature, adjust only that polygon before proceeding and record its final coordinates in the commit.

- [ ] **Step 6: Run mask tests and commit**

Run: `python -m unittest tests.scripts.test_pindou_refine.MaskAndReferenceTests -v`

Expected: all tests pass.

```powershell
git add scripts/pindou_refine.py scripts/refine_deniya.py tests/scripts/test_pindou_refine.py
git commit -m "tools: add deniya reference and detail masks"
```

### Task 3: Frequency-aware merging and topology cleanup

**Files:**
- Modify: `scripts/pindou_refine.py`
- Modify: `scripts/refine_deniya.py`
- Modify: `tests/scripts/test_pindou_refine.py`

- [ ] **Step 1: Write failing cleanup tests**

Add synthetic tests where an unprotected similar singleton merges, a protected singleton remains, a high-contrast outline remains, and the same input is deterministic:

```python
from pindou_refine import CleanupProfile, refine_grid


class RefinementTests(unittest.TestCase):
    def test_similar_unprotected_singleton_joins_local_majority(self):
        grid = [[10, 10, 10], [10, 11, 10], [10, 10, 10]]
        result = refine_grid(grid, self.reference_for(grid), self.palette,
                             [[False] * 3 for _ in range(3)], {}, self.profile)
        self.assertEqual(result[1][1], 10)

    def test_protected_singleton_is_immutable(self):
        grid = [[10, 10, 10], [10, 11, 10], [10, 10, 10]]
        mask = [[False] * 3 for _ in range(3)]
        mask[1][1] = True
        result = refine_grid(grid, self.reference_for(grid), self.palette, mask, {}, self.profile)
        self.assertEqual(result[1][1], 11)

    def test_repeat_run_is_identical(self):
        first = refine_grid(self.grid, self.reference, self.palette, self.mask, {}, self.profile)
        second = refine_grid(self.grid, self.reference, self.palette, self.mask, {}, self.profile)
        self.assertEqual(first, second)
```

Use a small hand-built palette in `setUp`; do not depend on MARD indices 10 and 11 being similar.

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m unittest tests.scripts.test_pindou_refine.RefinementTests -v`

Expected: FAIL because cleanup APIs are not defined.

- [ ] **Step 3: Implement cleanup profiles and region families**

Add `CleanupProfile` and the following API:

```python
@dataclass(frozen=True)
class CleanupProfile:
    name: str
    rare_count: int
    max_component: int
    max_palette_delta_e: float
    max_reference_increase: float
    neighbor_dominance: float
    passes: int


# color_family(rgb: tuple[int, int, int]) -> str
# semantic_region(row: int, col: int, color: PaletteColor, region_hints: dict) -> str
# connected_components(grid) -> list[list[tuple[int, int]]]
# build_auto_protection_mask(grid, palette, threshold: float = 28.0) -> list[list[bool]]
# merge_rare_cells(grid, reference, palette, protected, region_hints, profile) -> grid
# cleanup_components(grid, reference, palette, protected, region_hints, profile) -> grid
# refine_grid(grid, reference, palette, protected, region_hints, profile) -> grid
```

Rules:

- Families are `blue`, `pink`, `skin`, `neutral-dark`, and `neutral-light`, derived from RGB hue/chroma/luminance.
- `semantic_region` combines the family with spatial hints for `face`, `shoulders`, and `lower_garment`; replacement candidates must have the same semantic-region key. Add these Deniya hints in the runner: face polygon `[(29, 28), (76, 26), (83, 57), (69, 71), (39, 69), (27, 53)]`, shoulder polygons `[(0, 69), (42, 63), (51, 89), (0, 89)]` and `[(75, 63), (101, 68), (101, 89), (70, 89)]`, and lower-garment polygon `[(29, 57), (88, 55), (96, 89), (22, 89)]`.
- Candidate colors come from the eight-cell boundary neighborhood and must be more common globally than the source color.
- Reject a candidate when palette Lab distance exceeds the profile threshold or its reference Lab error increase exceeds the profile allowance.
- Score accepted candidates as `reference_error + 0.35 * palette_delta_e - 1.5 * touching_neighbors`; lowest score wins, with palette index as deterministic tie-breaker.
- The automatic protection mask marks a cell immutable when it is dark (`Lab L < 38`) and touches a neighbor at least 28 ΔE away, when it borders transparency, or when its 3×3 neighborhood contains at least three colors spanning 25 ΔE while the center belongs to a component of at most six cells. This retains small structured highlights without protecting flat low-frequency noise.
- Process decisions from a snapshot and apply them as a batch after each pass.

- [ ] **Step 4: Define the three profiles**

In `scripts/refine_deniya.py`:

```python
PROFILES = [
    CleanupProfile("light", 2, 1, 7.0, 2.0, 0.66, 1),
    CleanupProfile("balanced", 4, 2, 10.0, 3.0, 0.50, 2),
    CleanupProfile("compact", 8, 3, 14.0, 5.0, 0.42, 3),
]
```

- [ ] **Step 5: Run cleanup tests and commit**

Run: `python -m unittest tests.scripts.test_pindou_refine.RefinementTests -v`

Expected: all tests pass.

```powershell
git add scripts/pindou_refine.py scripts/refine_deniya.py tests/scripts/test_pindou_refine.py
git commit -m "tools: add protected color cleanup passes"
```

### Task 4: Metrics, renderers, and complete CLI

**Files:**
- Modify: `scripts/pindou_refine.py`
- Modify: `scripts/refine_deniya.py`
- Modify: `tests/scripts/test_pindou_refine.py`

- [ ] **Step 1: Write failing renderer and metrics tests**

Test that metrics report changed cells and unique colors, plain render dimensions are exact, blueprint is larger than plain render, and heatmap marks only changed cells:

```python
from pindou_refine import compute_metrics, render_blueprint, render_heatmap, render_plain


class OutputTests(unittest.TestCase):
    def test_metrics_and_render_dimensions(self):
        before = [[1, 2], [1, None]]
        after = [[1, 1], [1, None]]
        metrics = compute_metrics(before, after, self.reference, self.palette)
        self.assertEqual(metrics["changed_cells"], 1)
        self.assertEqual(metrics["unique_colors_after"], 1)
        plain = render_plain(after, self.palette, cell_size=8)
        blueprint = render_blueprint(after, self.palette, cell_size=20)
        heatmap = render_heatmap(before, after, self.palette, cell_size=8)
        self.assertEqual(plain.size, (16, 16))
        self.assertGreater(blueprint.width, plain.width)
        self.assertEqual(heatmap.size, plain.size)
```

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m unittest tests.scripts.test_pindou_refine.OutputTests -v`

Expected: FAIL because output APIs are not defined.

- [ ] **Step 3: Implement metrics and Pillow renderers**

Add the following output API:

```python
# compute_metrics(before, after, reference, palette) -> dict
# render_plain(grid, palette, cell_size=12) -> Image.Image
# render_blueprint(grid, palette, cell_size=20) -> Image.Image
# render_heatmap(before, after, palette, cell_size=12) -> Image.Image
# render_mask_overlay(grid, palette, mask, cell_size=12) -> Image.Image
```

Metrics must include `unique_colors_before`, `unique_colors_after`, `changed_cells`, `colors_used_1_to_3`, `components_size_1_to_2`, `mean_reference_delta_e_before`, and `mean_reference_delta_e_after`. Plain render uses transparent pixels for `None`; blueprint draws thin cell lines, 5-cell heavy lines, and the MARD code centered in each non-empty cell; heatmap shows unchanged cells at 30% opacity and changed cells in opaque red.

- [ ] **Step 4: Complete CLI orchestration**

`scripts/refine_deniya.py` must accept:

```text
--input samples/deniya1.pindou
--reference temp/deniya_orig.png
--output-dir temp/deniya-cleanup
--mask-overlay-only
```

Default execution must:

1. validate the baseline;
2. sample the reference;
3. build explicit plus automatic masks;
4. run all three profiles from the same untouched baseline;
5. assert protected cells and transparency are unchanged;
6. write compact v3 candidates;
7. write plain, blueprint, and heatmap PNGs;
8. write deterministic `metrics.json` sorted by profile name.

- [ ] **Step 5: Run output tests and commit**

Run: `python -m unittest tests.scripts.test_pindou_refine.OutputTests -v`

Expected: all tests pass.

```powershell
git add scripts/pindou_refine.py scripts/refine_deniya.py tests/scripts/test_pindou_refine.py
git commit -m "tools: render deniya cleanup candidates"
```

### Task 5: Generate and evaluate the real candidates

**Files:**
- Generate ignored files under: `temp/deniya-cleanup/`
- Modify only if evidence requires threshold correction: `scripts/refine_deniya.py`

- [ ] **Step 1: Generate all candidate artifacts**

Run:

```powershell
python scripts/refine_deniya.py
```

Expected: three `.pindou` files, nine candidate PNGs, `protection-mask.png`, and `metrics.json` are written under `temp/deniya-cleanup/`.

- [ ] **Step 2: Run deterministic and structural validation**

Run the generator twice, hash all `.pindou` and `metrics.json` files after each run with `Get-FileHash`, and compare hashes. Expected: identical hashes. Then run:

```powershell
python -m unittest discover -s tests/scripts -p "test_*.py" -v
npm test
git diff --check
```

Expected: Python tests pass, all Vitest tests pass, and diff check is clean.

- [ ] **Step 3: Review objective metrics**

Read `metrics.json` and verify:

- `changed_cells` is monotonic: Light ≤ Balanced ≤ Compact;
- `unique_colors_after` is monotonic: Light ≥ Balanced ≥ Compact;
- all three protection mismatch counts are zero;
- mean reference ΔE does not rise by more than each profile's configured allowance;
- no candidate changes the non-empty/transparent cell count.

Do not force a target color count. If monotonicity fails because a stricter profile makes no additional safe replacements, retain the identical result and report it instead of weakening protection.

- [ ] **Step 4: Inspect full images and critical crops**

Open each plain render and compare crops for both eyes, mouth, top-right ornament, hair transitions, skin transitions, blue clothing, collar, and chain. Record a short evaluator note per profile in `temp/deniya-cleanup/evaluation.md`, naming the best two candidates according to the approved five criteria.

- [ ] **Step 5: Commit threshold corrections only if made**

If real-image evidence required profile adjustment, rerun all tests and commit only the script/test changes:

```powershell
git add scripts/refine_deniya.py tests/scripts/test_pindou_refine.py
git commit -m "tools: tune deniya cleanup profiles"
```

If no tracked files changed, do not create an empty commit.

#### Task 5 addendum: evidence-driven junction-only exception

The first real evaluation found all 37 cells belonging to the 24 colors used one to three times behind
the protection union. Profile threshold tuning therefore could not reach them. Visual and reference
evidence classified 23 colors as intentional; the exception is limited to cells protected only by the
three-color-junction reason and only when an otherwise valid replacement improves every changed cell's
reference ΔE by at least `1e-6`. Explicit polygons, H1, silhouette boundaries, and dark-contrast reasons
remain hard. In the evidenced low-frequency set this releases Compact D16 at `(71,56)` to H2 while E18
at `(10,79)` and G16 at `(70,52)` remain because their candidates worsen reference error.

The runner validates explicit plus automatic hard protection with `protected_mismatches`, reports
allowed junction-only edits as `soft_protection_changes`, and retains the full-union overlay/count for
diagnosis. Focused tests cover strict improvement, equal/worse references, overlapping hard reasons,
atomic multi-cell components, determinism, and the real Deniya result.

### Task 6: Browser comparison and user selection

**Files:**
- Create ignored visual companion content under `.superpowers/brainstorm/`
- Do not modify `samples/deniya1.pindou` in this task.

- [ ] **Step 1: Start or resume the visual companion server**

Use the brainstorming visual-companion server with project directory `Q:\repo\pindou`. Record the returned URL, `screen_dir`, and `state_dir`. Ensure `.superpowers/` remains untracked; add it to `.git/info/exclude` if the server does not ignore it automatically.

- [ ] **Step 2: Create the comparison screen**

Write a new `deniya-comparison.html` fragment containing four selectable cards: Baseline, Light, Balanced, Compact. Each card must show its plain render, color count, changed-cell count, low-frequency count, and mean reference ΔE. Add a second row with eye/mouth, hair, and clothing crops for the recommended two candidates. Enable multi-select so the user can compare or shortlist more than one.

- [ ] **Step 3: Present recommendations and wait for selection**

Tell the user the local URL, identify the evaluator's best two candidates, and ask them to inspect the full render and detail crops. Do not overwrite the sample in this task. The next change starts only after the user explicitly names a winning candidate or asks for another iteration.

## Final verification checklist

- [ ] `python -m unittest discover -s tests/scripts -p "test_*.py" -v` passes.
- [ ] `npm test` passes.
- [ ] `git diff --check` reports no issues.
- [ ] Candidate hashes are deterministic across two executions.
- [ ] Every candidate is valid v3, has a matching layer, valid palette indices, and unchanged transparency.
- [ ] Every explicit protected cell equals the baseline.
- [ ] Only intended tracked files are committed; the unrelated poster-script modification remains untouched.
- [ ] The user sees the browser comparison before any formal sample replacement.

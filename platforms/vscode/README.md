# PindouVerse - Bead Art Editor for VS Code

Open and edit `.pindou` bead art projects directly inside VS Code.

![PindouVerse Screenshot](icons/screenshot.png)

## Features

- **295-Color MARD Palette** — Full perler/fuse bead color set with search, filtering by group (solid, Morandi, pearlescent, special effects)
- **Multi-Layer System** — Independent bead layers with opacity, visibility, reorder, and duplicate
- **Grid Overlay** — Configurable 5x5 grouping with adjustable edge padding, line colors, and thickness
- **Blueprint Mode** — Color codes displayed in cells, mirror flip for viewing the back side
- **Project Management** — Save/load `.pindou` files, auto-save, version snapshots
- **Keyboard Shortcuts** — Ctrl+S save, Ctrl+O open, Ctrl+Z/Y undo/redo

## Usage

1. Open any `.pindou` file — it opens automatically in the PindouVerse editor
2. Use **PindouVerse: New Project** from the command palette to create a new project
3. Pick colors from the palette on the right, draw with the pen tool
4. Save with Ctrl+S

## Supported File Types

| Extension | Description |
|-----------|-------------|
| `.pindou` | PindouVerse bead art project file (JSON) |

## Requirements

No additional dependencies required. The extension works standalone.

## About PindouVerse

PindouVerse (拼豆宇宙) is a cross-platform perler bead pixel art editor. This VS Code extension brings the full editor experience into your IDE. The desktop app (Windows/macOS/Linux) and mobile app are also available.

- [GitHub Repository](https://github.com/cangelzz/pindouverse)
- [Report Issues](https://github.com/cangelzz/pindouverse/issues)

## License

MIT

## Development

See [TESTING.md](./TESTING.md) for the test suite (Playwright webview tests + `@vscode/test-electron` host smoke tests).

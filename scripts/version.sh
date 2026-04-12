#!/bin/bash
# Compute version and update all project files
# Format: MAJOR.MINOR.COMMITS
#   MAJOR — big release, manually bumped
#   MINOR — feature release, manually bumped, resets on major bump
#   COMMITS — auto-counted commits since last vMAJOR.MINOR.0 tag
#
# Usage:
#   ./scripts/version.sh              — print computed version
#   ./scripts/version.sh --apply      — write version to all project files
#   ./scripts/version.sh --bump-major — increment major (1.x → 2.0.0)
#   ./scripts/version.sh --bump-minor — increment minor (1.0.x → 1.1.0)

set -euo pipefail
cd "$(dirname "$0")/.."

# Read MAJOR.MINOR from VERSION file
VER_LINE=$(cat VERSION | tr -d '[:space:]')
MAJOR=$(echo "$VER_LINE" | cut -d. -f1)
MINOR=$(echo "$VER_LINE" | cut -d. -f2)

case "${1:-}" in
  --bump-major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    echo "${MAJOR}.${MINOR}" > VERSION
    git tag "v${MAJOR}.${MINOR}.0"
    echo "Bumped to major ${MAJOR} (tagged v${MAJOR}.${MINOR}.0)"
    COMMITS=0
    ;;
  --bump-minor)
    MINOR=$((MINOR + 1))
    echo "${MAJOR}.${MINOR}" > VERSION
    git tag "v${MAJOR}.${MINOR}.0"
    echo "Bumped to minor ${MINOR} (tagged v${MAJOR}.${MINOR}.0)"
    COMMITS=0
    ;;
  *)
    # Count commits since last tag vMAJOR.MINOR.0
    LAST_TAG="v${MAJOR}.${MINOR}.0"
    if git rev-parse "$LAST_TAG" >/dev/null 2>&1; then
      COMMITS=$(git rev-list "${LAST_TAG}..HEAD" --count)
    else
      COMMITS=$(git rev-list HEAD --count)
    fi
    ;;
esac

VERSION="${MAJOR}.${MINOR}.${COMMITS}"
echo "$VERSION"

if [[ "${1:-}" == "--apply" || "${1:-}" == --bump-* ]]; then
  # Update package.json
  sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"${VERSION}\"/" package.json && rm -f package.json.bak

  # Update tauri.conf.json
  sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json && rm -f src-tauri/tauri.conf.json.bak

  # Update Cargo.toml (only the package version, not dependency versions)
  sed -i.bak -E "/^\[package\]/,/^\[/{s/^version = \"[^\"]+\"/version = \"${VERSION}\"/}" src-tauri/Cargo.toml && rm -f src-tauri/Cargo.toml.bak

  echo "Updated all files to version ${VERSION}"
fi

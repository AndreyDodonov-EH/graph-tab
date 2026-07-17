#!/usr/bin/env bash
#
# Builds store deployment zips containing only the files needed to run the
# extension: PNG icons, the src/ directory, loader.js, background.js and
# a browser-specific manifest.json.
#
# Usage: ./package.sh [chrome|firefox|all]
#   chrome  (default) — Chrome/Edge zip from manifest.json
#   firefox           — Firefox zip from manifest.firefox.json
#   all               — both zips
#
set -euo pipefail

cd "$(dirname "$0")"

TARGET="${1:-chrome}"

if [[ "$TARGET" != "chrome" && "$TARGET" != "firefox" && "$TARGET" != "all" ]]; then
  echo "usage: $0 [chrome|firefox|all]" >&2
  exit 1
fi

# Read the version from manifest.json (no jq dependency).
VERSION=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' manifest.json \
  | head -n1 | grep -oE '[0-9]+(\.[0-9]+)*')

ASSETS=(
  loader.js
  background.js
  src
  icon16.png
  icon32.png
  icon48.png
  icon128.png
)

verify_assets() {
  for f in "${ASSETS[@]}"; do
    if [[ ! -e "$f" ]]; then
      echo "error: missing required file '$f'" >&2
      exit 1
    fi
  done
}

create_zip() {
  local out="$1"
  local dir="$2"
  shift 2
  local -a files=("$@")

  rm -f "$out"

  if command -v zip >/dev/null 2>&1; then
    # -r recurse into src/, -X strip extra file attributes for a clean archive.
    (cd "$dir" && zip -r -X "$OLDPWD/$out" "${files[@]}")
  else
    python3 - "$out" "$dir" "${files[@]}" <<'PY'
import os
import sys
import zipfile

out, dir, *paths = sys.argv[1:]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for path in paths:
        full = os.path.join(dir, path)
        if os.path.isdir(full):
            for root, _dirs, files in os.walk(full):
                for name in files:
                    fp = os.path.join(root, name)
                    zf.write(fp, os.path.relpath(fp, dir))
        else:
            zf.write(full, path)
PY
  fi

  echo "Created $out"
}

package_chrome() {
  verify_assets
  if [[ ! -f manifest.json ]]; then
    echo "error: missing manifest.json" >&2
    exit 1
  fi

  create_zip "graph-tab-${VERSION:-unknown}.zip" "." manifest.json "${ASSETS[@]}"
}

package_firefox() {
  verify_assets
  if [[ ! -f manifest.firefox.json ]]; then
    echo "error: missing manifest.firefox.json" >&2
    exit 1
  fi

  local staging
  staging=$(mktemp -d)
  cp manifest.firefox.json "$staging/manifest.json"
  for f in "${ASSETS[@]}"; do
    cp -r "$f" "$staging/"
  done

  create_zip "graph-tab-firefox-${VERSION:-unknown}.zip" "$staging" manifest.json "${ASSETS[@]}"
  rm -rf "$staging"
}

case "$TARGET" in
  chrome) package_chrome ;;
  firefox) package_firefox ;;
  all)
    package_chrome
    package_firefox
    ;;
esac

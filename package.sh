#!/usr/bin/env bash
#
# Builds a Chrome deployment zip containing only the files needed to run the
# extension: PNG icons, the src/ directory, loader.js, background.js and
# manifest.json.
#
set -euo pipefail

cd "$(dirname "$0")"

# Read the version from manifest.json (no jq dependency).
VERSION=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' manifest.json \
  | head -n1 | grep -oE '[0-9]+(\.[0-9]+)*')

OUT="graph-tab-${VERSION:-unknown}.zip"

# Files/dirs to include in the package.
FILES=(
  manifest.json
  loader.js
  background.js
  src
  icon16.png
  icon32.png
  icon48.png
  icon128.png
)

# Verify everything exists before packaging.
for f in "${FILES[@]}"; do
  if [[ ! -e "$f" ]]; then
    echo "error: missing required file '$f'" >&2
    exit 1
  fi
done

rm -f "$OUT"

# Prefer the `zip` CLI; fall back to Python's zipfile module.
if command -v zip >/dev/null 2>&1; then
  # -r recurse into src/, -X strip extra file attributes for a clean archive.
  zip -r -X "$OUT" "${FILES[@]}"
else
  python3 - "$OUT" "${FILES[@]}" <<'PY'
import os
import sys
import zipfile

out, *paths = sys.argv[1:]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for path in paths:
        if os.path.isdir(path):
            for root, _dirs, files in os.walk(path):
                for name in files:
                    full = os.path.join(root, name)
                    zf.write(full, full)
        else:
            zf.write(path, path)
PY
fi

echo "Created $OUT"

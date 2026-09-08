#!/usr/bin/env bash
#
# Parse every JavaScript file in the project as an ES module.
#
# This project has no test suite, so this is the only automated gate between
# a typo and a broken deploy of a live classroom app.
#
# Note: plain `node --check some-file.js` is NOT sufficient here. For a .js
# file that contains `import` statements and does not sit under a package.json
# with "type": "module" (which is every file in public/scripts), Node's CJS
# parse fails, it silently falls back to ESM, and exits 0 even when the file
# has a genuine syntax error. Feeding the source on stdin with
# --input-type=module forces a real ESM parse that actually reports errors.
set -uo pipefail

cd "$(dirname "$0")/../.."

status=0
errfile="$(mktemp)"
trap 'rm -f "$errfile"' EXIT

while IFS= read -r file; do
  if node --check --input-type=module <"$file" 2>"$errfile"; then
    echo "  ok    $file"
  else
    # GitHub Actions annotation, so the failure shows on the file itself.
    echo "::error file=${file}::JavaScript syntax error"
    echo "  FAIL  $file"
    sed 's/^/        /' "$errfile"
    status=1
  fi
done < <(find api/src api/server.js public/scripts -name '*.js' \
  -not -path '*/node_modules/*' | sort)

if [ "$status" -eq 0 ]; then
  echo "All JavaScript files parsed successfully."
fi

exit "$status"

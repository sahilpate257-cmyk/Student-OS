#!/usr/bin/env bash
# Deploy Ledgerly. Stamps a fresh build id into index.html's import map and
# version.json so every visitor picks up the new code instead of sitting on
# cached ES modules, then commits and pushes to GitHub Pages.
#
#   ./deploy.sh "commit message"
set -euo pipefail
cd "$(dirname "$0")"

BUILD="$(date -u +%Y%m%d-%H%M%S)"
MSG="${1:-Deploy $BUILD}"

python3 - "$BUILD" <<'PY'
import re, sys
build = sys.argv[1]
html = open("index.html").read()
html = re.sub(r'\?v=[0-9A-Za-z._-]+', '?v=' + build, html)
html = re.sub(r'var BUILD = "[^"]*"', 'var BUILD = "%s"' % build, html)
open("index.html", "w").write(html)
open("version.json", "w").write('{"build":"%s"}\n' % build)
print("stamped build", build)
PY

if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to deploy — working tree clean."
  exit 0
fi

git add -A
git commit -m "$MSG"
git push origin main
echo
echo "Deployed build $BUILD"
echo "Live in ~1 min: https://sahilpate257-cmyk.github.io/Student-OS/"

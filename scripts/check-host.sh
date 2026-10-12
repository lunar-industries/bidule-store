#!/bin/sh
# Runs tests/host.spec.ts in bidule's real extension host: `sh scripts/check-host.sh` from bidule-store/ (cloned in
# bidule/bidule-store, the modules linked by `npm run store:link`). The test is copied into bidule's functional tests for
# the run and removed after: bidule's own repository never holds it.
#
# Two passes: with the checkout's extensions as they are (the official Temps is on, so the module of time, which
# declares its conflict with it, must be in error), then with a folder of the same extensions without Temps (the module
# of time runs). The second folder is made of links, in a temporary folder removed after.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
core="$here/../core/api"
[ -d "$core" ] || { echo "bidule/core/api introuvable : bidule-store doit être cloné dans bidule/bidule-store" >&2; exit 1; }
target="$core/tests/functional/lunar_modules.spec.ts"
without=$(mktemp -d)
cp "$here/tests/host.spec.ts" "$target"
trap 'rm -f "$target"; rm -rf "$without"' EXIT
for folder in "$here"/../extensions/*/; do
  name=$(basename "$folder")
  [ "$name" = temps ] || ln -s "$(cd "$folder" && pwd)" "$without/$name"
done
cd "$core"
echo "== Avec Temps (officiel) actif"
node ace test functional --files=lunar_modules.spec.ts --force-exit
echo "== Sans Temps"
LUNAR_WITHOUT_TEMPS=1 EXTENSIONS_DIRS="$without" node ace test functional --files=lunar_modules.spec.ts --force-exit

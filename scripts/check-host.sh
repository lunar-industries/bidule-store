#!/bin/sh
# Runs tests/host.spec.ts in bidule's real extension host: `sh scripts/check-host.sh` from bidule-store/ (cloned in
# bidule/bidule-store, the modules linked by `npm run store:link`). The test is copied into bidule's functional tests for
# the run and removed after: bidule's own repository never holds it.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
core="$here/../core/api"
[ -d "$core" ] || { echo "bidule/core/api introuvable : bidule-store doit être cloné dans bidule/bidule-store" >&2; exit 1; }
target="$core/tests/functional/lunar_modules.spec.ts"
cp "$here/tests/host.spec.ts" "$target"
trap 'rm -f "$target"' EXIT
cd "$core"
node ace test functional --files=lunar_modules.spec.ts --force-exit

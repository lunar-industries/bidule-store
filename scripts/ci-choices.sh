#!/bin/sh
# The choice a user makes in Réglages › Rôles, made for the CI, from bidule's root: `sh bidule-store/scripts/ci-choices.sh`
# after scripts/ci-env.mjs. Bidule's Terminal and this store's both provide the role `terminal`; until one is chosen,
# neither holds it, and the extensions that require it (claude, docker, then those that depend on them) are in error.
# The codegen then mounts none of their routes and writes no typed client for them (ui/registry), and the typecheck
# fails. The choice goes where the API reads it, extensions.json in its DATA_DIR (./tmp/data in .env.example, from
# core/api).
set -e
data=core/api/tmp/data
mkdir -p "$data"
printf '%s\n' '{ "disabled": [], "providers": { "terminal": "lunar-industries-terminal" } }' > "$data/extensions.json"

#!/bin/sh
# The choice a user makes in Réglages › Rôles, made for the CI, from bidule's root: `sh bidule-store/scripts/ci-choices.sh`
# after scripts/ci-env.mjs. Bidule's Terminal and this store's both provide the role `terminal`; until one is chosen,
# neither holds it, and the extensions that require it (claude, docker, then those that depend on them) are in error.
# The codegen then mounts none of their routes and writes no typed client for them (ui/registry), and the typecheck
# fails. The choice goes in extensions.json, in the API's DATA_DIR (./tmp/data in .env.example, from core/api). The
# core reads that file before it loads core/api/.env: the steps that generate the code (the codegen, the typecheck)
# give DATA_DIR in their environment, this folder's absolute path. Never the step of the contract test, whose tests
# keep their database in memory (.env.test).
set -e
data=core/api/tmp/data
mkdir -p "$data"
printf '%s\n' '{ "disabled": [], "providers": { "terminal": "lunar-industries-terminal" } }' > "$data/extensions.json"

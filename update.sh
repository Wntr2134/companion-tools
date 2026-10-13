#!/bin/bash
# Pull the latest companion-tools from GitHub and rebuild every module.
# Run from anywhere: bash ~/companion-tools/update.sh
set -e
cd "$(dirname "$0")"
git pull --ff-only
echo "== ulanzi-d200x"; (cd ulanzi-d200x && yarn install && yarn build)
echo "== panasonic-ptz"; (cd panasonic-ptz && yarn install)
echo "== uad-console"; (cd uad-console && yarn install)
echo "== show-health"; (cd show-health && yarn install)
echo "== digico-sd"; (cd digico-sd && yarn install && yarn build)
echo
echo "Done. Companion normally reloads developer modules when their files change."
echo "If a module still shows the old behaviour, restart Companion."

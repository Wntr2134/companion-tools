#!/bin/bash
# Pull the latest companion-tools from GitHub and rebuild every module.
# Run from anywhere: bash ~/companion-tools/update.sh
set -e
cd "$(dirname "$0")"
git pull --ff-only
echo "== ulanzi-d200x"; (cd ulanzi-d200x && yarn install && yarn build)
echo "== panasonic-ptz"; (cd panasonic-ptz && yarn install)
echo "== uad-console"; (cd uad-console && yarn install)
echo "== echo360-capture"; (cd echo360-capture && yarn install)
echo "== magicq"; (cd magicq && yarn install)
echo "== show-health"; (cd show-health && yarn install)
echo "== app-launcher"; (cd app-launcher && yarn install)
echo "== ndi-router"; (cd ndi-router && yarn install)
echo "== ndi-studio-monitor"; (cd ndi-studio-monitor && yarn install)
echo "== spotify-local"; (cd spotify-local && yarn install)
echo "== apple-music-local"; (cd apple-music-local && yarn install)
echo "== digico-sd"; (cd digico-sd && yarn install && yarn build)
echo "== grandma2"; (cd grandma2 && yarn install)
echo
echo "Done. Companion normally reloads developer modules when their files change."
echo "If a module still shows the old behaviour, restart Companion."

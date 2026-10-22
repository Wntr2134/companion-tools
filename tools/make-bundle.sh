#!/usr/bin/env bash
# Builds one Companion "module bundle" from the module packages (.tgz) in a folder.
# In Companion: Modules → Import offline module bundle (5.x; "Import Bundle" in newer versions) →
# choose companion-tools-all-modules.tgz. Not "Import module package": that takes one module only. Every module inside is
# installed in one go (versions already installed are skipped).
#
# Bundle layout (what Companion expects): a top folder, then one folder per module, each with
# companion/manifest.json directly inside:
#   companion-tools/<module-id>/companion/manifest.json
#
# Usage: tools/make-bundle.sh <folder with .tgz packages> <output .tgz>
set -euo pipefail
src="$1"
out="$2"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bundle/companion-tools"
count=0
for pkg in "$src"/*.tgz; do
	[ -e "$pkg" ] || continue
	x="$work/x/$(basename "$pkg" .tgz)"
	mkdir -p "$x"
	tar -xzf "$pkg" -C "$x"
	# Older packaging puts the module in pkg/, newer in a folder named after the module: take whichever is there.
	top="$(find "$x" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
	manifest="$top/companion/manifest.json"
	if [ ! -f "$manifest" ]; then
		echo "skip $(basename "$pkg"): no companion/manifest.json" >&2
		continue
	fi
	id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).id)' "$manifest")"
	mv "$top" "$work/bundle/companion-tools/$id"
	echo "added $id"
	count=$((count + 1))
done
[ "$count" -gt 0 ] || { echo "no packages found in $src" >&2; exit 1; }
tar -czf "$out" -C "$work/bundle" companion-tools
echo "bundle: $out ($count modules)"

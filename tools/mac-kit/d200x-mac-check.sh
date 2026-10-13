#!/bin/bash
# D200X on macOS: read-only checks. Changes nothing, needs no admin.
# Run with the D200X plugged in. Pass the plugin folder if it is not the default:
#   bash ~/Downloads/d200x-mac-check.sh [path/to/companion-surface-ulanzi-stream-controller] 2>&1 | tee ~/Desktop/d200x-check.txt

echo "=== macOS / hardware ==="
sw_vers
uname -m

echo
echo "=== 1. USB tree: is the real HID device (2207:0019) there? ==="
# ioreg is the most reliable on every macOS version
ioreg -p IOUSB -l -w0 2>/dev/null | awk '
  function flush() { if (name != "" && v != "") printf "  %-40s vendor=0x%04x product=0x%04x\n", name, v, p }
  /\+-o / { flush(); name=$0; sub(/^.*\+-o /,"",name); sub(/@.*/,"",name); v=""; p="" }
  /"idVendor" =/  { v=$NF }
  /"idProduct" =/ { p=$NF }
  END { flush() }
' | grep -iE 'vendor=0x2207|vendor=0x18d1|ulanzi|hub' || echo "  (nothing Ulanzi-like in the USB tree)"
echo "  WANT: vendor=0x2207 product=0x0019."
echo "  Only vendor=0x18d1 product=0xd002 = the Linux-style enumeration failure -> try a USB 2 hub."

echo
echo "=== 2. HID layer: has macOS built HID interfaces for it? ==="
ioreg -r -c IOHIDDevice -l -w0 2>/dev/null | grep -E '"VendorID" = 8711|"Product" =|"PrimaryUsagePage"|"PrimaryUsage"|"Transport"' \
  | grep -B1 -A3 '"VendorID" = 8711' || echo "  (no IOHIDDevice with VendorID 8711 / 0x2207)"

echo
echo "=== 3. Is anything else holding the device? ==="
pgrep -fl -i 'ulanzi' || echo "  no Ulanzi processes running (good)"
for d in ~/Library/LaunchAgents /Library/LaunchAgents /Library/LaunchDaemons; do
  ls "$d" 2>/dev/null | grep -i ulanzi | sed "s|^|  login item: $d/|"
done
ls -d /Applications/*lanzi* 2>/dev/null | sed 's/^/  installed: /'
pgrep -fl -i 'companion' | head -5

echo
echo "=== 4. Companion version + logs ==="
for app in /Applications/Companion.app /Applications/Bitfocus\ Companion.app; do
  [ -d "$app" ] && /usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null | sed "s|^|  $app version |"
done
CDIR="$HOME/Library/Application Support/companion"
if [ -d "$CDIR" ]; then
  LOG=$(find "$CDIR" -name '*.log' -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
  if [ -n "$LOG" ]; then
    echo "  latest log: $LOG"
    grep -iE 'ulanzi|d200|surface module|hid|Failed to open|EACCES|error loading' "$LOG" | tail -40
  else
    echo "  no .log files under $CDIR. Use launcher > Show logs and copy the text instead."
  fi
fi

echo
echo "=== 5. Plugin build ==="
P="${1:-$HOME/companion-dev/companion-surface-ulanzi-stream-controller}"
echo "  plugin folder: $P"
[ -f "$P/dist/main.js" ] && echo "  dist/main.js present" || echo "  MISSING dist/main.js: run yarn build"
[ -d "$P/node_modules/node-hid" ] && echo "  node-hid installed" || echo "  MISSING node_modules/node-hid: run yarn install"
ls "$P/node_modules/node-hid/prebuilds" 2>/dev/null | sed 's/^/  node-hid prebuild: /'
node -v

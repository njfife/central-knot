#!/bin/bash
# Makes assets/dmg/DS_Store again: the Finder view of the disk image's window (size, icon places, background picture) that
# scripts/mac-dmg.mjs copies into every disk image. Run on a Mac after changing the layout below or the picture's size.
# It needs python3 and the network once (dmgbuild, into a throwaway folder); it doesn't need Finder or a signed-in desktop.
set -eu
cd "$(dirname "$0")/.."
work=$(mktemp -d); trap 'hdiutil detach "$work/volume" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
python3 -m venv "$work/venv" && "$work/venv/bin/pip" -q install dmgbuild==1.6.7
tiffutil -cathidpicheck assets/dmg/background.png assets/dmg/background@2x.png -out "$work/background.tiff"
mkdir -p "$work/Central Knot.app"
cat > "$work/settings.py" <<SETTINGS
format = "UDZO"
files = ["$work/Central Knot.app"]
symlinks = {"Applications": "/Applications"}
background = "$work/background.tiff"
# Icon centres, in the 660 by 400 picture: the arrow is drawn between them.
icon_locations = {"Central Knot.app": (170, 180), "Applications": (490, 180)}
window_rect = ((200, 120), (660, 400))
default_view = "icon-view"
include_icon_view_settings = True
show_icon_preview = False
arrange_by = None
icon_size = 128
text_size = 13
label_pos = "bottom"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
SETTINGS
"$work/venv/bin/dmgbuild" -s "$work/settings.py" "Central Knot" "$work/layout.dmg" >/dev/null
hdiutil attach "$work/layout.dmg" -nobrowse -noautoopen -readonly -mountpoint "$work/volume" >/dev/null
cp "$work/volume/.DS_Store" assets/dmg/DS_Store
echo "assets/dmg/DS_Store written"

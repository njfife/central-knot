#!/bin/bash
# Renders the design preview states into a new folder $1, inside the Linux test container.
set -eu
OUT="$1"; mkdir -p "$OUT"
S=$(mktemp -d /tmp/ck-design-src-XXXX)
git ls-files -co --exclude-standard | grep -v '^node_modules' | tar -cf - -T - | tar -x -C "$S"
chmod -R a+rwX "$S"; mkdir -p "$S/out"; chmod a+rwx "$S/out"
docker run --rm --shm-size=1g -e VARIANT="${VARIANT:-a}" -v "$S:/home/e2e/src" ck-e2e-linux bash -lc 'cd /home/e2e/src; npm ci --silent >/dev/null 2>&1; npx --no-install electron --version >/dev/null 2>&1; npm run --silent build; xvfb-run -a -s "-screen 0 1280x800x24" node scripts/design-shots.mjs out --electron --no-sandbox 2>&1 | tail -2'
cp "$S"/out/*.png "$OUT"/
docker run --rm -v /tmp:/t alpine sh -c "rm -rf /t/$(basename "$S")" >/dev/null 2>&1

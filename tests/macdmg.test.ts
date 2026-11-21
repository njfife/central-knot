// A disk image attached and detached by the Mac packaging (scripts/mac-dmg.mjs whileAttached), against a stand-in hdiutil on
// PATH that plays what a GitHub-hosted Mac did (2026-11-21): the first detach unmounts the volume, then is refused the eject
// ("Resource busy"), so the mount's path is gone while the disk is still attached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whileAttached } from '../scripts/mac-dmg.mjs';

const PATH = process.env.PATH;

/**
 * A stand-in hdiutil, first on PATH until the test ends (the last one made, where a test makes two). Its attach mounts the image (a folder at the mount) as /dev/disk5 and
 * prints the device table hdiutil prints. Each detach of the disk or of its mount unmounts the volume, then: says `refusal`
 * if given; or, while `busy` refusals are left, refuses the eject as busy (`goes`: the system ejects it on its own just
 * after); or ejects it. A detach of a disk or a mount that is no longer there fails as hdiutil's does.
 */
function standIn(t: { after: (done: () => void) => void }, { busy = 0, goes = false, refusal = '' } = {}) {
  const box = mkdtempSync(join(tmpdir(), 'ck-hdiutil-'));
  writeFileSync(join(box, 'busy'), String(busy));
  writeFileSync(join(box, 'hdiutil'), `#!/bin/sh
box='${box}'
echo "$*" >> "$box/calls"
case "$1" in
  attach)
    mkdir -p "$6" && echo "$6" > "$box/attached"
    printf '/dev/disk5\\tGUID_partition_scheme\\t\\n/dev/disk5s1\\tApple_HFS\\t%s\\n' "$6"; exit 0;;
  detach)
    if { [ "$2" = /dev/disk5 ] && [ -f "$box/attached" ]; } || [ -d "$2" ]; then :; else
      echo 'hdiutil: detach failed - No such file or directory' >&2; exit 1; fi
    rmdir "$(cat "$box/attached")" 2>/dev/null
    ${refusal ? `echo '${refusal}' >&2; exit 1` : ':'}
    left=$(cat "$box/busy")
    if [ "$left" -gt 0 ]; then
      echo $((left - 1)) > "$box/busy"
      ${goes ? 'rm "$box/attached"' : ':'}
      echo 'hdiutil: couldn'"'"'t eject "disk5" - Resource busy' >&2; exit 16
    fi
    rm "$box/attached"; echo '"disk5" ejected.'; exit 0;;
esac
`);
  chmodSync(join(box, 'hdiutil'), 0o755);
  process.env.PATH = `${box}:${PATH}`;
  t.after(() => { process.env.PATH = PATH; rmSync(box, { recursive: true, force: true }); });
  return {
    image: join(box, 'writable.dmg'), mount: join(box, 'volume'),
    calls: () => readFileSync(join(box, 'calls'), 'utf8').trimEnd().split('\n'),
    detaches: () => readFileSync(join(box, 'calls'), 'utf8').trimEnd().split('\n').filter(call => call.startsWith('detach')),
    attached: () => existsSync(join(box, 'attached')),
  };
}

test('A disk refused its eject once (“Resource busy”) is detached by its device on the next try, as a hosted Mac refused it', t => {
  const disk = standIn(t, { busy: 1 });
  assert.equal(whileAttached(disk.image, disk.mount, ['-readonly'], () => existsSync(disk.mount)), true, 'what is done runs on the mounted image');
  assert.deepEqual(disk.calls(), [`attach ${disk.image} -nobrowse -noautoopen -mountpoint ${disk.mount} -readonly`, 'detach /dev/disk5', 'detach /dev/disk5 -force']);
  assert.equal(disk.attached(), false);
});

test('A disk that is no longer attached when it is tried again counts as detached', t => {
  const disk = standIn(t, { busy: 1, goes: true });
  whileAttached(disk.image, disk.mount, [], () => {});
  assert.deepEqual(disk.detaches(), ['detach /dev/disk5', 'detach /dev/disk5 -force']);
});

test('A disk still busy after five tries fails in hdiutil’s words, and any other refusal fails at once', t => {
  const held = standIn(t, { busy: 9 });
  assert.throws(() => whileAttached(held.image, held.mount, [], () => {}), /couldn't eject "disk5" - Resource busy/);
  assert.equal(held.detaches().length, 5);
  const refused = standIn(t, { refusal: 'hdiutil: detach failed - Operation not permitted' });
  assert.throws(() => whileAttached(refused.image, refused.mount, [], () => {}), /Operation not permitted/);
  assert.deepEqual(refused.detaches(), ['detach /dev/disk5']);
});

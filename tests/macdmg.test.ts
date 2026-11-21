// A disk image attached and detached by the Mac packaging (scripts/mac-dmg.mjs whileAttached), against a stand-in hdiutil on
// PATH that gives the answers a GitHub-hosted Mac gave (2026-11-21): the first detach unmounted the volume and was refused the
// eject ("Resource busy"), and the retry by the mount's path then found nothing there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whileAttached } from '../scripts/mac-dmg.mjs';

const PATH = process.env.PATH;
const busy = 'hdiutil: couldn\'t eject "disk5" - Resource busy', gone = 'hdiutil: detach failed - No such file or directory';

/**
 * Attaches and detaches a made-up image with a stand-in hdiutil first on PATH: its attach prints the device table hdiutil
 * prints for /dev/disk5, and its nth detach refuses in the words `refusals[n-1]`, or succeeds past their end. Returns the
 * stand-in's calls, after them.
 */
function detachWith(t: { after: (done: () => void) => void }, refusals: string[]) {
  const box = mkdtempSync(join(tmpdir(), 'ck-hdiutil-'));
  t.after(() => { process.env.PATH = PATH; rmSync(box, { recursive: true, force: true }); });
  writeFileSync(join(box, 'hdiutil'), `#!/bin/sh
echo "$*" >> '${box}/calls'
[ "$1" = attach ] && { printf '/dev/disk5\\tGUID_partition_scheme\\t\\n/dev/disk5s1\\tApple_HFS\\t%s\\n' "$6"; exit 0; }
case $(grep -c ^detach '${box}/calls') in
${refusals.map((words, n) => `  ${n + 1}) echo '${words.replace(/'/g, "'\\''")}' >&2; exit 1;;`).join('\n')}
esac`);
  chmodSync(join(box, 'hdiutil'), 0o755);
  process.env.PATH = `${box}:${PATH}`;
  const image = join(box, 'writable.dmg'), mount = join(box, 'volume');
  assert.equal(whileAttached(image, mount, ['-readonly'], () => 'done', 0), 'done', 'what is done on the image is done, and returned');
  return readFileSync(join(box, 'calls'), 'utf8').trimEnd().split('\n').map(call => call.replaceAll(box, '<box>'));
}

test('A disk refused its eject (“Resource busy”) is detached by its device, tried again forced: no longer there is detached', t => {
  assert.deepEqual(detachWith(t, [busy, gone]), [
    'attach <box>/writable.dmg -nobrowse -noautoopen -mountpoint <box>/volume -readonly', 'detach /dev/disk5', 'detach /dev/disk5 -force']);
  assert.deepEqual(detachWith(t, Array(5).fill(busy)).slice(1), ['detach /dev/disk5', ...Array(5).fill('detach /dev/disk5 -force')]);
});

test('A disk still busy after twelve tries fails in hdiutil’s words, and any other refusal fails at once', t => {
  assert.throws(() => detachWith(t, Array(15).fill(busy)), /Resource busy/);
  assert.throws(() => detachWith(t, ['hdiutil: detach failed - Operation not permitted']), /Operation not permitted/);
});

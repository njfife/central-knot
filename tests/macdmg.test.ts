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
type Fail = Error & { calls: string[]; image: string; mount: string; leftMounted?: boolean };
function detachWith(t: { after: (done: () => void) => void }, refusals: string[], attachOut = '/dev/disk5\tGUID_partition_scheme\t\n/dev/disk5s1\tApple_HFS\t', use = () => 'done') {
  const box = mkdtempSync(join(tmpdir(), 'ck-hdiutil-'));
  t.after(() => { process.env.PATH = PATH; rmSync(box, { recursive: true, force: true }); });
  writeFileSync(join(box, 'hdiutil'), `#!/bin/sh
echo "$*" >> '${box}/calls'
[ "$1" = attach ] && { printf '${attachOut.replace(/\n/g, '\\n')}%s\\n' "$6"; exit 0; }
case $(grep -c ^detach '${box}/calls') in
${refusals.map((words, n) => `  ${n + 1}) echo '${words.replace(/'/g, "'\\''")}' >&2; exit 1;;`).join('\n')}
esac`);
  chmodSync(join(box, 'hdiutil'), 0o755);
  process.env.PATH = `${box}:${PATH}`;
  const image = join(box, 'writable.dmg'), mount = join(box, 'volume');
  const calls = () => readFileSync(join(box, 'calls'), 'utf8').trimEnd().split('\n').map(call => call.replaceAll(box, '<box>'));
  try { assert.equal(whileAttached(image, mount, ['-readonly'], use, 0), 'done', 'what is done on the image is done, and returned'); return calls(); }
  catch (error) { throw Object.assign(error as Error, { calls: calls(), image, mount }); }
}

test('A disk refused its eject (“Resource busy”) is detached by its device, tried again forced: no longer there is detached', t => {
  assert.deepEqual(detachWith(t, [busy, gone]), [
    'attach <box>/writable.dmg -nobrowse -noautoopen -mountpoint <box>/volume -readonly', 'detach /dev/disk5', 'detach /dev/disk5 -force']);
  assert.deepEqual(detachWith(t, Array(5).fill(busy)).slice(1), ['detach /dev/disk5', ...Array(5).fill('detach /dev/disk5 -force')]);
});

test('A disk still busy after twelve tries fails naming image, mount and device, any other refusal fails at once, and work errors or bad attach output are not lost', t => {
  const namesAll = (e: Fail) => e.message.includes(e.image) && e.message.includes(e.mount) && e.message.includes('/dev/disk5') && e.leftMounted === true;
  assert.throws(() => detachWith(t, Array(15).fill(busy)), (e: Fail) => /Resource busy/.test(e.message) && namesAll(e) && e.calls.slice(1).length === 12);
  assert.throws(() => detachWith(t, ['hdiutil: detach failed - Operation not permitted']), (e: Fail) => /Operation not permitted/.test(e.message) && namesAll(e) && e.calls.slice(1).length === 1);
  assert.throws(() => detachWith(t, [], 'unexpected output '), (e: Fail) => /named no disk/.test(e.message) && e.calls[1] === 'detach <box>/volume');
  assert.throws(() => detachWith(t, ['hdiutil: detach failed - Operation not permitted'], undefined, () => { throw new Error('work broke'); }),
    (e: Fail) => /work broke/.test(e.message) && /Operation not permitted/.test(e.message) && namesAll(e));
});

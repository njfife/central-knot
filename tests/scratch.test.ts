// The scripts' shared clean-up (scripts/scratch.ts): every app and stand-in a script opens is in it and is given its
// temporary places, and Chromium on a Mac is given one only where its socket's path fits macOS's limit.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempPlaces } from '../scripts/scratch.ts';

test('Every app and stand-in a script with the shared clean-up opens is put in it, and an app is given both temporary places', () => {
  const scripts = join(import.meta.dirname, '../scripts');
  const missed = readdirSync(scripts).map(name => [name, readFileSync(join(scripts, name), 'utf8').split('\n')] as const)
    .filter(([, lines]) => lines.some(line => line.includes("from './scratch.ts'")))
    .flatMap(([name, lines]) => lines.flatMap((line, at) => {
      const near = lines.slice(Math.max(0, at - 6), at + 4).join('\n'), app = /\bspawn\((command|exe),/.test(line);
      return (app || line.includes('standInApp(')) && !(near.includes('launched.add(') && (!app || near.includes('tempPlaces('))) ? [`${name}:${at + 1}`] : [];
    }));
  assert.deepEqual(missed, []);
});

test('Chromium on a Mac is given the folder only where its socket, scoped_dirXXXXXX/SingletonSocket in it, fits in 103 characters', () => {
  const run = '/private/tmp/ck-ci-44880740815-1/ck-e2e-AbCdEf/tmp', account = '/private/var/folders/8f/hm03jgv53_q5j68sw42ypmhw0000gp/T/ck-e2e-AbCdEf/tmp';
  assert.deepEqual([`${run}/scoped_dirXXXXXX/SingletonSocket`.length, `${account}/scoped_dirXXXXXX/SingletonSocket`.length], [83, 107]);
  assert.deepEqual(tempPlaces(run), { TMPDIR: run, MAC_CHROMIUM_TMPDIR: run });
  assert.deepEqual(tempPlaces(account), { TMPDIR: account });
});

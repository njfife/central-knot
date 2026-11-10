import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInLabel, signInState, type LoginItems } from '../src/signin.ts';
import type { SignInReason } from '../src/types.ts';

// The real login items exist only in an installed app on macOS and Windows, so this is where their answers are read.
test('Start at sign-in shows the system’s answer, and why it is off or can’t be changed, the same wherever it is asked', () => {
  const mac = { platform: 'darwin', packaged: true, exe: '/Applications/Central Knot.app/Contents/MacOS/Central Knot', smoke: false };
  const windows = { platform: 'win32', packaged: true, exe: 'C:\\Users\\a\\AppData\\Local\\Programs\\Central Knot\\Central Knot.exe', smoke: false };
  const item = (enabled: boolean, path = windows.exe.toUpperCase(), args = ['--hidden']) => ({ path, args, enabled });
  // Expected: on, whether it can be changed here, and the reason's key (each reason's words live in signin.ts).
  const cases: [string, typeof mac, LoginItems | undefined, [boolean, boolean, SignInReason?]][] = [
    ['smoke test', { ...mac, smoke: true }, undefined, [false, false, 'testing']],
    ['dev build, any system', { ...windows, packaged: false }, undefined, [false, false, 'dev']],
    ['installed on Linux', { ...mac, platform: 'linux', exe: '/opt/Central Knot/central-knot' }, undefined, [false, false, 'linux']],
    ['macOS outside Applications', { ...mac, exe: '/Users/a/Downloads/Central Knot.app/Contents/MacOS/Central Knot' }, undefined, [false, false, 'applications']],
    ['macOS on', mac, { openAtLogin: true, status: 'enabled' }, [true, true]],
    ['macOS waiting for approval', mac, { openAtLogin: true, status: 'requires-approval' }, [false, true, 'approval']],
    ['macOS removed from Login Items', mac, { openAtLogin: false, status: 'not-registered' }, [false, true]],
    ['macOS 12, no status', mac, { openAtLogin: true }, [true, true]],
    ['Windows on', windows, { openAtLogin: true, launchItems: [item(true)] }, [true, true]],
    ['Windows turned off in Task Manager', windows, { openAtLogin: true, launchItems: [item(false)] }, [false, true, 'startupApps']],
    ['Windows, only another copy or other arguments', windows, { openAtLogin: true, launchItems: [item(true, 'C:\\Old\\Central Knot.exe'), item(true, windows.exe, [])] }, [false, true]],
  ];
  for (const [name, facts, items, expected] of cases) {
    let asked = false;
    const state = signInState(facts, () => { asked = true; return items!; });
    const [on, available, reason] = expected;
    assert.deepEqual([state.on, state.available, state.reason?.key], [on, available, reason], name);
    // Wherever it can be changed here, the page can name the system's place for it and open it.
    assert.equal(!!state.place, state.available, `${name}: place`);
    // Where a login item can't exist, the system is never asked (no login-item calls on Linux or in a dev build).
    assert.equal(asked, items !== undefined, `${name}: system asked`);
  }
  // The menus carry the same reason as Settings, shortened.
  const label = (index: number) => signInLabel(signInState(cases[index][1], () => cases[index][2]!));
  assert.equal(label(3), 'Start at sign-in (move to Applications first)');
  assert.equal(label(4), 'Start at sign-in');
});

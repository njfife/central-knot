import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInLabel, signInState, type LoginItems } from '../src/signin.ts';

// The real login items exist only in an installed app on macOS and Windows, so this is where their answers are read.
test('Start at sign-in shows the system’s answer, and why it is off or can’t be changed, the same wherever it is asked', () => {
  const mac = { platform: 'darwin', packaged: true, exe: '/Applications/Central Knot.app/Contents/MacOS/Central Knot', smoke: false };
  const windows = { platform: 'win32', packaged: true, exe: 'C:\\Users\\a\\AppData\\Local\\Programs\\Central Knot\\Central Knot.exe', smoke: false };
  const item = (enabled: boolean, path = windows.exe.toUpperCase(), args = ['--hidden']) => ({ path, args, enabled });
  const cases: [string, typeof mac, LoginItems | undefined, ReturnType<typeof signInState>][] = [
    ['smoke test', { ...mac, smoke: true }, undefined, { on: false, available: false, reason: 'Not available during testing.' }],
    ['dev build, any system', { ...windows, packaged: false }, undefined, { on: false, available: false, reason: 'Only the installed app can start at sign-in.' }],
    ['installed on Linux', { ...mac, platform: 'linux', exe: '/opt/Central Knot/central-knot' }, undefined, { on: false, available: false, reason: 'Not available on Linux yet.' }],
    ['macOS outside Applications', { ...mac, exe: '/Users/a/Downloads/Central Knot.app/Contents/MacOS/Central Knot' }, undefined, { on: false, available: false, reason: 'Move Central Knot to the Applications folder first.' }],
    ['macOS on', mac, { openAtLogin: true, status: 'enabled' }, { on: true, available: true }],
    ['macOS waiting for approval', mac, { openAtLogin: true, status: 'requires-approval' }, { on: false, available: true, reason: 'Allow Central Knot in Login Items in System Settings to finish turning this on.' }],
    ['macOS removed from Login Items', mac, { openAtLogin: false, status: 'not-registered' }, { on: false, available: true }],
    ['macOS 12, no status', mac, { openAtLogin: true }, { on: true, available: true }],
    ['Windows on', windows, { openAtLogin: true, launchItems: [item(true)] }, { on: true, available: true }],
    ['Windows turned off in Task Manager', windows, { openAtLogin: true, launchItems: [item(false)] }, { on: false, available: true, reason: 'Turned off in your system’s startup settings.' }],
    ['Windows, only another copy or other arguments', windows, { openAtLogin: false, launchItems: [item(true, 'C:\\Old\\Central Knot.exe'), item(true, windows.exe, [])] }, { on: false, available: true }],
  ];
  for (const [name, facts, items, expected] of cases) {
    let asked = false;
    const state = signInState(facts, () => { asked = true; return items!; });
    assert.deepEqual(state, expected, name);
    // Where a login item can't exist, the system is never asked (no login-item calls on Linux or in a dev build).
    assert.equal(asked, items !== undefined, `${name}: system asked`);
  }
  // The menus carry the same reason as Settings.
  assert.equal(signInLabel(cases[3][3]), 'Start at sign-in (move Central Knot to the Applications folder first)');
  assert.equal(signInLabel(cases[4][3]), 'Start at sign-in');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { desktopEntry, keepEntries, linuxPlaces, placeAutostart, readAutostart, signInLabel, signInState, type LoginItems } from '../src/signin.ts';
import type { SignInReason } from '../src/types.ts';

// The real login items exist only in an installed app on macOS and Windows, and Linux's autostart file only beside an AppImage,
// so this is where their answers are read.
test('Start at sign-in shows the system’s answer, and why it is off or can’t be changed, the same wherever it is asked', () => {
  const mac = { platform: 'darwin', packaged: true, exe: '/Applications/Central Knot.app/Contents/MacOS/Central Knot', smoke: false };
  const windows = { platform: 'win32', packaged: true, exe: 'C:\\Users\\a\\AppData\\Local\\Programs\\Central Knot\\Central Knot.exe', smoke: false };
  const linux = { platform: 'linux', packaged: true, exe: '/tmp/.mount_CentraXYZ/Central Knot', smoke: false, appImage: '/home/a/Applications/Central-Knot-0.7.0-linux-x86_64.AppImage' };
  const item = (enabled: boolean, path = windows.exe.toUpperCase(), args = ['--hidden']) => ({ path, args, enabled });
  // Expected: on, whether it can be changed here, and the reason's key (each reason's words live in signin.ts).
  const cases: [string, typeof linux | typeof mac, LoginItems | undefined, [boolean, boolean, SignInReason?]][] = [
    ['smoke test', { ...mac, smoke: true }, undefined, [false, false, 'testing']],
    ['dev build, any system', { ...windows, packaged: false }, undefined, [false, false, 'dev']],
    ['installed on Linux, not from an AppImage', { ...linux, appImage: undefined, exe: '/opt/Central Knot/central-knot' }, undefined, [false, false, 'appImage']],
    ['macOS outside Applications', { ...mac, exe: '/Users/a/Downloads/Central Knot.app/Contents/MacOS/Central Knot' }, undefined, [false, false, 'applications']],
    ['macOS on', mac, { openAtLogin: true, status: 'enabled' }, [true, true]],
    ['macOS waiting for approval', mac, { openAtLogin: true, status: 'requires-approval' }, [false, true, 'approval']],
    ['macOS removed from Login Items', mac, { openAtLogin: false, status: 'not-registered' }, [false, true]],
    ['macOS 12, no status', mac, { openAtLogin: true }, [true, true]],
    ['Windows on', windows, { openAtLogin: true, launchItems: [item(true)] }, [true, true]],
    ['Windows turned off in Task Manager', windows, { openAtLogin: true, launchItems: [item(false)] }, [false, true, 'startupApps']],
    ['Windows, only another copy or other arguments', windows, { openAtLogin: true, launchItems: [item(true, 'C:\\Old\\Central Knot.exe'), item(true, windows.exe, [])] }, [false, true]],
    ['Linux AppImage, its autostart file there', linux, { openAtLogin: true }, [true, true]],
    ['Linux AppImage, none there', linux, { openAtLogin: false }, [false, true]],
    ['Linux AppImage, a file it didn’t write in its place', linux, { openAtLogin: false, another: '/home/a/.config/autostart/com.centralknot.firstlook.desktop' }, [false, false, 'another']],
  ];
  for (const [name, facts, items, expected] of cases) {
    let asked = false;
    const state = signInState(facts, () => { asked = true; return items!; });
    const [on, available, reason] = expected;
    assert.deepEqual([state.on, state.available, state.reason?.key], [on, available, reason], name);
    // Wherever it can be changed here, the page can name the system's place for it and open it; Linux has no such place:
    // the file is Central Knot's own, so the switch is the place.
    assert.equal(!!state.place, state.available && facts.platform !== 'linux', `${name}: place`);
    // Where a login item can't exist, the system is never asked (no login-item calls or autostart reads in a dev build).
    assert.equal(asked, items !== undefined, `${name}: system asked`);
  }
  // The menus carry the same reason as Settings, shortened.
  const label = (index: number) => signInLabel(signInState(cases[index][1], () => cases[index][2]!));
  assert.equal(label(3), 'Start at sign-in (move to Applications first)');
  assert.equal(label(4), 'Start at sign-in');
  assert.equal(label(2), 'Start at sign-in (AppImage only)');
  // The file left alone is named, so the person can find it.
  assert.equal(signInState(cases[13][1], () => cases[13][2]!).reason?.text, 'Another file is in its place, which Central Knot didn’t write and leaves as it is: /home/a/.config/autostart/com.centralknot.firstlook.desktop.');
});

test('XDG places: the config and data folders the environment names, else ~/.config and ~/.local/share; a relative one is ignored', () => {
  assert.deepEqual(linuxPlaces('/home/a', {}, 'com.centralknot.alpha'), {
    autostart: '/home/a/.config/autostart/com.centralknot.alpha.desktop',
    launcher: '/home/a/.local/share/applications/com.centralknot.alpha.desktop',
    icon: '/home/a/.local/share/icons/hicolor/512x512/apps/com.centralknot.alpha.png',
  });
  assert.deepEqual(linuxPlaces('/home/a', { XDG_CONFIG_HOME: '/srv/config', XDG_DATA_HOME: 'data' }, 'id'), {
    autostart: '/srv/config/autostart/id.desktop', launcher: '/home/a/.local/share/applications/id.desktop', icon: '/home/a/.local/share/icons/hicolor/512x512/apps/id.png',
  });
});

// An AppImage someone keeps in a folder whose name has a quote, a dollar sign and a percent sign: the Exec value quotes it, escapes
// the quote and the dollar, doubles every backslash that makes (the string type's escape), and doubles the percent (a field code).
const app = { name: 'Central Knot Alpha', id: 'com.centralknot.alpha', appImage: '/home/a/My "Apps" $1 100%/Central-Knot-Alpha.AppImage' };
const exec = 'Exec="/home/a/My \\\\"Apps\\\\" \\\\$1 100%%/Central-Knot-Alpha.AppImage"';

test('the two desktop entry files, exactly as written: the launcher opens the AppImage, the autostart file opens it hidden', () => {
  assert.equal(desktopEntry(app, 'launcher'), [
    '[Desktop Entry]', 'Type=Application', 'Name=Central Knot Alpha', exec, 'Icon=com.centralknot.alpha', 'Terminal=false', 'Categories=Development;', 'X-Central-Knot=true', '',
  ].join('\n'));
  assert.equal(desktopEntry(app, 'autostart'), [
    '[Desktop Entry]', 'Type=Application', 'Name=Central Knot Alpha', `${exec} --hidden`, 'Icon=com.centralknot.alpha', 'Terminal=false', 'X-Central-Knot=true', '',
  ].join('\n'));
});

test('Linux start at sign-in is Central Knot’s own autostart file: written whole when on, removed when off, read back as on or off', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ck-signin-'));
  try {
    const places = linuxPlaces(home, {}, app.id);
    assert.deepEqual(readAutostart(places), { openAtLogin: false }, 'none yet: off');
    assert.equal(await placeAutostart(places, app, true), true);
    assert.equal(readFileSync(places.autostart, 'utf8'), desktopEntry(app, 'autostart'), 'on: the folder is made and the file written');
    assert.deepEqual(readAutostart(places), { openAtLogin: true });
    // The desktop's own settings turned it off the spec's way: it reads as off, and on again writes it whole.
    writeFileSync(places.autostart, `${desktopEntry(app, 'autostart')}Hidden = true\n`);
    assert.deepEqual(readAutostart(places), { openAtLogin: false }, 'Hidden=true is off, with or without spaces around =');
    assert.equal(await placeAutostart(places, app, true), true);
    assert.equal(readFileSync(places.autostart, 'utf8'), desktopEntry(app, 'autostart'));
    assert.equal(await placeAutostart(places, app, false), true);
    assert.equal(existsSync(places.autostart), false, 'off: removed');
    assert.equal(await placeAutostart(places, app, false), true, 'off again with none there: nothing to do');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('a file in either place that Central Knot didn’t write is never written over or removed, and sign-in says so', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ck-signin-'));
  try {
    const places = linuxPlaces(home, {}, app.id);
    const theirs = '[Desktop Entry]\nType=Application\nName=Mine\nExec=/usr/bin/true\n';
    for (const path of [places.autostart, places.launcher]) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, theirs); }
    assert.deepEqual(readAutostart(places), { openAtLogin: false, another: places.autostart });
    assert.equal(await placeAutostart(places, app, true), false, 'not turned on over it');
    assert.equal(await placeAutostart(places, app, false), false, 'not removed to turn it off');
    assert.deepEqual(await keepEntries(places, app, Buffer.from('icon')), [], 'the launcher entry is not put over it');
    assert.deepEqual([readFileSync(places.autostart, 'utf8'), readFileSync(places.launcher, 'utf8'), existsSync(places.icon)], [theirs, theirs, false]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('at each start the launcher entry and its icon are put in place, and follow the AppImage when it moves; an autostart file that is on follows too', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ck-signin-'));
  try {
    const places = linuxPlaces(home, {}, app.id), icon = Buffer.from([137, 80, 78, 71]);
    assert.deepEqual(await keepEntries(places, app, icon), [places.icon, places.launcher], 'first open: icon, then the entry that names it');
    assert.deepEqual([readFileSync(places.launcher, 'utf8'), readFileSync(places.icon)], [desktopEntry(app, 'launcher'), icon]);
    // Its own entry, edited by the person (a menu editor's comment, say), still naming this AppImage: left as it is. Off stays off.
    writeFileSync(places.launcher, `${desktopEntry(app, 'launcher')}Comment=Mine\n`);
    assert.deepEqual(await keepEntries(places, app, icon), []);
    assert.equal(existsSync(places.autostart), false, 'start at sign-in off: no autostart file appears');
    // Turned on, then the AppImage is moved: both entries name the new place at the next start.
    await placeAutostart(places, app, true);
    const moved = { ...app, appImage: '/home/a/Applications/Central-Knot-Alpha.AppImage' };
    assert.deepEqual(await keepEntries(places, moved, icon), [places.icon, places.launcher, places.autostart]);
    assert.deepEqual([readFileSync(places.launcher, 'utf8'), readFileSync(places.autostart, 'utf8')], [desktopEntry(moved, 'launcher'), desktopEntry(moved, 'autostart')]);
    // One the desktop turned off (Hidden=true) is not turned back on by a move.
    writeFileSync(places.autostart, `${desktopEntry(moved, 'autostart')}Hidden=true\n`);
    assert.deepEqual(await keepEntries(places, app, icon), [places.icon, places.launcher]);
    assert.equal(readFileSync(places.autostart, 'utf8').includes(moved.appImage), true);
    // A launcher entry the person removed comes back: it is how the launcher and the taskbar know the app.
    rmSync(places.launcher);
    assert.deepEqual(await keepEntries(places, app, icon), [places.icon, places.launcher]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

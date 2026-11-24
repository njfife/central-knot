import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const named = (name: string) => { const [, facts, items] = cases.find(([each]) => each === name)!; return signInState(facts, () => items!); };
  assert.equal(signInLabel(named('macOS outside Applications')), 'Start at sign-in (move to Applications first)');
  assert.equal(signInLabel(named('macOS on')), 'Start at sign-in');
  assert.equal(signInLabel(named('installed on Linux, not from an AppImage')), 'Start at sign-in (AppImage only)');
  // The file left alone is named, so the person can find it.
  assert.equal(named('Linux AppImage, a file it didn’t write in its place').reason?.text, 'Another file is in its place, which Central Knot didn’t write and leaves as it is: /home/a/.config/autostart/com.centralknot.firstlook.desktop.');
});

const linuxSkip = process.platform === 'win32' && 'Linux-only XDG desktop/autostart paths and POSIX modes (src/signin.ts); covered on Linux and macOS.';

test('XDG places: the config and data folders the environment names, else ~/.config and ~/.local/share; a relative one is ignored', { skip: linuxSkip }, () => {
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
  // A line break or a tab in the path is written as the string type's escape, so no file name can start a line of its own.
  const odd = { ...app, appImage: '/home/a/Knot\nExec=/bin/false\r\t.AppImage' };
  assert.equal(desktopEntry(odd, 'launcher').split('\n')[3], 'Exec="/home/a/Knot\\nExec=/bin/false\\r\\t.AppImage"');
  // A backslash followed by n (two characters) is written as a quoted backslash, doubled again: four backslashes, then n.
  assert.equal(desktopEntry({ ...app, appImage: '/home/a/back\\new.AppImage' }, 'launcher').split('\n')[3], 'Exec="/home/a/back\\\\\\\\new.AppImage"');
});

/** A throwaway home for one example, its places, and the bytes of an icon. */
async function inHome(example: (places: ReturnType<typeof linuxPlaces>, icon: Buffer) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'ck-signin-'));
  try { await example(linuxPlaces(home, {}, app.id), Buffer.from([137, 80, 78, 71])); } finally { rmSync(home, { recursive: true, force: true }); }
}
const wrote = (...paths: string[]) => paths.map(path => `wrote ${path}`);
const moved = { ...app, appImage: '/home/a/Applications/Central-Knot-Alpha.AppImage' };

test('Linux start at sign-in is Central Knot’s own autostart file: written whole when on, removed when off, read back as on or off', { skip: linuxSkip }, () => inHome(async places => {
  assert.deepEqual(readAutostart(places), { openAtLogin: false }, 'none yet: off');
  assert.equal(await placeAutostart(places, app, true), true);
  assert.equal(readFileSync(places.autostart, 'utf8'), desktopEntry(app, 'autostart'), 'on: the folder is made and the file written');
  // A folder made for it is the owner's alone (0700), as the Base Directory spec asks.
  assert.equal(statSync(join(places.autostart, '..')).mode & 0o777, 0o700);
  assert.deepEqual(readAutostart(places), { openAtLogin: true });
  // The desktop's own settings turned it off the spec's way: it reads as off, and on again writes it whole.
  writeFileSync(places.autostart, `${desktopEntry(app, 'autostart')}Hidden = true\n`);
  assert.deepEqual(readAutostart(places), { openAtLogin: false }, 'Hidden=true is off, with or without spaces around =');
  assert.equal(await placeAutostart(places, app, true), true);
  assert.equal(readFileSync(places.autostart, 'utf8'), desktopEntry(app, 'autostart'));
  assert.equal(await placeAutostart(places, app, false), true);
  assert.equal(existsSync(places.autostart), false, 'off: removed');
  assert.equal(await placeAutostart(places, app, false), true, 'off again with none there: nothing to do');
}));

test('a file in either place that Central Knot didn’t write is never written over or removed, and sign-in says so', () => inHome(async (places, icon) => {
  const theirs = '[Desktop Entry]\nType=Application\nName=Mine\nExec=/usr/bin/true\n';
  for (const path of [places.autostart, places.launcher]) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, theirs); }
  assert.deepEqual(readAutostart(places), { openAtLogin: false, another: places.autostart });
  assert.equal(await placeAutostart(places, app, true), false, 'not turned on over it');
  assert.equal(await placeAutostart(places, app, false), false, 'not removed to turn it off');
  assert.deepEqual(await keepEntries(places, app, icon), wrote(places.icon), 'the launcher entry is not put over it; the icon goes where nothing is');
  assert.deepEqual([readFileSync(places.autostart, 'utf8'), readFileSync(places.launcher, 'utf8')], [theirs, theirs]);
}));

test('a link at any of the three places is the person’s: never written through, replaced or removed, whatever it leads to', () => inHome(async (places, icon) => {
  const elsewhere = join(places.icon, '../../../../../../elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  const own = join(elsewhere, 'own.desktop');
  writeFileSync(own, desktopEntry(app, 'autostart'));
  const links: [string, string][] = [[places.autostart, own], [places.launcher, join(elsewhere, 'gone.desktop')], [places.icon, join(elsewhere, 'gone.png')]];
  for (const [path, target] of links) { mkdirSync(join(path, '..'), { recursive: true }); symlinkSync(target, path); }
  assert.deepEqual(readAutostart(places), { openAtLogin: false, another: places.autostart }, 'a link to its own entry is still a link');
  assert.equal(await placeAutostart(places, moved, true), false);
  assert.equal(await placeAutostart(places, app, false), false);
  assert.deepEqual(await keepEntries(places, moved, icon), [], 'a dangling link is not an empty place');
  assert.deepEqual(links.map(([path]) => readlinkSync(path)), links.map(([, target]) => target));
  assert.deepEqual([readFileSync(own, 'utf8'), existsSync(join(elsewhere, 'gone.desktop')), existsSync(join(elsewhere, 'gone.png'))], [desktopEntry(app, 'autostart'), false, false]);
}));

test('at each start the launcher entry and its icon are put in place, and follow the AppImage when it moves; an autostart file that is on follows too', () => inHome(async (places, icon) => {
  assert.deepEqual(await keepEntries(places, app, icon), wrote(places.launcher, places.icon), 'first open: the entry, then its icon');
  assert.deepEqual([readFileSync(places.launcher, 'utf8'), readFileSync(places.icon)], [desktopEntry(app, 'launcher'), icon]);
  assert.deepEqual(await keepEntries(places, app, icon), [], 'the next start: nothing to do');
  assert.equal(existsSync(places.autostart), false, 'start at sign-in off: no autostart file appears');
  // Turned on, then the AppImage is moved: both entries name the new place at the next start.
  await placeAutostart(places, app, true);
  assert.deepEqual(await keepEntries(places, moved, icon), wrote(places.launcher, places.autostart));
  assert.deepEqual([readFileSync(places.launcher, 'utf8'), readFileSync(places.autostart, 'utf8')], [desktopEntry(moved, 'launcher'), desktopEntry(moved, 'autostart')]);
  // One the desktop turned off (Hidden=true) is not turned back on by a move.
  writeFileSync(places.autostart, `${desktopEntry(moved, 'autostart')}Hidden=true\n`);
  assert.deepEqual(await keepEntries(places, app, icon), wrote(places.launcher));
  assert.equal(readFileSync(places.autostart, 'utf8').includes(moved.appImage), true);
  // An icon or a launcher entry the person removed comes back by itself: they are how the launcher and the taskbar know the app.
  rmSync(places.icon);
  assert.deepEqual(await keepEntries(places, app, icon), wrote(places.icon));
  rmSync(places.launcher);
  assert.deepEqual(await keepEntries(places, app, icon), wrote(places.launcher));
}));

test('the person’s edits are kept: an Exec they added to still names this AppImage, and a move changes only the program’s path', () => inHome(async (places, icon) => {
  await keepEntries(places, app, icon);
  await placeAutostart(places, app, true);
  // KDE's menu editor adds an argument and a comment; README tells Ubuntu 24.04 people to add --no-sandbox.
  const edit = (text: string) => `${text.replace(/^(Exec=.*)$/m, '$1 --no-sandbox')}Comment=Mine\n`;
  for (const path of [places.launcher, places.autostart]) writeFileSync(path, edit(readFileSync(path, 'utf8')));
  assert.deepEqual(await keepEntries(places, app, icon), [], 'still this AppImage: left as it is');
  assert.deepEqual(await keepEntries(places, moved, icon), wrote(places.launcher, places.autostart));
  assert.deepEqual([readFileSync(places.launcher, 'utf8'), readFileSync(places.autostart, 'utf8')], [edit(desktopEntry(moved, 'launcher')), edit(desktopEntry(moved, 'autostart'))]);
  // An older AppImage named unquoted is a move too, and only its path changes.
  writeFileSync(places.launcher, readFileSync(places.launcher, 'utf8').replace(/^Exec=.*$/m, 'Exec=/home/a/Old/central-knot.APPIMAGE --no-sandbox'));
  assert.deepEqual(await keepEntries(places, moved, icon), wrote(places.launcher));
  assert.equal(readFileSync(places.launcher, 'utf8'), edit(desktopEntry(moved, 'launcher')));
  // A path with a line break, a tab and quotes parses back to the one path: no move is seen where there is none.
  const odd = { ...app, appImage: '/home/a/Knot\n"\t`$\\%.AppImage' };
  assert.deepEqual(await keepEntries(places, odd, icon), wrote(places.launcher, places.autostart));
  assert.deepEqual(await keepEntries(places, odd, icon), []);
  assert.equal(readFileSync(places.launcher, 'utf8'), edit(desktopEntry(odd, 'launcher')));
  // A backslash followed by n (two characters) comes back as those two characters, not a line break.
  const back = { ...app, appImage: '/home/a/back\\new.AppImage' };
  assert.deepEqual(await keepEntries(places, back, icon), wrote(places.launcher, places.autostart));
  assert.deepEqual(await keepEntries(places, back, icon), []);
}));

/** An app's Exec value as its entry writes it: the quoted, escaped path. */
const execOf = (of: typeof app) => desktopEntry(of, 'launcher').split('\n')[3].slice('Exec='.length);

test('only an entry whose program is another AppImage has moved: anything else in front is the person’s, and the file is left whole', () => inHome(async (places, icon) => {
  await keepEntries(places, app, icon);
  const launcher = (text: string) => { writeFileSync(places.launcher, text); return text; };
  const keptThrough = async (text: string) => {
    for (const to of [app, moved]) assert.deepEqual([await keepEntries(places, to, icon), readFileSync(places.launcher, 'utf8')], [[], text], `${text.split('\n')[3]}, opened as ${to.appImage}`);
  };
  // What KDE's menu editor writes for an environment variable, and a wrapper script: each is kept through a start and a move.
  await keptThrough(launcher(desktopEntry(app, 'launcher').replace(/^Exec=/m, 'Exec=env VAR=x ')));
  await keptThrough(launcher(desktopEntry(app, 'launcher').replace(/^Exec=.*$/m, 'Exec=/home/a/bin/knot-wrapper.sh --flag')));
  // A move with an escaped part after the path: only the path's own text changes, and \s stays \s.
  const suffix = ' --title=a\\sb\\\\c %U';
  launcher(desktopEntry(app, 'launcher').replace(/^(Exec=.*)$/m, `$1${suffix}`));
  assert.deepEqual(await keepEntries(places, moved, icon), wrote(places.launcher));
  assert.equal(readFileSync(places.launcher, 'utf8'), desktopEntry(moved, 'launcher').replace(/^(Exec=.*)$/m, `$1${suffix}`));
  // A [Desktop Action] group's own Exec is left as it is: only the main group's changes.
  const action = `Actions=new;\n\n[Desktop Action new]\nName=New\nExec=${execOf(app)} --new\n`;
  launcher(`${desktopEntry(app, 'launcher')}${action}`);
  assert.deepEqual(await keepEntries(places, moved, icon), wrote(places.launcher));
  assert.equal(readFileSync(places.launcher, 'utf8'), `${desktopEntry(moved, 'launcher')}${action}`);
  // A file with CRLF line endings doesn't carry the mark line as written, so it is another file: left whole.
  await keptThrough(launcher(desktopEntry(app, 'launcher').replaceAll('\n', '\r\n')));
}));

test('an icon already at its path is left as it is, and one that can’t be written stops neither entry', { skip: linuxSkip }, () => inHome(async (places, icon) => {
  mkdirSync(join(places.icon, '..'), { recursive: true });
  writeFileSync(places.icon, 'his own picture');
  assert.deepEqual(await keepEntries(places, app, icon), wrote(places.launcher));
  assert.equal(readFileSync(places.icon, 'utf8'), 'his own picture');
  // No icon, and its folder can't be written: after a move both entries still follow the AppImage, and the log says why there's no icon.
  rmSync(places.icon);
  chmodSync(join(places.icon, '..'), 0o555);
  await placeAutostart(places, app, true);
  try {
    const said = await keepEntries(places, moved, icon);
    assert.deepEqual(said.slice(0, 2), wrote(places.launcher, places.autostart));
    assert.match(said[2], new RegExp(`^couldn’t write ${places.icon}: EACCES`));
    assert.deepEqual([readFileSync(places.launcher, 'utf8'), readFileSync(places.autostart, 'utf8')], [desktopEntry(moved, 'launcher'), desktopEntry(moved, 'autostart')]);
  } finally { chmodSync(join(places.icon, '..'), 0o755); }
}));

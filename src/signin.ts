// Start at sign-in: whether Central Knot can open itself when the person signs in, and whether it will. Settings, the menu bar
// menu, the app menu, the first launch and the first-close dialog all ask this one function, so they agree and use one wording.
// macOS and Windows keep login items themselves (Electron's login-item calls, in main.ts). Linux has none: there Central Knot
// keeps three files of its own in the XDG places of the home it runs in (linuxPlaces), and only from an AppImage. The autostart
// file starts it at sign-in: written when start at sign-in is turned on, removed when it is turned off (placeAutostart). The
// launcher entry and its icon are how the launcher and, on Wayland, the taskbar know it (main.ts names its windows after the
// entry: app.setDesktopName): at each start the entry is written where there is none and the icon where nothing is, and nothing
// removes either (keepEntries). An entry of its own has moved only when its main Exec runs another AppImage (a file ending
// .AppImage): then that program's text becomes this AppImage's (the autostart file's too, while it is on) and nothing else in the
// file changes; an Exec that runs anything else (env, a wrapper) is the person's, left whole. Nothing is ever written over,
// through or in place of what Central Knot didn't write: an entry without the X-Central-Knot mark or that can't be read, a link,
// or anything already at the icon's path. Each file is what the freedesktop.org specifications say: Desktop Entry 1.5 (the
// files' keys, the Exec value's quoting and escapes), Desktop Application Autostart 0.5 (the autostart folder, Hidden), XDG
// Base Directory 0.8 (the folders, made 0700) and Icon Theme 0.13 (hicolor).
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { errorCode, writeDurably } from './share.ts';
import type { SignIn, SignInPlace, SignInReason } from './types.ts';

/** What decides it, from the running app. `appImage`: Linux, the AppImage file this copy runs from ($APPIMAGE); none when it isn't one. */
export interface SignInFacts { platform: string; packaged: boolean; exe: string; smoke: boolean; appImage?: string }

/** The system's own login-item answer: Electron's `app.getLoginItemSettings()`, in the fields used here, or Linux's (readAutostart). */
export interface LoginItems {
  openAtLogin: boolean;
  /** macOS 13 and later. */
  status?: string;
  /** Windows: the startup entries for this executable, each with whether the system lets it run. */
  launchItems?: { path: string; args: string[]; enabled: boolean }[];
  /** Linux: the autostart file's path, where a file Central Knot didn't write (or can't read) is there. */
  another?: string;
}

/** The arguments the login item starts Central Knot with: it opens hidden, in the menu bar or tray. */
export const signInArgs = ['--hidden'];

/** Each reason as Settings says it, and the short form the menus put in brackets after "Start at sign-in". */
const reasons: Record<SignInReason, [full: string, short: string]> = {
  testing: ['Not available during testing.', 'not during testing'],
  dev: ['Only the installed app can start at sign-in.', 'installed app only'],
  appImage: ['Only the AppImage can start at sign-in.', 'AppImage only'],
  applications: ['Move Central Knot to the Applications folder first.', 'move to Applications first'],
  // True whether macOS is waiting for the person to allow it or they turned it off there on purpose: it reports both the same way.
  approval: ['Off in Login Items in System Settings. Allow Central Knot there to start at sign-in.', 'off in Login Items'],
  startupApps: ['Turned off in Windows Startup apps. Turn it on here to start again.', 'turned off in Startup apps'],
  another: ['Another file is in its place, which Central Knot didn’t write and leaves as it is:', 'another file in its place'],
};
const because = (key: SignInReason, path?: string) => ({ key, text: path ? `${reasons[key][0]} ${path}.` : reasons[key][0] });

/** Each system's own place for it, named as its settings name it, with the way there for when it can't be opened for them. */
const unchanged = 'Your system didn’t change this.';
const places: Record<'darwin' | 'win32', SignInPlace> = {
  darwin: { open: 'Open Login Items', unopened: 'Couldn’t open Login Items. Open System Settings, then General › Login Items.', unchanged },
  win32: { open: 'Open Startup apps', unopened: 'Couldn’t open Startup apps. Open Settings, then Apps › Startup.', unchanged },
};

/**
 * Why this copy can't start at sign-in, or nothing when it can. The facts alone decide it, so the system is never asked; a test
 * or dev build never adds itself to sign-in. On Linux the same answer says whether it keeps a launcher entry (main.ts keepLauncher).
 */
export function whyNoSignIn({ platform, packaged, exe, smoke, appImage }: SignInFacts): SignIn['reason'] {
  if (smoke) return because('testing');
  if (!packaged) return because('dev');
  // Inside an AppImage the app runs from a mount that is gone once it quits: only the AppImage's own file can be started again.
  if (platform === 'linux' && !appImage) return because('appImage');
  // macOS only keeps a login item for an app it can find again: one in the Applications folder.
  if (platform === 'darwin' && !exe.startsWith('/Applications/')) return because('applications');
  return undefined;
}

/**
 * Whether Central Knot starts at sign-in, as the system has it now (never the choice last saved: the person can turn it off,
 * or leave it waiting for approval, in the system's own settings). `read` asks the system, and is only called where a login item
 * can exist at all.
 */
export function signInState(facts: SignInFacts, read: () => LoginItems): SignIn {
  const reason = whyNoSignIn(facts);
  if (reason) return { on: false, available: false, reason };
  const items = read();
  if (facts.platform === 'linux') return items.another ? { on: false, available: false, reason: because('another', items.another) } : { on: items.openAtLogin, available: true };
  const place = places[facts.platform as 'darwin' | 'win32'];
  if (facts.platform === 'darwin') {
    // macOS also reports one the person turned off in Login Items this way: it waits for them to allow it again.
    if (items.status === 'requires-approval') return { on: false, available: true, reason: because('approval'), place };
    // Before macOS 13 there is no status: the login item's presence is the answer.
    return { on: items.status === undefined ? items.openAtLogin : items.status === 'enabled', available: true, place };
  }
  // Windows keeps the startup entry when the person turns it off in Task Manager or Settings, and marks it disabled.
  const mine = items.launchItems?.find(item => item.path.toLowerCase() === facts.exe.toLowerCase() && item.args.join(' ') === signInArgs.join(' '));
  if (mine && !mine.enabled) return { on: false, available: true, reason: because('startupApps'), place };
  return { on: items.launchItems ? !!mine : items.openAtLogin, available: true, place };
}

/** The menu item's label: the reason's short form in brackets, when there is one. */
export const signInLabel = ({ reason }: SignIn) => reason ? `Start at sign-in (${reasons[reason.key][1]})` : 'Start at sign-in';

// ---------- Linux: the desktop's own files ----------

/** The app the files are for: its name, its bundle id (each file is named after it) and its AppImage. */
export interface LinuxApp { name: string; id: string; appImage: string }
export interface LinuxPlaces { autostart: string; launcher: string; icon: string }

/** Where the desktop reads them in `home`: $XDG_CONFIG_HOME and $XDG_DATA_HOME, else ~/.config and ~/.local/share (an empty or relative one is ignored). */
export function linuxPlaces(home: string, env: Record<string, string | undefined>, id: string): LinuxPlaces {
  const base = (name: string, fallback: string) => { const named = env[name]; return named?.startsWith('/') ? named : join(home, fallback); };
  const config = base('XDG_CONFIG_HOME', '.config'), data = base('XDG_DATA_HOME', '.local/share');
  return { autostart: join(config, 'autostart', `${id}.desktop`), launcher: join(data, 'applications', `${id}.desktop`), icon: join(data, 'icons/hicolor/512x512/apps', `${id}.png`) };
}

/** Marks a file as Central Knot's own (an X- key, as the Desktop Entry spec allows): only such a file is ever rewritten or removed. */
const MARK = 'X-Central-Knot=true';
/** The Exec key's two layers: an argument quoted, with `"`, `` ` ``, `$` and `\` escaped and `%` doubled (a field code's escape)... */
const quoted = (path: string) => `"${path.replace(/["`$\\]/g, '\\$&').replaceAll('%', '%%')}"`;
/** ...then the string type's escapes: `\` doubled, and a line break or tab written `\n`, `\r`, `\t`, so no path starts a line. */
const asString = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');
const escapes: Record<string, string> = { '\\': '\\', n: '\n', r: '\r', t: '\t', s: ' ' };
/** An Exec value's program (its first argument, undone layer by layer), and where the program's own text ends in the value. */
function program(value: string): [path: string, end: number] {
  // The string type's escapes first, each character remembering where its text ends in the value.
  const chars: string[] = [], ends: number[] = [];
  for (let at = 0; at < value.length; at++) {
    chars.push(value[at] === '\\' && value[at + 1] in escapes ? escapes[value[++at]] : value[at]);
    ends.push(at + 1);
  }
  const line = chars.join('');
  let end = line.includes(' ') ? line.indexOf(' ') : line.length;
  // Quoted: up to the first quote no backslash escapes.
  if (line.startsWith('"')) { end = 1; while (end < line.length && line[end] !== '"') end += line[end] === '\\' ? 2 : 1; end = Math.min(end + 1, line.length); }
  const first = line.slice(0, end);
  return [(first.startsWith('"') ? first.slice(1, -1).replace(/\\(.)/g, '$1') : first).replaceAll('%%', '%'), end ? ends[end - 1] : 0];
}

/** A file's text: the launcher entry opens the AppImage, in the Development menu; the autostart file opens it hidden (signInArgs). */
export function desktopEntry(app: LinuxApp, kind: 'launcher' | 'autostart'): string {
  const exec = asString([quoted(app.appImage), ...(kind === 'autostart' ? signInArgs : [])].join(' '));
  return ['[Desktop Entry]', 'Type=Application', `Name=${app.name}`, `Exec=${exec}`, `Icon=${app.id}`, 'Terminal=false', ...(kind === 'launcher' ? ['Categories=Development;'] : []), MARK, ''].join('\n');
}

/** What is at a place itself: nothing, Central Knot's own entry (its lines), or another (a link, wherever it leads; no mark; unreadable), left alone. */
type Found = 'none' | 'another' | string[];
function found(path: string): Found {
  try {
    if (lstatSync(path).isSymbolicLink()) return 'another';
    const lines = readFileSync(path, 'utf8').split('\n');
    return lines.includes(MARK) ? lines : 'another';
  } catch (error) { return errorCode(error) === 'ENOENT' ? 'none' : 'another'; }
}
/**
 * Its own entry pointed at this AppImage, where the main [Desktop Entry] group's Exec runs another AppImage (it moved): only that
 * program's text changes. None where it runs this one, or anything else (env, a wrapper: the person's).
 */
function retargeted(lines: string[], app: LinuxApp): string | undefined {
  const group = lines.indexOf('[Desktop Entry]'), after = lines.findIndex((line, index) => index > group && line.startsWith('['));
  const at = lines.findIndex((line, index) => index > group && (after < 0 || index < after) && line.startsWith('Exec='));
  if (group < 0 || at < 0) return undefined;
  const value = lines[at].slice('Exec='.length), [path, end] = program(value);
  if (path === app.appImage || !/\.appimage$/i.test(path)) return undefined;
  return lines.with(at, `Exec=${asString(quoted(app.appImage))}${value.slice(end)}`).join('\n');
}
/** Whether nothing at all is at `path`, not even a link: where the icon is written (a PNG has no mark to read). */
function vacant(path: string) {
  try { lstatSync(path); return false; } catch (error) { return errorCode(error) === 'ENOENT'; }
}
/** Written whole (share.ts writeDurably), in a folder made 0700 where there is none, as the Base Directory spec asks. */
async function put(path: string, content: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeDurably(path, content);
}
/** On: Central Knot's own autostart file is there and not hidden (Hidden=true, spaces around = allowed, is the Autostart spec's off, which a desktop's settings may write). */
const autostartOn = (at: Found): at is string[] => Array.isArray(at) && !at.some(line => /^Hidden\s*=\s*true\s*$/.test(line));

/** Linux's answer for signInState, read from the autostart file each time it is asked. */
export function readAutostart(places: LinuxPlaces): LoginItems {
  const at = found(places.autostart);
  return at === 'another' ? { openAtLogin: false, another: places.autostart } : { openAtLogin: autostartOn(at) };
}

/** Linux's login-item call: the autostart file written whole for on, removed for off. False: another file is there, left as it is. */
export async function placeAutostart(places: LinuxPlaces, app: LinuxApp, on: boolean): Promise<boolean> {
  const at = found(places.autostart);
  if (at === 'another') return false;
  if (on) await put(places.autostart, desktopEntry(app, 'autostart'));
  else if (at !== 'none') await rm(places.autostart, { force: true });
  return true;
}

/**
 * At each start of the AppImage: the launcher entry is written where there is none; where its own runs another AppImage (it
 * moved), only that program's text changes, and so in an autostart file that is on (one turned off stays off); the icon is
 * written where nothing is at its path. Each is tried alone, so one that fails stops no other. Answers a line each, for the log.
 */
export async function keepEntries(places: LinuxPlaces, app: LinuxApp, icon: Uint8Array): Promise<string[]> {
  const said: string[] = [];
  const tryPut = (path: string, content: string | Uint8Array | undefined) => content !== undefined && put(path, content)
    .then(() => said.push(`wrote ${path}`), (error: Error) => said.push(`couldn’t write ${path}: ${error.message}`));
  const launcher = found(places.launcher), autostart = found(places.autostart);
  await tryPut(places.launcher, launcher === 'none' ? desktopEntry(app, 'launcher') : Array.isArray(launcher) ? retargeted(launcher, app) : undefined);
  if (autostartOn(autostart)) await tryPut(places.autostart, retargeted(autostart, app));
  if (vacant(places.icon)) await tryPut(places.icon, icon);
  return said;
}

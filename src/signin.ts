// Start at sign-in: whether Central Knot can open itself when the person signs in, and whether it will. Settings, the menu bar
// menu, the app menu, the first launch and the first-close dialog all ask this one function, so they agree and use one wording.
// macOS and Windows keep login items themselves (Electron's login-item calls, in main.ts). Linux has none: there Central Knot
// keeps the desktop's own files for itself, in the XDG places of the home it runs in (linuxPlaces), and only from an AppImage:
// the autostart file that starts it at sign-in, and its launcher entry and icon, which are how the launcher and, on Wayland, the
// taskbar know it (main.ts names its windows after the launcher entry: app.setDesktopName). Each file is what the freedesktop.org
// specifications say: Desktop Entry 1.5 (the files' keys, the Exec value's quoting), Desktop Application Autostart 0.5 (the
// autostart folder, Hidden), XDG Base Directory 0.8 (the folders) and Icon Theme 0.13 (hicolor). A file in either place that
// Central Knot didn't write (no X-Central-Knot mark) is never written over or removed.
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
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
/** The Exec key's one argument: quoted, `"`, `` ` ``, `$` and `\` escaped, then every `\` doubled (the string type's escape), and `%` doubled. */
const execArg = (path: string) => `"${path.replace(/["`$\\]/g, '\\$&')}"`.replaceAll('\\', '\\\\').replaceAll('%', '%%');

/** A file's text: the launcher entry opens the AppImage, in the Development menu; the autostart file opens it hidden (signInArgs). */
export function desktopEntry(app: LinuxApp, kind: 'launcher' | 'autostart'): string {
  const exec = [execArg(app.appImage), ...(kind === 'autostart' ? signInArgs : [])].join(' ');
  return ['[Desktop Entry]', 'Type=Application', `Name=${app.name}`, `Exec=${exec}`, `Icon=${app.id}`, 'Terminal=false', ...(kind === 'launcher' ? ['Categories=Development;'] : []), MARK, ''].join('\n');
}

/** What is at a place: nothing, Central Knot's own file (its lines), or another (no mark, or it can't be read), which is left alone. */
type Found = 'none' | 'another' | string[];
function found(path: string): Found {
  let lines: string[];
  try { lines = readFileSync(path, 'utf8').split('\n'); } catch (error) { return errorCode(error) === 'ENOENT' ? 'none' : 'another'; }
  return lines.includes(MARK) ? lines : 'another';
}
const execLine = (lines: string[]) => lines.find(line => line.startsWith('Exec='));
/** On: Central Knot's own autostart file is there and not hidden (Hidden=true, spaces around = allowed, is the Autostart spec's off, which a desktop's settings may write). */
const autostartOn = (at: Found) => Array.isArray(at) && !at.some(line => /^Hidden\s*=\s*true\s*$/.test(line));

/** Linux's answer for signInState, read from the autostart file each time it is asked. */
export function readAutostart(places: LinuxPlaces): LoginItems {
  const at = found(places.autostart);
  return at === 'another' ? { openAtLogin: false, another: places.autostart } : { openAtLogin: autostartOn(at) };
}

/** Linux's login-item call: the autostart file written whole for on, removed for off. False: another file is there, left as it is. */
export async function placeAutostart(places: LinuxPlaces, app: LinuxApp, on: boolean): Promise<boolean> {
  const at = found(places.autostart);
  if (at === 'another') return false;
  if (on) await writeDurably(places.autostart, desktopEntry(app, 'autostart'));
  else if (at !== 'none') await rm(places.autostart, { force: true });
  return true;
}

/**
 * At each start of the AppImage: the launcher entry is written where there is none or where Central Knot's own names another
 * file (the AppImage moved), its icon first; an autostart file that is on follows a move too. Each other file is left as it is
 * (one the person edited stays edited; one turned off stays off). Answers the paths written, for the log.
 */
export async function keepEntries(places: LinuxPlaces, app: LinuxApp, icon: Uint8Array): Promise<string[]> {
  const written: string[] = [];
  const moved = (at: Found, kind: 'launcher' | 'autostart') => Array.isArray(at) && execLine(at) !== execLine(desktopEntry(app, kind).split('\n'));
  const launcher = found(places.launcher), autostart = found(places.autostart);
  if (launcher === 'none' || moved(launcher, 'launcher')) {
    await writeDurably(places.icon, icon);
    await writeDurably(places.launcher, desktopEntry(app, 'launcher'));
    written.push(places.icon, places.launcher);
  }
  if (autostartOn(autostart) && moved(autostart, 'autostart')) { await writeDurably(places.autostart, desktopEntry(app, 'autostart')); written.push(places.autostart); }
  return written;
}

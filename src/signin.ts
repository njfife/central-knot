// Start at sign-in: whether Central Knot can open itself when the person signs in, and whether it will. Settings, the menu bar
// menu, the app menu, the first launch and the first-close dialog all ask this one function, so they agree and use one wording.
import type { SignIn, SignInPlace, SignInReason } from './types.ts';

/** What decides it, from the running app. */
export interface SignInFacts { platform: string; packaged: boolean; exe: string; smoke: boolean }

/** The system's own login-item answer: Electron's `app.getLoginItemSettings()`, in the fields used here. */
export interface LoginItems {
  openAtLogin: boolean;
  /** macOS 13 and later. */
  status?: string;
  /** Windows: the startup entries for this executable, each with whether the system lets it run. */
  launchItems?: { path: string; args: string[]; enabled: boolean }[];
}

/** The arguments the login item starts Central Knot with: it opens hidden, in the menu bar or tray. */
export const signInArgs = ['--hidden'];

/** Each reason as Settings says it, and the short form the menus put in brackets after "Start at sign-in". */
const reasons: Record<SignInReason, [full: string, short: string]> = {
  testing: ['Not available during testing.', 'not during testing'],
  dev: ['Only the installed app can start at sign-in.', 'installed app only'],
  linux: ['Not available on Linux yet.', 'not on Linux yet'],
  applications: ['Move Central Knot to the Applications folder first.', 'move to Applications first'],
  // True whether macOS is waiting for the person to allow it or they turned it off there on purpose: it reports both the same way.
  approval: ['Off in Login Items in System Settings. Allow Central Knot there to start at sign-in.', 'off in Login Items'],
  startupApps: ['Turned off in Startup apps in Settings. Turn it on here to start again.', 'turned off in Startup apps'],
};
const because = (key: SignInReason) => ({ key, text: reasons[key][0] });

/** Each system's own place for it, named as its settings name it, with the way there for when it can't be opened for them. */
const places: Record<'darwin' | 'win32', SignInPlace> = {
  darwin: { open: 'Open Login Items', unopened: 'Couldn’t open Login Items. Open System Settings, then General › Login Items.', unchanged: 'Your system didn’t change this.' },
  win32: { open: 'Open Startup apps', unopened: 'Couldn’t open Startup apps. Open Settings, then Apps › Startup.', unchanged: 'Your system didn’t change this.' },
};

/**
 * Why this copy can't start at sign-in, or nothing when it can. The facts alone decide it, so the system is never asked; a test
 * or dev build never adds itself to sign-in.
 */
export function whyNoSignIn({ platform, packaged, exe, smoke }: SignInFacts): SignIn['reason'] {
  if (smoke) return because('testing');
  if (!packaged) return because('dev');
  if (platform !== 'darwin' && platform !== 'win32') return because('linux');
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

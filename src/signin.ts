// Start at sign-in: whether Central Knot can open itself when the person signs in, and whether it will. Settings, the menu bar
// menu, the app menu, the first launch and the first-close dialog all ask this one function, so they agree and use one wording.
import type { SignIn } from './types.ts';

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

/** Why this copy can't start at sign-in, or nothing when it can. A test or dev build never adds itself to sign-in. */
function unavailable({ platform, packaged, exe, smoke }: SignInFacts): string | undefined {
  if (smoke) return 'Not available during testing.';
  if (!packaged) return 'Only the installed app can start at sign-in.';
  if (platform !== 'darwin' && platform !== 'win32') return 'Not available on Linux yet.';
  // macOS only keeps a login item for an app it can find again: one in the Applications folder.
  if (platform === 'darwin' && !exe.startsWith('/Applications/')) return 'Move Central Knot to the Applications folder first.';
  return undefined;
}

/**
 * Whether Central Knot starts at sign-in, as the system has it now (never the choice last saved: the person can turn it off,
 * or leave it waiting for approval, in the system's own settings). `read` asks the system, and is only called where a login item
 * can exist at all. `reason` says why it is off when the system is the reason, or why it can't be changed here.
 */
export function signInState(facts: SignInFacts, read: () => LoginItems): SignIn {
  const reason = unavailable(facts);
  if (reason) return { on: false, available: false, reason };
  const items = read();
  if (facts.platform === 'darwin') {
    if (items.status === 'requires-approval') return { on: false, available: true, reason: 'Allow Central Knot in Login Items in System Settings to finish turning this on.' };
    // Before macOS 13 there is no status: the login item's presence is the answer.
    return { on: items.status === undefined ? items.openAtLogin : items.status === 'enabled', available: true };
  }
  // Windows keeps the startup entry when the person turns it off in Task Manager or Settings, and marks it disabled.
  const mine = items.launchItems?.find(item => item.path.toLowerCase() === facts.exe.toLowerCase() && item.args.join(' ') === signInArgs.join(' '));
  if (mine && !mine.enabled) return { on: false, available: true, reason: 'Turned off in your system’s startup settings.' };
  return { on: items.launchItems ? !!mine : items.openAtLogin, available: true };
}

/** The menu item's label: the same reason as Settings, in brackets, when there is one. */
export const signInLabel = ({ reason }: SignIn) => reason ? `Start at sign-in (${reason[0].toLowerCase()}${reason.slice(1, -1)})` : 'Start at sign-in';

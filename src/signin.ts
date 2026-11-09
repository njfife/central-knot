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

/** Each reason as Settings says it, and the short form the menus put in brackets after "Start at sign-in". */
const reasons = {
  testing: ['Not available during testing.', 'not during testing'],
  dev: ['Only the installed app can start at sign-in.', 'installed app only'],
  linux: ['Not available on Linux yet.', 'not on Linux yet'],
  applications: ['Move Central Knot to the Applications folder first.', 'move to Applications first'],
  approval: ['Allow Central Knot in Login Items in System Settings to finish turning this on.', 'allow in Login Items'],
  startupApps: ['Turned off in Startup apps in Settings. Turn it on here to start again.', 'turned off in Startup apps'],
} as const;

/**
 * Why this copy can't start at sign-in, or nothing when it can. The facts alone decide it, so the system is never asked; a test
 * or dev build never adds itself to sign-in.
 */
export function whyNoSignIn({ platform, packaged, exe, smoke }: SignInFacts): string | undefined {
  if (smoke) return reasons.testing[0];
  if (!packaged) return reasons.dev[0];
  if (platform !== 'darwin' && platform !== 'win32') return reasons.linux[0];
  // macOS only keeps a login item for an app it can find again: one in the Applications folder.
  if (platform === 'darwin' && !exe.startsWith('/Applications/')) return reasons.applications[0];
  return undefined;
}

/**
 * Whether Central Knot starts at sign-in, as the system has it now (never the choice last saved: the person can turn it off,
 * or leave it waiting for approval, in the system's own settings). `read` asks the system, and is only called where a login item
 * can exist at all. `reason` says why it can't be changed here (`available` false) or, where it can, why the system has it off.
 */
export function signInState(facts: SignInFacts, read: () => LoginItems): SignIn {
  const reason = whyNoSignIn(facts);
  if (reason) return { on: false, available: false, reason };
  const items = read();
  if (facts.platform === 'darwin') {
    // macOS also reports one the person turned off in Login Items this way: it waits for them to allow it again.
    if (items.status === 'requires-approval') return { on: false, available: true, reason: reasons.approval[0] };
    // Before macOS 13 there is no status: the login item's presence is the answer.
    return { on: items.status === undefined ? items.openAtLogin : items.status === 'enabled', available: true };
  }
  // Windows keeps the startup entry when the person turns it off in Task Manager or Settings, and marks it disabled.
  const mine = items.launchItems?.find(item => item.path.toLowerCase() === facts.exe.toLowerCase() && item.args.join(' ') === signInArgs.join(' '));
  if (mine && !mine.enabled) return { on: false, available: true, reason: reasons.startupApps[0] };
  return { on: items.launchItems ? !!mine : items.openAtLogin, available: true };
}

/** The menu item's label: the reason's short form in brackets, when there is one. */
export function signInLabel({ reason }: SignIn): string {
  const short = Object.values(reasons).find(([full]) => full === reason)?.[1];
  return short ? `Start at sign-in (${short})` : 'Start at sign-in';
}

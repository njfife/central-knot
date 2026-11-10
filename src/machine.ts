// How the app names this computer and its home, and what it offers on this platform. Decided here once, for the main
// process (from process.platform) and the page (from its user agent) alike.

/** This computer's names and what its platform offers. */
export interface MachineNames {
  /** Its home: "This Mac’s home". */
  home: string;
  /** The machine inside a sentence: "not found on this Mac". */
  machine: string;
  /** Where Central Knot's icon keeps running: "the menu bar" on a Mac, "the tray" elsewhere; `Tray` starts a sentence. */
  tray: string;
  Tray: string;
  /** Whether Central Knot can start at sign-in here (not on Linux). */
  signIn: boolean;
  /** The key a shortcut is held with: ⌘ on a Mac, Ctrl elsewhere. */
  modifierKey: string;
}

/** The names for a platform, as `process.platform` spells it ('darwin', 'win32', 'linux'). */
export function machineNames(platform: string): MachineNames {
  const mac = platform === 'darwin';
  return {
    home: mac ? 'This Mac’s home' : 'This computer’s home',
    machine: mac ? 'this Mac' : 'this computer',
    tray: mac ? 'the menu bar' : 'the tray',
    Tray: mac ? 'The menu bar' : 'The tray',
    signIn: platform !== 'linux',
    modifierKey: mac ? '⌘' : 'Ctrl',
  };
}

/** The platform the page runs on, read from its user agent, spelt as `process.platform` spells it. */
export const pagePlatform = (userAgent: string): string => (userAgent.includes('Mac') ? 'darwin' : userAgent.includes('Linux') ? 'linux' : 'win32');

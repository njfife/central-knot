// How the app names this computer, its home, where its icon sits and the shortcut key: words only, decided here once, for
// the main process (from process.platform) and the page (from its user agent) alike. What Start at sign-in can do here is
// signin.ts's.

/** This computer's names, as sentences use them. */
export interface MachineNames {
  /** Its home: "This Mac’s home". */
  home: string;
  /** The machine inside a sentence: "not found on this Mac". */
  machine: string;
  /** Where Central Knot's icon keeps running: "the menu bar" on a Mac, "the system tray" elsewhere; `Tray` starts a sentence. */
  tray: string;
  Tray: string;
  /** The icon itself: "menu bar icon" on a Mac, "system tray icon" elsewhere. */
  trayIcon: string;
  /** The key a shortcut is held with: ⌘ on a Mac, Ctrl elsewhere. */
  modifierKey: string;
}

/** The names for a platform, as `process.platform` spells it ('darwin', 'win32', 'linux'). */
export function machineNames(platform: string): MachineNames {
  const mac = platform === 'darwin';
  return {
    home: mac ? 'This Mac’s home' : 'This computer’s home',
    machine: mac ? 'this Mac' : 'this computer',
    tray: mac ? 'the menu bar' : 'the system tray',
    Tray: mac ? 'The menu bar' : 'The system tray',
    trayIcon: mac ? 'menu bar icon' : 'system tray icon',
    modifierKey: mac ? '⌘' : 'Ctrl',
  };
}

/** The platform the page runs on, read from its user agent, spelt as `process.platform` spells it. */
export const pagePlatform = (userAgent: string): string => (userAgent.includes('Mac') ? 'darwin' : userAgent.includes('Linux') ? 'linux' : 'win32');

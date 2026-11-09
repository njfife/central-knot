// How the app names this computer and its home. Decided here once, for the main process (from process.platform) and the
// page (from its user agent) alike.

/**
 * This computer's names: its home ("This Mac’s home"), the machine inside a sentence ("not found on this Mac"), and where
 * Central Knot's icon keeps running ("the menu bar" on a Mac, "the tray" elsewhere).
 */
export const machineNames = (mac: boolean): { home: string; machine: string; tray: string } =>
  (mac ? { home: 'This Mac’s home', machine: 'this Mac', tray: 'the menu bar' } : { home: 'This computer’s home', machine: 'this computer', tray: 'the tray' });

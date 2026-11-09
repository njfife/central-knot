// How the app names this computer and its home. Decided here once, for the main process (from process.platform) and the
// page (from its user agent) alike.

/** This computer's names: its home ("This Mac’s home") and the machine inside a sentence ("not found on this Mac"). */
export const machineNames = (mac: boolean): { home: string; machine: string } =>
  (mac ? { home: 'This Mac’s home', machine: 'this Mac' } : { home: 'This computer’s home', machine: 'this computer' });

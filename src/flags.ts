// On/off flags kept per viewer in this window's local storage: a tip hidden, a note dismissed, a kept edit. Storage that
// can't be used reads as unset and drops writes, so at worst a tip or note shows again.

export const readFlag = (key: string): boolean => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };

/** Sets the flag, or clears it with `on` false. */
export const writeFlag = (key: string, on = true): void => { try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* shows again */ } };

/**
 * The flag for a stopped one-way copy the person chose to keep (Agents), per home, item and tool, and for that copy as it was
 * kept (`copy`: its content and edit time): a later edit there asks again, and an Undo that puts the kept copy back brings it back.
 */
export const keptEditFlag = (home: string, item: string, tool: string, copy: string): string => `ck-kept-edit:${home}:${item}:${tool}:${copy}`;

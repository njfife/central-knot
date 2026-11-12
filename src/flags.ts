// On/off flags kept per viewer in this window's local storage: a tip hidden, a note dismissed. Storage that
// can't be used reads as unset and drops writes, so at worst a tip or note shows again.

export const readFlag = (key: string): boolean => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };

/** Sets the flag, or clears it with `on` false. */
export const writeFlag = (key: string, on = true): void => { try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* shows again */ } };

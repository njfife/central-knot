// Which tools are in a home. Every page offers and names only these, so the rule lives here, once, for the main process
// and the page alike: a tool that is neither installed nor holding anything is not a choice anywhere in the app.
import type { HarnessId, Snapshot } from './types.ts';

/** A tool is in this home when it was detected (installed, or its folder found), or when its folders hold skills. */
export const isPresent = (snapshot: Snapshot): boolean => snapshot.detection !== 'Not found' || snapshot.skills.length > 0;

/** The tools in this home, in discovery order: the columns, boxes, menus and sentences every page draws from. */
export const presentTools = (snapshots: Snapshot[]): HarnessId[] => snapshots.filter(isPresent).map(snapshot => snapshot.harness);

// An agent's row on the Agents page, without the DOM: where it stands, what each harness's mark says, the clicks its
// controls send, and every sentence the page says about an agent (its status, its switch, a click's result, a notice).
// matrix.ts draws these; the tests click them exactly as the page does (tests/agentclicks.ts).
//
// An agent stands in one of three places (library.ts has the model):
//   on     in Central Knot's library and On: applied to every managed harness it is not kept out of
//   off    in the library and Off: in Central Knot only, in no harness
//   found  in a managed harness, not in the library; its switch takes it in
// What a harness holds is told by the library's own rule (library.ts decide), so a mark says what the next pass will do
// there and never something of its own.
import { decide, sourceWords, wantedIn, type LibraryItem, type Version } from './library.ts';
import { dayAndTime } from './model.ts';
import type { Change, HarnessId, SyncNotice } from './types.ts';
import { andList, sentence, toolName, toolsPhrase } from './words.ts';

/** What the page knows of an agent besides its library item: each harness's copy by content, and why a harness can't hold or show it. */
export interface AgentRow {
  key: string; name?: string;
  /** Each harness's copy, by its content. */
  hashes?: Partial<Record<string, string>>;
  cannot?: Partial<Record<string, string>>;
  unseen?: Partial<Record<string, string>>;
}

export type Place = 'on' | 'off' | 'found';
/** The item when the agent is in the library (a deleted one is not: what a harness holds of it is found). */
export const inLibrary = (item: LibraryItem | undefined) => (item && !item.deleted ? item : undefined);
export const placeOf = (item: LibraryItem | undefined): Place => { const held = inLibrary(item); return !held ? 'found' : held.on ? 'on' : 'off'; };

/**
 * What one harness has of an agent, as its mark and its line say it:
 * - `current`: the current version; `gets-it`: it is written there at the next pass; `edited`: its copy was edited there and
 *   becomes the current version at the next pass; `deleted`: its copy was deleted there by hand, which turns the agent Off at
 *   the next pass; `leaving`: its copy is removed at the next pass;
 * - `own-copy`: a copy Central Knot didn't put there (a found agent's, or one that turned up while the agent is Off or kept
 *   out of that harness); `kept-out`: the person keeps the agent out of this harness; `none`: no copy;
 * - `cannot`: it can't be given a copy (the row says why); `unseen`: its copy can't be read for sure, so nothing happens there.
 */
export type HarnessIs = 'current' | 'gets-it' | 'edited' | 'deleted' | 'leaving' | 'own-copy' | 'kept-out' | 'none' | 'cannot' | 'unseen';

export function harnessIs(row: AgentRow, item: LibraryItem | undefined, tool: string): HarnessIs {
  const hash = row.hashes?.[tool], held = inLibrary(item), harness = tool as HarnessId;
  if (row.unseen?.[tool]) return 'unseen';
  if (!held) return hash === undefined ? 'none' : 'own-copy';
  const wanted = wantedIn(held, harness), keptOut = held.on && held.except.includes(harness);
  if (hash === undefined && wanted && row.cannot?.[tool]) return 'cannot';
  switch (decide(wanted, held.hash, hash === undefined ? { is: 'absent' } : { is: 'present', hash, at: 0 }, held.applied[harness])) {
    case 'write': case 'keep-then-write': return 'gets-it';
    case 'take-in': case 'latest-wins': return 'edited';
    case 'turn-off': return 'deleted';
    case 'remove': case 'keep-then-remove': return 'leaving';
    case 'found': return 'own-copy';
    default: return hash !== undefined ? 'current' : keptOut ? 'kept-out' : 'none';
  }
}

const KEPT_FIRST = 'before it is written over, a copy Central Knot doesn’t have yet is kept as a version';

/** A harness's line in the opened row: what it has, in a sentence. `where` is the harness's name. */
export function harnessLine(row: AgentRow, item: LibraryItem | undefined, tool: string, where: string): string {
  const held = inLibrary(item), has = row.hashes?.[tool] !== undefined;
  switch (harnessIs(row, item, tool)) {
    case 'current': return 'Has the current version.';
    case 'gets-it': return has ? `Has another copy. It gets the current version when sync runs; ${KEPT_FIRST}.` : 'Gets it when sync runs next.';
    case 'edited': return `Edited in ${where}. It becomes the current version when sync runs, and reaches the other tools.`;
    case 'deleted': return `Its copy was deleted in ${where}. When sync runs, the agent turns off everywhere; Central Knot keeps it.`;
    case 'leaving': return 'Its copy is removed when sync runs. Central Knot keeps it.';
    case 'own-copy':
      if (!held) return 'Has it.';
      return `Has a copy Central Knot didn’t put there. It is left alone while ${held.on ? 'this tool is kept out' : 'the agent is off'}; ${KEPT_FIRST}.`;
    case 'kept-out': return 'Kept out of this tool. Central Knot keeps its file for when you turn it on here.';
    case 'none': return held ? 'No copy while it is off.' : 'No copy. Turning it on adds it here.';
    case 'cannot': return row.cannot![tool]!;
    case 'unseen': return row.unseen![tool]!;
  }
}

/** Whether the switch must ask which copy to take in: a found agent whose copies differ. A library item never asks. */
export const needsChoice = (row: AgentRow, item: LibraryItem | undefined, tools: readonly string[]) =>
  !inLibrary(item) && new Set(tools.map(tool => row.hashes?.[tool]).filter(hash => hash !== undefined)).size > 1;

/** The agent as it is, as a click that changes nothing: each click below changes one thing of it. */
function asItIs(row: AgentRow, item: LibraryItem | undefined): Change {
  const held = inLibrary(item);
  return { key: row.key, managed: !!held?.on, off: held ? [...held.except] : [], seenManaged: !!held?.on };
}

/** The clicks an agent's controls send. Each is a types.ts Change, which main.ts's `changes` sanitizer passes on field by field to agents.ts click. */
export const agentClicks = {
  /** The row's switch, On: a found agent is taken in (`use`: the copy every harness takes, where they differ); one in the library is applied. */
  on: (row: AgentRow, item: LibraryItem | undefined, use?: string): Change =>
    ({ ...asItIs(row, item), managed: true, ...(use ? { use: use as HarnessId, useHash: row.hashes?.[use] } : {}) }),
  /** The row's switch, Off: out of every harness; Central Knot keeps it. */
  off: (row: AgentRow, item: LibraryItem | undefined): Change => ({ ...asItIs(row, item), managed: false }),
  /** A harness's own switch in the opened row: kept out of it (`out`), or let in again. */
  inHarness: (row: AgentRow, item: LibraryItem | undefined, tool: string, out: boolean): Change => {
    const now = asItIs(row, item);
    return { ...now, off: out ? [...now.off, tool as HarnessId] : now.off.filter(other => other !== tool) };
  },
  /** Make current, on an earlier version in the opened row. */
  makeCurrent: (row: AgentRow, item: LibraryItem | undefined, version: string): Change => ({ ...asItIs(row, item), version }),
  /** Delete from Central Knot. */
  remove: (row: AgentRow, item: LibraryItem | undefined): Change => ({ ...asItIs(row, item), deleted: true }),
};

/** How many versions a folded list shows. */
export const FOLDED_VERSIONS = 4;
/** The versions an opened row shows: all of them once unfolded, else the newest few, and how many more there are. */
export function foldVersions(versions: readonly Version[], unfolded: boolean): { shown: readonly Version[]; rest: number } {
  const shown = unfolded ? versions : versions.slice(0, FOLDED_VERSIONS);
  return { shown, rest: versions.length - shown.length };
}

// ---------- Words ----------

/** The home's harnesses by name, as a sentence lists them ("all 3 tools", or their names). */
const named = (some: readonly string[], tools: readonly string[]) => toolsPhrase([...some], [...tools]);
const harnessesWhere = (row: AgentRow, item: LibraryItem | undefined, tools: readonly string[], ...states: HarnessIs[]) =>
  tools.filter(tool => states.includes(harnessIs(row, item, tool)));

/** The tag after an agent's name when it isn't plainly on: where it stands, and (its tooltip) what that means. */
export function placeTag(item: LibraryItem | undefined): { text: string; title: string } | undefined {
  const place = placeOf(item);
  if (place === 'off') return { text: 'in Central Knot only', title: 'Central Knot keeps this agent and its versions. No tool has it until you turn it on.' };
  const found = 'A tool has this agent; Central Knot doesn’t yet. Turn it on to take it in and apply it to every tool.';
  if (place === 'found') return { text: 'not in Central Knot', title: found };
  return undefined;
}

/** An agent's status in one line: on and where, in Central Knot only, or found in a harness and not in Central Knot yet. */
export function statusLine(row: AgentRow, item: LibraryItem | undefined, tools: readonly string[]): string {
  const where = (...states: HarnessIs[]) => harnessesWhere(row, item, tools, ...states);
  const own = where('own-copy'), place = placeOf(item);
  if (place === 'found') {
    const differ = needsChoice(row, item, tools) ? ', with different copies' : '';
    return `Not in Central Knot · in ${named(own, tools)}${differ}. Turn it on to take it in and put it in every tool.`;
  }
  const ownSaid = own.length ? ` ${sentence(named(own, tools))} ${own.length === 1 ? 'has a copy' : 'have copies'} Central Knot didn’t put there.` : '';
  if (place === 'off') return `Off · in Central Knot only. Turn it on to put it in every tool.${ownSaid}`;
  const gets = where('gets-it'), out = where('kept-out', 'leaving');
  const parts = [`On in ${named(where('current', 'edited'), tools)}`,
    gets.length ? `${named(gets, tools)} ${gets.length === 1 ? 'gets' : 'get'} it when sync runs` : '',
    out.length ? `kept out of ${named(out, tools)}` : ''];
  return `${parts.filter(Boolean).join(' · ')}${ownSaid ? `.${ownSaid}` : ''}`;
}

/**
 * What the row's switch says: where the agent stands, and what a click does. `question`: a found agent whose copies differ
 * asks which copy every harness uses, and the click opens or closes that question.
 */
export function switchLabel(row: AgentRow, item: LibraryItem | undefined, tools: readonly string[], question?: 'open' | 'closed'): string {
  const name = row.name ?? row.key, place = placeOf(item);
  if (place === 'on') return `${name}: on. Click to take it out of every tool; Central Knot keeps it.`;
  const own = harnessesWhere(row, item, tools, 'own-copy');
  if (place === 'off') {
    const kept = own.length === 1 ? 'has a copy of its own, which is' : 'have copies of their own, which are';
    return `${name}: off, in Central Knot only. Click to put it in every tool${own.length ? `; ${named(own, tools)} ${kept} kept as versions first` : ''}.`;
  }
  const ask = question === 'open' ? 'close the question' : 'choose which copy every tool uses';
  if (question) return `${name}: not in Central Knot, and its copies differ. Click to ${ask}.`;
  return `${name}: in ${named(own, tools)}, not in Central Knot. Click to take it in and put it in every tool.`;
}

/** What the result says after each click. `notIn`: the harnesses where the click's write or removal didn't go through. */
export const said = {
  off(name: string, notIn: readonly string[], tools: readonly string[]): string {
    const left = notIn.length ? `, but still in ${named(notIn, tools)}` : ': no tool has it';
    return `${name} is off${left}. Central Knot keeps it, and turning it on puts each file back as it was.`;
  },
  /** A found agent taken in; `use`: the harness whose copy was chosen where they differed. */
  takenIn(name: string, on: readonly string[], tools: readonly string[], use?: string): string {
    const chosen = use ? `, with ${toolName(use)}’s copy` : '', others = use ? ' The other copies are kept as its versions.' : '';
    return `${name} is in Central Knot now${chosen}, and on in ${named(on, tools)}.${others}`;
  },
  /** One harness's switch: kept out (`out`), or let in again. */
  inHarness(name: string, tool: string, out: boolean, failed: boolean): string {
    const where = toolName(tool);
    if (!out) return failed ? `${name} couldn’t be put in ${where}.` : `${name} is on in ${where} again.`;
    return failed ? `${name} couldn’t be taken out of ${where} yet.` : `${name} is kept out of ${where}. Central Knot keeps its file for when you turn it on there.`;
  },
  /** `on`: the harnesses it was written to; none said for an agent that is off. */
  madeCurrent(name: string, version: Version, on: readonly string[] | undefined, tools: readonly string[]): string {
    return `${name}: the version ${sourceWords(version.from)}, ${dayAndTime(version.at)}, is current again${on ? `, in ${named(on, tools)}` : ''}.`;
  },
  deleted: (name: string, wasOn: boolean) => `${name} is deleted from Central Knot${wasOn ? ', and out of every tool' : ''}. History can restore it.`,
};

/**
 * What sync did to an agent on its own, as its notice says it: an edit taken in as the current version, the latest of two
 * edits, or a copy deleted by hand that turned the agent off. `action`: the notice's button, which runs its History entry's
 * own action (historyactions.ts); `help`: what that does.
 */
export function noticeWords(notice: Pick<SyncNotice, 'kind' | 'item' | 'winner' | 'losers'>): { text: string; action: 'undo' | 'turn-on'; help: string } {
  const who = toolName(notice.winner), others = andList(notice.losers.map(toolName)), name = notice.item;
  const earlier = `Make the version from before ${who}’s edit current again, in every tool ${name} is on in`;
  if (notice.kind === 'deleted') {
    const text = `${name} was deleted in ${who}, so it is off everywhere. Central Knot keeps it.`;
    return { text, action: 'turn-on', help: `Put ${name} back in every tool, each file as it was` };
  }
  if (notice.kind === 'conflict') {
    const text = `${name}: ${who}’s edit is the latest, so it is the current version. ${others}’s is kept as a version.`;
    return { text, action: 'undo', help: earlier };
  }
  return { text: `${name} was edited in ${who}; that is its current version now${others ? `, in ${others} too` : ''}.`, action: 'undo', help: earlier };
}

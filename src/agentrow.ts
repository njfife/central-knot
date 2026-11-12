// An agent's row on the Agents page, without the DOM: where it stands, what each harness's mark says, the clicks its
// controls send, and every sentence the page says about an agent (its status, its switch, a click's result, a notice).
// matrix.ts draws these; the tests click them exactly as the page does (tests/agentclicks.ts).
//
// An agent stands in one of three places (library.ts has the model):
//   on     in Central Knot's library and On: applied to every managed harness it is not kept out of
//   off    in the library and Off: in Central Knot only, in no harness
//   found  in a managed harness, not in the library; its switch takes it in
// What each harness's mark says is the library's plan for the agent (library.ts plan), worked out by agents.ts from the same
// reading a pass makes (copiesOf), so a mark says what the next pass will do there and never something of its own.
import type { VersionChange } from './agentfiles.ts';
import { sourceWords, wantedIn, type LibraryItem, type Plan, type Version } from './library.ts';
import { clockTimesApart, dayAndTime } from './model.ts';
import type { Change, HarnessId, SyncNotice } from './types.ts';
import { andList, sentence, toolName, toolsPhrase } from './words.ts';

/** What the page knows of an agent besides its library item (agents.ts rowFacts gives it; types.ts SkillFacts). */
export interface AgentRow {
  key: string; name?: string;
  /** Each harness's copy, by its content. */
  hashes?: Partial<Record<string, string>>;
  /** In the library: what the next pass does in each harness. */
  plan?: Plan;
  /** Why a harness the agent should be in can't be given a copy, and why a harness's copy can't be seen for sure. */
  cannot?: Partial<Record<string, string>>;
  unseen?: Partial<Record<string, string>>;
  /** Found: its copies differ, so the switch asks which one to take in. */
  differs?: boolean;
}

export type Place = 'on' | 'off' | 'found';
/** The item when the agent is in the library (a deleted one is not: what a harness holds of it is found). */
export const inLibrary = (item: LibraryItem | undefined) => (item && !item.deleted ? item : undefined);
export const placeOf = (item: LibraryItem | undefined): Place => { const inLib = inLibrary(item); return !inLib ? 'found' : inLib.on ? 'on' : 'off'; };

/**
 * What one harness has of an agent, as its mark and its line say it, from the plan:
 * - `current`: the current version; `gets-it`: it is written there at the next pass; `edited`: its copy was edited there and
 *   becomes the current version at the next pass; `deleted`: its copy was deleted there by hand, which turns the agent Off at
 *   the next pass; `leaving`: its copy is removed at the next pass;
 * - `own-copy`: a copy Central Knot didn't put there (a found agent's, or one that turned up while the agent is Off or kept
 *   out of that harness); `kept-out`: the person keeps the agent out of this harness; `none`: no copy;
 * - `cannot`: it can't be given a copy (the row says why); `unseen`: its copy can't be read for sure, so nothing happens there.
 */
export type HarnessIs = 'current' | 'gets-it' | 'edited' | 'deleted' | 'leaving' | 'own-copy' | 'kept-out' | 'none' | 'cannot' | 'unseen';

export function harnessIs(row: AgentRow, item: LibraryItem | undefined, tool: string): HarnessIs {
  const inLib = inLibrary(item), made = row.plan, harness = tool as HarnessId;
  if (row.unseen?.[tool]) return 'unseen';
  if (!inLib || !made) return row.hashes?.[tool] === undefined ? 'none' : 'own-copy';
  if (row.cannot?.[tool]) return 'cannot';
  if (made.takeIn === harness) return 'edited';
  if (made.turnedOffBy === harness) return 'deleted';
  const step = (['write', 'remove', 'found', 'current'] as const).find(list => made[list].includes(harness));
  if (step) return ({ write: 'gets-it', remove: 'leaving', found: 'own-copy', current: 'current' } as const)[step];
  return inLib.on && inLib.except.includes(harness) ? 'kept-out' : 'none';
}

const KEPT_FIRST = 'before it is written over, a copy Central Knot doesn’t have yet is kept as a version';

/** A harness's line in the opened row: what it has, in a sentence. `where` is the harness's name. */
export function harnessLine(row: AgentRow, item: LibraryItem | undefined, tool: string, where: string): string {
  const inLib = inLibrary(item), has = row.hashes?.[tool] !== undefined;
  switch (harnessIs(row, item, tool)) {
    case 'current': return 'Has the current version.';
    case 'gets-it': {
      if (!has) return 'Gets it when sync runs next.';
      // While an edit waits elsewhere, a harness with the current version gets that edit; a copy the library lacks is kept first.
      const edit = row.plan?.takeIn, kept = row.plan?.keep.some(entry => entry.harness === tool);
      const now = row.hashes?.[tool] === inLib?.hash ? 'Has the current version' : 'Has another copy';
      return `${now}. It gets ${edit ? `${toolName(edit)}’s edit` : 'the current version'} when sync runs${kept ? `; ${KEPT_FIRST}` : ''}.`;
    }
    case 'edited': {
      if (wantedIn(inLib!, tool as HarnessId)) return `Edited in ${where}. It becomes the current version when sync runs, and reaches the other tools.`;
      const reaches = inLib!.on ? ' and reaches the other tools' : '';
      return `Edited in ${where}. When sync runs it becomes the current version${reaches}, then its copy here is removed: ${inLib!.on ? 'the agent is kept out of this tool' : 'the agent is off'}.`;
    }
    case 'deleted': return `Its copy was deleted in ${where}. When sync runs, the agent turns off everywhere; Central Knot keeps it.`;
    case 'leaving': return 'Its copy is removed when sync runs. Central Knot keeps it.';
    case 'own-copy':
      if (!inLib) return 'Has it.';
      return `Has a copy Central Knot didn’t put there. It is left alone while ${inLib.on ? 'this tool is kept out' : 'the agent is off'}; ${KEPT_FIRST}.`;
    case 'kept-out': return 'Kept out of this tool. Central Knot keeps its file for when you turn it on here.';
    case 'none': return inLib ? 'No copy while it is off.' : 'No copy. Turning it on adds it here.';
    case 'cannot': return row.cannot![tool]!;
    case 'unseen': return row.unseen![tool]!;
  }
}

/** Whether the switch must ask which copy to take in: a found agent whose copies differ (agents.ts foundCopies). A library item never asks. */
export const needsChoice = (row: AgentRow, item: LibraryItem | undefined) => !inLibrary(item) && !!row.differs;

/** The agent as it is, as a click that changes nothing: each click below changes one thing of it. */
function asItIs(row: AgentRow, item: LibraryItem | undefined): Change {
  const inLib = inLibrary(item);
  return { key: row.key, managed: !!inLib?.on, off: inLib ? [...inLib.except] : [], seenManaged: !!inLib?.on };
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

// ---------- Versions ----------

/** A version's note: what it changed ("prompt changed"), what a copy that gave way differs in ("prompt differs"), or "first version". */
export function versionChange(changed: VersionChange | undefined): string {
  if (changed === undefined || changed === 'unknown' || changed === 'none') return '';
  if (changed === 'first') return 'first version';
  const fields = 'differs' in changed ? changed.differs : changed.changed;
  if (!fields.length) return 'same content';
  return `${andList([...fields])} ${'differs' in changed ? (fields.length > 1 ? 'differ' : 'differs') : 'changed'}`;
}
/** What a version's note is compared with, for its tooltip. */
export function versionChangeHelp(changed: VersionChange | undefined): string | undefined {
  if (changed === undefined || typeof changed === 'string') return undefined;
  return 'differs' in changed ? 'Against the version written over this copy' : 'Against the version that was current before it';
}

/** When a version was made, said short: its time today, else its day and time. */
export const madeAt = (version: Version) => dayAndTime(version.at).replace(/^today at /, '');
/**
 * A version as a sentence names it (History, a Make current's result): its clock time, to the second where two of the
 * agent's versions would read the same minute, as the versions list says them (model.ts clockTimesApart).
 */
export function versionClock(item: Pick<LibraryItem, 'versions'>, version: Version, now = Date.now()): string {
  const at = item.versions.indexOf(version), all = at < 0 ? [...item.versions, version] : item.versions;
  return clockTimesApart(all.map(entry => entry.at), now, true)[at < 0 ? all.length - 1 : at];
}

/** The version a "made current again" one was made from: the earlier entry with its content that came from somewhere else. */
export function madeFrom(item: Pick<LibraryItem, 'versions'>, version: Version): Version | undefined {
  return item.versions.slice(item.versions.indexOf(version) + 1).find(older => older.hash === version.hash && older.from.how !== 'made-current');
}
/**
 * Where a listed version came from, as its row says it: a version made current again names the one it went back to, with
 * that one's time as `when` says it (the list's own form; madeAt by default).
 */
export function versionSource(item: Pick<LibraryItem, 'versions'>, version: Version, when: (source: Version) => string = madeAt): string {
  const source = version.from.how === 'made-current' ? madeFrom(item, version) : undefined;
  return source ? `back to: ${sourceWords(source.from)}, ${when(source)}` : sourceWords(version.from);
}

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

/**
 * The tag after an agent's name when it isn't plainly on everywhere: where it stands, or the tools it is kept out of, and (its
 * tooltip) what that means. `tools`: the home's harnesses.
 */
export function placeTag(row: AgentRow, item: LibraryItem | undefined, tools: readonly string[]): { text: string; title: string } | undefined {
  const place = placeOf(item);
  if (place === 'off') return { text: 'in Central Knot only', title: 'Central Knot keeps this agent and its versions. No tool has it until you turn it on.' };
  const found = 'A tool has this agent; Central Knot doesn’t yet. Turn it on to take it in and put it in every tool.';
  if (place === 'found') return { text: 'not in Central Knot', title: found };
  const out = item!.except.filter(tool => tools.includes(tool)), keptOut = `Kept out of ${andList(out.map(toolName))}. Its switch there, in the opened row, puts it back.`;
  // A tool that can't take it (agents.ts cannotTake) and has no copy is as lasting as one it is kept out of: the tag names
  // where it is. (A tool that holds an older copy, its folder locked, is told by its mark and line alone.)
  const cannot = tools.filter(tool => harnessIs(row, item, tool) === 'cannot' && row.hashes?.[tool] === undefined);
  if (cannot.length) {
    const can = tools.filter(tool => !cannot.includes(tool) && !out.includes(tool as HarnessId));
    return { text: can.length ? `${andList(can.map(toolName))} only` : 'in no tool', title: [...cannot.map(tool => row.cannot![tool]!), out.length ? keptOut : ''].filter(Boolean).join(' ') };
  }
  return out.length ? { text: `not in ${andList(out.map(toolName))}`, title: keptOut } : undefined;
}

/** An agent's status in one line: on and where, in Central Knot only, or found in a harness and not in Central Knot yet. */
export function statusLine(row: AgentRow, item: LibraryItem | undefined, tools: readonly string[]): string {
  const where = (...states: HarnessIs[]) => harnessesWhere(row, item, tools, ...states);
  const own = where('own-copy'), place = placeOf(item);
  if (place === 'found') {
    const differ = needsChoice(row, item) ? ', with different copies' : '';
    return `Not in Central Knot · in ${named(own, tools)}${differ}. Turn it on to take it in and put it in every tool.`;
  }
  const ownSaid = own.length ? ` ${sentence(named(own, tools))} ${own.length === 1 ? 'has a copy' : 'have copies'} Central Knot didn’t put there.` : '';
  if (place === 'off') return `Off · in Central Knot only. Turn it on to put it in every tool.${ownSaid}`;
  // A copy deleted by hand turns the agent Off at the next pass: that is what it is about to be.
  const deletedIn = row.plan?.turnedOffBy;
  if (deletedIn) return `On · its copy was deleted in ${toolName(deletedIn)}, so it turns off everywhere when sync runs. Central Knot keeps it.`;
  // A harness holding the current version that only waits for an edit made elsewhere has it on.
  const waitsForEdit = (tool: string) => row.hashes?.[tool] === item!.hash;
  const gets = where('gets-it').filter(tool => !waitsForEdit(tool)), out = where('kept-out', 'leaving'), cannot = where('cannot');
  const onIn = tools.filter(tool => ['current', 'edited'].includes(harnessIs(row, item, tool)) || (harnessIs(row, item, tool) === 'gets-it' && waitsForEdit(tool)));
  const edit = row.plan?.takeIn;
  const parts = [`On in ${named(onIn, tools)}${cannot.length ? ' only' : ''}`,
    edit ? `${toolName(edit)}’s edit becomes the current version when sync runs` : '',
    gets.length ? `${named(gets, tools)} ${gets.length === 1 ? 'gets' : 'get'} it when sync runs` : '',
    cannot.length ? `${andList(cannot.map(toolName))} can’t take it (see below)` : '',
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
  /** `when`: the version's time (versionClock). `on`: the harnesses it was written to; undefined for an agent that is Off. */
  madeCurrent(name: string, version: Version, when: string, on: readonly string[] | undefined, tools: readonly string[]): string {
    const where = on ? `, in ${named(on, tools)}.` : '. It is Off, so no tool was changed.';
    return `${name}: the version ${sourceWords(version.from)}, ${when}, is current again${where}`;
  },
  deleted: (name: string, wasOn: boolean) => `${name} is deleted from Central Knot${wasOn ? ', and out of every tool' : ''}. History can restore it.`,
  /** Beside Delete from Central Knot, before it is armed: how it differs from Off. */
  deleteOffer: 'Off keeps it here; Delete removes it from Central Knot.',
  /** Under Delete it now: what happens, and for how long History can undo it (`days`: History's days, from Settings). */
  deleteArmed: (days: number) => `It leaves every tool and this page. History keeps it, with its versions, for ${days} days, and can restore it.`,
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

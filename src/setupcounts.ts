// First setup's counts and decisions, pure (no DOM), for the page that asks (firstsetup.ts) and for Settings' row: whether the open
// home is asked the question (asksNow), what Yes would do now (whatYesDoes) and which found items wait for a choice of copy
// (waitingForChoice), each read from the take-in table's rule column as each kind's view gives it (library.ts takeInAnswer through
// librarypass.ts takeInAnswers), the same look the pass then uses; and the walkthrough's place (walkPlace, wayBackIn) and what its
// "Use the latest for the rest" did (latestDone). tests/firstsetup.test.ts holds them to what the pass does.
import { kindSource } from './itemrow.ts';
import type { HarnessId, HomeView, PassResult } from './types.ts';
import { andList } from './words.ts';

/** The pages that list items (app.ts PageKind, written here so this module needs no page). */
type PageKind = 'skills' | 'mcp' | 'agents';

/**
 * Whether the home is asked first setup's question now: never answered (types.ts SyncView syncEverything absent), a tool managed
 * (with none, the Overview points to Harnesses instead), and writable by this build (not preview only, not another build's, its
 * record whole). In a home that waits for Resume, Resume comes first (`resume`), and the question after it.
 */
export function asksNow(home: HomeView): 'question' | 'resume' | undefined {
  const { syncEverything, managed, access, gate } = home.sync;
  if (syncEverything !== undefined || !managed.length || !access.allowed || gate.state === 'stopped') return undefined;
  return gate.state === 'needs-resume' ? 'resume' : 'question';
}

/** The kinds first setup counts, in the pages' order. */
export const KINDS: PageKind[] = ['skills', 'mcp', 'agents'];

/** A found item that waits for a choice of copy. `latest`: a tool holding its latest copy (library.ts latestCopy), and that content. */
export interface Waiting { kind: PageKind; key: string; name: string; latest?: { tool: HarnessId; hash: string } }

/**
 * Every found item that waits for a choice of copy as Synchronize everything leaves it (the take-in table's rule column, so not
 * a plugin's part), in the pages' order: skills, MCP servers, agents, each by name as its table lists it.
 */
export function waitingForChoice(home: HomeView): Waiting[] {
  return KINDS.flatMap(kind => {
    const { facts, tools } = kindSource(home, kind);
    return facts.flatMap((fact): Waiting[] => {
      const rule = fact.takeInAnswers?.rule;
      if (!rule || !('wait' in rule)) return [];
      // The copy question offers no tool that can't take the item (matrix.ts compareChoices): nor does the latest.
      const tool = tools.find(each => rule.latest && fact.copies[each]?.hash === rule.latest && !fact.cannot[each]);
      return [{ kind, key: fact.key, name: fact.name, ...(tool ? { latest: { tool, hash: rule.latest! } } : {}) }];
    }).sort((first, second) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, '')));
  });
}

/**
 * What Yes would do now, counted from the take-in table's rule column as the pass reads it (each kind's view): the items it takes
 * in, the tools that get one (a tool with no copy that can take it and has it no other way), the items that wait for a choice of
 * copy, the MCP servers Claude Code gets only at Write to Claude Code, and whether one was found in Claude Code (whose take-in has
 * no Undo: historyactions.ts givesBackLater).
 */
export function whatYesDoes(home: HomeView) {
  const takes = KINDS.flatMap(kind => { const { facts, tools } = kindSource(home, kind); return facts.filter(fact => fact.takeInAnswers && 'take' in fact.takeInAnswers.rule).map(fact => ({ kind, fact, tools })); });
  const gets = (fact: (typeof takes)[number]['fact'], tools: HarnessId[]) => tools.filter(tool => !fact.copies[tool] && !fact.cannot[tool] && !fact.anotherWay?.[tool]);
  const to = home.sync.managed.filter(tool => takes.some(({ fact, tools }) => gets(fact, tools).includes(tool)));
  const servers = takes.filter(({ kind }) => kind === 'mcp');
  return { takes: takes.length, to, choosing: waitingForChoice(home).length, waitForClaude: servers.filter(({ fact, tools }) => gets(fact, tools).includes('claude-cli')).length,
    fromClaude: servers.some(({ fact }) => !!fact.copies['claude-cli']) };
}

// ---------- The walkthrough ----------

/** An item's place in the walkthrough: its kind and key. */
export const walkId = (item: Waiting) => `${item.kind}:${item.key}`;

/**
 * Where the walkthrough is among the items that wait (`list`: waitingForChoice), given those it passed in this window (`passed`:
 * a copy chosen, or skipped): the item it is at (the first that waits and was not passed), the items left, and its place ("2 of 7").
 */
export function walkPlace(list: Waiting[], passed: readonly string[]) {
  const left = list.filter(item => !passed.includes(walkId(item)));
  return { at: left[0] as Waiting | undefined, left, number: passed.length + 1, of: passed.length + left.length };
}

/** The Overview's way back in: on to where an open walkthrough is (`go-on`), while it has an item left; else it starts again. */
export const wayBackIn = (list: Waiting[], passed: readonly string[], open: boolean): 'go-on' | 'start' => (open && walkPlace(list, passed).at ? 'go-on' : 'start');

/**
 * What "Use the latest for the rest" did, item by item, from each kind's pass (`sent`) and what still waits after (`still`): the items
 * whose latest copy was taken in; those with no dates to go by, skipped; and each dated one still waiting, by what its pass said.
 */
export function latestDone(dated: Waiting[], undated: Waiting[], sent: { kind: PageKind; result: PassResult }[], still: Waiting[]): { text: string; warn: boolean } {
  const names = (list: Waiting[]) => andList(list.map(item => item.name)), waiting = dated.filter(item => still.some(other => walkId(other) === walkId(item)));
  const used = dated.length - waiting.length, said = (item: Waiting) => sent.find(each => each.kind === item.kind)?.result;
  // Why each still waits: its kind's pass stopped, its copy changed since (asked again), or what its pass said of it.
  const why = (item: Waiting) => { const result = said(item), own = result?.results.find(each => each.item === item.name && (each.unchanged || each.outcome !== 'written'));
    return result?.stopped ?? (own?.chooseAgain ? 'again' : own?.message ?? 'again'); };
  const again = waiting.filter(item => why(item) === 'again'), others = waiting.filter(item => why(item) !== 'again');
  const text = [`Used the latest copy for ${used} ${used === 1 ? 'item' : 'items'}, each with its own Undo in History.`,
    undated.length ? `Skipped ${undated.length} with no dates to go by (${names(undated)}): ${undated.length === 1 ? 'it stays' : 'they stay'} found, and ${undated.length === 1 ? 'its row asks' : 'each row asks'} which copy.` : '',
    again.length ? `${names(again)} changed meanwhile, so ${again.length === 1 ? 'it is' : 'they are'} asked again.` : '',
    ...others.map(item => `${item.name} wasn’t chosen: ${why(item)}`)].filter(Boolean).join(' ');
  return { text, warn: waiting.length > 0 };
}

// First setup's counts and its one decision, pure (no DOM), for the page that asks (firstsetup.ts) and for Settings' row: whether
// the open home is asked the question (asksNow), what Yes would do now (whatYesDoes) and which found items wait for a choice of
// copy (waitingForChoice), each read from the take-in table's rule column as each kind's view gives it (library.ts takeInAnswer
// through librarypass.ts takeInAnswers), the same look the pass then uses. tests/firstsetup.test.ts holds them to what the pass does.
import { kindSource } from './itemrow.ts';
import type { HarnessId, HomeView } from './types.ts';

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

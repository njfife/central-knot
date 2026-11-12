// The kinds on Central Knot's library (library.ts) as the item pages show them: what each supplies to its rows. Its words
// are in libraryrow.ts libraryWords (pure, so the tests read them too); here is the rest: where its last click's result is
// kept, how Read gets one of its versions, and what else its opened row shows of its own (an agent: Convert to a Pi skill).
// matrix.ts draws every row of a kind here as a library row (librarySwitch, libraryMark, libraryVersions, libraryDelete, …);
// a kind not here keeps its engine's rows (skills and MCP servers, until their steps).
//
// To put a kind on these rows: its words in libraryrow.ts libraryWords, and its entry in libraryKinds below.
import { convertAgent, state, type Kind } from './app.ts';
import { h, icon } from './dom.ts';
import type { ItemRow } from './itemrow.ts';
import { libraryWords, sentences, type RowWords } from './libraryrow.ts';
import type { PassResult } from './types.ts';
import type { VersionText } from './versionlist.ts';
import { andList } from './words.ts';

/** What a kind on the library supplies to its page. `say`: the sentences made in its words (libraryrow.ts sentences). */
export interface LibraryKind {
  words: RowWords;
  say: ReturnType<typeof sentences>;
  /** Its last click's result, as app.ts keeps it. */
  result(): PassResult | undefined;
  /** One of an item's versions, as Read shows it (versionlist.ts VersionPart). */
  version(key: string, hash: string): Promise<VersionText>;
  /** What else its opened row shows, after where each copy is. */
  own?(skill: ItemRow): HTMLElement | null;
}

export const libraryKinds: Partial<Record<Kind, LibraryKind>> = {
  agents: {
    words: libraryWords.agents, say: sentences(libraryWords.agents), result: () => state.agentsResult, own: convertBlock,
    version: (key, hash) => window.centralKnot.agentVersion(key, hash)
      .then(agent => agent && [{ name: 'description', text: agent.description }, { name: 'prompt', text: agent.prompt, block: true as const }]),
  },
};

/** Pi has no native agents (CD §5): an agent can reach it only as a skill, by an explicit, one-time Convert to skill (AGT-02). */
function convertBlock(skill: ItemRow) {
  if (skill.gone || !state.home?.manage.tools.includes('pi-cli')) return null;
  const done = state.home.manage.skills.find(entry => entry.converted?.agent.toLowerCase() === skill.key.toLowerCase());
  if (done) return h('p.details-limits.details-note', {}, icon('check', 12, 'tone-muted'), `Converted to a Pi skill, “${done.name}”: see it on the Skills page.`);
  const convert = (event: Event) => { event.stopPropagation(); void convertAgent(skill.key, skill.name ?? skill.key); };
  return h('div.convert-block', {},
    h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Pi has no agents. You can convert this one to a skill for Pi: a one-time copy of its name, description and prompt. A skill has no ${andList(['own isolated context', 'tool restrictions', 'model selection'])}, and it is invoked as a skill, not picked as an agent. The agent stays as it is.`),
    // A quiet text action, as matrix.ts smallAction draws one.
    h('button.text-action', { type: 'button', id: `convert-${skill.key}`, disabled: false, onclick: convert }, 'Convert to a Pi skill'));
}

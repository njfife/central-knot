// The kinds on Central Knot's library (library.ts) as the item pages show them, and what each supplies to its page besides
// its words (libraryrow.ts libraryWords, pure, so the tests read them too): how Read gets one of its versions, and what else
// its opened row shows of its own (an agent: Convert to a Pi skill). The table is keyed by the page's name for a kind (app.ts
// PageKind: 'agents'), not the library's (library.ts ItemKind: 'agent'). matrix.ts draws every row of a kind here as a
// library row (librarySwitch, libraryMark, libraryVersions, libraryDelete, …); a kind not here keeps its engine's rows
// (skills and MCP servers, until their steps). Every place a kind is wired in is in librarypass.ts's recipe; this is one.
import { convertAgent, state, type PageKind } from './app.ts';
import { h, icon } from './dom.ts';
import type { ItemRow } from './itemrow.ts';
import { libraryWords, sentences, type RowWords } from './libraryrow.ts';
import type { VersionText } from './versionlist.ts';
import { andList } from './words.ts';

/** What a kind on the library supplies to its page. `say`: the sentences made in its words (libraryrow.ts sentences). */
export interface LibraryPage {
  words: RowWords;
  say: ReturnType<typeof sentences>;
  /** One of an item's versions, as Read shows it (versionlist.ts VersionPart). */
  version(key: string, hash: string): Promise<VersionText>;
  /** What else an item's opened row shows, after where each copy is. */
  own?(row: ItemRow): HTMLElement | null;
}

export const libraryPages: Partial<Record<PageKind, LibraryPage>> = {
  agents: {
    words: libraryWords.agents, say: sentences(libraryWords.agents), own: convertBlock,
    version: (key, hash) => window.centralKnot.agentVersion(key, hash)
      .then(agent => agent && [{ name: 'description', text: agent.description }, { name: 'prompt', text: agent.prompt, block: true as const }]),
  },
};

/** Pi has no native agents (CD §5): an agent can reach it only as a skill, by an explicit, one-time Convert to skill (AGT-02). */
function convertBlock(agent: ItemRow) {
  if (agent.gone || !state.home?.manage.tools.includes('pi-cli')) return null;
  const done = state.home.manage.skills.find(entry => entry.converted?.agent.toLowerCase() === agent.key.toLowerCase());
  if (done) return h('p.details-limits.details-note', {}, icon('check', 12, 'tone-muted'), `Converted to a Pi skill, “${done.name}”: see it on the Skills page.`);
  const convert = (event: Event) => { event.stopPropagation(); void convertAgent(agent.key, agent.name ?? agent.key); };
  return h('div.convert-block', {},
    h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Pi has no agents. You can convert this one to a skill for Pi: a one-time copy of its name, description and prompt. A skill has no ${andList(['own isolated context', 'tool restrictions', 'model selection'])}, and it is invoked as a skill, not picked as an agent. The agent stays as it is.`),
    // A quiet text action, as matrix.ts smallAction draws one.
    h('button.text-action', { type: 'button', id: `convert-${agent.key}`, disabled: false, onclick: convert }, 'Convert to a Pi skill'));
}

// The kinds on Central Knot's library (library.ts) as the item pages show them, and what each supplies to its page besides
// its words (libraryrow.ts libraryWords, pure, so the tests read them too): how Read gets one of its versions, whether it has
// a Files view, what else its opened row shows of its own (an agent: Convert to a Pi skill), and what a tool's line adds
// (a skill: clear that tool's own switch, take over a copy outside Central Knot's). The table is keyed by the page's name
// for a kind (app.ts PageKind: 'agents'), not the library's (library.ts ItemKind: 'agent'). matrix.ts draws every row of a
// kind here as a library row (librarySwitch, libraryMark, libraryVersions, libraryDelete, …). Every place a kind is wired in
// is in librarypass.ts's recipe; this is one.
import { convertAgent, rerender, shownPath, skillAction, state, type PageKind } from './app.ts';
import { h, icon } from './dom.ts';
import type { ItemRow } from './itemrow.ts';
import type { NeutralServer } from './mcp.ts';
import type { HarnessId } from './types.ts';
import { libraryWords, sentences, type RowWords } from './libraryrow.ts';
import type { VersionText } from './versionlist.ts';
import { andList, toolName } from './words.ts';

/** What a kind on the library supplies to its page. `say`: the sentences made in its words (libraryrow.ts sentences). */
export interface LibraryPage {
  words: RowWords;
  say: ReturnType<typeof sentences>;
  /** One of an item's versions, as Read shows it (versionlist.ts VersionPart). */
  version(key: string, hash: string): Promise<VersionText>;
  /** What else an item's opened row shows, after where each copy is. */
  own?(row: ItemRow): HTMLElement | null;
  /** Its own actions on one tool's line in the opened row, beside that tool's switch. */
  tool?(row: ItemRow, tool: HarnessId): HTMLElement | null;
  /** Under one tool's line in the opened row: what an armed action of its own will do, said before the second click. */
  toolNote?(row: ItemRow, tool: HarnessId): HTMLElement | null;
  /** It has the Files view: each copy's files and contents beside the list (pages.ts skillsPage). */
  files?: true;
}

export const libraryPages: Record<PageKind, LibraryPage> = {
  skills: {
    words: libraryWords.skills, say: sentences(libraryWords.skills), files: true, tool: skillToolActions, toolNote: takeOverNote,
    // Read shows its SKILL.md, and names its other files.
    version: (key, hash) => window.centralKnot.skillVersion(key, hash)
      .then(found => found && [{ name: 'SKILL.md', text: found.skill, block: true as const }, ...(found.files.length ? [{ name: 'other files', text: found.files.join(', ') }] : [])]),
  },
  mcp: {
    words: libraryWords.mcp, say: sentences(libraryWords.mcp),
    // Read shows what the server runs, part by part, as its shared part holds it.
    version: (key, hash) => window.centralKnot.serverVersion(key, hash).then(server => server && serverParts(server)),
  },
  agents: {
    words: libraryWords.agents, say: sentences(libraryWords.agents), own: convertBlock,
    version: (key, hash) => window.centralKnot.agentVersion(key, hash)
      .then(agent => agent && [{ name: 'description', text: agent.description }, { name: 'prompt', text: agent.prompt, block: true as const }]),
  },
};

/** An MCP server's version as Read shows it: each part it has, by its word ("command", "environment"), a map one entry a line. */
function serverParts(server: NeutralServer): { name: string; text: string; block?: true }[] {
  const lines = (map: Record<string, string>) => Object.entries(map).map(([key, value]) => `${key}=${value}`).join('\n');
  const parts: [string, string | undefined, boolean?][] = [['transport', server.transport === 'stdio' ? 'command (stdio)' : server.transport.toUpperCase()],
    ['command', server.command], ['arguments', server.args?.join(' ')], ['environment', server.env && lines(server.env), true], ['working folder', server.cwd],
    ['URL', server.url], ['headers', server.headers && lines(server.headers), true]];
  return parts.flatMap(([name, text, block]) => (text ? [{ name, text, ...(block ? { block: true as const } : {}) }] : []));
}

/** Pi has no native agents (CD §5): an agent can reach it only as a skill, by an explicit, one-time Convert to skill (AGT-02). */
function convertBlock(agent: ItemRow) {
  if (!state.home?.sync.tools.includes('pi-cli')) return null;
  const done = state.home.skills.items.find(entry => entry.converted?.agent.toLowerCase() === agent.key.toLowerCase());
  if (done) return h('p.details-limits.details-note', {}, icon('check', 12, 'tone-muted'), `Converted to a Pi skill, “${done.name}”: see it on the Skills page.`);
  const convert = (event: Event) => { event.stopPropagation(); void convertAgent(agent.key, agent.name ?? agent.key); };
  return h('div.convert-block', {},
    h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Pi has no agents. You can convert this one to a skill for Pi: a one-time copy of its name, description and prompt. A skill has no ${andList(['own isolated context', 'tool restrictions', 'model selection'])}, and it is invoked as a skill, not picked as an agent. The agent stays as it is.`),
    // A quiet text action, as matrix.ts smallAction draws one.
    h('button.text-action', { type: 'button', id: `convert-${agent.key}`, disabled: false, onclick: convert }, 'Convert to a Pi skill'));
}

/** A take-over that asks to be confirmed (it removes a copy other apps may read): its skill and tool, until another click. */
let armed: string | undefined;
/**
 * A skill's own actions on one tool's line: "Let <tool> load it", which clears that tool's own switch where it turns the skill
 * off (its line says so; History can undo it); Take over, for a skill in Central Knot, where the tool has it through a link or
 * a copy in ~/.agents/skills (two clicks for the shared copy, which other apps may read; it has no Undo, and says so).
 */
function skillToolActions(row: ItemRow, tool: HarnessId): HTMLElement | null {
  const item = state.home?.skills.library[row.key], name = row.name ?? row.key, where = toolName(tool);
  if (!state.home) return null;
  const action = (label: string, id: string, title: string, run: () => void, danger = false) => {
    const control = h(`button.text-action${danger ? '.text-danger' : ''}`, { type: 'button', id, title, disabled: !!state.busy, onclick: (event: Event) => { event.stopPropagation(); run(); } }, label);
    return control;
  };
  const clear = row.switched?.[tool] ? action(`Let ${where} load it`, `clear-switch-${row.key}-${tool}`,
    `Clear ${where}’s own switch for ${name}, so ${where} loads it again from its next session. History can undo it.`,
    () => void skillAction('clear-switch', row.key, tool, name)) : null;
  // Only a skill in Central Knot takes a copy over: a found one is taken in first, by its switch.
  const outside = item && !item.deleted ? row.takeOver?.[tool] : undefined, key = `${row.key}:${tool}`;
  const take = !outside ? null : outside.kind === 'link'
    ? action('Take over', `take-over-${row.key}-${tool}`, `Replace the link in ${where}’s skills folder with Central Knot’s copy of ${name}. What the link led to is left as it is; if Central Knot doesn’t have that content yet, it is kept as a version first.`,
      () => void skillAction('take-over', row.key, tool, name))
    : armed !== key ? action('Take over…', `take-over-${row.key}-${tool}`, `Remove the copy at ${shownPath(outside.path)} and give each tool that read it Central Knot’s copy. Other apps that read that folder won’t find it there.`,
      () => { armed = key; rerender(); })
      : h('span.delete-armed', {}, action('Cancel', `take-over-cancel-${row.key}-${tool}`, 'Leave the copy where it is', () => { armed = undefined; rerender(); }),
        action('Take over now', `take-over-confirm-${row.key}-${tool}`, `Remove the copy at ${shownPath(outside.path)}; it is kept as a version first if Central Knot doesn’t have that content. This has no Undo.`,
          () => { armed = undefined; void skillAction('take-over', row.key, tool, name); }, true));
  return clear || take ? h('span.details-tool-extra', {}, clear, take) : null;
}

/**
 * The armed Take over…, on its line, as Delete's armed line says it: which folder goes, which tools get Central Knot's copy
 * instead, that other apps reading it won't find it, and that it has no Undo.
 */
function takeOverNote(row: ItemRow, tool: HarnessId): HTMLElement | null {
  const outside = row.takeOver?.[tool];
  if (!outside || armed !== `${row.key}:${tool}`) return null;
  const readers = (Object.keys(row.takeOver ?? {}) as HarnessId[]).filter(each => row.takeOver?.[each]?.path === outside.path).map(toolName);
  return h('p.delete-armed-note.details-tool-note', { id: `take-over-note-${row.key}-${tool}` },
    `Take over now removes the copy at ${shownPath(outside.path)}, keeping what it holds as a version; ${andList(readers)} ${readers.length === 1 ? 'gets' : 'get'} Central Knot’s copy instead. `
    + 'Other apps that read that folder won’t find it there. This has no Undo.');
}

// The kinds on Central Knot's library (library.ts) as the item lists show them, and what each supplies to its page besides
// its words (libraryrow.ts libraryWords, pure, so the tests read them too): how Read gets one of its versions, whether it has
// a Files view, and what a tool's line adds
// (a skill: clear that tool's own switch, take over a copy outside Central Knot's; its shared-folder target and wording are shared with pluginpage.ts). The table is keyed by the page's name
// for a kind (app.ts PageKind: 'agents'), not the library's (library.ts ItemKind: 'agent'). matrix.ts draws every row of a
// kind here as a library row (librarySwitch, libraryMark, libraryVersions, libraryDelete, …). Every place a kind is wired in
// is in librarypass.ts's recipe; this is one.
import { acting, rerender, selectOff, shownPath, skillAction, state, whyKindReadOnly, writeOff, type PageKind } from './app.ts';
import { h, whyOff } from './dom.ts';
import { partId, rowId, type ItemRow } from './itemrow.ts';
import type { NeutralServer } from './mcp.ts';
import type { HarnessId, SharedTakeOver } from './types.ts';
import { libraryWords, sentences, type RowWords } from './libraryrow.ts';
import { pluginOf } from './sourcelink.ts';
import type { VersionText } from './versionlist.ts';
import { andList, toolName } from './words.ts';

/** What a kind on the library supplies to its page. `say`: the sentences made in its words (libraryrow.ts sentences). */
export interface LibraryPage {
  words: RowWords;
  say: ReturnType<typeof sentences>;
  /** One of an item's versions, as Read shows it (versionlist.ts VersionPart). */
  version(key: string, hash: string): Promise<VersionText>;
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
    words: libraryWords.agents, say: sentences(libraryWords.agents), tool: skillToolActions,
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

/** The one shared-folder takeover target for a live skill in Central Knot, read by both the Library row and the Plugins page. */
export function sharedTakeOverTarget(key: string, tool?: HarnessId) {
  const home = state.home;
  const item = home?.skills.library[key];
  if (!home || !item || item.deleted) return undefined;
  const facts = home.skills.items.find(each => each.key === key);
  const shared = facts?.sharedTakeOver;
  if (!shared) return undefined;
  const via = tool && facts.takeOver?.[tool]?.kind === 'shared'
    ? tool
    : (Object.keys(facts.takeOver ?? {}) as HarnessId[]).find(each => facts.takeOver?.[each]?.kind === 'shared');
  if (!via) return undefined;
  const plugin = facts.fromSource && !facts.fromSource.removed ? pluginOf(facts.fromSource.link) : undefined;
  const copy = plugin ? `the plugin ${plugin}’s copy` : 'your own copy from Central Knot';
  return { name: facts.name ?? item.name ?? key, tool: via, shared, copy };
}

/** The one wording for arming and confirming a shared-folder takeover: folder, kept version, tools getting whose copy, readers and other apps losing it, no Undo. */
export function sharedTakeOverWords(shared: SharedTakeOver, copy: string) {
  const at = shownPath(shared.path);
  const gets = shared.gets.map(toolName);
  const loses = shared.loses.map(toolName);
  const given = gets.length ? `${andList(gets)} ${gets.length === 1 ? 'gets' : 'get'} ${copy} instead.` : '';
  const away = loses.length ? `${andList([...loses, 'other apps that read that folder'])} won’t find it there.` : 'Other apps that read that folder won’t find it there.';
  return {
    at,
    armTitle: [`Remove the copy at ${at}.`, given, away].filter(Boolean).join(' '),
    cancel: 'Cancel',
    cancelTitle: 'Leave the copy where it is',
    confirm: 'Take over now',
    confirmTitle: `Remove the copy at ${at}; it is kept as a version first if Central Knot doesn’t have that content. This has no Undo.`,
    note: [`Take over now removes the copy at ${at}, keeping what it holds as a version.`, given, away, 'This has no Undo.'].filter(Boolean).join(' '),
  };
}

/** A take-over that asks to be confirmed (it removes a copy other apps may read): its skill, tool and armed target, until another click. */
let armed: { key: string; expected: SharedTakeOver } | undefined;
/**
 * A skill's own actions on one tool's line, and an agent's in Pi (a skill there): "Let <tool> load it", which clears that tool's
 * own switch where it turns the item off (its line says so; History can undo it); and, for a skill, Take over, for a skill in Central Knot, where the tool has it through a link or
 * a copy in ~/.agents/skills (two clicks for the shared copy, which other apps may read; it has no Undo, and says so).
 */
function skillToolActions(row: ItemRow, tool: HarnessId): HTMLElement | null {
  const home = state.home, item = home?.skills.library[row.key], name = row.name ?? row.key, where = toolName(tool);
  if (!home) return null;
  const action = (label: string, id: string, title: string, run: () => void, { danger = false, keepInSelect = false } = {}) => {
    // A skill's write, as its row's other controls (app.ts writeOff); Cancel stays live in Select's mode.
    const stops = !!whyKindReadOnly(home, row.kind);
    const disabled = keepInSelect ? !!acting() || stops : !!writeOff(stops);
    return h(`button.text-action${danger ? '.text-danger' : ''}`, { type: 'button', id, title, disabled, ...whyOff(keepInSelect ? undefined : selectOff()), onclick: (event: Event) => { event.stopPropagation(); run(); } }, label);
  };
  const clear = row.switchedOff?.includes(tool) ? action(`Let ${where} load it`, partId('clear-switch', rowId(row.kind, row.key), tool),
    `Clear ${where}’s own switch for ${name}, so ${where} loads it again. History can undo it.`,
    () => void skillAction('clear-switch', row.key, tool, name, row.kind === 'agents' ? 'agents' : 'skills')) : null;
  // Only a skill in Central Knot takes a copy over: a found one is taken in first, by its switch.
  const outside = item && !item.deleted ? row.takeOver?.[tool] : undefined;
  const key = `${row.key}:${tool}`;
  const target = outside?.kind === 'shared' ? sharedTakeOverTarget(row.key, tool) : undefined;
  const shared = target ? sharedTakeOverWords(target.shared, target.copy) : undefined;
  const take = !outside ? null : outside.kind === 'link'
    ? action('Take over', partId('take-over', rowId(row.kind, row.key), tool), `Replace the link in ${where}’s skills folder with Central Knot’s copy of ${name}. What the link led to is left as it is; if Central Knot doesn’t have that content yet, it is kept as a version first.`,
      () => void skillAction('take-over', row.key, tool, name))
    : !shared ? null
      : armed?.key !== key ? action('Take over…', partId('take-over', rowId(row.kind, row.key), tool), shared.armTitle,
        () => { armed = { key, expected: target!.shared }; rerender(); })
        : h('span.delete-armed', {}, action(shared.cancel, partId('take-over-cancel', rowId(row.kind, row.key), tool), shared.cancelTitle, () => { armed = undefined; rerender(); }, { keepInSelect: true }),
          action(shared.confirm, partId('take-over-confirm', rowId(row.kind, row.key), tool), shared.confirmTitle, () => {
            const expected = armed?.expected;
            armed = undefined;
            void skillAction('take-over', row.key, tool, name, 'skills', expected, () => {
              const fresh = sharedTakeOverTarget(row.key, tool);
              if (fresh) armed = { key, expected: fresh.shared };
            });
          }, { danger: true }));
  return clear || take ? h('span.details-tool-extra', {}, clear, take) : null;
}

/**
 * The armed Take over…, on its line, as Delete's armed line says it: which folder goes, which tools get whose copy
 * instead, which readers and other apps won't find it, and that it has no Undo.
 */
function takeOverNote(row: ItemRow, tool: HarnessId): HTMLElement | null {
  const target = armed?.key === `${row.key}:${tool}` ? sharedTakeOverTarget(row.key, tool) : undefined;
  if (!target) return null;
  return h('p.delete-armed-note.details-tool-note', { id: partId('take-over-note', rowId(row.kind, row.key), tool) },
    sharedTakeOverWords(target.shared, target.copy).note);
}

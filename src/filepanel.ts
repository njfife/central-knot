// A file panel: an item's file, read and drawn where the item is named. What it reads (FileTarget: a library, found or plugin
// skill's row, an ordinary agent's or MCP server's row, a marketplace skill Find found), the copies it offers (fileCopies, or
// the text Central Knot holds: storedOf), its mark (fileButton), the read with its guard against a later one (setFile →
// skillVersionFile, skillFoundFile, skillPluginFile, agentFile, serverEntry; an agent no tool has: its definition,
// agentVersion; a server in Central Knot: its definition too, serverStored), the panel (filePanel: tabs or a label, the copy
// choice, its close, the text, the path) and its box's height (settleFileBox). Where a panel is drawn is its caller's, a
// FilePlace: a table (matrix.ts Table: under a closed row, or in an open row's details' place, matrix.ts openedPart), and the
// Overview's cards (overview.ts cardFiles). Not here: when a place lets an open file go (matrix.ts drawTable, overview.ts
// kindCards), and Escape (matrix.ts on a table, overview.ts on the Overview).
import { rerender, shownPath, state } from './app.ts';
import { afterLayout, closeButton, fileBlocks, h, icon, pathText } from './dom.ts';
import { partId, type ItemRow, type Tool } from './itemrow.ts';
import { itemKey } from './library.ts';
import { inLibrary } from './libraryrow.ts';
import { libraryPages } from './librarypages.ts';
import { idOf, isPluginRow, itemOf, reloadButton, showInFolder, toolsFor } from './matrix.ts';
import type { PluginRow } from './pluginrows.ts';
import { entryShownIn } from './presence.ts';
import type { FileRead, HarnessId, SearchHit } from './types.ts';
import type { VersionPart } from './versionlist.ts';
import { andList, toolNames } from './words.ts';

/** The file open in a place, kept between draws: the target's id, its version or copy's token, the file shown, the copy's holder, the folder its read found, the tab list, and the text read (null: it couldn't be). */
export interface OpenFile { id: string; token: string; file: string; copy?: { tool: HarnessId; rootLabel?: string }; directory?: string; files?: string[]; loaded?: { text?: string; note?: string; parts?: VersionPart[]; holder?: string } | null }
/**
 * Where a file panel is drawn: the file open there (`view.openFile`), the tool whose copy it offers first (`tool`: a tool's tab's),
 * what the place does as a file opens for an item (`opening`) and once one newly opened is read (`reveal`). A table's say what a
 * table does (matrix.ts fileHooks).
 */
export interface FilePlace { tool?: Tool; view: { openFile?: OpenFile }; opening?: (id: string) => void; reveal?: (id: string) => void }


export type CatalogTarget = { kind: 'catalog'; hit: SearchHit };
export type FileTarget = ItemRow | PluginRow | CatalogTarget;
const isCatalogHit = (target: FileTarget): target is CatalogTarget => target.kind === 'catalog';
/** An ordinary agent's row (in Central Knot or found). A plugin's agent is a PluginRow (kind 'agent') and a Find hit a CatalogTarget: neither has a file mark yet. */
const isAgentRow = (target?: FileTarget): target is ItemRow & { kind: 'agents' } => target?.kind === 'agents';
/** An ordinary MCP server's row (in Central Knot or found). A plugin's server is a PluginRow of kind 'mcp' too: no file mark yet. */
const isServerRow = (target?: FileTarget): target is ItemRow & { kind: 'mcp' } => target?.kind === 'mcp' && !('marketName' in target);
/** The tools whose settings file has a server's entry: one taken in (its copy's path) or not (LibraryFacts namedIn). */
const entryTools = (row: ItemRow) => [...Object.keys(row.paths ?? {}) as HarnessId[], ...row.namedIn ?? []];
export const fileTargetId = (target: FileTarget) => (isCatalogHit(target) ? target.hit.id : idOf(target));
const fileTargetName = (target: FileTarget) => (isCatalogHit(target) ? target.hit.item!.name : isPluginRow(target) ? target.name : target.name ?? target.key);
/** An agent's or a server's current version as Central Knot holds it (storedOf): an agent's parts Read shows (readDefinition), a server's stored file. */
const DEFINITION = 'Central Knot’s definition';
/**
 * The item in Central Knot whose stored text a target's panel offers, by kind: a library skill's current version (it offers no
 * copy: fileCopies; with the path of a tool's copy that holds it, where one does: filePanel); an ordinary agent's definition,
 * where no tool has a copy; an ordinary server's definition, after each tool's entry, unless its only entry is in a tool whose
 * entries aren't read (no mark yet). The stored text is shown where it is asked for or no copy is offered (setFile).
 */
const storedOf = (t: FilePlace, target?: FileTarget) => (target?.kind === 'skills' || (isAgentRow(target) && !fileCopies(t, target).length)
  || (isServerRow(target) && (fileCopies(t, target).length > 0 || !entryTools(target).length)) ? inLibrary(itemOf(target as ItemRow)) : undefined);
interface FileCopy { tool: HarnessId; rootLabel?: string; directory?: string; realDirectory?: string; hash?: string; version?: string; part?: string }
/**
 * The copies a target's panel offers, in column order (tab's tool first): an agent's in each tool with a file for it, a server's
 * in each tool with its entry where entries are read (presence.ts entryShownIn), each read by itself (one shared hash doesn't
 * make two files the same bytes); a found or plugin skill's, collapsed by real folder, or by hash (found) / version (plugin); none
 * of a library skill's (its stored version instead: storedOf).
 */
function fileCopies(t: FilePlace, target: FileTarget): FileCopy[] {
  if (isAgentRow(target)) return (toolsFor(t, 'agents') as HarnessId[]).filter(tool => target.paths?.[tool]).map(tool => ({ tool }));
  if (isServerRow(target)) return (toolsFor(t, 'mcp') as HarnessId[]).filter(tool => entryShownIn(tool) && entryTools(target).includes(tool)).map(tool => ({ tool }));
  if ((target.kind !== 'skill' && target.kind !== 'skills') || (target.kind === 'skills' && inLibrary(itemOf(target)))) return [];
  const hashes = target.kind === 'skills' ? target.folderHashes : undefined;
  const raw = (toolsFor(t, 'skills') as HarnessId[]).flatMap<FileCopy>(tool => target.kind === 'skill'
    ? (target.copies[tool]?.path ? [{ tool, part: target.copies[tool]!.path, realDirectory: target.copies[tool]!.realDirectory, version: target.installs[tool]?.version }] : [])
    : (state.home?.snapshots?.find(entry => entry.harness === tool)?.skills ?? [])
      .filter(entry => itemKey(entry.folder) === target.key)
      .map(entry => ({ tool, rootLabel: entry.rootLabel, directory: entry.directory, realDirectory: entry.realDirectory, hash: hashes?.[entry.realDirectory] })));
  const unique: FileCopy[] = [];
  for (const copy of raw) {
    if (!unique.some(kept => (!!kept.realDirectory && kept.realDirectory === copy.realDirectory)
      || (target.kind === 'skill' ? !!kept.version && kept.version === copy.version : !!kept.hash && kept.hash === copy.hash))) unique.push(copy);
  }
  return unique;
}
/** Change token for a copy: its hash and real folder when hashed, else the home's readId so an unhashed or plugin copy reloads silently on every new view. */
const copyToken = (copy?: FileCopy) => (copy?.hash ? `${copy.hash}:${copy.realDirectory ?? ''}` : `read:${state.home?.readId ?? 0}`);
/**
 * Whether a row has the file mark (fileButton; the reconcile in drawTable asks it too): a skill with a stored version or a copy,
 * a marketplace skill hit with its path, every ordinary agent, an ordinary server but one whose only entry is Codex's.
 */
export const hasFile = (t: FilePlace, target: FileTarget) => (isCatalogHit(target) ? target.hit.item?.kind === 'skill' && !!target.hit.item.path
  : !!storedOf(t, target) || fileCopies(t, target).length > 0);
/** Reloads an open inline file panel when its stored version, found copy, agent's or server's copy, plugin copy, or marketplace copy changes (or its chosen copy disappears). */
export function syncOpenFile(t: FilePlace, target: FileTarget, open: OpenFile) {
  const offered = storedOf(t, target), copies = fileCopies(t, target);
  // Its stored text shown (no copy chosen, or none left to show), or a marketplace hit's copy.
  if ((offered && !(open.copy && copies.length)) || isCatalogHit(target)) {
    if (open.copy || (offered ? offered.hash : copyToken()) !== open.token) setFile(t, target, open.file, false, undefined, false);
    return;
  }
  const matched = open.copy && copies.find(copy => copy.tool === open.copy!.tool && copy.rootLabel === open.copy!.rootLabel);
  const nextCopy = matched ?? copies[0]!;
  if (!matched || copyToken(nextCopy) !== open.token) setFile(t, target, matched ? open.file : undefined, false, undefined, false, nextCopy);
}
/** A tool's copy, as a file panel names it (its chooser; a server's one label). */
const copyName = (tool: HarnessId) => `${toolNames[tool]}’s copy`;
/** The last part of a path: an agent's file name in a tool. */
const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
/** What a file panel's read brings: a file's text (types.ts FileRead), or an agent's definition as the parts Read shows. */
type PanelRead = FileRead & { parts?: VersionPart[] };
/** An agent's current version as its panel shows it: each part Read shows (librarypages.ts version), under its word. */
const readDefinition = (key: string, hash: string): Promise<PanelRead | null> => libraryPages.agents.version(key, hash)
  .then(parts => (Array.isArray(parts) ? { files: [DEFINITION], parts: parts.filter(part => part.text) } : null));
/**
 * Opens a file (`asked`; a skill's SKILL.md when none) of a stored, found, installed plugin or marketplace skill, an agent's file
 * in the chosen tool (or its definition), or a server's entry in the chosen tool (its definition where `asked` is DEFINITION, or
 * no tool has an entry), or closes the file, refocusing its mark when asked. An agent has one file, its holder's (or its
 * definition), so `asked` is not read for it.
 * An open row keeps its details: the file takes their place (openedPart) and closing it brings them back; a copy question is
 * closed instead, the file opening alone.
 */
export function setFile(t: FilePlace, target?: FileTarget, asked?: string, refocus = false, event?: Event, draw = true, copy?: FileCopy) {
  event?.stopPropagation();
  const prev = t.view.openFile;
  const id = target && fileTargetId(target);
  const offered = storedOf(t, target);
  const catalog = target && isCatalogHit(target) ? target.hit.item : undefined;
  // A copy is shown (the one chosen, else the first offered) unless the stored text is asked for (a server's chooser) or none is offered.
  const chosen = target && !catalog && !(offered && asked === DEFINITION) ? (copy ?? fileCopies(t, target)[0]) : undefined;
  const stored = chosen ? undefined : offered;
  // An agent has one file, named as the chosen tool has it; a server, its copy in the chosen tool; a skill opens SKILL.md first.
  const first = isAgentRow(target) ? (chosen ? fileName(target.paths![chosen.tool]!) : DEFINITION)
    : isServerRow(target) ? (chosen ? copyName(chosen.tool) : DEFINITION) : 'SKILL.md';
  const file = isAgentRow(target) || isServerRow(target) ? first : asked ?? first;
  const sameHolder = !!prev && prev.id === id && prev.copy?.tool === chosen?.tool && prev.copy?.rootLabel === chosen?.rootLabel;
  const sameFile = sameHolder && prev.file === file;
  const next: OpenFile | undefined = id && (stored || catalog || chosen)
    ? { id, token: stored ? stored.hash : copyToken(chosen), file,
      ...(chosen ? { copy: { tool: chosen.tool, ...(chosen.rootLabel !== undefined ? { rootLabel: chosen.rootLabel } : {}) } } : {}),
      directory: sameHolder ? prev.directory : undefined,
      files: sameHolder ? prev.files : undefined, loaded: sameFile ? prev.loaded : undefined }
    : undefined;
  if (next) t.opening?.(next.id);
  t.view.openFile = next;
  if (draw) rerender();
  if (!next && refocus && prev) document.getElementById(partId('file', prev.id))?.focus();
  if (!next) return;
  const load: Promise<PanelRead | null> = stored ? (isAgentRow(target) ? readDefinition(target.key, stored.hash)
    : isServerRow(target) ? window.centralKnot.serverStored(target.key, stored.hash) : window.centralKnot.skillVersionFile((target as ItemRow).key, next.token, file))
    : isCatalogHit(target!) ? window.centralKnot.skillPluginFile({ marketName: catalog!.marketName, plugin: catalog!.plugin, part: catalog!.path!, from: 'marketplace', source: catalog!.source }, file)
    : isPluginRow(target!) ? window.centralKnot.skillPluginFile({ marketName: target.marketName, plugin: target.plugin, part: chosen!.part!, from: chosen!.tool }, file)
    : isAgentRow(target) ? window.centralKnot.agentFile(state.home!.home, target.key, chosen!.tool)
    : isServerRow(target) ? window.centralKnot.serverEntry(state.home!.home, target.key, chosen!.tool)
    : window.centralKnot.skillFoundFile(target!.key, chosen!.tool, chosen!.rootLabel, file);
  void load.catch(() => null).then(found => {
    if (t.view.openFile !== next) return;
    if (!found && file !== first) return setFile(t, target, first, false, undefined, true, chosen);
    const loaded = found ? { text: found.text, note: found.note, parts: found.parts, holder: found.holder } : null;
    const unchanged = sameFile && JSON.stringify(next.loaded) === JSON.stringify(loaded)
      && (!found || (JSON.stringify(next.files) === JSON.stringify(found.files) && next.directory === found.directory));
    next.loaded = loaded;
    next.directory = found?.directory;
    if (found) next.files = found.files;
    // An agent's footer names the file this read found: the row may still hold its last spelling (a rename in capitals).
    if (isAgentRow(target) && found?.directory) next.file = found.files[0]!;
    if (draw && prev?.id !== next.id) t.reveal?.(next.id);
    if (!unchanged) rerender();
  });
}
/** Open file mark right after a library, found or plugin skill's name, an ordinary agent's and an ordinary server's (Library list, Find hits, a tool's tabs). */
export function fileButton(t: FilePlace, target: FileTarget) {
  if (!hasFile(t, target)) return null;
  const id = fileTargetId(target);
  const open = t.view.openFile?.id === id;
  const onclick = (event: Event) => setFile(t, open ? undefined : target, undefined, false, event);
  return h('button.row-file-btn', { type: 'button', id: partId('file', id), title: 'Open file',
    'aria-label': `Open file: ${fileTargetName(target)}`, 'aria-pressed': String(open), onclick }, icon('file-text', 14));
}
/**
 * A skill's, an agent's or a server's open file: wrapping tabs (an agent's and a server's one: a label), copy chooser where copies
 * differ (an agent: each tool with a copy; a server: each tool with an entry, then its definition), close mark, fileBlocks
 * body and path footer (a server's entry: its settings file). Under its closed row alone; `back` is the "‹ Back to details" over
 * it in its open row's details' place, under the row or in the dock (openedPart).
 */
export function filePanel(t: FilePlace, target: FileTarget, open: OpenFile, placement: 'row' | 'dock' = 'row', back?: HTMLElement) {
  const id = fileTargetId(target);
  const name = fileTargetName(target);
  const offered = storedOf(t, target), stored = !!offered && !open.copy;
  const copies = fileCopies(t, target);
  const activeAt = open.copy ? copies.findIndex(copy => copy.tool === open.copy!.tool && copy.rootLabel === open.copy!.rootLabel) : -1;
  const active = stored ? undefined : copies[activeAt >= 0 ? activeAt : 0];
  const tabs = open.files ?? [open.file];
  // A stored skill's version shows the path of a tool's copy that holds it; an agent's or a server's definition has none; an
  // agent's file and a server's settings file are the ones its read found (setFile).
  const storedPath = (row: ItemRow) => row.paths?.[toolsFor(t, 'skills').find(each => row.hashes?.[each] === open.token && row.paths?.[each]) ?? ''];
  const dir = !stored ? active?.directory ?? open.directory : target.kind === 'skills' ? storedPath(target as ItemRow) : undefined;
  const leaf = isServerRow(target) ? open.files?.[0] ?? '' : open.file;
  const full = dir && (dir.includes('\\') ? `${dir}\\${leaf.replaceAll('/', '\\')}` : `${dir}/${leaf}`);
  const missing = open.loaded === undefined ? 'Reading…' : 'Its file couldn’t be read.';
  const note = open.loaded ? open.loaded.note : missing;
  const copyLabel = (entry: FileCopy) => (entry.version ? `${copyName(entry.tool)} · ${entry.version}`
    : entry.rootLabel && copies.filter(other => other.tool === entry.tool).length > 1 ? `${copyName(entry.tool)} (${entry.rootLabel})` : copyName(entry.tool));
  // The stored text is the last choice where copies are offered too (a server's definition, after each tool's entry).
  const choices = [...copies.map(copyLabel), ...(offered && copies.length ? [DEFINITION] : [])], shownAt = stored ? copies.length : copies.indexOf(active!);
  const chooseCopy = (event: Event) => {
    const picked = copies[Number((event.target as HTMLSelectElement).value)];
    setFile(t, target, picked ? undefined : DEFINITION, false, undefined, true, picked);
  };
  const chooser = choices.length > 1 ? h('span.select.file-copy-select', {},
    h('select', { id: partId('file-holder', id), 'aria-label': isServerRow(target) ? 'Entry to show' : 'Copy to show', title: choices[shownAt], onchange: chooseCopy },
      choices.map((label, index) => h('option', { value: String(index), selected: index === shownAt }, label))),
    icon('chevrons-up-down', 14)) : null;
  const tab = (file: string) => h(`button.file-tab${file === open.file ? '.is-active' : ''}`, { type: 'button', role: 'tab',
    'aria-selected': String(file === open.file), onclick: () => { if (file !== open.file) setFile(t, target, file, false, undefined, true, active); } }, file);
  // In its details' place the file has no × of its own: Back to details, its icon and Escape close it, the dock's × the dock.
  const close = back ? null : closeButton(() => setFile(t, undefined, undefined, true),
    { id: partId('file-close', id), label: `Close file for ${name}`, title: 'Close', look: '.file-open-close' });
  const blockId = partId('file-text', id, ...(active ? [String(Math.max(0, activeAt))] : []), String(Math.max(0, tabs.indexOf(open.file))));
  const body = note ? [h('p.file-open-state', {}, note)]
    : open.loaded?.parts ? fileBlocks(blockId, `${name} ${open.file}`, open.loaded.parts, holders => andList(holders.map(part => part.name)), { named: true })
    : fileBlocks(blockId, `${name} ${open.file}`, [{ text: open.loaded!.text ?? '' }], () => (active ? copyLabel(active) : isCatalogHit(target) ? `${target.hit.item!.marketName}’s copy` : 'Central Knot’s current version'));
  // A server's path is copied by a button in words: beside its JSON a bare copy icon would read as copying the entry.
  const copy = full && reloadButton(isServerRow(target) ? { chip: 'Copy path', command: full, title: full } : { command: full, title: 'Copy path' }, partId('file-copy', id));
  const foot = full ? [pathText(shownPath(full), full), h('span.file-open-foot-actions', {}, showInFolder(full), copy)]
    : stored ? [h('span.file-open-stored', {}, 'Stored in Central Knot')] : [];
  // An agent's or a server's panel shows one file, or its definition: its name is a label, with nothing to press. A server's
  // entry says where in the file it is, left of its chooser or label (its chooser names it where there is one).
  const label = h(`span.file-open-name${stored ? '.file-open-definition' : ''}`, {}, open.file);
  const lead = isServerRow(target) && h('span.file-open-lead', {}, open.loaded?.holder ? h('span.file-open-where', {}, `In ${open.loaded.holder}`) : null, chooser ? null : label);
  return h(`div.details.details-file-only${placement === 'dock' ? '.details-bare' : ''}`, { role: 'region', 'aria-label': `File for ${name}` }, back ?? null, h('div.file-open-box', {},
    h('div.file-open-head', {}, isAgentRow(target) ? label : lead || h('span.file-open-tabs', { role: 'tablist', 'aria-label': `Files in ${name}` }, tabs.map(tab)),
    h('span.file-open-controls', {}, chooser, close)),
    ...body, h('div.file-open-foot', {}, ...foot)));
}
/**
 * Sizes the open file's box to what its scroll container (the list, the dock, the Overview's page) leaves under it, at most what is left once what
 * it opened from (its row; in the dock, the dock's top) is at the container's top, never under eight lines of its last block's text
 * (an agent's definition: its prompt; openRow's and setFile's revealUnderRow bring it into view).
 */
function settleFileBox(): void {
  const box = document.querySelector<HTMLElement>('.file-open-box'), scroller = box?.closest<HTMLElement>('.scroll');
  if (!box || !scroller) return;
  const sides = scroller.getBoundingClientRect(), top = box.getBoundingClientRect().top, row = box.parentElement?.previousElementSibling;
  const from = row?.matches('.ov-row') ? row.getBoundingClientRect().top : sides.top - scroller.scrollTop;
  const end = Math.max(8, parseFloat(getComputedStyle(scroller).paddingBottom));
  const room = Math.floor(sides.height - (top - from) - end), under = Math.floor(sides.bottom - top - end);
  const pre = [...box.querySelectorAll<HTMLElement>('pre.content')].at(-1), text = pre && getComputedStyle(pre);
  const least = !pre || !text ? 0 : box.offsetHeight - pre.offsetHeight + 8 * parseFloat(text.lineHeight) + parseFloat(text.paddingTop) + parseFloat(text.paddingBottom);
  box.style.maxHeight = `${Math.ceil(Math.max(least, under >= least ? Math.min(under, room) : room))}px`;
}
afterLayout(settleFileBox);

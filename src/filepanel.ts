// A file panel: an item's file, read and drawn where the item is named. What it reads (FileTarget: a library, found or plugin
// skill's, agent's or MCP server's row, a marketplace skill Find found, or a kept version in Central Knot—the
// last version kept of a deleted item or a live item's kept version named by tool(s): KeptTarget), the copies it offers (fileCopies, or the text Central Knot holds: storedOf), its mark
// (fileButton), the read with its guard against a later one (setFile → skillFoundFile, skillPluginFile, pluginItemTexts, agentFile,
// serverEntry; Central Knot's text by hash, readStored → skillVersionFile, agentVersion, serverStored), which version that text
// is (versionWords), the panel (filePanel: tabs or a label, the copy
// choice, its close, the text, the path), its box's height (settleFileBox) and whether a place's open file stays at a draw
// (keepOpenFile, asked by matrix.ts tableOf and placePanel). Where a panel is drawn is its caller's, a FilePlace: a table
// (matrix.ts Table: under a closed row, or in an open row's details' place, matrix.ts openedPart; Escape there is matrix.ts's),
// or a page that names items (a PagePlace: the Overview's cards, History's rows, Settings' added lines, Harnesses' Manage
// question), in three calls: pagePlace once, for its place and its Escape; itemFile at each name, for the Library's mark there,
// at that name's occurrence where the page names an item more than once (a name that may be of an item Central Knot deleted: `itemFile(…) ?? keptFile(…)`, its last version kept;
// itemFile gives a deleted item nothing where the place opens no found rows; and `versionFile` for a live item's kept version by hash and tool(s)); then placePanel with those marks, for the one
// open and its panel, which the page puts under that name's row, marking the row .file-anchored (its tint on History;
// settleFileBox measures from it). Two rows naming one item need an occurrenceId each: two names that would share a mark in one
// draw get one, the first's.
import { rerender, shownPath, state, type Page, type PageKind } from './app.ts';
import { afterLayout, closeButton, fileBlocks, h, icon, pathText } from './dom.ts';
import { partId, rowId, type ItemRow, type Tool } from './itemrow.ts';
import { itemKey } from './library.ts';
import { inLibrary } from './libraryrow.ts';
import { libraryPages } from './librarypages.ts';
import { idOf, isPluginRow, itemOf, reloadButton, rowOf, showInFolder, toolsFor } from './matrix.ts';
import type { PluginRow } from './pluginrows.ts';
import { pageOfPart } from './pluginstatus.ts';
import type { IconName } from './icons.ts';
import type { FileRead, HarnessId, SearchHit } from './types.ts';
import type { VersionPart } from './versionlist.ts';
import { andList, toolName, toolNames } from './words.ts';

/** The file open in a place, kept between draws: the target's id, its version or copy's token, the file shown, the copy's holder, the folder its read found, the tab list, and the text read (null: it couldn't be). */
export interface OpenFile { id: string; token: string; file: string; copy?: { tool: HarnessId; rootLabel?: string }; directory?: string; files?: string[]; loaded?: { text?: string; blocks?: string[]; note?: string; parts?: VersionPart[]; holder?: string } | null }
/**
 * Where a file panel is drawn: the file open there (`view.openFile`), the tool whose copy it offers first (`tool`: a tool's tab's),
 * whether its panels begin with the item's name and say which version it is (`named`: a page's, pagePlace; versionWords),
 * whether a held item's mark opens only the version Central Knot stores (`storedOnly`: Harnesses' Manage question, no tool's
 * copy, chooser or path), what the place does as a file opens for an item (`opening`) and once one newly opened is read
 * (`reveal`). A table's say what a table does (matrix.ts fileHooks). `markOf`: the id of the mark its open file was opened at,
 * where it isn't the item's own (a page's).
 */
export interface FilePlace {
  tool?: Tool; view: { openFile?: OpenFile }; named?: boolean; storedOnly?: boolean;
  opening?: (id: string) => void; reveal?: (id: string) => void; markOf?: (id: string) => string;
}


export type CatalogTarget = { kind: 'catalog'; hit: SearchHit };
/** A kept version in Central Knot: a deleted item's last version (keptFile), or a live item's kept version named by its tool(s) (versionFile). */
export type KeptTarget = { kind: 'kept'; of: PageKind; key: string; hash: string; name: string; tool?: HarnessId | readonly HarnessId[] };
export type FileTarget = ItemRow | PluginRow | CatalogTarget | KeptTarget;
const isCatalogHit = (target: FileTarget): target is CatalogTarget => target.kind === 'catalog';
const isKept = (target?: FileTarget): target is KeptTarget => target?.kind === 'kept';
/** A kept agent's or server's version: one file, its definition, under a label as a row's definition is. */
const keptDefinition = (target?: FileTarget) => isKept(target) && target.of !== 'skills';
/** An ordinary agent's row (in Central Knot or found). A Find hit (CatalogTarget) has no file mark. */
const isAgentRow = (target?: FileTarget): target is ItemRow & { kind: 'agents' } => target?.kind === 'agents';
/** An ordinary MCP server's row (in Central Knot or found). */
const isServerRow = (target?: FileTarget): target is ItemRow & { kind: 'mcp' } => target?.kind === 'mcp' && !('marketName' in target);
/** A plugin's own agent or MCP server (PluginRow of kind 'agent' or 'mcp'): no skill folder, read through pluginItemTexts. */
const isPluginPart = (target?: FileTarget): target is PluginRow & { kind: 'agent' | 'mcp' } => !!target && 'marketName' in target && target.kind !== 'skill';
/** The tools whose settings file has a server's entry: one taken in (its copy's path) or not (LibraryFacts namedIn). */
const entryTools = (row: ItemRow) => [...Object.keys(row.paths ?? {}) as HarnessId[], ...row.namedIn ?? []];
/** A target's id: a row's (kind and key), a hit's, a kept version's kind, key and hash (its item's current version has the row's). */
const fileTargetId = (target: FileTarget) => (isCatalogHit(target) ? target.hit.id
  : isKept(target) ? partId('kept', rowId(target.of, target.key), target.hash) : idOf(target));
const fileTargetName = (target: FileTarget) => (isCatalogHit(target) ? target.hit.item!.name : isKept(target) || isPluginRow(target) ? target.name : target.name ?? target.key);
/** An agent's or a server's current version as Central Knot holds it (storedOf): an agent's parts Read shows (readDefinition), a server's stored file. */
const DEFINITION = 'Central Knot’s definition';
/**
 * The version in Central Knot whose stored text a target's panel offers, by kind: a library skill's current version (it offers no
 * copy: fileCopies; with the path of a tool's copy that holds it, where one does: filePanel); an ordinary agent's definition,
 * where no tool has a copy; an ordinary server's definition, after each tool's entry; a kept version, alone. The stored text is
 * shown where it is asked for or no copy is offered (setFile).
 */
const storedOf = (t: FilePlace, target?: FileTarget): { hash: string } | undefined => (isKept(target) ? target
  : target?.kind === 'skills' || (isAgentRow(target) && !fileCopies(t, target).length) || isServerRow(target) ? inLibrary(itemOf(target as ItemRow)) : undefined);
interface FileCopy { tool: HarnessId; rootLabel?: string; directory?: string; realDirectory?: string; hash?: string; version?: string; part?: string }
/**
 * The copies a target's panel offers, in column order (tab's tool first): an agent's in each tool with a file for it, a server's
 * in each tool with its entry, each read by itself (one shared hash doesn't
 * make two files the same bytes); a found skill's or a plugin item's, collapsed by real folder, or by hash (found) / version (plugin); none
 * of a library skill's, a kept version's or any target on a `storedOnly` place (its stored version instead: storedOf).
 */
function fileCopies(t: FilePlace, target: FileTarget): FileCopy[] {
  if (t.storedOnly) return [];
  if (isAgentRow(target)) return (toolsFor(t, 'agents') as HarnessId[]).filter(tool => target.paths?.[tool]).map(tool => ({ tool }));
  if (isServerRow(target)) return (toolsFor(t, 'mcp') as HarnessId[]).filter(tool => entryTools(target).includes(tool)).map(tool => ({ tool }));
  if (target.kind !== 'skills' && target.kind !== 'skill' && !isPluginPart(target)) return [];
  if (target.kind === 'skills' && inLibrary(itemOf(target))) return [];
  const hashes = target.kind === 'skills' ? target.folderHashes : undefined;
  const raw = (toolsFor(t, isPluginPart(target) ? pageOfPart[target.kind] : 'skills') as HarnessId[]).flatMap<FileCopy>(tool => target.kind === 'skill'
    ? (target.copies[tool]?.path ? [{ tool, part: target.copies[tool]!.path, realDirectory: target.copies[tool]!.realDirectory, version: target.installs[tool]?.version }] : [])
    : isPluginPart(target) ? (target.copies[tool] ? [{ tool, version: target.installs[tool]?.version }] : [])
    : (state.home?.snapshots?.find(entry => entry.harness === tool)?.skills ?? [])
      .filter(entry => itemKey(entry.folder) === target.key)
      .map(entry => ({ tool, rootLabel: entry.rootLabel, directory: entry.directory, realDirectory: entry.realDirectory, hash: hashes?.[entry.realDirectory] })));
  const unique: FileCopy[] = [];
  for (const copy of raw) {
    if (!unique.some(kept => (!!kept.realDirectory && kept.realDirectory === copy.realDirectory)
      || (target.kind !== 'skills' ? !!kept.version && kept.version === copy.version : !!kept.hash && kept.hash === copy.hash))) unique.push(copy);
  }
  return unique;
}
/** Change token for a copy: its hash and real folder when hashed, else the home's readId so an unhashed or plugin copy reloads silently on every new view. */
const copyToken = (copy?: FileCopy) => (copy?.hash ? `${copy.hash}:${copy.realDirectory ?? ''}` : `read:${state.home?.readId ?? 0}`);
/**
 * Whether a row has the file mark (fileButton; the reconcile in tableOf asks it too): a skill with a stored version or a copy,
 * a marketplace skill hit with its path, every agent, a server with an entry in a tool or in Central Knot.
 */
const hasFile = (t: FilePlace, target: FileTarget) => (isCatalogHit(target) ? target.hit.item?.kind === 'skill' && !!target.hit.item.path
  : !!storedOf(t, target) || fileCopies(t, target).length > 0);
/**
 * A place's open file against the targets it shows now (`shown`), at each draw: its target, read again where its copy changed
 * (syncOpenFile); none, the file let go, where no target shown is it or it has no file any more.
 */
export function keepOpenFile(t: FilePlace, shown: readonly FileTarget[]): FileTarget | undefined {
  const open = t.view.openFile, target = open && shown.find(each => fileTargetId(each) === open.id && hasFile(t, each));
  if (target) syncOpenFile(t, target, open!);
  else t.view.openFile = undefined;
  return target;
}
/** Reloads an open inline file panel when its stored version, found copy, agent's or server's copy, plugin copy, or marketplace copy changes (or its chosen copy disappears). */
function syncOpenFile(t: FilePlace, target: FileTarget, open: OpenFile) {
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
/** A tool's copy, as a file panel names it (its chooser; a server's or plugin part's one label). */
const copyName = (tool: HarnessId) => `${toolNames[tool]}’s copy`;
const versionedCopy = (copy: FileCopy) => (copy.version ? `${copyName(copy.tool)} · ${copy.version}` : copyName(copy.tool));
/** The last part of a path: an agent's file name in a tool. */
const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
/** What a file panel's read brings: a file's text (types.ts FileRead), or an agent's definition as the parts Read shows. */
type PanelRead = FileRead & { parts?: VersionPart[] };
/** An agent's current version as its panel shows it: each part Read shows (librarypages.ts version), under its word. */
const readDefinition = (key: string, hash: string): Promise<PanelRead | null> => libraryPages.agents.version(key, hash)
  .then(parts => (Array.isArray(parts) ? { files: [DEFINITION], parts: parts.filter(part => part.text) } : null));
/** A version Central Knot stores (a row's item's: storedOf; a kept one), by the item's kind and key and its hash: an agent's parts, a server's definition, a skill's file. */
const readStored = (of: PageKind, key: string, hash: string, file: string): Promise<PanelRead | null> => (of === 'agents' ? readDefinition(key, hash)
  : of === 'mcp' ? window.centralKnot.serverStored(key, hash) : window.centralKnot.skillVersionFile(key, hash, file));
const keptWho = (tool: HarnessId | readonly HarnessId[]) => (typeof tool === 'string' ? toolName(tool) : andList(tool.map(toolName)));
/**
 * Which version of Central Knot's text a panel shows, and what it says where its read brings nothing (`nothing`: it came back
 * empty): a live item's kept version named by its tool(s) (`<Tool>’s version · kept`, or just `<Tool>’s version` where nothing
 * was read); a deleted item's last version kept (or, where its read brought nothing, only that it is deleted); on a `storedOnly`
 * place, Central Knot's version alone; elsewhere, the item's current version. Said by a page's panel's header (`now`: each part
 * before one of the header's dots, the first after `glyph`, the bin History's delete rows have; `file`: whether it names the file
 * shown), a page's mark's hover (`open`), the text's accessible name, a table's panel's too (`owner`), and the panel where the
 * read brings nothing (`unread`, a tool's copy's too). A kept version's read brings nothing where it was let go (skillstore.ts
 * pruneDeleted, at History's days), and also where its file is there but can't be read: the read doesn't say which.
 */
const versionWords = (t: FilePlace, target: FileTarget, nothing = false): { now: string[]; glyph?: IconName; file: boolean; open: string; owner: string; unread: string } => {
  if (isKept(target) && target.tool) {
    const who = `${keptWho(target.tool)}’s version`;
    return { now: nothing ? [who] : [who, 'kept'], file: !nothing, open: `Read ${who}`, owner: who, unread: 'Central Knot no longer keeps this version.' };
  }
  if (isKept(target)) return { now: nothing ? ['deleted'] : ['deleted', 'last version kept'], glyph: 'trash-2', file: !nothing, open: 'Open the last version kept', owner: 'Central Knot’s last version kept', unread: 'Central Knot no longer keeps this version.' };
  if (t.storedOnly) return { now: ['Central Knot’s version'], file: true, open: 'Open Central Knot’s version', owner: 'Central Knot’s version', unread: 'Its file couldn’t be read.' };
  return { now: ['current version'], file: true, open: 'Open the current version', owner: 'Central Knot’s current version', unread: 'Its file couldn’t be read.' };
};
/**
 * Opens a file (`asked`; a skill's SKILL.md when none) of a stored, found, installed plugin or marketplace skill, an agent's file
 * in the chosen tool (or its definition), a server's entry in the chosen tool (its definition where `asked` is DEFINITION, or
 * no tool has an entry), or a kept version's, or closes the file, refocusing its mark when asked. An agent has one file, its
 * holder's (or its definition), so `asked` is not read for it; nor for a kept agent or server (its definition).
 * The place is told as a file opens (FilePlace opening: a table closes the row's copy question, the file opening alone) and
 * once one newly opened is read (FilePlace reveal).
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
  // An agent has one file, named as the chosen tool has it; a server or plugin part, its copy in the chosen tool; a skill opens SKILL.md first.
  const first = isAgentRow(target) ? (chosen ? fileName(target.paths![chosen.tool]!) : DEFINITION)
    : isServerRow(target) ? (chosen ? copyName(chosen.tool) : DEFINITION)
    : isPluginPart(target) ? (chosen ? versionedCopy(chosen) : '')
    : keptDefinition(target) ? DEFINITION : 'SKILL.md';
  const file = isAgentRow(target) || isServerRow(target) || isPluginPart(target) || keptDefinition(target) ? first : asked ?? first;
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
  if (!next && refocus && prev) document.getElementById(t.markOf?.(prev.id) ?? partId('file', prev.id))?.focus();
  if (!next) return;
  const load: Promise<PanelRead | null> = isKept(target) ? readStored(target.of, target.key, target.hash, file)
    : stored ? readStored((target as ItemRow).kind, (target as ItemRow).key, stored.hash, file)
    : isCatalogHit(target!) ? window.centralKnot.skillPluginFile({ marketName: catalog!.marketName, plugin: catalog!.plugin, part: catalog!.path!, from: 'marketplace', source: catalog!.source }, file)
    : isPluginPart(target) ? window.centralKnot.pluginItemTexts(target.plugin, target.marketName, target.kind, target.name)
      .then(texts => { const hit = texts.find(each => each.tool === chosen!.tool); return hit ? { files: [file], text: hit.text } : null; })
    : isPluginRow(target!) ? window.centralKnot.skillPluginFile({ marketName: target.marketName, plugin: target.plugin, part: chosen!.part!, from: chosen!.tool }, file)
    : isAgentRow(target) ? window.centralKnot.agentFile(state.home!.home, target.key, chosen!.tool)
    : isServerRow(target) ? window.centralKnot.serverEntry(state.home!.home, target.key, chosen!.tool)
    : window.centralKnot.skillFoundFile(target!.key, chosen!.tool, chosen!.rootLabel, file);
  void load.catch(() => null).then(found => {
    if (t.view.openFile !== next) return;
    if (!found && file !== first) return setFile(t, target, first, false, undefined, true, chosen);
    const loaded = found ? { text: found.text, blocks: found.blocks, note: found.note, parts: found.parts, holder: found.holder } : null;
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
/** A file mark: its id, its hover, whether its file is open, what a press does (a table's: fileButton; a page's: itemFile). */
const markButton = (target: FileTarget, id: string, title: string, open: boolean, onclick: (event: Event) => void) => h('button.row-file-btn',
  { type: 'button', id, title, 'aria-label': isKept(target) && target.tool ? `${title} of ${fileTargetName(target)}` : `Open file: ${fileTargetName(target)}`, 'aria-pressed': String(open), onclick }, icon('file-text', 14));
/** Open file mark right after a library, found or plugin skill's, agent's or server's name (Library list, Find hits, a tool's tabs). */
export function fileButton(t: FilePlace, target: FileTarget) {
  if (!hasFile(t, target)) return null;
  const id = fileTargetId(target), open = t.view.openFile?.id === id;
  return markButton(target, partId('file', id), 'Open file', open, event => setFile(t, open ? undefined : target, undefined, false, event));
}
/**
 * A skill's, an agent's or a server's open file: wrapping tabs (an agent's and a server's one: a label), copy chooser where copies
 * differ (an agent: each tool with a copy; a server: each tool with an entry, then its definition), close mark, fileBlocks
 * body and path footer (a server's entry: its settings file), the item's name first where the place asks (FilePlace named).
 * Under its closed row alone; `back` is the "‹ Back to details" over it in its open row's details' place, under the row or in
 * the dock (openedPart). `bare`: no band of its own (the dock's, the Overview's).
 */
export function filePanel(t: FilePlace, target: FileTarget, open: OpenFile, bare = false, back?: HTMLElement) {
  const id = fileTargetId(target);
  const name = fileTargetName(target), words = versionWords(t, target, open.loaded === null);
  const offered = storedOf(t, target), stored = !!offered && !open.copy;
  const copies = fileCopies(t, target);
  const activeAt = open.copy ? copies.findIndex(copy => copy.tool === open.copy!.tool && copy.rootLabel === open.copy!.rootLabel) : -1;
  const active = stored ? undefined : copies[activeAt >= 0 ? activeAt : 0];
  const tabs = open.files ?? [open.file];
  // A stored skill's version shows the path of a tool's copy that holds it unless the place is storedOnly; an agent's or a
  // server's definition has none; an agent's file and a server's settings file are the ones its read found (setFile).
  const storedPath = (row: ItemRow) => row.paths?.[toolsFor(t, 'skills').find(each => row.hashes?.[each] === open.token && row.paths?.[each]) ?? ''];
  const dir = !stored ? active?.directory ?? open.directory : !t.storedOnly && target.kind === 'skills' ? storedPath(target as ItemRow) : undefined;
  const leaf = isServerRow(target) ? open.files?.[0] ?? '' : open.file;
  const full = dir && (dir.includes('\\') ? `${dir}\\${leaf.replaceAll('/', '\\')}` : `${dir}/${leaf}`);
  const missing = open.loaded === undefined ? 'Reading…' : words.unread;
  const note = open.loaded ? open.loaded.note : missing;
  const copyLabel = (entry: FileCopy) => (entry.version ? versionedCopy(entry)
    : entry.rootLabel && copies.filter(other => other.tool === entry.tool).length > 1 ? `${copyName(entry.tool)} (${entry.rootLabel})` : copyName(entry.tool));
  // The stored text is the last choice where copies are offered too (a server's definition, after each tool's entry).
  const choices = [...copies.map(copyLabel), ...(offered && copies.length ? [DEFINITION] : [])], shownAt = stored ? copies.length : copies.indexOf(active!);
  const chooseCopy = (event: Event) => {
    const picked = copies[Number((event.target as HTMLSelectElement).value)];
    setFile(t, target, picked ? undefined : DEFINITION, false, undefined, true, picked);
  };
  const chooser = choices.length > 1 ? h('span.select.file-copy-select', {},
    h('select', { id: partId('file-holder', id), 'aria-label': target.kind === 'mcp' ? 'Entry to show' : 'Copy to show', title: choices[shownAt], onchange: chooseCopy },
      choices.map((label, index) => h('option', { value: String(index), selected: index === shownAt }, label))),
    icon('chevrons-up-down', 14)) : null;
  const tab = (file: string) => h(`button.file-tab${file === open.file ? '.is-active' : ''}`, { type: 'button', role: 'tab',
    'aria-selected': String(file === open.file), onclick: () => { if (file !== open.file) setFile(t, target, file, false, undefined, true, active); } }, file);
  // In its details' place the file has no × of its own: Back to details, its icon and Escape close it, the dock's × the dock.
  const close = back ? null : closeButton(() => setFile(t, undefined, undefined, true),
    { id: partId('file-close', id), label: `Close file for ${name}`, title: 'Close', look: '.file-open-close' });
  const blockId = partId('file-text', id, ...(active ? [String(Math.max(0, activeAt))] : []), String(Math.max(0, tabs.indexOf(open.file))));
  const owner = () => (active ? copyLabel(active) : isCatalogHit(target) ? `${target.hit.item!.marketName}’s copy` : words.owner);
  // A Codex entry's blocks, each apart: between two, a separator named for the lines between them, its words drawn by CSS from
  // that name, so no selection or copy of the blocks holds them.
  const body = note ? [h('p.file-open-state', {}, note)]
    : open.loaded?.parts ? fileBlocks(blockId, `${name} ${open.file}`, open.loaded.parts, holders => andList(holders.map(part => part.name)), { named: true })
    : open.loaded?.blocks ? open.loaded.blocks.flatMap((text, index) => [index ? h('div.file-open-gap', { role: 'separator', 'aria-label': 'Other lines in the file' }) : null,
      ...fileBlocks(`${blockId}-${index}`, `${name} ${open.file}`, [{ text }], owner)])
    : fileBlocks(blockId, `${name} ${open.file}`, [{ text: open.loaded!.text ?? '' }], owner);
  // A server's path is copied by a button in words: beside its JSON a bare copy icon would read as copying the entry.
  const copy = full && reloadButton(isServerRow(target) ? { chip: 'Copy path', command: full, title: full } : { command: full, title: 'Copy path' }, partId('file-copy', id));
  // Where the stored text is shown, a table's foot says so; a page's header has said which version it is, and it has no foot.
  const foot = full ? [pathText(shownPath(full), full), h('span.file-open-foot-actions', {}, showInFolder(full), copy)]
    : stored && !t.named ? [h('span.file-open-stored', {}, 'Stored in Central Knot')] : [];
  // An agent's or a server's panel shows one file, or its definition: its name is a label, with nothing to press. A server's
  // entry says where in the file it is, left of its chooser, or of its label after a dot (its chooser names it where there is one).
  const label = h(`span.file-open-name${stored || isPluginPart(target) ? '.file-open-definition' : ''}`, {}, open.file);
  const where = open.loaded?.holder ? h('span.file-open-where', {}, `In ${open.loaded.holder}`) : null;
  const lead = isServerRow(target) && h('span.file-open-lead', {}, where, where && !chooser ? h('span.meta-dot', { 'aria-hidden': 'true' }, '·') : null, chooser ? null : label);
  const shows = isAgentRow(target) || keptDefinition(target) ? label
    : isPluginPart(target) ? (chooser ? (t.named ? null : h('span.file-open-lead', {})) : label)
    : lead || h('span.file-open-tabs', { role: 'tablist', 'aria-label': `Files in ${name}` }, tabs.map(tab));
  return h(`div.details.details-file-only${bare ? '.details-bare' : ''}`, { role: 'region', 'aria-label': `File for ${name}` }, back ?? null, h('div.file-open-box', {},
    h('div.file-open-head', {}, t.named ? h('span.file-open-named', {}, h('strong.file-open-item', {}, name),
      ...words.now.map((part, index) => h('span.file-open-now', {}, index || !words.glyph ? null : icon(words.glyph, 12), part)), words.file ? shows : null) : shows,
      h('span.file-open-controls', {}, chooser, close)),
    ...body, foot.length ? h('div.file-open-foot', {}, ...foot) : null));
}

// ---------- A page that names items (the header's three calls) ----------

/** What a page's scroll box differs by when sizing an open file box (settleFileBox): its scroll container, sticky height above it, and bottom padding. */
export interface BoxRoom { scroller: HTMLElement; sticky?: number; padding?: number }
/**
 * A page as a file panel's place (pagePlace): its page; the name its open file was opened at (`occurrenceId`); the home and
 * visit that file belongs to (`on`: thisVisit); whether its names open a found copy's or a plugin's row too (`foundAndPlugins`);
 * the marks drawn since it last placed its panel (`drawn`: itemFile, placePanel).
 */
export interface PagePlace extends FilePlace { page: Page; occurrenceId?: string; on?: string; foundAndPlugins?: boolean; drawn?: Set<string> }
/** A name's mark (itemFile): the name's occurrence, the row its file is read from, the mark. */
export interface FileMark { occurrenceId?: string; target: FileTarget; mark: HTMLElement }
/** A mark's id on a page: the item's own (`file-<row id>`, as a table's), then the name's occurrence where there is one. */
const markId = (id: string, occurrenceId?: string) => partId('file', id, ...(occurrenceId === undefined ? [] : [occurrenceId]));
const panelId = (page: Page) => `file-panel-${page}`;
const boxRooms = new Map<string, (box: HTMLElement) => BoxRoom | undefined>();

/**
 * A page's place, its Escape heard on the window: after every listener on the document (a confirmation's on Settings, Profiles
 * and History, and History's Manage question first; on Harnesses, managecard.ts leaves Escape to this panel while it is open).
 */
export function pagePlace(page: Page, options: Pick<PagePlace, 'foundAndPlugins' | 'storedOnly'> & { boxRoom?: (box: HTMLElement) => BoxRoom | undefined } = {}): PagePlace {
  const { boxRoom, ...placeOptions } = options;
  if (boxRoom) boxRooms.set(panelId(page), boxRoom);
  const place: PagePlace = { page, ...placeOptions, view: {}, named: true, markOf: id => markId(id, place.occurrenceId),
    reveal: () => requestAnimationFrame(() => document.getElementById(panelId(page))?.scrollIntoView({ block: 'nearest' })) };
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && state.page === page && place.view.openFile) setFile(place, undefined, undefined, true);
  });
  return place;
}
/** A page's place holds its file for the home and the visit it was opened on (app.ts state.visit): on another, none is open. */
function thisVisit(place: PagePlace) {
  const on = `${state.home?.home} ${state.visit}`;
  if (place.on !== on) Object.assign(place, { on, view: {}, occurrenceId: undefined, drawn: undefined });
}
/** The mark at a name of an item Central Knot holds (found and plugin rows too where the place opens them), at its occurrence. */
export function itemFile(place: PagePlace, kind: PageKind, key: string, occurrenceId?: string): FileMark | undefined {
  thisVisit(place);
  const target = inLibrary(state.home?.[kind].library[key]) || place.foundAndPlugins ? rowOf(kind, key) : undefined;
  return target && nameMark(place, target, occurrenceId);
}
/** The mark at a name of an item Central Knot deleted, at its occurrence: the last version its tombstone keeps (KeptTarget). */
export function keptFile(place: PagePlace, kind: PageKind, key: string, occurrenceId?: string): FileMark | undefined {
  thisVisit(place);
  const item = state.home?.[kind].library[key];
  return item?.deleted ? nameMark(place, { kind: 'kept', of: kind, key, hash: item.hash, name: item.name }, occurrenceId) : undefined;
}
/** The mark for a kept version of a live item (historypage.ts), at its occurrence: read by hash with its tool's name (KeptTarget). */
export function versionFile(place: PagePlace, kind: PageKind, key: string, hash: string, tool: HarnessId | readonly HarnessId[], occurrenceId?: string): FileMark | undefined {
  thisVisit(place);
  const item = state.home?.[kind].library[key];
  return item && !item.deleted ? nameMark(place, { kind: 'kept', of: kind, key, hash, name: item.name, tool }, occurrenceId) : undefined;
}
/** A target's mark at a name (itemFile, keptFile, versionFile), once a draw; pressed, its file opens there. */
function nameMark(place: PagePlace, target: FileTarget, occurrenceId?: string): FileMark | undefined {
  if (!hasFile(place, target)) return undefined;
  const id = fileTargetId(target), drawn = (place.drawn ??= new Set()), open = place.view.openFile?.id === id && place.occurrenceId === occurrenceId;
  // A second name with the same mark in one draw (an entry stored twice, two most used found as one row) has none.
  if (drawn.has(markId(id, occurrenceId))) return undefined;
  drawn.add(markId(id, occurrenceId));
  // Pressed at another name of the open item, its file moves there and is brought into view.
  const moves = !open && place.view.openFile?.id === id;
  const onclick = (event: Event) => { place.occurrenceId = occurrenceId; setFile(place, open ? undefined : target, undefined, false, event); if (moves) place.reveal?.(id); };
  return { occurrenceId, target, mark: markButton(target, markId(id, occurrenceId), versionWords(place, target).open, open, onclick) };
}
/** The open file against the marks drawn now (`shown`): the very mark it was opened at, with its panel; else none, the file let go. */
export function placePanel(place: PagePlace, shown: readonly (FileMark | undefined)[]): { mark: FileMark; panel: HTMLElement } | undefined {
  thisVisit(place);
  place.drawn = undefined;
  const here = shown.filter((mark): mark is FileMark => !!mark && mark.occurrenceId === place.occurrenceId), target = keepOpenFile(place, here.map(mark => mark.target));
  const mark = here.find(each => each.target === target);
  if (!mark) return undefined;
  const panel = filePanel(place, mark.target, place.view.openFile!, true);
  panel.setAttribute('id', panelId(place.page));
  return { mark, panel };
}
/**
 * Sizes the open file's box to what its scroll container (the list, the dock, a page) leaves under it, at most what is left once
 * its row (a table's, just before it; a page's, .file-anchored; elsewhere, the top of what scrolls) is at the container's top,
 * never under eight lines of its last block's text (an agent's definition: its prompt), and one with no text (a sentence:
 * Reading…, a version no longer kept, a file that couldn't be read) never under its own height. It is measured before the page
 * puts its scroll back (renderer.ts renderWindow), so where it is then may not be where it is drawn. A place's reveal
 * (FilePlace) brings it into view.
 */
function settleFileBox(): void {
  const box = document.querySelector<HTMLElement>('.file-open-box');
  if (!box) return;
  const custom = box.parentElement?.id ? boxRooms.get(box.parentElement.id)?.(box) : undefined;
  const scroller = custom?.scroller ?? box.closest<HTMLElement>('.scroll');
  if (!scroller) return;
  const sides = scroller.getBoundingClientRect(), top = box.getBoundingClientRect().top, before = box.parentElement?.previousElementSibling;
  const row = before?.matches('.ov-row') ? before : scroller.querySelector('.file-anchored');
  const sticky = custom?.sticky ?? 0, from = row ? row.getBoundingClientRect().top : sides.top - scroller.scrollTop;
  // A page's panel leaves its scroll margin under it (style.css: a row's height), so the next row shows below its box.
  const end = Math.max(8, parseFloat(getComputedStyle(scroller).paddingBottom) + (custom?.padding ?? 0))
    + (parseFloat(getComputedStyle(box.parentElement!).scrollMarginBottom) || 0);
  const room = Math.floor(sides.height - sticky - (top - from) - end), under = Math.floor(sides.bottom - top - end);
  const pre = [...box.querySelectorAll<HTMLElement>('pre.content')].at(-1), text = pre && getComputedStyle(pre);
  const least = !pre || !text ? box.scrollHeight + box.offsetHeight - box.clientHeight
    : box.offsetHeight - pre.offsetHeight + 8 * parseFloat(text.lineHeight) + parseFloat(text.paddingTop) + parseFloat(text.paddingBottom);
  const floor = !pre || !text ? least : custom ? Math.min(least, Math.max(0, room)) : least;
  box.style.maxHeight = `${Math.ceil(Math.max(floor, under >= floor ? Math.min(under, room) : room))}px`;
}
afterLayout(settleFileBox);

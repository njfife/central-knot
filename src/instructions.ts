// Instructions: each tool's own user-wide instruction file, viewed and edited in place (INS-01, INS-02).
// A save is a checked write of one file: it must still hold what the editor opened, the text it replaces is kept first, and every
// earlier version can be put back. Nothing here empties a file; the only deletion is an Undo removing a file its own base save
// created, while it still holds what was written. No project or workspace file is read or written.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { lineDiff } from './diff.ts';
import { errorCode, landingOf, managedNow, plainError, recoverParked, removeFileChecked, sha256, storeDirectory, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { baseAction, comparableBase, draftedOwn, fileWithBase, readersOfFile, sameBase, splitBase } from './basetext.ts';
import { leftOutSentence, lineCount, linesOf, toolList, toolName } from './words.ts';
import { harnessIds } from './harnesses.ts';
import { isPresent } from './presence.ts';
import { onlyAllowed } from './values.ts';
import type { BaseApply, BaseHeld, BaseList, BaseResult, BaseUndo, BaseView, HarnessId, InstructionFile, InstructionSave, Snapshot } from './types.ts';

const readText = (path: string) => readFile(path, 'utf8').then(text => text, () => undefined);
/** Every file a save can write in a tool's folder (Pi's CLAUDE.md: the file Pi reads when its folder has no AGENTS.md). */
export const instructionFiles: Record<HarnessId, string[]> = {
  'claude-cli': ['CLAUDE.md'], 'copilot-cli': ['copilot-instructions.md'], 'codex-cli': ['AGENTS.md', 'AGENTS.override.md'], 'pi-cli': ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'],
  'opencode-cli': ['AGENTS.md'],
};
/** Where earlier versions are kept: one folder per tool, and one for the base instructions. */
type Shelf = HarnessId | 'base';
const versionsFolder = (home: string, shelf: Shelf) => join(storeDirectory(home), 'instructions', shelf);
/** The base instructions are one Markdown file in Central Knot's store; which tools get them is kept beside it. */
const basePath = (home: string) => join(storeDirectory(home), 'instructions', 'base.md');
const baseListPath = (home: string) => join(storeDirectory(home), 'instructions', 'base-tools.json');
/** The hash of a base copy as a block holds it, so a copy and the base text it came from compare equal. */
const copyHash = (copy: string) => sha256(comparableBase(copy));
/** A file's hash for checks: '' when there is no file. */
const hashOf = (text: string | undefined) => (text === undefined ? '' : sha256(text));

/** The file a tool actually reads, with what the editor must say about it (capability data §6). */
async function bind(tool: HarnessId, root: string, home: string): Promise<{ path: string; readers: string; notes: string[] }> {
  switch (tool) {
    case 'claude-cli':
      return { path: join(root, 'CLAUDE.md'), readers: 'Claude Code reads this in every session, in the CLI and the Code tab.', notes: [] };
    case 'codex-cli': {
      // A non-empty AGENTS.override.md wins over AGENTS.md: the editor binds the file Codex really reads.
      const override = join(root, 'AGENTS.override.md');
      const text = await readText(override);
      if (text && text.trim()) return { path: override, readers: 'Codex reads this in every session, in the CLI and in ChatGPT desktop’s Codex, which share this folder.', notes: ['AGENTS.override.md is not empty, so Codex reads it instead of AGENTS.md. This edits the override.'] };
      return { path: join(root, 'AGENTS.md'), readers: 'Codex reads this in every session, in the CLI and in ChatGPT desktop’s Codex, which share this folder.', notes: [] };
    }
    case 'pi-cli': {
      // Pi documents AGENTS.override.md (untested): bound when present. With no AGENTS.md, Pi reads a CLAUDE.md in the same folder,
      // so that is the file bound: creating AGENTS.md beside it would shadow it (tested).
      const override = join(root, 'AGENTS.override.md');
      const text = await readText(override);
      const notes: string[] = [];
      let path = join(root, 'AGENTS.md');
      if (text && text.trim()) { path = override; notes.push('AGENTS.override.md is not empty, so it is the file bound here (documented for Pi, not yet tested).'); }
      else if (await readText(path) === undefined && await readText(join(root, 'CLAUDE.md')) !== undefined) { path = join(root, 'CLAUDE.md'); notes.push('This folder has no AGENTS.md, so Pi reads its CLAUDE.md, and that is the file shown and changed here.'); }
      notes.push('SYSTEM.md and APPEND_SYSTEM.md, if present, replace or extend Pi’s built-in prompt; they are not shown or changed here.');
      return { path, readers: 'Pi reads this in every session.', notes };
    }
    case 'opencode-cli': {
      // Sent in a new session by 1.19.5 and 2.2.5 alike. With no AGENTS.md here, 1.19.5 sends Claude Code's CLAUDE.md
      // instead and 2.2.5 sends neither (both measured with a stand-in model, 2026-11-10).
      const path = join(root, 'AGENTS.md');
      const fallsBack = await readText(path) === undefined && await readText(join(home, '.claude/CLAUDE.md')) !== undefined;
      return { path, readers: 'OpenCode reads this in every session, in the CLI and the desktop app.',
        notes: fallsBack ? ['There is no AGENTS.md here yet, so OpenCode 1.x reads Claude Code’s CLAUDE.md instead (OpenCode 2.x reads neither). Once this file exists, OpenCode 1.x reads it and no longer that one.'] : [] };
    }
    case 'copilot-cli': {
      const notes: string[] = [];
      try { if ((await readdir(join(root, 'instructions'))).some(name => name.endsWith('.md'))) notes.push('Copilot CLI also reads the files in instructions/. Text repeated in both is read twice.'); } catch { /* none */ }
      notes.push('The Copilot app may not read it; that isn’t confirmed yet.');
      return { path: join(root, 'copilot-instructions.md'), readers: 'Copilot CLI reads this in every session.', notes };
    }
  }
}

/** A shelf's earlier versions, newest first, with their text. */
async function shelf(home: string, which: Shelf): Promise<{ id: string; text: string }[]> {
  try {
    const names = (await readdir(versionsFolder(home, which))).filter(name => name.endsWith('.md')).sort().reverse();
    return await Promise.all(names.map(async id => ({ id, text: (await readText(join(versionsFolder(home, which), id))) ?? '' })));
  } catch { return []; }
}

/** Each version says what it was: its date, first non-empty line, length and how far it is from `now`. */
const describe = (kept: { id: string; text: string }[], now: string) => kept.map(({ id, text }) => {
  const lines = linesOf(text);
  return { id, at: new Date(Number(id.split('-')[0])).toISOString(), firstLine: (lines.find(line => line.trim()) ?? '').trim().slice(0, 80), lines: lineCount(text), differs: lineDiff(text, now).filter(line => line.kind !== 'same').length };
});

/** Tool ids to hashes as read from base-tools.json: unknown tools and non-string values dropped. */
const toolHashes = (value: unknown): Partial<Record<HarnessId, string>> => Object.fromEntries(Object.entries(value ?? {}).filter(([tool, hash]) => harnessIds.includes(tool as HarnessId) && typeof hash === 'string'));
async function readBaseList(home: string): Promise<BaseList> {
  try {
    const list = JSON.parse(await readFile(baseListPath(home), 'utf8')) as Partial<BaseList>;
    return { tools: onlyAllowed(list.tools, harnessIds), written: toolHashes(list.written), leftPlain: toolHashes(list.leftPlain) };
  } catch { return { tools: [], written: {}, leftPlain: {} }; }
}
const writeBaseList = (home: string, list: BaseList) => writeDurably(baseListPath(home), `${JSON.stringify(list, null, 2)}\n`);

/** The base as stored: base.md as read (undefined: no file) and the list beside it. `recover`: first finish a base.md write a
 *  crash interrupted (only where writing is allowed), so a base moved aside is never read as empty. */
async function readBase(home: string, recover = false) {
  if (recover) await recoverParked(dirname(basePath(home)));
  const raw = await readText(basePath(home));
  return { raw, text: raw ?? '', list: await readBaseList(home) };
}
type StoredBase = Awaited<ReturnType<typeof readBase>>;

/** The base instructions, which tools get them, and earlier versions of the base. `drafters`: the tools that can write a draft of them here. */
export async function baseView(context: ShareContext, drafters: HarnessId[] = []): Promise<BaseView> {
  const base = await readBase(context.home);
  return { path: basePath(context.home), text: base.text, hash: hashOf(base.raw), tools: base.list.tools, versions: describe(await shelf(context.home, 'base'), base.text), drafters };
}

/** How a tool's file holds the base: the same, the copy Central Knot last wrote there (an older base), edited there, or not at
 *  all; and whether its whole text is the plain base text left there when the tool was taken off the list. */
function baseState(text: string, readers: HarnessId[], base: StoredBase): BaseHeld {
  // Records are kept for every reader of a file alike; a file is chosen when any of its readers is on the list.
  const [tool] = readers;
  const { own, copy } = splitBase(text);
  const state = copy === undefined ? 'missing' : sameBase(copy, base.text) ? 'same' : base.list.written[tool] === copyHash(copy) ? 'older' : 'edited';
  const chosen = readers.some(reader => base.list.tools.includes(reader)) && !!base.text.trim();
  return { chosen, state, own, copy, leftPlain: copy === undefined && !!text && base.list.leftPlain[tool] === sha256(text) };
}

/** A file's base part when the file is involved with the base: it gets it, holds a block (left by an Undo, or pasted in), or holds
 *  the plain base text left when its tool was taken off the list. Otherwise none. */
function baseIfInvolved(state: BaseHeld) {
  return state.chosen || state.copy !== undefined || state.leftPlain ? state : undefined;
}

/**
 * Each file of a tool Central Knot manages here (share.ts managedNow), bound: a tool not installed has no file and a folder is
 * never made for it, and a tool left out (its Manage switch off) has none here. `sameFile`: the other managed tools that read
 * the same physical file (linked dotfiles). `leftOutReads`: a tool left out that reads it too, through a link: such a file is
 * shown, never written (writable), since nothing is written in a tool left out.
 */
async function destinations(context: ShareContext, snapshots: Snapshot[]) {
  const managed = await managedNow(context, snapshots);
  const bound = await Promise.all(snapshots.filter(isPresent).map(async snapshot => ({ snapshot, ...await bind(snapshot.harness, snapshot.root, context.home) })));
  const landings = await Promise.all(bound.map(entry => landingOf(entry.path)));
  const readersWith = (index: number) => bound.filter((other, at) => at !== index && landings[at] && landings[at] === landings[index]).map(other => other.snapshot.harness);
  return bound.flatMap((entry, index) => (managed.includes(entry.snapshot.harness)
    ? [{ ...entry, sameFile: readersWith(index).filter(tool => managed.includes(tool)), leftOutReads: readersWith(index).find(tool => !managed.includes(tool)) }] : []));
}
type Destination = Awaited<ReturnType<typeof destinations>>[number];
/** The files a save may write: not one a tool left out reads too. */
const writable = (bound: Destination[]) => bound.filter(entry => !entry.leftOutReads);
/** Why a file a tool left out reads too is not written. */
const linkedOut = (path: string, tool: HarnessId) => `${basename(path)} is the same file as ${toolName(tool)} reads (a link), and ${toolName(tool)} is left out of Central Knot here`;

/** Every managed tool's instruction file, read as it is now. */
export async function instructionsView(context: ShareContext, snapshots: Snapshot[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  const base = await readBase(context.home, (await writeAccess(context)).allowed);
  for (const { snapshot, path, readers, notes, sameFile, leftOutReads } of await destinations(context, snapshots)) {
    if (sameFile.length) notes.push(`This is the same file as ${toolList(sameFile)} reads (a link), so they get the same base instructions.`);
    if (leftOutReads) notes.push(`This is the same file as ${toolName(leftOutReads)} reads (a link), and ${toolName(leftOutReads)} is left out of Central Knot here, so it can’t be saved from here.`);
    const text = await readText(path);
    // Lines starting with @ pull other files into Claude's context; those files are not shown or changed here.
    if (snapshot.harness === 'claude-cli' && text && /^@\S/m.test(text)) notes.push('Lines starting with @ import other files. Those files are not shown or changed here.');
    files.push({ tool: snapshot.harness, path, exists: text !== undefined, text: text ?? '', hash: hashOf(text), readers, notes, nextStep: 'Start a new session to use the change.',
      versions: describe(await shelf(context.home, snapshot.harness), text ?? ''), base: baseIfInvolved(baseState(text ?? '', readersOfFile(snapshot.harness, sameFile), base)), sameFile });
  }
  return files;
}

/** Saves one tool's file: only if it still holds what was opened, keeping the text it replaces first. `restoring`: an earlier
 *  version put back (or a save undone; a take-out passes false); when its base copy is a base text Central Knot kept, base-tools.json records it as that tool's copy, so it
 *  reads as an older base rather than an edit made there. */
export async function saveInstruction(context: ShareContext, snapshots: Snapshot[], tool: HarnessId, text: string, expected: string, restoring = false): Promise<InstructionSave> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  // Only a tool managed in this home: a save never recreates the folder of a tool that has gone, nor writes in one left out.
  const snapshot = snapshots.find(entry => entry.harness === tool);
  if (!snapshot || !isPresent(snapshot)) return { stopped: 'That tool is not in this home.' };
  if (!(await managedNow(context, snapshots)).includes(tool)) return { stopped: leftOutSentence(tool) };
  const { path } = await bind(tool, snapshot.root, context.home);
  const shared = (await destinations(context, snapshots)).find(entry => entry.snapshot.harness === tool)?.leftOutReads;
  if (shared) return { stopped: `${linkedOut(path, shared)}, so nothing was saved.` };
  const current = await readText(path);
  if (hashOf(current) !== expected) return { stopped: 'The file changed since you opened it, so nothing was saved. Read it again and redo the edit.' };
  if (current === text) return { saved: false };
  try { await keepAndWrite(context.home, tool, path, text, current); }
  catch (error) {
    return { stopped: changedMeanwhile(error) ? 'The file changed just now, so nothing was saved. Read it again and redo the edit.' : `${basename(path)} could not be saved: ${plainError(error)} Nothing was changed.` };
  }
  const copy = splitBase(text).copy;
  const problem = restoring && copy !== undefined ? await recordRestoredCopy(context, snapshots, tool, copy) : undefined;
  return { saved: true, problem };
}

/**
 * After an earlier version is put back: a base copy in it that is a base text Central Knot kept counts as one it wrote (an older
 * base); any other copy was edited by hand back then and stays protected as an edit. Returns a problem to say if the record
 * could not be saved.
 */
async function recordRestoredCopy(context: ShareContext, snapshots: Snapshot[], tool: HarnessId, copy: string): Promise<string | undefined> {
  const base = await readBase(context.home);
  const destination = (await destinations(context, snapshots)).find(entry => entry.snapshot.harness === tool);
  const readers = readersOfFile(tool, destination?.sameFile ?? []);
  if (!readers.some(reader => base.list.tools.includes(reader))) return undefined;
  const wrote = sameBase(copy, base.text) || (await shelf(context.home, 'base')).some(old => sameBase(copy, old.text));
  for (const reader of readers) { if (wrote) base.list.written[reader] = copyHash(copy); else delete base.list.written[reader]; }
  try { await writeBaseList(context.home, base.list); return undefined; }
  catch (error) { return `Central Knot could not note that its base copy is an older one (${plainError(error)}), so it may show as edited there.`; }
}

/** Keeps a file's text as an earlier version on its shelf. */
async function keep(home: string, shelf: Shelf, current: string) {
  const folder = versionsFolder(home, shelf);
  await mkdir(folder, { recursive: true });
  // Two writes in one millisecond (a base apply) still get their own names.
  for (let at = Date.now(); ; at++) {
    try { await writeFile(join(folder, `${at}-${sha256(current).slice(0, 12)}.md`), current, { flag: 'wx' }); return; }
    catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
  }
}
/** Keeps the text a write replaces as an earlier version, then writes only if the file still holds it. */
async function keepAndWrite(home: string, shelf: Shelf, path: string, text: string, current: string | undefined) {
  if (current !== undefined) await keep(home, shelf, current);
  await mkdir(dirname(path), { recursive: true });
  await writeFileChecked(path, text, current);
}

/** Writes base.md only if it still holds `seen` (what the caller checked; undefined: no file), else throws. The text it replaces
 *  is kept as an earlier version. Returns what base.md holds now (undefined: still no file). */
async function storeBaseText(home: string, text: string, seen: string | undefined): Promise<string | undefined> {
  if ((seen ?? '') === text) return seen;
  if (seen?.trim()) await keep(home, 'base', seen);
  await writeFileChecked(basePath(home), text, seen);
  return text;
}

/** A checked write refused because the file changed (or appeared) between being read and being written. */
const changedMeanwhile = (error: unknown) => ['CK_CHANGED', 'CK_OCCUPIED'].includes(errorCode(error));

/** A base.md write that failed: changed meanwhile (the review is shown again), or could not be written at all. */
const storeFailure = (error: unknown, ifChanged: BaseResult): BaseResult => (changedMeanwhile(error) ? ifChanged
  : { stopped: `The base instructions could not be saved: ${plainError(error)} Nothing was changed.`, written: [], left: [] });

/**
 * Sets the base instructions and which tools get them, then updates exactly the files the review showed (`request.seen`), each
 * only if it still holds what the review saw: its block is added or replaced, or taken out for a tool taken off the list. Each
 * tool's own text stays as it is, except where `own` gives a chosen tool's own text as a draft sorted it (draftbase.ts): that
 * replaces it. A copy edited in a tool's file is left alone unless `overwrite` names that tool; `adopt` names
 * the tool whose own text became the base, so it moves into the block. Tools reading one physical file (linked dotfiles) are one
 * destination: chosen together and written once. `changed` on a stop: the base or a file changed since the review, so the review
 * should be shown again.
 */
export async function applyBase(context: ShareContext, snapshots: Snapshot[], request: BaseApply): Promise<BaseResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, written: [], left: [] };
  const baseChanged = { stopped: 'The base instructions changed outside Central Knot since the review, so nothing was saved.', changed: true, written: [], left: [] };
  const stored = await readBase(context.home, true);
  if (hashOf(stored.raw) !== request.expected) return baseChanged;
  const all = await destinations(context, snapshots), bound = writable(all);
  // One physical file is chosen when any tool reading it is.
  const chosen = new Set(request.text.trim() ? bound.filter(entry => request.tools.includes(entry.snapshot.harness)).flatMap(entry => readersOfFile(entry.snapshot.harness, entry.sameFile)) : []);
  const files = await reviewedFiles(bound, request.seen);
  if ('changed' in files) return { stopped: `${basename(files.changed)} changed since the review, so nothing was saved.`, changed: true, written: [], left: [] };
  let baseNow: string | undefined;
  try { baseNow = await storeBaseText(context.home, request.text, stored.raw); } catch (error) { return storeFailure(error, baseChanged); }
  // A listed tool not found in this home right now (moved, reinstalling) stays on the list; only present tools are re-chosen.
  const absent = stored.list.tools.filter(tool => !bound.some(entry => entry.snapshot.harness === tool));
  const list: BaseList = { tools: [...absent, ...bound.map(entry => entry.snapshot.harness).filter(tool => chosen.has(tool))], written: { ...stored.list.written }, leftPlain: { ...stored.list.leftPlain } };
  const result: BaseResult = { written: [], left: [], undo: { text: stored.text, list: stored.list, baseHash: hashOf(baseNow), files: [] } };
  // A chosen tool whose file a tool left out reads too keeps it as it is.
  for (const entry of all) if (entry.leftOutReads && request.tools.includes(entry.snapshot.harness)) result.left.push({ tool: entry.snapshot.harness, why: 'left-out' });
  for (const { tool, readers, path, current } of files) {
    const text = current ?? '';
    const isChosen = chosen.has(tool);
    const held = baseState(text, readers, stored);
    const planned = fileWithBase(text, request.text, { chosen: isChosen, held, action: baseAction(readers, request), own: draftedOwn(readers, request.own) });
    if ('left' in planned) { result.left.push({ tool, why: 'edited' }); continue; }
    const { next } = planned;
    // Nothing to change, and a missing file is never created empty.
    const unchanged = current === undefined ? !next : next === current;
    if (!unchanged) {
      // A failed write keeps the tool's records, so a retry still knows what Central Knot wrote and left there.
      try { await keepAndWrite(context.home, tool, path, next, current); }
      catch (error) { result.left.push({ tool, why: changedMeanwhile(error) ? 'edited' : 'failed' }); continue; }
      result.written.push({ tool, path, before: current ?? null, afterHash: sha256(next) });
    }
    // Taken off with nothing of its own: the base stays in the file as plain text (never emptied), and that text is remembered.
    const leftAsPlain = !isChosen && !unchanged && !splitBase(text).own.trim();
    // Not chosen and untouched while it still holds plain base text left earlier (a re-add that failed): that record stays.
    if (!isChosen && unchanged && held.leftPlain) continue;
    recordHeld(list, readers, isChosen ? { copy: request.text } : { plain: leftAsPlain ? next : undefined });
  }
  result.undo!.files = result.written;
  // The files are written either way; a list that could not be saved is said, and Undo still puts the files back.
  try { await writeBaseList(context.home, list); }
  catch (error) { result.problem = `The list of tools that get the base could not be saved: ${plainError(error)} The files above were written.`; }
  return result;
}

/** The files a review showed, once per physical file, read now; or the first that is no longer what the review saw (another file
 *  bound, as when an override appeared, or other content). */
async function reviewedFiles(bound: Awaited<ReturnType<typeof destinations>>, seen: BaseApply['seen']) {
  const files: { tool: HarnessId; readers: HarnessId[]; path: string; current: string | undefined }[] = [];
  for (const { snapshot, path, sameFile } of bound.filter(entry => entry.snapshot.harness in seen)) {
    if (files.some(file => sameFile.includes(file.tool))) continue;
    const current = await readText(path);
    const reviewed = seen[snapshot.harness]!;
    if (path !== reviewed.path || hashOf(current) !== reviewed.hash) return { changed: path };
    files.push({ tool: snapshot.harness, readers: readersOfFile(snapshot.harness, sameFile), path, current });
  }
  return files;
}

/** Sets `list`'s records for these readers to what `from` holds for them (or none). */
function keepRecords(list: BaseList, from: BaseList, readers: HarnessId[]) {
  for (const reader of readers) {
    for (const records of ['written', 'leftPlain'] as const) {
      if (from[records][reader] === undefined) delete list[records][reader]; else list[records][reader] = from[records][reader];
    }
  }
}

/** Records what Central Knot now has in one physical file, for every tool reading it: the base copy it wrote there, or (taken off
 *  the list with nothing of its own) the plain base text it left, so adding the tool again moves that text back into the block.
 *  `{ plain: undefined }`: neither, so both records are cleared. */
function recordHeld(list: BaseList, readers: HarnessId[], held: { copy: string } | { plain: string | undefined }) {
  for (const reader of readers) {
    delete list.written[reader]; delete list.leftPlain[reader];
    if ('copy' in held) list.written[reader] = copyHash(held.copy);
    else if (held.plain !== undefined) list.leftPlain[reader] = sha256(held.plain);
  }
}

/**
 * Undo of an apply. It runs only while the base is still what that apply left. It puts the base and its list back as they were
 * (after the very first save, base.md stays as an empty file, which reads as no base), and each file the apply wrote, if not
 * changed since.
 */
export async function undoBase(context: ShareContext, snapshots: Snapshot[], undo: BaseUndo): Promise<BaseResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, written: [], left: [] };
  // The base edited since (in Central Knot or in base.md itself) stays: an Undo never overwrites newer work.
  const baseChanged = { stopped: 'The base instructions changed after that save, so nothing was undone. Earlier versions of the base and of each file are still kept.', written: [], left: [] };
  const { raw, list: now } = await readBase(context.home, true);
  if (hashOf(raw) !== undo.baseHash) return baseChanged;
  try { await storeBaseText(context.home, undo.text, raw); } catch (error) { return storeFailure(error, baseChanged); }
  const all = await destinations(context, snapshots), bound = writable(all);
  const result: BaseResult = { written: [], left: [] };
  for (const file of undo.files) {
    // A tool left out since keeps its file as it is: the undo says so.
    if (!bound.some(entry => entry.snapshot.harness === file.tool) && snapshots.some(entry => entry.harness === file.tool && isPresent(entry))) { result.left.push({ tool: file.tool, why: 'left-out' }); continue; }
    // The very file the save wrote, even if the tool now reads another (an override appeared since): that one is never touched.
    const snapshot = snapshots.find(entry => entry.harness === file.tool);
    const path = file.path;
    if (!snapshot || relative(snapshot.root, path).startsWith('..')) { result.left.push({ tool: file.tool, why: 'failed' }); continue; }
    const current = await readText(path);
    if (current === undefined || sha256(current) !== file.afterHash) { result.left.push({ tool: file.tool, why: 'edited' }); continue; }
    try {
      // A file this apply created goes again, exactly as it came: only while it still holds what was written.
      if (file.before === null) { await keep(context.home, file.tool, current); await removeFileChecked(path, current); }
      else await keepAndWrite(context.home, file.tool, path, file.before, current);
    } catch { result.left.push({ tool: file.tool, why: 'failed' }); continue; }
    result.written.push({ tool: file.tool, path, before: current, afterHash: file.before === null ? '' : sha256(file.before) });
  }
  // A file the undo left as it is keeps the records that describe it now, so its copy isn't taken for an edit made there.
  const list: BaseList = { tools: undo.list.tools, written: { ...undo.list.written }, leftPlain: { ...undo.list.leftPlain } };
  for (const { tool } of result.left) keepRecords(list, now, readersOfFile(tool, all.find(entry => entry.snapshot.harness === tool)?.sameFile ?? []));
  try { await writeBaseList(context.home, list); }
  catch (error) { result.problem = `The list of tools that get the base could not be put back: ${plainError(error)}`; }
  return result;
}

/** An earlier version's text, to load into the editor; putting it back is an ordinary checked save. */
export async function instructionVersion(context: ShareContext, tool: Shelf, id: string): Promise<string | undefined> {
  if (!/^\d+-[0-9a-f]{12}\.md$/.test(id)) return undefined;
  const path = join(versionsFolder(context.home, tool), id);
  try { await stat(path); } catch { return undefined; }
  return readText(path);
}

/**
 * The base as the git repo moves it (gitrepo.ts BaseInstructions): Push reads base.md; Pull sets it to the repo's text (none when
 * the repo removed it), and the tools that get the base get it too, as an apply from Instructions would, leaving a copy edited in
 * a tool's file as it is. What it replaces stays among the base's earlier versions. Says why, when nothing could be set; else
 * returns the apply's Undo.
 */
export function repoBase(context: ShareContext, snapshots: () => Promise<Snapshot[]>) {
  return {
    read: async () => (await readBase(context.home)).raw,
    apply: async (text: string | undefined) => {
      const tools = await snapshots();
      const [base, files] = await Promise.all([baseView(context), instructionsView(context, tools)]);
      const seen = Object.fromEntries(files.map(file => [file.tool, { path: file.path, hash: file.hash }]));
      const done = await applyBase(context, tools, { text: text ?? '', expected: base.hash, tools: base.tools, seen });
      return { stopped: done.stopped, undo: done.undo };
    },
  };
}

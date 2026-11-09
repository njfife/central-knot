// Instructions: each tool's own user-wide instruction file, viewed and edited in place (INS-01, INS-02).
// A save is a checked write of one file: it must still hold what the editor opened, the text it replaces is kept first, and every
// earlier version can be put back. Nothing here empties a file; the only deletion is an Undo removing a file its own base save
// created, while it still holds what was written. No project or workspace file is read or written.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { lineDiff } from './diff.ts';
import { errorCode, landingOf, plainError, recoverParked, removeFileChecked, storeDirectory, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { baseAction, blockText, fileWithBase, readersOfFile, sameBase, splitBase } from './basetext.ts';
import { andList, linesOf, toolNames } from './words.ts';
import { harnessIds } from './harnesses.ts';
import { onlyAllowed } from './values.ts';
import type { BaseApply, BaseHeld, BaseList, BaseResult, BaseUndo, BaseView, HarnessId, InstructionFile, InstructionSave, Snapshot } from './types.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const readText = (path: string) => readFile(path, 'utf8').then(text => text, () => undefined);
/** Where earlier versions are kept: one folder per tool, and one for the base instructions. */
type Shelf = HarnessId | 'base';
const versionsFolder = (home: string, shelf: Shelf) => join(storeDirectory(home), 'instructions', shelf);
/** The base instructions are one Markdown file in Central Knot's store; which tools get them is kept beside it. */
const basePath = (home: string) => join(storeDirectory(home), 'instructions', 'base.md');
const baseListPath = (home: string) => join(storeDirectory(home), 'instructions', 'base-tools.json');
/** The hash of a base copy as a block holds it, so a copy and the base text it came from compare equal. */
const copyHash = (copy: string) => sha(blockText(copy));
/** A file's hash for checks: '' when there is no file. */
const hashOf = (text: string | undefined) => (text === undefined ? '' : sha(text));

/** The file a tool actually reads, with what the editor must say about it (capability data §6). */
async function bind(tool: HarnessId, root: string): Promise<{ path: string; readers: string; notes: string[] }> {
  if (tool === 'claude-cli') {
    return { path: join(root, 'CLAUDE.md'), readers: 'Claude Code reads this in every session, in the CLI and the Code tab.', notes: [] };
  }
  if (tool === 'codex-cli') {
    // A non-empty AGENTS.override.md wins over AGENTS.md: the editor binds the file Codex really reads.
    const override = join(root, 'AGENTS.override.md');
    const text = await readText(override);
    if (text && text.trim()) return { path: override, readers: 'Codex reads this in every session, in the CLI and in ChatGPT desktop’s Codex, which share this folder.', notes: ['AGENTS.override.md is not empty, so Codex reads it instead of AGENTS.md. This edits the override.'] };
    return { path: join(root, 'AGENTS.md'), readers: 'Codex reads this in every session, in the CLI and in ChatGPT desktop’s Codex, which share this folder.', notes: [] };
  }
  if (tool === 'pi-cli') {
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
  const notes: string[] = [];
  try { if ((await readdir(join(root, 'instructions'))).some(name => name.endsWith('.md'))) notes.push('Copilot CLI also reads the files in instructions/. Text repeated in both is read twice.'); } catch { /* none */ }
  notes.push('The Copilot app may not read it; that isn’t confirmed yet.');
  return { path: join(root, 'copilot-instructions.md'), readers: 'Copilot CLI reads this in every session.', notes };
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
  return { id, at: new Date(Number(id.split('-')[0])).toISOString(), firstLine: (lines.find(line => line.trim()) ?? '').trim().slice(0, 80), lines: text ? lines.length : 0, differs: lineDiff(text, now).filter(line => line.kind !== 'same').length };
});

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

/** The base instructions, which tools get them, and earlier versions of the base. */
export async function baseView(context: ShareContext): Promise<BaseView> {
  const base = await readBase(context.home);
  return { path: basePath(context.home), text: base.text, hash: hashOf(base.raw), tools: base.list.tools, versions: describe(await shelf(context.home, 'base'), base.text) };
}

/** How a tool's file holds the base: the same, the copy Central Knot last wrote there (an older base), edited there, or not at
 *  all; and whether its whole text is the plain base text left there when the tool was taken off the list. */
function baseState(text: string, tool: HarnessId, base: StoredBase): BaseHeld {
  const { own, copy } = splitBase(text);
  const state = copy === undefined ? 'missing' : sameBase(copy, base.text) ? 'same' : base.list.written[tool] === copyHash(copy) ? 'older' : 'edited';
  return { chosen: base.list.tools.includes(tool) && !!base.text.trim(), state, own, copy, leftPlain: copy === undefined && !!text && base.list.leftPlain[tool] === sha(text) };
}

/** A file's base part when the file is involved with the base: it gets it, holds a block (left by an Undo, or pasted in), or holds
 *  the plain base text left when its tool was taken off the list. Otherwise none. */
function baseIfInvolved(state: BaseHeld) {
  return state.chosen || state.copy !== undefined || state.leftPlain ? state : undefined;
}

/** Tools found in this home: an absent tool has no file to edit, and a folder is never created for it here. */
const present = (snapshots: Snapshot[]) => snapshots.filter(entry => entry.detection !== 'Not found' || entry.skills.length > 0);

/** Each present tool's bound file and, for tools whose files are one physical file (linked dotfiles), the others reading it. */
async function destinations(snapshots: Snapshot[]) {
  const bound = await Promise.all(present(snapshots).map(async snapshot => ({ snapshot, ...await bind(snapshot.harness, snapshot.root) })));
  const landings = await Promise.all(bound.map(entry => landingOf(entry.path)));
  return bound.map((entry, index) => ({ ...entry, sameFile: bound.filter((other, at) => at !== index && landings[at] && landings[at] === landings[index]).map(other => other.snapshot.harness) }));
}

/** Every detected tool's instruction file, read as it is now. */
export async function instructionsView(context: ShareContext, snapshots: Snapshot[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  const base = await readBase(context.home, (await writeAccess(context)).allowed);
  for (const { snapshot, path, readers, notes, sameFile } of await destinations(snapshots)) {
    if (sameFile.length) notes.push(`This is the same file as ${andList(sameFile.map(tool => toolNames[tool]))} reads (a link), so they get the same base instructions.`);
    const text = await readText(path);
    // Lines starting with @ pull other files into Claude's context; those files are not shown or changed here.
    if (snapshot.harness === 'claude-cli' && text && /^@\S/m.test(text)) notes.push('Lines starting with @ import other files. Those files are not shown or changed here.');
    files.push({ tool: snapshot.harness, path, exists: text !== undefined, text: text ?? '', hash: hashOf(text), readers, notes, nextStep: 'Start a new session to use the change.',
      versions: describe(await shelf(context.home, snapshot.harness), text ?? ''), base: baseIfInvolved(baseState(text ?? '', snapshot.harness, base)), sameFile });
  }
  return files;
}

/** Saves one tool's file: only if it still holds what was opened, keeping the text it replaces first. `restoring`: an earlier
 *  version put back; when its base copy is a base text Central Knot kept, base-tools.json records it as that tool's copy, so it
 *  reads as an older base rather than an edit made there. */
export async function saveInstruction(context: ShareContext, snapshots: Snapshot[], tool: HarnessId, text: string, expected: string, restoring = false): Promise<InstructionSave> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  const snapshot = snapshots.find(entry => entry.harness === tool);
  if (!snapshot) return { stopped: 'That tool is not in this home.' };
  const { path } = await bind(tool, snapshot.root);
  const current = await readText(path);
  if (hashOf(current) !== expected) return { stopped: 'The file changed since you opened it, so nothing was saved. Read it again and redo the edit.' };
  if (current === text) return { saved: false };
  try { await keepAndWrite(context.home, tool, path, text, current); }
  catch { return { stopped: 'The file changed just now, so nothing was saved. Read it again and redo the edit.' }; }
  // An earlier version put back: a copy that is a base text Central Knot kept counts as one it wrote (an older base); any other
  // copy was edited by hand back then, and stays protected as an edit.
  const copy = splitBase(text).copy;
  if (restoring && copy !== undefined) {
    const base = await readBase(context.home);
    if (base.list.tools.includes(tool)) {
      const wrote = sameBase(copy, base.text) || (await shelf(context.home, 'base')).some(old => sameBase(copy, old.text));
      const destination = (await destinations(snapshots)).find(entry => entry.snapshot.harness === tool);
      for (const reader of readersOfFile(tool, destination?.sameFile ?? [])) {
        if (wrote) base.list.written[reader] = copyHash(copy); else delete base.list.written[reader];
      }
      try { await writeBaseList(context.home, base.list); }
      catch (error) { return { saved: true, problem: `Central Knot could not note that its base copy is an older one (${plainError(error)}), so it may show as edited there.` }; }
    }
  }
  return { saved: true };
}

/** Keeps a file's text as an earlier version on its shelf. */
async function keep(home: string, shelf: Shelf, current: string) {
  const folder = versionsFolder(home, shelf);
  await mkdir(folder, { recursive: true });
  // Two writes in one millisecond (a base apply) still get their own names.
  for (let at = Date.now(); ; at++) {
    try { await writeFile(join(folder, `${at}-${sha(current).slice(0, 12)}.md`), current, { flag: 'wx' }); return; }
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

/** A base.md write that failed: changed meanwhile (the review is shown again), or could not be written at all. */
const storeFailure = (error: unknown, changed: BaseResult): BaseResult => (['CK_CHANGED', 'CK_OCCUPIED'].includes(errorCode(error)) ? changed
  : { stopped: `The base instructions could not be saved: ${plainError(error)} Nothing was changed.`, written: [], left: [] });

/**
 * Sets the base instructions and which tools get them, then updates exactly the files the review showed (`request.seen`), each
 * only if it still holds what the review saw: its block is added or replaced, or taken out for a tool taken off the list. Each
 * tool's own text stays as it is. A copy edited in a tool's file is left alone unless `overwrite` names that tool; `adopt` names
 * the tool whose own text became the base, so it moves into the block. Tools reading one physical file (linked dotfiles) are one
 * destination: chosen together and written once. `changed` on a stop: the base or a file changed since the review, so the review
 * should be shown again.
 */
export async function applyBase(context: ShareContext, snapshots: Snapshot[], request: BaseApply): Promise<BaseResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, written: [], left: [] };
  const baseChanged = { stopped: 'The base instructions changed outside Central Knot since the review, so nothing was saved. Review again.', changed: true, written: [], left: [] };
  const stored = await readBase(context.home, true);
  if (hashOf(stored.raw) !== request.expected) return baseChanged;
  const bound = await destinations(snapshots);
  // One physical file is chosen when any tool reading it is.
  const chosen = new Set(request.text.trim() ? bound.filter(entry => request.tools.includes(entry.snapshot.harness)).flatMap(entry => readersOfFile(entry.snapshot.harness, entry.sameFile)) : []);
  const files = await reviewedFiles(bound, request.seen);
  if ('changed' in files) return { stopped: `${basename(files.changed)} changed since the review, so nothing was saved. Review again.`, changed: true, written: [], left: [] };
  let baseNow: string | undefined;
  try { baseNow = await storeBaseText(context.home, request.text, stored.raw); } catch (error) { return storeFailure(error, baseChanged); }
  // A listed tool not found in this home right now (moved, reinstalling) stays on the list; only present tools are re-chosen.
  const absent = stored.list.tools.filter(tool => !bound.some(entry => entry.snapshot.harness === tool));
  const list: BaseList = { tools: [...absent, ...bound.map(entry => entry.snapshot.harness).filter(tool => chosen.has(tool))], written: { ...stored.list.written }, leftPlain: { ...stored.list.leftPlain } };
  const result: BaseResult = { written: [], left: [], undo: { text: stored.text, list: stored.list, baseHash: hashOf(baseNow), files: [] } };
  for (const { tool, readers, path, current } of files) {
    const text = current ?? '';
    const isChosen = chosen.has(tool);
    const planned = fileWithBase(text, request.text, { chosen: isChosen, held: baseState(text, tool, stored), action: baseAction(readers, request) });
    if ('left' in planned) { result.left.push({ tool, why: 'edited' }); continue; }
    const { next } = planned;
    // Nothing to change, and a missing file is never created empty.
    const unchanged = current === undefined ? !next : next === current;
    if (!unchanged) {
      // A failed write keeps the tool's records, so a retry still knows what Central Knot wrote and left there.
      try { await keepAndWrite(context.home, tool, path, next, current); }
      catch { result.left.push({ tool, why: 'failed' }); continue; }
      result.written.push({ tool, path, before: current ?? null, afterHash: sha(next) });
    }
    recordHeld(list, readers, isChosen ? { copy: request.text } : { plain: !unchanged && !splitBase(text).own.trim() ? next : undefined });
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
 *  the list with nothing of its own) the plain base text it left, so adding the tool again moves that text back into the block. */
function recordHeld(list: BaseList, readers: HarnessId[], held: { copy: string } | { plain: string | undefined }) {
  for (const reader of readers) {
    delete list.written[reader]; delete list.leftPlain[reader];
    if ('copy' in held) list.written[reader] = copyHash(held.copy);
    else if (held.plain !== undefined) list.leftPlain[reader] = sha(held.plain);
  }
}

/** Undo of an apply: the base and its list as they were (after the very first save, base.md is left empty, which reads as no base) (only if the base is still as that apply left it), and each file it
 *  wrote back as it was, if not changed since. */
export async function undoBase(context: ShareContext, snapshots: Snapshot[], undo: BaseUndo): Promise<BaseResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, written: [], left: [] };
  // The base edited since (in Central Knot or in base.md itself) stays: an Undo never overwrites newer work.
  const baseChanged = { stopped: 'The base instructions changed after that save, so nothing was undone. Earlier versions of the base and of each file are still kept.', written: [], left: [] };
  await recoverParked(dirname(basePath(context.home)));
  const seenBase = await readText(basePath(context.home));
  if (hashOf(seenBase) !== undo.baseHash) return baseChanged;
  try { await storeBaseText(context.home, undo.text, seenBase); } catch (error) { return storeFailure(error, baseChanged); }
  const now = await readBaseList(context.home);
  const bound = await destinations(snapshots);
  const result: BaseResult = { written: [], left: [] };
  for (const file of undo.files) {
    // The very file the save wrote, even if the tool now reads another (an override appeared since): that one is never touched.
    const snapshot = snapshots.find(entry => entry.harness === file.tool);
    const path = file.path;
    if (!snapshot || relative(snapshot.root, path).startsWith('..')) { result.left.push({ tool: file.tool, why: 'failed' }); continue; }
    const current = await readText(path);
    if (current === undefined || sha(current) !== file.afterHash) { result.left.push({ tool: file.tool, why: 'edited' }); continue; }
    try {
      // A file this apply created goes again, exactly as it came: only while it still holds what was written.
      if (file.before === null) { await keep(context.home, file.tool, current); await removeFileChecked(path, current); }
      else await keepAndWrite(context.home, file.tool, path, file.before, current);
    } catch { result.left.push({ tool: file.tool, why: 'failed' }); continue; }
    result.written.push({ tool: file.tool, path, before: current, afterHash: file.before === null ? '' : sha(file.before) });
  }
  // A file the undo left as it is keeps the records that describe it now, so its copy isn't taken for an edit made there.
  const list: BaseList = { tools: undo.list.tools, written: { ...undo.list.written }, leftPlain: { ...undo.list.leftPlain } };
  for (const { tool } of result.left) keepRecords(list, now, readersOfFile(tool, bound.find(entry => entry.snapshot.harness === tool)?.sameFile ?? []));
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

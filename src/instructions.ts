// Instructions: each tool's own user-wide instruction file, viewed and edited in place (INS-01, INS-02).
// A save is a checked write of one file: it must still hold what the editor opened, the text it replaces is kept first, and every
// earlier version can be put back. Nothing here deletes or empties a file, and no project or workspace file is read or written.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { lineDiff } from './diff.ts';
import { removeFileChecked, storeDirectory, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { baseWrite, sameBase, splitBase } from './basetext.ts';
import { harnessIds } from './harnesses.ts';
import { onlyAllowed } from './values.ts';
import type { BaseApply, BaseResult, BaseUndo, BaseView, HarnessId, InstructionFile, InstructionSave, Snapshot } from './types.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const readText = (path: string) => readFile(path, 'utf8').then(text => text, () => undefined);
/** Where earlier versions are kept: one folder per tool, and one for the base instructions. */
type Shelf = HarnessId | 'base';
const versionsFolder = (home: string, shelf: Shelf) => join(storeDirectory(home), 'instructions', shelf);
/** The base instructions are one Markdown file in Central Knot's store; which tools get them is kept beside it. */
const basePath = (home: string) => join(storeDirectory(home), 'instructions', 'base.md');
const baseListPath = (home: string) => join(storeDirectory(home), 'instructions', 'base-tools.json');
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
    // Pi documents AGENTS.override.md (untested): bound when present. A new AGENTS.md beside CLAUDE.md shadows it (tested).
    const override = join(root, 'AGENTS.override.md');
    const text = await readText(override);
    const notes: string[] = [];
    if (text && text.trim()) notes.push('AGENTS.override.md is not empty, so it is the file bound here (documented for Pi, not yet tested).');
    if (await readText(join(root, 'CLAUDE.md')) !== undefined && await readText(join(root, 'AGENTS.md')) === undefined) notes.push('This folder has a CLAUDE.md. Creating AGENTS.md here makes Pi read AGENTS.md instead of it.');
    notes.push('SYSTEM.md and APPEND_SYSTEM.md, if present, replace or extend Pi’s built-in prompt; they are not shown or changed here.');
    return { path: text && text.trim() ? override : join(root, 'AGENTS.md'), readers: 'Pi reads this in every session.', notes };
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
  const lines = text.replace(/\n$/, '').split('\n');
  return { id, at: new Date(Number(id.split('-')[0])).toISOString(), firstLine: (lines.find(line => line.trim()) ?? '').trim().slice(0, 80), lines: text ? lines.length : 0, differs: lineDiff(text, now).filter(line => line.kind !== 'same').length };
});

/**
 * What Central Knot keeps beside base.md: which tools get the base, and, for each tool taken off the list whose file then held
 * nothing but the base, the hash of the plain text left there. Only that exact text counts as the base's own when the tool is
 * added again (it moves back into the block); anything else in a file is the tool's own.
 */
interface BaseList { tools: HarnessId[]; leftPlain: Partial<Record<HarnessId, string>> }
async function readBaseList(home: string): Promise<BaseList> {
  try {
    const list = JSON.parse(await readFile(baseListPath(home), 'utf8')) as Partial<BaseList>;
    const plain = Object.entries(list.leftPlain ?? {}).filter(([tool, hash]) => harnessIds.includes(tool as HarnessId) && typeof hash === 'string');
    return { tools: onlyAllowed(list.tools, harnessIds), leftPlain: Object.fromEntries(plain) };
  } catch { return { tools: [], leftPlain: {} }; }
}
const writeBaseList = (home: string, list: BaseList) => writeDurably(baseListPath(home), `${JSON.stringify(list, null, 2)}\n`);

/** The base as stored: base.md as read (undefined: no file), the list beside it, and every earlier base text. */
async function readBase(home: string) {
  const raw = await readText(basePath(home));
  return { raw, text: raw ?? '', list: await readBaseList(home), earlier: await shelf(home, 'base') };
}
type StoredBase = Awaited<ReturnType<typeof readBase>>;

/** The base instructions, which tools get them, and earlier versions of the base. */
export async function baseView(context: ShareContext): Promise<BaseView> {
  const base = await readBase(context.home);
  return viewOf(context.home, base);
}
const viewOf = (home: string, base: StoredBase): BaseView => ({ path: basePath(home), text: base.text, hash: sha(base.text), tools: base.list.tools, versions: describe(base.earlier, base.text) });

/** How a tool's file holds the base: the same, an older base, edited there, or not at all; and whether its whole text is the
 *  plain base text left there when the tool was taken off the list. */
function baseState(text: string, tool: HarnessId, base: StoredBase): NonNullable<InstructionFile['base']> {
  const { own, copy } = splitBase(text);
  const isABase = (part: string) => sameBase(part, base.text) || base.earlier.some(old => sameBase(part, old.text));
  const state = copy === undefined ? 'missing' : sameBase(copy, base.text) ? 'same' : isABase(copy) ? 'older' : 'edited';
  return { chosen: base.list.tools.includes(tool) && !!base.text.trim(), state, own, copy, leftPlain: copy === undefined && !!text && base.list.leftPlain[tool] === sha(text) };
}

/** A file's base part when the file is involved with the base: it gets it, holds a block (left by an Undo, or pasted in), or holds
 *  the plain base text left when its tool was taken off the list. Otherwise none. */
function baseIfInvolved(state: NonNullable<InstructionFile['base']>) {
  return state.chosen || state.copy !== undefined || state.leftPlain ? state : undefined;
}

/** Every detected tool's instruction file, read as it is now. */
export async function instructionsView(context: ShareContext, snapshots: Snapshot[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  const base = await readBase(context.home);
  // Only tools found in this home: an absent tool has no file to edit, and a folder is never created for it here.
  for (const snapshot of snapshots.filter(entry => entry.detection !== 'Not found' || entry.skills.length > 0)) {
    const { path, readers, notes } = await bind(snapshot.harness, snapshot.root);
    const text = await readText(path);
    // Lines starting with @ pull other files into Claude's context; those files are not shown or changed here.
    if (snapshot.harness === 'claude-cli' && text && /^@\S/m.test(text)) notes.push('Lines starting with @ import other files. Those files are not shown or changed here.');
    files.push({ tool: snapshot.harness, path, exists: text !== undefined, text: text ?? '', hash: hashOf(text), readers, notes, nextStep: 'Start a new session to use the change.',
      versions: describe(await shelf(context.home, snapshot.harness), text ?? ''), base: baseIfInvolved(baseState(text ?? '', snapshot.harness, base)) });
  }
  return files;
}

/** Saves one tool's file: only if it still holds what was opened, keeping the text it replaces first. */
export async function saveInstruction(context: ShareContext, snapshots: Snapshot[], tool: HarnessId, text: string, expected: string): Promise<InstructionSave> {
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
  return { saved: true };
}

/** Keeps a file's text as an earlier version on its shelf. */
async function keep(home: string, shelf: Shelf, current: string) {
  const folder = versionsFolder(home, shelf);
  await mkdir(folder, { recursive: true });
  // Two writes in one millisecond (a base apply) still get their own names.
  for (let at = Date.now(); ; at++) {
    try { await writeFile(join(folder, `${at}-${sha(current).slice(0, 12)}.md`), current, { flag: 'wx' }); return; }
    catch (error) { if ((error as { code?: string }).code !== 'EEXIST') throw error; }
  }
}
/** Keeps the text a write replaces as an earlier version, then writes only if the file still holds it. */
async function keepAndWrite(home: string, shelf: Shelf, path: string, text: string, current: string | undefined) {
  if (current !== undefined) await keep(home, shelf, current);
  await mkdir(dirname(path), { recursive: true });
  await writeFileChecked(path, text, current);
}

/** Writes base.md only if it still holds `seen` (what the caller checked; undefined: no file), else throws. The text it replaces
 *  is kept as an earlier version. */
async function storeBaseText(home: string, text: string, seen: string | undefined) {
  if ((seen ?? '') === text) return;
  if (seen?.trim()) await keep(home, 'base', seen);
  await writeFileChecked(basePath(home), text, seen);
}

/**
 * Sets the base instructions and which tools get them, then updates exactly the files the review showed (`request.seen`), each
 * only if it still holds what the review saw: its block is added or replaced, or taken out for a tool taken off the list. Each
 * tool's own text stays as it is. A copy edited in a tool's file is left alone unless `overwrite` names that tool; `adopt` names
 * the tool whose own text became the base, so it moves into the block. `changed` on a stop: the base or a file changed since the
 * review, so the review should be shown again.
 */
export async function applyBase(context: ShareContext, snapshots: Snapshot[], request: BaseApply): Promise<BaseResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, written: [], left: [] };
  const baseChanged = { stopped: 'The base instructions changed outside Central Knot since the review, so nothing was saved. Review again.', changed: true, written: [], left: [] };
  const stored = await readBase(context.home);
  if (sha(stored.text) !== request.expected) return baseChanged;
  const tools = request.text.trim() ? request.tools.filter(tool => snapshots.some(entry => entry.harness === tool)) : [];
  const files: { tool: HarnessId; path: string; current: string | undefined }[] = [];
  for (const snapshot of snapshots.filter(entry => entry.harness in request.seen)) {
    const { path } = await bind(snapshot.harness, snapshot.root);
    const current = await readText(path);
    if (hashOf(current) !== request.seen[snapshot.harness]) return { stopped: `${basename(path)} changed since the review, so nothing was saved. Review again.`, changed: true, written: [], left: [] };
    files.push({ tool: snapshot.harness, path, current });
  }
  try { await storeBaseText(context.home, request.text, stored.raw); } catch { return baseChanged; }
  const leftPlain: BaseList['leftPlain'] = Object.fromEntries(Object.entries(stored.list.leftPlain).filter(([tool]) => !tools.includes(tool as HarnessId)));
  const result: BaseResult = { written: [], left: [], undo: { text: stored.text, tools: stored.list.tools, leftPlain: stored.list.leftPlain, baseHash: sha(request.text), files: [] } };
  for (const { tool, path, current } of files) {
    const text = current ?? '';
    const action = request.adopt === tool ? 'adopt' : request.overwrite?.includes(tool) ? 'putBack' : 'save';
    const write = baseWrite(text, request.text, { chosen: tools.includes(tool), held: baseState(text, tool, stored), action });
    if (write.edited) { result.left.push({ tool, why: 'edited' }); continue; }
    const { next } = write;
    // Nothing to change, and a missing file is never created empty.
    if (current === undefined ? !next : next === current) continue;
    try { await keepAndWrite(context.home, tool, path, next, current); }
    catch { result.left.push({ tool, why: 'failed' }); continue; }
    result.written.push({ tool, before: current ?? null, after: sha(next) });
    // Taken off with nothing of its own: the base stays as plain text, remembered so adding the tool again doesn't repeat it.
    if (!tools.includes(tool) && !splitBase(text).own.trim()) leftPlain[tool] = sha(next);
  }
  await writeBaseList(context.home, { tools, leftPlain });
  result.undo!.files = result.written;
  return result;
}

/** Undo of an apply: the base and its list as they were (only if the base is still as that apply left it), and each file it
 *  wrote back as it was, if not changed since. */
export async function undoBase(context: ShareContext, snapshots: Snapshot[], undo: BaseUndo): Promise<BaseResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, written: [], left: [] };
  // The base edited since (in Central Knot or in base.md itself) stays: an Undo never overwrites newer work.
  const baseChanged = { stopped: 'The base instructions changed after that save, so nothing was undone. Earlier versions of the base and of each file are still kept.', written: [], left: [] };
  const seenBase = await readText(basePath(context.home));
  if (sha(seenBase ?? '') !== undo.baseHash) return baseChanged;
  try { await storeBaseText(context.home, undo.text, seenBase); } catch { return baseChanged; }
  await writeBaseList(context.home, { tools: undo.tools, leftPlain: undo.leftPlain });
  const result: BaseResult = { written: [], left: [] };
  for (const file of undo.files) {
    const snapshot = snapshots.find(entry => entry.harness === file.tool);
    if (!snapshot) { result.left.push({ tool: file.tool, why: 'failed' }); continue; }
    const { path } = await bind(file.tool, snapshot.root);
    const current = await readText(path);
    if (current === undefined || sha(current) !== file.after) { result.left.push({ tool: file.tool, why: 'edited' }); continue; }
    try {
      // A file this apply created goes again, exactly as it came: only while it still holds what was written.
      if (file.before === null) { await keep(context.home, file.tool, current); await removeFileChecked(path, current); }
      else await keepAndWrite(context.home, file.tool, path, file.before, current);
    } catch { result.left.push({ tool: file.tool, why: 'failed' }); continue; }
    result.written.push({ tool: file.tool, before: current, after: file.before === null ? '' : sha(file.before) });
  }
  return result;
}

/** An earlier version's text, to load into the editor; putting it back is an ordinary checked save. */
export async function instructionVersion(context: ShareContext, tool: Shelf, id: string): Promise<string | undefined> {
  if (!/^\d+-[0-9a-f]{12}\.md$/.test(id)) return undefined;
  const path = join(versionsFolder(context.home, tool), id);
  try { await stat(path); } catch { return undefined; }
  return readText(path);
}

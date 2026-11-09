// Instructions: each tool's own user-wide instruction file, viewed and edited in place (INS-01, INS-02).
// A save is a checked write of one file: it must still hold what the editor opened, the text it replaces is kept first, and every
// earlier version can be put back. Nothing here deletes or empties a file, and no project or workspace file is read or written.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lineDiff } from './diff.ts';
import { removeFileChecked, storeDirectory, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { baseWrite, sameBase, splitBase } from './basetext.ts';
import type { BaseApply, BaseResult, BaseUndo, BaseView, HarnessId, InstructionFile, InstructionSave, Snapshot } from './types.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const readText = (path: string) => readFile(path, 'utf8').then(text => text, () => undefined);
/** Where earlier versions are kept: one folder per tool, and one for the base instructions. */
type Shelf = HarnessId | 'base';
const versionsFolder = (home: string, shelf: Shelf) => join(storeDirectory(home), 'instructions', shelf);
/** The base instructions are one Markdown file in Central Knot's store; which tools get them is kept beside it. */
const basePath = (home: string) => join(storeDirectory(home), 'instructions', 'base.md');
const baseToolsPath = (home: string) => join(storeDirectory(home), 'instructions', 'base-tools.json');

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

async function versions(home: string, tool: Shelf, now = '') {
  try {
    const names = (await readdir(versionsFolder(home, tool))).filter(name => name.endsWith('.md')).sort().reverse();
    // Each version says what it was: its first non-empty line and its length, so several saves a day can be told apart.
    return await Promise.all(names.map(async name => {
      const text = (await readText(join(versionsFolder(home, tool), name))) ?? '';
      const lines = text.replace(/\n$/, '').split('\n');
      return { id: name, at: new Date(Number(name.split('-')[0])).toISOString(), firstLine: (lines.find(line => line.trim()) ?? '').trim().slice(0, 80), lines: text ? lines.length : 0, differs: lineDiff(text, now).filter(line => line.kind !== 'same').length };
    }));
  } catch { return []; }
}

async function readBaseTools(home: string): Promise<HarnessId[]> {
  try { const tools = JSON.parse(await readFile(baseToolsPath(home), 'utf8')); return Array.isArray(tools) ? tools.filter((tool): tool is HarnessId => typeof tool === 'string') : []; }
  catch { return []; }
}

/** The base instructions, which tools get them, and earlier versions of the base. */
export async function baseView(context: ShareContext): Promise<BaseView> {
  const text = (await readText(basePath(context.home))) ?? '';
  return { path: basePath(context.home), text, hash: sha(text), tools: await readBaseTools(context.home), versions: await versions(context.home, 'base', text) };
}

/** Earlier base texts, so a copy that only lags behind is told apart from one edited in the tool's file. */
async function earlierBases(home: string): Promise<string[]> {
  try { return await Promise.all((await readdir(versionsFolder(home, 'base'))).map(async name => (await readText(join(versionsFolder(home, 'base'), name))) ?? '')); }
  catch { return []; }
}

/** How a chosen tool's file holds the base: the same, an older base, edited there, or not at all. */
function baseState(text: string, base: string, earlier: string[]): NonNullable<InstructionFile['base']> {
  const { own, copy } = splitBase(text);
  const state = copy === undefined ? 'missing' : sameBase(copy, base) ? 'same' : earlier.some(old => sameBase(copy, old)) ? 'older' : 'edited';
  return { state, own, copy };
}

/** Every detected tool's instruction file, read as it is now. */
export async function instructionsView(context: ShareContext, snapshots: Snapshot[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  const base = await baseView(context);
  const earlier = base.tools.length ? await earlierBases(context.home) : [];
  // Only tools found in this home: an absent tool has no file to edit, and a folder is never created for it here.
  for (const snapshot of snapshots.filter(entry => entry.detection !== 'Not found' || entry.skills.length > 0)) {
    const { path, readers, notes } = await bind(snapshot.harness, snapshot.root);
    const text = await readText(path);
    // Lines starting with @ pull other files into Claude's context; those files are not shown or changed here.
    if (snapshot.harness === 'claude-cli' && text && /^@\S/m.test(text)) notes.push('Lines starting with @ import other files. Those files are not shown or changed here.');
    files.push({ tool: snapshot.harness, path, exists: text !== undefined, text: text ?? '', hash: text === undefined ? '' : sha(text), readers, notes, nextStep: 'Start a new session to use the change.', versions: await versions(context.home, snapshot.harness, text ?? ''),
      base: base.tools.includes(snapshot.harness) && base.text.trim() ? baseState(text ?? '', base.text, earlier) : undefined });
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
  if ((current === undefined ? '' : sha(current)) !== expected) return { stopped: 'The file changed since you opened it, so nothing was saved. Read it again and redo the edit.' };
  if (current === text) return { saved: false };
  try { await keepAndWrite(context.home, tool, path, text, current); }
  catch { return { stopped: 'The file changed just now, so nothing was saved. Read it again and redo the edit.' }; }
  return { saved: true };
}

/** Keeps the text a write replaces as an earlier version, then writes only if the file still holds it. */
async function keep(home: string, shelf: Shelf, current: string) {
  const folder = versionsFolder(home, shelf);
  await mkdir(folder, { recursive: true });
  // Two writes in one millisecond (a base apply) still get their own names.
  for (let at = Date.now(); ; at++) {
    try { await writeFile(join(folder, `${at}-${sha(current).slice(0, 12)}.md`), current, { flag: 'wx' }); return; }
    catch (error) { if ((error as { code?: string }).code !== 'EEXIST') throw error; }
  }
}
async function keepAndWrite(home: string, shelf: Shelf, path: string, text: string, current: string | undefined) {
  if (current !== undefined) await keep(home, shelf, current);
  await mkdir(dirname(path), { recursive: true });
  await writeFileChecked(path, text, current);
}

/** Stores the base and its tools; the base text it replaces is kept as an earlier version. */
async function storeBase(home: string, text: string, tools: HarnessId[]) {
  const current = (await readText(basePath(home))) ?? '';
  if (current !== text) {
    if (current.trim()) await keep(home, 'base', current);
    await writeDurably(basePath(home), text);
  }
  await writeDurably(baseToolsPath(home), `${JSON.stringify(tools)}\n`);
}

/**
 * Sets the base instructions and which tools get them, then brings each chosen tool's file up to date: its block is added or
 * replaced, and a tool taken off the list loses its block. Each tool's own text stays as it is. A copy edited in the tool's file
 * is left alone unless `overwrite` names that tool; `adopt` names the tool whose own text became the base, so it moves into the block.
 */
export async function applyBase(context: ShareContext, snapshots: Snapshot[], request: BaseApply): Promise<BaseResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, written: [], left: [] };
  const before = await baseView(context);
  if (before.hash !== request.expected) return { stopped: 'The base instructions changed since you opened them, so nothing was saved. Read them again and redo the edit.', written: [], left: [] };
  const tools = request.text.trim() ? request.tools.filter(tool => snapshots.some(entry => entry.harness === tool)) : [];
  const earlier = [before.text, ...await earlierBases(context.home)];
  await storeBase(context.home, request.text, tools);
  const result: BaseResult = { written: [], left: [], undo: { text: before.text, tools: before.tools, files: [] } };
  for (const snapshot of snapshots.filter(entry => tools.includes(entry.harness) || before.tools.includes(entry.harness))) {
    const tool = snapshot.harness;
    const { path } = await bind(tool, snapshot.root);
    const current = await readText(path);
    const text = current ?? '';
    const copy = splitBase(text).copy;
    const write = baseWrite(text, { base: request.text, chosen: tools.includes(tool), known: earlier.some(old => sameBase(copy, old)), adopt: request.adopt === tool, overwrite: request.overwrite?.includes(tool) });
    if (write.edited) { result.left.push({ tool, why: 'edited' }); continue; }
    const { next } = write;
    if (next === text && current !== undefined) continue;
    try { await keepAndWrite(context.home, tool, path, next, current); }
    catch { result.left.push({ tool, why: 'failed' }); continue; }
    result.written.push({ tool, before: current ?? null, after: sha(next) });
  }
  result.undo!.files = result.written;
  return result;
}

/** Undo of an apply: the base and its tools as they were, and each file it wrote back as it was, if not changed since. */
export async function undoBase(context: ShareContext, snapshots: Snapshot[], undo: BaseUndo): Promise<BaseResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, written: [], left: [] };
  await storeBase(context.home, undo.text, undo.tools);
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

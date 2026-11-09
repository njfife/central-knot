// Instructions: each tool's own user-wide instruction file, viewed and edited in place (INS-01, INS-02).
// A save is a checked write of one file: it must still hold what the editor opened, the text it replaces is kept first, and every
// earlier version can be put back. Nothing here deletes or empties a file, and no project or workspace file is read or written.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lineDiff } from './diff.ts';
import { sha256, storeDirectory, writeAccess, writeFileChecked, type ShareContext } from './share.ts';
import type { HarnessId, InstructionFile, InstructionSave, Snapshot } from './types.ts';

const readText = (path: string) => readFile(path, 'utf8').then(text => text, () => undefined);
const versionsFolder = (home: string, tool: HarnessId) => join(storeDirectory(home), 'instructions', tool);

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

async function versions(home: string, tool: HarnessId, now = '') {
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

/** Every detected tool's instruction file, read as it is now. */
export async function instructionsView(context: ShareContext, snapshots: Snapshot[]): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  // Only tools found in this home: an absent tool has no file to edit, and a folder is never created for it here.
  for (const snapshot of snapshots.filter(entry => entry.detection !== 'Not found' || entry.skills.length > 0)) {
    const { path, readers, notes } = await bind(snapshot.harness, snapshot.root);
    const text = await readText(path);
    // Lines starting with @ pull other files into Claude's context; those files are not shown or changed here.
    if (snapshot.harness === 'claude-cli' && text && /^@\S/m.test(text)) notes.push('Lines starting with @ import other files. Those files are not shown or changed here.');
    files.push({ tool: snapshot.harness, path, exists: text !== undefined, text: text ?? '', hash: text === undefined ? '' : sha256(text), readers, notes, nextStep: 'Start a new session to use the change.', versions: await versions(context.home, snapshot.harness, text ?? '') });
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
  if ((current === undefined ? '' : sha256(current)) !== expected) return { stopped: 'The file changed since you opened it, so nothing was saved. Read it again and redo the edit.' };
  if (current === text) return { saved: false };
  if (current !== undefined) {
    const folder = versionsFolder(context.home, tool);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${Date.now()}-${sha256(current).slice(0, 12)}.md`), current, { flag: 'wx' });
  }
  await mkdir(dirname(path), { recursive: true });
  try { await writeFileChecked(path, text, current); }
  catch { return { stopped: 'The file changed just now, so nothing was saved. Read it again and redo the edit.' }; }
  return { saved: true };
}

/** An earlier version's text, to load into the editor; putting it back is an ordinary checked save. */
export async function instructionVersion(context: ShareContext, tool: HarnessId, id: string): Promise<string | undefined> {
  if (!/^\d+-[0-9a-f]{12}\.md$/.test(id)) return undefined;
  const path = join(versionsFolder(context.home, tool), id);
  try { await stat(path); } catch { return undefined; }
  return readText(path);
}

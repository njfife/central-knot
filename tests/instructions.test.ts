import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { instructionsView, instructionVersion, saveInstruction } from '../src/instructions.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-ins-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const snapshots = () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness })));
  return { base, home, context, snapshots, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Each tool’s own instruction file is read, with its readers; Codex binds a non-empty override', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/CLAUDE.md'), 'Be brief.\n@notes.md\n');
    await writeFile(join(box.home, '.codex/AGENTS.md'), 'Base.\n');
    await writeFile(join(box.home, '.codex/AGENTS.override.md'), 'Override wins.\n');
    const files = await instructionsView(box.context, await box.snapshots());
    const claude = files.find(file => file.tool === 'claude-cli')!;
    assert.equal(claude.text, 'Be brief.\n@notes.md\n');
    assert.ok(claude.notes.some(note => /@ import/.test(note)));
    assert.match(files.find(file => file.tool === 'codex-cli')!.path, /AGENTS\.override\.md$/);
    const copilot = files.find(file => file.tool === 'copilot-cli')!;
    assert.equal(copilot.exists, false);
    assert.match(copilot.path, /copilot-instructions\.md$/);
  } finally { await box.cleanup(); }
});

test('A save writes only over what was opened, keeps the replaced text, and an earlier version can be loaded back', async () => {
  const box = await sandbox();
  try {
    const path = join(box.home, '.claude/CLAUDE.md');
    await writeFile(path, 'First.\n');
    const [opened] = (await instructionsView(box.context, await box.snapshots())).filter(file => file.tool === 'claude-cli');
    assert.equal((await saveInstruction(box.context, await box.snapshots(), 'claude-cli', 'Second.\n', opened.hash)).saved, true);
    assert.equal(await readFile(path, 'utf8'), 'Second.\n');
    // A stale editor (opened before that save) writes nothing.
    assert.match((await saveInstruction(box.context, await box.snapshots(), 'claude-cli', 'Third.\n', opened.hash)).stopped ?? '', /changed since you opened it/);
    assert.equal(await readFile(path, 'utf8'), 'Second.\n');
    const [now] = (await instructionsView(box.context, await box.snapshots())).filter(file => file.tool === 'claude-cli');
    assert.equal(now.versions.length, 1);
    assert.equal(await instructionVersion(box.context, 'claude-cli', now.versions[0].id), 'First.\n');
    assert.equal(await instructionVersion(box.context, 'claude-cli', '../../etc/passwd'), undefined, 'only kept version names');
  } finally { await box.cleanup(); }
});

test('Saving a missing file creates it; saving the same text writes nothing', async () => {
  const box = await sandbox();
  try {
    assert.equal((await saveInstruction(box.context, await box.snapshots(), 'copilot-cli', 'Hello.\n', '')).saved, true);
    assert.equal(await readFile(join(box.home, '.copilot/copilot-instructions.md'), 'utf8'), 'Hello.\n');
    const [file] = (await instructionsView(box.context, await box.snapshots())).filter(entry => entry.tool === 'copilot-cli');
    assert.equal((await saveInstruction(box.context, await box.snapshots(), 'copilot-cli', 'Hello.\n', file.hash)).saved, false);
    assert.equal(file.versions.length, 0, 'creating a file keeps no empty version');
  } finally { await box.cleanup(); }
});

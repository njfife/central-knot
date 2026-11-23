// Antigravity as a tool: what Central Knot finds of it and reads and writes for it. The forms here are the ones measured on its
// CLI 1.5.14 in throwaway homes (the pull request that added it says what was seen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { executableCandidates } from '../src/platform.ts';
import { presentTools } from '../src/presence.ts';
import type { ShareContext } from '../src/share.ts';
import { skillsView } from '../src/skills.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'antigravity-cli'];
const CONFIG = '.gemini/config';
const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

/** A home with Claude Code's folder and Antigravity's, read as a chosen folder is (no probes). */
async function sandbox(present: HarnessId[] = tools) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-antigravity-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', CONFIG]) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: () => Promise.all(present.map(harness => discover({ home, mode: 'custom', harness }))), build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
async function skill(home: string, root: string, folder: string, content = text(folder)) {
  await mkdir(join(home, root, folder), { recursive: true });
  await writeFile(join(home, root, folder, 'SKILL.md'), content);
}
/** A stand-in CLI in the home's ~/.local/bin that answers --version. */
async function cli(home: string, name: string) {
  await mkdir(join(home, '.local/bin'), { recursive: true });
  await writeFile(join(home, '.local/bin', name), '#!/bin/sh\necho 1.5.14\n');
  await chmod(join(home, '.local/bin', name), 0o755);
}

test('A home with agy and a skill in ~/.gemini/config/skills has Antigravity, and that skill’s row has an Antigravity copy', async () => {
  const box = await sandbox();
  try {
    await cli(box.home, 'agy');
    await skill(box.home, `${CONFIG}/skills`, 'alpha');
    const snapshot = await discover({ home: box.home, mode: 'actual', harness: 'antigravity-cli', runProbes: true, binaries: executableCandidates(box.home, '', 'agy') });
    assert.deepEqual([snapshot.harnessName, snapshot.detection, snapshot.probe.version], ['Antigravity', 'Installed', '1.5.14']);
    assert.deepEqual(presentTools([snapshot]), ['antigravity-cli']);
    assert.deepEqual(snapshot.skills.map(found => `${found.folder}: ${found.rootLabel}`), ['alpha: Antigravity skills']);
    const row = (await skillsView(box.context, tools)).items.find(item => item.key === 'alpha')!;
    assert.deepEqual(Object.keys(row.copies), ['antigravity-cli']);
  } finally { await box.cleanup(); }
});

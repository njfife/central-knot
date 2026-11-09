import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { harnessIds } from '../src/harnesses.ts';
import { applyChanges, manageView } from '../src/manage.ts';
import { missingTools, presentTools } from '../src/presence.ts';
import type { ShareContext } from '../src/share.ts';

const text = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`;
const exists = (path: string) => lstat(path).then(() => true, () => false);

/** A throwaway home with the given skills (`folder` relative to home → skill names), read by every tool through discover(). */
async function home(skills: Record<string, string[]>, folders: string[] = []) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-present-')));
  const path = join(base, 'home');
  for (const folder of folders) await mkdir(join(path, folder), { recursive: true });
  for (const [root, names] of Object.entries(skills)) for (const name of names) {
    await mkdir(join(path, root, name), { recursive: true });
    await writeFile(join(path, root, name, 'SKILL.md'), text(name));
  }
  const read = () => Promise.all(harnessIds.map(harness => discover({ home: path, mode: 'custom', harness })));
  const context: ShareContext = { home: path, mode: 'custom', read, build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  return { path, read, context, cleanup: () => { execFileSync('chmod', ['-R', 'u+rwx', base]); return rm(base, { recursive: true, force: true }); } };
}

test('a tool is present when its own folder exists; the others are missing', async () => {
  // Claude Code has a skill; Codex has only its (empty) configuration folder; Copilot CLI and Pi have nothing.
  const box = await home({ '.claude/skills': ['brief'] }, ['.codex']);
  try {
    const snapshots = await box.read();
    assert.deepEqual(presentTools(snapshots), ['claude-cli', 'codex-cli']);
    assert.deepEqual(missingTools(snapshots), ['copilot-cli', 'pi-cli']);
  } finally { await box.cleanup(); }
});

test('skills in the shared .agents folder make no tool present, and the home simply has nothing to manage', async () => {
  const box = await home({ '.agents/skills': ['shared-only'] });
  try {
    const snapshots = await box.read();
    // Copilot CLI, Codex and Pi all read ~/.agents/skills, yet none of them is installed or has a folder here.
    assert.ok(snapshots.some(snapshot => snapshot.skills.length > 0));
    assert.deepEqual(presentTools(snapshots), []);
    const view = await manageView(box.context);
    assert.deepEqual([view.tools, view.skills.length], [[], 0]);
  } finally { await box.cleanup(); }
});

test('Apply writes only to present tools, never creating a folder for a missing one', async () => {
  const box = await home({ '.claude/skills': ['brief'], '.agents/skills': ['shared'] }, ['.codex']);
  try {
    const result = await applyChanges(box.context, [{ key: 'brief', managed: true, off: [] }]);
    assert.equal(result.stopped, undefined);
    assert.ok(await exists(join(box.path, '.codex/skills/brief/SKILL.md')));
    assert.deepEqual([await exists(join(box.path, '.copilot')), await exists(join(box.path, '.pi'))], [false, false]);
    assert.equal(await exists(join(box.path, '.agents/skills/brief')), false);
  } finally { await box.cleanup(); }
});

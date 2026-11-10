import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { claudeMemory, codexMemory, memoryView, projectLabel } from '../src/memory.ts';
import type { HarnessId } from '../src/types.ts';

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-memory-')));
  const home = join(base, 'home');
  await mkdir(home, { recursive: true });
  // Written with a time, so "newest" is decided by the test, not by the order of the writes.
  const put = async (path: string, text: string, day = 1) => {
    const full = join(home, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, text);
    const at = new Date(Date.UTC(2026, 10, day));
    await utimes(full, at, at);
  };
  const encoded = home.replace(/[^A-Za-z0-9]/g, '-');
  return { base, home, encoded, put, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const note = (fields: string, body: string) => `---\n${fields}\n---\n${body}`;

test('Claude Code memory: titles from the index, nested or top-level kind, plain files, the index last, newest project first', async () => {
  const box = await sandbox();
  try {
    const app = `.claude/projects/${box.encoded}-code-app/memory`;
    await box.put(`${app}/small_prs.md`, note('name: small-prs\ndescription: Prefers small PRs\nmetadata:\n  type: feedback\n  modified: 2020-01-01', '\nKeep PRs small.\n'), 3);
    await box.put(`${app}/stack.md`, note('name: stack\ndescription: The stack\ntype: project', 'TypeScript and Electron.\n'), 9);
    await box.put(`${app}/who.md`, note('name: who-i-am\ndescription: About me\nmetadata:\n  type: user', 'A builder.\n'), 2);
    await box.put(`${app}/loose.md`, '\n# Loose notes\nSecond line.\n', 5);
    await box.put(`${app}/empty.md`, '  \n', 10);
    await box.put(`${app}/notes.txt`, 'not memory', 11);
    await box.put(`${app}/MEMORY.md`, '- [Small pull requests](small_prs.md) — size\n- [The stack](./stack.md) — tools\n', 4);
    // A project with only its index, outside the home: shown, named whole without its leading dashes.
    await box.put('.claude/projects/-srv-tmp-scratch/memory/MEMORY.md', '# Notes kept here\n', 12);
    // A folder with nothing in it but an empty file is not shown.
    await box.put('.claude/projects/-elsewhere/memory/blank.md', '', 20);
    const projects = await claudeMemory(join(box.home, '.claude'), box.home);
    assert.deepEqual(projects.map(project => project.label), ['srv-tmp-scratch', 'code-app']);
    const [scratch, app_] = projects;
    assert.deepEqual(scratch.notes.map(entry => [entry.title, entry.index]), [['Memory index, srv-tmp-scratch', true]]);
    assert.equal(app_.newest, new Date(Date.UTC(2026, 10, 9)).toISOString());
    // About you or how you like to work first (newest first), then the rest (newest first), the index last.
    assert.deepEqual(app_.notes.map(entry => entry.file), ['small_prs.md', 'who.md', 'stack.md', 'loose.md', 'MEMORY.md']);
    const [small, who, stack, loose, index] = app_.notes;
    assert.deepEqual([small.title, small.kind, small.description, small.text], ['Small pull requests', 'feedback', 'Prefers small PRs', '\nKeep PRs small.\n']);
    assert.equal(small.at, new Date(Date.UTC(2026, 10, 3)).toISOString(), 'the file’s time, never its modified field');
    assert.equal(small.origin, 'Claude Code\'s memory (project code-app, file small_prs.md)');
    assert.match(small.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual([who.title, who.kind], ['who-i-am', 'user'], 'no index line: the frontmatter name');
    assert.deepEqual([stack.title, stack.kind], ['The stack', 'project']);
    assert.deepEqual([loose.title, loose.kind, loose.description, loose.text], ['loose', undefined, 'Loose notes', '\n# Loose notes\nSecond line.\n']);
    assert.equal(index.title, 'Memory index, code-app');
  } finally { await box.cleanup(); }
});

test('Project labels drop the encoded home and leading dashes; another prefix keeps the whole name', () => {
  assert.equal(projectLabel('-home-picoder--t3-projects-central-knot', '/home/picoder'), 't3-projects-central-knot');
  assert.equal(projectLabel('-Users-n-code-app', '/Users/n'), 'code-app');
  assert.equal(projectLabel('-Users-n', '/Users/n'), '~');
  assert.equal(projectLabel('-Users-nina-app', '/Users/n'), 'Users-nina-app', 'a longer user name is not the home');
  assert.equal(projectLabel('-tmp-work', '/home/picoder'), 'tmp-work');
  assert.equal(projectLabel('C--Users-x-app', 'C:\\Users\\x'), 'app');
});

test('A memory file that cannot be read is listed as unreadable; unreadable frontmatter reads as plain text', async () => {
  const box = await sandbox();
  try {
    const folder = `.claude/projects/${box.encoded}-app/memory`;
    await mkdir(join(box.home, folder, 'x.md'), { recursive: true });
    await box.put(`${folder}/broken.md`, '---\nname: [unclosed\n---\nBody.\n');
    const [project] = await claudeMemory(join(box.home, '.claude'), box.home);
    const byFile = new Map(project.notes.map(entry => [entry.file, entry]));
    assert.equal(byFile.get('x.md')?.unreadable, true);
    assert.equal(byFile.get('x.md')?.title, 'x');
    assert.deepEqual([byFile.get('broken.md')?.title, byFile.get('broken.md')?.text], ['broken', '---\nname: [unclosed\n---\nBody.\n']);
  } finally { await box.cleanup(); }
});

test('The view reads only tools in this home: none installed reads nothing', async () => {
  const box = await sandbox();
  try {
    const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'];
    const snapshots = () => Promise.all(tools.map(harness => discover({ home: box.home, mode: 'custom', harness })));
    assert.deepEqual(await memoryView(box.home, await snapshots()), { copilot: false });
    await box.put(`.claude/projects/${box.encoded}-app/memory/a.md`, 'Remember this.\n');
    await box.put('.codex/config.toml', '[features]\nmemories = true\n');
    await box.put('.codex/memories/memory_summary.md', 'Summary.\n', 7);
    await mkdir(join(box.home, '.copilot'));
    const view = await memoryView(box.home, await snapshots());
    assert.equal(view.claude?.[0].notes[0].text, 'Remember this.\n');
    assert.deepEqual(view.codex, { folder: join(box.home, '.codex/memories'), on: true, summary: { path: join(box.home, '.codex/memories/memory_summary.md'), text: 'Summary.\n', at: new Date(Date.UTC(2026, 10, 7)).toISOString() } });
    assert.equal(view.copilot, true);
  } finally { await box.cleanup(); }
});

test('Codex’s memory folder and switch follow Codex’s own rule', async t => {
  const cases: { name: string; config?: string; folders?: string[]; folder: string; on: boolean }[] = [
    { name: 'version v1', config: '[memories]\nversion = "v1"\n[features]\nmemories = true\n', folders: ['memories_v2'], folder: 'memories', on: true },
    { name: 'version v2', config: '[memories]\nversion = "v2"\n[features]\nmemories = true\n', folders: ['memories'], folder: 'memories_v2', on: true },
    { name: 'unset, memories/ present', config: 'features.memories = true\n', folders: ['memories'], folder: 'memories', on: true },
    { name: 'unset, memories/ absent', config: '[features]\nmemories = true\n', folder: 'memories_v2', on: true },
    { name: 'dual_write false, memories/ absent', config: 'memories = { dual_write = false }\n[features]\nmemories = true\n', folder: 'memories', on: true },
    { name: 'feature off', config: '[features]\nmemories = false\n', folder: 'memories_v2', on: false },
    { name: 'config missing', folder: 'memories_v2', on: false },
    { name: 'config unreadable', config: '[features\nmemories = true\n', folders: ['memories'], folder: 'memories', on: false },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const box = await sandbox();
      try {
        const codex = join(box.home, '.codex');
        await mkdir(codex, { recursive: true });
        if (entry.config !== undefined) await writeFile(join(codex, 'config.toml'), entry.config);
        for (const folder of entry.folders ?? []) await mkdir(join(codex, folder));
        const memory = await codexMemory(codex);
        assert.deepEqual([memory.folder, memory.on, memory.summary], [join(codex, entry.folder), entry.on, undefined]);
      } finally { await box.cleanup(); }
    });
  }
  await t.test('both folders, v2’s summary newer: still memories/', async () => {
    const box = await sandbox();
    try {
      await box.put('.codex/config.toml', '[features]\nmemories = true\n');
      await box.put('.codex/memories/memory_summary.md', 'Old.\n', 1);
      await box.put('.codex/memories_v2/memory_summary.md', 'Newer.\n', 9);
      const memory = await codexMemory(join(box.home, '.codex'));
      assert.deepEqual([memory.folder, memory.summary?.text], [join(box.home, '.codex/memories'), 'Old.\n']);
    } finally { await box.cleanup(); }
  });
  await t.test('config that cannot be opened counts as off', { skip: process.getuid?.() === 0 }, async () => {
    const box = await sandbox();
    try {
      await box.put('.codex/config.toml', '[features]\nmemories = true\n');
      await chmod(join(box.home, '.codex/config.toml'), 0o000);
      assert.equal((await codexMemory(join(box.home, '.codex'))).on, false);
    } finally { await box.cleanup(); }
  });
});

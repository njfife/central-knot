import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copilotProblem, discover, parseSkill } from '../src/discovery.ts';
import { execFileSync } from 'node:child_process';
import type { HarnessId } from '../src/types.ts';

const both: HarnessId[] = ['claude-cli', 'copilot-cli'];
const CLAUDE = '.claude/skills', COPILOT = '.copilot/skills', AGENTS = '.agents/skills';
const noPosix = process.platform === 'win32';

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-share-')));
  const home = join(base, 'home');
  await mkdir(home);
  return { base, home, settingsPath: join(base, 'settings', 'settings.json'), realHome: join(base, 'real-home'), cleanup: () => { execFileSync('chmod', ['-R', 'u+rwx', base]); return rm(base, { recursive: true, force: true }); } };
}

const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: A ${name} skill.\n---\n\n${body}\n`;

async function skill(home: string, root: string, folder: string, content = text(folder)) {
  const directory = join(home, root, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), content);
  return directory;
}



/** Every path, type, mode, mtime and content hash under a directory. */
async function tree(directory: string, skip: string[] = []): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (skip.includes(entry.name)) continue;
      const path = join(current, entry.name);
      const info = await lstat(path);
      if (entry.isSymbolicLink()) out[path] = `link:${await readlink(path)}`;
      else if (entry.isDirectory()) { out[path] = `dir:${info.mode}`; await visit(path); }
      else out[path] = `file:${info.mode}:${info.mtimeMs}:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
    }
  }
  await visit(directory);
  return out;
}

test('1b.1: the Copilot reader finds its own and shared .agents skills, and no project ones', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, COPILOT, 'own');
    await skill(box.home, AGENTS, 'shared-root');
    await skill(join(box.home, 'project'), '.github/skills', 'project-only');
    const before = await tree(box.home);
    const snapshot = await discover({ home: box.home, mode: 'custom', harness: 'copilot-cli' });
    assert.deepEqual(snapshot.skills.map(item => item.folder), ['own', 'shared-root']);
    assert.equal(snapshot.detection, 'Config found but app not detected');
    assert.deepEqual(snapshot.skills.map(item => item.rootLabel), ['Copilot skills', 'Shared .agents skills']);
    assert.deepEqual(await tree(box.home), before);
  } finally { await box.cleanup(); }
});

test('SKL-02: Copilot CLI refusals measured on 1.0.107 are skipped by name, and what it loads is not', () => {
  const named = (name: string, description = 'x') => `---\nname: ${name}\ndescription: ${description}\n---\nb\n`;
  for (const name of ['ok-name', 'a.b', 'a_b', 'a:b', 'a b', 'ABC', '1abc', 'a'.repeat(64)]) assert.equal(copilotProblem(named(name.includes(':') ? `"${name}"` : name), 'f'), undefined, name);
  for (const name of ['名前', 'café', '"a/b"', '"100%done"', '_lead', '.lead', '-dash', 'a'.repeat(65), '123', 'true']) assert.ok(copilotProblem(named(name), 'f'), name);
  assert.ok(copilotProblem(named('ok', 'd'.repeat(1025)), 'f'));
  assert.equal(copilotProblem(named('ok', 'd'.repeat(1024)), 'f'), undefined);
  assert.ok(copilotProblem('---\ndescription: x\n---\nb\n', '名前'), 'no name uses the folder');
  for (const text of ['\uFEFF---\nname: bom\ndescription: x\n---\nb\n', '--- \nname: trail\ndescription: x\n---\nb\n', '---\r\nname: crlf\r\ndescription: x\r\n---\r\nb\r\n', '---\n---\nb\n']) {
    assert.equal(parseSkill(text, 'folder').hasFrontmatter, true, JSON.stringify(text));
    assert.equal(copilotProblem(text, 'folder'), undefined, JSON.stringify(text));
  }
});

test('A SKILL.md linked to a pipe is reported and never read', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'good');
    const piped = join(box.home, CLAUDE, 'piped');
    await mkdir(piped);
    execFileSync('mkfifo', [join(box.base, 'pipe')]);
    await symlink(join(box.base, 'pipe'), join(piped, 'SKILL.md'));
    const snapshot = await discover({ home: box.home, mode: 'custom' });
    assert.deepEqual(snapshot.skills.map(item => item.folder), ['good']);
    assert.ok(snapshot.issues.some(issue => issue.includes('not a regular file')));
  } finally { await box.cleanup(); }
});

test('SKL-02: empty or non-text metadata Copilot CLI refuses is skipped', () => {
  for (const line of ['description: 123', 'description: [a]', 'description:', 'name:', 'name: 12']) {
    const text_ = line.startsWith('name') ? `---\n${line}\ndescription: x\n---\nb\n` : `---\nname: ok\n${line}\n---\nb\n`;
    assert.ok(copilotProblem(text_, 'folder'), line);
  }
});


// ---------- Codex (measured on codex-cli 0.142.3 through `codex app-server` skills/list) ----------

test('Codex reads its own folder and the shared .agents folder, and leaves its .system skills alone', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-codex-')));
  try {
    const write = async (path: string, text: string) => { await mkdir(join(base, path), { recursive: true }); await writeFile(join(base, path, 'SKILL.md'), text); };
    await write('.codex/skills/own', '---\nname: own\ndescription: Own.\n---\nB\n');
    await write('.codex/skills/.system/imagegen', '---\nname: imagegen\ndescription: System.\n---\nB\n');
    await write('.codex/skills/.dot', '---\nname: dot\ndescription: Dot.\n---\nB\n');
    await write('.agents/skills/shared', '---\nname: shared\ndescription: Shared.\n---\nB\n');
    const snapshot = await discover({ home: base, mode: 'custom', harness: 'codex-cli' });
    assert.deepEqual(snapshot.skills.map(skill => `${skill.folder}:${skill.rootLabel}`), ['own:Codex skills', 'shared:Shared .agents skills']);
    assert.equal(snapshot.detection, 'Config found but app not detected');
    await write('elsewhere/skills/relocated', '---\nname: relocated\ndescription: Relocated.\n---\nB\n');
    const moved = await discover({ home: base, mode: 'custom', harness: 'codex-cli', configOverride: join(base, 'elsewhere') });
    assert.deepEqual(moved.skills.map(skill => skill.folder), ['relocated', 'shared'], 'CODEX_HOME moves its own folder, not .agents');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('Codex load rules: frontmatter and a description are required, a name is at most 64 characters', async () => {
  const { codexProblem } = await import('../src/discovery.ts');
  assert.equal(codexProblem('---\nname: ok\ndescription: Fine.\n---\nB\n', 'ok'), undefined);
  assert.equal(codexProblem('---\ndescription: No name, folder used.\n---\nB\n', 'no-name'), undefined);
  assert.equal(codexProblem('---\nname: Has Space 日本\ndescription: Codex takes any text name.\n---\nB\n', 'x'), undefined);
  assert.equal(codexProblem(`---\nname: d\ndescription: ${'d'.repeat(1100)}\n---\nB\n`, 'd'), undefined, 'a long description loads');
  assert.match(codexProblem('Just text.\n', 'plain') ?? '', /frontmatter/);
  assert.match(codexProblem('---\nname: n\n---\nB\n', 'n') ?? '', /description/);
  assert.match(codexProblem('---\nname: n\ndescription: ""\n---\nB\n', 'n') ?? '', /description/);
  assert.match(codexProblem('---\nname: n\ndescription: [a, b]\n---\nB\n', 'n') ?? '', /description/);
  assert.match(codexProblem(`---\nname: ${'a'.repeat(65)}\ndescription: Long.\n---\nB\n`, 'long') ?? '', /64/);
});

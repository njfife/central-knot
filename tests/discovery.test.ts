import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover, parseSkill, probeVersion } from '../src/discovery.ts';
import { executableCandidates } from '../src/platform.ts';

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'ck-first-look-'));
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

async function skill(home: string, folder: string, content: string) {
  const directory = join(home, '.claude/skills', folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), content);
}

async function tree(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const info = await stat(path);
        result[path] = `${info.mode}:${info.mtimeMs}:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
      }
    }
  }
  await visit(directory);
  return result;
}

async function executable(home: string, output: string) {
  const binary = join(home, 'fixture-claude');
  await writeFile(binary, `#!/bin/sh\nif [ "$#" -ne 1 ] || [ "$1" != "--version" ]; then exit 7; fi\n${output}\n`, { mode: 0o755 });
  return binary;
}

test('AT-01/02: discovers only user-wide standalone skills, without changing files', async () => {
  const setup = await fixture();
  try {
    const original = '---\nname: My skill\ndescription: Read this unchanged\ncustom: opaque-value\n---\n\nOriginal body.\n';
    await skill(setup.home, 'review', original);
    await skill(setup.home, 'synced', 'Reserved');
    await skill(join(setup.home, 'project'), 'project-only', 'Project');
    const before = await tree(setup.home);
    const snapshot = await discover({ home: setup.home, mode: 'custom' });
    assert.equal(snapshot.detection, 'Config found but app not detected');
    assert.equal(snapshot.probe.state, 'not-run');
    assert.equal(snapshot.discovery, 'ready');
    assert.deepEqual(snapshot.skills.map(item => item.id), ['review']);
    assert.equal(snapshot.skills[0].name, 'My skill');
    assert.equal(snapshot.skills[0].content, original);
    assert.equal(snapshot.skills[0].status, 'Not shared');
    assert.deepEqual(await tree(setup.home), before);
  } finally { await setup.cleanup(); }
});

test('AT-01/04: missing binary, missing folder and empty folder remain distinct', async () => {
  const setup = await fixture();
  try {
    const absent = await discover({ home: setup.home, mode: 'actual', runProbes: true, binaries: [join(setup.home, 'absent')] });
    assert.equal(absent.detection, 'Not found');
    assert.equal(absent.probe.state, 'missing');
    assert.equal(absent.discovery, 'missing');
    await mkdir(join(setup.home, '.claude/skills'), { recursive: true });
    const empty = await discover({ home: setup.home, mode: 'custom' });
    assert.equal(empty.discovery, 'empty');
    assert.equal(empty.skills.length, 0);
  } finally { await setup.cleanup(); }
});

test('AT-01/02: malformed metadata is reported, good rows remain and no text changes', async () => {
  const setup = await fixture();
  try {
    await skill(setup.home, 'bad', '---\nname: [unterminated\n---\nBody');
    await skill(setup.home, 'plain', 'Plain Markdown stays exactly as supplied.');
    const before = await tree(setup.home);
    const snapshot = await discover({ home: setup.home, mode: 'custom' });
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0].name, 'plain');
    assert.match(snapshot.issues[0], /bad: Malformed YAML/);
    assert.deepEqual(await tree(setup.home), before);
  } finally { await setup.cleanup(); }
});

test('DET-02: honors relocated configuration and does not substitute an unknown root', async () => {
  const setup = await fixture();
  try {
    const relocated = join(setup.home, 'relocated');
    await mkdir(join(relocated, 'skills/relocated-skill'), { recursive: true });
    await writeFile(join(relocated, 'skills/relocated-skill/SKILL.md'), 'Relocated');
    await skill(setup.home, 'default-must-not-appear', 'Default');
    const result = await discover({ home: setup.home, mode: 'actual', configOverride: relocated });
    assert.deepEqual(result.skills.map(item => item.id), ['relocated-skill']);
    const unknown = await discover({ home: setup.home, mode: 'actual', configOverride: 'relative-root' });
    assert.equal(unknown.discovery, 'failed');
    assert.equal(unknown.skills.length, 0);
    assert.match(unknown.issues[0], /No default substituted/);
  } finally { await setup.cleanup(); }
});

test('AT-01/DET-02: version probe is bounded and uses only --version', { skip: process.platform === 'win32' }, async () => {
  const setup = await fixture();
  try {
    const binary = await executable(setup.home, "printf '2.1.318 (Claude Code)\\n'");
    const before = await tree(setup.home);
    const snapshot = await discover({ home: setup.home, mode: 'actual', runProbes: true, binaries: [binary] });
    assert.equal(snapshot.detection, 'Installed');
    assert.equal(snapshot.probe.version, '2.1.318');
    assert.deepEqual(await tree(setup.home), before);
    await executable(setup.home, 'while :; do :; done');
    const started = Date.now();
    const hung = await probeVersion(binary, 80);
    assert.equal(hung.state, 'timeout');
    assert.ok(Date.now() - started < 1500);
  } finally { await setup.cleanup(); }
});

test('AT-01/04: failed, empty and malformed version outputs are not success', { skip: process.platform === 'win32' }, async () => {
  const setup = await fixture();
  try {
    const binary = await executable(setup.home, 'exit 3');
    assert.equal((await probeVersion(binary)).state, 'failed');
    await executable(setup.home, 'exit 0');
    assert.equal((await probeVersion(binary)).state, 'malformed');
    await executable(setup.home, "printf 'not a version'");
    assert.equal((await probeVersion(binary)).state, 'malformed');
  } finally { await setup.cleanup(); }
});

test('AT-01: permission restriction is not an empty skill list', { skip: process.getuid?.() === 0 || process.platform === 'win32' }, async () => {
  const setup = await fixture();
  const skillsRoot = join(setup.home, '.claude/skills');
  try {
    await mkdir(skillsRoot, { recursive: true });
    await chmod(skillsRoot, 0o000);
    const snapshot = await discover({ home: setup.home, mode: 'custom' });
    assert.equal(snapshot.discovery, 'restricted');
    assert.equal(snapshot.skills.length, 0);
  } finally { await chmod(skillsRoot, 0o755); await setup.cleanup(); }
});

test('AT-67: project configs are not read and discovery creates no state or cache', async () => {
  const setup = await fixture();
  try {
    await skill(join(setup.home, 'workspace'), 'project-skill', 'Project only');
    await mkdir(join(setup.home, '.claude'), { recursive: true });
    await writeFile(join(setup.home, '.claude/settings.json'), '{malformed plugin settings outside this slice');
    const before = await tree(setup.home);
    const snapshot = await discover({ home: setup.home, mode: 'custom' });
    assert.equal(snapshot.skills.length, 0);
    assert.deepEqual(await tree(setup.home), before);
  } finally { await setup.cleanup(); }
});

test('OWN-02: reading a linked skill leaves the link and target unchanged', { skip: process.platform === 'win32' }, async () => {
  const setup = await fixture();
  try {
    await skill(setup.home, 'original', 'User bytes');
    await symlink(join(setup.home, '.claude/skills/original'), join(setup.home, '.claude/skills/linked'));
    const snapshot = await discover({ home: setup.home, mode: 'custom' });
    assert.equal(snapshot.skills.length, 2);
    assert.ok(snapshot.skills.find(item => item.id === 'linked')!.notes.some(note => note.includes('user link')));
    assert.ok((await lstat(join(setup.home, '.claude/skills/linked'))).isSymbolicLink());
    assert.equal(await readFile(join(setup.home, '.claude/skills/original/SKILL.md'), 'utf8'), 'User bytes');
  } finally { await setup.cleanup(); }
});

test('Finder-like PATH still yields bounded explicit candidates, never project paths', () => {
  const candidates = executableCandidates('/Users/fixture', '/usr/bin:/bin:relative-project-bin');
  assert.ok(candidates.includes('/Users/fixture/.local/bin/claude'));
  assert.ok(candidates.includes('/opt/homebrew/bin/claude'));
  assert.ok(candidates.length <= 12);
  assert.ok(candidates.every(candidate => candidate.startsWith('/')));
});

test('metadata parsing retains original values without interpreting Markdown as markup', () => {
  const content = '---\nname: "<script>unchanged</script>"\ndescription: "  Original spacing  "\n---\nBody';
  assert.deepEqual(parseSkill(content, 'fallback'), { name: '<script>unchanged</script>', description: '  Original spacing  ', notes: [], hasFrontmatter: true, metadataKeys: [] });
});

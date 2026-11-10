import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover, findApp, probeVersion } from '../src/discovery.ts';
import { CLAUDE_PROCESS, appCandidates, executableCandidates } from '../src/platform.ts';
import { isPresent } from '../src/presence.ts';

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
    assert.deepEqual(snapshot.skills.map(item => item.folder), ['review']);
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

test('DET-02: a relative config root fails visibly and no default is substituted', async () => {
  const setup = await fixture();
  try {
    await skill(setup.home, 'default-must-not-appear', 'Default');
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

test('OWN-02: reading a linked skill leaves the link and target unchanged', { skip: process.platform === 'win32' }, async () => {
  const setup = await fixture();
  try {
    await skill(setup.home, 'original', 'User bytes');
    await symlink(join(setup.home, '.claude/skills/original'), join(setup.home, '.claude/skills/linked'));
    const snapshot = await discover({ home: setup.home, mode: 'custom' });
    assert.equal(snapshot.skills.length, 2);
    assert.ok(snapshot.skills.find(item => item.folder === 'linked')!.notes.some(note => note.includes('user link')));
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

test('A version probe finds a script CLI’s interpreter beside it, even when the app was opened with a short PATH', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ck-probe-'));
  const path = process.env.PATH;
  try {
    // As npm installs Copilot CLI or Codex beside node: `#!/usr/bin/env node`, node in the same folder, not on PATH.
    await writeFile(join(dir, 'fakenode'), '#!/bin/sh\necho "tool 1.2.3"\n', { mode: 0o755 });
    await writeFile(join(dir, 'tool'), '#!/usr/bin/env fakenode\n', { mode: 0o755 });
    process.env.PATH = '/usr/bin:/bin';
    assert.equal((await probeVersion(join(dir, 'tool'))).version, '1.2.3');
  } finally { process.env.PATH = path; await rm(dir, { recursive: true, force: true }); }
});


/** A desktop app bundle with this version in its Info.plist, as macOS apps carry it. */
async function app(path: string, version: string) {
  await mkdir(join(path, 'Contents'), { recursive: true });
  await writeFile(join(path, 'Contents/Info.plist'), `<?xml version="1.0"?>\n<plist><dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>${version}</string>\n</dict></plist>\n`);
}

test('A desktop app with no CLI makes its tool present, with the app’s version and the version it carries, never as the CLI', { skip: process.platform === 'win32' }, async () => {
  const setup = await fixture();
  try {
    const apps = appCandidates(setup.home, 'claude');
    await app(join(setup.home, 'Applications/Claude.app'), '4.16336.0');
    // Claude desktop keeps each Code tab build in a folder named by its version; the newest is the one it runs.
    for (const build of ['2.1.317', '2.1.99', '2.1.321', 'not-a-version']) await mkdir(join(setup.home, 'Library/Application Support/Claude/claude-code', build), { recursive: true });
    const alone = await discover({ home: setup.home, mode: 'actual', runProbes: true, binaries: [join(setup.home, 'no-cli/claude')], apps });
    assert.equal(alone.detection, 'App only');
    assert.ok(isPresent(alone));
    assert.deepEqual(alone.app, { name: 'Claude desktop', version: '4.16336.0', carries: 'Code tab', carriedVersion: '2.1.321' });
    assert.equal(alone.probe.state, 'missing');
    // With the CLI too, each keeps its own version.
    const both = await discover({ home: setup.home, mode: 'actual', runProbes: true, binaries: [await executable(setup.home, "printf '2.1.318 (Claude Code)\\n'")], apps });
    assert.equal(both.detection, 'Installed');
    assert.equal(both.probe.version, '2.1.318');
    assert.equal(both.app?.carriedVersion, '2.1.321');
    // The GitHub Copilot app names its runtime's version in a file of its own.
    const copilot = join(setup.home, 'Applications/GitHub Copilot.app');
    await app(copilot, '1.1.35');
    await mkdir(join(copilot, 'Contents/Resources/copilot-sdk'), { recursive: true });
    await writeFile(join(copilot, 'Contents/Resources/copilot-sdk/cliVersion.d.ts'), 'export declare const COPILOT_CLI_VERSION = "1.0.102-0.unstable.r41779900948.gf482387";\n');
    const app2 = await discover({ home: setup.home, mode: 'actual', harness: 'copilot-cli', runProbes: true, binaries: [], apps: appCandidates(setup.home, 'copilot') });
    assert.deepEqual([app2.detection, app2.app?.version, app2.app?.carriedVersion], ['App only', '1.1.35', '1.0.102-0.unstable.r41779900948.gf482387']);
    // No app and no CLI: not found. (Only this home's folders: the computer running the test may have the real app.)
    assert.equal((await discover({ home: setup.home, mode: 'actual', harness: 'codex-cli', runProbes: true, binaries: [], apps: appCandidates(setup.home, 'codex').filter(candidate => candidate.app.startsWith(setup.home)) })).detection, 'Not found');
  } finally { await setup.cleanup(); }
});

test('The copy of the tool a desktop app carries is found where the app keeps it: the plugin route when there is no CLI', { skip: process.platform === 'win32' }, async () => {
  const setup = await fixture();
  try {
    const mine = (binary: string) => appCandidates(setup.home, binary).filter(candidate => candidate.app.startsWith(setup.home));
    const runnable = async (path: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, '#!/bin/sh\n', { mode: 0o755 }); };
    await app(join(setup.home, 'Applications/Claude.app'), '4.23118.1');
    const code = join(setup.home, 'Library/Application Support/Claude/claude-code');
    // The newest version folder holds no build yet (still downloading): the newest one that does is the copy.
    await mkdir(join(code, '2.1.322'), { recursive: true });
    await runnable(join(code, '2.1.321/e6736b2d954d/claude.app/Contents/MacOS/claude'));
    assert.deepEqual(await findApp(mine('claude')), { name: 'Claude desktop', version: '4.23118.1', carries: 'Code tab', carriedVersion: '2.1.321', binary: join(code, '2.1.321/e6736b2d954d/claude.app/Contents/MacOS/claude') });
    // The Copilot app's runtime is unpacked into the caches by the version the app names; until then it has no copy.
    const copilot = join(setup.home, 'Applications/GitHub Copilot.app');
    await app(copilot, '1.1.35');
    await mkdir(join(copilot, 'Contents/Resources/copilot-sdk'), { recursive: true });
    await writeFile(join(copilot, 'Contents/Resources/copilot-sdk/cliVersion.d.ts'), 'export declare const COPILOT_CLI_VERSION = "1.0.102-0.unstable.r41779900948.gf482387";\n');
    assert.equal((await findApp(mine('copilot')))?.binary, undefined);
    const runtime = join(setup.home, 'Library/Caches/github-copilot-sdk/cli/copilot-sdk-runtime-1.0.102-0.unstable.r41779900948.gf482387/copilot');
    await runnable(runtime);
    assert.equal((await findApp(mine('copilot')))?.binary, runtime);
  } finally { await setup.cleanup(); }
});

test('Write to Claude Code waits for Claude desktop and its Code tab as well as the CLI', () => {
  const running = (command: string) => new RegExp(CLAUDE_PROCESS).test(command);
  assert.ok(running('/Users/n/Library/Application Support/Claude/claude-code/2.1.321/e6736b2d954d/claude.app/Contents/MacOS/claude --output-format stream-json'));
  assert.ok(running('/Applications/Claude.app/Contents/MacOS/Claude'));
  assert.ok(running('/usr/local/bin/node /usr/local/bin/claude'));
  assert.ok(!running('/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=renderer'));
  assert.ok(!running('grep -r @anthropic-ai/claude-code/ .'));
});

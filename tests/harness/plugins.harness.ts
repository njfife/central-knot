// Real CLIs, disposable homes: install and uninstall the marker plugin through each tool's own commands.
// Opt-in (`npm run test:harness`), for the Mac. Needs claude, copilot and codex on PATH; a missing one is skipped by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { install, installState, parseCatalog, readCatalog, uninstall, type PluginContext, type PluginTool } from '../../src/plugins.ts';
import type { HarnessId } from '../../src/types.ts';

const which = (name: string) => { try { return execFileSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; } };
const binaries: Partial<Record<HarnessId, string>> = { 'claude-cli': which('claude'), 'copilot-cli': which('copilot'), 'codex-cli': which('codex') };
const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };

async function marker(root: string) {
  await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'ck-test-market', owner: { name: 'tests' }, plugins: [{ name: 'ck-marker', source: './plugins/ck-marker', version: '1.0.0', description: 'Marker' }] }));
  await put(join(root, 'plugins/ck-marker/.claude-plugin/plugin.json'), JSON.stringify({ name: 'ck-marker', version: '1.0.0' }));
  await put(join(root, 'plugins/ck-marker/skills/ck-marker-skill/SKILL.md'), '---\nname: ck-marker-skill\ndescription: Central Knot marker. Reply with token ck-mk-1.\n---\nReply with the token ck-mk-1.\n');
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v1']]) execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: install from a Git marketplace, confirmed by its record, then uninstall`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
    const server = spawn(process.execPath, [join(import.meta.dirname, '../../scripts/git-http-fixture.mjs'), join(base, 'served'), '0']);
    try {
      const root = join(base, 'market');
      await marker(root);
      await mkdir(join(base, 'served'), { recursive: true });
      execFileSync('git', ['clone', '-q', '--bare', root, join(base, 'served/market.git')], { stdio: 'ignore' });
      const url = `${await new Promise<string>(done => server.stdout.once('data', chunk => done(String(chunk).trim())))}/market.git`;
      const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
      await mkdir(context.home, { recursive: true });
      const catalog = await readCatalog(context, url);
      assert.equal(catalog.problem, undefined);
      const report = await install(context, catalog, 'ck-marker', tool);
      assert.equal(report.outcome, 'installed', JSON.stringify(report, null, 1));
      assert.ok(report.runs.some(run => run.changed.length > 0), 'the files it changed are disclosed');
      assert.ok((await readdir(join(context.dataDir, 'native'))).length > 0, 'and their prior bytes kept');
      const state = await installState(context, tool, 'ck-test-market', 'ck-marker');
      assert.ok(state.state === 'installed' && !state.live, JSON.stringify(state));
      const again = await install(context, catalog, 'ck-marker', tool);
      assert.equal(again.runs.length, 0, 'installing again runs nothing');
      const removed = await uninstall(context, 'ck-test-market', 'ck-marker', tool, catalog.source);
      assert.equal(removed.outcome, 'uninstalled', JSON.stringify(removed, null, 1));
      assert.equal((await installState(context, tool, 'ck-test-market', 'ck-marker')).state, 'not-installed');
    } finally { server.kill(); await rm(base, { recursive: true, force: true }); }
  });
}

test('copilot-cli: a local folder marketplace is loaded live, and says so', { skip: binaries['copilot-cli'] ? false : 'copilot not on PATH' }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
  try {
    const root = join(base, 'market');
    await marker(root);
    const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
    await mkdir(context.home, { recursive: true });
    const report = await install(context, await parseCatalog(root, root, 'folder'), 'ck-marker', 'copilot-cli');
    assert.equal(report.outcome, 'installed', JSON.stringify(report, null, 1));
    assert.match(report.message, /loaded live/);
    assert.equal((await uninstall(context, 'ck-test-market', 'ck-marker', 'copilot-cli', root)).outcome, 'uninstalled');
  } finally { await rm(base, { recursive: true, force: true }); }
});

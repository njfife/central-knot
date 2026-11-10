// Real CLIs, disposable homes: install and uninstall the marker plugin through each tool's own commands.
// Opt-in (`npm run test:harness`), for the Mac. Needs claude, copilot and codex on PATH; a missing one is skipped by name.
// With CK_HARNESS_APPS=1 the same tests run the copy of each tool its desktop app carries instead (PLG-04, V-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { findApp } from '../../src/discovery.ts';
import { appCandidates } from '../../src/platform.ts';
import { install, installState, installedPlugins, parseCatalog, readCatalog, uninstall, update, type PluginContext } from '../../src/plugins.ts';
import type { PluginTool } from '../../src/presence.ts';
import type { HarnessId } from '../../src/types.ts';

const which = (name: string) => { try { return execFileSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; } };
const fromApp = async (name: string) => (await findApp(appCandidates(homedir(), name)))?.binary;
const find = process.env.CK_HARNESS_APPS ? fromApp : async (name: string) => which(name);
const binaries: Partial<Record<HarnessId, string>> = { 'claude-cli': await find('claude'), 'copilot-cli': await find('copilot'), 'codex-cli': await find('codex') };
const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };

async function marker(root: string, version = '1.0.0', token = 'ck-mk-1') {
  await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'ck-test-market', owner: { name: 'tests' }, plugins: [{ name: 'ck-marker', source: './plugins/ck-marker', version, description: 'Marker' }] }));
  await put(join(root, 'plugins/ck-marker/.claude-plugin/plugin.json'), JSON.stringify({ name: 'ck-marker', version }));
  await put(join(root, 'plugins/ck-marker/skills/ck-marker-skill/SKILL.md'), `---\nname: ck-marker-skill\ndescription: Central Knot marker. Reply with token ${token}.\n---\nReply with the token ${token}.\n`);
  const first = !(await readdir(root).catch((): string[] => [])).includes('.git');
  for (const args of [...(first ? [['init', '-q']] : []), ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', `${version} ${token}`]]) execFileSync('git', args, { cwd: root, stdio: 'ignore' });
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

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: update from a Git marketplace that moved on, confirmed by its record`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
    const server = spawn(process.execPath, [join(import.meta.dirname, '../../scripts/git-http-fixture.mjs'), join(base, 'served'), '0']);
    try {
      const root = join(base, 'market');
      await marker(root);
      await mkdir(join(base, 'served'), { recursive: true });
      const served = join(base, 'served/market.git');
      execFileSync('git', ['clone', '-q', '--bare', root, served], { stdio: 'ignore' });
      const url = `${await new Promise<string>(done => server.stdout.once('data', chunk => done(String(chunk).trim())))}/market.git`;
      const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
      await mkdir(context.home, { recursive: true });
      assert.equal((await install(context, await readCatalog(context, url), 'ck-marker', tool)).outcome, 'installed');
      // The marketplace moves on to 2.0.0; Central Knot reads it again, as Refresh does, and the tool's copy is behind.
      await marker(root, '2.0.0');
      execFileSync('git', ['push', '-q', served, 'HEAD:' + execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: served, encoding: 'utf8' }).trim()], { cwd: root, stdio: 'ignore' });
      const catalog = await readCatalog(context, url);
      assert.equal(catalog.plugins[0]?.version, '2.0.0');
      const report = await update(context, catalog, 'ck-marker', tool);
      assert.deepEqual([report.outcome, report.changed, report.version], ['updated', true, '2.0.0'], JSON.stringify(report, null, 1));
      const state = await installState(context, tool, 'ck-test-market', 'ck-marker');
      assert.ok(state.state === 'installed' && state.version === '2.0.0', JSON.stringify(state));
    } finally { server.kill(); await rm(base, { recursive: true, force: true }); }
  });
}

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: a copy whose content changed at the same version is updated, or reinstalled, until it matches`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
    const server = spawn(process.execPath, [join(import.meta.dirname, '../../scripts/git-http-fixture.mjs'), join(base, 'served'), '0']);
    try {
      const root = join(base, 'market');
      await marker(root);
      await mkdir(join(base, 'served'), { recursive: true });
      const served = join(base, 'served/market.git');
      execFileSync('git', ['clone', '-q', '--bare', root, served], { stdio: 'ignore' });
      const url = `${await new Promise<string>(done => server.stdout.once('data', chunk => done(String(chunk).trim())))}/market.git`;
      const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
      await mkdir(context.home, { recursive: true });
      assert.equal((await install(context, await readCatalog(context, url), 'ck-marker', tool)).outcome, 'installed');
      // The skill's text changes; the version stays 1.0.0.
      await marker(root, '1.0.0', 'ck-mk-2');
      execFileSync('git', ['push', '-q', served, 'HEAD:' + execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: served, encoding: 'utf8' }).trim()], { cwd: root, stdio: 'ignore' });
      const catalog = await readCatalog(context, url);
      const skill = async () => { const state = await installState(context, tool, 'ck-test-market', 'ck-marker'); return state.state === 'installed' ? readFile(join(state.path, 'skills/ck-marker-skill/SKILL.md'), 'utf8').catch(() => '') : ''; };
      const differs = async () => !(await skill()).includes('ck-mk-2');
      assert.equal(await differs(), true, 'the installed copy still has the first text');
      const report = await update(context, catalog, 'ck-marker', tool, differs);
      console.log(tool, report.byContent, report.message, report.runs.map(run => `${run.command} => ${run.output.trim().slice(0, 200)}`));
      assert.deepEqual([report.outcome, report.changed], ['updated', true], JSON.stringify(report, null, 1));
      assert.equal(await differs(), false, 'and now it has the new text');
    } finally { server.kill(); await rm(base, { recursive: true, force: true }); }
  });
}

/** A marketplace of several plugins (one skill each), committed; a plugin left out of `plugins` is dropped from it. */
async function market(root: string, plugins: { name: string; version: string }[]) {
  await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'ck-test-market', owner: { name: 'tests' }, plugins: plugins.map(({ name, version }) => ({ name, source: `./plugins/${name}`, version, description: name })) }));
  for (const { name, version } of plugins) {
    await put(join(root, `plugins/${name}/.claude-plugin/plugin.json`), JSON.stringify({ name, version }));
    await put(join(root, `plugins/${name}/skills/${name}-skill/SKILL.md`), `---\nname: ${name}-skill\ndescription: ${name} ${version}.\n---\n${name} ${version}\n`);
  }
  for (const name of await readdir(join(root, 'plugins'))) if (!plugins.some(plugin => plugin.name === name)) await rm(join(root, 'plugins', name), { recursive: true });
  const first = !(await readdir(root)).includes('.git');
  for (const args of [...(first ? [['init', '-q']] : []), ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', plugins.map(plugin => `${plugin.name} ${plugin.version}`).join(', ')]]) execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

/** A served Git marketplace in a throwaway folder, with `publish` to move it on. */
async function served(plugins: { name: string; version: string }[]) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
  const server = spawn(process.execPath, [join(import.meta.dirname, '../../scripts/git-http-fixture.mjs'), join(base, 'served'), '0']);
  const root = join(base, 'market'), bare = join(base, 'served/market.git');
  await market(root, plugins);
  await mkdir(join(base, 'served'), { recursive: true });
  execFileSync('git', ['clone', '-q', '--bare', root, bare], { stdio: 'ignore' });
  const url = `${await new Promise<string>(done => server.stdout.once('data', chunk => done(String(chunk).trim())))}/market.git`;
  const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
  await mkdir(context.home, { recursive: true });
  const publish = async (next: { name: string; version: string }[]) => {
    await market(root, next);
    execFileSync('git', ['push', '-q', bare, 'HEAD:' + execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: bare, encoding: 'utf8' }).trim()], { cwd: root, stdio: 'ignore' });
    return readCatalog(context, url);
  };
  return { url, context, publish, close: async () => { server.kill(); await rm(base, { recursive: true, force: true }); } };
}

/** Turns a whole plugin off the way its person would in the tool: its own `plugin disable`, or for Codex `enabled = false` in its table. */
async function turnOffInTool(context: PluginContext, tool: PluginTool, id: string) {
  if (tool === 'codex-cli') {
    const path = join(context.home, '.codex/config.toml');
    const config = await readFile(path, 'utf8');
    const header = `[plugins."${id}"]`;
    assert.ok(config.includes(header), config);
    const [before, after] = config.split(header) as [string, string];
    await writeFile(path, `${before}${header}\nenabled = false\n${after.replace(/^\nenabled = true/, '')}`);
    return;
  }
  execFileSync(binaries[tool]!, ['plugin', 'disable', id, ...(tool === 'claude-cli' ? ['--scope', 'user'] : [])], { env: { ...process.env, HOME: context.home }, cwd: context.home, stdio: 'ignore' });
}

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: a plugin turned off in the tool is still off after its update`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const box = await served([{ name: 'ck-marker', version: '1.0.0' }]);
    try {
      assert.equal((await install(box.context, await readCatalog(box.context, box.url), 'ck-marker', tool)).outcome, 'installed');
      await turnOffInTool(box.context, tool, 'ck-marker@ck-test-market');
      const off = async () => (await installedPlugins(box.context, tool)).find(found => found.plugin === 'ck-marker')?.off;
      assert.equal(await off(), true, 'it is off before the update');
      const report = await update(box.context, await box.publish([{ name: 'ck-marker', version: '2.0.0' }]), 'ck-marker', tool);
      console.log(tool, report.message, report.notes, report.runs.map(run => `${run.command} => ${run.ok}`));
      assert.deepEqual([report.outcome, report.changed, report.version, report.notes], ['updated', true, '2.0.0', undefined], JSON.stringify(report, null, 1));
      assert.equal(await off(), true, 'and still off after it');
      assert.match(report.message, /It is still off in /);
    } finally { await box.close(); }
  });

  test(`${tool}: a plugin its marketplace dropped keeps its installed copy when the tool's copy of the marketplace is refreshed`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const box = await served([{ name: 'ck-marker', version: '1.0.0' }, { name: 'ck-other', version: '1.0.0' }]);
    try {
      const first = await readCatalog(box.context, box.url);
      for (const plugin of ['ck-marker', 'ck-other']) assert.equal((await install(box.context, first, plugin, tool)).outcome, 'installed');
      const before = await installState(box.context, tool, 'ck-test-market', 'ck-marker');
      // The marketplace drops ck-marker and moves ck-other on; updating ck-other refreshes the tool's copy of the marketplace.
      const report = await update(box.context, await box.publish([{ name: 'ck-other', version: '2.0.0' }]), 'ck-other', tool);
      assert.deepEqual([report.outcome, report.version], ['updated', '2.0.0'], JSON.stringify(report, null, 1));
      const after = await installState(box.context, tool, 'ck-test-market', 'ck-marker');
      console.log(tool, 'dropped plugin after the refresh:', JSON.stringify(after));
      assert.deepEqual(after, before, 'the dropped plugin is installed as it was');
    } finally { await box.close(); }
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import * as engine from '../src/plugins.ts';
import type { ActionReport, DesktopApp, HarnessId } from '../src/types.ts';

const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const marketplace = (root: string, name: string, plugins: string[]) => Promise.all([
  put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name, plugins: plugins.map(plugin => ({ name: plugin, source: `./plugins/${plugin}` })) })),
  ...plugins.map(plugin => put(join(root, `plugins/${plugin}/skills/${plugin}/SKILL.md`), `---\nname: ${plugin}\ndescription: ${plugin}\n---\n`)),
]);

async function setup(options: { allowed?: boolean; throwFor?: HarnessId; codex?: boolean; app?: DesktopApp; pi?: boolean; /** Not this computer's own home. */ folderHome?: boolean; /** What adding the marketplace to a tool's own list comes to, where not `added`. */ listing?: Partial<Record<HarnessId, Awaited<ReturnType<typeof engine.addMarketplace>>>>; /** A bundled build: the marketplace it carries is in this folder under the base, and these plugins are not packed. */ bundled?: { folder: string; unpackaged?: string[]; kept?: string[] } } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-markets-')));
  const home = join(base, 'home');
  await mkdir(home, { recursive: true });
  const calls: string[] = [];
  /** What the host was told worked (MarketplaceHost.changed). */
  const told: string[] = [];
  const ran: (string | undefined)[] = [];
  const host: MarketplaceHost = {
    home: () => ({ home, actual: !options.folderHome }),
    read: async () => ({ tools: ['claude-cli', 'copilot-cli', 'codex-cli', ...(options.pi ? ['pi-cli' as const] : [])], snapshots: [] }),
    writeAccess: async () => (options.allowed === false ? { allowed: false, reason: 'Preview only.' } : { allowed: true }),
    dataDir: join(base, 'data'),
    pickFolder: async () => undefined,
    openExternal: async () => {},
    changed: (_source, plugin, tools) => { told.push(`${plugin} ${tools.join(',')}`); },
    // With Pi in the home, the parts engine's context too, so a plugin's parts can go into it.
    ...(options.pi ? { share: () => ({ home, mode: 'custom' as const, read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') }) } : {}),
    ...(options.bundled ? { bundled: () => ({ source: join(base, options.bundled!.folder), view: { app: 'Acme Knot', displayName: 'Acme plugins', release: 'November 10, 2026 (GitHub: acme/plugins)', unpackaged: (options.bundled!.unpackaged ?? []).map(name => ({ name, reason: 'It is an npm package.' })), kept: options.bundled!.kept } }) } : {}),
  };
  const use: MarketplaceEngine = {
    findClis: async () => ({ binaries: { 'claude-cli': '/bin/true', ...(options.codex ? { 'codex-cli': join(base, 'bin/codex') } : {}), ...(options.app ? { 'copilot-cli': options.app.binary } : {}) }, apps: options.app ? { 'copilot-cli': options.app } : {} }),
    checkAccess: async (context, source) => { calls.push(`check ${source}`); return engine.checkAccess(context, source); },
    addMarketplace: async (_context, catalog, tool) => { calls.push(`list ${catalog.name} ${tool}`); return options.listing?.[tool] ?? { outcome: 'added', message: 'Added.', runs: [] }; },
    readCatalog: async (context, source) => { calls.push(`read ${source}`); return engine.readCatalog(context, source); },
    readRemotePlugin: async () => ({ problem: 'not in tests' }),
    install: async (context, _catalog, plugin, tool) => { calls.push(`install ${plugin} ${tool}`); ran.push(context.binaries[tool]); if (tool === options.throwFor) throw new Error('disk full'); return { tool, outcome: 'installed', message: 'Installed.', runs: [{ tool, command: 'x', ok: true, output: '', changed: [{ path: '/p', before: 'old', after: 'new' }] }], changed: true } satisfies ActionReport; },
    uninstall: async (_context, marketplace, plugin, tool, source) => { calls.push(`uninstall ${plugin}@${marketplace} ${tool} ${source}`); return { tool, outcome: 'uninstalled', message: 'Uninstalled.', runs: [], changed: true }; },
    update: async (_context, _catalog, plugin, tool, _differs, options) => { calls.push(`update ${plugin} ${tool}${options?.reinstall === false ? ' (no reinstall)' : ''}`); return { tool, outcome: 'updated', message: 'Updated.', runs: [], changed: true }; },
    setSkill: async (_context, marketplace, plugin, skill, tool, on, _source, entry) => { calls.push(`skill ${plugin}:${skill}@${marketplace} ${tool} ${on} entry=${entry?.name}`); return { tool, outcome: on ? 'skill-on' : 'skill-off', message: '', runs: [], changed: true }; },
  };
  return { base, home, calls, told, ran, host, markets: createMarketplaces(host, use), cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Adding a marketplace reads it once, stores how it was given, and the view lists it with its plugins', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf', 'xlsx']);
    const added = await box.markets.add(`${root}/`);
    assert.equal(added.problem, undefined);
    assert.deepEqual(box.calls, [`read ${root}/`]);
    assert.equal(added.source, `${root}/`);
    assert.deepEqual(added.view!.marketplaces.map(entry => [entry.name, entry.plugins.map(plugin => plugin.name), entry.origins]), [['team', ['pdf', 'xlsx'], ['central-knot']]]);
    // The same folder typed another way is the same marketplace: listed once.
    assert.equal((await box.markets.add(root)).view!.marketplaces.length, 1);
  } finally { await box.cleanup(); }
});

test('A Git marketplace that can’t be reached at Add is stopped by its access check: nothing is cloned or listed', async () => {
  const box = await setup();
  try {
    const added = await box.markets.add('http://127.0.0.1:1/team.git');
    assert.match(added.problem ?? '', /Can’t reach the marketplace/);
    assert.deepEqual(box.calls, ['check http://127.0.0.1:1/team.git'], 'no fetch after a failed check');
    assert.equal(await stat(join(box.base, 'data/marketplaces.json')).then(() => true, () => false), false, 'not added to the list');
    assert.equal(await stat(join(box.base, 'data/plugins/catalogs')).then(() => true, () => false), false, 'no copy made');
  } finally { await box.cleanup(); }
});

test('A broken marketplace.json is a problem on its own entry, never a broken page', async () => {
  const box = await setup();
  try {
    const good = join(box.base, 'good');
    const bad = join(box.base, 'bad');
    await marketplace(good, 'good', ['pdf']);
    await put(join(bad, '.claude-plugin/marketplace.json'), 'null');
    await box.markets.add(good);
    await mkdir(join(box.base, 'data'), { recursive: true });
    await writeFile(join(box.base, 'data/marketplaces.json'), JSON.stringify([good, bad]));
    const view = await box.markets.view();
    assert.deepEqual(view.marketplaces.map(entry => [entry.name, !!entry.problem]), [['good', false], ['', true]]);
  } finally { await box.cleanup(); }
});

test('Installs act only on the home on screen, and only where writing is allowed', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    assert.match((await box.markets.install(root, 'team', 'pdf', ['claude-cli'], '/elsewhere')).stopped ?? '', /not the one open/);
    const result = await box.markets.install(root, 'team', 'pdf', ['claude-cli'], box.home);
    assert.deepEqual(result.reports.map(report => [report.tool, report.outcome, report.changed]), [['claude-cli', 'installed', true]]);
    assert.deepEqual(result.reports[0]!.runs[0]!.changed, [{ path: '/p', before: null, after: null }], 'file bytes stay in the main process');
    const locked = await setup({ allowed: false });
    try { assert.equal((await locked.markets.install(root, 'team', 'pdf', ['claude-cli'], locked.home)).stopped, 'Preview only.'); } finally { await locked.cleanup(); }
  } finally { await box.cleanup(); }
});

test('One tool’s error fails that tool only: the others’ reports stay, and later tools still run', async () => {
  const box = await setup({ throwFor: 'copilot-cli' });
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    const result = await box.markets.install(root, 'team', 'pdf', ['claude-cli', 'copilot-cli', 'codex-cli'], box.home);
    assert.deepEqual(result.reports.map(report => [report.tool, report.outcome, !!report.changed]), [['claude-cli', 'installed', true], ['copilot-cli', 'failed', false], ['codex-cli', 'installed', true]]);
    assert.match(result.reports[1]!.message, /disk full/);
  } finally { await box.cleanup(); }
});

test('With no CLI, a tool’s plugins go through the copy its desktop app carries, named on the page with the version it answers', { skip: process.platform === 'win32' }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-app-route-')));
  const runtime = join(base, 'copilot-sdk-runtime-1.0.102-0.unstable.r41779900948.gf482387/copilot');
  await put(runtime, '#!/bin/sh\n[ "$1" = "--version" ] && echo "GitHub Copilot CLI 1.0.102-0.unstable.r41779900948.gf482387."\n');
  await chmod(runtime, 0o755);
  const box = await setup({ app: { name: 'GitHub Copilot app', version: '1.1.35', carries: 'Copilot runtime', carriedVersion: '1.0.102-0.unstable.r41779900948.gf482387', binary: runtime } });
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    const view = (await box.markets.add(root)).view!;
    assert.deepEqual([view.clis['copilot-cli'], view.via, view.desktopOnly], [true, { 'copilot-cli': 'GitHub Copilot app’s Copilot runtime 1.0.102-unstable' }, {}]);
    await box.markets.install(root, 'team', 'pdf', ['claude-cli', 'copilot-cli'], box.home);
    assert.deepEqual(box.ran, ['/bin/true', runtime], 'the same install, run with the app’s copy where there is no CLI');
  } finally { await box.cleanup(); await rm(base, { recursive: true, force: true }); }
});

test('A Git marketplace that can’t be reached is not fetched again on every view', async () => {
  const box = await setup();
  try {
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ gone: { source: { source: 'git', url: 'https://127.0.0.1:1/gone.git' } } }));
    const first = await box.markets.view();
    assert.match(first.marketplaces[0]!.problem ?? '', /reach|access|Git/);
    await box.markets.view();
    assert.equal(box.calls.filter(call => call.startsWith('read ')).length, 1, box.calls.join('\n'));
    await box.markets.view(true);
    assert.equal(box.calls.filter(call => call.startsWith('read ')).length, 2, 'Refresh tries again');
  } finally { await box.cleanup(); }
});

test('A choice made before the marketplace renamed itself fails, rather than installing under a name Undo won’t find', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    await marketplace(root, 'renamed', ['pdf']);
    const result = await box.markets.install(root, 'team', 'pdf', ['claude-cli'], box.home);
    assert.deepEqual(result.reports.map(report => report.outcome), ['failed']);
    assert.match(result.reports[0]!.message, /now named “renamed”/);
    assert.ok(!box.calls.some(call => call.startsWith('install ')), 'nothing ran');
  } finally { await box.cleanup(); }
});

test('A plugin’s page and the marketplace’s About read their files; Remove takes it off the list only', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await put(join(root, 'README.md'), '# team\n\nOur tools.\n');
    await put(join(root, 'plugins/pdf/README.md'), 'Reads PDFs.\n');
    assert.match((await box.markets.add('-x')).problem ?? '', /isn’t a marketplace/);
    assert.match((await box.markets.add('./market')).problem ?? '', /full path/);
    await box.markets.add(root);
    assert.match(await box.markets.readme(root) ?? '', /Our tools/);
    const detail = await box.markets.detail(root, 'pdf');
    assert.deepEqual([detail?.skills.map(skill => skill.name), detail?.readme?.trim()], [['pdf'], 'Reads PDFs.']);
    assert.equal(await box.markets.detail(root, 'missing'), null);
    const after = await box.markets.forget(root);
    assert.equal(after.marketplaces.length, 0);
    assert.ok(!box.calls.some(call => call.startsWith('uninstall')), 'nothing was uninstalled');
  } finally { await box.cleanup(); }
});

test('Each tool’s installed copy is read as that tool reads it, which may be another release than the marketplace’s', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    // Claude Code has an older release whose plugin.json kept its skill elsewhere: its copy is read as it lists its own
    // parts, not as the marketplace's current entry does (which now names another folder).
    await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'pdf', source: './plugins/pdf', skills: ['./skills/pdf'] }] }));
    const copy = join(box.home, '.claude/plugins/cache/team/pdf/0.9.0');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'pdf', skills: ['./old'] }));
    await put(join(copy, 'old/SKILL.md'), '---\nname: pdf\ndescription: older\n---\n');
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'pdf@team': [{ scope: 'user', installPath: copy, version: '0.9.0' }] } }));
    // Codex has it too. It reads only its own .codex-plugin/plugin.json, which lists no skills, so the default folder:
    // not the folder Claude Code's plugin.json in the same copy lists.
    const codexCopy = join(box.home, '.codex/plugins/cache/team/pdf/1.0.0');
    await put(join(codexCopy, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'pdf' }));
    await put(join(codexCopy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'pdf', skills: ['./claude-skills'] }));
    await put(join(codexCopy, 'skills/pdf/SKILL.md'), '---\nname: pdf\ndescription: for codex\n---\n');
    await put(join(codexCopy, 'claude-skills/pdf/SKILL.md'), '---\nname: pdf\ndescription: for claude\n---\n');
    await put(join(box.home, '.codex/config.toml'), '[plugins."pdf@team"]\nenabled = true\n');
    const installed = (await box.markets.detail(root, 'pdf'))?.installed;
    assert.deepEqual([installed?.['claude-cli']?.version, installed?.['claude-cli']?.skills.map(skill => skill.description), installed?.['codex-cli']?.skills.map(skill => skill.description)],
      ['0.9.0', ['older'], ['for codex']]);
  } finally { await box.cleanup(); }
});

test('A plugin the marketplace can’t give files for (an npm package) is read from the tool that installed it', async () => {
  const box = await setup();
  try {
    const external = join(box.base, 'external');
    await put(join(external, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'ext', plugins: [{ name: 'tool', source: { source: 'npm', package: 'some-tool' } }] }));
    const npmCopy = join(box.home, '.claude/plugins/cache/ext/tool/1.0.0');
    await put(join(npmCopy, 'skills/s/SKILL.md'), '---\nname: s\ndescription: from npm\n---\n');
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'tool@ext': [{ scope: 'user', installPath: npmCopy, version: '1.0.0' }] } }));
    await box.markets.add(external);
    const fromTool = await box.markets.detail(external, 'tool');
    assert.deepEqual([fromTool?.skills, fromTool?.installed?.['claude-cli']?.skills.map(skill => skill.description)], [[], ['from npm']]);
    assert.deepEqual([fromTool?.offered, fromTool?.problem], [false, undefined]);
  } finally { await box.cleanup(); }
});

test('A plugin gone from the marketplace fails for its tools; uninstall names the marketplace source it is for', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    const gone = await box.markets.install(root, 'team', 'removed', ['claude-cli', 'codex-cli'], box.home);
    assert.equal(gone.stopped, undefined);
    assert.deepEqual(gone.reports.map(report => [report.tool, report.outcome]), [['claude-cli', 'failed'], ['codex-cli', 'failed']]);
    await box.markets.uninstall(root, 'team', 'pdf', 'claude-cli', box.home);
    assert.ok(box.calls.includes(`uninstall pdf@team claude-cli ${root}`), box.calls.join('\n'));
  } finally { await box.cleanup(); }
});

test('A tool holding a different marketplace under the same name is left alone', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ extraKnownMarketplaces: { team: { source: { source: 'git', url: 'https://example.com/other.git' } } } }));
    const view = (await box.markets.add(root)).view!;
    const ours = view.marketplaces.find(entry => entry.source === root)!;
    assert.equal(ours.states.pdf!['claude-cli']!.state, 'held');
    assert.equal(ours.states.pdf!['codex-cli']!.state, 'not-installed');
  } finally { await box.cleanup(); }
});

test('Refresh lets go of the copies a marketplace’s plugins keep from other repositories, so they are read again', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'notes', source: { source: 'github', repo: 'example/notes', path: 'plugin' } }] }));
    await box.markets.add(root);
    const copy = engine.remoteCopyFolder({ home: box.home, dataDir: join(box.base, 'data', 'plugins'), binaries: {} }, { url: 'https://github.com/example/notes.git' });
    await put(join(copy, 'plugin/README.md'), 'old');
    await box.markets.view();
    assert.equal(await import('node:fs/promises').then(fs => fs.stat(copy).then(() => true, () => false)), true, 'a plain view keeps the copy');
    await box.markets.view(true);
    assert.equal(await import('node:fs/promises').then(fs => fs.stat(copy).then(() => true, () => false)), false);
  } finally { await box.cleanup(); }
});

test('The list’s background read (local) reads only what is on disk: a plugin or marketplace that would need fetching is not read', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'notes', source: { source: 'github', repo: 'example/notes', path: 'plugin' } }] }));
    await box.markets.add(root);
    // Its repository isn't copied here yet: the page's read tries it (here a stand-in that fails), the background read doesn't.
    assert.equal(await box.markets.detail(root, 'notes', true), null);
    assert.match((await box.markets.detail(root, 'notes'))?.problem ?? '', /not in tests/);
    const copy = engine.remoteCopyFolder({ home: box.home, dataDir: join(box.base, 'data', 'plugins'), binaries: {} }, { url: 'https://github.com/example/notes.git' });
    await put(join(copy, 'plugin/README.md'), 'notes');
    assert.notEqual(await box.markets.detail(root, 'notes', true), null, 'once on disk, it is read');
    // A Git marketplace with no copy on disk is not fetched for it.
    assert.equal(await box.markets.detail('https://127.0.0.1:1/gone.git', 'notes', true), null);
    assert.equal(box.calls.filter(call => call.startsWith('read https')).length, 0, box.calls.join('\n'));
  } finally { await box.cleanup(); }
});

test('Turning a plugin skill off is offered on a build older than the one tested; Refresh reads the build again for the note', { skip: process.platform === 'win32' }, async () => {
  const box = await setup({ codex: true });
  try {
    await mkdir(join(box.base, 'bin'), { recursive: true });
    await writeFile(join(box.base, 'bin/codex'), '#!/bin/sh\necho "codex-cli 0.100.0"\n', { mode: 0o755 });
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    assert.equal((await box.markets.setSkill(root, 'team', 'pdf', 'one', 'codex-cli', false, box.home)).reports[0]!.outcome, 'skill-off');
    assert.deepEqual(box.calls.filter(call => call.startsWith('skill')), ['skill pdf:one@team codex-cli false entry=pdf'], 'the turn-off reached the tool, with the plugin’s catalog entry');
    assert.equal((await box.markets.view()).versions?.['codex-cli'], '0.100.0');
    // Codex updated while the app is open: Refresh all reads its build again.
    await writeFile(join(box.base, 'bin/codex'), '#!/bin/sh\necho "codex-cli 0.167.0"\n', { mode: 0o755 });
    assert.equal((await box.markets.view(true)).versions?.['codex-cli'], '0.167.0');
  } finally { await box.cleanup(); }
});

test('A bundled build’s own marketplace is listed first, stays listed, and offers no install of a plugin it doesn’t carry', async () => {
  const box = await setup({ bundled: { folder: 'carried', unpackaged: ['xlsx'] } });
  try {
    const carried = join(box.base, 'carried'), other = join(box.base, 'other');
    await marketplace(carried, 'team', ['pdf', 'xlsx']);
    await marketplace(other, 'other', ['notes']);
    // Nothing was added, and it is there; one added later comes after it.
    const first = await box.markets.view();
    assert.deepEqual(first.marketplaces.map(entry => [entry.name, entry.origins, entry.sourceLabel, entry.bundled?.displayName]), [['team', ['bundle'], 'Comes with Acme Knot', 'Acme plugins']]);
    const added = await box.markets.add(other);
    assert.deepEqual(added.view!.marketplaces.map(entry => [entry.name, !!entry.bundled]), [['team', true], ['other', false]]);
    // Removing it from the list does nothing: it is part of the build.
    assert.deepEqual((await box.markets.forget(carried)).marketplaces.map(entry => entry.name), ['team', 'other']);
    // A carried plugin installs by the usual route; the one the build has no files for fails with the reason, and nothing runs.
    const installed = await box.markets.install(carried, 'team', 'pdf', ['claude-cli'], box.home);
    assert.deepEqual(installed.reports.map(report => report.outcome), ['installed']);
    const refused = await box.markets.install(carried, 'team', 'xlsx', ['claude-cli', 'codex-cli'], box.home);
    assert.deepEqual(refused.reports.map(report => [report.tool, report.outcome]), [['claude-cli', 'failed'], ['codex-cli', 'failed']]);
    assert.match(refused.reports[0]!.message, /^Acme Knot doesn’t include this plugin’s files, so it can’t be installed from here\. It is an npm package\.$/);
    assert.deepEqual(box.calls.filter(call => call.startsWith('install')), ['install pdf claude-cli']);
  } finally { await box.cleanup(); }
});

/** A marketplace whose plugins each say their version, with one skill each holding `text`. */
const versioned = (root: string, name: string, plugins: Record<string, { version: string; text?: string }>) => Promise.all([
  put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name, plugins: Object.keys(plugins).map(plugin => ({ name: plugin, source: `./plugins/${plugin}` })) })),
  ...Object.entries(plugins).flatMap(([plugin, { version, text = plugin }]) => [
    put(join(root, `plugins/${plugin}/.claude-plugin/plugin.json`), JSON.stringify({ name: plugin, version })),
    put(join(root, `plugins/${plugin}/skills/${plugin}/SKILL.md`), `---\nname: ${plugin}\ndescription: ${plugin}\n---\n${text}\n`)]),
]);
/** Claude Code's record of plugins installed from `market`, each a cache copy at its version holding one skill with `text`. */
async function claudeHas(home: string, market: string, plugins: Record<string, { version: string; text?: string }>) {
  const listed: Record<string, unknown> = {};
  for (const [plugin, { version, text = plugin }] of Object.entries(plugins)) {
    const copy = join(home, '.claude/plugins/cache', market, plugin, version);
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: plugin, version }));
    await put(join(copy, `skills/${plugin}/SKILL.md`), `---\nname: ${plugin}\ndescription: ${plugin}\n---\n${text}\n`);
    listed[`${plugin}@${market}`] = [{ scope: 'user', installPath: copy, version }];
  }
  await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: listed }));
}

test('What is due by itself is what Update all would choose: an older copy and one that differs at the same version, and nothing for a tool without the plugin', async () => {
  const box = await setup({ pi: true });
  try {
    const root = join(box.base, 'market');
    await versioned(root, 'team', { notes: { version: '2.0.0', text: 'new words' }, pdf: { version: '2.0.0' }, xlsx: { version: '2.0.0' }, extra: { version: '1.0.0' } });
    await box.markets.add(root);
    // Claude Code: pdf is older, notes has other words at the same version, xlsx is the marketplace's copy. It never had extra,
    // and Codex has none of them: nothing is installed anywhere by an update.
    await claudeHas(box.home, 'team', { pdf: { version: '1.0.0' }, notes: { version: '2.0.0', text: 'old words' }, xlsx: { version: '2.0.0' } });
    // Pi has pdf's parts as they were before the marketplace moved on.
    await versioned(root, 'team', { notes: { version: '2.0.0', text: 'new words' }, pdf: { version: '1.0.0' }, xlsx: { version: '2.0.0' }, extra: { version: '1.0.0' } });
    assert.equal((await box.markets.parts(root, 'team', 'pdf', 'pi-cli', 'install', undefined, box.home)).reports[0]?.outcome, 'installed');
    await versioned(root, 'team', { notes: { version: '2.0.0', text: 'new words' }, pdf: { version: '2.0.0', text: 'pdf, second edition' }, xlsx: { version: '2.0.0' }, extra: { version: '1.0.0' } });
    // A second marketplace that can't be read now is named, and gives nothing.
    const broken = join(box.base, 'broken');
    await versioned(broken, 'other', { thing: { version: '1.0.0' } });
    await box.markets.add(broken);
    await put(join(broken, '.claude-plugin/marketplace.json'), '{ not json');
    const due = await box.markets.pendingUpdates(box.home);
    assert.deepEqual(due.ops.map(op => [op.plugin, op.tool, op.action, op.offered, op.marketName, op.source]), [
      ['notes', 'claude-cli', 'update', '2.0.0', 'team', root], ['pdf', 'claude-cli', 'update', '2.0.0', 'team', root], ['pdf', 'pi-cli', 'install-parts', '2.0.0', 'team', root]]);
    assert.deepEqual([due.stopped, due.unread, due.unreadSources], [undefined, ['Folder: broken'], [broken]], 'named as the Plugins page names it, and by where it was added from');
    // The update itself is the button's, told not to uninstall in order to reinstall.
    box.calls.length = 0;
    await box.markets.update(root, 'team', 'pdf', ['claude-cli'], box.home, { reinstall: false });
    assert.deepEqual(box.calls, ['update pdf claude-cli (no reinstall)']);
    assert.equal(box.told.at(-1), 'pdf claude-cli', 'the host hears which tools a change worked in, so a failure noted there before is settled');
    assert.deepEqual((await box.markets.pendingUpdates('/another/home')).ops, [], 'only the home that is open');
  } finally { await box.cleanup(); }
});

test('Where nothing may be changed, nothing is due and the reason is given', async () => {
  const box = await setup({ allowed: false });
  try {
    const root = join(box.base, 'market');
    await versioned(root, 'team', { pdf: { version: '2.0.0' } });
    await box.markets.add(root);
    await claudeHas(box.home, 'team', { pdf: { version: '1.0.0' } });
    assert.deepEqual(await box.markets.pendingUpdates(box.home), { stopped: 'Preview only.', ops: [], unread: [], unreadSources: [] });
  } finally { await box.cleanup(); }
});

test('A plugin its marketplace dropped stays listed where a tool still has it, marked as no longer offered, with its installed copy; it is never due', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await versioned(root, 'team', { pdf: { version: '1.0.0' }, xlsx: { version: '1.0.0' } });
    await box.markets.add(root);
    await claudeHas(box.home, 'team', { pdf: { version: '1.0.0' }, xlsx: { version: '1.0.0' } });
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'git', url: root } } }));
    // The marketplace drops pdf and moves xlsx on.
    await rm(join(root, 'plugins/pdf'), { recursive: true });
    await versioned(root, 'team', { xlsx: { version: '2.0.0' } });
    const entry = (await box.markets.view()).marketplaces[0]!;
    assert.deepEqual(entry.plugins.map(plugin => [plugin.name, plugin.gone, plugin.description]), [
      ['xlsx', undefined, ''], ['pdf', true, 'Stays installed as it is until you uninstall it.']]);
    assert.deepEqual([entry.states.pdf?.['claude-cli']?.state, entry.states.pdf?.['codex-cli']?.state], ['installed', 'not-installed']);
    assert.deepEqual((await box.markets.detail(root, 'pdf'))?.installed?.['claude-cli']?.skills.map(skill => skill.name), ['pdf'], 'its page shows what the tool still holds');
    assert.deepEqual((await box.markets.pendingUpdates(box.home)).ops.map(op => op.plugin), ['xlsx']);
    // Installing it again is refused (it isn't offered); uninstalling it is the tool's own uninstall.
    assert.match((await box.markets.install(root, 'team', 'pdf', ['claude-cli'], box.home)).reports[0]!.message, /no longer in the marketplace/);
    // A tool that has another marketplace under this name says nothing about this one's plugins.
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'git', url: 'https://example.test/other/team.git' } } }));
    assert.deepEqual((await box.markets.view()).marketplaces.find(market => market.source === root)!.plugins.map(plugin => plugin.name), ['xlsx']);
  } finally { await box.cleanup(); }
});

test('A bundled build adds its marketplace to each tool’s own list once, and never again after that', async () => {
  const box = await setup({ bundled: { folder: 'carried' }, codex: true, listing: { 'codex-cli': { outcome: 'held', message: 'Codex has a different marketplace named “team”.', runs: [] } } });
  try {
    await marketplace(join(box.base, 'carried'), 'team', ['pdf']);
    const turns: number[] = [];
    const turn = <T>(work: () => Promise<T>) => { turns.push(turns.length); return work(); };
    const lists = () => box.calls.filter(call => call.startsWith('list'));
    // Every tool found that takes plugins and whose commands can run: Claude Code and Codex here (Copilot CLI has no command-line
    // tool in this setup, and Pi takes no plugins). Each takes its own turn.
    const first = await box.markets.addCarried(['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'], turn);
    assert.deepEqual(first.map(report => [report.tool, report.outcome]), [['claude-cli', 'added'], ['codex-cli', 'held']]);
    assert.deepEqual(lists(), ['list team claude-cli', 'list team codex-cli']);
    assert.equal(turns.length, 2);
    assert.deepEqual(JSON.parse(await readFile(join(box.base, 'data/bundled/added-to-tools.json'), 'utf8')), { marketplace: 'team', homes: { [box.home]: ['claude-cli'] } });
    // The next read of the home adds nothing: Claude Code has been given it (taken out there since or not), and the one
    // that was left alone is not asked again this session.
    assert.deepEqual(await box.markets.addCarried(['claude-cli', 'copilot-cli', 'codex-cli'], turn), []);
    assert.deepEqual(lists().length, 2);
    // Asked for by hand on its About tab, a tool is added to again, and the page gets the new view.
    const byHand = await box.markets.addCarriedTo('claude-cli', box.home);
    assert.equal(byHand.report?.outcome, 'added');
    assert.equal(byHand.view?.marketplaces[0]?.name, 'team');
    assert.equal((await box.markets.addCarriedTo('claude-cli', '/another/home')).stopped, 'The home on screen is not the one open. Nothing was changed. Read it again.');
    // The page is told which tools the build added it to, so About can say it was the app's doing.
    assert.deepEqual(byHand.view?.marketplaces[0]?.bundled?.addedTo, ['claude-cli']);
  } finally { await box.cleanup(); }
});

test('The carried marketplace is added to no tool in a folder opened as a home, a home that is preview only, or a build that carries none', async () => {
  for (const options of [{ bundled: { folder: 'carried' }, folderHome: true }, { bundled: { folder: 'carried' }, allowed: false }, {}]) {
    const box = await setup(options);
    try {
      await marketplace(join(box.base, 'carried'), 'team', ['pdf']);
      assert.deepEqual(await box.markets.addCarried(['claude-cli'], work => work()), []);
      assert.deepEqual(box.calls.filter(call => call.startsWith('list')), []);
    } finally { await box.cleanup(); }
  }
});

test('Installing a carried plugin into a tool counts as adding the marketplace there: it is never added again by itself', async () => {
  const box = await setup({ bundled: { folder: 'carried' }, codex: true });
  try {
    const carried = join(box.base, 'carried');
    await marketplace(carried, 'team', ['pdf']);
    // The person installs into Codex before the build's own add reaches it (its command-line tool turned up between reads).
    assert.deepEqual((await box.markets.install(carried, 'team', 'pdf', ['codex-cli'], box.home)).reports.map(report => report.outcome), ['installed']);
    const reports = await box.markets.addCarried(['claude-cli', 'codex-cli'], work => work());
    assert.deepEqual(reports.map(report => report.tool), ['claude-cli']);
    assert.deepEqual(box.calls.filter(call => call.startsWith('list')), ['list team claude-cli']);
  } finally { await box.cleanup(); }
});

test('A home switched while a tool waits its turn adds nothing, and that tool is tried again when this computer’s home is read next', async () => {
  let actual = true;
  const box = await setup({ bundled: { folder: 'carried' } });
  try {
    await marketplace(join(box.base, 'carried'), 'team', ['pdf']);
    const host = box.host;
    const home = host.home;
    host.home = () => ({ ...home()!, actual });
    // The switch happens while Claude Code's add waits in the queue.
    assert.deepEqual(await box.markets.addCarried(['claude-cli'], work => { actual = false; return work(); }), []);
    assert.deepEqual(box.calls.filter(call => call.startsWith('list')), []);
    actual = true;
    assert.deepEqual((await box.markets.addCarried(['claude-cli'], work => work())).map(report => report.outcome), ['added']);
  } finally { await box.cleanup(); }
});

test('A plugin the build’s marketplace no longer offers goes into no other tool, and still updates where it is', async () => {
  // It is kept for the tools that have it; the release that dropped it also lists it as one it has no files for.
  const box = await setup({ bundled: { folder: 'carried', kept: ['pdf'], unpackaged: ['pdf'] } });
  try {
    const carried = join(box.base, 'carried');
    await marketplace(carried, 'team', ['pdf']);
    const refused = await box.markets.install(carried, 'team', 'pdf', ['codex-cli'], box.home);
    assert.deepEqual(refused.reports.map(report => [report.outcome, report.message]), [['failed', 'Acme plugins no longer offers this plugin. It stays in the tools that have it until you uninstall it.']]);
    assert.deepEqual((await box.markets.update(carried, 'team', 'pdf', ['claude-cli'], box.home)).reports.map(report => report.outcome), ['updated']);
    assert.deepEqual(box.calls.filter(call => /^(install|update)/.test(call)), ['update pdf claude-cli']);
  } finally { await box.cleanup(); }
});

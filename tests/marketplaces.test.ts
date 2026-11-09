import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import * as engine from '../src/plugins.ts';
import type { ActionReport, HarnessId } from '../src/types.ts';

const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const marketplace = (root: string, name: string, plugins: string[]) => Promise.all([
  put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name, plugins: plugins.map(plugin => ({ name: plugin, source: `./plugins/${plugin}` })) })),
  ...plugins.map(plugin => put(join(root, `plugins/${plugin}/skills/${plugin}/SKILL.md`), `---\nname: ${plugin}\ndescription: ${plugin}\n---\n`)),
]);

async function setup(options: { allowed?: boolean; throwFor?: HarnessId } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-markets-')));
  const home = join(base, 'home');
  await mkdir(home, { recursive: true });
  const calls: string[] = [];
  const host: MarketplaceHost = {
    home: () => ({ home, snapshots: [] }),
    tools: async () => ['claude-cli', 'copilot-cli', 'codex-cli'],
    writeAccess: async () => (options.allowed === false ? { allowed: false, reason: 'Preview only.' } : { allowed: true }),
    dataDir: join(base, 'data'),
    pickFolder: async () => undefined,
    openExternal: async () => {},
  };
  const use: MarketplaceEngine = {
    findClis: async () => ({ 'claude-cli': '/bin/true' }),
    checkAccess: async (context, source) => { calls.push(`check ${source}`); return engine.checkAccess(context, source); },
    readCatalog: async (context, source) => { calls.push(`read ${source}`); return engine.readCatalog(context, source); },
    readRemotePlugin: async () => ({ problem: 'not in tests' }),
    install: async (_context, _catalog, plugin, tool) => { calls.push(`install ${plugin} ${tool}`); if (tool === options.throwFor) throw new Error('disk full'); return { tool, outcome: 'installed', message: 'Installed.', runs: [{ tool, command: 'x', ok: true, output: '', changed: [{ path: '/p', before: 'old', after: 'new' }] }], changed: true } satisfies ActionReport; },
    uninstall: async (_context, marketplace, plugin, tool, source) => { calls.push(`uninstall ${plugin}@${marketplace} ${tool} ${source}`); return { tool, outcome: 'uninstalled', message: 'Uninstalled.', runs: [], changed: true }; },
  };
  return { base, home, calls, markets: createMarketplaces(host, use), cleanup: () => rm(base, { recursive: true, force: true }) };
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
    const result = await box.markets.install(root, 'team', 'pdf', ['claude-cli', 'copilot-cli', 'codex-cli'] as HarnessId[], box.home);
    assert.deepEqual(result.reports.map(report => [report.tool, report.outcome, !!report.changed]), [['claude-cli', 'installed', true], ['copilot-cli', 'failed', false], ['codex-cli', 'installed', true]]);
    assert.match(result.reports[1]!.message, /disk full/);
  } finally { await box.cleanup(); }
});

test('A Git marketplace that can’t be reached is not fetched again on every view', async () => {
  const box = await setup();
  try {
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ gone: { source: { source: 'git', url: 'https://127.0.0.1:1/gone.git' } } }));
    const first = await box.markets.view();
    assert.match(first.marketplaces[0]!.problem ?? '', /reach|access|Git/);
    await box.markets.view();
    assert.equal(box.calls.filter(call => call.startsWith('read ')).length, 1, box.calls.join('\n'));
    await box.markets.view('https://127.0.0.1:1/gone.git');
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

test('A plugin gone from the marketplace fails for its tools; uninstall names the marketplace source it is for', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    const gone = await box.markets.install(root, 'team', 'removed', ['claude-cli', 'codex-cli'] as HarnessId[], box.home);
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

test('Refreshing a marketplace lets go of its plugins’ copies from other repositories, so they are read again', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'notes', source: { source: 'github', repo: 'example/notes', path: 'plugin' } }] }));
    await box.markets.add(root);
    const copy = engine.remoteCopyFolder({ home: box.home, dataDir: join(box.base, 'data', 'plugins'), binaries: {} }, { url: 'https://github.com/example/notes.git' });
    await put(join(copy, 'plugin/README.md'), 'old');
    await box.markets.view();
    assert.equal(await import('node:fs/promises').then(fs => fs.stat(copy).then(() => true, () => false)), true, 'a plain view keeps the copy');
    await box.markets.refresh(root);
    assert.equal(await import('node:fs/promises').then(fs => fs.stat(copy).then(() => true, () => false)), false);
  } finally { await box.cleanup(); }
});

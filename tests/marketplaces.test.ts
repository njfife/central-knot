import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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

async function setup(options: { allowed?: boolean } = {}) {
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
    readCatalog: async (context, source) => { calls.push(`read ${source}`); return engine.readCatalog(context, source); },
    readRemotePlugin: async () => ({ problem: 'not in tests' }),
    install: async (_context, _catalog, plugin, tool) => { calls.push(`install ${plugin} ${tool}`); return { tool, outcome: 'installed', message: 'Installed.', runs: [{ tool, command: 'x', ok: true, output: '', changed: [{ path: '/p', before: 'old', after: 'new' }] }], changed: true } satisfies ActionReport; },
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
    assert.match((await box.markets.install(root, 'pdf', ['claude-cli'], '/elsewhere')).stopped ?? '', /not the one open/);
    const result = await box.markets.install(root, 'pdf', ['claude-cli'], box.home);
    assert.deepEqual(result.reports.map(report => [report.tool, report.outcome, report.changed]), [['claude-cli', 'installed', true]]);
    assert.deepEqual(result.reports[0]!.runs[0]!.changed, [{ path: '/p', before: null, after: null }], 'file bytes stay in the main process');
    const locked = await setup({ allowed: false });
    try { assert.equal((await locked.markets.install(root, 'pdf', ['claude-cli'], locked.home)).stopped, 'Preview only.'); } finally { await locked.cleanup(); }
  } finally { await box.cleanup(); }
});

test('A plugin gone from the marketplace fails for its tools; uninstall names the marketplace source it is for', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    const gone = await box.markets.install(root, 'removed', ['claude-cli', 'codex-cli'] as HarnessId[], box.home);
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

test('An install reads the tool’s records afresh: the read-sharing of a view never hides the change', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    let seenReads: unknown = 'unset';
    const markets = createMarketplaces({ home: () => ({ home: box.home, snapshots: [] }), tools: async () => ['claude-cli'], writeAccess: async () => ({ allowed: true }), dataDir: join(box.base, 'data'), pickFolder: async () => undefined, openExternal: async () => {} },
      { findClis: async () => ({ 'claude-cli': '/bin/true' }), readCatalog: engine.readCatalog, readRemotePlugin: async () => ({ problem: '' }), uninstall: engine.uninstall,
        install: async (context, _catalog, _plugin, tool) => { seenReads = context.reads; return { tool, outcome: 'installed', message: '', runs: [] }; } });
    await markets.install(root, 'pdf', ['claude-cli'], box.home);
    assert.equal(seenReads, undefined);
  } finally { await box.cleanup(); }
});

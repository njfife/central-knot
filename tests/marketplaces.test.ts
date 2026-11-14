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

async function setup(options: { allowed?: boolean; throwFor?: HarnessId; codex?: boolean; app?: DesktopApp; pi?: boolean; /** The managed tools the home is read with, where not the three that take plugins (and Pi). Changed in place, it is the next read's. */ tools?: HarnessId[]; /** Engine calls in place of the stand-ins below. */ engine?: Partial<MarketplaceEngine>; /** Not this computer's own home. */ folderHome?: boolean; /** What adding the marketplace to a tool's own list comes to, where not `added`. */ listing?: Partial<Record<HarnessId, Awaited<ReturnType<typeof engine.addMarketplace>>>>; /** Tools whose Manage switch is off here (MarketplaceHost leftOut). */ leftOut?: HarnessId[]; /** A bundled build: the marketplace it carries is in this folder under the base, and these plugins are not packed. */ bundled?: { folder: string; unpackaged?: string[]; kept?: string[] } } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-markets-')));
  const home = join(base, 'home');
  await mkdir(home, { recursive: true });
  const calls: string[] = [];
  /** What the host was told worked (MarketplaceHost.changed). */
  const told: string[] = [];
  const ran: (string | undefined)[] = [];
  const host: MarketplaceHost = {
    home: () => ({ home, actual: !options.folderHome }),
    read: async () => ({ tools: [...(options.tools ?? ['claude-cli', 'copilot-cli', 'codex-cli', ...(options.pi ? ['pi-cli' as const] : [])])], snapshots: [] }),
    writeAccess: async () => (options.allowed === false ? { allowed: false, reason: 'Preview only.' } : { allowed: true }),
    dataDir: join(base, 'data'),
    pickFolder: async () => undefined,
    openExternal: async () => {},
    changed: (_source, plugin, tools) => { told.push(`${plugin} ${tools.join(',')}`); },
    leftOut: async () => [...(options.leftOut ?? [])],
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
    setPart: async (_context, marketplace, plugin, part, tool, on) => { calls.push(`${part.kind} ${part.name} of ${plugin}@${marketplace} ${tool} ${on}`); return { tool, outcome: on ? 'part-on' : 'part-off', message: '', runs: [], changed: true }; },
    setWhole: async (_context, marketplace, plugin, tool, on) => { calls.push(`whole ${plugin}@${marketplace} ${tool} ${on}`); return { tool, outcome: on ? 'plugin-on' : 'plugin-off', message: '', runs: [], changed: true }; },
    setSkill: async (_context, marketplace, plugin, skill, tool, on, _source, entry) => { calls.push(`skill ${plugin}:${skill}@${marketplace} ${tool} ${on} entry=${entry?.name}`); return { tool, outcome: on ? 'skill-on' : 'skill-off', message: '', runs: [], changed: true }; },
    ...options.engine,
  };
  // The suggested marketplaces are folders here, so a test never reaches the network: one for Claude Code and Codex, one for a tool this home lacks.
  const offers = [{ source: join(base, 'offered'), name: 'Offered', tools: ['claude-cli', 'codex-cli'] as const }, { source: join(base, 'for-pi'), name: 'Not here', tools: [] }];
  return { base, home, calls, told, ran, host, markets: createMarketplaces(host, use, offers.map(offer => ({ ...offer, tools: [...offer.tools] }))), cleanup: () => rm(base, { recursive: true, force: true }) };
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

test('A plugin action that names a tool whose Manage switch is off is refused whole, whatever else it names: install, update, uninstall, a switch, parts', async () => {
  const box = await setup({ leftOut: ['codex-cli'] });
  try {
    const root = join(box.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await box.markets.add(root);
    const words = 'Codex is left out of Central Knot here (its Manage switch on Harnesses is off), so nothing was changed there.';
    const install = await box.markets.install(root, 'team', 'pdf', ['claude-cli', 'codex-cli'], box.home);
    const update = await box.markets.update(root, 'team', 'pdf', ['codex-cli'], box.home);
    const uninstall = await box.markets.uninstall(root, 'team', 'pdf', 'codex-cli', box.home);
    const whole = await box.markets.setWhole(root, 'team', 'pdf', 'codex-cli', false, box.home);
    const skill = await box.markets.setSkill(root, 'team', 'pdf', 'pdf', 'codex-cli', false, box.home);
    const part = await box.markets.setPart(root, 'team', 'pdf', { kind: 'mcp', name: 'docs' }, 'codex-cli', false, box.home);
    for (const done of [install, update, uninstall, whole, skill, part]) assert.deepEqual([done.stopped, done.reports], [words, []]);
    assert.deepEqual(box.calls.filter(call => call.includes('codex-cli')), [], 'no command ran for Codex');
    assert.match((await box.markets.addCarriedTo('codex-cli', box.home)).stopped ?? '', /^Codex is left out/);
  } finally { await box.cleanup(); }
  const pi = await setup({ pi: true, leftOut: ['pi-cli'] });
  try {
    const root = join(pi.base, 'market');
    await marketplace(root, 'team', ['pdf']);
    await pi.markets.add(root);
    const parts = await pi.markets.parts(root, 'team', 'pdf', 'pi-cli', 'install', undefined, pi.home);
    assert.deepEqual([parts.stopped, parts.reports], ['Pi is left out of Central Knot here (its Manage switch on Harnesses is off), so nothing was changed there.', []]);
    assert.equal(await stat(join(pi.home, '.pi')).then(() => true, () => false), false, 'nothing was written in Pi');
  } finally { await pi.cleanup(); }
});

test('A carried marketplace addition queued before a tool is left out asks again at its turn, and writes nothing there', async () => {
  const leftOut: HarnessId[] = [];
  const box = await setup({ bundled: { folder: 'carried' }, codex: true, leftOut });
  try {
    await marketplace(join(box.base, 'carried'), 'team', ['pdf']);
    // The person turns Codex's Manage switch off while the addition waits for its turn in the queue.
    const turn = <T>(work: () => Promise<T>) => { leftOut.splice(0, leftOut.length, 'codex-cli'); return work(); };
    const reports = await box.markets.addCarried(['codex-cli'], turn);
    assert.deepEqual([reports, box.calls.filter(call => call.startsWith('list'))], [[], []]);
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

test('Claude Code’s copy of a plugin from the Anthropic Directory shows as installed there, and is left to Claude Code: no update, no uninstall', async () => {
  const box = await setup();
  try {
    const root = join(box.base, 'market');
    await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'official', plugins: [{ name: 'incident-io', version: '2.0.0', source: { source: 'git-subdir', url: 'https://github.com/incident-io/skills.git', path: 'plugins/incident-io' } }] }));
    await box.markets.add(root);
    const copy = join(box.home, '.claude/plugins/cache/anthropic-plugin-directory/incident-io/1.0.0-6af50e2e23e9');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'incident-io', version: '1.0.0' }));
    await put(join(copy, 'skills/incidents/SKILL.md'), '---\nname: incidents\ndescription: Incidents.\n---\n');
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'incident.io@anthropic-plugin-directory': [{ scope: 'user', installPath: copy, version: '1.0.0-6af50e2e23e9', gitCommitSha: '6af50e2e23e9c782b95a456aab5a053550fba3c9', directoryRepositoryKey: 'github.com/incident-io/skills#plugins/incident-io' }] } }));
    const view = await box.markets.view();
    const entry = view.marketplaces.find(candidate => candidate.name === 'official')!;
    assert.deepEqual(entry.states['incident-io']?.['claude-cli'], { state: 'installed', path: copy, version: '1.0.0', directory: 'incident.io@anthropic-plugin-directory' });
    assert.deepEqual(entry.states['incident-io']?.['copilot-cli'], { state: 'not-installed' }, 'only Claude Code reads the directory');
    // An older version than the marketplace's, yet nothing is due: Claude Code keeps its directory copy.
    assert.deepEqual((await box.markets.pendingUpdates(box.home)).ops, []);
    assert.deepEqual(Object.keys((await box.markets.detail(root, 'incident-io'))?.installed ?? {}), ['claude-cli'], 'its copy’s contents are read');
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

test('A tool’s own marketplace is suggested where that tool is here, until it is listed or declined; a build that carries a marketplace suggests none', async () => {
  const box = await setup();
  try {
    await marketplace(join(box.base, 'offered'), 'offered', ['pdf']);
    // Offered for the tools here it belongs to; one for no tool here is not offered. Nothing was read to offer it.
    assert.deepEqual((await box.markets.view()).suggested, [{ source: join(box.base, 'offered'), name: 'Offered', tools: ['claude-cli', 'codex-cli'] }]);
    assert.deepEqual(box.calls, []);
    // Added: it is a marketplace on the list now, so it is no longer a suggestion. Removed from the list: offered again.
    await box.markets.add(join(box.base, 'offered'));
    assert.deepEqual((await box.markets.view()).suggested, []);
    assert.equal((await box.markets.forget(join(box.base, 'offered'))).suggested?.length, 1);
    // Declined: not offered again, also by a later read.
    assert.deepEqual((await box.markets.decline(join(box.base, 'offered'))).suggested, []);
    assert.deepEqual((await box.markets.view(true)).suggested, []);
    // Its Undo: offered again.
    assert.equal((await box.markets.decline(join(box.base, 'offered'), true)).suggested?.length, 1);
  } finally { await box.cleanup(); }
  const carried = await setup({ bundled: { folder: 'carried', unpackaged: [] } });
  try {
    await marketplace(join(carried.base, 'carried'), 'carried', ['pdf']);
    assert.deepEqual((await carried.markets.view()).suggested, []);
  } finally { await carried.cleanup(); }
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
    // The plugins record was made by that read (its first): every tool here is on its `tools`, so nothing is owed by itself.
    assert.deepEqual([due.ops.filter(op => op.newHere), due.newTools], [[], []]);
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

// ---------- A whole plugin's one switch (pluginrecord.ts), through createMarketplaces with the engine replaced ----------

/**
 * A home with Claude Code and Pi (unless `tools` says otherwise), where Claude Code installs for real as far as its records go:
 * the stand-in install writes its install record and copy (and the stand-in uninstall takes them out), so each look after a
 * click reads what the click did. Pi takes parts through the real parts.ts. The marketplace has pdf and notes (a skill each)
 * and reviewer (an agent alone, which Pi can't take).
 */
async function switchHome(options: Parameters<typeof setup>[0] = {}) {
  let box!: Awaited<ReturnType<typeof setup>>;
  const listed = async () => (JSON.parse(await readFile(join(box.home, '.claude/plugins/installed_plugins.json'), 'utf8').catch(() => '{"plugins":{}}')) as { plugins: Record<string, unknown> }).plugins;
  const write = async (plugins: Record<string, unknown>) => put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  box = await setup({ pi: true, tools: ['claude-cli', 'pi-cli'], ...options, engine: {
    install: async (_context, catalog, plugin, tool) => {
      box.calls.push(`install ${plugin} ${tool}`);
      const copy = join(box.home, '.claude/plugins/cache', catalog.name, plugin, '1.0.0');
      await put(join(copy, `skills/${plugin}/SKILL.md`), `---\nname: ${plugin}\ndescription: ${plugin}\n---\n`);
      await write({ ...await listed(), [`${plugin}@${catalog.name}`]: [{ scope: 'user', installPath: copy, version: '1.0.0' }] });
      return { tool, outcome: 'installed', message: 'Installed.', runs: [], changed: true };
    },
    uninstall: async (_context, marketplace, plugin, tool) => {
      box.calls.push(`uninstall ${plugin} ${tool}`);
      const { [`${plugin}@${marketplace}`]: _gone, ...rest } = await listed();
      await write(rest);
      return { tool, outcome: 'uninstalled', message: 'Uninstalled.', runs: [], changed: true };
    },
    ...options.engine,
  } });
  const root = join(box.base, 'market');
  await marketplace(root, 'team', ['pdf', 'notes']);
  await addAgentOnly(root);
  await box.markets.add(root);
  // Claude Code names the marketplace's source, as its own add records it.
  await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'git', url: root } } }));
  const record = async () => JSON.parse(await readFile(join(box.home, '.central-knot/plugins.json'), 'utf8')) as { tools: HarnessId[]; plugins: { plugin: string; on: boolean; except: HarnessId[] }[] };
  const switchOf = async (plugin: string) => (await box.markets.view()).marketplaces.find(entry => entry.source === root)!.switches![plugin]!;
  const acts = async (plugin: string) => Object.fromEntries(Object.entries((await switchOf(plugin)).tools).map(([tool, owed]) => [tool, owed!.act ?? owed!.held ?? '']));
  return { ...box, root, record, switchOf, acts, piSkill: (plugin: string) => join(box.home, `.pi/agent/skills/${plugin}/SKILL.md`) };
}
const exists = (path: string) => stat(path).then(() => true, () => false);
/** Adds reviewer, a plugin holding one agent alone, to the marketplace at `root`. */
async function addAgentOnly(root: string) {
  const manifest = join(root, '.claude-plugin/marketplace.json'), read = JSON.parse(await readFile(manifest, 'utf8'));
  await put(manifest, JSON.stringify({ ...read, plugins: [...read.plugins, { name: 'reviewer', source: './plugins/reviewer' }] }));
  await put(join(root, 'plugins/reviewer/agents/reviewer.md'), '---\nname: reviewer\ndescription: Reviews.\n---\nReview the diff.\n');
}

test('On puts a plugin into every managed tool that takes it, by its route; a tool where it can’t go is said, and nothing runs there; Off takes it out of each', async () => {
  const box = await switchHome();
  try {
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    const on = await box.markets.turn(box.root, 'pdf', 'on', undefined, box.home);
    assert.deepEqual(box.calls.filter(call => /^(install|uninstall)/.test(call)), ['install pdf claude-cli'], 'Claude Code by its own installer');
    assert.equal(await exists(box.piSkill('pdf')), true, 'Pi by its parts');
    assert.deepEqual(on.done.map(step => [step.tool, step.action, step.report.outcome]), [['claude-cli', 'install', 'installed'], ['pi-cli', 'install-parts', 'installed']]);
    assert.deepEqual((await box.record()).plugins.map(entry => [entry.plugin, entry.on, entry.except]), [['pdf', true, []]]);
    assert.deepEqual(await box.acts('pdf'), { 'claude-cli': '', 'pi-cli': '' }, 'in line in both');
    // reviewer holds an agent alone, which Pi takes no part of: said, and nothing runs there.
    const agent = await box.markets.turn(box.root, 'reviewer', 'on', undefined, box.home);
    assert.deepEqual(agent.done.map(step => [step.tool, step.report.outcome, step.report.message]), [['claude-cli', 'installed', 'Installed.'], ['pi-cli', 'held', 'None of its parts can go into Pi.']]);
    const off = await box.markets.turn(box.root, 'pdf', 'off', undefined, box.home);
    assert.deepEqual(off.done.filter(step => step.report.changed).map(step => [step.tool, step.action]), [['claude-cli', 'remove'], ['pi-cli', 'remove-parts']]);
    assert.equal(await exists(box.piSkill('pdf')), false);
    assert.deepEqual([(await box.record()).plugins.find(entry => entry.plugin === 'pdf')!.on, await box.acts('pdf')], [false, { 'claude-cli': '', 'pi-cli': '' }]);
  } finally { await box.cleanup(); }
});

test('Keep out takes it out of that tool alone and records it; the switch then shows it partial; Let in puts it back there', async () => {
  const box = await switchHome();
  try {
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    await box.markets.turn(box.root, 'pdf', 'on', undefined, box.home);
    box.calls.length = 0;
    const out = await box.markets.turn(box.root, 'pdf', 'keep-out', 'pi-cli', box.home);
    assert.deepEqual([out.done.map(step => [step.tool, step.action]), box.calls.filter(call => /^(install|uninstall)/.test(call))], [[['pi-cli', 'remove-parts']], []]);
    assert.deepEqual([(await box.record()).plugins[0]!.except, await exists(box.piSkill('pdf'))], [['pi-cli'], false]);
    const sw = await box.switchOf('pdf');
    assert.deepEqual([sw.entry, sw.tools['pi-cli']!.wanted, sw.tools['claude-cli']!.wanted], [{ on: true, except: ['pi-cli'] }, false, true]);
    await box.markets.turn(box.root, 'pdf', 'let-in', 'pi-cli', box.home);
    assert.deepEqual([(await box.record()).plugins[0]!.except, await exists(box.piSkill('pdf'))], [[], true]);
    // Kept out again and turned off; then its parts put into Pi outside the switch. On puts it where it is wanted and takes
    // nothing out: Pi's copy stays, shown with Turn off there.
    await box.markets.turn(box.root, 'pdf', 'keep-out', 'pi-cli', box.home);
    await box.markets.turn(box.root, 'pdf', 'off', undefined, box.home);
    await box.markets.parts(box.root, 'team', 'pdf', 'pi-cli', 'install', undefined, box.home);
    const on = await box.markets.turn(box.root, 'pdf', 'on', undefined, box.home);
    assert.deepEqual([on.done.map(step => [step.tool, step.action]), await exists(box.piSkill('pdf')), (await box.acts('pdf'))['pi-cli']], [[['claude-cli', 'install']], true, 'remove-parts']);
  } finally { await box.cleanup(); }
});

test('Off, then Undo: installed again where it was, a copy that was off in a tool’s own settings off again there, and the record On', async () => {
  const box = await switchHome();
  try {
    await box.markets.turn(box.root, 'pdf', 'on', undefined, box.home);
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'pdf@team': false } }));
    const off = await box.markets.turn(box.root, 'pdf', 'off', undefined, box.home);
    assert.deepEqual(off.back?.map(op => [op.tool, op.action]), [['pi-cli', 'undo-parts'], ['claude-cli', 'install'], ['claude-cli', 'plugin-off']], 'Claude Code’s own switch comes back off after its install');
    box.calls.length = 0;
    const undone = await box.markets.undoTurn(box.root, 'pdf', off.before!, off.back!, box.home);
    assert.deepEqual(box.calls.filter(call => /^(install|uninstall|whole)/.test(call)), ['install pdf claude-cli', 'whole pdf@team claude-cli false']);
    assert.deepEqual([undone.stopped, (await box.record()).plugins.map(entry => [entry.on, entry.except])], [undefined, [[true, []]]]);
  } finally { await box.cleanup(); }
});

test('On over a plugin some tools still have (Off, its uninstall undone by hand), then Undo: only what the click put in comes out, and the record is as before', async () => {
  const box = await switchHome();
  try {
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    await box.markets.turn(box.root, 'pdf', 'on', undefined, box.home);
    await box.markets.turn(box.root, 'pdf', 'off', undefined, box.home);
    // Put back in Claude Code with its own command: Off, but Claude Code has it.
    await box.markets.install(box.root, 'team', 'pdf', ['claude-cli'], box.home);
    assert.deepEqual((await box.acts('pdf'))['claude-cli'], 'uninstall', 'shown so, with a way to turn it off there');
    const before = await box.record();
    box.calls.length = 0;
    const on = await box.markets.turn(box.root, 'pdf', 'on', undefined, box.home);
    assert.deepEqual(on.done.filter(step => step.report.changed).map(step => step.tool), ['pi-cli'], 'Claude Code has it already: only Pi');
    await box.markets.undoTurn(box.root, 'pdf', on.before!, on.back!, box.home);
    assert.deepEqual([box.calls.filter(call => /^(install|uninstall)/.test(call)), await exists(box.piSkill('pdf')), await box.record()], [[], false, before]);
    assert.equal((await box.switchOf('pdf')).tools['claude-cli']!.has, 'whole', 'Claude Code keeps the copy it had before the click');
  } finally { await box.cleanup(); }
});

test('A plugin installed in a tool with no entry here is found: nothing takes it in by itself, and Add turns it On and puts it where it is missing', async () => {
  const box = await switchHome();
  try {
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    await box.markets.view();
    // Installed by hand in Claude Code after the plugins record was made.
    await box.markets.install(box.root, 'team', 'notes', ['claude-cli'], box.home);
    const sw = await box.switchOf('notes');
    assert.deepEqual([sw.entry, sw.tools['claude-cli']!.has, sw.tools['pi-cli']!.act], [undefined, 'whole', undefined]);
    assert.deepEqual((await box.markets.pendingUpdates(box.home)).ops.filter(op => op.plugin === 'notes'), [], 'the automatic updates leave it alone');
    const added = await box.markets.turn(box.root, 'notes', 'add', undefined, box.home);
    assert.deepEqual([added.done.filter(step => step.report.changed).map(step => step.tool), added.before], [['pi-cli'], null]);
    await box.markets.undoTurn(box.root, 'notes', added.before!, added.back!, box.home);
    assert.deepEqual([(await box.record()).plugins.some(entry => entry.plugin === 'notes'), await exists(box.piSkill('notes'))], [false, false]);
  } finally { await box.cleanup(); }
});

test('A tool new here is owed each On plugin not kept out of it by the automatic updates, and joins the record’s tools; one already there is not owed what was taken out of it by hand', async () => {
  const tools: HarnessId[] = ['claude-cli'];
  const box = await switchHome({ tools });
  try {
    await box.markets.turn(box.root, 'pdf', 'on', undefined, box.home);
    await box.markets.turn(box.root, 'notes', 'on', undefined, box.home);
    // Taken out of Claude Code with its own /plugin: the check puts nothing back; its line offers Install there (worked example 5a).
    await box.markets.uninstall(box.root, 'team', 'pdf', 'claude-cli', box.home);
    // Pi is installed later, and notes kept out of it before any check.
    tools.push('pi-cli');
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    await box.markets.turn(box.root, 'notes', 'keep-out', 'pi-cli', box.home);
    const due = await box.markets.pendingUpdates(box.home);
    assert.deepEqual([due.ops.filter(op => op.newHere).map(op => [op.plugin, op.tool, op.action]), due.newTools], [[['pdf', 'pi-cli', 'install-parts']], ['pi-cli']]);
    const pdf = (await box.switchOf('pdf')).tools['claude-cli']!;
    assert.deepEqual([pdf.act, pdf.background], ['install', undefined]);
    await box.markets.noteJoined(['pi-cli'], box.home);
    assert.deepEqual((await box.record()).tools, ['claude-cli', 'pi-cli']);
    assert.deepEqual((await box.markets.pendingUpdates(box.home)).ops.filter(op => op.newHere), [], 'once on the list, nothing is owed to Pi by itself');
    // Its Manage switch turned off and on: new again.
    await box.markets.toolManaged('pi-cli', box.home);
    assert.deepEqual((await box.markets.pendingUpdates(box.home)).newTools, ['pi-cli']);
  } finally { await box.cleanup(); }
});

test('A first read made while the marketplace couldn’t be read gives the answer a read online gives: the next check owes nothing (worked example 5b)', async () => {
  const box = await switchHome();
  try {
    await box.markets.install(box.root, 'team', 'pdf', ['claude-cli'], box.home);
    // A home with no plugins record yet (one the version before made), opened while its marketplace can't be read.
    await rm(join(box.home, '.central-knot/plugins.json'));
    await rm(box.root, { recursive: true });
    const offline = await box.markets.view();
    assert.match(offline.marketplaces.find(entry => entry.source === box.root)!.problem ?? '', /./);
    assert.deepEqual((await box.record()).plugins.map(entry => [entry.plugin, entry.on, entry.except]), [['pdf', true, ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']]]);
    const sw = offline.marketplaces.find(entry => entry.source === box.root)!.switches!.pdf!;
    assert.deepEqual([sw.tools['claude-cli']!.has, sw.tools['claude-cli']!.act], ['whole', undefined], 'still installed in Claude Code, read by its record');
    await marketplace(box.root, 'team', ['pdf', 'notes']);
    assert.deepEqual((await box.markets.pendingUpdates(box.home)).ops, []);
  } finally { await box.cleanup(); }
});

test('A tool record that can’t be read is unknown, not empty: the first read waits, nothing is written, and it runs once the record reads', async () => {
  const box = await switchHome({ tools: ['claude-cli', 'codex-cli', 'pi-cli'] });
  try {
    await box.markets.install(box.root, 'team', 'pdf', ['claude-cli'], box.home);
    await rm(join(box.home, '.central-knot/plugins.json'));
    await put(join(box.home, '.codex/config.toml'), '[plugins."pdf@team"\nenabled = true\n');
    const waiting = await box.markets.view();
    assert.match(waiting.switchProblem ?? '', /^Codex’s record of its plugins can’t be read now/);
    assert.equal(await exists(join(box.home, '.central-knot/plugins.json')), false);
    assert.match((await box.markets.turn(box.root, 'pdf', 'off', undefined, box.home)).stopped ?? '', /can’t be read now/);
    await put(join(box.home, '.codex/config.toml'), 'model = "o4"\n');
    assert.equal((await box.markets.view()).switchProblem, undefined);
    assert.deepEqual((await box.record()).plugins.map(entry => [entry.plugin, entry.except]), [['pdf', ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']]]);
  } finally { await box.cleanup(); }
});

test('Off reaches nothing it must not: a tool left out, Claude Code’s copy from the Anthropic Directory and a same-named marketplace from elsewhere are said, and nothing runs there', async () => {
  const box = await setup({ leftOut: ['codex-cli'], tools: ['claude-cli', 'copilot-cli'] });
  try {
    const root = join(box.base, 'market');
    await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'official', plugins: [{ name: 'incident-io', version: '2.0.0', source: { source: 'git-subdir', url: 'https://github.com/incident-io/skills.git', path: 'plugins/incident-io' } }] }));
    await box.markets.add(root);
    const copy = join(box.home, '.claude/plugins/cache/anthropic-plugin-directory/incident-io/1.0.0-6af50e2e23e9');
    await put(join(copy, 'skills/incidents/SKILL.md'), '---\nname: incidents\ndescription: Incidents.\n---\n');
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'incident.io@anthropic-plugin-directory': [{ scope: 'user', installPath: copy, version: '1.0.0', directoryRepositoryKey: 'github.com/incident-io/skills#plugins/incident-io' }] } }));
    await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ extraKnownMarketplaces: { official: { source: { source: 'git', url: 'https://example.com/other.git' } } } }));
    // Not recorded by the first read (the Directory's copy is no marketplace's), so On records it; it has it in Claude Code already.
    await box.markets.turn(root, 'incident-io', 'on', undefined, box.home);
    const tools = Object.keys((await box.markets.view()).marketplaces.find(entry => entry.source === root)!.switches!['incident-io']!.tools);
    assert.deepEqual(tools, ['claude-cli', 'copilot-cli'], 'Codex is left out: no line, so no command');
    box.calls.length = 0;
    const off = await box.markets.turn(root, 'incident-io', 'off', undefined, box.home);
    assert.deepEqual(box.calls.filter(call => /^(install|uninstall)/.test(call)), [], 'nothing ran');
    assert.deepEqual(off.done.map(step => [step.tool, step.report.outcome, step.report.message]), [
      ['claude-cli', 'held', 'Claude Code has its copy from the Anthropic Directory: update or uninstall it in Claude Code (/plugin).'],
      ['copilot-cli', 'held', 'Copilot CLI has a different marketplace named “official” (https://example.com/other.git). Central Knot leaves it alone.']]);
    assert.equal(JSON.parse(await readFile(join(box.home, '.central-knot/plugins.json'), 'utf8')).plugins[0].on, false, 'the record is Off');
  } finally { await box.cleanup(); }
});

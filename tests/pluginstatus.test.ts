import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FROM_DIRECTORY, blocked, cantUninstall, partsOffer, removableTools, comparableText, copiesToCompare, copyStale, installsIn, limitNote, offeredVersion, partStillIn, pluginPlace, otherVersions, otherVersionsLine, toolsWithoutPlugin, unavailable, updateTools } from '../src/pluginstatus.ts';
import { readInTurn, readInto, type Read } from '../src/reads.ts';
import type { HomeView, MarketplaceView, PluginDetail, PluginsView } from '../src/types.ts';

const entry: MarketplaceView = { source: 'a/b', origins: ['central-knot'], name: 'm', kind: 'git', sourceLabel: 'GitHub: a/b', plugins: [{ name: 'p', description: '' }],
  states: { p: { 'claude-cli': { state: 'installed', path: '/x' }, 'codex-cli': { state: 'held', reason: 'other' } } } };
const view: PluginsView = { home: '/h', tools: ['claude-cli', 'copilot-cli', 'codex-cli'], clis: { 'claude-cli': true, 'copilot-cli': true, 'codex-cli': true }, canWrite: true, marketplaces: [entry] };

test('A tool can take a plugin only when its CLI is there, it is not held or refused, and it is not installed yet', () => {
  assert.deepEqual(toolsWithoutPlugin(view, entry, 'p'), ['copilot-cli']);
  assert.match(blocked({ ...view, clis: {} }, entry, 'claude-cli') ?? '', /command-line tool wasn’t found/);
  assert.match(blocked({ ...view, clis: {}, desktopOnly: { 'claude-cli': 'Claude desktop' } }, entry, 'claude-cli') ?? '', /^Only Claude desktop was found here, and the copy of Claude Code it carries isn’t there yet \(the app adds it once it has run\). Claude Code’s command-line tool wasn’t found either.$/);
  assert.equal(blocked(view, { ...entry, copilotRefuses: 'Copilot refuses npm.' }, 'copilot-cli'), 'Copilot refuses npm.');
  assert.deepEqual(toolsWithoutPlugin(view, { ...entry, copilotRefuses: 'x' }, 'p'), []);
  // One answer for every box, panel and key: held says why, installed is never unavailable, a missing CLI is.
  assert.equal(unavailable(view, entry, 'p', 'codex-cli'), 'other');
  assert.equal(unavailable({ ...view, clis: {} }, entry, 'p', 'claude-cli'), undefined);
  assert.match(unavailable({ ...view, clis: {} }, entry, 'p', 'copilot-cli') ?? '', /wasn’t found/);
});

test('Only a known version that names another release is a difference', () => {
  const states = (claude?: string, codex?: string): MarketplaceView => ({ ...entry, states: { p: { 'claude-cli': { state: 'installed', path: '/x', version: claude }, 'codex-cli': { state: 'installed', path: '/y', version: codex } } } });
  // Codex names its copy with a commit after the version; a "v" or build suffix is the same release.
  assert.deepEqual(otherVersions(view, states('v1.2.0', '1.2.0-77c10e110b37'), 'p', '1.2.0'), []);
  assert.deepEqual(otherVersions(view, states('1.1.0', '1.2.0+build.5'), 'p', '1.2.0'), [{ tool: 'claude-cli', version: '1.1.0' }]);
  // A pre-release is another release; an unknown version on either side is not a difference.
  assert.deepEqual(otherVersions(view, states('1.2.0-beta', undefined), 'p', '1.2.0'), [{ tool: 'claude-cli', version: '1.2.0-beta' }]);
  assert.deepEqual(otherVersions(view, states('1.1.0'), 'p', undefined), []);
  // The list row names tools by version, each version kept with the word before it.
  assert.equal(otherVersionsLine(otherVersions(view, states('1.1.0', '1.1.0'), 'p', '1.2.0')), 'Claude Code and Codex have\u00a01.1.0');
  // Once a plugin's own files are read, their version (plugin.json's) is the one offered, not the catalog entry's.
  assert.equal(offeredVersion({ name: 'p', description: '', version: '1.0.0' }, { version: '1.1.0' } as PluginDetail), '1.1.0');
  // A copy checked out with Windows line endings is the same text.
  assert.equal(comparableText('---\r\nname: s\r\n'), comparableText('---\nname: s\n'));
});

test('Update is offered only where a tool’s copy is older and can be changed here', () => {
  const at = (states: MarketplaceView['states']['p']): MarketplaceView => ({ ...entry, states: { p: states } });
  const copies = at({ 'claude-cli': { state: 'installed', path: '/x', version: '1.9.0' }, 'copilot-cli': { state: 'installed', path: '/y', version: '2.1.0' }, 'codex-cli': { state: 'installed', path: '/z', version: '1.0.0', live: true } });
  // Claude Code is behind; Copilot CLI is ahead of the marketplace; Codex loads it live from the folder.
  assert.deepEqual(updateTools(view, copies, 'p', '2.0.0').plugin, ['claude-cli']);
  assert.deepEqual(updateTools({ ...view, clis: { 'copilot-cli': true } }, copies, 'p', '2.0.0').plugin, [], 'no CLI to run it');
  assert.deepEqual(updateTools(view, copies, 'p', undefined).plugin, [], 'nothing to compare with');
  // Claude Code's copy from the Anthropic Directory is installed, and left to Claude Code: behind or not, no Update, no Uninstall.
  const directory = at({ 'claude-cli': { state: 'installed', path: '/x', version: '1.9.0', directory: 'p@anthropic-plugin-directory' } });
  assert.deepEqual([updateTools(view, directory, 'p', '2.0.0').plugin, removableTools(view, directory, 'p'), toolsWithoutPlugin(view, directory, 'p')], [[], [], ['copilot-cli', 'codex-cli']]);
  assert.equal(cantUninstall(view, directory, 'p', 'claude-cli'), FROM_DIRECTORY);
  assert.deepEqual(copiesToCompare(view, directory), [], 'its files aren’t compared with the marketplace’s');
});

test('A copy at the marketplace’s version whose text differs is offered Update once its files are read; line endings and parts only one side has are no difference', () => {
  const part = (text: string, path = 'skills/one') => ({ name: 'one', description: '', text, path });
  const copies = { ...entry, states: { p: { 'claude-cli': { state: 'installed' as const, path: '/x', version: '1.2.0' }, 'copilot-cli': { state: 'installed' as const, path: '/y', version: '1.2.0' }, 'codex-cli': { state: 'installed' as const, path: '/z', version: '1.2.0', live: true } } } };
  const detail = { skills: [part('---\nname: one\n---\nB\n')], commands: [], agents: [], hooks: [], mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false, offered: true,
    installed: { 'claude-cli': { skills: [part('---\nname: one\n---\nA\n')], commands: [], agents: [], version: '1.2.0' }, 'copilot-cli': { skills: [part('---\r\nname: one\r\n---\r\nB\r\n'), part('extra', 'skills/two')], commands: [], agents: [], version: '1.2.0' },
      'codex-cli': { skills: [part('A')], commands: [], agents: [], version: '1.2.0' } } } as PluginDetail;
  // Claude Code's text differs; Copilot CLI's differs only in line endings and holds an extra part; Codex loads it live.
  assert.deepEqual(updateTools(view, copies, 'p', '1.2.0', undefined, detail).plugin, ['claude-cli']);
  assert.equal(copyStale(copies, 'p', 'claude-cli', '1.2.0', detail), true);
  assert.deepEqual(updateTools(view, copies, 'p', '1.2.0').plugin, [], 'not known before its files are read');
  assert.deepEqual(updateTools(view, copies, 'p', '1.2.0', undefined, { ...detail, offered: false }).plugin, [], 'nor without the marketplace’s own copy');
  assert.equal(copyStale(copies, 'p', 'claude-cli', '1.3.0', detail), false, 'another version is told by its version, not its content');
});

test('A tool’s limits are named in a few words', () => {
  assert.equal(limitNote([{ component: 'Skills', result: 'works', text: '' }]), '');
  assert.equal(limitNote([{ component: 'Agents', result: 'ignored', text: 'are ignored: copied, never offered' }, { component: 'MCP servers', result: 'fails', text: '' }]), 'Agents are ignored +1');
  assert.equal(limitNote([{ component: 'Commands', result: 'limited', text: 'are turned into skills when installed' }]), 'Commands limited');
});

test('A background read is kept only while its own placeholder is still there', async () => {
  const map = new Map<string, Read<string>>();
  let release: (value: string) => void = () => {};
  let done = 0;
  readInto(map, 'k', () => new Promise<string>(resolve => { release = resolve; }), () => { done++; });
  readInto(map, 'k', async () => 'second', () => { done++; });
  assert.deepEqual(map.get('k'), { reading: true }, 'a read already under way is not started twice');
  map.clear();
  release('old');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(map.has('k'), false, 'a cleared map is not refilled by a stale answer');
  assert.equal(done, 0);
  readInto(map, 'k', async () => 'fresh', () => { done++; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(map.get('k'), { reading: false, value: 'fresh' });
  assert.equal(done, 1);
});

test('The list compares the files of plugins some tool has installed, a few at a time, each once', async () => {
  const listed: MarketplaceView = { ...entry, plugins: ['p', 'q', 'r', 's'].map(name => ({ name, description: '' })), states: {
    p: { 'claude-cli': { state: 'installed', path: '/x' } }, q: { 'codex-cli': { state: 'installed', path: '/y', live: true } }, r: { 'codex-cli': { state: 'held', reason: 'other' } }, s: {} } };
  // Only p: q is loaded live from its folder (never stale), r is another marketplace's, s isn't installed.
  assert.deepEqual(copiesToCompare(view, listed), ['p']);
  const map = new Map<string, Read<string>>();
  const releases = new Map<string, () => void>();
  let landed = 0;
  const turn = readInTurn(map, 2, () => { landed++; });
  const read = (key: string) => [key, () => new Promise<string>(resolve => releases.set(key, () => resolve(key)))] as [string, () => Promise<string>];
  map.set('known', { reading: false, value: 'kept' });
  turn.set([read('known'), read('a'), read('b'), read('c'), read('d')]);
  assert.deepEqual([...releases.keys()], ['a', 'b'], 'two at a time; one already read is not read again');
  assert.deepEqual(map.get('a'), { reading: true, quiet: true }, 'nothing on screen says it is reading');
  assert.equal(map.has('c'), false, 'one waiting has no placeholder yet');
  // A new list replaces what waits (c and d), and a read still under way carries on.
  turn.set([read('e')]);
  releases.get('a')!();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual([...releases.keys()], ['a', 'b', 'e']);
  assert.deepEqual(map.get('a'), { reading: false, value: 'a' });
  // A read whose placeholder went (a new view) is dropped when it lands.
  map.delete('b');
  releases.get('b')!();
  releases.get('e')!();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(map.has('b'), false);
  assert.equal(landed, 2);
});

test('A tool\'s installs say what is installed, what could not be checked and which marketplace could not be read', () => {
  const unsure: MarketplaceView = { ...entry, plugins: [{ name: 'p', description: '' }, { name: 'q', description: '' }], states: { p: { 'claude-cli': { state: 'installed', path: '/x' } }, q: { 'claude-cli': { state: 'not-known', reason: 'Its files are missing.' } } } };
  const broken: MarketplaceView = { ...entry, name: 'gone', plugins: [], states: {}, problem: 'Could not be reached.' };
  const installs = installsIn({ ...view, marketplaces: [unsure, broken] }, 'claude-cli')!;
  assert.deepEqual(installs.installed.map(({ plugin }) => plugin.name), ['p']);
  assert.deepEqual(installs.unknown.map(({ plugin, reason }) => [plugin.name, reason]), [['q', 'Its files are missing.']]);
  assert.deepEqual(installs.unreadable, ['gone']);
  assert.equal(installsIn(view, 'pi-cli'), null, 'a tool that takes no marketplace plugins');
});

test('A part removed from a tool by hand is no longer installed there; a kind the home does not read there still counts', () => {
  const facts = (key: string, tools: string[]) => ({ key, copies: Object.fromEntries(tools.map(tool => [tool, {}])) });
  const home = { manage: { tools: ['codex-cli', 'pi-cli'], skills: [facts('triage', ['codex-cli'])] }, mcp: { tools: ['codex-cli'], servers: [facts('issues', ['codex-cli'])] }, agents: { tools: [], items: [] } } as unknown as HomeView;
  assert.equal(partStillIn(home, 'codex-cli', { kind: 'skill', name: 'Triage' }), true);
  assert.equal(partStillIn(home, 'pi-cli', { kind: 'skill', name: 'triage' }), false);
  assert.equal(partStillIn(home, 'pi-cli', { kind: 'mcp', name: 'issues' }), true);
  assert.equal(partStillIn(home, 'codex-cli', { kind: 'agent', name: 'helper' }), true);
});

test('Claude Code is offered a plugin’s parts only when it has no CLI', () => {
  const fresh: MarketplaceView = { ...entry, states: {} };
  assert.equal(partsOffer(view, fresh, 'p', 'claude-cli'), false);
  assert.equal(partsOffer({ ...view, clis: { ...view.clis, 'claude-cli': false }, desktopOnly: { 'claude-cli': 'Claude desktop' } }, fresh, 'p', 'claude-cli'), true);
  // A plugin with only MCP servers has nothing Claude Code takes as parts.
  assert.equal(partsOffer({ ...view, clis: {} }, fresh, 'p', 'claude-cli', { skills: 0, commands: 0, agents: 0, hooks: false, mcp: 1, mcpRootVariable: false, bin: false }), false);
});

test('A plugin every tool that can take it has comes first, one some tool has next, one no tool has last', () => {
  const at = (states: MarketplaceView['states']['p'], more: Partial<MarketplaceView> = {}): MarketplaceView => ({ ...entry, ...more, states: { p: states } });
  const here = { state: 'installed', path: '/x' } as const;
  assert.equal(pluginPlace(view, at({}), 'p'), 2);
  assert.equal(pluginPlace(view, at({ 'claude-cli': here }), 'p'), 1);
  assert.equal(pluginPlace(view, at({ 'claude-cli': here, 'copilot-cli': here, 'codex-cli': here }), 'p'), 0);
  // A tool that can't take it (Copilot refuses the marketplace, or holds another of this name) doesn't keep it from the top.
  assert.equal(pluginPlace(view, at({ 'claude-cli': here, 'codex-cli': here }, { copilotRefuses: 'Copilot refuses npm.' }), 'p'), 0);
  assert.equal(pluginPlace(view, at({ 'claude-cli': here, 'copilot-cli': here, 'codex-cli': { state: 'held', reason: 'other' } }), 'p'), 0);
  // Parts in a tool that takes no plugins count as having it; without them that tool is no reason to wait.
  const withPi: PluginsView = { ...view, tools: [...view.tools, 'pi-cli'] };
  assert.equal(pluginPlace(withPi, at({ 'claude-cli': here, 'copilot-cli': here, 'codex-cli': here }), 'p'), 0);
  assert.equal(pluginPlace(withPi, at({}, { parts: { p: { 'pi-cli': { at: '2026-11-10T00:00:00Z', items: [] } } } }), 'p'), 1);
});

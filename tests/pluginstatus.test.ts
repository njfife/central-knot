import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocked, installsIn, limitNote, toolsWithoutPlugin, unavailable } from '../src/pluginstatus.ts';
import { readInto, type Read } from '../src/reads.ts';
import type { MarketplaceView, PluginsView } from '../src/types.ts';

const entry: MarketplaceView = { source: 'a/b', origins: ['central-knot'], name: 'm', kind: 'git', sourceLabel: 'GitHub: a/b', plugins: [{ name: 'p', description: '' }],
  states: { p: { 'claude-cli': { state: 'installed', path: '/x' }, 'codex-cli': { state: 'held', reason: 'other' } } } };
const view: PluginsView = { home: '/h', tools: ['claude-cli', 'copilot-cli', 'codex-cli'], clis: { 'claude-cli': true, 'copilot-cli': true, 'codex-cli': true }, canWrite: true, marketplaces: [entry] };

test('A tool can take a plugin only when its CLI is there, it is not held or refused, and it is not installed yet', () => {
  assert.deepEqual(toolsWithoutPlugin(view, entry, 'p'), ['copilot-cli']);
  assert.match(blocked({ ...view, clis: {} }, entry, 'claude-cli') ?? '', /command-line tool wasn’t found/);
  assert.match(blocked({ ...view, clis: {}, desktopOnly: ['codex-cli'] }, entry, 'codex-cli') ?? '', /Only ChatGPT desktop/);
  assert.equal(blocked(view, { ...entry, copilotRefuses: 'Copilot refuses npm.' }, 'copilot-cli'), 'Copilot refuses npm.');
  assert.deepEqual(toolsWithoutPlugin(view, { ...entry, copilotRefuses: 'x' }, 'p'), []);
  // One answer for every box, panel and key: held says why, installed is never unavailable, a missing CLI is.
  assert.equal(unavailable(view, entry, 'p', 'codex-cli'), 'other');
  assert.equal(unavailable({ ...view, clis: {} }, entry, 'p', 'claude-cli'), undefined);
  assert.match(unavailable({ ...view, clis: {} }, entry, 'p', 'copilot-cli') ?? '', /wasn’t found/);
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

test('A tool\'s installs say what is installed, what could not be checked and which marketplace could not be read', () => {
  const unsure: MarketplaceView = { ...entry, plugins: [{ name: 'p', description: '' }, { name: 'q', description: '' }], states: { p: { 'claude-cli': { state: 'installed', path: '/x' } }, q: { 'claude-cli': { state: 'not-known', reason: 'Its files are missing.' } } } };
  const broken: MarketplaceView = { ...entry, name: 'gone', plugins: [], states: {}, problem: 'Could not be reached.' };
  const installs = installsIn({ ...view, marketplaces: [unsure, broken] }, 'claude-cli')!;
  assert.deepEqual(installs.installed.map(({ plugin }) => plugin.name), ['p']);
  assert.deepEqual(installs.unknown.map(({ plugin, reason }) => [plugin.name, reason]), [['q', 'Its files are missing.']]);
  assert.deepEqual(installs.unreadable, ['gone']);
  assert.equal(installsIn(view, 'pi-cli'), null, 'a tool that takes no marketplace plugins');
});

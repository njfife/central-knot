import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocked, limitNote, missingTools, offeredVersion, otherVersions, otherVersionsLine, unavailable } from '../src/pluginstatus.ts';
import { readInto, type Read } from '../src/reads.ts';
import type { MarketplaceView, PluginDetail, PluginsView } from '../src/types.ts';

const entry: MarketplaceView = { source: 'a/b', origins: ['central-knot'], name: 'm', kind: 'git', sourceLabel: 'GitHub: a/b', plugins: [{ name: 'p', description: '' }],
  states: { p: { 'claude-cli': { state: 'installed', path: '/x' }, 'codex-cli': { state: 'held', reason: 'other' } } } };
const view: PluginsView = { home: '/h', tools: ['claude-cli', 'copilot-cli', 'codex-cli'], clis: { 'claude-cli': true, 'copilot-cli': true, 'codex-cli': true }, canWrite: true, marketplaces: [entry] };

test('A tool can take a plugin only when its CLI is there, it is not held or refused, and it is not installed yet', () => {
  assert.deepEqual(missingTools(view, entry, 'p'), ['copilot-cli']);
  assert.match(blocked({ ...view, clis: {} }, entry, 'claude-cli') ?? '', /command-line tool wasn’t found/);
  assert.match(blocked({ ...view, clis: {}, desktopOnly: ['codex-cli'] }, entry, 'codex-cli') ?? '', /Only ChatGPT desktop/);
  assert.equal(blocked(view, { ...entry, copilotRefuses: 'Copilot refuses npm.' }, 'copilot-cli'), 'Copilot refuses npm.');
  assert.deepEqual(missingTools(view, { ...entry, copilotRefuses: 'x' }, 'p'), []);
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

// A whole plugin's one switch: the table row by row (pluginrecord.ts owedTo, one worked example per row of its header), the
// first read that makes plugins.json from what the tools hold, and the file itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstRecord, owedTo, readPluginRecord, savePluginRecord, type Holding, type ToolNow } from '../src/pluginrecord.ts';
import type { HarnessId } from '../src/types.ts';

const on = { on: true, except: [] }, off = { on: false, except: [] };
const now = (has: ToolNow['has'], route: ToolNow['route'] = 'whole', stuck?: string): ToolNow => ({ has, route, ...(stuck ? { stuck } : {}) });
/** The table's answer for Codex, with Codex already on the home's `tools` unless `seen` says otherwise. */
const codex = (entry: Parameters<typeof owedTo>[0], tool: ToolNow, seen: HarnessId[] = ['codex-cli']) => owedTo(entry, 'codex-cli', tool, seen);

test('Row 1: a tool whose record of its plugins can’t be read owes nothing, whatever the switch says', () => {
  assert.deepEqual(codex(on, now('unknown')), { wanted: true, has: 'unknown', takes: true });
  assert.deepEqual(codex(off, now('unknown')), { wanted: false, has: 'unknown', takes: true });
});

test('Row 2: a plugin with no entry (found in a tool, or never turned on) owes nothing anywhere: its row offers Add', () => {
  assert.deepEqual(codex(undefined, now('whole')), { wanted: false, has: 'whole', takes: true });
  assert.deepEqual(codex(undefined, now('none')), { wanted: false, has: 'none', takes: true });
});

test('Rows 3 to 6: wanted (On, not kept out): in line where it is; installed by its route where it lacks it; held where it can’t go', () => {
  assert.deepEqual(codex(on, now('whole')), { wanted: true, has: 'whole', takes: true });
  assert.deepEqual(owedTo(on, 'pi-cli', now('parts', 'parts'), ['pi-cli']), { wanted: true, has: 'parts', takes: true });
  assert.deepEqual(codex(on, now('none')), { wanted: true, has: 'none', takes: true, act: 'install' });
  assert.deepEqual(owedTo(on, 'pi-cli', now('none', 'parts'), ['pi-cli']), { wanted: true, has: 'none', takes: true, act: 'install-parts' });
  assert.deepEqual(owedTo(on, 'copilot-cli', now('none', { cannot: 'Copilot CLI refuses this marketplace.' }), ['copilot-cli']), { wanted: true, has: 'none', takes: false, held: 'Copilot CLI refuses this marketplace.' });
});

test('An install is owed to the automatic updates only in a tool not on the home’s tools: one removed by hand in a tool already there waits for Install there', () => {
  assert.equal(codex(on, now('none'), ['claude-cli']).background, true, 'Codex is new here');
  assert.equal(codex(on, now('none'), ['claude-cli', 'codex-cli']).background, undefined, 'Codex has had it: taken out by hand since');
  assert.equal(codex({ on: true, except: ['codex-cli'] }, now('none'), ['claude-cli']).act, undefined, 'kept out of Codex: nothing at all');
});

test('Rows 7 to 10: not wanted (Off, or kept out): in line where it lacks it; uninstalled or its parts taken out where it has it; held where it can’t be taken out', () => {
  const kept = { on: true, except: ['codex-cli' as const] };
  assert.deepEqual(codex(off, now('none')), { wanted: false, has: 'none', takes: true });
  assert.deepEqual(owedTo(off, 'claude-cli', now('whole', 'whole', 'Claude Code has its copy from the Anthropic Directory.'), []), { wanted: false, has: 'whole', takes: true, held: 'Claude Code has its copy from the Anthropic Directory.' });
  assert.deepEqual(codex(kept, now('whole')), { wanted: false, has: 'whole', takes: true, act: 'uninstall' });
  assert.deepEqual(owedTo(off, 'pi-cli', now('parts', 'parts'), ['pi-cli']), { wanted: false, has: 'parts', takes: true, act: 'remove-parts' });
});

const team = '/markets/team';
const has = (tool: Holding['tool'], plugin: string, source = team): Holding => ({ tool, source, marketName: 'team', plugin });

test('The first read: a plugin every managed tool has is On everywhere; one some lack is kept out of every tool that lacks it, managed or not', () => {
  const record = firstRecord(['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'], [
    has('claude-cli', 'pdf'), has('copilot-cli', 'pdf'), has('codex-cli', 'pdf'), has('pi-cli', 'pdf'),
    has('claude-cli', 'notes'), has('pi-cli', 'notes'),
  ], []);
  assert.deepEqual(record.plugins.map(entry => [entry.plugin, entry.on, entry.except]), [
    ['pdf', true, []],
    ['notes', true, ['copilot-cli', 'codex-cli', 'opencode-cli']]]);
  assert.deepEqual(record.tools, ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli']);
  assert.deepEqual(record.plugins.map(entry => [entry.source, entry.marketName, typeof entry.id]), [[team, 'team', 'string'], [team, 'team', 'string']]);
});

test('The first read keeps a tool out of nothing an install waited for in the version before: that tool stays off `tools`, so the install still happens', () => {
  const record = firstRecord(['claude-cli', 'codex-cli'], [has('claude-cli', 'pdf')], [{ tool: 'codex-cli', source: `${team}/`, plugin: 'pdf' }]);
  assert.deepEqual(record.plugins.map(entry => [entry.plugin, entry.except]), [['pdf', ['copilot-cli', 'pi-cli', 'opencode-cli']]]);
  assert.deepEqual(record.tools, ['claude-cli']);
  assert.equal(owedTo(record.plugins[0], 'codex-cli', now('none'), record.tools).background, true);
});

test('The first read records only what a managed tool has, one entry per plugin however its marketplace is spelt', () => {
  const record = firstRecord(['claude-cli'], [has('claude-cli', 'pdf'), has('codex-cli', 'xlsx'), has('claude-cli', 'pdf', `${team}/`)], []);
  assert.deepEqual(record.plugins.map(entry => entry.plugin), ['pdf'], 'Codex is left out here: its plugin is not read');
});

test('plugins.json: none is no record; one damaged or newer stops writes; one saved reads back', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ck-pluginrecord-'));
  try {
    assert.deepEqual(await readPluginRecord(home), {});
    const record = firstRecord(['claude-cli'], [has('claude-cli', 'pdf')], []);
    await savePluginRecord(home, record);
    assert.deepEqual(await readPluginRecord(home), { record });
    await writeFile(join(home, '.central-knot/plugins.json'), '{ "formatVersion": 1, "tools": [], "plugins": [{ "id": 1 }] }');
    assert.match((await readPluginRecord(home)).problem ?? '', /damaged/);
    await writeFile(join(home, '.central-knot/plugins.json'), '{ "formatVersion": 2 }');
    assert.match((await readPluginRecord(home)).problem ?? '', /newer Central Knot/);
    await rm(join(home, '.central-knot/plugins.json'));
    await mkdir(join(home, '.central-knot/plugins.json'));
    assert.match((await readPluginRecord(home)).problem ?? '', /could not be read/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

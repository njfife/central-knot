import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoUpdates, retryAfter, type AutoUpdateHost, type DueUpdate, type UpdatesRecord } from '../src/pluginupdates.ts';
import type { ActionReport, HarnessId, PluginUpdatesView } from '../src/types.ts';

const HOUR = 60 * 60_000;
const due = (plugin: string, tool: HarnessId, action: DueUpdate['action'] = 'update', offered = '2.0.0'): DueUpdate => ({ source: '/market', marketName: 'team', plugin, tool, action, offered });

/** A stand-in app: what is due, what each tool answers (by `plugin tool`), the clock, and everything the updates said or saved. */
function setup(options: { on?: boolean; every?: number } = {}) {
  const box = {
    home: '/home/a' as string | undefined, on: options.on ?? true, clock: 1_000_000, due: [] as DueUpdate[], unread: [] as string[], stopped: undefined as string | undefined,
    answers: new Map<string, Partial<ActionReport>>(), calls: [] as string[], logs: [] as string[], said: [] as { view: PluginUpdatesView; news: boolean }[], saved: undefined as UpdatesRecord | undefined,
  };
  const report = (plugin: string, tool: HarnessId): ActionReport => ({ tool, outcome: 'updated', changed: true, version: '2.0.0', message: 'Updated to 2.0.0.', runs: [], ...box.answers.get(`${plugin} ${tool}`) });
  const host: AutoUpdateHost = {
    home: () => box.home, on: () => box.on, now: () => box.clock, every: options.every ?? 4 * HOUR, log: line => box.logs.push(line),
    pending: async () => ({ stopped: box.stopped, ops: box.stopped ? [] : box.due, unread: box.unread }),
    api: {
      update: async (_source, _market, plugin, tools) => { box.calls.push(`update ${plugin} ${tools.join(',')}`); return { reports: tools.map(tool => report(plugin, tool)) }; },
      parts: async (_source, _market, plugin, tool, mode) => { box.calls.push(`parts ${mode} ${plugin} ${tool}`); return { reports: [{ ...report(plugin, tool), outcome: 'installed', partsUpdated: true, partsRun: 'r1', message: 'Parts updated.' }] }; },
    },
    load: async () => box.saved, save: async record => { box.saved = structuredClone(record); },
    changed: (view, news) => box.said.push({ view: structuredClone(view), news }),
  };
  return { box, updates: autoUpdates(host) };
}

test('A check runs what Update all would choose and keeps a plain note of it: the plugin, the version and the tools', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli'), due('document-tools', 'codex-cli'), due('issue-tracker', 'pi-cli', 'install-parts')];
  box.unread = ['private-market'];
  const view = await updates.check();
  assert.deepEqual(box.calls, ['update document-tools claude-cli,codex-cli', 'parts install issue-tracker pi-cli']);
  assert.deepEqual(view.updated.map(line => [line.plugin, line.text, line.at]), [
    ['document-tools', 'updated to 2.0.0 in Claude Code and Codex, which can’t be undone', 1_000_000],
    ['issue-tracker', 'parts updated in Pi', 1_000_000]]);
  assert.deepEqual([view.failed, view.checked, view.checking], [[], { at: 1_000_000, updated: 3, failed: 0, unread: ['private-market'] }, false]);
  assert.equal(box.said.some(said => said.news), true, 'the page and the menu bar hear there is news');
  assert.equal(box.said[0]!.view.checking, true, 'and first that a check is under way');
  assert.match(box.logs.join('\n'), /plugin updates: checked \(couldn’t read private-market\): 3 due/);
  assert.deepEqual(box.saved?.updated.length, 2, 'the note is saved, so it is still there after a restart');
});

test('The schedule checks when the last check is long enough ago, and not at all while the switch is off', async () => {
  const { box, updates } = setup();
  await updates.tick();
  assert.equal(box.saved?.checked?.at, 1_000_000, 'never checked: it checks');
  assert.equal(box.said.some(said => said.news), false, 'nothing due is no news');
  box.clock += 4 * HOUR - 1;
  box.due = [due('document-tools', 'claude-cli')];
  await updates.tick();
  assert.deepEqual(box.calls, [], 'not yet');
  box.clock += 1;
  box.on = false;
  await updates.tick();
  assert.deepEqual(box.calls, [], 'due, but turned off');
  box.on = true;
  await updates.tick();
  assert.deepEqual(box.calls, ['update document-tools claude-cli']);
  // A restart reads the saved record: the next check waits its time again.
  const restarted = setup();
  restarted.box.saved = box.saved;
  restarted.box.clock = box.clock + HOUR;
  restarted.box.due = [due('issue-tracker', 'claude-cli')];
  await restarted.updates.tick();
  assert.deepEqual(restarted.box.calls, []);
  assert.equal((await restarted.updates.view()).updated.length, 1, 'and the note is shown again');
});

test('A failed update is said with the tool’s own words and tried again later: next check, then less often, and at once when asked', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli'), due('document-tools', 'codex-cli')];
  box.answers.set('document-tools codex-cli', { outcome: 'failed', changed: undefined, message: 'Could not refresh Codex’s copy of the marketplace, so nothing was updated.' });
  let view = await updates.check();
  assert.deepEqual(view.failed.map(line => [line.plugin, line.text]), [['document-tools', 'Codex: Could not refresh Codex’s copy of the marketplace, so nothing was updated.']]);
  assert.deepEqual(view.updated.map(line => line.text), ['updated to 2.0.0 in Claude Code, which can’t be undone']);
  assert.deepEqual([view.checked?.updated, view.checked?.failed], [1, 1]);
  // Claude Code is up to date now; Codex is still due.
  box.due = [due('document-tools', 'codex-cli')];
  box.calls.length = 0;
  box.clock += 4 * HOUR;
  await updates.tick();
  assert.deepEqual(box.calls, ['update document-tools codex-cli'], 'tried again at the next check');
  box.calls.length = 0;
  box.clock += 4 * HOUR;
  await updates.tick();
  assert.deepEqual(box.calls, [], 'after two failures it waits two checks');
  assert.match(box.logs.at(-1)!, /1 due, 1 waiting for a later try/);
  box.clock += 4 * HOUR;
  await updates.tick();
  assert.deepEqual(box.calls, ['update document-tools codex-cli']);
  assert.deepEqual([1, 2, 3, 4, 9].map(tries => retryAfter(tries, 4 * HOUR) / HOUR), [4, 8, 16, 24, 24], 'never less often than once a day');
  // Check now tries it whatever it is waiting for; once it works, the failure goes.
  box.calls.length = 0;
  box.answers.clear();
  view = await updates.check(true);
  assert.deepEqual([box.calls, view.failed, view.checked?.failed], [['update document-tools codex-cli'], [], 0]);
});

test('A failure whose update is no longer due is settled, and a new version offered is tried without waiting', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'codex-cli'), due('issue-tracker', 'codex-cli')];
  for (const plugin of ['document-tools', 'issue-tracker']) box.answers.set(`${plugin} codex-cli`, { outcome: 'failed', changed: undefined, message: 'Still 1.0.0 in Codex; the marketplace has 2.0.0.' });
  for (let round = 0; round < 2; round++) { await updates.check(true); }
  // The person uninstalled document-tools; the marketplace moved issue-tracker on to 3.0.0.
  box.due = [due('issue-tracker', 'codex-cli', 'update', '3.0.0')];
  box.calls.length = 0;
  box.clock += 4 * HOUR;
  const view = await updates.check();
  assert.deepEqual(box.calls, ['update issue-tracker codex-cli'], 'two failures would wait two checks, but this is another update');
  assert.deepEqual(view.failed.map(line => line.plugin), ['issue-tracker']);
  assert.equal(box.saved?.failures.find(failure => failure.plugin === 'issue-tracker')?.tries, 1);
});

test('Closing the note empties it; a failure that stays the same stays closed, and one that fails differently is said again', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli'), due('issue-tracker', 'codex-cli')];
  box.answers.set('issue-tracker codex-cli', { outcome: 'failed', changed: undefined, message: 'Codex said no.' });
  await updates.check();
  let view = await updates.close();
  assert.deepEqual([view.updated, view.failed], [[], []]);
  box.due = [due('issue-tracker', 'codex-cli')];
  box.said.length = 0;
  view = await updates.check(true);
  assert.deepEqual([view.failed, box.said.some(said => said.news), view.checked?.failed], [[], false, 1], 'still failing the same way: not said again, still counted');
  box.answers.set('issue-tracker codex-cli', { outcome: 'failed', changed: undefined, message: 'Codex’s command-line tool wasn’t found.' });
  view = await updates.check(true);
  assert.deepEqual([view.failed.map(line => line.text), box.said.some(said => said.news)], [['Codex: Codex’s command-line tool wasn’t found.'], true]);
});

test('A home where nothing may be changed is checked and left alone, saying why; the note is about one home', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli')];
  await updates.check();
  box.home = '/home/b';
  assert.deepEqual((await updates.view()).updated, [], 'another home shows none of the first home’s note');
  box.stopped = 'Preview only: nothing can be changed in this home.';
  box.calls.length = 0;
  const view = await updates.check();
  assert.deepEqual([box.calls, view.checked?.stopped, view.updated], [[], 'Preview only: nothing can be changed in this home.', []]);
  box.home = undefined;
  assert.equal((await updates.check()).checked, undefined, 'no home open: nothing to check');
});

test('A part left alone by a parts update is in the note as a line to read; a second check asked for meanwhile waits for the first', async () => {
  const { box, updates } = setup();
  box.due = [due('issue-tracker', 'pi-cli', 'install-parts')];
  const first = updates.check(), second = updates.check(true);
  assert.equal(first, second);
  await first;
  assert.deepEqual(box.calls, ['parts install issue-tracker pi-cli']);
  // The parts engine's answer when a part was edited since it went in.
  const again = setup();
  again.box.due = [due('issue-tracker', 'pi-cli', 'install-parts')];
  again.box.answers.set('issue-tracker pi-cli', { notes: ['The skill triage was edited since it went in, so it was left as it is.'] });
  const view = await again.updates.check();
  assert.deepEqual(view.updated.map(line => [line.text, line.warn]), [['only some parts updated in Pi', undefined], ['Pi: The skill triage was edited since it went in, so it was left as it is.', true]]);
  assert.deepEqual(view.failed, []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoUpdates, retryAfter, type AutoUpdateHost, type DueUpdate, type UpdatesRecord } from '../src/pluginupdates.ts';
import type { ActionReport, HarnessId, PluginUpdatesView } from '../src/types.ts';

const HOUR = 60 * 60_000;
const due = (plugin: string, tool: HarnessId, action: DueUpdate['action'] = 'update', offered = '2.0.0'): DueUpdate => ({ source: '/market', marketName: 'team', plugin, tool, action, offered });

/** A stand-in app: what is due, what each tool answers (by `plugin tool`), the clock, and everything the updates said or saved. */
function setup(options: { on?: boolean; every?: number } = {}) {
  const box = {
    home: '/home/a' as string | undefined, on: options.on ?? true, paused: false, offline: false, clock: 1_000_000, due: [] as DueUpdate[], unread: [] as string[], stopped: undefined as string | undefined, tools: undefined as HarnessId[] | undefined, joins: {} as Partial<Record<HarnessId, DueUpdate[]>>,
    unreadSources: [] as string[], stops: new Set<string>(), answers: new Map<string, Partial<ActionReport>>(), calls: [] as string[], logs: [] as string[], said: [] as { view: PluginUpdatesView; news?: 'updated' | 'failed' }[], saved: undefined as UpdatesRecord[] | undefined,
    /** The saved record of the home that is open. */
    record: () => box.saved?.find(saved => saved.home === box.home),
  };
  const report = (plugin: string, tool: HarnessId): ActionReport => ({ tool, outcome: 'updated', changed: true, version: '2.0.0', message: 'Updated to 2.0.0.', runs: [], ...box.answers.get(`${plugin} ${tool}`) });
  const host: AutoUpdateHost = {
    home: () => box.home, on: () => box.on, paused: () => box.paused, now: () => box.clock, every: options.every ?? 4 * HOUR, log: line => box.logs.push(line),
    pending: async () => ({ stopped: box.stopped, ops: box.stopped ? [] : box.due, unread: box.unread, unreadSources: box.unreadSources, ...(box.offline ? { offline: true as const } : {}), ...(box.tools ? { tools: box.tools, joins: box.joins } : {}) }),
    api: {
      install: async (_source, _market, plugin, tools) => { box.calls.push(`install ${plugin} ${tools.join(',')}`); return { reports: tools.map(tool => ({ ...report(plugin, tool), outcome: 'installed' as const, message: 'Installed.', ...box.answers.get(`${plugin} ${tool}`) })) }; },
      update: async (_source, _market, plugin, tools) => {
        if (box.stops.has(plugin)) return { stopped: 'Central Knot was quitting.', reports: [] };
        box.calls.push(`update ${plugin} ${tools.join(',')}`);
        return { reports: tools.map(tool => report(plugin, tool)) };
      },
      parts: async (_source, _market, plugin, tool, mode) => { box.calls.push(`parts ${mode} ${plugin} ${tool}`); return { reports: [{ ...report(plugin, tool), outcome: 'installed', partsUpdated: true, partsRun: 'r1', message: 'Parts updated.' }] }; },
    },
    load: async () => box.saved, save: async records => { box.saved = structuredClone(records); },
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
    ['document-tools', 'updated to 2.0.0 in Claude Code and Codex', 1_000_000],
    ['issue-tracker', 'parts updated in Pi', 1_000_000]]);
  assert.deepEqual([view.failed, view.checked, view.checking], [[], { at: 1_000_000, updated: 3, failed: 0, unread: ['private-market'] }, false]);
  assert.equal(box.said.some(said => said.news), true, 'the page and the menu bar hear there is news');
  assert.equal(box.said[0]!.view.checking, true, 'and first that a check is under way');
  assert.match(box.logs.join('\n'), /plugin updates: checked \(couldn’t read private-market\): 3 due/);
  assert.deepEqual(box.record()?.updated.length, 2, 'the note is saved, so it is still there after a restart');
});

test('The schedule checks when the last check is long enough ago, and not at all while the switch is off', async () => {
  const { box, updates } = setup();
  await updates.tick();
  assert.equal(box.record()?.checked?.at, 1_000_000, 'never checked: it checks');
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
  assert.deepEqual(view.failed.map(line => [line.plugin, line.text, line.again]), [['document-tools', 'Could not refresh Codex’s copy of the marketplace, so nothing was updated.', true]], 'the tool’s words name it already');
  assert.deepEqual(view.updated.map(line => line.text), ['updated to 2.0.0 in Claude Code']);
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
  assert.match(box.logs.at(-1)!, /1 due, 1 waiting/);
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
  assert.equal(box.record()?.failures.find(failure => failure.plugin === 'issue-tracker')?.tries, 1);
});

test('Closing the note empties it; a failure that stays the same stays closed, and one that fails differently is said again', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli'), due('issue-tracker', 'codex-cli')];
  box.answers.set('issue-tracker codex-cli', { outcome: 'failed', changed: undefined, message: 'Codex said no.' });
  await updates.check();
  let view = await updates.close('updated');
  assert.deepEqual([view.updated, view.failed.length], [[], 1], 'each half of the note closes on its own');
  view = await updates.close('failed');
  assert.deepEqual([view.updated, view.failed], [[], []]);
  box.due = [due('issue-tracker', 'codex-cli')];
  box.said.length = 0;
  view = await updates.check(true);
  assert.deepEqual([view.failed, box.said.some(said => said.news), view.checked?.failed, box.record()?.failures.length], [[], false, 0, 1], 'still failing the same way: not said again, and Settings counts only what the note shows');
  box.answers.set('issue-tracker codex-cli', { outcome: 'failed', changed: undefined, message: 'Codex’s command-line tool wasn’t found.' });
  view = await updates.check(true);
  assert.deepEqual([view.failed.map(line => line.text), box.said.at(-1)?.news ?? box.said.find(said => said.news)?.news], [['Codex’s command-line tool wasn’t found.'], 'failed'], 'a failure alone is news of its own kind, never "updated"');
});

test('A home where nothing may be changed is checked and left alone, saying why; the note is about one home', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli')];
  await updates.check();
  box.home = '/home/b';
  assert.deepEqual((await updates.view()).updated, [], 'another home shows none of the first home’s note');
  box.due = [];
  await updates.check();
  box.home = '/home/a';
  assert.deepEqual([(await updates.view()).updated.length, box.saved?.map(saved => saved.home).sort()], [1, ['/home/a', '/home/b']], 'and the first home’s note is still there when it is opened again: each home keeps its own');
  box.home = '/home/b';
  box.due = [due('document-tools', 'claude-cli')];
  box.stopped = 'Preview only: nothing can be changed in this home.';
  box.calls.length = 0;
  const view = await updates.check();
  assert.deepEqual([box.calls, view.checked?.stopped, view.checked?.partway, view.updated], [[], 'Preview only: nothing can be changed in this home.', undefined, []]);
  box.clock += 4 * HOUR - 1;
  box.logs.length = 0;
  await updates.tick();
  assert.deepEqual(box.logs, [], 'and looked at again at the usual time, not sooner');
  box.home = undefined;
  assert.equal((await updates.check()).checked, undefined, 'no home open: nothing to check');
});

test('A part left alone by a parts update is in the note as a line to read; a second check asked for meanwhile waits for the first', async () => {
  const { box, updates } = setup();
  box.due = [due('issue-tracker', 'pi-cli', 'install-parts')];
  const first = updates.check(true), second = updates.check(true);
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

test('With Automatic sync off nothing is updated by itself, though a check the person asks for still runs; back on, a check that came due runs', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli')];
  box.paused = true;
  await updates.tick();
  assert.deepEqual([box.calls, (await updates.view()).paused, (await updates.view()).checked], [[], true, undefined]);
  await updates.check(true);
  assert.deepEqual(box.calls, ['update document-tools claude-cli'], 'Check now is the person’s own action');
  box.calls.length = 0;
  box.due = [due('issue-tracker', 'claude-cli')];
  box.clock += 4 * HOUR;
  await updates.tick();
  assert.deepEqual(box.calls, []);
  box.paused = false;
  await updates.tick();
  assert.deepEqual(box.calls, ['update issue-tracker claude-cli']);
});

test('A check that reached no Git marketplace is tried again in half an hour, not at the next check’s time', async () => {
  const { box, updates } = setup();
  box.offline = true;
  box.unread = ['team-tools'];
  await updates.tick();
  assert.deepEqual((await updates.view()).checked, { at: 1_000_000, updated: 0, failed: 0, unread: ['team-tools'], offline: true });
  box.offline = false;
  box.unread = [];
  box.due = [due('document-tools', 'claude-cli')];
  box.clock += 29 * 60_000;
  await updates.tick();
  assert.deepEqual(box.calls, []);
  box.clock += 60_000;
  await updates.tick();
  assert.deepEqual(box.calls, ['update document-tools claude-cli']);
});

test('The note says once that plugins update by themselves now: until a note is first closed in that home', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli')];
  assert.equal((await updates.check()).first, true);
  assert.equal((await updates.close('updated')).first, false);
  box.due = [due('issue-tracker', 'claude-cli')];
  assert.equal((await updates.check(true)).first, false);
  assert.equal(box.record()?.told, true, 'kept across restarts');
});

test('A failure retrying can’t fix waits for the person: it is said once without a promise, and neither the schedule nor Check now runs it again', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli')];
  box.answers.set('document-tools claude-cli', { outcome: 'failed', changed: undefined, kept: true, message: 'Claude Code’s own update kept the copy it had, which still differs from the marketplace’s. Update it on its page to reinstall it.' });
  let view = await updates.check();
  assert.deepEqual(view.failed.map(line => [line.text, line.again]), [['Claude Code’s own update kept the copy it had, which still differs from the marketplace’s. Update it on its page to reinstall it.', undefined]]);
  box.calls.length = 0;
  box.clock += 48 * HOUR;
  await updates.tick();
  await updates.check(true);
  assert.deepEqual(box.calls, [], 'not tried again while the marketplace offers the same');
  // The person updates it on its page: its failure is settled at once, not at the next check.
  await updates.settled('/market', 'document-tools', ['claude-cli']);
  view = await updates.view();
  assert.deepEqual([view.failed, view.checked?.failed], [[], 0]);
});

test('A marketplace that couldn’t be read settles nothing: its failures stay as they are, closed ones closed, until it is read again', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'codex-cli')];
  box.answers.set('document-tools codex-cli', { outcome: 'failed', changed: undefined, message: 'Codex said no.' });
  await updates.check();
  await updates.close('failed');
  // Offline: nothing is due because nothing could be read.
  box.due = []; box.unreadSources = ['/market']; box.unread = ['team']; box.offline = true;
  box.clock += 4 * HOUR;
  await updates.check();
  assert.deepEqual([box.record()?.failures.map(failure => [failure.plugin, failure.tries, failure.closed]), (await updates.view()).checked?.failed], [[['document-tools', 1, true]], 0], 'kept, and still closed: the count is of what the note shows');
  // Back online and still failing the same way: not news again.
  box.due = [due('document-tools', 'codex-cli')]; box.unreadSources = []; box.unread = []; box.offline = false;
  box.said.length = 0;
  await updates.check(true);
  assert.deepEqual([box.said.some(said => said.news), (await updates.view()).failed], [false, []]);
});

test('Check now during a check the schedule started is made after it, so the updates waiting for a later try are tried too; a check that stopped partway is made again soon', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'codex-cli')];
  box.answers.set('document-tools codex-cli', { outcome: 'failed', changed: undefined, message: 'Codex said no.' });
  await updates.check(true);
  await updates.check(true);
  box.calls.length = 0;
  box.clock += 4 * HOUR;
  const scheduled = updates.check(), asked = updates.check(true);
  await Promise.all([scheduled, asked]);
  assert.deepEqual(box.calls, ['update document-tools codex-cli'], 'the scheduled check left it waiting (two failures); the one asked for ran it');
  // The app was quitting when the second update's turn came: the check says how far it got, and is made again in half an hour.
  const stopping = setup();
  stopping.box.due = [due('document-tools', 'claude-cli'), due('issue-tracker', 'claude-cli')];
  stopping.box.stops.add('issue-tracker');
  const view = await stopping.updates.check();
  assert.deepEqual([view.checked?.updated, view.checked?.stopped, view.checked?.partway, view.updated.map(line => line.plugin)], [1, 'Central Knot was quitting.', true, ['document-tools']]);
  stopping.box.stops.clear();
  stopping.box.due = [due('issue-tracker', 'claude-cli')];
  stopping.box.calls.length = 0;
  stopping.box.clock += 30 * 60_000;
  await stopping.updates.tick();
  assert.deepEqual(stopping.box.calls, ['update issue-tracker claude-cli']);
});

test('News is told only of the home that is open: a home switched during a check’s updates keeps its record, and the new home hears nothing', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'claude-cli')];
  // The person switches homes while Claude Code's update runs.
  box.answers.set('document-tools claude-cli', {});
  const answers = box.answers.get.bind(box.answers);
  box.answers.get = key => { box.home = '/home/b'; return answers(key); };
  await updates.check();
  assert.deepEqual(box.said.filter(said => said.news), [], 'nothing is said about home b');
  assert.deepEqual(box.saved?.find(saved => saved.home === '/home/a')?.updated.map(line => line.plugin), ['document-tools'], 'and home a has its note when it is opened again');
});

test('A failure whose marketplace was taken off the list is settled at the next check', async () => {
  const { box, updates } = setup();
  box.due = [due('document-tools', 'codex-cli')];
  box.answers.set('document-tools codex-cli', { outcome: 'failed', changed: undefined, message: 'Codex said no.' });
  await updates.check();
  // The marketplace is gone from every list: neither read nor unreadable, and nothing of it is due.
  box.due = [];
  const view = await updates.check(true);
  assert.deepEqual([view.failed, view.checked?.failed], [[], 0]);
});

test('Selections that wait: a tool new here gets, once, the plugins every other tool has; the tools here at the start get nothing', async () => {
  const { box, updates } = setup();
  const join = (plugin: string, tool: HarnessId, action: DueUpdate['action'] = 'install'): DueUpdate => ({ source: '/market', marketName: 'team', plugin, tool, action });
  // The first check with this feature: the tools here are noted, and nothing is installed, though Copilot CLI lacks a plugin.
  box.tools = ['claude-cli', 'copilot-cli'];
  box.joins = { 'copilot-cli': [join('document-tools', 'copilot-cli')] };
  await updates.check();
  assert.deepEqual([box.calls, box.record()?.seenTools, box.record()?.waiting], [[], ['claude-cli', 'copilot-cli'], []]);
  // Codex and Pi appear: what every other tool has goes in, as an install or as parts, and the note says why.
  box.tools = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'];
  box.joins = { 'copilot-cli': [join('document-tools', 'copilot-cli')], 'codex-cli': [join('issue-tracker', 'codex-cli'), join('spark', 'codex-cli')], 'pi-cli': [join('issue-tracker', 'pi-cli', 'install-parts')] };
  box.answers.set('spark codex-cli', { outcome: 'failed', changed: false, message: 'Codex is not signed in.' });
  box.clock += 4 * HOUR;
  const view = await updates.check();
  assert.deepEqual(box.calls, ['install issue-tracker codex-cli', 'parts install issue-tracker pi-cli', 'install spark codex-cli']);
  assert.deepEqual(view.updated.map(line => [line.plugin, line.text]), [['issue-tracker', 'installed in Codex; parts updated in Pi (new here; your other tools have this plugin)']]);
  assert.deepEqual(view.failed, [], 'a waiting install that fails says nothing');
  assert.deepEqual(box.record()?.waiting?.map(wait => [wait.plugin, wait.tool, wait.tries]), [['spark', 'codex-cli', 1]]);
  assert.equal(box.said.at(-1)?.view.updated.length, 1);
  // What went in is off the list for good: taken out of Codex later, it is not put back. The one that failed is tried
  // again later, not at once, and given up after three tries.
  box.calls.length = 0;
  box.joins = { 'codex-cli': [join('issue-tracker', 'codex-cli'), join('spark', 'codex-cli')] };
  box.clock += 1;
  await updates.check();
  assert.deepEqual(box.calls, [], 'not yet');
  box.clock += 4 * HOUR;
  await updates.check();
  box.clock += 8 * HOUR;
  await updates.check();
  assert.deepEqual([box.calls, box.record()?.waiting], [['install spark codex-cli', 'install spark codex-cli'], []]);
  assert.equal(box.logs.filter(line => /spark did not go into Codex/.test(line)).length, 3);
  assert.equal(box.logs.filter(line => /spark did not go into Codex, and is not tried again: Codex is not signed in\./.test(line)).length, 1, 'said once, at the last try');
  // A tool that was missed by one read and is found again is not new.
  box.calls.length = 0;
  box.tools = ['claude-cli'];
  box.clock += 4 * HOUR;
  await updates.check();
  box.tools = ['claude-cli', 'codex-cli'];
  box.joins = { 'codex-cli': [join('issue-tracker', 'codex-cli')] };
  box.clock += 4 * HOUR;
  await updates.check();
  assert.deepEqual(box.calls, []);
  // Put in by hand before its turn: no longer due, so it leaves the list.
  box.tools = ['claude-cli', 'codex-cli', 'opencode-cli'];
  box.joins = { 'opencode-cli': [join('issue-tracker', 'opencode-cli', 'install-parts')] };
  box.answers.set('issue-tracker opencode-cli', { outcome: 'failed', changed: false, message: 'No.' });
  box.clock += 4 * HOUR;
  await updates.check();
  box.joins = {};
  box.clock += 1;
  await updates.check();
  assert.deepEqual(box.record()?.waiting, []);
});

test('A tool whose Manage switch is turned off is forgotten as seen, with what waited for it: turned on again, it is new and gets what the others have', async () => {
  const { box, updates } = setup();
  const join = (plugin: string, tool: HarnessId): DueUpdate => ({ source: '/market', marketName: 'team', plugin, tool, action: 'install' });
  box.tools = ['claude-cli', 'codex-cli'];
  await updates.check();
  // Codex is left out: the reads of the home no longer name it (main.ts passes the managed tools), and it is forgotten.
  box.tools = ['claude-cli'];
  await updates.leftOut('codex-cli');
  assert.deepEqual(box.record()?.seenTools, ['claude-cli']);
  // Turned on again: a read names it, a check is made at once, and it gets the plugin Claude Code has.
  box.tools = ['claude-cli', 'codex-cli'];
  box.joins = { 'codex-cli': [join('issue-tracker', 'codex-cli')] };
  await updates.present(box.tools);
  assert.deepEqual(box.calls, ['install issue-tracker codex-cli']);
});

test('Selections that wait only while plugins change by themselves: a tool first seen with the switch or Automatic sync off is noted, and gets nothing later', async () => {
  const { box, updates } = setup();
  const join = (plugin: string, tool: HarnessId): DueUpdate => ({ source: '/market', marketName: 'team', plugin, tool, action: 'install' });
  box.tools = ['claude-cli'];
  await updates.check();
  // Automatic sync is off when Codex is installed: each read of the home notes it, and nothing waits.
  box.paused = true;
  await updates.present(['claude-cli', 'codex-cli']);
  assert.deepEqual([box.record()?.seenTools, box.record()?.waiting ?? [], box.calls], [['claude-cli', 'codex-cli'], [], []]);
  // Sync on again, weeks later: Codex is not new, whatever it lacks.
  box.paused = false;
  box.tools = ['claude-cli', 'codex-cli'];
  box.joins = { 'codex-cli': [join('issue-tracker', 'codex-cli')] };
  box.clock += 60 * 24 * HOUR;
  await updates.check();
  assert.deepEqual(box.calls, []);
  // The switch off and Check now: a tool first seen by that check is noted too, and gets nothing then or after.
  box.on = false;
  box.tools = ['claude-cli', 'codex-cli', 'copilot-cli'];
  box.joins = { 'copilot-cli': [join('issue-tracker', 'copilot-cli')] };
  await updates.check(true);
  box.on = true;
  box.clock += 4 * HOUR;
  await updates.check();
  assert.deepEqual([box.calls, box.record()?.seenTools], [[], ['claude-cli', 'codex-cli', 'copilot-cli']]);
  // On, and a tool not seen before turns up in a read of the home: a check is made at once, and it gets what waits.
  box.tools = ['claude-cli', 'codex-cli', 'copilot-cli', 'opencode-cli'];
  box.joins = { 'opencode-cli': [{ ...join('issue-tracker', 'opencode-cli'), action: 'install-parts' }] };
  await updates.present(box.tools);
  assert.deepEqual(box.calls, ['parts install issue-tracker opencode-cli']);
  // An update of the same parts due in the same check is run once.
  box.calls.length = 0;
  box.tools = [...box.tools, 'pi-cli'];
  box.joins = { 'pi-cli': [{ ...join('issue-tracker', 'pi-cli'), action: 'install-parts' }] };
  box.due = [due('issue-tracker', 'pi-cli', 'install-parts')];
  box.clock += 4 * HOUR;
  await updates.check();
  assert.deepEqual(box.calls, ['parts install issue-tracker pi-cli']);
});

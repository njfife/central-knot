import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batches, notUndone, resultLines, resultParts, resultSentence, reverse, runPlan, type PlanApi, type PluginDone, type PluginOp } from '../src/pluginplan.ts';
import type { ActionReport, HarnessId } from '../src/types.ts';

const op = (plugin: string, tool: HarnessId, action: PluginOp['action'] = 'install'): PluginOp => ({ source: 'anthropics/skills', marketName: 'anthropic-agent-skills', plugin, tool, action });

test('A run does each plugin’s installs as one command, then its removals tool by tool', () => {
  const plan = batches([op('pdf', 'claude-cli'), op('docx', 'codex-cli', 'remove'), op('pdf', 'codex-cli'), op('pdf', 'copilot-cli', 'remove')]);
  assert.deepEqual(plan.map(batch => [batch.plugin, batch.action, batch.tools]), [
    ['pdf', 'install', ['claude-cli', 'codex-cli']],
    ['pdf', 'remove', ['copilot-cli']],
    ['docx', 'remove', ['codex-cli']],
  ]);
});

test('Updates run after a plugin’s installs as one command, are never undone, and the result names the new version and says so', () => {
  assert.deepEqual(batches([op('pdf', 'claude-cli', 'update'), op('pdf', 'pi-cli', 'install-parts'), op('pdf', 'copilot-cli'), op('pdf', 'codex-cli', 'update')]).map(step => [step.action, step.tools]),
    [['install', ['copilot-cli']], ['update', ['claude-cli', 'codex-cli']], ['install-parts', ['pi-cli']]]);
  const updated = (tool: HarnessId, version: string, changed = true): PluginDone => ({ ...op('pdf', tool, 'update'), report: { tool, outcome: 'updated', message: '', runs: [], version, ...(changed ? { changed } : {}) } });
  const done = [updated('codex-cli', '2.0.0'), updated('claude-cli', '2.0.0'), updated('copilot-cli', '2.0.0', false), { ...op('pdf', 'pi-cli', 'install-parts'), report: { tool: 'pi-cli' as const, outcome: 'installed' as const, message: '', runs: [], changed: true, partsUpdated: true, partsRun: 'run-1' } }];
  assert.deepEqual(reverse(done).map(entry => [entry.tool, entry.action]), [['pi-cli', 'undo-parts']], 'only the parts come back out');
  assert.equal(resultLines(done)[0]?.text, 'updated to 2.0.0 in Claude Code and Codex, which can’t be undone; already up to date in Copilot CLI; parts updated in Pi');
  assert.equal(resultLines([updated('codex-cli', '2.0.0'), updated('claude-cli', '1.9.5')])[0]?.text, 'updated to 1.9.5 in Claude Code; to 2.0.0 in Codex, which can’t be undone');
  // A copy that differed at the same version says how it was brought up to date.
  const byContent = (tool: HarnessId, how: 'update' | 'reinstall'): PluginDone => ({ ...updated(tool, '1.2.0'), report: { ...updated(tool, '1.2.0').report, byContent: how } });
  assert.equal(resultLines([byContent('claude-cli', 'reinstall'), byContent('codex-cli', 'update'), updated('copilot-cli', '2.0.0')])[0]?.text,
    'reinstalled from the marketplace’s copy of 1.2.0 in Claude Code; updated to 2.0.0 in Copilot CLI; updated to the marketplace’s copy of 1.2.0 in Codex, which can’t be undone');
});

test('Undo reverses only what really changed, and the report names each plugin once per marketplace', () => {
  const done: PluginDone[] = [
    { ...op('pdf', 'claude-cli'), report: { tool: 'claude-cli', outcome: 'installed', message: 'Installed.', runs: [], changed: true } },
    { ...op('pdf', 'codex-cli'), report: { tool: 'codex-cli', outcome: 'failed', message: 'It stopped with exit code 1.', runs: [] } },
    { ...op('docx', 'copilot-cli', 'remove'), report: { tool: 'copilot-cli', outcome: 'uninstalled', message: 'Uninstalled.', runs: [], changed: true } },
    // Already installed before this run (the view was stale): Undo must not remove what the person already had.
    { ...op('pdf', 'claude-cli'), source: 'other/market', report: { tool: 'claude-cli', outcome: 'installed', message: 'Already installed in Claude Code.', runs: [] } },
  ];
  assert.deepEqual(reverse(done).map(entry => [entry.plugin, entry.tool, entry.action]), [['docx', 'copilot-cli', 'install'], ['pdf', 'claude-cli', 'remove']], 'last first');
  // A parts step is undone by its own run; one with no run to undo (it changed nothing it could undo) is left alone.
  const parts: PluginDone[] = [
    { ...op('figma', 'pi-cli', 'install-parts'), report: { tool: 'pi-cli', outcome: 'installed', message: '', runs: [], changed: true, partsRun: 'run-1' } },
    { ...op('figma', 'codex-cli', 'install-parts'), report: { tool: 'codex-cli', outcome: 'installed', message: '', runs: [], changed: true } },
  ];
  assert.deepEqual(reverse(parts).map(entry => [entry.tool, entry.action, entry.run]), [['pi-cli', 'undo-parts', 'run-1']]);
  // An update that had nothing to write still says so.
  const quiet: PluginDone[] = [{ ...op('figma', 'pi-cli', 'install-parts'), report: { tool: 'pi-cli', outcome: 'installed', message: '', runs: [], changed: false, partsUpdated: true } }];
  assert.equal(resultLines(quiet)[0]?.text, 'parts already up to date in Pi');
  assert.deepEqual(resultLines(done), [
    { source: 'anthropics/skills', plugin: 'pdf', ok: true, text: 'installed in Claude Code', short: 'installed in Claude Code' },
    { source: 'anthropics/skills', plugin: 'pdf', ok: false, text: 'Codex: It stopped with exit code 1.', short: 'Codex: It stopped with exit code 1.' },
    { source: 'anthropics/skills', plugin: 'docx', ok: true, text: 'uninstalled from Copilot CLI', short: 'uninstalled from Copilot CLI' },
    { source: 'other/market', plugin: 'pdf', ok: true, text: 'already in Claude Code', short: 'already in Claude Code' },
  ]);
});

test('A run goes on past a step that throws, and a refusal stops it there: the rest doesn’t run', async () => {
  const ops = [op('pdf', 'claude-cli'), op('docx', 'claude-cli'), op('xlsx', 'claude-cli')];
  const seen: string[] = [];
  const api = {
    install: async (_source: string, _marketName: string, plugin: string, tools: HarnessId[]) => {
      seen.push(plugin);
      if (plugin === 'pdf') throw new Error('IPC gone');
      if (plugin === 'xlsx') return { stopped: 'Writing isn’t allowed here.', reports: [] };
      return { reports: tools.map(tool => ({ tool, outcome: 'installed' as const, message: '', runs: [], changed: true })) };
    },
    uninstall: async () => ({ reports: [] }),
    setSkill: async () => ({ reports: [] }),
  };
  const result = await runPlan(ops, api, '/home');
  assert.deepEqual(seen, ['pdf', 'docx', 'xlsx']);
  assert.deepEqual(result.done.map(entry => [entry.plugin, entry.report.outcome]), [['pdf', 'failed'], ['docx', 'installed']]);
  assert.equal(result.stopped, 'Writing isn’t allowed here.');
});

test('An Undo says what came back, and keeps what it did not get to', () => {
  const undoOps = [op('pdf', 'claude-cli', 'remove'), op('docx', 'codex-cli', 'install'), op('xlsx', 'claude-cli', 'remove'), op('pptx', 'codex-cli', 'remove')];
  const done: PluginDone[] = [
    { ...undoOps[0]!, report: { tool: 'claude-cli', outcome: 'uninstalled', message: '', runs: [], changed: true } },
    { ...undoOps[1]!, report: { tool: 'codex-cli', outcome: 'installed', message: '', runs: [], changed: true } },
    // Already gone when the Undo reached it: nothing left to do, so "Undo the rest" doesn't offer it again.
    { ...undoOps[3]!, report: { tool: 'codex-cli', outcome: 'uninstalled', message: 'Not installed in Codex.', runs: [] } },
  ];
  assert.equal(resultSentence(resultLines(done.slice(0, 2), true), true), 'Undone: pdf removed from Claude Code; docx put back in Codex.');
  assert.deepEqual(resultParts(resultLines(done.slice(0, 1), true), true), ['Undone: ', { plugin: 'pdf', source: 'anthropics/skills' }, ' removed from Claude Code', '.']);
  assert.deepEqual(notUndone(undoOps, done).map(entry => entry.plugin), ['xlsx']);
  // A run where nothing succeeded has no result sentence (its failures show in the problem band).
  const failed: PluginDone[] = [{ ...undoOps[2]!, report: { tool: 'claude-cli', outcome: 'failed', message: 'x', runs: [] } }];
  assert.equal(resultSentence(resultLines(failed, true), true), '');
});

test('The toolbar counts three or more tools; the full sentence names them', () => {
  const done: PluginDone[] = [op('pdf', 'claude-cli'), op('pdf', 'copilot-cli'), op('pdf', 'codex-cli')].map(entry => ({ ...entry, report: { tool: entry.tool, outcome: 'installed', message: '', runs: [], changed: true } }));
  const lines = resultLines(done);
  assert.equal(lines[0]!.text, 'installed in Claude Code, Copilot CLI and Codex');
  assert.deepEqual(resultParts(lines, false, { short: true }), [{ plugin: 'pdf', source: 'anthropics/skills' }, ': installed in 3 tools', '.']);
});

test('A skill’s switch runs between installs and removals, its Undo turns it back, and the report names the skill', () => {
  const off = (tool: HarnessId, skill = 'pdf-reader'): PluginOp => ({ ...op('docs', tool, 'skill-off'), skill });
  assert.deepEqual(batches([op('docs', 'codex-cli', 'update'), off('codex-cli'), op('docs', 'claude-cli'), op('docs', 'copilot-cli', 'remove')]).map(step => [step.action, step.skill]), [['install', undefined], ['update', undefined], ['skill-off', 'pdf-reader'], ['remove', undefined]]);
  const done = (tool: HarnessId, outcome: 'skill-off' | 'skill-on', changed?: boolean): PluginDone => ({ ...off(tool), action: outcome, report: { tool, outcome, message: '', runs: [], changed } });
  const run = [done('codex-cli', 'skill-off', true), done('copilot-cli', 'skill-off', true), done('claude-cli', 'skill-off')];
  assert.deepEqual(reverse(run).map(back => [back.tool, back.action, back.skill]), [['copilot-cli', 'skill-on', 'pdf-reader'], ['codex-cli', 'skill-on', 'pdf-reader']], 'last first');
  assert.equal(resultLines(run)[0]!.text, 'pdf-reader turned off in Copilot CLI and Codex; pdf-reader already off in Claude Code');
  assert.equal(resultSentence(resultLines([done('codex-cli', 'skill-on', true)], true), true), 'Undone: docs: pdf-reader back on in Codex.');
});

/** A pretend engine for runPlan: each call answers with these reports, by action, and is counted. */
const engine = (answer: (action: string, tool: HarnessId) => Omit<ActionReport, 'tool' | 'runs'>) => {
  const calls: string[] = [];
  const reply = (action: string, tools: HarnessId[]) => { calls.push(`${action} ${tools.join(' ')}`); return { reports: tools.map(tool => ({ tool, runs: [], ...answer(action, tool) })) }; };
  const api: PlanApi = {
    install: async (_s, _m, _p, tools) => reply('install', tools), uninstall: async (_s, _m, _p, tool) => reply('remove', [tool]),
    setSkill: async (_s, _m, _p, _skill, tool, on) => reply(on ? 'skill-on' : 'skill-off', [tool]),
    update: async (_s, _m, _p, tools) => reply('update', tools), parts: async (_s, _m, _p, tool, mode) => reply(`parts-${mode}`, [tool]),
  };
  return { api, calls };
};

test('A part’s switch runs one pick alone, says the part by name, and its Undo is the parts run’s own record', async () => {
  const part = (name: string) => ({ kind: 'skill' as const, name });
  const pick: PluginOp = { ...op('pdf', 'pi-cli', 'pick-parts'), pick: { on: [], off: [part('tdd')] } };
  assert.deepEqual(batches([pick]).map(step => [step.action, step.tools, step.pick]), [['pick-parts', ['pi-cli'], { on: [], off: [part('tdd')] }]]);
  const { api, calls } = engine(() => ({ outcome: 'installed', message: '', changed: true, partsRun: 'r' }));
  const { done } = await runPlan([pick], api, '/h');
  assert.deepEqual(calls, ['parts-install pi-cli'], 'one step, the pick');
  assert.equal(resultSentence(resultLines(done), false), 'pdf: skill tdd taken out of Pi.');
  // Its Undo carries no pick (the log would name parts the Undo never chose).
  assert.deepEqual(reverse(done).map(back => [back.action, back.run, back.pick]), [['undo-parts', 'r', undefined]]);
  // A tool where a part was left alone got only some of its parts, and a skill written over a broken link says so.
  const some: PluginDone[] = [
    { ...op('pdf', 'pi-cli'), action: 'install-parts', report: { tool: 'pi-cli', outcome: 'installed', message: '', runs: [], changed: true, partsRun: 'r', notes: ['Didn’t put in the skill “tdd”: Pi already has one of that name.'], replacedLinks: ['qa'] } },
    { ...op('pdf', 'codex-cli'), action: 'install-parts', report: { tool: 'codex-cli', outcome: 'installed', message: '', runs: [], changed: true, partsRun: 's' } }];
  assert.equal(resultLines(some).find(line => line.ok)?.text, 'parts installed in Codex; only some parts installed in Pi; a broken link replaced in Pi');
});

test('Update runs at once: alone it offers no Undo; with parts brought up to date in the same click, Undo is for those parts only', async () => {
  const { api } = engine(action => (action === 'update' ? { outcome: 'updated', message: '', changed: true, version: '2.0.0' } : { outcome: 'installed', message: '', changed: true, partsUpdated: true, partsRun: 'r' }));
  const alone = await runPlan([op('pdf', 'claude-cli', 'update')], api, '/h');
  assert.deepEqual(reverse(alone.done), [], 'an update has no way back');
  const both = await runPlan([op('pdf', 'claude-cli', 'update'), op('pdf', 'pi-cli', 'install-parts')], api, '/h');
  assert.deepEqual(reverse(both.done).map(back => [back.tool, back.action, back.run]), [['pi-cli', 'undo-parts', 'r']]);
  assert.equal(resultLines(both.done)[0]?.text, 'updated to 2.0.0 in Claude Code, which can’t be undone; parts updated in Pi');
});

test('A click on a view out of date: what the tool already has, or no longer has, is said as the tool said it, and nothing is offered to undo', async () => {
  // The background updated it a moment ago, and it was uninstalled from Codex by hand: the page still showed both.
  const { api } = engine(action => (action === 'update' ? { outcome: 'updated', message: 'Already up to date in Claude Code.', version: '2.0.0' }
    : { outcome: 'failed', message: 'It isn’t installed in Codex now.' }));
  const { done } = await runPlan([op('docs', 'claude-cli', 'update'), { ...op('docs', 'codex-cli', 'skill-off'), skill: 'pdf-reader' }], api, '/h');
  assert.deepEqual(resultLines(done).map(line => [line.ok, line.text]), [[true, 'already up to date in Claude Code'], [false, 'Codex, pdf-reader: It isn’t installed in Codex now.']]);
  assert.deepEqual(reverse(done), []);
});

test('An update the automatic check made first is made once: the click’s own update then finds it current and says so, with nothing to undo', async () => {
  // One tool's record, as the tool keeps it: an update moves it to the version offered, once.
  let version = '1.0.0';
  const { api, calls } = engine(() => (version === '2.0.0' ? { outcome: 'updated', message: 'Already up to date in Claude Code.', version }
    : (version = '2.0.0', { outcome: 'updated', message: 'Updated to 2.0.0.', changed: true, version })));
  // Both go through main's one queue: the background's turn first, then the click's, for the same plugin and tool.
  const background = await runPlan([op('pdf', 'claude-cli', 'update')], api, '/h');
  const click = await runPlan([op('pdf', 'claude-cli', 'update')], api, '/h');
  assert.equal(resultLines(background.done, false, { after: true })[0]?.text, 'updated to 2.0.0 in Claude Code', 'the automatic note');
  assert.deepEqual([click.done[0]?.report.changed, resultLines(click.done)[0]?.text, reverse(click.done)], [undefined, 'already up to date in Claude Code', []]);
  assert.deepEqual(calls, ['update claude-cli', 'update claude-cli']);
});

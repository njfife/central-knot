import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batches, clickPart, flipPick, partStand, pickOf, recordRun, resultLines, resultSentence, prune, reverse, setPick, summary, toggle, toggleMany, queued, type PluginDone, type PluginDraft, type PluginOp } from '../src/pluginplan.ts';
import type { HarnessId } from '../src/types.ts';

const op = (plugin: string, tool: HarnessId, action: PluginOp['action'] = 'install'): PluginOp => ({ source: 'anthropics/skills', marketName: 'anthropic-agent-skills', plugin, tool, action });

test('Choosing a box queues it, choosing it again takes it back, and another action replaces it', () => {
  const draft: PluginDraft = new Map();
  toggle(draft, op('pdf', 'claude-cli'));
  assert.equal(queued(draft, 'anthropics/skills', 'pdf', 'claude-cli'), 'install');
  toggle(draft, op('pdf', 'claude-cli'));
  assert.equal(queued(draft, 'anthropics/skills', 'pdf', 'claude-cli'), undefined);
  toggle(draft, op('pdf', 'claude-cli'));
  toggle(draft, op('pdf', 'claude-cli', 'remove'));
  assert.equal(queued(draft, 'anthropics/skills', 'pdf', 'claude-cli'), 'remove');
});

test('Install in all queues every tool, and a second click clears them all', () => {
  const draft: PluginDraft = new Map();
  const ops = [op('pdf', 'claude-cli'), op('pdf', 'codex-cli')];
  toggle(draft, ops[0]!);
  toggleMany(draft, ops);
  assert.deepEqual(summary(draft), { plugins: 1, installs: 2, updates: 0, removals: 0, skillsOff: { skills: 0, tools: 0 }, skillsOn: { skills: 0, tools: 0 }, partsInstalls: 0, partsUpdates: 0, partsRemovals: 0, partsOn: 0, partsOff: 0 });
  toggleMany(draft, ops);
  assert.equal(draft.size, 0);
});

test('Apply all runs each plugin’s installs as one command, then its removals tool by tool', () => {
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

test('Choices that no longer mean anything are dropped: no longer listed, already installed, not installed, held, or no CLI', () => {
  const draft: PluginDraft = new Map();
  toggle(draft, op('done', 'claude-cli'));
  toggle(draft, op('gone', 'claude-cli', 'remove'));
  toggle(draft, op('held', 'claude-cli'));
  toggle(draft, op('nocli', 'codex-cli'));
  toggle(draft, op('keep', 'claude-cli'));
  toggle(draft, op('unlisted', 'claude-cli'));
  toggle(draft, { ...op('keep', 'claude-cli'), source: 'removed/market' });
  const plugins = ['done', 'gone', 'held', 'nocli', 'keep'].map(name => ({ name, description: '' }));
  prune(draft, { home: '/h', tools: ['claude-cli', 'codex-cli'], clis: { 'claude-cli': true }, canWrite: true, marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'anthropic-agent-skills', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins,
    states: { done: { 'claude-cli': { state: 'installed', path: '/p' } }, held: { 'claude-cli': { state: 'held', reason: 'other' } } } }] });
  assert.deepEqual([...draft.values()].map(entry => entry.plugin), ['keep']);
  // A refresh that makes Copilot refuse the whole marketplace drops a Copilot choice, as its box now shows "not available".
  toggle(draft, op('keep', 'copilot-cli'));
  prune(draft, { home: '/h', tools: ['claude-cli', 'copilot-cli'], clis: { 'claude-cli': true, 'copilot-cli': true }, canWrite: true, marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'anthropic-agent-skills', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins, states: {}, copilotRefuses: 'npm source' }] });
  assert.deepEqual([...draft.values()].map(entry => entry.tool), ['claude-cli']);
  // A marketplace that renamed itself makes plugin@old another plugin: the choice goes.
  prune(draft, { home: '/h', tools: ['claude-cli'], clis: { 'claude-cli': true }, canWrite: true, marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'renamed', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins, states: {} }] });
  assert.equal(draft.size, 0);
});

test('A run goes on past a step that throws, and a refusal stops it with the rest still chosen', async () => {
  const { runPlan } = await import('../src/pluginplan.ts');
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

test('An Undo says what came back, and keeps what it did not get to', async () => {
  const { notUndone, resultParts, resultSentence } = await import('../src/pluginplan.ts');
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

test('After a run, what ran leaves the draft, the rest stays chosen, and the toolbar counts three or more tools', async () => {
  const { recordRun, resultParts } = await import('../src/pluginplan.ts');
  const draft: PluginDraft = new Map();
  const ops = [op('pdf', 'claude-cli'), op('pdf', 'copilot-cli'), op('pdf', 'codex-cli'), op('docx', 'claude-cli')];
  for (const entry of ops) toggle(draft, entry);
  const done: PluginDone[] = ops.slice(0, 3).map(entry => ({ ...entry, report: { tool: entry.tool, outcome: 'installed', message: '', runs: [], changed: true } }));
  const run = recordRun(draft, ops, done, false, '/h');
  assert.deepEqual([...draft.values()].map(entry => entry.plugin), ['docx'], 'docx was not reached: still chosen');
  assert.deepEqual([run.home, run.undo, run.rest], ['/h', false, undefined]);
  const lines = resultLines(run.done);
  assert.equal(lines[0]!.text, 'installed in Claude Code, Copilot CLI and Codex');
  assert.deepEqual(resultParts(lines, false, { short: true }), [{ plugin: 'pdf', source: 'anthropics/skills' }, ': installed in 3 tools', '.']);
});

test('A skill’s switch is its own choice: it runs between installs and removals, its Undo turns it back, and the report names the skill', () => {
  const off = (tool: HarnessId, skill = 'pdf-reader'): PluginOp => ({ ...op('docs', tool, 'skill-off'), skill });
  const draft: PluginDraft = new Map();
  toggle(draft, op('docs', 'codex-cli', 'remove'));
  toggle(draft, off('codex-cli'));
  toggle(draft, off('codex-cli', 'spreadsheet'));
  assert.equal(queued(draft, 'anthropics/skills', 'docs', 'codex-cli'), 'remove', 'the plugin’s own choice stays');
  assert.equal(queued(draft, 'anthropics/skills', 'docs', 'codex-cli', 'pdf-reader'), 'skill-off');
  toggle(draft, off('codex-cli', 'spreadsheet'));
  toggle(draft, off('copilot-cli'));
  assert.deepEqual(summary(draft), { plugins: 1, installs: 0, updates: 0, removals: 1, skillsOff: { skills: 1, tools: 2 }, skillsOn: { skills: 0, tools: 0 }, partsInstalls: 0, partsUpdates: 0, partsRemovals: 0, partsOn: 0, partsOff: 0 }, 'one skill in two tools counts once');
  toggle(draft, off('copilot-cli'));
  assert.deepEqual(batches([...draft.values(), op('docs', 'claude-cli')]).map(step => [step.action, step.skill]), [['install', undefined], ['skill-off', 'pdf-reader'], ['remove', undefined]]);
  const done = (tool: HarnessId, outcome: 'skill-off' | 'skill-on', changed?: boolean): PluginDone => ({ ...off(tool), action: outcome, report: { tool, outcome, message: '', runs: [], changed } });
  const run = [done('codex-cli', 'skill-off', true), done('copilot-cli', 'skill-off', true), done('claude-cli', 'skill-off')];
  assert.deepEqual(reverse(run).map(back => [back.tool, back.action, back.skill]), [['copilot-cli', 'skill-on', 'pdf-reader'], ['codex-cli', 'skill-on', 'pdf-reader']], 'last first');
  assert.equal(resultLines(run)[0]!.text, 'pdf-reader turned off in Copilot CLI and Codex; pdf-reader already off in Claude Code');
  assert.equal(resultSentence(resultLines([done('codex-cli', 'skill-on', true)], true), true), 'Undone: docs: pdf-reader back on in Codex.');
});

test('A skill’s switch is dropped once it means nothing: not installed there, already as chosen, held off, or a tool with no such switch; an older build keeps it', () => {
  const draft: PluginDraft = new Map();
  const choose = (tool: HarnessId, skill: string, action: PluginOp['action']) => toggle(draft, { ...op('docs', tool, action), skill });
  choose('codex-cli', 'keep', 'skill-off');
  choose('codex-cli', 'already', 'skill-off');
  choose('codex-cli', 'held', 'skill-on');
  choose('copilot-cli', 'keep', 'skill-off');
  choose('claude-cli', 'keep', 'skill-off');
  choose('copilot-cli', 'old', 'skill-off');
  prune(draft, { home: '/h', tools: ['claude-cli', 'codex-cli', 'copilot-cli'], clis: { 'claude-cli': true, 'codex-cli': true, 'copilot-cli': true }, canWrite: true, versions: { 'codex-cli': '0.167.0', 'copilot-cli': '1.0.99' },
    marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'anthropic-agent-skills', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins: [{ name: 'docs', description: '' }],
      states: { docs: { 'claude-cli': { state: 'installed', path: '/c' }, 'codex-cli': { state: 'installed', path: '/x', skillsOff: [{ skill: 'already' }, { skill: 'held', held: 'every skill named held' }] }, 'copilot-cli': { state: 'installed', path: '/p' } } } }] });
  assert.deepEqual([...draft.values()].map(entry => `${entry.tool} ${entry.skill}`), ['codex-cli keep', 'copilot-cli keep', 'copilot-cli old']);
});

test('Single parts picked for a tool are one choice: beside an install of its parts they are its exceptions, and the whole plugin or a removal takes them back', async () => {
  const draft: PluginDraft = new Map();
  const at = op('pdf', 'pi-cli');
  const part = (name: string) => ({ kind: 'skill' as const, name });
  // Flipping a part chooses it.
  setPick(draft, at, flipPick(pickOf(draft, at.source, 'pdf', 'pi-cli'), part('tdd'), true));
  setPick(draft, at, flipPick(pickOf(draft, at.source, 'pdf', 'pi-cli'), part('grill-me'), false));
  assert.deepEqual(pickOf(draft, at.source, 'pdf', 'pi-cli'), { on: [part('tdd')], off: [part('grill-me')] });
  assert.deepEqual([summary(draft).partsOn, summary(draft).partsOff, summary(draft).plugins], [1, 1, 0]);
  assert.deepEqual(batches([...draft.values()]).map(step => [step.action, step.tools, step.pick]), [['pick-parts', ['pi-cli'], { on: [part('tdd')], off: [part('grill-me')], rest: false }]]);
  // With all the tool's parts installed too, it is one step: that install, with the pick as its exceptions.
  toggle(draft, op('pdf', 'pi-cli', 'install-parts'));
  const steps = batches([...draft.values()]);
  assert.deepEqual(steps.map(step => [step.action, step.pick?.rest]), [['pick-parts', true]]);
  // Once it ran, both choices leave the draft.
  const done: PluginDone[] = [{ ...at, action: 'pick-parts', pick: steps[0]!.pick, report: { tool: 'pi-cli', outcome: 'installed', message: '', runs: [], changed: true, partsRun: 'r' } }];
  const ran = new Map(draft);
  recordRun(ran, [...ran.values()], done, false, '/home');
  assert.equal(ran.size, 0);
  assert.deepEqual(reverse(done).map(back => [back.action, back.run]), [['undo-parts', 'r']]);
  // The whole plugin, or all its parts out, is another choice for the tool: the pick goes. Picking parts takes back an install.
  toggle(draft, op('pdf', 'pi-cli', 'remove-parts'));
  assert.equal(pickOf(draft, at.source, 'pdf', 'pi-cli'), undefined);
  toggle(draft, op('pdf', 'claude-cli'));
  setPick(draft, op('pdf', 'claude-cli'), { on: [part('tdd')], off: [] });
  assert.equal(queued(draft, at.source, 'pdf', 'claude-cli'), undefined);
  toggle(draft, op('pdf', 'claude-cli'));
  assert.equal(pickOf(draft, at.source, 'pdf', 'claude-cli'), undefined);
  // A second click on a part's switch takes its choice back, whichever way the switch now points; an empty pick is no choice.
  setPick(draft, op('pdf', 'codex-cli'), flipPick(flipPick(undefined, part('tdd'), true), part('tdd'), false));
  assert.equal(pickOf(draft, at.source, 'pdf', 'codex-cli'), undefined);
  assert.deepEqual(flipPick(flipPick(undefined, part('tdd'), false), part('tdd'), true), { on: [], off: [] });
});

test('A new view keeps a pick: a part to put in stays even when the record still lists it (removed by hand), and one to take out goes once it is no longer there', () => {
  const part = (name: string) => ({ kind: 'skill' as const, name });
  const entry = (items: string[]) => ({ source: 'anthropics/skills', name: 'anthropic-agent-skills', plugins: [{ name: 'pdf' }], states: {}, parts: { pdf: { 'pi-cli': { at: '', items: items.map(part) } } } });
  const view = (items: string[]) => ({ home: '/h', tools: ['pi-cli'], clis: {}, canWrite: true, marketplaces: [entry(items)] }) as unknown as Parameters<typeof prune>[1];
  const draft: PluginDraft = new Map();
  setPick(draft, op('pdf', 'pi-cli'), { on: [part('tdd')], off: [part('grill-me')] });
  prune(draft, view(['tdd', 'grill-me']));
  assert.deepEqual(pickOf(draft, 'anthropics/skills', 'pdf', 'pi-cli'), { on: [part('tdd')], off: [part('grill-me')] });
  prune(draft, view(['tdd']));
  assert.deepEqual(pickOf(draft, 'anthropics/skills', 'pdf', 'pi-cli'), { on: [part('tdd')], off: [] });
  setPick(draft, op('pdf', 'pi-cli'), { on: [], off: [part('grill-me')] });
  prune(draft, view(['tdd']));
  assert.equal(pickOf(draft, 'anthropics/skills', 'pdf', 'pi-cli'), undefined);
});

test('Clicks on part switches: a second click takes the choice back, an install’s exception goes with the install, and a removal comes apart part by part', () => {
  const part = (name: string) => ({ kind: 'skill' as const, name });
  const at = op('pdf', 'pi-cli');
  const plan = [{ ...part('tdd') }, { ...part('grill-me') }, { ...part('qa'), out: true as const }];
  const draft: PluginDraft = new Map();
  const click = (name: string, inTool: string[] = []) => clickPart(draft, at, part(name), { planned: plan.find(planned => planned.name === name), inTool: inTool.map(part) });
  const stand = (name: string, inTool: string[] = []) => { const { chosen, on } = partStand(draft, at, part(name), { planned: plan.find(planned => planned.name === name), inTool: inTool.map(part), canWrite: true }); return [chosen, on]; };
  // Not in the tool: on, then back to nothing chosen.
  click('tdd');
  assert.deepEqual([stand('tdd'), pickOf(draft, at.source, 'pdf', 'pi-cli')], [['on', true], { on: [part('tdd')], off: [] }]);
  click('tdd');
  assert.deepEqual([stand('tdd'), draft.size], [[undefined, false], 0]);
  // In the tool: off, then back.
  click('tdd', ['tdd']);
  assert.deepEqual(stand('tdd', ['tdd']), ['off', false]);
  click('tdd', ['tdd']);
  assert.deepEqual([stand('tdd', ['tdd']), draft.size], [[undefined, true], 0]);
  // All the tool's parts chosen for install: each that would go in waits on; one flipped is the install's exception, and
  // one the person had left out is turned on by its own click. Taking the install back takes its exceptions with it.
  toggle(draft, op('pdf', 'pi-cli', 'install-parts'));
  assert.deepEqual([stand('tdd'), stand('qa')], [['on', true], [undefined, false]]);
  click('tdd');
  click('qa');
  assert.deepEqual([stand('tdd'), stand('qa'), pickOf(draft, at.source, 'pdf', 'pi-cli')], [['off', false], ['on', true], { on: [part('qa')], off: [part('tdd')] }]);
  toggle(draft, op('pdf', 'pi-cli', 'install-parts'));
  assert.equal(draft.size, 0);
  // All its parts chosen for removal: keeping one makes it a choice part by part, without that one.
  toggle(draft, op('pdf', 'pi-cli', 'remove-parts'));
  assert.deepEqual(stand('tdd', ['tdd', 'grill-me']), ['off', false]);
  click('tdd', ['tdd', 'grill-me']);
  assert.deepEqual([queued(draft, at.source, 'pdf', 'pi-cli'), pickOf(draft, at.source, 'pdf', 'pi-cli'), stand('tdd', ['tdd', 'grill-me'])], [undefined, { on: [], off: [part('grill-me')] }, [undefined, true]]);
  // The result names the parts: "skill tdd put into Pi".
  const done: PluginDone[] = [{ ...at, action: 'pick-parts', pick: { on: [part('tdd')], off: [part('qa')] }, report: { tool: 'pi-cli', outcome: 'installed', message: '', runs: [], changed: true, partsRun: 'r' } }];
  assert.equal(resultSentence(resultLines(done), false), 'pdf: skill tdd put into Pi; skill qa taken out of Pi.');
});

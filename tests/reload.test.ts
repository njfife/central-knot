// Reload advice after a skill, MCP server or agent is installed or turned on (reload.ts), as worked examples on the pure
// table/reducer and on real files in throwaway temp homes across every covered route: row writes, opened row join, plugin
// ticks in Pi/OpenCode, profile switches with held destinations, Synchronize everything take-ins vs background catch-up,
// Sync once, History Restore, switched-off copies, and tool-switch enables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyAgents, restoreAgent } from '../src/agents.ts';
import { everythingEntryAction, setSyncEverything } from '../src/everything.ts';
import { readHistory } from '../src/history.ts';
import { homePass, syncOnceReport, takenInReloads } from '../src/homepass.ts';
import { pluginFiles } from '../src/catalogdetail.ts';
import { runItems } from '../src/pluginlibrary.ts';
import { newEntry } from '../src/pluginrecord.ts';
import { NO_PLUGINS, saveProfile, switchProfile } from '../src/profiles.ts';
import { pluginReloads, reloadAdvice, reloadLine, reloadTable, rowReload, writtenReloads } from '../src/reload.ts';
import { applyServers, restoreServer } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, clearSwitch, restoreSkill } from '../src/skills.ts';
import type { HarnessId } from '../src/types.ts';
import type { PluginDone } from '../src/pluginplan.ts';

const ALL_FIVE: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const skillText = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: ${name} skill.\n---\n\n${body}\n`;
const agentText = (name: string, body = 'Help.') => `---\nname: ${name}\ndescription: ${name} agent.\n---\n\n${body}\n`;

async function tempHome(tools: HarnessId[] = ALL_FIVE) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-reload-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/skills', '.copilot/skills', '.codex/skills', '.pi/agent/skills', '.config/opencode/skills']) {
    await mkdir(join(home, folder), { recursive: true });
  }
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { base, home, tools, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Worked example 1: a skill turned on in Claude Code and Pi says only Pi’s sentence with Copy holding /reload', async () => {
  const box = await tempHome(['claude-cli', 'pi-cli']);
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    const pass = await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    const writes = writtenReloads(pass.results, 'skill');
    assert.deepEqual(reloadAdvice(writes), {
      text: 'In Pi, type /reload.',
      actions: [{ tool: 'pi-cli', command: '/reload' }],
    });
    assert.equal(pass.results.find(entry => entry.harness === 'pi-cli')?.message, 'Added. In Pi, type /reload.');
  } finally { await box.cleanup(); }
});

test('Worked example 2 and 5: an MCP server added to all five gives exact sentences in tool order, nothing for Copilot CLI, and the opened row matches each tool', async () => {
  const box = await tempHome(ALL_FIVE);
  try {
    // Seed in a single tool first, then delete its copy? No: seed in Copilot CLI (which gets no reload) or seed via library On across all 5:
    // put in Claude Code then turn on? Wait: if Claude already has it, Claude isn't written!
    // Put in Claude Code, turn on, turn off (so it lives in Central Knot), then turn on to write to all five!
    await put(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs'] } } }));
    await applyServers(box.context, box.tools, [{ key: 'docs', on: true, except: [] }]);
    await applyServers(box.context, box.tools, [{ key: 'docs', on: false, except: [] }]);
    const pass = await applyServers(box.context, box.tools, [{ key: 'docs', on: true, except: [] }]);
    const writes = writtenReloads(pass.results, 'mcp');
    const advice = reloadAdvice(writes);
    assert.equal(advice.text, 'Restart Claude Code (claude --continue keeps the chat). In Codex, type /new or restart it. In Pi, type /reload. Restart OpenCode.');
    assert.deepEqual(advice.actions, [
      { tool: 'claude-cli', command: 'claude --continue' },
      { tool: 'codex-cli', command: '/new' },
      { tool: 'pi-cli', command: '/reload' },
    ]);
    // Per-tool DestinationResult messages replace "Start a new session to use it." with the table's words.
    assert.equal(pass.results.find(entry => entry.harness === 'claude-cli')?.message, 'Added. Restart Claude Code (claude --continue keeps the chat).');
    assert.equal(pass.results.find(entry => entry.harness === 'copilot-cli')?.message, 'Added.');
    assert.equal(pass.results.find(entry => entry.harness === 'codex-cli')?.message, 'Added. In Codex, type /new or restart it.');
    assert.equal(pass.results.find(entry => entry.harness === 'pi-cli')?.message, 'Added. In Pi, type /reload.');
    assert.equal(pass.results.find(entry => entry.harness === 'opencode-cli')?.message, 'Added. Restart OpenCode.');
    // Worked example 5: opened row joined by (kind, row, tool) has the same words as the result, and nothing for another row or with no active result.
    assert.equal(rowReload(writes, 'mcp', 'docs', 'claude-cli'), 'Restart Claude Code (claude --continue keeps the chat).');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'copilot-cli'), '');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'codex-cli'), 'In Codex, type /new or restart it.');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'pi-cli'), 'In Pi, type /reload.');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'opencode-cli'), 'Restart OpenCode.');
    assert.equal(rowReload(writes, 'mcp', 'other', 'claude-cli'), '');
    assert.equal(rowReload(undefined, 'mcp', 'docs', 'claude-cli'), '');
  } finally { await box.cleanup(); }
});

test('Worked example 3: a plugin ticked for Pi that places two skills and an MCP server names Pi once with /reload', async () => {
  const box = await tempHome(['claude-cli', 'pi-cli']);
  try {
    const pluginDir = join(box.base, 'plugin');
    await put(join(pluginDir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit' }));
    await put(join(pluginDir, 'skills/one/SKILL.md'), skillText('one'));
    await put(join(pluginDir, 'skills/two/SKILL.md'), skillText('two'));
    await put(join(pluginDir, '.mcp.json'), JSON.stringify({ mcpServers: { relay: { command: 'npx', args: ['relay'] } } }));
    const entry = newEntry('local/team', 'team', 'kit', true);
    const ran = await runItems(box.context, box.tools, entry, { into: ['pi-cli'], on: true }, { files: await pluginFiles(pluginDir, {}, pluginDir), commitAt: '2026-11-21T00:00:00Z' },
      { source: 'local/team', marketName: 'team', plugin: 'kit', action: 'install-items' });
    const writes = pluginReloads(ran.done);
    assert.ok(writes.some(write => write.kind === 'skill') && writes.some(write => write.kind === 'mcp'), 'both kinds captured before collapsing');
    assert.deepEqual(reloadAdvice(writes), {
      text: 'In Pi, type /reload.',
      actions: [{ tool: 'pi-cli', command: '/reload' }],
    });
    // Unticking / turning Off says nothing.
    const off = await runItems(box.context, box.tools, entry, { outOf: ['pi-cli'], off: true }, { commitAt: '' },
      { source: 'local/team', marketName: 'team', plugin: 'kit', action: 'remove-items' });
    assert.deepEqual(reloadAdvice(pluginReloads(off.done)), { text: '', actions: [] });
  } finally { await box.cleanup(); }
});

test('Worked example 4: nothing written, held, failed, removed, turned off, or written-but-switched-off produces no reload advice', async () => {
  const box = await tempHome(['claude-cli', 'pi-cli', 'opencode-cli']);
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    // Pre-disable notes in Pi's settings.json so the write lands switched off there.
    await put(join(box.home, '.pi/agent/settings.json'), JSON.stringify({ skills: ['-skills/notes'] }));
    // Hold OpenCode by making its skills folder read-only.
    await chmod(join(box.home, '.config/opencode/skills'), 0o555);
    const pass = await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await chmod(join(box.home, '.config/opencode/skills'), 0o755);
    // Claude needs nothing; Pi is switched off; OpenCode failed/held -> zero reload advice.
    assert.deepEqual(reloadAdvice(writtenReloads(pass.results, 'skill')), { text: '', actions: [] });
    assert.equal(pass.results.find(entry => entry.harness === 'pi-cli')?.switchedOff, true);
    assert.doesNotMatch(pass.results.find(entry => entry.harness === 'pi-cli')?.message ?? '', /\/reload/);
    // Second pass with nothing to write: already as asked -> zero reload advice.
    const noop = await applySkills(box.context, ['claude-cli', 'pi-cli'], []);
    assert.deepEqual(reloadAdvice(writtenReloads(noop.results, 'skill')), { text: '', actions: [] });
    // Turn Off -> zero reload advice (Decision 6 withdrawn).
    const off = await applySkills(box.context, ['claude-cli', 'pi-cli'], [{ key: 'notes', on: false, except: [] }]);
    assert.deepEqual(reloadAdvice(writtenReloads(off.results, 'skill')), { text: '', actions: [] });
  } finally {
    await chmod(join(box.home, '.config/opencode/skills'), 0o755).catch(() => {});
    await box.cleanup();
  }
});

test('Worked example 6 and Pi agent rule: an agent in Claude Code and Codex names Codex alone; an agent in Pi takes Pi’s skill line', async () => {
  const box = await tempHome(['claude-cli', 'codex-cli', 'pi-cli']);
  try {
    await put(join(box.home, '.claude/agents/reviewer.md'), agentText('reviewer'));
    const codexOnly = await applyAgents(box.context, ['claude-cli', 'codex-cli'], [{ key: 'reviewer', on: true, except: [] }]);
    assert.deepEqual(reloadAdvice(writtenReloads(codexOnly.results, 'agent')), {
      text: 'In Codex, start a new session.',
      actions: [],
    });
    // Now add Pi too: an agent written to Pi is a skill there, so Pi takes /reload.
    const withPi = await applyAgents(box.context, ['claude-cli', 'codex-cli', 'pi-cli'], []);
    assert.deepEqual(reloadAdvice(writtenReloads(withPi.results, 'agent')), {
      text: 'In Pi, type /reload.',
      actions: [{ tool: 'pi-cli', command: '/reload' }],
    });
    assert.equal(reloadLine('pi-cli', 'agent'), reloadLine('pi-cli', 'skill'));
  } finally { await box.cleanup(); }
});

test('Profile switch: skill and MCP server into Codex while Copilot CLI is held names Codex once with /new and omits Copilot CLI', async () => {
  const box = await tempHome(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    // Seed a skill and an MCP server in Central Knot, both Off.
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [] }]);
    await put(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs'] } } }));
    await applyServers(box.context, box.tools, [{ key: 'docs', on: true, except: [] }]);
    await applyServers(box.context, box.tools, [{ key: 'docs', on: false, except: [] }]);
    const saved = await saveProfile(box.context, { name: 'Dev', items: ['skill:notes', 'mcp:docs'] });
    // Hold Copilot CLI's skills folder so its copy is held.
    await chmod(join(box.home, '.copilot/skills'), 0o555);
    const switched = await switchProfile(box.context, box.tools, saved.id!, NO_PLUGINS);
    await chmod(join(box.home, '.copilot/skills'), 0o755);
    const advice = reloadAdvice(switched.reloads ?? []);
    // Claude got MCP (restart), Codex got skill + MCP (ranked to /new), Copilot's skill was held (and its MCP needs nothing).
    assert.equal(advice.text, 'Restart Claude Code (claude --continue keeps the chat). In Codex, type /new or restart it.');
    assert.deepEqual(advice.actions, [
      { tool: 'claude-cli', command: 'claude --continue' },
      { tool: 'codex-cli', command: '/new' },
    ]);
    assert.doesNotMatch(advice.text, /Copilot/);
  } finally {
    await chmod(join(box.home, '.copilot/skills'), 0o755).catch(() => {});
    await box.cleanup();
  }
});

test('Maximum Copy buttons (four) in tool order, and ranking per tool', () => {
  const allFour = reloadAdvice([
    { tool: 'opencode-cli', kind: 'agent' },
    { tool: 'opencode-cli', kind: 'skill' },
    { tool: 'pi-cli', kind: 'skill' },
    { tool: 'pi-cli', kind: 'mcp' },
    { tool: 'codex-cli', kind: 'skill' },
    { tool: 'codex-cli', kind: 'mcp' },
    { tool: 'copilot-cli', kind: 'mcp' },
    { tool: 'copilot-cli', kind: 'skill' },
    { tool: 'claude-cli', kind: 'skill' },
    { tool: 'claude-cli', kind: 'mcp' },
  ]);
  assert.equal(allFour.text, 'Restart Claude Code (claude --continue keeps the chat). In Copilot CLI, type /skills reload. In Codex, type /new or restart it. In Pi, type /reload. Restart OpenCode.');
  assert.deepEqual(allFour.actions, [
    { tool: 'claude-cli', command: 'claude --continue' },
    { tool: 'copilot-cli', command: '/skills reload' },
    { tool: 'codex-cli', command: '/new' },
    { tool: 'pi-cli', command: '/reload' },
  ]);
  // Every cell in reloadTable has exact expected shape.
  assert.equal(reloadTable['claude-cli'].skill.text, '');
  assert.equal(reloadTable['claude-cli'].agent.text, '');
  assert.equal(reloadTable['copilot-cli'].mcp.text, '');
  assert.equal(reloadTable['copilot-cli'].agent.text, 'In Copilot CLI, start a new session.');
  assert.equal(reloadTable['opencode-cli'].agent.text, 'In OpenCode, start a new session.');
  assert.equal(reloadTable['codex-cli'].skill.text, 'Codex picks it up at the next turn; if not, start a new chat.');
  // Copilot skill + agent -> new session outranks /skills reload.
  assert.deepEqual(reloadAdvice([{ tool: 'copilot-cli', kind: 'skill' }, { tool: 'copilot-cli', kind: 'agent' }]), {
    text: 'In Copilot CLI, start a new session.',
    actions: [],
  });
});

test('Synchronize everything attributes only its own take-ins, not unrelated background catch-up writes; Sync once and History Restore report their confirmed writes', async () => {
  const box = await tempHome(['claude-cli', 'copilot-cli', 'pi-cli']);
  try {
    // An existing On skill never yet applied to Pi (so the pass catches Pi up), while a found skill is in Claude Code and Pi already.
    await put(join(box.home, '.claude/skills/existing/SKILL.md'), skillText('existing'));
    await applySkills(box.context, ['claude-cli', 'copilot-cli'], [{ key: 'existing', on: true, except: [] }]);
    // A found skill in Claude Code and Pi already (missing only in Copilot CLI) -> Synchronize everything takes it in and writes it to Copilot CLI.
    await put(join(box.home, '.claude/skills/fresh/SKILL.md'), skillText('fresh'));
    await put(join(box.home, '.pi/agent/skills/fresh/SKILL.md'), skillText('fresh'));
    await setSyncEverything(box.context, true);
    const pass = await homePass({ ...box.context, reads: new Map() }, box.tools, true);
    // takenInReloads attributes ONLY fresh's write (Copilot CLI), NOT existing's background catch-up write (Pi).
    assert.deepEqual(reloadAdvice(takenInReloads(pass.synced ? [pass.synced] : [])), {
      text: 'In Copilot CLI, type /skills reload.',
      actions: [{ tool: 'copilot-cli', command: '/skills reload' }],
    });
    // Sync once includes every confirmed write in its pass (both Copilot CLI and Pi).
    const once = syncOnceReport(pass.synced ? [pass.synced] : []);
    assert.deepEqual(reloadAdvice(once.reloads ?? []), {
      text: 'In Copilot CLI, type /skills reload. In Pi, type /reload.',
      actions: [{ tool: 'copilot-cli', command: '/skills reload' }, { tool: 'pi-cli', command: '/reload' }],
    });
    // History Restore: delete fresh, then restore it -> writes back to all 3 tools -> Copilot CLI + Pi reload advice.
    await applySkills(box.context, box.tools, [{ key: 'fresh', on: false, except: [], deleted: true }]);
    const deleted = (await readHistory(box.context)).findLast(entry => entry.kind === 'deleted' && entry.key === 'fresh')!;
    const restored = await restoreSkill(box.context, box.tools, deleted.id);
    assert.deepEqual(reloadAdvice(writtenReloads(restored.results, 'skill')), {
      text: 'In Copilot CLI, type /skills reload. In Pi, type /reload.',
      actions: [{ tool: 'copilot-cli', command: '/skills reload' }, { tool: 'pi-cli', command: '/reload' }],
    });
    // Synchronize everything Undo -> Restore via everythingEntryAction: tags results with `of` so Restore carries reload advice.
    const box2 = await tempHome(['claude-cli', 'copilot-cli']);
    try {
      await put(join(box2.home, '.claude/skills/alpha/SKILL.md'), skillText('alpha'));
      await setSyncEverything(box2.context, true);
      await homePass({ ...box2.context, reads: new Map() }, box2.tools, true);
      const switchOn = (await readHistory(box2.context)).findLast(entry => entry.kind === 'everything' && entry.everything?.ruleOn)!;
      const undone = await everythingEntryAction(box2.context, box2.tools, switchOn.id);
      assert.deepEqual(reloadAdvice(writtenReloads(undone.results)), { text: '', actions: [] }, 'Undo removes copies, so no reload advice');
      const undoEntry = (await readHistory(box2.context)).findLast(entry => entry.kind === 'everything' && entry.everything?.undo)!;
      const restoredAll = await everythingEntryAction(box2.context, box2.tools, undoEntry.id);
      assert.deepEqual(reloadAdvice(writtenReloads(restoredAll.results)), {
        text: 'In Copilot CLI, type /skills reload.',
        actions: [{ tool: 'copilot-cli', command: '/skills reload' }],
      });
    } finally { await box2.cleanup(); }
    // Also verify server Restore & agent Restore return confirmed writes.
    await put(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs'] } } }));
    await applyServers(box.context, ['claude-cli', 'pi-cli'], [{ key: 'docs', on: true, except: [] }]);
    await applyServers(box.context, ['claude-cli', 'pi-cli'], [{ key: 'docs', on: false, except: [], deleted: true }]);
    const delServer = (await readHistory(box.context)).findLast(entry => entry.kind === 'deleted' && entry.key === 'mcp:docs')!;
    const resServer = await restoreServer(box.context, ['claude-cli', 'pi-cli'], delServer.id);
    assert.equal(reloadAdvice(writtenReloads(resServer.results, 'mcp')).text, 'Restart Claude Code (claude --continue keeps the chat). In Pi, type /reload.');
    await put(join(box.home, '.claude/agents/helper.md'), agentText('helper'));
    await applyAgents(box.context, ['claude-cli', 'pi-cli'], [{ key: 'helper', on: true, except: [] }]);
    await applyAgents(box.context, ['claude-cli', 'pi-cli'], [{ key: 'helper', on: false, except: [], deleted: true }]);
    const delAgent = (await readHistory(box.context)).findLast(entry => entry.kind === 'deleted' && entry.key === 'agent:helper')!;
    const resAgent = await restoreAgent(box.context, ['claude-cli', 'pi-cli'], delAgent.id);
    assert.equal(reloadAdvice(writtenReloads(resAgent.results, 'agent')).text, 'In Pi, type /reload.');
  } finally { await box.cleanup(); }
});

test('Tool’s own switch turned on counts only when the tool confirmed a change (clearSwitch and plugin item switches)', async () => {
  const box = await tempHome(['claude-cli', 'pi-cli']);
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    await put(join(box.home, '.pi/agent/settings.json'), JSON.stringify({ skills: ['-skills/notes'] }));
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    const cleared = await clearSwitch(box.context, box.tools, 'notes', 'pi-cli', false, 'skill');
    assert.deepEqual(reloadAdvice(writtenReloads(cleared.results, 'skill')), {
      text: 'In Pi, type /reload.',
      actions: [{ tool: 'pi-cli', command: '/reload' }],
    });
    // Plugin item switches: only confirmed changed enables count; already-on (changed falsy), off, or failed do not.
    const step = (action: PluginDone['action'], tool: HarnessId, changed: boolean, outcome: PluginDone['report']['outcome'], extra: Partial<PluginDone> = {}): PluginDone =>
      ({ source: 's', marketName: 'm', plugin: 'p', tool, action, ...extra, report: { tool, outcome, message: '', runs: [], changed } });
    const done: PluginDone[] = [
      step('skill-on', 'copilot-cli', true, 'skill-on', { skill: 'notes' }),
      step('skill-on', 'pi-cli', false, 'skill-on', { skill: 'notes' }), // already on -> not counted
      step('part-on', 'codex-cli', true, 'part-on', { part: { kind: 'mcp', name: 'docs' } }),
      step('part-on', 'claude-cli', true, 'failed', { part: { kind: 'mcp', name: 'docs' } }), // failed -> not counted
      step('skill-off', 'opencode-cli', true, 'skill-off', { skill: 'notes' }), // off -> not counted
    ];
    assert.deepEqual(reloadAdvice(pluginReloads(done)), {
      text: 'In Copilot CLI, type /skills reload. In Codex, type /new or restart it.',
      actions: [{ tool: 'copilot-cli', command: '/skills reload' }, { tool: 'codex-cli', command: '/new' }],
    });
  } finally { await box.cleanup(); }
});

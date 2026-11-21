// Reload advice after a skill, MCP server or agent is installed or turned on (reload.ts), as worked examples on the pure
// table/settler/reducer and on real files in throwaway temp homes across every covered route: row writes, opened row join
// (standalone and plugin rows), chronological settlement across multi-click runs and Undo, whole-plugin enable, first setup's
// Use the latest, Take over with held/disabled destinations, Let <tool> load it, give-back unchanged semantics, profile switches,
// Synchronize everything take-ins vs catch-up, Sync once, and History Restore.
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
import { setWhole, type PluginContext } from '../src/plugins.ts';
import { NO_PLUGINS, saveProfile, switchProfile } from '../src/profiles.ts';
import { destinationReloads, hasReloadAdvice, pluginReloads, reloadAdvice, reloadLine, reloadTable, reloadsFor, rowReload, settleReloads } from '../src/reload.ts';
import { applyServers, restoreServer } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, clearSwitch, restoreSkill, takeOver } from '../src/skills.ts';
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

test('Worked example 1: a skill written to both Claude Code and Pi advises only Pi with chip Pi: /reload', async () => {
  const box = await tempHome(['claude-cli', 'pi-cli']);
  try {
    // Seed in Central Knot as Off, then turn On so both Claude Code and Pi are really written by the click.
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [] }]);
    const pass = await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    assert.equal(pass.results.find(entry => entry.harness === 'claude-cli')?.outcome, 'written', 'Claude Code really written');
    assert.equal(pass.results.find(entry => entry.harness === 'pi-cli')?.outcome, 'written', 'Pi really written');
    const writes = settleReloads(pass.reloads);
    assert.deepEqual(reloadAdvice(writes), {
      text: 'In Pi, type /reload.',
      items: [{ tool: 'pi-cli', text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.' }],
    });
    assert.equal(pass.results.find(entry => entry.harness === 'claude-cli')?.message, 'Added.');
    assert.equal(pass.results.find(entry => entry.harness === 'pi-cli')?.message, 'Added. In Pi, type /reload.');
  } finally { await box.cleanup(); }
});

test('Worked example 2 and 5: an MCP server added to all five gives exact sentences, chips and titles in tool order, nothing for Copilot CLI, and opened row matches each tool', async () => {
  const box = await tempHome(ALL_FIVE);
  try {
    // Seed in Central Knot as Off, then turn On to write to all five tools.
    await put(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs'] } } }));
    await applyServers(box.context, box.tools, [{ key: 'docs', on: true, except: [] }]);
    await applyServers(box.context, box.tools, [{ key: 'docs', on: false, except: [] }]);
    const pass = await applyServers(box.context, box.tools, [{ key: 'docs', on: true, except: [] }]);
    const writes = settleReloads(pass.reloads);
    const advice = reloadAdvice(writes);
    assert.equal(advice.text, 'Restart Claude Code (claude --continue keeps the chat). In Codex, type /new or restart it. In Pi, type /reload. Restart OpenCode.');
    assert.deepEqual(advice.items, [
      { tool: 'claude-cli', text: 'Restart Claude Code (claude --continue keeps the chat).', command: 'claude --continue', chip: 'Claude Code: claude --continue', title: 'Quit Claude Code, then run this in a terminal: it keeps the chat.' },
      { tool: 'codex-cli', text: 'In Codex, type /new or restart it.', command: '/new', chip: 'Codex: /new', title: 'Type this in your Codex session, or restart Codex.' },
      { tool: 'pi-cli', text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.' },
      { tool: 'opencode-cli', text: 'Restart OpenCode.', chip: 'OpenCode: restart', title: 'Restart OpenCode.' },
    ]);
    assert.equal(pass.results.find(entry => entry.harness === 'claude-cli')?.message, 'Added. Restart Claude Code (claude --continue keeps the chat).');
    assert.equal(pass.results.find(entry => entry.harness === 'copilot-cli')?.message, 'Added.');
    assert.equal(pass.results.find(entry => entry.harness === 'codex-cli')?.message, 'Added. In Codex, type /new or restart it.');
    assert.equal(pass.results.find(entry => entry.harness === 'pi-cli')?.message, 'Added. In Pi, type /reload.');
    assert.equal(pass.results.find(entry => entry.harness === 'opencode-cli')?.message, 'Added. Restart OpenCode.');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'claude-cli'), 'Restart Claude Code (claude --continue keeps the chat).');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'copilot-cli'), '');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'codex-cli'), 'In Codex, type /new or restart it.');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'pi-cli'), 'In Pi, type /reload.');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'opencode-cli'), 'Restart OpenCode.');
    assert.equal(rowReload(writes, 'mcp', 'other', 'claude-cli'), '');
    assert.equal(rowReload(undefined, 'mcp', 'docs', 'claude-cli'), '');
  } finally { await box.cleanup(); }
});

test('Item 1: final state decides — On then Off and combined Undo say nothing; plugin ticked Pi, OpenCode, unticked Pi advises only OpenCode', async () => {
  const box = await tempHome(ALL_FIVE);
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    await put(join(box.home, '.claude/skills/other/SKILL.md'), skillText('other'));
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }, { key: 'other', on: true, except: [] }]);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [] }, { key: 'other', on: false, except: [] }]);
    // Run: notes On, then notes Off -> files end Off -> zero reload advice.
    const onPass = await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    const offPass = await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [] }]);
    assert.deepEqual(settleReloads([...onPass.reloads, ...offPass.reloads]), []);
    assert.deepEqual(reloadAdvice(settleReloads([...onPass.reloads, ...offPass.reloads])), { text: '', items: [] });
    // Combined Undo (newest first: restore offPass -> writes files, then restore onPass -> removes files) -> zero reload advice.
    const undoOff = await restoreSkill(box.context, box.tools, offPass.made![0]!);
    const undoOn = await restoreSkill(box.context, box.tools, onPass.made![0]!);
    assert.deepEqual(settleReloads([...undoOff.reloads, ...undoOn.reloads]), []);
    // Another item left On in the same run survives when notes is cancelled.
    const otherOn = await applySkills(box.context, box.tools, [{ key: 'other', on: true, except: [] }]);
    const settledMixed = settleReloads([...onPass.reloads, ...otherOn.reloads, ...offPass.reloads]);
    assert.ok(settledMixed.every(write => write.key === 'other'));
    assert.ok(settledMixed.some(write => write.tool === 'pi-cli'));
    // Plugin ticked Pi, then OpenCode, then unticked Pi in one run -> Pi cancelled, only OpenCode advised.
    const pluginDir = join(box.base, 'plugin');
    await put(join(pluginDir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit' }));
    await put(join(pluginDir, 'skills/one/SKILL.md'), skillText('one'));
    await put(join(pluginDir, 'skills/two/SKILL.md'), skillText('two'));
    await put(join(pluginDir, '.mcp.json'), JSON.stringify({ mcpServers: { relay: { command: 'npx', args: ['relay'] } } }));
    const entry = newEntry('local/team', 'team', 'kit', true);
    const files = { files: await pluginFiles(pluginDir, {}, pluginDir), commitAt: '2026-11-21T00:00:00Z' };
    const piOn = await runItems(box.context, box.tools, entry, { into: ['pi-cli'], on: true }, files,
      { source: 'local/team', marketName: 'team', plugin: 'kit', action: 'install-items' });
    const ocOn = await runItems(box.context, box.tools, entry, { into: ['opencode-cli'], on: true, letIn: true }, files,
      { source: 'local/team', marketName: 'team', plugin: 'kit', action: 'install-items' });
    const piOff = await runItems(box.context, box.tools, entry, { outOf: ['pi-cli'] }, { commitAt: '' },
      { source: 'local/team', marketName: 'team', plugin: 'kit', action: 'remove-items' });
    const settledPlugin = settleReloads(pluginReloads([...piOn.done, ...ocOn.done, ...piOff.done]));
    assert.deepEqual(reloadAdvice(settledPlugin), {
      text: 'Restart OpenCode.',
      items: [{ tool: 'opencode-cli', text: 'Restart OpenCode.', chip: 'OpenCode: restart', title: 'Restart OpenCode.' }],
    });
  } finally { await box.cleanup(); }
});

test('Item 2: enabling a whole Claude Code plugin counts its actually enabled items (including MCP server inside)', async () => {
  const box = await tempHome(['claude-cli']);
  try {
    const cache = join(box.home, '.claude/plugins/cache/team/kit/1.0.0');
    await put(join(cache, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit', version: '1.0.0' }));
    await put(join(cache, 'skills/triage/SKILL.md'), skillText('triage'));
    await put(join(cache, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      plugins: { 'kit@team': [{ scope: 'user', installPath: cache, version: '1.0.0' }] },
    }));
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({
      team: { source: { source: 'directory', path: join(box.base, 'market') } },
    }));
    const settingsPath = join(box.home, '.claude/settings.json');
    await put(settingsPath, JSON.stringify({ enabledPlugins: { 'kit@team': false } }));
    // Stub claude binary that flips enabledPlugins['kit@team'] in HOME/.claude/settings.json.
    const fakeClaude = join(box.base, 'claude');
    await put(fakeClaude, `#!/bin/sh
node -e 'const fs = require("fs"), p = process.env.HOME + "/.claude/settings.json"; const d = JSON.parse(fs.readFileSync(p, "utf8")); d.enabledPlugins[process.argv[3]] = process.argv[2] === "enable"; fs.writeFileSync(p, JSON.stringify(d));' "$@"
`);
    await chmod(fakeClaude, 0o755);
    const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'claude-cli': fakeClaude } };
    const report = await setWhole(pctx, 'team', 'kit', 'claude-cli', true, join(box.base, 'market'));
    assert.equal(report.changed, true);
    const done: PluginDone[] = [{ source: join(box.base, 'market'), marketName: 'team', plugin: 'kit', tool: 'claude-cli', action: 'plugin-on', report }];
    assert.deepEqual(reloadAdvice(settleReloads(pluginReloads(done))), {
      text: 'Restart Claude Code (claude --continue keeps the chat).',
      items: [{ tool: 'claude-cli', text: 'Restart Claude Code (claude --continue keeps the chat).', command: 'claude --continue', chip: 'Claude Code: claude --continue', title: 'Quit Claude Code, then run this in a terminal: it keeps the chat.' }],
    });
    // When the MCP server inside the plugin is denied in Claude Code's settings, enabling the whole plugin omits it -> silence.
    await put(settingsPath, JSON.stringify({ enabledPlugins: { 'kit@team': false }, deniedMcpServers: [{ serverName: 'plugin:kit:issues' }] }));
    const reportDenied = await setWhole(pctx, 'team', 'kit', 'claude-cli', true, join(box.base, 'market'));
    assert.equal(reportDenied.changed, true);
    assert.deepEqual(reloadAdvice(settleReloads(pluginReloads([{ ...done[0]!, report: reportDenied }]))), { text: '', items: [] });
  } finally { await box.cleanup(); }
});

test('Item 3: First setup Use the latest advises only for chosen keys, never unrelated catch-up writes in the same pass', async () => {
  const box = await tempHome(['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli']);
  try {
    // Existing On skill missing in Pi (will be caught up during a full pass).
    await put(join(box.home, '.claude/skills/catchup/SKILL.md'), skillText('catchup'));
    await applySkills(box.context, ['claude-cli', 'copilot-cli', 'codex-cli'], [{ key: 'catchup', on: true, except: [] }]);
    // Differing found skill in Claude Code & Codex (kept out of Pi if chosen with except, or written to Copilot/Pi).
    await put(join(box.home, '.claude/skills/chosen/SKILL.md'), skillText('chosen', 'Newer.'));
    await put(join(box.home, '.codex/skills/chosen/SKILL.md'), skillText('chosen', 'Older.'));
    const pass = await applySkills(box.context, box.tools, [{ key: 'chosen', on: true, except: ['pi-cli'], use: 'claude-cli' }]);
    assert.ok(pass.results.some(entry => entry.item === 'catchup' && entry.harness === 'pi-cli' && entry.outcome === 'written'), 'catchup wrote to Pi');
    const filtered = reloadsFor(pass.reloads, new Set(['chosen']));
    assert.ok(!filtered.some(entry => entry.tool === 'pi-cli'), 'Pi catch-up write excluded');
    assert.deepEqual(reloadAdvice(settleReloads(filtered)).items.map(item => item.tool), ['copilot-cli', 'codex-cli']);
  } finally { await box.cleanup(); }
});

test('Item 4: Take over advises only for tools whose destination write was confirmed, never read-only Pi or re-disabled tools', async () => {
  const box = await tempHome(ALL_FIVE);
  try {
    await put(join(box.home, '.agents/skills/shared-notes/SKILL.md'), skillText('shared-notes'));
    await applySkills(box.context, box.tools, [{ key: 'shared-notes', on: true, except: [] }]);
    // Pre-disable Codex's copy of shared-notes so takeOver re-disables it (heldOff).
    const sharedFile = join(box.home, '.agents/skills/shared-notes/SKILL.md');
    await put(join(box.home, '.codex/config.toml'), `[[skills.config]]\npath = ${JSON.stringify(sharedFile)}\nenabled = false\n`);
    // Make Pi's skills folder read-only so takeOver cannot write Pi.
    await chmod(join(box.home, '.pi/agent/skills'), 0o555);
    const done = await takeOver(box.context, box.tools, 'shared-notes', 'pi-cli');
    await chmod(join(box.home, '.pi/agent/skills'), 0o755);
    const toolsAdvised = reloadAdvice(settleReloads(done.reloads)).items.map(item => item.tool);
    assert.ok(!toolsAdvised.includes('pi-cli'), 'read-only Pi must not be advised');
    assert.ok(!toolsAdvised.includes('codex-cli'), 're-disabled Codex must not be advised');
    assert.deepEqual(toolsAdvised, ['copilot-cli']);
  } finally {
    await chmod(join(box.home, '.pi/agent/skills'), 0o755).catch(() => {});
    await box.cleanup();
  }
});

test('Item 5 and Item 6: clearSwitch says "<Tool> loads it again." and rowReload matches plugin rows without colliding with standalone rows', async () => {
  const box = await tempHome(['claude-cli', 'pi-cli']);
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    await put(join(box.home, '.pi/agent/settings.json'), JSON.stringify({ skills: ['-skills/notes'] }));
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    const cleared = await clearSwitch(box.context, box.tools, 'notes', 'pi-cli', false, 'skill');
    assert.equal(cleared.results[0]?.message, 'Pi loads it again.');
    assert.deepEqual(reloadAdvice(settleReloads(cleared.reloads)), {
      text: 'In Pi, type /reload.',
      items: [{ tool: 'pi-cli', text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.' }],
    });
    // Item 6: plugin row join matches (kind, key, tool, plugin) and stays separate from a standalone row of the same name.
    const writes = settleReloads([
      { tool: 'codex-cli', kind: 'skill', key: 'triage', on: true, plugin: 'issue-tracker@ck-test-market' },
      { tool: 'copilot-cli', kind: 'skill', key: 'triage', on: true },
    ]);
    assert.equal(rowReload(writes, 'skill', 'triage', 'codex-cli', 'issue-tracker@ck-test-market'), 'Codex picks it up at the next turn; if not, start a new chat.');
    assert.equal(rowReload(writes, 'skill', 'triage', 'codex-cli'), '');
    assert.equal(rowReload(writes, 'skill', 'triage', 'copilot-cli'), 'In Copilot CLI, type /skills reload.');
    assert.equal(rowReload(writes, 'skill', 'triage', 'copilot-cli', 'issue-tracker@ck-test-market'), '');
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
    const writes = settleReloads(pluginReloads(ran.done));
    assert.ok(writes.some(write => write.kind === 'skill') && writes.some(write => write.kind === 'mcp'), 'both kinds captured before collapsing');
    assert.deepEqual(reloadAdvice(writes), {
      text: 'In Pi, type /reload.',
      items: [{ tool: 'pi-cli', text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.' }],
    });
    const off = await runItems(box.context, box.tools, entry, { outOf: ['pi-cli'], off: true }, { commitAt: '' },
      { source: 'local/team', marketName: 'team', plugin: 'kit', action: 'remove-items' });
    assert.deepEqual(reloadAdvice(settleReloads(pluginReloads(off.done))), { text: '', items: [] });
  } finally { await box.cleanup(); }
});

test('Worked example 4 and Item 8: nothing written, held, failed, removed, turned off, switched-off, or kept give-back produces no reload advice (and kept give-back never sets unchanged)', async () => {
  const box = await tempHome(['claude-cli', 'pi-cli', 'opencode-cli']);
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    await put(join(box.home, '.pi/agent/settings.json'), JSON.stringify({ skills: ['-skills/notes'] }));
    await chmod(join(box.home, '.config/opencode/skills'), 0o555);
    const pass = await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await chmod(join(box.home, '.config/opencode/skills'), 0o755);
    assert.deepEqual(reloadAdvice(settleReloads(pass.reloads)), { text: '', items: [] });
    assert.equal(pass.results.find(entry => entry.harness === 'pi-cli')?.switchedOff, true);
    assert.doesNotMatch(pass.results.find(entry => entry.harness === 'pi-cli')?.message ?? '', /\/reload/);
    const noop = await applySkills(box.context, ['claude-cli', 'pi-cli'], []);
    assert.deepEqual(reloadAdvice(settleReloads(noop.reloads)), { text: '', items: [] });
    const off = await applySkills(box.context, ['claude-cli', 'pi-cli'], [{ key: 'notes', on: false, except: [] }]);
    assert.deepEqual(reloadAdvice(settleReloads(off.reloads)), { text: '', items: [] });
    // giveBackCopy with identical bytes returns outcome 'kept' (never unchanged: true) and zero reload advice.
    await put(join(box.home, '.claude/skills/twin/SKILL.md'), skillText('twin'));
    await put(join(box.home, '.pi/agent/skills/twin/SKILL.md'), skillText('twin'));
    const added = await applySkills(box.context, ['claude-cli', 'pi-cli'], [{ key: 'twin', on: true, except: [] }]);
    const undone = await restoreSkill(box.context, ['claude-cli', 'pi-cli'], added.made![0]!);
    const kept = undone.results.filter(entry => entry.outcome === 'kept');
    assert.ok(kept.length >= 1, 'giveBackCopy uses outcome kept when identical');
    assert.ok(kept.every(entry => entry.unchanged === undefined), 'kept give-back never sets refusal flag unchanged');
    assert.deepEqual(reloadAdvice(settleReloads(undone.reloads)), { text: '', items: [] });
  } finally {
    await chmod(join(box.home, '.config/opencode/skills'), 0o755).catch(() => {});
    await box.cleanup();
  }
});

test('Worked example 6 and Pi agent rule: an agent written to both Claude Code and Codex advises Codex alone; Pi agent takes Pi’s skill line', async () => {
  const box = await tempHome(['claude-cli', 'codex-cli', 'pi-cli']);
  try {
    // Seed in Central Knot as Off, then turn On so Claude Code and Codex are both really written by the click.
    await put(join(box.home, '.claude/agents/reviewer.md'), agentText('reviewer'));
    await applyAgents(box.context, ['claude-cli', 'codex-cli'], [{ key: 'reviewer', on: true, except: [] }]);
    await applyAgents(box.context, ['claude-cli', 'codex-cli'], [{ key: 'reviewer', on: false, except: [] }]);
    const codexAndClaude = await applyAgents(box.context, ['claude-cli', 'codex-cli'], [{ key: 'reviewer', on: true, except: [] }]);
    assert.equal(codexAndClaude.results.find(entry => entry.harness === 'claude-cli')?.outcome, 'written', 'Claude Code really written');
    assert.equal(codexAndClaude.results.find(entry => entry.harness === 'codex-cli')?.outcome, 'written', 'Codex really written');
    assert.deepEqual(reloadAdvice(settleReloads(codexAndClaude.reloads)), {
      text: 'In Codex, start a new session.',
      items: [{ tool: 'codex-cli', text: 'In Codex, start a new session.', chip: 'Codex: new session', title: 'In Codex, start a new session.' }],
    });
    const withPi = await applyAgents(box.context, ['claude-cli', 'codex-cli', 'pi-cli'], []);
    assert.deepEqual(reloadAdvice(settleReloads(withPi.reloads)), {
      text: 'In Pi, type /reload.',
      items: [{ tool: 'pi-cli', text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.' }],
    });
    assert.equal(reloadLine('pi-cli', 'agent'), reloadLine('pi-cli', 'skill'));
  } finally { await box.cleanup(); }
});

test('Profile switch: skill and MCP server into Codex while Copilot CLI is held names Codex once with /new and omits Copilot CLI', async () => {
  const box = await tempHome(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes'));
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [] }]);
    await put(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs'] } } }));
    await applyServers(box.context, box.tools, [{ key: 'docs', on: true, except: [] }]);
    await applyServers(box.context, box.tools, [{ key: 'docs', on: false, except: [] }]);
    const saved = await saveProfile(box.context, { name: 'Dev', items: ['skill:notes', 'mcp:docs'] });
    await chmod(join(box.home, '.copilot/skills'), 0o555);
    const switched = await switchProfile(box.context, box.tools, saved.id!, NO_PLUGINS);
    await chmod(join(box.home, '.copilot/skills'), 0o755);
    const advice = reloadAdvice(settleReloads(switched.reloads));
    assert.equal(advice.text, 'Restart Claude Code (claude --continue keeps the chat). In Codex, type /new or restart it.');
    assert.deepEqual(advice.items.map(item => [item.tool, item.chip, item.command]), [
      ['claude-cli', 'Claude Code: claude --continue', 'claude --continue'],
      ['codex-cli', 'Codex: /new', '/new'],
    ]);
    assert.doesNotMatch(advice.text, /Copilot/);
  } finally {
    await chmod(join(box.home, '.copilot/skills'), 0o755).catch(() => {});
    await box.cleanup();
  }
});

test('Item 7: every cell’s exact chip, title, command, tool order, ranking, and Codex skill no-chip rule', () => {
  const allFive = reloadAdvice([
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
  assert.equal(allFive.text, 'Restart Claude Code (claude --continue keeps the chat). In Copilot CLI, type /skills reload. In Codex, type /new or restart it. In Pi, type /reload. Restart OpenCode.');
  assert.deepEqual(allFive.items, [
    { tool: 'claude-cli', text: 'Restart Claude Code (claude --continue keeps the chat).', command: 'claude --continue', chip: 'Claude Code: claude --continue', title: 'Quit Claude Code, then run this in a terminal: it keeps the chat.' },
    { tool: 'copilot-cli', text: 'In Copilot CLI, type /skills reload.', command: '/skills reload', chip: 'Copilot CLI: /skills reload', title: 'Type this in your Copilot CLI session.' },
    { tool: 'codex-cli', text: 'In Codex, type /new or restart it.', command: '/new', chip: 'Codex: /new', title: 'Type this in your Codex session, or restart Codex.' },
    { tool: 'pi-cli', text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.' },
    { tool: 'opencode-cli', text: 'Restart OpenCode.', chip: 'OpenCode: restart', title: 'Restart OpenCode.' },
  ]);
  // Plain-word agent chips and Codex skill alone (no chip, still a Show all line).
  assert.deepEqual(reloadAdvice([{ tool: 'copilot-cli', kind: 'agent' }, { tool: 'codex-cli', kind: 'agent' }, { tool: 'opencode-cli', kind: 'agent' }]).items, [
    { tool: 'copilot-cli', text: 'In Copilot CLI, start a new session.', chip: 'Copilot CLI: new session', title: 'In Copilot CLI, start a new session.' },
    { tool: 'codex-cli', text: 'In Codex, start a new session.', chip: 'Codex: new session', title: 'In Codex, start a new session.' },
    { tool: 'opencode-cli', text: 'In OpenCode, start a new session.', chip: 'OpenCode: new session', title: 'In OpenCode, start a new session.' },
  ]);
  assert.deepEqual(reloadAdvice([{ tool: 'codex-cli', kind: 'skill' }]), {
    text: 'Codex picks it up at the next turn; if not, start a new chat.',
    items: [{ tool: 'codex-cli', text: 'Codex picks it up at the next turn; if not, start a new chat.' }],
  });
  // Silence for Claude skill/agent and Copilot MCP -> hasReloadAdvice is false.
  assert.equal(hasReloadAdvice([{ tool: 'claude-cli', kind: 'skill' }, { tool: 'claude-cli', kind: 'agent' }, { tool: 'copilot-cli', kind: 'mcp' }]), false);
  assert.equal(hasReloadAdvice([{ tool: 'codex-cli', kind: 'skill' }]), true);
  assert.equal(reloadTable['claude-cli'].skill.text, '');
  assert.equal(reloadTable['claude-cli'].agent.text, '');
  assert.equal(reloadTable['copilot-cli'].mcp.text, '');
  // Copilot skill + agent -> new session outranks /skills reload.
  assert.deepEqual(reloadAdvice([{ tool: 'copilot-cli', kind: 'skill' }, { tool: 'copilot-cli', kind: 'agent' }]), {
    text: 'In Copilot CLI, start a new session.',
    items: [{ tool: 'copilot-cli', text: 'In Copilot CLI, start a new session.', chip: 'Copilot CLI: new session', title: 'In Copilot CLI, start a new session.' }],
  });
});

test('Synchronize everything attributes only its own take-ins, not unrelated background catch-up writes; Sync once and History Restore report their confirmed writes', async () => {
  const box = await tempHome(['claude-cli', 'copilot-cli', 'pi-cli']);
  try {
    await put(join(box.home, '.claude/skills/existing/SKILL.md'), skillText('existing'));
    await applySkills(box.context, ['claude-cli', 'copilot-cli'], [{ key: 'existing', on: true, except: [] }]);
    await put(join(box.home, '.claude/skills/fresh/SKILL.md'), skillText('fresh'));
    await put(join(box.home, '.pi/agent/skills/fresh/SKILL.md'), skillText('fresh'));
    await setSyncEverything(box.context, true);
    const pass = await homePass({ ...box.context, reads: new Map() }, box.tools, true);
    assert.deepEqual(reloadAdvice(settleReloads(takenInReloads(pass.synced ? [pass.synced] : []))), {
      text: 'In Copilot CLI, type /skills reload.',
      items: [{ tool: 'copilot-cli', text: 'In Copilot CLI, type /skills reload.', command: '/skills reload', chip: 'Copilot CLI: /skills reload', title: 'Type this in your Copilot CLI session.' }],
    });
    const once = syncOnceReport(pass.synced ? [pass.synced] : []);
    assert.deepEqual(reloadAdvice(settleReloads(once.reloads)).items.map(item => [item.tool, item.command]), [
      ['copilot-cli', '/skills reload'], ['pi-cli', '/reload'],
    ]);
    await applySkills(box.context, box.tools, [{ key: 'fresh', on: false, except: [], deleted: true }]);
    const deleted = (await readHistory(box.context)).findLast(entry => entry.kind === 'deleted' && entry.key === 'fresh')!;
    const restored = await restoreSkill(box.context, box.tools, deleted.id);
    assert.deepEqual(reloadAdvice(settleReloads(restored.reloads)).items.map(item => [item.tool, item.command]), [
      ['copilot-cli', '/skills reload'], ['pi-cli', '/reload'],
    ]);
    const box2 = await tempHome(['claude-cli', 'copilot-cli']);
    try {
      await put(join(box2.home, '.claude/skills/alpha/SKILL.md'), skillText('alpha'));
      await setSyncEverything(box2.context, true);
      await homePass({ ...box2.context, reads: new Map() }, box2.tools, true);
      const switchOn = (await readHistory(box2.context)).findLast(entry => entry.kind === 'everything' && entry.everything?.ruleOn)!;
      const undone = await everythingEntryAction(box2.context, box2.tools, switchOn.id);
      assert.deepEqual(reloadAdvice(settleReloads(undone.reloads)), { text: '', items: [] }, 'Undo removes copies, so no reload advice');
      const undoEntry = (await readHistory(box2.context)).findLast(entry => entry.kind === 'everything' && entry.everything?.undo)!;
      const restoredAll = await everythingEntryAction(box2.context, box2.tools, undoEntry.id);
      assert.deepEqual(reloadAdvice(settleReloads(restoredAll.reloads)).items.map(item => [item.tool, item.command]), [['copilot-cli', '/skills reload']]);
    } finally { await box2.cleanup(); }
    await put(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs'] } } }));
    await applyServers(box.context, ['claude-cli', 'pi-cli'], [{ key: 'docs', on: true, except: [] }]);
    await applyServers(box.context, ['claude-cli', 'pi-cli'], [{ key: 'docs', on: false, except: [], deleted: true }]);
    const delServer = (await readHistory(box.context)).findLast(entry => entry.kind === 'deleted' && entry.key === 'mcp:docs')!;
    const resServer = await restoreServer(box.context, ['claude-cli', 'pi-cli'], delServer.id);
    assert.equal(reloadAdvice(settleReloads(resServer.reloads)).text, 'Restart Claude Code (claude --continue keeps the chat). In Pi, type /reload.');
    await put(join(box.home, '.claude/agents/helper.md'), agentText('helper'));
    await applyAgents(box.context, ['claude-cli', 'pi-cli'], [{ key: 'helper', on: true, except: [] }]);
    await applyAgents(box.context, ['claude-cli', 'pi-cli'], [{ key: 'helper', on: false, except: [], deleted: true }]);
    const delAgent = (await readHistory(box.context)).findLast(entry => entry.kind === 'deleted' && entry.key === 'agent:helper')!;
    const resAgent = await restoreAgent(box.context, ['claude-cli', 'pi-cli'], delAgent.id);
    assert.equal(reloadAdvice(settleReloads(resAgent.reloads)).text, 'In Pi, type /reload.');
  } finally { await box.cleanup(); }
});

test('Plugin item switches: confirmed enables advise, disables cancel prior enables, and failed/unchanged do not advise', () => {
  const step = (action: PluginDone['action'], tool: HarnessId, changed: boolean, outcome: PluginDone['report']['outcome'], reloads?: PluginDone['report']['reloads']): PluginDone =>
    ({ source: 's', marketName: 'm', plugin: 'p', tool, action, report: { tool, outcome, message: '', runs: [], changed, ...(reloads ? { reloads } : {}) } });
  const done: PluginDone[] = [
    step('skill-on', 'copilot-cli', true, 'skill-on', [{ tool: 'copilot-cli', kind: 'skill', key: 'notes', on: true, plugin: 'p@m' }]),
    step('skill-on', 'pi-cli', false, 'skill-on', [{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: true, plugin: 'p@m' }]),
    step('part-on', 'codex-cli', true, 'part-on', [{ tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true, plugin: 'p@m' }]),
    step('part-on', 'claude-cli', true, 'failed', [{ tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true, plugin: 'p@m' }]),
    step('skill-off', 'opencode-cli', true, 'skill-off', [{ tool: 'opencode-cli', kind: 'skill', key: 'notes', on: false, plugin: 'p@m' }]),
  ];
  assert.deepEqual(reloadAdvice(settleReloads(pluginReloads(done))).items.map(item => [item.tool, item.command]), [
    ['copilot-cli', '/skills reload'], ['codex-cli', '/new'],
  ]);
  // Verify destinationReloads emits on: false for removals and disabled switches.
  const changes = destinationReloads([
    { item: 'notes', harness: 'pi-cli', outcome: 'written', message: 'Added.' },
    { item: 'notes', harness: 'pi-cli', outcome: 'removed', message: 'Removed.' },
  ], 'skill');
  assert.deepEqual(settleReloads(changes), []);
});

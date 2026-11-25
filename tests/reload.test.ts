// Reload advice after a skill, MCP server or agent is installed or turned on (reload.ts), as worked examples on the pure
// table/settler/reducer and on real files in throwaway temp homes across every covered route: row writes, opened row join
// (standalone and plugin rows), chronological settlement across multi-click runs and Undo, whole-plugin enable, first setup's
// Use the latest, Take over with held/disabled destinations, Let <tool> load it, give-back unchanged semantics, profile switches,
// Synchronize everything take-ins vs catch-up, Sync once, and History Restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyAgents, restoreAgent } from '../src/agents.ts';
import { everythingEntryAction, setSyncEverything } from '../src/everything.ts';
import { readHistory } from '../src/history.ts';
import { homePass, syncOnceReport, takenInReloads } from '../src/homepass.ts';
import { pluginFiles } from '../src/catalogdetail.ts';
import { runItems } from '../src/pluginlibrary.ts';
import { newEntry } from '../src/pluginrecord.ts';
import { install, parseCatalog, setPart, setWhole, update, type PluginContext } from '../src/plugins.ts';
import { NO_PLUGINS, saveProfile, switchProfile, type PluginSide } from '../src/profiles.ts';
import { destinationReloads, hasReloadAdvice, pluginReloads, reloadAdvice, reloadStep, reloadTable, reloadsFor, rowReload, settleReloads, toolWay, waysFrom } from '../src/reload.ts';
import { applyServers, restoreServer } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, clearSwitch, restoreSkill, takeOver } from '../src/skills.ts';
import { addSource, checkSource, previewSource, removeSource, rowClick } from '../src/sources.ts';
import type { HarnessId } from '../src/types.ts';
import type { PluginDone } from '../src/pluginplan.ts';
import { repository, standInHosts } from './sourcerepo.ts';
import { withLock } from './fslock.ts';
import { standIn } from './standin.ts';

const ALL_FIVE: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const skillText = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: ${name} skill.\n---\n\n${body}\n`;
const agentText = (name: string, body = 'Help.') => `---\nname: ${name}\ndescription: ${name} agent.\n---\n\n${body}\n`;
/**
 * Stand-ins for a tool's `plugin enable|disable <id>` (tests/standin.ts), as the tool's own command records it: Claude Code in
 * enabledPlugins in its settings.json, Copilot CLI in its config.json (the plugin by name, or the first). Each is the Node code a
 * shell script runs with `node -e`, or on Windows runs itself.
 */
const CLAUDE_SWITCH = 'const fs = require("fs"), p = process.env.HOME + "/.claude/settings.json"; const d = JSON.parse(fs.readFileSync(p, "utf8")); d.enabledPlugins[process.argv[3]] = process.argv[2] === "enable"; fs.writeFileSync(p, JSON.stringify(d));';
const COPILOT_SWITCH = 'const fs = require("fs"), p = process.env.HOME + "/.copilot/config.json"; const d = JSON.parse(fs.readFileSync(p, "utf8")); const name = process.argv[3].split("@")[0]; for (const e of d.installedPlugins) if (e.name === name) e.enabled = process.argv[2] === "enable"; fs.writeFileSync(p, JSON.stringify(d));';
const COPILOT_FIRST_SWITCH = 'const fs = require("fs"), p = process.env.HOME + "/.copilot/config.json"; const d = JSON.parse(fs.readFileSync(p, "utf8")); d.installedPlugins[0].enabled = process.argv[2] === "enable"; fs.writeFileSync(p, JSON.stringify(d));';
const nodeStandIn = (path: string, js: string) => standIn(path, `#!/bin/sh\nnode -e '${js}' "$@"\n`, js);
/** A stand-in whose every run writes `json` to `target`: a path, or one under `$HOME`, the home it is run in. */
const writesFile = (path: string, json: string, target: string) => standIn(path, `#!/bin/sh\necho '${json}' > "${target}"\n`,
  `require("fs").writeFileSync(${JSON.stringify(target)}.replace("$HOME", () => process.env.HOME), ${JSON.stringify(`${json}\n`)});`);

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
    assert.equal(advice.text, 'Restart Claude Code (claude --continue keeps the chat). In Codex, type /new, or restart it (codex resume --last keeps the chat). In Pi, type /reload. Restart OpenCode (opencode --continue keeps the chat).');
    assert.deepEqual(advice.items, [
      { tool: 'claude-cli', text: 'Restart Claude Code (claude --continue keeps the chat).', command: 'claude --continue', chip: 'Claude Code: claude --continue', title: 'Quit Claude Code, then run this in a terminal: it keeps the chat.' },
      { tool: 'codex-cli', text: 'In Codex, type /new, or restart it (codex resume --last keeps the chat).', command: '/new', chip: 'Codex: /new', title: 'Type this in your Codex session.',
        more: [{ chip: 'codex resume --last', command: 'codex resume --last', title: 'Quit Codex, then run this in a terminal: it keeps the chat.' }] },
      { tool: 'pi-cli', text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.' },
      { tool: 'opencode-cli', text: 'Restart OpenCode (opencode --continue keeps the chat).', command: 'opencode --continue', chip: 'OpenCode: opencode --continue', title: 'Quit OpenCode, then run this in a terminal: it keeps the chat.' },
    ]);
    assert.equal(pass.results.find(entry => entry.harness === 'claude-cli')?.message, 'Added. Restart Claude Code (claude --continue keeps the chat).');
    assert.equal(pass.results.find(entry => entry.harness === 'copilot-cli')?.message, 'Added.');
    assert.equal(pass.results.find(entry => entry.harness === 'codex-cli')?.message, 'Added. In Codex, type /new, or restart it (codex resume --last keeps the chat).');
    assert.equal(pass.results.find(entry => entry.harness === 'pi-cli')?.message, 'Added. In Pi, type /reload.');
    assert.equal(pass.results.find(entry => entry.harness === 'opencode-cli')?.message, 'Added. Restart OpenCode (opencode --continue keeps the chat).');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'claude-cli'), 'Restart Claude Code (claude --continue keeps the chat).');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'copilot-cli'), '');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'codex-cli'), 'In Codex, type /new, or restart it (codex resume --last keeps the chat).');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'pi-cli'), 'In Pi, type /reload.');
    assert.equal(rowReload(writes, 'mcp', 'docs', 'opencode-cli'), 'Restart OpenCode (opencode --continue keeps the chat).');
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
      text: 'Restart OpenCode (opencode --continue keeps the chat).',
      items: [{ tool: 'opencode-cli', text: 'Restart OpenCode (opencode --continue keeps the chat).', command: 'opencode --continue', chip: 'OpenCode: opencode --continue', title: 'Quit OpenCode, then run this in a terminal: it keeps the chat.' }],
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
    const fakeClaude = await nodeStandIn(join(box.base, 'claude'), CLAUDE_SWITCH);
    const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'claude-cli': fakeClaude } };
    const report = await setWhole(pctx, 'team', 'kit', 'claude-cli', true, join(box.base, 'market'));
    assert.equal(report.changed, true);
    const done: PluginDone[] = [{ source: join(box.base, 'market'), marketName: 'team', plugin: 'kit', tool: 'claude-cli', action: 'plugin-on', report }];
    assert.deepEqual(reloadAdvice(settleReloads(pluginReloads(done))), {
      text: 'Restart Claude Code (claude --continue keeps the chat).',
      items: [{ tool: 'claude-cli', text: 'Restart Claude Code (claude --continue keeps the chat).', command: 'claude --continue', chip: 'Claude Code: claude --continue', title: 'Quit Claude Code, then run this in a terminal: it keeps the chat.' }],
    });
    // When the MCP server inside the plugin is denied in Claude Code's settings, enabling the whole plugin leaves only its skill -> /reload-plugins.
    await put(settingsPath, JSON.stringify({ enabledPlugins: { 'kit@team': false }, deniedMcpServers: [{ serverName: 'plugin:kit:issues' }] }));
    const reportDenied = await setWhole(pctx, 'team', 'kit', 'claude-cli', true, join(box.base, 'market'));
    assert.equal(reportDenied.changed, true);
    assert.deepEqual(reloadAdvice(settleReloads(pluginReloads([{ ...done[0]!, report: reportDenied }]))), {
      text: 'In Claude Code, type /reload-plugins.',
      items: [{ tool: 'claude-cli', text: 'In Claude Code, type /reload-plugins.', command: '/reload-plugins', chip: 'Claude Code: /reload-plugins', title: 'Type this in your Claude Code session.' }],
    });
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
    const done = await withLock(join(box.home, '.pi/agent/skills'), 'dir-readonly', () => takeOver(box.context, box.tools, 'shared-notes', 'pi-cli'));
    const toolsAdvised = reloadAdvice(settleReloads(done.reloads)).items.map(item => item.tool);
    assert.ok(!toolsAdvised.includes('pi-cli'), 'read-only Pi must not be advised');
    assert.ok(!toolsAdvised.includes('codex-cli'), 're-disabled Codex must not be advised');
    assert.deepEqual(toolsAdvised, ['copilot-cli']);
  } finally {
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
    const pass = await withLock(join(box.home, '.config/opencode/skills'), 'dir-readonly', () => applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]));
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
    assert.equal(reloadStep('pi-cli', 'agent').text, reloadStep('pi-cli', 'skill').text);
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
    const switched = await withLock(join(box.home, '.copilot/skills'), 'dir-readonly', () => switchProfile(box.context, box.tools, saved.id!, NO_PLUGINS));
    const advice = reloadAdvice(settleReloads(switched.reloads));
    assert.equal(advice.text, 'Restart Claude Code (claude --continue keeps the chat). In Codex, type /new, or restart it (codex resume --last keeps the chat).');
    assert.deepEqual(advice.items.map(item => [item.tool, item.chip, item.command]), [
      ['claude-cli', 'Claude Code: claude --continue', 'claude --continue'],
      ['codex-cli', 'Codex: /new', '/new'],
    ]);
    assert.doesNotMatch(advice.text, /Copilot/);
  } finally {
    await box.cleanup();
  }
});

test('Item 7: every cell’s exact chip, title, command, tool order, ranking, and Codex skill no-chip rule', () => {
  const on = (tool: HarnessId, kind: 'skill' | 'mcp' | 'agent') => ({ tool, kind, on: true });
  const allFive = reloadAdvice([
    on('opencode-cli', 'agent'), on('opencode-cli', 'skill'), on('pi-cli', 'skill'), on('pi-cli', 'mcp'),
    on('codex-cli', 'skill'), on('codex-cli', 'mcp'), on('copilot-cli', 'mcp'), on('copilot-cli', 'skill'),
    on('claude-cli', 'skill'), on('claude-cli', 'mcp'),
  ]);
  assert.equal(allFive.text, 'Restart Claude Code (claude --continue keeps the chat). In Copilot CLI, type /skills reload. In Codex, type /new, or restart it (codex resume --last keeps the chat). In Pi, type /reload. Restart OpenCode (opencode --continue keeps the chat).');
  assert.deepEqual(allFive.items, [
    { tool: 'claude-cli', text: 'Restart Claude Code (claude --continue keeps the chat).', command: 'claude --continue', chip: 'Claude Code: claude --continue', title: 'Quit Claude Code, then run this in a terminal: it keeps the chat.' },
    { tool: 'copilot-cli', text: 'In Copilot CLI, type /skills reload.', command: '/skills reload', chip: 'Copilot CLI: /skills reload', title: 'Type this in your Copilot CLI session.' },
    { tool: 'codex-cli', text: 'In Codex, type /new, or restart it (codex resume --last keeps the chat).', command: '/new', chip: 'Codex: /new', title: 'Type this in your Codex session.',
      more: [{ chip: 'codex resume --last', command: 'codex resume --last', title: 'Quit Codex, then run this in a terminal: it keeps the chat.' }] },
    { tool: 'pi-cli', text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.' },
    { tool: 'opencode-cli', text: 'Restart OpenCode (opencode --continue keeps the chat).', command: 'opencode --continue', chip: 'OpenCode: opencode --continue', title: 'Quit OpenCode, then run this in a terminal: it keeps the chat.' },
  ]);
  // Plain-word agent chips and Codex skill alone (no chip, still a Show all line).
  assert.deepEqual(reloadAdvice([on('copilot-cli', 'agent'), on('codex-cli', 'agent'), on('opencode-cli', 'agent')]).items, [
    { tool: 'copilot-cli', text: 'In Copilot CLI, start a new session.', chip: 'Copilot CLI: new session', title: 'In Copilot CLI, start a new session.' },
    { tool: 'codex-cli', text: 'In Codex, start a new session.', chip: 'Codex: new session', title: 'In Codex, start a new session.' },
    { tool: 'opencode-cli', text: 'In OpenCode, start a new session.', chip: 'OpenCode: new session', title: 'In OpenCode, start a new session.' },
  ]);
  assert.deepEqual(reloadAdvice([on('codex-cli', 'skill')]), {
    text: 'Codex picks it up at the next turn; if not, start a new chat.',
    items: [{ tool: 'codex-cli', text: 'Codex picks it up at the next turn; if not, start a new chat.' }],
  });
  // Silence for Claude skill/agent and Copilot MCP -> hasReloadAdvice is false.
  assert.equal(hasReloadAdvice([on('claude-cli', 'skill'), on('claude-cli', 'agent'), on('copilot-cli', 'mcp')]), false);
  assert.equal(hasReloadAdvice([on('codex-cli', 'skill')]), true);
  assert.equal(reloadTable['claude-cli'].skill.cli.text, '');
  assert.equal(reloadTable['claude-cli'].agent.cli.text, '');
  assert.equal(reloadTable['copilot-cli'].mcp.cli.text, '');
  // Copilot skill + agent -> new session outranks /skills reload.
  assert.deepEqual(reloadAdvice([on('copilot-cli', 'skill'), on('copilot-cli', 'agent')]), {
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

test('Short list 1a: Library sources (Add, Check now, Replace, Bring back, Merge, Remove) carry required reloads', async () => {
  const hosts = await standInHosts(), box = await tempHome(['claude-cli', 'pi-cli']);
  try {
    const link = 'https://github.com/team/reload-source';
    const repo = await repository(hosts, link);
    await repo.commit({ 'SKILL.md': skillText('deslop', 'First.') });
    const preview = await previewSource(box.context, box.tools, link);
    assert.ok('token' in preview);
    const added = await addSource(box.context, box.tools, preview.token);
    assert.deepEqual(added.reloads, [], 'Add brings items in Off with defined empty reloads');
    const sourceId = added.view!.sources[0]!.id;
    // Turn deslop On so subsequent source updates write to Pi.
    await applySkills(box.context, box.tools, [{ key: 'deslop', on: true, except: [] }]);
    await repo.commit({ 'SKILL.md': skillText('deslop', 'Second.') });
    const checked = await checkSource(box.context, async () => box.tools, sourceId, fn => fn());
    assert.deepEqual(reloadAdvice(settleReloads(checked.reloads)).items.map(item => [item.tool, item.command]), [
      ['pi-cli', '/reload'],
    ]);
    // Local edit makes next source update wait; Replace writes source version to Pi and carries Pi reload.
    await put(join(box.home, '.claude/skills/deslop/SKILL.md'), skillText('deslop', 'Local edit.'));
    await applySkills(box.context, box.tools, []);
    await repo.commit({ 'SKILL.md': skillText('deslop', 'Third.') });
    await checkSource(box.context, async () => box.tools, sourceId, fn => fn());
    const replaced = await rowClick(box.context, box.tools, sourceId, 'skill', 'deslop', 'replace');
    assert.deepEqual(reloadAdvice(settleReloads(replaced.reloads)).items.map(item => [item.tool, item.command]), [
      ['pi-cli', '/reload'],
    ]);
    // Delete then Bring back (comes in Off -> empty reloads) and Remove (forgets source -> empty reloads).
    await applySkills(box.context, box.tools, [{ key: 'deslop', on: false, except: [], deleted: true }]);
    const brought = await rowClick(box.context, box.tools, sourceId, 'skill', 'deslop', 'bringBack');
    assert.deepEqual(brought.reloads, []);
    const removed = await removeSource(box.context, box.tools, sourceId);
    assert.deepEqual(removed.reloads, []);
  } finally { await box.cleanup(); await hosts.cleanup(); }
});

test('Short list 2: setWhole keeps empty reloads array and profile switch never guesses when a plugin report has no reloads', async () => {
  const box = await tempHome(['claude-cli']);
  try {
    const installDir = join(box.home, '.claude/plugins/cache/team/empty-kit/1.0.0');
    await put(join(installDir, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2, plugins: { 'empty-kit@team': [{ scope: 'user', installPath: installDir, version: '1.0.0' }] },
    }));
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'directory', path: join(box.base, 'market') } } }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'empty-kit@team': false }, deniedMcpServers: [{ serverName: 'plugin:empty-kit:issues' }] }));
    const fakeClaude = await nodeStandIn(join(box.base, 'claude'), CLAUDE_SWITCH);
    const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'claude-cli': fakeClaude } };
    const report = await setWhole(pctx, 'team', 'empty-kit', 'claude-cli', true, join(box.base, 'market'));
    assert.equal(report.changed, true);
    assert.deepEqual(report.reloads, [], 'setWhole returns empty reloads array rather than omitting it');
    // Profile switch turning on a plugin copy whose tool report has empty/omitted reloads must not guess a change.
    let ran = 0;
    const target = { kind: 'mcp' as const, name: 'issues', tool: 'claude-cli' as const,
      install: { tool: 'claude-cli' as const, plugin: 'empty-kit', marketName: 'team', listed: true, source: join(box.base, 'market'), off: true, items: [{ kind: 'mcp' as const, name: 'issues', description: '' }] } };
    const plugins: PluginSide = {
      live: async () => [{ id: 'plugin:mcp:empty-kit@team/issues', kind: 'mcp', name: 'issues', plugin: 'empty-kit', marketName: 'team',
        copies: [{ tool: 'claude-cli', on: false, way: 'switch' as const, target }] }],
      run: async ops => { ran += ops.length; return ops.map(op => ({ ...op, report: { tool: op.tool, outcome: 'plugin-on' as const, changed: true, message: 'Turned on.', runs: [] } })); },
    };
    const saved = await saveProfile(box.context, { name: 'EmptyPlugin', items: ['plugin:mcp:empty-kit@team/issues'], switchesPluginItems: true });
    const switched = await switchProfile(box.context, ['claude-cli'], saved.id!, plugins);
    assert.equal(ran, 1, 'profile switch ran the installed plugin switch');
    assert.deepEqual(switched.reloads, [], 'installedCopy must not guess a reload change when report.reloads is absent/empty');
  } finally { await box.cleanup(); }
});

test('Short list 3: History giving Pi its own differing copy back while Pi keeps it switched off marks switchedOff and gives no reload advice', async () => {
  const box = await tempHome(['claude-cli', 'pi-cli']);
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skillText('notes', 'Claude version.'));
    await put(join(box.home, '.pi/agent/skills/notes/SKILL.md'), skillText('notes', 'Pi version.'));
    await put(join(box.home, '.pi/agent/settings.json'), JSON.stringify({ skills: ['!*'] }));
    // Choose Claude Code's copy on Add -> overwrites Pi's copy while Pi keeps it switched off, recording Pi's version in tookFrom.
    const added = await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], use: 'claude-cli' }]);
    assert.ok(added.made?.length === 1);
    // Undo the Add -> giveBackCopy writes Pi's differing copy back while Pi still has skills: ['!*'] keeping it switched off.
    const undone = await restoreSkill(box.context, box.tools, added.made![0]!);
    const piResult = undone.results.find(entry => entry.harness === 'pi-cli' && entry.outcome === 'written');
    assert.ok(piResult, 'Pi received its own differing copy back');
    assert.equal(piResult?.switchedOff, true, 'giveBackCopy marks switchedOff when tool switch keeps it off');
    assert.deepEqual(reloadAdvice(settleReloads(undone.reloads)), { text: '', items: [] }, 'switched-off give-back advises nothing');
  } finally { await box.cleanup(); }
});

test('Desktop app only and CLI plus desktop app tailor reload words to what is found across all five tools', () => {
  // toolWay / waysFrom maps discovery snapshots to cli, app, or both.
  assert.equal(toolWay(undefined), 'cli');
  assert.equal(toolWay({ detection: 'Installed' }), 'cli');
  assert.equal(toolWay({ detection: 'Config found but app not detected' }), 'cli');
  assert.equal(toolWay({ detection: 'App only', app: { name: 'Claude desktop', carries: 'Code tab' } }), 'app');
  assert.equal(toolWay({ detection: 'Installed', app: { name: 'Claude desktop', carries: 'Code tab' } }), 'both');
  const ways = waysFrom([
    { harness: 'claude-cli', detection: 'App only', app: { name: 'Claude desktop', carries: 'Code tab' } },
    { harness: 'copilot-cli', detection: 'App only', app: { name: 'GitHub Copilot app', carries: 'Copilot runtime' } },
    { harness: 'codex-cli', detection: 'App only', app: { name: 'ChatGPT desktop', carries: 'Codex' } },
    { harness: 'pi-cli', detection: 'App only', app: { name: 'pi-gui (third-party)', carries: 'Pi' } },
    { harness: 'opencode-cli', detection: 'App only', app: { name: 'OpenCode desktop', carries: 'OpenCode' } },
  ]);
  // Worked example 1: Claude desktop only, MCP server -> restart Claude desktop, no claude --continue.
  const claudeApp = reloadAdvice([{ tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true }], ways);
  assert.deepEqual(claudeApp, {
    text: 'Restart Claude desktop.',
    items: [{ tool: 'claude-cli', text: 'Restart Claude desktop.', chip: 'Claude desktop: restart', title: 'Restart Claude desktop.' }],
  });
  assert.equal(rowReload([{ tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true }], 'mcp', 'docs', 'claude-cli', undefined, ways), 'Restart Claude desktop.');
  // Worked example 2: both CLI and Claude desktop -> names both ways once, claude --continue + desktop restart chip.
  const claudeBoth = reloadAdvice([{ tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true }], { 'claude-cli': 'both' });
  assert.deepEqual(claudeBoth, {
    text: 'Restart Claude Code (claude --continue keeps the chat) or Claude desktop.',
    items: [{
      tool: 'claude-cli', text: 'Restart Claude Code (claude --continue keeps the chat) or Claude desktop.',
      command: 'claude --continue', chip: 'Claude Code: claude --continue', title: 'Quit Claude Code, then run this in a terminal: it keeps the chat.',
      more: [{ chip: 'Claude desktop: restart', title: 'Restart Claude desktop.' }],
    }],
  });
  // ChatGPT desktop only: MCP restarts the app with no /new or codex resume --last; agent starts a new session.
  const codexApp = reloadAdvice([{ tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true }], ways);
  assert.equal(codexApp.text, 'Restart the ChatGPT desktop app.');
  assert.equal(codexApp.items[0]?.command, undefined);
  assert.equal(reloadAdvice([{ tool: 'codex-cli', kind: 'agent', key: 'rev', on: true }], ways).text, 'In ChatGPT desktop, start a new session.');
  assert.equal(reloadAdvice([{ tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true }], { 'codex-cli': 'both' }).text,
    'In Codex, type /new, or restart it (codex resume --last keeps the chat); restart the ChatGPT desktop app if it is open.');
  // GitHub Copilot app only: skill uses /skills reload, MCP and agent restart the app (hasReloadAdvice true for app MCP).
  assert.equal(reloadAdvice([{ tool: 'copilot-cli', kind: 'skill', key: 'notes', on: true }], ways).text, 'In the GitHub Copilot app, type /skills reload.');
  assert.equal(hasReloadAdvice([{ tool: 'copilot-cli', kind: 'mcp', key: 'docs', on: true }], ways), true);
  assert.equal(reloadAdvice([{ tool: 'copilot-cli', kind: 'mcp', key: 'docs', on: true }], ways).text, 'Restart the GitHub Copilot app.');
  assert.equal(reloadAdvice([{ tool: 'copilot-cli', kind: 'mcp', key: 'docs', on: true }], { 'copilot-cli': 'both' }).text,
    'Restart the GitHub Copilot app if it is open.');
  assert.equal(reloadAdvice([{ tool: 'copilot-cli', kind: 'agent', key: 'rev', on: true }], { 'copilot-cli': 'both' }).text,
    'In Copilot CLI, start a new session, or restart the GitHub Copilot app.');
  // pi-gui and OpenCode desktop (unmeasured apps): plain restart, no terminal command; both names CLI command + app restart.
  assert.equal(reloadAdvice([{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: true }], ways).text, 'Restart pi-gui.');
  assert.equal(reloadAdvice([{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: true }], { 'pi-cli': 'both' }).text, 'In Pi, type /reload, or restart pi-gui.');
  assert.equal(reloadAdvice([{ tool: 'opencode-cli', kind: 'skill', key: 'notes', on: true }], ways).text, 'Restart OpenCode desktop.');
  assert.equal(reloadAdvice([{ tool: 'opencode-cli', kind: 'skill', key: 'notes', on: true }], { 'opencode-cli': 'both' }).text,
    'Restart OpenCode (opencode --continue keeps the chat) or OpenCode desktop.');
});

test('Plugin engine messages ask the one reload table for CLI, desktop app only, and turning off', async () => {
  const box = await tempHome(['claude-cli', 'codex-cli']);
  try {
    const claudeCache = join(box.home, '.claude/plugins/cache/team/kit/1.0.0');
    await put(join(claudeCache, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit', version: '1.0.0' }));
    await put(join(claudeCache, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      plugins: { 'kit@team': [{ scope: 'user', installPath: claudeCache, version: '1.0.0' }] },
    }));
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({
      team: { source: { source: 'directory', path: join(box.base, 'market') } },
    }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ deniedMcpServers: [{ serverName: 'plugin:kit:issues' }] }));
    const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: {} };
    const onCli = await setPart(pctx, 'team', 'kit', { kind: 'mcp', name: 'issues' }, 'claude-cli', true, join(box.base, 'market'));
    assert.equal(onCli.outcome, 'part-on');
    assert.equal(onCli.message, 'Turned on in Claude Code. Restart Claude Code (claude --continue keeps the chat).');
    // Turning off adds no reload words.
    const off = await setPart(pctx, 'team', 'kit', { kind: 'mcp', name: 'issues' }, 'claude-cli', false, join(box.base, 'market'));
    assert.equal(off.message, 'Turned off in Claude Code.');
    // With only Claude desktop found, the same plugin MCP switch tells the person to restart Claude desktop.
    const appCtx: PluginContext = { ...pctx, ways: { 'claude-cli': 'app' } };
    const onApp = await setPart(appCtx, 'team', 'kit', { kind: 'mcp', name: 'issues' }, 'claude-cli', true, join(box.base, 'market'));
    assert.equal(onApp.message, 'Turned on in Claude Code. Restart Claude desktop.');
    // Library pass destination message also honours ShareContext.ways.
    await put(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs'] } } }));
    await applyServers(box.context, ['claude-cli'], [{ key: 'docs', on: true, except: [] }]);
    await applyServers(box.context, ['claude-cli'], [{ key: 'docs', on: false, except: [] }]);
    const appPass = await applyServers({ ...box.context, ways: { 'claude-cli': 'app' } }, ['claude-cli'], [{ key: 'docs', on: true, except: [] }]);
    assert.equal(appPass.results.find(entry => entry.harness === 'claude-cli')?.message, 'Added. Restart Claude desktop.');
  } finally { await box.cleanup(); }
});

test('OpenCode skill and MCP restart line offers opencode --continue to copy', () => {
  const skill = reloadAdvice([{ tool: 'opencode-cli', kind: 'skill', key: 'notes', on: true }]);
  assert.equal(skill.text, 'Restart OpenCode (opencode --continue keeps the chat).');
  assert.equal(skill.items[0]?.command, 'opencode --continue');
  assert.equal(skill.items[0]?.chip, 'OpenCode: opencode --continue');
});

test('A plugin skill or agent turned on in Claude Code advises /reload-plugins while standalone stays silent and MCP still outranks it', () => {
  assert.deepEqual(reloadAdvice([{ tool: 'claude-cli', kind: 'skill', key: 'notes', on: true }]), { text: '', items: [] });
  assert.deepEqual(reloadAdvice([{ tool: 'claude-cli', kind: 'agent', key: 'rev', on: true }]), { text: '', items: [] });
  const pluginSkill = reloadAdvice([{ tool: 'claude-cli', kind: 'skill', key: 'triage', on: true, plugin: 'kit@team' }]);
  assert.equal(pluginSkill.text, 'In Claude Code, type /reload-plugins.');
  assert.equal(pluginSkill.items[0]?.command, '/reload-plugins');
  assert.equal(pluginSkill.items[0]?.chip, 'Claude Code: /reload-plugins');
  assert.equal(reloadStep('claude-cli', 'skill', 'app', true).text, 'In Claude desktop’s Code tab, type /reload-plugins or start a new session.');
  assert.equal(reloadStep('claude-cli', 'skill', 'both', true).text, 'In Claude Code or Claude desktop’s Code tab, type /reload-plugins.');
  assert.equal(reloadStep('claude-cli', 'agent', 'cli', true).command, '/reload-plugins');
  // Worked example 6: run of three items across two tools names each tool once with its strongest step.
  const run = reloadAdvice([
    { tool: 'claude-cli', kind: 'skill', key: 'triage', on: true, plugin: 'kit@team' },
    { tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true },
    { tool: 'codex-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'codex-cli', kind: 'agent', key: 'rev', on: true },
    { tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true },
  ]);
  assert.deepEqual(run.items.map(item => [item.tool, item.command]), [['claude-cli', 'claude --continue'], ['codex-cli', '/new']]);
});

test('Codex MCP advises /new or restarting with codex resume --last to copy', () => {
  const mcp = reloadAdvice([{ tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true }]);
  assert.equal(mcp.text, 'In Codex, type /new, or restart it (codex resume --last keeps the chat).');
  assert.equal(mcp.items[0]?.command, '/new');
  assert.deepEqual(mcp.items[0]?.more, [{ chip: 'codex resume --last', command: 'codex resume --last', title: 'Quit Codex, then run this in a terminal: it keeps the chat.' }]);
});

test('Whole plugin install and switch advise plugin-level reload per tool and way in while keeping stronger MCP advice', async () => {
  const box = await tempHome(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    const market = join(box.base, 'market');
    await put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({
      name: 'team', plugins: [
        { name: 'skills-kit', source: './plugins/skills-kit', version: '1.0.0' },
        { name: 'mcp-kit', source: './plugins/mcp-kit', version: '1.0.0' },
      ],
    }));
    await put(join(market, 'plugins/skills-kit/.claude-plugin/plugin.json'), '{"name":"skills-kit","version":"1.0.0"}');
    await put(join(market, 'plugins/skills-kit/skills/triage/SKILL.md'), skillText('triage'));
    await put(join(market, 'plugins/mcp-kit/.claude-plugin/plugin.json'), '{"name":"mcp-kit","version":"1.0.0"}');
    await put(join(market, 'plugins/mcp-kit/.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    const copilotSkills = join(box.home, '.copilot/cache/team/skills-kit');
    const copilotMcp = join(box.home, '.copilot/cache/team/mcp-kit');
    await put(join(copilotSkills, 'skills/triage/SKILL.md'), skillText('triage'));
    await put(join(copilotMcp, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    const copilotCfg = join(box.home, '.copilot/config.json');
    await put(copilotCfg, JSON.stringify({ installedPlugins: [
      { name: 'skills-kit', marketplace: 'team', cache_path: copilotSkills, version: '1.0.0', enabled: false },
      { name: 'mcp-kit', marketplace: 'team', cache_path: copilotMcp, version: '1.0.0', enabled: false },
    ] }));
    const fakeCopilot = await nodeStandIn(join(box.base, 'copilot'), COPILOT_SWITCH);
    const copilotWays: ['cli' | 'app' | 'both', string][] = [
      ['cli', 'In Copilot CLI, start a new session.'],
      ['app', 'Restart the GitHub Copilot app.'],
      ['both', 'In Copilot CLI, start a new session, or restart the GitHub Copilot app.'],
    ];
    for (const [way, expected] of copilotWays) {
      for (const name of ['skills-kit', 'mcp-kit']) {
        await put(copilotCfg, JSON.stringify({ installedPlugins: [
          { name: 'skills-kit', marketplace: 'team', cache_path: copilotSkills, version: '1.0.0', enabled: false },
          { name: 'mcp-kit', marketplace: 'team', cache_path: copilotMcp, version: '1.0.0', enabled: false },
        ] }));
        const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'copilot-cli': fakeCopilot }, ways: { 'copilot-cli': way } };
        const rep = await setWhole(pctx, 'team', name, 'copilot-cli', true, market);
        assert.equal(rep.message, `Turned on in Copilot CLI. ${expected}`, `copilot ${name} ${way}`);
      }
    }
    // Codex whole plugin: skills-only asks for a new session (cli) / restart ChatGPT desktop (app) / both; MCP plugin keeps stronger MCP line.
    await put(join(box.home, '.codex/plugins/cache/team/skills-kit/1.0.0/skills/triage/SKILL.md'), skillText('triage'));
    await put(join(box.home, '.codex/plugins/cache/team/mcp-kit/1.0.0/.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    const codexWays: ['cli' | 'app' | 'both', string, string][] = [
      ['cli', 'In Codex, start a new session.', 'In Codex, type /new, or restart it (codex resume --last keeps the chat).'],
      ['app', 'Restart the ChatGPT desktop app.', 'Restart the ChatGPT desktop app.'],
      ['both', 'In Codex, start a new session; restart the ChatGPT desktop app if it is open.', 'In Codex, type /new, or restart it (codex resume --last keeps the chat); restart the ChatGPT desktop app if it is open.'],
    ];
    for (const [way, forSkills, forMcp] of codexWays) {
      await put(join(box.home, '.codex/config.toml'), '[plugins."skills-kit@team"]\nenabled = false\n\n[plugins."mcp-kit@team"]\nenabled = false\n');
      const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: {}, ways: { 'codex-cli': way } };
      assert.equal((await setWhole(pctx, 'team', 'skills-kit', 'codex-cli', true, market)).message, `Turned on in Codex. ${forSkills}`, `codex skills ${way}`);
      assert.equal((await setWhole(pctx, 'team', 'mcp-kit', 'codex-cli', true, market)).message, `Turned on in Codex. ${forMcp}`, `codex mcp ${way}`);
    }
    // Claude Code whole plugin across all three ways: skills-only asks /reload-plugins; MCP plugin keeps stronger restart line.
    const claudeSkills = join(box.home, '.claude/plugins/cache/team/skills-kit/1.0.0');
    const claudeMcp = join(box.home, '.claude/plugins/cache/team/mcp-kit/1.0.0');
    await put(join(claudeSkills, '.claude-plugin/plugin.json'), '{"name":"skills-kit","version":"1.0.0"}');
    await put(join(claudeSkills, 'skills/triage/SKILL.md'), skillText('triage'));
    await put(join(claudeMcp, '.claude-plugin/plugin.json'), '{"name":"mcp-kit","version":"1.0.0"}');
    await put(join(claudeMcp, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: {
      'skills-kit@team': [{ scope: 'user', installPath: claudeSkills, version: '1.0.0' }],
      'mcp-kit@team': [{ scope: 'user', installPath: claudeMcp, version: '1.0.0' }],
    } }));
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'directory', path: market } } }));
    const fakeClaude = await nodeStandIn(join(box.base, 'claude'), CLAUDE_SWITCH);
    const claudeWays: ['cli' | 'app' | 'both', string, string][] = [
      ['cli', 'In Claude Code, type /reload-plugins.', 'Restart Claude Code (claude --continue keeps the chat).'],
      ['app', 'In Claude desktop’s Code tab, type /reload-plugins or start a new session.', 'Restart Claude desktop.'],
      ['both', 'In Claude Code or Claude desktop’s Code tab, type /reload-plugins.', 'Restart Claude Code (claude --continue keeps the chat) or Claude desktop.'],
    ];
    for (const [way, forSkills, forMcp] of claudeWays) {
      await put(join(box.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'skills-kit@team': false, 'mcp-kit@team': false } }));
      const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'claude-cli': fakeClaude }, ways: { 'claude-cli': way } };
      assert.equal((await setWhole(pctx, 'team', 'skills-kit', 'claude-cli', true, market)).message, `Turned on in Claude Code. ${forSkills}`, `claude skills ${way}`);
      assert.equal((await setWhole(pctx, 'team', 'mcp-kit', 'claude-cli', true, market)).message, `Turned on in Claude Code. ${forMcp}`, `claude mcp ${way}`);
    }
  } finally { await box.cleanup(); }
});

test('A plugin bringing only commands or hooks still says reload words when installed', async () => {
  const box = await tempHome(['claude-cli', 'copilot-cli']);
  try {
    const market = join(box.base, 'market');
    await put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({
      name: 'team', plugins: [
        { name: 'cmd-only', source: './plugins/cmd-only', version: '1.0.0' },
        { name: 'hook-only', source: './plugins/hook-only', version: '1.0.0' },
      ],
    }));
    await put(join(market, 'plugins/cmd-only/.claude-plugin/plugin.json'), '{"name":"cmd-only","version":"1.0.0"}');
    await put(join(market, 'plugins/cmd-only/commands/check.md'), '---\ndescription: Check.\n---\nRun check.\n');
    await put(join(market, 'plugins/hook-only/.claude-plugin/plugin.json'), '{"name":"hook-only","version":"1.0.0"}');
    await put(join(market, 'plugins/hook-only/hooks/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ok' }] }] } }));
    const claudeCache = join(box.home, '.claude/plugins/cache/team/cmd-only/1.0.0');
    await put(join(claudeCache, '.claude-plugin/plugin.json'), '{"name":"cmd-only","version":"1.0.0"}');
    await put(join(claudeCache, 'commands/check.md'), '---\ndescription: Check.\n---\nRun check.\n');
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'directory', path: market } } }));
    const fakeClaude = await writesFile(join(box.base, 'claude'), JSON.stringify({ plugins: { 'cmd-only@team': [{ scope: 'user', installPath: claudeCache, version: '1.0.0' }] } }), '$HOME/.claude/plugins/installed_plugins.json');
    const catalog = await parseCatalog(market, market, 'folder');
    const claudeCtx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'claude-cli': fakeClaude }, ways: { 'claude-cli': 'cli' } };
    const claudeInstall = await install(claudeCtx, catalog, 'cmd-only', 'claude-cli');
    assert.equal(claudeInstall.message, 'Installed, loaded live from the marketplace folder. In Claude Code, type /reload-plugins.');
    assert.ok((claudeInstall.reloads?.length ?? 0) > 0);
    const copilotCache = join(box.home, '.copilot/cache/team/hook-only');
    await put(join(copilotCache, 'hooks/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ok' }] }] } }));
    await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ extraKnownMarketplaces: { team: { source: { source: 'directory', path: market } } } }));
    const fakeCopilot = await writesFile(join(box.base, 'copilot'), JSON.stringify({ installedPlugins: [{ name: 'hook-only', marketplace: 'team', cache_path: copilotCache, version: '1.0.0', enabled: true }] }), '$HOME/.copilot/config.json');
    const copilotCtx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'copilot-cli': fakeCopilot }, ways: { 'copilot-cli': 'cli' } };
    const copilotInstall = await install(copilotCtx, catalog, 'hook-only', 'copilot-cli');
    assert.equal(copilotInstall.message, 'Installed. In Copilot CLI, start a new session.');
    assert.ok((copilotInstall.reloads?.length ?? 0) > 0);
  } finally { await box.cleanup(); }
});

test('Plugin reload wording reads the way in only from context.ways, never misreading apps plus carried binary as both', async () => {
  const box = await tempHome(['claude-cli']);
  try {
    const cache = join(box.home, '.claude/plugins/cache/team/kit/1.0.0');
    await put(join(cache, '.claude-plugin/plugin.json'), '{"name":"kit","version":"1.0.0"}');
    await put(join(cache, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      plugins: { 'kit@team': [{ scope: 'user', installPath: cache, version: '1.0.0' }] },
    }));
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'directory', path: join(box.base, 'market') } } }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ deniedMcpServers: [{ serverName: 'plugin:kit:issues' }] }));
    // When findClis falls back to an app's carried binary, both binaries and apps are set; without context.ways, withNext must not infer 'both'.
    const carriedOnly: PluginContext = {
      home: box.home, dataDir: join(box.base, 'data'),
      binaries: { 'claude-cli': '/Applications/Claude.app/carried/claude' },
      apps: { 'claude-cli': { name: 'Claude desktop', carries: 'Code tab' } },
    };
    const report = await setPart(carriedOnly, 'team', 'kit', { kind: 'mcp', name: 'issues' }, 'claude-cli', true, join(box.base, 'market'));
    assert.equal(report.message, 'Turned on in Claude Code. Restart Claude Code (claude --continue keeps the chat).');
  } finally { await box.cleanup(); }
});

test('Copilot found both ways with a skill and an MCP server in one run keeps both /skills reload and the desktop app restart', () => {
  const combined = reloadAdvice([
    { tool: 'copilot-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'copilot-cli', kind: 'mcp', key: 'docs', on: true },
  ], { 'copilot-cli': 'both' });
  assert.deepEqual(combined, {
    text: 'In Copilot CLI, type /skills reload, or restart the GitHub Copilot app.',
    items: [{
      tool: 'copilot-cli',
      text: 'In Copilot CLI, type /skills reload, or restart the GitHub Copilot app.',
      command: '/skills reload',
      chip: 'Copilot CLI: /skills reload',
      title: 'Type this in your Copilot CLI session.',
      more: [{ chip: 'GitHub Copilot app: restart', title: 'Restart the GitHub Copilot app.' }],
    }],
  });
  // Adding an agent in the same run still chooses the stronger rank-5 step covering both ways.
  const withAgent = reloadAdvice([
    { tool: 'copilot-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'copilot-cli', kind: 'mcp', key: 'docs', on: true },
    { tool: 'copilot-cli', kind: 'agent', key: 'rev', on: true },
  ], { 'copilot-cli': 'both' });
  assert.equal(withAgent.text, 'In Copilot CLI, start a new session, or restart the GitHub Copilot app.');
});

test('A plugin updated while turned off emits no reload changes so no reload chip is shown', async () => {
  const box = await tempHome(['claude-cli']);
  try {
    const market = join(box.base, 'market');
    await put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'kit', source: './plugins/kit', version: '2.0.0' }] }));
    await put(join(market, 'plugins/kit/.claude-plugin/plugin.json'), '{"name":"kit","version":"2.0.0"}');
    await put(join(market, 'plugins/kit/skills/triage/SKILL.md'), skillText('triage', 'v2'));
    const oldCopy = join(box.home, '.claude/plugins/cache/team/kit/1.0.0');
    const newCopy = join(box.home, '.claude/plugins/cache/team/kit/2.0.0');
    await put(join(oldCopy, '.claude-plugin/plugin.json'), '{"name":"kit","version":"1.0.0"}');
    await put(join(oldCopy, 'skills/triage/SKILL.md'), skillText('triage', 'v1'));
    await put(join(newCopy, '.claude-plugin/plugin.json'), '{"name":"kit","version":"2.0.0"}');
    await put(join(newCopy, 'skills/triage/SKILL.md'), skillText('triage', 'v2'));
    const record = join(box.home, '.claude/plugins/installed_plugins.json');
    await put(record, JSON.stringify({ plugins: { 'kit@team': [{ scope: 'user', installPath: oldCopy, version: '1.0.0' }] } }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'kit@team': false } }));
    const fakeClaude = await writesFile(join(box.base, 'claude'), JSON.stringify({ plugins: { 'kit@team': [{ scope: 'user', installPath: newCopy, version: '2.0.0' }] } }), record);
    const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'claude-cli': fakeClaude }, ways: { 'claude-cli': 'cli' } };
    const report = await update(pctx, await parseCatalog(market, market, 'folder'), 'kit', 'claude-cli');
    assert.equal(report.changed, true);
    assert.equal(report.message, 'Updated to 2.0.0. It is still off in Claude Code.');
    assert.deepEqual(report.reloads, []);
    assert.deepEqual(reloadAdvice(settleReloads(pluginReloads([{ source: market, marketName: 'team', plugin: 'kit', tool: 'claude-cli', action: 'update', report }]))), { text: '', items: [] });
  } finally { await box.cleanup(); }
});

test('A whole plugin turned off advises its tool’s plugin row while single-item Off stays silent', async () => {
  const box = await tempHome(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    const market = join(box.base, 'market');
    const claudeCopy = join(box.home, '.claude/plugins/cache/team/kit/1.0.0');
    const copilotCopy = join(box.home, '.copilot/cache/team/kit');
    await put(join(claudeCopy, '.claude-plugin/plugin.json'), '{"name":"kit","version":"1.0.0"}');
    await put(join(claudeCopy, 'skills/triage/SKILL.md'), skillText('triage'));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'kit@team': [{ scope: 'user', installPath: claudeCopy, version: '1.0.0' }] } }));
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'directory', path: market } } }));
    await put(join(copilotCopy, 'skills/triage/SKILL.md'), skillText('triage'));
    await put(join(box.home, '.codex/plugins/cache/team/kit/1.0.0/skills/triage/SKILL.md'), skillText('triage'));
    const fakeClaude = await nodeStandIn(join(box.base, 'claude'), CLAUDE_SWITCH), fakeCopilot = await nodeStandIn(join(box.base, 'copilot'), COPILOT_FIRST_SWITCH);
    const cases: ['claude-cli' | 'copilot-cli' | 'codex-cli', 'cli' | 'app' | 'both', string][] = [
      ['claude-cli', 'cli', 'Turned off in Claude Code. In Claude Code, type /reload-plugins.'],
      ['claude-cli', 'app', 'Turned off in Claude Code. In Claude desktop’s Code tab, type /reload-plugins or start a new session.'],
      ['claude-cli', 'both', 'Turned off in Claude Code. In Claude Code or Claude desktop’s Code tab, type /reload-plugins.'],
      ['copilot-cli', 'cli', 'Turned off in Copilot CLI. In Copilot CLI, start a new session.'],
      ['copilot-cli', 'app', 'Turned off in Copilot CLI. Restart the GitHub Copilot app.'],
      ['copilot-cli', 'both', 'Turned off in Copilot CLI. In Copilot CLI, start a new session, or restart the GitHub Copilot app.'],
      ['codex-cli', 'cli', 'Turned off in Codex. In Codex, start a new session.'],
      ['codex-cli', 'app', 'Turned off in Codex. Restart the ChatGPT desktop app.'],
      ['codex-cli', 'both', 'Turned off in Codex. In Codex, start a new session; restart the ChatGPT desktop app if it is open.'],
    ];
    for (const [tool, way, expected] of cases) {
      await put(join(box.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'kit@team': true } }));
      await put(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'kit', marketplace: 'team', cache_path: copilotCopy, version: '1.0.0', enabled: true }] }));
      await put(join(box.home, '.codex/config.toml'), '[plugins."kit@team"]\nenabled = true\n');
      const pctx: PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'claude-cli': fakeClaude, 'copilot-cli': fakeCopilot }, ways: { [tool]: way } };
      const rep = await setWhole(pctx, 'team', 'kit', tool, false, market);
      assert.equal(rep.message, expected, `${tool} ${way}`);
      assert.deepEqual(settleReloads(rep.reloads ?? []), [], `${tool} ${way}: Off still settles to no header reload chip`);
    }
  } finally { await box.cleanup(); }
});

test('Opened plugin skill row agrees with the header after a whole plugin turns on in Copilot CLI and Codex', () => {
  const copilotWhole = [
    { tool: 'copilot-cli' as const, kind: 'skill' as const, key: 'triage', on: true, plugin: 'kit@team' },
    { tool: 'copilot-cli' as const, kind: 'plugin' as const, on: true, plugin: 'kit@team' },
  ];
  for (const way of ['cli', 'app', 'both'] as const) {
    const ways = { 'copilot-cli': way };
    assert.equal(rowReload(copilotWhole, 'skill', 'triage', 'copilot-cli', 'kit@team', ways), reloadAdvice(copilotWhole, ways).text, `copilot ${way}`);
  }
  const codexWhole = [
    { tool: 'codex-cli' as const, kind: 'skill' as const, key: 'triage', on: true, plugin: 'kit@team' },
    { tool: 'codex-cli' as const, kind: 'plugin' as const, on: true, plugin: 'kit@team' },
  ];
  for (const way of ['cli', 'app', 'both'] as const) {
    const ways = { 'codex-cli': way };
    assert.equal(rowReload(codexWhole, 'skill', 'triage', 'codex-cli', 'kit@team', ways), reloadAdvice(codexWhole, ways).text, `codex ${way}`);
  }
  // Untouched/disabled skill in the same plugin and standalone skill of the same key stay silent; single-skill switch keeps /skills reload.
  assert.equal(rowReload(copilotWhole, 'skill', 'other', 'copilot-cli', 'kit@team'), '');
  assert.equal(rowReload(copilotWhole, 'skill', 'triage', 'copilot-cli'), '');
  assert.equal(rowReload([copilotWhole[0]!], 'skill', 'triage', 'copilot-cli', 'kit@team'), 'In Copilot CLI, type /skills reload.');
});

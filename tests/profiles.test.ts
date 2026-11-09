import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { readHistory } from '../src/manage.ts';
import { mcpDisabled, mcpSwitchPath, withMcpSwitch } from '../src/mcpswitch.ts';
import { planSwitch, type SwitchItem } from '../src/profileplan.ts';
import { deleteProfile, readProfiles, saveProfile, switchProfile, undoProfileSwitch } from '../src/profiles.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

test('Each tool’s MCP switch: off writes its own form, on takes it out, and every other byte stays', () => {
  const before: Record<HarnessId, string> = {
    'claude-cli': '{\n  "model": "opus",\n  "deniedMcpServers": [{ "serverUrl": "https://x.example/*" }]\n}\n',
    'copilot-cli': '{\n  "theme": "dark"\n}\n',
    'codex-cli': '# mine\n[mcp_servers.docs]\ncommand = "docs"\nargs = ["a"] # keep\n\n[mcp_servers.docs.env]\nKEY = "v"\n\n[mcp_servers.other]\ncommand = "o"\nenabled = true\n',
    'pi-cli': '{\n  "mcpServers": {\n    "docs": { "command": "docs" }\n  }\n}\n',
  };
  const off: Record<HarnessId, RegExp> = {
    'claude-cli': /"serverName": "docs"/,
    'copilot-cli': /"disabledMcpServers": \[\s*"docs"\s*\]/,
    'codex-cli': /args = \["a"\] # keep\nenabled = false\n\n\[mcp_servers\.docs\.env\]/,
    'pi-cli': /"enabled": false/,
  };
  for (const tool of Object.keys(before) as HarnessId[]) {
    const disabled = withMcpSwitch(tool, before[tool], 'docs', true);
    assert.match(disabled, off[tool], tool);
    assert.equal(mcpDisabled(tool, disabled, 'docs'), true, tool);
    assert.equal(mcpDisabled(tool, disabled, 'other'), false, `${tool}: only that server`);
    const back = withMcpSwitch(tool, disabled, 'docs', false);
    // A list the switch lives in comes back as the same JSON; elsewhere every byte is as it was.
    if (tool === 'claude-cli') assert.deepEqual(JSON.parse(back), JSON.parse(before[tool]), tool);
    else assert.equal(back, before[tool], tool);
  }
});

const item = (id: string, tools: SwitchItem['tools'], blocked: SwitchItem['blocked'] = {}): SwitchItem => ({ id, kind: id.startsWith('mcp:') ? 'mcp' : 'skill', key: id.slice(id.indexOf(':') + 1), name: id, description: '', tools, blocked });

test('A switch turns off what the profile leaves out, and back on only what a profile turned off', () => {
  const items = [
    item('skill:dev', { 'claude-cli': 'on', 'codex-cli': 'off' }),          // in the profile; Codex off by hand
    item('skill:pager', { 'claude-cli': 'off', 'codex-cli': 'off' }),       // in the profile; Claude Code held off by a profile
    item('mcp:sentry', { 'claude-cli': 'on', 'copilot-cli': 'on' }, { 'copilot-cli': 'unreadable' }),  // left out; Copilot can't switch
  ];
  const held = { 'skill:pager': ['claude-cli' as HarnessId], 'skill:gone': ['codex-cli' as HarnessId] };
  const plan = planSwitch(items, { items: ['skill:dev', 'skill:pager'] }, held);
  assert.deepEqual(plan.flips.map(flip => `${flip.item} ${flip.tool} ${flip.disabled ? 'off' : 'on'}`), ['skill:pager claude-cli on', 'mcp:sentry claude-cli off']);
  assert.deepEqual(plan.blocked.map(entry => `${entry.item} ${entry.tool}`), ['mcp:sentry copilot-cli']);
  // Held: what this switch turned off, and an item not read this time keeps its hold. Off by hand is never held.
  assert.deepEqual(plan.held, { 'skill:gone': ['codex-cli'], 'mcp:sentry': ['claude-cli'] });
  // No profile turns back on everything held that is here, and nothing else.
  const none = planSwitch(items, undefined, { 'skill:pager': ['claude-cli'], 'mcp:sentry': ['claude-cli'] });
  assert.deepEqual(none.flips.map(flip => `${flip.item} ${flip.tool} ${flip.disabled ? 'off' : 'on'}`), ['skill:pager claude-cli on']);
  assert.deepEqual(none.held, {});
});

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-profiles-')));
  const home = join(base, 'home');
  const tools: HarnessId[] = ['claude-cli', 'codex-cli'];
  const context: ShareContext = { home, mode: 'custom', read: () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness }))), build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  for (const [folder, root] of [['dev', '.claude/skills'], ['dev', '.codex/skills'], ['pager', '.claude/skills']]) {
    await mkdir(join(home, root, folder), { recursive: true });
    await writeFile(join(home, root, folder, 'SKILL.md'), `---\nname: ${folder}\ndescription: The ${folder} skill.\n---\n\nBody.\n`);
  }
  await writeFile(join(home, '.claude.json'), '{\n  "mcpServers": { "sentry": { "type": "stdio", "command": "sentry" } }\n}\n');
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(join(home, '.codex/config.toml'), 'model = "gpt"\n\n[mcp_servers.sentry]\ncommand = "sentry"\n');
  await writeFile(join(home, '.claude/settings.json'), '{\n  "theme": "dark"\n}\n');
  return { home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Switching to a profile turns the rest off in each tool’s settings, in one History step that Undo reverses', async () => {
  const box = await sandbox();
  try {
    const files = [join(box.home, '.claude/settings.json'), join(box.home, '.codex/config.toml')];
    const original = await Promise.all(files.map(file => readFile(file, 'utf8')));
    const saved = await saveProfile(box.context, { name: 'Development', items: ['skill:dev'] });
    assert.equal(saved.problem, undefined);
    assert.equal((await saveProfile(box.context, { name: ' development ', items: [] })).problem, 'There is already a profile called “development”.');

    const result = await switchProfile(box.context, saved.id!);
    assert.equal(result.stopped, undefined);
    assert.deepEqual(result.flips.map(flip => `${flip.item} ${flip.tool}`).sort(), ['mcp:sentry claude-cli', 'mcp:sentry codex-cli', 'skill:pager claude-cli']);
    const claude = JSON.parse(await readFile(files[0], 'utf8'));
    assert.deepEqual(claude, { theme: 'dark', skillOverrides: { pager: 'off' }, deniedMcpServers: [{ serverName: 'sentry' }] });
    assert.equal(mcpDisabled('codex-cli', await readFile(mcpSwitchPath(box.context, 'codex-cli'), 'utf8'), 'sentry'), true);
    // The MCP entries themselves are untouched: Claude Code's own file is never written.
    assert.match(await readFile(join(box.home, '.claude.json'), 'utf8'), /"sentry": \{ "type": "stdio", "command": "sentry" \}/);
    const view = await readProfiles(box.home);
    assert.equal(view.active, saved.id);
    assert.deepEqual(view.held, { 'skill:pager': ['claude-cli'], 'mcp:sentry': ['claude-cli', 'codex-cli'] });
    assert.equal((await deleteProfile(box.context, saved.id!)).problem, 'That profile is in use. Switch to another profile, or to No profile, first.');

    const events = (await readHistory(box.home)).filter(event => event.kind === 'profile');
    assert.equal(events.length, 1);
    const undone = await undoProfileSwitch(box.context, events[0].id);
    assert.equal(undone.stopped, undefined);
    // Each settings file holds its earlier switches again (Claude Code's skill switches keep their emptied object).
    assert.deepEqual(JSON.parse(await readFile(files[0], 'utf8')), { theme: 'dark', skillOverrides: {} });
    assert.equal(await readFile(files[1], 'utf8'), original[1]);
    const after = await readProfiles(box.home);
    assert.equal(after.active, undefined);
    assert.deepEqual(after.held, {});
    // The undo is itself a switch: its Undo goes to Development again.
    const redo = (await readHistory(box.home)).at(-1)!;
    assert.equal(redo.kind, 'profile');
    assert.equal((await undoProfileSwitch(box.context, redo.id)).flips.length, 3);
    assert.equal((await readProfiles(box.home)).active, saved.id);
  } finally { await box.cleanup(); }
});

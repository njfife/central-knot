import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyChanges, readHistory, restoreFromHistory } from '../src/manage.ts';
import { applyMcp } from '../src/mcp.ts';
import { mcpDisabled, mcpSwitchPath, withMcpSwitch } from '../src/mcpswitch.ts';
import { choseProfileInUse, holdsOnWhatIsHere, itemKeyOf, offAfterFailures, planSwitch, switchItems, type SwitchItem } from '../src/profileplan.ts';
import { deleteProfile, readProfiles, releaseProfileHolds, saveProfile, switchedByHand, switchProfile, undoProfileSwitch } from '../src/profiles.ts';
import type { ShareContext } from '../src/share.ts';
import { switchState, targetOf } from '../src/skillswitch.ts';
import type { HarnessId, HistoryEvent, SkillFacts } from '../src/types.ts';

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
  // Codex: a server that has its own `enabled` line gets it changed in place, not a second one beside it.
  const otherOff = withMcpSwitch('codex-cli', before['codex-cli'], 'other', true);
  assert.equal(otherOff, before['codex-cli'].replace('enabled = true', 'enabled = false'));
  assert.equal(mcpDisabled('codex-cli', withMcpSwitch('codex-cli', otherOff, 'other', false), 'other'), false);
  // A server removed from the file meanwhile is never made again as a bare switch.
  assert.throws(() => withMcpSwitch('pi-cli', '{ "mcpServers": {} }', 'docs', true), /no "docs" server/);
});

const item = (id: string, tools: SwitchItem['tools'], blocked: SwitchItem['blocked'] = {}): SwitchItem => ({ id, kind: id.startsWith('mcp:') ? 'mcp' : 'skill', key: itemKeyOf(id), name: id, description: '', tools, blocked, blockedFile: {} });

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
  assert.deepEqual(plan.offByProfile, { 'skill:gone': ['codex-cli'], 'mcp:sentry': ['claude-cli'] });
  // No profile turns back on everything held that is here, and nothing else.
  const none = planSwitch(items, undefined, { 'skill:pager': ['claude-cli'], 'mcp:sentry': ['claude-cli'] });
  assert.deepEqual(none.flips.map(flip => `${flip.item} ${flip.tool} ${flip.disabled ? 'off' : 'on'}`), ['skill:pager claude-cli on']);
  assert.deepEqual(none.offByProfile, {});
  // What the home reads becomes items: a tool whose switch can't be read counts as on, and a server that belongs to an app is left out.
  const facts = (key: string, extra: object) => ({ key, name: key, description: '', copies: { 'claude-cli': {}, 'codex-cli': {} }, ...extra }) as unknown as SkillFacts;
  const read = switchItems({ skills: [facts('dev', { disabled: ['claude-cli', 'codex-cli'], switchProblem: { 'codex-cli': 'unreadable' } })] }, { servers: [facts('app', { held: 'ChatGPT' })] });
  assert.deepEqual(read.map(entry => [entry.id, entry.tools]), [['skill:dev', { 'claude-cli': 'off', 'codex-cli': 'on' }]]);
});

test('A flip that failed leaves its switch held or not, as it was', () => {
  // A failed turn-off isn't held; a failed turn-on still is.
  assert.deepEqual(offAfterFailures({ 'skill:a': ['claude-cli'], 'mcp:b': [] }, [{ item: 'skill:a', name: 'a', tool: 'claude-cli', disabled: true }, { item: 'mcp:b', name: 'b', tool: 'codex-cli', disabled: false }]), { 'mcp:b': ['codex-cli'] });
});

test('The switch that chose the profile in use is the latest one still standing that changed it', () => {
  // An undo of an older switch (Undo A after B) changes switches, not the profile, so it chooses nothing.
  const event = (id: string, from?: string, to?: string): HistoryEvent => ({ id, at: '', key: 'profiles:switch', item: '', kind: 'profile', losers: [], orderProved: true, profile: { from, to, flips: [] } });
  const history = [event('A', undefined, 'dev'), event('B', 'dev', 'pager'), event('undoA', 'pager', 'pager')];
  assert.deepEqual(history.map(past => choseProfileInUse(history, past)), [false, true, false]);
});

test('A hold is kept while its tool can’t be read; one on a tool with no copy is kept until No profile', () => {
  const pager = [item('skill:pager', { 'claude-cli': 'on' }, { 'claude-cli': 'unreadable' })];
  const held = { 'skill:pager': ['claude-cli', 'codex-cli'] as HarnessId[] };
  assert.deepEqual(planSwitch(pager, { items: ['skill:pager'] }, held).offByProfile, held);
  assert.deepEqual(planSwitch(pager, undefined, held).offByProfile, { 'skill:pager': ['claude-cli'] });
  // The same holds are left when an Undo lands on No profile; an item gone for good lets go too.
  assert.deepEqual(holdsOnWhatIsHere({ ...held, 'skill:gone': ['claude-cli'] }, pager), { 'skill:pager': ['claude-cli'] });
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
    assert.deepEqual(view.offByProfile, { 'skill:pager': ['claude-cli'], 'mcp:sentry': ['claude-cli', 'codex-cli'] });
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
    assert.deepEqual(after.offByProfile, {});
    // The undo is itself a switch: its Undo goes to Development again.
    const redo = (await readHistory(box.home)).at(-1)!;
    assert.equal(redo.kind, 'profile');
    assert.equal((await undoProfileSwitch(box.context, redo.id)).flips.length, 3);
    assert.equal((await readProfiles(box.home)).active, saved.id);
  } finally { await box.cleanup(); }
});

test('Undo of an older switch keeps what later switches hold, and the profile they chose', async () => {
  const box = await sandbox();
  try {
    const dev = (await saveProfile(box.context, { name: 'Development', items: ['skill:dev'] })).id!;
    const pager = (await saveProfile(box.context, { name: 'Pager', items: ['skill:pager'] })).id!;
    await switchProfile(box.context, dev);
    await switchProfile(box.context, pager);
    // Codex's copy of dev is off by Codex's own skill switch, by its path.
    const devInCodex = targetOf({ folder: 'dev', directory: join(box.home, '.codex/skills/dev') });
    assert.equal(switchState(box.context, 'codex-cli', await readFile(join(box.home, '.codex/config.toml'), 'utf8'), devInCodex), true);
    // Then Development again: the profile in use was chosen by this last switch, not the first.
    await switchProfile(box.context, dev);
    const first = (await readHistory(box.home)).find(event => event.kind === 'profile')!;
    await undoProfileSwitch(box.context, first.id);
    // The first switch's pager flip was made again by later switches, so it is theirs; only sentry goes back on.
    const after = await readProfiles(box.home);
    assert.equal(after.active, dev);
    assert.deepEqual(after.offByProfile, { 'skill:pager': ['claude-cli'] });
  } finally { await box.cleanup(); }
});

test('A switch and its own Undo cancel out: undoing the switch before them goes all the way back', async () => {
  const box = await sandbox();
  try {
    const dev = (await saveProfile(box.context, { name: 'Development', items: ['skill:dev'] })).id!;
    const pager = (await saveProfile(box.context, { name: 'Pager', items: ['skill:pager'] })).id!;
    await switchProfile(box.context, dev);
    const second = (await switchProfile(box.context, pager)).event!;
    await undoProfileSwitch(box.context, second);
    const first = (await readHistory(box.home)).find(event => event.kind === 'profile')!;
    await undoProfileSwitch(box.context, first.id);
    assert.deepEqual(await readProfiles(box.home), { profiles: [{ id: dev, name: 'Development', items: ['skill:dev'] }, { id: pager, name: 'Pager', items: ['skill:pager'] }], offByProfile: {} });
  } finally { await box.cleanup(); }
});

test('Profiles save only the fields given, Undo of Delete keeps the id History names, and an unreadable file is never overwritten', async () => {
  const box = await sandbox();
  try {
    const dev = (await saveProfile(box.context, { name: 'Development', items: ['skill:dev'] })).id!;
    // A rename and a tick sent close together: each changes its own field.
    await saveProfile(box.context, { id: dev, items: ['skill:dev', 'skill:pager'] });
    await saveProfile(box.context, { id: dev, name: 'Dev work' });
    assert.deepEqual((await readProfiles(box.home)).profiles, [{ id: dev, name: 'Dev work', items: ['skill:dev', 'skill:pager'] }]);
    await deleteProfile(box.context, dev);
    await saveProfile(box.context, { id: dev, name: 'Dev work', items: ['skill:dev'], restore: true });
    assert.equal((await readProfiles(box.home)).profiles[0]?.id, dev);
    await writeFile(join(box.home, '.central-knot/profiles.json'), '{ not json');
    assert.match((await saveProfile(box.context, { name: 'Other' })).problem ?? '', /profiles file Central Knot can read/);
    assert.equal(await readFile(join(box.home, '.central-knot/profiles.json'), 'utf8'), '{ not json');
  } finally { await box.cleanup(); }
});

test('A switch set by hand afterwards is the person’s: profiles let go of it', async () => {
  const box = await sandbox();
  try {
    const dev = (await saveProfile(box.context, { name: 'Development', items: ['skill:dev'] })).id!;
    const all = (await saveProfile(box.context, { name: 'Everything', items: ['skill:dev', 'skill:pager', 'mcp:sentry'] })).id!;
    await switchProfile(box.context, dev);
    // On the Skills page: pager enabled in Claude Code by hand, then that Enable undone in History (as main.ts does after each).
    const enable = [{ key: 'pager', managed: false, off: [], disabled: [] }];
    await releaseProfileHolds(box.context, switchedByHand(enable, (await applyChanges(box.context, enable)).results));
    const enabled = (await readHistory(box.home)).filter(event => event.kind === 'switched').at(-1)!;
    await releaseProfileHolds(box.context, switchedByHand([{ key: 'pager' }], (await restoreFromHistory(box.context, enabled.id)).results));
    assert.equal((await readProfiles(box.home)).offByProfile['skill:pager'], undefined);
    // Undo of the switch leaves pager as set by hand, too: an Enable and its Undo are both choices made by hand.
    const switched = (await readHistory(box.home)).find(event => event.kind === 'profile')!;
    assert.ok(!(await undoProfileSwitch(box.context, switched.id)).flips.some(flip => flip.item === 'skill:pager'));
    await switchProfile(box.context, dev);
    const result = await switchProfile(box.context, all);
    assert.deepEqual(result.flips.map(flip => flip.item).sort(), ['mcp:sentry', 'mcp:sentry'], 'pager stays off: it was last set by hand');
    // Turned back on in the tool's own settings, then the switch that turned it off undone: profiles no longer hold it.
    const offAgain = (await switchProfile(box.context, dev)).event!;
    await writeFile(mcpSwitchPath(box.context, 'codex-cli'), (await readFile(mcpSwitchPath(box.context, 'codex-cli'), 'utf8')).replace('enabled = false\n', ''));
    await undoProfileSwitch(box.context, offAgain);
    assert.equal((await readProfiles(box.home)).offByProfile['mcp:sentry'], undefined);
  } finally { await box.cleanup(); }
});

test('A managed MCP server a profile turned off keeps syncing, and stays off', async () => {
  const box = await sandbox();
  try {
    const tools: HarnessId[] = ['claude-cli', 'codex-cli'];
    assert.equal((await applyMcp(box.context, tools, [{ key: 'sentry', managed: true, off: [] }])).stopped, undefined);
    await switchProfile(box.context, (await saveProfile(box.context, { name: 'Development', items: ['skill:dev'] })).id!);
    // An edit in Claude Code's own file spreads to Codex, whose entry keeps its enabled = false.
    await writeFile(join(box.home, '.claude.json'), '{\n  "mcpServers": { "sentry": { "type": "stdio", "command": "sentry", "args": ["--v2"] } }\n}\n');
    await applyMcp(box.context, tools, []);
    const codex = await readFile(mcpSwitchPath(box.context, 'codex-cli'), 'utf8');
    assert.match(codex, /\[mcp_servers\.sentry\]\ncommand = "sentry"\nargs = \["--v2"\]\nenabled = false\n/);
    assert.equal(mcpDisabled('codex-cli', codex, 'sentry'), true);
  } finally { await box.cleanup(); }
});

test('A settings file that can’t be written fails only its own flips, and an Undo that put nothing back can be tried again', { skip: process.getuid?.() === 0 || process.platform === 'win32' }, async () => {
  const box = await sandbox();
  const folders = [join(box.home, '.claude'), join(box.home, '.codex')];
  try {
    const settings = join(box.home, '.claude/settings.json');
    const before = await readFile(settings, 'utf8');
    await chmod(folders[0], 0o555);
    const result = await switchProfile(box.context, (await saveProfile(box.context, { name: 'Development', items: ['skill:dev'] })).id!);
    assert.equal(await readFile(settings, 'utf8'), before);
    assert.deepEqual(result.results.filter(entry => entry.outcome === 'failed').map(entry => `${entry.item} ${entry.harness}`).sort(), ['pager claude-cli', 'sentry claude-cli']);
    assert.deepEqual(result.flips.map(flip => `${flip.item} ${flip.tool}`), ['mcp:sentry codex-cli']);
    assert.deepEqual((await readProfiles(box.home)).offByProfile, { 'mcp:sentry': ['codex-cli'] });
    // Then Pager is chosen, and the Development switch is undone while neither file can be written: its one flip (Codex's sentry)
    // fails and the profile in use stays Pager, so nothing changed and the switch can still be undone later.
    await chmod(folders[0], 0o755);
    await switchProfile(box.context, (await saveProfile(box.context, { name: 'Pager', items: ['skill:pager'] })).id!);
    for (const folder of folders) await chmod(folder, 0o555);
    assert.match((await undoProfileSwitch(box.context, result.event!)).stopped ?? '', /^Nothing was undone: /);
    assert.equal((await readHistory(box.home)).find(event => event.id === result.event)?.undoneBy, undefined);
  } finally { for (const folder of folders) await chmod(folder, 0o755); await box.cleanup(); }
});

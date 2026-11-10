import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyChanges, manageView, readHistory, restoreFromHistory } from '../src/manage.ts';
import { isDisabled, readSwitchFile, setDisabled, switchPath, unverifiedBuild } from '../src/skillswitch.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const all: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'];
const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

async function sandbox(tools: HarnessId[]) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-switch-')));
  const home = join(base, 'home');
  for (const dir of ['.claude', '.copilot', '.codex', '.pi/agent']) await mkdir(join(home, dir), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness }))), build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
const skillsDir = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills', 'pi-cli': '.pi/agent/skills' } as const;
async function skill(home: string, tool: HarnessId, folder: string, content = text(folder)) {
  await mkdir(join(home, skillsDir[tool], folder), { recursive: true });
  await writeFile(join(home, skillsDir[tool], folder, 'SKILL.md'), content);
}

test('Each tool’s switch: Disable writes its own form, Enable takes it out, and every other byte stays', async () => {
  const box = await sandbox(all);
  try {
    // What each tool's switch file already holds, including its own comments and unrelated settings.
    const before: Record<HarnessId, string> = {
      'claude-cli': '{\n  "model": "opus",\n  "skillOverrides": { "other": "name-only" }\n}\n',
      'copilot-cli': '{\n  "disabledSkills": ["other"],\n  "theme": "dark"\n}\n',
      'codex-cli': '# my settings\nmodel = "gpt"\n\n[mcp_servers.docs]\ncommand = "docs"\n',
      'pi-cli': '{\n  "skills": ["-skills/other/SKILL.md"]\n}\n',
    };
    const expected: Record<HarnessId, RegExp> = {
      'claude-cli': /"alpha": "off"/,
      'copilot-cli': /"other",\s*"Alpha Skill"/,
      'codex-cli': /\[\[skills\.config\]\]\npath = ".*\/\.codex\/skills\/alpha\/SKILL\.md"\nenabled = false\n$/,
      'pi-cli': /"-skills\/alpha\/SKILL\.md"/,
    };
    for (const tool of all) {
      await writeFile(switchPath(box.context, tool), before[tool]);
      const target = { folder: 'alpha', name: 'Alpha Skill', skillFile: join(box.home, skillsDir[tool], 'alpha/SKILL.md') };
      await setDisabled(box.context, tool, target, true);
      const after = await readFile(switchPath(box.context, tool), 'utf8');
      assert.match(after, expected[tool], tool);
      assert.equal(isDisabled(box.context, await readSwitchFile(box.context, tool), target), true, tool);
      assert.equal(isDisabled(box.context, await readSwitchFile(box.context, tool), { ...target, folder: 'beta', name: 'beta', skillFile: target.skillFile.replace('alpha', 'beta') }), false, `${tool}: only that skill`);
      await setDisabled(box.context, tool, target, false);
      // A list the switch lives in is written back as a JSON list (same values, new layout); otherwise every byte is as it was.
      const now = await readFile(switchPath(box.context, tool), 'utf8');
      if (tool === 'copilot-cli' || tool === 'pi-cli') assert.deepEqual(JSON.parse(now), JSON.parse(before[tool]), tool);
      else assert.equal(now, before[tool], tool);
    }
    // Claude Code: an override the skill already had ("name-only") comes back on Enable, not plain "on".
    const claude = switchPath(box.context, 'claude-cli');
    await writeFile(claude, '{ "skillOverrides": { "alpha": "name-only" } }\n');
    const target = { folder: 'alpha', name: 'alpha', skillFile: join(box.home, '.claude/skills/alpha/SKILL.md') };
    const { previous } = await setDisabled(box.context, 'claude-cli', target, true);
    await setDisabled(box.context, 'claude-cli', target, false, previous);
    assert.equal(await readFile(claude, 'utf8'), '{ "skillOverrides": { "alpha": "name-only" } }\n');
    // Pi: its folder form and a ~/ path name the same copy; Enable takes out only the exclusion, not a + include the person wrote.
    const pi = switchPath(box.context, 'pi-cli');
    await writeFile(pi, '{ "skills": ["-~/.pi/agent/skills/alpha", "+skills/alpha/SKILL.md"] }\n');
    const piTarget = { folder: 'alpha', name: 'alpha', skillFile: join(box.home, '.pi/agent/skills/alpha/SKILL.md') };
    assert.equal(isDisabled(box.context, await readSwitchFile(box.context, 'pi-cli'), piTarget), true);
    await setDisabled(box.context, 'pi-cli', piTarget, false);
    assert.deepEqual(JSON.parse(await readFile(pi, 'utf8')).skills, ['+skills/alpha/SKILL.md']);
    // A byte-order mark (some Windows editors add one) is kept.
    await writeFile(claude, '\uFEFF{ "model": "opus" }\n');
    await setDisabled(box.context, 'claude-cli', target, true);
    assert.ok((await readFile(claude, 'utf8')).startsWith('\uFEFF{'));
    // Below the build where each switch was seen working, or with no build read, a note says so; nothing more.
    assert.deepEqual(['2.1.300', '2.1.311', '2.2.0', undefined].map(version => !!unverifiedBuild('claude-cli', version)), [true, false, false, true]);
  } finally { await box.cleanup(); }
});

test('Disable is best effort: a build older than the one verified only gets a note, and the switch is still written', async () => {
  const box = await sandbox(['claude-cli', 'codex-cli']);
  const read = box.context.read;
  box.context.read = async () => (await read()).map(snapshot => snapshot.harness === 'codex-cli' ? { ...snapshot, probe: { ...snapshot.probe, version: '0.100.0' } } : snapshot);
  try {
    await skill(box.home, 'claude-cli', 'notes');
    await applyChanges(box.context, [{ key: 'notes', managed: true, off: [] }]);
    assert.match((await manageView(box.context)).skills.find(item => item.key === 'notes')!.disableUnverified?.['codex-cli'] ?? '', /Not checked on this version of Codex \(0\.100\.0\)/);
    const result = await applyChanges(box.context, [{ key: 'notes', managed: true, off: [], disable: ['codex-cli'] }]);
    assert.ok(result.results.some(entry => entry.outcome === 'switched' && entry.harness === 'codex-cli'), JSON.stringify(result));
    assert.deepEqual((await manageView(box.context)).skills.find(item => item.key === 'notes')!.disabled, ['codex-cli']);
  } finally { await box.cleanup(); }
});

test('Codex: a name rule is overruled by a path rule, the person’s own rule keeps its comments, other tables stay, and another form is left alone', async () => {
  const box = await sandbox(['codex-cli']);
  try {
    const file = switchPath(box.context, 'codex-cli');
    const target = { folder: 'alpha', name: 'alpha', skillFile: join(box.home, '.codex/skills/alpha/SKILL.md') };
    await writeFile(file, '[[skills.config]]\nname = "alpha"\nenabled = false\n');
    assert.equal(isDisabled(box.context, await readSwitchFile(box.context, 'codex-cli'), target), true);
    await setDisabled(box.context, 'codex-cli', target, false);
    assert.match(await readFile(file, 'utf8'), /name = "alpha"\nenabled = false\n\n\[\[skills\.config\]\]\npath = ".*"\nenabled = true\n$/);
    // The person's own rule for this path: only its value changes, and back.
    const own = `# mine\n[[skills.config]]\npath = ${JSON.stringify(target.skillFile)}\n# keep this\nenabled = true # on for now\n\n[mcp_servers.docs]\ncommand = "docs"\n`;
    await writeFile(file, own);
    await setDisabled(box.context, 'codex-cli', target, true);
    assert.equal(await readFile(file, 'utf8'), own.replace('enabled = true', 'enabled = false'));
    await setDisabled(box.context, 'codex-cli', target, false);
    assert.equal(await readFile(file, 'utf8'), own);
    // Even one with nothing but an inline comment is theirs; and Windows line ends stay Windows line ends.
    for (const theirs of [`[[skills.config]]\npath = ${JSON.stringify(target.skillFile)}\nenabled = true # mine\n`, 'a = 1\r\n']) {
      await writeFile(file, theirs);
      await setDisabled(box.context, 'codex-cli', target, true);
      await setDisabled(box.context, 'codex-cli', target, false);
      assert.equal(await readFile(file, 'utf8'), theirs);
    }
    // A rule Central Knot added, with a table added after it meanwhile: Enable takes out only the rule.
    await writeFile(file, 'a = 1\n');
    await setDisabled(box.context, 'codex-cli', target, true);
    await writeFile(file, `${await readFile(file, 'utf8')}\n[mcp_servers.x]\ncommand = "x"\n`);
    await setDisabled(box.context, 'codex-cli', target, false);
    assert.equal(await readFile(file, 'utf8'), 'a = 1\n\n[mcp_servers.x]\ncommand = "x"\n');
    await writeFile(file, 'skills = { config = [] }\n');
    assert.match((await readSwitchFile(box.context, 'codex-cli')).problem?.reason ?? '', /form Central Knot doesn’t edit\.$/);
    await assert.rejects(setDisabled(box.context, 'codex-cli', target, true));
    assert.equal(await readFile(file, 'utf8'), 'skills = { config = [] }\n');
  } finally { await box.cleanup(); }
});

test('Managed and disabled in two tools: each copy arrives switched off (Codex by path, Copilot by its name), keeps receiving edits, and Undo enables them', async () => {
  const box = await sandbox(['claude-cli', 'codex-cli', 'copilot-cli']);
  try {
    // Copilot names a skill by its frontmatter name, which here differs from the folder.
    await skill(box.home, 'claude-cli', 'notes', text('Notes Helper'));
    // A Disable that can't happen (Codex's skill rules in a form not edited here) changes nothing at all, so no copy arrives enabled.
    await writeFile(join(box.home, '.codex/config.toml'), 'skills = { config = [] }\n');
    const held = await applyChanges(box.context, [{ key: 'notes', managed: true, off: [], disable: ['codex-cli'] }]);
    assert.ok(held.results.some(entry => entry.outcome === 'held' && /Nothing was changed/.test(entry.message)), JSON.stringify(held));
    assert.deepEqual([(await manageView(box.context)).skills.find(item => item.key === 'notes')!.managed, held.harnessWrites], [false, 0]);
    await rm(join(box.home, '.codex/config.toml'));
    const result = await applyChanges(box.context, [{ key: 'notes', managed: true, off: [], disable: ['codex-cli', 'copilot-cli'] }]);
    assert.equal(result.results.filter(entry => entry.outcome === 'switched').length, 2, JSON.stringify(result));
    const copy = join(box.home, '.codex/skills/notes/SKILL.md');
    assert.equal(await readFile(copy, 'utf8'), text('Notes Helper'));
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes(`path = ${JSON.stringify(copy)}\nenabled = false`));
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.copilot/settings.json'), 'utf8')).disabledSkills, ['Notes Helper']);
    let notes = (await manageView(box.context)).skills.find(item => item.key === 'notes')!;
    assert.deepEqual([notes.managed, notes.disabled], [true, ['codex-cli', 'copilot-cli']]);
    // Disable is not exclusion: an edit still reaches the disabled copy.
    await writeFile(join(box.home, '.claude/skills/notes/SKILL.md'), text('Notes Helper', 'Edited.'));
    await applyChanges(box.context, []);
    await applyChanges(box.context, []);
    assert.equal(await readFile(copy, 'utf8'), text('Notes Helper', 'Edited.'));
    const switched = (await readHistory(box.context)).find(event => event.kind === 'switched')!;
    assert.equal((await restoreFromHistory(box.context, switched.id)).stopped, undefined);
    notes = (await manageView(box.context)).skills.find(item => item.key === 'notes')!;
    assert.equal(notes.disabled, undefined);
  } finally { await box.cleanup(); }
});

test('Remove from one tool: unmanaged or managed, only that copy goes, nothing brings it back, and Restore puts it back', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    await skill(box.home, 'claude-cli', 'loose'); await skill(box.home, 'copilot-cli', 'loose');
    await skill(box.home, 'claude-cli', 'kept');
    await applyChanges(box.context, [{ key: 'kept', managed: true, off: [] }]);
    const result = await applyChanges(box.context, [
      { key: 'loose', managed: false, off: [], remove: ['copilot-cli'], disable: ['claude-cli'] },
      { key: 'kept', managed: true, off: [], remove: ['copilot-cli'], seenManaged: true },
    ]);
    assert.equal(result.results.filter(entry => entry.outcome === 'removed').length, 2, JSON.stringify(result));
    // Disable works on an unmanaged skill too, beside its removal elsewhere.
    assert.deepEqual((await manageView(box.context)).skills.find(item => item.key === 'loose')!.disabled, ['claude-cli']);
    // A later pass neither re-adds the managed copy nor reads its removal as a deletion to spread.
    await applyChanges(box.context, []);
    await applyChanges(box.context, []);
    const view = await manageView(box.context);
    for (const key of ['loose', 'kept']) {
      const facts = view.skills.find(item => item.key === key)!;
      assert.ok(facts.copies['claude-cli'] && !facts.copies['copilot-cli'], key);
    }
    assert.deepEqual(view.skills.find(item => item.key === 'kept')!.off, ['copilot-cli']);
    for (const removed of (await readHistory(box.context)).filter(event => event.kind === 'removed')) {
      assert.equal((await restoreFromHistory(box.context, removed.id)).stopped, undefined);
    }
    assert.equal(await readFile(join(box.home, '.copilot/skills/loose/SKILL.md'), 'utf8'), text('loose'));
    const kept = (await manageView(box.context)).skills.find(item => item.key === 'kept')!;
    assert.deepEqual([kept.managed, kept.off, !!kept.copies['copilot-cli']], [true, [], true]);
    await applyChanges(box.context, []);
    // Removing a managed skill's every copy unmanages it, quietly; Restore puts both back and manages it again.
    await skill(box.home, 'claude-cli', 'whole');
    await applyChanges(box.context, [{ key: 'whole', managed: true, off: [] }]);
    const gone = await applyChanges(box.context, [{ key: 'whole', managed: true, off: [], remove: ['claude-cli', 'copilot-cli'], seenManaged: true }]);
    assert.deepEqual(gone.results.map(entry => entry.outcome), ['removed', 'removed'], JSON.stringify(gone));
    assert.equal((await manageView(box.context)).skills.some(item => item.key === 'whole'), false);
    await restoreFromHistory(box.context, (await readHistory(box.context)).find(event => event.kind === 'removed' && event.key === 'whole')!.id);
    const whole = (await manageView(box.context)).skills.find(item => item.key === 'whole')!;
    assert.deepEqual([whole.managed, whole.off, Object.keys(whole.copies).length], [true, [], 2]);
    // A copy in a tool whose box is off doesn't count: removing the synced ones still unmanages the skill, with no stray result.
    await skill(box.home, 'claude-cli', 'side'); await skill(box.home, 'copilot-cli', 'side');
    await applyChanges(box.context, [{ key: 'side', managed: true, off: ['copilot-cli'] }]);
    const side = await applyChanges(box.context, [{ key: 'side', managed: true, off: ['copilot-cli'], remove: ['claude-cli'], seenManaged: true }]);
    assert.deepEqual([side.results.map(entry => entry.outcome), (await manageView(box.context)).skills.find(item => item.key === 'side')!.managed], [['removed'], false]);
    // Unticking a tool and removing its copy in one change: Restore later doesn't turn syncing there back on.
    await skill(box.home, 'claude-cli', 'both'); await applyChanges(box.context, [{ key: 'both', managed: true, off: [] }]);
    await applyChanges(box.context, [{ key: 'both', managed: true, off: ['copilot-cli'], remove: ['copilot-cli'], seenManaged: true }]);
    assert.deepEqual((await readHistory(box.context)).find(event => event.kind === 'removed' && event.key === 'both')!.stoppedSync, []);
    // Removing the very copy chosen for every tool is refused, changing nothing.
    await skill(box.home, 'claude-cli', 'pick'); await skill(box.home, 'copilot-cli', 'pick', text('pick', 'Other.'));
    const refused = await applyChanges(box.context, [{ key: 'pick', managed: true, off: [], use: 'claude-cli', remove: ['claude-cli'] }]);
    assert.ok(refused.results.some(entry => entry.outcome === 'held' && /also asked to remove it/.test(entry.message)), JSON.stringify(refused));
    // A Restore that can't finish everywhere (a different copy took one tool's place) puts back the rest, and a retry finishes.
    await skill(box.home, 'claude-cli', 'pair'); await skill(box.home, 'copilot-cli', 'pair');
    await applyChanges(box.context, [{ key: 'pair', managed: false, off: [], remove: ['claude-cli', 'copilot-cli'] }]);
    const pair = (await readHistory(box.context)).find(event => event.kind === 'removed' && event.key === 'pair')!;
    await skill(box.home, 'claude-cli', 'pair', text('pair', 'Someone else’s.'));
    await restoreFromHistory(box.context, pair.id);
    assert.equal(await readFile(join(box.home, '.copilot/skills/pair/SKILL.md'), 'utf8'), text('pair'));
    await rm(join(box.home, '.claude/skills/pair'), { recursive: true });
    assert.equal((await restoreFromHistory(box.context, pair.id)).stopped, undefined);
    assert.equal(await readFile(join(box.home, '.claude/skills/pair/SKILL.md'), 'utf8'), text('pair'));
    assert.ok((await readHistory(box.context)).find(event => event.id === pair.id)!.undoneBy, 'done once every copy is back');
    // A removal that doesn't happen (the copy was edited just then) keeps the copy, and it keeps syncing.
    const copilotKept = join(box.home, '.copilot/skills/kept/SKILL.md');
    const editing = { ...box.context, fault: (step: string) => { if (step === 'before-remove') writeFileSync(copilotKept, text('kept', 'Edited just now.')); } };
    const held = await applyChanges(editing, [{ key: 'kept', managed: true, off: [], remove: ['copilot-cli'], seenManaged: true }]);
    assert.ok(held.results.some(entry => entry.outcome === 'held' && /changed just now/.test(entry.message)), JSON.stringify(held));
    assert.deepEqual([(await manageView(box.context)).skills.find(item => item.key === 'kept')!.off, await readFile(copilotKept, 'utf8')], [[], text('kept', 'Edited just now.')]);
    // …as an ordinary edit, which spreads.
    await applyChanges(box.context, []);
    await applyChanges(box.context, []);
    assert.equal(await readFile(join(box.home, '.claude/skills/kept/SKILL.md'), 'utf8'), text('kept', 'Edited just now.'));
  } finally { await box.cleanup(); }
});

test('Enable puts back the Claude Code override a Disable replaced, after History’s window has passed', async () => {
  const box = await sandbox(['claude-cli']);
  let now = Date.parse('2026-11-01T00:00:00Z');
  const context: ShareContext = { ...box.context, historyDays: 7, now: () => now };
  try {
    await skill(box.home, 'claude-cli', 'pager');
    const original = '{\n  "skillOverrides": { "pager": "name-only" }\n}\n';
    await writeFile(switchPath(context, 'claude-cli'), original);
    await applyChanges(context, [{ key: 'pager', managed: false, off: [], disable: ['claude-cli'] }]);
    now += 8 * 24 * 60 * 60 * 1000;
    assert.equal((await readHistory(context)).length, 0);
    await applyChanges(context, [{ key: 'pager', managed: false, off: [], enable: ['claude-cli'] }]);
    assert.equal(await readFile(switchPath(context, 'claude-cli'), 'utf8'), original);
  } finally { await box.cleanup(); }
});

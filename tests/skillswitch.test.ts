import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { readHistory } from '../src/history.ts';
import { applySkills, clearSwitch, skillsView } from '../src/skills.ts';
import { isDisabled, readSwitchFile, setDisabled, switchPath } from '../src/skillswitch.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const all: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

async function sandbox(tools: HarnessId[]) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-switch-')));
  const home = join(base, 'home');
  for (const dir of ['.claude', '.copilot', '.codex', '.pi/agent', '.config/opencode']) await mkdir(join(home, dir), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness }))), build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
const skillsDir = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills', 'pi-cli': '.pi/agent/skills', 'opencode-cli': '.config/opencode/skills' } as const;
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
      'opencode-cli': '{\n  // mine\n  "model": "a/b",\n  "permission": { "skill": { "other": "deny" } },\n}\n',
    };
    const expected: Record<HarnessId, RegExp> = {
      'claude-cli': /"alpha": "off"/,
      'copilot-cli': /"other",\s*"Alpha Skill"/,
      'codex-cli': /\[\[skills\.config\]\]\npath = ".*\/\.codex\/skills\/alpha\/SKILL\.md"\nenabled = false\n$/,
      'pi-cli': /"-skills\/alpha\/SKILL\.md"/,
      'opencode-cli': /"other": "deny",\s*"Alpha Skill": "deny"/,
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

test('A switch set in two tools before a skill is taken in: each copy arrives where it was, still switched off (Codex by path, Copilot by its name), keeps receiving edits, and Clear the switch clears each', async () => {
  const box = await sandbox(['claude-cli', 'codex-cli', 'copilot-cli']);
  const tools: HarnessId[] = ['claude-cli', 'codex-cli', 'copilot-cli'];
  try {
    // Copilot names a skill by its frontmatter name, which here differs from the folder.
    await skill(box.home, 'claude-cli', 'notes', text('Notes Helper'));
    await applySkills(box.context, tools, [{ key: 'notes', managed: true, off: [] }]);
    const copy = join(box.home, '.codex/skills/notes/SKILL.md');
    await setDisabled(box.context, 'codex-cli', { folder: 'notes', name: 'Notes Helper', skillFile: copy }, true);
    await setDisabled(box.context, 'copilot-cli', { folder: 'notes', name: 'Notes Helper', skillFile: join(box.home, '.copilot/skills/notes/SKILL.md') }, true);
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes(`path = ${JSON.stringify(copy)}\nenabled = false`));
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.copilot/settings.json'), 'utf8')).disabledSkills, ['Notes Helper']);
    const loads = async () => Object.entries((await skillsView(box.context, tools)).items.find(item => item.key === 'notes')!.loads ?? {}).filter(([, at]) => at?.off).map(([tool]) => tool).sort();
    assert.deepEqual(await loads(), ['codex-cli', 'copilot-cli']);
    // A switch is not exclusion: an edit still reaches the copy switched off, and the switch stays.
    await writeFile(join(box.home, '.claude/skills/notes/SKILL.md'), text('Notes Helper', 'Edited.'));
    await applySkills(box.context, tools, []);
    assert.equal(await readFile(copy, 'utf8'), text('Notes Helper', 'Edited.'));
    assert.deepEqual(await loads(), ['codex-cli', 'copilot-cli']);
    for (const tool of ['codex-cli', 'copilot-cli'] as HarnessId[]) assert.equal((await clearSwitch(box.context, tools, 'notes', tool)).stopped, undefined);
    assert.deepEqual(await loads(), []);
    assert.deepEqual((await readHistory(box.context)).filter(event => event.kind === 'switched').map(event => event.switched?.map(entry => [entry.tool, entry.disabled])), [[['codex-cli', false]], [['copilot-cli', false]]]);
    // A switch that isn't set any more has nothing to clear: refused, nothing written.
    assert.match((await clearSwitch(box.context, tools, 'notes', 'codex-cli')).stopped ?? '', /doesn’t turn notes off any more/);
  } finally { await box.cleanup(); }
});

test('Clear the switch puts back the Claude Code override the switch replaced, kept after History’s window has passed', async () => {
  const box = await sandbox(['claude-cli']);
  let now = Date.parse('2026-11-01T00:00:00Z');
  const context: ShareContext = { ...box.context, historyDays: 7, now: () => now };
  try {
    await skill(box.home, 'claude-cli', 'pager');
    const original = '{\n  "skillOverrides": { "pager": "name-only" }\n}\n';
    await writeFile(switchPath(context, 'claude-cli'), original);
    // Set as the earlier Disable did: the override it replaced is kept beside the record (skillswitch.ts keepOverrides).
    const target = { folder: 'pager', name: 'pager', skillFile: join(box.home, '.claude/skills/pager/SKILL.md') };
    const { previous } = await setDisabled(context, 'claude-cli', target, true);
    const { keepOverrides } = await import('../src/skillswitch.ts');
    await keepOverrides(context, { pager: previous });
    now += 8 * 24 * 60 * 60 * 1000;
    assert.equal((await readHistory(context)).length, 0);
    await clearSwitch(context, ['claude-cli'], 'pager', 'claude-cli');
    assert.equal(await readFile(switchPath(context, 'claude-cli'), 'utf8'), original);
  } finally { await box.cleanup(); }
});

test('Clear the switch puts back a Claude Code override 0.4.0-preview.1 recorded only in History', async () => {
  const box = await sandbox(['claude-cli']);
  try {
    await skill(box.home, 'claude-cli', 'pager');
    const original = '{\n  "skillOverrides": { "pager": "name-only" }\n}\n';
    await writeFile(switchPath(box.context, 'claude-cli'), original);
    const target = { folder: 'pager', name: 'pager', skillFile: join(box.home, '.claude/skills/pager/SKILL.md') };
    await setDisabled(box.context, 'claude-cli', target, true);
    // That release kept the replaced value only in the Disable's History event.
    await mkdir(join(box.home, '.central-knot'), { recursive: true });
    await writeFile(join(box.home, '.central-knot/history.json'), JSON.stringify({ events: [{ id: 'd', at: new Date().toISOString(), key: 'pager', item: 'pager', kind: 'switched', switched: [{ tool: 'claude-cli', disabled: true, target, before: 'name-only' }], losers: [], orderProved: true }] }));
    await clearSwitch(box.context, ['claude-cli'], 'pager', 'claude-cli');
    assert.equal(await readFile(switchPath(box.context, 'claude-cli'), 'utf8'), original);
  } finally { await box.cleanup(); }
});

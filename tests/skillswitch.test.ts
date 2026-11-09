import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyChanges, manageView, readHistory, restoreFromHistory } from '../src/manage.ts';
import { isDisabled, readSwitchFile, setDisabled, switchPath } from '../src/skillswitch.ts';
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
      assert.equal(isDisabled(box.context, tool, await readSwitchFile(box.context, tool), target), true, tool);
      assert.equal(isDisabled(box.context, tool, await readSwitchFile(box.context, tool), { ...target, folder: 'beta', name: 'beta', skillFile: target.skillFile.replace('alpha', 'beta') }), false, `${tool}: only that skill`);
      await setDisabled(box.context, tool, target, false);
      // A list the switch lives in is written back as a JSON list (same values, new layout); otherwise every byte is as it was.
      const now = await readFile(switchPath(box.context, tool), 'utf8');
      if (tool === 'copilot-cli' || tool === 'pi-cli') assert.deepEqual(JSON.parse(now), JSON.parse(before[tool]), tool);
      else assert.equal(now, before[tool], tool);
    }
  } finally { await box.cleanup(); }
});

test('Codex: a name rule that disables it is overruled by a path rule when enabled, and a skills list in another form is left alone', async () => {
  const box = await sandbox(['codex-cli']);
  try {
    const file = switchPath(box.context, 'codex-cli');
    const target = { folder: 'alpha', name: 'alpha', skillFile: join(box.home, '.codex/skills/alpha/SKILL.md') };
    await writeFile(file, '[[skills.config]]\nname = "alpha"\nenabled = false\n');
    assert.equal(isDisabled(box.context, 'codex-cli', await readSwitchFile(box.context, 'codex-cli'), target), true);
    await setDisabled(box.context, 'codex-cli', target, false);
    assert.match(await readFile(file, 'utf8'), /name = "alpha"\nenabled = false\n\n\[\[skills\.config\]\]\npath = ".*"\nenabled = true\n$/);
    await writeFile(file, 'skills = { config = [] }\n');
    assert.match((await readSwitchFile(box.context, 'codex-cli')).problem ?? '', /form Central Knot doesn’t edit/);
    await assert.rejects(setDisabled(box.context, 'codex-cli', target, true));
    assert.equal(await readFile(file, 'utf8'), 'skills = { config = [] }\n');
  } finally { await box.cleanup(); }
});

test('Managed and disabled in one tool: the copy arrives there switched off, keeps receiving edits, and Undo enables it', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    await skill(box.home, 'claude-cli', 'notes');
    const result = await applyChanges(box.context, [{ key: 'notes', managed: true, off: [], disabled: ['copilot-cli'] }]);
    assert.ok(result.results.some(entry => entry.outcome === 'switched' && entry.harness === 'copilot-cli'), JSON.stringify(result));
    assert.equal(await readFile(join(box.home, '.copilot/skills/notes/SKILL.md'), 'utf8'), text('notes'));
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.copilot/settings.json'), 'utf8')).disabledSkills, ['notes']);
    let notes = (await manageView(box.context)).skills.find(item => item.key === 'notes')!;
    assert.deepEqual([notes.managed, notes.disabled], [true, ['copilot-cli']]);
    // Disable is not exclusion: an edit still reaches the disabled copy.
    await writeFile(join(box.home, '.claude/skills/notes/SKILL.md'), text('notes', 'Edited.'));
    await applyChanges(box.context, []);
    await applyChanges(box.context, []);
    assert.equal(await readFile(join(box.home, '.copilot/skills/notes/SKILL.md'), 'utf8'), text('notes', 'Edited.'));
    const switched = (await readHistory(box.home)).find(event => event.kind === 'switched')!;
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
      { key: 'loose', managed: false, off: [], remove: ['copilot-cli'] },
      { key: 'kept', managed: true, off: [], remove: ['copilot-cli'], seenManaged: true },
    ]);
    assert.equal(result.results.filter(entry => entry.outcome === 'removed').length, 2, JSON.stringify(result));
    // A later pass neither re-adds the managed copy nor reads its removal as a deletion to spread.
    await applyChanges(box.context, []);
    await applyChanges(box.context, []);
    const view = await manageView(box.context);
    for (const key of ['loose', 'kept']) {
      const facts = view.skills.find(item => item.key === key)!;
      assert.ok(facts.copies['claude-cli'] && !facts.copies['copilot-cli'], key);
    }
    assert.deepEqual(view.skills.find(item => item.key === 'kept')!.off, ['copilot-cli']);
    for (const removed of (await readHistory(box.home)).filter(event => event.kind === 'removed')) {
      assert.equal((await restoreFromHistory(box.context, removed.id)).stopped, undefined);
    }
    assert.equal(await readFile(join(box.home, '.copilot/skills/loose/SKILL.md'), 'utf8'), text('loose'));
    const kept = (await manageView(box.context)).skills.find(item => item.key === 'kept')!;
    assert.deepEqual([kept.managed, kept.off, !!kept.copies['copilot-cli']], [true, [], true]);
  } finally { await box.cleanup(); }
});

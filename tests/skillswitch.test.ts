import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { readHistory } from '../src/history.ts';
import { applyAgents } from '../src/agents.ts';
import { applySkills, clearSwitch, restoreSkill, skillsView } from '../src/skills.ts';
import { isDisabled, readSwitchFile, setDisabled, switchPath } from '../src/skillswitch.ts';
import { setSyncEverything } from '../src/everything.ts';
import { libraryWords, sentences } from '../src/libraryrow.ts';
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

// Pi's `skills` list, each row measured on Pi 1.5.2 (2026-11-20, docs/capability-data.md): whether Pi loads its own copy of
// product-context (~/.pi/agent/skills) and the shared copy of shared-one (~/.agents/skills), read as off or on.
test('Pi: a copy reads as off exactly where Pi keeps it out, by its exclusions, its patterns and its inclusions', async () => {
  const box = await sandbox(['pi-cli']);
  try {
    const H = box.home, own = '.pi/agent/skills/product-context', shared = '.agents/skills/shared-one';
    const mine = { folder: 'product-context', name: 'product-context', skillFile: join(H, own, 'SKILL.md') };
    const theirs = { folder: 'shared-one', name: 'shared-one', skillFile: join(H, shared, 'SKILL.md') };
    const all = ['!*', '!**', '!**/*', '!*/*', '!skills/*', '!skills/**', '!**/SKILL.md', '!SKILL.md', '!!other-skill'];
    const rows: [unknown, [boolean, boolean]][] = [
      [undefined, [false, false]],
      [['-skills/product-context/SKILL.md'], [true, false]],
      // The shared folder's copies are named from ~/.agents, so the same words name a shared copy.
      [['-skills/shared-one/SKILL.md'], [false, true]],
      ...all.map((pattern): [unknown, [boolean, boolean]] => [[pattern], [true, true]]),
      [['!~/.pi/agent/skills/*'], [true, false]], [[`!${H}/.agents/skills/*`], [false, true]],
      [['!product-context'], [true, false]], [['!product-*'], [true, false]], [['!skills/product-context/SKILL.md'], [true, false]],
      // Letters match with their case, on every platform, as Pi matches them: a negated class too.
      [['!Product-*'], [false, false]], [['!PRODUCT-CONTEXT'], [false, false]], [['![!P]roduct-context'], [true, false]], [['![!p]roduct-context'], [false, false]],
      // Not exclusions: a plain entry adds a place to load from, `-` is exact, `!` alone and `./` before a pattern match nothing.
      ...['*', '-*', '-**', '!', '!./skills/*'].map((entry): [unknown, [boolean, boolean]] => [[entry], [false, false]]),
      [{ '*': '*' }, [false, false]],
      // An exact `+` lets a copy back in past any pattern, in each form Pi reads, wherever it stands in the list.
      ...['skills/product-context/SKILL.md', 'skills/product-context', './skills/product-context/SKILL.md', `${H}/${own}/SKILL.md`, `${H}/${own}`, `~/${own}/SKILL.md`, `~/${own}`]
        .map((form): [unknown, [boolean, boolean]] => [['!*', `+${form}`], [false, true]]),
      [['+skills/product-context/SKILL.md', '!*'], [false, true]],
      ...['skills/product-context/', 'skills/*', 'product-context'].map((form): [unknown, [boolean, boolean]] => [['!*', `+${form}`], [true, true]]),
      ...['skills/shared-one/SKILL.md', 'skills/shared-one', `${H}/${shared}/SKILL.md`, `~/${shared}`].map((form): [unknown, [boolean, boolean]] => [['!*', `+${form}`], [true, false]]),
      ...['../../.agents/skills/shared-one/SKILL.md', '.agents/skills/shared-one/SKILL.md'].map((form): [unknown, [boolean, boolean]] => [['!*', `+${form}`], [true, true]]),
      // An exact `-` wins over a `+`, in either order.
      [['!*', '+skills/product-context/SKILL.md', '-skills/product-context/SKILL.md'], [true, true]],
      [['-skills/product-context/SKILL.md', '+skills/product-context/SKILL.md'], [true, false]],
      // The owner's form: every skill kept out, another let back in.
      [['!*', '+skills/other-skill/SKILL.md'], [true, true]],
      // An entry that isn't text: Pi stops before it loads anything.
      [[{ '*': '*' }], [true, true]],
    ];
    for (const [skills, expected] of rows) {
      await writeFile(switchPath(box.context, 'pi-cli'), JSON.stringify(skills === undefined ? {} : { skills }));
      const file = await readSwitchFile(box.context, 'pi-cli');
      assert.deepEqual([isDisabled(box.context, file, mine), isDisabled(box.context, file, theirs)], expected, JSON.stringify(skills));
    }
    assert.match((await readSwitchFile(box.context, 'pi-cli')).problem?.reason ?? '', /isn’t text/);
    // An agent in Pi is a loose file (agents.ts), named by its own path; a folder of one name in Pi's own folder and in the
    // shared one is two copies, named apart by their absolute paths and together by the path from either folder.
    const at = (path: string) => ({ folder: 'x', name: 'x', skillFile: join(H, path) });
    const agent = at('.pi/agent/skills/code-reviewer.md'), dupOwn = at('.pi/agent/skills/dup/SKILL.md'), dupShared = at('.agents/skills/dup/SKILL.md');
    const more: [unknown, boolean[]][] = [
      [['!*'], [true, true, true]],
      ...['+skills/code-reviewer.md', `+${H}/.pi/agent/skills/code-reviewer.md`, '+~/.pi/agent/skills/code-reviewer.md'].map((form): [unknown, boolean[]] => [['!*', form], [false, true, true]]),
      [['!*', '+skills/code-reviewer'], [true, true, true]], [['-skills/code-reviewer.md'], [true, false, false]], [['!code-reviewer.md'], [true, false, false]],
      [['-~/.pi/agent/skills/dup/SKILL.md'], [false, true, false]], [['-~/.agents/skills/dup/SKILL.md'], [false, false, true]], [['-skills/dup/SKILL.md'], [false, true, true]],
      [['!*', `+${H}/.pi/agent/skills/dup/SKILL.md`], [true, false, true]], [['!*', `+${H}/.agents/skills/dup/SKILL.md`], [true, true, false]], [['!*', '+skills/dup/SKILL.md'], [true, false, false]],
    ];
    for (const [skills, expected] of more) {
      await writeFile(switchPath(box.context, 'pi-cli'), JSON.stringify({ skills }));
      const file = await readSwitchFile(box.context, 'pi-cli');
      assert.deepEqual([agent, dupOwn, dupShared].map(copy => isDisabled(box.context, file, copy)), expected, JSON.stringify(skills));
    }
  } finally { await box.cleanup(); }
});

test('Pi: turned on under a pattern, a copy gets the inclusion pi config writes; turned off, it goes; every other entry stays in its place', async () => {
  const box = await sandbox(['pi-cli']);
  try {
    const file = switchPath(box.context, 'pi-cli');
    const mine = { folder: 'product-context', name: 'product-context', skillFile: join(box.home, '.pi/agent/skills/product-context/SKILL.md') };
    const theirs = { folder: 'shared-one', name: 'shared-one', skillFile: join(box.home, '.agents/skills/shared-one/SKILL.md') };
    const skills = async () => JSON.parse(await readFile(file, 'utf8')).skills;
    await writeFile(file, '{\n  "theme": "dark",\n  "skills": ["!*", "+skills/other-skill/SKILL.md"]\n}\n');
    await setDisabled(box.context, 'pi-cli', mine, false);
    assert.deepEqual(await skills(), ['!*', '+skills/other-skill/SKILL.md', '+skills/product-context/SKILL.md']);
    // A shared copy by its absolute path: from ~/.agents, its path would name Pi's own copy of that folder too.
    await setDisabled(box.context, 'pi-cli', theirs, false);
    assert.deepEqual(await skills(), ['!*', '+skills/other-skill/SKILL.md', '+skills/product-context/SKILL.md', `+${theirs.skillFile}`]);
    // Off takes the inclusion out and adds no exclusion: the pattern keeps it out already.
    await setDisabled(box.context, 'pi-cli', mine, true);
    await setDisabled(box.context, 'pi-cli', theirs, true);
    assert.equal(await readFile(file, 'utf8'), '{\n  "theme": "dark",\n  "skills": [\n    "!*",\n    "+skills/other-skill/SKILL.md"\n  ]\n}\n');
    // Its own exclusion goes and its inclusion comes; a pattern is never rewritten or taken out.
    await writeFile(file, '{ "skills": ["!product-*", "-skills/product-context/SKILL.md"] }');
    await setDisabled(box.context, 'pi-cli', mine, false);
    assert.deepEqual(await skills(), ['!product-*', '+skills/product-context/SKILL.md']);
    // With no pattern, an inclusion the person wrote stays through Off and On, and Off is an exclusion.
    await writeFile(file, '{ "skills": ["+skills/product-context/SKILL.md"] }');
    await setDisabled(box.context, 'pi-cli', mine, true);
    assert.deepEqual(await skills(), ['+skills/product-context/SKILL.md', '-skills/product-context/SKILL.md']);
    await setDisabled(box.context, 'pi-cli', mine, false);
    assert.deepEqual(await skills(), ['+skills/product-context/SKILL.md']);
    // His entries are his. Let Pi load it leaves a pattern, a literal path included, and adds the `+` that overrides it; its
    // Undo takes back that `+` alone.
    await writeFile(file, '{ "skills": ["!*", "!skills/product-context/SKILL.md"] }');
    assert.deepEqual((await setDisabled(box.context, 'pi-cli', mine, false)).removed, []);
    assert.deepEqual(await skills(), ['!*', '!skills/product-context/SKILL.md', '+skills/product-context/SKILL.md']);
    await setDisabled(box.context, 'pi-cli', mine, true, []);
    assert.deepEqual(await skills(), ['!*', '!skills/product-context/SKILL.md']);
    // His exact `-`, in his own form, wins over any `+`: Let Pi load it takes it out and answers it, and its Undo puts it back.
    await writeFile(file, '{ "skills": ["!*", "-~/.agents/skills/shared-one", "+skills/spare/SKILL.md"] }');
    const { removed } = await setDisabled(box.context, 'pi-cli', theirs, false);
    assert.deepEqual([removed, await skills()], [['-~/.agents/skills/shared-one'], ['!*', '+skills/spare/SKILL.md', `+${theirs.skillFile}`]]);
    await setDisabled(box.context, 'pi-cli', theirs, true, removed);
    assert.deepEqual(await skills(), ['!*', '+skills/spare/SKILL.md', '-~/.agents/skills/shared-one']);
    // A folder of that name in the shared folder too: Pi's own copy is let in by its absolute path, which names it alone.
    await mkdir(join(box.home, '.agents/skills/product-context'), { recursive: true });
    await writeFile(file, '{ "skills": ["!*"] }');
    await setDisabled(box.context, 'pi-cli', mine, false);
    assert.deepEqual(await skills(), ['!*', `+${mine.skillFile}`]);
    // That folder gone from the shared one, the absolute `+` is still Central Knot's own, and Off takes it out.
    await rm(join(box.home, '.agents/skills/product-context'), { recursive: true });
    await setDisabled(box.context, 'pi-cli', mine, true);
    assert.deepEqual(await skills(), ['!*']);
    // `skills` written twice: Pi reads the last, the edit lands on the first, and the read-back says the change didn't take.
    await writeFile(file, '{ "skills": ["!*"], "skills": ["!*"] }');
    await assert.rejects(setDisabled(box.context, 'pi-cli', mine, false), /did not take the change/);
    // An entry that isn't text: nothing is written.
    await writeFile(file, '{ "skills": [{ "*": "*" }] }');
    await assert.rejects(setDisabled(box.context, 'pi-cli', mine, false), /isn’t text/);
    assert.equal(await readFile(file, 'utf8'), '{ "skills": [{ "*": "*" }] }');
  } finally { await box.cleanup(); }
});

test('Pi under a pattern: an item’s On puts its copy in with the inclusion Pi needs, Off takes both out, and the person’s own exclusion stays', async () => {
  const box = await sandbox(['claude-cli', 'pi-cli']);
  const tools: HarnessId[] = ['claude-cli', 'pi-cli'];
  try {
    const file = switchPath(box.context, 'pi-cli'), copy = join(box.home, '.pi/agent/skills/notes/SKILL.md');
    const skills = async () => JSON.parse(await readFile(file, 'utf8')).skills;
    const offInPi = async () => (await skillsView(box.context, tools)).items.find(item => item.key === 'notes')!.loads?.['pi-cli']?.switchedOff;
    await skill(box.home, 'claude-cli', 'notes');
    await writeFile(file, '{ "skills": ["!*", "+skills/other-skill/SKILL.md"] }');
    await applySkills(box.context, tools, [{ key: 'notes', on: true, except: [] }]);
    assert.deepEqual([existsSync(copy), await skills(), await offInPi()], [true, ['!*', '+skills/other-skill/SKILL.md', '+skills/notes/SKILL.md'], false]);
    // A shared copy comes (an installer's): Central Knot's copy in Pi gives way to it, and its `+`, which names the shared copy
    // too, stays for it; Off then takes it out.
    await mkdir(join(box.home, '.agents/skills/notes'), { recursive: true });
    await writeFile(join(box.home, '.agents/skills/notes/SKILL.md'), text('notes'));
    await applySkills(box.context, tools, []);
    assert.deepEqual([existsSync(copy), await skills(), await offInPi()], [false, ['!*', '+skills/other-skill/SKILL.md', '+skills/notes/SKILL.md'], false]);
    await rm(join(box.home, '.agents/skills/notes'), { recursive: true });
    await applySkills(box.context, tools, []);
    await applySkills(box.context, tools, [{ key: 'notes', on: false, except: [] }]);
    assert.deepEqual([existsSync(copy), await skills()], [false, ['!*', '+skills/other-skill/SKILL.md']]);
    // His own exclusion of this copy is his switch for it: On leaves it, and the row says Pi doesn't load it.
    await writeFile(file, '{ "skills": ["!*", "-skills/notes/SKILL.md"] }');
    await applySkills(box.context, tools, [{ key: 'notes', on: true, except: [] }]);
    assert.deepEqual([existsSync(copy), await skills(), await offInPi()], [true, ['!*', '-skills/notes/SKILL.md'], true]);
    // His entries are his: Off and On leave his `+` in his own form, and his `+` beside his `-`, which decides.
    for (const his of [['!*', '+./skills/notes'], ['!*', '+skills/notes/SKILL.md', '-skills/notes/SKILL.md']]) {
      await writeFile(file, JSON.stringify({ skills: his }));
      await applySkills(box.context, tools, [{ key: 'notes', on: false, except: [] }]);
      assert.deepEqual([existsSync(copy), await skills()], [false, his]);
      await applySkills(box.context, tools, [{ key: 'notes', on: true, except: [] }]);
      assert.deepEqual([existsSync(copy), await skills()], [true, his]);
    }
    // A shared copy his list keeps out arrives: Pi doesn't load it, so Central Knot's copy, which Pi loads, stays.
    await writeFile(file, '{ "skills": ["!*", "-~/.agents/skills/notes/SKILL.md", "+skills/notes/SKILL.md"] }');
    await mkdir(join(box.home, '.agents/skills/notes'), { recursive: true });
    await writeFile(join(box.home, '.agents/skills/notes/SKILL.md'), text('notes'));
    await applySkills(box.context, tools, []);
    assert.deepEqual([existsSync(copy), await offInPi()], [true, false]);
    // Both copies there, his `-` on Pi's own alone: Pi loads the shared one, and the row says so.
    await writeFile(file, '{ "skills": ["-~/.pi/agent/skills/notes/SKILL.md"] }');
    assert.equal(await offInPi(), false);
    await rm(join(box.home, '.agents/skills/notes'), { recursive: true });
    // A link in Pi's folder to a shared skill: Pi loads it by the link's own path.
    await mkdir(join(box.home, '.agents/skills/linked'), { recursive: true });
    await writeFile(join(box.home, '.agents/skills/linked/SKILL.md'), text('linked'));
    await symlink('../../../.agents/skills/linked', join(box.home, '.pi/agent/skills/linked'));
    await writeFile(file, '{ "skills": ["!*", "+~/.pi/agent/skills/linked/SKILL.md"] }');
    assert.equal((await skillsView(box.context, tools)).items.find(item => item.key === 'linked')!.loads?.['pi-cli']?.switchedOff, false);
    // Let Pi load it takes out his own `-`, in his form, and History's Undo of it puts that entry back as it was.
    await writeFile(file, '{ "skills": ["!*", "-~/.pi/agent/skills/notes/SKILL.md"] }');
    const cleared = await clearSwitch(box.context, tools, 'notes', 'pi-cli');
    assert.deepEqual(await skills(), ['!*', '+skills/notes/SKILL.md']);
    await restoreSkill(box.context, tools, cleared.made![0]);
    assert.deepEqual(await skills(), ['!*', '-~/.pi/agent/skills/notes/SKILL.md']);
    // Its folder deleted by hand in Pi: the skill goes Off, and its `+` goes with it.
    await writeFile(file, '{ "skills": ["!*"] }');
    await applySkills(box.context, tools, [{ key: 'notes', on: false, except: [] }]);
    const on = await applySkills(box.context, tools, [{ key: 'notes', on: true, except: [] }]);
    assert.deepEqual(await skills(), ['!*', '+skills/notes/SKILL.md']);
    // The app says it changed his list: in the click's result for Pi, and in its History entry.
    assert.match(on.results.find(result => result.harness === 'pi-cli')?.message ?? '', /\+skills\/notes\/SKILL\.md added to Pi’s skills list/);
    assert.match((await readHistory(box.context)).filter(event => event.key === 'notes').at(-1)?.settingsChanged?.join(' ') ?? '', /added to Pi’s skills list/);
    await rm(join(box.home, '.pi/agent/skills/notes'), { recursive: true });
    const gone = (await applySkills(box.context, tools, [])).notices?.find(notice => notice.kind === 'deleted-by-hand');
    assert.deepEqual(await skills(), ['!*']);
    // Its notice says so too.
    assert.match(gone && gone.kind === 'deleted-by-hand' ? sentences(libraryWords.skills).noticeWords(gone).text : '', /notes was deleted in Pi, so it is off.* \+skills\/notes\/SKILL\.md taken out of Pi’s skills list \(settings\.json\) with its copy\./);
  } finally { await box.cleanup(); }
});

test('Pi under a pattern: a skill Synchronize everything takes in and puts in Pi is let in, and its notice says so', async () => {
  const box = await sandbox(['claude-cli', 'pi-cli']);
  const tools: HarnessId[] = ['claude-cli', 'pi-cli'];
  try {
    await skill(box.home, 'claude-cli', 'found-one');
    await writeFile(switchPath(box.context, 'pi-cli'), '{ "skills": ["!*"] }');
    assert.deepEqual(await setSyncEverything(box.context, true), {});
    const notice = (await applySkills(box.context, tools, [], { background: true })).notices?.find(each => each.kind === 'taken-in');
    assert.deepEqual(JSON.parse(await readFile(switchPath(box.context, 'pi-cli'), 'utf8')).skills, ['!*', '+skills/found-one/SKILL.md']);
    assert.equal(notice && notice.kind === 'taken-in' ? sentences(libraryWords.skills).takenInWords(notice) : '',
      'Synchronize everything took in 1 skill, found in Claude Code: found-one. +skills/found-one/SKILL.md added to Pi’s skills list (settings.json), where a pattern keeps skills out. History can undo it.');
  } finally { await box.cleanup(); }
});

test('Pi under a pattern: an agent, a loose file in its skills folder, is let in as a skill is, and its `+` goes with it', async () => {
  const box = await sandbox(['claude-cli', 'pi-cli']);
  const tools: HarnessId[] = ['claude-cli', 'pi-cli'];
  try {
    const file = switchPath(box.context, 'pi-cli');
    await mkdir(join(box.home, '.claude/agents'), { recursive: true });
    await writeFile(join(box.home, '.claude/agents/writer.md'), '---\nname: writer\ndescription: Writes docs\n---\n\nYou write docs.\n');
    await writeFile(file, '{ "skills": ["!*"] }');
    await applyAgents(box.context, tools, [{ key: 'writer', on: true, except: [], seenOn: false }]);
    assert.deepEqual([existsSync(join(box.home, '.pi/agent/skills/writer.md')), JSON.parse(await readFile(file, 'utf8')).skills], [true, ['!*', '+skills/writer.md']]);
    await applyAgents(box.context, tools, [{ key: 'writer', on: false, except: [], seenOn: true }]);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).skills, ['!*']);
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
    await applySkills(box.context, tools, [{ key: 'notes', on: true, except: [] }]);
    const copy = join(box.home, '.codex/skills/notes/SKILL.md');
    await setDisabled(box.context, 'codex-cli', { folder: 'notes', name: 'Notes Helper', skillFile: copy }, true);
    await setDisabled(box.context, 'copilot-cli', { folder: 'notes', name: 'Notes Helper', skillFile: join(box.home, '.copilot/skills/notes/SKILL.md') }, true);
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes(`path = ${JSON.stringify(copy)}\nenabled = false`));
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.copilot/settings.json'), 'utf8')).disabledSkills, ['Notes Helper']);
    const loads = async () => Object.entries((await skillsView(box.context, tools)).items.find(item => item.key === 'notes')!.loads ?? {}).filter(([, at]) => at?.switchedOff).map(([tool]) => tool).sort();
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

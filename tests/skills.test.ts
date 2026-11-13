// Skills on Central Knot's library, on real folders in a temp home (src/skills.ts, the skills' Kind; the model is
// src/library.ts). Each test is one worked example: a skill found and taken in, Off and On byte for byte, edits and
// deletions made by hand, the folders that are not Central Knot's, a tool's own switch, the store, crashes, and the tool
// choice. The migration from the earlier record is tests/skillmigrate.test.ts; the seeded walk is tests/librarywalk.test.ts.
import { test } from 'node:test';
import { itemNotice } from './notices.ts';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readHistory } from '../src/history.ts';
import { librarySentence } from '../src/historyactions.ts';
import { addLabel, canAdd, harnessIs, isPartial, libraryWords, placeOf, sentences, statusLine, switchLabel } from '../src/libraryrow.ts';
import { readTree, type ShareContext } from '../src/share.ts';
import { clearSwitch, skillChange, skillsView, takeOver } from '../src/skills.ts';
import { pruneDeleted } from '../src/skillstore.ts';
import { isDisabled, readSwitchFile, setDisabled } from '../src/skillswitch.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { HarnessId } from '../src/types.ts';
import { bytes, choose, everywhere, folderOf, historyActions, historyOf, inTool, itemOf, makeCurrent, pass, put, remove, restore, roots, sandbox, seen, send, skillText, tools, turnOff, turnOn, type Tool } from './skillclicks.ts';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 9, minutes));
/** Sets a whole folder's time (every file and folder in it), as a save in an editor would leave it. */
async function touch(path: string, when: Date) {
  for (const entry of await readdir(path, { recursive: true })) await utimes(join(path, entry), when, when);
  await utimes(path, when, when);
}
const say = sentences(libraryWords.skills);
/** A skill with several files: a script that can run, a file of mode 0600, an empty folder, and a file a tool added beside SKILL.md. */
const rich = { 'SKILL.md': skillText(), 'scripts/run.sh': { text: '#!/bin/sh\necho hi\n', mode: 0o755 }, 'secret.txt': { text: 'mine\n', mode: 0o600 }, 'notes.log': 'added by Claude Code\n' };

test('A skill found in one tool is taken in by its switch and goes into every tool, its whole folder byte for byte', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', rich, ['empty/inside']);
    const { fact, item } = await seen(box);
    assert.equal(placeOf(item), 'found');
    assert.deepEqual(Object.keys(fact!.copies), ['claude-cli']);
    assert.equal(fact!.description, 'Takes notes.');
    assert.notEqual(await turnOn(box), 'choose');
    const all = await everywhere(box);
    for (const tool of tools) assert.deepEqual(all[tool], all['claude-cli'], tool);
    assert.equal(all['codex-cli']!['scripts/run.sh'], '755 #!/bin/sh\necho hi\n');
    assert.equal(all['codex-cli']!['empty/inside/'] !== undefined, true, 'an empty folder is part of a skill');
    assert.deepEqual((await itemOf(box))!.versions.map(version => version.from), [{ how: 'found', harness: 'claude-cli' }]);
    assert.equal((await pass(box)).writes, 0, 'a second pass finds nothing to do');
  } finally { await box.cleanup(); }
});

test('Off takes the folder out of every tool and Central Knot keeps it; On puts back the same folder in each, byte for byte', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', rich, ['empty']);
    await turnOn(box);
    const before = await everywhere(box);
    await turnOff(box);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), []);
    const { item, fact } = await seen(box);
    assert.equal(placeOf(item), 'off');
    assert.equal(say.placeTag(fact!, item, tools)?.text, 'in Central Knot only');
    await turnOn(box);
    assert.deepEqual(await everywhere(box), before);
    // Nothing writes a tool's own switch for it: Off removed the folders, it did not disable them.
    for (const tool of tools) assert.equal(isDisabled(box.context, await readSwitchFile(box.context, tool), { folder: 'notes', name: 'notes', skillFile: join(folderOf(box, tool), 'SKILL.md') }), false);
  } finally { await box.cleanup(); }
});

test('An edit in one tool becomes the current version and reaches the others; Undo makes the version before it current', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Edited in Codex.'), 'extra.md': 'more\n' });
    const done = await pass(box);
    assert.deepEqual(done.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner]), [['edit', 'codex-cli']]);
    for (const tool of tools) assert.deepEqual(await bytes(folderOf(box, tool)), await bytes(folderOf(box, 'codex-cli')), tool);
    const edit = (await historyOf(box)).find(event => event.kind === 'edit')!;
    assert.deepEqual(await skillChange(box.context, edit.id), { before: skillText(), after: skillText('Edited in Codex.') });
    assert.deepEqual((await seen(box)).fact!.versionChanges?.[0], { changed: ['SKILL.md', 'extra.md'] }, 'its note names the files that changed');
    await restore(box, edit.id);
    for (const tool of tools) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText(), tool);
    assert.equal((await bytes(folderOf(box, 'claude-cli')))!['extra.md'], undefined, 'the file the edit added goes with it');
  } finally { await box.cleanup(); }
});

test('Two edits: the latest wins by the folder’s time, where a file removed inside counts; the other is kept as a version', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText(), 'old.md': 'old\n' });
    await turnOn(box);
    // Copilot CLI's edit is the later one: a file removed inside its folder moves the folder's time, not any file's.
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s edit.'), 'old.md': 'old\n' });
    await touch(folderOf(box, 'codex-cli'), at(10));
    await rm(join(folderOf(box, 'copilot-cli'), 'old.md'));
    await touch(folderOf(box, 'copilot-cli'), at(5));
    await utimes(folderOf(box, 'copilot-cli'), at(20), at(20));
    const done = await pass(box);
    assert.deepEqual(done.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner, notice.losers]), [['conflict', 'copilot-cli', ['codex-cli']]]);
    for (const tool of tools) assert.deepEqual(Object.keys((await bytes(folderOf(box, tool)))!), ['SKILL.md'], tool);
    const versions = (await itemOf(box))!.versions;
    assert.deepEqual(versions.map(version => version.from.how), ['edited', 'edited', 'found']);
    const conflict = (await historyOf(box)).find(event => event.kind === 'conflict')!;
    await restore(box, conflict.id, versions[1].hash);
    assert.equal(await readFile(join(folderOf(box, 'claude-cli'), 'SKILL.md'), 'utf8'), skillText('Codex’s edit.'), 'History’s “Use Codex’s” makes the other current');
  } finally { await box.cleanup(); }
});

test('A file edited inside a folder makes its time: the later edit wins although its folder’s own time is the earlier', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    // Codex's folder was touched later; Claude Code's SKILL.md was saved later still.
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s edit.') });
    await touch(folderOf(box, 'codex-cli'), at(10));
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Claude Code’s edit.') });
    await utimes(join(folderOf(box, 'claude-cli'), 'SKILL.md'), at(20), at(20));
    await utimes(folderOf(box, 'claude-cli'), at(1), at(1));
    const done = await pass(box);
    assert.deepEqual(done.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner]), [['conflict', 'claude-cli']]);
    for (const tool of tools) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText('Claude Code’s edit.'), tool);
  } finally { await box.cleanup(); }
});

test('A folder really deleted by hand in one tool turns the skill Off everywhere; Central Knot keeps it, and Turn on puts it back', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', rich);
    await turnOn(box);
    const before = await everywhere(box);
    await rm(folderOf(box, 'copilot-cli'), { recursive: true });
    const done = await pass(box);
    assert.deepEqual(done.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner]), [['deleted', 'copilot-cli']]);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), []);
    assert.equal((await itemOf(box))!.on, false);
    const off = (await historyOf(box)).find(event => event.kind === 'off')!;
    await restore(box, off.id);
    assert.deepEqual(await everywhere(box), before);
  } finally { await box.cleanup(); }
});

test('A folder that can’t be read for sure changes nothing: no SKILL.md, a SKILL.md that can’t be parsed, a link inside, the tool’s folder made again', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    const before = await everywhere(box);
    const broken: [string, () => Promise<void>, RegExp][] = [
      ['no SKILL.md', () => rm(join(folderOf(box, 'codex-cli'), 'SKILL.md')), /has no SKILL\.md/],
      ['unparsable', () => writeFile(join(folderOf(box, 'codex-cli'), 'SKILL.md'), '---\nname: notes\ndescription: Has: a colon\n---\n'), /can’t be read as a skill/],
      ['a link inside', () => symlink('SKILL.md', join(folderOf(box, 'codex-cli'), 'alias.md')), /link/],
    ];
    for (const [what, breakIt, why] of broken) {
      await breakIt();
      assert.match((await seen(box)).fact!.unseen?.['codex-cli'] ?? '', why, what);
      const done = await pass(box);
      assert.deepEqual([done.writes, done.notices?.length, (await itemOf(box))!.on], [0, 0, true], what);
      assert.deepEqual((await everywhere(box))['claude-cli'], before['claude-cli'], what);
      await rm(folderOf(box, 'codex-cli'), { recursive: true });
      await mkdir(folderOf(box, 'codex-cli'));
      await writeFile(join(folderOf(box, 'codex-cli'), 'SKILL.md'), skillText());
    }
    // The whole skills folder made again (a reinstall): its copy is written afresh, never read as deleted by hand.
    await rm(join(box.home, roots['codex-cli']), { recursive: true });
    await mkdir(join(box.home, roots['codex-cli']));
    const done = await pass(box);
    assert.deepEqual([done.notices?.length, (await itemOf(box))!.on], [0, true]);
    assert.deepEqual(await everywhere(box), before);
  } finally { await box.cleanup(); }
});

test('A removal never takes content the library hasn’t: an edit made with Automatic sync off, or a file added between the read and the removal', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    // Sync off: an edit no pass took in, then Off, a click on this skill alone. The edit is a version before the folder goes.
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Not taken in yet.') });
    const offline: ShareContext = { ...box.context };
    await (await import('../src/skills.ts')).applySkills(offline, box.tools, [{ key: 'notes', managed: false, off: [] }], { only: new Set(['notes']) });
    const edited = (await readTree(join(box.home, '.central-knot/items/skills/notes/versions', (await itemOf(box))!.hash))).files.get('SKILL.md');
    assert.ok(edited, 'the edit is the current version, kept in the store');
    assert.equal(await readFile(join(box.home, '.central-knot/items/skills/notes/versions', (await itemOf(box))!.hash, 'SKILL.md'), 'utf8'), skillText('Not taken in yet.'));
    await turnOn(box);
    // A file added inside the folder just before it is removed: that folder stays, and the next pass keeps it first.
    let added = false;
    const racing: ShareContext = { ...box.context, fault: step => { if (step === 'before-remove' && !added) { added = true; void writeFile(join(folderOf(box, 'copilot-cli'), 'late.md'), 'late\n'); } } };
    await new Promise(resolve => setTimeout(resolve, 5));
    await turnOff(box, racing);
    await pass(box);
    const versions = (await itemOf(box))!.versions.map(version => version.hash);
    const late = await Promise.all(versions.map(hash => readFile(join(box.home, '.central-knot/items/skills/notes/versions', hash, 'late.md'), 'utf8').catch(() => undefined)));
    assert.ok(late.includes('late\n') || (await bytes(folderOf(box, 'copilot-cli')))?.['late.md'], 'the late file is a version, or still in its folder');
  } finally { await box.cleanup(); }
});

test('A found skill whose only copy can’t be copied as it is (a link inside) is a row that says why, with nothing to take in; a folder with no SKILL.md is no row', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await symlink('SKILL.md', join(folderOf(box, 'claude-cli'), 'alias'));
    await mkdir(join(box.home, roots['codex-cli'], 'not-a-skill'), { recursive: true });
    const { fact, item, row } = await seen(box);
    assert.match(fact!.unseen?.['claude-cli'] ?? '', /can’t be copied as it is/);
    assert.deepEqual([canAdd(row), statusLine(row, item, tools)], [false, 'Not in Central Knot · it can’t be taken in now (see below).']);
    assert.equal((await seen(box, box.context, 'not-a-skill')).fact, undefined);
    // Found only where a tool has it another way (the shared folder), it says so, and can be taken in.
    await rm(folderOf(box, 'claude-cli'), { recursive: true });
    await mkdir(join(box.home, '.agents/skills/notes'), { recursive: true });
    await writeFile(join(box.home, '.agents/skills/notes/SKILL.md'), skillText());
    const shared = await seen(box);
    assert.deepEqual([canAdd(shared.row), statusLine(shared.row, shared.item, tools)], [true, 'Not in Central Knot · Copilot CLI and Codex have it another way. Add it to keep it in Central Knot and put it in Claude Code.']);
  } finally { await box.cleanup(); }
});

test('A crash between the steps of a write or a removal leaves no folder read as deleted: the next pass puts it back and finishes', async () => {
  for (const [step, click] of [['before-rename', 'on'], ['mid-replace', 'edit'], ['before-remove', 'off']] as const) {
    const box = await sandbox();
    try {
      await put(box, 'claude-cli', rich);
      await turnOn(box);
      if (click === 'on') await turnOff(box);
      const crash: ShareContext = { ...box.context, fault: at => { if (at === step) throw new Error(`crash at ${step}`); } };
      if (click === 'edit') { await put(box, 'codex-cli', { 'SKILL.md': skillText('Edited.') }); await pass(box, crash).catch(() => undefined); }
      else await (click === 'on' ? turnOn(box, crash) : turnOff(box, crash)).catch(() => undefined);
      await pass(box);
      const item = (await itemOf(box))!, all = await everywhere(box);
      assert.equal(item.on, click !== 'off', step);
      for (const tool of tools) assert.deepEqual(all[tool], click === 'off' ? undefined : all['codex-cli'], `${step}: ${tool}`);
      // Nothing of Central Knot's is left beside the skills folders.
      for (const tool of tools) assert.deepEqual((await readdir(join(box.home, roots[tool], '..'))).filter(name => name.startsWith('.ck-')), [], `${step}: ${tool}`);
    } finally { await box.cleanup(); }
  }
});

test('A tool that reads Claude Code’s folder has the skill one way: from Claude Code’s copy while it is there, else from its own', async () => {
  const box = await sandbox(['claude-cli', 'opencode-cli']);
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    assert.equal((await bytes(folderOf(box, 'opencode-cli'))), undefined, 'OpenCode reads Claude Code’s copy: no second one');
    const { fact, item, row } = await seen(box);
    assert.equal(harnessIs(row, item, 'opencode-cli'), 'another-way');
    assert.match(fact!.anotherWay?.['opencode-cli'] ?? '', /reads Claude Code’s copy/);
    // Kept out of Claude Code: its copy goes, and OpenCode gets one of its own.
    await inTool(box, 'claude-cli', true);
    assert.deepEqual([await bytes(folderOf(box, 'claude-cli')), !!(await bytes(folderOf(box, 'opencode-cli')))], [undefined, true]);
    assert.equal((await pass(box)).writes, 0);
    // Back in Claude Code: OpenCode's own copy, Central Knot's, goes, so it is never loaded twice.
    await inTool(box, 'claude-cli', false);
    assert.deepEqual([!!(await bytes(folderOf(box, 'claude-cli'))), await bytes(folderOf(box, 'opencode-cli'))], [true, undefined]);
    assert.equal((await pass(box)).writes, 0);
    // A copy OpenCode has of its own that Central Knot never put there stays, and its line says it has it both ways.
    await put(box, 'opencode-cli', { 'SKILL.md': skillText('My own.') });
    await pass(box);
    assert.equal(await readFile(join(folderOf(box, 'opencode-cli'), 'SKILL.md'), 'utf8'), skillText('My own.'));
    const both = await seen(box);
    assert.match(say.harnessLine(both.row, both.item, 'opencode-cli', 'OpenCode'), /has it both ways/);
    // Kept out of OpenCode, which still reads Claude Code's copy: Claude Code's folder stays, and OpenCode's line says so.
    await rm(folderOf(box, 'opencode-cli'), { recursive: true });
    await inTool(box, 'opencode-cli', true);
    const out = await seen(box);
    assert.ok(await bytes(folderOf(box, 'claude-cli')));
    assert.match(say.harnessLine(out.row, out.item, 'opencode-cli', 'OpenCode'), /^Kept out of this tool, but it still has it another way\. OpenCode reads Claude Code’s copy/);
  } finally { await box.cleanup(); }
});

test('Kept out of Claude Code, which holds a copy of its own, OpenCode reads that copy: Central Knot’s copy in OpenCode goes, so it is loaded once', async () => {
  const box = await sandbox(['claude-cli', 'opencode-cli']);
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    await inTool(box, 'claude-cli', true);
    assert.ok(await bytes(folderOf(box, 'opencode-cli')), 'OpenCode got a copy of its own');
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Mine, in Claude Code.') });
    await pass(box);
    const { fact } = await seen(box);
    assert.deepEqual([await bytes(folderOf(box, 'opencode-cli')), await readFile(join(folderOf(box, 'claude-cli'), 'SKILL.md'), 'utf8')], [undefined, skillText('Mine, in Claude Code.')]);
    assert.match(fact!.anotherWay?.['opencode-cli'] ?? '', /^OpenCode reads a copy in Claude Code’s skills folder, which is not Central Knot’s\.$/);
  } finally { await box.cleanup(); }
});

test('A tool whose skills folder is itself a link is never written through: its line says why, and a skill in it is one it has another way', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    const shared = join(box.home, '.agents/skills');
    await mkdir(shared, { recursive: true });
    await rm(join(box.home, roots['copilot-cli']), { recursive: true });
    await symlink('../.agents/skills', join(box.home, roots['copilot-cli']));
    await put(box, 'claude-cli');
    await turnOn(box);
    assert.deepEqual(await readdir(shared), [], 'nothing is written into the folder the link leads to');
    const { fact, item, row } = await seen(box);
    assert.equal(harnessIs(row, item, 'copilot-cli'), 'cannot');
    assert.match(fact!.cannot['copilot-cli'] ?? '', /skills folder is a link/);
    await mkdir(join(shared, 'gamma'));
    await writeFile(join(shared, 'gamma/SKILL.md'), skillText('In the shared folder.', 'gamma'));
    assert.match((await seen(box, box.context, 'gamma')).fact!.anotherWay?.['copilot-cli'] ?? '', /reads it in .*skills folder is a link/);
  } finally { await box.cleanup(); }
});

test('A name a tool keeps for itself (Claude Code’s “synced”) is never given to it: its line says why', async () => {
  const box = await sandbox();
  try {
    await put(box, 'copilot-cli', { 'SKILL.md': skillText('Take notes.', 'synced') }, [], 'synced');
    await turnOn(box, box.context, 'synced');
    assert.equal(await bytes(folderOf(box, 'claude-cli', 'synced')), undefined);
    assert.match((await seen(box, box.context, 'synced')).fact!.cannot['claude-cli'] ?? '', /Claude Code reserves the name “synced”/);
  } finally { await box.cleanup(); }
});

test('A found skill only Codex has: OpenCode’s line says what is true before it is turned on, not that it reads a copy Claude Code doesn’t have', async () => {
  const box = await sandbox(['claude-cli', 'codex-cli', 'opencode-cli']);
  try {
    await put(box, 'codex-cli');
    const before = (await seen(box)).fact!.anotherWay?.['opencode-cli'] ?? '';
    assert.doesNotMatch(before, /reads Claude Code’s copy/);
    assert.match(before, /^OpenCode reads Claude Code’s skills folder, so it gets the skill from there once it is on in Claude Code\.$/);
    await turnOn(box);
    assert.match((await seen(box)).fact!.anotherWay?.['opencode-cli'] ?? '', /^OpenCode reads Claude Code’s copy, in Claude Code’s skills folder\./);
  } finally { await box.cleanup(); }
});

test('A copy in ~/.agents/skills is not Central Knot’s: the tools that read it have the skill another way, an Off row says so, and Take over makes Central Knot’s copy theirs', async () => {
  const box = await sandbox();
  try {
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skillText('In the shared folder.'));
    assert.equal((await seen(box)).fact!.takeOver, undefined, 'a found skill is taken in before anything is taken over');
    // Found only in the shared folder: taken in from it; Claude Code, which doesn't read it, gets a copy; the others have it there.
    assert.notEqual(await turnOn(box), 'choose');
    const all = await everywhere(box);
    assert.deepEqual([!!all['claude-cli'], all['copilot-cli'], all['codex-cli']], [true, undefined, undefined]);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), skillText('In the shared folder.'), 'the shared folder is never written');
    const { fact, item, row } = await seen(box);
    assert.deepEqual(fact!.takeOver?.['codex-cli'], { kind: 'shared', path: shared });
    assert.equal(statusLine(row, item, tools), 'On in Claude Code · Copilot CLI and Codex have it another way');
    // Off: Claude Code's copy goes; the shared one stays, and the row says the tools that read it still have it.
    await turnOff(box);
    const off = await seen(box);
    assert.match(say.harnessLine(off.row, off.item, 'codex-cli', 'Codex'), /^Off · codex also reads a copy at .*\.agents\/skills, which is not Central Knot’s\.$/i);
    await turnOn(box);
    // An edit in Central Knot's copy: the shared one is not followed, and Take over makes it Central Knot's.
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Edited in Claude Code.') });
    await pass(box);
    assert.equal((await takeOver(box.context, box.tools, 'notes', 'codex-cli')).stopped, undefined);
    assert.equal(await bytes(shared), undefined, 'the shared copy is gone');
    for (const tool of tools) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText('Edited in Claude Code.'), tool);
    const versions = (await itemOf(box))!.versions;
    assert.ok(versions.some(version => version.from.how === 'found'), 'what the shared copy held is a version');
    assert.equal((await historyOf(box)).at(-1)?.kind, 'took-over');
  } finally { await box.cleanup(); }
});

test('Turned on over a different copy made by hand in one tool: History says that copy was written over and kept, and offers it', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    await turnOff(box);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own, by hand.') });
    await pass(box);
    await turnOn(box);
    const on = (await historyOf(box)).at(-1)!;
    const { item } = await seen(box);
    assert.equal(librarySentence(on, libraryWords.skills, tools, item)?.text, 'Turned on: put in all 3 tools. Codex’s own folder was written over and kept as a version.');
    const use = (await historyActions(box)).find(action => action.event.id === on.id && action.label === 'Use codex-cli’s');
    assert.ok(use, 'History offers that version');
    await use!.run();
    for (const tool of tools) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText('Codex’s own, by hand.'), tool);
  } finally { await box.cleanup(); }
});

test('A copy in ~/.agents/skills edited after it was taken in: the tools that read it say it differs, and offer Take over', async () => {
  const box = await sandbox();
  try {
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skillText('In the shared folder.'));
    await turnOn(box);
    assert.doesNotMatch((await seen(box)).fact!.anotherWay?.['codex-cli'] ?? '', /differs/);
    await writeFile(join(shared, 'SKILL.md'), skillText('Edited in the shared folder.'));
    assert.equal((await pass(box)).writes, 0, 'nothing of Central Knot’s goes there');
    const { fact } = await seen(box);
    for (const tool of ['copilot-cli', 'codex-cli'] as const) {
      assert.match(fact!.anotherWay?.[tool] ?? '', /That copy differs from the current version, and isn’t one of its versions\./, tool);
      assert.equal(fact!.takeOver?.[tool]?.kind, 'shared', tool);
    }
  } finally { await box.cleanup(); }
});

test('Take over carries a tool’s own switch: a skill Codex had off where it read ~/.agents/skills stays off in Codex’s new copy', async () => {
  const box = await sandbox();
  try {
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skillText('In the shared folder.'));
    await turnOn(box);
    // Codex's switch goes by the SKILL.md's path (a profile's hold, or the person's).
    await setDisabled(box.context, 'codex-cli', { folder: 'notes', name: 'notes', skillFile: join(shared, 'SKILL.md') }, true);
    assert.equal((await takeOver(box.context, box.tools, 'notes', 'codex-cli')).stopped, undefined);
    const codex = await readSwitchFile(box.context, 'codex-cli');
    assert.equal(isDisabled(box.context, codex, { folder: 'notes', name: 'notes', skillFile: join(folderOf(box, 'codex-cli'), 'SKILL.md') }), true, 'still off in Codex');
    assert.equal((await seen(box)).fact!.loads?.['codex-cli']?.off, true);
  } finally { await box.cleanup(); }
});

test('A take-over that couldn’t happen leaves no History entry saying it did', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  const sharedRoot = join(box.home, '.agents/skills');
  try {
    await mkdir(join(sharedRoot, 'notes'), { recursive: true });
    await writeFile(join(sharedRoot, 'notes/SKILL.md'), skillText('In the shared folder.'));
    await turnOn(box);
    await chmod(sharedRoot, 0o555);
    const done = await takeOver(box.context, box.tools, 'notes', 'codex-cli');
    assert.ok(done.stopped, 'the shared copy could not be removed');
    assert.ok(await bytes(join(sharedRoot, 'notes')), 'and it is still there');
    assert.equal((await historyOf(box)).filter(event => event.kind === 'took-over').length, 0);
  } finally { await chmod(sharedRoot, 0o755).catch(() => undefined); await box.cleanup(); }
});

test('A link to a copy the tool also reads in ~/.agents/skills (as the skills installer leaves them) is said and taken over as that copy: the link goes with it', async () => {
  const box = await sandbox();
  try {
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skillText('From the installer.'));
    await symlink('../../.agents/skills/notes', folderOf(box, 'copilot-cli'));
    await turnOn(box);
    const { fact } = await seen(box);
    assert.match(fact!.anotherWay?.['copilot-cli'] ?? '', /^Copilot CLI also reads a copy at .*\.agents\/skills/);
    assert.deepEqual(fact!.takeOver?.['copilot-cli'], { kind: 'shared', path: shared });
    assert.equal((await takeOver(box.context, box.tools, 'notes', 'copilot-cli')).stopped, undefined);
    // The shared copy is gone, so the link led nowhere: Central Knot's copy is in its place, in every tool.
    assert.equal(await bytes(shared), undefined);
    for (const tool of tools) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText('From the installer.'), tool);
    assert.equal((await bytes(folderOf(box, 'copilot-cli')))?.[''], undefined, 'a folder, not a link');
  } finally { await box.cleanup(); }
});

test('A link in a tool’s skills folder is not Central Knot’s: what it leads to is never written, and Take over replaces only the link', async () => {
  const box = await sandbox();
  try {
    const elsewhere = join(box.home, 'mine/notes');
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, 'SKILL.md'), skillText('Mine, linked.'));
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Mine, linked.') });
    await symlink(elsewhere, folderOf(box, 'codex-cli'));
    await turnOn(box);
    assert.equal((await bytes(folderOf(box, 'codex-cli')))?.[''], 'link', 'the link stays a link');
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Edited.') });
    await pass(box);
    assert.equal(await readFile(join(elsewhere, 'SKILL.md'), 'utf8'), skillText('Mine, linked.'), 'what a link leads to is never written');
    assert.equal((await takeOver(box.context, box.tools, 'notes', 'codex-cli')).stopped, undefined);
    assert.equal(await readFile(join(folderOf(box, 'codex-cli'), 'SKILL.md'), 'utf8'), skillText('Edited.'));
    assert.equal(await readFile(join(elsewhere, 'SKILL.md'), 'utf8'), skillText('Mine, linked.'), 'and is left as it was');
    // Off: Central Knot's copy goes from Codex now; the folder the link led to stays.
    await turnOff(box);
    assert.deepEqual([await bytes(folderOf(box, 'codex-cli')), !!(await bytes(elsewhere))], [undefined, true]);
  } finally { await box.cleanup(); }
});

test('A switch set in a tool is left exactly as it is: the folder stays and the tool doesn’t load it; its line says so, and Clear the switch clears it', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    const target = { folder: 'notes', name: 'notes', skillFile: join(folderOf(box, 'codex-cli'), 'SKILL.md') };
    await setDisabled(box.context, 'codex-cli', target, true);
    const config = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    await pass(box);
    await turnOff(box);
    await turnOn(box);
    assert.equal(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), config, 'Off and On never write a tool’s own switch');
    const { fact, item, row } = await seen(box);
    assert.deepEqual(fact!.loads?.['codex-cli'], { ...target, off: true });
    const view = await skillsView(box.context, box.tools);
    const { kindSource } = await import('../src/itemrow.ts');
    const facts = kindSource({ skills: view, mcp: { tools: [], items: [], library: {} } as never, agents: view }, 'skills').facts.find(entry => entry.key === 'notes')!;
    assert.deepEqual(facts.switched, { 'codex-cli': 'switched off in Codex’s own settings' });
    assert.match(say.harnessLine({ ...row, switched: facts.switched }, item, 'codex-cli', 'Codex'), /It is switched off in Codex’s own settings: Codex doesn’t load it/);
    assert.equal(say.placeTag({ ...row, switched: facts.switched }, item, tools)?.text, 'switched off in Codex');
    // Never on and off at once: Codex is not counted as on, and the switch is drawn partial with what it says.
    assert.equal(statusLine({ ...row, switched: facts.switched }, item, tools), 'On in Claude Code and Copilot CLI · switched off in Codex');
    assert.equal(isPartial(item, tools, { ...row, switched: facts.switched }), true);
    assert.match(switchLabel({ ...row, switched: facts.switched }, item, tools), /^notes: on in 2 of 3 tools\./);
    // Switched off in every tool: never plain on.
    for (const tool of ['claude-cli', 'copilot-cli'] as Tool[]) await setDisabled(box.context, tool, { ...target, skillFile: join(folderOf(box, tool), 'SKILL.md') }, true);
    const everyTool = Object.fromEntries(tools.map(tool => [tool, 'off']));
    assert.equal(say.placeTag({ ...row, switched: everyTool }, item, tools)?.text, 'switched off in all 3 tools');
    const cleared = await clearSwitch(box.context, box.tools, 'notes', 'codex-cli');
    assert.equal(cleared.stopped, undefined);
    assert.equal(isDisabled(box.context, await readSwitchFile(box.context, 'codex-cli'), target), false);
    assert.deepEqual((await historyOf(box)).at(-1)?.switched, [{ tool: 'codex-cli', disabled: false, target }]);
    // Its History entry has a real Undo: Codex's own switch has it off again, as it was.
    const undoIt = (await historyActions(box)).find(action => action.event.kind === 'switched' && action.label === 'Undo');
    assert.ok(undoIt, 'History offers Undo on Clear the switch');
    await undoIt!.run();
    assert.equal(isDisabled(box.context, await readSwitchFile(box.context, 'codex-cli'), target), true);
    assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.skills, tools)?.text, 'Undone: Codex’s own switch has it off again.');
    assert.equal((await historyActions(box)).some(action => action.event.kind === 'switched'), false, 'and that entry is done');
    // Cleared again, then switched off again by hand: that Clear's Undo is no longer offered, and if sent it changes nothing.
    await clearSwitch(box.context, box.tools, 'notes', 'codex-cli');
    await setDisabled(box.context, 'codex-cli', target, true);
    assert.equal((await historyActions(box)).some(action => action.event.kind === 'switched'), false, 'not offered while Codex has it off');
    const clearedAgain = (await historyOf(box)).filter(event => event.kind === 'switched').at(-1)!;
    assert.match((await restore(box, clearedAgain.id)).stopped ?? '', /off already\. Nothing was changed\./);
  } finally { await box.cleanup(); }
});

test('Every version is kept while the skill is in Central Knot; a deleted skill’s go once its deletion is older than History’s days', async () => {
  const box = await sandbox(['claude-cli']);
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    for (const body of ['One.', 'Two.', 'Three.']) { await put(box, 'claude-cli', { 'SKILL.md': skillText(body) }); await pass(box); }
    const store = join(box.home, '.central-knot/items/skills/notes/versions');
    assert.equal((await readdir(store)).length, 4);
    await pruneDeleted(box.context, Date.now() + 1);
    assert.equal((await readdir(store)).length, 4, 'a live skill keeps every version');
    await remove(box);
    await pruneDeleted(box.context, Date.parse((await itemOf(box))!.deleted!.at) - 1);
    assert.equal((await readdir(store)).length, 4, 'within History’s days, its Restore still has them');
    // Its deletion older than History's days: the next History entry (another skill taken in) takes its versions.
    const record = join(box.home, '.central-knot/skills.json'), saved = JSON.parse(await readFile(record, 'utf8'));
    saved.items.notes.deleted.at = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await writeFile(record, JSON.stringify(saved, null, 2));
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Other.', 'other') }, [], 'other');
    await turnOn(box, { ...box.context, historyDays: 30 }, 'other');
    assert.deepEqual(await readdir(store).catch(() => []), []);
    assert.ok((await itemOf(box))!.deleted, 'its tombstone stays');
  } finally { await box.cleanup(); }
});

test('Delete from Central Knot takes it out of every tool, History restores it; a skill keyed “agents” keeps its versions apart from the agents’', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('A skill.', 'agents') }, [], 'agents');
    await turnOn(box, box.context, 'agents');
    assert.deepEqual(await readdir(join(box.home, '.central-knot/items')), ['skills']);
    assert.deepEqual(await readdir(join(box.home, '.central-knot/items/skills')), ['agents']);
    await send(box, { key: 'agents', managed: true, off: [], deleted: true });
    assert.deepEqual(Object.values(await everywhere(box, 'agents')).filter(Boolean), []);
    const deleted = (await readHistory(box.context)).find(event => event.key === 'agents' && event.kind === 'deleted')!;
    await restore(box, deleted.id);
    assert.equal(await readFile(join(folderOf(box, 'codex-cli', 'agents'), 'SKILL.md'), 'utf8'), skillText('A skill.', 'agents'));
  } finally { await box.cleanup(); }
});

test('Make current writes an earlier version everywhere it is on; while Off it changes no tool', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    const first = (await itemOf(box))!.hash;
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Later.') });
    await pass(box);
    await makeCurrent(box, first);
    for (const tool of tools) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText(), tool);
    await turnOff(box);
    const later = (await itemOf(box))!.versions.find(version => version.hash !== first)!.hash;
    await makeCurrent(box, later);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), []);
  } finally { await box.cleanup(); }
});

test('Found copies that differ ask which one; the others become versions as they are written over', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s.') });
    assert.equal(await turnOn(box), 'choose');
    await choose(box, 'codex-cli');
    for (const tool of tools) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText('Codex’s.'), tool);
    assert.deepEqual((await itemOf(box))!.versions.map(version => version.from.how).sort(), ['chosen', 'was-in']);
  } finally { await box.cleanup(); }
});

test('A found copy another tool wouldn’t load is no choice for that tool: the question names the tool and why', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': 'Just text.\n' });
    await put(box, 'codex-cli');
    const { fact } = await seen(box);
    assert.deepEqual(fact!.choiceBlocks!['codex-cli'], [], 'Claude Code loads Codex’s copy');
    assert.deepEqual(fact!.choiceBlocks!['claude-cli']!.map(block => block.tool), ['codex-cli']);
    assert.match(fact!.choiceBlocks!['claude-cli']![0]!.reason, /^Codex will not load a skill with no YAML frontmatter\./);
  } finally { await box.cleanup(); }
});

test('The tool choice lets go of a tool’s folder: a tool left out and back gets the library’s version, its own edit kept as a version', async () => {
  const box = await sandbox();
  const context: ShareContext = { ...box.context };
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    await chooseTools(context, ['claude-cli', 'copilot-cli']);
    box.tools.splice(0, box.tools.length, 'claude-cli', 'copilot-cli');
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Edited while left out.') });
    await rm(folderOf(box, 'copilot-cli'), { recursive: true });
    await pass(box);
    assert.equal((await itemOf(box))!.on, false, 'a folder deleted in a managed tool still turns it Off');
    await turnOn(box);
    await chooseTools(context, tools as HarnessId[]);
    box.tools.splice(0, box.tools.length, ...tools);
    await pass(box);
    assert.equal(await readFile(join(folderOf(box, 'codex-cli'), 'SKILL.md'), 'utf8'), skillText(), 'the library wins in a tool managed again');
    assert.ok((await itemOf(box))!.versions.some(version => version.from.how === 'was-in' && version.from.harness === 'codex-cli'));
    assert.deepEqual((await historyOf(box)).filter(event => event.cause === 'tool-back').map(event => event.kind), ['kept-edit']);
  } finally { await box.cleanup(); }
});

test('A folder that can’t be written holds the write there, and the tool catches up once it can', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await chmod(join(box.home, roots['codex-cli']), 0o555);
    await turnOn(box);
    const { fact, item, row } = await seen(box);
    assert.equal(harnessIs(row, item, 'codex-cli'), 'cannot');
    assert.match(fact!.cannot['codex-cli'] ?? '', /can’t be written/);
    await chmod(join(box.home, roots['codex-cli']), 0o755);
    await pass(box);
    assert.ok(await bytes(folderOf(box, 'codex-cli')));
  } finally { await chmod(join(box.home, roots['codex-cli']), 0o755).catch(() => undefined); await box.cleanup(); }
});

test('A tool that won’t load a skill of that shape can’t be given it, and its line says why', async () => {
  const box = await sandbox();
  try {
    // No frontmatter: Copilot CLI and Codex won't load it; Claude Code does. Found, the row already marks them so.
    await put(box, 'claude-cli', { 'SKILL.md': 'Just text.\n' });
    const found = await seen(box);
    assert.deepEqual(tools.map(tool => harnessIs(found.row, found.item, tool)), ['own-copy', 'cannot', 'cannot']);
    await turnOn(box);
    assert.deepEqual([await bytes(folderOf(box, 'copilot-cli')), await bytes(folderOf(box, 'codex-cli'))], [undefined, undefined]);
    const { item, row, fact } = await seen(box);
    assert.match(fact!.cannot['copilot-cli'] ?? '', /Copilot CLI will not load a skill with no YAML frontmatter/);
    assert.match(fact!.cannot['codex-cli'] ?? '', /^Codex will not load a skill with no YAML frontmatter\./);
    assert.equal(say.placeTag({ ...row, cannot: fact!.cannot }, item, tools)?.text, 'Claude Code only');
  } finally { await box.cleanup(); }
});

test('An edit Codex won’t load is never written over Codex’s copy, which stays as it was; its line says why, as for a fresh take-in', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    const codexBefore = await bytes(folderOf(box, 'codex-cli'));
    // The description line deleted by hand in Claude Code: Codex won't load a skill without one; Claude Code and Copilot CLI do.
    await writeFile(join(folderOf(box, 'claude-cli'), 'SKILL.md'), '---\nname: notes\n---\n\nTake notes.\n');
    const done = await pass(box);
    assert.deepEqual(await bytes(folderOf(box, 'codex-cli')), codexBefore, 'Codex’s copy stays as it was');
    assert.ok(!done.results.some(result => result.harness === 'codex-cli' && result.outcome === 'written'), 'nothing written to Codex');
    await pass(box);
    const { fact, item, row } = await seen(box);
    assert.equal(harnessIs(row, item, 'codex-cli'), 'cannot');
    assert.match(fact!.cannot['codex-cli'] ?? '', /^Codex will not load it: /);
    assert.equal(await readFile(join(folderOf(box, 'copilot-cli'), 'SKILL.md'), 'utf8'), '---\nname: notes\n---\n\nTake notes.\n', 'the others get the edit');
    assert.equal((await pass(box)).writes, 0, 'and later passes write nothing');
  } finally { await box.cleanup(); }
});

test('A found row says “every tool” only when it is true: the tools it will go to, those that can’t take it, those that have it another way, and what to do when it can’t be taken in', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': 'Just text.\n' });
    const plain = await seen(box);
    assert.equal(statusLine(plain.row, plain.item, tools), 'Not in Central Knot · in Claude Code. Add it to keep it in Central Knot; Copilot CLI and Codex can’t take it (see below).');
    assert.equal(addLabel(plain.row, plain.item, tools), 'Add notes to Central Knot; Copilot CLI and Codex can’t take it');
    await rm(folderOf(box, 'claude-cli'), { recursive: true });
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skillText());
    const found = await seen(box);
    assert.equal(statusLine(found.row, found.item, tools), 'Not in Central Knot · Copilot CLI and Codex have it another way. Add it to keep it in Central Knot and put it in Claude Code.');
    // Taken in, its result names where it is on and who has it another way, and those tools' lines have no switch of Central Knot's.
    assert.equal(say.said.takenIn('notes', ['claude-cli'], tools, undefined, ['copilot-cli', 'codex-cli']), 'notes is in Central Knot now, and on in Claude Code; Copilot CLI and Codex have it another way.');
    await rm(shared, { recursive: true });
    await put(box, 'claude-cli');
    await symlink('SKILL.md', join(folderOf(box, 'claude-cli'), 'alias'));
    const linked = await seen(box);
    assert.equal(say.placeTag(linked.row, linked.item, tools)?.text, 'can’t be taken in');
    assert.match(linked.fact!.unseen?.['claude-cli'] ?? '', /Replace the link with the file it leads to, then Refresh\.$/);
  } finally { await box.cleanup(); }
});

test('A partial skill (kept out of a tool by its switch in the opened row) says where it is, and the main switch is all or nothing', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    await inTool(box, 'codex-cli', true);
    const { item, row } = await seen(box);
    assert.equal(say.placeTag(row, item, tools)?.text, 'in 2 of 3 tools · kept out of Codex');
    // Off takes it out of every tool; On puts it back where it was on, Codex still kept out.
    await turnOff(box);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), []);
    await turnOn(box);
    const all = await everywhere(box);
    assert.deepEqual([!!all['claude-cli'], !!all['copilot-cli'], all['codex-cli']], [true, true, undefined]);
    assert.deepEqual((await itemOf(box))!.except, ['codex-cli']);
  } finally { await box.cleanup(); }
});

// Skills on Central Knot's library, on real folders in a temp home (src/skills.ts, the skills' Kind; the model is
// src/library.ts). Each test is one worked example: a skill found and taken in, Off and On byte for byte, edits and
// deletions made by hand, the folders that are not Central Knot's, a tool's own switch, the store, crashes, and the tool
// choice. The migration from the earlier record is tests/skillmigrate.test.ts; the seeded walk is tests/librarywalk.test.ts.
import { test } from 'node:test';
import { itemNotice } from './notices.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, readFile, readdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { lockPath, lockSkip, withLock } from './fslock.ts';
import { colonNameSkip, posixModeSkip, slashPath } from './wincompat.ts';
import { dirname, join } from 'node:path';
import { readHistory } from '../src/history.ts';
import { libraryEntry, librarySentence } from '../src/historyactions.ts';
import { addLabel, canAdd, harnessIs, isPartial, libraryWords, ownCopies, placeOf, rowClicks, sentences, statusLine, switchLabel } from '../src/libraryrow.ts';
import { readTree, type ShareContext } from '../src/share.ts';
import { applySkills, clearSwitch, readDisk, skillChange, skillFoundFile, skillPluginFile, skillsView, skillVersion, skillVersionFile, takeOver } from '../src/skills.ts';
import { serversView } from '../src/servers.ts';
import { agentsView } from '../src/agents.ts';
import { homePass } from '../src/homepass.ts';
import { pruneDeleted } from '../src/skillstore.ts';
import { isDisabled, readSwitchFile, setDisabled } from '../src/skillswitch.ts';
import { chooseTools } from '../src/toolchoice.ts';
import { forgetMissing } from '../src/librarypass.ts';
import { readRecord, saveRecord } from '../src/share.ts';
import { clickResults } from '../src/clickplan.ts';
import { setSyncEverything } from '../src/everything.ts';
import { NO_PLUGINS, saveProfile, switchProfile } from '../src/profiles.ts';
import type { Change, HarnessId, PassResult } from '../src/types.ts';
import { toolsPhrase } from '../src/words.ts';
import { bytes, choose, everywhere, folderOf, historyActions, historyOf, inTool, itemOf, makeCurrent, pass, put, remove, restore, roots, sandbox, seen, send, skillText, tools, turnOff, turnOn, type Box, type Tool } from './skillclicks.ts';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 9, minutes));
/** Sets a whole folder's time (every file and folder in it), as a save in an editor would leave it. */
async function touch(path: string, when: Date) {
  for (const entry of await readdir(path, { recursive: true })) await utimes(join(path, entry), when, when);
  await utimes(path, when, when);
}
const say = sentences(libraryWords.skills);
/** A skill with several files: a script that can run, a file of mode 0600, an empty folder, and a file a tool added beside SKILL.md. */
const rich = { 'SKILL.md': skillText(), 'scripts/run.sh': { text: '#!/bin/sh\necho hi\n', mode: 0o755 }, 'secret.txt': { text: 'mine\n', mode: 0o600 }, 'notes.log': 'added by Claude Code\n' };

test('A skill found in one tool is taken in by its switch and goes into every tool, its whole folder byte for byte', async t => {
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
    assert.ok(all['codex-cli']!['scripts/run.sh']?.endsWith(' #!/bin/sh\necho hi\n'));
    await t.test('POSIX execute bit (0755) is kept on scripts', { skip: posixModeSkip }, () => {
      assert.equal(all['codex-cli']!['scripts/run.sh'], '755 #!/bin/sh\necho hi\n');
    });
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

test('A copy whose files are older than its folder keeps the folder’s time outside the copy question: in its details, and as the version taken in', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await utimes(join(folderOf(box, 'claude-cli'), 'SKILL.md'), at(0), at(0));
    await utimes(folderOf(box, 'claude-cli'), at(30), at(30));
    assert.equal((await seen(box)).fact!.copies['claude-cli']!.modified, at(30).toISOString(), 'its details');
    await turnOn(box);
    assert.deepEqual((await itemOf(box))!.versions.map(version => version.at), [at(30).toISOString()], 'its version’s time, as History says it');
  } finally { await box.cleanup(); }
});

test('Two edits a minute apart: History and the notice call the later one the latest; two saved in the same millisecond: the times can’t tell, and neither do they', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s edit.') });
    await touch(folderOf(box, 'codex-cli'), at(10));
    await put(box, 'copilot-cli', { 'SKILL.md': skillText('Copilot’s edit.') });
    await touch(folderOf(box, 'copilot-cli'), at(11));
    const apart = itemNotice((await pass(box)).notices![0]);
    assert.equal(say.noticeWords(apart).text, 'notes: Copilot CLI’s edit is the latest, so it is the current version. Codex’s is kept as a version.');
    assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.skills, tools)?.text, 'Copilot CLI’s edit was the latest, so it became the current version. Codex’s is kept as a version.');
    // The same millisecond: Claude Code comes first among the tools, and that is all that decided.
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Claude Code’s edit.') });
    await touch(folderOf(box, 'claude-cli'), at(30));
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s second edit.') });
    await touch(folderOf(box, 'codex-cli'), at(30));
    const tie = itemNotice((await pass(box)).notices![0]);
    assert.deepEqual([tie.winner, tie.orderProved], ['claude-cli', false]);
    assert.equal(say.noticeWords(tie).text, 'notes: Claude Code’s edit is the current version, though the times can’t tell which edit came last. Codex’s is kept as a version.');
    assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.skills, tools)?.text, 'Claude Code’s edit became the current version, though the times can’t tell which edit came last. Codex’s is kept as a version.');
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

test('A folder really deleted by hand in one tool turns the skill Off everywhere; Central Knot keeps it, and History’s Turn it on puts it back', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', rich);
    await turnOn(box);
    const before = await everywhere(box);
    await rm(folderOf(box, 'copilot-cli'), { recursive: true });
    const done = await pass(box);
    assert.deepEqual(done.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner]), [['deleted-by-hand', 'copilot-cli']]);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), []);
    assert.equal((await itemOf(box))!.on, false);
    const off = (await historyOf(box)).find(event => event.kind === 'off')!;
    await restore(box, off.id);
    assert.deepEqual(await everywhere(box), before);
  } finally { await box.cleanup(); }
});

test('A folder seen again in part ends its absence: moved away by a save, back without its SKILL.md, later away again for a moment, it turns nothing Off', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', rich);
    await turnOn(box);
    const before = await everywhere(box);
    const waiting = { ...box.context, settleMs: 2000 }, codex = folderOf(box, 'codex-cli'), aside = join(box.base, 'saving');
    // An editor's save moves Codex's folder away as Sync once runs: its window starts.
    await rename(codex, aside);
    assert.equal((await applySkills(waiting, box.tools, [], { now: 1000 })).settling, true);
    // Sync once reads again: the folder is back, without its SKILL.md yet. Something is there, so that absence is over.
    await rename(join(aside, 'SKILL.md'), join(box.base, 'SKILL.md'));
    await rename(aside, codex);
    assert.equal((await applySkills(waiting, box.tools, [], { now: 3500 })).writes, 0);
    // The save finishes. Minutes later the next save moves the folder away for a moment as Sync once runs: a new window.
    await rename(join(box.base, 'SKILL.md'), join(codex, 'SKILL.md'));
    await rename(codex, aside);
    const brief = await applySkills(waiting, box.tools, [], { now: 300_000 });
    assert.deepEqual([brief.settling, brief.writes, (await itemOf(box))!.on], [true, 0, true]);
    await rename(aside, codex);
    assert.equal((await applySkills(waiting, box.tools, [], { now: 303_000 })).writes, 0);
    assert.deepEqual([(await itemOf(box))!.on, await everywhere(box)], [true, before]);
  } finally { await box.cleanup(); }
});

test('A copy held while it is missing (its skills folder can’t be written) ends its absence too: once the folder can be, the window starts again', { skip: lockSkip }, async () => {
  const box = await sandbox();
  const folder = join(box.home, roots['codex-cli']);
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    const waiting = { ...box.context, settleMs: 2000 };
    await rm(folderOf(box, 'codex-cli'), { recursive: true });
    assert.equal((await applySkills(waiting, box.tools, [], { now: 1000 })).settling, true);
    await withLock(folder, 'dir-readonly', () => applySkills(waiting, box.tools, [], { now: 1500 }));
    const writable = await applySkills(waiting, box.tools, [], { now: 300_000 });
    assert.deepEqual([writable.settling, (await itemOf(box))!.on], [true, true]);
    await applySkills(waiting, box.tools, [], { now: 302_500 });
    assert.equal((await itemOf(box))!.on, false, 'a deletion that stays still turns the skill Off');
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
    await (await import('../src/skills.ts')).applySkills(offline, box.tools, [{ key: 'notes', on: false, except: [] }], { only: new Set(['notes']) });
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
    assert.equal(fact!.readsFrom?.['opencode-cli'], 'claude-cli');
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

test('A skill found in OpenCode’s own folder, taken in and turned Off: while OpenCode keeps that copy, the row, its tag and its switch say OpenCode has it, as its mark does', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli', 'opencode-cli']);
  try {
    await put(box, 'opencode-cli');
    await turnOn(box);
    const before = await seen(box);
    await turnOff(box);
    // OpenCode had it another way once it was on (it reads Claude Code's copy), so the copy it was found with was never
    // recorded as applied there, and Off leaves it as OpenCode's own.
    assert.ok(await bytes(folderOf(box, 'opencode-cli')), 'OpenCode still has the copy it was found with');
    const { fact, item, row } = await seen(box);
    assert.equal(harnessIs(row, item, 'opencode-cli'), 'own-copy');
    assert.match(say.harnessLine(row, item, 'opencode-cli', 'OpenCode'), /^Has a copy Central Knot didn’t put there\. It is left alone while the skill is off;/);
    assert.equal(statusLine(row, item, box.tools), 'Off · in Central Knot and OpenCode. On puts it in every tool. OpenCode has a copy Central Knot didn’t put there.');
    assert.deepEqual(say.placeTag(fact!, item, box.tools), { text: 'in Central Knot and OpenCode', title: 'Central Knot keeps this skill and its versions. OpenCode has a copy Central Knot didn’t put there, left alone while the skill is off.' });
    assert.equal(switchLabel(row, item, box.tools), 'notes: off, in Central Knot and OpenCode. Click to put it in every tool; OpenCode has a copy of its own, which is kept as versions first.');
    // The Off click's result, from the row it was clicked on (matrix.ts turnOff): the copy OpenCode keeps there too.
    assert.equal(say.said.off('notes', [], box.tools, [], ownCopies(before.row, before.item, box.tools)),
      'notes is off, but OpenCode has a copy Central Knot didn’t put there. Central Knot keeps it, and turning it on puts each folder back as it was.');
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
    assert.equal(fact!.readsFrom?.['opencode-cli'], undefined);
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
    const linkedFact = (await seen(box, box.context, 'gamma')).fact!;
    assert.match(linkedFact.anotherWay?.['copilot-cli'] ?? '', /reads it in .*skills folder is a link/);
    assert.equal(linkedFact.readsFrom?.['copilot-cli'], undefined);
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
    const before = await seen(box);
    const beforeWhy = before.fact!.anotherWay?.['opencode-cli'] ?? '';
    assert.doesNotMatch(beforeWhy, /reads Claude Code’s copy/);
    assert.match(beforeWhy, /^OpenCode reads Claude Code’s skills folder, so it gets the skill from there once it is on in Claude Code\.$/);
    assert.equal(before.fact!.readsFrom?.['opencode-cli'], undefined);
    assert.deepEqual(say.detailLine(before.row, before.item, 'opencode-cli', 'OpenCode'), [{
      text: 'Gets it from Claude Code’s skills folder once it is on there.',
    }]);
    assert.equal(say.harnessLine(before.row, before.item, 'opencode-cli', 'OpenCode'),
      'Not in Central Knot · OpenCode reads Claude Code’s skills folder, so it gets the skill from there once it is on in Claude Code.');
    await turnOn(box);
    const on = await seen(box);
    assert.match(on.fact!.anotherWay?.['opencode-cli'] ?? '', /^OpenCode reads Claude Code’s copy, in Claude Code’s skills folder\./);
    assert.equal(on.fact!.readsFrom?.['opencode-cli'], 'claude-cli');
    assert.deepEqual(say.detailLine(on.row, on.item, 'opencode-cli', 'OpenCode'), [{
      text: 'Reads Claude Code’s copy',
      card: 'OpenCode reads this skill from Claude Code’s folder; Central Knot writes nothing to OpenCode meanwhile.',
    }]);
    // Claude Code's copy deleted by hand with no sync yet: OpenCode does not hold a live copy from Claude Code, so no short label.
    await rm(folderOf(box, 'claude-cli'), { recursive: true });
    const afterDelete = await seen(box);
    assert.equal(afterDelete.fact!.readsFrom?.['opencode-cli'], undefined);
    assert.deepEqual(say.detailLine(afterDelete.row, afterDelete.item, 'opencode-cli', 'OpenCode'), [{
      text: 'OpenCode reads Claude Code’s skills folder, so it gets the skill from there once it is on in Claude Code. Nothing of Central Knot’s goes there while it does.',
    }]);
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

test('A skill whose folder is named with a colon (Finder shows “review/fix”): its entry is a skill’s, and the click’s Undo takes it out again', { skip: colonNameSkip }, async () => {
  const box = await sandbox();
  try {
    const name = 'review:fix';
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Body.', name) }, [], name);
    assert.notEqual(await turnOn(box, box.context, name), 'choose');
    const on = (await historyOf(box, box.context, name)).at(-1)!;
    assert.deepEqual(libraryEntry(on), { kind: 'skills', key: name }, 'History routes it to the skills, as the page offers its Undo');
    const undo = (await historyActions(box, box.context, name)).find(action => action.event.id === on.id);
    assert.equal(undo?.label, 'Undo', 'its Undo is offered');
    assert.equal((await undo!.run()).stopped, undefined);
    assert.deepEqual([!!(await bytes(folderOf(box, 'claude-cli', name))), await bytes(folderOf(box, 'copilot-cli', name)), await bytes(folderOf(box, 'codex-cli', name))],
      [true, undefined, undefined], 'out of Central Knot again: Claude Code keeps the copy it was found in');
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
    assert.equal(librarySentence(on, libraryWords.skills, tools, item)?.text, 'Turned on: put in all 3 tools. Codex’s own copy was written over and kept as a version.');
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
    assert.equal((await seen(box)).fact!.loads?.['codex-cli']?.switchedOff, true);
  } finally { await box.cleanup(); }
});

test('A take-over that couldn’t happen leaves no History entry saying it did', { skip: lockSkip }, async () => {
  const box = await sandbox();
  const sharedRoot = join(box.home, '.agents/skills');
  try {
    await mkdir(join(sharedRoot, 'notes'), { recursive: true });
    await writeFile(join(sharedRoot, 'notes/SKILL.md'), skillText('In the shared folder.'));
    await turnOn(box);
    await withLock(sharedRoot, 'dir-readonly', async () => {
      const done = await takeOver(box.context, box.tools, 'notes', 'codex-cli');
      assert.ok(done.stopped, 'the shared copy could not be removed');
      assert.ok(await bytes(join(sharedRoot, 'notes')), 'and it is still there');
      assert.equal((await historyOf(box)).filter(event => event.kind === 'took-over').length, 0);
    });
  } finally { await box.cleanup(); }
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
    assert.equal(fact!.readsFrom?.['copilot-cli'], undefined);
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

// ---------- A copy in the shared folder deleted by hand ----------

/**
 * A home shaped like the owner's: notes and other in ~/.agents/skills, which Copilot CLI, Codex, Pi (and OpenCode) read, and
 * Claude Code's entry for notes a link to it (unless `link` is false); both on, so the record names two folders there and one
 * gone is a deletion. `toolFolders`: every tool's own skills folder, byte for byte (a link as a link).
 */
async function sharedHome(link = true, present: Tool[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli']) {
  const box = await sandbox(present), root = join(box.home, '.agents/skills'), shared = join(root, 'notes');
  for (const name of ['notes', 'other']) { await mkdir(join(root, name), { recursive: true }); await writeFile(join(root, name, 'SKILL.md'), skillText('In the shared folder.', name)); }
  if (link) await mkdir(join(box.home, roots['claude-cli']), { recursive: true }).then(() => symlink('../../.agents/skills/notes', folderOf(box, 'claude-cli')));
  for (const key of ['notes', 'other']) await turnOn(box, box.context, key);
  const toolFolders = async () => Object.fromEntries(await Promise.all(Object.values(roots).map(async folder => [folder, await bytes(join(box.home, folder))] as const)));
  return { box, root, shared, toolFolders };
}
const noticesOf = (...passes: PassResult[]) => passes.flatMap(done => done.notices ?? []).map(itemNotice).map(notice => say.noticeWords(notice));
const deletedHere = async (box: Box) => (await readHistory(box.context)).filter(entry => entry.cause === 'deleted-by-hand').map(entry => entry.item);

test('The shared copy deleted by hand, Claude Code’s entry a link to it: two passes write nothing, the skill is off with one notice and one History entry naming the shared folder, and Turn it on gives each tool Central Knot’s own copy', async () => {
  const { box, shared, toolFolders } = await sharedHome();
  try {
    assert.deepEqual((await itemOf(box))!.throughShared, { 'claude-cli': 'notes', 'copilot-cli': 'notes', 'codex-cli': 'notes', 'pi-cli': 'notes' }, 'how each tool has it, kept');
    await rm(shared, { recursive: true });
    const before = await toolFolders(), told = (await historyOf(box)).length;
    const passes = [await pass(box), await pass(box)];
    assert.deepEqual(await toolFolders(), before, 'nothing written into any tool, and the link that leads nowhere left as it is');
    assert.equal((await itemOf(box))!.on, false);
    assert.deepEqual(noticesOf(...passes).map(words => [words.text, words.help]), [['notes was deleted in the shared folder, so it is off. Central Knot keeps it.',
      'Put notes in every tool as Central Knot’s own folder, in place of a link that leads nowhere']]);
    const entries = (await historyOf(box)).slice(told);
    assert.deepEqual(entries.map(entry => librarySentence(entry, libraryWords.skills, box.tools)?.text), ['Its copy was deleted in the shared folder, so it was turned off. Central Knot keeps it.']);
    // Its way back, Turn it on: each tool gets its own copy, Claude Code's in place of the link, said; the shared folder is never written.
    const on = await restore(box, entries[0].id);
    for (const tool of box.tools as Tool[]) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText('In the shared folder.'), tool);
    assert.equal((await bytes(folderOf(box, 'claude-cli')))?.[''], undefined, 'a folder, not the link');
    assert.deepEqual(on.results.filter(result => result.outcome === 'written').map(result => result.harness).sort(), [...box.tools].sort());
    assert.equal(on.results.find(result => result.harness === 'claude-cli')?.message, 'Added, in place of a link that led nowhere.');
    assert.equal(await bytes(shared), undefined);
  } finally { await box.cleanup(); }
});

test('The shared copy gone while the app was closed, or for a moment: nothing at all until it has stayed gone the settle window; back within it, nothing', async () => {
  const { box, root, shared, toolFolders } = await sharedHome();
  const settle = (now: number) => applySkills({ ...box.context, settleMs: 2000 }, box.tools, [], { background: true, now });
  try {
    const before = await toolFolders();
    // Gone and back within the window (an installer's update): not even the link that leads nowhere for a moment is written over.
    await rename(shared, join(root, '.aside'));
    const away = await settle(1e12);
    await rename(join(root, '.aside'), shared);
    const back = await settle(1e12 + 3000);
    assert.deepEqual([away.writes, away.settling, back.writes, (await itemOf(box))!.on, await toolFolders()], [0, true, 0, true, before]);
    // Deleted while the app was closed: a restart forgets when an absence began, which only delays the Off.
    await rm(shared, { recursive: true });
    forgetMissing();
    const opened = await settle(2e12), later = await settle(2e12 + 2000);
    assert.deepEqual([opened.writes, opened.settling, later.writes, (await itemOf(box))!.on, await toolFolders()], [0, true, 0, false, before]);
    assert.deepEqual(noticesOf(opened, later).map(words => words.text), ['notes was deleted in the shared folder, so it is off. Central Knot keeps it.']);
  } finally { await box.cleanup(); }
});

test('Only Claude Code’s link to the shared copy deleted by hand: a deletion in Claude Code, as for a copy of its own; nothing written, and the notice and the row say the tools that read the shared copy still have it', async () => {
  const { box, toolFolders } = await sharedHome();
  try {
    await rm(folderOf(box, 'claude-cli'));
    const before = await toolFolders(), done = await pass(box);
    assert.deepEqual([await toolFolders(), noticesOf(done).map(words => [words.text, words.help])],
      [before, [['notes was deleted in Claude Code, so it is off. Copilot CLI, Codex and Pi still read it another way. Central Knot keeps it.',
        'Put notes in Claude Code as Central Knot’s own folder; the tools that read the shared copy still have it']]]);
    const { row, item, fact } = await seen(box), line = statusLine({ ...row, loads: fact!.loads }, item, box.tools);
    assert.equal(item!.on, false);
    for (const tool of ['Copilot CLI', 'Codex', 'Pi']) assert.match(line, new RegExp(`${tool} also reads a copy at`), tool);
  } finally { await box.cleanup(); }
});

test('A shared folder that can’t be vouched for: renamed away, unreadable, holding none of its skills (a volume not mounted, a folder of other things put in its place, a link to another skills folder): nothing written, nothing turned off, said once naming the skills; back, all as before', async t => {
  const { box, root, toolFolders } = await sharedHome();
  const aside = join(box.base, 'aside'), elsewhere = join(box.base, 'other-skills');
  try {
    const before = await toolFolders(), item = await itemOf(box);
    await mkdir(join(elsewhere, 'stranger'), { recursive: true });
    await writeFile(join(elsewhere, 'stranger/SKILL.md'), skillText('Someone else’s.', 'stranger'));
    const putBack = async () => { await rm(root, { recursive: true, force: true }); await rename(aside, root); };
    const ways: [string, () => Promise<unknown>, () => Promise<unknown>][] = [['renamed away', () => rename(root, aside), () => rename(aside, root)],
      ['empty', async () => { await rename(root, aside); await mkdir(root); }, putBack],
      ['a README in its place', async () => { await rename(root, aside); await mkdir(root); await writeFile(join(root, 'README.md'), 'Not mounted.\n'); }, putBack],
      ['a link to another skills folder', async () => { await rename(root, aside); await symlink(elsewhere, root); }, putBack]];
    for (const [how, hide, show] of ways) {
      await hide();
      try {
        const done = await pass(box), view = await skillsView(box.context, box.tools);
        assert.deepEqual([done.writes, done.notices ?? [], (await itemOf(box))!.on, await toolFolders(), view.problems.length], [0, [], true, before, 1], how);
        assert.match(view.problems[0], /^The shared skills folder \(.*\) .*, so Central Knot changes nothing for the skills tools read there \(notes and other\) until/, how);
        if (how === 'renamed away') assert.match(view.problems[0], /until it is back; a skill turned on meanwhile waits for it too \(if you removed it, turn them off and remove any link into it\)\.$/);
      } finally { await show(); }
    }
    await t.test('an unreadable shared skills folder holds everything unchanged', { skip: lockSkip }, async () => {
      await withLock(root, 'dir-unreadable', async () => {
        const done = await pass(box), view = await skillsView(box.context, box.tools);
        assert.deepEqual([done.writes, done.notices ?? [], (await itemOf(box))!.on, await toolFolders(), view.problems.length], [0, [], true, before, 1], 'unreadable');
        assert.match(view.problems[0], /^The shared skills folder \(.*\) .*, so Central Knot changes nothing for the skills tools read there \(notes and other\) until/, 'unreadable');
      });
    });
    assert.deepEqual([await toolFolders(), (await itemOf(box))!.throughShared, (await pass(box)).writes, await deletedHere(box)], [before, item!.throughShared, 0, []]);
  } finally { await box.cleanup(); }
});

test('A click while the shared folder can’t be vouched for writes no copy for the tools that wait, and its result says each waits; a profile switch’s too', async () => {
  const { box, root, toolFolders } = await sharedHome();
  const waits = (results: PassResult['results']) => results.filter(result => result.outcome === 'held' && result.item === 'notes').map(result => result.harness);
  const wanting = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'];
  try {
    await rename(root, join(box.base, 'aside'));
    await turnOff(box);
    const before = await toolFolders(), on = await turnOn(box) as PassResult;
    assert.deepEqual([await toolFolders(), clickResults(on.results, ['notes']).notIn, waits(on.results)], [before, wanting, wanting]);
    assert.equal(on.results.find(result => result.harness === 'codex-cli')?.message, 'Codex waits for the shared skills folder (…/.agents/skills) to be back: nothing is written there until then.');
    await turnOff(box);
    const id = (await saveProfile(box.context, { name: 'Notes', items: ['skill:notes', 'skill:other'] })).id!;
    const switched = await switchProfile(box.context, box.tools, id, NO_PLUGINS);
    assert.deepEqual([await toolFolders(), switched.on, waits(switched.results)], [before, ['notes'], wanting]);
  } finally { await box.cleanup(); }
});

test('A home as an earlier build left it, with nothing kept of how each tool has a skill: the first pass writes nothing and keeps it, even with the shared folder away (the links into it are how it is known); then a deletion there is one', async () => {
  const { box, root, shared, toolFolders } = await sharedHome();
  const record = join(box.home, '.central-knot/skills.json'), aside = join(box.base, 'aside');
  try {
    const stored = JSON.parse(await readFile(record, 'utf8'));
    for (const key of ['notes', 'other']) delete stored.items[key].throughShared;
    await writeFile(record, JSON.stringify(stored));
    const before = await toolFolders();
    // Started with the shared folder away: no copy goes into Copilot CLI, Codex or Pi, nor over Claude Code's link.
    await rename(root, aside);
    assert.deepEqual([(await pass(box)).writes, await toolFolders(), (await skillsView(box.context, box.tools)).problems.length], [0, before, 1]);
    await rename(aside, root);
    assert.deepEqual([(await pass(box)).writes, await toolFolders(), Object.keys((await itemOf(box))!.throughShared ?? {}).length], [0, before, 4]);
    await rm(shared, { recursive: true });
    assert.deepEqual([(await pass(box)).writes, (await itemOf(box))!.on], [0, false]);
  } finally { await box.cleanup(); }
});

test('OpenCode reading Claude Code’s links into the shared folder, Claude Code left out: it has the skills through the shared folder, so the folder away writes no copy into OpenCode', async () => {
  const box = await sandbox(['codex-cli', 'opencode-cli']), root = join(box.home, '.agents/skills');
  try {
    await mkdir(join(box.home, roots['claude-cli']), { recursive: true });
    for (const name of ['notes', 'other']) {
      await mkdir(join(root, name), { recursive: true });
      await writeFile(join(root, name, 'SKILL.md'), skillText('In the shared folder.', name));
      await symlink(`../../.agents/skills/${name}`, folderOf(box, 'claude-cli', name));
      await turnOn(box, box.context, name);
    }
    assert.deepEqual((await itemOf(box))!.throughShared, { 'codex-cli': 'notes', 'opencode-cli': 'notes' });
    const before = await bytes(join(box.home, roots['opencode-cli']));
    await rename(root, join(box.base, 'aside'));
    assert.deepEqual([(await pass(box)).writes, await bytes(join(box.home, roots['opencode-cli'])), (await itemOf(box))!.on], [0, before, true]);
  } finally { await box.cleanup(); }
});

test('How a tool had a skill is let go when its folder is made again, or it is left out and managed again: its link gone then turns nothing off', async () => {
  // Claude Code's skills folder made again, empty: its link is gone, which is no deletion; the folder is written afresh.
  const reset = await sharedHome(), claudeRoot = join(reset.box.home, roots['claude-cli']);
  try {
    await rename(claudeRoot, join(reset.box.base, 'claude-before'));
    await mkdir(claudeRoot);
    await pass(reset.box);
    assert.deepEqual([(await itemOf(reset.box))!.on, await deletedHere(reset.box)], [true, []]);
  } finally { await reset.box.cleanup(); }
  // Claude Code's skills folder away past the settle window: written afresh, as for Central Knot's own copies there; nothing turns off.
  const away = await sharedHome();
  try {
    await rename(join(away.box.home, roots['claude-cli']), join(away.box.base, 'claude-away'));
    await pass(away.box);
    const { row, item } = await seen(away.box);
    assert.deepEqual([item!.on, await deletedHere(away.box), harnessIs(row, item, 'claude-cli'), (await bytes(folderOf(away.box, 'claude-cli')))?.['SKILL.md'] !== undefined],
      [true, [], 'current', true]);
  } finally { await away.box.cleanup(); }
  // Left out, its link deleted while away, managed again before a full pass: Central Knot's version wins there, as for any tool.
  const { box } = await sharedHome();
  try {
    await chooseTools(box.context, 'claude-cli', false);
    await rm(folderOf(box, 'claude-cli'));
    await chooseTools(box.context, 'claude-cli', true);
    await pass(box);
    assert.deepEqual([(await itemOf(box))!.on, await deletedHere(box)], [true, []]);
  } finally { await box.cleanup(); }
});

test('The shared copy back beside Central Knot’s own: the pass that removes those as one too many notes that the tools have it through the shared folder, so its deletion before another pass writes nothing', async () => {
  const { box, shared } = await sharedHome(false);
  try {
    // notes taken over into every tool's own folder, then the installer puts the shared copy back.
    await takeOver(box.context, box.tools, 'notes', 'codex-cli');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skillText('In the shared folder.'));
    const back = await pass(box);
    assert.deepEqual([back.results.filter(result => result.outcome === 'removed').map(result => result.harness).sort(), (await itemOf(box))!.throughShared],
      [['codex-cli', 'copilot-cli', 'pi-cli'], { 'copilot-cli': 'notes', 'codex-cli': 'notes', 'pi-cli': 'notes' }]);
    await rm(shared, { recursive: true });
    const done = await pass(box);
    assert.deepEqual([done.results.filter(result => result.outcome === 'written'), (await itemOf(box))!.on], [[], false]);
  } finally { await box.cleanup(); }
});

test('Claude Code’s link turned to a place that can’t be reached, its old shared copy still there: the link is there, so nothing is concluded and nothing turns off', async () => {
  const { box, toolFolders } = await sharedHome();
  try {
    await rm(folderOf(box, 'claude-cli'));
    await symlink(join(box.base, 'unmounted/notes'), folderOf(box, 'claude-cli'));
    const before = await toolFolders(), done = await pass(box);
    assert.deepEqual([done.writes, (await itemOf(box))!.on, await toolFolders(), await deletedHere(box)], [0, true, before, []]);
  } finally { await box.cleanup(); }
});

test('Take over of a shared copy that a second skill reads through a link of another name: that skill is not taken for deleted, and keeps its copies', async () => {
  const { box } = await sharedHome();
  try {
    await symlink('../../.agents/skills/notes', folderOf(box, 'claude-cli', 'an-alias'));
    await turnOn(box, box.context, 'an-alias');
    assert.deepEqual((await itemOf(box, 'an-alias'))!.throughShared, { 'claude-cli': 'notes' });
    assert.equal((await takeOver(box.context, box.tools, 'notes', 'codex-cli')).stopped, undefined);
    const done = await pass(box);
    assert.deepEqual([(await itemOf(box, 'an-alias'))!.on, await deletedHere(box), done.results.filter(result => result.outcome === 'removed')], [true, [], []]);
    for (const tool of ['copilot-cli', 'codex-cli', 'pi-cli'] as const) assert.ok(await bytes(folderOf(box, tool, 'an-alias')), tool);
  } finally { await box.cleanup(); }
});

test('What is not a deletion in the shared folder: the copy there unreadable for a pass, edited there, its tool’s own switch keeping it out (Pi’s list), and Take over of it', async () => {
  const { box, shared, toolFolders } = await sharedHome();
  try {
    // Its SKILL.md can't be read as a skill: the tools that read it can't see it for sure, and nothing changes.
    await writeFile(join(shared, 'SKILL.md'), '---\nname: [notes\n---\n');
    const unread = await pass(box);
    assert.deepEqual([unread.writes, unread.notices ?? [], (await itemOf(box))!.on], [0, [], true]);
    await writeFile(join(shared, 'SKILL.md'), skillText('Edited in the shared folder.'));
    await setDisabled(box.context, 'pi-cli', { folder: 'notes', name: 'notes', skillFile: join(shared, 'SKILL.md') }, true);
    const before = await toolFolders(), done = await pass(box);
    assert.deepEqual([done.writes, done.notices ?? [], (await itemOf(box))!.on, await toolFolders()], [0, [], true, before]);
    assert.match((await seen(box)).fact!.anotherWay?.['codex-cli'] ?? '', /That copy differs from the current version/);
    // Take over removes the shared copy on purpose: each tool that read it gets Central Knot's copy, and nothing turns off.
    assert.equal((await takeOver(box.context, box.tools, 'notes', 'codex-cli')).stopped, undefined);
    assert.deepEqual([(await itemOf(box))!.on, await deletedHere(box), await bytes(shared)], [true, [], undefined]);
  } finally { await box.cleanup(); }
});

test('A tool that has the skill both ways, its own copy beside the shared one: the shared one deleted, it still has its own, and nothing turns off', async () => {
  // Claude Code has Central Knot's copy (no link); Codex reads the shared copy and has one of its own, put there by hand.
  const { box, shared, toolFolders } = await sharedHome(false, ['claude-cli', 'codex-cli']);
  try {
    await put(box, 'codex-cli', { 'SKILL.md': skillText('In the shared folder.') });
    await pass(box);
    const both = await seen(box);
    assert.deepEqual([both.item!.throughShared, harnessIs(both.row, both.item, 'codex-cli')], [undefined, 'own-copy'], 'a tool with a copy of its own has it through no other folder only');
    await rm(shared, { recursive: true });
    const before = await toolFolders(), done = await pass(box), after = await seen(box);
    assert.deepEqual([after.item!.on, done.writes, done.notices ?? [], await toolFolders()], [true, 0, [], before]);
    // Its own copy holds the current version, so it is counted as the skill's there now.
    assert.deepEqual([harnessIs(after.row, after.item, 'codex-cli'), Object.keys(after.item!.applied).sort()], ['current', ['claude-cli', 'codex-cli']]);
  } finally { await box.cleanup(); }
});

// ---------- While the shared folder can't be vouched for, a reader's own copy is not read either ----------

/**
 * A home like the owner's: notes and other in ~/.agents/skills, which Copilot CLI, Codex, Pi and OpenCode read, and Claude Code's
 * entry for notes a link to the shared copy; other on (so the record names the shared folder), notes not yet; Synchronize
 * everything on unless `rule` is false. With `recorded` false, nothing is on and nothing recorded yet (so the rule is off).
 * `away` and `back` move the shared folder; `toolFolders`: every tool's folder byte for byte.
 */
async function outageHome(rule = true, recorded = true) {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']), root = join(box.home, '.agents/skills');
  for (const name of ['notes', 'other']) { await mkdir(join(root, name), { recursive: true }); await writeFile(join(root, name, 'SKILL.md'), skillText('In the shared folder.', name)); }
  await symlink('../../.agents/skills/notes', folderOf(box, 'claude-cli'));
  if (recorded) await turnOn(box, box.context, 'other');
  if (recorded) await saveRecord(box.home, { ...(await readRecord(box.home)).record!, syncEverything: rule });
  const aside = join(box.base, 'shared-away');
  const toolFolders = async () => Object.fromEntries(await Promise.all(Object.values(roots).map(async folder => [folder, await bytes(join(box.home, folder))] as const)));
  return { box, toolFolders, away: () => rename(root, aside), back: () => rename(aside, root) };
}
const twoPasses = async (box: Box) => [await pass(box), await pass(box)];
const waitsInCodex = 'Codex waits for the shared skills folder (…/.agents/skills) to be back: nothing is written there until then.';

test('A found skill with a copy in a tool that reads the shared folder waits while that folder can’t be vouched for: the rule takes nothing in, Add is refused with why, and the copy stays byte for byte; back, its copies differ again', async () => {
  const { box, toolFolders, away, back } = await outageHome();
  try {
    // notes found: Codex's own folder and the shared copy (Claude Code's link to it) differ, so it waits for a choice.
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.'), 'codex-only.md': 'Codex notes\n' });
    await twoPasses(box);
    assert.ok('wait' in (await seen(box)).fact!.takeInAnswers!.rule);
    const before = await toolFolders(), history = (await readHistory(box.context)).length;
    await away();
    const during = await twoPasses(box), { fact, item } = await seen(box);
    assert.deepEqual([await toolFolders(), item, (await readHistory(box.context)).length, during.map(done => done.writes)], [before, undefined, history, [0, 0]]);
    assert.deepEqual([fact!.takeInAnswers, fact!.unseen?.['codex-cli']], [{ click: { leave: 'held-back' }, rule: { leave: 'held-back' } }, waitsInCodex]);
    // With the rule off, a click on Add is refused with that reason, and writes nothing.
    await saveRecord(box.home, { ...(await readRecord(box.home)).record!, syncEverything: false });
    const add = await send(box, rowClicks.on((await seen(box)).row, undefined));
    assert.deepEqual([add.results.map(result => [result.outcome, result.message]), await toolFolders(), (await itemOf(box))], [[['held', `${waitsInCodex} It can be added once the folder is back.`]], before, undefined]);
    await back();
    await twoPasses(box);
    assert.deepEqual(['wait' in (await seen(box)).fact!.takeInAnswers!.click, await toolFolders()], [true, before]);
  } finally { await box.cleanup(); }
});

test('A skill in the library with a differing copy of its own in a tool that reads the shared folder: during an outage that copy is not written over, kept as a version or removed; back, it is held as before', async () => {
  const { box, toolFolders, away, back } = await outageHome();
  try {
    await twoPasses(box);
    assert.equal((await itemOf(box))?.on, true, 'the rule took notes in from the shared copy');
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.'), 'codex-only.md': 'Codex notes\n' });
    await twoPasses(box);
    const before = await toolFolders(), versions = (await itemOf(box))!.versions.length, held = (await seen(box)).fact!.anotherWay?.['codex-cli'];
    assert.ok(held, 'Codex has notes through the shared folder, beside its own copy');
    await away();
    await twoPasses(box);
    assert.deepEqual([await toolFolders(), (await itemOf(box))!.versions.length, (await itemOf(box))!.applied['codex-cli']], [before, versions, undefined]);
    await back();
    await twoPasses(box);
    assert.deepEqual([await toolFolders(), (await itemOf(box))!.versions.length, (await seen(box)).fact!.anotherWay?.['codex-cli'], (await itemOf(box))!.on], [before, versions, held, true]);
  } finally { await box.cleanup(); }
});

test('During an outage of the shared folder, a skill found only in Claude Code’s own folder (no link) is taken in as on any day; one found only in Codex’s own folder waits, with no shared copy ever (the price), and is taken in once the folder is back', async () => {
  const { box, toolFolders, away, back } = await outageHome();
  try {
    await away();
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Claude Code’s own.', 'claude-only') }, [], 'claude-only');
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.', 'codex-only') }, [], 'codex-only');
    const before = await toolFolders();
    await twoPasses(box);
    assert.deepEqual([(await itemOf(box, 'claude-only'))?.on, (await itemOf(box, 'codex-only'))?.on, (await toolFolders())['.codex/skills']], [true, undefined, before['.codex/skills']]);
    await back();
    await twoPasses(box);
    assert.equal((await itemOf(box, 'codex-only'))?.on, true);
  } finally { await box.cleanup(); }
});

test('Another folder put in the shared folder’s place, holding a skill of its own: while it can’t be vouched for, nothing in it is found, taken in or recorded, Synchronize everything on, so nothing is written; the real one back, all as before', async () => {
  const { box, toolFolders, away, back } = await outageHome();
  // As recorded, but OpenCode's through the shared folder: it reads Claude Code's folder too, and has it from there meanwhile.
  const root = join(box.home, '.agents/skills'), items = async () => [await itemOf(box), await itemOf(box, 'other')].map(item => ({ ...item!, throughShared: { ...item!.throughShared, 'opencode-cli': undefined } }));
  try {
    await twoPasses(box);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.'), 'codex-only.md': 'Codex notes\n' });
    await twoPasses(box);
    const before = await toolFolders(), had = await items();
    await away();
    await mkdir(join(root, 'stranger'), { recursive: true });
    await writeFile(join(root, 'stranger/SKILL.md'), skillText('Another folder’s.', 'stranger'));
    const during = await twoPasses(box), view = await skillsView(box.context, box.tools);
    assert.deepEqual([during.map(done => done.writes), view.items.some(row => row.key === 'stranger'), await itemOf(box, 'stranger'), await toolFolders(), await items()],
      [[0, 0], false, undefined, before, had]);
    assert.match(view.problems[0], /^The shared skills folder \(.*\) holds none of them, .* until they are back \(if you removed them, turn them off and remove any link to them\)\.$/);
    await rm(root, { recursive: true });
    await back();
    await twoPasses(box);
    assert.deepEqual([await toolFolders(), await items()], [before, had]);
  } finally { await box.cleanup(); }
});

test('A link into the shared folder that leads nowhere says that folder held the skill: with nothing recorded through it, an empty folder in its place can’t be vouched for, so Add on a skill with a copy of its own in Codex is refused and writes nothing; back, all as before', async () => {
  const { box, toolFolders, away, back } = await outageHome(false, false), root = join(box.home, '.agents/skills');
  try {
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.'), 'codex-only.md': 'Codex notes\n' });
    await twoPasses(box);
    const before = await toolFolders();
    await away();
    await mkdir(root);
    await twoPasses(box);
    const add = await send(box, rowClicks.on((await seen(box)).row, undefined)), view = await skillsView(box.context, box.tools);
    assert.deepEqual([add.results.map(result => [result.outcome, result.message]), await toolFolders(), await itemOf(box)], [[['held', `${waitsInCodex} It can be added once the folder is back.`]], before, undefined]);
    assert.match(view.problems[0], /holds none of them, so Central Knot changes nothing for the skills tools read there \(notes\) until/);
    await rm(root, { recursive: true });
    await back();
    await twoPasses(box);
    assert.deepEqual(['wait' in (await seen(box)).fact!.takeInAnswers!.click, await toolFolders()], [true, before]);
  } finally { await box.cleanup(); }
});

test('History’s Undo of an Add that took Codex’s own copy waits while the shared folder can’t be vouched for, as Add does: refused with why, nothing changed; back, the same Undo gives Codex its copy back', async () => {
  const { box, toolFolders, away, back } = await outageHome(false);
  const undoAdd = async () => (await historyActions(box, box.context, 'mine')).find(action => action.label === 'Undo')!.run();
  try {
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.', 'mine'), 'codex-only.md': 'Codex notes\n' }, [], 'mine');
    const codexOwn = await bytes(folderOf(box, 'codex-cli', 'mine'));
    await turnOn(box, box.context, 'mine');
    const before = await toolFolders(), told = (await readHistory(box.context)).map(entry => entry.undoneBy);
    await away();
    await twoPasses(box);
    const refused = await undoAdd();
    assert.deepEqual([refused.results.map(result => [result.outcome, result.message]), await toolFolders(), (await itemOf(box, 'mine'))?.on, (await readHistory(box.context)).map(entry => entry.undoneBy)],
      [[['held', `${waitsInCodex} It can be undone once the folder is back.`]], before, true, told]);
    await back();
    await twoPasses(box);
    await undoAdd();
    assert.deepEqual([await bytes(folderOf(box, 'codex-cli', 'mine')), !!(await itemOf(box, 'mine'))?.deleted], [codexOwn, true]);
  } finally { await box.cleanup(); }
});

test('A click while the shared folder can’t be vouched for says what it left: Off names each reader, which keeps its own copy or the shared one, and Delete Claude Code too, whose link leads there; each with why', async () => {
  const { box, away } = await outageHome(false);
  const waits = (done: PassResult, name: string) => done.results.filter(result => result.item === name && result.outcome === 'held').map(result => result.harness);
  // OpenCode, which reads Claude Code's folder too, has it from there meanwhile: not waiting.
  const readers = ['copilot-cli', 'codex-cli', 'pi-cli'];
  try {
    await turnOn(box);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.', 'other'), 'codex-only.md': 'Codex notes\n' }, [], 'other');
    await twoPasses(box);
    await away();
    await twoPasses(box);
    const off = await turnOff(box, box.context, 'other') as PassResult;
    assert.deepEqual([waits(off, 'other'), clickResults(off.results, ['other']).notIn, off.results.find(result => result.harness === 'codex-cli')?.message], [readers, readers, waitsInCodex]);
    const deleted = await remove(box) as PassResult;
    assert.deepEqual(waits(deleted, 'notes'), ['claude-cli', ...readers]);
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
    // Its own folder's copy (`in`: the tool whose folder holds it), which its own switch keeps out.
    assert.deepEqual(fact!.loads?.['codex-cli'], { ...target, switchedOff: true, in: 'codex-cli' });
    // The row as the page has it: the view's switchedOff (matrix.ts fromFacts copies it), said in Codex's own settings.
    const switchedOff = fact!.switchedOff;
    assert.deepEqual(switchedOff, ['codex-cli']);
    assert.match(say.harnessLine({ ...row, switchedOff }, item, 'codex-cli', 'Codex'), /It is switched off in Codex’s own settings: Codex doesn’t load it/);
    assert.deepEqual(say.placeTag({ ...row, switchedOff }, item, tools), { text: 'switched off in Codex', title: 'Switched off in Codex’s own settings: each tool’s own switch, which Central Knot leaves as it is. The opened row can clear it.' });
    // Never on and off at once: Codex is not counted as on, and the switch is drawn partial with what it says.
    assert.equal(statusLine({ ...row, switchedOff }, item, tools), 'On in Claude Code and Copilot CLI · switched off in Codex');
    assert.equal(isPartial(item, tools, { ...row, switchedOff }), true);
    assert.match(switchLabel({ ...row, switchedOff }, item, tools), /^notes: on in 2 of 3 tools\./);
    // Switched off in every tool: never plain on.
    for (const tool of ['claude-cli', 'copilot-cli'] as Tool[]) await setDisabled(box.context, tool, { ...target, skillFile: join(folderOf(box, tool), 'SKILL.md') }, true);
    const everyTool = (await seen(box)).fact!.switchedOff;
    assert.equal(say.placeTag({ ...row, switchedOff: everyTool }, item, tools)?.text, 'switched off in all 3 tools');
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
    await send(box, { key: 'agents', on: true, except: [], deleted: true });
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
    await chooseTools(context, 'codex-cli', false);
    box.tools.splice(0, box.tools.length, 'claude-cli', 'copilot-cli');
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Edited while left out.') });
    await rm(folderOf(box, 'copilot-cli'), { recursive: true });
    await pass(box);
    assert.equal((await itemOf(box))!.on, false, 'a folder deleted in a managed tool still turns it Off');
    await turnOn(box);
    await chooseTools(context, 'codex-cli', true);
    box.tools.splice(0, box.tools.length, ...tools);
    await pass(box);
    assert.equal(await readFile(join(folderOf(box, 'codex-cli'), 'SKILL.md'), 'utf8'), skillText(), 'the library wins in a tool managed again');
    assert.ok((await itemOf(box))!.versions.some(version => version.from.how === 'was-in' && version.from.harness === 'codex-cli'));
    assert.deepEqual((await historyOf(box)).filter(event => event.cause === 'tool-back').map(event => event.kind), ['kept-edit']);
  } finally { await box.cleanup(); }
});

test('A folder that can’t be written holds the write there, and the tool catches up once it can', { skip: lockSkip }, async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await withLock(join(box.home, roots['codex-cli']), 'dir-readonly', async () => {
      await turnOn(box);
      const { fact, item, row } = await seen(box);
      assert.equal(harnessIs(row, item, 'codex-cli'), 'cannot');
      assert.match(fact!.cannot['codex-cli'] ?? '', /can’t be written/);
    });
    await pass(box);
    assert.ok(await bytes(folderOf(box, 'codex-cli')));
  } finally { await box.cleanup(); }
});

test('Clicking Add, On, or a tool’s switch with a locked skills folder names that tool and says why, while background passes and History stay unchanged', { skip: lockSkip }, async t => {
  const lockedWhy = 'Codex’s skills folder can’t be written, so Central Knot can’t change the skill there. Once the folder’s permissions let it, Codex catches up when sync runs.';
  const withLockedCodex = async (run: (box: Box, codexRoot: string) => Promise<void>) => {
    const box = await sandbox(), codexRoot = join(box.home, roots['codex-cli']);
    try { await run(box, codexRoot); } finally { await box.cleanup(); }
  };
  await t.test('Add of a found skill read before Codex is locked names Claude Code and Copilot CLI, not Codex', () => withLockedCodex(async (box, codexRoot) => {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Fifth skill.', 'fifth') }, [], 'fifth');
    const before = await seen(box, box.context, 'fifth');
    await withLock(codexRoot, 'dir-readonly', async () => {
      const added = await send(box, rowClicks.on(before.row, before.item));
      const addRes = clickResults(added.results, ['fifth']);
      assert.deepEqual([addRes.notIn, addRes.failed], [['codex-cli'], true]);
      assert.deepEqual(addRes.ours.filter(entry => entry.harness === 'codex-cli'), [{ item: 'fifth', harness: 'codex-cli', outcome: 'held', message: lockedWhy }]);
      assert.equal(say.said.takenIn('fifth', tools.filter(tool => !addRes.notIn.includes(tool)), tools), 'fifth is in Central Knot now, and on in Claude Code and Copilot CLI.');
      assert.deepEqual([(await historyOf(box, box.context, 'fifth')).at(-1)!.losers.map(loser => loser.tool), await bytes(folderOf(box, 'codex-cli', 'fifth'))], [['copilot-cli'], undefined]);
      assert.deepEqual((await pass(box)).results, [], 'a background pass says nothing new');
    });
  }));
  await t.test('On for an Off skill names Claude Code and Copilot CLI and says not in Codex', () => withLockedCodex(async (box, codexRoot) => {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Fifth skill.', 'fifth') }, [], 'fifth');
    await turnOn(box, box.context, 'fifth');
    await turnOff(box, box.context, 'fifth');
    await withLock(codexRoot, 'dir-readonly', async () => {
      assert.equal((await seen(box, box.context, 'fifth')).fact!.cannot['codex-cli'], undefined);
      const turnedOn = await turnOn(box, box.context, 'fifth');
      assert.ok(turnedOn !== 'choose');
      const onRes = clickResults(turnedOn.results, ['fifth']);
      assert.deepEqual([onRes.notIn, onRes.failed], [['codex-cli'], true]);
      assert.equal(`fifth is on in ${toolsPhrase(tools.filter(tool => !onRes.notIn.includes(tool)), tools)}; not in ${toolsPhrase(onRes.notIn, tools)}.`, 'fifth is on in Claude Code and Copilot CLI; not in Codex.');
      assert.deepEqual((await historyOf(box, box.context, 'fifth')).at(-1)!.losers.map(loser => loser.tool), ['claude-cli', 'copilot-cli']);
      assert.deepEqual((await pass(box)).results, []);
    });
  }));
  await t.test('Codex’s switch from kept out to on says couldn’t be put in Codex, and catches up once writable', () => withLockedCodex(async (box, codexRoot) => {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Fifth skill.', 'fifth') }, [], 'fifth');
    await turnOn(box, box.context, 'fifth');
    const { row: onRow, item: onItem } = await seen(box, box.context, 'fifth');
    const out = await send(box, rowClicks.inHarness(onRow, onItem, 'codex-cli', true));
    assert.deepEqual(clickResults(out.results, ['fifth']).notIn, []);
    await withLock(codexRoot, 'dir-readonly', async () => {
      const { row: outRow, item: outItem } = await seen(box, box.context, 'fifth');
      const back = await send(box, rowClicks.inHarness(outRow, outItem, 'codex-cli', false));
      const backRes = clickResults(back.results, ['fifth']);
      assert.deepEqual([backRes.notIn, backRes.failed], [['codex-cli'], true]);
      assert.equal(say.said.inHarness('fifth', 'codex-cli', false, backRes.notIn.includes('codex-cli')), 'fifth couldn’t be put in Codex.');
      assert.deepEqual((await pass(box)).results, []);
    });
    const caught = await pass(box);
    assert.deepEqual([caught.writes, caught.results.filter(entry => entry.outcome === 'held'), !!(await bytes(folderOf(box, 'codex-cli', 'fifth')))], [1, [], true]);
    assert.deepEqual([(await pass(box)).writes, (await pass(box)).results], [0, []]);
  }));
  await t.test('Synchronize everything reports a locked folder once on take-in, not on later passes', () => withLockedCodex(async (box, codexRoot) => {
    await setSyncEverything(box.context, true);
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Sixth skill.', 'sixth') }, [], 'sixth');
    await withLock(codexRoot, 'dir-readonly', async () => {
      const firstRule = await pass(box);
      assert.deepEqual(firstRule.results.filter(entry => entry.outcome === 'held'), [{ item: 'sixth', harness: 'codex-cli', outcome: 'held', message: lockedWhy }]);
      assert.deepEqual((await pass(box)).results, [], 'not repeated on the next pass');
    });
  }));
});

test('On Windows a skills folder that takes a new copy but refuses a removal holds nothing back: the removal says it failed, and goes once it can', { skip: process.platform !== 'win32' && 'A folder that takes a new entry but refuses a removal is a Windows lock only.' }, async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    await withLock(join(box.home, roots['codex-cli']), 'dir-noremove', async () => {
      assert.equal((await seen(box)).fact!.cannot?.['codex-cli'], undefined);
      const off = await turnOff(box);
      assert.deepEqual(off.results.filter(entry => entry.harness === 'codex-cli'),
        [{ item: 'notes', harness: 'codex-cli', outcome: 'failed', removal: true, message: 'Could not remove Codex’s copy yet. Central Knot will try again.' }]);
      assert.ok(await bytes(folderOf(box, 'codex-cli')));
    });
    await pass(box);
    assert.equal(await bytes(folderOf(box, 'codex-cli')), undefined);
  } finally { await box.cleanup(); }
});

test('A click names a tool whose skills folder is a dangling link, and says why', async () => {
  const box = await sandbox();
  const codexRoot = join(box.home, roots['codex-cli']);
  try {
    await rm(codexRoot, { recursive: true, force: true });
    await symlink(join(box.base, 'nowhere'), codexRoot);
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Fifth skill.', 'fifth') }, [], 'fifth');
    const added = await turnOn(box, box.context, 'fifth');
    assert.ok(added !== 'choose');
    const addRes = clickResults(added.results, ['fifth']);
    assert.deepEqual([addRes.notIn, addRes.failed], [['codex-cli'], true]);
    assert.match(addRes.ours.find(entry => entry.harness === 'codex-cli')?.message ?? '', /^Codex’s skills folder is a link to /);
    await turnOff(box, box.context, 'fifth');
    const turnedOn = await turnOn(box, box.context, 'fifth');
    assert.ok(turnedOn !== 'choose');
    assert.deepEqual(clickResults(turnedOn.results, ['fifth']).notIn, ['codex-cli']);
    assert.deepEqual((await pass(box)).results, []);
  } finally { await box.cleanup(); }
});

test('A tool whose skills folder is linked to another tool’s locks both folders: Off to On writes only to the third tool and names both; a skill already in the shared folder is not named', async () => {
  const box = await sandbox();
  const copilotRoot = join(box.home, roots['copilot-cli']);
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Fifth skill.', 'fifth') }, [], 'fifth');
    await turnOn(box, box.context, 'fifth');
    await turnOff(box, box.context, 'fifth');
    await rm(copilotRoot, { recursive: true, force: true });
    await symlink('../.claude/skills', copilotRoot);
    // Neither Claude Code nor Copilot CLI is written (rootProblem locks both when their folders land on one directory).
    const turnedOn = await turnOn(box, box.context, 'fifth');
    assert.ok(turnedOn !== 'choose');
    const onRes = clickResults(turnedOn.results, ['fifth']);
    assert.deepEqual([onRes.notIn, onRes.failed], [['claude-cli', 'copilot-cli'], true]);
    assert.deepEqual([await bytes(folderOf(box, 'claude-cli', 'fifth')), await bytes(join(copilotRoot, 'fifth')), !!(await bytes(folderOf(box, 'codex-cli', 'fifth')))], [undefined, undefined, true]);
    // A skill already present in that shared folder is read by both tools another way, so Add writes Codex and names neither.
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Shared skill.', 'sixth') }, [], 'sixth');
    const added = await turnOn(box, box.context, 'sixth');
    assert.ok(added !== 'choose');
    const addRes = clickResults(added.results, ['sixth']);
    assert.deepEqual([addRes.notIn, addRes.failed, !!(await bytes(folderOf(box, 'codex-cli', 'sixth')))], [[], false, true]);
  } finally { await box.cleanup(); }
});

test('Only a tool held by its locked skills folder is named on a click, not one kept out, with a plugin, or reading another copy', { skip: lockSkip }, async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli', 'opencode-cli']);
  const claudeRoot = join(box.home, roots['claude-cli']), codexRoot = join(box.home, roots['codex-cli']), opencodeRoot = join(box.home, roots['opencode-cli']);
  try {
    const skill = skillText('Fifth skill.', 'fifth');
    // Claude Code has `fifth` through an installed plugin; Copilot CLI will be kept out; Codex's folder is locked.
    const pluginDir = join(box.home, '.claude/plugins/cache/team/kit/1.0.0');
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await mkdir(join(pluginDir, 'skills/fifth'), { recursive: true });
    await writeFile(join(pluginDir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit', version: '1.0.0' }));
    await writeFile(join(pluginDir, 'skills/fifth/SKILL.md'), skill);
    await mkdir(join(box.home, '.claude/plugins'), { recursive: true });
    await writeFile(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'kit@team': [{ scope: 'user', installPath: pluginDir, version: '1.0.0' }] } }));
    await put(box, 'copilot-cli', { 'SKILL.md': skill }, [], 'fifth');
    await turnOn(box, box.context, 'fifth');
    const { row: keptRow, item: keptItem } = await seen(box, box.context, 'fifth');
    await send(box, rowClicks.inHarness(keptRow, keptItem, 'copilot-cli', true));
    await turnOff(box, box.context, 'fifth');
    const unlockCodex = await lockPath(codexRoot, 'dir-readonly');
    try {
      const turnedOn = await turnOn(box, box.context, 'fifth');
      assert.ok(turnedOn !== 'choose');
      assert.deepEqual(clickResults(turnedOn.results, ['fifth']).notIn, ['codex-cli'], 'kept out and plugin tools are not named');
      assert.match(turnedOn.results.find(entry => entry.harness === 'codex-cli')?.message ?? '', /^Codex’s skills folder can’t be written/, 'held by the folder check, before any write');
      // Even if Claude Code's own folder is also locked, Claude Code is held by the plugin (Disk.held), not by the lock.
      await turnOff(box, box.context, 'fifth');
      await withLock(claudeRoot, 'dir-readonly', async () => {
        const bothLocked = await turnOn(box, box.context, 'fifth');
        assert.ok(bothLocked !== 'choose');
        assert.deepEqual(clickResults(bothLocked.results, ['fifth']).notIn, ['codex-cli']);
      });
    } finally { await unlockCodex(); }
    // OpenCode reads Claude Code's folder: keeping another skill out of Claude Code while OpenCode's folder is locked names OpenCode.
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Shared reader.', 'reader') }, [], 'reader');
    await turnOn(box, box.context, 'reader');
    await withLock(opencodeRoot, 'dir-readonly', async () => {
      const { row: readerRow, item: readerItem } = await seen(box, box.context, 'reader');
      const outOfClaude = await send(box, rowClicks.inHarness(readerRow, readerItem, 'claude-cli', true));
      assert.deepEqual(clickResults(outOfClaude.results, ['reader']).notIn, ['opencode-cli']);
    });
  } finally {
    await box.cleanup();
  }
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

/**
 * How many times each file is opened while `run` runs, by its real path: only hashing a file (share.ts hashFile's read stream)
 * opens one through callback `fs.open` (fs/promises does not), so a file's count is how many times it was hashed.
 */
async function countOpens<T>(run: () => Promise<T>): Promise<{ result: T; opens: Map<string, number> }> {
  const opens = new Map<string, number>(), original = fs.open;
  fs.open = ((path: fs.PathLike, ...rest: unknown[]) => {
    const key = typeof path === 'string' ? (() => { try { return realpathSync(path); } catch { return path; } })() : String(path);
    opens.set(key, (opens.get(key) ?? 0) + 1);
    return (original as (...args: unknown[]) => unknown).call(fs, path, ...rest);
  }) as typeof fs.open;
  try { return { result: await run(), opens }; }
  finally { fs.open = original; }
}

test('One read of the home hashes a shared skill’s files once across all tools and links that read it, never hashes stored versions for shapes, and reads afresh next time', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']);
  try {
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skillText('In the shared folder.'));
    await writeFile(join(shared, 'extra.txt'), 'first\n');
    await symlink('../../.agents/skills/notes', folderOf(box, 'claude-cli'));
    await symlink('../../.agents/skills/notes', folderOf(box, 'claude-cli', 'alias'));
    await turnOn(box);
    const stored = join(box.home, '.central-knot/items/skills/notes/versions', (await itemOf(box))!.hash);
    const first = await countOpens(() => readDisk(box.context, box.tools));
    const sharedSkill = realpathSync(join(shared, 'SKILL.md')), sharedExtra = realpathSync(join(shared, 'extra.txt'));
    const storedSkill = realpathSync(join(stored, 'SKILL.md')), storedExtra = realpathSync(join(stored, 'extra.txt'));
    assert.deepEqual([first.opens.get(sharedSkill), first.opens.get(sharedExtra)], [1, 1], 'shared skill files hashed once across 4 readers and 2 links');
    assert.deepEqual([first.opens.get(storedSkill) ?? 0, first.opens.get(storedExtra) ?? 0], [0, 0], 'stored version files not hashed for shapes');
    assert.equal(first.result.shapes.get('notes')?.description, 'Takes notes.');
    assert.equal(first.result.outside.get('alias')?.['claude-cli']?.name, 'alias');
    assert.equal(first.result.outside.get('notes')?.['codex-cli']?.hash, first.result.outside.get('alias')?.['claude-cli']?.hash);
    // An edit with the same timestamp is still seen on the next read: nothing is kept across reads.
    const beforeTime = at(15);
    await touch(shared, beforeTime);
    const before = await countOpens(() => readDisk(box.context, box.tools));
    await writeFile(join(shared, 'extra.txt'), 'edited\n');
    await touch(shared, beforeTime);
    const after = await countOpens(() => readDisk(box.context, box.tools));
    assert.equal(after.opens.get(sharedExtra), 1, 'next read hashes afresh');
    assert.notEqual(after.result.outside.get('notes')?.['codex-cli']?.hash, before.result.outside.get('notes')?.['codex-cli']?.hash);
  } finally { await box.cleanup(); }
});

/**
 * A skill in the shared folder that four tools read and Claude Code links to, On; and one found in Claude Code, to Add. Every
 * kind's record is settled by a pass of the whole home first, as the app's first view leaves it.
 */
async function addHome() {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']);
  const shared = join(box.home, '.agents/skills/notes');
  await mkdir(shared, { recursive: true });
  await writeFile(join(shared, 'SKILL.md'), skillText('In the shared folder.'));
  await writeFile(join(shared, 'extra.txt'), 'first\n');
  await symlink('../../.agents/skills/notes', folderOf(box, 'claude-cli'));
  await turnOn(box);
  await put(box, 'claude-cli', { 'SKILL.md': skillText('Draft it first.', 'draft') }, [], 'draft');
  await homePass({ ...box.context, reads: new Map() }, box.tools, true);
  return { box, untouchedFiles: [realpathSync(join(shared, 'SKILL.md')), realpathSync(join(shared, 'extra.txt'))] };
}
/**
 * A click, then what main.ts syncAndView does after it: the pass of the whole home, then the page's view, given that pass's reads
 * where every kind's pass left the home as it read it (homepass.ts HomePass untouched), as main.ts gives them.
 */
async function clickThenView(box: Box, change: Change) {
  await send(box, change);
  const kept = new Map(), passed = await homePass({ ...box.context, reads: new Map(), kept }, box.tools, true);
  const view = { ...box.context, reads: new Map(), kept: passed.untouched ? kept : undefined };
  return { passed, skills: await skillsView(view, box.tools), mcp: await serversView(view, box.tools), agents: await agentsView(view, box.tools) };
}

test('One Add, then the pass of the whole home and the view after it (main.ts syncAndView), hash a skill the click didn’t touch twice, not three times: the pass changes nothing, so the view is made from its read', async () => {
  const { box, untouchedFiles } = await addHome();
  try {
    const { row, item } = await seen(box, box.context, 'draft');
    const counted = await countOpens(() => clickThenView(box, rowClicks.on(row, item)));
    assert.deepEqual(untouchedFiles.map(file => counted.opens.get(file)), [2, 2], 'the click’s read and the pass’s');
    const { passed, skills, mcp, agents } = counted.result;
    assert.equal(passed.untouched, true);
    assert.equal(skills.items.find(fact => fact.key === 'draft')?.on, true, 'the view shows the Add');
    // What the page is given is the home as it is: the same as views read afresh now.
    assert.deepEqual([skills, mcp, agents], [await skillsView(box.context, box.tools), await serversView(box.context, box.tools), await agentsView(box.context, box.tools)]);
  } finally { await box.cleanup(); }
});

test('An Add while Synchronize everything takes in a skill found elsewhere: the pass of the whole home writes, so the view reads the home again and shows it taken in everywhere', async () => {
  const { box, untouchedFiles } = await addHome();
  try {
    await put(box, 'codex-cli', { 'SKILL.md': skillText('A spare.', 'spare') }, [], 'spare');
    assert.equal((await setSyncEverything(box.context, true)).stopped, undefined);
    const { row, item } = await seen(box, box.context, 'draft');
    const counted = await countOpens(() => clickThenView(box, rowClicks.on(row, item)));
    const { passed, skills } = counted.result;
    assert.deepEqual([passed.untouched, untouchedFiles.map(file => counted.opens.get(file))], [undefined, [3, 3]], 'the click’s read, the pass’s, and the view’s own');
    assert.equal(skills.items.find(fact => fact.key === 'spare')?.on, true, 'taken in by the pass');
    assert.deepEqual(skills, await skillsView(box.context, box.tools), 'the page is given the home as the pass’s writes left it');
  } finally { await box.cleanup(); }
});

test('skillVersionFile and skillFoundFile read regular files through one reader without hashing, enforce the 1 MB cap and text check, and refuse links, specials and outside paths', async t => {
  const box = await sandbox();
  try {
    const skillBody = skillText('Preserves config value: api_key=ck-raw-12345.');
    const checklist = '# Checklist\n\n- Keep values as-is.\n';
    const script = '#!/bin/sh\necho ok\n';
    const exactLimit = 'a'.repeat(1024 * 1024);
    const overLimit = 'b'.repeat(1024 * 1024 + 1);
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const files = {
      'SKILL.md': skillBody,
      'scripts/run.sh': { text: script, mode: 0o755 },
      'checklist.md': checklist,
      'empty.md': '',
      'exact.txt': exactLimit,
      'over.txt': overLimit,
    };
    await put(box, 'claude-cli', files);
    await writeFile(join(folderOf(box, 'claude-cli'), 'asset.bin'), binary);
    await turnOn(box);
    const hash = (await itemOf(box))!.hash;
    const stored = join(box.home, '.central-knot/items/skills/notes/versions', hash);
    // Found copy in Claude Code with identical files, plus an outside file for symlink targets.
    await put(box, 'claude-cli', files, [], 'draft');
    const foundDir = folderOf(box, 'claude-cli', 'draft');
    await writeFile(join(foundDir, 'asset.bin'), binary);
    const outside = join(box.home, '.central-knot/items/skills/notes/versions/outside.txt');
    const escaped = join(box.home, '.central-knot/items/skills/notes/escape.txt');
    const outsideSub = join(box.base, 'outside-sub');
    const fakeHex = '0'.repeat(64);
    await mkdir(outsideSub, { recursive: true });
    await writeFile(join(outsideSub, 'inside.md'), 'from-outside-dir\n');
    await writeFile(outside, 'secret\n');
    await writeFile(escaped, 'above-versions\n');
    await writeFile(join(box.home, '.central-knot/items/skills/notes/SKILL.md'), 'above-versions-skill\n');
    for (const dir of [stored, foundDir]) {
      await symlink('SKILL.md', join(dir, 'alias.md'));
      await symlink(outside, join(dir, 'out-link.md'));
      await symlink(outsideSub, join(dir, 'sub-link'));
    }
    await symlink(stored, join(box.home, '.central-knot/items/skills/notes/versions', fakeHex));

    const expectedFiles = ['SKILL.md', 'asset.bin', 'checklist.md', 'empty.md', 'exact.txt', 'over.txt', 'scripts/run.sh'];
    const readers: [string, string, (file: string) => ReturnType<typeof skillVersionFile>][] = [
      ['stored version', stored, file => skillVersionFile(box.context, 'notes', hash, file)],
      ['found copy', foundDir, file => skillFoundFile(box.context, 'draft', 'claude-cli', 'Claude Code skills', file)],
    ];
    for (const [label, dir, read] of readers) {
      await t.test(`${label}: reads regular files without hashing, enforces cap and NUL, refuses traversal, links and specials`, async st => {
        const listed = await countOpens(() => read('SKILL.md'));
        assert.deepEqual(listed.result, { files: expectedFiles, text: skillBody });
        assert.equal(listed.opens.size, 0, 'listing does not hash files');
        assert.deepEqual(await read('checklist.md'), { files: expectedFiles, text: checklist });
        assert.deepEqual(await read('empty.md'), { files: expectedFiles, text: '' });
        assert.deepEqual(await read('scripts/run.sh'), { files: expectedFiles, text: script });
        assert.deepEqual(await read('asset.bin'), { files: expectedFiles, note: 'Not a text file.' });
        assert.deepEqual(await read('exact.txt'), { files: expectedFiles, text: exactLimit });
        assert.deepEqual(await read('over.txt'), { files: expectedFiles, note: 'Over 1 MB, so not shown here.' });

        // Refused: paths outside the folder, non-canonical paths, case mismatches, directories, missing names, and inward/outward/dir symlinks.
        for (const bad of ['../outside.txt', '/etc/passwd', './SKILL.md', 'scripts/../SKILL.md', 'skill.md', 'CHECKLIST.MD', 'scripts', 'missing.md', '', 'alias.md', 'out-link.md', 'sub-link/inside.md']) {
          assert.equal(await read(bad), undefined, `refuses ${JSON.stringify(bad)}`);
        }
        await st.test('refuses a special file (FIFO) without hanging and omits it from files', { skip: posixModeSkip }, async () => {
          const fifo = join(dir, 'pipe');
          assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
          assert.equal(await read('pipe'), undefined);
          assert.deepEqual((await read('SKILL.md'))?.files, expectedFiles);
        });
      });
    }

    assert.equal(await skillVersionFile(box.context, 'missing-skill', hash, 'SKILL.md'), undefined);
    // Refused: version ids not in the store's 64-char lowercase hex form (.., path traversal, wrong case/length) or symlinked version folders.
    for (const badHash of ['..', `../versions/${hash}`, hash.toUpperCase(), hash.slice(0, 63), 'deadbeef', fakeHex]) {
      assert.equal(await skillVersionFile(box.context, 'notes', badHash, badHash === '..' ? 'escape.txt' : 'SKILL.md'), undefined, `skillVersionFile refuses hash ${JSON.stringify(badHash)}`);
      assert.equal(await skillVersion(box.context, 'notes', badHash), undefined, `skillVersion refuses hash ${JSON.stringify(badHash)}`);
    }
  } finally { await box.cleanup(); }
});

test('skillFoundFile resolves shared folders, symlinked skill folders and multiple roots per tool in main, and refuses invalid identities', async () => {
  const box = await sandbox();
  try {
    // Copy in shared .agents/skills (read by Copilot CLI and Codex).
    const sharedDir = join(box.home, '.agents/skills/shared-one');
    await mkdir(join(sharedDir, 'ref'), { recursive: true });
    const sharedSkill = skillText('Shared copy.', 'shared-one');
    await writeFile(join(sharedDir, 'SKILL.md'), sharedSkill);
    await writeFile(join(sharedDir, 'ref/note.md'), 'Shared nested note.\n');
    assert.deepEqual(await skillFoundFile(box.context, 'shared-one', 'copilot-cli', 'Shared .agents skills', 'SKILL.md'), { files: ['SKILL.md', 'ref/note.md'], text: sharedSkill });
    assert.deepEqual(await skillFoundFile(box.context, 'shared-one', 'codex-cli', undefined, 'ref/note.md'), { files: ['SKILL.md', 'ref/note.md'], text: 'Shared nested note.\n' });
    assert.equal(await skillFoundFile(box.context, 'shared-one', 'claude-cli', undefined, 'SKILL.md'), undefined, 'Claude Code does not read .agents/skills');

    // Symlink in a tool's skills folder: read through its real folder, while a symlink below it is still refused.
    const realTarget = join(box.base, 'linked-target');
    await mkdir(join(realTarget, 'sub'), { recursive: true });
    const linkedSkill = skillText('Linked copy.', 'linked-one');
    await writeFile(join(realTarget, 'SKILL.md'), linkedSkill);
    await writeFile(join(realTarget, 'sub/detail.md'), 'Inside linked folder.\n');
    await symlink('SKILL.md', join(realTarget, 'inner-link.md'));
    await symlink(realTarget, folderOf(box, 'claude-cli', 'linked-one'));
    assert.deepEqual(await skillFoundFile(box.context, 'linked-one', 'claude-cli', 'Claude Code skills', 'SKILL.md'), { files: ['SKILL.md', 'sub/detail.md'], text: linkedSkill });
    assert.deepEqual(await skillFoundFile(box.context, 'linked-one', 'claude-cli', 'Claude Code skills', 'sub/detail.md'), { files: ['SKILL.md', 'sub/detail.md'], text: 'Inside linked folder.\n' });
    assert.equal(await skillFoundFile(box.context, 'linked-one', 'claude-cli', 'Claude Code skills', 'inner-link.md'), undefined);
    // Remove the inner link so readDisk accepts the linked skill into disk.outside for the skillsView check below.
    await rm(join(realTarget, 'inner-link.md'));

    // Two roots in one tool (Copilot skills + Shared .agents skills), distinguished by rootLabel.
    const dualOwn = skillText('Copilot own copy.', 'dual');
    const dualShared = skillText('Shared copy of dual.', 'dual');
    await put(box, 'copilot-cli', { 'SKILL.md': dualOwn }, [], 'dual');
    const dualSharedDir = join(box.home, '.agents/skills/dual');
    await mkdir(dualSharedDir, { recursive: true });
    await writeFile(join(dualSharedDir, 'SKILL.md'), dualShared);
    assert.deepEqual(await skillFoundFile(box.context, 'dual', 'copilot-cli', 'Copilot skills', 'SKILL.md'), { files: ['SKILL.md'], text: dualOwn });
    assert.deepEqual(await skillFoundFile(box.context, 'dual', 'copilot-cli', 'Shared .agents skills', 'SKILL.md'), { files: ['SKILL.md'], text: dualShared });

    // Refused: unknown rootLabel, reserved folder name, dot-folder in Codex, traversal keys, folder without SKILL.md, symlinked SKILL.md.
    await mkdir(folderOf(box, 'claude-cli', 'synced'), { recursive: true });
    await writeFile(join(folderOf(box, 'claude-cli', 'synced'), 'SKILL.md'), skillText('Reserved.', 'synced'));
    await mkdir(folderOf(box, 'codex-cli', '.system'), { recursive: true });
    await writeFile(join(folderOf(box, 'codex-cli', '.system'), 'SKILL.md'), skillText('Hidden.', '.system'));
    await mkdir(folderOf(box, 'claude-cli', 'no-skill'), { recursive: true });
    await writeFile(join(folderOf(box, 'claude-cli', 'no-skill'), 'readme.md'), 'not a skill\n');
    await mkdir(folderOf(box, 'claude-cli', 'sym-skill'), { recursive: true });
    await symlink(join(realTarget, 'SKILL.md'), join(folderOf(box, 'claude-cli', 'sym-skill'), 'SKILL.md'));
    assert.equal(await skillFoundFile(box.context, 'dual', 'copilot-cli', 'Unknown root', 'SKILL.md'), undefined);
    assert.equal(await skillFoundFile(box.context, 'synced', 'claude-cli', 'Claude Code skills', 'SKILL.md'), undefined);
    assert.equal(await skillFoundFile(box.context, '.system', 'codex-cli', 'Codex skills', 'SKILL.md'), undefined);
    assert.equal(await skillFoundFile(box.context, '..', 'claude-cli', 'Claude Code skills', 'SKILL.md'), undefined);
    assert.equal(await skillFoundFile(box.context, 'no-skill', 'claude-cli', 'Claude Code skills', 'readme.md'), undefined);
    assert.equal(await skillFoundFile(box.context, 'sym-skill', 'claude-cli', 'Claude Code skills', 'SKILL.md'), undefined);

    // skillsView provides folderHashes for both own-folder and outside (shared and linked) found copies.
    const view = await skillsView(box.context, tools);
    const dualFact = view.items.find(item => item.key === 'dual')!;
    const sharedFact = view.items.find(item => item.key === 'shared-one')!;
    const linkedFact = view.items.find(item => item.key === 'linked-one')!;
    assert.ok(dualFact.folderHashes?.[realpathSync(folderOf(box, 'copilot-cli', 'dual'))]);
    assert.ok(dualFact.folderHashes?.[realpathSync(dualSharedDir)]);
    assert.notEqual(dualFact.folderHashes?.[realpathSync(folderOf(box, 'copilot-cli', 'dual'))], dualFact.folderHashes?.[realpathSync(dualSharedDir)]);
    assert.ok(sharedFact.folderHashes?.[realpathSync(sharedDir)]);
    assert.ok(linkedFact.folderHashes?.[realpathSync(realTarget)]);
  } finally { await box.cleanup(); }
});

test('skillPluginFile reads installed (on and off), root-skill, symlinked-root and marketplace plugin skills through readSkillFile, and refuses paths leaving the plugin root', async t => {
  const box = await sandbox();
  try {
    const skillBody = skillText('Plugin skill value: api_key=ck-plugin-raw-99.', 'triage');
    const nestedBody = '# Rubric\n\n- Check severity.\n';
    const exactLimit = 'a'.repeat(1024 * 1024);
    const overLimit = 'b'.repeat(1024 * 1024 + 1);
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const write = async (path: string, content: string | Buffer) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); };

    // Installed plugin in Claude Code (off in settings.json: still readable), with nested file, binary, cap and inner symlinks.
    const claudePlugin = join(box.home, '.claude/plugins/cache/team/issue-tracker/2.0.0');
    const claudeSkill = join(claudePlugin, 'skills/triage');
    await write(join(claudeSkill, 'SKILL.md'), skillBody);
    await write(join(claudeSkill, 'notes/rubric.md'), nestedBody);
    await write(join(claudeSkill, 'asset.bin'), binary);
    await write(join(claudeSkill, 'exact.txt'), exactLimit);
    await write(join(claudeSkill, 'over.txt'), overLimit);
    const outsideFile = join(box.base, 'outside-secret.txt');
    const outsideSkill = join(box.base, 'outside-skill');
    await write(outsideFile, 'outside\n');
    await write(join(outsideSkill, 'SKILL.md'), skillText('Outside plugin.', 'escaped'));
    await symlink('SKILL.md', join(claudeSkill, 'alias.md'));
    await symlink(outsideFile, join(claudeSkill, 'out-link.md'));
    await symlink(outsideSkill, join(claudeSkill, 'sub-link'));
    // A skill folder inside the plugin that is a symlink out of the plugin root must be refused.
    await symlink(outsideSkill, join(claudePlugin, 'skills/escape-link'));
    // A SKILL.md folder inside the plugin that the plugin does not list must also be refused.
    await write(join(claudePlugin, 'unlisted/SKILL.md'), skillText('Unlisted inside plugin.', 'unlisted'));
    // A manifest listing a skill outside the plugin root must be refused.
    await write(join(claudePlugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'issue-tracker', version: '2.0.0', skills: ['../outside-skill'] }));
    await write(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'issue-tracker@team': [{ scope: 'user', installPath: claudePlugin, version: '2.0.0' }],
        'solo@team': [{ scope: 'user', installPath: join(box.home, '.claude/plugins/cache/team/solo/1.0.0'), version: '1.0.0' }],
        'linked-root@team': [{ scope: 'user', installPath: join(box.home, '.claude/plugins/cache/team/linked-root/1.0.0'), version: '1.0.0' }],
      },
    }));
    await write(join(box.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'issue-tracker@team': false } }));

    // Root-skill plugin (SKILL.md at plugin root, part '.').
    const soloPlugin = join(box.home, '.claude/plugins/cache/team/solo/1.0.0');
    const soloBody = skillText('Root skill body.', 'solo');
    await write(join(soloPlugin, 'SKILL.md'), soloBody);
    await write(join(soloPlugin, 'guide.md'), 'Root guide.\n');

    // Plugin root that is itself a symlink out of the cache: installedContents follows it, so skillPluginFile reads it as the folder it leads to (still refusing inner links and paths leaving that folder).
    const externalPlugin = join(box.base, 'external-plugin');
    const extBody = skillText('From symlinked plugin root.', 'ext-skill');
    await write(join(externalPlugin, 'skills/ext-skill/SKILL.md'), extBody);
    await write(join(externalPlugin, 'skills/ext-skill/detail.md'), 'External detail.\n');
    await symlink(outsideFile, join(externalPlugin, 'skills/ext-skill/inner-link.md'));
    await mkdir(join(box.home, '.claude/plugins/cache/team/linked-root'), { recursive: true });
    await symlink(externalPlugin, join(box.home, '.claude/plugins/cache/team/linked-root/1.0.0'));

    // Marketplace copy (not installed in any tool), including a plugin whose manifest tries to list a sibling plugin's skill outside its own root,
    // an escaped symlinked plugin folder, and a codexOnly marketplace plugin using Codex's ./ skills rule.
    const marketRoot = join(box.base, 'market');
    const marketPlugin = join(marketRoot, 'plugins/docs');
    const siblingPlugin = join(marketRoot, 'plugins/other');
    const marketBody = skillText('From marketplace copy.', 'pdf-reader');
    await write(join(marketPlugin, 'skills/pdf-reader/SKILL.md'), marketBody);
    await write(join(marketPlugin, 'skills/pdf-reader/notes/tables.md'), 'Table rules.\n');
    await write(join(marketPlugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'docs', version: '1.0.0', skills: ['../other/skills/sneaky'] }));
    await write(join(siblingPlugin, 'skills/sneaky/SKILL.md'), skillText('Sibling plugin.', 'sneaky'));
    const escapedMarketPlugin = join(marketRoot, 'plugins/escaped');
    await symlink(outsideSkill, escapedMarketPlugin);
    const codexSkillBody = skillText('From Codex plugin rule.', 'nested');
    const codexMarketPlugin = join(marketRoot, 'plugins/codex-market-plug');
    await write(join(codexMarketPlugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'codex-market-plug', version: '1.0.0', skills: ['./custom', 'no-dot'] }));
    await write(join(codexMarketPlugin, 'custom/deep/nested/SKILL.md'), codexSkillBody);
    await write(join(codexMarketPlugin, 'skills/ignored/SKILL.md'), skillText('Default skills/ ignored by Codex list.', 'ignored'));
    await write(join(codexMarketPlugin, 'no-dot/bad/SKILL.md'), skillText('Non-dot path ignored by Codex.', 'bad'));
    // Installed Codex plugin using .codex-plugin/plugin.json with ./ skills list replacing skills/ and nested skill walk.
    const codexPlugin = join(box.home, '.codex/plugins/cache/team/codex-plug/1.0.0');
    await write(join(codexPlugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'codex-plug', version: '1.0.0', skills: ['./custom', 'no-dot'] }));
    await write(join(codexPlugin, 'custom/deep/nested/SKILL.md'), codexSkillBody);
    await write(join(codexPlugin, 'custom/deep/nested/guide.md'), 'Nested Codex guide.\n');
    await write(join(codexPlugin, 'skills/ignored/SKILL.md'), skillText('Default skills/ ignored by Codex list.', 'ignored'));
    await write(join(codexPlugin, 'no-dot/bad/SKILL.md'), skillText('Non-dot path ignored by Codex.', 'bad'));
    await write(join(box.home, '.codex/config.toml'), '[plugins."codex-plug@team"]\nenabled = true\n');
    const marketLookup = async (marketName: string, plugin: string) => (marketName !== 'team' ? undefined
      : plugin === 'docs' ? { folder: marketPlugin, root: marketRoot, entry: {}, atMarketplaceRoot: false }
      : plugin === 'escaped' ? { folder: escapedMarketPlugin, root: marketRoot, entry: {}, atMarketplaceRoot: false }
      : plugin === 'codex-market-plug' ? { folder: codexMarketPlugin, root: marketRoot, entry: {}, atMarketplaceRoot: false, codexOnly: true }
      : undefined);

    const pluginCtx = { home: box.home, dataDir: '', binaries: {} };
    const countPromiseOpens = async <T>(run: () => Promise<T>) => {
      const opened: string[] = [];
      const orig = fs.promises.open;
      fs.promises.open = ((path: fs.PathLike, ...rest: unknown[]) => {
        if (typeof path === 'string') {
          try {
            opened.push(realpathSync(path));
          } catch {
            opened.push(path);
          }
        }
        return (orig as (...args: unknown[]) => unknown).call(fs.promises, path, ...rest);
      }) as typeof fs.promises.open;
      syncBuiltinESMExports();
      try {
        return { result: await run(), opened };
      } finally {
        fs.promises.open = orig;
        syncBuiltinESMExports();
      }
    };

    const expectedFiles = ['SKILL.md', 'asset.bin', 'exact.txt', 'notes/rubric.md', 'over.txt'];
    const readInstalled = (file: string) => skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'issue-tracker', part: 'skills/triage', from: 'claude-cli' }, file);
    const listed = await countOpens(() => readInstalled('SKILL.md'));
    assert.deepEqual(listed.result, { files: expectedFiles, text: skillBody, directory: claudeSkill });
    assert.equal(listed.opens.size, 0, 'listing does not hash files');
    assert.deepEqual(await readInstalled('notes/rubric.md'), { files: expectedFiles, text: nestedBody, directory: claudeSkill });
    assert.deepEqual(await readInstalled('asset.bin'), { files: expectedFiles, note: 'Not a text file.', directory: claudeSkill });
    assert.deepEqual(await readInstalled('exact.txt'), { files: expectedFiles, text: exactLimit, directory: claudeSkill });
    assert.deepEqual(await readInstalled('over.txt'), { files: expectedFiles, note: 'Over 1 MB, so not shown here.', directory: claudeSkill });
    for (const bad of ['../outside-secret.txt', '/etc/passwd', './SKILL.md', 'alias.md', 'out-link.md', 'sub-link/SKILL.md', 'missing.md']) {
      assert.equal(await readInstalled(bad), undefined, `refuses file ${JSON.stringify(bad)}`);
    }
    await t.test('refuses a special file (FIFO) inside a plugin skill without hanging', { skip: posixModeSkip }, async () => {
      const fifo = join(claudeSkill, 'pipe');
      assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
      assert.equal(await readInstalled('pipe'), undefined);
      assert.deepEqual((await readInstalled('SKILL.md'))?.files, expectedFiles);
    });

    // Root-skill plugin (part '.').
    assert.deepEqual(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'solo', part: '.', from: 'claude-cli' }, 'SKILL.md'),
      { files: ['SKILL.md', 'guide.md'], text: soloBody, directory: soloPlugin });
    assert.deepEqual(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'solo', part: '.', from: 'claude-cli' }, 'guide.md'),
      { files: ['SKILL.md', 'guide.md'], text: 'Root guide.\n', directory: soloPlugin });

    // Symlinked installed plugin root: read through its real folder, inner links still refused.
    const linkedDir = join(box.home, '.claude/plugins/cache/team/linked-root/1.0.0/skills/ext-skill');
    assert.deepEqual(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'linked-root', part: 'skills/ext-skill', from: 'claude-cli' }, 'SKILL.md'),
      { files: ['SKILL.md', 'detail.md'], text: extBody, directory: linkedDir });
    assert.equal(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'linked-root', part: 'skills/ext-skill', from: 'claude-cli' }, 'inner-link.md'), undefined);

    // Marketplace copy (not installed): reads SKILL.md and nested file, never opens a sibling plugin's SKILL.md while listing, and checks inside(root, folder) before listing.
    const marketRead = await countPromiseOpens(() => skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'docs', part: 'skills/pdf-reader', from: 'marketplace' }, 'SKILL.md', marketLookup));
    assert.deepEqual(marketRead.result, { files: ['SKILL.md', 'notes/tables.md'], text: marketBody, directory: join(marketPlugin, 'skills/pdf-reader') });
    assert.deepEqual(marketRead.opened.map(slashPath).filter(path => path.includes('/plugins/other/')), [], 'listing never opens sibling plugin SKILL.md');
    assert.deepEqual(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'docs', part: 'skills/pdf-reader', from: 'marketplace' }, 'notes/tables.md', marketLookup),
      { files: ['SKILL.md', 'notes/tables.md'], text: 'Table rules.\n', directory: join(marketPlugin, 'skills/pdf-reader') });
    const siblingRead = await countPromiseOpens(() => skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'docs', part: '../other/skills/sneaky', from: 'marketplace' }, 'SKILL.md', marketLookup));
    assert.equal(siblingRead.result, undefined);
    assert.deepEqual(siblingRead.opened.map(slashPath).filter(path => path.includes('/plugins/other/')), [], 'refused sibling part never opens sibling SKILL.md');
    const escapedRead = await countPromiseOpens(() => skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'escaped', part: '.', from: 'marketplace' }, 'SKILL.md', marketLookup));
    assert.equal(escapedRead.result, undefined, 'marketplace plugin folder escaping marketplace root is refused');
    assert.deepEqual(escapedRead.opened.map(slashPath).filter(path => path.includes('/outside-skill/')), [], 'escaped marketplace plugin folder is refused before listing');

    // Codex's rule: .codex-plugin/plugin.json with ./ skills list replacing skills/ and nested skill walk, both installed and in a codexOnly marketplace.
    assert.deepEqual(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'codex-plug', part: 'custom/deep/nested', from: 'codex-cli' }, 'SKILL.md'),
      { files: ['SKILL.md', 'guide.md'], text: codexSkillBody, directory: join(codexPlugin, 'custom/deep/nested') });
    assert.deepEqual(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'codex-plug', part: 'custom/deep/nested', from: 'codex-cli' }, 'guide.md'),
      { files: ['SKILL.md', 'guide.md'], text: 'Nested Codex guide.\n', directory: join(codexPlugin, 'custom/deep/nested') });
    assert.equal(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'codex-plug', part: 'skills/ignored', from: 'codex-cli' }, 'SKILL.md'), undefined);
    assert.equal(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'codex-plug', part: 'no-dot/bad', from: 'codex-cli' }, 'SKILL.md'), undefined);
    assert.deepEqual(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'codex-market-plug', part: 'custom/deep/nested', from: 'marketplace' }, 'SKILL.md', marketLookup),
      { files: ['SKILL.md'], text: codexSkillBody, directory: join(codexMarketPlugin, 'custom/deep/nested') });
    assert.equal(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'codex-market-plug', part: 'skills/ignored', from: 'marketplace' }, 'SKILL.md', marketLookup), undefined);

    // Refused: part paths leaving the plugin root (traversal, absolute, symlinked skill folder escaping root), unlisted folders, unknown plugin/tool, gone root.
    for (const badPart of ['../outside-skill', '/etc', 'skills/escape-link', 'skills/../../outside-skill', 'unlisted', 'skills/missing', '']) {
      assert.equal(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'issue-tracker', part: badPart, from: 'claude-cli' }, 'SKILL.md'), undefined, `refuses part ${JSON.stringify(badPart)}`);
    }
    assert.equal(await skillPluginFile(pluginCtx, { marketName: 'team', plugin: 'issue-tracker', part: 'skills/triage', from: 'pi-cli' }, 'SKILL.md'), undefined);
    await rm(claudePlugin, { recursive: true, force: true });
    assert.equal(await readInstalled('SKILL.md'), undefined, 'gone plugin root returns undefined');
  } finally { await box.cleanup(); }
});

test('Pi holds a link to a version the Library already knows while ~/.agents/skills holds a different unversioned skill: Take over keeps the removed shared bytes as a version', async () => {
  const box = await sandbox(['claude-cli', 'pi-cli']);
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Known version.') });
    await turnOn(box);
    const elsewhere = join(box.home, 'known-copy/notes');
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, 'SKILL.md'), skillText('Known version.'));
    await rm(folderOf(box, 'pi-cli'), { recursive: true, force: true });
    await symlink(elsewhere, folderOf(box, 'pi-cli'));
    const shared = join(box.home, '.agents/skills/notes');
    const unversioned = skillText('Unversioned shared bytes.');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), unversioned);
    const done = await takeOver(box.context, ['claude-cli', 'pi-cli'], 'notes', 'pi-cli');
    assert.equal(done.stopped, undefined);
    assert.equal(await bytes(shared), undefined, 'the shared folder was removed');
    assert.match(done.results[0]?.message ?? '', /It is kept as a version\./);
    const item = (await itemOf(box))!;
    const kept = (await Promise.all(item.versions.map(async v => ({ hash: v.hash, skill: (await skillVersion(box.context, 'notes', v.hash))?.skill }))))
      .find(v => v.skill === unversioned);
    assert.ok(kept, 'the removed shared folder bytes are preserved as a version');
    const history = await readHistory(box.context);
    assert.equal(history.find(e => e.kind === 'took-over')?.losers?.[0]?.hash, kept.hash, 'history loser hash matches the removed shared bytes');
  } finally { await box.cleanup(); }
});

test('Library lists an earlier version whose stored bytes are missing while ~/.agents/skills holds its last copy and Pi links elsewhere: Take over restores the missing bytes without listing the version twice', async () => {
  const box = await sandbox(['claude-cli', 'pi-cli']);
  try {
    const versionA = skillText('Earlier version A.');
    await put(box, 'claude-cli', { 'SKILL.md': versionA });
    await turnOn(box);
    const hashA = (await itemOf(box))!.hash;
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Current version B.') });
    await applySkills(box.context, ['claude-cli', 'pi-cli'], []);
    await rm(join(box.home, '.central-knot/items/skills/notes/versions', hashA), { recursive: true, force: true });
    assert.equal(await skillVersion(box.context, 'notes', hashA), undefined, 'version A bytes are missing from the store before takeover');
    const elsewhere = join(box.home, 'other-copy/notes');
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, 'SKILL.md'), skillText('Current version B.'));
    await rm(folderOf(box, 'pi-cli'), { recursive: true, force: true });
    await symlink(elsewhere, folderOf(box, 'pi-cli'));
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), versionA);
    const done = await takeOver(box.context, ['claude-cli', 'pi-cli'], 'notes', 'pi-cli');
    assert.equal(done.stopped, undefined);
    assert.equal(await bytes(shared), undefined, 'the shared folder was removed');
    assert.equal((await skillVersion(box.context, 'notes', hashA))?.skill, versionA, 'the store holds version A’s bytes again after takeover');
    const after = (await itemOf(box))!;
    assert.equal(after.versions.filter(v => v.hash === hashA).length, 1, 'already-listed version A is not listed twice');
  } finally { await box.cleanup(); }
});

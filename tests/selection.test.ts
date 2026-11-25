// Select on the Library (src/selection.ts) as worked examples: the mode and its ticks, a Shift-click's run and a heading's tick,
// what a Delete of many takes and leaves, its question (closed when what it counted changes) and its words. Then a Delete of many
// on real folders, sent as app.ts applyByKind sends a kind's click (one send of every row's own Delete, libraryrow.ts
// rowClicks.remove), set against ten single Deletes on a copy of the home, and its Undo (each History entry's action, newest
// first, as app.ts undoClick runs them) against ten single Undos (tests/skillclicks.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask, askedNow, cancelAsk, cantWords, deletedWords, headingState, isTicked, ofListed, questionWords, restoreWords, selectedWords, selecting,
  startSelecting, stopSelecting, tickHeading, tickRow, turnedWords, turnLabel, whyLines, type Listed } from '../src/selection.ts';
import { readHistory } from '../src/history.ts';
import { inLibrary, placeOf, rowClicks } from '../src/libraryrow.ts';
import { heldWhole } from '../src/clickplan.ts';
import { applySkills, restoreSkill } from '../src/skills.ts';
import { lockAppSkip, lockSkip, withLock } from './fslock.ts';
import { bytes, folderOf, historyActions, itemOf, pass, put, roots, sandbox, seen, skillText, tools, turnOff, turnOn, type Box } from './skillclicks.ts';

/** Rows as the Library lists them, by name: a skill each (`skills-<name>`), none that can't be deleted. */
const listed = (...names: string[]): Listed[] => names.map(name => ({ id: `skills-${name}`, name }));
const ids = (rows: Listed[]) => rows.map(row => row.id);
const tickedOf = (rows: Listed[]) => ofListed(rows).ticked.map(row => row.name);

// Another page and another home end the mode where they change (app.ts showPage, accept): on screen, scripts/e2e.mjs selectFlow.
test('Select starts with nothing ticked; Done ends it and its ticks go, and Select again starts with none', () => {
  startSelecting();
  tickRow('skills-notes', ['skills-notes'], false);
  assert.deepEqual([selecting(), isTicked('skills-notes')], [true, true]);
  stopSelecting();
  assert.deepEqual([selecting(), isTicked('skills-notes')], [false, false]);
  startSelecting();
  assert.deepEqual([selecting(), isTicked('skills-notes')], [true, false]);
  stopSelecting();
});

test('A click ticks a row and a second unticks it; Shift ticks the run from the last row clicked to this one, in the order on screen, across a heading', () => {
  // On: alpha, bravo; Off: charlie (a server), delta.
  const rows: Listed[] = [...listed('alpha', 'bravo'), { id: 'mcp-charlie', name: 'charlie' }, ...listed('delta')], order = ids(rows);
  startSelecting();
  tickRow('skills-bravo', order, false);
  tickRow('skills-delta', order, true);
  assert.deepEqual(tickedOf(rows), ['bravo', 'charlie', 'delta']);
  tickRow('skills-alpha', order, true);
  assert.deepEqual(tickedOf(rows), ['alpha', 'bravo', 'charlie', 'delta'], 'upwards from delta, the last clicked');
  tickRow('mcp-charlie', order, false);
  assert.deepEqual(tickedOf(rows), ['alpha', 'bravo', 'delta'], 'a plain click unticks');
  // The last row clicked no longer listed (Find hid it): a Shift-click is a click.
  tickRow('skills-alpha', ids(listed('alpha', 'delta')), true);
  assert.deepEqual(tickedOf(rows), ['bravo', 'delta']);
  stopSelecting();
});

test('A heading’s tick: unticked, it ticks every row under it; with some ticked it reads mixed and ticks them all; with all ticked it unticks them', () => {
  const under = ['skills-alpha', 'skills-bravo', 'skills-charlie'];
  startSelecting();
  assert.equal(headingState(under), 'false');
  tickHeading(under);
  assert.deepEqual([headingState(under), under.every(isTicked)], ['true', true]);
  tickRow('skills-bravo', under, false);
  assert.equal(headingState(under), 'mixed');
  tickHeading(under);
  assert.equal(headingState(under), 'true');
  tickHeading(under);
  assert.deepEqual([headingState(under), under.some(isTicked)], ['false', false]);
  stopSelecting();
});

test('Only the rows listed count: a tick Find hides stays and comes back with its row, and a Delete of many takes the listed rows it can delete and leaves the others with why', () => {
  const rows: Listed[] = [...listed('alpha', 'bravo'), { id: 'skills-clash', name: 'clash', cant: 'not in Central Knot' }, { id: 'skills-zulu', name: 'zulu', cant: 'Only through a plugin' }];
  startSelecting();
  tickHeading(ids(rows));
  const found = rows.filter(row => row.name !== 'bravo');
  assert.deepEqual([tickedOf(found), ofListed(found).takes.map(row => row.name)], [['alpha', 'clash', 'zulu'], ['alpha']], 'Find hides bravo: it is neither counted nor taken');
  assert.deepEqual(tickedOf(rows), ['alpha', 'bravo', 'clash', 'zulu'], 'Find cleared: bravo’s tick is back');
  const { takes, leaves } = ofListed(rows);
  assert.deepEqual([takes.map(row => row.name), leaves.map(row => row.name)], [['alpha', 'bravo'], ['clash', 'zulu']]);
  stopSelecting();
});

test('The question keeps the rows it counted; it closes when one of them is no longer listed, another is, or one can no longer be deleted; Cancel keeps the ticks', () => {
  const rows = listed('alpha', 'bravo', 'charlie');
  startSelecting();
  tickHeading(ids(rows));
  ask(rows);
  assert.equal(askedNow([...rows].reverse()), true, 'another Sort is the same rows');
  assert.equal(askedNow(rows.slice(1)), false, 'a chip or From hides alpha: it closes');
  ask(rows.slice(1));
  assert.equal(askedNow(rows), false, 'alpha listed again, ticked: it closes');
  ask(rows);
  assert.equal(askedNow([...rows.slice(0, 2), { ...rows[2]!, cant: 'Agents can’t be changed now.' }]), false, 'charlie can no longer be deleted: it closes');
  ask(rows);
  assert.deepEqual([cancelAsk(), askedNow(rows), tickedOf(rows)], [true, false, ['alpha', 'bravo', 'charlie']]);
  assert.equal(cancelAsk(), false, 'nothing asked: nothing to cancel');
  stopSelecting();
});

test('Its words: the bar’s count, the question with History’s days, the rows it leaves and why, and the result', () => {
  assert.deepEqual([selectedWords(0), selectedWords(3)], ['', '3 selected']);
  // Thirteen ticked: ten that can be deleted, a found skill, a plugin's, and an agent whose kind's record stops writes.
  const stop = 'the agents record is damaged';
  const rows: Listed[] = [...listed('a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'), { id: 'skills-clash', name: 'clash', cant: 'not in Central Knot' },
    { id: 'skills-zulu', name: 'zulu', cant: 'Only through a plugin' }, { id: 'agents-scout', name: 'scout', cant: stop }];
  startSelecting();
  tickHeading(ids(rows));
  const { takes, leaves } = ofListed(rows);
  assert.equal(`${questionWords(takes.length, 30)} ${cantWords(leaves.length)}`, 'Delete 10 from every tool and Central Knot? History can restore them for 30 days. 3 can’t be deleted');
  assert.deepEqual(whyLines(leaves), ['clash: not in Central Knot', 'zulu: Only through a plugin', `scout: ${stop}`]);
  assert.deepEqual(whyLines([...leaves, { id: 'skills-old', name: 'old', cant: 'not in Central Knot' }])[0], 'clash and old: not in Central Knot', 'one line per reason');
  assert.equal(questionWords(1, 90), 'Delete 1 from every tool and Central Knot? History can restore it for 90 days.');
  assert.equal(deletedWords(ids(takes).map(id => id.slice(7)), { one: 'skill', many: 'skills' }, 3), 'Deleted 10 skills: a1, a2, a3 and 7 more. 3 not deleted.');
  assert.deepEqual([deletedWords(['notes'], { one: 'skill', many: 'skills' }, 0), restoreWords(1), restoreWords(10)], ['Deleted 1 skill: notes.', 'History can restore it.', 'History can restore them.']);
  stopSelecting();
});

// ---------- On real folders ----------

const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
/** A home with the ten skills in Central Knot and in every tool, but golf, which is Off. */
async function tenSkills() {
  const box = await sandbox();
  for (const name of names) await put(box, 'claude-cli', { 'SKILL.md': skillText(`${name}'s body.`, name) }, [], name);
  for (const name of names) await turnOn(box, box.context, name);
  await turnOff(box, box.context, 'golf');
  return box;
}
/**
 * A copy of a test home, to make the same clicks on apart. Its folders are new to Central Knot, which notes each tool's folder
 * as it is: one plain pass on each home, as the background runs it, before either is clicked.
 */
async function copyOf(box: Box): Promise<Box> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-select-')));
  await cp(box.base, base, { recursive: true, preserveTimestamps: true });
  // The settings remember the home's record by its place: the copy's is its own.
  await writeFile(join(base, 'settings.json'), (await readFile(join(box.base, 'settings.json'), 'utf8')).replaceAll(box.base, base));
  const home = join(base, 'home');
  const copy = { ...box, base, home, context: { ...box.context, home, settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') }, cleanup: () => rm(base, { recursive: true, force: true }) };
  for (const each of [box, copy]) await pass(each);
  return copy;
}
/** Each of the ten rows' own Delete, as its row is now. */
const deletes = (box: Box) => Promise.all(names.map(async name => { const { row, item } = await seen(box, box.context, name); return rowClicks.remove(row, item); }));
/** Every managed tool's skills folder, byte for byte. */
const toolFolders = async (box: Box) => Object.fromEntries(await Promise.all(tools.map(async tool => [tool, await bytes(join(box.home, roots[tool]))] as const)));
/**
 * Every file Central Knot keeps in the home (.central-knot/), its text with what must differ between two homes set equal: the
 * home's place, the times, History's ids (an entry's own, and the one that undid it), and each tool's folder's identity (a
 * copy's folders are other folders).
 */
async function kept(box: Box) {
  const folder = join(box.home, '.central-knot'), found: Record<string, string> = {};
  for (const name of (await readdir(folder, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())) {
    const path = join(name.parentPath, name.name);
    found[path.slice(folder.length)] = (await readFile(path, 'utf8')).replaceAll(box.base, 'BASE').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, 'TIME').replace(/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/g, 'ID').replace(/"(ino|birth)": \d+/g, '"$1": 0');
  }
  return found;
}
/** Undo of a click that made these History entries, as app.ts undoClick runs it: each entry's own action, newest first. */
async function undoAll(box: Box, made: string[]) {
  const events = (await readHistory(box.context)).filter(event => made.includes(event.id)).reverse().sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
  for (const event of events) await restoreSkill(box.context, box.tools, event.id);
}

test('A Delete of many is each row’s own Delete, in one send: every tool’s folder byte for byte, and what Central Knot keeps, as ten single Deletes leave them; one Undo puts back what ten single Undos do', async () => {
  const many = await tenSkills(), single = await copyOf(many);
  try {
    const before = await toolFolders(many);
    const sent = await applySkills(many.context, many.tools, await deletes(many));
    const one: string[][] = [];
    for (const change of await deletes(single)) one.push((await applySkills(single.context, single.tools, [change])).made ?? []);
    assert.equal(!!(await itemOf(many, 'alpha'))?.deleted, true, 'deleted from Central Knot');
    assert.equal(names.filter(name => tools.some(tool => !!before[tool]?.[`${name}/`])).length, 9, 'nine were in the tools: golf is Off');
    assert.deepEqual(await toolFolders(many), await toolFolders(single));
    assert.deepEqual(Object.keys((await toolFolders(many))['claude-cli'] ?? {}), [], 'none is left in a tool');
    assert.deepEqual(await kept(many), await kept(single));
    assert.equal(sent.made?.length, 10, 'one History entry for each');
    await undoAll(many, sent.made ?? []);
    for (const made of one.reverse()) await undoAll(single, made);
    assert.deepEqual([await toolFolders(many), await kept(many)], [await toolFolders(single), await kept(single)]);
    assert.deepEqual(await toolFolders(many), before, 'every tool’s copy as it was, golf still Off');
    assert.deepEqual(await Promise.all(names.map(async name => (await itemOf(many, name))?.on)), names.map(name => name !== 'golf'));
  } finally { await many.cleanup(); await single.cleanup(); }
});

test('A tool’s copy that differed from Central Knot’s is not as before after the Undo: the Delete’s pass takes it in first, as any pass does, and Restore puts that version in every tool', async () => {
  const box = await tenSkills();
  try {
    const edited = skillText('Edited in Copilot CLI.', 'hotel');
    await writeFile(join(folderOf(box, 'copilot-cli', 'hotel'), 'SKILL.md'), edited);
    const sent = await applySkills(box.context, box.tools, await deletes(box));
    await undoAll(box, sent.made ?? []);
    assert.deepEqual(await Promise.all(tools.map(async tool => (await bytes(folderOf(box, tool, 'hotel')))?.['SKILL.md']?.slice(4))), tools.map(() => edited));
  } finally { await box.cleanup(); }
});

test('One of the ten can’t leave a tool when it runs (its folder in Copilot CLI can’t be written): the other nine leave every tool, it is said as held there, and each of the ten has its History entry and its Restore', { skip: lockSkip || (process.platform === 'win32' && 'Windows allows moving a dir-readonly folder out of a writable parent (POSIX refuses reparenting .. on 0o555); covered on macOS and Linux.') }, async () => {
  const box = await tenSkills();
  try {
    const sent = await withLock(folderOf(box, 'copilot-cli', 'alpha'), 'dir-readonly', async () => applySkills(box.context, box.tools, await deletes(box)));
    const held = sent.results.filter(result => result.outcome !== 'removed' && result.outcome !== 'written');
    assert.deepEqual(held.map(result => [result.item, result.harness]), [['alpha', 'copilot-cli']]);
    assert.deepEqual([await bytes(folderOf(box, 'copilot-cli', 'alpha')) !== undefined, await bytes(folderOf(box, 'claude-cli', 'alpha'))], [true, undefined], 'alpha stays in Copilot CLI alone');
    for (const name of names.filter(name => name !== 'alpha')) for (const tool of tools) assert.equal(await bytes(folderOf(box, tool, name)), undefined, `${name} in ${tool}`);
    assert.equal(sent.made?.length, 10);
    const offered = await Promise.all(names.map(async name => (await historyActions(box, box.context, name)).filter(action => sent.made?.includes(action.event.id)).map(action => action.label)));
    assert.deepEqual(offered, names.map(() => ['Restore']));
  } finally { await box.cleanup(); }
});

test('A ticked row turned off since the question was asked: the Delete of many is refused for it alone, the other nine are deleted, and it stays Off in Central Knot', async () => {
  const box = await tenSkills();
  try {
    const asked = await deletes(box);
    await turnOff(box, box.context, 'alpha');
    const sent = await applySkills(box.context, box.tools, asked);
    assert.deepEqual([!!(await itemOf(box, 'alpha'))?.deleted, (await itemOf(box, 'alpha'))?.on], [false, false]);
    assert.deepEqual(await Promise.all(names.filter(name => name !== 'alpha').map(async name => !!(await itemOf(box, name))?.deleted)), names.slice(1).map(() => true));
    assert.equal(sent.made?.length, 9, 'a History entry for each of the nine');
  } finally { await box.cleanup(); }
});

test('A ticked Off row deleted by another writer since the question was asked: the Delete of many says it was not deleted, by name, and makes no History entry for it', async () => {
  const box = await tenSkills();
  try {
    await turnOff(box, box.context, 'hotel');
    const asked = (await deletes(box)).filter(change => change.key === 'golf' || change.key === 'hotel');
    const { row, item } = await seen(box, box.context, 'golf');
    await applySkills(box.context, box.tools, [rowClicks.remove(row, item)]);
    const sent = await applySkills(box.context, box.tools, asked);
    assert.deepEqual(sent.results.filter(heldWhole).map(result => result.item), ['golf'], 'golf is said as not deleted');
    assert.equal(sent.made?.length, 1, 'a History entry for hotel alone');
  } finally { await box.cleanup(); }
});

test('Turn on and Turn off of many: ofListed splits takes, already and leaves; turnLabel shows a number only when fewer than ticked; turnedWords says already, left and stayed', () => {
  const rows: Listed[] = [
    { id: 'skills-alpha', name: 'alpha' },
    { id: 'skills-bravo', name: 'bravo', already: true },
    { id: 'skills-charlie', name: 'charlie', already: true },
    { id: 'skills-clash', name: 'clash', cant: 'not in Central Knot' },
    { id: 'skills-zulu', name: 'zulu', cant: 'part of the plugin kit', already: true },
  ];
  startSelecting();
  tickHeading(ids(rows));
  const split = ofListed(rows);
  assert.deepEqual(split.takes.map(row => row.name), ['alpha']);
  assert.deepEqual(split.already.map(row => row.name), ['bravo', 'charlie']);
  assert.deepEqual(split.leaves.map(row => row.name), ['clash', 'zulu'], 'cant takes precedence over already');
  assert.deepEqual(
    [turnLabel(true, 0, 0), turnLabel(true, 0, 5), turnLabel(true, 5, 5), turnLabel(true, 2, 5), turnLabel(false, 3, 5), turnLabel(false, 3, 3)],
    ['Turn on', 'Turn on', 'Turn on', 'Turn on 2', 'Turn off 3', 'Turn off'],
  );
  assert.equal(turnedWords(false, ['a', 'b', 'c'], { one: 'skill', many: 'skills' }, 2, 1), 'Turned off 3 skills: a, b and c. 2 were already off. 1 not turned off.');
  assert.equal(turnedWords(true, ['a', 'b'], { one: 'item', many: 'items' }, 1, 0), 'Turned on 2 items: a and b. 1 was already on.');
  assert.equal(turnedWords(false, ['a', 'b', 'c', 'd', 'e'], { one: 'skill', many: 'skills' }, 0, 0, ['Codex still reads a another way.']),
    'Turned off 5 skills: a, b, c and 2 more. Codex still reads a another way.');
  stopSelecting();
});

test('Turn off of many on real folders: 3 on (one kept out of Codex) and 2 off; only the 3 are sent, 2 untouched, Undo puts each back in the same tools', async () => {
  const box = await tenSkills();
  try {
    // Keep alpha out of codex-cli (on in claude-cli and copilot-cli only); turn echo off too (golf is already off).
    const alphaSeen = await seen(box, box.context, 'alpha');
    await applySkills(box.context, box.tools, [rowClicks.inHarness(alphaSeen.row, alphaSeen.item, 'codex-cli', true)]);
    await turnOff(box, box.context, 'echo');
    const before = await toolFolders(box);
    const historyBefore = (await readHistory(box.context)).length;
    const onThree = ['alpha', 'bravo', 'charlie'];
    const offChanges = await Promise.all(onThree.map(async name => { const { row, item } = await seen(box, box.context, name); return rowClicks.off(row, item); }));
    const sent = await applySkills(box.context, box.tools, offChanges);
    assert.equal(sent.made?.length, 3, 'one History entry per changed row, none for echo or golf');
    assert.equal((await readHistory(box.context)).length - historyBefore, 3);
    for (const name of [...onThree, 'echo', 'golf']) for (const tool of tools) assert.equal(await bytes(folderOf(box, tool, name)), undefined, `${name} off in ${tool}`);
    assert.deepEqual((await itemOf(box, 'alpha'))?.except, ['codex-cli'], 'alpha keeps its except');
    await undoAll(box, sent.made ?? []);
    assert.deepEqual(await toolFolders(box), before, 'every tool folder back as before, alpha still out of Codex');
    assert.equal(await bytes(folderOf(box, 'codex-cli', 'alpha')), undefined);
    assert.ok(await bytes(folderOf(box, 'claude-cli', 'alpha')));
    assert.ok(await bytes(folderOf(box, 'copilot-cli', 'alpha')));
  } finally { await box.cleanup(); }
});

test('Turn on of many on real folders: 2 off (one kept out of Codex) and 1 addable found row; Undo puts all 3 back with found files byte for byte', async () => {
  const box = await tenSkills();
  try {
    const alphaSeen = await seen(box, box.context, 'alpha');
    await applySkills(box.context, box.tools, [rowClicks.inHarness(alphaSeen.row, alphaSeen.item, 'codex-cli', true)]);
    await turnOff(box, box.context, 'alpha');
    await turnOff(box, box.context, 'echo');
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Found skill lima.', 'lima'), 'scripts/run.sh': { text: '#!/bin/sh\necho lima\n', mode: 0o755 } }, [], 'lima');
    const before = await toolFolders(box);
    const onThree = ['alpha', 'echo', 'lima'];
    const onChanges = await Promise.all(onThree.map(async name => { const { row, item } = await seen(box, box.context, name); return rowClicks.on(row, item); }));
    const sent = await applySkills(box.context, box.tools, onChanges);
    assert.equal(sent.made?.length, 3);
    assert.equal(await bytes(folderOf(box, 'codex-cli', 'alpha')), undefined, 'alpha stays out of Codex');
    assert.ok(await bytes(folderOf(box, 'claude-cli', 'alpha')));
    assert.ok(await bytes(folderOf(box, 'copilot-cli', 'alpha')));
    for (const tool of tools) {
      assert.ok(await bytes(folderOf(box, tool, 'echo')), `echo on in ${tool}`);
      assert.ok(await bytes(folderOf(box, tool, 'lima')), `lima added in ${tool}`);
    }
    await undoAll(box, sent.made ?? []);
    assert.deepEqual(await toolFolders(box), before, 'found row lima back in claude-cli only, byte for byte; alpha and echo off again');
    assert.deepEqual([inLibrary(await itemOf(box, 'lima')), placeOf(await itemOf(box, 'lima'))], [undefined, 'found'], 'lima is found again, not in Central Knot');
    assert.deepEqual([(await itemOf(box, 'alpha'))?.on, (await itemOf(box, 'alpha'))?.except, (await itemOf(box, 'echo'))?.on], [false, ['codex-cli'], false]);
  } finally { await box.cleanup(); }
});

test('Turn off of many with one row locked in one tool: reports the locked tool as held, turns off the others, and Undo covers what was done', { skip: lockSkip || (process.platform === 'win32' && 'Windows allows moving a dir-readonly folder out of a writable parent (POSIX refuses reparenting .. on 0o555); covered on macOS and Linux.') }, async () => {
  const box = await tenSkills();
  try {
    const before = await toolFolders(box);
    const three = ['alpha', 'bravo', 'charlie'];
    const changes = async () => Promise.all(three.map(async name => { const { row, item } = await seen(box, box.context, name); return rowClicks.off(row, item); }));
    const sent = await withLock(folderOf(box, 'copilot-cli', 'alpha'), 'dir-readonly', async () => applySkills(box.context, box.tools, await changes()));
    const held = sent.results.filter(result => result.outcome !== 'removed' && result.outcome !== 'written');
    assert.deepEqual(held.map(result => [result.item, result.harness]), [['alpha', 'copilot-cli']]);
    assert.ok(await bytes(folderOf(box, 'copilot-cli', 'alpha')), 'alpha stayed in Copilot CLI');
    assert.equal(await bytes(folderOf(box, 'claude-cli', 'alpha')), undefined, 'alpha left Claude Code');
    for (const name of ['bravo', 'charlie']) for (const tool of tools) assert.equal(await bytes(folderOf(box, tool, name)), undefined, `${name} left ${tool}`);
    assert.equal(sent.made?.length, 3);
    await undoAll(box, sent.made ?? []);
    const after = await toolFolders(box);
    assert.deepEqual([after['claude-cli'], after['codex-cli']], [before['claude-cli'], before['codex-cli']], 'Claude Code and Codex folders back as before');
    // withLock restores the locked folder's own mode to 0o755; every file inside copilot-cli matches before.
    assert.deepEqual({ ...after['copilot-cli'], 'alpha/': before['copilot-cli']!['alpha/'] }, before['copilot-cli'], 'Copilot CLI copies back as before');
  } finally { await box.cleanup(); }
});

test('Turn on of many with one tool’s skills folder locked: reports the locked tool as held, writes the other tools, and Undo covers what was done', { skip: lockAppSkip }, async () => {
  const box = await tenSkills();
  try {
    const three = ['alpha', 'bravo', 'charlie'];
    for (const name of three) await turnOff(box, box.context, name);
    const before = await toolFolders(box);
    const changes = async () => Promise.all(three.map(async name => { const { row, item } = await seen(box, box.context, name); return rowClicks.on(row, item); }));
    const sent = await withLock(join(box.home, roots['copilot-cli']), 'dir-readonly', async () => applySkills(box.context, box.tools, await changes()));
    const held = sent.results.filter(result => result.outcome !== 'removed' && result.outcome !== 'written');
    assert.deepEqual(held.map(result => [result.item, result.harness]), three.map(name => [name, 'copilot-cli']));
    for (const name of three) {
      assert.ok(await bytes(folderOf(box, 'claude-cli', name)), `${name} written in Claude Code`);
      assert.ok(await bytes(folderOf(box, 'codex-cli', name)), `${name} written in Codex`);
      assert.equal(await bytes(folderOf(box, 'copilot-cli', name)), undefined, `${name} not written in locked Copilot CLI`);
    }
    assert.equal(sent.made?.length, 3);
    await undoAll(box, sent.made ?? []);
    assert.deepEqual(await toolFolders(box), before, 'Undo turns all three back off everywhere');
  } finally { await box.cleanup(); }
});

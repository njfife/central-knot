// A kind's record read back (src/kindstore.ts, which the three stores share): an item's key is any name a tool allows, so a
// record read again holds only its items, and a key every object has a property of (constructor, toString, __proto__) is an
// item like any other there, shown on agents; and an item an earlier build wrote with a `kind` reads, and is saved without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentsView } from '../src/agents.ts';
import { readLibraryFile, saveLibraryFile } from '../src/kindstore.ts';
import { newItem } from '../src/library.ts';
import { placeOf, rowClicks } from '../src/libraryrow.ts';
import { claudeAgent, applyClick, sandbox, tools, turnOn, write } from './agentclicks.ts';

test('An agent named constructor is found, taken in and read back like any other, once the agents record has been saved and read again', async () => {
  const box = await sandbox();
  try {
    await write(box, 'claude-cli', claudeAgent());
    assert.notEqual(await turnOn(box), 'choose');
    await writeFile(join(box.home, '.claude/agents/constructor.md'), '---\nname: constructor\ndescription: Builds things\n---\n\nYou build.\n');
    const found = await agentsView(box.context, box.tools), name: string = 'constructor';
    const fact = found.items.find(entry => entry.key === 'constructor')!;
    assert.deepEqual([fact.name, placeOf(found.library[name]), Object.keys(found.library)], ['constructor', 'found', ['reviewer']]);
    const hashes = { 'claude-cli': fact.copies['claude-cli']!.hash };
    const done = await applyClick(box, rowClicks.on({ key: 'constructor', name: 'constructor', hashes, plan: fact.plan, takeInAnswers: fact.takeInAnswers }, undefined));
    assert.equal(done.stopped, undefined);
    const after = await agentsView(box.context, box.tools);
    assert.deepEqual([placeOf(after.library[name]), Object.keys(after.library).sort()], ['on', ['constructor', 'reviewer']]);
    for (const tool of tools) assert.equal(after.items.find(entry => entry.key === 'constructor')?.copies[tool] !== undefined, true, tool);
    assert.match(await readFile(join(box.home, '.codex/agents/constructor.toml'), 'utf8'), /You build\./);
  } finally { await box.cleanup(); }
});

test('An item an earlier build wrote with its kind reads as any other, and the next save leaves the kind out', async () => {
  const box = await sandbox();
  try {
    const record = { file: 'agents.json', format: 3, said: 'The agents record' }, path = join(box.home, '.central-knot/agents.json');
    await mkdir(join(box.home, '.central-knot'), { recursive: true });
    await writeFile(path, JSON.stringify({ formatVersion: 3, items: { reviewer: { kind: 'agent', ...newItem('reviewer', 'reviewer') } }, folders: {} }));
    const read = await readLibraryFile(box.home, record);
    assert.ok('library' in read);
    assert.deepEqual({ ...read.library.items.reviewer }, newItem('reviewer', 'reviewer'));
    await saveLibraryFile(box.home, record, read.library);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).items.reviewer.kind, undefined);
  } finally { await box.cleanup(); }
});

test('A record whose items are named constructor, toString and __proto__ reads back holding those three items and nothing else', async () => {
  const box = await sandbox();
  try {
    const record = { file: 'agents.json', format: 3, said: 'The agents record' }, names = ['constructor', 'toString', '__proto__'];
    const items = Object.create(null);
    for (const name of names) items[name] = newItem(name, name);
    await saveLibraryFile(box.home, record, { items, folders: {} });
    const read = await readLibraryFile(box.home, record);
    assert.ok('library' in read);
    assert.deepEqual(Object.keys(read.library.items), names);
    for (const name of names) assert.equal(Object.hasOwn(read.library.items, name) && read.library.items[name].name, name, name);
    assert.equal(read.library.items.hasOwnProperty, undefined, 'and no name every object has');
  } finally { await box.cleanup(); }
});

// The pass's contract (src/librarypass.ts Kind) on a toy kind and real files: what Disk.held is told, so a tool that reads
// another tool's folder has an item another way only while the item is really in that tool (as skills have it; agents and MCP
// servers don't); and a pass that runs to its end while another build takes the home's record over. The toy is one text file
// per item ("notes"); Claude Code keeps them in its folder, OpenCode in its own and it also reads Claude Code's, as it does for
// skills.
// The pass's other rules (the folder guards, the settle window, the gate, a crash between two steps) are exampled on real
// agents in tests/agents.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { wantedIn } from '../src/library.ts';
import { copiesOf, lookFor, restore, runPass, type Disk, type Kind, type KindLibrary, type Seen } from '../src/librarypass.ts';
import { libraryAction } from '../src/historyactions.ts';
import { readRecord, takeOverSync, type ShareContext } from '../src/share.ts';
import { readHistory } from '../src/history.ts';
import type { Change, HarnessId } from '../src/types.ts';

interface Note extends Seen { file: string; text: string }
const tools: HarnessId[] = ['claude-cli', 'opencode-cli'];
const folderOf = (context: ShareContext, tool: HarnessId) => join(context.home, tool === 'claude-cli' ? '.claude/notes' : '.config/opencode/notes');
const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

/** The toy kind. OpenCode has a note another way while it is wanted in Claude Code, whose folder OpenCode reads. */
function noteKind(): Kind<string, Note> {
  const versions = new Map<string, string>();
  const record = (home: string) => join(home, 'notes.json');
  return {
    // A toy in the shape skills will take: the kind's name only marks its items.
    kind: 'skill', words: { item: 'note', copy: 'file', folder: () => 'notes folder' }, historyPrefix: 'note:',
    harnesses: managed => managed.filter(tool => tools.includes(tool)),
    folder: folderOf,
    open: async context => ({ library: JSON.parse(await readFile(record(context.home), 'utf8').catch(() => 'null')) ?? { items: {}, folders: {} } }),
    save: (home, library: KindLibrary) => writeFile(record(home), JSON.stringify(library)),
    store: async (_context, item, hash, text) => { versions.set(`${item.key}:${hash}`, text); },
    readVersion: async (_context, key, hash) => versions.get(`${key}:${hash}`),
    hashOf,
    recover: async () => {},
    merge: async () => ({ couldNot: 'A note has no Merge.' }),
    read: async (context, managed) => {
      const disk: Disk<Note> = {
        byKey: new Map(), unseen: new Map(), locked: new Map(), problems: [],
        held: (item, tool) => (tool === 'opencode-cli' && managed.includes('claude-cli') && wantedIn(item, 'claude-cli')
          ? { why: 'OpenCode reads Claude Code’s copy.', anotherWay: true } : undefined),
      };
      for (const tool of managed) for (const name of await readdir(folderOf(context, tool)).catch(() => [])) {
        const file = join(folderOf(context, tool), name), text = await readFile(file, 'utf8'), key = name.replace(/\.txt$/, '');
        disk.byKey.set(key, { ...disk.byKey.get(key), [tool]: { tool, name: key, hash: hashOf(text), at: 0, file, text } });
      }
      return disk;
    },
    contentOf: note => note.text,
    ownOf: () => undefined,
    keepOwn: async () => false,
    write: async (context, item, tool, _here, text) => {
      await mkdir(folderOf(context, tool), { recursive: true });
      await writeFile(join(folderOf(context, tool), `${item.name}.txt`), text);
      return undefined;
    },
    remove: async (_context, _item, here) => { await rm(here.file); return 'removed'; },
    historyAction: () => undefined,
  };
}

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-toy-kind-')));
  const home = join(base, 'home');
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  for (const tool of tools) await mkdir(folderOf(context, tool), { recursive: true });
  return { context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
/** Each tool's own copy of the note, as its folder holds it. */
const copies = (context: ShareContext) => Promise.all(tools.map(tool => readFile(join(folderOf(context, tool), 'plan.txt'), 'utf8').catch(() => undefined)));
const click = (on: boolean, except: HarnessId[]): Change => ({ key: 'plan', on, except });

test('A tool that reads another’s folder has the item another way only while the item is wanted there: On in both, then kept out of the first, and the reader gets exactly one copy of its own', async () => {
  const { context, cleanup } = await sandbox();
  try {
    const kind = noteKind();
    await writeFile(join(folderOf(context, 'claude-cli'), 'plan.txt'), 'Plan.\n');
    // Taken in and On in both: OpenCode reads Claude Code's copy, so nothing of Central Knot's goes into its own folder.
    await runPass(kind, context, tools, [click(true, [])]);
    assert.deepEqual(await copies(context), ['Plan.\n', undefined]);
    const { look, live } = await lookFor(kind, context, tools);
    assert.deepEqual(copiesOf(look, live[0])['opencode-cli'], { is: 'held', why: 'OpenCode reads Claude Code’s copy.', anotherWay: true });
    assert.equal((await runPass(kind, context, tools, [])).writes, 0, 'a second pass finds nothing to do');
    // Kept out of Claude Code: its copy goes, and OpenCode, which no longer has it another way, gets one copy of its own.
    await runPass(kind, context, tools, [click(true, ['claude-cli'])]);
    assert.deepEqual(await copies(context), [undefined, 'Plan.\n']);
    assert.equal((await runPass(kind, context, tools, [])).writes, 0, 'and it stays so');
    // Let back into Claude Code: OpenCode has it another way again, so its own copy, which Central Knot put there, goes.
    await runPass(kind, context, tools, [click(true, [])]);
    assert.deepEqual(await copies(context), ['Plan.\n', undefined]);
    assert.equal((await runPass(kind, context, tools, [])).writes, 0, 'one way, and it stays so');
  } finally { await cleanup(); }
});

test('A tool that has the item another way and holds a copy Central Knot didn’t put there: that copy is left alone', async () => {
  const { context, cleanup } = await sandbox();
  try {
    const kind = noteKind();
    await writeFile(join(folderOf(context, 'claude-cli'), 'plan.txt'), 'Plan.\n');
    await writeFile(join(folderOf(context, 'opencode-cli'), 'plan.txt'), 'My own plan.\n');
    // Taken in from Claude Code's copy (the copy question chose it); OpenCode's own copy was never Central Knot's.
    await runPass(kind, context, tools, [{ ...click(true, []), use: 'claude-cli' }]);
    assert.deepEqual(await copies(context), ['Plan.\n', 'My own plan.\n']);
    const { look, live } = await lookFor(kind, context, tools);
    assert.deepEqual(copiesOf(look, live[0])['opencode-cli'], { is: 'present', hash: hashOf('My own plan.\n'), at: 0, anotherWay: 'OpenCode reads Claude Code’s copy.' });
    assert.equal((await runPass(kind, context, tools, [])).writes, 0, 'nothing is written or removed there');
  } finally { await cleanup(); }
});

test('A pass under way while another build re-records the home as its own runs to its end: both items are written, and the record names that build', async () => {
  const { context, cleanup } = await sandbox();
  try {
    // OpenCode doesn't read Claude Code's folder here, so each item is written into its own.
    const toy = noteKind(), read = toy.read;
    const kind: Kind<string, Note> = {
      ...toy, read: async (at, managed, library) => ({ ...await read(at, managed, library), held: () => undefined }),
      write: async (at, item, tool, here, text) => {
        // The other build takes the record over while the first item is being written.
        if (item.name === 'first') await takeOverSync({ ...context, build: 'other', buildName: 'The other build' });
        return toy.write(at, item, tool, here, text);
      },
    };
    for (const name of ['first', 'second']) await writeFile(join(folderOf(context, 'claude-cli'), `${name}.txt`), `${name}\n`);
    const result = await runPass(kind, context, tools, [{ key: 'first', on: true, except: [] }, { key: 'second', on: true, except: [] }]);
    assert.deepEqual([result.stopped, (await readdir(folderOf(context, 'opencode-cli'))).sort()], [undefined, ['first.txt', 'second.txt']]);
    assert.ok((await readHistory(context)).some(event => event.key === 'note:second'), 'and History has the second');
    assert.equal((await readRecord(context.home)).record?.owner, 'other');
  } finally { await cleanup(); }
});

test('A pass that changes nothing leaves its read for the look made right after it (main.ts syncAndView), taken once and as it was read; a pass that writes leaves none', async () => {
  const { context, cleanup } = await sandbox();
  try {
    // Each tool gets a copy of its own here (OpenCode doesn't read Claude Code's folder), and each read of the home is counted.
    const toy = noteKind();
    let reads = 0;
    const kind: Kind<string, Note> = { ...toy, read: async (at, managed, library) => { reads++; return { ...await toy.read(at, managed, library), held: () => undefined }; } };
    await writeFile(join(folderOf(context, 'claude-cli'), 'plan.txt'), 'Plan.\n');
    await runPass(kind, context, tools, [click(true, [])]);
    const kept = new Map(), passing = { ...context, kept }, looking = () => lookFor(kind, { ...context, kept }, tools);
    reads = 0;
    assert.equal((await runPass(kind, passing, tools, [])).untouched, true, 'a pass with nothing to do');
    const { look, live } = await looking();
    assert.equal(reads, 1, 'the look right after it is made from its read');
    assert.deepEqual(copiesOf(look, live[0])['opencode-cli'], { is: 'present', hash: hashOf('Plan.\n'), at: 0 });
    await looking();
    assert.equal(reads, 2, 'taken once: the next look reads the home');
    // An edit by hand, which the pass writes into OpenCode: the home is no longer as it read it, so the look reads it again.
    await writeFile(join(folderOf(context, 'claude-cli'), 'plan.txt'), 'Plan, edited.\n');
    const wrote = await runPass(kind, passing, tools, []);
    assert.deepEqual([wrote.writes, wrote.untouched], [1, undefined]);
    reads = 0;
    const after = await looking();
    assert.deepEqual([reads, copiesOf(after.look, after.live[0])['opencode-cli']], [1, { is: 'present', hash: hashOf('Plan, edited.\n'), at: 0 }]);
    // OpenCode's folder gone inside the settle window: the pass's guard holds that tool unseen and writes nothing. The look made
    // from that read says what a look of its own says (the window read as passed: written afresh), not what the guard noted.
    await rm(folderOf(context, 'opencode-cli'), { recursive: true });
    const waiting = { ...context, settleMs: 60_000 };
    await runPass(kind, waiting, tools, []);
    assert.equal((await runPass(kind, { ...waiting, kept }, tools, [])).untouched, true, 'inside the window: nothing to do');
    const own = await lookFor(kind, context, tools), taken = await looking();
    assert.deepEqual(copiesOf(taken.look, taken.live[0]), copiesOf(own.look, own.live[0]));
    assert.equal(copiesOf(taken.look, taken.live[0])['opencode-cli']?.is, 'absent');
  } finally { await cleanup(); }
});

test('turn records wasExcept and nowExcept (no single only) when a person’s switch changes on with except; ordinary On/Off, single keep-outs and plugin ticks stay unchanged, and restore puts earlier keep-outs back', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-toy-turn-')));
  const home = join(base, 'home'), three: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  const dirOf = (at: ShareContext, tool: HarnessId) => join(at.home, tool);
  const toy = noteKind();
  const kind: Kind<string, Note> = {
    ...toy, harnesses: managed => managed.filter(tool => three.includes(tool)), folder: dirOf,
    read: async (at, managed) => {
      const disk: Disk<Note> = { byKey: new Map(), unseen: new Map(), locked: new Map(), problems: [], held: () => undefined, readers: (_item, tool) => (tool === 'claude-cli' ? ['opencode-cli'] : []) };
      for (const tool of managed) for (const name of await readdir(dirOf(at, tool)).catch(() => [])) {
        const file = join(dirOf(at, tool), name), text = await readFile(file, 'utf8'), key = name.replace(/\.txt$/, '');
        disk.byKey.set(key, { ...disk.byKey.get(key), [tool]: { tool, name: key, hash: hashOf(text), at: 0, file, text } });
      }
      return disk;
    },
    write: async (at, item, tool, _here, text) => { await mkdir(dirOf(at, tool), { recursive: true }); await writeFile(join(dirOf(at, tool), `${item.name}.txt`), text); return undefined; },
    historyAction: (event, item, now, version) => libraryAction(event, item, now, version),
  };
  const files = () => Promise.all(three.map(tool => readFile(join(dirOf(context, tool), 'plan.txt'), 'utf8').catch(() => undefined)));
  try {
    for (const tool of three) await mkdir(dirOf(context, tool), { recursive: true });
    await writeFile(join(dirOf(context, 'claude-cli'), 'plan.txt'), 'Plan.\n');
    await runPass(kind, context, three, [click(true, [])]);
    // Ordinary single keep-out on On row: records only, no wasExcept/nowExcept.
    await runPass(kind, context, three, [click(true, ['codex-cli'])]);
    const singleOut = (await readHistory(context)).at(-1)!;
    assert.deepEqual([singleOut.kind, singleOut.only, singleOut.wasExcept, singleOut.nowExcept], ['off', 'codex-cli', undefined, undefined]);
    // Ordinary On -> Off (except unchanged): records neither only nor wasExcept/nowExcept.
    await runPass(kind, context, three, [click(false, ['codex-cli'])]);
    const plainOff = (await readHistory(context)).at(-1)!;
    assert.deepEqual([plainOff.kind, plainOff.only, plainOff.wasExcept, plainOff.nowExcept], ['off', undefined, undefined, undefined]);
    // Off -> On in Claude Code only (except changes from ['codex-cli'] to ['copilot-cli', 'codex-cli']): records wasExcept/nowExcept, alsoRead from Disk.readers, and no only.
    const onOnly = await runPass(kind, context, three, [click(true, ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'])]);
    const onOnlyEvent = (await readHistory(context)).at(-1)!;
    assert.deepEqual(await files(), ['Plan.\n', undefined, undefined]);
    assert.deepEqual([onOnlyEvent.kind, onOnlyEvent.only, onOnlyEvent.wasExcept, onOnlyEvent.nowExcept, onOnlyEvent.alsoRead],
      ['on', undefined, ['codex-cli'], ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'], ['opencode-cli']]);
    // Undo (restore) puts the item Off with ['codex-cli'] back, removes Claude Code's file, and logs the reverse pair without only or alsoRead.
    await restore(kind, context, three, onOnly.made![0]!);
    const { live } = await lookFor(kind, context, three);
    const undoEvent = (await readHistory(context)).at(-1)!;
    assert.deepEqual([live[0].on, live[0].except, await files()], [false, ['codex-cli'], [undefined, undefined, undefined]]);
    assert.deepEqual([undoEvent.kind, undoEvent.only, undoEvent.wasExcept, undoEvent.nowExcept, undoEvent.alsoRead],
      ['off', undefined, ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'], ['codex-cli'], undefined]);
    // Off -> On in Codex only (no readers): no alsoRead.
    const onCodex = await runPass(kind, context, three, [click(true, ['claude-cli', 'copilot-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'])]);
    assert.equal((await readHistory(context)).at(-1)!.alsoRead, undefined);
    await restore(kind, context, three, onCodex.made![0]!);
    // Ordinary Off -> On (except unchanged): records neither only nor wasExcept/nowExcept/alsoRead.
    await runPass(kind, context, three, [click(true, ['codex-cli'])]);
    const plainOn = (await readHistory(context)).at(-1)!;
    assert.deepEqual([plainOn.kind, plainOn.only, plainOn.wasExcept, plainOn.nowExcept, plainOn.alsoRead], ['on', undefined, undefined, undefined, undefined]);
    // A plugin's tick on an Off item (forPlugin set, changing on and except) behaves as on next: no wasExcept/nowExcept/alsoRead.
    await runPass(kind, context, three, [click(false, ['codex-cli'])]);
    const { library } = await kind.open(context, true);
    library.items.plan.source = 'plug-id';
    await kind.save(context.home, library);
    await runPass(kind, context, three, [{ ...click(true, ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli']), forPlugin: 'plug-id' }]);
    const pluginTick = (await readHistory(context)).at(-1)!;
    assert.deepEqual([pluginTick.kind, pluginTick.only, pluginTick.wasExcept, pluginTick.nowExcept, pluginTick.alsoRead], ['on', undefined, undefined, undefined, undefined]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

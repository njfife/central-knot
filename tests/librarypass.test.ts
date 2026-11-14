// The pass's contract (src/librarypass.ts Kind) on a toy kind and real files: what Disk.held is told, so a tool that reads
// another tool's folder has an item another way only while the item is really in that tool (as skills have it; agents and MCP
// servers don't); and a pass that stops once another build takes over syncing the home. The toy is one text file per item
// ("notes"); Claude Code keeps them in its folder, OpenCode in its own and it also reads Claude Code's, as it does for skills.
// The pass's other rules (the folder guards, the settle window, the gate, a crash between two steps) are exampled on real
// agents in tests/agents.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { wantedIn } from '../src/library.ts';
import { copiesOf, lookFor, runPass, type Disk, type ItemClick, type Kind, type KindLibrary, type Seen } from '../src/librarypass.ts';
import { takeOverSync, type ShareContext } from '../src/share.ts';
import { readHistory } from '../src/history.ts';
import type { HarnessId } from '../src/types.ts';

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
    kind: 'skill', words: { item: 'note', copy: 'file', folder: 'notes folder' }, historyPrefix: 'note:',
    harnesses: managed => managed.filter(tool => tools.includes(tool)),
    folder: folderOf,
    pathOf: (context, tool, name) => join(folderOf(context, tool), `${name}.txt`),
    open: async context => ({ library: JSON.parse(await readFile(record(context.home), 'utf8').catch(() => 'null')) ?? { items: {}, folders: {} } }),
    save: (home, library: KindLibrary) => writeFile(record(home), JSON.stringify(library)),
    store: async (_context, item, hash, text) => { versions.set(`${item.key}:${hash}`, text); },
    readVersion: async (_context, key, hash) => versions.get(`${key}:${hash}`),
    hashOf,
    recover: async () => {},
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
const click = (on: boolean, except: HarnessId[]): ItemClick => ({ key: 'plan', on, except });

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

test('A pass whose home another build takes over during its first item writes nothing more: the second item is not written, and it says why', async () => {
  const { context, cleanup } = await sandbox();
  try {
    // OpenCode doesn't read Claude Code's folder here, so each item is written into its own.
    const toy = noteKind(), read = toy.read;
    const writes: string[] = [];
    const kind: Kind<string, Note> = {
      ...toy, read: async (at, managed) => ({ ...await read(at, managed), held: () => undefined }),
      write: async (at, item, tool, here, text) => {
        // The other build takes over while the first item is being written.
        if (!writes.length) await takeOverSync({ ...context, build: 'other', buildName: 'The other build' });
        writes.push(item.name);
        return toy.write(at, item, tool, here, text);
      },
    };
    for (const name of ['first', 'second']) await writeFile(join(folderOf(context, 'claude-cli'), `${name}.txt`), `${name}\n`);
    const result = await runPass(kind, context, tools, [{ key: 'first', on: true, except: [] }, { key: 'second', on: true, except: [] }]);
    assert.deepEqual(writes, ['first'], 'the second item is not written');
    assert.equal(result.stopped, 'The other build took over syncing this home meanwhile, so this stopped there.');
    assert.deepEqual(await readdir(folderOf(context, 'opencode-cli')), ['first.txt']);
    assert.ok(!(await readHistory(context)).some(event => event.key === 'note:second'), 'nor is anything recorded of it');
  } finally { await cleanup(); }
});

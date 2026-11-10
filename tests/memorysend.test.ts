import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { memoryView } from '../src/memory.ts';
import { CHANGED, noteName, noteText, sendMemories } from '../src/memorysend.ts';
import { readSent, sentPath } from '../src/memorysent.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId, MemoryPick } from '../src/types.ts';

/** Codex's own pattern for a note's name. */
const CODEX_NOTE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;
const AT = new Date(Date.UTC(2026, 10, 10, 20, 31, 5, 412));
const clock = () => AT;

async function sandbox({ memoryOn = true } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-memorysend-')));
  const home = join(base, 'home');
  const put = async (path: string, text: string) => { await mkdir(join(home, path, '..'), { recursive: true }); await writeFile(join(home, path), text); };
  const project = `.claude/projects/${home.replace(/[^A-Za-z0-9]/g, '-')}-code-app/memory`;
  await put('.codex/config.toml', memoryOn ? '[features]\nmemories = true\n' : '');
  await put('.codex/memories/memory_summary.md', 'What Codex knows.\n');
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'];
  const snapshots = () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness })));
  const view = async () => memoryView(home, await snapshots());
  /** Picks by file name, with the hash the page would have shown. */
  const picks = async (...files: string[]): Promise<MemoryPick[]> => {
    const notes = (await view()).claude!.flatMap(entry => entry.notes);
    return files.map(file => { const note = notes.find(entry => entry.file === file)!; return { path: note.path, hash: note.hash }; });
  };
  const send = async (list: MemoryPick[], now = clock) => sendMemories(context, await snapshots(), 'codex-cli', list, now);
  const notes = join(home, '.codex/memories/extensions/ad_hoc/notes');
  const tree = async (folder: string): Promise<string[]> => (await readdir(folder, { recursive: true }).catch(() => [] as string[])).map(String).sort();
  return { base, home, put, project, context, view, picks, send, notes, tree, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const memory = (name: string, body: string) => `---\nname: ${name}\ndescription: About ${name}\nmetadata:\n  type: feedback\n---\n${body}`;

test('Note names follow Codex’s pattern: lowercase letters, digits and single dashes, at most 128 bytes', () => {
  const cases: [string, string][] = [
    ['Small Pull Requests', '2026-11-10T20-31-05-small-pull-requests.md'],
    ['Don’t use "npm", use pnpm!', '2026-11-10T20-31-05-don-t-use-npm-use-pnpm.md'],
    ['Café crème à São Paulo', '2026-11-10T20-31-05-cafe-creme-a-sao-paulo.md'],
    ['日本語のメモ', '2026-11-10T20-31-05-memory.md'],
    ['--leading and trailing--', '2026-11-10T20-31-05-leading-and-trailing.md'],
    ['...starts with punctuation', '2026-11-10T20-31-05-starts-with-punctuation.md'],
  ];
  for (const [title, name] of cases) assert.equal(noteName(title, AT), name, title);
  const long = noteName(`${'word '.repeat(13)}x${'y'.repeat(100)}`, AT);
  assert.equal(long, `2026-11-10T20-31-05-${'word-'.repeat(13)}xyyyy.md`, 'a long title is cut at 70 characters');
  assert.equal(noteName(`${'a'.repeat(69)} b`, AT), `2026-11-10T20-31-05-${'a'.repeat(69)}.md`, 'a cut that ends on a dash drops it');
  assert.equal(noteName('Twice', AT, 1), '2026-11-10T20-31-05-twice-2.md');
  for (const name of [...cases.map(([title]) => noteName(title, AT)), long, noteName('x'.repeat(500), AT, 998)]) {
    assert.match(name, CODEX_NOTE);
    assert.ok(Buffer.byteLength(name) <= 128, name);
  }
});

test('A note’s text, byte for byte: where it came from, the title, the text trimmed, LF and one final newline', () => {
  assert.equal(noteText('Claude Code\'s memory (project app, file a.md)', 'Say "please"', '\n\nLine one\nLine "two"\n\n'),
    'Remember this. Central Knot carried it over from Claude Code\'s memory (project app, file a.md) because the user asked.\n\n# Say "please"\n\nLine one\nLine "two"\n');
  assert.equal(noteText('o', 't', 'One\r\nTwo\r\n'), 'Remember this. Central Knot carried it over from o because the user asked.\n\n# t\n\nOne\r\nTwo\n', 'CRLF inside the text stays as it is');
});

test('Sending writes one new note per memory, in the ticked order, creates only the notes folder, and records each', async () => {
  const box = await sandbox();
  try {
    await box.put(`${box.project}/small.md`, memory('small-prs', '\nKeep PRs "small".\nOne thing each.\n'));
    await box.put(`${box.project}/tests.md`, memory('tests-first', 'Write the test first.\n'));
    const before = await box.tree(join(box.home, '.codex/memories'));
    const picks = await box.picks('tests.md', 'small.md');
    const result = await box.send(picks);
    assert.deepEqual(result, { sent: picks.map(pick => pick.path), failed: [] });
    const after = await box.tree(join(box.home, '.codex/memories'));
    assert.deepEqual(after.filter(path => !before.includes(path)), ['extensions', 'extensions/ad_hoc', 'extensions/ad_hoc/notes',
      'extensions/ad_hoc/notes/2026-11-10T20-31-05-small-prs.md', 'extensions/ad_hoc/notes/2026-11-10T20-31-05-tests-first.md']);
    assert.equal(await readFile(join(box.notes, '2026-11-10T20-31-05-small-prs.md'), 'utf8'),
      'Remember this. Central Knot carried it over from Claude Code\'s memory (project code-app, file small.md) because the user asked.\n\n# small-prs\n\nKeep PRs "small".\nOne thing each.\n');
    assert.deepEqual(JSON.parse(await readFile(sentPath(box.home), 'utf8')), { formatVersion: 1, sent: [
      { source: picks[0].path, to: 'codex-cli', hash: picks[0].hash, at: AT.toISOString(), note: '2026-11-10T20-31-05-tests-first.md' },
      { source: picks[1].path, to: 'codex-cli', hash: picks[1].hash, at: AT.toISOString(), note: '2026-11-10T20-31-05-small-prs.md' },
    ] });
  } finally { await box.cleanup(); }
});

test('Two same-title memories in one second take -2; a note already there is left as it was', async () => {
  const box = await sandbox();
  try {
    await box.put(`${box.project}/one.md`, memory('same', 'First.\n'));
    await box.put(`${box.project}/two.md`, memory('same', 'Second.\n'));
    assert.equal((await box.send(await box.picks('one.md', 'two.md'))).sent.length, 2);
    assert.deepEqual(await box.tree(box.notes), ['2026-11-10T20-31-05-same-2.md', '2026-11-10T20-31-05-same.md']);
    assert.match(await readFile(join(box.notes, '2026-11-10T20-31-05-same.md'), 'utf8'), /First\.\n$/);
    assert.match(await readFile(join(box.notes, '2026-11-10T20-31-05-same-2.md'), 'utf8'), /Second\.\n$/);
    // Codex's own note (or an earlier send) at the name: never overwritten.
    await writeFile(join(box.notes, '2026-11-10T20-31-05-same.md'), 'Codex’s own note.\n');
    await box.send(await box.picks('one.md'));
    assert.equal(await readFile(join(box.notes, '2026-11-10T20-31-05-same.md'), 'utf8'), 'Codex’s own note.\n');
    assert.match(await readFile(join(box.notes, '2026-11-10T20-31-05-same-3.md'), 'utf8'), /First\.\n$/);
  } finally { await box.cleanup(); }
});

test('Nothing is written when Codex’s memory is off, or saving is off in this home', async () => {
  const box = await sandbox({ memoryOn: false });
  try {
    await box.put(`${box.project}/a.md`, memory('a', 'A.\n'));
    const picks = await box.picks('a.md');
    assert.deepEqual(await box.send(picks), { stopped: 'Codex’s memory is off on this computer. Nothing was sent.', sent: [], failed: [] });
    const refused = await sendMemories({ ...box.context, realHome: box.home }, [], 'codex-cli', picks, clock);
    assert.match(refused.stopped ?? '', /^Preview only/);
    assert.deepEqual(await box.tree(join(box.home, '.codex/memories')), ['memory_summary.md']);
    assert.deepEqual(await readSent(box.home), []);
  } finally { await box.cleanup(); }
});

test('A memory changed since the page read it is left out with its reason; Codex’s own summary is never sent to it', async () => {
  const box = await sandbox();
  try {
    await box.put(`${box.project}/a.md`, memory('a', 'A.\n'));
    await box.put(`${box.project}/b.md`, memory('b', 'B.\n'));
    const picks = await box.picks('a.md', 'b.md');
    await box.put(`${box.project}/a.md`, memory('a', 'A, rewritten.\n'));
    const summary = (await box.view()).codex!.summary!.path;
    const result = await box.send([...picks, { path: summary, hash: '' }]);
    assert.deepEqual(result, { sent: [picks[1].path], failed: [
      { path: picks[0].path, title: 'a', why: CHANGED },
      { path: summary, title: 'Codex’s memory summary', why: 'Codex already has it.' },
    ] });
    assert.deepEqual(await box.tree(box.notes), ['2026-11-10T20-31-05-b.md']);
  } finally { await box.cleanup(); }
});

test('A failure part-way stops the run; the notes already written stay and are recorded', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    for (const name of ['a', 'b', 'c']) await box.put(`${box.project}/${name}.md`, memory(name, `${name}.\n`));
    const picks = await box.picks('a.md', 'b.md', 'c.md');
    // The notes folder turns read-only just before the second note.
    let calls = 0;
    const result = await box.send(picks, () => { if (++calls === 2) chmodSync(box.notes, 0o555); return AT; });
    await chmod(box.notes, 0o755);
    assert.deepEqual(result, { sent: [picks[0].path], failed: [
      { path: picks[1].path, title: 'b', why: 'Permission was denied.' },
      { path: picks[2].path, title: 'c', why: 'Not tried after that.' },
    ] });
    assert.deepEqual(await box.tree(box.notes), ['2026-11-10T20-31-05-a.md']);
    assert.deepEqual((await readSent(box.home)).map(entry => entry.source), [picks[0].path]);
  } finally { await box.cleanup(); }
});

test('The record: a resend replaces its entry, a gone source is dropped, a damaged record reads as empty', async () => {
  const box = await sandbox();
  try {
    await box.put(`${box.project}/a.md`, memory('a', 'A.\n'));
    await box.put(`${box.project}/b.md`, memory('b', 'B.\n'));
    await mkdir(join(sentPath(box.home), '..'), { recursive: true });
    await writeFile(sentPath(box.home), '{ not json');
    assert.deepEqual(await readSent(box.home), []);
    await box.send(await box.picks('a.md', 'b.md'));
    await rm(join(box.home, box.project, 'b.md'));
    const later = new Date(AT.getTime() + 60_000);
    await box.send(await box.picks('a.md'), () => later);
    const sent = await readSent(box.home);
    assert.deepEqual(sent.map(entry => [entry.source.endsWith('a.md'), entry.at, entry.note]), [[true, later.toISOString(), '2026-11-10T20-32-05-a.md']]);
    await writeFile(sentPath(box.home), JSON.stringify({ formatVersion: 2, sent }));
    assert.deepEqual(await readSent(box.home), [], 'another format reads as empty');
  } finally { await box.cleanup(); }
});

test('Marks: a sent memory says so, changed since when its text differs, none once renamed; Codex’s card knows notes went in', async () => {
  const box = await sandbox();
  try {
    await box.put(`${box.project}/a.md`, memory('a', 'A.\n'));
    assert.equal((await box.view()).codex?.noted, undefined);
    await box.send(await box.picks('a.md'));
    const marks = async () => (await box.view()).claude![0].notes.find(note => note.title === 'a')?.sent;
    assert.deepEqual(await marks(), [{ to: 'codex-cli', at: AT.toISOString(), changed: false }]);
    assert.equal((await box.view()).codex?.noted, true);
    await box.put(`${box.project}/a.md`, memory('a', 'A, changed.\n'));
    assert.deepEqual(await marks(), [{ to: 'codex-cli', at: AT.toISOString(), changed: true }]);
    await rename(join(box.home, box.project, 'a.md'), join(box.home, box.project, 'renamed.md'));
    assert.equal(await marks(), undefined);
  } finally { await box.cleanup(); }
});

// One skill ("notes") in a temp home, and the clicks the Skills page and History send for it, built by the page's own code
// (src/libraryrow.ts rowClicks, src/historyactions.ts). Shared by the tests that replay clicks on real folders:
// skills.test.ts, skillmigrate.test.ts and the seeded walk (librarywalk.test.ts).
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readHistory } from '../src/history.ts';
import { libraryAction, versionChoices } from '../src/historyactions.ts';
import type { LibraryItem } from '../src/library.ts';
import { asksWhichCopy, rowClicks, type LibraryRow } from '../src/libraryrow.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, restoreSkill, skillsView } from '../src/skills.ts';
import type { Change, HarnessId, LibraryFacts, PassResult } from '../src/types.ts';

/** The tools of a test home, and each one's own skills folder. Which of them Central Knot manages is the home's own `tools`. */
export const roots = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills', 'opencode-cli': '.config/opencode/skills', 'pi-cli': '.pi/agent/skills' } as const;
export type Tool = keyof typeof roots;
export const tools: Tool[] = ['claude-cli', 'copilot-cli', 'codex-cli'];

export async function sandbox(present: Tool[] = tools) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-skill-clicks-')));
  const home = join(base, 'home');
  for (const tool of present) await mkdir(join(home, roots[tool]), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { base, home, context, tools: [...present] as HarnessId[], cleanup: () => rm(base, { recursive: true, force: true }) };
}
export type Box = Awaited<ReturnType<typeof sandbox>>;

export const skillText = (body = 'Take notes.', name = 'notes') => `---\nname: ${name}\ndescription: Takes notes.\n---\n\n${body}\n`;
/** A skill's folder: each file by its path inside, with its text, and its mode where it isn't the default. */
export type Files = Record<string, string | { text: string; mode: number }>;
export const folderOf = (box: Box, tool: Tool, name = 'notes') => join(box.home, roots[tool], name);
/** Writes a skill's folder in one tool: `files` (SKILL.md by default), and `empty` folders. */
export async function put(box: Box, tool: Tool, files: Files = { 'SKILL.md': skillText() }, empty: string[] = [], name = 'notes') {
  const dir = folderOf(box, tool, name);
  await mkdir(dir, { recursive: true });
  for (const folder of empty) await mkdir(join(dir, folder), { recursive: true });
  for (const [path, file] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), typeof file === 'string' ? file : file.text);
    if (typeof file !== 'string') await chmod(join(dir, path), file.mode);
  }
}
/**
 * A folder byte for byte, as a test compares it: each file's text and mode, each folder (empty ones too), each link and where
 * it leads; undefined when nothing is there.
 */
export async function bytes(path: string): Promise<Record<string, string> | undefined> {
  const top = await lstat(path).catch(() => undefined);
  if (!top) return undefined;
  const found: Record<string, string> = {};
  const visit = async (dir: string, prefix: string) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((first, second) => first.name.localeCompare(second.name))) {
      const at = join(dir, entry.name), name = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) found[name] = 'link';
      else if (entry.isDirectory()) { found[`${name}/`] = ((await stat(at)).mode & 0o777).toString(8); await visit(at, `${name}/`); }
      else found[name] = `${((await stat(at)).mode & 0o777).toString(8)} ${await readFile(at, 'utf8')}`;
    }
  };
  if (top.isSymbolicLink()) return { '': 'link' };
  await visit(path, '');
  return found;
}
/** Every managed tool's folder for the skill, byte for byte. */
export const everywhere = async (box: Box, name = 'notes') =>
  Object.fromEntries(await Promise.all((Object.keys(roots) as Tool[]).map(async tool => [tool, await bytes(folderOf(box, tool, name))] as const)));
export const historyOf = async (box: Box, context = box.context, key = 'notes') => (await readHistory(context)).filter(event => event.key === key);
/** A plain pass, as the background runs it. */
export const pass = (box: Box, context = box.context) => applySkills(context, box.tools, [], { background: true });

/** The skill as the Skills page reads it: its row's facts, and its item in the library (deleted or not). */
export async function seen(box: Box, context = box.context, key = 'notes'): Promise<{ fact?: LibraryFacts; item?: LibraryItem; row: LibraryRow }> {
  const view = await skillsView(context, box.tools);
  const fact = view.items.find(entry => entry.key === key);
  const hashes = Object.fromEntries(Object.entries(fact?.copies ?? {}).map(([tool, copy]) => [tool, copy!.hash]));
  return { fact, item: view.library[key], row: { key, name: fact?.name, hashes, plan: fact?.plan, cannot: fact?.cannot, unseen: fact?.unseen, takeInAnswers: fact?.takeInAnswers, anotherWay: fact?.anotherWay } };
}
export const itemOf = async (box: Box, key = 'notes') => (await seen(box, box.context, key)).item;

export const send = (box: Box, change: Change, context = box.context) => applySkills(context, box.tools, [change]);
/** The row's switch, On. A found skill whose copies differ opens the copy question instead: `choose` answers it. */
export async function turnOn(box: Box, context = box.context, key = 'notes'): Promise<PassResult | 'choose'> {
  const { row, item } = await seen(box, context, key);
  return asksWhichCopy(row) ? 'choose' : send(box, rowClicks.on(row, item), context);
}
export const choose = async (box: Box, use: Tool, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.on(row, item, use), context); };
export const turnOff = async (box: Box, context = box.context, key = 'notes') => { const { row, item } = await seen(box, context, key); return send(box, rowClicks.off(row, item), context); };
/** A tool's own switch in the opened row: kept out of it (`out`), or let in again. */
export const inTool = async (box: Box, tool: Tool, out: boolean, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.inHarness(row, item, tool, out), context); };
export const makeCurrent = async (box: Box, hash: string, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.makeCurrent(row, item, hash), context); };
export const remove = async (box: Box, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.remove(row, item), context); };
/** A History entry's action (its version choice with `version`), as History's button sends it. */
export const restore = (box: Box, eventId: string, version?: string, context = box.context) => restoreSkill(context, box.tools, eventId, version);

/** Every action History offers on the skill's entries (its main one, and each copy choice), as History's buttons send them. */
export async function historyActions(box: Box, context = box.context, key = 'notes') {
  const { item, fact } = await seen(box, context, key);
  return (await historyOf(box, context, key)).flatMap(event => {
    const main = libraryAction(event, item, { managed: box.tools, edited: fact?.edited ?? [] }, undefined, fact?.loads);
    const run = (version?: string) => () => restoreSkill(context, box.tools, event.id, version);
    return [...(main ? [{ event, label: main.label, run: run() }] : []), ...versionChoices(event, item).map(choice => ({ event, label: `Use ${choice.tool}’s`, run: run(choice.hash) }))];
  });
}
/** A click's Undo (app.ts undoClick): the History action of each entry the click made. */
export async function undo(box: Box, click: PassResult, context = box.context) {
  const done: PassResult[] = [];
  for (const id of click.made ?? []) done.push(await restoreSkill(context, box.tools, id));
  return done;
}

type Entry = { is: 'dir'; mode: number; at: Date } | { is: 'file'; text: Buffer; mode: number; at: Date } | { is: 'link'; to: string };
/** Every entry under a folder as it is: folders (empty ones too), files with their bytes, links where they lead; with modes and times. */
async function entriesUnder(root: string, found = new Map<string, Entry>()) {
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name), info = await lstat(path);
    if (info.isSymbolicLink()) found.set(path, { is: 'link', to: await readlink(path) });
    else if (info.isDirectory()) { found.set(path, { is: 'dir', mode: info.mode & 0o777, at: info.mtime }); await entriesUnder(path, found); }
    else found.set(path, { is: 'file', text: await readFile(path).catch(() => Buffer.alloc(0)), mode: info.mode & 0o777, at: info.mtime });
  }
  return found;
}
/**
 * Runs `body` on the home as it is, then puts every entry back as it was, folder times too (a skill's time is its latest
 * one): what is new goes, what went comes back. A folder that stayed is never made again, so a tool's skills folder keeps
 * the identity Central Knot noted.
 */
export async function trial<T>(box: Box, body: () => Promise<T>): Promise<T> {
  const before = await entriesUnder(box.base);
  try { return await body(); }
  finally {
    const after = await entriesUnder(box.base);
    const deepestFirst = (paths: string[]) => paths.sort((first, second) => second.split('/').length - first.split('/').length);
    for (const path of deepestFirst([...after.keys()])) {
      const was = before.get(path), now = after.get(path)!;
      if (!was || was.is !== now.is || (was.is === 'link' && now.is === 'link' && was.to !== now.to)) await rm(path, { recursive: true, force: true });
    }
    for (const [path, was] of [...before].sort(([first], [second]) => first.split('/').length - second.split('/').length)) {
      const now = await lstat(path).catch(() => undefined);
      if (was.is === 'dir') { if (!now) await mkdir(path); await chmod(path, 0o755); }
      else if (was.is === 'link') { if (!now) await symlink(was.to, path); }
      else if (!now || !(await readFile(path)).equals(was.text) || (now.mode & 0o777) !== was.mode || now.mtime.getTime() !== was.at.getTime()) {
        if (now) await chmod(path, 0o644);
        await writeFile(path, was.text); await chmod(path, was.mode); await utimes(path, was.at, was.at);
      }
    }
    for (const path of deepestFirst([...before.keys()])) { const was = before.get(path)!; if (was.is === 'dir') { await chmod(path, was.mode); await utimes(path, was.at, was.at); } }
  }
}


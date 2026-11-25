// What every engine stands on (MAP.md, "The store and safe writes"):
// - the home's store, `.central-knot/` (storeDirectory), and its sync record, sync.json (SyncRecord: the build it names, the
//   tools left out, Synchronize everything), read and saved (readRecord, saveRecord); only takeOverSync changes the build it
//   names, and only main.ts takeOverHome calls it;
// - two gates: writeAccess, whether this window may write this home at all (the real home only when chosen; nothing while this
//   build is held by another: ShareContext held), and the gate for
//   library writes (libraryGate), the one answer to "may this write of the library happen now", which asks writeAccess and
//   syncGate (whether the record can be read and saved, is the one this build remembers, or waits for Resume). A write of the library
//   asks libraryGate, never the two apart; the views read them apart, to say why on the page;
// - checked writes: a tool's file written or removed only while it holds what was read (writeFileChecked, removeFileChecked,
//   with a file moved aside put back: recoverParked), and Central Knot's own files written whole (writeDurably), or kept beside
//   themselves where they can't be read (keepUnreadable); and a wait for Resume held in memory (ShareContext resumeFirst);
// - on Windows only, a rename, link or removal another program holds up for a moment tried again for about a second
//   (retryWhileHeld, used by the writes here and by skillfiles.ts), and a refusal that stays in words (plainError);
// - a skill's folder read as one content (readTree), copied byte for byte (copyTree), staged beside its target and put in
//   place (stagingFolder, placeCopy).
// Not here: a kind's record (kindstore.ts and each kind's store), History (history.ts), a tool's folders and files
// (skillfiles.ts, mcp.ts, agentfiles.ts), and which tools are managed (presence.ts managedTools).
//
// Who enters the gate for library writes. A click that writes the library, the home's sync record or a tool's own switch for a
// library item by its own hand (a profile switch and its Undo, a Manage switch, Synchronize everything's switch, a skill's Take
// over, Clear the switch and its Undo, a source's Add and Check now: sources.ts) enters it once its own refusals are past. A
// pass enters it before it reads its clicks (librarypass.ts runPass), so an item list's click that the pass then refuses has
// still made the record of a home with none, or resumed one that waited. What checks before such a write starts (Pull, Push,
// Synchronize everything's Undo and Restore, the Undo of a Pull's change to Claude Code's settings, the profiles migration)
// asks it without entering, which makes and remembers nothing but still lifts a format 2 record; what writes a file of Central
// Knot's own alone asks it for that (`ownFile`: profiles.json, a source's Look and Remove). Writes that are not the library's
// ask writeAccess alone: the record taken over (takeOverSync, which changes the build it names), another build of the app, the
// Git repo's connection, instructions, and plugins, whose page also asks liftFirst before it writes (marketplaces.ts guard,
// recordFor); syncsHere is whether this build syncs the home at all (the background pass, History kept tidy).
import { createHash, randomUUID } from 'node:crypto';
import { STANDARD_BUILD, PRODUCT } from './values.ts';
import { createReadStream } from 'node:fs';
import { access, chmod, constants, copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { configRoot, harnessIds, harnesses, writeRoot } from './harnesses.ts';
import { instructionFiles } from './instructions.ts';
import { displayPath } from './machine.ts';
import { mcpFile } from './mcp.ts';
import { managedTools } from './presence.ts';
import type { HarnessId, HistoryDays, HomeMode, PlanTarget, Skill, Snapshot, SyncGate, WriteAccess } from './types.ts';
import type { KeptReads } from './librarypass.ts';
import type { ToolWays } from './reload.ts';

/**
 * sync.json's format (SyncRecord). Format 3 is format 2 written by a build that knows a sixth tool (Antigravity): a build that
 * knows five (0.7.0 alpha 5 and earlier) reads any later format as written by a newer Central Knot and stops syncing the home.
 * libraryGate lifts a format 2 record before a write; format 1 is read until the skills migration (skillstore.ts) writes this one.
 */
export const FORMAT_VERSION = 3;
/** A text's SHA-256, hex: what Central Knot names content by. */
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const STAGE_PREFIX = '.ck-stage-';
const STAGE_NAME = /^\.ck-stage-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Finder drops these into any folder it opens; they are no change to a skill. */
const NOISE = new Set(['.DS_Store']);
/** Editor leftovers while a file is open (Vim swap and test files, Emacs locks and autosaves, backups): never content, never a link to refuse. */
const editorNoise = (name: string) => /^\..*\.sw[a-p]$/.test(name) || /^\.#/.test(name) || /^#.*#$/.test(name) || /~$/.test(name) || name === '4913';

/** A build's identity, and where this build remembers which record it owns. */
export interface ShareContext {
  home: string;
  mode: HomeMode;
  /** Always reads disk, so every plan and result reflects what is there now. */
  read: () => Promise<Snapshot[]>;
  build: string;
  /** What this build calls itself, written into a record it owns so another build can say whose it is. */
  buildName?: string;
  settingsPath: string;
  /** The person's real home, written only when reached by explicitly choosing it. */
  realHome: string;
  /** Whether the real home may be written: where machine.ts writesRealHome says (macOS and Linux), never in a smoke test (main.ts). */
  allowActualWrites?: boolean;
  /** Why nothing at all may be written now: another build of Central Knot is on this Mac, one install at a time (main.ts heldReason). Unset: not held. */
  held?: string;
  /**
   * A wait for Resume this build holds in memory for the home, whatever its record or this build's memory of it would say (main.ts
   * startHome): while it has a reason, syncGate says the home waits, after its stops; a Resume let in ends it (libraryGate).
   */
  resumeFirst?: { reason?: string };
  overrides?: Partial<Record<HarnessId, string>>;
  /** How each tool was found here (CLI, desktop app, or both), for reload advice (reload.ts). */
  ways?: ToolWays;
  /** Reads shared within one pass or one view (what each tool has through its plugins): set only on a context made for that one use. */
  reads?: Map<string, Promise<unknown>>;
  /** Each kind's read its pass of the whole home left standing, for the view made right after, whose look takes it (librarypass.ts KeptReads, lookFor): main.ts pass and syncAndView only. */
  kept?: KeptReads;
  /** Test seam: throws at a named step, standing in for a crash. */
  fault?: (step: 'before-rename' | 'after-rename' | 'before-replace' | 'mid-replace' | 'before-remove' | 'parts-kind-saved' | 'parts-before-rename') => void;
  /** The clock for observation intervals (CON-04); tests pass their own. */
  now?: () => number;
  /** How many days History keeps events, and deleted items' content (STO-04); the default unless Settings says otherwise. */
  historyDays?: HistoryDays;
  /**
   * How long a copy must stay missing before it counts as deleted, so an atomic save is not a deletion (SYN-04). Unset, a
   * pass waits 2 s (librarypass.ts runPass); tests pass 0.
   */
  settleMs?: number;
}

/**
 * The home's sync record (sync.json): the build it names (`owner`: the one that made it or last took it over; older builds
 * stop where it names another, this one only rewrites it, main.ts takeOverHome), the generation it remembers, the tools
 * left out of Central Knot's care here (`leftOut`), and whether its standing rule is on (`syncEverything`). Format 3
 * (FORMAT_VERSION), whose fields are format 2's. Format 1 also held the skills, with `items`, `roots` and more: skillstore.ts
 * moves them into the library and writes format 3 (sync.v1.json keeps the earlier file); until it has, those fields are carried
 * through every save as they are.
 */
export interface SyncRecord { formatVersion: number; generation: string; owner: string; /** The owner's own name, as people know it (a record made before there were custom builds has none). */ ownerName?: string;
  /**
   * The tools whose Manage switch is off here (toolchoice.ts chooseTools): installed or not, Central Knot writes nothing in
   * them. Every other installed tool is managed (presence.ts managedTools), so a tool installed later is managed by itself,
   * and a record with none (every record made before the switch) manages every installed tool.
   */
  leftOut?: HarnessId[];
  /**
   * Synchronize everything: a skill, MCP server or agent found in a managed tool is taken in and turned On by itself (library.ts
   * FOUND; librarypass.ts takeInByRule). Absent until first answered (first setup asks then: firstsetup.ts), which works as off;
   * set by everything.ts setSyncEverything alone, and by its one Undo.
   */
  syncEverything?: boolean }

export function storeDirectory(home: string): string { return join(home, '.central-knot'); }
const recordPath = (home: string) => join(storeDirectory(home), 'sync.json');

export { itemKey } from './library.ts';

export const errorCode = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '');

/** What Windows answers while another program has a file open a moment, and for a read-only file or one not permitted alike. */
const HELD_CODES = ['EPERM', 'EBUSY'];

/** An error in plain words. On Windows, HELD_CODES can't tell a file held open from a read-only one or one not permitted. */
export function plainError(error: unknown, platform: NodeJS.Platform = process.platform): string {
  const code = errorCode(error);
  if (platform === 'win32' && HELD_CODES.includes(code)) return HELD_ON_WINDOWS;
  if (code === 'EACCES' || code === 'EPERM') return 'Permission was denied.';
  if (code === 'ENOSPC') return 'The disk is full.';
  if (code === 'EROFS') return 'That folder is read-only.';
  if (code === 'ENAMETOOLONG') return 'A file name is too long for this disk.';
  if (code === 'EXDEV') return 'That folder is on a different disk from its parent.';
  if (code === 'CK_EXISTS') return 'Something appeared at the destination, so it was left alone.';
  return 'It could not finish.';
}
const HELD_ON_WINDOWS = 'Windows couldn’t change this file or folder. Check whether it’s in use or read-only and whether you have permission, then try again.';

/** The waits between tries of a change Windows refused (retryWhileHeld; removeTree's rm, as Node's own), in ms: one second in all. */
const HELD_WAITS = [100, 200, 300, 400];

/**
 * Runs `change` (a rename, a link or a removal) and, on Windows only, runs it again where it failed with EPERM or EBUSY, which
 * Windows gives while another program has the file open a moment (an antivirus scan, a tool's own open file): five tries in all,
 * HELD_WAITS apart, then the last error. Before each further try `stillSo` is asked: it throws where what the change relies on
 * no longer holds (a save made meanwhile), and that ends it. Each call waits by itself. Off Windows it is `change()`'s own promise.
 */
export function retryWhileHeld<T>(change: () => Promise<T>, stillSo?: () => Promise<void>, platform: NodeJS.Platform = process.platform): Promise<T> {
  if (platform !== 'win32') return change();
  const attempt = async (waits: number[]): Promise<T> => {
    try { return await change(); }
    catch (error) {
      if (!waits.length || !HELD_CODES.includes(errorCode(error))) throw error;
      await new Promise(done => setTimeout(done, waits[0]));
      await stillSo?.();
      return attempt(waits.slice(1));
    }
  };
  return attempt(HELD_WAITS);
}

// ---------- Trees ----------

export interface Tree { hash: string; files: Map<string, { sha256: string; mode: number }>; directories: string[]; held?: string }

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Files no tool's copy keeps (Finder's .DS_Store, editor swap and backup files): left out of every copy and every identity. */
export const notCopied = (name: string, isFile: boolean) => (NOISE.has(name) && isFile) || editorNoise(name);

/** Whole-directory identity. Only the executable bit counts, so umask differences are no collision. */
export async function readTree(directory: string, options: { includeGit?: boolean } = {}): Promise<Tree> {
  const files: Tree['files'] = new Map();
  const directories: string[] = [];
  let held: string | undefined;
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if ((entry.name === '.git' && !options.includeGit) || notCopied(entry.name, entry.isFile())) continue;
      const path = join(current, entry.name);
      const relativePath = displayPath(relative(directory, path));
      if (entry.isSymbolicLink()) { held ??= `It contains a link (${relativePath}), and Central Knot creates and follows no links here. Replace the link with the file it leads to, then Refresh.`; files.set(relativePath, { sha256: 'link', mode: 0 }); }
      else if (entry.isDirectory()) { directories.push(relativePath); await visit(path); }
      else if (entry.isFile()) files.set(relativePath, { sha256: await hashFile(path), mode: (await stat(path)).mode & 0o777 });
      else { held ??= `It contains a special file (${relativePath}). Move it out of the folder, then Refresh.`; files.set(relativePath, { sha256: 'special', mode: 0 }); }
    }
  }
  await visit(directory);
  const hash = createHash('sha256');
  for (const name of [...directories].sort()) hash.update(`d\0${name}\n`);
  for (const name of [...files.keys()].sort()) { const file = files.get(name)!; hash.update(`f\0${name}\0${file.mode & 0o111 ? 'x' : '-'}\0${file.sha256}\n`); }
  return { hash: hash.digest('hex'), files, directories, held };
}

/** Byte-exact copy with modes, without nested .git (SKL-01). The top folder keeps its write bit: a read-only folder cannot be moved into place. */
export async function copyTree(source: string, target: string, tree: Tree) {
  await mkdir(target);
  for (const name of [...tree.directories].sort()) await mkdir(join(target, name));
  for (const [name, file] of tree.files) {
    await copyFile(join(source, name), join(target, name), constants.COPYFILE_EXCL);
    await chmod(join(target, name), file.mode);
  }
  for (const name of [...tree.directories].sort().reverse()) await chmod(join(target, name), (await stat(join(source, name))).mode & 0o777);
}

export const finishCopy = async (source: string, target: string) => chmod(target, (await stat(source)).mode & 0o777);

/** A file's last-modified time, as the pages show it (ToolCopy.modified); none when it can't be read. */
export const fileTime = (path: string) => stat(path).then(info => info.mtime.toISOString(), () => undefined);
/** Gives a file put back by an Undo the edit time it had: it back-dates the real file's modification time, so the copy question's "most recent" mark points where it did. A failure is let go. */
export const giveFileTime = async (path: string, at: string | undefined) => { if (at) await utimes(path, new Date(), new Date(at)).catch(() => undefined); };

/** Removes a folder CK owns, even one with read-only folders inside. */
export async function removeTree(path: string) {
  // A link is removed as a link: nothing it points to is touched.
  const top = await lstat(path).catch(() => undefined);
  if (!top) return;
  if (top.isSymbolicLink()) { await rm(path, { force: true }); return; }
  const openUp = async (directory: string) => {
    await chmod(directory, ((await lstat(directory)).mode & 0o777) | 0o700);
    for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory()) await openUp(join(directory, entry.name));
  };
  await openUp(path);
  // Windows refuses a file another program has open a moment: Node's own tries, each retryDelay longer, are HELD_WAITS.
  const held = process.platform === 'win32' ? { maxRetries: HELD_WAITS.length, retryDelay: HELD_WAITS[0] } : {};
  await rm(path, { recursive: true, force: true, ...held });
}

const copilotLosses: Record<string, string> = {
  paths: 'Copilot CLI ignores `paths`, so the skill applies more widely.',
  'user-invocable: false': 'Copilot CLI ignores `user-invocable: false`, so the model is still offered it.',
  'disable-model-invocation: true': 'Copilot CLI hides it from the model, and `/name` failed in print mode.',
};

/** Whether `harness` loads a skill of this shape, and why not (`skipped`, worded the same way for every tool where the reason is the same). */
export function targetFor(harness: HarnessId, directory: string, source: Skill): PlanTarget {
  switch (harness) {
    case 'copilot-cli':
      if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'Copilot CLI does not load a skill in a folder starting with a dot.' };
      if (!source.hasFrontmatter) return { harness, directory, limits: [], skipped: 'Copilot CLI will not load a skill with no YAML frontmatter.' };
      if (source.copilotProblem) return { harness, directory, limits: [], skipped: `Copilot CLI will not load it: ${source.copilotProblem}.` };
      return { harness, directory, limits: source.metadataKeys.map(key => copilotLosses[key]) };
    case 'codex-cli':
      if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'Codex does not load a skill in a folder starting with a dot.' };
      if (!source.hasFrontmatter) return { harness, directory, limits: [], skipped: 'Codex will not load a skill with no YAML frontmatter.' };
      if (source.codexProblem) return { harness, directory, limits: [], skipped: `Codex will not load it: ${source.codexProblem}.` };
      return { harness, directory, limits: [] };
    case 'pi-cli':
      if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'Pi does not load a skill in a folder starting with a dot.' };
      if (!source.hasFrontmatter) return { harness, directory, limits: [], skipped: 'Pi will not load a skill with no YAML frontmatter.' };
      if (source.piProblem) return { harness, directory, limits: [], skipped: `Pi will not load it: ${source.piProblem}.` };
      return { harness, directory, limits: [] };
    case 'opencode-cli':
      if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'OpenCode does not load a skill in a folder starting with a dot.' };
      if (!source.hasFrontmatter) return { harness, directory, limits: [], skipped: 'OpenCode 1.x will not load a skill with no YAML frontmatter.' };
      if (source.opencodeProblem) return { harness, directory, limits: [], skipped: `OpenCode 1.x will not load it: ${source.opencodeProblem}.` };
      return { harness, directory, limits: [] };
    // What Antigravity refuses in a skill was not measured: it is offered every one.
    case 'antigravity-cli':
      return { harness, directory, limits: [] };
    case 'claude-cli':
      return { harness, directory, limits: [], note: source.metadataKeys.length ? `${source.metadataKeys.join(', ')}: effect not tested in Claude Code.` : undefined };
  }
}

// ---------- State ----------


const knownTool = (value: unknown) => typeof value === 'string' && Object.hasOwn(harnesses, value);

/** Where a path really is, or would be once made: its nearest existing folder resolved, plus the rest. Case-folded where the disk ignores case. */
export async function landingOf(path: string): Promise<string | undefined> {
  const rest: string[] = [];
  let current = resolvePath(path);
  for (;;) {
    try {
      const real = join(await realpath(current), ...rest.reverse());
      return process.platform === 'linux' ? real : real.toLowerCase();
    } catch (error) {
      if (errorCode(error) !== 'ENOENT' && errorCode(error) !== 'ENOTDIR') return undefined;
      const parent = dirname(current);
      if (parent === current) return undefined;
      rest.push(basename(current));
      current = parent;
    }
  }
}

export async function readRecord(home: string): Promise<{ record?: SyncRecord; problem?: string }> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: 'The sync record could not be read.' }; }
  try {
    const record = JSON.parse(text) as SyncRecord;
    if (!Number.isInteger(record?.formatVersion) || record.formatVersion < 1) return { problem: 'The sync record is damaged.' };
    if (record.formatVersion > FORMAT_VERSION) return { problem: 'The sync record was written by a newer Central Knot.' };
    if (typeof record.generation !== 'string' || typeof record.owner !== 'string'
      || (record.leftOut !== undefined && !(Array.isArray(record.leftOut) && record.leftOut.every(knownTool)))
      || (record.syncEverything !== undefined && typeof record.syncEverything !== 'boolean')) return { problem: 'The sync record is damaged.' };
    return { record };
  } catch { return { problem: 'The sync record is damaged.' }; }
}

/**
 * Keeps one of Central Knot's own files that is there and can't be read (History, its settings) beside it as
 * `<name>.unreadable-<time>.json`, so the next write never writes over it: it may be recoverable by hand. Answers where it is
 * kept; fails where it can't be moved (a folder that can't be written), and the file stays where it is.
 */
export async function keepUnreadable(path: string): Promise<string> {
  const kept = path.replace(/\.json$/, `.unreadable-${Date.now()}.json`);
  await rename(path, kept);
  return kept;
}

export async function writeDurably(path: string, text: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await retryWhileHeld(() => rename(temporary, path));
  } catch (error) {
    await retryWhileHeld(() => rm(temporary, { force: true }));
    throw error;
  }
}
/** A file changed between being read and being written: nothing is written, and the next pass reads it again. */
export const changedWhileSyncing = () => Object.assign(new Error('It changed while syncing, so it was left as it is. The next pass looks at it again.'), { code: 'CK_CHANGED' });
const occupiedError = () => Object.assign(new Error('Something that is not readable here is already at that path, so it was left alone.'), { code: 'CK_OCCUPIED' });

/**
 * Writes a tool's file only if it still holds `expected` (undefined: only if nothing is there), keeping its mode. The current file is
 * moved aside and checked there, then the new one is put in place exclusively: a save that lands meanwhile is never overwritten.
 * `inPlace`, for a file written under its tool's own lock, which the tool also reads outside it (Claude Code's: mcp.ts editEntry):
 * the file is never missing for a moment; it is checked where it is, then replaced in one rename, as the tool's own saves do. What
 * it gives up: a save made without that lock between the check and the rename is written over, not refused (mcp.ts's header says
 * both ways that gap can go, and what the person would see).
 */
export async function writeFileChecked(path: string, text: string, expected: string | undefined, inPlace = false) {
  // A settings file that is a link (dotfiles) is written where it points, so the link and its target stay as they are.
  try { if ((await lstat(path)).isSymbolicLink()) path = await realpath(path); } catch { /* new file */ }
  await mkdir(dirname(path), { recursive: true });
  let mode = 0o600;
  try { mode = (await stat(path)).mode & 0o777; } catch { /* new file */ }
  const temporary = join(dirname(path), `.${basename(path)}.ck-${randomUUID()}.tmp`);
  const parked = join(dirname(path), `.${basename(path)}.ck-${randomUUID()}.old`);
  let replaced = false;
  await writeFile(temporary, text, { mode });
  // On Windows a step waits while another program holds the file (retryWhileHeld), and stops where a save lands meanwhile: the
  // file renamed over must still hold `expected`, and the moved-aside original what was read. On Windows that original is
  // compared again before it is removed, at the first try too, since a wait here may have come between.
  const replace = () => retryWhileHeld(() => rename(temporary, path), () => stillHolds(path, expected));
  const parkedHolds = () => stillHolds(parked, expected);
  if (inPlace) {
    try {
      const now = await readFile(path, 'utf8').catch(error => { if (errorCode(error) === 'ENOENT') return undefined; throw error; });
      if (now !== expected) throw expected === undefined ? occupiedError() : changedWhileSyncing();
      return await replace();
    } finally { await retryWhileHeld(() => unlink(temporary)).catch(() => undefined); }
  }
  try {
    if (expected !== undefined) {
      try {
        await retryWhileHeld(() => rename(path, parked));
      } catch (error) {
        if (errorCode(error) === 'ENOENT') throw changedWhileSyncing();
        throw error;
      }
      let held: string | undefined;
      try { held = await readFile(parked, 'utf8'); } catch { /* checked below */ }
      if (held !== expected) { await putBack(parked, path); throw changedWhileSyncing(); }
    }
    try {
      await retryWhileHeld(() => link(temporary, path), parkedHolds);
      replaced = true;
    } catch (error) {
      // Something was saved there after the old file was moved aside: that save stays, and the old file (as read) is kept beside
      // it under a plain backup name, never deleted, since only this entry was kept in the store.
      if (errorCode(error) === 'EEXIST') throw expected === undefined ? occupiedError() : changedWhileSyncing();
      // The old file goes back first, where the new one was not linked in: no hard links on this disk (it then replaces the old
      // one the ordinary way, below), the original changed while the link waited (CK_CHANGED), or the hold stayed (EBUSY).
      if (expected !== undefined) await putBack(parked, path);
      if (errorCode(error) === 'EPERM' || errorCode(error) === 'ENOTSUP' || errorCode(error) === 'EXDEV') {
        if (expected === undefined) { try { await lstat(path); throw occupiedError(); } catch (missing) { if (errorCode(missing) !== 'ENOENT') throw missing; } }
        else if ((await readFile(path, 'utf8').catch(() => undefined)) !== expected) throw changedWhileSyncing();
        await replace();
        replaced = true;
        return;
      }
      throw error;
    }
  } finally {
    await retryWhileHeld(() => unlink(temporary)).catch(() => undefined);
    // Once its replacement is in place, the moved-aside original goes: its content was kept before the write (one changed since
    // it was read is kept as a backup, on Windows). Otherwise, if it could not go back, it is kept beside it as a backup, never deleted; even if
    // no backup can be placed, it stays for the next pass to find.
    const removal = () => retryWhileHeld(() => unlink(parked), parkedHolds);
    const keptIfChanged = (error: unknown) => (errorCode(error) === 'CK_CHANGED' ? keepAsBackup(parked, path) : undefined);
    if (expected !== undefined && !replaced) await keepAsBackup(parked, path);
    if (expected !== undefined && replaced) await (process.platform === 'win32' ? parkedHolds().then(removal) : removal()).catch(keptIfChanged);
  }
}

/** Before a further try of a write Windows refused: `path` still holds `expected` (undefined: nothing there), else it changed just now. */
async function stillHolds(path: string, expected: string | undefined) {
  const now = expected === undefined
    ? lstat(path).then(() => null, error => (errorCode(error) === 'ENOENT' ? undefined : null))
    : readFile(path, 'utf8').catch(() => null);
  if (await now !== expected) throw changedWhileSyncing();
}

/**
 * Keeps a moved-aside file beside `path` as a visible backup. Each gets its own name (time plus a random part) and is placed without
 * replacing anything, so two backups of the same file never overwrite each other. If it can't be placed, it stays where it is.
 */
async function keepAsBackup(parked: string, path: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const backup = `${path}.central-knot-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.bak`;
    try { await link(parked, backup); await unlink(parked).catch(() => undefined); return; }
    catch (error) { if (errorCode(error) !== 'EEXIST') break; }
  }
}

/** Puts a moved-aside file back where it was, never over something saved there since. True when it is back. */
async function putBack(parked: string, path: string): Promise<boolean> {
  try { await link(parked, path); await unlink(parked).catch(() => undefined); return true; }
  catch (error) {
    if (errorCode(error) === 'EEXIST') return false;
    try { await lstat(path); return false; } catch { /* still empty */ }
    try { await rename(parked, path); return true; } catch { return false; }
  }
}

/**
 * Finishes what a crash interrupted in a folder Central Knot writes single files into: a file moved aside (`.name.ck-*.old`) whose
 * place is still empty goes back, so it is never read as deleted; one whose place is taken is kept beside it as a visible
 * `<file>.central-knot-<time>.bak`, never deleted. Stray temporary files go.
 */
export async function recoverParked(folder: string) {
  let names: string[];
  try { names = await readdir(folder); } catch { return; }
  for (const name of names) {
    const parked = /^\.(.+)\.ck-[0-9a-f-]{36}\.old$/.exec(name);
    if (parked) {
      const home = join(folder, parked[1]);
      try { await link(join(folder, name), home); await unlink(join(folder, name)).catch(() => undefined); }
      catch (error) {
        if (errorCode(error) !== 'EEXIST') continue;
        // Its place is taken (the write finished, or something else saved there): kept beside it as a visible backup, never deleted.
        await keepAsBackup(join(folder, name), home);
      }
      continue;
    }
    if (/^\..+\.ck-[0-9a-f-]{36}\.tmp$/.test(name)) await unlink(join(folder, name)).catch(() => undefined);
  }
}

/** Removes a tool's file only if it still holds `expected`: moved aside and checked there, so an edit saved meanwhile is put back. */
export async function removeFileChecked(path: string, expected: string) {
  const parked = join(dirname(path), `.${basename(path)}.ck-${randomUUID()}.old`);
  await retryWhileHeld(() => rename(path, parked));
  let held: string | undefined;
  try { held = await readFile(parked, 'utf8'); } catch { /* checked below */ }
  if (held !== expected) { await putBack(parked, path); throw changedWhileSyncing(); }
  // One changed while its removal waited on Windows goes back.
  try {
    await retryWhileHeld(() => unlink(parked), () => stillHolds(parked, expected));
  } catch (error) {
    if (errorCode(error) === 'CK_CHANGED') await putBack(parked, path);
    throw error;
  }
}

/** The tools Central Knot manages in this home now: those installed, less the ones the sync record leaves out (presence.ts managedTools). */
export async function managedNow(context: ShareContext, snapshots: Snapshot[]): Promise<HarnessId[]> {
  return managedTools(snapshots, await leftOutNow(context));
}
/** The tools the sync record leaves out (SyncRecord leftOut); none where there is no record, or it can't be read. */
export const leftOutNow = async (context: ShareContext): Promise<HarnessId[]> => (await readRecord(context.home)).record?.leftOut ?? [];

/** A home's first sync record, naming this build. */
export const newRecord = (context: ShareContext): SyncRecord => ({ formatVersion: FORMAT_VERSION, generation: randomUUID(), owner: context.build, ownerName: context.buildName });

/** Saves a home's sync record whole. */
export async function saveRecord(home: string, record: SyncRecord) {
  await writeDurably(recordPath(home), `${JSON.stringify(record, null, 2)}\n`);
}

type Settings = { homes?: Record<string, { generation: string }> };
async function readSettings(path: string): Promise<Settings> {
  try { return JSON.parse(await readFile(path, 'utf8')) as Settings; } catch { return {}; }
}
export async function remember(context: ShareContext, generation: string) {
  const settings = await readSettings(context.settingsPath);
  settings.homes = { ...settings.homes, [context.home]: { generation } };
  await writeDurably(context.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}
/**
 * Lets go of this build's memory of a home it remembers by another generation of its record than `generation` (a folder it
 * synced before it was set up afresh elsewhere), so the home waits for Resume instead of stopping for good: main.ts
 * takeOverHome, where a take-over isn't carried. A memory of `generation` itself stays.
 */
export async function forgetStale(context: ShareContext, generation: string) {
  const settings = await readSettings(context.settingsPath), remembered = settings.homes?.[context.home]?.generation;
  if (!remembered || remembered === generation) return;
  const { [context.home]: _stale, ...homes } = settings.homes!;
  await writeDurably(context.settingsPath, `${JSON.stringify({ ...settings, homes }, null, 2)}\n`);
}

export const NOTHING_CHANGED = 'Nothing was written or deleted. Put the record back, then try again.';

/** What a write of the library asks of libraryGate. With none set, nothing is made or remembered; a format 2 record is lifted all the same. */
export interface Entering {
  /** It enters a write: a home with no sync record gets one, this build's, remembered as its own. */
  start?: boolean;
  /** The click is a Resume (the page showed a home waiting for one): such a home is let in and remembered. */
  resume?: boolean;
  /** It writes a file of Central Knot's own (profiles.json): a home waiting for Resume does not stop it. */
  ownFile?: boolean;
}

/**
 * The gate for library writes: whether one may happen now, else why not in plain words: a preview-only home (writeAccess),
 * a record that can't be read or isn't the one this build remembers (syncGate `stopped`), or one waiting for Resume (unless
 * `resume` or `ownFile`). Let in, it has already done what entering needs before anything is written: the record made (`start`), the
 * home remembered (`start`, `resume`), so a click that writes before its own pass never finds that pass refused; and, asked any
 * way, a format 2 record lifted to FORMAT_VERSION (knewFive), so a build that knows five tools stops syncing the home before a
 * library write of this one names a sixth (the Plugins page's writes: liftFirst). Answers the
 * home's record, where it has one (with `start`, always). A click that writes by its own hand runs its own refusals before it,
 * and enters it only to write; a pass enters it first (this file's header).
 */
export async function libraryGate(context: ShareContext, asked: Entering & { start: true }): Promise<{ refused: string } | { record: SyncRecord }>;
export async function libraryGate(context: ShareContext, asked?: Entering): Promise<{ refused: string } | { record?: SyncRecord }>;
export async function libraryGate(context: ShareContext, asked: Entering = {}): Promise<{ refused: string } | { record?: SyncRecord }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { refused: access.reason };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || (gate.state === 'needs-resume' && !asked.resume && !asked.ownFile)) return { refused: gate.reason };
  let { record } = await readRecord(context.home);
  if (!record && asked.start) { record = newRecord(context); await saveRecord(context.home, record); await remember(context, record.generation); }
  else if (record && gate.state === 'needs-resume' && asked.resume) await remember(context, record.generation);
  if (knewFive(record)) { record = { ...record, formatVersion: FORMAT_VERSION }; await saveRecord(context.home, record); }
  if (asked.resume && context.resumeFirst) context.resumeFirst.reason = undefined;
  return { record };
}

/** A record a build that knows five tools wrote (format 2), which libraryGate lifts to FORMAT_VERSION. */
const knewFive = (record: SyncRecord | undefined): record is SyncRecord => record?.formatVersion === 2;
/**
 * For a write the library's gate doesn't cover that can name a sixth tool (the Plugins page's: marketplaces.ts guard, recordFor):
 * on a home whose record knewFive, the gate is asked, which lifts it first, or why not (nothing is to be written then); on any
 * other home nothing is asked (one with no record: nothing to lift).
 */
export async function liftFirst(context: ShareContext): Promise<string | undefined> {
  if (!knewFive((await readRecord(context.home)).record)) return undefined;
  const gate = await libraryGate(context);
  return 'refused' in gate ? gate.refused : undefined;
}

/**
 * Section 3's stops: none of these turns into first setup or adopts a stale record. A record is read by its generation alone,
 * whichever build it names: one install at a time keeps two builds on this Mac apart (main.ts heldReason), and where builds
 * are looked for, the look takes a record naming another build over (main.ts takeOverHome).
 */
export async function syncGate(context: ShareContext): Promise<SyncGate> {
  const { record, problem } = await readRecord(context.home);
  if (problem) return { state: 'stopped', reason: `${problem} ${NOTHING_CHANGED}` };
  // Even a new home needs somewhere to save its first answer. A new store is created in the home.
  const store = storeDirectory(context.home);
  const folder = await exists(store) ? store : context.home;
  try { await access(folder, constants.W_OK | constants.X_OK); }
  catch (error) { return { state: 'stopped', reason: plainError(error) }; }
  const remembered = (await readSettings(context.settingsPath)).homes?.[context.home]?.generation;
  if (!record && remembered) return { state: 'stopped', reason: `The sync record this app created is missing. ${NOTHING_CHANGED}` };
  if (record && remembered && remembered !== record.generation) return { state: 'stopped', reason: `The sync record is not the one this app last used. ${NOTHING_CHANGED}` };
  if (context.resumeFirst?.reason) return { state: 'needs-resume', reason: context.resumeFirst.reason };
  if (!record) return { state: 'first-setup' };
  if (!remembered) return { state: 'needs-resume', reason: 'This app has an intact sync record but no memory of it. Resuming keeps every recorded choice.' };
  return { state: 'ready' };
}

/** The build a record names, by the name people know it by: the one it recorded, the standard app's, or failing both, its identity. */
const ownerName = (record: SyncRecord) => record.ownerName || (record.owner === STANDARD_BUILD ? PRODUCT : `Another ${PRODUCT} build (${record.owner})`);

/**
 * Re-records a home as this build's (main.ts takeOverHome, its one caller): the record names this build, by its id and its
 * name, and keeps everything else as it is, its generation, every managed item, choice and baseline with it, since the record
 * and what it keeps live in the home, not in either build. An older build, which obeys the record, stops by itself on finding
 * that it names this one. Whether this build remembers the record, so it needn't Resume, is the caller's to decide. A record that can't be read,
 * or a home that can't be written, stays as it is, with the reason. `from`: the build it named.
 */
export async function takeOverSync(context: ShareContext): Promise<{ stopped?: string; from?: string }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  const { record, problem } = await readRecord(context.home);
  if (problem) return { stopped: `${problem} ${NOTHING_CHANGED}` };
  if (!record) return { stopped: 'Nothing is synced in this home yet, so there is nothing to take over.' };
  if (record.owner === context.build) return {};
  await saveRecord(context.home, { ...record, owner: context.build, ownerName: context.buildName });
  return { from: ownerName(record) };
}

/** Whether this build syncs this home and may write it: History is kept tidy, and passes run, only where both hold. */
export async function syncsHere(context: ShareContext): Promise<boolean> {
  return (await writeAccess(context)).allowed && (await syncGate(context)).state === 'ready';
}

/** Nothing is written while this build is held; the real home only by explicitly choosing it. A simulated home that reaches it stays read-only. */
export async function writeAccess(context: ShareContext): Promise<WriteAccess> {
  if (context.held) return { allowed: false, reason: context.held };
  if (context.mode === 'actual') {
    if (!context.allowActualWrites) return { allowed: false, reason: 'Preview only: writing to real folders works only on macOS and Linux in this version. You can look around; nothing is written.' };
    for (const id of Object.keys(harnesses) as HarnessId[]) {
      const override = context.overrides?.[id];
      if (override !== undefined && !isAbsolute(override)) return { allowed: false, reason: `Preview only: ${harnesses[id].configEnv} is not an absolute path, so its folder is unknown.` };
    }
    return { allowed: true, reason: 'Your real folders: Central Knot writes here.' };
  }
  const refused = { allowed: false, reason: 'Preview only: this folder reaches your real configuration. To write there, choose your real home instead.' };
  const real = async (path: string) => { try { return await realpath(path); } catch { return undefined; } };
  const realHome = (await real(context.realHome)) ?? context.realHome;
  const realContext = { ...context, home: realHome, overrides: undefined };
  const reached = [join(realHome, '.agents'), ...harnessIds.flatMap(id => [join(realHome, harnesses[id].defaultConfig), mcpFile(realContext, id)])];
  const protectedRoots = await Promise.all(reached.map(async path => (await real(path)) ?? path));
  const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);
  const home = (await real(context.home)) ?? context.home;
  if (home === realHome || inside(realHome, home)) return refused;
  // Every folder and file this home would write, followed through links, even where it does not exist yet.
  const fold = (path: string) => (process.platform === 'linux' ? path : path.toLowerCase());
  const guarded = [...protectedRoots, join(realHome, '.central-knot')].map(fold);
  const writes = [storeDirectory(context.home), join(context.home, '.agents'), ...harnessIds.flatMap(id => {
    const root = configRoot(harnesses[id], context.home, context.overrides?.[id]);
    return [root, writeRoot(harnesses[id], context.home, context.overrides?.[id]), join(root, 'agents'), mcpFile(context, id), ...instructionFiles[id].map(name => join(root, name))];
  })];
  for (const path of writes) {
    const resolved = await landingOf(path);
    if (!resolved || guarded.some(root => inside(resolved, root))) return refused;
  }
  return { allowed: true, reason: 'Disposable home: Central Knot writes only inside it.' };
}

// ---------- Start ----------

/** Readable when the name allows it; a name too long or too odd for every disk gets a short safe form. */
export function storeFolder(key: string): string {
  if (/^[a-z0-9._-]{1,100}$/.test(key) && !/^\.+$/.test(key)) return key;
  const readable = key.replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 40);
  return `${readable || 'skill'}-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

/** Beside the skills folder, on the same volume. A folder inside it would load as a skill: Claude Code lists dot-folders too. */
export async function stagingFolder(context: ShareContext, root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const beside = dirname(await realpath(root));
  try { await access(beside, constants.W_OK); return beside; }
  catch {
    const fallback = join(storeDirectory(context.home), 'staging');
    await mkdir(fallback, { recursive: true });
    return fallback;
  }
}

/** Best effort: a leftover that cannot be cleared holds up nothing. Only names CK itself generates are touched. */
export async function clearStaleStages(context: ShareContext, roots: string[]) {
  const folders = [join(storeDirectory(context.home), 'staging')];
  for (const root of new Set(roots)) folders.push(await realpath(root).then(dirname, () => realpath(dirname(root))).catch(() => ''));
  for (const folder of new Set(folders)) {
    if (!folder) continue;
    const entries = await readdir(folder).catch(() => [] as string[]);
    await Promise.all(entries.filter(name => STAGE_NAME.test(name)).map(name => removeTree(join(folder, name)).catch(() => undefined)));
  }
}

/** Stage beside the target's folder, verify, then rename into place (FIL-01). */
export async function placeCopy(context: ShareContext, source: string, target: PlanTarget, tree: Tree) {
  const stage = join(await stagingFolder(context, dirname(target.directory)), `${STAGE_PREFIX}${randomUUID()}`);
  try {
    await copyTree(source, stage, tree);
    if ((await readTree(stage)).hash !== tree.hash) throw new Error('The staged copy did not match its source.');
    context.fault?.('before-rename');
    try { await lstat(target.directory); throw Object.assign(new Error('Something appeared at the destination.'), { code: 'CK_EXISTS' }); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    // A further try on Windows looks again first (vacant).
    await retryWhileHeld(() => rename(stage, target.directory), () => vacant(target.directory));
    await finishCopy(source, target.directory);
  } catch (error) { await removeTree(stage).catch(() => undefined); throw error; }
}

/** Throws CK_EXISTS where something is at `path` now (or lstat's own error, where it gives one other than ENOENT), as placeCopy's first look does. */
export async function vacant(path: string) {
  try { await lstat(path); } catch (error) { if (errorCode(error) === 'ENOENT') return; throw error; }
  throw Object.assign(new Error('Something appeared at the destination.'), { code: 'CK_EXISTS' });
}

export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}

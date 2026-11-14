// What every engine stands on (MAP.md, "The store and safe writes"). Among it, the gate for library writes (libraryGate), the
// one answer to "may this write of the library happen now". A click that writes the library, the home's sync record or a tool's
// own switch for a library item by its own hand (a profile switch, a Manage switch, Take over, Clear the switch, Convert, a
// source's Add and Check now: sources.ts) enters
// it once its own refusals are past. A pass enters it before it reads its clicks (librarypass.ts runPass), so an item page's
// click that the pass then refuses has still made the record of a home with none, or resumed one that waited. What checks before
// such a write starts (Pull, Push, a History action that runs no pass of its own, the profiles migration) only asks it; what
// writes a file of Central Knot's own alone asks it for that (`ownFile`: profiles.json, a source's Look and Remove). It is not the gate for every write: reads, taking over syncing (takeOverSync, which
// changes the owner), another build of the app, the Git repo's connection, instructions and plugins ask writeAccess alone;
// syncsHere is whether this build syncs the home at all (the background pass, History kept tidy).
import { createHash, randomUUID } from 'node:crypto';
import { STANDARD_BUILD, PRODUCT } from './values.ts';
import { createReadStream } from 'node:fs';
import { access, chmod, constants, copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { configRoot, harnessIds, harnesses, writeRoot } from './harnesses.ts';
import { instructionFiles } from './instructions.ts';
import { itemKey as itemKeyOf } from './library.ts';
import { mcpFile } from './mcp.ts';
import { managedTools } from './presence.ts';
import type { HarnessId, HistoryDays, HomeMode, PartKind, PartsInstall, PlanTarget, Skill, Snapshot, SyncGate, WriteAccess } from './types.ts';

/** sync.json's format (SyncRecord); format 1 is read until the skills migration (skillstore.ts) writes format 2. */
export const FORMAT_VERSION = 2;
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
  /** Real-home writes are on only where Nathan accepted them: macOS, and never in a smoke test. */
  allowActualWrites?: boolean;
  overrides?: Partial<Record<HarnessId, string>>;
  /** Reads shared within one pass or one view (what each tool has through its plugins): set only on a context made for that one use. */
  reads?: Map<string, Promise<unknown>>;
  /** Test seam: throws at a named step, standing in for a crash. */
  fault?: (step: 'before-rename' | 'after-rename' | 'before-replace' | 'mid-replace' | 'before-remove') => void;
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
 * The home's sync record (sync.json): which build syncs this home (`owner`, ORG-08), the generation it remembers, the tools
 * left out of Central Knot's care here (`leftOut`), and whether its standing rule is on (`syncEverything`). Format 2. Format 1
 * also held the skills, with `items`, `roots` and more: skillstore.ts moves them into the library and writes format 2
 * (sync.v1.json keeps the earlier file); until it has, those fields are carried through every save as they are.
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
/** Where the plugins' parts are recorded (parts.ts writes it): which plugin's parts went into which tool as separate items. */
export const partsRecordPath = (home: string) => join(storeDirectory(home), 'plugin-parts.json');
/** Every plugin's parts on record, by plugin and tool; none when there is no record or it can't be read. */
export async function readParts(home: string): Promise<PartsInstall[]> {
  try {
    const parsed = JSON.parse(await readFile(partsRecordPath(home), 'utf8'));
    return Array.isArray(parsed?.installs) ? parsed.installs : [];
  } catch { return []; }
}
const recordPath = (home: string) => join(storeDirectory(home), 'sync.json');

export { itemKey } from './library.ts';

/**
 * The managed tools each item of one kind went into as a plugin's part, by the item's key (readParts; a part the person took
 * out since is left out). What a skill's or an agent's read gives the pass as librarypass.ts Disk.parts.
 */
export async function partsIn(home: string, kind: PartKind): Promise<Map<string, HarnessId[]>> {
  const found = new Map<string, HarnessId[]>();
  for (const install of await readParts(home)) for (const part of install.items) {
    if (part.kind !== kind || part.removed) continue;
    const key = itemKeyOf(part.name);
    found.set(key, [...(found.get(key) ?? []), install.tool]);
  }
  return found;
}

export const errorCode = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '');

export function plainError(error: unknown): string {
  const code = errorCode(error);
  if (code === 'EACCES' || code === 'EPERM') return 'Permission was denied.';
  if (code === 'ENOSPC') return 'The disk is full.';
  if (code === 'EROFS') return 'That folder is read-only.';
  if (code === 'ENAMETOOLONG') return 'A file name is too long for this disk.';
  if (code === 'EXDEV') return 'That folder is on a different disk from its parent.';
  if (code === 'CK_EXISTS') return 'Something appeared at the destination, so it was left alone.';
  // Another build took over syncing meanwhile (stillOwned): its own words say what happened.
  if (code === 'CK_TAKEN') return (error as Error).message;
  return 'It could not finish.';
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
      const relativePath = relative(directory, path).split(sep).join('/');
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
  await rm(path, { recursive: true, force: true });
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

export async function writeDurably(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
/** A file changed between being read and being written: nothing is written, and the next pass reads it again. */
export const changedWhileSyncing = () => Object.assign(new Error('It changed while syncing, so it was left as it is. The next pass looks at it again.'), { code: 'CK_CHANGED' });
const occupiedError = () => Object.assign(new Error('Something that is not readable here is already at that path, so it was left alone.'), { code: 'CK_OCCUPIED' });

/**
 * Writes a tool's file only if it still holds `expected` (undefined: only if nothing is there), keeping its mode. The current file is
 * moved aside and checked there, then the new one is put in place exclusively: a save that lands meanwhile is never overwritten.
 */
export async function writeFileChecked(path: string, text: string, expected: string | undefined) {
  // A settings file that is a link (dotfiles) is written where it points, so the link and its target stay as they are.
  try { if ((await lstat(path)).isSymbolicLink()) path = await realpath(path); } catch { /* new file */ }
  await mkdir(dirname(path), { recursive: true });
  let mode = 0o600;
  try { mode = (await stat(path)).mode & 0o777; } catch { /* new file */ }
  const temporary = join(dirname(path), `.${basename(path)}.ck-${randomUUID()}.tmp`);
  const parked = join(dirname(path), `.${basename(path)}.ck-${randomUUID()}.old`);
  let replaced = false;
  await writeFile(temporary, text, { mode });
  try {
    if (expected !== undefined) {
      try { await rename(path, parked); } catch (error) { if (errorCode(error) === 'ENOENT') throw changedWhileSyncing(); throw error; }
      let held: string | undefined;
      try { held = await readFile(parked, 'utf8'); } catch { /* checked below */ }
      if (held !== expected) { await putBack(parked, path); throw changedWhileSyncing(); }
    }
    try { await link(temporary, path); replaced = true; }
    catch (error) {
      // Something was saved there after the old file was moved aside: that save stays, and the old file (as read) is kept beside
      // it under a plain backup name, never deleted, since only this entry was kept in the store.
      if (errorCode(error) === 'EEXIST') throw expected === undefined ? occupiedError() : changedWhileSyncing();
      // No hard links on this disk: the old file goes back first, then the new one replaces it the ordinary way.
      if (expected !== undefined) await putBack(parked, path);
      if (errorCode(error) === 'EPERM' || errorCode(error) === 'ENOTSUP' || errorCode(error) === 'EXDEV') {
        if (expected === undefined) { try { await lstat(path); throw occupiedError(); } catch (missing) { if (errorCode(missing) !== 'ENOENT') throw missing; } }
        else if ((await readFile(path, 'utf8').catch(() => undefined)) !== expected) throw changedWhileSyncing();
        await rename(temporary, path);
        replaced = true;
        return;
      }
      throw error;
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
    // Once its replacement is in place, the moved-aside original goes: its content was kept before the write. Otherwise, if it could
    // not go back, it is kept beside it as a backup, never deleted; even if no backup can be placed, it stays for the next pass to find.
    if (expected !== undefined) await (replaced ? unlink(parked).catch(() => undefined) : keepAsBackup(parked, path));
  }
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
  await rename(path, parked);
  let held: string | undefined;
  try { held = await readFile(parked, 'utf8'); } catch { /* checked below */ }
  if (held !== expected) { await putBack(parked, path); throw changedWhileSyncing(); }
  await unlink(parked);
}

/** The tools Central Knot manages in this home now: those installed, less the ones the sync record leaves out (presence.ts managedTools). */
export async function managedNow(context: ShareContext, snapshots: Snapshot[]): Promise<HarnessId[]> {
  return managedTools(snapshots, await leftOutNow(context));
}
/** The tools the sync record leaves out (SyncRecord leftOut); none where there is no record, or it can't be read. */
export const leftOutNow = async (context: ShareContext): Promise<HarnessId[]> => (await readRecord(context.home)).record?.leftOut ?? [];

/** A home's first sync record, owned by this build. */
export const newRecord = (context: ShareContext): SyncRecord => ({ formatVersion: FORMAT_VERSION, generation: randomUUID(), owner: context.build, ownerName: context.buildName });

/**
 * Stops work under way once another build has taken over syncing this home (takeOverSync): the record on disk is then
 * under another owner than `owner`, the one this work began with. Asked before each save of the record and before each
 * item of a pass, so a pass that was already running writes nothing more and never takes ownership back by finishing.
 */
export async function stillOwned(home: string, owner: string): Promise<void> {
  const onDisk = await readFile(recordPath(home), 'utf8').then(text => JSON.parse(text) as Partial<SyncRecord>).catch(() => undefined);
  if (typeof onDisk?.owner === 'string' && onDisk.owner !== owner) throw Object.assign(new Error(`${ownerName(onDisk as SyncRecord)} took over syncing this home meanwhile, so this stopped there.`), { code: 'CK_TAKEN' });
}

/** Saves a home's sync record, unless another build has taken over since (stillOwned). `takingOver` is the one save that changes the owner. */
export async function saveRecord(home: string, record: SyncRecord, takingOver = false) {
  if (!takingOver) await stillOwned(home, record.owner);
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

export const NOTHING_CHANGED = 'Nothing was written or deleted. Put the record back, then try again.';

/** What a write of the library asks of libraryGate. With none set, it only asks: nothing is made or remembered. */
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
 * another build's record or one that can't be read (syncGate `stopped`), or one waiting for Resume (unless `resume` or
 * `ownFile`). Let in, it has already done what entering needs before anything is written: the record made (`start`), the
 * home remembered (`start`, `resume`), so a click that writes before its own pass never finds that pass refused. Answers the
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
  return { record };
}

/** Section 3's stops: none of these turns into first setup or adopts a stale record. */
export async function syncGate(context: ShareContext): Promise<SyncGate> {
  const { record, problem } = await readRecord(context.home);
  if (problem) return { state: 'stopped', reason: `${problem} ${NOTHING_CHANGED}` };
  const remembered = (await readSettings(context.settingsPath)).homes?.[context.home]?.generation;
  if (!record) return remembered ? { state: 'stopped', reason: `The sync record this app created is missing. ${NOTHING_CHANGED}` } : { state: 'first-setup' };
  // One build syncs a home at a time (ORG-08). Another build's home is left alone until this one is told to take over.
  if (record.owner !== context.build) {
    const name = ownerName(record);
    return { state: 'stopped', reason: `${name} syncs this home, so nothing was written or deleted. Take over syncing to have ${context.buildName ?? 'this app'} sync it instead.`, owner: { build: record.owner, name } };
  }
  if (!remembered) return { state: 'needs-resume', reason: 'This app has an intact sync record but no memory of it. Resuming keeps every recorded choice.' };
  if (remembered !== record.generation) return { state: 'stopped', reason: `The sync record is not the one this app last used. ${NOTHING_CHANGED}` };
  return { state: 'ready' };
}

/** The build that owns a record, by the name people know it by: the one it recorded, the standard app's, or failing both, its identity. */
const ownerName = (record: SyncRecord) => record.ownerName || (record.owner === STANDARD_BUILD ? PRODUCT : `Another ${PRODUCT} build (${record.owner})`);

/**
 * Takes over syncing a home from the build that owns its record (ORG-08): this build becomes the owner and carries on
 * from the record as it is, every managed item, choice and baseline with it, since the record and what it keeps live in
 * the home, not in either build. The build that owned it finds another owner at its next pass and stops; it changes
 * nothing more there until it is told to take over in turn: a pass it had under way stops before its next item and at
 * its next save of the record (stillOwned), so it can't take the home back by finishing. Ownership never moves any other way. A record that can't be
 * read, or a home that can't be written, stays as it is, with the reason.
 */
export async function takeOverSync(context: ShareContext): Promise<{ stopped?: string; from?: string }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  const { record, problem } = await readRecord(context.home);
  if (problem) return { stopped: `${problem} ${NOTHING_CHANGED}` };
  if (!record) return { stopped: 'Nothing is synced in this home yet, so there is nothing to take over.' };
  if (record.owner === context.build) return {};
  await saveRecord(context.home, { ...record, owner: context.build, ownerName: context.buildName }, true);
  await remember(context, record.generation);
  return { from: ownerName(record) };
}

/** Whether this build syncs this home and may write it: History is kept tidy, and passes run, only where both hold. */
export async function syncsHere(context: ShareContext): Promise<boolean> {
  return (await writeAccess(context)).allowed && (await syncGate(context)).state === 'ready';
}

/** The real home is written only by explicitly choosing it. A simulated home that reaches it stays read-only. */
export async function writeAccess(context: ShareContext): Promise<WriteAccess> {
  if (context.mode === 'actual') {
    if (!context.allowActualWrites) return { allowed: false, reason: 'Preview only: writing to real folders works only on macOS in this version. You can look around; nothing is written.' };
    for (const id of Object.keys(harnesses) as HarnessId[]) {
      const override = context.overrides?.[id];
      if (override !== undefined && !isAbsolute(override)) return { allowed: false, reason: `Preview only: ${harnesses[id].configEnv} is not an absolute path, so its folder is unknown.` };
    }
    return { allowed: true, reason: 'Your real folders: Apply all writes here.' };
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
  return { allowed: true, reason: 'Disposable home: Apply all writes only inside it.' };
}

// ---------- Start ----------

/** Readable when the name allows it; a name too long or too odd for every disk gets a short safe form. */
export function storeFolder(key: string): string {
  if (/^[a-z0-9._-]{1,100}$/.test(key) && !/^\.+$/.test(key)) return key;
  const readable = key.replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 40);
  return `${readable || 'skill'}-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

/** Where a skill revision is kept in Central Knot's store, by the skill's key and its content hash. */
export const storedRevision = (context: ShareContext, key: string, hash: string) => join(storeDirectory(context.home), 'items', storeFolder(key), hash);

export async function importRevision(context: ShareContext, key: string, source: string, tree: Tree) {
  const target = storedRevision(context, key, tree.hash);
  try { if ((await readTree(target)).hash === tree.hash) return; await removeTree(target); }
  catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.${randomUUID()}.tmp`;
  await copyTree(source, staging, tree);
  await rename(staging, target);
  await finishCopy(source, target);
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
    await rename(stage, target.directory);
    await finishCopy(source, target.directory);
  } catch (error) { await removeTree(stage).catch(() => undefined); throw error; }
}

export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}

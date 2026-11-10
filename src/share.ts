import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, constants, copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { configRoot, harnessIds, harnesses, pluginsOnly, writeRoot } from './harnesses.ts';
import { instructionFiles } from './instructions.ts';
import { mcpFile } from './mcp.ts';
import type { HarnessId, HistoryDays, HomeMode, PartsInstall, PlanTarget, Skill, Snapshot, SyncGate, WriteAccess } from './types.ts';

export const FORMAT_VERSION = 1;
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
  /** How long a copy must stay missing before it counts as deleted, so an atomic save is not a deletion (SYN-04). Default 2 s. */
  settleMs?: number;
}

export interface RecordCopy { harness: HarnessId; directory: string; hash: string; created: boolean; /** `removing`: a deletion could not remove this copy yet; it is retried while it still holds `hash`. */ status: 'pending' | 'written' | 'removing' }
export interface RecordItem { name: string; hash: string; state: 'shared' | 'dont-share'; startId: string; observedAt: string; copies: RecordCopy[]; /** Tools this managed skill does not sync to. */ off?: HarnessId[]; /** Differing copies kept as they are on purpose. */ separate?: boolean; /** A chosen copy not yet in every tool: the tool whose copy wins, and that copy's content ID. */ use?: { tool: HarnessId; hash: string }; /** Deleted everywhere it synced: when, from which tool, and the content it had. A copy turning up later is new input, never a revival (D-37). */ deleted?: { at: string; tool: HarnessId; hash: string };
  /** Content about to be overwritten or removed, put on record before the disk changes, so a crash or a partial failure never lets it be pruned. Cleared once History names it. */
  displaced?: { tool: HarnessId; hash: string; /** A per-tool Remove (its folder, and whether it stopped syncing there), recovered as one if History never named it. */ removal?: { folder: string; stoppedSync: boolean } }[] }
export interface SyncRecord { formatVersion: number; generation: string; owner: string; /** Each skills folder's identity at the last pass, so a folder made again reads as a reset, not as deletions. */ roots?: Record<string, { ino: number; birth: number }>; lastStartId?: string; /** Set while a Start is copying, so a crash and retry stay one Start. */ activeStartId?: string; items: Record<string, RecordItem> }

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

export function itemKey(folder: string): string { return folder.normalize('NFC').toLowerCase(); }

export const errorCode = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '');

export function plainError(error: unknown): string {
  const code = errorCode(error);
  if (code === 'EACCES' || code === 'EPERM') return 'Permission was denied.';
  if (code === 'ENOSPC') return 'The disk is full.';
  if (code === 'EROFS') return 'That folder is read-only.';
  if (code === 'ENAMETOOLONG') return 'A file name is too long for this disk.';
  if (code === 'EXDEV') return 'That folder is on a different disk from its parent.';
  if (code === 'CK_EXISTS') return 'Something appeared at the destination, so it was left alone.';
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
      if (entry.isSymbolicLink()) { held ??= `It contains a link (${relativePath}), and Central Knot creates and follows no links here.`; files.set(relativePath, { sha256: 'link', mode: 0 }); }
      else if (entry.isDirectory()) { directories.push(relativePath); await visit(path); }
      else if (entry.isFile()) files.set(relativePath, { sha256: await hashFile(path), mode: (await stat(path)).mode & 0o777 });
      else { held ??= `It contains a special file (${relativePath}).`; files.set(relativePath, { sha256: 'special', mode: 0 }); }
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

export function targetFor(harness: HarnessId, directory: string, source: Skill): PlanTarget {
  switch (harness) {
    case 'copilot-cli':
      if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'Copilot CLI does not load a skill in a folder starting with a dot.' };
      if (!source.hasFrontmatter) return { harness, directory, limits: [], skipped: 'Copilot CLI will not load a skill with no YAML frontmatter.' };
      if (source.copilotProblem) return { harness, directory, limits: [], skipped: `Copilot CLI will not load it: ${source.copilotProblem}.` };
      return { harness, directory, limits: source.metadataKeys.map(key => copilotLosses[key]) };
    case 'codex-cli':
      if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'Codex does not load a skill in a folder starting with a dot.' };
      if (source.codexProblem) return { harness, directory, limits: [], skipped: `Codex will not load it: ${source.codexProblem}.` };
      return { harness, directory, limits: [] };
    case 'pi-cli':
      if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'Pi does not load a skill in a folder starting with a dot.' };
      if (source.piProblem) return { harness, directory, limits: [], skipped: `Pi will not load it: ${source.piProblem}.` };
      return { harness, directory, limits: [] };
    case 'claude-cli':
      return { harness, directory, limits: [], note: source.metadataKeys.length ? `${source.metadataKeys.join(', ')}: effect not tested in Claude Code.` : undefined };
    case 'claude-cowork': return pluginsOnly(harness);
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

function validItems(items: unknown): boolean {
  if (typeof items !== 'object' || items === null || Array.isArray(items)) return false;
  return Object.values(items).every(item => typeof item === 'object' && item !== null
    && typeof item.name === 'string' && typeof item.hash === 'string' && (item.state === 'shared' || item.state === 'dont-share')
    && typeof item.startId === 'string' && typeof item.observedAt === 'string'
    && (item.off === undefined || (Array.isArray(item.off) && item.off.every(knownTool)))
    && (item.separate === undefined || typeof item.separate === 'boolean')
    && (item.deleted === undefined || (typeof item.deleted === 'object' && item.deleted !== null && typeof item.deleted.at === 'string' && knownTool(item.deleted.tool) && typeof item.deleted.hash === 'string'))
    && (item.use === undefined || (typeof item.use === 'object' && item.use !== null && knownTool(item.use.tool) && typeof item.use.hash === 'string'))
    && Array.isArray(item.copies) && item.copies.every((copy: Partial<RecordCopy>) => typeof copy === 'object' && copy !== null
      && typeof copy.directory === 'string' && isAbsolute(copy.directory) && typeof copy.hash === 'string' && knownTool(copy.harness)
      && (copy.status === 'pending' || copy.status === 'written' || copy.status === 'removing') && typeof copy.created === 'boolean'));
}

export async function readRecord(home: string): Promise<{ record?: SyncRecord; problem?: string }> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: 'The sync record could not be read.' }; }
  try {
    const record = JSON.parse(text) as SyncRecord;
    if (!Number.isInteger(record?.formatVersion) || record.formatVersion < 1) return { problem: 'The sync record is damaged.' };
    if (record.formatVersion > FORMAT_VERSION) return { problem: 'The sync record was written by a newer Central Knot.' };
    if (typeof record.generation !== 'string' || typeof record.owner !== 'string' || !validItems(record.items)
      || ![record.lastStartId, record.activeStartId].every(id => id === undefined || typeof id === 'string')) return { problem: 'The sync record is damaged.' };
    // No prototype: a skill may be called constructor or __proto__.
    record.items = Object.assign(Object.create(null), record.items);
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

export const saveRecord = (home: string, record: SyncRecord) => writeDurably(recordPath(home), `${JSON.stringify(record, null, 2)}\n`);

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

/** Why nothing may be written right now (another build owns syncing, or the record needs Resume), if so. */
export const gateRefusal = (gate: SyncGate) => (gate.state === 'stopped' || gate.state === 'needs-resume' ? gate.reason : undefined);

/** Section 3's stops: none of these turns into first setup or adopts a stale record. */
export async function syncGate(context: ShareContext): Promise<SyncGate> {
  const { record, problem } = await readRecord(context.home);
  if (problem) return { state: 'stopped', reason: `${problem} ${NOTHING_CHANGED}` };
  const remembered = (await readSettings(context.settingsPath)).homes?.[context.home]?.generation;
  if (!record) return remembered ? { state: 'stopped', reason: `The sync record this app created is missing. ${NOTHING_CHANGED}` } : { state: 'first-setup' };
  if (record.owner !== context.build) return { state: 'stopped', reason: `Sharing here belongs to another Central Knot build (${record.owner}). Nothing was written or deleted.` };
  if (!remembered) return { state: 'needs-resume', reason: 'This app has an intact sync record but no memory of it. Resuming keeps every recorded choice.' };
  if (remembered !== record.generation) return { state: 'stopped', reason: `The sync record is not the one this app last used. ${NOTHING_CHANGED}` };
  return { state: 'ready' };
}

/** Whether this build syncs this home and may write it: History is kept tidy, and passes run, only where both hold. */
export async function syncsHere(context: ShareContext): Promise<boolean> {
  return (await writeAccess(context)).allowed && (await syncGate(context)).state === 'ready';
}

/** The real home is written only by explicitly choosing it. A simulated home that reaches it stays read-only. */
export async function writeAccess(context: ShareContext): Promise<WriteAccess> {
  if (context.mode === 'actual') {
    if (!context.allowActualWrites) return { allowed: false, reason: 'Preview only: writing to real folders works only on macOS in this version. You can look around; nothing is written.' };
    for (const id of harnessIds) {
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

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, constants, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { harnesses, writeRoot } from './harnesses.ts';
import type { HarnessId, HomeMode, PlanTarget, Skill, Snapshot, SyncGate, WriteAccess } from './types.ts';

export const FORMAT_VERSION = 1;
const STAGE_PREFIX = '.ck-stage-';
const STAGE_NAME = /^\.ck-stage-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Finder drops these into any folder it opens; they are no change to a skill. */
const NOISE = new Set(['.DS_Store']);

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
  /** Test seam: throws at a named step, standing in for a crash. */
  fault?: (step: 'before-rename' | 'after-rename' | 'before-replace' | 'mid-replace') => void;
  /** The clock for observation intervals (CON-04); tests pass their own. */
  now?: () => number;
  /** How long a copy must stay missing before it counts as deleted, so an atomic save is not a deletion (SYN-04). Default 2 s. */
  settleMs?: number;
}

export interface RecordCopy { harness: HarnessId; directory: string; hash: string; created: boolean; status: 'pending' | 'written' }
export interface RecordItem { name: string; hash: string; state: 'shared' | 'dont-share'; startId: string; observedAt: string; copies: RecordCopy[]; /** Tools this managed skill does not sync to. */ off?: HarnessId[]; /** Differing copies kept as they are on purpose. */ separate?: boolean; /** A chosen copy not yet in every tool: the tool whose copy wins, and that copy's content ID. */ use?: { tool: HarnessId; hash: string }; /** Deleted everywhere it synced: when, from which tool, and the content it had. A copy turning up later is new input, never a revival (D-37). */ deleted?: { at: string; tool: HarnessId; hash: string } }
export interface SyncRecord { formatVersion: number; generation: string; owner: string; /** Each skills folder's identity at the last pass, so a folder made again reads as a reset, not as deletions. */ roots?: Record<string, { ino: number; birth: number }>; lastStartId?: string; /** Set while a Start is copying, so a crash and retry stay one Start. */ activeStartId?: string; items: Record<string, RecordItem> }

export function storeDirectory(home: string): string { return join(home, '.central-knot'); }
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

/** Whole-directory identity. Only the executable bit counts, so umask differences are no collision. */
export async function readTree(directory: string, options: { includeGit?: boolean } = {}): Promise<Tree> {
  const files: Tree['files'] = new Map();
  const directories: string[] = [];
  let held: string | undefined;
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if ((entry.name === '.git' && !options.includeGit) || (NOISE.has(entry.name) && entry.isFile())) continue;
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
  if (harness === 'copilot-cli') {
    if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'Copilot CLI does not load a skill in a folder starting with a dot.' };
    if (!source.hasFrontmatter) return { harness, directory, limits: [], skipped: 'Copilot CLI will not load a skill with no YAML frontmatter.' };
    if (source.copilotProblem) return { harness, directory, limits: [], skipped: `Copilot CLI will not load it: ${source.copilotProblem}.` };
    return { harness, directory, limits: source.metadataKeys.map(key => copilotLosses[key]) };
  }
  if (harness === 'codex-cli') {
    if (source.folder.startsWith('.')) return { harness, directory, limits: [], skipped: 'Codex does not load a skill in a folder starting with a dot.' };
    if (source.codexProblem) return { harness, directory, limits: [], skipped: `Codex will not load it: ${source.codexProblem}.` };
    return { harness, directory, limits: [] };
  }
  return { harness, directory, limits: [], note: source.metadataKeys.length ? `${source.metadataKeys.join(', ')}: effect not tested in Claude Code.` : undefined };
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
      && (copy.status === 'pending' || copy.status === 'written') && typeof copy.created === 'boolean'));
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

const NOTHING_CHANGED = 'Nothing was written or deleted. Put the record back, then try again.';

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

/** The real home is written only by explicitly choosing it. A simulated home that reaches it stays read-only. */
export async function writeAccess(context: ShareContext): Promise<WriteAccess> {
  if (context.mode === 'actual') {
    if (!context.allowActualWrites) return { allowed: false, reason: 'Preview only: copying into real folders is on only on macOS in this version.' };
    for (const id of Object.keys(harnesses) as HarnessId[]) {
      const override = context.overrides?.[id];
      if (override !== undefined && !isAbsolute(override)) return { allowed: false, reason: `Preview only: ${harnesses[id].configEnv} is not an absolute path, so its folder is unknown.` };
    }
    return { allowed: true, reason: 'Your real folders: Apply all writes here.' };
  }
  const refused = { allowed: false, reason: 'Preview only: this folder reaches your real configuration. To write there, choose your real home instead.' };
  const real = async (path: string) => { try { return await realpath(path); } catch { return undefined; } };
  const realHome = (await real(context.realHome)) ?? context.realHome;
  const protectedRoots = await Promise.all(['.claude', '.copilot', '.agents'].map(async name => (await real(join(realHome, name))) ?? join(realHome, name)));
  const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);
  const home = (await real(context.home)) ?? context.home;
  if (home === realHome || inside(realHome, home)) return refused;
  // A folder inside a real configuration folder would put copies and a record among the real ones.
  if ([...protectedRoots, join(realHome, '.central-knot')].some(root => inside(home, root))) return refused;
  // Every folder this home would write, followed through links, even where it does not exist yet.
  const fold = (path: string) => (process.platform === 'linux' ? path : path.toLowerCase());
  const guarded = [...protectedRoots, join(realHome, '.central-knot')].map(fold);
  const writes = [storeDirectory(context.home), join(context.home, '.agents'), ...(Object.keys(harnesses) as HarnessId[]).flatMap(id => [join(context.home, harnesses[id].defaultConfig), writeRoot(harnesses[id], context.home)])];
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

export async function importRevision(context: ShareContext, key: string, source: string, tree: Tree) {
  const target = join(storeDirectory(context.home), 'items', storeFolder(key), tree.hash);
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

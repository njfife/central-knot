import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { harnesses, writeRoot } from './harnesses.ts';
import type { ActionResult, DestinationResult, Disclosure, HarnessId, HomeMode, PlanCopy, PlanItem, PlanTarget, Preview, Skill, Snapshot, SyncGate, WriteAccess } from './types.ts';

export const FORMAT_VERSION = 1;
const STAGE_PREFIX = '.ck-stage-';

/** A build's identity, and where this build remembers which record it owns. */
export interface ShareContext {
  home: string;
  mode: HomeMode;
  /** Always reads disk, so every plan and result reflects what is there now. */
  read: () => Promise<Snapshot[]>;
  build: string;
  settingsPath: string;
  /** The person's real home, which this package never writes. */
  realHome: string;
  overrides?: Partial<Record<HarnessId, string>>;
  /** Test seam: throws at a named step, standing in for a crash. */
  fault?: (step: 'before-rename' | 'after-rename') => void;
}

interface RecordCopy { harness: HarnessId; directory: string; hash: string; created: boolean; status: 'pending' | 'written' }
interface RecordItem { name: string; hash: string; state: 'shared' | 'dont-share'; startId: string; observedAt: string; copies: RecordCopy[] }
interface SyncRecord { formatVersion: number; generation: string; owner: string; lastStartId?: string; items: Record<string, RecordItem> }

export function storeDirectory(home: string): string { return join(home, '.central-knot'); }
const recordPath = (home: string) => join(storeDirectory(home), 'sync.json');

export function itemKey(folder: string): string { return folder.normalize('NFC').toLowerCase(); }

const errorCode = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '');

// ---------- Trees ----------

export interface Tree { hash: string; files: Map<string, { sha256: string; mode: number }>; directories: string[]; held?: string }

/** Whole-directory identity. Only the executable bit counts, so umask differences are no collision. */
export async function readTree(directory: string, options: { includeGit?: boolean } = {}): Promise<Tree> {
  const files: Tree['files'] = new Map();
  const directories: string[] = [];
  let held: string | undefined;
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git' && !options.includeGit) continue;
      const path = join(current, entry.name);
      const relativePath = relative(directory, path).split(sep).join('/');
      if (entry.isSymbolicLink()) { held ??= `It contains a link (${relativePath}), and Central Knot creates and follows no links here.`; files.set(relativePath, { sha256: 'link', mode: 0 }); }
      else if (entry.isDirectory()) { directories.push(relativePath); await visit(path); }
      else if (entry.isFile()) files.set(relativePath, { sha256: createHash('sha256').update(await readFile(path)).digest('hex'), mode: (await stat(path)).mode & 0o777 });
      else { held ??= `It contains a special file (${relativePath}).`; files.set(relativePath, { sha256: 'special', mode: 0 }); }
    }
  }
  await visit(directory);
  const hash = createHash('sha256');
  for (const name of [...directories].sort()) hash.update(`d\0${name}\n`);
  for (const name of [...files.keys()].sort()) { const file = files.get(name)!; hash.update(`f\0${name}\0${file.mode & 0o111 ? 'x' : '-'}\0${file.sha256}\n`); }
  return { hash: hash.digest('hex'), files, directories, held };
}

/** Byte-exact copy with modes, without nested .git (SKL-01). Refuses anything but plain files and folders. */
async function copyTree(source: string, target: string, tree: Tree) {
  await mkdir(target);
  for (const name of [...tree.directories].sort()) await mkdir(join(target, name));
  for (const [name, file] of tree.files) {
    const bytes = await readFile(join(source, name));
    await writeFile(join(target, name), bytes, { mode: file.mode });
    await chmod(join(target, name), file.mode);
  }
  for (const name of [...tree.directories].sort().reverse()) await chmod(join(target, name), (await stat(join(source, name))).mode & 0o777);
  await chmod(target, (await stat(source)).mode & 0o777);
}

// ---------- Differences ----------

function lineDiff(first: string, second: string): string {
  const a = first.split('\n'), b = second.split('\n');
  if (a.length * b.length > 4_000_000) return '  (too long to compare line by line)';
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const lines: string[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push(`  ${a[i]}`); i++; j++; }
    else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) lines.push(`- ${a[i++]}`);
    else lines.push(`+ ${b[j++]}`);
  }
  return lines.join('\n');
}

const isText = (bytes: Buffer) => !bytes.subarray(0, 8000).includes(0);

async function describeDifference(first: PlanCopy, second: PlanCopy): Promise<string> {
  const [treeA, treeB] = await Promise.all([readTree(first.directory), readTree(second.directory)]);
  const names = [...new Set([...treeA.files.keys(), ...treeB.files.keys()])].sort();
  const sections = [`- ${harnesses[first.harness].name}`, `+ ${harnesses[second.harness].name}`];
  for (const name of names) {
    const a = treeA.files.get(name), b = treeB.files.get(name);
    if (!a) sections.push(`\n${name}: only in ${harnesses[second.harness].name}`);
    else if (!b) sections.push(`\n${name}: only in ${harnesses[first.harness].name}`);
    else if (a.sha256 !== b.sha256) {
      const [bytesA, bytesB] = await Promise.all([readFile(join(first.directory, name)), readFile(join(second.directory, name))]);
      sections.push(`\n${name}:\n${isText(bytesA) && isText(bytesB) ? lineDiff(bytesA.toString('utf8'), bytesB.toString('utf8')) : '  (binary files differ)'}`);
    } else if ((a.mode & 0o111) !== (b.mode & 0o111)) sections.push(`\n${name}: executable permission differs`);
  }
  return sections.join('\n');
}

// ---------- Limits per target (SKL-02, SKL-03) ----------

const copilotLosses: Record<string, string> = {
  paths: 'Copilot CLI ignores `paths`, so the skill applies more widely.',
  'user-invocable: false': 'Copilot CLI ignores `user-invocable: false`, so the model is still offered it.',
  'disable-model-invocation: true': 'Copilot CLI hides it from the model, and `/name` failed in print mode.',
};

function targetFor(harness: HarnessId, directory: string, source: Skill): PlanTarget {
  if (harness === 'copilot-cli') {
    if (!source.hasFrontmatter) return { harness, directory, limits: [], skipped: 'Copilot CLI will not load a skill with no YAML frontmatter.' };
    return { harness, directory, limits: source.metadataKeys.map(key => copilotLosses[key]) };
  }
  return { harness, directory, limits: [], note: source.metadataKeys.length ? `${source.metadataKeys.join(', ')}: effect not tested in Claude Code.` : undefined };
}

// ---------- State ----------

async function readRecord(home: string): Promise<{ record?: SyncRecord; problem?: string }> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: 'The sync record could not be read.' }; }
  try {
    const record = JSON.parse(text) as SyncRecord;
    if (typeof record?.formatVersion !== 'number') return { problem: 'The sync record is damaged.' };
    if (record.formatVersion > FORMAT_VERSION) return { problem: 'The sync record was written by a newer Central Knot.' };
    if (typeof record.generation !== 'string' || typeof record.owner !== 'string' || typeof record.items !== 'object' || record.items === null) return { problem: 'The sync record is damaged.' };
    return { record };
  } catch { return { problem: 'The sync record is damaged.' }; }
}

async function writeDurably(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
const saveRecord = (home: string, record: SyncRecord) => writeDurably(recordPath(home), `${JSON.stringify(record, null, 2)}\n`);

type Settings = { homes?: Record<string, { generation: string }> };
async function readSettings(path: string): Promise<Settings> {
  try { return JSON.parse(await readFile(path, 'utf8')) as Settings; } catch { return {}; }
}
async function remember(context: ShareContext, generation: string) {
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

/** This package only writes disposable homes; the real home stays read-only whichever way it is reached. */
export async function writeAccess(context: ShareContext): Promise<WriteAccess> {
  const refused = { allowed: false, reason: 'Preview only: this package never copies into your real configuration folders.' };
  if (context.mode === 'actual') return refused;
  const real = async (path: string) => { try { return await realpath(path); } catch { return undefined; } };
  const realHome = (await real(context.realHome)) ?? context.realHome;
  const protectedRoots = (await Promise.all(['.claude', '.copilot', '.agents'].map(name => real(join(realHome, name))))).filter((path): path is string => !!path);
  const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);
  const home = (await real(context.home)) ?? context.home;
  if (home === realHome || inside(realHome, home)) return refused;
  for (const id of Object.keys(harnesses) as HarnessId[]) {
    for (const path of [join(context.home, harnesses[id].defaultConfig), writeRoot(harnesses[id], context.home)]) {
      const resolved = await real(path);
      if (resolved && protectedRoots.some(root => inside(resolved, root))) return refused;
    }
  }
  return { allowed: true, reason: 'Disposable home: Start and Undo write only inside it.' };
}

// ---------- Preview ----------

export async function buildPreview(context: ShareContext, selected: HarnessId[], dontShare: string[]): Promise<Preview> {
  const { record } = await readRecord(context.home);
  const groups = new Map<string, { harness: HarnessId; skill: Skill }[]>();
  for (const snapshot of await context.read()) {
    if (!selected.includes(snapshot.harness)) continue;
    for (const skill of snapshot.skills) {
      const key = itemKey(skill.folder);
      groups.set(key, [...(groups.get(key) ?? []), { harness: snapshot.harness, skill }]);
    }
  }
  const excluded = new Set(dontShare.map(itemKey));
  const items: PlanItem[] = [];
  for (const [key, group] of [...groups].sort(([first], [second]) => first.localeCompare(second))) {
    items.push(await planItem(context, key, group, selected, excluded.has(key), record?.items[key]));
  }
  const disclosures: Disclosure[] = selected.map(id => ({ harness: id, name: harnesses[id].name, writesTo: writeRoot(harnesses[id], context.home, context.overrides?.[id]), alsoReadBy: harnesses[id].otherReaders }));
  const canUndo = !!record?.lastStartId && Object.values(record.items).some(item => item.startId === record.lastStartId && item.state === 'shared');
  return { selected, items, disclosures, access: await writeAccess(context), gate: await syncGate(context), canUndo };
}

async function planItem(context: ShareContext, key: string, group: { harness: HarnessId; skill: Skill }[], selected: HarnessId[], excluded: boolean, recorded: RecordItem | undefined): Promise<PlanItem> {
  const name = group[0].skill.folder;
  const copies: PlanCopy[] = [];
  const trees: Tree[] = [];
  for (const { harness, skill } of group) {
    const tree = await readTree(skill.directory);
    trees.push(tree);
    copies.push({ harness, directory: skill.directory, realDirectory: skill.realDirectory, hash: tree.hash });
  }
  const shared = recorded?.state === 'shared';
  const base = { key, name, copies, targets: [] as PlanTarget[], locked: false, undoable: shared };
  if (recorded?.state === 'dont-share') return { ...base, locked: true, undoable: false, state: 'dont-share', status: 'Don’t share', reason: 'Stays as it is and is not copied again. Sharing it again arrives in a later version.' };
  if (excluded) return { ...base, state: 'dont-share', status: 'Don’t share', reason: 'Excluded. Every copy stays as it is.' };
  const held = trees.find(tree => tree.held)?.held;
  if (held) return { ...base, state: 'held', status: 'Not known yet', reason: `${held} Nothing is copied.` };
  const hashes = [...new Set(copies.map(copy => copy.hash))];
  if (shared) {
    // Two-way changes arrive with 8b. Until then a change or loss after sharing is held, never guessed at.
    const lost = recorded.copies.filter(copy => copy.status === 'written' && selected.includes(copy.harness) && !copies.some(found => found.directory === copy.directory));
    if (lost.length) return { ...base, state: 'held', status: 'Not known yet', reason: `A shared copy in ${harnesses[lost[0].harness].name} is gone. Nothing is recreated or deleted.` };
    if (hashes.length > 1 || hashes[0] !== recorded.hash) return { ...base, state: 'held', status: 'Not known yet', reason: 'Changed since it was shared. Nothing is overwritten; carrying edits across arrives in a later version.' };
  }
  if (hashes.length > 1) {
    const other = copies.find(copy => copy.hash !== copies[0].hash)!;
    return { ...base, state: 'collision', status: 'Needs a decision', reason: 'Different skills share this name. Each copy stays separate and unchanged, and neither spreads. Choosing one arrives in a later version.', diff: await describeDifference(copies[0], other) };
  }
  const missing = selected.filter(id => !copies.some(copy => copy.harness === id));
  if (!missing.length) {
    const sameFolder = new Set(copies.map(copy => copy.realDirectory)).size === 1;
    if (shared) {
      const losses = copies.some(copy => copy.harness === 'copilot-cli') ? group[0].skill.metadataKeys.map(key => copilotLosses[key]) : [];
      return { ...base, state: sameFolder ? 'already-shared' : 'identical', status: losses.length ? 'With limits' : 'Written', reason: ['Shared. Every copy matches what was recorded.', ...losses].join(' ') };
    }
    return sameFolder
      ? { ...base, state: 'already-shared', status: 'Already shared', reason: selected.length > 1 ? 'These tools already read the same folder. Nothing to copy.' : 'Imported from the selected tool.' }
      : { ...base, state: 'identical', status: 'Already identical', reason: 'Every copy already matches. Taken over with zero writes.' };
  }
  const source = group[0].skill;
  const targets: PlanTarget[] = [];
  const problems: string[] = [];
  for (const harness of missing) {
    const definition = harnesses[harness];
    const directory = join(writeRoot(definition, context.home, context.overrides?.[harness]), source.folder);
    if (definition.reservedSkills.includes(source.folder)) { targets.push({ harness, directory, limits: [], skipped: `${definition.name} reserves the name “${source.folder}”.` }); continue; }
    try {
      await lstat(directory);
      problems.push(`${definition.name} already has something at ${directory} that is not a readable skill. It stays untouched.`);
      continue;
    } catch (error) { if (errorCode(error) !== 'ENOENT') { problems.push(`${directory} could not be checked.`); continue; } }
    targets.push(targetFor(harness, directory, source));
  }
  if (problems.length) return { ...base, state: 'held', status: 'Not known yet', reason: problems.join(' ') };
  const writable = targets.filter(target => !target.skipped);
  const skippedText = targets.filter(target => target.skipped).map(target => target.skipped).join(' ');
  if (!writable.length) return { ...base, targets, state: 'held', status: 'Not available here', reason: skippedText };
  return { ...base, targets, state: 'copy', status: 'Will copy', reason: [`Copies to ${writable.map(target => harnesses[target.harness].name).join(', ')}.`, skippedText].filter(Boolean).join(' ') };
}

// ---------- Start ----------

async function importRevision(context: ShareContext, key: string, source: string, tree: Tree) {
  const target = join(storeDirectory(context.home), 'items', encodeURIComponent(key), tree.hash);
  try { if ((await readTree(target)).hash === tree.hash) return; await rm(target, { recursive: true }); }
  catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.${randomUUID()}.tmp`;
  await copyTree(source, staging, tree);
  await rename(staging, target);
}

async function clearStaleStages(roots: string[]) {
  for (const root of new Set(roots)) {
    let entries: string[];
    try { entries = await readdir(root); } catch { continue; }
    await Promise.all(entries.filter(name => name.startsWith(STAGE_PREFIX)).map(name => rm(join(root, name), { recursive: true, force: true })));
  }
}

/** Stage beside the target, verify, then rename into place (FIL-01). */
async function placeCopy(context: ShareContext, source: string, target: PlanTarget, tree: Tree) {
  const root = dirname(target.directory);
  await mkdir(root, { recursive: true });
  const stage = join(root, `${STAGE_PREFIX}${randomUUID()}`);
  try {
    await copyTree(source, stage, tree);
    if ((await readTree(stage)).hash !== tree.hash) throw new Error('The staged copy did not match its source.');
    context.fault?.('before-rename');
    try { await lstat(target.directory); throw Object.assign(new Error('Something appeared at the destination.'), { code: 'CK_EXISTS' }); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    await rename(stage, target.directory);
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}

async function action(context: ShareContext, selected: HarnessId[], dontShare: string[], results: DestinationResult[], harnessWrites: number, stopped?: string): Promise<ActionResult> {
  return { stopped, results, harnessWrites, preview: await buildPreview(context, selected, dontShare) };
}

/** First copy: imports selected skills and copies non-colliding ones. Replans from disk; never trusts an earlier preview. */
export async function start(context: ShareContext, selected: HarnessId[], dontShare: string[], resume = false): Promise<ActionResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return action(context, selected, dontShare, [], 0, access.reason);
  const gate = await syncGate(context);
  if (gate.state === 'stopped') return action(context, selected, dontShare, [], 0, gate.reason);
  if (gate.state === 'needs-resume' && !resume) return action(context, selected, dontShare, [], 0, gate.reason);

  const preview = await buildPreview(context, selected, dontShare);
  const results: DestinationResult[] = [];
  let record = (await readRecord(context.home)).record;
  // Order matters: a crash between these leaves an intact record that this build can resume.
  if (!record) { record = { formatVersion: FORMAT_VERSION, generation: randomUUID(), owner: context.build, items: {} }; await saveRecord(context.home, record); }
  if (gate.state !== 'ready') await remember(context, record.generation);
  await clearStaleStages(preview.disclosures.map(disclosure => disclosure.writesTo));

  const startId = randomUUID();
  let changed = false, writes = 0;
  for (const item of preview.items) {
    const existing = record.items[item.key];
    if (item.state === 'dont-share') {
      if (!existing) { record.items[item.key] = { name: item.name, hash: '', state: 'dont-share', startId: '', observedAt: new Date().toISOString(), copies: [] }; changed = true; }
      else if (existing.state !== 'dont-share') { existing.state = 'dont-share'; changed = true; }
      results.push({ item: item.name, outcome: 'kept', message: item.reason });
      continue;
    }
    if (item.state === 'collision' || item.state === 'held') { results.push({ item: item.name, outcome: 'held', message: item.reason }); continue; }
    try {
      const sourceCopy = item.copies[0];
      const tree = await readTree(sourceCopy.directory);
      await importRevision(context, item.key, sourceCopy.directory, tree);
      const entry: RecordItem = existing ?? { name: item.name, hash: tree.hash, state: 'shared', startId, observedAt: new Date().toISOString(), copies: [] };
      if (!existing) { changed = true; record.lastStartId = startId; }
      for (const copy of item.copies) {
        if (!entry.copies.some(known => known.directory === copy.directory)) {
          entry.copies.push({ harness: copy.harness, directory: copy.directory, hash: copy.hash, created: false, status: 'written' });
          changed = true;
        }
      }
      record.items[item.key] = entry;
      for (const target of item.targets) {
        if (target.skipped) { results.push({ item: item.name, harness: target.harness, outcome: 'held', message: target.skipped }); continue; }
        // Intent goes on record first, so a crash after the rename still leaves an undoable copy.
        const intent: RecordCopy = { harness: target.harness, directory: target.directory, hash: tree.hash, created: true, status: 'pending' };
        entry.copies = [...entry.copies.filter(known => known.directory !== target.directory), intent];
        entry.startId = startId;
        record.lastStartId = startId;
        await saveRecord(context.home, record);
        await placeCopy(context, sourceCopy.directory, target, tree);
        writes++;
        context.fault?.('after-rename');
        intent.status = 'written';
        changed = true;
        results.push({ item: item.name, harness: target.harness, outcome: 'written', message: [harnesses[target.harness].nextStep, ...target.limits].join(' ') });
      }
      if (!item.targets.length) {
        // A recorded pending copy that made it to disk is ours: a crash between rename and record.
        for (const known of entry.copies) if (known.status === 'pending') { known.status = 'written'; changed = true; }
        results.push({ item: item.name, outcome: 'kept', message: item.reason });
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('fault:')) throw error;
      results.push({ item: item.name, outcome: 'failed', message: error instanceof Error ? error.message : 'The copy failed; the last good state stays.' });
    }
  }
  if (changed) await saveRecord(context.home, record);
  return action(context, selected, dontShare, results, writes);
}

// ---------- Undo ----------

/** Removes only copies a Start created that still match their recorded hash. The item becomes Don't share. */
export async function undo(context: ShareContext, selected: HarnessId[], only?: string): Promise<ActionResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return action(context, selected, [], [], 0, access.reason);
  const gate = await syncGate(context);
  if (gate.state !== 'ready') return action(context, selected, [], [], 0, 'reason' in gate ? gate.reason : 'Nothing to undo.');
  const record = (await readRecord(context.home)).record!;
  const results: DestinationResult[] = [];
  let removed = 0;
  const keys = only ? [itemKey(only)] : Object.keys(record.items).filter(key => record.items[key].startId === record.lastStartId && record.items[key].state === 'shared');
  for (const key of keys) {
    const item = record.items[key];
    if (!item) continue;
    if (!item.copies.some(copy => copy.created)) results.push({ item: item.name, outcome: 'stayed', message: 'Every copy was here before Start, so they stay.' });
    for (const copy of item.copies) {
      if (!copy.created) continue;
      let info;
      try { info = await lstat(copy.directory); }
      catch (error) {
        if (errorCode(error) === 'ENOENT') { results.push({ item: item.name, harness: copy.harness, outcome: 'stayed', message: 'Already gone.' }); continue; }
        results.push({ item: item.name, harness: copy.harness, outcome: 'failed', message: 'Could not be checked, so it stays.' }); continue;
      }
      const current = info.isDirectory() ? await readTree(copy.directory, { includeGit: true }) : undefined;
      if (current?.hash !== copy.hash) { results.push({ item: item.name, harness: copy.harness, outcome: 'stayed', message: 'Changed since the copy, so it stays.' }); continue; }
      const parked = join(dirname(copy.directory), `${STAGE_PREFIX}${randomUUID()}`);
      await rename(copy.directory, parked);
      await rm(parked, { recursive: true, force: true });
      removed++;
      results.push({ item: item.name, harness: copy.harness, outcome: 'removed', message: 'Removed. Its source and the imported bytes stay.' });
    }
    item.state = 'dont-share';
  }
  await saveRecord(context.home, record);
  return action(context, selected, [], results, removed);
}

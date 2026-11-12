// The agents record from before the library (format 2: the harnesses' own folders were the truth, and Central Knot recorded
// which agents it synced) made into library items (library.ts). Run once per home, by agentstore.ts openLibrary.
//
// The rule: no harness file changes because of the migration, and every content the old record could still reach is a version.
// - Synced, every copy the synced content: On at that content, each recorded copy `applied`.
// - A copy the old engine left alone on purpose (one it had stopped updating, a receive-only copy edited or deleted in its
//   harness, a copy that differs and was never on record): that harness is `except`, with nothing applied there, so the
//   copy is a found copy and stays as it is (a deleted one stays deleted); its content is a version ("was in Codex").
// - Not synced (turned off, or copies kept separate): Off, at the content it last synced (never synced: its latest copy), with
//   nothing applied, so every copy is a found copy and stays.
// - Deleted everywhere: a tombstone, at the content it had; a copy the deletion still owed a removal stays `applied`, so it
//   still goes once it can.
// - Every content kept under `items/agents/<key>/<hash>/` is a version, and each harness's kept file of the current content is
//   that harness's own part, so On or Restore writes that very file back.
// An agent of which no content is left anywhere gets no item: what its harnesses hold is found, as for one never recorded.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { agentHash, readAgents, type AgentEntry, type SharedAgent } from './agentfiles.ts';
import { newItem, type LibraryItem, type Source } from './library.ts';
import { agentTools } from './presence.ts';
import { sha256, storeDirectory, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/**
 * A copy on the old record: `stopped`, no longer updated after an edit there; `oneWay`, receive-only; `removing`, a removal a
 * deletion still owed.
 */
interface OldCopy { tool: HarnessId; hash: string; oneWay?: boolean; stopped?: boolean; status?: 'removing' }
/** An agent on the old record: synced (`shared`) or not, the harnesses left out (`off`), the content last synced, and a deletion that spread. */
interface OldItem {
  name: string; state: 'shared' | 'dont-share'; off: HarnessId[]; hash: string; copies: OldCopy[];
  deleted?: { at: string; hash: string };
}
export interface OldAgentRecord { formatVersion: number; items: Record<string, OldItem> }

export function isOldRecord(record: unknown): record is OldAgentRecord {
  const items = (record as Partial<OldAgentRecord> | null)?.items;
  const isItem = (item: Partial<OldItem> | null) =>
    !!item && typeof item === 'object' && typeof item.state === 'string' && Array.isArray(item.off) && Array.isArray(item.copies);
  return !!items && Object.values(items).every(isItem);
}

/** One content kept before the library: its shared part, when it was kept, and each harness's whole file of it. */
export interface KeptContent { hash: string; agent: SharedAgent; at: number; files: Partial<Record<HarnessId, string>> }

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * One old item as a library item, from what is kept of it (`kept`) and what the harnesses hold now (`onDisk`); undefined when
 * no content of it is left. Pure: the worked examples are tests/agentmigrate.test.ts.
 */
export function migrateItem(key: string, old: OldItem, kept: KeptContent[], onDisk: AgentEntry[]): LibraryItem | undefined {
  const contents = new Map<string, { at: number; from: Source }>(kept.map(content => [content.hash, { at: content.at, from: { how: 'migrated' } }]));
  for (const entry of onDisk) if (!contents.has(entry.hash)) contents.set(entry.hash, { at: entry.at, from: { how: 'was-in', harness: entry.tool } });
  const synced = old.state === 'shared';
  const deleted = !synced ? old.deleted : undefined;
  const latest = [...contents].sort(([, first], [, second]) => second.at - first.at)[0]?.[0];
  const lastSynced = deleted?.hash ?? old.hash;
  const current = contents.has(lastSynced) ? lastSynced : synced || deleted ? undefined : latest;
  if (current === undefined) return undefined;
  const item: LibraryItem = { ...newItem('agent', key, old.name), on: synced || !!deleted, hash: current };
  if (deleted) item.deleted = { at: deleted.at };
  item.versions = [...contents].map(([hash, { at, from }]) => ({ hash, at: iso(at), from }))
    .sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
  const leftAlone = new Set(old.off);
  for (const copy of old.copies) {
    const here = onDisk.find(entry => entry.tool === copy.tool);
    if (copy.status === 'removing') { if (!synced) item.applied[copy.tool] = copy.hash; }
    else if (!synced) continue;
    // What the earlier engine left to its harness: a stopped copy, and a receive-only one edited or deleted there since.
    else if (copy.stopped || (copy.oneWay && here?.hash !== copy.hash)) leftAlone.add(copy.tool);
    else item.applied[copy.tool] = copy.hash;
  }
  // A copy that differs and was never on record: the old engine held for a choice of copy and wrote nothing there.
  if (synced) for (const entry of onDisk) if (item.applied[entry.tool] === undefined && entry.hash !== current) leftAlone.add(entry.tool);
  item.except = [...leftAlone];
  for (const [tool, text] of Object.entries(kept.find(content => content.hash === current)?.files ?? {})) item.own[tool as HarnessId] = sha256(text);
  return item;
}

/** What is kept of one agent from before the library: one folder per content, with `agent.json` and each harness's `<harness>.txt`. */
async function readKept(context: ShareContext, key: string): Promise<KeptContent[]> {
  const base = join(storeDirectory(context.home), 'items', 'agents', encodeURIComponent(key));
  const found: KeptContent[] = [];
  for (const hash of (await readdir(base).catch(() => [] as string[])).filter(name => /^[0-9a-f]{64}$/.test(name))) {
    const meta = join(base, hash, 'agent.json');
    let agent: SharedAgent;
    try { agent = JSON.parse(await readFile(meta, 'utf8')).agent; } catch { continue; }
    const whole = typeof agent?.name === 'string' && typeof agent.description === 'string' && typeof agent.prompt === 'string';
    if (!whole || agentHash(agent) !== hash) continue;
    const files: KeptContent['files'] = {};
    for (const tool of agentTools) {
      const text = await readFile(join(base, hash, `${tool}.txt`), 'utf8').catch(() => undefined);
      if (text !== undefined) files[tool] = text;
    }
    found.push({ hash, agent, at: await stat(meta).then(info => info.mtimeMs, () => 0), files });
  }
  return found;
}

/** A migrated record: its items, and the contents the new store needs for them (each version, and each harness's own file). */
export interface Migrated {
  items: Record<string, LibraryItem>;
  versions: { key: string; hash: string; agent: SharedAgent }[];
  own: { key: string; text: string }[];
}

/** The whole old record as library items. Reads the old store and the harnesses; writes nothing. */
export async function migrateAgents(context: ShareContext, old: OldAgentRecord): Promise<Migrated> {
  const { items, versions, own }: Migrated = { items: {}, versions: [], own: [] };
  // Format 1 is from before agents were rewritten: nothing in it is carried over.
  if (old.formatVersion < 2) return { items, versions, own };
  // Every harness's folder in this home is looked at, managed or not: a copy is left alone wherever it is.
  const onDisk: AgentEntry[] = [];
  for (const tool of agentTools) onDisk.push(...(await readAgents(context, tool)).entries);
  for (const [key, was] of Object.entries(old.items)) {
    const kept = await readKept(context, key), here = onDisk.filter(entry => entry.key === key);
    const item = migrateItem(key, was, kept, here);
    if (!item) continue;
    items[key] = item;
    for (const content of kept) versions.push({ key, hash: content.hash, agent: content.agent });
    for (const entry of here) if (!kept.some(content => content.hash === entry.hash)) versions.push({ key, hash: entry.hash, agent: entry.agent });
    for (const text of Object.values(kept.find(content => content.hash === item.hash)?.files ?? {})) own.push({ key, text });
  }
  return { items, versions, own };
}

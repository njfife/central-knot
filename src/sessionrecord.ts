// The kept session-costs record under `.central-knot/sessions/`: compact JSON files per local month (`YYYY-MM.json`) holding
// deduplicated receipts and interned pricing metadata, plus `positions.json` for file checkpoints. Owns: the record's shapes,
// local-month helpers, reading and v1 shape checks, holding newer/damaged/non-file/symlink paths untouched, the pure upsert by
// tool and request key, per-home read-to-commit serialization, and the safe write (writeAccess only, never libraryGate or
// liftFirst; stray temps removed, durable months, folder fsync where supported, then positions).
// Not here: finding, reading or sweeping session files (sessionrequests.ts), sums and rows (sessionrow.ts), pricing rules
// (rates.ts), callers, timers, Settings, Clear, retention, folding, or pages. Two app copies on one home are not coordinated here.
import { lstat, mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { harnessIds } from './harnesses.ts';
import type { PriceResult } from './rates.ts';
import type { PricedRequest } from './sessionday.ts';
import type { CodexState, Request, Tokens } from './sessionrequests.ts';
import { errorCode, landingOf, storeDirectory, writeAccess, writeDurably, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';
import { jsonObject, record } from './values.ts';

const FORMAT_VERSION = 1;
const POSITIONS_FILE = 'positions.json';
const TEMP_FILE_RE = /^(?:positions|\d{4}-(?:0[1-9]|1[0-2]))\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

type OmitUnion<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Interned pricing evidence kept once per month: `PriceResult` without `dollars`, distributed across the union. */
export type PricingEntry = OmitUnion<PriceResult, 'dollars'>;
/** One kept request receipt; unpriced requests keep `speed` and `serviceTier` so refusal reasons can be shown later. */
export interface Receipt {
  at: number; model: string; tokens: Tokens; dollars?: number; pricing: number; speed?: string; serviceTier?: string;
}
export interface KeptSession {
  tool: HarnessId; session: string; parent?: string; project?: string; unread: number;
  reported?: { dollars: number; complete: boolean }; requests: Record<string, Receipt>;
}
export interface SessionMonth { formatVersion: 1; month: string; pricings: PricingEntry[]; sessions: KeptSession[] }
/** Tracked file checkpoints (`dev` and `ino` are strings because Windows file ids exceed 2^53). */
export interface Positions {
  formatVersion: 1; sweptAt: number;
  files: { tool: HarnessId; dev: string; ino: string; offset: number; before: string; size: number; mtimeMs: number; codex?: CodexState }[];
}
export interface HeldEntry { file: string; kind: 'newer' | 'damaged' | 'not-a-file' | 'link'; reason: string }
export interface UpsertResult {
  months: Record<string, SessionMonth>; changed: string[];
  notTaken: { tool: HarnessId; session: string; request: PricedRequest; month?: string; reason: 'empty-key' | 'invalid-time' | 'held' }[];
}
export interface WriteResult { written: boolean; refused?: string; held: HeldEntry[] }

export const sessionsDirectory = (home: string): string => join(storeDirectory(home), 'sessions');
export const emptyPositions = (): Positions => ({ formatVersion: 1, sweptAt: 0, files: [] });

/** Local `YYYY-MM` bucket for a timestamp in ms, matching the Sessions page's local calendar days. */
export function monthOf(at: number): string {
  const d = new Date(at);
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** The calendar month before `YYYY-MM`. */
export function previousMonth(month: string): string {
  assertMonth(month);
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${String(y - 1).padStart(4, '0')}-12` : `${String(y).padStart(4, '0')}-${String(m - 1).padStart(2, '0')}`;
}
const assertMonth = (month: string) => { if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new RangeError(`Invalid session month: ${month}`); };

const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const nonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const optStr = (v: unknown): boolean => v === undefined || typeof v === 'string';
const isTool = (v: unknown): v is HarnessId => typeof v === 'string' && harnessIds.includes(v as HarnessId);
const isTokens = (v: unknown): v is Tokens => {
  const t = record(v);
  return !!t && whole(t.input) && whole(t.cacheRead) && whole(t.cacheWrite) && whole(t.output) && (t.cacheWrite1h === undefined || whole(t.cacheWrite1h));
};
const isPricing = (v: unknown) => { const p = record(v); return !!p && typeof p.priced === 'boolean' && (p.basis !== 'list' || !!record(p.matched)); };
function validMonth(obj: Record<string, unknown>, month: string): SessionMonth | undefined {
  if (obj.month !== month || !Array.isArray(obj.pricings) || !obj.pricings.every(isPricing) || !Array.isArray(obj.sessions)) return undefined;
  const pricings = obj.pricings as PricingEntry[];
  for (const raw of obj.sessions) {
    const s = record(raw), rep = s?.reported === undefined ? undefined : record(s.reported), reqs = record(s?.requests);
    if (!s || !isTool(s.tool) || typeof s.session !== 'string' || !s.session || !optStr(s.parent)
      || !optStr(s.project) || !whole(s.unread) || !reqs) return undefined;
    if (s.reported !== undefined && (!rep || !nonNeg(rep.dollars) || typeof rep.complete !== 'boolean')) return undefined;
    for (const [key, val] of Object.entries(reqs)) {
      const r = record(val);
      if (!key || !r || typeof r.at !== 'number' || !Number.isFinite(r.at) || typeof r.model !== 'string'
        || !isTokens(r.tokens) || !whole(r.pricing) || r.pricing >= pricings.length || !optStr(r.speed)
        || !optStr(r.serviceTier)) return undefined;
      if (pricings[r.pricing]!.priced ? !nonNeg(r.dollars) : r.dollars !== undefined) return undefined;
    }
  }
  return obj as unknown as SessionMonth;
}
function validPositions(obj: Record<string, unknown>): Positions | undefined {
  if (!nonNeg(obj.sweptAt) || !Array.isArray(obj.files)) return undefined;
  for (const raw of obj.files) {
    const f = record(raw);
    if (!f || !isTool(f.tool) || typeof f.dev !== 'string' || typeof f.ino !== 'string' || !whole(f.offset)
      || typeof f.before !== 'string' || !whole(f.size) || typeof f.mtimeMs !== 'number' || !Number.isFinite(f.mtimeMs)
      || (f.codex !== undefined && !record(f.codex))) return undefined;
  }
  return obj as unknown as Positions;
}

const emptyRead = (held: HeldEntry[] = []) => ({ months: {} as Record<string, SessionMonth>, positions: emptyPositions(), held });

async function readRecordFile<T>(filePath: string, file: string, validate: (obj: Record<string, unknown>) => T | undefined)
  : Promise<{ value?: T; held?: HeldEntry }> {
  let text: string;
  try {
    const info = await lstat(filePath);
    if (info.isSymbolicLink()) return { held: { file, kind: 'link', reason: `${file} is a link.` } };
    if (!info.isFile()) return { held: { file, kind: 'not-a-file', reason: `${file} is not a regular file.` } };
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' ? {} : { held: { file, kind: code === 'ENOTDIR' ? 'not-a-file' : 'damaged', reason: `${file} could not be read.` } };
  }
  const obj = jsonObject(text);
  if (!obj) return { held: { file, kind: 'damaged', reason: `${file} is damaged.` } };
  if (Number.isSafeInteger(obj.formatVersion) && (obj.formatVersion as number) > FORMAT_VERSION) {
    return { held: { file, kind: 'newer', reason: `${file} was written by a newer Central Knot.` } };
  }
  const value = obj.formatVersion === FORMAT_VERSION ? validate(obj) : undefined;
  return value ? { value } : { held: { file, kind: 'damaged', reason: `${file} is damaged.` } };
}

/**
 * Reads the named `YYYY-MM` months and `positions.json` without listing or creating anything on disk.
 * Checks `sessions` with `lstat` first; symlinks, non-files, newer, damaged or unreadable files are reported in `held`.
 */
export async function readSessionRecord(home: string, months: readonly string[]) {
  const names = [...new Set(months)].sort(), dir = sessionsDirectory(home);
  names.forEach(assertMonth);
  try {
    const info = await lstat(dir);
    if (info.isSymbolicLink()) return emptyRead([{ file: 'sessions', kind: 'link', reason: 'The sessions folder is a link.' }]);
    if (!info.isDirectory()) return emptyRead([{ file: 'sessions', kind: 'not-a-file', reason: 'The sessions path is not a folder.' }]);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return emptyRead();
    return emptyRead([{ file: 'sessions', kind: code === 'ENOTDIR' ? 'not-a-file' : 'damaged', reason: 'The sessions folder could not be read.' }]);
  }
  const kept: Record<string, SessionMonth> = {}, holds: HeldEntry[] = [];
  for (const month of names) {
    const res = await readRecordFile(join(dir, `${month}.json`), `${month}.json`, obj => validMonth(obj, month));
    if (res.held) holds.push(res.held); else if (res.value) kept[month] = res.value;
  }
  const pos = await readRecordFile(join(dir, POSITIONS_FILE), POSITIONS_FILE, validPositions);
  if (pos.held) holds.push(pos.held);
  return { months: kept, positions: pos.value ?? emptyPositions(), held: holds };
}

const sameTokens = (a: Tokens, b: Tokens) =>
  a.input === b.input && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite
  && a.cacheWrite1h === b.cacheWrite1h && a.output === b.output;

function toPricingEntry(p: PriceResult | PricingEntry): PricingEntry {
  if (!p.priced) return { priced: false, reason: p.reason, detail: p.detail };
  if (p.basis === 'list') {
    const { matched: { provider, model, by, providerFrom }, ratesDate, atLeast } = p;
    return { priced: true, basis: 'list', ratesDate, matched: { provider, model, by, providerFrom }, ...(atLeast ? { atLeast: true } : {}) };
  }
  return p.basis === 'credits' ? { priced: true, basis: 'credits', credits: p.credits } : { priced: true, basis: 'reported' };
}
function makeReceipt(at: number, req: Request, price: PriceResult, pricing: number): Receipt {
  const { input, cacheRead, cacheWrite, cacheWrite1h, output } = req.tokens;
  const tokens: Tokens = { input, cacheRead, cacheWrite, ...(cacheWrite1h !== undefined ? { cacheWrite1h } : {}), output };
  if (price.priced) return { at, model: req.model, tokens, dollars: price.dollars, pricing };
  const extra = { ...(req.speed !== undefined ? { speed: req.speed } : {}), ...(req.serviceTier !== undefined ? { serviceTier: req.serviceTier } : {}) };
  return { at, model: req.model, tokens, pricing, ...extra };
}

/**
 * Pure upsert keyed by `(tool, request)` as supplied (callers must tag legacy thread-local Codex keys upstream before calling;
 * empty keys are refused into `notTaken`). Searches the request's local month, then the month before (a key older than the month
 * before is treated as new). Exact model + token match freezes the kept receipt; otherwise model, tokens and price are replaced
 * while keeping the first session, month and `at`. Requests targeting a held month are returned in `notTaken` and never stored.
 */
export function upsertSessionRecord(
  source: { months: Record<string, SessionMonth>; held: readonly HeldEntry[] },
  updates: readonly {
    tool: HarnessId; session: string; parent?: string; project?: string;
    unread?: number; reported?: { dollars: number; complete: boolean }; requests: readonly PricedRequest[];
  }[],
): UpsertResult {
  const isHeld = (m: string) => source.held.some(h => h.file === 'sessions' || h.file === `${m}.json`);
  const months: Record<string, SessionMonth> = { ...source.months };
  const cloned = new Set<string>(), changed = new Set<string>(), notTaken: UpsertResult['notTaken'] = [];
  const byKey = new Map<string, number>(), bySess = new Map<string, number>(), byPrice = new Map<string, number>();
  for (const [m, data] of Object.entries(months)) {
    data.pricings.forEach((p, i) => byPrice.set(`${m}\0${JSON.stringify(toPricingEntry(p))}`, i));
    data.sessions.forEach((s, si) => {
      bySess.set(`${m}\0${s.tool}\0${s.session}`, si);
      for (const key of Object.keys(s.requests)) byKey.set(`${m}\0${s.tool}\0${key}`, si);
    });
  }
  const mutable = (m: string): SessionMonth => {
    if (cloned.has(m)) return months[m]!;
    cloned.add(m);
    return (months[m] = Object.hasOwn(months, m) ? structuredClone(months[m]!) : { formatVersion: 1, month: m, pricings: [], sessions: [] });
  };
  const putReceipt = (m: string, si: number, at: number, req: Request, price: PriceResult) => {
    const data = mutable(m), entry = toPricingEntry(price), pk = `${m}\0${JSON.stringify(entry)}`;
    const pi = byPrice.get(pk) ?? (data.pricings.push(entry) - 1);
    byPrice.set(pk, pi);
    Object.defineProperty(data.sessions[si]!.requests, req.request,
      { value: makeReceipt(at, req, price, pi), enumerable: true, writable: true, configurable: true });
    changed.add(m);
  };
  for (const update of updates) {
    const touched = new Set<string>(), sk = `${update.tool}\0${update.session}`;
    for (const priced of update.requests) {
      const { request: req, price } = priced;
      if (!req.request) { notTaken.push({ tool: update.tool, session: update.session, request: priced, reason: 'empty-key' }); continue; }
      if (!Number.isFinite(req.at)) { notTaken.push({ tool: update.tool, session: update.session, request: priced, reason: 'invalid-time' }); continue; }
      const own = monthOf(req.at), prev = previousMonth(own), rk = `${update.tool}\0${req.request}`;
      const hit = (!isHeld(own) && byKey.has(`${own}\0${rk}`)) ? own
        : (!isHeld(prev) && byKey.has(`${prev}\0${rk}`)) ? prev : undefined;
      if (hit) {
        const si = byKey.get(`${hit}\0${rk}`)!, found = months[hit]!.sessions[si]!, old = found.requests[req.request]!;
        if (found.session === update.session) touched.add(hit);
        if (old.model !== req.model || !sameTokens(old.tokens, req.tokens)) putReceipt(hit, si, old.at, req, price);
        continue;
      }
      if (isHeld(own)) { notTaken.push({ tool: update.tool, session: update.session, request: priced, month: own, reason: 'held' }); continue; }
      let si = bySess.get(`${own}\0${sk}`);
      if (si === undefined) {
        si = mutable(own).sessions.push({ tool: update.tool, session: update.session, unread: update.unread ?? 0, requests: {} }) - 1;
        bySess.set(`${own}\0${sk}`, si);
      }
      putReceipt(own, si, req.at, req, price);
      byKey.set(`${own}\0${rk}`, si);
      touched.add(own);
    }
    const metaMonths = update.requests.length ? touched : Object.keys(months).filter(m => !isHeld(m) && bySess.has(`${m}\0${sk}`));
    for (const m of metaMonths) {
      const si = bySess.get(`${m}\0${sk}`)!, cur = months[m]!.sessions[si]!, rep = update.reported;
      const patch = {
        ...(update.parent !== undefined && update.parent !== cur.parent ? { parent: update.parent } : {}),
        ...(update.project !== undefined && update.project !== cur.project ? { project: update.project } : {}),
        ...(update.unread !== undefined && update.unread !== cur.unread ? { unread: update.unread } : {}),
        ...(rep && (rep.dollars !== cur.reported?.dollars || rep.complete !== cur.reported?.complete) ? { reported: { ...rep } } : {}),
      };
      if (Object.keys(patch).length) { Object.assign(mutable(m).sessions[si]!, patch); changed.add(m); }
    }
  }
  return { months, changed: [...changed].sort(), notTaken };
}

const homeTurns = new Map<string, Promise<void>>();

async function syncDir(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeUnlocked(context: ShareContext, input: {
  months: Record<string, SessionMonth>; changed: readonly string[]; positions: Positions; currentMonth?: string;
}): Promise<WriteResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { written: false, refused: access.reason, held: [] };
  const current = input.currentMonth ?? monthOf((context.now ?? Date.now)()), changed = [...new Set(input.changed)].sort();
  for (const m of changed) if (!Object.hasOwn(input.months, m) || input.months[m]!.month !== m) throw new Error(`Missing month: ${m}`);
  const check = await readSessionRecord(context.home, [current, ...changed]);
  if (check.held.length) return { written: false, refused: check.held.map(h => h.reason).join(' '), held: check.held };
  const store = storeDirectory(context.home), dir = sessionsDirectory(context.home);
  const [storeExisted, dirExisted] = await Promise.all([lstat(store), lstat(dir)].map(p => p.then(() => true, () => false)));
  if (dirExisted) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch {
      const reason = 'The sessions folder could not be read.';
      return { written: false, refused: reason, held: [{ file: 'sessions', kind: 'damaged', reason }] };
    }
    for (const e of entries) if (e.isFile() && TEMP_FILE_RE.test(e.name)) await rm(join(dir, e.name), { force: true });
  }
  if (!dirExisted) await mkdir(dir, { recursive: true });
  for (const m of changed) await writeDurably(join(dir, `${m}.json`), JSON.stringify(input.months[m]));
  if (!dirExisted) { if (!storeExisted) await syncDir(context.home); await syncDir(store); }
  await syncDir(dir);
  await writeDurably(join(dir, POSITIONS_FILE), JSON.stringify(input.positions));
  return { written: true, held: [] };
}

/**
 * Runs one read-to-commit turn per home via a plain promise chain, passing a `write` for that turn.
 * Not re-entrant: calling this or `writeSessionRecord` from inside `work` for the same home is a caller bug and deadlocks.
 */
export async function withSessionRecordTurn<T>(home: string, work: (write: typeof writeUnlocked) => Promise<T>): Promise<T> {
  const key = (await landingOf(home)) ?? resolve(home), prev = homeTurns.get(key) ?? Promise.resolve();
  const done = prev.then(() => work(writeUnlocked));
  const tail = done.then(() => undefined, () => undefined);
  homeTurns.set(key, tail);
  try { return await done; } finally { if (homeTurns.get(key) === tail) homeTurns.delete(key); }
}

/** Safely writes changed months, fsyncs `sessions/` (and its parent if newly made; skipped on Windows), then writes `positions.json`. */
export const writeSessionRecord = (context: ShareContext, input: Parameters<typeof writeUnlocked>[1]): Promise<WriteResult> =>
  withSessionRecordTurn(context.home, write => write(context, input));

// The kept session-costs record under `.central-knot/sessions/`: compact JSON files per local month (`YYYY-MM.json`) holding
// deduplicated receipts and interned pricing metadata, plus `positions.json` for file checkpoints. Owns: the record's shapes,
// local-month helpers, reading and v1 shape checks, holding newer/damaged/non-file/symlink paths untouched, the pure upsert by
// tool and request key, per-home read-to-commit serialization, and the safe write (writeAccess only, never libraryGate or
// liftFirst; stray temps removed, durable months, folder fsync where supported, then positions).
//
// Caller contract for a sweep: enter `withSessionRecordTurn(home, async ({ read, write }) => ...)`, call `read` with every
// month its requests fall in plus the month before each, stop if `sessions`, the current month or `positions.json` is held,
// call `upsertSessionRecord`, keep old checkpoints for files whose requests came back in `notTaken` (`held` or `not-read`),
// then call `write` (which writes changed months durably and fsyncs `sessions/` before writing `positions.json`). Read-only
// callers (such as a page reading one kept month) call `readSessionRecord` directly.
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
  at: number; model: string; tokens: Tokens; dollars?: number;
  /** Index into the enclosing `SessionMonth.pricings` table. */
  pricing: number;
  speed?: string; serviceTier?: string;
}
export interface KeptSession {
  tool: HarnessId; session: string; parent?: string; project?: string;
  /** Count of unreadable lines/records reported by the latest reading of this session. */
  unread: number;
  /** Tool-reported session total (never added to sums); `complete` is true only when the whole session tree was covered. */
  reported?: { dollars: number; complete: boolean };
  /** Kept receipts keyed by request id as supplied to `upsertSessionRecord`. */
  requests: Record<string, Receipt>;
}
export interface SessionMonth { formatVersion: 1; month: string; pricings: PricingEntry[]; sessions: KeptSession[] }
/** Tracked file checkpoints (`dev` and `ino` are strings because Windows file ids exceed 2^53). */
export interface Positions {
  formatVersion: 1;
  /** Epoch ms when the last sweep wrote checkpoints (`0` when no sweep has written yet). */
  sweptAt: number;
  files: {
    tool: HarnessId; dev: string; ino: string;
    /** Byte offset after the last complete line read from this file. */
    offset: number;
    /** 16-hex SHA-256 prefix of the 4 KiB immediately before `offset`, catching inode reuse or same-length rewrites. */
    before: string;
    size: number; mtimeMs: number;
    /** Saved Codex rollout parser state for resuming at `offset`. */
    codex?: CodexState;
  }[];
}
export interface HeldEntry { file: string; kind: 'newer' | 'damaged' | 'not-a-file' | 'link'; reason: string }
export interface SessionRecord {
  /** Sorted unique `YYYY-MM` months requested by the read (whether present on disk, empty, or held). */
  readMonths: string[];
  months: Record<string, SessionMonth>; positions: Positions; held: HeldEntry[];
}
export interface UpsertResult {
  months: Record<string, SessionMonth>; changed: string[];
  notTaken: {
    tool: HarnessId; session: string; request: PricedRequest; month?: string;
    reason: 'empty-key' | 'invalid-time' | 'held' | 'not-read';
  }[];
}
export interface WriteInput {
  months: Record<string, SessionMonth>; changed: readonly string[]; positions: Positions;
  /** Local `YYYY-MM` treated as the current month for the hold gate; defaults to `monthOf((context.now ?? Date.now)())`. */
  currentMonth?: string;
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
function assertMonth(month: string): void {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new RangeError(`Invalid session month: ${month}`);
}

const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const nonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const nonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const optStr = (v: unknown): boolean => v === undefined || typeof v === 'string';
const isTool = (v: unknown): v is HarnessId => typeof v === 'string' && harnessIds.includes(v as HarnessId);

function isTokens(v: unknown): v is Tokens {
  const t = record(v);
  return !!t && whole(t.input) && whole(t.cacheRead) && whole(t.cacheWrite) && whole(t.output)
    && (t.cacheWrite1h === undefined || whole(t.cacheWrite1h));
}
function isPricing(v: unknown): v is PricingEntry {
  const p = record(v);
  if (!p || typeof p.priced !== 'boolean') return false;
  if (!p.priced) return nonEmptyStr(p.reason) && typeof p.detail === 'string';
  if (p.basis === 'reported') return true;
  if (p.basis === 'credits') return nonNeg(p.credits);
  const m = p.basis === 'list' ? record(p.matched) : undefined;
  return !!m && nonEmptyStr(p.ratesDate) && (p.atLeast === undefined || p.atLeast === true)
    && nonEmptyStr(m.provider) && nonEmptyStr(m.model)
    && (m.by === 'exact' || m.by === 'rule') && (m.providerFrom === 'request' || m.providerFrom === 'tool');
}
function isCodexState(v: unknown): v is CodexState {
  const c = record(v);
  return !!c && optStr(c.session) && optStr(c.parent) && optStr(c.provider) && optStr(c.model) && optStr(c.serviceTier)
    && (c.lastTotal === undefined || isTokens(c.lastTotal))
    && (c.recordedSince === undefined || typeof c.recordedSince === 'boolean');
}
function validMonth(obj: Record<string, unknown>, month: string): SessionMonth | undefined {
  if (obj.month !== month || !Array.isArray(obj.pricings) || !obj.pricings.every(isPricing) || !Array.isArray(obj.sessions)) return undefined;
  const pricings = obj.pricings as PricingEntry[];
  for (const raw of obj.sessions) {
    const s = record(raw);
    const rep = s?.reported === undefined ? undefined : record(s.reported);
    const reqs = record(s?.requests);
    if (!s || !isTool(s.tool) || !nonEmptyStr(s.session) || !optStr(s.parent)
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
      || (f.codex !== undefined && !isCodexState(f.codex))) return undefined;
  }
  return obj as unknown as Positions;
}

const emptyRead = (readMonths: string[], held: HeldEntry[] = []): SessionRecord =>
  ({ readMonths, months: {}, positions: emptyPositions(), held });

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
 * Reads the named `YYYY-MM` months and `positions.json` without listing or creating anything on disk (for read-only callers;
 * mutations must read and write through `withSessionRecordTurn`). Checks `sessions` with `lstat` first; symlinks, non-files,
 * newer, damaged or unreadable files are reported in `held`.
 */
export async function readSessionRecord(home: string, months: readonly string[]): Promise<SessionRecord> {
  const names = [...new Set(months)].sort();
  names.forEach(assertMonth);
  const dir = sessionsDirectory(home);
  try {
    const info = await lstat(dir);
    if (info.isSymbolicLink()) return emptyRead(names, [{ file: 'sessions', kind: 'link', reason: 'The sessions folder is a link.' }]);
    if (!info.isDirectory()) return emptyRead(names, [{ file: 'sessions', kind: 'not-a-file', reason: 'The sessions path is not a folder.' }]);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return emptyRead(names);
    return emptyRead(names, [{ file: 'sessions', kind: code === 'ENOTDIR' ? 'not-a-file' : 'damaged', reason: 'The sessions folder could not be read.' }]);
  }
  const kept: Record<string, SessionMonth> = {};
  const holds: HeldEntry[] = [];
  for (const month of names) {
    const res = await readRecordFile(join(dir, `${month}.json`), `${month}.json`, obj => validMonth(obj, month));
    if (res.held) holds.push(res.held);
    else if (res.value) kept[month] = res.value;
  }
  const pos = await readRecordFile(join(dir, POSITIONS_FILE), POSITIONS_FILE, validPositions);
  if (pos.held) holds.push(pos.held);
  return { readMonths: names, months: kept, positions: pos.value ?? emptyPositions(), held: holds };
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
  return {
    at, model: req.model, tokens, pricing,
    ...(req.speed !== undefined ? { speed: req.speed } : {}), ...(req.serviceTier !== undefined ? { serviceTier: req.serviceTier } : {}),
  };
}

/**
 * Pure upsert keyed by `(tool, request)` as supplied (callers must tag legacy thread-local Codex keys upstream before calling;
 * empty keys and non-finite times return in `notTaken`). A request whose own month is held or was not read returns in `notTaken`
 * before any lookup and changes nothing anywhere. Otherwise the key is looked up across every non-held month in `source.months`
 * (a key in an unread month cannot be seen, so a sweep must read each request's month and the month before it; if a month before
 * the request's own is held, a request re-timed out of that held month can be kept twice). Exact model + token match freezes the
 * receipt; otherwise model, tokens and price are replaced keeping first session, month and `at`. Supplied session facts replace
 * the kept ones in every read month that holds the session.
 */
export function upsertSessionRecord(
  source: Pick<SessionRecord, 'readMonths' | 'months' | 'held'>,
  updates: readonly {
    tool: HarnessId; session: string; parent?: string; project?: string;
    unread?: number; reported?: { dollars: number; complete: boolean }; requests: readonly PricedRequest[];
  }[],
): UpsertResult {
  const isHeld = (m: string) => source.held.some(h => h.file === 'sessions' || h.file === `${m}.json`);
  const readSet = new Set(source.readMonths);
  const readable = [...readSet].filter(m => !isHeld(m)).sort();
  const months: Record<string, SessionMonth> = { ...source.months };
  const changed = new Set<string>();
  const notTaken: UpsertResult['notTaken'] = [];
  const byKey = new Map<string, { month: string; si: number }>();
  const bySess = new Map<string, number>();
  const byPrice = new Map<string, number>();
  for (const m of readable) {
    const data = Object.hasOwn(months, m) ? months[m] : undefined;
    if (!data) continue;
    data.pricings.forEach((p, i) => byPrice.set(`${m}\0${JSON.stringify(toPricingEntry(p))}`, i));
    data.sessions.forEach((s, si) => {
      bySess.set(`${m}\0${s.tool}\0${s.session}`, si);
      for (const key of Object.keys(s.requests)) {
        const rk = `${s.tool}\0${key}`;
        if (!byKey.has(rk)) byKey.set(rk, { month: m, si });
      }
    });
  }
  const mutable = (m: string): SessionMonth => {
    if (changed.has(m)) return months[m]!;
    changed.add(m);
    months[m] = Object.hasOwn(months, m) ? structuredClone(months[m]!) : { formatVersion: 1, month: m, pricings: [], sessions: [] };
    return months[m]!;
  };
  const putReceipt = (m: string, si: number, at: number, req: Request, price: PriceResult) => {
    const data = mutable(m);
    const entry = toPricingEntry(price);
    const pk = `${m}\0${JSON.stringify(entry)}`;
    const pi = byPrice.get(pk) ?? (data.pricings.push(entry) - 1);
    byPrice.set(pk, pi);
    Object.defineProperty(data.sessions[si]!.requests, req.request,
      { value: makeReceipt(at, req, price, pi), enumerable: true, writable: true, configurable: true });
  };
  for (const update of updates) {
    let accepted = update.requests.length === 0;
    const sk = `${update.tool}\0${update.session}`;
    for (const priced of update.requests) {
      const { request: req, price } = priced;
      const own = Number.isFinite(req.at) ? monthOf(req.at) : undefined;
      const skip = !req.request ? { reason: 'empty-key' as const }
        : !own ? { reason: 'invalid-time' as const }
        : isHeld(own) ? { month: own, reason: 'held' as const }
        : !readSet.has(own) ? { month: own, reason: 'not-read' as const }
        : undefined;
      if (skip) {
        notTaken.push({ tool: update.tool, session: update.session, request: priced, ...skip });
        continue;
      }
      const rk = `${update.tool}\0${req.request}`;
      const hit = byKey.get(rk);
      if (hit) {
        const found = months[hit.month]!.sessions[hit.si]!;
        const old = found.requests[req.request]!;
        if (found.session === update.session) accepted = true;
        if (old.model !== req.model || !sameTokens(old.tokens, req.tokens)) putReceipt(hit.month, hit.si, old.at, req, price);
        continue;
      }
      let si = bySess.get(`${own!}\0${sk}`);
      if (si === undefined) {
        si = mutable(own!).sessions.push({ tool: update.tool, session: update.session, unread: update.unread ?? 0, requests: {} }) - 1;
        bySess.set(`${own!}\0${sk}`, si);
      }
      putReceipt(own!, si, req.at, req, price);
      byKey.set(rk, { month: own!, si });
      accepted = true;
    }
    if (!accepted) continue;
    for (const m of readable) {
      const si = bySess.get(`${m}\0${sk}`);
      if (si === undefined) continue;
      const cur = months[m]!.sessions[si]!;
      const rep = update.reported;
      const patch = {
        ...(update.parent !== undefined && update.parent !== cur.parent ? { parent: update.parent } : {}),
        ...(update.project !== undefined && update.project !== cur.project ? { project: update.project } : {}),
        ...(update.unread !== undefined && update.unread !== cur.unread ? { unread: update.unread } : {}),
        ...(rep && (rep.dollars !== cur.reported?.dollars || rep.complete !== cur.reported?.complete) ? { reported: { ...rep } } : {}),
      };
      if (Object.keys(patch).length) Object.assign(mutable(m).sessions[si]!, patch);
    }
  }
  return { months, changed: [...changed].sort(), notTaken };
}

const homeTurns = new Map<string, Promise<void>>();
const refuseHeld = (held: HeldEntry[]): WriteResult => ({ written: false, refused: held.map(h => h.reason).join(' '), held });

async function syncDir(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeUnlocked(context: ShareContext, input: WriteInput, readInTurn: ReadonlySet<string>): Promise<WriteResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { written: false, refused: access.reason, held: [] };
  const current = input.currentMonth ?? monthOf((context.now ?? Date.now)());
  const changed = [...new Set(input.changed)].sort();
  for (const m of changed) {
    if (!readInTurn.has(m)) return { written: false, refused: `${m}.json was not read in this turn.`, held: [] };
    if (!Object.hasOwn(input.months, m) || input.months[m]!.month !== m) throw new Error(`Missing month: ${m}`);
  }
  const check = await readSessionRecord(context.home, [current, ...changed]);
  if (check.held.length) return refuseHeld(check.held);
  const store = storeDirectory(context.home);
  const dir = sessionsDirectory(context.home);
  const storeExisted = await lstat(store).then(() => true, () => false);
  const dirExisted = await lstat(dir).then(() => true, () => false);
  if (dirExisted) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return refuseHeld([{ file: 'sessions', kind: 'damaged', reason: 'The sessions folder could not be read.' }]);
    }
    for (const e of entries) {
      if (e.isFile() && TEMP_FILE_RE.test(e.name)) await rm(join(dir, e.name), { force: true });
    }
  }
  if (!dirExisted) await mkdir(dir, { recursive: true });
  for (const m of changed) await writeDurably(join(dir, `${m}.json`), JSON.stringify(input.months[m]));
  if (!dirExisted) {
    if (!storeExisted) await syncDir(context.home);
    await syncDir(store);
  }
  await syncDir(dir);
  await writeDurably(join(dir, POSITIONS_FILE), JSON.stringify(input.positions));
  return { written: true, held: [] };
}

/**
 * The one exported way to change a home's session record: serializes one read-to-commit turn per home via a plain promise chain.
 * Inside `work`, call `read` with every month the batch's requests fall in plus the month before each, inspect `held` (stop if
 * `sessions`, the current month or `positions.json` is held), call `upsertSessionRecord`, keep old checkpoints for files whose
 * requests returned in `notTaken`, then call `write` (refuses any month not read in this turn; writes months durably and fsyncs
 * `sessions/` before writing `positions.json`). Not re-entrant: calling this from inside `work` for the same home deadlocks.
 */
export async function withSessionRecordTurn<T>(
  home: string,
  work: (turn: {
    read: (months: readonly string[]) => Promise<SessionRecord>;
    write: (context: ShareContext, input: WriteInput) => Promise<WriteResult>;
  }) => Promise<T>,
): Promise<T> {
  const key = (await landingOf(home)) ?? resolve(home);
  const prev = homeTurns.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = prev.then(() => new Promise<void>(r => { release = r; }));
  homeTurns.set(key, tail);
  await prev;
  const readInTurn = new Set<string>();
  let active = true;
  try {
    return await work({
      read: async months => {
        const res = await readSessionRecord(home, months);
        for (const m of res.readMonths) readInTurn.add(m);
        return res;
      },
      write: async (context, input) => {
        if (!active) throw new Error('Session record turn has ended.');
        if (((await landingOf(context.home)) ?? resolve(context.home)) !== key) throw new Error('Write home does not match turn home.');
        return writeUnlocked(context, input, readInTurn);
      },
    });
  } finally {
    active = false;
    release();
    if (homeTurns.get(key) === tail) homeTurns.delete(key);
  }
}

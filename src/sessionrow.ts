// Pure rows and totals for a period's session reading (sessionday.ts DayReading), for the Sessions page: turns read sessions
// into ordered session rows (newest first), nests child sessions (an agent's) under their parent (chronological; orphan children
// stay at top level, once), computes per-model tokens and list-price sums (the one sum in the codebase), each row's own and with
// its children's, keeps a root session's tool-reported figure beside its sum without adding it to any total, and computes
// period, per-tool and per-model totals (each request once; sessions counted at top level) with each present tool's unread
// flag beside the rows, a tool's and the day's sum a lower bound where some of that history could not be read (the one place
// that is decided), and each price list date the requests were priced from, once (`ratesDates`). A period of several days is
// cut at its local midnights into a DayRows a day beside the whole period's totals (dayByDay, the Sessions page's 7 days).
// Not here: reading session files or the kept record (sessionday.ts, sessionrequests.ts), pricing requests (rates.ts), IPC,
// or page wording/DOM.
import type { UnpricedReason } from './rates.ts';
import type { Tokens } from './sessionrequests.ts';
import type { SessionTool } from './presence.ts';
import type { DayReading, Period, PricedRequest, ReadSession } from './sessionday.ts';

/** A saved model id matched by a wider rule (`by: 'rule'`), and a provider with whether it came from the request or tool. */
export interface PricedAs { model: string; as: string }
export interface PricedProvider { provider: string; from: 'request' | 'tool' }
/**
 * A speed or service tier the list has no rate for on the request's model: `which` of the two rates.ts priceRequest refused
 * (`unsupported-speed`, `unsupported-service-tier`), its value as the tool `saved` it (`fast`, `priority`), and how many `requests`.
 */
export interface SpeedOrTier { which: 'speed' | 'serviceTier'; saved: string; requests: number }
/**
 * Unpriced requests in a CostSum, grouped from rates.ts UnpricedReason as the page will say them: `noRow` (`not-in-table`)
 * and `other` (every other reason but a refused speed or tier) as counts, and `speedOrTier`, one entry per refused value.
 */
export interface UnpricedBy { noRow: number; speedOrTier: SpeedOrTier[]; other: number }
/**
 * Sum of list prices for a row, model or total: `dollars` (undefined when no request had a known price, never $0),
 * `unpriced` and `unpricedBy` (unpriced requests total and by reason; never "N of M", since unread lines make M unknown),
 * `oneHourLow` (true if any priced request's one-hour cache writes were priced at the shorter cache's rate), `atLeast` (the
 * sum is a lower bound: `oneHourLow`, or, for a tool's sum and the day's, some of that history could not be read),
 * `pricedAs` (unique wider-rule matches), and `providers`.
 */
export interface CostSum {
  dollars: number | undefined; unpriced: number; unpricedBy: UnpricedBy; oneHourLow: boolean; atLeast: boolean;
  pricedAs: PricedAs[]; providers: PricedProvider[];
}
/** One saved model id's tokens and list-price sum, inside a row or across the period. */
export interface ModelCost { model: string; tokens: Tokens; cost: CostSum }
/**
 * One session's row for the period: `tokens`, `models` and `cost` of its own requests alone, `withChildren` the same sum over
 * its own and every descendant's (an agent's session and theirs; its own where it has none), its first and last request time
 * (ms, its own), optional `reported` tool figure (USD, only on a root session wholly inside the period; never in sums), and
 * nested `children`.
 */
export interface SessionRow {
  tool: SessionTool; session: string; parent?: string; project?: string;
  first: number; last: number; tokens: Tokens; models: ModelCost[]; cost: CostSum;
  withChildren: { tokens: Tokens; cost: CostSum };
  reported?: number; children: SessionRow[];
}
/** One present tool's totals for the period (`sessions`: its top-level rows), with its `unread` flag beside the rows. */
export interface ToolTotal { tool: SessionTool; sessions: number; tokens: Tokens; cost: CostSum; unread: boolean }
/** All rows, totals, per-tool status and the price lists' dates once (never per row or sum) for a period reading. */
export interface DayRows {
  period: Period;
  /** Each price list date a request here was priced from (rates.ts PriceResult's ratesDate), oldest first; none where none was. */
  ratesDates: string[];
  rows: SessionRow[];
  /** `sessions`: the top-level rows, a child counted in its parent's. */
  total: { sessions: number; tokens: Tokens; cost: CostSum };
  byTool: ToolTotal[]; byModel: ModelCost[];
}
/** A local day of a period of several days, as the Sessions page shows it: its total and its rows, nothing else. */
export type PeriodDay = Pick<DayRows, 'period' | 'total' | 'rows'>;
/**
 * A period day by day (dayByDay): the whole period's totals, with no rows of their own (its sessions' count is of the whole
 * period, so a session on two days counts once there), and each local day with sessions, newest first.
 */
export interface PeriodRows extends Omit<DayRows, 'rows'> { days: PeriodDay[] }

const totalTokens = (t: Tokens) => t.input + t.cacheRead + t.cacheWrite + t.output;

const UNPRICED_BUCKET: Record<UnpricedReason, 'noRow' | SpeedOrTier['which'] | 'other'> = {
  'not-in-table': 'noRow',
  'unsupported-speed': 'speed', 'unsupported-service-tier': 'serviceTier',
  'no-provider': 'other', 'missing-rate': 'other', 'invalid-tokens': 'other', 'invalid-time': 'other', 'invalid-credits': 'other',
};

/** Sums token counts (`cacheWrite1h` stays inside `cacheWrite`, kept when > 0) and list-price metadata in one pass. */
function tally(requests: readonly PricedRequest[]): { tokens: Tokens; cost: CostSum } {
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cacheWrite1h = 0;
  let output = 0;
  let dollars = 0;
  let priced = 0;
  let unpriced = 0;
  let oneHourLow = false;
  const counted = { noRow: 0, other: 0 };
  const refused = new Map<string, SpeedOrTier>();
  const asMap = new Map<string, PricedAs>();
  const provMap = new Map<string, PricedProvider>();
  for (const { request, price } of requests) {
    const { model, tokens: t } = request;
    input += t.input;
    cacheRead += t.cacheRead;
    cacheWrite += t.cacheWrite;
    cacheWrite1h += t.cacheWrite1h ?? 0;
    output += t.output;
    if (!price.priced) {
      unpriced++;
      const bucket = UNPRICED_BUCKET[price.reason];
      if (bucket === 'noRow' || bucket === 'other') {
        counted[bucket]++;
        continue;
      }
      const saved = (bucket === 'speed' ? request.speed : request.serviceTier) ?? '';
      const key = `${bucket}\0${saved}`;
      const entry = refused.get(key) ?? { which: bucket, saved, requests: 0 };
      entry.requests++;
      refused.set(key, entry);
      continue;
    }
    dollars += price.dollars;
    priced++;
    if (price.basis !== 'list') continue;
    if (price.atLeast) oneHourLow = true;
    if (price.matched.by === 'rule') asMap.set(`${model}\0${price.matched.model}`, { model, as: price.matched.model });
    provMap.set(`${price.matched.provider}\0${price.matched.providerFrom}`, { provider: price.matched.provider, from: price.matched.providerFrom });
  }
  const pricedAs = [...asMap.values()].sort((a, b) => a.model.localeCompare(b.model) || a.as.localeCompare(b.as));
  const providers = [...provMap.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.from.localeCompare(b.from));
  const speedOrTier = [...refused.values()].sort((a, b) => a.which.localeCompare(b.which) || a.saved.localeCompare(b.saved));
  const unpricedBy: UnpricedBy = { noRow: counted.noRow, speedOrTier, other: counted.other };
  return {
    tokens: { input, cacheRead, cacheWrite, ...(cacheWrite1h > 0 ? { cacheWrite1h } : {}), output },
    cost: { dollars: priced > 0 ? dollars : undefined, unpriced, unpricedBy, oneHourLow, atLeast: oneHourLow, pricedAs, providers },
  };
}

/** Groups requests by saved model id, ordered by dollars descending, then total tokens descending, then model name. */
function modelsOf(requests: readonly PricedRequest[]): ModelCost[] {
  const grouped = new Map<string, PricedRequest[]>();
  for (const entry of requests) {
    const list = grouped.get(entry.request.model) ?? [];
    list.push(entry);
    grouped.set(entry.request.model, list);
  }
  return [...grouped.entries()]
    .map(([model, list]): ModelCost => ({ model, ...tally(list) }))
    .sort((a, b) => (b.cost.dollars ?? -1) - (a.cost.dollars ?? -1) || totalTokens(b.tokens) - totalTokens(a.tokens) || a.model.localeCompare(b.model));
}

/** What nesting needs of a session or its row: which tool's, its id, and the session it is a child of, if any. */
interface Nestable { tool: SessionTool; session: string; parent?: string }
const keyed = <S extends Nestable>(items: readonly S[]) => new Map(items.map(item => [`${item.tool}\0${item.session}`, item]));

function hasAncestor<S extends Nestable>(start: S, target: S, byKey: Map<string, S>): boolean {
  const seen = new Set<S>();
  for (let cur: S | undefined = start; cur && !seen.has(cur); cur = cur.parent ? byKey.get(`${cur.tool}\0${cur.parent}`) : undefined) {
    if (cur === target) return true;
    seen.add(cur);
  }
  return false;
}
/** The one rule of nesting: under its parent where the parent was read too, is not itself and is not below it (no cycle); else at the top. */
function parentOf<S extends Nestable>(item: S, byKey: Map<string, S>): S | undefined {
  const parent = item.parent ? byKey.get(`${item.tool}\0${item.parent}`) : undefined;
  return parent && parent !== item && !hasAncestor(parent, item, byKey) ? parent : undefined;
}

/** A reading's session rows: each session's own sums, children nested under parents, newest first. */
function rowsOf(reading: DayReading): SessionRow[] {
  const allRows: SessionRow[] = [];
  const own = new Map<SessionRow, readonly PricedRequest[]>();
  for (const s of reading.tools.flatMap(toolReading => toolReading.sessions)) {
    const first = s.requests.reduce((min, { request }) => Math.min(min, request.at), Infinity);
    const last = s.requests.reduce((max, { request }) => Math.max(max, request.at), -Infinity);
    const sum = tally(s.requests);
    const row: SessionRow = {
      tool: s.tool, session: s.session,
      ...(s.parent ? { parent: s.parent } : {}), ...(s.project ? { project: s.project } : {}),
      first, last, ...sum, models: modelsOf(s.requests), withChildren: sum,
      ...(s.reported !== undefined ? { reported: s.reported } : {}), children: [],
    };
    own.set(row, s.requests);
    allRows.push(row);
  }
  const byKey = keyed(allRows);
  const rows: SessionRow[] = [];
  for (const row of allRows) {
    const parent = parentOf(row, byKey);
    if (parent) parent.children.push(row);
    else rows.push(row);
  }
  for (const row of allRows) row.children.sort((a, b) => a.first - b.first || a.last - b.last || a.session.localeCompare(b.session));
  rows.sort((a, b) => b.last - a.last || b.first - a.first || a.tool.localeCompare(b.tool) || a.session.localeCompare(b.session));
  // A row's requests with its descendants' (the nesting above has no cycle), summed once per row that has children.
  const family = (row: SessionRow): PricedRequest[] => [...own.get(row)!, ...row.children.flatMap(family)];
  for (const row of allRows) if (row.children.length) row.withChildren = tally(family(row));
  return rows;
}

// A sum over history some of which could not be read is a lower bound: a tool's, and the day's. (A row is its files' own.)
const lowerBound = ({ tokens, cost }: ReturnType<typeof tally>, unread: boolean) => ({ tokens, cost: unread ? { ...cost, atLeast: true } : cost });
const requestsOf = (reading: DayReading) => reading.tools.flatMap(t => t.sessions.flatMap(s => s.requests));
/** A reading's total: each request once, `top` its top-level sessions (a child counted in its parent's). */
const totalOf = (reading: DayReading, top: readonly Nestable[]): DayRows['total'] =>
  ({ sessions: top.length, ...lowerBound(tally(requestsOf(reading)), reading.tools.some(t => t.unread)) });

/** A reading's totals, by tool and by model, and each price list date once, with `top` its top-level sessions; no rows. */
function totalsOf(reading: DayReading, top: readonly Nestable[]): Omit<DayRows, 'rows'> {
  const byTool = reading.tools.map(({ tool, sessions, unread }): ToolTotal => ({
    tool, sessions: top.filter(each => each.tool === tool).length, ...lowerBound(tally(sessions.flatMap(s => s.requests)), unread), unread,
  }));
  const allRequests = requestsOf(reading);
  const ratesDates = new Set(allRequests.flatMap(({ price }) => (price.priced && price.basis === 'list' ? [price.ratesDate] : [])));
  return { period: reading.period, ratesDates: [...ratesDates].sort(), total: totalOf(reading, top), byTool, byModel: modelsOf(allRequests) };
}

/** Turns a period reading into ordered session rows (children nested under parents) and period, tool and model totals. */
export function sessionRows(reading: DayReading): DayRows {
  const rows = rowsOf(reading);
  return { ...totalsOf(reading, rows), rows };
}

/** The reading's requests inside `period` (a session with none there left out), the period's own. */
function within(reading: DayReading, period: Period): DayReading {
  const inside = ({ request }: PricedRequest) => request.at >= period.start && request.at < period.end;
  const sessionsIn = (sessions: ReadSession[]) => sessions.map(s => ({ ...s, requests: s.requests.filter(inside) })).filter(s => s.requests.length);
  return { period, tools: reading.tools.map(tool => ({ ...tool, sessions: sessionsIn(tool.sessions) })) };
}

/**
 * A reading cut at the local midnights `bounds` (oldest first, the period's end last): the whole reading's totals (its top-level
 * sessions counted by the one rule of nesting, no rows built), and for each day with sessions, newest first, its rows and total
 * only. A session that ran on two days is a row under each; its parts on one day are one row.
 */
export function dayByDay(reading: DayReading, bounds: readonly number[]): PeriodRows {
  const sessions = reading.tools.flatMap(tool => tool.sessions);
  const byKey = keyed(sessions);
  const days = bounds.slice(0, -1).map((start, index): PeriodDay => {
    const day = within(reading, { start, end: bounds[index + 1]! });
    const rows = rowsOf(day);
    return { period: day.period, total: totalOf(day, rows), rows };
  });
  return { ...totalsOf(reading, sessions.filter(s => !parentOf(s, byKey))), days: days.filter(day => day.rows.length).reverse() };
}

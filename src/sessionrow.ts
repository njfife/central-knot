// Pure rows and totals for a period's session reading (sessionday.ts DayReading), for the Sessions page: turns read sessions
// into ordered session rows (newest first), nests child sessions under their parent (chronological; orphan children stay at
// top level, once), computes per-model tokens and list-price sums, keeps a root session's tool-reported figure beside its sum
// without adding it to any total, and computes period, per-tool and per-model totals with each present tool's unread flag
// beside the rows and the price list's date once.
// Not here: reading session files (sessionday.ts, sessionrequests.ts), pricing requests (rates.ts), IPC, or page wording/DOM.
import type { Tokens } from './sessionrequests.ts';
import type { DayReading, Period, PricedRequest, SessionTool } from './sessionday.ts';

/** A saved model id matched by a wider rule (`by: 'rule'`), and a provider with whether it came from the request or tool. */
export interface PricedAs { model: string; as: string }
export interface PricedProvider { provider: string; from: 'request' | 'tool' }
/**
 * Sum of list prices for a row, model or total: `dollars` (undefined when no request had a known price, never $0),
 * `unpriced` (requests with no known price; never "N of M", since unread lines make M unknown), `atLeast` (true if any
 * priced request used a lower bound), `pricedAs` (unique wider-rule matches), and `providers` (unique providers used).
 */
export interface CostSum {
  dollars: number | undefined; unpriced: number; atLeast: boolean;
  pricedAs: PricedAs[]; providers: PricedProvider[];
}
/** One saved model id's tokens and list-price sum, inside a row or across the period. */
export interface ModelCost { model: string; tokens: Tokens; cost: CostSum }
/**
 * One session's row for the period: its own requests alone (never its children's), its first and last request time (ms),
 * optional `reported` tool figure (USD, only on a root session wholly inside the period; never in sums), and nested `children`.
 */
export interface SessionRow {
  tool: SessionTool; session: string; parent?: string; project?: string;
  first: number; last: number; tokens: Tokens; models: ModelCost[]; cost: CostSum;
  reported?: number; children: SessionRow[];
}
/** One present tool's totals for the period, with its `unread` flag beside the rows. */
export interface ToolTotal { tool: SessionTool; sessions: number; tokens: Tokens; cost: CostSum; unread: boolean }
/** All rows, totals, per-tool status and the price list's date once (never per row or sum) for a period reading. */
export interface DayRows {
  period: Period; ratesDate: string; rows: SessionRow[];
  total: { sessions: number; tokens: Tokens; cost: CostSum };
  byTool: ToolTotal[]; byModel: ModelCost[];
}

const totalTokens = (t: Tokens) => t.input + t.cacheRead + t.cacheWrite + t.output;

/** Sums token counts (`cacheWrite1h` stays inside `cacheWrite`, kept when > 0) and list-price metadata in one pass. */
function tally(requests: readonly PricedRequest[]): { tokens: Tokens; cost: CostSum } {
  let input = 0, cacheRead = 0, cacheWrite = 0, cacheWrite1h = 0, output = 0;
  let dollars = 0, priced = 0, unpriced = 0, atLeast = false;
  const asMap = new Map<string, PricedAs>(), provMap = new Map<string, PricedProvider>();
  for (const { request: { model, tokens: t }, price } of requests) {
    input += t.input;
    cacheRead += t.cacheRead;
    cacheWrite += t.cacheWrite;
    cacheWrite1h += t.cacheWrite1h ?? 0;
    output += t.output;
    if (!price.priced) { unpriced++; continue; }
    dollars += price.dollars;
    priced++;
    if (price.basis !== 'list') continue;
    if (price.atLeast) atLeast = true;
    if (price.matched.by === 'rule') asMap.set(`${model}\0${price.matched.model}`, { model, as: price.matched.model });
    provMap.set(`${price.matched.provider}\0${price.matched.providerFrom}`, { provider: price.matched.provider, from: price.matched.providerFrom });
  }
  const pricedAs = [...asMap.values()].sort((a, b) => a.model.localeCompare(b.model) || a.as.localeCompare(b.as));
  const providers = [...provMap.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.from.localeCompare(b.from));
  return {
    tokens: { input, cacheRead, cacheWrite, ...(cacheWrite1h > 0 ? { cacheWrite1h } : {}), output },
    cost: { dollars: priced > 0 ? dollars : undefined, unpriced, atLeast, pricedAs, providers },
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

function hasAncestor(start: SessionRow, target: SessionRow, byKey: Map<string, SessionRow>): boolean {
  const seen = new Set<SessionRow>();
  for (let cur: SessionRow | undefined = start; cur && !seen.has(cur); cur = cur.parent ? byKey.get(`${cur.tool}\0${cur.parent}`) : undefined) {
    if (cur === target) return true;
    seen.add(cur);
  }
  return false;
}

/** Turns a period reading into ordered session rows (children nested under parents) and period, tool and model totals. */
export function sessionRows(reading: DayReading): DayRows {
  const allRows: SessionRow[] = [], byTool: ToolTotal[] = [];
  for (const toolReading of reading.tools) {
    const sessions = toolReading.sessions.filter(s => s.requests.length > 0);
    for (const s of sessions) {
      const first = s.requests.reduce((min, { request }) => Math.min(min, request.at), Infinity);
      const last = s.requests.reduce((max, { request }) => Math.max(max, request.at), -Infinity);
      allRows.push({
        tool: s.tool, session: s.session,
        ...(s.parent ? { parent: s.parent } : {}), ...(s.project ? { project: s.project } : {}),
        first, last, ...tally(s.requests), models: modelsOf(s.requests),
        ...(s.reported !== undefined ? { reported: s.reported } : {}), children: [],
      });
    }
    byTool.push({ tool: toolReading.tool, sessions: sessions.length, ...tally(sessions.flatMap(s => s.requests)), unread: toolReading.unread });
  }
  const byKey = new Map(allRows.map(row => [`${row.tool}\0${row.session}`, row]));
  const rows: SessionRow[] = [];
  for (const row of allRows) {
    const parent = row.parent ? byKey.get(`${row.tool}\0${row.parent}`) : undefined;
    if (parent && parent !== row && !hasAncestor(parent, row, byKey)) parent.children.push(row);
    else rows.push(row);
  }
  for (const row of allRows) row.children.sort((a, b) => a.first - b.first || a.last - b.last || a.session.localeCompare(b.session));
  rows.sort((a, b) => b.last - a.last || b.first - a.first || a.tool.localeCompare(b.tool) || a.session.localeCompare(b.session));
  const allRequests = reading.tools.flatMap(t => t.sessions.flatMap(s => s.requests));
  return {
    period: reading.period, ratesDate: reading.ratesDate, rows,
    total: { sessions: allRows.length, ...tally(allRequests) }, byTool, byModel: modelsOf(allRequests),
  };
}

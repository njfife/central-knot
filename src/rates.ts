// Offline model pricing from the checked-in rates table (assets/model-rates.json, built and validated by
// scripts/build-rates.ts from Pydantic's genai-prices MIT list). Owns: the bundled table (bundledRates), first-party
// tool providers (TOOL_PROVIDERS), the one rule for a tool-reported cost (reportedCost), pricing one request
// (priceRequest), AI credits (priceCredits, USD_PER_AI_CREDIT), and coverage totals (sumPrices, coverageText).
// Not here: reading session files (sessionrequests.ts), table validation (scripts/build-rates.ts), network fetches,
// UI pages, or user price overrides.
import rawRates from '../assets/model-rates.json' with { type: 'json' };
import type { Request } from './sessionrequests.ts';
import type { HarnessId } from './types.ts';

/** Match clauses used by genai-prices at revision 55b1818ba5ed431d09d93c0622c76beec09292cc (`and` is unused there). */
export type MatchClause =
  | { equals: string } | { starts_with: string } | { ends_with: string } | { contains: string } | { regex: string }
  | { or: MatchClause[] } | { and: MatchClause[] };

export interface RateValues { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
export interface RateTier extends RateValues { above: number }
export interface ModelRate extends RateValues { id: string; match: MatchClause; tiers?: RateTier[]; timeOfDay?: true }
export interface ProviderRates { id: string; match?: MatchClause; fallbacks?: string[]; models: ModelRate[] }
export interface RatesSource { name: string; url: string; revision: string; license: string; notice: string }
export interface RatesTable { format: 1; date: string; source: RatesSource; providers: ProviderRates[] }

/** One request's pricing inputs: a subset of sessionrequests.ts Request so any Request passes straight in. */
export type PriceInput = Pick<Request, 'tool' | 'model' | 'provider' | 'tokens' | 'speed' | 'serviceTier' | 'reported'>;

/** How a request matched a row: its provider and model id, exact id vs wider list rule, and provider origin. */
export interface PriceMatch {
  provider: string;
  model: string;
  by: 'exact' | 'rule';
  providerFrom: 'request' | 'tool';
}

export type UnpricedReason =
  | 'no-provider' | 'not-in-table' | 'missing-rate' | 'missing-tier'
  | 'unsupported-speed' | 'unsupported-service-tier' | 'invalid-tokens' | 'invalid-credits';

export type PriceResult =
  | { priced: true; dollars: number; basis: 'list'; ratesDate: string; matched: PriceMatch; atLeast?: true }
  | { priced: true; dollars: number; basis: 'reported' }
  | { priced: true; dollars: number; credits: number; basis: 'credits' }
  | { priced: false; reason: UnpricedReason; detail: string };

/** Sum of priced requests; `dollars` is undefined when `priced` is 0 so unpriced requests never count as $0. */
export interface PriceSum { dollars: number | undefined; priced: number; total: number; atLeast: number; credits?: number }

/** GitHub documents 1 AI credit = $0.01 USD (docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing). */
export const USD_PER_AI_CREDIT = 0.01;

/** First-party API provider when a tool's history saves none (only the two tools whose session readers exist). */
export const TOOL_PROVIDERS: Readonly<Partial<Record<HarnessId, string>>> = { 'claude-cli': 'anthropic', 'codex-cli': 'openai' };

/** The checked-in rates table, loaded offline as written by scripts/build-rates.ts. */
export const bundledRates = rawRates as unknown as RatesTable;

const whole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const noPrice = (reason: UnpricedReason, detail: string): PriceResult => ({ priced: false, reason, detail });

/** Evaluates a genai-prices MatchLogic clause against a lowercased string (types.py:1138-1192). */
function matchesClause(clause: MatchClause, lower: string): boolean {
  if ('equals' in clause) return lower === clause.equals.toLowerCase();
  if ('starts_with' in clause) return lower.startsWith(clause.starts_with.toLowerCase());
  if ('ends_with' in clause) return lower.endsWith(clause.ends_with.toLowerCase());
  if ('contains' in clause) return lower.includes(clause.contains.toLowerCase());
  if ('regex' in clause) return new RegExp(clause.regex).test(lower);
  if ('or' in clause) return clause.or.some(part => matchesClause(part, lower));
  return clause.and.every(part => matchesClause(part, lower));
}

/** Rewrites compact `-YYYYMMDD` suffixes to `-YYYY-MM-DD`, matching genai-prices types.py:363-382. */
function normalizeCompactDate(ref: string): string {
  return ref.replace(/(-)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=-|:|$)/g, (all, dash, y, m, d) => {
    const iso = `${y}-${m}-${d}`;
    return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? `${dash}${iso}` : all;
  });
}

/**
 * Matches a provider id following genai-prices data_snapshot.py:168-188 (rev 55b1818ba5ed431d09d93c0622c76beec09292cc):
 * exact provider id first (case-insensitive, trimmed), then the first provider match in list order.
 */
function findProvider(providerId: string, table: RatesTable): ProviderRates | undefined {
  const ref = providerId.trim().toLowerCase();
  if (!ref) return undefined;
  return table.providers.find(p => p.id.toLowerCase() === ref)
    ?? table.providers.find(p => p.match !== undefined && matchesClause(p.match, ref));
}

/**
 * Matches a model id inside a resolved provider following genai-prices types.py:416-438 (rev 55b1818ba5ed431d09d93c0622c76beec09292cc),
 * with exact row id first: (1) exact model id (case-insensitive), then first `model.match` in list order; (2) one hop into
 * `provider.fallbacks` in list order; (3) if unmatched, retry (1)-(2) after compact-date normalization (`-YYYYMMDD` to `-YYYY-MM-DD`).
 */
function findModel(provider: ProviderRates, modelId: string, table: RatesTable): { provider: string; rate: ModelRate; by: 'exact' | 'rule' } | undefined {
  const ref = modelId.toLowerCase();
  if (!ref) return undefined;
  const candidates = [provider];
  for (const id of provider.fallbacks ?? []) {
    const fallback = table.providers.find(p => p.id === id);
    if (fallback) candidates.push(fallback);
  }
  const search = (text: string) => {
    for (const p of candidates) {
      const exact = p.models.find(m => m.id.toLowerCase() === text);
      if (exact) return { provider: p.id, rate: exact, by: (exact.id.toLowerCase() === ref ? 'exact' : 'rule') as 'exact' | 'rule' };
      const rule = p.models.find(m => matchesClause(m.match, text));
      if (rule) return { provider: p.id, rate: rule, by: 'rule' as const };
    }
    return undefined;
  };
  const hit = search(ref);
  if (hit) return hit;
  const normalized = normalizeCompactDate(ref);
  return normalized !== ref ? search(normalized) : undefined;
}

/**
 * The one rule for a tool-reported cost in USD (used for Request.reported and SessionRead.treeReported):
 * a finite figure above zero wins; zero, negative, non-finite or absent falls back to list pricing.
 */
export function reportedCost(reported: number | undefined): number | undefined {
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) return reported;
  return undefined;
}

/** Prices one request from a tool's history. Reported cost > 0 wins; otherwise uses the list's own rules. */
export function priceRequest(input: PriceInput, table: RatesTable = bundledRates): PriceResult {
  const reported = reportedCost(input.reported);
  if (reported !== undefined) return { priced: true, dollars: reported, basis: 'reported' };

  const { tokens } = input;
  const validTokens =
    whole(tokens.input) && whole(tokens.cacheRead) && whole(tokens.cacheWrite) && whole(tokens.output)
    && (tokens.cacheWrite1h === undefined || (whole(tokens.cacheWrite1h) && tokens.cacheWrite1h <= tokens.cacheWrite));
  if (!validTokens) return noPrice('invalid-tokens', 'Token counts must be non-negative whole numbers');

  // genai-prices at revision 55b1818ba5ed431d09d93c0622c76beec09292cc has no rates for non-standard speed or serviceTier.
  if (input.speed !== undefined && input.speed !== 'standard') return noPrice('unsupported-speed', `No rate for speed ${input.speed}`);
  if (input.serviceTier !== undefined && input.serviceTier !== 'standard') return noPrice('unsupported-service-tier', `No rate for service tier ${input.serviceTier}`);

  const savedProvider = input.provider?.trim();
  const providerFrom: 'request' | 'tool' = savedProvider ? 'request' : 'tool';
  const providerId = savedProvider || TOOL_PROVIDERS[input.tool];
  if (!providerId) return noPrice('no-provider', `No provider saved for ${input.tool}`);

  const provider = findProvider(providerId, table);
  if (!provider) return noPrice('not-in-table', `Provider ${providerId} is not in the table`);

  const hit = findModel(provider, input.model, table);
  if (!hit) return noPrice('not-in-table', `${provider.id}/${input.model} is not in the table`);
  if (hit.rate.timeOfDay) return noPrice('missing-tier', `${hit.provider}/${hit.rate.id} uses time-of-day pricing`);

  const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  let values: RateValues = hit.rate;
  if (hit.rate.tiers?.length) {
    for (const tier of [...hit.rate.tiers].sort((a, b) => a.above - b.above)) {
      if (promptTokens > tier.above) values = tier;
    }
  }

  // Per genai-prices types.py:822-858, 977-989, decompose.py:14-36 and data_units.py:7-28 (rev 55b1818ba5ed431d09d93c0622c76beec09292cc),
  // cache_read_tokens and cache_write_tokens are descendants of input_tokens and are charged at input_mtok when a row lacks its own rate.
  const parts: [number, number | undefined, string][] = [
    [tokens.input, values.input, 'input'],
    [tokens.cacheRead, values.cacheRead ?? values.input, 'cache-read'],
    [tokens.cacheWrite, values.cacheWrite ?? values.input, 'cache-write'],
    [tokens.output, values.output, 'output'],
  ];
  let dollars = 0;
  for (const [count, rate, label] of parts) {
    if (count > 0 && rate === undefined) return noPrice('missing-rate', `No ${label} rate for ${hit.provider}/${hit.rate.id}`);
    dollars += count * (rate ?? 0);
  }
  dollars /= 1_000_000;

  const matched: PriceMatch = { provider: hit.provider, model: hit.rate.id, by: hit.by, providerFrom };
  // cacheWrite1h sits inside cacheWrite; the list holds one cache-write rate and 1h writes cost more, so mark "at least".
  const atLeast = tokens.cacheWrite1h !== undefined && tokens.cacheWrite1h > 0;
  return { priced: true, dollars, basis: 'list', ratesDate: table.date, matched, ...(atLeast ? { atLeast: true } : {}) };
}

/** Prices AI credits (e.g. GitHub Copilot) at USD_PER_AI_CREDIT ($0.01 each), keeping the credit count beside the dollars. */
export function priceCredits(credits: number): PriceResult {
  if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) {
    return noPrice('invalid-credits', 'Credits must be a non-negative finite number');
  }
  return { priced: true, dollars: credits / Math.round(1 / USD_PER_AI_CREDIT), credits, basis: 'credits' };
}

/** Sums priced requests and counts coverage; an unpriced request never counts as $0. */
export function sumPrices(results: readonly PriceResult[]): PriceSum {
  let dollars = 0;
  let priced = 0;
  let atLeast = 0;
  let credits: number | undefined;
  for (const result of results) {
    if (!result.priced) continue;
    dollars += result.dollars;
    priced++;
    if (result.basis === 'list' && result.atLeast) atLeast++;
    if (result.basis === 'credits') credits = (credits ?? 0) + result.credits;
  }
  return { dollars: priced > 0 ? dollars : undefined, priced, total: results.length, atLeast, ...(credits !== undefined ? { credits } : {}) };
}

/** Formats coverage as "N of M priced". */
export const coverageText = (sum: Pick<PriceSum, 'priced' | 'total'>) => `${sum.priced} of ${sum.total} priced`;

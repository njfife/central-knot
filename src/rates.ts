// Offline model pricing from the checked-in rates table (assets/model-rates.json, built and validated by
// scripts/build-rates.ts from Pydantic's genai-prices MIT list, prices/new_data/v2/data_slim.json). Owns: the bundled
// table (bundledRates), first-party tool providers (TOOL_PROVIDERS), the one rule for a tool-reported cost
// (reportedCost), pricing one request as the list's own Python code does (priceRequest), AI credits (priceCredits,
// USD_PER_AI_CREDIT), and coverage totals (sumPrices, coverageText).
// Not here: reading session files (sessionrequests.ts), table validation (scripts/build-rates.ts), network fetches,
// non-text units, UI pages, or user price overrides.
import rawRates from '../assets/model-rates.json' with { type: 'json' };
import type { Request } from './sessionrequests.ts';
import type { HarnessId } from './types.ts';

/** Match clauses from genai-prices types.py:60-69 (all seven are used by prices/new_data/v2/data_slim.json). */
export type MatchClause =
  | { equals: string } | { starts_with: string } | { ends_with: string } | { contains: string } | { regex: string }
  | { or: MatchClause[] } | { and: MatchClause[] };

export interface UnitTier { start: number; price: number }
/** A flat USD-per-MTok rate, or a threshold-tiered rate sorted ascending by `start` (types.py:1016-1036). */
export type UnitPrice = number | { base: number; tiers: UnitTier[] };
export interface PriceSet { input?: UnitPrice; output?: UnitPrice; cacheRead?: UnitPrice; cacheWrite?: UnitPrice; cacheWrite1h?: UnitPrice }
export interface PriceConstraint { startDate?: string; startTime?: string; endTime?: string }
export interface ConditionalPrice { constraint?: PriceConstraint; prices: PriceSet }
export interface PriceVariant { when: Partial<Record<'speed' | 'service_tier', string>>; constraint?: PriceConstraint; prices: PriceSet }
export interface ModelRate { id: string; match: MatchClause; prices: PriceSet | ConditionalPrice[]; variants?: PriceVariant[] }
export interface ProviderRates { id: string; match?: MatchClause; fallbacks?: string[]; models: ModelRate[] }
export interface RatesSource { name: string; url: string; revision: string; license: string; notice: string }
/** Checked-in rates table: `date` is when the upstream data file was last changed; `built` is when this file was made. */
export interface RatesTable { format: 1; date: string; built: string; source: RatesSource; providers: ProviderRates[] }

/** One request's pricing inputs: a subset of sessionrequests.ts Request so any Request passes straight in. */
export type PriceInput = Pick<Request, 'tool' | 'at' | 'model' | 'provider' | 'tokens' | 'speed' | 'serviceTier' | 'reported'>;

/** How a request matched a row: provider and model id, exact row id vs wider rule, and provider origin. */
export interface PriceMatch { provider: string; model: string; by: 'exact' | 'rule'; providerFrom: 'request' | 'tool' }

export type UnpricedReason =
  | 'no-provider' | 'not-in-table' | 'missing-rate'
  | 'unsupported-speed' | 'unsupported-service-tier'
  | 'invalid-tokens' | 'invalid-time' | 'invalid-credits';

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

const DAY_MS = 86_400_000;
const ORDINARY_TIERS = new Set(['standard', 'default']);
const PRICE_KEYS: readonly (keyof PriceSet)[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'];
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
 * exact provider id first (case-insensitive, trimmed), then the first provider_match in list order.
 */
function findProvider(providerId: string, table: RatesTable): ProviderRates | undefined {
  const ref = providerId.trim().toLowerCase();
  if (!ref) return undefined;
  return table.providers.find(p => p.id.toLowerCase() === ref)
    ?? table.providers.find(p => p.match !== undefined && matchesClause(p.match, ref));
}

/**
 * Matches a model id inside a resolved provider following genai-prices types.py:416-438 (rev 55b1818ba5ed431d09d93c0622c76beec09292cc):
 * (1) first `model.match` in the provider's list order (no exact-id shortcut); (2) one hop into `provider.fallbacks`
 * in list order; (3) if unmatched, retry (1)-(2) after compact-date normalization (`-YYYYMMDD` to `-YYYY-MM-DD`).
 * `by` is `'exact'` only when the matched row's own id equals the saved id (case-insensitively), else `'rule'`.
 */
function findModel(provider: ProviderRates, modelId: string, table: RatesTable) {
  const ref = modelId.toLowerCase();
  if (!ref) return undefined;
  const matchIn = (p: ProviderRates, text: string, fallback: boolean) => {
    const rate = p.models.find(m => matchesClause(m.match, text));
    if (!rate) return undefined;
    return { provider: p.id, rate, by: (rate.id.toLowerCase() === ref ? 'exact' : 'rule') as 'exact' | 'rule', fallback };
  };
  const search = (text: string) => {
    const direct = matchIn(provider, text, false);
    if (direct) return direct;
    for (const id of provider.fallbacks ?? []) {
      const fallback = table.providers.find(p => p.id === id);
      const hit = fallback && matchIn(fallback, text, true);
      if (hit) return hit;
    }
    return undefined;
  };
  const hit = search(ref);
  if (hit) return hit;
  const normalized = normalizeCompactDate(ref);
  return normalized !== ref ? search(normalized) : undefined;
}

const timeMs = (value: string) => {
  const ms = Date.parse(`1970-01-01T${/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`}`);
  return ((ms % DAY_MS) + DAY_MS) % DAY_MS;
};

/** Evaluates StartDateConstraint and TimeOfDateConstraint at a UTC instant (types.py:1095-1136). */
function constraintActive(constraint: PriceConstraint | undefined, utcDate: string, utcTimeMs: number): boolean {
  if (!constraint) return true;
  if (constraint.startDate !== undefined) return utcDate >= constraint.startDate;
  if (constraint.startTime !== undefined && constraint.endTime !== undefined) {
    const start = timeMs(constraint.startTime);
    const end = timeMs(constraint.endTime);
    return end < start ? utcTimeMs >= start || utcTimeMs < end : start <= utcTimeMs && utcTimeMs < end;
  }
  return false;
}

/** Picks the base PriceSet in force at `at`, last active entry winning or first as fallback (types.py:730-738). */
function basePricesAt(prices: PriceSet | ConditionalPrice[], utcDate: string, utcTimeMs: number): PriceSet {
  if (!Array.isArray(prices)) return prices;
  for (let i = prices.length - 1; i >= 0; i--) {
    const entry = prices[i]!;
    if (constraintActive(entry.constraint, utcDate, utcTimeMs)) return entry.prices;
  }
  return prices[0]!.prices;
}

/** Resolves a per-unit flat or threshold-tiered price using total input tokens (types.py:899-919). */
function unitRate(price: UnitPrice | undefined, totalInputTokens: number): number | undefined {
  if (price === undefined || typeof price === 'number') return price;
  let rate = price.base;
  for (const tier of price.tiers) {
    if (totalInputTokens > tier.start) rate = tier.price;
  }
  return rate;
}

/**
 * The one rule for a tool-reported cost in USD (used for Request.reported and SessionRead.treeReported):
 * a finite figure above zero wins; zero, negative, non-finite or absent falls back to list pricing.
 */
export const reportedCost = (reported: number | undefined): number | undefined =>
  typeof reported === 'number' && Number.isFinite(reported) && reported > 0 ? reported : undefined;

/** Prices one request from a tool's history. Reported cost > 0 wins; otherwise uses the list's own rules. */
export function priceRequest(input: PriceInput, table: RatesTable = bundledRates): PriceResult {
  const reported = reportedCost(input.reported);
  if (reported !== undefined) return { priced: true, dollars: reported, basis: 'reported' };

  const { tokens } = input;
  const validTokens =
    whole(tokens.input) && whole(tokens.cacheRead) && whole(tokens.cacheWrite) && whole(tokens.output)
    && (tokens.cacheWrite1h === undefined || (whole(tokens.cacheWrite1h) && tokens.cacheWrite1h <= tokens.cacheWrite));
  if (!validTokens) return noPrice('invalid-tokens', 'Token counts must be non-negative whole numbers');

  const when = new Date(input.at);
  if (Number.isNaN(when.getTime())) return noPrice('invalid-time', 'Request time must be a valid timestamp');
  const utcDate = when.toISOString().slice(0, 10);
  const utcTimeMs = ((when.getTime() % DAY_MS) + DAY_MS) % DAY_MS;

  const savedProvider = input.provider?.trim();
  const providerFrom: 'request' | 'tool' = savedProvider ? 'request' : 'tool';
  const providerId = savedProvider || TOOL_PROVIDERS[input.tool];
  if (!providerId) return noPrice('no-provider', `No provider saved for ${input.tool}`);

  const provider = findProvider(providerId, table);
  if (!provider) return noPrice('not-in-table', `Provider ${providerId} is not in the table`);

  const hit = findModel(provider, input.model, table);
  if (!hit) return noPrice('not-in-table', `${provider.id}/${input.model} is not in the table`);

  const base = basePricesAt(hit.rate.prices, utcDate, utcTimeMs);
  // Apply price_variants first-to-last per key (types.py:739-752), skipped on fallback rows (types.py:766-769).
  // genai-prices silently keeps the base price for any unmatched context value; we allow that only for the ordinary
  // labels ('standard', 'default') and refuse any other unmatched speed or serviceTier.
  const contextOf = (key: 'speed' | 'service_tier') => (key === 'speed' ? input.speed : input.serviceTier);
  const overrides: PriceSet = {};
  const matchedKeys = new Set<string>();
  if (!hit.fallback && (input.speed !== undefined || input.serviceTier !== undefined)) {
    for (const variant of hit.rate.variants ?? []) {
      if (!constraintActive(variant.constraint, utcDate, utcTimeMs)) continue;
      const entries = Object.entries(variant.when) as ['speed' | 'service_tier', string][];
      if (!entries.every(([key, value]) => contextOf(key) === value)) continue;
      for (const [key] of entries) matchedKeys.add(key);
      for (const key of PRICE_KEYS) {
        if (overrides[key] === undefined && variant.prices[key] !== undefined) overrides[key] = variant.prices[key];
      }
    }
  }
  if (input.speed !== undefined && !matchedKeys.has('speed') && !ORDINARY_TIERS.has(input.speed)) {
    return noPrice('unsupported-speed', `No rate for speed ${input.speed} on ${hit.provider}/${hit.rate.id}`);
  }
  if (input.serviceTier !== undefined && !matchedKeys.has('service_tier') && !ORDINARY_TIERS.has(input.serviceTier)) {
    return noPrice('unsupported-service-tier', `No rate for service tier ${input.serviceTier} on ${hit.provider}/${hit.rate.id}`);
  }
  const active: PriceSet = { ...base, ...overrides };

  // Per genai-prices types.py:822-858, 977-989, decompose.py:14-36 and data_units.py:7-36 (rev 55b1818ba5ed431d09d93c0622c76beec09292cc),
  // cache_read_tokens and cache_write_tokens descend from input_tokens, and cache_write_1h_tokens descends from
  // cache_write_tokens: when a descendant lacks its own price, its count stays in its priced ancestor.
  const totalInput = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const oneHour = tokens.cacheWrite1h ?? 0;
  const inputRate = unitRate(active.input, totalInput);
  const cacheWriteRate = unitRate(active.cacheWrite, totalInput) ?? inputRate;
  const parts: [number, number | undefined, string][] = [
    [tokens.input, inputRate, 'input'],
    [tokens.cacheRead, unitRate(active.cacheRead, totalInput) ?? inputRate, 'cache-read'],
    [tokens.cacheWrite - oneHour, cacheWriteRate, 'cache-write'],
    [oneHour, unitRate(active.cacheWrite1h, totalInput) ?? cacheWriteRate, 'one-hour cache-write'],
    [tokens.output, unitRate(active.output, totalInput), 'output'],
  ];
  let dollars = 0;
  for (const [count, rate, label] of parts) {
    if (count > 0 && rate === undefined) return noPrice('missing-rate', `No ${label} rate for ${hit.provider}/${hit.rate.id}`);
    dollars += count * (rate ?? 0);
  }
  dollars /= 1_000_000;

  const matched: PriceMatch = { provider: hit.provider, model: hit.rate.id, by: hit.by, providerFrom };
  // Where a row lacks cacheWrite1h, one-hour tokens fall back to the shorter-TTL cache-write/input rate (undercharging).
  const atLeast = oneHour > 0 && active.cacheWrite1h === undefined;
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

// Offline model pricing from the checked-in rates table (assets/model-rates.json, built by scripts/build-rates.ts from
// Pydantic's genai-prices MIT list). Owns: validating a rates table (parseRatesTable), the bundled table (bundledRates),
// explicit provider and model aliases (PROVIDER_ALIASES, MODEL_ALIASES), pricing one request (priceRequest), AI credits
// (priceCredits, USD_PER_AI_CREDIT), and summing priced requests with coverage (sumPrices, coverageText).
// Not here: reading session files, storing records, fetching prices over the network, UI pages, or user price overrides.
import rawRates from '../assets/model-rates.json' with { type: 'json' };
import { record } from './values.ts';

export interface RateValues { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
export interface RateTier extends RateValues { above: number }
export interface ModelRate extends RateValues { tiers?: RateTier[]; timeOfDay?: true }
export interface RatesSource { name: string; url: string; revision: string; license: string; notice: string }
export interface RatesTable { format: 1; date: string; source: RatesSource; providers: Record<string, Record<string, ModelRate>> }

/** Request token counts: `input` excludes cached tokens; reasoning tokens are already inside `output`. */
export interface TokenCounts { input: number; cacheRead: number; cacheWrite: number; output: number }
export interface PriceInput {
  model: string;
  provider?: string;
  tokens: TokenCounts;
  /** Cost in USD the tool itself saved for this request; wins when > 0. */
  reported?: number;
}

export type UnpricedReason = 'not-in-table' | 'ambiguous' | 'missing-rate' | 'missing-tier' | 'invalid-tokens' | 'invalid-credits';
export type PriceResult =
  | { priced: true; dollars: number; basis: 'list'; ratesDate: string; matched: { provider: string; model: string } }
  | { priced: true; dollars: number; basis: 'reported' }
  | { priced: true; dollars: number; credits: number; basis: 'credits' }
  | { priced: false; reason: UnpricedReason; detail: string };

/** Sum of priced requests; `dollars` is undefined when `priced` is 0 so unpriced requests never count as $0. */
export interface PriceSum { dollars: number | undefined; priced: number; total: number; credits?: number }
export interface ModelAlias { from: string; provider: string; to: string; reason: string }

/** GitHub documents 1 AI credit = $0.01 USD (docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing). */
export const USD_PER_AI_CREDIT = 0.01;

/** Explicit provider names tools save that map to a provider id in genai-prices (from genai-prices provider_match). */
export const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  'amazon-bedrock': 'aws', bedrock: 'aws', 'google-vertex': 'google',
  'together-ai': 'together', together_ai: 'together', xai: 'x-ai',
};

const group = (provider: string, to: string, from: readonly string[], reason: string): ModelAlias[] =>
  from.map(id => ({ from: id, provider, to, reason }));

/**
 * Explicit, verified aliases for dated snapshots and tool-saved ids that name a listed model in genai-prices.
 * Every target id is checked against assets/model-rates.json in tests/rates.test.ts. No fuzzy matching.
 */
export const MODEL_ALIASES: readonly ModelAlias[] = [
  // Anthropic dated snapshots (verified in genai-prices aws Bedrock ids and anthropic equals rules).
  ...group('anthropic', 'claude-sonnet-4-5', ['claude-sonnet-4-5-20250929'], 'Anthropic dated snapshot'),
  ...group('anthropic', 'claude-haiku-4-5', ['claude-haiku-4-5-20251001'], 'Anthropic dated snapshot'),
  ...group('anthropic', 'claude-opus-4-1', ['claude-opus-4-1-20250805'], 'Anthropic dated snapshot'),
  ...group('anthropic', 'claude-opus-4-0', ['claude-opus-4-20250514', 'claude-opus-4'], 'Anthropic dated and undated ids'),
  ...group('anthropic', 'claude-sonnet-4-0', ['claude-sonnet-4-20250514', 'claude-sonnet-4'], 'Anthropic dated and undated ids'),
  ...group('anthropic', 'claude-3-7-sonnet-latest', ['claude-3-7-sonnet-20250219'], 'Anthropic dated snapshot'),
  ...group('anthropic', 'claude-3-5-sonnet', ['claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620'], 'Anthropic dated snapshots'),
  ...group('anthropic', 'claude-3-5-haiku-latest', ['claude-3-5-haiku-20241022'], 'Anthropic dated snapshot'),
  // OpenAI dated snapshots and Codex ids (each an exact equals match on the openai model in genai-prices).
  ...group('openai', 'gpt-5.5', ['gpt-5.5-2026-04-23', 'gpt-5.5-2026-04-24', 'gpt-5.5-codex'], 'OpenAI dated and Codex ids'),
  ...group('openai', 'gpt-5.4', ['gpt-5.4-2026-03-05'], 'OpenAI dated snapshot'),
  ...group('openai', 'gpt-5.4-mini', ['gpt-5.4-mini-2026-03-17'], 'OpenAI dated snapshot'),
  ...group('openai', 'gpt-5.2', ['gpt-5.2-2025-12-11', 'gpt-5.2-codex'], 'OpenAI dated and Codex ids'),
  ...group('openai', 'gpt-5.1', ['gpt-5.1-2025-11-13', 'gpt-5.1-codex', 'gpt-5.1-codex-max'], 'OpenAI dated and Codex ids'),
  ...group('openai', 'gpt-5', ['gpt-5-2025-08-07', 'gpt-5-codex'], 'OpenAI dated and Codex ids'),
  ...group('openai', 'gpt-4.1', ['gpt-4.1-2025-04-14'], 'OpenAI dated snapshot'),
  ...group('openai', 'gpt-4o', ['gpt-4o-2024-11-20', 'gpt-4o-2024-08-06', 'gpt-4o-2024-05-13'], 'OpenAI dated snapshots'),
  ...group('openai', 'o3', ['o3-2025-04-16'], 'OpenAI dated snapshot'),
  ...group('openai', 'o3-mini', ['o3-mini-2025-01-31'], 'OpenAI dated snapshot'),
  ...group('openai', 'o4-mini', ['o4-mini-2025-04-16'], 'OpenAI dated snapshot'),
  ...group('openai', 'codex-mini', ['codex-mini-latest'], 'OpenAI rolling alias'),
  // Google dated and rolling variants (exact equals matches on google/gemini-2.5-flash in genai-prices).
  ...group('google', 'gemini-2.5-flash', ['gemini-2.5-flash-latest', 'gemini-2.5-flash-preview-09-2025'], 'Google rolling and dated preview ids'),
];

const RATE_KEYS: readonly [keyof TokenCounts, string][] = [
  ['input', 'input'], ['cacheRead', 'cache-read'], ['cacheWrite', 'cache-write'], ['output', 'output'],
];
const nonNeg = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function assertRateValues(raw: Record<string, unknown>, where: string): void {
  for (const [key] of RATE_KEYS) {
    if (raw[key] !== undefined && !nonNeg(raw[key])) throw new Error(`Invalid ${key} rate at ${where}`);
  }
}

function assertModelRate(raw: Record<string, unknown>, where: string): void {
  assertRateValues(raw, where);
  if (raw.timeOfDay !== undefined && raw.timeOfDay !== true) throw new Error(`Invalid timeOfDay at ${where}`);
  if (raw.tiers !== undefined) {
    if (!Array.isArray(raw.tiers)) throw new Error(`Invalid tiers at ${where}`);
    for (const [i, entry] of raw.tiers.entries()) {
      const tier = record(entry);
      if (!tier || !nonNeg(tier.above) || tier.tiers !== undefined || tier.timeOfDay !== undefined) {
        throw new Error(`Invalid tier ${i} at ${where}`);
      }
      assertRateValues(tier, `${where}.tiers[${i}]`);
    }
  }
}

/** Validates a JSON value as a RatesTable, throwing on missing date, notice, or invalid rates. */
export function parseRatesTable(raw: unknown): RatesTable {
  const obj = record(raw);
  if (!obj || obj.format !== 1) throw new Error('Rates table must be format 1');
  const day = typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) ? Date.parse(`${obj.date}T00:00:00Z`) : NaN;
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== obj.date) throw new Error('Rates table has no valid YYYY-MM-DD date');
  const src = record(obj.source);
  if (!src || !['name', 'url', 'revision', 'license', 'notice'].every(k => typeof src[k] === 'string' && src[k].trim().length > 0)) {
    throw new Error('Rates table source must name url, revision, license and notice');
  }
  const providers = record(obj.providers);
  if (!providers || !Object.keys(providers).length) throw new Error('Rates table has no providers');
  for (const [pid, rawModels] of Object.entries(providers)) {
    const models = record(rawModels);
    if (!models) throw new Error(`Invalid provider ${pid}`);
    for (const [mid, rawRate] of Object.entries(models)) {
      const rate = record(rawRate);
      if (!rate) throw new Error(`Invalid rate at ${pid}/${mid}`);
      assertModelRate(rate, `${pid}/${mid}`);
    }
  }
  return obj as unknown as RatesTable;
}

/** The checked-in rates table, validated once at load with no network access. */
export const bundledRates: RatesTable = parseRatesTable(rawRates);

/**
 * Reseller rows that duplicate another vendor's bare model id in genai-prices (Azure rows, OpenRouter's unslashed
 * legacy ids, and Google Vertex's hosted Claude rows) match only when the request names that provider.
 */
const needsProvider = (provider: string, id: string) =>
  provider === 'azure' || (provider === 'openrouter' && !id.includes('/')) || (provider === 'google' && id.startsWith('claude-'));

type MatchOutcome = { provider: string; model: string; rate: ModelRate } | { reason: 'not-in-table' | 'ambiguous'; detail: string };

function matchModel(model: string, provider: string | undefined, table: RatesTable, aliases: readonly ModelAlias[]): MatchOutcome {
  if (!model) return { reason: 'not-in-table', detail: 'Empty model id' };
  const exactIn = (pid: string, mid: string) => {
    const models = Object.hasOwn(table.providers, pid) ? table.providers[pid] : undefined;
    return models && Object.hasOwn(models, mid) ? { provider: pid, model: mid, rate: models[mid]! } : undefined;
  };
  const pick = (hits: { provider: string; model: string; rate: ModelRate }[]): MatchOutcome | undefined => {
    const unique = [...new Map(hits.map(hit => [`${hit.provider}\0${hit.model}`, hit])).values()];
    if (unique.length === 1) return unique[0]!;
    if (unique.length > 1) return { reason: 'ambiguous', detail: `${model} could be ${unique.map(hit => `${hit.provider}/${hit.model}`).join(' or ')}` };
    return undefined;
  };
  const resolved = !provider ? undefined : Object.hasOwn(table.providers, provider) ? provider
    : Object.hasOwn(PROVIDER_ALIASES, provider) ? PROVIDER_ALIASES[provider]! : '';
  if (provider && (!resolved || !Object.hasOwn(table.providers, resolved))) {
    return { reason: 'not-in-table', detail: `Provider ${provider} is not in the table` };
  }
  const direct = resolved ? exactIn(resolved, model)
    : pick(Object.keys(table.providers).filter(pid => !needsProvider(pid, model)).flatMap(pid => exactIn(pid, model) ?? []));
  if (direct) return direct;
  const aliased = pick(aliases
    .filter(a => a.from === model && (resolved ? a.provider === resolved : !needsProvider(a.provider, a.to)))
    .flatMap(a => exactIn(a.provider, a.to) ?? []));
  return aliased ?? { reason: 'not-in-table', detail: `${provider ? `${provider}/` : ''}${model} is not in the table` };
}

/** Prices one request from a tool's history. Reported cost > 0 wins; otherwise uses exact id then explicit aliases. */
export function priceRequest(input: PriceInput, table: RatesTable = bundledRates, aliases: readonly ModelAlias[] = MODEL_ALIASES): PriceResult {
  if (typeof input.reported === 'number' && Number.isFinite(input.reported) && input.reported > 0) {
    return { priced: true, dollars: input.reported, basis: 'reported' };
  }
  const { tokens } = input;
  if (!RATE_KEYS.every(([key]) => nonNeg(tokens[key]))) {
    return { priced: false, reason: 'invalid-tokens', detail: 'Token counts must be non-negative finite numbers' };
  }
  const hit = matchModel(input.model, input.provider, table, aliases);
  if ('reason' in hit) return { priced: false, ...hit };
  if (hit.rate.timeOfDay) {
    return { priced: false, reason: 'missing-tier', detail: `${hit.provider}/${hit.model} uses time-of-day pricing` };
  }
  const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  let values: RateValues = hit.rate, tierAbove: number | undefined;
  if (hit.rate.tiers?.length) {
    for (const tier of [...hit.rate.tiers].sort((a, b) => a.above - b.above)) {
      if (promptTokens > tier.above) { values = tier; tierAbove = tier.above; }
    }
  }
  for (const [key, label] of RATE_KEYS) {
    if (tokens[key] > 0 && values[key] === undefined) {
      return tierAbove !== undefined && hit.rate[key] !== undefined
        ? { priced: false, reason: 'missing-tier', detail: `Missing ${label} rate above ${tierAbove} tokens for ${hit.provider}/${hit.model}` }
        : { priced: false, reason: 'missing-rate', detail: `No ${label} rate for ${hit.provider}/${hit.model}` };
    }
  }
  const dollars = RATE_KEYS.reduce((sum, [key]) => sum + tokens[key] * (values[key] ?? 0), 0) / 1_000_000;
  return { priced: true, dollars, basis: 'list', ratesDate: table.date, matched: { provider: hit.provider, model: hit.model } };
}

/** Prices AI credits (e.g. GitHub Copilot) at USD_PER_AI_CREDIT ($0.01 each), keeping the credit count beside the dollars. */
export function priceCredits(credits: number): PriceResult {
  if (!nonNeg(credits)) return { priced: false, reason: 'invalid-credits', detail: 'Credits must be a non-negative finite number' };
  return { priced: true, dollars: credits / Math.round(1 / USD_PER_AI_CREDIT), credits, basis: 'credits' };
}

/** Sums priced requests and counts coverage; an unpriced request never counts as $0. */
export function sumPrices(results: readonly PriceResult[]): PriceSum {
  let dollars = 0, priced = 0, credits = 0, hasCredits = false;
  for (const result of results) {
    if (!result.priced) continue;
    dollars += result.dollars;
    priced++;
    if (result.basis === 'credits') { credits += result.credits; hasCredits = true; }
  }
  return { dollars: priced > 0 ? dollars : undefined, priced, total: results.length, ...(hasCredits ? { credits } : {}) };
}

/** Formats coverage as "N of M priced". */
export const coverageText = (sum: Pick<PriceSum, 'priced' | 'total'>) => `${sum.priced} of ${sum.total} priced`;

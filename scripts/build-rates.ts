// Makes and validates the checked-in model rates table (assets/model-rates.json) from Pydantic's genai-prices public list
// (prices/data_slim.json, MIT licence). Run by hand before a release: `node scripts/build-rates.ts`.
// This script is the only place that touches the network for rates, and it sends nothing but the public requests for
// the list's commit hash, data_slim.json and LICENSE. Packaging and the app read assets/model-rates.json offline.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { MatchClause, ModelRate, ProviderRates, RatesTable, RateTier, RateValues } from '../src/rates.ts';
import { record } from '../src/values.ts';

const REPO = 'https://github.com/pydantic/genai-prices.git';
const RAW_BASE = 'https://raw.githubusercontent.com/pydantic/genai-prices';
const DEFAULT_OUT = join(import.meta.dirname, '..', 'assets', 'model-rates.json');

/**
 * Providers in genai-prices that Central Knot's six tools (Claude Code, Copilot CLI, Codex, Pi, OpenCode, Antigravity)
 * can call: direct model makers plus the cloud hosts and routers those tools configure.
 */
export const KEPT_PROVIDERS = [
  'anthropic', 'aws', 'azure', 'cerebras', 'deepseek', 'fireworks', 'google', 'groq',
  'minimax', 'mistral', 'moonshotai', 'openai', 'openrouter', 'together', 'x-ai', 'zhipuai',
] as const;

const KEPT_SET = new Set<string>(KEPT_PROVIDERS);

type UpstreamNumber = number | { base: number; tiers: { start: number; price: number }[] };
interface UpstreamPrices {
  input_mtok?: UpstreamNumber;
  output_mtok?: UpstreamNumber;
  cache_read_mtok?: UpstreamNumber;
  cache_write_mtok?: UpstreamNumber;
}
interface UpstreamConditional {
  constraint?: { start_date?: string; start_time?: string; end_time?: string; [key: string]: unknown };
  prices: UpstreamPrices;
}
export interface UpstreamProvider {
  id: string;
  provider_match?: MatchClause;
  fallback_model_providers?: string[];
  models: { id: string; match: MatchClause; prices: UpstreamPrices | UpstreamConditional[] }[];
}

const FIELDS: readonly [keyof UpstreamPrices, keyof RateValues][] = [
  ['input_mtok', 'input'],
  ['output_mtok', 'output'],
  ['cache_read_mtok', 'cacheRead'],
  ['cache_write_mtok', 'cacheWrite'],
];
const STRING_CLAUSES = new Set(['equals', 'starts_with', 'ends_with', 'contains', 'regex']);
const nonNeg = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function assertMatchClause(raw: unknown, where: string): void {
  const obj = record(raw);
  if (!obj) throw new Error(`Invalid match clause at ${where}`);
  const keys = Object.keys(obj);
  if (keys.length !== 1) throw new Error(`Match clause must have one operator at ${where}`);
  const key = keys[0]!;
  const value = obj[key];
  if (STRING_CLAUSES.has(key)) {
    if (typeof value !== 'string' || !value.length) throw new Error(`Invalid ${key} clause at ${where}`);
    if (key === 'regex') new RegExp(value);
    return;
  }
  if (key === 'or' || key === 'and') {
    if (!Array.isArray(value) || !value.length) throw new Error(`Invalid ${key} clause at ${where}`);
    for (const [i, item] of value.entries()) assertMatchClause(item, `${where}.${key}[${i}]`);
    return;
  }
  throw new Error(`Unknown match operator ${key} at ${where}`);
}

function assertRateValues(raw: Record<string, unknown>, where: string): void {
  for (const [, key] of FIELDS) {
    if (raw[key] !== undefined && !nonNeg(raw[key])) throw new Error(`Invalid ${key} rate at ${where}`);
  }
}

function assertModelRate(raw: Record<string, unknown>, where: string): void {
  if (typeof raw.id !== 'string' || !raw.id.trim()) throw new Error(`Invalid model id at ${where}`);
  assertMatchClause(raw.match, `${where}.match`);
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

/** Validates a JSON value as a RatesTable, throwing on missing date, notice, match clauses or invalid rates. */
export function parseRatesTable(raw: unknown): RatesTable {
  const obj = record(raw);
  if (!obj || obj.format !== 1) throw new Error('Rates table must be format 1');
  const day = typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) ? Date.parse(`${obj.date}T00:00:00Z`) : NaN;
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== obj.date) {
    throw new Error('Rates table has no valid YYYY-MM-DD date');
  }
  const src = record(obj.source);
  if (!src || !['name', 'url', 'revision', 'license', 'notice'].every(k => typeof src[k] === 'string' && src[k].trim().length > 0)) {
    throw new Error('Rates table source must name url, revision, license and notice');
  }
  if (!Array.isArray(obj.providers) || !obj.providers.length) throw new Error('Rates table has no providers');
  const seenProviders = new Set<string>();
  const fallbackRefs: [string, string][] = [];
  for (const [i, entry] of obj.providers.entries()) {
    const provider = record(entry);
    if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) throw new Error(`Invalid provider at [${i}]`);
    if (seenProviders.has(provider.id)) throw new Error(`Duplicate provider ${provider.id}`);
    seenProviders.add(provider.id);
    if (provider.match !== undefined) assertMatchClause(provider.match, `${provider.id}.match`);
    if (provider.fallbacks !== undefined) {
      if (!Array.isArray(provider.fallbacks) || !provider.fallbacks.every(f => typeof f === 'string' && f.trim().length > 0)) {
        throw new Error(`Invalid fallbacks at ${provider.id}`);
      }
      for (const target of provider.fallbacks) fallbackRefs.push([provider.id, target]);
    }
    if (!Array.isArray(provider.models)) throw new Error(`Invalid models at ${provider.id}`);
    for (const [j, rawModel] of provider.models.entries()) {
      const model = record(rawModel);
      if (!model) throw new Error(`Invalid model at ${provider.id}[${j}]`);
      assertModelRate(model, `${provider.id}/${typeof model.id === 'string' ? model.id : j}`);
    }
  }
  for (const [pid, target] of fallbackRefs) {
    if (!seenProviders.has(target)) throw new Error(`Unknown fallback ${target} on provider ${pid}`);
  }
  return obj as unknown as RatesTable;
}

function priceAt(field: UpstreamNumber, above?: number): number {
  if (typeof field === 'number') return field;
  if (above === undefined) return field.base;
  let picked = field.base;
  for (const tier of [...field.tiers].sort((a, b) => a.start - b.start)) {
    if (tier.start <= above) picked = tier.price;
  }
  return picked;
}

function extractRate(prices: UpstreamPrices): RateValues & { tiers?: RateTier[] } {
  const rate: RateValues & { tiers?: RateTier[] } = {};
  const starts = new Set<number>();
  for (const [src, dst] of FIELDS) {
    const value = prices[src];
    if (value === undefined) continue;
    rate[dst] = priceAt(value);
    if (typeof value !== 'number') for (const tier of value.tiers) starts.add(tier.start);
  }
  if (starts.size) {
    rate.tiers = [...starts].sort((a, b) => a - b).map(above => {
      const tier: RateTier = { above };
      for (const [src, dst] of FIELDS) {
        const value = prices[src];
        if (value !== undefined) tier[dst] = priceAt(value, above);
      }
      return tier;
    });
  }
  return rate;
}

function resolveModelPrices(
  prices: UpstreamPrices | UpstreamConditional[],
  date: string,
  label: string,
): RateValues & { tiers?: RateTier[]; timeOfDay?: true } {
  if (!Array.isArray(prices)) return extractRate(prices);
  let active: UpstreamPrices | undefined;
  let activeDate = '';
  let hasTimeOfDay = false;
  for (const entry of prices) {
    const constraint = entry.constraint;
    if (!constraint) {
      if (!activeDate) active = entry.prices;
      continue;
    }
    const keys = Object.keys(constraint);
    if (keys.length === 1 && typeof constraint.start_date === 'string') {
      if (constraint.start_date <= date && constraint.start_date >= activeDate) {
        active = entry.prices;
        activeDate = constraint.start_date;
      }
    } else if (keys.length === 2 && typeof constraint.start_time === 'string' && typeof constraint.end_time === 'string') {
      hasTimeOfDay = true;
    } else {
      throw new Error(`Unsupported price constraint on ${label}: ${JSON.stringify(constraint)}`);
    }
  }
  // Models whose upstream price varies by UTC clock time (currently only two DeepSeek entries) are marked rather than
  // guessing peak vs off-peak; priceRequest returns unpriced ('missing-tier') in plain words.
  if (hasTimeOfDay) return { timeOfDay: true };
  if (!active) throw new Error(`No active base price for ${label} as of ${date}`);
  return extractRate(active);
}

/**
 * Builds a dated, trimmed RatesTable from an upstream genai-prices data_slim.json array, keeping providers, models,
 * match clauses and fallbacks in the upstream list's own order. Pure, no network.
 */
export function buildRatesTable(
  upstream: readonly UpstreamProvider[],
  meta: { date: string; revision: string; url: string; notice: string },
): RatesTable {
  const providers: ProviderRates[] = [];
  const found = new Set<string>();
  for (const provider of upstream) {
    if (!KEPT_SET.has(provider.id)) continue;
    found.add(provider.id);
    const models: ModelRate[] = [];
    for (const model of provider.models) {
      const rate = resolveModelPrices(model.prices, meta.date, `${provider.id}/${model.id}`);
      if (rate.timeOfDay || rate.input !== undefined || rate.output !== undefined || rate.cacheRead !== undefined || rate.cacheWrite !== undefined) {
        models.push({ id: model.id, match: model.match, ...rate });
      }
    }
    const fallbacks = provider.fallback_model_providers?.filter(id => KEPT_SET.has(id));
    providers.push({
      id: provider.id,
      ...(provider.provider_match ? { match: provider.provider_match } : {}),
      ...(fallbacks?.length ? { fallbacks } : {}),
      models,
    });
  }
  for (const id of KEPT_PROVIDERS) {
    if (!found.has(id)) throw new Error(`Provider ${id} is missing from upstream genai-prices.`);
  }
  return parseRatesTable({
    format: 1,
    date: meta.date,
    source: { name: 'pydantic/genai-prices', url: meta.url, revision: meta.revision, license: 'MIT', notice: meta.notice.trim() },
    providers,
  });
}

/** Deterministic JSON formatting: readable header, one compact line per model so release diffs stay clear and small. */
export function formatRatesJson(table: RatesTable): string {
  const providerBlocks = table.providers.map(provider => {
    const header = [
      `      "id": ${JSON.stringify(provider.id)},`,
      ...(provider.match ? [`      "match": ${JSON.stringify(provider.match)},`] : []),
      ...(provider.fallbacks ? [`      "fallbacks": ${JSON.stringify(provider.fallbacks)},`] : []),
    ];
    const modelLines = provider.models.map(model => `        ${JSON.stringify(model)}`);
    return [
      '    {',
      ...header,
      '      "models": [',
      modelLines.join(',\n'),
      '      ]',
      '    }',
    ].join('\n');
  });
  const sourceJson = JSON.stringify(table.source, null, 2).replace(/\n/g, '\n  ');
  return [
    '{',
    `  "format": ${table.format},`,
    `  "date": ${JSON.stringify(table.date)},`,
    `  "source": ${sourceJson},`,
    '  "providers": [',
    providerBlocks.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

function latestMainRevision(): string {
  const out = execFileSync('git', ['ls-remote', REPO, 'refs/heads/main'], { encoding: 'utf8' });
  const rev = out.trim().split(/\s+/)[0];
  if (!rev || !/^[0-9a-f]{40}$/.test(rev)) throw new Error(`Could not resolve genai-prices main revision: ${out.trim()}`);
  return rev;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url} (HTTP ${response.status})`);
  return response.text();
}

function parseArgs(argv: string[]) {
  let rev: string | undefined;
  let date = new Date().toISOString().slice(0, 10);
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rev') rev = argv[++i];
    else if (arg === '--date') date = argv[++i] ?? '';
    else if (arg === '--out') out = resolve(argv[++i] ?? '');
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid --date: ${date}`);
  if (rev !== undefined && !/^[0-9a-f]{40}$/.test(rev)) throw new Error(`Invalid --rev: ${rev}`);
  return { rev, date, out };
}

if (process.argv[1] === import.meta.filename) {
  const { rev: givenRev, date, out } = parseArgs(process.argv.slice(2));
  const revision = givenRev ?? latestMainRevision();
  const url = `${RAW_BASE}/${revision}/prices/data_slim.json`;
  const [rawList, notice] = await Promise.all([fetchText(url), fetchText(`${RAW_BASE}/${revision}/LICENSE`)]);
  const table = buildRatesTable(JSON.parse(rawList) as UpstreamProvider[], { date, revision, url, notice });
  const json = formatRatesJson(table);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, json, 'utf8');
  const models = table.providers.reduce((sum, provider) => sum + provider.models.length, 0);
  console.log(`Wrote ${out}: ${table.providers.length} providers, ${models} models, ${Buffer.byteLength(json)} bytes (rev ${revision.slice(0, 12)}, date ${date}).`);
}

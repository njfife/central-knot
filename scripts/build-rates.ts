// Makes and validates the checked-in model rates table (assets/model-rates.json) from Pydantic's genai-prices public list
// (prices/new_data/v2/data_slim.json, MIT licence). Run by hand before a release: `node scripts/build-rates.ts`.
// This script is the only place that touches the network for rates, and it sends nothing but public requests for the
// list's commit hash, data commit date, data_slim.json and LICENSE. Packaging and the app read assets/model-rates.json offline.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  ConditionalPrice, MatchClause, ModelRate, PriceConstraint, PriceSet, PriceVariant, ProviderRates, RatesTable, UnitPrice,
} from '../src/rates.ts';
import { record } from '../src/values.ts';

const REPO = 'https://github.com/pydantic/genai-prices.git';
const RAW_BASE = 'https://raw.githubusercontent.com/pydantic/genai-prices';
const API_BASE = 'https://api.github.com/repos/pydantic/genai-prices';
export const UPSTREAM_DATA_PATH = 'prices/new_data/v2/data_slim.json';
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
const KEPT_WHEN_KEYS = new Set(['speed', 'service_tier']);

type UpstreamNumber = number | { base: number; tiers: { start: number; price: number }[] };
interface UpstreamPrices {
  input_mtok?: UpstreamNumber;
  output_mtok?: UpstreamNumber;
  cache_read_mtok?: UpstreamNumber;
  cache_write_mtok?: UpstreamNumber;
  cache_write_1h_mtok?: UpstreamNumber;
  [key: string]: unknown;
}
interface UpstreamConstraint {
  start_date?: string;
  start_time?: string;
  end_time?: string;
  [key: string]: unknown;
}
interface UpstreamConditional { constraint?: UpstreamConstraint; prices: UpstreamPrices }
interface UpstreamVariant { when: Record<string, string>; constraint?: UpstreamConstraint; prices: UpstreamPrices }
export interface UpstreamProvider {
  id: string;
  provider_match?: MatchClause;
  fallback_model_providers?: string[];
  models: {
    id: string;
    match: MatchClause;
    prices: UpstreamPrices | UpstreamConditional[];
    price_variants?: UpstreamVariant[];
  }[];
}

const FIELDS: readonly [keyof UpstreamPrices, keyof PriceSet][] = [
  ['input_mtok', 'input'],
  ['output_mtok', 'output'],
  ['cache_read_mtok', 'cacheRead'],
  ['cache_write_mtok', 'cacheWrite'],
  ['cache_write_1h_mtok', 'cacheWrite1h'],
];
const STRING_CLAUSES = new Set(['equals', 'starts_with', 'ends_with', 'contains', 'regex']);
const nonNeg = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value;
}

function validUtcTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})?$/.test(value)) return false;
  const iso = `1970-01-01T${/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`}`;
  return Number.isFinite(Date.parse(iso));
}

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

function assertUnitPrice(raw: unknown, where: string): void {
  if (nonNeg(raw)) return;
  const obj = record(raw);
  if (!obj || !nonNeg(obj.base) || !Array.isArray(obj.tiers)) throw new Error(`Invalid unit price at ${where}`);
  let prev = -1;
  for (const [i, item] of obj.tiers.entries()) {
    const tier = record(item);
    if (!tier || typeof tier.start !== 'number' || !Number.isSafeInteger(tier.start) || tier.start < 0 || tier.start < prev || !nonNeg(tier.price)) {
      throw new Error(`Invalid tier ${i} at ${where}`);
    }
    prev = tier.start;
  }
}

function assertPriceSet(raw: unknown, where: string): void {
  const obj = record(raw);
  if (!obj) throw new Error(`Invalid price set at ${where}`);
  const allowed = new Set<string>(FIELDS.map(([, dst]) => dst));
  for (const [key, value] of Object.entries(obj)) {
    if (!allowed.has(key)) throw new Error(`Unknown price key ${key} at ${where}`);
    if (value !== undefined) assertUnitPrice(value, `${where}.${key}`);
  }
}

function assertConstraint(raw: unknown, where: string): void {
  const obj = record(raw);
  if (!obj) throw new Error(`Invalid constraint at ${where}`);
  const keys = Object.keys(obj);
  if (keys.length === 1 && validIsoDate(obj.startDate)) return;
  if (keys.length === 2 && validUtcTime(obj.startTime) && validUtcTime(obj.endTime)) return;
  throw new Error(`Invalid constraint at ${where}: ${JSON.stringify(raw)}`);
}

function assertModelRate(raw: Record<string, unknown>, where: string): void {
  if (typeof raw.id !== 'string' || !raw.id.trim()) throw new Error(`Invalid model id at ${where}`);
  assertMatchClause(raw.match, `${where}.match`);
  if (Array.isArray(raw.prices)) {
    if (!raw.prices.length) throw new Error(`Empty conditional prices at ${where}`);
    for (const [i, item] of raw.prices.entries()) {
      const cond = record(item);
      if (!cond) throw new Error(`Invalid conditional price ${i} at ${where}`);
      if (cond.constraint !== undefined) assertConstraint(cond.constraint, `${where}.prices[${i}].constraint`);
      assertPriceSet(cond.prices, `${where}.prices[${i}].prices`);
    }
  } else {
    assertPriceSet(raw.prices, `${where}.prices`);
  }
  if (raw.variants !== undefined) {
    if (!Array.isArray(raw.variants)) throw new Error(`Invalid variants at ${where}`);
    for (const [i, item] of raw.variants.entries()) {
      const variant = record(item);
      const when = variant && record(variant.when);
      const whenEntries = when ? Object.entries(when) : [];
      if (!variant || !whenEntries.length || !whenEntries.every(([k, v]) => KEPT_WHEN_KEYS.has(k) && typeof v === 'string' && v.length > 0)) {
        throw new Error(`Invalid variant ${i} at ${where}`);
      }
      if (variant.constraint !== undefined) assertConstraint(variant.constraint, `${where}.variants[${i}].constraint`);
      assertPriceSet(variant.prices, `${where}.variants[${i}].prices`);
    }
  }
}

/** Validates a JSON value as a RatesTable, throwing on invalid dates, notice, match clauses, constraints or rates. */
export function parseRatesTable(raw: unknown): RatesTable {
  const obj = record(raw);
  if (!obj || obj.format !== 1) throw new Error('Rates table must be format 1');
  if (!validIsoDate(obj.date)) throw new Error('Rates table has no valid YYYY-MM-DD data date');
  if (!validIsoDate(obj.built)) throw new Error('Rates table has no valid YYYY-MM-DD built date');
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

function extractUnitPrice(value: UpstreamNumber): UnitPrice {
  if (typeof value === 'number') return value;
  const tiers = [...value.tiers].sort((a, b) => a.start - b.start).map(tier => ({ start: tier.start, price: tier.price }));
  return { base: value.base, tiers };
}

function extractPriceSet(prices: UpstreamPrices): PriceSet {
  const out: PriceSet = {};
  for (const [src, dst] of FIELDS) {
    const value = prices[src] as UpstreamNumber | undefined;
    if (value !== undefined) out[dst] = extractUnitPrice(value);
  }
  return out;
}

function extractConstraint(constraint: UpstreamConstraint, label: string): PriceConstraint {
  const keys = Object.keys(constraint);
  if (keys.length === 1 && typeof constraint.start_date === 'string') return { startDate: constraint.start_date };
  if (keys.length === 2 && typeof constraint.start_time === 'string' && typeof constraint.end_time === 'string') {
    return { startTime: constraint.start_time, endTime: constraint.end_time };
  }
  throw new Error(`Unsupported price constraint on ${label}: ${JSON.stringify(constraint)}`);
}

function extractModelPrices(prices: UpstreamPrices | UpstreamConditional[], label: string): PriceSet | ConditionalPrice[] | undefined {
  if (!Array.isArray(prices)) {
    const set = extractPriceSet(prices);
    return Object.keys(set).length ? set : undefined;
  }
  const list: ConditionalPrice[] = prices.map((entry, i) => ({
    ...(entry.constraint ? { constraint: extractConstraint(entry.constraint, `${label}[${i}]`) } : {}),
    prices: extractPriceSet(entry.prices),
  }));
  return list.some(entry => Object.keys(entry.prices).length > 0) ? list : undefined;
}

function extractVariants(variants: readonly UpstreamVariant[] | undefined, label: string): PriceVariant[] | undefined {
  if (!variants?.length) return undefined;
  const kept: PriceVariant[] = [];
  for (const [i, variant] of variants.entries()) {
    const entries = Object.entries(variant.when);
    if (!entries.length || !entries.every(([k]) => KEPT_WHEN_KEYS.has(k))) continue;
    kept.push({
      when: variant.when as PriceVariant['when'],
      ...(variant.constraint ? { constraint: extractConstraint(variant.constraint, `${label}.variants[${i}]`) } : {}),
      prices: extractPriceSet(variant.prices),
    });
  }
  return kept.length ? kept : undefined;
}

/**
 * Builds a dated, trimmed RatesTable from an upstream genai-prices v2/data_slim.json array, keeping providers, models,
 * match clauses, fallbacks, conditional prices, speed/service_tier variants and text-token rates in upstream order.
 */
export function buildRatesTable(
  upstream: readonly UpstreamProvider[],
  meta: { date: string; built: string; revision: string; url: string; notice: string },
): RatesTable {
  const providers: ProviderRates[] = [];
  const found = new Set<string>();
  for (const provider of upstream) {
    if (!KEPT_SET.has(provider.id)) continue;
    found.add(provider.id);
    const models: ModelRate[] = [];
    for (const model of provider.models) {
      const label = `${provider.id}/${model.id}`;
      const prices = extractModelPrices(model.prices, label);
      if (!prices) continue;
      const variants = extractVariants(model.price_variants, label);
      models.push({ id: model.id, match: model.match, prices, ...(variants ? { variants } : {}) });
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
    built: meta.built,
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
    `  "built": ${JSON.stringify(table.built)},`,
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

async function dataChangedDate(revision: string): Promise<string> {
  const url = `${API_BASE}/commits?sha=${revision}&path=${UPSTREAM_DATA_PATH}&per_page=1`;
  const commits = JSON.parse(await fetchText(url)) as { commit?: { committer?: { date?: string }; author?: { date?: string } } }[];
  const iso = commits[0]?.commit?.committer?.date ?? commits[0]?.commit?.author?.date ?? '';
  const day = iso.slice(0, 10);
  if (!validIsoDate(day)) throw new Error(`Could not determine last-changed date for ${UPSTREAM_DATA_PATH} at ${revision}`);
  return day;
}

function parseArgs(argv: string[]) {
  let rev: string | undefined;
  let date: string | undefined;
  let built = new Date().toISOString().slice(0, 10);
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rev') rev = argv[++i];
    else if (arg === '--date') date = argv[++i] ?? '';
    else if (arg === '--built') built = argv[++i] ?? '';
    else if (arg === '--out') out = resolve(argv[++i] ?? '');
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (date !== undefined && !validIsoDate(date)) throw new Error(`Invalid --date: ${date}`);
  if (!validIsoDate(built)) throw new Error(`Invalid --built: ${built}`);
  if (rev !== undefined && !/^[0-9a-f]{40}$/.test(rev)) throw new Error(`Invalid --rev: ${rev}`);
  return { rev, date, built, out };
}

if (process.argv[1] === import.meta.filename) {
  const { rev: givenRev, date: givenDate, built, out } = parseArgs(process.argv.slice(2));
  const revision = givenRev ?? latestMainRevision();
  const url = `${RAW_BASE}/${revision}/${UPSTREAM_DATA_PATH}`;
  const [rawList, notice, dataDate] = await Promise.all([
    fetchText(url),
    fetchText(`${RAW_BASE}/${revision}/LICENSE`),
    givenDate ? Promise.resolve(givenDate) : dataChangedDate(revision),
  ]);
  const table = buildRatesTable(JSON.parse(rawList) as UpstreamProvider[], { date: dataDate, built, revision, url, notice });
  const json = formatRatesJson(table);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, json, 'utf8');
  const models = table.providers.reduce((sum, provider) => sum + provider.models.length, 0);
  const summary = `${table.providers.length} providers, ${models} models, ${Buffer.byteLength(json)} bytes`;
  console.log(`Wrote ${out}: ${summary} (rev ${revision.slice(0, 12)}, data ${dataDate}, built ${built}).`);
}

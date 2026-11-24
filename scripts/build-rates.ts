// Makes the checked-in model rates table (assets/model-rates.json) from Pydantic's genai-prices public list
// (prices/data_slim.json, MIT licence). Run by hand before a release: `node scripts/build-rates.ts`.
// This script is the only place that touches the network for rates, and it sends nothing but the public requests for
// the list's commit hash, data_slim.json and LICENSE. Packaging and the app read assets/model-rates.json offline.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ModelRate, RatesTable, RateTier, RateValues } from '../src/rates.ts';

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
  models: { id: string; prices: UpstreamPrices | UpstreamConditional[] }[];
}

const FIELDS: readonly [keyof UpstreamPrices, keyof RateValues][] = [
  ['input_mtok', 'input'],
  ['output_mtok', 'output'],
  ['cache_read_mtok', 'cacheRead'],
  ['cache_write_mtok', 'cacheWrite'],
];

function priceAt(field: UpstreamNumber, above?: number): number {
  if (typeof field === 'number') return field;
  if (above === undefined) return field.base;
  let picked = field.base;
  for (const tier of [...field.tiers].sort((a, b) => a.start - b.start)) {
    if (tier.start <= above) picked = tier.price;
  }
  return picked;
}

function extractRate(prices: UpstreamPrices): ModelRate {
  const rate: ModelRate = {};
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

function resolveModelPrices(prices: UpstreamPrices | UpstreamConditional[], date: string, label: string): ModelRate {
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

/** Builds a dated, trimmed RatesTable from an upstream genai-prices data_slim.json array. Pure, no network. */
export function buildRatesTable(
  upstream: readonly UpstreamProvider[],
  meta: { date: string; revision: string; url: string; notice: string },
): RatesTable {
  const byId = new Map(upstream.map(provider => [provider.id, provider]));
  const providers: Record<string, Record<string, ModelRate>> = {};
  for (const providerId of [...KEPT_PROVIDERS].sort()) {
    const provider = byId.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} is missing from upstream genai-prices.`);
    const models: Record<string, ModelRate> = {};
    for (const model of [...provider.models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const rate = resolveModelPrices(model.prices, meta.date, `${providerId}/${model.id}`);
      if (rate.timeOfDay || rate.input !== undefined || rate.output !== undefined || rate.cacheRead !== undefined || rate.cacheWrite !== undefined) {
        models[model.id] = rate;
      }
    }
    providers[providerId] = models;
  }
  return {
    format: 1,
    date: meta.date,
    source: { name: 'pydantic/genai-prices', url: meta.url, revision: meta.revision, license: 'MIT', notice: meta.notice.trim() },
    providers,
  };
}

/** Deterministic JSON formatting: readable header, one compact line per model so release diffs stay clear and small. */
export function formatRatesJson(table: RatesTable): string {
  const providerBlocks = Object.entries(table.providers).map(([providerId, models]) => {
    const modelLines = Object.entries(models).map(([id, rate]) => `      ${JSON.stringify(id)}: ${JSON.stringify(rate)}`);
    return `    ${JSON.stringify(providerId)}: {\n${modelLines.join(',\n')}\n    }`;
  });
  const sourceJson = JSON.stringify(table.source, null, 2).replace(/\n/g, '\n  ');
  return [
    '{',
    `  "format": ${table.format},`,
    `  "date": ${JSON.stringify(table.date)},`,
    `  "source": ${sourceJson},`,
    '  "providers": {',
    providerBlocks.join(',\n'),
    '  }',
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
  let rev: string | undefined, date = new Date().toISOString().slice(0, 10), out = DEFAULT_OUT;
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
  const models = Object.values(table.providers).reduce((sum, list) => sum + Object.keys(list).length, 0);
  console.log(`Wrote ${out}: ${Object.keys(table.providers).length} providers, ${models} models, ${Buffer.byteLength(json)} bytes (rev ${revision.slice(0, 12)}, date ${date}).`);
}

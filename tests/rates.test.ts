import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bundledRates, coverageText, MODEL_ALIASES, parseRatesTable, priceCredits, priceRequest,
  PROVIDER_ALIASES, sumPrices, USD_PER_AI_CREDIT, type ModelAlias, type PriceResult, type RatesTable,
} from '../src/rates.ts';
import { buildRatesTable, formatRatesJson, KEPT_PROVIDERS, type UpstreamProvider } from '../scripts/build-rates.ts';
import { PACKAGE_IGNORE } from '../scripts/package-app.mjs';

const RATES_FILE = join(import.meta.dirname, '../assets/model-rates.json');
const checkedIn = parseRatesTable(JSON.parse(readFileSync(RATES_FILE, 'utf8')));

const makeTable = (providers: RatesTable['providers']): RatesTable => ({
  format: 1,
  date: '2026-11-24',
  source: { name: 'test', url: 'https://example.invalid/prices.json', revision: '0'.repeat(40), license: 'MIT', notice: 'MIT test notice' },
  providers,
});

// Worked example 1
test('a request for a listed model with all four token kinds is priced to the cent from the table', () => {
  const row = checkedIn.providers.anthropic['claude-opus-4-8'];
  assert.ok(row && row.input !== undefined && row.output !== undefined && row.cacheRead !== undefined && row.cacheWrite !== undefined);
  const tokens = { input: 120_000, cacheRead: 350_000, cacheWrite: 40_000, output: 18_000 };
  const expected = (tokens.input * row.input + tokens.cacheRead * row.cacheRead + tokens.cacheWrite * row.cacheWrite + tokens.output * row.output) / 1_000_000;
  const result = priceRequest({ model: 'claude-opus-4-8', tokens });
  assert.equal(result.priced, true);
  assert.equal(result.basis, 'list');
  assert.equal(result.ratesDate, checkedIn.date);
  assert.deepEqual(result.matched, { provider: 'anthropic', model: 'claude-opus-4-8' });
  assert.equal(Math.round(result.dollars * 100), Math.round(expected * 100));
  assert.ok(Math.abs(result.dollars - expected) < 1e-12);

  // Zero tokens on a listed model prices at $0; zero tokens on an unknown model stays unpriced.
  const zeroKnown = priceRequest({ model: 'claude-opus-4-8', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } });
  assert.equal(zeroKnown.priced, true);
  assert.equal(zeroKnown.dollars, 0);
  const zeroUnknown = priceRequest({ model: 'x'.repeat(500), tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } });
  assert.equal(zeroUnknown.priced, false);
  assert.equal(zeroUnknown.reason, 'not-in-table');
});

// Worked example 2
test('a dated variant in the written alias list is priced; an unaliased id returns not-in-table', () => {
  const row = checkedIn.providers.anthropic['claude-sonnet-4-5'];
  assert.ok(row && row.input !== undefined && row.output !== undefined && row.cacheRead !== undefined && row.cacheWrite !== undefined);
  const tokens = { input: 50_000, cacheRead: 100_000, cacheWrite: 10_000, output: 4_000 };
  const expected = (tokens.input * row.input + tokens.cacheRead * row.cacheRead + tokens.cacheWrite * row.cacheWrite + tokens.output * row.output) / 1_000_000;

  const priced = priceRequest({ model: 'claude-sonnet-4-5-20250929', tokens }, checkedIn);
  assert.equal(priced.priced, true);
  assert.equal(priced.basis, 'list');
  assert.deepEqual(priced.matched, { provider: 'anthropic', model: 'claude-sonnet-4-5' });
  assert.ok(Math.abs(priced.dollars - expected) < 1e-12);

  // Unaliased dated id and newer model family must NOT fuzzy-match a prefix.
  for (const unknown of ['claude-sonnet-4-5-20990101', 'claude-opus-5-5', 'gpt-6.2-astra', '', 'constructor', '__proto__']) {
    const miss = priceRequest({ model: unknown, tokens }, checkedIn);
    assert.equal(miss.priced, false, unknown);
    assert.equal(miss.reason, 'not-in-table', unknown);
  }

  // Exact id always wins over an alias with the same `from`.
  const exactVsAlias = makeTable({ p: { exact: { input: 1, output: 2 }, other: { input: 9, output: 9 } } });
  const chosen = priceRequest({ provider: 'p', model: 'exact', tokens: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 } },
    exactVsAlias, [{ from: 'exact', provider: 'p', to: 'other', reason: 'shadowed' }]);
  assert.equal(chosen.priced, true);
  assert.equal(chosen.dollars, 1);
});

// Worked example 3
test('an id that two rows could match returns no price as ambiguous', () => {
  const tokens = { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 2_000 };
  // Real multi-host model in the checked-in table (deepseek vs fireworks, different prices).
  const realAmbiguous = priceRequest({ model: 'deepseek-v4-pro', tokens }, checkedIn);
  assert.equal(realAmbiguous.priced, false);
  assert.equal(realAmbiguous.reason, 'ambiguous');
  assert.match(realAmbiguous.detail, /could be/);

  // Naming the provider resolves it cleanly.
  const qualified = priceRequest({ provider: 'deepseek', model: 'deepseek-v4-pro', tokens }, checkedIn);
  assert.equal(qualified.priced, true);
  assert.equal(qualified.basis, 'list');
  assert.deepEqual(qualified.matched, { provider: 'deepseek', model: 'deepseek-v4-pro' });

  // Synthetic two-provider table and two-target alias collision both return ambiguous.
  const twoRows = makeTable({
    alpha: { 'shared-model': { input: 1, output: 2 } },
    beta: { 'shared-model': { input: 3, output: 4 } },
  });
  const directConflict = priceRequest({ model: 'shared-model', tokens }, twoRows, []);
  assert.equal(directConflict.priced, false);
  assert.equal(directConflict.reason, 'ambiguous');

  const twoAliases: ModelAlias[] = [
    { from: 'dated-x', provider: 'alpha', to: 'shared-model', reason: 'test a' },
    { from: 'dated-x', provider: 'beta', to: 'shared-model', reason: 'test b' },
  ];
  const aliasConflict = priceRequest({ model: 'dated-x', tokens }, twoRows, twoAliases);
  assert.equal(aliasConflict.priced, false);
  assert.equal(aliasConflict.reason, 'ambiguous');
});

// Worked example 4
test('a model without a cache-write rate refuses requests with cache-write tokens and prices requests with zero cache-write', () => {
  const row = checkedIn.providers.openai['gpt-5.4'];
  assert.ok(row && row.cacheWrite === undefined && row.input !== undefined && row.cacheRead !== undefined && row.output !== undefined);

  const refused = priceRequest({
    provider: 'openai',
    model: 'gpt-5.4',
    tokens: { input: 10_000, cacheRead: 5_000, cacheWrite: 1_000, output: 2_000 },
  }, checkedIn);
  assert.equal(refused.priced, false);
  assert.equal(refused.reason, 'missing-rate');
  assert.match(refused.detail, /cache-write/i);

  const zeroCacheWrite = priceRequest({
    provider: 'openai',
    model: 'gpt-5.4',
    tokens: { input: 10_000, cacheRead: 5_000, cacheWrite: 0, output: 2_000 },
  }, checkedIn);
  assert.equal(zeroCacheWrite.priced, true);
  assert.equal(zeroCacheWrite.basis, 'list');
  const expected = (10_000 * row.input + 5_000 * row.cacheRead + 2_000 * row.output) / 1_000_000;
  assert.ok(Math.abs(zeroCacheWrite.dollars - expected) < 1e-12);
});

// Worked example 5
test('a reported cost above zero wins as basis reported; a reported cost of zero falls back to the list', () => {
  const tokens = { input: 100_000, cacheRead: 0, cacheWrite: 0, output: 10_000 };
  const reported = priceRequest({ model: 'unknown-custom-model', tokens, reported: 0.42 }, checkedIn);
  assert.deepEqual(reported, { priced: true, dollars: 0.42, basis: 'reported' });

  const zeroReported = priceRequest({ model: 'claude-opus-4-8', tokens, reported: 0 }, checkedIn);
  assert.equal(zeroReported.priced, true);
  assert.equal(zeroReported.basis, 'list');
  assert.equal(zeroReported.ratesDate, checkedIn.date);
  const row = checkedIn.providers.anthropic['claude-opus-4-8']!;
  const expected = (tokens.input * row.input! + tokens.output * row.output!) / 1_000_000;
  assert.ok(Math.abs(zeroReported.dollars - expected) < 1e-12);

  // Negative or NaN reported cost is ignored, not trusted.
  const badReported = priceRequest({ model: 'claude-opus-4-8', tokens, reported: -5 }, checkedIn);
  assert.equal(badReported.priced, true);
  assert.equal(badReported.basis, 'list');
});

// Worked example 6
test('AI credits price at one cent each with the credit count kept beside', () => {
  assert.equal(USD_PER_AI_CREDIT, 0.01);
  assert.deepEqual(priceCredits(34), { priced: true, dollars: 0.34, credits: 34, basis: 'credits' });
  assert.deepEqual(priceCredits(14), { priced: true, dollars: 0.14, credits: 14, basis: 'credits' });
  assert.deepEqual(priceCredits(0), { priced: true, dollars: 0, credits: 0, basis: 'credits' });
  assert.deepEqual(priceCredits(1.25), { priced: true, dollars: 0.0125, credits: 1.25, basis: 'credits' });
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = priceCredits(bad);
    assert.equal(result.priced, false);
    assert.equal(result.reason, 'invalid-credits');
  }
});

// Worked example 7
test('summing ten requests with eight priced returns the dollars of the eight and 8 of 10; unpriced never counts as $0', () => {
  const row = checkedIn.providers.anthropic['claude-opus-4-8']!;
  const tokens = { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 };
  const oneExpected = (10_000 * row.input! + 1_000 * row.output!) / 1_000_000;
  const results: PriceResult[] = [
    ...Array.from({ length: 8 }, () => priceRequest({ model: 'claude-opus-4-8', tokens }, checkedIn)),
    priceRequest({ model: 'no-such-model-a', tokens }, checkedIn),
    priceRequest({ model: 'no-such-model-b', tokens }, checkedIn),
  ];
  const sum = sumPrices(results);
  assert.equal(sum.priced, 8);
  assert.equal(sum.total, 10);
  assert.equal(coverageText(sum), '8 of 10 priced');
  assert.ok(sum.dollars !== undefined && Math.abs(sum.dollars - oneExpected * 8) < 1e-12);

  // All unpriced and empty lists: dollars is undefined, never 0; a genuine $0 priced request keeps dollars: 0.
  const nonePriced = sumPrices([results[8]!, results[9]!]);
  assert.equal(nonePriced.dollars, undefined);
  assert.equal(nonePriced.priced, 0);
  assert.equal(nonePriced.total, 2);
  assert.equal(coverageText(nonePriced), '0 of 2 priced');
  assert.deepEqual(sumPrices([]), { dollars: undefined, priced: 0, total: 0 });
  const zeroPriced = sumPrices([priceRequest({ model: 'claude-opus-4-8', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } }, checkedIn)]);
  assert.deepEqual(zeroPriced, { dollars: 0, priced: 1, total: 1 });

  // Credits sum beside dollars.
  const creditSum = sumPrices([priceCredits(34), priceCredits(16), results[8]!]);
  assert.equal(creditSum.priced, 2);
  assert.equal(creditSum.total, 3);
  assert.equal(creditSum.credits, 50);
  assert.equal(creditSum.dollars, 0.5);
});

// Worked example 8
test('the checked-in table is valid, dated, carries its MIT notice and revision, and is included in the app package', () => {
  assert.equal(bundledRates.format, 1);
  assert.match(bundledRates.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bundledRates.source.license, 'MIT');
  assert.match(bundledRates.source.revision, /^[0-9a-f]{40}$/);
  assert.match(bundledRates.source.notice, /Pydantic Services Inc\./);
  assert.match(bundledRates.source.notice, /Permission is hereby granted, free of charge/);
  assert.deepEqual(Object.keys(bundledRates.providers).sort(), [...KEPT_PROVIDERS].sort());
  // Packaging script's ignore list must NOT exclude assets/model-rates.json.
  assert.equal(PACKAGE_IGNORE.some(pattern => pattern.test('/assets/model-rates.json')), false);
});

test('prompt-size tiers switch strictly above the threshold and fail cleanly when a tier lacks a needed rate', () => {
  const row = checkedIn.providers.anthropic['claude-sonnet-4-5']!;
  const tier = row.tiers?.[0];
  assert.ok(tier && row.input !== undefined && row.cacheRead !== undefined && row.output !== undefined);
  assert.ok(tier.input !== undefined && tier.cacheRead !== undefined && tier.output !== undefined);

  // Exactly at the threshold (input + cacheRead = 200_000): base rate applies.
  const atLimit = priceRequest({
    model: 'claude-sonnet-4-5',
    tokens: { input: 100_000, cacheRead: 100_000, cacheWrite: 0, output: 1_000 },
  }, checkedIn);
  assert.equal(atLimit.priced, true);
  const baseExpected = (100_000 * row.input + 100_000 * row.cacheRead + 1_000 * row.output) / 1_000_000;
  assert.ok(Math.abs(atLimit.dollars - baseExpected) < 1e-12);

  // One token past the threshold (input + cacheRead = 200_001): tier rate applies to the whole request.
  const overLimit = priceRequest({
    model: 'claude-sonnet-4-5',
    tokens: { input: 100_001, cacheRead: 100_000, cacheWrite: 0, output: 1_000 },
  }, checkedIn);
  assert.equal(overLimit.priced, true);
  const tierExpected = (100_001 * tier.input + 100_000 * tier.cacheRead + 1_000 * tier.output) / 1_000_000;
  assert.ok(Math.abs(overLimit.dollars - tierExpected) < 1e-12);

  // Tier missing a needed rate (base has cacheRead, tier above 100_000 omits it) refuses as missing-tier.
  const partialTierTable = makeTable({
    testp: { 'm-tiered': { input: 1, output: 2, cacheRead: 0.1, tiers: [{ above: 100_000, input: 2, output: 4 }] } },
  });
  const missingTierRate = priceRequest({
    provider: 'testp',
    model: 'm-tiered',
    tokens: { input: 90_000, cacheRead: 20_000, cacheWrite: 0, output: 500 },
  }, partialTierTable, []);
  assert.equal(missingTierRate.priced, false);
  assert.equal(missingTierRate.reason, 'missing-tier');

  // Time-of-day models (deepseek-chat) refuse cleanly as missing-tier rather than guessing peak vs off-peak.
  const timeOfDay = priceRequest({
    provider: 'deepseek',
    model: 'deepseek-chat',
    tokens: { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 },
  }, checkedIn);
  assert.equal(timeOfDay.priced, false);
  assert.equal(timeOfDay.reason, 'missing-tier');
});

test('provider-qualified lookups honor reseller rows and provider aliases, and unknown providers never fall back', () => {
  const tokens = { input: 250_000, cacheRead: 0, cacheWrite: 0, output: 1_000 };
  const anthropicOpus46 = priceRequest({ provider: 'anthropic', model: 'claude-opus-4-6', tokens }, checkedIn);
  const vertexOpus46 = priceRequest({ provider: 'google-vertex', model: 'claude-opus-4-6', tokens }, checkedIn);
  const bareOpus46 = priceRequest({ model: 'claude-opus-4-6', tokens }, checkedIn);
  assert.equal(anthropicOpus46.priced, true);
  assert.equal(vertexOpus46.priced, true);
  assert.equal(bareOpus46.priced, true);
  assert.equal(bareOpus46.dollars, anthropicOpus46.dollars, 'provider-less Claude matches Anthropic, not Vertex');
  assert.notEqual(vertexOpus46.dollars, anthropicOpus46.dollars, 'Vertex keeps its >200k tier when provider is google-vertex');

  // Azure and OpenRouter match when their provider is named.
  const azure = priceRequest({ provider: 'azure', model: 'o4-mini', tokens: { input: 1_000, cacheRead: 1_000, cacheWrite: 0, output: 500 } }, checkedIn);
  assert.equal(azure.priced, true);
  assert.equal(azure.basis, 'list');
  assert.deepEqual(azure.matched, { provider: 'azure', model: 'o4-mini' });

  const xai = priceRequest({ provider: 'xai', model: 'grok-3', tokens: { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 } }, checkedIn);
  assert.equal(xai.priced, true);
  assert.equal(xai.basis, 'list');
  assert.deepEqual(xai.matched, { provider: 'x-ai', model: 'grok-3' });

  // Unknown provider (e.g. local ollama or fixture) never falls back to another provider's API price.
  const local = priceRequest({ provider: 'ollama', model: 'claude-opus-4-8', tokens }, checkedIn);
  assert.equal(local.priced, false);
  assert.equal(local.reason, 'not-in-table');
});

test('every written alias targets a real row in the checked-in table with a reason and no duplicates', () => {
  const seen = new Set<string>();
  for (const alias of MODEL_ALIASES) {
    assert.ok(alias.reason.trim().length > 0, `reason for ${alias.from}`);
    assert.ok(Object.hasOwn(bundledRates.providers, alias.provider), `provider ${alias.provider}`);
    assert.ok(Object.hasOwn(bundledRates.providers[alias.provider]!, alias.to), `target ${alias.provider}/${alias.to}`);
    const key = `${alias.provider}\0${alias.from}`;
    assert.equal(seen.has(key), false, `duplicate alias ${key}`);
    seen.add(key);
  }
  for (const target of Object.values(PROVIDER_ALIASES)) {
    assert.ok(Object.hasOwn(bundledRates.providers, target), `provider alias target ${target}`);
  }
});

test('negative or non-finite token counts return invalid-tokens and parseRatesTable rejects malformed tables', () => {
  const bad = priceRequest({ model: 'claude-opus-4-8', tokens: { input: -1, cacheRead: 0, cacheWrite: 0, output: 0 } }, checkedIn);
  assert.equal(bad.priced, false);
  assert.equal(bad.reason, 'invalid-tokens');

  assert.throws(() => parseRatesTable({ ...checkedIn, date: '2026-02-31' }), /valid YYYY-MM-DD date/);
  assert.throws(() => parseRatesTable({ ...checkedIn, source: { ...checkedIn.source, notice: '' } }), /notice/);
  assert.throws(() => parseRatesTable(makeTable({ p: { m: { input: -1 } } })), /Invalid input rate/);
  assert.throws(() => parseRatesTable({
    ...checkedIn,
    providers: { p: { m: { input: 1, tiers: [{ above: 100, input: 2, tiers: [{ above: 200, input: 3 }] }] } } },
  }), /Invalid tier/);
});

test('buildRatesTable resolves start_date, extracts tiers, marks time-of-day models, and filters providers offline', () => {
  const upstream: UpstreamProvider[] = [
    ...KEPT_PROVIDERS.map(id => ({ id, models: [{ id: 'base-m', prices: { input_mtok: 1, output_mtok: 2 } }] })),
    { id: 'ignored-provider', models: [{ id: 'x', prices: { input_mtok: 9, output_mtok: 9 } }] },
  ];
  upstream.find(p => p.id === 'anthropic')!.models.push(
    {
      id: 'dated-m',
      prices: [
        { prices: { input_mtok: 10, output_mtok: 20 } },
        { constraint: { start_date: '2026-03-13' }, prices: { input_mtok: 5, output_mtok: 15, cache_read_mtok: 0.5, cache_write_mtok: 6.25 } },
        { constraint: { start_date: '2027-01-01' }, prices: { input_mtok: 1, output_mtok: 2 } },
      ],
    },
    {
      id: 'tiered-m',
      prices: {
        input_mtok: { base: 3, tiers: [{ start: 200_000, price: 6 }] },
        output_mtok: { base: 15, tiers: [{ start: 200_000, price: 22.5 }] },
        cache_read_mtok: 0.3,
      },
    },
  );
  upstream.find(p => p.id === 'deepseek')!.models.push({
    id: 'clock-m',
    prices: [
      { prices: { input_mtok: 0.135, output_mtok: 0.55 } },
      { constraint: { start_time: '00:30:00Z', end_time: '16:30:00Z' }, prices: { input_mtok: 0.27, output_mtok: 1.1 } },
    ],
  });
  const built = buildRatesTable(upstream, {
    date: '2026-11-24', revision: 'a'.repeat(40), url: 'https://example.invalid/data_slim.json', notice: 'MIT notice',
  });
  const reparsed = parseRatesTable(JSON.parse(formatRatesJson(built)));
  assert.equal(Object.hasOwn(reparsed.providers, 'ignored-provider'), false);
  assert.deepEqual(reparsed.providers.anthropic['dated-m'], { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 6.25 });
  assert.deepEqual(reparsed.providers.anthropic['tiered-m'], {
    input: 3, output: 15, cacheRead: 0.3, tiers: [{ above: 200_000, input: 6, output: 22.5, cacheRead: 0.3 }],
  });
  assert.deepEqual(reparsed.providers.deepseek['clock-m'], { timeOfDay: true });
});

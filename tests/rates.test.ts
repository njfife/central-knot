import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bundledRates, coverageText, priceCredits, priceRequest, reportedCost, sumPrices, TOOL_PROVIDERS, USD_PER_AI_CREDIT,
  type ModelRate, type PriceResult, type ProviderRates, type RatesTable,
} from '../src/rates.ts';
import type { Request } from '../src/sessionrequests.ts';
import { buildRatesTable, formatRatesJson, KEPT_PROVIDERS, parseRatesTable, type UpstreamProvider } from '../scripts/build-rates.ts';

const RATES_FILE = join(import.meta.dirname, '../assets/model-rates.json');
const checkedIn = parseRatesTable(JSON.parse(readFileSync(RATES_FILE, 'utf8')));

const rowOf = (providerId: string, modelId: string, table: RatesTable = checkedIn): ModelRate => {
  const provider = table.providers.find(each => each.id === providerId);
  const model = provider?.models.find(each => each.id === modelId);
  assert.ok(model, `missing row ${providerId}/${modelId}`);
  return model;
};

const makeTable = (providers: ProviderRates[]): RatesTable => ({
  format: 1,
  date: '2026-11-24',
  source: { name: 'test', url: 'https://example.invalid/prices.json', revision: '0'.repeat(40), license: 'MIT', notice: 'MIT test notice' },
  providers,
});

// Worked example 1
test('a request for a listed model with all four token kinds is priced to the cent from the table', () => {
  const row = rowOf('anthropic', 'claude-opus-4-8');
  assert.ok(row.input !== undefined && row.output !== undefined && row.cacheRead !== undefined && row.cacheWrite !== undefined);
  const tokens = { input: 120_000, cacheRead: 350_000, cacheWrite: 40_000, output: 18_000 };
  const expected = (tokens.input * row.input + tokens.cacheRead * row.cacheRead + tokens.cacheWrite * row.cacheWrite + tokens.output * row.output) / 1_000_000;
  const result = priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens });
  assert.equal(result.priced, true);
  assert.equal(result.basis, 'list');
  assert.equal(result.ratesDate, checkedIn.date);
  assert.equal(result.atLeast, undefined);
  assert.deepEqual(result.matched, { provider: 'anthropic', model: 'claude-opus-4-8', by: 'exact', providerFrom: 'tool' });
  assert.equal(Math.round(result.dollars * 100), Math.round(expected * 100));
  assert.ok(Math.abs(result.dollars - expected) < 1e-12);

  // Zero tokens on a listed model prices at $0; zero tokens on an unknown model stays unpriced.
  const zeroKnown = priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } });
  assert.equal(zeroKnown.priced, true);
  assert.equal(zeroKnown.dollars, 0);
  const zeroUnknown = priceRequest({ tool: 'claude-cli', model: 'x'.repeat(500), tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } });
  assert.equal(zeroUnknown.priced, false);
  assert.equal(zeroUnknown.reason, 'not-in-table');
});

// Coverage check for the list's own match rules
test('the list rules price claude-fable-5 exact, claude-haiku-4-5-20251001 and claude-opus-5-5 by rule, and leave the 5 unlisted ids unpriced', () => {
  const tokens = { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 };

  const fable = priceRequest({ tool: 'claude-cli', model: 'claude-fable-5', tokens }, checkedIn);
  assert.equal(fable.priced, true);
  assert.equal(fable.basis, 'list');
  assert.deepEqual(fable.matched, { provider: 'anthropic', model: 'claude-fable-5', by: 'exact', providerFrom: 'tool' });

  const haikuDated = priceRequest({ tool: 'claude-cli', model: 'claude-haiku-4-5-20251001', tokens }, checkedIn);
  assert.equal(haikuDated.priced, true);
  assert.equal(haikuDated.basis, 'list');
  assert.deepEqual(haikuDated.matched, { provider: 'anthropic', model: 'claude-haiku-4-5', by: 'rule', providerFrom: 'tool' });
  const haikuRow = rowOf('anthropic', 'claude-haiku-4-5');
  assert.ok(Math.abs(haikuDated.dollars - (10_000 * haikuRow.input! + 1_000 * haikuRow.output!) / 1_000_000) < 1e-12);

  const opus55 = priceRequest({ tool: 'claude-cli', model: 'claude-opus-5-5', tokens }, checkedIn);
  assert.equal(opus55.priced, true);
  assert.equal(opus55.basis, 'list');
  assert.deepEqual(opus55.matched, { provider: 'anthropic', model: 'claude-opus-5', by: 'rule', providerFrom: 'tool' });
  const opus5Row = rowOf('anthropic', 'claude-opus-5');
  assert.ok(Math.abs(opus55.dollars - (10_000 * opus5Row.input! + 1_000 * opus5Row.output!) / 1_000_000) < 1e-12);

  const unlisted: PriceResult[] = [
    priceRequest({ tool: 'codex-cli', model: 'gpt-6-astra', tokens }, checkedIn),
    priceRequest({ tool: 'codex-cli', model: 'gpt-6.2-astra', tokens }, checkedIn),
    priceRequest({ tool: 'codex-cli', model: 'gpt-6.2-sol', tokens }, checkedIn),
    priceRequest({ tool: 'codex-cli', model: 'codex-auto-review', tokens }, checkedIn),
    priceRequest({ tool: 'antigravity-cli', provider: 'google', model: 'gemini-4-neon', tokens }, checkedIn),
  ];
  for (const miss of unlisted) {
    assert.equal(miss.priced, false);
    assert.equal(miss.reason, 'not-in-table');
  }
  const sum = sumPrices([fable, haikuDated, opus55, ...unlisted]);
  assert.equal(coverageText(sum), '3 of 8 priced');
});

test('provider comes from the request or the tool default and is never guessed from the model id', () => {
  const tokens = { input: 250_000, cacheRead: 0, cacheWrite: 0, output: 1_000 };
  assert.deepEqual(TOOL_PROVIDERS, { 'claude-cli': 'anthropic', 'codex-cli': 'openai' });

  // Claude Code and Codex take their first-party provider when the request saves none.
  const codex = priceRequest({ tool: 'codex-cli', model: 'gpt-5.4', tokens: { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 } }, checkedIn);
  assert.equal(codex.priced, true);
  assert.equal(codex.basis, 'list');
  assert.deepEqual(codex.matched, { provider: 'openai', model: 'gpt-5.4', by: 'exact', providerFrom: 'tool' });

  // Other tools with no saved provider return no-provider rather than guessing from the model id.
  for (const tool of ['pi-cli', 'opencode-cli', 'copilot-cli', 'antigravity-cli'] as const) {
    const missing = priceRequest({ tool, model: 'claude-fable-5', tokens }, checkedIn);
    assert.equal(missing.priced, false, tool);
    assert.equal(missing.reason, 'no-provider', tool);
  }

  // Named provider uses that provider (including provider_match rules and fallbacks), never another.
  const anthropicOpus46 = priceRequest({ tool: 'claude-cli', provider: 'anthropic', model: 'claude-opus-4-6', tokens }, checkedIn);
  const vertexOpus46 = priceRequest({ tool: 'pi-cli', provider: 'google-vertex', model: 'claude-opus-4-6', tokens }, checkedIn);
  assert.equal(anthropicOpus46.priced, true);
  assert.equal(anthropicOpus46.basis, 'list');
  assert.equal(anthropicOpus46.matched.providerFrom, 'request');
  assert.equal(vertexOpus46.priced, true);
  assert.equal(vertexOpus46.basis, 'list');
  assert.deepEqual(vertexOpus46.matched, { provider: 'google', model: 'claude-opus-4-6', by: 'exact', providerFrom: 'request' });
  assert.notEqual(vertexOpus46.dollars, anthropicOpus46.dollars, 'Vertex keeps its >200k tier when provider is google-vertex');

  const xai = priceRequest({ tool: 'pi-cli', provider: 'xai', model: 'grok-4.5-20260401', tokens: { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 } }, checkedIn);
  assert.equal(xai.priced, true);
  assert.equal(xai.basis, 'list');
  assert.deepEqual(xai.matched, { provider: 'x-ai', model: 'grok-4.5', by: 'rule', providerFrom: 'request' });

  const bedrock = priceRequest({
    tool: 'pi-cli', provider: 'amazon-bedrock', model: 'us.anthropic.claude-opus-4-6-v1:0',
    tokens: { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 },
  }, checkedIn);
  assert.equal(bedrock.priced, true);
  assert.equal(bedrock.basis, 'list');
  assert.deepEqual(bedrock.matched, { provider: 'aws', model: 'regional.anthropic.claude-opus-4-6-v1:0', by: 'rule', providerFrom: 'request' });

  // Provider fallback: Azure delegates unlisted OpenAI models to openai while keeping its own rows first.
  const azureOwn = priceRequest({ tool: 'pi-cli', provider: 'azure', model: 'o4-mini', tokens: { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 } }, checkedIn);
  assert.equal(azureOwn.priced, true);
  assert.equal(azureOwn.basis, 'list');
  assert.deepEqual(azureOwn.matched, { provider: 'azure', model: 'o4-mini', by: 'exact', providerFrom: 'request' });
  const azureFallback = priceRequest({ tool: 'pi-cli', provider: 'azure', model: 'gpt-5.4', tokens: { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 } }, checkedIn);
  assert.equal(azureFallback.priced, true);
  assert.equal(azureFallback.basis, 'list');
  assert.deepEqual(azureFallback.matched, { provider: 'openai', model: 'gpt-5.4', by: 'exact', providerFrom: 'request' });

  // Unknown provider never falls back to the tool's first-party provider.
  const local = priceRequest({ tool: 'claude-cli', provider: 'ollama', model: 'claude-fable-5', tokens }, checkedIn);
  assert.equal(local.priced, false);
  assert.equal(local.reason, 'not-in-table');
});

test('model matching tries exact id first, then list order, then compact-date normalization, across all clause operators', () => {
  const tokens = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 };

  // Compact date normalization (types.py:363-382): gpt-5.2-20251211 -> gpt-5.2-2025-12-11 -> openai/gpt-5.2.
  const compact = priceRequest({ tool: 'codex-cli', model: 'gpt-5.2-20251211', tokens }, checkedIn);
  assert.equal(compact.priced, true);
  assert.equal(compact.basis, 'list');
  assert.deepEqual(compact.matched, { provider: 'openai', model: 'gpt-5.2', by: 'rule', providerFrom: 'tool' });

  // Compact date matching a row whose own id is dashed still reports by: 'rule'.
  const compactExactRow = priceRequest({ tool: 'pi-cli', provider: 'azure', model: 'o3-20250416', tokens }, checkedIn);
  assert.equal(compactExactRow.priced, true);
  assert.equal(compactExactRow.basis, 'list');
  assert.deepEqual(compactExactRow.matched, { provider: 'azure', model: 'o3-2025-04-16', by: 'rule', providerFrom: 'request' });

  // Exact id beats an earlier wider match rule; between two rules, list order wins; ends_with and and clauses work.
  const table = makeTable([{
    id: 'p',
    models: [
      { id: 'broad', match: { starts_with: 'alpha' }, input: 10, output: 10 },
      { id: 'alpha-exact', match: { equals: 'alpha-exact' }, input: 2, output: 2 },
      { id: 'both', match: { and: [{ starts_with: 'beta' }, { ends_with: '-pro' }] }, input: 4, output: 4 },
    ],
  }]);
  const exact = priceRequest({ tool: 'pi-cli', provider: 'p', model: 'alpha-exact', tokens }, table);
  assert.equal(exact.priced, true);
  assert.equal(exact.basis, 'list');
  assert.equal(exact.dollars, 2);
  assert.equal(exact.matched.by, 'exact');

  const firstRule = priceRequest({ tool: 'pi-cli', provider: 'p', model: 'alpha-other', tokens }, table);
  assert.equal(firstRule.priced, true);
  assert.equal(firstRule.basis, 'list');
  assert.equal(firstRule.dollars, 10);
  assert.deepEqual(firstRule.matched, { provider: 'p', model: 'broad', by: 'rule', providerFrom: 'request' });

  const andHit = priceRequest({ tool: 'pi-cli', provider: 'p', model: 'beta-2-pro', tokens }, table);
  assert.equal(andHit.priced, true);
  assert.equal(andHit.dollars, 4);
  const andMiss = priceRequest({ tool: 'pi-cli', provider: 'p', model: 'beta-2-lite', tokens }, table);
  assert.equal(andMiss.priced, false);
  assert.equal(andMiss.reason, 'not-in-table');

  for (const weird of ['', 'constructor', '__proto__']) {
    const miss = priceRequest({ tool: 'claude-cli', model: weird, tokens }, checkedIn);
    assert.equal(miss.priced, false, weird);
    assert.equal(miss.reason, 'not-in-table', weird);
  }
});

test('non-standard speed and serviceTier are refused, cacheWrite1h is marked atLeast, and missing cache rates charge at input rate', () => {
  const baseTokens = { input: 10_000, cacheRead: 5_000, cacheWrite: 2_000, output: 1_000 };

  // Standard speed and serviceTier price normally; non-standard ones are refused naming which.
  const std = priceRequest({ tool: 'claude-cli', model: 'claude-fable-5', tokens: baseTokens, speed: 'standard', serviceTier: 'standard' }, checkedIn);
  assert.equal(std.priced, true);
  const fast = priceRequest({ tool: 'claude-cli', model: 'claude-fable-5', tokens: baseTokens, speed: 'fast', serviceTier: 'standard' }, checkedIn);
  assert.equal(fast.priced, false);
  assert.equal(fast.reason, 'unsupported-speed');
  assert.match(fast.detail, /fast/);
  const priority = priceRequest({ tool: 'claude-cli', model: 'claude-fable-5', tokens: baseTokens, speed: 'standard', serviceTier: 'priority' }, checkedIn);
  assert.equal(priority.priced, false);
  assert.equal(priority.reason, 'unsupported-service-tier');
  assert.match(priority.detail, /priority/);

  // cacheWrite1h > 0 prices cacheWrite at the list's cache-write rate (never adding cacheWrite1h again) and marks atLeast.
  const claudeRow = rowOf('anthropic', 'claude-opus-4-8');
  const expectedClaude = (10_000 * claudeRow.input! + 5_000 * claudeRow.cacheRead! + 2_000 * claudeRow.cacheWrite! + 1_000 * claudeRow.output!) / 1_000_000;
  const with1h = priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens: { ...baseTokens, cacheWrite1h: 500 } }, checkedIn);
  assert.equal(with1h.priced, true);
  assert.equal(with1h.basis, 'list');
  assert.equal(with1h.atLeast, true);
  assert.ok(Math.abs(with1h.dollars - expectedClaude) < 1e-12);
  const zero1h = priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens: { ...baseTokens, cacheWrite1h: 0 } }, checkedIn);
  assert.equal(zero1h.priced, true);
  assert.equal(zero1h.basis, 'list');
  assert.equal(zero1h.atLeast, undefined);

  // Missing cache-write rate (openai/gpt-5.4): charged at input rate per genai-prices types.py + decompose.py.
  const gpt54 = rowOf('openai', 'gpt-5.4');
  assert.ok(gpt54.cacheWrite === undefined && gpt54.input !== undefined && gpt54.cacheRead !== undefined && gpt54.output !== undefined);
  const gpt54Result = priceRequest({ tool: 'codex-cli', model: 'gpt-5.4', tokens: baseTokens }, checkedIn);
  assert.equal(gpt54Result.priced, true);
  assert.equal(gpt54Result.basis, 'list');
  const expectedGpt54 = (10_000 * gpt54.input + 5_000 * gpt54.cacheRead + 2_000 * gpt54.input + 1_000 * gpt54.output) / 1_000_000;
  assert.ok(Math.abs(gpt54Result.dollars - expectedGpt54) < 1e-12);

  // Missing both cacheRead and cacheWrite rates (openai/gpt-4): both charged at input rate.
  const gpt4 = rowOf('openai', 'gpt-4');
  assert.ok(gpt4.cacheRead === undefined && gpt4.cacheWrite === undefined && gpt4.input !== undefined && gpt4.output !== undefined);
  const gpt4Result = priceRequest({ tool: 'codex-cli', model: 'gpt-4', tokens: baseTokens }, checkedIn);
  assert.equal(gpt4Result.priced, true);
  const expectedGpt4 = ((10_000 + 5_000 + 2_000) * gpt4.input + 1_000 * gpt4.output) / 1_000_000;
  assert.ok(Math.abs(gpt4Result.dollars - expectedGpt4) < 1e-12);

  // Missing root output rate (embedding model) still refuses with missing-rate when output > 0.
  const embed = priceRequest({ tool: 'codex-cli', model: 'text-embedding-3-large', tokens: baseTokens }, checkedIn);
  assert.equal(embed.priced, false);
  assert.equal(embed.reason, 'missing-rate');
  assert.match(embed.detail, /output/i);
});

test('reportedCost is the one rule for reported costs above zero, for requests and session trees alike', () => {
  assert.equal(reportedCost(0.42), 0.42);
  assert.equal(reportedCost(0.0001), 0.0001);
  for (const none of [0, -0.01, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    assert.equal(reportedCost(none), undefined, String(none));
  }

  const tokens = { input: 100_000, cacheRead: 0, cacheWrite: 0, output: 10_000 };
  // Positive reported cost wins even for an unknown model or non-standard speed.
  const reported = priceRequest({ tool: 'claude-cli', model: 'unknown-custom-model', tokens, speed: 'fast', reported: 0.42 }, checkedIn);
  assert.deepEqual(reported, { priced: true, dollars: 0.42, basis: 'reported' });

  // Zero or negative reported cost falls back to list pricing.
  const zeroReported = priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens, reported: 0 }, checkedIn);
  assert.equal(zeroReported.priced, true);
  assert.equal(zeroReported.basis, 'list');
  const row = rowOf('anthropic', 'claude-opus-4-8');
  assert.ok(Math.abs(zeroReported.dollars - (tokens.input * row.input! + tokens.output * row.output!) / 1_000_000) < 1e-12);

  const negativeReported = priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens, reported: -5 }, checkedIn);
  assert.equal(negativeReported.priced, true);
  assert.equal(negativeReported.basis, 'list');
});

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

test('summing ten requests with eight priced returns the dollars of the eight, 8 of 10, and how many are atLeast', () => {
  const row = rowOf('anthropic', 'claude-opus-4-8');
  const plain = { input: 10_000, cacheRead: 0, cacheWrite: 1_000, output: 1_000 };
  const oneHour = { input: 10_000, cacheRead: 0, cacheWrite: 1_000, cacheWrite1h: 400, output: 1_000 };
  const oneExpected = (10_000 * row.input! + 1_000 * row.cacheWrite! + 1_000 * row.output!) / 1_000_000;
  const results: PriceResult[] = [
    ...Array.from({ length: 6 }, () => priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens: plain }, checkedIn)),
    ...Array.from({ length: 2 }, () => priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens: oneHour }, checkedIn)),
    priceRequest({ tool: 'claude-cli', model: 'no-such-model-a', tokens: plain }, checkedIn),
    priceRequest({ tool: 'claude-cli', model: 'no-such-model-b', tokens: plain }, checkedIn),
  ];
  const sum = sumPrices(results);
  assert.equal(sum.priced, 8);
  assert.equal(sum.total, 10);
  assert.equal(sum.atLeast, 2);
  assert.equal(coverageText(sum), '8 of 10 priced');
  assert.ok(sum.dollars !== undefined && Math.abs(sum.dollars - oneExpected * 8) < 1e-12);

  // All unpriced and empty lists: dollars is undefined, never 0; a genuine $0 priced request keeps dollars: 0.
  const nonePriced = sumPrices([results[8]!, results[9]!]);
  assert.deepEqual(nonePriced, { dollars: undefined, priced: 0, total: 2, atLeast: 0 });
  assert.equal(coverageText(nonePriced), '0 of 2 priced');
  assert.deepEqual(sumPrices([]), { dollars: undefined, priced: 0, total: 0, atLeast: 0 });
  const zeroPriced = sumPrices([priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } }, checkedIn)]);
  assert.deepEqual(zeroPriced, { dollars: 0, priced: 1, total: 1, atLeast: 0 });

  // Credits sum beside dollars.
  const creditSum = sumPrices([priceCredits(34), priceCredits(16), results[8]!]);
  assert.deepEqual(creditSum, { dollars: 0.5, priced: 2, total: 3, atLeast: 0, credits: 50 });
});

test('prompt-size tiers switch strictly above the threshold and time-of-day rows refuse as missing-tier', () => {
  const row = rowOf('anthropic', 'claude-sonnet-4-5');
  const tier = row.tiers?.[0];
  assert.ok(tier && row.input !== undefined && row.cacheRead !== undefined && row.output !== undefined);
  assert.ok(tier.input !== undefined && tier.cacheRead !== undefined && tier.output !== undefined);

  // Exactly at the threshold (input + cacheRead = 200_000): base rate applies.
  const atLimit = priceRequest({
    tool: 'claude-cli',
    model: 'claude-sonnet-4-5',
    tokens: { input: 100_000, cacheRead: 100_000, cacheWrite: 0, output: 1_000 },
  }, checkedIn);
  assert.equal(atLimit.priced, true);
  const baseExpected = (100_000 * row.input + 100_000 * row.cacheRead + 1_000 * row.output) / 1_000_000;
  assert.ok(Math.abs(atLimit.dollars - baseExpected) < 1e-12);

  // One token past the threshold (input + cacheRead = 200_001): tier rate applies to the whole request.
  const overLimit = priceRequest({
    tool: 'claude-cli',
    model: 'claude-sonnet-4-5',
    tokens: { input: 100_001, cacheRead: 100_000, cacheWrite: 0, output: 1_000 },
  }, checkedIn);
  assert.equal(overLimit.priced, true);
  const tierExpected = (100_001 * tier.input + 100_000 * tier.cacheRead + 1_000 * tier.output) / 1_000_000;
  assert.ok(Math.abs(overLimit.dollars - tierExpected) < 1e-12);

  // Time-of-day models (deepseek-chat) refuse cleanly as missing-tier rather than guessing peak vs off-peak.
  const timeOfDay = priceRequest({
    tool: 'pi-cli',
    provider: 'deepseek',
    model: 'deepseek-chat',
    tokens: { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 },
  }, checkedIn);
  assert.equal(timeOfDay.priced, false);
  assert.equal(timeOfDay.reason, 'missing-tier');
});

test('non-whole, negative, or out-of-range token counts return invalid-tokens and Request passes straight in', () => {
  const badCounts = [
    { input: -1, cacheRead: 0, cacheWrite: 0, output: 0 },
    { input: 1.5, cacheRead: 0, cacheWrite: 0, output: 0 },
    { input: 10, cacheRead: 0.1, cacheWrite: 0, output: 0 },
    { input: 10, cacheRead: 0, cacheWrite: 10, cacheWrite1h: 11, output: 0 },
    { input: 10, cacheRead: 0, cacheWrite: 10, cacheWrite1h: 1.5, output: 0 },
    { input: Number.NaN, cacheRead: 0, cacheWrite: 0, output: 0 },
    { input: Number.MAX_SAFE_INTEGER + 1, cacheRead: 0, cacheWrite: 0, output: 0 },
  ];
  for (const tokens of badCounts) {
    const result = priceRequest({ tool: 'claude-cli', model: 'claude-opus-4-8', tokens }, checkedIn);
    assert.equal(result.priced, false, JSON.stringify(tokens));
    assert.equal(result.reason, 'invalid-tokens', JSON.stringify(tokens));
  }

  // A sessionrequests.ts Request passes directly to priceRequest without reshaping.
  const req: Request = {
    tool: 'claude-cli', session: 'one', request: 'msg_1', at: Date.parse('2026-11-24T15:30:00Z'),
    model: 'claude-opus-5-5', tokens: { input: 300, cacheRead: 40_000, cacheWrite: 2_000, cacheWrite1h: 500, output: 900 },
    speed: 'standard', serviceTier: 'standard',
  };
  const priced = priceRequest(req);
  assert.equal(priced.priced, true);
  assert.equal(priced.basis, 'list');
  assert.equal(priced.atLeast, true);
  assert.deepEqual(priced.matched, { provider: 'anthropic', model: 'claude-opus-5', by: 'rule', providerFrom: 'tool' });
});

test('the checked-in table passes parseRatesTable with its MIT notice and revision, and malformed tables are rejected', () => {
  assert.equal(bundledRates.format, 1);
  assert.match(bundledRates.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bundledRates.source.license, 'MIT');
  assert.match(bundledRates.source.revision, /^[0-9a-f]{40}$/);
  assert.match(bundledRates.source.notice, /Pydantic Services Inc\./);
  assert.match(bundledRates.source.notice, /Permission is hereby granted, free of charge/);
  assert.deepEqual(bundledRates.providers.map(p => p.id).sort(), [...KEPT_PROVIDERS].sort());
  assert.deepEqual(checkedIn, bundledRates);

  assert.throws(() => parseRatesTable({ ...checkedIn, date: '2026-02-31' }), /valid YYYY-MM-DD date/);
  assert.throws(() => parseRatesTable({ ...checkedIn, source: { ...checkedIn.source, notice: '' } }), /notice/);
  assert.throws(() => parseRatesTable(makeTable([{ id: 'p', models: [{ id: 'm', match: { equals: 'm' }, input: -1 }] }])), /Invalid input rate/);
  assert.throws(() => parseRatesTable(makeTable([{ id: 'p', models: [{ id: 'm', match: { regex: '[unclosed' }, input: 1 }] }])), SyntaxError);
  assert.throws(() => parseRatesTable(makeTable([{ id: 'p', fallbacks: ['missing'], models: [] }])), /Unknown fallback/);
});

test('buildRatesTable preserves list order, match clauses, fallbacks, start_date, tiers and timeOfDay offline', () => {
  const upstream: UpstreamProvider[] = [
    ...KEPT_PROVIDERS.map(id => ({
      id,
      ...(id === 'azure' ? { fallback_model_providers: ['openai', 'ignored-provider'] } : {}),
      ...(id === 'x-ai' ? { provider_match: { equals: 'xai' } as const } : {}),
      models: [{ id: 'base-m', match: { equals: 'base-m' }, prices: { input_mtok: 1, output_mtok: 2 } }],
    })),
    { id: 'ignored-provider', models: [{ id: 'x', match: { equals: 'x' }, prices: { input_mtok: 9, output_mtok: 9 } }] },
  ];
  upstream.find(p => p.id === 'anthropic')!.models.push(
    {
      id: 'dated-m',
      match: { starts_with: 'dated-m' },
      prices: [
        { prices: { input_mtok: 10, output_mtok: 20 } },
        { constraint: { start_date: '2026-03-13' }, prices: { input_mtok: 5, output_mtok: 15, cache_read_mtok: 0.5, cache_write_mtok: 6.25 } },
        { constraint: { start_date: '2027-01-01' }, prices: { input_mtok: 1, output_mtok: 2 } },
      ],
    },
    {
      id: 'tiered-m',
      match: { equals: 'tiered-m' },
      prices: {
        input_mtok: { base: 3, tiers: [{ start: 200_000, price: 6 }] },
        output_mtok: { base: 15, tiers: [{ start: 200_000, price: 22.5 }] },
        cache_read_mtok: 0.3,
      },
    },
  );
  upstream.find(p => p.id === 'deepseek')!.models.push({
    id: 'clock-m',
    match: { equals: 'clock-m' },
    prices: [
      { prices: { input_mtok: 0.135, output_mtok: 0.55 } },
      { constraint: { start_time: '00:30:00Z', end_time: '16:30:00Z' }, prices: { input_mtok: 0.27, output_mtok: 1.1 } },
    ],
  });
  const built = buildRatesTable(upstream, {
    date: '2026-11-24', revision: 'a'.repeat(40), url: 'https://example.invalid/data_slim.json', notice: 'MIT notice',
  });
  const reparsed = parseRatesTable(JSON.parse(formatRatesJson(built)));
  assert.equal(reparsed.providers.some(p => p.id === 'ignored-provider'), false);
  assert.deepEqual(reparsed.providers.find(p => p.id === 'azure')!.fallbacks, ['openai']);
  assert.deepEqual(reparsed.providers.find(p => p.id === 'x-ai')!.match, { equals: 'xai' });
  const anth = reparsed.providers.find(p => p.id === 'anthropic')!;
  assert.deepEqual(anth.models.map(m => m.id), ['base-m', 'dated-m', 'tiered-m'], 'upstream model order is preserved');
  assert.deepEqual(anth.models[1], { id: 'dated-m', match: { starts_with: 'dated-m' }, input: 5, output: 15, cacheRead: 0.5, cacheWrite: 6.25 });
  assert.deepEqual(anth.models[2], {
    id: 'tiered-m', match: { equals: 'tiered-m' }, input: 3, output: 15, cacheRead: 0.3,
    tiers: [{ above: 200_000, input: 6, output: 22.5, cacheRead: 0.3 }],
  });
  assert.deepEqual(reparsed.providers.find(p => p.id === 'deepseek')!.models[1], { id: 'clock-m', match: { equals: 'clock-m' }, timeOfDay: true });
});

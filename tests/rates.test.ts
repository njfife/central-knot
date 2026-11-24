import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bundledRates, priceCredits, priceRequest, reportedCost, TOOL_PROVIDERS, USD_PER_AI_CREDIT,
  type ModelRate, type PriceSet, type ProviderRates, type RatesTable, type UnitPrice,
} from '../src/rates.ts';
import type { Request } from '../src/sessionrequests.ts';
import {
  buildRatesTable, formatRatesJson, KEPT_PROVIDERS, parseRatesTable, UPSTREAM_DATA_PATH, type UpstreamProvider,
} from '../scripts/build-rates.ts';

const RATES_FILE = join(import.meta.dirname, '../assets/model-rates.json');
const checkedIn = parseRatesTable(JSON.parse(readFileSync(RATES_FILE, 'utf8')));
const AT = Date.parse('2026-11-24T12:00:00Z');

const rowOf = (providerId: string, modelId: string, table: RatesTable = checkedIn): ModelRate => {
  const model = table.providers.find(each => each.id === providerId)?.models.find(each => each.id === modelId);
  assert.ok(model, `missing row ${providerId}/${modelId}`);
  return model;
};

const flat = (value: UnitPrice | undefined, totalInput = 0): number => {
  assert.ok(value !== undefined);
  if (typeof value === 'number') return value;
  let rate = value.base;
  for (const tier of value.tiers) if (totalInput > tier.start) rate = tier.price;
  return rate;
};

const baseSetOf = (row: ModelRate): PriceSet => (Array.isArray(row.prices) ? row.prices[0]!.prices : row.prices);

const makeTable = (providers: ProviderRates[]): RatesTable => ({
  format: 1,
  date: '2026-11-24',
  built: '2026-11-24',
  source: { name: 'test', url: 'https://example.invalid/prices.json', revision: '0'.repeat(40), license: 'MIT', notice: 'MIT test notice' },
  providers,
});

test('the eight real ids match the table rates across output, input+output, and all-token mixes', () => {
  const cases: [string, Request['tool'], string | undefined, string, string, 'exact' | 'rule'][] = [
    ['claude-opus-5-5', 'claude-cli', undefined, 'anthropic', 'claude-opus-5-5', 'exact'],
    ['claude-fable-5', 'claude-cli', undefined, 'anthropic', 'claude-fable-5', 'exact'],
    ['claude-haiku-4-5-20251001', 'claude-cli', undefined, 'anthropic', 'claude-haiku-4-5', 'rule'],
    ['gpt-6-astra', 'codex-cli', undefined, 'openai', 'gpt-6-astra', 'exact'],
    ['gpt-6.2-astra', 'codex-cli', undefined, 'openai', 'gpt-6.2-astra', 'exact'],
    ['gpt-6.2-sol', 'codex-cli', undefined, 'openai', 'gpt-6.2-sol', 'exact'],
    ['gemini-4-neon', 'antigravity-cli', 'google', 'google', 'gemini-4-neon', 'exact'],
  ];
  const mixes = [
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 1_000 },
    { input: 100_000, cacheRead: 0, cacheWrite: 0, output: 1_000 },
    { input: 100_000, cacheRead: 10_000, cacheWrite: 4_000, output: 1_000 },
  ];
  for (const [model, tool, provider, expProvider, expModel, by] of cases) {
    const prices = baseSetOf(rowOf(expProvider, expModel));
    for (const tokens of mixes) {
      const totalIn = tokens.input + tokens.cacheRead + tokens.cacheWrite;
      const inp = flat(prices.input, totalIn);
      const cr = prices.cacheRead !== undefined ? flat(prices.cacheRead, totalIn) : inp;
      const cw = prices.cacheWrite !== undefined ? flat(prices.cacheWrite, totalIn) : inp;
      const out = flat(prices.output, totalIn);
      const expected = (tokens.input * inp + tokens.cacheRead * cr + tokens.cacheWrite * cw + tokens.output * out) / 1_000_000;
      const result = priceRequest({ tool, at: AT, model, ...(provider ? { provider } : {}), tokens }, checkedIn);
      assert.equal(result.priced, true, model);
      assert.equal(result.basis, 'list');
      assert.equal(result.ratesDate, checkedIn.date);
      assert.equal(result.atLeast, undefined);
      assert.deepEqual(result.matched, { provider: expProvider, model: expModel, by, providerFrom: provider ? 'request' : 'tool' });
      assert.ok(Math.abs(result.dollars - expected) < 1e-12, `${model}: ${result.dollars} !== ${expected}`);
    }
  }
  const unlisted = priceRequest({ tool: 'codex-cli', at: AT, model: 'codex-auto-review', tokens: mixes[2]! }, checkedIn);
  assert.equal(unlisted.priced, false);
  assert.equal(unlisted.reason, 'not-in-table');
});

test('provider comes from request or tool default and model matching follows list order without an exact-id shortcut', () => {
  const tokens = { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 500 };
  assert.deepEqual(TOOL_PROVIDERS, { 'claude-cli': 'anthropic', 'codex-cli': 'openai' });

  for (const tool of ['pi-cli', 'opencode-cli', 'copilot-cli', 'antigravity-cli'] as const) {
    const missing = priceRequest({ tool, at: AT, model: 'claude-fable-5', tokens }, checkedIn);
    assert.equal(missing.priced, false, tool);
    assert.equal(missing.reason, 'no-provider', tool);
  }
  const unknownProvider = priceRequest({ tool: 'claude-cli', at: AT, provider: 'ollama', model: 'claude-fable-5', tokens }, checkedIn);
  assert.equal(unknownProvider.priced, false);
  assert.equal(unknownProvider.reason, 'not-in-table');

  // No exact-id shortcut: Fireworks rules require the qualified `accounts/fireworks/models/` id.
  const bareFireworks = priceRequest({ tool: 'pi-cli', at: AT, provider: 'fireworks', model: 'deepseek-r1-0528', tokens }, checkedIn);
  assert.equal(bareFireworks.priced, false);
  assert.equal(bareFireworks.reason, 'not-in-table');
  const qualifiedFireworks = priceRequest({
    tool: 'pi-cli', at: AT, provider: 'fireworks', model: 'accounts/fireworks/models/deepseek-r1-0528', tokens,
  }, checkedIn);
  assert.equal(qualifiedFireworks.priced, true);
  assert.equal(qualifiedFireworks.basis, 'list');
  assert.deepEqual(qualifiedFireworks.matched, { provider: 'fireworks', model: 'deepseek-r1-0528', by: 'rule', providerFrom: 'request' });

  // Provider match (`xai` -> `x-ai`), single-hop fallback (`azure` -> `openai`), and compact-date normalization.
  const xai = priceRequest({ tool: 'pi-cli', at: AT, provider: 'xai', model: 'grok-4.5-20260401', tokens }, checkedIn);
  assert.equal(xai.priced, true);
  assert.equal(xai.basis, 'list');
  assert.deepEqual(xai.matched, { provider: 'x-ai', model: 'grok-4.5', by: 'rule', providerFrom: 'request' });

  const azureFallback = priceRequest({ tool: 'pi-cli', at: AT, provider: 'azure', model: 'gpt-6.2-astra', tokens }, checkedIn);
  assert.equal(azureFallback.priced, true);
  assert.equal(azureFallback.basis, 'list');
  assert.deepEqual(azureFallback.matched, { provider: 'openai', model: 'gpt-6.2-astra', by: 'exact', providerFrom: 'request' });

  const compact = priceRequest({ tool: 'codex-cli', at: AT, model: 'gpt-5.2-20251211', tokens }, checkedIn);
  assert.equal(compact.priced, true);
  assert.equal(compact.basis, 'list');
  assert.deepEqual(compact.matched, { provider: 'openai', model: 'gpt-5.2', by: 'rule', providerFrom: 'tool' });

  // List order precedence and `and` / `ends_with` clauses.
  const table = makeTable([{
    id: 'p',
    models: [
      { id: 'first', match: { starts_with: 'alpha' }, prices: { input: 10, output: 10 } },
      { id: 'alpha-two', match: { equals: 'alpha-two' }, prices: { input: 2, output: 2 } },
      { id: 'combo', match: { and: [{ starts_with: 'beta' }, { ends_with: '-pro' }] }, prices: { input: 4, output: 4 } },
    ],
  }]);
  const listWins = priceRequest({ tool: 'pi-cli', at: AT, provider: 'p', model: 'alpha-two', tokens: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 } }, table);
  assert.equal(listWins.priced, true);
  assert.equal(listWins.dollars, 10);
  const andHit = priceRequest({ tool: 'pi-cli', at: AT, provider: 'p', model: 'beta-2-pro', tokens: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 } }, table);
  assert.equal(andHit.priced, true);
  assert.equal(andHit.dollars, 4);
  const andMiss = priceRequest({ tool: 'pi-cli', at: AT, provider: 'p', model: 'beta-2-lite', tokens }, table);
  assert.equal(andMiss.priced, false);
});

test('request timestamp selects startDate and UTC time-of-day constraints, and invalid timestamps are refused', () => {
  const bigPrompt = { input: 250_000, cacheRead: 0, cacheWrite: 0, output: 1_000 };
  const opus46 = rowOf('anthropic', 'claude-opus-4-6');
  assert.ok(Array.isArray(opus46.prices) && opus46.prices.length >= 2);
  const oldSet = opus46.prices[0]!.prices;
  const newSet = opus46.prices[1]!.prices;

  const before = priceRequest({ tool: 'claude-cli', at: Date.parse('2026-03-12T23:59:59Z'), model: 'claude-opus-4-6', tokens: bigPrompt }, checkedIn);
  const after = priceRequest({ tool: 'claude-cli', at: Date.parse('2026-03-13T00:00:00Z'), model: 'claude-opus-4-6', tokens: bigPrompt }, checkedIn);
  assert.equal(before.priced, true);
  assert.equal(after.priced, true);
  const expBefore = (250_000 * flat(oldSet.input, 250_000) + 1_000 * flat(oldSet.output, 250_000)) / 1_000_000;
  const expAfter = (250_000 * flat(newSet.input, 250_000) + 1_000 * flat(newSet.output, 250_000)) / 1_000_000;
  assert.ok(Math.abs(before.dollars - expBefore) < 1e-12);
  assert.ok(Math.abs(after.dollars - expAfter) < 1e-12);
  assert.notEqual(before.dollars, after.dollars);

  // DeepSeek UTC time-of-day pricing (`00:30:00Z`–`16:30:00Z` peak vs off-peak).
  const ds = rowOf('deepseek', 'deepseek-chat');
  assert.ok(Array.isArray(ds.prices) && ds.prices.length === 2);
  const tokens = { input: 100_000, cacheRead: 0, cacheWrite: 0, output: 1_000 };
  const peak = priceRequest({ tool: 'pi-cli', at: Date.parse('2026-11-24T12:00:00Z'), provider: 'deepseek', model: 'deepseek-chat', tokens }, checkedIn);
  const offPeak = priceRequest({ tool: 'pi-cli', at: Date.parse('2026-11-24T16:30:00Z'), provider: 'deepseek', model: 'deepseek-chat', tokens }, checkedIn);
  assert.equal(peak.priced, true);
  assert.equal(offPeak.priced, true);
  assert.ok(Math.abs(peak.dollars - (100_000 * flat(ds.prices[1]!.prices.input) + 1_000 * flat(ds.prices[1]!.prices.output)) / 1_000_000) < 1e-12);
  assert.ok(Math.abs(offPeak.dollars - (100_000 * flat(ds.prices[0]!.prices.input) + 1_000 * flat(ds.prices[0]!.prices.output)) / 1_000_000) < 1e-12);

  // Midnight-crossing time window (`22:00:00Z`–`02:00:00Z`).
  const nightTable = makeTable([{
    id: 'p',
    models: [{
      id: 'm',
      match: { equals: 'm' },
      prices: [
        { prices: { input: 1, output: 1 } },
        { constraint: { startTime: '22:00:00Z', endTime: '02:00:00Z' }, prices: { input: 5, output: 5 } },
      ],
    }],
  }]);
  const oneM = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 };
  const midnight = priceRequest({ tool: 'pi-cli', at: Date.parse('2026-11-24T01:00:00Z'), provider: 'p', model: 'm', tokens: oneM }, nightTable);
  const noon = priceRequest({ tool: 'pi-cli', at: Date.parse('2026-11-24T12:00:00Z'), provider: 'p', model: 'm', tokens: oneM }, nightTable);
  assert.equal(midnight.priced && midnight.dollars, 5);
  assert.equal(noon.priced && noon.dollars, 1);

  const badTime = priceRequest({ tool: 'claude-cli', at: Number.NaN, model: 'claude-fable-5', tokens }, checkedIn);
  assert.equal(badTime.priced, false);
  assert.equal(badTime.reason, 'invalid-time');
});

test('speed and serviceTier variants apply when active and unmatched non-ordinary values are refused', () => {
  const tokens = { input: 100_000, cacheRead: 10_000, cacheWrite: 4_000, cacheWrite1h: 1_500, output: 1_000 };

  // Anthropic `speed: fast` variant (including `cacheWrite1h`) on claude-opus-5-5.
  const opus55 = rowOf('anthropic', 'claude-opus-5-5');
  const fastVar = opus55.variants?.find(v => v.when.speed === 'fast');
  assert.ok(fastVar);
  const fast = priceRequest({ tool: 'claude-cli', at: AT, model: 'claude-opus-5-5', tokens, speed: 'fast', serviceTier: 'standard' }, checkedIn);
  assert.equal(fast.priced, true);
  assert.equal(fast.basis, 'list');
  assert.equal(fast.atLeast, undefined);
  const expFast = (
    100_000 * flat(fastVar.prices.input) + 10_000 * flat(fastVar.prices.cacheRead)
    + 2_500 * flat(fastVar.prices.cacheWrite) + 1_500 * flat(fastVar.prices.cacheWrite1h) + 1_000 * flat(fastVar.prices.output)
  ) / 1_000_000;
  assert.ok(Math.abs(fast.dollars - expFast) < 1e-12);

  // Google `serviceTier: priority` with `startDate: 2026-11-19`: refused before, priced on/after.
  const neon = rowOf('google', 'gemini-4-neon');
  const neonPrio = neon.variants?.find(v => v.when.service_tier === 'priority');
  assert.ok(neonPrio);
  const simple = { input: 100_000, cacheRead: 10_000, cacheWrite: 4_000, output: 1_000 };
  const prioBefore = priceRequest({
    tool: 'antigravity-cli', at: Date.parse('2026-11-18T12:00:00Z'), provider: 'google', model: 'gemini-4-neon', tokens: simple, serviceTier: 'priority',
  }, checkedIn);
  assert.equal(prioBefore.priced, false);
  assert.equal(prioBefore.reason, 'unsupported-service-tier');

  const prioAfter = priceRequest({
    tool: 'antigravity-cli', at: Date.parse('2026-11-19T12:00:00Z'), provider: 'google', model: 'gemini-4-neon', tokens: simple, serviceTier: 'priority',
  }, checkedIn);
  assert.equal(prioAfter.priced, true);
  const expNeonPrio = (
    (100_000 + 4_000) * flat(neonPrio.prices.input) + 10_000 * flat(neonPrio.prices.cacheRead) + 1_000 * flat(neonPrio.prices.output)
  ) / 1_000_000;
  assert.ok(Math.abs(prioAfter.dollars - expNeonPrio) < 1e-12);

  // Ordinary labels ('standard', 'default') use base prices; unmatched non-ordinary speed/serviceTier are refused.
  const ord = priceRequest({ tool: 'claude-cli', at: AT, model: 'claude-haiku-4-5', tokens: simple, speed: 'standard', serviceTier: 'default' }, checkedIn);
  assert.equal(ord.priced, true);
  const badSpeed = priceRequest({ tool: 'claude-cli', at: AT, model: 'claude-haiku-4-5', tokens: simple, speed: 'fast' }, checkedIn);
  assert.equal(badSpeed.priced, false);
  assert.equal(badSpeed.reason, 'unsupported-speed');
  const badTier = priceRequest({ tool: 'claude-cli', at: AT, model: 'claude-opus-5-5', tokens: simple, serviceTier: 'priority' }, checkedIn);
  assert.equal(badTier.priced, false);
  assert.equal(badTier.reason, 'unsupported-service-tier');

  // Fallback rows skip provider variants (types.py:766-769), so non-ordinary serviceTier on azure->openai is refused.
  const fallbackPrio = priceRequest({ tool: 'pi-cli', at: AT, provider: 'azure', model: 'gpt-6.2-astra', tokens: simple, serviceTier: 'priority' }, checkedIn);
  assert.equal(fallbackPrio.priced, false);
  assert.equal(fallbackPrio.reason, 'unsupported-service-tier');
});

test('per-unit tiers switch strictly above start, one-hour writes use cacheWrite1h or mark atLeast, and missing cache rates use ancestor rates', () => {
  // Per-unit tiers on openai/gpt-6.2-astra: exactly 272_000 stays on base, 272_001 switches to tier.
  const astra = baseSetOf(rowOf('openai', 'gpt-6.2-astra'));
  const atEdge = { input: 258_000, cacheRead: 10_000, cacheWrite: 4_000, output: 1_000 };
  const pastEdge = { input: 258_001, cacheRead: 10_000, cacheWrite: 4_000, output: 1_000 };
  const resAt = priceRequest({ tool: 'codex-cli', at: AT, model: 'gpt-6.2-astra', tokens: atEdge }, checkedIn);
  const resPast = priceRequest({ tool: 'codex-cli', at: AT, model: 'gpt-6.2-astra', tokens: pastEdge }, checkedIn);
  assert.equal(resAt.priced, true);
  assert.equal(resPast.priced, true);
  const calc = (t: typeof atEdge) => {
    const tot = t.input + t.cacheRead + t.cacheWrite;
    const num = t.input * flat(astra.input, tot) + t.cacheRead * flat(astra.cacheRead, tot)
      + t.cacheWrite * flat(astra.cacheWrite, tot) + t.output * flat(astra.output, tot);
    return num / 1_000_000;
  };
  assert.ok(Math.abs(resAt.dollars - calc(atEdge)) < 1e-12);
  assert.ok(Math.abs(resPast.dollars - calc(pastEdge)) < 1e-12);
  assert.ok(resPast.dollars > resAt.dollars * 1.5);

  // Row WITH cacheWrite1h (claude-opus-5-5): exact price, no atLeast mark.
  const opus = baseSetOf(rowOf('anthropic', 'claude-opus-5-5'));
  const with1h = { input: 100_000, cacheRead: 10_000, cacheWrite: 4_000, cacheWrite1h: 1_500, output: 1_000 };
  const exact1h = priceRequest({ tool: 'claude-cli', at: AT, model: 'claude-opus-5-5', tokens: with1h }, checkedIn);
  assert.equal(exact1h.priced, true);
  assert.equal(exact1h.basis, 'list');
  assert.equal(exact1h.atLeast, undefined);
  const expOpus1h = (
    100_000 * flat(opus.input) + 10_000 * flat(opus.cacheRead)
    + 2_500 * flat(opus.cacheWrite) + 1_500 * flat(opus.cacheWrite1h) + 1_000 * flat(opus.output)
  ) / 1_000_000;
  assert.ok(Math.abs(exact1h.dollars - expOpus1h) < 1e-12);

  // Row WITHOUT cacheWrite1h (gpt-6.2-astra): 1h part charged at cacheWrite and marked atLeast.
  const fallback1h = priceRequest({ tool: 'codex-cli', at: AT, model: 'gpt-6.2-astra', tokens: with1h }, checkedIn);
  assert.equal(fallback1h.priced, true);
  assert.equal(fallback1h.basis, 'list');
  assert.equal(fallback1h.atLeast, true);
  assert.ok(Math.abs(fallback1h.dollars - calc({ ...with1h })) < 1e-12);

  // Row WITHOUT cacheRead or cacheWrite (openai/gpt-4): both charged at input rate.
  const gpt4 = baseSetOf(rowOf('openai', 'gpt-4'));
  const gpt4Res = priceRequest({ tool: 'codex-cli', at: AT, model: 'gpt-4', tokens: { input: 10_000, cacheRead: 5_000, cacheWrite: 2_000, output: 1_000 } }, checkedIn);
  assert.equal(gpt4Res.priced, true);
  assert.ok(Math.abs(gpt4Res.dollars - ((10_000 + 5_000 + 2_000) * flat(gpt4.input) + 1_000 * flat(gpt4.output)) / 1_000_000) < 1e-12);

  // Input-only embedding model: output > 0 returns missing-rate; output === 0 prices cleanly.
  const embedOut = priceRequest({ tool: 'codex-cli', at: AT, model: 'text-embedding-3-large', tokens: { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 } }, checkedIn);
  assert.equal(embedOut.priced, false);
  assert.equal(embedOut.reason, 'missing-rate');
  const embedIn = priceRequest({ tool: 'codex-cli', at: AT, model: 'text-embedding-3-large', tokens: { input: 100_000, cacheRead: 0, cacheWrite: 0, output: 0 } }, checkedIn);
  assert.equal(embedIn.priced, true);
  assert.ok(Math.abs(embedIn.dollars - (100_000 * flat(baseSetOf(rowOf('openai', 'text-embedding-3-large')).input)) / 1_000_000) < 1e-12);
});

test('reportedCost, AI credits, invalid tokens and Request pass-through', () => {
  assert.equal(reportedCost(0.42), 0.42);
  for (const none of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    assert.equal(reportedCost(none), undefined);
  }
  const tokens = { input: 10_000, cacheRead: 0, cacheWrite: 1_000, output: 1_000 };
  assert.deepEqual(priceRequest({ tool: 'claude-cli', at: AT, model: 'unknown', tokens, speed: 'fast', reported: 0.42 }, checkedIn), {
    priced: true, dollars: 0.42, basis: 'reported',
  });
  const zeroReported = priceRequest({ tool: 'claude-cli', at: AT, model: 'claude-opus-5-5', tokens, reported: 0 }, checkedIn);
  assert.equal(zeroReported.priced, true);
  assert.equal(zeroReported.basis, 'list');

  assert.equal(USD_PER_AI_CREDIT, 0.01);
  assert.deepEqual(priceCredits(34), { priced: true, dollars: 0.34, credits: 34, basis: 'credits' });
  assert.deepEqual(priceCredits(1.25), { priced: true, dollars: 0.0125, credits: 1.25, basis: 'credits' });
  assert.equal(priceCredits(-1).priced, false);

  for (const bad of [
    { input: -1, cacheRead: 0, cacheWrite: 0, output: 0 },
    { input: 1.5, cacheRead: 0, cacheWrite: 0, output: 0 },
    { input: 10, cacheRead: 0, cacheWrite: 10, cacheWrite1h: 11, output: 0 },
    { input: Number.MAX_SAFE_INTEGER + 1, cacheRead: 0, cacheWrite: 0, output: 0 },
  ]) {
    const res = priceRequest({ tool: 'claude-cli', at: AT, model: 'claude-opus-5-5', tokens: bad }, checkedIn);
    assert.equal(res.priced, false);
    assert.equal(res.reason, 'invalid-tokens');
  }

  const req: Request = {
    tool: 'claude-cli', session: 'one', request: 'msg_1', at: AT,
    model: 'claude-opus-5-5', tokens: { input: 300, cacheRead: 40_000, cacheWrite: 2_000, cacheWrite1h: 500, output: 900 },
    speed: 'fast', serviceTier: 'standard',
  };
  const fromReq = priceRequest(req);
  assert.equal(fromReq.priced, true);
  assert.equal(fromReq.basis, 'list');
  assert.equal(fromReq.atLeast, undefined);
});

test('the checked-in table validates with parseRatesTable and buildRatesTable filters to text units and speed/service_tier variants', () => {
  assert.equal(bundledRates.format, 1);
  assert.match(bundledRates.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(bundledRates.built, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bundledRates.source.license, 'MIT');
  assert.match(bundledRates.source.revision, /^[0-9a-f]{40}$/);
  assert.ok(bundledRates.source.url.endsWith(`/${UPSTREAM_DATA_PATH}`));
  assert.match(bundledRates.source.notice, /Pydantic Services Inc\./);
  assert.deepEqual(bundledRates.providers.map(p => p.id).sort(), [...KEPT_PROVIDERS].sort());
  assert.deepEqual(checkedIn, bundledRates);

  assert.throws(() => parseRatesTable({ ...checkedIn, date: '2026-02-31' }), /data date/);
  assert.throws(() => parseRatesTable({ ...checkedIn, built: '2026-02-31' }), /built date/);
  assert.throws(() => parseRatesTable({ ...checkedIn, source: { ...checkedIn.source, notice: '' } }), /notice/);
  assert.throws(() => parseRatesTable(makeTable([{ id: 'p', models: [{ id: 'm', match: { regex: '[bad' }, prices: { input: 1 } }] }])), SyntaxError);
  assert.throws(() => parseRatesTable(makeTable([{ id: 'p', fallbacks: ['missing'], models: [] }])), /Unknown fallback/);

  const upstream: UpstreamProvider[] = [
    ...KEPT_PROVIDERS.map(id => ({
      id,
      ...(id === 'azure' ? { fallback_model_providers: ['openai', 'ignored'] } : {}),
      models: [{ id: 'base-m', match: { equals: 'base-m' }, prices: { input_mtok: 1, output_mtok: 2, web_searches_kcount: 10 } }],
    })),
    { id: 'ignored', models: [{ id: 'x', match: { equals: 'x' }, prices: { input_mtok: 9, output_mtok: 9 } }] },
  ];
  upstream.find(p => p.id === 'anthropic')!.models.push(
    {
      id: 'rich-m',
      match: { equals: 'rich-m' },
      prices: [
        { prices: { input_mtok: { base: 3, tiers: [{ start: 200_000, price: 6 }] }, output_mtok: 15, cache_write_1h_mtok: 7.5 } },
        { constraint: { start_date: '2026-03-13' }, prices: { input_mtok: 5, output_mtok: 15 } },
      ],
      price_variants: [
        { when: { processing: 'batch' }, prices: { input_mtok: 1, output_mtok: 5 } },
        { when: { speed: 'fast' }, constraint: { start_date: '2026-10-14' }, prices: { input_mtok: 10, output_mtok: 30 } },
      ],
    },
    { id: 'audio-only', match: { equals: 'audio-only' }, prices: { audio_hours: 0.1 } },
  );
  const built = buildRatesTable(upstream, {
    date: '2026-11-24', built: '2026-11-24', revision: 'a'.repeat(40), url: 'https://example.invalid/data_slim.json', notice: 'MIT notice',
  });
  const reparsed = parseRatesTable(JSON.parse(formatRatesJson(built)));
  assert.equal(reparsed.providers.some(p => p.id === 'ignored'), false);
  const anth = reparsed.providers.find(p => p.id === 'anthropic')!;
  assert.deepEqual(anth.models.map(m => m.id), ['base-m', 'rich-m'], 'non-text-only audio model is dropped and order preserved');
  assert.deepEqual(anth.models[1]!.variants, [{ when: { speed: 'fast' }, constraint: { startDate: '2026-10-14' }, prices: { input: 10, output: 30 } }]);
  assert.deepEqual(anth.models[0]!.prices, { input: 1, output: 2 }, 'non-text web_searches_kcount stripped');
});

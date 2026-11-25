// A period's sessions read in main (src/sessionday.ts) and made into rows and totals (src/sessionrow.ts), as worked examples.
// TZ is fixed to a daylight-saving zone before any Date runs so local midnights and 25-hour fall-back days are deterministic.
process.env.TZ = 'America/New_York';

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, chmod, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { managedTools, presentTools } from '../src/presence.ts';
import { bundledRates, type ModelRate, type PriceSet, type UnitPrice } from '../src/rates.ts';
import { readSessionPeriod, type DayReading, type Period } from '../src/sessionday.ts';
import { sessionRows } from '../src/sessionrow.ts';
import type { HarnessId, Snapshot } from '../src/types.ts';
import { winLockSkip } from './fslock.ts';

/** Made-up homes under /tmp, restored writable and removed when tests end. */
const homes: string[] = [];
const lockedPaths: string[] = [];
const newHome = async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'ck-sessionday-')));
  homes.push(home);
  return home;
};
after(async () => {
  for (const path of lockedPaths.reverse()) await chmod(path, 0o700).catch(() => undefined);
  await Promise.all(homes.map(home => rm(home, { recursive: true, force: true })));
});

/** Local midnight in America/New_York for (year, month 1-12, day). */
const localMidnight = (year: number, month: number, day: number) => new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
const dayPeriod = (year: number, month: number, day: number): Period => ({
  start: localMidnight(year, month, day),
  end: localMidnight(year, month, day + 1),
});
const TODAY = dayPeriod(2026, 11, 24);
const HOUR = 3_600_000;

const lines = (records: object[]) => records.map(record => `${JSON.stringify(record)}\n`).join('');
async function put(path: string, records: object[], mtimeMs: number) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines(records));
  const at = new Date(mtimeMs);
  await utimes(path, at, at);
}
async function putText(path: string, text: string, mtimeMs: number) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  const at = new Date(mtimeMs);
  await utimes(path, at, at);
}

/** Reads a model's flat/tiered rate directly from the checked-in table so checks track the table's own rates. */
const rateRow = (providerId: string, modelId: string): ModelRate => {
  const row = bundledRates.providers.find(p => p.id === providerId)?.models.find(m => m.id === modelId);
  assert.ok(row, `missing rate row ${providerId}/${modelId}`);
  return row;
};
const baseSet = (row: ModelRate): PriceSet => (Array.isArray(row.prices) ? row.prices[row.prices.length - 1]!.prices : row.prices);
const unit = (price: UnitPrice | undefined, totalInput = 0): number => {
  assert.ok(price !== undefined);
  if (typeof price === 'number') return price;
  let rate = price.base;
  for (const tier of price.tiers) if (totalInput > tier.start) rate = tier.price;
  return rate;
};
const listDollars = (
  prices: PriceSet,
  tokens: { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number; output: number },
) => {
  const totalIn = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const oneHour = tokens.cacheWrite1h ?? 0;
  const inp = unit(prices.input, totalIn);
  const cr = prices.cacheRead !== undefined ? unit(prices.cacheRead, totalIn) : inp;
  const cw = prices.cacheWrite !== undefined ? unit(prices.cacheWrite, totalIn) : inp;
  const cw1h = prices.cacheWrite1h !== undefined ? unit(prices.cacheWrite1h, totalIn) : cw;
  const out = unit(prices.output, totalIn);
  return (tokens.input * inp + tokens.cacheRead * cr + (tokens.cacheWrite - oneHour) * cw + oneHour * cw1h + tokens.output * out) / 1_000_000;
};
const approx = (actual: number | undefined, expected: number, label = 'dollars') => {
  assert.ok(typeof actual === 'number', `${label}: expected number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} !== ${expected}`);
};

const claudeUsage = (
  input: number,
  cacheRead: number,
  cacheWrite: number,
  output: number,
  options: { hour?: number; speed?: string; tier?: string } = {},
) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  output_tokens: output,
  cache_creation: {
    ephemeral_5m_input_tokens: cacheWrite - (options.hour ?? 0),
    ephemeral_1h_input_tokens: options.hour ?? 0,
  },
  speed: options.speed ?? 'standard',
  service_tier: options.tier ?? 'standard',
});
const claudeReply = (id: string, atMs: number, used: object, model = 'claude-fable-5', cwd = '/work/app', session = 'one') => ({
  type: 'assistant',
  sessionId: session,
  cwd,
  isSidechain: false,
  timestamp: new Date(atMs).toISOString(),
  message: {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: 'Private assistant text that must never leave the reader.' }],
    usage: used,
  },
});
const claudeCost = (usd: number, session = 'one', hasUnknownModelCost = false) => ({
  type: 'cost-state',
  sessionId: session,
  totalCostUSD: usd,
  modelUsage: {},
  hasUnknownModelCost,
});

const codexSettings = (atMs: number, tier: string | null) => ({
  timestamp: new Date(atMs).toISOString(),
  type: 'event_msg',
  payload: {
    type: 'thread_settings_applied',
    thread_settings: { ...(tier ? { service_tier: tier } : {}) },
  },
});

const codexMeta = (id: string, atMs: number, options: { parent?: string; provider?: string | null; cwd?: string } = {}) => ({
  timestamp: new Date(atMs).toISOString(),
  type: 'session_meta',
  payload: {
    id,
    session_id: options.parent ?? id,
    ...(options.parent ? { parent_thread_id: options.parent } : {}),
    cwd: options.cwd ?? '/work/codex-app',
    ...(options.provider === null ? {} : { model_provider: options.provider ?? 'openai' }),
  },
});
const codexTurn = (model: string, atMs: number, cwd = '/work/codex-app') => ({
  timestamp: new Date(atMs).toISOString(),
  type: 'turn_context',
  payload: { turn_id: `turn-${atMs}`, cwd, model },
});
const codexUsage = (id: string, atMs: number, input: number, cached: number, output: number, cacheWrite = 0) => ({
  timestamp: new Date(atMs).toISOString(),
  type: 'token_usage_record',
  payload: {
    response_id: id,
    usage: {
      input_tokens: input,
      cached_input_tokens: cached,
      cache_write_input_tokens: cacheWrite,
      output_tokens: output,
      reasoning_output_tokens: 0,
      total_tokens: input + output,
    },
  },
});

const snapshot = (harness: HarnessId, detection: Snapshot['detection']): Snapshot => ({
  harness,
  harnessName: harness,
  surface: 'CLI',
  mode: 'actual',
  label: harness,
  root: `/tmp/${harness}`,
  detection,
  probe: { state: detection === 'Installed' ? 'ok' : 'missing', detail: '' },
  discovery: 'ready',
  skills: [],
  issues: [],
});

async function treeState(root: string): Promise<[string, string, number, number][]> {
  const entries = await readdir(root, { recursive: true });
  const rows: [string, string, number, number][] = [];
  for (const name of entries.sort()) {
    const info = await stat(join(root, name));
    rows.push([name, info.isDirectory() ? 'dir' : 'file', info.size, info.mtimeMs]);
  }
  return rows;
}

// ---------- Worked examples ----------

test('Claude Code present with one session of three claude-fable-5 responses: one row with tokens by kind, table-rate dollars, zero unpriced, and no message text or path', async () => {
  const home = await newHome();
  const file = join(home, '.claude/projects/-work-app/one.jsonl');
  const t1 = TODAY.start + 9 * HOUR;
  const t2 = TODAY.start + 9 * HOUR + 60_000;
  const t3 = TODAY.start + 10 * HOUR;
  await put(file, [
    claudeReply('msg_1', t1, claudeUsage(10_000, 5_000, 2_000, 1_000)),
    claudeReply('msg_2', t2, claudeUsage(20_000, 15_000, 0, 2_500)),
    claudeReply('msg_3', t3, claudeUsage(5_000, 30_000, 1_000, 500)),
  ], t3);

  const reading = await readSessionPeriod({ home }, TODAY, ['claude-cli']);
  const view = sessionRows(reading);

  assert.deepEqual(view.ratesDates, [bundledRates.date], 'the price list date its requests were priced from, once');
  assert.equal(view.rows.length, 1);

  const row = view.rows[0]!;
  const expectedTokens = { input: 35_000, cacheRead: 50_000, cacheWrite: 3_000, output: 4_000 };
  const expectedDollars = listDollars(baseSet(rateRow('anthropic', 'claude-fable-5')), expectedTokens);

  assert.equal(row.tool, 'claude-cli');
  assert.equal(row.session, 'one');
  assert.equal(row.project, 'app');
  assert.equal(row.first, t1);
  assert.equal(row.last, t3);
  assert.deepEqual(row.tokens, expectedTokens);
  assert.equal(row.cost.unpriced, 0);
  assert.equal(row.cost.atLeast, false);
  assert.deepEqual(row.cost.pricedAs, []);
  assert.deepEqual(row.cost.providers, [{ provider: 'anthropic', from: 'tool' }]);
  assert.equal('ratesDates' in row, false, 'ratesDates are once per reading, not per row');
  assert.equal('ratesDates' in row.cost, false);
  approx(row.cost.dollars, expectedDollars, 'row dollars');
  assert.equal(row.models.length, 1);
  assert.equal(row.models[0]!.model, 'claude-fable-5');
  assert.deepEqual(row.models[0]!.tokens, expectedTokens);
  approx(row.models[0]!.cost.dollars, expectedDollars, 'model dollars');
  assert.deepEqual(row.children, []);

  assert.equal(view.total.sessions, 1);
  assert.deepEqual(view.total.tokens, expectedTokens);
  approx(view.total.cost.dollars, expectedDollars, 'total dollars');
  assert.equal(view.total.cost.unpriced, 0);
  assert.equal(view.byTool.length, 1);
  assert.equal(view.byTool[0]!.tool, 'claude-cli');
  assert.equal(view.byTool[0]!.unread, false);
  approx(view.byTool[0]!.cost.dollars, expectedDollars, 'tool dollars');

  const serialized = JSON.stringify({ reading, view });
  assert.equal(serialized.includes('Private assistant text'), false, 'no message text in reading or rows');
  assert.equal(serialized.includes(home), false, 'no home absolute path in reading or rows');
  assert.equal(serialized.includes('/work/app'), false, 'no cwd absolute path in reading or rows');
});

test('Exact models, priced-as rule (haiku dated), fast speed priced vs unsupported speed, Codex priority tier, unpriced codex-auto-review, provider origin, and totals by model', async () => {
  const home = await newHome();
  const t = TODAY.start + 10 * HOUR;

  // Claude Code: claude-opus-5-5 exact + fast variant, claude-haiku-4-5-20251001 priced as claude-haiku-4-5, and claude-haiku-4-5 at unsupported speed 'fast'.
  await put(join(home, '.claude/projects/-work-app/c1.jsonl'), [
    claudeReply('m1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-opus-5-5', '/work/app', 'c1'),
    claudeReply('m2', t + 1_000, claudeUsage(10_000, 0, 0, 1_000, { speed: 'fast' }), 'claude-opus-5-5', '/work/app', 'c1'),
    claudeReply('m3', t + 2_000, claudeUsage(20_000, 0, 0, 2_000), 'claude-haiku-4-5-20251001', '/work/app', 'c1'),
    claudeReply('m4', t + 3_000, claudeUsage(5_000, 0, 0, 500, { speed: 'fast' }), 'claude-haiku-4-5', '/work/app', 'c1'),
  ], t + 3_000);

  // Codex: 2 priced requests (gpt-6-astra, gpt-6.2-sol) with saved provider 'openai' + 1 unpriced (codex-auto-review); plus a rollout with no saved provider.
  await put(join(home, '.codex/sessions/2026/11/24/rollout-x1.jsonl'), [
    codexMeta('x1', t + 4_000, { provider: 'openai' }),
    codexTurn('gpt-6-astra', t + 4_000),
    codexUsage('r1', t + 4_500, 15_000, 5_000, 1_000),
    codexTurn('gpt-6.2-sol', t + 5_000),
    codexUsage('r2', t + 5_500, 10_000, 2_000, 1_000),
    codexTurn('codex-auto-review', t + 6_000),
    codexUsage('r3', t + 6_500, 8_000, 3_000, 400),
  ], t + 6_500);

  await put(join(home, '.codex/sessions/2026/11/24/rollout-x2.jsonl'), [
    codexMeta('x2', t + 7_000, { provider: null }),
    codexSettings(t + 7_000, 'priority'),
    codexTurn('gpt-6.2-sol', t + 7_000),
    codexUsage('r4', t + 7_500, 4_000, 0, 500),
  ], t + 7_500);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli', 'codex-cli']));

  const opusRow = rateRow('anthropic', 'claude-opus-5-5');
  const opusFast = opusRow.variants!.find(v => v.when.speed === 'fast')!.prices;
  const haikuBase = baseSet(rateRow('anthropic', 'claude-haiku-4-5'));
  const astraBase = baseSet(rateRow('openai', 'gpt-6-astra'));
  const solRow = rateRow('openai', 'gpt-6.2-sol');
  const solBase = baseSet(solRow);
  const solPriority = solRow.variants!.find(v => v.when.service_tier === 'priority')!.prices;

  const dOpusBase = listDollars(baseSet(opusRow), { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 });
  const dOpusFast = listDollars(opusFast, { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 });
  const dHaiku = listDollars(haikuBase, { input: 20_000, cacheRead: 0, cacheWrite: 0, output: 2_000 });
  const dAstra = listDollars(astraBase, { input: 10_000, cacheRead: 5_000, cacheWrite: 0, output: 1_000 });
  const dSol1 = listDollars(solBase, { input: 8_000, cacheRead: 2_000, cacheWrite: 0, output: 1_000 });
  const dSol2 = listDollars(solPriority, { input: 4_000, cacheRead: 0, cacheWrite: 0, output: 500 });

  const c1 = view.rows.find(r => r.session === 'c1')!;
  approx(c1.cost.dollars, dOpusBase + dOpusFast + dHaiku, 'c1 dollars');
  assert.equal(c1.cost.unpriced, 1, 'haiku fast has no known price');
  assert.deepEqual(c1.cost.unpricedBy, { noRow: 0, speedOrTier: [{ which: 'speed', saved: 'fast', requests: 1 }], other: 0 }, 'fast reply grouped as speedOrTier');
  assert.deepEqual(c1.cost.pricedAs, [{ model: 'claude-haiku-4-5-20251001', as: 'claude-haiku-4-5' }]);
  assert.deepEqual(c1.cost.providers, [{ provider: 'anthropic', from: 'tool' }]);
  assert.deepEqual(c1.tokens, { input: 45_000, cacheRead: 0, cacheWrite: 0, output: 4_500 }, 'unpriced fast reply tokens still kept');

  const x1 = view.rows.find(r => r.session === 'x1')!;
  approx(x1.cost.dollars, dAstra + dSol1, 'x1 dollars');
  assert.equal(x1.cost.unpriced, 1, 'codex-auto-review has no known price');
  assert.deepEqual(x1.cost.unpricedBy, { noRow: 1, speedOrTier: [], other: 0 }, 'unlisted model grouped as noRow');
  assert.deepEqual(x1.cost.pricedAs, []);
  assert.deepEqual(x1.cost.providers, [{ provider: 'openai', from: 'request' }]);
  assert.deepEqual(x1.tokens, { input: 23_000, cacheRead: 10_000, cacheWrite: 0, output: 2_400 });

  const x2 = view.rows.find(r => r.session === 'x2')!;
  assert.deepEqual(x2.cost.providers, [{ provider: 'openai', from: 'tool' }], 'Codex rollout without saved provider falls back to tool');

  // Day totals & byModel totals.
  approx(view.total.cost.dollars, dOpusBase + dOpusFast + dHaiku + dAstra + dSol1 + dSol2, 'day total dollars');
  assert.equal(view.total.cost.unpriced, 2, 'day total leaves out haiku fast and codex-auto-review');
  assert.deepEqual(view.total.cost.unpricedBy, { noRow: 1, speedOrTier: [{ which: 'speed', saved: 'fast', requests: 1 }], other: 0 });

  const byModel = new Map(view.byModel.map(m => [m.model, m]));
  approx(byModel.get('claude-opus-5-5')!.cost.dollars, dOpusBase + dOpusFast);
  assert.deepEqual(byModel.get('claude-haiku-4-5-20251001')!.cost.pricedAs, [{ model: 'claude-haiku-4-5-20251001', as: 'claude-haiku-4-5' }]);
  assert.equal(byModel.get('claude-haiku-4-5')!.cost.dollars, undefined, 'only request on claude-haiku-4-5 was fast (unpriced)');
  assert.equal(byModel.get('claude-haiku-4-5')!.cost.unpriced, 1);
  approx(byModel.get('gpt-6.2-sol')!.cost.dollars, dSol1 + dSol2, 'gpt-6.2-sol sums across both Codex sessions');
  assert.deepEqual(byModel.get('gpt-6.2-sol')!.cost.providers, [{ provider: 'openai', from: 'request' }, { provider: 'openai', from: 'tool' }]);
  assert.equal(byModel.get('codex-auto-review')!.cost.dollars, undefined, 'codex-auto-review has tokens and no dollars');
  assert.equal(byModel.get('codex-auto-review')!.cost.unpriced, 1);
  assert.deepEqual(byModel.get('codex-auto-review')!.tokens, { input: 5_000, cacheRead: 3_000, cacheWrite: 0, output: 400 });
});

test('A reply refused for its speed or service tier keeps which it was and its saved value, counted, in every sum', async () => {
  const home = await newHome();
  const t = TODAY.start + 9 * HOUR;
  // One Claude Code session on claude-haiku-4-5, whose row has no fast rate and no service-tier rates: two fast replies and
  // one priority reply, each refused for what it saved; a standard reply priced.
  await put(join(home, '.claude/projects/-work-app/s1.jsonl'), [
    claudeReply('f1', t, claudeUsage(1_000, 0, 0, 100, { speed: 'fast' }), 'claude-haiku-4-5', '/work/app', 's1'),
    claudeReply('f2', t + 1_000, claudeUsage(1_000, 0, 0, 100, { speed: 'fast' }), 'claude-haiku-4-5', '/work/app', 's1'),
    claudeReply('p1', t + 2_000, claudeUsage(1_000, 0, 0, 100, { tier: 'priority' }), 'claude-haiku-4-5', '/work/app', 's1'),
    claudeReply('ok', t + 3_000, claudeUsage(1_000, 0, 0, 100), 'claude-haiku-4-5', '/work/app', 's1'),
  ], t + 3_000);
  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli']));
  const refused = [{ which: 'serviceTier', saved: 'priority', requests: 1 }, { which: 'speed', saved: 'fast', requests: 2 }];
  const row = view.rows[0]!;
  assert.equal(row.cost.unpriced, 3);
  assert.deepEqual(row.cost.unpricedBy, { noRow: 0, speedOrTier: refused, other: 0 }, 'the row names each refused speed and tier once, counted');
  assert.deepEqual(row.models[0]!.cost.unpricedBy.speedOrTier, refused, 'the model in the opened row says the same');
  assert.deepEqual(view.byTool[0]!.cost.unpricedBy.speedOrTier, refused, 'the tool total says the same');
  assert.deepEqual(view.total.cost.unpricedBy.speedOrTier, refused, 'the period total says the same');
  assert.ok(row.cost.dollars! > 0, 'the standard reply is priced');
});

test('A session begun yesterday with a response today counts only today\'s responses; exact period edges [start, end) keep 00:00 and 23:59:59.999 and drop 00:00 next day', async () => {
  const home = await newHome();
  const file = join(home, '.claude/projects/-work-app/cross.jsonl');
  await put(file, [
    claudeReply('before', TODAY.start - 1, claudeUsage(90_000, 0, 0, 9_000), 'claude-fable-5', '/work/app', 'cross'),
    claudeReply('at_start', TODAY.start, claudeUsage(1_000, 0, 0, 100), 'claude-fable-5', '/work/app', 'cross'),
    claudeReply('at_last_ms', TODAY.end - 1, claudeUsage(2_000, 0, 0, 200), 'claude-fable-5', '/work/app', 'cross'),
    claudeReply('at_end', TODAY.end, claudeUsage(80_000, 0, 0, 8_000), 'claude-fable-5', '/work/app', 'cross'),
  ], TODAY.end);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli']));
  assert.equal(view.rows.length, 1);
  const row = view.rows[0]!;
  assert.equal(row.first, TODAY.start);
  assert.equal(row.last, TODAY.end - 1);
  assert.deepEqual(row.tokens, { input: 3_000, cacheRead: 0, cacheWrite: 0, output: 300 });
  approx(row.cost.dollars, listDollars(baseSet(rateRow('anthropic', 'claude-fable-5')), { input: 3_000, cacheRead: 0, cacheWrite: 0, output: 300 }));
  assert.deepEqual(view.total.tokens, row.tokens);
});

test('Parent with child (Claude subagents and Codex parent_thread_id on codex-auto-review) and orphan child: child nests under parent, its own sum excludes the child, its sum with its children includes it, a tool counts top-level sessions, each request counts once in the totals', async () => {
  const home = await newHome();
  const t = TODAY.start + 11 * HOUR;

  // Claude Code parent + child + orphan child (parent had no requests today).
  await put(join(home, '.claude/projects/-work-app/p1.jsonl'), [
    claudeReply('pm1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'p1'),
  ], t);
  await put(join(home, '.claude/projects/-work-app/p1/subagents/agent-c1.jsonl'), [
    claudeReply('cm1', t + 5_000, claudeUsage(4_000, 0, 0, 500), 'claude-opus-5-5', '/work/app', 'agent-c1'),
  ], t + 5_000);
  await put(join(home, '.claude/projects/-work-app/gone/subagents/agent-orphan.jsonl'), [
    claudeReply('om1', t + 10_000, claudeUsage(2_000, 0, 0, 200), 'claude-opus-5-5', '/work/app', 'agent-orphan'),
  ], t + 10_000);

  // Codex parent + child on codex-auto-review (also uses session id 'p1' to verify nesting never crosses tools).
  await put(join(home, '.codex/sessions/2026/11/24/rollout-cp.jsonl'), [
    codexMeta('p1', t + 1_000),
    codexTurn('gpt-6-astra', t + 1_000),
    codexUsage('cr1', t + 1_500, 10_000, 0, 1_000),
  ], t + 1_500);
  await put(join(home, '.codex/sessions/2026/11/24/rollout-cc.jsonl'), [
    codexMeta('c-review', t + 2_000, { parent: 'p1' }),
    codexTurn('codex-auto-review', t + 2_000),
    codexUsage('cr2', t + 2_500, 6_000, 1_000, 300),
  ], t + 2_500);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli', 'codex-cli']));

  // Top-level rows: orphan claude child, codex parent p1, claude parent p1: 3 sessions, the two children set under their parents.
  assert.equal(view.rows.length, 3);
  assert.equal(view.total.sessions, 3, 'the day counts top-level sessions');
  assert.deepEqual(view.byTool.map(each => [each.tool, each.sessions]), [['claude-cli', 2], ['codex-cli', 1]], 'a tool counts its top-level sessions');

  const claudeParent = view.rows.find(r => r.tool === 'claude-cli' && r.session === 'p1')!;
  const claudeOrphan = view.rows.find(r => r.tool === 'claude-cli' && r.session === 'agent-orphan')!;
  const codexParent = view.rows.find(r => r.tool === 'codex-cli' && r.session === 'p1')!;

  const dParent = listDollars(baseSet(rateRow('anthropic', 'claude-fable-5')), { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 });
  const dChild = listDollars(baseSet(rateRow('anthropic', 'claude-opus-5-5')), { input: 4_000, cacheRead: 0, cacheWrite: 0, output: 500 });
  const dOrphan = listDollars(baseSet(rateRow('anthropic', 'claude-opus-5-5')), { input: 2_000, cacheRead: 0, cacheWrite: 0, output: 200 });
  const dCodexParent = listDollars(baseSet(rateRow('openai', 'gpt-6-astra')), { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 });

  assert.equal(claudeParent.children.length, 1);
  assert.equal(claudeParent.children[0]!.session, 'agent-c1');
  approx(claudeParent.cost.dollars, dParent, 'Claude parent excludes child dollars');
  assert.deepEqual(claudeParent.tokens, { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 }, 'Claude parent excludes child tokens');
  approx(claudeParent.children[0]!.cost.dollars, dChild);
  approx(claudeParent.withChildren.cost.dollars, dParent + dChild, 'Claude parent with its child');
  assert.deepEqual(claudeParent.withChildren.tokens, { input: 14_000, cacheRead: 0, cacheWrite: 0, output: 1_500 }, 'Claude parent with its child: tokens');
  assert.deepEqual(claudeParent.children[0]!.withChildren, { tokens: claudeParent.children[0]!.tokens, cost: claudeParent.children[0]!.cost }, 'a row with no children: its own sum');

  assert.equal(claudeOrphan.parent, 'gone');
  approx(claudeOrphan.cost.dollars, dOrphan);

  assert.equal(codexParent.children.length, 1);
  assert.equal(codexParent.children[0]!.session, 'c-review');
  assert.equal(codexParent.children[0]!.cost.dollars, undefined);
  assert.equal(codexParent.children[0]!.cost.unpriced, 1);
  assert.equal(codexParent.cost.unpriced, 0, 'Codex parent excludes unpriced child');
  approx(codexParent.cost.dollars, dCodexParent);
  approx(codexParent.withChildren.cost.dollars, dCodexParent, 'Codex parent with its child: the child adds no dollars');
  assert.deepEqual([codexParent.withChildren.cost.unpriced, codexParent.withChildren.cost.unpricedBy.noRow], [1, 1], 'and carries its unpriced request, by reason');

  approx(view.total.cost.dollars, dParent + dChild + dOrphan + dCodexParent, 'day total sums each row once');
  assert.equal(view.total.cost.unpriced, 1);
  assert.deepEqual(view.total.tokens, { input: 31_000, cacheRead: 1_000, cacheWrite: 0, output: 3_000 });
});

test('One-hour cache writes: exact on claude-opus-5-5 (has cacheWrite1h), and "at least" on anthropic/claude-2 (no cacheWrite1h) carried up to every total', async () => {
  const home = await newHome();
  const t = TODAY.start + 12 * HOUR;

  // Verify the table rows we rely on: claude-opus-5-5 has cacheWrite1h; claude-2 has none.
  const opusSet = baseSet(rateRow('anthropic', 'claude-opus-5-5'));
  const claude2Set = baseSet(rateRow('anthropic', 'claude-2'));
  assert.notEqual(opusSet.cacheWrite1h, undefined, 'claude-opus-5-5 has a one-hour cache write rate');
  assert.equal(claude2Set.cacheWrite1h, undefined, 'anthropic/claude-2 has no one-hour cache write rate');

  await put(join(home, '.claude/projects/-work-app/exact1h.jsonl'), [
    claudeReply('e1', t, claudeUsage(10_000, 0, 4_000, 1_000, { hour: 1_500 }), 'claude-opus-5-5', '/work/app', 'exact1h'),
  ], t);
  const exactOnly = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli']));
  assert.equal(exactOnly.rows[0]!.cost.atLeast, false, 'row with cacheWrite1h rate is not atLeast');
  assert.equal(exactOnly.total.cost.atLeast, false);
  assert.equal(exactOnly.rows[0]!.tokens.cacheWrite1h, 1_500);
  approx(exactOnly.rows[0]!.cost.dollars, listDollars(opusSet, { input: 10_000, cacheRead: 0, cacheWrite: 4_000, cacheWrite1h: 1_500, output: 1_000 }));

  // Add a session on anthropic/claude-2 with a one-hour cache write.
  await put(join(home, '.claude/projects/-work-app/lower.jsonl'), [
    claudeReply('l1', t + 5_000, claudeUsage(10_000, 0, 2_000, 500, { hour: 800 }), 'claude-2', '/work/app', 'lower'),
  ], t + 5_000);
  const mixed = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli']));
  const lowerRow = mixed.rows.find(r => r.session === 'lower')!;
  const exactRow = mixed.rows.find(r => r.session === 'exact1h')!;

  assert.equal(lowerRow.cost.atLeast, true);
  assert.equal(lowerRow.models[0]!.cost.atLeast, true);
  assert.equal(exactRow.cost.atLeast, false, 'unrelated session stays exact');
  assert.equal(mixed.byTool[0]!.cost.atLeast, true);
  assert.equal(mixed.byTool[0]!.cost.oneHourLow, true, 'and says it is for the one-hour writes');
  assert.equal(mixed.byModel.find(m => m.model === 'claude-2')!.cost.atLeast, true);
  assert.equal(mixed.byModel.find(m => m.model === 'claude-opus-5-5')!.cost.atLeast, false);
  assert.equal(mixed.total.cost.atLeast, true);
});

test('Files not modified since midnight are never opened (unreadable 000 files before period.start cause no error or unread flag)', { skip: winLockSkip }, async () => {
  const home = await newHome();
  const oldClaude = join(home, '.claude/projects/-work-app/old.jsonl');
  const oldCodex = join(home, '.codex/sessions/2026/11/23/rollout-old.jsonl');
  await put(oldClaude, [claudeReply('old1', TODAY.start - HOUR, claudeUsage(1_000, 0, 0, 100))], TODAY.start - 1);
  await put(oldCodex, [codexMeta('old', TODAY.start - HOUR)], TODAY.start - 1);
  await chmod(oldClaude, 0o000);
  await chmod(oldCodex, 0o000);
  lockedPaths.push(oldClaude, oldCodex);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli', 'codex-cli']));
  assert.equal(view.rows.length, 0);
  assert.deepEqual(view.byTool.map(t => [t.tool, t.sessions, t.unread]), [['claude-cli', 0, false], ['codex-cli', 0, false]]);
});

test('Tool presence (whether or not managed): absent tool has no rows and is not named; present tool with no sessions is named with none', async () => {
  const home = await newHome();
  const t = TODAY.start + 9 * HOUR;
  await put(join(home, '.claude/projects/-work-app/c.jsonl'), [
    claudeReply('m1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'c'),
  ], t);
  // Codex files exist on disk, but Codex is NOT present (leftover folder after uninstall).
  await put(join(home, '.codex/sessions/2026/11/24/rollout-leftover.jsonl'), [
    codexMeta('leftover', t),
    codexTurn('gpt-6-astra', t),
    codexUsage('r1', t, 10_000, 0, 1_000),
  ], t);

  const snapshots = [snapshot('claude-cli', 'Installed'), snapshot('codex-cli', 'Not found')];
  const present = presentTools(snapshots);
  assert.deepEqual(managedTools(snapshots, ['claude-cli']), [], 'Claude Code is not managed, yet still present');
  assert.deepEqual(present, ['claude-cli']);

  const claudeOnly = sessionRows(await readSessionPeriod({ home }, TODAY, present));
  assert.deepEqual(claudeOnly.byTool.map(each => each.tool), ['claude-cli']);
  assert.equal(claudeOnly.rows.length, 1);
  assert.equal(JSON.stringify(claudeOnly).includes('codex-cli'), false);

  // Both present, but Codex has no folder/sessions in a fresh home: Codex is named with 0 sessions.
  const home2 = await newHome();
  await put(join(home2, '.claude/projects/-work-app/c.jsonl'), [
    claudeReply('m1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'c'),
  ], t);
  const bothPresent = sessionRows(await readSessionPeriod({ home: home2 }, TODAY, ['claude-cli', 'codex-cli']));
  assert.deepEqual(bothPresent.byTool.map(each => [each.tool, each.sessions, each.cost.dollars, each.unread]), [
    ['claude-cli', 1, bothPresent.rows[0]!.cost.dollars, false],
    ['codex-cli', 0, undefined, false],
  ]);

  // Neither present: empty byTool and rows.
  const neither = sessionRows(await readSessionPeriod({ home }, TODAY, ['pi-cli']));
  assert.deepEqual(neither.byTool, []);
  assert.deepEqual(neither.rows, []);
});

test('An unreadable modified file and unread lines still return the readable sessions and flag only the affected tool', async ctx => {
  const home = await newHome();
  const t = TODAY.start + 9 * HOUR;

  if (winLockSkip) {
    await ctx.test('an unreadable modified Claude file flags Claude without hiding readable sessions', { skip: winLockSkip }, () => {});
  } else {
    // Claude Code: one readable session and one modified unreadable file.
    await put(join(home, '.claude/projects/-work-app/good.jsonl'), [
      claudeReply('m1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'good'),
    ], t);
    const badClaude = join(home, '.claude/projects/-work-app/bad.jsonl');
    await put(badClaude, [claudeReply('m2', t, claudeUsage(5_000, 0, 0, 500))], t);
    await chmod(badClaude, 0o000);
    lockedPaths.push(badClaude);

    // Codex: one valid rollout with a broken JSON line (unread line).
    const codexFile = join(home, '.codex/sessions/2026/11/24/rollout-partial.jsonl');
    await putText(codexFile, [
      lines([codexMeta('cx1', t), codexTurn('gpt-6-astra', t), codexUsage('r1', t, 10_000, 0, 1_000)]),
      '{not valid json\n',
    ].join(''), t);

    const bothUnread = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli', 'codex-cli']));
    assert.equal(bothUnread.rows.length, 2, 'both readable sessions still return');
    assert.deepEqual(bothUnread.byTool.map(each => [each.tool, each.unread]), [['claude-cli', true], ['codex-cli', true]]);
  }

  // When only Codex has unread lines, Claude Code's unread flag stays false.
  const home2 = await newHome();
  await put(join(home2, '.claude/projects/-work-app/clean.jsonl'), [
    claudeReply('m1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'clean'),
  ], t);
  await putText(join(home2, '.codex/sessions/2026/11/24/rollout-badline.jsonl'), '{broken\n', t);
  const oneUnread = sessionRows(await readSessionPeriod({ home: home2 }, TODAY, ['claude-cli', 'codex-cli']));
  assert.deepEqual(oneUnread.byTool.map(each => [each.tool, each.unread]), [['claude-cli', false], ['codex-cli', true]]);

  // Unreadable tool folder (chmod 000 on .claude/projects) flags Claude without stopping Codex.
  if (winLockSkip) {
    await ctx.test('an unreadable .claude/projects folder flags Claude without stopping Codex', { skip: winLockSkip }, () => {});
  } else {
    const home3 = await newHome();
    const lockedDir = join(home3, '.claude/projects');
    await mkdir(lockedDir, { recursive: true });
    await chmod(lockedDir, 0o000);
    lockedPaths.push(lockedDir);
    await put(join(home3, '.codex/sessions/2026/11/24/rollout-ok.jsonl'), [
      codexMeta('ok', t), codexTurn('gpt-6-astra', t), codexUsage('r1', t, 5_000, 0, 500),
    ], t);
    const folderBlocked = sessionRows(await readSessionPeriod({ home: home3 }, TODAY, ['claude-cli', 'codex-cli']));
    assert.deepEqual(folderBlocked.byTool.map(each => [each.tool, each.sessions, each.unread]), [['claude-cli', 0, true], ['codex-cli', 1, false]]);
  }
});

test('Nothing is written anywhere under the home', async () => {
  const home = await newHome();
  const t = TODAY.start + 9 * HOUR;
  await put(join(home, '.claude/projects/-work-app/one.jsonl'), [
    claudeReply('m1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'one'),
  ], t);
  await put(join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), [
    codexMeta('cx1', t), codexTurn('gpt-6-astra', t), codexUsage('r1', t, 10_000, 0, 1_000),
  ], t);

  const before = await treeState(home);
  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli', 'codex-cli']));
  assert.equal(view.rows.length, 2);
  assert.deepEqual(await treeState(home), before);
});

test('One message or response id appearing in two files of the same session counts once (Claude and Codex archive)', async () => {
  const home = await newHome();
  const t = TODAY.start + 13 * HOUR;

  // Claude Code: same session id 'dup' in two project folders, later copy has final output count.
  await put(join(home, '.claude/projects/-work-a/dup.jsonl'), [
    claudeReply('msg_dup', t, claudeUsage(10_000, 0, 0, 10), 'claude-fable-5', '/work/a', 'dup'),
  ], t);
  await put(join(home, '.claude/projects/-work-b/dup.jsonl'), [
    claudeReply('msg_dup', t + 2_000, claudeUsage(10_000, 0, 0, 500), 'claude-fable-5', '/work/b', 'dup'),
    claudeReply('msg_only_b', t + 5_000, claudeUsage(5_000, 0, 0, 200), 'claude-fable-5', '/work/b', 'dup'),
  ], t + 5_000);

  // Codex: same rollout present in both sessions/ and archived_sessions/.
  const rollout = [codexMeta('tx1', t), codexTurn('gpt-6-astra', t), codexUsage('resp_dup', t + 1_000, 8_000, 2_000, 400)];
  await put(join(home, '.codex/sessions/2026/11/24/rollout-tx1.jsonl'), rollout, t + 1_000);
  await put(join(home, '.codex/archived_sessions/rollout-tx1.jsonl'), rollout, t + 2_000);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli', 'codex-cli']));
  const claudeDup = view.rows.find(r => r.tool === 'claude-cli' && r.session === 'dup')!;
  const codexDup = view.rows.find(r => r.tool === 'codex-cli' && r.session === 'tx1')!;
  assert.deepEqual(claudeDup.tokens, { input: 15_000, cacheRead: 0, cacheWrite: 0, output: 700 }, 'msg_dup kept once with its later record');
  assert.deepEqual(codexDup.tokens, { input: 6_000, cacheRead: 2_000, cacheWrite: 0, output: 400 }, 'resp_dup kept once across sessions and archive');
});

test('Tool-reported figure sits beside a root row only when its whole tree is inside the period, never added to any sum', async ctx => {
  const home = await newHome();
  const t = TODAY.start + 14 * HOUR;

  // (a) Whole tree inside period (parent + child both inside period): carries reported 0.42, never added to list sums.
  await put(join(home, '.claude/projects/-work-app/whole.jsonl'), [
    claudeReply('w1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'whole'),
    claudeCost(0.42, 'whole'),
  ], t);
  await put(join(home, '.claude/projects/-work-app/whole/subagents/agent-wc.jsonl'), [
    claudeReply('wc1', t + 1_000, claudeUsage(5_000, 0, 0, 500), 'claude-opus-5-5', '/work/app', 'agent-wc'),
  ], t + 1_000);

  // (b) Parent has a request before the period: no reported.
  await put(join(home, '.claude/projects/-work-app/before-parent.jsonl'), [
    claudeReply('bp0', TODAY.start - 5_000, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'before-parent'),
    claudeReply('bp1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'before-parent'),
    claudeCost(0.99, 'before-parent'),
  ], t);

  // (c) Parent only today, but modified child has a request before the period: no reported.
  await put(join(home, '.claude/projects/-work-app/before-child.jsonl'), [
    claudeReply('bc1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'before-child'),
    claudeCost(0.88, 'before-child'),
  ], t);
  await put(join(home, '.claude/projects/-work-app/before-child/subagents/agent-old.jsonl'), [
    claudeReply('bco', TODAY.start - 5_000, claudeUsage(1_000, 0, 0, 100), 'claude-opus-5-5', '/work/app', 'agent-old'),
    claudeReply('bcn', t + 1_000, claudeUsage(1_000, 0, 0, 100), 'claude-opus-5-5', '/work/app', 'agent-old'),
  ], t + 1_000);

  // (d) Parent only today, but has an unmodified child file from before the period (never opened!): no reported.
  await put(join(home, '.claude/projects/-work-app/unmod-child.jsonl'), [
    claudeReply('uc1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'unmod-child'),
    claudeCost(0.77, 'unmod-child'),
  ], t);
  const oldChild = join(home, '.claude/projects/-work-app/unmod-child/subagents/agent-yest.jsonl');
  await put(oldChild, [claudeReply('uy', TODAY.start - HOUR, claudeUsage(1_000, 0, 0, 100))], TODAY.start - 1);
  if (winLockSkip) {
    await ctx.test('unmodified child file is locked unreadable to prove it is never opened', { skip: winLockSkip }, () => {});
  } else {
    await chmod(oldChild, 0o000);
    lockedPaths.push(oldChild);
  }

  // (e) Zero cost-state (0), incomplete cost-state (hasUnknownModelCost), and request after period.end: none carries reported.
  await put(join(home, '.claude/projects/-work-app/zero-cost.jsonl'), [
    claudeReply('z1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'zero-cost'),
    claudeCost(0, 'zero-cost'),
  ], t);
  await put(join(home, '.claude/projects/-work-app/incomplete-cost.jsonl'), [
    claudeReply('ic1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'incomplete-cost'),
    claudeCost(0.66, 'incomplete-cost', true),
  ], t);
  await put(join(home, '.claude/projects/-work-app/after-end.jsonl'), [
    claudeReply('ae1', t, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'after-end'),
    claudeReply('ae2', TODAY.end + 5_000, claudeUsage(10_000, 0, 0, 1_000), 'claude-fable-5', '/work/app', 'after-end'),
    claudeCost(1.50, 'after-end'),
  ], TODAY.end + 5_000);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli']));
  const byId = new Map(view.rows.map(r => [r.session, r]));
  const fableOne = listDollars(baseSet(rateRow('anthropic', 'claude-fable-5')), { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 });
  const opusChild = listDollars(baseSet(rateRow('anthropic', 'claude-opus-5-5')), { input: 5_000, cacheRead: 0, cacheWrite: 0, output: 500 });
  const opusSmall = listDollars(baseSet(rateRow('anthropic', 'claude-opus-5-5')), { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 100 });

  assert.equal(byId.get('whole')!.reported, 0.42);
  assert.equal(byId.get('whole')!.children[0]!.reported, undefined);
  approx(byId.get('whole')!.cost.dollars, fableOne, 'whole row dollars stays list price, never 0.42');
  assert.equal(byId.get('before-parent')!.reported, undefined);
  assert.equal(byId.get('before-child')!.reported, undefined);
  assert.equal(byId.get('unmod-child')!.reported, undefined);
  assert.equal(byId.get('zero-cost')!.reported, undefined);
  assert.equal(byId.get('incomplete-cost')!.reported, undefined);
  assert.equal(byId.get('after-end')!.reported, undefined);
  assert.equal(view.byTool[0]!.unread, false, 'unmodified child was never opened');

  // Total sums list prices only (7 fable parents + 2 opus children), never adding 0.42.
  approx(view.total.cost.dollars, 7 * fableOne + opusChild + opusSmall, 'totals never include reportedCost');
});

test('A 25-hour DST fall-back Yesterday (2026-11-01 in America/New_York) keeps 23:30 EST (24.5h past start) and excludes next-day 00:00 even when resumed today', async () => {
  const fallBack = dayPeriod(2026, 11, 1);
  assert.equal(fallBack.end - fallBack.start, 25 * HOUR, '2026-11-01 in America/New_York is 25 hours long');

  const home = await newHome();
  const early = fallBack.start + 1.5 * HOUR;
  const past24h = fallBack.start + 24.5 * HOUR; // 23:30 EST: past naive start+24h, still inside Nov 1
  const lastMs = fallBack.end - 1;
  const nextMidnight = fallBack.end; // 00:00 EST on Nov 2: excluded

  await put(join(home, '.claude/projects/-work-app/dst.jsonl'), [
    claudeReply('d1', early, claudeUsage(1_000, 0, 0, 100), 'claude-fable-5', '/work/app', 'dst'),
    claudeReply('d2', past24h, claudeUsage(2_000, 0, 0, 200), 'claude-fable-5', '/work/app', 'dst'),
    claudeReply('d3', lastMs, claudeUsage(3_000, 0, 0, 300), 'claude-fable-5', '/work/app', 'dst'),
    claudeReply('d4', nextMidnight, claudeUsage(90_000, 0, 0, 9_000), 'claude-fable-5', '/work/app', 'dst'),
  ], nextMidnight + HOUR); // File modified on Nov 2 (today), still read for Nov 1 (yesterday)!

  const view = sessionRows(await readSessionPeriod({ home }, fallBack, ['claude-cli']));
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]!.first, early);
  assert.equal(view.rows[0]!.last, lastMs);
  assert.deepEqual(view.rows[0]!.tokens, { input: 6_000, cacheRead: 0, cacheWrite: 0, output: 600 });
});

test('Concurrent reads for the same home and period join one in-flight read; another period runs apart, and a later call reads afresh', async () => {
  const home = await newHome();
  const file = join(home, '.claude/projects/-work-app/live.jsonl');
  const t1 = TODAY.start + 15 * HOUR;
  await put(file, [claudeReply('m1', t1, claudeUsage(1_000, 0, 0, 100), 'claude-fable-5', '/work/app', 'live')], t1);

  const p1 = readSessionPeriod({ home }, TODAY, ['claude-cli']);
  const p2 = readSessionPeriod({ home }, TODAY, ['claude-cli']);
  const pOther = readSessionPeriod({ home }, dayPeriod(2026, 11, 23), ['claude-cli']);
  assert.equal(p1, p2, 'second concurrent call for same home and period joins the running promise');
  assert.notEqual(p1, pOther, 'different period starts its own read');
  const first = await p1;
  await pOther;
  assert.equal(sessionRows(first).total.tokens.input, 1_000);

  // After settling, a new call runs fresh and sees an appended response.
  await appendFile(file, lines([claudeReply('m2', t1 + 5_000, claudeUsage(2_000, 0, 0, 200), 'claude-fable-5', '/work/app', 'live')]));
  const afterTime = new Date(t1 + 5_000);
  await utimes(file, afterTime, afterTime);
  const second = await readSessionPeriod({ home }, TODAY, ['claude-cli']);
  assert.equal(sessionRows(second).total.tokens.input, 3_000);
});

test('Pure sessionRows guards against synthetic parent cycles without dropping rows and groups remaining unpriced reasons under other', () => {
  const req = (session: string, parent: string, at: number, reason: 'not-in-table' | 'missing-rate') => ({
    request: {
      tool: 'claude-cli' as const, session, parent, request: `m-${session}`, at,
      model: 'claude-fable-5', tokens: { input: 100, cacheRead: 0, cacheWrite: 0, output: 10 },
    },
    price: { priced: false as const, reason, detail: 'test' },
  });
  const reading: DayReading = {
    period: TODAY,
    tools: [{
      tool: 'claude-cli',
      unread: false,
      sessions: [
        { tool: 'claude-cli', session: 'a', parent: 'b', requests: [req('a', 'b', TODAY.start + 1_000, 'not-in-table')] },
        { tool: 'claude-cli', session: 'b', parent: 'a', requests: [req('b', 'a', TODAY.start + 2_000, 'missing-rate')] },
      ],
    }],
  };
  const view = sessionRows(reading);
  assert.equal(view.rows.length, 2, 'cyclic parents stay at top level rather than disappearing');
  assert.equal(view.total.sessions, 2, 'each counted once, as a top-level session');
  assert.deepEqual(view.total.cost.unpricedBy, { noRow: 1, speedOrTier: [], other: 1 });
});

test('An unreadable Codex archive or sibling Claude project folder flags the tool without hiding readable sessions, and makes its sum and the day\'s a lower bound', { skip: winLockSkip }, async () => {
  const home = await newHome();
  const t = TODAY.start + 10 * HOUR;
  await put(join(home, '.claude/projects/readable/good.jsonl'), [
    claudeReply('m1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/readable', 'good'),
  ], t);
  const blockedProject = join(home, '.claude/projects/blocked');
  await mkdir(blockedProject, { recursive: true });
  await chmod(blockedProject, 0o000);
  lockedPaths.push(blockedProject);

  await put(join(home, '.codex/sessions/2026/11/24/rollout-good.jsonl'), [
    codexMeta('good', t), codexTurn('gpt-6.2-sol', t), codexUsage('r1', t, 4_000, 0, 500),
  ], t);
  const blockedArchive = join(home, '.codex/archived_sessions');
  await mkdir(blockedArchive, { recursive: true });
  await chmod(blockedArchive, 0o000);
  lockedPaths.push(blockedArchive);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli', 'codex-cli']));
  assert.deepEqual(view.rows.map(r => `${r.tool}/${r.session}`).sort(), ['claude-cli/good', 'codex-cli/good']);
  assert.deepEqual(view.byTool.map(each => [each.tool, each.sessions, each.unread]), [
    ['claude-cli', 1, true],
    ['codex-cli', 1, true],
  ]);
  assert.deepEqual(view.byTool.map(each => [each.cost.atLeast, each.cost.oneHourLow]), [[true, false], [true, false]], 'a tool with history not read: its sum is a lower bound, for that reason alone');
  assert.deepEqual([view.total.cost.atLeast, view.total.cost.oneHourLow], [true, false], 'and so is the day\'s');
  assert.deepEqual(view.rows.map(row => row.cost.atLeast), [false, false], 'a row read whole stays as it is');
});

test('Restoring a stale partial copy with a newer mtime keeps the fuller reply and the largest tool figure across files', async () => {
  const home = await newHome();
  const t = TODAY.start + 10 * HOUR;
  // Earlier mtime holds the completed reply (800 output) and the larger tool figure (0.42).
  await put(join(home, '.claude/projects/orig/resume.jsonl'), [
    claudeReply('msg', t, claudeUsage(5_000, 0, 0, 800), 'claude-fable-5', '/work/orig', 'resume'),
    claudeCost(0.42, 'resume'),
  ], t + 1_000);
  // Later mtime holds an early partial copy (2 output) with no cost-state.
  await put(join(home, '.claude/projects/backup/resume.jsonl'), [
    claudeReply('msg', t, claudeUsage(5_000, 0, 0, 2), 'claude-fable-5', '/work/orig', 'resume'),
  ], t + 2_000);
  // Another session whose later-mtime copy holds a smaller earlier running total (0.15 < 0.55).
  await put(join(home, '.claude/projects/orig/smaller.jsonl'), [
    claudeReply('msg2', t, claudeUsage(5_000, 0, 0, 400), 'claude-fable-5', '/work/orig', 'smaller'),
    claudeCost(0.55, 'smaller'),
  ], t + 1_000);
  await put(join(home, '.claude/projects/backup/smaller.jsonl'), [
    claudeReply('msg2', t, claudeUsage(5_000, 0, 0, 10), 'claude-fable-5', '/work/orig', 'smaller'),
    claudeCost(0.15, 'smaller'),
  ], t + 2_000);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli']));
  const resume = view.rows.find(r => r.session === 'resume')!;
  const smaller = view.rows.find(r => r.session === 'smaller')!;
  assert.equal(resume.tokens.output, 800, 'fuller reply beats stale partial copy on timestamp tie');
  assert.equal(resume.reported, 0.42, 'tool figure survives stale copy lacking cost-state');
  assert.equal(smaller.tokens.output, 400);
  assert.equal(smaller.reported, 0.55, 'largest running total wins across files');
});

test('An older copy of the same root session, an unread line in the tree, or a listed file missing on open blocks the tool figure and flags the tool where unread', async ctx => {
  const home = await newHome();
  const t = TODAY.start + 14 * HOUR;

  // (a) Root session also has an unopened older copy in another project folder: blocks reported, not unread.
  await put(join(home, '.claude/projects/new-proj/split-root.jsonl'), [
    claudeReply('sr1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'split-root'),
    claudeCost(0.42, 'split-root'),
  ], t);
  const oldCopy = join(home, '.claude/projects/old-proj/split-root.jsonl');
  await put(oldCopy, [claudeReply('sr0', TODAY.start - HOUR, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'split-root')], TODAY.start - 1);
  if (winLockSkip) {
    await ctx.test('older copy of same root session is locked unreadable to prove it is never opened', { skip: winLockSkip }, () => {});
  } else {
    await chmod(oldCopy, 0o000);
    lockedPaths.push(oldCopy);
  }

  const oldRootView = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli']));
  assert.equal(oldRootView.rows[0]!.reported, undefined, 'unopened older copy of same root session blocks tool figure');
  assert.equal(oldRootView.byTool[0]!.unread, false, 'older copy was never opened');

  // (b) Parent with unread JSON line in its own file: blocks reported and flags unread.
  const home2 = await newHome();
  await putText(join(home2, '.claude/projects/p/dirty.jsonl'), [
    lines([claudeReply('d1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'dirty'), claudeCost(0.61, 'dirty')]),
    '{broken\n',
  ].join(''), t);
  const dirtyView = sessionRows(await readSessionPeriod({ home: home2 }, TODAY, ['claude-cli']));
  assert.equal(dirtyView.rows[0]!.reported, undefined, 'tree with unread line carries no tool figure');
  assert.equal(dirtyView.byTool[0]!.unread, true);

  // (c) Listed file missing when opened (ENOENT via broken symlink) or unreadable on read (EACCES): flags unread and blocks parent figure.
  const home3 = await newHome();
  await put(join(home3, '.claude/projects/p/vanish-parent.jsonl'), [
    claudeReply('vp1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'vanish-parent'),
    claudeCost(0.73, 'vanish-parent'),
  ], t);
  await mkdir(join(home3, '.claude/projects/p/vanish-parent/subagents'), { recursive: true });
  await symlink(join(home3, 'gone-target.jsonl'), join(home3, '.claude/projects/p/vanish-parent/subagents/agent-gone.jsonl'));
  if (!winLockSkip) {
    await put(join(home3, '.claude/projects/p/locked-parent.jsonl'), [
      claudeReply('lp1', t, claudeUsage(5_000, 0, 0, 500), 'claude-fable-5', '/work/app', 'locked-parent'),
      claudeCost(0.84, 'locked-parent'),
    ], t);
    const lockedChild = join(home3, '.claude/projects/p/locked-parent/subagents/agent-locked.jsonl');
    await put(lockedChild, [claudeReply('lc1', t, claudeUsage(1_000, 0, 0, 100), 'claude-opus-5-5', '/work/app', 'agent-locked')], t);
    await chmod(lockedChild, 0o000);
    lockedPaths.push(lockedChild);
  }
  await mkdir(join(home3, '.codex/sessions/2026/11/24'), { recursive: true });
  await symlink(join(home3, 'moved-rollout.jsonl'), join(home3, '.codex/sessions/2026/11/24/rollout-moved.jsonl'));
  const goneView = sessionRows(await readSessionPeriod({ home: home3 }, TODAY, ['claude-cli', 'codex-cli']));
  assert.equal(goneView.rows.find(r => r.session === 'vanish-parent')!.reported, undefined, 'missing child file blocks parent figure');
  if (winLockSkip) {
    await ctx.test('an unreadable child file blocks the parent figure', { skip: winLockSkip }, () => {});
  } else {
    assert.equal(goneView.rows.find(r => r.session === 'locked-parent')!.reported, undefined, 'unreadable child file blocks parent figure');
  }
  assert.deepEqual(goneView.byTool.map(each => [each.tool, each.unread]), [['claude-cli', true], ['codex-cli', true]]);
});

test('An unreadable nested folder (Claude subagents or Codex dated day) flags unread without hiding siblings and blocks the parent figure', { skip: winLockSkip }, async () => {
  const home = await newHome();
  const t = TODAY.start + 10 * HOUR;

  // Claude Code: readable parent root.jsonl beside unlistable root/subagents (and even with a second copy in another project).
  await put(join(home, '.claude/projects/p/root.jsonl'), [
    claudeReply('p1', t, claudeUsage(5_000, 0, 0, 800), 'claude-fable-5', '/work/p', 'root'),
    claudeCost(0.42, 'root'),
  ], t);
  const blockedSubagents = join(home, '.claude/projects/p/root/subagents');
  await put(join(blockedSubagents, 'agent-child.jsonl'), [
    claudeReply('c1', t, claudeUsage(1_000, 0, 0, 10), 'claude-fable-5', '/work/p', 'agent-child'),
  ], t);
  await chmod(blockedSubagents, 0o111);
  lockedPaths.push(blockedSubagents);

  // Codex: unlistable dated folder sessions/2026/11/23 beside readable sessions/2026/11/24.
  const blockedDay = join(home, '.codex/sessions/2026/11/23');
  await put(join(blockedDay, 'rollout-old.jsonl'), [
    codexMeta('old', TODAY.start - 1_000), codexTurn('gpt-6.2-sol', TODAY.start - 1_000), codexUsage('r0', TODAY.start - 1_000, 5_000, 0, 10),
  ], TODAY.start - 1_000);
  await chmod(blockedDay, 0o111);
  lockedPaths.push(blockedDay);
  await put(join(home, '.codex/sessions/2026/11/24/rollout-visible.jsonl'), [
    codexMeta('visible', t), codexTurn('gpt-6.2-sol', t), codexUsage('r1', t, 5_000, 0, 30),
  ], t);

  const view = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli', 'codex-cli']));
  assert.deepEqual(view.rows.map(r => `${r.tool}/${r.session}`).sort(), ['claude-cli/root', 'codex-cli/visible']);
  assert.equal(view.rows.find(r => r.session === 'root')!.reported, undefined, 'unlistable subagents blocks parent tool figure');
  assert.deepEqual(view.byTool.map(each => [each.tool, each.sessions, each.unread]), [
    ['claude-cli', 1, true],
    ['codex-cli', 1, true],
  ]);

  // Adding a readable copy of the same root session in another project still keeps reported blocked.
  await put(join(home, '.claude/projects/copy/root.jsonl'), [
    claudeReply('p1', t, claudeUsage(5_000, 0, 0, 800), 'claude-fable-5', '/work/copy', 'root'),
    claudeCost(0.42, 'root'),
  ], t);
  const withCopy = sessionRows(await readSessionPeriod({ home }, TODAY, ['claude-cli']));
  assert.equal(withCopy.rows.find(r => r.session === 'root')!.reported, undefined, 'copy cannot restore figure while subagents are unlistable');
});

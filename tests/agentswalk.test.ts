// A seeded random walk over one agent on real files in a temp home: every click the Agents page and History offer
// (tests/agentclicks.ts), edits, copies and deletions made by hand, Automatic sync off and on, History's days passing, a
// folder that can't be written during a click, a crash before a write or a removal, a harness uninstalled or left out, and
// copies that can't be seen, and passes inside a settle window that is not zero. Walked twice: a plain agent, and one with
// Claude Code fields and Codex tables of its own; beside it, a second agent ("writer") nothing is done to.
// After every step:
//   (a) nothing is lost: each file Central Knot wrote over or removed held a content that is a version of the agent, or is
//       still in a harness. Checked for the step, and for every such content since the walk began;
//   (b) in a copy of the home put back after, two plain passes: the second writes nothing; then an On agent is current in every
//       managed harness it is not kept out of, and an Off or deleted one has nothing applied anywhere;
//   (c) every action the page and History offer does something: none is refused as stale, and each changes a file or the record;
//   (d) from a settled home, Off then On puts every harness's file back byte for byte;
//   (e) a harness Central Knot doesn't manage is never written or removed from;
//   (f) every click made a History entry, after a crash too, and from a settled home its Undo puts every file back as it was;
//   (g) each file Central Knot wrote keeps its harness's own part as last seen (not only the shared part);
//   (h) the second agent is On and its files are as they were in every managed harness.
// A step that makes a copy unseeable (an unreadable file, a half-written save, its folder away or made again, its harness
// uninstalled) is made from a settled home, and asserts that the pass turns nothing Off and removes nothing. Two more run
// passes with a settle window of 2 s on a clock of their own: a copy deleted by hand, and a folder away across three passes
// (inside the window nothing happens; after it the folder is written afresh, and the folder that comes back takes its place).
// The walks in SEEDS run in `npm test`. CK_WALKS=<n> runs n more seeds of each agent, from CK_SEED=<n>;
// CK_ONLY=<seed>[,own] replays one walk, with CK_TRACE=1 step by step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentHash, agentText, parseAgent } from '../src/agentfiles.ts';
import { agentClicks, harnessIs, needsChoice, placeOf } from '../src/agentrow.ts';
import { applyAgents } from '../src/agents.ts';
import { pruneHistory, readHistory } from '../src/manage.ts';
import { wantedIn } from '../src/library.ts';
import { DAY_MS } from '../src/model.ts';
import type { ShareContext } from '../src/share.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { Change, HarnessId, HistoryDays, HistoryEvent, McpResult } from '../src/types.ts';
import { claudeAgent, claudeOwn, codexAgent, fileOf, files, filesOf, historyActions, pass, sandbox, seen, tools as allTools, trial, undo, write, type Tool } from './agentclicks.ts';

/** The walks every `npm test` runs: [seed, with own parts]. */
const SEEDS: [number, boolean][] = [[1, false], [2, true], [3, false], [4, true], [5, false], [6, true], [7, false], [8, true]];
const STEPS = 16;
const random = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
/** An answer that means the page or History offered an action that is stale or does nothing. */
const STALE = /nothing left to undo|no longer in Central Knot’s store|changed since the page was read|at that version already|No tool has a copy/;
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
const contentOf = (tool: Tool, text: string | undefined) => { const agent = text === undefined ? undefined : parseAgent(tool, 'reviewer', text); return agent ? agentHash(agent) : undefined; };
/** Each harness's file as a content (its shared part's hash); a file that is no agent has none. */
const contentsOf = (texts: Record<Tool, string | undefined>) => Object.fromEntries(allTools.map(tool => [tool, contentOf(tool as Tool, texts[tool as Tool])])) as Record<Tool, string | undefined>;
/** A file's own part: the file with its shared part (name, description, prompt) written over by one fixed agent. */
const ownOf = (tool: Tool, text: string | undefined) => { try { return text === undefined || !contentOf(tool, text) ? undefined : agentText(tool, { name: 'x', description: 'x', prompt: 'x' }, text); } catch { return undefined; } };
/** The second agent, which no step touches: its file in each harness. */
const writerFiles = { 'claude-cli': '.claude/agents/writer.md', 'copilot-cli': '.copilot/agents/writer.agent.md', 'codex-cli': '.codex/agents/writer.toml' } as const;

interface Finding { kind: string; trace: string }
async function walk(seed: number, ownParts: boolean): Promise<Finding[]> {
  const next = random(seed), pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const box = await sandbox(), tools = box.tools;
  /** Makes `managed` the harnesses Central Knot manages here (the rest uninstalled, or left out by the tool choice). */
  const manage = (managed: HarnessId[]) => { tools.splice(0, tools.length, ...allTools.filter(tool => managed.includes(tool))); };
  /** The agent as the record has it, as text: what a click or a pass changed besides files. */
  const recordText = () => readFile(join(box.home, '.central-knot', 'agents.json'), 'utf8').catch(() => '');
  let days: HistoryDays = 30, marker = 0, syncOn = true, settled = true, last: McpResult | undefined;
  const context = (more: Partial<ShareContext> = {}): ShareContext => ({ ...box.context, historyDays: days, ...more });
  const trace = [`seed ${seed}${ownParts ? ' own' : ''}`];
  const found: Finding[] = [];
  const fail = (kind: string) => { found.push({ kind, trace: trace.join(' → ') }); };
  /** Every content Central Knot wrote over or removed since the walk began: each must stay a version, or in a harness. */
  const taken = new Set<string>();
  const send = (change: Change, more: Partial<ShareContext> = {}) => applyAgents(context(more), tools, [change], syncOn ? {} : { only: new Set(['reviewer']) });
  const readOnly = (tool: Tool, on: boolean) => chmod(join(box.home, files[tool], '..'), on ? 0o555 : 0o755).catch(() => undefined);
  const versionsNow = async () => new Set(((await seen(box, context())).item?.versions ?? []).map(version => version.hash));
  const writerNow = async () => Object.fromEntries(await Promise.all(allTools.map(async tool => [tool, await readFile(join(box.home, writerFiles[tool as Tool]), 'utf8').catch(() => undefined)] as const)));
  const historyCount = async () => (await readHistory(context())).filter(event => event.key === 'agent:reviewer').length;
  /** The second agent's files once it is taken in (h). */
  let writerAsWritten: Record<string, string | undefined> = {};
  /** Each harness's own part as Central Knot last saw it: in a managed harness, around a step where it acted (g). */
  const lastOwn: Partial<Record<Tool, string>> = {};
  /** A clock for passes with a settle window, far from the real one; each such step moves it on. */
  let clock = Date.now() + 1e9;

  /** (b) on the home as it is, in a trial: two passes; whether the first found nothing to do (no write, nothing held, the agent as it was). */
  const settles = async (when = '') => trial(box, async () => {
    const record = await recordText();
    const first = await pass(box, context()), unchanged = record === await recordText();
    const second = await pass(box, context());
    if (second.writes) fail(`(b${when}) a second plain pass writes: ${second.results.map(entry => entry.message).join(' | ').slice(0, 120)}`);
    const writer = await writerNow();
    for (const tool of tools) if (writer[tool] !== writerAsWritten[tool]) fail(`(h) the second agent's file in ${tool} is not as it was`);
    const { row, item } = await seen(box, context());
    if (!item) return !first.writes && unchanged;
    for (const tool of tools) {
      const is = harnessIs(row, item, tool);
      const wanted = wantedIn(item, tool);
      if (wanted && !['current', 'cannot'].includes(is)) fail(`(b${when}) after quiet passes an On agent is “${is}” in ${tool}`);
      if (item.on && !item.deleted && !wanted && !['kept-out', 'own-copy'].includes(is)) fail(`(b${when}) after quiet passes an agent kept out of ${tool} is “${is}” there`);
      if ((!item.on || item.deleted) && item.applied[tool] !== undefined) fail(`(b${when}) after quiet passes an Off agent still has a copy applied in ${tool}`);
    }
    return unchanged && !first.writes && !first.results.some(entry => entry.outcome === 'held' || entry.outcome === 'failed');
  });

  try {
    await write(box, 'claude-cli', claudeAgent(undefined, ownParts ? claudeOwn : ''));
    if (ownParts) await write(box, 'codex-cli', codexAgent());
    await applyAgents(context(), tools, [agentClicks.on((await seen(box)).row, undefined)]);
    await writeFile(join(box.home, writerFiles['claude-cli']), claudeAgent('You write docs.\n').replace('name: reviewer', 'name: writer'));
    await applyAgents(context(), tools, [{ key: 'writer', managed: true, off: [], seenManaged: false }]);
    writerAsWritten = await writerNow();
    for (let step = 0; step < STEPS && !found.length; step++) {
      const { row, item, fact } = await seen(box, context());
      const place = placeOf(item), held = item && !item.deleted ? item : undefined;
      const present = (allTools as Tool[]).filter(tool => fact?.copies[tool] !== undefined);
      /**
       * `app`: Central Knot acts (a click, a pass, a History action), so (a) and (e) are checked. `click`: its result has an Undo.
       * `byHand`: the step changes files by hand itself as well, so no folder is made read-only and no crash comes with it.
       */
      type Act = { name: string; run: (more?: Partial<ShareContext>) => Promise<unknown>; app?: boolean; click?: boolean; byHand?: boolean };
      const acts: Act[] = [];
      const add = (weight: number, act: Act) => { for (let count = 0; count < weight; count++) acts.push(act); };
      const clicks = (weight: number, name: string, change: Change) => add(weight, { name, app: true, click: true, run: more => send(change, more) });
      if (place === 'on') clicks(4, 'Off', agentClicks.off(row, item));
      if (place === 'off') clicks(4, 'On', agentClicks.on(row, item));
      if (place === 'found' && present.length) {
        if (!needsChoice(row, item)) clicks(4, 'On (take in)', agentClicks.on(row, item));
        else for (const tool of present.filter(tool => tools.includes(tool))) clicks(2, `choose ${tool}`, agentClicks.on(row, item, tool));
      }
      if (held?.on) for (const tool of tools) clicks(1, `${held.except.includes(tool) ? 'let in' : 'keep out of'} ${tool}`, agentClicks.inHarness(row, item, tool, !held.except.includes(tool)));
      for (const version of held?.versions.filter(version => version.hash !== held.hash).slice(0, 3) ?? []) clicks(1, `make current ${version.from.how}`, agentClicks.makeCurrent(row, item, version.hash));
      if (held) clicks(1, 'Delete', agentClicks.remove(row, item));
      for (const action of await historyActions(box, context())) add(2, { name: `History: ${action.label} (${action.event.kind})`, app: true, run: () => action.run() });
      if (last?.made?.length) { const click = last; add(2, { name: 'Undo', app: true, run: () => undo(box, click, context()) }); }
      for (const tool of allTools as Tool[]) {
        const text = (await filesOf(box))[tool];
        const saved = async (edited: string) => { await write(box, tool, edited); await utimes(fileOf(box, tool), new Date(), new Date(Date.now() + ++marker * 1000)); };
        if (text !== undefined) {
          add(2, { name: `hand edit in ${tool}`, run: () => saved(text.replace(/(Be \w+\.|Hand \d+\.)/, `Hand ${marker + 1}.`)) });
          add(1, { name: `hand delete in ${tool}`, run: () => rm(fileOf(box, tool)) });
        } else add(1, { name: `hand-made copy in ${tool}`, run: () => saved(tool === 'codex-cli' ? codexAgent(`Hand ${marker + 1}.\n`) : claudeAgent(`Hand ${marker + 1}.\n`)) });
      }
      add(2, { name: 'pass', app: true, run: more => pass(box, context(more)) });
      add(1, { name: `Automatic sync ${syncOn ? 'off' : 'on'}`, run: async () => { syncOn = !syncOn; } });
      add(1, { name: 'age', run: async () => {
        const by = pick([8, 31, 91]), path = join(box.home, '.central-knot', 'history.json');
        const parsed = JSON.parse(await readFile(path, 'utf8').catch(() => '{"events":[]}')) as { events: HistoryEvent[] };
        for (const event of parsed.events) event.at = new Date(Date.parse(event.at) - by * DAY_MS).toISOString();
        await writeFile(path, JSON.stringify(parsed));
        days = pick([7, 30, 90] as const);
        await pruneHistory(context());
      } });
      const out = pick(allTools as Tool[]);
      if (tools.includes(out) && tools.length > 1) add(1, { name: `${out} uninstalled`, run: async () => manage(tools.filter(tool => tool !== out)) });
      else if (!tools.includes(out)) add(2, { name: `${out} managed again`, run: async () => { manage([...tools, out]); await chooseTools(context(), tools); } });
      if (tools.includes(out) && tools.length > 1) add(1, { name: `${out} left out by the tool choice`, run: async () => { manage(tools.filter(tool => tool !== out)); await chooseTools(context(), tools); } });
      // A copy made unseeable, from a settled home with the agent on in that harness: the pass must turn nothing Off and remove nothing.
      const hidden = pick(tools as Tool[]);
      if (settled && place === 'on' && held && !held.except.includes(hidden) && fact?.copies[hidden]) {
        const folder = join(box.home, files[hidden], '..'), text = (await filesOf(box))[hidden]!;
        const unseen = (name: string, hide: () => Promise<unknown>, show: () => Promise<unknown>) => add(1, { name: `unseeable: ${name} in ${hidden}`, app: true, byHand: true, run: async () => {
          await hide();
          try {
            const done = await pass(box, context()), now = (await seen(box, context())).item;
            if (!now?.on) fail(`an unseeable copy (${name}) turned the agent Off`);
            if (done.results.some(entry => entry.outcome === 'removed')) fail(`an unseeable copy (${name}) had a copy removed`);
          } finally { await show(); }
        } });
        if (process.getuid?.() !== 0) unseen('an unreadable file', () => chmod(fileOf(box, hidden), 0o000), () => chmod(fileOf(box, hidden), 0o644));
        unseen('a half-written save', () => write(box, hidden, hidden === 'codex-cli' ? 'name = "reviewer"\n' : '---\nname: rev'), () => write(box, hidden, text));
        // With no settle window a folder away is written afresh at once; the folder that comes back takes its place.
        unseen('its folder away', () => rename(folder, `${folder}-away`), async () => { await rm(folder, { recursive: true, force: true }); await rename(`${folder}-away`, folder); });
        unseen('its folder made again', async () => { await rm(folder, { recursive: true }); await mkdir(folder); }, async () => undefined);
        // With a settle window of 2 s: a copy deleted by hand changes nothing inside it.
        const waiting = (now: number) => applyAgents({ ...context(), settleMs: 2000 }, tools, [], { now });
        add(1, { name: `deleted by hand in ${hidden}, passes inside the settle window`, app: true, byHand: true, run: async () => {
          await rm(fileOf(box, hidden));
          clock += 1e6;
          for (const now of [clock, clock + 1000]) {
            const done = await waiting(now);
            if (done.writes || !(await seen(box, context())).item?.on) fail(`(settle) a copy deleted inside the settle window ${done.writes ? 'had files written or removed' : 'turned the agent Off'}`);
          }
        } });
        // Its folder away across three passes: nothing inside the window, then written afresh; the folder that comes back takes its place.
        add(1, { name: `${hidden}'s folder away across passes`, app: true, byHand: true, run: async () => {
          await rename(folder, `${folder}-away`);
          try {
            clock += 1e6;
            for (const now of [clock, clock + 1000]) if ((await waiting(now)).writes) fail('(settle) a folder away inside the settle window had files written');
            await waiting(clock + 3000);
            if (!(await filesOf(box))[hidden]) fail('(settle) a folder away past the settle window was not written afresh');
            if (!(await seen(box, context())).item?.on) fail('(settle) a folder away turned the agent Off');
          } finally { await rm(folder, { recursive: true, force: true }); await rename(`${folder}-away`, folder); }
        } });
      }

      const act = pick(acts);
      const blocked = act.app && !act.byHand && process.getuid?.() !== 0 && next() < 0.12 ? pick(tools as Tool[]) : undefined;
      const crash = act.app && !act.byHand && !blocked && next() < 0.1 ? pick(['before-remove', 'before-rename'] as const) : undefined;
      trace.push(`${act.name}${blocked ? ` [${blocked} read-only]` : ''}${crash ? ` [crash ${crash}]` : ''}`);
      const before = await filesOf(box), managedBefore = [...tools], entriesBefore = await historyCount(), settledBefore = settled;
      // What the pass of an acting step reads first: each managed harness's own part as it is now.
      if (act.app) for (const tool of managedBefore as Tool[]) { const own = ownOf(tool, before[tool]); if (own !== undefined && !blocked) lastOwn[tool] = own; }
      let done: unknown, crashed = false;
      if (blocked) await readOnly(blocked, true);
      try { done = await act.run(crash ? { fault: at => { if (at === crash) throw new Error('crash'); } } : {}); }
      catch (error) { if ((error as Error).message === 'crash') crashed = true; else { fail(`threw: ${(error as Error).message.slice(0, 140)}`); break; } }
      finally { if (blocked) await readOnly(blocked, false); }
      if (act.name.startsWith('hand') && syncOn && next() < 0.7) {
        trace.push('background pass');
        await pass(box, context());
        // That pass saw each managed harness's file: its own part is what Central Knot keeps now.
        const seenNow = await filesOf(box);
        for (const tool of tools as Tool[]) { const own = ownOf(tool, seenNow[tool]); if (own !== undefined) lastOwn[tool] = own; }
      }
      last = act.click && !crashed ? done as McpResult : act.app ? undefined : last;
      const after = await filesOf(box), versions = await versionsNow();
      if (process.env.CK_TRACE) {
        const now = (await seen(box, context())).item;
        console.log(`--- ${trace.at(-1)}${crashed ? ' (crashed)' : ''}\n    ${JSON.stringify({ place: placeOf(now), except: now?.except, applied: Object.keys(now?.applied ?? {}), files: Object.fromEntries(Object.entries(after).map(([tool, text]) => [tool.split('-')[0], text?.match(/(Be \w+\.|Hand \d+\.)/)?.[0]])), versions: now?.versions.length })}`);
      }
      // (a) and (e): what this step wrote over or removed.
      const here = new Set(Object.values(contentsOf(after)));
      if (act.app) for (const tool of allTools as Tool[]) {
        if (after[tool] === before[tool]) continue;
        if (!managedBefore.includes(tool) && !/managed again/.test(act.name)) fail(`(e) ${act.name} changed ${tool}, which Central Knot doesn’t manage`);
        const was = contentOf(tool, before[tool]);
        if (was) taken.add(was);
      }
      for (const content of taken) if (!versions.has(content) && !here.has(content)) { taken.delete(content); fail('(a) a content Central Knot wrote over or removed is neither a version nor in any harness'); }
      // (f) Every click has its History entry, a crashed one too; (g) a file Central Knot wrote keeps its harness's own part.
      const answer = act.click && !crashed ? done as McpResult : undefined;
      const refused = !!answer && (!!answer.stopped || answer.results.some(entry => entry.unchanged || entry.differs));
      if (act.click && !refused && await historyCount() === entriesBefore) fail(`(f) ${act.name} made no History entry`);
      if (act.app) for (const tool of allTools as Tool[]) {
        const now = after[tool], was = before[tool];
        if (now === undefined || now === was || !contentOf(tool, now)) continue;
        const expected = was !== undefined && contentOf(tool, was) ? ownOf(tool, was) : lastOwn[tool];
        if (expected !== undefined && ownOf(tool, now) !== expected) fail(`(g) ${act.name} wrote ${tool}’s file without its own part as last seen`);
      }
      if (act.app) for (const tool of managedBefore.filter(tool => tools.includes(tool)) as Tool[]) { const own = ownOf(tool, after[tool]); if (own !== undefined) lastOwn[tool] = own; }
      // (f) From a settled home, a click's Undo puts every file back as it was, where every copy in a managed harness was one
      // the agent had: a copy it never had, which the click adopts or writes over (kept as a version), is not put back by an
      // Undo that is a switch.
      const onlyItsOwn = (managedBefore as Tool[]).every(tool => before[tool] === undefined || contentOf(tool, before[tool]) === held?.applied[tool]);
      if (act.click && settledBefore && !crashed && !blocked && onlyItsOwn && last?.made?.length) {
        const click = last;
        await trial(box, async () => {
          await undo(box, click, context());
          if (!same(await filesOf(box), before)) fail(`(f) the Undo of ${act.name} left a harness’s file other than it was`);
        });
      }
      settled = await settles();
      // (c) Every action offered now does something.
      const offered: { name: string; run: () => Promise<McpResult | McpResult[]> }[] = (await historyActions(box, context())).map(action => ({ name: `History’s ${action.label} on ${action.event.kind}`, run: action.run }));
      const now = await seen(box, context()), live = now.item && !now.item.deleted ? now.item : undefined;
      const page = (name: string, change: Change) => offered.push({ name: `the page’s ${name}`, run: () => send(change) });
      if (live) page(live.on ? 'Off' : 'On', live.on ? agentClicks.off(now.row, live) : agentClicks.on(now.row, live));
      if (live) page('Delete', agentClicks.remove(now.row, live));
      if (live?.on) for (const tool of tools) page(`switch in ${tool}`, agentClicks.inHarness(now.row, live, tool, !live.except.includes(tool)));
      for (const [index, version] of (live?.versions ?? []).entries()) if (version.hash !== live!.hash) page(`Make current #${index}`, agentClicks.makeCurrent(now.row, live, version.hash));
      for (const action of offered) await trial(box, async () => {
        const record = await recordText(), answers = [await action.run()].flat();
        const refusal = answers.map(answer => answer.stopped ?? answer.results.find(entry => entry.unchanged)?.message).find(Boolean);
        if (refusal && STALE.test(refusal)) fail(`(c) ${action.name}: “${refusal.slice(0, 100)}”`);
        else if (!refusal && same(after, await filesOf(box)) && record === await recordText()) fail(`(c) ${action.name} does nothing`);
      });
      // (d) Off then On, from a settled home: every file byte for byte.
      if (settled && live?.on) await trial(box, async () => {
        await send(agentClicks.off(now.row, live));
        const off = await seen(box, context());
        await send(agentClicks.on(off.row, off.item));
        if (!same(after, await filesOf(box))) fail('(d) Off then On left a harness’s file other than it was');
      });
    }
  } finally { for (const tool of allTools as Tool[]) await readOnly(tool, false); await box.cleanup(); }
  return found;
}

const extra = Number(process.env.CK_WALKS ?? 0), from = Number(process.env.CK_SEED ?? 5000);
const only = process.env.CK_ONLY?.split(',');
const walks: [number, boolean][] = only ? [[Number(only[0]), only[1] === 'own']]
  : [...SEEDS, ...Array.from({ length: extra }, (_, index) => [[from + index, false], [from + index, true]] as [number, boolean][]).flat()];
test(`A random walk of ${STEPS} steps, ${walks.length} times: nothing Central Knot removes or writes over is lost, passes settle, every action offered does something, Off then On is byte for byte, and an unseeable copy turns nothing Off`, async () => {
  const findings = new Map<string, { count: number; trace: string }>();
  // A few walks at a time, each in a temp home of its own.
  const waiting = [...walks];
  await Promise.all(Array.from({ length: only ? 1 : 6 }, async () => {
    for (let next = waiting.shift(); next; next = waiting.shift()) {
      for (const { kind, trace } of await walk(...next)) { const had = findings.get(kind); if (had) had.count++; else findings.set(kind, { count: 1, trace }); }
    }
  }));
  assert.deepEqual([...findings].map(([kind, { count, trace }]) => `${count}× ${kind}\n    ${trace}`), []);
});

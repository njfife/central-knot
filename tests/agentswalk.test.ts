// A seeded random walk over every click the Agents page and History offer for one agent (agentclicks.ts), on real files in a temp
// home, with History's days passing, its retention changed, folders read-only for a click and copies made or edited by hand in
// between. Two-way agents and one-way ones (Claude Code's own fields). After every step, in a copy of the home put back after:
//   (a) two plain passes: the second writes nothing;
//   (b) every action History offers does something: none answers that it no longer applies, can't be restored or has nothing to do;
//   (c) on a row an Off holds copies of, On puts each tool's kept copy back byte for byte;
//   (d) every file a click took out or replaced is on disk again or reachable by an action History or the row offers, unless
//       History's days for it have passed;
//   (e) the row says what is true: each tool an Off holds is off there, has no copy on record, and is held by a standing Off whose
//       kept file is in the store; an Off row has no copy anywhere;
//   (f) a click that went through whole, from a settled home (a plain pass would write nothing and hold nothing), is undone
//       exactly by its Undo: the files and the row as before it. (From an unsettled one, the click's pass also does sync's
//       waiting work, which its Undo leaves, as the band promises: it reverses the click, not what sync did alongside.)
// The walks that once found a bug run in `npm test`; CK_WALKS=<n> runs n more seeds of each kind, CK_SEED=<n> starts there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readAgentRecord, restoreAgent } from '../src/agents.ts';
import { endedBy, offTools } from '../src/historyrules.ts';
import { readHistory } from '../src/manage.ts';
import { offHeldIn, putBackOrder } from '../src/itemrow.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId, HistoryDays, HistoryEvent, SkillFacts } from '../src/types.ts';
import { age, choose, claudeAgent, codexOwn, deleteEverywhere, factOf, fields, files, filesOf, historyActions, pass, prune, sandbox, synced, toolOff, toolOn, tools, trial, turnOff, turnOn, undo, write, type Box, type Clicked, type Tool } from './agentclicks.ts';

/** Walks that found a bug once, each with its agent (true: one-way), 1001 among them; CK_WALKS adds random ones of both kinds. */
const FOUND: [number, boolean][] = [[1001, false], [2, false], [5071, false], [6081, false], [18, true], [5000, true], [5021, true], [5055, true], [5059, true]];
const STEPS = 14;
const random = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
/** An answer that means History offered an action that is stale or does nothing. */
const STALE = /can’t be restored|can’t be undone|put back already|already undone|Nothing could be|no longer applies|isn’t this entry’s|nothing to (undo|turn off)/;

/** The row as a person reads it: Off row or not, synced or not, where it is off, which tools have a copy, which an Off holds. */
const row = (fact: SkillFacts | undefined) => fact && { off: !!fact.gone, managed: fact.managed, leftOut: [...fact.off].sort(), copies: Object.keys(fact.copies).sort(), held: (fact.heldOff ?? []).map(entry => entry.tool).sort() };
const storeText = (box: Box, hash: string, tool: string) => readFile(join(box.home, '.central-knot', 'items', 'agents', 'reviewer', hash, `${tool}.txt`), 'utf8').catch(() => undefined);
const named = (event: HistoryEvent) => [...event.losers.map(loser => loser.hash), ...(event.turnedUp ?? []).map(loser => loser.hash), event.previous, event.winner?.hash].filter((hash): hash is string => !!hash);
/** The row as the page holds it (matrix.ts), for itemrow.ts's rules. */
const asRow = (fact: SkillFacts) => ({ key: fact.key, description: '', copies: Object.fromEntries(Object.entries(fact.copies).map(([tool, copy]) => [tool, copy!.hash])), managed: fact.managed, off: fact.off, gone: fact.gone, heldOff: fact.heldOff });
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);

interface Finding { kind: string; trace: string }
async function walk(seed: number, oneWay: boolean): Promise<Finding[]> {
  const next = random(seed), pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const box = await sandbox();
  let days: HistoryDays = 30, marker = 0, last: Clicked | undefined, settled = true;
  const context = (): ShareContext => ({ ...box.context, historyDays: days });
  const trace = [`seed ${seed}${oneWay ? ' one-way' : ''}`];
  const found: Finding[] = [];
  const fail = (kind: string) => found.push({ kind, trace: trace.join(' → ') });
  /** Files a click took out or replaced, whose content no tool holds any more: each must stay reachable (d). */
  const owed = new Map<string, { tool: Tool; text: string; hash: string }>();
  const readOnly = (tool: Tool, on: boolean) => chmod(join(box.home, files[tool], '..'), on ? 0o555 : 0o755).catch(() => undefined);
  try {
    await synced(box, claudeAgent(undefined, oneWay ? fields : ''));
    for (let step = 0; step < STEPS && !found.length; step++) {
      const fact = await factOf(box, context());
      const present = fact && !fact.gone ? tools.filter(tool => fact.copies[tool] !== undefined) : [];
      /** `undoes`: the History entries this step undoes, whose own copies it takes out again without owing them (d). */
      type Act = { name: string; click?: () => Promise<Clicked | undefined>; run?: () => Promise<unknown>; undoes?: string[] };
      const acts: Act[] = [];
      const add = (weight: number, act: Act) => { for (let count = 0; count < weight; count++) acts.push(act); };
      if (present.length) add(4, { name: 'Off', click: () => turnOff(box, context()) });
      for (const tool of present) add(1, { name: `Off in ${tool}`, click: () => toolOff(box, tool, context()) });
      if (fact) add(fact.gone || fact.heldOff?.length || !fact.managed ? 4 : 1, { name: 'On', click: () => turnOn(box, context()) });
      for (const entry of fact?.heldOff ?? []) if (!(entry.source && fact!.copies[entry.source] === undefined)) add(1, { name: `On in ${entry.tool}`, click: () => toolOn(box, entry.tool, context()) });
      if (fact) add(1, { name: 'Delete everywhere', click: () => deleteEverywhere(box, context()) });
      for (const tool of present) add(1, { name: `choose ${tool}`, click: () => choose(box, tool, context()) });
      for (const action of await historyActions(box, context())) add(2, { name: `History: ${action.label} (${action.event.kind}${action.event.putBackFrom ? `/${action.event.putBackFrom}` : ''})`, run: action.run, undoes: [action.event.id] });
      if (last?.made.length) { const click = last; add(2, { name: 'Undo', run: () => undo(box, click, context()), undoes: click.made }); }
      for (const tool of tools as Tool[]) {
        if (present.includes(tool)) add(1, { name: `hand edit in ${tool}`, run: async () => { const text = (await filesOf(box))[tool]!; await write(box, tool, text.replace(/(Be brief\.|Hand \d+\.|Codex’s own\.)/, `Hand ${++marker}.`)); } });
        else add(1, { name: `hand-made copy in ${tool}`, run: () => write(box, tool, tool === 'codex-cli' ? codexOwn(`Hand ${++marker}.`) : claudeAgent(`Hand ${++marker}.\n`)) });
      }
      add(2, { name: 'pass', run: () => pass(box, context()) });
      add(1, { name: 'age', run: async () => { const by = pick([8, 31, 91]); await age(box, by); if (next() < 0.5) days = pick([7, 30, 90] as const); await prune(context()); trace[trace.length - 1] += ` ${by} days, keep ${days}`; } });
      const act = pick(acts);
      const blocked = act.click && process.getuid?.() !== 0 && next() < 0.12 ? pick(tools as Tool[]) : undefined;
      trace.push(`${act.name}${blocked ? ` [${blocked} read-only]` : ''}`);
      const filesBefore = await filesOf(box), rowBefore = row(fact), settledBefore = settled;
      if (blocked) await readOnly(blocked, true);
      let clicked: Clicked | undefined;
      try { if (act.click) clicked = await act.click(); else await act.run!(); }
      catch (error) { fail(`threw: ${(error as Error).message.slice(0, 120)}`); break; }
      finally { if (blocked) await readOnly(blocked, false); }
      if (act.name.startsWith('hand') && next() < 0.7) { trace.push('pass'); await pass(box, context()); }
      last = clicked ?? (act.name.startsWith('hand') || act.name === 'pass' || act.name === 'age' ? last : undefined);
      const filesAfter = await filesOf(box), factAfter = await factOf(box, context()), history = await readHistory(context());
      if (process.env.CK_TRACE) console.log(`\n--- ${trace.at(-1)}\n${JSON.stringify({ result: clicked && { stopped: clicked.stopped, results: clicked.results.map(entry => `${entry.harness}:${entry.outcome}:${entry.message.slice(0, 50)}`) }, row: row(factAfter), files: Object.fromEntries(Object.entries(filesAfter).map(([tool, text]) => [tool, text?.replace(/\s+/g, ' ').slice(-24)])) })}\n${history.filter(event => event.key === 'agent:reviewer').map(event => `${event.id.slice(0, 4)} ${event.kind}${event.turnedOff ? '/off' : ''}${event.everywhere ? '/everywhere' : ''}${event.putBackFrom ? `/${event.putBackFrom}` : ''}${event.undoneBy ? `(undone by ${event.undoneBy.slice(0, 4)})` : ''} [${event.losers.map(loser => loser.tool.split('-')[0])}]${event.turnedUp ? ` up:${event.turnedUp.map(loser => loser.tool.split('-')[0])}` : ''}`).join('\n')}`);
      const byClick = !act.name.startsWith('hand') && act.name !== 'pass' && act.name !== 'age';
      // (d) What a click took out or replaced, with no tool holding that content now, is owed until it is back or reachable. An
      // Undo taking out what the entry it undoes wrote (a choice's chosen copy, the copies turning it on added, copies put back)
      // owes nothing: those were Central Knot's copies of content the entry still names.
      const contentNow = new Set(Object.values(factAfter?.copies ?? {}).map(copy => copy!.hash));
      const undone = history.filter(event => act.undoes?.includes(event.id));
      for (const event of undone) for (const hash of [event.winner?.hash, event.kind === 'added' ? event.previous : undefined, ...(event.putBackFrom ? event.losers.map(loser => loser.hash) : [])]) if (hash) contentNow.add(hash);
      for (const tool of tools as Tool[]) {
        const was = filesBefore[tool];
        if (byClick && was !== undefined && filesAfter[tool] !== was && !contentNow.has(fact?.copies[tool]?.hash ?? '')) owed.set(`${tool}\0${was}`, { tool, text: was, hash: fact?.copies[tool]?.hash ?? '' });
      }
      const offeredNow = await historyActions(box, context());
      // Reachable: named by an entry History offers an action on, or by one that waits only for an Off to be turned on again or a
      // deletion to be restored (each offered in its turn).
      const waiting = history.filter(event => event.key === 'agent:reviewer' && ['removed', 'deleted'].includes(endedBy(event, history)?.kind ?? ''));
      for (const [key, { tool, text, hash: content }] of owed) {
        if (filesAfter[tool] === text) { owed.delete(key); continue; }
        let reachable = false;
        for (const event of [...offeredNow.map(action => action.event), ...waiting]) for (const hash of named(event)) if (await storeText(box, hash, tool) === text) reachable = true;
        if (reachable) continue;
        owed.delete(key);
        // History's days passing is how a deleted or replaced copy goes. The person's own later decision supersedes one too: a later
        // choice of copies an earlier one's Undo, and a copy they made by hand in a tool while it was off (then turned off again
        // and on, the newer copy coming back) the copy Off kept there before.
        const at = (event: HistoryEvent) => history.indexOf(event);
        const superseded = history.some(event => named(event).includes(content) && (event.kind === 'chosen' ? endedBy(event, history)?.kind === 'chosen'
          : history.some(later => at(later) > at(event) && later.kind === 'removed' && later.turnedOff && later.losers.some(loser => loser.tool === tool && loser.hash !== content))));
        if (act.name !== 'age' && !superseded) fail(`(d) a copy a click took out of ${tool} is reachable by no action`);
      }
      // (e) The row says what is true.
      const record = (await readAgentRecord(box.home)).items.reviewer;
      for (const entry of factAfter?.heldOff ?? []) {
        const off = history.find(event => event.id === entry.history);
        if (!factAfter!.off.includes(entry.tool)) fail(`(e) ${entry.tool} is held by an Off but not shown off there`);
        if (record?.copies.some(copy => copy.tool === entry.tool && !copy.status)) fail(`(e) ${entry.tool} is held by an Off but has a copy on record`);
        if (!off || !offTools(off, history).includes(entry.tool)) fail(`(e) the row's Off for ${entry.tool} is not one that holds it`);
        else if (await storeText(box, off.losers.find(loser => loser.tool === entry.tool)!.hash, entry.tool) === undefined) fail(`(e) the kept copy for ${entry.tool} is not in the store`);
      }
      if (factAfter?.gone && Object.values(filesAfter).some(text => text !== undefined)) fail('(e) an Off row while a tool has a copy');
      // (a) Two plain passes: the second writes nothing.
      await trial(box, async () => {
        const first = await pass(box, context()), second = await pass(box, context());
        settled = !first.writes && !first.results.some(entry => entry.outcome === 'held');
        if (second.writes) fail(`(a) a second plain pass writes: ${second.results.map(entry => entry.message).join(' | ').slice(0, 100)}`);
      });
      // (b) Every action History offers does something.
      for (const action of offeredNow) await trial(box, async () => {
        const historyBefore = JSON.stringify(await readHistory(context()));
        const answer = await action.run();
        if (answer.stopped && STALE.test(answer.stopped)) fail(`(b) ${action.label} on ${action.event.kind}: “${answer.stopped}”`);
        else if (!answer.stopped && same(filesAfter, await filesOf(box)) && historyBefore === JSON.stringify(await readHistory(context()))) fail(`(b) ${action.label} on ${action.event.kind} does nothing`);
      });
      // (c) On puts each tool's kept copy back, byte for byte.
      const offIn = factAfter ? offHeldIn(asRow(factAfter)) : [];
      if (offIn.length) {
        const kept = new Map<string, string | undefined>();
        for (const entry of factAfter!.heldOff!) { const off = history.find(event => event.id === entry.history); const loser = off?.losers.find(gone => gone.tool === entry.tool); kept.set(entry.tool, loser && await storeText(box, loser.hash, entry.tool)); }
        // The entries the row's On puts back, in its order; then its pass may catch a copy up to an edit made while it was off.
        await trial(box, async () => {
          const said: string[] = [];
          for (const id of putBackOrder(asRow(factAfter!))) said.push(...(await restoreAgent(context(), tools, id)).results.map(entry => `${entry.harness}: ${entry.message}`));
          const back = await filesOf(box);
          for (const tool of offIn as Tool[]) if (back[tool] !== kept.get(tool)) fail(`(c) On put ${back[tool] === undefined ? 'nothing' : 'another file'} back in ${tool} (${said.join(' ')})`);
        });
      }
      // (f) A click that went through whole is undone exactly.
      const whole = settledBefore && clicked && clicked.made.length && !clicked.stopped && !clicked.choose && !clicked.results.some(entry => entry.outcome === 'failed' || (entry.outcome === 'held' && !entry.differs));
      if (whole) await trial(box, async () => {
        const answers = await undo(box, clicked!, context());
        const refused = answers.find(answer => answer.stopped);
        if (refused) { fail(`(f) Undo of ${act.name} refused: ${refused.stopped}`); return; }
        if (!same(filesBefore, await filesOf(box))) fail(`(f) Undo of ${act.name} leaves other files`);
        else if (!same(rowBefore, row(await factOf(box, context())))) fail(`(f) Undo of ${act.name} leaves the row ${JSON.stringify(row(await factOf(box, context())))}, not ${JSON.stringify(rowBefore)}`);
      });
    }
  } finally { for (const tool of tools as Tool[]) await readOnly(tool, false); await box.cleanup(); }
  return found;
}

const extra = Number(process.env.CK_WALKS ?? 0), from = Number(process.env.CK_SEED ?? 5000);
// CK_ONLY=<seed>[,one-way] replays that one walk (with CK_TRACE=1, step by step).
const only = process.env.CK_ONLY?.split(',');
const walks: [number, boolean][] = only ? [[Number(only[0]), only[1] === 'one-way']]
  : [...FOUND, ...Array.from({ length: extra }, (_, index) => [[from + index, false], [from + index, true]] as [number, boolean][]).flat()];
test(`A random walk of ${STEPS} clicks, ${walks.length} times (two-way and one-way agents): passes stay quiet, every action History offers does something, On puts back each kept copy, nothing a click took is lost, the row is true, and every whole click's Undo is exact`, async () => {
  const findings = new Map<string, { count: number; trace: string }>();
  for (const [seed, oneWay] of walks) for (const { kind, trace } of await walk(seed, oneWay)) { const had = findings.get(kind); if (had) had.count++; else findings.set(kind, { count: 1, trace }); }
  assert.deepEqual([...findings].map(([kind, { count, trace }]) => `${count}× ${kind}\n    ${trace}`), []);
});

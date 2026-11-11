// A seeded random walk over every click the Agents page and History offer for one agent (agentclicks.ts), on real files in a temp
// home, with History's days passing, its retention changed, folders read-only for a click, a History action or an Undo, and
// copies made or edited by hand in between. Two-way agents and one-way ones (Claude Code's own fields). After every step, in a
// copy of the home put back after:
//   (a) two plain passes: the first writes nothing into a tool an Off holds, and the second writes nothing at all;
//   (b) every action History offers does something: none answers that it no longer applies, can't be restored or has nothing
//       to do; and one click further (for one of them, picked by the seed): every action offered after it is as good, the
//       passes after it are quiet, and the row is still true;
//   (c) on a row an Off holds copies of, On gives each such tool a copy again, and its put-back alone gives each the very file
//       a click last took out of it (what the walk saw one click take, not what the entry noted);
//   (d) every file a click took out or replaced is on disk again or can be brought back by an action History offers now, or
//       offers once an Off is turned on or a deletion restored. (A copy that was only behind, which the click's pass caught
//       up as any pass would have, is sync's work, not the click's: History has that older version as an edit's.) Two things
//       excuse one that can't come back, by design: History's days passed for it (daysPassed), or the choice that replaced it
//       lost its Undo to a later decision (choiceEnded);
//   (e) the row says what is true: each tool an Off holds is off there, has no copy on record, and is held by a standing Off whose
//       kept file is in the store; an Off row has no copy anywhere;
//   (f) a click that went through whole, from a settled home (a plain pass would write nothing, hold nothing and leave the
//       record as it is), is undone exactly by its Undo: the files, the row and the record as before it. (From an unsettled
//       one, the click's pass also does sync's waiting work, which its Undo leaves, as the band promises: it reverses the
//       click, not what sync did alongside.)
// The walks in FOUND run in `npm test`. CK_WALKS=<n> runs n more seeds of each kind, starting at CK_SEED=<n>;
// CK_ONLY=<seed>[,one-way] replays one walk, with CK_TRACE=1 step by step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readAgentRecord, restoreAgent } from '../src/agents.ts';
import { endedBy, heldCopies, heldTools, offTools } from '../src/historyrules.ts';
import { readHistory } from '../src/manage.ts';
import { DAY_MS } from '../src/model.ts';
import { offHeldIn, putBackOrder } from '../src/itemrow.ts';
import type { ShareContext } from '../src/share.ts';
import type { HistoryDays, HistoryEvent, McpResult, SkillFacts } from '../src/types.ts';
import { age, choose, claudeAgent, codexOwn, deleteEverywhere, factOf, fields, files, filesOf, historyActions, pass, prune, sandbox, synced, toolOff, toolOn, tools, trial, turnOff, turnOn, undo, write, type Box, type Clicked, type Tool } from './agentclicks.ts';

/**
 * The walks `npm test` runs, each with its agent (true: one-way). Each fails with one of this step's rules turned off, or is a
 * seed a judge's or the builder's longer run once failed on; CK_WALKS adds random ones of both kinds.
 */
const FOUND: [number, boolean][] = [[1001, false], [5071, false], [6079, false], [6203, false], [9010, false], [18, true], [5021, true], [6085, true], [6240, true], [7067, true], [7080, true]];
const STEPS = 14;
const random = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
/** An answer that means History offered an action that is stale or does nothing. */
const STALE = /can’t be restored|can’t be undone|put back already|already undone|Nothing could be|no longer applies|isn’t this entry’s|nothing to (undo|turn off)|not synced any more/;

type Fact = SkillFacts | undefined;
/** The row as a person reads it: Off row or not, synced or not, where it is off, which tools have a copy, which an Off holds. */
const row = (fact: Fact) => fact && { off: !!fact.gone, managed: fact.managed, leftOut: [...fact.off].sort(), copies: Object.keys(fact.copies).sort(), held: (fact.heldOff ?? []).map(entry => entry.tool).sort() };
/** The row as the page holds it (matrix.ts), for itemrow.ts's rules. */
const asRow = (fact: SkillFacts) => ({ key: fact.key, description: '', copies: Object.fromEntries(Object.entries(fact.copies).map(([tool, copy]) => [tool, copy!.hash])), managed: fact.managed, off: fact.off, gone: fact.gone, heldOff: fact.heldOff });
const heldWithNoCopy = (fact: Fact) => (fact ? offHeldIn(asRow(fact)) as Tool[] : []);
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
const ours = (history: HistoryEvent[]) => history.filter(event => event.key === 'agent:reviewer');
/**
 * The agent's record as sync reads it: synced or not, the tools left out, each copy on record and its marks; for a synced agent
 * also its synced content and its source. (Of an agent that is not synced, the last synced content, the source and the note of
 * a deletion are read by no pass or click until it is synced again, which sets them anew.)
 */
async function recordAsSyncReadsIt(box: Box) {
  const item = (await readAgentRecord(box.home)).items.reviewer;
  const copies = (item?.copies ?? []).filter(copy => !copy.status).map(({ tool, hash, bytes, oneWay, stopped }) => ({ tool, hash, bytes, oneWay: !!oneWay, stopped: !!stopped })).sort((first, second) => first.tool.localeCompare(second.tool));
  return item && { state: item.state, off: [...item.off].sort(), copies, ...(item.state === 'shared' ? { hash: item.hash, origin: item.origin } : {}) };
}

// ----- (d): which kept files a click can still bring back -----

type KeptCopy = HistoryEvent['losers'][number];
/** A kept file as the store has it: the one an entry names (`kept`), else the latest kept of that content for the tool. */
const keptFile = (box: Box, copy: Pick<KeptCopy, 'tool' | 'hash' | 'kept'>) => readFile(join(box.home, '.central-knot', 'items', 'agents', 'reviewer', copy.hash, `${copy.kept ?? copy.tool}.txt`), 'utf8').catch(() => undefined);
/** What an entry's own action can bring back: the copies it replaced or took out (an Off's: every copy it holds), and the version it would write everywhere. */
const broughtBackBy = (event: HistoryEvent): KeptCopy[] => [...(event.kind === 'removed' ? heldCopies(event) : event.losers),
  ...[event.previous, event.winner?.hash].flatMap(hash => (hash ? tools.map(tool => ({ tool, hash })) : []))];
/**
 * Every kept file a click can bring back now or in its turn, as `tool\0text`, each with the entries that name it:
 * - the copies an offered action brings back (an On's Use the kept copy: the kept copy of that one tool);
 * - those of an entry whose action waits only for an Off to be turned on again or a deletion to be restored, and an On's kept
 *   copy for a tool an Off holds now (offered again once that Off is turned on).
 */
async function reachable(box: Box, history: HistoryEvent[], offeredNow: Awaited<ReturnType<typeof historyActions>>): Promise<Map<string, HistoryEvent[]>> {
  const sources: { event: HistoryEvent; copies: KeptCopy[] }[] = offeredNow.map(({ event, how }) => ({ event,
    copies: how && 'keptIn' in how ? (event.turnedUp ?? []).filter(copy => copy.tool === how.keptIn) : broughtBackBy(event) }));
  const held = heldTools(history, 'agent:reviewer');
  for (const event of ours(history)) {
    if (['removed', 'deleted'].includes(endedBy(event, history)?.kind ?? '')) sources.push({ event, copies: [...broughtBackBy(event), ...(event.turnedUp ?? [])] });
    else if (event.putBackFrom === 'off' && !event.undoneBy) sources.push({ event, copies: (event.turnedUp ?? []).filter(copy => held.includes(copy.tool)) });
  }
  const found = new Map<string, HistoryEvent[]>();
  for (const { event, copies } of sources) for (const copy of copies) {
    const text = await keptFile(box, copy);
    if (text !== undefined) found.set(`${copy.tool}\0${text}`, [...(found.get(`${copy.tool}\0${text}`) ?? []), event]);
  }
  return found;
}
/** A file a click took out or replaced that no tool holds now, and the entries that named it when it was last reachable. */
interface Owed { tool: Tool; text: string; namedBy: { id: string; at: string }[] }
/**
 * Excuse: History's days passed for it. The step aged History, or every entry that last named it has left History since and
 * was older than its window: such an entry is kept only beside a standing Off, and goes once that Off is turned on or deleted.
 */
const daysPassed = (owed: Owed, aged: boolean, history: HistoryEvent[], cutoff: number) =>
  aged || (owed.namedBy.length > 0 && owed.namedBy.every(namer => !history.some(event => event.id === namer.id) && Date.parse(namer.at) < cutoff));
/**
 * Excuse: the choice that replaced it lost its Undo to a later decision of the person's (Rule B): they chose a copy again, or
 * made a copy of their own in that tool while it was off, which turning it on kept. What a choice replaces is theirs to give up.
 */
const choiceEnded = (owed: Owed, history: HistoryEvent[]) => owed.namedBy.some(namer => {
  const choice = history.find(event => event.id === namer.id && event.kind === 'chosen' && !event.undoneBy);
  const ending = choice && endedBy(choice, history);
  return !!ending && (ending.kind === 'chosen' || ending.putBackFrom === 'off');
});

interface Finding { kind: string; trace: string }
async function walk(seed: number, oneWay: boolean): Promise<Finding[]> {
  const next = random(seed), pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const box = await sandbox();
  let days: HistoryDays = 30, marker = 0, last: Clicked | undefined, settled = true;
  /** The tools whose file a plain pass would rewrite now (a copy that is behind, an edit waiting to spread): sync's waiting work. */
  let syncWouldRewrite: Tool[] = [];
  const context = (): ShareContext => ({ ...box.context, historyDays: days });
  const trace = [`seed ${seed}${oneWay ? ' one-way' : ''}`];
  const found: Finding[] = [];
  const fail = (kind: string) => found.push({ kind, trace: trace.join(' → ') });
  const owed = new Map<string, Owed>();
  /**
   * The file a click last took out of each tool, as the walk saw it (c): known only when the step was one removal (Off, Delete
   * everywhere, one History action). An Undo or a choice on an Off row is several, with files put back and taken out in between.
   */
  const lastTaken: Partial<Record<Tool, string>> = {};
  const readOnly = (tool: Tool, on: boolean) => chmod(join(box.home, files[tool], '..'), on ? 0o555 : 0o755).catch(() => undefined);
  /** (e) on the home as it is. */
  const rowIsTrue = async (when = '') => {
    const fact = await factOf(box, context()), history = await readHistory(context()), record = (await readAgentRecord(box.home)).items.reviewer;
    for (const entry of fact?.heldOff ?? []) {
      const off = history.find(event => event.id === entry.history);
      if (!fact!.off.includes(entry.tool)) fail(`(e${when}) ${entry.tool} is held by an Off but not shown off there`);
      if (record?.copies.some(copy => copy.tool === entry.tool && !copy.status)) fail(`(e${when}) ${entry.tool} is held by an Off but has a copy on record`);
      if (!off || !offTools(off, history).includes(entry.tool)) fail(`(e${when}) the row's Off for ${entry.tool} is not one that holds it`);
      else if (await keptFile(box, heldCopies(off).find(copy => copy.tool === entry.tool)!) === undefined) fail(`(e${when}) the kept copy for ${entry.tool} is not in the store`);
    }
    if (fact?.gone && Object.values(await filesOf(box)).some(text => text !== undefined)) fail(`(e${when}) an Off row while a tool has a copy`);
  };
  /**
   * (a) on the home as it is: two plain passes. Returns whether the home was settled (the first wrote nothing, held nothing and
   * left the record as it was), and the tools whose file the first rewrote.
   */
  const passesAreQuiet = async (when = '') => {
    const held = heldWithNoCopy(await factOf(box, context())), record = await recordAsSyncReadsIt(box), before = await filesOf(box);
    const first = await pass(box, context()), after = await filesOf(box);
    for (const tool of held) if (after[tool] !== undefined) fail(`(a${when}) a plain pass wrote a copy into ${tool}, which an Off holds`);
    const second = await pass(box, context());
    if (second.writes) fail(`(a${when}) a second plain pass writes: ${second.results.map(entry => entry.message).join(' | ').slice(0, 100)}`);
    const quiet = !first.writes && !first.results.some(entry => entry.outcome === 'held') && same(record, await recordAsSyncReadsIt(box));
    return { settled: quiet, rewrites: (tools as Tool[]).filter(tool => before[tool] !== undefined && after[tool] !== before[tool]) };
  };
  const stale = (answer: McpResult) => !!answer.stopped && STALE.test(answer.stopped);
  try {
    await synced(box, claudeAgent(undefined, oneWay ? fields : ''));
    for (let step = 0; step < STEPS && !found.length; step++) {
      const fact = await factOf(box, context());
      const present = fact && !fact.gone ? tools.filter(tool => fact.copies[tool] !== undefined) : [];
      /** `byApp`: a click of the page's or History's (not the person's own hands, a pass or time). `undoes`: the History entries it undoes, whose own copies it takes out again without owing them (d). */
      type Act = { name: string; click?: () => Promise<Clicked | undefined>; run?: () => Promise<unknown>; byApp?: boolean; undoes?: string[] };
      const acts: Act[] = [];
      const add = (weight: number, act: Act) => { for (let count = 0; count < weight; count++) acts.push(act); };
      if (present.length) add(4, { name: 'Off', click: () => turnOff(box, context()) });
      for (const tool of present) add(1, { name: `Off in ${tool}`, click: () => toolOff(box, tool, context()) });
      if (fact) add(fact.gone || fact.heldOff?.length || !fact.managed ? 4 : 1, { name: 'On', click: () => turnOn(box, context()) });
      for (const entry of fact?.heldOff ?? []) if (!(entry.source && fact!.copies[entry.source] === undefined)) add(1, { name: `On in ${entry.tool}`, click: () => toolOn(box, entry.tool, context()) });
      if (fact) add(1, { name: 'Delete everywhere', click: () => deleteEverywhere(box, context()) });
      for (const tool of present) add(1, { name: `choose ${tool}`, click: () => choose(box, tool, context()) });
      for (const action of await historyActions(box, context())) add(2, { name: `History: ${action.label} (${action.event.kind}${action.event.putBackFrom ? `/${action.event.putBackFrom}` : ''})`, run: action.run, byApp: true, undoes: action.how && 'keptIn' in action.how ? [] : [action.event.id] });
      if (last?.made.length) { const click = last; add(2, { name: 'Undo', run: () => undo(box, click, context()), byApp: true, undoes: click.made }); }
      for (const tool of tools as Tool[]) {
        if (present.includes(tool)) add(1, { name: `hand edit in ${tool}`, run: async () => { const text = (await filesOf(box))[tool]!; await write(box, tool, text.replace(/(Be brief\.|Hand \d+\.|Codex’s own\.)/, `Hand ${++marker}.`)); } });
        else add(1, { name: `hand-made copy in ${tool}`, run: () => write(box, tool, tool === 'codex-cli' ? codexOwn(`Hand ${++marker}.`) : claudeAgent(`Hand ${++marker}.\n`)) });
      }
      add(2, { name: 'pass', run: () => pass(box, context()) });
      add(1, { name: 'age', run: async () => { const by = pick([8, 31, 91]); await age(box, by); if (next() < 0.5) days = pick([7, 30, 90] as const); await prune(context()); trace[trace.length - 1] += ` ${by} days, keep ${days}`; } });
      const act = pick(acts);
      const byApp = !!act.click || !!act.byApp;
      const oneRemoval = /^(Off|Delete everywhere|History:)/.test(act.name);
      const blocked = byApp && process.getuid?.() !== 0 && next() < 0.12 ? pick(tools as Tool[]) : undefined;
      trace.push(`${act.name}${blocked ? ` [${blocked} read-only]` : ''}`);
      const filesBefore = await filesOf(box), rowBefore = row(fact), recordBefore = await recordAsSyncReadsIt(box), settledBefore = settled, syncsWork = syncWouldRewrite;
      if (blocked) await readOnly(blocked, true);
      let clicked: Clicked | undefined;
      try { if (act.click) clicked = await act.click(); else await act.run!(); }
      catch (error) { fail(`threw: ${(error as Error).message.slice(0, 120)}`); break; }
      finally { if (blocked) await readOnly(blocked, false); }
      if (act.name.startsWith('hand') && next() < 0.7) { trace.push('pass'); await pass(box, context()); }
      last = clicked ?? (byApp ? undefined : last);
      const filesAfter = await filesOf(box), factAfter = await factOf(box, context()), history = await readHistory(context());
      if (process.env.CK_TRACE) console.log(`\n--- ${trace.at(-1)}\n${JSON.stringify({ result: clicked && { stopped: clicked.stopped, results: clicked.results.map(entry => `${entry.harness}:${entry.outcome}:${entry.message.slice(0, 50)}`) }, row: row(factAfter), files: Object.fromEntries(Object.entries(filesAfter).map(([tool, text]) => [tool, text?.replace(/\s+/g, ' ').slice(-24)])) })}\n${ours(history).map(event => `${event.id.slice(0, 4)} ${event.kind}${event.turnedOff ? '/off' : ''}${event.everywhere ? '/everywhere' : ''}${event.putBackFrom ? `/${event.putBackFrom}` : ''}${event.keptFrom ? '/kept-copy' : ''}${event.undoneBy ? `(undone by ${event.undoneBy.slice(0, 4)})` : ''} [${event.losers.map(loser => loser.tool.split('-')[0])}]${event.turnedUp ? ` up:${event.turnedUp.map(loser => loser.tool.split('-')[0])}` : ''}`).join('\n')}`);
      // (d) What a click took out or replaced, with no tool holding that content now, is owed until it is back or can be brought
      // back. An Undo taking out what the entry it undoes wrote (a choice's chosen copy, the copies turning it on added, copies
      // put back) owes nothing: those were Central Knot's copies of content the entry still names.
      const contentNow = new Set(Object.values(factAfter?.copies ?? {}).map(copy => copy!.hash));
      for (const event of history.filter(entry => act.undoes?.includes(entry.id))) for (const hash of [event.winner?.hash, event.kind === 'added' ? event.previous : undefined, ...(event.putBackFrom ? event.losers.map(loser => loser.hash) : [])]) if (hash) contentNow.add(hash);
      for (const tool of tools as Tool[]) {
        const was = filesBefore[tool];
        if (!byApp || was === undefined || filesAfter[tool] === was) continue;
        if (filesAfter[tool] === undefined) { if (oneRemoval) lastTaken[tool] = was; else delete lastTaken[tool]; }
        if (!contentNow.has(fact?.copies[tool]?.hash ?? '') && !(syncsWork.includes(tool) && filesAfter[tool] !== undefined)) owed.set(`${tool}\0${was}`, { tool, text: was, namedBy: [] });
      }
      const offeredNow = await historyActions(box, context());
      const canComeBack = await reachable(box, history, offeredNow);
      for (const [key, lost] of owed) {
        if (filesAfter[lost.tool] === lost.text) { owed.delete(key); continue; }
        const namers = canComeBack.get(key);
        if (namers) { lost.namedBy = namers.map(event => ({ id: event.id, at: event.at })); continue; }
        owed.delete(key);
        if (!daysPassed(lost, act.name === 'age', history, Date.now() - days * DAY_MS) && !choiceEnded(lost, history)) fail(`(d) a copy a click took out of ${lost.tool} can be brought back by no action`);
      }
      await rowIsTrue();
      await trial(box, async () => { ({ settled, rewrites: syncWouldRewrite } = await passesAreQuiet()); });
      // (b) Every action History offers does something; for one of them, the home one click further is as sound.
      const further = offeredNow.length ? pick(offeredNow) : undefined;
      for (const action of offeredNow) await trial(box, async () => {
        const historyBefore = JSON.stringify(await readHistory(context()));
        const answer = await action.run();
        if (stale(answer)) { fail(`(b) ${action.label} on ${action.event.kind}: “${answer.stopped}”`); return; }
        if (!answer.stopped && same(filesAfter, await filesOf(box)) && historyBefore === JSON.stringify(await readHistory(context()))) { fail(`(b) ${action.label} on ${action.event.kind} does nothing`); return; }
        if (action !== further || answer.stopped) return;
        const when = ` after History’s ${action.label}`;
        await rowIsTrue(when);
        for (const then of await historyActions(box, context())) await trial(box, async () => { const reply = await then.run(); if (stale(reply)) fail(`(b${when}) ${then.label} on ${then.event.kind}: “${reply.stopped}”`); }, 'further');
        await passesAreQuiet(when);
        await rowIsTrue(`${when} and two passes`);
      });
      // (c) On gives each tool an Off holds a copy again; its put-back alone, the very file a click last took out of it.
      const held = heldWithNoCopy(factAfter);
      if (held.length) {
        await trial(box, async () => {
          for (const id of putBackOrder(asRow(factAfter!))) await restoreAgent(context(), tools, id);
          const back = await filesOf(box);
          for (const tool of held) if (back[tool] !== undefined && lastTaken[tool] !== undefined && back[tool] !== lastTaken[tool]) fail(`(c) On put a file back in ${tool} that is not the one last taken out of it`);
        });
        await trial(box, async () => {
          const on = await turnOn(box, context()), back = await filesOf(box);
          for (const tool of held) if (back[tool] === undefined) fail(`(c) On left ${tool} without a copy (${String(on?.stopped ?? on?.results.map(entry => entry.message).join(' ')).slice(0, 100)})`);
        });
      }
      // (f) A click that went through whole is undone exactly.
      const whole = settledBefore && clicked && clicked.made.length && !clicked.stopped && !clicked.choose && !clicked.results.some(entry => entry.outcome === 'failed' || (entry.outcome === 'held' && !entry.differs));
      if (whole) await trial(box, async () => {
        const refusal = (await undo(box, clicked!, context())).find(answer => answer.stopped);
        if (refusal) { fail(`(f) Undo of ${act.name} refused: ${refusal.stopped}`); return; }
        if (!same(filesBefore, await filesOf(box))) fail(`(f) Undo of ${act.name} leaves other files`);
        else if (!same(rowBefore, row(await factOf(box, context())))) fail(`(f) Undo of ${act.name} leaves the row ${JSON.stringify(row(await factOf(box, context())))}, not ${JSON.stringify(rowBefore)}`);
        else if (!same(recordBefore, await recordAsSyncReadsIt(box))) fail(`(f) Undo of ${act.name} leaves the record ${JSON.stringify(await recordAsSyncReadsIt(box)).replace(/[0-9a-f]{60}\b/g, '')}, not ${JSON.stringify(recordBefore).replace(/[0-9a-f]{60}\b/g, '')}`);
      });
    }
  } finally { for (const tool of tools as Tool[]) await readOnly(tool, false); await box.cleanup(); }
  return found;
}

const extra = Number(process.env.CK_WALKS ?? 0), from = Number(process.env.CK_SEED ?? 5000);
const only = process.env.CK_ONLY?.split(',');
const walks: [number, boolean][] = only ? [[Number(only[0]), only[1] === 'one-way']]
  : [...FOUND, ...Array.from({ length: extra }, (_, index) => [[from + index, false], [from + index, true]] as [number, boolean][]).flat()];
test(`A random walk of ${STEPS} clicks, ${walks.length} times (two-way and one-way agents): passes stay quiet, every action History offers does something, On puts back each kept copy, nothing a click took is lost, the row is true, and every whole click's Undo is exact`, async () => {
  const findings = new Map<string, { count: number; trace: string }>();
  // A few walks at a time, each in a temp home of its own.
  const waiting = [...walks];
  await Promise.all(Array.from({ length: only ? 1 : 4 }, async () => {
    for (let next = waiting.shift(); next; next = waiting.shift()) for (const { kind, trace } of await walk(...next)) { const had = findings.get(kind); if (had) had.count++; else findings.set(kind, { count: 1, trace }); }
  }));
  assert.deepEqual([...findings].map(([kind, { count, trace }]) => `${count}× ${kind}\n    ${trace}`), []);
});

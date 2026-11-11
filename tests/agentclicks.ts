// The Agents page's and History's clicks on an agent, sent as the page sends them (matrix.ts turnOff, turnOn, putItBack,
// putBackHere, deleteAgent; app.ts applyClick and undoClick; historypage.ts through historyactions.ts offered), on real files in
// a temp home. Shared by the tests that replay sequences of clicks: agentswalk.test.ts and agentsoff-sequences.test.ts.
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentsView, applyAgents, readAgentRecord, restoreAgent } from '../src/agents.ts';
import { pruneHistory, readHistory } from '../src/manage.ts';
import { DAY_MS } from '../src/model.ts';
import { inverseChanges, keptBack, offPlan, recordChanged, undoOrder, type Standing } from '../src/clickplan.ts';
import { offered } from '../src/historyactions.ts';
import { needsCopyChoice, putBackOrder } from '../src/itemrow.ts';
import type { ShareContext } from '../src/share.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, SkillFacts } from '../src/types.ts';

export const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
export const files = { 'claude-cli': '.claude/agents/reviewer.md', 'copilot-cli': '.copilot/agents/reviewer.agent.md', 'codex-cli': '.codex/agents/reviewer.toml' } as const;
export type Tool = keyof typeof files;

export async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-agent-clicks-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/agents', '.copilot/agents', '.codex/agents']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
export type Box = Awaited<ReturnType<typeof sandbox>>;

export const claudeAgent = (prompt = 'You review code.\nBe brief.\n', extra = '') => `---\nname: reviewer\ndescription: Reviews code\n${extra}---\n\n${prompt}`;
/** Claude Code's own fields: the other tools receive such an agent one-way. */
export const fields = 'tools: Read, Grep\nmodel: opus\n';
export const codexOwn = (body = 'Codex’s own.') => `name = "reviewer"\ndescription = "Reviews code"\ndeveloper_instructions = """\n${body}\n"""\n`;
export const fileOf = (box: Box, tool: Tool) => join(box.home, files[tool]);
export const readOf = (box: Box, tool: Tool) => readFile(fileOf(box, tool), 'utf8').catch(() => undefined);
export const write = (box: Box, tool: Tool, text: string) => writeFile(fileOf(box, tool), text);
export const filesOf = async (box: Box) => Object.fromEntries(await Promise.all(tools.map(async tool => [tool, await readOf(box, tool as Tool)] as const))) as Record<Tool, string | undefined>;
export const recordOf = async (box: Box) => (await readAgentRecord(box.home)).items.reviewer;
export const historyOf = async (box: Box, context = box.context) => (await readHistory(context)).filter(event => event.key === 'agent:reviewer');
export const pass = (box: Box, context = box.context) => applyAgents(context, tools, [], { settleMs: 0 });
/** Moves every History entry `days` into the past, as if it all happened then. */
export async function age(box: Box, days: number) {
  const path = join(box.home, '.central-knot', 'history.json');
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { events: HistoryEvent[] };
  for (const event of parsed.events) event.at = new Date(Date.parse(event.at) - days * DAY_MS).toISOString();
  await writeFile(path, JSON.stringify(parsed, null, 2));
}
export const prune = (context: ShareContext) => pruneHistory(context);
/** Writes an agent in Claude Code and syncs it to every tool. */
export async function synced(box: Box, text = claudeAgent()) {
  await write(box, 'claude-cli', text);
  await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }], { settleMs: 0 });
}

/** The agent's row as the page reads it: an ordinary row, or its Off row when no tool has a copy. */
export async function factOf(box: Box, context = box.context): Promise<SkillFacts | undefined> {
  const view = await agentsView(context, tools);
  return view.servers.find(item => item.key === 'reviewer') ?? view.gone?.find(item => item.key === 'reviewer');
}
const holders = (fact: SkillFacts) => tools.filter(tool => fact.copies[tool] !== undefined && !fact.plugin?.[tool]);
const asItIs = (fact: SkillFacts) => ({ key: fact.key, managed: fact.managed, off: fact.off, seenManaged: fact.managed });
const onChange = (fact: SkillFacts, use?: HarnessId): Change => ({ key: fact.key, managed: true, off: [], seenManaged: fact.managed, ...(use ? { use, useHash: fact.copies[use]?.hash } : {}) });
/** Whether the page opens the copy choice for this row (itemrow.ts needsCopyChoice, on the row as the page draws it). */
const differs = (fact: SkillFacts) => needsCopyChoice({ key: fact.key, description: '', copies: Object.fromEntries(Object.entries(fact.copies).map(([tool, copy]) => [tool, copy!.hash])),
  managed: fact.managed, off: fact.off, cannot: fact.cannot, held: fact.held, separate: fact.separate, edited: fact.edited }, tools);

/** What a click did, for its Undo (app.ts undoClick): the History entries it made, and the record as it was when it was sent. */
export interface Clicked { made: string[]; results: DestinationResult[]; stopped?: string; before?: Map<string, Standing>; changed: string[]; choose?: true }
const standing = async (box: Box, context: ShareContext) => { const fact = await factOf(box, context); return new Map(fact && !fact.gone ? [[fact.key, { managed: fact.managed, off: fact.off }]] : []); };
async function send(box: Box, changes: Change[], context: ShareContext): Promise<Clicked> {
  const before = await standing(box, context);
  const result = await applyAgents(context, tools, changes, { settleMs: 0 });
  const refused = result.results.find(entry => entry.unchanged);
  return { made: result.made ?? [], results: result.results, stopped: result.stopped, before, changed: refused ? [] : recordChanged(before, await standing(box, context)) };
}
/** applyClick with `putBack`: each History entry first (only the first may stop it), then the changes made from the row as it is back. */
async function putBackThen(box: Box, ids: string[], tool: HarnessId | undefined, then: (back: SkillFacts | undefined) => Change[] | 'choose', context: ShareContext): Promise<Clicked> {
  const made: string[] = [], results: DestinationResult[] = [];
  for (const [index, id] of ids.entries()) {
    const back = await restoreAgent(context, tools, id, tool ? { tool } : undefined);
    if (back.stopped && !index) return { made, results, stopped: back.stopped, changed: [] };
    made.push(...(back.made ?? [])); results.push(...back.results);
  }
  const fact = await factOf(box, context);
  const changes = then(fact && !fact.gone ? fact : undefined);
  if (changes === 'choose') return { made, results, changed: [], choose: true };
  if (!changes.length) return { made, results, changed: [] };
  const result = await applyAgents(context, tools, changes, { settleMs: 0 });
  return { made: [...made, ...(result.made ?? [])], results: [...results, ...result.results], stopped: result.stopped, changed: [] };
}

/** The row's switch, Off (matrix.ts turnOff): every tool's copy removed, as Settings allows by default. */
export async function turnOff(box: Box, context = box.context) {
  const fact = await factOf(box, context);
  if (!fact || fact.gone) return undefined;
  const { remove } = offPlan(fact, tools, 'agents', true);
  return send(box, [{ ...asItIs(fact), remove: remove as HarnessId[], turnOff: true }], context);
}
/** One tool's own switch, Off; a one-way agent's source's switch is the whole agent's (matrix.ts harnessControls). */
export async function toolOff(box: Box, tool: HarnessId, context = box.context) {
  const fact = await factOf(box, context);
  if (!fact || fact.copies[tool] === undefined) return undefined;
  if (fact.managed && fact.oneWay?.from === tool && Object.keys(fact.limits ?? {}).length) return turnOff(box, context);
  return send(box, [{ ...asItIs(fact), remove: [tool], turnOff: true }], context);
}
/** Delete everywhere (matrix.ts deleteAgent). */
export async function deleteEverywhere(box: Box, context = box.context) {
  const fact = await factOf(box, context);
  if (!fact) return undefined;
  return send(box, [{ ...asItIs(fact), remove: holders(fact), everywhere: true }], context);
}
/** On for a row an Off holds copies of (matrix.ts putItBack); `use`: a copy choice made on that row. */
export async function putItBack(box: Box, use?: HarnessId, context = box.context) {
  const fact = await factOf(box, context);
  if (!fact) return undefined;
  const ids = putBackOrder({ key: fact.key, description: '', copies: {}, managed: fact.managed, off: fact.off, gone: fact.gone, heldOff: fact.heldOff });
  return putBackThen(box, ids, undefined, back => {
    if (!back) return [];
    if (use) return [onChange(back, use)];
    if (!back.managed && differs(back)) return 'choose';
    return back.managed && !back.off.length && !differs(back) ? [] : [onChange(back)];
  }, context);
}
/** The row's switch, On (matrix.ts flip): put back what an Off holds, or open the choice, or on everywhere. */
export async function turnOn(box: Box, context = box.context) {
  const fact = await factOf(box, context);
  if (!fact) return undefined;
  if (fact.gone || fact.heldOff?.length) return putItBack(box, undefined, context);
  if (differs(fact)) return { made: [], results: [], changed: [], choose: true } satisfies Clicked;
  return send(box, [onChange(fact)], context);
}
/** A copy choice: "Use Claude Code's copy" (matrix.ts turnOn with `use`). */
export async function choose(box: Box, use: HarnessId, context = box.context) {
  const fact = await factOf(box, context);
  if (!fact || fact.gone || fact.copies[use] === undefined) return undefined;
  if (fact.heldOff?.length) return putItBack(box, use, context);
  return send(box, [onChange(fact, use)], context);
}
/** One tool's own switch on a line an Off holds (matrix.ts putBackHere): that tool's copy alone. */
export async function toolOn(box: Box, tool: HarnessId, context = box.context) {
  const entry = (await factOf(box, context))?.heldOff?.find(held => held.tool === tool);
  if (!entry) return undefined;
  return putBackThen(box, [entry.history], tool, () => [], context);
}
/** The click's Undo (app.ts undoClick): each entry it made, in undoOrder; then the record, when the entries didn't put it back. */
export async function undo(box: Box, click: Clicked, context = box.context): Promise<McpResult[]> {
  const made = (await readHistory(context)).filter(event => click.made.includes(event.id));
  const out: McpResult[] = [];
  // A choice undone in its own tools also takes out the copies its own pass added (the 'added' entry it names).
  const takenWith = new Set<string>();
  for (const event of undoOrder(made)) {
    if (takenWith.has(event.id)) continue;
    const result = await restoreAgent(context, tools, event.id, event.kind === 'chosen' ? { narrow: true } : undefined);
    out.push(result);
    if (result.stopped) return out;
    if (event.kind === 'chosen' && event.addedId) takenWith.add(event.addedId);
  }
  if (out.some(result => result.results.some(keptBack))) return out;
  if (click.changed.length && click.before) {
    const inverse = inverseChanges(click.changed, click.before, await standing(box, context));
    if (inverse.length) out.push(await applyAgents(context, tools, inverse, { settleMs: 0 }));
  }
  return out;
}
/** What History offers for this agent's entries (historyactions.ts offered), with the click that runs each. */
export async function historyActions(box: Box, context = box.context) {
  const events = await readHistory(context);
  return events.filter(event => event.key === 'agent:reviewer').flatMap(event => {
    const { action } = offered(event, events, tools);
    return action ? [{ event, label: action.label, run: () => restoreAgent(context, tools, event.id, action.how) }] : [];
  });
}

/** Runs `body` on the home as it is, then puts the home back exactly (the record holds absolute paths, so it is moved, not copied elsewhere). */
export async function trial<T>(box: Box, body: () => Promise<T>): Promise<T> {
  const saved = `${box.base}-trial`;
  await rm(saved, { recursive: true, force: true });
  await cp(box.base, saved, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  try { return await body(); }
  finally { await rm(box.base, { recursive: true, force: true }); await rename(saved, box.base); }
}

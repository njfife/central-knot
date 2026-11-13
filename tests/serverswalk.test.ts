// A seeded random walk over one MCP server ("docs", with fields of each tool's own in each tool) on real settings files in a
// temp home, with a skill and an agent on the library in the same home: every click the MCP servers page and History offer
// (src/libraryrow.ts rowClicks, src/historyactions.ts), Write to Claude Code, edits by hand (the server's values, or only a
// tool's own fields), entries deleted and made by hand, a settings file deleted, rewritten without its servers or made
// unreadable, Automatic sync off and on, a crash at each step of a write or a removal, a tool left out and managed again,
// profile switches (src/profiles.ts: three profiles naming the server, the skill and the agent in different sets) and their Undo,
// and new copies turning up in tools (a server, a skill or an agent of a new name; sometimes the same name in two tools, with the
// same content or not). Synchronize everything is on in the odd seeds (library.ts FOUND). After every step:
//   (a) nothing is lost: each entry Central Knot wrote over or removed held a content that is a version of the server, or is
//       still in a tool. Checked for the step, and for every such content since the walk began;
//   (b) in a copy of the home put back after, a plain pass and Write to Claude Code, then two passes: the second writes nothing;
//       then an On server is current in every managed tool it is wanted in, and an Off or deleted one has nothing applied;
//   (c) every action the page and History offer does something: none is refused as stale, and each changes a file or the record;
//   (d) from a settled home, Off then On, with Write to Claude Code after each, puts each entry back with the same values and
//       own fields, and every other byte of each file as it was;
//   (e) a tool Central Knot doesn't manage is never written, and Claude Code's file only by Write to Claude Code;
//   (f) every click made a History entry, after a crash too (a profile switch: its one entry);
//   (h) the skill's folders and the agent's files are as they were in every tool: a server's clicks never touch them (a profile
//       switch, and its Undo, turn them On and Off too; a pass of the whole home may catch them up);
//   (i) Synchronize everything never brings back what was deleted: a deleted server (docs, or one that turned up and was taken
//       in, then undone or deleted) stays deleted through every step but its own Add and History's Restore; with the rule off,
//       nothing is ever taken in by it;
//   (j) with the rule on, after a pass of the whole home no found item is left that the rule would take in.
// A step that makes the settings file unseeable (unreadable, deleted) is made from a settled home, and asserts that the pass
// turns nothing Off and removes nothing.
// The walks in SEEDS run in `npm test`. CK_WALKS=<n> runs n more seeds from CK_SEED=<n>; CK_ONLY=<seed> replays one walk,
// with CK_TRACE=1 step by step; CK_TALLY=1 prints, per walk, how many new copies turned up and how many the rule took in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentsView, applyAgents } from '../src/agents.ts';
import { readHistory } from '../src/history.ts';
import { libraryAction, versionChoices } from '../src/historyactions.ts';
import { wantedIn, type LibraryItem } from '../src/library.ts';
import { asksWhichCopy, harnessIs, placeOf, rowClicks, type LibraryRow } from '../src/libraryrow.ts';
import { readTool, writeEntry } from '../src/mcp.ts';
import { changes, switchPlan, undoPlan } from '../src/profileplan.ts';
import { liveNow, readProfiles, saveProfile, switchProfile, undoSwitch } from '../src/profiles.ts';
import { applyServers, restoreServer, serversView, writeToClaude } from '../src/servers.ts';
import { setSyncEverything, type ShareContext } from '../src/share.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { Change, DestinationResult, HarnessId, LibraryFacts, PassResult } from '../src/types.ts';
import { bytes, folderOf, put, sandbox, trial, tools as allTools, type Tool } from './skillclicks.ts';

const SEEDS = [1, 2, 3, 4];
const STEPS = 16;
const random = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const STALE = /nothing left to undo|nothing to undo|Nothing to undo|no longer in Central Knot’s store|changed since the page was read|at that version already|No tool has a copy/;
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
const FILES = { 'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml' } as const;
/** The walk's three tools (skillclicks.ts tools). */
const three = allTools as (keyof typeof FILES)[];
const agentFiles = { 'claude-cli': '.claude/agents/writer.md', 'copilot-cli': '.copilot/agents/writer.agent.md', 'codex-cli': '.codex/agents/writer.toml' } as const;
/** docs as each tool first has it, with fields of its own. */
const first = {
  'claude-cli': `${JSON.stringify({ numStartups: 4, mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['docs'], timeout: 30 } }, projects: {} }, null, 2)}\n`,
  'copilot-cli': `${JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx', args: ['docs'], tools: ['search'] } } }, null, 2)}\n`,
  'codex-cli': 'model = "gpt-6"\n# keep me\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["docs"]\nstartup_timeout_sec = 9\n',
};

interface Finding { kind: string; trace: string }
async function walk(seed: number): Promise<Finding[]> {
  const next = random(seed), pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const box = await sandbox(), tools = box.tools;
  const manage = (managed: HarnessId[]) => { tools.splice(0, tools.length, ...three.filter(tool => managed.includes(tool))); };
  const file = (tool: Tool) => join(box.home, FILES[tool as keyof typeof FILES]);
  let syncOn = true, settled = true, last: PassResult | undefined, marker = 0;
  const context = (more: Partial<ShareContext> = {}): ShareContext => ({ ...box.context, ...more });
  const trace = [`seed ${seed}`], found: Finding[] = [];
  const fail = (kind: string) => { found.push({ kind, trace: trace.join(' → ') }); };
  const taken = new Set<string>();
  const send = (change: Change, more: Partial<ShareContext> = {}) => applyServers(context(more), tools, [change], syncOn ? {} : { only: new Set(['docs']) });
  /** The servers' part of main.ts's pass of the whole home (the background pass, or Sync once), where the rule runs. */
  const pass = (more: Partial<ShareContext> = {}) => applyServers(context(more), tools, [], { background: true });
  /** main.ts's pass of the whole home: every kind. */
  const wholePass = async (more: Partial<ShareContext> = {}) => { await applySkills(context(more), tools, [], { background: true }); await pass(more); await applyAgents(context(more), tools, [], { background: true }); };
  const rule = seed % 2 === 1;
  const write = (more: Partial<ShareContext> = {}) => writeToClaude(context(more), tools, ['docs']);
  const files = async () => Object.fromEntries(await Promise.all(three.map(async tool => [tool, await readFile(file(tool), 'utf8').catch(() => undefined)] as const)));
  /** Each tool's docs entry as read: its content, and its own fields. */
  const entries = async () => Object.fromEntries(await Promise.all(three.map(async tool => {
    const read = await readTool(context(), tool), entry = read.entries.find(each => each.name === 'docs');
    return [tool, entry && { hash: entry.hash, own: entry.extras }] as const;
  })));
  const seen = async (): Promise<{ fact?: LibraryFacts; item?: LibraryItem; row: LibraryRow }> => {
    const view = await serversView(context(), tools), fact = view.items.find(each => each.key === 'docs');
    const hashes = Object.fromEntries(Object.entries(fact?.copies ?? {}).map(([tool, copy]) => [tool, copy!.hash]));
    return { fact, item: view.library.docs, row: { key: 'docs', name: fact?.name, hashes, plan: fact?.plan, cannot: fact?.cannot, unseen: fact?.unseen, takeInAnswers: fact?.takeInAnswers, waits: fact?.waits } };
  };
  /** History's actions for every server (docs, and any that turned up in a tool), each against the item as it is now. */
  const historyActions = async () => {
    const { library } = await serversView(context(), tools);
    return (await readHistory(context())).filter(event => event.key.startsWith('mcp:')).flatMap(event => {
      const item = library[event.key.slice('mcp:'.length)];
      const main = libraryAction(event, item), run = (version?: string) => () => restoreServer(context(), tools, event.id, version);
      return [...(main ? [{ event, label: main.label, run: run() }] : []), ...versionChoices(event, item).map(choice => ({ event, label: `Use ${choice.tool}’s`, run: run(choice.hash) }))];
    });
  };
  const historyCount = async () => (await readHistory(context())).filter(event => event.key === 'mcp:docs').length;
  // Profiles: each switch the page offers (one that would change something), and each switch entry whose Undo History offers.
  const onNow = async () => JSON.stringify([await liveNow(context()), ...await Promise.all(['skills', 'mcp', 'agents'].map(name => readFile(join(box.home, `.central-knot/${name}.json`), 'utf8').catch(() => '')))]);
  const switches = async () => { const items = await liveNow(context()); return (await readProfiles(box.home)).profiles.filter(profile => changes(switchPlan(profile, items))); };
  const switchUndos = async () => { const items = await liveNow(context()); return (await readHistory(context())).filter(event => event.kind === 'profile' && !event.undoneBy && changes(undoPlan(event, items))); };
  const switchCount = async () => (await readHistory(context())).filter(event => event.kind === 'profile').length;
  const others = async () => ({ skill: await Promise.all(three.map(tool => bytes(folderOf(box, tool)))), agent: await Promise.all(three.map(tool => readFile(join(box.home, agentFiles[tool]), 'utf8').catch(() => undefined))) });
  let othersAsWritten: Awaited<ReturnType<typeof others>>;

  const record = () => readFile(join(box.home, '.central-knot/mcp.json'), 'utf8').catch(() => '');
  /** (b) on the home as it is, in a trial: a pass and the write, then two passes; whether the home was settled already. */
  const settles = async () => trial(box, async () => {
    const before = await files(), recorded = await record();
    const firstPass = await pass();
    const wrote = await write();
    const quiet = await pass(), second = await pass();
    if (second.writes) fail(`(b) a second plain pass writes: ${second.results.map(entry => entry.message).join(' | ').slice(0, 120)}`);
    const { row, item } = await seen();
    if (item) for (const tool of tools) {
      const is = harnessIs(row, item, tool), wanted = wantedIn(item, tool);
      if (wanted && !['current', 'cannot'].includes(is)) fail(`(b) after quiet passes an On server is “${is}” in ${tool}`);
      if ((!item.on || item.deleted) && item.applied[tool] !== undefined && is !== 'unseen') fail(`(b) after quiet passes an Off server still has an entry applied in ${tool}`);
    }
    return same(before, await files()) && recorded === await record() && !firstPass.writes && !wrote.writes && !quiet.writes;
  });

  try {
    for (const tool of three) { await mkdir(join(file(tool), '..'), { recursive: true }); await writeFile(file(tool), first[tool]); }
    await send(rowClicks.on((await seen()).row, undefined));
    await write();
    await put(box, 'claude-cli');
    await applySkills(context(), tools, [{ key: 'notes', managed: true, off: [] }]);
    for (const tool of three) await mkdir(join(box.home, agentFiles[tool], '..'), { recursive: true });
    await writeFile(join(box.home, agentFiles['claude-cli']), '---\nname: writer\ndescription: Writes docs\n---\n\nYou write docs.\n');
    await applyAgents(context(), tools, [{ key: 'writer', managed: true, off: [] }]);
    for (const [name, items] of [['Everything', ['mcp:docs', 'skill:notes', 'agent:writer']], ['No docs', ['skill:notes', 'agent:writer']], ['Docs alone', ['mcp:docs']]] as const) await saveProfile(context(), { name, items: [...items] });
    if (rule) await setSyncEverything(context(), true);
    trace.push(rule ? 'Synchronize everything on' : 'Synchronize everything off');
    othersAsWritten = await others();
    for (let step = 0; step < STEPS && !found.length; step++) {
      const { row, item, fact } = await seen();
      const place = placeOf(item), held = item && !item.deleted ? item : undefined;
      type Act = { name: string; run: (more?: Partial<ShareContext>) => Promise<unknown>; app?: boolean; click?: boolean; byHand?: boolean; claude?: boolean; profile?: boolean; whole?: boolean;
        /** The one deleted server this step may bring back: Add on its row, or History's Restore of it. */ brings?: string };
      const acts: Act[] = [];
      const add = (weight: number, act: Act) => { for (let count = 0; count < weight; count++) acts.push(act); };
      const clicks = (weight: number, name: string, change: Change) => add(weight, { name, app: true, click: true, run: more => send(change, more) });
      if (place === 'on') clicks(4, 'Off', rowClicks.off(row, item));
      if (place === 'off') clicks(4, 'On', rowClicks.on(row, item));
      // Add and its copy choices may lift docs's tombstone; nothing else may (i).
      const bring = (weight: number, name: string, change: Change) => add(weight, { name, app: true, click: true, brings: 'docs', run: more => send(change, more) });
      if (place === 'found' && Object.keys(fact?.copies ?? {}).length) {
        if (!asksWhichCopy(row)) bring(4, 'Add', rowClicks.on(row, item));
        else for (const tool of tools.filter(tool => fact?.copies[tool])) bring(2, `choose ${tool}`, rowClicks.on(row, item, tool));
      }
      if (held?.on) for (const tool of tools) clicks(1, `${held.except.includes(tool) ? 'let in' : 'keep out of'} ${tool}`, rowClicks.inHarness(row, item, tool, !held.except.includes(tool)));
      for (const version of held?.versions.filter(version => version.hash !== held.hash).slice(0, 3) ?? []) clicks(1, `make current ${version.from.how}`, rowClicks.makeCurrent(row, item, version.hash));
      if (held) clicks(1, 'Delete', rowClicks.remove(row, item));
      if (fact?.waits?.length) add(3, { name: 'Write to Claude Code', app: true, claude: true, run: more => write(more) });
      for (const action of await historyActions()) {
        const docs = action.event.key === 'mcp:docs';
        add(docs ? 2 : 1, { name: `History: ${action.label} (${action.event.kind}${docs ? '' : ` of ${action.event.item}`})`, app: true, brings: action.label === 'Restore' ? action.event.key.slice('mcp:'.length) : undefined, run: () => action.run() });
      }
      for (const profile of await switches()) add(2, { name: `switch to ${profile.name}`, app: true, click: true, profile: true, run: more => switchProfile(context(more), tools, profile.id) });
      for (const event of await switchUndos()) add(2, { name: `History: Undo switch to ${event.item}`, app: true, profile: true, run: more => undoSwitch(context(more), tools, event.id) });
      for (const tool of three) {
        const text = await readFile(file(tool), 'utf8').catch(() => undefined), has = (await entries())[tool];
        if (has) {
          add(2, { name: `hand edit in ${tool}`, run: async () => { await writeFile(file(tool), text!.replace(/("args":\s*\[|args = \[)/, `$1"edit-${++marker}", `)); } });
          add(1, { name: `own field changed by hand in ${tool}`, run: async () => { await writeFile(file(tool), tool === 'codex-cli' ? text!.replace(/startup_timeout_sec = \d+/, `startup_timeout_sec = ${++marker}`) : text!.replace(/"(timeout|tools)":/, `"note": ${++marker}, "$1":`)); } });
          add(1, { name: `hand delete in ${tool}`, run: async () => { await writeFile(file(tool), writeEntry(text!, tool, 'docs', undefined)); } });
        } else if (text !== undefined) add(1, { name: `hand-made entry in ${tool}`, run: async () => { await writeFile(file(tool), writeEntry(text, tool, 'docs', { transport: 'stdio', command: 'npx', args: [`hand-${++marker}`] })); } });
      }
      add(1, { name: 'Claude Code rewrites its file without servers', run: async () => { await writeFile(file('claude-cli'), `${JSON.stringify({ numStartups: ++marker })}\n`); } });
      add(2, { name: 'pass', app: true, run: more => pass(more) });
      add(2, { name: 'pass of the whole home', app: true, whole: true, run: more => wholePass(more) });
      // New copies turn up: a server, a skill or an agent of a new name, in one tool or (the same name) two, alike or not.
      const where = pick(three), also = pick(three.filter(tool => tool !== where)), twice = next() < 0.3, alike = next() < 0.5;
      const fresh = `fresh${++marker}`, body = (tool: Tool) => (alike || tool === where ? 'Same.' : `Other ${tool}.`);
      const inWhere = twice ? [where, also] : [where], said = `${fresh} in ${where}${twice ? ` and ${also}${alike ? ', alike' : ', differing'}` : ''}`;
      add(2, { name: `new server ${said}`, run: async () => {
        for (const tool of inWhere) {
          const text = await readFile(file(tool), 'utf8').catch(() => undefined);
          if (text !== undefined) await writeFile(file(tool), writeEntry(text, tool, fresh, { transport: 'stdio', command: 'npx', args: [body(tool)] }));
        }
      } });
      add(2, { name: `new skill ${said}`, run: async () => {
        for (const tool of inWhere) await put(box, tool, { 'SKILL.md': `---\nname: ${fresh}\ndescription: New.\n---\n\n${body(tool)}\n` }, [], fresh);
      } });
      add(2, { name: `new agent ${said}`, run: async () => {
        for (const tool of inWhere) await writeFile(join(box.home, agentFiles[tool].replace('writer', fresh)), tool === 'codex-cli'
          ? `name = "${fresh}"\ndescription = "New"\ndeveloper_instructions = """\n${body(tool)}\n"""\n` : `---\nname: ${fresh}\ndescription: New\n---\n\n${body(tool)}\n`);
      } });
      add(1, { name: `Automatic sync ${syncOn ? 'off' : 'on'}`, run: async () => { syncOn = !syncOn; } });
      const out = pick([...three]);
      if (tools.includes(out) && tools.length > 1) add(1, { name: `${out} left out by the tool choice`, run: async () => { manage(tools.filter(tool => tool !== out)); await chooseTools(context(), tools); } });
      else if (!tools.includes(out)) add(2, { name: `${out} managed again`, run: async () => { manage([...tools, out]); await chooseTools(context(), tools); } });
      // A settings file made unseeable, from a settled home with the server on there: the pass turns nothing Off and removes nothing.
      const hidden = pick(tools as Tool[]);
      if (settled && place === 'on' && held && !held.except.includes(hidden) && fact?.copies[hidden]) {
        const unseen = (name: string, hide: () => Promise<unknown>) => add(1, { name: `unseeable: ${name} in ${hidden}`, app: true, byHand: true, run: async () => {
          const text = await readFile(file(hidden), 'utf8');
          await hide();
          try {
            const done = await applyServers(context({ settleMs: 2000 }), tools, [], { now: Date.now() + 1e9 });
            if (!(await seen()).item?.on) fail(`an unseeable settings file (${name}) turned the server Off`);
            if (done.results.some(entry => entry.outcome === 'removed')) fail(`an unseeable settings file (${name}) had an entry removed`);
          } finally { await writeFile(file(hidden), text); }
        } });
        unseen('a file that isn’t its format', () => writeFile(file(hidden), hidden === 'codex-cli' ? '[mcp_servers.docs\n' : '{ "mcpServers": '));
        unseen('a deleted file, inside the settle window', () => rm(file(hidden)));
      }

      const act = pick(acts);
      const crash = act.app && !act.byHand && next() < 0.1 ? pick(['before-remove', 'before-rename', 'mid-replace'] as const) : undefined;
      trace.push(`${act.name}${crash ? ` [crash ${crash}]` : ''}`);
      const before = await files(), entriesBefore = await entries(), managedBefore = [...tools], countBefore = await historyCount(), switchesBefore = await switchCount();
      const deletedBefore = Object.values((await serversView(context(), tools)).library).filter(each => each.deleted).map(each => each.key);
      let done: unknown, crashed = false;
      try { done = await act.run(crash ? { fault: at => { if (at === crash) throw new Error('crash'); } } : {}); }
      catch (error) { if ((error as Error).message === 'crash') crashed = true; else { fail(`threw: ${(error as Error).message.slice(0, 140)}`); break; } }
      if (!act.app && syncOn && next() < 0.7) { trace.push('background pass'); await wholePass(); }
      last = act.click && !crashed ? done as PassResult : act.app ? undefined : last;
      const after = await files(), versions = new Set(((await seen()).item?.versions ?? []).map(version => version.hash));
      if (process.env.CK_TRACE) console.log(`--- ${trace.at(-1)}${crashed ? ' (crashed)' : ''}\n    ${JSON.stringify({ place: placeOf((await seen()).item), entries: Object.fromEntries(Object.entries(await entries()).map(([tool, entry]) => [tool, entry?.hash.slice(0, 6)])) })}`);
      // (a) and (e): what this step wrote over or removed, and where it may write.
      const here = new Set(Object.values(await entries()).flatMap(entry => (entry ? [entry.hash] : [])));
      if (act.app) for (const tool of three) {
        if (same(after[tool], before[tool])) continue;
        if (!managedBefore.includes(tool)) fail(`(e) ${act.name} wrote ${tool}, which Central Knot doesn’t manage`);
        if (tool === 'claude-cli' && !act.claude) fail(`(e) ${act.name} wrote Claude Code’s file, which only Write to Claude Code writes`);
        const was = entriesBefore[tool];
        if (was && was.hash !== (await entries())[tool]?.hash) taken.add(was.hash);
      }
      for (const content of taken) if (!versions.has(content) && !here.has(content)) { taken.delete(content); fail('(a) a content Central Knot wrote over or removed is neither a version nor in any tool'); }
      if (!same(await others(), othersAsWritten) && act.app && !act.profile && !act.whole) fail(`(h) ${act.name} touched the skill or the agent`);
      // (i) The rule never lifts a tombstone, and never acts while it is off.
      const libraryNow = (await serversView(context(), tools)).library;
      for (const key of deletedBefore) if (key !== act.brings && !libraryNow[key]?.deleted) fail(`(i) ${act.name} brought back the deleted server ${key === 'docs' ? key : 'that turned up'}`);
      if (!rule && (await readHistory(context())).some(event => event.cause === 'sync-everything')) fail(`(i) ${act.name}: Synchronize everything took something in while off`);
      // (j) After a pass of the whole home with the rule on, nothing is left found that it would take in.
      if (rule && act.whole && !crashed) {
        const views = [await skillsView(context(), tools), await serversView(context(), tools), await agentsView(context(), tools)];
        const left = views.flatMap(view => view.items.filter(each => each.takeInAnswers && 'take' in each.takeInAnswers.rule).map(each => each.key));
        if (left.length) fail(`(j) after a pass of the whole home the rule left ${left.join(', ')} to take in`);
      }
      othersAsWritten = await others();
      // (f) Every click has its History entry, a crashed one too.
      const answer = act.click && !crashed ? done as PassResult : undefined;
      const refused = !!answer && (!!answer.stopped || answer.results.some(entry => entry.unchanged || entry.differs));
      const told = act.profile ? await switchCount() > switchesBefore : await historyCount() > countBefore;
      if (act.click && !refused && !told) fail(`(f) ${act.name} made no History entry`);
      settled = await settles();
      // (c) Every action offered now does something.
      const now = await seen(), live = now.item && !now.item.deleted ? now.item : undefined;
      // `moves`: a profile's action, which does something when it turns an item On or Off, or changes a record (the same pass may
      // turn an item Off again, as a copy deleted by hand while a removal waited, which its record and History say).
      type Offered = { name: string; run: () => Promise<{ stopped?: string; results: DestinationResult[] }>; moves?: boolean };
      const offered: Offered[] = (await historyActions()).map(action => ({ name: `History’s ${action.label} on ${action.event.kind}`, run: action.run }));
      for (const profile of await switches()) offered.push({ name: `the Profiles page’s Switch to ${profile.name}`, moves: true, run: () => switchProfile(context(), tools, profile.id) });
      for (const event of await switchUndos()) offered.push({ name: `History’s Undo switch to ${event.item}`, moves: true, run: () => undoSwitch(context(), tools, event.id) });
      const page = (name: string, change: Change) => offered.push({ name: `the page’s ${name}`, run: () => send(change) });
      if (live) page(live.on ? 'Off' : 'On', live.on ? rowClicks.off(now.row, live) : rowClicks.on(now.row, live));
      if (live) page('Delete', rowClicks.remove(now.row, live));
      if (live?.on) for (const tool of tools) page(`switch in ${tool}`, rowClicks.inHarness(now.row, live, tool, !live.except.includes(tool)));
      for (const [index, version] of (live?.versions ?? []).entries()) if (version.hash !== live!.hash) page(`Make current #${index}`, rowClicks.makeCurrent(now.row, live, version.hash));
      if (now.fact?.waits?.length) offered.push({ name: 'the band’s Write to Claude Code', run: () => write() });
      for (const action of offered) await trial(box, async () => {
        const was = await record(), items = await onNow(), answer = await action.run();
        const refusal = answer.stopped ?? answer.results.find(entry => entry.unchanged)?.message;
        const nothing = action.moves ? items === await onNow() : same(after, await files()) && was === await record();
        if (refusal && STALE.test(refusal)) fail(`(c) ${action.name}: “${refusal.slice(0, 100)}”`);
        else if (!refusal && nothing) fail(`(c) ${action.name} does nothing`);
      });
      // (d) Off then On, from a settled home, each with Write to Claude Code: the same values and own fields, the rest byte for byte.
      if (settled && live?.on) await trial(box, async () => {
        const was = await entries(), rest = (texts: Record<string, string | undefined>) => three.map(tool => texts[tool] && writeEntry(texts[tool]!, tool, 'docs', undefined));
        await send(rowClicks.off(now.row, live)); await write();
        const off = await seen();
        await send(rowClicks.on(off.row, off.item)); await write();
        if (!same(was, await entries()) || !same(rest(after), rest(await files()))) {
          fail('(d) Off then On left an entry or a file other than it was');
          if (process.env.CK_TRACE) console.log(JSON.stringify({ was, now: await entries(), before: after, after: await files() }, null, 1));
        }
      });
    }
    if (process.env.CK_TALLY) { const all = await readHistory(context()); console.log(`TALLY seed ${seed} rule ${rule} taken ${all.filter(event => event.cause === 'sync-everything').length} new ${trace.filter(step => step.startsWith('new ')).length} undone ${all.filter(event => event.cause === 'sync-everything' && event.undoneBy).length}`); }
  } finally { for (const tool of three) await chmod(join(file(tool), '..'), 0o755).catch(() => undefined); await box.cleanup(); }
  return found;
}

const extra = Number(process.env.CK_WALKS ?? 0), from = Number(process.env.CK_SEED ?? 5000);
const only = process.env.CK_ONLY;
const walks = only ? [Number(only)] : [...SEEDS, ...Array.from({ length: extra }, (_, index) => from + index)];
test(`A random walk of ${STEPS} steps over an MCP server with a skill and an agent in one home, profile switches and new copies among them, Synchronize everything on in half, ${walks.length} times: nothing Central Knot removes or writes over is lost, passes settle, every action offered does something, Off then On keeps each entry, Claude Code is written only by Write, only a profile switch touches the skill and agent, nothing deleted comes back by itself, and the rule leaves nothing it would take`, async () => {
  const findings = new Map<string, { count: number; trace: string }>();
  const waiting = [...walks];
  await Promise.all(Array.from({ length: only ? 1 : 6 }, async () => {
    for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
      for (const { kind, trace } of await walk(next)) { const had = findings.get(kind); if (had) had.count++; else findings.set(kind, { count: 1, trace }); }
    }
  }));
  assert.deepEqual([...findings].map(([kind, { count, trace }]) => `${count}× ${kind}\n    ${trace}`), []);
});

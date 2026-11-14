// A seeded random walk over one skill ("notes") on real
// folders in a temp home, with an agent on the library in the same home: every click the Skills page and History offer
// (tests/skillclicks.ts), edits, files added, modes changed and folders deleted by hand, copies made by hand, a copy in
// ~/.agents/skills (which Copilot CLI and Codex read) coming and going, Take over of it, a tool's own switch set by hand and
// cleared, Automatic sync off and on, History's days passing, a folder that can't be written during a click, a crash at
// each step of a write or a removal, a tool uninstalled or left out, the agent turned off and on, and a source (a made-up
// repository standing in for a link: tests/sourcerepo.ts) holding a notes of its own: added, changed there, checked, dropped and
// brought back there, its SKILL.md unparseable there for one check, Add on its row for a notes held deleted, and removed. Odd
// seeds start with notes made by hand in Claude Code (a folder with a script, a file of mode 0600 and an empty folder), so the
// source's notes differs and is not brought in; even seeds start with notes from the source, turned On.
// After every step:
//   (a) nothing is lost: each folder Central Knot wrote over or removed held a content that is a version of the skill, or is
//       still in a tool or the shared folder. Checked for the step, and for every such content since the walk began;
//   (b) in a copy of the home put back after, two plain passes: the second writes nothing; then an On skill is current in
//       every managed tool it is wanted in (or that tool has it another way), and an Off or deleted one has nothing applied;
//   (c) every action the page and History offer does something: none is refused as stale, and each changes a folder or the record;
//   (d) from a settled home, Off then On puts every tool's folder back byte for byte;
//   (e) a tool Central Knot doesn't manage, the shared folder (but for Take over) and each tool's own switch (but for Clear
//       the switch) are never written;
//   (f) every click made a History entry, after a crash too, and from a settled home its Undo puts every folder back as it was;
//   (h) the agent's files are as they were in every managed tool, but for its own Off and On, which puts them back byte for byte.
// A step that makes a copy unseeable (a link inside, a SKILL.md that can't be parsed, its tool's folder made again) is made
// from a settled home, and asserts that the pass turns nothing Off and removes nothing; one more deletes a folder by hand and
// runs passes inside a settle window of 2 s, which must change nothing; and one makes the source's SKILL.md unparseable for a
// Check now, which must turn nothing Off and remove nothing.
// The walks in SEEDS run in `npm test`. CK_WALKS=<n> runs n more seeds from CK_SEED=<n>; CK_ONLY=<seed> replays one walk,
// with CK_TRACE=1 step by step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyAgents } from '../src/agents.ts';
import { pruneHistory, readHistory } from '../src/history.ts';
import { wantedIn } from '../src/library.ts';
import { asksWhichCopy, harnessIs, placeOf, rowClicks } from '../src/libraryrow.ts';
import { DAY_MS } from '../src/model.ts';
import { readTree, type ShareContext } from '../src/share.ts';
import { applySkills, clearSwitch, takeOver } from '../src/skills.ts';
import { setDisabled } from '../src/skillswitch.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { Change, HarnessId, HistoryDays, HistoryEvent, PassResult } from '../src/types.ts';
import { bytes, folderOf, historyActions, put, roots, sandbox, seen, skillText, tools as allTools, trial, undo, type Tool } from './skillclicks.ts';
import { addSource, bringBack, checkSource, previewSource, removeSource, sourcesView } from '../src/sources.ts';
import { repository, standInHosts } from './sourcerepo.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

/**
 * The walks every `npm test` runs (more, from any seed: CK_WALKS and CK_SEED). 51317 ends by deleting by hand a copy the person
 * made in Codex, which Central Knot never took in: their own deletion, which the checker must not count as a loss.
 */
const SEEDS = [1, 2, 3, 4, 51317];
const STEPS = 16;
const random = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
/** An answer that means the page or History offered an action that is stale or does nothing. */
const STALE = /nothing left to undo|no longer in Central Knot’s store|changed since the page was read|at that version already|No tool has a copy/;
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
/** The skill's rich folder: a script that runs, a file of mode 0600, an empty folder. */
const rich = (body = 'Take notes.') => ({ 'SKILL.md': skillText(body), 'scripts/run.sh': { text: '#!/bin/sh\necho hi\n', mode: 0o755 }, 'private.txt': { text: 'mine\n', mode: 0o600 } });
/** The agent beside it, and its file in each tool. */
const agentFiles = { 'claude-cli': '.claude/agents/writer.md', 'copilot-cli': '.copilot/agents/writer.agent.md', 'codex-cli': '.codex/agents/writer.toml' } as const;
/** Each tool's own switch file, which only Clear the switch may write. */
const switchFiles = { 'claude-cli': '.claude/settings.json', 'copilot-cli': '.copilot/settings.json', 'codex-cli': '.codex/config.toml' } as const;
/** The walk's three tools (skillclicks.ts tools). */
const three = allTools as (keyof typeof agentFiles)[];

interface Finding { kind: string; trace: string }
async function walk(seed: number): Promise<Finding[]> {
  const next = random(seed), pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const box = await sandbox(), tools = box.tools;
  const manage = (managed: HarnessId[]) => { tools.splice(0, tools.length, ...allTools.filter(tool => managed.includes(tool))); };
  const shared = join(box.home, '.agents/skills/notes');
  const recordText = () => readFile(join(box.home, '.central-knot', 'skills.json'), 'utf8').catch(() => '');
  let days: HistoryDays = 30, marker = 0, syncOn = true, settled = true, last: PassResult | undefined;
  const context = (more: Partial<ShareContext> = {}): ShareContext => ({ ...box.context, historyDays: days, ...more });
  const trace = [`seed ${seed}`];
  const found: Finding[] = [];
  const fail = (kind: string) => { found.push({ kind, trace: trace.join(' → ') }); };
  const taken = new Set<string>();
  const send = (change: Change, more: Partial<ShareContext> = {}) => applySkills(context(more), tools, [change], syncOn ? {} : { only: new Set(['notes']) });
  const pass = (more: Partial<ShareContext> = {}) => applySkills(context(more), tools, []);
  /** Each tool's folder byte for byte, and the shared copy's. */
  const folders = async (): Promise<Record<string, Record<string, string> | undefined>> => ({ ...Object.fromEntries(await Promise.all(allTools.map(async tool => [tool, await bytes(folderOf(box, tool as Tool))] as const))), shared: await bytes(shared) });
  /** A folder's content as the library hashes it; none for a link, or a folder that is no skill. */
  const contentAt = async (path: string) => {
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isDirectory()) return undefined;
    try { await lstat(join(path, 'SKILL.md')); return (await readTree(path)).hash; } catch { return undefined; }
  };
  const contents = async () => Object.fromEntries(await Promise.all([...allTools.map(tool => [tool, folderOf(box, tool as Tool)]), ['shared', shared]].map(async ([where, path]) => [where, await contentAt(path)] as const)));
  const versionsNow = async () => new Set(((await seen(box, context())).item?.versions ?? []).map(version => version.hash));
  const agentNow = async () => Object.fromEntries(await Promise.all(three.map(async tool => [tool, await readFile(join(box.home, agentFiles[tool]), 'utf8').catch(() => undefined)] as const)));
  const switchesNow = async () => Object.fromEntries(await Promise.all(three.map(async tool => [tool, await readFile(join(box.home, switchFiles[tool]), 'utf8').catch(() => undefined)] as const)));
  const historyCount = async () => (await readHistory(context())).filter(event => event.key === 'notes').length;
  const readOnly = (tool: Tool, on: boolean) => chmod(join(box.home, roots[tool]), on ? 0o555 : 0o755).catch(() => undefined);
  let agentAsWritten: Record<string, string | undefined> = {};
  let clock = Date.now() + 1e9;
  // The source: a repository of this walk's own, whose root is a notes skill until it drops it (renamed jottings there).
  const sourceLink = `https://github.com/walk/notes-${seed}`, source = await repository(hosts, sourceLink);
  await source.commit({ 'SKILL.md': skillText('From the source.') });
  let sourceHasNotes = true;
  const sourceNow = async () => (await sourcesView(context())).sources[0];
  const checkNow = (id: string, more: Partial<ShareContext> = {}) => checkSource(context(more), async () => tools, id, work => work());

  /** (b) on the home as it is, in a trial: two passes; whether the first found nothing to do. */
  const settles = async () => trial(box, async () => {
    const record = await recordText();
    const first = await pass(), unchanged = record === await recordText();
    const second = await pass();
    if (second.writes) fail(`(b) a second plain pass writes: ${second.results.map(entry => entry.message).join(' | ').slice(0, 120)}`);
    const { row, item } = await seen(box, context());
    if (!item) return !first.writes && unchanged;
    for (const tool of tools) {
      const is = harnessIs(row, item, tool), wanted = wantedIn(item, tool);
      // A copy of its own beside another way it has it (the shared folder) is left alone: it has it both ways.
      const bothWays = is === 'own-copy' && !!row.anotherWay?.[tool];
      if (wanted && !bothWays && !['current', 'cannot', 'another-way'].includes(is)) fail(`(b) after quiet passes an On skill is “${is}” in ${tool}`);
      if (item.on && !item.deleted && !wanted && !['kept-out', 'own-copy', 'another-way'].includes(is)) fail(`(b) after quiet passes a skill kept out of ${tool} is “${is}” there`);
      if ((!item.on || item.deleted) && item.applied[tool] !== undefined) fail(`(b) after quiet passes an Off skill still has a copy applied in ${tool}`);
    }
    return unchanged && !first.writes && !first.results.some(entry => entry.outcome === 'held' || entry.outcome === 'failed');
  });

  try {
    if (seed % 2) {
      await put(box, 'claude-cli', rich(), ['empty']);
      await send(rowClicks.on((await seen(box)).row, undefined));
    } else {
      // Even seeds: notes comes from the source (its own runnable script), added, then turned On, so every source step reaches it.
      const { chmod } = await import('node:fs/promises');
      await source.commit({ 'SKILL.md': skillText('Take notes.'), 'scripts/run.sh': '#!/bin/sh\necho hi\n' });
      await chmod(join(source.dir, 'scripts/run.sh'), 0o755);
      await source.commit({});
      const look = await previewSource(context(), sourceLink);
      if (!('token' in look) || look.refused) throw new Error(`the walk's source can't be added: ${look.refused}`);
      await addSource(context(), tools, look.token);
      await send(rowClicks.on((await seen(box)).row, (await seen(box)).item));
    }
    for (const tool of three) await mkdir(join(box.home, agentFiles[tool], '..'), { recursive: true });
    await writeFile(join(box.home, agentFiles['claude-cli']), '---\nname: writer\ndescription: Writes docs\n---\n\nYou write docs.\n');
    await applyAgents(context(), tools, [{ key: 'writer', on: true, except: [], seenOn: false }]);
    agentAsWritten = await agentNow();
    for (let step = 0; step < STEPS && !found.length; step++) {
      const { row, item, fact } = await seen(box, context());
      const place = placeOf(item), held = item && !item.deleted ? item : undefined;
      const present = (allTools as Tool[]).filter(tool => fact?.copies[tool] !== undefined);
      /** `app`: Central Knot acts; `click`: its result has an Undo; `byHand`: the step changes folders itself as well; `writes`: what it may write besides tools' folders. */
      type Act = { name: string; run: (more?: Partial<ShareContext>) => Promise<unknown>; app?: boolean; click?: boolean; byHand?: boolean; writes?: 'shared' | 'switch' | 'agent' };
      const acts: Act[] = [];
      const add = (weight: number, act: Act) => { for (let count = 0; count < weight; count++) acts.push(act); };
      const clicks = (weight: number, name: string, change: Change) => add(weight, { name, app: true, click: true, run: more => send(change, more) });
      if (place === 'on') clicks(4, 'Off', rowClicks.off(row, item));
      if (place === 'off') clicks(4, 'On', rowClicks.on(row, item));
      if (place === 'found' && (present.length || fact?.anotherWay)) {
        if (!asksWhichCopy(row)) clicks(4, 'On (take in)', rowClicks.on(row, item));
        else for (const tool of present.filter(tool => tools.includes(tool))) clicks(2, `choose ${tool}`, rowClicks.on(row, item, tool));
      }
      if (held?.on) for (const tool of tools) clicks(1, `${held.except.includes(tool) ? 'let in' : 'keep out of'} ${tool}`, rowClicks.inHarness(row, item, tool, !held.except.includes(tool)));
      for (const version of held?.versions.filter(version => version.hash !== held.hash).slice(0, 3) ?? []) clicks(1, `make current ${version.from.how}`, rowClicks.makeCurrent(row, item, version.hash));
      if (held) clicks(1, 'Delete', rowClicks.remove(row, item));
      // Clear the switch's Undo sets that tool's own switch again: the one History action that writes it.
      for (const action of await historyActions(box, context())) add(2, { name: `History: ${action.label} (${action.event.kind})`, app: true, writes: action.event.kind === 'switched' ? 'switch' : undefined, run: () => action.run() });
      if (last?.made?.length) { const click = last; add(2, { name: 'Undo', app: true, run: () => undo(box, click, context()) }); }
      for (const [tool, take] of Object.entries(fact?.takeOver ?? {})) add(2, { name: `Take over (${take!.kind}) in ${tool}`, app: true, writes: 'shared', run: () => takeOver(context(), tools, 'notes', tool as HarnessId) });
      for (const [tool, load] of Object.entries(fact?.loads ?? {})) if (load?.switchedOff) add(2, { name: `Clear the switch in ${tool}`, app: true, writes: 'switch', run: () => clearSwitch(context(), tools, 'notes', tool as HarnessId) });
      for (const tool of allTools as Tool[]) {
        const folder = folderOf(box, tool), there = await bytes(folder);
        const touch = async () => { const when = new Date(Date.now() + ++marker * 1000); for (const name of ['', 'SKILL.md']) await utimes(join(folder, name), when, when).catch(() => undefined); };
        if (there && !there['']) {
          add(2, { name: `hand edit in ${tool}`, run: async () => { await writeFile(join(folder, 'SKILL.md'), skillText(`Hand ${marker + 1}.`)); await touch(); } });
          add(1, { name: `hand-added file in ${tool}`, run: async () => { await writeFile(join(folder, `added-${marker + 1}.md`), 'Added by hand.\n'); await touch(); } });
          if (there['scripts/run.sh']) add(1, { name: `script made not runnable in ${tool}`, run: async () => { await chmod(join(folder, 'scripts/run.sh'), 0o644); await touch(); } });
          add(1, { name: `hand delete in ${tool}`, run: () => rm(folder, { recursive: true }) });
          add(1, { name: `${tool}’s switch set by hand`, run: () => setDisabled(context(), tool, { folder: 'notes', name: 'notes', skillFile: join(folder, 'SKILL.md') }, true) });
        } else if (!there) add(1, { name: `hand-made copy in ${tool}`, run: async () => { await put(box, tool, rich(`Hand ${marker + 1}.`)); await touch(); } });
      }
      if (await bytes(shared)) add(1, { name: 'the installer removes the shared copy', run: () => rm(shared, { recursive: true }) });
      else add(1, { name: 'the installer puts a copy in ~/.agents/skills', run: async () => { await mkdir(shared, { recursive: true }); await writeFile(join(shared, 'SKILL.md'), skillText(pick(['Take notes.', `Installed ${marker + 1}.`]))); } });
      add(2, { name: 'pass', app: true, run: more => pass(more) });
      const recorded = await sourceNow();
      if (!recorded) add(5, { name: 'add the source', app: true, run: async () => { const look = await previewSource(context(), sourceLink); if ('token' in look && !look.refused) await addSource(context(), tools, look.token); } });
      else {
        add(6, { name: 'Check now', app: true, run: more => checkNow(recorded.id, more) });
        add(1, { name: 'Remove the source', app: true, run: () => removeSource(context(), recorded.id) });
        if (recorded.names.some(name => name.key === 'notes' && name.state === 'deleted')) add(4, { name: 'Add on the source’s row', app: true, run: () => bringBack(context(), tools, recorded.id, 'notes') });
        // The source's SKILL.md stops parsing for one check: unreadable there, never gone, so nothing turns Off or is removed.
        if (held?.source === recorded.id && sourceHasNotes) add(2, { name: 'the source’s SKILL.md unparseable, then Check now', app: true, byHand: true, run: async () => {
          await source.commit({ 'SKILL.md': '---\nname: [notes\n---\nBroken.\n' });
          try {
            const before = (await seen(box, context())).item?.on, done = await checkNow(recorded.id);
            if ((await seen(box, context())).item?.on !== before) fail('a source’s SKILL.md that stopped parsing turned the skill Off');
            if (done.results?.some(entry => entry.outcome === 'removed')) fail('a source’s SKILL.md that stopped parsing had a copy removed');
          } finally { await source.commit({ 'SKILL.md': skillText(`Source ${++marker}.`) }); }
        } });
      }
      add(3, { name: 'the source changes notes', run: async () => { await source.commit({ 'SKILL.md': skillText(`Source ${++marker}.`, sourceHasNotes ? 'notes' : 'jottings') }); } });
      add(2, { name: sourceHasNotes ? 'the source drops notes (renamed jottings)' : 'the source has notes again', run: async () => {
        sourceHasNotes = !sourceHasNotes;
        await source.commit({ 'SKILL.md': skillText(`Source ${++marker}.`, sourceHasNotes ? 'notes' : 'jottings') });
      } });
      add(1, { name: `Automatic sync ${syncOn ? 'off' : 'on'}`, run: async () => { syncOn = !syncOn; } });
      add(1, { name: 'the agent Off then On', app: true, writes: 'agent', run: async () => {
        const off = await applyAgents(context(), tools, [{ key: 'writer', on: false, except: [], seenOn: true }]);
        await applyAgents(context(), tools, [{ key: 'writer', on: true, except: [], seenOn: false }]);
        if (!off.stopped && !same(await agentNow(), agentAsWritten)) fail('(h) the agent’s Off then On left a file other than it was');
      } });
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
      else if (!tools.includes(out)) add(2, { name: `${out} managed again`, run: async () => { manage([...tools, out]); await chooseTools(context(), out, true); } });
      if (tools.includes(out) && tools.length > 1) add(1, { name: `${out} left out by the tool choice`, run: async () => { manage(tools.filter(tool => tool !== out)); await chooseTools(context(), out, false); } });
      // A copy made unseeable, from a settled home with the skill on in that tool: the pass must turn nothing Off and remove nothing.
      const hidden = pick(tools as Tool[]);
      if (settled && place === 'on' && held && !held.except.includes(hidden) && fact?.copies[hidden]) {
        const folder = folderOf(box, hidden), root = join(box.home, roots[hidden]);
        const unseen = (name: string, hide: () => Promise<unknown>, show: () => Promise<unknown>) => add(1, { name: `unseeable: ${name} in ${hidden}`, app: true, byHand: true, run: async () => {
          const text = await readFile(join(folder, 'SKILL.md'), 'utf8');
          await hide();
          try {
            const done = await pass(), now = (await seen(box, context())).item;
            if (!now?.on) fail(`an unseeable copy (${name}) turned the skill Off`);
            if (done.results.some(entry => entry.outcome === 'removed')) fail(`an unseeable copy (${name}) had a copy removed`);
          } finally { await show(); await writeFile(join(folder, 'SKILL.md'), text).catch(() => undefined); }
        } });
        unseen('a link inside', () => symlink('SKILL.md', join(folder, 'alias')), () => rm(join(folder, 'alias'), { force: true }));
        unseen('a SKILL.md that can’t be parsed', () => writeFile(join(folder, 'SKILL.md'), '---\nname: [notes\n---\n'), async () => undefined);
        unseen('its tool’s folder made again', async () => { await rename(root, `${root}-away`); await mkdir(root); }, async () => { await rm(root, { recursive: true, force: true }); await rename(`${root}-away`, root); });
        add(1, { name: `deleted by hand in ${hidden}, passes inside the settle window`, app: true, byHand: true, run: async () => {
          await rm(folder, { recursive: true });
          clock += 1e6;
          for (const now of [clock, clock + 1000]) {
            const done = await applySkills({ ...context(), settleMs: 2000 }, tools, [], { now });
            if (done.writes || !(await seen(box, context())).item?.on) fail(`(settle) a folder deleted inside the settle window ${done.writes ? 'had folders written or removed' : 'turned the skill Off'}`);
          }
        } });
      }

      const act = pick(acts);
      const blocked = act.app && !act.byHand && process.getuid?.() !== 0 && next() < 0.12 ? pick(tools as Tool[]) : undefined;
      const crash = act.app && !act.byHand && !blocked && next() < 0.1 ? pick(['before-remove', 'before-rename', 'mid-replace'] as const) : undefined;
      trace.push(`${act.name}${blocked ? ` [${blocked} read-only]` : ''}${crash ? ` [crash ${crash}]` : ''}`);
      const before = await folders(), contentsBefore = await contents(), managedBefore = [...tools], entriesBefore = await historyCount(), settledBefore = settled;
      const switchesBefore = await switchesNow();
      let done: unknown, crashed = false;
      if (blocked) await readOnly(blocked, true);
      try { done = await act.run(crash ? { fault: at => { if (at === crash) throw new Error('crash'); } } : {}); }
      catch (error) { if ((error as Error).message === 'crash') crashed = true; else { fail(`threw: ${(error as Error).message.slice(0, 140)}`); break; } }
      finally { if (blocked) await readOnly(blocked, false); }
      if (!act.app && syncOn && next() < 0.7) { trace.push('background pass'); await pass(); }
      last = act.click && !crashed ? done as PassResult : act.app ? undefined : last;
      const after = await folders(), versions = await versionsNow();
      if (process.env.CK_TRACE) {
        const now = (await seen(box, context())).item;
        console.log(`--- ${trace.at(-1)}${crashed ? ' (crashed)' : ''}\n    ${JSON.stringify({ place: placeOf(now), except: now?.except, applied: Object.keys(now?.applied ?? {}), folders: Object.fromEntries(Object.entries(after).map(([where, folder]) => [where.split('-')[0], folder?.['SKILL.md']?.match(/(Take notes\.|Hand \d+\.|Installed \d+\.)/)?.[0] ?? (folder ? 'there' : undefined)])), versions: now?.versions.length })}`);
      }
      // (a) and (e): what this step wrote over or removed, and where it may write.
      const here = new Set(Object.values(await contents()));
      if (act.app) for (const where of [...allTools, 'shared'] as (Tool | 'shared')[]) {
        if (same(after[where], before[where])) continue;
        if (where === 'shared' ? act.writes !== 'shared' : !managedBefore.includes(where) && !/managed again/.test(act.name)) fail(`(e) ${act.name} changed ${where === 'shared' ? 'the shared folder' : where}, which isn’t Central Knot’s`);
        // A step that is the person's own deletion as well (byHand) took that copy itself: it is no loss of Central Knot's.
        const was = contentsBefore[where];
        if (was && !act.byHand) taken.add(was);
      }
      if (act.app && act.writes !== 'switch' && !same(await switchesNow(), switchesBefore)) fail(`(e) ${act.name} wrote a tool’s own switch`);
      for (const content of taken) if (!versions.has(content) && !here.has(content)) { taken.delete(content); fail('(a) a content Central Knot wrote over or removed is neither a version nor in any folder'); }
      if (act.writes !== 'agent') { const agent = await agentNow(); for (const tool of managedBefore) if (agent[tool] !== agentAsWritten[tool]) fail(`(h) ${act.name} changed the agent’s file in ${tool}`); }
      // (f) Every click has its History entry, a crashed one too.
      const answer = act.click && !crashed ? done as PassResult : undefined;
      const refused = !!answer && (!!answer.stopped || answer.results.some(entry => entry.unchanged || entry.differs));
      if (act.click && !refused && await historyCount() === entriesBefore) fail(`(f) ${act.name} made no History entry`);
      // (f) From a settled home, a click's Undo puts every folder back as it was, a copy the click took over from a tool too
      // (taken in, written over, or counted as the skill's: its Undo gives it back).
      if (act.click && settledBefore && !crashed && !blocked && last?.made?.length) {
        const click = last;
        await trial(box, async () => {
          await undo(box, click, context());
          if (!same(await folders(), before)) fail(`(f) the Undo of ${act.name} left a folder other than it was`);
        });
      }
      settled = await settles();
      // (c) Every action offered now does something.
      const offered: { name: string; run: () => Promise<PassResult | PassResult[]> }[] = (await historyActions(box, context())).map(action => ({ name: `History’s ${action.label} on ${action.event.kind}`, run: action.run }));
      const now = await seen(box, context()), live = now.item && !now.item.deleted ? now.item : undefined;
      const page = (name: string, change: Change) => offered.push({ name: `the page’s ${name}`, run: () => send(change) });
      if (live) page(live.on ? 'Off' : 'On', live.on ? rowClicks.off(now.row, live) : rowClicks.on(now.row, live));
      if (live) page('Delete', rowClicks.remove(now.row, live));
      if (live?.on) for (const tool of tools) page(`switch in ${tool}`, rowClicks.inHarness(now.row, live, tool, !live.except.includes(tool)));
      for (const [index, version] of (live?.versions ?? []).entries()) if (version.hash !== live!.hash) page(`Make current #${index}`, rowClicks.makeCurrent(now.row, live, version.hash));
      for (const tool of Object.keys(now.fact?.takeOver ?? {})) offered.push({ name: `the page’s Take over in ${tool}`, run: () => takeOver(context(), tools, 'notes', tool as HarnessId) });
      for (const [tool, load] of Object.entries(now.fact?.loads ?? {})) if (load?.switchedOff) offered.push({ name: `the page’s Clear the switch in ${tool}`, run: () => clearSwitch(context(), tools, 'notes', tool as HarnessId) });
      for (const action of offered) await trial(box, async () => {
        const record = await recordText(), switches = await switchesNow(), answers = [await action.run()].flat();
        const refusal = answers.map(answer => answer.stopped ?? answer.results.find(entry => entry.unchanged)?.message).find(Boolean);
        if (refusal && STALE.test(refusal)) fail(`(c) ${action.name}: “${refusal.slice(0, 100)}”`);
        else if (!refusal && same(after, await folders()) && record === await recordText() && same(switches, await switchesNow())) fail(`(c) ${action.name} does nothing`);
      });
      // (d) Off then On, from a settled home: every folder byte for byte.
      if (settled && live?.on) await trial(box, async () => {
        await send(rowClicks.off(now.row, live));
        const off = await seen(box, context());
        await send(rowClicks.on(off.row, off.item));
        if (!same(after, await folders())) fail('(d) Off then On left a folder other than it was');
      });
    }
  } finally { for (const tool of allTools as Tool[]) await readOnly(tool, false); await box.cleanup(); }
  return found;
}

const extra = Number(process.env.CK_WALKS ?? 0), from = Number(process.env.CK_SEED ?? 5000);
const only = process.env.CK_ONLY;
const walks = only ? [Number(only)] : [...SEEDS, ...Array.from({ length: extra }, (_, index) => from + index)];
test(`A random walk of ${STEPS} steps over a skill and an agent in one home, ${walks.length} times: nothing Central Knot removes or writes over is lost, passes settle, every action offered does something, Off then On is byte for byte, an unseeable copy turns nothing Off, and the agent is never touched`, async () => {
  const findings = new Map<string, { count: number; trace: string }>();
  const waiting = [...walks];
  await Promise.all(Array.from({ length: only ? 1 : 6 }, async () => {
    for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
      for (const { kind, trace } of await walk(next)) { const had = findings.get(kind); if (had) had.count++; else findings.set(kind, { count: 1, trace }); }
    }
  }));
  assert.deepEqual([...findings].map(([kind, { count, trace }]) => `${count}× ${kind}\n    ${trace}`), []);
});

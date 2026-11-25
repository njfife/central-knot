// A seeded random walk over one skill ("notes") on real folders in a temp home with Claude Code, Copilot CLI, Codex and Pi,
// with an agent on the library in the same home ("writer"; in Pi a loose file beside the skill's folder, in the same skills folder):
// every click the Library and History offer
// (tests/skillclicks.ts), edits, files added, modes changed and folders deleted by hand, copies made by hand, a copy in
// ~/.agents/skills (which Copilot CLI, Codex and Pi read; beside the installer's other skill, on too) coming and going (gone
// while a tool had the skill only there: a deletion by hand, after which no pass writes a copy there), the whole shared folder
// away, unreadable or replaced by a folder of other things for a pass, by one with a skill of its own for two passes with
// Synchronize everything on, or away for two passes beside a reader's own copy (no folder of any tool changes), Take over of it,
// a tool's own switch set by hand and cleared, Automatic sync off and on, History's days passing, a folder that can't be
// written during a click, a crash at each step of a write or a removal, a tool uninstalled or left out, the agent turned off and on, and a source (a made-up
// repository standing in for a link: tests/sourcerepo.ts) holding a notes of its own in its notes/ folder: added, changed
// there (its body, or its description, a line apart from the body a hand edit rewrites), checked, dropped and
// brought back there, its SKILL.md unparseable there for one check, Add on its row for a notes held deleted, Replace, Merge
// and Keep mine on its row for a notes whose version waits there (changed here too), Turn on on its line for a notes it
// removed (library.ts REMOVED AT ITS SOURCE: the Skills view's fromSource `removed`), and removed. The source holds an agent
// too, "critic" in its agents/ folder: changed there (its prompt, or its description), dropped and back there, turned On and
// Off, deleted, edited by hand in Claude Code (alone, or with a change at the source and a Check now), and Add, Merge, Replace
// and Keep mine on its line. And an MCP server, "relay" in its .mcp.json: changed there (an environment variable, or its
// arguments), dropped and back there, turned On and Off, deleted, edited by hand in Copilot CLI (alone, or with a change at the
// source and a Check now), and Add, Merge, Replace and Keep mine on its line.
// The source's link is a plugin's own folder from the start in every third walk (a plugin.json naming its notes/ folder), and
// becomes one and stops being one, each between two Check nows: read the same way, the second answers no update, drop or new
// item (atlink.ts holdsAt: the link's readers first).
// And a plugin, kit, from a folder marketplace, whose skill tome is a library item linked to it in Pi (library.ts A PLUGIN; no
// tool's installer runs here, so Claude Code, Copilot CLI and Codex never get it): kit On and Off, kept out of Pi and let in,
// its Undo, tome changed in the plugin then Update, dropped and back then Update, and edited by hand in Pi (let go then).
// Odd seeds start with notes made by hand in Claude Code (a folder with a script, a file of mode 0600 and an empty folder), so
// the source's notes differs and is not brought in; even seeds start with notes, critic and relay from the source, turned On.
// After every step:
//   (a) nothing is lost: each folder Central Knot wrote over or removed held a content that is a version of the skill, or is
//       still in a tool or the shared folder. Checked for the step, and for every such content since the walk began;
//   (b) in a copy of the home put back after, two plain passes: the second writes nothing; then an On skill is current in
//       every managed tool it is wanted in (or that tool has it another way), and an Off or deleted one has nothing applied;
//   (c) every action the page and History offer does something: none is refused as stale, and each changes a folder or the record;
//   (d) from a settled home, Off then On puts every tool's folder back byte for byte;
//   (e) a tool Central Knot doesn't manage, the shared folder (but for Take over) and each tool's own switch (but for Clear
//       the switch) are never written; even walks start Pi's list with a pattern that keeps every skill out ("!*") and another
//       skill's `+`, where Central Knot writes only the `+` of the walk's own items (skillswitch.ts piSwitched), and the other stays;
//   (f) every click made a History entry, after a crash too, and from a settled home its Undo puts every folder back as it was;
//   (h) the agent's files are as they were in every managed tool, but for its own Off and On, which puts them back byte for byte;
//   (i) the source's agent: each file of it Central Knot wrote over or removed held a version of it, or is still in a tool;
//       and in a copy of the home put back after, a second plain pass over the agents writes nothing, then an On critic is
//       current in every managed tool, an Off or deleted one has nothing applied. Its line's clicks are among (c)'s;
//   (k) the plugin's skill: a content of it Central Knot wrote over or removed in Pi is a version of it or still in Pi; while it
//       is linked to kit, nothing of it is applied in a tool with an installer; and in a copy put back after, two plain passes,
//       then a linked tome On and wanted in Pi is current there, and Pi's list lets it in;
//   (j) the source's server, the same: each entry of it Central Knot wrote over or removed held a version of it, or is still in
//       a tool; and in a copy put back after, a second plain pass over the servers writes nothing, then an On relay is current
//       in every managed tool, an Off or deleted one has nothing applied. Its line's clicks too.
// A step that makes a copy unseeable (a link inside, a SKILL.md that can't be parsed, its tool's folder made again) is made
// from a settled home, and asserts that the pass turns nothing Off and removes nothing; one more deletes a folder by hand and
// runs passes inside a settle window of 2 s, which must change nothing; and one makes the source's SKILL.md unparseable for a
// Check now, which must never read the skill as gone there: from a settled home it turns nothing Off and removes nothing, and
// otherwise anything it turns Off is a copy deleted by hand that no pass had seen, which History says.
// The walks in SEEDS run in `npm test`. CK_WALKS=<n> runs n more seeds from CK_SEED=<n>; CK_ONLY=<seed> replays one walk,
// with CK_TRACE=1 step by step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { lockPath } from './fslock.ts';
import { join } from 'node:path';
import { agentHash, parseAgent } from '../src/agentfiles.ts';
import { agentsView, applyAgents } from '../src/agents.ts';
import type { AgentTool } from '../src/presence.ts';
import { pruneHistory, readHistory } from '../src/history.ts';
import { readTool } from '../src/mcp.ts';
import { applyServers, serversView } from '../src/servers.ts';
import { wantedIn } from '../src/library.ts';
import { asItIs, asksWhichCopy, harnessIs, placeOf, rowClicks } from '../src/libraryrow.ts';
import { DAY_MS } from '../src/model.ts';
import { readRecord, readTree, saveRecord, type ShareContext } from '../src/share.ts';
import type { LibraryItem } from '../src/library.ts';
import { applySkills, clearSwitch, skillKind, takeOver } from '../src/skills.ts';
import { isDisabled, readSwitchFile, setDisabled } from '../src/skillswitch.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { Change, HarnessId, HistoryDays, HistoryEvent, PassResult, SourceResult } from '../src/types.ts';
import { bytes, folderOf, historyActions, put, roots, sandbox, seen, skillText, tools as clickTools, trial, undo, type Tool } from './skillclicks.ts';
import { addSource, checkSource, previewSource, removeSource, rowClick, sourcesView } from '../src/sources.ts';
import { repository, standInHosts } from './sourcerepo.ts';
import { createMarketplaces } from '../src/marketplaces.ts';
import { readPluginRecord } from '../src/pluginrecord.ts';
import * as pluginEngine from '../src/plugins.ts';
import type { PluginTurnResult } from '../src/types.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

/**
 * The walks every `npm test` runs (more, from any seed: CK_WALKS and CK_SEED). 51317, 81060 and 91036 once found the checker
 * wrong, in a form of the walk before the source held an agent (a deletion by hand counted as a loss; one no pass had seen,
 * before the source's SKILL.md stopped parsing, blamed on the source); the walk has more steps since, so they no longer replay
 * those paths, and the checks they taught stay (`taken` and `byHand`; the unparseable step's own checks).
 */
const SEEDS = [1, 2, 3, 4, 51317, 81060, 91036];
const STEPS = 16;
const random = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
/** An answer that means the page or History offered an action that is stale or does nothing. */
const STALE = /nothing left to undo|no longer in Central Knot’s store|changed since the page was read|at that version already|No tool has a copy/;
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
/**
 * A source's click's answer (types.ts SourceResult) as a pass's, for the checks that read one: what stopped it, its results, and
 * the History entries it made (each one's Undo). A Merge that changed nothing (its files conflict, or a tool's copy still held a
 * change) is a refusal, as an action the page offers may be: said, and changing nothing.
 */
const asPass = (done: SourceResult): PassResult => {
  const unmerged = (done.sourced ?? []).filter(entry => entry.merge && entry.merge !== 'merged' && entry.merge !== 'had');
  return { ...(done.stopped ? { stopped: done.stopped } : {}), writes: 0, reloads: [], made: (done.sourced ?? []).flatMap(entry => (entry.history ? [entry.history] : [])),
    results: [...(done.results ?? []), ...unmerged.map(entry => ({ item: entry.name, outcome: 'held' as const, unchanged: true as const, message: `Merge changed nothing: ${JSON.stringify(entry.merge)}` }))] };
};
/** The skill's rich folder: a script that runs, a file of mode 0600, an empty folder. */
const rich = (body = 'Take notes.') => ({ 'SKILL.md': skillText(body), 'scripts/run.sh': { text: '#!/bin/sh\necho hi\n', mode: 0o755 }, 'private.txt': { text: 'mine\n', mode: 0o600 } });
/** The walk's tools: skillclicks.ts's three, and Pi. */
const allTools: Tool[] = [...clickTools, 'pi-cli'];
/** The agent beside it, and its file in each tool (in Pi, a skill in its skills folder). */
const agentFiles = { 'claude-cli': '.claude/agents/writer.md', 'copilot-cli': '.copilot/agents/writer.agent.md', 'codex-cli': '.codex/agents/writer.toml', 'pi-cli': '.pi/agent/skills/writer.md' } as const;
/** The source's agent, critic (in its agents/ folder, beside its notes/ skill), its file in each tool, and its shared part's hash as a tool reads it. */
const criticFiles = { 'claude-cli': '.claude/agents/critic.md', 'copilot-cli': '.copilot/agents/critic.agent.md', 'codex-cli': '.codex/agents/critic.toml', 'pi-cli': '.pi/agent/skills/critic.md' } as const;
const criticMd = (prompt: string, description = 'Critiques.') => `---\nname: critic\ndescription: ${description}\n---\n\n${prompt}\n`;
const sharedHash = (tool: string, text: string | undefined) => { const read = text === undefined ? undefined : parseAgent(tool as AgentTool, 'critic', text); return read && agentHash(read); };
/** The source's MCP server, relay, in its .mcp.json (with a field of Claude Code's own), or none there. */
const relayJson = (relay?: { A: string; B: string; args: string[] }) =>
  `${JSON.stringify({ mcpServers: relay ? { relay: { command: 'relay', args: relay.args, env: { A: relay.A, B: relay.B }, timeout: 30 } } : {} }, null, 2)}\n`;
/** Each tool's own switch file, which only Clear the switch may write. */
const switchFiles = { 'claude-cli': '.claude/settings.json', 'copilot-cli': '.copilot/settings.json', 'codex-cli': '.codex/config.toml', 'pi-cli': '.pi/agent/settings.json' } as const;

interface Finding { kind: string; trace: string }
async function walk(seed: number): Promise<Finding[]> {
  const next = random(seed), pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const box = await sandbox(allTools), tools = box.tools;
  const manage = (managed: HarnessId[]) => { tools.splice(0, tools.length, ...allTools.filter(tool => managed.includes(tool))); };
  const shared = join(box.home, '.agents/skills/notes');
  /** The skills' record, the agents' and the servers' (the source's agent and server are in them), as text. */
  const recordText = async () => (await Promise.all(['skills.json', 'agents.json', 'mcp.json'].map(file => readFile(join(box.home, '.central-knot', file), 'utf8').catch(() => '')))).join('\n');
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
  const agentNow = async () => Object.fromEntries(await Promise.all(allTools.map(async tool => [tool, await readFile(join(box.home, agentFiles[tool as keyof typeof agentFiles]), 'utf8').catch(() => undefined)] as const)));
  // Codex keeps its MCP servers in that same file: their tables are the servers' to write, not the switch.
  const switchesNow = async () => Object.fromEntries(await Promise.all(allTools.map(async tool => [tool, await readFile(join(box.home, switchFiles[tool as keyof typeof switchFiles]), 'utf8')
    .then(text => (tool === 'codex-cli' ? text.replace(/^\[mcp_servers[^\n]*\n(?:(?!\[)[^\n]*\n?)*/gm, '').trimEnd() || undefined : text), () => undefined)] as const)));
  // (e) in Pi under the pattern: the `+` of the walk's own items, in Central Knot's forms, is its to write; nothing else there.
  const ours = (entry: string) => ['notes/SKILL.md', 'tome/SKILL.md', 'writer.md', 'critic.md'].some(name => entry === `+skills/${name}` || entry === `+${join(box.home, roots['pi-cli'], name)}`);
  const withoutInclusions = (switches: Record<string, string | undefined>) => {
    const pi = switches['pi-cli'] === undefined ? undefined : JSON.parse(switches['pi-cli']);
    return { ...switches, 'pi-cli': pi && JSON.stringify({ ...pi, skills: pi.skills?.filter((entry: string) => !ours(entry)) }) };
  };
  const historyCount = async () => (await readHistory(context())).filter(event => event.key === 'notes').length;
  let agentAsWritten: Record<string, string | undefined> = {};
  let clock = Date.now() + 1e9;
  // The source: a repository of this walk's own, whose root is a notes skill until it drops it (renamed jottings there); every
  // third walk's root is a plugin's own folder from the start, its plugin.json naming that notes/ folder.
  const sourceLink = `https://github.com/walk/notes-${seed}`, source = await repository(hosts, sourceLink);
  const relayAt = { A: '1', B: '1', args: ['--relay'] }, pluginJson = JSON.stringify({ name: 'notes-kit', skills: ['./notes'] });
  let sourceHasNotes = true, sourceHasCritic = true, sourceHasRelay = true, sourceIsPlugin = seed % 3 === 0;
  await source.commit({ 'notes/SKILL.md': skillText('From the source.'), 'agents/critic.md': criticMd('You critique.'), '.mcp.json': relayJson(relayAt), ...(sourceIsPlugin ? { '.claude-plugin/plugin.json': pluginJson } : {}) });
  const criticTaken = new Set<string>();
  const critic = async () => (await agentsView(context(), tools)).library.critic as LibraryItem | undefined;
  const criticNow = async () => Object.fromEntries(await Promise.all(allTools.map(async tool => [tool, await readFile(join(box.home, criticFiles[tool as keyof typeof criticFiles]), 'utf8').catch(() => undefined)] as const)));
  /** (i) on the home as it is, in a trial: two plain passes over the agents, the second writing nothing; then the source's agent, On, is current in every managed tool, and Off or deleted has nothing applied. */
  const agentsSettle = () => trial(box, async () => {
    await applyAgents(context(), tools, []);
    const second = await applyAgents(context(), tools, []);
    if (second.writes) fail(`(i) a second plain pass over the agents writes: ${second.results.map(entry => entry.message).join(' | ').slice(0, 120)}`);
    const item = await critic(), files = await criticNow();
    for (const tool of item ? tools : []) {
      if (item!.on && !item!.deleted && sharedHash(tool, files[tool]) !== item!.hash) fail(`(i) after quiet passes the source’s agent, On, is not current in ${tool}`);
      if ((!item!.on || item!.deleted) && item!.applied[tool] !== undefined) fail(`(i) after quiet passes the source’s agent, Off, still has a copy applied in ${tool}`);
    }
  });
  const relayTaken = new Set<string>();
  const relay = async () => (await serversView(context(), tools)).library.relay as LibraryItem | undefined;
  /** Each tool's entry for relay, by the hash of its shared part (none where it has none). */
  const relayNow = async () => Object.fromEntries(await Promise.all(allTools.map(async tool => [tool, (await readTool(context(), tool)).entries.find(entry => entry.name === 'relay')?.hash] as const)));
  /** (j) on the home as it is, in a trial: two plain passes over the servers, the second writing nothing; then the source's server, On, is current in every managed tool, and Off or deleted has nothing applied. */
  const serversSettle = () => trial(box, async () => {
    await applyServers(context(), tools, []);
    const second = await applyServers(context(), tools, []);
    if (second.writes) fail(`(j) a second plain pass over the servers writes: ${second.results.map(entry => entry.message).join(' | ').slice(0, 120)}`);
    const item = await relay(), hashes = await relayNow();
    for (const tool of item ? tools : []) {
      if (item!.on && !item!.deleted && hashes[tool] !== item!.hash) fail(`(j) after quiet passes the source’s server, On, is not current in ${tool}`);
      if ((!item!.on || item!.deleted) && item!.applied[tool] !== undefined) fail(`(j) after quiet passes the source’s server, Off, still has an entry applied in ${tool}`);
    }
  });
  // The plugin kit and its skill tome (the header): its marketplace and Central Knot's data folder are under the sandbox, so a trial puts them back too.
  const kitRoot = join(box.base, 'market'), tomeAt = join(kitRoot, 'plugins/kit/skills/tome/SKILL.md'), tomeInPi = join(box.home, roots['pi-cli'], 'tome');
  await mkdir(join(kitRoot, '.claude-plugin'), { recursive: true });
  await writeFile(join(kitRoot, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'kit', source: './plugins/kit' }] }));
  await mkdir(join(tomeAt, '..'), { recursive: true });
  await writeFile(tomeAt, skillText('Tome 0.', 'tome'));
  const never = async () => { throw new Error('no tool’s installer runs in the walk'); };
  const markets = createMarketplaces({ home: () => ({ home: box.home, actual: true }), read: async () => ({ tools: [...tools], snapshots: [] }), writeAccess: async () => ({ allowed: true }),
    dataDir: join(box.base, 'data'), pickFolder: async () => undefined, openExternal: async () => {}, leftOut: async () => [], share: () => context() },
  { findClis: async () => ({ binaries: {}, apps: {} }), checkAccess: pluginEngine.checkAccess, addMarketplace: never, readCatalog: pluginEngine.readCatalog, readRemotePlugin: never, install: never, uninstall: never, update: never, setSkill: never, setPart: never, setWhole: never }, []);
  await markets.add(kitRoot);
  let kitHasTome = true, lastKit: PluginTurnResult | undefined;
  const kitEntry = async () => (await readPluginRecord(box.home)).record?.plugins.find(entry => entry.plugin === 'kit');
  const tome = async () => (await skillKind.open(context())).library.items.tome;
  const tomeTaken = new Set<string>();
  /** (k) on the home as it is, in a trial: two plain passes; then a tome linked to kit, On and wanted in Pi, is current there. */
  const kitSettle = () => trial(box, async () => {
    await pass(); await pass();
    const item = await tome(), entry = await kitEntry();
    if (item && entry && item.source === entry.id && wantedIn(item, 'pi-cli') && tools.includes('pi-cli') && await contentAt(tomeInPi) !== item.hash) fail('(k) after quiet passes the plugin’s tome, On in Pi, is not current there');
    else if (item && entry && item.source === entry.id && wantedIn(item, 'pi-cli') && tools.includes('pi-cli') && isDisabled(context(), await readSwitchFile(context(), 'pi-cli'), { folder: 'tome', name: 'tome', skillFile: join(tomeInPi, 'SKILL.md') })) fail('(k) after quiet passes the plugin’s tome, put in Pi, is kept out by Pi’s list');
  });
  const sourceNow = async () => (await sourcesView(context(), tools)).sources[0];
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
    // The installer's other skill, on: the shared folder still holds a skill the record names once notes's copy goes from it, so
    // that is a deletion, not a folder that can't be vouched for (library.ts THE SHARED FOLDER).
    await mkdir(join(box.home, '.agents/skills/kept'), { recursive: true });
    await writeFile(join(box.home, '.agents/skills/kept/SKILL.md'), skillText('The installer’s.', 'kept'));
    await send(rowClicks.on((await seen(box, context(), 'kept')).row, undefined));
    if (!(seed % 2)) { await mkdir(join(box.home, '.pi/agent'), { recursive: true }); await writeFile(join(box.home, switchFiles['pi-cli']), '{ "skills": ["!*", "+skills/another/SKILL.md"] }\n'); }
    if (seed % 2) {
      await put(box, 'claude-cli', rich(), ['empty']);
      await send(rowClicks.on((await seen(box)).row, undefined));
    } else {
      // Even seeds: notes comes from the source (its own runnable script), added, then turned On, so every source step reaches it.
      const { chmod } = await import('node:fs/promises');
      await source.commit({ 'notes/SKILL.md': skillText('Take notes.'), 'notes/scripts/run.sh': '#!/bin/sh\necho hi\n' });
      await chmod(join(source.dir, 'notes/scripts/run.sh'), 0o755);
      await source.commit({});
      const look = await previewSource(context(), tools, sourceLink);
      if (!('token' in look) || look.refused) throw new Error(`the walk's source can't be added: ${look.refused}`);
      await addSource(context(), tools, look.token);
      await send(rowClicks.on((await seen(box)).row, (await seen(box)).item));
    }
    for (const tool of allTools) await mkdir(join(box.home, agentFiles[tool as keyof typeof agentFiles], '..'), { recursive: true });
    await writeFile(join(box.home, agentFiles['claude-cli']), '---\nname: writer\ndescription: Writes docs\n---\n\nYou write docs.\n');
    await applyAgents(context(), tools, [{ key: 'writer', on: true, except: [], seenOn: false }]);
    // Even seeds: the source's agent, added with it, turned On too, so its changes and its line's clicks come within the walk.
    if (!(seed % 2)) await applyAgents(context(), tools, [{ key: 'critic', on: true, except: [], seenOn: false }]);
    if (!(seed % 2)) await applyServers(context(), tools, [{ key: 'relay', on: true, except: [], seenOn: false }]);
    // Even seeds: kit On, so tome is in Pi from the start and every kit step meets it.
    if (!(seed % 2)) await markets.turn(kitRoot, 'kit', 'on', undefined, box.home);
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
      // The tools that had notes only there get no folder written by the pass after, whatever it concludes (the fault it once had).
      const onlyThere = Object.keys(held?.throughShared ?? {}) as Tool[];
      if (await bytes(shared)) add(1, { name: 'the installer removes the shared copy', run: async () => {
        const before = await folders();
        await rm(shared, { recursive: true });
        if (!onlyThere.length) return;
        await pass();
        const after = await folders();
        for (const tool of onlyThere) if (after[tool] && !same(after[tool], before[tool])) fail(`a pass wrote ${tool}’s copy after the shared copy it had notes only through was deleted`);
      } });
      else add(1, { name: 'the installer puts a copy in ~/.agents/skills', run: async () => { await mkdir(shared, { recursive: true }); await writeFile(join(shared, 'SKILL.md'), skillText(pick(['Take notes.', `Installed ${marker + 1}.`]))); } });
      add(2, { name: 'pass', app: true, run: more => pass(more) });
      const recorded = await sourceNow();
      if (!recorded) add(5, { name: 'add the source', app: true, run: async () => { const look = await previewSource(context(), tools, sourceLink); if ('token' in look && !look.refused) await addSource(context(), tools, look.token); } });
      else {
        add(6, { name: 'Check now', app: true, run: more => checkNow(recorded.id, more) });
        add(1, { name: 'Remove the source', app: true, run: () => removeSource(context(), tools, recorded.id) });
        if (recorded.names.some(name => name.key === 'notes' && name.state === 'deleted')) add(4, { name: 'Add on the source’s row', app: true, run: () => rowClick(context(), tools, recorded.id, 'skill', 'notes', 'bringBack') });
        if (recorded.names.some(name => name.key === 'notes' && name.state === 'wait')) add(10, { name: 'Replace on the source’s row', app: true, click: true, run: async more => asPass(await rowClick(context(more), tools, recorded.id, 'skill', 'notes', 'replace')) });
        if (recorded.names.some(name => name.key === 'notes' && name.state === 'wait')) add(10, { name: 'Merge on the source’s row', app: true, click: true, run: async more => asPass(await rowClick(context(more), tools, recorded.id, 'skill', 'notes', 'merge')) });
        if (recorded.names.some(name => name.key === 'notes' && name.state === 'wait')) add(10, { name: 'Keep mine on the source’s row', app: true, click: true, run: async more => asPass(await rowClick(context(more), tools, recorded.id, 'skill', 'notes', 'keep')) });
        // The source's line for a notes it removed: Turn on, the same click as the row's switch (sourcespage.ts turnOn).
        if (fact?.fromSource?.removed && fact.fromSource.link === recorded.link) clicks(4, 'Turn on on the source’s line', { ...asItIs('notes', item), on: true, seenOn: false });
        // The source changes and the next read (the daily one, or Check now) comes at once: what a skill changed here meets most.
        if (sourceHasNotes) add(3, { name: 'the source changes notes, then Check now', app: true, run: async more => { await source.commit({ 'notes/SKILL.md': skillText(`Source ${++marker}.`) }); return checkNow(recorded.id, more); } });
        // The source's SKILL.md stops parsing for one check: unreadable there, never gone, so the source turns nothing Off. From a
        // settled home nothing turns Off or is removed; otherwise a copy deleted by hand that no pass has seen yet is the check's
        // pass to carry out, as any pass's (library.ts THE RULE), and History must say the deletion did it.
        if (held?.source === recorded.id && sourceHasNotes) add(2, { name: 'the source’s SKILL.md unparseable, then Check now', app: true, byHand: true, run: async () => {
          await source.commit({ 'notes/SKILL.md': '---\nname: [notes\n---\nBroken.\n' });
          try {
            const quiet = settled, before = (await seen(box, context())).item?.on, entries = await historyCount(), done = await checkNow(recorded.id);
            const told = (await readHistory(context())).filter(event => event.key === 'notes').slice(entries);
            const byHand = told.some(event => event.cause === 'deleted-by-hand');
            if (told.some(event => event.cause === 'source-dropped')) fail('a source’s SKILL.md that stopped parsing was read as the skill gone');
            if ((await seen(box, context())).item?.on !== before && (quiet || !byHand)) fail('a source’s SKILL.md that stopped parsing turned the skill Off');
            // The same check reads the source's agent and server too, which it may drop by their own reads: only the skill's copies count.
            if (quiet && done.results?.some(entry => entry.outcome === 'removed' && entry.item === 'notes')) fail('a source’s SKILL.md that stopped parsing had a copy removed');
          } finally { await source.commit({ 'notes/SKILL.md': skillText(`Source ${++marker}.`) }); }
        } });
      }
      // The link becomes a plugin's own folder, or stops being one: a Check now first, so the second meets that change alone.
      if (recorded) add(2, { name: sourceIsPlugin ? 'the source is no plugin again, then Check now' : 'the source becomes a plugin (its plugin.json names notes/), then Check now', app: true, run: async more => {
        await checkNow(recorded.id, more);
        sourceIsPlugin = !sourceIsPlugin;
        await source.commit({ '.claude-plugin/plugin.json': sourceIsPlugin ? pluginJson : null });
        const done = await checkNow(recorded.id, more), moved = (done.sourced ?? []).filter(entry => ['drop', 'update', 'make', 'link'].includes(entry.answer));
        if (moved.length) fail(`a source that ${sourceIsPlugin ? 'became' : 'stopped being'} a plugin’s folder answered ${moved.map(entry => `${entry.name}: ${entry.answer}`).join(', ')}`);
        return done;
      } });
      add(3, { name: 'the source changes notes', run: async () => { await source.commit({ 'notes/SKILL.md': skillText(`Source ${++marker}.`, sourceHasNotes ? 'notes' : 'jottings') }); } });
      // A line apart from the body a hand edit rewrites: what Merge's line merge puts together.
      if (sourceHasNotes) add(2, { name: 'the source changes notes’s description', run: async () => {
        const text = await readFile(join(source.dir, 'notes/SKILL.md'), 'utf8');
        await source.commit({ 'notes/SKILL.md': text.replace(/^description: .*$/m, `description: Takes notes, the source’s way ${++marker}.`) });
      } });
      add(2, { name: sourceHasNotes ? 'the source drops notes (renamed jottings)' : 'the source has notes again', run: async () => {
        sourceHasNotes = !sourceHasNotes;
        await source.commit({ 'notes/SKILL.md': skillText(`Source ${++marker}.`, sourceHasNotes ? 'notes' : 'jottings') });
      } });
      // The source's agent: changed there (its prompt, or its description, a line apart from the prompt a hand edit rewrites),
      // dropped and back there; On, Off, Delete, edited by hand in Claude Code; and its line's Add, Merge, Replace and Keep mine.
      const critItem = await critic(), critLive = critItem && !critItem.deleted ? critItem : undefined;
      const critLine = recorded?.names.find(name => name.kind === 'agent' && name.key === 'critic');
      if (sourceHasCritic) add(2, { name: 'the source changes critic’s prompt', run: () => source.commit({ 'agents/critic.md': criticMd(`Critique ${++marker}.`) }) });
      if (sourceHasCritic) add(1, { name: 'the source changes critic’s description', run: async () => {
        const text = await readFile(join(source.dir, 'agents/critic.md'), 'utf8');
        await source.commit({ 'agents/critic.md': text.replace(/^description: .*$/m, `description: Critiques ${++marker}.`) });
      } });
      add(1, { name: sourceHasCritic ? 'the source drops critic' : 'the source has critic again', run: async () => {
        sourceHasCritic = !sourceHasCritic;
        await source.commit({ 'agents/critic.md': sourceHasCritic ? criticMd(`Critique ${++marker}.`) : null });
      } });
      if (critLive) add(2, { name: `critic ${critLive.on ? 'Off' : 'On'}`, app: true, run: more => applyAgents(context(more), tools, [{ key: 'critic', on: !critLive.on, except: [], seenOn: critLive.on }]) });
      if (critLive) add(1, { name: 'critic deleted', app: true, run: more => applyAgents(context(more), tools, [{ key: 'critic', on: critLive.on, except: [], seenOn: critLive.on, deleted: true }]) });
      const inClaude = join(box.home, criticFiles['claude-cli']);
      if (critLive?.on && tools.includes('claude-cli')) add(2, { name: 'hand edit critic in Claude Code', run: async () => {
        const text = await readFile(inClaude, 'utf8').catch(() => undefined);
        if (text) await writeFile(inClaude, text.replace(/\n\n[\s\S]*$/, `\n\nMine ${++marker}.\n`));
      } });
      // Changed here and at the source, then read: what the agent's Merge, Replace and Keep mine meet (the prompt here, the
      // description there, so Merge can put them together).
      if (recorded && critLive?.on && sourceHasCritic && tools.includes('claude-cli')) add(3, { name: 'critic changed in Claude Code and at the source, then Check now', app: true, byHand: true, run: async () => {
        const text = await readFile(inClaude, 'utf8').catch(() => undefined), there = await readFile(join(source.dir, 'agents/critic.md'), 'utf8');
        if (text) await writeFile(inClaude, text.replace(/\n\n[\s\S]*$/, `\n\nMine ${++marker}.\n`));
        await source.commit({ 'agents/critic.md': there.replace(/^description: .*$/m, `description: Critiques ${++marker}.`) });
        return checkNow(recorded.id);
      } });
      if (recorded && critLine?.state === 'deleted') add(3, { name: 'Add on critic’s line', app: true, run: more => rowClick(context(more), tools, recorded.id, 'agent', 'critic', 'bringBack') });
      if (recorded && critLine?.state === 'wait') for (const click of ['merge', 'replace', 'keep'] as const) {
        add(4, { name: `${click} on critic’s line`, app: true, run: async more => asPass(await rowClick(context(more), tools, recorded.id, 'agent', 'critic', click)) });
      }
      // The source's server: changed there (an environment variable, or its arguments), dropped and back there; On, Off, Delete,
      // edited by hand in Copilot CLI; and its line's Add, Merge, Replace and Keep mine.
      const relayItem = await relay(), relayLive = relayItem && !relayItem.deleted ? relayItem : undefined;
      const relayLine = recorded?.names.find(name => name.kind === 'mcp' && name.key === 'relay');
      if (sourceHasRelay) add(2, { name: 'the source changes relay’s B', run: () => { relayAt.B = `${++marker}`; return source.commit({ '.mcp.json': relayJson(relayAt) }); } });
      if (sourceHasRelay) add(1, { name: 'the source changes relay’s arguments', run: () => { relayAt.args = ['--relay', `${++marker}`]; return source.commit({ '.mcp.json': relayJson(relayAt) }); } });
      add(1, { name: sourceHasRelay ? 'the source drops relay' : 'the source has relay again', run: async () => {
        sourceHasRelay = !sourceHasRelay;
        await source.commit({ '.mcp.json': relayJson(sourceHasRelay ? relayAt : undefined) });
      } });
      if (relayLive) add(2, { name: `relay ${relayLive.on ? 'Off' : 'On'}`, app: true, run: more => applyServers(context(more), tools, [{ key: 'relay', on: !relayLive.on, except: [], seenOn: relayLive.on }]) });
      if (relayLive) add(1, { name: 'relay deleted', app: true, run: more => applyServers(context(more), tools, [{ key: 'relay', on: relayLive.on, except: [], seenOn: relayLive.on, deleted: true }]) });
      const inCopilot = join(box.home, '.copilot/mcp-config.json');
      const editRelay = async () => {
        const parsed = JSON.parse(await readFile(inCopilot, 'utf8').catch(() => '{}'));
        if (parsed.mcpServers?.relay) { parsed.mcpServers.relay.env = { ...parsed.mcpServers.relay.env, A: `mine ${++marker}` }; await writeFile(inCopilot, JSON.stringify(parsed, null, 2)); }
      };
      if (relayLive?.on && tools.includes('copilot-cli')) add(2, { name: 'hand edit relay in Copilot CLI', run: editRelay });
      if (recorded && relayLive?.on && sourceHasRelay && tools.includes('copilot-cli')) add(3, { name: 'relay changed in Copilot CLI and at the source, then Check now', app: true, byHand: true, run: async () => {
        await editRelay();
        relayAt.B = `${++marker}`;
        await source.commit({ '.mcp.json': relayJson(relayAt) });
        return checkNow(recorded.id);
      } });
      if (recorded && relayLine?.state === 'deleted') add(3, { name: 'Add on relay’s line', app: true, run: more => rowClick(context(more), tools, recorded.id, 'mcp', 'relay', 'bringBack') });
      if (recorded && relayLine?.state === 'wait') for (const click of ['merge', 'replace', 'keep'] as const) {
        add(4, { name: `${click} on relay’s line`, app: true, run: async more => asPass(await rowClick(context(more), tools, recorded.id, 'mcp', 'relay', click)) });
      }
      // The plugin kit: its switch (On, Off, kept out of Pi and let in) and its Undo, tome changed or dropped in it then Update, tome edited in Pi.
      const kit = await kitEntry(), update = () => markets.items(kitRoot, 'team', 'kit', ['pi-cli'], box.home);
      const kitTurn = (what: 'on' | 'off' | 'keep-out' | 'let-in', tool?: HarnessId) => async () => { lastKit = await markets.turn(kitRoot, 'kit', what, tool, box.home); return lastKit; };
      add(4, { name: `kit ${kit?.on ? 'Off' : 'On'}`, app: true, run: kitTurn(kit?.on ? 'off' : 'on') });
      if (kit?.on && tools.includes('pi-cli')) add(2, { name: `kit ${kit.except.includes('pi-cli') ? 'let into' : 'kept out of'} Pi`, app: true, run: kitTurn(kit.except.includes('pi-cli') ? 'let-in' : 'keep-out', 'pi-cli') });
      if (lastKit?.back?.length) { const undone = lastKit; add(3, { name: 'Undo kit', app: true, run: () => markets.undoTurn(kitRoot, 'kit', undone.before ?? null, undone.back!, box.home) }); }
      if (kitHasTome) add(3, { name: 'kit changes tome, then Update', app: true, run: async () => { await writeFile(tomeAt, skillText(`Tome ${++marker}.`, 'tome')); return update(); } });
      add(2, { name: kitHasTome ? 'kit drops tome, then Update' : 'kit has tome again, then Update', app: true, run: async () => {
        kitHasTome = !kitHasTome;
        if (kitHasTome) { await mkdir(join(tomeAt, '..'), { recursive: true }); await writeFile(tomeAt, skillText(`Tome ${++marker}.`, 'tome')); } else await rm(join(tomeAt, '..'), { recursive: true });
        return update();
      } });
      if (await bytes(tomeInPi)) add(2, { name: 'hand edit tome in Pi', run: () => writeFile(join(tomeInPi, 'SKILL.md'), skillText(`Mine ${++marker}.`, 'tome')) });
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
      // The shared folder away or unreadable as a whole, from a settled home where a tool has the skill only through it: unseen,
      // never a deletion (library.ts THE SHARED FOLDER).
      if (settled && place === 'on' && held?.throughShared) {
        const root = join(box.home, '.agents/skills'), aside = join(box.base, 'shared-aside');
        const whole = (how: string, hide: () => Promise<unknown>, show: () => Promise<unknown>) => add(1, { name: `unseeable: the shared folder ${how}`, app: true, byHand: true, run: async () => {
          await hide();
          try {
            const done = await pass();
            if (!(await seen(box, context())).item?.on) fail(`the shared folder ${how} turned the skill Off`);
            if (done.writes) fail(`the shared folder ${how} had folders written or removed`);
          } finally { await show(); }
        } });
        whole('renamed away', () => rename(root, aside), () => rename(aside, root));
        whole('replaced by a folder of other things', async () => { await rename(root, aside); await mkdir(root); await writeFile(join(root, 'README.md'), 'Not mounted.\n'); },
          async () => { await rm(root, { recursive: true }); await rename(aside, root); });
        if (process.getuid?.() !== 0) {
          let unlock: (() => Promise<void>) | undefined;
          whole('unreadable', async () => { unlock = await lockPath(root, 'dir-unreadable'); }, async () => { await unlock?.(); unlock = undefined; });
        }
        // Another skills folder in its place, with a skill of its own, for two passes with Synchronize everything on: nothing in it
        // is found or taken in, so no folder of any tool changes (library.ts THE SHARED FOLDER).
        add(1, { name: 'the shared folder replaced by one with a skill of its own, two passes, Synchronize everything on', app: true, byHand: true, run: async () => {
          const { record } = await readRecord(box.home);
          await rename(root, aside);
          await mkdir(join(root, 'stranger'), { recursive: true });
          await writeFile(join(root, 'stranger/SKILL.md'), skillText('Another folder’s.', 'stranger'));
          await saveRecord(box.home, { ...record!, syncEverything: true });
          const before = await folders();
          try {
            for (const _ of [1, 2]) await applySkills(context(), tools, [], { background: true });
            if (!same(await folders(), before) || (await seen(box, context(), 'stranger')).item) fail('a folder of other skills in the shared folder’s place had something taken in or a tool’s folder changed');
          } finally { await saveRecord(box.home, record!); await rm(root, { recursive: true }); await rename(aside, root); }
        } });
        // A reader that had it only there gets a differing folder of its own, then the shared folder is away for two passes: its
        // own copy may be beside one away, so no folder of any tool changes (library.ts THE SHARED FOLDER).
        const reader = (['codex-cli', 'copilot-cli'] as Tool[]).find(tool => held.throughShared?.[tool]);
        if (reader && !(await bytes(folderOf(box, reader)))) add(1, { name: `the shared folder away for two passes, ${reader} with a differing copy of its own`, app: true, byHand: true, run: async () => {
          await put(box, reader, rich(`${reader}’s own ${++marker}.`));
          await rename(root, aside);
          try {
            const before = await folders();
            await pass(); await pass();
            if (!same(await folders(), before)) fail('the shared folder away for two passes changed a tool’s folder, beside a reader’s own copy');
          } finally { await rename(aside, root); }
        } });
      }

      const act = pick(acts);
      const blocked = act.app && !act.byHand && process.getuid?.() !== 0 && next() < 0.12 ? pick(tools as Tool[]) : undefined;
      const crash = act.app && !act.byHand && !blocked && next() < 0.1 ? pick(['before-remove', 'before-rename', 'mid-replace'] as const) : undefined;
      const before = await folders(), contentsBefore = await contents(), managedBefore = [...tools], entriesBefore = await historyCount(), settledBefore = settled;
      const switchesBefore = await switchesNow(), criticBefore = await criticNow(), relayBefore = await relayNow(), tomeBefore = await contentAt(tomeInPi);
      let done: unknown, crashed = false;
      const unlockBlocked = blocked ? await lockPath(join(box.home, roots[blocked]), 'dir-readonly') : undefined;
      trace.push(`${act.name}${unlockBlocked ? ` [${blocked} read-only]` : ''}${crash ? ` [crash ${crash}]` : ''}`);
      try { done = await act.run(crash ? { fault: at => { if (at === crash) throw new Error('crash'); } } : {}); }
      catch (error) { if ((error as Error).message === 'crash') crashed = true; else { fail(`threw: ${(error as Error).message.slice(0, 140)}`); break; } }
      finally { if (unlockBlocked) await unlockBlocked(); }
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
      if (act.app && act.writes !== 'switch' && !same(withoutInclusions(await switchesNow()), withoutInclusions(switchesBefore))) fail(`(e) ${act.name} wrote a tool’s own switch`);
      for (const content of taken) if (!versions.has(content) && !here.has(content)) { taken.delete(content); fail('(a) a content Central Knot wrote over or removed is neither a version nor in any folder'); }
      if (act.writes !== 'agent') { const agent = await agentNow(); for (const tool of managedBefore) if (agent[tool] !== agentAsWritten[tool]) fail(`(h) ${act.name} changed the agent’s file in ${tool}`); }
      // (i) A file of the source's agent that Central Knot wrote over or removed held a version of it, or is still in a tool.
      const criticAfter = await criticNow();
      if (act.app && !act.byHand) for (const tool of managedBefore) if (criticBefore[tool] !== undefined && criticBefore[tool] !== criticAfter[tool]) criticTaken.add(sharedHash(tool, criticBefore[tool]) ?? '');
      const criticVersions = new Set((await critic())?.versions.map(version => version.hash)), criticHere = new Set(allTools.map(tool => sharedHash(tool, criticAfter[tool])));
      for (const hash of criticTaken) if (hash && !criticVersions.has(hash) && !criticHere.has(hash)) { criticTaken.delete(hash); fail('(i) a file of the source’s agent Central Knot wrote over or removed is neither a version nor in any tool'); }
      // (j) An entry of the source's server that Central Knot wrote over or removed held a version of it, or is still in a tool.
      const relayAfter = await relayNow();
      if (act.app && !act.byHand) for (const tool of managedBefore) if (relayBefore[tool] !== undefined && relayBefore[tool] !== relayAfter[tool]) relayTaken.add(relayBefore[tool]!);
      const relayVersions = new Set((await relay())?.versions.map(version => version.hash)), relayHere = new Set(Object.values(relayAfter));
      for (const hash of relayTaken) if (!relayVersions.has(hash) && !relayHere.has(hash)) { relayTaken.delete(hash); fail('(j) an entry of the source’s server Central Knot wrote over or removed is neither a version nor in any tool'); }
      // (k) The plugin's tome: what Central Knot wrote over or removed in Pi is a version of it or still in Pi; linked, nothing of it in a tool with an installer.
      const tomeNow = await tome(), tomeAfter = await contentAt(tomeInPi), kitNow = await kitEntry();
      if (act.app && !act.byHand && tomeBefore && tomeBefore !== tomeAfter) tomeTaken.add(tomeBefore);
      for (const hash of tomeTaken) if (!tomeNow?.versions.some(version => version.hash === hash) && hash !== tomeAfter) { tomeTaken.delete(hash); fail('(k) a content of the plugin’s tome Central Knot wrote over or removed is neither a version nor in Pi'); }
      if (tomeNow && kitNow && tomeNow.source === kitNow.id) for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as const) if (tomeNow.applied[tool] !== undefined) fail(`(k) the plugin’s tome, linked to it, has a copy applied in ${tool}`);
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
      await kitSettle();
      await agentsSettle();
      await serversSettle();
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
      const sourceRow = await sourceNow();
      if (sourceRow?.names.some(name => name.key === 'notes' && name.state === 'wait')) offered.push({ name: 'the Sources page’s Replace', run: async () => asPass(await rowClick(context(), tools, sourceRow.id, 'skill', 'notes', 'replace')) });
      if (sourceRow?.names.some(name => name.key === 'notes' && name.state === 'wait')) offered.push({ name: 'the Sources page’s Merge', run: async () => asPass(await rowClick(context(), tools, sourceRow.id, 'skill', 'notes', 'merge')) });
      if (sourceRow?.names.some(name => name.key === 'notes' && name.state === 'wait')) offered.push({ name: 'the Sources page’s Keep mine', run: async () => asPass(await rowClick(context(), tools, sourceRow.id, 'skill', 'notes', 'keep')) });
      if (now.fact?.fromSource?.removed) offered.push({ name: 'the Sources page’s Turn on', run: () => send({ ...asItIs('notes', now.item), on: true, seenOn: false }) });
      const criticLine = sourceRow?.names.find(name => name.kind === 'agent' && name.key === 'critic');
      if (criticLine?.state === 'wait') for (const click of ['merge', 'replace', 'keep'] as const) offered.push({ name: `the Sources page’s ${click} on critic`, run: async () => asPass(await rowClick(context(), tools, sourceRow!.id, 'agent', 'critic', click)) });
      if (criticLine?.state === 'deleted') offered.push({ name: 'the Sources page’s Add on critic', run: async () => asPass(await rowClick(context(), tools, sourceRow!.id, 'agent', 'critic', 'bringBack')) });
      const relayLineNow = sourceRow?.names.find(name => name.kind === 'mcp' && name.key === 'relay');
      if (relayLineNow?.state === 'wait') for (const click of ['merge', 'replace', 'keep'] as const) offered.push({ name: `the Sources page’s ${click} on relay`, run: async () => asPass(await rowClick(context(), tools, sourceRow!.id, 'mcp', 'relay', click)) });
      if (relayLineNow?.state === 'deleted') offered.push({ name: 'the Sources page’s Add on relay', run: async () => asPass(await rowClick(context(), tools, sourceRow!.id, 'mcp', 'relay', 'bringBack')) });
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
  } finally { await box.cleanup(); }
  return found;
}

const extra = Number(process.env.CK_WALKS ?? 0), from = Number(process.env.CK_SEED ?? 5000);
const only = process.env.CK_ONLY;
const walks = only ? [Number(only)] : [...SEEDS, ...Array.from({ length: extra }, (_, index) => from + index)];
test(`A random walk of ${STEPS} steps over a skill, an agent, a source’s agent and MCP server and a plugin’s skill in one home, ${walks.length} times: nothing Central Knot removes or writes over is lost, passes settle, every action offered does something, Off then On is byte for byte, an unseeable copy turns nothing Off, and the agent is never touched`, async () => {
  const findings = new Map<string, { count: number; trace: string }>();
  const waiting = [...walks];
  await Promise.all(Array.from({ length: only ? 1 : 6 }, async () => {
    for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
      for (const { kind, trace } of await walk(next)) { const had = findings.get(kind); if (had) had.count++; else findings.set(kind, { count: 1, trace }); }
    }
  }));
  assert.deepEqual([...findings].map(([kind, { count, trace }]) => `${count}× ${kind}\n    ${trace}`), []);
});

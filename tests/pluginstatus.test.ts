import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTORY, FROM_DIRECTORY, WAITS_TO_MOVE, pluginsInstalled, blocked, cantSwitchSkill, cantUninstall, comparableText, copiesToCompare, copyStale, foundIn, installsIn, limitNote, offeredVersion, pluginPlace, otherVersions, otherVersionsLine, boxOf, itemsOnWords, switchPartial, switchWords, toolMark, toolNow, unavailable, uninstallAsk, uninstallFacts, updateTools } from '../src/pluginstatus.ts';
import { clickRuns, owedTo } from '../src/pluginrecord.ts';
import { readInTurn, readInto, type Read } from '../src/reads.ts';
import type { HarnessId, MarketplaceView, PluginDetail, PluginsView } from '../src/types.ts';

const entry: MarketplaceView = { source: 'a/b', origins: ['central-knot'], name: 'm', kind: 'git', sourceLabel: 'GitHub: a/b', plugins: [{ name: 'p', description: '' }],
  states: { p: { 'claude-cli': { state: 'installed', path: '/x' }, 'codex-cli': { state: 'held', reason: 'other' } } } };
const view: PluginsView = { home: '/h', tools: ['claude-cli', 'copilot-cli', 'codex-cli'], clis: { 'claude-cli': true, 'copilot-cli': true, 'codex-cli': true }, canWrite: true, marketplaces: [entry] };

test('A tool takes a plugin by its own installer only when its CLI is there and it is not held or refused; otherwise not at all, and the table is told why; Pi takes its items, but none while the plugin’s parts from before wait to be moved', () => {
  const route = (tool: Parameters<typeof toolNow>[3], at = entry) => toolNow(view, at, 'p', tool, undefined, false).route;
  assert.deepEqual([route('claude-cli'), route('copilot-cli'), route('codex-cli')], ['whole', 'whole', { cannot: 'other' }]);
  assert.match(blocked({ ...view, clis: {} }, entry, 'claude-cli') ?? '', /command-line tool wasn’t found/);
  assert.match(blocked({ ...view, clis: {}, desktopOnly: { 'claude-cli': 'Claude desktop' } }, entry, 'claude-cli') ?? '', /^Only Claude desktop was found here, and the copy of Claude Code it carries isn’t there yet \(the app adds it once it has run\). Claude Code’s command-line tool wasn’t found either.$/);
  assert.equal(blocked(view, { ...entry, copilotRefuses: 'Copilot refuses npm.' }, 'copilot-cli'), 'Copilot refuses npm.');
  assert.deepEqual(route('copilot-cli', { ...entry, copilotRefuses: 'x' }), { cannot: 'x' }, 'Copilot CLI refusing the marketplace takes nothing of it');
  assert.deepEqual(route('copilot-cli', { ...entry, refusedBy: { 'copilot-cli': 'Copilot CLI refused this marketplace.' } }), { cannot: 'Copilot CLI refused this marketplace.' }, 'nor does a tool whose own add refused it');
  assert.equal(toolNow({ ...view, tools: [...view.tools, 'pi-cli'] }, entry, 'p', 'pi-cli', undefined, false).route, 'items', 'Pi takes a plugin as library items');
  // Parts of it from before the library wait to be moved: Pi and OpenCode have none of it and can take none, so nothing is owed
  // there; the tools with an installer are as for any plugin.
  const waiting: MarketplaceView = { ...entry, waiting: ['p'] };
  assert.deepEqual(['pi-cli', 'opencode-cli'].map(tool => toolNow({ ...view, tools: [...view.tools, 'pi-cli', 'opencode-cli'] }, waiting, 'p', tool as 'pi-cli', undefined, false)),
    [{ has: 'none', route: { cannot: WAITS_TO_MOVE } }, { has: 'none', route: { cannot: WAITS_TO_MOVE } }]);
  assert.deepEqual([route('claude-cli', waiting), route('copilot-cli', waiting)], ['whole', 'whole']);
  // Its items On in Pi: Pi has it; Copilot CLI, with no copy of the plugin, has nothing of it (its items come only with the plugin).
  const withItems: MarketplaceView = { ...entry, items: { p: { lines: [{ kind: 'skill', key: 's', name: 's', state: 'linked', on: true, except: [] }], on: { 'pi-cli': 1 }, of: { 'pi-cli': 1 } } } };
  assert.deepEqual(['pi-cli', 'copilot-cli'].map(tool => toolNow({ ...view, tools: [...view.tools, 'pi-cli'] }, withItems, 'p', tool as 'pi-cli', undefined, false).has), ['items', 'none']);
  // One answer for every box, panel and key: held says why, installed is never unavailable, a missing CLI is.
  assert.equal(unavailable(view, entry, 'p', 'codex-cli'), 'other');
  assert.equal(unavailable({ ...view, clis: {} }, entry, 'p', 'claude-cli'), undefined);
  assert.match(unavailable({ ...view, clis: {} }, entry, 'p', 'copilot-cli') ?? '', /wasn’t found/);
});

test('A tool the plugin is kept out of is said as not installed there, kept out; one that can’t take it says why, kept out of it or not', () => {
  const except: HarnessId[] = ['copilot-cli', 'codex-cli'], kept: MarketplaceView = { ...entry, switches: { p: { entry: { on: true, except }, tools: {} } } };
  const mark = (tool: HarnessId) => toolMark(view, kept, 'p', tool, owedTo({ on: true, except }, tool, toolNow(view, kept, 'p', tool, undefined, false), view.tools));
  assert.deepEqual(mark('copilot-cli'), { mark: 'absent', words: 'Not installed in Copilot CLI, and kept out of it: nothing puts it there by itself.' });
  assert.deepEqual(mark('codex-cli'), { mark: 'cannot', words: 'Codex: other' }, 'Codex holds another marketplace of this name: its box is off, saying why');
});

test('A tool’s box: ticked where the plugin is; off before the click where its copy can’t be taken out here, saying why on its line; kept out of an absent tool while On has no line of its own', () => {
  const on = (except: HarnessId[] = []): MarketplaceView => ({ ...entry, switches: { p: { entry: { on: true, except }, tools: {} } } });
  const box = (at: MarketplaceView, tool: HarnessId, shown = view) => boxOf(shown, at, 'p', tool, toolMark(shown, at, 'p', tool, owedTo({ on: true, except: at.switches!.p!.entry!.except }, tool, toolNow(shown, at, 'p', tool, undefined, false), shown.tools)));
  assert.deepEqual(box(on(), 'claude-cli'), { ticked: true });
  // The Anthropic Directory's copy, or no command-line tool: the box is off before any click, never a kept-out it can't undo.
  const directory: MarketplaceView = { ...on(), states: { p: { 'claude-cli': { state: 'installed', path: '/x', directory: 'x' } } } };
  assert.deepEqual(box(directory, 'claude-cli'), { ticked: true, off: FROM_DIRECTORY, line: 'Can’t be taken out here' });
  assert.deepEqual(box(on(), 'claude-cli', { ...view, clis: {} }), { ticked: true, off: 'Claude Code’s command-line tool wasn’t found.', line: 'No Claude Code command-line tool here' });
  // Already kept out of a tool holding such a copy: the box says the way out, in words.
  assert.equal(box({ ...directory, switches: { p: { entry: { on: true, except: ['claude-cli'] }, tools: {} } } }, 'claude-cli').off, `${FROM_DIRECTORY} It is kept out of Claude Code: uninstall it in Claude Code itself, then tick to put it back.`);
  // Kept out of an absent tool while On: no line of its own, so the page shows ordinary absence ("Not installed").
  // Ordinary absence (Off, or no entry) has no line either. A tool whose own add refused the marketplace says so on its line.
  assert.deepEqual(box(on(['copilot-cli']), 'copilot-cli'), { ticked: false });
  const off: MarketplaceView = { ...entry, switches: { p: { entry: { on: false, except: ['copilot-cli'] }, tools: {} } } };
  assert.deepEqual(boxOf(view, off, 'p', 'copilot-cli', toolMark(view, off, 'p', 'copilot-cli', owedTo(off.switches!.p!.entry, 'copilot-cli', toolNow(view, off, 'p', 'copilot-cli', undefined, false), view.tools))), { ticked: false });
  assert.deepEqual(boxOf(view, entry, 'p', 'copilot-cli', toolMark(view, entry, 'p', 'copilot-cli', owedTo(undefined, 'copilot-cli', toolNow(view, entry, 'p', 'copilot-cli', undefined, false), view.tools))), { ticked: false });
  assert.deepEqual(box({ ...on(), refusedBy: { 'copilot-cli': 'Copilot CLI refused this marketplace: “Invalid marketplace.json”' } }, 'copilot-cli').line, 'Copilot CLI refused this marketplace');
  // On, kept out of Claude Code, which has its copy on again: the mark `stays`, the box ticked and free, and its untick turns the copy off there, kept installed (row 9).
  const keptOut: MarketplaceView = on(['claude-cli']), owed = owedTo({ on: true, except: ['claude-cli'] }, 'claude-cli', toolNow(view, keptOut, 'p', 'claude-cli', undefined, false), view.tools);
  assert.deepEqual([toolMark(view, keptOut, 'p', 'claude-cli', owed).mark, box(keptOut, 'claude-cli'), clickRuns('keep-out', owed)], ['stays', { ticked: true }, 'plugin-off']);
  // Turned off there and kept installed: the mark `kept-off`, the box unticked, and a tick turns the same copy on (row 3).
  const offThere: MarketplaceView = { ...keptOut, states: { p: { 'claude-cli': { state: 'installed', path: '/x', version: '1.0.0', off: true } } } };
  const now = toolNow(view, offThere, 'p', 'claude-cli', undefined, false);
  assert.deepEqual([toolMark(view, offThere, 'p', 'claude-cli', owedTo({ on: true, except: ['claude-cli'] }, 'claude-cli', now, view.tools)), box(offThere, 'claude-cli'), clickRuns('let-in', owedTo({ on: true, except: [] }, 'claude-cli', now, view.tools))],
    [{ mark: 'kept-off', words: 'Off in Claude Code: still installed at 1.0.0, with its data and settings.' }, { ticked: false }, 'plugin-on']);
  // Copilot CLI's live folder copy follows the same rule: on + kept out owes plugin-off; off reads kept-off and a tick owes plugin-on.
  const liveOn: MarketplaceView = { ...on(['copilot-cli']), states: { p: { 'copilot-cli': { state: 'installed', path: '/y', version: '1.0.0', live: true } } } };
  assert.equal(clickRuns('keep-out', owedTo({ on: true, except: ['copilot-cli'] }, 'copilot-cli', toolNow(view, liveOn, 'p', 'copilot-cli', undefined, false), view.tools)), 'plugin-off');
  const liveOff: MarketplaceView = { ...on(['copilot-cli']), states: { p: { 'copilot-cli': { state: 'installed', path: '/y', version: '1.0.0', live: true, off: true } } } };
  const liveNow = toolNow(view, liveOff, 'p', 'copilot-cli', undefined, false);
  assert.deepEqual([toolMark(view, liveOff, 'p', 'copilot-cli', owedTo({ on: true, except: ['copilot-cli'] }, 'copilot-cli', liveNow, view.tools)), box(liveOff, 'copilot-cli'), clickRuns('let-in', owedTo({ on: true, except: [] }, 'copilot-cli', liveNow, view.tools))],
    [{ mark: 'kept-off', words: 'Off in Copilot CLI: still installed at 1.0.0, with its data and settings.' }, { ticked: false }, 'plugin-on']);
});

const offCopy = { state: 'installed' as const, path: '/x', version: '1.0.0', off: true as const };
const onCopy = { state: 'installed' as const, path: '/y', version: '1.0.0' };
const withStates = (states: MarketplaceView['states']['p'], swEntry?: { on: boolean; except: HarnessId[] }): MarketplaceView => {
  const base: MarketplaceView = { ...entry, states: { p: states } };
  const tools = Object.fromEntries(view.tools.map(tool => [tool, owedTo(swEntry, tool, toolNow(view, base, 'p', tool, undefined, false), view.tools)]));
  return { ...base, switches: { p: { ...(swEntry ? { entry: swEntry } : {}), tools } } };
};

test('An off copy reads kept-off with an unticked box whether the record is On and not excepted or has no entry', () => {
  const onNotExcepted = withStates({ 'claude-cli': offCopy, 'copilot-cli': onCopy }, { on: true, except: [] });
  const markOn = toolMark(view, onNotExcepted, 'p', 'claude-cli', onNotExcepted.switches!.p!.tools['claude-cli']);
  assert.deepEqual([markOn, boxOf(view, onNotExcepted, 'p', 'claude-cli', markOn)],
    [{ mark: 'kept-off', words: 'Off in Claude Code: still installed at 1.0.0, with its data and settings.' }, { ticked: false }]);
  const noEntry = withStates({ 'claude-cli': offCopy });
  const markNone = toolMark(view, noEntry, 'p', 'claude-cli', noEntry.switches!.p!.tools['claude-cli']);
  assert.deepEqual([markNone.mark, boxOf(view, noEntry, 'p', 'claude-cli', markNone)], ['kept-off', { ticked: false }]);
});

test('A plugin’s switch is partial and its words distinguish copies that are off from tools kept out', () => {
  const byHand = withStates({ 'claude-cli': offCopy, 'copilot-cli': onCopy }, { on: true, except: [] });
  const byRecord = withStates({ 'claude-cli': offCopy, 'copilot-cli': onCopy }, { on: true, except: ['claude-cli'] });
  const keptAbsent = withStates({ 'claude-cli': onCopy }, { on: true, except: ['copilot-cli'] });
  const keptOnByHand = withStates({ 'claude-cli': onCopy, 'copilot-cli': onCopy }, { on: true, except: ['copilot-cli'] });
  const oneOfEach = withStates({ 'claude-cli': offCopy, 'copilot-cli': onCopy }, { on: true, except: ['codex-cli'] });
  assert.deepEqual(
    [byHand, byRecord, keptAbsent, keptOnByHand, oneOfEach].map(state => switchPartial(view, state, 'p')),
    [true, true, true, true, true],
  );
  assert.match(switchWords(view, byHand, 'p'), /^p: on, off in Claude Code\. /);
  assert.equal(switchWords(view, byHand, 'p'), switchWords(view, byRecord, 'p'));
  assert.match(switchWords(view, keptAbsent, 'p'), /^p: on, kept out of Copilot CLI\. /);
  assert.match(switchWords(view, keptOnByHand, 'p'), /^p: on, kept out of Copilot CLI\. /);
  assert.match(switchWords(view, oneOfEach, 'p'), /^p: on, off in Claude Code, kept out of Codex\. /);
});

test('foundIn counts only copies that are on, leaving out off copies', () => {
  assert.deepEqual(foundIn(view, withStates({ 'claude-cli': offCopy }), 'p'), []);
  assert.deepEqual(foundIn(view, withStates({ 'claude-cli': offCopy, 'copilot-cli': onCopy }), 'p'), ['copilot-cli']);
});

test('Skill switches under an off copy in Codex or Copilot CLI are locked with the whole-plugin-off reason', () => {
  const bothOff = withStates({ 'codex-cli': offCopy, 'copilot-cli': offCopy }, { on: true, except: [] });
  assert.equal(cantSwitchSkill(view, bothOff, 'p', 'codex-cli', 'triage'), 'The whole plugin p is off in Codex.');
  assert.equal(cantSwitchSkill(view, bothOff, 'p', 'copilot-cli', 'triage'), 'The whole plugin p is off in Copilot CLI.');
});

test('An off copy that cannot be changed here gets an unticked held box with its reason', () => {
  const dirOff = withStates({ 'claude-cli': { ...offCopy, directory: 'p@anthropic-plugin-directory' } }, { on: true, except: [] });
  const markDir = toolMark(view, dirOff, 'p', 'claude-cli', dirOff.switches!.p!.tools['claude-cli']);
  assert.deepEqual(boxOf(view, dirOff, 'p', 'claude-cli', markDir), { ticked: false, off: FROM_DIRECTORY, line: 'Off, kept installed · can’t be changed here' });
});

test('Only a known version that names another release is a difference', () => {
  const states = (claude?: string, codex?: string): MarketplaceView => ({ ...entry, states: { p: { 'claude-cli': { state: 'installed', path: '/x', version: claude }, 'codex-cli': { state: 'installed', path: '/y', version: codex } } } });
  // Codex names its copy with a commit after the version; a "v" or build suffix is the same release.
  assert.deepEqual(otherVersions(view, states('v1.2.0', '1.2.0-77c10e110b37'), 'p', '1.2.0'), []);
  assert.deepEqual(otherVersions(view, states('1.1.0', '1.2.0+build.5'), 'p', '1.2.0'), [{ tool: 'claude-cli', version: '1.1.0' }]);
  // A pre-release is another release; an unknown version on either side is not a difference.
  assert.deepEqual(otherVersions(view, states('1.2.0-beta', undefined), 'p', '1.2.0'), [{ tool: 'claude-cli', version: '1.2.0-beta' }]);
  assert.deepEqual(otherVersions(view, states('1.1.0'), 'p', undefined), []);
  // The list row names tools by version, each version kept with the word before it.
  assert.equal(otherVersionsLine(otherVersions(view, states('1.1.0', '1.1.0'), 'p', '1.2.0')), 'Claude Code and Codex have\u00a01.1.0');
  // Once a plugin's own files are read, their version (plugin.json's) is the one offered, not the catalog entry's.
  assert.equal(offeredVersion({ name: 'p', description: '', version: '1.0.0' }, { version: '1.1.0' } as PluginDetail), '1.1.0');
  // A copy checked out with Windows line endings is the same text.
  assert.equal(comparableText('---\r\nname: s\r\n'), comparableText('---\nname: s\n'));
});

test('Update is offered only where a tool’s copy is older and can be changed here', () => {
  const at = (states: MarketplaceView['states']['p']): MarketplaceView => ({ ...entry, states: { p: states } });
  const copies = at({ 'claude-cli': { state: 'installed', path: '/x', version: '1.9.0' }, 'copilot-cli': { state: 'installed', path: '/y', version: '2.1.0' }, 'codex-cli': { state: 'installed', path: '/z', version: '1.0.0', live: true } });
  // Claude Code is behind; Copilot CLI is ahead of the marketplace; Codex loads it live from the folder.
  assert.deepEqual(updateTools(view, copies, 'p', '2.0.0'), ['claude-cli']);
  assert.deepEqual(updateTools({ ...view, clis: { 'copilot-cli': true } }, copies, 'p', '2.0.0'), [], 'no CLI to run it');
  assert.deepEqual(updateTools(view, copies, 'p', undefined), [], 'nothing to compare with');
  // Claude Code's copy from the Anthropic Directory is installed, and left to Claude Code: behind or not, no Update, no Uninstall.
  const directory = at({ 'claude-cli': { state: 'installed', path: '/x', version: '1.9.0', directory: 'p@anthropic-plugin-directory' } });
  assert.deepEqual([updateTools(view, directory, 'p', '2.0.0'), toolNow(view, directory, 'p', 'claude-cli', undefined, false)], [[], { has: 'whole', route: 'whole', stuck: FROM_DIRECTORY }]);
  assert.equal(cantUninstall(view, directory, 'p', 'claude-cli'), FROM_DIRECTORY);
  assert.deepEqual(copiesToCompare(view, directory), [], 'its files aren’t compared with the marketplace’s');
});

test('A copy at the marketplace’s version whose text differs is offered Update once its files are read; line endings, parts only one side has and an instruction file no tool reads are no difference', () => {
  const part = (text: string, path = 'skills/one') => ({ name: 'one', description: '', text, path });
  const copies = { ...entry, states: { p: { 'claude-cli': { state: 'installed' as const, path: '/x', version: '1.2.0' }, 'copilot-cli': { state: 'installed' as const, path: '/y', version: '1.2.0' }, 'codex-cli': { state: 'installed' as const, path: '/z', version: '1.2.0', live: true } } } };
  const detail = { skills: [part('---\nname: one\n---\nB\n')], commands: [], agents: [], instructions: [part('Notes, 1.2.0.\n', 'AGENTS.md')], onlyInstructions: false, hooks: [], hooksByTool: {}, mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false, offered: true,
    installed: { 'claude-cli': { skills: [part('---\nname: one\n---\nA\n')], commands: [], agents: [], instructions: [], version: '1.2.0' }, 'copilot-cli': { skills: [part('---\r\nname: one\r\n---\r\nB\r\n'), part('extra', 'skills/two')], commands: [], agents: [], instructions: [part('Notes, edited.\n', 'AGENTS.md')], version: '1.2.0' },
      'codex-cli': { skills: [part('A')], commands: [], agents: [], instructions: [], version: '1.2.0' } } } as PluginDetail;
  // Claude Code's text differs; Copilot CLI's differs only in line endings, holds an extra part, and has another AGENTS.md,
  // which no tool reads; Codex loads it live.
  assert.deepEqual(updateTools(view, copies, 'p', '1.2.0', detail), ['claude-cli']);
  assert.equal(copyStale(copies, 'p', 'copilot-cli', '1.2.0', detail), false, 'an instruction file that differs offers no Update');
  assert.equal(copyStale(copies, 'p', 'claude-cli', '1.2.0', detail), true);
  assert.deepEqual(updateTools(view, copies, 'p', '1.2.0'), [], 'not known before its files are read');
  assert.deepEqual(updateTools(view, copies, 'p', '1.2.0', { ...detail, offered: false }), [], 'nor without the marketplace’s own copy');
  assert.equal(copyStale(copies, 'p', 'claude-cli', '1.3.0', detail), false, 'another version is told by its version, not its content');
});

test('A tool’s limits are named in a few words', () => {
  assert.equal(limitNote([{ component: 'Skills', result: 'works', text: '' }]), '');
  assert.equal(limitNote([{ component: 'Agents', result: 'ignored', text: 'are ignored: copied, never offered' }, { component: 'MCP servers', result: 'fails', text: '' }]), 'Agents are ignored +1');
  assert.equal(limitNote([{ component: 'Commands', result: 'limited', text: 'are turned into skills when installed' }]), 'Commands limited');
});

test('A background read is kept only while its own placeholder is still there', async () => {
  const map = new Map<string, Read<string>>();
  let release: (value: string) => void = () => {};
  let done = 0;
  readInto(map, 'k', () => new Promise<string>(resolve => { release = resolve; }), () => { done++; });
  readInto(map, 'k', async () => 'second', () => { done++; });
  assert.deepEqual(map.get('k'), { reading: true }, 'a read already under way is not started twice');
  map.clear();
  release('old');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(map.has('k'), false, 'a cleared map is not refilled by a stale answer');
  assert.equal(done, 0);
  readInto(map, 'k', async () => 'fresh', () => { done++; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(map.get('k'), { reading: false, value: 'fresh' });
  assert.equal(done, 1);
});

test('The list compares the files of plugins some tool has installed, a few at a time, each once', async () => {
  const listed: MarketplaceView = { ...entry, plugins: ['p', 'q', 'r', 's'].map(name => ({ name, description: '' })), states: {
    p: { 'claude-cli': { state: 'installed', path: '/x' } }, q: { 'codex-cli': { state: 'installed', path: '/y', live: true } }, r: { 'codex-cli': { state: 'held', reason: 'other' } }, s: {} } };
  // Only p: q is loaded live from its folder (never stale), r is another marketplace's, s isn't installed.
  assert.deepEqual(copiesToCompare(view, listed), ['p']);
  const map = new Map<string, Read<string>>();
  const releases = new Map<string, () => void>();
  let landed = 0;
  const turn = readInTurn(map, 2, () => { landed++; });
  const read = (key: string) => [key, () => new Promise<string>(resolve => releases.set(key, () => resolve(key)))] as [string, () => Promise<string>];
  map.set('known', { reading: false, value: 'kept' });
  turn.set([read('known'), read('a'), read('b'), read('c'), read('d')]);
  assert.deepEqual([...releases.keys()], ['a', 'b'], 'two at a time; one already read is not read again');
  assert.deepEqual(map.get('a'), { reading: true, quiet: true }, 'nothing on screen says it is reading');
  assert.equal(map.has('c'), false, 'one waiting has no placeholder yet');
  // A new list replaces what waits (c and d), and a read still under way carries on.
  turn.set([read('e')]);
  releases.get('a')!();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual([...releases.keys()], ['a', 'b', 'e']);
  assert.deepEqual(map.get('a'), { reading: false, value: 'a' });
  // A read whose placeholder went (a new view) is dropped when it lands.
  map.delete('b');
  releases.get('b')!();
  releases.get('e')!();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(map.has('b'), false);
  assert.equal(landed, 2);
});

test('A tool\'s installs say what is installed, what could not be checked and which marketplace could not be read', () => {
  const unsure: MarketplaceView = { ...entry, plugins: [{ name: 'p', description: '' }, { name: 'q', description: '' }], states: { p: { 'claude-cli': { state: 'installed', path: '/x' } }, q: { 'claude-cli': { state: 'not-known', reason: 'Its files are missing.' } } } };
  const broken: MarketplaceView = { ...entry, name: 'gone', plugins: [], states: {}, problem: 'Could not be reached.' };
  const installs = installsIn({ ...view, marketplaces: [unsure, broken] }, 'claude-cli')!;
  assert.deepEqual(installs.installed.map(({ plugin }) => plugin.name), ['p']);
  assert.deepEqual(installs.unknown.map(({ plugin, reason }) => [plugin.name, reason]), [['q', 'Its files are missing.']]);
  assert.deepEqual(installs.unreadable, ['gone']);
  assert.equal(installsIn(view, 'pi-cli'), null, 'a tool that takes no marketplace plugins');
});

test('A plugin every tool that can take it has comes first, one some tool has next, one no tool has last', () => {
  const at = (states: MarketplaceView['states']['p'], more: Partial<MarketplaceView> = {}): MarketplaceView => ({ ...entry, ...more, states: { p: states } });
  const here = { state: 'installed', path: '/x' } as const;
  assert.equal(pluginPlace(view, at({}), 'p'), 2);
  assert.equal(pluginPlace(view, at({ 'claude-cli': here }), 'p'), 1);
  assert.equal(pluginPlace(view, at({ 'claude-cli': here, 'copilot-cli': here, 'codex-cli': here }), 'p'), 0);
  // Off, its copy kept installed and off in Claude Code: no tool has it in use. Off there by his own switch while On: still in use.
  const switched = (on: boolean) => ({ switches: { p: { entry: { on, except: [] }, tools: {} } } });
  assert.deepEqual([pluginPlace(view, at({ 'claude-cli': { ...here, off: true } }, switched(false)), 'p'), pluginPlace(view, at({ 'claude-cli': { ...here, off: true } }, switched(true)), 'p')], [2, 1]);
  // A tool that can't take it (Copilot refuses the marketplace, or holds another of this name) doesn't keep it from the top.
  assert.equal(pluginPlace(view, at({ 'claude-cli': here, 'codex-cli': here }, { copilotRefuses: 'Copilot refuses npm.' }), 'p'), 0);
  assert.equal(pluginPlace(view, at({ 'claude-cli': here, 'copilot-cli': here, 'codex-cli': { state: 'held', reason: 'other' } }), 'p'), 0);
  // A tool that takes no plugins is no reason to wait.
  const withPi: PluginsView = { ...view, tools: [...view.tools, 'pi-cli'] };
  assert.equal(pluginPlace(withPi, at({ 'claude-cli': here, 'copilot-cli': here, 'codex-cli': here }), 'p'), 0);
});

test('A tool’s plugins are counted from its own record, each install once, the same wherever the person has been: an Anthropic Directory install is one, though a marketplace’s catalog also lists it as its own; no catalog read (or one that failed) is asked; “not known” only where that tool’s own record can’t be read', () => {
  const install = (tool: HarnessId, plugin: string, marketName: string) => ({ tool, plugin, marketName, listed: true, items: [] });
  // Claude Code has kit from the Directory (plugins.ts fromDirectory: a catalog that offers kit calls it installed from there) and
  // notes from a team marketplace; Copilot CLI has notes too.
  const home = { pluginItems: [install('claude-cli', 'kit', DIRECTORY), install('claude-cli', 'notes', 'team'), install('copilot-cli', 'notes', 'team')] };
  assert.deepEqual(['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'].map(tool => pluginsInstalled(home, tool as HarnessId)),
    [{ state: 'read', count: 2 }, { state: 'read', count: 1 }, { state: 'read', count: 0 }, { state: 'unsupported' }]);
  // Claude Code's installed_plugins.json can't be read: its count is not known, the others' are still theirs.
  const unread = { ...home, pluginRecordsUnread: ['claude-cli' as HarnessId] };
  assert.deepEqual([pluginsInstalled(unread, 'claude-cli'), pluginsInstalled(unread, 'copilot-cli')], [{ state: 'unknown' }, { state: 'read', count: 1 }]);
});

test('A plugin’s items in Pi are counted as Pi loads them: one its own settings keep out is said apart', () => {
  const entry = { items: { maps: { lines: [], on: { 'pi-cli': 2 }, keptOut: { 'pi-cli': 1 }, of: { 'pi-cli': 2 } } } } as unknown as MarketplaceView;
  assert.equal(itemsOnWords(entry, 'maps', 'pi-cli', ' there'), '1 of its 2 items is on there (Pi’s own settings keep 1 out)');
  assert.equal(itemsOnWords({ items: { maps: { lines: [], on: { 'pi-cli': 2 }, of: { 'pi-cli': 2 } } } } as unknown as MarketplaceView, 'maps', 'pi-cli'), '2 of its 2 items are on');
});

test('installsIn carries each tool’s own recorded version rather than the marketplace catalog’s, and none when the tool records no version', () => {
  const catalog: MarketplaceView = {
    ...entry,
    plugins: [
      { name: 'release-helper', description: '', version: '0.5.0' },
      { name: 'unversioned', description: '', version: '1.0.0' },
    ],
    states: {
      'release-helper': { 'claude-cli': { state: 'installed', path: '/x', version: '0.4.1' } },
      unversioned: { 'claude-cli': { state: 'installed', path: '/y' } },
    },
  };
  const installs = installsIn({ ...view, marketplaces: [catalog] }, 'claude-cli')!;
  assert.deepEqual(
    installs.installed.map(({ plugin, version }) => [plugin.name, version]),
    [['release-helper', '0.4.1'], ['unversioned', undefined]],
  );
});

test('installsIn carries each install’s real id (Anthropic Directory id when matched, else plugin@market)', () => {
  const catalog: MarketplaceView = {
    ...entry,
    name: 'official',
    plugins: [{ name: 'incident-io', description: '' }, { name: 'notes', description: '' }],
    states: {
      'incident-io': { 'claude-cli': { state: 'installed', path: '/x', directory: 'incident.io@anthropic-plugin-directory' } },
      notes: { 'claude-cli': { state: 'installed', path: '/y' } },
    },
  };
  const installs = installsIn({ ...view, marketplaces: [catalog] }, 'claude-cli')!;
  assert.deepEqual(
    installs.installed.map(item => [item.plugin.name, (item as { id?: string }).id]),
    [['incident-io', 'incident.io@anthropic-plugin-directory'], ['notes', 'notes@official']],
  );
});

test('Uninstall…’s question compares the tool’s copy with the marketplace’s as just read: comparing until it lands, then the same, different, or not known', () => {
  const copyIn = (text: string) => ({ skills: [{ name: 'a', description: '', path: 'skills/a', text }], commands: [], agents: [], instructions: [], version: '2.0.0' });
  const read = (codex: string, offered = true) => ({ ...copyIn('A'), offered, installed: { 'codex-cli': copyIn(codex) } }) as unknown as PluginDetail;
  // The marketplace's side read with its skill left out (its folder couldn't be read): the tool's skill has nothing to be compared with.
  const halfRead = { ...read('A'), skills: [] } as unknown as PluginDetail;
  const at: MarketplaceView = { ...entry, states: { p: { 'codex-cli': { state: 'installed', path: '/c', version: '2.0.0' }, 'claude-cli': { state: 'installed', path: '/m/p', live: true } } } };
  const copy = (detail: PluginDetail | null | undefined, tool: HarnessId = 'codex-cli') => uninstallFacts(at, { name: 'p', description: '', version: '2.0.0', folder: '/m/p' }, tool, detail).copy;
  assert.deepEqual([copy(undefined), copy(read('A')), copy(read('A edited by hand')), copy(null), copy(read('A', false)), copy(halfRead), copy(undefined, 'claude-cli')],
    ['comparing', 'same', 'differs', 'unknown', 'unknown', 'unknown', 'same']);
  // A plugin its bundled build carries no files for can't be installed again, as the install refuses it.
  const carried: MarketplaceView = { ...at, bundled: { app: 'Acme Knot', displayName: 'Acme plugins', release: 'r', unpackaged: [{ name: 'p', reason: 'It is an npm package.' }] } };
  assert.equal(uninstallFacts(carried, { name: 'p', description: '', version: '2.0.0', folder: '/m/p' }, 'codex-cli', undefined).cannot, 'not-carried');
});

test('Uninstall…’s question: one sentence on whether it can come back, then at most one on what is deleted, in every case', () => {
  const none: Parameters<typeof uninstallAsk>[2] = { cannot: undefined, app: undefined, version: undefined, offered: undefined, copy: 'same', ownSettings: false };
  const ask = (tool: HarnessId, facts: Partial<typeof none> = {}) => uninstallAsk('issue-tracker', tool, { ...none, ...facts });
  const cases: [string, string][] = [
    [ask('claude-cli', { copy: 'comparing' }), 'Comparing Claude Code’s copy…'],
    [ask('claude-cli'), 'Uninstall issue-tracker from Claude Code? It can be installed again; nothing is lost.'],
    [ask('claude-cli', { ownSettings: true }), 'Uninstall issue-tracker from Claude Code? It can be installed again; its saved options there are deleted for good.'],
    [ask('codex-cli', { ownSettings: true }), 'Uninstall issue-tracker from Codex? It can be installed again; its MCP servers’ settings there are deleted for good.'],
    [ask('claude-cli', { version: '1.1.0', offered: '1.2.0' }), 'Uninstall issue-tracker from Claude Code? Installing it again gives 1.2.0; this 1.1.0 can’t be brought back.'],
    [ask('codex-cli', { copy: 'differs', ownSettings: true }), 'Uninstall issue-tracker from Codex? Installing it again gives the marketplace’s copy; the edits to this one are lost. Its MCP servers’ settings there are deleted for good.'],
    [ask('copilot-cli', { copy: 'unknown' }), 'Uninstall issue-tracker from Copilot CLI? Installing it again gives the marketplace’s copy; if this one was edited, the edits are lost.'],
    [ask('claude-cli', { cannot: 'gone' }), 'Uninstall issue-tracker from Claude Code? It is no longer offered, so it can’t be installed again: there is no Undo.'],
    [ask('claude-cli', { cannot: 'kept', ownSettings: true }), 'Uninstall issue-tracker from Claude Code? It is no longer offered, so it can’t be installed again: there is no Undo. Its saved options there are deleted for good.'],
    [ask('claude-cli', { cannot: 'unread' }), 'Uninstall issue-tracker from Claude Code? Its marketplace can’t be read now, so there is no Undo.'],
    [ask('claude-cli', { cannot: 'not-carried', app: 'Acme Knot' }), 'Uninstall issue-tracker from Claude Code? Acme Knot doesn’t include its files, so it can’t be installed again: there is no Undo.'],
  ];
  for (const [said, wanted] of cases) assert.equal(said, wanted);
});

test('uninstallFacts and uninstallAsk say settings could not be read instead of promising nothing is lost', () => {
  const copy = { skills: [], commands: [], agents: [], instructions: [], version: '1.0.0' };
  const at: MarketplaceView = {
    ...entry,
    states: {
      p: {
        'claude-cli': { state: 'installed', path: '/c', version: '1.0.0' },
        'codex-cli': { state: 'installed', path: '/x', version: '1.0.0' },
        'copilot-cli': { state: 'installed', path: '/g', version: '1.0.0' },
      },
    },
  };
  const plugin = { name: 'p', description: '', version: '1.0.0', folder: '/m/p' };
  const claudeUnreadDetail = { ...copy, offered: true, installed: { 'claude-cli': { ...copy, ownSettings: 'unknown' } } } as unknown as PluginDetail;
  assert.equal(uninstallFacts(at, plugin, 'claude-cli', claudeUnreadDetail).ownSettings, 'unknown');
  assert.equal(uninstallFacts(at, plugin, 'codex-cli', null).ownSettings, 'unknown');
  assert.equal(uninstallFacts(at, plugin, 'claude-cli', { ...copy, offered: true, installed: {} } as unknown as PluginDetail).ownSettings, 'unknown');
  assert.equal(uninstallFacts(at, plugin, 'copilot-cli', null).ownSettings, false);

  const none: Parameters<typeof uninstallAsk>[2] = { cannot: undefined, app: undefined, version: undefined, offered: undefined, copy: 'same', ownSettings: 'unknown' };
  assert.equal(uninstallAsk('issue-tracker', 'claude-cli', none),
    'Uninstall issue-tracker from Claude Code? It can be installed again. Claude Code’s settings couldn’t be read; if it has saved options there, they are deleted for good.');
  assert.equal(uninstallAsk('issue-tracker', 'codex-cli', { ...none, copy: 'unknown' }),
    'Uninstall issue-tracker from Codex? Installing it again gives the marketplace’s copy; if this one was edited, the edits are lost. Codex’s settings couldn’t be read; if it has MCP servers’ settings there, they are deleted for good.');
  assert.equal(uninstallAsk('issue-tracker', 'claude-cli', { ...none, cannot: 'gone' }),
    'Uninstall issue-tracker from Claude Code? It is no longer offered, so it can’t be installed again: there is no Undo. Claude Code’s settings couldn’t be read; if it has saved options there, they are deleted for good.');
});

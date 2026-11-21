// Profiles as sets of library items, worked examples: the rules (profileplan.ts), a switch and its Undo on real files in a temp
// home with three tools (profiles.ts), which profile is in use as the library changes, and the move of a profiles file from
// before (profilemigrate.ts). The temp home has Claude Code, Copilot CLI and Codex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentsView, applyAgents } from '../src/agents.ts';
import { readHistory } from '../src/history.ts';
import { newItem, type ItemKind } from '../src/library.ts';
import { readTool, writeEntry } from '../src/mcp.ts';
import { mcpSwitchPath, withMcpSwitch } from '../src/mcpswitch.ts';
import { migrateProfiles } from '../src/profilemigrate.ts';
import { allTurns, entryTurns, homeItems, pluginItemOn, inUse, inUseName, leftOut, leftOutWords, liveItems, pluginItemsAgree, pluginLive, pluginPlan, pluginUndo, switchable, switchPlan, turnsWords, undoPlan, undoTurns, type Libraries } from '../src/profileplan.ts';
import { NO_PLUGINS, deleteProfile, liveNow, readProfiles, saveProfile, switchProfile, undoSwitch, type PluginSide } from '../src/profiles.ts';
import { readPluginItems } from '../src/pluginitems.ts';
import { runPlan, type PlanApi } from '../src/pluginplan.ts';
import { savePluginRecord } from '../src/pluginrecord.ts';
import { setPart, setSkill } from '../src/plugins.ts';
import type { PluginTool } from '../src/presence.ts';
import { applyServers, serversView } from '../src/servers.ts';
import { keepDenies } from '../src/serverstore.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { setDisabled } from '../src/skillswitch.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts, Profile, ThroughPlugin } from '../src/types.ts';
import { bytes, folderOf, put, sandbox, skillText, type Box, type Tool } from './skillclicks.ts';

// ---------- The rules ----------

const libraryOf = (items: [ItemKind, string, boolean, boolean?][]): Libraries => {
  const libraries: Libraries = { skill: {}, mcp: {}, agent: {} };
  for (const [kind, key, on, deleted] of items) libraries[kind][key] = { ...newItem(key, key), on, ...(deleted ? { deleted: { at: '' } } : {}) };
  return libraries;
};
const ids = (items: { id: string }[]) => items.map(item => item.id);
const profile = (name: string, items: string[]): Profile => ({ id: name, name, items });

test('A switch turns what the profile names On and every other library item Off; an id naming no live item is skipped', () => {
  const live = liveItems(libraryOf([['skill', 'dev', true], ['skill', 'pager', true], ['skill', 'gone', true, true], ['mcp', 'docs', false], ['agent', 'writer', true]]), new Set());
  assert.deepEqual(ids(live), ['skill:dev', 'skill:pager', 'mcp:docs', 'agent:writer'], 'a deleted item is not live');
  // skill:gone was deleted and skill:loose is only found in a tool: both skipped, and both stay in the profile.
  const turns = switchPlan(profile('Work', ['skill:dev', 'mcp:docs', 'skill:gone', 'skill:loose']), live);
  assert.deepEqual([ids(turns.on), ids(turns.off)], [['mcp:docs'], ['skill:pager', 'agent:writer']]);
  assert.equal(turnsWords(turns, 'will'), 'turns 1 item on and 2 off');
  assert.equal(turnsWords(turns, 'did'), '1 item turned on and 2 turned off');
  assert.equal(turnsWords({ on: [], off: [1] }, 'will'), 'turns 1 item off');
});

test('A profile is in use exactly while switching to it would change nothing: two with the same items both are, an empty one only while nothing is On', () => {
  const live = liveItems(libraryOf([['skill', 'dev', true], ['agent', 'writer', true], ['mcp', 'docs', false], ['skill', 'gone', false, true]]), new Set());
  const dev = profile('Dev', ['skill:dev', 'agent:writer']), same = profile('Same', ['agent:writer', 'skill:dev', 'skill:gone', 'skill:loose']);
  const all = profile('All', ['skill:dev', 'agent:writer', 'mcp:docs']), empty = profile('Empty', []);
  assert.deepEqual(inUse([dev, same, all, empty], live, []), [dev, same], 'ids naming no live item are skipped here too');
  assert.equal(inUseName([dev, same, all, empty], live, []), 'Dev and Same');
  assert.equal(inUseName([all, empty], live, []), 'No profile');
  const nothingOn = liveItems(libraryOf([['skill', 'dev', false]]), new Set());
  assert.deepEqual(inUse([dev, empty], nothingOn, []), [empty]);
  // A profile with nothing live in it is not offered to switch to: it would turn every item off.
  assert.deepEqual([dev, empty, profile('Gone', ['skill:gone', 'skill:loose'])].map(each => switchable(each, live, [])), [true, false, false]);
});

test('The Undo of a switch turns back each item still as the switch left it, decided from each item now', () => {
  const entry = { profile: { toName: 'Dev', on: [{ id: 'mcp:docs', name: 'docs' }], off: [{ id: 'skill:pager', name: 'pager' }, { id: 'skill:notes', name: 'notes' }, { id: 'agent:gone', name: 'gone' }] } };
  // Since the switch: pager was turned back on by hand, docs was turned off by hand, and agent gone was deleted.
  const live = liveItems(libraryOf([['skill', 'pager', true], ['skill', 'notes', false], ['mcp', 'docs', false], ['agent', 'gone', false, true]]), new Set());
  const back = undoPlan(entry, live);
  assert.deepEqual([ids(back.on), ids(back.off)], [['skill:notes'], []]);
  assert.deepEqual(undoPlan({ profile: { toName: 'Old' } }, live), { on: [], off: [] }, 'an entry from before profiles were sets of items has nothing to undo');
});

/** A plugin as the home records it (pluginrecord.ts PluginEntry), as the view carries it. */
type Recorded = { id: string; plugin: string; marketName: string; on: boolean };
/** A home's view as the Profiles page reads it: each kind's rows and library (types.ts LibraryView), the plugins installed whole and those recorded. */
function viewOf({ rows, library, installed = [], recorded = [], tools = ['claude-cli', 'pi-cli'] }: { rows: Record<ItemKind, LibraryFacts[]>; library: Libraries; installed?: InstalledPlugin[]; recorded?: Recorded[]; tools?: HarnessId[] }) {
  const kind = (which: ItemKind) => ({ tools, items: rows[which], library: library[which] });
  return { skills: kind('skill'), mcp: kind('mcp'), agents: kind('agent'), pluginItems: installed, profiles: { profiles: [], plugins: recorded } } as unknown as HomeView;
}
/** A row of the Library as the kind's view gives it: `plugin`, a tool with no copy of its own that has it through that plugin. */
const row = (key: string, plugin?: Partial<Record<HarnessId, ThroughPlugin>>): LibraryFacts => ({ key, name: key, description: '', copies: {}, on: false, except: [], cannot: {}, edited: [], ...(plugin ? { plugin } : {}) });

test('The Profiles page says what the Library lists that no profile can tick, items only found in a tool; a plugin’s items are ticked as the plugin’s', () => {
  // In Central Knot: notes (Claude Code also has it through document-tools, so that plugin's notes is notes' own row), pager,
  // and papa, which Pi has from the plugin pi-pack. document-tools brings pdf and forms into Claude Code: rows of their own.
  // Only found in a tool: the skill loose (deleted from Central Knot once, and a tool has it again) and the MCP server docs.
  const library = libraryOf([['skill', 'notes', true], ['skill', 'pager', false], ['skill', 'papa', true], ['skill', 'loose', true, true]]);
  library.skill.papa!.source = 'pi-pack-id';
  const throughDocs = { 'claude-cli': { plugin: 'document-tools', marketplace: 'team-tools' } };
  const home = viewOf({ library, recorded: [{ id: 'pi-pack-id', plugin: 'pi-pack', marketName: 'team-tools', on: true }],
    rows: { skill: [row('notes', throughDocs), row('pager'), row('papa'), row('loose')], mcp: [row('docs')], agent: [] },
    installed: [{ tool: 'claude-cli', plugin: 'document-tools', marketName: 'team-tools', listed: true, items: ['notes', 'pdf', 'forms'].map(name => ({ kind: 'skill', name, description: '' })) }] });
  assert.deepEqual(ids(homeItems(home)), ['skill:notes', 'skill:pager'], 'the person’s own items: what is in Central Knot, not linked to a plugin');
  assert.deepEqual(pluginLive(home).map(item => item.id).sort(), ['plugin:skill:document-tools@team-tools/forms', 'plugin:skill:document-tools@team-tools/notes',
    'plugin:skill:document-tools@team-tools/pdf', 'plugin:skill:pi-pack@team-tools/papa'], 'the plugins’ items, each listed as its plugin’s');
  assert.deepEqual(leftOut(home), { skill: 1, mcp: 1, agent: 0 });
  assert.equal(leftOutWords(leftOut(home)), 'Not listed here: 1 skill and 1 MCP server found in your tools that aren’t in Central Knot yet '
    + '(under Found in the Library, with Add on each that can be taken in).');
  assert.equal(leftOutWords({ skill: 1, mcp: 0, agent: 0 }),
    'Not listed here: 1 skill found in your tools that isn’t in Central Knot yet (under Found in the Library, with Add if it can be taken in).');

  // Everything in Central Knot; gone, deleted, still linked to pi-pack (no row anywhere); and a plugin's item only on a row of the
  // person's own: nothing left out.
  const kept = libraryOf([['skill', 'notes', true], ['skill', 'gone', false, true], ['agent', 'writer', false]]);
  kept.skill.gone!.source = 'pi-pack-id';
  const all = viewOf({ library: kept, recorded: [{ id: 'pi-pack-id', plugin: 'pi-pack', marketName: 'team-tools', on: true }],
    rows: { skill: [row('notes', throughDocs)], mcp: [], agent: [row('writer')] },
    installed: [{ tool: 'claude-cli', plugin: 'document-tools', marketName: 'team-tools', listed: true, items: [{ kind: 'skill', name: 'notes', description: '' }] }] });
  assert.deepEqual(ids(homeItems(all)), ['skill:notes', 'agent:writer']);
  assert.equal(leftOutWords(leftOut(all)), '', 'no line');
});

// ---------- A plugin's items: what a switch will change, tool by tool ----------
// document-tools from the marketplace team-tools brings the skills pdf-reader and spreadsheet (each in a folder of its name).
// Claude Code has no switch for one skill of a plugin; Codex has one; Pi takes no plugins, so it has the plugin's items placed,
// as library items linked to the plugin.

const DOCS: Recorded = { id: 'docs-id', plugin: 'document-tools', marketName: 'team-tools', on: true };
const pdfId = 'plugin:skill:document-tools@team-tools/pdf-reader', sheetId = 'plugin:skill:document-tools@team-tools/spreadsheet';
const skill = (name: string) => ({ kind: 'skill' as const, name, keyName: name, description: '' });
/** document-tools as one tool has it installed. */
const docsIn = (tool: HarnessId, extra: Partial<InstalledPlugin> = {}): InstalledPlugin =>
  ({ tool, plugin: 'document-tools', marketName: 'team-tools', listed: true, items: [skill('pdf-reader'), skill('spreadsheet')], ...extra });
/**
 * A home with Claude Code, Copilot CLI, Codex and Pi: `installed`, each tool's install of document-tools; `placed`, its skills in
 * Pi (linked to it unless `source` says otherwise); `own`, the person's own items; `mcp`, the MCP servers' rows of the Library;
 * `docs`, what the home records of document-tools beside DOCS.
 */
function docsHome(installed: InstalledPlugin[], placed: { key: string; on: boolean; except?: HarnessId[]; source?: string }[] = [], own: [ItemKind, string, boolean][] = [], mcp: LibraryFacts[] = [], docs: Partial<Recorded> = {}) {
  const library = libraryOf([...own, ...placed.map(({ key, on }): [ItemKind, string, boolean] => ['skill', key, on])]);
  for (const { key, except = [], ...item } of placed) Object.assign(library.skill[key]!, { except, source: 'source' in item ? item.source : DOCS.id });
  return viewOf({ library, recorded: [{ ...DOCS, ...docs }], installed, tools: ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'], rows: { skill: [], mcp, agent: [] } });
}
/** Each plugin item's copies, one word list per tool: "codex-cli on", or with how a switch meets it where that isn't its own switch. */
const copiesIn = (home: HomeView) => Object.fromEntries(pluginLive(home).map(item => [item.id, item.copies.map(copy => `${copy.tool} ${copy.on ? 'on' : 'off'}${copy.way === 'switch' ? '' : ` ${copy.way}`}`)]));

test('His case: a plugin’s skill in Claude Code, Codex and Pi turns off in Codex and Pi for a profile that leaves it out, stays on in Claude Code, and comes back for one that has it', () => {
  const work = profile('Work', [pdfId, sheetId]), other = profile('Other', [sheetId]);
  const before = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [{ key: 'pdf-reader', on: true }, { key: 'spreadsheet', on: true }]);
  assert.deepEqual(copiesIn(before)[pdfId], ['claude-cli on stays', 'codex-cli on', 'pi-cli on'], 'one item, whichever way each tool has it');
  assert.deepEqual([pluginItemsAgree(work, pluginLive(before)), pluginItemsAgree(other, pluginLive(before))], [true, false]);
  assert.deepEqual(pluginPlan(other, pluginLive(before)), [{ id: pdfId, on: false, turn: ['codex-cli', 'pi-cli'], held: [] }]);
  // What a switch acts on in each: the copy installed whole, as the Library's switch takes it (pluginswitch.ts); Pi's library item.
  assert.deepEqual(pluginLive(before).find(item => item.id === pdfId)!.copies.map(({ target }) => ('libraryKey' in target ? target : [target.tool, target.name])),
    [['claude-cli', 'pdf-reader'], ['codex-cli', 'pdf-reader'], { libraryKey: 'pdf-reader' }]);
  // As that switch leaves it: off by Codex's own switch, Pi's copy out (its library item Off), on in Claude Code.
  const after = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { skillsOff: ['pdf-reader'] })], [{ key: 'pdf-reader', on: false }, { key: 'spreadsheet', on: true }]);
  assert.deepEqual(copiesIn(after)[pdfId], ['claude-cli on stays', 'codex-cli off', 'pi-cli off']);
  assert.deepEqual([pluginItemsAgree(work, pluginLive(after)), pluginItemsAgree(other, pluginLive(after))], [false, true], 'Other agrees with Claude Code’s copy on');
  assert.deepEqual(pluginPlan(work, pluginLive(after)), [{ id: pdfId, on: true, turn: ['codex-cli', 'pi-cli'], held: [] }]);
  // The person's own items are none of these: the plugin's items are listed and switched as the plugin's.
  assert.deepEqual(ids(homeItems(after)), []);
});

test('A profile that leaves out one skill of a plugin turns that one alone: its sibling, and the plugin, are left as they are in every tool', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [{ key: 'pdf-reader', on: true }, { key: 'spreadsheet', on: true }]);
  assert.deepEqual(pluginPlan(profile('Sheets', [sheetId]), pluginLive(home)), [{ id: pdfId, on: false, turn: ['codex-cli', 'pi-cli'], held: [] }]);
});

test('A copy Pi edited, let go of its plugin, is the person’s own item: the plugin’s id goes dormant there, and his own is another id', () => {
  // The pass let pdf-reader go when Pi's copy was edited (library.ts A PLUGIN, let go): it is linked to nothing now.
  const work = profile('Work', [pdfId]);
  const piOnly = docsHome([], [{ key: 'pdf-reader', on: true, source: undefined }]);
  assert.deepEqual([pluginLive(piOnly), ids(homeItems(piOnly))], [[], ['skill:pdf-reader']]);
  assert.deepEqual([pluginPlan(work, pluginLive(piOnly)), pluginItemsAgree(work, pluginLive(piOnly))], [[], true], 'dormant: nothing to plan, nothing against it');
  // Where Codex still has the plugin installed, the plugin's item is Codex's alone.
  assert.deepEqual(copiesIn(docsHome([docsIn('codex-cli')], [{ key: 'pdf-reader', on: true, source: undefined }]))[pdfId], ['codex-cli on']);
});

test('A plugin’s item has an id of its own form, `plugin:` before its kind, which no item of the person’s own can have, whatever its name holds', () => {
  // His own server is named, letter for letter, as document-tools' issues is keyed.
  const home = docsHome([docsIn('codex-cli', { items: [{ kind: 'mcp', name: 'issues', description: '' }] })], [], [['mcp', 'document-tools@team-tools/issues', true]]);
  assert.deepEqual([ids(homeItems(home)), pluginLive(home).map(item => item.id)], [['mcp:document-tools@team-tools/issues'], ['plugin:mcp:document-tools@team-tools/issues']]);
});

test('Copilot CLI turns a server off by its bare name: a plugin’s server named exactly as another server there, the person’s own or another plugin’s, is held, and the other tools switch it', () => {
  const issues = { kind: 'mcp' as const, name: 'issues', description: '' }, issuesId = 'plugin:mcp:document-tools@team-tools/issues';
  const installs = [docsIn('copilot-cli', { items: [issues] }), docsIn('codex-cli', { items: [issues] })];
  /** The person's own server in Copilot CLI, spelled as its file has it (types.ts ToolCopy `folder`). */
  const mine = (spelled: string) => ({ ...row('issues'), copies: { 'copilot-cli': { folder: spelled } } }) as unknown as LibraryFacts;
  const quiet = profile('Quiet', ['mcp:issues']), plan = (home: HomeView) => pluginPlan(quiet, pluginLive(home)).map(each => [each.id, each.turn, each.held.map(held => `${held.tool}: ${held.why}`)]);
  assert.deepEqual(plan(docsHome(installs, [], [['mcp', 'issues', true]], [mine('issues')])),
    [[issuesId, ['codex-cli'], ['copilot-cli: Copilot CLI turns a server off by its name alone, and a server of your own there is named “issues” too.']]]);
  // Another plugin's server of that name there: both plugins' are held in Copilot CLI.
  const tracker: InstalledPlugin = { tool: 'copilot-cli', plugin: 'tracker', marketName: 'team-tools', listed: true, items: [issues] };
  assert.deepEqual(plan(docsHome([...installs, tracker])), [
    [issuesId, ['codex-cli'], ['copilot-cli: Copilot CLI turns a server off by its name alone, and tracker there has a server named “issues” too.']],
    ['plugin:mcp:tracker@team-tools/issues', [], ['copilot-cli: Copilot CLI turns a server off by its name alone, and document-tools there has a server named “issues” too.']],
  ]);
  // It goes by the exact spelling (mcpswitch.ts): his own Issues is another name there, so the plugin's issues switches there too.
  assert.deepEqual(plan(docsHome(installs, [], [['mcp', 'issues', true]], [mine('Issues')])), [[issuesId, ['copilot-cli', 'codex-cli'], []]]);
});

test('A plugin that is one skill at its root is one item installed and placed, though Pi has it under its folder’s name; not when the plugin has more than one skill placed', () => {
  // Claude Code read document-tools as one skill, SKILL.md at its root; Pi has it from the marketplace, named by its folder, bundle.
  const root = docsIn('claude-cli', { items: [{ kind: 'skill', name: 'docs-skill', keyName: 'document-tools', root: true, description: '' }] });
  const rootId = 'plugin:skill:document-tools@team-tools/document-tools';
  assert.deepEqual(copiesIn(docsHome([root], [{ key: 'bundle', on: true }])), { [rootId]: ['claude-cli on stays', 'pi-cli on'] });
  // Two skills placed are not that one skill (the marketplace's version is not the one installed): each keeps its own key.
  assert.deepEqual(Object.keys(copiesIn(docsHome([root], [{ key: 'bundle', on: true }, { key: 'forms', on: true }]))).sort(),
    [rootId, 'plugin:skill:document-tools@team-tools/bundle', 'plugin:skill:document-tools@team-tools/forms'].sort());
});

test('A copy placed in Pi is held while its plugin is Off on Plugins: a profile never turns on what the plugin’s Off turned off', () => {
  const off = docsHome([], [{ key: 'pdf-reader', on: false }, { key: 'spreadsheet', on: false }], [], [], { on: false });
  assert.deepEqual(copiesIn(off)[pdfId], ['pi-cli off plugin-off']);
  assert.deepEqual(pluginPlan(profile('Docs', [pdfId]), pluginLive(off)), [{ id: pdfId, on: true, turn: [], held: [{ tool: 'pi-cli', why: 'The whole plugin document-tools is off in Pi.' }] }]);
  assert.equal(pluginItemsAgree(profile('Empty', []), pluginLive(off)), true);
});

test('After an update drops a plugin’s skill and brings another, a profile still plans: the dropped one dormant, the new one turned off as one it leaves out', () => {
  const work = profile('Work', [pdfId, sheetId]), home = docsHome([docsIn('codex-cli', { items: [skill('spreadsheet'), skill('forms')] })]);
  assert.deepEqual(pluginPlan(work, pluginLive(home)), [{ id: 'plugin:skill:document-tools@team-tools/forms', on: false, turn: ['codex-cli'], held: [] }]);
  assert.equal(pluginItemsAgree(work, pluginLive(home)), false, 'not in use until switched again');
});

test('With the whole plugin off in Codex a switch changes nothing there: its items count as off, held for a profile that has them, agreeing with one that leaves them out', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { off: true })]);
  assert.deepEqual(copiesIn(home)[pdfId], ['claude-cli on stays', 'codex-cli off plugin-off']);
  const off = { tool: 'codex-cli', why: 'The whole plugin document-tools is off in Codex.' };
  assert.deepEqual(pluginPlan(profile('Docs', [pdfId, sheetId]), pluginLive(home)), [{ id: pdfId, on: true, turn: [], held: [off] }, { id: sheetId, on: true, turn: [], held: [off] }]);
  assert.equal(pluginItemsAgree(profile('Empty', []), pluginLive(home)), true);
  // Off in Claude Code too, where a skill has no switch of its own: off there, not left out of the reckoning as one that stays on.
  assert.deepEqual(copiesIn(docsHome([docsIn('claude-cli', { off: true })]))[pdfId], ['claude-cli off plugin-off']);
});

test('Which tools a profile switches a plugin’s item in: each with a switch for that one item; Pi and OpenCode where it isn’t kept out, Off too; one whose switch can’t be written held', () => {
  const agent = { kind: 'agent' as const, name: 'reviewer', keyName: 'reviewer', description: '' };
  const home = docsHome([docsIn('claude-cli', { items: [agent] }), docsIn('copilot-cli', { items: [agent] }), docsIn('codex-cli', { switchesHeld: 'Codex’s config.toml writes skills.config as a value.' })],
    [{ key: 'pdf-reader', on: false, except: [] }, { key: 'spreadsheet', on: true, except: ['pi-cli'] }, { key: 'forms', on: true }]);
  // forms is deleted, still linked to the plugin (library.ts A PLUGIN: a name of its own he deleted): in no tool.
  home.skills.library.forms!.deleted = { at: '' };
  assert.deepEqual(copiesIn(home), {
    'plugin:agent:document-tools@team-tools/reviewer': ['claude-cli on', 'copilot-cli on stays'],
    [pdfId]: ['codex-cli on held', 'pi-cli off'],
    [sheetId]: ['codex-cli on held'],
  });
  assert.deepEqual(pluginPlan(profile('Sheets', [sheetId]), pluginLive(home)).map(each => [each.id, each.turn, each.held.map(held => held.why)]), [
    ['plugin:agent:document-tools@team-tools/reviewer', ['claude-cli'], []],
    [pdfId, [], ['Codex’s config.toml writes skills.config as a value.']],
  ]);
});

test('A tool whose copy of the plugin can’t be read: what it has there isn’t known, so no profile is in use by its items, and a switch holds them there', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { items: [], problem: 'Its plugin.json can’t be read.' })]);
  assert.deepEqual(copiesIn(home)[pdfId], ['claude-cli on stays', 'codex-cli off unread']);
  const unread = { tool: 'codex-cli', why: 'Codex’s copy of document-tools couldn’t be read: Its plugin.json can’t be read.' };
  assert.deepEqual(pluginPlan(profile('Docs', [pdfId, sheetId]), pluginLive(home)), [{ id: pdfId, on: true, turn: [], held: [unread] }, { id: sheetId, on: true, turn: [], held: [unread] }]);
  assert.deepEqual([pluginItemsAgree(profile('Docs', [pdfId, sheetId]), pluginLive(home)), pluginItemsAgree(profile('Empty', []), pluginLive(home))], [false, false], 'neither way');
  // An item only the unread copy could have isn't known at all: nothing is listed for it.
  assert.deepEqual(pluginLive(docsHome([docsIn('codex-cli', { items: [], problem: 'Unreadable.' })])), []);
});

test('In use takes in the plugins’ items wherever a tool can switch them: two profiles that differ only by a skill Claude Code alone has are both in use', () => {
  const own: [ItemKind, string, boolean][] = [['skill', 'notes', true]];
  const claudeOnly = docsHome([docsIn('claude-cli')], [], own), live = homeItems(claudeOnly), plugins = pluginLive(claudeOnly);
  const work = profile('Work', ['skill:notes', pdfId, sheetId]), lean = profile('Lean', ['skill:notes']);
  assert.deepEqual(inUse([work, lean], live, plugins), [work, lean]);
  assert.equal(inUseName([work, lean], live, plugins), 'Work and Lean');
  // With Codex too, which can switch each skill: Lean leaves them out, and Codex has them on, so only Work is in use.
  const both = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [], own);
  assert.deepEqual(inUse([work, lean], homeItems(both), pluginLive(both)), [work]);
  // A profile of a plugin's items alone is offered to switch to; one naming only items no tool has is not.
  assert.deepEqual([switchable(profile('Docs', [pdfId]), [], pluginLive(both)), switchable(profile('Gone', ['plugin:skill:document-tools@team-tools/gone']), [], pluginLive(both))], [true, false]);
});

test('A switch’s count takes each plugin’s item once however many tools turn it, and an item only held is not counted as turned', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { skillsOff: ['spreadsheet'] })], [{ key: 'pdf-reader', on: true }, { key: 'spreadsheet', on: true }], [['skill', 'notes', true]]);
  const sheets = profile('Sheets', ['skill:notes', sheetId]), plan = pluginPlan(sheets, pluginLive(home));
  assert.deepEqual(plan.map(each => [each.id, each.on, each.turn]), [[pdfId, false, ['codex-cli', 'pi-cli']], [sheetId, true, ['codex-cli']]]);
  assert.equal(turnsWords(allTurns(switchPlan(sheets, homeItems(home)), plan), 'will'), 'turns 1 item on and 1 off');
  const off = docsHome([docsIn('codex-cli', { off: true })]);
  assert.deepEqual(allTurns(switchPlan(profile('Docs', [pdfId]), homeItems(off)), pluginPlan(profile('Docs', [pdfId]), pluginLive(off))), { on: [], off: [] });
  const held = docsHome([docsIn('codex-cli', { switchesHeld: 'Codex’s config.toml writes skills.config as a value.' })]), none = profile('None', ['skill:gone']);
  assert.deepEqual(allTurns(switchPlan(none, homeItems(held)), pluginPlan(none, pluginLive(held))), { on: [], off: [] }, 'held on, a profile that leaves them out turns none off');
});

test('The Undo of a switch turns back each plugin copy still as the switch left it and still the plugin’s; one changed since, or let go, is left', () => {
  const entry = { profile: { toName: 'Sheets', on: [], off: [], plugins: [
    { id: pdfId, name: 'pdf-reader', tool: 'codex-cli' as const, on: false }, { id: pdfId, name: 'pdf-reader', tool: 'pi-cli' as const, on: false }, { id: sheetId, name: 'spreadsheet', tool: 'pi-cli' as const, on: false }] } };
  // Since the switch: pdf-reader turned back on in Codex by hand; spreadsheet's Pi copy let go (his own now: no plugin copy).
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [{ key: 'pdf-reader', on: false }, { key: 'spreadsheet', on: false, source: undefined }]);
  const { back, left } = pluginUndo(entry, pluginLive(home));
  assert.deepEqual([back.map(turn => [turn.item.id, turn.copy.tool, turn.on]), left.map(({ copy, why }) => [copy.name, copy.tool, why])], [[[pdfId, 'pi-cli', true]], [['pdf-reader', 'codex-cli', 'changed since the switch'], ['spreadsheet', 'pi-cli', 'changed since the switch']]]);
  assert.deepEqual(undoTurns(entry, homeItems(home), pluginLive(home)), { on: [{ id: pdfId, on: true }], off: [] });
  assert.equal(turnsWords(entryTurns(entry.profile), 'did'), '2 items turned off', 'History says what the switch did, each item once');
  // The whole plugin turned off in Codex since: off there, as the switch left it, but no switch of that one item can put it back
  // (its click would turn the plugin on), so it is left.
  const pluginOff = docsHome([docsIn('codex-cli', { off: true })], [{ key: 'pdf-reader', on: false }]);
  assert.deepEqual(pluginUndo(entry, pluginLive(pluginOff)).back.map(turn => turn.copy.tool), ['pi-cli']);
});

test('His own server not in Copilot CLI now is compared with a plugin’s by its key: the spelling it gets back there isn’t known until it is written', () => {
  const issues = { kind: 'mcp' as const, name: 'issues', description: '' }, issuesId = 'plugin:mcp:document-tools@team-tools/issues';
  const home = docsHome([docsIn('copilot-cli', { items: [issues] }), docsIn('codex-cli', { items: [issues] })], [], [['mcp', 'issues', false]]);
  home.mcp.library.issues!.name = 'Issues';
  assert.deepEqual(pluginPlan(profile('Mine', ['mcp:issues']), pluginLive(home)).map(each => [each.id, each.turn, each.held.map(held => held.tool)]), [[issuesId, ['codex-cli'], ['copilot-cli']]]);
});

test('A plugin’s item is on, for Start from what’s on now and the row alike, where a tool switches it: Claude Code’s copy that stays on doesn’t count while Codex has it off', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { skillsOff: ['pdf-reader'] })]);
  assert.deepEqual(pluginLive(home).map(item => [item.id, pluginItemOn(item)]), [[pdfId, false], [sheetId, true]]);
  const fromNow = profile('From now', pluginLive(home).filter(pluginItemOn).map(item => item.id));
  assert.deepEqual(inUse([fromNow], homeItems(home), pluginLive(home)), [fromNow], 'started from what is on, it is in use');
  // A skill only Claude Code has, which no tool switches: on where it is.
  assert.equal(pluginItemOn(pluginLive(docsHome([docsIn('claude-cli')]))[0]!), true);
});

test('A tool whose copy of a plugin can’t be read is unknown only for the kinds it loads: Codex loads no plugin’s agents, so its unread copy blocks no agent', () => {
  const agent = { kind: 'agent' as const, name: 'reviewer', keyName: 'reviewer', description: '' };
  const home = docsHome([docsIn('claude-cli', { items: [skill('pdf-reader'), agent] }), docsIn('codex-cli', { items: [], problem: 'Unreadable.' })]);
  assert.deepEqual(copiesIn(home), { [pdfId]: ['claude-cli on stays', 'codex-cli off unread'], 'plugin:agent:document-tools@team-tools/reviewer': ['claude-cli on'] });
});

// ---------- A switch on real files ----------

type Three = 'claude-cli' | 'copilot-cli' | 'codex-cli';
const tools: Three[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const MCP: Record<Three, string> = { 'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml' };
const SETTINGS: Record<Three, string> = { 'claude-cli': '.claude/settings.json', 'copilot-cli': '.copilot/settings.json', 'codex-cli': '.codex/config.toml' };
const AGENTS: Record<Three, string> = { 'claude-cli': '.claude/agents/writer.md', 'copilot-cli': '.copilot/agents/writer.agent.md', 'codex-cli': '.codex/agents/writer.toml' };
const text = (box: Box, path: string) => readFile(join(box.home, path), 'utf8').catch(() => undefined);
/** A server's entry in each tool (its content, and its own fields), and the rest of each settings file without it. */
const entries = async (box: Box, name: string) => Object.fromEntries(await Promise.all(tools.map(async tool => {
  const entry = (await readTool(box.context, tool)).entries.find(each => each.name === name), file = await text(box, MCP[tool]);
  return [tool, { entry: entry && { hash: entry.hash, own: entry.extras }, rest: file && writeEntry(file, tool, name, undefined) }] as const;
})));
/** Every file the home's items live in, as a test compares them: skill folders byte for byte, agent files, settings files. */
const everything = async (box: Box, skills: string[], servers: string[]) => ({
  skills: Object.fromEntries(await Promise.all(skills.flatMap(name => tools.map(async tool => [`${tool}/${name}`, await bytes(folderOf(box, tool, name))] as const)))),
  servers: Object.fromEntries(await Promise.all(servers.map(async name => [name, await entries(box, name)] as const))),
  agents: await Promise.all(tools.map(tool => text(box, AGENTS[tool]))),
  settings: await Promise.all(tools.map(tool => (tool === 'codex-cli' ? undefined : text(box, SETTINGS[tool])))),
});
const history = async (box: Box) => readHistory(box.context);
const live = (box: Box) => liveNow(box.context);
const names = (items: { name: string }[]) => items.map(item => item.name);

/**
 * A home where everything is in Central Knot and On: skills dev and pager in every tool, the server sentry (Codex has fields of
 * its own; kept out of Copilot CLI), and the agent writer.
 */
async function home() {
  const box = await sandbox(tools);
  for (const name of ['dev', 'pager']) for (const tool of tools) await put(box, tool, { 'SKILL.md': skillText(`The ${name} skill.`, name) }, [], name);
  await writeFile(join(box.home, MCP['claude-cli']), `${JSON.stringify({ numStartups: 3, mcpServers: { sentry: { type: 'stdio', command: 'sentry', timeout: 30 } } }, null, 2)}\n`);
  await writeFile(join(box.home, MCP['codex-cli']), 'model = "gpt-6"\n\n[mcp_servers.sentry]\ncommand = "sentry"\n# mine\nstartup_timeout_sec = 9\n');
  await writeFile(join(box.home, SETTINGS['claude-cli']), '{\n  "theme": "dark"\n}\n');
  for (const tool of tools) await mkdir(join(box.home, AGENTS[tool], '..'), { recursive: true });
  await writeFile(join(box.home, AGENTS['claude-cli']), '---\nname: writer\ndescription: Writes docs\nmodel: opus\n---\n\nYou write docs.\n');
  await applySkills(box.context, box.tools, [{ key: 'dev', on: true, except: [] }, { key: 'pager', on: true, except: [] }]);
  await applyServers(box.context, box.tools, [{ key: 'sentry', on: true, except: ['copilot-cli'] }]);
  await applyAgents(box.context, box.tools, [{ key: 'writer', on: true, except: [] }]);
  const made = async (name: string, items: string[]) => (await saveProfile(box.context, { name, items })).id!;
  return { box, made, profiles: async () => (await readProfiles(box.home)).profiles };
}

test('Switching turns what a profile leaves out Off in one History entry, Claude Code’s server too, and switching back puts every file back', async () => {
  const { box, made, profiles } = await home();
  try {
    const before = await everything(box, ['dev', 'pager'], ['sentry']), entriesBefore = (await history(box)).length;
    const dev = await made('Dev', ['skill:dev', 'agent:writer']);
    const switched = await switchProfile(box.context, box.tools, dev, NO_PLUGINS);
    assert.deepEqual([switched.stopped, switched.on, switched.off, switched.results], [undefined, [], ['pager', 'sentry'], []]);
    // One entry, the switch's: the items' own Off entries are not written for it.
    const told = (await history(box)).slice(entriesBefore);
    assert.deepEqual(told.map(entry => [entry.kind, entry.item, names(entry.profile?.off ?? [])]), [['profile', 'Dev', ['pager', 'sentry']]]);
    assert.deepEqual(await Promise.all(tools.map(tool => bytes(folderOf(box, tool, 'pager')))), [undefined, undefined, undefined]);
    const sentry = await entries(box, 'sentry');
    assert.deepEqual([sentry['claude-cli'].entry, sentry['codex-cli'].entry], [undefined, undefined], 'out of Claude Code and Codex at once');
    assert.deepEqual((await inUse(await profiles(), await live(box), [])).map(each => each.name), ['Dev']);
    // Switching to the profile in use changes nothing, and writes no entry.
    const count = (await history(box)).length;
    const again = await switchProfile(box.context, box.tools, dev, NO_PLUGINS);
    assert.deepEqual([again.event, (await history(box)).length], [undefined, count]);
    // Back: each item On where it was, sentry still kept out of Copilot CLI, every file as before.
    const all = await made('All', ['skill:dev', 'skill:pager', 'mcp:sentry', 'agent:writer']);
    const back = await switchProfile(box.context, box.tools, all, NO_PLUGINS);
    assert.deepEqual([back.on, back.off], [['pager', 'sentry'], []]);
    assert.deepEqual(await everything(box, ['dev', 'pager'], ['sentry']), before);
    assert.deepEqual((await inUse(await profiles(), await live(box), [])).map(each => each.name), ['All']);
  } finally { await box.cleanup(); }
});

test('A server whose entry Claude Code lost while its removal was owed (as alpha 2 left it) turns Off again in the switch that turns it On: the result says so, and History says why', async () => {
  const { box, made, profiles } = await home();
  try {
    // The switch's removal from Claude Code is left owed (its file can't be read meanwhile), as alpha 2 left it.
    await chmod(join(box.home, MCP['claude-cli']), 0o000);
    try { await switchProfile(box.context, box.tools, await made('Dev', ['skill:dev', 'agent:writer']), NO_PLUGINS); } finally { await chmod(join(box.home, MCP['claude-cli']), 0o644); }
    // Claude Code rewrote its file without servers before a pass took sentry out.
    await writeFile(join(box.home, MCP['claude-cli']), `${JSON.stringify({ numStartups: 4 })}\n`);
    const back = await switchProfile(box.context, box.tools, await made('All', ['skill:dev', 'skill:pager', 'mcp:sentry', 'agent:writer']), NO_PLUGINS);
    assert.deepEqual([back.on, back.off, back.left], [['pager'], [], ['sentry']]);
    assert.equal(inUseName(await profiles(), await live(box), []), 'No profile');
    assert.deepEqual((await history(box)).slice(-2).map(entry => [entry.kind, entry.item, entry.cause]), [['profile', 'All', undefined], ['off', 'sentry', 'deleted-by-hand']]);
  } finally { await box.cleanup(); }
});

test('Undo of a switch turns back only what is still as the switch left it, each with its own entry', async () => {
  const { box, made } = await home();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Notes.', 'notes') }, [], 'notes');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await applyServers(box.context, box.tools, [{ key: 'sentry', on: false, except: ['copilot-cli'], seenOn: true }]);
    // Dev turns sentry On and pager and notes Off.
    const switched = await switchProfile(box.context, box.tools, await made('Dev', ['skill:dev', 'mcp:sentry', 'agent:writer']), NO_PLUGINS);
    assert.deepEqual([switched.on, switched.off], [['sentry'], ['pager', 'notes']]);
    // Since then, by hand: pager On again, sentry Off again.
    await applySkills(box.context, box.tools, [{ key: 'pager', on: true, except: [], seenOn: false }]);
    await applyServers(box.context, box.tools, [{ key: 'sentry', on: false, except: ['copilot-cli'], seenOn: true }]);
    const count = (await history(box)).length;
    const undone = await undoSwitch(box.context, box.tools, switched.event!, NO_PLUGINS);
    assert.deepEqual([undone.stopped, undone.switched], [undefined, { on: ['notes'], off: [], left: [] }]);
    const items = Object.fromEntries((await live(box)).map(item => [item.name, item.on]));
    assert.deepEqual([items.notes, items.pager, items.sentry], [true, true, false], 'pager and sentry stay as the person left them');
    const after = await history(box);
    assert.deepEqual(after.slice(count).map(entry => [entry.kind, entry.item]), [['on', 'notes']]);
    assert.equal(after.find(entry => entry.id === switched.event)?.undoneBy, after.at(-1)!.id);
    assert.match((await undoSwitch(box.context, box.tools, switched.event!, NO_PLUGINS)).stopped ?? '', /nothing to undo/);
  } finally { await box.cleanup(); }
});

test('Which profile is in use follows the library: Delete, a hand click, an item taken in or pulled, a copy deleted by hand; a newer or unreadable profiles file is left alone', async () => {
  const { box, made, profiles } = await home();
  const name = async () => inUseName(await profiles(), await live(box), []);
  try {
    await switchProfile(box.context, box.tools, await made('Dev', ['skill:dev', 'agent:writer']), NO_PLUGINS);
    await made('Also dev', ['agent:writer', 'skill:dev', 'skill:pager', 'skill:never-taken-in']);
    assert.equal(await name(), 'Dev', 'Also dev names pager, which is Off');
    await applySkills(box.context, box.tools, [{ key: 'pager', on: false, except: [], deleted: true }]);
    assert.equal(await name(), 'Dev and Also dev', 'an id naming an item since deleted, or never taken in, is skipped');
    await applyAgents(box.context, box.tools, [{ key: 'writer', on: false, except: [], seenOn: true }]);
    assert.equal(await name(), 'No profile', 'a hand click');
    await applyAgents(box.context, box.tools, [{ key: 'writer', on: true, except: [], seenOn: false }]);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('New.', 'fresh') }, [], 'fresh');
    await applySkills(box.context, box.tools, [{ key: 'fresh', on: true, except: [] }]);
    assert.equal(await name(), 'No profile', 'an item taken in is On and in no profile');
    await applySkills(box.context, box.tools, [{ key: 'fresh', on: true, except: [], deleted: true }]);
    await applyServers(box.context, box.tools, [], { pulled: new Map([['pulled', { name: 'pulled', server: { transport: 'stdio', command: 'pulled' } }]]) });
    assert.equal(await name(), 'No profile', 'a server new here that Pull brings is On and in no profile');
    await applyServers(box.context, box.tools, [{ key: 'pulled', on: true, except: [], deleted: true }]);
    assert.equal(await name(), 'Dev and Also dev');
    await rm(folderOf(box, 'codex-cli', 'dev'), { recursive: true });
    await applySkills(box.context, box.tools, []);
    assert.equal(await name(), 'No profile', 'a copy deleted by hand turns its item Off');
    // A profiles file this Central Knot can't use is reported and never written.
    for (const file of ['{ not json', '{ "formatVersion": 3, "profiles": [] }']) {
      await writeFile(join(box.home, '.central-knot/profiles.json'), file);
      assert.ok((await readProfiles(box.home)).problem);
      assert.ok((await saveProfile(box.context, { name: 'Other' })).problem);
      assert.ok((await switchProfile(box.context, box.tools, 'Dev', NO_PLUGINS)).stopped);
      assert.equal(await text(box, '.central-knot/profiles.json'), file);
    }
  } finally { await box.cleanup(); }
});

test('Profiles save only the fields given, a deleted one comes back with its id, deleting one changes no item, and a switch waits for Resume', async () => {
  const { box, made, profiles } = await home();
  try {
    const dev = await made('Development', ['skill:dev']);
    // A plugin's item is kept by its own form, `plugin:` before its kind (profileplan.ts pluginItemId); a plugin of no kind is not.
    await saveProfile(box.context, { id: dev, items: ['skill:dev', 'agent:writer', 'plugin:skill:document-tools@team-tools/pdf', 'plugin:tool:x', 'nonsense', 'tool:x'] });
    await saveProfile(box.context, { id: dev, name: '  Dev   work ' });
    assert.deepEqual(await profiles(), [{ id: dev, name: 'Dev work', items: ['skill:dev', 'agent:writer', 'plugin:skill:document-tools@team-tools/pdf'] }]);
    assert.equal((await saveProfile(box.context, { name: 'dev WORK' })).problem, 'There is already a profile called “dev WORK”.');
    const before = await live(box);
    await switchProfile(box.context, box.tools, dev, NO_PLUGINS);
    const on = await live(box);
    await deleteProfile(box.context, dev);
    assert.deepEqual([await profiles(), await live(box)], [[], on]);
    assert.notDeepEqual(on, before);
    await saveProfile(box.context, { id: dev, name: 'Dev work', items: ['skill:dev'], restore: true });
    assert.equal((await profiles())[0]?.id, dev);
    // A record this app has no memory of: every pass would refuse, so the switch refuses first and writes no entry.
    await applySkills(box.context, box.tools, [{ key: 'pager', on: true, except: [], seenOn: false }]);
    const count = (await history(box)).length;
    const resumeFirst = await switchProfile({ ...box.context, settingsPath: join(box.home, 'elsewhere.json') }, box.tools, dev, NO_PLUGINS);
    assert.match(resumeFirst.stopped ?? '', /no memory of it.*Nothing was switched\./);
    assert.deepEqual([(await history(box)).length, (await live(box)).find(item => item.key === 'pager')?.on], [count, true]);
  } finally { await box.cleanup(); }
});

// ---------- A plugin's items, switched on real files ----------
// docs@team brings the skills pdf-reader and spreadsheet and the MCP server issues. Claude Code and Codex have it installed, from
// the marketplace /m; Pi takes no plugins, so its skills are placed there as library items linked to it. A switch plans from the
// home as the page read it (sideNow) and turns each copy by its own switch: Codex's rule in config.toml, Pi's library item.

const DOCS_ID = 'docs-id', docsId = (kind: ItemKind, key: string) => `plugin:${kind}:docs@team/${key}`;
const CODEX_BEFORE = '[marketplaces.team]\nsource = "/m"\n\n[plugins."docs@team"]\nenabled = true\n';
const putFile = async (path: string, body: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, body); };

/**
 * docs@team installed in Claude Code and Codex and placed in Pi; with `copilot`, installed in Copilot CLI too, beside a server of
 * the person's own named issues there; with `opencode`, placed in OpenCode too.
 */
async function pluginHome({ copilot = false, opencode = false } = {}) {
  const box = await sandbox(['claude-cli', 'codex-cli', 'pi-cli', ...(copilot ? ['copilot-cli' as const] : []), ...(opencode ? ['opencode-cli' as const] : [])]);
  const copyIn = async (folder: string) => {
    for (const name of ['pdf-reader', 'spreadsheet']) await putFile(join(folder, 'skills', name, 'SKILL.md'), skillText(`The ${name} skill.`, name));
    await putFile(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }));
    await putFile(join(folder, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'docs', version: '1.0.0' }));
    await putFile(join(folder, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'docs', version: '1.0.0', skills: './skills', mcpServers: './.mcp.json' }));
  };
  const market = { team: { source: { source: 'directory', path: '/m' } } }, claude = join(box.home, '.claude/plugins/cache/team/docs/1.0.0');
  await copyIn(claude);
  await putFile(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'docs@team': [{ scope: 'user', installPath: claude, version: '1.0.0' }] } }));
  await putFile(join(box.home, '.claude/settings.json'), `${JSON.stringify({ extraKnownMarketplaces: market, enabledPlugins: { 'docs@team': true } }, null, 2)}\n`);
  await copyIn(join(box.home, '.codex/plugins/cache/team/docs/1.0.0'));
  await putFile(join(box.home, '.codex/config.toml'), CODEX_BEFORE);
  if (copilot) {
    const cache = join(box.home, '.copilot/installed-plugins/team/docs');
    await copyIn(cache);
    await putFile(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'docs', marketplace: 'team', version: '1.0.0', cache_path: cache, enabled: true }] }));
    await putFile(join(box.home, '.copilot/settings.json'), `${JSON.stringify({ extraKnownMarketplaces: market }, null, 2)}\n`);
    await putFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { command: 'mine' } } }, null, 2)}\n`);
  }
  // Placed in Pi: each skill taken in from Pi alone, then linked to the plugin, as the plugin's own run leaves them (pluginlibrary.ts).
  for (const name of ['pdf-reader', 'spreadsheet']) await put(box, 'pi-cli', { 'SKILL.md': skillText(`The ${name} skill.`, name) }, [], name);
  await applySkills(box.context, ['pi-cli'], ['pdf-reader', 'spreadsheet'].map(key => ({ key, on: true, except: [] })));
  const record = join(box.home, '.central-knot/skills.json'), stored = JSON.parse(await readFile(record, 'utf8'));
  for (const key of ['pdf-reader', 'spreadsheet']) Object.assign(stored.items[key], { source: DOCS_ID, seen: stored.items[key].hash });
  await writeFile(record, JSON.stringify(stored));
  await savePluginRecord(box.home, { tools: box.tools, plugins: [{ id: DOCS_ID, source: '/m', marketName: 'team', plugin: 'docs', on: true, except: [] }] });
  // OpenCode's copies, as a pass places an item that is On in each tool it isn't kept out of.
  if (opencode) await applySkills(box.context, box.tools, []);
  const made = async (name: string, items: string[]) => (await saveProfile(box.context, { name, items })).id!;
  return { box, made };
}

/**
 * The home as the page reads it, for the profiles (homeItems, pluginLive), and what a switch is given of the plugins' items:
 * planned from that one read, each copy turned through its tool's own switch (plugins.ts setSkill, setPart), as main.ts pluginSide does.
 */
async function sideNow(box: Box) {
  const context = { ...box.context, dataDir: join(box.base, 'data'), binaries: {} };
  const view = { pluginItems: await readPluginItems(context, box.tools), profiles: await readProfiles(box.home), skills: await skillsView(box.context, box.tools),
    mcp: await serversView(box.context, box.tools), agents: await agentsView(box.context, box.tools) } as unknown as HomeView;
  const plugins = pluginLive(view), never = async () => { throw new Error('A profile never installs or uninstalls.'); };
  const api: PlanApi = { install: never, uninstall: never,
    setSkill: async (source, marketName, plugin, skill, tool, on) => ({ reports: [await setSkill(context, marketName, plugin, skill, tool as PluginTool, on, source)] }),
    setPart: async (source, marketName, plugin, part, tool, on) => ({ reports: [await setPart(context, marketName, plugin, part, tool as PluginTool, on, source)] }) };
  const side: PluginSide = { live: async () => plugins, run: async ops => (await runPlan(ops, api, box.home)).done };
  return { plugins, side, inUse: async () => inUse((await readProfiles(box.home)).profiles, homeItems(view), plugins).map(each => each.name) };
}
/** The files a plugin's items live in: Codex's and Claude Code's settings, and each skill's folder in Pi. */
const pluginFiles = async (box: Box) => ({ codex: await text(box, '.codex/config.toml'), claude: await text(box, '.claude/settings.json'),
  pi: { 'pdf-reader': await bytes(folderOf(box, 'pi-cli', 'pdf-reader')), spreadsheet: await bytes(folderOf(box, 'pi-cli', 'spreadsheet')) } });
const pdfOffInCodex = `${CODEX_BEFORE}\n[[skills.config]]\nname = "docs:pdf-reader"\nenabled = false\n`;

test('His case on real files: a plugin’s skill left out by a profile goes off in Codex by its own rule and out of Pi, stays on in Claude Code, its sibling and the plugin untouched; that profile is in use; switching back puts every file back', async () => {
  const { box, made } = await pluginHome();
  try {
    const work = await made('Work', [docsId('skill', 'pdf-reader'), docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]), other = await made('Other', [docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]);
    const before = await pluginFiles(box), first = await sideNow(box);
    assert.deepEqual(await first.inUse(), ['Work']);
    const switched = await switchProfile(box.context, box.tools, other, first.side);
    assert.deepEqual([switched.on, switched.off, switched.left, switched.results], [[], ['pdf-reader'], [], []]);
    const after = await pluginFiles(box);
    assert.deepEqual([after.codex, after.pi['pdf-reader'], after.pi.spreadsheet, after.claude], [pdfOffInCodex, undefined, before.pi.spreadsheet, before.claude],
      'Codex’s rule for pdf-reader alone (the plugin still enabled), Pi’s copy out, spreadsheet and Claude Code as they were');
    assert.deepEqual((await history(box)).at(-1)!.profile, { toName: 'Other', on: [], off: [], plugins: [
      { id: docsId('skill', 'pdf-reader'), name: 'pdf-reader', tool: 'codex-cli', on: false }, { id: docsId('skill', 'pdf-reader'), name: 'pdf-reader', tool: 'pi-cli', on: false }] });
    const now = await sideNow(box);
    assert.deepEqual(await now.inUse(), ['Other']);
    assert.deepEqual(now.plugins.find(item => item.id === docsId('skill', 'pdf-reader'))!.copies.map(copy => [copy.tool, copy.on, copy.way]), [['claude-cli', true, 'stays'], ['codex-cli', false, 'switch'], ['pi-cli', false, 'switch']]);
    const back = await switchProfile(box.context, box.tools, work, now.side);
    assert.deepEqual([back.on, back.off, back.results], [['pdf-reader'], [], []]);
    assert.deepEqual(await pluginFiles(box), before);
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Work']);
  } finally { await box.cleanup(); }
});

test('Undo of a switch after Codex was changed by hand: Pi’s copy comes back, Codex is left as the person left it and said, and nothing is left to undo', async () => {
  const { box, made } = await pluginHome();
  try {
    await made('Work', [docsId('skill', 'pdf-reader'), docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]);
    const before = await pluginFiles(box);
    const switched = await switchProfile(box.context, box.tools, await made('Other', [docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]), (await sideNow(box)).side);
    await writeFile(join(box.home, '.codex/config.toml'), CODEX_BEFORE);
    const undone = await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.stopped, undone.switched], [undefined, { on: ['pdf-reader'], off: [], left: [], since: ['pdf-reader in Codex, changed since the switch'] }]);
    assert.deepEqual(await pluginFiles(box), before, 'Pi’s copy back; Codex as the person left it, which is as before');
    assert.match((await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side)).stopped ?? '', /nothing to undo/i);
  } finally { await box.cleanup(); }
});

test('A copy Pi edited is the person’s own: a switch writes nothing over it, and turns the plugin’s item in Codex alone', async () => {
  const { box, made } = await pluginHome();
  try {
    // Edited just before the switch, so the switch's own pass lets it go (library.ts A PLUGIN): its click is then not taken.
    await writeFile(join(folderOf(box, 'pi-cli', 'pdf-reader'), 'SKILL.md'), skillText('Mine now.', 'pdf-reader'));
    const mine = await bytes(folderOf(box, 'pi-cli', 'pdf-reader')), other = await made('Other', [docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]);
    const switched = await switchProfile(box.context, box.tools, other, (await sideNow(box)).side);
    // History: the switch, with Codex's copy alone; Pi's copy let go as his own; his edit kept as its version.
    assert.deepEqual([switched.off, switched.left, (await history(box)).map(entry => [entry.kind, entry.cause, entry.profile?.plugins?.map(copy => copy.tool)]).slice(-3)],
      [['pdf-reader'], ['pdf-reader'], [['profile', undefined, ['codex-cli']], ['edit', 'own-now', undefined], ['edit', undefined, undefined]]]);
    assert.deepEqual([await text(box, '.codex/config.toml'), await bytes(folderOf(box, 'pi-cli', 'pdf-reader'))], [pdfOffInCodex, mine]);
    // From then on the plugin's item is Codex's copy alone; his own pdf-reader is another id, which Other leaves out.
    assert.deepEqual((await sideNow(box)).plugins.find(item => item.id === docsId('skill', 'pdf-reader'))!.copies.map(copy => copy.tool), ['claude-cli', 'codex-cli']);
  } finally { await box.cleanup(); }
});

test('A copy already as asked when its switch runs (turned by hand after the plan was read) is not recorded, so the Undo leaves it', async () => {
  const { box, made } = await pluginHome();
  try {
    const other = await made('Other', [docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]), side = (await sideNow(box)).side;
    await writeFile(join(box.home, '.codex/config.toml'), pdfOffInCodex);
    const switched = await switchProfile(box.context, box.tools, other, side);
    assert.deepEqual([switched.off, switched.left, switched.results, (await history(box)).at(-1)!.profile?.plugins?.map(copy => copy.tool)], [['pdf-reader'], [], [], ['pi-cli']], 'neither a change nor a failure');
    await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
    assert.equal(await text(box, '.codex/config.toml'), pdfOffInCodex, 'off by hand before the switch, it stays off');
  } finally { await box.cleanup(); }
});

test('A tool whose write fails is said, and is in neither the History entry nor its Undo; the other tools are switched', async () => {
  const { box, made } = await pluginHome();
  try {
    // Codex's folder can't be written: its config.toml is replaced through a file beside it (share.ts writeFileChecked).
    const codex = join(box.home, '.codex'), other = await made('Other', [docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]), side = (await sideNow(box)).side;
    await chmod(codex, 0o555);
    let switched;
    try { switched = await switchProfile(box.context, box.tools, other, side); } finally { await chmod(codex, 0o755); }
    assert.deepEqual([switched.off, switched.left, switched.results.map(result => [result.harness, result.outcome])], [['pdf-reader'], ['pdf-reader'], [['codex-cli', 'failed']]]);
    assert.deepEqual([await text(box, '.codex/config.toml'), await bytes(folderOf(box, 'pi-cli', 'pdf-reader'))], [CODEX_BEFORE, undefined]);
    assert.deepEqual((await history(box)).at(-1)!.profile?.plugins?.map(copy => copy.tool), ['pi-cli']);
    const undone = await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.switched, await text(box, '.codex/config.toml')], [{ on: ['pdf-reader'], off: [], left: [] }, CODEX_BEFORE]);
  } finally { await box.cleanup(); }
});

test('Copilot CLI’s server sharing its name with one of the person’s own is left on there and said; Claude Code and Codex turn it off by their own switches', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    const copilotBefore = await text(box, '.copilot/settings.json');
    const switched = await switchProfile(box.context, box.tools, await made('Quiet', [docsId('skill', 'pdf-reader'), docsId('skill', 'spreadsheet')]), (await sideNow(box)).side);
    assert.deepEqual([switched.off, switched.results.map(result => [result.harness, result.outcome, result.message])], [['issues'],
      [['copilot-cli', 'held', 'issues: Copilot CLI turns a server off by its name alone, and a server of your own there is named “issues” too.']]]);
    assert.deepEqual([await text(box, '.copilot/settings.json'), await text(box, '.codex/config.toml'), JSON.parse((await text(box, '.claude/settings.json'))!).deniedMcpServers],
      [copilotBefore, `${CODEX_BEFORE}\n[plugins."docs@team".mcp_servers.issues]\nenabled = false\n`, [{ serverName: 'plugin:docs:issues' }]]);
    assert.deepEqual(await (await sideNow(box)).inUse(), [], 'held in Copilot CLI, so not in use');
  } finally { await box.cleanup(); }
});

test('After an update drops a skill and brings another, a switch runs without error: the dropped one dormant in the profile, the new one turned off', async () => {
  const { box, made } = await pluginHome();
  try {
    const work = await made('Work', [docsId('skill', 'pdf-reader'), docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]);
    for (const cache of ['.claude/plugins/cache/team/docs/1.0.0', '.codex/plugins/cache/team/docs/1.0.0']) {
      await rm(join(box.home, cache, 'skills/spreadsheet'), { recursive: true });
      await putFile(join(box.home, cache, 'skills/forms/SKILL.md'), skillText('Forms.', 'forms'));
    }
    // The update's read let Pi's spreadsheet go as dropped: Off, linked to nothing (librarypass.ts).
    const record = join(box.home, '.central-knot/skills.json'), stored = JSON.parse(await readFile(record, 'utf8'));
    Object.assign(stored.items.spreadsheet, { on: false, source: undefined });
    await writeFile(record, JSON.stringify(stored));
    const switched = await switchProfile(box.context, box.tools, work, (await sideNow(box)).side);
    assert.deepEqual([switched.stopped, switched.on, switched.off, switched.results], [undefined, [], ['forms'], []]);
    assert.equal(await text(box, '.codex/config.toml'), `${CODEX_BEFORE}\n[[skills.config]]\nname = "docs:forms"\nenabled = false\n`);
    assert.deepEqual((await readProfiles(box.home)).profiles.find(each => each.id === work)?.items, [docsId('skill', 'pdf-reader'), docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')], 'the dropped one stays named, dormant');
  } finally { await box.cleanup(); }
});

test('With the whole plugin off in Codex a switch writes nothing there: it is off there for a profile that leaves it out, and held for one that has it', async () => {
  const { box, made } = await pluginHome();
  try {
    const off = CODEX_BEFORE.replace('enabled = true', 'enabled = false');
    await writeFile(join(box.home, '.codex/config.toml'), off);
    const other = await switchProfile(box.context, box.tools, await made('Other', [docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]), (await sideNow(box)).side);
    // Off in Codex counts as off there: pdf-reader agrees with leaving it out; Other's two, which Codex can't turn on, are held.
    assert.deepEqual([other.off, other.results.map(result => result.message), await text(box, '.codex/config.toml'), await bytes(folderOf(box, 'pi-cli', 'pdf-reader'))],
      [['pdf-reader'], ['spreadsheet: The whole plugin docs is off in Codex.', 'issues: The whole plugin docs is off in Codex.'], off, undefined]);
    const work = await switchProfile(box.context, box.tools, await made('Work', [docsId('skill', 'pdf-reader'), docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]), (await sideNow(box)).side);
    assert.deepEqual([work.on, work.results.map(result => result.message)], [['pdf-reader'], ['pdf-reader: The whole plugin docs is off in Codex.', 'spreadsheet: The whole plugin docs is off in Codex.', 'issues: The whole plugin docs is off in Codex.']]);
    assert.deepEqual([await text(box, '.codex/config.toml'), await (await sideNow(box)).inUse()], [off, []]);
  } finally { await box.cleanup(); }
});

// ---------- A plugin's items: the fix round's examples, on real files ----------

const pdfId2 = docsId('skill', 'pdf-reader'), sheetId2 = docsId('skill', 'spreadsheet'), issuesId2 = docsId('mcp', 'issues');

test('A switch that turns his own Copilot CLI server on leaves the plugin’s server of that name on there, and says so: Copilot CLI turns a server off by its name alone', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    // His own issues, taken in for Copilot CLI alone, then turned Off: not there now.
    const others: HarnessId[] = ['claude-cli', 'codex-cli', 'pi-cli'];
    await applyServers(box.context, box.tools, [{ key: 'issues', on: true, except: others }]);
    await applyServers(box.context, box.tools, [{ key: 'issues', on: false, except: others, seenOn: true }]);
    assert.equal(JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues, undefined);
    const switched = await switchProfile(box.context, box.tools, await made('Mine', ['mcp:issues', pdfId2, sheetId2]), (await sideNow(box)).side);
    assert.deepEqual(switched.results.map(result => [result.harness, result.outcome, result.message]),
      [['copilot-cli', 'held', 'issues: Copilot CLI turns a server off by its name alone, and a server of your own there is named “issues” too.']]);
    assert.deepEqual([JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues?.command, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers],
      ['mine', undefined], 'his own server back, and no rule that would turn it off');
  } finally { await box.cleanup(); }
});

test('A placed copy counts as turned only in the tools whose own removal went through: Pi’s folder not writable, OpenCode’s copy goes, Pi’s stays, and History has OpenCode', async () => {
  const { box, made } = await pluginHome({ opencode: true });
  try {
    const other = await made('Other', [sheetId2, issuesId2]), side = (await sideNow(box)).side, pi = join(box.home, '.pi/agent/skills');
    await chmod(pi, 0o555);
    let switched;
    try { switched = await switchProfile(box.context, box.tools, other, side); } finally { await chmod(pi, 0o755); }
    assert.deepEqual([!!(await bytes(folderOf(box, 'pi-cli', 'pdf-reader'))), await bytes(folderOf(box, 'opencode-cli', 'pdf-reader'))], [true, undefined]);
    assert.deepEqual((await history(box)).find(entry => entry.id === switched.event)!.profile?.plugins?.map(copy => copy.tool), ['codex-cli', 'opencode-cli']);
  } finally { await box.cleanup(); }
});

test('An Undo is one History entry, the switch marked undone by it, whether it turned back installed copies alone or a placed copy too', async () => {
  const { box, made } = await pluginHome();
  try {
    const undoOnce = async (profile: string) => {
      const switched = await switchProfile(box.context, box.tools, profile, (await sideNow(box)).side), count = (await history(box)).length;
      await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
      const after = await history(box), entry = after.at(-1)!;
      return [after.length - count, after.find(each => each.id === switched.event)!.undoneBy === entry.id, entry.kind, entry.profile?.undoOf === switched.event, entry.profile?.plugins?.map(copy => copy.tool)];
    };
    // issues alone: installed in Claude Code and Codex.
    assert.deepEqual(await undoOnce(await made('Quiet', [pdfId2, sheetId2])), [1, true, 'profile', true, ['claude-cli', 'codex-cli']]);
    // pdf-reader: Codex's own switch, and Pi's placed copy (no library entry of its own).
    assert.deepEqual(await undoOnce(await made('Other', [sheetId2, issuesId2])), [1, true, 'profile', true, ['codex-cli', 'pi-cli']]);
  } finally { await box.cleanup(); }
});

test('An Undo turns a placed copy off only in the tools its switch turned it on in: OpenCode, let in since, keeps its copy (kept out of Pi alone)', async () => {
  const { box, made } = await pluginHome({ opencode: true });
  try {
    const keepOut = (except: HarnessId[], seenOn: boolean) => applySkills(box.context, box.tools, [{ key: 'pdf-reader', on: seenOn, except, seenOn, forPlugin: DOCS_ID }]);
    await keepOut(['opencode-cli'], true);
    await switchProfile(box.context, box.tools, await made('Other', [sheetId2, issuesId2]), (await sideNow(box)).side);
    const work = await switchProfile(box.context, box.tools, await made('Work', [pdfId2, sheetId2, issuesId2]), (await sideNow(box)).side);
    await keepOut([], true);
    assert.ok(await bytes(folderOf(box, 'opencode-cli', 'pdf-reader')), 'let into OpenCode after the switch');
    const undone = await undoSwitch(box.context, box.tools, work.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.switched?.off, await bytes(folderOf(box, 'pi-cli', 'pdf-reader')), !!(await bytes(folderOf(box, 'opencode-cli', 'pdf-reader'))), await text(box, '.codex/config.toml')],
      [['pdf-reader'], undefined, true, pdfOffInCodex]);
  } finally { await box.cleanup(); }
});

test('An Undo names each placed copy it left and why: edited by hand since, so his own now; deleted by hand since', async () => {
  for (const [hand, why] of [['edit', 'edited by hand since, so it is your own now'], ['delete', 'deleted by hand since']] as const) {
    const { box, made } = await pluginHome();
    try {
      await switchProfile(box.context, box.tools, await made('Other', [sheetId2, issuesId2]), (await sideNow(box)).side);
      const work = await switchProfile(box.context, box.tools, await made('Work', [pdfId2, sheetId2, issuesId2]), (await sideNow(box)).side);
      if (hand === 'edit') await writeFile(join(folderOf(box, 'pi-cli', 'pdf-reader'), 'SKILL.md'), skillText('Mine now.', 'pdf-reader'));
      else await rm(folderOf(box, 'pi-cli', 'pdf-reader'), { recursive: true });
      const undone = await undoSwitch(box.context, box.tools, work.event!, (await sideNow(box)).side);
      assert.deepEqual([undone.switched?.off, undone.switched?.left, undone.switched?.since], [['pdf-reader'], [], [`pdf-reader in Pi, ${why}`]], hand);
    } finally { await box.cleanup(); }
  }
});

test('A profile whose every difference is held is not switched, and says why in words the page and the menus share', async () => {
  const { box, made } = await pluginHome();
  try {
    await writeFile(join(box.home, '.codex/config.toml'), CODEX_BEFORE.replace('enabled = true', 'enabled = false'));
    const switched = await switchProfile(box.context, box.tools, await made('Docs', [pdfId2, sheetId2, issuesId2]), (await sideNow(box)).side);
    assert.equal(switched.stopped, 'docs is off in Codex, so 3 of its items can’t be switched from here. Nothing was switched.');
  } finally { await box.cleanup(); }
});

test('A disable rule an earlier switch wrote for the plugin’s server goes when a switch turns his own server of that name on: Quiet, then Dev, then Undo, and his server is never both there and disabled', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    const others: HarnessId[] = ['claude-cli', 'codex-cli', 'pi-cli'];
    await applyServers(box.context, box.tools, [{ key: 'issues', on: true, except: others }]);
    await applyServers(box.context, box.tools, [{ key: 'issues', on: false, except: others, seenOn: true }]);
    const copilot = async () => ({ his: !!JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues, disabled: JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers ?? [] });
    await switchProfile(box.context, box.tools, await made('Quiet', [pdfId2, sheetId2]), (await sideNow(box)).side);
    assert.deepEqual(await copilot(), { his: false, disabled: ['issues'] }, 'Quiet: neither, so the plugin’s goes off by its name');
    const dev = await switchProfile(box.context, box.tools, await made('Dev', ['mcp:issues', pdfId2, sheetId2]), (await sideNow(box)).side);
    assert.deepEqual([await copilot(), dev.results.map(result => [result.harness, result.outcome])], [{ his: true, disabled: [] }, [['copilot-cli', 'held']]], 'Dev: his back, and the rule gone');
    await undoSwitch(box.context, box.tools, dev.event!, (await sideNow(box)).side);
    const after = await copilot();
    assert.ok(!(after.his && after.disabled.includes('issues')), JSON.stringify(after));
  } finally { await box.cleanup(); }
});

test('An Undo’s History row counts all it put back, his own items and the plugins’', async () => {
  const { box, made } = await pluginHome();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Notes.', 'notes') }, [], 'notes');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    const switched = await switchProfile(box.context, box.tools, await made('Other', [sheetId2, issuesId2]), (await sideNow(box)).side);
    await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
    const undo = (await history(box)).find(entry => entry.profile?.undoOf === switched.event)!;
    assert.equal(turnsWords(entryTurns(undo.profile!), 'did'), '2 items turned on');
    assert.match((await undoSwitch(box.context, box.tools, undo.id, (await sideNow(box)).side)).stopped ?? '', /nothing to undo/i, 'an Undo’s own row has no Undo');
  } finally { await box.cleanup(); }
});

// ---------- A profiles file from before ----------

/**
 * A home as the earlier Central Knot left it with the profile Dev in use: what Dev left out was turned off by each tool's own
 * switch, and `offByProfile` lists those switches.
 *   pager   left out, held off in every tool                 → Off; its switches cleared; its folders taken out
 *   half    held off in Claude Code only (on in the others)  → stays On; Claude Code's switch cleared
 *   back    held off in every tool, then turned back on in Codex by hand (still listed) → stays On; the others cleared
 *   mine    switched off in Codex by hand (not listed)       → stays as it is, switch and all
 *   fresh   taken in since the last switch                   → stays On
 *   loose   only found in Codex, held off there              → its switch cleared, nothing else
 *   sentry  held off in every tool: Claude Code's deny, Copilot CLI's list, Codex's `enabled = false` in its table
 *           → Off; every switch cleared (Codex's before its entry goes), and its entries taken out by the same pass
 *   docs    held off in Codex only                           → stays On; Codex's switch cleared
 *   writer  an agent, On                                     → joins every profile
 */
async function oldHome(active?: string) {
  const box = await sandbox(tools);
  for (const name of ['pager', 'half', 'back', 'mine', 'fresh']) for (const tool of tools) await put(box, tool, { 'SKILL.md': skillText(`The ${name} skill.`, name) }, [], name);
  await put(box, 'codex-cli', { 'SKILL.md': skillText('Loose.', 'loose') }, [], 'loose');
  const entry = { 'claude-cli': { type: 'stdio', command: 'x' }, 'copilot-cli': { type: 'local', command: 'x', tools: ['*'] } };
  const servers = (tool: 'claude-cli' | 'copilot-cli') => ({ sentry: { ...entry[tool], command: 'sentry' }, docs: { ...entry[tool], command: 'docs' } });
  await writeFile(join(box.home, MCP['claude-cli']), `${JSON.stringify({ mcpServers: servers('claude-cli') }, null, 2)}\n`);
  await writeFile(join(box.home, MCP['copilot-cli']), `${JSON.stringify({ mcpServers: servers('copilot-cli') }, null, 2)}\n`);
  await writeFile(join(box.home, MCP['codex-cli']), 'model = "gpt-6"\n\n[mcp_servers.sentry]\ncommand = "sentry"\nstartup_timeout_sec = 9\n\n[mcp_servers.docs]\ncommand = "docs"\n');
  for (const tool of tools) await mkdir(join(box.home, AGENTS[tool], '..'), { recursive: true });
  await writeFile(join(box.home, AGENTS['claude-cli']), '---\nname: writer\ndescription: Writes docs\n---\n\nYou write docs.\n');
  await applySkills(box.context, box.tools, ['pager', 'half', 'back', 'mine'].map(key => ({ key, on: true, except: [] })));
  await applyServers(box.context, box.tools, ['sentry', 'docs'].map(key => ({ key, on: true, except: [] })));
  await applyAgents(box.context, box.tools, [{ key: 'writer', on: true, except: [] }]);
  // The switches, as the earlier profile switch (and the person, for mine) set them.
  const skillOff = (tool: Tool, name: string) => setDisabled(box.context, tool, { folder: name, name, skillFile: join(folderOf(box, tool, name), 'SKILL.md') }, true);
  for (const tool of tools) await skillOff(tool, 'pager');
  for (const tool of ['claude-cli', 'copilot-cli'] as const) await skillOff(tool, 'back');
  await skillOff('claude-cli', 'half');
  await skillOff('codex-cli', 'mine');
  await skillOff('codex-cli', 'loose');
  const serverOff = async (tool: Tool, name: string) => writeFile(mcpSwitchPath(box.context, tool), withMcpSwitch(tool, await readFile(mcpSwitchPath(box.context, tool), 'utf8').catch(() => ''), name, true));
  for (const tool of tools) await serverOff(tool, 'sentry');
  await serverOff('codex-cli', 'docs');
  await applySkills(box.context, box.tools, [{ key: 'fresh', on: true, except: [] }]);
  const old = { formatVersion: 1, profiles: [{ id: 'dev', name: 'Dev', items: ['skill:half', 'skill:mine', 'mcp:docs'] }, { id: 'all', name: 'All', items: ['skill:pager', 'mcp:Sentry'] }],
    ...(active ? { active } : {}), offByProfile: { 'skill:pager': tools, 'skill:half': ['claude-cli'], 'skill:back': tools, 'skill:loose': ['codex-cli'], 'mcp:sentry': tools, 'mcp:docs': ['codex-cli'] } };
  await writeFile(join(box.home, '.central-knot/profiles.json'), `${JSON.stringify(old, null, 2)}\n`);
  return { box, old: await text(box, '.central-knot/profiles.json') };
}
/** Every file the old home's items live in, by path, as text (a folder: its files). */
async function files(box: Box) {
  const found: Record<string, unknown> = {};
  for (const tool of tools) {
    for (const name of ['pager', 'half', 'back', 'mine', 'fresh', 'loose']) found[`${tool} skill ${name}`] = await bytes(folderOf(box, tool, name));
    found[`${tool} mcp`] = await text(box, MCP[tool]);
    found[`${tool} settings`] = await text(box, SETTINGS[tool]);
    found[`${tool} agent`] = await text(box, AGENTS[tool]);
  }
  return found;
}
const changed = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));

test('Migration clears the switches profiles set and turns Off only what they held off in every tool; one pass after it writes nothing', async () => {
  const { box, old } = await oldHome('dev');
  try {
    const before = await files(box);
    await migrateProfiles(box.context, box.tools);
    const after = await files(box);
    // Changed: the settings that held the listed switches (Codex's config.toml holds its skill rules and servers), the MCP files
    // the server Off was taken out of, and pager's folders.
    assert.deepEqual(changed(before, after), ['claude-cli skill pager', 'claude-cli mcp', 'claude-cli settings', 'copilot-cli skill pager', 'copilot-cli mcp', 'copilot-cli settings', 'codex-cli skill pager', 'codex-cli mcp', 'codex-cli settings']);
    const claude = JSON.parse(after['claude-cli settings'] as string);
    assert.deepEqual([claude.skillOverrides ?? {}, claude.deniedMcpServers], [{}, undefined], 'pager’s, half’s and back’s overrides cleared, and sentry’s deny, as every tool’s switch');
    assert.deepEqual([Object.keys(JSON.parse(after['claude-cli mcp'] as string).mcpServers), await text(box, '.central-knot/claude-denies.json')], [['docs'], undefined], 'no deny kept for later');
    assert.deepEqual(JSON.parse(after['copilot-cli settings'] as string), {}, 'Copilot CLI’s lists emptied');
    assert.deepEqual(Object.keys(JSON.parse(after['copilot-cli mcp'] as string).mcpServers), ['docs']);
    const codex = after['codex-cli mcp'] as string;
    assert.match(codex, /\[mcp_servers\.docs\]\ncommand = "docs"\n\n\[\[skills/, 'docs’s switch cleared; sentry’s entry gone');
    assert.deepEqual(['sentry', 'pager/SKILL.md', 'loose/SKILL.md', 'mine/SKILL.md'].map(word => codex.includes(word)), [false, false, false, true], 'mine’s switch, set by hand, stays');
    const items = Object.fromEntries((await live(box)).map(item => [item.id, item.on]));
    assert.deepEqual(items, { 'skill:back': true, 'skill:half': true, 'skill:mine': true, 'skill:pager': false, 'skill:fresh': true, 'mcp:docs': true, 'mcp:sentry': false, 'agent:writer': true });
    // The old file is kept; the new one has no holds and no profile in use, MCP servers by key, and the agent On in each profile.
    assert.equal(await text(box, '.central-knot/profiles.v1.json'), old);
    assert.deepEqual(JSON.parse((await text(box, '.central-knot/profiles.json'))!), { formatVersion: 2, profiles: [
      { id: 'dev', name: 'Dev', items: ['skill:half', 'skill:mine', 'mcp:docs', 'agent:writer'] }, { id: 'all', name: 'All', items: ['skill:pager', 'mcp:sentry', 'agent:writer'] }] });
    const [told] = (await history(box)).filter(entry => entry.kind === 'profile');
    assert.deepEqual([told.item, told.profile?.migrated, names(told.profile?.off ?? [])], ['Dev', true, ['pager', 'sentry']]);
    // Once moved, nothing is left to do: the migration and a pass write nothing more.
    await migrateProfiles(box.context, box.tools);
    for (const pass of [applySkills, applyServers, applyAgents]) assert.equal((await pass(box.context, box.tools, [])).writes, 0);
    assert.deepEqual(await files(box), after);
  } finally { await box.cleanup(); }
});

test('Migration: a server held off in Codex and Claude Code comes back on with its entry in each, switched on', async () => {
  const { box } = await oldHome('dev');
  try {
    await migrateProfiles(box.context, box.tools);
    await applyServers(box.context, box.tools, [{ key: 'sentry', on: true, except: [], seenOn: false }]);
    assert.match((await text(box, MCP['codex-cli']))!, /\[mcp_servers\.sentry\]\ncommand = "sentry"\nstartup_timeout_sec = 9\n$/);
    assert.deepEqual([!!(await entries(box, 'sentry'))['claude-cli'].entry, JSON.parse((await text(box, SETTINGS['claude-cli']))!).deniedMcpServers], [true, undefined]);
  } finally { await box.cleanup(); }
});

test('A list of Claude Code denies an earlier build’s migration kept is drained: each deny stays while its server is Off, and goes once it is wanted in Claude Code', async () => {
  const { box } = await oldHome();
  try {
    // What such a build left: sentry Off with its deny in Claude Code's settings, listed as kept.
    await applyServers(box.context, box.tools, [{ key: 'sentry', on: false, except: [], seenOn: true }]);
    await keepDenies(box.home, ['sentry']);
    const denied = async () => JSON.parse((await text(box, SETTINGS['claude-cli']))!).deniedMcpServers ?? [];
    await applyServers(box.context, box.tools, []);
    assert.deepEqual([await denied(), await text(box, '.central-knot/claude-denies.json')], [[{ serverName: 'sentry' }], '["sentry"]\n']);
    await applyServers(box.context, box.tools, [{ key: 'sentry', on: true, except: [], seenOn: false }]);
    assert.deepEqual([await denied(), await text(box, '.central-knot/claude-denies.json'), !!(await entries(box, 'sentry'))['claude-cli'].entry], [[], '[]\n', true]);
  } finally { await box.cleanup(); }
});

test('Migration: the first switch after it turns no agent Off, and an old file with no profile in use moves the same way', async () => {
  const { box } = await oldHome();
  try {
    await migrateProfiles(box.context, box.tools);
    const [told] = (await history(box)).filter(entry => entry.kind === 'profile');
    assert.deepEqual([told.item, told.profile?.toName], ['Profiles', undefined]);
    const switched = await switchProfile(box.context, box.tools, 'dev', NO_PLUGINS);
    assert.deepEqual([switched.stopped, switched.on, switched.off], [undefined, [], ['back', 'fresh']]);
    assert.equal((await live(box)).find(item => item.id === 'agent:writer')?.on, true);
    assert.equal(inUseName((await readProfiles(box.home)).profiles, await live(box), []), 'Dev');
    // Undo of the migration's entry turns back on what it turned off.
    const undone = await undoSwitch(box.context, box.tools, told.id, NO_PLUGINS);
    assert.deepEqual(undone.switched?.on, ['pager', 'sentry']);
  } finally { await box.cleanup(); }
});

test('Migration waits where a pass may not write, and does nothing to a file it can’t read', async () => {
  const { box, old } = await oldHome('dev');
  try {
    const before = await files(box);
    await migrateProfiles({ ...box.context, settingsPath: join(box.home, 'elsewhere.json') }, box.tools);
    assert.deepEqual([await files(box), await text(box, '.central-knot/profiles.json')], [before, old], 'a record this app has no memory of waits for Resume');
    assert.ok((await saveProfile(box.context, { name: 'New' })).problem, 'an old file is not edited before it is moved');
    await writeFile(join(box.home, '.central-knot/profiles.json'), '{ not json');
    await migrateProfiles(box.context, box.tools);
    assert.deepEqual([await files(box), await text(box, '.central-knot/profiles.json')], [before, '{ not json']);
  } finally { await box.cleanup(); }
});

// ---------- A profiles file from before, with copies that are not there now ----------

/**
 * A home where a format 1 profile held switches off whose copies are gone now: docs held off in Claude Code (its deny) and in
 * Codex (`enabled = false` in its table), then turned Off and written out of Claude Code, so Codex's own part keeps the switch;
 * web held off in Codex, then kept out of Codex; pager held off in Codex (its rule, by path), then turned Off.
 */
async function goneHome() {
  const box = await sandbox(tools);
  for (const tool of tools) await put(box, tool, { 'SKILL.md': skillText('The pager skill.', 'pager') }, [], 'pager');
  await writeFile(join(box.home, MCP['claude-cli']), `${JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: 'docs' } } }, null, 2)}\n`);
  await writeFile(join(box.home, MCP['codex-cli']), 'model = "gpt-6"\n\n[mcp_servers.docs]\ncommand = "docs"\nstartup_timeout_sec = 9\n\n[mcp_servers.web]\ncommand = "web"\n');
  await applySkills(box.context, box.tools, [{ key: 'pager', on: true, except: [] }]);
  await applyServers(box.context, box.tools, ['docs', 'web'].map(key => ({ key, on: true, except: [] })));
  const serverOff = async (tool: Three, name: string) => writeFile(mcpSwitchPath(box.context, tool), withMcpSwitch(tool, await readFile(mcpSwitchPath(box.context, tool), 'utf8').catch(() => ''), name, true));
  await serverOff('claude-cli', 'docs'); await serverOff('codex-cli', 'docs'); await serverOff('codex-cli', 'web');
  await setDisabled(box.context, 'codex-cli', { folder: 'pager', name: 'pager', skillFile: join(folderOf(box, 'codex-cli', 'pager'), 'SKILL.md') }, true);
  await writeFile(join(box.home, '.central-knot/profiles.json'), `${JSON.stringify({ formatVersion: 1, profiles: [{ id: 'all', name: 'All', items: ['mcp:docs', 'mcp:web', 'skill:pager'] }],
    offByProfile: { 'mcp:docs': ['claude-cli', 'codex-cli'], 'mcp:web': ['codex-cli'], 'skill:pager': ['codex-cli'] } }, null, 2)}\n`);
  // Then, in the earlier build: docs and pager Off (and docs written out of Claude Code), web kept out of Codex.
  await applyServers(box.context, box.tools, [{ key: 'docs', on: false, except: [], seenOn: true }, { key: 'web', on: true, except: ['codex-cli'], seenOn: true }]);
  await applySkills(box.context, box.tools, [{ key: 'pager', on: false, except: [], seenOn: true }]);
  return box;
}

test('Migration releases a profile’s switch on a copy that is not there now: in a server’s kept own part, in Claude Code’s and Codex’s settings; turned On again, nothing is left switched off', async () => {
  const box = await goneHome();
  try {
    assert.deepEqual([(await entries(box, 'docs'))['codex-cli'].entry, (await entries(box, 'web'))['codex-cli'].entry, await bytes(folderOf(box, 'codex-cli', 'pager'))], [undefined, undefined, undefined]);
    await migrateProfiles(box.context, box.tools);
    // Claude Code's deny goes at once, as every tool's switch, and nothing is kept for later.
    assert.deepEqual([JSON.parse((await text(box, SETTINGS['claude-cli']))!).deniedMcpServers, await text(box, '.central-knot/claude-denies.json')], [undefined, undefined]);
    await switchProfile(box.context, box.tools, 'all', NO_PLUGINS);
    await applyServers(box.context, box.tools, [{ key: 'web', on: true, except: [], seenOn: true }]);
    const servers = await serversView(box.context, box.tools), skills = await skillsView(box.context, box.tools);
    assert.deepEqual(['docs', 'web'].map(key => servers.items.find(row => row.key === key)?.switchedOff ?? []), [[], []]);
    assert.deepEqual(Object.values(skills.items.find(row => row.key === 'pager')?.loads ?? {}).map(at => at?.switchedOff), [false, false, false]);
    assert.match((await text(box, MCP['codex-cli']))!, /\[mcp_servers\.docs\]\ncommand = "docs"\nstartup_timeout_sec = 9\n/, 'Codex’s other own field stays');
  } finally { await box.cleanup(); }
});

test('Migration with Automatic sync off leaves an item that stays On to the ordinary sync rule: a waiting hand edit is not copied', async () => {
  const box = await sandbox(['claude-cli', 'codex-cli']);
  try {
    await put(box, 'claude-cli');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await setDisabled(box.context, 'claude-cli', { folder: 'notes', name: 'notes', skillFile: join(folderOf(box, 'claude-cli'), 'SKILL.md') }, true);
    await writeFile(join(box.home, '.central-knot/profiles.json'), JSON.stringify({ formatVersion: 1, profiles: [{ id: 'dev', name: 'Dev', items: [] }], offByProfile: { 'skill:notes': ['claude-cli'] } }));
    const claudeCopy = await bytes(folderOf(box, 'claude-cli'));
    await writeFile(join(folderOf(box, 'codex-cli'), 'SKILL.md'), skillText('A hand edit, waiting while Automatic sync is off.'));
    await migrateProfiles(box.context, box.tools);
    assert.deepEqual([await bytes(folderOf(box, 'claude-cli')), (await skillsView(box.context, box.tools)).items[0]?.loads?.['claude-cli']?.switchedOff], [claudeCopy, false]);
  } finally { await box.cleanup(); }
});

test('Migration keeps no Claude Code deny for a listed switch a person had turned back on, and a deny set by hand later stays', async () => {
  const { box } = await oldHome('dev');
  try {
    const settings = mcpSwitchPath(box.context, 'claude-cli');
    const deny = async (off: boolean) => writeFile(settings, withMcpSwitch('claude-cli', await readFile(settings, 'utf8'), 'sentry', off));
    // sentry is turned Off and its switch in Claude Code is turned back on by hand, before the upgrade.
    await applyServers(box.context, box.tools, [{ key: 'sentry', on: false, except: [] }]);
    await deny(false);
    await migrateProfiles(box.context, box.tools);
    assert.doesNotMatch((await text(box, '.central-knot/claude-denies.json')) ?? '', /sentry/);
    // A deny the person sets later is theirs: turning sentry On leaves it.
    await deny(true);
    await applyServers(box.context, box.tools, [{ key: 'sentry', on: true, except: [], seenOn: false }]);
    assert.deepEqual(JSON.parse((await text(box, SETTINGS['claude-cli']))!).deniedMcpServers, [{ serverName: 'sentry' }]);
  } finally { await box.cleanup(); }
});

test('A migration stopped part-way is finished by the next pass, with one History entry', async () => {
  const box = await goneHome();
  try {
    // pager is On again before the upgrade and held off in every tool: the migration turns it Off, with its one entry; docs stays Off.
    await applySkills(box.context, box.tools, [{ key: 'pager', on: true, except: [], seenOn: false }]);
    await writeFile(join(box.home, '.central-knot/profiles.json'), `${JSON.stringify({ formatVersion: 1, profiles: [], offByProfile: { 'mcp:sentry': tools, 'skill:pager': tools } }, null, 2)}\n`);
    for (const tool of tools) await setDisabled(box.context, tool, { folder: 'pager', name: 'pager', skillFile: join(folderOf(box, tool, 'pager'), 'SKILL.md') }, true);
    const crash = { ...box.context, fault: (at: string) => { if (at === 'before-remove') throw new Error('crash'); } };
    await assert.rejects(migrateProfiles(crash, box.tools), /crash/);
    assert.equal(JSON.parse((await text(box, '.central-knot/profiles.json'))!).formatVersion, 1);
    await migrateProfiles(box.context, box.tools);
    assert.equal(JSON.parse((await text(box, '.central-knot/profiles.json'))!).formatVersion, 2);
    assert.deepEqual([(await live(box)).find(item => item.key === 'pager')?.on, await bytes(folderOf(box, 'codex-cli', 'pager'))], [false, undefined]);
    assert.equal((await history(box)).filter(entry => entry.profile?.migrated).length, 1);
  } finally { await box.cleanup(); }
});

// Profiles as sets of library items, worked examples: the rules (profileplan.ts), a switch and its Undo on real files in a temp
// home with three tools (profiles.ts), which profile is in use as the library changes, and the move of a profiles file from
// before (profilemigrate.ts). The temp home has Claude Code, Copilot CLI and Codex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { winLockSkip, withLock } from './fslock.ts';
import { join } from 'node:path';
import { agentsView, applyAgents } from '../src/agents.ts';
import { readHistory } from '../src/history.ts';
import { newItem, type ItemKind } from '../src/library.ts';
import { readTool, writeEntry } from '../src/mcp.ts';
import { mcpSwitchPath, withMcpSwitch } from '../src/mcpswitch.ts';
import { hashesOf, libraryWords, sentences } from '../src/libraryrow.ts';
import { migrateProfiles } from '../src/profilemigrate.ts';
import { allTurns, copilotKeptOnBy, copilotServerName, copilotSharesYours, entryTurns, homeItems, itemRowState, pluginItemOn, inUse, inUseName, leftOut, leftOutWords, liveItems, namedCount, PLUGIN_ITEMS_STAY, pluginItemsAgree, pluginLive, pluginPlan, pluginRowState, pluginStayNote, pluginUndo, stillLoadAfter, switchable, switchPlan, switchPreview, takenWhole, turnsWords, undoInHome, undoOffered, undoPlan, undoTurns, wholeSaid, wholeTurns, withCopilotOff, type Libraries, type PluginHome } from '../src/profileplan.ts';
import { NO_PLUGINS, deleteProfile, readLibraries, readProfiles, saveProfile, saveProfiles, switchProfile, undoSwitch, type PluginSide } from '../src/profiles.ts';
import { readPluginItems } from '../src/pluginitems.ts';
import { pluginOnIn } from '../src/pluginrows.ts';
import { runPlan, type PlanApi } from '../src/pluginplan.ts';
import { savePluginRecord } from '../src/pluginrecord.ts';
import { harnessIds } from '../src/harnesses.ts';
import { setPart, setSkill, setWhole } from '../src/plugins.ts';
import type { PluginTool } from '../src/presence.ts';
import { applyServers, serversView } from '../src/servers.ts';
import { keepDenies } from '../src/serverstore.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { setDisabled } from '../src/skillswitch.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts, Profile, ThroughPlugin } from '../src/types.ts';
import { bytes, folderOf, put, sandbox, skillText, type Box, type Tool } from './skillclicks.ts';
import { standIn } from './standin.ts';

// ---------- The rules ----------

const libraryOf = (items: [ItemKind, string, boolean, boolean?][]): Libraries => {
  const libraries: Libraries = { skill: {}, mcp: {}, agent: {} };
  for (const [kind, key, on, deleted] of items) libraries[kind][key] = { ...newItem(key, key), on, ...(deleted ? { deleted: { at: '' } } : {}) };
  return libraries;
};
const ids = (items: { id: string }[]) => items.map(item => item.id);
const profile = (name: string, items: string[], switchesPluginItems = true): Profile => ({ id: name, name, items, switchesPluginItems });

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

test('His case: a plugin’s skill in Claude Code, Codex and Pi turns off in Codex and Pi for a profile that leaves it out, stays on in Claude Code with its ticked sibling (the plugin is whole there), and comes back for one that has it', () => {
  const work = profile('Work', [pdfId, sheetId]), other = profile('Other', [sheetId]);
  const before = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [{ key: 'pdf-reader', on: true }, { key: 'spreadsheet', on: true }]);
  assert.deepEqual(copiesIn(before)[pdfId], ['claude-cli on whole', 'codex-cli on', 'pi-cli on'], 'one item, whichever way each tool has it');
  assert.deepEqual([pluginItemsAgree(work, pluginLive(before)), pluginItemsAgree(other, pluginLive(before))], [true, false]);
  assert.deepEqual(pluginPlan(other, pluginLive(before)), [{ id: pdfId, on: [], off: ['codex-cli', 'pi-cli'], held: [] }]);
  // What a switch acts on in each: the copy installed whole, as the Library's switch takes it (pluginswitch.ts); Pi's library item.
  assert.deepEqual(pluginLive(before).find(item => item.id === pdfId)!.copies.map(({ target }) => ('libraryKey' in target ? target : [target.tool, target.name])),
    [['claude-cli', 'pdf-reader'], ['codex-cli', 'pdf-reader'], { libraryKey: 'pdf-reader' }]);
  // As that switch leaves it: off by Codex's own switch, Pi's copy out (its library item Off), on in Claude Code.
  const after = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { skillsOff: ['pdf-reader'] })], [{ key: 'pdf-reader', on: false }, { key: 'spreadsheet', on: true }]);
  assert.deepEqual(copiesIn(after)[pdfId], ['claude-cli on whole', 'codex-cli off', 'pi-cli off']);
  assert.deepEqual([pluginItemsAgree(work, pluginLive(after)), pluginItemsAgree(other, pluginLive(after))], [false, true], 'Other agrees with Claude Code’s copy on');
  assert.deepEqual(pluginPlan(work, pluginLive(after)), [{ id: pdfId, on: ['codex-cli', 'pi-cli'], off: [], held: [] }]);
  // The person's own items are none of these: the plugin's items are listed and switched as the plugin's.
  assert.deepEqual(ids(homeItems(after)), []);
});

test('A profile that leaves out one skill of a plugin turns that one alone: its sibling, and the plugin, are left as they are in every tool', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [{ key: 'pdf-reader', on: true }, { key: 'spreadsheet', on: true }]);
  assert.deepEqual(pluginPlan(profile('Sheets', [sheetId]), pluginLive(home)), [{ id: pdfId, on: [], off: ['codex-cli', 'pi-cli'], held: [] }]);
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

test('In Copilot CLI one exact server name is one switch: kept on without holding when the profile names another member (his own or another plugin’s), turned off when it names neither; case differs is two names', () => {
  const issues = { kind: 'mcp' as const, name: 'issues', description: '' }, issuesId = 'plugin:mcp:document-tools@team-tools/issues';
  const installs = [docsIn('copilot-cli', { items: [issues] }), docsIn('codex-cli', { items: [issues] })];
  /** The person's own server in Copilot CLI, spelled as its file has it (types.ts ToolCopy `folder`). */
  const mine = (spelled: string) => ({ ...row('issues'), copies: { 'copilot-cli': { folder: spelled } } }) as unknown as LibraryFacts;
  const quiet = profile('Quiet', ['mcp:issues']), neither = profile('Neither', []);
  const plan = (prof: Profile, home: HomeView) => pluginPlan(prof, pluginLive(home)).map(each => [each.id, each.on, each.off, each.held]);
  // Profile has his own `issues` (same exact name): stays on in Copilot CLI (no hold, copilotKeptOnBy says 'own'), turns off in Codex.
  const sameName = docsHome(installs, [], [['mcp', 'issues', true]], [mine('issues')]);
  assert.deepEqual(plan(quiet, sameName), [[issuesId, [], ['codex-cli'], []]]);
  const copilotCopy = pluginLive(sameName).find(item => item.id === issuesId)!.copies.find(copy => copy.tool === 'copilot-cli')!;
  assert.deepEqual(copilotKeptOnBy(quiet, { id: issuesId }, copilotCopy), { by: 'own' });
  // Profile has neither: turns off in both Copilot CLI and Codex in one plan (no hold).
  assert.deepEqual(plan(neither, sameName), [[issuesId, [], ['copilot-cli', 'codex-cli'], []]]);
  // Another plugin's server of that exact name there: profile wanting one keeps Copilot CLI on (copilotKeptOnBy says 'plugin'); neither turns both off.
  const tracker: InstalledPlugin = { tool: 'copilot-cli', plugin: 'tracker', marketName: 'team-tools', listed: true, items: [issues] };
  const twoPlugins = docsHome([...installs, tracker]);
  const wantTracker = profile('Tracker', ['plugin:mcp:tracker@team-tools/issues']);
  assert.deepEqual(plan(wantTracker, twoPlugins), [[issuesId, [], ['codex-cli'], []]]);
  assert.deepEqual(copilotKeptOnBy(wantTracker, { id: issuesId }, pluginLive(twoPlugins).find(item => item.id === issuesId)!.copies.find(copy => copy.tool === 'copilot-cli')!),
    { by: 'plugin', plugin: 'tracker' });
  assert.deepEqual(plan(neither, twoPlugins), [[issuesId, [], ['copilot-cli', 'codex-cli'], []], ['plugin:mcp:tracker@team-tools/issues', [], ['copilot-cli'], []]]);
  // Exact spelling (case-sensitive): his own `Issues` is another name, so Quiet turns the plugin's `issues` off in Copilot CLI too.
  assert.deepEqual(plan(quiet, docsHome(installs, [], [['mcp', 'issues', true]], [mine('Issues')])), [[issuesId, [], ['copilot-cli', 'codex-cli'], []]]);
});

test('A plugin that is one skill at its root is one item installed and placed: Claude Code’s copy and Pi’s are both named for the plugin; a placed skill of another name is another item', () => {
  // Claude Code read document-tools as one skill, SKILL.md at its root; Pi has it from the marketplace under the plugin's name (pluginlibrary.ts readPlugin).
  const root = docsIn('claude-cli', { items: [{ kind: 'skill', name: 'docs-skill', keyName: 'document-tools', description: '' }] });
  const rootId = 'plugin:skill:document-tools@team-tools/document-tools';
  assert.deepEqual(copiesIn(docsHome([root], [{ key: 'document-tools', on: true }])), { [rootId]: ['claude-cli on whole', 'pi-cli on'] });
  // Placed from another version of the plugin, whose one skill is in a folder (bundle): its own item, by its own name.
  assert.deepEqual(Object.keys(copiesIn(docsHome([root], [{ key: 'bundle', on: true }]))).sort(), [rootId, 'plugin:skill:document-tools@team-tools/bundle'].sort());
});

test('A copy placed in Pi is held while its plugin is Off on Plugins: a profile never turns on what the plugin’s Off turned off', () => {
  const off = docsHome([], [{ key: 'pdf-reader', on: false }, { key: 'spreadsheet', on: false }], [], [], { on: false });
  assert.deepEqual(copiesIn(off)[pdfId], ['pi-cli off plugin-off']);
  assert.deepEqual(pluginPlan(profile('Docs', [pdfId]), pluginLive(off)), [{ id: pdfId, on: [], off: [], held: [{ tool: 'pi-cli', why: 'The whole plugin document-tools is off in Pi.' }] }]);
  assert.equal(pluginItemsAgree(profile('Empty', []), pluginLive(off)), true);
});

test('After an update drops a plugin’s skill and brings another, a profile still plans: the dropped one dormant, the new one turned off as one it leaves out', () => {
  const work = profile('Work', [pdfId, sheetId]), home = docsHome([docsIn('codex-cli', { items: [skill('spreadsheet'), skill('forms')] })]);
  assert.deepEqual(pluginPlan(work, pluginLive(home)), [{ id: 'plugin:skill:document-tools@team-tools/forms', on: [], off: ['codex-cli'], held: [] }]);
  assert.equal(pluginItemsAgree(work, pluginLive(home)), false, 'not in use until switched again');
});

test('With the whole plugin off in Codex a switch changes nothing there: its items count as off, held for a profile that has them, agreeing with one that leaves them out', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { off: true })]), codexOnly = docsHome([docsIn('codex-cli', { off: true })]);
  assert.deepEqual(copiesIn(home)[pdfId], ['claude-cli on whole', 'codex-cli off plugin-off']);
  const off = { tool: 'codex-cli', why: 'The whole plugin document-tools is off in Codex.' };
  assert.deepEqual(pluginPlan(profile('Docs', [pdfId, sheetId]), pluginLive(home)), [{ id: pdfId, on: [], off: [], held: [off] }, { id: sheetId, on: [], off: [], held: [off] }]);
  assert.equal(pluginItemsAgree(profile('Empty', []), pluginLive(codexOnly)), true);
  // Off in Claude Code too, where a skill has no switch of its own: off there by its whole plugin, which a profile turns on.
  assert.deepEqual(copiesIn(docsHome([docsIn('claude-cli', { off: true })]))[pdfId], ['claude-cli off whole']);
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
  assert.deepEqual(pluginPlan(profile('Sheets', [sheetId]), pluginLive(home)).map(each => [each.id, each.on, each.off, each.held.map(held => held.why)]), [
    ['plugin:agent:document-tools@team-tools/reviewer', [], ['claude-cli'], []],
    [pdfId, [], [], ['Codex’s config.toml writes skills.config as a value.']],
  ]);
});

test('A tool whose copy of the plugin can’t be read: what it has there isn’t known, so no profile is in use by its items, and a switch holds them there', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { items: [], problem: 'Its plugin.json can’t be read.' })]);
  assert.deepEqual(copiesIn(home)[pdfId], ['claude-cli on whole', 'codex-cli off unread']);
  const unread = { tool: 'codex-cli', why: 'Codex’s copy of document-tools couldn’t be read: Its plugin.json can’t be read.' };
  assert.deepEqual(pluginPlan(profile('Docs', [pdfId, sheetId]), pluginLive(home)), [{ id: pdfId, on: [], off: [], held: [unread] }, { id: sheetId, on: [], off: [], held: [unread] }]);
  assert.deepEqual([pluginItemsAgree(profile('Docs', [pdfId, sheetId]), pluginLive(home)), pluginItemsAgree(profile('Empty', []), pluginLive(home))], [false, false], 'neither way');
  // An item only the unread copy could have isn't known at all: nothing is listed for it.
  assert.deepEqual(pluginLive(docsHome([docsIn('codex-cli', { items: [], problem: 'Unreadable.' })])), []);
});

test('In use takes in the plugins’ items wherever a tool can switch them, and in Claude Code its whole plugin: two profiles that tick different skills of it are both in use while it is on, one that ticks none is not', () => {
  const own: [ItemKind, string, boolean][] = [['skill', 'notes', true]];
  const claudeOnly = docsHome([docsIn('claude-cli')], [], own), live = homeItems(claudeOnly), plugins = pluginLive(claudeOnly);
  const work = profile('Work', ['skill:notes', pdfId, sheetId]), pdf = profile('Pdf', ['skill:notes', pdfId]), lean = profile('Lean', ['skill:notes']);
  assert.deepEqual(inUse([work, pdf, lean], live, plugins), [work, pdf], 'Lean would turn document-tools off in Claude Code');
  assert.equal(inUseName([work, pdf, lean], live, plugins), 'Work and Pdf');
  // Turned off there by hand: Pdf is no longer in use, and Lean is.
  const offByHand = docsHome([docsIn('claude-cli', { off: true })], [], own);
  assert.deepEqual(inUse([work, pdf, lean], homeItems(offByHand), pluginLive(offByHand)), [lean]);
  // With Codex too, which can switch each skill: Lean leaves them out, and Codex has them on, so only Work is in use.
  const both = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [], own);
  assert.deepEqual(inUse([work, lean], homeItems(both), pluginLive(both)), [work]);
  // A profile of a plugin's items alone is offered to switch to; one naming only items no tool has is not.
  assert.deepEqual([switchable(profile('Docs', [pdfId]), [], pluginLive(both)), switchable(profile('Gone', ['plugin:skill:document-tools@team-tools/gone']), [], pluginLive(both))], [true, false]);
});

test('A switch’s count takes each plugin’s item once however many tools turn it, and an item only held is not counted as turned', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { skillsOff: ['spreadsheet'] })], [{ key: 'pdf-reader', on: true }, { key: 'spreadsheet', on: true }], [['skill', 'notes', true]]);
  const sheets = profile('Sheets', ['skill:notes', sheetId]), plan = pluginPlan(sheets, pluginLive(home));
  assert.deepEqual(plan.map(each => [each.id, each.on, each.off]), [[pdfId, [], ['codex-cli', 'pi-cli']], [sheetId, ['codex-cli'], []]]);
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

test('His own server not in Copilot CLI now is compared by the exact spelling Copilot CLI will write (kept copilotName, else its item name)', () => {
  const issues = { kind: 'mcp' as const, name: 'issues', description: '' }, issuesId = 'plugin:mcp:document-tools@team-tools/issues';
  const installs = [docsIn('copilot-cli', { items: [issues] }), docsIn('codex-cli', { items: [issues] })];
  const mine = profile('Mine', ['mcp:issues']);
  // Item named `Issues` with no kept Copilot CLI own part: writes `Issues`, not `issues`, so Copilot CLI turns plugin's `issues` off.
  const capital = docsHome(installs, [], [['mcp', 'issues', false]]);
  capital.mcp.library.issues!.name = 'Issues';
  assert.deepEqual(pluginPlan(mine, pluginLive(capital)), [{ id: issuesId, on: [], off: ['copilot-cli', 'codex-cli'], held: [] }]);
  // Item named `Issues` whose kept Copilot CLI own part spells it `issues`: matches exact name, so Copilot CLI stays on (no hold).
  const keptLower = docsHome(installs, [], [['mcp', 'issues', false]], [{ ...row('issues'), copilotName: 'issues' }]);
  keptLower.mcp.library.issues!.name = 'Issues';
  assert.deepEqual(pluginPlan(mine, pluginLive(keptLower)), [{ id: issuesId, on: [], off: ['codex-cli'], held: [] }]);
  // Item named `Issues` served through the plugin in Copilot CLI (same content as plugin's `issues`, servers.ts viaPlugin): matches the plugin's exact name there.
  const viaPlug = docsHome(installs, [], [['mcp', 'issues', false]], [row('issues', { 'copilot-cli': { plugin: 'document-tools', marketplace: 'team-tools', name: 'issues' } })]);
  viaPlug.mcp.library.issues!.name = 'Issues';
  assert.deepEqual(pluginPlan(mine, pluginLive(viaPlug)), [{ id: issuesId, on: [], off: ['codex-cli'], held: [] }]);
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
  assert.deepEqual(copiesIn(home), { [pdfId]: ['claude-cli on whole', 'codex-cli off unread'], 'plugin:agent:document-tools@team-tools/reviewer': ['claude-cli on'] });
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
/** The live library items now, from the records (profiles.ts readLibraries). */
const live = async (box: Box) => { const read = await readLibraries(box.context); return 'stop' in read ? [] : liveItems(read.libraries, read.plugins); };
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

/** The home as the Profiles page and the menus read it (profileplan.ts PluginHome), with no plugins. */
const homeNow = async (box: Box) => ({ pluginItems: [], profiles: await readProfiles(box.home), skills: await skillsView(box.context, box.tools),
  mcp: await serversView(box.context, box.tools), agents: await agentsView(box.context, box.tools) }) as unknown as HomeView;
/** A skill's folder in the shared skills folder (~/.agents/skills), which Central Knot never writes. */
const putShared = (box: Box, name: string, body = `The ${name} skill.`) => putFile(join(box.home, '.agents/skills', name, 'SKILL.md'), skillText(body, name));
/** What a switch to `name` would do, as the page's header and both menus say it, read from the home now. */
const preview = async (box: Box, name: string) => {
  const view = await homeNow(box), profile = view.profiles.profiles.find(each => each.name === name)!;
  return switchPreview(profile, homeItems(view), pluginLive(view));
};

test('His case: six of his skills in a tool’s folder and four only in the shared folder, all On; a profile with none of them says it turns ten off and that four still load, in the tools that read the shared folder; with none of those, the words as before', async () => {
  const five: Tool[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'], box = await sandbox(five);
  try {
    const own = ['one', 'two', 'three', 'four', 'five', 'six'], shared = ['s-one', 's-two', 's-three', 's-four'];
    for (const name of [...own, 'keep']) await put(box, 'claude-cli', { 'SKILL.md': skillText(`The ${name} skill.`, name) }, [], name);
    for (const name of shared) await putShared(box, name);
    await applySkills(box.context, box.tools, [...own, ...shared, 'keep'].map(key => ({ key, on: true, except: [] })));
    // One unrelated item ticked, so Switch is offered (profileplan.ts switchable).
    await saveProfile(box.context, { name: 'Writing', items: ['skill:keep'] });
    await saveProfile(box.context, { name: 'Shared', items: ['skill:keep', ...shared.map(key => `skill:${key}`)] });
    // Off takes Central Knot's copies out of every tool (Claude Code's of the shared ones too); the shared folder stays as it is,
    // and Copilot CLI, Codex, Pi and OpenCode read it by themselves.
    assert.equal(await preview(box, 'Writing'), 'Switching turns 10 items off; 4 still load from the shared skills folder, in Copilot CLI, Codex, Pi or OpenCode');
    assert.equal(await preview(box, 'Shared'), 'Switching turns 6 items off', 'none of the six still loads: the words as before');
    // The switch's result asks the home read again after it, not the preview: an item its entry names that is On there now is
    // not one it turned off.
    assert.equal(stillLoadAfter({ toName: 'Writing', on: [], off: [{ id: 'skill:s-one', name: 's-one' }] }, await homeNow(box)), '');
    const writing = (await readProfiles(box.home)).profiles.find(each => each.name === 'Writing')!;
    const switched = await switchProfile(box.context, box.tools, writing.id, NO_PLUGINS);
    assert.equal(stillLoadAfter(switched.profile!, await homeNow(box)), '; 4 still load from the shared skills folder, in Copilot CLI, Codex, Pi or OpenCode');
  } finally { await box.cleanup(); }
});

test('Still loading after a switch is what the read decides of each copy that stays: a link into the shared folder does, a link to a copy Central Knot wrote in another tool doesn’t, a folder of his in a tool the item is kept out of does', async () => {
  const box = await sandbox(tools);
  try {
    // linked: Claude Code has it by a link into the shared folder, which Copilot CLI and Codex read; nothing of Central Knot's anywhere.
    await putShared(box, 'linked');
    await mkdir(join(box.home, '.claude/skills'), { recursive: true });
    await symlink('../../.agents/skills/linked', join(box.home, '.claude/skills/linked'));
    // via-codex: Codex's folder, taken in (Central Knot's from then on), and Claude Code's link to it: Off removes the folder, so the link leads nowhere.
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Via Codex.', 'via-codex') }, [], 'via-codex');
    await symlink('../../.codex/skills/via-codex', join(box.home, '.claude/skills/via-codex'));
    // kept: kept out of Codex, where he has a folder of his own by that name, which Off leaves alone.
    for (const name of ['kept', 'keep']) await put(box, 'claude-cli', { 'SKILL.md': skillText(`The ${name} skill.`, name) }, [], name);
    await applySkills(box.context, box.tools, [{ key: 'linked', on: true, except: [] }, { key: 'via-codex', on: true, except: [] }, { key: 'kept', on: true, except: ['codex-cli'] }, { key: 'keep', on: true, except: [] }]);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('His own, in Codex.', 'kept') }, [], 'kept');
    await saveProfile(box.context, { name: 'Other', items: ['skill:keep'] });
    assert.equal(await preview(box, 'Other'), 'Switching turns 3 items off; 2 still load another way, in Claude Code, Copilot CLI or Codex');
  } finally { await box.cleanup(); }
});

test('A link of his in Claude Code’s folder still loads after a switch in Claude Code and in OpenCode, which reads that folder: before it and after it alike', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli', 'opencode-cli']);
  try {
    await putFile(join(box.home, 'my-skills/external/SKILL.md'), skillText('External.', 'external'));
    await mkdir(join(box.home, '.claude/skills'), { recursive: true });
    await symlink('../../my-skills/external', join(box.home, '.claude/skills/external'));
    await put(box, 'claude-cli', { 'SKILL.md': skillText('The keep skill.', 'keep') }, [], 'keep');
    await applySkills(box.context, box.tools, [{ key: 'external', on: true, except: [] }, { key: 'keep', on: true, except: [] }]);
    await saveProfile(box.context, { name: 'Other', items: ['skill:keep'] });
    const header = await preview(box, 'Other');
    const other = (await readProfiles(box.home)).profiles.find(each => each.name === 'Other')!;
    const switched = await switchProfile(box.context, box.tools, other.id, NO_PLUGINS);
    assert.deepEqual([header, stillLoadAfter(switched.profile!, await homeNow(box))],
      ['Switching turns 1 item off; 1 still loads another way, in Claude Code or OpenCode', '; 1 still loads another way, in Claude Code or OpenCode']);
  } finally { await box.cleanup(); }
});

test('A server whose entry Claude Code lost while its removal was owed (as alpha 2 left it) turns Off again in the switch that turns it On: the result says so, and History says why', { skip: winLockSkip }, async () => {
  const { box, made, profiles } = await home();
  try {
    // The switch's removal from Claude Code is left owed (its file can't be read meanwhile), as alpha 2 left it.
    await withLock(join(box.home, MCP['claude-cli']), 'file-unreadable', async () => {
      await switchProfile(box.context, box.tools, await made('Dev', ['skill:dev', 'agent:writer']), NO_PLUGINS);
    });
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
    for (const file of ['{ not json', '{ "formatVersion": 4, "profiles": [] }']) {
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
    assert.deepEqual(await profiles(), [{ id: dev, name: 'Dev work', items: ['skill:dev', 'agent:writer', 'plugin:skill:document-tools@team-tools/pdf'], switchesPluginItems: true }]);
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
  await savePluginRecord(box.home, { tools: box.tools, knows: [...harnessIds], plugins: [{ id: DOCS_ID, source: '/m', marketName: 'team', plugin: 'docs', on: true, except: [] }] });
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
  let binaries: Partial<Record<PluginTool, string>> = {};
  if (box.tools.includes('copilot-cli')) {
    // Copilot CLI's `skill enable|disable <name>`, as the real one writes it: disabledSkills in its settings.json (tests/standin.ts).
    const js = `const fs=require("fs"),p=require("path"),[a,b,c]=process.argv.slice(1);if(a==="skill"&&(b==="enable"||b==="disable")&&c){const f=p.join(process.env.HOME,".copilot/settings.json"),j=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):{};const l=(Array.isArray(j.disabledSkills)?j.disabledSkills:[]).filter(x=>x!==c);if(b==="disable")l.push(c);if(l.length)j.disabledSkills=l;else delete j.disabledSkills;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\\n");process.exit(0);}process.exit(9);`;
    binaries = { 'copilot-cli': await standIn(join(box.base, 'bin/copilot'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} -e '${js}' "$@"\n`, js) };
  }
  if (box.tools.includes('claude-cli')) {
    // Claude Code's `plugin enable|disable <id>`, as the real one writes it: enabledPlugins in its settings.json, every other key
    // kept; each call also listed in the box's claude-calls; refused while the box has refuse-<enable|disable>-<id>.
    const calls = JSON.stringify(join(box.base, 'claude-calls')), refused = JSON.stringify(box.base);
    const js = `const fs=require("fs"),p=require("path"),[a,b,c]=process.argv.slice(1);if(a==="plugin"&&(b==="enable"||b==="disable")&&c){const f=p.join(process.env.HOME,".claude/settings.json"),j=JSON.parse(fs.readFileSync(f,"utf8"));j.enabledPlugins={...j.enabledPlugins,[c]:b==="enable"};fs.writeFileSync(f,JSON.stringify(j,null,2)+"\\n");process.exit(0);}process.exit(9);`;
    const listedAndRefused = `const [, , did, id] = process.argv; require("fs").appendFileSync(${calls}, did + " " + id + "\\n"); if (require("fs").existsSync(${refused} + "/refuse-" + did + "-" + id)) process.exit(9);\n`;
    binaries = { ...binaries, 'claude-cli': await standIn(join(box.base, 'bin/claude'),
      `#!/bin/sh\necho "$2 $3" >> ${calls}\n[ -f ${refused}/refuse-$2-$3 ] && exit 9\nexec ${JSON.stringify(process.execPath)} -e '${js}' "$@"\n`, `${listedAndRefused}${js}`) };
  }
  const context = { ...box.context, dataDir: join(box.base, 'data'), binaries };
  const view = { pluginItems: await readPluginItems(context, box.tools), profiles: await readProfiles(box.home), skills: await skillsView(box.context, box.tools),
    mcp: await serversView(box.context, box.tools), agents: await agentsView(box.context, box.tools) } as unknown as HomeView;
  const plugins = pluginLive(view), never = async () => { throw new Error('A profile never installs or uninstalls.'); };
  const api: PlanApi = { install: never, uninstall: never,
    setSkill: async (source, marketName, plugin, skill, tool, on) => ({ reports: [await setSkill(context, marketName, plugin, skill, tool as PluginTool, on, source)] }),
    setPart: async (source, marketName, plugin, part, tool, on) => ({ reports: [await setPart(context, marketName, plugin, part, tool as PluginTool, on, source)] }),
    setWhole: async (source, marketName, plugin, tool, on) => ({ reports: [await setWhole(context, marketName, plugin, tool as PluginTool, on, source)] }) };
  const side: PluginSide = { live: async () => plugins, run: async ops => (await runPlan(ops, api, box.home)).done };
  return { view, live: homeItems(view), plugins, side, binaries, inUse: async () => inUse((await readProfiles(box.home)).profiles, homeItems(view), plugins).map(each => each.name) };
}
/** The files a plugin's items live in: Codex's and Claude Code's settings, and each skill's folder in Pi. */
const pluginFiles = async (box: Box) => ({ codex: await text(box, '.codex/config.toml'), claude: await text(box, '.claude/settings.json'),
  pi: { 'pdf-reader': await bytes(folderOf(box, 'pi-cli', 'pdf-reader')), spreadsheet: await bytes(folderOf(box, 'pi-cli', 'spreadsheet')) } });
const pdfOffInCodex = `${CODEX_BEFORE}\n[[skills.config]]\nname = "docs:pdf-reader"\nenabled = false\n`;

test('His case on real files: a plugin’s skill left out by a profile goes off in Codex by its own rule and out of Pi, stays on in Claude Code with its ticked sibling, the plugin untouched; that profile is in use; switching back puts every file back', async () => {
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
    assert.deepEqual(now.plugins.find(item => item.id === docsId('skill', 'pdf-reader'))!.copies.map(copy => [copy.tool, copy.on, copy.way]), [['claude-cli', true, 'whole'], ['codex-cli', false, 'switch'], ['pi-cli', false, 'switch']]);
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

test('A tool whose write fails is said, and is in neither the History entry nor its Undo; the other tools are switched', { skip: winLockSkip }, async () => {
  const { box, made } = await pluginHome();
  try {
    // Codex's folder can't be written: its config.toml is replaced through a file beside it (share.ts writeFileChecked).
    const codex = join(box.home, '.codex'), other = await made('Other', [docsId('skill', 'spreadsheet'), docsId('mcp', 'issues')]), side = (await sideNow(box)).side;
    const switched = await withLock(codex, 'dir-readonly', () => switchProfile(box.context, box.tools, other, side));
    assert.deepEqual([switched.off, switched.left, switched.results.map(result => [result.harness, result.outcome])], [['pdf-reader'], ['pdf-reader'], [['codex-cli', 'failed']]]);
    assert.deepEqual([await text(box, '.codex/config.toml'), await bytes(folderOf(box, 'pi-cli', 'pdf-reader'))], [CODEX_BEFORE, undefined]);
    assert.deepEqual((await history(box)).at(-1)!.profile?.plugins?.map(copy => copy.tool), ['pi-cli']);
    const undone = await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.switched, await text(box, '.codex/config.toml')], [{ on: ['pdf-reader'], off: [], left: [] }, CODEX_BEFORE]);
  } finally { await box.cleanup(); }
});

test('A server of his only found in Copilot CLI (not in Central Knot) is never disabled by a profile: Quiet leaves Copilot CLI’s files intact, turns Claude Code and Codex off, and is in use', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    const copilotBefore = await text(box, '.copilot/settings.json'), mcpBefore = await text(box, '.copilot/mcp-config.json');
    const quiet = await made('Quiet', [docsId('skill', 'pdf-reader'), docsId('skill', 'spreadsheet')]);
    const switched = await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);
    assert.deepEqual([switched.off, switched.results], [['issues'], []]);
    assert.deepEqual([await text(box, '.copilot/settings.json'), await text(box, '.copilot/mcp-config.json'), await text(box, '.codex/config.toml'), JSON.parse((await text(box, '.claude/settings.json'))!).deniedMcpServers],
      [copilotBefore, mcpBefore, `${CODEX_BEFORE}\n[plugins."docs@team".mcp_servers.issues]\nenabled = false\n`, [{ serverName: 'plugin:docs:issues' }]]);
    const now = await sideNow(box);
    assert.deepEqual(await now.inUse(), ['Quiet'], 'standing fact of Copilot CLI’s found entry does not hold Quiet back');
    const quietProfile = (await readProfiles(box.home)).profiles.find(each => each.id === quiet)!;
    const copilotCopy = now.plugins.find(item => item.id === issuesId2)!.copies.find(copy => copy.tool === 'copilot-cli')!;
    assert.deepEqual(copilotKeptOnBy(quietProfile, { id: issuesId2 }, copilotCopy), { by: 'found' });
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

// ---------- Claude Code takes a plugin whole ----------
// Claude Code has no switch for one skill of a plugin, so a profile that chooses plugin items has a plugin on there while it ticks
// any item the plugin brings there, and off while it ticks none. docs@team, in Claude Code alone, brings the skills a, b and c, and
// with `parts` the MCP server s and the agent g; `enabled` false: off there. Its switch there is `claude plugin enable` (sideNow's
// stand-in writes enabledPlugins as the real one does).

async function wholeHome({ enabled = true, parts = false, skills = ['a', 'b', 'c'], denied = [] as string[], notes = false } = {}) {
  const box = await sandbox(['claude-cli']), cache = join(box.home, '.claude/plugins/cache/team/docs/1.0.0');
  for (const name of skills) await putFile(join(cache, 'skills', name, 'SKILL.md'), skillText(`The ${name} skill.`, name));
  await putFile(join(cache, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'docs', version: '1.0.0' }));
  if (parts) {
    await putFile(join(cache, '.mcp.json'), JSON.stringify({ mcpServers: { s: { command: 'npx', args: ['s'] } } }));
    await putFile(join(cache, 'agents/g.md'), '---\nname: g\ndescription: Reviews a change.\n---\n\nYou review changes.\n');
  }
  await putFile(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'docs@team': [{ scope: 'user', installPath: cache, version: '1.0.0' }] } }));
  const deny = denied.length ? { deniedMcpServers: denied.map(name => ({ serverName: `plugin:docs:${name}` })) } : {};
  await putFile(join(box.home, '.claude/settings.json'), `${JSON.stringify({ extraKnownMarketplaces: { team: { source: { source: 'directory', path: '/m' } } }, enabledPlugins: { 'docs@team': enabled }, ...deny }, null, 2)}\n`);
  // With `notes`, a skill of his own in Claude Code, On: a profile of it alone has something to switch to.
  if (notes) { await put(box, 'claude-cli', { 'SKILL.md': skillText('My notes.', 'notes') }, [], 'notes'); await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]); }
  const made = async (name: string, items: string[]) => (await saveProfile(box.context, { name, items })).id!;
  /** What the page's header and both menus say of a switch to `id`, from the home as it is now. */
  const preview = async (id: string) => { const now = await sideNow(box); return switchPreview((await readProfiles(box.home)).profiles.find(each => each.id === id)!, now.live, now.plugins); };
  /** A switch to `id`, and what its result adds of the plugin, read from the home after it (app.ts switchOutcome). */
  const switched = async (id: string) => { const done = await switchProfile(box.context, box.tools, id, (await sideNow(box)).side); return { ...done, said: done.profile ? wholeSaid(done.profile, (await sideNow(box)).view) : '' }; };
  const settings = async () => JSON.parse((await text(box, '.claude/settings.json'))!);
  return { box, made, preview, switched, settings };
}
const [aId, sId, gId] = [docsId('skill', 'a'), docsId('mcp', 's'), docsId('agent', 'g')];

test('Claude Code takes a plugin whole: with docs off there, a profile that ticks a alone counts first that docs comes on there, and the switch turns docs on there', async () => {
  const { box, made, preview, switched, settings } = await wholeHome({ enabled: false });
  try {
    const work = await made('Work', [aId]), before = await text(box, '.claude/settings.json');
    assert.equal(await preview(work), 'Switching turns 1 item on. Turns 1 plugin on in Claude Code');
    const done = await switched(work);
    assert.deepEqual([done.stopped, done.on, done.results, (await settings()).enabledPlugins], [undefined, ['a'], [], { 'docs@team': true }]);
    assert.equal(done.said, ' a is on in Claude Code. Its whole plugin docs was turned on there, with its 2 other skills.', 'the result, in the Library’s words');
    assert.deepEqual(done.profile?.wholeSteps?.map(op => op.action), ['plugin-on'], 'History keeps the step, for the Undo');
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Work']);
    // Example 7: its Undo from History turns docs off there again, and the file is as it was.
    const undone = await undoSwitch(box.context, box.tools, done.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.stopped, undone.switched?.off, await text(box, '.claude/settings.json')], [undefined, ['a'], before]);
  } finally { await box.cleanup(); }
});

test('With docs on in Claude Code, a profile that ticks none of it counts first that docs goes off there, a plugin installed since the profile was saved too; the switch turns it off', async () => {
  const { box, made, preview, switched, settings } = await wholeHome({ notes: true });
  try {
    const quiet = await made('Quiet', ['skill:notes']);
    assert.equal(await preview(quiet), 'Switching turns 3 items off. Turns 1 plugin off in Claude Code');
    const done = await switched(quiet);
    assert.deepEqual([done.off, (await settings()).enabledPlugins, done.said], [['a', 'b', 'c'], { 'docs@team': false }, ' a is off in Claude Code. Its whole plugin docs was turned off there, with its 2 other skills.']);
  } finally { await box.cleanup(); }
});

test('A profile that ticks every skill of docs says nothing of other skills, and writes nothing in Claude Code', async () => {
  const { box, made, preview, switched } = await wholeHome();
  try {
    const all = await made('All', ['a', 'b', 'c'].map(name => docsId('skill', name))), before = await text(box, '.claude/settings.json');
    assert.deepEqual([await preview(all), (await switched(all)).event, await text(box, '.claude/settings.json')], ['In use · 3 items on', undefined, before]);
  } finally { await box.cleanup(); }
});

test('A plugin of one skill goes on and off with it in Claude Code, said before and after as any plugin is, with no other skill to name', async () => {
  const { box, made, preview, switched, settings } = await wholeHome({ enabled: false, skills: ['a'], notes: true });
  try {
    const work = await made('Work', ['skill:notes', aId]), quiet = await made('Quiet', ['skill:notes']);
    assert.equal(await preview(work), 'Switching turns 1 item on. Turns 1 plugin on in Claude Code');
    assert.deepEqual([(await switched(work)).said, (await settings()).enabledPlugins], [' a is on in Claude Code. Its whole plugin docs was turned on there.', { 'docs@team': true }]);
    assert.equal(await preview(quiet), 'Switching turns 1 item off. Turns 1 plugin off in Claude Code');
    assert.deepEqual([(await switched(quiet)).said, (await settings()).enabledPlugins], [' a is off in Claude Code. Its whole plugin docs was turned off there.', { 'docs@team': false }]);
  } finally { await box.cleanup(); }
});

test('docs off, its server s off by its own switch: a profile that ticks a and s and not the agent g has s on and g off by their own switches before docs comes on; its Undo puts every byte back', async () => {
  const { box, made, switched, settings } = await wholeHome({ enabled: false, parts: true, denied: ['s'] });
  try {
    const work = await made('Work', [aId, sId]), before = await text(box, '.claude/settings.json');
    const done = await switched(work), now = await settings();
    assert.deepEqual([done.results, now.enabledPlugins, now.deniedMcpServers, now.permissions?.deny], [[], { 'docs@team': true }, undefined, ['Agent(docs:g)']]);
    assert.deepEqual(done.profile?.wholeSteps?.map(op => `${op.action} ${op.part?.name ?? ''}`.trim()), ['part-on s', 'part-off g', 'plugin-on'], 'each part’s own switch first, in the steps History keeps');
    await undoSwitch(box.context, box.tools, done.event!, (await sideNow(box)).side);
    assert.equal(await text(box, '.claude/settings.json'), before);
  } finally { await box.cleanup(); }
});

test('docs off, a profile that ticks only its server s: docs comes on for it, with its three skills, as the preview counts first', async () => {
  const { box, made, preview, switched, settings } = await wholeHome({ enabled: false, parts: true });
  try {
    const servers = await made('Servers', [sId]), profileNow = (await readProfiles(box.home)).profiles.find(each => each.id === servers)!;
    assert.equal(await preview(servers), 'Switching turns 1 item on. Turns 1 plugin on in Claude Code');
    assert.deepEqual(takenWhole(profileNow, (await sideNow(box)).view.pluginItems![0]!).brought.map(part => part.name), ['a', 'b', 'c']);
    const done = await switched(servers);
    assert.deepEqual([(await settings()).enabledPlugins, (await settings()).permissions?.deny, done.said], [{ 'docs@team': true }, ['Agent(docs:g)'], ' s is on in Claude Code. Its whole plugin docs was turned on there, with its 3 skills.']);
  } finally { await box.cleanup(); }
});

test('An Undo Claude Code refuses for one of two plugins leaves the switch undoable for it: once the refusal clears, a second Undo turns it back', async () => {
  const { box, made, switched, settings } = await wholeHome({ enabled: false });
  try {
    // A second plugin, solo@team, one skill, off in Claude Code beside docs.
    const solo = join(box.home, '.claude/plugins/cache/team/solo/1.0.0'), record = join(box.home, '.claude/plugins/installed_plugins.json');
    await putFile(join(solo, 'skills/single/SKILL.md'), skillText('The single skill.', 'single'));
    await putFile(join(solo, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'solo', version: '1.0.0' }));
    const installed = JSON.parse((await text(box, '.claude/plugins/installed_plugins.json'))!);
    await writeFile(record, JSON.stringify({ ...installed, plugins: { ...installed.plugins, 'solo@team': [{ scope: 'user', installPath: solo, version: '1.0.0' }] } }));
    await writeFile(join(box.home, '.claude/settings.json'), `${JSON.stringify({ ...(await settings()), enabledPlugins: { 'docs@team': false, 'solo@team': false } }, null, 2)}\n`);
    const done = await switched(await made('Both', [aId, 'plugin:skill:solo@team/single']));
    assert.deepEqual((await settings()).enabledPlugins, { 'docs@team': true, 'solo@team': true });
    await writeFile(join(box.base, 'refuse-disable-docs@team'), '');
    const refused = await undoSwitch(box.context, box.tools, done.event!, (await sideNow(box)).side);
    const entry = async () => (await history(box)).find(each => each.id === done.event)!;
    assert.deepEqual([refused.results.map(result => result.outcome), (await settings()).enabledPlugins, (await entry()).undoneBy, undoOffered({ profile: done.profile }, (await sideNow(box)).view)],
      [['failed'], { 'docs@team': true, 'solo@team': false }, undefined, true], 'solo went back; docs, refused, is still undoable');
    await rm(join(box.base, 'refuse-disable-docs@team'));
    const again = await undoSwitch(box.context, box.tools, done.event!, (await sideNow(box)).side);
    assert.deepEqual([again.results, (await settings()).enabledPlugins, !!(await entry()).undoneBy], [[], { 'docs@team': false, 'solo@team': false }, true]);
  } finally { await box.cleanup(); }
});

test('docs turned off by hand after a switch turned it on: the Undo leaves it and says it changed since', async () => {
  const { box, made, switched, settings } = await wholeHome({ enabled: false });
  try {
    const done = await switched(await made('Work', [aId]));
    await writeFile(join(box.home, '.claude/settings.json'), `${JSON.stringify({ ...(await settings()), enabledPlugins: { 'docs@team': false } }, null, 2)}\n`);
    const byHand = await text(box, '.claude/settings.json'), undone = await undoSwitch(box.context, box.tools, done.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.stopped, await text(box, '.claude/settings.json')], ['Nothing to undo: each item that switch changed was changed again since.', byHand]);
    assert.equal(undoOffered({ profile: done.profile }, (await sideNow(box)).view), false, 'no Undo offered either');
  } finally { await box.cleanup(); }
});

test('Where Claude Code doesn’t turn docs on (its command fails), every part switch made for it is put back, the server’s deny as well as the agent’s rule, and History keeps nothing of it', async () => {
  const { box, made } = await wholeHome({ enabled: false, parts: true, denied: ['s'] });
  try {
    const work = await made('Work', [aId, sId]), before = await text(box, '.claude/settings.json'), now = await sideNow(box);
    await rm(now.binaries['claude-cli']!);
    const done = await switchProfile(box.context, box.tools, work, now.side);
    assert.deepEqual([done.results.map(result => [result.harness, result.outcome]), done.left, await text(box, '.claude/settings.json')], [[['claude-cli', 'failed']], ['a', 's'], before]);
    assert.deepEqual([done.profile?.plugins, done.profile?.wholeSteps], [[], undefined]);
  } finally { await box.cleanup(); }
});

test('Where a part’s own switch can’t be written, docs is not turned on in Claude Code with a part the profile leaves out', async () => {
  const { box, made, settings } = await wholeHome({ enabled: false, parts: true });
  try {
    // A `permissions` that is not an object: the agent's rule can't be written into it.
    await writeFile(join(box.home, '.claude/settings.json'), `${JSON.stringify({ ...(await settings()), permissions: 'odd' }, null, 2)}\n`);
    const done = await switchProfile(box.context, box.tools, await made('Work', [aId]), (await sideNow(box)).side);
    assert.deepEqual([done.results.map(result => result.outcome), (await settings()).enabledPlugins, await text(box, '../claude-calls')], [['failed'], { 'docs@team': false }, undefined], 'Claude Code never asked to enable it');
  } finally { await box.cleanup(); }
});

test('A plugin a profile leaves out goes off in Claude Code even when none of its items changes: said first, not in use, switched, and undone', async () => {
  const { box, made, preview, switched, settings } = await wholeHome({ skills: [], parts: true, denied: ['s'], notes: true });
  try {
    await writeFile(join(box.home, '.claude/settings.json'), `${JSON.stringify({ ...(await settings()), permissions: { deny: ['Agent(docs:g)'] } }, null, 2)}\n`);
    const quiet = await made('Quiet', ['skill:notes']), before = await text(box, '.claude/settings.json');
    assert.deepEqual([await preview(quiet), await (await sideNow(box)).inUse()], ['Switching turns 1 plugin off in Claude Code', []]);
    const done = await switched(quiet);
    assert.deepEqual([(await settings()).enabledPlugins, done.said, await (await sideNow(box)).inUse()], [{ 'docs@team': false }, ' The whole plugin docs was turned off in Claude Code.', ['Quiet']]);
    assert.equal(undoOffered({ profile: done.profile }, (await sideNow(box)).view), true, 'its Undo is offered though no item of it changed');
    await undoSwitch(box.context, box.tools, done.event!, (await sideNow(box)).side);
    assert.equal(JSON.parse((await text(box, '.claude/settings.json'))!).enabledPlugins['docs@team'], JSON.parse(before!).enabledPlugins['docs@team']);
  } finally { await box.cleanup(); }
});

test('Each plugin a switch turns on or off whole in Claude Code is counted, one sentence per direction, one-skill and skill-less ones too', () => {
  const kit = (plugin: string, items: InstalledPlugin['items'], off = false): InstalledPlugin => ({ tool: 'claude-cli', plugin, marketName: 'team-tools', listed: true, items, ...(off ? { off } : {}) });
  const server = { kind: 'mcp' as const, name: 's', description: '' }, three = ['brainstorm', 'outline', 'write'].map(skill);
  const on = docsHome([kit('writing-kit', three), kit('solo', [skill('single')]), kit('tracker', [server])], [], [['skill', 'notes', true]]);
  assert.equal(switchPreview(profile('Mine', ['skill:notes']), homeItems(on), pluginLive(on)), 'Switching turns 5 items off. Turns 3 plugins off in Claude Code');
  const off = docsHome([kit('writing-kit', three, true), kit('solo', [skill('single')]), kit('tracker', [server], true)], [], [['skill', 'notes', true]]);
  assert.equal(switchPreview(profile('Write', ['skill:notes', 'plugin:skill:writing-kit@team-tools/write']), homeItems(off), pluginLive(off)), 'Switching turns 1 item on and 1 off. Turns 1 plugin on in Claude Code. Turns 1 plugin off in Claude Code');
});

test('The result names the copy of a plugin from the marketplace each step was for, where two marketplaces bring one of that name', () => {
  const copy = (marketName: string, names: string[], off = false): InstalledPlugin => ({ tool: 'claude-cli', plugin: 'review-kit', marketName, listed: true, items: names.map(skill), ...(off ? { off } : {}) });
  const home = { pluginItems: [copy('team-a', ['read-a', 'scan-a']), copy('team-b', ['read-b', 'scan-b'], true)] } as unknown as PluginHome;
  const op = (marketName: string, action: 'plugin-on' | 'plugin-off') => ({ source: '', marketName, plugin: 'review-kit', tool: 'claude-cli' as const, action });
  const entry = { plugins: [{ id: 'plugin:skill:review-kit@team-a/read-a', name: 'read-a', tool: 'claude-cli' as const, on: true }, { id: 'plugin:skill:review-kit@team-b/read-b', name: 'read-b', tool: 'claude-cli' as const, on: false }],
    wholeSteps: [op('team-a', 'plugin-on'), op('team-b', 'plugin-off')] };
  assert.equal(wholeSaid(entry, home), ' read-a is on in Claude Code. Its whole plugin review-kit was turned on there, with its other skill, scan-a. read-b is off in Claude Code. Its whole plugin review-kit was turned off there, with its other skill, scan-b.');
});

test('A skill that comes on in Claude Code with its plugin is said to be on there after the switch, not to have stayed on, and History lists its copy', async () => {
  const { box, made } = await pluginHome();
  try {
    await writeFile(join(box.home, '.claude/settings.json'), `${JSON.stringify({ extraKnownMarketplaces: { team: { source: { source: 'directory', path: '/m' } } }, enabledPlugins: { 'docs@team': false } }, null, 2)}\n`);
    const switched = await switchProfile(box.context, box.tools, await made('One', [pdfId2]), (await sideNow(box)).side);
    assert.equal(`${turnsWords(entryTurns(switched.profile!), 'did')}${stillLoadAfter(switched.profile!, (await sideNow(box)).view)}`, '1 item turned on and 2 turned off; 1 is on in Claude Code, through its plugin');
    assert.ok(switched.profile?.plugins?.some(copy => copy.id === sheetId2 && copy.tool === 'claude-cli' && copy.on), 'spreadsheet’s copy brought on in Claude Code is in History’s list');
  } finally { await box.cleanup(); }
});

test('In use, the skills on in Claude Code with a ticked one are counted apart, and a skill on there only so reads "Off · on in Claude Code" where another tool has it off', () => {
  const claudeOnly = docsHome([docsIn('claude-cli')]), pdf = profile('Pdf', [pdfId]);
  assert.equal(switchPreview(pdf, homeItems(claudeOnly), pluginLive(claudeOnly)), 'In use · 1 item on, 1 more on in Claude Code with its plugin');
  const both = docsHome([docsIn('claude-cli'), docsIn('codex-cli', { skillsOff: ['spreadsheet'] })]);
  assert.deepEqual([inUse([pdf], homeItems(both), pluginLive(both)), pluginRowState(pdf, pluginLive(both).find(item => item.id === sheetId)!)], [[pdf], 'Off · on in Claude Code']);
});

test('Nothing is done in Claude Code for a plugin only in Codex; an unreadable Claude Code copy is held, and nothing is written there', () => {
  const codexOnly = docsHome([docsIn('codex-cli')]), work = profile('Work', [pdfId]);
  assert.deepEqual([pluginPlan(work, pluginLive(codexOnly)), wholeTurns(work, pluginLive(codexOnly))], [[{ id: sheetId, on: [], off: ['codex-cli'], held: [] }], []]);
  const unread = docsHome([docsIn('claude-cli', { items: [], problem: 'Unreadable.' }), docsIn('codex-cli')]);
  assert.deepEqual(pluginPlan(work, pluginLive(unread)).map(turn => [turn.id, turn.on, turn.off, turn.held.map(held => held.tool)]), [[pdfId, [], [], ['claude-cli']], [sheetId, [], ['codex-cli'], ['claude-cli']]]);
});

// ---------- A plugin's items: the fix round's examples, on real files ----------

const pdfId2 = docsId('skill', 'pdf-reader'), sheetId2 = docsId('skill', 'spreadsheet'), issuesId2 = docsId('mcp', 'issues');

test('A switch that turns his own Copilot CLI server on leaves the plugin’s server of that name on there without holding it, and Mine is in use', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    // His own issues, taken in for Copilot CLI alone, then turned Off: not there now.
    const others: HarnessId[] = ['claude-cli', 'codex-cli', 'pi-cli'];
    await applyServers(box.context, box.tools, [{ key: 'issues', on: true, except: others }]);
    await applyServers(box.context, box.tools, [{ key: 'issues', on: false, except: others, seenOn: true }]);
    assert.equal(JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues, undefined);
    const mine = await made('Mine', ['mcp:issues', pdfId2, sheetId2]);
    const switched = await switchProfile(box.context, box.tools, mine, (await sideNow(box)).side);
    assert.deepEqual(switched.results, []);
    assert.deepEqual([JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues?.command, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers],
      ['mine', undefined], 'his own server back, and no rule that would turn it off');
    const now = await sideNow(box);
    assert.deepEqual(await now.inUse(), ['Mine']);
    const mineProfile = (await readProfiles(box.home)).profiles.find(each => each.id === mine)!;
    const copilotCopy = now.plugins.find(item => item.id === issuesId2)!.copies.find(copy => copy.tool === 'copilot-cli')!;
    assert.deepEqual(copilotKeptOnBy(mineProfile, { id: issuesId2 }, copilotCopy), { by: 'own' });
  } finally { await box.cleanup(); }
});

test('A placed copy counts as turned only in the tools whose own removal went through: Pi’s folder not writable, OpenCode’s copy goes, Pi’s stays, and History has OpenCode', { skip: winLockSkip }, async () => {
  const { box, made } = await pluginHome({ opencode: true });
  try {
    const other = await made('Other', [sheetId2, issuesId2]), side = (await sideNow(box)).side, pi = join(box.home, '.pi/agent/skills');
    const switched = await withLock(pi, 'dir-readonly', () => switchProfile(box.context, box.tools, other, side));
    assert.deepEqual([!!(await bytes(folderOf(box, 'pi-cli', 'pdf-reader'))), await bytes(folderOf(box, 'opencode-cli', 'pdf-reader'))], [true, undefined]);
    assert.deepEqual((await history(box)).find(entry => entry.id === switched.event)!.profile?.plugins?.map(copy => copy.tool), ['codex-cli', 'opencode-cli']);
  } finally { await box.cleanup(); }
});

test('A plugin’s skill and server of one name placed in Pi, one held there: the other’s change is the switch’s, by its kind, and its Undo puts it back', { skip: winLockSkip }, async () => {
  for (const held of ['skill', 'mcp'] as const) {
    // docs's skill issues and server issues in Pi, each taken in from Pi and linked to the plugin, as its own run leaves them; his anchor beside them.
    const box = await sandbox(['pi-cli']), mcp = join(box.home, '.pi/agent/mcp.json');
    try {
      for (const key of ['issues', 'anchor']) await put(box, 'pi-cli', { 'SKILL.md': skillText(key, key) }, [], key);
      await writeFile(mcp, JSON.stringify({ mcpServers: { issues: { command: 'fixture-server' } } }));
      await applySkills(box.context, box.tools, ['issues', 'anchor'].map(key => ({ key, on: true, except: [] })));
      await applyServers(box.context, box.tools, [{ key: 'issues', on: true, except: [] }]);
      for (const store of ['skills.json', 'mcp.json']) {
        const record = join(box.home, '.central-knot', store), stored = JSON.parse(await readFile(record, 'utf8'));
        Object.assign(stored.items.issues, { source: DOCS_ID, seen: stored.items.issues.hash });
        await writeFile(record, JSON.stringify(stored));
      }
      await savePluginRecord(box.home, { tools: box.tools, knows: [...harnessIds], plugins: [{ id: DOCS_ID, source: '/m', marketName: 'team', plugin: 'docs', on: true, except: [] }] });
      const side: PluginSide = { live: async () => pluginLive({ pluginItems: [], profiles: await readProfiles(box.home), skills: await skillsView(box.context, box.tools),
        mcp: await serversView(box.context, box.tools), agents: await agentsView(box.context, box.tools) } as unknown as HomeView), run: async () => { throw new Error('Pi has placed copies only.'); } };
      const files = async () => ({ skill: await bytes(folderOf(box, 'pi-cli', 'issues')), server: JSON.parse(await readFile(mcp, 'utf8')).mcpServers.issues?.command });
      const before = await files(), folder = join(box.home, held === 'skill' ? '.pi/agent/skills' : '.pi/agent');
      const anchorOnly = (await saveProfile(box.context, { name: 'Anchor only', items: ['skill:anchor'] })).id!;
      const switched = await withLock(folder, 'dir-readonly', () => switchProfile(box.context, box.tools, anchorOnly, side));
      const went = held === 'skill' ? 'mcp' : 'skill', after = await files();
      assert.deepEqual([after, (await history(box)).find(entry => entry.id === switched.event)!.profile?.plugins?.map(copy => [copy.id, copy.tool, copy.on])],
        [held === 'skill' ? { skill: before.skill, server: undefined } : { skill: undefined, server: 'fixture-server' }, [[`plugin:${went}:docs@team/issues`, 'pi-cli', false]]],
        `Pi’s ${held} held: it stays, and the entry has the ${went}’s copy, which went`);
      await undoSwitch(box.context, box.tools, switched.event!, side);
      assert.deepEqual(await files(), before, `Pi’s ${held} held: the Undo puts the ${went} back`);
    } finally { await box.cleanup(); }
  }
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

test('A disable rule an earlier switch wrote for the plugin’s server goes when a switch turns his own server of that name on: Quiet, then Dev, then Undo restores the prior rule', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    const others: HarnessId[] = ['claude-cli', 'codex-cli', 'pi-cli'];
    await applyServers(box.context, box.tools, [{ key: 'issues', on: true, except: others }]);
    await applyServers(box.context, box.tools, [{ key: 'issues', on: false, except: others, seenOn: true }]);
    const copilot = async () => ({ his: !!JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues, disabled: JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers ?? [] });
    await switchProfile(box.context, box.tools, await made('Quiet', [pdfId2, sheetId2]), (await sideNow(box)).side);
    assert.deepEqual(await copilot(), { his: false, disabled: ['issues'] }, 'Quiet: neither, so the plugin’s goes off by its name');
    const dev = await switchProfile(box.context, box.tools, await made('Dev', ['mcp:issues', pdfId2, sheetId2]), (await sideNow(box)).side);
    assert.deepEqual([await copilot(), dev.results, dev.settingsChanged],
      [{ his: true, disabled: [] }, [], ['Copilot CLI’s off-switch for “issues” was cleared; there the plugin’s “issues” runs, not yours (same name).']], 'Dev: his back, rule gone, no hold');
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Dev']);
    await undoSwitch(box.context, box.tools, dev.event!, (await sideNow(box)).side);
    assert.deepEqual(await copilot(), { his: false, disabled: ['issues'] }, 'Undo puts the earlier disable rule back');
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

// ---------- His item, which a plugin still loads ----------
// kit@team, installed in Claude Code (`claude` false: not there; `enabled` false: turned off there) and with `codex` in Codex, brings the skill triage, and
// with `parts` the MCP server tracker and the agent reviewer, each of the same content as his. His own triage and keep are in the
// folder of `mine` (Codex's by default), taken in and On: Central Knot writes keep into the other tool, and nothing of triage where
// the plugin brings the same skill (skills.ts pluginFor). A profile names its items; a plugin's by docsId's form for kit.

const kitId = (kind: ItemKind, key: string) => `plugin:${kind}:kit@team/${key}`;
const KIT_TRACKER = { command: 'npx', args: ['-y', 'tracker'] }, KIT_REVIEWER = { name: 'reviewer', description: 'Reviews a change.', prompt: 'You review changes.' };

async function kitHome({ claude = true, codex = false, enabled = true, triage = 'The triage skill.', mine = 'codex-cli' as Three, shared = [] as string[], parts = false, sibling = false } = {}) {
  const box = await sandbox(['claude-cli', 'codex-cli']);
  const copyIn = async (folder: string) => {
    await putFile(join(folder, 'skills/triage/SKILL.md'), skillText(triage, 'triage'));
    // With `sibling`, a second skill, sort, which a profile can tick to keep kit on in Claude Code while its triage goes off in Codex.
    if (sibling) await putFile(join(folder, 'skills/sort/SKILL.md'), skillText('The sort skill.', 'sort'));
    await putFile(join(folder, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit', version: '1.0.0' }));
    await putFile(join(folder, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'kit', version: '1.0.0', skills: './skills' }));
    if (!parts) return;
    await putFile(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { tracker: KIT_TRACKER } }));
    await putFile(join(folder, 'agents/reviewer.md'), `---\nname: ${KIT_REVIEWER.name}\ndescription: ${KIT_REVIEWER.description}\n---\n\n${KIT_REVIEWER.prompt}\n`);
  };
  if (claude) {
    const market = { team: { source: { source: 'directory', path: '/m' } } }, cache = join(box.home, '.claude/plugins/cache/team/kit/1.0.0');
    await copyIn(cache);
    await putFile(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'kit@team': [{ scope: 'user', installPath: cache, version: '1.0.0' }] } }));
    await putFile(join(box.home, '.claude/settings.json'), `${JSON.stringify({ extraKnownMarketplaces: market, enabledPlugins: { 'kit@team': enabled } }, null, 2)}\n`);
  }
  if (codex) {
    await copyIn(join(box.home, '.codex/plugins/cache/team/kit/1.0.0'));
    await putFile(join(box.home, '.codex/config.toml'), '[marketplaces.team]\nsource = "/m"\n\n[plugins."kit@team"]\nenabled = true\n');
  }
  for (const name of ['triage', 'keep']) if (!shared.includes(name)) await put(box, mine, { 'SKILL.md': skillText(`The ${name} skill.`, name) }, [], name);
  for (const name of shared) await putShared(box, name);
  await applySkills(box.context, box.tools, ['triage', 'keep', ...shared.filter(name => name !== 'triage')].map(key => ({ key, on: true, except: [] })));
  if (parts) {
    await putFile(join(box.home, '.codex/config.toml'), `[mcp_servers.tracker]\ncommand = "npx"\nargs = ["-y", "tracker"]\n`);
    await putFile(join(box.home, '.codex/agents/reviewer.toml'), `name = "reviewer"\ndescription = "${KIT_REVIEWER.description}"\ndeveloper_instructions = "${KIT_REVIEWER.prompt}"\n`);
    await applyServers(box.context, box.tools, [{ key: 'tracker', on: true, except: [] }]);
    await applyAgents(box.context, box.tools, [{ key: 'reviewer', on: true, except: [] }]);
  }
  const made = async (name: string, items: string[]) => (await saveProfile(box.context, { name, items })).id!;
  /** What a switch to `name` would do (the page's header and both menus), and what its result says once switched (app.ts): its count, then stillLoadAfter. */
  const preview = async (name: string) => { const now = await sideNow(box); return switchPreview((await readProfiles(box.home)).profiles.find(each => each.name === name)!, now.live, now.plugins); };
  const result = async (id: string) => {
    const switched = await switchProfile(box.context, box.tools, id, (await sideNow(box)).side);
    return `${turnsWords(entryTurns(switched.profile!), 'did')}${stillLoadAfter(switched.profile!, (await sideNow(box)).view)}`;
  };
  return { box, made, preview, result };
}
/** The plugin's files in Claude Code: its settings, its record and its copy. */
const kitFiles = async (box: Box) => ({ settings: await text(box, '.claude/settings.json'), record: await text(box, '.claude/plugins/installed_plugins.json'),
  triage: await bytes(join(box.home, '.claude/plugins/cache/team/kit/1.0.0/skills/triage')) });

test('His triage in Codex, the same skill a plugin brings in Claude Code: a switch that turns his off says Claude Code still loads it through a plugin, before and after; Codex’s folder goes, the plugin’s files stay', async () => {
  const { box, made, preview, result } = await kitHome();
  try {
    const quiet = await made('Quiet', ['skill:keep', kitId('skill', 'triage')]), before = await kitFiles(box);
    assert.equal(await preview('Quiet'), 'Switching turns 1 item off; 1 still loads through a plugin, in Claude Code');
    assert.equal(await result(quiet), '1 item turned off; 1 still loads through a plugin, in Claude Code');
    assert.deepEqual([await bytes(folderOf(box, 'codex-cli', 'triage')), await kitFiles(box)], [undefined, before], 'Codex’s copy gone; the plugin as it was');
  } finally { await box.cleanup(); }
});

test('A plugin’s copy keeps nothing of his that the same switch turns off: kit in Codex, his triage in Claude Code’s folder, a profile that leaves both out turns both off and nothing still loads', async () => {
  const { box, made, preview, result } = await kitHome({ claude: false, codex: true, mine: 'claude-cli' });
  try {
    const quiet = await made('Quiet', ['skill:keep']);
    assert.equal(await preview('Quiet'), 'Switching turns 2 items off');
    assert.equal(await result(quiet), '2 items turned off');
  } finally { await box.cleanup(); }
});

test('A plugin turned off in Claude Code keeps nothing on: his triage’s switch says nothing still loads', async () => {
  const { box, made, preview } = await kitHome({ enabled: false });
  try {
    await made('Quiet', ['skill:keep']);
    assert.equal(await preview('Quiet'), 'Switching turns 1 item off');
  } finally { await box.cleanup(); }
});

test('A plugin’s triage with other content is another item: nothing is said of his', async () => {
  const { box, made, preview } = await kitHome({ triage: 'Another triage.' });
  try {
    await made('Quiet', ['skill:keep', kitId('skill', 'triage')]);
    assert.equal(await preview('Quiet'), 'Switching turns 1 item off');
  } finally { await box.cleanup(); }
});

test('His triage kept out of Claude Code, where a plugin’s triage with other content is on: a switch that turns his off says nothing of Claude Code, before it or after it', async () => {
  const { box, made, preview, result } = await kitHome({ triage: 'Another triage.' });
  try {
    // Kept out: Central Knot's copy leaves Claude Code, so no copy of his is there to hide the plugin's another skill of that name.
    await applySkills(box.context, box.tools, [{ key: 'triage', on: true, except: ['claude-cli'] }]);
    const quiet = await made('Quiet', ['skill:keep', kitId('skill', 'triage')]);
    assert.deepEqual([await bytes(folderOf(box, 'claude-cli', 'triage')), await preview('Quiet')], [undefined, 'Switching turns 1 item off']);
    assert.equal(await result(quiet), '1 item turned off');
  } finally { await box.cleanup(); }
});

test('His triage only in the shared folder, which Codex reads, and through the plugin in Claude Code: one item, still loading another way, in either', async () => {
  const { box, made, preview } = await kitHome({ shared: ['triage'] });
  try {
    await made('Quiet', ['skill:keep', kitId('skill', 'triage')]);
    assert.equal(await preview('Quiet'), 'Switching turns 1 item off; 1 still loads another way, in Claude Code or Codex');
  } finally { await box.cleanup(); }
});

test('Two of his skills, one kept by the plugin in Claude Code and one by the shared folder in Codex: both counted, said as the mixed case', async () => {
  const { box, made, preview } = await kitHome({ shared: ['notes'] });
  try {
    await made('Quiet', ['skill:keep', kitId('skill', 'triage')]);
    assert.equal(await preview('Quiet'), 'Switching turns 2 items off; 2 still load another way, in Claude Code or Codex');
  } finally { await box.cleanup(); }
});

test('The plugin in Claude Code and Codex, his triage in Codex, a profile that leaves both out: the plugin goes off in Claude Code too, so only Codex’s folder, his own there (Central Knot never wrote it: Codex has the plugin’s), still loads, as before', async () => {
  const { box, made, preview, result } = await kitHome({ codex: true });
  try {
    const quiet = await made('Quiet', ['skill:keep']);
    const both = '2 items off; 1 still loads from a copy of yours there, in Codex';
    assert.equal(await preview('Quiet'), `Switching turns ${both}. Turns 1 plugin off in Claude Code`);
    assert.equal(await result(quiet), `2 items turned off; ${both.split('; ').slice(1).join('; ')}`);
  } finally { await box.cleanup(); }
});

/**
 * His triage's row in the Library, as the page makes it from the home now (matrix.ts rowsOf: the view's facts, with where a
 * plugin has it on): its tag, and what Codex's cell reads (whether Codex loads a copy, and how its line says Codex has it).
 */
async function triageRow(box: Box) {
  const { view } = await sideNow(box), facts = view.skills.items.find(each => each.key === 'triage')!;
  const row = { ...facts, hashes: hashesOf(facts.copies), pluginOn: pluginOnIn(view, 'skills', facts) };
  return { tag: sentences(libraryWords.skills).placeTag(row, view.skills.library.triage, view.skills.tools), codex: { loads: !!facts.loads?.['codex-cli'], way: facts.anotherWay?.['codex-cli'] } };
}

test('The plugin in Claude Code and Codex, his triage in Codex, both turned off by a switch: his row says it is in Central Knot, Claude Code and Codex, and its tooltip says why of each', async () => {
  const { box, made, result } = await kitHome({ codex: true, sibling: true });
  try {
    // Quiet ticks kit's sort, so kit stays on in Claude Code with its triage; Codex turns its triage off by its own switch.
    await result(await made('Quiet', ['skill:keep', kitId('skill', 'sort')]));
    assert.match((await text(box, '.codex/config.toml'))!, /name = "kit:triage"\nenabled = false/);
    assert.deepEqual((await triageRow(box)).tag, { text: 'in Central Knot, Claude Code and Codex', title: 'Central Knot keeps this skill and its versions. '
      + 'Claude Code has it on through its plugin: its switch there, in the opened row, turns that off. Codex has a copy Central Knot didn’t put there, left alone while the skill is off.' });
  } finally { await box.cleanup(); }
});

test('The same, then his copy in Codex switched off by path in Codex’s own settings: Codex loads nothing, so his row says it is on in Claude Code only, through its plugin, as its tooltip does', async () => {
  const { box, made, result } = await kitHome({ codex: true, sibling: true });
  try {
    await result(await made('Quiet', ['skill:keep', kitId('skill', 'sort')]));
    await setDisabled(box.context, 'codex-cli', { folder: 'triage', name: 'triage', skillFile: join(folderOf(box, 'codex-cli', 'triage'), 'SKILL.md') }, true);
    assert.deepEqual((await triageRow(box)).tag, { text: 'on in Claude Code only, through its plugin',
      title: 'Central Knot keeps this skill and its versions. Claude Code has it on through its plugin: its switch there, in the opened row, turns that off.' });
  } finally { await box.cleanup(); }
});

test('His triage only in the shared folder, which Codex reads, and the same skill through a plugin in Codex, both turned off by a switch: Codex then loads the shared folder’s, and the result, his row and Codex’s cell say so; the preview, read while the plugin’s part is on, can’t', async () => {
  const { box, made, preview, result } = await kitHome({ claude: false, codex: true, shared: ['triage'] });
  try {
    const quiet = await made('Quiet', ['skill:keep']);
    assert.equal(await preview('Quiet'), 'Switching turns 2 items off');
    assert.equal(await result(quiet), '2 items turned off; 1 still loads from the shared skills folder, in Codex');
    const { tag, codex } = await triageRow(box);
    assert.deepEqual([tag?.text, codex], ['in Central Knot and Codex', { loads: true, way: 'Codex also reads a copy at …/.agents/skills, which is not Central Knot’s.' }]);
  } finally { await box.cleanup(); }
});

test('The same, with the shared folder’s triage switched off by path in Codex’s own settings: nothing still loads, and neither the preview nor the result says one does', async () => {
  const { box, made, preview, result } = await kitHome({ claude: false, codex: true, shared: ['triage'] });
  try {
    await setDisabled(box.context, 'codex-cli', { folder: 'triage', name: 'triage', skillFile: join(box.home, '.agents/skills/triage/SKILL.md') }, true);
    const quiet = await made('Quiet', ['skill:keep']);
    assert.deepEqual([await preview('Quiet'), await result(quiet)], ['Switching turns 2 items off', '2 items turned off']);
  } finally { await box.cleanup(); }
});

test('A profiles file from before, where Codex’s plugin part is off and Codex loads his triage from the shared folder: the move releases the rule it listed for that copy, turns triage Off as held everywhere, and History says so', async () => {
  const { box } = await kitHome({ claude: false, codex: true, shared: ['triage'] });
  try {
    const config = join(box.home, '.codex/config.toml'), partOff = '\n[[skills.config]]\nname = "kit:triage"\nenabled = false\n';
    await writeFile(config, `${await readFile(config, 'utf8')}${partOff}`);
    // What the earlier profile switch set: Claude Code's override for its folder, Codex's rule for the copy it loads.
    await setDisabled(box.context, 'claude-cli', { folder: 'triage', name: 'triage', skillFile: join(folderOf(box, 'claude-cli', 'triage'), 'SKILL.md') }, true);
    await setDisabled(box.context, 'codex-cli', { folder: 'triage', name: 'triage', skillFile: join(box.home, '.agents/skills/triage/SKILL.md') }, true);
    const old = { formatVersion: 1, profiles: [{ id: 'dev', name: 'Dev', items: ['skill:keep'] }], offByProfile: { 'skill:triage': ['claude-cli', 'codex-cli'] } };
    await writeFile(join(box.home, '.central-knot/profiles.json'), JSON.stringify(old));
    await migrateProfiles(box.context, box.tools);
    const [told] = (await history(box)).filter(entry => entry.kind === 'profile');
    assert.deepEqual([await text(box, '.codex/config.toml'), await text(box, '.claude/settings.json'), Object.fromEntries((await live(box)).map(item => [item.id, item.on])), names(told.profile?.off ?? [])],
      ['[marketplaces.team]\nsource = "/m"\n\n[plugins."kit@team"]\nenabled = true\n' + partOff, '{}\n', { 'skill:triage': false, 'skill:keep': true }, ['triage']]);
  } finally { await box.cleanup(); }
});

test('His triage only in the shared folder turned off, the same skill through a plugin kept on in Codex: the plugin’s is what Codex loads, and what is said', async () => {
  const { box, made, preview, result } = await kitHome({ claude: false, codex: true, shared: ['triage'] });
  try {
    const quiet = await made('Quiet', ['skill:keep', kitId('skill', 'triage')]), still = '1 still loads through a plugin, in Codex';
    assert.equal(await preview('Quiet'), `Switching turns 1 item off; ${still}`);
    assert.equal(await result(quiet), `1 item turned off; ${still}`);
    const { tag, codex } = await triageRow(box);
    assert.deepEqual([tag?.text, codex.loads], ['on in Codex only, through its plugin', false]);
  } finally { await box.cleanup(); }
});

test('His triage in Codex turned off, the same skill through a plugin in Claude Code alone: his row says it is on in Claude Code only, through its plugin', async () => {
  const { box, made, result } = await kitHome();
  try {
    await result(await made('Quiet', ['skill:keep', kitId('skill', 'triage')]));
    assert.equal((await triageRow(box)).tag?.text, 'on in Claude Code only, through its plugin');
  } finally { await box.cleanup(); }
});

test('An MCP server and an agent of his that the plugin brings alike in Claude Code still load there through it while the profile keeps the plugin’s; one that turns the plugin’s off too leaves nothing', async () => {
  const { box, made, preview, result } = await kitHome({ parts: true });
  try {
    const plugin = [kitId('mcp', 'tracker'), kitId('agent', 'reviewer')];
    const servers = await made('No tracker', ['skill:keep', 'skill:triage', 'agent:reviewer', ...plugin]);
    await made('No reviewer', ['skill:keep', 'skill:triage', 'mcp:tracker', ...plugin]);
    await made('Bare', ['skill:keep', 'skill:triage']);
    // Bare ticks nothing of kit, so kit goes off in Claude Code: his server and agent, and kit's skill, server and agent.
    assert.deepEqual([await preview('No tracker'), await preview('No reviewer'), await preview('Bare')], ['Switching turns 1 item off; 1 still loads through a plugin, in Claude Code',
      'Switching turns 1 item off; 1 still loads through a plugin, in Claude Code', 'Switching turns 5 items off. Turns 1 plugin off in Claude Code']);
    assert.equal(await result(servers), '1 item turned off; 1 still loads through a plugin, in Claude Code');
  } finally { await box.cleanup(); }
});

test('A switch that turns the plugin’s server on in Claude Code, where its own switch had it off, counts it as turned on and says nothing more of his: before the switch and after it alike', async () => {
  const { box, made, preview, result } = await kitHome({ parts: true });
  try {
    const settings = join(box.home, '.claude/settings.json');
    await writeFile(settings, `${JSON.stringify({ ...JSON.parse((await text(box, '.claude/settings.json'))!), deniedMcpServers: [{ serverName: 'plugin:kit:tracker' }] }, null, 2)}\n`);
    const theirs = await made('Theirs', ['skill:keep', 'skill:triage', 'agent:reviewer', kitId('mcp', 'tracker'), kitId('agent', 'reviewer')]);
    assert.equal(await preview('Theirs'), 'Switching turns 1 item on and 1 off');
    assert.equal(await result(theirs), '1 item turned on and 1 turned off');
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

test('A deny kept by an earlier build, cleared after a pass that found nothing to do: that pass leaves its read to no view, as Claude Code’s settings changed after it (librarypass.ts KeptReads)', async () => {
  const { box } = await oldHome();
  try {
    await applyServers(box.context, box.tools, [{ key: 'sentry', on: true, except: [], seenOn: false }]);
    // What such a build left: sentry On, with its deny still in Claude Code's settings and listed as kept.
    const settings = join(box.home, SETTINGS['claude-cli']);
    await writeFile(settings, withMcpSwitch('claude-cli', (await text(box, SETTINGS['claude-cli'])) ?? '', 'sentry', true));
    await keepDenies(box.home, ['sentry']);
    const kept = new Map(), done = await applyServers({ ...box.context, kept }, box.tools, [], { background: true });
    assert.deepEqual([done.untouched, kept.has('mcp'), JSON.parse((await text(box, SETTINGS['claude-cli']))!).deniedMcpServers ?? []], [undefined, false, []]);
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

// ---------- An older profile leaves plugin items alone until chosen ----------

/** Sets up docs@team in Claude Code, Codex, Copilot CLI and Pi, with pdf-reader on in Codex and off in Copilot CLI, plus his own skill `notes` (Off). */
async function mixedPluginHome() {
  const { box, made } = await pluginHome({ copilot: true });
  await put(box, 'claude-cli', { 'SKILL.md': skillText('My notes.', 'notes') }, [], 'notes');
  await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
  await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [], seenOn: true }]);
  // pdf-reader stays on in Codex, and is off in Copilot CLI by its own switch (`plugin:skill`).
  const copilotSettings = JSON.parse((await text(box, '.copilot/settings.json'))!);
  await writeFile(join(box.home, '.copilot/settings.json'), `${JSON.stringify({ ...copilotSettings, disabledSkills: ['docs:pdf-reader'] }, null, 2)}\n`);
  return { box, made };
}

const mixedPluginFiles = async (box: Box) => ({
  codex: await text(box, '.codex/config.toml'),
  copilot: await text(box, '.copilot/settings.json'),
  claude: await text(box, '.claude/settings.json'),
  piPdf: await bytes(folderOf(box, 'pi-cli', 'pdf-reader')),
  piSheet: await bytes(folderOf(box, 'pi-cli', 'spreadsheet')),
});

test('A format 2 profile leaves mixed plugin copies alone on switch and Undo, is in use by his own items, and never rewrites the format 2 file', async () => {
  const { box } = await mixedPluginHome();
  try {
    const format2 = `${JSON.stringify({ formatVersion: 2, profiles: [{ id: 'legacy', name: 'Legacy', items: ['skill:notes'] }] }, null, 2)}\n`;
    await writeFile(join(box.home, '.central-knot/profiles.json'), format2);
    const beforeFiles = await mixedPluginFiles(box);
    const read = await readProfiles(box.home), legacy = read.profiles[0]!;
    assert.equal(legacy.switchesPluginItems, false);
    const first = await sideNow(box);
    assert.deepEqual(pluginPlan(legacy, first.plugins), [], 'a non-managing profile plans no plugin copy');
    assert.equal(pluginItemsAgree(legacy, first.plugins), true);

    // Switch: turns his own skill `notes` On, leaves every plugin copy and profiles.json byte for byte.
    const switched = await switchProfile(box.context, box.tools, 'legacy', first.side);
    assert.deepEqual([switched.stopped, switched.on, switched.off, switched.results], [undefined, ['notes'], [], []]);
    assert.deepEqual(await mixedPluginFiles(box), beforeFiles, 'Codex, Copilot CLI, Claude Code and Pi plugin copies byte for byte');
    assert.equal(await text(box, '.central-knot/profiles.json'), format2, 'profiles.json stays format 2, byte for byte');
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Legacy'], 'in use by his own items alone');
    assert.equal((await history(box)).at(-1)!.profile?.plugins, undefined, 'History records no plugin change');

    // Undo: turns `notes` back Off, still leaves every plugin copy and format 2 profiles.json byte for byte.
    const undone = await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.stopped, undone.switched], [undefined, { on: [], off: ['notes'], left: [] }]);
    assert.deepEqual(await mixedPluginFiles(box), beforeFiles);
    assert.equal(await text(box, '.central-knot/profiles.json'), format2);
    assert.deepEqual(await (await sideNow(box)).inUse(), []);
  } finally { await box.cleanup(); }
});

test('Choosing plugin items on an older profile keeps his own tick, starts with no plugin tick, switches plugin copies on and off, writes format 3, and survives reopening', async () => {
  const { box } = await mixedPluginHome();
  try {
    const format2 = `${JSON.stringify({ formatVersion: 2, profiles: [{ id: 'legacy', name: 'Legacy', items: ['skill:notes'] }] }, null, 2)}\n`;
    await writeFile(join(box.home, '.central-knot/profiles.json'), format2);
    const beforeFiles = await mixedPluginFiles(box);

    // Choose plugin items: changes only profiles.json (now format 3 with switchesPluginItems: true); no plugin ticks added, no tool written.
    const chosen = await saveProfile(box.context, { id: 'legacy', switchesPluginItems: true });
    assert.equal(chosen.problem, undefined);
    assert.deepEqual(await mixedPluginFiles(box), beforeFiles, 'choosing writes no tool file');
    const saved = JSON.parse((await text(box, '.central-knot/profiles.json'))!);
    assert.deepEqual(saved, { formatVersion: 3, profiles: [{ id: 'legacy', name: 'Legacy', items: ['skill:notes'], switchesPluginItems: true }] });

    // Tick pdf-reader (keeping his own notes ticked) and switch: pdf-reader is on in both Codex and Copilot CLI.
    await saveProfile(box.context, { id: 'legacy', items: ['skill:notes', pdfId2] });
    const onBoth = await switchProfile(box.context, box.tools, 'legacy', (await sideNow(box)).side);
    assert.equal(onBoth.stopped, undefined);
    assert.equal(await text(box, '.codex/config.toml'), `${CODEX_BEFORE}\n[[skills.config]]\nname = "docs:spreadsheet"\nenabled = false\n\n[plugins."docs@team".mcp_servers.issues]\nenabled = false\n`, 'pdf-reader stays on in Codex while unticked items turn off');
    assert.deepEqual(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledSkills, ['docs:spreadsheet'], 'pdf-reader turned on in Copilot CLI; unticked spreadsheet turned off');

    // Untick pdf-reader (keeping his own notes ticked) and switch: pdf-reader is off in both Codex and Copilot CLI, and docs, now
    // with nothing ticked, goes off in Claude Code with spreadsheet, which had come on there with pdf-reader.
    await saveProfile(box.context, { id: 'legacy', items: ['skill:notes'] });
    const offBoth = await switchProfile(box.context, box.tools, 'legacy', (await sideNow(box)).side);
    assert.deepEqual([offBoth.stopped, offBoth.off], [undefined, ['pdf-reader', 'spreadsheet']]);
    assert.match((await text(box, '.codex/config.toml'))!, /name = "docs:pdf-reader"\nenabled = false/);
    assert.deepEqual(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledSkills.sort(), ['docs:pdf-reader', 'docs:spreadsheet']);

    // Reopen (fresh read from disk): format 3 keeps switchesPluginItems: true, even if a save omits or passes false (no way back).
    await saveProfile(box.context, { id: 'legacy', switchesPluginItems: false });
    const reopened = (await readProfiles(box.home)).profiles[0]!;
    assert.deepEqual(reopened, { id: 'legacy', name: 'Legacy', items: ['skill:notes'], switchesPluginItems: true });
    await writeFile(join(box.home, '.codex/config.toml'), CODEX_BEFORE);
    assert.ok(pluginPlan(reopened, (await sideNow(box)).plugins).some(turn => turn.id === pdfId2 && turn.off.includes('codex-cli')));
  } finally { await box.cleanup(); }
});

test('A new empty profile cannot be switched; ticking one item of his own lets an empty plugin selection turn every switchable plugin item off, and the whole plugin off in Claude Code', async () => {
  const { box } = await pluginHome({ copilot: true });
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('My notes.', 'notes') }, [], 'notes');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    const freshId = (await saveProfile(box.context, { name: 'Fresh', items: [] })).id!;
    const fresh = (await readProfiles(box.home)).profiles[0]!;
    assert.equal(fresh.switchesPluginItems, true);
    assert.equal(JSON.parse((await text(box, '.central-knot/profiles.json'))!).formatVersion, 3);
    const before = await sideNow(box);
    assert.equal(switchable(fresh, await live(box), before.plugins), false, 'empty profile is not offered to switch to');

    // Tick his own `notes` (already On): now switchable, and the empty plugin selection turns every switchable plugin item off.
    await saveProfile(box.context, { id: freshId, items: ['skill:notes'] });
    const ready = (await readProfiles(box.home)).profiles[0]!;
    assert.equal(switchable(ready, await live(box), before.plugins), true);
    const plan = pluginPlan(ready, before.plugins);
    assert.deepEqual(plan.filter(turn => turn.off.length).map(turn => turn.id).sort(), [issuesId2, pdfId2, sheetId2]);
    const switched = await switchProfile(box.context, box.tools, freshId, before.side);
    assert.deepEqual([switched.stopped, switched.on, switched.off.sort()], [undefined, [], ['issues', 'pdf-reader', 'spreadsheet']]);
    assert.deepEqual(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledSkills.sort(), ['docs:pdf-reader', 'docs:spreadsheet']);
    assert.deepEqual(await bytes(folderOf(box, 'pi-cli', 'pdf-reader')), undefined);
    assert.deepEqual(await bytes(folderOf(box, 'pi-cli', 'spreadsheet')), undefined);
    const claude = JSON.parse((await text(box, '.claude/settings.json'))!);
    assert.deepEqual([claude.enabledPlugins, claude.deniedMcpServers], [{ 'docs@team': false }, undefined], 'off whole there; its server’s own switch left as it was');
  } finally { await box.cleanup(); }
});

test('A plugin installed after a managing and a non-managing profile: the managing one turns its items off at the next switch, the non-managing one leaves them', async () => {
  const { box } = await pluginHome({ copilot: true });
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('My notes.', 'notes') }, [], 'notes');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await writeFile(join(box.home, '.central-knot/profiles.json'), `${JSON.stringify({ formatVersion: 3, profiles: [
      { id: 'old', name: 'Old', items: ['skill:notes'], switchesPluginItems: false },
      { id: 'modern', name: 'Modern', items: ['skill:notes', pdfId2, sheetId2, issuesId2], switchesPluginItems: true },
    ] }, null, 2)}\n`);
    // A second plugin `tracker` (with skill `triage`) is installed later in Codex and Copilot CLI.
    const trackerCodex = join(box.home, '.codex/plugins/cache/team/tracker/1.0.0');
    const trackerCopilot = join(box.home, '.copilot/installed-plugins/team/tracker');
    for (const folder of [trackerCodex, trackerCopilot]) {
      await putFile(join(folder, 'skills/triage/SKILL.md'), skillText('Triage.', 'triage'));
      await putFile(join(folder, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'tracker', version: '1.0.0', skills: './skills' }));
    }
    await writeFile(join(box.home, '.codex/config.toml'), `${CODEX_BEFORE}\n[plugins."tracker@team"]\nenabled = true\n`);
    const copilotCfg = JSON.parse((await text(box, '.copilot/config.json'))!);
    copilotCfg.installedPlugins.push({ name: 'tracker', marketplace: 'team', version: '1.0.0', cache_path: trackerCopilot, enabled: true });
    await writeFile(join(box.home, '.copilot/config.json'), JSON.stringify(copilotCfg));

    const beforeCodex = await text(box, '.codex/config.toml'), beforeCopilot = await text(box, '.copilot/settings.json');
    const now = await sideNow(box), [old, modern] = (await readProfiles(box.home)).profiles;
    assert.deepEqual(pluginPlan(old!, now.plugins), [], 'Old leaves the newly installed plugin alone');
    assert.deepEqual(await now.inUse(), ['Old'], 'Old stays in use; Modern does not until switched');
    assert.deepEqual(pluginPlan(modern!, now.plugins).map(turn => [turn.id, turn.on, turn.off]),
      [['plugin:skill:tracker@team/triage', [], ['codex-cli', 'copilot-cli']]]);

    // Switching to Old (with notes off first so the switch runs) leaves tracker's triage untouched.
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [], seenOn: true }]);
    await switchProfile(box.context, box.tools, 'old', (await sideNow(box)).side);
    assert.deepEqual([await text(box, '.codex/config.toml'), await text(box, '.copilot/settings.json')], [beforeCodex, beforeCopilot]);

    // Switching to Modern turns tracker's triage off in both Codex and Copilot CLI.
    const switched = await switchProfile(box.context, box.tools, 'modern', (await sideNow(box)).side);
    assert.deepEqual([switched.stopped, switched.off], [undefined, ['triage']]);
    assert.match((await text(box, '.codex/config.toml'))!, /name = "tracker:triage"\nenabled = false/);
    assert.deepEqual(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledSkills, ['tracker:triage']);
  } finally { await box.cleanup(); }
});

test('Renaming, ticking, or deleting and undoing a non-managing profile keeps it non-managing in format 3, with dormant ticks intact; format 1 migration stays format 2 non-managing', async () => {
  const { box } = await mixedPluginHome();
  try {
    const format2 = `${JSON.stringify({ formatVersion: 2, profiles: [{ id: 'legacy', name: 'Legacy', items: ['skill:notes', 'skill:dormant'] }] }, null, 2)}\n`;
    await writeFile(join(box.home, '.central-knot/profiles.json'), format2);

    // Rename: file becomes format 3 and records switchesPluginItems: false; dormant tick stays.
    await saveProfile(box.context, { id: 'legacy', name: 'Old work' });
    assert.deepEqual(JSON.parse((await text(box, '.central-knot/profiles.json'))!),
      { formatVersion: 3, profiles: [{ id: 'legacy', name: 'Old work', items: ['skill:notes', 'skill:dormant'], switchesPluginItems: false }] });

    // Ticking his own items keeps switchesPluginItems: false.
    await saveProfile(box.context, { id: 'legacy', items: ['skill:notes', 'skill:dormant', 'skill:extra'] });
    assert.equal((await readProfiles(box.home)).profiles[0]?.switchesPluginItems, false);

    // Delete -> Undo (restore) keeps switchesPluginItems: false and dormant ticks.
    const gone = (await readProfiles(box.home)).profiles[0]!;
    await deleteProfile(box.context, gone.id);
    assert.deepEqual((await readProfiles(box.home)).profiles, []);
    await saveProfile(box.context, { ...gone, restore: true });
    assert.deepEqual((await readProfiles(box.home)).profiles, [gone]);
  } finally { await box.cleanup(); }

  // Format 1 migration writes format 2, and every moved profile is read as non-managing.
  const { box: migrated } = await oldHome('dev');
  try {
    await migrateProfiles(migrated.context, migrated.tools);
    assert.equal(JSON.parse((await text(migrated, '.central-knot/profiles.json'))!).formatVersion, 2);
    assert.deepEqual((await readProfiles(migrated.home)).profiles.map(each => each.switchesPluginItems), [false, false]);
  } finally { await migrated.cleanup(); }
});

test('Saving writes format 3 (above format 2), and this reader’s format > FORMAT_VERSION rule refuses a format 4 file without changing a byte', async () => {
  const { box } = await home();
  try {
    await saveProfile(box.context, { name: 'Modern', items: ['skill:dev'] });
    const raw = (await text(box, '.central-knot/profiles.json'))!;
    assert.equal(JSON.parse(raw).formatVersion, 3, 'saved in format 3, so a format 2 reader refuses it under format > FORMAT_VERSION');
    // The reader's own format > FORMAT_VERSION check refuses any file saved by a newer format without touching it.
    const newer = `${JSON.stringify({ formatVersion: 4, profiles: [{ id: 'future', name: 'Future', items: ['skill:dev'], switchesPluginItems: true }] }, null, 2)}\n`;
    await writeFile(join(box.home, '.central-knot/profiles.json'), newer);
    assert.match((await readProfiles(box.home)).problem ?? '', /saved by a newer Central Knot.*Nothing in it was changed/);
    assert.match((await saveProfile(box.context, { name: 'Other' })).problem ?? '', /saved by a newer Central Knot/);
    assert.match((await switchProfile(box.context, box.tools, 'future', NO_PLUGINS)).stopped ?? '', /saved by a newer Central Knot/);
    assert.equal(await text(box, '.central-knot/profiles.json'), newer, 'newer file left byte for byte');
  } finally { await box.cleanup(); }
});

test('Choosing plugin items on a non-managing profile that already holds a plugin id drops plugin ids while keeping live and dormant personal ids', async () => {
  const { box } = await mixedPluginHome();
  try {
    const format2 = `${JSON.stringify({ formatVersion: 2, profiles: [{ id: 'hand', name: 'Hand', items: ['skill:notes', 'skill:dormant', pdfId2] }] }, null, 2)}\n`;
    await writeFile(join(box.home, '.central-knot/profiles.json'), format2);

    // Choose (false -> true): drops plugin ids, keeps live and dormant personal ids, starts with zero plugin ticks.
    assert.equal((await saveProfile(box.context, { id: 'hand', switchesPluginItems: true })).problem, undefined);
    assert.deepEqual(JSON.parse((await text(box, '.central-knot/profiles.json'))!),
      { formatVersion: 3, profiles: [{ id: 'hand', name: 'Hand', items: ['skill:notes', 'skill:dormant'], switchesPluginItems: true }] });

    // Switching without ticking anything must not turn pdf-reader on in Copilot CLI; it turns unticked plugin items off.
    const switched = await switchProfile(box.context, box.tools, 'hand', (await sideNow(box)).side);
    assert.equal(switched.stopped, undefined);
    assert.deepEqual(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledSkills.sort(), ['docs:pdf-reader', 'docs:spreadsheet']);
    assert.match((await text(box, '.codex/config.toml'))!, /name = "docs:pdf-reader"\nenabled = false/);

    // Already managing: ticking a plugin id and saving again with switchesPluginItems: true keeps that plugin tick.
    await saveProfile(box.context, { id: 'hand', items: ['skill:notes', 'skill:dormant', pdfId2] });
    await saveProfile(box.context, { id: 'hand', switchesPluginItems: true });
    assert.deepEqual((await readProfiles(box.home)).profiles[0]?.items, ['skill:notes', 'skill:dormant', pdfId2]);
  } finally { await box.cleanup(); }
});

test('saveProfiles is the one writer of profiles.json: format 3 by default, format 2 (omitting switchesPluginItems) for the format 1 move', async () => {
  const { box } = await home();
  try {
    const list: Profile[] = [{ id: 'a', name: 'A', items: ['skill:dev'], switchesPluginItems: true }];
    await saveProfiles(box.home, list, 2);
    assert.deepEqual(JSON.parse((await text(box, '.central-knot/profiles.json'))!),
      { formatVersion: 2, profiles: [{ id: 'a', name: 'A', items: ['skill:dev'] }] });
    await saveProfiles(box.home, list);
    assert.deepEqual(JSON.parse((await text(box, '.central-knot/profiles.json'))!),
      { formatVersion: 3, profiles: list });
    assert.equal(PLUGIN_ITEMS_STAY, 'Plugin items stay as they are.');
  } finally { await box.cleanup(); }
});

test('switchPreview gives the same line for the page header and both menus: managing and non-managing profiles across every state, and namedCount ignores plugin ids while non-managing', () => {
  const home = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [], [['skill', 'notes', false], ['skill', 'pager', true]]);
  const liveList = homeItems(home), plugs = pluginLive(home);
  const legacy = profile('Legacy', ['skill:notes'], false);
  const legacyWithPluginId = profile('Legacy', [pdfId], false);
  assert.deepEqual([namedCount(legacyWithPluginId, liveList, plugs), switchable(legacyWithPluginId, liveList, plugs)], [0, false], 'non-managing profile ignores plugin ids');
  assert.equal(switchPreview(legacy, liveList, plugs), 'Switching turns 1 item on and 1 off. Plugin items stay as they are.');
  assert.equal(switchPreview(profile('EmptyOld', [], false), liveList, plugs), '0 items. Plugin items stay as they are.');
  assert.equal(switchPreview(profile('EmptyNew', [], true), liveList, plugs), '0 items');
  // pdf and sheet turn off in Codex, and in Claude Code, which has no switch for one skill of a plugin, with the whole plugin.
  assert.equal(switchPreview(profile('Modern', ['skill:notes'], true), liveList, plugs), 'Switching turns 1 item on and 3 off. Turns 1 plugin off in Claude Code');
  // notes on, pager off: Legacy is in use (other personal item off, plugin items left alone); Modern is not (plugin items still on).
  const notesOn = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [], [['skill', 'notes', true], ['skill', 'pager', false]]);
  assert.equal(switchPreview(legacy, homeItems(notesOn), pluginLive(notesOn)), 'In use · 1 item on, the other 1 of yours off. Plugin items stay as they are.');
  const onlyNotes = docsHome([docsIn('claude-cli'), docsIn('codex-cli')], [], [['skill', 'notes', true]]);
  assert.equal(switchPreview(legacy, homeItems(onlyNotes), pluginLive(onlyNotes)), 'In use · 1 item on. Plugin items stay as they are.');
  // Managing profile with plugin off in Codex: held line from heldWords, no "Plugin items stay as they are."
  const offInCodex = docsHome([docsIn('codex-cli', { off: true })], [], [['skill', 'notes', true]]);
  assert.equal(switchPreview(profile('Docs', ['skill:notes', pdfId, sheetId], true), homeItems(offInCodex), pluginLive(offInCodex)),
    'Not in use · document-tools is off in Codex, so 2 of its items can’t be switched from here');
});

// ---------- Copilot CLI shared MCP server name: one name is one switch ----------

/** Takes his own server in `.copilot/mcp-config.json` into Central Knot for Copilot CLI alone, On. */
async function takeInCopilotServer(box: Box, key = 'issues') {
  const others = box.tools.filter(tool => tool !== 'copilot-cli');
  await applyServers(box.context, box.tools, [{ key, on: true, except: others }]);
}
const copilotFiles = async (box: Box) => ({
  settings: await text(box, '.copilot/settings.json'),
  mcp: await text(box, '.copilot/mcp-config.json'),
  codex: await text(box, '.codex/config.toml'),
  claude: await text(box, '.claude/settings.json'),
});

test('Copilot shared name example 1: both configured, a managing profile with his and without the plugin’s writes nothing to Copilot CLI, turns Claude Code and Codex off, and is in use', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await takeInCopilotServer(box);
    const before = await copilotFiles(box);
    const mine = await made('Mine', ['mcp:issues', pdfId2, sheetId2]);
    const switched = await switchProfile(box.context, box.tools, mine, (await sideNow(box)).side);
    assert.deepEqual([switched.stopped, switched.on, switched.off, switched.results], [undefined, [], ['issues'], []]);
    const after = await copilotFiles(box);
    assert.deepEqual([after.settings, after.mcp], [before.settings, before.mcp], 'Copilot CLI’s two files untouched');
    assert.equal(after.codex, `${CODEX_BEFORE}\n[plugins."docs@team".mcp_servers.issues]\nenabled = false\n`);
    assert.deepEqual(JSON.parse(after.claude!).deniedMcpServers, [{ serverName: 'plugin:docs:issues' }]);
    const now = await sideNow(box);
    assert.deepEqual(await now.inUse(), ['Mine']);
    const mineProfile = (await readProfiles(box.home)).profiles.find(each => each.id === mine)!;
    assert.match(switchPreview(mineProfile, await live(box), now.plugins), /^In use · /);
  } finally { await box.cleanup(); }
});

test('Copilot shared name examples 2, 3 and 4: Quiet turns both off in one switch with byte-exact Undo; PluginOnly clears the rule; Mine restores his, clears the rule and says so', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    // Realistic Copilot CLI entry shape (`type: 'local'`, `tools: ['*']` as mcp.ts writes it) so Off -> On restores byte for byte.
    await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'mine', tools: ['*'] } } }, null, 2)}\n`);
    await takeInCopilotServer(box);
    const initial = await copilotFiles(box);
    const quiet = await made('Quiet', [pdfId2, sheetId2]);
    const pluginOnly = await made('PluginOnly', [pdfId2, sheetId2, issuesId2]);
    const mine = await made('Mine', ['mcp:issues', pdfId2, sheetId2]);
    const profileById = async (id: string) => (await readProfiles(box.home)).profiles.find(each => each.id === id)!;

    // Example 2: Quiet previews two off, turns both off in one switch, is in use, and Undo puts every file back byte for byte.
    const beforeQuiet = await sideNow(box);
    assert.equal(switchPreview(await profileById(quiet), await live(box), beforeQuiet.plugins), 'Switching turns 2 items off');
    const toQuiet = await switchProfile(box.context, box.tools, quiet, beforeQuiet.side);
    assert.deepEqual([toQuiet.stopped, toQuiet.on, toQuiet.off, toQuiet.results], [undefined, [], ['issues', 'issues'], []]);
    const atQuiet = await copilotFiles(box);
    assert.deepEqual([JSON.parse(atQuiet.mcp!).mcpServers.issues, JSON.parse(atQuiet.settings!).disabledMcpServers], [undefined, ['issues']]);
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Quiet']);
    await undoSwitch(box.context, box.tools, toQuiet.event!, (await sideNow(box)).side);
    assert.deepEqual(await copilotFiles(box), initial, 'Undo of Quiet restores every file byte for byte');

    // Back to Quiet for examples 3 and 4.
    await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);

    // Example 3: PluginOnly clears the rule, keeps his entry out, and preview, result and History agree on 1 item on.
    const beforePlugin = await sideNow(box);
    assert.equal(switchPreview(await profileById(pluginOnly), await live(box), beforePlugin.plugins), 'Switching turns 1 item on');
    const toPlugin = await switchProfile(box.context, box.tools, pluginOnly, beforePlugin.side);
    assert.deepEqual([toPlugin.stopped, toPlugin.on, toPlugin.off, toPlugin.results, toPlugin.settingsChanged], [undefined, ['issues'], [], [], undefined]);
    assert.deepEqual([JSON.parse((await copilotFiles(box)).mcp!).mcpServers.issues, JSON.parse((await copilotFiles(box)).settings!).disabledMcpServers], [undefined, undefined]);
    assert.equal(turnsWords(entryTurns((await history(box)).at(-1)!.profile!), 'did'), '1 item turned on');
    assert.deepEqual(await (await sideNow(box)).inUse(), ['PluginOnly']);

    // Back to Quiet for example 4.
    await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);
    const quietAgain = await copilotFiles(box);

    // Example 4: Mine puts his entry back, clears the rule (plugin's on there too, said in the result), preview == result == History, in use, and Undo restores the prior rule.
    const beforeMine = await sideNow(box);
    assert.equal(switchPreview(await profileById(mine), await live(box), beforeMine.plugins), 'Switching turns 2 items on');
    const toMine = await switchProfile(box.context, box.tools, mine, beforeMine.side);
    assert.deepEqual([toMine.stopped, toMine.on, toMine.off, toMine.results, toMine.settingsChanged], [undefined, ['issues', 'issues'], [], [],
      ['Copilot CLI’s off-switch for “issues” was cleared; there the plugin’s “issues” runs, not yours (same name).']]);
    const atMine = await copilotFiles(box);
    assert.deepEqual([JSON.parse(atMine.mcp!).mcpServers.issues?.command, JSON.parse(atMine.settings!).disabledMcpServers], ['mine', undefined]);
    assert.equal(turnsWords(entryTurns((await history(box)).at(-1)!.profile!), 'did'), '2 items turned on');
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Mine']);
    await undoSwitch(box.context, box.tools, toMine.event!, (await sideNow(box)).side);
    assert.deepEqual(await copilotFiles(box), quietAgain, 'Undo of Mine restores the prior disabledMcpServers rule byte for byte');
  } finally { await box.cleanup(); }
});

test('Copilot shared name example 5: a non-managing profile naming his server clears a standing Copilot CLI rule and says so in preview and result; one not naming it leaves the rule intact', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await takeInCopilotServer(box);
    await put(box, 'claude-cli', { 'SKILL.md': skillText('My notes.', 'notes') }, [], 'notes');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await switchProfile(box.context, box.tools, await made('Quiet', [pdfId2, sheetId2]), (await sideNow(box)).side);
    await saveProfile(box.context, { name: 'Legacy', items: ['mcp:issues'], switchesPluginItems: false });
    await saveProfile(box.context, { name: 'NotesOnly', items: ['skill:notes'], switchesPluginItems: false });
    const atQuiet = await copilotFiles(box);
    const profiles = (await readProfiles(box.home)).profiles;
    const legacy = profiles.find(each => each.name === 'Legacy')!;
    const notesOnly = profiles.find(each => each.name === 'NotesOnly')!;

    // A non-managing profile that does not touch his issues keeps the rule untouched and shows no exception.
    const beforeNotes = await sideNow(box);
    assert.equal(switchPreview(notesOnly, await live(box), beforeNotes.plugins), 'Switching turns 1 item on. Plugin items stay as they are.');
    const toNotes = await switchProfile(box.context, box.tools, notesOnly.id, beforeNotes.side);
    assert.deepEqual([toNotes.stopped, toNotes.settingsChanged, await copilotFiles(box)], [undefined, undefined, atQuiet]);

    // Legacy (non-managing, names mcp:issues): preview carries the exception, switch clears the rule, Claude & Codex untouched, in use, Undo restores.
    const beforeLegacy = await sideNow(box);
    assert.equal(switchPreview(legacy, beforeLegacy.live, beforeLegacy.plugins),
      'Switching turns 2 items on and 1 off. Plugin items stay as they are, except the plugin’s “issues” turns on in Copilot CLI (same name as yours).');
    const toLegacy = await switchProfile(box.context, box.tools, legacy.id, beforeLegacy.side);
    assert.deepEqual([toLegacy.stopped, toLegacy.on, toLegacy.off, toLegacy.results, toLegacy.settingsChanged], [undefined, ['issues', 'issues'], ['notes'], [],
      ['Copilot CLI’s off-switch for “issues” was cleared; there the plugin’s “issues” runs, not yours (same name).']]);
    const atLegacy = await copilotFiles(box);
    assert.deepEqual([JSON.parse(atLegacy.mcp!).mcpServers.issues?.command, JSON.parse(atLegacy.settings!).disabledMcpServers, atLegacy.claude, atLegacy.codex],
      ['mine', undefined, atQuiet.claude, atQuiet.codex], 'only Copilot CLI’s rule cleared; Claude Code and Codex plugin copies untouched');
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Legacy']);

    // When his issues is already On and only the Copilot CLI rule stands: not in use, preview says 1 item on with the exception, switch clears it.
    await writeFile(join(box.home, '.copilot/settings.json'), atQuiet.settings!);
    const standing = await sideNow(box);
    assert.deepEqual(await standing.inUse(), [], 'rule standing blocks In use even though his item is On');
    assert.equal(switchPreview(legacy, standing.live, standing.plugins),
      'Switching turns 1 item on. Plugin items stay as they are, except the plugin’s “issues” turns on in Copilot CLI (same name as yours).');
    const cleared = await switchProfile(box.context, box.tools, legacy.id, standing.side);
    assert.deepEqual([cleared.on, cleared.off, cleared.settingsChanged], [['issues'], [],
      ['Copilot CLI’s off-switch for “issues” was cleared; there the plugin’s “issues” runs, not yours (same name).']]);
    assert.equal(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, undefined);
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Legacy']);
    // pluginStayNote handles zero, one, and two shared names cleanly.
    const two = [
      { id: 'plugin:mcp:docs@team/issues', kind: 'mcp' as const, name: 'issues', plugin: 'docs', marketName: 'team', copies: [] },
      { id: 'plugin:mcp:docs@team/tracker', kind: 'mcp' as const, name: 'tracker', plugin: 'docs', marketName: 'team', copies: [] },
    ];
    assert.equal(pluginStayNote([], two), PLUGIN_ITEMS_STAY);
    assert.equal(pluginStayNote([{ id: two[0]!.id, on: ['copilot-cli'], off: [], held: [] }], two),
      'Plugin items stay as they are, except the plugin’s “issues” turns on in Copilot CLI (same name as yours).');
    assert.equal(pluginStayNote(two.map(item => ({ id: item.id, on: ['copilot-cli'], off: [], held: [] })), two),
      'Plugin items stay as they are, except the plugins’ “issues” and “tracker” turn on in Copilot CLI (same name as yours).');
  } finally { await box.cleanup(); }
});

test('Copilot shared name example 6: names differing only in case (Issues vs issues) are two switches with no shared rule, whether On or Off', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { Issues: { command: 'mine' } } }, null, 2)}\n`);
    await takeInCopilotServer(box);
    const mine = await made('Mine', ['mcp:issues', pdfId2, sheetId2]);
    const quiet = await made('Quiet', [pdfId2, sheetId2]);
    // Both on: Mine leaves out plugin's `issues` and keeps his `Issues` -> writes disabledMcpServers: ['issues'] in one switch.
    const toMine = await switchProfile(box.context, box.tools, mine, (await sideNow(box)).side);
    assert.deepEqual([toMine.results, toMine.settingsChanged], [[], undefined]);
    assert.deepEqual([JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.Issues?.command, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers], ['mine', ['issues']]);
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Mine']);
    // Quiet turns his `Issues` off too; switching back to Mine restores `Issues` without clearing `disabledMcpServers: ['issues']`.
    await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);
    const backToMine = await switchProfile(box.context, box.tools, mine, (await sideNow(box)).side);
    assert.deepEqual([backToMine.on, backToMine.off, backToMine.settingsChanged], [['Issues'], [], undefined]);
    assert.deepEqual([JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.Issues?.command, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers], ['mine', ['issues']]);
    assert.deepEqual(await (await sideNow(box)).inUse(), ['Mine']);
  } finally { await box.cleanup(); }
});

test('Copilot shared name example 7: when .copilot/settings.json cannot be written, the result says so, History holds only what was confirmed, and the profile is not in use', { skip: winLockSkip }, async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await takeInCopilotServer(box);
    await switchProfile(box.context, box.tools, await made('Quiet', [pdfId2, sheetId2]), (await sideNow(box)).side);
    const pluginOnly = await made('PluginOnly', [pdfId2, sheetId2, issuesId2]);
    const side = (await sideNow(box)).side;
    const copilotDir = join(box.home, '.copilot');
    const switched = await withLock(copilotDir, 'dir-readonly', () => switchProfile(box.context, box.tools, pluginOnly, side));
    assert.deepEqual([switched.on, switched.left, switched.results.map(result => [result.harness, result.outcome])], [['issues'], ['issues'], [['copilot-cli', 'failed']]]);
    assert.deepEqual((await history(box)).at(-1)!.profile?.plugins?.map(copy => copy.tool), ['claude-cli', 'codex-cli'], 'History keeps only confirmed tools');
    assert.deepEqual(await (await sideNow(box)).inUse(), [], 'rule still stands, so not in use');
  } finally { await box.cleanup(); }
});

test('Copilot shared name sequences: (a) box-written rule flips on in Copilot CLI and off in Claude Code and Codex; (b) found entry then plugin profile; (c) same-content server held back by viaPlugin; (d) two plugins sharing a name', async () => {
  // Sequence (a): Copilot CLI off-switch written by the Plugins/Library box while Claude Code & Codex still have issues on, then Mine.
  {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      await takeInCopilotServer(box);
      const settingsPath = join(box.home, '.copilot/settings.json');
      await writeFile(settingsPath, `${JSON.stringify({ ...JSON.parse((await text(box, '.copilot/settings.json'))!), disabledMcpServers: ['issues'] }, null, 2)}\n`);
      const before = await copilotFiles(box);
      const mine = await made('Mine', ['mcp:issues', pdfId2, sheetId2]);
      const planNow = await sideNow(box);
      const mineProfile = (await readProfiles(box.home)).profiles.find(each => each.id === mine)!;
      // The plugin's issues turns off in Claude Code and Codex and on in Copilot CLI, where it then runs: the header says so, as the
      // result does, in words true before the click and after it ("is on", not "stays on": it was off there).
      assert.equal(switchPreview(mineProfile, planNow.live, planNow.plugins), 'Switching turns 1 item on and 1 off; 1 is on in Copilot CLI, through its plugin');
      const switched = await switchProfile(box.context, box.tools, mine, planNow.side);
      assert.equal(stillLoadAfter(switched.profile!, (await sideNow(box)).view), '; 1 is on in Copilot CLI, through its plugin');
      assert.deepEqual([switched.on, switched.off, switched.results, switched.settingsChanged], [['issues'], ['issues'], [],
        ['Copilot CLI’s off-switch for “issues” was cleared; there the plugin’s “issues” runs, not yours (same name).']]);
      assert.equal(turnsWords(entryTurns((await history(box)).at(-1)!.profile!), 'did'), '1 item turned on and 1 turned off');
      assert.equal(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, undefined);
      assert.deepEqual(JSON.parse((await text(box, '.claude/settings.json'))!).deniedMcpServers, [{ serverName: 'plugin:docs:issues' }]);
      assert.match((await text(box, '.codex/config.toml'))!, /\[plugins\."docs@team"\.mcp_servers\.issues\]\nenabled = false/);
      assert.deepEqual(await (await sideNow(box)).inUse(), ['Mine']);
      // Undo puts Claude Code & Codex back on, and leaves Copilot CLI's off-switch off because his own issues is On there now.
      const undone = await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
      assert.deepEqual([undone.switched?.on, undone.switched?.off, undone.switched?.settingsChanged],
        [['issues'], [], ['Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.']]);
      const afterUndo = await copilotFiles(box);
      assert.deepEqual([afterUndo.codex, afterUndo.claude, afterUndo.mcp, JSON.parse(afterUndo.settings!).disabledMcpServers],
        [before.codex, before.claude, before.mcp, undefined]);
    } finally { await box.cleanup(); }
  }

  // Sequence (b): found-only personal entry in Copilot CLI (not in Central Knot) — Quiet writes no rule and is in use; then Work (with plugin's) is in use.
  {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      const copilotBefore = await text(box, '.copilot/settings.json');
      const quiet = await made('Quiet', [pdfId2, sheetId2]);
      const work = await made('Work', [pdfId2, sheetId2, issuesId2]);
      const toQuiet = await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);
      assert.deepEqual([toQuiet.off, toQuiet.results, await text(box, '.copilot/settings.json')], [['issues'], [], copilotBefore]);
      assert.deepEqual(await (await sideNow(box)).inUse(), ['Quiet']);
      const toWork = await switchProfile(box.context, box.tools, work, (await sideNow(box)).side);
      assert.deepEqual([toWork.on, toWork.results, await text(box, '.copilot/settings.json')], [['issues'], [], copilotBefore]);
      assert.deepEqual(await (await sideNow(box)).inUse(), ['Work']);
    } finally { await box.cleanup(); }
  }

  // Sequence (c): his own issues has the same content as the plugin's (servers.ts viaPlugin holds his entry back in Copilot CLI).
  {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
      await putFile(join(box.home, '.pi/agent/mcp.json'), `${JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] } } }, null, 2)}\n`);
      await applyServers(box.context, box.tools, [{ key: 'issues', on: true, except: [] }]);
      assert.equal(JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues, undefined, 'held back in Copilot CLI because same content as plugin’s');
      const quiet = await made('Quiet', [pdfId2, sheetId2]);
      const mine = await made('Mine', ['mcp:issues', pdfId2, sheetId2]);
      await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);
      assert.deepEqual(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, ['issues']);
      assert.deepEqual(await (await sideNow(box)).inUse(), ['Quiet']);
      const toMine = await switchProfile(box.context, box.tools, mine, (await sideNow(box)).side);
      assert.deepEqual([toMine.results, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues],
        [[], undefined, undefined]);
      assert.deepEqual(await (await sideNow(box)).inUse(), ['Mine']);
    } finally { await box.cleanup(); }
  }

  // Sequence (d): two plugins sharing exact name `issues` in Copilot CLI — one rule, absent when profile wants either, present when it wants neither.
  {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
      const trackerCache = join(box.home, '.copilot/installed-plugins/team/tracker');
      await putFile(join(trackerCache, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['tracker-issues'] } } }));
      await putFile(join(trackerCache, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tracker', version: '1.0.0' }));
      const cfg = JSON.parse((await text(box, '.copilot/config.json'))!);
      cfg.installedPlugins.push({ name: 'tracker', marketplace: 'team', version: '1.0.0', cache_path: trackerCache, enabled: true });
      await writeFile(join(box.home, '.copilot/config.json'), JSON.stringify(cfg));
      const trackerIssues = 'plugin:mcp:tracker@team/issues';
      const docsOnly = await made('DocsOnly', [pdfId2, sheetId2, issuesId2]);
      const neither = await made('Neither', [pdfId2, sheetId2]);
      // DocsOnly wants docs' issues and not tracker's: rule stays absent, in use!
      assert.deepEqual(await (await sideNow(box)).inUse(), ['DocsOnly']);
      // Neither wants neither: preview says 2 off, one switch writes disabledMcpServers: ['issues'], result & History count 2 off, Undo restores both.
      const beforeNeither = await sideNow(box);
      const neitherProfile = (await readProfiles(box.home)).profiles.find(each => each.id === neither)!;
      assert.equal(switchPreview(neitherProfile, await live(box), beforeNeither.plugins), 'Switching turns 2 items off');
      const toNeither = await switchProfile(box.context, box.tools, neither, beforeNeither.side);
      assert.deepEqual([toNeither.off.length, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers], [2, ['issues']]);
      assert.equal(turnsWords(entryTurns((await history(box)).at(-1)!.profile!), 'did'), '2 items turned off');
      assert.deepEqual(await (await sideNow(box)).inUse(), ['Neither']);
      // Switching to DocsOnly clears the shared rule and counts 2 on (matching preview).
      const beforeDocs = await sideNow(box);
      const docsProfile = (await readProfiles(box.home)).profiles.find(each => each.id === docsOnly)!;
      assert.equal(switchPreview(docsProfile, await live(box), beforeDocs.plugins), 'Switching turns 2 items on');
      const toDocs = await switchProfile(box.context, box.tools, docsOnly, beforeDocs.side);
      assert.deepEqual([toDocs.on.length, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, toDocs.settingsChanged], [2, undefined, undefined]);
      assert.deepEqual(await (await sideNow(box)).inUse(), ['DocsOnly']);
    } finally { await box.cleanup(); }
  }
});

test('Copilot shared name fix 1: a disabledMcpServers rule outliving the plugin (whole-off, uninstalled, or server removed) is cleared for his server, confirmed, counted, said and undone', async t => {
  // 1a. Whole plugin turned off in Copilot CLI after Quiet wrote disabledMcpServers: ['issues']; both non-managing OldMine and managing Mine clear it and Undo puts it back.
  for (const mode of ['whole-off', 'uninstalled', 'removed'] as const) {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'mine', tools: ['*'] } } }, null, 2)}\n`);
      await takeInCopilotServer(box);
      const quiet = await made('Quiet', [pdfId2, sheetId2]);
      const mine = await made('Mine', ['mcp:issues']);
      await saveProfile(box.context, { name: 'OldMine', items: ['mcp:issues'], switchesPluginItems: false });
      const oldMine = (await readProfiles(box.home)).profiles.find(each => each.name === 'OldMine')!;
      await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);
      assert.deepEqual(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, ['issues']);
      const cfgPath = join(box.home, '.copilot/config.json'), cfg = JSON.parse((await text(box, '.copilot/config.json'))!);
      if (mode === 'whole-off') { cfg.installedPlugins[0].enabled = false; await writeFile(cfgPath, JSON.stringify(cfg)); }
      else if (mode === 'uninstalled') { cfg.installedPlugins = []; await writeFile(cfgPath, JSON.stringify(cfg)); }
      else { await writeFile(join(cfg.installedPlugins[0].cache_path, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'npx', args: ['other'] } } })); }
      const beforeOld = await sideNow(box);
      assert.equal(switchPreview(oldMine, beforeOld.live, beforeOld.plugins), 'Switching turns 1 item on. Plugin items stay as they are.');
      const toOld = await switchProfile(box.context, box.tools, oldMine.id, beforeOld.side);
      assert.deepEqual([toOld.on, toOld.off, toOld.left, toOld.results, toOld.settingsChanged],
        [['issues'], [], [], [], ['Copilot CLI’s off-switch for “issues” was cleared, so yours is on there.']], mode);
      assert.deepEqual([JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues?.command, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers],
        ['mine', undefined], mode);
      assert.equal(turnsWords(entryTurns((await history(box)).at(-1)!.profile!), 'did'), '1 item turned on');
      assert.ok((await (await sideNow(box)).inUse()).includes('OldMine'), mode);
      const undone = await undoSwitch(box.context, box.tools, toOld.event!, (await sideNow(box)).side);
      assert.deepEqual([undone.results, JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers],
        [[], undefined, ['issues']], `${mode} undo restores rule`);
      // Managing profile Mine clears it too.
      const beforeMine = await sideNow(box);
      const mineProfile = (await readProfiles(box.home)).profiles.find(each => each.id === mine)!;
      const toMine = await switchProfile(box.context, box.tools, mineProfile.id, beforeMine.side);
      assert.deepEqual([toMine.on, toMine.results, toMine.settingsChanged, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers],
        [['issues'], [], ['Copilot CLI’s off-switch for “issues” was cleared, so yours is on there.'], mode === 'removed' ? ['other'] : undefined], `${mode} managing`);
      assert.ok((await (await sideNow(box)).inUse()).includes('Mine'), `${mode} managing inUse`);
      // Undo of Mine after a found entry of his own appeared since: turns pdf/spreadsheet back on in Codex/Pi, leaves Copilot CLI's rule off and says so.
      await applyServers(box.context, box.tools, [{ key: 'issues', on: false, except: box.tools.filter(t => t !== 'copilot-cli'), seenOn: true }]);
      await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'hand', tools: ['*'] } } }, null, 2)}\n`);
      const blockedUndo = await undoSwitch(box.context, box.tools, toMine.event!, (await sideNow(box)).side);
      assert.deepEqual(blockedUndo.switched?.settingsChanged, ['Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.']);
      assert.equal(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, undefined);
    } finally { await box.cleanup(); }
  }
  // 1b. Already On in mcp-config.json with orphan disabledMcpServers: not in use, preview says 1 on, switch clears it and is in use; unwritable settings.json fails honestly.
  {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      await takeInCopilotServer(box);
      const cfgPath = join(box.home, '.copilot/config.json');
      await writeFile(cfgPath, JSON.stringify({ installedPlugins: [] }));
      const settingsPath = join(box.home, '.copilot/settings.json');
      await writeFile(settingsPath, `${JSON.stringify({ ...JSON.parse((await text(box, '.copilot/settings.json'))!), disabledMcpServers: ['issues'] }, null, 2)}\n`);
      const mine = await made('Mine', ['mcp:issues', pdfId2, sheetId2, issuesId2]);
      const mineProfile = (await readProfiles(box.home)).profiles.find(each => each.id === mine)!;
      const before = await sideNow(box);
      assert.deepEqual(await before.inUse(), [], 'orphan rule blocks In use');
      assert.equal(switchPreview(mineProfile, before.live, before.plugins), 'Switching turns 1 item on');
      // Unwritable .copilot: fails cleanly, not in use, no false settingsChanged.
      await t.test('unwritable .copilot fails cleanly without false settingsChanged', { skip: winLockSkip }, async () => {
        const failed = await withLock(join(box.home, '.copilot'), 'dir-readonly', () => switchProfile(box.context, box.tools, mine, before.side));
        assert.deepEqual([failed.left, failed.results.map(r => [r.harness, r.outcome]), failed.settingsChanged], [['issues'], [['copilot-cli', 'failed']], undefined]);
        assert.deepEqual(await (await sideNow(box)).inUse(), [], 'failed clear leaves not in use');
      });
      // Writable again: clears rule, counts 1 on, in use.
      const ok = await switchProfile(box.context, box.tools, mine, (await sideNow(box)).side);
      assert.deepEqual([ok.on, ok.left, ok.results, ok.settingsChanged, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers],
        [['issues'], [], [], ['Copilot CLI’s off-switch for “issues” was cleared, so yours is on there.'], undefined]);
      assert.equal(turnsWords(entryTurns((await history(box)).at(-1)!.profile!), 'did'), '1 item turned on');
      assert.deepEqual(await (await sideNow(box)).inUse(), ['Mine']);
      // Undo when his server is still On (nothing else to undo): stops with the exact Item 2 message and leaves settings.json intact.
      const blockedStop = await undoSwitch(box.context, box.tools, ok.event!, (await sideNow(box)).side);
      assert.equal(blockedStop.stopped, 'Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.');
      assert.equal(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, undefined);
    } finally { await box.cleanup(); }
  }
});

test('Copilot shared name fix 2: Undo does not put disabledMcpServers back when a server of his (found or his own On) came since, and says so once', async () => {
  // 2a. Neither -> Plugin (two plugins sharing `issues` in Copilot CLI), then hand-add personal `issues` in mcp-config.json -> Undo turns Claude & Codex off, leaves settings.json alone, says so once.
  {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
      const trackerCache = join(box.home, '.copilot/installed-plugins/team/tracker');
      await putFile(join(trackerCache, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['tracker-issues'] } } }));
      await putFile(join(trackerCache, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tracker', version: '1.0.0' }));
      const cfg = JSON.parse((await text(box, '.copilot/config.json'))!);
      cfg.installedPlugins.push({ name: 'tracker', marketplace: 'team', version: '1.0.0', cache_path: trackerCache, enabled: true });
      await writeFile(join(box.home, '.copilot/config.json'), JSON.stringify(cfg));
      const neither = await made('Neither', [pdfId2, sheetId2]);
      const pluginOnly = await made('Plugin', [pdfId2, sheetId2, issuesId2]);
      await switchProfile(box.context, box.tools, neither, (await sideNow(box)).side);
      const toPlugin = await switchProfile(box.context, box.tools, pluginOnly, (await sideNow(box)).side);
      assert.equal(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, undefined);
      // Hand-add personal `issues` in Copilot CLI.
      await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'mine', tools: ['*'] } } }, null, 2)}\n`);
      const undone = await undoSwitch(box.context, box.tools, toPlugin.event!, (await sideNow(box)).side);
      assert.deepEqual([undone.stopped, undone.results, undone.switched?.off, undone.switched?.settingsChanged],
        [undefined, [], ['issues'], ['Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.']]);
      assert.equal(JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, undefined, 'new personal server not disabled');
      assert.deepEqual(JSON.parse((await text(box, '.claude/settings.json'))!).deniedMcpServers, [{ serverName: 'plugin:docs:issues' }]);
      assert.match((await text(box, '.codex/config.toml'))!, /\[plugins\."docs@team"\.mcp_servers\.issues\]\nenabled = false/);
    } finally { await box.cleanup(); }
  }
  // 2b. Neither -> Plugin, then user turns his own library `mcp:issues` On -> Undo leaves disabledMcpServers off and says so.
  {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      await takeInCopilotServer(box);
      const neither = await made('Neither', [pdfId2, sheetId2]);
      const pluginOnly = await made('Plugin', [pdfId2, sheetId2, issuesId2]);
      await switchProfile(box.context, box.tools, neither, (await sideNow(box)).side);
      const toPlugin = await switchProfile(box.context, box.tools, pluginOnly, (await sideNow(box)).side);
      await applyServers(box.context, box.tools, [{ key: 'issues', on: true, except: box.tools.filter(t => t !== 'copilot-cli') }]);
      const undone = await undoSwitch(box.context, box.tools, toPlugin.event!, (await sideNow(box)).side);
      assert.deepEqual([undone.stopped, undone.switched?.off, undone.switched?.settingsChanged, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers],
        [undefined, ['issues'], ['Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.'], undefined]);
    } finally { await box.cleanup(); }
  }
});

test('Copilot shared name fix 3: exact words say the plugin’s server runs instead of yours in preview and result', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await takeInCopilotServer(box);
    await switchProfile(box.context, box.tools, await made('Quiet', [pdfId2, sheetId2]), (await sideNow(box)).side);
    await saveProfile(box.context, { name: 'Legacy', items: ['mcp:issues'], switchesPluginItems: false });
    const legacy = (await readProfiles(box.home)).profiles.find(each => each.name === 'Legacy')!;
    const before = await sideNow(box);
    assert.equal(switchPreview(legacy, before.live, before.plugins),
      'Switching turns 2 items on. Plugin items stay as they are, except the plugin’s “issues” turns on in Copilot CLI (same name as yours).');
    const switched = await switchProfile(box.context, box.tools, legacy.id, before.side);
    assert.deepEqual(switched.settingsChanged, ['Copilot CLI’s off-switch for “issues” was cleared; there the plugin’s “issues” runs, not yours (same name).']);
  } finally { await box.cleanup(); }
});

test('Copilot shared name fix 4: pluginRowState lives in profileplan.ts and returns "Off · on in Copilot CLI" when off elsewhere and kept on by name in Copilot CLI', async () => {
  const issues = { kind: 'mcp' as const, name: 'issues', description: '' }, issuesId = 'plugin:mcp:document-tools@team-tools/issues';
  const mine = { ...row('issues'), copies: { 'copilot-cli': { folder: 'issues' } } } as unknown as LibraryFacts;
  const home = docsHome([docsIn('copilot-cli', { items: [issues] }), docsIn('codex-cli', { items: [issues], serversOff: ['issues'] }), docsIn('claude-cli', { items: [issues], serversOff: ['issues'] })], [], [['mcp', 'issues', true]], [mine]);
  const item = pluginLive(home).find(each => each.id === issuesId)!;
  assert.equal(pluginRowState(profile('Mine', ['mcp:issues']), item), 'Off · on in Copilot CLI');
  assert.equal(pluginRowState(profile('Both', ['mcp:issues', issuesId]), item), 'On');
  const allOff = docsHome([docsIn('copilot-cli', { items: [issues], serversOff: ['issues'] }), docsIn('codex-cli', { items: [issues], serversOff: ['issues'] })], [], [], []);
  assert.equal(pluginRowState(profile('Quiet', []), pluginLive(allOff).find(each => each.id === issuesId)!), 'Off');
  // Two plugins + his own server: when one plugin AND his own server are both named, the other plugin is kept on by the named plugin (not `own`), so clearedForHis stays silent.
  const tracker: InstalledPlugin = { tool: 'copilot-cli', plugin: 'tracker', marketName: 'team-tools', listed: true, items: [issues] };
  const bothHome = docsHome([docsIn('copilot-cli', { items: [issues] }), tracker], [], [['mcp', 'issues', true]], [mine]);
  const trackerItem = pluginLive(bothHome).find(each => each.id === 'plugin:mcp:tracker@team-tools/issues')!;
  assert.deepEqual(copilotKeptOnBy(profile('BothAndHis', ['mcp:issues', issuesId]), trackerItem, trackerItem.copies[0]!), { by: 'plugin', plugin: 'document-tools' });
});

test('Copilot shared name short 1: the menus’ live items (homeItems, as main.ts refreshMenus reads them) carry uncovered copilotOff, so the menus agree with the page', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await takeInCopilotServer(box);
    await writeFile(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [] }));
    const settingsPath = join(box.home, '.copilot/settings.json');
    await writeFile(settingsPath, `${JSON.stringify({ ...JSON.parse((await text(box, '.copilot/settings.json'))!), disabledMcpServers: ['issues'] }, null, 2)}\n`);
    const mineId = await made('Mine', ['mcp:issues', pdfId2, sheetId2, issuesId2]);
    const mineProfile = (await readProfiles(box.home)).profiles.find(each => each.id === mineId)!;
    const { plugins, live: menuItems } = await sideNow(box);
    assert.equal(menuItems.find(item => item.id === 'mcp:issues')?.copilotOff, 'issues');
    assert.deepEqual(inUse([mineProfile], menuItems, plugins), [], 'menu must not say In use while off-switch stands');
    assert.equal(switchPreview(mineProfile, menuItems, plugins), 'Switching turns 1 item on');
  } finally { await box.cleanup(); }
});

test('Copilot shared name short 2: Undo clears an orphan disabledMcpServers rule when plugin was uninstalled or turned off whole since the switch', async () => {
  for (const mode of ['uninstalled', 'whole-off'] as const) {
    const { box, made } = await pluginHome({ copilot: true });
    try {
      await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'mine', tools: ['*'] } } }, null, 2)}\n`);
      await takeInCopilotServer(box);
      const quiet = await made('Quiet', [pdfId2, sheetId2]);
      const toQuiet = await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);
      assert.deepEqual([JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers],
        [undefined, ['issues']], mode);
      const cfgPath = join(box.home, '.copilot/config.json'), cfg = JSON.parse((await text(box, '.copilot/config.json'))!);
      if (mode === 'uninstalled') cfg.installedPlugins = []; else cfg.installedPlugins[0].enabled = false;
      await writeFile(cfgPath, JSON.stringify(cfg));
      const undone = await undoSwitch(box.context, box.tools, toQuiet.event!, (await sideNow(box)).side);
      assert.deepEqual([undone.stopped, undone.results, JSON.parse((await text(box, '.copilot/mcp-config.json'))!).mcpServers.issues?.command,
        JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers, undone.switched?.settingsChanged],
        [undefined, [], 'mine', undefined, ['Copilot CLI’s off-switch for “issues” was cleared, so yours is on there.']], mode);
      assert.ok(undone.switched?.on.includes('issues'), mode);
      const undoEntry = (await history(box)).find(entry => entry.profile?.undoOf === toQuiet.event);
      assert.deepEqual(undoEntry?.settingsChanged, ['Copilot CLI’s off-switch for “issues” was cleared, so yours is on there.'], mode);
    } finally { await box.cleanup(); }
  }
});

test('Copilot shared name short 3: History undoTurns uses the same found-entry guard as undoSwitch and offers no Undo that can only refuse', async () => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'mine', tools: ['*'] } } }, null, 2)}\n`);
    await takeInCopilotServer(box);
    const quiet = await made('Quiet', [pdfId2, sheetId2]);
    await switchProfile(box.context, box.tools, quiet, (await sideNow(box)).side);
    await writeFile(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [] }));
    await saveProfile(box.context, { name: 'OldMine', items: ['mcp:issues'], switchesPluginItems: false });
    const oldMine = (await readProfiles(box.home)).profiles.find(each => each.name === 'OldMine')!;
    const switched = await switchProfile(box.context, box.tools, oldMine.id, (await sideNow(box)).side);
    const event = (await history(box)).find(entry => entry.id === switched.event)!;
    // Turn mcp:issues Off in the library (so undoPlan is empty) and hand-add personal `issues` in Copilot CLI.
    await applyServers(box.context, box.tools, [{ key: 'issues', on: false, except: box.tools.filter(t => t !== 'copilot-cli'), seenOn: true }]);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'hand', tools: ['*'] } } }, null, 2)}\n`);
    const now = await sideNow(box);
    const mcp = await serversView(box.context, box.tools);
    const planned = undoTurns(event, now.live, now.plugins, mcp);
    assert.deepEqual(planned, { on: [], off: [] }, 'History must not offer an Undo that can only leave the off-switch off');
    const refused = await undoSwitch(box.context, box.tools, event.id, now.side);
    assert.equal(refused.stopped, 'Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.');
  } finally { await box.cleanup(); }
});

test('Copilot shared name short 4: one withCopilotOff & copilotServerName helper; runCopilotRules writes existing empty settings.json and refuses unreadable JSON in plain words', async () => {
  // Single spelling helper and single covered/uncovered attach helper.
  assert.equal(copilotServerName({ copies: { 'copilot-cli': { folder: 'Hand' } as never }, plugin: { 'copilot-cli': { plugin: 'p', marketplace: 'm', name: 'plug' } }, copilotName: 'kept' }, 'fallback'), 'Hand');
  assert.equal(copilotServerName({ copies: {}, plugin: { 'copilot-cli': { plugin: 'p', marketplace: 'm', name: 'plug' } }, copilotName: 'kept' }, 'fallback'), 'plug');
  assert.equal(copilotServerName({ copies: {}, copilotName: 'kept' }, 'fallback'), 'kept');
  assert.equal(copilotServerName(undefined, 'fallback'), 'fallback');
  const blocked = { ...row('issues'), copilotOff: 'issues' }, ownItem = [{ id: 'mcp:issues', kind: 'mcp' as const, key: 'issues', name: 'issues', on: true, except: [] }];
  const switchablePlugin = pluginLive(docsHome([docsIn('copilot-cli', { items: [{ kind: 'mcp', name: 'issues', description: '' }] })]));
  const offPlugin = pluginLive(docsHome([docsIn('copilot-cli', { off: true, items: [{ kind: 'mcp', name: 'issues', description: '' }] })]));
  assert.equal(withCopilotOff(ownItem, [blocked], switchablePlugin)[0]!.copilotOff, undefined, 'covered by switchable Copilot CLI plugin');
  assert.equal(withCopilotOff(ownItem, [blocked], offPlugin)[0]!.copilotOff, 'issues', 'uncovered when plugin is off whole');
  // Empty existing settings.json + malformed JSON refusal through runCopilotRules on Undo of an orphan clear.
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), `${JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'mine', tools: ['*'] } } }, null, 2)}\n`);
    await takeInCopilotServer(box);
    await switchProfile(box.context, box.tools, await made('Quiet', [pdfId2, sheetId2]), (await sideNow(box)).side);
    await writeFile(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [] }));
    await saveProfile(box.context, { name: 'OldMine', items: ['mcp:issues'], switchesPluginItems: false });
    const oldMine = (await readProfiles(box.home)).profiles.find(each => each.name === 'OldMine')!;
    const switched = await switchProfile(box.context, box.tools, oldMine.id, (await sideNow(box)).side);
    // Replace settings.json with an existing empty (0-byte) file: Undo must still write disabledMcpServers: ['issues'].
    await writeFile(join(box.home, '.copilot/settings.json'), '');
    const undone = await undoSwitch(box.context, box.tools, switched.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.results, JSON.parse((await text(box, '.copilot/settings.json'))!).disabledMcpServers], [[], ['issues']], 'empty existing settings.json written cleanly');
    // Malformed settings.json: refusal uses plain words, not raw SyntaxError.
    const switched2 = await switchProfile(box.context, box.tools, oldMine.id, (await sideNow(box)).side);
    await writeFile(join(box.home, '.copilot/settings.json'), '{');
    const bad = await undoSwitch(box.context, box.tools, switched2.event!, (await sideNow(box)).side);
    assert.deepEqual(bad.results.map(r => [r.harness, r.outcome, r.message]),
      [['copilot-cli', 'failed', 'issues: Copilot CLI’s settings.json couldn’t be read, so it was left as it is.']]);
  } finally { await box.cleanup(); }
});

test('A profile switch returns the settled History profile payload, and undoOffered agrees on the result and History entry', async t => {
  const { box, made } = await pluginHome({ copilot: true });
  try {
    await takeInCopilotServer(box);
    await writeFile(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [] }));
    const settingsPath = join(box.home, '.copilot/settings.json');
    await writeFile(settingsPath, `${JSON.stringify({ ...JSON.parse((await text(box, '.copilot/settings.json'))!), disabledMcpServers: ['issues'] }, null, 2)}\n`);
    const mineId = await made('Mine', ['mcp:issues', pdfId2, sheetId2, issuesId2]);
    const homeNow = async (): Promise<HomeView> => ({
      pluginItems: await readPluginItems({ home: box.home, dataDir: box.home, binaries: {}, overrides: {} }, box.tools),
      profiles: await readProfiles(box.home),
      skills: await skillsView(box.context, box.tools),
      mcp: await serversView(box.context, box.tools),
      agents: await agentsView(box.context, box.tools),
    } as unknown as HomeView);
    // Worked example 1: orphan clear alone -> settled profile payload matches History entry and undoOffered is false for both.
    const cleared = await switchProfile(box.context, box.tools, mineId, (await sideNow(box)).side);
    const entry = (await history(box)).find(each => each.id === cleared.event)!;
    assert.deepEqual(cleared.profile, entry.profile, 'switch result carries the settled profile entry for the header');
    const afterCleared = await homeNow();
    assert.equal(undoOffered(cleared, afterCleared), false);
    assert.equal(undoOffered(entry, afterCleared), false);
    assert.deepEqual(undoInHome(cleared, afterCleared), { on: [], off: [] });
    // Failed orphan Copilot CLI clear: settleEntry drops copilotCleared from History and returns that exact payload (no drift).
    await t.test('failed orphan Copilot CLI clear drops copilotCleared from History and result', { skip: winLockSkip }, async () => {
      await writeFile(settingsPath, `${JSON.stringify({ ...JSON.parse((await text(box, '.copilot/settings.json'))!), disabledMcpServers: ['issues'] }, null, 2)}\n`);
      await withLock(join(box.home, '.copilot'), 'dir-readonly', async () => {
        const failedClear = await switchProfile(box.context, box.tools, mineId, (await sideNow(box)).side);
        const failedEntry = (await history(box)).find(each => each.id === failedClear.event)!;
        assert.equal(failedEntry.profile?.copilotCleared, undefined);
        assert.deepEqual(failedClear.profile, failedEntry.profile);
        assert.equal(undoOffered(failedClear, await homeNow()), false);
      });
    });
    // Worked example 2: two items turned on + orphan clear -> undoOffered is true (2 items), and undoSwitch turns them back while leaving the off-switch off.
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Notes.', 'notes') }, [], 'notes');
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Standup.', 'standup') }, [], 'standup');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }, { key: 'standup', on: true, except: [] }]);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [], seenOn: true }, { key: 'standup', on: false, except: [], seenOn: true }]);
    await writeFile(settingsPath, `${JSON.stringify({ ...JSON.parse((await text(box, '.copilot/settings.json'))!), disabledMcpServers: ['issues'] }, null, 2)}\n`);
    const withTwoId = await made('WithTwo', ['skill:notes', 'skill:standup', 'mcp:issues']);
    const withTwo = await switchProfile(box.context, box.tools, withTwoId, (await sideNow(box)).side);
    const twoEntry = (await history(box)).find(each => each.id === withTwo.event)!;
    assert.deepEqual(withTwo.profile, twoEntry.profile);
    const afterTwo = await homeNow();
    assert.equal(undoOffered(withTwo, afterTwo), true);
    assert.equal(undoOffered(twoEntry, afterTwo), true);
    assert.equal(undoInHome(withTwo, afterTwo).off.length, 2);
    const undone = await undoSwitch(box.context, box.tools, withTwo.event!, (await sideNow(box)).side);
    assert.deepEqual([undone.stopped, undone.switched?.off.sort(), undone.switched?.settingsChanged],
      [undefined, ['notes', 'standup'], ['Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.']]);
    // When settleEntry finds no History entry (e.g. removed mid-switch), switchProfile returns what settleEntry returned (undefined) instead of rebuilding a separate payload.
    const { side } = await sideNow(box);
    const pruneMidSwitch: PluginSide = {
      live: () => side.live(),
      run: async ops => { await rm(join(box.home, '.central-knot/history.json'), { force: true }); return ops.map(op => ({ ...op, report: { tool: op.tool, outcome: 'failed' as const, changed: false, message: 'failed', runs: [] } })); },
    };
    const emptyId = await made('EmptyAfterPrune', []);
    const pruned = await switchProfile(box.context, box.tools, emptyId, pruneMidSwitch);
    assert.equal(pruned.profile, undefined);
    assert.equal(pruned.profile, (await history(box)).find(each => each.id === pruned.event)?.profile);
  } finally { await box.cleanup(); }
});

test('A library item’s row tooltip words (itemRowState): an off-switch standing in Copilot CLI is never called on', () => {
  assert.equal(itemRowState({ on: true }), 'on');
  assert.equal(itemRowState({ on: false }), 'off');
  assert.equal(itemRowState({ on: false, copilotOff: 'github' }), 'off');
  assert.equal(itemRowState({ on: true, copilotOff: 'github' }), 'off in Copilot CLI');
});

test('copilotSharesYours: true only when his own On server or a found server in Copilot CLI shares the exact bare name', () => {
  const copilotInstall: InstalledPlugin = { tool: 'copilot-cli', plugin: 'docs', marketName: 'team', version: '1.0.0', listed: true, source: '/m', items: [{ kind: 'mcp', name: 'issues', description: '' }] };
  const otherInstall: InstalledPlugin = { tool: 'copilot-cli', plugin: 'other', marketName: 'team', version: '1.0.0', listed: true, source: '/m', items: [{ kind: 'mcp', name: 'issues', description: '' }] };
  const at = { kind: 'mcp' as const, name: 'issues', tool: 'copilot-cli' as const, install: copilotInstall };
  const fact = (key: string, folder?: string): LibraryFacts => ({ key, name: key, description: '', on: false, except: [], cannot: {}, edited: [], copies: folder ? { 'copilot-cli': { hash: 'h', directory: '', rootLabel: '', lines: 1, modified: '', summary: '', writable: true, folder } } : {} });
  const home = (library: Record<string, ReturnType<typeof newItem>>, items: LibraryFacts[], pluginItems: InstalledPlugin[] = [copilotInstall]): PluginHome =>
    ({ pluginItems, profiles: { profiles: [], plugins: [] }, skills: { items: [], library: {} }, agents: { items: [], library: {} }, mcp: { items, library } } as unknown as PluginHome);
  // No server of his: false (even if another plugin shares the name, or for a skill/non-Copilot copy).
  assert.equal(copilotSharesYours(home({}, [], [copilotInstall, otherInstall]), at), false);
  assert.equal(copilotSharesYours(home({ issues: { ...newItem('issues', 'issues'), on: true } }, [fact('issues', 'issues')]), { ...at, tool: 'codex-cli' }), false);
  // His own Library server On in Copilot CLI: true.
  assert.equal(copilotSharesYours(home({ issues: { ...newItem('issues', 'issues'), on: true } }, [fact('issues', 'issues')]), at), true);
  // His own Library server Off with no unmanaged copy: false; with an unmanaged copy in Copilot CLI: true.
  assert.equal(copilotSharesYours(home({ issues: { ...newItem('issues', 'issues'), on: false } }, [fact('issues')]), at), false);
  assert.equal(copilotSharesYours(home({ issues: { ...newItem('issues', 'issues'), on: false } }, [fact('issues', 'issues')]), at), true);
  // Kept out of Copilot CLI with no copy: false; with an unmanaged copy in Copilot CLI: true.
  assert.equal(copilotSharesYours(home({ issues: { ...newItem('issues', 'issues'), on: true, except: ['copilot-cli'] } }, [fact('issues')]), at), false);
  assert.equal(copilotSharesYours(home({ issues: { ...newItem('issues', 'issues'), on: true, except: ['copilot-cli'] } }, [fact('issues', 'issues')]), at), true);
  // Found-only server of his in Copilot CLI: true; different case: false (Copilot CLI matches exact bare name).
  assert.equal(copilotSharesYours(home({}, [fact('issues', 'issues')]), at), true);
  assert.equal(copilotSharesYours(home({}, [fact('issues', 'Issues')]), at), false);
});

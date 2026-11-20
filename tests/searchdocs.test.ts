// The Library's documents for word search (src/searchdocs.ts), gathered from real views of a made-up home and asked through
// the index that follows them (src/search.ts searchFollower), as main does at each view: a skill found in a tool, then kept
// Off, is found by its text, through a version made current, a delete and a restore; a plugin's skill in one tool, then in
// two with texts that differ, is one row with each copy's text, description and address, folded onto the person's own row
// too; lifted by its own name's start, not its plugin's; a namesake of the person's own and an agent of the same name keep
// rows of their own; an agent kept Off by its prompt, a server by its command, and a skill a tool loads from the shared
// folder by its text, beside another tool's own copy too. Then the items of listed plugins installed in no managed tool
// (catalogDocs), from the plugin text as plugintext.ts keeps it: the manager's case, a skill named unlike its plugin, by its
// name, half of it and a letter wrong; what counts as installed; two marketplaces of one plugin; an item already a Library
// row; text read at an older pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentsView, applyAgents } from '../src/agents.ts';
import { rowClicks } from '../src/libraryrow.ts';
import { readPluginItems } from '../src/pluginitems.ts';
import type { PluginText, PluginTextItem } from '../src/plugintext.ts';
import { buildIndex, searchFollower } from '../src/search.ts';
import { catalogDocs, libraryDocs } from '../src/searchdocs.ts';
import { serversView } from '../src/servers.ts';
import { skillsView } from '../src/skills.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts } from '../src/types.ts';
import { historyOf, itemOf, makeCurrent, pass, put, remove, restore, sandbox, skillText, turnOff, turnOn, type Box } from './skillclicks.ts';

/** The view main hands over, as far as the documents read it, with the view's own reads (each tool's plugins read once). */
async function viewOf(box: Box) {
  const shared = { ...box.context, reads: new Map<string, Promise<unknown>>() };
  const view = {
    home: box.home, skills: await skillsView(shared, box.tools), mcp: await serversView(shared, box.tools), agents: await agentsView(shared, box.tools),
    pluginItems: await readPluginItems({ home: box.home, dataDir: join(box.base, 'data'), binaries: {}, reads: shared.reads }, box.tools),
  } as HomeView;
  return { shared, view };
}
/** Search as main keeps it: each step a new view followed, then a question asked of what was published. */
function searching(box: Box) {
  const search = searchFollower(() => {});
  let read = 0;
  return {
    found: async (typed: string) => {
      const { shared, view } = await viewOf(box);
      await search.follow(box.home, ++read, () => libraryDocs(shared, view));
      const answer = search.ask(typed);
      if (!answer.ready) throw new Error('No index was published for the view.');
      return answer.rows;
    },
    close: () => search.close(),
  };
}
const write = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };
/** The plugin relay@m installed in Claude Code (1.0.0) or Copilot CLI (2.0.0): its skill courier, with this copy's description and text, and its server dispatch (`server`, its entry). */
async function installRelay(box: Box, tool: 'claude-cli' | 'copilot-cli', copy: { description: string; body: string; server: Record<string, unknown> }) {
  const folder = join(box.home, tool === 'claude-cli' ? '.claude/plugins/cache/m/relay/1.0.0' : '.copilot/installed-plugins/m/relay');
  await write(join(folder, 'skills/courier/SKILL.md'), `---\nname: courier\ndescription: ${copy.description}\n---\n${copy.body}\n`);
  await write(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { dispatch: copy.server } }));
  if (tool === 'claude-cli') await write(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'relay@m': [{ scope: 'user', installPath: folder, version: '1.0.0' }] } }));
  else await write(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'relay', marketplace: 'm', version: '2.0.0', cache_path: folder, enabled: true }] }));
  return join(folder, 'skills/courier/SKILL.md');
}

test('an item kept Off is found by its text; another version made current, deleted, restored: each answer follows the current text', async () => {
  const box = await sandbox();
  const search = searching(box);
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Keep a ledger of every decision.'), 'templates/decision.md': 'A decision.' });
    assert.deepEqual(await search.found('ledger'), [{ id: 'skills-notes', excerpt: 'Keep a ledger of every decision.' }], 'found in a tool, by its copy’s text');
    await turnOn(box);
    const first = (await itemOf(box))!.hash;
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Track the open questions.') });
    assert.deepEqual([await search.found('questions'), await search.found('ledger')].map(rows => rows.map(row => row.id)), [['skills-notes'], ['skills-notes']], 'an edit not yet taken in, beside the current version');
    await pass(box);
    await turnOff(box);
    assert.deepEqual([await search.found('questions'), await search.found('ledger')], [[{ id: 'skills-notes', excerpt: 'Track the open questions.' }], []], 'Off, its current version’s text');
    await makeCurrent(box, first);
    assert.deepEqual([await search.found('ledger'), await search.found('questions'), await search.found('decision template')],
      [[{ id: 'skills-notes', excerpt: 'Keep a ledger of every decision.' }], [], [{ id: 'skills-notes', excerpt: 'templates/decision.md' }]],
      'the version made current, with its other file’s name');
    await remove(box);
    assert.deepEqual(await search.found('ledger'), [], 'deleted');
    const deleted = (await historyOf(box)).find(event => event.kind === 'deleted')!;
    await restore(box, deleted.id);
    assert.deepEqual(await search.found('ledger'), [{ id: 'skills-notes', excerpt: 'Keep a ledger of every decision.' }], 'restored');
  } finally { search.close(); await box.cleanup(); }
});

test('an agent kept Off is found by its prompt, an MCP server by its command, and a skill a tool has only from the shared folder by its text', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  const search = searching(box);
  try {
    await write(join(box.home, '.claude/agents/scribe.md'), '---\nname: scribe\ndescription: Writes things down.\n---\nKeep minutes of every meeting.\n');
    await write(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: { tracker: { command: 'npx', args: ['-y', '@example/tracker-mcp'] } } }));
    await write(join(box.home, '.agents/skills/handbook/SKILL.md'), skillText('Where the coffee machine is.', 'handbook'));
    const found = (await agentsView(box.context, box.tools)).items[0]!;
    await applyAgents(box.context, box.tools, [rowClicks.on({ key: found.key, name: found.name, hashes: { 'claude-cli': found.copies['claude-cli']!.hash } }, undefined, 'claude-cli')]);
    const kept = await agentsView(box.context, box.tools);
    await applyAgents(box.context, box.tools, [rowClicks.off({ key: 'scribe', name: 'scribe' }, kept.library.scribe)]);
    assert.deepEqual([await search.found('minutes'), await search.found('tracker-mcp'), await search.found('coffee')],
      [[{ id: 'agents-scribe', excerpt: 'Keep minutes of every meeting.' }], [{ id: 'mcp-tracker' }], [{ id: 'skills-handbook', excerpt: 'Where the coffee machine is.' }]]);
  } finally { search.close(); await box.cleanup(); }
});

test('a plugin’s skill in one tool, then in two whose texts differ, is one row with both texts; a namesake and an agent of one name keep their own rows', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  const search = searching(box);
  try {
    const claudeCopy = join(box.home, '.claude/plugins/cache/m/demo/1.0.0');
    await write(join(claudeCopy, 'skills/hello/SKILL.md'), '---\nname: hello\ndescription: Greets people.\n---\nSays hello in French.\n');
    await write(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'demo@m': [{ scope: 'user', installPath: claudeCopy, version: '1.0.0' }] } }));
    assert.deepEqual(await search.found('french'), [{ id: 'skills-demo@m/hello', excerpt: 'Says hello in French.' }]);
    const copilotCopy = join(box.home, '.copilot/installed-plugins/m/demo');
    await write(join(copilotCopy, 'skills/hello/SKILL.md'), '---\nname: hello\ndescription: Greets people.\n---\nSays hello in Welsh.\n');
    await write(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'demo', marketplace: 'm', version: '1.1.0', cache_path: copilotCopy, enabled: true }] }));
    assert.deepEqual([await search.found('french'), await search.found('welsh')].map(rows => rows.map(row => row.id)), [['skills-demo@m/hello'], ['skills-demo@m/hello']]);
    assert.deepEqual(await search.found('demo'), [{ id: 'skills-demo@m/hello' }], 'by its plugin’s name, which its row shows');
    // The person's own skill and agent named hello: not linked to the plugin, so rows of their own (pluginrows.ts pageRows).
    await put(box, 'claude-cli', { 'SKILL.md': skillText('My own greeting.', 'hello') }, [], 'hello');
    await write(join(box.home, '.claude/agents/hello.md'), '---\nname: hello\ndescription: Greets visitors.\n---\nWave at visitors.\n');
    assert.deepEqual((await search.found('hello')).map(row => row.id).sort(), ['agents-hello', 'skills-demo@m/hello', 'skills-hello']);
  } finally { search.close(); await box.cleanup(); }
});

test('a plugin’s row is lifted by the start of its own name, not its plugin’s: “de” puts his design-notes before the plugin design’s user-research, which its word still finds', async () => {
  const box = await sandbox(['claude-cli']);
  const search = searching(box);
  try {
    const copy = join(box.home, '.claude/plugins/cache/m/design/1.0.0');
    await write(join(copy, 'skills/user-research/SKILL.md'), '---\nname: user-research\ndescription: Plans user research for a design.\n---\nAsk five people.\n');
    await write(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'design@m': [{ scope: 'user', installPath: copy, version: '1.0.0' }] } }));
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Write down each choice.', 'design-notes') }, [], 'design-notes');
    // The words alone rank user-research first: its plugin's name and its description both say "design".
    assert.deepEqual((await search.found('de')).map(row => row.id), ['skills-design-notes', 'skills-design@m/user-research']);
  } finally { search.close(); await box.cleanup(); }
});

test('a plugin in two tools whose copies differ: each copy’s description, address and text is found on its one row, and on the person’s own row it folds onto', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  const search = searching(box);
  try {
    const claudeFile = await installRelay(box, 'claude-cli', { description: 'Carries parcels.', body: 'Weigh every parcel first.', server: { url: 'https://northgate.example/rpc' } });
    await installRelay(box, 'copilot-cli', { description: 'Keeps a manifest.', body: 'Check the provenance first.', server: { url: 'https://southgate.example/rpc' } });
    const ids = async (typed: string) => (await search.found(typed)).map(row => row.id);
    assert.deepEqual([await ids('northgate'), await ids('southgate'), await ids('parcels'), await ids('manifest'), await ids('provenance')],
      [['mcp-relay@m/dispatch'], ['mcp-relay@m/dispatch'], ['skills-relay@m/courier'], ['skills-relay@m/courier'], ['skills-relay@m/courier']], 'the second install’s address and description too');
    // A copy of the person's own, the same as Claude Code's copy of the plugin's: the Library folds the plugin's row onto it.
    await put(box, 'copilot-cli', { 'SKILL.md': await readFile(claudeFile, 'utf8') }, [], 'courier');
    assert.deepEqual([await ids('weigh'), await ids('provenance')], [['skills-courier'], ['skills-courier']], 'the folded row keeps Copilot CLI’s copy of the plugin’s text');
  } finally { search.close(); await box.cleanup(); }
});

test('a skill a tool loads from the shared folder is still found by its words beside another tool’s own copy that says otherwise', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  const search = searching(box);
  try {
    await write(join(box.home, '.agents/skills/shipment/SKILL.md'), skillText('Validate the consignment.', 'shipment'));
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Print the waybill.', 'shipment') }, [], 'shipment');
    const ids = async (typed: string) => (await search.found(typed)).map(row => row.id);
    assert.deepEqual([await ids('waybill'), await ids('consignment')], [['skills-shipment'], ['skills-shipment']], 'found, two copies');
    await turnOn(box, box.context, 'shipment');
    assert.deepEqual([await ids('waybill'), await ids('consignment')], [['skills-shipment'], ['skills-shipment']], 'in the library, Copilot CLI still loading the shared one');
  } finally { search.close(); await box.cleanup(); }
});

test('each distinct text once, compared whole: a second launch the first contains is still its own, and a folded skill’s body is held once beside its files', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  const search = searching(box);
  try {
    const claudeFile = await installRelay(box, 'claude-cli', { description: 'Carries parcels.', body: 'Weigh every parcel first.', server: { command: 'autossh' } });
    await installRelay(box, 'copilot-cli', { description: 'Carries parcels.', body: 'Weigh every parcel first.', server: { command: 'ssh' } });
    const ids = async (typed: string) => (await search.found(typed)).map(row => row.id);
    assert.deepEqual([await ids('autossh'), await ids('ssh')], [['mcp-relay@m/dispatch'], ['mcp-relay@m/dispatch']], 'Copilot CLI’s ssh, though Claude Code’s autossh holds those letters');
    // The person's own copy, the same SKILL.md as the plugin's with a file beside it: folded, its body is there once.
    await put(box, 'copilot-cli', { 'SKILL.md': await readFile(claudeFile, 'utf8'), 'templates/label.md': 'A label.' }, [], 'courier');
    const { shared, view } = await viewOf(box);
    const courier = (await libraryDocs(shared, view)).find(doc => doc.id === 'skills-courier')!;
    assert.deepEqual([courier.text.split('Weigh every parcel first.').length - 1, courier.text.includes('templates/label.md')], [1, true], courier.text);
  } finally { search.close(); await box.cleanup(); }
});

// ---------- Items of listed plugins installed in no managed tool (catalogDocs) ----------

/** A plugin as the plugin text job keeps it (plugintext.ts PluginText), of a marketplace listed as `source`. */
const kept = (source: string, plugin: string, items: PluginTextItem[], marketName = 'acme-tools'): PluginText => ({ source, marketName, plugin, readAt: '2026-11-19T10:00:00.000Z', items });
/** devkit, kept in another repository: a skill named unlike its plugin, an agent and an MCP server. */
const devkit: PluginTextItem[] = [
  { kind: 'skill', name: 'changelog-writer', description: 'Drafts release entries from merged work.', start: '---\nname: changelog-writer\n---\nGroup the merged pull requests by area.', path: 'skills/changelog-writer' },
  { kind: 'agent', name: 'triager', description: 'Sorts new issues.', start: 'You read each new issue and label it.', path: 'agents/triager.md' },
  { kind: 'mcp', name: 'mocks', description: '', start: '{"command":"npx","args":["-y","api-mocks"]}', runs: 'npx -y api-mocks' },
];
/** A view with only what the rule reads: the plugins installed whole in the managed tools, whose record couldn't be read, and the person's own rows. */
const viewWith = ({ installed = [], unread = [], skills = [] }: { installed?: InstalledPlugin[]; unread?: HarnessId[]; skills?: Partial<LibraryFacts>[] } = {}) => {
  const none = { tools: [], items: [], library: {} };
  return { home: '/home', pluginItems: installed, pluginRecordsUnread: unread, skills: { ...none, items: skills }, mcp: none, agents: none } as unknown as HomeView;
};
const install = (tool: HarnessId, plugin: string, more: Partial<InstalledPlugin> = {}): InstalledPlugin => ({ tool, plugin, marketName: 'acme-tools', items: [], listed: true, source: 'https://github.com/acme/tools', ...more });
/** The documents of these plugins' items, their marketplaces listed in the open home (as main.ts followSearch gives them). */
const docsOf = (view: HomeView, texts: PluginText[]) => catalogDocs(view, texts, texts.map(text => text.source));
const idsOf = (view: HomeView, texts: PluginText[]) => docsOf(view, texts).map(doc => doc.id);

test('an item of a listed plugin installed nowhere is a document of its own: by its name and its plugin’s, its description (a server’s launch) and its first lines after their frontmatter; found by its exact name, half of it and a letter wrong', async () => {
  const docs = docsOf(viewWith(), [kept('https://github.com/Acme/Tools.git', 'devkit', devkit)]);
  assert.deepEqual(docs[0], {
    id: 'catalog:["github.com/acme/tools","devkit","skill","skills/changelog-writer"]', names: ['changelog-writer'], plugin: 'devkit', description: 'Drafts release entries from merged work.',
    text: 'Group the merged pull requests by area.',
    catalog: { kind: 'skill', name: 'changelog-writer', description: 'Drafts release entries from merged work.', plugin: 'devkit', marketName: 'acme-tools', source: 'https://github.com/Acme/Tools.git' },
  });
  assert.deepEqual(docs.map(doc => [doc.id, doc.description]), [
    ['catalog:["github.com/acme/tools","devkit","skill","skills/changelog-writer"]', 'Drafts release entries from merged work.'],
    ['catalog:["github.com/acme/tools","devkit","agent","agents/triager.md"]', 'Sorts new issues.'],
    ['catalog:["github.com/acme/tools","devkit","mcp","mocks"]', 'npx -y api-mocks']], 'a Library row’s id begins skills-, agents- or mcp-: the two never meet');
  // The manager's case: she remembers the skill, not the plugin it is in.
  const index = (await buildIndex(docs))!;
  try {
    const first = (typed: string) => index.ask(typed)[0];
    assert.deepEqual([first('changelog-writer'), first('changelo'), first('chnagelog writer')].map(hit => hit?.item?.name), ['changelog-writer', 'changelog-writer', 'changelog-writer']);
    assert.deepEqual(first('changelog-writer')?.item, docs[0]!.catalog, 'the hit carries what its row draws and opens its plugin’s page by');
  } finally { index.close(); }
});

test('installed in a managed tool, under another spelling of its marketplace or turned Off there, a plugin gives no document; nor where a tool’s record of its plugins couldn’t be read, or its marketplace isn’t known', () => {
  const texts = [kept('https://github.com/acme/tools', 'devkit', devkit), kept('https://github.com/acme/tools', 'notes', [devkit[1]!])];
  assert.equal(idsOf(viewWith(), texts).length, 4);
  assert.deepEqual(idsOf(viewWith({ installed: [install('claude-cli', 'devkit', { source: 'acme/tools' })] }), texts), ['catalog:["github.com/acme/tools","notes","agent","agents/triager.md"]'], 'GitHub’s short form is the same marketplace');
  assert.equal(idsOf(viewWith({ installed: [install('copilot-cli', 'devkit', { off: true }), install('codex-cli', 'notes', { problem: 'Its files couldn’t be read.' })] }), texts).length, 0, 'Off is installed, and so is a copy that can’t be read');
  assert.equal(idsOf(viewWith({ unread: ['codex-cli'] }), texts).length, 0, 'a tool whose record can’t be read may have it: not claimed absent');
  assert.equal(idsOf(viewWith({ installed: [install('claude-cli', 'devkit', { listed: false, source: undefined, marketName: 'anthropic-plugin-directory' })] }), texts).length, 1, 'an install whose marketplace that tool doesn’t list may be this one');
  assert.equal(idsOf(viewWith({ installed: [install('claude-cli', 'devkit', { source: 'https://gitlab.com/other/tools' })] }), texts).length, 4, 'another marketplace’s plugin of that name is another plugin');
});

test('two marketplaces offering one plugin with the same text give two hits; an item already a Library row (linked to that plugin in Pi) is not given twice, and the person’s own namesake leaves it be', () => {
  const texts = [kept('https://github.com/acme/tools', 'devkit', [devkit[0]!]), kept('https://gitlab.com/other/tools', 'devkit', [devkit[0]!], 'other-tools')];
  assert.deepEqual(idsOf(viewWith(), texts), ['catalog:["github.com/acme/tools","devkit","skill","skills/changelog-writer"]', 'catalog:["gitlab.com/other/tools","devkit","skill","skills/changelog-writer"]']);
  const linked = viewWith({ skills: [{ key: 'changelog-writer', name: 'changelog-writer', on: false, copies: {}, fromSource: { link: 'plugin:devkit@acme-tools' } }] });
  assert.deepEqual(idsOf(linked, texts), ['catalog:["gitlab.com/other/tools","devkit","skill","skills/changelog-writer"]'], 'the Off item linked to devkit@acme-tools is that plugin’s, not other-tools’');
  const namesake = viewWith({ skills: [{ key: 'changelog-writer', name: 'changelog-writer', on: true, copies: {} }] });
  assert.equal(idsOf(namesake, texts).length, 2, 'a skill of the person’s own of that name is not the plugin’s');
});

test('text read at an older pin is still given, unmarked: the plugin’s page says what is true now', () => {
  const older = { ...kept('https://github.com/acme/tools', 'devkit', [devkit[0]!]), from: '["https://github.com/acme/tools","","","0ld"]', commit: '0ld' };
  assert.deepEqual(docsOf(viewWith(), [older]).map(doc => [doc.names, doc.plugin]), [[['changelog-writer'], 'devkit']]);
});

test('only the marketplaces the open home lists: text kept from another home’s, until the job matches it to this one, gives nothing; another spelling of a listed one counts', () => {
  const texts = [kept('https://github.com/acme/tools', 'devkit', [devkit[0]!]), kept('https://gitlab.com/other/tools', 'notes', [devkit[1]!], 'other-tools')];
  assert.deepEqual(catalogDocs(viewWith(), texts, ['acme/tools']).map(doc => doc.catalog?.plugin), ['devkit']);
  assert.deepEqual(catalogDocs(viewWith(), texts, []), []);
});

// The Library's documents for word search (src/searchdocs.ts), gathered from real views of a made-up home and asked through
// the index that follows them (src/search.ts searchFollower), as main does at each view: a skill found in a tool, then kept
// Off, is found by its text, through a version made current, a delete and a restore; a plugin's skill in one tool, then in two with texts that
// differ, is one row; a namesake of the person's own and an agent of the same name keep rows of their own; an agent kept Off
// by its prompt, a server by its command, and a skill only in the shared folder by its text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentsView, applyAgents } from '../src/agents.ts';
import { rowClicks } from '../src/libraryrow.ts';
import { readPluginItems } from '../src/pluginitems.ts';
import { searchFollower } from '../src/search.ts';
import { libraryDocs } from '../src/searchdocs.ts';
import { serversView } from '../src/servers.ts';
import { skillsView } from '../src/skills.ts';
import type { HomeView } from '../src/types.ts';
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

test('an item kept Off is found by its text; another version made current, deleted, restored: each answer follows the current text', async () => {
  const box = await sandbox();
  const search = searching(box);
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Keep a ledger of every decision.'), 'templates/decision.md': 'A decision.' });
    assert.deepEqual(await search.found('ledger'), [{ id: 'skills-notes', excerpt: 'Keep a ledger of every decision. templates/decision.md' }], 'found in a tool, by its copy’s text');
    await turnOn(box);
    const first = (await itemOf(box))!.hash;
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Track the open questions.') });
    assert.deepEqual([await search.found('questions'), await search.found('ledger')].map(rows => rows.map(row => row.id)), [['skills-notes'], ['skills-notes']], 'an edit not yet taken in, beside the current version');
    await pass(box);
    await turnOff(box);
    assert.deepEqual([await search.found('questions'), await search.found('ledger')], [[{ id: 'skills-notes', excerpt: 'Track the open questions. templates/decision.md' }], []], 'Off, its current version’s text');
    await makeCurrent(box, first);
    assert.deepEqual([await search.found('ledger'), await search.found('questions'), await search.found('decision template')],
      [[{ id: 'skills-notes', excerpt: 'Keep a ledger of every decision. templates/decision.md' }], [], [{ id: 'skills-notes', excerpt: 'Keep a ledger of every decision. templates/decision.md' }]],
      'the version made current, with its other file’s name');
    await remove(box);
    assert.deepEqual(await search.found('ledger'), [], 'deleted');
    const deleted = (await historyOf(box)).find(event => event.kind === 'deleted')!;
    await restore(box, deleted.id);
    assert.deepEqual(await search.found('ledger'), [{ id: 'skills-notes', excerpt: 'Keep a ledger of every decision. templates/decision.md' }], 'restored');
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

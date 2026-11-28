// MCP sign-in page file marks and inline entry panel (mcpsigninpage.ts): own servers (managed with a capitalised name or
// found) and plugin servers get the file mark after their name and open their entry in a full-width table row under that row
// (a server of your own sharing a plugin server's name opens its own entry); an open panel is forgotten on an empty or
// no-managed-tools draw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView, LibraryFacts } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({
  serverEntry: async (_home: string, key: string) => ({ files: ['.claude.json'], directory: '/tmp/signin-page', holder: 'mcpServers', text: `"${key}": { "url": "https://own.example/${key}" }` }),
  pluginItemTexts: async (plugin: string, _market: string, _kind: string, name: string) => [{ tool: 'claude-cli', text: `{\n  "url": "https://plugin.example/${plugin}/${name}"\n}` }],
}, { byId: id => (rendered ? findById(rendered, id) ?? null : null) });
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first.
await import('../src/settingspage.ts');
const { setRenderer, state } = await import('../src/app.ts');
const { mcpSigninPage } = await import('../src/mcpsigninpage.ts');

const tools: HarnessId[] = ['claude-cli', 'codex-cli'];
const fact = (name: string): LibraryFacts => {
  const key = name.toLowerCase();
  return {
    key, name, description: '', on: key === 'oauth', except: [], cannot: {}, edited: [],
    copies: {
      'claude-cli': { folder: name, hash: `${key}#1`, directory: '/tmp/signin-page/.claude.json' },
      ...(key === 'oauth' ? { 'codex-cli': { folder: name, hash: `${key}#1`, directory: '/tmp/signin-page/.codex/config.toml' } } : {}),
    },
  } as unknown as LibraryFacts;
};
const makeHome = (empty = false, managed: HarnessId[] = tools): HomeView => {
  const kind = { tools: managed, items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] };
  const stored = { key: 'oauth', name: 'OAuth', on: true, hash: 'oauth#1', versions: [], except: [], applied: {}, own: {} };
  return {
    home: '/tmp/signin-page', mode: 'custom', label: 'Test', readId: 1, syncOn: true,
    snapshots: tools.map(harness => ({ harness, probe: { state: 'ok' } })),
    sync: { managed, present: tools, leftOut: tools.filter(tool => !managed.includes(tool)), access: { allowed: true }, gate: { state: 'ready' }, caughtUp: [] },
    skills: kind, agents: kind,
    mcp: { ...kind, items: empty ? [] : [fact('OAuth'), fact('plain'), fact('issues')], library: empty ? {} : { oauth: stored } },
    pluginItems: empty ? [] : [{ tool: 'claude-cli', plugin: 'tracker', marketName: 'probe-market', version: '1.0.0', listed: true, items: [{ kind: 'mcp', name: 'issues', description: '', runs: 'http://127.0.0.1:47212/mcp' }] }],
  } as unknown as HomeView;
};

const draw = () => (rendered = mcpSigninPage() as unknown as FakeNode);
setRenderer(() => { draw(); });
state.page = 'mcpsignin';
const bodyRows = (page: FakeNode) => (findNode(page, el => el.tag === 'tbody')?.children ?? []) as FakeNode[];
const rowById = (page: FakeNode, id: string) => bodyRows(page).find(tr => tr.dataset.row === id)!;

test('MCP sign-in marks own servers and plugin servers, opens each row’s own entry in a full-width row under it, and forgets it when drawn without managed tools or servers', async () => {
  state.home = makeHome();
  state.mcpSignin = { home: state.home.home, columns: {} };
  let page = draw();
  const markOf = (id: string) => findNode(rowById(page, id), el => el.classList.contains('row-file-btn'));
  const pluginIssues = 'tracker@probe-market/issues';
  assert.deepEqual(['oauth', 'plain', 'issues', pluginIssues].map(id => !!markOf(id)), [true, true, true, true]);
  markOf('oauth')!.click();
  page = draw();
  const afterOauth = bodyRows(page);
  const fileRow = afterOauth[afterOauth.indexOf(rowById(page, 'oauth')) + 1];
  const fileCell = fileRow?.children[0] as FakeNode | undefined;
  assert.deepEqual([rowById(page, 'oauth').classList.contains('file-anchored'), fileRow?.classList.contains('signin-file'), fileCell?.tag, fileCell?.attrs.colspan, !!findById(fileCell, 'file-panel-mcpsignin')],
    [true, true, 'td', '3', true]);
  // Own `issues` opens his entry with path; plugin `issues` opens the plugin's formatted entry with no path.
  markOf('issues')!.click();
  await new Promise(done => setImmediate(done));
  page = draw();
  assert.deepEqual([textOf(findNode(findById(page, 'file-panel-mcpsignin'), el => el.tag === 'pre')), !!findNode(findById(page, 'file-panel-mcpsignin'), el => el.classList.contains('file-open-foot'))],
    ['"issues": { "url": "https://own.example/issues" }', true]);
  markOf(pluginIssues)!.click();
  await new Promise(done => setImmediate(done));
  page = draw();
  const afterPlugin = bodyRows(page);
  const pluginFileRow = afterPlugin[afterPlugin.indexOf(rowById(page, pluginIssues)) + 1];
  const pluginPanel = findById(pluginFileRow, 'file-panel-mcpsignin');
  assert.deepEqual([rowById(page, pluginIssues).classList.contains('file-anchored'), pluginFileRow?.classList.contains('signin-file'), (pluginFileRow?.children[0] as FakeNode | undefined)?.attrs.colspan,
    textOf(findNode(pluginPanel, el => el.classList.contains('file-open-name'))), textOf(findNode(pluginPanel, el => el.tag === 'pre')), !!findNode(pluginPanel, el => el.classList.contains('file-open-foot'))],
  [true, true, '3', 'Claude Code’s copy · 1.0.0', '{\n  "url": "https://plugin.example/tracker/issues"\n}', false]);
  // Drawing with no managed tools (the early return) or no servers forgets the open panel on the same home and visit.
  for (const gone of [makeHome(false, []), makeHome(true)]) {
    if (!findById(page, 'file-panel-mcpsignin')) markOf('oauth')!.click();
    state.home = gone;
    draw();
    state.home = makeHome();
    page = draw();
    assert.equal(bodyRows(page).filter(tr => tr.classList.contains('signin-file')).length, 0);
  }
});

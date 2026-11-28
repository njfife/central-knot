// MCP sign-in page file marks and inline entry panel (mcpsigninpage.ts): own servers (managed with a capitalised name or
// found) get the file mark after their name and open their entry in a full-width table row under that row; plugin servers get
// no mark; an open panel is forgotten on an empty or no-managed-tools draw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView, LibraryFacts } from '../src/types.ts';
import { findById, findNode, installDom, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { byId: id => (rendered ? findById(rendered, id) ?? null : null) });
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
    mcp: { ...kind, items: empty ? [] : [fact('OAuth'), fact('plain')], library: empty ? {} : { oauth: stored } },
    pluginItems: empty ? [] : [{ tool: 'claude-cli', plugin: 'tracker', marketName: 'probe-market', version: '1.0.0', listed: true, items: [{ kind: 'mcp', name: 'issues', description: '', runs: 'http://127.0.0.1:47212/mcp' }] }],
  } as unknown as HomeView;
};

const draw = () => (rendered = mcpSigninPage() as unknown as FakeNode);
setRenderer(() => { draw(); });
state.page = 'mcpsignin';
const bodyRows = (page: FakeNode) => (findNode(page, el => el.tag === 'tbody')?.children ?? []) as FakeNode[];
const rowOf = (page: FakeNode, name: string) => bodyRows(page).find(tr => tr.dataset.row && findNode(tr, el => el.classList.contains('signin-server'))?.textContent === name)!;

test('MCP sign-in marks own servers (managed with capitalised name and found) and not plugins, opens a full-width row under the row pressed, and forgets it when drawn without managed tools or servers', () => {
  state.home = makeHome();
  state.mcpSignin = { home: state.home.home, columns: {} };
  let page = draw();
  const markOf = (name: string) => findNode(rowOf(page, name), el => el.classList.contains('row-file-btn'));
  assert.deepEqual(['OAuth', 'plain', 'issues'].map(name => !!markOf(name)), [true, true, false]);
  markOf('OAuth')!.click();
  page = draw();
  const afterOauth = bodyRows(page);
  const fileRow = afterOauth[afterOauth.indexOf(rowOf(page, 'OAuth')) + 1];
  const fileCell = fileRow?.children[0] as FakeNode | undefined;
  assert.deepEqual([rowOf(page, 'OAuth').classList.contains('file-anchored'), fileRow?.classList.contains('signin-file'), fileCell?.tag, fileCell?.attrs.colspan, !!findById(fileCell, 'file-panel-mcpsignin')],
    [true, true, 'td', '3', true]);
  // Drawing with no managed tools (the early return) or no servers forgets the open panel on the same home and visit.
  for (const gone of [makeHome(false, []), makeHome(true)]) {
    if (!findById(page, 'file-panel-mcpsignin')) markOf('OAuth')!.click();
    state.home = gone;
    draw();
    state.home = makeHome();
    page = draw();
    assert.equal(bodyRows(page).filter(tr => tr.classList.contains('signin-file')).length, 0);
  }
});

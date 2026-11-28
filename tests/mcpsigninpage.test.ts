// MCP sign-in page file marks and inline entry panel (mcpsigninpage.ts): own servers (managed or found) get the file mark
// after their name and open their entry in a full-width table row under that row; plugin servers get no mark; an open panel
// moves to another server's row and is forgotten when the table draws empty.
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
const fact = (name: string): LibraryFacts => ({
  key: name, name, description: '', on: name === 'oauth', except: [], cannot: {}, edited: [],
  copies: { 'claude-cli': { folder: name, hash: `${name}#1`, directory: '/tmp/signin-page/.claude.json' } },
}) as unknown as LibraryFacts;
const makeHome = (empty = false): HomeView => {
  const kind = { tools, items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] };
  const stored = { key: 'oauth', name: 'oauth', on: true, hash: 'oauth#1', versions: [], except: [], applied: {}, own: {} };
  return {
    home: '/tmp/signin-page', mode: 'custom', label: 'Test', readId: 1, syncOn: true,
    snapshots: tools.map(harness => ({ harness, probe: { state: 'ok' } })),
    sync: { managed: tools, present: tools, leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, caughtUp: [] },
    skills: kind, agents: kind,
    mcp: { ...kind, items: empty ? [] : [fact('oauth'), fact('plain')], library: empty ? {} : { oauth: stored } },
    pluginItems: empty ? [] : [{ tool: 'claude-cli', plugin: 'tracker', marketName: 'probe-market', version: '1.0.0', listed: true, items: [{ kind: 'mcp', name: 'issues', description: '', runs: 'http://127.0.0.1:47212/mcp' }] }],
  } as unknown as HomeView;
};

const draw = () => (rendered = mcpSigninPage() as unknown as FakeNode);
setRenderer(() => { draw(); });
state.page = 'mcpsignin';
const bodyRows = (page: FakeNode) => (findNode(page, el => el.tag === 'tbody')?.children ?? []) as FakeNode[];
const rowOf = (page: FakeNode, name: string) => bodyRows(page).find(tr => tr.dataset.row && findNode(tr, el => el.classList.contains('signin-server'))?.textContent === name)!;

test('MCP sign-in marks own servers (managed and found) and not plugins, opens a full-width row under the row pressed, moves it, and forgets it on an empty draw', () => {
  state.home = makeHome();
  state.mcpSignin = { home: state.home.home, columns: {} };
  let page = draw();
  const markOf = (name: string) => findNode(rowOf(page, name), el => el.classList.contains('row-file-btn'));
  assert.deepEqual(['oauth', 'plain', 'issues'].map(name => !!markOf(name)), [true, true, false]);
  markOf('oauth')!.click();
  page = draw();
  const afterOauth = bodyRows(page);
  const oauthAt = afterOauth.indexOf(rowOf(page, 'oauth'));
  const fileRow = afterOauth[oauthAt + 1];
  const fileCell = fileRow?.children[0] as FakeNode | undefined;
  assert.deepEqual([rowOf(page, 'oauth').classList.contains('file-anchored'), fileRow?.classList.contains('signin-file'), fileCell?.tag, fileCell?.attrs.colspan, !!findById(fileCell, 'file-panel-mcpsignin')],
    [true, true, 'td', '3', true]);
  markOf('plain')!.click();
  page = draw();
  const afterPlain = bodyRows(page);
  const plainAt = afterPlain.indexOf(rowOf(page, 'plain'));
  assert.deepEqual([rowOf(page, 'oauth').classList.contains('file-anchored'), rowOf(page, 'plain').classList.contains('file-anchored'), afterPlain.filter(tr => tr.classList.contains('signin-file')).length, afterPlain[plainAt + 1]?.classList.contains('signin-file')],
    [false, true, 1, true]);
  state.home = makeHome(true);
  draw();
  state.home = makeHome();
  page = draw();
  assert.equal(bodyRows(page).filter(tr => tr.classList.contains('signin-file')).length, 0);
});

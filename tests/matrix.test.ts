// Library Used cell words by Sort (matrix.ts usedCellWords) and reload step rendering (reloadLines, reloadChips).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWords, DAY_MS } from '../src/model.ts';
import type { RowOrder } from '../src/itemrow.ts';
import { reloadAdvice } from '../src/reload.ts';
import type { Outcome } from '../src/app.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

installDom({});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first, before matrix.ts.
await import('../src/settingspage.ts');
const { reloadChips, reloadLines, usedCellWords } = await import('../src/matrix.ts');

const collectNodes = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) collectNodes(child, match, out);
  return out;
};

test('usedCellWords shows the Sort’s figure (recency in the unused filter), keeps no-use and use unknown, and drops hover when blank', () => {
  const usedAt = new Date(Date.now() - 2 * DAY_MS - 3_600_000).toISOString();
  const sinceAt = new Date(Date.now() - 18 * DAY_MS).toISOString();
  const since = dayWords(sinceAt);
  const usedBy = (sessions: string): Record<RowOrder, string> => ({ 'most-used': sessions, used: '2 days ago', name: '', updated: '' });
  for (const order of ['most-used', 'used', 'name', 'updated'] as RowOrder[]) {
    const pluralText = usedBy('28 sessions')[order], singleText = usedBy('1 session')[order];
    assert.deepEqual(usedCellWords({ used: usedAt, sessions: 28 }, order), { text: pluralText, hover: pluralText ? 'Used 2 days ago · 28 sessions.' : '' });
    assert.deepEqual(usedCellWords({ used: usedAt, sessions: 1 }, order), { text: singleText, hover: singleText ? 'Used 2 days ago · 1 session.' : '' });
    assert.deepEqual(usedCellWords({ used: usedAt, sessions: 28 }, order, true), { text: '2 days ago', hover: 'Used 2 days ago · 28 sessions.' });
    assert.deepEqual(usedCellWords({ noneSeen: true }, order), { text: 'no use seen', hover: 'No use seen in 30 days.' });
    assert.deepEqual(usedCellWords({ noneSeen: true, since: sinceAt }, order), { text: 'no use seen', hover: `No use seen · records from ${since}.` });
    assert.deepEqual(usedCellWords(undefined, order), { text: 'use unknown', hover: 'No tool that has it on can tell whether it was used.' });
  }
});

test('reloadLines says each command once on its copy control, keeps caveats and secondary commands, and uses plain text for no-command steps', () => {
  // Five-tool skill write: Claude Code needs no reload, leaving four tools' steps.
  const fourSkill = reloadAdvice([
    { tool: 'claude-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'copilot-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'codex-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'pi-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'antigravity-cli', kind: 'skill', key: 'draft-rfc', on: true },
  ]);
  const view = reloadLines(fourSkill) as unknown as FakeNode;
  const rows = collectNodes(view, el => el.className.split(/\s+/).includes('reload-row'));
  assert.deepEqual(rows.map(row => ({
    buttons: collectNodes(row, el => el.tag === 'button').map(btn => [textOf(btn), btn.attrs['data-copy']]),
    text: findNode(row, el => el.className.split(/\s+/).includes('reload-row-text'))?.textContent ?? null,
  })), [
    { buttons: [['Copilot CLI: /skills reload', '/skills reload']], text: null },
    { buttons: [], text: 'Codex picks it up at the next turn; if not, start a new chat.' },
    { buttons: [['Pi: /reload', '/reload']], text: null },
    { buttons: [['Antigravity: /skills reload', '/skills reload']], text: 'Reads it at the next turn; for the CLI’s slash menu.' },
  ]);
  // Secondary command + desktop app caveat (Codex MCP both + Claude MCP both): each command once, desktop restart preserved.
  const bothMcp = reloadAdvice([
    { tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true },
    { tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true },
  ], { 'claude-cli': 'both', 'codex-cli': 'both' });
  const mcpRows = collectNodes(reloadLines(bothMcp) as unknown as FakeNode, el => el.className.split(/\s+/).includes('reload-row'));
  assert.deepEqual(mcpRows.map(row => ({
    buttons: collectNodes(row, el => el.tag === 'button').map(btn => [textOf(btn), btn.attrs['data-copy']]),
    text: findNode(row, el => el.className.split(/\s+/).includes('reload-row-text'))?.textContent ?? null,
  })), [
    { buttons: [['Claude Code: claude --continue', 'claude --continue']], text: 'Restart (keeps the chat), or restart Claude desktop.' },
    { buttons: [['Codex: /new', '/new'], ['codex resume --last', 'codex resume --last']], text: 'Or restart to keep the chat; restart the ChatGPT desktop app if it is open.' },
  ]);
});

test('reloadLines folds 3+ shown steps on bands behind Reload steps (N) counted from advice actually shown, keeping 1–2 inline and persisting open state per outcome', () => {
  const outcomeA: Outcome = { page: 'history', text: 'Done A.' };
  const outcomeB: Outcome = { page: 'history', text: 'Done B.' };
  // 3 raw writes where Claude Code is silent -> only 2 shown steps -> inline, no disclosure.
  const twoShown = reloadAdvice([
    { tool: 'claude-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'copilot-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'pi-cli', kind: 'skill', key: 'notes', on: true },
  ]);
  const inline = reloadLines(twoShown, outcomeA) as unknown as FakeNode;
  assert.equal(inline.tag, 'div');
  assert.equal(findById(inline, 'outcome-reloads-fold'), undefined);
  // 5 raw writes where Claude Code is silent -> 4 shown steps -> folded behind Reload steps (4).
  const fourShown = reloadAdvice([
    { tool: 'claude-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'copilot-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'codex-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'pi-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'antigravity-cli', kind: 'skill', key: 'draft-rfc', on: true },
  ]);
  const folded = reloadLines(fourShown, outcomeA) as unknown as FakeNode;
  assert.equal(folded.tag, 'details');
  assert.equal(folded.attrs.id, 'outcome-reloads-fold');
  assert.equal('open' in folded.attrs, false);
  assert.equal(textOf(findById(folded, 'outcome-reloads-toggle')), 'Reload steps (4)');
  // Opening the disclosure persists across redraws for the same outcome and resets for a new outcome.
  (folded as unknown as { open: boolean; ontoggle: (event: { currentTarget: unknown }) => void }).open = true;
  (folded as unknown as { ontoggle: (event: { currentTarget: unknown }) => void }).ontoggle({ currentTarget: folded });
  const redrawn = reloadLines(fourShown, outcomeA) as unknown as FakeNode;
  assert.equal('open' in redrawn.attrs, true);
  const nextOutcome = reloadLines(fourShown, outcomeB) as unknown as FakeNode;
  assert.equal('open' in nextOutcome.attrs, false);
  // Without foldFor (Show all card), 4 steps render directly without double disclosure; 0 steps returns null.
  assert.equal((reloadLines(fourShown) as unknown as FakeNode).tag, 'div');
  assert.equal(reloadLines(reloadAdvice([{ tool: 'claude-cli', kind: 'skill', key: 'notes', on: true }]), outcomeA), null);
  // reloadChips marks unchipped advice items on #outcome-reload-more so +N more counts actual hidden advice.
  const chipsWithCodex = reloadChips(fourShown, outcomeA) as unknown as FakeNode;
  assert.equal(findById(chipsWithCodex, 'outcome-reload-more')?.attrs['data-extra-reloads'], '1');
  const chipsAllChipped = reloadChips(twoShown, outcomeA) as unknown as FakeNode;
  assert.equal(findById(chipsAllChipped, 'outcome-reload-more')?.attrs['data-extra-reloads'], undefined);
});

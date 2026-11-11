import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUOTE_LIMIT, cantUse, choiceEffect, shortQuote } from '../src/copywords.ts';

const long = 'Turn the notes, the ticket and the related commits into a first draft that a reviewer can read in one sitting, with every open question listed last and each claim tied to the commit or note it came from.';

test('a quote that fits is shown whole', () => {
  assert.deepEqual(shortQuote('skills', 'Claude Code’s draft.'), { lead: '', words: 'Claude Code’s draft.', tail: '' });
  const exact = 'a'.repeat(QUOTE_LIMIT);
  assert.deepEqual(shortQuote('agents', exact), { lead: '', words: exact, tail: '' });
});

test('a longer quote is cut after a whole word and ends with “…”, so it does not read as the whole sentence', () => {
  const quote = shortQuote('skills', long);
  assert.deepEqual(quote, { lead: '', words: 'Turn the notes, the ticket and the related commits into a first draft that a reviewer can read in one sitting, with every open question', tail: '…' });
  assert.ok(quote.words.length <= QUOTE_LIMIT);
  // Punctuation the cut would leave hanging before the “…” goes too.
  assert.equal(shortQuote('skills', `${'word '.repeat(27)}last, ${'more '.repeat(10)}`).words.endsWith('last'), true);
});

test('one word longer than the limit is cut at the limit', () => {
  const quote = shortQuote('skills', 'x'.repeat(QUOTE_LIMIT + 60));
  assert.deepEqual([quote.words.length, quote.tail], [QUOTE_LIMIT, '…']);
});

test('an agent’s long line keeps the words only this copy has: it starts a few words before them, with “…” at both ends', () => {
  const line = `${long} Codex’s own wording goes here, and then the line carries on for a while longer than a row has room for.`;
  const own = line.indexOf('Codex’s own wording');
  const quote = shortQuote('agents', line, own);
  assert.deepEqual([quote.lead, quote.tail], ['…', '…']);
  assert.match(quote.words, /^(tied to|the commit|commit or).* Codex’s own wording goes here/);
  assert.ok(quote.words.length <= QUOTE_LIMIT);
  // Words of its own near the start need no such move.
  assert.equal(shortQuote('agents', line, 5).lead, '');
});

test('an MCP server’s command is never shortened: its row is the only place the question shows it', () => {
  const command = `Command · search-mcp --index codex --cache-directory /Users/someone/${'folder/'.repeat(30)} --timeout-seconds 45`;
  assert.deepEqual(shortQuote('mcp', command), { lead: '', words: command, tail: '' });
});

test('choosing a copy names the one or two copies it replaces, and the tools it adds the item to', () => {
  assert.equal(choiceEffect(['Codex'], []), 'Replaces Codex’s copy.');
  assert.equal(choiceEffect(['Claude Code', 'Copilot CLI'], []), 'Replaces Claude Code’s copy and Copilot CLI’s copy.');
  assert.equal(choiceEffect(['Codex'], ['Claude Code']), 'Replaces Codex’s copy; adds it to Claude Code.');
  assert.equal(choiceEffect([], ['Codex', 'Pi']), 'Adds it to Codex and Pi.');
});

test('more than two replaced copies are counted, not named: five choices do not each repeat four names', () => {
  assert.equal(choiceEffect(['Copilot CLI', 'Codex', 'Pi', 'OpenCode'], []), 'Replaces the other 4 copies.');
  assert.equal(choiceEffect(['Codex', 'Pi', 'OpenCode'], ['Claude Code']), 'Replaces the other 3 copies; adds it to Claude Code.');
});

test('why a copy can’t be chosen is said once: a row under the copy’s name, a result naming the copy', () => {
  const cause = 'Copilot CLI will not load a skill with no YAML frontmatter.';
  assert.equal(cantUse(cause), 'Can’t be used: Copilot CLI will not load a skill with no YAML frontmatter.');
  assert.equal(cantUse(cause, 'Claude Code'), 'Claude Code’s copy can’t be used: Copilot CLI will not load a skill with no YAML frontmatter.');
});

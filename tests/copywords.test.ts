import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUOTE_LIMIT, cantUse, choiceEffect, nearestLine, shortQuote } from '../src/copywords.ts';

const long = 'Turn the notes, the ticket and the related commits into a first draft that a reviewer can read in one sitting, with every open question listed last and each claim tied to the commit or note it came from.';

test('a quote that fits is shown whole', () => {
  assert.deepEqual(shortQuote('skills', 'Claude Code’s draft.'), { lead: '', words: 'Claude Code’s draft.', tail: '', start: 0 });
  const exact = 'a'.repeat(QUOTE_LIMIT);
  assert.deepEqual(shortQuote('agents', exact), { lead: '', words: exact, tail: '', start: 0 });
});

test('a longer quote is cut after a whole word and ends with “…”, so it does not read as the whole sentence', () => {
  const quote = shortQuote('skills', long);
  assert.deepEqual(quote, { lead: '', words: 'Turn the notes, the ticket and the related commits into a first draft that a reviewer can read in one sitting, with every open question', tail: '…', start: 0 });
  assert.ok(quote.words.length <= QUOTE_LIMIT);
  // Punctuation the cut would leave hanging before the “…” goes too.
  assert.equal(shortQuote('skills', `${'word '.repeat(27)}last, ${'more '.repeat(10)}`).words.endsWith('last'), true);
});

test('one word longer than the limit is cut at the limit', () => {
  const quote = shortQuote('skills', 'x'.repeat(QUOTE_LIMIT + 60));
  assert.deepEqual([quote.words.length, quote.tail], [QUOTE_LIMIT, '…']);
});

test('an agent’s long line keeps the words only this copy has: it starts a few words before them, with “…” at both ends', () => {
  const line = `${long} Codex’s own wording goes here, and then the line carries on for a good while longer than any one row of the list has the room to quote.`;
  const own = line.indexOf('Codex’s own wording');
  const quote = shortQuote('agents', line, own);
  // The last word that starts 40 characters or more before them begins it, so a few words lead up to what differs.
  assert.deepEqual(quote, { lead: '…', words: 'tied to the commit or note it came from. Codex’s own wording goes here, and then the line carries on for a good while longer than any one', tail: '…', start: 163 });
  assert.ok(own - quote.start >= 40 && quote.words.length <= QUOTE_LIMIT);
  assert.equal(line.slice(quote.start, quote.start + quote.words.length), quote.words, 'start says where the kept words begin');
  // Words of its own near the start need no such move.
  assert.equal(shortQuote('agents', line, 5).lead, '');
});

test('two copies of one long line are quoted through the same stretch: the one that stops sooner is seen to stop', () => {
  const longer = `${long} Codex’s own wording.`;
  const partsAt = longer.indexOf('Codex’s own wording');
  // The shorter copy has no words of its own: it is quoted where the longer one's words would go.
  const [short, more] = [shortQuote('agents', long, partsAt), shortQuote('agents', longer, partsAt)];
  assert.equal(short.start, more.start, 'both rows start at the same word');
  assert.deepEqual([short.lead, short.tail], ['…', ''], 'the shorter copy is quoted to its end');
  assert.equal(more.words, `${short.words} Codex’s own wording.`);
});

test('the word where the copies part is never the part left out, however long it or the word before it is', () => {
  const before = 'Read the commits since the last tag and write the release notes, grouped as Added, Changed and Fixed,'; // 100 characters
  const path = `/Users/someone/Library/Caches/${'x'.repeat(20)}`; // 50 characters: it starts within the limit and ends past it
  const line = `${before} ${path} and then the line carries on for a while longer than a row has room for.`;
  const quote = shortQuote('agents', line, line.indexOf(path));
  assert.ok(quote.words.includes(path), 'a word that would run past the limit moves the start instead of being left out');
  assert.deepEqual([quote.lead, quote.words.length <= QUOTE_LIMIT], ['…', true]);
  // A long word before it would take the room: the quote starts at the differing word itself.
  const afterLong = `Start ${'y'.repeat(150)} Mine only, and then the line carries on for a while.`;
  assert.match(shortQuote('agents', afterLong, afterLong.indexOf('Mine only')).words, /^Mine only, and then/);
  // A differing word longer than the room is cut at the limit, not dropped.
  const huge = `${before} ${'z'.repeat(200)} and more.`;
  const cut = shortQuote('agents', huge, huge.indexOf('zzz'));
  assert.match(cut.words, /z{90,}$/);
  assert.deepEqual([cut.tail, cut.words.length <= QUOTE_LIMIT], ['…', true]);
  // A shorter copy quoted where the other's words would go always has something to quote, even with one long last word.
  const lastLong = `${before} ${'w'.repeat(60)}`;
  assert.equal(shortQuote('agents', lastLong, lastLong.length + 1).words, 'w'.repeat(60));
});

test('an MCP server’s command is never shortened: its row is the only place the question shows it', () => {
  const command = `Command · search-mcp --index codex --cache-directory /Users/someone/${'folder/'.repeat(30)} --timeout-seconds 45`;
  assert.deepEqual(shortQuote('mcp', command), { lead: '', words: command, tail: '', start: 0 });
});

test('a copy’s own words are marked against the other copies’ line that shares the most words with it', () => {
  const theirs = ['Read the commits since the last tag and write the release notes for the app.', 'Group them as Added, Changed and Fixed, and list the changes a person using the app would notice first.'];
  // The first line shares “the”, “and” and “app” in several places; the second is the same line but for two words.
  assert.equal(nearestLine('Group them as Added, Changed and Fixed, and list the changes a person using the app would notice first. Codex’s wording.', theirs), theirs[1]);
  assert.equal(nearestLine('Nothing in common here', theirs), undefined);
});

test('choosing a copy names the one or two copies it replaces, and the tools it adds the item to', () => {
  assert.equal(choiceEffect(['Codex'], []), 'Replaces Codex’s copy.');
  assert.equal(choiceEffect(['Claude Code', 'Copilot CLI'], []), 'Replaces Claude Code’s copy and Copilot CLI’s copy.');
  assert.equal(choiceEffect(['Codex'], ['Claude Code']), 'Replaces Codex’s copy; adds it to Claude Code.');
  // A tool whose change waits for Write to Claude Code (an MCP server's, in Claude Code) says when it happens.
  assert.equal(choiceEffect(['Codex'], ['Claude Code'], ['Claude Code']), 'Replaces Codex’s copy; adds it to Claude Code at Write.');
  assert.equal(choiceEffect(['Claude Code'], ['Pi'], ['Claude Code']), 'Replaces Claude Code’s copy at Write; adds it to Pi.');
  assert.equal(choiceEffect([], ['Codex', 'Pi']), 'Adds it to Codex and Pi.');
  // A tool whose differing copy it has another way (~/.agents/skills) is not written: it goes on reading that copy.
  assert.equal(choiceEffect([], [], [], ['Copilot CLI', 'Codex']), 'Copilot CLI and Codex keep reading their copy from elsewhere, which Central Knot doesn’t write.');
  assert.equal(choiceEffect(['Claude Code'], [], [], ['Codex']), 'Replaces Claude Code’s copy; Codex keeps reading its copy from elsewhere, which Central Knot doesn’t write.');
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

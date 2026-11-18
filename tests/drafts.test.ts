import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepLineBreaks, nextDraft, unsaved, type InstructionDraft } from '../src/drafts.ts';

const draft = (tool: InstructionDraft['tool'], text: string, opened = 'Original.\n'): InstructionDraft =>
  ({ tool, from: { home: '/home', path: `/home/${tool}.md`, text: opened }, text, hash: 'h', stage: 'edit' });

test('an unsaved draft is never replaced by another one', () => {
  const typed = draft('codex-cli', 'Original.\nTyped.\n');
  const result = nextDraft(typed, draft('claude-cli', 'Original.\n'));
  assert.equal(result.refused, true);
  assert.equal(result.draft, typed);
});

test('a draft with nothing unsaved gives way, and no draft is open after it', () => {
  const clean = draft('codex-cli', 'Original.\n');
  const next = draft('claude-cli', 'Original.\n');
  assert.deepEqual(nextDraft(clean, next), { draft: next, refused: false });
  assert.deepEqual(nextDraft(undefined, next), { draft: next, refused: false });
  assert.equal(unsaved(clean), false);
});

test('An edit keeps the file’s own line breaks: a line still as it was keeps its own, a new or changed one takes the file’s usual one', () => {
  const opened = 'One\r\nTwo\r\nThree\nFour\r\n';
  // What a text box gives back: every break a \n. Two is changed and Five added; One, Three and Four keep their breaks.
  assert.equal(keepLineBreaks(opened, 'One\nTwo, changed\nThree\nFour\nFive\n'), 'One\r\nTwo, changed\r\nThree\nFour\r\nFive\r\n');
  // Nothing typed: the text as it was opened, byte for byte.
  assert.equal(keepLineBreaks(opened, 'One\nTwo\nThree\nFour\n'), opened);
  // No final break stays without one; a file with no \r is given back as typed.
  assert.equal(keepLineBreaks('A\r\nB', 'A\nB!'), 'A\r\nB!');
  assert.equal(keepLineBreaks('A\nB\n', 'A\nC\n'), 'A\nC\n');
});

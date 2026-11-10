import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextDraft, unsaved, type InstructionDraft } from '../src/drafts.ts';

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

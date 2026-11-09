import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presentTools } from '../src/presence.ts';
import { andList, orList } from '../src/words.ts';
import type { HarnessId, Snapshot } from '../src/types.ts';

const snapshot = (harness: HarnessId, detection: Snapshot['detection'], skills = 0) => ({ harness, detection, skills: Array.from({ length: skills }) }) as Snapshot;

test('a tool is in the home when it was detected or holds skills, and only then', () => {
  const tools = presentTools([
    snapshot('claude-cli', 'Installed'),
    snapshot('copilot-cli', 'Not found'),
    snapshot('codex-cli', 'Config found but app not detected'),
    snapshot('pi-cli', 'Not found', 1),
  ]);
  assert.deepEqual(tools, ['claude-cli', 'codex-cli', 'pi-cli']);
});

test('tool lists read as sentences, with "and" for what is and "or" for a choice', () => {
  assert.equal(andList(['Claude Code', 'Codex']), 'Claude Code and Codex');
  assert.equal(orList(['Claude Code', 'Copilot CLI', 'Codex']), 'Claude Code, Copilot CLI or Codex');
  assert.equal(orList(['Codex']), 'Codex');
});

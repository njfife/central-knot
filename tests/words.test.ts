import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { capitalToolsPhrase, fewNames, pageNames, toolsPhrase } from '../src/words.ts';

test('A page named otherwise on screen is spelled once, in words.ts pageNames: every other sentence, link and button reads it from there', () => {
  const src = new URL('../src/', import.meta.url);
  const files = readdirSync(src).filter(file => file.endsWith('.ts') && file !== 'words.ts');
  for (const name of Object.values(pageNames)) {
    assert.deepEqual(files.filter(file => readFileSync(new URL(file, src), 'utf8').includes(name)), [], `“${name}” is spelled outside words.ts`);
  }
});

test('"all N tools" means exactly the home’s tools, compared by which tools they are', () => {
  const event = ['claude-cli', 'copilot-cli', 'codex-cli'];
  assert.equal(toolsPhrase(event, ['claude-cli', 'copilot-cli', 'codex-cli']), 'all 3 tools');
  // Copilot CLI left the home and Pi joined after the event: still three tools, but not the same three.
  assert.equal(toolsPhrase(event, ['claude-cli', 'codex-cli', 'pi-cli']), 'Claude Code, Copilot CLI and Codex');
  // Two tools are always named, even when they are the whole home.
  assert.equal(toolsPhrase(['codex-cli', 'claude-cli'], ['claude-cli', 'codex-cli']), 'Codex and Claude Code');
});

test('the same phrase can start a label: "All 3 tools", or the names as they are', () => {
  const home = ['claude-cli', 'copilot-cli', 'codex-cli'];
  assert.equal(capitalToolsPhrase(home, home), 'All 3 tools');
  assert.equal(capitalToolsPhrase(['codex-cli', 'claude-cli'], home), 'Codex and Claude Code');
});

test('many names in a sentence: four in full, then the first three and how many more', () => {
  const names = (count: number) => Array.from({ length: count }, (_, index) => `item${index + 1}`);
  assert.deepEqual([fewNames(names(4)), fewNames(names(40))], ['item1, item2, item3 and item4', 'item1, item2, item3 and 37 more']);
});

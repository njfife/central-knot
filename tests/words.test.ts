import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capitalToolsPhrase, toolsPhrase } from '../src/words.ts';

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

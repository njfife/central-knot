import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { capitalToolsPhrase, changedCard, changedName, fewNames, pageNames, profileBack, profileLeftUse, profileStops, toolsPhrase, touchedTools } from '../src/words.ts';

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

test('touchedTools folds 3+ non-all tools as "N of M tools" when all are in the home, else "N tools"', () => {
  const six = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'];
  assert.equal(touchedTools(six.slice(0, 5), six).fold, '5 of 6 tools');
  assert.equal(touchedTools(['claude-cli', 'copilot-cli', 'old-cli'], six).fold, '3 tools');
  assert.deepEqual([touchedTools(six, six).fold, touchedTools(six.slice(0, 2), six).fold], [undefined, undefined]);
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

test('before an act that would end the profile in use, its words are those said after it: Everyday · changed where it is the one last switched to', () => {
  const ending = { names: ['Everyday'], may: false, changed: 'Everyday' };
  assert.deepEqual([changedName('Everyday'), changedCard('Everyday')], ['Everyday · changed',
    'What is on differs from Everyday, the profile you last switched to. Everyday itself is as you saved it; switching to it again sets everything as it says.'],
    'after it: the name, and what it means behind its (?)');
  assert.deepEqual([profileStops(ending), profileStops(ending, true), profileBack(ending)],
    ['the profile becomes Everyday · changed', 'becomes Everyday · changed', 'Everyday stays saved: Undo, or switching to it again, puts it back in use.']);
  assert.deepEqual([profileStops({ ...ending, may: true }), profileStops({ ...ending, may: true }, true)], ['the profile may become Everyday · changed', 'may become Everyday · changed'],
    'while other clicks still wait');
  // Focus came into use without a switch, Everyday was switched to last: the click ends Focus, after it Everyday is named changed,
  // and Undo puts Focus back in use, which the hover says.
  assert.equal(profileBack({ names: ['Focus'], may: false, changed: 'Everyday' }), 'Undo puts Focus back in use.');
  // With none last switched to, as before: the sentence after it is profileLeftUse's.
  const before = { names: ['Everyday', 'Focus'], may: false };
  assert.deepEqual([profileStops(before), profileStops(before, true), profileBack(before)],
    ['Everyday and Focus stay saved but stop being the profiles in use', 'would leave Everyday and Focus', 'Undo, or switching to one of them again, puts it back in use.']);
});

test('a profile leaving use: singular and plural', () => {
  assert.equal(profileLeftUse([]), '');
  assert.equal(profileLeftUse(['Everyday']), 'Everyday stopped being the profile in use.');
  assert.equal(profileLeftUse(['Everyday', 'Focus']), 'Everyday and Focus stopped being the profiles in use.');
  assert.equal(profileLeftUse(['Everyday', 'Focus', 'Incident']), 'Everyday, Focus and Incident stopped being the profiles in use.');
});

// The library's rule as worked examples (src/library.ts): one test per row of its table, on plain values, then `plan` on a
// whole item, then the order setCurrent and keepVersion work in. L is the current version, H the harness's copy, A what was
// applied there last. Contents are single letters: 'a' is older than 'b', and so on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isLibraryItem, keepVersion, newItem, plan, setCurrent, sourceWords, type HarnessCopy, type LibraryItem, type Shelf } from '../src/library.ts';

const has = (hash: string, at = 0): HarnessCopy => ({ is: 'present', hash, at });
const none: HarnessCopy = { is: 'absent' }, unknown: HarnessCopy = { is: 'unknown', why: 'it can’t be read' }, held: HarnessCopy = { is: 'held', why: 'it can’t hold this name' };
const ON = true, OFF = false;

// ---------- decide: the table, row by row ----------

test('On, H = L: nothing', () => assert.equal(decide(ON, 'b', has('b'), 'b'), 'nothing'));
test('On, H = A and L moved on: L is written', () => assert.equal(decide(ON, 'b', has('a'), 'a'), 'write'));
test('On, no copy and nothing applied there: L is written', () => assert.equal(decide(ON, 'b', none, undefined), 'write'));
test('On, H changed while L = A: H becomes the current version', () => assert.equal(decide(ON, 'a', has('b'), 'a'), 'take-in'));
test('On, H changed and L moved on too: the latest wins', () => assert.equal(decide(ON, 'c', has('b'), 'a'), 'latest-wins'));
test('On, a copy where nothing was applied: kept as a version, then L is written', () => assert.equal(decide(ON, 'b', has('x'), undefined), 'keep-then-write'));
test('On, the copy is gone where one was applied: the item turns Off everywhere', () => assert.equal(decide(ON, 'b', none, 'b'), 'turn-off'));
test('Off or excepted, H = A: removed', () => assert.equal(decide(OFF, 'b', has('b'), 'b'), 'remove'));
test('Off or excepted, H changed: kept as a version, then removed', () => assert.equal(decide(OFF, 'b', has('c'), 'b'), 'keep-then-remove'));
test('Off or excepted, a copy where nothing was applied: a found copy, left alone', () => assert.equal(decide(OFF, 'b', has('x'), undefined), 'found'));

test('H unknown is never H gone: nothing happens there, On or Off, whatever was applied', () => {
  for (const wanted of [ON, OFF]) for (const applied of ['b', 'a', undefined]) assert.equal(decide(wanted, 'b', unknown, applied), 'nothing');
});
test('A harness that can’t be given the item (held) is passed over: nothing happens there', () => {
  for (const wanted of [ON, OFF]) for (const applied of ['b', undefined]) assert.equal(decide(wanted, 'b', held, applied), 'nothing');
});
test('Off, and the copy a removal was owed for is gone already: only forgotten', () => {
  assert.equal(decide(OFF, 'b', none, 'b'), 'forget');
  assert.equal(decide(OFF, 'b', none, undefined), 'nothing');
});

// ---------- plan: one item, every managed harness ----------

const day = (number: number) => new Date(Date.UTC(2026, 10, number)).toISOString();
const time = (number: number) => Date.parse(day(number));
/** An agent On at version 'a' (made on the 1st), applied to Claude Code, Copilot CLI and Codex. */
const item = (changes: Partial<LibraryItem> = {}): LibraryItem => ({ ...newItem('agent', 'reviewer', 'reviewer'), on: true, hash: 'a',
  versions: [{ hash: 'a', at: day(1), from: { how: 'found', harness: 'claude-cli' } }], applied: { 'claude-cli': 'a', 'copilot-cli': 'a', 'codex-cli': 'a' }, ...changes });
const quiet = { takeIn: undefined, turnedOffBy: undefined, keep: [], write: [], remove: [], forget: [], found: [] };

test('Every harness holds the current version: nothing to do', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('a') }), { ...quiet, current: ['claude-cli', 'copilot-cli', 'codex-cli'] });
});

test('An edit in Codex becomes the current version and is written to the others', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('b', time(2)) }),
    { ...quiet, takeIn: 'codex-cli', write: ['claude-cli', 'copilot-cli'], current: ['codex-cli'] });
});

test('Two edits: the latest wins, and the other is kept as a version before it is written over', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('c', time(3)), 'copilot-cli': has('a'), 'codex-cli': has('b', time(2)) }),
    { ...quiet, takeIn: 'claude-cli', keep: [{ harness: 'codex-cli', from: { how: 'edited', harness: 'codex-cli' } }], write: ['copilot-cli', 'codex-cli'], current: ['claude-cli'] });
});

test('Two edits made at the same moment: the first harness wins', () => {
  const made = plan(item(), { 'claude-cli': has('c', time(2)), 'codex-cli': has('b', time(2)) });
  assert.equal(made.takeIn, 'claude-cli');
});

test('A copy edited before the current version was made loses to it: kept as a version, then written over', () => {
  // 'b' became current on the 3rd (an edit taken in from Claude Code); Codex's write failed then, and its copy was edited on the 2nd.
  const moved = item({ hash: 'b', versions: [{ hash: 'b', at: day(3), from: { how: 'edited', harness: 'claude-cli' } }, ...item().versions], applied: { 'claude-cli': 'b', 'codex-cli': 'a' } });
  assert.deepEqual(plan(moved, { 'claude-cli': has('b'), 'codex-cli': has('x', time(2)) }),
    { ...quiet, keep: [{ harness: 'codex-cli', from: { how: 'edited', harness: 'codex-cli' } }], write: ['codex-cli'], current: ['claude-cli'] });
  // Edited on the 4th instead, after the current version: it wins.
  assert.equal(plan(moved, { 'claude-cli': has('b'), 'codex-cli': has('x', time(4)) }).takeIn, 'codex-cli');
});

test('A harness managed again holds another copy: it is kept ("was in Codex"), then the current version is written', () => {
  const again = item({ applied: { 'claude-cli': 'a' } });
  assert.deepEqual(plan(again, { 'claude-cli': has('a'), 'codex-cli': has('x', time(9)) }),
    { ...quiet, keep: [{ harness: 'codex-cli', from: { how: 'was-in', harness: 'codex-cli' } }], write: ['codex-cli'], current: ['claude-cli'] });
});

test('A copy deleted by hand turns the item Off: the other copies are removed', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': none, 'codex-cli': has('a') }),
    { ...quiet, turnedOffBy: 'copilot-cli', remove: ['claude-cli', 'codex-cli'], forget: ['copilot-cli'], current: [] });
});

test('A copy deleted in one harness and edited in another: the edit becomes the current version, and the item turns Off', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('b', time(2)), 'copilot-cli': none, 'codex-cli': has('a') }),
    { ...quiet, takeIn: 'claude-cli', turnedOffBy: 'copilot-cli', remove: ['claude-cli', 'codex-cli'], forget: ['copilot-cli'], current: [] });
});

test('Off: copies as applied are removed, a changed one is kept first, one never applied is a found copy', () => {
  const off = item({ on: false, applied: { 'claude-cli': 'a', 'copilot-cli': 'a' } });
  assert.deepEqual(plan(off, { 'claude-cli': has('a'), 'copilot-cli': has('b', time(2)), 'codex-cli': has('x') }),
    { ...quiet, keep: [{ harness: 'copilot-cli', from: { how: 'edited', harness: 'copilot-cli' } }], remove: ['claude-cli', 'copilot-cli'], found: ['codex-cli'], current: [] });
});

test('A harness the person keeps it out of loses its copy; the others stay', () => {
  assert.deepEqual(plan(item({ except: ['codex-cli'] }), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('a') }),
    { ...quiet, remove: ['codex-cli'], current: ['claude-cli', 'copilot-cli'] });
});

test('A copy that can’t be seen changes nothing: no Off, no removal, no write there', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': unknown, 'codex-cli': has('a') }), { ...quiet, current: ['claude-cli', 'codex-cli'] });
  assert.deepEqual(plan(item({ on: false }), { 'claude-cli': unknown, 'copilot-cli': unknown, 'codex-cli': unknown }), { ...quiet, current: [] });
});

test('A copy whose content is a version already is written over without being kept again', () => {
  const two = item({ hash: 'b', versions: [{ hash: 'b', at: day(2), from: { how: 'edited', harness: 'claude-cli' } }, ...item().versions], applied: { 'claude-cli': 'b' } });
  assert.deepEqual(plan(two, { 'claude-cli': has('b'), 'codex-cli': has('a') }), { ...quiet, write: ['codex-cli'], current: ['claude-cli'] });
});

test('A deleted item is wanted nowhere: applied copies go, and a copy that turns up is found', () => {
  const gone = item({ deleted: { at: day(5) }, applied: { 'claude-cli': 'a' } });
  assert.deepEqual(plan(gone, { 'claude-cli': has('a'), 'codex-cli': has('a') }), { ...quiet, remove: ['claude-cli'], found: ['codex-cli'], current: [] });
});

// ---------- Versions: stored and recorded before anything else ----------

/** A shelf that notes the order it is used in, and what the item was when the record was saved. */
function shelf(agent: LibraryItem) {
  const calls: string[] = [];
  const made: Shelf<string> = { store: async (_item, hash, content) => { calls.push(`store ${hash}=${content}`); }, save: async () => { calls.push(`save current=${agent.hash} versions=${agent.versions.map(version => version.hash).join()}`); } };
  return { calls, made };
}

test('setCurrent stores the content, then records the version as current, then saves: all before it returns', async () => {
  const agent = item();
  const { calls, made } = shelf(agent);
  await setCurrent(made, agent, { hash: 'b', at: day(2), from: { how: 'edited', harness: 'codex-cli' } }, 'text of b');
  assert.deepEqual(calls, ['store b=text of b', 'save current=b versions=b,a']);
  assert.deepEqual(agent.versions[0], { hash: 'b', at: day(2), from: { how: 'edited', harness: 'codex-cli' } });
});

test('Making an earlier version current is a new version, so the list says when each content was current', async () => {
  const agent = item({ hash: 'b', versions: [{ hash: 'b', at: day(2), from: { how: 'edited', harness: 'codex-cli' } }, ...item().versions] });
  await setCurrent(shelf(agent).made, agent, { hash: 'a', at: day(3), from: { how: 'made-current' } }, 'text of a');
  assert.equal(agent.hash, 'a');
  assert.deepEqual(agent.versions.map(version => [version.hash, sourceWords(version.from)]), [['a', 'made current again'], ['b', 'edited in Codex'], ['a', 'found in Claude Code']]);
});

test('keepVersion keeps a content without making it current, once, in order of when it was made', async () => {
  const agent = item({ hash: 'c', versions: [{ hash: 'c', at: day(3), from: { how: 'edited', harness: 'claude-cli' } }, ...item().versions] });
  const { calls, made } = shelf(agent);
  const gaveWay = { hash: 'b', at: day(2), from: { how: 'was-in', harness: 'copilot-cli' } } as const;
  await keepVersion(made, agent, gaveWay, 'text of b');
  await keepVersion(made, agent, gaveWay, 'text of b');
  assert.equal(agent.hash, 'c');
  assert.deepEqual(agent.versions.map(version => version.hash), ['c', 'b', 'a']);
  assert.deepEqual(calls, ['store b=text of b', 'save current=c versions=c,b,a', 'store b=text of b', 'save current=c versions=c,b,a']);
});

test('A record’s value is an item only with every field in its shape', () => {
  assert.equal(isLibraryItem(item()), true);
  assert.equal(isLibraryItem({ ...item(), deleted: { at: day(1) } }), true);
  for (const broken of [null, {}, { ...item(), on: 'yes' }, { ...item(), versions: [{ hash: 'a' }] }, { ...item(), applied: { 'claude-cli': 3 } }, { name: 'reviewer', state: 'shared', off: [], copies: [] }]) assert.equal(isLibraryItem(broken), false);
});

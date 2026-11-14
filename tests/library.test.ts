// The library's rule as worked examples (src/library.ts): one test per row of its table, on plain values, then `plan` on a
// whole item, then the order setCurrent and keepVersion work in. L is the current version, H the harness's copy, A what was
// applied there last. Contents are single letters: 'a' is older than 'b', and so on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryOut, decide, fromSource, isLibraryItem, keepVersion, latestCopy, linkedTo, listed, managedAgain, newItem, noteAgainst, plan, setCurrent, originWords, sourceAnswers, takeInAnswer, type HarnessCopy, type LibraryItem, type Shelf, type Version } from '../src/library.ts';

const has = (hash: string, at = 0): HarnessCopy => ({ is: 'present', hash, at });
/** A copy with no time of its own (an MCP entry: its time is its whole file's). */
const untimed = (hash: string): HarnessCopy => ({ is: 'present', hash });
const none: HarnessCopy = { is: 'absent' }, unseen: HarnessCopy = { is: 'unseen', why: 'it can’t be read' }, held: HarnessCopy = { is: 'held', why: 'it can’t hold this name' };
const anotherWay: HarnessCopy = { is: 'held', why: 'a plugin brings it', anotherWay: true };
const ON = true, OFF = false;

// ---------- decide: the table, row by row ----------

test('On, H = L: nothing', () => assert.equal(decide(ON, 'b', has('b'), 'b'), 'nothing'));
test('On, H = A and L moved on: L is written', () => assert.equal(decide(ON, 'b', has('a'), 'a'), 'write'));
test('On, no copy and nothing applied there: L is written', () => assert.equal(decide(ON, 'b', none, undefined), 'write'));
test('On, H changed while L = A: H becomes the current version', () => assert.equal(decide(ON, 'a', has('b'), 'a'), 'take-in'));
test('On, H changed and L moved on too: the latest wins', () => assert.equal(decide(ON, 'c', has('b'), 'a'), 'latest-wins'));
test('On, a copy where nothing was applied: kept as a version, then L is written', () => assert.equal(decide(ON, 'b', has('x'), undefined), 'keep-then-write'));
test('On, the copy is gone where one was applied: the item turns Off everywhere', () => assert.equal(decide(ON, 'b', none, 'b'), 'turn-off'));
test('Off or kept out, H = A: removed', () => assert.equal(decide(OFF, 'b', has('b'), 'b'), 'remove'));
test('Off or kept out, H = L though A is older: removed (it holds the current version: nothing to take in)', () => assert.equal(decide(OFF, 'b', has('b'), 'a'), 'remove'));
test('Off or kept out, H changed while L = A: H becomes the current version, then it is removed', () => assert.equal(decide(OFF, 'b', has('c'), 'b'), 'take-in'));
test('Off or kept out, H changed and L moved on too: the latest wins, then it is removed', () => assert.equal(decide(OFF, 'c', has('b'), 'a'), 'latest-wins'));
test('Off or kept out, a copy where nothing was applied: a found copy, left alone', () => assert.equal(decide(OFF, 'b', has('x'), undefined), 'found'));

test('H unseen is never H gone: nothing happens there, On or Off, whatever was applied', () => {
  for (const wanted of [ON, OFF]) for (const applied of ['b', 'a', undefined]) assert.equal(decide(wanted, 'b', unseen, applied), 'nothing');
});
test('A harness that can’t be given the item (held) is passed over: nothing happens there', () => {
  for (const wanted of [ON, OFF]) for (const applied of ['b', undefined]) assert.equal(decide(wanted, 'b', held, applied), 'nothing');
});
test('A harness that has the item another way: nothing of Central Knot’s goes there, and what was applied there is let go', () => {
  for (const wanted of [ON, OFF]) {
    assert.equal(decide(wanted, 'b', anotherWay, 'b'), 'forget');
    assert.equal(decide(wanted, 'b', anotherWay, undefined), 'nothing');
  }
});
/** A copy of the harness's own where it has the item another way too (a copy in ~/.agents/skills beside it). */
const bothWays = (hash: string): HarnessCopy => ({ is: 'present', hash, at: 0, anotherWay: 'it reads a copy in ~/.agents/skills' });
test('A copy of its own where the harness has the item another way too: Central Knot’s copy is removed, so it is never loaded twice', () => {
  assert.equal(decide(ON, 'b', bothWays('b'), 'b'), 'remove');
  assert.equal(decide(ON, 'b', bothWays('a'), 'a'), 'remove');
});
test('A copy of its own where the harness has the item another way too, edited there: the edit is taken in first, then the copy goes', () => {
  assert.equal(decide(ON, 'b', bothWays('c'), 'b'), 'take-in');
  assert.equal(decide(ON, 'c', bothWays('b'), 'a'), 'latest-wins');
});
test('A copy of its own that Central Knot never put there, where the harness has the item another way too: left alone (both ways)', () => {
  assert.equal(decide(ON, 'b', bothWays('x'), undefined), 'found');
  assert.equal(decide(ON, 'b', bothWays('b'), undefined), 'found');
});
test('Off, and the copy a removal was owed for is gone already: only forgotten', () => {
  assert.equal(decide(OFF, 'b', none, 'b'), 'forget');
  assert.equal(decide(OFF, 'b', none, undefined), 'nothing');
});

// ---------- plan: one item, every managed harness ----------

const day = (number: number) => new Date(Date.UTC(2026, 10, number)).toISOString();
const time = (number: number) => Date.parse(day(number));
/** An agent On at version 'a' (made on the 1st), applied to Claude Code, Copilot CLI and Codex. */
const item = (changes: Partial<LibraryItem> = {}): LibraryItem => ({ ...newItem('reviewer', 'reviewer'), on: true, hash: 'a',
  versions: [{ hash: 'a', at: day(1), from: { how: 'found', harness: 'claude-cli' } }], applied: { 'claude-cli': 'a', 'copilot-cli': 'a', 'codex-cli': 'a' }, ...changes });
const quiet = { takeIn: undefined, orderProved: true, turnedOffBy: undefined, keep: [], write: [], remove: [], forget: [], found: [] };

test('Every harness holds the current version: nothing to do', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('a') }), { ...quiet, current: ['claude-cli', 'copilot-cli', 'codex-cli'] });
});

test('An edit in Codex becomes the current version and is written to the others', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('b', time(2)) }),
    { ...quiet, takeIn: 'codex-cli', write: ['claude-cli', 'copilot-cli'], current: ['codex-cli'] });
});

test('Two edits: the latest wins, as their times prove; the other is kept as a version that was never current before it is written over', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('c', time(3)), 'copilot-cli': has('a'), 'codex-cli': has('b', time(2)) }),
    { ...quiet, takeIn: 'claude-cli', keep: [{ harness: 'codex-cli', from: { how: 'edited', harness: 'codex-cli', replacedBy: 'c' } }], write: ['copilot-cli', 'codex-cli'], current: ['claude-cli'] });
});

test('Two edits made at the same moment: the first harness wins, and the plan says no time decided', () => {
  const made = plan(item(), { 'claude-cli': has('c', time(2)), 'codex-cli': has('b', time(2)) });
  assert.deepEqual([made.takeIn, made.orderProved], ['claude-cli', false]);
  assert.equal(plan(item(), { 'claude-cli': has('c', time(2) + 1), 'codex-cli': has('b', time(2)) }).orderProved, true, 'a millisecond apart is a time');
});

test('A copy edited before the current version was made loses to it: kept as a version, then written over', () => {
  // 'b' became current on the 3rd (an edit taken in from Claude Code); Codex's write failed then, and its copy was edited on the 2nd.
  const moved = item({ hash: 'b', versions: [{ hash: 'b', at: day(3), from: { how: 'edited', harness: 'claude-cli' } }, ...item().versions], applied: { 'claude-cli': 'b', 'codex-cli': 'a' } });
  assert.deepEqual(plan(moved, { 'claude-cli': has('b'), 'codex-cli': has('x', time(2)) }),
    { ...quiet, keep: [{ harness: 'codex-cli', from: { how: 'edited', harness: 'codex-cli', replacedBy: 'b' } }], write: ['codex-cli'], current: ['claude-cli'] });
  // Edited on the 4th instead, after the current version: it wins.
  assert.equal(plan(moved, { 'claude-cli': has('b'), 'codex-cli': has('x', time(4)) }).takeIn, 'codex-cli');
});

test('A harness managed again holds another copy: it is kept ("was in Codex"), then the current version is written', () => {
  const again = item({ applied: { 'claude-cli': 'a' } });
  assert.deepEqual(plan(again, { 'claude-cli': has('a'), 'codex-cli': has('x', time(9)) }),
    { ...quiet, keep: [{ harness: 'codex-cli', from: { how: 'was-in', harness: 'codex-cli', replacedBy: 'a' } }], write: ['codex-cli'], current: ['claude-cli'] });
});

test('A copy deleted by hand turns the item Off: the other copies are removed', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': none, 'codex-cli': has('a') }),
    { ...quiet, turnedOffBy: 'copilot-cli', remove: ['claude-cli', 'codex-cli'], forget: ['copilot-cli'], current: [] });
});

test('A copy deleted in one harness and edited in another: the edit becomes the current version, and the item turns Off', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('b', time(2)), 'copilot-cli': none, 'codex-cli': has('a') }),
    { ...quiet, takeIn: 'claude-cli', turnedOffBy: 'copilot-cli', remove: ['claude-cli', 'codex-cli'], forget: ['copilot-cli'], current: [] });
});

test('Off: copies as applied are removed; an edit no pass took in becomes the current version first; one never applied is a found copy', () => {
  const off = item({ on: false, applied: { 'claude-cli': 'a', 'copilot-cli': 'a' } });
  assert.deepEqual(plan(off, { 'claude-cli': has('a'), 'copilot-cli': has('b', time(2)), 'codex-cli': has('x') }),
    { ...quiet, takeIn: 'copilot-cli', remove: ['claude-cli', 'copilot-cli'], found: ['codex-cli'], current: [] });
});

test('Off with two edits no pass took in: the latest becomes the current version, the other is kept, and both copies are removed', () => {
  const off = item({ on: false });
  assert.deepEqual(plan(off, { 'claude-cli': has('b', time(2)), 'copilot-cli': has('c', time(3)), 'codex-cli': has('a') }),
    { ...quiet, takeIn: 'copilot-cli', keep: [{ harness: 'claude-cli', from: { how: 'edited', harness: 'claude-cli', replacedBy: 'c' } }], remove: ['claude-cli', 'copilot-cli', 'codex-cli'], current: [] });
});

test('A single edit is taken in even when its file’s time is older than the current version (a file copied with its time kept)', () => {
  const since = item({ versions: [{ hash: 'a', at: day(5), from: { how: 'found', harness: 'claude-cli' } }] });
  assert.equal(plan(since, { 'claude-cli': has('a'), 'codex-cli': has('b', time(2)) }).takeIn, 'codex-cli');
});

test('A harness kept out with an edit no pass took in: the edit becomes the current version and reaches the others; its copy is removed', () => {
  assert.deepEqual(plan(item({ except: ['codex-cli'] }), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('b', time(2)) }),
    { ...quiet, takeIn: 'codex-cli', write: ['claude-cli', 'copilot-cli'], remove: ['codex-cli'], current: [] });
});

test('A harness the person keeps it out of loses its copy; the others stay', () => {
  assert.deepEqual(plan(item({ except: ['codex-cli'] }), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('a') }),
    { ...quiet, remove: ['codex-cli'], current: ['claude-cli', 'copilot-cli'] });
});

test('A copy that can’t be seen changes nothing: no Off, no removal, no write there', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': unseen, 'codex-cli': has('a') }), { ...quiet, current: ['claude-cli', 'codex-cli'] });
  assert.deepEqual(plan(item({ on: false }), { 'claude-cli': unseen, 'copilot-cli': unseen, 'codex-cli': unseen }), { ...quiet, current: [] });
});

test('A harness that has the item another way never turns it Off; once the other way ends, the item is written there afresh', () => {
  const agent = item();
  const made = plan(agent, { 'claude-cli': anotherWay, 'copilot-cli': has('a'), 'codex-cli': has('a') });
  assert.deepEqual(made, { ...quiet, forget: ['claude-cli'], current: ['copilot-cli', 'codex-cli'] });
  // carryOut lets A go there (made.forget); then the plugin is gone and Claude Code has no copy.
  delete agent.applied['claude-cli'];
  assert.deepEqual(plan(agent, { 'claude-cli': none, 'copilot-cli': has('a'), 'codex-cli': has('a') }).write, ['claude-cli']);
  // A harness that can't be given the item keeps what was applied there: once it can, a copy gone by then was deleted by hand.
  assert.deepEqual(plan(item(), { 'claude-cli': held, 'copilot-cli': has('a'), 'codex-cli': has('a') }), { ...quiet, current: ['copilot-cli', 'codex-cli'] });
});

// ---------- Copies with no time of their own ----------

test('Both ways in a whole plan: the edit in the copy that goes is taken in and reaches the others, and nothing is written where it has the item another way', () => {
  const made = plan(item(), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': { is: 'present', hash: 'b', at: time(3), anotherWay: 'it reads a copy in ~/.agents/skills' } });
  assert.deepEqual(made, { ...quiet, takeIn: 'codex-cli', write: ['claude-cli', 'copilot-cli'], remove: ['codex-cli'], current: [] });
});

test('An edit with no time of its own, made on the current version, is taken in', () => {
  assert.equal(plan(item(), { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': untimed('b') }).takeIn, 'codex-cli');
});

test('Two edits with no time of their own: which came last can’t be told, so the first harness wins, the plan says no time decided, and the other is kept as a version', () => {
  assert.deepEqual(plan(item(), { 'claude-cli': untimed('c'), 'copilot-cli': has('a'), 'codex-cli': untimed('b') }),
    { ...quiet, takeIn: 'claude-cli', orderProved: false, keep: [{ harness: 'codex-cli', from: { how: 'edited', harness: 'codex-cli', replacedBy: 'c' } }], write: ['copilot-cli', 'codex-cli'], current: ['claude-cli'] });
});

test('An edit with no time of its own that loses to the rule, beside an edit taken in: no time ordered the two, and the plan says so', () => {
  // Codex's write of 'b' was held; Codex's copy was then edited (no time), and Claude Code's edited on 'b'.
  const moved = item({ hash: 'b', versions: [{ hash: 'b', at: day(3), from: { how: 'edited', harness: 'copilot-cli' } }, ...item().versions], applied: { 'claude-cli': 'b', 'codex-cli': 'a' } });
  const made = plan(moved, { 'claude-cli': untimed('c'), 'codex-cli': untimed('x') });
  assert.deepEqual([made.takeIn, made.orderProved, made.keep], ['claude-cli', false, [{ harness: 'codex-cli', from: { how: 'edited', harness: 'codex-cli', replacedBy: 'c' } }]]);
  // With a time, the one that lost to the rule was made before the current version, so before the edit taken in.
  assert.equal(plan(moved, { 'claude-cli': untimed('c'), 'codex-cli': has('x', time(2)) }).orderProved, true);
});

test('An edit with no time of its own, where the current version had moved on as well: the current version stays; the edit is kept and written over', () => {
  const moved = item({ hash: 'b', versions: [{ hash: 'b', at: day(3), from: { how: 'edited', harness: 'claude-cli' } }, ...item().versions], applied: { 'claude-cli': 'b', 'codex-cli': 'a' } });
  assert.deepEqual(plan(moved, { 'claude-cli': has('b'), 'codex-cli': untimed('x') }),
    { ...quiet, keep: [{ harness: 'codex-cli', from: { how: 'edited', harness: 'codex-cli', replacedBy: 'b' } }], write: ['codex-cli'], current: ['claude-cli'] });
});

test('A version’s note: one never current is compared with the version that took its place; any other with the version current before it, passing over those never current', () => {
  const versions: Version[] = [{ hash: 'c', at: day(3), from: { how: 'edited', harness: 'codex-cli' } }, { hash: 'b', at: day(3), from: { how: 'edited', harness: 'claude-cli', replacedBy: 'c' } },
    { hash: 'x', at: day(2), from: { how: 'was-in', harness: 'copilot-cli', replacedBy: 'a' } }, { hash: 'a', at: day(1), from: { how: 'chosen', harness: 'claude-cli' } }];
  assert.deepEqual(versions.map(version => noteAgainst({ versions }, version)), [{ how: 'changed', against: 'a' }, { how: 'differs', against: 'c' }, { how: 'differs', against: 'a' }, 'none']);
  // An edit that lost to the first version doesn't make that version one taken in with copies: only a copy that gave way does.
  const lost: Version[] = [{ hash: 'b', at: day(2), from: { how: 'edited', harness: 'codex-cli', replacedBy: 'a' } }, { hash: 'a', at: day(1), from: { how: 'found', harness: 'claude-cli' } }];
  assert.equal(noteAgainst({ versions: lost }, lost[1]), 'first');
  // An edit that lost, stored before it said what beat it, reads as it did: as current once.
  const older: Version[] = [{ hash: 'c', at: day(3), from: { how: 'edited', harness: 'codex-cli' } }, { hash: 'b', at: day(3), from: { how: 'edited', harness: 'claude-cli' } }, lost[1]];
  assert.deepEqual(noteAgainst({ versions: older }, older[0]), { how: 'changed', against: 'b' });
});

test('A version taken in from a copy with no time of its own is dated when it is taken', async () => {
  const agent = item(), before = Date.now();
  const made = plan(agent, { 'claude-cli': has('a'), 'codex-cli': untimed('b') });
  await carryOut(agent, made, { ...shelf(agent).made, copy: () => ({ hash: 'b', content: 'text of b' }), keepOwn: async () => {}, log: async () => {},
    write: async () => true, remove: async () => true });
  assert.equal(agent.hash, 'b');
  assert.ok(Date.parse(agent.versions[0].at) >= before, agent.versions[0].at);
});

// ---------- A harness managed again ----------

test('Managed again, On: a copy that went while the harness was away is written afresh, never read as deleted by hand', () => {
  const agent = item();
  assert.equal(managedAgain(agent, 'codex-cli', none), undefined);
  assert.equal(agent.applied['codex-cli'], undefined);
  assert.deepEqual(plan(agent, { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': none }), { ...quiet, write: ['codex-cli'], current: ['claude-cli', 'copilot-cli'] });
});

test('Managed again, On: a copy edited meanwhile, or another item of that name, is kept as a version ("was in Codex"), then L is written over it', () => {
  const agent = item();
  assert.deepEqual(managedAgain(agent, 'codex-cli', has('x', time(4))), { hash: 'x', at: day(4), from: { how: 'was-in', harness: 'codex-cli', replacedBy: 'a' } });
  assert.equal(agent.applied['codex-cli'], 'x');
  // The library wins: no edit is taken in, and the current version is written there.
  assert.deepEqual(plan(agent, { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('x', time(4)) }), { ...quiet, write: ['codex-cli'], current: ['claude-cli', 'copilot-cli'] });
});

test('Managed again, Off or kept out: a copy as left is removed; one edited meanwhile is kept as a version, then removed, and the current version stays', () => {
  for (const changes of [{ on: false }, { except: ['codex-cli' as const] }]) {
    const left = item(changes);
    assert.equal(managedAgain(left, 'codex-cli', has('a')), undefined, 'its content is a version already');
    assert.deepEqual(plan(left, { 'codex-cli': has('a') }).remove, ['codex-cli']);
    const edited = item(changes);
    assert.equal(managedAgain(edited, 'codex-cli', has('x', time(4)))?.from.how, 'was-in');
    assert.deepEqual(plan(edited, { 'codex-cli': has('x', time(4)) }), { ...quiet, remove: ['codex-cli'], current: [] });
  }
});

test('Managed again, Off: a copy that went meanwhile leaves nothing applied there, so a later On writes it, never turns it Off', () => {
  const off = item({ on: false });
  managedAgain(off, 'codex-cli', none);
  assert.deepEqual(plan({ ...off, on: true }, { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': none }).write, ['codex-cli']);
});

test('Managed again, deleted: a copy whose content is one of its versions is still Central Knot’s to remove; any other is a found copy, left alone', () => {
  const ownCopy = item({ deleted: { at: day(5) } });
  assert.equal(managedAgain(ownCopy, 'codex-cli', has('a')), undefined);
  assert.deepEqual(plan(ownCopy, { 'codex-cli': has('a') }).remove, ['codex-cli']);
  const another = item({ deleted: { at: day(5) } });
  assert.equal(managedAgain(another, 'codex-cli', has('x', time(6))), undefined, 'nothing is kept: the content was never the item’s');
  assert.equal(another.applied['codex-cli'], undefined);
  assert.deepEqual(plan(another, { 'codex-cli': has('x', time(6)) }), { ...quiet, found: ['codex-cli'], current: [] });
});

test('Managed again changes nothing where nothing was applied, or where the copy can’t be seen; a harness with no copy of its own has nothing applied', () => {
  const never = item({ applied: { 'claude-cli': 'a' } });
  assert.equal(managedAgain(never, 'codex-cli', has('x')), undefined);
  assert.deepEqual(never.applied, { 'claude-cli': 'a' });
  const unread = item();
  assert.equal(managedAgain(unread, 'codex-cli', unseen), undefined);
  assert.equal(unread.applied['codex-cli'], 'a');
  for (const copy of [held, anotherWay]) {
    const without = item();
    managedAgain(without, 'codex-cli', copy);
    assert.equal(without.applied['codex-cli'], undefined);
  }
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

test('carryOut tells History first, then keeps versions and saves, then writes, then removes, saving after each removal', async () => {
  // An edit in Codex taken in; Copilot CLI gets it; the item is kept out of Claude Code, whose copy goes.
  const agent = item({ except: ['claude-cli'] });
  const made = plan(agent, { 'claude-cli': has('a'), 'copilot-cli': has('a'), 'codex-cli': has('b', time(2)) });
  const calls: string[] = [];
  await carryOut(agent, made, {
    store: async (_item, hash) => { calls.push(`store ${hash}`); }, save: async () => { calls.push(`save applied=${Object.keys(agent.applied).join()}`); },
    copy: () => ({ hash: 'b', at: time(2), content: 'text of b' }), keepOwn: async () => { calls.push('own'); }, log: async () => { calls.push('log'); },
    write: async harness => { calls.push(`write ${harness}`); return true; }, remove: async harness => { calls.push(`remove ${harness}`); return true; },
  });
  assert.deepEqual(calls, ['log', 'store b', 'save applied=claude-cli,copilot-cli,codex-cli', 'own', 'save applied=claude-cli,copilot-cli,codex-cli',
    'write copilot-cli', 'remove claude-cli', 'save applied=copilot-cli,codex-cli']);
  // What is applied is carryOut's own note, from what write and remove answer.
  assert.deepEqual(agent.applied, { 'copilot-cli': 'b', 'codex-cli': 'b' });
});

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
  assert.deepEqual(agent.versions.map(version => [version.hash, originWords(version.from)]), [['a', 'made current again'], ['b', 'edited in Codex'], ['a', 'found in Claude Code']]);
});

test('keepVersion keeps a content without making it current, once, as the newest taken; the list still shows the current one first', async () => {
  const agent = item({ hash: 'c', versions: [{ hash: 'c', at: day(3), from: { how: 'edited', harness: 'claude-cli' } }, ...item().versions] });
  const { calls, made } = shelf(agent);
  const gaveWay = { hash: 'b', at: day(2), from: { how: 'was-in', harness: 'copilot-cli' } } as const;
  await keepVersion(made, agent, gaveWay, 'text of b');
  await keepVersion(made, agent, gaveWay, 'text of b');
  assert.equal(agent.hash, 'c');
  assert.deepEqual(agent.versions.map(version => version.hash), ['b', 'c', 'a']);
  assert.deepEqual(listed(agent).map(version => version.hash), ['c', 'b', 'a']);
  assert.deepEqual(calls, ['store b=text of b', 'save current=c versions=b,c,a', 'store b=text of b', 'save current=c versions=b,c,a']);
});

test('Versions are listed in the order they were taken, whatever their files’ times say; the current one first, each content once', async () => {
  // An edit whose file carries an old time (copied with its time kept) becomes current: it is still listed first.
  const agent = item();
  await setCurrent(shelf(agent).made, agent, { hash: 'b', at: '2020-01-01T00:00:00.000Z', from: { how: 'edited', harness: 'codex-cli' } }, 'text of b');
  // A file with a time ahead of the clock, then a Make current after it: the Make current is first.
  await setCurrent(shelf(agent).made, agent, { hash: 'c', at: '2099-01-01T00:00:00.000Z', from: { how: 'edited', harness: 'claude-cli' } }, 'text of c');
  await setCurrent(shelf(agent).made, agent, { hash: 'b', at: day(9), from: { how: 'made-current' } }, 'text of b');
  // b's edit is folded into its Make current, the newer entry with that content; the record keeps both.
  assert.deepEqual(listed(agent).map(version => [version.hash, version.from.how]), [['b', 'made-current'], ['c', 'edited'], ['a', 'found']]);
  assert.equal(agent.versions.length, 4);
});

test('A record’s value is an item only with each field of the type it holds (which harnesses and origins it names are not checked)', () => {
  assert.equal(isLibraryItem(item()), true);
  assert.equal(isLibraryItem({ ...item(), deleted: { at: day(1) } }), true);
  for (const broken of [null, {}, { ...item(), own: undefined }, { ...item(), on: 'yes' }, { ...item(), versions: [{ hash: 'a' }] }, { ...item(), applied: { 'claude-cli': 3 } }, { name: 'reviewer', state: 'shared', off: [], copies: [] }]) assert.equal(isLibraryItem(broken), false);
});

// ---------- takeInAnswer: the FOUND table, row by row, a click's column and Synchronize everything's ----------

const copy = (harness: 'claude-cli' | 'codex-cli' | 'copilot-cli', hash: string, more: { at?: number; part?: true; switchedOff?: true } = {}) => ({ harness, hash, ...more });
const found = (copies: ReturnType<typeof copy>[], more: { deleted?: boolean; leaving?: boolean; converted?: boolean } = {}) => ({ copies, deleted: false, leaving: false, converted: false, ...more });
/** Both columns' answers for one found key. */
const both = (key: ReturnType<typeof found>, settle?: { clock: number; ms: number }) => [takeInAnswer('click', key), takeInAnswer('rule', key, undefined, settle)];

test('Found, no copy that can be read: a click is refused, and the rule leaves it found, quietly', () =>
  assert.deepEqual(both(found([])), [{ leave: 'no-copy' }, { leave: 'no-copy' }]));
test('Found, a deleted item’s copy still to leave a harness at Write to Claude Code: no Add, and the rule leaves it', () =>
  assert.deepEqual(both(found([copy('claude-cli', 'a')], { deleted: true, leaving: true })), [{ leave: 'leaving' }, { leave: 'leaving' }]));
test('Found, the record holds it deleted: a click takes it in (the tombstone is lifted), the rule leaves it for good', () =>
  assert.deepEqual(both(found([copy('codex-cli', 'a')], { deleted: true })), [{ take: copy('codex-cli', 'a'), chosen: false }, { leave: 'deleted' }]));
test('Found, a copy that is a plugin’s part: a click takes it in, the rule leaves it (its row keeps Add)', () =>
  assert.deepEqual(both(found([copy('codex-cli', 'a', { part: true }), copy('claude-cli', 'a')])), [{ take: copy('codex-cli', 'a', { part: true }), chosen: false }, { leave: 'part' }]));
test('Found, a skill Convert to skill made from an agent: a click takes it in, the rule leaves it (it would reach the tools that hold the agent)', () =>
  assert.deepEqual(both(found([copy('codex-cli', 'a')], { converted: true })), [{ take: copy('codex-cli', 'a'), chosen: false }, { leave: 'converted' }]));
test('Found, every copy switched off by its tool’s own switch: a click takes it in, the rule leaves it; one copy on is enough for the rule', () => {
  assert.deepEqual(both(found([copy('codex-cli', 'a', { switchedOff: true })])), [{ take: copy('codex-cli', 'a', { switchedOff: true }), chosen: false }, { leave: 'switched-off' }]);
  assert.deepEqual(takeInAnswer('rule', found([copy('claude-cli', 'a'), copy('codex-cli', 'a', { switchedOff: true })])), { take: copy('claude-cli', 'a'), chosen: false });
});
test('Found, a copy whose own time is inside the settle window of the pass’s clock: a click takes it in, the rule leaves it for the next pass', () => {
  const settle = { clock: 10_000, ms: 2000 };
  assert.deepEqual(both(found([copy('claude-cli', 'a', { at: 9000 })]), settle), [{ take: copy('claude-cli', 'a', { at: 9000 }), chosen: false }, { leave: 'settling' }]);
  // Exactly at the window's edge it has settled; a time ahead of the clock by less than the window is still being written.
  assert.deepEqual(takeInAnswer('rule', found([copy('claude-cli', 'a', { at: 8000 })]), undefined, settle), { take: copy('claude-cli', 'a', { at: 8000 }), chosen: false });
  assert.deepEqual(takeInAnswer('rule', found([copy('claude-cli', 'a', { at: 11_000 })]), undefined, settle), { leave: 'settling' });
  // A time far ahead of the clock can't be judged by it: taken at once, never left for ever.
  assert.deepEqual(takeInAnswer('rule', found([copy('claude-cli', 'a', { at: 99_000 })]), undefined, settle), { take: copy('claude-cli', 'a', { at: 99_000 }), chosen: false });
  // A copy with no time of its own (an MCP entry) is taken at once; the page's look has no clock, so the window counts as passed.
  assert.deepEqual(takeInAnswer('rule', found([copy('claude-cli', 'a')]), undefined, settle), { take: copy('claude-cli', 'a'), chosen: false });
  assert.deepEqual(takeInAnswer('rule', found([copy('claude-cli', 'a', { at: 9000 })])), { take: copy('claude-cli', 'a', { at: 9000 }), chosen: false });
});
test('Found, the copy a click chose is gone or changed since: refused, choose again', () => {
  const key = found([copy('claude-cli', 'a'), copy('codex-cli', 'x')]);
  assert.deepEqual(takeInAnswer('click', key, { harness: 'codex-cli', hash: 'y' }), { leave: 'choice-changed' });
  assert.deepEqual(takeInAnswer('click', key, { harness: 'copilot-cli' }), { leave: 'choice-changed' });
});
test('Found, copies that differ and none chosen: a click waits for the row’s question, and so does the rule, with the latest copy where the times tell it', () => {
  assert.deepEqual(both(found([copy('claude-cli', 'a'), copy('codex-cli', 'x')])), [{ wait: 'choice' }, { wait: 'choice' }]);
  assert.deepEqual(both(found([copy('claude-cli', 'a', { at: 1000 }), copy('codex-cli', 'x', { at: 5000 })])), [{ wait: 'choice', latest: 'x' }, { wait: 'choice', latest: 'x' }]);
});

// ---------- latestCopy: which of the copies that differ is the latest ----------

test('The latest copy is the content changed last, a second or more after every other', () => {
  assert.equal(latestCopy([{ hash: 'a', at: 1_000 }, { hash: 'x', at: 2_000 }]), 'x');
  assert.equal(latestCopy([{ hash: 'x', at: 9_000 }, { hash: 'a', at: 2_000 }, { hash: 'b', at: 4_000 }]), 'x', 'of three');
});
test('A content was made when its earliest copy was changed: a copy written later that only carries it doesn’t make it the latest', () =>
  // 'a' was edited at 1 s and copied to Codex at 9 s; 'x' was edited at 5 s, after 'a' was.
  assert.equal(latestCopy([{ hash: 'a', at: 1_000 }, { hash: 'a', at: 9_000 }, { hash: 'x', at: 5_000 }]), 'x'));
test('No latest where a copy has no time of its own (an MCP entry): no dates to go by', () => {
  assert.equal(latestCopy([{ hash: 'a' }, { hash: 'x' }]), undefined);
  assert.equal(latestCopy([{ hash: 'a', at: 1_000 }, { hash: 'x' }]), undefined, 'one timed copy is not enough');
  assert.equal(latestCopy([{ hash: 'a', at: 1_000 }, { hash: 'b', at: 5_000 }, { hash: 'x' }]), undefined, 'one copy with no time, and the others can’t be ordered against it');
});
test('No latest where the last two contents were changed less than a second apart (saved in the same second); one second apart is enough', () => {
  assert.equal(latestCopy([{ hash: 'a', at: 10_000 }, { hash: 'x', at: 10_999 }]), undefined);
  assert.equal(latestCopy([{ hash: 'a', at: 10_000 }, { hash: 'x', at: 10_000 }]), undefined, 'the very same time');
  assert.equal(latestCopy([{ hash: 'a', at: 10_000 }, { hash: 'x', at: 11_000 }]), 'x');
});
test('No latest among copies that are all the same: there is nothing to choose', () => assert.equal(latestCopy([{ hash: 'a', at: 1_000 }, { hash: 'a', at: 5_000 }]), undefined));
test('Known weakness, as written in latestCopy: a copy Central Knot wrote later carries that write’s time, so its older content reads as the latest', () =>
  // The person edited Claude Code's copy to 'b' at 5 s; Central Knot had written 'a' into Codex at 8 s (a tool that was behind).
  assert.equal(latestCopy([{ hash: 'b', at: 5_000 }, { hash: 'a', at: 8_000 }]), 'a'));
test('Found otherwise: taken in from the one content (first harness), or from the copy a click chose', () => {
  assert.deepEqual(both(found([copy('claude-cli', 'a'), copy('codex-cli', 'a')])), [{ take: copy('claude-cli', 'a'), chosen: false }, { take: copy('claude-cli', 'a'), chosen: false }]);
  assert.deepEqual(takeInAnswer('click', found([copy('claude-cli', 'a'), copy('codex-cli', 'x')]), { harness: 'codex-cli', hash: 'x' }), { take: copy('codex-cli', 'x'), chosen: true });
});

// ---------- A source's table (library.ts's header, A SOURCE), one row each ----------

/** An item linked to a source: its current version `hash` (made at `at`), and what was last seen there. */
const linked = (hash: string, seen: string, at = '2026-11-02T10:00:00.000Z'): LibraryItem =>
  ({ ...newItem('notes', 'notes'), hash, versions: [{ hash, at, from: { how: 'source', link: 'team/notes' } }], source: 'src', seen });
const there = (hash: string, commitAt = '2026-11-03T10:00:00.000Z') => ({ hash, commitAt });

test('A source: a name the library has no item for is made, Off; a deleted one is not, but Add on its row brings it back', () => {
  assert.equal(fromSource(undefined, there('s'), 'none'), 'make');
  const tombstone = { ...linked('l', 'l'), deleted: { at: '2026-11-01T00:00:00.000Z' } };
  assert.equal(fromSource(tombstone, there('s'), 'this'), 'deleted');
  assert.equal(fromSource(tombstone, there('s'), 'this', true), 'make');
});

test('A source: S = seen is nothing; S changed with current = seen updates it; S changed to what is current already only moves seen on (update)', () => {
  assert.equal(fromSource(linked('l', 's'), there('s'), 'this'), 'nothing');
  assert.equal(fromSource(linked('l', 'l'), there('s'), 'this'), 'update');
  assert.equal(fromSource(linked('l', 'old'), there('l'), 'this'), 'update');
  // Nothing changed here since the last read, so the source's content is taken whatever its commit's time says (a rebase there).
  assert.equal(fromSource(linked('l', 'l', '2026-11-05T10:00:00.000Z'), there('s', '2026-11-03T10:00:00.000Z'), 'this'), 'update');
});

test('A source: both changed, the later wins by the source’s head commit; a tie, under a second, keeps the current version', () => {
  assert.equal(fromSource(linked('l', 'old', '2026-11-02T10:00:00.000Z'), there('s', '2026-11-03T10:00:00.000Z'), 'this'), 'update');
  assert.equal(fromSource(linked('l', 'old', '2026-11-04T10:00:00.000Z'), there('s', '2026-11-03T10:00:00.000Z'), 'this'), 'keep');
  assert.equal(fromSource(linked('l', 'old', '2026-11-03T10:00:00.000Z'), there('s', '2026-11-03T10:00:00.900Z'), 'this'), 'keep');
  assert.equal(fromSource(linked('l', 'old', '2026-11-03T10:00:00.000Z'), there('s', '2026-11-03T10:00:01.000Z'), 'this'), 'update');
});

test('A source: a name gone, read whole, drops an item linked to it; one that can’t be read, or isn’t linked, changes nothing', () => {
  assert.equal(fromSource(linked('l', 'l'), 'gone', 'this'), 'drop');
  assert.equal(fromSource(linked('l', 'l'), 'unreadable', 'this'), 'nothing');
  assert.equal(fromSource(linked('l', 'l'), 'gone', 'none'), 'nothing');
  assert.equal(fromSource({ ...linked('l', 'l'), deleted: { at: '2026-11-01T00:00:00.000Z' } }, 'gone', 'this'), 'nothing');
});

test('A source: a name the library has that isn’t linked is linked when its content is the same, else not brought in; one linked to another source is never taken over', () => {
  const own = { ...newItem('notes', 'notes'), hash: 'l' };
  assert.equal(fromSource(own, there('l'), 'none'), 'link');
  assert.equal(fromSource(own, there('s'), 'none'), 'differs');
  assert.equal(fromSource(linked('l', 'l'), there('l'), 'another'), 'another');
});

test('A source: an item whose current version this same link gave, unchanged since its source was removed, is linked again and follows the link’s change', () => {
  assert.equal(fromSource(linked('l', 'l'), there('s'), 'once'), 'update');
  assert.equal(fromSource(linked('l', 'l'), there('l'), 'once'), 'link');
});

test('Whom an item is linked to: a source no longer recorded is none, unless its current version is one that same link gave', () => {
  const recorded = new Set(['src', 'other']), source = { id: 'src', link: 'team/notes' }, other = { id: 'other', link: 'team/other' };
  const edited = { ...linked('l', 'l'), source: undefined, versions: [{ hash: 'l', at: '2026-11-04T10:00:00.000Z', from: { how: 'edited' as const, harness: 'codex-cli' as const } }] };
  assert.deepEqual([linkedTo(linked('l', 'l'), source, recorded), linkedTo(linked('l', 'l'), other, recorded), linkedTo(linked('l', 'l'), { id: 'new', link: 'team/notes' }, new Set(['new'])),
    linkedTo(linked('l', 'l'), { id: 'new', link: 'team/else' }, new Set(['new'])), linkedTo(edited, { id: 'new', link: 'team/notes' }, new Set(['new'])), linkedTo(undefined, source, recorded)],
  ['this', 'another', 'once', 'none', 'none', 'none']);
});

test('A source’s read, all at once: every name and every item linked to it gets the table’s answer; a read not whole takes nothing to be gone', () => {
  const items = { notes: linked('l', 'l'), other: { ...linked('o', 'o'), key: 'other', name: 'other' } };
  const read = (whole: boolean) => ({ id: 'src', link: 'team/notes', commitAt: '2026-11-03T10:00:00.000Z', whole, names: new Map([['notes', { hash: 's' }], ['fresh', { hash: 'f' }]]) });
  assert.deepEqual([...sourceAnswers(items, read(true), new Set(['src']))], [['notes', 'update'], ['fresh', 'make'], ['other', 'drop']]);
  assert.deepEqual([...sourceAnswers(items, read(false), new Set(['src']))], [['notes', 'update'], ['fresh', 'make'], ['other', 'nothing']]);
});

test('A version read at a source says where, short; an item’s two source values are optional strings', () => {
  assert.equal(originWords({ how: 'source', link: 'https://github.com/stephenturner/skill-deslop/tree/main' }), 'from github.com/stephenturner/skill-deslop (main)');
  assert.equal(isLibraryItem(linked('l', 'l')), true);
  assert.equal(isLibraryItem({ ...linked('l', 'l'), seen: 4 }), false);
});

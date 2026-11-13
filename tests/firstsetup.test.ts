// First setup as worked examples on real files in temp homes (src/everything.ts, src/setupcounts.ts, library.ts latestCopy): the
// one question, asked once per home; what Yes does, and its one Undo in History, with that Undo's Restore; which copy is the
// latest; the walkthrough of the copies that differ, left half way; the one Undo meeting later changes; and Yes with Automatic
// sync off, a profile in use and a tool left out. Each background pass here is main.ts's (`background`, every kind in turn),
// the only pass Synchronize everything takes found items in. The page's own part (the question's place, the walkthrough's band)
// is scripts/e2e.mjs firstSetupFlow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { agentsView, applyAgents } from '../src/agents.ts';
import { everythingEntryAction, setSyncEverything } from '../src/everything.ts';
import { readHistory } from '../src/history.ts';
import { entriesNow, everythingAction, everythingDone, everythingPlan, everythingSentence, libraryAction } from '../src/historyactions.ts';
import { rowClicks } from '../src/libraryrow.ts';
import { applyServers, restoreServer, serversView } from '../src/servers.ts';
import { asksNow, latestDone, takenOutEarlier, waitingForChoice, walkPlace, wayBackIn, whatYesDoes, type Waiting } from '../src/setupcounts.ts';
import { newRecord, partsRecordPath, readRecord, remember, saveRecord, syncGate, writeAccess, type ShareContext } from '../src/share.ts';
import { applySkills, restoreSkill, skillsView, takeOver } from '../src/skills.ts';
import { chooseTools } from '../src/toolchoice.ts';
import { inUse, liveItems } from '../src/profileplan.ts';
import { readLibraries, readProfiles, saveProfile, switchProfile } from '../src/profiles.ts';
import type { Change, HarnessId, HistoryEvent, HomeView, LibraryFacts, LibraryView } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const skillRoot = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills' } as Record<HarnessId, string>;
const SHARED = '.agents/skills';
const mcpFile = { 'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml' } as Record<HarnessId, string>;

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-first-setup-')));
  const home = join(base, 'home');
  for (const folder of [...Object.values(skillRoot), SHARED, '.claude/agents', '.copilot/agents', '.codex/agents']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
type Box = Awaited<ReturnType<typeof sandbox>>;

const skill = (name: string, body = 'Take notes.') => `---\nname: ${name}\ndescription: ${name} things.\n---\n\n${body}\n`;
/** A skill's folder in `root` (a tool's skills folder, or ~/.agents/skills), last changed at `at` (ms) where given. */
async function putSkill(box: Box, root: string, name: string, body?: string, at?: number) {
  const folder = join(box.home, root, name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'SKILL.md'), skill(name, body));
  if (at !== undefined) { const when = new Date(at); await utimes(join(folder, 'SKILL.md'), when, when); await utimes(folder, when, when); }
}
async function putServers(box: Box, tool: HarnessId, servers: Record<string, unknown>) {
  const toml = Object.entries(servers).map(([name, server]) => `[mcp_servers.${name}]\ncommand = "${(server as { command: string }).command}"\nargs = ${JSON.stringify((server as { args?: string[] }).args ?? [])}\n`).join('\n');
  await mkdir(join(box.home, mcpFile[tool], '..'), { recursive: true });
  await writeFile(join(box.home, mcpFile[tool]), tool === 'codex-cli' ? toml : `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}

/** main.ts's pass of the whole home, every kind in turn (the background pass, or Sync once). */
async function background(box: Box, managed = tools) {
  const whole = { background: true } as const;
  return [await applySkills(box.context, managed, [], whole), await applyServers(box.context, managed, [], whole), await applyAgents(box.context, managed, [], whole)];
}
/** The home as main.ts's view gives it to the page (types.ts HomeView), in the parts first setup reads. */
async function homeView(box: Box, managed = tools): Promise<HomeView> {
  const { record } = await readRecord(box.home);
  return { sync: { managed, present: tools, joining: {}, writes: {}, access: await writeAccess(box.context), gate: await syncGate(box.context), caughtUp: [], syncEverything: record?.syncEverything },
    skills: await skillsView(box.context, managed), mcp: await serversView(box.context, managed), agents: await agentsView(box.context, managed) } as unknown as HomeView;
}
/** Every file in the home but Central Knot's own store, with its bytes: what "byte for byte" compares. */
async function filesIn(box: Box): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { if (relative(box.home, path) !== '.central-knot') await walk(path); }
      else found[relative(box.home, path)] = (await readFile(path)).toString('base64');
    }
  };
  await walk(box.home);
  return found;
}
const history = (box: Box) => readHistory(box.context);
const switchesOn = async (box: Box) => (await history(box)).filter(event => event.kind === 'everything' && event.everything?.ruleOn && !event.everything.undo);
/** Each entry's item and what the tools hold of it now, as History's page decides its actions (historyactions.ts entriesNow). */
const entryItems = async (box: Box, managed = tools) => entriesNow(await homeView(box, managed));
const rowOf = (view: LibraryView, key: string) => view.items.find(item => item.key === key)!;
const pageRow = (fact: LibraryFacts) => ({ key: fact.key, name: fact.name, hashes: Object.fromEntries(Object.entries(fact.copies).map(([tool, copy]) => [tool, copy!.hash])), plan: fact.plan, takeInAnswers: fact.takeInAnswers });
/** The copy question's click for one tool's copy (libraryrow.ts rowClicks.on, `use`), as the row shows it now. */
const choose = (view: LibraryView, key: string, tool: HarnessId): Change => rowClicks.on(pageRow(rowOf(view, key)), undefined, tool);
const recordOf = async (box: Box) => (await readRecord(box.home)).record;

// ---------- The question, asked once per home ----------

test('A new home is asked: Yes switches the rule on with one History entry, and the home is not asked again', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    assert.equal(asksNow(await homeView(box)), 'question');
    assert.deepEqual(await setSyncEverything(box.context, true, true), {});
    assert.deepEqual([(await recordOf(box))?.syncEverything, asksNow(await homeView(box)), (await switchesOn(box)).length], [true, undefined, 1]);
    // Asked again from a page read before the answer (a second window): refused, and nothing changes.
    assert.match((await setSyncEverything(box.context, false, true)).stopped ?? '', /was asked already: Synchronize everything is on/);
    assert.deepEqual([(await recordOf(box))?.syncEverything, (await history(box)).length], [true, 1]);
  } finally { await box.cleanup(); }
});

test('No stores the rule off with no History entry and changes no file; the home is not asked again, and Settings can still switch it on', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    await putServers(box, 'claude-cli', { docs: { command: 'npx' } });
    const before = await filesIn(box);
    assert.deepEqual(await setSyncEverything(box.context, false, true), {});
    await background(box);
    assert.deepEqual([await filesIn(box), (await recordOf(box))?.syncEverything, await history(box), asksNow(await homeView(box))], [before, false, [], undefined]);
    // The Settings row's switch is the way back: switching it on then is a switch-on entry, with its one Undo.
    assert.deepEqual(await setSyncEverything(box.context, true), {});
    assert.equal((await switchesOn(box)).length, 1);
  } finally { await box.cleanup(); }
});

test('A home from before this step, with items On and the rule never answered, is asked once; No changes no file; a home whose rule was chosen in Settings is not asked', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    await applySkills(box.context, tools, [rowClicks.on(pageRow(rowOf(await skillsView(box.context, tools), 'notes')), undefined)]);
    await putSkill(box, skillRoot['codex-cli'], 'tidy');
    assert.equal((await recordOf(box))?.syncEverything, undefined, 'the first click made the record and left the rule unanswered');
    // A restart between the question and the answer: nothing is kept but the record, so it is asked again.
    assert.equal(asksNow(await homeView(box)), 'question');
    assert.equal(asksNow(await homeView(box)), 'question');
    const before = await filesIn(box);
    await setSyncEverything(box.context, false, true);
    await background(box);
    assert.deepEqual([await filesIn(box), asksNow(await homeView(box))], [before, undefined]);
    const chosen = await sandbox();
    try {
      await setSyncEverything(chosen.context, true);
      assert.equal(asksNow(await homeView(chosen)), undefined);
    } finally { await chosen.cleanup(); }
  } finally { await box.cleanup(); }
});

test('Not asked where nothing may be written: another build’s home, a preview-only one, one with no tool managed; Resume first where the home waits for it', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    // Another build owns the record: not asked, and an answer is refused.
    await saveRecord(box.home, { ...newRecord({ ...box.context, build: 'alpha' }), ownerName: 'Central Knot Alpha' });
    assert.equal(asksNow(await homeView(box)), undefined);
    assert.match((await setSyncEverything(box.context, true, true)).stopped ?? '', /Central Knot Alpha syncs this home/);
    // This build's record, but no memory of it: Resume first.
    await saveRecord(box.home, newRecord(box.context), true);
    assert.equal(asksNow(await homeView(box)), 'resume');
    assert.match((await setSyncEverything(box.context, true, true)).stopped ?? '', /no memory of it/);
    await remember(box.context, (await recordOf(box))!.generation);
    assert.equal(asksNow(await homeView(box)), 'question', 'asked once resumed');
    // With no tool managed the Overview points to Harnesses instead; a home that reaches the real one is preview only.
    assert.equal(asksNow(await homeView(box, [])), undefined);
    const preview = { ...(await homeView(box)) };
    preview.sync = { ...preview.sync, access: { allowed: false, reason: 'Preview only.' } };
    assert.equal(asksNow(preview), undefined);
    // A tool's Manage switch turned in a home with no record makes the record and leaves the rule unanswered (step 5a).
    const fresh = await sandbox();
    try {
      await chooseTools(fresh.context, 'codex-cli', false);
      assert.deepEqual([(await recordOf(fresh))?.leftOut, asksNow(await homeView(fresh, ['claude-cli', 'copilot-cli']))], [['codex-cli'], 'question']);
    } finally { await fresh.cleanup(); }
  } finally { await box.cleanup(); }
});

// ---------- Yes, its one Undo, and that Undo's Restore ----------

/**
 * A home like the owner's: 44 found skills, 38 of them in ~/.agents/skills (which Copilot CLI and Codex read, Claude Code not), 7 of
 * those with Claude Code's own copy that differs, 6 in Claude Code alone; a server whose Claude Code and Codex entries differ; and
 * two servers in a form Central Knot can't take.
 */
async function ownersHome(box: Box) {
  const shared = Array.from({ length: 38 }, (_, index) => `shared-${String(index).padStart(2, '0')}`);
  for (const name of shared) await putSkill(box, SHARED, name, 'From the shared folder.', 1_000_000);
  const differing = shared.slice(0, 7);
  for (const name of differing) await putSkill(box, skillRoot['claude-cli'], name, 'Claude Code’s own.', 2_000_000);
  const own = Array.from({ length: 6 }, (_, index) => `own-${index}`);
  for (const name of own) await putSkill(box, skillRoot['claude-cli'], name);
  await putServers(box, 'claude-cli', { docs: { command: 'npx', args: ['docs'] }, odd: 42 });
  await putServers(box, 'codex-cli', { docs: { command: 'npx', args: ['docs', '--v2'] } });
  await mkdir(join(box.home, '.copilot'), { recursive: true });
  await writeFile(join(box.home, mcpFile['copilot-cli']), `${JSON.stringify({ mcpServers: { strange: 'yes' } }, null, 2)}\n`);
  return { shared, differing, own };
}

test('Yes in a home like the owner’s: only new files are written, nothing there changes, the 8 wait; the one Undo puts every tool file back byte for byte with the rule off; its Restore brings it all back', async () => {
  const box = await sandbox();
  try {
    const { differing, own } = await ownersHome(box);
    const before = await filesIn(box);
    // What the question says, counted from the look the pass uses.
    const asked = whatYesDoes(await homeView(box));
    assert.deepEqual(asked, { takes: 37, to: tools, choosing: 8, waitForClaude: 0, fromClaude: false });
    assert.deepEqual(waitingForChoice(await homeView(box)).map(item => item.key), [...differing, 'docs']);
    await setSyncEverything(box.context, true, true);
    await background(box);
    const afterYes = await filesIn(box);
    for (const [path, bytes] of Object.entries(before)) assert.equal(afterYes[path], bytes, `${path} is as it was`);
    const added = Object.keys(afterYes).filter(path => !(path in before)).sort();
    assert.equal(added.length, 31 + 12, 'Claude Code gets the 31 shared skills it lacks; Copilot CLI and Codex the 6 of Claude Code’s own');
    assert.ok(added.every(path => /^\.claude\/skills\/shared-|^\.(copilot|codex)\/skills\/own-/.test(path)));
    const view = await homeView(box);
    assert.deepEqual([waitingForChoice(view).length, whatYesDoes(view).takes, Object.keys(view.skills.library).length], [8, 0, 37]);
    assert.deepEqual(own.map(name => view.skills.library[name]?.on), own.map(() => true));

    // The one Undo: every take-in by its own Undo; each tool file back as it was before Yes, byte for byte; the rule off.
    const [switchOn] = await switchesOn(box);
    const offered = everythingAction(switchOn, await history(box), await entryItems(box, tools));
    assert.deepEqual(offered, { label: 'Undo', help: 'Switch Synchronize everything off and take back the 37 items it took in since, each tool it was found in keeping its own copy' });
    const undone = await everythingEntryAction(box.context, tools, switchOn.id);
    assert.equal(undone.stopped, undefined);
    assert.deepEqual(await filesIn(box), before);
    assert.deepEqual([(await recordOf(box))?.syncEverything, asksNow(await homeView(box))], [false, undefined]);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.deepEqual([undo.everything?.undo?.itemUndos.length, undo.everything?.undo?.left, everythingSentence(undo).text],
      [37, [], 'Undone: switched off, and 37 items it took in are out of Central Knot again, each tool it was found in keeping its own copy.']);
    assert.equal((await history(box)).find(event => event.id === switchOn.id)?.undoneBy, undo.id);
    // Each take-in is marked undone by the entry its own Undo made, as History shows it ("Undone"), and those are what it took back.
    const takeIns = (await history(box)).filter(event => event.cause === 'sync-everything');
    assert.deepEqual([takeIns.length, takeIns.map(event => event.undoneBy).sort()], [37, [...undo.everything!.undo!.itemUndos].sort()]);
    // A pass after it takes nothing back in: each is a tombstone the rule leaves (Add, or Restore, brings it back).
    await background(box);
    assert.deepEqual(await filesIn(box), before);

    // Its Restore: the rule on again, and each item back by its own Restore.
    assert.equal(everythingAction(undo, await history(box), await entryItems(box, tools))?.label, 'Restore');
    const restored = await everythingEntryAction(box.context, tools, undo.id);
    assert.equal(restored.stopped, undefined);
    assert.deepEqual([await filesIn(box), (await recordOf(box))?.syncEverything], [afterYes, true]);
    assert.equal(everythingAction(undo, await history(box), await entryItems(box, tools)), undefined, 'used');
    assert.deepEqual(Object.values((await homeView(box)).skills.library).filter(item => item.on && !item.deleted).length, 37);
  } finally { await box.cleanup(); }
});

// ---------- Which copy is the latest ----------

/** One of the owner's seven: Claude Code's own copy, edited after the copy every other tool reads from ~/.agents/skills. */
async function sharedAndOwn(box: Box) {
  await putSkill(box, SHARED, 'review', 'From the shared folder.', 1_000_000);
  await putSkill(box, skillRoot['claude-cli'], 'review', 'Claude Code’s own, edited later.', 2_000_000);
  return { shared: await readFile(join(box.home, SHARED, 'review/SKILL.md'), 'utf8'), own: await readFile(join(box.home, skillRoot['claude-cli'], 'review/SKILL.md'), 'utf8') };
}

test('The owner’s seven, choosing the tool’s own copy (the latest): it becomes the item; ~/.agents/skills is not Central Knot’s to write, so Copilot CLI and Codex go on reading the shared copy, as their lines say', async () => {
  const box = await sandbox();
  try {
    const { shared, own } = await sharedAndOwn(box);
    const view = await skillsView(box.context, tools);
    const [waiting] = waitingForChoice(await homeView(box));
    assert.deepEqual(waiting, { kind: 'skills', key: 'review', name: 'review', latest: { tool: 'claude-cli', hash: rowOf(view, 'review').copies['claude-cli']!.hash } });
    await applySkills(box.context, tools, [choose(view, 'review', 'claude-cli')]);
    const after = await skillsView(box.context, tools), row = rowOf(after, 'review');
    assert.deepEqual([await readFile(join(box.home, SHARED, 'review/SKILL.md'), 'utf8'), await readFile(join(box.home, skillRoot['claude-cli'], 'review/SKILL.md'), 'utf8')], [shared, own]);
    assert.deepEqual([after.library.review.on, after.library.review.hash === row.copies['claude-cli']?.hash], [true, true]);
    assert.deepEqual(Object.keys(row.anotherWay ?? {}).sort(), ['codex-cli', 'copilot-cli'], 'they have it another way: the shared copy, not the one chosen');
    assert.deepEqual(await readdir(join(box.home, skillRoot['codex-cli'])), [], 'nothing of Central Knot’s goes where a tool has it another way');
  } finally { await box.cleanup(); }
});

test('The owner’s seven, choosing the shared copy: Claude Code’s own copy is written over with it, kept as a version first; ~/.agents/skills is not written', async () => {
  const box = await sandbox();
  try {
    const { shared, own } = await sharedAndOwn(box);
    const view = await skillsView(box.context, tools), ownHash = rowOf(view, 'review').copies['claude-cli']!.hash;
    await applySkills(box.context, tools, [choose(view, 'review', 'codex-cli')]);
    const after = await skillsView(box.context, tools);
    assert.deepEqual([await readFile(join(box.home, SHARED, 'review/SKILL.md'), 'utf8'), await readFile(join(box.home, skillRoot['claude-cli'], 'review/SKILL.md'), 'utf8')], [shared, shared]);
    assert.ok(after.library.review.versions.some(version => version.hash === ownHash), `Claude Code’s own (“${own.trim().split('\n').at(-1)}”) is a version`);
    const chosen = (await history(box)).at(-1)!;
    assert.deepEqual([chosen.kind, chosen.losers.map(loser => loser.tool)], ['chosen', ['claude-cli']]);
    assert.equal(libraryAction(chosen, after.library.review, { managed: tools, pending: [] })?.label, 'Undo', 'its own Undo');
  } finally { await box.cleanup(); }
});

test('A copy that changes between the question and the click is refused, and asked again with the copies as they now are', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes', 'Older.', 1_000_000);
    await putSkill(box, skillRoot['codex-cli'], 'notes', 'Newer.', 5_000_000);
    const shown = await skillsView(box.context, tools);
    await putSkill(box, skillRoot['codex-cli'], 'notes', 'Newer still.', 6_000_000);
    const refused = await applySkills(box.context, tools, [choose(shown, 'notes', 'codex-cli')]);
    assert.deepEqual(refused.results.map(result => [result.unchanged, result.chooseAgain]), [[true, true]]);
    assert.equal(await readFile(join(box.home, skillRoot['claude-cli'], 'notes/SKILL.md'), 'utf8'), skill('notes', 'Older.'));
    const now = await skillsView(box.context, tools), asks = rowOf(now, 'notes').takeInAnswers?.rule;
    assert.deepEqual(asks, { wait: 'choice', latest: rowOf(now, 'notes').copies['codex-cli']!.hash });
    await applySkills(box.context, tools, [choose(now, 'notes', 'codex-cli')]);
    assert.equal(await readFile(join(box.home, skillRoot['claude-cli'], 'notes/SKILL.md'), 'utf8'), skill('notes', 'Newer still.'));
  } finally { await box.cleanup(); }
});

test('No latest to preselect where the dates can’t tell: MCP entries (no time of their own), and two copies saved in the same second', async () => {
  const box = await sandbox();
  try {
    await putServers(box, 'claude-cli', { docs: { command: 'npx', args: ['docs'] } });
    await putServers(box, 'codex-cli', { docs: { command: 'npx', args: ['docs', '--v2'] } });
    await putSkill(box, skillRoot['claude-cli'], 'notes', 'One.', 7_000_100);
    await putSkill(box, skillRoot['codex-cli'], 'notes', 'Two.', 7_000_900);
    const waiting = waitingForChoice(await homeView(box));
    assert.deepEqual(waiting.map(item => [item.key, item.latest]), [['notes', undefined], ['docs', undefined]]);
  } finally { await box.cleanup(); }
});

// ---------- The walkthrough, left half way ----------

test('The walkthrough left half way: nothing is stored about where it was; what was chosen is in, the rest found and unchanged, through a background pass, a choice’s Undo and “Use the latest for the rest” with three that have no dates', async () => {
  const box = await sandbox();
  try {
    for (const [index, name] of ['alpha', 'beta', 'gamma', 'delta'].entries()) {
      await putSkill(box, skillRoot['claude-cli'], name, 'Older.', 1_000_000 + index);
      await putSkill(box, skillRoot['codex-cli'], name, 'Newer.', 9_000_000 + index);
    }
    for (const name of ['one', 'two', 'three']) {
      const servers = async (tool: HarnessId, args: string[]) => { const text = await readFile(join(box.home, mcpFile[tool]), 'utf8').catch(() => ''); await putServers(box, tool, { ...(tool === 'codex-cli' ? {} : JSON.parse(text || '{}').mcpServers), [name]: { command: 'npx', args } }); };
      await servers('claude-cli', [name]);
      await servers('copilot-cli', [name, '--other']);
    }
    await setSyncEverything(box.context, true, true);
    await background(box);
    const list = () => homeView(box).then(waitingForChoice);
    assert.deepEqual((await list()).map(item => [item.key, item.latest?.tool]), [['alpha', 'codex-cli'], ['beta', 'codex-cli'], ['delta', 'codex-cli'], ['gamma', 'codex-cli'], ['one', undefined], ['three', undefined], ['two', undefined]]);
    const untouched = await filesIn(box);
    // Two chosen, by the click their question's main button sends (the latest), then a background pass between two choices.
    for (const key of ['alpha', 'beta']) await applySkills(box.context, tools, [choose(await skillsView(box.context, tools), key, 'codex-cli')]);
    await background(box);
    assert.deepEqual((await list()).map(item => item.key), ['delta', 'gamma', 'one', 'three', 'two']);
    // The app quits: the record holds the answer and nothing about the walkthrough.
    assert.deepEqual(Object.keys((await recordOf(box))!).sort(), ['formatVersion', 'generation', 'owner', 'syncEverything']);
    // beta's own Undo in History while the walkthrough is open: found again, each tool with its own copy; the rule leaves it, so the
    // walkthrough doesn't ask it again, and its row still does (a click's answer waits for a choice).
    const betaChosen = (await history(box)).find(event => event.kind === 'chosen' && event.item === 'beta')!;
    await restoreSkill(box.context, tools, betaChosen.id);
    const beta = rowOf(await skillsView(box.context, tools), 'beta');
    assert.deepEqual([beta.takeInAnswers?.rule, 'wait' in beta.takeInAnswers!.click], [{ leave: 'deleted' }, true]);
    assert.equal((await filesIn(box))[`${skillRoot['claude-cli']}/beta/SKILL.md`], untouched[`${skillRoot['claude-cli']}/beta/SKILL.md`]);
    // "Use the latest for the rest": each item left with a latest gets the click its main button sends; the three servers, with no
    // dates to go by, are skipped and stay found with their copies as they were.
    const left = await list();
    for (const item of left.filter(each => each.latest)) await applySkills(box.context, tools, [rowClicks.on({ key: item.key, hashes: { [item.latest!.tool]: item.latest!.hash } }, undefined, item.latest!.tool)]);
    assert.deepEqual((await list()).map(item => item.key), ['one', 'three', 'two']);
    const now = await filesIn(box);
    for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as const) assert.equal(now[mcpFile[tool]], untouched[mcpFile[tool]], `${tool}’s MCP settings as they were`);
    assert.deepEqual((await history(box)).filter(event => event.kind === 'chosen' && !event.undoneBy).map(event => event.item), ['alpha', 'delta', 'gamma']);
  } finally { await box.cleanup(); }
});

test('The walkthrough leaves a plugin’s parts alone: a part whose copies differ is no item it asks about, and its row still asks', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['codex-cli'], 'kit-skill', 'The plugin’s.', 1_000_000);
    await putSkill(box, skillRoot['claude-cli'], 'kit-skill', 'Mine.', 9_000_000);
    await putSkill(box, skillRoot['claude-cli'], 'mine', 'Older.', 1_000_000);
    await putSkill(box, skillRoot['codex-cli'], 'mine', 'Newer.', 9_000_000);
    await mkdir(join(box.home, '.central-knot'), { recursive: true });
    await writeFile(partsRecordPath(box.home), JSON.stringify({ installs: [{ source: 'example/market', marketName: 'market', plugin: 'kit', tool: 'codex-cli', at: '2026-11-13T09:00:00Z', digest: 'd', items: [{ kind: 'skill', name: 'kit-skill', hash: '' }] }] }));
    const view = await homeView(box);
    assert.deepEqual([waitingForChoice(view).map(item => item.key), 'wait' in rowOf(view.skills, 'kit-skill').takeInAnswers!.click], [['mine'], true]);
    assert.equal(whatYesDoes(view).choosing, 1);
  } finally { await box.cleanup(); }
});

test('The Overview’s way back in starts the walkthrough again once every item left was skipped, though they still wait', () => {
  const review: Waiting = { kind: 'skills', key: 'review', name: 'review' }, docs: Waiting = { kind: 'mcp', key: 'docs', name: 'docs' };
  assert.deepEqual([walkPlace([review, docs], []).at, walkPlace([review, docs], ['skills:review']).number, walkPlace([review, docs], ['skills:review']).of], [review, 2, 2]);
  assert.equal(wayBackIn([review, docs], ['skills:review'], true), 'go-on');
  assert.deepEqual([walkPlace([review, docs], ['skills:review', 'mcp:docs']).at, wayBackIn([review, docs], ['skills:review', 'mcp:docs'], true)], [undefined, 'start']);
  assert.equal(wayBackIn([review], [], false), 'start');
});

test('“Use the latest for the rest” says what happened to each: taken in, skipped with no dates, changed meanwhile, or not chosen because its pass stopped', () => {
  const item = (key: string, kind: Waiting['kind'] = 'skills'): Waiting => ({ kind, key, name: key, latest: { tool: 'codex-cli', hash: key } });
  const [notes, review, plan] = [item('notes'), item('review'), item('plan', 'agents')], docs: Waiting = { kind: 'mcp', key: 'docs', name: 'docs' };
  const done = latestDone([notes, review, plan], [docs], [
    { kind: 'skills', result: { writes: 1, results: [{ item: 'review', outcome: 'held', unchanged: true, chooseAgain: true, message: 'The copy you chose changed since you chose it.' }] } },
    { kind: 'agents', result: { stopped: 'Central Knot Alpha syncs this home, so nothing was written or deleted.', results: [], writes: 0 } },
  ], [review, plan, docs]);
  assert.deepEqual(done, { warn: true, text: 'Used the latest copy for 1 item, each with its own Undo in History. Skipped 1 with no dates to go by (docs): it stays found, and its row asks which copy. '
    + 'review changed meanwhile, so it is asked again. plan wasn’t chosen: Central Knot Alpha syncs this home, so nothing was written or deleted.' });
});

// ---------- The one Undo meets later changes ----------

test('The one Undo after later changes: each take-in edited, turned Off, deleted, taken over or found in Claude Code since is left and named, as are two copies chosen; the rest go, and no copy it says it leaves is removed', async () => {
  const box = await sandbox();
  try {
    for (const name of ['edited', 'offed', 'deleted', 'plain', 'other']) await putSkill(box, skillRoot['claude-cli'], name);
    await putSkill(box, SHARED, 'shared');
    await putServers(box, 'claude-cli', { docs: { command: 'npx', args: ['docs'] } });
    for (const name of ['first', 'second']) { await putSkill(box, skillRoot['claude-cli'], name, 'Mine.', 1_000_000); await putSkill(box, skillRoot['codex-cli'], name, 'Theirs.', 9_000_000); }
    await setSyncEverything(box.context, true, true);
    await background(box);
    const view = await skillsView(box.context, tools);
    // Since: one edited in a tool (the edit taken in), one turned Off, one deleted from Central Knot, the shared one taken over in
    // Codex, and two chosen in the walkthrough.
    await putSkill(box, skillRoot['copilot-cli'], 'edited', 'Edited in Copilot.');
    await background(box);
    await applySkills(box.context, tools, [{ ...rowClicks.off(pageRow(rowOf(view, 'offed')), view.library.offed) }]);
    await applySkills(box.context, tools, [{ ...rowClicks.remove(pageRow(rowOf(view, 'deleted')), view.library.deleted) }]);
    assert.equal((await takeOver(box.context, tools, 'shared', 'codex-cli')).stopped, undefined);
    for (const name of ['first', 'second']) await applySkills(box.context, tools, [choose(await skillsView(box.context, tools), name, 'codex-cli')]);
    const before = await filesIn(box);
    const [switchOn] = await switchesOn(box);
    const plan = everythingPlan(switchOn, await history(box), await entryItems(box));
    assert.deepEqual(plan.takeBack.map(event => event.item).sort(), ['other', 'plain']);
    const undone = await everythingEntryAction(box.context, tools, switchOn.id);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.equal(everythingSentence(undo).text, 'Undone: switched off, and 2 items it took in are out of Central Knot again, each tool it was found in keeping its own copy. Left in: '
      + 'deleted (deleted from Central Knot since), edited (changed since), offed (turned off since), shared (a copy it was found in taken over since), docs (found in Claude Code: no Undo) '
      + 'and first and second (you chose their copies: each has its own Undo).');
    const after = await filesIn(box);
    for (const [path, bytes] of Object.entries(before)) {
      const gone = /^\.(copilot|codex)\/skills\/(plain|other)\//.test(path);
      assert.equal(after[path], gone ? undefined : bytes, `${path}: ${gone ? 'Central Knot’s copy goes' : 'as it was'}`);
    }
    assert.deepEqual([after[`${skillRoot['claude-cli']}/plain/SKILL.md`], (await recordOf(box))?.syncEverything], [before[`${skillRoot['claude-cli']}/plain/SKILL.md`], false]);
  } finally { await box.cleanup(); }
});

test('A switch-on’s Undo after Settings switched the rule off and on again takes back only what it took in, and leaves the later switch as it is, with its own Undo', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'first');
    await setSyncEverything(box.context, true, true);
    await background(box);
    await setSyncEverything(box.context, false);
    await setSyncEverything(box.context, true);
    await putSkill(box, skillRoot['claude-cli'], 'second');
    await background(box);
    const [yes, again] = await switchesOn(box);
    await everythingEntryAction(box.context, tools, yes.id);
    const library = (await skillsView(box.context, tools)).library;
    assert.deepEqual([library.first.deleted !== undefined, library.second.on && !library.second.deleted, (await recordOf(box))?.syncEverything], [true, true, true]);
    const undo = (await history(box)).find(event => event.everything?.undo)!;
    assert.deepEqual([undo.everything?.undo?.switchedOff, everythingSentence(undo).text], [false, 'Undone: 1 item it took in is out of Central Knot again, each tool it was found in keeping its own copy.']);
    // The later switch-on still takes back what it took in since, and switches the rule off.
    assert.equal(everythingAction(again, await history(box), await entryItems(box, tools))?.help, 'Switch Synchronize everything off and take back the 1 item it took in since, each tool it was found in keeping its own copy');
  } finally { await box.cleanup(); }
});

// ---------- The one Undo, and a take-in's own, leave what they promise to leave ----------
// A take-in is taken back only while every place it was found in still holds the copy it held then, in a tool still managed
// (historyactions.ts takeInHeld); anything else is left in and named, by the one Undo and by the take-in's own Undo alike.

/** The take-in's own Undo as History offers it now (its button's label), for the item as main reads it. */
const ownUndo = async (box: Box, key: string, managed = tools) => {
  const entry = (await history(box)).find(event => event.cause === 'sync-everything' && event.key === key)!;
  const about = await entryItems(box, managed);
  return libraryAction(entry, about(entry).item, about(entry).now)?.label;
};

test('A tool left out since, the only one the item was found in: the take-in is left in and named, so the person’s own copy is still there once the tool is managed again', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['copilot-cli'], 'notes', 'My own notes skill.');
    const own = await readFile(join(box.home, skillRoot['copilot-cli'], 'notes/SKILL.md'), 'utf8');
    await setSyncEverything(box.context, true, true);
    await background(box);
    await chooseTools(box.context, 'copilot-cli', false);
    const managed: HarnessId[] = ['claude-cli', 'codex-cli'];
    assert.notEqual(await ownUndo(box, 'notes', managed), 'Undo', 'its own Undo is not offered while Copilot CLI is left out');
    const [switchOn] = await switchesOn(box);
    const undone = await everythingEntryAction(box.context, managed, switchOn.id);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.deepEqual(undo.everything?.undo?.left, [{ item: 'notes', why: 'left-out' }]);
    await chooseTools(box.context, 'copilot-cli', true);
    await background(box);
    assert.equal(await readFile(join(box.home, skillRoot['copilot-cli'], 'notes/SKILL.md'), 'utf8'), own);
  } finally { await box.cleanup(); }
});

for (const edited of ['claude-cli', 'codex-cli'] as const) test(`A hand edit in ${edited} not taken in yet (Automatic sync off): the take-in is left in as changed, and no file is written over or removed`, async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes', 'Original.');
    await setSyncEverything(box.context, true, true);
    await background(box);
    await putSkill(box, skillRoot[edited], 'notes', 'My newer edit.');
    const before = await filesIn(box);
    assert.notEqual(await ownUndo(box, 'notes'), 'Undo');
    const [switchOn] = await switchesOn(box);
    const undone = await everythingEntryAction(box.context, tools, switchOn.id);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.deepEqual([undo.everything?.undo?.left, (await skillsView(box.context, tools)).library.notes.deleted, await filesIn(box)], [[{ item: 'notes', why: 'changed' }], undefined, before]);
  } finally { await box.cleanup(); }
});

test('The copy deleted by hand in the tool it was found in, not taken in yet (Automatic sync off): the take-in is left in as changed, and the Undo says nothing of a copy that is gone', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes', 'Original.');
    await setSyncEverything(box.context, true, true);
    await background(box);
    await rm(join(box.home, skillRoot['claude-cli'], 'notes'), { recursive: true });
    const before = await filesIn(box);
    assert.notEqual(await ownUndo(box, 'notes'), 'Undo');
    const [switchOn] = await switchesOn(box);
    const undone = await everythingEntryAction(box.context, tools, switchOn.id);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.deepEqual([undo.everything?.undo?.left, (await skillsView(box.context, tools)).library.notes.deleted, await filesIn(box)], [[{ item: 'notes', why: 'changed' }], undefined, before]);
  } finally { await box.cleanup(); }
});

test('After the one Undo, what Yes would add is nothing, and Settings can say why: the items it took back are counted as taken out earlier', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    await putSkill(box, skillRoot['claude-cli'], 'plan');
    assert.equal(takenOutEarlier(await homeView(box)), 0);
    await setSyncEverything(box.context, true, true);
    await background(box);
    const [switchOn] = await switchesOn(box);
    await everythingEntryAction(box.context, tools, switchOn.id);
    const view = await homeView(box);
    assert.deepEqual([whatYesDoes(view).takes, takenOutEarlier(view)], [0, 2]);
  } finally { await box.cleanup(); }
});

test('The Restore of an Undo switches the rule on only while no switch came after that Undo: off again in Settings since, it stays off', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    await setSyncEverything(box.context, true, true);
    await background(box);
    const [switchOn] = await switchesOn(box);
    const undone = await everythingEntryAction(box.context, tools, switchOn.id);
    await setSyncEverything(box.context, true);
    await setSyncEverything(box.context, false);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.doesNotMatch(everythingAction(undo, await history(box), await entryItems(box, tools))?.help ?? '', /Switch Synchronize everything on/);
    const restored = await everythingEntryAction(box.context, tools, undo.id);
    const made = (await history(box)).filter(event => restored.made?.includes(event.id));
    assert.deepEqual([(await recordOf(box))?.syncEverything, (await skillsView(box.context, tools)).library.notes.on], [false, true], 'the item is back; the rule is as Settings left it');
    assert.equal(everythingDone(undo, made, made.filter(event => event.kind === 'restored').length, false), 'Restored 1 item; the switch-on’s Undo takes it back.');
  } finally { await box.cleanup(); }
});

test('Taken over since in a tool that read it from ~/.agents/skills, though another tool’s identical copy was the one taken in: the take-in is left in as taken over, and no tool loses it', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes', 'Identical.');
    await putSkill(box, SHARED, 'notes', 'Identical.');
    await setSyncEverything(box.context, true, true);
    await background(box);
    assert.equal((await takeOver(box.context, tools, 'notes', 'codex-cli')).stopped, undefined);
    const before = await filesIn(box);
    assert.notEqual(await ownUndo(box, 'notes'), 'Undo');
    const [switchOn] = await switchesOn(box);
    const undone = await everythingEntryAction(box.context, tools, switchOn.id);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.deepEqual([undo.everything?.undo?.left, await filesIn(box)], [[{ item: 'notes', why: 'taken-over' }], before]);
  } finally { await box.cleanup(); }
});

test('Undo, Restore, then the switch-on’s Undo again: it takes back exactly what the Restore put back, every file as before Yes', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes', 'Original.');
    const before = await filesIn(box);
    await setSyncEverything(box.context, true, true);
    await background(box);
    const [yes] = await switchesOn(box);
    const undone = await everythingEntryAction(box.context, tools, yes.id);
    const restored = await everythingEntryAction(box.context, tools, undone.made![0]);
    assert.equal(restored.stopped, undefined);
    await background(box);
    const again = (await switchesOn(box)).filter(event => !event.undoneBy).at(-1)!;
    assert.equal(everythingAction(again, await history(box), await entryItems(box))?.help, 'Switch Synchronize everything off and take back the 1 item it took in since, each tool it was found in keeping its own copy');
    await everythingEntryAction(box.context, tools, again.id);
    assert.deepEqual([await filesIn(box), (await recordOf(box))?.syncEverything], [before, false]);
  } finally { await box.cleanup(); }
});

test('The Restore passes over an item added, changed or deleted since the Undo, and names it; the others come back', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes', 'Original.');
    await putSkill(box, skillRoot['claude-cli'], 'tidy');
    await setSyncEverything(box.context, true, true);
    await background(box);
    const [yes] = await switchesOn(box);
    const undone = await everythingEntryAction(box.context, tools, yes.id);
    // notes is added again by hand, edited, and deleted from Central Knot.
    await applySkills(box.context, tools, [{ key: 'notes', managed: true, off: [] }]);
    await putSkill(box, skillRoot['claude-cli'], 'notes', 'New incarnation.');
    await background(box);
    await applySkills(box.context, tools, [{ key: 'notes', managed: true, off: [], deleted: true }]);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.match(everythingAction(undo, await history(box), await entryItems(box))?.help ?? '', /put back the 1 item this took out of Central Knot.*; notes was added, changed or deleted since, and stays as it is$/);
    const restored = await everythingEntryAction(box.context, tools, undo.id);
    const library = (await skillsView(box.context, tools)).library;
    assert.deepEqual([library.notes.deleted !== undefined, library.tidy.on && !library.tidy.deleted], [true, true]);
    assert.deepEqual(restored.results.filter(result => result.outcome === 'held').map(result => result.message), ['notes was added, changed or deleted since the Undo, so it stays as it is.']);
  } finally { await box.cleanup(); }
});

test('The band after an Undo’s Restore says what was restored, also where a later switch kept the rule on (the Undo’s entry then reads on)', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    await setSyncEverything(box.context, true, true);
    await background(box);
    const [first] = await switchesOn(box);
    await setSyncEverything(box.context, false);
    await setSyncEverything(box.context, true);
    const undone = await everythingEntryAction(box.context, tools, first.id);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.equal(undo.everything?.ruleOn, true, 'the rule is on: the later switch-on set it');
    const restored = await everythingEntryAction(box.context, tools, undo.id);
    const made = (await history(box)).filter(event => restored.made?.includes(event.id));
    assert.equal(everythingDone(undo, made, made.filter(event => event.kind === 'restored').length, false), 'Restored 1 item; the switch-on’s Undo takes it back.');
  } finally { await box.cleanup(); }
});

test('Yes with Automatic sync off adds nothing until Sync once; the app quits, Sync once runs the next day, and the one Undo takes back what that Sync once took in', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    await putSkill(box, skillRoot['codex-cli'], 'tidy');
    const before = await filesIn(box);
    await setSyncEverything(box.context, true, true);
    // A click's pass with Automatic sync off concerns its own item and takes nothing in.
    await applySkills(box.context, tools, [], { only: new Set(['nothing']) });
    assert.deepEqual([await filesIn(box), Object.keys((await skillsView(box.context, tools)).library)], [before, []]);
    // The next day: Sync once is a pass of the whole home.
    await background(box);
    assert.deepEqual(Object.keys((await skillsView(box.context, tools)).library).sort(), ['notes', 'tidy']);
    const [switchOn] = await switchesOn(box);
    await everythingEntryAction(box.context, tools, switchOn.id);
    assert.deepEqual([await filesIn(box), (await recordOf(box))?.syncEverything], [before, false]);
  } finally { await box.cleanup(); }
});

test('Yes with a profile in use and a tool left out: the profile’s name drops as after any Add; the tool left out is not counted or written; one left out between Yes and the Undo keeps what it has, and the Undo says so', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, skillRoot['claude-cli'], 'notes');
    await applySkills(box.context, tools, [rowClicks.on(pageRow(rowOf(await skillsView(box.context, tools), 'notes')), undefined)]);
    await saveProfile(box.context, { name: 'Work', items: ['skill:notes'] });
    const live = async () => { const read = await readLibraries(box.context); return 'libraries' in read ? liveItems(read.libraries) : []; };
    assert.deepEqual(inUse((await readProfiles(box.home)).profiles, await live()).map(profile => profile.name), ['Work']);
    await putSkill(box, skillRoot['claude-cli'], 'tidy');
    await putSkill(box, skillRoot['claude-cli'], 'plan');
    // Codex is left out: what Yes would do names Claude Code and Copilot CLI only.
    await chooseTools(box.context, 'codex-cli', false);
    const managed: HarnessId[] = ['claude-cli', 'copilot-cli'];
    assert.deepEqual(whatYesDoes(await homeView(box, managed)), { takes: 2, to: ['copilot-cli'], choosing: 0, waitForClaude: 0, fromClaude: false });
    const codexBefore = (await readdir(join(box.home, skillRoot['codex-cli']))).sort();
    await setSyncEverything(box.context, true, true);
    await background(box, managed);
    assert.deepEqual([inUse((await readProfiles(box.home)).profiles, await live()), (await readdir(join(box.home, skillRoot['codex-cli']))).sort()], [[], codexBefore]);
    // Copilot CLI is left out between Yes and the Undo: it keeps what it has, and the Undo says so.
    await chooseTools(box.context, 'copilot-cli', false);
    const copilotBefore = (await readdir(join(box.home, skillRoot['copilot-cli']))).sort();
    assert.deepEqual(copilotBefore, ['notes', 'plan', 'tidy']);
    const [switchOn] = await switchesOn(box);
    assert.match(everythingAction(switchOn, await history(box), await entryItems(box, ['claude-cli']))?.help ?? '', /Copilot CLI isn’t managed now, so it keeps Central Knot’s copy until it is$/);
    const undone = await everythingEntryAction(box.context, tools.filter(tool => tool === 'claude-cli'), switchOn.id);
    const undo = (await history(box)).find(event => event.id === undone.made![0])!;
    assert.deepEqual([(await readdir(join(box.home, skillRoot['copilot-cli']))).sort(), undo.everything?.undo?.keptIn], [copilotBefore, ['copilot-cli']]);
    assert.match(everythingSentence(undo).text, /Copilot CLI isn’t managed now, so it keeps Central Knot’s copy until it is\.$/);
  } finally { await box.cleanup(); }
});

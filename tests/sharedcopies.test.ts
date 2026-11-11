// Skills kept the way the `npx skills` installer keeps them: the real folder in the shared ~/.agents/skills, links to it from
// tools' own skills folders. Managing, deleting, removing and undoing them, layout by layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyChanges, deleteEverywhere, manageView, readHistory, restoreFromHistory } from '../src/manage.ts';
import { readRecord, type ShareContext } from '../src/share.ts';
import type { Change, HarnessId } from '../src/types.ts';

const noPosix = process.platform === 'win32';
const CLAUDE = '.claude/skills', COPILOT = '.copilot/skills', PI = '.pi/agent/skills', SHARED = '.agents/skills';
const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

async function sandbox(tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'pi-cli']) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-shared-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.pi/agent', ...(tools.includes('codex-cli') ? ['.codex'] : [])]) await mkdir(join(home, folder), { recursive: true });
  const context = (extra: Partial<ShareContext> = {}): ShareContext => ({ home, mode: 'custom', build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0,
    read: () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness }))), ...extra });
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
type Box = Awaited<ReturnType<typeof sandbox>>;
async function skill(home: string, root: string, folder: string, content = text(folder)) {
  const directory = join(home, root, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), content);
  return directory;
}
async function link(home: string, root: string, folder: string, to: string) {
  await mkdir(join(home, root), { recursive: true });
  await symlink(to, join(home, root, folder));
}
const isLink = (path: string) => lstat(path).then(info => info.isSymbolicLink(), () => false);
const isFolder = (path: string) => lstat(path).then(info => info.isDirectory(), () => false);
const there = (path: string) => lstat(path).then(() => true, () => false);
const factsOf = async (box: Box, key: string) => (await manageView(box.context())).skills.find(item => item.key === key);
const manage = (key: string, extra: Partial<Change> = {}): Change => ({ key, managed: true, off: [], seenManaged: false, takeOver: true, ...extra });
const messages = (result: { results: { message: string }[]; stopped?: string }) => [result.stopped ?? '', ...result.results.map(entry => entry.message)].join(' | ');

/** Layout 1: the real folder in the shared folder, a relative link from Copilot's folder and an absolute one from Pi's. */
async function installerLayout(box: Box, name = 'opus') {
  const real = await skill(box.home, SHARED, name, text(name, 'Shared.'));
  await link(box.home, COPILOT, name, `../../${SHARED}/${name}`);
  await link(box.home, PI, name, real);
  return real;
}

test('Layout 1: the page sees the links and the shared copy as copies it can take over', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await installerLayout(box);
    const facts = (await factsOf(box, 'opus'))!;
    assert.deepEqual(facts.copies['copilot-cli']!.outside, { kind: 'link', linkTo: `../../${SHARED}/opus` });
    assert.equal(facts.copies['pi-cli']!.outside?.kind, 'link');
    assert.deepEqual(facts.extra.map(extra => [extra.tool, extra.outside?.kind]), [['copilot-cli', 'shared'], ['pi-cli', 'shared']]);
    assert.deepEqual(facts.choiceBlocks['copilot-cli'], []);
  } finally { await box.cleanup(); }
});

test('Layout 1: Manage takes the skill over: real copies replace the links, the shared copy goes, and Undo puts it all back', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await installerLayout(box);
    const result = await applyChanges(box.context(), [manage('opus')]);
    assert.ok(!result.stopped, messages(result));
    for (const root of [COPILOT, PI, CLAUDE]) {
      assert.equal(await isFolder(join(box.home, root, 'opus')), true, `${root} holds a real copy`);
      assert.equal(await readFile(join(box.home, root, 'opus/SKILL.md'), 'utf8'), text('opus', 'Shared.'));
    }
    assert.equal(await there(shared), false, 'the shared copy is removed');
    assert.ok(result.results.some(entry => entry.tookOver === 'link' && entry.harness === 'copilot-cli' && /Replaced the link in Copilot CLI’s skills folder/.test(entry.message)), messages(result));
    assert.ok(result.results.some(entry => entry.tookOver === 'shared' && /Other apps that read that folder won’t find it there/.test(entry.message)), messages(result));
    const facts = (await factsOf(box, 'opus'))!;
    assert.equal(facts.managed, true);
    assert.ok(Object.values(facts.copies).every(copy => copy!.writable && !copy!.outside), 'an ordinary managed skill now');
    assert.equal(facts.extra.length, 0);
    // An edit now spreads like any other managed skill's.
    await writeFile(join(box.home, PI, 'opus/SKILL.md'), text('opus', 'Edited in Pi.'));
    await applyChanges(box.context(), []);
    assert.equal(await readFile(join(box.home, COPILOT, 'opus/SKILL.md'), 'utf8'), text('opus', 'Edited in Pi.'));
    await writeFile(join(box.home, PI, 'opus/SKILL.md'), text('opus', 'Shared.'));
    await applyChanges(box.context(), []);
    // Undo: the History entry for the take-over undoes the whole Manage.
    const tookOver = (await readHistory(box.context())).find(event => event.kind === 'took-over')!;
    assert.ok(tookOver.tookOver?.managedNow);
    const undo = await restoreFromHistory(box.context(), tookOver.id);
    assert.ok(!undo.stopped, messages(undo));
    assert.equal(await readlink(join(box.home, COPILOT, 'opus')), `../../${SHARED}/opus`, 'the relative link is back as it was');
    assert.equal(await readlink(join(box.home, PI, 'opus')), shared, 'the absolute link is back as it was');
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('opus', 'Shared.'), 'the shared copy is back');
    assert.equal(await there(join(box.home, CLAUDE, 'opus')), false, 'the copy Apply all added is removed');
    assert.equal((await factsOf(box, 'opus'))!.managed, false, 'unmanaged again');
  } finally { await box.cleanup(); }
});

test('Layout 1: Delete everywhere on an unmanaged skill removes the links and the shared copy, never what a link leads to by itself, and Restore puts them back', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await installerLayout(box);
    // As the page sends it: every tool with a copy, and their other copies too.
    const result = await applyChanges(box.context(), [{ key: 'opus', managed: false, off: [], remove: ['copilot-cli', 'pi-cli'], everywhere: true, seenManaged: false }]);
    assert.ok(!result.stopped, messages(result));
    for (const path of [join(box.home, COPILOT, 'opus'), join(box.home, PI, 'opus'), shared]) assert.equal(await there(path), false, path);
    assert.equal(await factsOf(box, 'opus'), undefined, 'gone from the page');
    const removed = (await readHistory(box.context())).find(event => event.kind === 'removed')!;
    const back = await restoreFromHistory(box.context(), removed.id);
    assert.ok(!back.stopped, messages(back));
    assert.equal(await readlink(join(box.home, COPILOT, 'opus')), `../../${SHARED}/opus`);
    assert.equal(await readlink(join(box.home, PI, 'opus')), shared);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('opus', 'Shared.'));
  } finally { await box.cleanup(); }
});

test('The reported case: managed the old way, Delete everywhere now removes the links and the shared copy, and nothing is left half-deleted', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await installerLayout(box);
    // Managed before this build (no take-over): the links and the shared copy stay, read only.
    await applyChanges(box.context(), [{ key: 'opus', managed: true, off: [] }]);
    assert.equal(await isLink(join(box.home, COPILOT, 'opus')), true);
    const facts = (await factsOf(box, 'opus'))!;
    assert.equal(facts.managed, true);
    assert.ok(facts.copies['copilot-cli']!.outside, 'a managed skill still shows the copies it can take over');
    const result = await deleteEverywhere(box.context(), 'opus');
    assert.ok(!result.stopped, messages(result));
    assert.doesNotMatch(messages(result), /yourself/);
    for (const path of [join(box.home, COPILOT, 'opus'), join(box.home, PI, 'opus'), join(box.home, CLAUDE, 'opus'), shared]) assert.equal(await there(path), false, path);
    // Restore of a deletion: back in every tool it synced to, as Central Knot's own copies.
    const deleted = (await readHistory(box.context())).find(event => event.kind === 'deleted')!;
    const restored = await restoreFromHistory(box.context(), deleted.id);
    assert.ok(!restored.stopped, messages(restored));
    for (const root of [COPILOT, PI, CLAUDE]) assert.equal(await readFile(join(box.home, root, 'opus/SKILL.md'), 'utf8'), text('opus', 'Shared.'));
    assert.equal(await there(shared), false, 'the shared copy is not put back: each tool has its own');
    assert.match(messages(restored), /Each tool has its own copy now; the links and the shared copy aren’t put back\./);
  } finally { await box.cleanup(); }
});

test('Managing again after a deletion starts from the copies there are, never "No tool it syncs to has a copy to start from"', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await installerLayout(box);
    await applyChanges(box.context(), [{ key: 'opus', managed: true, off: [] }]);
    await deleteEverywhere(box.context(), 'opus');
    // The installer puts it back.
    await installerLayout(box);
    const result = await applyChanges(box.context(), [manage('opus')]);
    assert.doesNotMatch(messages(result), /No tool it syncs to has a copy to start from/);
    assert.equal((await factsOf(box, 'opus'))!.managed, true);
    for (const root of [COPILOT, PI, CLAUDE]) assert.equal(await isFolder(join(box.home, root, 'opus')), true, root);
    assert.equal(await there(join(box.home, SHARED, 'opus')), false);
    // Without a take-over too (an older page): it starts from the read-only copies instead of holding.
    const box2 = await sandbox();
    try {
      await installerLayout(box2);
      await applyChanges(box2.context(), [{ key: 'opus', managed: true, off: [] }]);
      await rm(join(box2.home, CLAUDE, 'opus'), { recursive: true });
      await applyChanges(box2.context(), []);
      await applyChanges(box2.context(), [{ key: 'opus', managed: false, off: [] }]);
      const again = await applyChanges(box2.context(), [{ key: 'opus', managed: true, off: [] }]);
      assert.doesNotMatch(messages(again), /No tool it syncs to has a copy to start from/);
    } finally { await box2.cleanup(); }
  } finally { await box.cleanup(); }
});

test('A Delete everywhere that removes nothing deletes nothing: the skill stays as it was', { skip: noPosix }, async () => {
  const box = await sandbox(['copilot-cli']);
  try {
    // Copilot's skills folder is a link to a folder elsewhere: Central Knot never changes what is in it.
    const dotfiles = join(box.base, 'dotfiles/skills');
    await skill(box.base, 'dotfiles/skills', 'solo');
    await symlink(dotfiles, join(box.home, COPILOT));
    await applyChanges(box.context(), [{ key: 'solo', managed: true, off: [] }]);
    const result = await deleteEverywhere(box.context(), 'solo');
    assert.match(result.stopped ?? '', /link/, messages(result));
    assert.equal(await there(join(dotfiles, 'solo/SKILL.md')), true);
    const { record } = await readRecord(box.home);
    assert.equal(record!.items.solo.state, 'shared', 'not marked deleted');
    assert.equal(record!.items.solo.deleted, undefined);
  } finally { await box.cleanup(); }
});

test('Layout 2: only in the shared folder: each tool that read it there gets its own copy, then the shared copy goes', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'pi-cli', 'codex-cli']);
  try {
    const shared = await skill(box.home, SHARED, 'plain', text('plain', 'Shared.'));
    const facts = (await factsOf(box, 'plain'))!;
    assert.deepEqual(Object.keys(facts.copies).sort(), ['codex-cli', 'copilot-cli', 'pi-cli']);
    const result = await applyChanges(box.context(), [manage('plain')]);
    assert.ok(!result.stopped, messages(result));
    for (const root of [CLAUDE, COPILOT, PI, '.codex/skills']) assert.equal(await readFile(join(box.home, root, 'plain/SKILL.md'), 'utf8'), text('plain', 'Shared.'), root);
    assert.equal(await there(shared), false);
    assert.equal(result.results.filter(entry => entry.tookOver === 'placed').length, 3);
    const tookOver = (await readHistory(box.context())).find(event => event.kind === 'took-over')!;
    // The History row for the new copies undoes the take-over with them.
    const added = (await readHistory(box.context())).find(event => event.kind === 'added')!;
    assert.ok(!(await restoreFromHistory(box.context(), added.id)).stopped);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('plain', 'Shared.'));
    for (const root of [CLAUDE, COPILOT, PI, '.codex/skills']) assert.equal(await there(join(box.home, root, 'plain')), false, root);
    assert.ok((await readHistory(box.context())).find(event => event.id === tookOver.id)!.undoneBy);
  } finally { await box.cleanup(); }
});

test('Layout 2: a tool left unticked loses what it only read in the shared folder, and the result says so', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, SHARED, 'plain', text('plain', 'Shared.'));
    const result = await applyChanges(box.context(), [manage('plain', { off: ['pi-cli'] })]);
    assert.equal(await there(join(box.home, PI, 'plain')), false);
    assert.match(messages(result), /Pi isn’t ticked and read it only there, so it no longer has it/);
  } finally { await box.cleanup(); }
});

test('Layout 3: a link to a folder elsewhere is replaced by a real copy, and removing one removes only the link', { skip: noPosix }, async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    const elsewhere = await skill(box.base, 'dotfiles', 'far', text('far', 'Dotfiles.'));
    await link(box.home, COPILOT, 'far', elsewhere);
    await applyChanges(box.context(), [manage('far')]);
    assert.equal(await isFolder(join(box.home, COPILOT, 'far')), true);
    assert.equal(await readFile(join(elsewhere, 'SKILL.md'), 'utf8'), text('far', 'Dotfiles.'), 'what it led to is untouched');
    // Delete everywhere of an unmanaged link: the link goes, the folder it led to stays.
    await link(box.home, COPILOT, 'far2', elsewhere);
    const removed = await applyChanges(box.context(), [{ key: 'far2', managed: false, off: [], remove: ['copilot-cli'], everywhere: true, seenManaged: false }]);
    assert.ok(!removed.stopped, messages(removed));
    assert.equal(await there(join(box.home, COPILOT, 'far2')), false);
    assert.equal(await readFile(join(elsewhere, 'SKILL.md'), 'utf8'), text('far', 'Dotfiles.'));
  } finally { await box.cleanup(); }
});

test('Layout 3: a broken link where a copy goes is replaced, and the result says where it led', { skip: noPosix }, async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    await skill(box.home, CLAUDE, 'grill');
    await link(box.home, COPILOT, 'grill', `../../${SHARED}/grill`);
    const facts = (await factsOf(box, 'grill'))!;
    assert.equal(facts.cannot['copilot-cli'], undefined, 'a broken link is no reason it can’t have one');
    assert.equal(facts.brokenLink?.['copilot-cli'], `../../${SHARED}/grill`);
    const result = await applyChanges(box.context(), [manage('grill')]);
    assert.equal(await readFile(join(box.home, COPILOT, 'grill/SKILL.md'), 'utf8'), text('grill'));
    assert.match(messages(result), /replaced a broken link there \(it led to \.\.\/\.\.\/\.agents\/skills\/grill\)/);
  } finally { await box.cleanup(); }
});

test('Layout 4: a skills folder that is a link to the shared folder: the page says so, Manage leaves that copy, Delete everywhere removes it', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await skill(box.home, SHARED, 'gamma', text('gamma', 'Shared.'));
    await symlink(join(box.home, SHARED), join(box.home, COPILOT));
    const view = await manageView(box.context());
    assert.match(view.writes['copilot-cli']?.blocked ?? '', /is a link to .*\.agents\/skills/);
    const facts = view.skills.find(item => item.key === 'gamma')!;
    assert.match(facts.copies['pi-cli']!.outside?.pinned ?? '', /only one Copilot CLI can have/);
    const result = await applyChanges(box.context(), [manage('gamma')]);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('gamma', 'Shared.'), 'the only copy Copilot can have stays');
    assert.equal(await there(join(box.home, PI, 'gamma')), false, 'Pi keeps reading it there: no second copy beside it');
    assert.equal((await factsOf(box, 'gamma'))!.managed, true, messages(result));
    const gone = await deleteEverywhere(box.context(), 'gamma');
    assert.ok(!gone.stopped, messages(gone));
    assert.equal(await there(shared), false);
    assert.equal(await there(join(box.home, CLAUDE, 'gamma')), false);
    assert.equal(await isLink(join(box.home, COPILOT)), true, 'the linked skills folder itself stays');
  } finally { await box.cleanup(); }
});

test('Layout 5: a real copy in Copilot’s own folder and the same one in the shared folder: Manage removes the shared one', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, COPILOT, 'twin', text('twin', 'Same.'));
    const shared = await skill(box.home, SHARED, 'twin', text('twin', 'Same.'));
    await applyChanges(box.context(), [manage('twin')]);
    assert.equal(await there(shared), false);
    for (const root of [COPILOT, PI, CLAUDE]) assert.equal(await readFile(join(box.home, root, 'twin/SKILL.md'), 'utf8'), text('twin', 'Same.'), root);
  } finally { await box.cleanup(); }
});

test('Layout 5: a different copy in the shared folder needs a choice; choosing one takes the other over, kept in the store', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    await skill(box.home, COPILOT, 'two', text('two', 'Own.'));
    const shared = await skill(box.home, SHARED, 'two', text('two', 'Shared.'));
    const held = await applyChanges(box.context(), [manage('two')]);
    assert.match(messages(held), /Copies differ/);
    assert.equal(await there(shared), true);
    // Managed now, with copies that differ: the page shows the choice.
    const chosen = await applyChanges(box.context(), [manage('two', { seenManaged: true, use: 'copilot-cli', useHash: (await factsOf(box, 'two'))!.copies['copilot-cli']!.hash })]);
    assert.ok(!chosen.stopped, messages(chosen));
    assert.equal(await there(shared), false);
    assert.equal(await readFile(join(box.home, CLAUDE, 'two/SKILL.md'), 'utf8'), text('two', 'Own.'));
    const tookOver = (await readHistory(box.context())).find(event => event.kind === 'took-over')!;
    assert.ok(!(await restoreFromHistory(box.context(), tookOver.id)).stopped);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('two', 'Shared.'), 'the different shared copy comes back from the store');
  } finally { await box.cleanup(); }
});

test('Undo of a copy choice that took the skill over and added copies puts the shared copy back with the replaced copies', async () => {
  const box = await sandbox();
  try {
    const shared = await skill(box.home, SHARED, 'opus', text('opus', 'Shared.'));
    await skill(box.home, COPILOT, 'opus', text('opus', 'Copilot’s own.'));
    await skill(box.home, PI, 'opus', text('opus', 'Pi’s own.'));
    // Copilot CLI's copy for every tool: Pi's is replaced, Claude Code gets one, and the shared copy goes.
    const chose = await applyChanges(box.context(), [manage('opus', { use: 'copilot-cli', useHash: (await factsOf(box, 'opus'))!.copies['copilot-cli']!.hash })]);
    assert.ok(!chose.stopped, messages(chose));
    const history = await readHistory(box.context());
    const chosen = history.find(event => event.kind === 'chosen' && chose.made?.includes(event.id))!;
    assert.ok(history.some(event => event.kind === 'took-over' && event.tookOver?.addedId === chosen.addedId && chosen.addedId), 'the take-over came with the copies the choice added');
    assert.equal(await there(shared), false);
    const undone = await restoreFromHistory(box.context(), chosen.id, false, 'narrow');
    assert.ok(!undone.stopped, messages(undone));
    assert.deepEqual([await readFile(join(shared, 'SKILL.md'), 'utf8'), await readFile(join(box.home, PI, 'opus/SKILL.md'), 'utf8'), await there(join(box.home, CLAUDE, 'opus')), (await factsOf(box, 'opus'))!.managed],
      [text('opus', 'Shared.'), text('opus', 'Pi’s own.'), false, false]);
  } finally { await box.cleanup(); }
});

test('Background sync never changes a shared copy or a link; asking for it on the skill does', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'back', text('back', 'Managed.'));
    await applyChanges(box.context(), [manage('back')]);
    // The installer puts a shared copy and a link back.
    await rm(join(box.home, COPILOT, 'back'), { recursive: true });
    const shared = await skill(box.home, SHARED, 'back', text('back', 'Managed.'));
    await link(box.home, COPILOT, 'back', `../../${SHARED}/back`);
    await applyChanges(box.context(), []);
    await applyChanges(box.context(), []);
    assert.equal(await isLink(join(box.home, COPILOT, 'back')), true, 'a background pass leaves the link');
    assert.equal(await there(shared), true, 'and the shared copy');
    const facts = (await factsOf(box, 'back'))!;
    assert.equal(facts.managed, true);
    assert.ok(facts.copies['copilot-cli']!.outside, 'the page is told, to offer Replace with managed copies');
    // Replace with managed copies, as the page sends it.
    const result = await applyChanges(box.context(), [manage('back', { seenManaged: true })]);
    assert.ok(!result.stopped, messages(result));
    assert.equal(await isFolder(join(box.home, COPILOT, 'back')), true);
    assert.equal(await there(shared), false);
    const tookOver = (await readHistory(box.context())).find(event => event.kind === 'took-over')!;
    assert.ok(!tookOver.tookOver?.managedNow);
    assert.ok(!(await restoreFromHistory(box.context(), tookOver.id)).stopped);
    assert.equal(await isLink(join(box.home, COPILOT, 'back')), true, 'Undo puts the link back');
    assert.equal((await factsOf(box, 'back'))!.managed, true, 'and the skill stays managed');
  } finally { await box.cleanup(); }
});

test('Remove from one tool: its link goes, and a shared copy other tools read is never removed for one of them', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await installerLayout(box);
    const result = await applyChanges(box.context(), [{ key: 'opus', managed: false, off: [], remove: ['copilot-cli'], seenManaged: false }]);
    assert.equal(await there(join(box.home, COPILOT, 'opus')), false);
    assert.equal(await there(shared), true);
    assert.match(messages(result), /Copilot CLI still reads the copy in .*\.agents\/skills/);
    // Pi's own copy is the link; with it gone, Pi reads the shared copy, which Copilot reads too.
    await rm(join(box.home, PI, 'opus'));
    const refused = await applyChanges(box.context(), [{ key: 'opus', managed: false, off: [], remove: ['pi-cli'], seenManaged: false }]);
    assert.match(messages(refused), /which Copilot CLI reads too\. Disable it in Pi, or use Delete everywhere/);
    assert.equal(await there(shared), true);
  } finally { await box.cleanup(); }
});

test('Layout 4, unmanaged: Delete everywhere removes the shared copy, and the result names every tool that had it', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await skill(box.home, SHARED, 'gamma', text('gamma', 'Shared.'));
    await symlink(join(box.home, SHARED), join(box.home, COPILOT));
    const facts = (await factsOf(box, 'gamma'))!;
    assert.equal(facts.copies['pi-cli']!.outside?.pinnedBy, 'copilot-cli', 'the page is told whose skills folder it is');
    // As the page sends it: the tools whose copy Delete everywhere can remove (Pi's is the shared copy; Copilot CLI's is through its linked folder).
    const result = await applyChanges(box.context(), [{ key: 'gamma', managed: false, off: [], remove: ['pi-cli'], everywhere: true, seenManaged: false }]);
    assert.ok(!result.stopped, messages(result));
    assert.doesNotMatch(messages(result), /use Delete everywhere/);
    assert.equal(await there(shared), false);
    assert.deepEqual(result.results.filter(entry => entry.outcome === 'removed' && entry.harness).map(entry => entry.harness).sort(), ['copilot-cli', 'pi-cli']);
    assert.equal(await isLink(join(box.home, COPILOT)), true, 'the linked skills folder itself stays');
    const removed = (await readHistory(box.context())).find(event => event.kind === 'removed')!;
    assert.ok(!(await restoreFromHistory(box.context(), removed.id)).stopped);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('gamma', 'Shared.'));
  } finally { await box.cleanup(); }
});

test('Layout 4, managed: Claude Code gets its own copy; an edit made there never reaches the shared copy Copilot CLI and Pi read', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await skill(box.home, SHARED, 'gamma', text('gamma', 'Shared.'));
    await symlink(join(box.home, SHARED), join(box.home, COPILOT));
    await applyChanges(box.context(), [manage('gamma')]);
    assert.equal(await readFile(join(box.home, CLAUDE, 'gamma/SKILL.md'), 'utf8'), text('gamma', 'Shared.'));
    await writeFile(join(box.home, CLAUDE, 'gamma/SKILL.md'), text('gamma', 'Edited in Claude Code.'));
    const pass = await applyChanges(box.context(), []);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('gamma', 'Shared.'), 'the shared copy is never written');
    assert.ok(pass.results.some(entry => entry.harness === 'pi-cli' && entry.outcome === 'held'), messages(pass));
  } finally { await box.cleanup(); }
});

test('Came back: Automatic sync never changes the link or the shared copy, so an edit reaches neither, nor Copilot CLI; the page is told they are back', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await installerLayout(box, 'back');
    await applyChanges(box.context(), [manage('back')]);
    assert.equal((await factsOf(box, 'back'))!.outsideBack, undefined, 'nothing is back yet');
    // The installer puts them back.
    await rm(join(box.home, COPILOT, 'back'), { recursive: true });
    await rm(join(box.home, PI, 'back'), { recursive: true });
    await skill(box.home, SHARED, 'back', text('back', 'Shared.'));
    await link(box.home, COPILOT, 'back', `../../${SHARED}/back`);
    await applyChanges(box.context(), []);
    assert.equal((await factsOf(box, 'back'))!.outsideBack, true);
    await writeFile(join(box.home, CLAUDE, 'back/SKILL.md'), text('back', 'Edited in Claude Code.'));
    await applyChanges(box.context(), []);
    assert.equal(await readFile(join(box.home, SHARED, 'back/SKILL.md'), 'utf8'), text('back', 'Shared.'), 'the shared copy, which Copilot CLI’s link leads to, is unchanged');
    assert.equal(await isLink(join(box.home, COPILOT, 'back')), true);
  } finally { await box.cleanup(); }
});

/** Came back: managed and taken over, then the installer put the shared copy and Copilot CLI's link back (Pi reads the shared copy). */
async function cameBack(box: Box, name = 'back') {
  await installerLayout(box, name);
  await applyChanges(box.context(), [manage(name)]);
  await rm(join(box.home, COPILOT, name), { recursive: true });
  await rm(join(box.home, PI, name), { recursive: true });
  await skill(box.home, SHARED, name, text(name, 'Shared.'));
  await link(box.home, COPILOT, name, `../../${SHARED}/${name}`);
  await applyChanges(box.context(), []);
  assert.equal((await factsOf(box, name))!.outsideBack, true);
}

test('Came back: Remove on the tool whose copy is a link, sent with a take-over anyway, removes only that tool; the next passes spread nothing, and Restore puts the link back', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await cameBack(box);
    const result = await applyChanges(box.context(), [manage('back', { seenManaged: true, remove: ['copilot-cli'] })]);
    assert.ok(!result.stopped, messages(result));
    await applyChanges(box.context(), []);
    await applyChanges(box.context(), []);
    assert.equal(await there(join(box.home, COPILOT, 'back')), false, 'Copilot CLI has no copy, and got none back');
    for (const root of [CLAUDE, PI]) assert.equal(await isFolder(join(box.home, root, 'back')), true, `${root} keeps its copy`);
    const { record } = await readRecord(box.home);
    assert.equal(record!.items.back.state, 'shared');
    assert.ok(record!.items.back.off?.includes('copilot-cli'), 'Copilot CLI is off');
    assert.equal((await readHistory(box.context())).some(event => event.kind === 'deleted'), false, 'no deletion spread');
    const removed = (await readHistory(box.context())).find(event => event.kind === 'removed')!;
    assert.ok(removed, 'the Remove is in History');
    assert.deepEqual(removed.losers.map(loser => [loser.tool, loser.linkTo]), [['copilot-cli', `../../${SHARED}/back`]]);
    const back = await restoreFromHistory(box.context(), removed.id);
    assert.ok(!back.stopped, messages(back));
    assert.equal(await readlink(join(box.home, COPILOT, 'back')), `../../${SHARED}/back`, 'Restore puts the link back');
    await applyChanges(box.context(), []);
    for (const root of [CLAUDE, PI]) assert.equal(await isFolder(join(box.home, root, 'back')), true, `${root} still has it after Restore`);
  } finally { await box.cleanup(); }
});

test('Fresh Manage with Remove queued on the tool whose copy is a link: that tool gets no copy on the next passes', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await installerLayout(box);
    const result = await applyChanges(box.context(), [manage('opus', { remove: ['copilot-cli'] })]);
    assert.ok(!result.stopped, messages(result));
    await applyChanges(box.context(), []);
    await applyChanges(box.context(), []);
    assert.equal(await there(join(box.home, COPILOT, 'opus')), false, 'Copilot CLI got no copy');
    for (const root of [CLAUDE, PI]) assert.equal(await isFolder(join(box.home, root, 'opus')), true, root);
    const { record } = await readRecord(box.home);
    assert.ok(record!.items.opus.off?.includes('copilot-cli'));
    const history = await readHistory(box.context());
    assert.ok(history.some(event => event.kind === 'removed' && event.losers.some(loser => loser.tool === 'copilot-cli' && loser.linkTo !== undefined)));
    assert.equal(history.find(event => event.kind === 'took-over')!.tookOver!.links.some(link => link.tool === 'copilot-cli'), false, 'the take-over’s Undo does not bring back a link that was asked to go');
  } finally { await box.cleanup(); }
});

test('Undo of a Manage that took the skill over, after one of the copies Manage added was edited: nothing is written, and it says why', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await installerLayout(box);
    await applyChanges(box.context(), [manage('opus')]);
    await writeFile(join(box.home, CLAUDE, 'opus/SKILL.md'), text('opus', 'Edited in Claude Code.'));
    const tookOver = (await readHistory(box.context())).find(event => event.kind === 'took-over')!;
    const undo = await restoreFromHistory(box.context(), tookOver.id);
    assert.match(undo.stopped ?? '', /Claude Code’s new copy of opus was edited since, so nothing was undone/, messages(undo));
    assert.equal(await isFolder(join(box.home, COPILOT, 'opus')), true, 'the real copy stays');
    assert.equal(await there(shared), false, 'the shared copy is not put back');
    assert.equal((await factsOf(box, 'opus'))!.managed, true);
    assert.equal((await readHistory(box.context())).find(event => event.id === tookOver.id)!.undoneBy, undefined);
  } finally { await box.cleanup(); }
});

test('Layout 4, managed: Restore after Delete everywhere puts the shared copy back for the tool whose skills folder is that folder', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await skill(box.home, SHARED, 'gamma', text('gamma', 'Shared.'));
    await symlink(join(box.home, SHARED), join(box.home, COPILOT));
    await applyChanges(box.context(), [manage('gamma')]);
    assert.ok(!(await deleteEverywhere(box.context(), 'gamma')).stopped);
    assert.equal(await there(shared), false);
    const deleted = (await readHistory(box.context())).find(event => event.kind === 'deleted')!;
    const back = await restoreFromHistory(box.context(), deleted.id);
    assert.ok(!back.stopped, messages(back));
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('gamma', 'Shared.'), 'the only copy Copilot CLI can have is back');
    assert.equal(await readFile(join(box.home, CLAUDE, 'gamma/SKILL.md'), 'utf8'), text('gamma', 'Shared.'));
    assert.equal(await there(join(box.home, PI, 'gamma')), false, 'Pi reads the shared copy again: no second copy beside it');
    assert.doesNotMatch(messages(back), /does not write through it/);
    assert.equal((await factsOf(box, 'gamma'))!.managed, true);
  } finally { await box.cleanup(); }
});

test('Restore of a removal is finished only when every copy is back: a link back, with something else where the shared copy goes, is not', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await installerLayout(box);
    await applyChanges(box.context(), [{ key: 'opus', managed: false, off: [], remove: ['copilot-cli', 'pi-cli'], everywhere: true, seenManaged: false }]);
    await skill(box.home, SHARED, 'opus', text('opus', 'Something else.'));
    const removed = (await readHistory(box.context())).find(event => event.kind === 'removed')!;
    const back = await restoreFromHistory(box.context(), removed.id);
    assert.equal(await readlink(join(box.home, COPILOT, 'opus')), `../../${SHARED}/opus`);
    assert.match(messages(back), /Something else is at .*\.agents\/skills\/opus now/);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('opus', 'Something else.'));
    assert.equal((await readHistory(box.context())).find(event => event.id === removed.id)!.undoneBy, undefined, 'still offered for Restore');
  } finally { await box.cleanup(); }
});

test('Fresh Manage with Remove queued on the only tool that reads the shared copy: that tool gets no copy on the next passes, and Restore gives it back', { skip: noPosix }, async () => {
  const box = await sandbox(['claude-cli', 'pi-cli']);
  try {
    await skill(box.home, CLAUDE, 'solo', text('solo', 'Shared.'));
    await skill(box.home, SHARED, 'solo', text('solo', 'Shared.'));
    assert.equal((await factsOf(box, 'solo'))!.copies['pi-cli']!.outside?.kind, 'shared', 'Pi reads it only in the shared folder');
    const result = await applyChanges(box.context(), [manage('solo', { remove: ['pi-cli'] })]);
    assert.ok(!result.stopped, messages(result));
    assert.ok(result.results.some(entry => entry.harness === 'pi-cli' && entry.outcome === 'removed' && /^Removed from Pi/.test(entry.message)), messages(result));
    await applyChanges(box.context(), []);
    await applyChanges(box.context(), []);
    assert.equal(await there(join(box.home, PI, 'solo')), false, 'Pi got no copy');
    assert.equal(await there(join(box.home, SHARED, 'solo')), false, 'the shared copy is gone');
    assert.equal(await isFolder(join(box.home, CLAUDE, 'solo')), true);
    const { record } = await readRecord(box.home);
    assert.equal(record!.items.solo.state, 'shared');
    assert.ok(record!.items.solo.off?.includes('pi-cli'), 'Pi is off');
    const removed = (await readHistory(box.context())).find(event => event.kind === 'removed')!;
    assert.ok(removed, 'the Remove is in History');
    assert.deepEqual(removed.losers.map(loser => loser.tool), ['pi-cli']);
    const back = await restoreFromHistory(box.context(), removed.id);
    assert.ok(!back.stopped, messages(back));
    await applyChanges(box.context(), []);
    assert.equal(await readFile(join(box.home, PI, 'solo/SKILL.md'), 'utf8'), text('solo', 'Shared.'), 'Restore gives Pi the skill back');
    assert.equal((await readRecord(box.home)).record!.items.solo.off?.includes('pi-cli') ?? false, false, 'Pi syncs again');
  } finally { await box.cleanup(); }
});

test('Undo of a Manage that took the skill over, after the skill was unmanaged: what it did is said and recorded', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await installerLayout(box);
    await applyChanges(box.context(), [manage('opus')]);
    await applyChanges(box.context(), [{ key: 'opus', managed: false, off: [], seenManaged: true }]);
    const tookOver = (await readHistory(box.context())).find(event => event.kind === 'took-over')!;
    const undo = await restoreFromHistory(box.context(), tookOver.id);
    assert.ok(!undo.stopped, messages(undo));
    assert.equal(await readlink(join(box.home, COPILOT, 'opus')), `../../${SHARED}/opus`, 'the link is back');
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('opus', 'Shared.'), 'the shared copy is back');
    assert.ok(undo.results.some(entry => entry.tookOver === 'shared' && entry.outcome === 'written'), messages(undo));
    assert.notEqual((await readHistory(box.context())).find(event => event.id === tookOver.id)!.undoneBy, undefined, 'History has it undone');
  } finally { await box.cleanup(); }
});

test('Layout 4: Restore after Delete everywhere, with a different same-name skill made since, writes nothing', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const shared = await skill(box.home, SHARED, 'gamma', text('gamma', 'Shared.'));
    await symlink(join(box.home, SHARED), join(box.home, COPILOT));
    await applyChanges(box.context(), [manage('gamma')]);
    assert.ok(!(await deleteEverywhere(box.context(), 'gamma')).stopped);
    await skill(box.home, CLAUDE, 'gamma', text('gamma', 'A different one.'));
    const deleted = (await readHistory(box.context())).find(event => event.kind === 'deleted')!;
    const back = await restoreFromHistory(box.context(), deleted.id);
    assert.match(back.stopped ?? '', /A different “gamma” is in Claude Code now/, messages(back));
    assert.equal(await there(shared), false, 'the shared copy is not put back');
  } finally { await box.cleanup(); }
});

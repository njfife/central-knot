// The Skills page's words for a skill's link and shared copy (outsidewords.ts), layout by layout: one spelling of each thing,
// no raw link text, and only what is true as built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backText, deleteNote, deletedText, linkTarget, managedSentence, manageSentence, notPutBack, pendingSentence, pinnedSentence, replacedText, replaceSentence, syncedSome, tookOverDone, undoneText, whereSentence, type Shape } from '../src/outsidewords.ts';

const folder = '~/.agents/skills';
/** The reported layout: the real folder in the shared folder, a link from Copilot CLI's folder, Pi reading the shared folder. */
const installer: Shape = { shared: { folder, readers: ['Pi'], linkers: ['Copilot CLI'], besides: [] }, elsewhere: [], ownCopies: false };
const all = { links: ['Copilot CLI'], gets: ['Pi'], loses: [], everyTool: true };

test('Unmanaged, as the installer keeps it: where it is, then what Manage and Delete everywhere do', () => {
  assert.equal(`${whereSentence(installer)} ${manageSentence(installer, all)}`,
    'This skill is in ~/.agents/skills, a shared folder other apps read too. Pi reads it there, and Copilot CLI has a link to it. Manage gives each tool its own copy and removes the link and the shared copy. Delete everywhere removes them too. History keeps both.');
});

test('Managed switched on, before Apply all: the link becomes a real copy, Pi gets its own, the shared copy goes', () => {
  assert.equal(pendingSentence(installer, all),
    'On Apply all, Central Knot replaces Copilot CLI’s link with a real copy, gives Pi its own copy and removes the shared copy (History keeps it). Other apps that read ~/.agents/skills won’t find it there.');
  // A tool left unticked that reads it only there is told it loses it.
  assert.match(pendingSentence(installer, { links: ['Copilot CLI'], gets: [], loses: ['Pi'], everyTool: false }), /Pi isn’t ticked and reads it only there, so it won’t have it any more\.$/);
});

test('Only in the shared folder, no link', () => {
  const shape: Shape = { shared: { folder, readers: ['Copilot CLI', 'Pi'], linkers: [], besides: [] }, elsewhere: [], ownCopies: false };
  assert.equal(`${whereSentence(shape)} ${manageSentence(shape, { links: [], gets: ['Copilot CLI', 'Pi'], loses: [], everyTool: true })}`,
    'This skill is in ~/.agents/skills, a shared folder other apps read too. Copilot CLI and Pi read it there. Manage gives each tool its own copy and removes the shared copy. Delete everywhere removes it too. History keeps it.');
});

test('A link that leads somewhere other than the shared folder: said by where it leads, and what it leads to stays', () => {
  const shape: Shape = { elsewhere: [{ tool: 'Copilot CLI', target: '~/dotfiles/far' }], ownCopies: true };
  assert.equal(whereSentence(shape), 'Copilot CLI has a link to ~/dotfiles/far, outside its skills folder.');
  assert.equal(manageSentence(shape, { links: ['Copilot CLI'], gets: [], loses: [], everyTool: true }), 'Manage gives each tool its own copy and removes the link; what it leads to stays. Delete everywhere removes it too. History keeps it.');
  assert.equal(pendingSentence(shape, { links: ['Copilot CLI'], gets: [], loses: [], everyTool: true }), 'On Apply all, Central Knot replaces Copilot CLI’s link with a real copy. What it leads to stays. History keeps the link.');
  assert.equal(deleteNote(shape, []), 'This also removes the link in Copilot CLI’s skills folder (not what it leads to).');
});

test('A real copy of its own beside the shared copy', () => {
  const shape: Shape = { shared: { folder, readers: ['Pi'], linkers: [], besides: ['Copilot CLI'] }, elsewhere: [], ownCopies: true };
  assert.equal(whereSentence(shape), 'A copy of this skill is in ~/.agents/skills, a shared folder other apps read too. Pi reads it there, and Copilot CLI also reads it there besides its own copy.');
});

test('The armed Delete says "not what it leads to" only when the link’s target stays', () => {
  assert.equal(deleteNote(installer, ['Copilot CLI']), 'This also removes the link in Copilot CLI’s skills folder and the shared copy in ~/.agents/skills, which other apps may read too.');
});

test('Back since it was managed: says so, and what leaving them means, as built', () => {
  const back: Shape = { shared: { folder, readers: [], linkers: ['Copilot CLI'], besides: ['Pi'] }, elsewhere: [], ownCopies: true };
  assert.equal(whereSentence(back), 'A copy of this skill is in ~/.agents/skills, a shared folder other apps read too. Copilot CLI has a link to it, and Pi also reads it there besides its own copy.');
  assert.equal(managedSentence(back, true, ['Copilot CLI']), 'The link and the shared copy came back after you managed this skill; an installer may have put them there. Automatic sync never changes them, so edits won’t reach them, or Copilot CLI, which has no other copy.');
  // Never taken over (managed by an older build): not called "back".
  assert.equal(managedSentence(back, false, []), 'Central Knot doesn’t manage the link and the shared copy. Automatic sync never changes them, so edits won’t reach them.');
  assert.equal(replaceSentence(back, { links: ['Copilot CLI'], gets: [], loses: [], everyTool: true }), 'This replaces Copilot CLI’s link with a real copy and removes the shared copy. History keeps both. Other apps that read ~/.agents/skills won’t find it there.');
});

test('A skills folder that is a link to the shared folder: what Manage does, and that edits made elsewhere won’t reach it', () => {
  const shared = { folder, readers: ['Pi'], linkers: [], besides: [], pinnedBy: 'Copilot CLI' };
  assert.equal(whereSentence({ shared, elsewhere: [], ownCopies: false }), 'Copilot CLI’s skills folder is a link to ~/.agents/skills, a shared folder other apps read too, so the shared copy is the only one Copilot CLI can have. Pi reads it there too.');
  assert.equal(pinnedSentence(shared, false, ['Claude Code'], ['Copilot CLI', 'Pi'], ['Claude Code']),
    'Manage gives Claude Code its own copy and leaves the shared copy for Copilot CLI and Pi. Central Knot does not write into it, so edits made in Claude Code won’t reach Copilot CLI and Pi. Edits made in the shared copy will still reach Claude Code. Delete everywhere removes the shared copy too. History keeps it.');
  assert.equal(pinnedSentence(shared, true, ['Claude Code'], ['Copilot CLI', 'Pi']), 'Central Knot does not write into the shared copy, so edits made in Claude Code don’t reach Copilot CLI and Pi. Edits made in the shared copy still reach Claude Code.');
});

test('The Delete everywhere result names the skill, the tools and the shared folder, with one History', () => {
  assert.equal(deletedText('opus-sol-loop', ['Copilot CLI', 'Pi'], [folder]), 'Deleted opus-sol-loop from Copilot CLI and Pi, and from ~/.agents/skills. History keeps it.');
  assert.equal(deletedText('opus-sol-loop', ['Claude Code', 'Copilot CLI', 'Pi'], []), 'Deleted opus-sol-loop from Claude Code, Copilot CLI and Pi. History keeps it.');
});

test('A link’s target is resolved against its own folder, never shown as its raw text', () => {
  assert.equal(linkTarget('/Users/n/.copilot/skills/opus', '../../.agents/skills/opus'), '/Users/n/.agents/skills/opus');
  assert.equal(linkTarget('/Users/n/.pi/agent/skills/opus', '/Users/n/.agents/skills/opus'), '/Users/n/.agents/skills/opus');
});

test('Synced is said only for the tools Central Knot writes; the others are named with what they read', () => {
  assert.equal(syncedSome('Claude Code', ['Copilot CLI', 'Pi'], 'shared'), 'Synced in Claude Code · Copilot CLI and Pi read the shared copy, which Central Knot doesn’t write');
  assert.equal(syncedSome('Claude Code and Pi', ['Copilot CLI'], 'link'), 'Synced in Claude Code and Pi · Copilot CLI reads it through a link, which Central Knot doesn’t write');
});

test('A take-over’s result names the tools for one skill and counts them across several', () => {
  const one = tookOverDone([{ tool: 'Copilot CLI', item: 'opus' }], [{ folder, item: 'opus' }]);
  assert.deepEqual(one, ['replaced Copilot CLI’s link with a real copy', 'removed the shared copy in ~/.agents/skills']);
  assert.equal(replacedText('opus', one, 2), 'opus: replaced Copilot CLI’s link with a real copy and removed the shared copy in ~/.agents/skills. History keeps both.');
  assert.deepEqual(tookOverDone([{ tool: 'Copilot CLI', item: 'a' }, { tool: 'Copilot CLI', item: 'b' }], [{ folder, item: 'a' }, { folder, item: 'b' }]),
    ['replaced 2 links with real copies', 'removed 2 shared copies from ~/.agents/skills']);
});

test('Undo of a take-over leads with whether the skill is unmanaged again, then what is back', () => {
  const back = backText([{ tool: 'Copilot CLI', item: 'opus-sol-loop' }], [{ item: 'opus-sol-loop' }]);
  assert.equal(undoneText('opus-sol-loop', back, ['Claude Code', 'Pi'], true), 'Undone: opus-sol-loop is unmanaged again. Copilot CLI’s link and the shared copy are back. Removed the new copies in Claude Code and Pi.');
  assert.equal(undoneText('opus-sol-loop', back, [], false), 'Undone. Copilot CLI’s link and the shared copy are back.');
  assert.equal(backText([{ tool: 'Copilot CLI', item: 'a' }, { tool: 'Copilot CLI', item: 'b' }], [{ item: 'a' }, { item: 'b' }]), '2 links and 2 shared copies are back.');
});

test('Restore after deleting a managed skill says what it doesn’t put back', () => {
  assert.equal(notPutBack(2, 1), 'Each tool has its own copy now; the links and the shared copy aren’t put back.');
  assert.equal(notPutBack(0, 1), 'Each tool has its own copy now; the shared copy isn’t put back.');
});

// A link as the person pastes it (src/sourcelink.ts): what repository it names, the part after /tree/ left to split by the
// repository's own branches and tags, and how a page names it. No network: the repository's names are given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkLabel, readLink, splitRef } from '../src/sourcelink.ts';

test('The owner’s example and the other forms a link takes: owner/repo, a repository’s address, a branch or folder on GitHub or GitLab, ssh', () => {
  assert.deepEqual(readLink('https://github.com/stephenturner/skill-deslop/tree/main'), { repository: 'https://github.com/stephenturner/skill-deslop.git', rest: ['main'] });
  assert.deepEqual(readLink('  stephenturner/skill-deslop '), { repository: 'https://github.com/stephenturner/skill-deslop.git' });
  assert.deepEqual(readLink('https://github.com/team/kit.git'), { repository: 'https://github.com/team/kit.git' });
  assert.deepEqual(readLink('https://github.com/team/kit/tree/feature/x/skills/my%20notes/'), { repository: 'https://github.com/team/kit.git', rest: ['feature', 'x', 'skills', 'my notes'] });
  assert.deepEqual(readLink('https://gitlab.example.com/team/tools/skills/-/tree/main/review'), { repository: 'https://gitlab.example.com/team/tools/skills.git', rest: ['main', 'review'] });
  assert.deepEqual(readLink('git@gitlab.example.com:team/skills.git'), { repository: 'git@gitlab.example.com:team/skills.git' });
  assert.deepEqual(readLink('ssh://git@host:2222/team/skills.git'), { repository: 'ssh://git@host:2222/team/skills.git' });
});

test('What is no link is refused in plain words: empty, an option, a page of a repository that is no folder, anything else', () => {
  assert.deepEqual(readLink(''), { refused: 'Paste a link first.' });
  for (const text of ['--upload-pack=x', 'just words', 'ftp://example.com/x', 'https://github.com/team', 'https://github.com/team/kit/tree']) assert.ok('refused' in readLink(text), text);
  assert.match((readLink('https://github.com/team/kit/issues/4') as { refused: string }).refused, /page of the repository/);
  assert.match((readLink('https://gitlab.example.com/team/kit/-/issues/4') as { refused: string }).refused, /page of the repository/);
});

test('A branch with a slash is found by looking: the longest name the repository has that the link starts with, whole parts only', () => {
  const refs = ['main', 'feature', 'feature/x', 'v1.0'];
  assert.deepEqual(splitRef(['feature', 'x', 'skills', 'notes'], refs), { ref: 'feature/x', folder: 'skills/notes' });
  assert.deepEqual(splitRef(['feature', 'xy'], refs), { ref: 'feature', folder: 'xy' });
  assert.deepEqual(splitRef(['main'], refs), { ref: 'main', folder: '' });
  assert.deepEqual(splitRef(['v1.0', 'notes'], refs), { ref: 'v1.0', folder: 'notes' });
  assert.equal(splitRef(['nope', 'notes'], refs), undefined);
  assert.equal(splitRef(['mai'], refs), undefined, 'part of a name is no name');
});

test('A page names a link short: host and repository, then what it named after /tree/, as given', () => {
  assert.equal(linkLabel('https://github.com/stephenturner/skill-deslop/tree/main'), 'github.com/stephenturner/skill-deslop (main)');
  assert.equal(linkLabel('stephenturner/skill-deslop'), 'github.com/stephenturner/skill-deslop');
  assert.equal(linkLabel('https://gitlab.example.com/team/tools/skills/-/tree/main/review'), 'gitlab.example.com/team/tools/skills (main/review)');
  assert.equal(linkLabel('git@gitlab.example.com:team/skills.git'), 'gitlab.example.com/team/skills');
});

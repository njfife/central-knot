// Word search (src/search.ts) as worked examples. First the query set, the measure the weights were tuned on and then frozen:
// a made-up Library (tests/searchfixture.ts) and thirty-one things a person might type, each with the row that must be among
// the first three. Then what finds nothing, how text becomes words, the excerpt, and the one index main keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildIndex, searchFollower, words, type Published, type SearchDoc } from '../src/search.ts';
import { library } from './searchfixture.ts';

/** What a person types, and the rows that must be among the first three (`first`: the very first). */
const querySet: { typed: string; wants: string[]; first?: true; why: string }[] = [
  { typed: 'terraform-plan', wants: ['skills-terraform-plan'], first: true, why: 'an exact name' },
  { typed: 'pr-revi', wants: ['skills-pr-review'], why: 'half a name, still being typed' },
  { typed: 'lightho', wants: ['skills-web-performance'], why: 'a word still being typed, that no known word is near' },
  { typed: 'kubernets rollout', wants: ['skills-kubernetes-rollout'], why: 'one letter wrong, which Porter stems away' },
  { typed: 'dcoker compose', wants: ['skills-docker-compose'], why: 'two letters swapped: corrected to a name’s word' },
  { typed: 'postgress migration', wants: ['skills-postgres-migrations'], why: 'one letter too many: corrected to a name’s word' },
  { typed: 'sever logs', wants: ['skills-log-search'], why: 'a real word mistyped into another real word' },
  { typed: 'rows duplicate', wants: ['skills-spreadsheet-cleanup'], why: 'two words of a description, in the other order' },
  { typed: 'lighthouse', wants: ['skills-web-performance'], why: 'a word only the text has' },
  { typed: 'blockers yesterday', wants: ['skills-standup'], why: 'an item kept Off, found by its text' },
  { typed: 'code reviewer', wants: ['skills-code-reviewer', 'agents-code-reviewer'], why: 'a skill and an agent of one name, both' },
  { typed: 'postgres-mcp', wants: ['mcp-postgres'], why: 'an MCP server by its command' },
  { typed: 'mcp.linear.example', wants: ['mcp-linear'], why: 'an MCP server by its address' },
  { typed: '"pr-review', wants: ['skills-pr-review'], first: true, why: 'a quote and a hyphen, typed' },
  { typed: 'useEffect', wants: ['skills-react-hooks'], why: 'camelCase, in the text' },
  { typed: 'k8s pod', wants: ['skills-k8s-debug'], why: 'digits stay with their letters' },
  { typed: 'fill form', wants: ['skills-pdf-forms'], why: 'a word of a file’s name in the skill' },
  { typed: 'changelog', wants: ['skills-acme-devkit@acme-tools/changelog-writer'], why: 'a plugin’s skill named unlike its plugin' },
  { typed: 'acme-devkit', wants: ['skills-acme-devkit@acme-tools/changelog-writer', 'skills-acme-devkit@acme-tools/api-mocker'], why: 'a plugin’s skills by the plugin’s name' },
  { typed: 'C++', wants: ['skills-c++'], first: true, why: 'a name the words can’t do justice to (C# is the same word, c), typed whole' },
  { typed: 'reviewing pull requests', wants: ['skills-pr-review'], why: 'other forms of the same words' },
  { typed: 'deploy stag', wants: ['skills-deploy-staging'], why: 'the last word, a prefix' },
  { typed: 'résumé', wants: ['skills-resume-writer'], why: 'accents' },
  { typed: 'flaky test', wants: ['agents-debugger'], why: 'an agent by its description' },
  { typed: 'memory leak', wants: ['agents-performance-profiler'], why: 'an agent by its description, a word in another form' },
  { typed: 'pgvector', wants: ['skills-vector-search'], why: 'a word only the text has' },
  // A word in some rows' names and in many rows' text: the names first (search.ts WEIGHTS; with the text weighted most, 1:4:10, four of these five miss).
  { typed: 'tests', wants: ['skills-unit-tests-first', 'agents-test-writer'], why: 'a name’s word, in eight texts too' },
  { typed: 'search', wants: ['skills-log-search', 'skills-vector-search', 'mcp-docs-search'], why: 'a name’s word, in a description too' },
  { typed: 'release', wants: ['skills-release-notes', 'skills-mobile-release', 'agents-release-manager'], why: 'a name’s word, in texts too' },
  { typed: 'notes', wants: ['skills-release-notes', 'skills-meeting-notes'], why: 'a name’s word, in texts too' },
  { typed: 'api', wants: ['skills-api-design', 'agents-api-tester', 'skills-acme-devkit@acme-tools/api-mocker'], why: 'a name’s word, in texts too' },
];

test('the query set: each row a person means is among the first three, an exact name first', async () => {
  const index = (await buildIndex(library))!;
  try {
    const missed = querySet.filter(({ typed, wants, first }) => {
      const ids = index.ask(typed).map(hit => hit.id);
      return first ? ids[0] !== wants[0] : !wants.every(id => ids.slice(0, 3).includes(id));
    }).map(({ typed, why }) => `${typed} (${why}): ${index.ask(typed).slice(0, 3).map(hit => hit.id).join(', ')}`);
    assert.deepEqual(missed, [], `${querySet.length - missed.length} of ${querySet.length} found`);
  } finally { index.close(); }
});

test('nonsense, punctuation alone and FTS5’s own syntax find nothing and break nothing', async () => {
  const index = (await buildIndex(library))!;
  try {
    for (const typed of ['zxqvbnm', 'blorptang', 'qwfpgj', 'xylofrump', 'grizzlebat']) assert.deepEqual(index.ask(typed), [], typed);
    for (const typed of ['', '   ', '--- " :: *', '()', '"', '^']) assert.deepEqual(index.ask(typed), [], JSON.stringify(typed));
    // Words FTS5 reads as operators, and its column filter, are only words here.
    for (const typed of ['NOT', 'AND OR', 'NEAR(', 'names:', '{text}', 'pr* AND', "o'brien"]) assert.doesNotThrow(() => index.ask(typed), typed);
    assert.deepEqual([index.ask('NOT'), index.ask('names: release')], [index.ask('not'), index.ask('names release')]);
  } finally { index.close(); }
});

test('words: camelCase apart, cut at what is not a letter or a digit, digits kept with their letters, lower case', () => {
  assert.deepEqual(words('pr-review'), ['pr', 'review']);
  assert.deepEqual(words('mcp__server__tool'), ['mcp', 'server', 'tool']);
  assert.deepEqual(words('scripts/fill_form.py'), ['scripts', 'fill', 'form', 'py']);
  assert.deepEqual(words('https://mcp.linear.example/sse'), ['https', 'mcp', 'linear', 'example', 'sse']);
  assert.deepEqual(words('useEffect HTMLParser'), ['use', 'effect', 'html', 'parser']);
  assert.deepEqual(words('k8s v2 C++ 404'), ['k8s', 'v2', 'c', '404']);
  assert.deepEqual(words('Résumé'), ['résumé']);
});

test('a compound typed as one lower-case word finds its camelCase, and a decomposed accent in a file meets its composed query', async () => {
  const index = (await buildIndex([
    { id: 'skills-typescript-lint', names: ['TypeScript-lint'], description: 'Cleans up a module.', text: 'List the diagnostics before changing anything.' },
    { id: 'skills-schema-explainer', names: ['schema-explainer'], description: 'Explains a GraphQL schema.', text: 'Show which fields a client can select.' },
    { id: 'skills-balance-sheet', names: ['balance-sheet'], description: 'Prepares a monthly statement.', text: 'Write the result to caféReport.md.'.normalize('NFD') },
  ]))!;
  try {
    const found = (typed: string) => index.ask(typed).map(hit => hit.id);
    assert.deepEqual([found('typescript'), found('TypeScript'), found('graphql'), found('report'), found('café')],
      [['skills-typescript-lint'], ['skills-typescript-lint'], ['skills-schema-explainer'], ['skills-balance-sheet'], ['skills-balance-sheet']]);
    assert.deepEqual(index.ask('diagnostics'), [{ id: 'skills-typescript-lint', excerpt: 'List the diagnostics before changing anything.' }], 'an excerpt is the text as written');
  } finally { index.close(); }
  // A camelCase word in the text: found by its part, and the excerpt is still only the file's words.
  const checks = (await buildIndex([{ id: 'skills-lint-gate', names: ['lint-gate'], description: 'Guards a module.', text: 'Run checkTypes before changing anything.' }]))!;
  try {
    assert.deepEqual([checks.ask('changing'), checks.ask('types')], [[{ id: 'skills-lint-gate', excerpt: 'Run checkTypes before changing anything.' }], [{ id: 'skills-lint-gate', excerpt: 'Run checkTypes before changing anything.' }]]);
  } finally { checks.close(); }
});

test('a description’s mistyped word is corrected as a name’s is; one only a file’s text has is compared with its stem alone', async () => {
  const index = (await buildIndex([{ id: 'skills-promotion-log', names: ['promotion-log'], description: 'Records approvals.', text: 'File the deployment report.' }]))!;
  try {
    const found = (typed: string) => index.ask(typed).map(hit => hit.id);
    assert.deepEqual([found('aprovals'), found('deployment'), found('deploymnet')], [['skills-promotion-log'], ['skills-promotion-log'], []], 'deploymnet is three letters off the stem deploy');
  } finally { index.close(); }
});

test('typed text is bounded: punctuation alone asks nothing, not even a name; only the first eight words that find nothing look for nearest words', async () => {
  const index = (await buildIndex([{ id: 'skills-dashes', names: ['--'], description: '', text: '' }, { id: 'skills-deploy', names: ['deploy'], description: '', text: '' }]))!;
  try {
    assert.deepEqual([index.ask('--'), index.ask(Array(8).fill('deplyo').join(' ')).map(hit => hit.id), index.ask(Array(9).fill('deplyo').join(' '))], [[], ['skills-deploy'], []]);
  } finally { index.close(); }
});

test('a build that throws closes its database', async () => {
  const close = DatabaseSync.prototype.close;
  let closed = 0;
  DatabaseSync.prototype.close = function (this: DatabaseSync) { closed++; return close.call(this); };
  try {
    await assert.rejects(buildIndex(library, () => { throw new Error('Stopped for the test.'); }), /Stopped for the test/);
    assert.equal(closed, 1);
  } finally { DatabaseSync.prototype.close = close; }
});

test('a row that matched only in its text carries an excerpt around the match; one its name or description explains has none', async () => {
  const index = (await buildIndex(library))!;
  try {
    assert.deepEqual(index.ask('lighthouse'), [{ id: 'skills-web-performance', excerpt: 'Profile with Lighthouse and the network panel. Look for render-blocking scripts…' }]);
    assert.deepEqual(index.ask('terraform plan')[0], { id: 'skills-terraform-plan' });
  } finally { index.close(); }
});

test('an excerpt starts a few words before the match, so a row cut at its end still shows the word that matched', async () => {
  const index = (await buildIndex([{ id: 'skills-release-checklist', names: ['release-checklist'], description: 'Steps to take before a release.', text: 'Bump the version, tag it, and write the changelog.' }]))!;
  try {
    assert.deepEqual(index.ask('changelog'), [{ id: 'skills-release-checklist', excerpt: '…and write the changelog.' }]);
  } finally { index.close(); }
});

test('a match in a camelCase word quotes that word and the words around it, not an earlier passage where fewer words matched', async () => {
  // "notes" is also found in "note" (a prefix, stemmed), earlier: "release" is found in prepareReleaseNotes alone, which holds both.
  const text = 'Approve each package before it ships. Check the licence of every dependency and note who approved it. When all is done, run prepareReleaseNotes and attach the file.';
  const index = (await buildIndex([{ id: 'skills-ship-it', names: ['ship-it'], description: 'Gets a package out.', text }]))!;
  try {
    assert.deepEqual(index.ask('release notes'), [{ id: 'skills-ship-it', excerpt: '…is done, run prepareReleaseNotes and attach the file.' }]);
  } finally { index.close(); }
});

test('a broken word is corrected only within its allowance: one letter from four letters, two from eight, never a number', async () => {
  const docs: SearchDoc[] = [{ id: 'skills-deploy', names: ['deploy'], description: '', text: '' }, { id: 'skills-rollout', names: ['rollout'], description: '', text: 'version 2024' },
    { id: 'skills-twiml', names: ['twiml'], description: '', text: 'Its verbs.' }, { id: 'skills-logging', names: ['logging'], description: '', text: 'Verbose output.' }];
  const index = (await buildIndex(docs))!;
  try {
    const found = (typed: string) => index.ask(typed).map(hit => hit.id);
    assert.deepEqual([found('deplyo'), found('dpeloy'), found('rolout'), found('rlout')], [['skills-deploy'], ['skills-deploy'], ['skills-rollout'], []]);
    assert.deepEqual([found('2025'), found('2025 rollout')], [[], ['skills-rollout']], 'a number is never replaced (2025 is not 2024); with nothing for every word, any word');
    assert.deepEqual(found('vurb'), ['skills-twiml'], 'a stem, verb, asked whole where that finds it: not every word it begins (verbose)');
  } finally { index.close(); }
});

const doc = (id: string, text: string): SearchDoc => ({ id, names: [id], description: '', text });
/** A follower with what it published so far and how many indexes it built. */
function follower() {
  const told: Published[] = [], built: number[] = [];
  return { told, built, search: searchFollower(tag => told.push(tag), (docs, wanted) => { built.push(docs.length); return buildIndex(docs, wanted); }) };
}

test('the index follows the views: not ready before the first, tagged with each view, the same content tagged again, not rebuilt', async () => {
  const { told, built, search } = follower();
  assert.deepEqual(search.ask('notes'), { ready: false });
  await search.follow('/home', 1, async () => [doc('skills-notes', 'Takes notes.')]);
  assert.deepEqual(search.ask('notes'), { ready: true, home: '/home', readId: 1, rows: [{ id: 'skills-notes' }] });
  await search.follow('/home', 2, async () => [doc('skills-notes', 'Takes notes.')]);
  assert.deepEqual([built.length, search.ask('notes')], [1, { ready: true, home: '/home', readId: 2, rows: [{ id: 'skills-notes' }] }], 'the same content: tagged with read 2, not built again');
  await search.follow('/home', 3, async () => [doc('skills-notes', 'Takes minutes.')]);
  assert.deepEqual([built.length, told, search.ask('minutes')], [2, [{ home: '/home', readId: 1 }, { home: '/home', readId: 2 }, { home: '/home', readId: 3 }],
    { ready: true, home: '/home', readId: 3, rows: [{ id: 'skills-notes', excerpt: 'Takes minutes.' }] }]);
  search.close();
  assert.deepEqual(search.ask('minutes'), { ready: false });
});

test('a newer view supersedes a build still under way: it stops where it gives way, and only the newer is published', async () => {
  const { told, search } = follower();
  const many = Array.from({ length: 250 }, (_, at) => doc(`skills-old-${at}`, 'Old text.'));
  const first = search.follow('/home', 1, async () => many);
  // The first build has indexed a slice and given way (search.ts SLICE) when the newer view comes.
  await new Promise(resolve => setImmediate(resolve));
  await search.follow('/home', 2, async () => [doc('skills-notes', 'New text.')]);
  await first;
  assert.deepEqual([told, search.ask('text')], [[{ home: '/home', readId: 2 }], { ready: true, home: '/home', readId: 2, rows: [{ id: 'skills-notes', excerpt: 'New text.' }] }]);
  assert.equal(await buildIndex(many, () => false), undefined, 'a build no longer wanted gives no index');
  search.close();
});

test('a newer view supersedes one still gathering; another home closes the old index at once', async () => {
  const { told, search } = follower();
  await search.follow('/home', 1, async () => [doc('skills-notes', 'Takes notes.')]);
  // The older view's gather ends last, with the same content: the newer read keeps the tag.
  let release = () => {};
  const slow = search.follow('/home', 2, () => new Promise(done => { release = () => done([doc('skills-notes', 'New text.')]); }));
  await search.follow('/home', 3, async () => [doc('skills-notes', 'New text.')]);
  release();
  await slow;
  assert.deepEqual([told.map(tag => tag.readId), search.ask('text')], [[1, 3], { ready: true, home: '/home', readId: 3, rows: [{ id: 'skills-notes', excerpt: 'New text.' }] }]);
  let open = () => {};
  const other = search.follow('/practice', 4, () => new Promise(done => { open = () => done([doc('skills-other', 'Another home.')]); }));
  assert.deepEqual(search.ask('text'), { ready: false }, 'the first home’s index is gone as soon as another home is followed');
  open();
  await other;
  assert.deepEqual(search.ask('home'), { ready: true, home: '/practice', readId: 4, rows: [{ id: 'skills-other', excerpt: 'Another home.' }] });
  search.close();
});

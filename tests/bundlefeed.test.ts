import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { activeBundle, bundledMarketplace, feedAddress, openBundle, readRelease } from '../src/bundle.ts';
import { checkFeed, type FeedHost } from '../src/bundlefeed.ts';
import { describeBuild, packRelease, publishRelease } from '../src/bundlepack.ts';
import { parseCatalog } from '../src/plugins.ts';

const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const exists = (path: string) => stat(path).then(() => true, () => false);

/** A marketplace folder with these plugins, each one skill whose text names the version. */
async function market(root: string, plugins: Record<string, string>, more: unknown[] = []) {
  await rm(root, { recursive: true, force: true });
  await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team-tools', plugins: [...Object.entries(plugins).map(([name, version]) => ({ name, source: `./plugins/${name}`, version })), ...more] }));
  for (const [name, version] of Object.entries(plugins)) await put(join(root, `plugins/${name}/skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: ${name} ${version}\n---\n`);
}

/** An installed build (release 1 in use) and the folder its feed serves, with a stand-in for the network that reads that folder. */
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-feed-')));
  const source = join(base, 'source'), feed = join(base, 'feed'), data = join(base, 'data');
  await market(source, { docs: '1.0.0', release: '0.4.1' });
  // Days apart from what is published later, in any time zone: a release of the same day says its time too.
  await packRelease({ source, out: join(base, 'carried'), work: join(base, 'work'), sequence: 1, now: new Date('2026-11-08T12:00:00Z') });
  await openBundle(data, join(base, 'carried'));
  let turns = 0;
  const asked: string[] = [];
  const host: FeedHost = {
    feed: 'http://feed.test/team/', dataDir: data, appVersion: '0.5.0',
    fetch: async url => {
      asked.push(new URL(url).pathname);
      const bytes = await readFile(join(feed, new URL(url).pathname.replace('/team/', ''))).catch(() => undefined);
      return bytes ? new Response(bytes) : new Response('not found', { status: 404 });
    },
    keep: async () => [],
    turn: work => { turns++; return work(); },
  };
  const publish = (sequence: number, more: { minApp?: string } = {}) => publishRelease({ source, out: feed, work: join(base, 'work'), sequence, now: new Date('2026-11-11T12:00:00Z'), ...more });
  const skill = (plugin = 'docs', folder = `plugins/${plugin}`) => readFile(join(bundledMarketplace(data), folder, `skills/${plugin}/SKILL.md`), 'utf8');
  return { base, source, feed, data, host, asked, publish, skill, turns: () => turns, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('a feed’s address is a folder’s, over http or https; anything else is none', () => {
  assert.equal(feedAddress('https://example.com/acme'), 'https://example.com/acme/');
  assert.equal(feedAddress(' http://10.0.0.5:8080/feed/#x '), 'http://10.0.0.5:8080/feed/');
  for (const given of ['', 'acme/feed', 'file:///feed/', 'ftp://example.com/feed']) assert.equal(feedAddress(given), undefined, given);
  assert.equal(describeBuild({ marketplace: '/m', appName: 'Acme Knot', feed: 'https://example.com/acme' }).feed, 'https://example.com/acme/');
  assert.throws(() => describeBuild({ appName: 'Acme Knot', feed: 'https://example.com/acme' }), /--feed is where newer releases of a carried marketplace come from/);
  assert.throws(() => describeBuild({ marketplace: '/m', appName: 'Acme Knot', feed: 'acme/feed' }), /--feed takes an http or https address/);
});

test('a newer release published to the feed is taken; the same one again is not', async () => {
  const box = await setup();
  try {
    // Nothing is published yet: the plugins in use stay, and the reason is said.
    const nothing = await checkFeed(box.host);
    assert.deepEqual([nothing.outcome, nothing.message], ['failed', 'Couldn’t check for newer plugins: nothing is published at their address (the server answered 404). The ones here stay in use, and the app tries again by itself.']);
    await market(box.source, { docs: '1.1.0', release: '0.4.1' });
    const published = await box.publish(2);
    assert.ok('release' in published, JSON.stringify(published));
    assert.match(published.report, /^Published team-tools: November 11, 2026 \(Folder: source\), sequence 2\n/);
    // A download the app was quit in the middle of, some time ago, is cleared on the way.
    await writeFile(join(box.data, 'bundled/download-left-behind.tgz'), 'half');
    const taken = await checkFeed(box.host);
    assert.deepEqual([taken.outcome, taken.message, taken.active?.release.sequence], ['updated', 'Now has the plugins published on November 11, 2026.', 2]);
    assert.match(await box.skill(), /docs 1\.1\.0/);
    assert.equal(box.turns(), 1, 'the swap took its turn in the queue');
    // Read from the feed's own folder: the manifest, then the archive it names.
    assert.deepEqual(box.asked.slice(-2), ['/team/release.json', '/team/content-2.tgz']);
    assert.deepEqual((await readdir(join(box.data, 'bundled'))).sort(), ['marketplace', 'release.json'], 'the download is not left behind');
    const again = await checkFeed(box.host);
    assert.deepEqual([again.outcome, again.message], ['current', 'No newer plugins are published.']);
    assert.equal(box.turns(), 1);
    // A second release the same day says its time too, so it can be told from the one in use.
    await market(box.source, { docs: '1.2.0', release: '0.4.1' });
    assert.ok('release' in await box.publish(3));
    assert.match((await checkFeed(box.host)).message, /^Now has the plugins published on November 11, 2026(,| at) \d+:\d\d [AP]M\.$/);
  } finally { await box.cleanup(); }
});

test('a broken publish leaves the last good plugins in place and says why', async () => {
  const box = await setup();
  try {
    await market(box.source, { docs: '1.1.0', release: '0.4.1' });
    const published = await box.publish(2);
    assert.ok('release' in published);
    const stays = async (why: RegExp, detail?: RegExp) => {
      const check = await checkFeed(box.host);
      assert.equal(check.outcome, 'failed');
      assert.match(check.message, why);
      if (detail) assert.match(check.detail ?? '', detail);
      assert.equal((await activeBundle(box.data))?.release.sequence, 1);
      assert.match(await box.skill(), /docs 1\.0\.0/);
      assert.deepEqual((await readdir(join(box.data, 'bundled'))).sort(), ['marketplace', 'release.json']);
    };
    // The archive was cut short on the way up.
    await truncate(join(box.feed, published.release.archive), 200);
    await stays(/^Newer plugins \(November 11, 2026\) are published, but they didn’t arrive whole, so they weren’t used\. The ones here stay in use, and the app tries again by itself\.$/, /Its archive is not the one its manifest describes/);
    // While the feed still names that archive, it is not downloaded again: the same is said from memory.
    const requests = box.asked.length;
    await stays(/they didn’t arrive whole/, /Its archive is not the one its manifest describes/);
    assert.deepEqual(box.asked.slice(requests), ['/team/release.json']);
    // A new publish is tried afresh.
    await market(box.source, { docs: '1.2.0', release: '0.4.1' });
    const next = await box.publish(3);
    assert.ok('release' in next);
    Object.assign(published, next);
    // The archive is longer than the manifest says.
    await writeFile(join(box.feed, published.release.archive), Buffer.alloc(published.release.size + 10));
    await stays(/couldn’t be downloaded: its archive is longer than its manifest says\. The ones here stay in use, and the app tries again by itself\./);
    // The manifest went up but the archive didn't.
    await rm(join(box.feed, published.release.archive));
    await stays(/couldn’t be downloaded: nothing is published at their address \(the server answered 404\)\./, /the feed answered 404/);
    // The manifest isn't one.
    await writeFile(join(box.feed, 'release.json'), '<html>Sign in</html>');
    await stays(/what is published isn’t something this app can read\. The ones here stay in use, and the app tries again by itself\./);
    // The folder now holds another marketplace's releases.
    await writeFile(join(box.feed, 'release.json'), JSON.stringify({ ...published.release, marketplace: 'other-tools', sequence: 9 }));
    await stays(/another marketplace \(“other-tools”\)/);
  } finally { await box.cleanup(); }
});

test('a release that needs a newer app waits for it', async () => {
  const box = await setup();
  try {
    await market(box.source, { docs: '2.0.0', release: '0.4.1' });
    assert.ok('release' in await box.publish(2, { minApp: '0.6.0' }));
    const held = await checkFeed(box.host);
    assert.deepEqual([held.outcome, held.message], ['held', 'Newer plugins (November 11, 2026) are published, but they need this app at 0.6.0 or newer. They arrive once the app is updated.']);
    assert.match(await box.skill(), /docs 1\.0\.0/);
    assert.equal((await checkFeed({ ...box.host, appVersion: '0.6.0' })).outcome, 'updated');
    assert.match(await box.skill(), /docs 2\.0\.0/);
  } finally { await box.cleanup(); }
});

test('a plugin a release no longer offers stays, with its entry, while a tool here has it installed', async () => {
  const box = await setup();
  try {
    const listed = async () => (await parseCatalog(bundledMarketplace(box.data), bundledMarketplace(box.data), 'folder', { counts: false })).plugins.map(plugin => plugin.name);
    // Release 2 drops "release"; Claude Code here has it installed.
    await market(box.source, { docs: '1.1.0' });
    assert.ok('release' in await box.publish(2));
    const installed = { ...box.host, keep: async (marketplace: string) => (marketplace === 'team-tools' ? ['release', 'docs'] : []) };
    assert.equal((await checkFeed(installed)).outcome, 'updated');
    assert.deepEqual(await listed(), ['docs', 'release']);
    assert.match(await box.skill('release', '_kept/release'), /release 0\.4\.1/);
    assert.match(await box.skill(), /docs 1\.1\.0/, 'a plugin the release does pack is the release’s');
    assert.deepEqual((await activeBundle(box.data))?.release.kept, ['release']);
    assert.deepEqual((await activeBundle(box.data))?.release.plugins.map(plugin => plugin.name), ['docs']);
    // It is carried on through later releases while it is still installed, from where it now sits.
    await market(box.source, { docs: '1.2.0' });
    assert.ok('release' in await box.publish(3));
    assert.equal((await checkFeed(installed)).outcome, 'updated');
    assert.deepEqual(await listed(), ['docs', 'release']);
    assert.match(await box.skill('release', '_kept/release'), /release 0\.4\.1/);
    // Once no tool has it, the next release leaves it out.
    await market(box.source, { docs: '1.3.0' });
    assert.ok('release' in await box.publish(4));
    assert.equal((await checkFeed(box.host)).outcome, 'updated');
    assert.deepEqual(await listed(), ['docs']);
    assert.equal(await exists(join(bundledMarketplace(box.data), '_kept')), false);
    assert.equal((await activeBundle(box.data))?.release.kept, undefined);
    // A plugin that comes back is the release's own again.
    await market(box.source, { docs: '1.3.0', release: '0.5.0' });
    assert.ok('release' in await box.publish(5));
    assert.equal((await checkFeed(installed)).outcome, 'updated');
    assert.match(await box.skill('release'), /release 0\.5\.0/);
    assert.equal((await activeBundle(box.data))?.release.kept, undefined);
  } finally { await box.cleanup(); }
});

test('publishing: a plugin that can never be packed is left out and named; one whose fetch failed this time holds the release', async () => {
  const box = await setup();
  try {
    const remote = { name: 'elsewhere', source: { source: 'github', repo: 'acme/elsewhere' }, version: '1.0.0' };
    const npm = { name: 'packaged', source: { source: 'npm', package: '@acme/packaged' } };
    await market(box.source, { docs: '1.1.0' }, [remote, npm]);
    const publish = (sequence: number, fetched: boolean) => publishRelease({ source: box.source, out: box.feed, work: join(box.base, 'work'), sequence,
      fetchPlugin: async () => (fetched ? { folder: join(box.source, 'plugins/docs'), root: box.source } : { problem: 'Can’t reach the marketplace.' }) });
    // The other repository can't be reached today: nothing goes out, and the folder is as it was.
    const held = await publish(2, false);
    assert.ok('problem' in held);
    assert.match(held.problem, /^Nothing was published\. The files of one plugin couldn’t be fetched this time[^\n]*\n {2}- elsewhere: Its files couldn’t be fetched from GitHub: acme\/elsewhere: Can’t reach the marketplace\.\nTry again/);
    assert.equal(await exists(box.feed), false);
    // It can: the release goes out without the npm plugin, which is named.
    const out = await publish(2, true);
    assert.ok('release' in out, JSON.stringify(out));
    assert.deepEqual(out.release.plugins.map(plugin => plugin.name), ['docs', 'elsewhere']);
    assert.match(out.report, /NOT PACKED \(1\)[^\n]*\n {2}- packaged: Its files are an npm package/);
    assert.deepEqual((await readdir(box.feed)).sort(), ['content-2.tgz', 'release.json']);
    assert.deepEqual(await readRelease(join(box.feed, 'release.json')), out.release);
    // A later release says what it no longer lists, and must be higher than the one before.
    await market(box.source, { docs: '1.2.0' });
    const same = await publish(2, true);
    assert.ok('problem' in same);
    assert.match(same.problem, /Its sequence \(2\) must be higher than the one already published there \(2\)/);
    const next = await publish(3, true);
    assert.ok('release' in next);
    assert.match(next.report, /sequence 3 \(the one before: 2\)/);
    assert.match(next.report, /No longer listed: elsewhere\. It stays, as it is, where a tool has it installed/);
    // Another marketplace's release doesn't go into this feed's folder.
    await put(join(box.base, 'other/.claude-plugin/marketplace.json'), JSON.stringify({ name: 'other-tools', plugins: [] }));
    const other = await publishRelease({ source: join(box.base, 'other'), out: box.feed, work: join(box.base, 'work'), sequence: 9 });
    assert.ok('problem' in other);
    assert.match(other.problem, /holds releases of the marketplace “team-tools”, and this one is “other-tools”/);
    assert.equal((await readRelease(join(box.feed, 'release.json')))?.sequence, 3);
  } finally { await box.cleanup(); }
});

test('a kept plugin keeps its own entry in each manifest that listed it, and enters no manifest that didn’t', async () => {
  const box = await setup();
  try {
    // A marketplace with both manifests: "claude-only" is in Claude's alone; "both" is in both, with Codex's own fields.
    const write = async (plugins: string[]) => {
      await market(box.source, Object.fromEntries(plugins.map(name => [name, '1.0.0'])));
      await put(join(box.source, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'team-tools', plugins: plugins.filter(name => name !== 'claude-only').map(name => ({ name, source: { source: 'local', path: `./plugins/${name}` }, policy: { installation: 'AVAILABLE' } })) }));
    };
    await write(['docs', 'claude-only', 'both']);
    assert.ok('release' in await box.publish(2));
    assert.equal((await checkFeed(box.host)).outcome, 'updated');
    // Release 3 offers neither any more; a tool here has both installed.
    await write(['docs']);
    assert.ok('release' in await box.publish(3));
    assert.equal((await checkFeed({ ...box.host, keep: async () => ['claude-only', 'both'] })).outcome, 'updated');
    const folder = bundledMarketplace(box.data);
    const entries = async (file: string) => JSON.parse(await readFile(join(folder, file), 'utf8')).plugins as { name: string; source: unknown; policy?: unknown }[];
    assert.deepEqual((await entries('.claude-plugin/marketplace.json')).map(entry => [entry.name, entry.source]), [['docs', './plugins/docs'], ['both', './_kept/both'], ['claude-only', './_kept/claude-only']]);
    assert.deepEqual(await entries('.agents/plugins/marketplace.json'), [
      { name: 'docs', source: { source: 'local', path: './plugins/docs' }, policy: { installation: 'AVAILABLE' } },
      { name: 'both', source: { source: 'local', path: './_kept/both' }, policy: { installation: 'AVAILABLE' } }]);
    assert.deepEqual((await activeBundle(box.data))?.release.kept?.sort(), ['both', 'claude-only']);
  } finally { await box.cleanup(); }
});

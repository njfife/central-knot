import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { aboutBuild, activeBundle, bundledMarketplace, customBuild, openBundle, readRelease, releaseDate, releaseLabel } from '../src/bundle.ts';
import { STANDARD_NAME, buildInputs, describeBuild, isCustom, packRelease, stageCustomBuild } from '../src/bundlepack.ts';
import { parseCatalog } from '../src/plugins.ts';

const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const exists = (path: string) => stat(path).then(() => true, () => false);

/** A marketplace folder: two plugins kept in it, one kept in another repository and one that is an npm package. */
async function market(root: string, version = '1.0.0') {
  await put(join(root, '.claude-plugin/marketplace.json'), `${JSON.stringify({ name: 'team-tools', owner: { name: 'Platform team' }, plugins: [
    { name: 'docs', source: './plugins/docs', version },
    { name: 'release', source: './plugins/release', version: '0.4.1' },
    { name: 'elsewhere', source: { source: 'github', repo: 'acme/elsewhere', path: 'plugin' }, version: '2.0.0' },
    { name: 'packaged', source: { source: 'npm', package: '@acme/packaged' } },
  ] }, null, 4)}\n`);
  await put(join(root, 'plugins/docs/skills/pdf/SKILL.md'), `---\nname: pdf\ndescription: Reads PDFs (${version}).\n---\n\ntoken=abc123 stays as written\n`);
  await put(join(root, 'plugins/docs/bin/run.sh'), '#!/bin/sh\necho hi\n');
  await chmod(join(root, 'plugins/docs/bin/run.sh'), 0o755);
  await put(join(root, 'plugins/docs/bin/shared.sh'), '#!/bin/sh\n');
  await chmod(join(root, 'plugins/docs/bin/shared.sh'), 0o775);
  await symlink('SKILL.md', join(root, 'plugins/docs/skills/pdf/alias.md'));
  await put(join(root, 'plugins/release/commands/notes.md'), '---\ndescription: Notes.\n---\n');
  await put(join(root, '.git/config'), '[remote "origin"]\n\turl = https://token@example.com/team/tools.git\n');
  await put(join(root, 'README.md'), '# Team tools\n');
}

async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-bundle-')));
  const source = join(base, 'source');
  await market(source);
  // The plugin kept in another repository, as a fetch of it would leave it: its files under plugin/, a .git folder at its top.
  const other = join(base, 'other');
  await put(join(other, 'plugin/skills/far/SKILL.md'), '---\nname: far\ndescription: Kept elsewhere.\n---\n');
  await put(join(other, '.git/HEAD'), 'ref: refs/heads/main\n');
  const fetchPlugin = async () => ({ folder: join(other, 'plugin'), root: other });
  const pack = (out: string, options: { sequence?: number; from?: string } = {}) => packRelease({ source: options.from ?? source, out, work: join(base, 'work'), sequence: options.sequence, now: new Date('2026-11-10T12:00:00Z'), fetchPlugin });
  return { base, source, pack, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('build inputs: none is the standard build, any one is a custom build with its own identity', () => {
  assert.deepEqual(buildInputs(['--release']), { inputs: {}, rest: ['--release'] });
  assert.equal(isCustom(buildInputs([]).inputs), false);
  const { inputs, rest } = buildInputs(['--marketplace', 'acme/plugins', '--app-name=Acme Knot', '--release', '--sequence', '7']);
  assert.deepEqual(rest, ['--release']);
  assert.deepEqual(inputs, { marketplace: 'acme/plugins', appName: 'Acme Knot', sequence: 7 });
  assert.deepEqual(describeBuild(inputs), { id: 'acme-knot', name: 'Acme Knot', bundleId: 'com.centralknot.custom.acme-knot', marketplace: {} });
  // Branding with no marketplace is an unbundled custom build.
  assert.deepEqual(describeBuild({ appName: 'Staging Knot' }), { id: 'staging-knot', name: 'Staging Knot', bundleId: 'com.centralknot.custom.staging-knot' });
  assert.deepEqual(describeBuild({ marketplace: '/m', appName: 'Acme', appId: 'acme.tools', marketplaceName: ' Acme plugins ', marketplaceLogo: '/x/Logo.PNG' }),
    { id: 'acme.tools', name: 'Acme', bundleId: 'com.centralknot.custom.acme.tools', marketplace: { displayName: 'Acme plugins', logo: 'marketplace-logo.png' } });
});

test('build inputs that describe no build are refused in plain words', () => {
  assert.throws(() => buildInputs(['--marketplace']), /--marketplace needs a value/);
  assert.throws(() => buildInputs(['--app-name', '--release']), /--app-name needs a value/);
  assert.throws(() => buildInputs(['--app-id', 'a', '--app-id', 'b']), /given twice/);
  assert.throws(() => buildInputs(['--sequence', 'soon']), /whole number/);
  // Left with the standard app's name, the build's file would take the standard app's place.
  assert.throws(() => describeBuild({ marketplace: '/m' }), /needs its own name: add --app-name/);
  assert.throws(() => describeBuild({ appId: 'acme' }), /needs its own name: add --app-name/);
  for (const name of ['Central Knot', 'central knot', 'Central-Knot']) assert.throws(() => describeBuild({ appName: name, appId: 'acme' }), /--app-name can’t be “Central Knot”/, name);
  assert.throws(() => describeBuild({ marketplaceName: 'Acme plugins' }), /add --marketplace/);
  assert.throws(() => describeBuild({ marketplaceLogo: '/x/logo.png' }), /add --marketplace/);
  assert.throws(() => describeBuild({ appName: 'Acme', appId: 'central-knot' }), /--app-id/);
  assert.throws(() => describeBuild({ appName: 'Acme', appId: 'Has Space' }), /--app-id/);
  assert.throws(() => describeBuild({ appName: 'a/b' }), /--app-name/);
  // Names the app's file couldn't keep as written.
  for (const name of ['Acme Inc.', 'What?', 'A*', 'Say "hi"', 'a|b', '.hidden']) assert.throws(() => describeBuild({ appName: name }), /--app-name/, name);
  assert.equal(describeBuild({ appName: 'Acme’s Knot & Co' }).id, 'acme-s-knot-co');
  assert.throws(() => describeBuild({ appName: '東京' }), /--app-id/);
  assert.throws(() => describeBuild({ appName: 'Acme', appIcon: '/x/icon.svg' }), /--app-icon takes a \.png or \.icns/);
});

test('a custom build file that isn’t one reads as the standard build', () => {
  assert.equal(customBuild(undefined), undefined);
  assert.equal(customBuild({ id: 'acme', name: 'Acme' }), undefined);
  assert.equal(customBuild({ id: '../x', name: 'Acme', bundleId: 'com.x' }), undefined);
  assert.deepEqual(customBuild({ id: 'acme', name: 'Acme', bundleId: 'com.centralknot.custom.acme', marketplace: { logo: '../../etc/passwd', displayName: 'Acme plugins' }, more: 1 }),
    { id: 'acme', name: 'Acme', bundleId: 'com.centralknot.custom.acme', marketplace: { displayName: 'Acme plugins' } });
});

test('packing: every plugin’s files go in as they are, a plugin kept elsewhere is fetched, and one that can’t be is named', async () => {
  const { base, source, pack, cleanup } = await setup();
  try {
    const packed = await pack(join(base, 'out'));
    assert.ok('release' in packed, JSON.stringify(packed));
    const { release } = packed;
    assert.equal(release.marketplace, 'team-tools');
    assert.equal(release.sequence, Math.floor(Date.parse('2026-11-10T12:00:00Z') / 1000));
    assert.equal(release.from, 'Folder: source');
    assert.deepEqual(release.plugins, [{ name: 'docs', version: '1.0.0' }, { name: 'elsewhere', version: '2.0.0' }, { name: 'release', version: '0.4.1' }]);
    assert.deepEqual(release.unpackaged.map(item => item.name), ['packaged']);
    assert.equal(release.unpackaged[0]!.reason, 'Its files are an npm package (@acme/packaged), which can’t be packed into the app.');
    // Whoever makes the release hears what that one entry does to Copilot CLI.
    assert.deepEqual(packed.notes.map(note => note.split('.')[0]), ['Copilot CLI refuses a marketplace with an npm plugin source (“packaged”)']);
    assert.deepEqual(await readRelease(join(base, 'out/release.json')), release);
    assert.equal(releaseLabel(release), 'November 10, 2026 (Folder: source)');
    assert.equal(releaseDate(release), 'November 10, 2026');
    // What Settings says of the build: the date only, since where it was made from means nothing to whoever was handed the app.
    assert.deepEqual(aboutBuild({ id: 'acme-knot', name: 'Acme Knot', bundleId: 'x' }, '0.5.0', { name: 'Acme plugins', date: releaseDate(release) }), [
      'Acme Knot is a custom build of Central Knot 0.5.0, with its own settings.',
      'It doesn’t update itself: for a newer one, ask whoever gave you Acme Knot.',
      'Its Acme plugins marketplace is as of November 10, 2026 and changes only with a new Acme Knot.']);

    // Opened as the app opens it: the folder the tools are given holds the marketplace, without the fetch's .git folders.
    const data = join(base, 'data');
    const opened = await openBundle(data, join(base, 'out'));
    assert.equal(opened.problem, undefined);
    const folder = bundledMarketplace(data);
    assert.equal(opened.active?.folder, folder);
    assert.equal(await readFile(join(folder, 'plugins/docs/skills/pdf/SKILL.md'), 'utf8'), await readFile(join(source, 'plugins/docs/skills/pdf/SKILL.md'), 'utf8'));
    assert.equal((await stat(join(folder, 'plugins/docs/bin/run.sh'))).mode & 0o777, 0o755);
    assert.equal((await stat(join(folder, 'plugins/docs/bin/shared.sh'))).mode & 0o777, 0o775, 'a mode this account wouldn’t give a new file is kept too');
    assert.equal(await readFile(join(folder, 'plugins/docs/skills/pdf/alias.md'), 'utf8'), await readFile(join(folder, 'plugins/docs/skills/pdf/SKILL.md'), 'utf8'));
    assert.equal(await exists(join(folder, '.git')), false);
    assert.equal(await exists(join(folder, '_bundled/elsewhere/.git')), false);
    assert.equal(await exists(join(folder, '_bundled/elsewhere/skills/far/SKILL.md')), true);
    // Its catalog reads with every packed plugin's files in place; the one that couldn't be packed keeps its entry as written.
    const catalog = await parseCatalog(folder, folder, 'folder');
    assert.deepEqual(catalog.plugins.map(plugin => [plugin.name, !!plugin.folder]), [['docs', true], ['elsewhere', true], ['packaged', false], ['release', true]]);
    const entries = JSON.parse(await readFile(join(folder, '.claude-plugin/marketplace.json'), 'utf8')).plugins;
    assert.equal(entries[2].source, './_bundled/elsewhere');
    assert.deepEqual(entries[3].source, { source: 'npm', package: '@acme/packaged' });
    // The source itself is untouched, and nothing is left in the data folder but the marketplace and its manifest.
    assert.equal(JSON.parse(await readFile(join(source, '.claude-plugin/marketplace.json'), 'utf8')).plugins[2].source.repo, 'acme/elsewhere');
    assert.deepEqual((await readdir(join(data, 'bundled'))).sort(), ['marketplace', 'release.json']);
  } finally { await cleanup(); }
});

test('a marketplace with nothing kept elsewhere is packed byte for byte', async () => {
  const { base, cleanup } = await setup();
  try {
    const plain = join(base, 'plain');
    const manifest = '{\n    "name": "plain-tools",   "plugins": [ { "name": "one", "source": "./one" } ]\n}\n';
    await put(join(plain, '.claude-plugin/marketplace.json'), manifest);
    await put(join(plain, 'one/skills/a/SKILL.md'), '---\nname: a\ndescription: A.\n---\n');
    const packed = await packRelease({ source: plain, out: join(base, 'out'), work: join(base, 'work') });
    assert.ok('release' in packed);
    await openBundle(join(base, 'data'), join(base, 'out'));
    assert.equal(await readFile(join(bundledMarketplace(join(base, 'data')), '.claude-plugin/marketplace.json'), 'utf8'), manifest);
  } finally { await cleanup(); }
});

test('a marketplace folder given by a relative path is carried as it is on disk, never fetched as a repository', async () => {
  const { base, source, cleanup } = await setup();
  const before = process.cwd();
  try {
    // Only the plugins kept in it, so nothing is fetched; one of them is an empty folder, as a submodule arrives.
    const manifest = JSON.parse(await readFile(join(source, '.claude-plugin/marketplace.json'), 'utf8'));
    await mkdir(join(source, 'plugins/sub'));
    await writeFile(join(source, '.claude-plugin/marketplace.json'), JSON.stringify({ ...manifest, plugins: [...manifest.plugins.filter((plugin: { source: unknown }) => typeof plugin.source === 'string'), { name: 'sub', source: './plugins/sub' }] }));
    process.chdir(base);
    for (const given of ['./source', 'source']) {
      const packed = await packRelease({ source: given, out: join(base, 'out'), work: join(base, 'work') });
      assert.ok('release' in packed, `${given}: ${JSON.stringify(packed)}`);
      assert.equal(packed.release.from, 'Folder: source', given);
      assert.deepEqual(packed.release.plugins.map(plugin => plugin.name), ['docs', 'release'], given);
      // The empty folder is no plugin to install: it is named, with why.
      assert.deepEqual(packed.release.unpackaged.map(item => item.name), ['sub'], given);
      assert.match(packed.release.unpackaged[0]!.reason, /is empty in the marketplace/);
    }
  } finally { process.chdir(before); await cleanup(); }
});

test('a source that isn’t a marketplace makes no release', async () => {
  const { base, cleanup } = await setup();
  try {
    await mkdir(join(base, 'empty'));
    const packed = await packRelease({ source: join(base, 'empty'), out: join(base, 'out'), work: join(base, 'work') });
    assert.ok('problem' in packed);
    assert.match(packed.problem, /could not be read: There is no marketplace here/);
    assert.equal(await exists(join(base, 'out/release.json')), false);
  } finally { await cleanup(); }
});

test('opening: a newer carried release replaces the content, an older one never takes it back', async () => {
  const { base, source, pack, cleanup } = await setup();
  try {
    const data = join(base, 'data'), skill = join(bundledMarketplace(data), 'plugins/docs/skills/pdf/SKILL.md');
    await pack(join(base, 'one'), { sequence: 1 });
    await market(source, '1.1.0').catch(() => undefined);
    await pack(join(base, 'two'), { sequence: 2 });
    assert.equal((await openBundle(data, join(base, 'one'))).active?.release.sequence, 1);
    assert.match(await readFile(skill, 'utf8'), /1\.0\.0/);
    // The same release again changes nothing.
    const before = (await stat(bundledMarketplace(data))).ino;
    await openBundle(data, join(base, 'one'));
    assert.equal((await stat(bundledMarketplace(data))).ino, before);
    // A newer one takes its place, at the same path.
    const newer = await openBundle(data, join(base, 'two'));
    assert.equal(newer.active?.release.sequence, 2);
    assert.match(await readFile(skill, 'utf8'), /1\.1\.0/);
    // An app that carries the older release (an app update after newer content arrived) leaves the newer content in use.
    const kept = await openBundle(data, join(base, 'one'));
    assert.equal(kept.problem, undefined);
    assert.match(kept.kept ?? '', /sequence 2\) is newer than the release this app carries \(sequence 1\)/);
    assert.equal(kept.active?.release.sequence, 2);
    assert.match(await readFile(skill, 'utf8'), /1\.1\.0/);
  } finally { await cleanup(); }
});

test('opening: a release that can’t be used leaves the last working content in place and says why', async () => {
  const { base, source, pack, cleanup } = await setup();
  try {
    const data = join(base, 'data'), skill = join(bundledMarketplace(data), 'plugins/docs/skills/pdf/SKILL.md');
    await pack(join(base, 'one'), { sequence: 1 });
    await openBundle(data, join(base, 'one'));
    await market(source, '1.1.0').catch(() => undefined);
    const two = await pack(join(base, 'two'), { sequence: 2 });
    assert.ok('release' in two);
    // Cut short, as a download that stopped would be.
    await truncate(join(base, 'two', two.release.archive), 100);
    const cut = await openBundle(data, join(base, 'two'));
    assert.match(cut.problem ?? '', /could not be unpacked.*another size or checksum/);
    assert.equal(cut.active?.release.sequence, 1);
    assert.match(await readFile(skill, 'utf8'), /1\.0\.0/);
    // The right size and checksum, but not an archive.
    await writeFile(join(base, 'two', two.release.archive), 'not an archive');
    const { fileDigest } = await import('../src/bundle.ts');
    await writeFile(join(base, 'two/release.json'), JSON.stringify({ ...two.release, ...(await fileDigest(join(base, 'two', two.release.archive))) }));
    const bad = await openBundle(data, join(base, 'two'));
    assert.match(bad.problem ?? '', /could not be unpacked/);
    assert.equal(bad.active?.release.sequence, 1);
    // What a stopped unpack left behind is cleared by the next one.
    await mkdir(join(data, 'bundled/incoming-left-behind'));
    await openBundle(data, join(base, 'two'));
    // No manifest at all.
    await rm(join(base, 'two/release.json'));
    assert.match((await openBundle(data, join(base, 'two'))).problem ?? '', /no manifest/);
    assert.deepEqual((await readdir(join(data, 'bundled'))).sort(), ['marketplace', 'release.json']);
    assert.match(await readFile(skill, 'utf8'), /1\.0\.0/);
  } finally { await cleanup(); }
});

test('opening: a swap that stopped halfway is mended, so the last working content is found', async () => {
  const { base, pack, cleanup } = await setup();
  try {
    const data = join(base, 'data');
    await pack(join(base, 'one'), { sequence: 1 });
    await openBundle(data, join(base, 'one'));
    await rename(bundledMarketplace(data), join(data, 'bundled/previous'));
    const found = await activeBundle(data);
    assert.equal(found?.release.sequence, 1);
    assert.equal(await exists(join(bundledMarketplace(data), 'plugins/docs/skills/pdf/SKILL.md')), true);
  } finally { await cleanup(); }
});

test('staging a custom build: its identity file, the carried release, its pictures and a report that says what is not met', async () => {
  const { base, source, cleanup } = await setup();
  try {
    await writeFile(join(base, 'icon.png'), 'png');
    await writeFile(join(base, 'logo.svg'), '<svg/>');
    const out = join(base, 'staged');
    // Without the plugin kept on GitHub: staging fetches for real, and a test stays off the network.
    const manifest = JSON.parse(await readFile(join(source, '.claude-plugin/marketplace.json'), 'utf8'));
    await writeFile(join(source, '.claude-plugin/marketplace.json'), JSON.stringify({ ...manifest, plugins: manifest.plugins.filter((plugin: { name: string }) => plugin.name !== 'elsewhere') }));
    const staged = await stageCustomBuild({ marketplace: source, appName: 'Acme Knot', appIcon: join(base, 'icon.png'), marketplaceName: 'Acme plugins', marketplaceLogo: join(base, 'logo.svg') }, { out, work: join(base, 'work'), now: new Date('2026-11-10T12:00:00Z') });
    assert.deepEqual(staged.build, { id: 'acme-knot', name: 'Acme Knot', bundleId: 'com.centralknot.custom.acme-knot', marketplace: { displayName: 'Acme plugins', logo: 'marketplace-logo.svg' } });
    assert.deepEqual(customBuild(JSON.parse(await readFile(join(out, 'custom-build.json'), 'utf8'))), staged.build);
    assert.equal(staged.icon, 'app-icon.png');
    assert.deepEqual((await readdir(out)).sort(), ['app-icon.png', 'build-report.txt', 'bundle', 'custom-build.json']);
    assert.deepEqual((await readdir(join(out, 'bundle'))).sort(), [staged.release!.archive, 'marketplace-logo.svg', 'release.json']);
    const report = await readFile(join(out, 'build-report.txt'), 'utf8');
    assert.equal(report, staged.report);
    assert.match(report, /^Acme Knot: a custom build of Central Knot\n/);
    assert.match(report, /Identity: acme-knot \(com\.centralknot\.custom\.acme-knot\)/);
    assert.match(report, /Marketplace: team-tools, shown as “Acme plugins”, with the logo logo\.svg/);
    assert.match(report, /Plugins packed \(2\): docs 1\.0\.0, release 0\.4\.1/);
    assert.match(report, /NOT PACKED \(1\)[^\n]*\n {2}- packaged: [^\n]+\nNote: Copilot CLI refuses a marketplace with an npm plugin source/);
    assert.match(report, /App updates: not met\./);
    assert.match(report, /Content feed: not met\./);
    // An unbundled custom build carries nothing and says so.
    const plain = await stageCustomBuild({ appName: 'Staging Knot' }, { out, work: join(base, 'work') });
    assert.equal(plain.release, undefined);
    assert.deepEqual((await readdir(out)).sort(), ['build-report.txt', 'custom-build.json']);
    assert.match(plain.report, /Marketplace: none/);
    // A staging that stopped halfway (its icon is there but can't be read) leaves a folder the next staging may clear.
    await writeFile(join(base, 'locked.png'), 'png');
    await chmod(join(base, 'locked.png'), 0o000);
    await assert.rejects(stageCustomBuild({ marketplace: source, appName: 'Acme Knot', appIcon: join(base, 'locked.png') }, { out: join(base, 'half'), work: join(base, 'work') }));
    assert.equal((await readdir(join(base, 'half'))).includes('bundle'), true, 'it stopped after the marketplace was packed');
    assert.equal((await stageCustomBuild({ appName: 'Staging Knot' }, { out: join(base, 'half'), work: join(base, 'work') })).build.id, 'staging-knot');
    // Staging clears a folder staged before, never a folder holding someone's other files.
    await mkdir(join(base, 'mine'));
    await writeFile(join(base, 'mine/notes.txt'), 'keep');
    await assert.rejects(stageCustomBuild({ appName: 'Staging Knot' }, { out: join(base, 'mine'), work: join(base, 'work') }), /holds other files/);
    assert.equal(await readFile(join(base, 'mine/notes.txt'), 'utf8'), 'keep');
    // Inputs that can't be built stop before anything is fetched or written.
    await assert.rejects(stageCustomBuild({ marketplace: source, appName: 'Acme Knot', appIcon: join(base, 'nothing.png') }, { out, work: join(base, 'work') }), /--app-icon: there is no file/);
    await assert.rejects(stageCustomBuild({ marketplace: join(base, 'nowhere'), appName: 'Acme Knot' }, { out, work: join(base, 'work') }), /could not be read/);
  } finally { await cleanup(); }
});

test('what is written outside the app names the product, never a custom build: the renaming can’t reach it', async () => {
  // A custom build is renamed by replacing the standard name's plain spelling in the built code (scripts/build.mjs). The
  // markers in a tool's instruction file must read the same from every build, so their code never spells the name out.
  const code = (await readFile(join(import.meta.dirname, '../src/basetext.ts'), 'utf8')).split('\n').filter(line => !/^\s*(\/\/|\/?\*)/.test(line)).join('\n');
  assert.equal(code.includes(STANDARD_NAME), false, 'basetext.ts builds its markers from PRODUCT');
  const { splitBase } = await import('../src/basetext.ts');
  assert.deepEqual(splitBase('Mine.\n<!-- Central Knot base instructions: start (shared by your tools; edit them in Central Knot) -->\nBase.\n<!-- Central Knot base instructions: end -->\n'), { own: 'Mine.\n', copy: 'Base.\n' });
  const { PRODUCT } = await import('../src/values.ts');
  assert.equal(PRODUCT, STANDARD_NAME);
});

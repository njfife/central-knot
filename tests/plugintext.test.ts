// The plugin text (plugintext.ts) on made-up repositories served over Git's smart HTTP (scripts/git-http-fixture.mjs), reached as
// https://example.test/ through Git's own url.insteadOf, so the catalog's addresses are ones the app accepts. Each test reads
// as one worked example of the brief: what is fetched is what the reader finds in a whole copy; a repository that is gone, or a
// server that declines filtering, leaves the rest; a pin that moves, a marketplace removed or a home switched while a fetch
// runs keeps nothing of it; turning it off or quitting keeps what was saved, and the next run goes on from there.
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request as forward, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { searchedParts } from '../src/catalogdetail.ts';
import { pluginTextJob, type PluginText } from '../src/plugintext.ts';
import type { PluginTextView } from '../src/types.ts';

const noPosix = process.platform === 'win32';
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();

/** A repository with these files (a value starting `->` is a link to that target), committed; its commit. */
async function commit(folder: string, files: Record<string, string>, message = 'files'): Promise<string> {
  await mkdir(folder, { recursive: true });
  if (!(await readFile(join(folder, '.git/HEAD')).catch(() => undefined))) git(folder, 'init', '-q', '-b', 'main');
  for (const [path, text] of Object.entries(files)) {
    await rm(join(folder, path), { force: true });
    if (text.startsWith('->')) { await mkdir(dirname(join(folder, path)), { recursive: true }); await symlink(text.slice(2), join(folder, path)); } else await put(join(folder, path), text);
  }
  git(folder, 'add', '-A'); git(folder, 'commit', '-qm', message);
  return git(folder, 'rev-parse', 'HEAD');
}

/** The plugin kept in another repository: a skill named unlike its plugin, one through a link inside it, one through a link out of it, agents six levels down, two servers. */
const ALPHA = {
  'plugins/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', mcpServers: './servers.json' }),
  'plugins/alpha/skills/pdf-wrangler/SKILL.md': '---\nname: pdf-wrangler\ndescription: Turns PDFs into tidy text.\n---\nRead the PDF, then write it out as plain text.\n',
  'plugins/alpha/docs/shared.md': '---\nname: shared-notes\ndescription: Notes kept beside the skills.\n---\nShared body.\n',
  'plugins/alpha/skills/linked/SKILL.md': '->../../docs/shared.md',
  'plugins/alpha/skills/escape/SKILL.md': '->../../../../outside.md',
  'plugins/alpha/agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews a change.\n---\nAgent body.\n',
  'plugins/alpha/agents/deep/er/digger.md': '---\ndescription: Digs deep.\n---\nDeep.\n',
  'plugins/alpha/.mcp.json': JSON.stringify({ mcpServers: { fetcher: { command: 'npx', args: ['fetch-server'] } } }),
  'plugins/alpha/servers.json': JSON.stringify({ lister: { url: 'https://example.invalid/mcp' } }),
  'outside.md': '---\nname: outside\ndescription: Not the plugin’s.\n---\n',
  // What a whole copy would bring: 300 kB that does not compress.
  'other/big.bin': randomBytes(150_000).toString('hex'),
};

/**
 * The world: a fixture server behind a proxy that can hold one repository's requests (`hold`) and counts each repository's
 * fetches; repositories tools.git (alpha, pinned), solo.git (quiet-hours, unpinned) and plain.git (served without filtering);
 * a marketplace folder listing them, an in-marketplace plugin, and one in a repository that is not there.
 */
async function world() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugintext-')));
  const served = join(base, 'served');
  const pin = await commit(join(base, 'src/tools'), ALPHA);
  await commit(join(base, 'src/solo'), { 'skills/quiet-hours/SKILL.md': '---\nname: quiet-hours\ndescription: Holds notifications at night.\n---\nBody.\n' });
  await mkdir(served, { recursive: true });
  for (const name of ['tools', 'solo']) {
    git(base, 'clone', '-q', '--bare', join(base, 'src', name), join(served, `${name}.git`));
    git(join(served, `${name}.git`), 'config', 'uploadpack.allowFilter', 'true');
    git(join(served, `${name}.git`), 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  }
  git(base, 'clone', '-q', '--bare', join(base, 'src/tools'), join(served, 'plain.git'));
  const fixture = spawn(process.execPath, [join(import.meta.dirname, '../scripts/git-http-fixture.mjs'), served, '0']);
  const target = await new Promise<string>(done => { let out = ''; fixture.stdout!.on('data', chunk => { out += String(chunk); if (out.includes('\n')) done(out.split('\n')[0]!.trim()); }); });
  const proxy = holdingProxy(target);
  const port = await new Promise<number>(done => proxy.server.listen(0, '127.0.0.1', () => done((proxy.server.address() as { port: number }).port)));
  const gitconfig = join(base, 'gitconfig');
  await writeFile(gitconfig, `[url "http://127.0.0.1:${port}/"]\n\tinsteadOf = https://example.test/\n`);
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  const market = join(base, 'market');
  const writeMarket = (alphaSha: string, extra: object[] = []) => put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'made-up', owner: { name: 't' }, plugins: [
    { name: 'inside', source: './plugins/inside' },
    { name: 'alpha', source: { source: 'url', url: 'https://example.test/tools.git', path: 'plugins/alpha', sha: alphaSha } },
    { name: 'solo', source: { source: 'url', url: 'https://example.test/solo.git' } },
    { name: 'gone', source: { source: 'url', url: 'https://example.test/missing.git' } },
    ...extra,
  ] }));
  await put(join(market, 'plugins/inside/skills/tidy-desk/SKILL.md'), '---\nname: tidy-desk\ndescription: Keeps a desk tidy.\n---\nBody.\n');
  await writeMarket(pin);
  return {
    base, market, pin, served, proxy, writeMarket, dataDir: join(base, 'data'),
    async close() { proxy.server.close(); await stopped(fixture); process.env.GIT_CONFIG_GLOBAL = saved; await rm(base, { recursive: true, force: true }); },
  };
}

/** Forwards to the fixture; requests for a repository named in `hold` wait until `release`; `asked` counts requests and `sent` bytes, by repository. */
function holdingProxy(target: string) {
  const waiting: (() => void)[] = [];
  const state = { hold: '', asked: new Map<string, number>(), sent: new Map<string, number>(), waiting, server: undefined as unknown as Server, release() { state.hold = ''; waiting.splice(0).forEach(go => go()); } };
  state.server = createServer((request, response) => {
    const repo = /\/([\w-]+\.git)\//.exec(request.url ?? '')?.[1] ?? '';
    state.asked.set(repo, (state.asked.get(repo) ?? 0) + 1);
    const go = () => {
      const upstream = forward(`${target}${request.url}`, { method: request.method, headers: request.headers }, reply => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.on('data', chunk => state.sent.set(repo, (state.sent.get(repo) ?? 0) + chunk.length));
        reply.pipe(response);
      });
      // A request whose Git was stopped while it was held goes nowhere.
      upstream.on('error', () => response.destroy());
      request.pipe(upstream);
    };
    if (state.hold && repo === state.hold) waiting.push(go); else go();
  });
  return state;
}
function stopped(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
  return new Promise(done => { server.once('exit', () => done()); server.kill(); });
}
const until = async (ok: () => boolean, what: string) => { for (let tries = 0; tries < 600 && !ok(); tries++) await new Promise(done => setTimeout(done, 25)); assert.ok(ok(), `waited for ${what}`); };

/** A job over these sources, with what it said: each view and what was kept when it said it, each finished run, its log. */
function jobOver(dataDir: string, sources: () => string[] | undefined, now = Date.now) {
  const views: PluginTextView[] = [], keptThen: PluginText[][] = [], logs: string[] = [];
  let on = true, ends = 0;
  const job = pluginTextJob({ dataDir, on: () => on, listings: async () => sources(), log: line => logs.push(line), now,
    changed: view => { views.push(view); keptThen.push(job.texts()); if (!view.reading) ends++; } });
  return {
    job, views, keptThen, logs, switch(value: boolean) { on = value; },
    /** Starts (or restarts) and waits for that run to end. */
    async run(start = () => job.restart()) { const before = ends; start(); await until(() => ends > before, 'the run to end'); },
    ended: () => ends,
    text: (plugin: string) => job.texts().find(entry => entry.plugin === plugin),
  };
}
const names = (entry: PluginText | undefined) => entry?.items.map(item => `${item.kind} ${item.name}`).sort();

test('What is fetched for a plugin kept in another repository is what the reader finds in a whole copy of it; only text is kept, and nothing of Git', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    const alpha = kept.text('alpha')!;
    // The reader on a whole copy, rooted at the plugin's folder as the job's copy is.
    const whole = join(w.base, 'whole');
    git(w.base, 'clone', '-q', join(w.served, 'tools.git'), whole);
    const folder = join(whole, 'plugins/alpha'), read = await searchedParts(folder, {}, folder);
    assert.deepEqual(names(alpha), [...read.skills.map(part => `skill ${part.name}`), ...read.agents.map(part => `agent ${part.name}`), ...read.mcpServers.map(server => `mcp ${server.name}`)].sort());
    assert.deepEqual(names(alpha), ['agent digger', 'agent reviewer', 'mcp fetcher', 'mcp lister', 'skill pdf-wrangler', 'skill shared-notes'], 'a link out of the plugin’s folder is not followed');
    const skill = alpha.items.find(item => item.name === 'pdf-wrangler')!;
    assert.deepEqual(skill, { kind: 'skill', name: 'pdf-wrangler', description: 'Turns PDFs into tidy text.', start: ALPHA['plugins/alpha/skills/pdf-wrangler/SKILL.md'], path: 'skills/pdf-wrangler' });
    assert.deepEqual(alpha.items.find(item => item.name === 'lister'), { kind: 'mcp', name: 'lister', description: '', start: JSON.stringify({ url: 'https://example.invalid/mcp' }), runs: 'https://example.invalid/mcp' });
    assert.equal(alpha.commit, w.pin);
    assert.deepEqual(names(kept.text('inside')), ['skill tidy-desk'], 'a plugin kept in its marketplace comes from the catalog’s own read');
    assert.deepEqual(names(kept.text('solo')), ['skill quiet-hours'], 'an unpinned one is read at its tip');
    assert.deepEqual(kept.views.at(-1), { read: 3, of: 4, elsewhere: 3, reading: false }, 'the repository that is not there is the one not read');
    const file = JSON.parse(await readFile(join(w.dataDir, 'plugin-text.json'), 'utf8'));
    assert.equal(file.format, 1);
    assert.deepEqual(file.plugins.map((entry: PluginText) => entry.plugin).sort(), ['alpha', 'inside', 'solo']);
    assert.deepEqual(await readdir(join(w.dataDir, 'text-fetch')).catch(() => []), [], 'no copy of Git is left');
  } finally { await w.close(); }
});

test('A repository that is gone, or a server that declines a filtered fetch, leaves the others read and is said in the log; the declined one costs no download', { skip: noPosix }, async () => {
  const w = await world();
  try {
    await w.writeMarket(w.pin, [{ name: 'unfiltered', source: { source: 'url', url: 'https://example.test/plain.git', path: 'plugins/alpha' } }]);
    const kept = jobOver(w.dataDir, () => [w.market]);
    const began = Date.now();
    await kept.run();
    assert.deepEqual(kept.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside', 'solo']);
    assert.match(kept.logs.join('\n'), /missing\.git at HEAD: No access, or no repository there.*Tried again in 10 minutes\./);
    assert.match(kept.logs.join('\n'), /plain\.git at HEAD: its server declines a filtered fetch, and a whole copy is never taken\./);
    assert.ok((w.proxy.sent.get('plain.git') ?? 0) < 20_000, `the declining server sent ${w.proxy.sent.get('plain.git')} bytes, not its 300 kB`);
    assert.ok(Date.now() - began < 20_000);
    // Run again at once: both wait their turn rather than being asked again.
    const asked = new Map(w.proxy.asked);
    await kept.run();
    assert.equal(w.proxy.asked.get('missing.git'), asked.get('missing.git'));
    assert.equal(w.proxy.asked.get('plain.git'), asked.get('plain.git'));
  } finally { await w.close(); }
});

test('A repository that could not be read is tried again by itself once its wait is over', { skip: noPosix }, async () => {
  const w = await world();
  try {
    let offset = 0;
    const kept = jobOver(w.dataDir, () => [w.market], () => Date.now() + offset);
    w.proxy.hold = 'solo.git';
    kept.job.restart();
    await until(() => kept.logs.some(line => line.includes('missing.git')) && w.proxy.waiting.length > 0, 'the first failure, solo held');
    // Its ten minutes pass before the run ends: the next run comes by itself and asks again.
    offset = 11 * 60_000;
    w.proxy.release();
    await until(() => kept.logs.filter(line => line.includes('missing.git')).length === 2, 'the second try');
    assert.match(kept.logs.filter(line => line.includes('missing.git'))[1]!, /Tried again in 20 minutes\./, 'the wait doubles');
    kept.job.stop();
  } finally { await w.close(); }
});

test('A pin that moves while its fetch runs keeps nothing of that fetch: the new pin is read next', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const moved = await commit(join(w.base, 'src/tools'), { 'plugins/alpha/skills/pdf-wrangler/SKILL.md': '---\nname: pdf-wrangler\ndescription: Turns PDFs into tidy Markdown.\n---\nNew.\n' }, 'moved');
    git(join(w.base, 'src/tools'), 'push', '-q', join(w.served, 'tools.git'), 'main');
    const kept = jobOver(w.dataDir, () => [w.market]);
    w.proxy.hold = 'tools.git';
    kept.job.restart();
    await until(() => w.proxy.waiting.length > 0, 'the fetch to be held');
    await w.writeMarket(moved);
    kept.job.listed([w.market], true);
    const before = kept.ended(), told = kept.keptThen.length;
    w.proxy.release();
    await until(() => kept.ended() > before, 'the run to end');
    const alpha = kept.text('alpha')!;
    assert.equal(alpha.commit, moved);
    assert.ok(kept.keptThen.slice(told).every(texts => texts.every(entry => entry.plugin !== 'alpha' || entry.commit === moved)), 'the old pin’s text was never kept, not even for a moment');
    assert.equal(alpha.items.find(item => item.name === 'pdf-wrangler')?.description, 'Turns PDFs into tidy Markdown.');
  } finally { await w.close(); }
});

test('Refresh during a pin change, then the marketplace’s last alias removed: the late fetch does not bring it back', { skip: noPosix }, async () => {
  const w = await world();
  try {
    let sources = [w.market];
    const kept = jobOver(w.dataDir, () => sources);
    await kept.run();
    const moved = await commit(join(w.base, 'src/tools'), { 'plugins/alpha/agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews twice.\n---\n' }, 'moved');
    git(join(w.base, 'src/tools'), 'push', '-q', join(w.served, 'tools.git'), 'main');
    w.proxy.hold = 'tools.git';
    await w.writeMarket(moved);
    kept.job.listed(sources, true);
    await until(() => w.proxy.waiting.length > 0, 'the late fetch to be held');
    sources = [];
    kept.job.listed(sources, false);
    const before = kept.ended(), told = kept.keptThen.length;
    w.proxy.release();
    await until(() => kept.ended() > before, 'the run to end');
    assert.deepEqual(kept.job.texts(), []);
    assert.ok(kept.keptThen.slice(told).every(texts => texts.every(entry => entry.commit !== moved)), 'the late fetch was never kept, not even for a moment');
    assert.deepEqual(JSON.parse(await readFile(join(w.dataDir, 'plugin-text.json'), 'utf8')).plugins, []);
  } finally { await w.close(); }
});

test('A home switched during a fetch keeps nothing of it for a marketplace the new home does not list', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const other = join(w.base, 'other-market');
    await put(join(other, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'other', plugins: [{ name: 'lamp', source: './lamp' }] }));
    await put(join(other, 'lamp/skills/night-light/SKILL.md'), '---\nname: night-light\ndescription: Dims.\n---\n');
    let sources = [w.market];
    const kept = jobOver(w.dataDir, () => sources);
    w.proxy.hold = 'tools.git';
    kept.job.restart();
    await until(() => w.proxy.waiting.length > 0, 'the fetch to be held');
    sources = [other];
    kept.job.restart();
    w.proxy.release();
    await until(() => kept.text('lamp') !== undefined && !kept.job.view().reading, 'the new home’s run');
    assert.deepEqual(kept.job.texts().map(entry => entry.plugin), ['lamp']);
  } finally { await w.close(); }
});

test('Turned off mid-run, what was read is kept; quit twice within a minute, the next launch has it at once and fetches only what is left', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const first = jobOver(w.dataDir, () => [w.market]);
    w.proxy.hold = 'solo.git';
    first.job.restart();
    await until(() => first.text('alpha') !== undefined && w.proxy.waiting.length > 0, 'alpha read while solo is held');
    first.switch(false);
    first.job.stop();
    w.proxy.release();
    await until(() => !first.job.view().reading && first.ended() > 0, 'the run to stop');
    assert.deepEqual(first.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside']);
    // Quit: a new launch over the same data folder, stopped again at once, then one left to finish.
    const second = jobOver(w.dataDir, () => [w.market]);
    second.job.restart();
    second.job.stop();
    await until(() => second.ended() > 0, 'the second launch to stop');
    const asked = w.proxy.asked.get('tools.git');
    const third = jobOver(w.dataDir, () => [w.market]);
    await third.run();
    assert.deepEqual(third.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside', 'solo']);
    assert.equal(w.proxy.asked.get('tools.git'), asked, 'alpha, read before, is not fetched again');
  } finally { await w.close(); }
});

test('Unchanged, nothing is fetched again; an unpinned repository is looked at again after a day, and only its tree while its tip has not moved', { skip: noPosix }, async () => {
  const w = await world();
  try {
    let clock = Date.now();
    const kept = jobOver(w.dataDir, () => [w.market], () => clock);
    await kept.run();
    const asked = () => ({ tools: w.proxy.asked.get('tools.git') ?? 0, solo: w.proxy.asked.get('solo.git') ?? 0 });
    const first = asked(), soloAt = kept.text('solo')!.readAt;
    await kept.run(() => kept.job.listed([w.market], true));
    assert.deepEqual(asked(), first, 'within the day, a Refresh fetches nothing');
    clock += 25 * 60 * 60_000;
    await kept.run(() => kept.job.listed([w.market], true));
    const later = asked();
    assert.equal(later.tools, first.tools, 'a pinned repository is never looked at again while its pin holds');
    assert.ok(later.solo > first.solo && later.solo - first.solo < first.solo, `the tip looked at, its files not fetched again (${first.solo} requests, then ${later.solo - first.solo})`);
    assert.notEqual(kept.text('solo')!.readAt, soloAt);
  } finally { await w.close(); }
});

test('A plugin its marketplace no longer lists goes, one kept in it follows its edits, and a catalog that cannot be read takes nothing away', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    const catalog = join(w.market, '.claude-plugin/marketplace.json'), listed = JSON.parse(await readFile(catalog, 'utf8'));
    await writeFile(catalog, JSON.stringify({ ...listed, plugins: listed.plugins.filter((plugin: { name: string }) => plugin.name !== 'solo') }));
    await put(join(w.market, 'plugins/inside/skills/tidy-desk/SKILL.md'), '---\nname: tidy-desk\ndescription: Keeps a desk very tidy.\n---\n');
    await kept.run(() => kept.job.listed([w.market], true));
    assert.deepEqual(kept.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside']);
    assert.equal(kept.text('inside')!.items[0]!.description, 'Keeps a desk very tidy.');
    await writeFile(catalog, '{ broken');
    await kept.run(() => kept.job.listed([w.market], true));
    assert.deepEqual(kept.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside'], 'a failed read proves no removal');
  } finally { await w.close(); }
});

test('Two spellings of one marketplace are one: each plugin is kept once', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const alias = join(w.base, 'alias');
    await symlink(w.market, alias);
    const kept = jobOver(w.dataDir, () => [w.market, alias]);
    await kept.run();
    assert.deepEqual(kept.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside', 'solo']);
    assert.deepEqual(kept.views.at(-1), { read: 3, of: 4, elsewhere: 3, reading: false });
  } finally { await w.close(); }
});

test('A kept file that is damaged, or of another format, is thrown away with a line in the log and read again', { skip: noPosix }, async () => {
  const w = await world();
  try {
    await put(join(w.dataDir, 'plugin-text.json'), JSON.stringify({ format: 0, plugins: [] }));
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    assert.match(kept.logs.join('\n'), /plugin-text\.json was damaged or of another format; it is read again/);
    assert.equal(JSON.parse(await readFile(join(w.dataDir, 'plugin-text.json'), 'utf8')).plugins.length, 3);
  } finally { await w.close(); }
});

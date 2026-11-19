// The plugin text (plugintext.ts) on made-up repositories served over Git's smart HTTP (scripts/git-http-fixture.mjs), reached as
// https://example.test/ through Git's own url.insteadOf, so the catalog's addresses are ones the app accepts. Each test reads
// as one worked example of the brief: what is fetched is what the reader finds in a whole copy; a repository that is gone, or a
// server that declines filtering, leaves the rest; a pin that moves, a marketplace removed or a home switched while a fetch
// runs keeps nothing of it; turning it off or quitting keeps what was saved, and the next run goes on from there.
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request as forward, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { searchedParts } from '../src/catalogdetail.ts';
import { readCatalog, runGit } from '../src/plugins.ts';
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

/** The plugin kept in another repository: a skill named unlike its plugin, one through a link inside it, one through a link out of it, agents six levels down, three servers (one in a file named without a suffix). */
const ALPHA = {
  'plugins/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', mcpServers: ['./servers.json', './config/more-servers'] }),
  'plugins/alpha/skills/pdf-wrangler/SKILL.md': '---\nname: pdf-wrangler\ndescription: Turns PDFs into tidy text.\n---\nRead the PDF, then write it out as plain text.\n',
  'plugins/alpha/docs/shared.md': '---\nname: shared-notes\ndescription: Notes kept beside the skills.\n---\nShared body.\n',
  'plugins/alpha/skills/linked/SKILL.md': '->../../docs/shared.md',
  'plugins/alpha/skills/escape/SKILL.md': '->../../../../outside.md',
  'plugins/alpha/agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews a change.\n---\nAgent body.\n',
  'plugins/alpha/agents/deep/er/digger.md': '---\ndescription: Digs deep.\n---\nDeep.\n',
  'plugins/alpha/.mcp.json': JSON.stringify({ mcpServers: { fetcher: { command: 'npx', args: ['fetch-server'] } } }),
  'plugins/alpha/servers.json': JSON.stringify({ lister: { url: 'https://example.invalid/mcp' } }),
  'plugins/alpha/config/more-servers': JSON.stringify({ helper: { command: 'helper-tool' } }),
  'outside.md': '---\nname: outside\ndescription: Not the plugin’s.\n---\n',
  // A plugin whose manifest is a link to a file beside it, naming its servers' file.
  'plugins/linked/.claude-plugin/plugin.json': '->../manifest.json',
  'plugins/linked/manifest.json': JSON.stringify({ name: 'linked', mcpServers: './servers.json' }),
  'plugins/linked/servers.json': JSON.stringify({ 'linked-server': { command: 'linked-tool' } }),
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
  /** Serves the repository in `src/<name>` as `<name>.git`, filtering. */
  const serve = (name: string) => { git(base, 'clone', '-q', '--bare', join(base, 'src', name), join(served, `${name}.git`)); git(join(served, `${name}.git`), 'config', 'uploadpack.allowFilter', 'true'); };
  return {
    base, market, pin, served, proxy, writeMarket, serve, gitconfig, dataDir: join(base, 'data'),
    async close() { proxy.server.close(); await stopped(fixture); process.env.GIT_CONFIG_GLOBAL = saved; await rm(base, { recursive: true, force: true }); },
  };
}

/**
 * Forwards to the fixture; requests for a repository named in `hold` (one, or several) wait until `release`; a repository in
 * `failNext` gets a 502 once, after letting that many of its requests through; `asked` counts requests and `sent` bytes, by repository.
 */
function holdingProxy(target: string) {
  const waiting: (() => void)[] = [];
  const state = { hold: '' as string | string[], failNext: new Map<string, number>(), asked: new Map<string, number>(), sent: new Map<string, number>(), waiting, server: undefined as unknown as Server,
    release() { state.hold = ''; waiting.splice(0).forEach(go => go()); } };
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
    const through = state.failNext.get(repo);
    if (through !== undefined && state.asked.get(repo)! > through) { state.failNext.delete(repo); response.writeHead(502).end('gateway unavailable'); }
    else if (repo && [state.hold].flat().includes(repo)) waiting.push(go); else go();
  });
  return state;
}
function stopped(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
  return new Promise(done => { server.once('exit', () => done()); server.kill(); });
}
/** The process groups of the git commands this test process has running now (each runs in a group of its own: plugins.ts run). */
function gitGroups(): Set<number> {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,pgid=,args='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [pid, ppid, pgid, ...args] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), args: args.join(' ') };
  });
  const ours = new Set([process.pid]);
  for (let grew = true; grew;) { grew = false; for (const row of rows) if (ours.has(row.ppid) && !ours.has(row.pid)) { ours.add(row.pid); grew = true; } }
  const own = rows.find(row => row.pid === process.pid)!.pgid;
  return new Set(rows.filter(row => ours.has(row.pid) && row.pgid !== own && /(^|\/)git[\s-]/.test(row.args)).map(row => row.pgid));
}
/** Whatever is still running in these process groups. */
const groupsLeft = (groups: Set<number>) => execFileSync('ps', ['-eo', 'pgid='], { encoding: 'utf8' }).split('\n').map(Number).filter(pgid => groups.has(pgid));
const until = async (ok: () => boolean, what: string) => { for (let tries = 0; tries < 600 && !ok(); tries++) await new Promise(done => setTimeout(done, 25)); assert.ok(ok(), `waited for ${what}`); };

/** A job over these sources (all read, unless `complete` says not), with what it said: each view and what was kept when it said it, each finished run, its log. */
function jobOver(dataDir: string, sources: () => string[] | undefined, now = Date.now, complete = () => true) {
  const views: PluginTextView[] = [], keptThen: PluginText[][] = [], logs: string[] = [];
  let on = true, ends = 0;
  const listed = () => { const now = sources(); return now && { sources: now, complete: complete() }; };
  const job = pluginTextJob({ dataDir, on: () => on, listings: async () => listed(), log: line => logs.push(line), now,
    changed: view => { views.push(view); keptThen.push(job.texts()); if (!view.reading) ends++; } });
  return {
    job, views, keptThen, logs, switch(value: boolean) { on = value; },
    /** The marketplaces listed again, as the Plugins page does: `fresh` as after a Refresh. */
    tell: (fresh = true) => job.listed(listed()!, fresh),
    /** Starts (or restarts) and waits for that run to end. */
    async run(start = () => job.restart()) { const before = ends; start(); await until(() => ends > before, 'the run to end'); },
    ended: () => ends,
    text: (plugin: string) => job.texts().find(entry => entry.plugin === plugin),
  };
}
const names = (entry: PluginText | undefined) => entry?.items.map(item => `${item.kind} ${item.name}`).sort();
const saved = async (dataDir: string) => (JSON.parse(await readFile(join(dataDir, 'plugin-text.json'), 'utf8')).plugins as PluginText[]).map(entry => entry.plugin).sort();
/** A second marketplace folder, for another home: one plugin kept in it. */
async function lampMarket(base: string) {
  const other = join(base, 'other-market');
  await put(join(other, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'other', plugins: [{ name: 'lamp', source: './lamp' }] }));
  await put(join(other, 'lamp/skills/night-light/SKILL.md'), '---\nname: night-light\ndescription: Dims.\n---\n');
  return other;
}

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
    assert.deepEqual(names(alpha), ['agent digger', 'agent reviewer', 'mcp fetcher', 'mcp helper', 'mcp lister', 'skill pdf-wrangler', 'skill shared-notes'], 'a link out of the plugin’s folder is not followed; a server file the manifest names is read whatever its suffix');
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
    assert.equal(await readdir(join(w.dataDir, 'text-fetch')).catch(() => 'none'), 'none', 'no copy of Git is left, nor its folder');
  } finally { await w.close(); }
});

test('A repository that is gone, or a server that declines a filtered fetch, leaves the others read and is said in the log; the declined one costs no download', { skip: noPosix }, async () => {
  const w = await world();
  try {
    await w.writeMarket(w.pin, [{ name: 'unfiltered', source: { source: 'url', url: 'https://example.test/plain.git', path: 'plugins/alpha' } },
      { name: 'absent', source: { source: 'url', url: 'https://example.test/tools.git', path: 'plugins/absent', sha: w.pin } }]);
    const kept = jobOver(w.dataDir, () => [w.market]);
    const began = Date.now();
    await kept.run();
    assert.deepEqual(kept.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside', 'solo']);
    assert.match(kept.logs.join('\n'), /absent: its folder is not in the repository at that commit\./, 'a folder that is not there is a read that failed, not one with nothing in it');
    assert.deepEqual(kept.views.at(-1), { read: 3, of: 6, elsewhere: 5, reading: false });
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

test('A repository is fetched only once its server has said it filters: one that could not be asked is not fetched, and waits its turn', { skip: noPosix }, async () => {
  const w = await world();
  try {
    await put(join(w.market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'made-up', plugins: [{ name: 'unfiltered', source: { source: 'url', url: 'https://example.test/plain.git', path: 'plugins/alpha' } }] }));
    w.proxy.failNext.set('plain.git', 0);
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    assert.equal(w.proxy.asked.get('plain.git'), 1, 'one request in all: the question, answered 502');
    assert.match(kept.logs.join('\n'), /plain\.git at HEAD: .*Tried again in 10 minutes\./);
    assert.deepEqual(kept.views.at(-1), { read: 0, of: 1, elsewhere: 1, reading: false });
  } finally { await w.close(); }
});

test('Refresh tries again at once a repository that could not be read, without forgetting how often it failed', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    assert.equal(kept.text('gone'), undefined);
    // Still gone at Refresh: asked again at once, and its wait doubles, as for any failure after the first.
    await kept.run(() => kept.tell());
    assert.match(kept.logs.filter(line => line.includes('missing.git')).at(-1)!, /Tried again in 20 minutes\./);
    // It comes back; within its wait, Refresh asks for it again.
    await rename(join(w.base, 'src/solo'), join(w.base, 'src/missing'));
    w.serve('missing');
    const asked = w.proxy.asked.get('missing.git')!;
    await kept.run(() => kept.tell());
    assert.ok(w.proxy.asked.get('missing.git')! > asked);
    assert.deepEqual(names(kept.text('gone')), ['skill quiet-hours']);
  } finally { await w.close(); }
});

test('A repository that keeps failing does not wake the job again before its wait is over', { skip: noPosix }, async () => {
  const w = await world();
  try {
    let offset = 0;
    const kept = jobOver(w.dataDir, () => [w.market], () => Date.now() + offset);
    await kept.run();
    // A day later solo's check fails too (its server is gone): its read is a day old, but it waits ten minutes like any failure.
    await rename(join(w.served, 'solo.git'), join(w.served, 'solo-away.git'));
    offset = 25 * 60 * 60_000;
    await kept.run(() => kept.tell());
    assert.match(kept.logs.join('\n'), /solo\.git at HEAD: .*Tried again in 10 minutes\./);
    const ends = kept.ended();
    await new Promise(done => setTimeout(done, 3000));
    assert.equal(kept.ended(), ends, 'no run came by itself in the next three seconds');
    await kept.job.stop();
  } finally { await w.close(); }
});

test('What is outstanding follows the listing: a fetch not yet begun for a marketplace removed meanwhile is never made', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const many = join(w.base, 'many'), plugins: object[] = [];
    for (let n = 0; n < 9; n++) {
      const pin = await commit(join(w.base, 'src', `r${n}`), { [`skills/s${n}/SKILL.md`]: `---\nname: s${n}\ndescription: Skill ${n}.\n---\n` });
      w.serve(`r${n}`);
      plugins.push({ name: `p${n}`, source: { source: 'url', url: `https://example.test/r${n}.git`, sha: pin } });
    }
    await put(join(many, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'many', plugins }));
    let sources = [many];
    const kept = jobOver(w.dataDir, () => sources);
    w.proxy.hold = plugins.slice(0, 8).map((_, n) => `r${n}.git`);
    kept.job.restart();
    await until(() => w.proxy.waiting.length === 8, 'eight fetches held, the ninth waiting its turn');
    sources = [];
    kept.tell(false);
    const before = kept.ended();
    w.proxy.release();
    await until(() => kept.ended() > before, 'the run to end');
    assert.equal(w.proxy.asked.get('r8.git'), undefined, 'the ninth, not begun when its marketplace went, is never asked for');
    assert.deepEqual(kept.job.texts(), []);
  } finally { await w.close(); }
});

test('A home switched while the first home’s marketplaces are still being asked for never brings the first home’s back', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const other = await lampMarket(w.base);
    const answers: ((listed: { sources: string[]; complete: boolean }) => void)[] = [];
    let ends = 0;
    const job = pluginTextJob({ dataDir: w.dataDir, on: () => true, log: () => {}, listings: () => new Promise(done => answers.push(done)), changed: view => { if (!view.reading) ends++; } });
    job.restart();
    await until(() => answers.length === 1, 'the first home asked for');
    job.restart();
    answers[0]!({ sources: [w.market], complete: true });
    await until(() => answers.length === 2, 'the second home asked for');
    answers[1]!({ sources: [other], complete: true });
    await until(() => ends > 0 && job.texts().length > 0, 'the second home’s run');
    assert.deepEqual(job.texts().map(entry => entry.plugin), ['lamp']);
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
    await kept.job.stop();
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
    kept.tell();
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
    kept.tell();
    await until(() => w.proxy.waiting.length > 0, 'the late fetch to be held');
    // Until the new pin is read, the text read at the old one is still given (for finding a skill, better than none); the count leaves it out.
    assert.equal(kept.text('alpha')?.commit, w.pin);
    assert.deepEqual(kept.job.view(), { read: 2, of: 4, elsewhere: 3, reading: true });
    sources = [];
    kept.tell(false);
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
    const other = await lampMarket(w.base);
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

test('Quit stops git and every helper it started, leaves no temporary repository, and saves what had finished; the next launch has it at once and fetches only what is left', { skip: noPosix }, async () => {
  const w = await world();
  try {
    const first = jobOver(w.dataDir, () => [w.market]);
    w.proxy.hold = 'solo.git';
    first.job.restart();
    await until(() => first.text('alpha') !== undefined && w.proxy.waiting.length > 0, 'alpha read while solo is held');
    const held = gitGroups();
    assert.ok(held.size > 0, 'the held fetch’s git is running, in a group of its own');
    await first.job.stop();
    await until(() => groupsLeft(held).length === 0, 'nothing left of the held fetch’s group');
    assert.equal(await readdir(join(w.dataDir, 'text-fetch')).catch(() => 'none'), 'none', 'no temporary repository, nor its folder');
    assert.deepEqual(await saved(w.dataDir), ['alpha', 'inside'], 'what had finished was saved before it stopped');
    w.proxy.release();
    const asked = w.proxy.asked.get('tools.git');
    const next = jobOver(w.dataDir, () => [w.market]);
    await next.run();
    assert.deepEqual(next.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside', 'solo']);
    assert.equal(w.proxy.asked.get('tools.git'), asked, 'alpha, saved before, is not fetched again');
  } finally { await w.close(); }
});

test('A git run that times out, or is cancelled, ends with every process it started; git ending with its input unread is no error here', { skip: noPosix }, async () => {
  const w = await world();
  try {
    w.proxy.hold = 'solo.git';
    const ask = (options = {}) => runGit(['ls-remote', '--', 'https://example.test/solo.git', 'HEAD'], 1500, options);
    const timing = ask();
    await until(() => w.proxy.waiting.length === 1, 'the first run held');
    const first = gitGroups();
    assert.equal((await timing).code, 'timeout');
    await until(() => groupsLeft(first).length === 0, 'nothing left of its group after a timeout');
    const cancel = new AbortController(), asking = ask({ signal: cancel.signal });
    await until(() => w.proxy.waiting.length === 2, 'the second run held');
    const second = gitGroups();
    cancel.abort();
    assert.equal((await asking).code, 'timeout', 'a cancelled run reads as one that timed out');
    await until(() => groupsLeft(second).length === 0, 'nothing left of its group after a cancel');
    w.proxy.release();
    assert.equal((await runGit(['--version'], 5000, { input: Buffer.alloc(16 * 1024 * 1024) })).code, 0);
  } finally { await w.close(); }
});

test('What was read is there whether the switch is on or off: matched to what is listed, with nothing fetched while it is off', { skip: noPosix }, async () => {
  const w = await world();
  try {
    await jobOver(w.dataDir, () => [w.market]).run();
    const asked = JSON.stringify([...w.proxy.asked]);
    let sources = [w.market];
    const off = jobOver(w.dataDir, () => sources);
    off.switch(false);
    await off.run();
    assert.deepEqual(off.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside', 'solo'], 'a launch with it off has what was read');
    assert.deepEqual(off.job.view(), { read: 3, of: 4, elsewhere: 3, reading: false });
    sources = [await lampMarket(w.base)];
    await off.run();
    assert.deepEqual(off.job.texts().map(entry => entry.plugin), ['lamp'], 'another home, while off: the first home’s text goes');
    assert.equal(JSON.stringify([...w.proxy.asked]), asked, 'nothing was fetched while off');
  } finally { await w.close(); }
});

test('A listing that could not be read whole takes nothing away', { skip: noPosix }, async () => {
  const w = await world();
  try {
    let sources = [w.market], complete = true;
    const kept = jobOver(w.dataDir, () => sources, Date.now, () => complete);
    await kept.run();
    // Central Knot's own list of added marketplaces (or a tool's) could not be read: this one seems not listed.
    sources = []; complete = false;
    await kept.run(() => kept.tell(false));
    assert.deepEqual(kept.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside', 'solo']);
    complete = true;
    await kept.run(() => kept.tell(false));
    assert.deepEqual(kept.job.texts(), [], 'read whole, it is not listed: its plugins go');
  } finally { await w.close(); }
});

test('A marketplace whose catalog the Plugins page fetched first is read when the page lists it again', { skip: noPosix }, async () => {
  const w = await world();
  try {
    git(w.market, 'init', '-q', '-b', 'main'); git(w.market, 'add', '-A'); git(w.market, 'commit', '-qm', 'catalog');
    git(w.base, 'clone', '-q', '--bare', w.market, join(w.served, 'market.git'));
    const source = 'https://example.test/market.git';
    const kept = jobOver(w.dataDir, () => [source]);
    await kept.run();
    assert.deepEqual(kept.views.at(-1), { read: 0, of: 0, elsewhere: 0, reading: false }, 'no copy of its catalog yet');
    assert.equal((await readCatalog({ home: w.base, dataDir: w.dataDir, binaries: {} }, source)).problem, undefined, 'the page’s own read');
    await kept.run(() => kept.tell(false));
    assert.deepEqual(kept.views.at(-1), { read: 3, of: 4, elsewhere: 3, reading: false });
  } finally { await w.close(); }
});

test('A save that failed is made at the next chance, quitting included', { skip: noPosix || (process.getuid?.() === 0 && 'as root a folder made read-only can still be written, so no save fails') }, async () => {
  const w = await world();
  try {
    const kept = jobOver(w.dataDir, () => [w.market]);
    w.proxy.hold = 'solo.git';
    kept.job.restart();
    await until(() => kept.text('alpha') !== undefined && w.proxy.waiting.length > 0, 'alpha read (its fetch made the data folder), solo held');
    await chmod(w.dataDir, 0o555);
    try {
      w.proxy.release();
      await until(() => kept.logs.some(line => line.includes('not saved')) && !kept.job.view().reading, 'the save refused');
    } finally { await chmod(w.dataDir, 0o755); }
    // The next chance is quitting.
    await kept.job.stop();
    assert.deepEqual(await saved(w.dataDir), ['alpha', 'inside', 'solo']);
  } finally { await w.close(); }
});

test('Unchanged, nothing is fetched again; an unpinned repository is read again after a day', { skip: noPosix }, async () => {
  const w = await world();
  try {
    let clock = Date.now();
    const kept = jobOver(w.dataDir, () => [w.market], () => clock);
    await kept.run();
    const asked = () => ({ tools: w.proxy.asked.get('tools.git') ?? 0, solo: w.proxy.asked.get('solo.git') ?? 0 });
    const first = asked(), soloAt = kept.text('solo')!.readAt;
    await kept.run(() => kept.tell());
    assert.deepEqual(asked(), first, 'within the day, a Refresh fetches nothing');
    clock += 25 * 60 * 60_000;
    await kept.run(() => kept.tell());
    const later = asked();
    assert.equal(later.tools, first.tools, 'a pinned repository is never looked at again while its pin holds');
    assert.ok(later.solo > first.solo, 'the unpinned one is read again');
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
    await kept.run(() => kept.tell());
    assert.deepEqual(kept.job.texts().map(entry => entry.plugin).sort(), ['alpha', 'inside']);
    assert.equal(kept.text('inside')!.items[0]!.description, 'Keeps a desk very tidy.');
    await writeFile(catalog, '{ broken');
    await kept.run(() => kept.tell());
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

test('A kept file of another format is thrown away with a line in the log and read again; an entry not of the kept shape (an item without its kind or text, a kind that only coerces to one, a date that is no date) is dropped and read again, the rest kept', { skip: noPosix }, async () => {
  const w = await world();
  try {
    await put(join(w.dataDir, 'plugin-text.json'), JSON.stringify({ format: 0, plugins: [] }));
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    assert.match(kept.logs.join('\n'), /plugin-text\.json was damaged or of another format; it is read again/);
    assert.deepEqual(await saved(w.dataDir), ['alpha', 'inside', 'solo']);
    // One entry's item loses its kind and its text (a hand edit, say).
    const file = JSON.parse(await readFile(join(w.dataDir, 'plugin-text.json'), 'utf8'));
    file.plugins.find((entry: PluginText) => entry.plugin === 'solo').items = [{ name: 'quiet-hours' }];
    await put(join(w.dataDir, 'plugin-text.json'), JSON.stringify(file));
    const asked = { tools: w.proxy.asked.get('tools.git'), solo: w.proxy.asked.get('solo.git')! };
    const next = jobOver(w.dataDir, () => [w.market]);
    await next.run();
    assert.equal(next.text('solo')!.items[0]!.kind, 'skill');
    assert.ok(w.proxy.asked.get('solo.git')! > asked.solo, 'the damaged entry is read again');
    assert.equal(w.proxy.asked.get('tools.git'), asked.tools, 'the others are kept as they were');
    // A kind that only coerces to one of the three, and a date that is no date, are not of the kept shape either.
    // (On the pinned plugin, which nothing else would read again.)
    for (const damage of [(entry: PluginText) => { (entry.items[0] as { kind: unknown }).kind = ['skill']; }, (entry: PluginText) => { entry.readAt = 'yesterday'; }]) {
      const now = JSON.parse(await readFile(join(w.dataDir, 'plugin-text.json'), 'utf8'));
      damage(now.plugins.find((entry: PluginText) => entry.plugin === 'alpha'));
      await put(join(w.dataDir, 'plugin-text.json'), JSON.stringify(now));
      const before = w.proxy.asked.get('tools.git')!, again = jobOver(w.dataDir, () => [w.market]);
      await again.run();
      assert.ok(w.proxy.asked.get('tools.git')! > before, 'read again');
      assert.ok(again.text('alpha')!.items.every(item => typeof item.kind === 'string') && !Number.isNaN(Date.parse(again.text('alpha')!.readAt)));
    }
  } finally { await w.close(); }
});

test('A server is taken to filter only when a probe that ended well received the capability itself: a non-filtering server whose default branch is named filter is not fetched from, nor a filtering one whose probe ended badly', { skip: noPosix }, async () => {
  const w = await world();
  try {
    // Served without filtering, its default branch named "filter"; asked with protocol v0, whose advertisement names the branch beside the capabilities.
    git(w.base, 'clone', '-q', '--bare', join(w.base, 'src/tools'), join(w.served, 'branchy.git'));
    git(join(w.served, 'branchy.git'), 'branch', '-m', 'main', 'filter');
    git(join(w.served, 'branchy.git'), 'symbolic-ref', 'HEAD', 'refs/heads/filter');
    await writeFile(w.gitconfig, `${await readFile(w.gitconfig, 'utf8')}[protocol]\n\tversion = 0\n`);
    await put(join(w.market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'made-up', plugins: [{ name: 'branchy', source: { source: 'url', url: 'https://example.test/branchy.git', path: 'plugins/alpha' } }] }));
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    assert.equal(w.proxy.asked.get('branchy.git'), 1, 'one request in all: the question');
    assert.match(kept.logs.join('\n'), /branchy\.git at HEAD: its server declines a filtered fetch/);
    // A server that filters, whose probe ends badly after it was told so (its list of refs answered 502): not fetched from either.
    await writeFile(w.gitconfig, (await readFile(w.gitconfig, 'utf8')).replace('[protocol]\n\tversion = 0\n', ''));
    await put(join(w.market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'made-up', plugins: [{ name: 'alpha', source: { source: 'url', url: 'https://example.test/tools.git', path: 'plugins/alpha', sha: w.pin } }] }));
    w.proxy.failNext.set('tools.git', 1);
    await kept.run(() => kept.tell());
    assert.equal(w.proxy.asked.get('tools.git'), 2, 'the probe’s two requests, the second answered 502, and nothing more');
    assert.equal(kept.text('alpha'), undefined);
  } finally { await w.close(); }
});

test('A plugin’s folder that is a file is a failed read; a manifest that is a link is read through it, and the servers it names are found', { skip: noPosix }, async () => {
  const w = await world();
  try {
    await put(join(w.market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'made-up', plugins: [
      { name: 'linked', source: { source: 'url', url: 'https://example.test/tools.git', path: 'plugins/linked', sha: w.pin } },
      { name: 'a-file', source: { source: 'url', url: 'https://example.test/tools.git', path: 'outside.md', sha: w.pin } },
    ] }));
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    assert.deepEqual(names(kept.text('linked')), ['mcp linked-server']);
    assert.equal(kept.text('a-file'), undefined);
    assert.match(kept.logs.join('\n'), /a-file: its folder is not in the repository at that commit\./);
  } finally { await w.close(); }
});

test('A catalog that arrives while the listing is being read is not missed; a copy that will not read is not read again at every telling', { skip: noPosix }, async () => {
  const w = await world();
  try {
    // A marketplace with many plugins in it, slow to read, after one whose catalog has no copy here yet.
    const big = join(w.base, 'big'), plugins: object[] = [];
    for (let n = 0; n < 400; n++) { plugins.push({ name: `b${n}`, source: `./p${n}` }); await put(join(big, `p${n}/skills/s${n}/SKILL.md`), `---\nname: s${n}\ndescription: Skill ${n}.\n---\n`); }
    await put(join(big, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'big', plugins }));
    git(w.market, 'init', '-q', '-b', 'main'); git(w.market, 'add', '-A'); git(w.market, 'commit', '-qm', 'catalog');
    git(w.base, 'clone', '-q', '--bare', w.market, join(w.served, 'market.git'));
    const source = 'https://example.test/market.git', listed = { sources: [source, big], complete: true };
    // Its copy, made aside by the page's own read, is put in place while the job reads the big one.
    const aside = join(w.base, 'aside');
    assert.equal((await readCatalog({ home: w.base, dataDir: aside, binaries: {} }, source)).problem, undefined);
    let asked = 0, ends = 0, last: PluginTextView | undefined;
    const job = pluginTextJob({ dataDir: w.dataDir, on: () => true, log: () => {}, listings: async () => { asked++; return listed; }, changed: view => { last = view; if (!view.reading) ends++; } });
    job.restart();
    await until(() => asked === 1, 'the listing asked for');
    await new Promise(done => setTimeout(done, 30));
    await mkdir(join(w.dataDir, 'catalogs'), { recursive: true });
    const copy = (await readdir(join(aside, 'catalogs')))[0]!;
    await rename(join(aside, 'catalogs', copy), join(w.dataDir, 'catalogs', copy));
    job.listed(listed, false);
    await until(() => ends > 0 && !job.view().reading, 'the run');
    assert.equal(last!.of, 404, 'the four of the marketplace whose copy arrived are counted with the 400');
    // A copy that will not read: each telling of the same listing is not a new read.
    await writeFile(join(w.dataDir, 'catalogs', copy, '.claude-plugin/marketplace.json'), '{ broken');
    await new Promise(done => { job.listed(listed, true); setTimeout(done, 1500); });
    const runs = ends;
    job.listed(listed, false);
    await new Promise(done => setTimeout(done, 1500));
    assert.equal(ends, runs, 'no new read for a copy that was there, unread, last time');
    await job.stop();
  } finally { await w.close(); }
});

test('A date far ahead (a clock set back) does not run the timer again and again', { skip: noPosix }, async () => {
  const w = await world();
  try {
    // Without the repository that is not there, solo's day (far ahead) is the first thing due.
    const catalog = join(w.market, '.claude-plugin/marketplace.json'), listed = JSON.parse(await readFile(catalog, 'utf8'));
    await writeFile(catalog, JSON.stringify({ ...listed, plugins: listed.plugins.filter((plugin: { name: string }) => plugin.name !== 'gone') }));
    await jobOver(w.dataDir, () => [w.market]).run();
    const file = JSON.parse(await readFile(join(w.dataDir, 'plugin-text.json'), 'utf8'));
    file.plugins.find((entry: PluginText) => entry.plugin === 'solo').readAt = '2100-01-01T00:00:00.000Z';
    await put(join(w.dataDir, 'plugin-text.json'), JSON.stringify(file));
    const kept = jobOver(w.dataDir, () => [w.market]);
    await kept.run();
    const ends = kept.ended();
    await new Promise(done => setTimeout(done, 2000));
    assert.equal(kept.ended(), ends, 'no run came by itself in the next two seconds');
    await kept.job.stop();
  } finally { await w.close(); }
});

test('runGit keeps what came before its output limit, and a timeout of zero is no limit, as they were before it ran git in a group of its own', async () => {
  const cut = await runGit(['--version'], 5000, { maxBytes: 10 });
  assert.deepEqual([cut.code, cut.stdout.toString('utf8')], [1, 'git versio']);
  assert.match(cut.output, /^git versio\n\(output cut: more than .* MB\)$/);
  // A command that takes 300 ms (a git alias for sleep): with no limit it ends well.
  assert.equal((await runGit(['-c', 'alias.wait=!sleep 0.3', 'wait'], 0)).code, 0);
});

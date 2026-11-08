// Drives the real app end to end over its debug port, in a throwaway HOME, so "This Mac's home" is disposable too.
// Usage: node scripts/e2e.mjs [--electron] [--no-sandbox] [--shots dir] [--crash-rounds n]
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const shots = option('--shots');
const crashRounds = Number(option('--crash-rounds', 6));
const canWriteRealHome = process.platform === 'darwin';
const root = resolve(import.meta.dirname, '..');
const packaged = join(root, 'release/Central Knot-darwin-arm64/Central Knot.app/Contents/MacOS/Central Knot');
const command = flag('--electron') ? join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim()) : packaged;

// ---------- Checks ----------
const failures = [];
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures.push(name);
  console.error(`FAIL ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)?.slice(0, 500)}`}`);
}
const same = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

// ---------- Disposable home ----------
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ck-e2e-')));
const HOME = join(scratch, 'home');
const CLAUDE = join(HOME, '.claude/skills'), COPILOT = join(HOME, '.copilot/skills'), AGENTS = join(HOME, '.agents/skills');
const text = (name, body = 'Body.', extra = '') => `---\nname: ${name}\ndescription: The ${name} skill.\n${extra}---\n\n${body}\n`;
function skill(base, folder, content = text(folder)) {
  const directory = join(base, folder);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), content);
  return directory;
}
function tree(directory, options = {}) {
  const out = {};
  const visit = current => {
    for (const name of readdirSync(current).sort()) {
      if (name === '.git' && !options.git) continue;
      const path = join(current, name), info = lstatSync(path), key = relative(directory, path);
      if (info.isSymbolicLink()) out[key] = `link:${readlinkSync(path)}`;
      else if (info.isDirectory()) { out[key] = 'dir'; visit(path); }
      else out[key] = `${info.mode & 0o777}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    }
  };
  visit(directory);
  return out;
}
function seedHome() {
  const rich = skill(CLAUDE, 'rich', text('rich', 'Values stay as they are: api_key=abc123'));
  mkdirSync(join(rich, 'scripts'));
  writeFileSync(join(rich, 'scripts/run.sh'), '#!/bin/sh\necho hi\n');
  chmodSync(join(rich, 'scripts/run.sh'), 0o755);
  writeFileSync(join(rich, 'asset.bin'), Buffer.from([0, 1, 2, 254, 255]));
  mkdirSync(join(rich, 'empty-folder'));
  mkdirSync(join(rich, '.git'));
  writeFileSync(join(rich, '.git/HEAD'), 'ref: refs/heads/main\n');
  skill(CLAUDE, '名前-skill', text('名前-skill', '日本語の本文。'));
  skill(CLAUDE, 'scoped', text('scoped', 'Body.', 'paths: ["src/**"]\n'));
  skill(CLAUDE, 'plain', 'No frontmatter at all.\n');
  skill(CLAUDE, 'private-one');
  skill(CLAUDE, '.dot-skill');
  skill(CLAUDE, 'bad-yaml', '---\nname: [unclosed\n---\nBody\n');
  skill(CLAUDE, 'clash', text('clash', 'Claude version.'));
  skill(COPILOT, 'clash', text('clash', 'Copilot version.'));
  skill(CLAUDE, 'twin');
  skill(COPILOT, 'twin');
  skill(COPILOT, 'from-copilot');
  const held = skill(CLAUDE, 'has-link');
  symlinkSync('SKILL.md', join(held, 'alias'));
  const shared = skill(AGENTS, 'linked');
  symlinkSync(shared, join(CLAUDE, 'linked'));
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['copilot', 'GitHub Copilot CLI 1.0.107.']]) {
    writeFileSync(join(HOME, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`);
    chmodSync(join(HOME, '.local/bin', name), 0o755);
  }
  writeFileSync(join(HOME, '.claude/unrelated.json'), '{ "keep":   "these bytes" }\n');
  skill(CLAUDE, `very-long-${'n'.repeat(150)}`);
  const locked = skill(CLAUDE, 'read-only-inside');
  mkdirSync(join(locked, 'refs'));
  writeFileSync(join(locked, 'refs/a.md'), 'a');
  chmodSync(join(locked, 'refs'), 0o555);
  const hidden = skill(CLAUDE, 'unreadable-file');
  writeFileSync(join(hidden, 'secret-bits.md'), 'x');
  chmodSync(join(hidden, 'secret-bits.md'), 0o000);
}

// ---------- App ----------
let app;
async function launch(userData = join(scratch, 'data')) {
  const port = 9400 + randomInt(500);
  const env = { HOME, PATH: '/usr/bin:/bin', TMPDIR: join(scratch, 'tmp') };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  const child = spawn(command, [...(flag('--electron') ? [root] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ...(flag('--no-sandbox') ? ['--no-sandbox'] : [])], { env, stdio: 'ignore' });
  let targets;
  for (let attempt = 0; attempt < 150 && !targets; attempt++) {
    await wait(200);
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(target => target.type === 'page'); if (!targets.length) targets = undefined; } catch { /* still starting */ }
  }
  if (!targets) { child.kill('SIGKILL'); throw new Error('The app did not open a debug port.'); }
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const pending = new Map();
  const pageErrors = [];
  let id = 0;
  socket.onmessage = message => {
    const data = JSON.parse(message.data);
    if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
    if (data.method === 'Runtime.exceptionThrown') pageErrors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
    if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') pageErrors.push(data.params.entry.text);
  };
  const send = (method, params = {}) => new Promise(done => { const key = ++id; pending.set(key, done); socket.send(JSON.stringify({ id: key, method, params })); });
  await send('Runtime.enable');
  await send('Log.enable');
  const run = async expression => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
    return reply.result.result.value;
  };
  const settle = async () => { await wait(120); await run(`new Promise(done => { const c = () => (document.body.dataset.ready === 'true' || document.querySelector('.mx,.empty-state')) && document.body.dataset.busy !== 'true' ? done(true) : setTimeout(c, 25); c(); })`); await wait(60); };
  app = {
    child, run, send, settle, pageErrors,
    click: async selector => { await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); e.click(); })()`); await settle(); },
    exists: selector => run(`!!document.querySelector(${JSON.stringify(selector)})`),
    text: selector => run(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`),
    all: (selector, field = 'e.textContent') => run(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(e => ${field})`),
    press: async (key, code = key) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, text: type === 'keyDown' && key.length === 1 ? key : undefined }); await settle(); },
    shot: async name => { if (!shots) return; const reply = await send('Page.captureScreenshot', { format: 'png' }); mkdirSync(shots, { recursive: true }); writeFileSync(join(shots, `${name}.png`), Buffer.from(reply.result.data, 'base64')); },
    expand: async () => { await run(`[...document.querySelectorAll('button')].filter(b => /^Show \\d+ skill/.test(b.textContent.trim()) && b.getAttribute('aria-expanded') !== 'true').forEach(b => b.click())`); await settle(); },
    plan: () => run(`Object.fromEntries([...document.querySelectorAll('.plan-card')].map(e => [e.dataset.key, e.dataset.state]))`),
    quit: async () => { socket.close(); child.kill('SIGTERM'); await new Promise(done => { child.once('exit', done); setTimeout(done, 5000); }); },
    crash: () => new Promise(done => { socket.close(); child.once('exit', done); child.kill('SIGKILL'); }),
  };
  await settle();
  return app;
}

// ---------- Flows ----------
const rowKeys = a => a.all('.ov-row[data-key]', 'e.dataset.key');
const cellState = (a, key, tool) => a.run(`document.querySelector('.ov-row[data-key=${JSON.stringify(key)}] [data-tool=${JSON.stringify(tool)}] .cell-button')?.dataset.state ?? null`);
const switchOn = (a, key) => a.run(`document.querySelector('.ov-row[data-key=${JSON.stringify(key)}] .switch')?.getAttribute('aria-checked') === 'true'`);
const applyAll = async a => { await a.click('#apply'); await a.settle(); };

async function practiceFlow() {
  const a = await launch();
  same('opens on the practice copy', await a.text('#home-label'), 'Practice copy');
  same('rows', (await rowKeys(a)).sort(), ['notes', 'release-notes', 'review', 'standup']);
  same('nothing is managed at first', await Promise.all(['notes', 'release-notes', 'review', 'standup'].map(key => switchOn(a, key))), [false, false, false, false]);
  same('cells say what each tool has', [await cellState(a, 'release-notes', 'claude-cli'), await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'review', 'copilot-cli')], ['present', 'absent', 'present-differs']);
  check('copies differ is flagged', await a.exists('#decide-review'));
  await a.shot('practice-overview');
  const practice = await a.run(`document.querySelector('.status-home').title`);
  check('practice home is not the disposable real home', practice !== HOME && existsSync(practice), practice);
  const reviewClaude = readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8');
  const reviewCopilot = readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8');

  // Manage all, then Discard: nothing changes.
  await a.click('#manage-all');
  same('Manage all queues the three it can', await Promise.all(['notes', 'release-notes', 'standup', 'review'].map(key => switchOn(a, key))), [true, true, true, false]);
  check('nothing written before Apply all', !existsSync(join(practice, '.copilot/skills/release-notes')));
  await a.click('#discard');
  same('Discard clears every change', await switchOn(a, 'notes'), false);

  // Manage all, Apply all.
  await a.click('#manage-all');
  await a.shot('practice-pending');
  await applyAll(a);
  same('copies written both ways', [existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), existsSync(join(practice, '.claude/skills/standup/SKILL.md'))], [true, true]);
  same('copy bytes match', tree(join(practice, '.copilot/skills/release-notes')), tree(join(practice, '.claude/skills/release-notes')));
  same('differing copies untouched', [readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8')], [reviewClaude, reviewCopilot]);
  same('now synced', [await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'standup', 'claude-cli'), await cellState(a, 'notes', 'claude-cli')], ['synced', 'synced', 'synced']);
  same('managed after Apply all', await switchOn(a, 'release-notes'), true);
  await a.shot('practice-applied');

  // Details open under a row.
  await a.click('#open-release-notes');
  check('details explain each tool', (await a.text('.details')).includes('Synced'), await a.text('.details'));
  await a.click('#close-release-notes');

  // Choose which copy to use.
  await a.click('#decide-review');
  check('the choice opens', await a.exists('#use-review-copilot-cli'));
  await a.shot('practice-compare');
  await a.click('#use-review-copilot-cli');
  check('the choice waits for Apply all', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') === reviewClaude);
  await applyAll(a);
  same('the chosen copy is used in both tools', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), reviewCopilot);
  check('the replaced copy is kept in the store', readdirSync(join(practice, '.central-knot/items/review')).some(revision => readFileSync(join(practice, '.central-knot/items/review', revision, 'SKILL.md'), 'utf8') === reviewClaude));
  check('no longer flagged', !(await a.exists('#decide-review')));

  // Catch-up: a managed copy deleted on disk comes back on Read again.
  rmSync(join(practice, '.copilot/skills/release-notes'), { recursive: true });
  await a.click('#header-refresh');
  check('Read again brings a managed copy back', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')));
  check('it says so', (await a.text('.bands') ?? '').includes('Caught up'), await a.text('.bands'));

  // Stop all for Copilot: copies stay, syncing stops.
  await a.click('#tool-copilot-cli');
  check('the tool menu opens', await a.exists('#stop-all-copilot-cli'));
  await a.shot('practice-tool-menu');
  await a.click('#stop-all-copilot-cli');
  await applyAll(a);
  same('Stop all keeps the copies', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), true);
  rmSync(join(practice, '.copilot/skills/release-notes'), { recursive: true });
  await a.click('#header-refresh');
  same('and stops bringing them back', existsSync(join(practice, '.copilot/skills/release-notes')), false);

  // Add all from Claude Code to Copilot turns it back on.
  await a.click('#tool-claude-cli');
  await a.click('#use-all-claude-cli-in-copilot-cli');
  await applyAll(a);
  same('Add all copies again', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), true);

  // Unmanage keeps copies.
  await a.click(`.ov-row[data-key="standup"] .switch`);
  await applyAll(a);
  same('unmanaged', await switchOn(a, 'standup'), false);
  same('unmanaging keeps both copies', [existsSync(join(practice, '.claude/skills/standup')), existsSync(join(practice, '.copilot/skills/standup'))], [true, true]);

  // Keyboard and find.
  await a.press('/', 'Slash');
  same('slash focuses find', await a.run(`document.activeElement?.id`), 'find');
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = 'stand'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.settle();
  same('find filters', await rowKeys(a), ['standup']);
  same('no page errors, practice', a.pageErrors, []);
  await a.quit();
}

async function realHomeFlow() {
  const before = { rich: tree(join(CLAUDE, 'rich')), unrelated: readFileSync(join(HOME, '.claude/unrelated.json'), 'utf8') };
  const a = await launch();
  await a.click('#home-actual');
  same('the disposable HOME is what "this Mac" reads', await a.run(`document.querySelector('.status-home').title`), HOME);
  same('real home is never the machine’s own', HOME.startsWith(scratch), true);
  await a.click('#nav-tools');
  const tools = await a.text('#tools-scroll');
  check('versions probed', tools.includes('2.1.309') && tools.includes('1.0.107'), tools.slice(0, 300));
  await a.click('#nav-overview');
  const rows = await rowKeys(a);
  for (const name of ['rich', '名前-skill', '.dot-skill', 'linked', 'from-copilot', 'has-link']) check(`row for ${name}`, rows.includes(name), rows);
  check('malformed skill is no row', !rows.includes('bad-yaml'));
  same('the linked skill is already one copy', [await cellState(a, 'linked', 'claude-cli'), await cellState(a, 'linked', 'copilot-cli')], ['present', 'present']);
  same('refused names and dot folders cannot go to Copilot', [await cellState(a, '名前-skill', 'copilot-cli'), await cellState(a, '.dot-skill', 'copilot-cli'), await cellState(a, 'plain', 'copilot-cli')], ['cannot', 'cannot', 'cannot']);
  check('a skill with a link inside is held', await a.exists('.ov-row[data-key="has-link"] .held-pill'));
  await a.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  await a.click(`[id="open-very-long-${'n'.repeat(150)}"]`);
  const fits = await a.run(`({ page: document.documentElement.scrollWidth, window: innerWidth })`);
  check('a very long name stays on screen at 960', fits.page <= fits.window, fits);
  await a.send('Emulation.clearDeviceMetricsOverride');
  await a.click(`[id="close-very-long-${'n'.repeat(150)}"]`);
  await a.shot('real-overview');
  if (!canWriteRealHome) {
    same('Apply all is off here', await a.run(`(() => { document.querySelector('#manage-all').click(); return document.querySelector('#apply').disabled; })()`), true);
    const refused = await a.run(`window.centralKnot.apply([{ key: 'rich', managed: true, off: [] }], false, document.querySelector('.status-home').title)`);
    same('main process refuses too', refused.harnessWrites, 0);
    check('with a reason', /Preview only/.test(refused.stopped ?? ''), refused);
    check('no copy and no store', !existsSync(join(COPILOT, 'rich')) && !existsSync(join(HOME, '.central-knot')));
    await a.quit();
    return;
  }
  const wrongHome = await a.run(`window.centralKnot.apply([{ key: 'rich', managed: true, off: [] }], false, '/somewhere/else')`);
  check('an apply for another home is refused', wrongHome.harnessWrites === 0 && /not the one open/.test(wrongHome.stopped ?? ''), wrongHome);
  await a.click('#manage-all');
  await a.click(`.ov-row[data-key="private-one"] .switch`);
  await applyAll(a);
  same('bytes and modes copied, .git left out', tree(join(COPILOT, 'rich')), before.rich);
  same('exec bit kept', statSync(join(COPILOT, 'rich/scripts/run.sh')).mode & 0o777, 0o755);
  check('Copilot-only skill reached Claude', existsSync(join(CLAUDE, 'from-copilot/SKILL.md')));
  check('the one switched back off was not copied', !existsSync(join(COPILOT, 'private-one')));
  check('refused name not copied', !existsSync(join(COPILOT, '名前-skill')));
  check('held skill not copied', !existsSync(join(COPILOT, 'has-link')));
  check('a skill with a read-only folder copied', existsSync(join(COPILOT, 'read-only-inside/refs/a.md')));
  check('an unreadable skill not copied', !existsSync(join(COPILOT, 'unreadable-file')));
  same('differing copies untouched', readFileSync(join(COPILOT, 'clash/SKILL.md'), 'utf8'), text('clash', 'Copilot version.'));
  same('link stays a link', lstatSync(join(CLAUDE, 'linked')).isSymbolicLink(), true);
  same('nothing staged in a loaded folder', [...readdirSync(COPILOT), ...readdirSync(CLAUDE)].filter(name => name.startsWith('.ck-')), []);
  same('unrelated bytes unchanged', readFileSync(join(HOME, '.claude/unrelated.json'), 'utf8'), before.unrelated);
  check('the problems are reported', (await a.text('.bands') ?? '').length > 0, await a.text('.bands'));
  await a.shot('real-applied');
  same('no page errors, real home', a.pageErrors, []);
  await a.quit();

  const record = join(HOME, '.central-knot/sync.json');
  const good = readFileSync(record, 'utf8');
  writeFileSync(record, '{ damaged');
  let b = await launch();
  await b.click('#home-actual');
  check('damaged record is shown', (await b.text('.bands') ?? '').includes('damaged'), await b.text('.bands'));
  await b.click(`.ov-row[data-key="private-one"] .switch`);
  same('damaged record keeps Apply all off', await b.run(`document.querySelector('#apply')?.disabled ?? true`), true);
  await b.quit();
  writeFileSync(record, good);
  b = await launch(join(scratch, 'other-data'));
  await b.click('#home-actual');
  await b.click(`.ov-row[data-key="private-one"] .switch`);
  same('lost settings ask to resume', (await b.text('#apply')).trim(), 'Resume and apply all');
  await applyAll(b);
  same('resuming keeps the record', JSON.parse(readFileSync(record, 'utf8')).generation, JSON.parse(good).generation);
  check('and applies', existsSync(join(COPILOT, 'private-one/SKILL.md')));
  same('no page errors, stops', b.pageErrors, []);
  await b.quit();
}

/** Force-kills the app part-way through real copies, then checks nothing half-written is visible to a tool. */
async function crashFlow() {
  execChmod();
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(COPILOT, { recursive: true });
  const expected = {};
  for (let number = 0; number < 40; number++) {
    const directory = skill(CLAUDE, `bulk-${number}`);
    for (let file = 0; file < 60; file++) writeFileSync(join(directory, `file-${file}.txt`), `${number}:${file}\n`.repeat(2000));
    expected[`bulk-${number}`] = tree(directory);
  }
  let interrupted = 0;
  for (let round = 0; round < crashRounds; round++) {
    const a = await launch(join(scratch, 'crash-data'));
    await a.click('#home-actual');
    if (round === 0) {
      await a.click('#manage-all');
      await a.run(`document.querySelector('#apply').click()`);
    } else await a.run(`document.querySelector('#header-refresh').click()`);
    await wait(30 + round * 90 + randomInt(40));
    await a.crash();
    if (readdirSync(COPILOT).length < 40) interrupted++;
    for (const name of readdirSync(COPILOT)) {
      check(`round ${round}: nothing half-written in a loaded folder (${name})`, !name.startsWith('.'), name);
      if (expected[name]) same(`round ${round}: ${name} is complete or absent`, tree(join(COPILOT, name)), expected[name]);
    }
    const record = join(HOME, '.central-knot/sync.json');
    if (existsSync(record)) { try { JSON.parse(readFileSync(record, 'utf8')); passes++; } catch { check(`round ${round}: record stays valid`, false); } }
  }
  const a = await launch(join(scratch, 'crash-data'));
  await a.click('#home-actual');
  same('after crashes, opening again completes every copy', readdirSync(COPILOT).filter(name => name.startsWith('bulk-')).length, 40);
  for (const name of Object.keys(expected)) same(`final ${name} bytes`, tree(join(COPILOT, name)), expected[name]);
  same('stale stages are cleared', readdirSync(join(HOME, '.copilot')).filter(name => name.startsWith('.ck-')), []);
  same('no page errors, crashes', a.pageErrors, []);
  await a.quit();
  console.log(`crash rounds: ${crashRounds}, interrupted a copy in ${interrupted}`);
  check('at least one round really interrupted copying', interrupted > 0, interrupted);
}

const execChmod = () => spawnSync('chmod', ['-R', 'u+rwx', scratch]);

// ---------- Run ----------
const started = Date.now();
try {
  seedHome();
  await practiceFlow();
  await realHomeFlow();
  if (canWriteRealHome && crashRounds > 0) await crashFlow();
  execChmod();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.error(error);
} finally {
  app?.child.kill('SIGKILL');
  execChmod();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}
console.log(`e2e: ${passes} passed, ${failures.length} failed, ${Math.round((Date.now() - started) / 1000)}s, ${process.platform}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }

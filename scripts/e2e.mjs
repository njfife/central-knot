// Drives the real app end to end over its debug port, in a throwaway HOME, so "This Mac's home" is disposable too.
// Usage: node scripts/e2e.mjs [--electron] [--no-sandbox] [--shots dir] [--crash-rounds n]
import { spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
const command = flag('--electron') ? join(root, 'node_modules/.bin/electron') : packaged;

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
}

// ---------- App ----------
let app;
async function launch(userData = join(scratch, 'data')) {
  const port = 9400 + randomInt(500);
  const env = { HOME, PATH: '/usr/bin:/bin', TMPDIR: join(scratch, 'tmp') };
  mkdirSync(env.TMPDIR, { recursive: true });
  if (process.env.DISPLAY) env.DISPLAY = process.env.DISPLAY;
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
async function practiceFlow() {
  const a = await launch();
  same('opens on the practice copy', await a.text('#home-label'), 'Practice copy');
  same('practice shows both tools', [await a.all('.mx-cell[data-tool="claude-cli"][data-present="true"]').then(r => r.length), await a.all('.mx-cell[data-tool="copilot-cli"][data-present="true"]').then(r => r.length)], [3, 3]);
  same('rows and order', await a.all('.mx-item', 'e.dataset.key'), ['notes', 'release-notes', 'review', 'standup']);
  same('statuses', await a.all('.mx-item .status-word'), ['Not shared', 'Not shared', 'Needs a decision', 'Not shared']);
  await a.shot('practice-overview');

  await a.press('/', 'Slash');
  same('slash focuses find', await a.run(`document.activeElement?.id`), 'find');
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = 'stand'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.settle();
  same('find filters', await a.all('.mx-item', 'e.dataset.key'), ['standup']);
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = 'nothing-like-this'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.settle();
  same('find empty state', await a.all('.mx-item'), []);
  await a.click('#clear-find-action');
  same('clearing find restores rows', (await a.all('.mx-item')).length, 4);

  await a.click('#row-review');
  check('row opens detail with both locations', (await a.text('#panel-body')).includes('.claude/skills/review') && (await a.text('#panel-body')).includes('.copilot/skills/review'));
  check('detail shows original contents', (await a.text('#panel-body')).includes('Read the supplied changes.'));
  await a.press('Escape');
  check('Esc closes the panel', !(await a.exists('#panel-title')) || await a.run(`document.querySelector('#panel').hidden`));

  await a.click('#nav-skills');
  same('skills list', (await a.all('button[id^="list-"]')).length, 4);
  await a.click('#list-standup');
  check('skills detail', (await a.text('#detail-scroll')).includes('three-line standup'));
  await a.click('#nav-tools');
  same('tool cards', (await a.text('#tools-scroll')).includes('Claude Code CLI') && (await a.text('#tools-scroll')).includes('GitHub Copilot CLI'), true);
  await a.shot('practice-tools');
  await a.click('#nav-overview');

  const practice = await a.run(`document.querySelector('.status-home').title`);
  check('practice home is not the disposable real home', practice !== HOME && existsSync(practice), practice);
  await a.click('#share-open');
  same('practice plan', await a.plan(), { review: 'collision', 'release-notes': 'copy', standup: 'copy', notes: 'identical' });
  check('collision shows its diff', (await a.text('#diff-text-review') ?? (await a.click('#diff-review-toggle').catch(() => {}), await a.text('#panel-body'))).includes('Read the supplied changes.') );
  await a.shot('practice-share');
  const reviewBefore = [tree(join(practice, '.claude/skills/review')), tree(join(practice, '.copilot/skills/review'))];
  await a.click('#exclude-standup');
  same('Don’t share replans', (await a.plan()).standup, 'dont-share');
  await a.click('#exclude-standup');
  same('clearing Don’t share replans', (await a.plan()).standup, 'copy');
  await a.click('#start');
  same('Start copies both ways', [existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), existsSync(join(practice, '.claude/skills/standup/SKILL.md'))], [true, true]);
  same('copy bytes match', tree(join(practice, '.copilot/skills/release-notes')), tree(join(practice, '.claude/skills/release-notes')));
  same('collision untouched', [tree(join(practice, '.claude/skills/review')), tree(join(practice, '.copilot/skills/review'))], reviewBefore);
  same('results', (await a.all('.result', 'e.dataset.outcome')).sort(), ['held', 'written', 'written']);
  await a.shot('practice-after-start');
  await a.click('#start');
  check('repeat copies nothing', /Nothing needed copying/.test(await a.text('#announcement')), await a.text('#announcement'));
  await a.click('#undo-all');
  same('Undo removes only its copies', [existsSync(join(practice, '.copilot/skills/release-notes')), existsSync(join(practice, '.claude/skills/standup')), existsSync(join(practice, '.claude/skills/release-notes')), existsSync(join(practice, '.copilot/skills/standup'))], [false, false, true, true]);
  await a.expand();
  same('undone skills stay Don’t share', (await a.plan()).standup, 'dont-share');
  await a.click('#start');
  same('Start after Undo does not recopy', existsSync(join(practice, '.copilot/skills/release-notes')), false);
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
  const rows = await a.all('.mx-item', 'e.dataset.key');
  for (const name of ['rich', '名前-skill', '.dot-skill', 'linked', 'from-copilot']) check(`row for ${name}`, rows.includes(name), rows);
  check('malformed skill is no row', !rows.includes('bad-yaml'));
  check('read problem is reported', (await a.text('.band') ?? '').includes('read problem'), await a.text('.band'));
  await a.shot('real-overview');
  await a.click('#share-open');
  await a.expand();
  const plan = await a.plan();
  same('real-shaped plan', [plan.rich, plan['名前-skill'], plan.scoped, plan.plain, plan['.dot-skill'], plan.clash, plan.twin, plan['from-copilot'], plan['has-link'], plan.linked],
    ['copy', 'copy', 'copy', 'held', 'held', 'collision', 'identical', 'copy', 'held', 'already-shared']);
  check('known limit named', (await a.text('.plan-card[data-key="scoped"]')).includes('paths'));
  await a.shot('real-share');
  if (!canWriteRealHome) {
    same('real home is preview only here', await a.run(`document.querySelector('#start').disabled`), true);
    const refused = await a.run(`window.centralKnot.start(['claude-cli','copilot-cli'], [], false).then(r => [r.harnessWrites, r.stopped])`);
    same('main process refuses too', refused[0], 0);
    check('with a reason', /Preview only/.test(refused[1]), refused);
    check('no copy and no store', !existsSync(join(COPILOT, 'rich')) && !existsSync(join(HOME, '.central-knot')));
    await a.quit();
    return;
  }
  await a.click('#exclude-private-one');
  await a.click('#start');
  same('bytes and modes copied, .git left out', tree(join(COPILOT, 'rich')), before.rich);
  same('source .git untouched', readFileSync(join(CLAUDE, 'rich/.git/HEAD'), 'utf8'), 'ref: refs/heads/main\n');
  same('exec bit kept', statSync(join(COPILOT, 'rich/scripts/run.sh')).mode & 0o777, 0o755);
  check('non-Latin name copied', existsSync(join(COPILOT, '名前-skill/SKILL.md')));
  check('Copilot-only skill reached Claude', existsSync(join(CLAUDE, 'from-copilot/SKILL.md')));
  check('Don’t share held', !existsSync(join(COPILOT, 'private-one')));
  check('no-frontmatter skipped', !existsSync(join(COPILOT, 'plain')));
  check('dot-folder skipped', !existsSync(join(COPILOT, '.dot-skill')));
  check('held skill with a link not copied', !existsSync(join(COPILOT, 'has-link')));
  same('collision untouched', readFileSync(join(COPILOT, 'clash/SKILL.md'), 'utf8'), text('clash', 'Copilot version.'));
  same('link stays a link', lstatSync(join(CLAUDE, 'linked')).isSymbolicLink(), true);
  same('nothing was staged in a loaded folder', [...readdirSync(COPILOT), ...readdirSync(CLAUDE)].filter(name => name.startsWith('.ck-')), []);
  same('unrelated bytes unchanged', readFileSync(join(HOME, '.claude/unrelated.json'), 'utf8'), before.unrelated);
  check('sync record written', JSON.parse(readFileSync(join(HOME, '.central-knot/sync.json'), 'utf8')).formatVersion === 1);
  await a.expand();
  same('row with a named loss says so', (await a.all('.plan-card[data-key="scoped"] .plan-reason')).join('').includes('Copilot CLI ignores'), true);
  await a.shot('real-after-start');
  writeFileSync(join(COPILOT, 'rich/SKILL.md'), text('rich', 'Edited by hand.'));
  await a.click('#header-refresh');
  await a.expand();
  same('later edit is held', (await a.plan()).rich, 'held');
  await a.click('#start');
  same('held edit is not overwritten', readFileSync(join(COPILOT, 'rich/SKILL.md'), 'utf8'), text('rich', 'Edited by hand.'));
  await a.expand();
  await a.click('[id="undo-名前-skill"]');
  check('per-item Undo removes that copy', !existsSync(join(COPILOT, '名前-skill')));
  check('its source stays', existsSync(join(CLAUDE, '名前-skill/SKILL.md')));
  check('another copy stays', existsSync(join(CLAUDE, 'from-copilot')));
  same('no page errors, real home', a.pageErrors, []);
  await a.quit();

  // A restart keeps the record, and each stop holds.
  const record = join(HOME, '.central-knot/sync.json');
  const good = readFileSync(record, 'utf8');
  let b = await launch();
  await b.click('#home-actual');
  await b.click('#share-open');
  same('restart: still ready', await b.text('#start'), 'Start');
  await b.quit();
  writeFileSync(record, '{ damaged');
  b = await launch();
  await b.click('#home-actual');
  await b.click('#share-open');
  same('damaged record stops Start', await b.run(`document.querySelector('#start').disabled`), true);
  check('with the reason', (await b.text('#panel-body')).includes('damaged'));
  await b.shot('real-stopped');
  await b.quit();
  writeFileSync(record, good);
  b = await launch(join(scratch, 'other-data'));
  await b.click('#home-actual');
  await b.click('#share-open');
  same('lost settings ask to resume', await b.text('#start'), 'Resume and Start');
  await b.click('#start');
  same('resuming keeps the record', JSON.parse(readFileSync(record, 'utf8')).generation, JSON.parse(good).generation);
  same('no page errors, stops', b.pageErrors, []);
  await b.quit();
}


/** Force-kills the app part-way through real copies, then checks nothing half-written is visible to a tool. */
async function crashFlow() {
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
    const data = join(scratch, 'crash-data');
    const a = await launch(data);
    await a.click('#home-actual');
    await a.click('#share-open');
    if (await a.exists('#start') && !(await a.run(`document.querySelector('#start').disabled`))) {
      await a.run(`document.querySelector('#start').click()`);
      await wait(30 + round * 90 + randomInt(40));
    }
    const remaining = readdirSync(COPILOT).length;
    await a.crash();
    if (readdirSync(COPILOT).length < 40) interrupted++;
    for (const name of readdirSync(COPILOT)) {
      check(`round ${round}: nothing half-written in a loaded folder (${name})`, !name.startsWith('.'), name);
      if (expected[name]) same(`round ${round}: ${name} is complete or absent`, tree(join(COPILOT, name)), expected[name]);
    }
    const record = join(HOME, '.central-knot/sync.json');
    if (existsSync(record)) { try { JSON.parse(readFileSync(record, 'utf8')); passes++; } catch { check(`round ${round}: record stays valid`, false); } }
    void remaining;
  }
  const a = await launch(join(scratch, 'crash-data'));
  await a.click('#home-actual');
  await a.click('#share-open');
  if (!(await a.run(`document.querySelector('#start').disabled`))) await a.click('#start');
  same('after crashes a final Start completes', readdirSync(COPILOT).sort().length, 40);
  for (const name of Object.keys(expected)) same(`final ${name} bytes`, tree(join(COPILOT, name)), expected[name]);
  same('stale stages are cleared', readdirSync(join(HOME, '.copilot')).filter(name => name.startsWith('.ck-')), []);
  await a.click('#undo-all');
  same('Undo still removes copies a crash interrupted', readdirSync(COPILOT).filter(name => name.startsWith('bulk-')), []);
  same('no page errors, crashes', a.pageErrors, []);
  await a.quit();
  console.log(`crash rounds: ${crashRounds}, interrupted a copy in ${interrupted}`);
  check('at least one round really interrupted copying', interrupted > 0, interrupted);
}

// ---------- Run ----------
const started = Date.now();
try {
  seedHome();
  await practiceFlow();
  await realHomeFlow();
  if (canWriteRealHome && crashRounds > 0) await crashFlow();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.error(error);
} finally {
  app?.child.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}
console.log(`e2e: ${passes} passed, ${failures.length} failed, ${Math.round((Date.now() - started) / 1000)}s, ${process.platform}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }

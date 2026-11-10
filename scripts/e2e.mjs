// Drives the real app end to end over its debug port, in a throwaway HOME, so "This Mac's home" is disposable too.
// Usage: node scripts/e2e.mjs [--electron] [--no-sandbox] [--shots dir] [--crash-rounds n]
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeMarket } from './fixture-market.mjs';

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
const CLAUDE = join(HOME, '.claude/skills'), COPILOT = join(HOME, '.copilot/skills'), AGENTS = join(HOME, '.agents/skills'), CODEX = join(HOME, '.codex/skills');
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
  for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['copilot', 'GitHub Copilot CLI 1.0.107.'], ['codex', 'codex-cli 0.142.3']]) {
    writeFileSync(join(HOME, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`);
    chmodSync(join(HOME, '.local/bin', name), 0o755);
  }
  writeFileSync(join(HOME, '.claude/unrelated.json'), '{ "keep":   "these bytes" }\n');
  skill(CLAUDE, `very-long-${'n'.repeat(150)}`);
  skill(CLAUDE, 'MixedCase');
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
  // A page that never settles (a renderer error at start, a read that never ends) fails the run instead of holding it open.
  const settle = async () => { await wait(120); await run(`new Promise((done, fail) => { const end = Date.now() + 30000; const c = () => (document.body.dataset.ready === 'true' || document.querySelector('.mx,.empty-state')) && document.body.dataset.busy !== 'true' ? done(true) : Date.now() > end ? fail(new Error('The page did not settle within 30 s.')) : setTimeout(c, 25); c(); })`); await wait(60); };
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
    pages: async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(target => target.type === 'page').length,
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

/** Harnesses: one tool's page manages its items with the same engine as the Skills page. */
async function harnessFlow() {
  const a = await launch(join(scratch, 'harness-data'));
  const practice = await a.run(`document.querySelector('.status-home').title`);
  await a.click('#nav-harnesses');
  const list = await a.text('#harnesses-scroll') ?? '';
  check('Harnesses sums up each tool found', ['Claude Code', 'Copilot CLI', 'Codex'].every(name => list.includes(name)) && list.includes('none managed'), list.slice(0, 400));
  // The card's count and the tab it opens agree; another harness starts with the filter off.
  const cardDiffer = parseInt(await a.text('#harness-claude-cli-differ-skills') ?? '', 10);
  await a.click('#harness-claude-cli-differ-skills');
  same('a card’s different-copies count is the Copies differ count on the tab it opens', [cardDiffer, parseInt(await a.text('.chip-warn .chip-count') ?? '', 10), (await rowKeys(a)).length], [1, 1, 1]);
  await a.click('#harness-switch-codex-cli');
  check('another harness opens with every row, not an empty filter', (await a.text('.chip-on')) === 'All' && (await rowKeys(a)).length > 0, await a.text('.chips'));
  await a.click('#harness-back');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-skills');
  check('a harness opens on its skills, its own column first', (await a.exists('#harness-tab-skills[aria-selected="true"]')) && (await a.text('.ov-head .ov-tool-head') ?? '').includes('Copilot CLI'), await a.text('.ov-head'));
  const away = await a.run(`[...document.querySelectorAll('[role="rowgroup"]')].find(group => group.querySelector('.ov-section-label strong')?.textContent === 'Not in Copilot CLI')?.querySelector('[data-key="release-notes"]') ? true : false`);
  check('a skill only other tools have is under "Not in Copilot CLI"', away);
  await a.click('#cell-release-notes-copilot-cli');
  same('its box here adds it here only', [await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'release-notes', 'codex-cli')], ['will-sync', 'absent']);
  await a.click('#discard');
  await a.click('#harness-add-from');
  check('Add from… opens its column menu, which brings things in', (await a.text('.tool-menu-label') ?? '').includes('Add to Copilot CLI from'), await a.text('.tool-menu'));
  await a.click('#menu-add-claude-cli-copilot-cli');
  same('Add queues a new copy here', await cellState(a, 'release-notes', 'copilot-cli'), 'will-sync');
  check('nothing written before Apply all', !existsSync(join(practice, '.copilot/skills/release-notes')));
  await a.shot('harness-pending');
  await applyAll(a);
  check('Apply all on a harness page writes the copy, and only where the menu said', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')) && !existsSync(join(practice, '.codex/skills/release-notes')));
  check('and says so there', await a.exists('.harness-page .band-done'), await a.text('.harness-page'));
  await a.click('#nav-harnesses');
  check('the sidebar’s Harnesses leaves that result behind', !(await a.exists('.band-done')), await a.text('#page'));
  await a.click('#nav-skills');
  same('the Skills page shows the same change', await switchOn(a, 'release-notes'), true);
  check('and is its usual self: Claude Code first, no "Not in" section', (await a.text('.ov-head .ov-tool-head') ?? '').includes('Claude Code') && !(await a.all('.ov-section-label strong')).some(label => label.startsWith('Not in')), await a.text('.ov-head'));
  await a.click('#nav-harnesses');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-skills');
  await a.click('#nav-overview');
  await a.click('#overview-skills-differ');
  check('after a harness’s Skills tab, the Overview’s “different copies” link still opens Skills narrowed to them', (await a.text('.chip-on') ?? '').startsWith('Copies differ'), await a.text('.chips'));
  await a.click('#nav-harnesses');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-instructions');
  check('its instruction file is there to edit', await a.exists('#ins-edit-copilot-cli'), await a.text('.harness-page'));
  await a.click('#harness-switch-claude-cli');
  await a.click('#ins-edit-claude-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value += '- Saved from its harness page.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli');
  await a.click('#ins-save-claude-cli');
  same('a save on a harness’s Instructions tab offers one Undo, on its card', await a.run(`document.querySelectorAll('#outcome-undo-instruction').length`), 1);
  await a.click('#harness-switch-codex-cli');
  check('the switcher moves to another harness', (await a.text('.title-harness')) === 'Codex', await a.text('#header'));
  await a.click('#harness-back');
  check('back returns to every harness', await a.exists('#harnesses-scroll'));
  // Another home: the instruction file shown is that home's, not the practice copy's.
  await a.click('#home-actual');
  await a.click('#nav-harnesses');
  await a.click('#harness-claude-cli');
  await a.click('#harness-tab-instructions');
  check('after a home switch, instructions are that home’s', (await a.text('#harness-body') ?? '').includes('~/.claude/CLAUDE.md'), await a.text('#harness-body'));
  same('no page errors, harnesses', a.pageErrors, []);
  await a.quit();
}

async function practiceFlow() {
  const a = await launch();
  same('opens on the practice copy', await a.text('#home-label'), 'Practice copy');
  await wait(1500);
  same('one window at launch (macOS activate never makes a second)', await a.pages(), 1);
  check('the Overview sums up every kind', (await a.exists('#overview-skills')) && (await a.exists('#overview-mcp')) && (await a.exists('#overview-agents')), await a.text('#page'));
  check('the practice copy explains itself', (await a.text('.intro') ?? '').includes('practice copy'), await a.text('#page'));
  await a.click('#overview-skills');
  same('rows', (await rowKeys(a)).sort(), ['notes', 'release-notes', 'review', 'standup']);
  same('nothing is managed at first', await Promise.all(['notes', 'release-notes', 'review', 'standup'].map(key => switchOn(a, key))), [false, false, false, false]);
  same('cells say what each tool has', [await cellState(a, 'release-notes', 'claude-cli'), await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'review', 'copilot-cli')], ['present', 'absent', 'present-differs']);
  check('copies differ is flagged', await a.exists('#decide-review'));
  await a.shot('practice-overview');
  const practice = await a.run(`document.querySelector('.status-home').title`);
  check('practice home is not the disposable real home', practice !== HOME && existsSync(practice), practice);
  const reviewClaude = readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8');
  const reviewCopilot = readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8');

  // Add all from Copilot CLI to Claude Code: new, same and different are told apart, and differing copies are opt-in.
  await a.click('#tool-copilot-cli');
  const groups = await a.run(`[...document.querySelectorAll('.add-target[data-target="claude-cli"] [data-group]')].map(group => group.dataset.group + ':' + (group.dataset.count ?? '1'))`);
  same('Add all groups for Claude Code', groups, ['new: will be copied:1', 'identical: starts syncing:1', 'different:1']);
  same('Add leaves differing copies out at first', [await a.text('#menu-add-copilot-cli-claude-cli'), await a.exists('#menu-conflicts-note-copilot-cli-claude-cli')], ['Add 2 (1 new)', false]);
  await a.click('#menu-conflicts-copilot-cli-claude-cli');
  const note = await a.text('#menu-conflicts-note-copilot-cli-claude-cli') ?? '';
  check('opting in says whose copy is accepted and that the replaced one is kept', note.includes('You accept Copilot CLI’s copy') && note.includes('Claude Code') && note.includes('store keeps'), note);
  same('and counts it', await a.text('#menu-add-copilot-cli-claude-cli'), 'Add 3 (1 new)');
  await a.click('#menu-add-copilot-cli-claude-cli');
  same('Add all queues all three as managed', await Promise.all(['notes', 'standup', 'review'].map(key => switchOn(a, key))), [true, true, true]);
  check('the differing copy is chosen from Copilot CLI, as a choice you can undo', (await a.exists('#undo-review')) && (await a.text('.ov-row[data-key="review"] .decided') ?? '').includes('Copilot CLI'));
  same('Add all writes nothing before Apply all', [existsSync(join(practice, '.claude/skills/standup')), readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8')], [false, reviewClaude]);
  await a.shot('practice-add-all-conflicts');
  await a.click('#discard');

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
  same('Codex is a column and gets its copies too', [await a.exists('#tool-codex-cli'), existsSync(join(practice, '.codex/skills/notes/SKILL.md')), existsSync(join(practice, '.codex/skills/standup/SKILL.md'))], [true, true, true]);
  check('Codex’s own .system skills stay untouched and unlisted', existsSync(join(practice, '.codex/skills/.system/openai-docs/SKILL.md')) && !(await rowKeys(a)).includes('openai-docs'));

  // Two-way: an edit in one tool spreads on the next read, Undo puts it back; a deletion spreads after the settle window; Restore returns it.
  const standupPath = tool => join(practice, `.${tool}/skills/standup/SKILL.md`);
  const standupBefore = readFileSync(standupPath('claude'), 'utf8');
  writeFileSync(standupPath('claude'), standupBefore.replace(/\n*$/, '\nEdited in Claude Code.\n'));
  await a.click('#header-refresh');
  same('an edit spreads to every tool on the next read', [readFileSync(standupPath('copilot'), 'utf8'), readFileSync(standupPath('codex'), 'utf8')].map(text => text.includes('Edited in Claude Code.')), [true, true]);
  check('and says so, with Undo', (await a.text('.sync-notices') ?? '').includes("standup was edited in Claude Code and copied to"), await a.text('.bands'));
  check('without also calling it a catch-up', !(await a.text('.bands') ?? '').includes('Caught up'), await a.text('.bands'));
  await a.shot('practice-edit-spread');
  await a.run(`document.querySelector('.sync-notice[data-kind="edit"] .see-change').click()`);
  for (let tries = 0; tries < 20 && !(await a.exists('.sync-notice .change-panel .ins-added')); tries++) await wait(100);
  check('See change shows the edit before Undo', (await a.text('.sync-notice .change-panel .ins-added') ?? '').includes('Edited in Claude Code.'), await a.text('.sync-notices'));
  await a.run(`document.querySelector('.sync-notice[data-kind="edit"] [id^="notice-undo-"]').click()`);
  await a.settle();
  same('Undo puts the old version back everywhere', [readFileSync(standupPath('claude'), 'utf8'), readFileSync(standupPath('copilot'), 'utf8')], [standupBefore, standupBefore]);
  rmSync(join(practice, '.copilot/skills/release-notes'), { recursive: true });
  await a.click('#header-refresh');
  check('a fresh deletion waits for the settle window: nothing deleted or recreated yet', existsSync(join(practice, '.claude/skills/release-notes')) && !existsSync(join(practice, '.copilot/skills/release-notes')));
  await wait(2200);
  await a.click('#header-refresh');
  same('then the deletion spreads', [existsSync(join(practice, '.claude/skills/release-notes')), existsSync(join(practice, '.codex/skills/release-notes'))], [false, false]);
  check('with a notice offering Restore', (await a.text('.sync-notices') ?? '').includes('release-notes was deleted in Copilot CLI'), await a.text('.bands'));
  check('and the table keeps a trace with Restore', await a.exists('[data-ghost="release-notes"] button'));
  await a.click('#nav-history');
  check('History lists it', (await a.text('#history-scroll') ?? '').includes('release-notes'), await a.text('#history-scroll'));
  await a.shot('practice-history');
  await a.run(`document.querySelector('.history-row[data-kind="deleted"] button').click()`);
  await a.settle();
  same('Restore brings it back to every tool', [existsSync(join(practice, '.claude/skills/release-notes/SKILL.md')), existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), existsSync(join(practice, '.codex/skills/release-notes/SKILL.md'))], [true, true, true]);

  // Watching: an edit on disk spreads with no click (an event prompts a read; polling is the fallback).
  await a.click('#nav-skills');
  writeFileSync(standupPath('copilot'), standupBefore.replace(/\n*$/, '\nEdited in Copilot, watched.\n'));
  let watched = false;
  for (let tries = 0; tries < 40 && !watched; tries++) { await wait(250); watched = readFileSync(standupPath('claude'), 'utf8').includes('watched'); }
  check('a change on disk spreads on its own', watched);
  await wait(800);
  check('and the page hears about it without a click', (await a.text('.sync-notices') ?? '').includes("standup was edited in Copilot CLI"), await a.text('.bands'));
  // Sync off: edits are noted, not spread; the page shows them pending; Sync now spreads once; Apply all still works.
  await a.click('#sync-switch');
  same('Sync turns off', await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`), 'false');
  writeFileSync(standupPath('claude'), standupBefore.replace(/\n*$/, '\nEdited with Sync off.\n'));
  let shownPending = false;
  for (let tries = 0; tries < 40 && !shownPending; tries++) { await wait(250); shownPending = (await cellState(a, 'standup', 'claude-cli')) === 'edited'; }
  check('with Sync off the page shows the edit as pending on its own, without Read again', shownPending);
  await a.click('#header-refresh');
  check('with Sync off nothing spreads', !readFileSync(standupPath('copilot'), 'utf8').includes('Sync off'));
  same('the edit shows as waiting to spread, not as a choice', [await cellState(a, 'standup', 'claude-cli'), await cellState(a, 'standup', 'copilot-cli'), await a.exists('#decide-standup')], ['edited', 'waiting', false]);
  check('and a banner says automatic sync is off', (await a.text('.bands') ?? '').includes('Automatic sync is off'));
  check('Apply all does not claim it', !(await a.exists('#apply')), await a.text('.toolbar-end'));
  await a.shot('practice-sync-off');
  await a.click('#sync-now');
  check('Sync now spreads it once', readFileSync(standupPath('copilot'), 'utf8').includes('Sync off'));
  await a.click('#sync-switch');
  same('Sync turns back on', await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`), 'true');
  // A pending change on the page never brings back a skill the background just deleted.
  await a.click('#cell-standup-codex-cli');
  check('a change is pending', await a.exists('#discard'));
  rmSync(join(practice, '.claude/skills/standup'), { recursive: true });
  let spread = false;
  for (let tries = 0; tries < 60 && !spread; tries++) { await wait(250); spread = !existsSync(join(practice, '.copilot/skills/standup')); }
  check('the deletion spreads in the background', spread);
  await wait(1000);
  same('and the pending change is gone, so Apply all cannot revive it', [await a.exists('#apply'), existsSync(join(practice, '.claude/skills/standup'))], [false, false]);
  await a.click('#nav-history');
  await a.run(`document.querySelector('.history-row[data-kind="deleted"] button').click()`);
  await a.settle();
  check('Restore brings standup back', existsSync(join(practice, '.claude/skills/standup/SKILL.md')) && existsSync(join(practice, '.copilot/skills/standup/SKILL.md')));
  await a.click('#nav-skills');
  await a.click('#nav-skills');
  same('differing copies untouched', [readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8')], [reviewClaude, reviewCopilot]);
  same('now synced', [await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'standup', 'claude-cli'), await cellState(a, 'notes', 'claude-cli')], ['synced', 'synced', 'synced']);
  same('managed after Apply all', await switchOn(a, 'release-notes'), true);
  await a.shot('practice-applied');

  // Details open under a row.
  await a.click('#open-release-notes');
  check('details say every tool has the same copy', (await a.text('.details')).includes('same copy in Claude Code, Copilot CLI and Codex'), await a.text('.details'));
  await a.click('#open-release-notes');

  // Choose which copy to use.
  await a.click('#decide-review');
  check('the choice opens', await a.exists('#use-review-copilot-cli'));
  await a.shot('practice-compare');
  await a.click('#use-review-copilot-cli');
  check('the choice waits for Apply all', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') === reviewClaude);
  same('the choice previews as a pending sync', [await cellState(a, 'review', 'claude-cli'), await cellState(a, 'review', 'copilot-cli')], ['synced', 'synced']);
  check('the pill gives way to the choice', !(await a.exists('#decide-review')) && (await a.exists('#undo-review')));
  const nameFits = await a.run(`(() => { const cell = document.querySelector('.ov-row[data-key="review"] .ov-name'); return cell.scrollWidth <= cell.clientWidth + 1 && cell.getBoundingClientRect().height < 44; })()`);
  check('the name cell does not overflow or wrap', nameFits);
  await a.shot('practice-choice-made');
  await applyAll(a);
  same('the chosen copy is used in both tools', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), reviewCopilot);
  check('the replaced copy is kept in the store', readdirSync(join(practice, '.central-knot/items/review')).some(revision => readFileSync(join(practice, '.central-knot/items/review', revision, 'SKILL.md'), 'utf8') === reviewClaude));
  check('no longer flagged', !(await a.exists('#decide-review')));
  // The choice has its own Undo right there: Claude Code's copy back in Claude Code only, the skill unmanaged and differing again.
  // Seconds later, after any background pass, the result and its Undo are still there.
  await wait(3500);
  check('a copy choice offers an inline Undo', await a.exists('#outcome-undo-choice'), await a.text('.bands'));
  await a.click('#outcome-undo-choice');
  for (let tries = 0; tries < 30 && readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') !== reviewClaude; tries++) await wait(100);
  check('Undo puts the replaced copy back in its own tool only', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') === reviewClaude && readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8') === reviewCopilot);
  check('and review is flagged again', await a.exists('#decide-review'));
  // Choosing again from the Files view ("Read both copies"): the result and its Undo show there too.
  await a.click('#decide-review');
  await a.click('#diff-review');
  await a.click('#use-review-copilot-cli');
  await applyAll(a);
  same('choosing again works', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), reviewCopilot);
  check('a choice applied from the Files view shows its result and Undo', await a.exists('#outcome-undo-choice'), await a.text('.detail-column'));
  if (await a.exists('#skills-table')) await a.click('#skills-table');

  // Stop all for Copilot: copies stay, syncing stops.
  await a.click('#tool-copilot-cli');
  check('the tool menu opens', await a.exists('#menu-stop-copilot-cli'));
  await a.shot('practice-tool-menu');
  await a.click('#menu-stop-copilot-cli');
  await applyAll(a);
  same('Stop all keeps the copies', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), true);
  rmSync(join(practice, '.copilot/skills/release-notes'), { recursive: true });
  await a.click('#header-refresh');
  same('and stops bringing them back', existsSync(join(practice, '.copilot/skills/release-notes')), false);
  check('and a deletion in a tool that no longer syncs stays there', existsSync(join(practice, '.claude/skills/release-notes/SKILL.md')));

  // Add all from Claude Code to Copilot turns it back on.
  await a.click('#tool-claude-cli');
  await a.click('#menu-add-claude-cli-copilot-cli');
  await applyAll(a);
  same('Add all copies again', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), true);

  // Unmanage keeps copies.
  await a.click(`.ov-row[data-key="standup"] .switch`);
  await applyAll(a);
  same('unmanaged', await switchOn(a, 'standup'), false);
  same('unmanaging keeps both copies', [existsSync(join(practice, '.claude/skills/standup')), existsSync(join(practice, '.copilot/skills/standup'))], [true, true]);

  // Keep both, then turning it on: the switch and Apply all agree. An unmanaged skill's local edit is a difference to decide;
  // a managed one's would simply spread.
  await a.click(`.ov-row[data-key="notes"] .switch`);
  await applyAll(a);
  writeFileSync(join(practice, '.claude/skills/notes/SKILL.md'), readFileSync(join(practice, '.claude/skills/notes/SKILL.md'), 'utf8') + '\nLocal edit.\n');
  await a.click('#header-refresh');
  await a.click('#decide-notes');
  await a.click('#separate-notes');
  same('keep both leaves it off', await switchOn(a, 'notes'), false);
  await a.click('#switch-notes');
  check('turning it on drops keep both', !(await a.text('.ov-row[data-key="notes"]')).includes('Keeping separate'), await a.text('.ov-row[data-key="notes"]'));
  same('and turning it on is a pending change', await a.exists('#discard'), true);
  await a.click('#discard');
  // Choosing a copy, then switching it off: the choice goes too.
  await a.click('#decide-notes');
  await a.click('#use-notes-claude-cli');
  await a.click('#switch-notes');
  check('switching off drops the chosen copy', !(await a.text('.ov-row[data-key="notes"]')).includes('Using'), await a.text('.ov-row[data-key="notes"]'));
  if (await a.exists('#discard')) await a.click('#discard');

  // Focus stays on the control after a re-render.
  await a.run(`document.querySelector('#switch-release-notes').focus()`);
  await a.press(' ', 'Space');
  same('focus stays on the switch', await a.run(`document.activeElement?.id`), 'switch-release-notes');
  if (await a.exists('#discard')) await a.click('#discard');

  // Skills Files view: every skill in a list, and one skill's files and contents with the same choices and Apply all as the table.
  await a.click('#nav-skills');
  await a.click('#open-standup');
  await a.click('#files-standup');
  same('the Skills list has every skill', await a.run(`[...document.querySelectorAll('.list-row')].map(row => row.id)`), ['list-notes', 'list-release-notes', 'list-review', 'list-standup']);
  await a.click('#list-standup');
  check('the details show the skill', (await a.text('.pane-title')).includes('standup') && (await a.exists('#detail-scroll .details')), await a.text('.pane-title'));
  check('its folders and contents are shown', (await a.text('#detail-scroll .details')).includes('/.copilot/skills/standup') && (await a.text('#detail-scroll pre.content')).includes('name:'), await a.text('#detail-scroll'));
  const standupManaged = await a.run(`document.querySelector('#detail-switch-standup').getAttribute('aria-checked') === 'true'`);
  await a.click('#detail-switch-standup');
  check('a change here waits for Apply all', (await a.exists('#discard')) && (await a.exists('#list-standup.list-changed')));
  await a.shot('practice-skills');
  await a.click('#skills-table');
  same('the table shows the same pending change', await switchOn(a, 'standup'), !standupManaged);
  await a.click('#discard');
  same('discarding there clears it everywhere', await switchOn(a, 'standup'), standupManaged);
  // Undoing a copy choice puts Managed back as it was before the choice.
  const notesManaged = await switchOn(a, 'notes');
  // On a row whose copies differ, the Managed switch opens the copy choice first and stays off until a copy is picked.
  await a.click('#switch-notes');
  if (await a.exists('#use-notes-claude-cli') || await a.exists('#decide-notes')) {
    check('the switch on a differing row opens the choice instead of turning on', await a.exists('#use-notes-claude-cli') && await switchOn(a, 'notes') === notesManaged);
    await a.click('#use-notes-claude-cli');
    same('choosing a copy turns Managed on', await switchOn(a, 'notes'), true);
    await a.click('#undo-notes');
    same('undoing the choice puts Managed back', await switchOn(a, 'notes'), notesManaged);
  } else check('notes offers a copy choice here', false, await a.text('.ov-row[data-key="notes"]'));
  if (await a.exists('#discard')) await a.click('#discard');
  // Open details never repeat an id.
  await a.click('#open-review');
  same('no duplicate ids with details open', await a.run(`(() => { const ids = [...document.querySelectorAll('[id]')].map(node => node.id); return ids.filter((id, index) => ids.indexOf(id) !== index); })()`), []);
  await a.click('#open-review');
  // Slash finds in the Files view too.
  await a.click('#open-review');
  await a.click('#files-review, #diff-review');
  await a.run(`document.activeElement?.blur()`);
  await a.press('/', 'Slash');
  same('slash focuses find in the Files view', await a.run(`document.activeElement?.id`), 'skills-find');
  await a.click('#skills-table');

  // Keyboard and find.
  await a.press('/', 'Slash');
  same('slash focuses find', await a.run(`document.activeElement?.id`), 'find');
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = 'stand'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.settle();
  same('find filters', await rowKeys(a), ['standup']);
  await a.press('Escape');
  same('Escape clears find', (await rowKeys(a)).length, 4);
  // MCP: each tool's servers on one page; Apply all writes Copilot and Codex by editing only that entry; Claude Code waits for Write now.
  await a.click('#nav-mcp');
  same('MCP servers from every tool', (await rowKeys(a)).sort(), ['docs', 'files']);
  same('files is the same in Copilot and Codex, absent in Claude', [await cellState(a, 'files', 'copilot-cli'), await cellState(a, 'files', 'codex-cli'), await cellState(a, 'files', 'claude-cli')], ['present', 'present', 'absent']);
  const tomlBefore = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  await a.click('#manage-all');
  await applyAll(a);
  const copilotMcp = JSON.parse(readFileSync(join(practice, '.copilot/mcp-config.json'), 'utf8')).mcpServers;
  same('docs reached Copilot with its header as-is', copilotMcp.docs, { type: 'http', url: 'https://docs.example.test/mcp', headers: { Authorization: 'Bearer practice-token' }, tools: ['*'] });
  const tomlAfter = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  check('docs reached Codex, and config.toml kept its comment and the files table byte for byte', tomlAfter.startsWith(tomlBefore) && tomlAfter.includes('[mcp_servers.docs]') && tomlAfter.includes('url = "https://docs.example.test/mcp"'), tomlAfter);
  const claudeBefore = readFileSync(join(practice, '.claude.json'), 'utf8');
  check('Claude Code waits for Write now', (await a.text('.bands') ?? '').includes('Claude Code doesn’t have the files server yet') && !JSON.parse(claudeBefore).mcpServers.files, await a.text('.bands'));
  await a.shot('practice-mcp');
  await a.click('#mcp-write-claude');
  const claudeAfter = JSON.parse(readFileSync(join(practice, '.claude.json'), 'utf8'));
  same('Write now adds files to Claude Code and keeps its other settings', [claudeAfter.mcpServers.files?.command, claudeAfter.theme, claudeAfter.numStartups], ['npx', 'dark', 3]);
  // Write has its own Undo: the entry comes out again (it was new), the rest of the file stays, and files waits for Write again.
  check('Write offers Undo', await a.exists('#outcome-undo-write'), await a.text('.bands'));
  await a.click('#outcome-undo-write');
  const claudeUndone = JSON.parse(readFileSync(join(practice, '.claude.json'), 'utf8'));
  same('Undo takes files back out of Claude Code and keeps its other settings', [claudeUndone.mcpServers?.files, claudeUndone.theme], [undefined, 'dark']);
  check('and files waits for Write again', await a.exists('#mcp-write-claude'));
  await a.click('#mcp-write-claude');
  check('Write works again after Undo', JSON.parse(readFileSync(join(practice, '.claude.json'), 'utf8')).mcpServers.files?.command === 'npx');
  // An MCP edit spreads within seconds: settings files are watched, not left to the 20 s poll.
  const copilotFile = join(practice, '.copilot/mcp-config.json');
  writeFileSync(copilotFile, readFileSync(copilotFile, 'utf8').replace('"command": "npx"', '"command": "npx-edited"'));
  let mcpSpread = false;
  for (let tries = 0; tries < 24 && !mcpSpread; tries++) { await wait(250); mcpSpread = readFileSync(join(practice, '.codex/config.toml'), 'utf8').includes('command = "npx-edited"'); }
  check('an MCP edit in Copilot reaches Codex within 6 s', mcpSpread);

  // Agents: each tool's agents on one page. A plain agent is two-way; one with Claude-only fields reaches the others With limits.
  await a.click('#nav-agents');
  same('agents from every tool', (await rowKeys(a)).sort(), ['code-reviewer', 'release-notes']);
  await a.click('#manage-all');
  await applyAll(a);
  const copilotAgent = readFileSync(join(practice, '.copilot/agents/code-reviewer.agent.md'), 'utf8');
  check('code-reviewer reached Copilot with name, description and prompt, without Claude-only fields', copilotAgent.includes('description: Reviews a change') && copilotAgent.includes('You are a careful code reviewer.') && !copilotAgent.includes('tools:') && !copilotAgent.includes('model:'), copilotAgent);
  check('release-notes reached Claude Code from Codex', readFileSync(join(practice, '.claude/agents/release-notes.md'), 'utf8').includes('Group them as Added, Changed and Fixed.'));
  check('code-reviewer reached Codex as TOML', readFileSync(join(practice, '.codex/agents/code-reviewer.toml'), 'utf8').includes('developer_instructions = """'));
  await a.click('#open-code-reviewer');
  check('the details name the limits', /can’t hold its tools \(.*model \(.*edits only flow out/.test(await a.text('.details') ?? ''), await a.text('.details'));
  await a.shot('practice-agents');
  // One-way edge: an edit in a receiving tool stays there and stops updating; its amber box queues the source's copy again.
  const codexAgent = join(practice, '.codex/agents/code-reviewer.toml');
  const codexAgentBefore = readFileSync(codexAgent, 'utf8');
  writeFileSync(codexAgent, codexAgentBefore.replace('description = "', 'description = "Edited in Codex. '));
  await a.click('#header-refresh');
  check('the edited one-way copy stays and shows amber', readFileSync(codexAgent, 'utf8').includes('Edited in Codex.') && await a.exists('#cell-code-reviewer-codex-cli[data-state="stopped"]'));
  check('Claude Code’s copy was not touched', !readFileSync(join(practice, '.claude/agents/code-reviewer.md'), 'utf8').includes('Edited in Codex.'));
  // Keep my edit settles it: the box turns quiet and the warning count goes away; the box can still bring the source back.
  check('the stopped copy has its own notice with both choices', await a.exists('#stopped-keep-code-reviewer-codex-cli') && await a.exists('#stopped-use-code-reviewer-codex-cli'));
  check('while its notice shows, the toolbar says it without a link', (await a.text('.toolbar') ?? '').includes('1 copy stopped updating') && !(await a.exists('#go-stopped')), await a.text('.toolbar'));
  check('the status line no longer lists the stopped copy as receiving', /one-way to Copilot CLI · Codex’s copy stopped updating/.test(await a.text('.details-status') ?? ''), await a.text('.details-status'));
  await a.click('#stopped-dismiss-code-reviewer-codex-cli');
  check('deciding later keeps both choices in the Codex row', await a.exists('#stopped-keep-code-reviewer-codex-cli-details') && await a.exists('#stopped-use-code-reviewer-codex-cli-details') && await a.exists('#go-stopped'));
  await a.click('#stopped-keep-code-reviewer-codex-cli-details');
  check('keeping the edit is said with an Undo, and the toolbar counts it', /Codex keeps its own edit of code-reviewer/.test(await a.text('main') ?? '') && await a.exists('#outcome-undo-keep') && /Synced · 1 kept edit/.test(await a.text('.toolbar') ?? ''), await a.text('.toolbar'));
  check('Keep my edit clears the warning and leaves the edit', await a.exists('#cell-code-reviewer-codex-cli[data-state="kept"]') && !(await a.text('.toolbar') ?? '').includes('stopped updating') && readFileSync(codexAgent, 'utf8').includes('Edited in Codex.'));
  await a.click('#cell-code-reviewer-codex-cli');
  await applyAll(a);
  check('the result says Codex resumed, not that an agent was newly managed', /Codex has Claude Code’s copy of code-reviewer again/.test(await a.text('main') ?? ''), (await a.text('main') ?? '').slice(0, 300));
  check('its amber box puts Claude Code’s copy back in Codex', !readFileSync(codexAgent, 'utf8').includes('Edited in Codex.') && !(await a.exists('#cell-code-reviewer-codex-cli[data-state="stopped"]')), readFileSync(codexAgent, 'utf8'));
  check('the resume result offers to restore Codex’s edit', await a.exists('#outcome-restore-edit'));
  await a.click('#outcome-restore-edit');
  check('Restore Codex’s edit puts the edit back, and the copy stops again', readFileSync(codexAgent, 'utf8').includes('Edited in Codex.') && await a.exists('#cell-code-reviewer-codex-cli[data-state="stopped"]'), JSON.stringify(await a.all('[id^=cell-code-reviewer]', 'e.id + "=" + e.dataset.state')) + ' ' + (await a.text('main'))?.slice(0, 400));
  await a.click('#nav-skills');

  // Plugins: a folder marketplace is browsed (its README, each plugin's contents) and installs are chosen, then applied.
  const market = join(scratch, 'market');
  writeMarket(market, 'ck-test-market');
  await a.click('#nav-plugins');
  check('no marketplaces yet', (await a.text('#plugins-scroll')).includes('No marketplaces yet'));
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(market)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
  check('the marketplace is listed and opened, with its plugins', (await a.text('.market-list')).includes('ck-test-market') && await a.exists('[data-plugin="document-tools"]') && (await a.text('.market-page-head')).includes('By Platform team'), await a.text('#plugins-scroll'));
  check('a root-level entry counts only the skills it lists', (await a.text('[data-plugin="starter-skills"]')).includes('1 skill'), await a.text('[data-plugin="starter-skills"]'));
  // Read ahead from its own repository when the network allows: what it holds; otherwise where it comes from.
  check('a plugin elsewhere says what it holds, that it is reading it, or where it comes from', /From GitHub: github\/copilot-plugins\/plugins\/spark|Reading what it holds…|\d+ skills?/.test(await a.text('[data-plugin="spark"]')), await a.text('[data-plugin="spark"]'));
  same('every tool column shows, none installed', await a.run(`[...document.querySelectorAll('[data-plugin="document-tools"] .cell-button')].map(cell => cell.dataset.state)`), ['absent', 'absent', 'absent']);
  await a.click('#market-tab-about');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-readme-body')); tries++) await wait(100);
  check('About shows the README, with its HTML dropped and its link kept', (await a.text('.plugin-readme-body')).includes('What is inside') && !(await a.text('.plugin-readme-body')).includes('<p') && await a.exists('.plugin-readme-body .md-link'), await a.text('.plugin-readme-body'));
  await a.click('#market-tab-plugins');
  await a.click('#popen-0-release-helper');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-group')); tries++) await wait(100);
  check('a plugin page names what it holds', /release-notes[\s\S]*Drafts release notes/.test(await a.text('.plugin-page')) && (await a.text('.plugin-page')).includes('release-reviewer') && (await a.text('.plugin-page')).includes('Runs on PreToolUse'), await a.text('.plugin-page'));
  await a.click('#plugin-back');
  await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-readme')); tries++) await wait(100);
  check('and shows the plugin’s own README and skill descriptions', (await a.text('.plugin-page')).includes('Two skills for everyday documents') && (await a.text('.plugin-page')).includes('Reads PDF files'), await a.text('.plugin-page'));
  await a.click('#pinstall-0-document-tools');
  same('Choose all only chooses: every box waits for Apply all', await a.run(`[...document.querySelectorAll('.plugin-tool .cell-button')].map(cell => cell.dataset.state)`), ['install', 'install', 'install']);
  check('the change bar counts what will run', /1 plugin to change · 3 installs/.test(await a.text('.toolbar') ?? ''), await a.text('.toolbar'));
  await a.click('#pcell-0-document-tools-codex-cli');
  same('clicking a chosen box takes it back', await a.run(`[...document.querySelectorAll('.plugin-tool .cell-button')].map(cell => cell.dataset.state)`), ['install', 'install', 'absent']);
  await a.click('#pcell-0-document-tools-codex-cli');
  await a.click('#plugins-apply');
  check('a refused install is reported as such', /Could not add the marketplace\. It stopped with exit code 9/.test(await a.text('.plugin-problems')), await a.text('.bands'));
  await a.shot('practice-plugins');
  same('and nothing is claimed installed', await a.run(`[...document.querySelectorAll('.plugin-tool .cell-button')].filter(cell => cell.dataset.state === 'installed').length`), 0);
  await a.click('#plugin-back');
  await a.click('#forget-0');
  check('Remove forgets it here only', (await a.text('#plugins-scroll')).includes('No marketplaces yet'));
  // Instructions (INS-01, INS-02): each tool's own file, a diff before saving, the replaced version kept.
  await a.click('#nav-instructions');
  for (let tries = 0; tries < 40 && !(await a.exists('#ins-edit-claude-cli')); tries++) await wait(100);
  check('Instructions show Claude Code’s CLAUDE.md and who reads it', (await a.text('#instructions-scroll')).includes('Explain the plan in two or three lines') && (await a.text('#instructions-scroll')).includes('Claude Code reads this in every session'), await a.text('#instructions-scroll'));
  check('a tool with no file says so', (await a.text('#instructions-scroll')).includes('No file yet'));
  await a.click('#ins-edit-claude-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value = area.value + '- Edited in Central Knot.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli');
  check('the change is shown before saving', (await a.text('.ins-diff .ins-added')).includes('- Edited in Central Knot.') && (await a.text('.ins-review-title')).includes('1 line added'), await a.text('.ins-editor'));
  await a.click('#ins-save-claude-cli');
  await wait(400);
  check('Save writes CLAUDE.md', readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('- Edited in Central Knot.'));
  check('and keeps the version it replaced', (await a.text('#instructions-scroll')).includes('Earlier versions (1)'), await a.text('#instructions-scroll'));
  await a.click('#outcome-undo-instruction');
  for (let tries = 0; tries < 30 && readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('- Edited in Central Knot.'); tries++) await wait(100);
  check('Undo puts the saved-over text back, keeping the undone save as a version', !readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('- Edited in Central Knot.') && (await a.text('#instructions-scroll')).includes('Earlier versions (2)'), await a.text('#instructions-scroll'));
  // An unsaved draft asks before it is thrown away.
  await a.click('#ins-edit-claude-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value = area.value + 'draft'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-cancel-claude-cli');
  check('Cancel with changes asks first', await a.exists('#ins-discard-claude-cli') && await a.exists('#ins-text-claude-cli'));
  await a.click('#ins-discard-claude-cli');
  check('Discard closes the editor without writing', !(await a.exists('#ins-text-claude-cli')) && !readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('draft'));
  // Settings: the appearance choice changes the page's colour scheme at once, and System is the default.
  await a.click('#nav-settings');
  const dark = () => a.run(`matchMedia('(prefers-color-scheme: dark)').matches`);
  check('Settings shows the three appearances, System chosen', await a.exists('#appearance-system[aria-checked="true"]') && await a.exists('#appearance-light') && await a.exists('#appearance-dark'));
  await a.click('#appearance-dark');
  await wait(200);
  check('Dark makes the page dark', await dark() === true && await a.exists('#appearance-dark[aria-checked="true"]'));
  await a.shot('settings-dark');
  await a.click('#appearance-light');
  await wait(200);
  check('Light makes the page light', await dark() === false);
  await a.shot('settings-light');
  await a.click('#appearance-system');
  check('System can be chosen again', await a.exists('#appearance-system[aria-checked="true"]'));
  await a.click('#nav-skills');
  same('no page errors, practice', a.pageErrors, []);
  // With no window at all, Central Knot keeps running from the menu bar and sync keeps going (PLT-04). A page-made close
  // destroys the window outright (a real close only hides it), which is the stronger case: background work needs no window.
  await a.run(`setTimeout(() => window.close(), 50), true`);
  await wait(800);
  same('with the window gone the app keeps running', a.child.exitCode, null);
  const notesToml = join(practice, '.codex/agents/release-notes.toml');
  writeFileSync(notesToml, readFileSync(notesToml, 'utf8').replace('one line each.', 'one line each. Edited with no window.'));
  let spreadClosed = false;
  for (let tries = 0; tries < 80 && !spreadClosed; tries++) { await wait(250); spreadClosed = readFileSync(join(practice, '.claude/agents/release-notes.md'), 'utf8').includes('Edited with no window.'); }
  check('an agent edit spreads in the background with no window', spreadClosed);
  await a.quit();
}

async function realHomeFlow() {
  const before = { rich: tree(join(CLAUDE, 'rich')), unrelated: readFileSync(join(HOME, '.claude/unrelated.json'), 'utf8') };
  const a = await launch();
  await a.click('#home-actual');
  await a.click('#nav-skills');
  same('the disposable HOME is what "this Mac" reads', await a.run(`document.querySelector('.status-home').title`), HOME);
  same('real home is never the machine’s own', HOME.startsWith(scratch), true);
  await a.click('#nav-harnesses');
  const tools = await a.text('#harnesses-scroll');
  check('versions probed', tools.includes('2.1.309') && tools.includes('1.0.107') && tools.includes('0.142.3'), tools.slice(0, 300));
  await a.click('#harness-codex-cli');
  await a.click('#harness-tab-about');
  const codexAbout = await a.text('#harness-body');
  check('Codex says where new copies go', codexAbout.includes('/.codex/skills'), codexAbout.slice(0, 600));
  await a.click('#nav-skills');
  const rows = await rowKeys(a);
  for (const name of ['rich', '名前-skill', '.dot-skill', 'linked', 'from-copilot', 'has-link']) check(`row for ${name}`, rows.includes(name), rows);
  check('names keep their case', (await a.text('.ov-row[data-key="mixedcase"]')).includes('MixedCase'), await a.text('.ov-row[data-key="mixedcase"]'));
  check('malformed skill is no row', !rows.includes('bad-yaml'));
  same('the linked skill is already one copy', [await cellState(a, 'linked', 'claude-cli'), await cellState(a, 'linked', 'copilot-cli')], ['present', 'present']);
  same('refused names and dot folders cannot go to Copilot', [await cellState(a, '名前-skill', 'copilot-cli'), await cellState(a, '.dot-skill', 'copilot-cli'), await cellState(a, 'plain', 'copilot-cli')], ['cannot', 'cannot', 'cannot']);
  check('a skill with a link inside is held', await a.exists('.ov-row[data-key="has-link"] .held-pill'));
  await a.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  await a.click(`[id="open-very-long-${'n'.repeat(150)}"]`);
  const fits = await a.run(`({ page: document.documentElement.scrollWidth, window: innerWidth })`);
  check('a very long name stays on screen at 960', fits.page <= fits.window, fits);
  await a.send('Emulation.clearDeviceMetricsOverride');
  await a.click(`[id="open-very-long-${'n'.repeat(150)}"]`);
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
  same('Codex gets the same bytes in its own folder', tree(join(CODEX, 'rich')), before.rich);
  check('a dot folder never reaches Codex', !existsSync(join(CODEX, '.dot-skill')));
  same('nothing new in the shared .agents folder', readdirSync(AGENTS).sort(), ['linked']);
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
  check('expected holds do not raise a warning band', !(await a.text('.bands') ?? '').includes('does not load'), await a.text('.bands'));
  same('a held skill shows it cannot go to the tool that lacks it', await cellState(a, 'has-link', 'copilot-cli'), 'cannot');
  await a.shot('real-applied');
  same('no page errors, real home', a.pageErrors, []);
  await a.quit();
  // The next launch opens the home last used, so a start at sign-in syncs it again.
  const again = await launch();
  await again.settle();
  same('a new launch opens the home last used', await again.run(`document.querySelector('.status-home')?.title`), HOME);
  await again.quit();

  const record = join(HOME, '.central-knot/sync.json');
  const good = readFileSync(record, 'utf8');
  writeFileSync(record, '{ damaged');
  let b = await launch();
  await b.click('#home-actual');
  await b.click('#nav-skills');
  check('damaged record is shown', (await b.text('.bands') ?? '').includes('damaged'), await b.text('.bands'));
  await b.click(`.ov-row[data-key="private-one"] .switch`);
  same('damaged record keeps Apply all off', await b.run(`document.querySelector('#apply')?.disabled ?? true`), true);
  await b.quit();
  writeFileSync(record, good);
  b = await launch(join(scratch, 'other-data'));
  await b.click('#home-actual');
  await b.click('#nav-skills');
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
  await a.click('#nav-skills');
    // Until the choices are on record (a kill can land before Apply all saves them), choose again; after that, opening catches up.
    const record = join(HOME, '.central-knot/sync.json');
    const chosen = existsSync(record) && (() => { try { return Object.values(JSON.parse(readFileSync(record, 'utf8')).items).some(item => item.state === 'shared'); } catch { return false; } })();
    if (!chosen) {
      await a.click('#manage-all');
      await a.run(`document.querySelector('#apply').click()`);
    } else await a.run(`document.querySelector('#header-refresh').click()`);
    await wait(30 + Math.round(round * 700 / Math.max(1, crashRounds - 1)) + randomInt(40));
    await a.crash();
    if (readdirSync(COPILOT).length < 40) interrupted++;
    for (const name of readdirSync(COPILOT)) {
      check(`round ${round}: nothing half-written in a loaded folder (${name})`, !name.startsWith('.'), name);
      if (expected[name]) same(`round ${round}: ${name} is complete or absent`, tree(join(COPILOT, name)), expected[name]);
    }
    if (existsSync(record)) { try { JSON.parse(readFileSync(record, 'utf8')); passes++; } catch { check(`round ${round}: record stays valid`, false); } }
  }
  const onRecord = existsSync(join(HOME, '.central-knot/sync.json'));
  const a = await launch(join(scratch, 'crash-data'));
  await a.click('#home-actual');
  await a.click('#nav-skills');
  // If every kill landed before the choices were saved, there is nothing to catch up: finish with a real Apply all.
  if (!onRecord) { await a.click('#manage-all'); await applyAll(a); }
  console.log(`crash finish: ${onRecord ? 'caught up on open' : 'no choices were saved before the kills; applied again'}`);
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
  await harnessFlow();
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

// A screenshot tour of the real app on the Practice copy.
// Clicks are sent as pointer clicks (detail 1), as a mouse makes them; keyboard steps use real Tab presses.
// Usage: node scripts/ui-tour.mjs <outDir> [--electron] [--no-sandbox] [--only shell,skills,…] [--full]
// - With no switch it is the light tour (folder `light`): the app opens and each page is opened once, one picture each,
//   in well under a minute. It fails if a page doesn't open or throws. This is the run for every change.
// - `--only a,b` runs the named feature sections: the ones a change touched.
// - `--full` runs every feature section, hundreds of pictures over about ten minutes. For a new release only.
// Features, in the order they run: shell, skills, sync, mcp, agents, plugins, profiles, sync-everything, plugin-skills, plugin-updates,
// plugin-versions, parts, plugin-items, instructions, sizes (four tools; every page at 860×560 with the sidebar as a rail and
// open, then 1280×800, 1728×1117 and 2560×1440, each in dark and in light), shared-copies, missing (a folder home with only
// Claude Code and Codex, so Copilot CLI and Pi appear nowhere as options), updates, settings, base, scroll, harnesses and repo.
// Each feature gets its own folder with NN-name.png (2x), NN-name.txt (the page's visible text) and tour.md (what each step did).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeClaudeInstall, writeMarket } from './fixture-market.mjs';
import { serveReleases } from './update-fixture.mjs';
import { connect, DAY, debugPorts, holdQueue, keepFor, mainProcess, refocus, standIn } from './cdp.mjs';

const args = process.argv.slice(2);
const out = resolve(args.find(arg => !arg.startsWith('--')) ?? 'ui-tour');
const flag = name => args.includes(name);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined;
const full = flag('--full');
const root = resolve(import.meta.dirname, '..');
const command = flag('--electron') ? join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim()) : join(root, 'release/Central Knot-darwin-arm64/Central Knot.app/Contents/MacOS/Central Knot');
const scratch = mkdtempSync(join(tmpdir(), 'ck-tour-'));
const HOME = join(scratch, 'home');
mkdirSync(HOME, { recursive: true });
// On Linux the file manager is a stand-in that opens nothing.
mkdirSync(join(scratch, 'bin'));
writeFileSync(join(scratch, 'bin/xdg-open'), '#!/bin/sh\nexit 0\n');
chmodSync(join(scratch, 'bin/xdg-open'), 0o755);

// Every app this run started is closed when the run ends, however it ends: a failed or interrupted run must not leave
// an app holding a debug port that a later run could attach to.
const launched = new Set();
process.on('exit', () => { for (const child of launched) { try { child.kill('SIGKILL'); } catch { /* already gone */ } } });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

/** What a page threw, in any app this run started. */
const pageErrors = [];
async function launch(more = {}) {
  const env = { HOME, PATH: `${join(scratch, 'bin')}:/usr/bin:/bin`, TMPDIR: join(scratch, 'tmp'), CK_PLUGIN_UPDATES_EVERY_MS: 'never', ...more };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  // The app picks its own free debug ports (port 0) and says them, so no other run on this machine can be on them (cdp.mjs
  // debugPorts). A dev run also opens its main process, so the tour can show states only an installed app reaches (see Settings).
  const child = spawn(command, [...(flag('--electron') ? [root, '--inspect=0'] : []), '--remote-debugging-port=0', `--user-data-dir=${join(scratch, 'data')}`, '--practice-copy', ...(flag('--no-sandbox') ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  launched.add(child);
  child.once('exit', () => launched.delete(child));
  const { port, inspect } = await debugPorts(child, flag('--electron'));
  let target;
  for (let attempt = 0; attempt < 150 && !target; attempt++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page'); } catch { /* starting */ } if (!target) await wait(200); }
  if (!target) throw new Error('The app opened no window.');
  const page = await connect(target.webSocketDebuggerUrl, data => { if (data.method === 'Runtime.exceptionThrown') pageErrors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text); });
  const { send, run } = page;
  await send('Runtime.enable');
  // A page that never settles fails the tour instead of holding it open.
  const settle = async () => { await wait(150); await run(`new Promise((done, fail) => { const end = Date.now() + 30000; const c = () => (document.body.dataset.ready === 'true' || document.querySelector('.empty-state')) && document.body.dataset.busy !== 'true' ? done(true) : Date.now() > end ? fail(new Error('The page did not settle within 30 s.')) : setTimeout(c, 25); c(); })`); await wait(200); };
  const viewport = { width: 1280, height: 800 };
  /** Sizes the page as the window would be: the app's layout follows window.innerWidth and its resize event. */
  const size = async (width, height) => {
    Object.assign(viewport, { width, height });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
    await run(`window.dispatchEvent(new Event('resize'))`);
    await settle();
  };
  await size(1280, 800);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await settle();
  return {
    run, send, settle, size, viewport, inspect,
    main: inspect && (() => mainProcess(inspect)),
    // A pointer click, as a mouse makes it (detail 1): pages tell a keyboard press (detail 0) apart to keep focus in place.
    click: async selector => { await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); })()`); await settle(); },
    has: selector => run(`!!document.querySelector(${JSON.stringify(selector)})`),
    press: async key => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Escape: 27, Enter: 13 }[key] }); await settle(); },
    theme: async value => { await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }); await settle(); },
    quit: () => { page.close(); child.kill('SIGKILL'); },
  };
}

/**
 * One request from the page slowed or made to fail until `restore`, through the main process's debugger (development
 * runs only, cdp.mjs), so the tour can show a page reading again, or a read that failed. Null in a packaged run.
 */
async function requestHandles(a) {
  if (!a.main) return null;
  const main = await a.main();
  const handlers = 'electron.ipcMain._invokeHandlers';
  return {
    slow: (channel, ms) => main.run(`(() => { const real = ${handlers}.get(${JSON.stringify(channel)}); globalThis.ckAside = real; ${handlers}.set(${JSON.stringify(channel)}, (...args) => new Promise(done => setTimeout(done, ${ms})).then(() => real(...args))); return true; })()`),
    fail: channel => main.run(`(() => { globalThis.ckAside = ${handlers}.get(${JSON.stringify(channel)}); ${handlers}.set(${JSON.stringify(channel)}, () => { throw new Error('Refused for the tour.'); }); return true; })()`),
    restore: channel => main.run(`(() => { ${handlers}.set(${JSON.stringify(channel)}, globalThis.ckAside); delete globalThis.ckAside; return true; })()`),
    close: main.close,
  };
}

let feature = '';
let step = 0;
const begin = name => { feature = name; step = 0; mkdirSync(join(out, name), { recursive: true }); writeFileSync(join(out, name, 'tour.md'), `# ${name}\n\nEach step: what was just done, then the screenshot and visible text with the same number.\n\n`); };
const wanted = name => only ? only.includes(name) : full;
/** Takes a screenshot. `pointer`: where the mouse rests for it (to show a hover); by default out of the way, in the corner. */
async function shot(a, name, caption, pointer = { x: 2, y: a.viewport.height - 2 }) {
  step++;
  const base = `${String(step).padStart(2, '0')}-${name}`;
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer });
  await wait(120);
  const reply = await a.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, feature, `${base}.png`), Buffer.from(reply.result.data, 'base64'));
  writeFileSync(join(out, feature, `${base}.txt`), await a.run('document.body.innerText'));
  appendFileSync(join(out, feature, 'tour.md'), `${step}. **${base}**: ${caption}\n`);
}
const waitFor = async (a, expression, ms = 8000) => { for (let spent = 0; spent < ms; spent += 250) { if (await a.run(expression)) return true; await wait(250); } return false; };
const edit = (path, change) => writeFileSync(path, change(readFileSync(path, 'utf8')));
// Types a marketplace source into "Add a marketplace" (opening the box first if needed) and clicks Add.
async function addMarketplace(a, source) {
  // Plugins reads its data when it opens, so the form may not be drawn yet.
  await waitFor(a, `!!document.querySelector('#marketplace-source, #open-add-marketplace')`, 20000);
  if (!(await a.has('#marketplace-source'))) await a.click('#open-add-marketplace');
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(source)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
}

let a = await launch();
let practice = await a.run(`document.querySelector('.status-home').title`);
/**
 * Starts the app again on a clean slate for a section that needs one: new app data, an empty HOME (no stand-in CLIs) and,
 * with the new launch, a new Practice copy. Before any section has run, the first launch is already clean.
 */
async function fresh(more = {}, keepData = false) {
  if (!feature && !Object.keys(more).length) return;
  a.quit();
  await wait(500);
  for (const folder of keepData ? [] : [join(scratch, 'data'), HOME]) rmSync(folder, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
  a = await launch(more);
  practice = await a.run(`document.querySelector('.status-home').title`);
}

// ---------- The library pages' pictures (Skills, Agents) ----------
/** The four window sizes every state of a library page is pictured at. */
const SIZES = [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]];
/** Scrolls what a picture is about into view: its middle (`block` center), or its top where its own scroll margin puts it. */
const show = (selector, block = 'center') => a.run(`document.querySelector('${selector}')?.scrollIntoView({ block: '${block}' })`);
/** One state at every size (and, `light`, once in the light appearance), then back to 1280×800. `at`: what to scroll into view at each size. */
async function atEverySize(name, caption, light = false, at = undefined, block = 'center') {
  for (const [width, height] of SIZES) { await a.size(width, height); if (at) await show(at, block); await shot(a, `${name}-${width}`, `${caption} (${width}×${height})`); }
  await a.size(1280, 800);
  if (at) await show(at, block);
  if (light) { await a.theme('light'); await shot(a, `${name}-light`, `${caption} (light appearance)`); await a.theme('dark'); }
}
/** Where the pointer rests to hover an element, at its middle. */
const middleOf = selector => a.run(`(() => { const box = document.querySelector('${selector}').getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }; })()`);
/** Keyboard focus on an element, with its focus ring (as a Tab press gives it). */
const focusOn = selector => a.run(`document.querySelector('${selector}')?.focus({ focusVisible: true })`);
const refresh = async () => { await a.click('#header-refresh'); await a.settle(); };
/** A row's details, opened or closed whichever way they are now. */
const isOpen = key => a.has(`.ov-row[data-key="${key}"][aria-expanded="true"]`);
const openRow = async key => { if (!(await isOpen(key))) { await a.click(`#open-${key}`); await a.settle(); } };
const closeRow = async key => { if (await isOpen(key)) { await a.click(`#open-${key}`); await a.settle(); } };
/** Waits until the row's switch is on. */
const switchOn = key => waitFor(a, `document.querySelector('#switch-${key}')?.getAttribute('aria-checked') === 'true'`, 15000);
/** Turns a row on: Add where it is found, its switch where it is off (in Central Knot only); nothing where it is on. */
const turnOnRow = async key => { if (await a.has(`#add-${key}, #switch-${key}:not([aria-checked="true"])`)) await a.click(`#add-${key}, #switch-${key}`); };

// ---------- The light tour: the app opens, and so does each page ----------
if (only ? only.includes('light') : !full) {
  begin('light');
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  for (const name of ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'profiles', 'history', 'repo', 'settings']) {
    if (!(await a.has(`#nav-${name}`))) throw new Error(`The sidebar has no ${name} page.`);
    await a.click(`#nav-${name}`);
    if (!(await waitFor(a, `document.querySelector('#nav-${name}')?.getAttribute('aria-current') === 'page'`))) throw new Error(`The ${name} page did not open.`);
    await shot(a, name, `Clicked "${name}" in the sidebar, on the Practice copy at 1280×800.`);
  }
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- First run, homes and navigation ----------
if (wanted('shell')) {
  begin('shell');
  await shot(a, 'first-launch-dark', 'The app as it first opens (dark appearance): the Overview, on the Practice copy, a throwaway set of sample skills, MCP servers and agents.');
  await a.theme('light'); await shot(a, 'first-launch-light', 'The same, in the light appearance.'); await a.theme('dark');
  await a.click('#nav-skills'); await shot(a, 'skills-page', 'Clicked "Skills" in the sidebar: the skills table.');
  await a.click('#nav-harnesses'); await shot(a, 'harnesses-page', 'Clicked "Harnesses": each tool found, with what it has.');
  await a.click('#nav-history'); await shot(a, 'history-empty', 'Clicked "History" before anything happened.');
  await a.click('#nav-overview');
  if (await a.has('#intro-dismiss')) { await a.click('#intro-dismiss'); await shot(a, 'intro-dismissed', 'Dismissed the practice-copy note on the Overview.'); }
  if (await a.has('#sidebar-toggle')) { await a.click('#sidebar-toggle'); await shot(a, 'sidebar-collapsed', 'Clicked the sidebar toggle (top left) to collapse the sidebar.'); await a.click('#sidebar-toggle'); }
  // The tour's "real home" is an empty throwaway folder: with no tool found there (Linux), the sidebar has no Skills.
  await a.click('#home-actual'); if (await a.has('#nav-skills')) await a.click('#nav-skills');
  await shot(a, 'this-macs-home', 'Clicked "This Mac\'s home" ("This computer\'s home" off macOS) at the bottom left. (In this tour the "real home" is an empty throwaway folder: only tools installed on this machine are found there.)');
  await a.click('#home-fixture'); await a.click('#nav-overview'); await shot(a, 'back-to-practice', 'Clicked "Practice copy" to go back, then "Overview".');
}

// ---------- Skills ----------
// Skills are on Central Knot's library, as agents are (src/library.ts, src/skills.ts): every state of a skill's row, at four sizes.
if (wanted('skills')) {
  begin('skills');
  const folderIn = (tool, key) => join(practice, { claude: '.claude/skills', copilot: '.copilot/skills', codex: '.codex/skills' }[tool], key);
  const putSkill = (tool, key, body) => { mkdirSync(folderIn(tool, key), { recursive: true }); writeFileSync(join(folderIn(tool, key), 'SKILL.md'), `---\nname: ${key}\ndescription: ${body}\n---\n\n${body}\n`); };
  await a.click('#nav-skills');
  await atEverySize('found', 'Clicked "Skills". Every skill is found: a tool has it and Central Knot doesn’t yet, so each row has Add where an On row has its switch; review’s copies differ', true);
  await shot(a, 'found-hover', 'The pointer on notes’s Add: its tooltip says a click adds it to Central Knot and puts it in every tool.', await middleOf('#add-notes'));
  await openRow('notes');
  await atEverySize('found-open', 'Opened notes while it is found: its status, what every tool it is on in gets of a skill (its whole folder), each tool’s line, and Files and contents', true, '.details');
  await closeRow('notes');
  // Taken in: written to every tool, its whole folder. Its Undo takes it out again: found once more, the tools it was found in keeping theirs.
  await a.click('#add-notes'); await switchOn('notes');
  await atEverySize('taken-in', 'Clicked notes’s Add: it is in Central Knot now, and on in all 3 tools; the strip at the top says so, with Undo', false, '.bands');
  await a.click('#outcome-undo'); await a.settle();
  await atEverySize('taken-in-undone', 'Clicked Undo in that strip: the copy Codex got is gone, Claude Code and Copilot CLI keep theirs, and notes is found again', false, '.bands');
  await a.click('#add-notes'); await switchOn('notes');
  // Off: out of every tool, kept in Central Knot.
  await a.click('#switch-notes'); await a.settle();
  await atEverySize('off', 'Turned notes off: its folder left every tool; its row stays under Off, "in Central Knot only"; the result offers Undo', true);
  await openRow('notes');
  await atEverySize('off-open', 'Opened the Off row: its status, each tool with no copy while it is off, its versions, and Delete from Central Knot with how it differs from Off', true, '.details');
  await a.click('#switch-notes'); await switchOn('notes');
  await closeRow('notes');
  // The copy question: review's copies differ.
  await a.click('#add-review'); await a.settle();
  await atEverySize('copy-question', 'Clicked review’s Add: its copies differ, so the row asks which copy every tool uses, quoting each copy’s first line and saying what choosing it does. Nothing is written yet', true, '.details-differs');
  await a.click('#use-review-copilot-cli'); await switchOn('review');
  await openRow('review');
  await atEverySize('chosen-versions', 'Clicked "Use this copy" on Copilot CLI’s: review is in Central Knot, on in all 3 tools; opened, its versions list Copilot CLI’s copy (current) and Claude Code’s, kept as a version', true, '.version-row');
  await a.click('#version-read-review-1');
  await waitFor(a, `!!document.querySelector('.version-read')`);
  await atEverySize('version-read', 'Clicked Read on Claude Code’s version: its SKILL.md, what differs from the current version marked', false, '.version-read');
  await a.click('#version-read-review-1');
  await closeRow('review');
  // Partial: kept out of one tool by its switch in the opened row.
  for (const key of ['release-notes', 'standup']) { await a.click(`#add-${key}`); await switchOn(key); }
  await openRow('standup');
  await a.click('#enable-standup-codex-cli'); await a.settle();
  await atEverySize('partial', 'Turned release-notes and standup on, then opened standup and turned it off in Codex alone: its folder left Codex; the row says "in 2 of 3 tools · kept out of Codex" and its switch is drawn partial', true, '.ov-row[data-key="standup"]');
  await a.click('#enable-standup-codex-cli'); await a.settle();
  await closeRow('standup');
  // A tool's own switch, set in its settings: read, never undone; the opened row can clear it.
  const claudeSettings = join(practice, '.claude/settings.json');
  const settingsBefore = existsSync(claudeSettings) ? readFileSync(claudeSettings, 'utf8') : '{}';
  writeFileSync(claudeSettings, JSON.stringify({ ...JSON.parse(settingsBefore), skillOverrides: { 'release-notes': 'off' } }, null, 2));
  await refresh();
  await openRow('release-notes');
  await atEverySize('switched-off', 'Outside the app, Claude Code’s settings turned release-notes off, then Refresh: its folder stays; Claude Code is not counted as on (status line, a partial switch, its own mark); its line says "Switched off" and offers Let Claude Code load it', true, '.details');
  await a.click('#clear-switch-release-notes-claude-cli'); await a.settle();
  await atEverySize('switch-cleared', 'Clicked "Let Claude Code load it": Claude Code loads it again; the strip says so, with Undo (which sets that switch again)', false, '.bands');
  await closeRow('release-notes');
  // An edit made in a tool becomes the current version and reaches the others; its notice offers Undo.
  writeFileSync(join(folderIn('codex', 'standup'), 'SKILL.md'), `${readFileSync(join(folderIn('codex', 'standup'), 'SKILL.md'), 'utf8')}\nEdited in Codex.\n`);
  await refresh();
  await atEverySize('edit-notice', 'Outside the app, standup’s SKILL.md was edited in Codex, then Refresh: the edit is the current version now, in Claude Code and Copilot CLI too; the notice offers Undo', false, '.sync-notices');
  // A folder deleted by hand turns the skill off everywhere; Central Knot keeps it, and the notice offers Turn on.
  rmSync(folderIn('copilot', 'release-notes'), { recursive: true, force: true });
  await refresh(); await wait(2300); await refresh();
  await atEverySize('deleted-by-hand', 'Outside the app, release-notes’s folder was deleted in Copilot CLI, then Refresh (twice, past the settle window): it is off everywhere, kept in Central Knot; the notice offers Turn on', true, '.sync-notices');
  await a.click('#switch-release-notes'); await switchOn('release-notes');
  // Found skills that can't go everywhere: a folder that can't be copied as it is, and a name Copilot CLI won't load.
  putSkill('claude', 'has-link', 'A skill with a link inside.');
  symlinkSync('SKILL.md', join(folderIn('claude', 'has-link'), 'alias'));
  mkdirSync(folderIn('claude', 'plain-notes'), { recursive: true }); writeFileSync(join(folderIn('claude', 'plain-notes'), 'SKILL.md'), 'Notes with no frontmatter, which Copilot CLI and Codex won’t load.\n');
  await refresh();
  await openRow('has-link');
  await atEverySize('cannot-copy', 'A skill in Claude Code with a link inside its folder: its row says it can’t be taken in, its Add looks unavailable, and Claude Code’s line says why and what to do (replace the link with the file, then Refresh)', true, '.details');
  await closeRow('has-link');
  await openRow('plain-notes');
  await atEverySize('cannot-take', 'A skill with no frontmatter in Claude Code, found: the status says it goes nowhere else, Copilot CLI and Codex can’t take it; their marks (their own) and lines say why, in the same words', false, '.details');
  await closeRow('plain-notes');
  rmSync(folderIn('claude', 'has-link'), { recursive: true, force: true }); rmSync(folderIn('claude', 'plain-notes'), { recursive: true, force: true });
  await refresh();
  // Another way: a copy in ~/.agents/skills, which Copilot CLI and Codex read; Claude Code gets Central Knot's copy.
  mkdirSync(join(practice, '.agents/skills/shared-notes'), { recursive: true });
  writeFileSync(join(practice, '.agents/skills/shared-notes/SKILL.md'), '---\nname: shared-notes\ndescription: Kept in the shared folder.\n---\n\nKept in the shared folder.\n');
  await refresh();
  await a.click('#add-shared-notes'); await switchOn('shared-notes');
  await openRow('shared-notes');
  await atEverySize('another-way', 'A skill in ~/.agents/skills, taken in: the strip says it is on in Claude Code and that Copilot CLI and Codex have it another way; their lines say "Another way" (no switch: nothing of Central Knot’s goes there) and offer Take over…', true, '.details');
  await a.click('#take-over-shared-notes-copilot-cli');
  await atEverySize('take-over-armed', 'Clicked "Take over…" on Copilot CLI’s line: its armed line says which folder goes, which tools get Central Knot’s copy instead, that other apps won’t find it there, and that it has no Undo', false, '.details');
  await a.click('#take-over-confirm-shared-notes-copilot-cli'); await a.settle();
  await atEverySize('taken-over', 'Clicked "Take over now": the shared copy is gone, Copilot CLI and Codex have Central Knot’s copy; the strip says so and that it has no Undo', false, '.bands');
  await closeRow('shared-notes');
  // Delete from Central Knot, armed, then done.
  await openRow('shared-notes');
  await a.click('#delete-shared-notes');
  await atEverySize('delete-armed', 'Clicked "Delete from Central Knot…": it says what happens, and for how long History can restore it', false, '#delete-note-shared-notes');
  await a.click('#delete-confirm-shared-notes'); await a.settle();
  await shot(a, 'deleted', 'Clicked "Delete it now": shared-notes is out of every tool and off the page; History can restore it.');
  // The Files view.
  await openRow('standup');
  await a.click('#files-standup'); await a.settle();
  await atEverySize('files-view', 'Clicked "Files and contents" in standup’s details: the list of skills beside standup’s switch; stacked, its SKILL.md comes first, then each tool’s line and where each copy is ("← Skills" goes back)', true);
  await a.click('#skills-table');
  // History.
  await a.click('#nav-history'); await a.settle();
  await atEverySize('history', 'Clicked "History": each skill’s entries in words, each with its own Undo, Turn on, Restore or Use … copy where one can still be done, all in the actions column', true);
  await a.click('#nav-skills');
  if (existsSync(claudeSettings)) writeFileSync(claudeSettings, settingsBefore);
}

// ---------- Sync, notices and History ----------
if (wanted('sync')) {
  begin('sync');
  await a.click('#nav-skills');
  await turnOnRow('standup');
  edit(join(practice, '.codex/skills/standup/SKILL.md'), text => text.replace(/\n*$/, '\nEdited in Codex.\n'));
  await waitFor(a, `document.body.innerText.includes('Codex')&&!!document.querySelector('.sync-notice')`);
  await shot(a, 'edit-spread-notice', 'Outside the app, a line was added to standup\'s SKILL.md in Codex. A few seconds later, without clicking anything: the notice.');
  await a.click('#nav-history'); await shot(a, 'history-with-edit', 'Clicked "History".');
  const undo = await a.run(`document.querySelector('.history-row button[id^="history-"]')?.id ?? ''`);
  if (undo) { await a.click(`#${undo}`); await shot(a, 'history-undone', 'Clicked "Undo" on that edit.'); }
  await a.click('#nav-skills');
  await a.click('#sync-switch'); await shot(a, 'sync-off', 'Turned the Sync switch (status bar, bottom) off.');
  edit(join(practice, '.claude/skills/notes/SKILL.md'), text => text.replace(/\n*$/, '\nEdited with Sync off.\n'));
  await wait(4000); await a.settle(); await shot(a, 'sync-off-pending', 'With Sync off, a line was added to notes in Claude Code. A few seconds later.');
  if (await a.has('#sync-now')) { await a.click('#sync-now'); await shot(a, 'sync-now', 'Clicked "Sync now".'); }
  await a.click('#sync-switch');
  rmSync(join(practice, '.copilot/skills/standup'), { recursive: true, force: true });
  await waitFor(a, `[...document.querySelectorAll('.sync-notice')].some(e => /deleted/.test(e.textContent))`, 10000);
  await shot(a, 'deletion-notice', 'Sync back on. Outside the app, the standup folder was deleted in Copilot. A few seconds later.');
  const restore = await a.run(`document.querySelector('[id^="notice-restore-"]')?.id ?? ''`);
  if (restore) { await a.click(`#${restore}`); await shot(a, 'restored', 'Clicked "Restore" in the notice.'); }
}

// ---------- MCP servers ----------
// MCP servers are on Central Knot's library, as skills and agents are (src/servers.ts): every new state of a server's row, at
// four sizes. Claude Code's settings file is written only by Write to Claude Code, one band for every server that owes it.
if (wanted('mcp')) {
  begin('mcp');
  const settings = { claude: join(practice, '.claude.json'), copilot: join(practice, '.copilot/mcp-config.json'), codex: join(practice, '.codex/config.toml'), copilotSwitches: join(practice, '.copilot/settings.json') };
  // A server that belongs to an app (ChatGPT desktop's own): seen, never taken in.
  edit(settings.codex, text => `${text}\n[mcp_servers.node_repl]\ncommand = "/Applications/ChatGPT.app/Contents/Resources/node"\nargs = ["repl"]\n`);
  await a.click('#nav-mcp'); await refresh();
  await atEverySize('found', 'Clicked "MCP servers". Every server is found: docs in Claude Code, files in Copilot CLI and Codex, each with Add; node_repl belongs to ChatGPT desktop, so its Add is unavailable and its tag says it can’t be taken in', true);
  await openRow('node_repl');
  await atEverySize('cannot-take-in', 'Opened node_repl: "Not in Central Knot · it can’t be taken in now (see below)", and Codex’s line says why: ChatGPT desktop keeps this server for itself', false, '.details');
  await closeRow('node_repl');
  await openRow('files');
  await atEverySize('found-open', 'Opened files while found: what every tool shares of a server and what stays each tool’s own, each tool’s line with its settings file, and Add', true, '.details');
  await closeRow('files');
  // Taken in: every tool but Claude Code gets it at once; Claude Code waits, said as a plain note, and the band carries the write.
  await a.click('#add-docs'); await switchOn('docs');
  await a.click('#add-files'); await switchOn('files');
  await atEverySize('taken-in-waits', 'Clicked Add on docs, then on files: files is in Central Knot, on in Copilot CLI and Codex; the result says Claude Code waits for Write to Claude Code as a plain note; the amber band says what it adds, with its one button; files’s Claude Code mark is a clock', true);
  await shot(a, 'waits-hover', 'The pointer on files’s Claude Code mark: its tooltip says it gets the server when Write to Claude Code is clicked.', await middleOf('#cell-files-claude-cli'));
  await openRow('files');
  await atEverySize('waits-open', 'Opened files: Claude Code’s line says it gets the MCP server when Write to Claude Code is clicked, and its switch says “Waits for Write” in place of On; the other tools have the current version, Codex’s own setting named after its line', false, '.details');
  await closeRow('files');
  await a.click('#mcp-write-claude'); await a.settle();
  await atEverySize('written', 'Clicked Write to Claude Code (Claude Code quit): files is in Claude Code too, the rest of its settings kept; the band is gone', false, '.bands');
  // Off: out of every tool; Claude Code's entry goes with Write. Then Delete from Central Knot before that write.
  await a.click('#switch-files'); await a.settle();
  await atEverySize('off-waits', 'Turned files off: it left Copilot CLI and Codex at once and its row is under Off at once; the result, the Off heading and the row say it is still in Claude Code until Write; the band now offers to remove it there', true);
  await openRow('files');
  await atEverySize('off-waits-open', 'Opened the Off row: "Off · still in Claude Code until you click Write to Claude Code."; Claude Code’s line says its entry is removed then', false, '.details');
  await a.click('#delete-files'); await a.click('#delete-confirm-files'); await a.settle();
  await atEverySize('deleted-waits', 'Then Delete from Central Knot, still before the write: files is a row tagged "deleted", with no Add, "Deleted from Central Knot · Claude Code still has it until you click Write to Claude Code. History can restore it."; Claude Code’s line says History can restore it; the band removes it', true);
  await a.click('#mcp-write-claude'); await a.settle();
  // A tool's own switch, set in its settings: read, never written; its line says Central Knot leaves it as it is.
  const switchesBefore = existsSync(settings.copilotSwitches) ? readFileSync(settings.copilotSwitches, 'utf8') : '{}';
  writeFileSync(settings.copilotSwitches, JSON.stringify({ ...JSON.parse(switchesBefore), disabledMcpServers: ['docs'] }, null, 2));
  await refresh();
  await openRow('docs');
  await atEverySize('switched-off', 'Outside the app, Copilot CLI’s settings turned docs off, then Refresh: its own mark, a partial switch, "switched off in Copilot CLI"; its line says Central Knot leaves that switch as it is, so it stays off after Off and On; "Switched off" in place of its switch', true, '.details');
  writeFileSync(settings.copilotSwitches, switchesBefore); await refresh();
  // Kept out of one tool by its switch in the opened row.
  await openRow('docs');
  await a.click('#enable-docs-codex-cli'); await a.settle();
  await atEverySize('kept-out', 'Turned docs off in Codex alone, in its opened row: its entry left Codex; the row says "in 2 of 3 tools · kept out of Codex" and its switch is drawn partial', true, '.ov-row[data-key="docs"]');
  await a.click('#enable-docs-codex-cli'); await a.settle();
  await closeRow('docs');
  // An edit made in a tool becomes the current version; its versions list says where each came from, and Read shows one.
  edit(settings.codex, text => text.replace('url = "https://docs.example.test/mcp"', 'url = "https://docs.example.test/mcp/v2"'));
  await refresh();
  await atEverySize('edit-notice', 'Outside the app, docs’s URL was edited in Codex, then Refresh: the edit is the current version, in Copilot CLI too, and Claude Code waits for Write; the notice offers Undo', false, '.sync-notices');
  await openRow('docs');
  await atEverySize('versions', 'Opened docs: its versions, edited in Codex (current) and found in Claude Code, each with what changed ("URL changed")', true, '.version-row');
  await a.click('#version-read-docs-1');
  await waitFor(a, `!!document.querySelector('.version-read')`);
  await atEverySize('version-read', 'Clicked Read on the version found in Claude Code: what it runs, part by part, what differs from the current version marked', false, '.version-read');
  await a.click('#version-read-docs-1');
  await closeRow('docs');
  if (await a.has('#mcp-write-claude')) { await a.click('#mcp-write-claude'); await a.settle(); }
  // What `codex mcp remove docs` leaves: docs turns off, Claude Code's entry going at Write; Central Knot keeps it, and the notice offers Turn on.
  edit(settings.codex, text => text.replace(/\n?\[mcp_servers\.docs\][^[]*/, '\n'));
  await refresh(); await wait(2300); await refresh();
  await atEverySize('deleted-by-hand', 'Outside the app, docs was removed from Codex’s settings (as `codex mcp remove docs` does), then Refresh past the settle window: it is off and taken out of Copilot CLI, still in Claude Code until Write, kept in Central Knot; the notice offers Turn on', true, '.sync-notices');
  const restore = await a.run(`document.querySelector('[id^="notice-restore-"]')?.id ?? ''`);
  if (restore) { await a.click(`#${restore}`); await a.settle(); }
  // A server a tool can't hold (SSE, in Codex), and a server whose copies differ (the copy question).
  edit(settings.claude, text => { const config = JSON.parse(text); config.mcpServers.live = { type: 'sse', url: 'https://live.example.test/sse' }; return JSON.stringify(config, null, 2); });
  edit(settings.copilot, text => { const config = JSON.parse(text); config.mcpServers.search = { type: 'local', command: 'search-mcp', args: ['--index', 'copilot'], tools: ['*'] }; return JSON.stringify(config, null, 2); });
  edit(settings.codex, text => `${text}\n[mcp_servers.search]\ncommand = "search-mcp"\nargs = ["--index", "codex", "--fast"]\n`);
  await refresh();
  await a.click('#add-live'); await switchOn('live');
  await openRow('live');
  await atEverySize('cannot-hold', 'Added live, an SSE server from Claude Code: Copilot CLI has it now; Codex can’t take it (its own mark, "Codex has no SSE transport."), and the status says so', false, '.details');
  await closeRow('live');
  await a.click('#add-search'); await a.settle();
  await atEverySize('copy-question', 'Clicked search’s Add: Copilot CLI’s and Codex’s entries differ, so the row asks which one every tool uses, each row quoting its own command with the words only it has marked; what choosing does says Claude Code’s part happens at Write', true, '.details-differs');
  await a.click('#use-search-copilot-cli'); await switchOn('search');
  await atEverySize('chosen', 'Clicked "Use this copy" on Copilot CLI’s: search is in Central Knot, on in Copilot CLI and Codex; Codex’s entry is kept as a version; Claude Code waits for Write', false, '.bands');
  await a.click('#nav-history');
  await atEverySize('history', 'History: each server’s entries in the library’s words, with what each still offers (Turn on, Restore, Undo, Use Codex’s copy)', true);
}

// ---------- Agents ----------
// Central Knot holds each agent itself, with its versions (src/library.ts). Every state of an agent's row, at four sizes.
if (wanted('agents')) {
  begin('agents');
  const agentsFolder = { claude: '.claude/agents', copilot: '.copilot/agents', codex: '.codex/agents' };
  const reviewer = tool => join(practice, { claude: '.claude/agents/code-reviewer.md', copilot: '.copilot/agents/code-reviewer.agent.md', codex: '.codex/agents/code-reviewer.toml' }[tool]);
  const claudeFile = (name, description, prompt) => writeFileSync(join(practice, agentsFolder.claude, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${prompt}`);
  /** Marks a file as saved `seconds` from now, so "latest" can tell edits made in the same second apart. */
  const savedIn = (path, seconds) => { const when = new Date(Date.now() + seconds * 1000); utimesSync(path, when, when); };

  await a.click('#nav-agents');
  await atEverySize('agents-found', 'Clicked "Agents". Both agents are found: a tool has them and Central Knot doesn’t yet, so each row has Add where an On row has its switch; the section line says what Add does');
  await shot(a, 'agents-found-hover', 'The pointer on code-reviewer’s Add: the row lights up; Add’s tooltip says a click adds it to Central Knot and puts it in every tool.', await middleOf('#add-code-reviewer'));
  await focusOn('#add-code-reviewer');
  await shot(a, 'agents-found-focus', 'Keyboard focus on code-reviewer’s Add: its focus ring.');
  await a.run('document.activeElement?.blur()');
  await openRow('code-reviewer');
  await atEverySize('agents-found-open', 'Opened code-reviewer while it is found: its status says where it is and what Add does; its whole description shows; each tool says what it has', true);
  await closeRow('code-reviewer');
  for (const key of ['code-reviewer', 'release-notes']) { await a.click(`#add-${key}`); await switchOn(key); }
  await shot(a, 'agents-on', 'Clicked both Adds: each agent is taken into Central Knot and on in all 3 tools. The result says so.');

  // Off: out of every harness, kept in Central Knot. On puts each file back.
  await a.click('#switch-code-reviewer'); await a.settle();
  await atEverySize('agents-off', 'Turned code-reviewer off: it left every tool, and its row stays under Off, "in Central Knot only", with its description; the result offers Undo', true);
  await openRow('code-reviewer');
  await atEverySize('agents-off-open', 'Opened the Off row: its status, its whole description, each tool with no copy while it is off, its versions, and Delete from Central Knot as a quiet button with how it differs from Off', true);
  await a.click('#switch-code-reviewer'); await switchOn('code-reviewer');
  await shot(a, 'agents-on-again', 'Clicked its switch again: on in all 3 tools, each file as it was.');

  // The opened row of an agent that is On: each harness's line and switch, what stays its own, and one version.
  await openRow('code-reviewer');
  await atEverySize('agents-open', 'Opened code-reviewer, on: its whole description at the top; each tool has the current version and its own switch; Claude Code’s line names the settings that stay in its file; one version, its first');

  // Edits made in a harness: each becomes the current version. Several make the versions list long enough to fold.
  edit(reviewer('codex'), text => text.replace('description = "', 'description = "Checks tests too. '));
  await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('.sync-notice')`, 15000);
  await shot(a, 'agents-edit-notice', 'Outside the app, code-reviewer was edited in Codex, then Refresh was clicked: the notice says the edit is its current version now, in the other tools too, with Undo.');
  for (const [tool, change] of [['claude', text => text.replace(/(description: )/, '$1Names risky changes. ')], ['copilot', text => text.replace('Keep it short.', 'Keep it short. Ask for tests.')],
    ['codex', text => text.replace(/(description = ")/, '$1Keeps comments short. ')], ['claude', text => text.replace(/^(name: )code-reviewer$/m, '$1code-reviewer').replace('Read the change', 'Read the whole change')]]) {
    edit(reviewer(tool), change);
    await refresh(); await wait(1100);
  }
  await openRow('code-reviewer');
  await atEverySize('agents-versions-folded', 'Four more edits, in Claude Code, Copilot CLI and Codex: the versions list shows its newest four, the current one first, each with its time (every row in one form), where it was edited and what changed, and one line for the earlier ones');
  await a.click('#versions-all-code-reviewer'); await a.settle();
  await atEverySize('agents-versions-all', 'Clicked "Show 2 earlier versions": every version, the current one first, then in the order Central Knot took them', true);
  await shot(a, 'agents-version-hover', 'The pointer on the second version’s Make current: a quiet outlined button, apart from Read.', await middleOf('#version-current-code-reviewer-1'));
  await focusOn('#version-current-code-reviewer-1');
  await shot(a, 'agents-version-focus', 'Keyboard focus on that Make current: its focus ring.');
  await a.run('document.activeElement?.blur()');
  await a.click('#version-read-code-reviewer-2'); await waitFor(a, `/careful code reviewer/.test(document.querySelector('.version-read')?.textContent ?? '')`, 15000);
  await atEverySize('agents-version-read', 'Clicked Read on an earlier version: its description and prompt open under its line, upright, headed by what differs from the current version ("Differs from current in: …"), each difference marked', false, '.version-read');
  await a.click('#version-read-code-reviewer-2'); await a.settle();
  await a.click('#version-current-code-reviewer-5'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await atEverySize('agents-made-current', 'Clicked Make current on the first version: it is the new current version, first, "back to:" the version it went back to (folded into its row), written to all 3 tools; the result names it and offers Undo');

  // One harness kept out: the closed row says so too.
  await a.click('#enable-code-reviewer-codex-cli'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await atEverySize('agents-kept-out', 'Turned Codex’s own switch off: code-reviewer is kept out of Codex (its copy there is gone, its mark struck through, "not in Codex" beside its name) and stays on in the others', true);
  await a.click('#version-current-code-reviewer-1'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await shot(a, 'agents-made-current-kept-out', 'With Codex kept out, clicked Make current on an earlier version: written to Claude Code and Copilot CLI; Codex stays out, and the result names only those two.');
  // Off while kept out of one tool, then On: Codex stays out.
  await a.click('#switch-code-reviewer'); await a.settle();
  await openRow('code-reviewer');
  await shot(a, 'agents-off-kept-out', 'Turned code-reviewer off while it is kept out of Codex: it is in Central Knot only, its versions still offered.');
  await a.click('#version-current-code-reviewer-1'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await shot(a, 'agents-made-current-off', 'While it is off, clicked Make current: the version is current in Central Knot, and no tool is written; the result says so.');
  await a.click('#switch-code-reviewer'); await switchOn('code-reviewer');
  await openRow('code-reviewer');
  await shot(a, 'agents-on-kept-out', 'Turned it on again: on in Claude Code and Copilot CLI, still kept out of Codex.');
  await a.click('#enable-code-reviewer-codex-cli'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);

  // A harness whose edit waits: with Automatic sync off, an edit shows as becoming the current version at the next sync.
  await a.click('#sync-switch'); await a.settle();
  edit(reviewer('copilot'), text => text.replace('description: ', 'description: Edited while sync is off. '));
  await refresh();
  await openRow('code-reviewer');
  await atEverySize('agents-edit-waits', 'Turned Automatic sync off, edited code-reviewer in Copilot CLI, clicked Refresh: Copilot CLI’s mark and line say its edit becomes the current version when sync runs; the toolbar counts it');
  await a.click('#sync-switch'); await a.settle(); await refresh();

  // Many versions, unfolded.
  for (let count = 1; count <= 7; count++) { edit(reviewer(['claude', 'copilot', 'codex'][count % 3]), text => text.replace('Keep it short.', `Keep it short (${count}).`).replace(/Keep it short \(\d+\)\./, `Keep it short (${count}).`)); await refresh(); await wait(1100); }
  await openRow('code-reviewer');
  if (await a.has('#versions-all-code-reviewer')) { await a.click('#versions-all-code-reviewer'); await a.settle(); }
  await atEverySize('agents-versions-many', 'Seven more edits: every version unfolded, each on one line where there is room, the times reading apart', false, '.versions');
  await closeRow('code-reviewer');

  // A harness that can't hold it: a name it can't store.
  writeFileSync(join(practice, '.claude/agents/réviseur.md'), '---\nname: réviseur\ndescription: Relit un changement avant sa fusion.\n---\n\nRelis le changement.\n');
  await refresh();
  await a.click('#add-réviseur'); await a.settle();
  await openRow('réviseur');
  await atEverySize('agents-cannot', 'An agent in Claude Code whose name Copilot CLI and Codex can’t store, turned on: its status says "On in Claude Code only", and each other tool’s line names the character and what to do');
  await closeRow('réviseur');

  // A long name and a long prompt.
  const long = 'reviews-database-migrations-before-they-reach-production-and-checks-rollbacks';
  claudeFile(long, 'Reads every migration in a change, checks that each one can be rolled back, that it locks no large table for long, and that the code shipped with it works before and after it runs.',
    Array.from({ length: 40 }, (_, line) => `${line + 1}. Check the migration’s step ${line + 1}: what it changes, what it locks, how long it runs on the largest table, and how it is rolled back.`).join('\n') + '\n');
  await refresh();
  await a.click(`#add-${long}`); await switchOn(long);
  await atEverySize('agents-long-name', 'An agent with a long name and description, on: the row shortens the description first, and the name at a word', false, `.ov-row[data-key="${long}"]`);
  await openRow(long);
  await a.click(`#version-read-${long}-0`); await waitFor(a, `!!document.querySelector('.version-read pre')`, 15000);
  await atEverySize('agents-long-read', 'Opened it and clicked "Read current": a 40-line prompt reads in its box, which scrolls, upright', false, '.version-read');
  await closeRow(long);

  // Found copies that differ, in three tools: the copy question, each copy's edit time, the newest marked; the others become versions.
  writeFileSync(join(practice, '.claude/agents/changelog.md'), '---\nname: changelog\ndescription: Keeps the changelog.\n---\n\nKeep the changelog short.\nOne line each.\n');
  writeFileSync(join(practice, '.copilot/agents/changelog.agent.md'), '---\nname: changelog\ndescription: Keeps the changelog.\n---\n\nKeep the changelog short.\nOne line each. Name the author.\n');
  writeFileSync(join(practice, '.codex/agents/changelog.toml'), 'name = "changelog"\ndescription = "Keeps the changelog."\ndeveloper_instructions = """\nKeep the changelog short.\nOne line each. Link the pull request.\n"""\n');
  savedIn(join(practice, '.claude/agents/changelog.md'), -600); savedIn(join(practice, '.copilot/agents/changelog.agent.md'), -120);
  await refresh();
  await a.click('#add-changelog'); await a.settle();
  await atEverySize('agents-choice', 'A found agent whose copies differ in all three tools, its Add clicked: it asks which copy every tool uses; each copy says when it was edited, the newest is marked and its button is the main one', true);
  await a.click('#use-changelog-codex-cli'); await switchOn('changelog');
  await openRow('changelog');
  await atEverySize('agents-choice-made', 'Chose Codex’s copy: changelog is in Central Knot with it, on in all 3 tools; the current version is listed first, the other copies after it, each with Make current');

  // Delete from Central Knot, and History's Restore.
  await a.click('#delete-changelog'); await a.settle();
  await atEverySize('agents-delete-armed', 'Clicked "Delete from Central Knot…": it asks once more, with Cancel beside it, and says History keeps it, with its versions, for 30 days', true, '#delete-note-changelog');
  await a.click('#delete-confirm-changelog'); await a.settle();
  await shot(a, 'agents-deleted', 'Clicked "Delete it now": changelog left every tool and this page; the result offers Undo.');
  await a.click('#nav-history'); await a.settle();
  await atEverySize('agents-history', 'History: each click and each edit taken in, in the library’s words, with its action: Restore on the deletion, Undo on the latest change, "Go back before this" on older ones (the full sentence its tooltip), Turn off or Turn on on a switch', true);
  await a.run(`[...document.querySelectorAll('.history-row[data-kind="deleted"]')].find(row => row.textContent.includes('changelog'))?.querySelector('.history-actions button')?.click()`);
  await waitFor(a, `/Restored/.test(document.querySelector('#history-scroll')?.textContent ?? '')`, 15000);
  await atEverySize('agents-history-restored', 'Clicked Restore on the deletion: changelog is back in Central Knot and in every tool; the deletion’s row reads Restored');

  // Many agents: On, Off and Found together.
  for (let count = 1; count <= 14; count++) claudeFile(`helper-${String(count).padStart(2, '0')}`, `Helps with task ${count}. Reads the request, plans it, and reports what changed.`, `Do task ${count} carefully.\n`);
  await a.click('#nav-agents'); await refresh();
  await waitFor(a, `!!document.querySelector('#add-helper-14')`, 20000);
  for (let count = 1; count <= 8; count++) { await a.click(`#add-helper-${String(count).padStart(2, '0')}`); await switchOn(`helper-${String(count).padStart(2, '0')}`); }
  for (const count of [2, 5, 7]) { await a.click(`#switch-helper-0${count}`); await a.settle(); }
  await atEverySize('agents-many', 'Fourteen more agents: some on, three off, six found; the three sections, each with its count and line');
  await a.run(`document.querySelector('.legend')?.scrollIntoView({ block: 'end' })`);
  await shot(a, 'agents-legend', 'The key at the end of the list: "Kept out", "Off: in Central Knot only", "Can’t take it" among the marks this page uses.');

  // States added in round 3, after the earlier pictures so their numbers stay. The long name heads its opened panel.
  await openRow(long);
  if (await a.has('.version-read')) { await a.click(`#version-read-${long}-0`); await a.settle(); }
  await atEverySize('agents-long-name-open', 'Opened the agent with the long name: the panel’s header holds it, and the list beside it cuts it before any description goes', false, '.details');
  await closeRow(long);

  // Two copies that differ: the copy question marks the newer one "Newer".
  writeFileSync(join(practice, '.claude/agents/triage.md'), '---\nname: triage\ndescription: Sorts new issues.\n---\n\nLabel each issue.\n');
  writeFileSync(join(practice, '.copilot/agents/triage.agent.md'), '---\nname: triage\ndescription: Sorts new issues.\n---\n\nLabel each issue. Close duplicates.\n');
  savedIn(join(practice, '.claude/agents/triage.md'), -300);
  await refresh();
  await a.click('#add-triage'); await a.settle(); await show('#use-triage-claude-cli');
  await shot(a, 'agents-choice-two', 'A found agent whose copies differ in two tools, its Add clicked: the newer copy is marked "Newer" and its button is the main one.');
  await a.click('#use-triage-copilot-cli'); await switchOn('triage');

  // Thirty versions: each edit adds a line.
  const steps = count => Array.from({ length: count }, (_, step) => `Step ${step + 1}: say what changed since yesterday.`).join('\n') + '\n';
  claudeFile('standup', 'Writes the daily standup.', steps(1));
  await refresh();
  await a.click('#add-standup'); await switchOn('standup');
  // A second apart, as a person's edits are, so no two read the same time.
  for (let count = 2; count <= 30; count++) { claudeFile('standup', 'Writes the daily standup.', steps(count)); await refresh(); await wait(1000); }
  await openRow('standup');
  await shot(a, 'agents-versions-thirty-folded', 'Twenty-nine edits in Claude Code, each adding a line: thirty versions, the newest four shown and one line for the other twenty-six.');
  await a.click('#versions-all-standup'); await a.settle();
  await atEverySize('agents-versions-thirty', 'Clicked "Show 26 earlier versions": all thirty, one line each, every time in one form', false, '.versions');
  // Read on a version that has words the current one lacks: they are tinted.
  await a.click('#version-current-standup-25'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await a.click('#version-read-standup-1'); await waitFor(a, `!!document.querySelector('.version-read .change-added')`, 15000);
  await atEverySize('agents-version-read-adds', 'Made the fifth version current, then clicked Read on the one that was current before: the lines it has and the current one lacks are tinted; the header says what differs', false, '.version-read');
  await a.click('#version-read-standup-1'); await a.settle();

  // Undo of a Make current while the agent is kept out of a tool: that tool stays out.
  await a.click('#enable-standup-codex-cli'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await a.click('#version-current-standup-2'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await a.click('#outcome-undo'); await a.settle(); await show('.details-tool-line');
  await shot(a, 'agents-made-current-kept-out-undone', 'Kept standup out of Codex, clicked Make current on an earlier version, then Undo: the version before is current again in Claude Code and Copilot CLI; Codex stays out.');
  await a.click('#enable-standup-codex-cli'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);

  // A tool whose agents folder can't be written: its line says so, and the next pass writes it once it can.
  chmodSync(join(practice, agentsFolder.codex), 0o555);
  claudeFile('standup', 'Writes the daily standup.', steps(31));
  await refresh(); await openRow('standup');
  await atEverySize('agents-folder-locked', 'Codex’s agents folder made read-only, then standup edited in Claude Code: Copilot CLI gets the edit; Codex’s line says Central Knot can’t write in its agents folder', false, '.details-tool-line');
  chmodSync(join(practice, agentsFolder.codex), 0o755);
  await refresh();
  await closeRow('standup');

  // A version pulled from the Git repo, over a copy found here that differs.
  const remote = join(scratch, 'agents-remote.git'), author = join(scratch, 'agents-author');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', ...args], { stdio: 'ignore' });
  mkdirSync(remote, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  execFileSync('git', ['clone', '--quiet', remote, author], { stdio: 'ignore' });
  mkdirSync(join(author, 'agents'), { recursive: true });
  writeFileSync(join(author, 'agents/retro.md'), '---\nname: retro\ndescription: Runs the team retro.\n---\n\nAsk what went well, what didn’t, and what to try next.\n');
  git(author, 'add', '-A'); git(author, 'commit', '--quiet', '-m', 'Retro agent'); git(author, 'push', '--quiet', 'origin', 'HEAD:main');
  claudeFile('retro', 'Runs the team retro.', 'Ask what went well.\n');
  await a.click('#nav-repo'); await a.settle();
  await a.run(`(() => { const input = document.querySelector('#repo-url'); input.value = ${JSON.stringify(remote)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#repo-connect');
  await waitFor(a, `!!document.querySelector('#repo-state') && !/Checking/.test(document.querySelector('#repo-state').textContent)`, 20000); await a.settle();
  await a.click('#repo-pull');
  await waitFor(a, `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  await a.click('#nav-agents'); await a.settle();
  await openRow('retro');
  await atEverySize('agents-pulled', 'Connected a Git repo with a retro agent, while Claude Code had a different retro of its own, and clicked Pull: retro is on, pulled from the Git repo; Claude Code’s copy is kept as a version, noted against the pulled one', false, '.versions');
  await closeRow('retro');

  // Restore when an agent of that name exists again.
  await openRow('triage');
  await a.click('#delete-triage'); await a.settle();
  await a.click('#delete-confirm-triage'); await a.settle();
  writeFileSync(join(practice, '.claude/agents/triage.md'), '---\nname: triage\ndescription: Sorts new issues by hand.\n---\n\nA new triage, made after the old one was deleted.\n');
  await refresh();
  await a.click('#nav-history'); await a.settle();
  await shot(a, 'agents-restore-name-taken-history', 'Deleted triage from Central Knot, then a new triage was made in Claude Code: History still offers Restore on the deletion.');
  await a.run(`[...document.querySelectorAll('.history-row[data-kind="deleted"]')].find(row => row.textContent.includes('triage'))?.querySelector('.history-actions button')?.click()`);
  await a.settle();
  await shot(a, 'agents-restore-name-taken', 'Clicked Restore: the old triage is back in Central Knot and every tool; the new copy found in Claude Code is kept as a version first.');
  await a.click('#nav-agents'); await a.settle(); await openRow('triage'); await show('.versions');
  await shot(a, 'agents-restore-name-taken-open', 'Opened triage after Restore: its versions, the new copy from Claude Code among them, each with Make current.');

  // No agents at all: a fresh Practice copy with its agents' files removed.
  await fresh();
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  for (const folder of Object.values(agentsFolder)) rmSync(join(practice, folder), { recursive: true, force: true });
  await a.click('#nav-agents'); await refresh();
  await atEverySize('agents-none', 'A Practice copy whose tools have no agents: the Agents page says so and what to do');
}

// ---------- Plugins ----------
if (wanted('plugins')) {
  begin('plugins');
  const market = join(scratch, 'market');
  writeMarket(market);
  await a.click('#nav-plugins'); await shot(a, 'plugins-empty', 'Clicked "Plugins" before adding a marketplace.');
  await addMarketplace(a, market); await shot(a, 'plugins-added', 'Typed a marketplace folder (a local copy of a team marketplace) into "Add a marketplace" and clicked Add.');
  await a.click('#market-tab-about'); await waitFor(a, `!!document.querySelector('.plugin-readme, .plugin-muted')`); await shot(a, 'plugins-about', 'Clicked the "About" tab.');
  await a.click('#market-tab-plugins');
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-group')`); await shot(a, 'plugin-page', 'Clicked the "document-tools" row.');
  if (await a.has('#pinstall-0-document-tools:not([disabled])')) { await a.click('#pinstall-0-document-tools'); await shot(a, 'plugin-chosen', 'Clicked "Choose all 3".'); }
  if (await a.has('#plugins-apply:not([disabled])')) { await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); await shot(a, 'plugins-applied', 'Clicked "Apply all". Each tool installed it with its own command.'); }
  await a.click('#plugin-back'); await shot(a, 'plugins-after', 'Clicked the back link to team-tools.');
  await a.click('#popen-0-issue-tracker'); await waitFor(a, `!!document.querySelector('.plugin-group')`); await shot(a, 'plugin-page-mcp', 'Opened "issue-tracker", which runs an MCP server.');
  await a.click('#plugin-back');
  await a.click('#popen-0-spark'); await waitFor(a, `!!document.querySelector('.plugin-group, .plugin-muted:not(:empty)') && !/Reading/.test(document.querySelector('.plugin-page')?.textContent ?? '')`, 60000); await shot(a, 'plugin-page-remote', 'Opened "spark", whose files live in GitHub’s copilot-plugins repository (read from there).');
  if (await a.has('#plugins-undo')) { await a.click('#plugins-undo'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); await shot(a, 'plugins-undone', 'Clicked "Undo" on the result of Apply all.'); }
}

// ---------- Profiles ----------
// Profiles are sets of library items (src/profiles.ts): every state of the Profiles page at four sizes, with the light
// appearance once, on a practice copy whose skills, MCP servers and agents are taken into Central Knot first.
if (wanted('profiles')) {
  begin('profiles');
  // The name field saves and closes on blur, which a window losing focus (macOS) also causes: reopened with Rename then.
  const name = async text => { if (!(await a.has('#profile-name'))) await a.click('#profile-rename'); await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await a.settle(); };
  const openProfile = async text => { await a.run(`[...document.querySelectorAll('.profile-row')].find(row => row.textContent.includes(${JSON.stringify(text)})).click()`); await a.settle(); };
  await a.click('#nav-profiles');
  await atEverySize('empty', 'Clicked "Profiles" in the sidebar before any profile exists', true);
  for (const [page, keys] of [['skills', ['notes', 'standup', 'release-notes']], ['mcp', ['docs', 'files']], ['agents', ['code-reviewer', 'release-notes']]]) {
    await a.click(`#nav-${page}`); await a.settle();
    for (const key of keys) { await turnOnRow(key); await switchOn(key); }
  }
  await a.click('#nav-profiles');
  await a.click('#profile-new');
  await atEverySize('new-naming', 'Took notes, standup and release-notes, docs and files, and the agents code-reviewer and release-notes into Central Knot, then clicked "New profile": its name field is ready to type in');
  await name('Incident');
  await atEverySize('new-named', 'Typed "Incident" and pressed Enter: nothing is in it yet, so it offers no switch; the band says to tick at least one item, or start from what is on now');
  await a.click('#pf-skill\\:notes'); await a.click('#pf-mcp\\:files');
  await atEverySize('incident-ticked', 'Ticked notes and files: before any switch, each row says what switching to Incident does to it; the header counts it and, since docs (which Claude Code has) turns off, says Claude Code’s MCP servers change when you press Write to Claude Code, the line wrapping whole', true);
  await a.click('#profile-switch'); await a.run(`document.activeElement?.blur()`);
  await atEverySize('incident-switched', 'Clicked "Switch to Incident": the result says what it turned off and that 1 MCP server waits for Write to Claude Code, with that button and Undo switch; Incident is in use (the list, the header: "2 items on, the other 5 off", the status bar)', true);
  await a.click('#profile-new'); await name('Development');
  await a.click('#profile-from-now');
  await a.click('#pf-skill\\:standup'); await a.click('#pf-agent\\:code-reviewer');
  await atEverySize('development-ticked', 'Made "Development", clicked "Start from what’s on now", then ticked standup and code-reviewer: switching turns those two on');
  await a.click('#status-profile');
  await shot(a, 'status-menu', 'Clicked "Incident" in the status bar: the profile menu, a tick on the profile in use, with focus on it.');
  await a.press('ArrowDown'); await shot(a, 'status-menu-keys', 'Pressed the Down arrow key: focus moves to Development (Up, Down, Home and End move; Escape closes).');
  await a.run(`[...document.querySelectorAll('.pf-menu-item')].find(item => item.textContent.includes('Development')).click()`); await a.settle();
  // A scripted click counts as a keyboard choice (focus returns to the status item, ringed); a mouse click leaves no ring.
  await a.run(`document.activeElement?.blur()`);
  await atEverySize('development-in-use', 'Chose "Development" in that menu: Development is in use; the column says what is on now');
  await a.click('#nav-skills'); await a.settle();
  await shot(a, 'skills-with-profile', 'The Skills page while Development is in use: each skill is On or Off in Central Knot, as Development has it; nothing marks a profile.');
  await a.click('#switch-standup'); await a.settle();
  await a.click('#nav-profiles'); await openProfile('Development');
  await atEverySize('after-hand-click', 'On the Skills page, turned standup off by hand, then came back: no profile is in use now (the status bar says No profile), and Development says what switching to it would turn back on', true);
  await a.click('#profile-switch'); await a.run(`document.activeElement?.blur()`);
  await a.click('#profile-new'); await name('On call');
  await a.click('#profile-from-now');
  await atEverySize('two-in-use', 'Switched to Development again, then made "On call" from what is on now: both have the same items, so both are in use, and the status bar names both');
  await a.click('#profile-delete');
  await atEverySize('delete-confirm', 'Clicked Delete on On call: deleting a profile changes no item');
  await a.click('#profile-delete-confirm');
  await atEverySize('deleted', 'Clicked Delete: the result says nothing changed, with Undo; Development is open');
  // Eight profiles: the list column takes more of a narrow window.
  for (const extra of ['Writing', 'Review', 'Support', 'Research', 'Travel', 'Release']) { await a.click('#profile-new'); await name(extra); }
  await openProfile('Development');
  await atEverySize('eight-profiles', 'Made six more profiles (eight in all) and opened Development: stacked at 860×560 the page scrolls as one, every profile and then the open one’s items, with no box scrolling inside');
  await a.size(860, 560);
  await a.run(`document.querySelector('.profiles-split').scrollTop = 10000`); await a.settle();
  await shot(a, 'eight-profiles-860-scrolled', 'At 860×560, the page scrolled to its end: Development’s header, Find and its items, the table’s heading held at the top.');
  await a.run(`document.querySelector('.profiles-split').scrollTop = 0`);
  await a.size(1280, 800);
  await a.run(`(() => { const input = document.querySelector('#profile-find'); input.value = 'zzz'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`); await a.settle();
  await atEverySize('find-nothing', 'Typed "zzz" in Find: nothing matches, and the count says 0 of 7');
  await a.run(`(() => { const input = document.querySelector('#profile-find'); input.value = 'release'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`); await a.settle();
  await atEverySize('find-some', 'Typed "release" in Find: the skill and the agent called release-notes, each under its kind, with a tick for all of them shown');
  await a.click('#profile-find-clear');
  const profilesFile = join(practice, '.central-knot/profiles.json'), kept = readFileSync(profilesFile, 'utf8');
  writeFileSync(profilesFile, '{ not json');
  await refresh();
  await atEverySize('unreadable', 'Outside the app, profiles.json was broken, then Refresh: the page says why profiles can’t be used, changes nothing, and the list is gone with it');
  writeFileSync(profilesFile, kept);
  await refresh();
  await a.click('#nav-history');
  await shot(a, 'history', 'Clicked "History": each switch is one row, naming the profile and what it turned on and off, with Undo switch.');
  await a.run(`document.querySelector('.history-row[data-kind="profile"] .history-actions button')?.click()`); await a.settle();
  await shot(a, 'history-undone', 'Clicked "Undo switch" on the newest switch: the status bar says what it turned back; each item it turned has a row of its own.');
  await a.click('#nav-profiles'); await openProfile('Incident');
  // The narrowest window: a long name's header, renaming, and the status bar shortening it once it is in use.
  await a.size(860, 560);
  await a.click('#profile-rename');
  const longName = 'Incident response and on-call: web apps!';
  if (longName.length !== 40) throw new Error('The long name must be 40 characters.');
  await name(longName);
  await shot(a, 'size-860-long-name', 'At 860×560, renamed Incident to a 40-character name: the header with Switch, Rename and Delete.');
  await a.click('#profile-rename'); await shot(a, 'size-860-renaming', 'Clicked Rename again: the field has the header to itself, with Enter / Esc hints.');
  await a.press('Escape');
  await a.click('#profile-switch'); await a.run(`document.activeElement?.blur()`);
  await shot(a, 'size-860-long-name-in-use', 'Still at 860×560, switched to the profile with the 40-character name: the status bar item shortens it with an ellipsis (the full name is on hover).');
  await a.size(1280, 800);
}

// ---------- One skill of an installed plugin, off and back on (ENB-06) ----------
if (wanted('sync-everything')) {
  begin('sync-everything');
  await fresh();
  await a.click('#nav-skills');
  await atEverySize('skills-found-off', 'Opened Skills on the Practice copy, Synchronize everything off as it is until chosen: the Found heading says Add takes each in', false, '[data-section="found"]');
  await a.click('#nav-settings');
  await waitFor(a, `!!document.querySelector('#setting-sync-everything')`);
  await atEverySize('settings-off', 'Opened Settings: under This home, Synchronize everything is off; its hint says an MCP server reaches Claude Code at Write to Claude Code and that History can undo each but a server found in Claude Code; its line says how many found items turning it on would add now, and how many wait for a choice of copy, with See Skills', true, '#setting-sync-everything');
  await a.size(860, 560); await show('#setting-sync-everything'); await focusOn('#sync-everything-on');
  await shot(a, 'settings-off-focus-860', 'Tabbed to its switch at 860×560: the focus ring, the row’s words beside it');
  await a.run(`document.activeElement?.blur()`); await a.size(1280, 800);
  // The Practice copy is copied when the app opens: past the settle window, its copies are as ones that have sat in a tool,
  // so the pass right after the switch takes them all at once.
  await wait(2500);
  await a.click('#sync-everything-on');
  await waitFor(a, `document.querySelector('#sync-everything-on')?.getAttribute('aria-checked') === 'true'`, 15000);
  await atEverySize('settings-on', 'Clicked its switch: Synchronize everything is on; under the row, what the pass right after took in, a line per kind with History, and what still waits for a choice of copy', true, '#setting-sync-everything');
  await a.click('#nav-overview');
  await atEverySize('overview-on', 'Opened Overview: the sync line says what turns up in a tool is taken in by Synchronize everything');
  await a.click('#nav-skills');
  await atEverySize('skills-on', 'Opened Skills: one notice names the skills it took in and the tools it found them in; the Found heading says Synchronize everything leaves these, the opened row saying why, and counts what waits for a choice', true);
  await openRow('review');
  await atEverySize('skills-on-review', 'Opened review, left found: its copies differ, so it asks which copy every tool uses, as Add would; the question starts below the pinned row', false, '.ov-row.open + .details', 'start');
  await closeRow('review');
  await a.click('#nav-mcp');
  await atEverySize('mcp-on', 'Opened MCP servers: its notice names the servers it took in and where, and that one found in Claude Code has no Undo (its entry says why); Claude Code’s part waits for Write to Claude Code, in its one band', true);
  await a.click('#nav-agents');
  await atEverySize('agents-on', 'Opened Agents: its notice names the agents it took in and where they were found');
  await a.click('#nav-history');
  await waitFor(a, `!!document.querySelector('.history-row')`, 15000);
  await atEverySize('history', 'Opened History: the entries in view each say Synchronize everything took the item in and from which tool, with Undo; docs’s, found in Claude Code, has none and says why and what to do instead', true);
  // The skill notes's own row, by its name and kind (release-notes, an agent, has one too).
  const notesRow = `[...document.querySelectorAll('.history-row[data-kind="on"]')].find(row => row.querySelector('.history-what strong')?.textContent === 'notes' && row.querySelector('.history-kind')?.textContent === 'Skill')`;
  await a.run(`${notesRow}.querySelector('.history-actions button').click()`); await a.settle();
  await atEverySize('history-undone', 'Clicked Undo on notes’s entry: the status bar says it is out of Central Knot again, each tool it was found in keeping its own copy', true);
  await a.click('#nav-skills'); await refresh();
  await openRow('notes');
  await atEverySize('skills-undone-found', 'Opened Skills after a pass: notes is found again and stays so; its line says it was deleted from Central Knot, so it will not be added by itself again, and that Add, or Restore in History, brings it back; the Found heading grows with its note', true, '.details');
  await closeRow('notes');
  await a.click('#nav-settings');
  await a.click('#sync-everything-on');
  await waitFor(a, `document.querySelector('#sync-everything-on')?.getAttribute('aria-checked') === 'false'`, 15000);
  await atEverySize('settings-off-again', 'Clicked its switch again: off; its line says what turning it on would add now (notes, undone, would not be)', false, '#setting-sync-everything');
  // Another build syncs this home: the row can't be switched here, and says why in place of its hint.
  const record = join(practice, '.central-knot/sync.json');
  edit(record, text => JSON.stringify({ ...JSON.parse(text), owner: 'another-build', ownerName: 'Central Knot Alpha' }));
  await refresh();
  await a.click('#nav-settings');
  for (const [width, height] of SIZES.slice(0, 2)) { await a.size(width, height); await show('#setting-sync-everything'); await shot(a, `settings-disabled-${width}`, `Another build (Central Knot Alpha) syncs this home: the switch is disabled and the row says why, in place of its hint (${width}×${height})`); }
  await a.size(1280, 800);
}

if (wanted('plugin-skills')) {
  await fresh();
  begin('plugin-skills');
  const market = join(scratch, 'market');
  if (!existsSync(market)) writeMarket(market);
  // document-tools as each tool records it installed: Claude Code's installed_plugins.json, Codex's config.toml and plugin
  // cache, Copilot CLI's config.json. A stand-in `copilot` keeps its skill switch in settings.json as the real one does.
  const copyTo = folder => { for (const name of ['pdf-reader', 'spreadsheet']) { mkdirSync(join(folder, 'skills', name), { recursive: true }); writeFileSync(join(folder, 'skills', name, 'SKILL.md'), readFileSync(join(market, 'plugins/document-tools/skills', name, 'SKILL.md'))); } return folder; };
  const claudeCopy = copyTo(join(practice, '.claude/plugins/cache/ck-tools/document-tools/1.2.0'));
  writeFileSync(join(practice, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'document-tools@team-tools': [{ scope: 'user', installPath: claudeCopy, version: '1.2.0' }] } }));
  copyTo(join(practice, '.codex/plugins/cache/team-tools/document-tools/1.2.0'));
  edit(join(practice, '.codex/config.toml'), text => `${text}\n[marketplaces.team-tools]\nsource = ${JSON.stringify(market)}\n\n[plugins."document-tools@team-tools"]\nenabled = true\n`);
  const copilotCopy = copyTo(join(practice, '.copilot/installed-plugins/team-tools/document-tools'));
  mkdirSync(join(practice, '.copilot'), { recursive: true });
  writeFileSync(join(practice, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'document-tools', marketplace: 'team-tools', version: '1.2.0', cache_path: copilotCopy }] }));
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  // Codex's switch is its config.toml, so its CLI is only asked its version (the switch is offered from a tested build).
  writeFileSync(join(HOME, '.local/bin/codex'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "codex-cli 0.167.0" && exit 0\nexit 9\n`, { mode: 0o755 });
  writeFileSync(join(HOME, '.local/bin/copilot'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "GitHub Copilot CLI 1.0.108." && exit 0\nS="$HOME/.copilot/settings.json"\ncase "$1 $2" in\n  "skill disable") printf '{"disabledSkills":["%s"]}' "$3" > "$S" ;;\n  "skill enable") printf '{"disabledSkills":[]}' > "$S" ;;\n  *) exit 9 ;;\nesac\n`, { mode: 0o755 });
  const at860 = async (name, caption) => {
    await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
    await a.run(`document.querySelector('.plugin-skills')?.scrollIntoView({ block: 'start' })`); await wait(150);
    await shot(a, name, caption);
    await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  };
  await a.click('#nav-plugins');
  if (await a.has('#plugin-back')) await a.click('#plugin-back');
  if (!(await a.has('#popen-0-issue-tracker'))) await addMarketplace(a, market);
  await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#pcell-0-document-tools-codex-cli[data-state="installed"]')`, 15000);
  await shot(a, 'plugins-installed', 'document-tools is installed in Claude Code, Copilot CLI and Codex (by each tool’s own record). Clicked Refresh on team-tools.');
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-skills')`);
  await shot(a, 'skills-switches', 'Opened document-tools. Its skills each have a switch in Copilot CLI and Codex; Claude Code has no switch for one skill of a plugin.');
  await a.click('#pskill-0-document-tools-pdf-reader-codex-cli');
  await a.click('#pskill-0-document-tools-pdf-reader-copilot-cli');
  await shot(a, 'skill-chosen', 'Clicked pdf-reader’s switches under Codex and Copilot CLI. Nothing has changed yet: both wait for Apply all.');
  await a.run(`document.querySelector('#pskill-0-document-tools-pdf-reader-codex-cli').focus({ focusVisible: true })`);
  await shot(a, 'skill-focus', 'Moved keyboard focus to pdf-reader’s chosen Codex switch (as Tab would): focus ring and waiting ring together.');
  await a.theme('light'); await shot(a, 'skill-focus-light', 'The same, in the light appearance.'); await a.theme('dark');
  await a.run(`document.activeElement?.blur()`);
  await at860('skill-chosen-860', 'The chosen state at 860×560, scrolled to the skills.');
  await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'skill-off', 'Clicked Apply all. Codex’s config.toml now names document-tools:pdf-reader with enabled = false, and Copilot CLI ran `copilot skill disable document-tools:pdf-reader`.');
  await a.theme('light'); await shot(a, 'skill-off-light', 'The same, in the light appearance.'); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 2000 ? 1 : 2, mobile: false }); await a.settle();
    await shot(a, `skill-off-${width}`, `The same page at ${width}×${height}.`);
    await a.theme('light'); await shot(a, `skill-off-${width}-light`, `The same at ${width}×${height}, light.`); await a.theme('dark');
  }
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#plugins-undo'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'skill-undone', 'Clicked Undo: pdf-reader is on again in both tools.');
  writeFileSync(join(practice, '.copilot/settings.json'), JSON.stringify({ disabledSkills: ['spreadsheet'] }));
  await a.click('#plugin-back'); await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#pcell-0-document-tools-copilot-cli')`, 15000); await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-skills')`);
  await shot(a, 'skill-held', 'Turned every skill named “spreadsheet” off in Copilot CLI outside Central Knot (`copilot skill disable spreadsheet`), then reopened the page: it shows off there, locked, and can’t be turned on for this plugin alone (its row says why).');
  await at860('skill-held-860', 'The held state at 860×560, scrolled to the skills.');
  await a.theme('light'); await at860('skill-held-860-light', 'The held state at 860×560, light.'); await a.theme('dark');
  // Pi joins the home: it takes no plugins, so its column's switches put single skills in as separate items, beside the
  // installed plugin's own switches under Copilot CLI and Codex.
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await a.click('#plugin-back'); await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#pcell-0-document-tools-pi-cli')`, 15000);
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('#ppart-0-document-tools-skill-pdf-reader-pi-cli')`, 15000);
  await a.click('#ppart-0-document-tools-skill-pdf-reader-pi-cli');
  await a.run(`document.querySelector('.plugin-skills')?.scrollIntoView({ block: 'start' })`); await wait(150);
  await shot(a, 'mixed-switches', 'Pi was added to the home. One list now has both kinds of switch, each column saying which: the installed plugin’s skill switches under Copilot CLI and Codex, and under Pi a switch that puts one skill in as a separate item (pdf-reader chosen).');
  await at860('mixed-switches-860', 'The same at 860×560.');
  await a.theme('light'); await shot(a, 'mixed-switches-light', 'The same, in the light appearance.'); await a.theme('dark');
  await a.click('#ppart-0-document-tools-skill-pdf-reader-pi-cli');
}

// ---------- Plugin updates that arrive by themselves ----------
if (wanted('plugin-updates')) {
  await fresh();
  begin('plugin-updates');
  const market = join(scratch, 'market-auto');
  writeMarket(market);
  const skillOf = (plugin, name) => readFileSync(join(market, 'plugins', plugin, 'skills', name, 'SKILL.md'), 'utf8');
  // Claude Code has issue-tracker 1.9.0 and document-tools 1.1.0, both behind the marketplace, and release-helper, which the
  // marketplace has since dropped. It added the marketplace itself.
  writeClaudeInstall(practice, 'team-tools', 'issue-tracker', '1.9.0', { 'skills/triage/SKILL.md': skillOf('issue-tracker', 'triage') });
  writeClaudeInstall(practice, 'team-tools', 'document-tools', '1.1.0', { 'skills/pdf-reader/SKILL.md': skillOf('document-tools', 'pdf-reader'), 'skills/spreadsheet/SKILL.md': skillOf('document-tools', 'spreadsheet') });
  writeClaudeInstall(practice, 'team-tools', 'release-helper', '0.4.1', { 'commands/release-notes.md': readFileSync(join(market, 'plugins/release-helper/commands/release-notes.md'), 'utf8') });
  writeFileSync(join(practice, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'team-tools': { source: { source: 'git', url: market } } }));
  edit(join(market, '.claude-plugin/marketplace.json'), text => { const catalog = JSON.parse(text); catalog.plugins = catalog.plugins.filter(plugin => plugin.name !== 'release-helper'); return JSON.stringify(catalog, null, 2); });
  // A stand-in Claude Code: its update moves issue-tracker's record on to 2.0.0, and fails for document-tools as the real one does when it can't.
  const record = join(practice, '.claude/plugins/installed_plugins.json');
  const moved = JSON.parse(readFileSync(record, 'utf8'));
  const newCopy = join(practice, '.claude/plugins/cache/team-tools/issue-tracker/2.0.0');
  moved.plugins['issue-tracker@team-tools'] = [{ scope: 'user', installPath: newCopy, version: '2.0.0' }];
  writeFileSync(join(scratch, 'record-after.json'), JSON.stringify(moved, null, 2));
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  writeFileSync(join(HOME, '.local/bin/claude'), `#!/bin/sh
[ "$1" = "--version" ] && echo "2.1.322 (Claude Code)" && exit 0
case "$*" in
  "plugin update issue-tracker@team-tools --scope user") mkdir -p '${newCopy}/skills/triage' && cp '${join(market, 'plugins/issue-tracker/skills/triage/SKILL.md')}' '${newCopy}/skills/triage/' && cp '${join(scratch, 'record-after.json')}' '${record}' ;;
  "plugin update document-tools@team-tools --scope user") echo "Failed to update document-tools: its cache folder is in use by another Claude Code session."; exit 1 ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 });
  const sizes = [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]];
  const atSizes = async (name, caption) => {
    for (const [width, height] of sizes) {
      await a.size(width, height);
      await a.theme('dark'); await shot(a, `${name}-${width}-dark`, `${caption} At ${width}×${height}, dark.`);
      await a.theme('light'); await shot(a, `${name}-${width}-light`, 'The same, light.');
    }
    await a.size(1280, 800); await a.theme('dark');
  };
  await a.click('#nav-plugins');
  await addMarketplace(a, market);
  await waitFor(a, `!!document.querySelector('[data-plugin="issue-tracker"]')`, 20000); await a.settle();
  await shot(a, 'plugins-before', 'Plugins, before any check. Claude Code has issue-tracker 1.9.0 and document-tools 1.1.0, both behind the marketplace, and release-helper, which the marketplace no longer lists: it stays, marked "No longer offered".');
  await a.click('#nav-settings');
  await waitFor(a, `!!document.querySelector('#plugin-updates-on')`);
  await shot(a, 'settings-before', 'Settings, before any check: "Update plugins automatically" is on, and says the first check comes soon.');
  await a.click('#check-plugin-updates');
  await waitFor(a, `/Last checked/.test(document.querySelector('#setting-plugin-updates')?.textContent ?? '')`, 60000); await a.settle();
  await atSizes('settings-checked', 'Clicked "Check now" (what the schedule does by itself every four hours): one update was made, one couldn’t be.');
  await a.click('#setting-plugin-updates-notice-action');
  await waitFor(a, `!!document.querySelector('#plugin-updates-updated')`, 20000); await a.settle();
  await atSizes('plugins-note', 'Clicked "See Plugins": the note says issue-tracker was updated to 2.0.0 in Claude Code, and that document-tools couldn’t be, in Claude Code’s own words. Being the first such note, it says once that plugins now update by themselves and that Settings turns that off.');
  await a.click('#popen-0-release-helper'); await waitFor(a, `!!document.querySelector('.plugin-page')`); await a.settle();
  await shot(a, 'plugin-no-longer-offered', 'Opened release-helper, which the marketplace dropped: its page says so, shows what Claude Code still holds, and can still uninstall it.');
  await a.size(860, 560); await shot(a, 'plugin-no-longer-offered-860', 'The same at 860×560.'); await a.size(1280, 800);
  await a.click('#plugin-back');
  await a.click('#plugin-updates-updated-close'); await a.settle();
  await shot(a, 'note-updated-closed', 'Closed the "Updated automatically" note: what couldn’t be updated stays until it is closed or the update goes through, by itself or with Update on this page.');
  await a.click('#plugin-updates-failed-close'); await a.settle();
  await shot(a, 'note-closed', 'Closed that one too.');
  await a.click('#nav-settings');
  await a.click('#sync-switch'); await waitFor(a, `/Paused/.test(document.querySelector('#setting-plugin-updates')?.textContent ?? '')`); await a.settle();
  await shot(a, 'settings-paused', 'Turned Automatic sync off in the status bar: plugin updates pause with it, and the row says so. Check now still works.');
  await a.size(860, 560); await shot(a, 'settings-paused-860', 'The same at 860×560.'); await a.size(1280, 800);
  await a.click('#sync-switch'); await waitFor(a, `!/Paused/.test(document.querySelector('#setting-plugin-updates')?.textContent ?? '')`); await a.settle();
  await a.click('#plugin-updates-on'); await waitFor(a, `document.querySelector('#plugin-updates-on')?.getAttribute('aria-checked') === 'false'`); await a.settle();
  await shot(a, 'settings-off', 'Turned "Update plugins automatically" off: plugins are updated only with Update on the Plugins page.');
}

// ---------- Plugin versions and skill text ----------
if (wanted('plugin-versions')) {
  await fresh();
  begin('plugin-versions');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  const market = join(scratch, 'market');
  if (!existsSync(market)) writeMarket(market);
  // Claude Code has document-tools 1.1.0, whose pdf-reader skill was worded differently; Codex has the marketplace's 1.2.0.
  writeClaudeInstall(practice, 'team-tools', 'document-tools', '1.1.0', {
    'skills/pdf-reader/SKILL.md': '---\nname: pdf-reader\ndescription: "Reads PDF files and pulls out text."\n---\n\nOpen the PDF and copy out its text.\n',
    'skills/spreadsheet/SKILL.md': readFileSync(join(market, 'plugins/document-tools/skills/spreadsheet/SKILL.md'), 'utf8'),
  });
  cpSync(join(market, 'plugins/document-tools'), join(practice, '.codex/plugins/cache/team-tools/document-tools/1.2.0'), { recursive: true });
  // Both Claude Code and Codex have issue-tracker 1.9.0 (the marketplace offers 2.0.0): two tools named on one list row.
  writeClaudeInstall(practice, 'team-tools', 'issue-tracker', '1.9.0', { 'skills/triage/SKILL.md': readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8') });
  cpSync(join(market, 'plugins/issue-tracker'), join(practice, '.codex/plugins/cache/team-tools/issue-tracker/1.9.0'), { recursive: true });
  edit(join(practice, '.codex/config.toml'), text => `${text.replace(/\n*$/, '\n')}\n[plugins."document-tools@team-tools"]\nenabled = true\n\n[plugins."issue-tracker@team-tools"]\nenabled = true\n`);
  await a.click('#nav-plugins');
  if (await a.has('#plugin-back')) await a.click('#plugin-back');
  // Added already by the plugins feature: read again, so the installs written above show.
  if (await a.has('[data-plugin="document-tools"]')) { await a.click('#header-refresh'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); }
  else await addMarketplace(a, market);
  await shot(a, 'list-versions', 'The team-tools marketplace (a local folder). Claude Code has document-tools 1.1.0; Codex has 1.2.0, the version the marketplace offers. Both have issue-tracker 1.9.0 where the marketplace offers 2.0.0. Copilot CLI isn\'t installed on this machine.');
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('#pfile-0-skills-pdf-reader')`);
  await shot(a, 'plugin-versions', 'Clicked the "document-tools" row.');
  await a.click('#pfile-0-skills-pdf-reader');
  await shot(a, 'skill-open', 'Clicked "pdf-reader" under Skills: its SKILL.md. Claude Code\'s copy (1.1.0) differs from the marketplace\'s and Codex\'s (1.2.0), so each text shows, named.');
  await a.run(`document.querySelector('.plugin-file').scrollIntoView({ block: 'center' })`); await a.settle();
  await shot(a, 'skill-open-scrolled', 'Scrolled down to the opened SKILL.md.');
  await a.click('#pfile-0-skills-spreadsheet');
  await a.run(`document.querySelector('#pfile-0-skills-spreadsheet').scrollIntoView({ block: 'center' })`); await a.settle();
  await shot(a, 'skill-same-everywhere', 'Also opened "spreadsheet", whose text is the same in every copy: one block, named as such.');
  await a.click('#pfile-0-skills-spreadsheet');
  await a.run(`document.querySelector('#pfile-0-skills-spreadsheet').focus()`);
  await shot(a, 'keyboard-focus', 'Closed "spreadsheet" again; the keyboard focus is on its name.');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await size(width, height);
    await a.run(`document.querySelector('.plugin-page')?.closest('.scroll')?.scrollTo(0, 0)`);
    await a.theme('dark'); await shot(a, `plugin-${width}-dark`, `document-tools with pdf-reader open, at ${width}×${height}, dark.`);
    await a.theme('light'); await shot(a, `plugin-${width}-light`, `The same, light.`);
    if (width === 860 || width === 2560) { await a.run(`document.querySelector('.plugin-file').scrollIntoView({ block: 'center' })`); await a.settle(); await shot(a, `plugin-${width}-file-light`, `At ${width}×${height}, scrolled to the opened SKILL.md.`); await a.theme('dark'); }
  }
  await a.theme('dark');
  await a.click('#plugin-back');
  await size(860, 560); await a.run(`document.querySelector('[data-plugin="issue-tracker"]').scrollIntoView({ block: 'center' })`); await a.settle();
  await shot(a, 'list-860', 'Back to the marketplace list at 860×560, scrolled to issue-tracker, which two tools have at another version.');
  await a.theme('light'); await shot(a, 'list-860-light', 'The same, light.'); await a.theme('dark');
  await size(2560, 1440); await a.theme('light'); await shot(a, 'list-2560-light', 'The marketplace list at 2560×1440, light.');
  // Update: each row behind offers it for every tool behind, and the marketplace for all of them; a click only chooses.
  await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await a.run(`document.querySelector('#plugins-scroll')?.scrollTo(0, 0)`); await a.settle();
    await shot(a, `update-offered-${width}`, `At ${width}×${height}: document-tools and issue-tracker are behind in some tools, so their rows offer Update, and the marketplace "Update all".`);
    await a.click('#pupdate-0-issue-tracker');
    await a.run(`document.querySelector('[data-plugin="issue-tracker"]').scrollIntoView({ block: 'center' })`); await a.settle();
    await shot(a, `update-chosen-${width}`, `Clicked "Update in Claude Code and Codex" on issue-tracker: both boxes wait for Apply all, and the toolbar counts 2 updates.`);
    await a.click('#popen-0-issue-tracker'); await waitFor(a, `!!document.querySelector('.plugin-panel')`);
    await shot(a, `update-page-${width}`, `Opened issue-tracker with its update chosen: each tool says "Will update to 2.0.0", and the button takes it back.`);
    await a.click('#plugin-back'); await a.click('#plugins-discard');
  }
  // Codex's copy of document-tools changes by hand at the marketplace's version (1.2.0): its page says so and offers Update.
  edit(join(practice, '.codex/plugins/cache/team-tools/document-tools/1.2.0/skills/spreadsheet/SKILL.md'), text => `${text}\nAlso sort every sheet by its first column.\n`);
  await a.click('#header-refresh'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000);
  // Refresh forgot every plugin's files; the list reads the installed ones again by itself, with no page opened.
  await waitFor(a, `/Codex differs from the marketplace’s copy/.test(document.querySelector('[data-plugin="document-tools"] .plugin-row-warning')?.textContent ?? '')`, 15000);
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await a.run(`document.querySelector('[data-plugin="document-tools"]').scrollIntoView({ block: 'center' })`); await a.settle();
    await shot(a, `list-copy-differs-${width}`, `At ${width}×${height}, after Refresh and with no plugin page opened: the document-tools row says Codex's copy differs from the marketplace's (read in the background once the list was drawn) and offers Update.`);
  }
  await a.click('#popen-0-document-tools'); await waitFor(a, `/differs from the marketplace’s copy/.test(document.querySelector('.plugin-panel')?.textContent ?? '')`, 15000);
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await a.run(`document.querySelector('.plugin-page')?.closest('.scroll')?.scrollTo(0, 0)`); await a.settle();
    await shot(a, `copy-differs-${width}`, `At ${width}×${height}: Codex's document-tools is 1.2.0, the marketplace's version, but its spreadsheet skill was changed by hand: "Installed · 1.2.0 · differs from the marketplace’s copy", and Update is offered for Codex (with Claude Code, which is behind).`);
    await a.click('#pupdate-0-document-tools');
    await shot(a, `copy-differs-chosen-${width}`, `Clicked Update: Codex "Will update to the marketplace’s copy", Claude Code "Will update to 1.2.0".`);
    await a.click('#pupdate-0-document-tools');
  }
  await a.click('#plugin-back');
  await size(1280, 800); await a.theme('dark');
}

// ---------- A plugin's parts in tools without plugins ----------
if (wanted('parts')) {
  await fresh();
  begin('parts');
  // Pi is in the home (it takes no plugins), and no tool's CLI is on this tour's PATH, so Codex and Copilot CLI can't
  // take plugins here either: each can take a plugin's parts instead.
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await a.run('window.centralKnot.refresh()');
  const market = join(scratch, 'parts-market');
  writeMarket(market);
  await a.click('#nav-skills'); await a.click('#nav-plugins');
  if (!(await a.has('#popen-0-issue-tracker'))) await addMarketplace(a, market);
  if (await a.has('#plugin-back')) await a.click('#plugin-back');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  await shot(a, 'list-offers', 'Plugins, team-tools: Pi takes no plugins, and Codex and Copilot CLI have no CLI on this computer, so their boxes are hatched with a plus: a click chooses the plugin’s parts instead.');
  await a.click('#popen-0-issue-tracker'); await waitFor(a, `/(Can go in|Installed|Out of date)/.test(document.querySelector('.plugin-parts-section')?.textContent ?? '')`);
  await shot(a, 'page-offer', 'Opened issue-tracker: "Its parts, as separate items" says which tools can take them and what goes in.');
  // Single parts: under "What it holds", a switch per part for each tool that takes them.
  const atParts = async (name, caption) => { await a.run(`document.querySelector('.plugin-switched')?.scrollIntoView({ block: 'start' })`); await wait(150); await shot(a, name, caption); };
  await waitFor(a, `!!document.querySelector('#ppart-0-issue-tracker-skill-triage-pi-cli')`);
  await atParts('pick-switches', 'Scrolled to "What it holds": each skill and MCP server has a switch under each tool that can take it as a separate item.');
  // Codex takes single parts only where it can't take the plugin itself (no command-line tool and no desktop app found).
  const codexToo = await a.has('#ppart-0-issue-tracker-mcp-issues-codex-cli');
  await a.click('#ppart-0-issue-tracker-skill-triage-pi-cli'); if (codexToo) await a.click('#ppart-0-issue-tracker-mcp-issues-codex-cli');
  await atParts('pick-chosen', `Clicked triage’s switch under Pi${codexToo ? ' and the issues server’s under Codex: both wait' : ': it waits'} for Apply all.`);
  await a.theme('light'); await atParts('pick-chosen-light', 'The same, in the light appearance.'); await a.theme('dark');
  await size(860, 560); await atParts('pick-chosen-860', 'The same at 860×560.');
  await a.run(`document.querySelector('.plugin-head')?.scrollIntoView({ block: 'start' })`); await wait(150); await shot(a, 'pick-chosen-860-top', 'The top of the page at 860×560: each chosen tool’s box says what will change.');
  await size(1728, 1117); await atParts('pick-chosen-1728', 'The same at 1728×1117.');
  await size(1280, 800);
  await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await shot(a, 'pick-applied', `Clicked Apply all: Pi has the triage skill alone${codexToo ? ', Codex the issues server alone' : ''}; each tool’s row says what was left out.`);
  await atParts('pick-applied-switches', 'The switches after Apply all.');
  await a.click('#plugins-undo'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  // What is in a part's place when it can't go in: a file there is named, with what to do; a link that leads nowhere is replaced.
  mkdirSync(join(practice, '.pi/agent/skills'), { recursive: true });
  writeFileSync(join(practice, '.pi/agent/skills/triage'), 'not a folder');
  await a.click('#header-refresh'); await waitFor(a, `/A file is in its place/.test(document.querySelector('.plugin-switched')?.textContent ?? '')`, 30000);
  await atParts('place-file', 'A file named triage sits in Pi’s skills folder where the skill’s folder would go: its switch under Pi is locked, and its row says what is there and what to do.');
  await a.run(`document.querySelector('.plugin-parts-section')?.scrollIntoView({ block: 'start' })`); await wait(150);
  await shot(a, 'place-file-parts', 'The same reason in "Its parts", Pi’s row.');
  rmSync(join(practice, '.pi/agent/skills/triage'), { force: true });
  symlinkSync(join(practice, 'gone/triage'), join(practice, '.pi/agent/skills/triage'));
  await a.click('#header-refresh'); await waitFor(a, `/would replace a broken link/.test(document.querySelector('.plugin-parts-section')?.textContent ?? '')`, 30000);
  await shot(a, 'broken-link', 'Replaced the file with a link that leads nowhere (what an uninstalled skills manager leaves behind): the skill can go in, and Pi’s row says it replaces the broken link.');
  await a.click('#ppart-0-issue-tracker-skill-triage-pi-cli');
  await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await a.run(`document.querySelector('.plugin-head')?.scrollIntoView({ block: 'start' })`); await wait(150);
  await shot(a, 'broken-link-replaced', 'Turned triage on under Pi and clicked Apply all: the skill went in, in place of the broken link, and the result says so.');
  await a.click('#plugins-undo'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await a.run(`document.querySelector('.plugin-head')?.scrollIntoView({ block: 'start' })`); await wait(150);
  // Pi has a skill of its own named triage, so the plugin's triage is left out of Pi at first.
  mkdirSync(join(practice, '.pi/agent/skills/triage'), { recursive: true });
  writeFileSync(join(practice, '.pi/agent/skills/triage/SKILL.md'), '---\nname: triage\ndescription: My own triage.\n---\nMine.\n');
  await a.click('#header-refresh'); await waitFor(a, `/Can’t go in: skill triage/.test(document.querySelector('.plugin-parts-section')?.textContent ?? '')`);
  await a.click('#pcell-0-issue-tracker-pi-cli'); await a.click('#pcell-0-issue-tracker-codex-cli');
  await shot(a, 'page-chosen', 'Clicked the Pi and Codex boxes: both wait for Apply all.');
  await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await shot(a, 'page-installed', 'Clicked Apply all: the skill and MCP server went into Codex as ordinary items; Pi got the MCP server, its own triage skill kept the name.');
  rmSync(join(practice, '.pi/agent/skills/triage'), { recursive: true, force: true });
  await a.click('#header-refresh'); await waitFor(a, `/Can go in now/.test(document.querySelector('.plugin-parts-section')?.textContent ?? '')`);
  await shot(a, 'page-can-go-in-now', 'Removed Pi’s own triage skill and clicked Refresh: the plugin’s triage can go in now, with Update parts.');
  await a.click('#pparts-issue-tracker'); await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await a.click('#plugin-back');
  await a.click('#popen-0-release-helper'); await waitFor(a, `/(Can go in|Nothing in it)/.test(document.querySelector('.plugin-parts-section')?.textContent ?? '')`);
  await shot(a, 'page-left-behind', 'Opened release-helper (a command, an agent and hooks): what goes in where, and what stays with the plugin.');
  await a.click('#plugin-back'); await shot(a, 'list-installed', 'Back to the list: Pi and Codex show the parts mark.');
  await a.click('#nav-skills'); if (await a.has('#open-triage')) await a.click('#open-triage');
  await shot(a, 'skills-provenance', 'Skills page, triage opened: it says which plugin it came from, with a way to its page.');
  await a.click('#nav-mcp'); if (await a.has('#open-issues')) await a.click('#open-issues');
  await shot(a, 'mcp-provenance', 'MCP page, issues opened: the server in Pi’s and Codex’s own formats, from issue-tracker.');
  // The marketplace publishes a new version: the triage skill changed.
  edit(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), text => text.replace('Follow the steps.', 'Follow the steps, then label it.'));
  edit(join(market, '.claude-plugin/marketplace.json'), text => text.replace('"version": "2.0.0"', '"version": "2.1.0"'));
  await a.click('#nav-plugins'); if (await a.has('#plugin-back')) await a.click('#plugin-back');
  await a.click('#header-refresh'); await waitFor(a, `document.querySelector('#pcell-0-issue-tracker-pi-cli')?.dataset.state === 'parts-changed'`, 60000);
  await shot(a, 'list-out-of-date', 'The marketplace published 2.1.0 and Refresh read it again: the parts show as out of date.');
  await a.click('#popen-0-issue-tracker'); await waitFor(a, `/(Can go in|Installed|Out of date)/.test(document.querySelector('.plugin-parts-section')?.textContent ?? '')`);
  await shot(a, 'page-out-of-date', 'issue-tracker’s page: "Parts out of date" with Update parts.');
  await a.click('#pparts-issue-tracker'); await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await shot(a, 'page-updated', 'Clicked Update parts, then Apply all.');
  await a.click('#pcell-0-issue-tracker-pi-cli'); await shot(a, 'page-remove-chosen', 'Clicked Pi’s box: its parts are chosen for removal.');
  await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await shot(a, 'page-removed', 'Clicked Apply all: Pi’s parts were removed together.');
  if (await a.has('#plugins-undo')) { await a.click('#plugins-undo'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); await shot(a, 'page-undone', 'Clicked Undo: Pi’s parts are back.'); }
  await a.theme('light'); await shot(a, 'page-light', 'The same page in the light appearance.');
  await a.click('#plugin-back'); await shot(a, 'list-light', 'The list in the light appearance.'); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) {
    await size(width, height);
    await shot(a, `list-${width}`, `The list at ${width}×${height}.`);
    await a.click('#popen-0-issue-tracker'); await waitFor(a, `/(Can go in|Installed|Out of date)/.test(document.querySelector('.plugin-parts-section')?.textContent ?? '')`);
    await shot(a, `page-${width}`, `issue-tracker’s page at ${width}×${height}.`);
    await a.click('#plugin-back');
  }
  await size(1280, 800);
}

// ---------- What plugins installed whole bring, on Skills, MCP servers and Agents ----------
if (wanted('plugin-items')) {
  await fresh();
  begin('plugin-items');
  const market = join(scratch, 'items-market');
  writeMarket(market);
  const copyOf = (plugin, folder) => { cpSync(join(market, 'plugins', plugin), folder, { recursive: true }); return folder; };
  // As each tool records them: document-tools and release-helper in Claude Code (its marketplace added there), document-tools
  // in Copilot CLI with pdf-reader switched off, issue-tracker in Codex turned off (its marketplace added nowhere), and
  // issue-tracker's triage also in Pi as a separate part.
  const installs = Object.fromEntries(['document-tools', 'release-helper'].map(plugin => [`${plugin}@team-tools`, [{ scope: 'user', installPath: copyOf(plugin, join(practice, `.claude/plugins/cache/team-tools/${plugin}/1.0.0`)), version: plugin === 'document-tools' ? '1.2.0' : '0.4.1' }]]));
  writeFileSync(join(practice, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: installs }));
  writeFileSync(join(practice, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'team-tools': { source: { source: 'github', repo: 'example/team-tools' }, installLocation: market } }));
  const copilotCopy = copyOf('document-tools', join(practice, '.copilot/installed-plugins/team-tools/document-tools'));
  writeFileSync(join(practice, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'document-tools', marketplace: 'team-tools', version: '1.2.0', cache_path: copilotCopy, enabled: true }] }));
  writeFileSync(join(practice, '.copilot/settings.json'), JSON.stringify({ disabledSkills: ['document-tools:pdf-reader'] }));
  copyOf('issue-tracker', join(practice, '.codex/plugins/cache/team-tools/issue-tracker/2.0.0'));
  // document-tools in Codex too, with pdf-reader switched off there.
  copyOf('document-tools', join(practice, '.codex/plugins/cache/team-tools/document-tools/1.2.0'));
  edit(join(practice, '.codex/config.toml'), text => `${text}\n[plugins."issue-tracker@team-tools"]\nenabled = false\n\n[plugins."document-tools@team-tools"]\nenabled = true\n\n[[skills.config]]\nname = "document-tools:pdf-reader"\nenabled = false\n`);
  // Codex's switch is its config.toml (its CLI is only asked its version); Copilot CLI's is its own command, a stand-in here
  // that keeps pdf-reader off.
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  writeFileSync(join(HOME, '.local/bin/codex'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "codex-cli 0.167.0" && exit 0\nexit 9\n`, { mode: 0o755 });
  writeFileSync(join(HOME, '.local/bin/copilot'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "GitHub Copilot CLI 1.0.108." && exit 0\nS="$HOME/.copilot/settings.json"\ncase "$1 $2" in\n  "skill disable") printf '{"disabledSkills":["document-tools:pdf-reader","%s"]}' "$3" > "$S" ;;\n  "skill enable") printf '{"disabledSkills":["document-tools:pdf-reader"]}' > "$S" ;;\n  *) exit 9 ;;\nesac\n`, { mode: 0o755 });
  // Claude Code's switch for a whole plugin is its own command: a stand-in that turns document-tools off and back on.
  const claudeSettings = join(practice, '.claude/settings.json'), claudeSettingsAt = existsSync(claudeSettings) ? readFileSync(claudeSettings, 'utf8') : '{}';
  writeFileSync(join(HOME, '.local/bin/claude'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.322 (Claude Code)" && exit 0\ncase "$*" in\n  "plugin disable document-tools@team-tools --scope user") printf '{"enabledPlugins":{"document-tools@team-tools":false}}' > "${claudeSettings}" ;;\n  "plugin enable document-tools@team-tools --scope user") printf '%s' '${claudeSettingsAt}' > "${claudeSettings}" ;;\n  *) exit 9 ;;\nesac\n`, { mode: 0o755 });
  mkdirSync(join(practice, '.pi/agent/skills/triage'), { recursive: true });
  cpSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), join(practice, '.pi/agent/skills/triage/SKILL.md'));
  mkdirSync(join(practice, '.central-knot'), { recursive: true });
  writeFileSync(join(practice, '.central-knot/plugin-parts.json'), JSON.stringify({ installs: [{ source: market, marketName: 'team-tools', plugin: 'issue-tracker', version: '2.0.0', tool: 'pi-cli', at: new Date().toISOString(), digest: 'tour', items: [{ kind: 'skill', name: 'triage', hash: 'tour' }] }] }));
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  const toPlugins = async () => { await a.run(`document.querySelector('.ov-section-plugins')?.scrollIntoView({ block: 'center' })`); await wait(150); };
  await a.click('#nav-skills'); await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('.ov-section-plugins')`, 15000);
  await shot(a, 'skills', 'Skills: the plugins’ skills are rows under “Only through a plugin” (the From plugins chip counts every row from a plugin, triage too), each marked “from <plugin>”, with its switch and a mark in each tool that has it (pdf-reader off in Copilot CLI and Codex, issue-tracker’s whole plugin off in Codex); triage is one row with its Pi part.');
  await a.theme('light'); await shot(a, 'skills-light', 'The same, light.'); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await toPlugins();
    await shot(a, `skills-${width}`, `Skills at ${width}×${height}, scrolled to the plugin rows.`);
    await a.theme('light'); await shot(a, `skills-${width}-light`, `The same at ${width}×${height}, light.`); await a.theme('dark');
  }
  await size(1280, 800);
  await a.click('[id="open-document-tools@team-tools/pdf-reader"]');
  await shot(a, 'skill-open', 'Opened pdf-reader: it opens with where it is on (“On in Claude Code · off in Copilot CLI and Codex · from the plugin document-tools”), then where it is handled (a link to document-tools’ page; the switches below turn it on or off in each tool), and each tool’s line with its switch.');
  await a.click('[id="pfile-document-tools@team-tools/pdf-reader"]'); await waitFor(a, `!!document.querySelector('.details-plugin .plugin-file')`, 15000);
  await shot(a, 'skill-open-file', 'Clicked “Show its SKILL.md”, under the tools’ lines: the file opens right under the link, in its own scrolling box no taller than 40% of the window, and each tool’s switch stays in view above it.');
  await a.theme('light'); await shot(a, 'skill-open-light', 'The same, light.'); await a.theme('dark');
  await size(860, 560); await shot(a, 'skill-open-860', 'The open row at 860×560: the tools’ lines and their switches, then its SKILL.md under the link.');
  await a.theme('light'); await shot(a, 'skill-open-860-light', 'The same at 860×560, light.'); await a.theme('dark');
  await size(1728, 1117); await shot(a, 'skill-open-1728', 'The open row at 1728×1117.'); await size(1280, 800);
  // The row's own switch turns it off in every tool with a switch for one skill of a plugin. Copilot CLI and Codex have it off
  // already, and Claude Code has none, so nothing changes: said plainly, with the whole plugin's switch offered (not clicked
  // here: it is Claude Code's own command). The row's switch never turns a whole plugin off itself.
  await a.click('[id="switch-document-tools@team-tools/pdf-reader"]'); await a.settle();
  await shot(a, 'main-switch-left', 'Clicked pdf-reader’s own switch (on in Claude Code): Copilot CLI and Codex have it off already, and Claude Code has no switch for one skill of a plugin, so nothing changed. The band says so in its normal tone, naming pdf-reader, with the information mark, and offers “Turn document-tools off in Claude Code”. The first-use tip is gone with the first click.');
  await size(860, 560); await shot(a, 'main-switch-left-860', 'The same at 860×560.'); await size(1280, 800);
  if (await a.has('#outcome-whole')) {
    await a.click('#outcome-whole'); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
    await shot(a, 'main-switch-whole', 'Clicked “Turn document-tools off in Claude Code”: the whole plugin is off there, with Claude Code’s own command, and the band names what went with it, with Undo.');
    await a.click('#outcome-undo-plugin'); await a.settle();
    await shot(a, 'main-switch-whole-undone', 'Clicked Undo: document-tools is on in Claude Code again.');
  }
  await a.click('[id="open-document-tools@team-tools/pdf-reader"]');
  // spreadsheet is on in all three: its switch turns it off in Copilot CLI and Codex with their own switches, leaves Claude
  // Code on (and says so), and its Undo turns both back on.
  await a.click('[id="switch-document-tools@team-tools/spreadsheet"]'); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
  await shot(a, 'main-switch-changed', 'Clicked spreadsheet’s own switch: off in Copilot CLI and Codex at once, each with its own switch; still on in Claude Code, which has no switch for one skill of a plugin, so “Turn document-tools off in Claude Code” is offered beside Undo.');
  await size(860, 560); await a.click('#sidebar-toggle');
  await shot(a, 'main-switch-changed-860-sidebar', 'The same at 860×560 with the sidebar open: the two buttons drop under the sentence, which keeps the width.');
  await a.click('#sidebar-toggle'); await size(1280, 800);
  await a.click('#outcome-undo-plugin'); await a.settle();
  await shot(a, 'main-switch-changed-undone', 'Clicked Undo: “Undone: spreadsheet is back on in Copilot CLI and Codex.”');
  if (await a.has('#open-triage')) {
    await a.click('#open-triage'); await shot(a, 'part-and-plugin', 'Opened triage: its Pi part and the plugin installed in Codex share the row. The note says its switch also turns it on or off in Codex, through the plugin, and that deleting here removes only the separate item; Codex’s line has its switch.');
    // Each tool's switch for the item is in its opened row, and applies at once. issue-tracker is off in Codex: its switch
    // turns the plugin on there for triage alone.
    if (await a.has('#enable-triage-codex-cli')) {
      await a.click('#enable-triage-codex-cli'); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin, .bands .band')`, 15000);
      await shot(a, 'switch-applied', 'Clicked triage’s Codex switch in its opened row (the whole plugin issue-tracker was off there): it is on in Codex at once. The band leads with the skill clicked (“triage is on in Codex. Its plugin issue-tracker was turned on there, with its MCP server issues left off.”), with Undo.');
      await a.theme('light'); await shot(a, 'switch-applied-light', 'The same, light.'); await a.theme('dark');
      await size(860, 560); await shot(a, 'switch-applied-860', 'The same at 860×560.'); await size(1280, 800);
      if (await a.has('#outcome-undo-plugin')) { await a.click('#outcome-undo-plugin'); await a.settle(); await shot(a, 'switch-undone', 'Clicked Undo: issue-tracker is off in Codex again, as it was; the confirmation fades by itself.'); }
    }
  }
  await a.click('#nav-mcp'); await waitFor(a, `!!document.querySelector('.ov-section-plugins, [data-key^="issue-tracker@"]')`);
  await shot(a, 'mcp', 'MCP servers: issue-tracker’s issues server, installed in Codex with the plugin turned off.');
  await a.theme('light'); await shot(a, 'mcp-light', 'The same, light.'); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await toPlugins();
    await shot(a, `mcp-${width}`, `MCP servers at ${width}×${height}.`);
    await a.theme('light'); await shot(a, `mcp-${width}-light`, `The same at ${width}×${height}, light.`); await a.theme('dark');
  }
  await size(1280, 800);
  if (await a.has('[id="open-issue-tracker@team-tools/issues"]')) { await a.click('[id="open-issue-tracker@team-tools/issues"]'); await shot(a, 'mcp-open', 'Opened issues: its marketplace is added nowhere, so it says how Codex itself handles it; its switch is there all the same.'); }
  // One MCP server of a plugin has a switch of its own in every tool that takes plugins: its opened row's switch writes it at
  // once, and Undo takes it back.
  if (await a.has('[id="open-issue-tracker@team-tools/issues"]')) {
    if (!(await a.has('[id="enable-issue-tracker@team-tools/issues-codex-cli"]'))) await a.click('[id="open-issue-tracker@team-tools/issues"]');
    await a.click('[id="enable-issue-tracker@team-tools/issues-codex-cli"]'); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin, .bands .band')`, 15000);
    await shot(a, 'mcp-switch-applied', 'Clicked issues’ Codex switch in its opened row, where the whole plugin was off: it is on in Codex at once. The result leads with the server clicked (“issues is on in Codex. Its plugin issue-tracker was turned on there, with its skill triage left off.”), with Undo; the first-use tip is gone.');
    await size(1728, 1117); await shot(a, 'mcp-switch-applied-1728', 'The same at 1728×1117.'); await size(1280, 800);
    if (await a.has('#outcome-undo-plugin')) { await a.click('#outcome-undo-plugin'); await a.settle(); await shot(a, 'mcp-switch-undone', 'Clicked Undo: the plugin is off in Codex again, as it was.'); }
  }
  // The row's own switch does the same in every tool with a switch for one server: here, Codex.
  if (await a.has('[id="switch-issue-tracker@team-tools/issues"]')) {
    await a.click('[id="switch-issue-tracker@team-tools/issues"]'); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
    await shot(a, 'mcp-main-switch', 'Clicked the issues row’s own switch: it is on in Codex, the one tool that has it, with its plugin turned on there for it alone; with Undo.');
    await a.click('#outcome-undo-plugin'); await a.settle();
  }
  await a.click('#nav-agents'); await toPlugins(); await shot(a, 'agents', 'Agents: release-helper’s release-reviewer in Claude Code, under “From plugins · installed with their plugin · switched here like any other”.');
  if (await a.has('[id="open-release-helper@team-tools/release-reviewer"]')) {
    await a.click('[id="open-release-helper@team-tools/release-reviewer"]');
    await shot(a, 'agent-open', 'Opened release-reviewer: it opens with where it is on (“On in Claude Code · from the plugin release-helper”), where it is handled, and Claude Code’s line with its switch for this one agent.');
    await a.click('[id="switch-release-helper@team-tools/release-reviewer"]'); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
    await shot(a, 'agent-main-switch', 'Clicked release-reviewer’s own switch: off in Claude Code at once, with Claude Code’s switch for one agent (the rest of release-helper stays on); the key says “Off there”; with Undo.');
    await a.click('#outcome-undo-plugin'); await a.settle();
    await shot(a, 'agent-main-switch-undone', 'Clicked Undo: release-reviewer is on in Claude Code again.');
  }
  await a.click('#nav-overview'); await shot(a, 'overview', 'Overview: each card counts the plugins’ items apart (“from plugins”).');
  await a.click('#nav-harnesses'); await shot(a, 'harnesses', 'Harnesses: each card’s counts say how many come from plugins.');
  await a.click('#harness-copilot-cli'); await a.click('#harness-tab-skills'); await toPlugins();
  await shot(a, 'harness-skills', 'Copilot CLI’s page, Skills tab: its plugin rows, those it has.');
}

// ---------- Instructions ----------
if (wanted('instructions')) {
  begin('instructions');
  await a.click('#nav-instructions');
  await waitFor(a, `!!document.querySelector('#ins-edit-claude-cli')`);
  await shot(a, 'instructions-start', 'Clicked "Instructions" in the sidebar. The practice copy has CLAUDE.md and AGENTS.md; Copilot CLI has no file yet.');
  await a.click('#ins-edit-claude-cli'); await shot(a, 'instructions-editing', 'Clicked Edit on Claude Code\'s file.');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value = area.value.replace('Prefer small commits', 'Prefer small, focused commits') + '- Never push without asking.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli'); await shot(a, 'instructions-review', 'Changed one line, added another, and clicked Review changes.');
  await a.click('#ins-save-claude-cli'); await wait(400); await shot(a, 'instructions-saved', 'Clicked Save.');
  await a.click('#ins-edit-copilot-cli'); await shot(a, 'instructions-new-file', 'Clicked "Write instructions" on Copilot CLI, which has no file yet.');
  // Near the cards' column breakpoint (each about 320px), a card's review and discard confirmation wrap within it.
  await a.size(1240, 800);
  await a.run(`(() => { const area = document.querySelector('#ins-text-copilot-cli'); area.value = '# How I work\\n- Explain the plan first.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await shot(a, 'instructions-1240-saved-unsaved', 'At 1240×800: Claude Code\'s card says Saved with Undo save, Copilot CLI\'s says Unsaved changes, and Codex\'s card is plain; the headers line up.');
  await a.click('#ins-review-copilot-cli'); await shot(a, 'instructions-review-1240', 'At 1240×800, three cards across: wrote a first draft for Copilot CLI and clicked Review new file.');
  await a.click('#ins-review-discard-copilot-cli'); await shot(a, 'instructions-discard-confirm-1240', 'Clicked Discard changes: the confirmation wraps within the card.');
  await a.click('#ins-review-discard-yes-copilot-cli');
  await a.size(1280, 800);
  await a.click('#ins-edit-copilot-cli');
  // A draft whose tool leaves the home: kept, and offered to copy or discard.
  await a.run(`(() => { const area = document.querySelector('#ins-text-copilot-cli'); area.value = '# How I work\\n- Explain the plan first.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  renameSync(join(practice, '.copilot'), join(practice, '.copilot-away'));
  await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#ins-orphan')`);
  await shot(a, 'instructions-orphan-draft', 'Typed a draft for Copilot CLI, then moved Copilot CLI\'s folder away outside the app and clicked Refresh: the card is gone, and the draft is offered to copy or discard.');
  await a.click('#ins-orphan-discard');
  renameSync(join(practice, '.copilot-away'), join(practice, '.copilot'));
  await a.click('#header-refresh');
}

// ---------- Window sizes: every page from the window's minimum to a large display, full screen ----------
/** Adds the fixture marketplace once, so the Plugins pages have something to show. */
async function ensureMarket() {
  await a.click('#nav-plugins');
  await waitFor(a, `!!document.querySelector('.market-list, #marketplace-source')`);
  if (await a.has('#plugin-back')) await a.click('#plugin-back');
  if (await a.has('.market-list')) return;
  const market = join(scratch, 'market');
  if (!existsSync(market)) writeMarket(market);
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(market)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
  await waitFor(a, `!!document.querySelector('.market-list')`, 30000);
}

/** One shot of each page at the current size; `tag` names the size in the file names. */
async function everyPage(tag) {
  const at = `at ${a.viewport.width}×${a.viewport.height}`;
  await a.click('#nav-overview'); await shot(a, `${tag}-overview`, `The Overview ${at}.`);
  await a.click('#nav-skills'); await shot(a, `${tag}-skills`, `Skills ${at}.`);
  // notes, when there: a skill whose copies agree, so its details offer Files and contents.
  const first = await a.run(`(document.querySelector('#open-notes') ?? document.querySelector('.ov-row[data-key] .row-open'))?.id ?? ''`);
  if (first) {
    if (!(await a.has('.ov-row.open, .dock'))) await a.click(`#${first}`);
    if (!(await waitFor(a, `!!document.querySelector('.ov-row.open, .dock')`))) throw new Error(`The skill's details did not open ${at}.`);
    await shot(a, `${tag}-skills-details`, `Opened notes's details ${at} (beside the table from 1200px of content).`);
    const files = await a.run(`document.querySelector('[id^="files-"]')?.id ?? ''`);
    if (files) {
      await a.click(`#${files}`); await shot(a, `${tag}-skills-files`, `Clicked "Files and contents": the list and one skill's files ${at}.`);
      // Where each copy is: open from the start in a wide pane, in its column beside the file; stacked, below the file.
      if (await a.has('.details-paths:not([open]) summary')) { await a.click('.details-paths:not([open]) summary'); await shot(a, `${tag}-skills-files-where`, `Clicked "Where each copy is", below the file, ${at}: then Delete from Central Knot….`); }
      else if (await a.has('.details-paths[open]')) { await a.run(`document.querySelector('.details-paths').scrollIntoView({ block: 'nearest' })`); await shot(a, `${tag}-skills-files-where`, `"Where each copy is" is open from the start ${at}: the skill's details in their column at the right, the status first and Delete everywhere… last.`); }
      const toggle = await a.run(`document.querySelector('[id^="detail-switch-"]')?.id ?? ''`);
      if (toggle) { await a.click(`#${toggle}`); await shot(a, `${tag}-skills-files-switched`, `Turned its switch in the Files view: it applies at once; the result and Undo are in the strip at the top ${at}.`); if (await a.has('#outcome-undo')) await a.click('#outcome-undo'); }
      await a.click('#skills-table');
    }
    if (await a.has('.ov-row.open')) await a.click(`#${first}`);
  }
  // draft's copies differ: its switch opens the copy question under its row, and a second click closes it.
  if (await a.has('#add-draft')) {
    await a.click('#add-draft'); await shot(a, `${tag}-skills-choice`, `Clicked draft's Add: its copies differ, so the copy question opens under its row ${at}.`);
    if (await a.has('#use-draft-copilot-cli')) await a.click('#add-draft');
  }
  const on = await a.run(`document.querySelector('.ov-row[data-key] .switch[aria-checked="true"]:not([disabled])')?.id ?? ''`);
  if (on) { await a.click(`#${on}`); await shot(a, `${tag}-skills-switched-off`, `Turned one skill off: its result and Undo ${at}.`); if (await a.has('#outcome-undo')) await a.click('#outcome-undo'); }
  await a.click('#nav-mcp'); await shot(a, `${tag}-mcp`, `MCP servers ${at}: nothing is synced there yet, and a server whose copies differ is marked “Copies differ”.`);
  const server = await a.run(`document.querySelector('.ov-row[data-key] .row-open')?.id ?? ''`);
  if (server) {
    if (!(await a.has('.ov-row.open, .dock'))) await a.click(`#${server}`);
    if (await waitFor(a, `!!document.querySelector('.ov-row.open, .dock')`)) await shot(a, `${tag}-mcp-details`, `Opened the first MCP server's details ${at} (docked beside the table from 1200px of content).`);
    if (await a.has('.ov-row.open')) await a.click(`#${server}`);
  }
  await a.click('#nav-agents'); await shot(a, `${tag}-agents`, `Agents ${at}.`);
  const agent = await a.run(`document.querySelector('.ov-row[data-key] .row-open')?.id ?? ''`);
  if (agent) {
    // An earlier step may have left the row open: a click would close it, so it is clicked only while closed.
    if (!(await a.has('.ov-row.open, .dock'))) await a.click(`#${agent}`);
    if (!(await waitFor(a, `!!document.querySelector('.ov-row.open, .dock')`))) throw new Error(`The agent's details did not open ${at}.`);
    await shot(a, `${tag}-agents-details`, `Opened the first agent's details ${at} (beside the table from 1200px of content).`);
    await a.click(`#${agent}`);
  }
  await a.click('#nav-instructions'); await waitFor(a, `!!document.querySelector('.ins-card, .empty')`); await shot(a, `${tag}-instructions`, `Instructions ${at}.`);
  await ensureMarket(); await shot(a, `${tag}-plugins`, `Plugins, the marketplace's list ${at}.`);
  if (await a.has('[id^="popen-0-"]')) {
    await a.click('[id^="popen-0-"]'); await waitFor(a, `!!document.querySelector('.plugin-group, .plugin-muted')`);
    await shot(a, `${tag}-plugin-page`, `A plugin's page ${at}.`); await a.click('#plugin-back');
  }
  await a.click('#nav-history');
  // The pointer over the second row, so its full-width hover shows.
  const hovered = await a.run(`(() => { const row = document.querySelectorAll('.history-row')[1]?.getBoundingClientRect(); return row ? [row.left + row.width / 2, row.top + row.height / 2] : null; })()`);
  const pointer = hovered ? { x: hovered[0], y: hovered[1] } : undefined;
  if (pointer) await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer });
  const isHovered = hovered && await waitFor(a, `!!document.querySelectorAll('.history-row')[1]?.matches(':hover')`, 2000);
  await shot(a, `${tag}-history`, `History ${at}${isHovered ? ', the pointer over the second row (its hover tint shows)' : ''}.`, pointer);
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await a.click('#nav-harnesses'); await shot(a, `${tag}-harnesses`, `Harnesses ${at}.`);
  await a.click('#nav-settings'); await shot(a, `${tag}-settings`, `Settings ${at}.`);
}

/** An edit to Copilot CLI's MCP settings made outside the app, files being in Central Knot, so the MCP page shows its notice and actions. */
async function editMcpOutside() {
  await a.click('#nav-mcp');
  if (await a.has('#add-files')) { await a.click('#add-files'); await a.settle(); }
  edit(join(practice, '.copilot/mcp-config.json'), text => (text.includes('"npx-edited"') ? text.replace('"npx-edited"', '"npx"') : text.replace('"command": "npx"', '"command": "npx-edited"')));
  await waitFor(a, `!!document.querySelector('.sync-notice')`, 10000);
}

if (wanted('sizes')) {
  await fresh();
  begin('sizes');
  // Four tools: Pi gets its own folder in the practice copy, so every table has its widest set of columns.
  cpSync(join(practice, '.claude/skills/notes'), join(practice, '.pi/agent/skills/notes'), { recursive: true });
  // A skill whose copies differ, so its copy question can be shown.
  for (const [tool, body] of [['.claude', 'Claude Code’s draft.'], ['.copilot', 'Copilot CLI’s draft.']]) {
    mkdirSync(join(practice, tool, 'skills/draft'), { recursive: true });
    writeFileSync(join(practice, tool, 'skills/draft/SKILL.md'), `---\nname: draft\ndescription: Turn notes into a first draft.\n---\n\n${body}\n`);
  }
  await a.click('#nav-skills'); await a.click('#header-refresh');
  await editMcpOutside();
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await a.size(width, height);
    if (width === 860) {
      // An edit made outside the app while the Overview is open: the rail marks Skills with a dot until it is seen.
      await a.click('#nav-overview');
      edit(join(practice, '.claude/skills/release-notes/SKILL.md'), text => text.replace(/\n*$/, '\nEdited in Claude Code for the rail.\n'));
      if (await waitFor(a, `!!document.querySelector('.nav-unseen')`, 30000)) await shot(a, '860-rail-unseen-dot', 'At 860×560 with the sidebar as a rail: a skill edited outside the app (release-notes, in Claude Code) puts a dot at the Skills icon\'s top right, and the icons stay in one column.');
    }
    await everyPage(`${width}`);
    // Large windows open with the sidebar; folded to its rail, every page has the extra width too.
    if (width >= 1728) { await a.click('#sidebar-toggle'); await everyPage(`${width}-rail`); await a.click('#sidebar-toggle'); }
    // Pi's mark as the window shows it at 100% zoom, on an Overview card and in the table's header.
    if (width === 1280) {
      await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await a.click('#nav-overview'); await shot(a, '1280-overview-1x', 'The Overview at 1280×800 at 100% zoom (one screen pixel per pixel), where the tools\' small marks, Pi\'s among them, are drawn at 12px.');
      await a.click('#nav-skills'); await shot(a, '1280-skills-1x', 'Skills at 100% zoom: each row’s tool marks at its right end, and the key under the table.');
      await a.size(width, height);
    }
    // At the minimum the sidebar folds to its rail; the person can open it, leaving the content about 650px.
    if (width === 860) {
      await a.click('#sidebar-toggle'); await everyPage('860-sidebar-open'); await a.click('#sidebar-toggle');
      // A message in the status bar at the minimum: the facts keep their words, and the message shortens.
      await a.click('#nav-skills');
      // A switch whose result band is dismissed leaves its result in the status bar.
      const box = await a.run(`document.querySelector('.ov-row[data-key] .switch:not([disabled])')?.id ?? ''`);
      if (box) {
        const said = async name => { await a.click(`#${box}`); if (await a.has('#outcome-dismiss')) await a.click('#outcome-dismiss'); await shot(a, name[0], name[1]); await a.click(`#${box}`); if (await a.has('#outcome-dismiss')) await a.click('#outcome-dismiss'); };
        await said(['860-status-message', 'Turned a skill’s switch, then dismissed its result: the status bar says it at 860×560, with the sidebar as a rail.']);
        await a.click('#sidebar-toggle');
        await said(['860-sidebar-open-status-message', 'The same with the sidebar open: with too little room for the message, a mark stands in, the message its tooltip.']);
        await a.click('#sidebar-toggle');
      }
    }
  }
  await a.theme('light');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) { await a.size(width, height); await everyPage(`${width}-light`); }
  await a.theme('dark');
  // Reading again, and a read again that failed: a page keeps what it showed, and says so in a quiet band.
  const main = await requestHandles(a);
  if (main) {
    await a.size(1728, 1117);
    await ensureMarket();
    await main.slow('plugins:view', 4000);
    await a.click('#header-refresh');
    if (await waitFor(a, `!!document.querySelector('.rereading')`, 2000)) await shot(a, '1728-plugins-rereading', 'Clicked Refresh on Plugins at 1728×1117: while the marketplaces are read again (slowed here to show it), the last read stays, with a quiet band saying so.');
    await main.restore('plugins:view');
    await waitFor(a, `!document.querySelector('.rereading')`, 8000);
    await a.click('#nav-history');
    await main.fail('history:list');
    await a.click('#nav-history');
    if (await waitFor(a, `!!document.querySelector('.reread-failed')`, 3000)) await shot(a, '1728-history-reread-failed', 'Opened History again while its read was made to fail: the last read stays on screen, and a quiet band says it could not read again.');
    await main.restore('history:list');
    await a.click('#nav-history');
    main.close();
  }
  // A marketplace with a long name and long facts, with a change waiting, at the smallest window.
  await a.size(860, 560);
  await ensureMarket();
  const longMarket = join(scratch, 'market-long');
  writeMarket(longMarket, 'platform-engineering-shared-developer-tools-marketplace', 'The Platform Engineering and Developer Experience Group');
  await a.click('#open-add-marketplace');
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(longMarket)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace'); await waitFor(a, `document.querySelectorAll('.market-item').length > 1`, 30000);
  const box = await a.run(`document.querySelector('.plugin-row .cell-button:not([disabled])')?.id ?? ''`);
  if (box) await a.click(`#${box}`);
  await shot(a, '860-long-marketplace', 'Added a marketplace with a long name and a long maker\'s name, and chose one install, at 860×560.');
  await a.click('#sidebar-toggle'); await shot(a, '860-sidebar-open-long-marketplace', 'The same with the sidebar open: the change waiting for Apply all keeps the toolbar\'s right end.'); await a.click('#sidebar-toggle');
  await a.size(1280, 800); await shot(a, '1280-long-marketplace', 'The same at 1280×800: the facts that don\'t fit beside the name drop whole.');
  if (await a.has('#plugins-discard')) await a.click('#plugins-discard');
  await a.click('#market-tab-about'); await shot(a, '1280-long-marketplace-about', 'Its About tab: every fact, where it comes from, and Remove.');
  if (await a.has('[id^="forget-"]')) await a.click('[id^="forget-"]');
  await a.size(1280, 800);
}

// ---------- A home with only some tools ----------
// Copilot CLI's column, its header menu entry, its Plugins box and its Instructions card, shown first in the practice copy
// and then gone in a folder that holds only Claude Code's and Codex's folders. A folder home looks for no installed apps,
// so this holds on any machine. The app starts again with that folder remembered, as choosing one opens a system dialog.
/** The views where a tool can appear as an option, each shot once; `tag` says which home. */
async function toolViews(tag, home) {
  await a.click('#nav-skills');
  const head = await a.run(`document.querySelector('.tool-head-button')?.id ?? ''`);
  if (head) { await a.click(`#${head}`); await shot(a, `${tag}-skills-menu`, `${home}: Skills, with the first tool's menu open (it offers each other tool).`); await a.click(`#${head}`); }
  await ensureMarket(); await shot(a, `${tag}-plugins`, `${home}: Plugins, one box per tool.`);
  await a.click('#nav-instructions'); await waitFor(a, `!!document.querySelector('.ins-card, .empty')`); await shot(a, `${tag}-instructions`, `${home}: Instructions, one card per tool.`);
  await a.click('#nav-harnesses'); await shot(a, `${tag}-harnesses`, `${home}: Harnesses.`);
}

// ---------- Skills kept by the `npx skills` installer: the shared ~/.agents/skills folder and links to it ----------
// A folder home whose skill lives in .agents/skills with a link to it from Copilot CLI's folder (Pi reads the shared folder
// itself). Each state at 860×560, 1280×800, 1728×1117 and 2560×1440; the main ones in light and dark.
if (wanted('shared-copies')) {
  begin('shared-copies');
  const folder = join(scratch, 'shared-copies');
  const cli = (path, version) => { mkdirSync(join(folder, path, '..'), { recursive: true }); writeFileSync(join(folder, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(folder, path), 0o755); };
  cli('.local/bin/claude', '2.1.309 (Claude Code)'); cli('.local/bin/copilot', 'GitHub Copilot CLI 1.0.107.'); cli('.pi/agent/bin/pi', 'pi 1.5.0');
  const skillAt = (dir, name, body) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`); };
  const [claude, copilot, pi, agents] = ['.claude/skills', '.copilot/skills', '.pi/agent/skills', '.agents/skills'].map(path => join(folder, path));
  for (const dir of [claude, copilot, pi]) mkdirSync(dir, { recursive: true });
  skillAt(claude, 'release-notes', 'Draft release notes from merged changes.');
  const name = 'opus-sol-loop';
  const install = () => { rmSync(join(agents, name), { recursive: true, force: true }); rmSync(join(copilot, name), { recursive: true, force: true }); skillAt(agents, name, 'Loop two models over a plan until they agree.'); symlinkSync(`../../.agents/skills/${name}`, join(copilot, name)); };
  install();
  const settings = join(scratch, 'data/app-settings.json');
  const openFolder = async path => {
    a.quit(); await wait(500);
    writeFileSync(settings, JSON.stringify({ ...JSON.parse(existsSync(settings) ? readFileSync(settings, 'utf8') : '{}'), home: { mode: 'custom', path } }));
    a = await launch();
    await a.click('#nav-skills');
  };
  await openFolder(folder);
  const sizes = [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]];
  /**
   * One state at every size (and in light too when `both`), scrolled as a person would see it: the skill's row at the top of the
   * table, below its sticky headings (the row's scroll margin, as the app scrolls it on opening), then `into` only as far as
   * it takes to show it.
   */
  const everySize = async (tag, caption, into, both = false, key = name) => {
    for (const theme of both ? ['dark', 'light'] : ['dark']) {
      await a.theme(theme);
      for (const [width, height] of sizes) {
        await a.size(width, height);
        if (into) await a.run(`(() => { document.querySelector(${JSON.stringify(`.ov-row[data-key="${key}"]`)})?.scrollIntoView({ block: 'start' }); document.querySelector(${JSON.stringify(into)})?.scrollIntoView({ block: 'nearest' }); })()`);
        await shot(a, `${tag}-${theme}-${width}`, `${caption} (${theme}, ${width}×${height})`);
      }
    }
    await a.theme('dark'); await a.size(1280, 800);
  };
  const open = async () => { if (!(await a.has(`#outside-${name}, #delete-${name}`))) await a.click(`#open-${name}`); };
  await open();
  await everySize('unmanaged', `Opened ${name}: the real folder is in ~/.agents/skills, Copilot CLI's skills folder has a link to it, Pi reads the shared folder. The details say where the copies are and what turning it on and Delete everywhere do; the rows say how each tool gets it.`, `#outside-${name}`, true);
  const turnOn = async () => { await turnOnRow(name); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000); };
  await turnOn();
  await everySize('turned-on', 'Clicked its switch: it is on in every tool at once; the band says what was done to the link and the shared copy, with Undo; the skill is an ordinary synced one.', '.bands', true);
  await a.click('#outcome-undo'); await a.settle();
  await open();
  await everySize('undone', 'Clicked Undo in that band: it says the skill is as before, and that the link and the shared copy are back.', '.bands');
  await a.click(`#delete-${name}`);
  await everySize('delete-armed', `Clicked "Delete everywhere…" on the skill that isn't synced: the second click is offered, and it says it also removes the link and the shared copy.`, `#delete-note-${name}`, true);
  await a.click(`#delete-confirm-${name}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await everySize('deleted', 'Clicked "Delete from every tool now": every copy is gone, the link removed as a link, the shared copy too; the band names the skill and the shared folder, with Undo.', '.bands', true);
  // Installed again and turned on; then the installer puts the shared copy and the link back: the page offers to deal with them.
  install();
  await a.click('#header-refresh');
  await turnOn();
  install();
  await a.click('#header-refresh');
  await open();
  await everySize('came-back', 'Turned on, then the installer put the shared copy and the link back ("Refresh"): the status says which tools read the shared copy, which Central Knot doesn’t write, and the details say they came back and offer "Replace with managed copies…".', `#outside-${name}`, true);
  await a.click(`#remove-${name}-copilot-cli`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await everySize('came-back-remove', 'Clicked "Remove" on Copilot CLI’s row (the link): only the link goes, at once; nothing says it becomes a real copy.', '.bands', true);
  await a.click('#outcome-undo'); await a.settle();
  await open();
  await a.click(`#takeover-${name}`);
  await everySize('came-back-armed', 'Clicked "Replace with managed copies…": the second click is offered, saying what goes.', `#takeover-note-${name}`);
  await a.click(`#takeover-confirm-${name}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await everySize('came-back-replaced', 'Clicked "Replace them now": the link is a real copy again and the shared copy is gone, with Undo.', '.bands');
  await open();
  await a.click(`#delete-${name}`);
  await everySize('managed-delete-armed', 'Clicked "Delete everywhere…" on the synced skill: it asks once more.', `#delete-confirm-${name}`);
  await a.click(`#delete-confirm-${name}`);
  await everySize('managed-deleted', 'Clicked "Delete from every tool now": deleted everywhere, with Restore.', '.band-done');
  // Undo refused: on again (taken over), then Claude Code's new copy edited before any sync: nothing is undone, and the band says why.
  install();
  await a.click('#header-refresh');
  await open();
  await turnOn();
  writeFileSync(join(claude, name, 'SKILL.md'), `${readFileSync(join(claude, name, 'SKILL.md'), 'utf8')}\nEdited in Claude Code.\n`);
  await a.click('#outcome-undo'); await a.settle();
  await everySize('undo-refused', 'Turned it on again, edited Claude Code’s new copy, then clicked Undo: nothing is undone, and the band says why.', '.bands', true);
  // Came back, then deleted while synced: Restore gives each tool its own copy and says the link and the shared copy aren't put back.
  await open();
  await a.click(`#delete-${name}`);
  await a.click(`#delete-confirm-${name}`);
  install();
  await a.click('#header-refresh');
  await open();
  await turnOn();
  install();
  await a.click('#header-refresh');
  await open();
  await a.click(`#delete-${name}`);
  await a.click(`#delete-confirm-${name}`);
  await a.click('#outcome-restore-delete');
  await everySize('came-back-deleted-restored', 'Came back again (turned on, then the installer put the shared copy and the link back), deleted everywhere, then "Restore": back in every tool, and the band says the link and the shared copy aren’t put back.', '.bands');
  // Layout 4: Copilot CLI's whole skills folder is a link to the shared folder, so the copy there is the only one it can have.
  const linked = join(scratch, 'shared-root');
  for (const [path, version] of [['.local/bin/claude', '2.1.309 (Claude Code)'], ['.local/bin/copilot', 'GitHub Copilot CLI 1.0.107.'], ['.pi/agent/bin/pi', 'pi 1.5.0']]) { mkdirSync(join(linked, path, '..'), { recursive: true }); writeFileSync(join(linked, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(linked, path), 0o755); }
  mkdirSync(join(linked, '.claude/skills'), { recursive: true }); mkdirSync(join(linked, '.pi/agent/skills'), { recursive: true }); mkdirSync(join(linked, '.copilot'), { recursive: true });
  skillAt(join(linked, '.agents/skills'), 'gamma', 'A skill the installer keeps in the shared folder.');
  symlinkSync('../.agents/skills', join(linked, '.copilot/skills'));
  await openFolder(linked);
  if (!(await a.has('#outside-gamma'))) await a.click('#open-gamma');
  await everySize('linked-skills-folder', 'A folder whose Copilot CLI skills folder is itself a link to ~/.agents/skills: opened gamma. The details say the shared copy is the only one Copilot CLI can have, what turning it on does and what that means for edits; no action is offered that could not work.', '#outside-gamma', true, 'gamma');
  await a.click('#delete-gamma');
  await everySize('linked-skills-folder-delete-armed', 'Clicked "Delete everywhere…" there: it says what it removes.', '#delete-note-gamma', false, 'gamma');
  await a.click('#delete-cancel-gamma');
  await turnOnRow('gamma'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  if (!(await a.has('#outside-gamma'))) await a.click('#open-gamma');
  await everySize('linked-skills-folder-managed', 'Turned gamma on there: Claude Code has its own copy, Copilot CLI and Pi keep the shared copy, and the details say edits made in Claude Code don’t reach them.', '#outside-gamma', true, 'gamma');
  await a.click('#delete-gamma');
  await a.click('#delete-confirm-gamma');
  await everySize('linked-skills-folder-deleted', 'Clicked "Delete from every tool now" there: deleted from all three tools and from ~/.agents/skills, with Restore.', '.band-done', false, 'gamma');
  await a.click('#outcome-restore-delete');
  await everySize('linked-skills-folder-restored', 'Clicked "Restore": the band says the shared copy is back, the only copy Copilot CLI can have.', '.bands', false, 'gamma');
}

if (wanted('missing')) {
  begin('missing');
  await a.click('#home-fixture');
  await toolViews('before', 'The practice copy, with every tool');
  // This Mac's home looks for installed apps too: a tool installed here still counts; one that isn't (Pi) is named on Harnesses.
  for (const name of ['.claude', '.claude.json', '.codex']) cpSync(join(root, 'fixtures/home', name), join(HOME, name), { recursive: true });
  await a.click('#home-actual'); await a.click('#nav-harnesses');
  await shot(a, 'this-mac-harnesses', 'This Mac\'s home with only Claude Code\'s and Codex\'s folders: a tool installed on this machine still counts; a tool not found is named once, at the end.');
  await a.size(2560, 1440); await shot(a, 'this-mac-harnesses-2560', 'The same at 2560×1440: as many columns as cards.'); await a.size(1280, 800);
  const folder = join(scratch, 'two-tools');
  for (const name of ['.claude', '.claude.json', '.codex']) cpSync(join(root, 'fixtures/home', name), join(folder, name), { recursive: true });
  a.quit();
  await wait(500);
  const settings = join(scratch, 'data/app-settings.json');
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: folder } }));
  a = await launch();
  await toolViews('after', 'A folder with only Claude Code and Codex');
  await a.click('#nav-overview'); await shot(a, 'after-overview', 'The same folder\'s Overview: its first sentence names only the two tools.');
  await a.size(2560, 1440);
  await a.click('#nav-harnesses'); await shot(a, 'after-2560-harnesses', 'The same folder\'s Harnesses at 2560×1440: two cards, two columns.');
  await a.click('#nav-instructions'); await waitFor(a, `!!document.querySelector('.ins-card, .empty')`); await shot(a, 'after-2560-instructions', 'Its Instructions at 2560×1440: two cards, two columns, one height.');
  await a.size(1280, 800);
  await a.size(860, 560);
  await a.click('#nav-skills'); await shot(a, 'after-860-skills', 'The same folder\'s Skills at 860×560.');
  await a.size(1280, 800);
  // A folder whose only tool is Pi, which takes no plugins: the Plugins page says so instead of drawing an empty table.
  const piOnly = join(scratch, 'pi-only');
  cpSync(join(root, 'fixtures/home/.claude/skills/notes'), join(piOnly, '.pi/agent/skills/notes'), { recursive: true });
  a.quit();
  await wait(500);
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: piOnly } }));
  a = await launch();
  await a.click('#nav-overview'); await shot(a, 'pi-only-overview', 'A folder whose only tool is Pi: the sidebar and the Overview leave out Agents and Plugins, which Pi can\'t hold, and the Overview names them once.');
  await a.click('#nav-harnesses'); await shot(a, 'pi-only-harnesses', 'The same folder\'s Harnesses: Pi\'s card names only what Pi can hold (skills and MCP servers).');
  await a.size(2560, 1440); await a.click('#nav-overview'); await shot(a, 'pi-only-2560-overview', 'The Pi-only Overview at 2560×1440: two kind cards in two columns.'); await a.size(1280, 800);
  // A folder with no tools at all: every page stays, each saying so.
  const empty = join(scratch, 'no-tools');
  mkdirSync(empty, { recursive: true });
  a.quit();
  await wait(500);
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: empty } }));
  a = await launch();
  await a.click('#nav-overview'); await shot(a, 'no-tools-overview', 'A folder with no tools at all: the sidebar keeps Overview, History, Harnesses and Settings, and the Overview says no tools were found, with Choose another home….');
  await a.click('#nav-harnesses'); await shot(a, 'no-tools-harnesses', 'Its Harnesses page: the same sentence and action, in the same place.');
  await a.click('#nav-history'); await waitFor(a, `!!document.querySelector('#history-choose-home, .history-row')`); await shot(a, 'no-tools-history', 'Its History page: the same sentence and action, in the same place.');
  await a.size(860, 560); await a.click('#nav-overview'); await shot(a, 'no-tools-860-overview', 'The Overview at 860×560.');
  await a.click('#nav-harnesses'); await shot(a, 'no-tools-860-harnesses', 'Its Harnesses page at 860×560.');
  await a.size(1280, 800);
}

// ---------- Updates ----------
// A stand-in for GitHub's releases, and the app acting as an installed copy of v0.5.0-preview.4 (CK_UPDATE_STUB): the sidebar's
// update control at the bottom left at each step, open and in the rail at 860×560, 1280×800, 1728×1117 and 2560×1440, and the
// Settings row.
if (wanted('updates')) {
  const zip = join(scratch, 'update.zip');
  writeFileSync(zip, Buffer.alloc(4_000_000, 7));
  const releases = [{ tag: 'v0.5.0-preview.5', zip, bytesPerSecond: 400_000 }];
  const fixture = await serveReleases(releases);
  const as = tag => ({ CK_UPDATE_STUB: tag, CK_UPDATE_RELEASES: fixture.releasesUrl });
  await fresh(as('v0.5.0-preview.4'));
  begin('updates');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.run(`window.dispatchEvent(new Event('resize'))`); await a.settle(); };
  /** The state on screen at each size the UI rule names, with the sidebar as the window chooses it and then the other way. */
  const everySize = async (name, said) => {
    for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
      await size(width, height);
      const rail = await a.run(`document.body.classList.contains('rail')`);
      await shot(a, `${name}-${width}-${rail ? 'rail' : 'open'}`, `${said} At ${width}×${height}, the sidebar ${rail ? 'folded to its rail' : 'open'}.`);
      await a.click('#sidebar-toggle');
      await shot(a, `${name}-${width}-${rail ? 'open' : 'rail'}`, `The same with the sidebar ${rail ? 'open' : 'folded to its rail'}.`);
      await a.click('#sidebar-toggle');
    }
    await size(1280, 800);
  };
  await shot(a, 'check', 'The app as it opens: the sidebar ends in "Check for updates" at the bottom left, its circular arrows quiet; the status bar names the build, "Central Knot 0.5.0 preview 4".');
  await everySize('check', 'Check for updates, before the first check.');
  await waitFor(a, `document.querySelector('#update-control')?.dataset.look === 'available'`, 20000);
  await shot(a, 'available', 'Shortly after launch it checked GitHub by itself: a newer release, so the control stands out as "Update available" (its tooltip and name: "Update to 0.5.0 preview 5").');
  await everySize('available', 'Update available.');
  await a.click('#nav-settings');
  await shot(a, 'settings-available', 'Settings › General › Updates: the build in use and its tag, Update and Check now, and what the last check found, with the release notes.');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `settings-available-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
  // An instructions draft typed and not saved holds the restart.
  const typeDraft = async () => { await a.click('#nav-instructions'); const tool = await a.run(`document.querySelector('[id^="ins-edit-"]')?.id.slice('ins-edit-'.length) ?? ''`); await a.click(`#ins-edit-${tool}`); await a.run(`(() => { const area = document.querySelector('#ins-text-${tool}'); area.value += '\\n- Not saved yet.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await a.settle(); };
  await typeDraft();
  await a.click('#update-control');
  await waitFor(a, `/Downloading… [1-9]/.test(document.querySelector('#update-control')?.textContent ?? '')`, 10000);
  await shot(a, 'downloading', 'Typed in an instruction file without saving, then clicked "Update available": the control shows the download, its progress a ring round the arrow.');
  await size(860, 560); await shot(a, 'downloading-860-rail', 'The same at 860×560, in the rail: the ring alone.');
  await a.click('#sidebar-toggle'); await shot(a, 'downloading-860-open', 'The same with the sidebar open.'); await a.click('#sidebar-toggle'); await size(1280, 800);
  await waitFor(a, `document.querySelector('#update-control')?.dataset.look === 'held'`, 30000);
  await shot(a, 'held', 'Downloaded and prepared. An unsaved instructions draft is waiting, so it doesn’t restart by itself: the control is an outlined "Restart to update…" with the warning mark (a click opens Settings, which says what would be lost), and the status bar says why.');
  await everySize('held', 'Restart to update, held for the unsaved draft.');
  await a.click('#nav-settings'); await shot(a, 'settings-held', 'Settings while the update waits for the restart.');
  // The next launch, as the new version: it says so once.
  const settings = join(scratch, 'data', 'app-settings.json');
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), update: { tag: 'v0.5.0-preview.5', page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.5', from: 'v0.5.0-preview.4' } }));
  await fresh(as('v0.5.0-preview.5'), true);
  await waitFor(a, `/now on/.test(document.getElementById('announcement').textContent)`, 10000);
  await shot(a, 'updated', 'Opened again as 0.5.0 preview 5: the status bar says once that it is on the new version, with "Release notes".');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `updated-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
  await a.click('#nav-settings'); await a.click('#check-updates'); await waitFor(a, `/Up to date/.test(document.getElementById('setting-updates').textContent)`, 10000);
  await shot(a, 'settings-up-to-date', 'Clicked "Check now": up to date.');
  await a.click('#nav-skills'); await a.click('#update-control'); await waitFor(a, `/newest release/.test(document.getElementById('announcement').textContent)`, 10000);
  await shot(a, 'sidebar-up-to-date', 'On Skills, clicked "Check for updates" in the sidebar: the status bar says what it found; the control is the quiet arrows again.');
  await a.click('#nav-settings');
  // A failed check, and a failed download.
  releases.splice(0, 1, { tag: 'v0.5.0-preview.6', zip, cut: 0.3 });
  await a.click('#check-updates'); await waitFor(a, `!!document.querySelector('#setting-update')`, 10000);
  await a.click('#setting-update'); await waitFor(a, `/didn’t finish/.test(document.getElementById('setting-updates').textContent)`, 20000);
  await shot(a, 'settings-download-failed', 'A newer release, and its download was cut off: the row says nothing changed and offers it again, and so does the sidebar ("Try the update again").');
  await size(860, 560); await shot(a, 'settings-download-failed-860', 'The same at 860×560.'); await size(1280, 800);
  await fixture.close();
  await a.click('#check-updates'); await waitFor(a, `/Couldn’t check/.test(document.getElementById('setting-updates').textContent)`, 40000);
  await shot(a, 'settings-check-failed', 'Clicked "Check now" with GitHub unreachable: the row says so; Central Knot tries again later.');
  // A build that can't update itself (here: not made from a release) says why and offers the release page.
  await fresh({}, false);
  await a.click('#nav-settings');
  await shot(a, 'settings-cannot', 'A build not made from a release (a development or local build): the row says why it doesn’t update itself and offers the releases page; on a Mac the sidebar’s control is a faint "Updates" that opens this row.');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `settings-cannot-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
  // The narrowest window with the status bar at its fullest: a profile in use, and sync on with nothing managed yet. In a
  // folder home, which keeps its profile across the restart (the practice copy is made anew at each launch).
  const again = await serveReleases([{ tag: 'v0.5.0-preview.5', zip, bytesPerSecond: 400_000 }]);
  const narrowAs = tag => ({ CK_UPDATE_STUB: tag, CK_UPDATE_RELEASES: again.releasesUrl });
  const narrowSettings = join(scratch, 'data', 'app-settings.json');
  const reopen = async (tag, change) => {
    a.quit(); await wait(500);
    writeFileSync(narrowSettings, JSON.stringify({ ...JSON.parse(readFileSync(narrowSettings, 'utf8')), ...change }));
    a = await launch(narrowAs(tag));
    await size(860, 560);
  };
  await fresh({ CK_UPDATE_RELEASES: again.releasesUrl });
  const folder = join(scratch, 'update-home');
  cpSync(join(root, 'fixtures/home'), folder, { recursive: true });
  await reopen('v0.5.0-preview.4', { home: { mode: 'custom', path: folder } });
  // Nothing is in Central Knot in this fresh home, so the new, empty profile is the one in use: the status bar names it.
  await a.click('#nav-profiles'); await a.click('#profile-new');
  await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = 'Incident'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await a.settle();
  await a.run(`document.activeElement?.blur()`);
  await waitFor(a, `document.querySelector('#update-control')?.dataset.look === 'available'`, 20000);
  await shot(a, 'narrow-update', 'At 860×560 in a folder home with a profile in use ("Incident") and sync on with nothing managed yet, a newer release is found: the rail’s last icon stands out; the status bar keeps the version.');
  await typeDraft();
  await a.click('#update-control');
  await waitFor(a, `/Downloading… [1-9]/.test(document.querySelector('#update-control')?.textContent ?? '')`, 10000);
  await shot(a, 'narrow-downloading', 'Typed in an instruction file without saving, then clicked it: the ring shows the download.');
  await waitFor(a, `document.querySelector('#update-control')?.dataset.look === 'held'`, 30000);
  await shot(a, 'narrow-held', 'Downloaded and prepared; an unsaved instructions draft is waiting, so the control is the outlined "Restart to update…", with the warning mark. The message is only its mark at this width (its words are the mark’s tooltip, and the control’s).');
  await reopen('v0.5.0-preview.5', { update: { tag: 'v0.5.0-preview.5', page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.5', from: 'v0.5.0-preview.4' } });
  await waitFor(a, `/now on/.test(document.getElementById('announcement').textContent)`, 10000);
  await shot(a, 'narrow-updated', 'Opened again as 0.5.0 preview 5 at 860×560, the profile still in use: the version alone at the end, and the note that it is on the new version as its mark.');
  await a.click('#nav-settings');
  await shot(a, 'narrow-settings-updated', 'Settings at 860×560 on that launch: the Updates row says it was updated, with the release notes.');
  await size(1280, 800);
  await shot(a, 'settings-updated', 'The same at 1280×800.');
  await again.close();
}

// ---------- Settings ----------
if (wanted('settings')) {
  await fresh();
  begin('settings');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  await a.click('#nav-settings');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await size(width, height);
    await a.theme('dark'); await shot(a, `settings-${width}-dark`, `Settings at ${width}×${height}, dark. Start at sign-in is off and disabled in this dev build, its reason in the hint’s place.`);
    await a.theme('light'); await shot(a, `settings-${width}-light`, `Settings at ${width}×${height}, light.`);
  }
  await size(860, 560); await a.theme('dark');
  // Keyboard: the chosen card is the group's one Tab stop; the right arrow moves to Light and chooses it, with the focus ring.
  await a.run(`document.querySelector('#appearance-system').focus()`);
  for (const type of ['keyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await a.settle(); await shot(a, 'settings-keyboard', 'Focused the System card (the group\'s Tab stop) and pressed the right arrow: Light is chosen, and the focus ring moved with it.');
  for (const type of ['keyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await a.settle();
  // A save that fails: the settings file is made read-only, then Light is clicked.
  const file = join(scratch, 'data/app-settings.json');
  chmodSync(file, 0o444);
  await a.click('#appearance-light'); await shot(a, 'settings-save-failed-dark', 'Pressed the right arrow again (Dark), then made the settings file read-only and clicked Light: the row says in plain words what happened and what to do, and Dark stays chosen.');
  await a.theme('light'); await shot(a, 'settings-save-failed-light', 'The same, light (the system appearance is light; the app is still set to Dark).');
  chmodSync(file, 0o644);
  // The tour's clicks don't move focus as a real click would: let the keyboard focus go so no card keeps its ring.
  await a.run(`document.activeElement?.blur()`);
  await a.click('#appearance-system');
  await a.theme('dark'); await a.click('#show-log');
  await shot(a, 'settings-show-log', 'Clicked "Show log file". On Linux the app opens the log\'s folder (here a stand-in file manager) and the row says which file to look for. macOS and Windows select the file instead and add no line.');
  await a.theme('light'); await shot(a, 'settings-show-log-light', 'The same, light.'); await a.theme('dark');
  // Keep history for. History is given changes 3, 12 and 25 days old; shortening to 7 days asks first, then History keeps only the newest.
  // Nothing is managed yet, so this home has no sync record: a shorter window is saved, and its History is cut the next time it records a change.
  await keepFor(a, 7); await a.click('#history-shorten'); await wait(300); await a.settle();
  await shot(a, 'settings-history-saved-for-later', 'Shortened to 7 days in a home that doesn’t sync yet (nothing managed): the window is saved, and the row says (with the neutral info glyph) that older History goes the next time this home records a change, not that it was removed. The Show log file note from the step before is gone: one finished note at a time.');
  await keepFor(a, 30);
  // From here the home syncs (everything managed, as in the sync tour), so shortening removes older History at once.
  await a.click('#nav-skills');
  await turnOnRow('standup');
  await a.click('#nav-settings');
  mkdirSync(join(practice, '.central-knot'), { recursive: true });
  writeFileSync(join(practice, '.central-knot/history.json'), JSON.stringify({ events: [
    { id: 'tour-25', at: new Date(Date.now() - 25 * DAY).toISOString(), key: 'standup', item: 'standup', kind: 'deleted', winner: { tool: 'copilot-cli', hash: 'a'.repeat(64) }, losers: [], orderProved: true, previous: 'a'.repeat(64) },
    { id: 'tour-12', at: new Date(Date.now() - 12 * DAY).toISOString(), key: 'review', item: 'review', kind: 'chosen', winner: { tool: 'copilot-cli', hash: 'b'.repeat(64) }, losers: [{ tool: 'claude-cli', hash: 'c'.repeat(64) }], orderProved: true },
    { id: 'tour-3', at: new Date(Date.now() - 3 * DAY).toISOString(), key: 'release-notes', item: 'release-notes', kind: 'edit', winner: { tool: 'claude-cli', hash: 'd'.repeat(64) }, losers: [{ tool: 'copilot-cli', hash: 'e'.repeat(64) }], orderProved: true, previous: 'e'.repeat(64) },
  ] }));
  await a.click('#nav-history'); await shot(a, 'history-before-shorten', 'History before the window changes: kept for 30 days (the default), it lists changes from 3, 12 and 25 days ago.');
  await a.click('#nav-settings');
  await a.run(`document.querySelector('#history-days').focus()`);
  await shot(a, 'settings-history-select', 'The Keep history for select, focused (7, 30 or 90 days; 30 by default). Its menu is the system’s own, which a screenshot can’t catch.');
  await keepFor(a, 7);
  await shot(a, 'settings-history-confirm-dark', 'Chose 7 days: a shorter window removes History, so the row asks first, naming the local date and time it will cut from. The select still shows the saved 30 days.');
  await a.theme('light'); await shot(a, 'settings-history-confirm-light', 'The same, light.'); await a.theme('dark');
  // Keyboard focus on each of the question's buttons, both themes: the danger button's ring sits outside its red fill.
  for (const [id, name] of [['history-shorten', 'shorten'], ['history-shorten-cancel', 'keep']]) {
    await a.run(`document.querySelector('#${id}').focus()`);
    await shot(a, `settings-history-focus-${name}-dark`, `Keyboard focus on "${name === 'shorten' ? 'Shorten to 7 days' : 'Keep 30 days'}", dark.`);
    await a.theme('light'); await shot(a, `settings-history-focus-${name}-light`, 'The same, light, on the pale danger notice.'); await a.theme('dark');
  }
  await a.run(`document.activeElement?.blur()`);
  await size(1728, 1117); await shot(a, 'settings-history-confirm-1728', 'The same at 1728×1117: the question is as wide as its words and buttons, not a band across the row.');
  await size(2560, 1440); await shot(a, 'settings-history-confirm-2560', 'The same at 2560×1440: still only as wide as its content.'); await size(860, 560);
  await a.click('#history-shorten-cancel'); await shot(a, 'settings-history-cancelled', 'Clicked "Keep 30 days" (Cancel): the question goes, nothing is saved (still 30 days), and the focus is back on the select.');
  await keepFor(a, 7);
  // Main carries out the change in its turn, after any sync pass: held here so the row's waiting state can be seen.
  const main = a.main && await a.main();
  const held = main && await holdQueue(main, a);
  await a.click('#history-shorten');
  if (held) {
    await shot(a, 'settings-history-updating', 'Clicked "Shorten to 7 days" while main is busy (held, as a long sync pass would): the row says History is updating, and its select takes no other change until main is done.');
    await held.release(); main.close();
  }
  await wait(300); await a.settle();
  await shot(a, 'settings-history-shortened', 'Shortened to 7 days: saved, the select shows it, and the row says (with a check) from when History was removed.');
  await a.theme('light'); await shot(a, 'settings-history-shortened-light', 'The same, light.'); await a.theme('dark');
  await a.click('#nav-history'); await shot(a, 'history-after-shorten', 'History after shortening to 7 days: only the change from 3 days ago is left, and the intro says how long History keeps changes.');
  await a.click('#nav-settings'); await keepFor(a, 30);
  // A shorten whose removal fails (the home's History folder made read-only): the window is saved anyway, and the row says what didn't happen.
  const store = join(practice, '.central-knot');
  chmodSync(store, 0o555);
  await keepFor(a, 7); await a.click('#history-shorten'); await wait(300); await a.settle();
  await shot(a, 'settings-history-prune-failed', 'Shortened to 7 days with the home’s History folder read-only: the window is saved (the select shows 7). The row says in red that the older History couldn’t be removed; what happens next and where to look follow in the hint colour.');
  await a.theme('light'); await shot(a, 'settings-history-prune-failed-light', 'The same, light.'); await a.theme('dark');
  chmodSync(store, 0o755);
  await keepFor(a, 30); await a.run(`document.activeElement?.blur()`);
  // A wide row's hover: pointing at the hint lights the whole row, out to its button.
  await size(1728, 1117);
  const hint = await a.run(`(() => { const box = document.querySelector('#setting-log-hint').getBoundingClientRect(); return { x: Math.round(box.left + 20), y: Math.round(box.top + box.height / 2) }; })()`);
  await shot(a, 'settings-row-hover-1728', 'At 1728×1117, the pointer on the Log file hint: the whole row lights up, tying the text to its button far to the right.', hint);
  await size(860, 560);
  // The narrowest row: no real window reaches it (the window is at least 860 wide and has no zoom), so this emulates a
  // 573-px-wide page (860 at 150% zoom) with the sidebar open, to show the control moving under its text.
  await a.send('Emulation.setDeviceMetricsOverride', { width: 573, height: 373, deviceScaleFactor: 3, mobile: false }); await a.settle();
  const railed = await a.has('.rail');
  if (railed) await a.click('#sidebar-toggle');
  await shot(a, 'settings-narrow-stacked', 'Emulated: a 573×373 page (860×560 at 150% zoom, which the app does not offer) with the sidebar open, so each row is under 512px: the controls sit under their text, left-aligned.');
  await keepFor(a, 7); await a.run(`document.querySelector('#setting-history').scrollIntoView({ block: 'start' })`);
  await shot(a, 'settings-narrow-question', 'The same stacked layout with the shorten question open: its buttons wrap under the words and start at the left, like the select above them.');
  await a.click('#history-shorten-cancel'); await a.run(`document.activeElement?.blur()`);
  if (railed) await a.click('#sidebar-toggle');
  await size(860, 560);
  // Start at sign-in as an installed app on macOS or Windows would show it. This Linux dev run can't register a login item,
  // so main stands in as an installed app with the system's login-item answer (see standIn), and the window is refocused so the
  // page reads it again, as it does when someone comes back from System Settings.
  if (a.main && process.platform === 'linux') {
    // Opened afresh, so the earlier rows' notes are gone.
    await a.click('#nav-skills'); await a.click('#nav-settings');
    const main = await a.main();
    await standIn(main, 'win32');
    const system = async (platform, login) => { await main.run(`(ck.as(${JSON.stringify(platform)}), ck.login = ${JSON.stringify(login)})`); await refocus(main); await a.settle(); };
    const both = async (name, caption) => { await shot(a, `${name}-dark`, caption); await a.theme('light'); await shot(a, `${name}-light`, 'The same, light.'); await a.theme('dark'); };
    const press = async (key, code, keyCode, modifiers = 0) => { for (const type of ['rawKeyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, modifiers }); await a.settle(); };
    await system('win32', { on: true, enabled: true });
    await shot(a, 'settings-sign-in-on', 'Stand-in system: an installed app on Windows, starting at sign-in. The switch is on and the hint says what it does.');
    // Keyboard focus: from the Appearance cards, Shift+Tab goes back to the switch.
    await a.run(`document.querySelector('#appearance-system').focus()`);
    await press('Tab', 'Tab', 9, 8);
    await both('settings-sign-in-focused', `Focused the Appearance cards and pressed Shift+Tab: the switch has the focus ring, outside its track (${await a.run(`document.activeElement.id + (document.activeElement.matches(':focus-visible') ? ', focus-visible' : '')`)}).`);
    await a.run(`document.activeElement?.blur()`);
    await system('win32', { on: true, enabled: false });
    await both('settings-sign-in-turned-off', 'Stand-in system: Windows, turned off in Startup apps (perhaps on purpose). Off; the hint still says what it does, and beneath it a calm grey line says where it was turned off, with Open Startup apps right after the text.');
    // Keyboard focus on the line's action: Tab from the switch goes to it.
    await a.run(`document.querySelector('#start-at-sign-in').focus()`);
    await press('Tab', 'Tab', 9);
    await a.theme('light');
    await shot(a, 'settings-sign-in-action-focused-light', `Light. Focused the switch and pressed Tab: Open Startup apps has the focus ring (${await a.run(`document.activeElement.id + (document.activeElement.matches(':focus-visible') ? ', focus-visible' : '')`)}).`);
    await a.theme('dark');
    await a.run(`document.activeElement?.blur()`);
    await system('win32', { on: false, enabled: true, ignore: true });
    await a.click('#start-at-sign-in');
    await both('settings-sign-in-unchanged', 'Stand-in system: Windows, which ignores the change. Clicked the switch: it stays Off, and the row says in amber that the system didn’t change it, with Open Startup apps.');
    // macOS: the hint names the menu bar once the page knows it runs on a Mac, so it is reloaded as one (main names the Login Items).
    const agent = await a.run('navigator.userAgent');
    const reloadAs = async userAgent => { await a.send('Emulation.setUserAgentOverride', { userAgent }); await a.send('Page.reload'); await wait(1500); await a.settle(); await a.click('#nav-settings'); };
    await system('darwin', { on: true, status: 'requires-approval' });
    await reloadAs(agent.replace(/\(X11;[^)]*\)/, '(Macintosh; Intel Mac OS X 10_15_7)'));
    await both('settings-sign-in-approval', 'Stand-in system: an installed app on macOS whose login item is off in Login Items (waiting for approval, or turned off there on purpose: macOS reports both alike). The switch shows Off, the system’s answer; the hint stays, and beneath it a calm grey line, true either way, with Open Login Items. (With main standing in as an installed app, the sidebar leaves out the Practice copy, as a released app does.)');
    // Back to this Linux dev run: the row is off and disabled again, with its reason.
    await main.run(`ck.restore()`);
    await reloadAs(agent);
    main.close();
  }
  await a.click('#nav-skills'); await shot(a, 'skills-860-unchanged', 'Another page at 860×560 for comparison: Skills, unchanged by the Settings work.');
  await size(1280, 800);
}

// ---------- Base instructions ----------
if (wanted('base')) {
  begin('base');
  await a.click('#nav-instructions');
  await waitFor(a, `!!document.querySelector('#base-card')`);
  await a.run(`(() => { document.activeElement?.blur(); document.querySelector('#instructions-scroll').scrollTop = 0; })()`);
  await shot(a, 'base-start', 'Clicked "Instructions". The Base instructions card is at the top; nothing is set up yet.');
  await a.click('#base-from-claude-cli'); await shot(a, 'base-from-claude', 'Clicked "CLAUDE.md" beside "or start from".');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value += '- Write tests for every bug fix.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#base-review'); await shot(a, 'base-review', 'Added a line to the draft and clicked "Review changes".');
  await a.click('#base-plan-codex-cli'); await shot(a, 'base-review-file', 'Clicked "Show changes" on the Codex row.');
  await a.click('#base-save'); await wait(400); await shot(a, 'base-saved', 'Clicked "Save and update 3 files".');
  await a.click('#ins-base-codex-cli'); await a.run(`document.querySelector('#ins-base-codex-cli').scrollIntoView({ block: 'center' })`); await shot(a, 'base-strip', 'Scrolled to the Codex card and clicked "Show" on its base instructions strip.');
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value = area.value.replace('Ask before adding a new dependency.', 'Ask before adding any new dependency or service.'); area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#base-review'); await shot(a, 'base-edit-review', 'Clicked "Edit" on the Base instructions card, changed one line, and clicked "Review changes".');
  await a.click('#base-save'); await wait(400); await shot(a, 'base-edit-saved', 'Clicked "Save and update 3 files".');
  edit(join(practice, '.codex/AGENTS.md'), text => text.replace('Run the tests', 'Run the full test suite').replace('- Write tests for every bug fix.', '- Write a test for every bug fix, first.'));
  await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#base-restore-codex-cli')`);
  await shot(a, 'base-edited-there', 'Outside the app, edited both Codex’s own text and its copy of the base in AGENTS.md, then clicked Refresh.');
  await a.click('#base-diff-codex-cli'); await shot(a, 'base-edited-diff', 'Clicked "See the difference".');
  await a.click('#base-usecopy-codex-cli'); await shot(a, 'base-usecopy-review', 'Clicked "Use AGENTS.md’s copy as the base…".');
  await a.click('#base-back');
  await a.click('#base-restore-codex-cli'); await shot(a, 'base-put-back-review', 'Cancelled, then clicked "Put the base back in AGENTS.md…" instead.');
  await a.click('#base-save'); await shot(a, 'base-put-back', 'Clicked "Put the base back in AGENTS.md".');
  await a.click('#outcome-undo-base'); await wait(400); await shot(a, 'base-undo', 'Clicked "Undo" on the result.');
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit'); await a.click('#base-tool-copilot-cli'); await a.click('#base-review');
  await shot(a, 'base-untick-review', 'Clicked "Edit text or tools", unticked Copilot CLI, and clicked "Review changes".');
  await a.click('#base-back'); await a.click('#base-cancel'); if (await a.has('#base-discard')) await a.click('#base-discard');
  // Stop sharing with every tool: Codex's hand-edited copy stays, and its card offers taking the block out.
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit'); await a.click('#base-stop');
  await shot(a, 'base-stop-review', 'Clicked "Edit text or tools", then "Stop sharing with every tool…".');
  await a.click('#base-save'); await shot(a, 'base-stopped', 'Clicked the save button.');
  await a.run(`document.querySelector('#ins-base-out-codex-cli')?.scrollIntoView({ block: 'center' })`);
  await shot(a, 'base-stray-block', 'Scrolled to Codex: its edited block stays, with "Take the block out…".');
  await a.click('#ins-base-out-codex-cli'); await shot(a, 'base-take-out-review', 'Clicked "Take the block out…".');
  await a.click('#ins-back-codex-cli');
  // Share it with every tool again for the steps below.
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit');
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli']) await a.click(`#base-tool-${tool}`);
  await a.click('#base-review'); await a.click('#base-save');
  await a.click('#ins-edit-claude-cli'); await shot(a, 'base-own-edit', 'Clicked "Edit" on Claude Code’s card: the editor holds only Claude Code’s own instructions.');
  await a.click('#ins-cancel-claude-cli');
  await a.theme('light'); await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`); await shot(a, 'base-light', 'The same page in the light appearance.'); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 2000 ? 1 : 2, mobile: false }); await a.settle();
    await shot(a, `base-${width}`, `The window at ${width}×${height}.`);
  }
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.run(`document.querySelector('#base-restore-codex-cli')?.scrollIntoView({ block: 'center' })`);
  await shot(a, 'base-860-conflict', 'At 860×560: the edited copy in AGENTS.md with its difference and both choices.');
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value += '- One more shared line.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#base-review'); await a.click('#base-review-discard');
  await a.run(`document.querySelector('#base-review-discard-yes').scrollIntoView({ block: 'center' })`);
  await shot(a, 'base-860-review-discard', 'At 860×560: Edit text or tools, added a line, Review changes, then Discard changes (the question is open).');
  await a.click('#base-review-discard-yes');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
}

// ---------- Scrolled pages: sticky headers and toolbars (last: it adds a lot to the practice copy) ----------
if (wanted('scroll')) {
  begin('scroll');
  // Stand-in CLIs (they answer --version and refuse anything else), so the plugin boxes are live and the column header
  // shows its "Click a box…" hint, as on a computer with the tools installed. Nothing is clicked, so nothing runs.
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  for (const [name, version] of [['claude', '2.1.309 (Claude Code)'], ['copilot', 'GitHub Copilot CLI 1.0.107.'], ['codex', 'codex-cli 0.142.3']]) {
    writeFileSync(join(HOME, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`);
    chmodSync(join(HOME, '.local/bin', name), 0o755);
  }
  // A marketplace long enough to scroll (35 plugins), and a second one so the header shows "Refresh all".
  const long = join(scratch, 'long-market');
  writeMarket(long, 'long-list');
  edit(join(long, '.claude-plugin/marketplace.json'), text => JSON.stringify({ ...JSON.parse(text), plugins: Array.from({ length: 35 }, (_, index) => ({
    name: `team-plugin-${String(index + 1).padStart(2, '0')}`, source: './plugins/issue-tracker', category: index % 3 ? 'development' : 'productivity',
    description: index % 2 ? 'MCP server for the team tracker, with skills for triage' : 'A longer description that goes on for a while to show how a row with plenty of text wraps or ends with an ellipsis at narrow sizes',
  })) }, null, 2));
  const second = join(scratch, 'second-market');
  writeMarket(second, 'second-list');
  await a.click('#nav-plugins');
  for (const source of [long, second]) await addMarketplace(a, source);
  await a.run(`[...document.querySelectorAll('.market-item')].find(item => /long-list/.test(item.textContent))?.click()`); await a.settle();
  // Enough skills, MCP servers and agents in the practice copy that every table scrolls at every size.
  for (let index = 1; index <= 40; index++) {
    const name = `extra-${String(index).padStart(2, '0')}`;
    for (const tool of index % 2 ? ['.claude'] : ['.claude', '.copilot']) {
      mkdirSync(join(practice, tool, 'skills', name), { recursive: true });
      writeFileSync(join(practice, tool, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: An extra skill so the table scrolls.\n---\n\nFollow the steps.\n`);
    }
    writeFileSync(join(practice, '.claude/agents', `${name}.md`), `---\nname: ${name}\ndescription: An extra agent so the table scrolls.\n---\n\nDo the task.\n`);
  }
  edit(join(practice, '.copilot/mcp-config.json'), text => {
    const config = JSON.parse(text);
    for (let index = 1; index <= 40; index++) config.mcpServers[`extra-${String(index).padStart(2, '0')}`] = { type: 'local', command: 'npx', args: ['-y', `@example/extra-${index}`], tools: ['*'] };
    return JSON.stringify(config, null, 2);
  });
  await a.click('#header-refresh');
  const sizes = [[860, 560, 2], [1280, 800, 2], [1728, 1117, 1], [2560, 1440, 1]];
  // Scrolls the page's main scroller (the tallest one that can scroll) by `by` pixels, so sticky parts are tested over rows.
  // Returns what scrolled and how far its pinned column header sits below the scroller's top (0 when the stack is right).
  const scroll = by => a.run(`(() => {
    const box = [...document.querySelectorAll('#page .scroll')].filter(e => e.scrollHeight > e.clientHeight).sort((x, y) => y.clientHeight - x.clientHeight)[0];
    if (!box) return 'nothing scrolls';
    box.scrollTop = ${by};
    const head = box.querySelector('.ov-head');
    if (!head) return box.id || box.className;
    return (box.id || box.className) + '; column header ' + Math.round(head.getBoundingClientRect().top - box.getBoundingClientRect().top) + 'px below the scroller top';
  })()`);
  for (const page of ['plugins', 'overview', 'skills', 'mcp', 'agents', 'settings']) {
    if (!(await a.has(`#nav-${page}`))) continue;
    await a.click(`#nav-${page}`);
    for (const [width, height, scale] of sizes) {
      await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
      for (const theme of ['dark', 'light']) {
        await a.theme(theme);
        const what = await scroll(Math.round(height * 0.4)); await wait(100);
        await shot(a, `${page}-${width}-${theme}`, `${page} at ${width}×${height}, ${theme}, main list scrolled down ${Math.round(height * 0.4)}px (${what}).`);
      }
      await scroll(0);
    }
  }
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await a.theme('dark');
}

// ---------- Harnesses ----------
if (wanted('harnesses')) {
  await fresh();
  begin('harnesses');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.run(`window.dispatchEvent(new Event('resize'))`); await a.settle(); };
  const sizes = async (name, caption) => {
    for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) for (const theme of ['dark', 'light']) { await size(width, height); await a.theme(theme); await shot(a, `${name}-${width}-${theme}`, `${caption} Window ${width}×${height}, ${theme} appearance.`); }
    await a.theme('dark'); await size(1280, 800);
  };
  await a.click('#nav-harnesses'); await waitFor(a, `!/…/.test(document.querySelector('.harness-cards')?.textContent ?? '…')`);
  await shot(a, 'list-dark', 'Clicked "Harnesses" in the sidebar: one card per tool with what it has. Window 1280×800.');
  await a.theme('light'); await shot(a, 'list-light', 'The same, light appearance.'); await a.theme('dark');
  await sizes('list', 'The Harnesses list.');
  if (await a.has('[id^="harness-claude-cli-differ-"]')) { await a.click('[id^="harness-claude-cli-differ-"]'); await shot(a, 'claude-differ-link', 'Clicked "1 skill with different copies" on the Claude Code card: its page, showing only those.'); await a.run(`[...document.querySelectorAll('.chip')].find(chip => chip.textContent.trim() === 'All')?.click()`); await a.settle(); await a.click('#harness-back'); }
  await a.click('#harness-claude-cli'); await shot(a, 'claude-skills', 'Clicked the Claude Code card: its page, on the Skills tab. Its column comes first; skills only other tools have are under "Not in Claude Code".');
  await sizes('claude-skills', 'Claude Code’s Skills tab.');
  if (await a.has('#add-standup, #switch-standup:not([aria-checked="true"])')) { await turnOnRow('standup'); await shot(a, 'claude-switched', 'Turned standup on from Claude Code’s page: it is copied to every tool at once.'); }
  await a.click('#open-release-notes'); await shot(a, 'claude-details', 'Opened release-notes’ details from its row.');
  await a.click('#harness-tab-mcp'); await shot(a, 'claude-mcp', 'Clicked the "MCP servers" tab.');
  await a.click('#harness-tab-agents'); await shot(a, 'claude-agents', 'Clicked the "Agents" tab.');
  await a.click('#harness-tab-instructions'); await waitFor(a, `!!document.querySelector('#ins-edit-claude-cli')`); await shot(a, 'claude-instructions', 'Clicked the "Instructions" tab: Claude Code’s own file, editable here.');
  await sizes('claude-instructions', 'The Instructions tab.');
  await a.click('#ins-edit-claude-cli'); await shot(a, 'claude-instructions-editing', 'Clicked Edit.');
  await size(860, 560); await shot(a, 'claude-instructions-editing-860', 'Editing at 860×560.');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value += '- A line added in the tour, long enough to show how the review wraps a changed line at the smallest window size.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  if (await a.has('#ins-review-claude-cli')) { await a.click('#ins-review-claude-cli'); await shot(a, 'claude-instructions-review-860', 'Added a line and clicked "Review changes" at 860×560: the diff before saving.'); }
  await size(1280, 800);
  // Throw the tour's line away and edit afresh for the next shot.
  for (const id of ['#ins-back-claude-cli', '#ins-cancel-claude-cli', '#ins-discard-claude-cli']) if (await a.has(id)) await a.click(id);
  await a.click('#ins-edit-claude-cli');
  await size(2560, 1440); await shot(a, 'claude-instructions-editing-2560', 'Editing at 2560×1440: the editor keeps a reading measure.'); await size(1280, 800); if (await a.has('#ins-cancel-claude-cli')) await a.click('#ins-cancel-claude-cli');
  // With the Plugins tour in this run, install document-tools from team-tools so this tab has something to show.
  if (wanted('plugins')) {
    await ensureMarket(); await waitFor(a, `!!document.querySelector('#popen-0-document-tools')`); await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-group')`);
    if (await a.has('#pinstall-0-document-tools:not([disabled])')) { await a.click('#pinstall-0-document-tools'); await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); }
    await a.click('#nav-harnesses'); await a.click('#harness-claude-cli');
  }
  await a.click('#harness-tab-plugins'); await waitFor(a, `!/Reading/.test(document.querySelector('#harness-body')?.textContent ?? '')`); await shot(a, 'claude-plugins', 'Clicked the "Plugins" tab: plugins installed in Claude Code, each opening its page on Plugins.');
  await a.click('#harness-tab-about'); await shot(a, 'claude-about', 'Clicked the "About" tab: how it was found and where its files are.');
  await sizes('claude-about', 'The About tab.');
  await a.click('#harness-switch-copilot-cli'); await a.click('#harness-tab-skills'); await shot(a, 'copilot-skills', 'Clicked Copilot CLI in the switcher at the top right, then the Skills tab.');
  await a.theme('light'); await shot(a, 'copilot-skills-light', 'The same, light appearance.'); await a.theme('dark');
  // A mouse click (detail 1), as a person makes it; a scripted click() reads as the keyboard.
  await a.run(`document.querySelector('#harness-back').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))`); await a.settle(); await shot(a, 'back', 'Clicked "Harnesses" in the header’s breadcrumb with the mouse.');
  // A fourth harness: Pi, with one skill of its own, so the table has four tool columns.
  const piSkill = join(practice, '.pi/agent/skills/pi-notes');
  mkdirSync(piSkill, { recursive: true });
  writeFileSync(join(piSkill, 'SKILL.md'), '---\nname: pi-notes\ndescription: Notes kept in Pi only.\n---\n\nWrite short notes.\n');
  // And a skill with a long name and a long description, to see how rows fit.
  const longSkill = join(practice, '.claude/skills/summarise-incident-timeline-from-pager-and-chat-logs');
  mkdirSync(longSkill, { recursive: true });
  writeFileSync(join(longSkill, 'SKILL.md'), '---\nname: summarise-incident-timeline-from-pager-and-chat-logs\ndescription: Builds a minute-by-minute incident timeline from pager alerts, chat threads and deploy logs, then drafts the summary section of the postmortem with owners and open questions.\n---\n\nRead the logs.\n');
  await a.click('#header-refresh'); await a.settle();
  await shot(a, 'four-list', 'Added a Pi skills folder with one skill to the practice copy, then clicked Refresh: four harnesses.');
  await a.click('#harness-pi-cli'); await a.click('#harness-tab-skills');
  for (const [width, height] of [[860, 560], [1150, 800], [1280, 800], [1728, 1117]]) { await size(width, height); await shot(a, `pi-skills-${width}`, `Pi's page, Skills tab, with four tool columns. Window ${width}×${height}.`); }
  await size(860, 560);
  const last = await a.run(`[...document.querySelectorAll('.ov-head .tool-head-button')].at(-1)?.id`);
  if (last) { await a.click(`#${last}`); await shot(a, 'last-menu-860', 'Clicked the right-most column header at 860×560: its menu stays inside the window.'); await a.click(`#${last}`); }
  await a.click('#harness-tab-agents'); await shot(a, 'pi-agents-860', 'Pi’s Agents tab: Pi doesn’t use agents.');
  await a.click('#harness-tab-skills'); if (!(await a.has('.ov-row.open[data-key="release-notes"]'))) await a.click('#open-release-notes'); await shot(a, 'pi-details-860', 'Opened release-notes on Pi’s page at 860×560: each tool’s own switch in its details.');
  await size(1280, 800);
  // This computer's home (in the tour, an empty throwaway folder on Linux): detection, a Not found card, and its header.
  await a.click('#home-actual'); await a.click('#nav-harnesses'); await shot(a, 'this-computer-list', 'Clicked "This computer’s home" at the bottom left, then Harnesses: each tool with how it was found; tools not found have a card that does not open.');
}

// ---------- Git repo ----------
if (wanted('repo')) {
  await fresh();
  begin('repo');
  const sizes = async (name, caption) => {
    for (const [width, height] of [[860, 560], [1100, 720], [1728, 1117], [2560, 1440]]) {
      await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 2000 ? 1 : 2, mobile: false });
      await a.settle(); await shot(a, `${name}-${width}`, `${caption} At ${width}×${height}.`);
    }
    await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  };
  const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', ...args], { stdio: 'ignore' });
  // A repo someone already keeps: a README, one skill, one MCP server and one agent of theirs.
  const remote = join(scratch, 'remote', 'agent-config.git');
  const author = join(scratch, 'author');
  mkdirSync(remote, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  execFileSync('git', ['clone', '--quiet', remote, author], { stdio: 'ignore' });
  const put = (path, text) => { mkdirSync(join(author, path, '..'), { recursive: true }); writeFileSync(join(author, path), text); };
  put('README.md', '# Agent setup\n\nKept with Central Knot.\n');
  put('skills/incident/SKILL.md', '---\nname: incident\ndescription: "Runs an incident: timeline, roles, comms."\n---\n\nOpen a timeline first.\n');
  put('mcp/pagerduty.json', JSON.stringify({ type: 'http', url: 'https://mcp.pagerduty.example/mcp' }, null, 2) + '\n');
  put('agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews a change before it ships.\n---\n\nRead the diff twice.\n');
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'Incident kit'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');

  await a.click('#nav-skills');
  for (const key of await a.run(`[...document.querySelectorAll('.ov-row[data-key]')].filter(row => row.querySelector(':is(.add-item, .switch:not([aria-checked="true"])):not([disabled])') && !row.querySelector('[id^="decide-"]')).map(row => row.dataset.key)`)) await turnOnRow(key);
  await a.click('#nav-repo');
  await shot(a, 'repo-start-dark', 'Clicked "Git repo" in the sidebar: nothing connected yet. The page says what goes where and that nothing changes until Pull or Push.');
  await a.theme('light'); await shot(a, 'repo-start-light', 'The same, light.'); await a.theme('dark');
  await sizes('repo-start', 'The not-connected page.');
  // A wrong address first: the likeliest first-run failure.
  await a.run(`(() => { const input = document.querySelector('#repo-url'); input.value = ${JSON.stringify(join(scratch, 'remote', 'missing.git'))}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#repo-connect'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 20000); await a.settle();
  await shot(a, 'repo-connect-failed', 'Connected to an address with no repo: the band says why; the address stays in the field to fix.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-connect-failed-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  // The right address with a branch the repo doesn't have: Branch is the field marked and focused.
  await a.run(`(() => { const input = document.querySelector('#repo-url'); input.value = ${JSON.stringify(remote)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.run(`(() => { const input = document.querySelector('#repo-branch'); input.value = ${JSON.stringify('nightly')}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#repo-connect'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 20000); await a.settle();
  await shot(a, 'repo-branch-refused', 'Typed the repo’s address with Branch "nightly", which the repo doesn’t have, and clicked Connect: the band says so, and Branch is marked and focused.');
  await a.run(`(() => { const input = document.querySelector('#repo-branch'); input.value = ${JSON.stringify('')}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await shot(a, 'repo-address-typed', 'Typed the repo’s address (a local repo in this tour; an https or ssh address works the same).');
  const tab = async times => { for (let i = 0; i < times; i++) { await a.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await a.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); } await wait(150); };
  await a.run(`document.querySelector('#repo-url').focus()`); await tab(2);
  await shot(a, 'repo-keyboard-connect', 'With the keyboard: from the address field, Tab twice (past Branch) reaches Connect, with its focus ring.');
  await a.click('#repo-connect');
  await waitFor(a, `!!document.querySelector('#repo-state') && !/Checking/.test(document.querySelector('#repo-state').textContent)`, 20000); await a.settle();
  await shot(a, 'repo-connected-dark', 'Clicked "Connect". The repo’s skill, MCP server and agent wait under "From the repo"; this computer’s Managed items wait under "From this computer". Nothing in the tools changed.');
  await a.theme('light'); await shot(a, 'repo-connected-light', 'The same, light.'); await a.theme('dark');
  await sizes('repo-connected', 'Connected, with changes both ways.');
  await a.theme('light'); await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-connected-860-light', 'Connected, light, at 860×560.');
  await a.theme('dark'); await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#repo-pull');
  await waitFor(a, `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  await shot(a, 'repo-pulled', 'Clicked "Pull 3": the repo’s three items are now in the tools, Managed. Only this computer’s changes remain, ready to push.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-pulled-860', 'The same result at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#repo-push');
  await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-pushed-dark', 'Clicked "Push": committed and pushed. Up to date.');
  await a.theme('light'); await shot(a, 'repo-pushed-light', 'The same, light.'); await a.theme('dark');
  await sizes('repo-up-to-date', 'Up to date.');
  // A commit that changes nothing Central Knot moves (the README): not up to date, since Push needs it pulled first.
  run(author, 'pull', '--quiet', 'origin', 'main');
  put('README.md', '# Agent setup\n\nKept with Central Knot. Pull before you push.\n');
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'README: pull first'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-newer-commit', 'Someone changed only the repo’s README, then clicked "Refresh": a newer commit to pull, which changes nothing in the tools.');
  await a.click('#repo-pull');
  await waitFor(a, `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  // Someone changes the incident skill in the repo, and the notes skill is edited on this computer.
  run(author, 'pull', '--quiet', 'origin', 'main');
  put('skills/incident/SKILL.md', '---\nname: incident\ndescription: "Runs an incident: timeline, roles, comms."\n---\n\nOpen a timeline first.\nPage the on-call lead.\n');
  rmSync(join(author, 'skills', 'release-notes'), { recursive: true, force: true });
  put('skills/incident-response-runbook-for-the-eu-region/SKILL.md', '---\nname: incident-response-runbook-for-the-eu-region\ndescription: The EU on-call runbook.\n---\n\nFollow the EU rota.\n');
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'Page the lead'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');
  edit(join(practice, '.claude/skills/notes/SKILL.md'), text => text.replace(/\n*$/, '\nKeep notes short.\n'));
  await wait(3500);
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-both-ways', 'The incident skill changed in the repo, notes was edited here, then clicked "Refresh". Push waits until the repo’s change is pulled.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-both-ways-860', 'The same at 860×560: the lists stack, and why Push waits sits right under its button.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  // A skill whose SKILL.md no tool can read arrives in the repo, and incident is edited here as well as there.
  run(author, 'pull', '--quiet', 'origin', 'main');
  put('skills/broken/SKILL.md', '---\nname: broken\ndescription: Has: an unquoted colon\n---\n\nNever loads.\n');
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'Add broken'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');
  edit(join(practice, '.claude/skills/incident/SKILL.md'), text => text.replace(/\n*$/, '\nWrite the summary within a day.\n'));
  await wait(3500);
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-held-and-both', 'A skill no tool can read arrived in the repo, and incident was edited on both sides, then "Refresh": the unreadable one says why it can’t come in, and incident says the repo’s version wins with yours kept in History.');
  await a.theme('light'); await shot(a, 'repo-held-and-both-light', 'The same, light.'); await a.theme('dark');
  await sizes('repo-held-and-both', 'Held and both-changed items.');
  // The repo can't be reached (its folder moved away, as a server that is down or a VPN that is off would look).
  renameSync(remote, `${remote}.away`);
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-unreachable', 'The repo couldn’t be reached when Refresh checked it.');
  await a.theme('light'); await shot(a, 'repo-unreachable-light', 'The same, light.'); await a.theme('dark');
  await a.run(`document.querySelector('#repo-try-again')?.focus()`); await tab(0);
  await shot(a, 'repo-keyboard-try-again', 'Keyboard focus on Try again in the band.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-unreachable-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  renameSync(`${remote}.away`, remote);
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await a.click('#repo-pull');
  await waitFor(a, `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  await shot(a, 'repo-pulled-both', 'The repo is back. Clicked "Pull": incident takes the repo’s version, notes waits to be pushed, and broken stays listed with why.');
  await a.click('#nav-history'); await shot(a, 'repo-history', 'Clicked "History": what Pull brought in, each with Undo.');
  await a.click('#nav-repo'); await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  const idle = `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`;
  // Only the item that can't come in is left.
  await a.click('#repo-push'); await waitFor(a, idle, 30000); await a.settle();
  await shot(a, 'repo-held-only', 'Clicked "Push": notes went to the repo. Only broken is left, and it can’t come in.');
  // With Sync off, an agent's deletion from the repo can't finish: Pull leaves it to try again.
  run(author, 'pull', '--quiet', 'origin', 'main');
  rmSync(join(author, 'agents', 'reviewer.md'));
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'Retire the reviewer'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');
  await a.click('#sync-switch'); await a.settle();
  await a.click('#header-refresh'); await waitFor(a, idle, 30000); await a.settle();
  await shot(a, 'repo-sync-off-removal', 'Turned Automatic sync off; the repo deleted the reviewer agent, then "Refresh": the deletion waits for Automatic sync, so nothing is offered to pull but the newer commit.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-sync-off-removal-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false }); await a.settle();
  await shot(a, 'repo-sync-off-removal-2560', 'The same at 2560×1440: the note keeps a reading width.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#repo-pull'); await waitFor(a, idle, 30000); await a.settle();
  await shot(a, 'repo-try-again', 'Clicked "Pull": this computer moved to the newer commit, and the band says reviewer still waits for Automatic sync.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-try-again-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#sync-switch'); await wait(2500); await a.settle();
  await shot(a, 'repo-pull-again-sync-on', 'Turned Automatic sync back on: the row now says to Pull again.');
  await a.click('#repo-disconnect'); await shot(a, 'repo-disconnect-confirm', 'Clicked "Disconnect…": it asks once, saying what stays; focus starts on Cancel.');
  await a.run(`document.querySelector('#repo-disconnect-confirm').focus()`); await tab(0);
  await shot(a, 'repo-keyboard-confirm', 'Keyboard focus on Disconnect, with its ring.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-disconnect-confirm-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#repo-disconnect-confirm'); await shot(a, 'repo-disconnected', 'Clicked "Disconnect": back to the start page; the tools are unchanged.');
}

a.quit();
// The app was stopped just now and its helper processes may still be writing: the folder goes once they are done.
rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
console.log(`tour in ${out}`);

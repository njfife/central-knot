// A screenshot tour of the real app on the Practice copy.
// Clicks are sent as pointer clicks (detail 1), as a mouse makes them; keyboard steps use real Tab presses.
// Usage: node scripts/ui-tour.mjs <outDir> [--electron] [--no-sandbox] [--only shell,skills,…] [--full]
// - With no switch it is the light tour (folder `light`): the app opens and each page is opened once, one picture each,
//   in well under a minute. It fails if a page doesn't open or throws. This is the run for every change.
// - `--only a,b` runs the named feature sections: the ones a change touched.
// - `--full` runs every feature section, hundreds of pictures over about ten minutes. For a new release only.
// Features: shell, skills, sync, mcp, agents, plugins, plugin-updates, plugin-items, instructions, updates, sizes (four tools; every page at 860×560 with the
// sidebar as a rail and open, then 1280×800, 1728×1117 and 2560×1440, each in dark and in light) and missing
// (a folder home with only Claude Code and Codex, so Copilot CLI and Pi appear nowhere as options).
// Each feature gets its own folder with NN-name.png (2x), NN-name.txt (the page's visible text) and tour.md (what each step did).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// ---------- Skills: one switch per skill, differing copies ----------
if (wanted('skills')) {
  begin('skills');
  await a.click('#nav-skills');
  await shot(a, 'skills-start', 'Clicked "Skills" in the sidebar. Nothing is synced yet: each switch, at the start of its row, sits halfway (not synced); the marks at the right end show which tools have each skill (hover one for its tool and what it has). A first-use tip sits above the table.');
  // The tour's clicks come from a script, so the pointer is put over the list (or moved off it) as a person's would be, and a
  // picture of a row that stays put is taken with the pointer still there.
  const pointerOver = async selector => {
    const at = await a.run(`(() => { const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return box ? { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) } : null; })()`);
    if (at) await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
    return at ?? undefined;
  };
  const overNotes = await pointerOver('.ov-row[data-key="notes"]');
  await a.click('#switch-notes');
  await shot(a, 'turned-on', 'With the pointer over notes’s row, clicked its switch (halfway: not synced): notes is copied to every tool at once and its switch is on. The row stays where it is while the pointer is over the list; the strip at the top says what happened, with Undo. The first-use tip is gone: it goes after the first click, on purpose.', overNotes);
  await pointerOver('.toolbar'); await a.settle();
  await shot(a, 'turned-on-left', 'Moved the pointer off the list (to the toolbar): the rows regroup at once, notes under On, and the headings count again.');
  await a.click('#outcome-undo');
  await shot(a, 'turned-on-undone', 'Clicked "Undo" in that strip: Codex’s new copy is gone again and notes is not synced, as before. The strip says so for a few seconds, then goes.');
  for (const key of ['notes', 'release-notes', 'standup']) await a.click(`#switch-${key}`);
  await shot(a, 'on', 'Clicked the switches of notes, release-notes and standup (one click each, the pointer off the list): the three are under On at once.');
  await a.click('#switch-review');
  await shot(a, 'review-copies-differ', 'Clicked review’s switch: its copies differ, so its row opens only the question of which copy every tool uses, with the copies. Nothing is written yet.');
  await a.size(1728, 1117);
  await shot(a, 'review-copies-differ-1728', 'The same at 1728×1117: the question opens under its row there too, where the switch was clicked, not in the side panel.');
  await a.click('#switch-review');
  await shot(a, 'review-question-closed', 'Clicked review’s switch again: the question closes, and nothing was written.');
  await a.click('#switch-review');
  await a.size(1280, 800);
  await a.click('#use-review-claude-cli');
  await shot(a, 'review-chosen', 'Clicked "Claude Code’s copy": every tool uses it at once, and review is on. Its details stay open, now with each tool’s own controls.');
  await a.click('#open-review');
  const overStandup = await pointerOver('.ov-row[data-key="standup"]');
  await a.click('#switch-standup');
  await shot(a, 'standup-off', 'Clicked review’s chevron to close its details, then, with the pointer over standup’s row, its switch: each tool’s own switch turns it off there and the copies stay. Its marks are grey and struck through, and the row stays where it was while the pointer is there.', overStandup);
  await pointerOver('.toolbar'); await a.settle();
  await shot(a, 'standup-off-regrouped', 'Moved the pointer off the list: standup moves to Off, last, whose heading says no tool loads these.');
  await a.theme('light'); await shot(a, 'standup-off-light', 'The same, in the light appearance.');
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await a.size(width, height);
    await a.theme('dark'); await shot(a, `standup-off-${width}-dark`, `The same at ${width}×${height}, dark.`);
    await a.theme('light'); await shot(a, `standup-off-${width}-light`, `The same at ${width}×${height}, light.`);
  }
  await a.size(1280, 800); await a.theme('dark');
  await a.click('#open-standup');
  await shot(a, 'details-off', 'Back at 1280×800, dark: clicked standup’s chevron at the right end of its row. Each tool’s row has its own switch and Remove (each says what it does on hover); "Delete everywhere…" is last.');
  await a.size(1728, 1117);
  await shot(a, 'details-off-1728', 'The same at 1728×1117: the details sit beside the table.');
  await a.size(1280, 800);
  await a.click('#files-standup');
  await shot(a, 'files-view', 'Clicked "Files and contents" in standup’s details: the list of skills, with the same marks, beside standup’s switch, files and details.');
  await a.click('#skills-table');
}

// ---------- Off and Remove in one tool ----------
if (wanted('disable')) {
  begin('disable');
  await a.click('#nav-skills');
  await a.click('#open-notes'); await shot(a, 'not-synced-details', 'Opened notes, not synced, in Claude Code and Copilot CLI: each tool\'s row has its own switch and Remove.');
  await a.click('#switch-notes'); if (!(await a.has('#enable-notes-codex-cli'))) await a.click('#open-notes');
  await a.click('#enable-notes-codex-cli');
  const toml = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  await shot(a, 'codex-off', `Turned notes on, then off in Codex alone, each at once. Codex keeps its copy and has it off; its config.toml now ends with:\n\n\`\`\`toml\n${toml.slice(toml.lastIndexOf('[[skills.config]]'))}\`\`\`\n`);
  if (!(await a.has('#remove-standup-copilot-cli'))) await a.click('#open-standup');
  await a.click('#remove-standup-copilot-cli'); await shot(a, 'removed', 'Opened standup (not synced, only in Copilot CLI) and clicked Remove in its Copilot CLI row: the copy is gone at once and kept in History. With no copy left, standup stays under Off.');
  if (!(await a.has('#enable-release-notes-claude-cli'))) await a.click('#open-release-notes');
  await a.click('#enable-release-notes-claude-cli');
  await shot(a, 'not-synced-off', 'Opened release-notes (not synced, only in Claude Code) and turned it off in Claude Code: it is off everywhere now.');
  await a.click('#delete-release-notes');
  await shot(a, 'delete-everywhere-confirm', 'Clicked "Delete everywhere…" for release-notes: it asks once more.');
  await a.click('#delete-confirm-release-notes'); await shot(a, 'delete-everywhere-done', 'Clicked "Delete release-notes from every tool".');
  await a.click('#nav-history'); await shot(a, 'history', 'Clicked "History": each switch and removal, each with its own Undo or Restore.');
  await a.click('#nav-skills');
  if (await a.has('#switch-standup')) { await a.click('#switch-standup'); await shot(a, 'put-back', 'Turned standup on again from Off: History put its copy back.'); }
  await a.click('#open-review'); await shot(a, 'differing-details', 'Opened review, whose copies differ: the choice first, then each tool\'s switch and Remove.');
  await a.click('#open-review');
  writeFileSync(join(practice, '.copilot/settings.json'), '{ not json');
  await a.click('#header-refresh'); if (!(await a.has('#enable-notes-claude-cli'))) await a.click('#open-notes');
  await shot(a, 'switch-unavailable', 'Outside the app, Copilot\'s settings.json was broken, then Refresh: its row says it can\'t switch there, with the reason as the row\'s text.');
  rmSync(join(practice, '.copilot/settings.json'));
  await a.click('#header-refresh');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 1300 ? 1 : 2, mobile: false });
    for (const theme of ['dark', 'light']) {
      await a.theme(theme);
      if (!(await a.has('.details'))) await a.click('#open-notes');
      await shot(a, `size-${width}-${theme}`, `notes' details (on, off in Codex) at ${width}×${height}, ${theme}.`);
    }
  }
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false });
  await a.theme('dark');
  if (!(await a.has('.details'))) await a.click('#open-notes');
  await a.click('#files-notes'); await shot(a, 'files-view-860-dark', 'At 860×560: clicked "Files and contents" for notes. The details pane is narrow here, so each tool\'s switch and Remove share the tool\'s line.');
  await a.click('#skills-table');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await a.theme('dark');
}

// ---------- Sync, notices and History ----------
if (wanted('sync')) {
  begin('sync');
  await a.click('#nav-skills');
  if (!(await a.run(`!!document.querySelector('.ov-row[data-key="standup"] .switch[aria-checked="true"]')`))) await a.click('#switch-standup');
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
if (wanted('mcp')) {
  begin('mcp');
  await a.click('#nav-mcp'); await shot(a, 'mcp-start', 'Clicked "MCP": each tool\'s user-wide MCP servers.');
  await a.click('#manage-all'); await shot(a, 'mcp-manage-all', 'Clicked "Manage 2" (Manage all): queued, not applied yet.');
  await a.click('#apply'); await shot(a, 'mcp-applied', 'Clicked "Apply all". Claude Code\'s settings file is written only by "Write now", with Claude Code quit.');
  if (await a.has('#mcp-write-claude')) { await a.click('#mcp-write-claude'); await shot(a, 'mcp-write-now', 'Clicked "Write now".'); }
  edit(join(practice, '.copilot/mcp-config.json'), text => text.replace('"command": "npx"', '"command": "npx-edited"'));
  await waitFor(a, `!!document.querySelector('.sync-notice')`);
  await shot(a, 'mcp-edit-notice', 'Outside the app, the files server\'s command was changed in Copilot\'s settings. A few seconds later.');
  // notes, when there: a skill whose copies agree, so its details offer Files and contents.
  const first = await a.run(`(document.querySelector('#open-notes') ?? document.querySelector('.ov-row[data-key] .row-open'))?.id ?? ''`);
  if (first) { await a.click(`#${first}`); await shot(a, 'mcp-details', 'Opened a server\'s details.'); }
  if (await a.has('#open-files')) { if (first) await a.click(`#${first}`); await a.click('#open-files'); await shot(a, 'mcp-waiting-details', 'Opened the files server\'s details while it waits for Write to Claude Code.'); }
}

// ---------- Agents ----------
if (wanted('agents')) {
  begin('agents');
  await a.click('#nav-agents'); await shot(a, 'agents-start', 'Clicked "Agents".');
  await a.click('#manage-all'); await shot(a, 'agents-pending', 'Clicked "Manage 2" (Manage all): queued, not applied yet.');
  await a.click('#apply'); await shot(a, 'agents-applied', 'Clicked "Apply all".');
  await a.click('#open-code-reviewer'); await shot(a, 'agents-limits', 'Opened code-reviewer, a Claude Code agent with fields other tools can\'t hold.');
  edit(join(practice, '.codex/agents/release-notes.toml'), text => text.replace('one line each.', 'one line each. Edited in Codex.'));
  await waitFor(a, `!!document.querySelector('.sync-notice')`);
  await shot(a, 'agents-edit-notice', 'Outside the app, release-notes was edited in Codex. A few seconds later.');
  // The one-way edge: an edit to a receiving copy stays there, and that copy stops updating.
  edit(join(practice, '.codex/agents/code-reviewer.toml'), text => text.replace('description = "', 'description = "Edited in Codex. '));
  await a.click('#header-refresh'); await a.settle();
  await shot(a, 'agents-oneway-stopped', 'Outside the app, code-reviewer (one-way from Claude Code) was edited in Codex, then Refresh was clicked.');
  if (await a.has('#cell-code-reviewer-codex-cli')) { await a.click('#cell-code-reviewer-codex-cli'); await shot(a, 'agents-oneway-resume', "Clicked code-reviewer's Codex box."); }
  await a.click('#apply'); await a.settle();
  await shot(a, 'agents-oneway-resumed', 'Clicked "Apply all": Codex has Claude Code\'s copy of code-reviewer again.');
  // Deciding later, then keeping the edit.
  edit(join(practice, '.codex/agents/code-reviewer.toml'), text => text.replace('description = "', 'description = "Edited in Codex again. '));
  await a.click('#header-refresh'); await a.settle();
  if (await a.has('#stopped-dismiss-code-reviewer-codex-cli')) { await a.click('#stopped-dismiss-code-reviewer-codex-cli'); await a.settle(); }
  if (!(await a.has('.details'))) { await a.click('#open-code-reviewer'); await a.settle(); }
  await shot(a, 'agents-decide-later', 'code-reviewer was edited in Codex again; clicked × (Decide later) on its notice. Its details are open.');
  if (await a.has('#stopped-keep-code-reviewer-codex-cli-details')) { await a.click('#stopped-keep-code-reviewer-codex-cli-details'); await a.settle(); await shot(a, 'agents-kept', 'Clicked "Keep Codex\'s edit" in the Codex row.'); }
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
if (wanted('profiles')) {
  begin('profiles');
  // The name field saves and closes on blur, which a window losing focus (macOS) also causes: reopened with Rename then.
  const name = async text => { if (!(await a.has('#profile-name'))) await a.click('#profile-rename'); await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await a.settle(); };
  await a.click('#nav-profiles'); await shot(a, 'empty', 'Clicked "Profiles" in the sidebar before any profile exists.');
  await a.click('#profile-new'); await shot(a, 'new-naming', 'Clicked "New profile": a profile is made and its name field is ready to type in.');
  await name('Incident');
  await shot(a, 'new-named', 'Typed "Incident" and pressed Enter. Nothing is in it yet.');
  await a.click('#pf-skill\\:notes'); await a.click('#pf-mcp\\:docs');
  await shot(a, 'incident-ticked', 'Ticked the notes skill and the docs MCP server. The blue rings show what switching to Incident turns off.');
  await a.click('#profile-switch');
  const claudeSettings = readFileSync(join(practice, '.claude/settings.json'), 'utf8');
  await shot(a, 'incident-switched', `Clicked "Switch to Incident". Claude Code's settings.json now holds:\n\n\`\`\`json\n${claudeSettings}\`\`\`\n`);
  await a.click('#pf-skill\\:review'); await shot(a, 'incident-drift', 'Ticked review in Incident, the profile in use: the subtitle says what Apply would change, nothing is written yet.');
  await a.click('#pf-skill\\:review');
  await a.click('#profile-delete'); await shot(a, 'delete-in-use', 'Clicked Delete on Incident, which is in use: it says why not, inline.');
  await a.click('#profile-delete-cancel');
  await a.click('#profile-new'); await name('Development');
  await a.click('#profile-from-now'); await shot(a, 'development-from-now', 'Made a second profile, "Development", and clicked "Start from what\'s on now".');
  await a.click('#pf-skill\\:standup');
  await shot(a, 'development-edited', 'Ticked standup too.');
  await a.click('#status-profile'); await shot(a, 'status-menu', 'Clicked "Incident" in the status bar: the profile menu, with focus on the profile in use.');
  await a.press('ArrowDown'); await shot(a, 'status-menu-keys', 'Pressed the Down arrow key: focus moves to Development (Up, Down, Home and End move; Escape closes).');
  await a.run(`[...document.querySelectorAll('.pf-menu-item')].find(item => item.textContent.includes('Development')).click()`); await a.settle();
  // A scripted click counts as a keyboard choice (focus returns to the status item, ringed); a mouse click leaves no ring.
  await a.run(`document.activeElement?.blur()`);
  await shot(a, 'switched-from-status', 'Chose "Development" in that menu.');
  await a.click('#profile-row-none'); await shot(a, 'no-profile', 'Clicked "No profile" in the list: what profiles turned off, and how profiles work.');
  await a.click('#nav-skills'); await shot(a, 'skills-with-profile', 'The Skills page while Development is in use: release-notes and review are off where a profile turned them off (the profile mark).');
  await a.click('#nav-mcp'); await shot(a, 'mcp-with-profile', 'The MCP servers page while Development is in use: files is off in Copilot CLI and Codex.');
  await a.click('#nav-skills');
  // Rows stay open across pages, so notes may already be open from earlier.
  if (!(await a.has('#enable-notes-claude-cli'))) await a.click('#open-notes');
  await a.click('#enable-notes-claude-cli');
  await a.click('#nav-profiles');
  await a.run(`[...document.querySelectorAll('.profile-row')].find(row => row.textContent.includes('Development')).click()`); await a.settle();
  await shot(a, 'off-by-hand', 'On the Skills page, turned notes off in Claude Code by hand (its own switch in notes’ details), then came back to Development: that switch shows as off by hand (its own mark), which profiles leave alone, and the subtitle says so.');
  const copilotSettings = join(practice, '.copilot/settings.json');
  const copilotKept = existsSync(copilotSettings) ? readFileSync(copilotSettings, 'utf8') : undefined;
  writeFileSync(copilotSettings, '{ not json');
  await a.click('#header-refresh');
  await shot(a, 'cant-switch', 'Outside the app, Copilot\'s settings.json was broken, then Refresh: Copilot\'s cells say they can\'t be switched, and why is listed under the table.');
  if (copilotKept === undefined) rmSync(copilotSettings); else writeFileSync(copilotSettings, copilotKept);
  await a.click('#header-refresh');
  await a.click('#nav-history'); await shot(a, 'history', 'Clicked "History": each switch is one row with Undo.');
  const undo = await a.run(`document.querySelector('.history-row[data-kind="profile"] button')?.id ?? ''`);
  if (undo) { await a.click(`#${undo}`); await shot(a, 'history-undone', 'Clicked "Undo switch" on the newest switch: Incident is in use again.'); }
  await a.click('#nav-profiles');
  await a.run(`[...document.querySelectorAll('.profile-row')].find(row => row.textContent.includes('Incident')).click()`); await a.settle();
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 1300 ? 1 : 2, mobile: false });
    for (const theme of ['dark', 'light']) {
      await a.theme(theme);
      await a.settle();
      await shot(a, `size-${width}-${theme}`, `Incident open on the Profiles page at ${width}×${height}, ${theme}.`);
    }
  }
  // The narrowest window with a profile that is not in use: its header while renaming, and while confirming Delete.
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false });
  await a.theme('dark');
  await a.run(`[...document.querySelectorAll('.profile-row')].find(row => row.textContent.includes('Development')).click()`); await a.settle();
  await a.click('#profile-rename');
  await name('Development and code review for web apps');
  await shot(a, 'size-860-long-name', 'At 860×560, renamed Development to a 40-character name: the header with Switch, Rename and Delete.');
  await a.click('#profile-rename'); await shot(a, 'size-860-renaming', 'Clicked Rename again: the field has the header to itself, with Enter / Esc hints.');
  await a.press('Escape');
  await a.click('#profile-delete'); await shot(a, 'size-860-delete-confirm', 'At 860×560, clicked Delete on Development: the confirmation wraps under the title.');
  await a.click('#profile-delete-cancel');
  await a.click('#profile-switch'); await a.run(`document.activeElement?.blur()`);
  await shot(a, 'size-860-long-name-in-use', 'Still at 860×560, switched to the profile with the 40-character name: the status bar item shortens it with an ellipsis (the full name is on hover).');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
}

// ---------- One skill of an installed plugin, off and back on (ENB-06) ----------
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
  await shot(a, 'skill-open-file', 'Clicked “Show its SKILL.md”: the file opens right under the link, above the tools’ lines, in its own scrolling box no taller than 40% of the window.');
  await a.theme('light'); await shot(a, 'skill-open-light', 'The same, light.'); await a.theme('dark');
  await size(860, 560); await shot(a, 'skill-open-860', 'The open row at 860×560, its SKILL.md showing under the link.');
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
  await a.click('#outcome-undo-plugin'); await a.settle();
  await shot(a, 'main-switch-changed-undone', 'Clicked Undo: “Undone: spreadsheet is back on in Copilot CLI and Codex.”');
  if (await a.has('#open-triage')) {
    await a.click('#open-triage'); await shot(a, 'part-and-plugin', 'Opened triage: its Pi part and the plugin installed in Codex share the row. The note says its switch also turns it on or off in Codex, through the plugin, and that deleting here removes only the separate item; Codex’s line has its switch.');
    // Each tool's switch for the item is in its opened row, and applies at once. issue-tracker is off in Codex: its switch
    // turns the plugin on there for triage alone.
    if (await a.has('#enable-triage-codex-cli')) {
      await a.click('#enable-triage-codex-cli'); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin, .bands .band')`, 15000);
      await shot(a, 'switch-applied', 'Clicked triage’s Codex switch in its opened row (the whole plugin issue-tracker was off there): it is on in Codex at once. The band leads with the skill clicked (“triage is on in Codex. Its plugin issue-tracker was turned on there, with MCP server issues left off.”), with Undo.');
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
  // One MCP server of a plugin has a switch of its own in every tool that takes plugins: Apply all writes it, and Undo takes it back.
  if (await a.has('[id="cell-issue-tracker@team-tools/issues-codex-cli"]')) {
    await a.click('[id="cell-issue-tracker@team-tools/issues-codex-cli"]');
    await shot(a, 'mcp-switch-waiting', 'Clicked issues’ box under Codex, where the whole plugin is off: the plugin turns on there on Apply all with only this server on.');
    await a.click('#apply'); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
    await shot(a, 'mcp-switch-applied', 'Clicked Apply all: Codex’s own switches are written, the result says what changed, and Undo is offered.');
    await size(1728, 1117); await shot(a, 'mcp-switch-applied-1728', 'The same at 1728×1117.'); await size(1280, 800);
    await a.click('#outcome-undo-plugin'); await a.settle();
    await shot(a, 'mcp-switch-undone', 'Clicked Undo: the plugin is off in Codex again, as it was.');
  }
  await a.click('#nav-agents'); await toPlugins(); await shot(a, 'agents', 'Agents: release-helper’s release-reviewer in Claude Code.');
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
      if (await a.has('.details-paths:not([open]) summary')) { await a.click('.details-paths:not([open]) summary'); await shot(a, `${tag}-skills-files-where`, `Clicked "Where each copy is", below the file, ${at}: then Delete everywhere….`); }
      else if (await a.has('.details-paths[open]')) { await a.run(`document.querySelector('.details-paths').scrollIntoView({ block: 'nearest' })`); await shot(a, `${tag}-skills-files-where`, `"Where each copy is" is open from the start ${at}: the skill's details in their column at the right, the status first and Delete everywhere… last.`); }
      const toggle = await a.run(`document.querySelector('[id^="detail-switch-"]')?.id ?? ''`);
      if (toggle) { await a.click(`#${toggle}`); await shot(a, `${tag}-skills-files-switched`, `Turned its switch in the Files view: it applies at once; the result and Undo are in the strip at the top ${at}.`); if (await a.has('#outcome-undo')) await a.click('#outcome-undo'); }
      await a.click('#skills-table');
    }
    if (await a.has('.ov-row.open')) await a.click(`#${first}`);
  }
  // draft's copies differ: its switch opens the copy question under its row, and a second click closes it.
  if (await a.has('#switch-draft')) {
    await a.click('#switch-draft'); await shot(a, `${tag}-skills-choice`, `Clicked draft's switch: its copies differ, so the copy question opens under its row ${at}.`);
    if (await a.has('#use-draft-copilot-cli')) await a.click('#switch-draft');
  }
  const on = await a.run(`document.querySelector('.ov-row[data-key] .switch[aria-checked="true"]:not([disabled])')?.id ?? ''`);
  if (on) { await a.click(`#${on}`); await shot(a, `${tag}-skills-switched-off`, `Turned one skill off: its result and Undo ${at}.`); if (await a.has('#outcome-undo')) await a.click('#outcome-undo'); }
  await a.click('#nav-mcp'); await shot(a, `${tag}-mcp`, `MCP servers ${at}, with the notice of an edit made outside the app.`);
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

/** An edit to Copilot CLI's MCP settings made outside the app, so the MCP page shows its notice and actions. */
async function editMcpOutside() {
  edit(join(practice, '.copilot/mcp-config.json'), text => (text.includes('"npx-edited"') ? text.replace('"npx-edited"', '"npx"') : text.replace('"command": "npx"', '"command": "npx-edited"')));
  await a.click('#nav-mcp');
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
  const turnOn = async () => { await a.click(`.ov-row[data-key="${name}"] .switch`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000); };
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
  await a.click('.ov-row[data-key="gamma"] .switch'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
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
// A stand-in for GitHub's releases, and the app acting as an installed copy of v0.5.0-preview.4 (CK_UPDATE_STUB): the status
// bar's Update button at each step and the Settings row, at 860×560 and 1728×1117.
if (wanted('updates')) {
  const zip = join(scratch, 'update.zip');
  writeFileSync(zip, Buffer.alloc(4_000_000, 7));
  const releases = [{ tag: 'v0.5.0-preview.5', zip, bytesPerSecond: 400_000 }];
  const fixture = await serveReleases(releases);
  const as = tag => ({ CK_UPDATE_STUB: tag, CK_UPDATE_RELEASES: fixture.releasesUrl });
  await fresh(as('v0.5.0-preview.4'));
  begin('updates');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  await shot(a, 'version', 'The app as it opens: the status bar names the build, "Central Knot 0.5.0 preview 4", at the bottom right.');
  await waitFor(a, `!!document.querySelector('#update-button')`, 20000);
  await shot(a, 'update-button', 'Shortly after launch it checked GitHub: a newer release, so the version became a button, "Update to 0.5.0 preview 5".');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `update-button-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
  await a.click('#nav-settings');
  await shot(a, 'settings-available', 'Settings › General › Updates: the build in use and its tag, Update and Check now, and what the last check found, with the release notes.');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `settings-available-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
  // Something waiting for Apply all (MCP servers still wait for it) holds the restart.
  await a.click('#nav-mcp'); await a.click('#manage-all');
  await a.click('#update-button');
  await waitFor(a, `/Downloading… [1-9]/.test(document.querySelector('#update-button')?.textContent ?? '')`, 10000);
  await shot(a, 'downloading', 'Managed every MCP server (not applied yet), then clicked "Update to 0.5.0 preview 5": the button shows the download.');
  await size(860, 560); await shot(a, 'downloading-860', 'The same at 860×560.'); await size(1280, 800);
  await waitFor(a, `document.querySelector('#update-button')?.textContent.trim() === 'Restart to update'`, 30000);
  await shot(a, 'held', 'Downloaded and prepared. Changes wait for Apply all, so it doesn’t restart by itself: the button says "Restart to update" and the status bar says why.');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `held-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
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
  // A failed check, and a failed download.
  releases.splice(0, 1, { tag: 'v0.5.0-preview.6', zip, cut: 0.3 });
  await a.click('#check-updates'); await waitFor(a, `!!document.querySelector('#setting-update')`, 10000);
  await a.click('#setting-update'); await waitFor(a, `/didn’t finish/.test(document.getElementById('setting-updates').textContent)`, 20000);
  await shot(a, 'settings-download-failed', 'A newer release, and its download was cut off: the row says nothing changed, and offers it again.');
  await size(860, 560); await shot(a, 'settings-download-failed-860', 'The same at 860×560.'); await size(1280, 800);
  await fixture.close();
  await a.click('#check-updates'); await waitFor(a, `/Couldn’t check/.test(document.getElementById('setting-updates').textContent)`, 40000);
  await shot(a, 'settings-check-failed', 'Clicked "Check now" with GitHub unreachable: the row says so; Central Knot tries again later.');
  // A build that can't update itself (here: not made from a release) says why and offers the release page.
  await fresh({}, false);
  await a.click('#nav-settings');
  await shot(a, 'settings-cannot', 'A build not made from a release (a development or local build): the row says why it doesn’t update itself and offers the releases page.');
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
  await a.click('#nav-profiles'); await a.click('#profile-new');
  await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = 'Incident'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await a.settle();
  await a.click('#pf-skill\\:notes'); await a.click('#profile-switch'); await a.run(`document.activeElement?.blur()`);
  await waitFor(a, `!!document.querySelector('#update-button')`, 20000);
  await shot(a, 'narrow-update', 'At 860×560 in a folder home with a profile in use ("Incident") and sync on with nothing managed yet, a newer release is found: the button says "Update", and the "Central Knot" name makes room.');
  await a.click('#nav-mcp'); await a.click('#manage-all');
  await a.click('#update-button');
  await waitFor(a, `/Downloading… [1-9]/.test(document.querySelector('#update-button')?.textContent ?? '')`, 10000);
  await shot(a, 'narrow-downloading', 'Managed every MCP server (not applied yet), then clicked "Update": the button shows the download.');
  await waitFor(a, `document.querySelector('#update-button')?.textContent.trim() === 'Restart to update'`, 30000);
  await shot(a, 'narrow-held', 'Downloaded and prepared; changes wait for Apply all, so the button says "Restart to update", with the warning mark. The message is only its mark at this width (its words are the mark’s tooltip, and the button’s).');
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
  if (!(await a.run(`!!document.querySelector('.ov-row[data-key="standup"] .switch[aria-checked="true"]')`))) await a.click('#switch-standup');
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
  if (await a.has('#switch-standup:not([aria-checked="true"])')) { await a.click('#switch-standup'); await shot(a, 'claude-switched', 'Turned standup on from Claude Code’s page: it is copied to every tool at once.'); }
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
  for (const key of await a.run(`[...document.querySelectorAll('.ov-row[data-key]')].filter(row => row.querySelector('.switch:not([aria-checked="true"]):not([disabled])') && !row.querySelector('[id^="decide-"]')).map(row => row.dataset.key)`)) await a.click(`#switch-${key}`);
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

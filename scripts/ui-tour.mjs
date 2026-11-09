// A screenshot tour of the real app on the Practice copy, feature by feature, for user-interface judging.
// Usage: node scripts/ui-tour.mjs <outDir> [--electron] [--no-sandbox] [--only shell,skills,…]
// Each feature gets its own folder with NN-name.png (2x), NN-name.txt (the page's visible text) and tour.md (what each step did).
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeMarket } from './fixture-market.mjs';
import { connect, holdQueue, keepFor, mainProcess, refocus, standIn } from './cdp.mjs';

const args = process.argv.slice(2);
const out = resolve(args.find(arg => !arg.startsWith('--')) ?? 'ui-tour');
const flag = name => args.includes(name);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined;
const root = resolve(import.meta.dirname, '..');
const command = flag('--electron') ? join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim()) : join(root, 'release/Central Knot-darwin-arm64/Central Knot.app/Contents/MacOS/Central Knot');
const scratch = mkdtempSync(join(tmpdir(), 'ck-tour-'));
const HOME = join(scratch, 'home');
mkdirSync(HOME, { recursive: true });
// On Linux the file manager is a stand-in that opens nothing.
mkdirSync(join(scratch, 'bin'));
writeFileSync(join(scratch, 'bin/xdg-open'), '#!/bin/sh\nexit 0\n');
chmodSync(join(scratch, 'bin/xdg-open'), 0o755);

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 400);
  const env = { HOME, PATH: `${join(scratch, 'bin')}:/usr/bin:/bin`, TMPDIR: join(scratch, 'tmp') };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  // A dev run also opens its main process, so the tour can show states only an installed app reaches (see Settings).
  const inspect = flag('--electron') ? port + 1000 : undefined;
  const child = spawn(command, [...(flag('--electron') ? [root, `--inspect=${inspect}`] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${join(scratch, 'data')}`, ...(flag('--no-sandbox') ? ['--no-sandbox'] : [])], { env, stdio: 'ignore' });
  let target;
  for (let attempt = 0; attempt < 150 && !target; attempt++) { await wait(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page'); } catch { /* starting */ } }
  const page = await connect(target.webSocketDebuggerUrl);
  const { send, run } = page;
  const settle = async () => { await wait(150); await run(`new Promise(done => { const c = () => (document.body.dataset.ready === 'true' || document.querySelector('.empty-state')) && document.body.dataset.busy !== 'true' ? done(true) : setTimeout(c, 25); c(); })`); await wait(200); };
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await settle();
  return {
    run, send, settle,
    main: inspect && (() => mainProcess(inspect)),
    click: async selector => { await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); e.click(); })()`); await settle(); },
    has: selector => run(`!!document.querySelector(${JSON.stringify(selector)})`),
    theme: async value => { await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }); await settle(); },
    quit: () => { page.close(); child.kill('SIGKILL'); },
  };
}

let feature = '';
let step = 0;
const begin = name => { feature = name; step = 0; mkdirSync(join(out, name), { recursive: true }); writeFileSync(join(out, name, 'tour.md'), `# ${name}\n\nEach step: what was just done, then the screenshot and visible text with the same number.\n\n`); };
const wanted = name => !only || only.includes(name);
/** `pointer`: where the mouse rests for the shot (to show a hover); by default out of the way. */
async function shot(a, name, caption, pointer = { x: 2, y: 798 }) {
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

const a = await launch();
const practice = await a.run(`document.querySelector('.status-home').title`);

// ---------- First run, homes and navigation ----------
if (wanted('shell')) {
  begin('shell');
  await shot(a, 'first-launch-dark', 'The app as it first opens (dark appearance): the Overview, on the Practice copy, a throwaway set of sample skills, MCP servers and agents.');
  await a.theme('light'); await shot(a, 'first-launch-light', 'The same, in the light appearance.'); await a.theme('dark');
  await a.click('#nav-skills'); await shot(a, 'skills-page', 'Clicked "Skills" in the sidebar: the skills table.');
  await a.click('#nav-tools'); await shot(a, 'tools-page', 'Clicked "Tools": which tools were found and where their files are.');
  await a.click('#nav-history'); await shot(a, 'history-empty', 'Clicked "History" before anything happened.');
  await a.click('#nav-overview');
  if (await a.has('#intro-dismiss')) { await a.click('#intro-dismiss'); await shot(a, 'intro-dismissed', 'Dismissed the practice-copy note on the Overview.'); }
  if (await a.has('#sidebar-toggle')) { await a.click('#sidebar-toggle'); await shot(a, 'sidebar-collapsed', 'Clicked the sidebar toggle (top left) to collapse the sidebar.'); await a.click('#sidebar-toggle'); }
  await a.click('#home-actual'); await a.click('#nav-skills'); await shot(a, 'this-macs-home', 'Clicked "This Mac\'s home" at the bottom left. (In this tour the "real home" is an empty throwaway folder on Linux, where real writes are not allowed: it shows the preview-only state.)');
  await a.click('#home-fixture'); await a.click('#nav-overview'); await shot(a, 'back-to-practice', 'Clicked "Practice copy" to go back, then "Overview".');
}

// ---------- Skills: manage, apply, differing copies, tool menus ----------
if (wanted('skills')) {
  begin('skills');
  await a.click('#nav-skills');
  await shot(a, 'skills-start', 'The Skills page before anything is managed. Rows are skills, columns are tools.');
  await a.click('#tool-copilot-cli'); await shot(a, 'tool-menu', 'Clicked the "Copilot CLI" column header: its tool menu (Add all to another tool, Stop all).');
  await a.press?.('Escape'); await a.click('#tool-copilot-cli');
  await a.click('#manage-all'); await shot(a, 'manage-all-pending', 'Clicked "Manage all": changes are queued, not applied yet.');
  await a.click('#apply'); await shot(a, 'applied', 'Clicked "Apply all": the copies were written.');
  await a.click('#open-review'); await shot(a, 'review-copies-differ', 'Opened the "review" row, whose copies differ between tools: the choice of which copy to use.');
  if (await a.has('#use-review-claude-cli')) { await a.click('#use-review-claude-cli'); await shot(a, 'review-chosen-pending', 'Chose "Use Claude Code\'s copy": queued.'); await a.click('#apply'); await shot(a, 'review-applied', 'Clicked "Apply all".'); }
  await a.click('#open-standup'); await shot(a, 'details-synced', 'Opened standup, a managed skill whose copies are all the same.');
  if (await a.has('#files-standup')) { await a.click('#files-standup'); await shot(a, 'files-view', 'Clicked "Files and contents" in its details.'); await a.click('#skills-table'); }
}

// ---------- Sync, notices and History ----------
if (wanted('sync')) {
  begin('sync');
  await a.click('#nav-skills');
  if (!(await a.run(`!!document.querySelector('.ov-row[data-key="standup"] .switch[aria-checked="true"]')`))) { await a.click('#manage-all'); await a.click('#apply'); }
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
  const first = await a.run(`document.querySelector('.ov-row[data-key] .row-open')?.id ?? ''`);
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
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(market)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace'); await shot(a, 'plugins-added', 'Typed a marketplace folder (a local copy of a team marketplace) into "Add a marketplace" and clicked Add.');
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
}

// ---------- Settings ----------
if (wanted('settings')) {
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
  const DAY = 24 * 60 * 60 * 1000;
  // Nothing is managed yet, so this home has no sync record: a shorter window is saved, and its History is cut the next time it records a change.
  await keepFor(a, 7); await a.click('#history-shorten'); await wait(300); await a.settle();
  await shot(a, 'settings-history-saved-for-later', 'Shortened to 7 days in a home that doesn’t sync yet (nothing managed): the window is saved, and the row says older History goes the next time this home records a change, not that it was removed.');
  await keepFor(a, 30);
  // From here the home syncs (everything managed, as in the sync tour), so shortening removes older History at once.
  await a.click('#nav-skills');
  if (!(await a.run(`!!document.querySelector('.ov-row[data-key="standup"] .switch[aria-checked="true"]')`))) { await a.click('#manage-all'); await a.click('#apply'); }
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
  await size(1728, 1117); await shot(a, 'settings-history-confirm-1728', 'The same at 1728×1117: the question spans the row, its buttons right after its words.');
  await size(2560, 1440); await shot(a, 'settings-history-confirm-2560', 'The same at 2560×1440: the buttons still follow the words, not the row’s far end.'); await size(860, 560);
  await a.click('#history-shorten-cancel'); await shot(a, 'settings-history-cancelled', 'Clicked Cancel: the question goes, nothing is saved (still 30 days), and the focus is back on the select.');
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
  await shot(a, 'settings-history-prune-failed', 'Shortened to 7 days with the home’s History folder read-only: the window is saved (the select shows 7), and the row says the older History couldn’t be removed yet and that the log says why.');
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

a.quit();
rmSync(scratch, { recursive: true, force: true });
console.log(`tour in ${out}`);

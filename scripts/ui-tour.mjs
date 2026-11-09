// A screenshot tour of the real app on the Practice copy, feature by feature, for user-interface judging.
// Usage: node scripts/ui-tour.mjs <outDir> [--electron] [--no-sandbox] [--only shell,skills,…]
// Each feature gets its own folder with NN-name.png (2x), NN-name.txt (the page's visible text) and tour.md (what each step did).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeMarket } from './fixture-market.mjs';

const args = process.argv.slice(2);
const out = resolve(args.find(arg => !arg.startsWith('--')) ?? 'ui-tour');
const flag = name => args.includes(name);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined;
const root = resolve(import.meta.dirname, '..');
const command = flag('--electron') ? join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim()) : join(root, 'release/Central Knot-darwin-arm64/Central Knot.app/Contents/MacOS/Central Knot');
const scratch = mkdtempSync(join(tmpdir(), 'ck-tour-'));
const HOME = join(scratch, 'home');
mkdirSync(HOME, { recursive: true });

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 400);
  const env = { HOME, PATH: '/usr/bin:/bin', TMPDIR: join(scratch, 'tmp') };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  const child = spawn(command, [...(flag('--electron') ? [root] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${join(scratch, 'data')}`, ...(flag('--no-sandbox') ? ['--no-sandbox'] : [])], { env, stdio: 'ignore' });
  let target;
  for (let attempt = 0; attempt < 150 && !target; attempt++) { await wait(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page'); } catch { /* starting */ } }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(done => { socket.onopen = done; });
  const pending = new Map();
  let id = 0;
  socket.onmessage = message => { const data = JSON.parse(message.data); if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); } };
  const send = (method, params = {}) => new Promise(done => { const key = ++id; pending.set(key, done); socket.send(JSON.stringify({ id: key, method, params })); });
  const run = async expression => { const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text); return reply.result.result.value; };
  const settle = async () => { await wait(150); await run(`new Promise(done => { const c = () => (document.body.dataset.ready === 'true' || document.querySelector('.empty-state')) && document.body.dataset.busy !== 'true' ? done(true) : setTimeout(c, 25); c(); })`); await wait(200); };
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await settle();
  return {
    run, send, settle,
    click: async selector => { await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); e.click(); })()`); await settle(); },
    has: selector => run(`!!document.querySelector(${JSON.stringify(selector)})`),
    theme: async value => { await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }); await settle(); },
    quit: () => { socket.close(); child.kill('SIGKILL'); },
  };
}

let feature = '';
let step = 0;
const begin = name => { feature = name; step = 0; mkdirSync(join(out, name), { recursive: true }); writeFileSync(join(out, name, 'tour.md'), `# ${name}\n\nEach step: what was just done, then the screenshot and visible text with the same number.\n\n`); };
const wanted = name => !only || only.includes(name);
async function shot(a, name, caption) {
  step++;
  const base = `${String(step).padStart(2, '0')}-${name}`;
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 798 });
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

// ---------- A plugin's parts in tools without plugins ----------
if (wanted('parts')) {
  begin('parts');
  // Pi is in the home (it takes no plugins), and no tool's CLI is on this tour's PATH, so Codex and Copilot CLI can't
  // take plugins here either: each can take a plugin's parts instead.
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await a.run('window.centralKnot.refresh()');
  const market = join(scratch, 'parts-market');
  writeMarket(market);
  await a.click('#nav-skills'); await a.click('#nav-plugins');
  if (await a.has('#marketplace-source')) {
    await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(market)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await a.click('#add-marketplace');
  }
  if (await a.has('#plugin-back')) await a.click('#plugin-back');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  await shot(a, 'list-offers', 'Plugins, team-tools: Pi takes no plugins, and Codex and Copilot CLI have no CLI on this computer, so their boxes are hatched with a plus: a click chooses the plugin’s parts instead.');
  await a.click('#popen-0-issue-tracker'); await waitFor(a, `/(Can go in|Installed|Out of date)/.test(document.querySelector('.plugin-parts-section')?.textContent ?? '')`);
  await shot(a, 'page-offer', 'Opened issue-tracker: "Its parts, as separate items" says which tools can take them and what goes in.');
  await a.click('#pcell-0-issue-tracker-pi-cli'); await a.click('#pcell-0-issue-tracker-codex-cli');
  await shot(a, 'page-chosen', 'Clicked the Pi and Codex boxes: both wait for Apply all.');
  await a.click('#plugins-apply'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await shot(a, 'page-installed', 'Clicked Apply all: the skill and MCP server went into Pi and Codex as ordinary items.');
  await a.click('#plugin-back'); await shot(a, 'list-installed', 'Back to the list: Pi and Codex show the parts mark.');
  await a.click('#nav-skills'); if (await a.has('#open-triage')) await a.click('#open-triage');
  await shot(a, 'skills-provenance', 'Skills page, triage opened: it says which plugin it came from, with a way to its page.');
  await a.click('#nav-mcp'); if (await a.has('#open-issues')) await a.click('#open-issues');
  await shot(a, 'mcp-provenance', 'MCP page, issues opened: the server in Pi’s and Codex’s own formats, from issue-tracker.');
  // The marketplace publishes a new version: the triage skill changed.
  edit(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), text => text.replace('Follow the steps.', 'Follow the steps, then label it.'));
  edit(join(market, '.claude-plugin/marketplace.json'), text => text.replace('"version": "2.0.0"', '"version": "2.1.0"'));
  await a.click('#nav-plugins'); if (await a.has('#plugin-back')) await a.click('#plugin-back');
  await a.click('#refresh-0');
  await shot(a, 'list-out-of-date', 'The marketplace published 2.1.0 and was refreshed: the parts show as out of date.');
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

a.quit();
rmSync(scratch, { recursive: true, force: true });
console.log(`tour in ${out}`);

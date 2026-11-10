// A screenshot tour of the real app on the Practice copy, feature by feature, for user-interface judging.
// Usage: node scripts/ui-tour.mjs <outDir> [--electron] [--no-sandbox] [--only shell,skills,…]
// Features: shell, skills, sync, mcp, agents, plugins, instructions, sizes (four tools; every page at 860×560 with the
// sidebar as a rail and open, then 1280×800, 1728×1117 and 2560×1440, each in dark and in light) and missing
// (a folder home with only Claude Code and Codex, so Copilot CLI and Pi appear nowhere as options).
// Each feature gets its own folder with NN-name.png (2x), NN-name.txt (the page's visible text) and tour.md (what each step did).
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
    run, send, settle, size, viewport,
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
/** Takes a screenshot. The pointer moves to the corner first, so no hover shows, unless `hover` keeps it where it is. */
async function shot(a, name, caption, { hover = false } = {}) {
  step++;
  const base = `${String(step).padStart(2, '0')}-${name}`;
  if (!hover) await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: a.viewport.height - 2 });
  await wait(120);
  const reply = await a.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, feature, `${base}.png`), Buffer.from(reply.result.data, 'base64'));
  writeFileSync(join(out, feature, `${base}.txt`), await a.run('document.body.innerText'));
  appendFileSync(join(out, feature, 'tour.md'), `${step}. **${base}**: ${caption}\n`);
}
const waitFor = async (a, expression, ms = 8000) => { for (let spent = 0; spent < ms; spent += 250) { if (await a.run(expression)) return true; await wait(250); } return false; };
const edit = (path, change) => writeFileSync(path, change(readFileSync(path, 'utf8')));

let a = await launch();
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
      if (toggle) { await a.click(`#${toggle}`); await shot(a, `${tag}-skills-files-pending`, `Turned Managed for it in the Files view: the change waits for Apply all ${at}.`); if (await a.has('#discard')) await a.click('#discard'); }
      await a.click('#skills-table');
    }
    if (await a.has('.ov-row.open')) await a.click(`#${first}`);
  }
  // The last column's menu: the one most likely to run past the window's edge.
  const head = await a.run(`[...document.querySelectorAll('.tool-head-button')].at(-1)?.id ?? ''`);
  if (head) { await a.click(`#${head}`); await shot(a, `${tag}-skills-tool-menu`, `Opened the last tool column's menu ${at}.`); await a.click(`#${head}`); }
  if (await a.has('#decide-draft')) {
    await a.click('#decide-draft');
    if (await a.has('#use-draft-copilot-cli')) { await a.click('#use-draft-copilot-cli'); await shot(a, `${tag}-skills-choice`, `Chose Copilot CLI's copy of draft, whose copies differ: the choice waits for Apply all ${at}.`); }
    if (await a.has('#discard')) await a.click('#discard');
  }
  if (await a.has('#decide-draft')) {
    await a.click('#decide-draft');
    if (await a.has('#separate-draft')) { await a.click('#separate-draft'); await shot(a, `${tag}-skills-separate`, `Chose to keep draft's differing copies separate: the choice waits for Apply all ${at}.`); }
    if (await a.has('#discard')) await a.click('#discard');
  }
  const off = await a.run(`document.querySelector('.ov-row[data-key] .cell-button.cell-on:not([disabled])')?.id ?? ''`);
  if (off) { await a.click(`#${off}`); await shot(a, `${tag}-skills-pending-removal`, `Clicked a synced box: it stops syncing on Apply all ${at}.`); if (await a.has('#discard')) await a.click('#discard'); }
  const cell = await a.run(`document.querySelector('.ov-row[data-key] .cell-button:not([disabled])')?.id ?? ''`);
  if (cell) { await a.click(`#${cell}`); await shot(a, `${tag}-skills-pending`, `Clicked one box: a change waits for Apply all ${at}.`); if (await a.has('#discard')) await a.click('#discard'); }
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
  if (hovered) await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hovered[0], y: hovered[1] });
  const isHovered = hovered && await waitFor(a, `!!document.querySelectorAll('.history-row')[1]?.matches(':hover')`, 2000);
  await shot(a, `${tag}-history`, `History ${at}${isHovered ? ', the pointer over the second row (its hover tint shows)' : ''}.`, { hover: true });
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await a.click('#nav-tools'); await shot(a, `${tag}-tools`, `Tools ${at}.`);
  await a.click('#nav-settings'); await shot(a, `${tag}-settings`, `Settings ${at}.`);
}

/** An edit to Copilot CLI's MCP settings made outside the app, so the MCP page shows its notice and actions. */
async function editMcpOutside() {
  edit(join(practice, '.copilot/mcp-config.json'), text => (text.includes('"npx-edited"') ? text.replace('"npx-edited"', '"npx"') : text.replace('"command": "npx"', '"command": "npx-edited"')));
  await a.click('#nav-mcp');
  await waitFor(a, `!!document.querySelector('.sync-notice')`, 10000);
}

if (wanted('sizes')) {
  begin('sizes');
  // Four tools: Pi gets its own folder in the practice copy, so every table has its widest set of columns.
  cpSync(join(practice, '.claude/skills/notes'), join(practice, '.pi/agent/skills/notes'), { recursive: true });
  // A skill whose copies differ, so a copy choice can be shown waiting for Apply all.
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
      edit(join(practice, '.codex/skills/release-notes/SKILL.md'), text => text.replace(/\n*$/, '\nEdited in Codex for the rail.\n'));
      if (await waitFor(a, `!!document.querySelector('.nav-unseen')`, 30000)) await shot(a, '860-rail-unseen-dot', 'At 860×560 with the sidebar as a rail: a skill edited outside the app (release-notes, in Codex) puts a dot at the Skills icon\'s top right, and the icons stay in one column.');
    }
    await everyPage(`${width}`);
    // Large windows open with the sidebar; folded to its rail, every page has the extra width too.
    if (width >= 1728) { await a.click('#sidebar-toggle'); await everyPage(`${width}-rail`); await a.click('#sidebar-toggle'); }
    // Pi's mark as the window shows it at 100% zoom, on an Overview card and in the table's header.
    if (width === 1280) {
      await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await a.click('#nav-overview'); await shot(a, '1280-overview-1x', 'The Overview at 1280×800 at 100% zoom (one screen pixel per pixel), where the tools\' small marks, Pi\'s among them, are drawn at 12px.');
      await a.click('#nav-skills'); await shot(a, '1280-skills-1x', 'Skills at 100% zoom: the tool marks in the column headers.');
      await a.size(width, height);
    }
    // At the minimum the sidebar folds to its rail; the person can open it, leaving the content about 650px.
    if (width === 860) {
      await a.click('#sidebar-toggle'); await everyPage('860-sidebar-open'); await a.click('#sidebar-toggle');
      // A message in the status bar at the minimum: the facts keep their words, and the message shortens.
      await a.click('#nav-skills');
      const box = await a.run(`document.querySelector('.ov-row[data-key] .cell-button:not([disabled])')?.id ?? ''`);
      if (box) {
        await a.click(`#${box}`); await a.click('#discard'); await shot(a, '860-status-message', 'Clicked a box, then Discard: the status bar says so at 860×560, with the sidebar as a rail.');
        await a.click('#sidebar-toggle');
        await a.click(`#${box}`); await a.click('#discard'); await shot(a, '860-sidebar-open-status-message', 'The same with the sidebar open: with too little room for the message, a mark stands in, the message its tooltip.');
        await a.click('#sidebar-toggle');
      }
    }
  }
  await a.theme('light');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) { await a.size(width, height); await everyPage(`${width}-light`); }
  await a.theme('dark');
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
  await a.click('#nav-tools'); await shot(a, `${tag}-tools`, `${home}: Tools.`);
}

if (wanted('missing')) {
  begin('missing');
  await a.click('#home-fixture');
  await toolViews('before', 'The practice copy, with every tool');
  // This Mac's home looks for installed apps too: a tool installed here still counts; one that isn't (Pi) is named on Tools.
  for (const name of ['.claude', '.claude.json', '.codex']) cpSync(join(root, 'fixtures/home', name), join(HOME, name), { recursive: true });
  await a.click('#home-actual'); await a.click('#nav-tools');
  await shot(a, 'this-mac-tools', 'This Mac\'s home with only Claude Code\'s and Codex\'s folders: a tool installed on this machine still counts; a tool not found is named once, at the end.');
  const folder = join(scratch, 'two-tools');
  for (const name of ['.claude', '.claude.json', '.codex']) cpSync(join(root, 'fixtures/home', name), join(folder, name), { recursive: true });
  a.quit();
  await wait(500);
  const settings = join(scratch, 'data/app-settings.json');
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: folder } }));
  a = await launch();
  await toolViews('after', 'A folder with only Claude Code and Codex');
  await a.click('#nav-overview'); await shot(a, 'after-overview', 'The same folder\'s Overview: its first sentence names only the two tools.');
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
  await a.click('#nav-tools'); await shot(a, 'pi-only-tools', 'The same folder\'s Tools: Pi\'s card names only what Pi can hold (skills and MCP servers).');
  // A folder with no tools at all: every page stays, each saying so.
  const empty = join(scratch, 'no-tools');
  mkdirSync(empty, { recursive: true });
  a.quit();
  await wait(500);
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: empty } }));
  a = await launch();
  await a.click('#nav-overview'); await shot(a, 'no-tools-overview', 'A folder with no tools at all: the sidebar keeps Overview, History, Tools and Settings, and the Overview says no tools were found, with Choose another home….');
  await a.click('#nav-tools'); await shot(a, 'no-tools-tools', 'Its Tools page: the same sentence and action, in the same place.');
  await a.click('#nav-history'); await waitFor(a, `!!document.querySelector('#history-choose-home, .history-row')`); await shot(a, 'no-tools-history', 'Its History page: the same sentence and action, in the same place.');
  await a.size(860, 560); await a.click('#nav-overview'); await shot(a, 'no-tools-860-overview', 'The Overview at 860×560.');
  await a.click('#nav-tools'); await shot(a, 'no-tools-860-tools', 'Its Tools page at 860×560.');
  await a.size(1280, 800);
}

a.quit();
rmSync(scratch, { recursive: true, force: true });
console.log(`tour in ${out}`);

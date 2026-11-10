// A screenshot tour of the real app on the Practice copy, feature by feature, for user-interface judging.
// Usage: node scripts/ui-tour.mjs <outDir> [--electron] [--no-sandbox] [--only shell,skills,…]
// Features: shell, skills, sync, mcp, agents, plugins, instructions, sizes (four tools; every page at 860×560 with the
// sidebar as a rail and open, then 1280×800, 1728×1117 and 2560×1440, each in dark and in light) and missing
// (a folder home with only Claude Code and Codex, so Copilot CLI and Pi appear nowhere as options).
// Each feature gets its own folder with NN-name.png (2x), NN-name.txt (the page's visible text) and tour.md (what each step did).
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeClaudeInstall, writeMarket } from './fixture-market.mjs';
import { connect, DAY, holdQueue, keepFor, mainProcess, refocus, standIn } from './cdp.mjs';

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
    click: async selector => { await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); e.click(); })()`); await settle(); },
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
const wanted = name => !only || only.includes(name);
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
  if (!(await a.has('#marketplace-source'))) await a.click('#open-add-marketplace');
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(source)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
}

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

// ---------- Disable and Remove, per tool ----------
if (wanted('disable')) {
  begin('disable');
  await a.click('#nav-skills');
  await a.click('#open-notes'); await shot(a, 'unmanaged-details', 'Opened notes, an unmanaged skill in Claude Code and Copilot CLI: each tool\'s row has an Enabled switch and Remove.');
  await a.click('#switch-notes'); await a.click('#enable-notes-codex-cli');
  await shot(a, 'managed-codex-disabled-pending', 'Turned Managed on for notes, then switched Codex\'s row to Disabled: queued, nothing written yet.');
  await a.click('#apply');
  const toml = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  await shot(a, 'applied-disabled', `Clicked "Apply all". Codex got a copy and has it disabled. Codex's config.toml now ends with:\n\n\`\`\`toml\n${toml.slice(toml.lastIndexOf('[[skills.config]]'))}\`\`\`\n`);
  await a.click('#open-notes');
  await a.click('#open-standup'); await a.click('#remove-standup-copilot-cli');
  await shot(a, 'remove-pending', 'Opened standup (unmanaged, only in Copilot CLI) and clicked Remove in its Copilot CLI row: queued.');
  await a.click('#apply'); await shot(a, 'removed', 'Clicked "Apply all": the copy is gone from Copilot CLI and kept in History.');
  await a.click('#open-release-notes'); await a.click('#enable-release-notes-claude-cli'); await a.click('#apply');
  await shot(a, 'unmanaged-disabled', 'Opened release-notes (unmanaged, only in Claude Code), switched Claude Code to Disabled and clicked "Apply all".');
  await a.click('#delete-release-notes');
  await shot(a, 'delete-everywhere-confirm', 'Opened release-notes (unmanaged, only in Claude Code) and clicked "Delete everywhere…": it asks once more.');
  await a.click('#delete-confirm-release-notes'); await shot(a, 'delete-everywhere-done', 'Clicked "Delete release-notes from every tool".');
  await a.click('#nav-history'); await shot(a, 'history', 'Clicked "History": the Disable and the removal, each with its own Undo or Restore.');
  const restore = await a.run(`document.querySelector('.history-row[data-kind="removed"] button')?.id ?? ''`);
  if (restore) { await a.click(`#${restore}`); await shot(a, 'history-restored', 'Clicked Restore on the newest removal (release-notes, in Claude Code).'); }
  await a.click('#nav-skills');
  await a.click('#open-review'); await shot(a, 'differing-details', 'Opened review, whose copies differ: the choice first, then each tool\'s switch and Remove.');
  await a.click('#open-review');
  writeFileSync(join(practice, '.copilot/settings.json'), '{ not json');
  await a.click('#header-refresh'); await a.click('#open-notes');
  await shot(a, 'switch-unavailable', 'Outside the app, Copilot\'s settings.json was broken, then Refresh: its row says Disable unavailable, with the reason as the row\'s text.');
  rmSync(join(practice, '.copilot/settings.json'));
  await a.click('#header-refresh');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 1300 ? 1 : 2, mobile: false });
    for (const theme of ['dark', 'light']) {
      await a.theme(theme);
      if (!(await a.has('.details'))) await a.click('#open-notes');
      await shot(a, `size-${width}-${theme}`, `notes' details (managed, disabled in Codex) at ${width}×${height}, ${theme}.`);
    }
  }
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false });
  await a.theme('dark'); await a.click('#enable-notes-claude-cli'); await a.click('#remove-notes-copilot-cli');
  await shot(a, 'pending-860-dark', 'At 860×560: queued Disable in Claude Code and Remove in Copilot CLI for notes, not applied.');
  await a.click('#discard');
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
  const name = async text => { await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await a.settle(); };
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
  await a.click('#nav-skills'); await a.click('#open-notes'); await a.click('#enable-notes-claude-cli'); await a.click('#apply');
  await a.click('#nav-profiles');
  await a.run(`[...document.querySelectorAll('.profile-row')].find(row => row.textContent.includes('Development')).click()`); await a.settle();
  await shot(a, 'off-by-hand', 'On the Skills page, turned notes off in Claude Code by hand (its Enabled switch, then Apply all), then came back to Development: that switch shows as off by hand (its own mark), which profiles leave alone, and the subtitle says so.');
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
  if (await a.has('#marketplace-source')) {
    await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(market)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await a.click('#add-marketplace');
  }
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
}

// ---------- Plugin versions and skill text ----------
if (wanted('plugin-versions')) {
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
  else {
    await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(market)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await a.click('#add-marketplace');
  }
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
  await size(1280, 800); await a.theme('dark');
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
  const pointer = hovered ? { x: hovered[0], y: hovered[1] } : undefined;
  if (pointer) await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer });
  const isHovered = hovered && await waitFor(a, `!!document.querySelectorAll('.history-row')[1]?.matches(':hover')`, 2000);
  await shot(a, `${tag}-history`, `History ${at}${isHovered ? ', the pointer over the second row (its hover tint shows)' : ''}.`, pointer);
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
  await a.size(2560, 1440); await shot(a, 'this-mac-tools-2560', 'The same at 2560×1440: as many columns as cards.'); await a.size(1280, 800);
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
  await a.click('#nav-tools'); await shot(a, 'after-2560-tools', 'The same folder\'s Tools at 2560×1440: two cards, two columns.');
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
  await a.click('#nav-tools'); await shot(a, 'pi-only-tools', 'The same folder\'s Tools: Pi\'s card names only what Pi can hold (skills and MCP servers).');
  await a.size(2560, 1440); await a.click('#nav-overview'); await shot(a, 'pi-only-2560-overview', 'The Pi-only Overview at 2560×1440: two kind cards in two columns.'); await a.size(1280, 800);
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
  // Nothing is managed yet, so this home has no sync record: a shorter window is saved, and its History is cut the next time it records a change.
  await keepFor(a, 7); await a.click('#history-shorten'); await wait(300); await a.settle();
  await shot(a, 'settings-history-saved-for-later', 'Shortened to 7 days in a home that doesn’t sync yet (nothing managed): the window is saved, and the row says (with the neutral info glyph) that older History goes the next time this home records a change, not that it was removed. The Show log file note from the step before is gone: one finished note at a time.');
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

a.quit();
rmSync(scratch, { recursive: true, force: true });
console.log(`tour in ${out}`);

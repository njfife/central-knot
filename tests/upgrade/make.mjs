// Makes the two old homes tests/upgrade.test.ts upgrades, with the old versions' own engines (README.md beside this says when
// to run it). Each step is what a person did in that version, carried out by that version's code from a checkout of its tag,
// and checked to have done what it is for; nothing here writes Central Knot's records by hand. The home is made at HOME, and
// the paths its records keep stay as made (the test points them at its copy).
//   node tests/upgrade/make.mjs preview-9 <checkout of v0.5.0-preview.9>   makes tests/upgrade/preview-9 (home A)
//   node tests/upgrade/make.mjs alpha-1 <checkout of v0.6.0-alpha.1>       makes tests/upgrade/alpha-1 from preview-9 (home B)
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = '/tmp/ck-upgrade-fixture/home';
const APP_DATA = '/tmp/ck-upgrade-fixture/app';
const here = dirname(fileURLToPath(import.meta.url));
const [which, checkout] = process.argv.slice(2);
if (!['preview-9', 'alpha-1'].includes(which) || !checkout) throw new Error('Usage: node tests/upgrade/make.mjs preview-9|alpha-1 <checkout of the tag>');
const engine = (file) => import(join(resolve(checkout), 'src', file));

const { discover } = await engine('discovery.ts');
const { harnessIds } = await engine('harnesses.ts');
const { STANDARD_BUILD } = await engine('values.ts');
const { managedNow } = await engine('share.ts');
/** The app's context for a chosen folder, as both versions' main.ts make it (no tool's folder moved by a variable). */
const context = {
  home: HOME, mode: 'custom', build: STANDARD_BUILD, buildName: 'Central Knot', settingsPath: join(APP_DATA, 'sharing-settings.json'),
  realHome: join(APP_DATA, 'real'), settleMs: 0, read: () => Promise.all(harnessIds.map(harness => discover({ home: HOME, mode: 'custom', harness }))),
};
const tools = async () => managedNow(context, await context.read());

async function put(path, text) {
  await mkdir(dirname(join(HOME, path)), { recursive: true });
  await writeFile(join(HOME, path), text);
}
const skill = (name, body) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;
const agent = (name, body, extra = '') => `---\nname: ${name}\ndescription: The ${name} agent.\n${extra}---\n\n${body}\n`;
/** What a pass or click did, one line per item and tool, as `<item> <tool> <outcome>`. */
const did = (...results) => results.flatMap(result => result.results ?? []).map(entry => `${entry.item} ${entry.harness ?? '-'} ${entry.outcome}`).sort();

async function previewNine() {
  const { applyChanges } = await engine('manage.ts');
  const { applyMcp } = await engine('mcp.ts');
  const { applyAgents } = await engine('agents.ts');
  const { saveProfile, switchProfile } = await engine('profiles.ts');
  // 1. The tools' own files before Central Knot: Claude Code, Copilot CLI and Codex.
  await put('.claude/skills/notes/SKILL.md', skill('notes', 'Write each note as one line.'));
  await put('.claude/skills/style/SKILL.md', skill('style', 'Prefer short sentences.'));
  await put('.codex/skills/style/SKILL.md', skill('style', 'Codex keeps its own style.'));
  await put('.claude/skills/clash/SKILL.md', skill('clash', 'Claude Code’s clash.'));
  await put('.copilot/skills/clash/SKILL.md', skill('clash', 'Copilot CLI’s clash.'));
  await put('.claude/skills/drafts/SKILL.md', skill('drafts', 'Keep drafts short.'));
  await put('.codex/skills/scratch/SKILL.md', skill('scratch', 'Found only in Codex.'));
  await put('.copilot/mcp-config.json', `${JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx', args: ['-y', 'docs-mcp'], tools: ['*'] } } }, null, 2)}\n`);
  await put('.claude.json', `${JSON.stringify({ numStartups: 3, mcpServers: { search: { type: 'stdio', command: 'search-mcp', args: [] } } }, null, 2)}\n`);
  await put('.codex/config.toml', 'model = "o4"\n\n[mcp_servers.local-db]\ncommand = "local-db-mcp"\n');
  await put('.claude/agents/reviewer.md', agent('reviewer', 'Read the diff and list problems.'));
  await put('.claude/agents/planner.md', agent('planner', 'Plan the change in steps.', 'model: sonnet\n'));
  await put('.copilot/agents/helper.agent.md', agent('helper', 'Found only in Copilot CLI.'));
  const all = await tools();
  assert.deepEqual(all, ['claude-cli', 'copilot-cli', 'codex-cli']);
  // 2. Skills page, Apply all: notes everywhere; style everywhere but Codex (which keeps its own); clash, whose copies differ,
  //    with no copy chosen (held: nothing written); drafts in Claude Code alone. scratch is left as found.
  assert.deepEqual(did(await applyChanges(context, [
    { key: 'notes', managed: true, off: [] }, { key: 'style', managed: true, off: ['codex-cli'] },
    { key: 'clash', managed: true, off: [] }, { key: 'drafts', managed: true, off: ['copilot-cli', 'codex-cli'] },
  ])), ['clash - held', 'notes codex-cli written', 'notes copilot-cli written', 'style copilot-cli written']);
  // 3. MCP servers page, Apply all, with Write to Claude Code: docs (Copilot CLI's) everywhere; search in Claude Code alone.
  //    local-db is left as found.
  const servers = [{ key: 'docs', managed: true, off: [] }, { key: 'search', managed: true, off: ['copilot-cli', 'codex-cli'] }];
  assert.deepEqual(did(await applyMcp(context, all, servers, { claudeNow: ['docs', 'search'] })), ['docs claude-cli written', 'docs codex-cli written']);
  // 4. Agents page, Apply all: reviewer everywhere; planner, whose model field only Claude Code has, one-way to the others.
  //    helper is left as found.
  const agents = [{ key: 'reviewer', managed: true, off: [] }, { key: 'planner', managed: true, off: [] }];
  assert.deepEqual(did(await applyAgents(context, all, agents)), ['planner codex-cli written', 'planner copilot-cli written', 'reviewer codex-cli written', 'reviewer copilot-cli written']);
  // 5. With Automatic sync on, notes edited in Claude Code; the next pass spreads it, with a History entry whose Undo puts
  //    back the content before.
  await put('.claude/skills/notes/SKILL.md', skill('notes', 'Write each note as one line, dated.'));
  assert.deepEqual(did(await applyChanges(context, []), await applyMcp(context, all, []), await applyAgents(context, all, [])),
    ['clash - held', 'notes codex-cli written', 'notes copilot-cli written']);
  // 6. Profiles page: Focus, every skill and server but drafts and search, made and switched to: their switches in Claude
  //    Code, the one tool that has them, go off.
  const made = await saveProfile(context, { name: 'Focus', items: ['skill:notes', 'skill:style', 'skill:clash', 'skill:scratch', 'mcp:docs', 'mcp:local-db'] });
  assert.ok(made.id, made.problem);
  const switched = await switchProfile(context, made.id);
  assert.deepEqual(switched.flips.map(flip => `${flip.item} ${flip.tool} ${flip.disabled ? 'off' : 'on'}`), ['skill:drafts claude-cli off', 'mcp:search claude-cli off']);
  // 7. Automatic sync off, then notes edited in Copilot CLI by hand; the app's pass with Sync off only looks.
  await put('.copilot/skills/notes/SKILL.md', skill('notes', 'Write each note as one line, dated, in Copilot CLI.'));
  assert.equal((await applyChanges(context, [], false, { observeOnly: true })).harnessWrites, 0);
}

async function alphaOne() {
  const { applySkills, skillsView } = await engine('skills.ts');
  const { applyMcp, mcpView } = await engine('mcp.ts');
  const { applyAgents, agentsView } = await engine('agents.ts');
  // Home A where it was made, and the app's memory of its sync record (kept in the app's data, not the home).
  await cp(join(here, 'preview-9'), HOME, { recursive: true });
  const { generation } = JSON.parse(await readFile(join(HOME, '.central-knot/sync.json'), 'utf8'));
  await writeFile(context.settingsPath, `${JSON.stringify({ homes: { [HOME]: { generation } } }, null, 2)}\n`);
  // 1. Opened once with Automatic sync on: alpha 1's pass (skills, MCP servers, agents; it puts skills and agents on its
  //    library and takes in the edit waiting in Copilot CLI), then the pages' reads.
  const all = await tools();
  assert.deepEqual(did(await applySkills(context, all, []), await applyMcp(context, all, []), await applyAgents(context, all, [])),
    ['notes claude-cli written', 'notes codex-cli written']);
  await skillsView(context, all);
  await mcpView(context, all);
  await agentsView(context, all);
  // 2. Automatic sync off, then notes edited in Codex by hand (alpha 1 runs no pass with Sync off).
  await put('.codex/skills/notes/SKILL.md', skill('notes', 'Write each note as one line, dated, in Codex.'));
}

await rm(dirname(HOME), { recursive: true, force: true });
await mkdir(APP_DATA, { recursive: true });
await (which === 'preview-9' ? previewNine() : alphaOne());
const out = join(here, which);
await rm(out, { recursive: true, force: true });
await cp(HOME, out, { recursive: true });
console.log(`made ${out}`);

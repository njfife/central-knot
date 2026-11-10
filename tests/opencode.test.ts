// OpenCode as a tool: what it reads, and what Central Knot writes for it. The forms here are the ones measured on OpenCode
// 1.19.5 and 2.2.5 in throwaway homes (LEDGER, 2026-11-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentsView, applyAgents } from '../src/agents.ts';
import { discover } from '../src/discovery.ts';
import { envOverride, harnesses } from '../src/harnesses.ts';
import { instructionsView } from '../src/instructions.ts';
import { applyChanges, manageView } from '../src/manage.ts';
import { applyMcp, mcpView, readTool } from '../src/mcp.ts';
import { mcpDisabled, withMcpSwitch } from '../src/mcpswitch.ts';
import { executableCandidates } from '../src/platform.ts';
import type { ShareContext } from '../src/share.ts';
import { readSwitchFile, switchState, switchedText } from '../src/skillswitch.ts';
import { readJsonc } from '../src/textedit.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'opencode-cli'];
const OPENCODE = '.config/opencode';
const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

async function sandbox(present: HarnessId[] = tools) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-opencode-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', OPENCODE]) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: () => Promise.all(present.map(harness => discover({ home, mode: 'custom', harness }))), build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
async function skill(home: string, root: string, folder: string, content = text(folder)) {
  await mkdir(join(home, root, folder), { recursive: true });
  await writeFile(join(home, root, folder, 'SKILL.md'), content);
}
const exists = (path: string) => lstat(path).then(() => true, () => false);
const settings = (home: string) => join(home, OPENCODE, 'opencode.json');

test('OpenCode is looked for where its installer puts it first, and its folder follows XDG_CONFIG_HOME', () => {
  assert.equal(executableCandidates('/h', '/usr/bin', 'opencode')[0], '/h/.opencode/bin/opencode');
  assert.equal(envOverride(harnesses['opencode-cli'], { XDG_CONFIG_HOME: '/x' }), '/x/opencode');
  assert.equal(envOverride(harnesses['opencode-cli'], {}), undefined);
  assert.equal(envOverride(harnesses['claude-cli'], { CLAUDE_CONFIG_DIR: '/c' }), '/c');
});

test('OpenCode reads its own skills, Claude Code’s and the shared folder; a skill it reads elsewhere gets no second copy', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, `${OPENCODE}/skills`, 'own');
    await skill(box.home, '.claude/skills', 'from-claude');
    await skill(box.home, '.agents/skills', 'shared');
    await skill(box.home, '.claude/skills', 'nameless', '---\ndescription: No name here.\n---\n\nBody.\n');
    const snapshot = await discover({ home: box.home, mode: 'custom', harness: 'opencode-cli' });
    assert.deepEqual(snapshot.skills.map(found => `${found.folder}: ${found.rootLabel}`).sort(), ['from-claude: Claude Code skills', 'nameless: Claude Code skills', 'own: OpenCode skills', 'shared: Shared .agents skills']);

    const view = await manageView(box.context);
    const fromClaude = view.skills.find(item => item.key === 'from-claude')!;
    assert.equal(fromClaude.copies['opencode-cli']!.directory, join(box.home, '.claude/skills/from-claude'));
    assert.deepEqual([fromClaude.copies['opencode-cli']!.writable, fromClaude.copies['opencode-cli']!.readsFrom], [false, 'claude-cli'], 'it is Claude Code’s copy, which OpenCode reads');
    assert.match(view.skills.find(item => item.key === 'nameless')!.cannot['opencode-cli']!, /OpenCode 1\.x will not load it: its frontmatter has no name/);

    // Managed in both: OpenCode already reads Claude Code's copy, so nothing is written for it.
    const first = await applyChanges(box.context, [{ key: 'from-claude', managed: true, off: [] }]);
    assert.equal(first.harnessWrites, 0, JSON.stringify(first.results));
    assert.equal(await exists(join(box.home, OPENCODE, 'skills/from-claude')), false);
    // OpenCode's own skill reaches Claude Code, whose copy OpenCode then reads too.
    const second = await applyChanges(box.context, [{ key: 'own', managed: true, off: [] }]);
    assert.equal(second.harnessWrites, 1, JSON.stringify(second.results));
    assert.equal(await readFile(join(box.home, '.claude/skills/own/SKILL.md'), 'utf8'), text('own'));
    assert.equal((await applyChanges(box.context, [])).harnessWrites, 0, 'settled');
    // An edit in OpenCode's own copy spreads to Claude Code's.
    await writeFile(join(box.home, OPENCODE, 'skills/own/SKILL.md'), text('own', 'Edited in OpenCode.'));
    const edited = await applyChanges(box.context, []);
    assert.equal(edited.harnessWrites, 1, JSON.stringify(edited.results));
    assert.equal(await readFile(join(box.home, '.claude/skills/own/SKILL.md'), 'utf8'), text('own', 'Edited in OpenCode.'));
  } finally { await box.cleanup(); }
});

test('The copy OpenCode reads in Claude Code’s folder is Claude Code’s: it blocks no choice, is never called older, and Remove says it still loads', async () => {
  const three: HarnessId[] = ['claude-cli', 'copilot-cli', 'opencode-cli'];
  const box = await sandbox(three);
  const said = (result: { results: { message: string }[] }) => result.results.map(entry => entry.message).join(' | ');
  try {
    // Copies that differ between Claude Code and Copilot CLI: Copilot's can be chosen, and OpenCode then reads it in Claude Code's folder.
    await skill(box.home, '.claude/skills', 'review', text('review', 'Claude Code’s.'));
    await skill(box.home, '.copilot/skills', 'review', text('review', 'Copilot’s.'));
    const review = (await manageView(box.context)).skills.find(item => item.key === 'review')!;
    assert.deepEqual(review.choiceBlocks['copilot-cli'], []);
    const chosen = await applyChanges(box.context, [{ key: 'review', managed: true, off: [], use: 'copilot-cli', useHash: review.copies['copilot-cli']!.hash }]);
    assert.equal(await readFile(join(box.home, '.claude/skills/review/SKILL.md'), 'utf8'), text('review', 'Copilot’s.'), said(chosen));
    assert.equal(await exists(join(box.home, OPENCODE, 'skills/review')), false, 'no second copy for OpenCode');
    // Choosing "OpenCode's" copy of a skill it reads in Claude Code's folder chooses Claude Code's.
    await skill(box.home, '.claude/skills', 'twin', text('twin', 'Claude Code’s.'));
    await skill(box.home, '.copilot/skills', 'twin', text('twin', 'Copilot’s.'));
    const twin = (await manageView(box.context)).skills.find(item => item.key === 'twin')!;
    await applyChanges(box.context, [{ key: 'twin', managed: true, off: [], use: 'opencode-cli', useHash: twin.copies['opencode-cli']!.hash }]);
    assert.equal(await readFile(join(box.home, '.copilot/skills/twin/SKILL.md'), 'utf8'), text('twin', 'Claude Code’s.'));

    // Claude Code left out of a managed skill: its copy goes stale, so OpenCode gets its own, and nothing is called older.
    await skill(box.home, '.claude/skills', 'notes');
    await applyChanges(box.context, [{ key: 'notes', managed: true, off: [] }]);
    assert.equal(await exists(join(box.home, OPENCODE, 'skills/notes')), false);
    await applyChanges(box.context, [{ key: 'notes', managed: true, off: ['claude-cli'] }]);
    assert.equal(await readFile(join(box.home, OPENCODE, 'skills/notes/SKILL.md'), 'utf8'), text('notes'));
    await writeFile(join(box.home, '.copilot/skills/notes/SKILL.md'), text('notes', 'Edited in Copilot.'));
    const edited = await applyChanges(box.context, []);
    assert.equal(await readFile(join(box.home, OPENCODE, 'skills/notes/SKILL.md'), 'utf8'), text('notes', 'Edited in Copilot.'), said(edited));
    assert.equal(await readFile(join(box.home, '.claude/skills/notes/SKILL.md'), 'utf8'), text('notes'), 'Claude Code’s copy is left alone');
    assert.doesNotMatch(said(edited), /older copy|does not change/);

    // Remove takes OpenCode's own copy out and says the skill still loads there from Claude Code's folder.
    await skill(box.home, `${OPENCODE}/skills`, 'own');
    await applyChanges(box.context, [{ key: 'own', managed: true, off: [] }]);
    const removed = await applyChanges(box.context, [{ key: 'own', managed: true, off: ['opencode-cli'], remove: ['opencode-cli'] }]);
    assert.equal(await exists(join(box.home, OPENCODE, 'skills/own')), false);
    assert.match(said(removed), /Removed from OpenCode\. Restore it from History\. OpenCode still reads Claude Code’s copy; Disable it in OpenCode/);
    // Remove asked of the copy it only reads is refused, with what does work.
    const refused = await applyChanges(box.context, [{ key: 'own', managed: true, off: ['opencode-cli'], remove: ['opencode-cli'] }]);
    assert.match(said(refused), /OpenCode reads Claude Code’s copy\. Disable it in OpenCode to stop it loading there, or remove it from Claude Code\./);

    // OpenCode's own copy of a managed skill deleted by hand: the deletion spreads, and nothing is left to remove by hand.
    await skill(box.home, `${OPENCODE}/skills`, 'gone');
    await applyChanges(box.context, [{ key: 'gone', managed: true, off: [] }]);
    await rm(join(box.home, OPENCODE, 'skills/gone'), { recursive: true });
    const first = await applyChanges(box.context, []);
    const second = await applyChanges(box.context, []);
    assert.deepEqual([await exists(join(box.home, '.claude/skills/gone')), await exists(join(box.home, '.copilot/skills/gone'))], [false, false], `${said(first)} / ${said(second)}`);
    assert.doesNotMatch(`${said(first)} ${said(second)}`, /Remove it yourself/);
  } finally { await box.cleanup(); }
});

test('OpenCode’s skill switch is a deny rule by name, written last so it decides; Enable takes out only that', async () => {
  const box = await sandbox();
  try {
    const target = { folder: 'alpha', name: 'alpha', skillFile: join(box.home, '.claude/skills/alpha/SKILL.md') };
    const state = (file: string) => switchState(box.context, 'opencode-cli', file, target);
    const flip = (file: string, disabled: boolean) => switchedText(box.context, 'opencode-cli', file, target, disabled).text;
    // No settings yet: the file is made with the rule alone, and Enable leaves it empty.
    assert.deepEqual(readJsonc(flip('', true)), { permission: { skill: { alpha: 'deny' } } });
    assert.deepEqual(readJsonc(flip(flip('', true), false)), {});
    // A wider rule after the skill's own would decide (the last match wins), so the skill's rule moves to the end.
    const wide = '{\n  // kept\n  "permission": { "skill": { "alpha": "deny", "*": "allow" }, "bash": "ask" },\n}\n';
    assert.equal(state(wide), false, 'the later "*" rule allows it');
    const off = flip(wide, true);
    assert.deepEqual(Object.entries((readJsonc(off) as { permission: { skill: Record<string, string> } }).permission.skill), [['*', 'allow'], ['alpha', 'deny']]);
    assert.ok(off.includes('// kept') && off.includes('"bash": "ask"'));
    assert.equal(state(off), true);
    assert.deepEqual((readJsonc(flip(off, false)) as { permission: unknown }).permission, { skill: { '*': 'allow' }, bash: 'ask' });
    // Every skill denied by a pattern: Enable gives this one its own rule after it.
    const denied = '{ "permission": { "skill": { "al*": "deny" } } }';
    assert.equal(state(denied), true);
    assert.deepEqual((readJsonc(flip(denied, false)) as { permission: { skill: unknown } }).permission.skill, { 'al*': 'deny', alpha: 'allow' });
    // Asked for what already holds, nothing changes: the person's other permission rules are not touched.
    const other = '{ "permission": { "bash": "ask" } }';
    assert.equal(flip(other, false), other);
    assert.equal(flip(off, true), off);
    // A "*" written after `skill` decides for every skill (measured on both lines), so `skill` moves after it to count.
    const late = '{ "permission": { "skill": { "alpha": "deny" }, "*": "allow" } }';
    assert.equal(state(late), false, 'the later "*" allows it');
    assert.deepEqual(Object.entries((readJsonc(flip(late, true)) as { permission: Record<string, unknown> }).permission), [['*', 'allow'], ['skill', { alpha: 'deny' }]]);
    assert.equal(state(flip(late, true)), true);
    assert.equal(state('{ "permission": { "*": "deny" } }'), true, 'every permission denied, skills too');
    // A rule's comment stays with it when another rule goes, and a rule already last changes its word in place.
    const noted = '{\n  "permission": {\n    "skill": {\n      // mine\n      "beta": "deny",\n      // about alpha\n      "alpha": "deny"\n    }\n  }\n}\n';
    assert.equal(flip(noted, false), '{\n  "permission": {\n    "skill": {\n      // mine\n      "beta": "deny"\n    }\n  }\n}\n');
    const wider = '{ "permission": { "skill": { "*": "deny", /* kept */ "alpha": "allow" } } }';
    assert.equal(flip(wider, true), wider.replace('"alpha": "allow"', '"alpha": "deny"'));
    // One word for every skill becomes a map that says the same.
    assert.deepEqual((readJsonc(flip('{ "permission": { "skill": "ask" } }', true)) as { permission: { skill: unknown } }).permission.skill, { '*': 'ask', alpha: 'deny' });
    // `permission` as one word has no place for a skill's rule: reported, never written.
    await writeFile(settings(box.home), '{ "permission": "allow" }\n');
    assert.match((await readSwitchFile(box.context, 'opencode-cli')).problem?.reason ?? '', /permission as one word/);
    // opencode.jsonc decides when both files are there, so it is the one read and written.
    await writeFile(join(box.home, OPENCODE, 'opencode.jsonc'), '{}\n');
    assert.equal((await readSwitchFile(box.context, 'opencode-cli')).path, join(box.home, OPENCODE, 'opencode.jsonc'));
  } finally { await box.cleanup(); }
});

test('OpenCode’s servers are read from both places in its settings, written in its own form, and switched where they are', async () => {
  const box = await sandbox();
  try {
    const before = `{
  // my settings
  "model": "a/b",
  "mcp": {
    "flat": { "type": "local", "command": ["npx", "-y", "flat"], "environment": { "TOKEN": "value-123" }, "cwd": "/work/flat", "timeout": 5000 },
    "web": { "type": "remote", "url": "https://example.com/mcp", "headers": { "X-Key": "k" }, "enabled": false },
    "servers": {
      "newer": { "type": "local", "command": ["newer"], "disabled": true },
    },
  },
}
`;
    await writeFile(settings(box.home), before);
    const read = await readTool(box.context, 'opencode-cli');
    assert.equal(read.problem, undefined);
    assert.deepEqual(read.entries.map(entry => [entry.name, entry.server, entry.extras]), [
      ['flat', { transport: 'stdio', command: 'npx', args: ['-y', 'flat'], env: { TOKEN: 'value-123' }, cwd: '/work/flat' }, { timeout: 5000 }],
      ['web', { transport: 'http', url: 'https://example.com/mcp', headers: { 'X-Key': 'k' } }, { enabled: false }],
      ['newer', { transport: 'stdio', command: 'newer', args: undefined, env: undefined, cwd: undefined }, { disabled: true }],
    ]);
    // Each place has its own off key: `enabled: false` under mcp, `disabled: true` under mcp.servers.
    assert.deepEqual(['flat', 'web', 'newer'].map(name => mcpDisabled('opencode-cli', before, name)), [false, true, true]);
    const flatOff = withMcpSwitch('opencode-cli', before, 'flat', true);
    assert.match(flatOff, /"timeout": 5000,\s*"enabled": false/);
    assert.equal(withMcpSwitch('opencode-cli', flatOff, 'flat', false), before, 'on again: every byte as it was');
    const newerOn = withMcpSwitch('opencode-cli', before, 'newer', false);
    assert.deepEqual((readJsonc(newerOn) as { mcp: { servers: { newer: unknown } } }).mcp.servers.newer, { type: 'local', command: ['newer'] });
    assert.match(withMcpSwitch('opencode-cli', newerOn, 'newer', true), /"disabled": true/);
    assert.throws(() => withMcpSwitch('opencode-cli', before, 'gone', true), /no "gone" server/);

    // A Claude Code server reaches OpenCode in OpenCode's form, values as they are; the rest of the file stays.
    await writeFile(join(box.home, '.claude.json'), `${JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['-y', 'docs'], env: { DOCS_TOKEN: 'secret-value-123' }, cwd: '/work/docs' }, sse: { type: 'sse', url: 'https://example.com/sse' } } }, null, 2)}\n`);
    const result = await applyMcp(box.context, tools, [{ key: 'docs', managed: true, off: [] }]);
    assert.equal(result.writes, 1, JSON.stringify(result.results));
    const after = await readFile(settings(box.home), 'utf8');
    assert.deepEqual((readJsonc(after) as { mcp: Record<string, unknown> }).mcp.docs, { type: 'local', command: ['npx', '-y', 'docs'], environment: { DOCS_TOKEN: 'secret-value-123' }, cwd: '/work/docs' });
    assert.ok(after.includes('// my settings') && after.includes('"timeout": 5000') && after.includes('"newer": { "type": "local", "command": ["newer"], "disabled": true }'));
    assert.equal((await applyMcp(box.context, tools, [])).writes, 0, 'a repeat writes nothing');
    const view = await mcpView(box.context, tools);
    assert.match(view.servers.find(server => server.key === 'sse')!.cannot['opencode-cli'] ?? '', /no SSE/);
    assert.deepEqual(view.servers.find(server => server.key === 'web')!.disabled, ['opencode-cli']);
    // An entry under mcp.servers is edited where it is, never made again under mcp.
    const edited = (await readTool(box.context, 'opencode-cli')).entries.find(entry => entry.name === 'newer')!;
    assert.equal(edited.file, settings(box.home));
    await writeFile(settings(box.home), '');
    assert.deepEqual([(await readTool(box.context, 'opencode-cli')).problem, (await readTool(box.context, 'opencode-cli')).entries], [undefined, []], 'an empty file has no servers');
    // A file that isn't JSON is reported and never written.
    await writeFile(settings(box.home), '{ "mcp": ');
    assert.match((await readTool(box.context, 'opencode-cli')).problem ?? '', /could not be read as JSON/);
  } finally { await box.cleanup(); }
});

test('An agent goes to OpenCode as Markdown named by its file, with a mode both of its lines read the same way', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.claude/agents'), { recursive: true });
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), '---\nname: reviewer\ndescription: Reviews code\n---\n\nYou review code.\n');
    const result = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.equal(result.writes, 1, JSON.stringify(result.results));
    const file = join(box.home, OPENCODE, 'agents/reviewer.md');
    assert.equal(await readFile(file, 'utf8'), '---\nname: reviewer\ndescription: Reviews code\nmode: all\n---\n\nYou review code.\n');
    // An edit in OpenCode comes back, and OpenCode's own fields stay in its file.
    await writeFile(file, '---\nname: reviewer\ndescription: Reviews code well\nmode: subagent\nmodel: a/b\n---\n\nYou review code.\n');
    assert.equal((await applyAgents(box.context, tools, [])).writes, 1);
    assert.match(await readFile(join(box.home, '.claude/agents/reviewer.md'), 'utf8'), /description: Reviews code well/);
    assert.match(await readFile(file, 'utf8'), /mode: subagent\nmodel: a\/b/);
    assert.deepEqual((await agentsView(box.context, tools)).tools, tools);
  } finally { await box.cleanup(); }
});

test('OpenCode’s instruction file is AGENTS.md in its own folder', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, OPENCODE, 'AGENTS.md'), 'Be brief.\n');
    const files = await instructionsView(box.context, await box.context.read());
    const mine = files.find(file => file.tool === 'opencode-cli')!;
    assert.equal(mine.path, join(box.home, OPENCODE, 'AGENTS.md'));
    assert.equal(mine.text, 'Be brief.\n');
    assert.deepEqual(mine.notes, []);
    // With no AGENTS.md, OpenCode 1.x reads Claude Code's CLAUDE.md: the card says so, and what saving here changes.
    await rm(join(box.home, OPENCODE, 'AGENTS.md'));
    await writeFile(join(box.home, '.claude/CLAUDE.md'), 'Claude Code’s own.\n');
    assert.match((await instructionsView(box.context, await box.context.read())).find(file => file.tool === 'opencode-cli')!.notes.join(' '), /OpenCode 1\.x reads Claude Code’s CLAUDE\.md instead/);
  } finally { await box.cleanup(); }
});

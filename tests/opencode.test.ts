// OpenCode as a tool: what it reads, and what Central Knot writes for it. The forms here are the ones measured on OpenCode
// 1.19.5 and 2.2.5 in throwaway homes (LEDGER, 2026-11-10).
import { test } from 'node:test';
import { itemNotice } from './notices.ts';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentsView, applyAgents } from '../src/agents.ts';
import { discover, findOtherApps } from '../src/discovery.ts';
import { envOverride, harnesses } from '../src/harnesses.ts';
import { instructionsView } from '../src/instructions.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { readTool } from '../src/mcp.ts';
import { applyServers, serversView } from '../src/servers.ts';
import { mcpDisabled, withMcpSwitch } from '../src/mcpswitch.ts';
import { appCandidates, executableCandidates } from '../src/platform.ts';
import type { ShareContext } from '../src/share.ts';
import { isDisabled, readSwitchFile, setDisabled } from '../src/skillswitch.ts';
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

    const view = await skillsView(box.context, tools);
    const fromClaude = view.items.find(item => item.key === 'from-claude')!;
    assert.deepEqual(Object.keys(fromClaude.copies), ['claude-cli'], 'Claude Code’s copy is Claude Code’s, which OpenCode reads');
    assert.match(fromClaude.anotherWay?.['opencode-cli'] ?? '', /^OpenCode reads Claude Code’s copy/);
    assert.match(view.items.find(item => item.key === 'shared')!.anotherWay?.['opencode-cli'] ?? '', /also reads a copy at .*\.agents\/skills, which is not Central Knot’s/);

    // Taken in, on in both: OpenCode already reads Claude Code's copy, so nothing is written for it.
    const first = await applySkills(box.context, tools, [{ key: 'from-claude', managed: true, off: [] }]);
    assert.equal(first.writes, 0, JSON.stringify(first.results));
    assert.equal(await exists(join(box.home, OPENCODE, 'skills/from-claude')), false);
    // OpenCode's own skill reaches Claude Code, whose copy OpenCode then reads too; its own copy, never Central Knot's, stays.
    const second = await applySkills(box.context, tools, [{ key: 'own', managed: true, off: [] }]);
    assert.equal(second.writes, 1, JSON.stringify(second.results));
    assert.equal(await readFile(join(box.home, '.claude/skills/own/SKILL.md'), 'utf8'), text('own'));
    assert.equal(await readFile(join(box.home, OPENCODE, 'skills/own/SKILL.md'), 'utf8'), text('own'));
    assert.equal((await applySkills(box.context, tools, [])).writes, 0, 'settled');
    // An edit in Claude Code's copy is the skill's; OpenCode reads it there.
    await writeFile(join(box.home, '.claude/skills/own/SKILL.md'), text('own', 'Edited in Claude Code.'));
    const edited = await applySkills(box.context, tools, []);
    assert.deepEqual(edited.notices?.map(itemNotice).map(notice => notice.winner), ['claude-cli']);
  } finally { await box.cleanup(); }
});

test('Kept out of Claude Code, a skill OpenCode read there becomes a copy of OpenCode’s own; let back in, that copy goes, so it is loaded once', async () => {
  const three: HarnessId[] = ['claude-cli', 'copilot-cli', 'opencode-cli'];
  const box = await sandbox(three);
  try {
    // Copies that differ between Claude Code and Copilot CLI: Copilot's is chosen, and OpenCode then reads it in Claude Code's folder.
    await skill(box.home, '.claude/skills', 'review', text('review', 'Claude Code’s.'));
    await skill(box.home, '.copilot/skills', 'review', text('review', 'Copilot’s.'));
    assert.deepEqual((await skillsView(box.context, three)).items.find(item => item.key === 'review')!.takeInAnswers?.click, { wait: 'choice' });
    await applySkills(box.context, three, [{ key: 'review', managed: true, off: [], use: 'copilot-cli' }]);
    assert.equal(await readFile(join(box.home, '.claude/skills/review/SKILL.md'), 'utf8'), text('review', 'Copilot’s.'));
    assert.equal(await exists(join(box.home, OPENCODE, 'skills/review')), false, 'no second copy for OpenCode');

    // Kept out of Claude Code: its copy goes, OpenCode gets its own, and an edit in Copilot CLI reaches it.
    await skill(box.home, '.claude/skills', 'notes');
    await applySkills(box.context, three, [{ key: 'notes', managed: true, off: [] }]);
    await applySkills(box.context, three, [{ key: 'notes', managed: true, off: ['claude-cli'] }]);
    assert.deepEqual([await exists(join(box.home, '.claude/skills/notes')), await readFile(join(box.home, OPENCODE, 'skills/notes/SKILL.md'), 'utf8')], [false, text('notes')]);
    await writeFile(join(box.home, '.copilot/skills/notes/SKILL.md'), text('notes', 'Edited in Copilot.'));
    await applySkills(box.context, three, []);
    assert.equal(await readFile(join(box.home, OPENCODE, 'skills/notes/SKILL.md'), 'utf8'), text('notes', 'Edited in Copilot.'));
    // Let back in: Claude Code gets the current version, and OpenCode's own copy, Central Knot's, goes.
    await applySkills(box.context, three, [{ key: 'notes', managed: true, off: [] }]);
    assert.deepEqual([await readFile(join(box.home, '.claude/skills/notes/SKILL.md'), 'utf8'), await exists(join(box.home, OPENCODE, 'skills/notes'))], [text('notes', 'Edited in Copilot.'), false]);

    // OpenCode's own copy, Central Knot's (Claude Code kept out), deleted by hand: the skill turns off everywhere.
    await skill(box.home, '.claude/skills', 'gone');
    await applySkills(box.context, three, [{ key: 'gone', managed: true, off: [] }]);
    await applySkills(box.context, three, [{ key: 'gone', managed: true, off: ['claude-cli'] }]);
    assert.equal(await exists(join(box.home, OPENCODE, 'skills/gone/SKILL.md')), true);
    await rm(join(box.home, OPENCODE, 'skills/gone'), { recursive: true });
    await applySkills(box.context, three, []);
    assert.equal((await skillsView(box.context, three)).library.gone.on, false);
    assert.equal(await exists(join(box.home, '.copilot/skills/gone')), false);
  } finally { await box.cleanup(); }
});

test('A skill new to both Claude Code and OpenCode goes to Claude Code’s folder only, where OpenCode reads it', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'opencode-cli']);
  const three: HarnessId[] = ['claude-cli', 'copilot-cli', 'opencode-cli'];
  try {
    await skill(box.home, '.copilot/skills', 'fresh');
    const result = await applySkills(box.context, three, [{ key: 'fresh', managed: true, off: [] }]);
    assert.equal(result.writes, 1, JSON.stringify(result.results));
    assert.deepEqual([await exists(join(box.home, '.claude/skills/fresh/SKILL.md')), await exists(join(box.home, OPENCODE, 'skills/fresh'))], [true, false]);
    assert.match((await skillsView(box.context, three)).items.find(item => item.key === 'fresh')!.anotherWay?.['opencode-cli'] ?? '', /reads Claude Code’s copy/);
    assert.equal((await applySkills(box.context, three, [])).writes, 0, 'settled');
  } finally { await box.cleanup(); }
});

test('OpenCode’s skill switch is a deny rule by name, written last so it decides; Enable takes out only that', async () => {
  const box = await sandbox();
  try {
    const target = { folder: 'alpha', name: 'alpha', skillFile: join(box.home, '.claude/skills/alpha/SKILL.md') };
    // The settings file holding `text`: whether it turns alpha off, and what it holds once alpha is turned off or on.
    const state = async (text: string) => { await writeFile(settings(box.home), text); return isDisabled(box.context, await readSwitchFile(box.context, 'opencode-cli'), target); };
    const flip = async (text: string, disabled: boolean) => { await writeFile(settings(box.home), text); await setDisabled(box.context, 'opencode-cli', target, disabled); return readFile(settings(box.home), 'utf8'); };
    // Empty settings: the rule alone, and Enable leaves them empty.
    assert.deepEqual(readJsonc(await flip('', true)), { permission: { skill: { alpha: 'deny' } } });
    assert.deepEqual(readJsonc(await flip(await flip('', true), false)), {});
    // A wider rule after the skill's own would decide (the last match wins), so the skill's rule moves to the end.
    const wide = '{\n  // kept\n  "permission": { "skill": { "alpha": "deny", "*": "allow" }, "bash": "ask" },\n}\n';
    assert.equal(await state(wide), false, 'the later "*" rule allows it');
    const off = await flip(wide, true);
    assert.deepEqual(Object.entries((readJsonc(off) as { permission: { skill: Record<string, string> } }).permission.skill), [['*', 'allow'], ['alpha', 'deny']]);
    assert.ok(off.includes('// kept') && off.includes('"bash": "ask"'));
    assert.equal(await state(off), true);
    assert.deepEqual((readJsonc(await flip(off, false)) as { permission: unknown }).permission, { skill: { '*': 'allow' }, bash: 'ask' });
    // Every skill denied by a pattern: Enable gives this one its own rule after it.
    const denied = '{ "permission": { "skill": { "al*": "deny" } } }';
    assert.equal(await state(denied), true);
    assert.deepEqual((readJsonc(await flip(denied, false)) as { permission: { skill: unknown } }).permission.skill, { 'al*': 'deny', alpha: 'allow' });
    // Asked for what already holds, nothing changes: the person's other permission rules are not touched.
    const other = '{ "permission": { "bash": "ask" } }';
    assert.equal(await flip(other, false), other);
    assert.equal(await flip(off, true), off);
    // A "*" written after `skill` decides for every skill (measured on both lines). A rule for one skill would count only if
    // `skill` moved after it, which would make the rules it overrules count again: reported, never edited.
    await writeFile(settings(box.home), '{ "permission": { "skill": { "beta": "deny" }, "*": "allow" } }\n');
    assert.match((await readSwitchFile(box.context, 'opencode-cli')).problem?.reason ?? '', /a rule after skill in permission that decides for every skill/);
    assert.equal(isDisabled(box.context, await readSwitchFile(box.context, 'opencode-cli'), target), false);
    // What such a file turns off is still read, so the page shows it: here every skill is off.
    await writeFile(settings(box.home), '{ "permission": { "skill": { "alpha": "allow" }, "*": "deny" } }\n');
    assert.equal(isDisabled(box.context, await readSwitchFile(box.context, 'opencode-cli'), target), true);
    assert.equal(await state('{ "permission": { "*": "deny" } }'), true, 'every permission denied, skills too');
    // A rule's comment stays with it when another rule goes, and a rule already last changes its word in place.
    const noted = '{\n  "permission": {\n    "skill": {\n      // mine\n      "beta": "deny",\n      // about alpha\n      "alpha": "deny"\n    }\n  }\n}\n';
    assert.equal(await flip(noted, false), '{\n  "permission": {\n    "skill": {\n      // mine\n      "beta": "deny"\n    }\n  }\n}\n');
    const wider = '{ "permission": { "skill": { "*": "deny", /* kept */ "alpha": "allow" } } }';
    assert.equal(await flip(wider, true), wider.replace('"alpha": "allow"', '"alpha": "deny"'));
    // One word for every skill becomes a map that says the same.
    assert.deepEqual((readJsonc(await flip('{ "permission": { "skill": "ask" } }', true)) as { permission: { skill: unknown } }).permission.skill, { '*': 'ask', alpha: 'deny' });
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
    const result = await applyServers(box.context, tools, [{ key: 'docs', managed: true, off: [] }]);
    assert.equal(result.writes, 1, JSON.stringify(result.results));
    const after = await readFile(settings(box.home), 'utf8');
    assert.deepEqual((readJsonc(after) as { mcp: Record<string, unknown> }).mcp.docs, { type: 'local', command: ['npx', '-y', 'docs'], environment: { DOCS_TOKEN: 'secret-value-123' }, cwd: '/work/docs' });
    assert.ok(after.includes('// my settings') && after.includes('"timeout": 5000') && after.includes('"newer": { "type": "local", "command": ["newer"], "disabled": true }'));
    assert.equal((await applyServers(box.context, tools, [])).writes, 0, 'a repeat writes nothing');
    const view = await serversView(box.context, tools);
    assert.match(view.items.find(server => server.key === 'sse')!.cannot['opencode-cli'] ?? '', /no SSE/);
    assert.deepEqual(view.items.find(server => server.key === 'web')!.switchedOff, ['opencode-cli']);
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

test('pi-gui is found as Pi’s desktop app, and T3 Code as an app that runs the tools, each by its own version', async () => {
  const box = await sandbox();
  const plist = (version: string) => `<plist><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`;
  try {
    for (const [name, version] of [['pi-gui.app', '0.4.0'], ['T3 Code (Nightly).app', '0.1.9']]) {
      await mkdir(join(box.home, 'Applications', name, 'Contents'), { recursive: true });
      await writeFile(join(box.home, 'Applications', name, 'Contents/Info.plist'), plist(version));
    }
    const pi = await discover({ home: box.home, mode: 'actual', harness: 'pi-cli', runProbes: true, binaries: [], apps: appCandidates(box.home, 'pi') });
    assert.deepEqual([pi.detection, pi.app], ['App only', { name: 'pi-gui (third-party)', version: '0.4.0', carries: 'Pi' }]);
    assert.deepEqual((await findOtherApps(box.home)).find(app => app.name === 'T3 Code')?.version, '0.1.9');
  } finally { await box.cleanup(); }
});

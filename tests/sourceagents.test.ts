// Agents from a link, on real folders and made-up Git repositories standing in for links (tests/sourcerepo.ts: nothing
// reaches the network): what at a link is an agent and what never is (atlink.ts agentsAt), its name, a broken file, two
// files of one name, a skill and an agent of one name at one source, "read whole" per kind, each tool's own fields from a
// source (library.ts A SOURCE, EACH TOOL'S OWN FIELDS) with both of their costs, no false change once it is On, and Merge
// (merge.ts mergeAgent). Skills from a link, and each row of the source's table, are tests/sources.test.ts's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { agentHash, parseAgent } from '../src/agentfiles.ts';
import { agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import type { LibraryItem } from '../src/library.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { addSource, checkSource, previewSource, rowClick, sourcesView } from '../src/sources.ts';
import type { SourcePreview, SourceResult } from '../src/types.ts';
import { sandbox as agentSandbox } from './agentclicks.ts';
import { repository, skillMd, standInHosts } from './sourcerepo.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

/** Where each tool of the test home keeps an agent: its folder and its file's suffix (Pi: a skill in its skills folder). */
const kept = { 'claude-cli': ['.claude/agents', '.md'], 'copilot-cli': ['.copilot/agents', '.agent.md'], 'codex-cli': ['.codex/agents', '.toml'], 'pi-cli': ['.pi/agent/skills', '.md'] } as const;
type Tool = keyof typeof kept;
/** A home with Claude Code, Copilot CLI and Codex (and Pi `withPi`), each with its agents folder and its skills folder. */
async function sandbox(withPi = false) {
  const box = await agentSandbox(withPi);
  for (const root of ['.claude/skills', '.copilot/skills', '.codex/skills']) await mkdir(join(box.home, root), { recursive: true });
  return box;
}
type Box = Awaited<ReturnType<typeof sandbox>>;
const fileOf = (box: Box, tool: Tool, name: string) => join(box.home, kept[tool][0], `${name}${kept[tool][1]}`);
const inTool = (box: Box, tool: Tool, name: string) => readFile(fileOf(box, tool, name), 'utf8').catch(() => undefined);

/** A Claude Code agent's file: front matter (`name`, `description`, then `more`), a blank line, its prompt. */
const agentMd = (name: string, prompt = `You are ${name}.\n`, more = '') => `---\nname: ${name}\ndescription: ${name} for tests.\n${more}---\n\n${prompt}`;

/** Looks at a link, then adds it, as the page's Look then Add do. */
async function add(box: Box, link: string) {
  const look = await previewSource(box.context, box.tools, link) as Extract<SourcePreview, { token: string }>;
  assert.ok('token' in look && !look.refused, `the look is refused: ${look.refused}`);
  return { look, added: await addSource(box.context, box.tools, look.token) };
}
const check = (box: Box, id: string) => checkSource(box.context, async () => box.tools, id, work => work());
const sourceOf = async (box: Box) => (await sourcesView(box.context, box.tools)).sources[0];
/** An agent as the Agents page reads it: its row's facts and its item. */
async function agent(box: Box, key: string): Promise<{ fact?: Awaited<ReturnType<typeof agentsView>>['items'][number]; item?: LibraryItem }> {
  const view = await agentsView(box.context, box.tools);
  return { fact: view.items.find(entry => entry.key === key), item: view.library[key] };
}
const turn = (box: Box, key: string, on: boolean) => applyAgents(box.context, box.tools, [{ key, on, except: [], seenOn: !on }]);
/** What a source's click did, by kind and name (the History entry each names is left out). */
const answered = (result: SourceResult) => (result.sourced ?? []).map(({ kind, name, answer }) => `${kind} ${name}: ${answer}`);
/** A source's lines, as kind, name and state. */
const linesOf = (found: { names: { kind: string; name?: string; key: string; state: string }[] }) => found.names.map(name => `${name.kind} ${name.name ?? name.key}: ${name.state}`);

// ---------- What at a link is an agent ----------

test('What at a link is an agent: a file in an agents folder of each tool’s form, a loose *.agent.md, a loose .md naming both fields; never a README, a page, a command or a file in another folder; a .mcp.json beside them holds a server', async () => {
  const repo = await repository(hosts, 'https://github.com/team/kit');
  await repo.commit({
    'agents/reviewer.md': '---\nname: reviewer\n---\n\nReview.\n',
    'agents/index.md': '# The agents\n\nA page with no front matter.\n',
    '.github/agents/helper.agent.md': agentMd('helper'),
    '.github/agents/notes.md': agentMd('notes'),
    '.codex/agents/coder.toml': 'name = "coder"\ndescription = "Codes"\ndeveloper_instructions = """\nCode.\n"""\n',
    '.opencode/agent/planner.md': agentMd('planner'),
    'writer.md': agentMd('writer'),
    'scout.agent.md': '---\ndescription: Scouts\n---\nScout.\n',
    'TEMPLATE.md': agentMd('template'),
    'titled.md': '---\ntitle: A page\n---\nText.\n',
    'guide.md': '# A guide\n',
    'README.md': agentMd('readme'),
    'CLAUDE.md': agentMd('claude'), 'AGENTS.md': agentMd('agents'), 'CHANGELOG.md': agentMd('changes'),
    'commands/go.md': agentMd('go'), 'docs/page.md': agentMd('page'), 'prompts/ask.md': agentMd('ask'),
    '.mcp.json': '{"mcpServers":{"docs":{"command":"docs-server"}}}',
  });
  const box = await sandbox();
  try {
    const look = await previewSource(box.context, box.tools, 'https://github.com/team/kit') as Extract<SourcePreview, { token: string }>;
    assert.equal(look.refused, undefined);
    // Agents folders first, in agentsAt's order, then the loose files by name.
    assert.deepEqual(look.names.map(name => [name.kind, name.name, name.there?.folder, name.there?.files, name.state]), [
      ['agent', 'reviewer', 'agents', ['reviewer.md'], 'make'],
      ['agent', 'helper', '.github/agents', ['helper.agent.md'], 'make'],
      ['agent', 'planner', '.opencode/agent', ['planner.md'], 'make'],
      ['agent', 'coder', '.codex/agents', ['coder.toml'], 'make'],
      // The named cost of the loose rule: a root page that names both fields is an agent, listed before Add, and comes in Off.
      ['agent', 'TEMPLATE', '', ['TEMPLATE.md'], 'make'],
      ['agent', 'scout', '', ['scout.agent.md'], 'make'],
      ['agent', 'writer', '', ['writer.md'], 'make'],
      ['mcp', 'docs', '', ['.mcp.json'], 'make'],
    ]);
    // A link straight at the agents folder: each Markdown file there with front matter is an agent, no field asked.
    const folder = await previewSource(box.context, box.tools, 'https://github.com/team/kit/tree/main/agents') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(linesOf(folder), ['agent reviewer: make']);
  } finally { await box.cleanup(); }
});

test('A skill repository whose reference files have front matter brings its skill alone; so does a link whose folder is one skill and also has an agents folder', async () => {
  const repo = await repository(hosts, 'https://github.com/team/review-skill');
  await repo.commit({ 'SKILL.md': skillMd('review'), 'references/style.md': agentMd('style'), 'agents/helper.md': agentMd('helper'), 'notes.md': agentMd('notes') });
  const box = await sandbox();
  try {
    const look = await previewSource(box.context, box.tools, 'https://github.com/team/review-skill') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(linesOf(look), ['skill review: make'], 'every file there is inside the skill’s folder');
    const many = await repository(hosts, 'https://github.com/team/skills');
    await many.commit({ 'skills/pdf/SKILL.md': skillMd('pdf'), 'skills/pdf/references/forms.md': agentMd('forms'), 'agents/SKILL.md': skillMd('agents-skill') });
    // agents/ is a skill's folder here (its SKILL.md), so nothing in it is an agent.
    assert.deepEqual(linesOf(await previewSource(box.context, box.tools, 'https://github.com/team/skills') as Extract<SourcePreview, { token: string }>), ['skill agents-skill: make']);
  } finally { await box.cleanup(); }
});

test('A link straight at a commands folder brings each command that names name and description in as an agent, Off; deleting one keeps it out', async () => {
  const repo = await repository(hosts, 'https://github.com/team/commands');
  await repo.commit({ 'commands/ship.md': agentMd('ship'), 'commands/help.md': '---\ndescription: Help\n---\nHelp.\n' });
  const box = await sandbox();
  try {
    const { look, added } = await add(box, 'https://github.com/team/commands/tree/main/commands');
    assert.deepEqual(linesOf(look), ['agent ship: make']);
    assert.deepEqual(answered(added), ['agent ship: make']);
    assert.deepEqual([(await agent(box, 'ship')).item?.on, await inTool(box, 'claude-cli', 'ship')], [false, undefined], 'Off: in no tool');
    await applyAgents(box.context, box.tools, [{ key: 'ship', on: false, except: [], deleted: true }]);
    const again = await check(box, (await sourceOf(box)).id);
    assert.deepEqual(answered(again), ['agent ship: deleted'], 'a deleted name is not brought in again: its line says why');
    assert.deepEqual(linesOf(await sourceOf(box)), ['agent ship: deleted']);
  } finally { await box.cleanup(); }
});

test('A look that finds nothing says only what it looked for: agents in a folder inside agents/, and Codex files kept in agents/, are named as not read there', async () => {
  const repo = await repository(hosts, 'https://github.com/team/nested');
  await repo.commit({ 'agents/review/reviewer.md': agentMd('reviewer'), 'agents/coder.toml': 'name = "coder"\ndeveloper_instructions = "Code."\n', 'README.md': '# Nested\n' });
  const box = await sandbox();
  try {
    const look = await previewSource(box.context, box.tools, 'https://github.com/team/nested');
    assert.equal(look.refused, 'No skill, agent or MCP server at its root: no SKILL.md there, in a folder inside it, or in skills/; no agent loose there or one level inside an agents folder'
      + ' (.md files; *.agent.md in .github/agents, *.toml in .codex/agents), and a folder inside an agents folder is read only from a link to it; no .mcp.json there.');
    // The way the sentence names: a link to that folder reads it.
    assert.deepEqual(linesOf(await previewSource(box.context, box.tools, 'https://github.com/team/nested/tree/main/agents/review') as Extract<SourcePreview, { token: string }>), ['agent reviewer: make']);
  } finally { await box.cleanup(); }
});

// ---------- Its name ----------

test('An agent’s key and name are its file’s base name, never its front matter’s name: reviewer.md naming code-reviewer is the agent reviewer, written as reviewer.md and read back under its key', async () => {
  const repo = await repository(hosts, 'https://github.com/team/named');
  const source = agentMd('code-reviewer', 'You review code.\nBe brief.\n', 'tools: Read, Grep\n');
  await repo.commit({ 'agents/reviewer.md': source });
  const box = await sandbox();
  try {
    const { look } = await add(box, 'https://github.com/team/named');
    assert.deepEqual(linesOf(look), ['agent reviewer: make']);
    assert.deepEqual([(await agent(box, 'reviewer')).item?.name, (await agent(box, 'code-reviewer')).item], ['reviewer', undefined]);
    await turn(box, 'reviewer', true);
    assert.equal(await inTool(box, 'claude-cli', 'reviewer'), source, 'Claude Code gets the source’s file, under its name');
    assert.equal(await inTool(box, 'claude-cli', 'code-reviewer'), undefined);
    // Read back under the same key: a pass finds every copy current, and nothing reads as deleted by hand.
    const passed = await applyAgents(box.context, box.tools, [], { background: true });
    const { item } = await agent(box, 'reviewer');
    assert.deepEqual([passed.writes, item?.on, Object.keys(item?.applied ?? {}).sort()], [0, true, ['claude-cli', 'codex-cli', 'copilot-cli']]);
    assert.equal(parseAgent('copilot-cli', 'reviewer', (await inTool(box, 'copilot-cli', 'reviewer'))!)?.name, 'code-reviewer', 'the front matter’s name stays in the shared part');
  } finally { await box.cleanup(); }
});

// ---------- A broken file is never gone ----------

test('A broken file is unreadable and never gone: an agent whose front matter breaks at a later read, and a loose agent with a YAML typo, turn nothing Off', async () => {
  const repo = await repository(hosts, 'https://github.com/team/broken');
  await repo.commit({ 'agents/reviewer.md': agentMd('reviewer'), 'writer.md': agentMd('writer') });
  const box = await sandbox();
  try {
    await add(box, 'https://github.com/team/broken');
    await turn(box, 'reviewer', true);
    await turn(box, 'writer', true);
    await repo.commit({ 'agents/reviewer.md': '---\nname: [reviewer\n---\nBroken.\n', 'writer.md': '---\nname: writer\ndescription: "unclosed\n---\nBroken.\n' });
    const done = await check(box, (await sourceOf(box)).id);
    // Nothing there can be read, so no kind was read whole (library.ts "Read whole").
    assert.deepEqual([done.notWhole, answered(done)], [['skill', 'agent', 'mcp'], []]);
    const lines = (await sourceOf(box)).names;
    assert.deepEqual(lines.map(name => [name.name, name.state]), [['reviewer', 'unreadable'], ['writer', 'unreadable']]);
    assert.match(lines[0].why ?? '', /^agents\/reviewer\.md can’t be read as an agent \(/);
    assert.deepEqual([(await agent(box, 'reviewer')).item?.on, (await agent(box, 'writer')).item?.on], [true, true]);
    assert.ok(await inTool(box, 'claude-cli', 'writer'), 'and nothing is taken out of a tool');
  } finally { await box.cleanup(); }
});

test('Gone, and said: a loose file whose front matter parses but no longer names both fields, and an agent whose front matter is taken out, turn Off and are told; an agents/index.md page holds nothing back', async () => {
  const repo = await repository(hosts, 'https://github.com/team/gone');
  // keeper stays, so the source holds an agent that can be read (library.ts "Read whole").
  await repo.commit({ 'agents/reviewer.md': agentMd('reviewer'), 'agents/keeper.md': agentMd('keeper'), 'agents/index.md': '# Agents\n', 'writer.md': agentMd('writer') });
  const box = await sandbox();
  try {
    await add(box, 'https://github.com/team/gone');
    await turn(box, 'reviewer', true);
    await turn(box, 'writer', true);
    await repo.commit({ 'agents/reviewer.md': 'You are reviewer, now a page.\n', 'writer.md': '---\nname: writer\n---\nNow a note.\n' });
    const done = await check(box, (await sourceOf(box)).id);
    assert.deepEqual([done.notWhole, answered(done).sort()], [undefined, ['agent reviewer: drop', 'agent writer: drop']]);
    for (const key of ['reviewer', 'writer']) {
      const { fact, item } = await agent(box, key);
      assert.deepEqual([item?.on, item?.source, fact?.fromSource?.removed], [false, undefined, true], `${key} is Off, no longer linked, and its row says the source removed it`);
    }
    assert.equal(await inTool(box, 'claude-cli', 'writer'), undefined, 'taken out of the tools, as any Off agent');
    await turn(box, 'writer', true);
    assert.deepEqual([(await agent(box, 'writer')).item?.on, (await agent(box, 'writer')).fact?.fromSource], [true, undefined], 'turning it On is the revert');
  } finally { await box.cleanup(); }
});

// ---------- Two of one name ----------

test('Two files of one name: in one tool’s form both are left out; in two tools’ forms with one shared part they are one agent with each file its tool’s own part; differing, both are left out', async () => {
  const box = await sandbox();
  try {
    const one = await repository(hosts, 'https://github.com/team/twice');
    await one.commit({ 'agents/reviewer.md': agentMd('reviewer'), 'reviewer.md': agentMd('reviewer') });
    const look = await previewSource(box.context, box.tools, 'https://github.com/team/twice') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(look.names.map(name => [name.name, name.state, name.why, name.there?.files]), [['reviewer', 'leftOut', 'two files here are named reviewer in Claude Code’s form', ['agents/reviewer.md', 'reviewer.md']]]);

    const forms = await repository(hosts, 'https://github.com/team/forms');
    const claude = agentMd('reviewer', 'Review.\n', 'tools: Read\n'), copilot = agentMd('reviewer', 'Review.\n', 'target: vscode\n');
    await forms.commit({ 'agents/reviewer.md': claude, '.github/agents/reviewer.agent.md': copilot });
    const { look: both } = await add(box, 'https://github.com/team/forms');
    assert.deepEqual(both.names.map(name => [name.name, name.state, name.there?.folder, name.there?.files]), [['reviewer', 'make', '', ['agents/reviewer.md', '.github/agents/reviewer.agent.md']]]);
    await turn(box, 'reviewer', true);
    assert.deepEqual([await inTool(box, 'claude-cli', 'reviewer'), await inTool(box, 'copilot-cli', 'reviewer')], [claude, copilot], 'each tool gets its own form’s file, byte for byte');

    const differ = await repository(hosts, 'https://github.com/team/differ');
    await differ.commit({ 'agents/reviewer.md': agentMd('reviewer', 'One way.\n'), '.github/agents/reviewer.agent.md': agentMd('reviewer', 'Another way.\n') });
    const split = await previewSource(box.context, box.tools, 'https://github.com/team/differ') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(split.names.map(name => [name.state, name.why]), [['leftOut', 'its Claude Code and Copilot CLI files differ in name, description or prompt']]);
  } finally { await box.cleanup(); }
});

test('A skill and an agent named reviewer at one source both come in, and no click on one line acts on the other; in Pi the agent is held out by the skill, and its row says so', async () => {
  const repo = await repository(hosts, 'https://github.com/team/pair');
  await repo.commit({ 'reviewer/SKILL.md': skillMd('reviewer'), 'agents/reviewer.md': agentMd('reviewer') });
  const box = await sandbox(true);
  await mkdir(join(box.home, '.pi/agent/skills'), { recursive: true });
  const skill = async () => (await skillsView(box.context, box.tools)).library.reviewer;
  try {
    const { look, added } = await add(box, 'https://github.com/team/pair');
    assert.deepEqual(linesOf(look), ['skill reviewer: make', 'agent reviewer: make']);
    assert.deepEqual(answered(added), ['skill reviewer: make', 'agent reviewer: make']);
    const id = (await sourceOf(box)).id;
    // Deleted, the agent's line offers Add: it brings back the agent alone.
    await applyAgents(box.context, box.tools, [{ key: 'reviewer', on: false, except: [], deleted: true }]);
    assert.deepEqual(linesOf(await sourceOf(box)), ['skill reviewer: nothing', 'agent reviewer: deleted']);
    const skillBefore = JSON.stringify(await skill());
    const back = await rowClick(box.context, box.tools, id, 'agent', 'reviewer', 'bringBack');
    assert.deepEqual([answered(back), (await agent(box, 'reviewer')).item?.deleted, JSON.stringify(await skill())], [['agent reviewer: make'], undefined, skillBefore]);
    // The agent changed here and at the source, before each click: its line waits. Keep mine, Merge and Replace on the skill's
    // line find no wait of the skill's and leave the agent waiting; on the agent's line, they leave the skill as it was.
    await turn(box, 'reviewer', true);
    // Here only the prompt changes and at the source only the description, so Merge merges cleanly.
    for (const [round, click] of (['merge', 'keep', 'replace'] as const).entries()) {
      const here = (await inTool(box, 'claude-cli', 'reviewer'))!;
      await writeFile(fileOf(box, 'claude-cli', 'reviewer'), here.replace(/\n\n[\s\S]*$/, `\n\nMine ${round}.\n`));
      await applyAgents(box.context, box.tools, [], { background: true });
      await repo.commit({ 'agents/reviewer.md': agentMd('reviewer').replace('reviewer for tests.', `Source ${round}.`) });
      await check(box, id);
      assert.deepEqual(linesOf(await sourceOf(box)), ['skill reviewer: nothing', 'agent reviewer: wait']);
      const agentBefore = JSON.stringify((await agent(box, 'reviewer')).item);
      await rowClick(box.context, box.tools, id, 'skill', 'reviewer', click);
      assert.deepEqual([JSON.stringify((await agent(box, 'reviewer')).item), linesOf(await sourceOf(box))[1]], [agentBefore, 'agent reviewer: wait'], `${click} on the skill’s line leaves the agent as it was`);
      const skillBefore = JSON.stringify(await skill());
      await rowClick(box.context, box.tools, id, 'agent', 'reviewer', click);
      assert.deepEqual([JSON.stringify(await skill()), linesOf(await sourceOf(box))[1]], [skillBefore, 'agent reviewer: nothing'], `${click} on the agent’s line acts on the agent alone`);
    }
    // In Pi, which keeps agents as skills: the skill On there holds the agent out, and the agent's row says why.
    await applySkills(box.context, box.tools, [{ key: 'reviewer', on: true, except: [], seenOn: false }]);
    await turn(box, 'reviewer', false);
    await turn(box, 'reviewer', true);
    assert.match((await agent(box, 'reviewer')).fact?.cannot?.['pi-cli'] ?? '', /^Pi has a skill named “reviewer” and loads only one skill of a name\./);
    assert.equal(await inTool(box, 'pi-cli', 'reviewer'), undefined);
  } finally { await box.cleanup(); }
});

// ---------- Read whole, per kind ----------

test('Read whole is per kind: a source that drops its agents and keeps a skill turns the agents Off; an unreadable agent holds back only the agents’ drops; a moved folder turns nothing Off', async () => {
  const repo = await repository(hosts, 'https://github.com/team/whole');
  await repo.commit({ 'kit/notes/SKILL.md': skillMd('notes'), 'kit/drafts/SKILL.md': skillMd('drafts'), 'kit/agents/reviewer.md': agentMd('reviewer'), 'kit/agents/writer.md': agentMd('writer') });
  const box = await sandbox();
  const skillOn = async (key: string) => (await skillsView(box.context, box.tools)).library[key]?.on;
  try {
    await add(box, 'https://github.com/team/whole/tree/main/kit');
    for (const key of ['reviewer', 'writer']) await turn(box, key, true);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }, { key: 'drafts', on: true, except: [], seenOn: false }]);
    const id = (await sourceOf(box)).id;
    // One agent unreadable, the other gone, and a skill gone: the skill drops, the agent waits.
    await repo.commit({ 'kit/agents/reviewer.md': '---\nname: [reviewer\n---\n', 'kit/agents/writer.md': null, 'kit/drafts/SKILL.md': null });
    const held = await check(box, id);
    assert.deepEqual([answered(held), held.notWhole], [['skill drafts: drop'], ['agent']]);
    assert.deepEqual([await skillOn('drafts'), (await agent(box, 'writer')).item?.on], [false, true]);
    // Every agent gone, a skill kept: the agents drop.
    await repo.commit({ 'kit/agents/reviewer.md': null });
    const dropped = await check(box, id);
    assert.deepEqual([answered(dropped).sort(), dropped.notWhole], [['agent reviewer: drop', 'agent writer: drop'], undefined]);
    assert.deepEqual([await skillOn('notes'), (await agent(box, 'reviewer')).item?.on], [true, false]);
    // The link's folder moved: nothing turns Off.
    await repo.git('mv', 'kit', 'moved');
    await repo.commit({});
    const moved = await check(box, id);
    assert.deepEqual([answered(moved), moved.notWhole, await skillOn('notes')], [[], ['skill', 'agent', 'mcp'], true]);
  } finally { await box.cleanup(); }
});

test('One check that drops an agent while a skill there can’t be read says which kind was held back: notWhole names the skill, not the source whole', async () => {
  const repo = await repository(hosts, 'https://github.com/team/rm');
  await repo.commit({ 'notes/SKILL.md': skillMd('notes'), 'agents/a.md': agentMd('a'), 'agents/b.md': agentMd('b') });
  const box = await sandbox();
  try {
    await add(box, 'https://github.com/team/rm');
    await turn(box, 'a', true);
    await repo.commit({ 'notes/SKILL.md': '---\nname: [notes\n---\nBroken.\n', 'agents/a.md': null });
    const done = await check(box, (await sourceOf(box)).id);
    // The page words these as "a is no longer at …: it was turned off …" and "… so the source turned no skill off" (sourcespage.ts whatItDid).
    assert.deepEqual([answered(done), done.notWhole, (await agent(box, 'a')).item?.on], [['agent a: drop'], ['skill'], false]);
  } finally { await box.cleanup(); }
});

// ---------- Each tool's own fields ----------

test('His own fields: an agent he has in Claude Code with his own tools, linked and then updated, keeps them byte for byte; an Off agent keeps its kept own part; a new agent’s first On writes the source’s file exactly', async () => {
  const repo = await repository(hosts, 'https://github.com/team/own');
  await repo.commit({ 'agents/reviewer.md': agentMd('reviewer', 'Review.\n', 'tools: Bash\n'), 'agents/fresh.md': agentMd('fresh', 'Fresh.\n', 'model: haiku\n') });
  const box = await sandbox();
  try {
    const mine = agentMd('reviewer', 'Review.\n', 'tools: Read, Grep\n');
    await mkdir(dirname(fileOf(box, 'claude-cli', 'reviewer')), { recursive: true });
    await writeFile(fileOf(box, 'claude-cli', 'reviewer'), mine);
    await applyAgents(box.context, box.tools, [{ key: 'reviewer', on: true, except: [], seenOn: false }]);
    const { added } = await add(box, 'https://github.com/team/own');
    assert.deepEqual(answered(added), ['agent fresh: make', 'agent reviewer: link']);
    await repo.commit({ 'agents/reviewer.md': agentMd('reviewer', 'Review closely.\n', 'tools: Bash\n') });
    const id = (await sourceOf(box)).id;
    assert.deepEqual(answered(await check(box, id)), ['agent reviewer: update']);
    assert.equal(await inTool(box, 'claude-cli', 'reviewer'), agentMd('reviewer', 'Review closely.\n', 'tools: Read, Grep\n'), 'his tools stay, the prompt is the source’s');

    // Off, then updated at the source: On again writes his kept file with the new prompt, never the source's tools.
    await turn(box, 'reviewer', false);
    await repo.commit({ 'agents/reviewer.md': agentMd('reviewer', 'Review gently.\n', 'tools: Bash\n') });
    assert.deepEqual(answered(await check(box, id)), ['agent reviewer: update']);
    await turn(box, 'reviewer', true);
    assert.equal(await inTool(box, 'claude-cli', 'reviewer'), agentMd('reviewer', 'Review gently.\n', 'tools: Read, Grep\n'));

    await turn(box, 'fresh', true);
    assert.equal(await inTool(box, 'claude-cli', 'fresh'), agentMd('fresh', 'Fresh.\n', 'model: haiku\n'), 'the source’s file, byte for byte');
  } finally { await box.cleanup(); }
});

test('The rule’s two costs: model changed alone at the source arrives nowhere and Check now says nothing came in; prompt and tools changed together on an agent never turned On bring the prompt only', async () => {
  const repo = await repository(hosts, 'https://github.com/team/costs');
  await repo.commit({ 'agents/reviewer.md': agentMd('reviewer', 'Review.\n', 'model: opus\n'), 'agents/writer.md': agentMd('writer', 'Write.\n', 'tools: Read\n') });
  const box = await sandbox();
  try {
    await add(box, 'https://github.com/team/costs');
    const id = (await sourceOf(box)).id;
    await repo.commit({ 'agents/reviewer.md': agentMd('reviewer', 'Review.\n', 'model: haiku\n') });
    const alone = await check(box, id);
    assert.deepEqual([answered(alone), linesOf(await sourceOf(box))], [[], ['agent reviewer: nothing', 'agent writer: nothing']], 'nothing came in, and its line says In Central Knot, Off');
    await turn(box, 'reviewer', true);
    assert.equal(await inTool(box, 'claude-cli', 'reviewer'), agentMd('reviewer', 'Review.\n', 'model: opus\n'), 'the first read’s model');

    await repo.commit({ 'agents/writer.md': agentMd('writer', 'Write well.\n', 'tools: Read, Write\n') });
    assert.deepEqual(answered(await check(box, id)), ['agent writer: update']);
    await turn(box, 'writer', true);
    assert.equal(await inTool(box, 'claude-cli', 'writer'), agentMd('writer', 'Write well.\n', 'tools: Read\n'), 'the new prompt with the first read’s tools');
  } finally { await box.cleanup(); }
});

// ---------- No false change after On ----------

test('An agent from a source, once On, reads back at its version in every tool, Codex’s TOML and Pi’s skills folder included: a pass writes nothing, and the next update follows', async () => {
  const repo = await repository(hosts, 'https://github.com/team/onward');
  const prompt = 'You review code.\n\nSay "why" and \\ quote paths.\n';
  await repo.commit({ 'agents/reviewer.md': agentMd('code-reviewer', prompt, 'tools: Read\n') });
  const box = await sandbox(true);
  try {
    await add(box, 'https://github.com/team/onward');
    await turn(box, 'reviewer', true);
    const { item } = await agent(box, 'reviewer');
    for (const tool of Object.keys(kept) as Tool[]) {
      const text = await inTool(box, tool, 'reviewer');
      assert.equal(text && agentHash(parseAgent(tool, 'reviewer', text)!), item?.hash, `${tool}’s copy reads back at the item’s version`);
    }
    assert.equal((await applyAgents(box.context, box.tools, [], { background: true })).writes, 0);
    await repo.commit({ 'agents/reviewer.md': agentMd('code-reviewer', `${prompt}Be brief.\n`, 'tools: Read\n') });
    assert.deepEqual(answered(await check(box, (await sourceOf(box)).id)), ['agent reviewer: update']);
    for (const tool of Object.keys(kept) as Tool[]) assert.match((await inTool(box, tool, 'reviewer'))!, /Be brief\./, `${tool} has the update`);
  } finally { await box.cleanup(); }
});

// ---------- Merge ----------

test('Merge for an agent: the prompt changed on different lines merges, a description changed at the source alone takes the source’s; the same line conflicts, names the prompt and changes nothing; then Undo, then Keep mine', async () => {
  const repo = await repository(hosts, 'https://github.com/team/merge');
  const prompt = (first: string, last: string) => `${first}\nThe middle.\nMore middle.\n${last}\n`;
  await repo.commit({ 'agents/reviewer.md': agentMd('reviewer', prompt('First.', 'Last.')) });
  const box = await sandbox();
  const edit = async (text: string) => { await writeFile(fileOf(box, 'claude-cli', 'reviewer'), text); await applyAgents(box.context, box.tools, [], { background: true }); };
  try {
    await add(box, 'https://github.com/team/merge');
    await turn(box, 'reviewer', true);
    const id = (await sourceOf(box)).id;
    const mine = agentMd('reviewer', prompt('First, mine.', 'Last.'));
    await edit(mine);
    const theirs = (first: string) => agentMd('reviewer', prompt(first, 'Last, theirs.')).replace('reviewer for tests.', 'Reviews, the source’s way.');
    await repo.commit({ 'agents/reviewer.md': theirs('First.') });
    await check(box, id);
    const merged = await rowClick(box.context, box.tools, id, 'agent', 'reviewer', 'merge');
    assert.deepEqual(merged.sourced?.map(entry => entry.merge), ['merged']);
    const shared = (tool: Tool, text: string | undefined) => { const read = text === undefined ? undefined : parseAgent(tool, 'reviewer', text); return read && { name: read.name, description: read.description, prompt: read.prompt }; };
    for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as Tool[]) {
      assert.deepEqual(shared(tool, await inTool(box, tool, 'reviewer')), shared('claude-cli', theirs('First, mine.')), `${tool} has both changes, and the source’s description`);
    }

    // Undo: the version before, with `seen` as it was, so the source's version waits again; then Keep mine keeps it.
    const undone = await restoreAgent(box.context, box.tools, merged.sourced![0].history!);
    assert.deepEqual([undone.stopped, await inTool(box, 'claude-cli', 'reviewer'), linesOf(await sourceOf(box))], [undefined, mine, ['agent reviewer: wait']]);
    const kept = await rowClick(box.context, box.tools, id, 'agent', 'reviewer', 'keep');
    assert.deepEqual([answered(kept), await inTool(box, 'claude-cli', 'reviewer'), linesOf(await sourceOf(box))], [['agent reviewer: keep'], mine, ['agent reviewer: nothing']]);

    // The same line changed on both sides: a conflict that names the prompt, and nothing changes.
    await edit(agentMd('reviewer', prompt('First, mine again.', 'Last.')));
    await repo.commit({ 'agents/reviewer.md': theirs('First, theirs.') });
    await check(box, id);
    const before = { item: JSON.stringify((await agent(box, 'reviewer')).item), file: await inTool(box, 'claude-cli', 'reviewer') };
    const clash = await rowClick(box.context, box.tools, id, 'agent', 'reviewer', 'merge');
    assert.deepEqual(clash.sourced?.map(entry => entry.merge), [{ conflicts: ['the prompt'] }]);
    assert.deepEqual({ item: JSON.stringify((await agent(box, 'reviewer')).item), file: await inTool(box, 'claude-cli', 'reviewer') }, before);
  } finally { await box.cleanup(); }
});

// ---------- The rows ----------

test('Each source is read once per build of the home view: the Skills and the Agents views share one read of it', async () => {
  const repo = await repository(hosts, 'https://github.com/team/once');
  await repo.commit({ 'notes/SKILL.md': skillMd('notes'), 'agents/reviewer.md': agentMd('reviewer') });
  const box = await sandbox();
  try {
    await add(box, 'https://github.com/team/once');
    const { id, commit } = await sourceOf(box), reads = new Map<string, Promise<unknown>>(), context = { ...box.context, reads };
    const skillRow = (await skillsView(context, box.tools)).items.find(fact => fact.key === 'notes'), agentRow = (await agentsView(context, box.tools)).items.find(fact => fact.key === 'reviewer');
    assert.deepEqual([skillRow?.fromSource?.link, agentRow?.fromSource?.link], ['https://github.com/team/once', 'https://github.com/team/once']);
    assert.deepEqual([...reads.keys()].filter(key => key.startsWith('source:')), [`source:${id}:${commit}`], 'one read, kept for the view');
  } finally { await box.cleanup(); }
});

test('An agent’s row on Agents carries its source line, and once the source removed it, the removed notice; the source’s row says so too', async () => {
  const repo = await repository(hosts, 'https://github.com/team/rows');
  await repo.commit({ 'agents/reviewer.md': agentMd('reviewer'), 'agents/writer.md': agentMd('writer') });
  const box = await sandbox();
  try {
    await add(box, 'https://github.com/team/rows');
    assert.deepEqual((await agent(box, 'reviewer')).fact?.fromSource, { link: 'https://github.com/team/rows' });
    await repo.commit({ 'agents/writer.md': null });
    await check(box, (await sourceOf(box)).id);
    assert.deepEqual((await agent(box, 'writer')).fact?.fromSource, { link: 'https://github.com/team/rows', removed: true });
    assert.deepEqual(linesOf(await sourceOf(box)), ['agent reviewer: nothing'], 'its line on Sources comes from the Agents view (sourcespage.ts removedRow)');
  } finally { await box.cleanup(); }
});


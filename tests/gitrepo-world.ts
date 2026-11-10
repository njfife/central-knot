// What the Git repo tests share: a throwaway repo with homes around it, and the starting states several tests build on.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discovery.ts';
import { connectRepo, pullRepo, pushRepo } from '../src/gitrepo.ts';
import { applyChanges } from '../src/manage.ts';
import { applyMcp } from '../src/mcp.ts';
import { applyAgents } from '../src/agents.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId, RepoView } from '../src/types.ts';

export const tools: HarnessId[] = ['claude-cli', 'copilot-cli'];
export const skillText = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;
export const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

export async function world() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-repo-')));
  const remote = join(base, 'config.git');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  const home = async (name: string, present: HarnessId[] = tools) => {
    const path = join(base, name);
    const folders: Partial<Record<HarnessId, string>> = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills' };
    for (const tool of present) await mkdir(join(path, folders[tool]!), { recursive: true });
    const context: ShareContext = { home: path, mode: 'custom', build: 'test', settingsPath: join(base, `${name}.json`), realHome: join(base, 'real'),
      read: () => Promise.all(present.map(harness => discover({ home: path, mode: 'custom', harness }))) };
    return context;
  };
  return { base, remote, home, cleanup: () => rm(base, { recursive: true, force: true }) };
}

export async function skill(context: ShareContext, root: string, folder: string, text = skillText(folder)) {
  await mkdir(join(context.home, root, folder), { recursive: true });
  await writeFile(join(context.home, root, folder, 'SKILL.md'), text);
}
export const live = (view: RepoView) => { assert.ok(view.connected); return view; };
export const rows = (list: { name: string; change: string }[]) => list.map(row => `${row.name}:${row.change}`).sort();

/** A home with a managed MCP server and agent, synced between Claude Code and Copilot CLI. */
export async function seedServerAndAgent(context: ShareContext) {
  await writeFile(join(context.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'docs-server', args: ['--port', '7'], env: { TOKEN: 'abc' }, tools: ['*'] } } }));
  await mkdir(join(context.home, '.claude/agents'), { recursive: true });
  await writeFile(join(context.home, '.claude/agents/planner.md'), '---\nname: planner\ndescription: Plans work.\nmodel: opus\n---\n\nPlan carefully.\n');
  assert.ok(!(await applyMcp(context, tools, [{ key: 'docs', managed: true, off: [] }])).stopped);
  assert.ok(!(await applyAgents(context, tools, [{ key: 'planner', managed: true, off: [] }])).stopped);
}

/** Two computers on one repo: the first pushed a Managed MCP server and agent, and the second pulled them. */
export async function serverAndAgentOnTwo(box: Awaited<ReturnType<typeof world>>) {
  const first = await box.home('first');
  await seedServerAndAgent(first);
  await connectRepo(first, box.remote, '');
  await pushRepo(first);
  const second = await box.home('second');
  await connectRepo(second, box.remote, '');
  await pullRepo(second);
  return { first, second, firstPlanner: join(first.home, '.claude/agents/planner.md'), secondPlanner: join(second.home, '.claude/agents/planner.md') };
}
export const edit = async (path: string, from: string, to: string) => writeFile(path, (await readFile(path, 'utf8')).replace(from, to));

/** A computer with one Managed skill in the repo, and a second clone of the repo to commit to it as someone else would. */
export async function oneSkillAndAnAuthor(box: Awaited<ReturnType<typeof world>>, options: { off?: HarnessId[] } = {}) {
  const first = await box.home('first');
  await skill(first, '.claude/skills', 'solo', skillText('solo', 'Before.'));
  await applyChanges(first, [{ key: 'solo', managed: true, off: options.off ?? [] }]);
  await connectRepo(first, box.remote, '');
  await pushRepo(first);
  const author = join(box.base, 'author');
  execFileSync('git', ['clone', '--quiet', box.remote, author]);
  const commit = (message: string) => { git(author, 'add', '-A'); git(author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', message); git(author, 'push', '--quiet', 'origin', 'HEAD:main'); };
  return { first, author, commit };
}

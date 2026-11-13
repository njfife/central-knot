// One agent ("reviewer") in a temp home, and the clicks the Agents page and History send for it, built by the page's own
// code (src/libraryrow.ts rowClicks, src/historyactions.ts). Shared by the tests that replay clicks on real files:
// agents.test.ts and agentswalk.test.ts.
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rowClicks, needsChoice, type LibraryRow } from '../src/libraryrow.ts';
import { agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import { libraryAction, versionChoices } from '../src/historyactions.ts';
import type { LibraryItem } from '../src/library.ts';
import { readHistory } from '../src/history.ts';
import type { ShareContext } from '../src/share.ts';
import type { Change, HarnessId, LibraryFacts, PassResult } from '../src/types.ts';

/** The harnesses of a test home. Which of them Central Knot manages there is the home's own `tools` (sandbox). */
export const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
export const files = { 'claude-cli': '.claude/agents/reviewer.md', 'copilot-cli': '.copilot/agents/reviewer.agent.md', 'codex-cli': '.codex/agents/reviewer.toml' } as const;
export type Tool = keyof typeof files;

export async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-agent-clicks-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/agents', '.copilot/agents', '.codex/agents']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  /** `tools`: the harnesses Central Knot manages here; a test takes one out to uninstall it or leave it out. */
  return { base, home, context, tools: [...tools], cleanup: () => rm(base, { recursive: true, force: true }) };
}
export type Box = Awaited<ReturnType<typeof sandbox>>;

export const claudeAgent = (prompt = 'You review code.\nBe brief.\n', extra = '') => `---\nname: reviewer\ndescription: Reviews code\n${extra}---\n\n${prompt}`;
/** Claude Code's own fields: its own part, which no other harness holds. */
export const claudeOwn = 'tools: Read, Grep\nmodel: opus\n';
/** A Codex agent with keys and a table of its own. */
export const codexAgent = (prompt = 'You review code.\nBe brief.\n') => `# mine\nname = "reviewer"\ndescription = "Reviews code"\nmodel = "gpt-6"\ndeveloper_instructions = """\n${prompt}"""\n\n[mcp_servers.docs]\nurl = "https://example.com/mcp"\n`;
export const fileOf = (box: Box, tool: Tool) => join(box.home, files[tool]);
export const readOf = (box: Box, tool: Tool) => readFile(fileOf(box, tool), 'utf8').catch(() => undefined);
export const write = (box: Box, tool: Tool, text: string) => writeFile(fileOf(box, tool), text);
export const filesOf = async (box: Box) => Object.fromEntries(await Promise.all(tools.map(async tool => [tool, await readOf(box, tool as Tool)] as const))) as Record<Tool, string | undefined>;
export const historyOf = async (box: Box, context = box.context) => (await readHistory(context)).filter(event => event.key === 'agent:reviewer');
/** A plain pass, as the background runs it. */
export const pass = (box: Box, context = box.context) => applyAgents(context, box.tools, []);

/** The agent as the Agents page reads it: its row's facts, and its item in the library (deleted or not). */
export async function seen(box: Box, context = box.context): Promise<{ fact?: LibraryFacts; item?: LibraryItem; row: LibraryRow }> {
  const view = await agentsView(context, box.tools);
  const fact = view.items.find(entry => entry.key === 'reviewer');
  const hashes = Object.fromEntries(Object.entries(fact?.copies ?? {}).map(([tool, copy]) => [tool, copy!.hash]));
  return { fact, item: view.library.reviewer, row: { key: 'reviewer', name: fact?.name, hashes, plan: fact?.plan, cannot: fact?.cannot, unseen: fact?.unseen, differs: fact?.differs } };
}
export const itemOf = async (box: Box) => (await seen(box)).item;

export const applyClick = (box: Box, change: Change, context = box.context) => applyAgents(context, box.tools, [change]);
const send = applyClick;
/** The row's switch, On. A found agent whose copies differ opens the copy question instead: `choose` answers it. */
export async function turnOn(box: Box, context = box.context): Promise<PassResult | 'choose'> {
  const { row, item } = await seen(box, context);
  return needsChoice(row, item) ? 'choose' : send(box, rowClicks.on(row, item), context);
}
export const choose = async (box: Box, use: Tool, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.on(row, item, use), context); };
export const turnOff = async (box: Box, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.off(row, item), context); };
/** A harness's own switch in the opened row. */
export const keepOut = async (box: Box, tool: Tool, out = true, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.inHarness(row, item, tool, out), context); };
export const makeCurrent = async (box: Box, version: string, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.makeCurrent(row, item, version), context); };
export const deleteIt = async (box: Box, context = box.context) => { const { row, item } = await seen(box, context); return send(box, rowClicks.remove(row, item), context); };

/** Every action History offers for this agent now, with the click that runs it. */
export async function historyActions(box: Box, context = box.context) {
  const { item } = await seen(box, context);
  return (await historyOf(box, context)).flatMap(event => {
    const main = libraryAction(event, item);
    const run = (version?: string) => () => restoreAgent(context, box.tools, event.id, version);
    return [...(main ? [{ event, label: main.label, run: run() }] : []), ...versionChoices(event, item).map(choice => ({ event, label: `Use ${choice.tool}’s`, run: run(choice.hash) }))];
  });
}
/** A click's Undo (app.ts undoClick): the History action of each entry the click made. */
export async function undo(box: Box, click: PassResult, context = box.context) {
  const done: PassResult[] = [];
  for (const id of click.made ?? []) done.push(await restoreAgent(context, box.tools, id));
  return done;
}

/** Every file under a folder, with its bytes, mode and times. */
async function filesUnder(root: string, found = new Map<string, { text: Buffer; mode: number; at: Date }>()) {
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await filesUnder(path, found);
    else { const info = await stat(path); found.set(path, { text: await readFile(path).catch(() => Buffer.alloc(0)), mode: info.mode & 0o777, at: info.mtime }); }
  }
  return found;
}
/**
 * Runs `body` on the home as it is, then puts every file back as it was, in place: folders are never made again, so the
 * harnesses' agents folders keep their identity and a trial is no folder reset. For checks that click or run passes.
 */
export async function trial<T>(box: Box, body: () => Promise<T>): Promise<T> {
  const before = await filesUnder(box.base);
  try { return await body(); }
  finally {
    const after = await filesUnder(box.base);
    for (const path of after.keys()) if (!before.has(path)) await rm(path, { force: true });
    for (const [path, was] of before) {
      const now = after.get(path);
      if (now && now.text.equals(was.text) && now.at.getTime() === was.at.getTime()) continue;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, was.text);
      await chmod(path, was.mode);
      await utimes(path, was.at, was.at);
    }
  }
}

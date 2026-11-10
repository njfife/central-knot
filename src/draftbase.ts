// A draft of the base instructions, written by one of the person's own tools (INS-06). The tool's CLI runs once, with a prompt
// that holds every tool's own instructions, in an empty folder, with none of its tools on and no session kept. Its answer sorts
// those instructions into what every tool should get (the base) and what stays only in each tool's file. Nothing is written
// here: the answer is a draft, which the Instructions page reviews and saves like any other base change.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBinary } from './discovery.ts';
import { harnessIds } from './harnesses.ts';
import { baseView, instructionsView } from './instructions.ts';
import { pathBeside } from './platform.ts';
import { fileName, toolNames } from './words.ts';
import type { ShareContext } from './share.ts';
import type { BaseDraft, HarnessId, Snapshot } from './types.ts';

/** How long a tool gets to answer before it is stopped. */
const DRAFT_TIMEOUT_MS = 5 * 60_000;
/** The most a tool may say before it is stopped: far more than any set of instruction files. */
const MOST_OUTPUT = 4 * 1024 * 1024;

/**
 * How each tool is run for one answer and no more: the prompt arrives on standard input, the tool's own tools are off where it
 * has a switch for that (Copilot CLI has none, and without approval it runs none that change anything), and no session is kept
 * where it can be told so. Codex prints its progress, so its answer is read from the file it is told to write.
 */
export function draftCommand(tool: HarnessId, answerFile: string): { args: string[]; answer: 'output' | 'file' } {
  switch (tool) {
    case 'claude-cli': return { args: ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence'], answer: 'output' };
    case 'codex-cli': return { args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-o', answerFile, '-'], answer: 'file' };
    case 'copilot-cli': return { args: ['-s', '--no-color', '--no-ask-user'], answer: 'output' };
    case 'pi-cli': return { args: ['-p', '--no-tools', '--no-session'], answer: 'output' };
  }
}

/** The tools on this computer that can write a draft: those with a CLI, or with a desktop app that carries a copy of one. */
export async function draftTools(home: string): Promise<Partial<Record<HarnessId, string>>> {
  const found = await Promise.all(harnessIds.map(async tool => [tool, (await findBinary(tool, home))?.binary] as const));
  return Object.fromEntries(found.filter(([, binary]) => binary));
}

/** One tool's file as the draft reads it: its own instructions, outside any base block. */
export interface DraftSource { tool: HarnessId; path: string; hash: string; own: string }
/** What a draft is written from: the base as it is now and every file with instructions of its own. */
export interface DraftSources { base: string; baseHash: string; files: DraftSource[] }

/**
 * The files a draft sorts, one per physical file (tools reading one file are one), each with the text outside its base block.
 * A file with nothing of its own has nothing to sort, and one whose copy of the base was edited there is left as it is by
 * every base save, so neither is given.
 */
export async function draftSources(context: ShareContext, snapshots: Snapshot[]): Promise<DraftSources> {
  const [base, files] = await Promise.all([baseView(context), instructionsView(context, snapshots)]);
  const first = files.filter((file, index) => !files.slice(0, index).some(other => file.sameFile.includes(other.tool)));
  return { base: base.text, baseHash: base.hash,
    files: first.filter(file => file.base?.state !== 'edited').map(file => ({ tool: file.tool, path: file.path, hash: file.hash, own: file.base ? file.base.own : file.text })).filter(file => file.own.trim()) };
}

const mark = (name: string) => `<<<CENTRAL KNOT: ${name}>>>`;
const MARK = /^\s*<<<\s*CENTRAL KNOT:\s*([\w-]+)\s*>>>\s*$/i;

/** What the tool is asked: how to sort, the texts, and the form of the answer. */
export function draftPrompt(sources: DraftSources): string {
  const hasBase = !!sources.base.trim();
  const given = (title: string, text: string) => `<<<FILE: ${title}>>>\n${text}${text.endsWith('\n') ? '' : '\n'}<<<END OF FILE>>>\n`;
  return [
    'You are sorting the instruction files a person keeps for their AI coding tools. Each tool reads its own file at the start of every session. The person wants one set of base instructions that every tool gets, with each tool’s file keeping only what is meant for that tool alone.',
    '',
    'Do not use any tools, and do not read or change any files: everything you need is in this message. Your whole answer is the sorted text, in the form given at the end.',
    '',
    'How to sort:',
    '- Base instructions: what should hold in every tool. An instruction that appears in more than one file goes into the base once, even where the files word it differently. An instruction found in only one file also goes into the base when it is about the person, their computer or how they like to work, rather than about that tool.',
    '- A tool’s own part: what only makes sense in that tool, such as its own commands, settings, features, file locations or the names of its tools, and any notice that the file is generated or managed by something else.',
    '- Where two files disagree, leave both out of the base and keep each in its own tool’s part.',
    '- Lose nothing and add nothing. Every instruction in the files ends up in the base or in the part of the tool it came from, in the person’s own words wherever they can be kept. Write no new instructions, advice, summaries or comments of your own.',
    ...(hasBase ? ['- The base instructions as they are now come first. Keep everything they say, and add what the files share.'] : []),
    '- Keep the Markdown as the person wrote it: headings, lists and code blocks. Put lines about one subject under one heading.',
    '- A tool’s part is empty when everything in its file belongs in the base.',
    '',
    ...(hasBase ? [given('the base instructions as they are now', sources.base)] : []),
    ...sources.files.map(file => given(`${file.tool}, ${toolNames[file.tool]}’s ${fileName(file.path)}`, file.own)),
    'Answer in exactly this form. Keep each marker line as it is, on a line of its own, with nothing before the first and nothing after the last:',
    '',
    mark('base'),
    '(the base instructions)',
    ...sources.files.flatMap(file => [mark(file.tool), `(what stays only in ${toolNames[file.tool]}’s file; nothing when it all belongs in the base)`]),
    mark('end'),
    '',
  ].join('\n');
}

/** A part of the answer as a file holds it: no blank lines around it, and ending in a line break (empty stays empty). */
const part = (lines: string[]) => { const text = lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd(); return text ? `${text}\n` : ''; };

/**
 * The base and each tool's part, read from the tool's answer by its marker lines; anything before the first marker or after
 * the end marker (a greeting, a code fence around it all) is not part of it. An answer that never reaches the end marker
 * was cut short, and one without the base or without a tool's part is no draft: saving it would empty that tool's file.
 */
export function parseDraft(answer: string, tools: HarnessId[]): { base: string; own: Partial<Record<HarnessId, string>> } | { problem: 'cut short' | 'no base' | 'left out'; tool?: HarnessId } {
  const parts = new Map<string, string[]>();
  let open: string[] | undefined, ended = false;
  for (const line of answer.replace(/\r\n/g, '\n').split('\n')) {
    const name = line.match(MARK)?.[1].toLowerCase();
    if (name === 'end') { ended = !!parts.size; if (ended) break; continue; }
    if (name === 'base' || (name && tools.includes(name as HarnessId))) { open = []; parts.set(name, open); continue; }
    // A part for a tool that was never asked about comes from no file: it is not kept anywhere.
    if (name) { open = undefined; continue; }
    open?.push(line);
  }
  if (!ended) return { problem: 'cut short' };
  const base = part(parts.get('base') ?? []);
  if (!base) return { problem: 'no base' };
  const missing = tools.find(tool => !parts.has(tool));
  if (missing) return { problem: 'left out', tool: missing };
  return { base, own: Object.fromEntries(tools.map(tool => [tool, part(parts.get(tool)!)])) };
}

type Ran = { code: number | 'timeout' | 'missing' | 'cancelled'; output: string; said: string };

/** Runs the tool once with the prompt on its standard input. Stopping it (time up, or cancelled) stops what it started too. */
function run(binary: string, args: string[], prompt: string, { cwd, signal, timeoutMs }: { cwd: string; signal?: AbortSignal; timeoutMs: number }): Promise<Ran> {
  return new Promise(done => {
    // Its own process group (not on Windows), so stopping it reaches helpers it started, such as MCP servers.
    const grouped = process.platform !== 'win32';
    const child = spawn(binary, args, { cwd, env: { ...process.env, PATH: pathBeside(binary) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: grouped });
    let output = '', said = '', stoppedAs: 'timeout' | 'cancelled' | undefined, finished = false;
    const stop = (as: 'timeout' | 'cancelled') => {
      if (finished) return;
      stoppedAs ??= as;
      try { if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const cancel = () => stop('cancelled');
    signal?.addEventListener('abort', cancel);
    const finish = (code: Ran['code']) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      done({ code: stoppedAs ?? code, output, said });
    };
    child.stdout.setEncoding('utf8').on('data', (text: string) => { output += text; if (output.length > MOST_OUTPUT) stop('timeout'); });
    child.stderr.setEncoding('utf8').on('data', (text: string) => { said = (said + text).slice(-8000); });
    child.on('error', error => finish((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 1));
    child.on('close', code => finish(code ?? 1));
    // A tool that exits before reading its input (not signed in) closes the pipe: that is its failure to report, not ours.
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    if (signal?.aborted) cancel();
  });
}

/** The last thing a tool said when it failed, short enough for a sentence: its own words are what the person can act on. */
const lastWords = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(line => line.trim()).filter(Boolean).slice(-3).join(' ').slice(-300);

/**
 * Has `by` write a draft from `sources`. The answer comes back sorted, with the hash of everything it was written from, so a
 * review can tell when a file changed since. A failure says what the tool said; every failure leaves everything as it was.
 */
export async function writeDraft(sources: DraftSources, by: HarnessId, binary: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<BaseDraft> {
  const name = toolNames[by];
  if (!sources.files.length) return { stopped: 'No tool’s file has instructions of its own, so there is nothing to draft from.' };
  // An empty folder of its own: no project there for the tool to read, and nothing of the person's to change.
  const folder = await mkdtemp(join(tmpdir(), 'central-knot-draft-'));
  try {
    const answerFile = join(folder, 'answer.md');
    const command = draftCommand(by, answerFile);
    const ran = await run(binary, command.args, draftPrompt(sources), { cwd: folder, signal: options.signal, timeoutMs: options.timeoutMs ?? DRAFT_TIMEOUT_MS });
    if (ran.code === 'cancelled') return { cancelled: true };
    if (ran.code === 'missing') return { stopped: `${name} could not be started, so there is no draft. Nothing was changed.` };
    if (ran.code === 'timeout') return { stopped: `${name} did not finish a draft in time, so it was stopped. Nothing was changed.` };
    if (ran.code !== 0) {
      const why = lastWords(ran.said) || lastWords(ran.output);
      return { stopped: `${name} could not write a draft${why ? `: “${why}”.` : '.'} Nothing was changed.` };
    }
    const answer = command.answer === 'file' ? await readFile(answerFile, 'utf8').catch(() => '') : ran.output;
    const tools = sources.files.map(file => file.tool);
    const sorted = parseDraft(answer, tools);
    if ('problem' in sorted) {
      const why = sorted.problem === 'cut short' ? 'its answer stopped before the end' : sorted.problem === 'no base' ? 'its answer had no base instructions in it' : `its answer left out ${toolNames[sorted.tool!]}’s part`;
      return { stopped: `${name} answered, but ${why}, so there is no draft. Nothing was changed. Try again, or have another tool write it.` };
    }
    return { draft: { by, base: sorted.base, own: sorted.own, read: Object.fromEntries(sources.files.map(file => [file.tool, file.hash])), baseHash: sources.baseHash } };
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

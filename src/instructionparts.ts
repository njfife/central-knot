// The other files a tool reads with its own instruction file at the home's level, in the tool's order, as its card on the
// Instructions page lists them (instructionspage.ts otherFiles): `instructionParts`, one function per tool below. They are read
// only to be shown: nothing here writes, fetches from the network or runs anything, and nothing read is kept. Writes go by
// destination: a tool's own file is written from its card and by the base, whether or not a card also lists it as a part; a
// part that is another tool's own file is marked so (instructions.ts instructionsView).
// What each tool reads (M: measured by the groundwork of 2026-11-18 on the version named; D: its documentation; R: read in its code):
//   Claude Code  the file's @ imports, each resolved against the file that holds it, "a maximum depth of four hops" (D,
//                code.claude.com/docs/en/memory; R, 2.1.328: the limit is of a route, so a file past it on one route and within
//                it on another is read), none in code or an HTML comment (D, R); then every `.md` under `rules/`, "discovered
//                recursively", linked folders followed (D: it "supports symlinks"), each with its own imports (D, R, 2.1.328;
//                M, 2.1.327 for the top level). A rule with `paths` is read only for matching files (D): it is listed last,
//                with them; its own imports are not listed, as the documentation doesn't say when Claude Code reads them.
//   Copilot CLI  `instructions/*.instructions.md`, front matter and all; one whose `applyTo` isn't `**` is read only for
//                those files, so it is listed last, with them (M, 1.0.113).
//   OpenCode     the files its config's `instructions` list names, after AGENTS.md (M, 1.19.6); `~/` is the home, a relative
//                entry is looked for from a session's folder, a pattern is matched and a web address fetched by OpenCode (R, 1.19.6).
//   Codex, Pi    nothing more at the home's level: each reads its own file, then the project's (M).
// A project's files (the folder a session starts in) are not looked for here; one a home's file imports by its path is read.
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { frontMatter } from './agentfiles.ts';
import { errorCode, type ShareContext } from './share.ts';
import { readSwitchFile } from './skillswitch.ts';
import { linesOf } from './words.ts';
import type { HarnessId, InstructionPart } from './types.ts';

/** A part's text is sent to the page up to this size: kept light, and well below the 4 MB Claude Code 2.1.328 reads of a file
 *  (read in its code). Past it the part's line says its size instead. */
export const PART_TEXT_LIMIT = 256 * 1024;

/** The other files `tool` reads with its own file (`file`, holding `text`; `root`: the tool's folder), in the tool's order. */
export async function instructionParts(context: ShareContext, tool: HarnessId, root: string, file: string, text: string): Promise<InstructionPart[]> {
  if (tool === 'claude-cli') {
    const seen: Seen = new Map([[file, 'listed']]);
    const parts = [...await claudeImports(file, text, context.home, seen), ...await claudeRules(root, context.home, seen)];
    return parts.filter(part => !('notShown' in part && part.notShown === PAST_HOPS && seen.get(part.path) === 'listed'));
  }
  if (tool === 'copilot-cli') return copilotInstructions(root);
  if (tool === 'opencode-cli') return openCodeInstructions(context);
  return [];
}

/** What reading a part found (as InstructionPart holds it). */
type Read = { text: string } | { notShown: string } | { problem: string };

/**
 * A file's text; or why it isn't shown (its size, past the cap; or not text: a zero byte in it); or why the tool can't read it
 * (missing, not a file, can't be read), which is mended where it is named.
 */
async function readPart(path: string): Promise<Read> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return { problem: 'not a file' };
    const size = info.size < 1024 * 1024 ? `${Math.ceil(info.size / 1024)} KB` : `${(info.size / 1024 / 1024).toFixed(1)} MB`;
    if (info.size > PART_TEXT_LIMIT) return { notShown: `${size}, so not shown here` };
    const bytes = await readFile(path);
    return bytes.includes(0) ? { notShown: 'not text' } : { text: bytes.toString('utf8') };
  } catch (error) { return { problem: ['ENOENT', 'ENOTDIR'].includes(errorCode(error)) ? 'missing' : 'can’t be read' }; }
}

/** The files in a folder whose names end with `ending`, by name; none when there is no folder. */
const filesIn = async (folder: string, ending: string) =>
  (await readdir(folder).catch(() => [])).filter(name => name.endsWith(ending)).sort().map(name => join(folder, name));

/** Every `.md` under `folder`, linked folders followed, each real folder read once (a loop of links ends); one that can't be
 *  read is passed over and the rest kept. */
async function markdownUnder(folder: string, visited = new Set<string>()): Promise<string[]> {
  const real = await realpath(folder).catch(() => '');
  if (!real || visited.has(real)) return [];
  visited.add(real);
  const found = await Promise.all((await readdir(folder).catch(() => [])).map(async name => {
    const path = join(folder, name);
    return (await stat(path).catch(() => undefined))?.isDirectory() ? markdownUnder(path, visited) : name.endsWith('.md') ? [path] : [];
  }));
  return found.flat();
}

/** A front matter field, its list joined by ", ": undefined when the file has none, or it is empty. */
function field(text: string, name: string): string | undefined {
  const front = frontMatter(text);
  const value = front !== 'none' && 'fields' in front ? front.fields[name] : undefined;
  const all = (Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string' && item.trim());
  return all.length ? all.join(', ') : undefined;
}

/** The parts read in every session, then those read only for some files. */
const scopedLast = (parts: InstructionPart[]) => [...parts.filter(part => !part.only), ...parts.filter(part => part.only)];

/** Claude Code reads an import this many hops from the file that starts the route (CLAUDE.md, or a rule), and no further. */
const IMPORT_HOPS = 4;
const PAST_HOPS = 'past four hops of imports, so Claude Code doesn’t read it';
/** What Claude Code's walk has met, by path: listed (read, or said why not), or only named past the limit so far. */
type Seen = Map<string, 'listed' | 'past'>;

/** A Markdown code fence's opening or closing mark at a line's start: three or more backticks, or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A code span: a run of backticks, then anything, then a run of the same length (a longer or shorter run inside is text). */
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g;

/**
 * The paths a Claude Code text imports, with the line each is on, as Claude Code finds them: `@path` at a line's start or after a
 * space, outside code (a fenced block, closed only by a mark of its own kind at least as long; a code span) and outside an HTML
 * comment (on one line or over several); `\ ` is a space in the path and a `#…` after it is cut; only a path that starts with
 * ~/, /, or a letter, digit, dot, _ or - counts.
 */
function importsIn(text: string): { target: string; line: number }[] {
  const found: { target: string; line: number }[] = [];
  let fence = '', comment = false;
  linesOf(text).forEach((line, index) => {
    const mark = FENCE.exec(line)?.[1];
    if (fence) { if (mark?.[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) fence = ''; return; }
    let rest = line;
    if (comment) { const end = line.indexOf('-->'); if (end < 0) return; comment = false; rest = line.slice(end + 3); }
    else if (mark) { fence = mark; return; }
    rest = rest.replace(CODE_SPAN, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    if (rest.includes('<!--')) { comment = true; rest = rest.slice(0, rest.indexOf('<!--')); }
    for (const [, written] of rest.matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)) {
      const target = written.replace(/\\ /g, ' ').split('#')[0];
      if (/^(~\/|\/.|[\w.-])/.test(target)) found.push({ target, line: index + 1 });
    }
  });
  return found;
}

/**
 * `file`'s imports, `hop` hops from the start of its route, each followed by its own, depth first. A file listed once is not
 * listed again; one past the limit is named, and read if another route reaches it within the limit (instructionParts then
 * drops the name).
 */
async function claudeImports(file: string, text: string, home: string, seen: Seen, hop = 1): Promise<InstructionPart[]> {
  const parts: InstructionPart[] = [];
  for (const { target, line } of importsIn(text)) {
    const path = target.startsWith('~/') ? join(home, target.slice(2)) : resolve(dirname(file), target);
    const from = `imported by ${basename(file)}, line ${line}`;
    if (seen.get(path) === 'listed' || (seen.has(path) && hop > IMPORT_HOPS)) continue;
    if (hop > IMPORT_HOPS) { seen.set(path, 'past'); parts.push({ path, from, notShown: PAST_HOPS }); continue; }
    parts.push(...await withImports(path, from, await readPart(path), home, seen, hop));
  }
  return parts;
}

/** A file Claude Code reads (`read`: as readPart found it), `hop` hops from the start of its route, then what it imports. */
async function withImports(path: string, from: string, read: Read, home: string, seen: Seen, hop: number): Promise<InstructionPart[]> {
  seen.set(path, 'listed');
  return [{ path, from, ...read }, ...('text' in read ? await claudeImports(path, read.text, home, seen, hop + 1) : [])];
}

/** Claude Code's rules: every `.md` under `rules/`, by path, each with its imports; one with `paths` only for the files they match. */
async function claudeRules(root: string, home: string, seen: Seen): Promise<InstructionPart[]> {
  const parts: InstructionPart[] = [];
  for (const path of (await markdownUnder(join(root, 'rules'))).sort()) {
    if (seen.get(path) === 'listed') continue;
    const read = await readPart(path), only = 'text' in read ? field(read.text, 'paths') : undefined;
    if (only) seen.set(path, 'listed');
    parts.push(...(only ? [{ path, from: 'a rule', only, ...read }] : await withImports(path, 'a rule', read, home, seen, 0)));
  }
  return scopedLast(parts);
}

/** Copilot CLI's instructions files: each `instructions/*.instructions.md`; one whose `applyTo` isn't `**` only for those files. */
async function copilotInstructions(root: string): Promise<InstructionPart[]> {
  const parts = await Promise.all((await filesIn(join(root, 'instructions'), '.instructions.md')).map(async path => {
    const read = await readPart(path), applyTo = 'text' in read ? field(read.text, 'applyTo') : undefined;
    return { path, from: 'an instructions file', ...(applyTo && applyTo !== '**' ? { only: applyTo } : {}), ...read };
  }));
  return scopedLast(parts);
}

/** The entries of OpenCode's `instructions` list, each once, its settings read as its skill switches are (skillswitch.ts readSwitchFile). */
async function openCodeInstructions(context: ShareContext): Promise<InstructionPart[]> {
  const settings = await readSwitchFile(context, 'opencode-cli');
  const list = settings.parsed && 'json' in settings.parsed ? settings.parsed.json.instructions : undefined;
  const from = `named in ${basename(settings.path)}`;
  const entries = (Array.isArray(list) ? list : []).filter((entry): entry is string => typeof entry === 'string');
  return Promise.all([...new Set(entries.map(entry => (entry.startsWith('~/') ? join(context.home, entry.slice(2)) : entry)))].map(async path => {
    if (/^https?:\/\//.test(path)) return { path, from, notShown: 'a web address: OpenCode fetches it, Central Knot doesn’t' };
    if (!isAbsolute(path)) return { path, from, notShown: 'a relative path: looked for from the folder a session starts in, as OpenCode resolves it' };
    if (/[*?[\]{}]/.test(path)) return { path, from, notShown: 'a pattern: matched as OpenCode resolves it, not here' };
    return { path, from, ...await readPart(path) };
  }));
}

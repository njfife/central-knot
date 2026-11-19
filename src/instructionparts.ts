// The other files a tool reads with its own instruction file at the home's level, in the tool's order, as its card on the
// Instructions page lists them (instructionspage.ts otherFiles): `instructionParts`, one function per tool below. They are read
// only to be shown: nothing here writes, fetches from the network or runs anything, and nothing read is kept. The tool's own file,
// the one a save, the base and Restore write, is bound in instructions.ts; a part never becomes it.
// What each tool reads (measured by the groundwork of 2026-11-18 on the versions named, M; else read in the tool's code, R):
//   Claude Code  the file's @ imports, each resolved against the file that holds it and followed five levels down (documented),
//                then `rules/*.md` by name (M, 2.1.327); a rule with `paths` is read only for matching files (documented), so it
//                is named, last.
//   Copilot CLI  `instructions/*.instructions.md` whose `applyTo` is `**` or absent, front matter and all; a scoped one is named
//                with its scope (M, 1.0.113).
//   OpenCode     the files its config's `instructions` list names, after AGENTS.md (M, 1.19.6); `~/` is the home, a relative
//                entry is looked for from a session's folder, a pattern is matched and a web address fetched by OpenCode (R, 1.19.6).
//   Codex, Pi    nothing more at the home's level: each reads its own file, then the project's (M).
// A project's files (the folder a session starts in) are not read here.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { frontMatter } from './agentfiles.ts';
import { PART_FILE_LIMIT } from './catalogdetail.ts';
import { errorCode, type ShareContext } from './share.ts';
import { readSwitchFile } from './skillswitch.ts';
import { linesOf } from './words.ts';
import type { HarnessId, InstructionPart } from './types.ts';

/** The other files `tool` reads with its own file (`file`, holding `text`; `root`: the tool's folder), in the tool's order. */
export async function instructionParts(context: ShareContext, tool: HarnessId, root: string, file: string, text: string): Promise<InstructionPart[]> {
  if (tool === 'claude-cli') return [...await claudeImports(file, text, context.home, new Set([file])), ...await claudeRules(root)];
  if (tool === 'copilot-cli') return copilotInstructions(root);
  if (tool === 'opencode-cli') return openCodeInstructions(context);
  return [];
}

/** A file's text, or why it isn't shown: missing, unreadable, larger than the app reads, or not text (a zero byte in it). */
async function readPart(path: string): Promise<{ text: string } | { notShown: string }> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return { notShown: 'not a file' };
    if (info.size > PART_FILE_LIMIT) return { notShown: `larger than ${PART_FILE_LIMIT / 1024 / 1024} MB, so not shown here` };
    const bytes = await readFile(path);
    return bytes.includes(0) ? { notShown: 'not text' } : { text: bytes.toString('utf8') };
  } catch (error) { return { notShown: ['ENOENT', 'ENOTDIR'].includes(errorCode(error)) ? 'missing' : 'can’t be read' }; }
}

/** The files directly in a folder whose names end with `ending`, by name; none when there is no folder. */
const filesIn = async (folder: string, ending: string) => (await readdir(folder).catch(() => [])).filter(name => name.endsWith(ending)).sort().map(name => join(folder, name));

/** A front matter field, its list joined by ", ": undefined when the file has none, or it is empty. */
function field(text: string, name: string): string | undefined {
  const front = frontMatter(text);
  const value = front !== 'none' && 'fields' in front ? front.fields[name] : undefined;
  const all = (Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string' && item.trim());
  return all.length ? all.join(', ') : undefined;
}

/** Files as given, then the ones read only for some files (`scope`: which, from a file's text), named with that and not shown. */
async function scoped(paths: string[], from: string, scope: (text: string) => string | undefined): Promise<InstructionPart[]> {
  const read = await Promise.all(paths.map(async path => { const got = await readPart(path); return { path, got, only: 'text' in got ? scope(got.text) : undefined }; }));
  return [...read.filter(each => !each.only), ...read.filter(each => each.only)]
    .map(({ path, got, only }) => (only ? { path, from, notShown: `only for files matching ${only}` } : { path, from, ...got }));
}

/** Claude Code reads an import this many levels below CLAUDE.md, and no deeper. */
const IMPORT_LEVELS = 5;

/**
 * The paths a Claude Code text imports, with the line each is on, as Claude Code finds them: `@path` at a line's start or after a
 * space, outside code (a fenced block or a `code` span); `\ ` is a space in the path and a `#…` after it is cut; only a path
 * that starts with ~/, /, or a letter, digit, dot, _ or - counts.
 */
function importsIn(text: string): { target: string; line: number }[] {
  const found: { target: string; line: number }[] = [];
  let fenced = false;
  linesOf(text).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    for (const [, written] of line.replace(/`[^`]*`/g, ' ').matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)) {
      const target = written.replace(/\\ /g, ' ').split('#')[0];
      if (/^(~\/|\/.|[\w.-])/.test(target)) found.push({ target, line: index + 1 });
    }
  });
  return found;
}

/** `file`'s imports, each followed by its own, depth first; a path in `seen` (already listed, or CLAUDE.md) is not listed again. */
async function claudeImports(file: string, text: string, home: string, seen: Set<string>, level = 1): Promise<InstructionPart[]> {
  const parts: InstructionPart[] = [];
  for (const { target, line } of importsIn(text)) {
    const path = target.startsWith('~/') ? join(home, target.slice(2)) : resolve(dirname(file), target);
    if (seen.has(path)) continue;
    seen.add(path);
    const from = `imported by ${basename(file)}, line ${line}`;
    if (level > IMPORT_LEVELS) { parts.push({ path, from, notShown: 'past five levels of imports, so Claude Code doesn’t read it' }); continue; }
    const read = await readPart(path);
    parts.push({ path, from, ...read });
    if ('text' in read) parts.push(...await claudeImports(path, read.text, home, seen, level + 1));
  }
  return parts;
}

/** Claude Code's rules: each `rules/*.md`; one with `paths` only for the files they match. */
const claudeRules = async (root: string) => scoped(await filesIn(join(root, 'rules'), '.md'), 'a rule', text => field(text, 'paths'));

/** Copilot CLI's instructions files: each `instructions/*.instructions.md`; one whose `applyTo` isn't `**` only for those files. */
const copilotInstructions = async (root: string) => scoped(await filesIn(join(root, 'instructions'), '.instructions.md'), 'an instructions file',
  text => { const applyTo = field(text, 'applyTo'); return applyTo === '**' ? undefined : applyTo; });

/** The entries of OpenCode's `instructions` list, its settings read as its skill switches are (skillswitch.ts readSwitchFile). */
async function openCodeInstructions(context: ShareContext): Promise<InstructionPart[]> {
  const settings = await readSwitchFile(context, 'opencode-cli');
  const list = settings.parsed && 'json' in settings.parsed ? settings.parsed.json.instructions : undefined;
  const from = `named in ${basename(settings.path)}`;
  return Promise.all((Array.isArray(list) ? list : []).filter((entry): entry is string => typeof entry === 'string').map(async entry => {
    if (/^https?:\/\//.test(entry)) return { path: entry, from, notShown: 'a web address: OpenCode fetches it, Central Knot doesn’t' };
    const path = entry.startsWith('~/') ? join(context.home, entry.slice(2)) : entry;
    if (!isAbsolute(path)) return { path: entry, from, notShown: 'a relative path: looked for from the folder a session starts in, as OpenCode resolves it' };
    if (/[*?[\]{}]/.test(basename(path))) return { path, from, notShown: 'a pattern: matched as OpenCode resolves it, not here' };
    return { path, from, ...await readPart(path) };
  }));
}

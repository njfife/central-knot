// Memory: what Claude Code and Codex keep of what they learn, read only. Claude Code keeps it per project, one Markdown file
// per memory with an index (MEMORY.md); Codex keeps one folder of its own, with a summary every session gets.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FRONTMATTER, frontmatter } from './discovery.ts';
import { sha256 } from './share.ts';
import { readTomlTables, type TomlValue } from './textedit.ts';
import { isPresent } from './presence.ts';
import { readSent, sentMarks } from './memorysent.ts';
import type { CodexMemory, MemoryNote, MemoryProject, MemoryView, Snapshot } from './types.ts';

const INDEX = 'MEMORY.md';

/**
 * A project folder's name as a label: Claude Code names it after the project's path with every character that is not a
 * letter or digit turned into `-`, so the home's part is taken off and the leading dashes trimmed. A name outside the home
 * is shown whole, without its leading dashes; the home itself is `~`.
 */
export function projectLabel(folder: string, home: string): string {
  const prefix = home.replace(/[^A-Za-z0-9]/g, '-');
  if (folder === prefix) return '~';
  const rest = folder.startsWith(`${prefix}-`) ? folder.slice(prefix.length) : folder;
  return rest.replace(/^-+/, '') || folder;
}

/** Link text by file name, from the index's `- [Title](file.md) — hook` lines. */
const indexTitles = (index: string) => new Map([...index.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)].map(([, title, file]) => [file.replace(/^\.\//, ''), title.trim()]));

const firstLine = (text: string) => text.split(/\r?\n/).map(line => line.replace(/^#+\s*/, '').trim()).find(Boolean);

/** A memory file's fields: its settings lines when they can be read, else the whole file as its text. */
function parseNote(content: string): { name?: string; description?: string; kind?: string; text: string } {
  let fields: Record<string, unknown> | null = null;
  try { fields = frontmatter(content); } catch { /* read as plain text */ }
  if (!fields) return { text: content, description: firstLine(content) };
  const text = content.replace(FRONTMATTER, '');
  const word = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const metadata = fields.metadata && typeof fields.metadata === 'object' ? fields.metadata as Record<string, unknown> : {};
  return { name: word(fields.name), description: word(fields.description) ?? firstLine(text), kind: word(metadata.type) ?? word(fields.type), text };
}

/** Those about you or how you like to work first, then the rest; newest first within each; the index last. */
const rank = (note: MemoryNote) => (note.index ? 2 : note.kind === 'user' || note.kind === 'feedback' ? 0 : 1);
const byRank = (a: MemoryNote, b: MemoryNote) => rank(a) - rank(b) || b.at.localeCompare(a.at);

/** One project's memory folder, or nothing when it holds no non-empty Markdown file. */
async function readProject(folder: string, name: string, home: string): Promise<MemoryProject | undefined> {
  const entries = await readdir(folder).catch(() => [] as string[]);
  const label = projectLabel(name, home);
  const files = await Promise.all(entries.filter(entry => entry.endsWith('.md')).map(async file => {
    const path = join(folder, file);
    const at = await stat(path).then(info => info.mtime.toISOString(), () => new Date(0).toISOString());
    const content = await readFile(path, 'utf8').catch(() => undefined);
    return { file, path, at, content };
  }));
  const index = files.find(entry => entry.file === INDEX)?.content;
  const titles = index ? indexTitles(index) : new Map<string, string>();
  const notes: MemoryNote[] = [];
  for (const { file, path, at, content } of files) {
    const origin = `Claude Code's memory (project ${label}, file ${file})`;
    const plain = file.slice(0, -'.md'.length);
    if (content === undefined) { notes.push({ path, file, title: plain, at, text: '', hash: '', origin, unreadable: true }); continue; }
    if (!content.trim()) continue;
    const note = parseNote(content);
    const isIndex = file === INDEX;
    notes.push({
      path, file, at, text: note.text, hash: sha256(note.text), origin,
      title: isIndex ? `Memory index, ${label}` : titles.get(file) ?? note.name ?? plain,
      ...(isIndex ? { index: true as const, description: 'The list Claude Code reads first in every session in this project.' } : note.description ? { description: note.description } : {}),
      ...(!isIndex && note.kind ? { kind: note.kind } : {}),
    });
  }
  if (!notes.length) return undefined;
  notes.sort(byRank);
  return { folder, label, newest: notes.map(note => note.at).reduce((a, b) => (a > b ? a : b)), notes };
}

/** Every project's memory under Claude Code's folder, the project with the newest memory first. */
export async function claudeMemory(claudeRoot: string, home: string): Promise<MemoryProject[]> {
  const projects = join(claudeRoot, 'projects');
  const names = await readdir(projects).catch(() => [] as string[]);
  const read = await Promise.all(names.map(name => readProject(join(projects, name, 'memory'), name, home)));
  return read.filter((project): project is MemoryProject => !!project).sort((a, b) => b.newest.localeCompare(a.newest));
}

/** A value by its key path, whether written under a table header, as dotted keys or as an inline table. */
function tomlAt(text: string, path: string[]): TomlValue | undefined {
  let found: TomlValue | undefined;
  for (const table of readTomlTables(text)) {
    if (table.array) continue;
    for (const entry of table.entries) {
      const keys = [...table.path, ...entry.keys];
      if (!path.slice(0, keys.length).every((key, index) => key === keys[index]) || keys.length > path.length) continue;
      let value: TomlValue | undefined = entry.value;
      for (const key of path.slice(keys.length)) value = value && typeof value === 'object' && !Array.isArray(value) ? value[key] : undefined;
      if (value !== undefined) found = value;
    }
  }
  return found;
}

const isFolder = (path: string) => stat(path).then(info => info.isDirectory(), () => false);

/**
 * Codex's memory folder by Codex's own rule: `[memories] version` when set ("v1" is `memories`, "v2" `memories_v2`);
 * otherwise `memories` when `dual_write` is false or that folder exists, else `memories_v2`. Memory is on only with
 * `[features] memories = true`; a config that can't be read counts as off.
 */
export async function codexMemory(codexHome: string): Promise<CodexMemory> {
  let version: TomlValue | undefined, dualWrite: TomlValue | undefined, on = false;
  const text = await readFile(join(codexHome, 'config.toml'), 'utf8').catch(() => undefined);
  if (text !== undefined) {
    try {
      version = tomlAt(text, ['memories', 'version']);
      dualWrite = tomlAt(text, ['memories', 'dual_write']);
      on = tomlAt(text, ['features', 'memories']) === true;
    } catch { version = undefined; dualWrite = undefined; }
  }
  const name = version === 'v2' ? 'memories_v2' : version === 'v1' || dualWrite === false || await isFolder(join(codexHome, 'memories')) ? 'memories' : 'memories_v2';
  const folder = join(codexHome, name);
  const path = join(folder, 'memory_summary.md');
  const summary = await readFile(path, 'utf8').then(read => (read.trim() ? read : undefined), () => undefined);
  const at = summary === undefined ? undefined : await stat(path).then(info => info.mtime.toISOString(), () => undefined);
  return { folder, on, ...(summary !== undefined && at ? { summary: { path, text: summary, at } } : {}) };
}

/**
 * The Memory page's view: Claude Code's and Codex's memory where those tools are in this home, and whether Copilot is.
 * Each memory carries where Central Knot has sent it (the home's record).
 */
export async function memoryView(home: string, snapshots: Snapshot[]): Promise<MemoryView> {
  const present = (harness: Snapshot['harness']) => snapshots.find(snapshot => snapshot.harness === harness && isPresent(snapshot));
  const claude = present('claude-cli');
  const codex = present('codex-cli');
  const sent = await readSent(home);
  const marked = (note: MemoryNote): MemoryNote => { const marks = note.unreadable ? [] : sentMarks(sent, note.path, note.hash); return marks.length ? { ...note, sent: marks } : note; };
  const projects = claude ? (await claudeMemory(claude.root, home)).map(project => ({ ...project, notes: project.notes.map(marked) })) : undefined;
  const noted = sent.some(entry => entry.to === 'codex-cli');
  return {
    ...(projects ? { claude: projects } : {}),
    ...(codex ? { codex: { ...await codexMemory(codex.root), ...(noted ? { noted: true as const } : {}) } } : {}),
    copilot: !!present('copilot-cli'),
  };
}

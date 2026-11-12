// MAP.md, the code map at the repository's root, kept true: a cold-start agent reads it first, so it names every file under
// src/ and scripts/ once and nothing that is gone. How MAP.md is read here:
// - A reference is text in backticks whose first word is a file (.ts, .mts, .mjs, .js, .css, .html, .sh, .md or .yml): a bare
//   name (`library.ts`) is in src/ and a bare .md at the root; one with a slash (`scripts/e2e.mjs`) is from the root. Each
//   must exist.
// - One more word in the backticks is a name that file declares (`library.ts decide`, `librarypass.ts Disk.held`).
// - An entry is a reference that starts a list line (`- \`agentfiles.ts\` each tool's agent file`) or a part of one after
//   " · ". Each file under src/ and scripts/ has exactly one entry, and a bare name in backticks in an entry (`agentKind`)
//   is one its file declares.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MAP = 'MAP.md';
const mapLines = readFileSync(join(root, MAP), 'utf8').split('\n');

const FILE = /^[\w./-]+\.(ts|mts|mjs|js|css|html|sh|md|yml)$/;
const NAME = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$/;
const SPLIT = ' · ';

/** Every file under a folder, as a path from the root. */
function filesUnder(folder: string): string[] {
  return readdirSync(join(root, folder)).flatMap(entry => {
    const path = join(folder, entry);
    return statSync(join(root, path)).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Where a file the map names is: a bare code file in src/, a bare .md at the root, anything with a slash from the root. */
const pathOf = (file: string) => (file.includes('/') || file.endsWith('.md') ? file : `src/${file}`);
const exists = (path: string) => { try { return statSync(join(root, path)).isFile(); } catch { return false; } };

/** Whether a file declares `name` (a function, value, type or class; or a re-export). `Type.member`: the type, then the member. */
function declares(path: string, name: string): boolean {
  const text = readFileSync(join(root, path), 'utf8');
  const [first, member] = name.split('.');
  if (!/\.(ts|mts|mjs|js)$/.test(path)) return new RegExp(`\\b${first}\\b`).test(text);
  const declared = new RegExp(`\\b(function\\*?|const|let|var|class|interface|type|enum)\\s+${first.replace('$', '\\$')}\\b`).test(text)
    || new RegExp(`\\bexport\\s*\\{[^}]*\\b${first}\\b[^}]*\\}`).test(text);
  return declared && (!member || new RegExp(`\\b${member}\\b`).test(text));
}

interface Reference { line: number; file: string; path: string; name?: string }
interface Entry extends Reference { names: string[] }

/** One backticked text read as a reference, if its first word is a file. */
function referenceIn(text: string, line: number): Reference | undefined {
  const [file, ...rest] = text.trim().split(/\s+/);
  if (!FILE.test(file)) return undefined;
  const name = rest.length === 1 && NAME.test(rest[0]) ? rest[0] : undefined;
  return { line, file, path: pathOf(file), name };
}

const ticked = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map(match => match[1]);

const references: Reference[] = mapLines.flatMap((text, index) =>
  ticked(text).map(inside => referenceIn(inside, index + 1)).filter((found): found is Reference => !!found));

const entries: Entry[] = mapLines.flatMap((text, index) => {
  if (!/^\s*- `/.test(text)) return [];
  return text.replace(/^\s*- /, '').split(SPLIT).flatMap(segment => {
    const [first, ...others] = ticked(segment);
    const start = segment.trimStart().startsWith('`') && first !== undefined ? referenceIn(first, index + 1) : undefined;
    if (!start) return [];
    return [{ ...start, names: others.filter(other => NAME.test(other)) }];
  });
});

const where = (line: number) => `${MAP}:${line}`;
const fail = (problems: string[]) => assert.equal(problems.length, 0,
  `\n${problems.map(problem => `- ${problem}`).join('\n')}\n(How ${MAP} is read: the header of ${relative(root, fileURLToPath(import.meta.url))}.)`);

test('every file under src/ and scripts/ has exactly one entry in MAP.md', () => {
  const problems: string[] = [];
  for (const path of [...filesUnder('src'), ...filesUnder('scripts')].sort()) {
    const own = entries.filter(entry => entry.path === path);
    const shown = path.startsWith('src/') ? path.slice('src/'.length) : path;
    if (!own.length) problems.push(`${path} has no entry in ${MAP}. Add one to the area that owns it: a list line starting with \`${shown}\` and a few words on what it owns (several entries can share a line, split by "${SPLIT}").`);
    if (own.length > 1) problems.push(`${path} has ${own.length} entries in ${MAP} (${own.map(entry => where(entry.line)).join(', ')}). Keep the one in the area that owns it; elsewhere name it inside a line, not at a list line's start.`);
  }
  fail(problems);
});

test('every file MAP.md names exists', () => {
  fail(references.filter(reference => !exists(reference.path)).map(reference =>
    `${where(reference.line)} names \`${reference.file}\`, and ${reference.path} does not exist. Write its new name, or remove it (and its entry) from ${MAP}.`));
});

test('every name MAP.md gives a file is one that file declares', () => {
  const pairs = references.filter(reference => reference.name && exists(reference.path))
    .map(reference => ({ ...reference, said: `\`${reference.file} ${reference.name}\`` }));
  const inEntries = entries.filter(entry => exists(entry.path)).flatMap(entry =>
    entry.names.map(name => ({ ...entry, name, said: `\`${name}\` in the entry for \`${entry.file}\`` })));
  fail([...pairs, ...inEntries].filter(pair => !declares(pair.path, pair.name!)).map(pair =>
    `${where(pair.line)} names ${pair.said}, and ${pair.path} declares no ${pair.name}. Write the name it has now, or drop it.`));
});

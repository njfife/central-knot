// Preserving edits (FIL-02): change one entry in a config file and leave every other byte as it was.
// JSON: a member of an object at a path. TOML: the [mcp_servers.<name>] table and its subtables.

// ---------- JSON ----------

interface Span { start: number; end: number }
interface Member { key: string; keySpan: Span; value: Span; whole: Span }

const isSpace = (char: string) => char === ' ' || char === '\t' || char === '\n' || char === '\r';

function skipSpace(text: string, at: number): number {
  for (;;) {
    while (at < text.length && isSpace(text[at])) at++;
    // Comments are tolerated (JSONC) and kept: they sit outside any value we replace.
    if (text.startsWith('//', at)) { at = text.indexOf('\n', at); if (at < 0) return text.length; continue; }
    if (text.startsWith('/*', at)) { const end = text.indexOf('*/', at + 2); at = end < 0 ? text.length : end + 2; continue; }
    return at;
  }
}

function scanString(text: string, at: number): number {
  if (text[at] !== '"') throw new Error('Expected a string.');
  for (let index = at + 1; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '"') return index + 1;
  }
  throw new Error('Unterminated string.');
}

function scanValue(text: string, at: number): number {
  at = skipSpace(text, at);
  const char = text[at];
  if (char === '"') return scanString(text, at);
  if (char === '{' || char === '[') {
    const close = char === '{' ? '}' : ']';
    let index = at + 1;
    for (;;) {
      index = skipSpace(text, index);
      if (text[index] === close) return index + 1;
      if (char === '{') { index = scanString(text, index); index = skipSpace(text, index); if (text[index] !== ':') throw new Error('Expected ":".'); index++; }
      index = scanValue(text, index);
      index = skipSpace(text, index);
      if (text[index] === ',') { index++; continue; }
      if (text[index] === close) return index + 1;
      throw new Error('Expected "," or a closing bracket.');
    }
  }
  const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at, at + 64));
  if (!match) throw new Error('Unexpected value.');
  return at + match[0].length;
}

/**
 * A JSON file that may hold comments and trailing commas (JSONC, as OpenCode's settings may), parsed. The text is not changed:
 * comments become spaces and a comma before a closing bracket is dropped, outside strings only. Throws when it is not JSON then.
 */
export function readJsonc(text: string): unknown {
  let plain = '';
  for (let at = text.charCodeAt(0) === 0xfeff ? 1 : 0; at < text.length;) {
    if (text[at] === '"') { const end = scanString(text, at); plain += text.slice(at, end); at = end; continue; }
    if (text.startsWith('//', at) || text.startsWith('/*', at)) { const end = skipSpace(text, at); plain += ' '; at = Math.max(end, at + 2); continue; }
    if (text[at] === ',') { const next = skipSpace(text, at + 1); if (text[next] === '}' || text[next] === ']') { at++; continue; } }
    plain += text[at++];
  }
  return JSON.parse(plain);
}

/** The members of the object starting at `at` (the "{"). */
function members(text: string, at: number): { members: Member[]; close: number } {
  const list: Member[] = [];
  let index = at + 1;
  for (;;) {
    index = skipSpace(text, index);
    if (text[index] === '}') return { members: list, close: index };
    const keyStart = index;
    index = scanString(text, index);
    const key = JSON.parse(text.slice(keyStart, index)) as string;
    index = skipSpace(text, index);
    if (text[index] !== ':') throw new Error('Expected ":".');
    const valueStart = skipSpace(text, index + 1);
    const valueEnd = scanValue(text, valueStart);
    list.push({ key, keySpan: { start: keyStart, end: keyStart + (index - keyStart) }, value: { start: valueStart, end: valueEnd }, whole: { start: keyStart, end: valueEnd } });
    index = skipSpace(text, valueEnd);
    if (text[index] === ',') { index++; continue; }
    if (text[index] === '}') return { members: list, close: index };
    throw new Error('Expected "," or "}".');
  }
}

/** The indentation used for members of an object, guessed from its first member, else two spaces deeper than its opening line. */
function indentOf(text: string, objectStart: number, list: Member[]): { inner: string; outer: string } {
  const lineStart = (at: number) => text.lastIndexOf('\n', at - 1) + 1;
  const outer = /^[ \t]*/.exec(text.slice(lineStart(objectStart)))![0];
  if (list.length) {
    const first = list[0].keySpan.start;
    const inner = text.slice(lineStart(first), first);
    if (/^[ \t]*$/.test(inner)) return { inner, outer };
  }
  const unit = /\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
  return { inner: outer + unit.replace(outer, '') || outer + '  ', outer };
}

/**
 * The text without one member and one neighbouring comma, keeping the surrounding layout. A member on a line of its own goes
 * with that line, the comment lines directly above it (unless it is the first member) and a comment after it on its line, so
 * every other member keeps its own comments (OpenCode's settings may have them). One written beside others on a line goes up to the next member, or
 * back to the one before.
 */
function withoutMember(text: string, list: Member[], index: number, objectStart: number, close: number): string {
  const found = list[index];
  if (list.length === 1) return text.slice(0, objectStart + 1) + text.slice(close);
  const blank = (at: number) => { while (text[at] === ' ' || text[at] === '\t') at++; return at; };
  const lineStart = text.lastIndexOf('\n', found.whole.start - 1) + 1;
  // Its own comma, then what is left of its line: a comment, and the line break.
  const comma = text[blank(found.whole.end)] === ',';
  let rest = blank(comma ? blank(found.whole.end) + 1 : found.whole.end);
  if (text.startsWith('//', rest)) rest = text.indexOf('\n', rest) < 0 ? text.length : text.indexOf('\n', rest);
  else if (text.startsWith('/*', rest) && text.indexOf('*/', rest) >= 0) rest = blank(text.indexOf('*/', rest) + 2);
  if (text[rest] === '\r') rest++;
  // Not alone on its line (the object's brace or another member shares it): up to the next member, or back to the one before.
  if (lineStart <= objectStart || text.slice(lineStart, found.whole.start).trim() || text[rest] !== '\n') {
    return index < list.length - 1 ? text.slice(0, found.whole.start) + text.slice(list[index + 1].whole.start) : text.slice(0, list[index - 1].whole.end) + text.slice(found.whole.end);
  }
  const end = rest + 1;
  // The comment lines directly above it are about it; above the first member they may be about the whole object, and stay.
  let start = lineStart;
  for (; index > 0;) {
    const above = text.lastIndexOf('\n', start - 2) + 1;
    if (above <= objectStart || above >= start || !/^[ \t]*(\/\/.*|\/\*.*\*\/[ \t]*)\r?\n$/.test(text.slice(above, start))) break;
    start = above;
  }
  // The last member has no comma of its own: the one before it goes instead.
  const before = skipSpace(text, list[index - 1]?.whole.end ?? 0);
  const head = !comma && index === list.length - 1 && text[before] === ',' ? text.slice(0, before) + text.slice(before + 1, start) : text.slice(0, start);
  return head + text.slice(end);
}

const reindent = (json: string, indent: string) => json.split('\n').map((line, index) => (index === 0 ? line : indent + line)).join('\n');

/**
 * Sets (or with `undefined`, removes) the member at `path` inside a JSON object document, changing only that member's text.
 * Missing parent objects on the path are created. An empty or whitespace-only text starts a new document.
 */
export function setJsonMember(text: string, path: string[], value: unknown): string {
  if (!text.trim()) return value === undefined ? text : `${JSON.stringify(path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value), null, 2)}\n`;
  let objectStart = skipSpace(text, 0);
  if (text[objectStart] !== '{') throw new Error('The file is not a JSON object.');
  for (let depth = 0; depth < path.length; depth++) {
    const { members: list, close } = members(text, objectStart);
    const key = path[depth];
    const found = list.find(member => member.key === key);
    const last = depth === path.length - 1;
    if (found && !last) {
      if (text[found.value.start] !== '{') throw new Error(`"${key}" is not an object.`);
      objectStart = found.value.start;
      continue;
    }
    const { inner } = indentOf(text, objectStart, list);
    const rest = path.slice(depth + 1);
    const newValue = last ? value : rest.reduceRight<unknown>((innerValue, part) => ({ [part]: innerValue }), value);
    if (found) {
      if (value === undefined && last) return withoutMember(text, list, list.indexOf(found), objectStart, close);
      return text.slice(0, found.value.start) + reindent(JSON.stringify(newValue, null, 2), inner) + text.slice(found.value.end);
    }
    if (value === undefined) return text;
    const entry = `${JSON.stringify(key)}: ${reindent(JSON.stringify(newValue, null, 2), inner)}`;
    if (!list.length) {
      const { outer } = indentOf(text, objectStart, list);
      return `${text.slice(0, objectStart + 1)}\n${inner}${entry}\n${outer}${text.slice(close)}`;
    }
    const after = list[list.length - 1].whole.end;
    return `${text.slice(0, after)},\n${inner}${entry}${text.slice(after)}`;
  }
  return text;
}

// ---------- TOML (the subset Codex MCP tables use) ----------

export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };

/** One `key = value` line in a table, with its raw text so unknown keys can be written back exactly. */
export interface TomlEntry { key: string; /** The key's parts as decoded, so a quoted part may itself contain dots. */ keys: string[]; value: TomlValue; raw: string; /** Where the entry's line starts and its line ends, in the document. */ start: number; end: number }
/** `array`: one `[[path]]` block of an array of tables (each block is its own TomlTable, in document order). */
export interface TomlTable { header: string; path: string[]; entries: TomlEntry[]; start: number; end: number; array?: boolean }

function parseKey(text: string, at: number): { key: string; next: number } {
  if (text[at] === '"') { const end = scanString(text, at); return { key: JSON.parse(text.slice(at, end)), next: end }; }
  if (text[at] === "'") { const end = text.indexOf("'", at + 1); return { key: text.slice(at + 1, end), next: end + 1 }; }
  const match = /^[A-Za-z0-9_-]+/.exec(text.slice(at));
  if (!match) throw new Error('Expected a key.');
  return { key: match[0], next: at + match[0].length };
}

function parseDotted(text: string, at: number): { keys: string[]; next: number } {
  const keys: string[] = [];
  for (;;) {
    while (text[at] === ' ' || text[at] === '\t') at++;
    const part = parseKey(text, at);
    keys.push(part.key);
    at = part.next;
    while (text[at] === ' ' || text[at] === '\t') at++;
    if (text[at] !== '.') return { keys, next: at };
    at++;
  }
}

function skipTomlSpace(text: string, at: number, newlines: boolean): number {
  for (;;) {
    while (at < text.length && (text[at] === ' ' || text[at] === '\t' || (newlines && (text[at] === '\n' || text[at] === '\r')))) at++;
    if (newlines && text[at] === '#') { const end = text.indexOf('\n', at); at = end < 0 ? text.length : end; continue; }
    return at;
  }
}

/** A multi-line string: the first newline is trimmed, up to two quotes may touch the closing delimiter, basic strings unescape. */
function parseMultiline(text: string, at: number): { value: TomlValue; next: number } {
  const quote = text.slice(at, at + 3);
  let index = at + 3;
  if (text[index] === '\r' && text[index + 1] === '\n') index += 2;
  else if (text[index] === '\n') index++;
  let out = '';
  const escapes: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
  for (;;) {
    if (index >= text.length) throw new Error('Unterminated multi-line string.');
    if (text.startsWith(quote, index)) {
      let length = 3;
      while (length < 5 && text[index + length] === quote[0]) length++;
      return { value: out + quote[0].repeat(length - 3), next: index + length };
    }
    const char = text[index];
    if (quote === '"""' && char === '\\') {
      const escape = text[index + 1];
      if (escape === ' ' || escape === '\t' || escape === '\n' || escape === '\r') {
        let after = index + 1;
        while (text[after] === ' ' || text[after] === '\t') after++;
        if (text[after] !== '\n' && text[after] !== '\r') throw new Error('Bad escape in a string.');
        while (after < text.length && /[ \t\r\n]/.test(text[after])) after++;
        index = after;
        continue;
      }
      if (escape in escapes) { out += escapes[escape]; index += 2; continue; }
      if (escape === 'u' || escape === 'U') {
        const size = escape === 'u' ? 4 : 8;
        const hex = text.slice(index + 2, index + 2 + size);
        if (!new RegExp(`^[0-9a-fA-F]{${size}}$`).test(hex)) throw new Error('Bad escape in a string.');
        out += String.fromCodePoint(parseInt(hex, 16));
        index += 2 + size;
        continue;
      }
      throw new Error('Bad escape in a string.');
    }
    out += char;
    index++;
  }
}

function parseTomlValue(text: string, at: number): { value: TomlValue; next: number } {
  at = skipTomlSpace(text, at, false);
  const char = text[at];
  if (text.startsWith('"""', at) || text.startsWith("'''", at)) return parseMultiline(text, at);
  if (char === '"') { const end = scanString(text, at); return { value: JSON.parse(text.slice(at, end)), next: end }; }
  if (char === "'") { const end = text.indexOf("'", at + 1); if (end < 0) throw new Error('Unterminated string.'); return { value: text.slice(at + 1, end), next: end + 1 }; }
  if (char === '[') {
    const list: TomlValue[] = [];
    let index = at + 1;
    for (;;) {
      index = skipTomlSpace(text, index, true);
      if (text[index] === ']') return { value: list, next: index + 1 };
      const item = parseTomlValue(text, index);
      list.push(item.value);
      index = skipTomlSpace(text, item.next, true);
      if (text[index] === ',') { index++; continue; }
      if (text[index] === ']') return { value: list, next: index + 1 };
      throw new Error('Expected "," or "]".');
    }
  }
  if (char === '{') {
    const table: Record<string, TomlValue> = {};
    let index = at + 1;
    for (;;) {
      index = skipTomlSpace(text, index, false);
      if (text[index] === '}') return { value: table, next: index + 1 };
      const { keys, next } = parseDotted(text, index);
      index = skipTomlSpace(text, next, false);
      if (text[index] !== '=') throw new Error('Expected "=".');
      const item = parseTomlValue(text, index + 1);
      let target = table;
      for (const key of keys.slice(0, -1)) target = (target[key] ??= {}) as Record<string, TomlValue>;
      target[keys[keys.length - 1]] = item.value;
      index = skipTomlSpace(text, item.next, false);
      if (text[index] === ',') { index++; continue; }
      if (text[index] === '}') return { value: table, next: index + 1 };
      throw new Error('Expected "," or "}".');
    }
  }
  const match = /^(?:true|false|[+-]?(?:\d[\d_]*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
  if (!match) throw new Error('Unsupported TOML value.');
  const word = match[0];
  return { value: word === 'true' ? true : word === 'false' ? false : Number(word.replace(/_/g, '')), next: at + word.length };
}

/**
 * Every table in a TOML document with its key lines, and each `[[array]]` block as its own table; text outside tables is the
 * root. Throws on what it cannot read.
 */
export function readTomlTables(text: string): TomlTable[] {
  const tables: TomlTable[] = [];
  let current: TomlTable = { header: '', path: [], entries: [], start: 0, end: 0 };
  tables.push(current);
  let at = 0;
  while (at < text.length) {
    const lineStart = at;
    at = skipTomlSpace(text, at, false);
    const char = text[at];
    if (char === undefined) break;
    if (char === '\n' || char === '\r' || char === '#') { const end = text.indexOf('\n', at); at = end < 0 ? text.length : end + 1; continue; }
    if (char === '[') {
      const array = text[at + 1] === '[';
      const { keys, next } = parseDotted(text, at + (array ? 2 : 1));
      const close = skipTomlSpace(text, next, false);
      if (text[close] !== ']' || (array && text[close + 1] !== ']')) throw new Error(array ? 'Expected "]]".' : 'Expected "]".');
      const headerEnd = close + (array ? 2 : 1);
      current.end = lineStart;
      current = { header: text.slice(at, headerEnd), path: keys, entries: [], start: lineStart, end: text.length, ...(array ? { array } : {}) };
      tables.push(current);
      const end = text.indexOf('\n', headerEnd);
      at = end < 0 ? text.length : end + 1;
      continue;
    }
    const { keys, next } = parseDotted(text, at);
    const equals = skipTomlSpace(text, next, false);
    if (text[equals] !== '=') throw new Error('Expected "=".');
    const item = parseTomlValue(text, equals + 1);
    const lineEnd = text.indexOf('\n', item.next);
    const end = lineEnd < 0 ? text.length : lineEnd + 1;
    current.entries.push({ key: keys.join('.'), keys, value: item.value, raw: text.slice(lineStart, end), start: lineStart, end });
    at = end;
  }
  current.end = text.length;
  return tables;
}

const bareKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key));

/** TOML text for a value: strings as basic strings, arrays and plain objects inline. */
export function tomlValue(value: TomlValue): string {
  // TOML basic strings forbid DEL, which JSON leaves as is.
  if (typeof value === 'string') return JSON.stringify(value).replace(/\x7f/g, '\\u007f');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  return `{ ${Object.entries(value).map(([key, item]) => `${bareKey(key)} = ${tomlValue(item)}`).join(', ')} }`;
}

/** Adds a table at the end of a TOML document, one blank line after what is there, with the document's line ending `eol`. */
function appendToml(text: string, body: string, eol = '\n'): string {
  return `${text}${text && !text.endsWith('\n') ? eol : ''}${text.trim() ? eol : ''}${body.endsWith('\n') ? body : `${body}${eol}`}`;
}

/**
 * Where a table's own lines end. Its text runs to the next header, but comment lines at its end sit just above that
 * header and belong to what follows: they stay.
 */
function ownEnd(text: string, table: TomlTable): number {
  const lines = text.slice(table.start, table.end).split(/(?<=\n)/);
  let cut = lines.length;
  for (let index = lines.length - 1; index > 0; index--) {
    const line = lines[index]!.trim();
    if (line.startsWith('#')) { cut = index; continue; }
    if (line === '') continue;
    break;
  }
  return table.start + lines.slice(0, cut).join('').length;
}

/**
 * Takes `tables` (read from `text`) out, with `replacement` in place of the first when given. Everything else stays byte
 * for byte, apart from, with `endGap`, the one blank line appendToml puts before a table that ended the document.
 */
function cutTables(text: string, tables: TomlTable[], replacement?: string, { endGap = false, eol = '\n' } = {}): string {
  let out = '';
  let cursor = 0;
  tables.forEach((table, index) => {
    out += text.slice(cursor, table.start);
    if (index === 0 && replacement !== undefined) out += replacement.endsWith('\n') ? replacement : `${replacement}\n`;
    cursor = ownEnd(text, table);
  });
  const rest = text.slice(cursor);
  return endGap && replacement === undefined && rest === '' && out.endsWith(eol + eol) ? out.slice(0, -eol.length) : out + rest;
}

/**
 * Replaces the table `[prefix.name]` and its subtables `[prefix.name.*]` with `body` (or removes them when `body` is
 * undefined). Everything else, including comments and other tables, stays byte for byte. A new table goes at the end.
 * `endGap`: a table taken from the document's end takes with it the blank line that was put before it, so adding a table
 * and removing it again leaves the file as it was (apart from a final newline the file lacked).
 */
export function setTomlTable(text: string, prefix: string[], name: string, body: string | undefined, { endGap = false } = {}): string {
  // `[[…]]` blocks are never a table's own (the MCP reader leaves them out too), so rewriting a server keeps them.
  const owns = (table: TomlTable) => !table.array && table.path.length > prefix.length && prefix.every((part, index) => table.path[index] === part) && table.path[prefix.length] === name;
  const mine = readTomlTables(text).filter(owns);
  // A file written with Windows line endings keeps them in what `endGap` adds or takes back.
  const eol = endGap && text.includes('\r\n') ? '\r\n' : '\n';
  if (!mine.length) return body === undefined ? text : appendToml(text, body, eol);
  // Rebuilt in place of the first of its tables; its other tables are dropped wherever they are.
  return cutTables(text, mine, body, { endGap, eol });
}

/**
 * Removes the `[[path]]` blocks `drop` picks and, with `add`, appends one more `[[path]]` block holding those entries.
 * Other blocks, comments and tables stay byte for byte (the order of blocks matters to their readers: Codex lets the last
 * `[[skills.config]]` that matches a skill decide), so a block added and then dropped leaves the file as it was, apart
 * from a final newline the file lacked. A block's own subtables (`[path.sub]`) are not handled; Codex writes none.
 */
export function editTomlArray(text: string, path: string[], drop: (table: TomlTable) => boolean, add?: Record<string, TomlValue>): string {
  const blocks = readTomlTables(text).filter(table => table.array && table.path.length === path.length && table.path.every((part, index) => part === path[index]));
  const dropped = blocks.filter(drop);
  // A file written with Windows line endings keeps them.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const kept = dropped.length ? cutTables(text, dropped, undefined, { endGap: true, eol }) : text;
  if (!add) return kept;
  return appendToml(kept, `[[${path.map(bareKey).join('.')}]]${eol}${Object.entries(add).map(([key, value]) => `${bareKey(key)} = ${tomlValue(value)}${eol}`).join('')}`, eol);
}

/** The header for `[prefix.name]` and its subtables, quoting a name that needs it. */
export const tomlHeader = (path: string[]) => `[${path.map(bareKey).join('.')}]`;

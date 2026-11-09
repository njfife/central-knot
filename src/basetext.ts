// Base instructions inside a tool's own instruction file: one marked block, after that tool's own text.
// Everything outside the block is the tool's own text and is never rewritten here; only the block is added, replaced or taken out.

const START = '<!-- Central Knot base instructions: start (shared by your tools; edit them in Central Knot) -->';
const END = '<!-- Central Knot base instructions: end -->';
const isMarker = (line: string, which: 'start' | 'end') => line.trimStart().startsWith(`<!-- Central Knot base instructions: ${which}`);

/** Base text as a block holds it: ending in a line break. */
const asLines = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);
const markedBlock = (base: string) => `${START}\n${asLines(base)}${END}\n`;

interface Located { before: string; copy: string; after: string }

/** Finds the block. A start marker with no end marker runs to the end of the file, so its text is never taken for the tool's own. */
function locate(text: string): Located | undefined {
  let offset = 0, start = -1, copyStart = 0;
  for (const line of text.split('\n')) {
    const next = offset + line.length + 1;
    if (start < 0 && isMarker(line, 'start')) { start = offset; copyStart = Math.min(next, text.length); }
    else if (start >= 0 && isMarker(line, 'end')) return { before: text.slice(0, start), copy: text.slice(copyStart, offset), after: text.slice(Math.min(next, text.length)) };
    offset = next;
  }
  return start < 0 ? undefined : { before: text.slice(0, start), copy: text.slice(copyStart), after: '' };
}

/** A file's own text and, if it has one, its copy of the base. */
export function splitBase(text: string): { own: string; copy?: string } {
  const found = locate(text);
  if (!found) return { own: text };
  // The blank line put before the block when it was added belongs to neither side.
  const before = found.before.endsWith('\n\n') ? found.before.slice(0, -1) : found.before;
  return { own: before + found.after, copy: found.copy };
}

/** Whether a file's copy says the same as this base (a missing final line break doesn't count). */
export const sameBase = (copy: string | undefined, base: string) => copy !== undefined && asLines(copy) === asLines(base);

/** The file with this base in it: an existing block is replaced where it stands; otherwise the block goes after the own text. */
export function withBase(text: string, base: string): string {
  if (!base.trim()) return withoutBase(text);
  const found = locate(text);
  if (found) return found.before + markedBlock(base) + found.after;
  return text.trim() ? `${asLines(text)}\n${markedBlock(base)}` : markedBlock(base);
}

/** The file with its own text replaced and its block (if any) kept as it is, after the own text. */
export function withOwn(text: string, own: string): string {
  const found = locate(text);
  if (!found) return own;
  const block = `${START}\n${found.copy}${found.copy && !found.copy.endsWith('\n') ? '\n' : ''}${END}\n`;
  return own.trim() ? `${asLines(own)}\n${block}` : block;
}

/** The file without the block. If nothing of its own would be left, the base text stays as plain text, so the file is never emptied. */
export function withoutBase(text: string): string {
  const { own, copy } = splitBase(text);
  if (copy === undefined) return text;
  return own.trim() ? own : asLines(copy);
}

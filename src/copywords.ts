// The copy question's words (matrix.ts compareChoices puts them in its rows): how a copy's quote is shortened, which line its
// own words are marked against, what choosing a copy does, and why a copy can't be chosen. Each rule is one function here,
// with worked examples in tests/copywords.test.ts. Not here, because they are built from the page's own parts: whose copy a
// row is and the line under its name (matrix.ts compareChoices), which line of a copy is quoted (matrix.ts copyQuote) and
// how an MCP command is set (matrix.ts entryWords).
import { lineDiff } from './diff.ts';
import { andList, sentence } from './words.ts';

/** The most characters of a skill's or an agent's text that a row quotes. */
export const QUOTE_LIMIT = 140;
/** How much of the line leads up to the place where the copies part, at the least, in a quote that can't start at the line's beginning. */
const BEFORE_DIFFERENCE = 40;

/** A quote as a row shows it: the words kept (`start`: where they begin in the text), and "…" at an end where words were left out. */
export interface ShortQuote { lead: '' | '…'; words: string; tail: '' | '…'; start: number }

/**
 * The one place that decides how a row shortens a copy's quote, for every kind:
 *  - a skill's line or an agent's of at most QUOTE_LIMIT characters is whole;
 *  - a longer one keeps the whole words that fit and says so with "…" (the row puts it inside the quotation marks), so a cut
 *    quote never reads as the whole sentence;
 *  - an agent's longer line is quoted where it parts from the other copy's line (`differsAt`: where the words only this copy
 *    has start or, when it has none, where the other's would go). The word at that place is never the part left out: the
 *    quote starts at the earliest of three places from which that word ends within the limit: the line's beginning, a few
 *    words before it (BEFORE_DIFFERENCE), the word itself. Only a word longer than the whole limit is cut. Two copies of one
 *    long line are so quoted through the same stretch, and the one that simply stops sooner is seen to;
 *  - an MCP server's command or address is never shortened: its row is the only place the question shows it.
 */
export function shortQuote(kind: 'skills' | 'mcp' | 'agents', text: string, differsAt = 0): ShortQuote {
  if (kind === 'mcp' || text.length <= QUOTE_LIMIT) return { lead: '', words: text, tail: '', start: 0 };
  /** Where the last word begins that starts at or before character `at`. */
  const wordAt = (at: number) => text.lastIndexOf(' ', at - 1) + 1;
  // Where the word at that place ends: the line's end, when it is the last word or this line has nothing there.
  const wordEnd = text.indexOf(' ', differsAt) < 0 ? text.length : text.indexOf(' ', differsAt);
  const before = wordAt(differsAt - BEFORE_DIFFERENCE);
  // The word itself, or this line's last word when it has nothing at that place, so there is always something to quote.
  const itself = Math.min(differsAt, wordAt(text.length));
  const start = wordEnd <= QUOTE_LIMIT ? 0 : wordEnd - before <= QUOTE_LIMIT ? before : itself;
  let end = Math.min(text.length, start + QUOTE_LIMIT);
  // Cut at a word: back to the last space, unless that would drop the word at that place (it is longer than the limit).
  const space = text.lastIndexOf(' ', end);
  if (end < text.length && space > Math.max(start, differsAt)) end = space;
  return { lead: start ? '…' : '', words: text.slice(start, end).replace(/[\s,;:]+$/, ''), tail: end < text.length ? '…' : '', start };
}

/**
 * Of `lines`, the one most like `line`: the one that shares the most of its words, in order (none, when no line shares a
 * word). A row marks the words only its copy has against this line, so a line that is the same but for a few words is
 * chosen over one that only shares "the" and "and" here and there.
 */
export function nearestLine(line: string, lines: string[]): string | undefined {
  const words = (text: string) => text.split(/\s+/).filter(Boolean).join('\n');
  let nearest: string | undefined, most = 0;
  for (const other of lines) {
    const shared = lineDiff(words(other), words(line)).filter(part => part.kind === 'same').length;
    if (shared > most) { nearest = other; most = shared; }
  }
  return nearest;
}

/**
 * What choosing a copy does, said under its quote: the copies it replaces (`replaced`: their tools' names) and the tools it
 * adds the item to (`receiving`); `later`, those of them whose change waits for Write to Claude Code ("at Write"). More than two
 * replaced copies are counted, not named ("Replaces the other 4 copies."): the rows already name every copy, so five choices
 * would each repeat four names.
 */
export function choiceEffect(replaced: string[], receiving: string[], later: string[] = []): string {
  const at = (name: string, words: string) => (later.includes(name) ? `${words} at Write` : words);
  const replaces = replaced.length > 2 ? `replaces the other ${replaced.length} copies` : replaced.length ? `replaces ${andList(replaced.map(name => at(name, `${name}’s copy`)))}` : '';
  const adds = receiving.length ? `adds it to ${andList(receiving.map(name => at(name, name)))}` : '';
  return `${sentence([replaces, adds].filter(Boolean).join('; '))}.`;
}

/**
 * Why a copy can't be chosen, said once. `cause` is a sentence naming the tool as the page names it ("Copilot CLI will not
 * load a skill with no YAML frontmatter."). A row says it under the copy's own name; a result names the copy (`whose`: its tool).
 */
export const cantUse = (cause: string, whose?: string) => `${whose ? `${whose}’s copy can’t` : 'Can’t'} be used: ${cause}`;

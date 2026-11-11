// The copy question's words (matrix.ts compareChoices puts them in its rows): how a copy's quote is shortened, what choosing
// a copy does, and why a copy can't be chosen. Each rule is one function here, with worked examples in tests/copywords.test.ts.
import { andList, sentence } from './words.ts';

/** The most characters of a skill's or an agent's text that a row quotes. */
export const QUOTE_LIMIT = 140;
/** How much of a shortened quote may come before the words only this copy has, so they are never the part left out. */
const BEFORE_OWN = 40;

/** A quote as a row shows it: the words kept, and "…" at an end where words were left out. */
export interface ShortQuote { lead: '' | '…'; words: string; tail: '' | '…' }

/**
 * The one place that decides how a row shortens a copy's quote, for every kind:
 *  - a skill's line or an agent's of at most QUOTE_LIMIT characters is whole;
 *  - a longer one keeps the whole words that fit and says so with "…" (the row puts it inside the quotation marks), so a cut
 *    quote never reads as the whole sentence. It starts at the line's beginning, unless the words only this copy has (`own`:
 *    where they start, for an agent's line) would then be left out or nearly; then it starts a few words before them;
 *  - an MCP server's command or address is never shortened: its row is the only place the question shows it.
 */
export function shortQuote(kind: 'skills' | 'mcp' | 'agents', text: string, own = 0): ShortQuote {
  if (kind === 'mcp' || text.length <= QUOTE_LIMIT) return { lead: '', words: text, tail: '' };
  const start = own <= QUOTE_LIMIT - BEFORE_OWN ? 0 : text.lastIndexOf(' ', own - BEFORE_OWN) + 1;
  let end = Math.min(text.length, start + QUOTE_LIMIT);
  // Cut at a word: back to the last space, unless one word alone is longer than the limit.
  if (end < text.length && text.lastIndexOf(' ', end) > start) end = text.lastIndexOf(' ', end);
  return { lead: start ? '…' : '', words: text.slice(start, end).replace(/[\s,;:]+$/, ''), tail: end < text.length ? '…' : '' };
}

/**
 * What choosing a copy does, said under its quote: the copies it replaces (`replaced`: their tools' names) and the tools it
 * adds the item to (`receiving`). More than two replaced copies are counted, not named ("Replaces the other 4 copies."): the
 * rows already name every copy, so five choices would each repeat four names.
 */
export function choiceEffect(replaced: string[], receiving: string[]): string {
  const replaces = replaced.length > 2 ? `replaces the other ${replaced.length} copies` : replaced.length ? `replaces ${andList(replaced.map(name => `${name}’s copy`))}` : '';
  const adds = receiving.length ? `adds it to ${andList(receiving)}` : '';
  return `${sentence([replaces, adds].filter(Boolean).join('; '))}.`;
}

/**
 * Why a copy can't be chosen, said once. `cause` is a sentence naming the tool as the page names it ("Copilot CLI will not
 * load a skill with no YAML frontmatter."). A row says it under the copy's own name; a result names the copy (`whose`: its tool).
 */
export const cantUse = (cause: string, whose?: string) => `${whose ? `${whose}’s copy can’t` : 'Can’t'} be used: ${cause}`;

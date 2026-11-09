// A small Markdown reader for READMEs from marketplaces, in two parts: parseMarkdown turns text into plain data (tested
// without a DOM), and markdown builds elements from that data with text nodes only. Raw HTML is shown as text or dropped,
// images as their alt text, and only https links can be followed, in the browser.
import { isHttps } from './values.ts';
import { h } from './dom.ts';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong' | 'em'; children: Inline[] }
  | { kind: 'link'; label: Inline[]; url: string }
  | { kind: 'image'; alt: string };
export type Block =
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][]; /** The first number of a numbered list, when it isn't 1. */ start?: number }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };
export interface MarkdownOptions {
  /** Leave out an opening heading that only repeats this name. */
  skipTitle?: string;
  /** Leave out a first paragraph that mostly repeats one of these (a description already on the page). */
  skipLead?: string[];
  /** Parts the page already lists with their descriptions (a plugin's skills, commands, agents): see trimRepeats. */
  skipParts?: { name: string; description: string }[];
}

const MAX_QUOTE_DEPTH = 6;
// Each pattern is tried only where its first character appears, and every repeat is bounded, so no README can make the
// scan slow. Underscore emphasis needs a space (or bracket) before and after it, so snake_case names and __init__.py stay
// as they are.
const PATTERNS: [RegExp, (match: RegExpExecArray) => Inline[]][] = [
  [/\*\*([^*\n]{1,300}?)\*\*/y, match => [{ kind: 'strong', children: inlineText(match[1]!) }]],
  [/(?<![^\s(])__([^_\n]{1,300}?)__(?![^\s),;:!?])/y, match => [{ kind: 'strong', children: inlineText(match[1]!) }]],
  [/\*([^*\s][^*\n]{0,300}?)\*/y, match => [{ kind: 'em', children: inlineText(match[1]!) }]],
  [/(?<![^\s(])_([^_\s][^_\n]{0,300}?)_(?![^\s),;:!?])/y, match => [{ kind: 'em', children: inlineText(match[1]!) }]],
  [/\\([\\`*_{}[\]()#+\-.!|<>])/y, match => [{ kind: 'text', text: match[1]! }]],
  // A badge: an image inside a link. Its label is the image's alt text.
  [/\[!\[([^\]\n]{0,300})\]\([^)\s]{1,500}\)\]\(([^)\s]{1,500})\)/y, match => (match[1] ? linkOrText([{ kind: 'text', text: match[1] }], match[2]!) : [])],
  [/!\[([^\]\n]{0,300})\]\([^)\s]{1,500}(?:\s+"[^"\n]{0,300}")?\)/y, match => [{ kind: 'image', alt: match[1]! }]],
  [/\[([^\]\n]{1,300})\]\(([^)\s]{1,500})(?:\s+"[^"\n]{0,300}")?\)/y, match => linkOrText(inlineText(match[1]!), match[2]!)],
  [/<(https:\/\/[^>\s]{1,500})>/y, match => linkOrText([{ kind: 'text', text: match[1]! }], match[1]!)],
  [/https:\/\/[^\s<>()]{0,499}[^\s<>().,;:!?'"]/y, match => linkOrText([{ kind: 'text', text: match[0] }], match[0])],
];
/** Tags of the HTML found in READMEs. Only these are dropped: other <words> (an "install <name>" placeholder) stay as text. */
const HTML_TAG = /<\/?(?:a|abbr|b|blockquote|br|center|code|details|div|em|h[1-6]|hr|i|img|kbd|li|ol|p|picture|pre|source|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul|video)\b[^>]{0,300}>/gi;
const STARTS = /[*_![<h\\]/g;

/** An https link stays a link; anything else (relative paths, other schemes) is just its label. */
const linkOrText = (label: Inline[], url: string): Inline[] => (isHttps(url) ? [{ kind: 'link', label, url }] : label);

/** Text with no code spans in it: tags are dropped (autolinks kept), then emphasis and links are found. */
function inlineText(text: string): Inline[] {
  const plain = text.replace(HTML_TAG, '');
  const out: Inline[] = [];
  let from = 0;
  let last = 0;
  // Each call scans with its own copy: nested calls (emphasis inside a link) must not move this one's position.
  const starts = new RegExp(STARTS.source, 'g');
  for (let start = starts.exec(plain); start; start = starts.exec(plain)) {
    if (start.index < from) continue;
    for (const [pattern, build] of PATTERNS) {
      pattern.lastIndex = start.index;
      const match = pattern.exec(plain);
      if (!match) continue;
      if (match.index > last) out.push({ kind: 'text', text: plain.slice(last, match.index) });
      out.push(...build(match));
      last = from = match.index + match[0].length;
      starts.lastIndex = from;
      break;
    }
  }
  if (last < plain.length) out.push({ kind: 'text', text: plain.slice(last) });
  return out;
}

/**
 * A line's inline content. Code spans are set aside first, so what is inside them (`<plugin>@<marketplace>`) is kept
 * exactly and emphasis around them (**use `x` now**) still works; they go back in where they were.
 */
export function parseInline(text: string): Inline[] {
  const codes: string[] = [];
  const marked = text.replace(/`([^`\n]{1,500})`/g, (_whole, code: string) => `\uE000${codes.push(code) - 1}\uE001`);
  const restore = (parts: Inline[]): Inline[] => parts.flatMap((part): Inline[] => {
    if (part.kind === 'text') return part.text.split(/\uE000(\d+)\uE001/).map((piece, at): Inline => (at % 2 ? { kind: 'code', text: codes[Number(piece)] ?? '' } : { kind: 'text', text: piece })).filter(piece => piece.kind === 'code' || (piece.kind === 'text' && !!piece.text));
    if (part.kind === 'strong' || part.kind === 'em') return [{ ...part, children: restore(part.children) }];
    if (part.kind === 'link') return [{ ...part, label: restore(part.label) }];
    return [part];
  });
  return restore(inlineText(marked));
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => parseInline(cell.trim()));
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

/**
 * An ATX heading ("## Title ##"): its level and text, without the closing #s. Scanned by hand, not with one regular
 * expression: a pattern with optional runs of spaces and #s backtracks for seconds on a long line of spaces.
 */
function headingOf(line: string): [string, string, string] | undefined {
  const marks = /^#{1,6}/.exec(line)?.[0];
  if (!marks || !/[ \t]/.test(line[marks.length] ?? '')) return undefined;
  let end = line.length;
  while (end > marks.length && /\s/.test(line[end - 1]!)) end--;
  let close = end;
  while (close > marks.length && line[close - 1] === '#') close--;
  // A closing run of #s counts only after a space (or when it is all the line has): "C#" keeps its #.
  if (close < end && (close === marks.length || /\s/.test(line[close - 1]!))) end = close;
  return [line, marks, line.slice(marks.length, end).trim()];
}

/** Markdown text as blocks. Headings keep their level; the builder decides how they look. */
export function parseMarkdown(source: string, depth = 0): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join(' ')) }); paragraph.length = 0; } };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (index++; index < lines.length && !lines[index]!.trim().startsWith(fence[1]!); index++) body.push(lines[index]!);
      blocks.push({ kind: 'code', text: body.join('\n') });
      index++;
      continue;
    }
    const heading = headingOf(line);
    if (heading) { flush(); blocks.push({ kind: 'heading', level: heading[1]!.length, content: parseInline(heading[2]!) }); index++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push({ kind: 'rule' }); index++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; index < lines.length && /^\s*>/.test(lines[index]!); index++) quoted.push(lines[index]!.replace(/^\s*>\s?/, ''));
      // Deep nesting is read as plain text: no README gets to recurse without limit.
      blocks.push(depth < MAX_QUOTE_DEPTH ? { kind: 'quote', blocks: parseMarkdown(quoted.join('\n'), depth + 1) } : { kind: 'paragraph', content: parseInline(quoted.join(' ')) });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]!);
      const start = ordered ? Number.parseInt(item[2]!, 10) : 1;
      const items: Inline[][] = [];
      const sameKind = (at: number) => { const next = ITEM.exec(lines[at] ?? ''); return !!next && /\d/.test(next[2]!) === ordered; };
      for (; index < lines.length; index++) {
        const next = ITEM.exec(lines[index]!);
        if (next && /\d/.test(next[2]!) === ordered) items.push(parseInline(next[3]!.replace(/^\[[ xX]\]\s*/, '')));
        // A blank line between items of the same list ("loose" steps) keeps the list going.
        else if (!lines[index]!.trim() && sameKind(index + 1)) continue;
        // A code block inside an item ends the list here and is shown as a block, not flattened into the item.
        else if (/^\s{2,}\S/.test(lines[index]!) && items.length && !/^\s*(```|~~~)/.test(lines[index]!)) items.at(-1)!.push({ kind: 'text', text: ' ' }, ...parseInline(lines[index]!.trim()));
        else break;
      }
      blocks.push({ kind: 'list', ordered, items, ...(ordered && start !== 1 ? { start } : {}) });
      continue;
    }
    if (isTableRow(line) && /^\s*\|?\s*:?-{2,}/.test(lines[index + 1] ?? '')) {
      flush();
      const head = cells(line);
      const rows: Inline[][][] = [];
      for (index += 2; index < lines.length && isTableRow(lines[index]!); index++) rows.push(cells(lines[index]!));
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    // Text underlined with === or --- is a heading (setext), when it starts a paragraph.
    const underline = /^\s*(=+|-+)\s*$/.exec(lines[index + 1] ?? '');
    if (underline && !paragraph.length && line.trim()) { blocks.push({ kind: 'heading', level: underline[1]!.startsWith('=') ? 1 : 2, content: parseInline(line.trim()) }); index += 2; continue; }
    // A blank line ends a paragraph; a line that is only HTML (a centred logo, a badge row) says nothing as text.
    if (!line.trim() || (/^\s*</.test(line) && !line.replace(HTML_TAG, '').trim())) { flush(); index++; continue; }
    paragraph.push(line.trim());
    index++;
  }
  flush();
  return blocks;
}

const plainText = (content: Inline[]): string => content.map(part => part.kind === 'text' || part.kind === 'code' ? part.text : part.kind === 'image' ? part.alt : plainText(part.kind === 'link' ? part.label : part.children)).join('');
const same = (first: string, second: string) => first.toLowerCase().replace(/[^a-z0-9]+/g, '') === second.toLowerCase().replace(/[^a-z0-9]+/g, '');
const words = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
/** Mostly the same words: at least 60% of the shorter text's words are in the other, or one starts with the other. */
export function repeats(first: string, second: string): boolean {
  if (!first.trim() || !second.trim()) return false;
  if (same(first, second) || same(first.slice(0, second.length), second) || same(second.slice(0, first.length), first)) return true;
  const [small, large] = [words(first), words(second)].sort((a, b) => a.size - b.size) as [Set<string>, Set<string>];
  return small.size >= 4 && [...small].filter(word => large.has(word)).length / small.size >= 0.6;
}

/** Whether `text` starts with `name` as a whole word, after any bullet marks or quotes ("`pdf-reader`: …" yes, "Run pdf-reader" no). */
const leadsWith = (text: string, name: string) => {
  const rest = text.replace(/^[^\w]+/, '');
  return rest.toLowerCase().startsWith(name.toLowerCase()) && !/[\w-]/.test(rest[name.length] ?? '');
};

const isHeadingAtMost = (block: Block, level: number) => block.kind === 'heading' && block.level <= level;

/** A README heading for a plugin's parts: "Skills", "Commands", "Agents", "Included skills"… */
const PARTS_HEADING = /^(?:included |available |the )?(?:skills?|commands?|agents?|slash commands)$/i;

/**
 * Leaves out what only repeats the page around the README: an opening title, a lead paragraph, and what only says
 * again what the page lists about the parts in `skipParts`. That is a list of two or more items that each start with a
 * part's name ("pdf-reader: reads PDFs"), and, under a heading such as "Skills", a paragraph in a part's own sub-section
 * (its heading is the part's name) that mostly repeats that part's description. Anything else in that sub-section (setup
 * steps, examples, tables) stays. A heading left with nothing under it goes too.
 */
export function trimRepeats(blocks: Block[], options: MarkdownOptions = {}): Block[] {
  let rest = blocks;
  if (options.skipTitle && rest[0]?.kind === 'heading' && same(plainText(rest[0].content), options.skipTitle)) rest = rest.slice(1);
  const lead = rest[0]?.kind === 'paragraph' ? plainText(rest[0].content) : '';
  if (lead && options.skipLead?.some(text => repeats(lead, text))) rest = rest.slice(1);
  const parts = (options.skipParts ?? []).filter(part => part.name.length >= 3);
  if (!parts.length) return rest;
  const kept: Block[] = [];
  let partsLevel: number | undefined;
  let inPart: { level: number; description: string } | undefined;
  for (const block of rest) {
    if (block.kind === 'heading') {
      const title = plainText(block.content).trim();
      if (inPart && block.level <= inPart.level) inPart = undefined;
      if (partsLevel !== undefined && block.level <= partsLevel) partsLevel = undefined;
      if (PARTS_HEADING.test(title)) partsLevel = block.level;
      else if (partsLevel !== undefined) {
        const part = parts.find(candidate => same(title, candidate.name));
        if (part) inPart = { level: block.level, description: part.description };
      }
    }
    if (inPart && block.kind === 'paragraph' && repeats(plainText(block.content), inPart.description)) continue;
    if (block.kind === 'list' && block.items.length >= 2 && block.items.every(item => parts.some(part => leadsWith(plainText(item), part.name)))) continue;
    kept.push(block);
  }
  // From the end, so a heading emptied by one below it goes as well.
  for (let at = kept.length - 1; at >= 0; at--) {
    const block = kept[at]!;
    const next = kept[at + 1];
    if (block.kind === 'heading' && (!next || isHeadingAtMost(next, block.level))) kept.splice(at, 1);
  }
  return kept;
}

function inlineNodes(content: Inline[], open: (url: string) => void): (HTMLElement | string)[] {
  return content.map(part => {
    if (part.kind === 'text') return part.text;
    if (part.kind === 'code') return h('code', {}, part.text);
    if (part.kind === 'image') return part.alt ? h('span.md-image', {}, part.alt) : '';
    if (part.kind === 'link') return h('button.md-link', { type: 'button', title: part.url, onclick: (event: Event) => { event.stopPropagation(); open(part.url); } }, ...inlineNodes(part.label, open));
    return h(part.kind === 'strong' ? 'strong' : 'em', {}, ...inlineNodes(part.children, open));
  });
}

/** Elements for the blocks. Headings drop two levels, so a README's title never outranks the page's own headings. */
function blockNodes(blocks: Block[], open: (url: string) => void): HTMLElement[] {
  return blocks.map(block => {
    switch (block.kind) {
      case 'heading': return h(`h${Math.min(6, block.level + 2)}`, {}, ...inlineNodes(block.content, open));
      case 'paragraph': return h('p', {}, ...inlineNodes(block.content, open));
      case 'list': return h(block.ordered ? 'ol' : 'ul', block.start ? { start: String(block.start) } : {}, block.items.map(item => h('li', {}, ...inlineNodes(item, open))));
      case 'code': return h('pre', {}, h('code', {}, block.text));
      case 'quote': return h('blockquote', {}, blockNodes(block.blocks, open));
      case 'table': return h('div.md-table', {}, h('table', {}, h('thead', {}, h('tr', {}, block.head.map(cell => h('th', {}, ...inlineNodes(cell, open))))),
        h('tbody', {}, block.rows.map(row => h('tr', {}, row.map(cell => h('td', {}, ...inlineNodes(cell, open))))))));
      case 'rule': return h('hr');
    }
  });
}

/** A README as elements, built from text nodes only. */
export function markdown(source: string, open: (url: string) => void, options: MarkdownOptions = {}): HTMLElement {
  return h('div.md', {}, blockNodes(trimRepeats(parseMarkdown(source), options), open));
}

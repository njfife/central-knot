// A small Markdown reader for READMEs from marketplaces, in two parts: parseMarkdown turns text into plain data (tested
// without a DOM), and markdown builds elements from that data with text nodes only. Raw HTML is shown as text or dropped,
// images as their alt text, and only https links can be followed, in the browser.
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
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };
export interface MarkdownOptions { /** Leave out an opening heading that only repeats this name. */ skipTitle?: string; /** Leave out a first paragraph that only repeats this text. */ skipLead?: string }

const MAX_QUOTE_DEPTH = 6;
// Each pattern is tried only where its first character appears, and every repeat is bounded, so no README can make the
// scan slow. Underscore emphasis needs a space (or bracket) before and after it, so snake_case names and __init__.py stay
// as they are.
const PATTERNS: [RegExp, (match: RegExpExecArray) => Inline[]][] = [
  [/\*\*([^*\n]{1,300}?)\*\*/y, match => [{ kind: 'strong', children: inlineText(match[1]!) }]],
  [/(?<![^\s(])__([^_\n]{1,300}?)__(?![^\s),;:!?])/y, match => [{ kind: 'strong', children: inlineText(match[1]!) }]],
  [/\*([^*\s][^*\n]{0,300}?)\*/y, match => [{ kind: 'em', children: inlineText(match[1]!) }]],
  [/(?<![^\s(])_([^_\s][^_\n]{0,300}?)_(?![^\s),;:!?])/y, match => [{ kind: 'em', children: inlineText(match[1]!) }]],
  [/!\[([^\]\n]{0,300})\]\([^)\s]{1,500}(?:\s+"[^"\n]{0,300}")?\)/y, match => [{ kind: 'image', alt: match[1]! }]],
  [/\[([^\]\n]{1,300})\]\(([^)\s]{1,500})(?:\s+"[^"\n]{0,300}")?\)/y, match => linkOrText(inlineText(match[1]!), match[2]!)],
  [/<(https:\/\/[^>\s]{1,500})>/y, match => linkOrText([{ kind: 'text', text: match[1]! }], match[1]!)],
  [/https:\/\/[^\s<>()]{0,499}[^\s<>().,;:!?'"]/y, match => linkOrText([{ kind: 'text', text: match[0] }], match[0])],
];
const STARTS = /[*_![<h]/g;

/** An https link stays a link; anything else (relative paths, other schemes) is just its label. */
const linkOrText = (label: Inline[], url: string): Inline[] => (/^https:\/\/\S+$/.test(url) ? [{ kind: 'link', label, url }] : label);

/** Text with no code spans in it: tags are dropped (autolinks kept), then emphasis and links are found. */
function inlineText(text: string): Inline[] {
  const plain = text.replace(/<(?!https:\/\/)\/?[a-zA-Z][^>]{0,300}>/g, '');
  const out: Inline[] = [];
  let from = 0;
  let last = 0;
  STARTS.lastIndex = 0;
  for (let start = STARTS.exec(plain); start; start = STARTS.exec(plain)) {
    if (start.index < from) continue;
    for (const [pattern, build] of PATTERNS) {
      pattern.lastIndex = start.index;
      const match = pattern.exec(plain);
      if (!match) continue;
      if (match.index > last) out.push({ kind: 'text', text: plain.slice(last, match.index) });
      out.push(...build(match));
      last = from = match.index + match[0].length;
      STARTS.lastIndex = from;
      break;
    }
  }
  if (last < plain.length) out.push({ kind: 'text', text: plain.slice(last) });
  return out;
}

/** A line's inline content: code spans first, so what is inside them (`<plugin>@<marketplace>`) is kept exactly. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const parts = text.split(/(`[^`\n]{1,500}`)/);
  for (const part of parts) {
    if (!part) continue;
    if (/^`[^`]+`$/.test(part)) out.push({ kind: 'code', text: part.slice(1, -1) });
    else out.push(...inlineText(part));
  }
  return out;
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => parseInline(cell.trim()));
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

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
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
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
      const items: Inline[][] = [];
      for (; index < lines.length; index++) {
        const next = ITEM.exec(lines[index]!);
        if (next && /\d/.test(next[2]!) === ordered) items.push(parseInline(next[3]!.replace(/^\[[ xX]\]\s*/, '')));
        else if (/^\s{2,}\S/.test(lines[index]!) && items.length) items.at(-1)!.push({ kind: 'text', text: ' ' }, ...parseInline(lines[index]!.trim()));
        else break;
      }
      blocks.push({ kind: 'list', ordered, items });
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
    // A blank line ends a paragraph; a line that is only HTML (a centred logo, a badge row) says nothing as text.
    if (!line.trim() || (/^\s*<(?!https:\/\/)/.test(line) && !line.replace(/<[^>]{0,300}>/g, '').trim())) { flush(); index++; continue; }
    paragraph.push(line.trim());
    index++;
  }
  flush();
  return blocks;
}

const plainText = (content: Inline[]): string => content.map(part => part.kind === 'text' || part.kind === 'code' ? part.text : part.kind === 'image' ? part.alt : plainText(part.kind === 'link' ? part.label : part.children)).join('');
const same = (first: string, second: string) => first.toLowerCase().replace(/[^a-z0-9]+/g, '') === second.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Leaves out an opening title and lead paragraph that only repeat what the page already shows. */
export function trimRepeats(blocks: Block[], options: MarkdownOptions = {}): Block[] {
  let rest = blocks;
  if (options.skipTitle && rest[0]?.kind === 'heading' && same(plainText(rest[0].content), options.skipTitle)) rest = rest.slice(1);
  if (options.skipLead && rest[0]?.kind === 'paragraph' && same(plainText(rest[0].content), options.skipLead)) rest = rest.slice(1);
  return rest;
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
      case 'list': return h(block.ordered ? 'ol' : 'ul', {}, block.items.map(item => h('li', {}, ...inlineNodes(item, open))));
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

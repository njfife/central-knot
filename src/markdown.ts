// A small Markdown reader for READMEs from marketplaces. It builds DOM nodes from text only: raw HTML is shown as its text,
// images as their alt text, and only https links can be followed, in the browser. Enough for headings, lists, code and tables.
import { h } from './dom.ts';

type Node_ = HTMLElement | string;

const LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(!?\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))|(<https:\/\/[^>\s]+>)|(https:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

/** Text inside a line: code, bold, italic and links. */
function inline(text: string, open: (url: string) => void): Node_[] {
  const out: Node_[] = [];
  let rest = text.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) { out.push(rest); break; }
    if (match.index) out.push(rest.slice(0, match.index));
    const [whole, code, bold, italic, link, angle, bare] = match;
    if (code) out.push(h('code', {}, code.slice(1, -1)));
    else if (bold) out.push(h('strong', {}, ...inline(bold.slice(2, -2), open)));
    else if (italic) out.push(h('em', {}, ...inline(italic.slice(1, -1), open)));
    else if (link) {
      const [, label = '', url = ''] = LINK.exec(link) ?? [];
      if (link.startsWith('!')) { if (label) out.push(h('span.md-image', {}, label)); }
      else out.push(linkTo(label || url, url, open));
    } else if (angle) out.push(linkTo(angle.slice(1, -1), angle.slice(1, -1), open));
    else if (bare) out.push(linkTo(bare, bare, open));
    rest = rest.slice(match.index + whole!.length);
  }
  return out;
}

/** An https link opens in the browser; anything else (relative paths, other schemes) is just its text. */
function linkTo(label: string, url: string, open: (url: string) => void): Node_ {
  if (!/^https:\/\//.test(url)) return label;
  return h('button.md-link', { type: 'button', title: url, onclick: (event: Event) => { event.stopPropagation(); open(url); } }, label);
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

/** Renders Markdown as a tree of plain elements. Headings drop two levels, so a README's title never outranks the page's. */
export function markdown(source: string, open: (url: string) => void): HTMLElement {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: HTMLElement[] = [];
  let index = 0;
  const paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push(h('p', {}, ...inline(paragraph.join(' '), open))); paragraph.length = 0; } };
  while (index < lines.length) {
    const line = lines[index]!;
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (index++; index < lines.length && !lines[index]!.trim().startsWith(fence[1]!); index++) body.push(lines[index]!);
      blocks.push(h('pre', {}, h('code', {}, body.join('\n'))));
      index++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); blocks.push(h(`h${Math.min(6, heading[1]!.length + 2)}`, {}, ...inline(heading[2]!, open))); index++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push(h('hr')); index++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; index < lines.length && /^\s*>/.test(lines[index]!); index++) quoted.push(lines[index]!.replace(/^\s*>\s?/, ''));
      blocks.push(h('blockquote', {}, markdown(quoted.join('\n'), open)));
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]!);
      const items: HTMLElement[] = [];
      for (; index < lines.length; index++) {
        const next = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]!);
        if (next && /\d/.test(next[2]!) === ordered) items.push(h('li', {}, ...inline(next[3]!.replace(/^\[[ xX]\]\s*/, ''), open)));
        else if (lines[index]!.trim() && /^\s{2,}\S/.test(lines[index]!) && items.length) items.at(-1)!.append(' ', ...inline(lines[index]!.trim(), open));
        else break;
      }
      blocks.push(h(ordered ? 'ol' : 'ul', {}, items));
      continue;
    }
    if (isTableRow(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[index + 1]!)) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      for (index += 2; index < lines.length && isTableRow(lines[index]!); index++) rows.push(cells(lines[index]!));
      blocks.push(h('div.md-table', {}, h('table', {}, h('thead', {}, h('tr', {}, head.map(cell => h('th', {}, ...inline(cell, open))))),
        h('tbody', {}, rows.map(row => h('tr', {}, row.map(cell => h('td', {}, ...inline(cell, open)))))))));
      continue;
    }
    if (!line.trim()) { flush(); index++; continue; }
    // A line that is only HTML (a centred logo, a badge row) says nothing as text.
    if (/^\s*<[^>]+>\s*$/.test(line)) { flush(); index++; continue; }
    paragraph.push(line.trim());
    index++;
  }
  flush();
  return h('div.md', {}, blocks);
}

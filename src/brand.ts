// Each tool's mark, drawn small beside its name. Shared by every page that names tools.
import { brands } from './icons.ts';
import { h } from './dom.ts';
import { toolNames as names } from './words.ts';

/** The glyph inside the square for a tool drawn here rather than by its brand. */
const glyphs: Record<string, string> = {
  'codex-cli': '<path d="m7.5 9.5 3 2.5-3 2.5"/><path d="M12.5 15h4"/>',
  'pi-cli': '<path d="M7.5 9h9"/><path d="M10.5 9v7"/><path d="M14 9v5.5c0 .9.5 1.5 1.5 1.5"/>',
};

/** A tool's mark (its id, as the tables pass it), or its first two letters when it has none. */
export function brandMark(tool: string, size = 16): Element {
  const holder = document.createElement('template');
  // Cowork is Claude's: the same mark, told apart by the name beside it.
  const brand = (brands as Record<string, { color: string; path: string } | undefined>)[tool === 'claude-cowork' ? 'claude-cli' : tool];
  // Codex and Pi have no mark of their own here: each a drawn glyph in a rounded square (a terminal prompt, a π), the same
  // size and weight as the others at any size, not letters squeezed into a tile.
  const drawn = !brand && glyphs[tool];
  if (drawn) {
    holder.innerHTML = `<svg class="brand-mark brand-${tool}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/>${drawn}</svg>`;
    return holder.content.firstElementChild as SVGElement;
  }
  if (!brand) return h(`span.mono-mark.mono-${size}`, { 'aria-hidden': 'true' }, ((names as Record<string, string>)[tool] ?? tool).slice(0, 2));
  holder.innerHTML = `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="${brand.color}"><path d="${brand.path}"/></svg>`;
  return holder.content.firstElementChild as SVGElement;
}

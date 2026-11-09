// Each tool's mark, drawn small beside its name. Shared by every page that names tools.
import { brands } from './icons.ts';
import { h } from './dom.ts';
import { toolNames as names } from './words.ts';

/** A tool's mark (its id, as the tables pass it), or its first two letters when it has none. */
export function brandMark(tool: string, size = 16): Element {
  const holder = document.createElement('template');
  const brand = (brands as Record<string, { color: string; path: string } | undefined>)[tool];
  // Codex has no mark of its own here: a drawn terminal glyph, the same size and weight as the others, not a text placeholder.
  if (!brand && tool === 'codex-cli') {
    holder.innerHTML = `<svg class="brand-mark brand-codex" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="m7.5 9.5 3 2.5-3 2.5"/><path d="M12.5 15h4"/></svg>`;
    return holder.content.firstElementChild as SVGElement;
  }
  if (!brand) return h(`span.mono-mark.mono-${size}`, { 'aria-hidden': 'true' }, ((names as Record<string, string>)[tool] ?? tool).slice(0, 2));
  holder.innerHTML = `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="${brand.color}"><path d="${brand.path}"/></svg>`;
  return holder.content.firstElementChild as SVGElement;
}

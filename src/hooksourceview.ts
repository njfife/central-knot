// Shared View source / Hide source button and opened source block for every hook row: called by instructionspage.ts
// sessionStripView (Instructions and each tool's Instructions tab) and pluginpage.ts partList (from hookGroup). Reads on click
// over hook:source (hooksource.ts) and updates in place so open editors keep their caret; Escape hides it and refocuses the button.
import { shownPath, state } from './app.ts';
import { button, h, pathText } from './dom.ts';
import type { HookSource, HookSourceRef } from './types.ts';
import { fileName } from './words.ts';

let openHome: string | undefined;
const opened = new Map<string, { seq: number; source?: HookSource }>();
const ids = new Map<string, number>();
let seq = 0;

function sourceBlock(id: string, path?: string, text?: string, note?: string): HTMLElement {
  return h('div.content-block', {},
    path ? h('p.content-owner', {}, pathText(shownPath(path), path)) : null,
    text !== undefined
      ? h('pre.content.mono', { id, tabindex: '0', 'aria-label': `${fileName(path ?? '')} contents` }, text.replace(/\n$/, ''))
      : h('p.hook-source-note', {}, note ?? ''));
}

/** Returns the row's View source / Hide source button, followed by its opened source block when open. */
export function hookSourceControls(ref: HookSourceRef): HTMLElement[] {
  const home = state.home?.home;
  if (home !== openHome) {
    opened.clear();
    openHome = home;
  }
  const key = JSON.stringify(ref);
  const baseId = `hook-source-${ids.get(key) ?? ids.set(key, ids.size).size - 1}`;
  const btnId = `${baseId}-btn`;
  const panelId = `${baseId}-panel`;
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !opened.has(key)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };
  const panel = (source?: HookSource): HTMLElement => h('div.hook-source', { id: panelId, onkeydown: onEscape },
    !source ? h('p.hook-source-note', {}, 'Reading…')
      : source.problem ? sourceBlock(`${baseId}-err`, source.file, undefined, source.problem)
      : [
        source.entry !== undefined && source.file ? sourceBlock(`${baseId}-entry`, source.file, source.entry) : null,
        source.script ? sourceBlock(`${baseId}-script`, source.script.path, source.script.text, source.script.problem) : null,
      ]);
  const control = (open: boolean): HTMLElement => button({
    variant: 'link', size: 'micro', label: open ? 'Hide source' : 'View source', id: btnId,
    attrs: { 'data-hook-source': '', 'aria-expanded': String(open), ...(open ? { 'aria-controls': panelId } : {}), onkeydown: onEscape },
    onclick: toggle,
  });
  function toggle(): void {
    const activeHome = state.home?.home;
    if (!activeHome) return;
    const isClosing = opened.delete(key);
    const next = control(!isClosing);
    document.getElementById(btnId)?.replaceWith(next);
    document.getElementById(panelId)?.remove();
    next.focus({ preventScroll: true });
    if (isClosing) return;
    const call = ++seq;
    opened.set(key, { seq: call });
    next.after(panel());
    void window.centralKnot.hookSource(activeHome, ref)
      .catch((): HookSource => ({ problem: 'This file couldn’t be read.' }))
      .then(source => {
        if (openHome !== activeHome || opened.get(key)?.seq !== call) return;
        opened.set(key, { seq: call, source });
        document.getElementById(panelId)?.replaceWith(panel(source));
      });
  }
  const current = opened.get(key);
  return current ? [control(true), panel(current.source)] : [control(false)];
}

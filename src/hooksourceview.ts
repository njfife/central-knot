// Shared View source / Hide source button and opened source block for every hook row: called by instructionspage.ts
// sessionStripView (Instructions and each tool's Instructions tab) and pluginpage.ts partList (from hookGroup). Reads on click
// over hook:source (hooksource.ts) and updates in place so open editors keep their caret; Escape hides it and refocuses the
// button. Refresh and home switches close all open panels (resetHookSources); gone rows are pruned on redraw (pruneHookSources).
import { shownPath, state } from './app.ts';
import { button, h, pathText } from './dom.ts';
import type { HookSource, HookSourceRef } from './types.ts';
import { HOOK_SOURCE_UNREADABLE, fileName } from './words.ts';

const opened = new Map<string, { seq: number; panelId: string; source?: HookSource }>();
let seq = 0;

/** Closes all open hook source blocks and drops any in-flight reads (called on Refresh and home switch). */
export function resetHookSources(): void {
  opened.clear();
  seq++;
}

/** Drops open hook source state for any row no longer drawn on screen (called after each page draw). */
export function pruneHookSources(): void {
  for (const [key, entry] of opened) if (!document.getElementById(entry.panelId)) opened.delete(key);
}

function sourceBlock(blockId: string, path?: string, text?: string, note?: string, prefix?: string, suffix?: string): HTMLElement {
  return h('div.content-block', {},
    path ? h('p.content-owner', {}, prefix ? `${prefix} ` : null, pathText(shownPath(path), path), suffix ?? null) : null,
    text !== undefined
      ? h('pre.content.mono', { id: blockId, tabindex: '0', 'aria-label': `${fileName(path ?? '')} contents` }, text.replace(/\n$/, ''))
      : h('p.hook-source-note', {}, note ?? ''));
}

/** Returns the row's View source / Hide source button, followed by its opened source block when open. */
export function hookSourceControls(ref: HookSourceRef, id: string): HTMLElement[] {
  const key = `${id}\u0000${JSON.stringify(ref)}`;
  const btnId = `${id}-btn`;
  const panelId = `${id}-panel`;
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !opened.has(key)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };
  const copy = ref.from === 'marketplace' ? ' · the marketplace’s copy' : undefined;
  const panel = (source?: HookSource): HTMLElement => h('div.hook-source', { id: panelId, onkeydown: onEscape },
    !source ? h('p.hook-source-note', {}, 'Reading…')
      : source.problem ? sourceBlock(`${id}-err`, source.file, undefined, source.problem)
      : [
        source.script ? sourceBlock(`${id}-script`, source.script.path, source.script.text, source.script.problem, undefined, !source.file ? copy : undefined) : null,
        source.entry !== undefined && source.file ? sourceBlock(`${id}-entry`, source.file, source.entry, undefined, 'Declared in', copy) : null,
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
    opened.set(key, { seq: call, panelId });
    next.after(panel());
    void window.centralKnot.hookSource(activeHome, ref)
      .catch((): HookSource => ({ problem: HOOK_SOURCE_UNREADABLE }))
      .then(source => {
        if (state.home?.home !== activeHome || opened.get(key)?.seq !== call) return;
        opened.set(key, { seq: call, panelId, source });
        document.getElementById(panelId)?.replaceWith(panel(source));
      });
  }
  const current = opened.get(key);
  return current ? [control(true), panel(current.source)] : [control(false)];
}

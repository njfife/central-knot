// Shared hook-row controls and panels for every hook row: Run it / Running… + Stop (offered by canRun; main's hookrun.ts
// runHook decides) beside View source / Hide source inside one span, plus the opened run result (above) and source block
// (below), called by instructionspage.ts sessionStripView (Instructions and a tool's Instructions tab) and pluginpage.ts
// partList (from hookGroup). Reads source over hook:source (hooksource.ts) and runs/stops on click over hook:run / hook:stop
// (hookrun.ts), wording results through sessionhooks.ts hookRunWords, updating in place so open editors keep their caret.
// Nothing starts a run on draw; ids hash the row key and declaration fingerprint; Escape closes the focused block and refocuses
// its button; leaving the page prunes state (without stopping main); Refresh and home switches clear all state.
import { shownPath, state } from './app.ts';
import { button, closeButton, h, icon, pathText } from './dom.ts';
import { pagePlatform } from './machine.ts';
import { hookRunWords } from './sessionhooks.ts';
import type { HomeMode, HookRunResult, HookSource, HookSourceRef } from './types.ts';
import { HOOK_SOURCE_UNREADABLE, fileName } from './words.ts';

interface RunEntry {
  seq: number;
  runBtnId: string;
  running: boolean;
  result?: HookRunResult;
  openAll: boolean;
  openErr: boolean;
}

const opened = new Map<string, { seq: number; panelId: string; source?: HookSource }>();
const runs = new Map<string, RunEntry>();
let seq = 0;

/** Whether the page offers Run it (mirrors main's own deciding gate in hookrun.ts runHook): this computer's own home, not Windows, and his own hooks or Claude Code / Codex installed plugin hooks. */
export function canRun(ref: HookSourceRef, mode: HomeMode | undefined = state.home?.mode, platform = pagePlatform(navigator.userAgent)): boolean {
  if (mode !== 'actual' || platform === 'win32') return false;
  return ref.from === 'own' || (ref.from === 'installed' && (ref.tool === 'claude-cli' || ref.tool === 'codex-cli'));
}

/** Short deterministic hash of a row key so re-read position shifts give another hook a different button id. */
function keyHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash.toString(36);
}

/** Whether a row's controls currently lie inside its scroll container (or the window) so arriving results never jump an away user back. */
function rowOnScreen(actionsEl: HTMLElement): boolean {
  const rect = actionsEl.getBoundingClientRect?.();
  if (!rect) return true;
  const box = actionsEl.closest?.('.scroll')?.getBoundingClientRect?.();
  const top = box ? box.top : 0;
  const bottom = box ? box.bottom : window.innerHeight;
  return rect.bottom > top && rect.top < bottom;
}

/** Closes all open hook source and run blocks and drops any in-flight reads or runs (called on Refresh and home switch). */
export function resetHookSources(): void {
  opened.clear();
  runs.clear();
  seq++;
}

/** Drops open hook source and run state for any row no longer drawn on screen (called after each page draw). */
export function pruneHookSources(): void {
  for (const [key, entry] of opened) if (!document.getElementById(entry.panelId)) opened.delete(key);
  for (const [key, entry] of runs) if (!document.getElementById(entry.runBtnId)) runs.delete(key);
}

const textPre = (id: string, label: string, text: string): HTMLElement =>
  h('pre.content.mono', { id, tabindex: '0', 'aria-label': label }, text.replace(/\n$/, ''));

const rowLink = (label: string, id: string, onclick: (event: MouseEvent) => void, attrs: Record<string, unknown>): HTMLElement =>
  button({ variant: 'link', size: 'micro', label, id, onclick, attrs });

function sourceBlock(blockId: string, path?: string, text?: string, note?: string, prefix?: string, suffix?: string): HTMLElement {
  return h('div.content-block', {},
    path ? h('p.content-owner', {}, prefix ? `${prefix} ` : null, pathText(shownPath(path), path), suffix ?? null) : null,
    text !== undefined
      ? textPre(blockId, `${fileName(path ?? '')} contents`, text)
      : h('p.hook-source-note', {}, note ?? ''));
}

/** Returns the row's action span (Run it / Running… + Stop when runnable, beside View source), then any open result and source blocks. */
export function hookSourceControls(ref: HookSourceRef, id: string): HTMLElement[] {
  const key = `${id}\u0000${JSON.stringify(ref)}`;
  const base = `${id}-${keyHash(key)}`;
  const actionsId = `${base}-actions`;
  const btnId = `${base}-btn`;
  const panelId = `${base}-panel`;
  const runBtnId = `${base}-run`;
  const stopBtnId = `${base}-stop`;
  const runPanelId = `${base}-run-panel`;
  const runnable = canRun(ref);

  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !opened.has(key)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };
  const onRunEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !runs.get(key)?.result) return;
    event.preventDefault();
    event.stopPropagation();
    closeRun();
  };
  const onRunKey = (event: KeyboardEvent) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      return;
    }
    onRunEscape(event);
  };

  const copy = ref.from === 'marketplace' ? ' · the marketplace’s copy' : undefined;
  const panel = (source?: HookSource): HTMLElement => h('div.hook-source', { id: panelId, onkeydown: onEscape },
    !source ? h('p.hook-source-note', {}, 'Reading…')
      : source.problem ? sourceBlock(`${base}-err`, source.file, undefined, source.problem)
      : [
        source.script ? sourceBlock(`${base}-script`, source.script.path, source.script.text, source.script.problem, undefined, !source.file ? copy : undefined) : null,
        source.entry !== undefined && source.file ? sourceBlock(`${base}-entry`, source.file, source.entry, undefined, 'Declared in', copy) : null,
      ]);
  const control = (open: boolean): HTMLElement => rowLink(open ? 'Hide source' : 'View source', btnId, toggle,
    { 'data-hook-source': '', 'aria-expanded': String(open), ...(open ? { 'aria-controls': panelId } : {}), onkeydown: onEscape });

  const foldBlock = (foldId: string, label: string, text: string, open: boolean, flip: () => void): HTMLElement =>
    h('div.hook-run-fold', {},
      h('button.btn.link.micro.hook-fold', {
        type: 'button', id: foldId, 'aria-expanded': String(open),
        ...(open ? { 'aria-controls': `${foldId}-text` } : {}), onclick: flip,
      }, label, icon(open ? 'chevron-down' : 'chevron-right', 12)),
      open ? textPre(`${foldId}-text`, label, text) : null);

  const runPanel = (entry: RunEntry): HTMLElement => {
    const result = entry.result!;
    const tool = 'tool' in ref ? ref.tool : 'claude-cli';
    const view = hookRunWords(tool, result, result.cwd ? shownPath(result.cwd) : '~');
    const flip = (which: 'openAll' | 'openErr', focusId: string) => () => {
      const live = runs.get(key);
      if (!live?.result) return;
      live[which] = !live[which];
      document.getElementById(runPanelId)?.replaceWith(runPanel(live));
      document.getElementById(focusId)?.focus({ preventScroll: true });
    };
    return h('div.hook-run', { id: runPanelId, role: 'region', 'aria-label': 'Hook run result', onkeydown: onRunEscape },
      h('div.hook-run-head', {},
        h('span.hook-run-says', {}, view.sentence, view.meta ? [' ', h('span.hook-run-meta', {}, view.meta)] : null),
        closeButton(closeRun, { id: `${base}-close`, label: 'Close result' })),
      ...view.notes.map(note => h('p.hook-run-note', {}, note)),
      view.added !== undefined ? textPre(`${base}-added`, 'Text the hook would add', view.added) : null,
      view.errDirect !== undefined ? h('div.content-block', {}, h('p.content-owner', {}, 'Standard error'), textPre(`${base}-stderr`, 'Standard error', view.errDirect)) : null,
      view.allFold !== undefined ? foldBlock(`${base}-all`, 'Show all it printed', view.allFold, entry.openAll, flip('openAll', `${base}-all`)) : null,
      view.errFold !== undefined ? foldBlock(`${base}-err-fold`, 'Standard error', view.errFold, entry.openErr, flip('openErr', `${base}-err-fold`)) : null);
  };

  const runButton = (running: boolean): HTMLElement => rowLink(running ? 'Running…' : 'Run it', runBtnId, running ? () => {} : startRun,
    { 'data-hook-run': '', ...(running ? { 'aria-disabled': 'true' } : {}), onkeydown: onRunKey });
  const stopButton = (): HTMLElement => rowLink('Stop', stopBtnId, stopRun, { 'data-hook-stop': '', onkeydown: onRunKey });

  function closeRun(): void {
    const entry = runs.get(key);
    if (!entry || entry.running) return;
    runs.delete(key);
    document.getElementById(runPanelId)?.remove();
    document.getElementById(runBtnId)?.focus({ preventScroll: true });
  }

  function stopRun(event?: MouseEvent): void {
    if (event?.detail && event.detail > 1) return;
    const activeHome = state.home?.home;
    if (!activeHome || !runs.get(key)?.running) return;
    void window.centralKnot.hookStop(activeHome, ref);
  }

  function startRun(event?: MouseEvent): void {
    if (event?.detail && event.detail > 1) return;
    const activeHome = state.home?.home;
    if (!activeHome || runs.get(key)?.running) return;
    const call = ++seq;
    runs.set(key, { seq: call, runBtnId, running: true, openAll: false, openErr: false });
    document.getElementById(runPanelId)?.remove();
    const busy = runButton(true);
    document.getElementById(runBtnId)?.replaceWith(busy);
    document.getElementById(stopBtnId)?.remove();
    busy.after(stopButton());
    busy.focus({ preventScroll: true });
    void window.centralKnot.hookRun(activeHome, ref)
      .catch((): HookRunResult => ({
        outcome: 'refused',
        allPrinted: '',
        stderr: '',
        durationMs: 0,
        at: new Date().toISOString(),
        cwd: '',
        emptyPrompt: false,
      }))
      .then(result => {
        if (state.home?.home !== activeHome || runs.get(key)?.seq !== call) return;
        const actionsEl = document.getElementById(actionsId);
        if (!actionsEl) {
          runs.delete(key);
          return;
        }
        const visible = rowOnScreen(actionsEl);
        const done: RunEntry = { seq: call, runBtnId, running: false, result, openAll: false, openErr: false };
        runs.set(key, done);
        const activeId = document.activeElement?.id;
        const keepFocus = activeId === runBtnId || activeId === stopBtnId;
        const idle = runButton(false);
        document.getElementById(runBtnId)?.replaceWith(idle);
        document.getElementById(stopBtnId)?.remove();
        if (keepFocus) idle.focus({ preventScroll: true });
        const nextPanel = runPanel(done);
        const existing = document.getElementById(runPanelId);
        if (existing) existing.replaceWith(nextPanel);
        else actionsEl.after(nextPanel);
        if (visible) nextPanel.scrollIntoView?.({ block: 'nearest' });
      });
  }

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
    (document.getElementById(runPanelId) ?? document.getElementById(actionsId) ?? next).after(panel());
    void window.centralKnot.hookSource(activeHome, ref)
      .catch((): HookSource => ({ problem: HOOK_SOURCE_UNREADABLE }))
      .then(source => {
        if (state.home?.home !== activeHome || opened.get(key)?.seq !== call) return;
        opened.set(key, { seq: call, panelId, source });
        document.getElementById(panelId)?.replaceWith(panel(source));
      });
  }

  const currentSource = opened.get(key);
  const currentRun = runnable ? runs.get(key) : undefined;
  const running = !!currentRun?.running;
  const actions = h('span.hook-actions', { id: actionsId },
    runnable ? [runButton(running), running ? stopButton() : null] : null,
    control(!!currentSource));
  return [
    actions,
    currentRun?.result ? runPanel(currentRun) : null,
    currentSource ? panel(currentSource.source) : null,
  ].filter((node): node is HTMLElement => !!node);
}

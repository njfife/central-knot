// Shared hook-row controls, rows (hookRow) and panels for every hook row: See what it adds / Collect again / Running… + Stop (offered by canRun; main's hookrun.ts
// runHook decides) beside View source / Hide source inside one span, plus the opened run result (above) and source block
// (below), called by instructionspage.ts sessionStripView (Instructions and a tool's Instructions tab, opting into kept results) and pluginpage.ts
// (sessionHookStrip and partList from hookGroup, visit-only). Reads source over hook:source (hooksource.ts), runs/stops on click over hook:run / hook:stop
// (hookrun.ts), and reads/forgets kept results over hook:last / hook:forget (hookrunstore.ts) once per visit or Refresh before strips draw, wording results through sessionhooks.ts hookRunWords, updating in place so open editors keep their caret.
// Nothing starts a run on draw; ids hash the row key and declaration fingerprint; Forget result (Close result on a plugin's page) and Escape close the result block, delete any kept result (on remembered rows) and refocus
// its button; long kept results fold to 6 lines + Show all on a return; leaving the page or a same-home Refresh keeps in-flight runs and kept results (restoring any earlier kept result over a stopped/refused run), while a home switch clears all state.
import { rerender, shownPath, state } from './app.ts';
import { button, closeButton, h, icon, pathText } from './dom.ts';
import { pagePlatform } from './machine.ts';
import { addsText, isTextEvent } from './pluginoutcomes.ts';
import { takesPlugins } from './presence.ts';
import { HOOK_RUN_ACTUAL_CARD, hookFingerprint, hookRunWords, isKeptHookOutcome, sessionStrip, type TextHookRow } from './sessionhooks.ts';
import type { HarnessId, HomeMode, HomeView, HookRunResult, HookSource, HookSourceRef, InstalledPlugin, InstructionFile } from './types.ts';
import { HOOK_SOURCE_UNREADABLE, andList, fileName, sentence, toolNames } from './words.ts';

interface RunEntry {
  seq: number;
  runBtnId: string;
  running: boolean;
  kept?: HookRunResult;
  fromStore?: boolean;
  result?: HookRunResult;
  openAdded: boolean;
  openAll: boolean;
  openErr: boolean;
}

const opened = new Map<string, { seq: number; panelId: string; source?: HookSource }>();
const runs = new Map<string, RunEntry>();
let seq = 0;
let loadSeq = 0;

const hasCli = (tool: HarnessId, home?: Pick<HomeView, 'snapshots'>) =>
  !home?.snapshots || home.snapshots.some(s => s.harness === tool && (s.detection === 'Installed' || s.detection === 'Version unknown' || !!s.app?.binary));

/** Home, platform and tool gates shared by canRun and stripCantRunReason; returns a card reason where the strip's (?) explains it, or 'silent'. */
const hookGate = (ref: HookSourceRef, mode: HomeMode | undefined, platform: string): string | 'silent' | undefined =>
  platform === 'win32' || !mode || ref.from === 'marketplace' ? 'silent'
  : mode !== 'actual' ? HOOK_RUN_ACTUAL_CARD
  : ref.from === 'installed' && !takesPlugins(ref.tool) ? 'silent' : undefined;

/** Whether the page offers See what it adds (mirrors main's deciding gate in hookrun.ts runHook): actual home, non-Windows, own or installed plugin hook that adds text, with the tool's CLI found and the plugin on. */
export function canRun(ref: HookSourceRef, mode: HomeMode | undefined = state.home?.mode, platform = pagePlatform(navigator.userAgent), home: Pick<HomeView, 'snapshots' | 'pluginItems'> | undefined = state.home): boolean {
  if (ref.from === 'marketplace' || hookGate(ref, mode, platform)) return false;
  if (!ref.command || !isTextEvent(ref.tool, ref.event)) return false;
  if (!hasCli(ref.tool, home)) return false;
  if (ref.from === 'installed' && home?.pluginItems && !home.pluginItems.some(i => i.tool === ref.tool && i.plugin === ref.plugin && i.marketName === ref.marketName && !i.off && !i.problem)) return false;
  return true;
}

/** Why hooks on a strip can't be run, for its (?) card (from hookGate: chosen folder on Mac/Linux). */
export const stripCantRunReason = (refs: readonly HookSourceRef[], mode: HomeMode | undefined = state.home?.mode, platform = pagePlatform(navigator.userAgent)): string | undefined =>
  refs.map(ref => hookGate(ref, mode, platform)).find((why): why is string => !!why && why !== 'silent');

/** Standing line explaining why text hooks can't run in an actual home on Mac/Linux (missing CLI, not installed or off); card-only reasons (another home) come from stripCantRunReason above. */
export function hookCantRunReason(target: HarnessId | { inAnyTool: boolean; installs: InstalledPlugin[]; fingerprints: string[] },
  mode: HomeMode | undefined = state.home?.mode, platform = pagePlatform(navigator.userAgent), home: Pick<HomeView, 'snapshots'> | undefined = state.home): string | undefined {
  if (mode !== 'actual' || platform === 'win32') return undefined;
  const noCli = (tool: HarnessId) => `${toolNames[tool]}’s command line isn’t on this computer, so these can’t be run here.`;
  if (typeof target === 'string') return !hasCli(target, home) ? noCli(target) : undefined;
  if (!target.inAnyTool && !target.installs.length) return 'Not installed, so these can’t be run here.';
  if (!target.installs.length || target.installs.some(item => item.problem || item.hooksUnread?.length)) return undefined;
  const withText = target.installs.filter(item => item.hooks?.some(hook => addsText(item.tool, hook)));
  if (!withText.length || withText.some(item => !takesPlugins(item.tool))) return undefined;
  const covered = new Set(withText.flatMap(item => (item.hooks ?? []).filter(hook => addsText(item.tool, hook)).map(hookFingerprint)));
  if (target.fingerprints.some(fp => !covered.has(fp))) return undefined;
  if (withText.every(item => item.off)) return `Off in ${andList(withText.map(item => toolNames[item.tool]))}, so these can’t be run here.`;
  return withText.length === 1 && !withText[0]!.off && !hasCli(withText[0]!.tool, home) ? noCli(withText[0]!.tool) : undefined;
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

const keptEntry = (result: HookRunResult, at: number, runBtnId = ''): RunEntry =>
  ({ seq: at, runBtnId, running: false, kept: result, fromStore: true, result, openAdded: false, openAll: false, openErr: false });

/** Reads kept results for every runnable hook in `files` in one hook:last call; drops replies after a home switch or newer read. */
export async function loadHookResults(files: readonly InstructionFile[]): Promise<void> {
  const home = state.home;
  const refs = home ? files.flatMap(file =>
    sessionStrip(file.tool, home.pluginItems ?? [], file)?.groups.flatMap(g => g.hooks.map(row => row.source).filter(ref => canRun(ref))) ?? []) : [];
  if (!refs.length) return;
  const call = ++loadSeq;
  const reply = await window.centralKnot.hookLast?.(home!.home, refs)?.catch(() => undefined);
  if (call !== loadSeq || state.home?.home !== home!.home || !Array.isArray(reply)) return;
  for (let at = 0; at < refs.length; at++) {
    const runKey = JSON.stringify(refs[at]);
    const current = runs.get(runKey);
    if (current?.running) continue;
    const kept = reply[at];
    if (kept) runs.set(runKey, keptEntry(kept, seq, current?.runBtnId));
    else if (current?.kept) runs.delete(runKey);
  }
}

function dropTransientRuns(keepOnScreen: boolean): void {
  for (const [key, entry] of runs) {
    if (entry.running || (keepOnScreen && document.getElementById(entry.runBtnId))) continue;
    if (entry.kept) runs.set(key, keptEntry(entry.kept, entry.seq));
    else runs.delete(key);
  }
}

/** Closes open hook source blocks; clears all run state on a home switch, or keeps in-flight runs and kept results on a same-home Refresh. */
export function resetHookSources(sameHome = false): void {
  opened.clear();
  loadSeq++;
  if (sameHome) return dropTransientRuns(false);
  runs.clear();
  seq++;
}

/** Drops open hook source and transient run state for rows no longer on screen; in-flight runs and remembered kept results stay. */
export function pruneHookSources(): void {
  for (const [key, entry] of opened) if (!document.getElementById(entry.panelId)) opened.delete(key);
  dropTransientRuns(true);
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

/** Returns the row's action span (See what it adds / Collect again / Running… + Stop when runnable, beside View source), then any open result and source blocks. */
export function hookSourceControls(ref: HookSourceRef, id: string, remember = false): HTMLElement[] {
  const key = `${id}\u0000${JSON.stringify(ref)}`;
  const runKey = remember ? JSON.stringify(ref) : key;
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
    if (event.key !== 'Escape' || !runs.get(runKey)?.result) return;
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
  const entrySuffix = `${copy ?? ''} · ${ref.event}`;
  const panel = (source?: HookSource): HTMLElement => h('div.hook-source', { id: panelId, onkeydown: onEscape },
    !source ? h('p.hook-source-note', {}, 'Reading…')
      : source.problem ? sourceBlock(`${base}-err`, source.file, undefined, source.problem)
      : [
        source.script ? sourceBlock(`${base}-script`, source.script.path, source.script.text, source.script.problem, undefined, source.entry !== undefined && source.file ? undefined : entrySuffix) : null,
        source.entry !== undefined && source.file ? sourceBlock(`${base}-entry`, source.file, source.entry, undefined, 'Declared in', entrySuffix) : null,
      ]);
  const control = (open: boolean): HTMLElement => rowLink(open ? 'Hide source' : 'View source', btnId, toggle,
    { 'data-hook-source': '', 'aria-expanded': String(open), ...(open ? { 'aria-controls': panelId } : {}), onkeydown: onEscape });

  const foldBtn = (foldId: string, label: string, controls: string | undefined, open: boolean, flip: () => void): HTMLElement =>
    h('button.btn.link.micro.hook-fold', {
      type: 'button', id: foldId, 'aria-expanded': String(open),
      ...(controls ? { 'aria-controls': controls } : {}), onclick: flip,
    }, label, icon(open ? 'chevron-down' : 'chevron-right', 12));

  const foldBlock = (foldId: string, label: string, text: string, open: boolean, flip: () => void): HTMLElement =>
    h('div.hook-run-fold', {}, foldBtn(foldId, label, open ? `${foldId}-text` : undefined, open, flip), open ? textPre(`${foldId}-text`, label, text) : null);

  const runPanel = (entry: RunEntry): HTMLElement => {
    const result = entry.result!;
    const knownTool = 'tool' in ref ? ref.tool : undefined;
    const view = hookRunWords(knownTool ?? 'claude-cli', result, result.cwd ? shownPath(result.cwd) : '~', undefined, knownTool);
    const flip = (which: 'openAdded' | 'openAll' | 'openErr', focusId: string) => () => {
      const live = runs.get(runKey);
      if (!live?.result) return;
      live[which] = !live[which];
      document.getElementById(runPanelId)?.replaceWith(runPanel(live));
      document.getElementById(focusId)?.focus({ preventScroll: true });
    };
    const addedLines = view.added !== undefined ? view.added.replace(/\n$/, '').split('\n') : [];
    const longKept = !!entry.fromStore && addedLines.length > 6;
    const addedText = longKept && !entry.openAdded ? addedLines.slice(0, 6).join('\n') : view.added;
    return h('div.hook-run', { id: runPanelId, role: 'region', 'aria-label': 'Hook run result', onkeydown: onRunEscape },
      h('div.hook-run-head', {},
        h('span.hook-run-says', {}, view.sentence, view.meta ? [' ', h('span.hook-run-meta', { title: view.metaTitle }, view.meta)] : null),
        closeButton(closeRun, { id: `${base}-close`, label: remember ? 'Forget result' : 'Close result' })),
      ...view.notes.map(note => h('p.hook-run-note', {}, note)),
      addedText !== undefined ? textPre(`${base}-added`, 'Text the hook would add', addedText) : null,
      longKept ? h('div.hook-run-fold', {}, foldBtn(`${base}-more`, 'Show all', `${base}-added`, entry.openAdded, flip('openAdded', `${base}-more`))) : null,
      view.errDirect !== undefined ? h('div.content-block', {}, h('p.content-owner', {}, 'Standard error'), textPre(`${base}-stderr`, 'Standard error', view.errDirect)) : null,
      view.allFold !== undefined ? foldBlock(`${base}-all`, 'Show all it printed', view.allFold, entry.openAll, flip('openAll', `${base}-all`)) : null,
      view.errFold !== undefined ? foldBlock(`${base}-err-fold`, 'Standard error', view.errFold, entry.openErr, flip('openErr', `${base}-err-fold`)) : null);
  };

  const runButton = (running: boolean, hasResult: boolean): HTMLElement =>
    rowLink(running ? 'Running…' : hasResult ? 'Collect again' : 'See what it adds', runBtnId, running ? () => {} : startRun,
      { 'data-hook-run': '', ...(running ? { 'aria-disabled': 'true' } : {}), onkeydown: onRunKey });
  const stopButton = (): HTMLElement => rowLink('Stop', stopBtnId, stopRun, { 'data-hook-stop': '', onkeydown: onRunKey });

  function closeRun(): void {
    const entry = runs.get(runKey);
    if (!entry || entry.running) return;
    runs.delete(runKey);
    if (remember && state.home?.home) void window.centralKnot.hookForget?.(state.home.home, ref);
    document.getElementById(runPanelId)?.remove();
    const idle = runButton(false, false);
    document.getElementById(runBtnId)?.replaceWith(idle);
    idle.focus({ preventScroll: true });
  }

  function stopRun(event?: MouseEvent): void {
    if (event?.detail && event.detail > 1) return;
    const activeHome = state.home?.home;
    if (!activeHome || !runs.get(runKey)?.running) return;
    void window.centralKnot.hookStop(activeHome, ref);
  }

  function startRun(event?: MouseEvent): void {
    if (event?.detail && event.detail > 1) return;
    const activeHome = state.home?.home;
    if (!activeHome || runs.get(runKey)?.running) return;
    const call = ++seq;
    runs.set(runKey, { seq: call, runBtnId, running: true, kept: runs.get(runKey)?.kept, openAdded: false, openAll: false, openErr: false });
    document.getElementById(runPanelId)?.remove();
    const busy = runButton(true, false);
    document.getElementById(runBtnId)?.replaceWith(busy);
    document.getElementById(stopBtnId)?.remove();
    busy.after(stopButton());
    busy.focus({ preventScroll: true });
    void window.centralKnot.hookRun(activeHome, ref, remember)
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
        const live = runs.get(runKey);
        if (state.home?.home !== activeHome || live?.seq !== call) return;
        const kept = remember && isKeptHookOutcome(result.outcome) ? result : live.kept;
        const done: RunEntry = { seq: call, runBtnId: live.runBtnId, running: false, kept, result, openAdded: false, openAll: false, openErr: false };
        const actionsEl = document.getElementById(actionsId);
        if (!actionsEl) {
          const onOtherTab = !!live.runBtnId && !!document.getElementById(live.runBtnId);
          if (onOtherTab) runs.set(runKey, done);
          else if (kept) runs.set(runKey, keptEntry(kept, call, live.runBtnId));
          else runs.delete(runKey);
          if (onOtherTab) rerender();
          return;
        }
        const visible = rowOnScreen(actionsEl);
        runs.set(runKey, done);
        const activeId = document.activeElement?.id;
        const keepFocus = activeId === runBtnId || activeId === stopBtnId;
        const idle = runButton(false, true);
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
  const currentRun = runnable ? runs.get(runKey) : undefined;
  if (currentRun) currentRun.runBtnId = runBtnId;
  const running = !!currentRun?.running;
  const actions = h('span.hook-actions', { id: actionsId },
    runnable ? [runButton(running, !!currentRun?.result), running ? stopButton() : null] : null,
    control(!!currentSource));
  return [
    actions,
    currentRun?.result ? runPanel(currentRun) : null,
    currentSource ? panel(currentSource.source) : null,
  ].filter((node): node is HTMLElement => !!node);
}

/** One hook row (when it runs, its command, optional quiet tag, and its See what it adds / Collect again / Stop / View source controls and inline panels), shared by Instructions and a plugin's page. */
export function hookRow(hook: TextHookRow, id: string, remember = false): HTMLElement {
  return h('li.session-hook', {},
    h('span.session-lead', {}, h('span.session-when', { title: hook.source.event }, sentence(hook.when)), h('code.session-command', {}, hook.command),
      hook.tag ? h('span.session-when', {}, hook.tag) : null),
    hookSourceControls(hook.source, id, remember));
}

// Worked examples of "Run it" on a hook's row (hooksourceview.ts hookSourceControls, canRun, resetHookSources,
// pruneHookSources; sessionhooks.ts hookRunWords, hookRunWarn, hookStripHelp, hookStripCard, HOOK_RUN_WARN): Check 1 (Claude Code
// start hook printing two lines), a unit test per row of hookRunWords (every outcome and detail), T1.23 and T2.28 strip
// lines, eligibility (canRun), and row guards (hashed ids, double click, held Enter, late results dropped, leaving page
// without stopping, stale Run again refusal, source + result open together with result above source, folds kept across
// redraw, Escape focus return). No real tool folder is read and no hook of this machine's own tools is ever run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runHook, stopHookRun, type HookRunContext } from '../src/hookrun.ts';
import { readHookSource } from '../src/hooksource.ts';
import { sessionSettings } from '../src/pluginitems.ts';
import { sessionTextCardNote } from '../src/pluginoutcomes.ts';
import { HOOK_RUN_ACTUAL_CARD, HOOK_RUN_ACTUAL_ONLY, HOOK_RUN_COPILOT_PLUGIN, HOOK_RUN_WARN, hookFingerprint, hookRunWarn, hookRunWords, hookStripCard, hookStripHelp, sessionStrip } from '../src/sessionhooks.ts';
import type { HookRunResult, HookSourceRef } from '../src/types.ts';
import { standIn } from './standin.ts';

const windows = process.platform === 'win32';
const unixSkip = windows && 'POSIX hook script execution is skipped on Windows in HOOK-RUN-A2.';

const put = async (path: string, content: string, mode?: number) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, mode ? { mode } : undefined);
  if (mode && !windows) await chmod(path, mode);
};

const baseResult = (fields: Partial<HookRunResult> & Pick<HookRunResult, 'outcome'>): HookRunResult => ({
  allPrinted: '',
  stderr: '',
  durationMs: 400,
  at: '2026-11-25T21:14:00.000Z',
  cwd: '/home/u',
  emptyPrompt: false,
  ...fields,
});

const wordCount = (text: string) => text.trim().split(/\s+/).length;

// ---------- Pure unit tests: one per row of hookRunWords (Check 2) ----------

test('Check 2: hookRunWords matches every outcome, quiet trailing run place/time, blank lines, Not run, and IPC failure', () => {
  const time = '9:14 PM';

  // adds (session start, plain text matching stdout -> no extra stdout fold; with stderr -> stderr fold; no duration, no Run again)
  const addStart = hookRunWords('claude-cli', baseResult({
    outcome: 'adds', added: 'Line one\nLine two\n', allPrinted: 'Line one\nLine two\n', stderr: 'warn\n', durationMs: 400,
  }), '~', time);
  assert.deepEqual(addStart, {
    sentence: 'Would add',
    meta: 'Collected at 9:14 PM',
    metaTitle: 'run in ~',
    notes: [],
    added: 'Line one\nLine two\n',
    allFold: undefined,
    errFold: 'warn\n',
  });

  // adds (prompt hook, JSON output -> Show all it printed fold, Copilot subfolder cwd)
  const addPrompt = hookRunWords('claude-cli', baseResult({
    outcome: 'adds', added: 'Extra context', allPrinted: '{"hookSpecificOutput":{"additionalContext":"Extra context"}}',
    emptyPrompt: true, durationMs: 400,
  }), '~/sub', time);
  assert.equal(addPrompt.sentence, 'Would add');
  assert.equal(addPrompt.meta, 'Collected at 9:14 PM');
  assert.equal(addPrompt.metaTitle, 'run in ~/sub with an empty prompt');
  assert.equal(addPrompt.added, 'Extra context');
  assert.equal(addPrompt.allFold, '{"hookSpecificOutput":{"additionalContext":"Extra context"}}');
  assert.equal(addPrompt.errFold, undefined);

  // Codex adds note + overLimit (2,500 tokens) and Claude Code overLimit (10,000 characters)
  const addCodex = hookRunWords('codex-cli', baseResult({
    outcome: 'adds', added: 'ok', allPrinted: 'ok\n', overLimit: { limit: 2500, unit: 'tokens' },
  }), '~', time);
  assert.deepEqual(addCodex.notes, [
    'Codex adds it only once trusted in /hooks.',
    'Longer than Codex’s limit of 2,500 tokens: it would add only part.',
  ]);
  assert.equal(addCodex.allFold, undefined, 'trailing newline alone does not add a redundant Show all fold');
  const addClaudeLimit = hookRunWords('claude-cli', baseResult({
    outcome: 'adds', added: 'x', allPrinted: 'x', overLimit: { limit: 10000, unit: 'chars' },
  }), '~', time);
  assert.deepEqual(addClaudeLimit.notes, [
    'Longer than Claude Code’s limit of 10,000 characters: it would add only part.',
  ]);

  // empty (nothing printed vs only blank lines; stderr shown directly)
  const empty = hookRunWords('claude-cli', baseResult({ outcome: 'empty', durationMs: 200, stderr: 'note\n' }), '~', time);
  assert.deepEqual(empty, {
    sentence: 'Would add nothing: it printed nothing.',
    meta: 'Collected at 9:14 PM',
    metaTitle: 'run in ~',
    notes: [],
    errDirect: 'note\n',
  });
  const blankLines = hookRunWords('claude-cli', baseResult({ outcome: 'empty', allPrinted: '\n  \n' }), '~', time);
  assert.equal(blankLines.sentence, 'Would add nothing: it printed only blank lines.');
  assert.equal(blankLines.meta, 'Collected at 9:14 PM');

  // copilot-ignored (Show all it printed fold + direct stderr)
  const copIgnored = hookRunWords('copilot-cli', baseResult({
    outcome: 'copilot-ignored', allPrinted: 'plain hello\n', stderr: 'dbg\n', durationMs: 300,
  }), '~/copilot-work', time);
  assert.deepEqual(copIgnored, {
    sentence: 'Copilot CLI would ignore this: no top-level additionalContext.',
    meta: 'Collected at 9:14 PM',
    metaTitle: 'run in ~/copilot-work',
    notes: [],
    allFold: 'plain hello\n',
    errDirect: 'dbg\n',
  });

  // claude-exit-2 (session start and prompt hook, stderr verbatim)
  const exit2Start = hookRunWords('claude-cli', baseResult({ outcome: 'claude-exit-2', exitCode: 2, stderr: 'bad env\n' }), '~', time);
  assert.deepEqual(exit2Start, {
    sentence: 'Exited 2: Claude Code would show you this error and add nothing.',
    meta: 'Collected at 9:14 PM',
    metaTitle: 'run in ~',
    notes: [],
    errDirect: 'bad env\n',
  });
  const exit2Prompt = hookRunWords('claude-cli', baseResult({
    outcome: 'claude-exit-2', exitCode: 2, emptyPrompt: true, stderr: 'blocked\n',
  }), '~', time);
  assert.deepEqual(exit2Prompt, {
    sentence: 'Exited 2: Claude Code would block the prompt and show this error.',
    meta: 'Collected at 9:14 PM',
    metaTitle: 'run in ~ with an empty prompt',
    notes: [],
    errDirect: 'blocked\n',
  });

  // failed with exit code (direct stderr + unified Show all it printed fold; no invented "Exited ?")
  const failed = hookRunWords('claude-cli', baseResult({
    outcome: 'failed', exitCode: 7, stderr: 'boom\n', allPrinted: 'partial\n',
  }), '~', time);
  assert.deepEqual(failed, {
    sentence: 'Exited 7: it would add nothing.',
    meta: 'Collected at 9:14 PM',
    metaTitle: 'run in ~',
    notes: [],
    allFold: 'partial\n',
    errDirect: 'boom\n',
  });
  const failedNoCode = hookRunWords('claude-cli', baseResult({ outcome: 'failed' }), '~', time);
  assert.equal(failedNoCode.sentence, 'It would add nothing.');

  // Signal: ended by signal
  const signaled = hookRunWords('claude-cli', baseResult({ outcome: 'failed', signal: 'SIGTERM', stderr: 'killed\n' }), '~', time);
  assert.equal(signaled.sentence, 'Ended by SIGTERM: it would add nothing.');
  assert.equal(signaled.meta, 'Collected at 9:14 PM');
  assert.equal(signaled.errDirect, 'killed\n');

  // timeout, stopped, missing (all carry quiet meta; no invented "program not found")
  const timeout = hookRunWords('claude-cli', baseResult({ outcome: 'timeout', limitSec: 5 }), '~', time);
  assert.equal(timeout.sentence, 'Stopped after 5 s, its time limit: it would add nothing.');
  assert.equal(timeout.meta, 'Collected at 9:14 PM');
  const timeoutNoLimit = hookRunWords('claude-cli', baseResult({ outcome: 'timeout' }), '~', time);
  assert.equal(timeoutNoLimit.sentence, 'Stopped at its time limit: it would add nothing.');

  const stopped = hookRunWords('claude-cli', baseResult({ outcome: 'stopped' }), '~', time);
  assert.equal(stopped.sentence, 'Stopped. What it changed stays; a program it started may still be running.');
  assert.equal(stopped.meta, 'Collected at 9:14 PM');

  const missing = hookRunWords('claude-cli', baseResult({ outcome: 'missing', program: '/no/such/bin' }), '~', time);
  assert.equal(missing.sentence, 'Couldn’t start: /no/such/bin not found.');
  assert.equal(missing.meta, 'Tried at 9:14 PM');
  assert.equal(missing.metaTitle, undefined);
  const missingNoProg = hookRunWords('claude-cli', baseResult({ outcome: 'missing' }), '~', time);
  assert.equal(missingNoProg.sentence, 'Couldn’t start.');
  assert.equal(missingNoProg.meta, 'Tried at 9:14 PM');

  // Added not-added details
  const noCtx = hookRunWords('claude-cli', baseResult({ outcome: 'not-added', detail: 'json-no-context', allPrinted: '{"ok":true}' }), '~', time);
  assert.equal(noCtx.sentence, 'Would add nothing: its JSON has no additionalContext.');
  assert.equal(noCtx.meta, 'Collected at 9:14 PM');
  assert.equal(noCtx.allFold, '{"ok":true}');

  const block = hookRunWords('claude-cli', baseResult({ outcome: 'not-added', detail: 'json-block', allPrinted: '{"decision":"block"}' }), '~', time);
  assert.equal(block.sentence, 'Would add nothing: its JSON says to block or stop.');
  assert.equal(block.allFold, '{"decision":"block"}');

  const badJsonClaude = hookRunWords('claude-cli', baseResult({ outcome: 'not-added', detail: 'invalid-json', allPrinted: '{bad' }), '~', time);
  assert.equal(badJsonClaude.sentence, 'Would add nothing: Claude Code can’t read its JSON.');
  assert.equal(badJsonClaude.allFold, '{bad');

  const badJsonCodex = hookRunWords('codex-cli', baseResult({ outcome: 'not-added', detail: 'invalid-json', allPrinted: '[bad' }), '~', time);
  assert.equal(badJsonCodex.sentence, 'Would add nothing: Codex can’t read its JSON.');

  const codexExit2 = hookRunWords('codex-cli', baseResult({
    outcome: 'not-added', detail: 'codex-prompt-exit-2', exitCode: 2, emptyPrompt: true, stderr: 'err', allPrinted: 'out',
  }), '~', time);
  assert.equal(codexExit2.sentence, 'Exited 2: it would add nothing.');
  assert.equal(codexExit2.meta, 'Collected at 9:14 PM');
  assert.equal(codexExit2.metaTitle, 'run in ~ with an empty prompt');
  assert.equal(codexExit2.errDirect, 'err');
  assert.equal(codexExit2.allFold, 'out');

  const overflow = hookRunWords('claude-cli', baseResult({ outcome: 'not-added', detail: 'overflow', allPrinted: 'big' }), '~', time);
  assert.equal(overflow.sentence, 'Stopped: it printed more than Central Knot reads.');
  assert.equal(overflow.meta, 'Collected at 9:14 PM');
  assert.equal(overflow.allFold, 'big');

  const spawnErr = hookRunWords('copilot-cli', baseResult({ outcome: 'not-added', detail: 'spawn-error', problem: 'Working folder not found: /nope' }), '~/nope', time);
  assert.equal(spawnErr.sentence, 'Couldn’t start: Working folder not found: /nope');
  assert.equal(spawnErr.meta, 'Tried at 9:14 PM');
  const spawnNoProblem = hookRunWords('copilot-cli', baseResult({ outcome: 'not-added', detail: 'spawn-error' }), '~', time);
  assert.equal(spawnNoProblem.sentence, 'Couldn’t start.');
  assert.equal(spawnNoProblem.meta, 'Tried at 9:14 PM');

  // Refusal: "Not run: " + main's words (lowercase ordinary lead, keep proper nouns and paths); no meta. IPC failure: "Couldn't run it."
  const refused = hookRunWords('codex-cli', baseResult({
    outcome: 'refused', problem: 'Hooks are turned off in Codex’s settings ([features] codex_hooks = false).',
  }), '~', time);
  assert.equal(refused.sentence, 'Not run: hooks are turned off in Codex’s settings ([features] codex_hooks = false).');
  assert.equal(refused.meta, undefined);
  const refusedPath = hookRunWords('claude-cli', baseResult({
    outcome: 'refused', problem: '~/.claude/settings.json changed since this page was read. Refresh to see it.',
  }), '~', time);
  assert.equal(refusedPath.sentence, 'Not run: ~/.claude/settings.json changed since this page was read. Refresh to see it.');
  const refusedProper = hookRunWords('claude-cli', baseResult({
    outcome: 'refused', problem: 'Central Knot is quitting.',
  }), '~', time);
  assert.equal(refusedProper.sentence, 'Not run: Central Knot is quitting.');
  const refusedPluginOff = hookRunWords('claude-cli', baseResult({
    outcome: 'refused', problem: 'ReleaseHelper is turned off in Claude Code.',
  }), '~', time);
  assert.equal(refusedPluginOff.sentence, 'Not run: ReleaseHelper is turned off in Claude Code.');
  const refusedCopilotPlugin = hookRunWords('copilot-cli', baseResult({
    outcome: 'refused', problem: HOOK_RUN_COPILOT_PLUGIN,
  }), '~', time);
  assert.equal(refusedCopilotPlugin.sentence, `Not run: ${HOOK_RUN_COPILOT_PLUGIN}`);
  const refusedActualOnly = hookRunWords('claude-cli', baseResult({
    outcome: 'refused', problem: HOOK_RUN_ACTUAL_ONLY,
  }), '~', time);
  assert.equal(refusedActualOnly.sentence, 'Not run: See what it adds works only on this computer’s home.');
  const ipcFailed = hookRunWords('claude-cli', baseResult({ outcome: 'refused' }), '~', time);
  assert.equal(ipcFailed.sentence, 'Couldn’t run it.');
  assert.equal(ipcFailed.meta, undefined);

  // missingOptions note shows under started outcomes and not on refused / couldn't start.
  const missingOptsAdds = hookRunWords('claude-cli', baseResult({
    outcome: 'adds', added: 'ok', allPrinted: 'ok', missingOptions: true,
  }), '~', time);
  assert.deepEqual(missingOptsAdds.notes, ['Ran without some of the plugin’s options.']);
  const missingOptsEmpty = hookRunWords('claude-cli', baseResult({ outcome: 'empty', missingOptions: true }), '~', time);
  assert.deepEqual(missingOptsEmpty.notes, ['Ran without some of the plugin’s options.']);
  const missingOptsNotStarted = hookRunWords('claude-cli', baseResult({ outcome: 'missing', program: '/nope', missingOptions: true }), '~', time);
  assert.deepEqual(missingOptsNotStarted.notes, []);
});

// ---------- Pure unit tests: T1.23 & T2.28 strip lines (Check 3) ----------

test('Check 3: standing warning (See what it adds, plain sentences), help card (<= 2 sentences, <= 30 words), and hookStripCard (<= 2 sentences)', async t => {
  const sentences = (text: string) => text.split(/(?<=\.)\s+/).length;
  await t.test('item 1 & 7: standing warning covers both button states, says nothing is added to any session, and on Codex names its /hooks command', () => {
    assert.equal(HOOK_RUN_WARN, 'Collecting what a hook adds runs its command on this computer. Nothing is added to any session, but the command may change your files.');
    assert.equal(hookRunWarn('claude-cli'), HOOK_RUN_WARN);
    const codexWarn = hookRunWarn('codex-cli');
    assert.equal(codexWarn, 'Collecting what a hook adds runs its command on this computer, whether or not you have trusted it in Codex’s /hooks command. Nothing is added to any session, but the command may change your files.');
    assert.ok(sentences(HOOK_RUN_WARN) <= 2 && sentences(codexWarn) <= 2);
  });

  await t.test('item 2 & 7: first help card is at most two whole sentences and <= 30 words without semicolons', () => {
    const claudeRun = hookStripHelp('claude-cli', true);
    assert.equal(claudeRun, 'This lists session-start and prompt hooks, not URL, MCP, project or organisation. “See what it adds” uses your home or the hook’s folder, and plugin hooks can change installed files.');
    assert.ok(wordCount(claudeRun) <= 30, `expected <=30 words, got ${wordCount(claudeRun)}`);
    assert.ok(sentences(claudeRun) <= 2 && !claudeRun.includes(';'));
    assert.equal(hookStripHelp('claude-cli', false), 'This lists session-start and prompt hooks, not URL, MCP, project or organisation.');
    assert.equal(hookStripHelp('copilot-cli', false), 'This lists session-start hooks, not URL, MCP, project or organisation.');
  });
  const codexNote = sessionTextCardNote('codex-cli', true)!;
  const copRowsNote = sessionTextCardNote('copilot-cli', true)!;
  const copPromptNote = sessionTextCardNote('copilot-cli', false)!;
  const checkCard = (card: string | undefined, expected: string) => {
    assert.equal(card, expected);
    assert.ok(sentences(card!) <= 2 && !card!.includes(';'), `expected <= 2 whole sentences without semicolons: ${card}`);
  };
  assert.equal(hookStripCard('claude-cli', {}, { first: false, anyRunnable: true }), undefined);
  checkCard(hookStripCard('codex-cli', { note: codexNote }, { first: false, anyRunnable: true }), codexNote);
  checkCard(hookStripCard('codex-cli', { note: codexNote }, { first: false, anyRunnable: false, cantRun: HOOK_RUN_ACTUAL_ONLY }), `${HOOK_RUN_ACTUAL_ONLY} ${codexNote}`);
  checkCard(hookStripCard('codex-cli', { note: codexNote }, { first: true, anyRunnable: true }), `${codexNote} ${hookStripHelp('codex-cli', false)}`);
  checkCard(hookStripCard('codex-cli', { note: codexNote }, { first: true, anyRunnable: false, cantRun: HOOK_RUN_ACTUAL_ONLY }), `${HOOK_RUN_ACTUAL_ONLY} ${codexNote}`);
  checkCard(hookStripCard('copilot-cli', { note: copPromptNote }, { first: false, anyRunnable: true }), copPromptNote);
  checkCard(hookStripCard('copilot-cli', { note: copPromptNote }, { first: true, anyRunnable: false }), `${copPromptNote} ${hookStripHelp('copilot-cli', false)}`);
  checkCard(hookStripCard('copilot-cli', { note: copRowsNote }, { first: false, anyRunnable: true, cantRun: HOOK_RUN_COPILOT_PLUGIN }), `${HOOK_RUN_COPILOT_PLUGIN} ${copRowsNote}`);
  checkCard(hookStripCard('copilot-cli', { note: copRowsNote }, { first: true, anyRunnable: true, cantRun: HOOK_RUN_COPILOT_PLUGIN }), `${HOOK_RUN_COPILOT_PLUGIN} ${copRowsNote}`);
  checkCard(hookStripCard('claude-cli', {}, { first: true, anyRunnable: true }), hookStripHelp('claude-cli', true));
  checkCard(hookStripCard('claude-cli', {}, { first: true, anyRunnable: false, cantRun: HOOK_RUN_ACTUAL_ONLY }), `${HOOK_RUN_ACTUAL_ONLY} ${hookStripHelp('claude-cli', false)}`);
  checkCard(hookStripCard('claude-cli', {}, { first: true, anyRunnable: false }), hookStripHelp('claude-cli', false));
});

// ---------- DOM harness for Checks 1, 4, 5, 6, 7, 8 ----------

function makeDom() {
  const nodes = new Map<string, any>();
  const scrolled: { id: string; opts: any }[] = [];
  const docListeners = new Map<string, ((event: any) => void)[]>();
  const winListeners = new Map<string, ((event: any) => void)[]>();
  const register = (node: any) => {
    node.connected = true;
    node.isConnected = true;
    if (node?.id) nodes.set(node.id, node);
    for (const child of node?.children ?? []) if (child && typeof child === 'object') register(child);
  };
  const unregister = (node: any) => {
    node.connected = false;
    node.isConnected = false;
    if (node?.id && nodes.get(node.id) === node) nodes.delete(node.id);
    for (const child of node?.children ?? []) if (child && typeof child === 'object') unregister(child);
  };
  const makeNode = (tag = 'div') => {
    const node: any = {
      tag, children: [] as any[], attrs: {} as Record<string, unknown>, className: '', textContent: '', dataset: {},
      isConnected: false, connected: false, rect: { top: 40, bottom: 60, left: 0, right: 200 },
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, content: {},
      setAttribute(k: string, v: string) { this.attrs[k] = v; if (k === 'id') this.id = v; },
      getAttribute(k: string) { return this.attrs[k] ?? null; },
      matches(sel: string) {
        if (sel === ':disabled') return Boolean(this.disabled || this.attrs.disabled);
        if (sel === 'pre') return this.tag === 'pre';
        if (sel === '.scroll') return this.className.split(/\s+/).includes('scroll');
        if (sel === 'button[id]') return this.tag === 'button' && Boolean(this.id);
        if (sel === 'button[id], pre[id]') return (this.tag === 'button' || this.tag === 'pre') && Boolean(this.id);
        return false;
      },
      closest(sel: string) {
        let cur: any = this;
        while (cur) {
          if (cur.matches?.(sel)) return cur;
          cur = cur.parent;
        }
        return null;
      },
      contains(target: any) {
        let cur: any = target;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parent;
        }
        return false;
      },
      getBoundingClientRect() { return this.rect; },
      dispatchEvent(ev: any) {
        ev.target = this;
        if (ev.type === 'click' && typeof this.onclick === 'function') this.onclick(ev);
        return true;
      },
      append(...items: any[]) {
        for (const item of items) {
          this.children.push(item);
          if (item && typeof item === 'object') {
            item.parent = this;
            if (this.connected) register(item);
          }
        }
      },
      appendChild() {}, replaceChildren() {}, addEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
      replaceWith(next: any) {
        unregister(this);
        if (this.parent) {
          const idx = this.parent.children.indexOf(this);
          if (idx >= 0) this.parent.children.splice(idx, 1, next);
          next.parent = this.parent;
          if (this.parent.connected) register(next);
        }
      },
      remove() {
        unregister(this);
        if (this.parent) {
          const idx = this.parent.children.indexOf(this);
          if (idx >= 0) this.parent.children.splice(idx, 1);
          this.parent = undefined;
        }
      },
      after(...items: any[]) {
        if (this.parent) {
          const idx = this.parent.children.indexOf(this);
          if (idx >= 0) this.parent.children.splice(idx + 1, 0, ...items);
        }
        for (const item of items) {
          if (item && typeof item === 'object') {
            item.parent = this.parent;
            if (this.parent?.connected) register(item);
          }
        }
      },
      focus() { (globalThis as any).document.activeElement = this; },
      scrollIntoView(opts?: any) { scrolled.push({ id: this.id, opts }); },
    };
    return node;
  };
  const textOf = (node: any): string => (typeof node === 'string' ? node : node?.text ?? (node?.children ?? []).map(textOf).join(''));
  const findAll = (root: any, pred: (n: any) => boolean): any[] => {
    const out: any[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (pred(n)) out.push(n);
      for (const c of n.children ?? []) walk(c);
    };
    walk(root);
    return out;
  };
  const emit = (map: Map<string, ((e: any) => void)[]>, type: string, event: any) => {
    const ev = { type, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, defaultPrevented: false, ...event };
    for (const fn of map.get(type) ?? []) fn(ev);
    return ev;
  };
  class FakeMouseEvent {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    clientX: number;
    clientY: number;
    detail: number;
    constructor(type: string, init: any = {}) {
      this.type = type;
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
      this.clientX = init.clientX ?? 0;
      this.clientY = init.clientY ?? 0;
      this.detail = init.detail ?? 0;
    }
  }
  const handlers: Record<string, (...args: any[]) => any> = {};
  const announcement = makeNode('span');
  announcement.id = 'announcement';
  nodes.set('announcement', announcement);
  Object.assign(globalThis, {
    MouseEvent: FakeMouseEvent,
    document: {
      body: makeNode('body'), documentElement: makeNode('html'), activeElement: null, hidden: false, hasFocus: () => true,
      createElement: (tag: string) => makeNode(tag), createTextNode: (text: string) => ({ text }),
      getElementById: (id: string) => nodes.get(id) ?? null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener(type: string, fn: (e: any) => void) { (docListeners.get(type) ?? docListeners.set(type, []).get(type)!).push(fn); },
    },
    window: {
      innerHeight: 600,
      addEventListener(type: string, fn: (e: any) => void) { (winListeners.get(type) ?? winListeners.set(type, []).get(type)!).push(fn); },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      centralKnot: new Proxy(handlers, { get: (target, prop) => (prop in target ? target[prop as string] : async () => null) }),
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 0,
  });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, configurable: true });
  return {
    nodes, scrolled, makeNode, textOf, findAll, handlers,
    emitDoc: (type: string, event: any) => emit(docListeners, type, event),
  };
}

test('Check 1 & 6: Claude Code start-of-session stand-in runs on click, shows Running… then Would add in view, and Run again after disk edit refuses', { skip: unixSkip, timeout: 15_000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-hookrunview-'));
  try {
    const home = join(base, 'home');
    const tools = join(base, 'tools');
    const data = join(base, 'data');
    await mkdir(join(tools, '.local/bin'), { recursive: true });
    await standIn(join(tools, '.local/bin/claude'), '#!/bin/sh\necho "2.1.327 (Claude Code)"\n', 'console.log("2.1.327");');
    const script = join(home, 'bin/two-lines.sh');
    await put(script, '#!/bin/sh\nprintf "First line from hook\\nSecond line from hook\\n"\n', 0o755);
    const settings = join(home, '.claude/settings.json');
    await put(settings, JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/bin/two-lines.sh' }] }] },
    }, null, 2));
    const strip = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(home, '.claude')))!;
    const ref = strip.groups[0]!.hooks[0]!.source;

    const dom = makeDom();
    const ctx: HookRunContext = {
      home, mode: 'actual', dataDir: data, toolsHome: tools,
      searchPath: process.env.PATH ?? '/usr/bin:/bin',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home },
    };
    let release!: () => void;
    let gate = new Promise<void>(resolve => { release = resolve; });
    let pending: Promise<HookRunResult> = Promise.resolve(baseResult({ outcome: 'empty' }));
    dom.handlers.hookRun = (_h: string, r: HookSourceRef) => {
      pending = gate.then(() => runHook(ctx, r));
      return pending;
    };
    dom.handlers.hookStop = (h: string, r: HookSourceRef) => { stopHookRun(h, r); };

    await import('../src/settingspage.ts');
    const { state } = await import('../src/app.ts');
    const viewMod = await import('../src/hooksourceview.ts');
    viewMod.resetHookSources();
    state.home = { home, mode: 'actual', label: 'This computer’s home' } as any;

    const row = dom.makeNode('li');
    row.connected = true;
    row.append(...viewMod.hookSourceControls(ref, 'hook-source-instructions-claude-cli-0-0'));
    const runBtn = dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0];
    assert.ok(runBtn, 'expected a See what it adds button on an own Claude Code hook row in actual home');
    assert.equal(dom.textOf(runBtn), 'See what it adds');

    // Click Run it -> Running… (same id, aria-disabled, focused) and Stop.
    runBtn.onclick({ detail: 1 });
    const runningBtn = dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0];
    const stopBtn = dom.findAll(row, n => 'data-hook-stop' in (n.attrs ?? {}))[0];
    assert.equal(dom.textOf(runningBtn), 'Running…');
    assert.equal(runningBtn.id, runBtn.id);
    assert.equal(runningBtn.getAttribute('aria-disabled'), 'true');
    assert.equal((globalThis as any).document.activeElement, runningBtn);
    assert.equal(dom.textOf(stopBtn), 'Stop');

    release();
    await pending;
    await new Promise(resolve => setTimeout(resolve, 10));

    const panel = dom.findAll(row, n => n.className === 'hook-run')[0];
    assert.ok(panel, 'expected .hook-run result panel');
    const panelText = dom.textOf(panel);
    assert.match(panelText, /^Would add Collected today at /);
    assert.equal(dom.findAll(panel, n => n.className === 'hook-run-meta')[0]?.getAttribute('title'), 'as Claude Code, run in ~');
    assert.doesNotMatch(panelText, /Run again/);
    assert.match(panelText, /First line from hook\nSecond line from hook/);
    assert.deepEqual(dom.scrolled, [{ id: panel.id, opts: { block: 'nearest' } }]);

    // Check 6: edit hook on disk, then click Run it -> shows "Not run:" + main's refusal.
    await put(settings, JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/bin/changed.sh' }] }] },
    }, null, 2));
    gate = Promise.resolve();
    dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
    await pending;
    await new Promise(resolve => setTimeout(resolve, 10));
    const refusedPanel = dom.findAll(row, n => n.className === 'hook-run')[0];
    assert.match(dom.textOf(refusedPanel), /Not run: this hook is no longer in ~\/\.claude\/settings\.json\./);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Checks 4, 5, 6, 7, 8: eligibility, hashed ids, double click & held Enter guards, late results dropped, folds across redraw, source + result order, Escape focus', async () => {
  const dom = makeDom();
  let runCalls = 0;
  let stopCalls = 0;
  const pendingResolvers: ((r: HookRunResult) => void)[] = [];
  dom.handlers.hookRun = () => {
    runCalls++;
    return new Promise<HookRunResult>(resolve => { pendingResolvers.push(resolve); });
  };
  dom.handlers.hookStop = () => { stopCalls++; };
  dom.handlers.hookSource = async () => ({ file: '/tmp/h/.claude/settings.json', entry: '{"command":"echo a"}' });

  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  viewMod.resetHookSources();

  const ownRef: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, command: 'echo a', fingerprint: 'fp-a' };
  const ownRef2: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 1, command: 'echo a', fingerprint: 'fp-a' };
  const pluginRef: HookSourceRef = { from: 'installed', tool: 'claude-cli', plugin: 'p', marketName: 'm', declaredIn: '/p/hooks.json', event: 'SessionStart', at: 0, command: 'echo p', fingerprint: 'fp-p' };
  const codexPluginRef: HookSourceRef = { from: 'installed', tool: 'codex-cli', plugin: 'p', marketName: 'm', declaredIn: '/p/hooks.json', event: 'SessionStart', at: 0, command: 'echo p', fingerprint: 'fp-p' };
  const copilotPluginRef: HookSourceRef = { from: 'installed', tool: 'copilot-cli', plugin: 'p', marketName: 'm', declaredIn: '/p/hooks.json', event: 'SessionStart', at: 0, command: 'echo p', fingerprint: 'fp-p' };
  const marketRef: HookSourceRef = { from: 'marketplace', marketName: 'm', plugin: 'p', declaredIn: '/m/hooks.json', event: 'SessionStart', at: 0, command: 'echo m', fingerprint: 'fp-m' };

  // Check 4: eligibility gate (actual + non-Windows + own or Claude Code / Codex installed plugin).
  state.home = undefined;
  assert.equal(viewMod.canRun(ownRef, undefined, 'linux'), false);
  assert.equal(viewMod.canRun(ownRef, 'actual', 'linux'), true);
  assert.equal(viewMod.canRun(ownRef, 'actual', 'darwin'), true);
  assert.equal(viewMod.canRun(ownRef, 'actual', 'win32'), false);
  assert.equal(viewMod.canRun(ownRef, 'custom', 'linux'), false);
  assert.equal(viewMod.canRun(ownRef, 'fixture', 'linux'), false);
  assert.equal(viewMod.canRun(pluginRef, 'actual', 'linux'), true);
  assert.equal(viewMod.canRun(pluginRef, 'actual', 'darwin'), true);
  assert.equal(viewMod.canRun(pluginRef, 'actual', 'win32'), false);
  assert.equal(viewMod.canRun(pluginRef, 'custom', 'linux'), false);
  assert.equal(viewMod.canRun(codexPluginRef, 'actual', 'linux'), true);
  assert.equal(viewMod.canRun(copilotPluginRef, 'actual', 'linux'), false);
  assert.equal(viewMod.canRun(marketRef, 'actual', 'linux'), false);

  // Non-runnable row renders only View source and never Run it.
  state.home = { home: '/tmp/h', mode: 'custom', label: 'Other' } as any;
  const customRow = dom.makeNode('li');
  customRow.connected = true;
  customRow.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  assert.equal(dom.findAll(customRow, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
  assert.equal(dom.findAll(customRow, n => 'data-hook-source' in (n.attrs ?? {})).length, 1);

  // Switch to actual home: drawing never runs anything; duplicate command rows get distinct ids; changed ref at same slot changes id.
  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home' } as any;
  const rowA = dom.makeNode('li');
  rowA.connected = true;
  rowA.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  const rowB = dom.makeNode('li');
  rowB.connected = true;
  rowB.append(...viewMod.hookSourceControls(ownRef2, 'hook-source-instructions-claude-cli-0-1'));
  const rowChanged = dom.makeNode('li');
  rowChanged.append(...viewMod.hookSourceControls({ ...ownRef, command: 'echo different' }, 'hook-source-instructions-claude-cli-0-0'));
  const runBtnA = dom.findAll(rowA, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  const runBtnB = dom.findAll(rowB, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  const runBtnChanged = dom.findAll(rowChanged, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  assert.notEqual(runBtnA.id, runBtnB.id, 'same command in two rows gets distinct ids');
  assert.notEqual(runBtnA.id, runBtnChanged.id, 'different hook at same slot gets a different hashed id');
  assert.equal(runCalls, 0, 'drawing never starts a run');

  // Double click (detail > 1) and held Enter (repeat: true) start 1 run and stop 0.
  let prevented = false;
  runBtnA.onkeydown({ key: 'Enter', repeat: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'repeated Enter on Run it is prevented');
  runBtnA.onclick({ detail: 1 });
  const runningBtn = dom.findAll(rowA, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  const stopBtn = dom.findAll(rowA, n => 'data-hook-stop' in (n.attrs ?? {}))[0];
  runningBtn.onclick({ detail: 2 });
  stopBtn.onclick({ detail: 2 });
  assert.deepEqual([runCalls, stopCalls], [1, 0], 'double click starts one run and stops none');

  // Redraw while running keeps Running… + Stop (pruning by button id keeps a running row without a panel).
  dom.nodes.clear();
  const redrawnA = dom.makeNode('li');
  redrawnA.connected = true;
  redrawnA.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  viewMod.pruneHookSources();
  assert.equal(dom.textOf(dom.findAll(redrawnA, n => 'data-hook-run' in (n.attrs ?? {}))[0]), 'Running…');
  assert.equal(dom.findAll(redrawnA, n => 'data-hook-stop' in (n.attrs ?? {})).length, 1);

  // Resolve with JSON + stderr -> folds toggle in place and survive a redraw!
  pendingResolvers.shift()!(baseResult({
    outcome: 'adds', added: 'Injected text', allPrinted: '{"hookSpecificOutput":{"additionalContext":"Injected text"}}', stderr: 'trace line\n',
  }));
  await new Promise(resolve => setTimeout(resolve, 10));
  let resultPanel = dom.findAll(redrawnA, n => n.className === 'hook-run')[0];
  assert.ok(resultPanel);
  const allFoldBtn = dom.findAll(resultPanel, n => n.id?.endsWith('-all'))[0];
  const errFoldBtn = dom.findAll(resultPanel, n => n.id?.endsWith('-err-fold'))[0];
  assert.equal(allFoldBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(errFoldBtn.getAttribute('aria-expanded'), 'false');
  allFoldBtn.onclick();
  resultPanel = dom.findAll(redrawnA, n => n.className === 'hook-run')[0];
  assert.match(dom.textOf(resultPanel), /hookSpecificOutput/);
  // Redraw preserves openAll = true, openErr = false!
  dom.nodes.clear();
  const afterFoldRedraw = dom.makeNode('li');
  afterFoldRedraw.connected = true;
  afterFoldRedraw.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  viewMod.pruneHookSources();
  const panelAfterRedraw = dom.findAll(afterFoldRedraw, n => n.className === 'hook-run')[0];
  assert.equal(dom.findAll(panelAfterRedraw, n => n.id?.endsWith('-all'))[0].getAttribute('aria-expanded'), 'true');
  assert.equal(dom.findAll(panelAfterRedraw, n => n.id?.endsWith('-err-fold'))[0].getAttribute('aria-expanded'), 'false');

  // Check 7: open View source while result is open -> both open together, result ABOVE source!
  const srcBtn = dom.findAll(afterFoldRedraw, n => 'data-hook-source' in (n.attrs ?? {}))[0];
  srcBtn.onclick();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(afterFoldRedraw.children.map((c: any) => c.className), ['hook-actions', 'hook-run', 'hook-source']);

  // Check 8: Escape inside result closes result and focuses Run it, leaving source open!
  const runPanelEl = afterFoldRedraw.children[1];
  runPanelEl.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(afterFoldRedraw.children.map((c: any) => c.className), ['hook-actions', 'hook-source']);
  assert.equal((globalThis as any).document.activeElement?.id, dom.findAll(afterFoldRedraw, n => 'data-hook-run' in (n.attrs ?? {}))[0].id);

  // Re-run while source is ALREADY open -> result inserts ABOVE source!
  dom.findAll(afterFoldRedraw, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  pendingResolvers.shift()!(baseResult({ outcome: 'empty' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(afterFoldRedraw.children.map((c: any) => c.className), ['hook-actions', 'hook-run', 'hook-source']);

  // Check 6: late results dropped on Refresh (resetHookSources), home switch, and leaving page (pruneHookSources, without stopping main).
  dom.findAll(afterFoldRedraw, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  const refreshResolver = pendingResolvers.shift()!;
  viewMod.resetHookSources();
  refreshResolver(baseResult({ outcome: 'adds', added: 'stale refresh' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(dom.findAll(afterFoldRedraw, n => n.className === 'hook-run').length, 0);

  // Leaving page (pruneHookSources) drops a finished result (not remembered on return).
  dom.nodes.clear();
  const doneRow = dom.makeNode('li');
  doneRow.connected = true;
  doneRow.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  dom.findAll(doneRow, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  pendingResolvers.shift()!(baseResult({ outcome: 'adds', added: 'shown once' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(dom.findAll(doneRow, n => n.className === 'hook-run').length, 1);
  dom.nodes.clear();
  viewMod.pruneHookSources();
  const returnedAfterDone = dom.makeNode('li');
  returnedAfterDone.connected = true;
  returnedAfterDone.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  assert.equal(dom.findAll(returnedAfterDone, n => n.className === 'hook-run').length, 0, 'leaving the page forgets finished results');

  // Leaving page (pruneHookSources) keeps an in-flight run without calling hookStop so returning before it settles shows Running… + Stop and receives the result; settling while off-page drops the late result!
  dom.nodes.clear();
  const liveRow = dom.makeNode('li');
  liveRow.connected = true;
  liveRow.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  dom.findAll(liveRow, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  const returnResolver = pendingResolvers.shift()!;
  const stopsBeforeLeave = stopCalls;
  dom.nodes.clear();
  viewMod.pruneHookSources();
  assert.equal(stopCalls, stopsBeforeLeave, 'leaving the page does not stop a running hook');
  // Returning before the run settles keeps Running… + Stop, and then receives the result in place.
  const returnedRow = dom.makeNode('li');
  returnedRow.connected = true;
  returnedRow.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  assert.equal(dom.textOf(dom.findAll(returnedRow, n => 'data-hook-run' in (n.attrs ?? {}))[0]), 'Running…');
  assert.equal(dom.findAll(returnedRow, n => 'data-hook-stop' in (n.attrs ?? {})).length, 1);
  returnResolver(baseResult({ outcome: 'adds', added: 'arrived after return' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(dom.textOf(dom.findAll(returnedRow, n => n.className === 'hook-run')[0]), /arrived after return/);

  // Settling while the row is off the page drops the late result so a later return shows idle Run it and no panel.
  dom.findAll(returnedRow, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  const awayResolver = pendingResolvers.shift()!;
  dom.nodes.clear();
  viewMod.pruneHookSources();
  awayResolver(baseResult({ outcome: 'adds', added: 'settled while away' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  const afterAwayRow = dom.makeNode('li');
  afterAwayRow.connected = true;
  afterAwayRow.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  assert.equal(dom.textOf(dom.findAll(afterAwayRow, n => 'data-hook-run' in (n.attrs ?? {}))[0]), 'See what it adds');
  assert.equal(dom.findAll(afterAwayRow, n => n.className === 'hook-run').length, 0);
});

// ---------- Fix-round failing checks for items 1 to 5 ----------

test('Declaration fingerprint: matcher or Copilot cwd edit changes button id, drops open result, and refuses stale run and source reads', { skip: unixSkip, timeout: 15_000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-hookfp-'));
  try {
    const home = join(base, 'home');
    const tools = join(base, 'tools');
    const data = join(base, 'data');
    await mkdir(join(tools, '.local/bin'), { recursive: true });
    await standIn(join(tools, '.local/bin/claude'), '#!/bin/sh\necho "2.1.327 (Claude Code)"\n', 'console.log("2.1.327");');
    await standIn(join(tools, '.local/bin/copilot'), '#!/bin/sh\necho "GitHub Copilot CLI 1.0.107."\n', 'console.log("1.0.107");');
    await mkdir(join(home, 'dir-a'), { recursive: true });
    await mkdir(join(home, 'dir-b'), { recursive: true });
    await put(join(home, 'bin/echo-ok.sh'), '#!/bin/sh\necho ok\n', 0o755);
    const claudeFile = join(home, '.claude/settings.json');
    const copilotFile = join(home, '.copilot/hooks/start.json');
    await put(claudeFile, JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/bin/echo-ok.sh' }] }] },
    }, null, 2));
    await put(copilotFile, JSON.stringify({
      version: 1, hooks: { sessionStart: [{ type: 'command', bash: '~/bin/echo-ok.sh', cwd: 'dir-a' }] },
    }, null, 2));

    const oldClaude = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(home, '.claude')))!.groups[0]!.hooks[0]!.source;
    const oldCopilot = sessionStrip('copilot-cli', [], await sessionSettings('copilot-cli', join(home, '.copilot')))!.groups[0]!.hooks[0]!.source;
    const ctx: HookRunContext = {
      home, mode: 'actual', dataDir: data, toolsHome: tools,
      searchPath: process.env.PATH ?? '/usr/bin:/bin',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home },
    };

    // Edit matcher in place (same slot, same command) and Copilot cwd in place.
    await put(claudeFile, JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command', command: '~/bin/echo-ok.sh' }] }] },
    }, null, 2));
    await put(copilotFile, JSON.stringify({
      version: 1, hooks: { sessionStart: [{ type: 'command', bash: '~/bin/echo-ok.sh', cwd: 'dir-b' }] },
    }, null, 2));

    const claudeRefused = await runHook(ctx, oldClaude);
    assert.equal(claudeRefused.outcome, 'refused', 'matcher change must refuse stale Run it');
    assert.match(claudeRefused.problem ?? '', /changed since this page was read/);
    const srcRefused = await readHookSource(ctx, oldClaude);
    assert.match(srcRefused.problem ?? '', /changed since this page was read/);

    const copilotRefused = await runHook(ctx, oldCopilot);
    assert.equal(copilotRefused.outcome, 'refused', 'Copilot cwd change must refuse stale Run it');
    assert.match(copilotRefused.problem ?? '', /changed since this page was read/);

    // Page keys buttons and results by fingerprint: matcher edit produces a new row id with no carried result.
    const newClaude = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(home, '.claude')))!.groups[0]!.hooks[0]!.source;
    const dom = makeDom();
    dom.handlers.hookRun = async () => baseResult({ outcome: 'adds', added: 'startup text' });
    await import('../src/settingspage.ts');
    const { state } = await import('../src/app.ts');
    const viewMod = await import('../src/hooksourceview.ts');
    viewMod.resetHookSources();
    state.home = { home, mode: 'actual', label: 'Home' } as any;

    const oldRow = dom.makeNode('li');
    oldRow.connected = true;
    oldRow.append(...viewMod.hookSourceControls(oldClaude, 'hook-source-instructions-claude-cli-0-0'));
    const oldBtn = dom.findAll(oldRow, n => 'data-hook-run' in (n.attrs ?? {}))[0];
    oldBtn.onclick({ detail: 1 });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(dom.findAll(oldRow, n => n.className === 'hook-run').length, 1);

    dom.nodes.clear();
    const newRow = dom.makeNode('li');
    newRow.connected = true;
    newRow.append(...viewMod.hookSourceControls(newClaude, 'hook-source-instructions-claude-cli-0-0'));
    viewMod.pruneHookSources();
    const newBtn = dom.findAll(newRow, n => 'data-hook-run' in (n.attrs ?? {}))[0];
    assert.notEqual(newBtn.id, oldBtn.id, 'matcher edit must change button id');
    assert.equal(dom.findAll(newRow, n => n.className === 'hook-run').length, 0, 'old result must not stay under edited matcher row');

    // Fingerprint covers env (order-independent), timeout, shell, launch form, type, cwd, matcher and event.
    const baseHook = { declaredIn: claudeFile, event: 'SessionStart', at: 0, launch: { shell: 'echo ok' } as const };
    assert.equal(
      hookFingerprint({ ...baseHook, env: { B: '2', A: '1' } }),
      hookFingerprint({ ...baseHook, env: { A: '1', B: '2' } }),
      'env key order does not spuriously change fingerprint',
    );
    assert.notEqual(hookFingerprint({ ...baseHook, env: { A: '1' } }), hookFingerprint({ ...baseHook, env: { A: '2' } }));
    assert.notEqual(hookFingerprint({ ...baseHook, timeout: 5 }), hookFingerprint({ ...baseHook, timeout: 10 }));
    assert.notEqual(hookFingerprint({ ...baseHook, shell: 'sh' }), hookFingerprint({ ...baseHook, shell: 'bash' }));
    assert.notEqual(hookFingerprint(baseHook), hookFingerprint({ ...baseHook, launch: { program: 'echo', args: ['ok'] } }));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Replayed double click across a redraw keeps its click count and starts one run, not two', async () => {
  const dom = makeDom();
  let runCalls = 0;
  dom.handlers.hookRun = async () => {
    runCalls++;
    return baseResult({ outcome: 'adds', added: 'fast' });
  };
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const { keepClicksAcrossRedraws } = await import('../src/dom.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  viewMod.resetHookSources();
  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home' } as any;
  keepClicksAcrossRedraws(() => 'instructions');

  const ref: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, command: 'echo fast', fingerprint: 'fp-fast' };
  const draw = () => {
    dom.nodes.clear();
    const row = dom.makeNode('li');
    row.connected = true;
    row.append(...viewMod.hookSourceControls(ref, 'hook-source-instructions-claude-cli-0-0'));
    return dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  };

  // Click 1 finishes immediately (returning idle Run it).
  const btn1 = draw();
  btn1.onclick({ detail: 1 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(runCalls, 1);

  // Click 2 (double-click: mousedown detail 2) starts on btnBefore, redraw replaces it, pointerup replays click.
  const btnBefore = draw();
  dom.emitDoc('pointerdown', { button: 0, pointerId: 1, clientX: 5, clientY: 5, detail: 0, shiftKey: false, target: btnBefore });
  dom.emitDoc('mousedown', { button: 0, clientX: 5, clientY: 5, detail: 2, target: btnBefore });
  const btnAfter = draw();
  btnBefore.isConnected = false;
  dom.emitDoc('pointerup', { button: 0, pointerId: 1, clientX: 5, clientY: 5, detail: 0, target: btnAfter });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(runCalls, 1, 'replayed second click of a double click must keep detail=2 and not start a second run');
});

test('Space held on Running… (aria-disabled) is not replayed onto Run it when the hook ends', async () => {
  const dom = makeDom();
  let runCalls = 0;
  let resolveRun!: (r: HookRunResult) => void;
  dom.handlers.hookRun = () => {
    runCalls++;
    return new Promise<HookRunResult>(resolve => { resolveRun = resolve; });
  };
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const { keepClicksAcrossRedraws } = await import('../src/dom.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  viewMod.resetHookSources();
  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home' } as any;
  keepClicksAcrossRedraws(() => 'instructions');

  const ref: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, command: 'echo hold', fingerprint: 'fp-hold' };
  const row = dom.makeNode('li');
  row.connected = true;
  row.append(...viewMod.hookSourceControls(ref, 'hook-source-instructions-claude-cli-0-0'));
  const runBtn = dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  runBtn.onclick({ detail: 1 });
  assert.equal(runCalls, 1);

  const runningBtn = dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  assert.equal(runningBtn.getAttribute('aria-disabled'), 'true');
  // Hold Space on Running… before the hook finishes.
  dom.emitDoc('keydown', { key: ' ', repeat: false, target: runningBtn });
  // Hook finishes: Run it returns under the same id with focus.
  resolveRun(baseResult({ outcome: 'adds', added: 'done' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  const idleBtn = dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  assert.notEqual(idleBtn, runningBtn);
  assert.equal((globalThis as any).document.activeElement, idleBtn);
  // Release Space on Run it: must NOT start a second run!
  dom.emitDoc('keyup', { key: ' ', target: idleBtn });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(runCalls, 1, 'Space press begun on aria-disabled Running… must not replay onto Run it');
});

test('Off-screen row does not scroll the page when its result arrives', async () => {
  const dom = makeDom();
  let resolveRun!: (r: HookRunResult) => void;
  dom.handlers.hookRun = () => new Promise<HookRunResult>(resolve => { resolveRun = resolve; });
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  viewMod.resetHookSources();
  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home' } as any;

  const ref: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, command: 'echo slow', fingerprint: 'fp-slow' };
  const scroller = dom.makeNode('div');
  scroller.className = 'scroll';
  scroller.rect = { top: 0, bottom: 500, left: 0, right: 800 };
  scroller.connected = true;
  const row = dom.makeNode('li');
  scroller.append(row);
  row.append(...viewMod.hookSourceControls(ref, 'hook-source-instructions-claude-cli-0-0'));
  const actions = row.children[0];
  const runBtn = dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  runBtn.onclick({ detail: 1 });
  // User scrolls away to another card so this row sits above the scroll viewport.
  actions.rect = { top: -180, bottom: -160, left: 0, right: 800 };
  resolveRun(baseResult({ outcome: 'adds', added: 'late offscreen' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(dom.scrolled.length, 0, 'off-screen row must not call scrollIntoView');
});

test('Refresh preserves same-home in-flight hook runs while IPC call rejection renders "Couldn’t run it."', async () => {
  const dom = makeDom();
  let resolveRun!: (r: HookRunResult) => void;
  let resolveRefresh!: (v: any) => void;
  dom.handlers.hookRun = () => new Promise<HookRunResult>(resolve => { resolveRun = resolve; });
  dom.handlers.refresh = () => new Promise<any>(resolve => { resolveRefresh = resolve; });
  await import('../src/settingspage.ts');
  const { readAgain, setRenderer, state } = await import('../src/app.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  setRenderer(() => {});
  viewMod.resetHookSources();
  state.home = {
    home: '/tmp/h', mode: 'actual', label: 'Home',
    presence: { tools: {} },
    sync: { managed: [], access: { allowed: true }, gate: { state: 'ok' } },
  } as any;

  const ref: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, command: 'echo race', fingerprint: 'fp-race' };
  const row = dom.makeNode('li');
  row.connected = true;
  row.append(...viewMod.hookSourceControls(ref, 'hook-source-instructions-claude-cli-0-0', true));
  dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });

  // Start Refresh on the same home; while api().refresh(true) is still in flight, the hook finishes and lands cleanly.
  const refreshing = readAgain();
  resolveRun(baseResult({ outcome: 'adds', added: 'arrived during refresh' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(dom.findAll(row, n => n.className === 'hook-run').length, 1, 'same-home in-flight hook survives Refresh');
  assert.match(dom.textOf(dom.findAll(row, n => n.className === 'hook-run')[0]), /arrived during refresh/);
  resolveRefresh(null);
  await refreshing;

  // IPC call rejection renders "Couldn't run it." (never View source's unreadable-file message).
  dom.handlers.hookRun = () => Promise.reject(new Error('ipc lost'));
  const errRow = dom.makeNode('li');
  errRow.connected = true;
  errRow.append(...viewMod.hookSourceControls(ref, 'hook-source-instructions-claude-cli-0-0'));
  dom.findAll(errRow, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const errPanel = dom.findAll(errRow, n => n.className === 'hook-run')[0];
  assert.equal(dom.textOf(errPanel), 'Couldn’t run it.');
});

// ---------- Short-list checks (1, 2, 3) ----------

test('Short list 1: commands that never started (missing and spawn-error) say Tried at <time> with no folder', () => {
  const time = '9:14 PM';
  const missing = hookRunWords('claude-cli', baseResult({ outcome: 'missing', program: '/no/such/bin' }), '~', time);
  assert.equal(missing.meta, 'Tried at 9:14 PM');
  assert.equal(missing.metaTitle, undefined);
  const missingCwd = hookRunWords('copilot-cli', baseResult({
    outcome: 'not-added', detail: 'spawn-error', problem: 'Working folder not found: /nope',
  }), '~/nope', time);
  assert.equal(missingCwd.meta, 'Tried at 9:14 PM');
  assert.equal(missingCwd.metaTitle, undefined);
});

test('Short list 2: Claude Code exit 2 with no stderr does not promise an error', () => {
  const time = '9:14 PM';
  const startQuiet = hookRunWords('claude-cli', baseResult({ outcome: 'claude-exit-2', exitCode: 2, stderr: '' }), '~', time);
  assert.equal(startQuiet.sentence, 'Exited 2: Claude Code would add nothing.');
  assert.equal(startQuiet.errDirect, undefined);
  const promptQuiet = hookRunWords('claude-cli', baseResult({ outcome: 'claude-exit-2', exitCode: 2, emptyPrompt: true, stderr: '' }), '~', time);
  assert.equal(promptQuiet.sentence, 'Exited 2: Claude Code would block the prompt.');
  assert.equal(promptQuiet.errDirect, undefined);
  const promptBlankErr = hookRunWords('claude-cli', baseResult({ outcome: 'claude-exit-2', exitCode: 2, emptyPrompt: true, stderr: ' \n' }), '~', time);
  assert.equal(promptBlankErr.sentence, 'Exited 2: Claude Code would block the prompt.');
  assert.equal(promptBlankErr.errDirect, undefined);
});

test('Short list 3: hookFingerprint sorts env keys by plain code-unit order (<), not locale', () => {
  const base = { declaredIn: '/tmp/h/.copilot/hooks/h.json', event: 'sessionStart', at: 0, launch: { shell: 'echo hi' } };
  const fpAB = hookFingerprint({ ...base, env: { a: '1', B: '2' } });
  const fpBA = hookFingerprint({ ...base, env: { B: '2', a: '1' } });
  assert.equal(fpAB, fpBA);
  assert.ok(fpAB.indexOf('"B"') >= 0 && fpAB.indexOf('"B"') < fpAB.indexOf('"a"'), `expected B before a in ${fpAB}`);
});

test('Installed plugin hook row renders Run it for Claude Code (with missingOptions note) and Codex (with trust note), and omits Run it for Copilot CLI', async () => {
  const dom = makeDom();
  let nextResult = baseResult({ outcome: 'adds', added: 'plugin text', allPrinted: 'plugin text', missingOptions: true });
  dom.handlers.hookRun = async () => nextResult;
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  viewMod.resetHookSources();
  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home' } as any;

  const claudeRef: HookSourceRef = { from: 'installed', tool: 'claude-cli', plugin: 'helper', marketName: 'team', declaredIn: '/tmp/h/.claude/plugins/cache/team/helper/1.0.0/hooks/hooks.json', event: 'SessionStart', at: 0, command: '${CLAUDE_PLUGIN_ROOT}/hooks/hello.sh', fingerprint: 'fp-1' };
  const codexRef: HookSourceRef = { from: 'installed', tool: 'codex-cli', plugin: 'helper', marketName: 'team', declaredIn: '/tmp/h/.codex/plugins/cache/team/helper/1.0.0/hooks/hooks.json', event: 'SessionStart', at: 0, command: '${PLUGIN_ROOT}/hooks/hello.sh', fingerprint: 'fp-2' };
  const copilotRef: HookSourceRef = { from: 'installed', tool: 'copilot-cli', plugin: 'helper', marketName: 'team', declaredIn: '/tmp/h/.copilot/plugins/cache/team/helper/1.0.0/hooks/hooks.json', event: 'sessionStart', at: 0, command: 'echo hi', fingerprint: 'fp-3' };

  const claudeRow = dom.makeNode('li');
  claudeRow.connected = true;
  claudeRow.append(...viewMod.hookSourceControls(claudeRef, 'hook-source-instructions-claude-cli-1-0'));
  const claudeBtn = dom.findAll(claudeRow, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  assert.ok(claudeBtn);
  claudeBtn.onclick({ detail: 1 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const claudePanelText = dom.textOf(dom.findAll(claudeRow, n => n.className === 'hook-run')[0]);
  assert.match(claudePanelText, /Would add/);
  assert.match(claudePanelText, /Ran without some of the plugin’s options\./);

  nextResult = baseResult({ outcome: 'adds', added: 'codex plugin text', allPrinted: 'codex plugin text' });
  const codexRow = dom.makeNode('li');
  codexRow.connected = true;
  codexRow.append(...viewMod.hookSourceControls(codexRef, 'hook-source-instructions-codex-cli-1-0'));
  const codexBtn = dom.findAll(codexRow, n => 'data-hook-run' in (n.attrs ?? {}))[0];
  assert.ok(codexBtn);
  assert.notEqual(claudeBtn.id, codexBtn.id, 'same plugin in two tools gets distinct button ids');
  codexBtn.onclick({ detail: 1 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const codexPanelText = dom.textOf(dom.findAll(codexRow, n => n.className === 'hook-run')[0]);
  assert.match(codexPanelText, /Codex adds it only once trusted in \/hooks\./);

  const copilotRow = dom.makeNode('li');
  copilotRow.connected = true;
  copilotRow.append(...viewMod.hookSourceControls(copilotRef, 'hook-source-instructions-copilot-cli-1-0'));
  assert.equal(dom.findAll(copilotRow, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
  assert.equal(dom.findAll(copilotRow, n => 'data-hook-source' in (n.attrs ?? {})).length, 1);
});

test('canRun hides Run it without the CLI, for off plugins, and for non-text hooks, while allowing app-carried binaries', async () => {
  makeDom();
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  const claudeRef: HookSourceRef = { from: 'installed', tool: 'claude-cli', plugin: 'helper', marketName: 'team', declaredIn: '/p/hooks.json', event: 'SessionStart', at: 0, command: 'echo hi', fingerprint: 'fp-1' };
  const nonTextEventRef: HookSourceRef = { ...claudeRef, event: 'PreToolUse' };
  const emptyCommandRef: HookSourceRef = { ...claudeRef, command: '' };
  const copilotPromptRef: HookSourceRef = { from: 'own', tool: 'copilot-cli', declaredIn: '/c/hooks.json', event: 'UserPromptSubmit', at: 0, command: 'echo hi', fingerprint: 'fp-2' };
  const snap = (harness: string, detection: string, binary?: string) => ({
    harness, harnessName: harness, surface: 'CLI', mode: 'actual', label: 'Home', root: '/tmp/h',
    detection, probe: { state: detection === 'Installed' ? 'ok' : 'missing', detail: '' },
    ...(binary ? { app: { name: 'App', carries: 'CLI', binary } } : {}), discovery: 'ready', skills: [], issues: [],
  });
  const install = (off?: boolean) => ({ tool: 'claude-cli', plugin: 'helper', marketName: 'team', items: [], listed: true, ...(off ? { off: true } : {}) });

  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home', snapshots: [snap('claude-cli', 'Config found but app not detected')], pluginItems: [install()] } as any;
  assert.equal(viewMod.canRun(claudeRef, 'actual', 'linux'), false, 'missing CLI hides Run it');

  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home', snapshots: [snap('claude-cli', 'App only')], pluginItems: [install()] } as any;
  assert.equal(viewMod.canRun(claudeRef, 'actual', 'linux'), false, 'app without binary hides Run it');

  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home', snapshots: [snap('claude-cli', 'App only', '/app/claude')], pluginItems: [install()] } as any;
  assert.equal(viewMod.canRun(claudeRef, 'actual', 'linux'), true, 'app carrying binary allows Run it');

  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home', snapshots: [snap('claude-cli', 'Installed'), snap('copilot-cli', 'Installed')], pluginItems: [install(true)] } as any;
  assert.equal(viewMod.canRun(claudeRef, 'actual', 'linux'), false, 'off plugin hides Run it');

  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home', snapshots: [snap('claude-cli', 'Installed'), snap('copilot-cli', 'Installed')], pluginItems: [install()] } as any;
  assert.equal(viewMod.canRun(nonTextEventRef, 'actual', 'linux'), false, 'non-text event hides Run it');
  assert.equal(viewMod.canRun(emptyCommandRef, 'actual', 'linux'), false, 'hook with no command hides Run it');
  assert.equal(viewMod.canRun(copilotPromptRef, 'actual', 'linux'), false, 'Copilot prompt hook hides Run it');
  assert.equal(viewMod.canRun(claudeRef, 'actual', 'linux'), true, 'installed on Claude Code text hook with CLI allows Run it');
});

test('hookCantRunReason only speaks when one known cause covers every text hook on the strip', async () => {
  makeDom();
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  const reason = viewMod.hookCantRunReason;
  assert.equal(typeof reason, 'function', 'hookCantRunReason exported beside canRun');
  const snap = (harness: string, detection: string) => ({
    harness, harnessName: harness, surface: 'CLI', mode: 'actual', label: 'Home', root: '/tmp/h',
    detection, probe: { state: detection === 'Installed' ? 'ok' : 'missing', detail: '' }, discovery: 'ready', skills: [], issues: [],
  });
  const textHook = { declaredIn: '/p/hooks.json', event: 'SessionStart', at: 0, launch: { shell: 'echo hi' } };
  const extraHook = { declaredIn: '/m/hooks.json', event: 'UserPromptSubmit', at: 1, launch: { shell: 'echo newer' } };
  const fpA = hookFingerprint(textHook);
  const fpB = hookFingerprint(extraHook);
  const claudeOn = { tool: 'claude-cli', plugin: 'helper', marketName: 'team', items: [], listed: true, hooks: [textHook] } as any;
  const claudeOff = { ...claudeOn, off: true };
  const claudeOffNoText = { ...claudeOn, off: true, hooks: [{ declaredIn: '/p/hooks.json', event: 'PreToolUse', at: 0, launch: { shell: 'echo chk' } }] };
  const claudeBroken = { ...claudeOn, problem: 'Its files couldn’t be read.', hooks: undefined };
  const codexOn = { tool: 'codex-cli', plugin: 'helper', marketName: 'team', items: [], listed: true, hooks: [textHook] } as any;
  const codexOff = { ...codexOn, off: true };
  const copilotOn = { tool: 'copilot-cli', plugin: 'helper', marketName: 'team', items: [], listed: true, hooks: [{ ...textHook, event: 'sessionStart' }] } as any;

  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home', snapshots: [snap('claude-cli', 'Installed'), snap('codex-cli', 'Installed')] } as any;
  assert.equal(reason({ inAnyTool: false, installs: [], fingerprints: [fpA] }, 'actual', 'linux'), 'Not installed, so these can’t be run here.');
  assert.equal(reason({ inAnyTool: true, installs: [], fingerprints: [fpA] }, 'actual', 'linux'), undefined, 'installed in a tool like Pi never says Not installed');
  assert.equal(reason({ inAnyTool: true, installs: [claudeBroken], fingerprints: [fpA] }, 'actual', 'linux'), undefined, 'unreadable copy says nothing');
  assert.equal(reason({ inAnyTool: true, installs: [claudeOff], fingerprints: [fpA] }, 'actual', 'linux'), 'Off in Claude Code, so these can’t be run here.');
  assert.equal(reason({ inAnyTool: true, installs: [claudeOff, codexOff], fingerprints: [fpA] }, 'actual', 'linux'), 'Off in Claude Code and Codex, so these can’t be run here.');
  assert.equal(reason({ inAnyTool: true, installs: [claudeOffNoText], fingerprints: [fpA] }, 'actual', 'linux'), undefined, 'off copy with no text hooks says nothing');
  assert.equal(reason({ inAnyTool: true, installs: [claudeOff], fingerprints: [fpA, fpB] }, 'actual', 'linux'), undefined, 'marketplace-only text hook not covered by off copy says nothing');
  assert.equal(reason({ inAnyTool: true, installs: [copilotOn], fingerprints: [fpA] }, 'actual', 'linux'), undefined, 'nothing for Copilot CLI');
  assert.equal(reason('claude-cli', 'actual', 'linux'), undefined, 'installed CLI returns undefined');

  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home', snapshots: [snap('claude-cli', 'Installed'), snap('codex-cli', 'Config found but app not detected')] } as any;
  assert.equal(reason({ inAnyTool: true, installs: [claudeOff, codexOn], fingerprints: [fpA] }, 'actual', 'linux'), undefined, 'mixed off in Claude + missing Codex CLI says nothing');
  assert.equal(reason({ inAnyTool: true, installs: [codexOn], fingerprints: [fpA] }, 'actual', 'linux'), 'Codex’s command line isn’t on this computer, so these can’t be run here.');
  assert.equal(reason({ inAnyTool: true, installs: [codexOn], fingerprints: [fpA, fpB] }, 'actual', 'linux'), undefined, 'older Codex copy missing newer marketplace hook says nothing');
  assert.equal(reason('codex-cli', 'actual', 'linux'), 'Codex’s command line isn’t on this computer, so these can’t be run here.');
  assert.equal(reason('copilot-cli', 'actual', 'linux'), undefined, 'nothing for Copilot CLI');
  assert.equal(reason({ inAnyTool: false, installs: [], fingerprints: [fpA] }, 'custom', 'linux'), undefined, 'nothing for another home');
  assert.equal(reason({ inAnyTool: false, installs: [], fingerprints: [fpA] }, 'fixture', 'linux'), undefined, 'nothing for Practice copy');
  assert.equal(reason({ inAnyTool: false, installs: [], fingerprints: [fpA] }, 'actual', 'win32'), undefined, 'nothing for Windows');

  // stripCantRunReason shares hookGate with canRun (chosen folder and Copilot CLI plugin hooks on Mac/Linux).
  const ownRef: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/p/s.json', event: 'SessionStart', at: 0, command: 'echo x', fingerprint: fpA };
  const copPluginRef: HookSourceRef = { from: 'installed', tool: 'copilot-cli', plugin: 'helper', marketName: 'team', declaredIn: '/p/h.json', event: 'sessionStart', at: 0, command: 'echo x', fingerprint: fpA };
  assert.equal(viewMod.stripCantRunReason([ownRef], 'actual', 'linux'), undefined);
  assert.equal(viewMod.stripCantRunReason([ownRef], 'custom', 'linux'), HOOK_RUN_ACTUAL_CARD);
  assert.equal(viewMod.stripCantRunReason([ownRef], 'fixture', 'linux'), HOOK_RUN_ACTUAL_CARD);
  assert.equal(viewMod.stripCantRunReason([copPluginRef], 'actual', 'linux'), HOOK_RUN_COPILOT_PLUGIN);
  assert.equal(viewMod.stripCantRunReason([ownRef, copPluginRef], 'actual', 'linux'), HOOK_RUN_COPILOT_PLUGIN);
  assert.equal(viewMod.stripCantRunReason([copPluginRef], 'custom', 'linux'), HOOK_RUN_ACTUAL_CARD);
  assert.equal(viewMod.stripCantRunReason([copPluginRef], 'actual', 'win32'), undefined);
  assert.equal(viewMod.stripCantRunReason([ownRef], 'custom', 'win32'), undefined);
  assert.equal(viewMod.stripCantRunReason([], 'custom', 'linux'), undefined);
});

test('Plugin page runs installed hooks, keeps marketplace-only text hooks View source alone, explains why Run it is absent, and puts plugin sentence behind (?)', async t => {
  const dom = makeDom();
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const { market } = await import('../src/pluginstate.ts');
  const { pluginPage } = await import('../src/pluginpage.ts');
  const { instructionCard } = await import('../src/instructionspage.ts');
  const { resetHookSources } = await import('../src/hooksourceview.ts');
  resetHookSources();

  const claudeHook = { declaredIn: '/tmp/h/.claude/plugins/cache/team/helper/0.4.0/hooks/hooks.json', event: 'SessionStart', at: 0, launch: { shell: 'echo claude-installed' } };
  const codexHook = { declaredIn: '/tmp/h/.codex/plugins/cache/team/helper/0.5.0/hooks/hooks.json', event: 'SessionStart', at: 0, launch: { shell: 'echo codex-installed' } };
  const marketSameAsClaude = { declaredIn: '/markets/team/plugins/helper/hooks/hooks.json', event: 'SessionStart', at: 0, launch: { shell: 'echo claude-installed' } };
  const marketOnlyHook = { declaredIn: '/markets/team/plugins/helper/hooks/hooks.json', event: 'UserPromptSubmit', at: 1, launch: { shell: 'echo market-only' } };
  const otherHook = { declaredIn: '/markets/team/plugins/helper/hooks/hooks.json', event: 'PreToolUse', at: 0, launch: { shell: 'echo checked' } };
  const snap = (harness: string, detection = 'Installed') => ({
    harness, harnessName: harness, surface: 'CLI', mode: 'actual', label: 'Home', root: '/tmp/h',
    detection, probe: { state: detection === 'Installed' ? 'ok' : 'missing', detail: '' }, discovery: 'ready', skills: [], issues: [],
  });
  state.home = {
    home: '/tmp/h', mode: 'actual', label: 'Home',
    snapshots: [snap('claude-cli'), snap('codex-cli'), snap('copilot-cli')],
    sync: { managed: ['claude-cli', 'codex-cli', 'copilot-cli'], writes: {}, access: { allowed: true, reason: '' } },
    skills: { tools: [], items: [], found: [], issues: [] },
    mcp: { tools: [], items: [], found: [], issues: [] },
    agents: { tools: [], items: [], found: [], issues: [] },
    pluginItems: [
      { tool: 'claude-cli', plugin: 'helper', marketName: 'team', version: '0.4.0', items: [], listed: true, source: '/markets/team', hooks: [claudeHook] },
      { tool: 'codex-cli', plugin: 'helper', marketName: 'team', version: '0.5.0', items: [], listed: true, source: '/markets/team', hooks: [codexHook] },
      { tool: 'copilot-cli', plugin: 'copilot-only', marketName: 'team', version: '1.0.0', items: [], listed: true, source: '/markets/team', hooks: [{ declaredIn: '/c/hooks.json', event: 'sessionStart', at: 0, launch: { shell: 'echo cop' } }] },
      { tool: 'claude-cli', plugin: 'off-one', marketName: 'team', version: '1.0.0', off: true, items: [], listed: true, source: '/markets/team', hooks: [claudeHook] },
      { tool: 'claude-cli', plugin: 'off-no-text', marketName: 'team', version: '0.4.0', off: true, items: [], listed: true, source: '/markets/team', hooks: [otherHook] },
      { tool: 'claude-cli', plugin: 'broken-one', marketName: 'team', version: '1.0.0', problem: 'Its files couldn’t be read.', items: [], listed: true, source: '/markets/team' },
    ],
  } as any;
  const view: any = {
    home: '/tmp/h', tools: ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'], clis: { 'claude-cli': true, 'copilot-cli': true, 'codex-cli': true },
    canWrite: true, marketplaces: [],
  };
  const makeEntry = (states: any, pluginName = 'helper', extra: any = {}): any => ({
    source: '/markets/team', origins: ['central-knot'], name: 'team', kind: 'folder', sourceLabel: 'Folder: team',
    plugins: [{ name: pluginName, version: '0.5.0', description: 'Helper', folder: `plugins/${pluginName}` }],
    states, ...extra,
  });
  const detail: any = {
    skills: [], commands: [], agents: [], instructions: [], onlyInstructions: false,
    hooks: [marketSameAsClaude, marketOnlyHook, otherHook],
    hooksByTool: { 'claude-cli': [marketSameAsClaude, marketOnlyHook, otherHook], 'codex-cli': [marketSameAsClaude, marketOnlyHook, otherHook] },
    mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false, version: '0.5.0', offered: true,
  };
  const singleHookDetail: any = { ...detail, hooks: [marketSameAsClaude], hooksByTool: { 'claude-cli': [marketSameAsClaude], 'codex-cli': [marketSameAsClaude] } };
  market.details.set('/markets/team\u0000helper', { reading: false, value: detail });
  market.details.set('/markets/team\u0000off-one', { reading: false, value: singleHookDetail });
  market.details.set('/markets/team\u0000off-no-text', { reading: false, value: singleHookDetail });
  market.details.set('/markets/team\u0000broken-one', { reading: false, value: singleHookDetail });
  market.details.set('/markets/team\u0000copilot-only', { reading: false, value: detail });

  // Arriving from Codex selects Codex, shows Codex hook, trust note, single standing warning, new copy-note wording, As <tool>, and marketplace-only text hooks below.
  market.nav = { source: '/markets/team', tab: 'plugins', plugin: 'helper', find: '', category: undefined, hookTool: 'codex-cli' } as any;
  const entry = makeEntry({
    helper: {
      'claude-cli': { state: 'installed', version: '0.4.0', path: '/tmp/h/.claude/plugins/cache/team/helper/0.4.0' },
      'codex-cli': { state: 'installed', version: '0.5.0', path: '/tmp/h/.codex/plugins/cache/team/helper/0.5.0' },
    },
  });
  const codexPage = pluginPage(view, entry, 0, entry.plugins[0]);
  const codexText = dom.textOf(codexPage);
  const codexWarn = dom.textOf(dom.findAll(codexPage, n => n.className === 'session-run-warn')[0]);
  assert.ok(codexWarn !== HOOK_RUN_WARN && codexWarn.includes('Codex’s /hooks command'));
  assert.equal(dom.findAll(codexPage, n => n.className === 'session-note').length, 0);
  assert.match(codexText, /echo codex-installed/);
  assert.match(codexText, /echo market-only/, 'marketplace-only text hook stays listed with View source');
  assert.match(codexText, /marketplace only/, 'same version as marketplace tags row as marketplace only');
  assert.match(codexText, /Runs Codex’s installed copy \(0\.5\.0\)\. Claude Code has\u00a00\.4\.0\./);
  const select = dom.findAll(codexPage, n => n.tag === 'select')[0];
  assert.ok(select, 'As <tool> selector shown when multiple eligible tools exist');
  assert.deepEqual(select.children.map((o: any) => dom.textOf(o)), ['As Claude Code', 'As Codex']);
  assert.equal(dom.findAll(codexPage, n => 'data-hook-run' in (n.attrs ?? {})).length, 1, 'Run it on installed text hook only, not on marketplace-only or Other hooks');
  const helpCard = dom.findAll(codexPage, n => n.id === 'plugin-hooks-info-card')[0];
  assert.equal(dom.textOf(helpCard), hookStripHelp('codex-cli', true));

  // Without an arriving tool, selects Claude Code: matching marketplace hook is not duplicated, while marketplace-only prompt hook appears under it with View source alone.
  market.nav = { source: '/markets/team', tab: 'plugins', plugin: 'helper', find: '', category: undefined } as any;
  const claudePage = pluginPage(view, entry, 0, entry.plugins[0]);
  const claudeStrip = dom.findAll(claudePage, n => n.id === 'plugin-session-hooks')[0];
  const claudeRows = dom.findAll(claudeStrip, n => n.className === 'session-hook');
  assert.equal(claudeRows.length, 2, 'installed row + marketplace-only prompt row (no duplicate of matching SessionStart)');
  assert.match(dom.textOf(claudeStrip), /Hooks that can add text \(2\)/);
  assert.equal(dom.findAll(claudeRows[0], n => 'data-hook-run' in (n.attrs ?? {})).length, 1);
  assert.equal(dom.findAll(claudeRows[1], n => 'data-hook-run' in (n.attrs ?? {})).length, 0, 'marketplace-only row keeps View source alone');
  assert.equal(dom.findAll(claudeRows[1], n => 'data-hook-source' in (n.attrs ?? {})).length, 1);
  assert.match(dom.textOf(claudeRows[1]), /echo market-only/);
  assert.match(dom.textOf(claudeRows[1]), /0\.5\.0 only/, 'marketplace-only row carries version tag after its command');
  assert.match(dom.textOf(claudePage), /Runs Claude Code’s installed copy \(0\.4\.0\)\. The marketplace has 0\.5\.0\./);
  assert.doesNotMatch(dom.textOf(claudePage), /\/hooks command/);

  // Not installed, off covering all hooks, and single missing CLI each explain why; off-without-text, unreadable, Pi-items, and mixed causes omit the reason line.
  const marketOnlyPage = pluginPage(view, makeEntry({ helper: {} }), 0, entry.plugins[0]);
  assert.equal(dom.findAll(marketOnlyPage, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
  assert.equal(dom.findAll(marketOnlyPage, n => n.className === 'session-run-warn').length, 0);
  assert.match(dom.textOf(marketOnlyPage), /Not installed, so these can’t be run here\./);
  assert.doesNotMatch(dom.textOf(marketOnlyPage), /known only when they run/);

  const piOnlyEntry = makeEntry({ helper: {} }, 'helper', { items: { helper: { on: { 'pi-cli': 1 }, of: { 'pi-cli': 1 }, lines: [] } } });
  const piOnlyPage = pluginPage(view, piOnlyEntry, 0, piOnlyEntry.plugins[0]);
  assert.doesNotMatch(dom.textOf(piOnlyPage), /Not installed, so these can’t be run here\./);
  assert.match(dom.textOf(piOnlyPage), /known only when they run/);

  const brokenEntry = makeEntry({ 'broken-one': { 'claude-cli': { state: 'installed', version: '1.0.0', path: '/gone' } } }, 'broken-one');
  const brokenPage = pluginPage(view, brokenEntry, 0, brokenEntry.plugins[0]);
  assert.doesNotMatch(dom.textOf(brokenPage), /so these can’t be run here/);
  assert.match(dom.textOf(brokenPage), /known only when they run/);

  const notKnownEntry = makeEntry({ helper: { 'claude-cli': { state: 'not-known', reason: 'Unreadable' } } });
  const notKnownPage = pluginPage(view, notKnownEntry, 0, notKnownEntry.plugins[0]);
  assert.doesNotMatch(dom.textOf(notKnownPage), /so these can’t be run here/);

  const offNoTextEntry = makeEntry({ 'off-no-text': { 'claude-cli': { state: 'installed', version: '0.4.0', path: '/p', off: true } } }, 'off-no-text');
  const offNoTextPage = pluginPage(view, offNoTextEntry, 0, offNoTextEntry.plugins[0]);
  assert.doesNotMatch(dom.textOf(offNoTextPage), /Off in Claude Code/);
  assert.match(dom.textOf(offNoTextPage), /known only when they run/);

  const offEntry = makeEntry({ 'off-one': { 'claude-cli': { state: 'installed', version: '1.0.0', path: '/p', off: true } } }, 'off-one');
  const offPage = pluginPage(view, offEntry, 0, offEntry.plugins[0]);
  assert.equal(dom.findAll(offPage, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
  assert.match(dom.textOf(offPage), /Off in Claude Code, so these can’t be run here\./);
  assert.doesNotMatch(dom.textOf(offPage), /known only when they run/);

  // Copilot-only and non-actual home keep View source alone without the 3-case reason line.
  const copEntry = makeEntry({ 'copilot-only': { 'copilot-cli': { state: 'installed', version: '1.0.0', path: '/c' } } }, 'copilot-only');
  const copPage = pluginPage(view, copEntry, 0, copEntry.plugins[0]);
  assert.equal(dom.findAll(copPage, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
  assert.doesNotMatch(dom.textOf(copPage), /so these can’t be run here/);

  state.home!.mode = 'custom';
  const customPage = pluginPage(view, entry, 0, entry.plugins[0]);
  assert.equal(dom.findAll(customPage, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
  assert.doesNotMatch(dom.textOf(customPage), /so these can’t be run here/);
  state.home!.mode = 'actual';

  // Missing CLI explains why when it covers all text hooks (plugin page & Instructions strip), and says nothing when mixed with another tool or marketplace-only hooks.
  const prevSnaps = state.home!.snapshots;
  state.home!.snapshots = [snap('claude-cli', 'Config found but app not detected'), snap('codex-cli', 'Installed'), snap('copilot-cli')] as any;
  const singleClaudeEntry = makeEntry({ helper: { 'claude-cli': { state: 'installed', version: '0.4.0', path: '/p' } } });
  market.details.set('/markets/team\u0000helper', { reading: false, value: singleHookDetail });
  const noCliPluginPage = pluginPage(view, singleClaudeEntry, 0, singleClaudeEntry.plugins[0]);
  assert.equal(dom.findAll(noCliPluginPage, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
  assert.match(dom.textOf(noCliPluginPage), /Claude Code’s command line isn’t on this computer, so these can’t be run here\./);
  market.details.set('/markets/team\u0000helper', { reading: false, value: detail });
  const mixedNoCliPage = pluginPage(view, singleClaudeEntry, 0, singleClaudeEntry.plugins[0]);
  assert.doesNotMatch(dom.textOf(mixedNoCliPage), /so these can’t be run here/, 'marketplace-only hook not in Claude copy suppresses CLI reason');

  const noCliInsCard = instructionCard({
    tool: 'claude-cli', path: '/tmp/h/.claude/CLAUDE.md', exists: true, text: '# Hi', hash: 'h1',
    readers: 'Claude Code', notes: [], versions: [],
    ownHooks: [{ declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, launch: { shell: 'echo mine' } }],
  } as any);
  assert.equal(dom.findAll(noCliInsCard, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
  assert.equal(dom.findAll(noCliInsCard, n => n.className === 'session-run-warn').length, 0);
  assert.match(dom.textOf(noCliInsCard), /Claude Code’s command line isn’t on this computer, so these can’t be run here\./);
  state.home!.snapshots = prevSnaps;

  // Instructions strip with a runnable plugin hook shows only HOOK_RUN_WARN standing, with plugin sentence in (?).
  const ownClaude = [{ declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, launch: { shell: 'echo mine' } }];
  const mkFile = (tool: string, ownHooks?: any[]) => ({ tool, path: `/tmp/h/${tool}.md`, exists: true, text: '# Hi', hash: tool, readers: tool, notes: [], versions: [], ...(ownHooks ? { ownHooks } : {}) }) as any;
  const withPluginCard = instructionCard(mkFile('claude-cli', ownClaude));
  assert.equal(dom.textOf(dom.findAll(withPluginCard, n => n.className === 'session-run-warn')[0]), HOOK_RUN_WARN);
  assert.match(dom.textOf(dom.findAll(withPluginCard, n => n.attrs?.role === 'tooltip')[0]), /plugin hooks can change installed files\./);

  await t.test('item 2 & 3: Copilot card order/words, runnable Codex gets (?), chosen folder starts with reason, one (?) per strip', () => {
    const info = { marked: false, anyRunnable: true };
    const [claude, copilot, codex] = [mkFile('claude-cli', ownClaude), mkFile('copilot-cli'), mkFile('codex-cli')].map(f => instructionCard(f, { hookInfo: info }));
    assert.deepEqual([claude, copilot, codex].map(c => dom.findAll(c, n => n.className.includes('info-mark')).map(n => n.id)),
      [['session-hooks-info'], ['session-hooks-info-copilot-cli'], ['session-hooks-info-codex-cli']]);
    assert.equal(dom.findAll(copilot, n => n.className.includes('session-note')).length, 0);
    const copTip = dom.textOf(dom.findAll(copilot, n => n.id === 'session-hooks-info-copilot-cli-card')[0]);
    assert.match(copTip, /^Central Knot can’t run a Copilot CLI plugin’s hook, but View source shows its script\. .*ignores what prompt hooks print\.$/);
    assert.doesNotMatch(dom.textOf(dom.findAll(claude, n => n.id === 'session-hooks-info-card')[0]), /this computer’s home/);
    assert.equal(dom.textOf(dom.findAll(codex, n => n.id === 'session-hooks-info-codex-cli-card')[0]), 'Codex runs a hook only after you trust it in its /hooks command.');
    assert.equal(dom.findAll(codex, n => n.className.includes('session-note')).length, 0);
    // Tool's own Instructions tab (first strip with a tool note) stays one mark with both in its card.
    const copTab = instructionCard(mkFile('copilot-cli'));
    assert.deepEqual(dom.findAll(copTab, n => n.className.includes('info-mark')).map(n => n.id), ['session-hooks-info']);
    state.home!.mode = 'custom';
    const folderCard = instructionCard(mkFile('claude-cli', ownClaude), { hookInfo: { marked: false, anyRunnable: false } });
    assert.equal(dom.findAll(folderCard, n => 'data-hook-run' in (n.attrs ?? {})).length, 0);
    assert.match(dom.textOf(dom.findAll(folderCard, n => n.id === 'session-hooks-info-card')[0]), /^“See what it adds” works only on this computer’s home\. This lists /);
    state.home!.mode = 'actual';
  });
});

test('hookRunWords labels tool and live plugin version truthfully, and script-only hook source shows raw event', async () => {
  const time = '9:14 PM';
  const withVer = baseResult({ outcome: 'adds', added: 'hello', allPrinted: 'hello', pluginVersion: '0.4.1' });
  const noVer = baseResult({ outcome: 'adds', added: 'hello', allPrinted: 'hello' });
  const blankVer = baseResult({ outcome: 'adds', added: 'hello', allPrinted: 'hello', pluginVersion: '  ' });
  const missing = baseResult({ outcome: 'missing', program: '/no/bin', pluginVersion: '0.4.1' });
  assert.deepEqual([hookRunWords('claude-cli', withVer, '~', time, 'claude-cli').meta, hookRunWords('claude-cli', withVer, '~', time, 'claude-cli').metaTitle], ['Collected at 9:14 PM', 'as Claude Code, plugin 0.4.1, run in ~']);
  assert.equal(hookRunWords('claude-cli', noVer, '~', time, 'claude-cli').metaTitle, 'as Claude Code, run in ~');
  assert.equal(hookRunWords('claude-cli', blankVer, '~', time, 'claude-cli').metaTitle, 'as Claude Code, run in ~');
  assert.equal(hookRunWords('claude-cli', withVer, '~', time).metaTitle, 'run in ~');
  assert.deepEqual([hookRunWords('claude-cli', missing, '~', time, 'claude-cli').meta, hookRunWords('claude-cli', missing, '~', time, 'claude-cli').metaTitle], ['Tried at 9:14 PM', 'as Claude Code, plugin 0.4.1']);

  const dom = makeDom();
  dom.handlers.hookRun = async () => baseResult({ outcome: 'adds', added: 'hello', allPrinted: 'hello', pluginVersion: '0.5.0' });
  dom.handlers.hookSource = async () => ({ script: { path: '/tmp/h/.claude/plugins/cache/team/helper/0.5.0/hooks/hello.sh', text: '#!/bin/sh\necho hi\n' } });
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  viewMod.resetHookSources();
  // Page still holds stale 0.4.1 in pluginItems; live hookRun result carries 0.5.0 installed at click.
  state.home = {
    home: '/home/u', mode: 'actual', label: 'Home',
    pluginItems: [
      { tool: 'claude-cli', plugin: 'helper', marketName: 'team', version: '0.4.1', items: [], listed: true },
      { tool: 'codex-cli', plugin: 'no-ver', marketName: 'team', items: [], listed: true },
    ],
  } as any;
  const withVerRef: HookSourceRef = { from: 'installed', tool: 'claude-cli', plugin: 'helper', marketName: 'team', declaredIn: '/tmp/h/.claude/plugins/cache/team/helper/0.4.1/hooks/hooks.json', event: 'SessionStart', at: 0, command: 'echo hi', fingerprint: 'fp-v1' };
  const noVerRef: HookSourceRef = { from: 'installed', tool: 'codex-cli', plugin: 'no-ver', marketName: 'team', declaredIn: '/tmp/h/.codex/plugins/cache/team/no-ver/local/hooks/hooks.json', event: 'UserPromptSubmit', at: 0, command: 'echo hi', fingerprint: 'fp-v2' };

  const row1 = dom.makeNode('li');
  row1.connected = true;
  row1.append(...viewMod.hookSourceControls(withVerRef, 'hook-source-plugin-claude-0'));
  dom.findAll(row1, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  dom.findAll(row1, n => 'data-hook-source' in (n.attrs ?? {}))[0].onclick();
  await new Promise(resolve => setTimeout(resolve, 10));
  const panel1 = dom.findAll(row1, n => n.className === 'hook-run')[0];
  assert.match(dom.textOf(panel1), /^Would add Collected .+ at /);
  assert.equal(dom.findAll(panel1, n => n.className === 'hook-run-meta')[0]?.getAttribute('title'), 'as Claude Code, plugin 0.5.0, run in ~');
  assert.match(dom.textOf(dom.findAll(row1, n => n.className === 'hook-source')[0]), /hello\.sh · SessionStart/);

  dom.handlers.hookRun = async () => noVer;
  const row2 = dom.makeNode('li');
  row2.connected = true;
  row2.append(...viewMod.hookSourceControls(noVerRef, 'hook-source-plugin-codex-0'));
  dom.findAll(row2, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const panel2 = dom.findAll(row2, n => n.className === 'hook-run')[0];
  const row2Title = dom.findAll(panel2, n => n.className === 'hook-run-meta')[0]?.getAttribute('title') ?? '';
  assert.match(dom.textOf(panel2), /^Would add Collected .+ at /);
  assert.equal(row2Title, 'as Codex, run in ~');
  assert.doesNotMatch(row2Title, /plugin|undefined|unknown/);
});

test('runHook reports live installed pluginVersion at click time rather than stale state', { skip: unixSkip }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ck-hook-ver-'));
  try {
    const home = join(root, 'home');
    const tools = join(root, 'tools');
    const dataDir = join(root, 'data');
    await mkdir(join(tools, '.local/bin'), { recursive: true });
    await standIn(join(tools, '.local/bin/claude'), '#!/bin/sh\necho "2.1.327 (Claude Code)"\n', 'console.log("2.1.327");');
    const copy = join(home, '.claude/plugins/cache/team/helper/0.5.0');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'helper', version: '0.5.0' }));
    await put(join(copy, 'hooks/hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo live-ok' }] }] } }));
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'helper@team': [{ scope: 'user', installPath: copy, version: '0.5.0' }] } }));
    await put(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'helper@team': true } }));
    const declaredIn = join(copy, 'hooks/hooks.json');
    const hook = { declaredIn, event: 'SessionStart', matcher: 'startup', at: 0, launch: { shell: 'echo live-ok' } };
    const ctx: HookRunContext = {
      home, toolsHome: tools, mode: 'actual', dataDir,
      searchPath: '/usr/bin:/bin',
      env: { PATH: '/usr/bin:/bin', HOME: home, CK_TEST_HOME_ONLY: 'claude' },
    };
    const res = await runHook(ctx, { from: 'installed', tool: 'claude-cli', plugin: 'helper', marketName: 'team', declaredIn, event: 'SessionStart', at: 0, command: 'echo live-ok', fingerprint: hookFingerprint(hook) });
    assert.equal(res.outcome, 'adds');
    assert.equal(res.pluginVersion, '0.5.0');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('View-only and Other hooks on plugin page use one plain heading, plain event labels with raw event in title, and visible missing-CLI styling', async () => {
  const dom = makeDom();
  await import('../src/settingspage.ts');
  const { state } = await import('../src/app.ts');
  const { market } = await import('../src/pluginstate.ts');
  const { pluginPage } = await import('../src/pluginpage.ts');
  const { instructionCard } = await import('../src/instructionspage.ts');
  const { resetHookSources } = await import('../src/hooksourceview.ts');
  resetHookSources();

  const textHook = { declaredIn: '/m/hooks.json', event: 'SessionStart', at: 0, launch: { shell: 'echo start' } };
  const otherHook = { declaredIn: '/m/hooks.json', event: 'PreToolUse', at: 0, launch: { shell: 'echo check' } };
  const snap = (harness: string, detection: string) => ({
    harness, harnessName: harness, surface: 'CLI', mode: 'actual', label: 'Home', root: '/tmp/h',
    detection, probe: { state: detection === 'Installed' ? 'ok' : 'missing', detail: '' }, discovery: 'ready', skills: [], issues: [],
  });
  state.home = {
    home: '/tmp/h', mode: 'actual', label: 'Home',
    snapshots: [snap('claude-cli', 'Config found but app not detected')],
    sync: { managed: ['claude-cli'], writes: {}, access: { allowed: true, reason: '' } },
    skills: { tools: [], items: [], found: [], issues: [] },
    mcp: { tools: [], items: [], found: [], issues: [] },
    agents: { tools: [], items: [], found: [], issues: [] },
    pluginItems: [{ tool: 'claude-cli', plugin: 'helper', marketName: 'team', version: '0.4.0', items: [], listed: true, source: '/m', hooks: [textHook] }],
  } as any;
  const view: any = { home: '/tmp/h', tools: ['claude-cli'], clis: {}, canWrite: true, marketplaces: [] };
  const entry: any = {
    source: '/m', origins: ['central-knot'], name: 'team', kind: 'folder', sourceLabel: 'Folder: team',
    plugins: [{ name: 'helper', version: '0.4.0', description: 'Helper', folder: 'plugins/helper' }],
    states: { helper: { 'claude-cli': { state: 'installed', version: '0.4.0', path: '/p' } } },
  };
  market.details.set('/m\u0000helper', {
    reading: false,
    value: {
      skills: [], commands: [], agents: [], instructions: [], onlyInstructions: false,
      hooks: [textHook, otherHook], hooksByTool: { 'claude-cli': [textHook, otherHook] },
      mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false, version: '0.4.0', offered: true,
    },
  });

  const page = pluginPage(view, entry, 0, entry.plugins[0]);
  const h4s = dom.findAll(page, n => n.tag === 'h4').map(n => dom.textOf(n));
  assert.ok(h4s.includes('Hooks that can add text (1)'), `expected unified heading, got ${h4s}`);
  assert.equal(h4s.some(h => h.includes('to sessions')), false, 'must not split heading into "to sessions"');
  const events = dom.findAll(page, n => n.className.includes('plugin-hook-event')).map(n => [dom.textOf(n), n.attrs.title]);
  assert.deepEqual(events, [['When a session starts', 'SessionStart'], ['Before a tool runs', 'PreToolUse']]);
  const cantRunPlugin = dom.findAll(page, n => n.className.includes('session-cant-run'));
  assert.equal(cantRunPlugin.length, 1);
  assert.match(dom.textOf(cantRunPlugin[0]), /Claude Code’s command line isn’t on this computer/);

  const insCard = instructionCard({
    tool: 'claude-cli', path: '/tmp/h/.claude/CLAUDE.md', exists: true, text: '# Hi', hash: 'h1',
    readers: 'Claude Code', notes: [], versions: [],
    ownHooks: [{ declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, launch: { shell: 'echo mine' } }],
  } as any);
  const cantRunIns = dom.findAll(insCard, n => n.className.includes('session-cant-run'));
  assert.equal(cantRunIns.length, 1);
  assert.match(dom.textOf(cantRunIns[0]), /Claude Code’s command line isn’t on this computer/);
});

test('hookRunWords leads with Collected/Tried day-and-time, puts tool/place on hover, and chosen-folder card quotes See what it adds', () => {
  const nowIso = new Date().toISOString();
  const addsNow = hookRunWords('claude-cli', baseResult({ outcome: 'adds', added: 'hi', allPrinted: 'hi', at: nowIso, pluginVersion: '0.4.1' }), '~', undefined, 'claude-cli');
  assert.match(addsNow.meta ?? '', /^Collected today at /);
  assert.equal(addsNow.metaTitle, 'as Claude Code, plugin 0.4.1, run in ~');
  const missingNow = hookRunWords('claude-cli', baseResult({ outcome: 'missing', program: '/nope', at: nowIso }), '~', undefined, 'claude-cli');
  assert.match(missingNow.meta ?? '', /^Tried today at /);
  assert.equal(missingNow.metaTitle, 'as Claude Code');
  assert.equal(HOOK_RUN_ACTUAL_CARD, '“See what it adds” works only on this computer’s home.');
  assert.equal(HOOK_RUN_ACTUAL_ONLY, 'See what it adds works only on this computer’s home.');
});

test('Kept results in hooksourceview: remember flag, single batch across harness switch, Stop+leave restore, Forget result vs Close result, Escape, and 6-line fold on return', async t => {
  const dom = makeDom();
  const runCalls: unknown[] = [];
  const forgetCalls: HookSourceRef[] = [];
  let nextResult: HookRunResult = baseResult({ outcome: 'adds', added: 'kept output', allPrinted: 'kept output' });
  let resolveLast!: (r: (HookRunResult | null)[]) => void;
  dom.handlers.hookRun = async (_h: string, _r: HookSourceRef, remember?: boolean) => { runCalls.push(remember); return nextResult; };
  dom.handlers.hookForget = (_h: string, ref: HookSourceRef) => { forgetCalls.push(ref); };
  dom.handlers.hookLast = () => new Promise<(HookRunResult | null)[]>(resolve => { resolveLast = resolve; });

  await import('../src/settingspage.ts');
  const { state, setRenderer } = await import('../src/app.ts');
  const viewMod = await import('../src/hooksourceview.ts');
  setRenderer(() => {});
  viewMod.resetHookSources();
  state.page = 'harnesses';
  state.harness = 'claude-cli';
  state.harnessTab = 'instructions';
  state.home = { home: '/tmp/h', mode: 'actual', label: 'Home' } as any;

  const fileFor = (tool: 'claude-cli' | 'codex-cli', settings: string, cmd: string) => ({
    tool, path: `/tmp/h/${tool}.md`, exists: true, text: '# Hi', hash: tool, readers: tool, notes: [], versions: [],
    ownHooks: [{ declaredIn: settings, event: 'SessionStart', at: 0, launch: { shell: cmd } }],
  }) as any;
  const claudeFile = fileFor('claude-cli', '/tmp/h/.claude/settings.json', 'echo c');
  const codexFile = fileFor('codex-cli', '/tmp/h/.codex/config.toml', 'echo x');
  const claudeRef = sessionStrip('claude-cli', [], claudeFile)!.groups[0]!.hooks[0]!.source;
  const codexRef = sessionStrip('codex-cli', [], codexFile)!.groups[0]!.hooks[0]!.source;
  const drawRow = (ref: HookSourceRef, remember: boolean) => {
    dom.nodes.clear();
    const row = dom.makeNode('li');
    row.connected = true;
    row.append(...viewMod.hookSourceControls(ref, `hook-source-${remember ? 'instructions' : 'plugin'}-${ref.from === 'marketplace' ? 'm' : ref.tool}-0-0`, remember));
    return row;
  };
  const clickRun = async (row: any) => {
    dom.findAll(row, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
    await new Promise(resolve => setTimeout(resolve, 10));
  };
  const panelText = (row: any) => dom.textOf(dom.findAll(row, n => n.className === 'hook-run')[0] ?? '');

  await t.test('item 1 & 3: hookRun carries remember, cross says Forget result vs Close result, and Forget forgets on remembered rows only', async () => {
    const pluginRow = drawRow(claudeRef, false);
    await clickRun(pluginRow);
    const pluginClose = dom.findAll(pluginRow, n => n.id?.endsWith('-close'))[0];
    assert.deepEqual([runCalls.at(-1), pluginClose.getAttribute('aria-label'), pluginClose.getAttribute('title')], [false, 'Close result', 'Close result']);
    pluginClose.onclick();
    assert.equal(forgetCalls.length, 0);

    const insRow = drawRow(claudeRef, true);
    await clickRun(insRow);
    const insClose = dom.findAll(insRow, n => n.id?.endsWith('-close'))[0];
    assert.deepEqual([runCalls.at(-1), dom.textOf(dom.findAll(insRow, n => 'data-hook-run' in (n.attrs ?? {}))[0]), insClose.getAttribute('aria-label'), insClose.getAttribute('title')],
      [true, 'Collect again', 'Forget result', 'Forget result']);
    insClose.onclick();
    assert.deepEqual([forgetCalls.length, dom.textOf(dom.findAll(insRow, n => 'data-hook-run' in (n.attrs ?? {}))[0])], [1, 'See what it adds']);
  });

  await t.test('item 2: one batch survives harness switch, drops on home switch, and Stop+leave restores kept on first draw', async () => {
    viewMod.resetHookSources();
    state.harness = 'claude-cli';
    const loading = viewMod.loadHookResults([claudeFile, codexFile]);
    state.harness = 'codex-cli';
    resolveLast([baseResult({ outcome: 'adds', added: 'claude kept', allPrinted: 'claude kept' }), baseResult({ outcome: 'adds', added: 'codex kept', allPrinted: 'codex kept' })]);
    await loading;
    assert.match(panelText(drawRow(codexRef, true)), /codex kept/);

    nextResult = baseResult({ outcome: 'stopped' });
    await clickRun(drawRow(claudeRef, true));
    dom.nodes.clear();
    viewMod.pruneHookSources();
    assert.match(panelText(drawRow(claudeRef, true)), /claude kept/);

    nextResult = baseResult({ outcome: 'refused', problem: 'Hooks are off.' });
    const refRow = drawRow(claudeRef, true);
    await clickRun(refRow);
    dom.findAll(refRow, n => n.className === 'hook-run')[0].onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(forgetCalls.length, 2);

    const stale = viewMod.loadHookResults([claudeFile]);
    state.home = { home: '/tmp/other', mode: 'actual', label: 'Other' } as any;
    resolveLast([baseResult({ outcome: 'adds', added: 'wrong home', allPrinted: 'wrong home' })]);
    await stale;
    assert.equal(panelText(drawRow(claudeRef, true)), '');
    state.home = { home: '/tmp/h', mode: 'actual', label: 'Home' } as any;
  });

  await t.test('item 6: >6 lines stays full when fresh, folds to 6 lines + Show all on return, and expands on click', async () => {
    viewMod.resetHookSources();
    const tenLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    nextResult = baseResult({ outcome: 'adds', added: tenLines, allPrinted: tenLines });
    const freshRow = drawRow(claudeRef, true);
    await clickRun(freshRow);
    assert.match(panelText(freshRow), /line 10/);
    assert.equal(dom.findAll(freshRow, n => n.id?.endsWith('-more')).length, 0);

    dom.nodes.clear();
    viewMod.pruneHookSources();
    const returnedRow = drawRow(claudeRef, true);
    assert.match(panelText(returnedRow), /line 6/);
    assert.doesNotMatch(panelText(returnedRow), /line 7/);
    const moreBtn = dom.findAll(returnedRow, n => n.id?.endsWith('-more'))[0];
    assert.deepEqual([dom.textOf(moreBtn), moreBtn.getAttribute('aria-expanded')], ['Show all', 'false']);
    moreBtn.onclick();
    assert.match(panelText(returnedRow), /line 10/);
    assert.equal(dom.findAll(returnedRow, n => n.id?.endsWith('-more'))[0].getAttribute('aria-expanded'), 'true');
  });
});

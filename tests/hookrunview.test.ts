// Worked examples of "Run it" on a hook's row (hooksourceview.ts hookSourceControls, canRun, resetHookSources,
// pruneHookSources; sessionhooks.ts hookRunWords, hookStripHelp, hookStripNote, HOOK_RUN_WARN): Check 1 (Claude Code
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
import { sessionSettings } from '../src/pluginitems.ts';
import { HOOK_RUN_WARN, hookRunWords, hookStripHelp, hookStripNote, sessionStrip } from '../src/sessionhooks.ts';
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

test('Check 2: hookRunWords matches T4.22–T4.27 and every added outcome/detail sentence verbatim', () => {
  const time = '9:14 PM';

  // T4.22: adds (session start, plain text matching stdout -> no extra stdout fold; with stderr -> stderr fold)
  const addStart = hookRunWords('claude-cli', baseResult({
    outcome: 'adds', added: 'Line one\nLine two\n', allPrinted: 'Line one\nLine two\n', stderr: 'warn\n', durationMs: 400,
  }), '~', time);
  assert.deepEqual(addStart, {
    sentence: 'Would add (run in ~, 9:14 PM, 0.4 s)',
    notes: [],
    canAgain: true,
    added: 'Line one\nLine two\n',
    allFold: undefined,
    errFold: 'warn\n',
  });

  // T4.22: adds (prompt hook, JSON output -> Show all it printed fold, Copilot subfolder cwd)
  const addPrompt = hookRunWords('claude-cli', baseResult({
    outcome: 'adds', added: 'Extra context', allPrinted: '{"hookSpecificOutput":{"additionalContext":"Extra context"}}',
    emptyPrompt: true, durationMs: 400,
  }), '~/sub', time);
  assert.equal(addPrompt.sentence, 'Would add (run in ~/sub with an empty prompt, 9:14 PM, 0.4 s)');
  assert.equal(addPrompt.added, 'Extra context');
  assert.equal(addPrompt.allFold, '{"hookSpecificOutput":{"additionalContext":"Extra context"}}');
  assert.equal(addPrompt.errFold, undefined);

  // T4.22: Codex adds note + overLimit (2,500 tokens) and Claude Code overLimit (10,000 characters)
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

  // T4.23: empty (stderr shown directly, not folded)
  const empty = hookRunWords('claude-cli', baseResult({ outcome: 'empty', durationMs: 200, stderr: 'note\n' }), '~', time);
  assert.deepEqual(empty, {
    sentence: 'Would add nothing: it printed nothing (run in ~, 9:14 PM, 0.2 s)',
    notes: [],
    canAgain: true,
    errDirect: 'note\n',
  });

  // T4.24: copilot-ignored (Show all it printed fold + direct stderr)
  const copIgnored = hookRunWords('copilot-cli', baseResult({
    outcome: 'copilot-ignored', allPrinted: 'plain hello\n', stderr: 'dbg\n', durationMs: 300,
  }), '~', time);
  assert.deepEqual(copIgnored, {
    sentence: 'Copilot CLI would ignore this: no top-level additionalContext (run in ~, 9:14 PM, 0.3 s).',
    notes: [],
    canAgain: true,
    allFold: 'plain hello\n',
    errDirect: 'dbg\n',
  });

  // T4.25: claude-exit-2 (session start and prompt hook, stderr verbatim)
  const exit2Start = hookRunWords('claude-cli', baseResult({ outcome: 'claude-exit-2', exitCode: 2, stderr: 'bad env\n' }), '~', time);
  assert.deepEqual(exit2Start, {
    sentence: 'Exited 2 (run in ~, 9:14 PM): Claude Code would show its error text only, and add nothing.',
    notes: [],
    canAgain: true,
    errDirect: 'bad env\n',
  });
  const exit2Prompt = hookRunWords('claude-cli', baseResult({
    outcome: 'claude-exit-2', exitCode: 2, emptyPrompt: true, stderr: 'blocked\n',
  }), '~', time);
  assert.deepEqual(exit2Prompt, {
    sentence: 'Exited 2 (run in ~ with an empty prompt, 9:14 PM): Claude Code would block the prompt with its error text.',
    notes: [],
    canAgain: true,
    errDirect: 'blocked\n',
  });

  // T4.26: failed with exit code (stderr and stdout verbatim)
  const failed = hookRunWords('claude-cli', baseResult({
    outcome: 'failed', exitCode: 7, stderr: 'boom\n', allPrinted: 'partial\n',
  }), '~', time);
  assert.deepEqual(failed, {
    sentence: 'Exited 7 (run in ~, 9:14 PM): it would add nothing.',
    notes: [],
    canAgain: true,
    errDirect: 'boom\n',
    outDirect: 'partial\n',
  });

  // Signal: ended by signal
  const signaled = hookRunWords('claude-cli', baseResult({ outcome: 'failed', signal: 'SIGTERM', stderr: 'killed\n' }), '~', time);
  assert.equal(signaled.sentence, 'Ended by SIGTERM (run in ~, 9:14 PM): it would add nothing.');
  assert.equal(signaled.errDirect, 'killed\n');

  // T4.27: timeout, stopped, missing
  const timeout = hookRunWords('claude-cli', baseResult({ outcome: 'timeout', limitSec: 5 }), '~', time);
  assert.equal(timeout.sentence, 'Stopped after 5 s, its time limit: it would add nothing.');
  assert.equal(timeout.canAgain, true);

  const stopped = hookRunWords('claude-cli', baseResult({ outcome: 'stopped' }), '~', time);
  assert.equal(stopped.sentence, 'Stopped. What it changed stays; a program it left running may too.');
  assert.equal(stopped.canAgain, true);

  const missing = hookRunWords('claude-cli', baseResult({ outcome: 'missing', program: '/no/such/bin' }), '~', time);
  assert.equal(missing.sentence, 'Couldn’t start: /no/such/bin not found.');
  assert.equal(missing.canAgain, false);

  // Added not-added details
  const noCtx = hookRunWords('claude-cli', baseResult({ outcome: 'not-added', detail: 'json-no-context', allPrinted: '{"ok":true}' }), '~', time);
  assert.equal(noCtx.sentence, 'Would add nothing: its JSON has no additionalContext (run in ~, 9:14 PM, 0.4 s)');
  assert.equal(noCtx.allFold, '{"ok":true}');

  const block = hookRunWords('claude-cli', baseResult({ outcome: 'not-added', detail: 'json-block', allPrinted: '{"decision":"block"}' }), '~', time);
  assert.equal(block.sentence, 'Would add nothing: its JSON says to block or stop (run in ~, 9:14 PM, 0.4 s)');
  assert.equal(block.allFold, '{"decision":"block"}');

  const badJsonClaude = hookRunWords('claude-cli', baseResult({ outcome: 'not-added', detail: 'invalid-json', allPrinted: '{bad' }), '~', time);
  assert.equal(badJsonClaude.sentence, 'Would add nothing: Claude Code can’t read its JSON (run in ~, 9:14 PM, 0.4 s)');
  assert.equal(badJsonClaude.allFold, '{bad');

  const badJsonCodex = hookRunWords('codex-cli', baseResult({ outcome: 'not-added', detail: 'invalid-json', allPrinted: '[bad' }), '~', time);
  assert.equal(badJsonCodex.sentence, 'Would add nothing: Codex can’t read its JSON (run in ~, 9:14 PM, 0.4 s)');

  const codexExit2 = hookRunWords('codex-cli', baseResult({
    outcome: 'not-added', detail: 'codex-prompt-exit-2', exitCode: 2, emptyPrompt: true, stderr: 'err', allPrinted: 'out',
  }), '~', time);
  assert.equal(codexExit2.sentence, 'Exited 2 (run in ~ with an empty prompt, 9:14 PM): it would add nothing.');
  assert.equal(codexExit2.errDirect, 'err');
  assert.equal(codexExit2.outDirect, 'out');

  const overflow = hookRunWords('claude-cli', baseResult({ outcome: 'not-added', detail: 'overflow', allPrinted: 'big' }), '~', time);
  assert.equal(overflow.sentence, 'Stopped: it printed more than Central Knot reads.');
  assert.equal(overflow.allFold, 'big');

  const spawnErr = hookRunWords('copilot-cli', baseResult({ outcome: 'not-added', detail: 'spawn-error', problem: 'Working folder not found: /nope' }), '~', time);
  assert.equal(spawnErr.sentence, 'Couldn’t start: Working folder not found: /nope');
  assert.equal(spawnErr.canAgain, false);

  // Refusal: main's problem, no Run again
  const refused = hookRunWords('codex-cli', baseResult({
    outcome: 'refused', problem: 'Hooks are turned off in Codex’s settings (features.codex_hooks = false).',
  }), '~', time);
  assert.equal(refused.sentence, 'Hooks are turned off in Codex’s settings (features.codex_hooks = false).');
  assert.equal(refused.canAgain, false);
});

// ---------- Pure unit tests: T1.23 & T2.28 strip lines (Check 3) ----------

test('Check 3: T1.23 help card stays within 30 words and T2.28 strip notes replace strip.note where they apply', () => {
  assert.equal(HOOK_RUN_WARN, 'Runs commands. May change your files.');

  const claudeRun = hookStripHelp('claude-cli', true);
  assert.equal(claudeRun, 'Command hooks that run when a session starts or when you send a prompt; URL, MCP, project and organisation hooks aren’t listed. Run it runs in your home folder.');
  assert.ok(wordCount(claudeRun) <= 30, `expected <=30 words, got ${wordCount(claudeRun)}`);

  const claudeNoRun = hookStripHelp('claude-cli', false);
  assert.equal(claudeNoRun, 'Command hooks that run when a session starts or when you send a prompt; URL, MCP, project and organisation hooks aren’t listed.');
  assert.ok(wordCount(claudeNoRun) <= 30);

  const copilotRun = hookStripHelp('copilot-cli', true);
  assert.equal(copilotRun, 'Command hooks that run when a session starts; URL, MCP, project and organisation hooks aren’t listed. Run it runs in your home folder.');
  assert.ok(wordCount(copilotRun) <= 30);

  const copilotNoRun = hookStripHelp('copilot-cli', false);
  assert.equal(copilotNoRun, 'Command hooks that run when a session starts; URL, MCP, project and organisation hooks aren’t listed.');
  assert.ok(wordCount(copilotNoRun) <= 30);

  // T2.28 Codex note replaces strip.note only when runnable.
  const codexStrip = { note: 'Codex runs a hook only after you trust it in `/hooks`', groups: [{} as any] };
  assert.equal(hookStripNote('codex-cli', codexStrip, true), 'Codex: Run it runs a hook even if it isn’t trusted in `/hooks`.');
  assert.equal(hookStripNote('codex-cli', codexStrip, false), 'Codex runs a hook only after you trust it in `/hooks`.');

  // T2.28 Copilot CLI prompt-only strip replaces strip.note; strip with start hooks keeps strip.note.
  const copilotPrompt = { note: 'Copilot CLI uses only…', groups: [] };
  const copilotStart = { note: 'Copilot CLI uses only…', groups: [{} as any] };
  assert.equal(hookStripNote('copilot-cli', copilotPrompt, false), 'Copilot CLI ignores what prompt hooks print.');
  assert.equal(hookStripNote('copilot-cli', copilotStart, true), 'Copilot CLI uses only….');
  assert.equal(hookStripNote('claude-cli', { groups: [] }, true), undefined);
});

// ---------- DOM harness for Checks 1, 4, 5, 6, 7, 8 ----------

function makeDom() {
  const nodes = new Map<string, any>();
  const scrolled: { id: string; opts: any }[] = [];
  const register = (node: any) => {
    node.connected = true;
    if (node?.id) nodes.set(node.id, node);
    for (const child of node?.children ?? []) if (child && typeof child === 'object') register(child);
  };
  const unregister = (node: any) => {
    node.connected = false;
    if (node?.id && nodes.get(node.id) === node) nodes.delete(node.id);
    for (const child of node?.children ?? []) if (child && typeof child === 'object') unregister(child);
  };
  const makeNode = (tag = 'div') => {
    const node: any = {
      tag, children: [] as any[], attrs: {} as Record<string, unknown>, className: '', textContent: '', dataset: {},
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, content: {},
      setAttribute(k: string, v: string) { this.attrs[k] = v; if (k === 'id') this.id = v; },
      getAttribute(k: string) { return this.attrs[k] ?? null; },
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
  const handlers: Record<string, (...args: any[]) => any> = {};
  Object.assign(globalThis, {
    document: {
      body: makeNode('body'), documentElement: makeNode('html'), activeElement: null, hidden: false, hasFocus: () => true,
      createElement: (tag: string) => makeNode(tag), createTextNode: (text: string) => ({ text }),
      getElementById: (id: string) => nodes.get(id) ?? null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    },
    window: {
      addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      centralKnot: new Proxy(handlers, { get: (target, prop) => (prop in target ? target[prop as string] : async () => null) }),
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 0,
  });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, configurable: true });
  return { nodes, scrolled, makeNode, textOf, findAll, handlers };
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
    assert.ok(runBtn, 'expected a Run it button on an own Claude Code hook row in actual home');
    assert.equal(dom.textOf(runBtn), 'Run it');

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
    assert.match(panelText, /^Would add \(run in ~, .+, \d+\.\d s\)/);
    assert.match(panelText, /Run again/);
    assert.match(panelText, /First line from hook\nSecond line from hook/);
    assert.deepEqual(dom.scrolled, [{ id: panel.id, opts: { block: 'nearest' } }]);

    // Check 6: edit hook on disk, then click Run again -> shows main's refusal without Run again.
    await put(settings, JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/bin/changed.sh' }] }] },
    }, null, 2));
    gate = Promise.resolve();
    const againBtn = dom.findAll(panel, n => 'data-hook-again' in (n.attrs ?? {}))[0];
    againBtn.onclick({ detail: 1 });
    await pending;
    await new Promise(resolve => setTimeout(resolve, 10));
    const refusedPanel = dom.findAll(row, n => n.className === 'hook-run')[0];
    assert.match(dom.textOf(refusedPanel), /This hook is no longer in ~\/\.claude\/settings\.json\./);
    assert.equal(dom.findAll(refusedPanel, n => 'data-hook-again' in (n.attrs ?? {})).length, 0);
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

  const ownRef: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 0, command: 'echo a' };
  const ownRef2: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: '/tmp/h/.claude/settings.json', event: 'SessionStart', at: 1, command: 'echo a' };
  const pluginRef: HookSourceRef = { from: 'installed', tool: 'claude-cli', plugin: 'p', marketName: 'm', declaredIn: '/p/hooks.json', event: 'SessionStart', at: 0, command: 'echo p' };
  const marketRef: HookSourceRef = { from: 'marketplace', marketName: 'm', plugin: 'p', declaredIn: '/m/hooks.json', event: 'SessionStart', at: 0, command: 'echo m' };

  // Check 4: eligibility gate (actual + own + non-Windows only).
  state.home = undefined;
  assert.equal(viewMod.canRun(ownRef, undefined, 'linux'), false);
  assert.equal(viewMod.canRun(ownRef, 'actual', 'linux'), true);
  assert.equal(viewMod.canRun(ownRef, 'actual', 'darwin'), true);
  assert.equal(viewMod.canRun(ownRef, 'actual', 'win32'), false);
  assert.equal(viewMod.canRun(ownRef, 'custom', 'linux'), false);
  assert.equal(viewMod.canRun(ownRef, 'fixture', 'linux'), false);
  assert.equal(viewMod.canRun(pluginRef, 'actual', 'linux'), false);
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
  dom.findAll(afterFoldRedraw, n => 'data-hook-again' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
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

  // Leaving page (pruneHookSources) clears an in-flight row without calling hookStop, even if returning before it finishes, and drops the late result!
  dom.nodes.clear();
  const liveRow = dom.makeNode('li');
  liveRow.connected = true;
  liveRow.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  dom.findAll(liveRow, n => 'data-hook-run' in (n.attrs ?? {}))[0].onclick({ detail: 1 });
  const leaveResolver = pendingResolvers.shift()!;
  const stopsBeforeLeave = stopCalls;
  dom.nodes.clear();
  viewMod.pruneHookSources();
  assert.equal(stopCalls, stopsBeforeLeave, 'leaving the page does not stop a running hook');
  // Returning immediately (before the old run settles) shows idle Run it (not stale Running…).
  const returnedRow = dom.makeNode('li');
  returnedRow.connected = true;
  returnedRow.append(...viewMod.hookSourceControls(ownRef, 'hook-source-instructions-claude-cli-0-0'));
  assert.equal(dom.textOf(dom.findAll(returnedRow, n => 'data-hook-run' in (n.attrs ?? {}))[0]), 'Run it');
  // Late settlement of the abandoned run is dropped even though the row is back on screen!
  leaveResolver(baseResult({ outcome: 'adds', added: 'stale after leave' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(dom.findAll(returnedRow, n => n.className === 'hook-run').length, 0);
});

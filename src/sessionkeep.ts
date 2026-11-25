// Per-home session-cost keeping consent, preflight guards, and the 15-minute sweep timer (MAP.md, "Sessions").
// Owns: canonical home consent keys (`canonicalHome`), pre-consent store checks via `sessionlock.ts checkSessionStore`,
// post-open and 15-minute sweeps (`SWEEP_EVERY_MS`), a sweep the Sessions page asks for (`sweepNow`), single-flight joining, generation-based cancellation and re-entry
// (checking `host.context().home === open.home` before every check/sweep, monotonic `seq`, stale replies dropped), and synchronous Quit abort.
// Not here: `app-settings.json` persistence (`main.ts`), locking (`sessionlock.ts`), sweeping (`sessionsweep.ts`), UI pages.
import { resolve } from 'node:path';
import { checkSessionStore } from './sessionlock.ts';
import { sweepSessions, type SweepOptions, type SweepResult } from './sessionsweep.ts';
import { landingOf, type ShareContext } from './share.ts';
import type { SessionCostsView } from './types.ts';

export const SWEEP_EVERY_MS = 15 * 60_000;
const NOT_OPEN = 'The home on screen is not the one open. Nothing was saved. Read it again.';

export interface SessionKeepHost {
  context: () => ShareContext;
  isKept: (key: string) => boolean;
  saveConsent: (key: string, on: boolean) => Promise<void>;
  changed: (view: SessionCostsView) => void;
  log: (line: string) => void;
  sweep?: (context: ShareContext, options: SweepOptions) => Promise<SweepResult>;
  everyMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

/** Canonical home path key for per-home consent in `app-settings.json`, matching `sessionrecord.ts`. */
export const canonicalHome = async (home: string): Promise<string> => (await landingOf(home)) ?? resolve(home);

const defaultSchedule = (fn: () => void, ms: number) => {
  const handle = setTimeout(fn, ms).unref();
  return () => clearTimeout(handle);
};

/** Coordinates per-home session-cost consent and scheduled sweeps outside sync. */
export function createSessionKeeper(host: SessionKeepHost) {
  let open: { home: string; key: string } | undefined;
  let generation = 0;
  let seq = 0;
  let active: { generation: number; controller: AbortController } | undefined;
  let pendingStart = false;
  let quitting = false;
  let cancelTimer: (() => void) | undefined;
  let refused: string | undefined;
  let lastSent: string | undefined;
  let ops: Promise<unknown> = Promise.resolve();

  const eligible = () => !quitting && !!open && host.isKept(open.key);
  const openContext = (home = open?.home) => {
    const ctx = !quitting && open && home === open.home ? host.context() : undefined;
    return ctx && ctx.home === open!.home ? ctx : undefined;
  };
  const clearTimer = () => {
    cancelTimer?.();
    cancelTimer = undefined;
  };
  const cancelActive = () => {
    generation++;
    pendingStart = false;
    refused = undefined;
    clearTimer();
    active?.controller.abort();
  };
  const view = (home = open?.home ?? ''): SessionCostsView => {
    const same = !!open && home === open.home;
    const on = same && host.isKept(open!.key);
    const collecting = same && !quitting && on && (pendingStart || active?.generation === generation);
    return { home, on, collecting, ...(same && refused ? { refused } : {}), seq };
  };
  const publish = () => {
    if (quitting || !open) return;
    const { seq: _dropped, ...state } = view();
    const encoded = JSON.stringify(state);
    if (encoded === lastSent) return;
    lastSent = encoded;
    seq++;
    host.changed({ ...state, seq });
  };
  const armTimer = () => {
    clearTimer();
    if (!eligible()) return;
    const gen = generation;
    cancelTimer = (host.schedule ?? defaultSchedule)(() => {
      cancelTimer = undefined;
      if (gen !== generation || !eligible()) return;
      armTimer();
      if (!active) startSweep();
    }, host.everyMs && host.everyMs > 0 ? host.everyMs : SWEEP_EVERY_MS);
  };
  const startSweep = () => {
    const ctx = eligible() ? openContext() : undefined;
    if (!ctx) return;
    refused = undefined;
    if (active) {
      if (active.generation !== generation) pendingStart = true;
      return;
    }
    const run = { generation, controller: new AbortController() };
    active = run;
    publish();
    void (host.sweep ?? sweepSessions)(ctx, { signal: run.controller.signal })
      .then(result => {
        if (result.refused && !quitting && run.generation === generation) refused = result.refused;
        host.log(result.skipped === 'busy' ? 'session costs: store is locked by another sweep; skipped'
          : result.refused ? `session costs: refused: ${result.refused}`
          : result.stopped ? 'session costs: sweep stopped'
          : `session costs: swept ${result.taken.requests} requests in ${result.taken.sessions} sessions`);
      }, error => {
        host.log(`session costs: failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (active === run) active = undefined;
        if (pendingStart && eligible()) {
          pendingStart = false;
          startSweep();
        } else if (!quitting && run.generation === generation) publish();
      });
  };
  const start = () => {
    armTimer();
    startSweep();
  };
  const homeOpened = (home: string, key: string): SessionCostsView => {
    if (quitting) return view(home);
    open = { home, key };
    cancelActive();
    if (host.isKept(key)) start();
    publish();
    return view();
  };
  const setKeep = (home: string, on: boolean): Promise<SessionCostsView> => {
    const work = ops.then(async () => {
      const ctx = openContext(home);
      if (!ctx) return { ...view(), refused: NOT_OPEN };
      if (on) {
        const checked = await checkSessionStore(ctx);
        if (!openContext(home)) return { ...view(), refused: NOT_OPEN };
        if (checked.status === 'refused') return { ...view(), refused: checked.refused };
      }
      if (on !== host.isKept(open!.key)) await host.saveConsent(open!.key, on);
      if (quitting || open?.home !== home) return view();
      host.log(`session costs: turned ${on ? 'on' : 'off'} for ${home}`);
      if (on) start();
      else cancelActive();
      publish();
      return view();
    });
    ops = work.catch(() => undefined);
    return work;
  };
  /** A sweep the Sessions page asks for (its 7 days): started, or the one under way joined; only for the open home while it keeps. */
  const sweepNow = (home: string) => {
    if (home === open?.home) startSweep();
  };
  const quit = () => {
    quitting = true;
    cancelActive();
  };
  return { view, homeOpened, setKeep, sweepNow, quit };
}

// Child worker forked by `tests/sessionlock.test.ts` to run real cross-process sweeps and lock-holder crashes.
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import type { ShareContext } from '../src/share.ts';

function waitForCommand(command: string): Promise<void> {
  return new Promise(resolve => {
    const onMessage = (value: unknown) => {
      if (value !== command) return;
      process.off('message', onMessage);
      resolve();
    };
    process.on('message', onMessage);
  });
}

const [, , mode, home, gate = '', nowArg = ''] = process.argv;
if (!mode || !home) {
  process.exit(2);
}

const makeContext = (): ShareContext => ({
  home,
  mode: 'custom',
  read: async () => [],
  build: 'test-build',
  settingsPath: join(dirname(home), 'settings.json'),
  realHome: join(dirname(home), 'real'),
  now: () => (nowArg ? Number(nowArg) : Date.UTC(2026, 10, 24, 16, 0, 0)),
});

if (mode === 'sweep') {
  if (gate) {
    const pauseAtGate = async () => {
      const released = waitForCommand('release');
      process.send?.({ gate });
      await released;
    };
    if (gate.startsWith('open:')) {
      const prefix = `${gate.slice(5)}.`;
      const nativeOpen = fs.open;
      fs.open = (async (path: Parameters<typeof fs.open>[0], flags?: Parameters<typeof fs.open>[1], ...rest: unknown[]) => {
        if (flags === 'wx' && basename(String(path)).startsWith(prefix)) await pauseAtGate();
        return (nativeOpen as (...args: unknown[]) => ReturnType<typeof fs.open>)(path, flags, ...rest);
      }) as typeof fs.open;
      syncBuiltinESMExports();
    } else if (gate.startsWith('rename:')) {
      const target = gate.slice(7);
      const nativeRename = fs.rename;
      fs.rename = (async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
        if (basename(String(to)) === target) await pauseAtGate();
        return nativeRename(from, to);
      }) as typeof fs.rename;
      syncBuiltinESMExports();
    }
  }

  const { sweepSessions } = await import('../src/sessionsweep.ts');
  const go = waitForCommand('go');
  process.send?.({ ready: true });
  await go;
  try {
    const result = await sweepSessions(makeContext());
    process.send?.({ result });
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
  process.disconnect?.();
} else if (mode === 'hold') {
  const { withSessionStoreLock } = await import('../src/sessionlock.ts');
  const res = await withSessionStoreLock(makeContext(), async () => {
    process.send?.({ locked: true });
    await waitForCommand('release');
  });
  if (res.status !== 'ok') {
    process.send?.({ error: res });
    process.exitCode = 1;
  }
  process.disconnect?.();
} else {
  process.exit(2);
}

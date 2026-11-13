// A stand-in for this Mac's places (platform.ts macPlaces, named by CK_TEST_APPS): a folder whose Applications holds made-up
// app bundles, whose lsappinfo answers as macOS's does for the copies a test says are running, and whose Trash receives what
// Remove takes. Every test and script that opens the app sets CK_TEST_APPS to one (scripts/e2e.mjs, ui-tour.mjs,
// alpha-check.mjs, bundled-check.mjs), so none looks at or changes the real Applications folders, apps or Trash.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The stand-in lsappinfo: `find bundleid=<id>` and `info -only pid -only bundlepath <ASN>`, in macOS's own format, over running.json. */
const LSAPPINFO = String.raw`
const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path');
let copies = [];
try { copies = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), 'running.json'), 'utf8')); } catch { /* none */ }
const alive = copies.filter(copy => { try { process.kill(copy.pid, 0); return true; } catch { return false; } });
const [verb, ...rest] = process.argv.slice(2);
if (verb === 'find') {
  const id = (rest[0] ?? '').replace(/^bundleid=/, '');
  console.log(alive.filter(copy => copy.bundleId === id).map(copy => 'ASN:0x0-0x' + copy.pid.toString(16) + '-"stand-in":').join(' '));
} else if (verb === 'info') {
  const pid = parseInt(/^ASN:0x0-0x([0-9a-f]+)/.exec(rest.at(-1) ?? '')?.[1] ?? '', 16);
  const copy = alive.find(each => each.pid === pid);
  if (copy) console.log('"pid"=' + copy.pid + '\n"LSBundlePath"="' + copy.path + '"');
} else process.exit(1);
`;

export interface StandInMac {
  /** The folder to name in CK_TEST_APPS. */
  root: string;
  /** Stands in for /Applications. */
  applications: string;
  /** What Remove moved to the Trash lands here. */
  trash: string;
  /** Writes a made-up app bundle: `<folder>/<name>.app` with an Info.plist naming its bundle id. Returns its path. */
  bundle(folder: string, name: string, bundleId: string): string;
  /** The copies the stand-in lsappinfo lists as running (while their process lives), each with the bundle it runs from. */
  running(copies: { bundleId: string; pid: number; path: string }[]): void;
}

export function standInMac(root: string): StandInMac {
  mkdirSync(join(root, 'Applications'), { recursive: true });
  writeFileSync(join(root, 'lsappinfo'), `#!${process.execPath}\n${LSAPPINFO}`, { mode: 0o755 });
  writeFileSync(join(root, 'running.json'), '[]\n');
  return {
    root, applications: join(root, 'Applications'), trash: join(root, 'Trash'),
    bundle(folder, name, bundleId) {
      const app = join(folder, `${name}.app`);
      mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
      writeFileSync(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>${bundleId}</string>\n\t<key>CFBundleName</key>\n\t<string>${name}</string>\n</dict></plist>\n`);
      return app;
    },
    running(copies) { writeFileSync(join(root, 'running.json'), `${JSON.stringify(copies)}\n`); },
  };
}

/**
 * A process standing in for a running app, once it is ready to be asked: one that quits when asked (a signal to stop, as
 * Central Knot takes Quit), or one that stays, as an app does while its window asks about unsaved work. The caller kills it.
 */
export function standInApp(quits: boolean): Promise<ChildProcess> {
  const code = `process.on('SIGTERM', () => { ${quits ? 'process.exit(0);' : ''} }); setInterval(() => {}, 1e9); console.log('ready');`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((done, fail) => { child.stdout!.once('data', () => done(child)); child.once('error', fail); });
}

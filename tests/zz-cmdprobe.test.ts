// THROWAWAY (one Windows run, then removed): measures what cmd.exe and the packaged app do, for src/launch.ts's design.
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmShim } from './standin.ts';

const META = /([()\][%!^"`<>&|;, *?])/g;
const quoted = (arg: string) => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
const carets = (text: string, times: number) => { for (let i = 0; i < times; i++) text = text.replace(META, '^$1'); return text; };
const args = ['', ' ', 'a b', '"', 'a b"c', '&', '|', '%PATH%', '!x!', '^', 'trail\\', 'mix "&|^ %PATH% !x! (x)\\" end\\'];
const say = (what: string, value: unknown) => console.log(`PROBE ${what}: ${JSON.stringify(value)}`);
function run(shim: string, list: string[], times: number, pathAs: 'quoted' | 'carets', env?: NodeJS.ProcessEnv) {
  const head = pathAs === 'quoted' ? `"${shim}"` : carets(shim, 1);
  const line = `"${head}${list.map(arg => ` ${carets(quoted(arg), times)}`).join('')}"`;
  const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/v:off', '/c', line], { windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8', env });
  let parsed: unknown = result.stdout;
  try { parsed = JSON.parse(result.stdout); } catch { /* as text */ }
  return { status: result.status, same: JSON.stringify(parsed) === JSON.stringify(list), out: parsed, err: (result.stderr ?? '').slice(0, 400), error: result.error?.message };
}

test('probe cmd.exe', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ck-probe-')));
  try {
    for (const name of ['plain', 'with space (x86) [g]', 'Tom & Jerry', 'a ^ b', 'pct %PATH% x', 'bang !x! y']) {
      const folder = join(base, name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'echo.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
      writeFileSync(join(folder, 'echo.cmd'), npmShim('echo.js'));
      writeFileSync(join(folder, 'fwd.cmd'), `@"${process.execPath}" "${join(folder, 'echo.js')}" %*\r\n`);
      say(`npm shim, quoted path, 2 passes, folder ${name}`, run(join(folder, 'echo.cmd'), args, 2, 'quoted'));
      say(`npm shim, caret path, 2 passes, folder ${name}`, run(join(folder, 'echo.cmd'), args, 2, 'carets'));
      say(`npm shim, quoted path, 1 pass, folder ${name}`, run(join(folder, 'echo.cmd'), args, 1, 'quoted'));
      say(`fwd cmd, quoted path, 1 pass, folder ${name}`, run(join(folder, 'fwd.cmd'), args, 1, 'quoted'));
      say(`fwd cmd, quoted path, 2 passes, folder ${name}`, run(join(folder, 'fwd.cmd'), args, 2, 'quoted'));
    }
    // The environment a Node script behind npm's .cmd sees when given only HOME and PATH.
    const plain = join(base, 'plain');
    writeFileSync(join(plain, 'env.js'), 'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()));\n');
    writeFileSync(join(plain, 'env.cmd'), npmShim('env.js'));
    say('env behind npm shim given HOME and PATH', run(join(plain, 'env.cmd'), [], 1, 'quoted', { HOME: plain, PATH: process.env.PATH }).out);
    writeFileSync(join(plain, 'cwd.js'), 'process.stdout.write(JSON.stringify([process.cwd(), require("fs").realpathSync(process.cwd()), require("fs").realpathSync.native(process.cwd())]));\n');
    writeFileSync(join(plain, 'cwd.cmd'), npmShim('cwd.js'));
    const cwd = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/v:off', '/c', `""${join(plain, 'cwd.cmd')}""`], { windowsVerbatimArguments: true, cwd: mkdtempSync(join(tmpdir(), 'ck-probe-cwd-')), encoding: 'utf8' });
    say('cwd seen, tmpdir, realpath(tmpdir)', [cwd.stdout, tmpdir(), realpathSync(tmpdir()), realpathSync.native(tmpdir())]);
    // The packaged app's own Node, if the smoke step left it.
    const exe = join(import.meta.dirname, '..', 'release', 'Central Knot-win32-x64', 'Central Knot.exe');
    say('packaged exe exists', existsSync(exe));
    if (existsSync(exe)) {
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
      const v = spawnSync(exe, ['-e', 'console.log(JSON.stringify(process.versions))'], { env, encoding: 'utf8', timeout: 60_000 });
      say('packaged -e', { status: v.status, out: v.stdout.slice(0, 300), err: v.stderr.slice(0, 300) });
      const t = spawnSync(exe, ['--test', 'tests/launch.test.ts'], { env, encoding: 'utf8', timeout: 120_000, cwd: join(import.meta.dirname, '..') });
      say('packaged --test launch', { status: t.status, out: t.stdout.slice(-3000), err: t.stderr.slice(-1500) });
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

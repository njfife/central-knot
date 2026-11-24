// How a program is started (src/launch.ts), as worked examples: on macOS and Linux exactly as asked; on Windows a .cmd or .bat
// through cmd.exe, each argument arriving as it was given, through npm's own .cmd (which cmd reads twice) and any other (once);
// an argument holding a line break refused, saying so; and what a home that is not this computer's own is named by there.
// The examples that run a real .cmd run on Windows only, under the tests' Node and the packaged app's own
// (scripts/windows-check.mjs --smoke runs this file under it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homeVariables, launchCommand, start } from '../src/launch.ts';
import { npmShim } from './standin.ts';

const windows = process.platform === 'win32';
const onWindows = !windows && 'starts a real .cmd through cmd.exe: Windows only (macOS and Linux start every program as asked, above)';
/** Every kind of argument that cmd or a program's command line reads specially, each alone and together. */
const awkward = ['', ' ', 'a b', '"', 'a b"c', '&', '|', '<x>', '(x)', '%PATH%', '!x!', '^', 'trail\\', 'C:\\Program Files\\', '\\"', 'a,b;c=d',
  'mix "&|^ %PATH% !x! (x)\\" end\\'];

test('On macOS and Linux a program is started as asked: its file and arguments, and nothing added', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(launchCommand('/opt/tools/codex.cmd', ['a b', '%PATH%', ''], platform), { file: '/opt/tools/codex.cmd', args: ['a b', '%PATH%', ''], options: {} });
  }
});

test('On Windows a program that is not a .cmd or .bat is started as asked', () => {
  assert.deepEqual(launchCommand('C:\\Tools\\claude.exe', ['a b', '%PATH%'], 'win32'), { file: 'C:\\Tools\\claude.exe', args: ['a b', '%PATH%'], options: {} });
});

test('On Windows a .cmd runs through cmd.exe with delayed expansion off: its path quoted, each argument quoted as a program reads it, then each of cmd’s characters given a caret', () => {
  const ran = launchCommand('C:\\My Tools (x86)\\a&b\\tool.CMD', ['a b', 'say "hi"\\', '', '50%'], 'win32');
  assert.equal(ran.file, process.env.ComSpec ?? 'cmd.exe');
  assert.deepEqual(ran.options, { windowsVerbatimArguments: true });
  assert.deepEqual(ran.args, ['/d', '/s', '/v:off', '/c', '""C:\\My Tools (x86)\\a&b\\tool.CMD" ^"a^ b^" ^"say^ \\^"hi\\^"\\\\^" ^"^" ^"50^%^""']);
  assert.deepEqual(launchCommand('C:\\t\\old.bat', [], 'win32').args.at(-1), '""C:\\t\\old.bat""');
});

test('npm’s own .cmd passes its arguments on, so cmd reads them twice and each gets its carets twice; any other .cmd, a look-alike too, once', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-launch-'));
  try {
    const npm = join(base, 'codex.cmd'), other = join(base, 'other.cmd'), lookalike = join(base, 'lookalike.cmd');
    await writeFile(npm, npmShim('codex.js'));
    await writeFile(other, '@echo off\r\n"C:\\node.exe" "%~dp0\\codex.js" %*\r\n');
    await writeFile(lookalike, `${npmShim('codex.js')}echo %*\r\n`);
    const last = (file: string) => launchCommand(file, ['a&b'], 'win32').args.at(-1);
    assert.equal(last(npm), `""${npm}" ^^^"a^^^&b^^^""`);
    assert.equal(last(other), `""${other}" ^"a^&b^""`);
    assert.equal(last(lookalike), `""${lookalike}" ^"a^&b^""`);
    assert.equal(last(join(base, 'gone.cmd')), `""${join(base, 'gone.cmd')}" ^"a^&b^""`);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('On Windows an argument holding a line break is not passed to a .cmd: cmd would end the command there; the refusal names it', () => {
  for (const arg of ['two\nlines', 'a\rb']) {
    assert.throws(() => launchCommand('C:\\t\\codex.cmd', ['--model', arg], 'win32'), { message: `codex.cmd was not run: on Windows an argument to it can’t hold a line break (${JSON.stringify(arg)}).` });
  }
  assert.doesNotThrow(() => launchCommand('C:\\t\\codex.exe', ['two\nlines'], 'win32'));
});

test('A home that is not this computer’s own is named, on Windows, by every variable a tool there finds its home by; elsewhere HOME alone does it', () => {
  assert.deepEqual(homeVariables('D:\\Practice\\home', 'win32'), { USERPROFILE: 'D:\\Practice\\home', HOMEDRIVE: 'D:', HOMEPATH: '\\Practice\\home',
    APPDATA: 'D:\\Practice\\home\\AppData\\Roaming', LOCALAPPDATA: 'D:\\Practice\\home\\AppData\\Local', CODEX_HOME: 'D:\\Practice\\home\\.codex' });
  assert.deepEqual(homeVariables('/tmp/home', 'linux'), {});
  assert.deepEqual(homeVariables('/tmp/home', 'darwin'), {});
});

/** What `file` printed when started with `args`, and how it ended. */
function output(file: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done, failed) => {
    const child = start(file, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', failed);
    child.on('close', code => done({ code, stdout, stderr }));
  });
}

test('On Windows each argument reaches a Node script through npm’s own .cmd as it was given, from a folder whose name has spaces and brackets', { skip: onWindows }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-launch-')));
  try {
    const folder = join(base, 'Program Files (x86)', 'npm [global]');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'echo.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    await writeFile(join(folder, 'echo.cmd'), npmShim('echo.js'));
    const ran = await output(join(folder, 'echo.cmd'), awkward);
    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual(JSON.parse(ran.stdout), awkward);
    assert.deepEqual(JSON.parse((await output(join(folder, 'echo.cmd'), [])).stdout), []);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('On Windows a .cmd of another form, from a folder whose name has & in it, is run, and passes on each argument holding no quote as given', { skip: onWindows }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-launch-')));
  try {
    const folder = join(base, 'Tom & Jerry (tools)');
    await mkdir(folder, { recursive: true });
    await writeFile(join(base, 'echo.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    // Not npm's form, so cmd reads its arguments once more than it is told: one holding a quote may not pass whole (src/launch.ts).
    await writeFile(join(folder, 'echo.cmd'), `@"${process.execPath}" "${join(base, 'echo.js')}" %*\r\n`);
    const plain = awkward.filter(arg => !arg.includes('"'));
    const ran = await output(join(folder, 'echo.cmd'), plain);
    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual(JSON.parse(ran.stdout), plain);
  } finally { await rm(base, { recursive: true, force: true }); }
});

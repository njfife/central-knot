// A stand-in for a tool's command line in a test, made for the platform the test runs on (standIn). On macOS and Linux it is the
// shell script the test gives, byte for byte, made executable, as these tests have always written it. On Windows, where a
// file without an ending can't be run, it is the Node script the test gives, started by a .cmd in the form npm writes for a
// command it installs (npmShim), which is the form most of the tools' commands take there and the one src/launch.ts
// recognises as passing its arguments on.
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

/** How every .cmd npm writes for an installed command begins (npm's cmd-shim, the same in its versions 6.0.2 and 9.0.2). */
export const NPM_SHIM_HEAD = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';

/**
 * npm's .cmd for `script`, a Node script beside it, as cmd-shim 9.0.2 writes it for a script that starts `#!/usr/bin/env node`;
 * `node` is the one it falls back to when none is beside it (cmd-shim writes `node`, found on PATH; here, the one running the tests).
 */
export const npmShim = (script: string, node = process.execPath) => `${NPM_SHIM_HEAD}\r\n`
  + `IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=${node}"\r\n)\r\n\r\n`
  + `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\${script}" %*\r\n`;

/**
 * Writes a stand-in at `path` (its folder made if need be) and gives back what to run. On macOS and Linux: `sh`, as given, with
 * mode 0755. On Windows: `js` as `<path>.cjs`, run as `node -e` runs its code (`process.argv[1]` is the first argument), and
 * `<path>.cmd` (npmShim) that starts it with the arguments it was given.
 */
export async function standIn(path: string, sh: string, js: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  if (process.platform !== 'win32') {
    await writeFile(path, sh);
    await chmod(path, 0o755);
    return path;
  }
  await writeFile(`${path}.cjs`, `process.argv.splice(1, 1);\n${js}\n`);
  await writeFile(`${path}.cmd`, npmShim(`${basename(path)}.cjs`));
  return `${path}.cmd`;
}

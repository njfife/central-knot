// How Central Knot starts another program (start, launchCommand), and what a tool is given on Windows for a home that is not
// this computer's own (homeVariables). On macOS and Linux a program is started exactly as asked. On Windows Node refuses to
// start a .cmd or .bat without a shell (since April 2024), and most of the tools' commands there are one (npm installs a
// command as a .cmd): such a file is run through cmd.exe with each argument encoded so that it arrives as it was given.
// Its callers (plugins.ts run, draftbase.ts run, discovery.ts askVersion) keep their own output, limits, timer and stop: how a
// program and what it started are stopped is theirs. Where a tool's command is found is platform.ts's.
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { win32 } from 'node:path';

/** What is really started for a program and its arguments, and the option that says its arguments are already encoded. */
export interface Launch { file: string; args: string[]; options: { windowsVerbatimArguments?: true } }

/** cmd.exe's own characters (cross-spawn's list): each written with a caret before it, so cmd reads it as itself. */
const CMD_SPECIAL = /([()\][%!^"`<>&|;, *?])/g;
/** One argument as a Windows program reads it from its command line: quoted, a quote as \", the backslashes before one or at the end doubled. */
const quoted = (arg: string) => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;

/** How every .cmd npm writes for a command it installs begins (npm's cmd-shim). */
const NPM_SHIM_HEAD = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';
/**
 * Whether `file` is a .cmd npm wrote: its head, and `%*` (every argument it was given, as given) once, at the end of its last
 * line, which starts the program. cmd reads such a line again, so the arguments are read twice. Known by what the file holds,
 * not its name: any other .cmd (one that can't be read, too) is taken to read them once.
 */
function forwardsLikeNpm(file: string): boolean {
  try {
    const text = readFileSync(file, 'utf8');
    return text.startsWith(NPM_SHIM_HEAD) && text.endsWith(' %*\r\n') && text.indexOf('%*') === text.length - 4;
  } catch { return false; }
}

/**
 * What starts `file` with `args`. On Windows a .cmd or .bat is run by cmd.exe (ComSpec) with /d (no AutoRun), /s and /c, and
 * delayed expansion off (/v:off, so `!` is itself): its path quoted (a path can't hold a quote; a pair of % around a
 * variable's name in it would still be read as that variable), each argument quoted as a program reads it, then a caret put
 * before each of cmd's characters, once for each time cmd will read it. An argument holding a line break can't be passed
 * (cmd ends the command there): nothing is run and the refusal names it. Anything else, and every program on macOS and
 * Linux, is started as asked.
 */
export function launchCommand(file: string, args: string[], platform: string = process.platform): Launch {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args, options: {} };
  const broken = args.find(arg => /[\r\n]/.test(arg));
  if (broken !== undefined) throw new Error(`${win32.basename(file)} was not run: on Windows an argument to it can’t hold a line break (${JSON.stringify(broken)}).`);
  const reads = forwardsLikeNpm(file) ? 2 : 1;
  const encoded = args.map(arg => { let text = quoted(arg); for (let read = 0; read < reads; read++) text = text.replace(CMD_SPECIAL, '^$1'); return text; });
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/v:off', '/c', `""${file}"${encoded.map(arg => ` ${arg}`).join('')}"`], options: { windowsVerbatimArguments: true } };
}

/** Starts `file` with `args` (launchCommand), with the caller's own options. Throws, as spawn does, when it can't be started so. */
export function start(file: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
  const launch = launchCommand(file, args);
  return spawn(launch.file, launch.args, { ...options, ...launch.options });
}

/**
 * On Windows, the variables a tool finds its home by besides HOME, each pointing into `home`, for a home that is not this
 * computer's own (a Practice copy, another folder, a test's made-up home), so that a tool run there reads that home and not
 * the person's: USERPROFILE, HOMEDRIVE and HOMEPATH, APPDATA and LOCALAPPDATA, and Codex's CODEX_HOME. Nothing is made in
 * `home` for them. Their names are in upper case, which Node passes over the same name in another case (of names differing
 * only in case it passes the first in sorted order). None elsewhere, where HOME is the home.
 */
export function homeVariables(home: string, platform: string = process.platform): Record<string, string> {
  if (platform !== 'win32') return {};
  const drive = win32.parse(home).root.replace(/\\$/, '');
  return { USERPROFILE: home, HOMEDRIVE: drive, HOMEPATH: home.slice(drive.length) || '\\', APPDATA: win32.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: win32.join(home, 'AppData', 'Local'), CODEX_HOME: win32.join(home, '.codex') };
}

// How Central Knot starts a tool's command (start, launchCommand), and what a tool is given on Windows for a home that is not
// this computer's own (homeVariables, dropVariable). On macOS and Linux a command is started exactly as asked. On Windows Node refuses to
// start a .cmd or .bat without a shell (since April 2024), and most of the tools' commands there are one (npm installs a
// command as a .cmd): such a file is run through cmd.exe with each argument encoded so that it arrives as it was given
// (through npm's own .cmd every argument does; see launchCommand for what another .cmd takes).
// Its callers (plugins.ts run, draftbase.ts run, discovery.ts askVersion) keep their own output, limits, timer and stop: how a
// program and what it started are stopped is theirs. Where a tool's command is found is platform.ts's. The app's other
// programs are started where they are used, as asked: git and tar are .exe files on Windows, and the login shell, D-Bus,
// lsappinfo and codesign run only on macOS or Linux.
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { win32 } from 'node:path';

/** What is really started for a command and its arguments, and the options cmd.exe's route adds (arguments already encoded, no window). */
export interface Launch { file: string; args: string[]; options: { windowsVerbatimArguments?: true; windowsHide?: true } }

/** cmd.exe's own characters (cross-spawn's list), each given a caret before it, so that cmd reads it as itself. */
const CMD_SPECIAL = /([()\][%!^"`<>&|;, *?])/g;
const caret = (text: string) => text.replace(CMD_SPECIAL, '^$1');
/** One argument as a Windows program reads it from its command line: quoted, a quote as \", the backslashes before one or at the end doubled. */
const quoted = (arg: string) => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;

/**
 * How a .cmd npm writes for a command it installs begins (cmd-shim's head, the same in its versions 6.0.2, 8.0.0 and 9.0.2).
 * A shim npm wrote in an older form, without it, is not recognised. The tests' stand-ins are written with it (tests/standin.ts).
 */
export const NPM_SHIM_HEAD = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';
/**
 * Whether `file` is a .cmd npm wrote: its head, and `%*` (every argument it was given, as given) once, at the end of its last
 * line, which starts the program. cmd reads such a line again, so the arguments are read twice, and a quote among them is
 * read as a quote. Known by what the file holds, not its name: any other .cmd (one that can't be read, too) is taken to read
 * them once, which is right for one that reads its own arguments (one ending in a backslash arrives with it doubled, as a
 * program would read it). One that passes them on in a form of its own (pnpm's, a hand-written one) reads them twice all
 * the same, and there a quote in an argument would end the quoting and cmd would read what follows as commands: so an
 * argument holding one is refused for any .cmd but npm's.
 */
function forwardsLikeNpm(file: string): boolean {
  try {
    const text = readFileSync(file, 'utf8');
    return text.startsWith(NPM_SHIM_HEAD) && text.endsWith(' %*\r\n') && text.indexOf('%*') === text.length - 4;
  } catch { return false; }
}

/**
 * What starts `file` with `args`. On Windows a .cmd or .bat is run by cmd.exe (ComSpec) with /d (no AutoRun), /s and /c,
 * delayed expansion off (/v:off, so `!` is itself) and no window. Its path is given a caret before each of cmd's characters
 * (read once: a space, &, ^ or %NAME% in it stays itself); each argument is quoted as a program reads it, then given a caret
 * before each of cmd's characters, once for each time cmd reads it. Nothing is run, and the refusal names the argument, for
 * one holding a line break (cmd ends the command there), or a double quote where the file is not npm's own .cmd
 * (forwardsLikeNpm). Anything else, and every program on macOS and Linux, is started as asked.
 */
export function launchCommand(file: string, args: string[], platform: string = process.platform): Launch {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args, options: {} };
  const name = win32.basename(file);
  const broken = args.find(arg => /[\r\n]/.test(arg));
  if (broken !== undefined) throw new Error(`${name} was not run: on Windows an argument to it can’t hold a line break (${JSON.stringify(broken)}).`);
  const npm = forwardsLikeNpm(file);
  const quote = npm ? undefined : args.find(arg => arg.includes('"'));
  if (quote !== undefined) {
    throw new Error(`${name} was not run: on Windows an argument to a .cmd or .bat other than npm’s own can’t hold a double quote (${JSON.stringify(quote)}), as cmd.exe would read what follows it as commands.`);
  }
  const encoded = args.map(arg => (npm ? caret(caret(quoted(arg))) : caret(quoted(arg))));
  const line = `"${caret(file)}${encoded.map(arg => ` ${arg}`).join('')}"`;
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/v:off', '/c', line], options: { windowsVerbatimArguments: true, windowsHide: true } };
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
 * only in case it passes the first in sorted order, child_process.js). None elsewhere, where HOME is the home.
 */
export function homeVariables(home: string, platform: string = process.platform): Record<string, string> {
  if (platform !== 'win32') return {};
  const drive = win32.parse(home).root.replace(/\\$/, '');
  return { USERPROFILE: home, HOMEDRIVE: drive, HOMEPATH: home.slice(drive.length) || '\\', APPDATA: win32.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: win32.join(home, 'AppData', 'Local'), CODEX_HOME: win32.join(home, '.codex') };
}

/** Takes the variable `name` out of `env`: on Windows, which reads a variable's name in any case, in every case it is written there. */
export function dropVariable(env: NodeJS.ProcessEnv, name: string, platform: string = process.platform): void {
  for (const key of Object.keys(env)) if (key === name || (platform === 'win32' && key.toUpperCase() === name.toUpperCase())) delete env[key];
}

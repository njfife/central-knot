// How Central Knot starts a tool's command (start, launchCommand), and what a tool is given on Windows for a home that is not
// this computer's own (homeVariables, dropVariable). On macOS and Linux a command is started exactly as asked. On Windows Node refuses to
// start a .cmd or .bat without a shell (since April 2024), and most of the tools' commands there are one (npm installs a
// command as a .cmd): such a file is run through cmd.exe with each argument encoded so that it arrives as it was given
// (through npm's own .cmd every argument does; see launchCommand for what another .cmd takes).
// Its callers (plugins.ts run, draftbase.ts run, discovery.ts askVersion) keep their own output, limits and timer. On macOS
// and Linux how a program and what it started are stopped is theirs (a process group of its own). On Windows plugins.ts run
// (git's runs, the plugin commands, the MCP sign-in check) and draftbase.ts run ask a program and all it started to stop
// through stopTree and end as stopRun says; what a stop could not end is said in the app's log. askVersion's probe is ended
// by execFile's timeout alone. A draft's or a sign-in check's folder is removed by clearRunFolder where it can be, else said
// in the log. Where a tool's command is found is platform.ts's. The app's other programs are started where they are used, as
// asked: git and tar are .exe files on Windows, and the login shell, D-Bus, lsappinfo and codesign run only on macOS or Linux.
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
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

/** How long taskkill is given to end a tree: it is ended itself then, and the tree is not known to be gone. */
const TREE_STOP_MS = 2000;
/** How long a run waits for its output to close once its tool has ended (draftbase.ts run) or its stop has answered (stopRun): a helper can hold it open. */
export const CLOSE_GRACE_MS = 1500;
/** What the app's log says of a run whose stop was not known to end everything it started (clearRunFolder, plugins.ts native). */
export const NOT_ALL_STOPPED = 'not everything it started could be stopped';
/** Each child's one stop (stopTree), kept by the child itself: a later child may have the same process id, never the same object. */
const treeStops = new WeakMap<ChildProcess, Promise<boolean>>();

/**
 * Windows: stops `child` and everything started from it, and what those started, with the system's own taskkill (/PID <pid>
 * /T /F, by its full path under SystemRoot, read at each stop), with no window and its output not read, given two seconds.
 * True where taskkill ended 0 (the tree is gone), and for a child that never started (nothing to stop); false for anything
 * else: another code, its two seconds passed (it is ended then), it could not be started, and a child already seen to end,
 * which gets no taskkill (its process id may be another program's by then). Its words and its other codes are not read:
 * they are in the system's language, and one code is given for more than one cause. Once at most for a child: a second stop
 * answers as the first. Not reached: a helper whose parent had ended before the stop, as no tree leads to it.
 */
export function stopTree(child: ChildProcess): Promise<boolean> {
  const asked = treeStops.get(child);
  if (asked) return asked;
  const stopping = new Promise<boolean>(done => {
    if (child.pid === undefined) return done(true);
    if (child.exitCode !== null || child.signalCode !== null) return done(false);
    const bound = setTimeout(() => done(false), TREE_STOP_MS);
    const answer = (whole: boolean) => { clearTimeout(bound); done(whole); };
    try {
      const taskkill = spawn(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true, timeout: TREE_STOP_MS });
      taskkill.on('error', () => answer(false));
      taskkill.on('exit', code => answer(code === 0));
    } catch { answer(false); }
  });
  treeStops.set(child, stopping);
  return stopping;
}

/**
 * Windows: how plugins.ts run and draftbase.ts run stop a command and end. `stop` asks stopTree, once. `settle(code)` (from
 * `close`, `error` or draftbase.ts run's exit timer) ends the run at once while no stop was asked, else once the stop has
 * answered; that answer also ends it CLOSE_GRACE_MS later at most, with the exit code. `end` gets the code and whether the
 * stop was whole (true with none asked); it may be called again and keeps the first. After it, the output is let go: a tool
 * a failed stop left running fills no memory.
 */
export function stopRun<Code>(child: ChildProcessWithoutNullStreams, end: (code: Code | number, whole: boolean) => void): { stop: () => void; settle: (code: Code) => void } {
  let stopping: Promise<boolean> | undefined;
  const ended = (code: Code | number, whole: boolean) => {
    end(code, whole);
    child.stdout.destroy();
    child.stderr.destroy();
  };
  return {
    stop: () => {
      stopping ??= stopTree(child).then(whole => {
        setTimeout(() => ended(child.exitCode ?? 1, whole), CLOSE_GRACE_MS);
        return whole;
      });
    },
    settle: code => {
      if (stopping) void stopping.then(whole => ended(code, whole));
      else ended(code, true);
    },
  };
}

/**
 * Removes the folder a tool's run worked in, once the run has ended, and never throws. Where the folder can't be removed (on
 * Windows something the run started still holds it), or the run's stop was not known to end everything it started
 * (`leftRunning`), `log` gets one line naming the run (`who`) and the folder.
 */
export async function clearRunFolder(folder: string, who: string, leftRunning: boolean | undefined, log?: (line: string) => void): Promise<void> {
  const failed = await rm(folder, { recursive: true, force: true }).then(() => '', (error: NodeJS.ErrnoException) => error.code ?? String(error));
  const said = [leftRunning ? NOT_ALL_STOPPED : '', failed ? `its folder ${folder} was left behind (${failed})` : ''].filter(Boolean);
  if (said.length) log?.(`${who}: ${said.join('; ')}`);
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

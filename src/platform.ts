// Where this computer keeps things, for the main process's modules: where a tool's CLI may be (executableCandidates; the PATH
// to run it with: searchPath, pathBeside), where its desktop app may be (appCandidates, and the other apps: otherAppCandidates),
// this Mac's Applications folders, running apps and Trash, which a test stands in for (macPlaces), and whether a Linux desktop
// has a system tray (hasStatusNotifierWatcher; asked again, at sign-in, by trayWithin). Nothing here reads a tool's files.
import { execFile } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { userInfo } from 'node:os';
import { delimiter, dirname, isAbsolute, join, posix, sep, win32 } from 'node:path';

/**
 * PATH for running a CLI: its own folder first. An app opened from Finder or a launcher gets a short PATH, and a CLI that
 * is a script (Codex and Copilot CLI from npm run on Node) finds its interpreter beside itself.
 */
export const pathBeside = (binary: string) => [dirname(binary), process.env.PATH].filter(Boolean).join(delimiter);

/**
 * Tools an end-to-end run looks for only inside its throwaway home (CK_TEST_HOME_ONLY: their binaries' names, with commas):
 * what the machine running the checks has installed must not change what they see.
 */
const homeOnly = (binary: string, env: NodeJS.ProcessEnv = process.env) => (env.CK_TEST_HOME_ONLY ?? '').split(',').includes(binary);

/** How many folders are searched for a CLI: a terminal's PATH is a few dozen at most. */
const SEARCHED = 40;

/** Command endings Windows can run for a CLI (script-host and UI endings like .js or .vbs are left out). */
const WINDOWS_EXTS = ['.exe', '.cmd', '.bat', '.com'];

const envValue = (env: NodeJS.ProcessEnv, name: string) =>
  env[name] ?? Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

const isWinPath = (path: string) => /^[A-Za-z]:/.test(path) || path.includes('\\');
const joinPath = (dir: string, ...parts: string[]) => (isWinPath(dir) ? win32 : posix).join(dir, ...parts);

/** Strip quotes and trailing separators (keeping a root like `C:\` or `/`) from a Windows PATH entry. */
function cleanWinDir(raw: string): string {
  const dir = raw.trim().replace(/"/g, '');
  if (!dir) return '';
  if (/^[A-Za-z]:[\\/]+$/.test(dir)) return `${dir.slice(0, 2)}\\`;
  return dir === '/' ? '/' : dir.replace(/[\\/]+$/, '');
}

/** Endings from PATHEXT that can run a CLI, lowercased, always carrying .exe before .cmd. */
function windowsExts(env: NodeJS.ProcessEnv): string[] {
  const fromEnv = (envValue(env, 'PATHEXT') ?? '').split(';')
    .map(ext => ext.trim().toLowerCase()).filter(ext => WINDOWS_EXTS.includes(ext));
  const exts = [...new Set(fromEnv)];
  if (!exts.length) return [...WINDOWS_EXTS];
  for (const needed of ['.exe', '.cmd']) if (!exts.includes(needed)) exts.push(needed);
  const exe = exts.indexOf('.exe'), cmd = exts.indexOf('.cmd');
  if (exe > cmd) [exts[cmd], exts[exe]] = [exts[exe], exts[cmd]];
  return exts;
}

const winFolder = (env: NodeJS.ProcessEnv, name: string, fallback: string) => {
  const fromEnv = cleanWinDir(envValue(env, name) ?? '');
  return fromEnv && win32.isAbsolute(fromEnv) ? fromEnv : fallback;
};

const underHome = (candidate: string, home: string, platform: string) => {
  if (platform !== 'win32') return candidate.startsWith(`${home}${sep}`);
  const root = cleanWinDir(home);
  const slash = root.endsWith('\\') || root.endsWith('/') ? '' : isWinPath(root) ? '\\' : '/';
  return candidate.toLowerCase().startsWith(`${root}${slash}`.toLowerCase());
};

export function executableCandidates(home: string, searchPath: string, binary = 'claude', platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    const appData = winFolder(env, 'APPDATA', joinPath(home, 'AppData', 'Roaming'));
    const local = winFolder(env, 'LOCALAPPDATA', joinPath(home, 'AppData', 'Local'));
    const fixed = [joinPath(home, '.local', 'bin'), joinPath(appData, 'npm'), joinPath(local, 'Microsoft', 'WinGet', 'Links'), joinPath(home, 'scoop', 'shims')];
    const seen = new Set<string>(), dirs: string[] = [];
    for (const dir of [...fixed, ...searchPath.split(';').map(cleanWinDir).filter(win32.isAbsolute)]) {
      const key = dir.replace(/\\/g, '/').toLowerCase();
      if (!seen.has(key)) { seen.add(key); dirs.push(dir); }
    }
    const exts = windowsExts(env);
    const names = binary === 'agy' ? ['agy', 'antigravity'] : [binary];
    const candidates = names.flatMap(name => dirs.slice(0, SEARCHED).flatMap(dir => exts.map(ext => joinPath(dir, `${name}${ext}`))));
    return homeOnly(binary, env) ? candidates.filter(candidate => underHome(candidate, home, platform)) : candidates;
  }
  const fixed = [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const directories = [...fixed, ...searchPath.split(':').filter(isAbsolute)];
  const candidates = [...new Set(directories)].slice(0, SEARCHED).map(directory => join(directory, binary));
  // Pi installs itself under its own folder (CD §3): a config folder alone does not mean a CLI.
  if (binary === 'pi') candidates.push(join(home, '.pi/agent/bin/pi'));
  // OpenCode's own installer puts it here and adds this folder to the front of the terminal's PATH (seen on a Mac with a
  // Homebrew copy too: the terminal ran this one), so it is looked at first.
  if (binary === 'opencode') candidates.unshift(join(home, '.opencode/bin/opencode'));
  // Antigravity's CLI is `agy` by its docs; an install seen on Linux (1.5.14) names it `antigravity`. Both are looked for, `agy` first.
  if (binary === 'agy') candidates.push(...candidates.map(candidate => join(dirname(candidate), 'antigravity')));
  return homeOnly(binary, env) ? candidates.filter(candidate => candidate.startsWith(`${home}${sep}`)) : candidates;
}

const PATH_MARK = '__central_knot_path__';

/**
 * The PATH the person's terminal has, asked of their login shell: its startup files add the folders that nvm, npm's own
 * prefix, bun, mise and the like install CLIs into, which an app opened from Finder or a launcher never sees. Read between
 * two marks, since startup files may print anything. Undefined on Windows (every app gets the whole PATH there), with
 * no usable shell, or when the shell doesn't answer in time.
 */
export function shellPath(shell = process.env.SHELL || userInfo().shell || '', timeoutMs = 4000): Promise<string | undefined> {
  if (process.platform === 'win32' || !isAbsolute(shell)) return Promise.resolve(undefined);
  return new Promise(done => {
    // Interactive and login, so both kinds of startup file are read; the two settings keep oh-my-zsh from asking to update or starting tmux.
    const child = execFile(shell, ['-ilc', `printf '%s%s%s' ${PATH_MARK} "$PATH" ${PATH_MARK}`],
      { env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTART: 'false' }, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (_error, stdout) => done(String(stdout).split(PATH_MARK)[1] || undefined));
    child.stdin?.end();
  });
}

let searched: Promise<string> | undefined;
/**
 * Where CLIs are looked for: this app's own PATH, then the folders only the person's terminal has. Asked once per run
 * (a shell's startup can take a second); every search for a CLI uses this one answer.
 */
export const searchPath = (): Promise<string> =>
  (searched ??= shellPath().then(fromShell => [process.env.PATH, fromShell].filter(Boolean).join(delimiter)));

/**
 * Whether this Linux desktop has a system tray: Electron's tray icon there is a StatusNotifierItem, which shows only where
 * something holds org.kde.StatusNotifierWatcher on the session bus (KDE's panel does; GNOME only with its AppIndicator extension).
 * Asked with dbus-send, found on PATH, where a test puts its stand-in. No answer (no bus, no dbus-send, none in time) is no tray.
 */
export function hasStatusNotifierWatcher(dbusSend = 'dbus-send', timeoutMs = 2000): Promise<boolean> {
  const asked = ['/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', 'string:org.kde.StatusNotifierWatcher'];
  return new Promise(done => execFile(dbusSend, ['--session', '--print-reply', '--dest=org.freedesktop.DBus', ...asked],
    { timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8' }, (error, stdout) => done(!error && /\bboolean true\b/.test(stdout))));
}
/** How many times a start at sign-in asks for the system tray, and how far apart, before it decides there is none (main.ts makeTray). */
export const TRAY_ASKS = 10, TRAY_PAUSE_MS = 1000;
/** Whether this desktop has a system tray, asked up to `asks` times, `pauseMs` apart, until one ask says it has. */
export async function trayWithin(asks: number, pauseMs = TRAY_PAUSE_MS, dbusSend?: string): Promise<boolean> {
  for (let ask = 1; !(await hasStatusNotifierWatcher(dbusSend)); ask++) {
    if (ask >= asks) return false;
    await wait(pauseMs);
  }
  return true;
}

/**
 * Where a tool's desktop app may be, where the version of the tool it carries is written, and where that copy of the tool
 * is (CD §2): Claude desktop keeps each Code tab build in a folder named by its version (`<version>/<build>/<binary>`),
 * the GitHub Copilot app names its runtime's version in a file and, when it first runs, unpacks that runtime, a whole
 * Copilot CLI, into the user's caches by that version, and ChatGPT desktop carries a Codex that answers --version. The app is found,
 * never run, and never counts as the CLI (CD §3); its copy of the tool runs plugin commands only when there is no CLI
 * (PLG-04). A candidate names that copy's binary only where its plugin commands were run in a disposable home on that
 * platform (capability-data §3); elsewhere it gives the version alone. `app` is the app's folder, or with `alias` the
 * folder of app execution aliases a Windows (MSIX) package installs in the user's profile, whose links name the package's
 * folder: Windows doesn't let an ordinary user list the folder packages are installed in. `file` and a lone `binary` are
 * inside the app's folder; `versionFile` too, an Info.plist or an Electron app's app.asar.
 */
export interface AppCandidate {
  name: string; app: string; alias?: true; versionFile?: string; carries: string;
  /** Where the tool the app carries is. Left out for an app that only reads the tool's files (pi-gui): it has a version of its own and no copy of the tool to name. */
  carried?: { folders: string; binary?: string } | { file: string; runtimes?: string; binary?: string } | { binary: string };
}

/**
 * Where this Mac's apps are, for every look at them (a tool's desktop app, the apps beside the tools, another build of Central
 * Knot: otherbuilds.ts) and the one thing ever removed from them (otherbuilds.ts removeBuild): the person's own Applications
 * folder, then the computer's; the program that says which apps are running (macOS's lsappinfo); and the Trash, unset for the
 * account's own (Electron's shell.trashItem, in main.ts). A test names a folder of its own in CK_TEST_APPS, which stands in for
 * /Applications, the running apps and the Trash (its Applications, lsappinfo and Trash), so no test looks at or changes the
 * real ones; ~/Applications is then the test's throwaway HOME's. tests/macstandins.ts makes one.
 */
export interface MacPlaces { applications: string[]; lsappinfo: string; trash?: string }
export function macPlaces(home: string, env: NodeJS.ProcessEnv = process.env): MacPlaces {
  const test = env.CK_TEST_APPS;
  if (test) return { applications: [join(home, 'Applications'), join(test, 'Applications')], lsappinfo: join(test, 'lsappinfo'), trash: join(test, 'Trash') };
  return { applications: [join(home, 'Applications'), '/Applications'], lsappinfo: '/usr/bin/lsappinfo' };
}

export function appCandidates(home: string, binary: string, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): AppCandidate[] {
  const where = macPlaces(home, env).applications;
  const local = winFolder(env, 'LOCALAPPDATA', joinPath(home, 'AppData', 'Local'));
  const aliases = (family: string) => joinPath(local, 'Microsoft', 'WindowsApps', family);
  const programFiles = winFolder(env, 'ProgramFiles', 'C:\\Program Files');
  const mac: Record<string, AppCandidate[]> = {
    claude: where.map(apps => ({ name: 'Claude desktop', app: join(apps, 'Claude.app'), carries: 'Code tab', carried: { folders: join(home, 'Library/Application Support/Claude/claude-code'), binary: 'claude.app/Contents/MacOS/claude' } })),
    copilot: where.map(apps => ({ name: 'GitHub Copilot app', app: join(apps, 'GitHub Copilot.app'), carries: 'Copilot runtime', carried: { file: 'Contents/Resources/copilot-sdk/cliVersion.d.ts', runtimes: join(home, 'Library/Caches/github-copilot-sdk/cli'), binary: 'copilot' } })),
    codex: where.map(apps => ({ name: 'ChatGPT desktop', app: join(apps, 'ChatGPT.app'), carries: 'Codex', carried: { binary: 'Contents/Resources/codex-cli/bin/codex' } })),
    // OpenCode desktop 2.2.5 names the OpenCode it carries in a file beside it. That copy is never run from here: an OpenCode
    // of the newer line started on a fresh data folder stops an older CLI from working (measured, capability-data §8).
    // pi-gui is a third-party desktop app for Pi (no official one is established): it uses Pi's own files through Pi's SDK.
    pi: where.map(apps => ({ name: 'pi-gui (third-party)', app: join(apps, 'pi-gui.app'), carries: 'Pi' })),
    opencode: where.map(apps => ({ name: 'OpenCode desktop', app: join(apps, 'OpenCode.app'), carries: 'OpenCode', carried: { file: 'Contents/Resources/opencode-cli.version' } })),
    // Antigravity's desktop app, then its editor: either is Antigravity here, read for its own version only (where each keeps
    // the CLI it may carry is not known). Where they install on Linux is not known either.
    agy: [['Antigravity desktop', 'Antigravity.app'], ['Antigravity IDE', 'Antigravity IDE.app']].flatMap(([name, app]) => where.map(apps => ({ name, app: join(apps, app), carries: 'Antigravity' }))),
  };
  const own: Record<string, Record<string, AppCandidate[]>> = {
    win32: {
      claude: [{ name: 'Claude desktop', app: aliases('Claude_pzs8sxrjxfjjc'), alias: true, versionFile: 'app/resources/app.asar', carries: 'Code tab', carried: { folders: joinPath(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc', 'claude-code'), binary: 'claude.exe' } }],
      // The setup program installs for one person under Programs; the .msi for everyone under Program Files.
      copilot: [joinPath(local, 'Programs', 'GitHub Copilot'), joinPath(programFiles, 'GitHub Copilot')].map(app => ({ name: 'GitHub Copilot app', app, carries: 'Copilot runtime', carried: { file: 'copilot-sdk/cliVersion.d.ts', runtimes: joinPath(local, 'github-copilot-sdk', 'cli'), binary: 'copilot.exe' } })),
      codex: [{ name: 'ChatGPT desktop', app: aliases('OpenAI.Codex_2p2nqsd0c76g0'), alias: true, versionFile: 'app/resources/app.asar', carries: 'Codex', carried: { binary: 'app/resources/codex.exe' } }],
      // Per-user electron-builder NSIS install measured on Windows 11.
      pi: [{ name: 'pi-gui (third-party)', app: joinPath(local, 'Programs', '@pi-guidesktop'), versionFile: 'resources/app.asar', carries: 'Pi' }],
    },
    linux: {
      claude: [{ name: 'Claude desktop', app: '/usr/lib/claude-desktop', versionFile: 'resources/app.asar', carries: 'Code tab', carried: { folders: join(home, '.config/Claude/claude-code') } }],
      copilot: [{ name: 'GitHub Copilot app', app: '/usr/lib/GitHub Copilot', carries: 'Copilot runtime', carried: { file: 'copilot-sdk/cliVersion.d.ts', runtimes: join(home, '.cache/github-copilot-sdk/cli'), binary: 'copilot' } }],
      codex: ['/usr/lib/chatgpt', join(home, '.local/opt/chatgpt')].map(app => ({ name: 'ChatGPT desktop', app, versionFile: 'resources/app.asar', carries: 'Codex', carried: { binary: 'resources/codex' } })),
    },
  };
  // The macOS places stay last everywhere: harmless where they can't exist, and the Linux e2e stands in an app there.
  return [...(own[platform]?.[binary] ?? []), ...(mac[binary] ?? [])].filter(candidate => !homeOnly(binary, env) || underHome(candidate.app, home, platform));
}

/**
 * Apps that are no tool of their own here, but run the tools or read their files (SPEC 5.1, D-24): looked for on this
 * computer, never run, and named on Harnesses only when found. `says`: what that means for what Central Knot sets up.
 */
export function otherAppCandidates(home: string, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): { name: string; says: string; apps: AppCandidate[] }[] {
  const places = (name: string, bundles: string[]) => macPlaces(home, env).applications.flatMap(apps => bundles.map(bundle => ({ name, app: join(apps, bundle), carries: '' })));
  // Measured on Windows 11 (electron-builder NSIS per-user install); VS Code's Windows places are not yet measured.
  const t3Win = platform === 'win32' ? [{ name: 'T3 Code', app: joinPath(winFolder(env, 'LOCALAPPDATA', joinPath(home, 'AppData', 'Local')), 'Programs', 't3code'), versionFile: 'resources/app.asar', carries: '' }] : [];
  return [
    { name: 'T3 Code', says: 'Runs your tools for you. One it starts with this computer’s home uses what is set up here.', apps: [...t3Win, ...places('T3 Code', ['T3 Code.app', 'T3 Code (Nightly).app', 'T3 Code (Alpha).app'])] },
    { name: 'VS Code', says: 'Its built-in Copilot lists skills from some of your tools’ folders. Central Knot doesn’t change VS Code’s own settings.', apps: places('VS Code', ['Visual Studio Code.app', 'Visual Studio Code - Insiders.app']) },
  ];
}

import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path';

/**
 * PATH for running a CLI: its own folder first. An app opened from Finder or a launcher gets a short PATH, and a CLI that
 * is a script (Codex and Copilot CLI from npm run on Node) finds its interpreter beside itself.
 */
export const pathBeside = (binary: string) => [dirname(binary), process.env.PATH].filter(Boolean).join(delimiter);

/**
 * Tools an end-to-end run looks for only inside its throwaway home (CK_TEST_HOME_ONLY: their binaries' names, with commas):
 * what the machine running the checks has installed must not change what they see.
 */
const homeOnly = (binary: string) => (process.env.CK_TEST_HOME_ONLY ?? '').split(',').includes(binary);

/** How many folders are searched for a CLI: a terminal's PATH is a few dozen at most. */
const SEARCHED = 40;

export function executableCandidates(home: string, searchPath: string, binary = 'claude'): string[] {
  const fixed = [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const directories = [...fixed, ...searchPath.split(':').filter(isAbsolute)];
  const candidates = [...new Set(directories)].slice(0, SEARCHED).map(directory => join(directory, binary));
  // Pi installs itself under its own folder (CD §3): a config folder alone does not mean a CLI.
  if (binary === 'pi') candidates.push(join(home, '.pi/agent/bin/pi'));
  // OpenCode's own installer puts it here and adds this folder to the front of the terminal's PATH (seen on a Mac with a
  // Homebrew copy too: the terminal ran this one), so it is looked at first.
  if (binary === 'opencode') candidates.unshift(join(home, '.opencode/bin/opencode'));
  return homeOnly(binary) ? candidates.filter(candidate => candidate.startsWith(`${home}${sep}`)) : candidates;
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
  (searched ??= shellPath().then(fromShell => [process.env.PATH, fromShell].filter(Boolean).join(':')));

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
  carried: { folders: string; binary?: string } | { file: string; runtimes?: string; binary?: string } | { binary: string };
}

export function appCandidates(home: string, binary: string, platform: string = process.platform): AppCandidate[] {
  const where = [join(home, 'Applications'), '/Applications'];
  const local = join(home, 'AppData', 'Local');
  const aliases = (family: string) => join(local, 'Microsoft', 'WindowsApps', family);
  const mac: Record<string, AppCandidate[]> = {
    claude: where.map(apps => ({ name: 'Claude desktop', app: join(apps, 'Claude.app'), carries: 'Code tab', carried: { folders: join(home, 'Library/Application Support/Claude/claude-code'), binary: 'claude.app/Contents/MacOS/claude' } })),
    copilot: where.map(apps => ({ name: 'GitHub Copilot app', app: join(apps, 'GitHub Copilot.app'), carries: 'Copilot runtime', carried: { file: 'Contents/Resources/copilot-sdk/cliVersion.d.ts', runtimes: join(home, 'Library/Caches/github-copilot-sdk/cli'), binary: 'copilot' } })),
    codex: where.map(apps => ({ name: 'ChatGPT desktop', app: join(apps, 'ChatGPT.app'), carries: 'Codex', carried: { binary: 'Contents/Resources/codex-cli/bin/codex' } })),
    // OpenCode desktop 2.2.5 names the OpenCode it carries in a file beside it. That copy is never run from here: an OpenCode
    // of the newer line started on a fresh data folder stops an older CLI from working (measured, capability-data §8).
    opencode: where.map(apps => ({ name: 'OpenCode desktop', app: join(apps, 'OpenCode.app'), carries: 'OpenCode', carried: { file: 'Contents/Resources/opencode-cli.version' } })),
  };
  const own: Record<string, Record<string, AppCandidate[]>> = {
    win32: {
      claude: [{ name: 'Claude desktop', app: aliases('Claude_pzs8sxrjxfjjc'), alias: true, versionFile: 'app/resources/app.asar', carries: 'Code tab', carried: { folders: join(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc', 'claude-code'), binary: 'claude.exe' } }],
      // The setup program installs for one person under Programs; the .msi for everyone under Program Files.
      copilot: [join(local, 'Programs', 'GitHub Copilot'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub Copilot')].map(app => ({ name: 'GitHub Copilot app', app, carries: 'Copilot runtime', carried: { file: 'copilot-sdk/cliVersion.d.ts', runtimes: join(local, 'github-copilot-sdk', 'cli'), binary: 'copilot.exe' } })),
      codex: [{ name: 'ChatGPT desktop', app: aliases('OpenAI.Codex_2p2nqsd0c76g0'), alias: true, versionFile: 'app/resources/app.asar', carries: 'Codex', carried: { binary: 'app/resources/codex.exe' } }],
    },
    linux: {
      claude: [{ name: 'Claude desktop', app: '/usr/lib/claude-desktop', versionFile: 'resources/app.asar', carries: 'Code tab', carried: { folders: join(home, '.config/Claude/claude-code') } }],
      copilot: [{ name: 'GitHub Copilot app', app: '/usr/lib/GitHub Copilot', carries: 'Copilot runtime', carried: { file: 'copilot-sdk/cliVersion.d.ts', runtimes: join(home, '.cache/github-copilot-sdk/cli'), binary: 'copilot' } }],
      codex: ['/usr/lib/chatgpt', join(home, '.local/opt/chatgpt')].map(app => ({ name: 'ChatGPT desktop', app, versionFile: 'resources/app.asar', carries: 'Codex', carried: { binary: 'resources/codex' } })),
    },
  };
  // The macOS places stay last everywhere: harmless where they can't exist, and the Linux e2e stands in an app there.
  return [...(own[platform]?.[binary] ?? []), ...(mac[binary] ?? [])].filter(candidate => !homeOnly(binary) || candidate.app.startsWith(`${home}${sep}`));
}

/**
 * A Claude Code process by its full command line, for `pgrep -f` (an extended regular expression), beside `pgrep -x claude`
 * for the CLI's own binary: Claude Code run through node (a global npm install runs `node …/bin/claude`; a shell or search
 * that merely mentions the package doesn't count), the Code tab's own copy that Claude desktop keeps by version, and
 * Claude desktop itself, which starts Code tab sessions while it is open.
 */
export const CLAUDE_PROCESS = '^[^ ]*node .*(@anthropic-ai/claude-code/|/bin/claude( |$))|/claude-code/[^/]+/[^/]+/claude\\.app/Contents/MacOS/claude( |$)|/Claude\\.app/Contents/MacOS/Claude( |$)';

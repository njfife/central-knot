import { delimiter, dirname, isAbsolute, join } from 'node:path';

/**
 * PATH for running a CLI: its own folder first. An app opened from Finder or a launcher gets a short PATH, and a CLI that
 * is a script (Codex and Copilot CLI from npm run on Node) finds its interpreter beside itself.
 */
export const pathBeside = (binary: string) => [dirname(binary), process.env.PATH].filter(Boolean).join(delimiter);

export function executableCandidates(home: string, searchPath: string, binary = 'claude'): string[] {
  const fixed = [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const directories = [...fixed, ...searchPath.split(':').filter(isAbsolute)];
  const candidates = [...new Set(directories)].slice(0, 12).map(directory => join(directory, binary));
  // Pi installs itself under its own folder (CD §3): a config folder alone does not mean a CLI.
  if (binary === 'pi') candidates.push(join(home, '.pi/agent/bin/pi'));
  return candidates;
}

/**
 * Where a tool's desktop app may be, and where the version of the tool it carries is written (CD §2): Claude desktop keeps
 * each Code tab build in a folder named by its version, the GitHub Copilot app names its runtime's version in a file, and
 * ChatGPT desktop carries a Codex that answers --version. The app is found, never run, and never counts as the CLI (CD §3).
 */
export interface AppCandidate { name: string; app: string; carries: string; carried: { folders: string } | { file: string } | { binary: string } }

export function appCandidates(home: string, binary: string): AppCandidate[] {
  const where = [join(home, 'Applications'), '/Applications'];
  if (binary === 'claude') return where.map(apps => ({ name: 'Claude desktop', app: join(apps, 'Claude.app'), carries: 'Code tab', carried: { folders: join(home, 'Library/Application Support/Claude/claude-code') } }));
  if (binary === 'copilot') return where.map(apps => ({ name: 'GitHub Copilot app', app: join(apps, 'GitHub Copilot.app'), carries: 'Copilot runtime', carried: { file: join(apps, 'GitHub Copilot.app/Contents/Resources/copilot-sdk/cliVersion.d.ts') } }));
  if (binary === 'codex') return where.map(apps => ({ name: 'ChatGPT desktop', app: join(apps, 'ChatGPT.app'), carries: 'Codex', carried: { binary: join(apps, 'ChatGPT.app/Contents/Resources/codex-cli/bin/codex') } }));
  return [];
}

/**
 * A Claude Code process by its full command line, for `pgrep -f` (an extended regular expression), beside `pgrep -x claude`
 * for the CLI's own binary: Claude Code run through node (a global npm install runs `node …/bin/claude`; a shell or search
 * that merely mentions the package doesn't count), the Code tab's own copy that Claude desktop keeps by version, and
 * Claude desktop itself, which starts Code tab sessions while it is open.
 */
export const CLAUDE_PROCESS = '^[^ ]*node .*(@anthropic-ai/claude-code/|/bin/claude( |$))|/claude-code/[^/]+/[^/]+/claude\\.app/Contents/MacOS/claude( |$)|/Claude\\.app/Contents/MacOS/Claude( |$)';

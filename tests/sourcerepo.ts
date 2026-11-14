// Made-up Git repositories standing in for a source's link, so no test reaches the network: this process's git is told, by
// its own url.<base>.insteadOf (GIT_CONFIG_* in the environment, which plugins.ts gitEnv passes on), to fetch
// https://github.com/<path> and https://gitlab.example.com/<path> from folders under `base`. Shared by tests/sources.test.ts
// and the seeded walk (tests/librarywalk.test.ts); scripts/e2e.mjs and scripts/ui-tour.mjs give the app the same.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The hosts a link may name in a test, each standing in for a folder under `base`. */
export const HOSTS = ['https://github.com/', 'https://gitlab.example.com/'] as const;

/** Sends this process's git for HOSTS to folders under a new temp folder; returns that folder and a cleanup. */
export async function standInHosts(): Promise<{ base: string; cleanup: () => Promise<void> }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-hosts-')));
  HOSTS.forEach((host, index) => {
    process.env[`GIT_CONFIG_KEY_${index}`] = `url.file://${join(base, new URL(host).hostname)}/.insteadOf`;
    process.env[`GIT_CONFIG_VALUE_${index}`] = host;
  });
  process.env.GIT_CONFIG_COUNT = String(HOSTS.length);
  return { base, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const git = (dir: string, args: string[], when?: string) => execFileSync('git', ['-C', dir, '-c', 'user.name=Tester', '-c', 'user.email=tester@example.com', '-c', 'commit.gpgsign=false', ...args],
  { encoding: 'utf8', env: { ...process.env, ...(when ? { GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when } : {}) } }).trim();

/** One repository at a stand-in host: `link` is its web address (https://github.com/owner/name), as a person would paste it. */
export async function repository(hosts: { base: string }, link: string, branch = 'main') {
  const url = new URL(link), dir = join(hosts.base, url.hostname, `${url.pathname.replace(/^\/|\/$/g, '')}.git`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  execFileSync('git', ['init', '--quiet', `--initial-branch=${branch}`, dir]);
  return {
    dir,
    /** Writes files (path → text; null removes it) and commits them, at `when` (the commit's time: the source's time). */
    commit: async (files: Record<string, string | null>, when = new Date().toISOString(), message = 'change') => {
      for (const [path, text] of Object.entries(files)) {
        if (text === null) await rm(join(dir, path), { recursive: true, force: true });
        else { await mkdir(join(dir, path, '..'), { recursive: true }); await writeFile(join(dir, path), text); }
      }
      git(dir, ['add', '--all']);
      git(dir, ['commit', '--quiet', '--allow-empty', '-m', message], when);
      return git(dir, ['rev-parse', 'HEAD']);
    },
    /** Makes a branch here (from the current commit) and switches to it, or switches back to one. */
    branch: (name: string, make = true) => git(dir, ['checkout', '--quiet', ...(make ? ['-b'] : []), name]),
    git: (...args: string[]) => git(dir, args),
  };
}

/** A SKILL.md for a test skill. */
export const skillMd = (name: string, body = `The ${name} skill.`) => `---\nname: ${name}\ndescription: ${name} for tests.\n---\n\n${body}\n`;

/** The owner's example, https://github.com/stephenturner/skill-deslop: its root is one skill, deslop, with four reference files beside a README, a licence and a .gitignore. */
export const deslopFiles = (body = 'Remove slop from prose.'): Record<string, string> => ({
  'SKILL.md': skillMd('deslop', body),
  'references/phrases.md': '# Phrases\n\nOverused phrases.\n',
  'references/structures.md': '# Structures\n\nOverused structures.\n',
  'references/examples.md': '# Examples\n\nBefore and after.\n',
  'references/checklist.md': '# Checklist\n\nWhat to look for.\n',
  'README.md': '# skill-deslop\n\nA skill.\n',
  'LICENSE': 'MIT License\n',
  '.gitignore': '.DS_Store\n',
});

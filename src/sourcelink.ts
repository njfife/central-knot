// A link given as a source (sources.ts), read without the network: what repository it names, and the text after GitHub's
// `/tree/` or GitLab's `/-/tree/` (or `/blob/`, a file's link, read as the folder that holds the file) that says a branch or
// tag and a folder in it. A branch name may hold a slash, so that text
// is split only once the repository's own branches and tags are known (splitRef, given what `git ls-remote` lists); this
// module never guesses it. Also the short way a page names a source (linkLabel). Pure: no Node, so the page uses it too.
import { githubRepo } from './values.ts';

/**
 * A link as read: the address git fetches (`repository`), and `rest`, the branch or tag and the folder after `/tree/`, still
 * to be split by splitRef (absent: the repository's default branch, its root folder). Or why it is no link Central Knot reads.
 */
export type ReadLink = { repository: string; rest?: string[] } | { refused: string };

const NOT_A_LINK = 'That isn’t a link Central Knot can read. Paste a GitHub or GitLab link to a repository, a branch, a folder or a SKILL.md in one (github.com/owner/repo works without https://), or give owner/repo, or an address you would give git clone.';

/**
 * Reads a link as the person gave it: `owner/repo`; an https address of a repository, `https://` left out or not; a pasted web
 * link to a branch or a folder (GitHub's `…/<owner>/<repo>/tree/<branch>/<path>`, GitLab's `…/<group>/<repo>/-/tree/<branch>/<path>`,
 * on any host), or to a file in one (`/blob/` for `/tree/`), read as the folder that holds it; or an ssh address (`git@host:path`,
 * `ssh://…`), taken as it is.
 */
export function readLink(text: string): ReadLink {
  const link = text.trim();
  if (!link) return { refused: 'Paste a link first.' };
  // An option-looking value would reach git as a flag.
  if (link.startsWith('-') || /\s/.test(link)) return { refused: NOT_A_LINK };
  // A first part with a dot is a host (github.com/owner/repo), never a GitHub owner, whose names have none.
  const hostFirst = /^[\w-]+(\.[\w-]+)+\/\S/.test(link), repo = hostFirst ? undefined : githubRepo(link);
  if (repo) return { repository: `https://github.com/${repo}.git` };
  if (/^[\w.-]+@[\w.-]+:\S+$/.test(link) || /^(ssh|git):\/\//.test(link)) return { repository: link };
  let url: URL;
  // A host and a path with no scheme (github.com/owner/repo) is the https address it plainly is.
  try { url = new URL(hostFirst ? `https://${link}` : link); } catch { return { refused: NOT_A_LINK }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { refused: NOT_A_LINK };
  const parts = url.pathname.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  const origin = `${url.protocol}//${url.host}`;
  const repository = (path: string[]) => `${origin}/${path.join('/').replace(/\.git$/, '')}.git`;
  // A file's link (`blob`) is read as its folder's: the branch, then the path without the file's own name.
  const at = (from: number) => (parts[from] === 'blob' ? parts.slice(from + 1, -1) : parts.slice(from + 1));
  const named = (kind: string | undefined) => kind === 'tree' || kind === 'blob';
  // GitLab: the repository is everything before `/-/`, which may be a group of groups.
  const dash = parts.indexOf('-');
  if (dash >= 2 && named(parts[dash + 1])) return at(dash + 1).length ? { repository: repository(parts.slice(0, dash)), rest: at(dash + 1) } : { refused: NOT_A_LINK };
  if (dash >= 2) return { refused: 'That link is to a page of the repository, not to a branch, a folder or a file. Paste the repository’s link, or a folder’s.' };
  // GitHub and its likes: owner, repository, then `tree` or `blob`.
  if (named(parts[2])) return at(2).length ? { repository: repository(parts.slice(0, 2)), rest: at(2) } : { refused: NOT_A_LINK };
  if (url.hostname === 'github.com' && parts.length !== 2) return { refused: 'That GitHub link is to a page of the repository, not to a branch, a folder or a file. Paste the repository’s link, or a folder’s.' };
  if (parts.length < 2) return { refused: NOT_A_LINK };
  return { repository: repository(parts) };
}

/**
 * The branch or tag and the folder in `rest` (readLink's), given the names the repository has (branches and tags): the longest
 * name that `rest` starts with, whole parts only (`feature/x/skills/notes` with a branch `feature/x` is that branch, folder
 * `skills/notes`). Undefined when it starts with none of them.
 */
export function splitRef(rest: readonly string[], refs: readonly string[]): { ref: string; folder: string } | undefined {
  const names = new Set(refs);
  for (let at = rest.length; at > 0; at--) {
    const ref = rest.slice(0, at).join('/');
    if (names.has(ref)) return { ref, folder: rest.slice(at).join('/') };
  }
  return undefined;
}

/**
 * A source's link as a page says it, short: the host and the repository's path, without `https://` or `.git`, then what the
 * link named after `/tree/` (its branch, and a folder), as it was given (`github.com/stephenturner/skill-deslop (main)`,
 * `gitlab.example.com/team/skills (main/notes)`). Where the branch ends is not known without the repository, so it is not
 * split here. The link as given is its tooltip.
 */
export function linkLabel(link: string): string {
  const read = readLink(link);
  if ('refused' in read) return link;
  const where = read.repository.replace(/^[a-z]+:\/\/(?:[^@/]+@)?/, '').replace(/^[^@/]+@([^:]+):/, '$1/').replace(/\.git$/, '');
  return read.rest ? `${where} (${read.rest.join('/')})` : where;
}

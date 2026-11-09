// Small checks on values whose shape isn't trusted: JSON from a marketplace.json, a plugin.json or a tool's settings, and
// sources or links a person or a catalog gave. Each returns a safe default instead of throwing. No Node imports, so the
// renderer can use them too.

/** A string, or '' for anything else. */
export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A list of strings from one string or an array of them; undefined when it is neither. */
export const strings = (value: unknown): string[] | undefined => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);

/** A plain object (not null, not an array), or undefined. */
export const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

/** "owner/repo" for a GitHub repository written as owner/repo or its https URL (with or without .git); else undefined. */
export function githubRepo(source: string): string | undefined {
  const trimmed = source.trim();
  // "./market" and "../market" are relative folders, never a GitHub owner.
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed) && !/^\.\.?\//.test(trimmed)) return trimmed;
  return /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(trimmed)?.[1];
}

/** Text without a leading byte-order mark (Windows editors add one; JSON.parse refuses it). */
export const withoutBom = (text: string) => text.replace(/^\uFEFF/, '');

/** The items of `value` (a list from a request or a file) that are among `allowed`, in their order; [] for anything else. */
export const onlyAllowed = <T extends string>(value: unknown, allowed: readonly T[]): T[] => (Array.isArray(value) ? value.filter((item): item is T => allowed.includes(item as T)) : []);

/** True for an https link with no spaces: the only kind Central Knot opens or reads a repository from. */
export const isHttps = (value: unknown): value is string => typeof value === 'string' && /^https:\/\/\S+$/.test(value);

/** True when a marketplace source names a folder on this computer (an absolute path), not a URL or owner/repo. */
export const isFolder = (source: string) => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(source.trim());

/** A marketplace, plugin or skill name the tools accept, that can't be read as an option: letters, digits, dot, dash, underscore. */
export const SAFE_NAME = /^[\w][\w.-]{0,199}$/;

/** Orders two versions: as semantic versions when both are (pre-releases by semver's rules), otherwise as text (as Codex orders its cached plugin versions). */
export function compareVersions(first: string, second: string): number {
  const parse = (text: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  const [a, b] = [parse(first), parse(second)];
  if (!a || !b) return first < second ? -1 : first > second ? 1 : 0;
  for (const part of [1, 2, 3]) { const diff = Number(a[part]) - Number(b[part]); if (diff) return diff; }
  // A pre-release comes before its release; pre-releases compare part by part, numbers as numbers and below words.
  if (a[4] === b[4]) return 0;
  if (!a[4] || !b[4]) return a[4] ? -1 : 1;
  const [left, right] = [a[4].split('.'), b[4].split('.')];
  for (let at = 0; at < Math.min(left.length, right.length); at++) {
    const [x, y] = [left[at]!, right[at]!];
    if (x === y) continue;
    const [xn, yn] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

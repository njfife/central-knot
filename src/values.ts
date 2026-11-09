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

/** Whether a name is a Git commit hash or a prefix of one (7 to 40 hex digits, at least one a letter, so 20250101 is not). */
export const isCommitHash = (name: string) => /^(?=\d*[a-f])[0-9a-f]{7,40}$/i.test(name);

// Reading values out of JSON whose shape isn't trusted (a marketplace.json, a plugin.json, a tool's settings).
// Each returns a safe default instead of throwing.

/** A string, or '' for anything else. */
export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A list of strings from one string or an array of them; undefined when it is neither. */
export const strings = (value: unknown): string[] | undefined => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);

/** A plain object (not null, not an array), or undefined. */
export const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

/** "owner/repo" for a GitHub repository written as owner/repo or its https URL (with or without .git); else undefined. */
export function githubRepo(source: string): string | undefined {
  const trimmed = source.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return trimmed;
  return /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(trimmed)?.[1];
}

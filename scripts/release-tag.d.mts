export const versionTag: RegExp;
export function releaseTag(facts: { release?: boolean; named?: string; tags?: string[]; changes?: string[] }): string;
export function releaseTagHere(release: boolean, named?: string): string;

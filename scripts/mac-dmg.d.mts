export function buildDmg(build: { bundle: string; dmg: string; name: string; identity?: string; notaryProfile?: string }): void;
export function whileAttached<T>(image: string, mount: string, flags: string[], use: () => T, waitMs?: number): T;

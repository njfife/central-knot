import { isAbsolute, join } from 'node:path';

export function executableCandidates(home: string, searchPath: string, binary = 'claude'): string[] {
  const fixed = [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const directories = [...fixed, ...searchPath.split(':').filter(isAbsolute)];
  return [...new Set(directories)].slice(0, 12).map(directory => join(directory, binary));
}

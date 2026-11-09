import { isAbsolute, join } from 'node:path';

export function executableCandidates(home: string, searchPath: string, binary = 'claude'): string[] {
  const fixed = [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const directories = [...fixed, ...searchPath.split(':').filter(isAbsolute)];
  const candidates = [...new Set(directories)].slice(0, 12).map(directory => join(directory, binary));
  // The ChatGPT desktop app carries its own Codex, so a desktop-only person is still detected.
  // Pi installs itself under its own folder (CD §3): a config folder alone does not mean a CLI.
  if (binary === 'pi') candidates.push(join(home, '.pi/agent/bin/pi'));
  if (binary === 'codex') for (const apps of [join(home, 'Applications'), '/Applications']) candidates.push(join(apps, 'ChatGPT.app/Contents/Resources/codex-cli/bin/codex'));
  return candidates;
}

// Cowork in Claude desktop, as a place plugins install to. Its plugins are Claude Code's own, kept for each signed-in
// account in Claude desktop's data folder: `local-agent-mode-sessions/<account>/<organization>/` holds cowork_plugins/
// (installed_plugins.json, known_marketplaces.json, cache/, marketplaces/) and cowork_settings.json (enabledPlugins).
// Claude Code reads and writes exactly those when it runs with that folder as CLAUDE_CONFIG_DIR and `--cowork`, and
// Claude desktop reads them each time it starts a Cowork session, handing every enabled plugin to the session
// (capability-data section 7: seen on Claude desktop 5.1231.0 with its own Claude Code 2.1.321, macOS).
// Plugins added in Claude itself, from its directory or by upload, are kept in the Claude account, not in these files.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseObject } from './catalogdetail.ts';
import { text } from './values.ts';

/** Claude desktop's data folder in a home. macOS only, like the rest of Cowork here. */
export const claudeDesktopData = (home: string) => join(home, 'Library/Application Support/Claude');

/** An account or organization id as Claude desktop names its folders. Its other folders there (skills-plugin) aren't one. */
const ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const foldersIn = async (path: string) => (await readdir(path, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && ID.test(entry.name)).map(entry => entry.name);

/**
 * The Cowork folder Claude desktop uses in this home, or undefined when Cowork has never run here. One account is the
 * usual case; with several, the account Claude desktop was last signed in to (its config.json's lastKnownAccountUuid)
 * comes first, then the folder changed last.
 */
export async function coworkFolder(home: string): Promise<string | undefined> {
  const data = claudeDesktopData(home);
  const sessions = join(data, 'local-agent-mode-sessions');
  const lastAccount = text((await readFile(join(data, 'config.json'), 'utf8').then(parseObject, () => undefined))?.lastKnownAccountUuid);
  const found: { path: string; last: boolean; changed: number }[] = [];
  for (const account of await foldersIn(sessions)) {
    for (const organization of await foldersIn(join(sessions, account))) {
      const path = join(sessions, account, organization);
      found.push({ path, last: account === lastAccount, changed: (await stat(path).catch(() => undefined))?.mtimeMs ?? 0 });
    }
  }
  return found.sort((first, second) => Number(second.last) - Number(first.last) || second.changed - first.changed)[0]?.path;
}

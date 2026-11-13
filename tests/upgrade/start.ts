// One start of Central Knot on a home, in a process of its own, so nothing an earlier start kept in memory carries over (a
// library migrated only in memory, a copy first seen missing). It runs what main.ts syncThenView runs, `passes` times:
// homepass.ts homePass, then the three item pages' reads. After each pass it prints every file in the home (its SHA-256, and a
// stamp that changes whenever the file is written, even with the same bytes), what the pass told, the pages as read, and each
// version those pages list that its kind's reader (the one the page and Restore use) can't read.
// tests/upgrade.test.ts runs it:   node tests/upgrade/start.ts <home> <app data folder> <on|off: Automatic sync> <passes>
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentVersion, agentsView } from '../../src/agents.ts';
import { STANDARD_BUILD } from '../../src/bundle.ts';
import { discover } from '../../src/discovery.ts';
import { harnessIds } from '../../src/harnesses.ts';
import { homePass } from '../../src/homepass.ts';
import { serverVersion, serversView } from '../../src/servers.ts';
import { managedNow, type ShareContext } from '../../src/share.ts';
import { skillVersion, skillsView } from '../../src/skills.ts';
import type { LibraryView } from '../../src/types.ts';

/** The app's context for a chosen folder, as main.ts context() makes it, with no tool's folder moved by a variable. */
export function appContext(home: string, appData: string): ShareContext {
  return {
    home, mode: 'custom', build: STANDARD_BUILD, buildName: 'Central Knot', settingsPath: join(appData, 'sharing-settings.json'),
    realHome: join(appData, 'real'), read: () => Promise.all(harnessIds.map(harness => discover({ home, mode: 'custom', harness }))),
  };
}

/** Every file under a folder, by its path from there: its SHA-256, and its inode and modification time (`stamp`). */
export interface Files { sha256: Record<string, string>; stamp: Record<string, string> }

export async function filesIn(folder: string): Promise<Files> {
  const found: Files = { sha256: {}, stamp: {} };
  const entries = (await readdir(folder, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
  for (const path of entries.map(entry => join(entry.parentPath, entry.name)).sort()) {
    const name = relative(folder, path), info = await stat(path);
    found.sha256[name] = createHash('sha256').update(await readFile(path)).digest('hex');
    found.stamp[name] = `${info.ino}:${info.mtimeMs}`;
  }
  return found;
}

/** The three item pages as read, by the page's name for its kind. */
export interface Pages { skills: LibraryView; mcp: LibraryView; agents: LibraryView }
/** After one pass: the home's files, what failed, stopped or crashed (`problems`), the pages, and `unreadable`: `<page> <key> <hash>`. */
export interface AfterPass { files: Files; problems: string[]; pages: Pages; unreadable: string[] }

/** Each version the pages' libraries list whose content its kind's reader can't read. */
async function unreadableVersions(context: ShareContext, pages: Pages): Promise<string[]> {
  const readers = { skills: skillVersion, mcp: serverVersion, agents: agentVersion };
  const missing: string[] = [];
  for (const page of ['skills', 'mcp', 'agents'] as const) {
    for (const item of Object.values(pages[page].library)) {
      for (const { hash } of item.versions) if (!(await readers[page](context, item.key, hash))) missing.push(`${page} ${item.key} ${hash}`);
    }
  }
  return missing;
}

async function start(home: string, appData: string, syncOn: boolean, passes: number): Promise<AfterPass[]> {
  const after: AfterPass[] = [];
  for (let count = 0; count < passes; count++) {
    const context: ShareContext = { ...appContext(home, appData), reads: new Map() };
    const snapshots = await context.read();
    const managed = await managedNow(context, snapshots);
    const { synced, profilesFailed } = await homePass({ ...context, read: async () => snapshots }, managed, syncOn);
    const results = [synced?.skills, synced?.servers, synced?.agents];
    const problems = [
      ...(profilesFailed === undefined ? [] : [`Moving profiles failed: ${String(profilesFailed)}`]),
      ...(synced?.crashes ?? []).map(crash => crash.message),
      ...results.flatMap(result => (result?.stopped ? [result.stopped] : [])),
      ...results.flatMap(result => result?.results ?? []).filter(entry => entry.outcome === 'failed').map(entry => `${entry.item}: ${entry.message}`),
    ];
    const read: ShareContext = { ...appContext(home, appData), reads: new Map() };
    const pages = { skills: await skillsView(read, managed), mcp: await serversView(read, managed), agents: await agentsView(read, managed) };
    after.push({ files: await filesIn(home), problems, pages, unreadable: await unreadableVersions(read, pages) });
  }
  return after;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [home, appData, sync, passes] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(await start(home, appData, sync === 'on', Number(passes))));
}

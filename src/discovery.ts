// One tool in a home, read (discover): its skills as its folders hold them, its CLI and version, and its desktop app; what each
// tool refuses in a skill (copilotProblem, codexProblem, piProblem, opencodeProblem); and the other apps here that start the
// tools or read their files (findOtherApps). Read only: nothing here writes. Which tools are managed is presence.ts's; where
// CLIs and apps are looked for is platform.ts's; the skills on the library are read by skillfiles.ts.
import { constants } from 'node:fs';
import { access, lstat, open, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocument } from 'yaml';
import { configRoot, harnesses, type HarnessDefinition } from './harnesses.ts';
import { appCandidates, executableCandidates, otherAppCandidates, pathBeside, type AppCandidate } from './platform.ts';
import type { DesktopApp, HarnessId, HomeMode, OtherApp, ProbeResult, Skill, Snapshot } from './types.ts';
import { machineNames } from './machine.ts';
import { compareVersions } from './values.ts';

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN';
}

const VERSION = /\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/;

export async function probeVersion(binary: string, timeoutMs = 1500): Promise<ProbeResult> {
  try {
    await access(binary, constants.X_OK);
  } catch (error) {
    return { state: errorCode(error) === 'EACCES' ? 'restricted' : 'missing', detail: 'Executable unavailable.' };
  }
  return new Promise(resolveResult => {
    execFile(binary, ['--version'], {
      cwd: tmpdir(), env: { ...process.env, PATH: pathBeside(binary) }, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024,
      windowsHide: true, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        resolveResult({ state: error.killed ? 'timeout' : 'failed', detail: error.killed ? 'Version probe timed out.' : 'Version probe failed.' });
        return;
      }
      const version = stdout.trim().match(VERSION)?.[0];
      resolveResult(version ? { state: 'ok', version, detail: 'Version only; no session started.' } : { state: 'malformed', detail: 'Version probe returned no recognizable version.' });
    });
  });
}

const runnable = (path: string) => access(path, constants.X_OK).then(() => path, () => undefined);

/** The version in an Electron app's app.asar, from the package.json at its root; read from the archive's header, not unpacked. */
async function asarVersion(path: string): Promise<string | undefined> {
  const archive = await open(path, 'r').catch(() => undefined);
  if (!archive) return undefined;
  try {
    const read = async (length: number, position: number) => { const bytes = Buffer.alloc(length); await archive.read(bytes, 0, length, position); return bytes; };
    const head = await read(16, 0);
    const length = head.readUInt32LE(12);
    if (length > 64 * 1024 * 1024) return undefined;
    const entry = JSON.parse((await read(length, 16)).toString('utf8')).files?.['package.json'];
    if (!entry || entry.unpacked || !(entry.size > 0 && entry.size < 1024 * 1024)) return undefined;
    const version: unknown = JSON.parse((await read(entry.size, 8 + head.readUInt32LE(4) + Number(entry.offset))).toString('utf8')).version;
    return typeof version === 'string' ? version : undefined;
  } catch { return undefined; } finally { await archive.close(); }
}

/** A Windows package's folder, from the folder of app execution aliases it installs: each alias links into it. */
async function packageFolder(aliases: string): Promise<string | undefined> {
  for (const alias of await readdir(aliases).catch(() => [] as string[])) {
    const folder = (await readlink(join(aliases, alias)).catch(() => '')).match(/^(.*[\\/]WindowsApps[\\/][^\\/]+)[\\/]/i)?.[1];
    if (folder) return folder;
  }
  return undefined;
}

/**
 * The first desktop app found among the candidates, with its version, the version of what it carries and that copy's
 * binary, where they can be read. Never runs the app. Claude desktop's copy is the newest Code tab version with a binary
 * in one of its build folders (without a binary to look for, the newest version folder); the Copilot app's is the
 * runtime unpacked for the version it names.
 */
export async function findApp(candidates: AppCandidate[], timeoutMs?: number): Promise<DesktopApp | undefined> {
  for (const candidate of candidates) {
    const app = candidate.alias ? await packageFolder(candidate.app) : candidate.app;
    if (!app) continue;
    try { if (!(await stat(app)).isDirectory()) continue; } catch { continue; }
    const versionFile = join(app, candidate.versionFile ?? 'Contents/Info.plist');
    const version = versionFile.endsWith('.asar') ? await asarVersion(versionFile)
      : (await readFile(versionFile, 'utf8').catch(() => '')).match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim();
    const { carried } = candidate;
    let carriedVersion: string | undefined, binary: string | undefined;
    if (!carried) { /* an app that only reads the tool's files: its own version is all there is */ }
    else if ('folders' in carried) {
      const versions = (await readdir(carried.folders).catch(() => [] as string[])).filter(name => VERSION.exec(name)?.[0] === name).sort((first, second) => compareVersions(second, first));
      carriedVersion = versions[0];
      for (const each of carried.binary ? versions : []) {
        const builds = await readdir(join(carried.folders, each)).catch(() => [] as string[]);
        for (const build of builds.sort()) binary ??= await runnable(join(carried.folders, each, build, carried.binary!));
        if (binary) { carriedVersion = each; break; }
      }
    } else if ('file' in carried) {
      carriedVersion = (await readFile(join(app, carried.file), 'utf8').catch(() => '')).match(VERSION)?.[0];
      // The runtime's folder is named by its version alone (app 1.2.0), or after `copilot-sdk-runtime-` (app 1.1).
      for (const folder of carriedVersion && carried.runtimes && carried.binary ? [carriedVersion, `copilot-sdk-runtime-${carriedVersion}`] : []) binary ??= await runnable(join(carried.runtimes!, folder, carried.binary!));
    } else {
      const copy = join(app, carried.binary);
      carriedVersion = (await probeVersion(copy, timeoutMs)).version;
      if (carriedVersion) binary = copy;
    }
    return { name: candidate.name, ...(version ? { version } : {}), carries: candidate.carries, ...(carriedVersion ? { carriedVersion } : {}), ...(binary ? { binary } : {}) };
  }
  return undefined;
}

/** The apps found here that run the tools or read their files without being one (platform.ts otherAppCandidates), each with its version. */
export async function findOtherApps(home: string): Promise<OtherApp[]> {
  const found: OtherApp[] = [];
  for (const { name, says, apps } of otherAppCandidates(home)) {
    const app = await findApp(apps.map(path => ({ name, app: path, carries: '' })));
    if (app) found.push({ name, says, ...(app.version ? { version: app.version } : {}) });
  }
  return found;
}

/**
 * The binary that runs a tool on this computer: its own CLI, from the same candidate list version probes use (`searchPath`:
 * platform.ts's, the folders the person's terminal looks in); with no CLI,
 * the copy of the tool its desktop app carries (Claude desktop's Code tab, the GitHub Copilot app's runtime, ChatGPT
 * desktop's Codex), with that app. That copy never counts as a CLI install (CD §3).
 */
export async function findBinary(tool: HarnessId, home: string, searchPath: string): Promise<{ binary: string; app?: DesktopApp } | undefined> {
  for (const candidate of executableCandidates(home, searchPath, harnesses[tool].binary)) {
    if (await runnable(candidate)) return { binary: candidate };
  }
  const app = await findApp(appCandidates(home, harnesses[tool].binary));
  return app?.binary ? { binary: app.binary, app } : undefined;
}

const OPENING = /^﻿?---[ \t]*\r?\n/;
const FRONTMATTER = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** The metadata fields, or null when there is no frontmatter. Throws when it cannot be read. */
function frontmatter(content: string): Record<string, unknown> | null {
  if (!OPENING.test(content)) return null;
  const match = content.match(FRONTMATTER);
  if (!match) throw new Error('Unclosed YAML frontmatter.');
  const document = parseDocument(match[1] ?? '', { uniqueKeys: true });
  if (document.errors.length) throw new Error('Malformed YAML frontmatter.');
  const metadata: unknown = document.toJS({ maxAliasCount: 100 });
  if (metadata === null || metadata === undefined) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Frontmatter must be a mapping.');
  return metadata as Record<string, unknown>;
}

/** A Markdown file's `name` and `description` from its frontmatter, trimmed for display; nothing when it has none or it can't be read. Never throws. */
export function nameAndDescription(content: string): { name?: string; description?: string } {
  try {
    const fields = frontmatter(content) ?? {};
    const field = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);
    return { name: field(fields.name), description: field(fields.description) };
  } catch { return {}; }
}

export function parseSkill(content: string, folder: string): Pick<Skill, 'name' | 'description' | 'notes' | 'hasFrontmatter' | 'metadataKeys'> {
  const notes: string[] = [];
  const fields = frontmatter(content);
  if (!fields) return { name: folder, description: '', notes: ['No YAML frontmatter; loadability is not verified.'], hasFrontmatter: false, metadataKeys: [] };
  if (typeof fields.name !== 'string' || !fields.name.trim()) notes.push('Missing name metadata; folder name shown.');
  if (typeof fields.description !== 'string') notes.push('Missing description metadata.');
  return {
    name: typeof fields.name === 'string' && fields.name.trim() ? fields.name : folder,
    description: typeof fields.description === 'string' ? fields.description : '',
    notes,
    hasFrontmatter: true,
    metadataKeys: [
      ...('paths' in fields ? ['paths'] : []),
      ...(fields['user-invocable'] === false ? ['user-invocable: false'] : []),
      ...(fields['disable-model-invocation'] === true ? ['disable-model-invocation: true'] : []),
    ],
  };
}

/** Why each tool would refuse a skill with this SKILL.md in a folder of this name, as the Skill record holds them. */
export const loadProblems = (content: string, folder: string) => ({ copilotProblem: copilotProblem(content, folder), codexProblem: codexProblem(content, folder), piProblem: piProblem(content), opencodeProblem: opencodeProblem(content) });

/** What Copilot CLI 1.0.107 refused when offered each case directly; its rules read the metadata name, or the folder without one. */
export function copilotProblem(content: string, folder: string): string | undefined {
  const fields = frontmatter(content);
  if (!fields) return undefined;
  const name = 'name' in fields ? fields.name : folder;
  if (typeof name !== 'string') return 'its metadata name is not text';
  if (name.length > 64) return 'its name is longer than 64 characters';
  if (!/^[A-Za-z0-9][A-Za-z0-9._: -]*$/.test(name)) return 'its name must start with an ASCII letter or number and use only ASCII letters, numbers and simple separators';
  if ('description' in fields && typeof fields.description !== 'string') return 'its metadata description is not text';
  if (typeof fields.description === 'string' && fields.description.length > 1024) return 'its description is longer than 1024 characters';
  return undefined;
}

/** What Codex 0.142.3 refused when offered each case (skills/list errors): frontmatter is required, a description is required text, a name is at most 64 characters. */
export function codexProblem(content: string, folder: string): string | undefined {
  const fields = frontmatter(content);
  if (!fields) return 'it has no YAML frontmatter';
  if (typeof fields.description !== 'string' || !fields.description.trim()) return 'it has no description text';
  const name = 'name' in fields ? fields.name : folder;
  if (typeof name !== 'string') return 'its metadata name is not text';
  if (name.length > 64) return 'its name is longer than 64 characters';
  return undefined;
}

/** What Pi 1.5.0 drops silently (CD §4): no frontmatter, unreadable YAML, or no description. A missing name uses the folder. */
export function piProblem(content: string): string | undefined {
  let fields: Record<string, unknown> | null;
  try { fields = frontmatter(content); } catch { return 'its YAML frontmatter can’t be read'; }
  if (!fields) return 'it has no YAML frontmatter';
  if (typeof fields.description !== 'string' || !fields.description.trim()) return 'it has no description text';
  return undefined;
}

/**
 * What OpenCode 1.19.5 drops silently (measured): no frontmatter, unreadable YAML, or no name in it. OpenCode 2.2.5 loads a
 * skill with no name; the rule here is the older line's, since a home's OpenCode may be either.
 */
export function opencodeProblem(content: string): string | undefined {
  let fields: Record<string, unknown> | null;
  try { fields = frontmatter(content); } catch { return 'its YAML frontmatter can’t be read'; }
  if (!fields) return 'it has no YAML frontmatter';
  if (typeof fields.name !== 'string' || !fields.name.trim()) return 'its frontmatter has no name';
  return undefined;
}

export async function discover(options: {
  home: string;
  mode: HomeMode;
  harness?: HarnessId;
  configOverride?: string;
  binaries?: string[];
  /** Where the tool's desktop app may be; looked for with the probes. */
  apps?: AppCandidate[];
  runProbes?: boolean;
  timeoutMs?: number;
}): Promise<Snapshot> {
  const definition: HarnessDefinition = harnesses[options.harness ?? 'claude-cli'];
  const home = resolve(options.home);
  const root = configRoot(definition, home, options.configOverride);
  const snapshot: Snapshot = {
    harness: definition.id, harnessName: definition.name, surface: definition.surface,
    mode: options.mode, label: options.mode === 'actual' ? machineNames(process.platform).home : options.mode === 'fixture' ? 'Practice copy' : 'Selected folder',
    root, detection: 'Not found', probe: { state: 'not-run', detail: `System probes run only when you select ${machineNames(process.platform).home}.` },
    discovery: 'missing', skills: [], issues: [],
  };
  if (!isAbsolute(root)) {
    snapshot.discovery = 'failed';
    snapshot.issues.push(`${definition.configEnv} is not absolute; root unknown. No default substituted.`);
    return snapshot;
  }
  let configExists = false;
  try {
    configExists = (await stat(root)).isDirectory();
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      snapshot.discovery = errorCode(error) === 'EACCES' ? 'restricted' : 'failed';
      snapshot.issues.push('Configuration folder could not be read.');
      return snapshot;
    }
  }
  if (configExists) snapshot.detection = 'Config found but app not detected';
  if (options.runProbes) {
    snapshot.probe = { state: 'missing', detail: `No ${definition.binary} executable in the bounded candidate list.` };
    for (const binary of options.binaries ?? []) {
      const probe = await probeVersion(binary, options.timeoutMs);
      if (probe.state === 'missing') continue;
      snapshot.probe = probe;
      snapshot.detection = probe.state === 'restricted' ? snapshot.detection : probe.state === 'ok' ? 'Installed' : 'Version unknown';
      break;
    }
    // The desktop app alone makes the tool present (its files are the same ones the CLI reads), but never counts as the CLI.
    const app = await findApp(options.apps ?? [], options.timeoutMs);
    if (app) {
      snapshot.app = app;
      if (snapshot.detection === 'Not found' || snapshot.detection === 'Config found but app not detected') snapshot.detection = 'App only';
    }
  }
  const seen = new Set<string>();
  const rootResults: Snapshot['discovery'][] = [];
  for (const skillRoot of definition.skillRoots(root, home)) {
    let entries;
    try {
      entries = await readdir(skillRoot.path, { withFileTypes: true });
    } catch (error) {
      const result = errorCode(error) === 'ENOENT' ? 'missing' : errorCode(error) === 'EACCES' ? 'restricted' : 'failed';
      rootResults.push(result);
      if (result !== 'missing') snapshot.issues.push(`${skillRoot.label}: folder could not be read.`);
      continue;
    }
    rootResults.push('empty');
    for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
      if ((entry.name.startsWith('.') && !definition.loadsDotFolders) || definition.reservedSkills.includes(entry.name) || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
      const directory = join(skillRoot.path, entry.name);
      const skillPath = join(directory, 'SKILL.md');
      try {
        const info = await lstat(skillPath);
        if (!info.isFile() && !info.isSymbolicLink()) continue;
        // A link can lead to a pipe or device, and reading one of those never ends.
        const target = await stat(skillPath);
        if (target.isDirectory()) continue;
        if (!target.isFile()) { snapshot.issues.push(`${entry.name}: SKILL.md is not a regular file.`); continue; }
        const content = await readFile(skillPath, 'utf8');
        const metadata = parseSkill(content, entry.name);
        if (entry.isSymbolicLink() || info.isSymbolicLink()) metadata.notes.push('Reached through a user link; read only.');
        if (metadata.name !== entry.name) metadata.notes.push(`Its metadata names it “${metadata.name}”.`);
        if (seen.has(entry.name)) metadata.notes.push(`Also found in another ${definition.name} folder; the harness shows one of them.`);
        seen.add(entry.name);
        snapshot.skills.push({
          folder: entry.name, ...metadata, path: await realpath(skillPath), directory, realDirectory: await realpath(directory),
          rootLabel: skillRoot.label, content, status: 'Not shared', ...loadProblems(content, entry.name),
        });
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue;
        const reason = errorCode(error) === 'EACCES' ? 'Permission restricted.' : error instanceof Error && errorCode(error) === 'UNKNOWN' ? error.message : 'Could not read skill.';
        snapshot.issues.push(`${entry.name}: ${reason}`);
      }
    }
  }
  const worst = rootResults.find(result => result === 'restricted' || result === 'failed');
  if (snapshot.skills.length) snapshot.discovery = 'ready';
  else if (worst) snapshot.discovery = worst;
  else if (rootResults.includes('empty')) snapshot.discovery = 'empty';
  else {
    snapshot.discovery = 'missing';
    snapshot.issues.push('No user-wide skills folder found.');
  }
  return snapshot;
}

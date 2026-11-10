import { constants } from 'node:fs';
import { access, lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocument } from 'yaml';
import { configRoot, harnesses, type HarnessDefinition } from './harnesses.ts';
import { pathBeside, type AppCandidate } from './platform.ts';
import type { DesktopApp, HarnessId, HomeMode, ProbeResult, Skill, Snapshot } from './types.ts';
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

/** The first desktop app found among the candidates, with its version and the version of what it carries, where readable. Never runs the app. */
export async function findApp(candidates: AppCandidate[], timeoutMs?: number): Promise<DesktopApp | undefined> {
  for (const candidate of candidates) {
    try { if (!(await stat(candidate.app)).isDirectory()) continue; } catch { continue; }
    const plist = await readFile(join(candidate.app, 'Contents/Info.plist'), 'utf8').catch(() => '');
    const version = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim();
    const { carried } = candidate;
    let carriedVersion: string | undefined;
    if ('folders' in carried) carriedVersion = (await readdir(carried.folders).catch(() => [] as string[])).filter(name => VERSION.exec(name)?.[0] === name).sort((first, second) => compareVersions(second, first))[0];
    else if ('file' in carried) carriedVersion = (await readFile(carried.file, 'utf8').catch(() => '')).match(VERSION)?.[0];
    else carriedVersion = (await probeVersion(carried.binary, timeoutMs)).version;
    return { name: candidate.name, ...(version ? { version } : {}), carries: candidate.carries, ...(carriedVersion ? { carriedVersion } : {}) };
  }
  return undefined;
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
export const loadProblems = (content: string, folder: string) => ({ copilotProblem: copilotProblem(content, folder), codexProblem: codexProblem(content, folder), piProblem: piProblem(content) });

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

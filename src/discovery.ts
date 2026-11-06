import { constants } from 'node:fs';
import { access, lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocument } from 'yaml';
import type { HomeMode, ProbeResult, Skill, Snapshot } from './types.ts';

export const capability = {
  surface: 'Claude Code CLI',
  kind: 'Standalone skills',
  defaultConfig: '.claude',
  reservedSkill: 'synced',
  testedVersion: '2.1.318',
  evidence: 'CD §§3–4; no session-loading claim',
} as const;

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN';
}

export async function probeVersion(binary: string, timeoutMs = 1500): Promise<ProbeResult> {
  try {
    await access(binary, constants.X_OK);
  } catch (error) {
    return { state: errorCode(error) === 'EACCES' ? 'restricted' : 'missing', detail: 'Executable unavailable.' };
  }
  return new Promise(resolveResult => {
    execFile(binary, ['--version'], {
      cwd: tmpdir(), timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024,
      windowsHide: true, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        resolveResult({ state: error.killed ? 'timeout' : 'failed', detail: error.killed ? 'Version probe timed out.' : 'Version probe failed.' });
        return;
      }
      const version = stdout.trim().match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
      resolveResult(version ? { state: 'ok', version, detail: 'Version only; no session started.' } : { state: 'malformed', detail: 'Version probe returned no recognizable version.' });
    });
  });
}

export function parseSkill(content: string, folder: string): Pick<Skill, 'name' | 'description' | 'notes'> {
  const notes: string[] = [];
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { name: folder, description: '', notes: ['No YAML frontmatter; loadability is not verified.'] };
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('Unclosed YAML frontmatter.');
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error('Malformed YAML frontmatter.');
  const metadata: unknown = document.toJS({ maxAliasCount: 100 });
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Frontmatter must be a mapping.');
  const fields = metadata as Record<string, unknown>;
  if (typeof fields.name !== 'string' || !fields.name.trim()) notes.push('Missing name metadata; folder name shown.');
  if (typeof fields.description !== 'string') notes.push('Missing description metadata.');
  return {
    name: typeof fields.name === 'string' && fields.name.trim() ? fields.name : folder,
    description: typeof fields.description === 'string' ? fields.description : '',
    notes,
  };
}

export async function discover(options: {
  home: string;
  mode: HomeMode;
  configOverride?: string;
  binaries?: string[];
  runProbes?: boolean;
  timeoutMs?: number;
}): Promise<Snapshot> {
  const home = resolve(options.home);
  const root = options.configOverride === undefined ? join(home, capability.defaultConfig) : options.configOverride;
  const snapshot: Snapshot = {
    mode: options.mode, label: options.mode === 'actual' ? "This Mac’s home" : options.mode === 'fixture' ? 'Bundled fixture' : 'Selected folder',
    root, detection: 'Not found', probe: { state: 'not-run', detail: 'System probes run only when you select this Mac’s home.' },
    discovery: 'missing', skills: [], issues: [],
  };
  if (!isAbsolute(root)) {
    snapshot.discovery = 'failed';
    snapshot.issues.push('CLAUDE_CONFIG_DIR is not absolute; root unknown. No default substituted.');
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
    snapshot.probe = { state: 'missing', detail: 'No Claude executable in the bounded candidate list.' };
    for (const binary of options.binaries ?? []) {
      const probe = await probeVersion(binary, options.timeoutMs);
      if (probe.state === 'missing') continue;
      snapshot.probe = probe;
      snapshot.detection = probe.state === 'restricted' ? snapshot.detection : probe.state === 'ok' ? 'Installed' : 'Version unknown';
      break;
    }
  }
  const skillsRoot = join(root, 'skills');
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (error) {
    snapshot.discovery = errorCode(error) === 'ENOENT' ? 'missing' : errorCode(error) === 'EACCES' ? 'restricted' : 'failed';
    snapshot.issues.push(snapshot.discovery === 'missing' ? 'No user-wide skills folder found.' : 'Skills folder could not be read.');
    return snapshot;
  }
  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    if (entry.name.startsWith('.') || entry.name === capability.reservedSkill || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    const skillPath = join(skillsRoot, entry.name, 'SKILL.md');
    try {
      const info = await lstat(skillPath);
      if (!info.isFile() && !info.isSymbolicLink()) continue;
      const content = await readFile(skillPath, 'utf8');
      const metadata = parseSkill(content, entry.name);
      if (entry.isSymbolicLink() || info.isSymbolicLink()) metadata.notes.push('Reached through a user link; read only.');
      snapshot.skills.push({ id: entry.name, ...metadata, path: await realpath(skillPath), content, status: 'Not shared' });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      const reason = errorCode(error) === 'EACCES' ? 'Permission restricted.' : error instanceof Error && errorCode(error) === 'UNKNOWN' ? error.message : 'Could not read skill.';
      snapshot.issues.push(`${entry.name}: ${reason}`);
    }
  }
  snapshot.discovery = snapshot.skills.length ? 'ready' : snapshot.issues.length ? 'failed' : 'empty';
  return snapshot;
}

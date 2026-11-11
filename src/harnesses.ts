import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessId } from './types.ts';

export interface SkillRoot { path: string; label: string }

export interface HarnessDefinition {
  id: HarnessId;
  name: string;
  surface: string;
  binary: string;
  configEnv: string;
  /** The tool's folder inside the one `configEnv` names (OpenCode's `opencode` inside XDG_CONFIG_HOME); without it, `configEnv` names the folder itself. */
  configUnder?: string;
  defaultConfig: string;
  /** Claude Code keeps this skills folder for itself. */
  reservedSkills: string[];
  /** Observed: Claude Code 2.1.309 lists dot-folders as skills; Copilot CLI 1.0.107 and Codex 0.142.3 skip them. */
  loadsDotFolders: boolean;
  /** Other products that read the folder this harness is written through (CD Appendix A). */
  otherReaders: string[];
  /** What its user does to use a copy just written ("Start a new Pi session to use it."). */
  nextStep: string;
  /** Roots this harness loads standalone skills from, its own first. */
  skillRoots(config: string, home: string): SkillRoot[];
}

export const harnesses: Record<HarnessId, HarnessDefinition> = {
  'claude-cli': {
    id: 'claude-cli', name: 'Claude Code', surface: 'CLI', binary: 'claude',
    configEnv: 'CLAUDE_CONFIG_DIR', defaultConfig: '.claude', reservedSkills: ['synced'], loadsDotFolders: true,
    otherReaders: ['Claude desktop (Code tab)', 'OpenCode', 'VS Code'],
    nextStep: 'Start a new Claude Code session (CLI or Claude desktop’s Code tab), or run /reload-skills, to use it.',
    skillRoots: config => [{ path: join(config, 'skills'), label: 'Claude Code skills' }],
  },
  'copilot-cli': {
    id: 'copilot-cli', name: 'GitHub Copilot', surface: 'CLI', binary: 'copilot',
    configEnv: 'COPILOT_HOME', defaultConfig: '.copilot', reservedSkills: [], loadsDotFolders: false,
    otherReaders: ['GitHub Copilot app', 'VS Code'],
    nextStep: 'Start a new Copilot session (CLI or the GitHub Copilot app), or run /skills reload in the CLI, to use it.',
    skillRoots: (config, home) => [
      { path: join(config, 'skills'), label: 'Copilot skills' },
      { path: join(home, '.agents/skills'), label: 'Shared .agents skills' },
    ],
  },
  // Codex reads its own folder and the shared .agents folder (both listed by `codex app-server` skills/list on 0.142.3).
  // It installs its own skills under `.system`, which the dot-folder rule leaves alone. The ChatGPT desktop app reads the same ~/.codex.
  'codex-cli': {
    id: 'codex-cli', name: 'Codex', surface: 'CLI', binary: 'codex',
    configEnv: 'CODEX_HOME', defaultConfig: '.codex', reservedSkills: [], loadsDotFolders: false,
    otherReaders: ['ChatGPT desktop (Codex)'],
    nextStep: 'Start a new Codex session to use it; restart the ChatGPT desktop app if it is open.',
    skillRoots: (config, home) => [
      { path: join(config, 'skills'), label: 'Codex skills' },
      { path: join(home, '.agents/skills'), label: 'Shared .agents skills' },
    ],
  },
  // Pi (CD §2, Appendix A): its own skills folder, plus the shared .agents folder, which it reads as project scope in a non-Git
  // folder under home, behind its trust prompt. No native agents; its plugins are Pi packages, not handled here.
  'pi-cli': {
    id: 'pi-cli', name: 'Pi', surface: 'CLI', binary: 'pi',
    configEnv: 'PI_CODING_AGENT_DIR', defaultConfig: '.pi/agent', reservedSkills: [], loadsDotFolders: false,
    otherReaders: ['pi-gui (third-party)'],
    nextStep: 'Start a new Pi session to use it.',
    skillRoots: (config, home) => [
      { path: join(config, 'skills'), label: 'Pi skills' },
      { path: join(home, '.agents/skills'), label: 'Shared .agents skills' },
    ],
  },
  // OpenCode, measured on 1.19.5 and 2.2.5 (the CLI's two lines; the desktop app carries the newer): both list its own skills
  // folder, Claude Code's and the shared .agents folder, and send all three to the model. Its settings folder is
  // ~/.config/opencode on every platform. Its plugins are npm packages, not handled here: it takes a plugin's parts.
  'opencode-cli': {
    id: 'opencode-cli', name: 'OpenCode', surface: 'CLI', binary: 'opencode',
    configEnv: 'XDG_CONFIG_HOME', configUnder: 'opencode', defaultConfig: '.config/opencode', reservedSkills: [], loadsDotFolders: false,
    otherReaders: ['OpenCode desktop'],
    nextStep: 'Start a new OpenCode session to use it.',
    skillRoots: (config, home) => [
      { path: join(config, 'skills'), label: 'OpenCode skills' },
      { path: join(home, '.claude/skills'), label: 'Claude Code skills' },
      { path: join(home, '.agents/skills'), label: 'Shared .agents skills' },
    ],
  },
};

export const harnessIds = Object.keys(harnesses) as HarnessId[];

export function configRoot(definition: HarnessDefinition, home: string, override?: string): string {
  return override === undefined ? join(home, definition.defaultConfig) : override;
}

/** A tool's config folder in a home, following its override (CLAUDE_CONFIG_DIR, COPILOT_HOME, CODEX_HOME, PI_CODING_AGENT_DIR, XDG_CONFIG_HOME for OpenCode). */
export const envOverride = (definition: HarnessDefinition, env: Record<string, string | undefined>) => {
  const named = env[definition.configEnv];
  return named === undefined || !definition.configUnder ? named : join(named, definition.configUnder);
};

export const toolConfigRoot = (where: { home: string; overrides?: Partial<Record<HarnessId, string>> }, tool: HarnessId) => configRoot(harnesses[tool], where.home, where.overrides?.[tool]);

/**
 * OpenCode's settings file in its folder, which holds its MCP servers and its skill switches: opencode.jsonc when there is
 * one, else opencode.json. Both lines read both and let opencode.jsonc decide (measured on 1.19.5 and 2.2.5).
 */
export const openCodeSettings = (root: string) => (existsSync(join(root, 'opencode.jsonc')) ? join(root, 'opencode.jsonc') : join(root, 'opencode.json'));

/** Where CK writes for this harness: its own documented root (D-05). */
export function writeRoot(definition: HarnessDefinition, home: string, override?: string): string {
  return definition.skillRoots(configRoot(definition, home, override), home)[0].path;
}

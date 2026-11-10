import { join } from 'node:path';
import type { HarnessId } from './types.ts';

export interface SkillRoot { path: string; label: string }

export interface HarnessDefinition {
  id: HarnessId;
  name: string;
  surface: string;
  binary: string;
  configEnv: string;
  defaultConfig: string;
  /** Claude Code keeps this skills folder for itself. */
  reservedSkills: string[];
  /** Observed: Claude Code 2.1.309 lists dot-folders as skills; Copilot CLI 1.0.107 and Codex 0.142.3 skip them. */
  loadsDotFolders: boolean;
  /** Other products that read the folder this harness is written through (CD Appendix A). */
  otherReaders: string[];
  nextStep: string;
  /** Roots this harness loads standalone skills from, its own first. */
  skillRoots(config: string, home: string): SkillRoot[];
}

export const harnesses: Record<HarnessId, HarnessDefinition> = {
  'claude-cli': {
    id: 'claude-cli', name: 'Claude Code', surface: 'CLI', binary: 'claude',
    configEnv: 'CLAUDE_CONFIG_DIR', defaultConfig: '.claude', reservedSkills: ['synced'], loadsDotFolders: true,
    otherReaders: ['Claude desktop (Code tab)', 'OpenCode', 'VS Code'],
    nextStep: 'Written. Start a new Claude Code session (CLI or Claude desktop’s Code tab), or run /reload-skills, to use it.',
    skillRoots: config => [{ path: join(config, 'skills'), label: 'Claude Code skills' }],
  },
  'copilot-cli': {
    id: 'copilot-cli', name: 'GitHub Copilot', surface: 'CLI', binary: 'copilot',
    configEnv: 'COPILOT_HOME', defaultConfig: '.copilot', reservedSkills: [], loadsDotFolders: false,
    otherReaders: ['GitHub Copilot app', 'VS Code'],
    nextStep: 'Written. Start a new Copilot session (CLI or the GitHub Copilot app), or run /skills reload in the CLI, to use it.',
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
    nextStep: 'Written. Start a new Codex session to use it; restart the ChatGPT desktop app if it is open.',
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
    nextStep: 'Written. Start a new Pi session to use it.',
    skillRoots: (config, home) => [
      { path: join(config, 'skills'), label: 'Pi skills' },
      { path: join(home, '.agents/skills'), label: 'Shared .agents skills' },
    ],
  },
};

export const harnessIds = Object.keys(harnesses) as HarnessId[];

export function configRoot(definition: HarnessDefinition, home: string, override?: string): string {
  return override === undefined ? join(home, definition.defaultConfig) : override;
}

/** A tool's config folder in a home, following its override (CLAUDE_CONFIG_DIR, COPILOT_HOME, CODEX_HOME, PI_CODING_AGENT_DIR). */
export const toolConfigRoot = (where: { home: string; overrides?: Partial<Record<HarnessId, string>> }, tool: HarnessId) => configRoot(harnesses[tool], where.home, where.overrides?.[tool]);

/** Where CK writes for this harness: its own documented root (D-05). */
export function writeRoot(definition: HarnessDefinition, home: string, override?: string): string {
  return definition.skillRoots(configRoot(definition, home, override), home)[0].path;
}

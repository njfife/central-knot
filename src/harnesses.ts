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
  /** Other products that read the folder this harness is written through (CD Appendix A). */
  otherReaders: string[];
  nextStep: string;
  /** Roots this harness loads standalone skills from, its own first. */
  skillRoots(config: string, home: string): SkillRoot[];
}

export const harnesses: Record<HarnessId, HarnessDefinition> = {
  'claude-cli': {
    id: 'claude-cli', name: 'Claude Code', surface: 'CLI', binary: 'claude',
    configEnv: 'CLAUDE_CONFIG_DIR', defaultConfig: '.claude', reservedSkills: ['synced'],
    otherReaders: ['Claude desktop Code tab', 'OpenCode', 'VS Code'],
    nextStep: 'Written. In Claude Code, run /reload-skills or start a new session to use it.',
    skillRoots: config => [{ path: join(config, 'skills'), label: 'Claude Code skills' }],
  },
  'copilot-cli': {
    id: 'copilot-cli', name: 'GitHub Copilot', surface: 'CLI', binary: 'copilot',
    configEnv: 'COPILOT_HOME', defaultConfig: '.copilot', reservedSkills: [],
    otherReaders: ['GitHub Copilot app (documented, not yet proved)', 'VS Code'],
    nextStep: 'Written. In Copilot CLI, run /skills reload or start a new session to use it.',
    skillRoots: (config, home) => [
      { path: join(config, 'skills'), label: 'Copilot skills' },
      { path: join(home, '.agents/skills'), label: 'Shared .agents skills' },
    ],
  },
};

export const harnessIds = Object.keys(harnesses) as HarnessId[];

export function configRoot(definition: HarnessDefinition, home: string, override?: string): string {
  return override === undefined ? join(home, definition.defaultConfig) : override;
}

/** Where CK writes for this harness: its own documented root (D-05). */
export function writeRoot(definition: HarnessDefinition, home: string, override?: string): string {
  return definition.skillRoots(configRoot(definition, home, override), home)[0].path;
}

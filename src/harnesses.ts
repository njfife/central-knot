// Each tool's definition (HarnessDefinition): its name, binary, config folder and the variable that moves it, the folders it
// loads skills from, and the skill folder names it keeps for itself. What a running session needs to pick up a change is
// reload.ts reloadTable. Facts only, for the main process: which tools are in a home is discovery.ts and presence.ts, their
// names in words words.ts toolNames, and each kind's reader and writer for a tool its own module's (MAP.md, "To add or change": a tool).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessId } from './types.ts';

export interface SkillRoot { path: string; label: string }

export interface HarnessDefinition {
  id: HarnessId;
  name: string;
  surface: string;
  binary: string;
  /** The variable that moves its config folder, where it has one (Antigravity has none: harnesses below). */
  configEnv?: string;
  /** The tool's folder inside the one `configEnv` names (OpenCode's `opencode` inside XDG_CONFIG_HOME); without it, `configEnv` names the folder itself. */
  configUnder?: string;
  defaultConfig: string;
  /**
   * Skill folder names this tool keeps for itself (Claude Code's `synced`): never read as a skill and never given one. Read in
   * three places: discovery.ts (what a tool has), skillfiles.ts readSkillsFolder (what a pass reads) and skills.ts cannotTake
   * (why a skill of that name can't go there). Tests: skills.test.ts (a name a tool keeps for itself), discovery.test.ts.
   */
  reservedSkills: string[];
  /** Observed: Claude Code 2.1.309 lists dot-folders as skills; Copilot CLI 1.0.107 and Codex 0.142.3 skip them. */
  loadsDotFolders: boolean;
  /** Other products that read the folder this harness is written through (CD Appendix A). */
  otherReaders: string[];
  /** Roots this harness loads standalone skills from, its own first. */
  skillRoots(config: string, home: string): SkillRoot[];
}

export const harnesses: Record<HarnessId, HarnessDefinition> = {
  'claude-cli': {
    id: 'claude-cli', name: 'Claude Code', surface: 'CLI', binary: 'claude',
    configEnv: 'CLAUDE_CONFIG_DIR', defaultConfig: '.claude', reservedSkills: ['synced'], loadsDotFolders: true,
    otherReaders: ['Claude desktop (Code tab)', 'OpenCode', 'VS Code'],
    skillRoots: config => [{ path: join(config, 'skills'), label: 'Claude Code skills' }],
  },
  'copilot-cli': {
    id: 'copilot-cli', name: 'GitHub Copilot', surface: 'CLI', binary: 'copilot',
    configEnv: 'COPILOT_HOME', defaultConfig: '.copilot', reservedSkills: [], loadsDotFolders: false,
    otherReaders: ['GitHub Copilot app', 'VS Code'],
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
    skillRoots: (config, home) => [
      { path: join(config, 'skills'), label: 'Codex skills' },
      { path: join(home, '.agents/skills'), label: 'Shared .agents skills' },
    ],
  },
  // Pi (CD §2, Appendix A): its own skills folder, plus the shared .agents folder, which it reads as project scope in a non-Git
  // folder under home, behind its trust prompt. No native agents: it takes an agent as a skill (presence.ts agentsKeptIn). Its
  // plugins are Pi packages, not handled here.
  'pi-cli': {
    id: 'pi-cli', name: 'Pi', surface: 'CLI', binary: 'pi',
    configEnv: 'PI_CODING_AGENT_DIR', defaultConfig: '.pi/agent', reservedSkills: [], loadsDotFolders: false,
    otherReaders: ['pi-gui (third-party)'],
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
    skillRoots: (config, home) => [
      { path: join(config, 'skills'), label: 'OpenCode skills' },
      { path: join(home, '.claude/skills'), label: 'Claude Code skills' },
      { path: join(home, '.agents/skills'), label: 'Shared .agents skills' },
    ],
  },
  // Antigravity, measured on its CLI 1.5.14 in a throwaway home: its CLI (`agy`, also installed as `antigravity`), desktop app and
  // editor share ~/.gemini/config, and no variable moves it. It reads skills from more folders than this one (~/.gemini/skills, which
  // the Gemini CLI reads too, and one folder of the CLI's and one of the editor's alone), but never ~/.agents/skills; Central Knot
  // reads and writes only its own. No agents or plugins here yet (presence.ts).
  'antigravity-cli': {
    id: 'antigravity-cli', name: 'Antigravity', surface: 'CLI', binary: 'agy',
    defaultConfig: '.gemini/config', reservedSkills: [], loadsDotFolders: false,
    otherReaders: ['Antigravity desktop', 'Antigravity IDE'],
    skillRoots: config => [{ path: join(config, 'skills'), label: 'Antigravity skills' }],
  },
};

export { harnessIds } from './words.ts';

export function configRoot(definition: HarnessDefinition, home: string, override?: string): string {
  return override === undefined ? join(home, definition.defaultConfig) : override;
}

/** A tool's config folder in a home, following its override (CLAUDE_CONFIG_DIR, COPILOT_HOME, CODEX_HOME, PI_CODING_AGENT_DIR, XDG_CONFIG_HOME for OpenCode; none for Antigravity). */
export const envOverride = (definition: HarnessDefinition, env: Record<string, string | undefined>) => {
  const named = definition.configEnv && env[definition.configEnv];
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

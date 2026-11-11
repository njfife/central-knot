// Marketplaces offered without being looked for, one per plugin tool's maker. One is offered only where a tool it is for
// is here and nothing lists it yet. Adding one lists it in Central Knot and does nothing else (D-27). Each is named as its
// own catalog names it, so it reads the same before and after Add; each was added with the app's own reader before it
// was put here (November 11, 2026).
import type { PluginTool } from './presence.ts';

export interface SuggestedMarketplace { source: string; name: string; tools: PluginTool[] }

export const suggestedMarketplaces: SuggestedMarketplace[] = [
  // Anthropic's own. Claude Code adds it to its list once a session has run; Codex installs from it too.
  { source: 'anthropics/claude-plugins-official', name: 'claude-plugins-official', tools: ['claude-cli', 'codex-cli'] },
  // GitHub's own plugins for Copilot. (Copilot CLI's built-in awesome-copilot keeps its list only in
  // .github/plugin/marketplace.json, which Central Knot doesn't read, so it can't be offered.)
  { source: 'github/copilot-plugins', name: 'copilot-plugins', tools: ['copilot-cli'] },
];

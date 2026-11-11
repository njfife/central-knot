// Marketplaces offered without being looked for: the default each plugin tool comes with. One is offered only where its
// tool is here and nothing lists it yet. Adding one lists it in Central Knot and does nothing else (D-27).
import type { PluginTool } from './presence.ts';

export interface SuggestedMarketplace { source: string; name: string; tools: PluginTool[] }

export const suggestedMarketplaces: SuggestedMarketplace[] = [
  // Claude Code adds it to its own list once a session has run, and Codex's settings list it too (seen November 10, 2026).
  { source: 'anthropics/claude-plugins-official', name: 'Claude plugins', tools: ['claude-cli', 'codex-cli'] },
  // Built into Copilot CLI, which keeps it in no settings file: `copilot plugin marketplace list` in a fresh home says
  // "Included with GitHub Copilot: awesome-copilot" (1.0.109).
  { source: 'github/awesome-copilot', name: 'Awesome Copilot', tools: ['copilot-cli'] },
];

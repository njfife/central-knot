// One plugin's page: what it is, where to install it, what it holds (read from the marketplace's files), what each tool
// does with it, and its README.
import { loadMarketDetail, openLink, rerender, state } from './app.ts';
import { button, h, icon } from './dom.ts';
import { markdown } from './markdown.ts';
import { brandMark } from './matrix.ts';
import { andList, blocked, contentsSummary, installed, missingTools, names, toolBox } from './pluginparts.ts';
import { queued, toggleMany, type PluginOp } from './pluginplan.ts';
import type { HarnessId, MarketplaceView, Outcome, PluginDetailView, PluginView, PluginsView } from './types.ts';

const tone: Record<Outcome['result'], string> = { works: 'tone-muted', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

/** "named plugin:skill" with the real names, as one unbroken code name: it is what the person types in that tool. */
function namedText(text: string, plugin: string, skill?: string): (string | Node)[] {
  const match = /plugin:(skill|agent)/.exec(text);
  if (!match) return [text];
  const name = `${plugin}:${match[1] === 'skill' && skill ? skill : `${match[1]}-name`}`;
  return [text.slice(0, match.index), h('code.plugin-name', { title: name }, name), text.slice(match.index + match[0].length)];
}

/** What installing does in each tool. Tools that behave the same share one line, so a real difference stands out. */
function outcomesBlock(view: PluginsView, plugin: PluginView) {
  const firstSkill = plugin.components?.skillNames?.[0];
  const mark = (outcome: Outcome) => outcome.result === 'works' ? null : icon(glyph[outcome.result], 12, tone[outcome.result]);
  const groups = new Map<string, HarnessId[]>();
  for (const tool of view.tools) {
    const key = JSON.stringify((plugin.outcomes[tool] ?? []).map(outcome => [outcome.component, outcome.result, outcome.text]));
    groups.set(key, [...(groups.get(key) ?? []), tool]);
  }
  return h('ul.plugin-outcome-list', {}, [...groups.values()].map(tools => h('li.plugin-outcome-row', {},
    h('span.plugin-outcome-tools', {}, tools.map(tool => brandMark(tool, 14)), h('strong', {}, tools.map(tool => names[tool]).join(', '))),
    h('span.plugin-outcome-what', {}, (plugin.outcomes[tools[0]!] ?? []).map(outcome => h('span.plugin-outcome-item', {}, mark(outcome), ...namedText(`${outcome.component} ${outcome.text}`, plugin.name, firstSkill)))))));
}

/** Where to install it: a row per tool with its box, and one button for every tool still without it. */
function installPanel(view: PluginsView, market: MarketplaceView, plugin: PluginView, index: number) {
  const missing = missingTools(view, market, plugin.name);
  const ops: PluginOp[] = missing.map(tool => ({ source: market.source, market: market.name, plugin: plugin.name, tool, action: 'install' }));
  const allChosen = ops.length > 0 && ops.every(op => queued(state.pluginDraft, op.source, op.plugin, op.tool) === 'install');
  const status = (tool: HarnessId) => {
    const chosen = queued(state.pluginDraft, market.source, plugin.name, tool);
    if (chosen === 'install') return 'Installs on Apply all';
    if (chosen === 'remove') return 'Uninstalls on Apply all';
    if (installed(market, plugin.name, tool)) return 'Installed';
    return blocked(view, market, tool) ? 'Can’t install here' : 'Not installed';
  };
  return h('section.plugin-panel', { 'aria-label': 'Install' },
    h('div.plugin-panel-head', {}, h('h3', {}, 'Install in'),
      ops.length && view.canWrite ? button({ variant: allChosen ? 'ghost' : 'outline', size: 'small', label: allChosen ? 'Don’t install' : ops.length > 1 ? `Choose all ${ops.length}` : `Choose ${names[missing[0]!]}`, id: `pinstall-${index}-${plugin.name}`, disabled: !!state.busy, onclick: () => { toggleMany(state.pluginDraft, ops); rerender(); } }) : null),
    h('div.plugin-tool-rows', {}, view.tools.map(tool => h('div.plugin-tool-row', {},
      toolBox(view, market, plugin, tool, index),
      h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]),
      h('span.plugin-tool-state', { title: blocked(view, market, tool) ?? '' }, status(tool))))),
    h('p.plugin-panel-note', {}, 'Nothing runs until Apply all. Each tool installs it with its own command.'));
}

/** The plugin's parts by name, with what each says it does. */
function contentsBlock(plugin: PluginView, detail: PluginDetailView | null | undefined) {
  if (!plugin.folder) {
    return h('section.plugin-section', {}, h('h3', {}, 'What it holds'),
      h('p.plugin-muted', {}, 'Its files live outside this marketplace, so what it holds shows once a tool installs it.'));
  }
  if (!detail || !('skills' in detail)) return h('section.plugin-section', {}, h('h3', {}, 'What it holds'), h('p.plugin-muted', {}, detail === null ? 'Reading…' : 'Its files couldn’t be read.'));
  const group = (title: string, parts: { name: string; description: string }[]) => parts.length ? h('div.plugin-group', {}, h('h4', {}, `${title} (${parts.length})`),
    h('ul.plugin-parts', {}, parts.map(part => h('li', {}, h('code.plugin-name', {}, part.name), part.description ? h('span.plugin-part-what', {}, part.description) : null)))) : null;
  const plain = (title: string, items: string[]) => items.length ? h('div.plugin-group', {}, h('h4', {}, `${title} (${items.length})`), h('ul.plugin-parts', {}, items.map(item => h('li', {}, h('code.plugin-name', {}, item))))) : null;
  const empty = !detail.skills.length && !detail.commands.length && !detail.agents.length && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length;
  return h('section.plugin-section', {}, h('h3', {}, 'What it holds'),
    empty ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    group('Skills', detail.skills), group('Commands', detail.commands), group('Agents', detail.agents),
    detail.hooks.length ? h('div.plugin-group', {}, h('h4', {}, 'Hooks'), h('p.plugin-part-what', {}, `Runs on ${andList(detail.hooks)}. Hooks run commands in the tool while you work.`)) : null,
    detail.mcpServers.length ? h('div.plugin-group', {}, h('h4', {}, `MCP servers (${detail.mcpServers.length})`), h('ul.plugin-parts', {}, detail.mcpServers.map(server => h('li', {}, h('code.plugin-name', {}, server.name), server.runs ? h('span.plugin-part-what.mono', {}, server.runs) : null)))) : null,
    plain('Language servers', detail.lspServers));
}

export function pluginPage(view: PluginsView, market: MarketplaceView, index: number, plugin: PluginView) {
  if (plugin.folder) loadMarketDetail(market.source, plugin.name);
  const detail = state.marketDetail.get(`${market.source}\u0000${plugin.name}`) as PluginDetailView | null | undefined;
  const meta = [plugin.version && `Version ${plugin.version}`, plugin.author && `by ${plugin.author}`, plugin.category, plugin.license].filter(Boolean) as string[];
  const links = [plugin.homepage && button({ variant: 'link', size: 'micro', label: 'Website', id: 'plugin-homepage', onclick: () => openLink(plugin.homepage!) }),
    plugin.from?.url && button({ variant: 'link', size: 'micro', label: 'Source', id: 'plugin-source', onclick: () => openLink(plugin.from!.url!) })].filter(Boolean) as HTMLElement[];
  return h('article.plugin-page', { 'aria-label': plugin.displayName ?? plugin.name },
    h('button.plugin-back', { type: 'button', id: 'plugin-back', onclick: () => { state.market = { ...state.market, plugin: undefined }; rerender(); } }, icon('arrow-left', 14), market.name || 'Marketplace'),
    h('header.plugin-head', {},
      h('h2', {}, plugin.displayName ?? plugin.name),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      meta.length ? h('p.plugin-meta', {}, meta.join(' · ')) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      plugin.from ? h('p.plugin-meta', {}, `From ${plugin.from.label}`) : contentsSummary(plugin) ? h('p.plugin-meta', {}, contentsSummary(plugin)) : null,
      links.length ? h('p.plugin-links', {}, links) : null),
    installPanel(view, market, plugin, index),
    contentsBlock(plugin, detail),
    plugin.components ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, plugin)) : null,
    detail && 'readme' in detail && detail.readme ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'README'), markdown(detail.readme, openLink)) : null);
}

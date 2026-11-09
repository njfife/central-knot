// One plugin's page: what it is, where to install it, what it holds (read from its files), what each tool does with it,
// and its README.
import { rerender, state as app } from './app.ts';
import { button, h, icon } from './dom.ts';
import { brandMark } from './matrix.ts';
import { blocked, installed, missingTools, readme, toolBox } from './pluginparts.ts';
import { pluginKey, queued, toggleMany, type PluginOp } from './pluginplan.ts';
import { browse, market, openLink } from './pluginstate.ts';
import type { HarnessId, MarketplaceView, NamedPart, Outcome, PluginDetail, PluginView, PluginsView } from './types.ts';
import { andList, toolNames as names } from './words.ts';

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
  const groups = new Map<string, HarnessId[]>();
  for (const tool of view.tools) {
    const key = JSON.stringify((plugin.outcomes[tool] ?? []).map(outcome => [outcome.component, outcome.result, outcome.text]));
    groups.set(key, [...(groups.get(key) ?? []), tool]);
  }
  return h('ul.plugin-outcome-list', {}, [...groups.values()].map(tools => h('li.plugin-outcome-row', {},
    h('span.plugin-outcome-tools', {}, tools.map(tool => brandMark(tool, 14)), h('strong', {}, tools.map(tool => names[tool]).join(', '))),
    h('span.plugin-outcome-what', {}, (plugin.outcomes[tools[0]!] ?? []).map(outcome => h('span.plugin-outcome-item', {},
      outcome.result === 'works' ? null : icon(glyph[outcome.result], 12, tone[outcome.result]), ...namedText(`${outcome.component} ${outcome.text}`, plugin.name, firstSkill)))))));
}

/** Where to install it: one box per tool on a line, and one button for every tool still without it. */
function installPanel(view: PluginsView, entry: MarketplaceView, plugin: PluginView, index: number) {
  const missing = missingTools(view, entry, plugin.name);
  const ops: PluginOp[] = missing.map(tool => ({ source: entry.source, market: entry.name, plugin: plugin.name, tool, action: 'install' }));
  const allChosen = ops.length > 0 && ops.every(op => queued(market.draft, op.source, op.plugin, op.tool) === 'install');
  const status = (tool: HarnessId) => {
    const chosen = queued(market.draft, entry.source, plugin.name, tool);
    if (chosen) return chosen === 'install' ? 'Installs on Apply all' : 'Uninstalls on Apply all';
    if (installed(entry, plugin.name, tool)) return 'Installed';
    return blocked(view, entry, tool) ? 'Can’t install here' : 'Not installed';
  };
  const anyChosen = view.tools.some(tool => queued(market.draft, entry.source, plugin.name, tool));
  const anyInstalled = view.tools.some(tool => installed(entry, plugin.name, tool));
  const note = anyChosen ? 'Nothing runs until Apply all.' : anyInstalled ? 'To uninstall, click its check, then Apply all.' : '';
  return h('section.plugin-panel', { 'aria-label': 'Install in' },
    h('h3', {}, 'Install in'),
    h('div.plugin-tool-rows', {}, view.tools.map(tool => h('div.plugin-tool', {},
      toolBox(view, entry, plugin, tool, index),
      h('span.plugin-tool-text', {}, h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]), h('span.plugin-tool-state', { title: blocked(view, entry, tool) ?? '' }, status(tool)))))),
    h('div.plugin-panel-foot', {},
      note ? h('p.plugin-panel-note', {}, note) : null,
      ops.length && view.canWrite ? button({ variant: allChosen ? 'ghost' : 'outline', size: 'small', label: allChosen ? 'Don’t install' : ops.length > 1 ? `Choose all ${ops.length}` : `Choose ${names[missing[0]!]}`, id: `pinstall-${index}-${plugin.name}`, disabled: !!app.busy, onclick: () => { toggleMany(market.draft, ops); if (app.outcome?.page === 'plugins') app.outcome = undefined; rerender(); } }) : null));
}

/** The plugin's parts by name, with what each says it does. */
function contentsBlock(plugin: PluginView, detail: PluginDetail | { readme?: string } | null | undefined) {
  const section = (...children: (HTMLElement | null)[]) => h('section.plugin-section', {}, h('h3', {}, 'What it holds'), ...children);
  if (detail === null || detail === undefined) return section(h('p.plugin-muted', {}, plugin.folder ? 'Reading…' : `Reading its files from ${plugin.from?.label ?? 'its repository'}…`));
  if (!('skills' in detail)) return section(h('p.plugin-muted', {}, plugin.folder ? 'Its files couldn’t be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const group = (title: string, parts: NamedPart[]) => parts.length ? h('div.plugin-group', {}, h('h4', {}, `${title} (${parts.length})`),
    h('ul.plugin-parts', {}, parts.map(part => h('li', {}, h('code.plugin-name', {}, part.name), part.description ? h('span.plugin-part-what', {}, part.description) : null)))) : null;
  const empty = !detail.skills.length && !detail.commands.length && !detail.agents.length && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length;
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem) : null,
    detail.readFrom ? h('p.plugin-muted', {}, `Read from ${detail.readFrom}.`) : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    group('Skills', detail.skills), group('Commands', detail.commands), group('Agents', detail.agents),
    detail.hooks.length ? h('div.plugin-group', {}, h('h4', {}, 'Hooks'), h('p.plugin-part-what', {}, `Runs on ${andList(detail.hooks)}. Hooks run commands in the tool while you work.`)) : null,
    detail.mcpServers.length ? h('div.plugin-group', {}, h('h4', {}, `MCP servers (${detail.mcpServers.length})`), h('ul.plugin-parts', {}, detail.mcpServers.map(server => h('li', {}, h('code.plugin-name', {}, server.name), server.runs ? h('span.plugin-part-what.mono', {}, server.runs) : null)))) : null,
    detail.lspServers.length ? h('div.plugin-group', {}, h('h4', {}, `Language servers (${detail.lspServers.length})`), h('ul.plugin-parts', {}, detail.lspServers.map(name => h('li', {}, h('code.plugin-name', {}, name))))) : null);
}

export function pluginPage(view: PluginsView, entry: MarketplaceView, index: number, plugin: PluginView) {
  const detail = market.detail.get(pluginKey(entry.source, plugin.name));
  const title = plugin.displayName ?? plugin.name;
  const links = [plugin.homepage && button({ variant: 'link', size: 'micro', label: 'Website', id: 'plugin-homepage', onclick: () => openLink(plugin.homepage!) }),
    plugin.from?.url && button({ variant: 'link', size: 'micro', label: plugin.from.label, id: 'plugin-source', onclick: () => openLink(plugin.from!.url!) })].filter(Boolean) as HTMLElement[];
  const meta = [plugin.version && `Version ${plugin.version}`, plugin.author && `by ${plugin.author}`, plugin.category, plugin.license, plugin.from && !plugin.from.url ? `From ${plugin.from.label}` : ''].filter(Boolean).join(' · ');
  const body = detail && 'readme' in detail ? detail.readme : undefined;
  return h('article.plugin-page', { 'aria-label': title },
    h('button.plugin-back', { type: 'button', id: 'plugin-back', onclick: () => browse({ plugin: undefined }) }, icon('arrow-left', 14), entry.name || 'Marketplace'),
    h('header.plugin-head', {},
      h('h2', {}, title),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      meta || links.length ? h('p.plugin-meta', {}, meta, meta && links.length ? ' · ' : '', ...links.flatMap((link, at) => (at ? [' · ', link] : [link]))) : null),
    installPanel(view, entry, plugin, index),
    contentsBlock(plugin, detail),
    plugin.components ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, plugin)) : null,
    body ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'README'), readme(body, plugin.name, plugin.description)) : null);
}

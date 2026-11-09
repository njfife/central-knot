// One plugin's page: what it is, where to install it, what it holds (read from its files), what each tool does with it,
// and its README.
import { rerender, state as app } from './app.ts';
import { button, h, icon } from './dom.ts';
import { brandMark } from './brand.ts';
import { componentsFrom, outcomes } from './pluginoutcomes.ts';
import { dotted, readme, toolBox } from './pluginparts.ts';
import { allQueued, pluginKey, queued, toggleMany, type PluginOp } from './pluginplan.ts';
import { blocked, installed, missingTools, stateOf } from './pluginstatus.ts';
import { clearPluginOutcome, market, openLink } from './pluginstate.ts';
import type { Components, HarnessId, MarketplaceView, NamedPart, Outcome, PluginDetail, PluginView, PluginsView } from './types.ts';
import { andList, toolNames as names } from './words.ts';

const tone: Record<Outcome['result'], string> = { works: 'tone-muted', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

/** What installing does in each tool. Tools that behave the same share one line, so a real difference stands out. */
function outcomesBlock(view: PluginsView, plugin: PluginView, components: Components) {
  const byTool = Object.fromEntries(view.tools.map(tool => [tool, outcomes(tool, components)])) as Record<HarnessId, Outcome[]>;
  const groups = new Map<string, HarnessId[]>();
  for (const tool of view.tools) {
    const key = JSON.stringify(byTool[tool]);
    groups.set(key, [...(groups.get(key) ?? []), tool]);
  }
  // A tool that prefixes names shows the real name a person types, e.g. document-tools:pdf-reader.
  const example = (kind: Outcome['names']) => `${plugin.name}:${kind === 'skill' ? components.skillNames?.[0] ?? 'skill' : 'agent'}`;
  const line = (outcome: Outcome) => h('span.plugin-outcome-item', {}, outcome.result === 'works' ? null : icon(glyph[outcome.result], 12, tone[outcome.result]),
    `${outcome.component} ${outcome.text}`, outcome.names ? [' ', h('code.plugin-name', {}, example(outcome.names))] : null);
  return h('ul.plugin-outcome-list', {}, [...groups.values()].map(tools => h('li.plugin-outcome-row', {},
    h('span.plugin-outcome-tools', {}, tools.map(tool => brandMark(tool, 14)), h('strong', {}, tools.map(tool => names[tool]).join(', '))),
    h('span.plugin-outcome-what', {}, byTool[tools[0]!].map(line)))));
}

/**
 * Where to install it: a box per tool, each with a second line that is always there (so the card never changes height),
 * and in the heading row the one button for every tool still without it, plus how to take it out once installed.
 */
function installPanel(view: PluginsView, entry: MarketplaceView, plugin: PluginView, index: number, components?: Components) {
  const missing = missingTools(view, entry, plugin.name);
  const ops: PluginOp[] = missing.map(tool => ({ source: entry.source, market: entry.name, plugin: plugin.name, tool, action: 'install' }));
  const allChosen = allQueued(market.draft, ops);
  // A tool where some part won't fully work says so under its box, where the choice is made; "In each tool" has the detail.
  const limits = (tool: HarnessId) => (components ? outcomes(tool, components).filter(outcome => outcome.result !== 'works') : []);
  const status = (tool: HarnessId) => {
    const chosen = queued(market.draft, entry.source, plugin.name, tool);
    if (chosen) return chosen === 'install' ? 'Will install' : 'Will uninstall';
    if (installed(entry, plugin.name, tool)) return 'Installed';
    if (blocked(view, entry, tool) || stateOf(entry, plugin.name, tool).state === 'held') return 'Not available';
    return limits(tool).length ? 'Not installed · some limits' : 'Not installed';
  };
  const anyChosen = view.tools.some(tool => queued(market.draft, entry.source, plugin.name, tool));
  const anyInstalled = view.tools.some(tool => installed(entry, plugin.name, tool));
  const chooseAll = ops.length && view.canWrite
    ? button({ variant: 'outline', size: 'small', label: allChosen ? 'Choose none' : ops.length > 1 ? `Choose all ${ops.length}` : `Choose ${names[missing[0]!]}`, id: `pinstall-${index}-${plugin.name}`, disabled: !!app.busy,
      onclick: () => { toggleMany(market.draft, ops); clearPluginOutcome(); rerender(); } })
    : null;
  return h('section.plugin-panel', { 'aria-label': 'Tools' },
    h('div.plugin-panel-head', {}, h('h3', {}, 'Tools'),
      !anyChosen && anyInstalled ? h('span.plugin-panel-hint', {}, 'To uninstall, click its check, then Apply all.') : null,
      chooseAll),
    h('div.plugin-tool-rows', {}, view.tools.map(tool => {
      const why = blocked(view, entry, tool) ?? limits(tool).map(outcome => `${outcome.component} ${outcome.text}`).join('; ');
      return h('div.plugin-tool', {}, toolBox(view, entry, plugin, tool, index),
        h('span.plugin-tool-text', {}, h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]), h('span.plugin-tool-state', { title: why }, status(tool))));
    })));
}

/** One group of named parts, each description held to two lines (the whole of it on hover). */
const partList = (parts: { name: string; text: string; mono?: boolean }[]) => h('ul.plugin-parts', {}, parts.map(part => h('li', {},
  h('code.plugin-name', {}, part.name), part.text ? h(`span.plugin-part-what${part.mono ? '.mono' : ''}`, { title: part.text }, part.text) : null)));
const group = (title: string, parts: NamedPart[]) => parts.length ? h('div.plugin-group', {}, h('h4', {}, `${title} (${parts.length})`), partList(parts.map(part => ({ name: part.name, text: part.description })))) : null;

/** The plugin's parts by name, with what each says it does. */
function contentsBlock(plugin: PluginView, detail: PluginDetail | null | undefined, reading: boolean) {
  const section = (...children: (HTMLElement | null)[]) => h('section.plugin-section', {}, h('h3', {}, 'What it holds'), ...children);
  if (reading) return section(h('p.plugin-muted', {}, plugin.folder ? 'Reading…' : `Reading its files from ${plugin.from?.label ?? 'its repository'}…`));
  if (!detail) return section(h('p.plugin-muted', {}, plugin.folder ? 'Its files couldn’t be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const empty = !detail.skills.length && !detail.commands.length && !detail.agents.length && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length;
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem) : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    group('Skills', detail.skills), group('Commands', detail.commands), group('Agents', detail.agents),
    detail.hooks.length ? h('div.plugin-group', {}, h('h4', {}, 'Hooks'), h('p.plugin-part-what', {}, `Runs on ${andList(detail.hooks)}. Hooks run commands in the tool while you work.`)) : null,
    detail.mcpServers.length ? h('div.plugin-group', {}, h('h4', {}, `MCP servers (${detail.mcpServers.length})`), partList(detail.mcpServers.map(server => ({ name: server.name, text: server.runs, mono: true })))) : null,
    detail.lspServers.length ? h('div.plugin-group', {}, h('h4', {}, `Language servers (${detail.lspServers.length})`), partList(detail.lspServers.map(name => ({ name, text: '' })))) : null);
}

export function pluginPage(view: PluginsView, entry: MarketplaceView, index: number, plugin: PluginView) {
  const read = market.details.get(pluginKey(entry.source, plugin.name));
  const reading = !read || read.reading;
  const detail = read && !read.reading ? read.value : undefined;
  // A plugin kept elsewhere has no counts from the catalog; once its files are read, its contents give them.
  const components = plugin.components ?? (detail && !detail.problem ? componentsFrom(detail) : undefined);
  const title = plugin.displayName ?? plugin.name;
  const facts: (string | HTMLElement)[] = [plugin.version && `Version ${plugin.version}`, plugin.author && `by ${plugin.author}`, plugin.category, plugin.license].filter((fact): fact is string => !!fact);
  if (plugin.homepage) facts.push(button({ variant: 'link', size: 'micro', label: 'Website', id: 'plugin-homepage', onclick: () => openLink(plugin.homepage!) }));
  if (plugin.from) facts.push(plugin.from.url ? button({ variant: 'link', size: 'micro', label: plugin.from.label, id: 'plugin-source', onclick: () => openLink(plugin.from!.url!) }) : `From ${plugin.from.label}`);
  const descriptions = [plugin.description, ...(detail ? [...detail.skills, ...detail.commands, ...detail.agents].map(part => part.description) : [])];
  return h('article.plugin-page', { 'aria-label': title },
    h('header.plugin-head', {},
      h('h2', {}, title),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      facts.length ? h('p.plugin-meta', {}, dotted(facts)) : null),
    installPanel(view, entry, plugin, index, components),
    contentsBlock(plugin, detail, reading),
    components ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, plugin, components)) : null,
    detail?.readme ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'Readme'), h('div.plugin-readme-body', {}, readme(detail.readme, plugin.name, descriptions))) : null);
}

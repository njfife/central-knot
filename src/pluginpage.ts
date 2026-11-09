// One plugin's page: what it is, where to install it, what it holds (read from its files), what each tool does with it,
// and its README.
import { rerender, state as app } from './app.ts';
import { button, h, icon } from './dom.ts';
import { brandMark } from './brand.ts';
import { componentsFrom, outcomes } from './pluginoutcomes.ts';
import { changedWords, dotted, pluginTitle, readme, toolBox } from './pluginparts.ts';
import { allQueued, pluginKey, queued, toggleMany, type PluginAction, type PluginOp } from './pluginplan.ts';
import { installed, partsWhy, limitNote, missingTools, partsOf, partsOffer, partsSummary, pluginTools, removableTools, unavailable, versionWord } from './pluginstatus.ts';
import { clearNotice, market, openLink } from './pluginstate.ts';
import type { Components, HarnessId, MarketplaceView, NamedPart, Outcome, PartPlan, PluginDetail, PluginView, PluginsView } from './types.ts';
import { andList, toolNames as names } from './words.ts';
import { plural } from './model.ts';

const tone: Record<Outcome['result'], string> = { works: 'tone-muted', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

/**
 * What installing does in each tool. Tools that behave the same share one line, so a real difference stands out. When
 * every part works everywhere (only names differ), it is a few plain lines; a limit anywhere makes it a table.
 */
function outcomesBlock(view: PluginsView, plugin: PluginView, components: Components) {
  // A tool that takes no plugins (Pi) has its own section: its parts.
  const tools = view.tools.filter(tool => pluginTools.includes(tool));
  const byTool = Object.fromEntries(tools.map(tool => [tool, outcomes(tool, components)])) as Record<HarnessId, Outcome[]>;
  const groups = new Map<string, HarnessId[]>();
  for (const tool of tools) {
    const key = JSON.stringify(byTool[tool]);
    groups.set(key, [...(groups.get(key) ?? []), tool]);
  }
  // A tool that prefixes names shows the real name a person types, e.g. document-tools:pdf-reader.
  const example = (kind: Outcome['names']) => `${plugin.name}:${kind === 'skill' ? components.skillNames?.[0] ?? 'skill' : 'agent'}`;
  const line = (outcome: Outcome) => h('span.plugin-outcome-item', {}, outcome.result === 'works' ? null : icon(glyph[outcome.result], 12, tone[outcome.result]),
    `${outcome.component} ${outcome.text}`, outcome.names ? [' ', h('code.plugin-name', {}, example(outcome.names))] : null);
  const allWork = tools.every(tool => byTool[tool].every(outcome => outcome.result === 'works'));
  return h(`ul.plugin-outcome-list${allWork ? '.plugin-outcome-plain' : ''}`, {}, [...groups.values()].map(tools => h('li.plugin-outcome-row', {},
    h('span.plugin-outcome-tools', {}, tools.map(tool => brandMark(tool, 14)), h('strong', {}, tools.map(tool => names[tool]).join(', '))),
    h('span.plugin-outcome-what', {}, byTool[tools[0]!].map(line)))));
}

/**
 * Where to install it: a box per tool with a second line that is always there (so the card never changes height), and
 * at the right of the heading row (always the same height) one button: choose it for every tool still without it, or,
 * once every tool has it, choose to uninstall it from all of them.
 */
function installPanel(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, components?: Components) {
  const missing = missingTools(view, entry, plugin.name);
  const ops: PluginOp[] = missing.map(tool => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action: 'install' }));
  // A tool where some part won't fully work names it under its box, where the choice is made; "In each tool" has the detail.
  const limits = (tool: HarnessId) => (components ? outcomes(tool, components).filter(outcome => outcome.result !== 'works') : []);
  const status = (tool: HarnessId) => {
    const chosen = queued(market.draft, entry.source, plugin.name, tool);
    const parts = partsOf(entry, plugin.name, tool);
    if (chosen) return ({ install: 'Will install', remove: 'Will uninstall', parts: parts ? 'Will update its parts' : 'Will install its parts', 'remove-parts': 'Will remove its parts', 'undo-parts': '' } as Record<PluginAction, string>)[chosen];
    if (installed(entry, plugin.name, tool)) return 'Installed';
    if (partsOffer(view, entry, plugin.name, tool, components)) return parts?.changed ? 'Parts out of date' : parts ? `Parts installed · ${partsSummary(parts.items)}` : 'Can take its parts';
    if (unavailable(view, entry, plugin.name, tool)) return 'Not available';
    return ['Not installed', limitNote(limits(tool))].filter(Boolean).join(' · ');
  };
  const why = (tool: HarnessId) => {
    const parts = partsOf(entry, plugin.name, tool);
    if (parts?.changed) return `${changedWords(parts)}.`;
    if (parts) return `Installed as separate items${parts.version ? `, from ${versionWord(parts.version)}` : ''}.`;
    return unavailable(view, entry, plugin.name, tool) ?? limits(tool).map(outcome => `${outcome.component} ${outcome.text}`).join('; ');
  };
  // Once no tool is missing it, the same button chooses its uninstall everywhere it can be uninstalled.
  const removals: PluginOp[] = removableTools(view, entry, plugin.name).map(tool => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action: 'remove' }));
  const batch = ops.length ? ops : removals;
  const allButton = batch.length && view.canWrite ? button({
    variant: 'outline', size: 'small', id: `pinstall-${marketIndex}-${plugin.name}`, disabled: !!app.busy,
    // An uninstall only chooses (the ellipsis says more is to come: Apply all); the boxes then read "Will uninstall".
    label: allQueued(market.draft, batch) ? 'Choose none'
      : ops.length ? `Choose ${batch.length > 1 ? `all ${batch.length}` : names[batch[0]!.tool]}`
      : `Uninstall ${batch.length > 1 ? `all ${batch.length}` : `from ${names[batch[0]!.tool]}`}…`,
    onclick: () => { toggleMany(market.draft, batch); clearNotice(); rerender(); },
  }) : null;
  return h('section.plugin-panel', { 'aria-label': 'Your tools' },
    h('div.plugin-panel-head', {}, h('h3', {}, 'Your tools'), allButton),
    h('div.plugin-tool-rows', {}, view.tools.map(tool => h('div.plugin-tool', {}, toolBox(view, entry, plugin, tool, marketIndex),
      h('span.plugin-tool-text', {}, h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]), h('span.plugin-tool-state', { title: why(tool) }, status(tool)))))));
}

const kindWords: Record<PartPlan['kind'], [string, string]> = { skill: ['skill', 'skills'], mcp: ['MCP server', 'MCP servers'], agent: ['agent', 'agents'] };

/** What stays with the plugin in any tool without it: the parts that are never installed on their own. */
function staysBehind(detail: PluginDetail): string[] {
  return [detail.commands.length ? plural(detail.commands.length, 'command') : '', detail.hooks.length ? 'hooks' : '',
    detail.lspServers.length ? plural(detail.lspServers.length, 'language server') : '', detail.bin ? 'the bin/ folder' : ''].filter(Boolean);
}

/**
 * Tools that can't take the plugin can take its parts: each skill, MCP server and agent as a separate item. Says which
 * tools, what goes in and what doesn't (tools whose plans match share a line), and offers the one next step: update parts
 * that are out of date, else choose them for every tool still without, else remove them.
 */
function partsSection(view: PluginsView, entry: MarketplaceView, plugin: PluginView, components: Components | undefined, detail: PluginDetail | null | undefined) {
  const tools = view.tools.filter(tool => partsOffer(view, entry, plugin.name, tool, components));
  if (!tools.length) return null;
  const read = market.partsPlans.get(pluginKey(entry.source, plugin.name));
  const plans = read && !read.reading ? read.value : undefined;
  const op = (tool: HarnessId, action: PluginAction): PluginOp => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action });
  const changed = tools.filter(tool => partsOf(entry, plugin.name, tool)?.changed);
  const without = tools.filter(tool => !partsOf(entry, plugin.name, tool));
  const holding = tools.filter(tool => partsOf(entry, plugin.name, tool));
  const [batch, label] = changed.length ? [changed.map(tool => op(tool, 'parts')), 'Update parts']
    : without.length ? [without.map(tool => op(tool, 'parts')), `Choose parts for ${without.length > 1 ? `all ${without.length}` : names[without[0]!]}`]
      : [holding.map(tool => op(tool, 'remove-parts')), `Remove parts${holding.length > 1 ? ` from all ${holding.length}` : ''}…`];
  const action = view.canWrite ? button({ variant: 'outline', size: 'small', id: `pparts-${plugin.name}`, disabled: !!app.busy,
    label: allQueued(market.draft, batch) ? 'Choose none' : label, onclick: () => { toggleMany(market.draft, batch); clearNotice(); rerender(); } }) : null;
  // Tools whose plans match share one line, as "In each tool" groups them.
  const groups = new Map<string, HarnessId[]>();
  for (const tool of tools) { const key = JSON.stringify(plans?.[tool] ?? null); groups.set(key, [...(groups.get(key) ?? []), tool]); }
  // "Copilot CLI and Codex have no command-line tool here, and Pi takes no plugins": tools with the same reason share it.
  const byWhy = new Map<string, HarnessId[]>();
  for (const tool of tools) { const why = partsWhy(view, entry, tool)[0]; byWhy.set(why, [...(byWhy.get(why) ?? []), tool]); }
  const reasons = andList([...byWhy.values()].map(group => `${andList(group.map(tool => names[tool]))} ${partsWhy(view, entry, group[0]!)[group.length > 1 ? 1 : 0]}`));
  const planLines = (plan: PartPlan[]) => {
    const going = plan.filter(part => !part.why);
    const kinds = (['skill', 'mcp', 'agent'] as const).filter(kind => going.some(part => part.kind === kind));
    return [
      going.length ? h('span.plugin-outcome-item', {}, `Goes in: ${kinds.map(kind => { const names = going.filter(part => part.kind === kind).map(part => part.name); return `${kindWords[kind][names.length > 1 ? 1 : 0]} ${andList(names)}`; }).join('; ')}`) : h('span.plugin-outcome-item', {}, icon('circle-off', 12, 'tone-faint'), 'Nothing in it can go in here'),
      ...plan.filter(part => part.limit).map(part => h('span.plugin-outcome-item', {}, icon('circle-minus', 12, 'tone-warning'), `Agent ${part.name}: ${part.limit}`)),
      ...plan.filter(part => part.why).map(part => h('span.plugin-outcome-item', {}, icon('circle-off', 12, 'tone-faint'), `Not ${kindWords[part.kind][0]} ${part.name}: ${part.why!.replace(/\.$/, '')}`)),
    ];
  };
  const behind = detail && !detail.problem ? staysBehind(detail) : [];
  return h('section.plugin-section.plugin-parts-section', { 'aria-label': 'Its parts' },
    h('div.plugin-section-head', {}, h('h3', {}, 'Its parts, as separate items'), action),
    h('p.plugin-parts-about', {}, `${reasons}. Its skills, MCP servers and agents can go in there instead, each as a separate item copied as it is. They are marked as from this plugin on the Skills, MCP and Agents pages, are removed together, and show here when the plugin changes.`),
    h('ul.plugin-outcome-list', {}, [...groups.values()].map(group => h('li.plugin-outcome-row', {},
      h('span.plugin-outcome-tools', {}, group.map(tool => brandMark(tool, 14)), h('strong', {}, group.map(tool => names[tool]).join(', '))),
      h('span.plugin-outcome-what', {}, plans?.[group[0]!] ? planLines(plans[group[0]!]!) : h('span.plugin-outcome-item', {}, read?.reading || !read ? 'Reading its parts…' : 'Its files couldn’t be read.'))))),
    behind.length ? h('p.plugin-muted', {}, `Stays with the plugin in every tool without it: ${andList(behind)}.`) : null);
}

/**
 * One group of named parts, each description held to two lines. Once laid out, a description that was cut gets a "Show
 * more" button (see markClamped); one that fits has none.
 */
const partList = (owner: string, parts: { name: string; text: string; mono?: boolean }[]) => h('ul.plugin-parts', {}, parts.map(part => {
  const key = `${owner}\u0000${part.name}`;
  const open = market.opened.has(key);
  const more = h('button.part-more', { type: 'button', onclick: () => { if (open) market.opened.delete(key); else market.opened.add(key); rerender(); } }, open ? 'Show less' : 'Show more');
  return h(`li${open ? '.clamped' : ''}`, {},
    h('code.plugin-name', {}, part.name),
    part.text ? h('span.plugin-part-body', {}, h(`span.plugin-part-what${part.mono ? '.mono' : ''}${open ? '.expanded' : ''}`, {}, part.text), more) : null);
}));

/** After layout: marks each part whose description was cut at two lines, which shows its "Show more". */
function markClamped(): void {
  for (const what of document.querySelectorAll<HTMLElement>('.plugin-part-what:not(.expanded)')) {
    what.closest('li')?.classList.toggle('clamped', what.scrollHeight > what.clientHeight + 1);
  }
}

const group = (owner: string, title: string, parts: NamedPart[]) => parts.length ? h('div.plugin-group', {}, h('h4', {}, `${title} (${parts.length})`), partList(`${owner}\u0000${title}`, parts.map(part => ({ name: part.name, text: part.description })))) : null;

/** The plugin's parts by name, with what each says it does. `owner` (its plugin key) keeps each part's "Show more" its own. */
function contentsBlock(owner: string, plugin: PluginView, detail: PluginDetail | null | undefined, reading: boolean) {
  const section = (...children: (HTMLElement | null)[]) => h('section.plugin-section', {}, h('h3', {}, 'What it holds'), ...children);
  if (reading) return section(h('p.plugin-muted', {}, plugin.folder ? 'Reading…' : `Reading its files from ${plugin.from?.label ?? 'its repository'}…`));
  if (!detail) return section(h('p.plugin-muted', {}, plugin.folder ? 'Its files couldn’t be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const empty = !detail.skills.length && !detail.commands.length && !detail.agents.length && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length && !detail.bin;
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem) : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    group(owner, 'Skills', detail.skills), group(owner, 'Commands', detail.commands), group(owner, 'Agents', detail.agents),
    detail.hooks.length ? h('div.plugin-group', {}, h('h4', {}, 'Hooks'), h('p.plugin-part-what', {}, `Runs on ${andList(detail.hooks)}. Hooks run commands in the tool while you work.`)) : null,
    detail.mcpServers.length ? h('div.plugin-group', {}, h('h4', {}, `MCP servers (${detail.mcpServers.length})`), partList(`${owner}\u0000mcp`, detail.mcpServers.map(server => ({ name: server.name, text: server.runs, mono: true })))) : null,
    detail.lspServers.length ? h('div.plugin-group', {}, h('h4', {}, `Language servers (${detail.lspServers.length})`), partList(`${owner}\u0000lsp`, detail.lspServers.map(name => ({ name, text: '' })))) : null,
    detail.bin ? h('div.plugin-group', {}, h('h4', {}, 'Programs'), partList(`${owner}\u0000bin`, [{ name: 'bin/', text: 'A folder of programs the plugin puts on the tool’s path.' }])) : null);
}

export function pluginPage(view: PluginsView, entry: MarketplaceView, marketIndex: number, plugin: PluginView) {
  const read = market.details.get(pluginKey(entry.source, plugin.name));
  const reading = !read || read.reading;
  const detail = read && !read.reading ? read.value : undefined;
  // A plugin kept elsewhere has no counts from the catalog; once its files are read, its contents give them.
  const components = plugin.components ?? (detail && !detail.problem ? componentsFrom(detail) : undefined);
  const title = pluginTitle(plugin);
  const facts: (string | HTMLElement)[] = [plugin.version && `Version ${plugin.version}`, plugin.author && `By ${plugin.author}`, plugin.category, plugin.license].filter((fact): fact is string => !!fact);
  if (plugin.homepage) facts.push(button({ variant: 'link', size: 'micro', label: 'Website', id: 'plugin-homepage', onclick: () => openLink(plugin.homepage!) }));
  if (plugin.from) facts.push(plugin.from.url ? button({ variant: 'link', size: 'micro', label: plugin.from.label, id: 'plugin-source', onclick: () => openLink(plugin.from!.url!) }) : `From ${plugin.from.label}`);
  const parts = detail ? [...detail.skills, ...detail.commands, ...detail.agents] : [];
  const descriptions = [plugin.description, ...parts.map(part => part.description)];
  requestAnimationFrame(markClamped);
  return h('article.plugin-page', { 'aria-label': title },
    h('header.plugin-head', {},
      h('h2', {}, title),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      facts.length ? h('p.plugin-meta', {}, dotted(facts)) : null),
    installPanel(view, entry, plugin, marketIndex, components),
    partsSection(view, entry, plugin, components, detail),
    contentsBlock(pluginKey(entry.source, plugin.name), plugin, detail, reading),
    components ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, plugin, components)) : null,
    detail?.readme ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'Readme'), h('div.plugin-readme-body', {}, readme(detail.readme, plugin.name, descriptions, parts))) : null);
}

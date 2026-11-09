// One plugin's page: what it is, where to install it, what it holds (read from its files), what each tool does with it,
// and its README.
import { rerender, state as app } from './app.ts';
import { button, h, icon, switchControl } from './dom.ts';
import { brandMark } from './brand.ts';
import { componentsFrom, outcomes } from './pluginoutcomes.ts';
import { dotted, pluginTitle, readme, toolBox } from './pluginparts.ts';
import { allQueued, pluginKey, queued, toggle, toggleMany, type PluginOp } from './pluginplan.ts';
import { NO_SKILL_SWITCH, cantSwitchSkill, installed, limitNote, missingTools, removableTools, skillOff, stateOf, unavailable } from './pluginstatus.ts';
import { clearNotice, market, openLink } from './pluginstate.ts';
import type { Components, HarnessId, MarketplaceView, NamedPart, Outcome, PluginDetail, PluginView, PluginsView } from './types.ts';
import { plural } from './model.ts';
import { andList, toolNames as names } from './words.ts';

const tone: Record<Outcome['result'], string> = { works: 'tone-muted', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

/**
 * What installing does in each tool. Tools that behave the same share one line, so a real difference stands out. When
 * every part works everywhere (only names differ), it is a few plain lines; a limit anywhere makes it a table.
 */
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
  const allWork = view.tools.every(tool => byTool[tool].every(outcome => outcome.result === 'works'));
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
    if (chosen) return chosen === 'install' ? 'Will install' : 'Will uninstall';
    const state = stateOf(entry, plugin.name, tool);
    if (state.state === 'installed') return ['Installed', state.skillsOff?.length ? `${plural(state.skillsOff.length, 'skill')} off` : ''].filter(Boolean).join(' · ');
    if (unavailable(view, entry, plugin.name, tool)) return 'Not available';
    return ['Not installed', limitNote(limits(tool))].filter(Boolean).join(' · ');
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
    h('div.plugin-tool-rows', {}, view.tools.map(tool => {
      const why = unavailable(view, entry, plugin.name, tool) ?? limits(tool).map(outcome => `${outcome.component} ${outcome.text}`).join('; ');
      return h('div.plugin-tool', {}, toolBox(view, entry, plugin, tool, marketIndex),
        h('span.plugin-tool-text', {}, h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]), h('span.plugin-tool-state', { title: why }, status(tool))));
    })));
}

/**
 * One group of named parts, each description held to two lines. Once laid out, a description that was cut gets a "Show
 * more" button (see markClamped); one that fits has none. `end`: controls at the row's end (a skill's switches); `note`: a
 * line under the description about those controls.
 */
const partList = (owner: string, parts: { name: string; text: string; mono?: boolean; end?: HTMLElement; note?: string }[]) => h('ul.plugin-parts', {}, parts.map(part => {
  const key = `${owner}\u0000${part.name}`;
  const open = market.opened.has(key);
  const more = h('button.part-more', { type: 'button', onclick: () => { if (open) market.opened.delete(key); else market.opened.add(key); rerender(); } }, open ? 'Show less' : 'Show more');
  return h(`li${open ? '.clamped' : ''}${part.end ? '.with-end' : ''}`, {},
    h('code.plugin-name', {}, part.name),
    part.text || part.note ? h('span.plugin-part-body', {}, part.text ? h(`span.plugin-part-what${part.mono ? '.mono' : ''}${open ? '.expanded' : ''}`, {}, part.text) : null, part.text ? more : null,
      part.note ? h('span.plugin-part-note', {}, part.note) : null) : h('span'),
    part.end ?? null);
}));

/**
 * One skill's switch in one tool where the plugin is installed (ENB-06): on or off there, or, chosen for Apply all, in the
 * position it will take, marked as waiting. Held off by a switch that isn't the plugin's own, or with no way to change it
 * here, it shows where it stands, can't be clicked and says why.
 */
function skillSwitch(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, skill: string, marketIndex: number) {
  const off = skillOff(entry, plugin.name, tool, skill);
  const chosen = queued(market.draft, entry.source, plugin.name, tool, skill);
  const on = chosen ? chosen === 'skill-on' : !off;
  const why = off?.held ?? cantSwitchSkill(view, tool, skill);
  const where = `${skill} in ${names[tool]}`;
  const label = chosen ? `${where}: turned ${on ? 'on' : 'off'} on Apply all. Click to leave it ${on ? 'off' : 'on'}.`
    : `${where}: ${on ? 'on' : 'off'}. ${why ?? `Click to turn it ${on ? 'off' : 'on'} on Apply all.`}`;
  const control = switchControl(on, label, () => {
    toggle(market.draft, { source: entry.source, marketName: entry.name, plugin: plugin.name, tool, skill, action: chosen ?? (off ? 'skill-on' : 'skill-off') });
    clearNotice();
    rerender();
  }, !!app.busy || (!chosen && !!why), `pskill-${marketIndex}-${plugin.name}-${skill}-${tool}`);
  return h(`span.skill-switch${chosen ? '.skill-switch-chosen' : ''}`, { 'data-state': chosen ?? (on ? 'on' : 'off') }, control);
}

/**
 * The plugin's skills. Where it is installed, each skill has a switch per tool that can turn one skill off (ENB-06), under
 * that tool's name; a tool that can't is named once above the list with why, and whole-plugin uninstall stays in Your tools.
 */
function skillsGroup(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, owner: string, skills: NamedPart[]) {
  if (!skills.length) return null;
  const tools = view.tools.filter(tool => installed(entry, plugin.name, tool));
  const switchable = tools.filter(tool => !NO_SKILL_SWITCH[tool]);
  const limits = tools.filter(tool => NO_SKILL_SWITCH[tool]).map(tool => NO_SKILL_SWITCH[tool]!);
  const switches = (skill: string) => h('span.skill-switches', {}, switchable.map(tool => skillSwitch(view, entry, plugin, tool, skill, marketIndex)));
  // Held off by a switch that isn't this plugin's own: said on the row, not only in the switch's hover text.
  const heldNote = (skill: string) => {
    const holders = switchable.filter(tool => skillOff(entry, plugin.name, tool, skill)?.held);
    return holders.length ? `Off in ${andList(holders.map(tool => names[tool]))} for every skill named “${skill}”, not only this plugin’s; turn it on there.` : undefined;
  };
  return h('div.plugin-group.plugin-skills', {},
    h('div.plugin-group-head', {}, h('h4', {}, `Skills (${skills.length})`),
      switchable.length ? h('span.skill-switches.skill-switch-heads', { 'aria-hidden': 'true' }, switchable.map(tool => h('span.skill-switch-head', { title: names[tool] }, brandMark(tool, 14), h('span.skill-switch-tool', {}, names[tool])))) : null),
    switchable.length || limits.length ? h('p.plugin-part-what.plugin-skills-note', {}, [
      switchable.length ? `Turn a skill off in ${andList(switchable.map(tool => names[tool]))} without uninstalling the plugin; nothing changes until Apply all.` : '',
      ...limits].filter(Boolean).join(' ')) : null,
    partList(`${owner}\u0000Skills`, skills.map(part => ({ name: part.name, text: part.description, end: switchable.length ? switches(part.name) : undefined, note: heldNote(part.name) }))));
}

/** After layout: marks each part whose description was cut at two lines, which shows its "Show more". */
function markClamped(): void {
  for (const what of document.querySelectorAll<HTMLElement>('.plugin-part-what:not(.expanded)')) {
    what.closest('li')?.classList.toggle('clamped', what.scrollHeight > what.clientHeight + 1);
  }
}

const group = (owner: string, title: string, parts: NamedPart[]) => parts.length ? h('div.plugin-group', {}, h('h4', {}, `${title} (${parts.length})`), partList(`${owner}\u0000${title}`, parts.map(part => ({ name: part.name, text: part.description })))) : null;

/** The plugin's parts by name, with what each says it does. `owner` (its plugin key) keeps each part's "Show more" its own. */
function contentsBlock(view: PluginsView, entry: MarketplaceView, marketIndex: number, owner: string, plugin: PluginView, detail: PluginDetail | null | undefined, reading: boolean) {
  const section = (...children: (HTMLElement | null)[]) => h('section.plugin-section', {}, h('h3', {}, 'What it holds'), ...children);
  if (reading) return section(h('p.plugin-muted', {}, plugin.folder ? 'Reading…' : `Reading its files from ${plugin.from?.label ?? 'its repository'}…`));
  if (!detail) return section(h('p.plugin-muted', {}, plugin.folder ? 'Its files couldn’t be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const empty = !detail.skills.length && !detail.commands.length && !detail.agents.length && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length && !detail.bin;
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem) : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    skillsGroup(view, entry, plugin, marketIndex, owner, detail.skills), group(owner, 'Commands', detail.commands), group(owner, 'Agents', detail.agents),
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
    contentsBlock(view, entry, marketIndex, pluginKey(entry.source, plugin.name), plugin, detail, reading),
    components ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, plugin, components)) : null,
    detail?.readme ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'Readme'), h('div.plugin-readme-body', {}, readme(detail.readme, plugin.name, descriptions, parts))) : null);
}

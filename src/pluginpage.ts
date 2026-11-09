// One plugin's page: what it is and which version each tool has, where to install it, what it holds (each skill, command
// and agent's file as written), what each tool does with it, and its README.
import { rerender, state as app } from './app.ts';
import { button, fileText, h, icon } from './dom.ts';
import { brandMark } from './brand.ts';
import { componentsFrom, outcomes } from './pluginoutcomes.ts';
import { dotted, pluginTitle, readme, toolBox } from './pluginparts.ts';
import { allQueued, pluginKey, queued, toggleMany, type PluginOp } from './pluginplan.ts';
import { installed, installedVersion, limitNote, missingTools, removableTools, unavailable, versionDiffers } from './pluginstatus.ts';
import { clearNotice, market, openLink } from './pluginstate.ts';
import type { Components, HarnessId, MarketplaceView, Outcome, PluginDetail, PluginView, PluginsView } from './types.ts';
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

/** "Installed · 1.2.0". When the tool has another version than the marketplace offers, a second line says which. */
function installedLine(version: string | undefined, offered: string | undefined) {
  const line = version ? `Installed · ${version}` : 'Installed';
  return versionDiffers(version, offered) ? [line, h('span.plugin-version-differs', {}, icon('circle-alert', 12), `Marketplace has ${offered}`)] : line;
}

/**
 * Where to install it: a box per tool with a second line that is always there (so the card never changes height), and
 * at the right of the heading row (always the same height) one button: choose it for every tool still without it, or,
 * once every tool has it, choose to uninstall it from all of them. An installed tool's line names its version.
 */
function installPanel(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, offered: string | undefined, components?: Components) {
  const missing = missingTools(view, entry, plugin.name);
  const ops: PluginOp[] = missing.map(tool => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action: 'install' }));
  // A tool where some part won't fully work names it under its box, where the choice is made; "In each tool" has the detail.
  const limits = (tool: HarnessId) => (components ? outcomes(tool, components).filter(outcome => outcome.result !== 'works') : []);
  const status = (tool: HarnessId) => {
    const chosen = queued(market.draft, entry.source, plugin.name, tool);
    if (chosen) return chosen === 'install' ? 'Will install' : 'Will uninstall';
    if (installed(entry, plugin.name, tool)) return installedLine(installedVersion(entry, plugin.name, tool), offered);
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
      return h('div.plugin-tool', {}, toolBox(view, entry, plugin, tool, marketIndex, offered),
        h('span.plugin-tool-text', {}, h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]), h('span.plugin-tool-state', { title: why }, status(tool))));
    })));
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

/** One copy of a part's file: who holds it (the marketplace or a tool), at which version, and its text. */
interface FileCopy { who: string; version?: string; text: string; marketplace: boolean }
/** A skill, command or agent as listed: its name, what it says it does, and its file in each copy that has one. */
interface FilePart { name: string; description: string; copies: FileCopy[] }
type FileKind = 'skills' | 'commands' | 'agents';

/** One kind of part across the marketplace's copy and each tool's installed copy, by name, each copy with its version. */
function filePartsOf(kind: FileKind, detail: PluginDetail, offered: string | undefined): FilePart[] {
  const sources = [{ who: 'Marketplace', version: offered, marketplace: true, parts: detail[kind] },
    ...Object.entries(detail.installed ?? {}).map(([tool, copy]) => ({ who: names[tool as HarnessId], version: copy.version, marketplace: false, parts: copy[kind] }))];
  const byName = new Map<string, FilePart>();
  for (const { parts, ...holder } of sources) {
    for (const part of parts) {
      if (!byName.has(part.name)) byName.set(part.name, { name: part.name, description: part.description, copies: [] });
      if (part.text !== undefined) byName.get(part.name)!.copies.push({ ...holder, text: part.text });
    }
  }
  return [...byName.values()].sort((first, second) => first.name.localeCompare(second.name));
}

/** Who holds one text, by version: "Marketplace and Codex (1.2.0)", "Claude Code (1.1.0) and Codex (1.0.0)". */
function holdersLine(holders: FileCopy[]): string {
  const byVersion = new Map<string, string[]>();
  for (const holder of holders) byVersion.set(holder.version ?? '', [...(byVersion.get(holder.version ?? '') ?? []), holder.who]);
  return andList([...byVersion].map(([version, who]) => `${andList(who)}${version ? ` (${version})` : ''}`));
}

/** The tools whose copy of a part's file differs from the marketplace's, with their versions (none when the marketplace's isn't known). */
function differsIn(part: FilePart): FileCopy[] {
  const offered = part.copies.find(copy => copy.marketplace);
  return offered ? part.copies.filter(copy => !copy.marketplace && copy.text !== offered.text) : [];
}

const fileNames: Record<FileKind, string> = { skills: 'SKILL.md', commands: 'command file', agents: 'agent file' };

/**
 * One group of skills, commands or agents. A row opens its file as written, in the view the Skills page gives a
 * standalone SKILL.md, each text named by who holds it; a closed row says which tools have different text. A
 * description stays at two lines, since the file holds it whole. `id` prefixes each part's ids.
 */
function fileGroup(owner: string, id: string, title: string, kind: FileKind, parts: FilePart[]) {
  if (!parts.length) return null;
  return h('div.plugin-group', {}, h('h4', {}, `${title} (${parts.length})`), h('ul.plugin-parts', {}, parts.map(part => {
    const key = `${owner}\u0000${kind}\u0000${part.name}`;
    const open = market.opened.has(key);
    const file = `${part.name} ${fileNames[kind]}`;
    const differs = differsIn(part);
    const body = h('span.plugin-part-body', {}, part.description ? h('span.plugin-part-what', { title: part.description }, part.description) : null,
      differs.length ? h('span.plugin-version-differs', {}, icon('circle-alert', 12), `${holdersLine(differs)} ${differs.length > 1 ? 'have' : 'has'} different text`) : null);
    if (!part.copies.length) return h('li', {}, h('code.plugin-name', {}, part.name), body);
    return h(`li${open ? '.open' : ''}`, {},
      h('button.plugin-file-toggle', { type: 'button', id: `${id}-${kind}-${part.name}`, 'aria-expanded': String(open), title: `${open ? 'Hide' : 'Show'} ${file}`,
        onclick: () => { if (open) market.opened.delete(key); else market.opened.add(key); rerender(); } },
        h('span.plugin-file-name', {}, icon(open ? 'chevron-down' : 'chevron-right', 13), h('code.plugin-name', {}, part.name)), body),
      open ? h('div.plugin-file', {}, fileText(`${id}-${kind}-${part.name}-text`, file, part.copies,
        // Named as a file, like the Skills page's SKILL.md heading; one text everywhere says so.
        (holders, distinct) => `${fileNames[kind].replace(/^./, first => first.toUpperCase())} · ${distinct === 1 && holders.length > 1 ? 'the same in ' : ''}${holdersLine(holders)}`,
        { named: true, warn: holders => differs.length > 0 && !holders.some(holder => holder.marketplace) })) : null);
  })));
}

/**
 * The plugin's parts by name, with what each says it does; skills, commands and agents open their files. `owner` (its
 * plugin key) keeps what is opened its own; `id` prefixes element ids.
 */
function contentsBlock(owner: string, id: string, plugin: PluginView, detail: PluginDetail | null | undefined, reading: boolean, offered: string | undefined) {
  const section = (...children: (HTMLElement | null)[]) => h('section.plugin-section', {}, h('h3', {}, 'What it holds'), ...children);
  if (reading) return section(h('p.plugin-muted', {}, plugin.folder ? 'Reading…' : `Reading its files from ${plugin.from?.label ?? 'its repository'}…`));
  if (!detail) return section(h('p.plugin-muted', {}, plugin.folder ? 'Its files couldn’t be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const skills = filePartsOf('skills', detail, offered), commands = filePartsOf('commands', detail, offered), agents = filePartsOf('agents', detail, offered);
  const empty = !skills.length && !commands.length && !agents.length && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length && !detail.bin;
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem) : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    fileGroup(owner, id, 'Skills', 'skills', skills), fileGroup(owner, id, 'Commands', 'commands', commands), fileGroup(owner, id, 'Agents', 'agents', agents),
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
  // The catalog's version, else the one its plugin.json gives once read (a plugin kept in another repository).
  const offered = plugin.version ?? detail?.version;
  const facts: (string | HTMLElement)[] = [plugin.author && `By ${plugin.author}`, plugin.category, plugin.license].filter((fact): fact is string => !!fact);
  if (offered) facts.unshift(h('span.plugin-meta-version', {}, `Version ${offered}`));
  if (plugin.homepage) facts.push(button({ variant: 'link', size: 'micro', label: 'Website', id: 'plugin-homepage', onclick: () => openLink(plugin.homepage!) }));
  if (plugin.from) facts.push(plugin.from.url ? button({ variant: 'link', size: 'micro', label: plugin.from.label, id: 'plugin-source', onclick: () => openLink(plugin.from!.url!) }) : `From ${plugin.from.label}`);
  const parts = detail ? [...detail.skills, ...detail.commands, ...detail.agents].map(({ name, description }) => ({ name, description })) : [];
  const descriptions = [plugin.description, ...parts.map(part => part.description)];
  requestAnimationFrame(markClamped);
  return h('article.plugin-page', { 'aria-label': title },
    h('header.plugin-head', {},
      h('h2', {}, title),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      facts.length ? h('p.plugin-meta', {}, dotted(facts)) : null),
    installPanel(view, entry, plugin, marketIndex, offered, components),
    contentsBlock(pluginKey(entry.source, plugin.name), `pfile-${marketIndex}`, plugin, detail, reading, offered),
    components ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, plugin, components)) : null,
    detail?.readme ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'Readme'), h('div.plugin-readme-body', {}, readme(detail.readme, plugin.name, descriptions, parts))) : null);
}

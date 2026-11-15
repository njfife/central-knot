// One plugin's page: what it is, its one switch and each tool's line (what that tool has, kept out or let in, brought into
// line there: pluginrecord.ts), what it holds (each skill, command and agent's file as written), what each tool does with
// it, and its README. Each click acts at once: the switch and each tool's links through pluginstate.ts turnPlugin; Update,
// Update parts and the switches under What it holds through pluginstate.ts applyPluginOps.
import { state as app } from './app.ts';
import { afterLayout, button, fileBlocks, h, icon, toggle as switchToggle, withToolCount } from './dom.ts';
import { brandMark } from './brand.ts';
import { groupBy } from './model.ts';
import { componentsFrom, outcomes } from './pluginoutcomes.ts';
import { componentsOf, dotted, markOf, pluginSwitch, pluginTitle, readme, markCell, updateButton, updateOps, updatesRun, versionNote } from './pluginparts.ts';
import { inlineMarkdown } from './markdown.ts';
import { pluginKey, type PluginOp } from './pluginplan.ts';
import { cantSwitchSkill, comparableText, itemsOnWords, noLongerOffered, copyStale, installed, limitNote, marketplaceVersionNote, NO_SKILL_SWITCH, offeredVersion, pageOfPart, partsEligible, partsFit, partsOf, partsOffer, partsPickable, partStillIn, partsWhy, partWords, PREVIEW_ONLY, samePart, skillOff, stateOf, unavailable, untestedBuild, versionToCompare, versionWord, whyNotCarried, changedPartsWords, type ToolMark } from './pluginstatus.ts';
import { hasCowork, takesPlugins } from './presence.ts';
import { applyPluginOps, market, openLink, shownDetail, toggleOpened, turnPlugin } from './pluginstate.ts';
import type { Components, HarnessId, MarketplaceView, Outcome, PartKind, PartPlan, PartRef, PartsState, PluginDetail, PluginItemLine, PluginTurn, PluginView, PluginsView } from './types.ts';
import { plural } from './model.ts';
import { andList, byToolOrder, coworkWords, toolNames as names } from './words.ts';
import { openItem } from './matrix.ts';
import { nameOfFile } from './values.ts';

/** A tool that takes parts, can't take this plugin, and gets none of its parts (Pi, for a plugin of agents and commands). */
const takesNoneOf = (view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId) =>
  partsEligible(view, entry, plugin.name, tool) && !partsFit(tool, componentsOf(entry, plugin));

/** Tools that can take the plugin itself here (or have it): what "In each tool" describes. A tool taking its parts, or none, is left out. */
const nativeTools = (view: PluginsView, entry: MarketplaceView, plugin: string, components: Components) =>
  view.tools.filter(tool => takesPlugins(tool) && !unavailable(view, entry, plugin, tool) && !partsOffer(view, entry, plugin, tool, components));

const tone: Record<Outcome['result'], string> = { works: 'tone-muted', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

/**
 * What installing does in each tool. Tools that behave the same share one line, so a real difference stands out. When
 * every part works everywhere (only names differ), it is a few plain lines; a limit anywhere makes it a table.
 */
function outcomesBlock(view: PluginsView, entry: MarketplaceView, plugin: PluginView, components: Components) {
  // A tool taking the plugin's parts instead (always Pi) is described by its own section.
  const tools = nativeTools(view, entry, plugin.name, components);
  const byTool = Object.fromEntries(tools.map(tool => [tool, outcomes(tool, components)])) as Record<HarnessId, Outcome[]>;
  const groups = groupBy(tools, tool => JSON.stringify(byTool[tool]));
  // A tool that prefixes names shows the real name a person types, e.g. document-tools:pdf-reader.
  const example = (kind: Outcome['names']) => `${plugin.name}:${kind === 'skill' ? components.skillNames?.[0] ?? 'skill' : 'agent'}`;
  const line = (outcome: Outcome) => h('span.plugin-outcome-item', {}, outcome.result === 'works' ? null : icon(glyph[outcome.result], 12, tone[outcome.result]),
    `${outcome.component} ${outcome.text}`, outcome.names ? [' ', h('code.plugin-name', {}, example(outcome.names))] : null);
  const allWork = tools.every(tool => byTool[tool].every(outcome => outcome.result === 'works'));
  return h(`ul.plugin-outcome-list${allWork ? '.plugin-outcome-plain' : ''}`, {}, [...groups.values()].map(tools => h('li.plugin-outcome-row', {},
    h('span.plugin-outcome-tools', {}, tools.map(tool => brandMark(tool, 14)), h('strong', {}, tools.map(tool => names[tool]).join(', '))),
    h('span.plugin-outcome-what', {}, byTool[tools[0]!].map(line)))));
}

/** "Installed · 1.2.0", then `more` ("differs from the marketplace’s copy", "1 skill off"). When the tool has another version than the marketplace offers, a second line says which. */
function installedLine(version: string | undefined, offered: string | undefined, more: string[] = []) {
  const line = [version ? `Installed · ${version}` : 'Installed', ...more].filter(Boolean).join(' · ');
  const other = marketplaceVersionNote(version, offered);
  return other ? [line, versionNote(other)] : line;
}

/** Each mark's short words on a tool's line (the whole sentence is its tooltip: pluginstatus.ts toolMark). */
const MARK_WORDS: Record<ToolMark, string> = {
  installed: 'Installed', outdated: 'Installed', parts: 'Parts installed', 'parts-changed': 'Parts out of date', items: 'Its items', stays: 'Still installed', waits: 'Goes in at the next check', 'not-brought': 'Not brought here: off in a tool’s own settings',
  missing: 'Not in it, though on', cannot: 'Not available', 'kept-out': 'Kept out', absent: 'Not installed', unknown: 'Can’t be read now', 'not-known': 'Unknown',
};

/**
 * Your tools: the plugin's switch at the heading, Update at its right where a copy or its parts are behind, and a line per
 * tool: its mark, what it has (always there; a tool on another version than the marketplace offers adds "Marketplace has …"),
 * and what can be done there, at once: Install there or Take out there where the plugin's table owes that tool something,
 * Keep out or Let in for a plugin on record. `compareTo`: the version an installed copy is compared with (see versionToCompare).
 */
function installPanel(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, compareTo: string | undefined, components?: Components) {
  const sw = entry.switches?.[plugin.name];
  const stopped = !view.canWrite ? PREVIEW_ONLY : view.switchProblem;
  // A tool where some part won't fully work names it under its mark; "In each tool" has the detail.
  const limits = (tool: HarnessId) => (components ? outcomes(tool, components).filter(outcome => outcome.result !== 'works') : []);
  const status = (tool: HarnessId, mark: ToolMark) => {
    const parts = partsOf(entry, plugin.name, tool);
    const stale = copyStale(entry, plugin.name, tool, compareTo, shownDetail(pluginKey(entry.source, plugin.name)));
    const state = stateOf(entry, plugin.name, tool);
    if (state.state === 'installed' && mark !== 'stays') {
      return installedLine(state.version, compareTo, [state.directory ? 'from the Anthropic Directory' : '', stale ? 'differs from the marketplace’s copy' : '', state.off ? 'off in its own settings' : '',
        state.skillsOff?.length ? `${plural(state.skillsOff.length, 'skill')} off` : '']);
    }
    // Fewer parts in than the plugin has for this tool (left out by choice, or refused): said, so a few never read as all.
    const all = plansFor(entry, plugin)?.[tool]?.filter(part => !part.wholeKind).length ?? 0;
    if (mark === 'parts' && parts && parts.items.length < all) return `${parts.items.length} of ${all} parts installed`;
    if (mark === 'waits' && !updatesRun()) return 'Waits for automatic updates';
    if (mark === 'items') return itemsOnWords(entry, plugin.name, tool);
    if (mark === 'cannot' && takesNoneOf(view, entry, plugin, tool)) return 'None of its parts fit';
    return [MARK_WORDS[mark], mark === 'absent' || mark === 'missing' ? limitNote(limits(tool)) : ''].filter(Boolean).join(' · ');
  };
  // At most two actions on a line: bring it into line there, and keep it out or let it in.
  const actions = (tool: HarnessId, mark: ToolMark) => {
    const owed = sw?.tools[tool], kept = !!sw?.entry?.except.includes(tool);
    const act = (label: string, what: PluginTurn, id: string, title: string) => button({ variant: 'link', size: 'micro', label, id: `${id}-${marketIndex}-${plugin.name}-${tool}`, disabled: !!app.busy || !!stopped,
      attrs: { title: stopped ?? title }, onclick: () => void turnPlugin(entry, plugin.name, what, tool) });
    const fix = owed?.act && (mark === 'missing' || mark === 'waits' || mark === 'not-brought' || mark === 'stays')
      ? (owed.act === 'install' || owed.act === 'install-parts' || owed.act === 'install-items' ? act('Install there', 'fix', 'pfix', `Puts it in ${names[tool]} now${owed.act === 'install' ? '' : ', as separate items'}. Undo takes it out again.`)
        : act('Take out there', 'fix', 'pfix', `Takes it out of ${names[tool]} now; the result says what Undo can put back.`)) : null;
    const keep = !sw?.entry || !owed?.takes ? null : kept ? act('Let in', 'let-in', 'pkeep', `Lets it into ${names[tool]} again${sw.entry.on ? ', and puts it in there now' : ''}. Undo keeps it out again.`)
      : act('Keep out', 'keep-out', 'pkeep', `Keeps it out of ${names[tool]}${owed.has !== 'none' ? ', and takes it out there now' : ''}; the automatic updates leave it out too. Undo lets it back in.`);
    return fix || keep ? h('span.plugin-tool-actions', {}, fix, keep) : null;
  };
  const updates = view.canWrite ? updateOps(view, entry, plugin) : [];
  const notIncluded = whyNotCarried(entry, plugin.name);
  return h('section.plugin-panel', { 'aria-label': 'Your tools' },
    h('div.plugin-panel-head', {}, h('span.plugin-panel-switch', {}, pluginSwitch(view, entry, plugin, `pswitch-page-${marketIndex}-${plugin.name}`), h('h3', {}, 'Your tools')),
      updates.length ? updateButton(updates, `pupdate-${marketIndex}-${plugin.name}`) : null),
    // A plugin a bundled build doesn't include says why here, on the page, once for every tool.
    notIncluded ? h('p.plugin-panel-hint', { id: 'plugin-not-included' }, notIncluded) : null,
    withToolCount(h('div.plugin-tool-rows', {}, view.tools.map(tool => {
      const { mark, words } = markOf(view, entry, plugin, tool, compareTo);
      return h('div.plugin-tool', { 'data-tool': tool }, markCell(view, entry, plugin, tool, marketIndex, compareTo),
        h('span.plugin-tool-text', {}, h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]), h('span.plugin-tool-state', { title: words }, status(tool, mark)),
          // With no CLI, its plugin commands run through the copy its desktop app carries: said so, never as the CLI.
          view.via?.[tool] ? h('span.plugin-tool-state.plugin-tool-via', { title: `${names[tool]}’s command-line tool wasn’t found, so its plugin commands run through ${view.via[tool]}.` }, `Through ${view.via[tool]}`) : null,
          actions(tool, mark)));
    })), view.tools.length),
    // Cowork has no box: with Claude desktop here, one line says which plugins it uses instead.
    hasCowork(app.home?.snapshots ?? []) ? h('p.plugin-panel-note', { id: 'plugin-cowork-note' }, coworkWords.plugin) : null);
}

/** What stays with the plugin in any tool without it: the parts that are never installed on their own. */
function pluginOnlyParts(detail: PluginDetail): string[] {
  return [detail.commands.length ? plural(detail.commands.length, 'command') : '', detail.hooks.length ? 'hooks' : '',
    detail.lspServers.length ? plural(detail.lspServers.length, 'language server') : '', detail.bin ? 'the bin/ folder' : ''].filter(Boolean);
}

/**
 * "skill triage · MCP servers a, b", the names in the face "What it holds" uses, from named parts. `linked`: the parts are
 * installed, so each name opens its item on the Skills, MCP servers or Agents page.
 */
function partNames(parts: Pick<PartPlan, 'kind' | 'name'>[], linked = false): (string | HTMLElement)[] {
  const named = (kind: PartPlan['kind'], name: string) => (linked
    ? h('button.inline-link.plugin-part-link', { type: 'button', title: `Open ${name} on the ${kind === 'skill' ? 'Skills' : kind === 'mcp' ? 'MCP servers' : 'Agents'} page`, onclick: () => openItem(pageOfPart[kind], name) }, h('code.plugin-name', {}, name))
    : h('code.plugin-name', {}, name));
  return (['skill', 'mcp', 'agent'] as const).filter(kind => parts.some(part => part.kind === kind)).flatMap((kind, at) => {
    const names = parts.filter(part => part.kind === kind).map(part => part.name);
    return [at ? ' · ' : '', `${partWords[kind][names.length > 1 ? 1 : 0]} `, ...names.flatMap((name, index) => [index ? ', ' : '', named(kind, name)])];
  });
}

/** Parts the plan would put in that aren't among those installed: ones left out before, whose place is free now. */
const newParts = (parts: PartsState, plan: PartPlan[] | undefined) => (plan ?? []).filter(part => !part.why && !part.out && !parts.items.some(item => samePart(item, part)));

/**
 * One tool's line in a plugin's parts table, in words: what is there and from which version, that the plugin has changed
 * since, what the person left out, or what can go in and what can't (`plan`, undefined while it is read: `reading`, or when
 * the plugin's files couldn't be read).
 */
function partsLine(parts: PartsState | undefined, plan: PartPlan[] | undefined, reading: boolean): (string | HTMLElement)[] {
  const going = (plan ?? []).filter(part => !part.why && !part.out);
  const named = (part: PartPlan) => [`${partWords[part.kind][0]} `, h('code.plugin-name', {}, part.name)];
  // Which parts can't go in; why is said once, at each one's switch under "What it holds".
  const cannot = (plan ?? []).filter(part => part.why);
  const missing = cannot.length ? [h('span.plugin-outcome-item', {}, icon('circle-off', 12, 'tone-faint'), 'Can’t go in: ', ...partNames(cannot), ' (What it holds says why)')] : [];
  const limited = going.filter(part => part.limit).map(part => h('span.plugin-outcome-item', {}, icon('circle-minus', 12, 'tone-warning'), 'The ', ...named(part), `: ${part.limit}`));
  // Parts the person turned off or removed there: said once, since an update leaves them out; their switches turn them on.
  const outs = (plan ?? []).filter(part => part.out);
  const left = outs.length ? [h('span.plugin-outcome-item', {}, icon('circle-minus', 12, 'tone-faint'), 'Left out by you: ', ...partNames(outs))] : [];
  // With parts there, what an update would leave out (changed since, the folder) is said under them.
  if (parts?.changed) return [h('span.plugin-outcome-item', {}, icon('refresh-cw', 12, 'tone-warning'), `Out of date. ${changedPartsWords(parts)}.`), h('span.plugin-outcome-item', {}, 'Installed: ', ...partNames(parts.items, true)), ...left, ...limited, ...missing];
  // A part left out earlier (its name was taken) that can go in now: Update parts adds it.
  const addable = parts ? newParts(parts, plan) : [];
  const adds = addable.length ? [h('span.plugin-outcome-item', {}, icon('plus', 12, 'tone-accent'), 'Can go in now: ', ...partNames(addable))] : [];
  if (parts) return [h('span.plugin-outcome-item', {}, `Installed${parts.version ? ` from ${versionWord(parts.version)}` : ''}: `, ...partNames(parts.items, true)), ...adds, ...left, ...limited, ...missing];
  if (!plan) return [h('span.plugin-outcome-item', {}, reading ? 'Reading its parts…' : 'Its files couldn’t be read.')];
  return [h('span.plugin-outcome-item', {}, ...(going.length ? ['Can go in: ', ...partNames(going)] : ['Nothing in it can go in here.'])), ...left, ...limited, ...missing];
}

/** A plugin's parts in a tool, only those the tool still has: one removed there by hand is no longer listed as installed. */
function partsStill(entry: MarketplaceView, plugin: string, tool: HarnessId): PartsState | undefined {
  const parts = partsOf(entry, plugin, tool);
  const items = parts && app.home ? parts.items.filter(item => partStillIn(app.home!, tool, item)) : parts?.items;
  return parts && items?.length ? { ...parts, items } : undefined;
}

/** Each tool's plan for a plugin's parts, once read; undefined while it is read or when the plugin's files couldn't be. */
function plansFor(entry: MarketplaceView, plugin: PluginView): Partial<Record<HarnessId, PartPlan[]>> | undefined {
  const read = market.partsPlans.get(pluginKey(entry.source, plugin.name));
  return read && !read.reading ? read.value ?? undefined : undefined;
}

/**
 * Tools that can't take the plugin can take its parts: each skill, MCP server and agent as a separate item, put in and taken
 * out by the plugin's switch (pluginrecord.ts). One row per tool (tools alike share one until anything is installed),
 * saying why the plugin can't go there, what is there and from which version, what changed, or what can go in. Its button,
 * Update parts, brings them up to date at once in the tools whose parts are out of date (or can take one left out before).
 */
function partsSection(view: PluginsView, entry: MarketplaceView, plugin: PluginView, components: Components | undefined, detail: PluginDetail | null | undefined) {
  const tools = view.tools.filter(tool => partsOffer(view, entry, plugin.name, tool, components));
  // A tool that takes parts but gets none of this plugin's (Pi and an agents-only plugin) still has its row, saying why.
  const empty = view.tools.filter(tool => !tools.includes(tool) && takesNoneOf(view, entry, plugin, tool));
  if (!tools.length && !empty.length) return null;
  const read = market.partsPlans.get(pluginKey(entry.source, plugin.name));
  const plans = plansFor(entry, plugin);
  const op = (tool: HarnessId): PluginOp => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action: 'install-parts' });
  const partsIn = (tool: HarnessId) => partsStill(entry, plugin.name, tool);
  // Out of date, or with a part left out before that can go in now, where the plugin is wanted: Update parts brings either in.
  const changed = tools.filter(tool => { const parts = partsIn(tool); return !!entry.switches?.[plugin.name]?.tools[tool]?.wanted && !!parts && (!!parts.changed || newParts(parts, plans?.[tool]).length > 0); });
  const which = (list: HarnessId[]) => (list.length > 2 ? `all ${list.length} tools` : andList(list.map(tool => names[tool])));
  const next = changed.length ? button({ variant: 'outline', size: 'small', id: `pparts-${plugin.name}`, disabled: !!app.busy, label: `Update parts in ${which(changed)}`,
    attrs: { title: `Brings its parts up to date in ${andList(changed.map(tool => names[tool]))} now; Undo puts them back.` }, onclick: () => void applyPluginOps(changed.map(op)) }) : null;
  // Before anything is installed, tools alike share a row; after, each tool has its own, in column order.
  const settled = tools.every(tool => !partsIn(tool));
  const groups = groupBy([...tools, ...empty].sort(byToolOrder), tool => (settled ? JSON.stringify([partsWhy(view, entry, tool)[0], plans?.[tool] ?? null]) : tool));
  const behind = detail && !detail.problem ? pluginOnlyParts(detail) : [];
  return h('section.plugin-section.plugin-parts-section', { 'aria-label': 'Its parts' },
    h('div.plugin-section-head', {}, h('h3', {}, 'Its parts'), view.canWrite ? h('span.plugin-section-actions', {}, next) : null),
    h('p.plugin-parts-about', {}, 'Where a tool can’t take this plugin, its skills, MCP servers and agents go in as separate items instead, all at once with the plugin’s switch. The switches under What it holds then put single parts in or take them out.'),
    h('ul.plugin-outcome-list.plugin-parts-list', {}, [...groups.values()].map(group => h('li.plugin-outcome-row', {},
      h('span.plugin-parts-tool', {}, h('span.plugin-outcome-tools', {}, group.map(tool => brandMark(tool, 14)), h('strong', {}, andList(group.map(tool => names[tool])))),
        partsWhy(view, entry, group[0]!)[0] ? h('span.plugin-parts-why', {}, partsWhy(view, entry, group[0]!)[group.length > 1 ? 1 : 0]) : null),
      h('span.plugin-outcome-what', {}, partsLine(partsIn(group[0]!), plans?.[group[0]!], !read || read.reading || (!!read.value && !plans?.[group[0]!])))))),
    behind.length ? h('p.plugin-muted', {}, `Stays with the plugin: ${andList(behind)}.`) : null);
}

/**
 * Its items: in Pi and OpenCode, which take no plugins, the plugin's skills, agents and MCP servers are items of Central Knot's
 * linked to it (pluginlibrary.ts itemsView, from the table the pass carries out). One line each, by kind, its name opening its
 * row, with its state where it isn't plain (On in each of those tools), or why a name of the plugin's is not brought in.
 */
function itemsSection(view: PluginsView, entry: MarketplaceView, plugin: PluginView) {
  const items = entry.items?.[plugin.name], tools = view.tools.filter(tool => !takesPlugins(tool));
  if (!items || !tools.length) return null;
  const state = (line: PluginItemLine): string => {
    const out = tools.filter(tool => line.except?.includes(tool)).map(tool => names[tool]);
    const where = line.on === false ? 'Off' : out.length ? `Kept out of ${andList(out)}` : '';
    const said = { linked: where, update: 'An update is ready: Update brings it in', going: 'No longer in the plugin: Update turns it off', new: 'New in the plugin: Update brings it in',
      removed: 'Removed by the plugin’s update, so it is off. Turning it on keeps it as yours', 'not-brought': `Not brought in: ${line.why ?? ''}` }[line.state];
    return [said, line.state === 'update' ? where : ''].filter(Boolean).join(' · ');
  };
  const linked = (line: PluginItemLine) => line.state !== 'new' && line.state !== 'not-brought';
  const lines = (['skill', 'agent', 'mcp'] as const).flatMap(kind => items.lines.filter(line => line.kind === kind));
  return h('section.plugin-section.plugin-items-section', { 'aria-label': 'Its items' },
    h('div.plugin-section-head', {}, h('h3', {}, 'Its items')),
    h('p.plugin-parts-about', {}, `In ${andList(tools.map(tool => names[tool]))}, its skills, agents and MCP servers are items of Central Knot’s that follow the plugin: its switch turns them on or off there, and one you change here becomes your own.`),
    items.problem ? h('p.plugin-muted', {}, `${items.problem} Its items stay as they are.`) : null,
    h('ul.plugin-outcome-list.plugin-items-list', {}, lines.map(line => h('li.plugin-outcome-row', { 'data-key': `${line.kind}:${line.key}` },
      h('span.plugin-items-name', {}, `${partWords[line.kind][0]} `, linked(line)
        ? h('button.inline-link.plugin-part-link', { type: 'button', title: `Open ${line.name} on the ${line.kind === 'skill' ? 'Skills' : line.kind === 'mcp' ? 'MCP servers' : 'Agents'} page`, onclick: () => openItem(pageOfPart[line.kind], line.name) }, h('code.plugin-name', {}, line.name))
        : h('code.plugin-name', {}, line.name)),
      h('span.plugin-outcome-what', {}, state(line))))));
}

/**
 * One group of named parts, each description held to two lines. Once laid out, a description that was cut gets a "Show
 * more" button (see markClamped); one that fits has none. `end`: controls at the row's end (a skill's switches); `note`: a
 * line under the description about those controls.
 */
const partList = (owner: string, parts: { name: string; text: string; mono?: boolean; end?: HTMLElement; note?: string }[]) => h('ul.plugin-parts', {}, parts.map(part => {
  const key = `${owner}\u0000${part.name}`;
  const open = market.opened.has(key);
  const more = h('button.part-more', { type: 'button', onclick: () => toggleOpened(key) }, open ? 'Show less' : 'Show more');
  return h(`li${open ? '.clamped' : ''}${part.end ? '.with-end' : ''}`, {},
    h('code.plugin-name', {}, part.name),
    // A row with switches keeps its middle column even with nothing in it, so the switches stay in the third.
    part.text ? h('span.plugin-part-body', {}, h(`span.plugin-part-what${part.mono ? '.mono' : ''}${open ? '.expanded' : ''}`, {}, part.text), more) : part.end ? h('span') : null,
    part.end ?? null,
    // Its own line under the description, as wide as description and switches together, so a command never breaks.
    part.note ? h('span.plugin-part-note', {}, ...inlineMarkdown(part.note, openLink)) : null);
}));

/**
 * One skill's switch in one tool where the plugin is installed (ENB-06): on or off there; a click turns it at once with that
 * tool's own switch. One that can't change here (`cantSwitchSkill`, such as held off by a switch that isn't the plugin's
 * own) shows where it stands with a lock, can't be clicked, and its row or column says why.
 */
function skillSwitch(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, skill: string, marketIndex: number) {
  const on = !skillOff(entry, plugin.name, tool, skill);
  const why = cantSwitchSkill(view, entry, plugin.name, tool, skill);
  const label = `${skill} in ${names[tool]}: ${on ? 'on' : 'off'}. ${why ?? `Click to turn it ${on ? 'off' : 'on'} now; Undo turns it back.`}`;
  const control = switchToggle({ on, label, disabled: !!app.busy || !!why, id: `pskill-${marketIndex}-${plugin.name}-${skill}-${tool}`,
    onchange: () => void applyPluginOps([{ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, skill, action: on ? 'skill-off' : 'skill-on' }]) });
  return h(`span.skill-switch${why ? '.skill-switch-stuck' : ''}`, { 'data-state': on ? 'on' : 'off' }, control, why ? icon('lock', 13, 'skill-switch-lock') : null);
}

/**
 * A row of "What it holds" as its switches see it: the name it is shown by (which the tools use for a plugin's skill), and
 * the name the parts engine knows it by (its folder or file, see `partRef`).
 */
interface SwitchRow { name: string; part?: PartRef }

/** What a group of rows adds beside them: lines above the list, and per row an end column and a note under it. */
interface RowExtras { className: string; head: (HTMLElement | null)[]; end?: (row: SwitchRow) => HTMLElement; note: (row: SwitchRow) => string | undefined }

/**
 * The part a skill or agent is to the parts engine, from its place in the plugin: a skill is its folder (`skills/tdd` is
 * `tdd`), an agent its file without `.md` or Copilot's `.agent.md`. Undefined for a skill that is the plugin's own folder,
 * which is no part of its own.
 */
function partRef(kind: 'skill' | 'agent', path: string): PartRef | undefined {
  const last = path.split(/[\\/]/).at(-1) ?? '';
  const name = kind === 'skill' ? last : nameOfFile(last);
  return name && name !== '.' ? { kind, name } : undefined;
}

/**
 * Where one part stands in a tool that takes single parts: in there as a separate item or not (`there`, from the parts the
 * tool still has), and why its switch can't change (`plan`: the tool's plan for the plugin's parts, once read).
 */
function standOf(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, part: PartRef, plan: PartPlan[] | undefined) {
  const planned = plan?.find(candidate => samePart(candidate, part));
  const there = !!partsStill(entry, plugin.name, tool)?.items.some(item => samePart(item, part));
  // One that is in needs no plan to come out, unless its folder can't be written through (`fixed`).
  const why = !view.canWrite ? PREVIEW_ONLY : there ? planned?.why ?? planned?.fixed : planned ? planned.why : 'It can’t go in here as a separate item.';
  return { there, why };
}

/**
 * One part's switch in one tool that takes single parts: in there as a separate item, or not; a click puts that one part in
 * or takes it out at once. One that can't go in (`standOf`) shows a lock, and its row says why.
 */
function partSwitch(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, part: PartRef, plan: PartPlan[] | undefined, marketIndex: number) {
  const { there, why } = standOf(view, entry, plugin, tool, part, plan);
  const does = there ? 'take it out' : 'put it in as a separate item';
  const label = `${part.name} in ${names[tool]}: ${there ? 'in, as a separate item' : 'not in'}. ${why ?? `Click to ${does} now; Undo puts it back.`}`;
  const pick = there ? { on: [], off: [part] } : { on: [part], off: [] };
  const control = switchToggle({ on: there, label, disabled: !!app.busy || !!why, id: `ppart-${marketIndex}-${plugin.name}-${part.kind}-${part.name}-${tool}`,
    onchange: () => void applyPluginOps([{ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action: 'pick-parts', pick }]) });
  return h(`span.skill-switch.part-switch${why ? '.skill-switch-stuck' : ''}`, { 'data-state': there ? 'in' : 'out' }, control, why ? icon('lock', 13, 'skill-switch-lock') : null);
}

/**
 * What the rows of one kind of part add (see fileGroup): a switch per row under each tool that has one for it.
 * - Where the plugin is installed, each skill has a switch per tool that can turn one skill off (ENB-06).
 * - Where a tool takes single parts (`partsPickable`), each part has a switch that puts it in as a separate item or takes
 *   it out; one that can't go in is locked.
 * Every reason a switch can't change is on the page, not only in hover text: once above the list when it holds for a
 * whole column (Claude Code, which has no switch for a plugin's skill, with its mark; a missing CLI; a preview-only home;
 * a tool none of these parts can go into), otherwise on the row.
 * `said` is shared by a page's lists, so what a part's switch does is explained once.
 */
function switchColumns(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, kind: PartKind, rows: SwitchRow[], said: { parts: boolean }): RowExtras {
  const tools = kind === 'skill' ? view.tools.filter(tool => installed(entry, plugin.name, tool)) : [];
  const switchable = tools.filter(tool => !NO_SKILL_SWITCH[tool]);
  const plans = plansFor(entry, plugin);
  const partRows = rows.filter((row): row is SwitchRow & { part: PartRef } => !!row.part);
  const stand = (tool: HarnessId, part: PartRef) => standOf(view, entry, plugin, tool, part, plans?.[tool]);
  // Tools that take single parts, once their plan is read. One that takes no part of this kind at all (Pi has no agents)
  // gets that reason said once above the list and no column of locks.
  const pickable = view.tools.filter(tool => !tools.includes(tool) && partsPickable(view, entry, plugin.name, tool) && !!plans?.[tool] && partRows.length > 0);
  const noneGoIn = (tool: HarnessId) => {
    const planned = partRows.map(row => plans![tool]!.find(part => samePart(part, row.part)));
    return planned.every(part => part?.wholeKind) && !partRows.some(row => stand(tool, row.part).there) ? planned[0]!.why : undefined;
  };
  const picking = pickable.filter(tool => !noneGoIn(tool));
  const columns = view.tools.filter(tool => switchable.includes(tool) || picking.includes(tool));
  const why = (tool: HarnessId, skill: string) => cantSwitchSkill(view, entry, plugin.name, tool, skill);
  // A reason every skill in a column shares (a missing CLI, a preview-only home) is said once above the list. A held
  // skill's reason is its own, so held skills don't count against the rest of their column.
  const sharedReason = (tool: HarnessId) => {
    const reasons = rows.filter(row => !skillOff(entry, plugin.name, tool, row.name)?.held).map(row => why(tool, row.name));
    return reasons[0] && reasons.every(reason => reason === reasons[0]) ? reasons[0] : undefined;
  };
  const columnWide = new Set([...switchable.map(sharedReason), picking.length && !view.canWrite ? PREVIEW_ONLY : undefined].filter((reason): reason is string => !!reason));
  const rowNote = (row: SwitchRow) => {
    const stuck = new Set(switchable.map(tool => why(tool, row.name)).filter((reason): reason is string => !!reason && !columnWide.has(reason)));
    const stands = row.part ? picking.map(tool => ({ tool, ...stand(tool, row.part!) })) : [];
    // Why this part can't go into a tool whose other parts can, naming the tool where the reason doesn't.
    const locked = stands.filter(at => at.why && !columnWide.has(at.why)).map(at => (at.why!.includes(names[at.tool]) ? at.why! : `${names[at.tool]}: ${at.why}`));
    return [...stuck, ...locked].join(' ') || undefined;
  };
  const line = (text: string, mark?: HarnessId) => h('p.plugin-skills-note', {}, mark ? brandMark(mark, 13) : null, ...inlineMarkdown(text, openLink));
  // Both kinds of switch in one list: each column says under its tool's name which kind it is.
  const mixed = switchable.length > 0 && picking.length > 0;
  // What a part's switch does is said once, above the first list that has one.
  const explain = picking.length > 0 && !said.parts;
  if (explain) said.parts = true;
  return {
    className: columns.length ? `plugin-switched${kind === 'skill' ? '.plugin-skills' : ''}` : kind === 'skill' ? 'plugin-skills' : '',
    head: [
      // With both kinds in one list, each column's label says which it is, and one line says what each does.
      mixed ? line('A switch “in the plugin” turns that skill off or back on there, without uninstalling the plugin. A “separate item” switch puts that one skill in, or takes it out.')
        : switchable.length ? line('Turn a skill off, or back on, without uninstalling the plugin.') : null,
      explain && !mixed ? line('A switch puts that one part in as a separate item, or takes it out again.') : null,
      ...tools.filter(tool => NO_SKILL_SWITCH[tool]).map(tool => line(NO_SKILL_SWITCH[tool]!, tool)),
      ...pickable.flatMap(tool => { const reason = noneGoIn(tool); return reason ? [line(reason, tool)] : []; }),
      ...[...columnWide].map(reason => line(reason)),
      // Disable is best effort: on a build older than the one exercised, or one whose version can't be read, only said.
      ...switchable.filter(tool => rows.some(row => !why(tool, row.name))).flatMap(tool => untestedBuild(tool, view.versions?.[tool]) ?? []).map(note => line(note)),
      columns.length ? h('div.skill-switch-cols', { 'aria-hidden': 'true' }, h('span.skill-switches', {}, columns.map(tool => h('span.skill-switch-head', { title: names[tool] },
        h('span.skill-switch-tool', {}, brandMark(tool, 14), names[tool]), mixed ? h('span.skill-switch-kind', {}, switchable.includes(tool) ? 'in the plugin' : 'separate item') : null)))) : null,
    ],
    end: columns.length ? row => h('span.skill-switches', {}, columns.map(tool => (switchable.includes(tool) ? skillSwitch(view, entry, plugin, tool, row.name, marketIndex)
      : row.part ? partSwitch(view, entry, plugin, tool, row.part, plans?.[tool], marketIndex) : h('span.skill-switch.skill-switch-none', { title: `${row.name} is the plugin’s own folder, so it can’t go into ${names[tool]} as a separate item.` })))) : undefined,
    note: rowNote,
  };
}

/** After layout: marks each part whose description was cut at two lines, which shows its "Show more". */
function markClamped(): void {
  for (const what of document.querySelectorAll<HTMLElement>('.plugin-part-what:not(.expanded)')) {
    what.closest('li')?.classList.toggle('clamped', what.scrollHeight > what.clientHeight + 1);
  }
}

/** One copy of a part's file: who holds it (the marketplace or a tool), at which version, and its text. */
interface FileCopy { who: string; version?: string; text: string; marketplace: boolean }
/**
 * A skill, command or agent as listed: where it sits in the plugin (`key`, the same in every copy, so two parts that share
 * a name stay apart), its name, what it says it does, and its file in each copy that has it.
 */
interface FilePart { key: string; name: string; description: string; copies: FileCopy[] }
type FileKind = 'skills' | 'commands' | 'agents';
/** Each kind of part with a file: its heading in "What it holds", and what its file is called above its text. */
const fileKinds: Record<FileKind, { title: string; file: string }> = {
  skills: { title: 'Skills', file: 'SKILL.md' }, commands: { title: 'Commands', file: 'Command file' }, agents: { title: 'Agents', file: 'Agent file' },
};

/**
 * Lays out "Your tools" by the box's width, decided here once (data-layout, which style.css keys off): with room for a
 * column per tool, each tool gets one from the left; otherwise they wrap in a row. Run after layout (dom.ts afterLayout),
 * before the page is painted.
 */
function settlePluginTools(): void {
  const rows = document.querySelector<HTMLElement>('.plugin-tool-rows');
  if (!rows?.firstElementChild) return;
  const tools = Number(rows.dataset.tools ?? 1), style = getComputedStyle(rows), px = (name: string) => parseFloat(style.getPropertyValue(name));
  rows.dataset.layout = rows.clientWidth >= tools * (px('--tool-min') + px('--tool-gap')) ? 'columns' : 'wrap';
}

// What depends on width, once the page is drawn and whenever the content changes width: which descriptions are cut, and
// how "Your tools" sits.
afterLayout(markClamped);
afterLayout(settlePluginTools);


/** One kind of part across the marketplace's copy and each tool's installed copy, matched by place in the plugin, each copy with its version. */
function filePartsOf(kind: FileKind, detail: PluginDetail, offered: string | undefined): FilePart[] {
  const sources = [{ who: 'Marketplace', version: offered, marketplace: true, parts: detail[kind] },
    ...Object.entries(detail.installed ?? {}).map(([tool, copy]) => ({ who: names[tool as HarnessId], version: copy.version, marketplace: false, parts: copy[kind] }))];
  const byKey = new Map<string, FilePart>();
  for (const { parts, ...holder } of sources) {
    for (const part of parts) {
      if (!byKey.has(part.path)) byKey.set(part.path, { key: part.path, name: part.name, description: part.description, copies: [] });
      byKey.get(part.path)!.copies.push({ ...holder, text: part.text });
    }
  }
  return [...byKey.values()].sort((first, second) => first.name.localeCompare(second.name) || first.key.localeCompare(second.key));
}

/** Who holds one text, each with its version: "Marketplace (1.2.0), Codex (1.2.0) and Claude Code (1.1.0)". */
const holdersLine = (holders: FileCopy[]) => andList(holders.map(holder => (holder.version ? `${holder.who} (${holder.version})` : holder.who)));

/**
 * The tools whose copy of a part's file differs from the marketplace's, with their versions (none when the marketplace's
 * isn't known). Line endings alone are no difference (see comparableText in pluginstatus.ts).
 */
function differsIn(part: FilePart): FileCopy[] {
  const offered = part.copies.find(copy => copy.marketplace);
  return offered ? part.copies.filter(copy => !copy.marketplace && comparableText(copy.text) !== comparableText(offered.text)) : [];
}

/**
 * The line above one text of a part's file: the file, then who holds that text ("SKILL.md · Claude Code (1.1.0)"). When
 * every copy has the same text (`distinct` is 1) and there is more than one copy, it says so ("SKILL.md · the same in …").
 */
const fileCaption = (kind: FileKind, holders: FileCopy[], distinct: number) =>
  `${fileKinds[kind].file} · ${distinct === 1 && holders.length > 1 ? 'the same in ' : ''}${holdersLine(holders)}`;

/**
 * Under a closed row's description: which tools' copies differ from the marketplace's; or, for a part the marketplace's
 * copy doesn't have while its files were read (`offeredRead`), which tools have it ("Only in Claude Code (0.9.0)", as when
 * a skill moved between releases). Nothing otherwise.
 */
function differsNote(part: FilePart, differs: FileCopy[], offeredRead: boolean) {
  if (differs.length) return versionNote(`${holdersLine(differs)} ${differs.length > 1 ? 'differ' : 'differs'} from the marketplace’s copy`);
  return offeredRead && !part.copies.some(copy => copy.marketplace) ? versionNote(`Only in ${holdersLine(part.copies)}`) : null;
}

/**
 * Element ids for parts, readable and unique on one page: "skills/pdf-reader" gives "skills-pdf-reader"; a second part
 * that would read the same (commands/git/commit.md and commands/git-commit.md) gets "-2" after it.
 */
function partIds(prefix: string) {
  const used = new Set<string>();
  return (key: string) => {
    const base = `${prefix}-${key.replace(/[^\w-]+/g, '-')}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
}

/**
 * One group of skills, commands or agents. A row opens its file as written, in the view the Skills page gives a
 * standalone SKILL.md, each text named by who holds it, and a text that differs from the marketplace's in the warning
 * tone. A closed row says which tools' copies differ. A description stays at two lines, since the file holds it whole.
 * `owner` (the plugin's key) keeps what is opened its own; `idFor` gives each part its element id; `offeredRead` says the
 * marketplace's own copy was read (see differsNote); `extras` adds the rows' switches (see switchColumns).
 */
function fileGroup(owner: string, idFor: (key: string) => string, kind: FileKind, parts: FilePart[], offeredRead: boolean, extras?: RowExtras) {
  if (!parts.length) return null;
  return h(`div.plugin-group${extras?.className ? `.${extras.className}` : ''}`, {}, h('h4', {}, `${fileKinds[kind].title} (${parts.length})`), ...(extras?.head ?? []), h('ul.plugin-parts', {}, parts.map(part => {
    const opened = `${owner}\u0000${kind}\u0000${part.key}`;
    const open = market.opened.has(opened);
    const id = idFor(part.key);
    const differs = differsIn(part);
    const label = `${part.name}: ${fileKinds[kind].file}`;
    const isOdd = (holders: FileCopy[]) => differs.length > 0 && !holders.some(holder => holder.marketplace);
    const row: SwitchRow = { name: part.name, part: kind === 'commands' ? undefined : partRef(kind === 'skills' ? 'skill' : 'agent', part.key) };
    const end = extras?.end?.(row), note = extras?.note(row);
    return h(`li${open ? '.open' : ''}${end ? '.with-end' : ''}`, {},
      h('button.plugin-file-toggle', { type: 'button', id, 'aria-expanded': String(open), title: `${open ? 'Hide' : 'Show'} ${label}`, onclick: () => toggleOpened(opened) },
        h('span.plugin-file-name', {}, icon(open ? 'chevron-down' : 'chevron-right', 13), h('code.plugin-name', {}, part.name)),
        h('span.plugin-part-body', {}, part.description ? h('span.plugin-part-what', { title: part.description }, part.description) : null, differsNote(part, differs, offeredRead))),
      end ?? null,
      note ? h('span.plugin-part-note', {}, ...inlineMarkdown(note, openLink)) : null,
      open ? h('div.plugin-file', {}, fileBlocks(`${id}-text`, label, part.copies, (holders, distinct) => fileCaption(kind, holders, distinct), { named: true, warn: isOdd, same: comparableText })) : null);
  })));
}

/**
 * The plugin's parts by name, with what each says it does; skills, commands and agents open their files. What is opened
 * is kept per plugin; element ids start with the marketplace's place in the list (`marketIndex`).
 */
function contentsBlock(view: PluginsView, entry: MarketplaceView, marketIndex: number, plugin: PluginView, detail: PluginDetail | null | undefined, reading: boolean, offered: string | undefined) {
  const owner = pluginKey(entry.source, plugin.name);
  const section = (...children: (HTMLElement | null)[]) => h('section.plugin-section', {}, h('h3', {}, 'What it holds'), ...children);
  if (reading) return section(h('p.plugin-muted', {}, plugin.folder ? 'Reading…' : `Reading its files from ${plugin.from?.label ?? 'its repository'}…`));
  if (!detail) return section(h('p.plugin-muted', {}, whyNotCarried(entry, plugin.name) ? `Its files aren’t in ${entry.bundled!.app}, so what it holds can’t be shown here.`
    : plugin.folder ? 'Its files couldn’t be read.' : plugin.gone ? 'The marketplace no longer has its files, and no tool’s copy could be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const files = (['skills', 'commands', 'agents'] as const).map(kind => ({ kind, parts: filePartsOf(kind, detail, offered) }));
  const empty = files.every(({ parts }) => !parts.length) && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length && !detail.bin;
  const idFor = partIds(`pfile-${marketIndex}`);
  const said = { parts: false };
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem)
      : !detail.offered ? h('p.plugin-muted', {}, plugin.gone ? 'The marketplace no longer has its files, so its skills, commands and agents are read from the tools that still have it.' : 'Its files live outside this marketplace, so its skills, commands and agents are read from the tools that installed it.') : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    ...files.map(({ kind, parts }) => fileGroup(owner, idFor, kind, parts, detail.offered, kind === 'commands' ? undefined
      : switchColumns(view, entry, plugin, marketIndex, kind === 'skills' ? 'skill' : 'agent', parts.map(part => ({ name: part.name, part: partRef(kind === 'skills' ? 'skill' : 'agent', part.key) })), said))),
    detail.hooks.length ? h('div.plugin-group', {}, h('h4', {}, 'Hooks'), h('p.plugin-part-what', {}, `Runs on ${andList(detail.hooks)}. Hooks run commands in the tool while you work.`)) : null,
    detail.mcpServers.length ? serverGroup(view, entry, plugin, marketIndex, owner, detail.mcpServers, said) : null,
    detail.lspServers.length ? h('div.plugin-group', {}, h('h4', {}, `Language servers (${detail.lspServers.length})`), partList(`${owner}\u0000lsp`, detail.lspServers.map(name => ({ name, text: '' })))) : null,
    detail.bin ? h('div.plugin-group', {}, h('h4', {}, 'Programs'), partList(`${owner}\u0000bin`, [{ name: 'bin/', text: 'A folder of programs the plugin puts on the tool’s path.' }])) : null);
}

/** The plugin's MCP servers, each with what it runs, and its switch under each tool that takes single parts (see switchColumns). */
function serverGroup(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, owner: string, servers: PluginDetail['mcpServers'], said: { parts: boolean }) {
  const rows = servers.map(server => ({ name: server.name, part: { kind: 'mcp' as const, name: server.name } }));
  const extras = switchColumns(view, entry, plugin, marketIndex, 'mcp', rows, said);
  return h(`div.plugin-group${extras.className ? `.${extras.className}` : ''}`, {}, h('h4', {}, `MCP servers (${servers.length})`), ...extras.head,
    partList(`${owner}\u0000mcp`, servers.map((server, at) => ({ name: server.name, text: server.runs, mono: true, end: extras.end?.(rows[at]!), note: extras.note(rows[at]!) }))));
}

export function pluginPage(view: PluginsView, entry: MarketplaceView, marketIndex: number, plugin: PluginView) {
  const detail = shownDetail(pluginKey(entry.source, plugin.name));
  const reading = detail === undefined;
  // A plugin kept elsewhere has no counts from the catalog; once its files are read, its contents give them (componentsOf).
  const components = componentsOf(entry, plugin);
  const title = pluginTitle(plugin);
  const offered = offeredVersion(plugin, detail);
  const facts: (string | HTMLElement)[] = [plugin.author && `By ${plugin.author}`, plugin.category, plugin.license].filter((fact): fact is string => !!fact);
  if (offered) facts.unshift(h('span.plugin-meta-version', { title: 'The version the marketplace offers' }, `Version ${offered}`));
  if (plugin.homepage) facts.push(button({ variant: 'link', size: 'micro', label: 'Website', id: 'plugin-homepage', onclick: () => openLink(plugin.homepage!) }));
  if (plugin.from) facts.push(plugin.from.url ? button({ variant: 'link', size: 'micro', label: plugin.from.label, id: 'plugin-source', onclick: () => openLink(plugin.from!.url!) }) : `From ${plugin.from.label}`);
  // Names and descriptions only: the README is cached by what it is given, and whole files would make that key huge.
  const parts = detail ? [...detail.skills, ...detail.commands, ...detail.agents].map(({ name, description }) => ({ name, description })) : [];
  const descriptions = [plugin.description, ...parts.map(part => part.description)];
  return h('article.plugin-page', { 'aria-label': title },
    h('header.plugin-head', {},
      h('h2', {}, title, noLongerOffered(entry, plugin) ? h('span.plugin-chip.plugin-chip-gone', {}, 'No longer offered') : null),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      facts.length ? h('p.plugin-meta', {}, dotted(facts)) : null),
    installPanel(view, entry, plugin, marketIndex, versionToCompare(plugin, detail), components),
    partsSection(view, entry, plugin, components, detail),
    itemsSection(view, entry, plugin),
    // What it holds and how each tool takes it, beside the README on a wide page (style.css), one above the other otherwise.
    h('div.plugin-columns', {},
      h('div.plugin-column', {},
        contentsBlock(view, entry, marketIndex, plugin, detail, reading, offered),
        components && nativeTools(view, entry, plugin.name, components).length ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, entry, plugin, components)) : null),
      detail?.readme ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'Readme'), h('div.plugin-readme-body', {}, readme(detail.readme, plugin.name, descriptions, parts))) : null));
}

// One plugin's page: what it is and which version each tool has, where to install it, what it holds (each skill, command
// and agent's file as written), what each tool does with it, and its README.
import { rerender, state as app } from './app.ts';
import { afterLayout, button, fileBlocks, h, icon, toggle as switchToggle, withToolCount } from './dom.ts';
import { brandMark } from './brand.ts';
import { groupBy } from './model.ts';
import { componentsFrom, outcomes } from './pluginoutcomes.ts';
import { changedWords, componentsOf, dotted, pluginTitle, readme, toolBox, versionNote } from './pluginparts.ts';
import { inlineMarkdown } from './markdown.ts';
import { allQueued, pluginKey, queued, skillChoices, toggle, toggleMany, type PluginAction, type PluginOp } from './pluginplan.ts';
import { cantSwitchSkill, comparableText, installed, limitNote, marketplaceVersionNote, NO_SKILL_SWITCH, offeredVersion, pageOfPart, partsEligible, partsFit, partsMark, partsOf, partsOffer, partStillIn, partsWhy, partWords, removableTools, samePart, skillOff, stateOf, toolsWithoutPlugin, unavailable, untestedBuild, versionToCompare, versionWord } from './pluginstatus.ts';
import { takesPlugins } from './presence.ts';
import { clearNotice, market, openLink, shownDetail, toggleOpened } from './pluginstate.ts';
import type { Components, HarnessId, MarketplaceView, Outcome, PartPlan, PartsState, PluginDetail, PluginView, PluginsView } from './types.ts';
import { plural } from './model.ts';
import { andList, byToolOrder, toolNames as names } from './words.ts';
import { openItem } from './matrix.ts';

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

/** "Installed · 1.2.0", then `more` ("1 skill off"). When the tool has another version than the marketplace offers, a second line says which. */
function installedLine(version: string | undefined, offered: string | undefined, more: string[] = []) {
  const line = [version ? `Installed · ${version}` : 'Installed', ...more].filter(Boolean).join(' · ');
  const other = marketplaceVersionNote(version, offered);
  return other ? [line, versionNote(other)] : line;
}

/**
 * Where to install it: a box per tool with a status line that is always there (a tool on another version than the
 * marketplace offers adds a second, "Marketplace has …"), and at the right of the heading row (always the same height)
 * one button: choose it for every tool still without it, or, once every tool has it, choose to uninstall it from all of
 * them. An installed tool's line names its version, compared with `compareTo` (see versionToCompare).
 */
function installPanel(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, compareTo: string | undefined, components?: Components) {
  const missing = toolsWithoutPlugin(view, entry, plugin.name);
  const ops: PluginOp[] = missing.map(tool => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action: 'install' }));
  // A tool where some part won't fully work names it under its box, where the choice is made; "In each tool" has the detail.
  const limits = (tool: HarnessId) => (components ? outcomes(tool, components).filter(outcome => outcome.result !== 'works') : []);
  const status = (tool: HarnessId) => {
    const chosen = queued(market.draft, entry.source, plugin.name, tool);
    const parts = partsOf(entry, plugin.name, tool);
    if (chosen) return ({ install: 'Will install', remove: 'Will uninstall', 'install-parts': parts ? 'Will update its parts' : 'Will install its parts', 'remove-parts': 'Will remove its parts' } as Partial<Record<PluginAction, string>>)[chosen] ?? '';
    const state = stateOf(entry, plugin.name, tool);
    if (state.state === 'installed') {
      const switching = (action: PluginOp['action']) => skillChoices(market.draft, entry.source, plugin.name, { tool }).filter(op => op.action === action).length;
      const willOff = switching('skill-off'), willOn = switching('skill-on');
      return installedLine(state.version, compareTo, [state.skillsOff?.length ? `${plural(state.skillsOff.length, 'skill')} off` : '',
        willOff ? `${plural(willOff, 'skill')} will turn off` : '', willOn ? `${plural(willOn, 'skill')} will turn on` : '']);
    }
    const mark = partsMark(view, entry, plugin.name, tool, components);
    if (mark) return ({ changed: 'Parts out of date', installed: 'Parts installed', offer: 'Can take its parts' } as const)[mark];
    if (takesNoneOf(view, entry, plugin, tool)) return 'None of its parts fit';
    if (unavailable(view, entry, plugin.name, tool)) return 'Not available';
    return ['Plugin not installed', limitNote(limits(tool))].filter(Boolean).join(' · ');
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
    h('div.plugin-panel-head', {}, h('h3', {}, 'Your tools')),
    view.canWrite ? h('p.plugin-panel-hint', {}, 'A box or button only chooses; nothing changes until Apply all.') : null,
    // The tools from the left under the heading, each in a column of capped width, and the button for all of them at the
    // right end; a box too narrow for that puts them in a row that wraps (settlePluginTools).
    withToolCount(h('div.plugin-tool-rows', {}, view.tools.map(tool => h('div.plugin-tool', {}, toolBox(view, entry, plugin, tool, marketIndex, compareTo),
      h('span.plugin-tool-text', {}, h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]), h('span.plugin-tool-state', { title: why(tool) }, status(tool))))), allButton), view.tools.length));
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
const newParts = (parts: PartsState, plan: PartPlan[] | undefined) => (plan ?? []).filter(part => !part.why && !parts.items.some(item => samePart(item, part)));

/**
 * One tool's line in a plugin's parts table, in words: what Apply all will do (`pending`), what is there and from which
 * version, that the plugin has changed since, or what can go in and what can't (`plan`, undefined while it is read:
 * `reading`, or when the plugin's files couldn't be read).
 */
function partsLine(parts: PartsState | undefined, plan: PartPlan[] | undefined, pending: PluginAction | undefined, reading: boolean): (string | HTMLElement)[] {
  const going = (plan ?? []).filter(part => !part.why);
  if (pending === 'remove-parts' && parts) return [h('span.plugin-outcome-item', {}, h('span.tone-danger', {}, 'Will remove on Apply all:'), ' ', ...partNames(parts.items))];
  if (pending === 'install-parts') return [h('span.plugin-outcome-item', {}, h('span.tone-accent', {}, `Will ${parts ? 'update' : 'install'} on Apply all:`), ' ',
    ...(going.length ? partNames(going) : ['nothing it can change: each part was changed, removed or managed since']))];
  const missing = (plan ?? []).filter(part => part.why).map(part => h('span.plugin-outcome-item', {}, icon('circle-off', 12, 'tone-faint'), `Not the ${partWords[part.kind][0]} ${part.name}: ${part.why!.replace(/\.$/, '')}`));
  const limited = (plan ?? []).filter(part => part.limit).map(part => h('span.plugin-outcome-item', {}, icon('circle-minus', 12, 'tone-warning'), `The ${partWords[part.kind][0]} ${part.name}: ${part.limit}`));
  // With parts there, what an update would leave out (removed by you, changed since, the folder) is said under them.
  if (parts?.changed) return [h('span.plugin-outcome-item', {}, icon('refresh-cw', 12, 'tone-warning'), `Out of date. ${changedWords(parts)}.`), h('span.plugin-outcome-item', {}, 'Installed: ', ...partNames(parts.items, true)), ...limited, ...missing];
  // A part left out earlier (its name was taken) that can go in now: Update parts adds it.
  const addable = parts ? newParts(parts, plan) : [];
  const adds = addable.length ? [h('span.plugin-outcome-item', {}, icon('plus', 12, 'tone-accent'), 'Can go in now: ', ...partNames(addable))] : [];
  if (parts) return [h('span.plugin-outcome-item', {}, `Installed${parts.version ? ` from ${versionWord(parts.version)}` : ''}: `, ...partNames(parts.items, true)), ...adds, ...limited, ...missing];
  if (!plan) return [h('span.plugin-outcome-item', {}, reading ? 'Reading its parts…' : 'Its files couldn’t be read.')];
  return [h('span.plugin-outcome-item', {}, ...(going.length ? ['Can go in: ', ...partNames(going)] : ['Nothing in it can go in here.'])), ...limited, ...missing];
}

/**
 * Tools that can't take the plugin can take its parts: each skill, MCP server and agent as a separate item. One row per
 * tool (tools alike share one until anything is installed or chosen), saying why the plugin can't go there and what Apply
 * all will do, what is there and from which version, what changed, or what can go in. Its buttons choose for the tools
 * not chosen yet: update parts that are out of date, else install them where they aren't; a quieter one removes them.
 */
function partsSection(view: PluginsView, entry: MarketplaceView, plugin: PluginView, components: Components | undefined, detail: PluginDetail | null | undefined) {
  const tools = view.tools.filter(tool => partsOffer(view, entry, plugin.name, tool, components));
  // A tool that takes parts but gets none of this plugin's (Pi and an agents-only plugin) still has its row, saying why.
  const empty = view.tools.filter(tool => !tools.includes(tool) && takesNoneOf(view, entry, plugin, tool));
  if (!tools.length && !empty.length) return null;
  const read = market.partsPlans.get(pluginKey(entry.source, plugin.name));
  const plans = read && !read.reading ? read.value : undefined;
  const op = (tool: HarnessId, action: PluginAction): PluginOp => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action });
  // Only the parts the tool still has: one removed there by hand is no longer listed as installed.
  const partsIn = (tool: HarnessId) => {
    const parts = partsOf(entry, plugin.name, tool);
    const items = parts && app.home ? parts.items.filter(item => partStillIn(app.home!, tool, item)) : parts?.items;
    return parts && items?.length ? { ...parts, items } : undefined;
  };
  const chosen = (tool: HarnessId) => queued(market.draft, entry.source, plugin.name, tool);
  // The buttons choose for the tools not chosen yet; the boxes take a choice back.
  const open = tools.filter(tool => !chosen(tool));
  // Out of date, or with a part left out before that can go in now: Update parts brings either in.
  const changed = open.filter(tool => { const parts = partsIn(tool); return !!parts && (!!parts.changed || newParts(parts, plans?.[tool]).length > 0); });
  const without = open.filter(tool => !partsIn(tool));
  const holding = open.filter(tool => partsIn(tool));
  const choose = (batch: PluginOp[], label: string, id: string, variant: 'outline' | 'ghost', glyph?: Parameters<typeof icon>[0]) => button({ variant, size: 'small', id, disabled: !!app.busy, icon: glyph,
    label, onclick: () => { toggleMany(market.draft, batch); clearNotice(); rerender(); } });
  const which = (list: HarnessId[]) => (list.length > 2 ? `all ${list.length} tools` : andList(list.map(tool => names[tool])));
  const next = changed.length ? choose(changed.map(tool => op(tool, 'install-parts')), `Update parts in ${which(changed)}`, `pparts-${plugin.name}`, 'outline')
    : without.length ? choose(without.map(tool => op(tool, 'install-parts')), `Install parts in ${which(without)}`, `pparts-${plugin.name}`, 'outline') : null;
  const removal = holding.length ? choose(holding.map(tool => op(tool, 'remove-parts')), `Remove parts from ${which(holding)}`, `punparts-${plugin.name}`, next ? 'ghost' : 'outline', 'circle-minus') : null;
  // Before anything is installed or chosen, tools alike share a row; after, each tool has its own, in column order.
  const settled = tools.every(tool => !partsIn(tool) && !chosen(tool));
  const groups = groupBy([...tools, ...empty].sort(byToolOrder), tool => (settled ? JSON.stringify([partsWhy(view, entry, tool)[0], plans?.[tool] ?? null]) : tool));
  const behind = detail && !detail.problem ? pluginOnlyParts(detail) : [];
  return h('section.plugin-section.plugin-parts-section', { 'aria-label': 'Its parts' },
    h('div.plugin-section-head', {}, h('h3', {}, 'Its parts'), view.canWrite ? h('span.plugin-section-actions', {}, removal, next) : null),
    h('p.plugin-parts-about', {}, 'Where a tool can’t take this plugin, its skills, MCP servers and agents can go in as separate items instead, and come out together.'),
    h('ul.plugin-outcome-list.plugin-parts-list', {}, [...groups.values()].map(group => h('li.plugin-outcome-row', {},
      h('span.plugin-parts-tool', {}, h('span.plugin-outcome-tools', {}, group.map(tool => brandMark(tool, 14)), h('strong', {}, andList(group.map(tool => names[tool])))),
        partsWhy(view, entry, group[0]!)[0] ? h('span.plugin-parts-why', {}, partsWhy(view, entry, group[0]!)[group.length > 1 ? 1 : 0]) : null),
      h('span.plugin-outcome-what', {}, partsLine(partsIn(group[0]!), plans?.[group[0]!], chosen(group[0]!), !read || read.reading || (!!read.value && !plans?.[group[0]!])))))),
    behind.length ? h('p.plugin-muted', {}, `Stays with the plugin: ${andList(behind)}.`) : null);
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
 * One skill's switch in one tool where the plugin is installed (ENB-06): on or off there, or, chosen for Apply all, in the
 * position it will take, marked as waiting. One that can't change here (`cantSwitchSkill`, such as held off by a switch
 * that isn't the plugin's own) shows where it stands with a lock, can't be clicked, and its row or column says why.
 */
function skillSwitch(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, skill: string, marketIndex: number) {
  const off = skillOff(entry, plugin.name, tool, skill);
  const chosen = queued(market.draft, entry.source, plugin.name, tool, skill);
  const on = chosen ? chosen === 'skill-on' : !off;
  const why = chosen ? undefined : cantSwitchSkill(view, entry, plugin.name, tool, skill);
  const where = `${skill} in ${names[tool]}`;
  const label = chosen ? `${where}: turned ${on ? 'on' : 'off'} on Apply all. Click to leave it ${on ? 'off' : 'on'}.`
    : `${where}: ${on ? 'on' : 'off'}. ${why ?? `Click to turn it ${on ? 'off' : 'on'} on Apply all.`}`;
  const control = switchToggle({ on, label, onchange: () => {
    toggle(market.draft, { source: entry.source, marketName: entry.name, plugin: plugin.name, tool, skill, action: chosen ?? (off ? 'skill-on' : 'skill-off') });
    clearNotice();
    rerender();
  }, disabled: !!app.busy || !!why, id: `pskill-${marketIndex}-${plugin.name}-${skill}-${tool}` });
  return h(`span.skill-switch${chosen ? '.skill-switch-chosen' : ''}${why ? '.skill-switch-stuck' : ''}`, { 'data-state': chosen ?? (on ? 'on' : 'off') },
    control, why ? icon('lock', 13, 'skill-switch-lock') : null);
}

/** What a group of file rows adds beside its files: lines above the list, and per part (by name) an end column and a note under it. */
interface RowExtras { className: string; head: (HTMLElement | null)[]; end?: (name: string) => HTMLElement; note: (name: string) => string | undefined }

/**
 * What the plugin's skill rows add (see fileGroup). Where it is installed, each skill has a switch per tool that can turn
 * one skill off (ENB-06), under that tool's name. Every reason a switch can't change is on the page, not only in hover
 * text: once above the list when it holds for a whole column (Claude Code, which has no such switch, with its mark; a
 * missing CLI; a preview-only home), otherwise on the skill's row, which also says what its chosen switches will do on
 * Apply all.
 */
function skillSwitches(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, skills: { name: string }[]): RowExtras {
  const tools = view.tools.filter(tool => installed(entry, plugin.name, tool));
  const switchable = tools.filter(tool => !NO_SKILL_SWITCH[tool]);
  const why = (tool: HarnessId, skill: string) => cantSwitchSkill(view, entry, plugin.name, tool, skill);
  // A reason every skill in a column shares (a missing CLI, a preview-only home) is said once above the list. A held
  // skill's reason is its own, so held skills don't count against the rest of their column.
  const sharedReason = (tool: HarnessId) => {
    const reasons = skills.filter(part => !skillOff(entry, plugin.name, tool, part.name)?.held).map(part => why(tool, part.name));
    return reasons[0] && reasons.every(reason => reason === reasons[0]) ? reasons[0] : undefined;
  };
  const columnWide = new Set(switchable.map(sharedReason).filter((reason): reason is string => !!reason));
  const rowNote = (skill: string) => {
    const chosen = (action: PluginOp['action']) => switchable.filter(tool => queued(market.draft, entry.source, plugin.name, tool, skill) === action).map(tool => names[tool]);
    const stuck = new Set(switchable.map(tool => why(tool, skill)).filter((reason): reason is string => !!reason && !columnWide.has(reason)));
    const notes = [chosen('skill-off').length ? `Turns off in ${andList(chosen('skill-off'))} on Apply all.` : '', chosen('skill-on').length ? `Turns back on in ${andList(chosen('skill-on'))} on Apply all.` : '', ...stuck];
    return notes.filter(Boolean).join(' ') || undefined;
  };
  const line = (text: string, mark?: HarnessId) => h('p.plugin-skills-note', {}, mark ? brandMark(mark, 13) : null, ...inlineMarkdown(text, openLink));
  return {
    className: 'plugin-skills',
    head: [
      switchable.length ? line('Turn a skill off, or back on, without uninstalling the plugin; nothing changes until Apply all.') : null,
      ...tools.filter(tool => NO_SKILL_SWITCH[tool]).map(tool => line(NO_SKILL_SWITCH[tool]!, tool)),
      ...[...columnWide].map(reason => line(reason)),
      // Disable is best effort: on a build older than the one exercised, or one whose version can't be read, only said.
      ...switchable.filter(tool => skills.some(part => !why(tool, part.name))).flatMap(tool => untestedBuild(tool, view.versions?.[tool]) ?? []).map(note => line(note)),
      switchable.length ? h('div.skill-switch-cols', { 'aria-hidden': 'true' }, h('span.skill-switches', {}, switchable.map(tool => h('span.skill-switch-head', { title: names[tool] }, brandMark(tool, 14), names[tool])))) : null,
    ],
    end: switchable.length ? skill => h('span.skill-switches', {}, switchable.map(tool => skillSwitch(view, entry, plugin, tool, skill, marketIndex))) : undefined,
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

/** The narrowest a tool's column in "Your tools" gets, and the gap between columns (style.css data-layout="columns"). */
const TOOL_COLUMN_MIN = 170, TOOL_COLUMN_GAP = 24;

/**
 * Lays out "Your tools" by the box's width, decided here once (data-layout, which style.css keys off). With room for a
 * column per tool and the button, each tool gets one from the left, and "Choose all" sits at the right end. Otherwise
 * they wrap in a row, and a "Choose all" that wraps onto a line of its own moves to the right edge, where a lone button
 * reads as belonging to the whole row (.choice-wrapped). Run after layout (dom.ts afterLayout), before the page is painted.
 */
function settlePluginTools(): void {
  const rows = document.querySelector<HTMLElement>('.plugin-tool-rows'), all = rows?.querySelector<HTMLElement>(':scope > .btn');
  const first = rows?.firstElementChild as HTMLElement | null;
  if (!rows || !first) return;
  const tools = Number(rows.dataset.tools ?? 1);
  const columns = rows.clientWidth >= tools * (TOOL_COLUMN_MIN + TOOL_COLUMN_GAP) + (all?.offsetWidth ?? 0);
  rows.dataset.layout = columns ? 'columns' : 'wrap';
  all?.classList.toggle('choice-wrapped', !columns && all.offsetTop > first.offsetTop + first.offsetHeight / 2);
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
 * marketplace's own copy was read (see differsNote); `extras` adds the skills' switches (see skillSwitches).
 */
function fileGroup(owner: string, idFor: (key: string) => string, kind: FileKind, parts: FilePart[], offeredRead: boolean, extras?: RowExtras) {
  if (!parts.length) return null;
  return h(`div.plugin-group${extras ? `.${extras.className}` : ''}`, {}, h('h4', {}, `${fileKinds[kind].title} (${parts.length})`), ...(extras?.head ?? []), h('ul.plugin-parts', {}, parts.map(part => {
    const opened = `${owner}\u0000${kind}\u0000${part.key}`;
    const open = market.opened.has(opened);
    const id = idFor(part.key);
    const differs = differsIn(part);
    const label = `${part.name}: ${fileKinds[kind].file}`;
    const isOdd = (holders: FileCopy[]) => differs.length > 0 && !holders.some(holder => holder.marketplace);
    const end = extras?.end?.(part.name), note = extras?.note(part.name);
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
  if (!detail) return section(h('p.plugin-muted', {}, plugin.folder ? 'Its files couldn’t be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const files = (['skills', 'commands', 'agents'] as const).map(kind => ({ kind, parts: filePartsOf(kind, detail, offered) }));
  const empty = files.every(({ parts }) => !parts.length) && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length && !detail.bin;
  const idFor = partIds(`pfile-${marketIndex}`);
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem)
      : !detail.offered ? h('p.plugin-muted', {}, 'Its files live outside this marketplace, so its skills, commands and agents are read from the tools that installed it.') : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    ...files.map(({ kind, parts }) => fileGroup(owner, idFor, kind, parts, detail.offered, kind === 'skills' ? skillSwitches(view, entry, plugin, marketIndex, parts) : undefined)),
    detail.hooks.length ? h('div.plugin-group', {}, h('h4', {}, 'Hooks'), h('p.plugin-part-what', {}, `Runs on ${andList(detail.hooks)}. Hooks run commands in the tool while you work.`)) : null,
    detail.mcpServers.length ? h('div.plugin-group', {}, h('h4', {}, `MCP servers (${detail.mcpServers.length})`), partList(`${owner}\u0000mcp`, detail.mcpServers.map(server => ({ name: server.name, text: server.runs, mono: true })))) : null,
    detail.lspServers.length ? h('div.plugin-group', {}, h('h4', {}, `Language servers (${detail.lspServers.length})`), partList(`${owner}\u0000lsp`, detail.lspServers.map(name => ({ name, text: '' })))) : null,
    detail.bin ? h('div.plugin-group', {}, h('h4', {}, 'Programs'), partList(`${owner}\u0000bin`, [{ name: 'bin/', text: 'A folder of programs the plugin puts on the tool’s path.' }])) : null);
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
      h('h2', {}, title),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      facts.length ? h('p.plugin-meta', {}, dotted(facts)) : null),
    installPanel(view, entry, plugin, marketIndex, versionToCompare(plugin, detail), components),
    partsSection(view, entry, plugin, components, detail),
    // What it holds and how each tool takes it, beside the README on a wide page (style.css), one above the other otherwise.
    h('div.plugin-columns', {},
      h('div.plugin-column', {},
        contentsBlock(view, entry, marketIndex, plugin, detail, reading, offered),
        components && nativeTools(view, entry, plugin.name, components).length ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, entry, plugin, components)) : null),
      detail?.readme ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'Readme'), h('div.plugin-readme-body', {}, readme(detail.readme, plugin.name, descriptions, parts))) : null));
}

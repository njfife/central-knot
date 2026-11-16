// One plugin's page: what it is, its one switch and each tool's line (what that tool has, kept out or let in, brought into
// line there: pluginrecord.ts), what it holds (each skill, command and agent's file as written), what each tool does with
// it, and its README. The switch and each tool's links wait their turn in the page's list (pluginstate.ts turnPlugin), and the
// panel says how its click stands (pluginparts.ts clickNote); Update and the skill switches under What it holds act at once
// (pluginstate.ts applyPluginOps).
import { acting, state as app } from './app.ts';
import { afterLayout, button, fileBlocks, h, icon, toggle as switchToggle, withToolCount } from './dom.ts';
import { brandMark } from './brand.ts';
import { groupBy } from './model.ts';
import { componentsFrom, outcomes } from './pluginoutcomes.ts';
import { clickNote, componentsOf, dotted, markOf, pluginSwitch, pluginTitle, readme, markCell, updateButton, updateOps, updatesRun, versionNote } from './pluginparts.ts';
import { inlineMarkdown } from './markdown.ts';
import { pluginKey } from './pluginplan.ts';
import { cantSwitchSkill, comparableText, itemsOnWords, noLongerOffered, copyStale, installed, limitNote, marketplaceVersionNote, NO_SKILL_SWITCH, offeredVersion, pageOfPart, partWords, PREVIEW_ONLY, skillOff, stateOf, unavailable, untestedBuild, versionToCompare, waitingWords, waitsToMove, whyNotCarried, type ToolMark } from './pluginstatus.ts';
import { hasCowork, takesPlugins } from './presence.ts';
import { applyPluginOps, market, openLink, shownDetail, switchHeld, toggleOpened, turnPlugin } from './pluginstate.ts';
import type { Components, HarnessId, MarketplaceView, Outcome, PluginDetail, PluginItemLine, PluginTurn, PluginView, PluginsView } from './types.ts';
import { plural } from './model.ts';
import { andList, coworkWords, toolNames as names } from './words.ts';
import { openItem } from './matrix.ts';

/** Tools that can take the plugin itself here (or have it): what "In each tool" describes. A tool that can't is left out. */
const nativeTools = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
  view.tools.filter(tool => takesPlugins(tool) && !unavailable(view, entry, plugin, tool));

const tone: Record<Outcome['result'], string> = { works: 'tone-muted', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

/**
 * What installing does in each tool. Tools that behave the same share one line, so a real difference stands out. When
 * every part works everywhere (only names differ), it is a few plain lines; a limit anywhere makes it a table.
 */
function outcomesBlock(view: PluginsView, entry: MarketplaceView, plugin: PluginView, components: Components) {
  // Pi and OpenCode, which take its items instead, are described by Its items.
  const tools = nativeTools(view, entry, plugin.name);
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
  installed: 'Installed', outdated: 'Installed', items: 'Its items', stays: 'Still installed', waits: 'Goes in at the next check', 'not-brought': 'Not brought here: off in a tool’s own settings',
  missing: 'Not in it, though on', 'parts-waiting': 'Waits to be moved', cannot: 'Not available', 'kept-out': 'Kept out', absent: 'Not installed', unknown: 'Can’t be read now', 'not-known': 'Unknown',
};

/** Install there's words for a plugin's items: an item's On is one switch for every tool it isn't kept out of. */
const itemsInstall = (tool: HarnessId) => `Turns its items on and puts them in ${names[tool]} now. An item’s On is for every tool it isn’t kept out of, so they come on in those too, and items of its you deleted come back. Undo puts them back as they were.`;

/**
 * Your tools: the plugin's switch at the heading, Update at its right where a copy or its items are behind, and a line per
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
    const stale = copyStale(entry, plugin.name, tool, compareTo, shownDetail(pluginKey(entry.source, plugin.name)));
    const state = stateOf(entry, plugin.name, tool);
    if (state.state === 'installed' && mark !== 'stays') {
      return installedLine(state.version, compareTo, [state.directory ? 'from the Anthropic Directory' : '', stale ? 'differs from the marketplace’s copy' : '', state.off ? 'off in its own settings' : '',
        state.skillsOff?.length ? `${plural(state.skillsOff.length, 'skill')} off` : '']);
    }
    if (mark === 'waits' && !updatesRun()) return 'Waits for automatic updates';
    if (mark === 'items') return itemsOnWords(entry, plugin.name, tool);
    return [MARK_WORDS[mark], mark === 'absent' || mark === 'missing' ? limitNote(limits(tool)) : ''].filter(Boolean).join(' · ');
  };
  // At most two actions on a line: bring it into line there, and keep it out or let it in.
  const actions = (tool: HarnessId, mark: ToolMark) => {
    const owed = sw?.tools[tool], kept = !!sw?.entry?.except.includes(tool);
    const act = (label: string, what: PluginTurn, id: string, title: string) => button({ variant: 'link', size: 'micro', label, id: `${id}-${marketIndex}-${plugin.name}-${tool}`, disabled: switchHeld(entry.source, plugin.name) || !!stopped,
      attrs: { title: stopped ?? title }, onclick: () => turnPlugin(entry, plugin.name, what, tool) });
    const fix = owed?.act && (mark === 'missing' || mark === 'waits' || mark === 'not-brought' || mark === 'stays')
      ? (owed.act === 'install' || owed.act === 'install-items' ? act('Install there', 'fix', 'pfix', owed.act === 'install-items' ? itemsInstall(tool)
        : `Puts it in ${names[tool]} now. Undo takes it out again.`)
        : act('Take out there', 'fix', 'pfix', `Takes it out of ${names[tool]} now; the result says what Undo can put back.`)) : null;
    const keep = !sw?.entry || !owed?.takes ? null : kept ? act('Let in', 'let-in', 'pkeep', `Lets it into ${names[tool]} again${sw.entry.on ? ', and puts it in there now' : ''}. Undo keeps it out again.`)
      : act('Keep out', 'keep-out', 'pkeep', `Keeps it out of ${names[tool]}${owed.has !== 'none' ? ', and takes it out there now' : ''}; the automatic updates leave it out too. Undo lets it back in.`);
    return fix || keep ? h('span.plugin-tool-actions', {}, fix, keep) : null;
  };
  const updates = view.canWrite ? updateOps(view, entry, plugin) : [];
  const notIncluded = whyNotCarried(entry, plugin.name);
  // Parts of it from before the library wait to be moved: why, and what ends it, said once on the page, not only on hover.
  const waiting = waitsToMove(entry, plugin.name) ? view.tools.filter(tool => !takesPlugins(tool)) : [];
  return h('section.plugin-panel', { 'aria-label': 'Your tools' },
    h('div.plugin-panel-head', {}, h('span.plugin-panel-switch', {}, pluginSwitch(view, entry, plugin, `pswitch-page-${marketIndex}-${plugin.name}`), h('h3', {}, 'Your tools')),
      updates.length ? updateButton(updates, `pupdate-${marketIndex}-${plugin.name}`) : null),
    clickNote(entry, plugin.name),
    // A plugin a bundled build doesn't include says why here, on the page, once for every tool.
    notIncluded ? h('p.plugin-panel-hint', { id: 'plugin-not-included' }, notIncluded) : null,
    waiting.length ? h('p.plugin-panel-hint', { id: 'plugin-parts-waiting' }, waitingWords(view, entry, plugin.name, waiting)) : null,
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
      removed: 'Removed by the plugin’s update, so it is off. Turning it on keeps it as yours', deleted: 'Not brought in: you deleted it; History’s Restore, or the plugin’s next On, brings it back',
      'not-brought': `Not brought in: ${line.why ?? ''}` }[line.state];
    return [said, line.state === 'update' ? where : ''].filter(Boolean).join(' · ');
  };
  const linked = (line: PluginItemLine) => line.state !== 'new' && line.state !== 'not-brought' && line.state !== 'deleted';
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
 * more" button (see markClamped); one that fits has none.
 */
const partList = (owner: string, parts: { name: string; text: string; mono?: boolean }[]) => h('ul.plugin-parts', {}, parts.map(part => {
  const key = `${owner}\u0000${part.name}`;
  const open = market.opened.has(key);
  const more = h('button.part-more', { type: 'button', onclick: () => toggleOpened(key) }, open ? 'Show less' : 'Show more');
  return h(`li${open ? '.clamped' : ''}`, {},
    h('code.plugin-name', {}, part.name),
    part.text ? h('span.plugin-part-body', {}, h(`span.plugin-part-what${part.mono ? '.mono' : ''}${open ? '.expanded' : ''}`, {}, part.text), more) : null);
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
  const control = switchToggle({ on, label, disabled: acting() || !!why, id: `pskill-${marketIndex}-${plugin.name}-${skill}-${tool}`,
    onchange: () => void applyPluginOps([{ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, skill, action: on ? 'skill-off' : 'skill-on' }]) });
  return h(`span.skill-switch${why ? '.skill-switch-stuck' : ''}`, { 'data-state': on ? 'on' : 'off' }, control, why ? icon('lock', 13, 'skill-switch-lock') : null);
}

/** What the skills' rows add beside them (see fileGroup): lines above the list, and per skill an end column and a note under it. */
interface RowExtras { head: (HTMLElement | null)[]; end?: (skill: string) => HTMLElement; note: (skill: string) => string | undefined }

/**
 * What the skills' rows add: where the plugin is installed, a switch per skill under each tool that can turn one skill off
 * (ENB-06). Every reason a switch can't change is on the page, not only in hover text: once above the list when it holds for a
 * whole column (Claude Code, which has no switch for a plugin's skill, with its mark; a missing CLI; a preview-only home),
 * otherwise on the row.
 */
function skillColumns(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, skills: string[]): RowExtras {
  const tools = view.tools.filter(tool => installed(entry, plugin.name, tool));
  const switchable = tools.filter(tool => !NO_SKILL_SWITCH[tool]);
  const why = (tool: HarnessId, skill: string) => cantSwitchSkill(view, entry, plugin.name, tool, skill);
  // A reason every skill in a column shares (a missing CLI, a preview-only home) is said once above the list. A held
  // skill's reason is its own, so held skills don't count against the rest of their column.
  const sharedReason = (tool: HarnessId) => {
    const reasons = skills.filter(skill => !skillOff(entry, plugin.name, tool, skill)?.held).map(skill => why(tool, skill));
    return reasons[0] && reasons.every(reason => reason === reasons[0]) ? reasons[0] : undefined;
  };
  const columnWide = new Set(switchable.map(sharedReason).filter((reason): reason is string => !!reason));
  const rowNote = (skill: string) => [...new Set(switchable.map(tool => why(tool, skill)).filter((reason): reason is string => !!reason && !columnWide.has(reason)))].join(' ') || undefined;
  const line = (text: string, mark?: HarnessId) => h('p.plugin-skills-note', {}, mark ? brandMark(mark, 13) : null, ...inlineMarkdown(text, openLink));
  return {
    head: [
      switchable.length ? line('Turn a skill off, or back on, without uninstalling the plugin.') : null,
      ...tools.filter(tool => NO_SKILL_SWITCH[tool]).map(tool => line(NO_SKILL_SWITCH[tool]!, tool)),
      ...[...columnWide].map(reason => line(reason)),
      // Disable is best effort: on a build older than the one exercised, or one whose version can't be read, only said.
      ...switchable.filter(tool => skills.some(skill => !why(tool, skill))).flatMap(tool => untestedBuild(tool, view.versions?.[tool]) ?? []).map(note => line(note)),
      switchable.length ? h('div.skill-switch-cols', { 'aria-hidden': 'true' }, h('span.skill-switches', {}, switchable.map(tool => h('span.skill-switch-head', { title: names[tool] },
        h('span.skill-switch-tool', {}, brandMark(tool, 14), names[tool]))))) : null,
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
 * marketplace's own copy was read (see differsNote); `extras` adds the skills' switches (see skillColumns).
 */
function fileGroup(owner: string, idFor: (key: string) => string, kind: FileKind, parts: FilePart[], offeredRead: boolean, extras?: RowExtras) {
  if (!parts.length) return null;
  return h(`div.plugin-group${extras ? '.plugin-skills' : ''}`, {}, h('h4', {}, `${fileKinds[kind].title} (${parts.length})`), ...(extras?.head ?? []), h('ul.plugin-parts', {}, parts.map(part => {
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
  if (!detail) return section(h('p.plugin-muted', {}, whyNotCarried(entry, plugin.name) ? `Its files aren’t in ${entry.bundled!.app}, so what it holds can’t be shown here.`
    : plugin.folder ? 'Its files couldn’t be read.' : plugin.gone ? 'The marketplace no longer has its files, and no tool’s copy could be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const files = (['skills', 'commands', 'agents'] as const).map(kind => ({ kind, parts: filePartsOf(kind, detail, offered) }));
  const empty = files.every(({ parts }) => !parts.length) && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length && !detail.bin;
  const idFor = partIds(`pfile-${marketIndex}`);
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem)
      : !detail.offered ? h('p.plugin-muted', {}, plugin.gone ? 'The marketplace no longer has its files, so its skills, commands and agents are read from the tools that still have it.' : 'Its files live outside this marketplace, so its skills, commands and agents are read from the tools that installed it.') : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, hooks or servers.') : null,
    ...files.map(({ kind, parts }) => fileGroup(owner, idFor, kind, parts, detail.offered, kind === 'skills' ? skillColumns(view, entry, plugin, marketIndex, parts.map(part => part.name)) : undefined)),
    detail.hooks.length ? h('div.plugin-group', {}, h('h4', {}, 'Hooks'), h('p.plugin-part-what', {}, `Runs on ${andList(detail.hooks)}. Hooks run commands in the tool while you work.`)) : null,
    detail.mcpServers.length ? h('div.plugin-group', {}, h('h4', {}, `MCP servers (${detail.mcpServers.length})`),
      partList(`${owner}\u0000mcp`, detail.mcpServers.map(server => ({ name: server.name, text: server.runs, mono: true })))) : null,
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
      h('h2', {}, title, noLongerOffered(entry, plugin) ? h('span.plugin-chip.plugin-chip-gone', {}, 'No longer offered') : null),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      facts.length ? h('p.plugin-meta', {}, dotted(facts)) : null),
    installPanel(view, entry, plugin, marketIndex, versionToCompare(plugin, detail), components),
    itemsSection(view, entry, plugin),
    // What it holds and how each tool takes it, beside the README on a wide page (style.css), one above the other otherwise.
    h('div.plugin-columns', {},
      h('div.plugin-column', {},
        contentsBlock(view, entry, marketIndex, plugin, detail, reading, offered),
        components && nativeTools(view, entry, plugin.name).length ? h('section.plugin-section', {}, h('h3', {}, 'In each tool'), outcomesBlock(view, entry, plugin, components)) : null),
      detail?.readme ? h('section.plugin-section.plugin-readme', {}, h('h3', {}, 'Readme'), h('div.plugin-readme-body', {}, readme(detail.readme, plugin.name, descriptions, parts))) : null));
}

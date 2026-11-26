// One plugin's page: what it is, its one switch and each tool's line (its box, ticked while the plugin is in that tool, and
// what that tool has: pluginrecord.ts), its parts (each skill, command, agent and instruction file as written, the hooks
// that can add text to sessions and its other hooks, each with what it runs, and its servers), and its In each tool and
// Readme folds. The switch and each tool's box wait their turn in the page's list (pluginstate.ts turnPlugin), and
// the panel says how its click stands (pluginparts.ts clickNote); Update and the skill switches under Skills act at
// once (pluginstate.ts applyPluginOps).
// Fold state lives here while that plugin's page is drawn (shownFolds, drawnPlugin; cleared by afterPluginPageDrawn).
import { acting, applyClick, rerender, setHome, state as app, whyKindReadOnly } from './app.ts';
import { afterLayout, button, fileBlocks, h, icon, infoMark, toggle as switchToggle, withToolCount } from './dom.ts';
import { brandMark } from './brand.ts';
import { libraryEntry, librarySentence } from './historyactions.ts';
import { kindSource } from './itemrow.ts';
import { libraryPages } from './librarypages.ts';
import { harnessIs, libraryWords, rowClicks } from './libraryrow.ts';
import { groupBy } from './model.ts';
import { addsText, componentsFrom, outcomes, sessionHooksAbout, whenItRuns } from './pluginoutcomes.ts';
import { clickNote, componentsOf, dotted, libraryLink, markOf, pluginSwitch, pluginTitle, readme, toolBox, updateButton, updateOps, updatesRun, versionNote } from './pluginparts.ts';
import { inlineMarkdown } from './markdown.ts';
import { pluginKey } from './pluginplan.ts';
import { DIRECTORY, boxOf, cantSwitchSkill, comparableText, copyOff, itemsIn, itemsOnWords, noLongerOffered, copyStale, installed, limitNote, marketplaceVersionNote, NO_SKILL_SWITCH, notInWhy, offeredVersion, otherVersionsLine, pageOfPart, partWords, skillOff, stateOf, unavailable, untestedBuild, versionDiffers, versionToCompare, waitingWords, waitsToMove, whyNotCarried, yourSaid, type ToolMark } from './pluginstatus.ts';
import { hasCowork, pluginTools, takesPlugins } from './presence.ts';
import { applyPluginOps, loadPlugins, market, openLink, shownDetail, toggleOpened, usePlugins } from './pluginstate.ts';
import { pluginLink } from './sourcelink.ts';
import type { Components, DeclaredHook, HarnessId, HookSourceRef, InstalledPlugin, MarketplaceView, Outcome, PluginDetail, PluginItemClash, PluginItemLine, PluginView, PluginsView, YourName } from './types.ts';
import { canRun, hookCantRunReason, hookRow, hookSourceControls } from './hooksourceview.ts';
import { HOOK_RUN_WARN, hookFingerprint, hookLine, hookStripHelp, hookStripNote, textHookRows, type TextHookRow } from './sessionhooks.ts';
import { plural } from './model.ts';
import { andList, coworkWords, toolNames as names } from './words.ts';
import { openKind, rowByKey } from './matrix.ts';

/** Tools that can take the plugin itself here (or have it): what "In each tool" describes. A tool that can't is left out. */
const nativeTools = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
  view.tools.filter(tool => takesPlugins(tool) && !unavailable(view, entry, plugin, tool));

/** Whether any tool in "In each tool" has a limited or failed outcome, so its fold opens when the page opens. */
const hasLimitedOutcome = (tools: HarnessId[], components: Components) =>
  tools.some(tool => outcomes(tool, components).some(outcome => outcome.result === 'limited' || outcome.result === 'fails'));

const tone: Record<Outcome['result'], string> = { works: 'tone-muted', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

/**
 * What installing does in each tool. Tools that behave the same share one line, so a real difference stands out. When
 * every part works everywhere (only names differ), it is a few plain lines; a limit anywhere makes it a table.
 */
function outcomesBlock(view: PluginsView, entry: MarketplaceView, plugin: PluginView, components: Components) {
  // Pi, OpenCode and Antigravity, which take its items instead, are described by Its items.
  const tools = nativeTools(view, entry, plugin.name);
  const byTool = Object.fromEntries(tools.map(tool => [tool, outcomes(tool, components)])) as Record<HarnessId, Outcome[]>;
  const groups = groupBy(tools, tool => JSON.stringify(byTool[tool]));
  // A tool that prefixes names shows the real name a person types, e.g. document-tools:pdf-reader.
  const example = (kind: Outcome['names']) => `${plugin.name}:${kind === 'skill' ? components.skillNames?.[0] ?? 'skill' : 'agent'}`;
  // The kind, set apart by weight, then its sentence, whose code (in backticks) is drawn in monospace.
  const line = (outcome: Outcome) => h('span.plugin-outcome-item', {}, outcome.result === 'works' ? null : icon(glyph[outcome.result], 12, tone[outcome.result]),
    h('span.plugin-outcome-kind', {}, outcome.component), ' ', ...inlineMarkdown(outcome.text, openLink), outcome.names ? [' ', h('code.plugin-name', {}, example(outcome.names))] : null);
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
  installed: 'Installed', outdated: 'Installed', items: 'Its items', 'kept-off': 'Off, kept installed', stays: 'Still installed', waits: 'Goes in at the next check', 'not-brought': 'Not brought here: off in a tool’s own settings',
  missing: 'Not in it, though on', 'parts-waiting': 'Waits to be moved', cannot: 'Not available', absent: 'Not installed', unknown: 'Can’t be read now', 'not-known': 'Unknown',
};

/**
 * Your tools: the plugin's switch at the heading, Update at its right where a copy or its items are behind, and a line per
 * tool: its box (pluginparts.ts toolBox: ticked while the plugin is there; a click turns it off, kept installed where the tool can, or puts it in) and what it
 * has (always there; a tool on another version than the marketplace offers adds "Marketplace has …"). `compareTo`: the
 * version an installed copy is compared with (see versionToCompare).
 */
function installPanel(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, compareTo: string | undefined, components?: Components) {
  // A tool where some part won't fully work names it under its mark; "In each tool" has the detail.
  const limits = (tool: HarnessId) => (components ? outcomes(tool, components).filter(outcome => outcome.result !== 'works') : []);
  const status = (tool: HarnessId, mark: ToolMark) => {
    const stale = copyStale(entry, plugin.name, tool, compareTo, shownDetail(pluginKey(entry.source, plugin.name)));
    const state = stateOf(entry, plugin.name, tool);
    if (state.state === 'installed' && mark !== 'stays' && mark !== 'kept-off') {
      return installedLine(state.version, compareTo, [state.directory ? 'from the Anthropic Directory' : '', stale ? 'differs from the marketplace’s copy' : '',
        state.skillsOff?.length ? `${plural(state.skillsOff.length, 'skill')} off` : '']);
    }
    if (mark === 'waits' && !updatesRun()) return 'Waits for automatic updates';
    if (mark === 'items') return `${itemsOnWords(entry, plugin.name, tool, ` in ${names[tool]}`)}.`;
    return [MARK_WORDS[mark], mark === 'absent' || mark === 'missing' ? limitNote(limits(tool)) : ''].filter(Boolean).join(' · ');
  };
  const updates = view.canWrite ? updateOps(view, entry, plugin) : [];
  const notIncluded = whyNotCarried(entry, plugin.name);
  // Parts of it from before the library wait to be moved: why, and what ends it, said once on the page, not only on hover.
  const waiting = waitsToMove(entry, plugin.name) ? view.tools.filter(tool => !takesPlugins(tool)) : [];
  // Cowork has no box: with Claude desktop here, the Your tools card carries its route after the box help.
  const toolsCard = `Tick to turn the plugin or its items on in that tool. Untick to turn them off.${hasCowork(app.home?.snapshots ?? []) ? ` ${coworkWords.plugin}` : ''}`;
  return h('section.plugin-panel', { 'aria-label': 'Your tools', 'data-info-block': true },
    h('div.plugin-panel-head', {},
      h('span.plugin-panel-switch', {},
        pluginSwitch(view, entry, plugin, `pswitch-page-${marketIndex}-${plugin.name}`),
        h('span.plugin-head-label', {},
          h('h3', {}, 'Your tools'),
          infoMark('plugin-tools-info', 'Your tools', toolsCard))),
      updates.length ? updateButton(updates, `pupdate-${marketIndex}-${plugin.name}`) : null),
    clickNote(entry, plugin.name),
    // A plugin a bundled build doesn't include says why here, on the page, once for every tool.
    notIncluded ? h('p.plugin-panel-hint', { id: 'plugin-not-included' }, notIncluded) : null,
    waiting.length ? h('p.plugin-panel-hint', { id: 'plugin-parts-waiting' }, waitingWords(view, entry, plugin.name, waiting)) : null,
    // A plugin of instruction files alone, as read from the marketplace's copy (a detail with no such read says false): ticking a
    // box would install files no tool reads.
    shownDetail(pluginKey(entry.source, plugin.name))?.onlyInstructions
      ? h('p.plugin-panel-hint', { id: 'plugin-only-instructions' }, 'No tool reads these files by itself: copy the text into your own instructions.') : null,
    withToolCount(h('div.plugin-tool-rows', {}, view.tools.map(tool => {
      const { mark, words } = markOf(view, entry, plugin, tool, compareTo);
      const box = boxOf(view, entry, plugin.name, tool, { mark, words });
      // Under the box: what it has, or what the box says more (why it is off); in Pi, OpenCode and Antigravity, where none
      // of its items is on, each non-clash reason on its own line, then own/shared clashes and each name of his (yourLines).
      const items = entry.items?.[plugin.name];
      const notIn = items?.notIn?.[tool];
      const why = notIn?.nonClash ?? notIn?.reasons ?? [];
      const clashes = (items?.clashes ?? []).filter(clash => clash.tool === tool);
      const yours = items?.yours?.[tool] ?? [];
      const state = why.length ? why.map(reason => h('span.plugin-tool-state.plugin-tool-why', {}, reason))
        : box.held && (yours.length || clashes.length) ? null : h('span.plugin-tool-state', { title: words }, box.line ?? status(tool, mark));
      return h('div.plugin-tool', { 'data-tool': tool }, toolBox(view, entry, plugin, tool, marketIndex, compareTo),
        h('span.plugin-tool-text', {}, h('span.plugin-tool-name', {}, brandMark(tool, 14), names[tool]),
          state, clashLines(view, entry, plugin, tool, clashes, marketIndex), yourLines(view, entry, plugin, tool, yours, marketIndex),
          // With no CLI, its plugin commands run through the copy its desktop app carries: said so, never as the CLI.
          view.via?.[tool] ? h('span.plugin-tool-state.plugin-tool-via', { title: `${names[tool]}’s command-line tool wasn’t found, so its plugin commands run through ${view.via[tool]}.` }, `Through ${view.via[tool]}`) : null));
    })), view.tools.length));
}

/** Lets one tool into a plugin-linked Library item via the Library row's own `rowClicks.inHarness(..., false)` act, re-reading first. */
function letToolIn(entry: MarketplaceView, plugin: string, clash: PluginItemClash) {
  const kind = pageOfPart[clash.kind];
  void applyClick(async () => {
    setHome(await window.centralKnot.refresh());
    await loadPlugins(false, app.home?.readId);
    const live = market.view?.marketplaces.find(each => each.source === entry.source);
    const stillClashes = !!live?.items?.[plugin]?.clashes?.some(each =>
      each.clash === 'own' && each.tool === clash.tool && each.kind === clash.kind && each.key === clash.key);
    const row = rowByKey(kind, clash.key);
    const item = app.home ? kindSource(app.home, kind).library[clash.key] : undefined;
    const linked = !!item && !item.deleted && !!item.source && row?.fromSource?.link === pluginLink(plugin, entry.name) && !row.fromSource.removed;
    if (!stillClashes || !row || !linked || !item.on || !item.except.includes(clash.tool) || harnessIs(row, item, clash.tool) === 'cannot') {
      return { page: 'plugins', item: clash.name, warn: true, band: true, refused: true, text: `${clash.name} changed since the page was read. Nothing was changed.` };
    }
    const name = row.name ?? clash.name;
    return {
      kind, items: [name], rows: [{ kind, key: clash.key }], undoSentence: true,
      changes: [rowClicks.inHarness(row, item, clash.tool, false)],
      said: (notIn, _wrote, recorded) => {
        if (notIn.includes(clash.tool)) return libraryPages[kind].say.said.inHarness(name, clash.tool, false, true);
        const same = recorded?.filter(each => { const hit = libraryEntry(each); return hit?.kind === kind && hit.key === clash.key; }) ?? [];
        const recordedEvent = same.find(each => each.kind === 'on') ?? same[0];
        const sentence = recordedEvent && librarySentence(recordedEvent, libraryWords[kind], app.home?.[kind].tools ?? [], app.home?.[kind].library[clash.key])?.text;
        return sentence ? `${name}: ${sentence.replace(/^./, first => first.toLowerCase())}` : libraryPages[kind].say.said.inHarness(name, clash.tool, false, false);
      },
    };
  });
}

const cantChange = (view: PluginsView, kind: 'skills' | 'agents' | 'mcp') =>
  acting() || (!view.canWrite ? view.reason ?? true : app.home ? whyKindReadOnly(app.home, kind) ?? false : true);

/** Clashes under a tool's box (`PluginItemsView clashes`): own copies settled right here; shared-folder skills keep their Library sentence. */
function clashLines(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, clashes: PluginItemClash[], marketIndex: number) {
  const own = clashes.filter(clash => clash.clash === 'own');
  const shared = clashes.filter(clash => clash.clash === 'shared');
  const sharedLines = shared.length ? notInWhy(tool, plugin.name, shared.map(clash => ({ name: clash.name, kind: clash.kind, out: 'shared' as const })))
    .map(line => h('span.plugin-tool-state.plugin-tool-why', {}, line)) : [];
  return [...own.map(clash => {
    const disabled = cantChange(view, pageOfPart[clash.kind]);
    const title = `Puts the plugin’s ${clash.name} in ${names[tool]}. ${names[tool]}’s own copy is kept as a version, and Undo puts it back.`;
    const id = `pclash-${marketIndex}-${plugin.name}-${tool}-${clash.kind}-${clash.key}`;
    return h('span.plugin-tool-state.plugin-tool-why.plugin-tool-clash', {}, `${clash.name}: ${names[tool]} has its own copy.`,
      button({ size: 'small', label: `Use the plugin’s ${clash.name}`, id, disabled, attrs: { title }, onclick: () => letToolIn(entry, plugin.name, clash) }));
  }), ...sharedLines];
}

/**
 * Each name of his under a tool's box (pluginstatus.ts yourSaid), with Use the plugin's under it where its take can land there
 * (pluginstate.ts usePlugins), then once what that keeps.
 */
function yourLines(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, yours: YourName[], marketIndex: number) {
  const offered = (name: YourName) => !name.same && !name.held, title = (name: YourName) => `Put the plugin’s ${name.name} in ${names[tool]} in place of yours. Undo gives yours back.`;
  const use = (name: YourName) => button({ size: 'small', label: `Use the plugin’s ${name.name}`, id: `ptake-${marketIndex}-${plugin.name}-${tool}-${name.kind}-${name.key}`,
    disabled: acting() || !view.canWrite, attrs: { title: title(name) }, onclick: () => void usePlugins(entry, plugin.name, tool, name) });
  return [...yours.map(name => h('span.plugin-tool-state.plugin-tool-why.plugin-tool-yours', {}, yourSaid(name, tool), offered(name) ? use(name) : null)),
    yours.some(offered) ? h('span.plugin-tool-state.plugin-tool-why', {}, 'Using the plugin’s keeps yours as a version, and your other tools keep their copies.') : null];
}

/**
 * Its items: in Pi, OpenCode and Antigravity, which take no plugins, the plugin's skills, agents and MCP servers are items of Central Knot's
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
      removed: 'Removed by the plugin’s update, so it is off. Turning it on keeps it as yours', deleted: 'Deleted here: tick to bring it back',
      'not-brought': `Not brought in: ${line.why ?? ''}`, alike: 'Yours, the same as the plugin’s: its switch leaves yours as it is' }[line.state];
    return [said, line.state === 'update' ? where : ''].filter(Boolean).join(' · ');
  };
  const linked = (line: PluginItemLine) => line.state !== 'new' && line.state !== 'not-brought' && line.state !== 'deleted';
  const lines = (['skill', 'agent', 'mcp'] as const).flatMap(kind => items.lines.filter(line => line.kind === kind));
  return h('section.plugin-section.plugin-items-section', { 'aria-label': 'Its items' },
    h('div.plugin-section-head', {}, h('h3', {}, 'Its items')),
    items.problem ? h('p.plugin-muted', {}, `${items.problem} Its items stay as they are.`) : null,
    h('ul.plugin-outcome-list.plugin-items-list', {}, lines.map(line => h('li.plugin-outcome-row', { 'data-key': `${line.kind}:${line.key}` },
      h('span.plugin-items-name', {}, `${partWords[line.kind][0]} `, linked(line)
        ? h('button.inline-link.plugin-part-link', { type: 'button', title: `Open ${line.name} in the Library`, onclick: () => openKind(pageOfPart[line.kind], { key: line.key }) }, h('code.plugin-name', {}, line.name))
        : h('code.plugin-name', {}, line.name)),
      h('span.plugin-outcome-what', {}, state(line))))));
}

/**
 * One group of named parts, each description held to two lines. Once laid out, a description that was cut gets a "Show
 * more" button (see markClamped); one that fits has none.
 */
const partList = (owner: string, parts: { name: string; text: string; mono?: boolean; key?: string; source?: HookSourceRef; sourceId?: string }[]) => h('ul.plugin-parts', {}, parts.map(part => {
  // What is opened is kept by the part's name, or by its `key` where rows share a name (two commands of one hook event).
  const key = `${owner}\u0000${part.key ?? part.name}`;
  const open = market.opened.has(key);
  const more = h('button.part-more', { type: 'button', onclick: () => toggleOpened(key) }, open ? 'Show less' : 'Show more');
  const body = part.text ? h('span.plugin-part-body', {}, h(`span.plugin-part-what${part.mono ? '.mono' : ''}${open ? '.expanded' : ''}`, {}, part.text), more) : part.source ? h('span.plugin-part-body', {}) : null;
  return h(`li${open ? '.clamped' : ''}${part.source ? '.with-source' : ''}`, {},
    h('code.plugin-name', {}, part.name), body, part.source && part.sourceId ? hookSourceControls(part.source, part.sourceId) : null);
}));

/**
 * One skill's switch in one tool where the plugin is installed (ENB-06): on or off there; a click turns it at once with that
 * tool's own switch. One that can't change here (`cantSwitchSkill`, such as held off by a switch that isn't the plugin's
 * own) shows where it stands with a lock, can't be clicked, and its row or column says why.
 */
function skillSwitch(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, skill: string, marketIndex: number) {
  const on = !copyOff(entry, plugin.name, tool) && !skillOff(entry, plugin.name, tool, skill);
  const why = cantSwitchSkill(view, entry, plugin.name, tool, skill);
  const label = `${skill} in ${names[tool]}: ${on ? 'on' : 'off'}. ${why ?? `Click to turn it ${on ? 'off' : 'on'} now; Undo turns it back.`}`;
  const control = switchToggle({ on, label, disabled: acting() || !!why, id: `pskill-${marketIndex}-${plugin.name}-${skill}-${tool}`,
    onchange: () => void applyPluginOps([{ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, skill, action: on ? 'skill-off' : 'skill-on' }]) });
  return h(`span.skill-switch${why ? '.skill-switch-stuck' : ''}`, { 'data-state': on ? 'on' : 'off' }, control, why ? icon('lock', 13, 'skill-switch-lock') : null);
}

/** What the skills' rows add beside them (see fileGroup): an optional heading card, lines above the list, and per skill an end column and a note under it. */
interface RowExtras { info?: string; head: (HTMLElement | null)[]; end?: (skill: string) => HTMLElement; note: (skill: string) => string | undefined }

/**
 * What the skills' rows add: where the plugin is installed, a switch per skill under each tool that can turn one skill off
 * (ENB-06). Any installed tool with no per-skill switch (`NO_SKILL_SWITCH`) puts its whole-plugin rule on a `(?)` beside
 * `Skills (N)`; a reason a column shares, an untested-build note and a held skill's row reason stay on the page.
 */
function skillColumns(view: PluginsView, entry: MarketplaceView, plugin: PluginView, marketIndex: number, skills: string[]): RowExtras {
  const tools = view.tools.filter(tool => installed(entry, plugin.name, tool));
  const noSwitch = tools.filter(tool => NO_SKILL_SWITCH[tool]);
  const switchable = tools.filter(tool => !NO_SKILL_SWITCH[tool]);
  const why = (tool: HarnessId, skill: string) => cantSwitchSkill(view, entry, plugin.name, tool, skill);
  // A reason every skill in a column shares (a missing CLI, a preview-only home) is said once above the list. A held
  // skill's reason is its own, so held skills don't count against the rest of their column.
  const sharedReason = (tool: HarnessId) => {
    const wholeOff = copyOff(entry, plugin.name, tool);
    const reasons = skills.filter(skill => wholeOff || !skillOff(entry, plugin.name, tool, skill)?.held).map(skill => why(tool, skill));
    return reasons[0] && reasons.every(reason => reason === reasons[0]) ? reasons[0] : undefined;
  };
  const columnWide = new Set(switchable.map(sharedReason).filter((reason): reason is string => !!reason));
  const rowNote = (skill: string) => [...new Set(switchable.map(tool => why(tool, skill)).filter((reason): reason is string => !!reason && !columnWide.has(reason)))].join(' ') || undefined;
  const line = (text: string) => h('p.plugin-group-note', {}, ...inlineMarkdown(text, openLink));
  return {
    info: noSwitch.length ? `${andList(noSwitch.map(tool => names[tool]))} ${noSwitch.length > 1 ? 'take' : 'takes'} a plugin whole: its skills are on or off together there.` : undefined,
    head: [
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
 * A skill, command, agent or instruction file as listed: where it sits in the plugin (`key`, the same in every copy, so two
 * parts that share a name stay apart), its name, what it says it does, and its file in each copy that has it.
 */
interface FilePart { key: string; name: string; description: string; copies: FileCopy[] }
type FileKind = 'skills' | 'commands' | 'agents' | 'instructions';
/** Each kind of part with a file: its group heading, optional heading suffix and info card, and what its file is called above its text. */
const fileKinds: Record<FileKind, { title: string; file: string; suffix?: string; info?: string }> = {
  skills: { title: 'Skills', file: 'SKILL.md' }, commands: { title: 'Commands', file: 'Command file' }, agents: { title: 'Agents', file: 'Agent file' },
  instructions: { title: 'Instruction files', file: 'Instruction file', suffix: ', read by no tool', info: 'The model sees one only when something tells it to read the file, such as one of the plugin’s skills.' },
};
/** A hook of the marketplace's copy that can add text in one of the tools that take plugins (pluginoutcomes.ts addsText). */
const addsTextSomewhere = (hook: DeclaredHook) => pluginTools.some(tool => addsText(tool, hook));

const marketRef = (marketName: string, plugin: string, hook: DeclaredHook, command: string): HookSourceRef =>
  ({ from: 'marketplace', marketName, plugin, declaredIn: hook.declaredIn, event: hook.event, at: hook.at, command, fingerprint: hookFingerprint(hook) });

/**
 * One group of marketplace hooks (View source alone): its heading, an optional line under it, and a row per hook (its event,
 * then how it starts: sessionhooks.ts hookLine, blank for one that starts nothing here), so the count in the heading is the
 * rows under it. Draws Other hooks, and the text-adding group when no installed copy can run here.
 */
function hookGroup(owner: string, groupId: string, marketName: string, plugin: string, title: string, hooks: DeclaredHook[], about?: string) {
  const rows = hooks.map((hook, row) => {
    const command = hookLine(hook);
    return { name: hook.event, text: command, mono: true, key: `${hook.event}\u0000${row}`, sourceId: `${groupId}-${row}`, source: marketRef(marketName, plugin, hook, command) };
  });
  return rows.length ? h('div.plugin-group', {}, h('h4', {}, `${title} (${rows.length})`), about ? h('p.plugin-group-note', {}, about) : null, partList(owner, rows)) : null;
}

/** Version note when the selected installed copy's version differs from the marketplace's or another eligible tool's. */
function hookCopyNote(selected: InstalledPlugin, eligible: InstalledPlugin[], offered: string | undefined): string | undefined {
  const others = eligible.filter(other => other !== selected && versionDiffers(other.version, selected.version)).map(other => ({ tool: other.tool, version: other.version! }));
  const parts = [versionDiffers(selected.version, offered) ? `The marketplace has ${offered}.` : '', others.length ? `${otherVersionsLine(others)}.` : ''].filter(Boolean);
  return parts.length ? `Runs ${names[selected.tool]}’s installed copy${selected.version ? ` (${selected.version})` : ''}. ${parts.join(' ')}` : undefined;
}

/** Hooks that can add text: runnable installed-copy rows (with any marketplace-only text hooks below), else marketplace View-source rows. */
function sessionHookStrip(view: PluginsView, entry: MarketplaceView, plugin: PluginView, detail: PluginDetail, owner: string, compareTo: string | undefined) {
  const installs = view.tools.flatMap(tool => {
    const st = stateOf(entry, plugin.name, tool);
    const item = st.state === 'installed' ? app.home?.pluginItems?.find(each => each.tool === tool && each.plugin === plugin.name && each.marketName === (st.directory ? DIRECTORY : entry.name)) : undefined;
    return item ? [item] : [];
  });
  // canRun alone decides whether an installed copy (on/off, CLI, tool, home) can run here.
  const eligible = installs.flatMap(install => {
    const rows = textHookRows(install.tool, install.hooks, { from: 'installed', tool: install.tool, plugin: install.plugin, marketName: install.marketName }).filter(row => canRun(row.source));
    return rows.length ? [{ install, rows }] : [];
  });
  const marketText = detail.hooks.filter(addsTextSomewhere);
  const unknown = view.tools.some(tool => stateOf(entry, plugin.name, tool).state === 'not-known' || (installed(entry, plugin.name, tool) && !installs.some(item => item.tool === tool)));
  const inAnyTool = installs.length > 0 || view.tools.some(tool => itemsIn(entry, plugin.name, tool));
  if (!eligible.length) return hookGroup(`${owner}\u0000session`, 'hook-source-session', entry.name, plugin.name, 'Hooks that can add text to sessions',
    marketText, (unknown ? undefined : hookCantRunReason({ inAnyTool, installs, fingerprints: marketText.map(hookFingerprint) })) ?? sessionHooksAbout(componentsFrom(detail).sessionTextHooks, nativeTools(view, entry, plugin.name)));
  const selected = eligible.find(each => each.install.tool === market.nav.hookTool) ?? eligible[0]!;
  const tool = selected.install.tool;
  const picker = eligible.length > 1 ? h('span.select.select-bar.plugin-hook-as', {},
    h('select', { id: 'plugin-hook-tool', 'aria-label': 'Run hooks as', onchange: (event: Event) => {
      market.nav.hookTool = (event.target as HTMLSelectElement).value as HarnessId;
      rerender();
    } }, eligible.map(each => h('option', { value: each.install.tool, selected: each.install.tool === tool }, `As ${names[each.install.tool]}`))), icon('chevrons-up-down', 14)) : null;
  const copy = hookCopyNote(selected.install, eligible.map(each => each.install), compareTo);
  const note = hookStripNote(tool, { groups: [] }, true);
  const seen = new Set(selected.rows.map(row => row.source.fingerprint));
  const tag = compareTo && selected.install.version !== compareTo ? `${compareTo} only` : 'marketplace only';
  const marketRows = marketText.filter(hook => !seen.has(hookFingerprint(hook))).map((hook): TextHookRow => {
    const command = hookLine(hook);
    const whenTool = addsText(tool, hook) ? tool : pluginTools.find(each => addsText(each, hook))!;
    return { when: whenItRuns(whenTool, hook), command, tag, source: marketRef(entry.name, plugin.name, hook, command) };
  });
  return h('section.plugin-group.session-strip', { id: 'plugin-session-hooks', 'aria-label': 'Hooks that can add text' },
    h('div.session-title-row', {}, h('h4.session-title', {}, `Hooks that can add text (${selected.rows.length + marketRows.length})`),
      infoMark('plugin-hooks-info', 'Hooks that can add text', hookStripHelp(tool, true)), picker),
    copy ? h('p.plugin-group-note', {}, versionNote(copy)) : null,
    h('p.session-run-warn', {}, HOOK_RUN_WARN),
    note ? h('p.session-note', {}, ...inlineMarkdown(note, () => undefined)) : null,
    h('ul.session-hooks.plugin-session-hooks', {},
      selected.rows.map((hook, row) => hookRow(hook, `hook-source-plugin-${tool}-${row}`)),
      marketRows.map((hook, row) => hookRow(hook, `hook-source-session-${row}`))));
}

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
 * One group of skills, commands, agents or instruction files, with its heading suffix and info card where it has them (fileKinds, or extras.info for skills). A row
 * opens its file as written, in the view the Library's Files view gives a standalone SKILL.md, each text named by who holds it, and
 * a text that differs from the marketplace's in the warning tone. A closed row says which tools' copies differ. A description stays at two lines, since the file holds it whole.
 * `owner` (the plugin's key) keeps what is opened its own; `idFor` gives each part its element id; `offeredRead` says the
 * marketplace's own copy was read (see differsNote); `extras` adds the skills' switches (see skillColumns).
 */
function fileGroup(owner: string, idFor: (key: string) => string, kind: FileKind, parts: FilePart[], offeredRead: boolean, extras?: RowExtras) {
  if (!parts.length) return null;
  const { title, suffix = '', info } = fileKinds[kind];
  const card = info ?? extras?.info;
  const heading = h('h4', {}, `${title} (${parts.length})${suffix}`);
  return h(`div.plugin-group${extras ? '.plugin-skills' : ''}`, {},
    card ? h('div.plugin-group-head', { 'data-info-block': true }, heading, infoMark(`plugin-${kind}-info`, title, card)) : heading,
    ...(extras?.head ?? []), h('ul.plugin-parts', {}, parts.map(part => {
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
 * The plugin's parts by name, with what each says it does; skills, commands, agents and instruction files open their files.
 * The hooks that can add text come first (`sessionHookStrip`: runnable installed-copy rows with any marketplace-only text
 * hooks below, or marketplace `hookGroup` with `hookCantRunReason` / `sessionHooksAbout`); `Other hooks` stays `hookGroup`.
 * What is opened is kept per plugin; element ids start with the marketplace's place in the list (`marketIndex`).
 */
function contentsBlock(view: PluginsView, entry: MarketplaceView, marketIndex: number, plugin: PluginView, detail: PluginDetail | null | undefined, reading: boolean, offered: string | undefined) {
  const owner = pluginKey(entry.source, plugin.name);
  const section = (...children: (HTMLElement | null)[]) => h('section.plugin-section', {}, ...children);
  if (reading) return section(h('p.plugin-muted', {}, plugin.folder ? 'Reading…' : `Reading its files from ${plugin.from?.label ?? 'its repository'}…`));
  if (!detail) return section(h('p.plugin-muted', {}, whyNotCarried(entry, plugin.name) ? `Its files aren’t in ${entry.bundled!.app}, so what it holds can’t be shown here.`
    : plugin.folder ? 'Its files couldn’t be read.' : plugin.gone ? 'The marketplace no longer has its files, and no tool’s copy could be read.' : 'Its files live outside this marketplace and couldn’t be read, so what it holds shows once a tool installs it.'));
  const files = (['skills', 'commands', 'agents', 'instructions'] as const).map(kind => ({ kind, parts: filePartsOf(kind, detail, offered) }));
  const sessionHooks = sessionHookStrip(view, entry, plugin, detail, owner, versionToCompare(plugin, detail));
  const empty = files.every(({ parts }) => !parts.length) && !sessionHooks && !detail.hooks.length && !detail.mcpServers.length && !detail.lspServers.length && !detail.bin;
  const idFor = partIds(`pfile-${marketIndex}`);
  return section(
    detail.problem ? h('p.plugin-muted', {}, detail.problem)
      : !detail.offered ? h('p.plugin-muted', {}, plugin.gone ? 'The marketplace no longer has its files, so its skills, commands, agents and instruction files are read from the tools that still have it.'
        : 'Its files live outside this marketplace, so its skills, commands, agents and instruction files are read from the tools that installed it.') : null,
    empty && !detail.problem ? h('p.plugin-muted', {}, 'Nothing Central Knot recognizes: no skills, commands, agents, instruction files, hooks or servers.') : null,
    ...files.map(({ kind, parts }) => fileGroup(owner, idFor, kind, parts, detail.offered, kind === 'skills' ? skillColumns(view, entry, plugin, marketIndex, parts.map(part => part.name)) : undefined)),
    sessionHooks,
    hookGroup(`${owner}\u0000hooks`, 'hook-source-other', entry.name, plugin.name, 'Other hooks', detail.hooks.filter(hook => !addsTextSomewhere(hook))),
    detail.mcpServers.length ? h('div.plugin-group', {}, h('h4', {}, `MCP servers (${detail.mcpServers.length})`),
      partList(`${owner}\u0000mcp`, detail.mcpServers.map(server => ({ name: server.name, text: server.runs, mono: true })))) : null,
    detail.lspServers.length ? h('div.plugin-group', {}, h('h4', {}, `Language servers (${detail.lspServers.length})`), partList(`${owner}\u0000lsp`, detail.lspServers.map(name => ({ name, text: '' })))) : null,
    detail.bin ? h('div.plugin-group', {}, h('h4', {}, 'Programs'), partList(`${owner}\u0000bin`, [{ name: 'bin/', text: 'A folder of programs the plugin puts on the tool’s path.' }])) : null);
}

/** Open/closed state the person gave `In each tool` or `Readme` while this plugin's page is shown; cleared on any draw that isn't this page (afterPluginPageDrawn). */
let shownFolds: { key: string; folds: Partial<Record<'outcomes' | 'readme', boolean>> } | undefined;
let drawnPlugin: string | undefined;

/** After each draw of the page (renderer.ts renderWindow): fold state lives only while that plugin's page is drawn. */
export function afterPluginPageDrawn(): void {
  if (drawnPlugin !== shownFolds?.key) shownFolds = undefined;
  drawnPlugin = undefined;
}

/** A fold (`In each tool`, `Readme`): keyboard-toggleable, keeping the state he gave it only while this plugin's page is shown. */
function fold(key: string, kind: 'outcomes' | 'readme', title: string, defaultOpen: boolean, body: HTMLElement, extraClass = '') {
  let shown = shownFolds?.key === key ? shownFolds.folds[kind] ?? defaultOpen : defaultOpen;
  return h(`section.plugin-section${extraClass}`, {},
    h('details.plugin-fold', {
      id: `plugin-${kind}`, open: shown,
      ontoggle: (event: Event) => {
        const now = (event.currentTarget as HTMLDetailsElement).open;
        if (now === shown) return;
        shown = now;
        if (shownFolds?.key === key) shownFolds.folds[kind] = now;
      },
    },
    h('summary.plugin-fold-head', { id: `plugin-${kind}-toggle` }, icon('chevron-right', 14, 'tone-faint plugin-fold-chevron'), h('h3', {}, title)),
    body));
}

export function pluginPage(view: PluginsView, entry: MarketplaceView, marketIndex: number, plugin: PluginView) {
  const pageKey = `${app.home?.home ?? ''}\u0000${pluginKey(entry.source, plugin.name)}`;
  drawnPlugin = pageKey;
  if (shownFolds?.key !== pageKey) shownFolds = { key: pageKey, folds: {} };
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
  // "In each tool" only where some tool does something with some part: not for a plugin holding only an instruction file, say.
  const native = nativeTools(view, entry, plugin.name);
  const inEachTool = components && native.some(tool => outcomes(tool, components).length) ? components : undefined;
  const library = libraryLink(entry, plugin, 'plugin-library', 'page');
  return h('article.plugin-page', { 'aria-label': title },
    h('header.plugin-head', {},
      h('h2', {}, title, noLongerOffered(entry, plugin) ? h('span.plugin-chip.plugin-chip-gone', {}, 'No longer offered') : null),
      plugin.displayName ? h('code.plugin-id', {}, plugin.name) : null,
      plugin.description ? h('p.plugin-about', {}, plugin.description) : null,
      facts.length ? h('p.plugin-meta', {}, dotted(facts)) : null,
      library ? h('p.plugin-meta', {}, library) : null),
    installPanel(view, entry, plugin, marketIndex, versionToCompare(plugin, detail), components),
    itemsSection(view, entry, plugin),
    // Parts and In each tool, beside the README fold on a wide page (style.css), one above the other otherwise.
    h('div.plugin-columns', {},
      h('div.plugin-column', {},
        contentsBlock(view, entry, marketIndex, plugin, detail, reading, offered),
        inEachTool ? fold(pageKey, 'outcomes', 'In each tool', hasLimitedOutcome(native, inEachTool), outcomesBlock(view, entry, plugin, inEachTool)) : null),
      detail?.readme ? fold(pageKey, 'readme', 'Readme', false, h('div.plugin-readme-body', {}, readme(detail.readme, plugin.name, descriptions, parts)), '.plugin-readme') : null));
}

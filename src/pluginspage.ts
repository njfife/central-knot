// Plugins: marketplaces, what each tool has installed from them, and Install or Uninstall through each tool's own commands.
// Every change is a real install or removal in that tool, run at once and confirmed by reading the tool's record.
import { addMarketplace, forgetMarketplace, installPlugin, pickMarketplaceFolder, refreshMarketplace, rerender, shownPath, showPage, state, uninstallPlugin } from './app.ts';
import { button, emptyState, h, icon } from './dom.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import type { ActionReport, HarnessId, InstallState, MarketplaceView, Outcome, PluginView, PluginsView } from './types.ts';

const names: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex' };
const originText = (origin: MarketplaceView['origins'][number]) => (origin === 'central-knot' ? 'Added in Central Knot' : `Added in ${names[origin]}`);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Why a tool can't take this plugin, if it can't. */
function blocked(view: PluginsView, market: MarketplaceView, tool: HarnessId): string | undefined {
  if (!view.clis[tool]) {
    return tool === 'codex-cli' && state.home?.snapshots.find(snapshot => snapshot.harness === 'codex-cli')?.probe.detail.startsWith('ChatGPT desktop')
      ? 'Only ChatGPT desktop was found. Installing there without the Codex CLI is not known yet.'
      : `${names[tool]}’s own CLI was not found, so its plugin commands can’t run.`;
  }
  if (tool === 'copilot-cli') return market.plugins.find(plugin => plugin.copilotRefuses)?.copilotRefuses;
  return undefined;
}

function cell(view: PluginsView, market: MarketplaceView, plugin: PluginView, tool: HarnessId, index: number) {
  const status: InstallState = market.states[plugin.name]?.[tool] ?? { state: 'not-installed' };
  const why = blocked(view, market, tool);
  const busy = !!state.busy || !view.canWrite;
  const id = `pcell-${index}-${plugin.name}-${tool}`;
  if (status.state === 'installed') {
    const text = `${names[tool]}: installed${status.live ? ', loaded live from the marketplace folder' : ''}`;
    // Uninstalling takes a second click on the same cell; the band above says what it will do.
    const confirming = state.pluginConfirm === id;
    return h('div.ov-cell', { role: 'cell' }, h(`button.cell-button.${confirming ? 'cell-confirm' : 'cell-synced'}.cell-on`, { type: 'button', id, title: confirming ? `Click again to uninstall ${plugin.name} from ${names[tool]}.` : `${text}. Click to uninstall.`, 'aria-label': confirming ? `Confirm: uninstall ${plugin.name} from ${names[tool]}` : `${text}. Uninstall`, disabled: busy || !view.clis[tool], 'data-state': 'installed',
      onclick: (event: Event) => { event.stopPropagation(); if (confirming) { state.pluginConfirm = undefined; void uninstallPlugin(market.name, plugin.name, tool); } else { state.pluginConfirm = id; state.pluginConfirmText = `Click again to uninstall ${plugin.name} from ${names[tool]}. Central Knot saves a copy of the files it changes first. Esc cancels.`; rerender(); } } }, icon(confirming ? 'x' : 'check', 16)),
      confirming ? h('span.cell-confirm-label', { 'aria-hidden': 'true' }, 'Uninstall?') : null);
  }
  if (why) return h('div.ov-cell', { role: 'cell' }, h('button.cell-button.cell-cannot', { type: 'button', id, title: why, 'aria-label': `${names[tool]}: ${why}`, disabled: true, 'data-state': 'cannot' }));
  if (status.state === 'not-known') return h('div.ov-cell', { role: 'cell' }, h('button.cell-button.cell-differs', { type: 'button', id, title: `${status.reason} Click to install again.`, 'aria-label': `${names[tool]}: not known yet. ${status.reason} Install again`, disabled: busy, 'data-state': 'not-known',
    onclick: (event: Event) => { event.stopPropagation(); void installPlugin(market.source, plugin.name, [tool]); } }, icon('circle-question-mark', 16)));
  return h('div.ov-cell', { role: 'cell' }, h('button.cell-button.cell-absent.plugin-add', { type: 'button', id, title: `Not installed in ${names[tool]}. Click to install.`, 'aria-label': `${names[tool]}: not installed. Install`, disabled: busy, 'data-state': 'absent',
    onclick: (event: Event) => { event.stopPropagation(); void installPlugin(market.source, plugin.name, [tool]); } }, icon('plus', 14, 'plugin-add-glyph')));
}

const tone: Record<Outcome['result'], string> = { works: 'tone-success', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

/** "named plugin:skill" with the real names, as one unbroken code name: it is what the person types in that tool. */
function namedText(text: string, plugin: string, skill?: string): (string | Node)[] {
  const match = /plugin:(skill|agent)/.exec(text);
  if (!match) return [text];
  const name = `${plugin}:${match[1] === 'skill' && skill ? skill : `${match[1]}-name`}`;
  return [text.slice(0, match.index), h('code.plugin-name', { title: name }, name), text.slice(match.index + match[0].length)];
}

function details(view: PluginsView, plugin: PluginView) {
  const parts = plugin.components;
  const summary = parts
    ? [parts.skills && `${parts.skills} skill${parts.skills === 1 ? '' : 's'}`, parts.commands && `${parts.commands} command${parts.commands === 1 ? '' : 's'}`, parts.agents && `${parts.agents} agent${parts.agents === 1 ? '' : 's'}`, parts.hooks && 'hooks', parts.mcp && `${parts.mcp} MCP server${parts.mcp === 1 ? '' : 's'}`, parts.bin && 'a top-level bin/'].filter(Boolean).join(', ') || 'Nothing Central Knot recognises'
    : '';
  const skillNames = parts?.skillNames ?? [];
  const firstSkill = skillNames[0];
  // Skills are named when only skills are listed, so the line reads "Contains 2 skills: a, b".
  const skillList = skillNames.length && !parts?.commands && !parts?.agents && !parts?.mcp && !parts?.hooks ? `${skillNames.slice(0, 2).join(', ')}${skillNames.length > 2 ? ` +${skillNames.length - 2} more` : ''}` : '';
  return h('div.compare.details.plugin-details', { role: 'region', 'aria-label': `Details for ${plugin.name}` },
    h('div.details-head', {}, h('p.details-status', {}, plugin.description || 'No description.'),
      h('p.details-description', {}, !parts ? 'Contents aren’t known until installation: this plugin’s files are outside the marketplace.' : summary === 'Nothing Central Knot recognises' ? 'No recognized components.' : `Contains ${summary}${skillList ? `: ${skillList}` : ''}`)),
    parts ? withTools(view, h('div.plugin-outcome-grid', {}, view.tools.map(tool => h('div.plugin-outcome-card', {},
      h('div.details-tool-head', {}, brandMark(tool, 14), h('strong', {}, `When installed in ${names[tool]}`)),
      h('ul.plugin-outcomes', {}, (plugin.outcomes[tool] ?? []).map(outcome => h('li', {}, icon(glyph[outcome.result], 12, tone[outcome.result]),
        h('span', {}, ...namedText(`${outcome.component} ${outcome.text}`, plugin.name, firstSkill))))))))) : null);
}

// Escape takes back an armed uninstall, wherever focus is.
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.pluginConfirm) { state.pluginConfirm = undefined; rerender(); } });

/** What the boxes mean, only for the kinds on screen. */
function boxKey(view: PluginsView, entry: MarketplaceView) {
  const states = entry.plugins.flatMap(plugin => view.tools.map(tool => blocked(view, entry, tool) && entry.states[plugin.name]?.[tool]?.state !== 'installed' ? 'cannot' : entry.states[plugin.name]?.[tool]?.state ?? 'not-installed'));
  const item = (label: string, node: HTMLElement) => h('span.legend-item', {}, node, label);
  return h('div.legend.plugin-legend', { 'aria-label': 'Key' },
    states.includes('not-installed') ? item('Not installed: click to install', h('span.legend-cell.cell-absent', {}, icon('plus', 10))) : null,
    states.includes('installed') ? item('Installed', h('span.legend-cell.cell-synced.cell-on', {}, icon('check', 11))) : null,
    states.includes('not-known') ? item('Not confirmed yet', h('span.legend-cell.cell-differs', {}, icon('circle-question-mark', 11))) : null,
    states.includes('cannot') ? item('Can’t install here (hover for why)', h('span.legend-cell.cell-cannot', {})) : null);
}

function market(view: PluginsView, entry: MarketplaceView, index: number) {
  const title = entry.name || entry.source;
  const toolHeads = view.tools.map(tool => h('div.ov-cell.ov-tool-head', { role: 'columnheader' }, brandMark(tool, 16), h('span', {}, names[tool])));
  const row = (plugin: PluginView) => {
    const key = `${entry.source}\u0000${plugin.name}`;
    const open = state.pluginOpen === key;
    const toggle = () => { state.pluginOpen = open ? undefined : key; rerender(); };
    const missing = view.tools.filter(tool => !blocked(view, entry, tool) && entry.states[plugin.name]?.[tool]?.state !== 'installed');
    return [
      h(`div.ov-row${open ? '.open' : ''}`, { role: 'row', 'data-plugin': plugin.name, onclick: toggle },
        h('div.ov-name', { role: 'cell', title: plugin.description },
          h('button.row-open', { type: 'button', id: `popen-${index}-${plugin.name}`, 'aria-label': `${open ? 'Hide' : 'Show'} details for ${plugin.name}`, onclick: (event: Event) => { event.stopPropagation(); toggle(); } }, icon(open ? 'chevron-down' : 'chevron-right', 14, 'tone-faint')),
          h('span.ov-name-text', {}, plugin.name),
          plugin.version ? h('span.plugin-version', {}, plugin.version) : null),
        view.tools.map(tool => cell(view, entry, plugin, tool, index)),
        h('div.plugin-actions', { role: 'cell' }, missing.length && view.canWrite
          ? button({ variant: 'outline', size: 'small', label: missing.length === view.tools.length && missing.length > 1 ? `Install in all ${missing.length}` : `Install in ${missing.map(tool => names[tool]).join(' + ')}`, name: `Install ${plugin.name} in ${missing.map(tool => names[tool]).join(', ')}`, id: `pinstall-${index}-${plugin.name}`, disabled: !!state.busy, onclick: () => void installPlugin(entry.source, plugin.name, missing) })
          : null),
        h('div.ov-fill')),
      open ? details(view, plugin) : null,
    ];
  };
  return h('section.market', { 'aria-label': title },
    h('div.market-head', {},
      h('div.market-title', {}, icon('puzzle', 16, 'tone-muted'), h('strong', {}, title), entry.origins.map(origin => h('span.market-origin', {}, originText(origin)))),
      h('span.market-source', { title: entry.source }, entry.kind === 'folder' ? shownPath(entry.source) : entry.source),
      h('div.market-actions', {},
        entry.fetchedAt ? h('span.market-when', { title: when(entry.fetchedAt) }, `Last ${entry.kind === 'folder' ? 'read' : 'fetched'} ${new Date(entry.fetchedAt).toDateString() === new Date().toDateString() ? new Date(entry.fetchedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : new Date(entry.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`) : null,
        button({ variant: 'ghost', size: 'small', icon: 'refresh-cw', label: entry.kind === 'folder' ? 'Read again' : 'Fetch again', id: `refresh-${index}`, disabled: !!state.busy, onclick: () => void refreshMarketplace(entry.source) }),
        entry.origins.includes('central-knot') ? (() => { const remove = button({ variant: 'ghost', size: 'small', label: 'Remove from list', name: `Remove ${title} from Central Knot’s list. Installed plugins stay installed.`, id: `forget-${index}`, disabled: !!state.busy, onclick: () => void forgetMarketplace(entry.source) }); remove.title = 'Removes it from this list only. Installed plugins stay installed.'; return remove; })() : null)),
    entry.problem ? h('div.band', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), h('span.band-text', {}, entry.problem, entry.stale ? ` Showing the copy fetched ${when(entry.fetchedAt)}; installing waits until it can be reached.` : '')) : null,
    (() => {
      const cannot = view.tools.filter(tool => !view.clis[tool]);
      if (!entry.plugins.length) return null;
      // One hint, chosen by what can be done here: how installing works only where some box can be clicked.
      const someCan = view.tools.some(tool => view.clis[tool]) && view.canWrite;
      const anyInstalled = entry.plugins.some(plugin => view.tools.some(tool => entry.states[plugin.name]?.[tool]?.state === 'installed'));
      const how = someCan ? h('p.market-hint', {}, icon('info', 13, 'tone-muted'), `Click a box to install the plugin in that tool. It runs at once, through the tool’s own command; there is no Apply all here.${anyInstalled ? ' Click a check to uninstall.' : ''}`) : null;
      const refused = entry.plugins.filter(plugin => plugin.copilotRefuses);
      const refusal = refused.length && view.tools.includes('copilot-cli') && view.clis['copilot-cli'] ? h('p.market-hint.market-hint-warn', {}, icon('circle-alert', 13, 'tone-warning'), `Copilot CLI can’t take this marketplace: ${refused[0].copilotRefuses}`) : null;
      if (!cannot.length) return refusal ? h('div.market-hints', {}, how, refusal) : how;
      const orList = (items: string[]) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}` : items.join(' or '));
      return h('div.market-hints', {}, how, refusal, h('p.market-hint.market-hint-warn', {}, icon('circle-alert', 13, 'tone-warning'),
        `Can’t install in ${orList(cannot.map(tool => names[tool]))} here: ${cannot.length === 1 ? 'its' : 'their'} command-line tool${cannot.length === 1 ? ' wasn’t' : 's weren’t'} found${state.home?.mode === 'actual' ? '' : ` for ${state.home?.label ?? 'this home'}`}. Striped boxes can’t be clicked. `,
        button({ variant: 'link', size: 'micro', label: 'See Tools', id: `market-tools-${index}`, onclick: () => showPage('tools') })));
    })(),
    entry.plugins.length
      ? withTools(view, h(`div.ov.plugin-table${entry.plugins.some(plugin => view.canWrite && view.tools.some(tool => !blocked(view, entry, tool) && entry.states[plugin.name]?.[tool]?.state !== 'installed')) ? '' : '.plugin-table-noactions'}`, { role: 'table', 'aria-label': `Plugins in ${title}` },
          h('div.ov-row.ov-head', { role: 'row' }, h('div.ov-name', { role: 'columnheader' }, 'Plugin'), toolHeads, h('div.plugin-actions', { role: 'columnheader' }), h('div.ov-fill')),
          entry.plugins.flatMap(row)))
      : entry.problem ? null : h('p.market-empty', {}, 'This marketplace lists no plugins.'),
    entry.plugins.length ? boxKey(view, entry) : null);
}

/** Column count through the style object; the page's security policy refuses inline style attributes. */
function withTools(view: PluginsView, table: HTMLElement) {
  table.style.setProperty('--tool-count', String(view.tools.length));
  return table;
}

/** The way back from a finished install or uninstall, on its report line. */
function reverse(report: ActionReport) {
  const last = state.pluginLast;
  if (!last) return null;
  if (report.outcome === 'installed') return button({ variant: 'link', size: 'micro', label: `Uninstall from ${names[report.tool]}`, id: `report-uninstall-${report.tool}`, disabled: !!state.busy, onclick: () => void uninstallPlugin(last.market, last.plugin, report.tool) });
  if (report.outcome === 'uninstalled' && last.source) return button({ variant: 'link', size: 'micro', label: `Reinstall in ${names[report.tool]}`, id: `report-reinstall-${report.tool}`, disabled: !!state.busy, onclick: () => void installPlugin(last.source, last.plugin, [report.tool]) });
  return null;
}

function reports() {
  const result = state.pluginResult;
  if (!result) return null;
  if (result.problem || result.stopped) return h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, result.problem ?? result.stopped));
  if (!result.reports.length) return null;
  const changed = result.reports.flatMap(report => report.runs.flatMap(run => run.changed.map(entry => entry.path)));
  return h('div.band.plugin-report', { role: 'status' },
    h('div.plugin-report-lines', {}, result.reports.map(report => h('p', {},
      icon(report.outcome === 'installed' || report.outcome === 'uninstalled' ? 'check' : report.outcome === 'not-known' ? 'circle-question-mark' : 'triangle-alert', 14, report.outcome === 'installed' || report.outcome === 'uninstalled' ? 'tone-success' : 'tone-warning'),
      h('strong', {}, `${names[report.tool]}: `), report.message, reverse(report)))),
    changed.length ? h('p.plugin-report-files', {}, `Changed by the tools’ own commands: ${[...new Set(changed)].map(path => shownPath(path)).join(', ')}. Central Knot kept a copy of each before it changed.`) : null,
    h('button.band-dismiss', { type: 'button', id: 'report-dismiss', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: () => { state.pluginResult = undefined; rerender(); } }, icon('x', 12)));
}

export function pluginsPage() {
  const view = state.plugins;
  if (!view) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading marketplaces…' : 'Marketplaces could not be read.')));
  const input = h('input.find-input', { id: 'marketplace-source', type: 'text', placeholder: 'Add a marketplace: Git URL, owner/repo or folder', 'aria-label': 'Marketplace to add', spellcheck: 'false', value: state.marketDraft,
    oninput: (event: Event) => { state.marketDraft = (event.target as HTMLInputElement).value; },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') add(); } }) as HTMLInputElement;
  const add = () => { const text = input.value.trim(); if (text) void addMarketplace(text); };
  return h('div.page.plugins-page', {},
    h('div.toolbar', {},
      h('div.find.market-add', {}, icon('plus', 16, 'find-glyph'), input),
      button({ variant: 'primary', size: 'small', label: 'Add', id: 'add-marketplace', disabled: !!state.busy, onclick: add }),
      button({ variant: 'ghost', size: 'small', icon: 'folder-plus', label: 'Choose folder…', name: 'Choose a marketplace folder', id: 'pick-marketplace-folder', disabled: !!state.busy, onclick: () => void pickMarketplaceFolder().then(folder => { if (folder) void addMarketplace(folder); }) })),
    h('div.bands', {},
      view.canWrite ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.reason ?? 'Preview only here.')),
      state.pluginConfirm ? h('div.band', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), h('span.band-text', {}, state.pluginConfirmText ?? ''), h('button.text-action', { type: 'button', id: 'plugin-confirm-cancel', onclick: () => { state.pluginConfirm = undefined; rerender(); } }, 'Cancel')) : null,
      outcomeBand(),
      reports()),
    h('div.scroll.matrix', { id: 'plugins-scroll' },
      view.marketplaces.length
        ? view.marketplaces.map((entry, index) => market(view, entry, index))
        : emptyState('puzzle', 'No marketplaces yet', 'A marketplace is a catalog of plugins: a Git repository or folder with .claude-plugin/marketplace.json. Add one above by its Git address, owner/repo, or folder. Adding reads its catalog and installs nothing.')));
}

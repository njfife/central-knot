// Plugins: marketplaces, what each tool has installed from them, and Install or Uninstall through each tool's own commands.
// Every change is a real install or removal in that tool, run at once and confirmed by reading the tool's record.
import { addMarketplace, forgetMarketplace, installPlugin, pickMarketplaceFolder, refreshMarketplace, rerender, shownPath, showPage, state, uninstallPlugin } from './app.ts';
import { button, emptyState, h, icon } from './dom.ts';
import { brandMark } from './matrix.ts';
import type { HarnessId, InstallState, MarketplaceView, Outcome, PluginView, PluginsView } from './types.ts';

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
      onclick: (event: Event) => { event.stopPropagation(); if (confirming) { state.pluginConfirm = undefined; void uninstallPlugin(market.name, plugin.name, tool); } else { state.pluginConfirm = id; state.pluginConfirmText = `Click the cell again to uninstall ${plugin.name} from ${names[tool]}. Its files are kept by Central Knot first.`; rerender(); } } }, icon(confirming ? 'x' : 'check', 16)));
  }
  if (why) return h('div.ov-cell', { role: 'cell' }, h('button.cell-button.cell-cannot', { type: 'button', id, title: why, 'aria-label': `${names[tool]}: ${why}`, disabled: true, 'data-state': 'cannot' }));
  if (status.state === 'not-known') return h('div.ov-cell', { role: 'cell' }, h('button.cell-button.cell-differs', { type: 'button', id, title: `${status.reason} Click to install again.`, 'aria-label': `${names[tool]}: not known yet. ${status.reason} Install again`, disabled: busy, 'data-state': 'not-known',
    onclick: (event: Event) => { event.stopPropagation(); void installPlugin(market.source, plugin.name, [tool]); } }, icon('circle-question-mark', 16)));
  return h('div.ov-cell', { role: 'cell' }, h('button.cell-button.cell-absent.plugin-add', { type: 'button', id, title: `Not installed in ${names[tool]}. Click to install.`, 'aria-label': `${names[tool]}: not installed. Install`, disabled: busy, 'data-state': 'absent',
    onclick: (event: Event) => { event.stopPropagation(); void installPlugin(market.source, plugin.name, [tool]); } }, icon('plus', 14, 'plugin-add-glyph')));
}

const tone: Record<Outcome['result'], string> = { works: 'tone-success', limited: 'tone-warning', ignored: 'tone-faint', fails: 'tone-danger', unknown: 'tone-faint' };
const glyph: Record<Outcome['result'], Parameters<typeof icon>[0]> = { works: 'check', limited: 'circle-minus', ignored: 'circle-off', fails: 'circle-x', unknown: 'circle-question-mark' };

function details(view: PluginsView, plugin: PluginView) {
  const parts = plugin.components;
  const summary = parts
    ? [parts.skills && `${parts.skills} skill${parts.skills === 1 ? '' : 's'}`, parts.commands && `${parts.commands} command${parts.commands === 1 ? '' : 's'}`, parts.agents && `${parts.agents} agent${parts.agents === 1 ? '' : 's'}`, parts.hooks && 'hooks', parts.mcp && `${parts.mcp} MCP server${parts.mcp === 1 ? '' : 's'}`, parts.bin && 'a top-level bin/'].filter(Boolean).join(', ') || 'Nothing Central Knot recognises'
    : 'Its files live outside the marketplace, so what it holds is known only after install.';
  return h('div.compare.details.plugin-details', { role: 'region', 'aria-label': `Details for ${plugin.name}` },
    h('div.details-head', {}, h('p.details-status', {}, `Contains ${summary}`), h('p.details-description', {}, plugin.description || 'No description.')),
    parts ? withTools(view, h('div.plugin-outcome-grid', {}, view.tools.map(tool => h('div.plugin-outcome-card', {},
      h('div.details-tool-head', {}, brandMark(tool, 14), h('strong', {}, `In ${names[tool]}`)),
      h('ul.plugin-outcomes', {}, (plugin.outcomes[tool] ?? []).map(outcome => h('li', {}, icon(glyph[outcome.result], 12, tone[outcome.result]),
        h('span', {}, `${outcome.component} ${outcome.text.replace(/plugin:(skill|agent)/, `${plugin.name}:${'$1'}-name`)}`)))))))) : null);
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
          ? button({ variant: 'outline', size: 'small', label: missing.length === view.tools.length ? 'Install' : `Install in ${missing.length} more`, name: `Install ${plugin.name} in ${missing.map(tool => names[tool]).join(', ')}`, id: `pinstall-${index}-${plugin.name}`, disabled: !!state.busy, onclick: () => void installPlugin(entry.source, plugin.name, missing) })
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
        entry.fetchedAt ? h('span.market-when', {}, `${entry.kind === 'folder' ? 'Read' : 'Fetched'} ${when(entry.fetchedAt)}`) : null,
        button({ variant: 'ghost', size: 'small', icon: 'refresh-cw', label: 'Refresh', id: `refresh-${index}`, disabled: !!state.busy, onclick: () => void refreshMarketplace(entry.source) }),
        entry.origins.includes('central-knot') ? (() => { const remove = button({ variant: 'ghost', size: 'small', label: 'Remove from list', name: `Remove ${title} from Central Knot’s list. Installed plugins stay installed.`, id: `forget-${index}`, disabled: !!state.busy, onclick: () => void forgetMarketplace(entry.source) }); remove.title = 'Removes it from this list only. Installed plugins stay installed.'; return remove; })() : null)),
    entry.problem ? h('div.band', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), h('span.band-text', {}, entry.problem, entry.stale ? ` Showing the copy fetched ${when(entry.fetchedAt)}; installing waits until it can be reached.` : '')) : null,
    (() => {
      const cannot = view.tools.filter(tool => !view.clis[tool]);
      if (!cannot.length || !entry.plugins.length) return entry.plugins.length ? h('p.market-hint', {}, 'Click a tool’s box to install the plugin there; click a check to uninstall it.') : null;
      return h('p.market-hint.market-hint-warn', {}, icon('circle-alert', 13, 'tone-warning'),
        `Can’t install in ${cannot.map(tool => names[tool]).join(cannot.length > 2 ? ', ' : ' or ')} here: ${cannot.length === 1 ? 'its' : 'their'} command-line tool${cannot.length === 1 ? ' was' : 's were'} not found${state.home?.mode === 'actual' ? '' : ' (this is not This Mac’s home)'}. Those boxes are striped. `,
        button({ variant: 'link', size: 'micro', label: 'See Tools', id: `market-tools-${index}`, onclick: () => showPage('tools') }));
    })(),
    entry.plugins.length
      ? withTools(view, h('div.ov.plugin-table', { role: 'table', 'aria-label': `Plugins in ${title}` },
          h('div.ov-row.ov-head', { role: 'row' }, h('div.ov-name', { role: 'columnheader' }, 'Plugin'), toolHeads, h('div.plugin-actions', { role: 'columnheader' }), h('div.ov-fill')),
          entry.plugins.flatMap(row)))
      : entry.problem ? null : h('p.market-empty', {}, 'This marketplace lists no plugins.'));
}

/** Column count through the style object; the page's security policy refuses inline style attributes. */
function withTools(view: PluginsView, table: HTMLElement) {
  table.style.setProperty('--tool-count', String(view.tools.length));
  return table;
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
      h('strong', {}, `${names[report.tool]}: `), report.message))),
    changed.length ? h('p.plugin-report-files', {}, `Changed by the tools’ own commands: ${[...new Set(changed)].map(path => shownPath(path)).join(', ')}. Central Knot kept a copy of each before it changed.`) : null);
}

export function pluginsPage() {
  const view = state.plugins;
  if (!view) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading marketplaces…' : 'Marketplaces could not be read.')));
  const input = h('input.find-input', { id: 'marketplace-source', type: 'text', placeholder: 'Add a marketplace: Git URL, owner/repo or folder', 'aria-label': 'Marketplace to add', spellcheck: 'false',
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
      state.outcome?.page === 'plugins' ? h('div.band.band-done', { role: 'status' }, icon('check', 14, 'tone-success'), h('span.band-text', {}, state.outcome.text)) : null,
      reports()),
    h('div.scroll.matrix', { id: 'plugins-scroll' },
      view.marketplaces.length
        ? view.marketplaces.map((entry, index) => market(view, entry, index))
        : emptyState('puzzle', 'No marketplaces yet', 'Add one above by its Git address, owner/repo, or a folder. Adding reads its catalog and installs nothing.')));
}

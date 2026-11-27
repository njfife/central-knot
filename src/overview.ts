// The Overview, the page the app opens on (app.ts state.page starts on it; nothing remembers another page across a launch).
// Top to bottom: what the last action did (matrix.ts outcomeBand) and the Practice copy's note; the lead, only while nothing is
// on and first setup's question isn't asking; what needs you (needsYou: one function, one order, nothing when nothing does; a
// tool that came under management by itself last, until closed: arrivalLines, the one thing here kept for a home, by main.ts);
// a card per kind (kindCard: its counts and whether it is in sync, then what the usage reading says of it, its most used each
// with its file opening under the card: kindCards, cardFiles, a place of filepanel.ts's); the usage strip (usageStrip, with one
// link to everything unused); a row per managed tool (toolsTable: its version, what it has of each kind and of plugins, its
// sessions in the last 30 days); and where every change is kept. Nothing is written, and opening it reads nothing more than the
// home's view; what it keeps between draws is the file open under a card (cardFiles), for its home and visit. The figures come
// from that view, the usage reading on show and its sum (matrix.ts usageOnShow, usageSums, unusedCount: usagerow.ts
// usageSummary), Harnesses' counts (harnesspage.ts tally, pluginstatus.ts pluginsInstalled) and the update state
// (updateview.ts updateLine). While a home's first reading runs (matrix.ts firstReadingRuns) every place a reading fills is
// drawn at its final size, so nothing moves when it lands. The Library opens through matrix.ts openKind. Not here: the empty
// states every page shares (pages.ts noToolsLead, notRead, previewReason) and first setup's question (firstsetup.ts setupLead).
import { absentKinds, collectUsage, homeTools, loadHome, noToolManaged, practiceNoteOpen, realHomeName, rerender, setPracticeNote } from './app.ts';
import { acting, showPage, state, syncNow, whyReadOnly, type PageKind } from './app.ts';
import { brandMark } from './brand.ts';
import { button, h, icon, middle } from './dom.ts';
import { fileButton, filePanel, keepOpenFile, setFile, type FilePlace } from './filepanel.ts';
import { setupLead } from './firstsetup.ts';
import { goHarness, tally } from './harnesspage.ts';
import { anyOn, kindSource } from './itemrow.ts';
import { asksWhichCopy, waitsForSync } from './libraryrow.ts';
import { firstReadingRuns, kindGlyph, openKind, outcomeBand, problemsBesideStop, rowOf, unusedCount, usageOnShow, usageSums } from './matrix.ts';
import { dayAndTime, dayWords, plural } from './model.ts';
import { noToolsLead, notRead, previewReason } from './pages.ts';
import { rowCount } from './pluginrows.ts';
import { fromAnyPlugin } from './origins.ts';
import { pluginsInstalled, takesItemsOnly, type PluginsInstalled } from './pluginstatus.ts';
import { heldKinds } from './presence.ts';
import type { Arrival, HarnessId, HomeView } from './types.ts';
import { updateLine } from './updateview.ts';
import { asksNow } from './setupcounts.ts';
import { settingsReset } from './settingspage.ts';
import { USAGE_DAYS, type KindUsage, type ToolHistory } from './usagerow.ts';
import { andList, kindNames, kindNouns, orList, toolList, toolNames } from './words.ts';

/** One line of the page: its mark, then words and links that wrap under themselves. */
const line = (id: string, glyph: Parameters<typeof icon>[0], tone: string, ...rest: (Node | string | null)[]) => h('p.overview-line', { id }, icon(glyph, 14, tone), ...rest);
const link = (label: string, id: string, onclick: () => void, disabled?: string) => button({ disabled, variant: 'link', size: 'micro', label, id, onclick });

// ---------- The lead: what Central Knot does, while nothing is on ----------

/**
 * What Central Knot keeps the same, between the managed tools only, naming only the kinds a tool here can hold. A kind not every
 * tool here holds says which do, or which don't ("… in all but Codex"). The tools left out are named under the tools table.
 */
function leadSentence(home: HomeView): string {
  const tools = homeTools(), named = andList(tools.map(tool => toolNames[tool]));
  const holdersOf = { skills: tools, mcp: home.mcp.tools, agents: home.agents.tools };
  const held = heldKinds(home).map(kind => [kindNouns[kind].many, holdersOf[kind]] as const);
  const only = home.sync.present.length > 1 ? `It manages only ${named} here` : `Only ${named} is in this home`;
  if (tools.length === 1) return `Central Knot keeps the ${andList(held.map(([kind]) => kind))} you choose the same between your tools. ${only}, so there is nothing to keep in step yet.`;
  const everywhere = held.filter(([, holders]) => holders.length === tools.length).map(([kind]) => kind);
  const some = held.filter(([, holders]) => holders.length < tools.length).map(([kind, holders]) => {
    const without = tools.filter(tool => !holders.includes(tool));
    return holders.length >= without.length ? `${kind} in all but ${andList(without.map(tool => toolNames[tool]))}` : `${kind} in ${andList(holders.map(tool => toolNames[tool]))}`;
  });
  return `Central Knot keeps the ${andList(everywhere)} you choose the same in ${named}${some.map(part => `; ${part}`).join('')}.`;
}

/**
 * The lead's next step, only where it can be taken: with two tools or more, turn something on; with one tool there is nothing to
 * keep in step, so it says how a second one joins. Nothing is found only where no card counts anything (a plugin's items are rows
 * too: pluginrows.ts rowCount).
 */
function nextStep(home: HomeView): string {
  if (!heldKinds(home).some(kind => rowCount(home, kind))) return ' Nothing found in this home yet.';
  // A tool left out is named under the tools table, with where its switch is.
  if (homeTools().length === 1) return home.sync.present.length > 1 ? ''
    : ' When a second tool is installed, or its folder appears here, Central Knot finds it on its own; then manage what you want the same in both.';
  return !whyReadOnly(home) ? ' Open one below and turn on what you want the same in every tool.' : '';
}

/** The practice copy explains itself the first times it opens: what it is, that it is safe, and how to move to the real thing. */
function practiceBanner() {
  if (state.home?.mode !== 'fixture' || !practiceNoteOpen()) return null;
  const real = button({ variant: 'link', size: 'small', label: `or use ${realHomeName}`, id: 'intro-use-real', onclick: () => void loadHome('actual') });
  real.title = 'Only reads your tools; nothing is written there until you say so.';
  return h('div.intro', { role: 'note' },
    h('div.intro-text', {}, h('strong', {}, 'This is a practice copy.'),
      h('span', {}, ' Sample skills, MCP servers and agents in a throwaway folder. Nothing here touches your real tools, so try anything.')),
    // The first step stays inside the sandbox; the real home is the quieter second choice.
    button({ variant: 'primary', size: 'small', label: 'Try it: open Skills', id: 'intro-try', onclick: () => openKind('skills') }), real,
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Hide this note', id: 'intro-dismiss', onclick: () => { setPracticeNote(false); rerender(); } }));
}

// ---------- What needs you ----------

/**
 * Whether first setup speaks of found items whose copies differ: with Synchronize everything on, its line leads into choosing them
 * (where the home can be written: firstsetup.ts setupLead). Otherwise differLines says them, so they are said once.
 */
const setupSpeaksOfCopies = (home: HomeView) => home.sync.syncEverything === true && !whyReadOnly(home);

/**
 * The found items whose copies differ, each kind by its page's "Copies differ" count, where first setup doesn't speak of them:
 * while its question asks, one line for every kind (what Yes leaves as it is), its Show them opening that kind, or All; else a
 * line per kind.
 */
function differLines(home: HomeView, kinds: PageKind[]): HTMLElement[] {
  if (setupSpeaksOfCopies(home)) return [];
  const differing = kinds.map(kind => ({ kind, count: kindSource(home, kind).facts.filter(asksWhichCopy).length })).filter(({ count }) => count);
  const found = (kind: PageKind, count: number) => plural(count, `found ${kindNouns[kind].one}`, `found ${kindNouns[kind].many}`);
  if (asksNow(home) !== 'question') return differing.map(({ kind, count }) => line(`overview-${kind}-differ-line`, 'diff', 'tone-warning',
    `${found(kind, count)} ${count === 1 ? 'has' : 'have'} copies that differ. `, link('Show them', `overview-${kind}-differ`, () => openKind(kind, { filter: 'attention' }))));
  if (!differing.length) return [];
  const total = differing.reduce((sum, { count }) => sum + count, 0), only = differing.length === 1 ? differing[0].kind : undefined;
  const words = `${only ? found(only, total) : plural(total, 'found item')} ${total === 1 ? 'has copies that differ and stays as it is' : 'have copies that differ and stay as they are'} until you choose. `;
  const show = () => (only ? openKind(only, { filter: 'attention' }) : openKind('all', { filter: 'attention' }));
  return [line('overview-differ-line', 'diff', 'tone-warning', words, link('Show them', 'overview-differ', show))];
}

/** Why the home can't be written (app.ts whyReadOnly): preview only, or a record that stops every write; with no tool managed too. */
function readOnlyLine(home: HomeView): HTMLElement | null {
  const why = whyReadOnly(home);
  if (!why) return null;
  if (home.sync.access.allowed) return line('overview-stopped', 'circle-alert', 'tone-danger', why);
  return line('overview-preview', 'lock', 'tone-warning', `Automatic sync is paused. Preview only: ${previewReason(why)}.`);
}

/** What a tool's arrival line says (types.ts Arrival): "Central Knot now manages OpenCode. Copied 2 items.", and before a sync has brought it into line, what that sync does. */
const arrivedWords = ({ tool, copied }: Arrival) => `Central Knot now manages ${toolNames[tool]}. ${copied === undefined
  ? 'Its items are copied there at the next sync.' : copied ? `Copied ${plural(copied, 'item')}.` : 'No items needed copying.'}`;

/**
 * A line for each tool that came under management by itself here (types.ts SyncView arrived, from arrivals.ts): what it says,
 * a link to its Manage switch on Harnesses, and its ×, which closes it for good in this home, at once on the page.
 */
const arrivalLines = (home: HomeView) => home.sync.arrived.map(arrival => {
  const { tool } = arrival;
  const id = `overview-arrived-${tool}`;
  const toSwitch = () => { showPage('harnesses'); document.getElementById(`manage-${tool}`)?.focus(); };
  const close = () => { home.sync.arrived = home.sync.arrived.filter(other => other.tool !== tool); rerender(); void window.centralKnot.dismissArrival(tool, home.home); };
  return line(id, 'boxes', 'tone-muted', `${arrivedWords(arrival)} `, link('Its switch on Harnesses', `${id}-open`, toSwitch),
    button({ variant: 'ghost', size: 'micro', icon: 'x', name: `Close: Central Knot now manages ${toolNames[tool]}`, id: `${id}-dismiss`, onclick: close }));
});

/**
 * What needs the person, before any figure, in this order: that Central Knot's settings file couldn't be read at launch, with the
 * way to Settings, which says where the old file is (settingspage.ts settingsReset); first setup (after the problems when a kind is stopped; its question, Resume, or the way into choosing copies:
 * firstsetup.ts setupLead); an update to install (updateview.ts updateLine); why the home can't be written (readOnlyLine); each
 * kind's problems, each said once (but the stop said above: matrix.ts problemsBesideStop); found items whose copies differ
 * (differLines); Automatic sync off; then each tool
 * that came under management by itself, until it is closed (arrivalLines).
 */
function needsYou(home: HomeView): HTMLElement | null {
  const empty = noToolManaged(), kinds = heldKinds(home), said = new Set<string>();
  const problems = empty ? [] : kinds.flatMap(kind => problemsBesideStop(home[kind].problems, home.sync.gate)
    .filter(problem => !said.has(problem) && said.add(problem))
    .map((problem, at) => line(`overview-${kind}-problem-${at}`, 'triangle-alert', 'tone-warning', `${problem} `,
      link(`Open ${kindNouns[kind].title}`, `overview-${kind}-problem-${at}-open`, () => openKind(kind)))));
  const differ = empty ? [] : differLines(home, kinds);
  const syncOff = empty || whyReadOnly(home) || home.syncOn ? null : line('overview-sync-off', 'circle-minus', 'tone-warning', 'Automatic sync is off: edits wait until you turn it on or ',
    link('Sync once', 'overview-sync-now', () => void syncNow(), acting()), '.');
  const setup = empty ? null : setupLead(home);
  const setupAfterStop = asksNow(home) === 'question' && kinds.some(kind => home[kind].gate.state === 'stopped');
  const reset = home.settingsUnread ? line('overview-settings-kept', 'circle-alert', 'tone-warning', `${settingsReset} `, link('Open Settings', 'overview-settings-kept-open', () => showPage('settings'))) : null;
  const lines = [reset, setupAfterStop ? null : setup, updateLine(), readOnlyLine(home), ...problems, setupAfterStop ? setup : null, ...differ, syncOff, ...arrivalLines(home)]
    .filter((each): each is HTMLElement => !!each);
  return lines.length ? h('div.overview-needs', { id: 'overview-needs' }, lines) : null;
}

// ---------- A card per kind ----------

/** How many of a kind were used in USAGE_DAYS: "…" while the first reading runs, "can't say" where no row has a figure (KindUsage figured). */
function usedWords(total: number, sum: KindUsage | undefined): string {
  if (!total || (!sum && !firstReadingRuns())) return '';
  return `Used in the last ${USAGE_DAYS} days: ${!sum ? '…' : sum.figured ? sum.used.length : 'can’t say'}`;
}

/** The three most used a card names: none where no row of the kind has a figure (KindUsage figured). */
/**
 * The three most used a kind's card names, none where no row of it has a figure (KindUsage figured), each with its row as the
 * Library finds it (matrix.ts rowOf): worked out once a draw (kindCards), for the card's names and marks and for its file.
 */
const topRows = (home: HomeView, kind: PageKind) => {
  const sum = usageSums()?.kinds[kind], shown = rowCount(home, kind) && sum?.figured ? sum.mostUsed : [];
  return shown.map(each => ({ ...each, row: rowOf(kind, each.key) }));
};
type TopRow = ReturnType<typeof topRows>[number];

/**
 * What the usage reading says of a kind: how many were used (usedWords), followed by either why no tool can tell or the three
 * most used (`top`) under Most used, a link to the Library in that order (its kept Sort left as it was); each a link to its row,
 * its name shortened in the middle, its hover saying so, then its file mark (filepanel.ts fileButton: its file opens under the
 * card, cardFiles). Its four lines' room is held by style.css (.kind-card-usage), so the card is as high before a reading lands as after.
 */
function cardUsage(kind: PageKind, total: number, sum: KindUsage | undefined, top: TopRow[]) {
  const used = usedWords(total, sum);
  const cant = total && sum && !sum.figured ? 'No tool that has them on can tell.' : null;
  const sorted = h('button.kind-card-link.kind-card-sorted', { type: 'button', id: `overview-${kind}-most-used`, title: 'Opens the Library sorted by most used',
    onclick: () => openKind(kind, { order: 'most-used' }) }, 'Most used', icon('arrow-right', 12));
  return h('div.kind-card-usage', { id: `overview-${kind}-usage` },
    used ? h('p.kind-card-line', {}, used) : null,
    cant ? h('p.kind-card-line', {}, cant) : null,
    top.map((each, at) => h('p.kind-card-top-row', {}, at ? h('span', {}) : sorted,
      h('span.kind-card-top-item', {}, h('button.kind-card-link.kind-card-top-name', { type: 'button', id: `overview-${kind}-top-${at}`,
        onclick: () => openKind(kind, { key: each.key }) }, Object.assign(middle(each.name, 8), { title: `${each.name}: open its row in the Library` })),
      each.row ? fileButton(cardFiles, each.row) : null),
      h('span', {}, plural(each.sessions, 'session')))));
}

/**
 * Whether a kind is in step, by what its page shows: nothing where something of it differs, can't be read (a tool's whole file, or
 * one copy: LibraryFacts unseen) or can't be written (what needs you says it at the top); else its changes waiting to sync
 * (libraryrow.ts waitsForSync), or "All in sync" once something is on.
 */
function syncState(kind: PageKind, home: HomeView): HTMLElement | null {
  const view = home[kind], facts = kindSource(home, kind).facts;
  const unsure = facts.some(fact => asksWhichCopy(fact) || Object.keys(fact.unseen ?? {}).length > 0) || view.problems.length || view.unread.length;
  if (unsure || !view.access.allowed || view.gate.state === 'stopped' || view.gate.state === 'needs-resume') return null;
  const waiting = facts.filter(waitsForSync).length;
  if (waiting) return h('span.kind-card-state.tone-warning', {}, icon('clock', 13), `${plural(waiting, 'change')} waiting to sync`);
  return facts.some(fact => fact.on) ? h('span.kind-card-state.tone-success', {}, icon('check', 13), 'All in sync') : null;
}

/**
 * One kind: its page (the card's one button, over the whole card); how many there are, how many are On (the page's word: some may
 * still wait to sync), and how many came from some plugin (origins.ts fromAnyPlugin, as the Library's From says); whether it is in step
 * (syncState); its usage (cardUsage), its three most used given (`top`: kindCards).
 */
function kindCard(kind: PageKind, home: HomeView, top: TopRow[]) {
  const { title, short: noun } = kindNouns[kind], facts = kindSource(home, kind).facts;
  const total = rowCount(home, kind), on = facts.filter(fact => fact.on).length, fromPlugins = fromAnyPlugin(home, kind);
  const counts = total ? `${plural(total, noun[0], noun[1])} · ${on ? `${on} on` : 'none on'}${fromPlugins ? ` · ${fromPlugins} from plugins` : ''}` : `No ${noun[1]}`;
  return h('div.kind-card', {},
    h('div.kind-card-about', {},
      h('button.kind-card-main', { type: 'button', id: `overview-${kind}`, onclick: () => openKind(kind) },
        h('span.kind-card-head', {}, icon(kindGlyph[kind], 16), h('strong', {}, title), icon('arrow-right', 14, 'tone-faint'))),
      h('div.kind-card-summary', {}, h('span', {}, counts), syncState(kind, home))),
    cardUsage(kind, total, usageSums()?.kinds[kind], top));
}

// ---------- A most used item's file, under its card ----------

/**
 * The Overview as a file panel's place (filepanel.ts FilePlace): one most used item's file open at a time, drawn under its kind's
 * card (kindCards) and brought into view once read; kept for the home and the visit it was opened on (`on`), so another home or
 * another page closes it.
 */
const cardFiles: FilePlace & { on?: string } = {
  view: {}, named: true, reveal: () => requestAnimationFrame(() => document.querySelector('.kind-cards > .details-file-only')?.scrollIntoView({ block: 'nearest' })),
};
// Escape closes the file open under a card, the focus back on its mark; an info card open is closed first (renderer.ts).
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.page === 'overview' && cardFiles.view.openFile) setFile(cardFiles, undefined, undefined, true); });

/**
 * The cards, each followed by its file panel where the file open here is one of the items it names (topRows), kept or let go
 * as every place's is (filepanel.ts keepOpenFile). A panel spans the cards' row (style.css .kind-cards): under its card in one
 * column, under all three in three.
 */
function kindCards(home: HomeView, kinds: PageKind[]) {
  const on = `${home.home} ${state.visit}`;
  if (cardFiles.on !== on) Object.assign(cardFiles, { on, view: {} });
  const tops = kinds.map(kind => ({ kind, top: topRows(home, kind) }));
  const target = keepOpenFile(cardFiles, tops.flatMap(({ top }) => top.flatMap(each => (each.row ? [each.row] : []))));
  const filed = target && tops.find(({ top }) => top.some(each => each.row === target))?.kind;
  const panel = target ? filePanel(cardFiles, target, cardFiles.view.openFile!, true) : null;
  return h('div.kind-cards', { 'data-count': String(kinds.length) }, tops.flatMap(({ kind, top }) => [kindCard(kind, home, top), kind === filed ? panel : null]));
}

// ---------- Usage: the strip that says it and collects it again ----------

/**
 * The usage reading's strip, as high in each state: its three sentences share one place, the others kept but not shown
 * (style.css .band-stack). Collecting (by itself when a home opens, or on Update); collected, when, with Update usage statistics
 * and, where any kind has unused items, one link to them all on the Library; or the history couldn't be read, with Try again,
 * in a box. Both buttons collect without opening the item lists' band.
 */
function usageStrip(kinds: readonly PageKind[]) {
  const read = usageOnShow();
  const now = state.usage.state === 'reading' ? 0 : state.usage.state === 'failed' || !read ? 2 : 1;
  const unused = unusedCount(kinds);
  const again = (label: string, id: string, shown: boolean) => button({ variant: 'link', size: 'micro', label, id: shown ? id : undefined, onclick: () => void collectUsage() });
  const unusedLink = unused ? h('button.btn.link.micro', {
    type: 'button',
    id: now === 1 ? 'overview-unused' : undefined,
    onclick: () => openKind('all', { filter: 'unused' }),
  }, h('span.btn-label', {}, `No use seen in ${USAGE_DAYS} days: ${unused}`), icon('arrow-right', 13)) : null;
  const sentences = [
    [icon('refresh-cw', 14, 'spin tone-muted'), 'Collecting usage statistics: reading your tools’ session history on this computer. Nothing leaves it.'],
    [icon('history', 14, 'tone-muted'), `Usage collected ${dayAndTime(read?.at ?? new Date().toISOString())}. `,
      again('Update usage statistics', 'overview-collect-usage', now === 1), ...(unusedLink ? [' · ', unusedLink] : [])],
    [icon('triangle-alert', 14, 'tone-warning'), 'Your tools’ session history couldn’t be read. ', again('Try again', 'overview-collect-again', now === 2)],
  ];
  return h(`div.overview-usage${now === 2 ? '.overview-usage-failed' : ''}`, { id: 'overview-usage', role: 'status' },
    h('span.band-stack', {}, sentences.map((parts, at) => h(`span.overview-usage-text${at === now ? '' : '.band-unshown'}`, {}, ...parts))));
}

// ---------- A row per managed tool ----------

/** Sessions in the last USAGE_DAYS days: "?" for unread history, a count followed by "?" for a partial read, or the count with its start day for a short history. */
function sessionsCell(history: ToolHistory | undefined) {
  if (firstReadingRuns()) return h('td.tools-sessions.tone-faint', {}, '…');
  if (!history) return h('td.tools-sessions', {});
  if (history.goes === 'unread') return h('td.tools-sessions.tone-muted', {}, '?');
  if (history.goes === 'partial') return h('td.tools-sessions', {}, `${history.recent} ?`);
  if (history.goes === 'none') return h('td.tools-sessions.tone-muted', {}, 'no sessions');
  const since = history.goes === 'from' ? h('span.tone-muted', {}, ` · history from ${dayWords(history.from)}`) : null;
  return h('td.tools-sessions', {}, h('strong.tools-count', {}, String(history.recent)), since);
}

/** A count cell: the figure, "—" where that kind isn't handled for the tool, "?" where what it holds isn't all known. */
const countCell = (shown: string) => h(`td.num${shown === '—' ? '.tone-faint' : ''}`, {}, shown);
const pluginsShown = (plugins: PluginsInstalled) => (plugins.state === 'unsupported' ? '—' : plugins.state === 'unknown' ? '?' : String(plugins.count));

/**
 * Each managed tool: its name (to its page on Harnesses) with its version on this computer; how many of each kind it has as
 * Harnesses counts them, "?" where its file of that kind couldn't be read (LibraryView unread); its plugins (pluginsInstalled);
 * and its sessions in the last USAGE_DAYS days. The columns' widths are fixed (style.css .tools-table), so nothing moves when the
 * sessions land. Then a key for "—" and "?", and the installed tools left out, with where their switch is.
 */
function toolsTable(home: HomeView) {
  const tools = homeTools(), kinds = heldKinds(home), plugins = !absentKinds().includes('plugins'), histories = usageSums()?.tools ?? [];
  const version = (tool: HarnessId) => (home.mode === 'actual' ? home.snapshots.find(snapshot => snapshot.harness === tool)?.probe.version : undefined);
  const kindShown = (kind: PageKind, tool: HarnessId) => { const count = tally(home, kind, tool); return !count.supported ? '—' : home[kind].unread.includes(tool) ? '?' : String(count.total); };
  const rows = tools.map(tool => ({ tool, kinds: kinds.map(kind => kindShown(kind, tool)),
    plugins: plugins ? pluginsShown(pluginsInstalled(home, tool)) : undefined, sessions: sessionsCell(histories.find(each => each.tool === tool)) }));
  const shown = rows.flatMap(row => [...row.kinds, row.plugins, row.sessions.textContent]), kindDash = rows.some(row => row.kinds.includes('—'));
  const dashes = [kindDash ? 'that kind isn’t handled for that tool' : '', rows.some(row => row.plugins === '—') ? takesItemsOnly('that tool') : ''].filter(Boolean);
  const unknown = shown.some(value => value?.endsWith('?'));
  const key = [dashes.length ? `—: ${dashes.join(', or ')}.` : '',
    unknown ? '?: not known, as what that tool keeps there couldn’t all be read. A number before the mark is what was counted, and there may be more.' : ''].filter(Boolean).join(' ');
  const out = home.sync.present.filter(tool => !tools.includes(tool));
  return h('section.overview-tools', { 'aria-labelledby': 'overview-tools-title' },
    h('h2.eyebrow', { id: 'overview-tools-title' }, 'Your tools'),
    h('table.tools-table', {},
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Tool'), ...kinds.map(kind => h('th.num', { scope: 'col' }, kindNouns[kind].title)),
        plugins ? h('th.num', { scope: 'col' }, 'Plugins') : null, h('th.tools-sessions', { scope: 'col' }, `Sessions, ${USAGE_DAYS} days`))),
      h('tbody', {}, ...rows.map(row => h('tr', { 'data-tool': row.tool },
        h('th', { scope: 'row' }, h('button.tools-tool', { type: 'button', id: `overview-tool-${row.tool}`, onclick: () => { showPage('harnesses'); goHarness(row.tool); } },
          brandMark(row.tool, 14), h('span.tools-tool-name', {}, toolNames[row.tool])), version(row.tool) ? h('span.tools-version', {}, version(row.tool)!) : null),
        ...row.kinds.map(countCell), row.plugins ? countCell(row.plugins) : null,
        row.sessions)))),
    key ? h('p.tools-table-note', { id: 'overview-tools-key' }, key) : null,
    out.length ? h('p.tools-table-note', { id: 'overview-left-out' }, `${toolList(out)} ${out.length === 1 ? 'is' : 'are'} installed and left out: `,
      link(out.length === 1 ? 'its switch is on Harnesses' : 'their switches are on Harnesses', 'overview-left-out-open', () => showPage('harnesses')), '.') : null);
}

// ---------- The page ----------

export function overviewPage() {
  const home = state.home;
  if (!home) return notRead();
  const empty = noToolManaged(), absent = absentKinds(), band = outcomeBand(), kinds = heldKinds(home);
  return h('div.page', {},
    band ? h('div.bands', {}, band) : null,
    h('div.scroll.overview-scroll', { id: 'overview-scroll' },
      practiceBanner(),
      // Until something is on, the lead says what Central Knot does (first setup's question, while it asks); after, the cards and
      // the tools say it in figures.
      empty ? noToolsLead('overview') : !anyOn(home) && asksNow(home) !== 'question' ? h('p.overview-lead', {}, leadSentence(home), nextStep(home)) : null,
      needsYou(home),
      empty ? null : kindCards(home, kinds),
      empty ? null : usageStrip(kinds),
      empty ? null : toolsTable(home),
      h('div.overview-more', {},
        absent.length && !empty ? line('overview-absent', 'info', 'tone-muted', `No tool here holds ${orList(absent.map(kind => kindNames[kind]))}.`) : null,
        // Automatic sync's state is the status bar's; what it did is History's.
        line('overview-kept', 'history', 'tone-muted', 'Every change Central Knot makes in your tools is kept in ', link('History', 'overview-history', () => showPage('history')),
          ', with Undo where it can be undone.'))));
}

// The Overview, the page the app opens on (app.ts state.page starts on it; nothing remembers another page across a launch).
// Top to bottom: what the last action did (matrix.ts outcomeBand) and the Practice copy's note; the lead, only while nothing is
// on; what needs you (needsYou: one function, one order, nothing when nothing does); a card per kind (kindCard: its counts and
// whether it is in sync, then what the usage reading says of it); the usage line (usageLine); a row per managed tool
// (toolsTable: its version, what it has of each kind and of plugins, its sessions in the last 30 days); and the sync line.
// Nothing is stored. The figures come from the home's view, the usage reading on show and its sum (matrix.ts usageOnShow,
// usageSums: usagerow.ts usageSummary), Harnesses' counts (harnesspage.ts tally, pluginsInstalled) and the update state
// (updateview.ts updateLine). While a home's first reading runs (matrix.ts firstReadingRuns) every place a reading fills is
// drawn at its final size, so nothing moves when it lands. A kind's page opens through matrix.ts openKind. Not here: the empty
// states every page shares (pages.ts noToolsLead, notRead, previewReason) and first setup's question (firstsetup.ts setupLead).
import { absentKinds, collectUsage, homeTools, loadHome, noToolManaged, practiceNoteOpen, realHomeName, rerender, setPracticeNote, showPage, state, syncNow, whyReadOnly, type PageKind } from './app.ts';
import { brandMark } from './brand.ts';
import { button, h, icon, middle } from './dom.ts';
import { setupLead } from './firstsetup.ts';
import { goHarness, pluginsInstalled, tally } from './harnesspage.ts';
import { anyOn, kindSource } from './itemrow.ts';
import { asksWhichCopy } from './libraryrow.ts';
import { firstReadingRuns, openKind, outcomeBand, problemsBesideStop, usageOnShow, usageSums } from './matrix.ts';
import { dayAndTime, dayWords, plural } from './model.ts';
import { noToolsLead, notRead, previewReason } from './pages.ts';
import { pluginItemCount } from './pluginrows.ts';
import { heldKinds, takesPlugins } from './presence.ts';
import type { HarnessId, HomeView } from './types.ts';
import { updateLine } from './updateview.ts';
import { asksNow } from './setupcounts.ts';
import { USAGE_DAYS, type KindUsage, type ToolHistory } from './usagerow.ts';
import { andList, kindNames, kindNouns, orList, toolList, toolNames } from './words.ts';

const glyphs = { skills: 'wand-sparkles', mcp: 'plug', agents: 'bot' } as const;
/** One line of the page: its mark, then words and links that wrap under themselves. */
const line = (id: string, glyph: Parameters<typeof icon>[0], tone: string, ...rest: (Node | string | null)[]) => h('p.overview-line', { id }, icon(glyph, 14, tone), ...rest);
const link = (label: string, id: string, onclick: () => void) => button({ variant: 'link', size: 'micro', label, id, onclick });

// ---------- The lead: what Central Knot does, while nothing is on ----------

/**
 * What Central Knot keeps the same, between the managed tools only, naming only the kinds a tool here can hold. A kind not every
 * tool here holds says which do, or which don't ("… in all but Codex"). The tools left out are named under the tools table.
 */
function leadSentence(home: HomeView): string {
  const tools = homeTools(), named = andList(tools.map(tool => toolNames[tool]));
  const holdersOf = { skills: tools, mcp: home.mcp.tools, agents: home.agents.tools };
  const held = heldKinds(home).map(kind => [kindNouns[kind].many, holdersOf[kind]] as const);
  if (tools.length === 1) return `Central Knot keeps the ${andList(held.map(([kind]) => kind))} you choose the same between your tools. ${home.sync.present.length > 1 ? `It manages only ${named} here` : `Only ${named} is in this home`}, so there is nothing to keep in step yet.`;
  const everywhere = held.filter(([, holders]) => holders.length === tools.length).map(([kind]) => kind);
  const some = held.filter(([, holders]) => holders.length < tools.length).map(([kind, holders]) => {
    const without = tools.filter(tool => !holders.includes(tool));
    return holders.length >= without.length ? `${kind} in all but ${andList(without.map(tool => toolNames[tool]))}` : `${kind} in ${andList(holders.map(tool => toolNames[tool]))}`;
  });
  return `Central Knot keeps the ${andList(everywhere)} you choose the same in ${named}${some.map(part => `; ${part}`).join('')}.`;
}

/**
 * The lead's next step, only where it can be taken: with two tools or more, turn something on (where first setup's question
 * isn't asking: `asking`); with one tool there is nothing to keep in step, so it says how a second one joins.
 */
function nextStep(home: HomeView, asking: boolean): string {
  if (!home.skills.items.length && !home.mcp.items.length && !home.agents.items.length) return ' Nothing found in this home yet.';
  // With a tool left out, the line under the tools table says where its switch is.
  if (homeTools().length === 1) return home.sync.present.length > 1 ? '' : ' When a second tool is installed, or its folder appears here, Central Knot finds it on its own; then manage what you want the same in both.';
  return home.sync.access.allowed && !asking ? ' Open one below and turn on what you want the same in every tool.' : '';
}

/** The practice copy explains itself the first times it opens: what it is, that it is safe, and how to move to the real thing. */
function practiceBanner() {
  if (state.home?.mode !== 'fixture' || !practiceNoteOpen()) return null;
  const real = button({ variant: 'link', size: 'small', label: `or use ${realHomeName}`, id: 'intro-use-real', onclick: () => void loadHome('actual') });
  real.title = 'Only reads your tools; nothing is written there until you say so.';
  return h('div.intro', { role: 'note' },
    h('div.intro-text', {}, h('strong', {}, 'This is a practice copy.'), h('span', {}, ' Sample skills, MCP servers and agents in a throwaway folder. Nothing here touches your real tools, so try anything.')),
    // The first step stays inside the sandbox; the real home is the quieter second choice.
    button({ variant: 'primary', size: 'small', label: 'Try it: open Skills', id: 'intro-try', onclick: () => showPage('skills') }), real,
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Hide this note', id: 'intro-dismiss', onclick: () => { setPracticeNote(false); rerender(); } }));
}

// ---------- What needs you ----------

/**
 * Whether first setup speaks of found items whose copies differ: its question asks about them, and with Synchronize everything
 * on its line leads into choosing them (where the home can be written). Otherwise each kind's line says them (needsYou), so they
 * are said once.
 */
const setupSpeaksOfCopies = (home: HomeView) => asksNow(home) === 'question' || (home.sync.syncEverything === true && !whyReadOnly(home));

/**
 * What needs the person, before any figure, in this order: first setup (its question, Resume, or the way into choosing copies:
 * firstsetup.ts setupLead); an update to install (updateview.ts updateLine); why the home can't be written (preview only, or a
 * record that stops every write); each kind's problems, each said once (that record's reason is said above: matrix.ts
 * problemsBesideStop); found items whose copies differ, a line per kind with the page's "Copies differ" count, where first setup
 * doesn't speak of them; Automatic sync off. Nothing when none applies.
 */
function needsYou(home: HomeView): HTMLElement | null {
  const empty = noToolManaged(), readOnly = whyReadOnly(home);
  const kinds = heldKinds(home), said = new Set<string>();
  const problems = empty ? [] : kinds.flatMap(kind => problemsBesideStop(home[kind].problems, home.sync.gate).filter(problem => !said.has(problem) && said.add(problem)).map((problem, at) =>
    line(`overview-${kind}-problem-${at}`, 'triangle-alert', 'tone-warning', `${problem} `, link(`Open ${kindNouns[kind].title}`, `overview-${kind}-problem-${at}-open`, () => openKind(kind)))));
  const differ = empty || setupSpeaksOfCopies(home) ? [] : kinds.map(kind => {
    const count = kindSource(home, kind).facts.filter(asksWhichCopy).length, { one, many } = kindNouns[kind];
    return !count ? null : line(`overview-${kind}-differ-line`, 'diff', 'tone-warning', `${plural(count, `found ${one}`, `found ${many}`)} ${count === 1 ? 'has' : 'have'} copies that differ. `,
      link('Show them', `overview-${kind}-differ`, () => openKind(kind, { filter: 'attention' })));
  });
  const lines = [empty ? null : setupLead(home), updateLine(),
    empty || !readOnly ? null : home.sync.access.allowed ? line('overview-stopped', 'circle-alert', 'tone-danger', readOnly)
      : line('overview-preview', 'lock', 'tone-warning', `Automatic sync is paused. Preview only: ${previewReason(readOnly)}.`),
    ...problems, ...differ,
    empty || readOnly || home.syncOn ? null : line('overview-sync-off', 'circle-minus', 'tone-warning', 'Automatic sync is off: edits wait until you turn it on or ', link('Sync once', 'overview-sync-now', () => void syncNow()), '.'),
  ].filter((each): each is HTMLElement => !!each);
  return lines.length ? h('div.overview-needs', { id: 'overview-needs' }, lines) : null;
}

// ---------- A card per kind ----------

/**
 * What the usage reading says of a kind, in five lines that are always there, so the card is as high before a reading lands
 * as after: how many were used in USAGE_DAYS ("…" while the first reading runs; "can't say" where no row has a figure:
 * usagerow.ts KindUsage figured); how many the page's "No use seen in 30 days" chip holds (a link to the page narrowed to it,
 * where Turn these off is); and the three most used, each a link to its row, its name shortened in the middle. A line with
 * nothing to say (the chip at 0, fewer than three used) is drawn empty, the chip's last.
 */
function cardUsage(kind: PageKind, total: number, sum: KindUsage | undefined) {
  const slot = (...content: (Node | string | null)[]) => h('p.kind-card-slot', {}, ...content);
  const tell = !!sum && !!total && !!sum.figured;
  const used = !total ? '' : firstReadingRuns() ? `Used in the last ${USAGE_DAYS} days: …` : !sum ? '' : `Used in the last ${USAGE_DAYS} days: ${tell ? sum.used.length : 'can’t say'}`;
  const second = !sum || !total ? null : !tell ? 'No tool that has them on can tell.'
    : sum.noUseSeen.length ? h('button.kind-card-link', { type: 'button', id: `overview-${kind}-unused`, onclick: () => openKind(kind, { filter: 'unused' }) }, `No use seen in ${USAGE_DAYS} days: ${sum.noUseSeen.length}`) : null;
  const top = tell ? sum!.mostUsed : [];
  return h('div.kind-card-usage', { id: `overview-${kind}-usage` },
    slot(used), second ? slot(second) : null,
    h('div.kind-card-top', {}, [0, 1, 2].map(at => {
      const each = top[at];
      return h('p.kind-card-slot.kind-card-top-row', {}, at === 0 && each ? h('span', {}, 'Most used') : h('span'),
        each ? h('button.kind-card-link.kind-card-top-name', { type: 'button', id: `overview-${kind}-top-${at}`, onclick: () => openKind(kind, { key: each.key }) }, middle(each.name, 8)) : h('span'),
        each ? h('span', {}, plural(each.sessions, 'session')) : h('span'));
    })),
    second ? null : slot());
}

/**
 * One kind: its page (the card's one button, over the whole card), how many there are, how many are synced and how many come from
 * plugins, then whether it is in sync ("All in sync", or changes waiting to sync; never "differ": what needs a choice is said
 * above), then its usage (cardUsage).
 */
function kindCard(kind: PageKind, home: HomeView) {
  const { title, short: noun } = kindNouns[kind], facts = kindSource(home, kind).facts;
  const fromPlugins = pluginItemCount(home, kind), total = facts.length + fromPlugins;
  const on = facts.filter(fact => fact.on).length, waiting = facts.filter(fact => fact.on && fact.edited?.length).length;
  const status = waiting ? h('span.kind-card-state.tone-warning', {}, icon('clock', 13), `${plural(waiting, 'change')} waiting to sync`)
    : on ? h('span.kind-card-state.tone-success', {}, icon('check', 13), 'All in sync') : null;
  return h('div.kind-card', {},
    h('div.kind-card-about', {},
      h('button.kind-card-main', { type: 'button', id: `overview-${kind}`, onclick: () => openKind(kind) },
        h('span.kind-card-head', {}, icon(glyphs[kind], 16), h('strong', {}, title), icon('arrow-right', 14, 'tone-faint'))),
      h('div.kind-card-summary', {}, h('span', {}, total ? `${plural(total, noun[0], noun[1])} · ${on ? `${on} synced` : 'none synced'}${fromPlugins ? ` · ${fromPlugins} from plugins` : ''}` : `No ${noun[1]}`), status)),
    cardUsage(kind, total, usageSums()?.kinds[kind]));
}

// ---------- Usage: the one line that says it and collects it again ----------

/**
 * The usage reading's line, as high in each state: its three sentences share one place, the others kept but not shown
 * (style.css .band-stack). Collecting (by itself when a home opens, or on Update); collected, when, with Update usage statistics;
 * or the history couldn't be read, with Try again, in a box. Both buttons collect without opening the item pages' band.
 */
function usageLine() {
  const read = usageOnShow(), now = state.usage.state === 'reading' ? 0 : state.usage.state === 'failed' || !read ? 2 : 1;
  const again = (label: string, id: string, shown: boolean) => button({ variant: 'link', size: 'micro', label, id: shown ? id : undefined, onclick: () => void collectUsage() });
  const sentences = [
    [icon('refresh-cw', 14, 'spin tone-muted'), 'Collecting usage statistics: reading your tools’ session history on this computer. Nothing leaves it.'],
    [icon('history', 14, 'tone-muted'), `Usage collected ${dayAndTime(read?.at ?? new Date().toISOString())}. `, again('Update usage statistics', 'overview-collect-usage', now === 1)],
    [icon('triangle-alert', 14, 'tone-warning'), 'Your tools’ session history couldn’t be read. ', again('Try again', 'overview-collect-again', now === 2)],
  ];
  return h(`div.overview-usage${now === 2 ? '.overview-usage-failed' : ''}`, { id: 'overview-usage', role: 'status' },
    h('span.band-stack', {}, sentences.map((parts, at) => h(`span.overview-usage-text${at === now ? '' : '.band-unshown'}`, {}, ...parts))));
}

// ---------- A row per managed tool ----------

/** A tool's sessions in the last USAGE_DAYS days (usagerow.ts ToolHistory), with the day its history starts where that is later. */
function sessionsCell(history: ToolHistory | undefined) {
  if (firstReadingRuns()) return h('td.tools-sessions.tone-faint', {}, '…');
  if (!history) return h('td.tools-sessions', {});
  if (history.goes === 'unread') return h('td.tools-sessions.tone-muted', {}, 'couldn’t be read');
  if (history.goes === 'none') return h('td.tools-sessions.tone-muted', {}, 'no sessions');
  return h('td.tools-sessions', {}, h('strong.tools-count', {}, String(history.recent)), history.goes === 'from' ? h('span.tone-muted', {}, ` · history from ${dayWords(history.from)}`) : null);
}

/** A tool's plugins as Harnesses counts them (harnesspage.ts pluginsInstalled): "—" where it takes none from a marketplace. */
function pluginsCell(tool: HarnessId) {
  const plugins = pluginsInstalled(tool);
  const shown = !takesPlugins(tool) || plugins.state === 'unsupported' ? '—' : plugins.state === 'reading' ? '…' : plugins.state === 'failed' ? '?' : String(plugins.count);
  return h(`td.num${shown === '—' || shown === '…' ? '.tone-faint' : ''}`, {}, shown);
}

/**
 * Each managed tool: its name (to its page on Harnesses) with its version on this computer, how many of each kind it has as
 * Harnesses counts them ("—" where it can't hold that kind), its plugins, and its sessions in the last USAGE_DAYS days. The
 * columns' widths are fixed (style.css .tools-table), so nothing moves when the sessions land. Then a key for what "—" and "?"
 * stand for, and the installed tools left out, with where their switch is.
 */
function toolsTable(home: HomeView) {
  const tools = homeTools(), kinds = heldKinds(home), plugins = !absentKinds().includes('plugins'), histories = usageSums()?.tools ?? [];
  const version = (tool: HarnessId) => (home.mode === 'actual' ? home.snapshots.find(snapshot => snapshot.harness === tool)?.probe.version : undefined);
  const counts = tools.map(tool => kinds.map(kind => tally(home, kind, tool)));
  const kindDash = counts.some(row => row.some(count => !count.supported)), pluginDash = plugins && tools.some(tool => !takesPlugins(tool) || pluginsInstalled(tool).state === 'unsupported');
  const unread = plugins && tools.some(tool => takesPlugins(tool) && pluginsInstalled(tool).state === 'failed');
  const out = home.sync.present.filter(tool => !tools.includes(tool));
  const key = [kindDash ? 'that tool can’t hold that kind' : '', pluginDash ? 'Central Knot doesn’t move that tool’s plugins' : ''].filter(Boolean);
  return h('section.overview-tools', { 'aria-labelledby': 'overview-tools-title' },
    h('h2.eyebrow', { id: 'overview-tools-title' }, 'Your tools'),
    h('table.tools-table', {},
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Tool'), ...kinds.map(kind => h('th.num', { scope: 'col' }, kindNouns[kind].title)),
        plugins ? h('th.num', { scope: 'col' }, 'Plugins') : null, h('th.tools-sessions', { scope: 'col' }, `Sessions, ${USAGE_DAYS} days`))),
      h('tbody', {}, ...tools.map((tool, row) => h('tr', { 'data-tool': tool },
        h('th', { scope: 'row' }, h('button.tools-tool', { type: 'button', id: `overview-tool-${tool}`, onclick: () => { showPage('harnesses'); goHarness(tool); } },
          brandMark(tool, 14), h('span.tools-tool-name', {}, toolNames[tool])), version(tool) ? h('span.tools-version', {}, version(tool)!) : null),
        ...counts[row].map(count => (count.supported ? h('td.num', {}, String(count.total)) : h('td.num.tone-faint', {}, '—'))),
        plugins ? pluginsCell(tool) : null,
        sessionsCell(histories.find(each => each.tool === tool)))))),
    key.length || unread ? h('p.tools-table-note', { id: 'overview-tools-key' }, [key.length ? `—: ${key.join(', or ')}.` : '', unread ? '?: the marketplaces couldn’t be read.' : ''].filter(Boolean).join(' ')) : null,
    out.length ? h('p.tools-table-note', { id: 'overview-left-out' }, `${toolList(out)} ${out.length === 1 ? 'is' : 'are'} installed and left out: `,
      link(out.length === 1 ? 'its switch is on Harnesses' : 'their switches are on Harnesses', 'overview-left-out-open', () => showPage('harnesses')), '.') : null);
}

// ---------- The page ----------

/** Automatic sync's line, with History's: green once something syncs; before that, or where nothing can be written, History alone. */
function syncLine(home: HomeView, nothingOn: boolean) {
  const history = link('History', 'overview-history', () => showPage('history'));
  if (!home.syncOn || whyReadOnly(home) || nothingOn || noToolManaged()) return line('overview-sync', 'history', 'tone-muted', 'Every change Central Knot makes in your tools is kept in ', history, ', with Undo.');
  return line('overview-sync', 'refresh-cw', 'tone-success', `Automatic sync is on: edits spread between tools in seconds${home.sync.syncEverything ? ', and what turns up in a tool is taken in by Synchronize everything' : ''}. Every change is kept in `, history, ', with Undo.');
}

export function overviewPage() {
  const home = state.home;
  if (!home) return notRead();
  const empty = noToolManaged(), absent = absentKinds(), nothingOn = !anyOn(home), band = outcomeBand();
  const kinds = heldKinds(home);
  return h('div.page', {},
    band ? h('div.bands', {}, band) : null,
    h('div.scroll.overview-scroll', { id: 'overview-scroll' },
      practiceBanner(),
      // A home with no tools has nothing to count: the way forward is another home, or Harnesses. Until something is on, the
      // lead says what Central Knot does; after, the cards and the tools say it in figures.
      empty ? noToolsLead('overview') : nothingOn ? h('p.overview-lead', {}, leadSentence(home), nextStep(home, asksNow(home) === 'question')) : null,
      needsYou(home),
      empty ? null : h('div.kind-cards', { 'data-count': String(kinds.length) }, kinds.map(kind => kindCard(kind, home))),
      empty ? null : usageLine(),
      empty ? null : toolsTable(home),
      h('div.overview-more', {},
        absent.length && !empty ? line('overview-absent', 'info', 'tone-muted', `No tool here holds ${orList(absent.map(kind => kindNames[kind]))}.`) : null,
        syncLine(home, nothingOn))));
}

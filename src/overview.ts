// The Overview, in page order: what needs a person, a card for each kind, when usage was collected,
// then the managed tools. Counts come from the same home, usage summary and install counts as their pages.
import { absentKinds, collectUsage, homeTools, KINDS, loadHome, noToolManaged, practiceNoteOpen, realHomeName,
  rerender, setPracticeNote, showPage, state, syncNow, whyReadOnly, type PageKind } from './app.ts';
import { button, h, icon, middle } from './dom.ts';
import { dayAndTime, dayWords, plural, toolName } from './model.ts';
import type { HomeView } from './types.ts';
import { heldKinds, takesPlugins } from './presence.ts';
import { firstReading, homeReading, homeUsage, openKind, otherProblems, outcomeBand } from './matrix.ts';
import { brandMark } from './brand.ts';
import { andList, kindNames, kindNouns, orList, toolList } from './words.ts';
import { inTool, pluginItemCount } from './pluginrows.ts';
import { asksWhichCopy } from './libraryrow.ts';
import { anyOn, kindSource } from './itemrow.ts';
import { setupLead } from './firstsetup.ts';
import { goHarness, pluginCount } from './harnesspage.ts';
import { noToolsLead, notRead } from './pages.ts';
import { USAGE_DAYS, type KindUsage, type ToolHistory } from './usagerow.ts';
import { overviewUpdate } from './updateview.ts';

const glyphs = { skills: 'wand-sparkles', mcp: 'plug', agents: 'bot' } as const;

// ---------- The lead: what Central Knot does, until something is on ----------

/**
 * The Overview's first sentence: what Central Knot keeps the same, between this home's tools only, naming only the kinds
 * a tool here can hold. A kind not every tool here holds says which do, or which don't ("… in all but Codex").
 */
function leadSentence(home: HomeView): string {
  const tools = homeTools();
  const named = andList(tools.map(toolName));
  const holdersOf = { skills: tools, mcp: home.mcp.tools, agents: home.agents.tools };
  const held = heldKinds(home).map(kind => [kindNouns[kind].many, holdersOf[kind]] as const);
  const out = home.sync.present.filter(tool => !tools.includes(tool));
  if (tools.length === 1) return `Central Knot keeps the ${andList(held.map(([kind]) => kind))} you choose the same between your tools. ${out.length ? `It manages only ${named} here` : `Only ${named} is in this home`}, so there is nothing to keep in step yet.`;
  const everywhere = held.filter(([, holders]) => holders.length === tools.length).map(([kind]) => kind);
  const some = held.filter(([, holders]) => holders.length < tools.length).map(([kind, holders]) => {
    const without = tools.filter(tool => !holders.includes(tool));
    return holders.length >= without.length ? `${kind} in all but ${andList(without.map(toolName))}` : `${kind} in ${andList(holders.map(toolName))}`;
  });
  return `Central Knot keeps the ${andList(everywhere)} you choose the same in ${named}${some.map(part => `; ${part}`).join('')}.`;
}

/**
 * The lead's next step, only where it can be taken: with two tools or more and nothing On, turn something on (where first
 * setup's question isn't asking: `asking`); with one tool there is nothing to keep in step, so it says how a second one joins.
 */
function nextStep(home: HomeView, asking: boolean): string {
  if (!home.skills.items.length && !home.mcp.items.length && !home.agents.items.length) return ' Nothing found in this home yet.';
  if (homeTools().length === 1) return home.sync.present.length > 1 ? '' : ' When a second tool is installed, or its folder appears here, Central Knot finds it on its own; then manage what you want the same in both.';
  return !whyReadOnly(home) && !asking ? ' Open one below and turn on what you want the same in every tool.' : '';
}

/** The practice copy explains itself the first times it opens: what it is, that it is safe, and how to move to the real thing. */
function practiceBanner() {
  if (state.home?.mode !== 'fixture' || !practiceNoteOpen()) return null;
  return h('div.intro', { role: 'note' },
    h('div.intro-text', {},
      h('strong', {}, 'This is a practice copy.'),
      h('span', {}, ' Sample skills, MCP servers and agents in a throwaway folder. Nothing here touches your real tools, so try anything.')),
    // The first step stays inside the sandbox; the real home is the quieter second choice.
    button({ variant: 'primary', size: 'small', label: 'Try it: open Skills', id: 'intro-try', onclick: () => openKind('skills') }),
    (() => { const real = button({ variant: 'link', size: 'small', label: `or use ${realHomeName}`, id: 'intro-use-real', onclick: () => void loadHome('actual') }); real.title = 'Only reads your tools; nothing is written there until you say so.'; return real; })(),
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Hide this note', id: 'intro-dismiss', onclick: () => { setPracticeNote(false); rerender(); } }));
}

// ---------- What needs the person ----------

const line = (id: string | undefined, glyph: Parameters<typeof icon>[0], tone: string, ...rest: (Node | string | null)[]) => h('p.overview-line', { id }, icon(glyph, 14, tone), ...rest);
/** One ordered list. Setup owns its count while asking or walking through choices; elsewhere the link opens the chip it counts. */
function attention(home: HomeView, setup: HTMLElement | null) {
  const readOnly = whyReadOnly(home);
  const seen = new Set<string>();
  const problems = KINDS.flatMap(kind => otherProblems(home[kind]).flatMap(problem => {
    if (seen.has(problem)) return [];
    seen.add(problem);
    return line(undefined, 'triangle-alert', 'tone-warning', problem, ' ',
      button({ variant: 'link', size: 'micro', label: `Open ${kindNouns[kind].title}`, onclick: () => openKind(kind) }));
  }));
  const differs = setup?.id === 'setup-question' || (!readOnly && home.sync.syncEverything) ? [] : heldKinds(home).map(kind => {
    const n = kindSource(home, kind).facts.filter(asksWhichCopy).length;
    const noun = kindNouns[kind];
    return n ? line(undefined, 'diff', 'tone-warning', `${n} found ${n === 1 ? noun.one : noun.many} ${n === 1 ? 'has' : 'have'} copies that differ. `,
      button({ variant: 'link', size: 'micro', label: 'Show them', id: `overview-${kind}-differ`, onclick: () => openKind(kind, { filter: 'attention' }) })) : null;
  });
  return [setup, overviewUpdate(),
    readOnly ? line('overview-read-only', 'lock', 'tone-warning', readOnly) : null, ...problems, ...differs,
    !noToolManaged() && !readOnly && !home.syncOn ? line('overview-sync-off', 'circle-minus', 'tone-warning',
      'Automatic sync is off: edits wait until you turn it on or ',
      button({ variant: 'link', size: 'micro', label: 'Sync once', id: 'overview-sync-now', onclick: () => void syncNow() }), '.') : null];
}

// ---------- A card per kind ----------

/** Five usage lines have room from the first draw: used, the actionable unused count, and the three most used rows. */
function cardUsage(page: PageKind, sum?: KindUsage) {
  const used = sum?.withFigure ? `${sum.used.length} used in the last ${USAGE_DAYS} days` : sum ? 'Can’t say whether these were used' : firstReading() ? '…' : '';
  return h('div.kind-card-usage', { id: `overview-${page}-usage` },
    h('p', {}, used),
    h('p', {}, sum?.noUseSeen.length ? h('button.inline-link.kind-card-link', { type: 'button', id: `overview-${page}-unused`,
      onclick: () => openKind(page, { filter: 'unused' }) }, `No use seen in ${USAGE_DAYS} days: ${sum.noUseSeen.length}`) : null),
    ...sum?.mostUsed.map(({ key, name, sessions }, i) => h('p.card-most-used', {}, i === 0 ? 'Most used: ' : '',
      h('button.inline-link.kind-card-link', { type: 'button', id: `overview-${page}-top-${i}`, onclick: () => openKind(page, { key }) }, middle(name, 6)),
      ` (${plural(sessions, 'session')})`)) ?? []);
}

function kindCard(page: PageKind, home: HomeView, sum?: KindUsage) {
  const { title, short: noun } = kindNouns[page];
  const facts = kindSource(home, page).facts;
  const fromPlugins = pluginItemCount(home, page), total = facts.length + fromPlugins;
  const on = facts.filter(fact => fact.on).length;
  const edits = facts.filter(fact => fact.on && fact.edited?.length).length;
  const status = edits ? h('span.kind-card-state.tone-warning', {}, icon('clock', 13), `${plural(edits, 'change')} waiting to sync`)
    : on && !facts.some(asksWhichCopy) ? h('span.kind-card-state.tone-success', {}, icon('check', 13), 'All in sync') : null;
  return h('div.kind-card', {},
    // The heading is the card's one button; its click area stretches over the whole card (style.css), under the links.
    h('button.kind-card-main', { type: 'button', id: `overview-${page}`, onclick: () => openKind(page) },
      h('span.kind-card-head', {}, icon(glyphs[page], 16), h('strong', {}, title), icon('arrow-right', 14, 'tone-faint'))),
    h('div.kind-card-summary', {}, h('span', {}, total ? `${plural(total, noun[0], noun[1])} · ${on ? `${on} synced` : 'none synced'}${fromPlugins ? ` · ${fromPlugins} from plugins` : ''}` : `No ${noun[1]}`),
      status ? h('span.kind-card-status', {}, status) : null),
    cardUsage(page, total ? sum : undefined));
}

/** A refresh keeps the last reading on show. A failed reading offers a retry in the same space. */
function usageStrip() {
  const slot = state.usage, read = homeReading();
  const action = (label: string) => button({ variant: 'link', size: 'micro', label, id: 'overview-collect-usage', onclick: () => void collectUsage() });
  if (slot.state === 'reading') return line('overview-usage', 'refresh-cw', 'spin', read ? 'Updating usage statistics…'
    : 'Collecting usage statistics: reading your tools’ session history on this computer. Nothing leaves it.');
  if (slot.state === 'failed') return h('p.overview-line.usage-failed', { id: 'overview-usage' },
    icon('triangle-alert', 14, 'tone-warning'), 'Your tools’ session history couldn’t be read. ', action('Try again'));
  return line('overview-usage', 'history', 'tone-muted', read ? `Usage collected ${dayAndTime(read.at)}. ` : '',
    action(read ? 'Update usage statistics' : 'Collect usage statistics'));
}

// ---------- A row per managed tool ----------

/** A second line is reserved for the start of a short history, so reading it never moves the following tool. */
function historyCell(each?: ToolHistory) {
  const count = !each ? firstReading() ? '…' : '—' : each.goes === 'unread' ? 'couldn’t be read' : each.goes === 'none' ? 'no sessions' : String(each.recent);
  return h('td.tools-history', {}, count, h('small', {}, each?.goes === 'from' ? `history from ${dayWords(each.from)}` : ''));
}

function toolsTable(home: HomeView, histories?: ToolHistory[]) {
  const tools = homeTools(), kinds = heldKinds(home), plugins = tools.some(takesPlugins);
  const out = home.sync.present.filter(tool => !tools.includes(tool));
  const dash = tools.some(tool => kinds.some(kind => !home[kind].tools.includes(tool)) || (plugins && !takesPlugins(tool)));
  const rows = tools.map(tool => {
    const version = home.mode === 'actual' && home.snapshots.find(s => s.harness === tool)?.probe.version;
    const installs = takesPlugins(tool) ? pluginCount(tool) : undefined;
    return h('tr', { 'data-tool': tool },
      h('th', { scope: 'row' }, h('button.inline-link.tools-table-name', { type: 'button', id: `overview-tool-${tool}`,
        onclick: () => { showPage('harnesses'); goHarness(tool); } }, brandMark(tool, 14), toolName(tool)),
        version ? h('small.tools-version', {}, version) : null),
      ...kinds.map(kind => h('td.num', {}, home[kind].tools.includes(tool)
        ? String(kindSource(home, kind).facts.filter(f => inTool(f, tool)).length + pluginItemCount(home, kind, tool)) : '—')),
      plugins ? h('td.num', {}, installs?.value === '—' ? installs.note : installs ? installs.value || '0' : '—') : null,
      historyCell(histories?.find(each => each.tool === tool)));
  });
  return h('section.overview-tools', { 'aria-labelledby': 'overview-tools-title' },
    h('h2.eyebrow', { id: 'overview-tools-title' }, 'Your tools'),
    h('table.tools-table', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Tool'),
      ...[...kinds.map(kind => kindNouns[kind].title), ...(plugins ? ['Plugins'] : [])].map(name => h('th.num', { scope: 'col' }, name)),
      h('th', { scope: 'col' }, `Sessions, ${USAGE_DAYS} days`))), h('tbody', {}, rows)),
    dash ? h('p.tools-table-note', {}, '— means this tool doesn’t support that kind.') : null,
    out.length ? h('p.tools-table-note', { id: 'overview-left-out' }, `${toolList(out)} ${out.length === 1 ? 'is' : 'are'} left out. `,
      button({ variant: 'link', size: 'micro', label: 'Open Harnesses', id: 'overview-open-harnesses', onclick: () => showPage('harnesses') })) : null);
}

// ---------- The page ----------

export function overviewPage() {
  const home = state.home;
  if (!home) return notRead();
  const empty = noToolManaged(), absent = absentKinds(), nothingOn = !anyOn(home), band = outcomeBand();
  const setup = empty ? null : setupLead(home);
  const sum = homeUsage();
  return h('div.page', {},
    band ? h('div.bands', {}, band) : null,
    h('div.scroll.overview-scroll', { id: 'overview-scroll' },
      practiceBanner(),
      // A home with no tools has nothing to count: the way forward is another home, or Harnesses.
      empty ? noToolsLead('overview')
        // Until something is on, the lead says what Central Knot does; after, the cards and the tools say it.
        : nothingOn ? h('p.overview-lead', {}, leadSentence(home), nextStep(home, setup?.id === 'setup-question')) : null,
      ...attention(home, setup),
      empty ? null : h('div.kind-cards', { 'data-count': String(heldKinds(home).length) }, ...heldKinds(home).map(page => kindCard(page, home, sum?.kinds[page]))),
      empty ? null : usageStrip(),
      empty ? null : toolsTable(home, sum?.tools),
      h('div.overview-more', {},
        absent.length && !empty ? h('p.overview-line', { id: 'overview-absent' }, icon('info', 14, 'tone-muted'), `No tool here holds ${orList(absent.map(kind => kindNames[kind]))}.`) : null,
        // Green only once something syncs; before that, sync is on and waiting. Off, the line is among what needs the person.
        !empty && home.syncOn && !whyReadOnly(home) && !nothingOn ? h('p.overview-line', {}, icon('refresh-cw', 14, 'tone-success'),
          `Automatic sync is on: edits spread between tools in seconds${home.sync.syncEverything ? ', and what turns up in a tool is taken in by Synchronize everything' : ''}. Every change is kept in `,
          button({ variant: 'link', size: 'micro', label: 'History', id: 'overview-history', onclick: () => showPage('history') }), ', with Undo.')
          : h('p.overview-line', {}, icon('history', 14, 'tone-muted'), 'Every change Central Knot makes in your tools is kept in ', button({ variant: 'link', size: 'micro', label: 'History', id: 'overview-history', onclick: () => showPage('history') }), ', with Undo.'))));
}

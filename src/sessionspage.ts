// The Sessions page (MAP.md, "Sessions"): one day's sessions, Today or Yesterday, read live from the tools' own session history,
// with what their tokens would cost at each model's API price; and, in a home that keeps session costs, 7 days (today and the
// six before) read from the kept record, a line for each day with sessions. The period is read when the page opens, when one is
// chosen and on the header's Refresh (loadSessions → main.ts sessions:read → sessionday.ts readSessionPeriod, then sessionrow.ts
// sessionRows; for 7 days main.ts sessions:read-kept → sessionday.ts readKeptPeriod, then sessionrow.ts dayByDay), and the answer
// is held in app.ts state.sessions (pagedata.ts). 7 days, once drawn, ask the keeper for a sweep (main.ts sessions:sweep →
// sessionkeep.ts sweepNow) and, while in view, are read again whenever an attempt of the keeper's ends (keeperNews), and once
// when the window is shown again (windowBack); such a read asks for none. Beside the choice sits
// "Keep costs for a 7-day view" while off, "Collecting…" while sweeping, or "Stop keeping" once kept, both buttons sharing one
// infoMark (sessionkeep.ts); any refusal shows verbatim inline. This module makes the period's local midnights from the calendar
// (boundsOf) and says the rows: every figure and sum is sessionrow.ts's, and the tools read are presence.ts SESSION_TOOLS. What
// a person needs is on the page; the heading's price dates, lower-bound reasons, unpriced reasons (carrying session count, dates
// and unread history when no estimate exists) and model aliases live in conditional infoMark cards, while per-tool and per-row
// details stay on hover (the native `title`, preserved on unpriced-only tool figures too); a day's rows are built only once it is
// opened. Not here: reading files or the record, pricing, summing, sweeping.
import { announce, keepingBusy, rerender, state, switchSessionCosts, windowVisible } from './app.ts';
import { brandMark } from './brand.ts';
import { afterLayout, button, h, icon, infoCardId, infoMark } from './dom.ts';
import { clockTime, plural } from './model.ts';
import { readPageData, resetPageData } from './pagedata.ts';
import { SESSION_TOOLS } from './presence.ts';
import { saveFailure, SESSION_COSTS_KEPT } from './settingspage.ts';
import { andList, orList, toolNames } from './words.ts';
import type { CostSum, DayRows, ModelCost, PeriodDay, PeriodRows, SessionRow, UnpricedBy } from './sessionrow.ts';
import type { HarnessId, HomeView, SessionCostsView } from './types.ts';

/** The period the page reads: a day from the tools' files, or 7 days from the kept record. */
export type SessionsDay = 'today' | 'yesterday' | 'week';
/** Each period's name on its button, and what the page says while it is read the first time. */
const choices: Record<SessionsDay, { label: string; reading: string }> = {
  today: { label: 'Today', reading: 'Reading today’s sessions…' },
  yesterday: { label: 'Yesterday', reading: 'Reading yesterday’s sessions…' },
  week: { label: '7 days', reading: 'Reading the last 7 days…' },
};
/** The providers the two tools read can be priced under (rates.ts TOOL_PROVIDERS, and Codex's saved one), by name; another id is said as it is. */
const providerNames: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
/**
 * The rows opened (by tool and session), By model ('by-model') and the days of 7 days (by home and the day's start, their rows
 * by that and tool and session), kept across redraws as editparts.ts infoBox keeps its boxes; never stored.
 */
const opened = new Set<string>();
/** The days of 7 days drawn so far, by home and start: today's opens itself the first time it is drawn only. */
const drawnDays = new Set<string>();
/** The most sessions today may have and still open by itself among 7 days (dayFold). */
const OPEN_TODAY_UP_TO = 10;
const ONE_HOUR = 'One-hour cache writes are priced at the shorter cache’s rate; higher rate unknown.';
const TOKEN_HEADS = ['Input', 'Cached', 'Cache-written', 'Output'];

/** Local midnight `back` days before `now`'s day, from the calendar: a day is 23 or 25 hours when the clocks change, never 24 added. */
const midnight = (now: Date, back: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime();
/**
 * The chosen period's local midnights, oldest first, the one after its last day last, from one reading of the clock: Today and
 * Yesterday are one day, 7 days today and the six before.
 */
function boundsOf(day: SessionsDay, now = new Date()): number[] {
  const [first, last] = day === 'today' ? [0, 0] : day === 'yesterday' ? [1, 1] : [6, 0];
  return Array.from({ length: first - last + 2 }, (_, index) => midnight(now, first - index));
}
/** "Today" or "Yesterday" for a reading's day as the clock stands now, so a page left open past midnight stays true; else none. */
const dayName = (start: number, now = new Date()) => (start === midnight(now, 0) ? 'Today' : start === midnight(now, 1) ? 'Yesterday' : undefined);
/** A day of 7 days as its line names it: Today, Yesterday, else as History heads a day (historypage.ts). */
const dayLineName = (start: number) => dayName(start) ?? new Date(start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const dateOf = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
/** A period's first and last day as one range ("November 19 – 25"). */
const datesOf = ({ start, end }: { start: number; end: number }) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).formatRange(start, end - 1);
/** A price list's date (`YYYY-MM-DD`) as the total's hover says it. */
const priceDate = (date: string) => {
  const [year, month, dayOfMonth] = date.split('-').map(Number);
  return new Date(year!, month! - 1, dayOfMonth).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
/** Which tools Central Knot reads, said where none is here. */
const readsSoFar = `So far Central Knot reads ${andList(SESSION_TOOLS.map(tool => `${toolNames[tool]}’s`))} sessions.`;
const unreadWords = (tool: HarnessId) => `Some of ${toolNames[tool]}’s session history could not be read.`;

/**
 * Reads the chosen period's rows into their slot: on opening the page and on Refresh (app.ts loadPageData), on a press of a
 * period, and when an attempt of the keeper's ends while 7 days are shown (keeperNews, with `sweep` false). Rows of another
 * period (the one chosen, or Today after midnight) are let go first, so the page says "Reading…" meanwhile. 7 days are read
 * only while the home keeps session costs (else Today is); with `sweep`, once their read has answered, they ask the keeper for
 * a sweep, if the home, the page's visit and the choice are still those that read.
 */
export async function loadSessions(readId?: number, sweep = true) {
  const home = state.home;
  if (!home) return;
  const visit = state.visit;
  if (state.sessionsDay === 'week' && !home.sessionCosts?.on) state.sessionsDay = 'today';
  const week = state.sessionsDay === 'week';
  const bounds = boundsOf(state.sessionsDay);
  if (state.sessions.data && state.sessions.data.period.start !== bounds[0]) resetPageData(state.sessions);
  const api = window.centralKnot;
  const id = readId ?? home.readId;
  const read = () => (week ? api.readKeptSessions(home.home, bounds, id) : api.readSessions(home.home, bounds[0]!, bounds[1]!, id));
  const reading = readPageData<DayRows | PeriodRows>(state.sessions, read);
  rerender();
  if ((await reading) !== 'dropped') rerender();
  const still = state.home?.home === home.home && state.page === 'sessions' && state.visit === visit && state.sessionsDay === 'week';
  if (week && sweep && still) void api.sweepSessions(home.home);
}

/** Whether 7 days are in view: the Sessions page, 7 days chosen, and the window not hidden (app.ts windowVisible). */
const weekInView = () => state.page === 'sessions' && state.sessionsDay === 'week' && windowVisible();
/**
 * The keeper's news, once taken in (app.ts onSessionCostsChanged): while 7 days of that home are in view, each time an attempt
 * has ended (`collecting` false: it kept, found nothing new, was refused or found the store busy), whether the page asked for it
 * or the 15-minute timer began it, or keeping was turned off, they are read once more. That read asks for no sweep.
 */
export function keeperNews(view: SessionCostsView) {
  if (view.collecting || view.home !== state.home?.home || !weekInView()) return;
  void loadSessions(undefined, false);
}
/** The window shown again (app.ts, on the page's visibilitychange): 7 days in view are read once, as nothing was read while it was hidden. */
export function windowBack() {
  if (weekInView()) void loadSessions(undefined, false);
}

/** Today | Yesterday, and 7 days where the home keeps session costs, built as the Library's kind switch (matrix.ts kindSwitch): a press reads that period as it is now. */
function dayChoice(home: HomeView) {
  const choice = (day: SessionsDay) => h(`button.kind-seg${state.sessionsDay === day ? '.kind-seg-on' : ''}`, {
    type: 'button', id: `sessions-day-${day}`, 'aria-pressed': String(state.sessionsDay === day), onclick: () => { state.sessionsDay = day; void loadSessions(); },
  }, h('span.kind-seg-label', {}, choices[day].label));
  const days: SessionsDay[] = home.sessionCosts?.on ? ['today', 'yesterday', 'week'] : ['today', 'yesterday'];
  return h('div.kind-switch', { role: 'group', 'aria-label': 'Period' }, ...days.map(choice));
}

/** Dollars as money: cents, or two significant digits under a cent. */
const dollars = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', ...(amount < 0.01 ? { maximumSignificantDigits: 2 } : {}) });
/** A sum's dollars: "≈ $21.40", "≈ $21.40 or more" for a lower bound; blank where nothing was priced. */
const estimate = (cost: CostSum) => (cost.dollars === undefined ? '' : `≈ ${dollars(cost.dollars)}${cost.atLeast ? ' or more' : ''}`);
const sentence = (words: string) => `${words[0]!.toUpperCase()}${words.slice(1)}.`;

/** Why requests have no price, each reason once: "no price known" where no matching rate (no row for the provider or model) is the only one, else what each was. */
function noPriceWords({ noRow, speedOrTier, other }: UnpricedBy): string {
  const why = [...(noRow ? [`${plural(noRow, 'request')} with no matching rate`] : []),
    ...speedOrTier.map(each => (each.requests === 1 ? `a ${each.saved} reply` : `${each.requests} ${each.saved} replies`)),
    ...(other ? [`${plural(other, 'request')} for another reason`] : [])];
  return noRow && why.length === 1 ? 'no price known' : `no price known for ${andList(why)}`;
}

/**
 * A sum as a row, a day of 7 days, and a tool say it: its estimate in bold, `about` (the other reasons it may be low, first)
 * and the one-hour reason on its hover; how many have no price, why on theirs (carrying `about` too when there is no estimate):
 * "2 unpriced", or with `requests` (a day of 7 days, where a bare count would read as sessions) "2 requests unpriced".
 */
function sumView(cost: CostSum, about: string[] = [], requests = false): [HTMLElement | null, HTMLElement | null] {
  const estimateTitle = [...about, ...(cost.oneHourLow ? [ONE_HOUR] : [])].join(' ');
  const unpricedTitle = [...(cost.dollars === undefined ? about : []), ...(cost.unpriced ? [sentence(noPriceWords(cost.unpricedBy))] : [])].join(' ');
  return [cost.dollars === undefined ? null : h('strong.sessions-estimate', estimateTitle ? { title: estimateTitle } : {}, estimate(cost)),
    cost.unpriced ? h('span.sessions-unpriced', { title: unpricedTitle }, `${requests ? plural(cost.unpriced, 'request') : cost.unpriced} unpriced`) : null];
}

/** Collision-free DOM id fragment for row keys and model ids so alias infoMark ids stay unique across rows and By model. */
const safeId = (text: string) => text.replace(/[^a-zA-Z0-9-]/g, char => `_${char.charCodeAt(0).toString(16)}_`);

/** Each model's price and tokens by kind, on the page's columns: in an opened row and in By model; its saved id as saved, any wider-rule alias behind an info mark. */
function modelLines(models: ModelCost[], prefix: string) {
  const counts = ({ tokens }: ModelCost) => [tokens.input, tokens.cacheRead, tokens.cacheWrite, tokens.output];
  return [h('div.sessions-line.sessions-line-head', {}, h('span.sessions-span', {}, 'Model'), h('span.sessions-line-cost', {}, 'Cost'),
    h('span.sessions-counts', {}, ...TOKEN_HEADS.map(head => h('span', {}, head)))),
  ...models.map(model => {
    const aliasId = model.cost.pricedAs.length ? `sessions-alias-${safeId(prefix)}-${safeId(model.model)}` : undefined;
    const aliasText = model.cost.pricedAs.length ? `Priced as ${andList(model.cost.pricedAs.map(as => as.as))}.` : '';
    return h('div.sessions-line', { 'data-model': model.model },
      h('span.sessions-span', aliasId ? { 'data-info-block': true } : {},
        h('span.sessions-model', aliasId ? { 'aria-describedby': infoCardId(aliasId) } : {}, model.model),
        aliasId ? infoMark(aliasId, model.model, aliasText) : null),
      h('span.sessions-line-cost', {}, [estimate(model.cost), model.cost.unpriced ? noPriceWords(model.cost.unpricedBy) : ''].filter(Boolean).join('; ')),
      h('span.sessions-counts', {}, ...counts(model).map((count, index) => h('span', { 'data-label': TOKEN_HEADS[index]!.toLowerCase() }, count.toLocaleString()))));
  })];
}

/** Notes whether a `<details>` was opened or closed, by its key, building/clearing a lazy body and updating wrapped separators. */
function noteToggle(key: string, event: Event, later?: () => Node) {
  const box = event.currentTarget as HTMLDetailsElement;
  if (box.open) {
    opened.add(key);
    if (later && box.childElementCount === 1) box.append(later());
    markWrapped(box);
  } else {
    opened.delete(key);
    if (later && box.childElementCount > 1) box.lastElementChild!.remove();
  }
}
/** A `<details>` kept open across redraws by `key`. */
const kept = (key: string, ...children: (Node | null)[]) => h('details', { open: opened.has(key), ontoggle: (event: Event) => noteToggle(key, event) }, ...children);
/**
 * A `<details>` kept open as `kept` is, whose body `later` is there only while it is open: built on a draw then and on its
 * opening, taken out on its closing.
 */
const keptLater = (key: string, summary: Node, later: () => Node) => h('details', { open: opened.has(key), ontoggle: (event: Event) => noteToggle(key, event, later) },
  summary, opened.has(key) ? later() : null);

/** Total nested agent sessions under `row`, derived recursively from `row.children`. */
const agentCount = (row: SessionRow): number => row.children.reduce((sum, child) => sum + 1 + agentCount(child), 0);

/**
 * One session's row: when, the tool (or "Agent" for a session another started), the project folder's name (with its nested
 * agent count) and its sum with its agents'; opened, its own models, Claude Code's own figure and why a figure is low, then
 * its agents' rows. `scope` keeps a row of a day of 7 days opened apart from the same session's row under another day.
 */
function sessionRow(row: SessionRow, agent = false, scope = ''): HTMLElement {
  const key = `${scope}${row.tool}\0${row.session}`;
  const agents = agentCount(row);
  const [first, last] = [row.first, row.last].map(at => clockTime(new Date(at).toISOString()));
  const notes = [row.reported === undefined ? null : `${toolNames[row.tool]}’s own figure: ${dollars(row.reported)}. Not in the totals.`,
    row.cost.oneHourLow ? ONE_HOUR : null];
  return h('li.sessions-row', { 'data-session': row.session, 'data-tool': row.tool }, kept(key,
    h('summary', {}, icon('chevron-right', 12, 'tone-faint sessions-chevron'),
      h('span.sessions-when', {}, first === last ? first : `${first}–${last}`),
      h('span.sessions-tool', {}, brandMark(row.tool, 14), h('span', {}, agent ? 'Agent' : toolNames[row.tool])),
      h('span.sessions-project', {}, row.project ? h('span.sessions-project-name', {}, row.project) : null,
        agents ? h('span.sessions-agents', {}, `+${plural(agents, 'agent')}`) : null),
      h('span.sessions-cost', {}, ...sumView(row.withChildren.cost))),
    h('div.sessions-body', {}, ...modelLines(row.models, key), ...notes.map(note => note && h('p.sessions-aside', {}, note)),
      row.children.length ? h('ul.sessions-children', {}, ...row.children.map(child => sessionRow(child, true, scope))) : null)));
}

/**
 * A day of 7 days: its name, how many sessions and its sum; opened, its rows, there only then. Today's is open the first time it
 * is drawn where it has `OPEN_TODAY_UP_TO` sessions or fewer, so that a busy today does not hide the week.
 */
function dayFold(day: PeriodDay, home: string): HTMLElement {
  const key = `${home}\0${day.period.start}`;
  if (!drawnDays.has(key) && dayName(day.period.start) === 'Today' && day.total.sessions <= OPEN_TODAY_UP_TO) opened.add(key);
  drawnDays.add(key);
  const rows = () => h('ul.sessions-rows', {}, ...day.rows.map(row => sessionRow(row, false, `${key}\0`)));
  const label = h('span.sessions-day-label', {}, h('span.sessions-day-name', {}, dayLineName(day.period.start)),
    h('span.sessions-day-count', {}, plural(day.total.sessions, 'session')));
  const summary = h('summary', {}, icon('chevron-right', 12, 'tone-faint sessions-chevron'), label, h('span.sessions-cost', {}, ...sumView(day.total.cost, [], true)));
  return h('li.sessions-day', { 'data-day': String(day.period.start) }, keptLater(key, summary, rows));
}

/** The line under the heading: each tool's sum (its sessions and whose prices on hover), the tools not read yet; or that there was none. */
function toolsLine(rows: DayRows | PeriodRows, day: string, present: HarnessId[]) {
  const notYet = present.filter(tool => !(SESSION_TOOLS as readonly HarnessId[]).includes(tool));
  const read = orList(rows.byTool.map(total => toolNames[total.tool]));
  const none = !rows.byTool.length ? readsSoFar
    : rows.byTool.some(total => total.unread) ? 'No sessions found.' : 'days' in rows ? `No ${read} sessions ${day}.` : `No sessions ${day} in ${read}.`;
  const tools = rows.byTool.map(total => {
    const names = [...new Set(total.cost.providers.map(each => providerNames[each.provider] ?? each.provider))];
    const about = [`${plural(total.sessions, 'session')}.`, ...(names.length ? [`At ${andList(names.map(name => `${name}’s`))} API prices.`] : []),
      ...(total.unread ? [unreadWords(total.tool)] : [])];
    return h('span.sessions-tool-total', { 'data-tool': total.tool, ...(total.sessions ? {} : { title: total.unread ? 'No sessions found.' : `No sessions ${day}.` }) },
      brandMark(total.tool, 14), h('span', {}, toolNames[total.tool]), ...(total.sessions ? sumView(total.cost, about) : []));
  });
  return h('p.sessions-tools.sessions-sep', { id: 'sessions-by-tool' }, ...(rows.total.sessions ? tools : [h('span', { id: 'sessions-none' }, none)]),
    notYet.length ? h('span', { id: 'sessions-not-read' }, `Not counted: ${andList(notYet.map(tool => toolNames[tool]))}`) : null);
}

/** One part of the reading's heading: its text, and an infoMark only when there is something to explain. */
function headPart(node: HTMLElement, id: string, label: string, about: string): HTMLElement {
  return h('span.sessions-head-part', { 'data-info-block': true }, node, about ? infoMark(id, label, about) : null);
}

/**
 * A reading: its dollars at API prices and unpriced count (each with an infoMark when it has something to explain), the tools'
 * line, what could not be read, the rows (or for 7 days a line a day with sessions, newest first), and By model folded.
 */
function readingView(rows: DayRows | PeriodRows, home: HomeView) {
  const { start } = rows.period;
  const name = dayName(start);
  const any = rows.total.sessions > 0;
  const heading = 'days' in rows ? `7 days, ${datesOf(rows.period)}` : name ? `${name}, ${dateOf(start)}` : dateOf(start);
  const when = 'days' in rows ? 'in the last 7 days' : name ? name.toLowerCase() : `on ${dateOf(start)}`;
  const prices = rows.ratesDates.length ? [`Prices as of ${andList(rows.ratesDates.map(priceDate))}.`] : [];
  const unread = rows.byTool.filter(each => each.unread).map(each => unreadWords(each.tool));
  const cost = rows.total.cost;
  const totalAbout = [...prices, ...unread, ...(cost.oneHourLow ? [ONE_HOUR] : [])].join(' ');
  const total = any && cost.dollars !== undefined
    ? headPart(h('strong.sessions-estimate', {}, `${estimate(cost)} at API prices`), 'sessions-total-info', 'API prices', totalAbout)
    : null;
  const unpricedAbout = cost.unpriced
    ? [...(cost.dollars === undefined ? [`${plural(rows.total.sessions, 'session')}.`, ...prices, ...unread] : []), sentence(noPriceWords(cost.unpricedBy))].join(' ')
    : '';
  const unpriced = any && cost.unpriced
    ? headPart(h('span.sessions-unpriced', {}, `${plural(cost.unpriced, 'request')} unpriced`), 'sessions-unpriced-info', 'Unpriced requests', unpricedAbout)
    : null;
  const ordered = 'days' in rows ? rows.days.length > 1 || rows.days.some(day => day.rows.length > 1) : rows.rows.length > 1;
  return [
    h('div.sessions-head.sessions-sep', {}, total, unpriced, h('h2.sessions-heading', { id: 'sessions-heading' }, heading)),
    toolsLine(rows, when, home.sync.present),
    ...unread.map(words => h('p.sessions-caption.sessions-unread', {}, words)),
    ordered ? h('p.sessions-order', {}, 'Latest activity first') : null,
    'days' in rows ? h('ul.sessions-days', { id: 'sessions-days' }, ...rows.days.map(day => dayFold(day, home.home)))
      : any ? h('ul.sessions-rows', {}, ...rows.rows.map(row => sessionRow(row))) : null,
    any ? h('div.sessions-by-model', { id: 'sessions-by-model' }, kept('by-model', h('summary', {}, icon('chevron-right', 12, 'tone-faint sessions-chevron'), 'By model'),
      ...modelLines(rows.byModel, 'by-model'))) : null,
  ];
}

/** Marks the last item before a wrapped flex line on Sessions so wrapped rows neither lead with nor dangle a separator dot. */
function markWrapped(root: ParentNode = document) {
  for (const box of root.querySelectorAll?.<HTMLElement>('.sessions-sep, .sessions-cost') ?? []) {
    if (!box.getClientRects().length) continue;
    const kids = [...box.children] as HTMLElement[];
    for (const kid of kids) kid.removeAttribute('data-line-end');
    for (let i = 0; i < kids.length - 1; i++) {
      const wrapped = () => kids[i + 1]!.getBoundingClientRect().top >= kids[i]!.getBoundingClientRect().bottom - 2;
      if (!wrapped()) continue;
      kids[i]!.setAttribute('data-line-end', box.classList.contains('sessions-sep') ? 'hide' : 'drop');
      if (!wrapped()) kids[i]!.setAttribute('data-line-end', 'hide');
    }
  }
}
afterLayout(() => markWrapped());

/** Turns keeping session costs on or off for the home on screen; ignores repeat clicks while saving and shows any refusal verbatim inline. */
async function changeKeeping(on: boolean): Promise<void> {
  const home = state.home?.home;
  if (!home || keepingBusy()) return;
  state.keepProblem = undefined;
  const problem = await switchSessionCosts(on).catch(error => saveFailure(String(error), ''));
  if (state.home?.home !== home) return;
  state.keepProblem = problem;
  if (problem) announce(problem);
  rerender();
}

/** Beside the period's choice: "Keep costs for a 7-day view" while off, "Collecting…" while a sweep runs, "Stop keeping" once kept, both sharing one info mark. */
function keepControl(home: HomeView): HTMLElement {
  const costs = home.sessionCosts;
  if (costs?.collecting) return h('span.sessions-collecting', { id: 'sessions-collecting', role: 'status' }, 'Collecting…');
  const on = !!costs?.on, label = on ? 'Stop keeping' : 'Keep costs for a 7-day view';
  return h('span.sessions-keep', { 'data-info-block': true },
    button({ variant: 'outline', label, id: on ? 'sessions-keep-stop' : 'sessions-keep-start', disabled: keepingBusy(), onclick: () => void changeKeeping(!on), attrs: { 'aria-describedby': infoCardId('sessions-keep-info') } }),
    infoMark('sessions-keep-info', label, `Adds a 7-day view here, keeping ${SESSION_COSTS_KEPT}`));
}

/** Verbatim refusal or settings save failure shown inline beneath the top bar. */
function keepResult(home: HomeView): HTMLElement | null {
  const text = state.keepProblem ?? home.sessionCosts?.refused;
  return text ? h('p.sessions-result', { id: 'sessions-keep-result', role: 'alert' }, icon('circle-alert', 14), h('span', {}, text)) : null;
}

/** The page: the period's choice and keeping control, any refusal, then its reading, "Reading…" until there is one, or one sentence where it could not be read. */
export function sessionsPage(home: HomeView) {
  const slot = state.sessions, rows = slot.state === 'failed' ? undefined : slot.data;
  const waiting = slot.state === 'failed' ? h('p.sessions-caption', { id: 'sessions-failed' }, 'Sessions could not be read. Refresh to try again.')
    : h('p.sessions-caption', { id: 'sessions-reading' }, choices[state.sessionsDay].reading);
  return h('div.page', {}, h('div.scroll.sessions-scroll', { id: 'sessions-scroll' },
    h('div.sessions-content', {}, h('div.sessions-bar', {}, dayChoice(home), keepControl(home)), keepResult(home), ...(rows ? readingView(rows, home) : [waiting]))));
}

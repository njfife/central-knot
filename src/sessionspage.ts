// The Sessions page (MAP.md, "Sessions"): one day's sessions, Today or Yesterday, read from the tools' own session history, with
// what their tokens would cost at each model's API price. The day is read when the page opens, when a day is chosen and on the
// header's Refresh (loadSessions → main.ts sessions:read → sessionday.ts readSessionPeriod, then sessionrow.ts sessionRows), and
// the answer is held in app.ts state.sessions (pagedata.ts: a reply a newer ask supersedes is dropped); nothing is kept. This
// module makes the day's two local midnights from the calendar (periodOf) and says the rows: every figure and sum is
// sessionrow.ts's, and the tools read are presence.ts SESSION_TOOLS. What a person needs is on the page; why a figure is low,
// whose prices they are and the price list's date are on hover (the native `title`). Not here: reading files, pricing, summing.
import { rerender, state } from './app.ts';
import { brandMark } from './brand.ts';
import { h, icon } from './dom.ts';
import { clockTime, plural } from './model.ts';
import { readPageData, resetPageData } from './pagedata.ts';
import { SESSION_TOOLS } from './presence.ts';
import { andList, orList, toolNames } from './words.ts';
import type { Period } from './sessionday.ts';
import type { CostSum, DayRows, ModelCost, SessionRow, UnpricedBy } from './sessionrow.ts';
import type { HarnessId, HomeView } from './types.ts';

export type SessionsDay = 'today' | 'yesterday';
/** The providers the two tools read can be priced under (rates.ts TOOL_PROVIDERS, and Codex's saved one), by name; another id is said as it is. */
const providerNames: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
/** The rows opened (by tool and session) and By model ('by-model'), kept across redraws as editparts.ts infoBox keeps its boxes; never stored. */
const opened = new Set<string>();
const ONE_HOUR = 'One-hour cache writes are priced at the shorter cache’s rate; they cost more.';
const TOKEN_HEADS = ['Input', 'Cached', 'Cache-written', 'Output'];

/** Local midnight `back` days before `now`'s day, from the calendar: a day is 23 or 25 hours when the clocks change, never 24 added. */
const midnight = (now: Date, back: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime();
/** The chosen day as the half-open period its reading asks for: its own midnight to the next, both from one reading of the clock. */
function periodOf(day: SessionsDay, now = new Date()): Period {
  const back = day === 'today' ? 0 : 1;
  return { start: midnight(now, back), end: midnight(now, back - 1) };
}
/** "Today" or "Yesterday" for a reading's day as the clock stands now, so a page left open past midnight stays true; else none. */
const dayName = (start: number, now = new Date()) => (start === midnight(now, 0) ? 'Today' : start === midnight(now, 1) ? 'Yesterday' : undefined);
/** Which tools Central Knot reads, said where none is here and on the hover of the tools it does not count. */
const readsSoFar = `So far Central Knot reads ${andList(SESSION_TOOLS.map(tool => `${toolNames[tool]}’s`))} sessions.`;
const unreadWords = (tool: HarnessId) => `Some of ${toolNames[tool]}’s session history could not be read.`;

/**
 * Reads the chosen day's rows into their slot: on opening the page and on Refresh (app.ts loadPageData), and on a press of a
 * day. Rows of another day (the one chosen, or Today after midnight) are let go first, so the page says "Reading…" meanwhile.
 */
export async function loadSessions(readId?: number) {
  const home = state.home;
  if (!home) return;
  const { start, end } = periodOf(state.sessionsDay);
  if (state.sessions.data && state.sessions.data.period.start !== start) resetPageData(state.sessions);
  const reading = readPageData(state.sessions, () => window.centralKnot.readSessions(home.home, start, end, readId ?? home.readId));
  rerender();
  if ((await reading) !== 'dropped') rerender();
}

/** Today | Yesterday, built as the Library's kind switch (matrix.ts kindSwitch): a press reads that day as it is now. */
function dayChoice() {
  const choice = (day: SessionsDay, label: string) => h(`button.kind-seg${state.sessionsDay === day ? '.kind-seg-on' : ''}`, {
    type: 'button', id: `sessions-day-${day}`, 'aria-pressed': String(state.sessionsDay === day), onclick: () => { state.sessionsDay = day; void loadSessions(); },
  }, h('span.kind-seg-label', {}, label));
  return h('div.kind-switch', { role: 'group', 'aria-label': 'Day' }, choice('today', 'Today'), choice('yesterday', 'Yesterday'));
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
 * A sum as a row, a tool and the day say it: its estimate in bold, `about` (the other reasons it may be low, first) and the
 * one-hour reason on its hover; how many have no price, why on theirs: "2 unpriced", or with `requests` (the day's heading,
 * where a bare count would read as sessions) "2 requests unpriced".
 */
function sumView(cost: CostSum, about: string[] = [], requests = false): [HTMLElement | null, HTMLElement | null] {
  const title = [...about, ...(cost.oneHourLow ? [ONE_HOUR] : [])].join(' ');
  return [cost.dollars === undefined ? null : h('strong.sessions-estimate', title ? { title } : {}, estimate(cost)),
    cost.unpriced ? h('span.sessions-unpriced', { title: sentence(noPriceWords(cost.unpricedBy)) }, `${requests ? plural(cost.unpriced, 'request') : cost.unpriced} unpriced`) : null];
}

/** Each model's price and tokens by kind, on the page's columns: in an opened row and in By model; its saved id as saved. */
function modelLines(models: ModelCost[]) {
  const counts = ({ tokens }: ModelCost) => [tokens.input, tokens.cacheRead, tokens.cacheWrite, tokens.output];
  return [h('div.sessions-line.sessions-line-head', {}, h('span.sessions-span', {}, 'Model'), h('span', {}, 'Cost'),
    h('span.sessions-counts', {}, ...TOKEN_HEADS.map(head => h('span', {}, head)))),
  ...models.map(model => h('div.sessions-line', { 'data-model': model.model },
    h('span.sessions-span', {}, h('span.sessions-model', {}, model.model), ...model.cost.pricedAs.map(as => h('span.sessions-as', {}, `priced as ${as.as}`))),
    h('span', {}, [estimate(model.cost), model.cost.unpriced ? noPriceWords(model.cost.unpricedBy) : ''].filter(Boolean).join('; ')),
    h('span.sessions-counts', {}, ...counts(model).map((count, index) => h('span', { 'data-label': TOKEN_HEADS[index]!.toLowerCase() }, count.toLocaleString())))))];
}

/** A `<details>` kept open across redraws by `key`. */
const kept = (key: string, ...children: (Node | null)[]) => h('details', { open: opened.has(key),
  ontoggle: (event: Event) => { if ((event.currentTarget as HTMLDetailsElement).open) opened.add(key); else opened.delete(key); } }, ...children);

/**
 * One session's row: when, the tool (or "Agent" for a session another started), the project folder's name and its sum with
 * its agents'; opened, its own models, Claude Code's own figure and why a figure is low, then its agents' rows.
 */
function sessionRow(row: SessionRow, agent = false): HTMLElement {
  const [first, last] = [row.first, row.last].map(at => clockTime(new Date(at).toISOString()));
  const notes = [row.reported === undefined ? null : `${toolNames[row.tool]}’s own figure for this session: ${dollars(row.reported)}. Not in the totals.`,
    row.cost.oneHourLow ? ONE_HOUR : null];
  return h('li.sessions-row', { 'data-session': row.session, 'data-tool': row.tool }, kept(`${row.tool}\0${row.session}`,
    h('summary', {}, icon('chevron-right', 12, 'tone-faint sessions-chevron'),
      h('span.sessions-when', {}, first === last ? first : `${first}–${last}`),
      h('span.sessions-tool', {}, brandMark(row.tool, 14), agent ? 'Agent' : toolNames[row.tool]),
      h('span.sessions-project', {}, row.project ?? ''),
      h('span.sessions-cost', {}, ...sumView(row.withChildren.cost))),
    h('div.sessions-body', {}, ...modelLines(row.models), ...notes.map(note => note && h('p.sessions-aside', {}, note)),
      row.children.length ? h('ul.sessions-children', {}, ...row.children.map(child => sessionRow(child, true))) : null)));
}

/** The line under the heading: each tool's sum (its sessions and whose prices on hover), the tools not read yet; or that there was none. */
function toolsLine(rows: DayRows, day: string, present: HarnessId[]) {
  const notYet = present.filter(tool => !(SESSION_TOOLS as readonly HarnessId[]).includes(tool));
  const none = !rows.byTool.length ? readsSoFar
    : rows.byTool.some(total => total.unread) ? 'No sessions found.' : `No sessions ${day} in ${orList(rows.byTool.map(total => toolNames[total.tool]))}.`;
  const tools = rows.byTool.map(total => {
    const names = [...new Set(total.cost.providers.map(each => providerNames[each.provider] ?? each.provider))];
    const about = [`${plural(total.sessions, 'session')}.`, ...(names.length ? [`At ${andList(names.map(name => `${name}’s`))} API prices.`] : []),
      ...(total.unread ? [unreadWords(total.tool)] : [])];
    return h('span.sessions-tool-total', { 'data-tool': total.tool, ...(total.sessions ? {} : { title: total.unread ? 'No sessions found.' : `No sessions ${day}.` }) },
      brandMark(total.tool, 14), toolNames[total.tool], ...(total.sessions ? sumView(total.cost, about) : []));
  });
  return h('p.sessions-tools.sessions-sep', { id: 'sessions-by-tool' }, ...(rows.rows.length ? tools : [h('span', { id: 'sessions-none' }, none)]),
    notYet.length ? h('span', { id: 'sessions-not-read', title: readsSoFar }, `Not counted: ${andList(notYet.map(tool => toolNames[tool]))}`) : null);
}

/** A day's reading: its dollars, date and unpriced count; the tools' line; what could not be read; the rows; By model, folded. */
function dayView(rows: DayRows, present: HarnessId[]) {
  const date = new Date(rows.period.start).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }), name = dayName(rows.period.start);
  const [year, month, dayOfMonth] = rows.ratesDate.split('-').map(Number);
  const prices = `Prices as of ${new Date(year!, month! - 1, dayOfMonth).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.`;
  const unread = rows.byTool.filter(each => each.unread).map(each => unreadWords(each.tool));
  const [total, unpriced] = rows.rows.length ? sumView(rows.total.cost, [prices, ...unread], true) : [null, null];
  return [
    h('div.sessions-head.sessions-sep', {}, total, unpriced, h('h2.sessions-heading', { id: 'sessions-heading' }, name ? `${name}, ${date}` : date)),
    rows.rows.length ? h('p.sessions-caption', {}, 'At API prices, not your plan’s.') : null,
    toolsLine(rows, name ? name.toLowerCase() : `on ${date}`, present),
    ...unread.map(words => h('p.sessions-caption.sessions-unread', {}, words)),
    rows.rows.length ? h('ul.sessions-rows', {}, ...rows.rows.map(row => sessionRow(row))) : null,
    rows.rows.length ? h('div.sessions-by-model', { id: 'sessions-by-model' }, kept('by-model', h('summary', {}, icon('chevron-right', 12, 'tone-faint sessions-chevron'), 'By model'),
      ...modelLines(rows.byModel))) : null,
  ];
}

/** The page: the day's choice, then its reading, "Reading…" until there is one, or one sentence where it could not be read. */
export function sessionsPage(home: HomeView) {
  const slot = state.sessions, rows = slot.state === 'failed' ? undefined : slot.data;
  const waiting = slot.state === 'failed' ? h('p.sessions-caption', { id: 'sessions-failed' }, 'Sessions could not be read. Refresh to try again.')
    : h('p.sessions-caption', { id: 'sessions-reading' }, `Reading ${state.sessionsDay === 'today' ? 'today’s' : 'yesterday’s'} sessions…`);
  return h('div.page', {}, h('div.scroll.sessions-scroll', { id: 'sessions-scroll' },
    h('div.sessions-content', {}, dayChoice(), ...(rows ? dayView(rows, home.sync.present) : [waiting]))));
}

// The Sessions page (MAP.md, "Sessions"): one day's sessions, Today or Yesterday, read from the tools' own session history, with
// what their tokens would cost at each model's API price. The day is read when the page opens, when a day is chosen and on the
// header's Refresh (loadSessions → main.ts sessions:read → sessionday.ts readSessionPeriod, then sessionrow.ts sessionRows), and
// the answer is held in app.ts state.sessions (pagedata.ts: a reply a newer ask supersedes is dropped); nothing is kept. This
// module makes the day's two local midnights from the calendar (periodOf) and says the rows: every figure and sum is
// sessionrow.ts's, and the tools read are presence.ts SESSION_TOOLS. Not here: reading files, pricing, summing.
import { rerender, state } from './app.ts';
import { brandMark } from './brand.ts';
import { eyebrow, h, icon } from './dom.ts';
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
/** The rows opened, by tool and session, kept across redraws as editparts.ts infoBox keeps its boxes; never stored. */
const opened = new Set<string>();

/** Local midnight `back` days before today's, from the calendar: a day is 23 or 25 hours when the clocks change, never 24 added. */
const midnight = (back: number) => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime(); };
/** The chosen day as the half-open period its reading asks for: its own midnight to the next. */
const periodOf = (day: SessionsDay): Period => (day === 'today' ? { start: midnight(0), end: midnight(-1) } : { start: midnight(1), end: midnight(0) });
/** "Today" or "Yesterday" for a reading's day as the clock stands now, so a page left open past midnight stays true; else none. */
const dayName = (start: number) => (start === midnight(0) ? 'Today' : start === midnight(1) ? 'Yesterday' : undefined);

/** Reads the chosen day's rows into their slot: on opening the page and on Refresh (app.ts loadPageData), and on a choice of day. */
export async function loadSessions(readId?: number) {
  const home = state.home;
  if (!home) return;
  const { start, end } = periodOf(state.sessionsDay);
  const reading = readPageData(state.sessions, () => window.centralKnot.readSessions(home.home, start, end, readId ?? home.readId));
  rerender();
  if ((await reading) !== 'dropped') rerender();
}

/** Today | Yesterday, built as the Library's kind switch (matrix.ts kindSwitch): a choice lets the other day's rows go and reads its own. */
function dayChoice() {
  const choice = (day: SessionsDay, label: string) => h(`button.kind-seg${state.sessionsDay === day ? '.kind-seg-on' : ''}`, {
    type: 'button', id: `sessions-day-${day}`, 'aria-pressed': String(state.sessionsDay === day),
    onclick: () => { if (state.sessionsDay === day) return; state.sessionsDay = day; resetPageData(state.sessions); void loadSessions(); },
  }, h('span.kind-seg-label', {}, label));
  return h('div.kind-switch', { role: 'group', 'aria-label': 'Day' }, choice('today', 'Today'), choice('yesterday', 'Yesterday'));
}

/** Dollars as money: cents, or two significant digits under a cent. */
const dollars = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', ...(amount < 0.01 ? { maximumSignificantDigits: 2 } : {}) });
/** A sum's dollars, said the same on a row, a total and the day: "≈ $21.40", or "≈ $21.40 or more" for a lower bound. */
const estimate = (cost: CostSum & { dollars: number }) => `≈ ${dollars(cost.dollars)}${cost.atLeast ? ' or more' : ''}`;
const priced = (cost: CostSum): cost is CostSum & { dollars: number } => cost.dollars !== undefined;

/** A sum as a row, a tool's or the day's total says it: its estimate and what it leaves out; "no price known" where nothing was priced. */
function sumWords(cost: CostSum): string {
  if (!priced(cost)) return 'no price known';
  return `${estimate(cost)}${cost.unpriced ? `, without ${plural(cost.unpriced, 'request that has', 'requests that have')} no known price.` : ''}`;
}

/** Why a model's requests have no price: one sentence for a model the list lacks or any other reason; a speed or tier with no rate named as saved. */
function noPriceWords(by: UnpricedBy): string[] {
  const refused = by.speedOrTier.map(each => (each.requests === 1 ? `a ${each.saved} reply` : `${each.requests} ${each.saved} replies`));
  return [...(by.noRow || by.other ? ['no price known'] : []), ...(refused.length ? [`no price known for ${andList(refused)}`] : [])];
}

/** Each model's tokens by kind and its price, in an opened row and in the day's totals by model; its saved id as saved. */
function modelsTable(models: ModelCost[]) {
  const counts = ({ tokens }: ModelCost) => [tokens.input, tokens.cacheRead, tokens.cacheWrite, tokens.output];
  return h('table.session-models', {},
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Model'), ...['Input', 'Cached', 'Cache-written', 'Output'].map(head => h('th.num', { scope: 'col' }, head)), h('th', { scope: 'col' }, 'Cost'))),
    h('tbody', {}, ...models.map(model => h('tr', {},
      h('td', {}, h('span.session-model', {}, model.model), ...model.cost.pricedAs.map(as => h('span.session-as', {}, `priced as ${as.as}`))),
      ...counts(model).map(count => h('td.num', {}, count.toLocaleString())),
      h('td', {}, [...(priced(model.cost) ? [estimate(model.cost)] : []), ...(model.cost.unpriced ? noPriceWords(model.cost.unpricedBy) : [])].join('; '))))));
}

/** One session's row: when, the tool, the project folder's name, its models and its sum; opened, its models and notes; its children set in under it. */
function sessionRow(row: SessionRow): HTMLElement {
  const key = `${row.tool}\0${row.session}`, [first, last] = [row.first, row.last].map(at => clockTime(new Date(at).toISOString()));
  const notes = [row.reported === undefined ? null : `${toolNames[row.tool]}’s own figure for this session: ${dollars(row.reported)}. Not in the totals.`,
    row.cost.atLeast ? 'One-hour cache writes are priced at the shorter cache’s rate; they cost more.' : null];
  return h('li.session', { 'data-session': row.session, 'data-tool': row.tool },
    h('details', { open: opened.has(key), ontoggle: (event: Event) => { if ((event.currentTarget as HTMLDetailsElement).open) opened.add(key); else opened.delete(key); } },
      h('summary', {}, icon('chevron-right', 12, 'tone-faint session-chevron'),
        h('span.session-cell.session-when', {}, first === last ? first : `${first}–${last}`),
        h('span.session-cell.session-tool', {}, toolNames[row.tool]),
        h('span.session-cell.session-project', {}, row.project ?? ''),
        h('span.session-cell.session-named', {}, row.models.map(model => model.model).join(', ')),
        h('span.session-cell.session-cost', {}, sumWords(row.cost))),
      h('div.session-body', {}, modelsTable(row.models), ...notes.map(note => note && h('p.session-note', {}, note)))),
    row.children.length ? h('ul.session-children', {}, ...row.children.map(sessionRow)) : null);
}

/** Each tool's line under the rows: its sessions, its sum and whose API prices they are; or that it had none. */
function toolTotals(rows: DayRows, day: string) {
  return h('ul.sessions-by-tool', { id: 'sessions-by-tool' }, ...rows.byTool.map(total => {
    const names = [...new Set(total.cost.providers.map(each => providerNames[each.provider] ?? each.provider))];
    return h('li', { 'data-tool': total.tool }, h('span.sessions-tool', {}, brandMark(total.tool, 14), toolNames[total.tool]),
      h('span', {}, total.sessions ? plural(total.sessions, 'session') : `No sessions ${day}.`),
      total.sessions ? h('span', {}, sumWords(total.cost)) : null,
      names.length ? h('span', {}, `At ${andList(names.map(name => `${name}’s`))} API prices.`) : null);
  }));
}

/** A day's reading: its heading and total, the caption, what is not read, the rows, and the totals by tool and model. */
function dayView(rows: DayRows, present: HarnessId[]) {
  const date = new Date(rows.period.start).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }), name = dayName(rows.period.start);
  const day = name ? name.toLowerCase() : `on ${date}`, [year, month, dayOfMonth] = rows.ratesDate.split('-').map(Number);
  const notYet = present.filter(tool => !(SESSION_TOOLS as readonly HarnessId[]).includes(tool));
  const none = rows.byTool.length ? `No sessions ${day} in ${orList(rows.byTool.map(total => toolNames[total.tool]))}.`
    : `So far Central Knot reads ${andList(SESSION_TOOLS.map(tool => `${toolNames[tool]}’s`))} sessions.`;
  return [
    h('div.sessions-head', {}, h('h2.sessions-heading', { id: 'sessions-heading' }, name ? `${name}, ${date}` : date),
      rows.rows.length ? h('span.sessions-total', { id: 'sessions-total' }, sumWords(rows.total.cost)) : null),
    h('p.sessions-caption', {}, 'What these tokens cost at each model’s API price. On a subscription you pay your plan’s price, not this.'),
    h('p.sessions-caption', {}, `Prices as of ${new Date(year!, month! - 1, dayOfMonth).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.`),
    notYet.length ? h('p.sessions-line', { id: 'sessions-not-read' }, `Not read yet: ${andList(notYet.map(tool => toolNames[tool]))}.`) : null,
    ...rows.byTool.filter(total => total.unread).map(total => h('p.sessions-line.sessions-unread', { id: `sessions-unread-${total.tool}` },
      `Some of ${toolNames[total.tool]}’s session files could not be read; what they hold is not here.`)),
    rows.rows.length ? h('ul.sessions-rows', {}, ...rows.rows.map(sessionRow)) : h('p.sessions-line', { id: 'sessions-none' }, none),
    ...(rows.rows.length ? [eyebrow('By tool'), toolTotals(rows, day), eyebrow('By model'), h('div', { id: 'sessions-by-model' }, modelsTable(rows.byModel))] : []),
  ];
}

/** The page: the day's choice, then its reading, "Reading…" until there is one, or one sentence where it could not be read. */
export function sessionsPage(home: HomeView) {
  const slot = state.sessions, rows = slot.state === 'failed' ? undefined : slot.data;
  const waiting = slot.state === 'failed' ? h('p.sessions-line', { id: 'sessions-failed' }, 'Sessions could not be read. Refresh to try again.')
    : h('p.sessions-line', { id: 'sessions-reading' }, `Reading ${state.sessionsDay === 'today' ? 'today’s' : 'yesterday’s'} sessions…`);
  return h('div.page', {}, h('div.scroll.sessions-scroll', { id: 'sessions-scroll' }, dayChoice(), ...(rows ? dayView(rows, home.sync.present) : [waiting]),
    h('p.sessions-foot', { id: 'sessions-foot' }, 'Read from the tools’ own session history each time this page opens. Nothing is kept.')));
}

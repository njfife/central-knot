// Memory's ticks, its top line (where ticked memories can go), the review before a send and its result. Ticks are kept by
// file path in the order they were made; they stay until Clear, and go on a home switch or when a read no longer finds the file.
import { announce, busy, loadMemory, rerender, savingOff, shownPath, state } from './app.ts';
import { groupBy, nearDay, plural } from './model.ts';
import { andList, lineCount, toolNames } from './words.ts';
import { button, checkbox, closeButton, h, icon, lockAttrs } from './dom.ts';
import type { MemoryNote, MemorySendResult, MemorySent, MemoryTool, MemoryView } from './types.ts';

/** A memory that can be ticked: a Claude Code memory (with its project's label) or Codex's own summary. */
interface Pickable { path: string; title: string; text: string; hash: string; label?: string; sent?: MemorySent[]; summary?: true }

const ticked = new Set<string>();
let reviewing: MemoryTool | undefined;

/** Ticks and an open review belong to the home they were made in. */
export const forgetMemoryPicks = () => { ticked.clear(); reviewing = undefined; };

function pickables(view: MemoryView): Map<string, Pickable> {
  const notes = (view.claude ?? []).flatMap(project => project.notes.filter(note => !note.unreadable).map(note => ({ ...note, label: project.label })));
  const summary = view.codex?.summary;
  return new Map<string, Pickable>([...notes.map(note => [note.path, note] as const),
    ...(summary ? [[summary.path, { path: summary.path, title: 'Codex’s memory summary', text: summary.text, hash: '', summary: true }] as const] : [])]);
}

/** What is ticked, in the order it was ticked; a tick whose file this read no longer finds is dropped. */
function picked(view: MemoryView): Pickable[] {
  const all = pickables(view);
  for (const path of ticked) if (!all.has(path)) ticked.delete(path);
  return [...ticked].map(path => all.get(path)!);
}

const lines = (text: string) => lineCount(text.trim());

/** A tick box for one memory row (an unreadable row gets none). */
export const tickBox = (note: Pick<MemoryNote, 'path' | 'title'>, id: string) => h('span.memory-tick', {}, checkbox({ id, checked: ticked.has(note.path), name: `Tick ${note.title}`, disabled: !!state.busy,
  onchange: on => { if (on) ticked.add(note.path); else ticked.delete(note.path); rerender(); } }));

/** "today", "yesterday", else "on Nov 10" (with the year when it isn't this one). */
const onDay = (iso: string) => nearDay(iso) ?? `on ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}`;

/** "Sent to Codex today." and, when the memory changed afterwards, "Claude Code has changed it since." */
export function sentWords(sent: MemorySent[]): string {
  const days = [...groupBy(sent, entry => onDay(entry.at))].map(([day, entries]) => `Sent to ${andList(entries.map(entry => toolNames[entry.to]))} ${day}.`);
  return [...days, sent.some(entry => entry.changed) ? 'Claude Code has changed it since.' : ''].filter(Boolean).join(' ');
}

// ---------- Routes ----------

/** Where a tool's button puts what is ticked: into its own memory, or (a later step) its instruction file. */
interface Route { tool: MemoryTool; group: 'memory' | 'instructions' }
const groupNames: Record<Route['group'], string> = { memory: 'Memory:', instructions: 'Instructions:' };

/** The routes built so far: Codex's memory, where Codex is in this home. */
const routes = (view: MemoryView): Route[] => (view.codex ? [{ tool: 'codex-cli', group: 'memory' }] : []);

/** The muted sentence under the top line: what each group does with it. */
function routesSentence(all: Route[]): string {
  const memory = all.filter(route => route.group === 'memory').map(route => toolNames[route.tool]);
  return memory.length ? `${andList(memory)} ${memory.length === 1 ? 'keeps it in its' : 'keep it in their'} own memory.` : '';
}

/** Why a route's button is greyed (beside it), when there is a reason to say; nothing ticked greys it without one. */
function whyNot(route: Route, view: MemoryView, picks: Pickable[]): string | undefined {
  if (savingOff()) return 'Saving is off in this home.';
  if (route.tool === 'codex-cli' && !view.codex?.on) return 'Codex’s memory is off on this computer.';
  if (picks.length && picks.every(pick => pick.summary)) return 'Codex already has this.';
  return undefined;
}

const open = (tool: MemoryTool) => {
  reviewing = tool;
  rerender();
  document.getElementById('memory-review-send')?.focus();
};
const close = () => {
  const tool = reviewing;
  reviewing = undefined;
  rerender();
  document.getElementById(`memory-send-${tool}`)?.focus();
};

// In the review, Esc closes it, as Cancel does.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || state.page !== 'memory' || !reviewing || state.busy) return;
  event.preventDefault();
  close();
});

/** The top line, always in view: where ticked memories can go, how much is ticked, and Clear. Nothing when there is nowhere to send. */
export function sendLine(view: MemoryView): HTMLElement | null {
  const all = routes(view);
  if (!all.length) return null;
  const picks = picked(view);
  const groups = [...groupBy(all, route => route.group)];
  const reasons = all.map(route => whyNot(route, view, picks)).filter((why): why is string => !!why);
  // A review whose button would now be greyed has nothing left to send: it closes.
  if (reviewing && (!picks.length || all.some(route => route.tool === reviewing && whyNot(route, view, picks)))) reviewing = undefined;
  return h('div.memory-send', { id: 'memory-send', role: 'group', 'aria-label': 'Send ticked memories' },
    h('div.memory-send-line', {},
      h('span.memory-send-lead', {}, 'Tick what your other tools should know, then send it to'),
      groups.map(([group, members]) => h('span.memory-send-group', {}, groups.length > 1 ? h('strong', {}, groupNames[group]) : null,
        members.map(route => {
          const why = whyNot(route, view, picks);
          return button({ variant: reviewing === route.tool ? 'secondary' : 'outline', size: 'small', label: toolNames[route.tool], id: `memory-send-${route.tool}`,
            disabled: !!state.busy || !picks.length || !!why, attrs: { ...lockAttrs(why), 'aria-expanded': String(reviewing === route.tool) },
            onclick: () => (reviewing === route.tool ? close() : open(route.tool)) });
        }))),
      picks.length ? h('span.memory-ticked', { id: 'memory-ticked' }, `${picks.length} ticked · ${plural(picks.reduce((sum, pick) => sum + lines(pick.text), 0), 'line')}`,
        button({ variant: 'link', size: 'micro', label: 'Clear', id: 'memory-clear', disabled: !!state.busy, onclick: () => { ticked.clear(); reviewing = undefined; rerender(); document.querySelector<HTMLElement>('#memory-scroll input')?.focus(); } })) : null,
      reasons.length ? h('span.ins-locked', { id: 'memory-send-why' }, reasons.join(' ')) : null),
    h('p.memory-send-note', {}, routesSentence(all)));
}

// ---------- Review and result ----------

/** The review a route's button opens, under the top line: what goes where, and that it can't be undone from here. */
export function sendReview(view: MemoryView): HTMLElement | null {
  if (reviewing !== 'codex-cli' || !view.codex) return null;
  const picks = picked(view);
  const going = picks.filter(pick => !pick.summary);
  const folder = `${view.codex.folder}/extensions/ad_hoc/notes`;
  const words = plural(going.length, 'memory', 'memories');
  return h('section.card.memory-review', { id: 'memory-review', 'aria-labelledby': 'memory-review-title' },
    h('h2.memory-review-title', { id: 'memory-review-title' }, `Send ${words} to Codex’s memory`),
    h('p.base-explain', {}, 'Each one goes in as a note in ', h('code.memory-path', { title: folder }, shownPath(folder)),
      '. Codex takes notes in by itself the next time it updates its memory, which can be hours or days after you next use it, and rewrites them in its own words. This can’t be undone from here: to take one back, tell Codex to forget it.'),
    h('ul.memory-review-list', {}, going.map(pick => {
      const last = pick.sent?.filter(entry => entry.to === 'codex-cli') ?? [];
      return h('li', {}, h('strong.memory-title', {}, pick.title), h('span.memory-what', {}, [pick.label, plural(lines(pick.text), 'line'), last.length ? sentWords(last).replace(/\.$/, '') : ''].filter(Boolean).join(' · ')));
    })),
    picks.length > going.length ? h('p.ins-note', {}, icon('info', 13, 'tone-muted'), h('span', {}, 'Not sent: Codex’s memory summary. Codex already has it.')) : null,
    h('div.ins-actions', {},
      button({ variant: 'primary', size: 'small', label: 'Send to Codex', id: 'memory-review-send', disabled: !!state.busy || !going.length || savingOff(), onclick: () => void send('codex-cli', going) }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'memory-review-cancel', disabled: !!state.busy, onclick: close })));
}

/** A send's result in words: how many went, and each one that didn't with why. */
export function resultWords(result: MemorySendResult, tool: MemoryTool): string {
  if (result.stopped) return result.stopped;
  const name = toolNames[tool];
  const sent = result.sent.length;
  const done = !result.failed.length
    ? `Sent ${plural(sent, 'memory', 'memories')} to ${name}. ${name} takes ${sent === 1 ? 'it' : 'them'} in the next time it updates its memory, in its own words.`
    : `${sent ? `Sent ${sent} of ${sent + result.failed.length} to ${name}.` : `Nothing was sent to ${name}.`} Not sent: ${result.failed.map(entry => `“${entry.title}”: ${entry.why}`).join(' ')}`;
  return result.unrecorded ? `${done} The notes were written, but Central Knot could not note that they were sent: ${result.unrecorded}` : done;
}

const send = async (tool: MemoryTool, picks: Pickable[]) => {
  await busy(`Writing notes for ${toolNames[tool]}…`, async () => {
    const result = await window.centralKnot.sendMemory(tool, picks.map(({ path, hash }) => ({ path, hash })), state.home!.home);
    reviewing = undefined;
    const text = resultWords(result, tool);
    state.outcome = { page: 'memory', text, warn: !!(result.stopped || result.failed.length || result.unrecorded) };
    announce(text, true);
    await loadMemory();
  });
  document.getElementById(`memory-send-${tool}`)?.focus();
};

/** The last send's result, in the app's band, with no Undo: a note can't be taken back from here. */
export function memoryResult(): HTMLElement | null {
  const outcome = state.outcome;
  if (outcome?.page !== 'memory') return null;
  return h('div.band.band-done', { role: 'status', 'data-outcome': '', id: 'memory-result' }, icon(outcome.warn ? 'triangle-alert' : 'check', 14, outcome.warn ? 'tone-warning' : 'tone-success'),
    h('span.band-text', {}, outcome.text), closeButton(() => { state.outcome = undefined; rerender(); }, { id: 'memory-result-dismiss' }));
}

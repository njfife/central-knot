import { closePanel, setDontShare, setToolSelected, shownPath, startSharing, state, undoLast } from './app.ts';
import { button, checkbox, eyebrow, h, icon, pathText, section } from './dom.ts';
import { fullToolName, outcomeOf, planGroups, planSummary, plural, toolName, skillCount } from './model.ts';
import { disclosure, statusGlyph } from './pages.ts';
import type { HomeView, PlanItem, Preview } from './types.ts';

function notice(tone: 'danger' | 'warning' | 'info', title: string, body: string, alert = false) {
  return h(`div.notice.notice-${tone}`, alert ? { role: 'alert' } : {},
    icon(tone === 'warning' ? 'lock' : 'circle-alert', 16, `tone-${tone}`),
    h('div', {}, h('strong', {}, title), h('p', {}, body)));
}

function toolTicks(home: HomeView) {
  return section('Share between', h('div.ticks', {}, home.snapshots.map(snapshot => checkbox({
    id: `tick-${snapshot.harness}`,
    checked: state.selected.includes(snapshot.harness),
    disabled: !!state.busy,
    onchange: on => setToolSelected(snapshot.harness, on),
  }, fullToolName(snapshot), h('span.muted', {}, ` · ${plural(skillCount(snapshot), 'skill')}${home.mode === 'actual' ? ` · ${snapshot.detection}` : ''}`)))));
}

function planPaths(item: PlanItem) {
  const line = (label: string, directory: string) => h('div.plan-path', {}, h('span.plan-path-label', {}, label), pathText(shownPath(directory), directory));
  return h('div.plan-paths', {},
    item.copies.map(copy => line(`Now, ${toolName(copy.harness)}`, copy.directory)),
    item.targets.map(target => line(`${target.skipped ? 'Skipped' : 'Will write'}, ${toolName(target.harness)}`, target.directory)));
}

function diffBlock(id: string, text: string) {
  return h('pre.content.diff.mono', { tabindex: '0', id, 'aria-label': 'Difference between copies' },
    text.split('\n').map(line => h(`span.diff-line${line.startsWith('+') ? '.diff-add' : line.startsWith('-') ? '.diff-del' : ''}`, {}, `${line}\n`)));
}

function planCard(item: PlanItem, preview: Preview) {
  const allowed = preview.access.allowed;
  const limits = item.targets.flatMap(target => [...target.limits, ...(target.note ? [target.note] : [])]);
  const canExclude = !item.locked && allowed && !item.undoable && preview.gate.state !== 'stopped';
  const canUndo = item.undoable && allowed && preview.gate.state === 'ready';
  return h('article.card.plan-card', { 'data-key': item.key, 'data-state': item.state },
    h('div.plan-name', {},
      h('h4', {}, item.name),
      item.locked && h('span.plan-lock', { title: 'Locked' }, icon('lock', 14, 'tone-muted'))),
    h('p.plan-reason', {}, item.reason),
    limits.length > 0 && h('div.limits', {}, h('p.limits-title', {}, 'Known limits'), h('ul.plain-list', {}, limits.map(limit => h('li', {}, limit)))),
    planPaths(item),
    item.diff && disclosure(`diff-${item.key}`, 'Difference between copies', () => diffBlock(`diff-text-${item.key}`, item.diff!), true),
    (canExclude || canUndo) && h('div.plan-actions', {},
      canExclude && checkbox({ id: `exclude-${item.key}`, checked: state.dontShare.includes(item.key), disabled: !!state.busy, onchange: on => setDontShare(item.key, on) }, 'Don’t share'),
      canUndo && button({ variant: 'ghost', size: 'micro', icon: 'undo-2', label: 'Undo', name: `Undo ${item.name}`, id: `undo-${item.key}`, disabled: !!state.busy, onclick: () => void undoLast(item.name) })));
}

const LONG_GROUP = 5;

function planGroup(status: string, items: PlanItem[], preview: Preview) {
  const cards = () => h('div.stack', {}, items.map(item => planCard(item, preview)));
  // Items that need nothing done stay folded once there are many of them.
  const quiet = items.every(item => item.state === 'identical' || item.state === 'already-shared' || item.state === 'dont-share');
  return h('section.section', {},
    h('h3.eyebrow.group-title', {}, statusGlyph(status), status, h('span.eyebrow-count', {}, String(items.length))),
    quiet && items.length > LONG_GROUP ? disclosure(`group-${status}`, `Show ${plural(items.length, 'skill')}`, cards) : cards());
}

function results() {
  if (!state.results.length && !state.stopped) return null;
  return h('section.section', {}, eyebrow('What happened'),
    state.stopped && notice('danger', 'Start stopped', state.stopped),
    state.results.length > 0 && h('ul.results', { 'aria-label': 'What happened' }, state.results.map(result => {
      const outcome = outcomeOf(result.outcome);
      return h('li.card.result', { 'data-outcome': result.outcome },
        h('div.result-head', {},
          h('strong', {}, result.item),
          result.harness && h('span.muted', {}, toolName(result.harness)),
          h('span.result-word', {}, icon(outcome.glyph, 14, `tone-${outcome.tone}`), outcome.word)),
        h('p.muted', {}, result.message));
    })));
}

function disclosures(preview: Preview) {
  if (!preview.disclosures.length) return null;
  return section('Who else reads these folders', h('div.stack.stack-tight', {}, preview.disclosures.map(entry => h('div.reader', {},
    h('p', {}, `Writing for ${entry.name} goes to`),
    pathText(shownPath(entry.writesTo), entry.writesTo),
    h('p.muted', {}, `${entry.alsoReadBy.join(', ')} also read this folder.`)))));
}

export function sharePanel() {
  const { home, preview } = state;
  if (!home || !preview) return [];
  const gate = preview.gate;
  const groups = planGroups(preview.items);
  // The notice above carries the full reason when Start is held, so the footer stays one line.
  const message = state.busy ?? (gate.state === 'stopped' ? 'Start is stopped.' : !preview.access.allowed ? 'Start is off here.' : gate.state === 'needs-resume' ? 'Start will resume the record.' : preview.access.reason);
  const blocked = !preview.access.allowed || gate.state === 'stopped' || !preview.items.length;
  const closeLabel = state.results.length || state.stopped ? 'Close' : 'Cancel';
  return [
    h('div.scroll.panel-body', { id: 'panel-body', tabindex: '-1' },
      h('div.panel-opening', {},
        h('p', {}, preview.items.length ? planSummary(preview.items) : 'Nothing to plan yet'),
        h('p.muted', {}, 'Start copies what is missing. Nothing changes before you press it.')),
      gate.state === 'stopped' && notice('danger', 'Start is stopped', gate.reason, true),
      !preview.access.allowed && notice('warning', 'Start is off here', preview.access.reason),
      gate.state === 'needs-resume' && notice('info', 'Resume needed', gate.reason),
      results(),
      toolTicks(home),
      groups.length
        ? groups.map(group => planGroup(group.status, group.items, preview))
        : h('p.muted', {}, state.selected.length ? 'The selected tools have no standalone skills yet.' : 'Pick at least one tool above.'),
      disclosures(preview)),
    h('footer.panel-footer', {},
      h('p.panel-message', { id: 'start-note', title: message }, message),
      h('div.panel-actions', {},
        button({ variant: 'ghost', label: closeLabel, id: 'panel-cancel', onclick: closePanel }),
        h('div.panel-actions-end', {},
          preview.canUndo && preview.access.allowed && gate.state === 'ready' && button({ label: 'Undo the last Start', id: 'undo-all', disabled: !!state.busy, onclick: () => void undoLast() }),
          button({ variant: 'primary', label: gate.state === 'needs-resume' ? 'Resume and Start' : 'Start', id: 'start', disabled: blocked || !!state.busy, onclick: () => void startSharing() })))),
  ];
}

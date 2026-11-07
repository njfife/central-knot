import { announce, closePanel, disclosureOpen, loadHome, openPanel, readAgain, rerender, selectItem, shownPath, showPage, state } from './app.ts';
import { button, emptyState, h, hiddenText, icon, middle, pathText, section } from './dom.ts';
import { buildRows, copiesIn, fullToolName, lookOf, matches, plural, toolMonogram, toolName, type Row } from './model.ts';
import type { HarnessId, HomeView, Preview, Snapshot } from './types.ts';

export const toolIds = (home: HomeView) => home.snapshots.map(snapshot => snapshot.harness);

export function statusGlyph(status: string, size = 14) {
  const look = lookOf(status);
  return icon(look.glyph, size, `tone-${look.tone}`);
}

export function statusText(status: string) {
  return h('span.status-text', {}, statusGlyph(status), h('span.status-word', {}, status));
}

const countText = (shown: number, total: number) => (shown === total ? plural(total, 'skill') : `${shown} of ${plural(total, 'skill')}`);

/** The find field keeps its node while typing, so only the list below it is rebuilt. */
function findField(label: string, onChange: () => void) {
  const input = h('input.find-input', {
    id: 'find', type: 'text', placeholder: label, 'aria-label': label, value: state.find, spellcheck: 'false',
    oninput: () => { state.find = (input as HTMLInputElement).value; sync(); onChange(); },
  });
  const hint = h('kbd.key-hint', { 'aria-hidden': 'true', title: 'Press / to find' }, '/');
  const clear = button({
    variant: 'ghost', size: 'micro', icon: 'x', name: 'Clear find', id: 'find-clear',
    onclick: () => { (input as HTMLInputElement).value = ''; state.find = ''; sync(); onChange(); input.focus(); },
  });
  const sync = () => { hint.hidden = !!state.find; clear.hidden = !state.find; };
  sync();
  return h('div.find', {}, icon('search', 16, 'find-glyph'), input, hint, clear);
}

const clearFindAction = () => button({ label: 'Clear find', id: 'clear-find-action', onclick: () => { state.find = ''; rerender(); document.getElementById('find')?.focus(); } });

// ---------- Overview ----------

function noticeBand(home: HomeView, preview: Preview) {
  if (preview.gate.state === 'stopped') {
    return h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('strong.band-title', {}, 'Start is stopped.'), h('span.band-text', { title: preview.gate.reason }, preview.gate.reason));
  }
  const problems = home.snapshots.filter(snapshot => snapshot.discovery !== 'missing').flatMap(snapshot => snapshot.issues);
  if (!problems.length) return null;
  return h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
    h('strong.band-title', {}, `${plural(problems.length, 'read problem')}.`),
    h('span.band-text', {}, 'Those skills are left out of the list below.'),
    button({ variant: 'link', size: 'micro', label: 'See Tools', id: 'band-tools', onclick: () => showPage('tools') }));
}

function matrixRow(row: Row, tools: HarnessId[]) {
  const missing = tools.filter(tool => !copiesIn(row, tool).length).length;
  const open = () => openPanel('item', row.key);
  const present = tools.length - missing;
  return h(`div.mx-row.mx-item${state.panel === 'item' && state.item === row.key ? '.selected' : ''}`, { role: 'row', onclick: open, 'data-key': row.key },
    h('div.mx-name', { role: 'cell' },
      icon('wand-sparkles', 16, 'tone-muted'),
      h('button.row-button', { type: 'button', id: `row-${row.key}`, 'aria-pressed': String(state.panel === 'item' && state.item === row.key), onclick: (event: Event) => { event.stopPropagation(); open(); } }, middle(row.name)),
      row.plan?.state === 'collision' && h('span.badge.badge-info', { title: 'Copies differ' }, icon('diff', 12), hiddenText('Copies differ'))),
    h('div.mx-status', { role: 'cell' }, statusText(row.status)),
    h('div.mx-found', { role: 'cell', title: `In ${present} of ${tools.length} tools` }, h('span', { 'aria-hidden': 'true' }, `${present}/${tools.length}`), hiddenText(`In ${present} of ${tools.length} tools`)),
    tools.map(tool => {
      const count = copiesIn(row, tool).length;
      const has = count > 0;
      const said = has ? `${toolName(tool)} has it${count > 1 ? `, ${count} copies` : ''}` : `${toolName(tool)} does not have it`;
      return h('div.mx-cell', { role: 'cell', title: said, 'data-col': tool, 'data-tool': tool, 'data-present': String(has), 'data-mono': toolMonogram(tool) },
        icon(has ? 'circle-small' : 'minus', 16, has ? 'glyph-present' : 'tone-faint'),
        count > 1 && h('span.copy-count', { 'aria-hidden': 'true' }, String(count)),
        hiddenText(said));
    }),
    missing > 0 && h('div.mx-missing', { 'aria-hidden': 'true' }, `Not in ${plural(missing, 'tool')}`),
    h('div.mx-fill', { 'aria-hidden': 'true' }));
}

function matrixHead(tools: HarnessId[]) {
  return h('div.mx-head', { role: 'rowgroup' }, h('div.mx-row', { role: 'row' },
    h('div.mx-name-head', { role: 'columnheader' }, 'Name'),
    h('div.mx-status-head', { role: 'columnheader' }, 'Status'),
    h('div.mx-col-head', { role: 'columnheader' }, 'Found in'),
    tools.map(tool => h('div.mx-col-head', { role: 'columnheader', 'data-col': tool }, toolName(tool))),
    h('div.mx-fill', { 'aria-hidden': 'true' })));
}

function matrixBody(rows: Row[], tools: HarnessId[]) {
  const shown = rows.filter(row => matches(row, state.find));
  if (!shown.length) {
    return rows.length
      ? emptyState('search-x', `Nothing matches “${state.find}”`, undefined, clearFindAction())
      : emptyState('wand-sparkles', 'No skills here yet', 'Neither tool has a user-wide skill in this home. Choose another home at the bottom left, or read this one again.', button({ icon: 'refresh-cw', label: 'Read again', id: 'empty-read', disabled: !!state.busy, onclick: () => void readAgain() }));
  }
  return h('div.mx', { role: 'table', 'aria-label': 'Skills across tools' },
    matrixHead(tools),
    h('div', { role: 'rowgroup' },
      h('div.mx-section', { role: 'row' }, h('div', { role: 'cell' }, h('strong', {}, 'Skills'), h('span.mx-section-count', {}, String(shown.length)))),
      shown.map(row => matrixRow(row, tools))));
}

function skeletonRows() {
  return h('div.mx', { 'aria-hidden': 'true' },
    h('div.mx-head', {}, h('div.mx-row', {}, h('div.mx-name-head', {}, 'Name'), h('div.mx-status-head', {}, 'Status'), h('div.mx-col-head', {}, 'Found in'), h('div.mx-col-head', {}, 'Claude Code'), h('div.mx-col-head', {}, 'Copilot CLI'), h('div.mx-fill'))),
    h('div.mx-section', {}, h('div', {}, h('strong', {}, 'Skills'))),
    Array.from({ length: 8 }, () => h('div.mx-row.mx-item', {},
      h('div.mx-name', {}, h('div.skeleton.skeleton-bar')), h('div'), h('div'),
      h('div.mx-cell', {}, h('div.skeleton.skeleton-dot')), h('div.mx-cell', {}, h('div.skeleton.skeleton-dot')), h('div.mx-fill'))));
}

export function overviewPage() {
  const { home, preview } = state;
  if (!home || !preview) {
    if (state.busy) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, skeletonRows()));
    return h('div.page', {}, emptyState('circle-alert', 'Could not read this home', 'Nothing changed.', button({ label: 'Try again', id: 'first-retry', onclick: () => void loadHome('fixture') })));
  }
  const rows = buildRows(home, preview);
  const tools = toolIds(home);
  const region = h('div.scroll.matrix', { id: 'matrix-scroll' }, matrixBody(rows, tools));
  const count = h('span.result-count', {}, countText(rows.filter(row => matches(row, state.find)).length, rows.length));
  const refreshList = () => {
    region.replaceChildren(matrixBody(rows, tools));
    count.textContent = countText(rows.filter(row => matches(row, state.find)).length, rows.length);
  };
  const toCopy = preview.items.filter(item => item.state === 'copy').length;
  const sharing = state.panel === 'share';
  return h('div.page', {},
    noticeBand(home, preview),
    h('div.toolbar', {},
      findField('Find', refreshList),
      h('div.toolbar-end', {}, count,
        button({
          variant: sharing ? 'secondary' : 'primary', size: 'small', id: 'share-open', label: toCopy ? `Share ${toCopy}` : 'Share',
          name: toCopy ? `Share ${toCopy} ${toCopy === 1 ? 'skill' : 'skills'} to copy` : 'Share',
          attrs: { 'aria-expanded': String(sharing) },
          onclick: () => (sharing ? closePanel() : openPanel('share')),
        }))),
    region);
}

// ---------- Item detail ----------

const shortId = (row: Row, directory: string) => row.plan?.copies.find(copy => copy.directory === directory)?.hash.slice(0, 7);

export function disclosure(id: string, label: string, body: () => Node, fallback = false) {
  let open = disclosureOpen(id, fallback);
  const holder = h('div.disclosure-body', { id: `${id}-body` }, open ? body() : null);
  holder.hidden = !open;
  const trigger = h('button.disclosure', {
    type: 'button', id, 'aria-expanded': String(open), 'aria-controls': `${id}-body`,
    onclick: () => {
      open = !open;
      state.disclosures[id] = open;
      trigger.setAttribute('aria-expanded', String(open));
      trigger.firstElementChild!.replaceWith(icon(open ? 'chevron-down' : 'chevron-right', 14));
      holder.replaceChildren(...(open ? [body()] : []));
      holder.hidden = !open;
    },
  }, icon(open ? 'chevron-down' : 'chevron-right', 14), label);
  return h('div', {}, trigger, holder);
}

export function copyButton(text: string, what: string, id: string) {
  const glyphButton = button({
    variant: 'ghost', size: 'micro', icon: 'copy', name: `Copy ${what}`, id,
    onclick: () => void navigator.clipboard.writeText(text).then(() => {
      glyphButton.firstElementChild!.replaceWith(icon('copy-check', 14));
      announce(`Copied ${what}.`);
      setTimeout(() => glyphButton.firstElementChild?.replaceWith(icon('copy', 14)), 1500);
    }, () => announce('Could not copy. Select the text instead.')),
  });
  return glyphButton;
}

const fact = (term: string, value: Node | string) => [h('dt', {}, term), h('dd', {}, value)];

function pathCard(row: Row, copy: Row['copies'][number], index: number) {
  const { skill, tool } = copy;
  const id = shortId(row, skill.directory);
  return h('div.card.path-card', {},
    h('div.path-top', {}, pathText(shownPath(skill.directory), skill.directory), copyButton(skill.directory, `path for ${toolName(tool)}`, `copy-${row.key}-${index}`)),
    h('div.path-tags', {},
      id && h('span.short-id.mono', { title: 'Content ID. Different IDs mean different bytes.' }, id),
      h('span.tag', {}, icon('circle-small', 16, 'glyph-present'), toolName(tool)),
      h('span.tag-note', {}, skill.rootLabel)),
    disclosure(`path-details-${row.key}-${index}`, 'Details', () => h('dl.facts.facts-compact', {},
      ...fact('Skill file', pathText(shownPath(skill.path), skill.path)),
      ...(skill.realDirectory !== skill.directory ? fact('Real folder', pathText(shownPath(skill.realDirectory), skill.realDirectory)) : []),
      ...fact('Frontmatter', skill.hasFrontmatter ? 'Yes' : 'No'),
      ...(skill.metadataKeys.length ? fact('Fields of note', skill.metadataKeys.join(', ')) : []))));
}

/** One block per distinct content, named by the copies that hold it. */
function contents(row: Row) {
  const distinct = new Map<string, Row['copies']>();
  for (const copy of row.copies) distinct.set(copy.skill.content, [...(distinct.get(copy.skill.content) ?? []), copy]);
  return [...distinct].map(([content, holders], index) => {
    const who = holders.map(holder => `${toolName(holder.tool)} (${holder.skill.rootLabel})`).join(', ');
    return h('div.content-block', {},
      distinct.size > 1 && h('p.content-owner', {}, who),
      h('pre.content.mono', { tabindex: '0', id: `content-${row.key}-${index}`, 'aria-label': `Original skill contents, ${who}` }, content));
  });
}

/** Stacked sections, shared by the Skills detail pane and the Overview item panel. */
export function itemSections(row: Row, tools: HarnessId[]) {
  const found = row.copies.map(copy => copy.tool).filter((tool, index, all) => all.indexOf(tool) === index);
  const notes = [...new Set(row.copies.flatMap(copy => copy.skill.notes))];
  return [
    section('Summary',
      h('p', {}, row.description || h('span.muted', {}, 'No description provided')),
      h('p.muted', {}, `${plural(row.copies.length, 'copy', 'copies')} · found in ${found.map(toolName).join(' and ')} (${found.length} of ${tools.length} tools)`)),
    section('Status', h('p.status-line', {}, statusText(row.status)), row.plan && h('p.muted', {}, row.plan.reason)),
    section('Where it is', h('div.stack', {}, row.copies.map((copy, index) => pathCard(row, copy, index)))),
    notes.length > 0 && section('Notes', notes.map(note => h('p', {}, note))),
    section('Contents', contents(row)),
  ];
}

// ---------- Skills ----------

function listRow(row: Row, tools: HarnessId[], selected: boolean) {
  const present = tools.filter(tool => copiesIn(row, tool).length).length;
  return h(`button.list-row${selected ? '.selected' : ''}`, {
    type: 'button', id: `list-${row.key}`, 'aria-pressed': String(selected),
    'aria-label': `${row.name}, ${row.status}, in ${present} of ${tools.length} tools`,
    onclick: () => selectItem(row.key),
  },
    icon('wand-sparkles', 16, 'tone-muted'),
    middle(row.name, 12, 'list-name'),
    row.plan?.state === 'collision' && h('span.badge.badge-info', { title: 'Copies differ' }, icon('diff', 12)),
    h('span.list-fraction', {}, `${present}/${tools.length}`),
    h('span.list-status', { title: row.status }, statusGlyph(row.status, 16)));
}

export function skillsPage() {
  const { home, preview } = state;
  if (!home || !preview) return h('div.page');
  const rows = buildRows(home, preview);
  const tools = toolIds(home);
  if (!rows.length) return h('div.page', {}, emptyState('wand-sparkles', 'No skills here yet', 'Neither tool has a user-wide skill in this home. Choose another home at the bottom left, or read this one again.', button({ icon: 'refresh-cw', label: 'Read again', id: 'empty-read', disabled: !!state.busy, onclick: () => void readAgain() })));
  const chosen = rows.find(row => row.key === state.item);
  const shownDetail = chosen ?? rows[0];
  // Two panes always show a skill. One pane shows the list until a skill is chosen.
  const highlighted = chosen ?? (document.body.classList.contains('one-pane') ? undefined : rows[0]);
  const listBody = () => {
    const shown = rows.filter(row => matches(row, state.find));
    return shown.length
      ? h('div', { role: 'group', 'aria-label': 'Skills' }, shown.map(row => listRow(row, tools, row === highlighted)))
      : emptyState('search-x', 'Nothing matches', `“${state.find}”`, clearFindAction());
  };
  const region = h('div.scroll.list-scroll', { id: 'list-scroll' }, listBody());
  document.body.classList.toggle('has-item', !!chosen);
  return h('div.page.split', {},
    h('div.list-column', {},
      h('div.toolbar.list-toolbar', {}, findField('Find', () => region.replaceChildren(listBody()))),
      region),
    h('section.detail-column', { 'aria-label': 'Item detail' },
      h('div.pane-header', {},
        h('div.crumb', {},
          button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Skills', id: 'detail-back', onclick: () => selectItem(undefined) }),
          h('span.crumb-sep', { 'aria-hidden': 'true' }, '/')),
        icon('wand-sparkles', 16, 'tone-muted'),
        h('div.pane-title', {}, h('h2', {}, middle(shownDetail.name)), h('p', {}, 'Skill'))),
      h('div.scroll.detail-scroll', { id: 'detail-scroll' }, itemSections(shownDetail, tools))));
}

// ---------- Tools ----------

const dirname = (path: string) => path.replace(/[/\\][^/\\]*$/, '');

const discoveryLine = (snapshot: Snapshot) => ({
  ready: plural(snapshot.skills.length, 'skill'),
  empty: 'No standalone skills in this user-wide folder.',
  missing: 'No skills folder found.',
  restricted: 'Discovery needs attention. See the reason below.',
  failed: 'Discovery needs attention. See the reason below.',
})[snapshot.discovery];

function toolCard(snapshot: Snapshot, preview: Preview) {
  const disclosed = preview.disclosures.find(entry => entry.harness === snapshot.harness);
  const roots = new Map(snapshot.skills.map(skill => [dirname(skill.directory), skill.rootLabel]));
  const issues = snapshot.discovery === 'missing' ? [] : snapshot.issues;
  const path = (value: string) => pathText(shownPath(value), value);
  return h('article.card.tool-card', { 'aria-label': fullToolName(snapshot) },
    h('header.tool-head', {},
      h('span.monogram', { 'aria-hidden': 'true' }, toolMonogram(snapshot.harness)),
      h('h2.tool-title', {}, fullToolName(snapshot)),
      pathText(shownPath(snapshot.root), snapshot.root),
      copyButton(snapshot.root, `folder for ${fullToolName(snapshot)}`, `copy-root-${snapshot.harness}`)),
    h('div.tool-body', {},
      h('div.tool-column', {},
        section('Detection', h('dl.facts', {},
          ...fact('Status', snapshot.detection),
          ...fact('Version', snapshot.probe.version ?? snapshot.probe.detail))),
        section('Folders', h('dl.facts', {},
          ...fact('Config folder', path(snapshot.root)),
          ...[...roots].flatMap(([root, label]) => fact(label, path(root))),
          ...(disclosed ? fact('Start writes to', path(disclosed.writesTo)) : [])))),
      h('div.tool-column', {},
        section('What it has',
          snapshot.skills.length
            ? h('div.link-row', {}, button({ variant: 'link', size: 'micro', label: `${plural(snapshot.skills.length, 'skill')} in Overview`, id: `tool-overview-${snapshot.harness}`, onclick: () => showPage('overview') }))
            : h('p', {}, discoveryLine(snapshot))),
        disclosed && section('Others that read its folder', h('p', {}, disclosed.alsoReadBy.join(', '))),
        issues.length > 0 && section('Read problems', h('ul.plain-list', { role: 'status' }, issues.map(issue => h('li', {}, issue)))))));
}

export function toolsPage() {
  const { home, preview } = state;
  if (!home || !preview) return h('div.page');
  return h('div.page', {}, h('div.scroll.cards-scroll', { id: 'tools-scroll' }, home.snapshots.map(snapshot => toolCard(snapshot, preview))));
}

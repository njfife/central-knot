import type { ActionResult, DesktopApi, HarnessId, HomeMode, HomeView, PlanItem, Preview, Skill, Snapshot } from './types.ts';

declare global { interface Window { centralKnot: DesktopApi } }

function element<Kind extends HTMLElement>(selector: string): Kind {
  const found = document.querySelector<Kind>(selector);
  if (!found) throw new Error(`Missing interface element: ${selector}`);
  return found;
}

const setText = (selector: string, text: string) => { element(selector).textContent = text; };
const api = () => window.centralKnot;

let home: HomeView;
let page: HarnessId | 'share' = 'claude-cli';
let selected: HarnessId[] = [];
let dontShare: string[] = [];
let preview: Preview;
let selectedSkill: string | undefined;
let selectedPlan: string | undefined;

const planFor = (skill: Skill) => preview?.items.find(item => item.key === skill.folder.normalize('NFC').toLowerCase());
const rowStatuses = ['Needs a decision', 'Not available here', 'Not known yet', 'With limits', 'Written'];
const rowStatus = (skill: Skill) => { const status = planFor(skill)?.status; return status && rowStatuses.includes(status) ? status : 'Not shared'; };

function showSkill(skill: Skill) {
  selectedSkill = skill.id;
  setText('#detail-name', skill.name);
  setText('#detail-status', rowStatus(skill));
  setText('#detail-path', skill.path);
  setText('#detail-notes', skill.notes.join(' '));
  setText('#detail-content', skill.content);
  for (const row of document.querySelectorAll<HTMLButtonElement>('.skill-row')) row.setAttribute('aria-pressed', String(row.dataset.id === selectedSkill));
}

function row(className: string, id: string, title: string, description: string, status: string, onClick: () => void, statusClass = '') {
  const button = document.createElement('button');
  button.className = className;
  button.dataset.id = id;
  const heading = document.createElement('strong');
  heading.textContent = title;
  const text = document.createElement('span');
  text.textContent = description;
  const label = document.createElement('small');
  label.textContent = status;
  if (statusClass) label.className = statusClass;
  button.append(heading, text, label);
  button.addEventListener('click', onClick);
  return button;
}

function renderTool(snapshot: Snapshot) {
  setText('#tool-title', `${snapshot.harnessName} ${snapshot.surface}`);
  setText('#detection', snapshot.detection);
  setText('#version', snapshot.probe.version ? `Version ${snapshot.probe.version}` : snapshot.probe.detail);
  setText('#count', `${snapshot.skills.length} ${snapshot.skills.length === 1 ? 'skill' : 'skills'}`);
  setText('#issues', snapshot.issues.join('\n'));
  const list = element('#skills');
  list.replaceChildren();
  for (const skill of snapshot.skills) list.append(row('skill-row', skill.id, skill.name, skill.description || 'No description provided', rowStatus(skill), () => showSkill(skill)));
  if (!snapshot.skills.length) {
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = snapshot.discovery === 'empty' ? 'No standalone skills in this user-wide folder.' : snapshot.discovery === 'missing' ? 'No skills folder found.' : 'Discovery needs attention. See the reason below.';
    list.append(message);
  }
  const selection = snapshot.skills.find(skill => skill.id === selectedSkill) ?? snapshot.skills[0];
  if (selection) showSkill(selection);
  else {
    setText('#detail-name', 'Choose a skill');
    for (const part of ['#detail-status', '#detail-path', '#detail-notes', '#detail-content']) setText(part, '');
  }
}

const statusClass: Record<PlanItem['state'], string> = { copy: 'will', collision: 'warn', held: 'warn', 'dont-share': 'quiet', identical: 'quiet', 'already-shared': 'quiet' };
const statusOrder: PlanItem['state'][] = ['collision', 'held', 'copy', 'identical', 'already-shared', 'dont-share'];

function summary(): string {
  const count = (state: PlanItem['state']) => preview.items.filter(item => item.state === state).length;
  const parts = [[count('copy'), 'to copy'], [count('collision'), 'to decide'], [count('held'), 'held']] as const;
  return parts.filter(([value]) => value).map(([value, label]) => `${value} ${label}`).join(' · ') || `${preview.items.length} in step`;
}

function showPlan(item: PlanItem) {
  selectedPlan = item.key;
  setText('#plan-name', item.name);
  setText('#plan-status', item.status);
  setText('#plan-reason', item.reason);
  const limits = element('#plan-limits');
  limits.replaceChildren();
  for (const target of item.targets) for (const text of [...target.limits, ...(target.note ? [target.note] : [])]) {
    const line = document.createElement('li');
    line.textContent = text;
    limits.append(line);
  }
  element('#plan-exclude-label').hidden = item.locked || !preview.access.allowed || item.undoable;
  element<HTMLInputElement>('#plan-exclude').checked = dontShare.includes(item.key);
  element('#plan-undo').hidden = !item.undoable || !preview.access.allowed;
  setText('#plan-paths', [...item.copies.map(copy => `Now: ${copy.directory}`), ...item.targets.map(target => `${target.skipped ? 'Skipped' : 'Will write'}: ${target.directory}`)].join('\n'));
  const diff = element('#plan-diff');
  diff.hidden = !item.diff;
  diff.textContent = item.diff ?? '';
  for (const entry of document.querySelectorAll<HTMLButtonElement>('.plan-row')) entry.setAttribute('aria-pressed', String(entry.dataset.id === selectedPlan));
}

function renderShare() {
  const picks = element('#tool-picks');
  picks.querySelectorAll('label').forEach(label => label.remove());
  for (const snapshot of home.snapshots) {
    const label = document.createElement('label');
    label.className = 'pick';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selected.includes(snapshot.harness);
    box.addEventListener('change', () => {
      selected = box.checked ? [...selected, snapshot.harness] : selected.filter(id => id !== snapshot.harness);
      void refreshPreview();
    });
    const text = document.createElement('span');
    text.textContent = `${snapshot.harnessName} ${snapshot.surface}`;
    const count = document.createElement('small');
    count.textContent = `${snapshot.skills.length} ${snapshot.skills.length === 1 ? 'skill' : 'skills'}${home.mode === 'actual' ? ` · ${snapshot.detection}` : ''}`;
    label.append(box, text, count);
    picks.append(label);
  }
  const stop = element('#share-stop');
  const stopReason = preview.gate.state === 'stopped' ? preview.gate.reason : '';
  stop.hidden = !stopReason;
  stop.textContent = stopReason;
  const list = element('#plan');
  list.replaceChildren();
  const ordered = [...preview.items].sort((first, second) => statusOrder.indexOf(first.state) - statusOrder.indexOf(second.state) || first.name.localeCompare(second.name));
  for (const item of ordered) list.append(row('plan-row', item.key, item.name, item.reason, item.status, () => showPlan(item), statusClass[item.state]));
  if (!ordered.length) {
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = selected.length ? 'The selected tools have no standalone skills yet.' : 'Pick at least one tool above.';
    list.append(message);
  }
  setText('#plan-count', `${preview.items.length} ${preview.items.length === 1 ? 'skill' : 'skills'}`);
  setText('#share-summary', summary());
  const first = ordered.find(item => item.key === selectedPlan) ?? ordered[0];
  if (first) showPlan(first);
  setText('#disclosure', preview.disclosures.map(disclosure => `Writing for ${disclosure.name} goes to ${disclosure.writesTo}, which ${disclosure.alsoReadBy.join(', ')} also read.`).join(' '));
  const startButton = element<HTMLButtonElement>('#start');
  const blocked = !preview.access.allowed || preview.gate.state === 'stopped' || !selected.length;
  startButton.disabled = blocked;
  startButton.textContent = preview.gate.state === 'needs-resume' ? 'Resume and Start' : 'Start';
  setText('#start-note', !preview.access.allowed ? preview.access.reason : preview.gate.state === 'needs-resume' ? preview.gate.reason : preview.access.reason);
  element('#undo-all').hidden = !preview.canUndo || !preview.access.allowed;
}

function renderChrome() {
  setText('#home-label', home.label);
  setText('#mode-note', preview.access.allowed ? 'Disposable copy · Start and Undo write only here' : 'Your real folders · read only');
  const list = element('#tool-list');
  list.replaceChildren();
  for (const snapshot of home.snapshots) {
    const button = document.createElement('button');
    button.className = 'nav-row';
    button.dataset.tool = snapshot.harness;
    button.setAttribute('aria-current', String(page === snapshot.harness));
    const name = document.createElement('strong');
    name.textContent = `${snapshot.harnessName} ${snapshot.surface}`;
    const detail = document.createElement('small');
    detail.textContent = snapshot.detection === 'Not found' ? 'Not found' : `${snapshot.skills.length} ${snapshot.skills.length === 1 ? 'skill' : 'skills'}`;
    button.append(name, detail);
    button.addEventListener('click', () => { page = snapshot.harness; selectedSkill = undefined; render(); });
    list.append(button);
  }
  element('#nav-share').setAttribute('aria-current', String(page === 'share'));
}

function render() {
  renderChrome();
  element('#tool-page').hidden = page === 'share';
  element('#share-page').hidden = page !== 'share';
  renderShare();
  if (page !== 'share') renderTool(home.snapshots.find(snapshot => snapshot.harness === page)!);
  document.body.dataset.ready = 'true';
}

async function busy<Value>(message: string, work: () => Promise<Value>): Promise<Value | undefined> {
  const controls = document.querySelectorAll<HTMLButtonElement>('[data-home], #refresh, #start, #undo-all, #plan-undo');
  const prior = [...controls].map(button => button.disabled);
  controls.forEach(button => { button.disabled = true; });
  setText('#announcement', message);
  document.body.dataset.busy = 'true';
  try { return await work(); }
  catch {
    setText('#announcement', 'That could not finish. The last good state stays. Try again.');
    return undefined;
  } finally {
    controls.forEach((button, index) => { button.disabled = prior[index]; });
    document.body.dataset.busy = 'false';
  }
}

function accept(view: HomeView | null | undefined) {
  if (!view) return;
  home = view;
  preview = view.preview;
  selected = view.preview.selected;
  dontShare = [];
  element('#results').replaceChildren();
  render();
}

async function load(mode: HomeMode) {
  const view = await busy('Reading user-wide skills…', () => api().selectHome(mode));
  if (view) { accept(view); setText('#announcement', 'Read complete. Nothing changed.'); }
  if (document.body.dataset.ready !== 'true' && !view) setText('#announcement', 'Could not read this home. Nothing changed. Try another folder.');
}

async function refreshPreview() {
  const next = await busy('Checking…', () => api().preview(selected, dontShare));
  if (next) { preview = next; render(); setText('#announcement', ''); }
}

function showResults(action: ActionResult, done: string) {
  preview = action.preview;
  const list = element('#results');
  list.replaceChildren();
  for (const result of action.results.filter(result => result.outcome !== 'kept')) {
    const line = document.createElement('li');
    line.className = result.outcome;
    const name = document.createElement('strong');
    name.textContent = result.item;
    line.append(name, ` — ${result.message}`);
    list.append(line);
  }
  setText('#announcement', action.stopped ?? done);
}

async function afterAction(action: ActionResult | undefined, done: (action: ActionResult) => string) {
  if (!action) return;
  const view = await api().refresh();
  if (view) { home = view; }
  showResults(action, done(action));
  dontShare = dontShare.filter(key => action.preview.items.some(item => item.key === key));
  render();
}

element('#start').addEventListener('click', () => void (async () => {
  const action = await busy('Copying…', () => api().start(selected, dontShare, preview.gate.state === 'needs-resume'));
  await afterAction(action, result => (result.harnessWrites ? `${result.harnessWrites} ${result.harnessWrites === 1 ? 'copy' : 'copies'} written. Your tools load them in a new session.` : 'Done. Nothing needed copying.'));
})());
element('#undo-all').addEventListener('click', () => void (async () => {
  const action = await busy('Undoing…', () => api().undo(selected));
  await afterAction(action, result => `${result.harnessWrites} ${result.harnessWrites === 1 ? 'copy' : 'copies'} removed. Those skills are now Don’t share.`);
})());
element('#plan-undo').addEventListener('click', () => void (async () => {
  if (!selectedPlan) return;
  const name = preview.items.find(item => item.key === selectedPlan)?.name;
  const action = await busy('Undoing…', () => api().undo(selected, name));
  await afterAction(action, result => `${result.harnessWrites} ${result.harnessWrites === 1 ? 'copy' : 'copies'} removed.`);
})());
element<HTMLInputElement>('#plan-exclude').addEventListener('change', event => {
  if (!selectedPlan) return;
  const key = selectedPlan;
  dontShare = (event.target as HTMLInputElement).checked ? [...dontShare, key] : dontShare.filter(entry => entry !== key);
  void refreshPreview();
});
element('#nav-share').addEventListener('click', () => { page = 'share'; render(); });
element('#refresh').addEventListener('click', () => void (async () => {
  const view = await busy('Reading user-wide skills…', () => api().refresh());
  if (view) { home = view; preview = await api().preview(selected, dontShare); render(); setText('#announcement', 'Read complete. Nothing changed.'); }
})());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-home]')) button.addEventListener('click', () => void load(button.dataset.home as HomeMode));
void load('fixture');

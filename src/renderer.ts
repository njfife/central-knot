import type { DesktopApi, HomeMode, Skill, Snapshot } from './types.ts';

declare global { interface Window { centralKnot: DesktopApi } }

function element<Kind extends HTMLElement>(selector: string): Kind {
  const found = document.querySelector<Kind>(selector);
  if (!found) throw new Error(`Missing interface element: ${selector}`);
  return found;
}

let current: Snapshot;
let selectedId: string | undefined;

function showSkill(skill: Skill) {
  selectedId = skill.id;
  element('#detail-name').textContent = skill.name;
  element('#detail-status').textContent = 'Not shared · read only';
  element('#detail-path').textContent = skill.path;
  element('#detail-notes').textContent = skill.notes.join(' ');
  element('#detail-content').textContent = skill.content;
  for (const row of document.querySelectorAll<HTMLButtonElement>('.skill-row')) row.setAttribute('aria-pressed', String(row.dataset.id === selectedId));
}

function render(snapshot: Snapshot) {
  current = snapshot;
  element('#home-label').textContent = snapshot.label;
  element('#detection').textContent = snapshot.detection;
  element('#version').textContent = snapshot.probe.version ? `Version ${snapshot.probe.version}` : snapshot.probe.detail;
  element('#count').textContent = `${snapshot.skills.length} ${snapshot.skills.length === 1 ? 'skill' : 'skills'}`;
  element('#issues').textContent = snapshot.issues.join('\n');
  const list = element('#skills');
  list.replaceChildren();
  for (const skill of snapshot.skills) {
    const button = document.createElement('button');
    button.className = 'skill-row';
    button.dataset.id = skill.id;
    const heading = document.createElement('strong');
    heading.textContent = skill.name;
    const description = document.createElement('span');
    description.textContent = skill.description || 'No description provided';
    const status = document.createElement('small');
    status.textContent = 'Not shared';
    button.append(heading, description, status);
    button.addEventListener('click', () => showSkill(skill));
    list.append(button);
  }
  if (!snapshot.skills.length) {
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = snapshot.discovery === 'empty' ? 'No standalone skills in this user-wide folder.' : snapshot.discovery === 'missing' ? 'No skills folder found.' : 'Discovery needs attention. See the reason below.';
    list.append(message);
  }
  const selection = snapshot.skills.find(skill => skill.id === selectedId) ?? snapshot.skills[0];
  if (selection) showSkill(selection);
  else {
    element('#detail-name').textContent = 'Choose a skill';
    element('#detail-status').textContent = 'Nothing is shared or changed';
    element('#detail-path').textContent = '';
    element('#detail-notes').textContent = '';
    element('#detail-content').textContent = '';
  }
  document.body.dataset.ready = 'true';
}

async function load(mode: HomeMode) {
  const controls = document.querySelectorAll<HTMLButtonElement>('[data-home], #refresh');
  controls.forEach(button => button.disabled = true);
  element('#announcement').textContent = 'Reading user-wide skills…';
  try {
    const snapshot = await window.centralKnot.selectHome(mode);
    if (snapshot) render(snapshot);
    element('#announcement').textContent = 'Read complete. No configuration changed.';
  } catch {
    element('#announcement').textContent = 'Could not read this home. No configuration changed. Try another folder.';
  } finally {
    controls.forEach(button => button.disabled = false);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-home]')) button.addEventListener('click', () => void load(button.dataset.home as HomeMode));
element('#refresh').addEventListener('click', () => void load(current?.mode === 'custom' ? 'custom' : current?.mode ?? 'fixture'));
void load('fixture');

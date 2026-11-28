// Base instructions card (basecard.ts): shared symlinked files counted by distinct readers, older and missing copies left
// unfolded beside matching tools, and an opened matching fold staying open across a redraw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, InstructionFile } from '../src/types.ts';
import { findById, findNode, installDom, makeElement, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { userAgent: 'Macintosh', byId: id => findById(rendered, id) ?? null });

const { state: app } = await import('../src/app.ts');
const { baseCard } = await import('../src/basecard.ts');
const { scrollIntoBox } = await import('../src/dom.ts');
const { instructionsPage } = await import('../src/instructionspage.ts');

const FILE_NAMES: Record<HarnessId, string> = {
  'claude-cli': '/home/.claude/CLAUDE.md',
  'copilot-cli': '/home/.copilot/copilot-instructions.md',
  'codex-cli': '/home/.codex/AGENTS.md',
  'pi-cli': '/home/.pi/agent/AGENTS.md',
  'opencode-cli': '/home/.config/opencode/AGENTS.md',
  'antigravity-cli': '/home/.gemini/config/AGENTS.md',
};

const findAll = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) findAll(child, match, out);
  return out;
};

const makeFile = (tool: HarnessId, state: 'same' | 'edited' | 'older' | 'missing', extra: Partial<InstructionFile> = {}): InstructionFile => ({
  tool,
  path: FILE_NAMES[tool],
  exists: state !== 'missing' || extra.exists === true,
  text: state === 'missing' ? '' : 'Own line.\n',
  hash: `h-${tool}`,
  readers: tool,
  notes: [],
  nextStep: 'Start a new session.',
  versions: [],
  sameFile: [],
  base: { chosen: true, state, own: state === 'missing' ? '' : 'Own line.\n', copy: state === 'missing' ? undefined : '- Shared.\n', leftPlain: false },
  ...extra,
});

function setupBase(files: InstructionFile[]) {
  app.home = { home: '/home', mode: 'actual', sync: { access: { allowed: true }, gate: { state: 'ready' } } } as never;
  app.page = 'instructions';
  app.baseEdit = undefined;
  app.instructionEdit = undefined;
  app.draftPick = undefined;
  app.drafting = undefined;
  app.instructions = { state: 'ready', data: files, gen: 1 };
  app.base = { path: '/home/.central-knot/instructions/base.md', text: '- Shared.\n', hash: 'base-h', tools: files.map(f => f.tool), versions: [], drafters: [] };
}

test('shared symlinked files fold once as one row while counting every distinct reader', () => {
  const sharedFiles = [
    makeFile('claude-cli', 'same', { sameFile: ['codex-cli'] }),
    makeFile('copilot-cli', 'same'),
    makeFile('codex-cli', 'same', { sameFile: ['claude-cli'], path: FILE_NAMES['claude-cli'] }),
    makeFile('pi-cli', 'same'),
    makeFile('opencode-cli', 'same'),
    makeFile('antigravity-cli', 'same'),
  ];
  setupBase(sharedFiles);
  rendered = baseCard(sharedFiles) as unknown as FakeNode;
  const fold = findById(rendered, 'base-matching')!;
  assert.equal('open' in fold.attrs, false);
  assert.equal(textOf(findNode(fold, el => el.tag === 'summary')), '6 tools match the base');
  assert.equal(findAll(fold, el => el.className.split(/\s+/).includes('base-tool')).length, 5);
  assert.equal(textOf(findNode(rendered, el => el.className.split(/\s+/).includes('ins-missing'))), 'In 6 tools');
});

test('older and missing copies stay unfolded while matching tools fold', () => {
  const files = [
    makeFile('claude-cli', 'same'),
    makeFile('copilot-cli', 'older'),
    makeFile('codex-cli', 'missing', { exists: false }),
    makeFile('pi-cli', 'missing', { exists: true }),
  ];
  setupBase(files);
  rendered = baseCard(files) as unknown as FakeNode;

  const fold = findById(rendered, 'base-matching')!;
  assert.equal(textOf(findNode(fold, el => el.tag === 'summary')), '1 tool matches the base');
  assert.equal(findAll(fold, el => el.className.split(/\s+/).includes('base-tool')).length, 1);
  const outsideText = textOf(rendered).replace(textOf(fold), '');
  assert.match(outsideText, /Has an older version/);
  assert.match(outsideText, /No file yet/);
  assert.match(outsideText, /Not in the file yet/);
});

test('a matching fold opened by the user stays open through a redraw', () => {
  const files = [makeFile('claude-cli', 'same'), makeFile('copilot-cli', 'same')];
  setupBase(files);
  rendered = baseCard(files) as unknown as FakeNode;
  const first = findById(rendered, 'base-matching') as FakeNode & { ontoggle: (event: { currentTarget: { open: boolean } }) => void };
  assert.equal('open' in first.attrs, false);

  first.ontoggle({ currentTarget: { open: true } });
  rendered = baseCard(files) as unknown as FakeNode;
  const reopened = findById(rendered, 'base-matching') as FakeNode & { ontoggle: (event: { currentTarget: { open: boolean } }) => void };
  assert.equal('open' in reopened.attrs, true);

  reopened.ontoggle({ currentTarget: { open: false } });
  rendered = baseCard(files) as unknown as FakeNode;
  assert.equal('open' in findById(rendered, 'base-matching')!.attrs, false);
});

test('Instructions leads with tool cards, keeps Base instructions reachable at top, and keeps a dirty base editor in place', () => {
  const files = [
    makeFile('claude-cli', 'same', {
      parts: [{ path: '/home/.claude/notes/style.md', from: 'imported by CLAUDE.md, line 1', text: 'Be brief.\n' }],
      ownHooks: [{ declaredIn: '/home/.claude/settings.json', event: 'SessionStart', at: 0, launch: { shell: 'echo hi' } }],
      versions: [{ id: 'v1', at: '2026-11-26T10:00:00.000Z', firstLine: '# Old', lines: 3, differs: 1 }],
    }),
    makeFile('codex-cli', 'same'),
  ];
  setupBase(files);
  rendered = instructionsPage() as unknown as FakeNode;
  const scroll = findById(rendered, 'instructions-scroll')!;
  const children = scroll.children as FakeNode[];
  const aboutIdx = children.findIndex(el => el.className.includes('ins-about-line'));
  const toolsIdx = children.findIndex(el => el.className.includes('ins-tool-cards'));
  const baseIdx = children.findIndex(el => el.attrs?.id === 'base-card');
  assert.ok(aboutIdx >= 0 && toolsIdx > aboutIdx && baseIdx > toolsIdx, `expected about (${aboutIdx}) < tools (${toolsIdx}) < base (${baseIdx})`);
  assert.ok(findById(children[aboutIdx], 'ins-about'), 'How these files are read stays in the top line');
  const goBase = findById(children[aboutIdx], 'ins-go-base')!;
  assert.ok(goBase, 'Base instructions jump control stays reachable at top');
  assert.equal(textOf(goBase), 'Base instructions ↓');
  // Inside a tool card, order stays: own text (.ins-body) -> added files (.ins-parts) -> hooks (.session-strip) -> versions (.ins-versions).
  const claudeCard = findAll(rendered, el => el.attrs?.['aria-label'] === 'Claude Code instructions')[0]!;
  const inside = claudeCard.children as FakeNode[];
  const bodyIdx = inside.findIndex(el => el.className.includes('ins-body'));
  const partsIdx = inside.findIndex(el => el.className.includes('ins-parts'));
  const stripIdx = inside.findIndex(el => el.className.includes('session-strip'));
  const versionsIdx = inside.findIndex(el => el.className.includes('ins-versions'));
  assert.ok(bodyIdx >= 0 && partsIdx > bodyIdx && stripIdx > partsIdx && versionsIdx > stripIdx, 'order inside tool card preserved');

  // Dirty base editor stays mounted in place in #base-card: jump focuses #base-text and a redraw keeps the unsaved draft there.
  app.baseEdit = { text: '- Shared edited draft.\n', hash: 'base-h', tools: ['claude-cli', 'codex-cli'], stage: 'edit' };
  rendered = instructionsPage() as unknown as FakeNode;
  const dirtyGo = findById(rendered, 'ins-go-base')!;
  dirtyGo.focus();
  dirtyGo.click();
  const dirtyArea = findById(rendered, 'base-text') as FakeNode & { value?: string };
  assert.equal((document.activeElement as unknown as FakeNode)?.attrs?.id, 'base-text', 'jump focuses dirty base editor');
  assert.equal(dirtyArea.value, '- Shared edited draft.\n');
  rendered = instructionsPage() as unknown as FakeNode;
  const dirtyChildren = findById(rendered, 'instructions-scroll')!.children as FakeNode[];
  const dirtyBaseIdx = dirtyChildren.findIndex(el => el.attrs?.id === 'base-card');
  assert.ok(dirtyBaseIdx > dirtyChildren.findIndex(el => el.className.includes('ins-tool-cards')), 'dirty base card stays in place after tools');
  assert.equal((findById(dirtyChildren[dirtyBaseIdx], 'base-text') as FakeNode & { value?: string }).value, '- Shared edited draft.\n');
  app.baseEdit = undefined;
});

test('Base jump link carries actionable status with arrow and lands focus in locked, draft-panel, discard-confirm, and stale-save states', () => {
  const editedFiles = [
    makeFile('claude-cli', 'same'),
    makeFile('codex-cli', 'edited', { sameFile: ['pi-cli'], base: { chosen: true, state: 'edited', own: 'Own.\n', copy: '- Edited.\n', leftPlain: false } }),
    makeFile('pi-cli', 'edited', { sameFile: ['codex-cli'], path: FILE_NAMES['codex-cli'], base: { chosen: true, state: 'edited', own: 'Own.\n', copy: '- Edited.\n', leftPlain: false } }),
    makeFile('copilot-cli', 'older'),
  ];
  setupBase(editedFiles);
  rendered = instructionsPage() as unknown as FakeNode;
  const waitingLink = findById(rendered, 'ins-go-base')!;
  const waitingBadge = findNode(waitingLink, el => el.className.split(/\s+/).includes('ins-go-wait'));
  assert.ok(waitingBadge?.className.split(/\s+/).includes('base-pill-warn'), 'waiting count carries amber pill mark');
  assert.equal(textOf(waitingBadge), '1 edited copy · 1 file to update');
  assert.equal(textOf(waitingLink), 'Base instructions 1 edited copy · 1 file to update ↓');

  const jumpFrom = () => {
    rendered = instructionsPage() as unknown as FakeNode;
    const link = findById(rendered, 'ins-go-base')!;
    link.focus();
    link.click();
    return (document.activeElement as unknown as FakeNode | null)?.attrs?.id ?? null;
  };

  // 1a. Home locked, empty base (all buttons disabled): falls back to #base-card itself (tabindex="-1").
  setupBase([makeFile('claude-cli', 'missing', { exists: false })]);
  app.home = { home: '/home', mode: 'actual', sync: { access: { allowed: false, reason: 'Preview only' }, gate: { state: 'ready' } } } as never;
  app.base!.text = '';
  assert.equal(jumpFrom(), 'base-card');
  assert.equal(findById(rendered, 'base-card')!.attrs.tabindex, '-1');

  // 1b. Home locked, existing base (#base-edit disabled): lands on first enabled control (#base-matching-toggle).
  setupBase([makeFile('claude-cli', 'same')]);
  app.home = { home: '/home', mode: 'actual', sync: { access: { allowed: false, reason: 'Preview only' }, gate: { state: 'ready' } } } as never;
  assert.equal(jumpFrom(), 'base-matching-toggle');

  // 2. Draft panel open (head actions hidden, empty base): lands on first enabled control in the draft panel.
  setupBase([makeFile('claude-cli', 'missing', { exists: false })]);
  app.base!.text = '';
  app.base!.drafters = ['claude-cli'];
  app.draftPick = { tool: 'claude-cli', model: '', prompt: 'Sort these instructions.' };
  assert.equal(jumpFrom(), 'base-draft-model');

  // 3. Review discard question (#base-save replaced by discard confirmation): lands on Keep, not Discard.
  setupBase([makeFile('claude-cli', 'same')]);
  app.baseEdit = { text: '- Changed.\n', hash: 'base-h', tools: ['claude-cli'], stage: 'review', confirmDiscard: true };
  assert.equal(jumpFrom(), 'base-review-keep');

  // 4. Stale draft review (#base-save disabled): lands on enabled #base-back.
  setupBase([makeFile('claude-cli', 'same')]);
  app.baseEdit = { text: '- Draft.\n', hash: 'base-h', readBase: 'older-hash', tools: ['claude-cli'], stage: 'review', source: { kind: 'draft', tool: 'claude-cli' } };
  assert.equal(jumpFrom(), 'base-back');
  assert.equal('disabled' in findById(rendered, 'base-save')!.attrs, true);
  app.baseEdit = undefined;
});

test('Base matching fold puts its chevron after the label without tone-faint, and edited-copy states one sentence with review details on button hover', () => {
  const files = [
    makeFile('claude-cli', 'same'),
    makeFile('codex-cli', 'edited', { base: { chosen: true, state: 'edited', own: 'Own.\n', copy: '- Edited.\n', leftPlain: false } }),
    makeFile('pi-cli', 'edited', { base: { chosen: true, state: 'edited', own: 'Own.\n', copy: '   \n', leftPlain: false } }),
  ];
  setupBase(files);
  rendered = baseCard(files) as unknown as FakeNode;

  const summary = findById(rendered, 'base-matching-toggle')!;
  const last = summary.children[summary.children.length - 1] as FakeNode;
  assert.ok(last?.className?.includes('base-matching-chevron'), `chevron should come last in summary, got ${last?.className}`);
  assert.equal(last.className.includes('tone-faint'), false, 'matching fold chevron must not use tone-faint');

  const choices = findAll(rendered, el => el.className.split(/\s+/).includes('base-choice'));
  assert.equal(choices.length, 2);
  const codexExplains = findAll(choices[0], el => el.className.split(/\s+/).includes('base-explain'));
  assert.equal(codexExplains.length, 1, 'edited-copy explanation should be one concise paragraph');
  assert.equal(textOf(codexExplains[0]), 'Changed outside Central Knot, so AGENTS.md was left as it is.');
  assert.ok(findById(choices[0], 'base-diff-codex-cli'));
  const codexUse = findById(choices[0], 'base-usecopy-codex-cli')!;
  const codexRestore = findById(choices[0], 'base-restore-codex-cli')!;
  assert.equal(textOf(codexUse), 'Make Codex’s copy the base…');
  assert.equal(textOf(codexRestore), 'Replace Codex’s copy with the base…');
  assert.match(codexUse.attrs.title, /Shows the change first, keeps the replaced text under Earlier versions, and can be undone\./);
  assert.match(codexRestore.attrs.title, /Shows the change first, keeps the replaced text under Earlier versions, and can be undone\./);

  const piExplains = findAll(choices[1], el => el.className.split(/\s+/).includes('base-explain'));
  assert.equal(piExplains.length, 1);
  assert.equal(textOf(piExplains[0]), 'Changed outside Central Knot, so AGENTS.md was left as it is.');
  assert.equal(findById(choices[1], 'base-usecopy-pi-cli'), undefined);
  const piRestore = findById(choices[1], 'base-restore-pi-cli')!;
  assert.equal(textOf(piRestore), 'Replace Pi’s copy with the base…');
  assert.match(piRestore.attrs.title, /Shows the change first, keeps the replaced text under Earlier versions, and can be undone\./);
});

test('scrollIntoBox scrolls only its enclosing .scroll box for start, center, and nearest', () => {
  const box = makeElement('div');
  box.className = 'scroll';
  box.rect = { top: 100, bottom: 500, height: 400 };
  const target = makeElement('div');
  box.append(target);

  box.scrollTop = 200;
  target.rect = { top: 450, bottom: 490, height: 40 };
  scrollIntoBox(target as unknown as Element, 'start');
  assert.equal(box.scrollTop, 538, 'start places element 12 px inside scroll box top');

  box.scrollTop = 200;
  target.rect = { top: 450, bottom: 490, height: 40 };
  scrollIntoBox(target as unknown as Element, 'center');
  assert.equal(box.scrollTop, 370, 'center aligns element midpoint with scroll box midpoint');

  box.scrollTop = 200;
  target.rect = { top: 150, bottom: 250, height: 100 };
  scrollIntoBox(target as unknown as Element, 'nearest');
  assert.equal(box.scrollTop, 200, 'nearest does not move an element already in sight');

  target.rect = { top: 40, bottom: 80, height: 40 };
  scrollIntoBox(target as unknown as Element, 'nearest');
  assert.equal(box.scrollTop, 128, 'nearest scrolls up just enough when above view');

  box.scrollTop = 200;
  target.rect = { top: 520, bottom: 560, height: 40 };
  scrollIntoBox(target as unknown as Element, 'nearest');
  assert.equal(box.scrollTop, 272, 'nearest scrolls down just enough when below view');
});

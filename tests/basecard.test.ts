// Base instructions card (basecard.ts): shared symlinked files counted by distinct readers, older and missing copies left
// unfolded beside matching tools, and an opened matching fold staying open across a redraw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, InstructionFile } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { userAgent: 'Macintosh', byId: id => findById(rendered, id) ?? null });

const { state: app } = await import('../src/app.ts');
const { baseCard } = await import('../src/basecard.ts');
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
  const goBase = findById(children[aboutIdx], 'ins-go-base');
  assert.ok(goBase, 'Base instructions jump control stays reachable at top');
  assert.equal(textOf(goBase), 'Base instructions');
  // Inside a tool card, order stays: own text (.ins-body) -> added files (.ins-parts) -> hooks (.session-strip) -> versions (.ins-versions).
  const claudeCard = findAll(rendered, el => el.attrs?.['aria-label'] === 'Claude Code instructions')[0]!;
  const inside = claudeCard.children as FakeNode[];
  const bodyIdx = inside.findIndex(el => el.className.includes('ins-body'));
  const partsIdx = inside.findIndex(el => el.className.includes('ins-parts'));
  const stripIdx = inside.findIndex(el => el.className.includes('session-strip'));
  const versionsIdx = inside.findIndex(el => el.className.includes('ins-versions'));
  assert.ok(bodyIdx >= 0 && partsIdx > bodyIdx && stripIdx > partsIdx && versionsIdx > stripIdx, 'order inside tool card preserved');

  // Dirty base editor stays mounted in place in #base-card.
  app.baseEdit = { text: '- Shared edited draft.\n', hash: 'base-h', tools: ['claude-cli', 'codex-cli'], stage: 'edit' };
  rendered = instructionsPage() as unknown as FakeNode;
  const dirtyScroll = findById(rendered, 'instructions-scroll')!;
  const dirtyChildren = dirtyScroll.children as FakeNode[];
  const dirtyBaseIdx = dirtyChildren.findIndex(el => el.attrs?.id === 'base-card');
  assert.ok(dirtyBaseIdx > dirtyChildren.findIndex(el => el.className.includes('ins-tool-cards')), 'dirty base card stays in place after tools');
  assert.ok(findById(dirtyChildren[dirtyBaseIdx], 'base-text'), 'dirty base textarea stays mounted');
  app.baseEdit = undefined;
});

test('Base matching fold puts its chevron after the label without tone-faint, and edited-copy combines explanation into one paragraph with both choices', () => {
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
  assert.equal(codexExplains.length, 1, 'edited-copy explanation should be combined into one paragraph');
  assert.match(textOf(codexExplains[0]), /Changed outside Central Knot, so AGENTS\.md was left as it is; either choice shows the change first, keeps the replaced text under Earlier versions, and can be undone\./);
  assert.ok(findById(choices[0], 'base-diff-codex-cli'));
  assert.ok(findById(choices[0], 'base-usecopy-codex-cli'));
  assert.ok(findById(choices[0], 'base-restore-codex-cli'));

  const piExplains = findAll(choices[1], el => el.className.split(/\s+/).includes('base-explain'));
  assert.equal(piExplains.length, 1);
  assert.match(textOf(piExplains[0]), /putting the base back shows the change first/);
  assert.equal(findById(choices[1], 'base-usecopy-pi-cli'), undefined);
  assert.ok(findById(choices[1], 'base-restore-pi-cli'));
});

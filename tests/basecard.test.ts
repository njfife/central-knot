// Base instructions card and per-tool base strip (basecard.ts): empty base sentence, folding only "Matches the base"
// counted by distinct readers of shared files, keeping edited/older/missing rows unfolded and focusable, and dropping
// "matches the base" on the resting strip.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, InstructionFile } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { userAgent: 'Macintosh', byId: id => findById(rendered, id) ?? null });

const { state: app } = await import('../src/app.ts');
const { baseCard, baseStrip } = await import('../src/basecard.ts');

const ALL_TOOLS: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'];
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
  base: { chosen: true, state, own: state === 'missing' ? '' : 'Own line.\n', copy: state === 'missing' ? undefined : state === 'edited' ? '- Edited.\n' : '- Shared.\n', leftPlain: false },
  ...extra,
});

function setupBase(text: string, files: InstructionFile[]) {
  app.home = { home: '/home', mode: 'actual', sync: { access: { allowed: true }, gate: { state: 'ready' } } } as never;
  app.page = 'instructions';
  app.baseEdit = undefined;
  app.instructionEdit = undefined;
  app.draftPick = undefined;
  app.drafting = undefined;
  app.instructions = { state: 'ready', data: files, gen: 1 };
  app.base = { path: '/home/.central-knot/instructions/base.md', text, hash: 'base-h', tools: files.filter(f => f.base?.chosen).map(f => f.tool), versions: [], drafters: [] };
}

test('empty base card shows the single short sentence', () => {
  const files = [makeFile('claude-cli', 'missing', { base: undefined, exists: true, text: 'Own.\n' })];
  setupBase('', files);
  rendered = baseCard(files) as unknown as FakeNode;
  const line = findNode(rendered, el => el.className.split(/\s+/).includes('ins-readers'));
  assert.equal(textOf(line), 'Written once, added to each tool you choose, below its own text.');
});

test('six matching tools fold closed and shared symlinked files count distinct readers', () => {
  const files = ALL_TOOLS.map(tool => makeFile(tool, 'same'));
  setupBase('- Shared.\n', files);
  rendered = baseCard(files) as unknown as FakeNode;

  const fold = findById(rendered, 'base-matching')!;
  assert.ok(fold, 'matching tools fold into #base-matching');
  assert.equal(fold.tag, 'details');
  assert.equal('open' in fold.attrs, false, 'fold starts closed');
  const summary = findNode(fold, el => el.tag === 'summary');
  assert.equal(textOf(summary), '6 tools match the base');
  // Zero unfolded tool rows outside #base-matching.
  const allRows = findAll(rendered, el => el.className.split(/\s+/).includes('base-tool'));
  const foldedRows = findAll(fold, el => el.className.split(/\s+/).includes('base-tool'));
  assert.equal(allRows.length, 6);
  assert.equal(foldedRows.length, 6);

  // Shared physical file between Claude Code and Codex: 5 physical files, 6 distinct readers.
  const sharedFiles = [
    makeFile('claude-cli', 'same', { sameFile: ['codex-cli'] }),
    makeFile('copilot-cli', 'same'),
    makeFile('codex-cli', 'same', { sameFile: ['claude-cli'], path: FILE_NAMES['claude-cli'] }),
    makeFile('pi-cli', 'same'),
    makeFile('opencode-cli', 'same'),
    makeFile('antigravity-cli', 'same'),
  ];
  setupBase('- Shared.\n', sharedFiles);
  rendered = baseCard(sharedFiles) as unknown as FakeNode;
  const sharedFold = findById(rendered, 'base-matching')!;
  assert.equal(textOf(findNode(sharedFold, el => el.tag === 'summary')), '6 tools match the base');
  assert.equal(findAll(sharedFold, el => el.className.split(/\s+/).includes('base-tool')).length, 5);
  const pill = findNode(rendered, el => el.className.split(/\s+/).includes('ins-missing'));
  assert.equal(textOf(pill), 'In 6 tools');
});

test('five matching plus one edited keeps the edited choice unfolded and folds only the five matching', () => {
  const files = ALL_TOOLS.map(tool => makeFile(tool, tool === 'codex-cli' ? 'edited' : 'same'));
  setupBase('- Shared.\n', files);
  rendered = baseCard(files) as unknown as FakeNode;

  const fold = findById(rendered, 'base-matching')!;
  assert.ok(fold);
  assert.equal(textOf(findNode(fold, el => el.tag === 'summary')), '5 tools match the base');
  assert.equal(findAll(fold, el => el.className.split(/\s+/).includes('base-tool')).length, 5);
  // Edited choice stays outside the fold and directly focusable by id.
  const diffBtn = findById(rendered, 'base-diff-codex-cli');
  assert.ok(diffBtn, 'edited diff button is present');
  assert.equal(findById(fold, 'base-diff-codex-cli'), undefined, 'edited row is outside the fold');
  assert.ok(findById(rendered, 'base-usecopy-codex-cli'));
  assert.ok(findById(rendered, 'base-restore-codex-cli'));
});

test('older and missing files stay unfolded while matching tools fold', () => {
  const files = [
    makeFile('claude-cli', 'same'),
    makeFile('copilot-cli', 'older'),
    makeFile('codex-cli', 'missing', { exists: false }),
    makeFile('pi-cli', 'missing', { exists: true }),
  ];
  setupBase('- Shared.\n', files);
  rendered = baseCard(files) as unknown as FakeNode;

  const fold = findById(rendered, 'base-matching')!;
  assert.ok(fold);
  assert.equal(textOf(findNode(fold, el => el.tag === 'summary')), '1 tool matches the base');
  assert.equal(findAll(fold, el => el.className.split(/\s+/).includes('base-tool')).length, 1);
  const allRows = findAll(rendered, el => el.className.split(/\s+/).includes('base-tool'));
  assert.equal(allRows.length, 4);
  const outsideText = textOf(rendered).replace(textOf(fold), '');
  assert.match(outsideText, /Has an older version/);
  assert.match(outsideText, /No file yet/);
  assert.match(outsideText, /Not in the file yet/);
});

test('baseStrip drops "matches the base" without a trailing comma and keeps non-matching states', () => {
  const sameFile = makeFile('claude-cli', 'same');
  const editedFile = makeFile('codex-cli', 'edited');
  const olderFile = makeFile('copilot-cli', 'older');
  const unchosenFile = makeFile('pi-cli', 'same', { base: { chosen: false, state: 'same', own: 'Own.\n', copy: '- Shared.\n', leftPlain: false } });
  setupBase('- Shared.\n', [sameFile, editedFile, olderFile, unchosenFile]);

  const sameText = textOf(baseStrip(sameFile));
  assert.doesNotMatch(sameText, /matches the base/);
  assert.match(sameText, /Then the base instructions · 1 lineShow$/);
  assert.doesNotMatch(sameText, /1 line,/);

  assert.match(textOf(baseStrip(editedFile)), /1 line, edited in this file/);
  assert.match(textOf(baseStrip(olderFile)), /1 line, an older version/);
  assert.match(textOf(baseStrip(unchosenFile)), /1 line, not on the base list; left as it is/);
});

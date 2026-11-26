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

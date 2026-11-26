// Instructions page and tool card (instructionspage.ts): removes the standing phrases ("Only that tool reads these.",
// "shown as they are, not changed here", "matches the base", and strip.about) while keeping the run warning, Codex trust
// note, Copilot prompt note, and T1.23's three-sentence runnable (?) card visible and clear of warnings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InstructionFile } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { userAgent: 'Linux', byId: id => findById(rendered, id) ?? null });

const { state: app } = await import('../src/app.ts');
const { instructionCard, instructionsPage } = await import('../src/instructionspage.ts');

const findAll = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) findAll(child, match, out);
  return out;
};

test('Instructions page removes standing prose while keeping run warning, trust/prompt notes, and T1.23 runnable card', () => {
  const claude: InstructionFile = {
    tool: 'claude-cli',
    path: '/home/.claude/CLAUDE.md',
    exists: true,
    text: '# Claude\n',
    hash: 'h1',
    readers: 'Claude Code',
    notes: [],
    nextStep: 'Start a new session.',
    versions: [],
    sameFile: [],
    base: { chosen: true, state: 'same', own: '# Claude\n', copy: '- Shared.\n', leftPlain: false },
    parts: [{ path: '/home/.claude/rules/style.md', from: 'a rule', text: 'Be brief.\n' }],
    ownHooks: [{ declaredIn: '/home/.claude/settings.json', event: 'SessionStart', at: 0, launch: { shell: 'echo hi' } }],
  };
  const codex: InstructionFile = {
    tool: 'codex-cli',
    path: '/home/.codex/AGENTS.md',
    exists: true,
    text: '# Codex\n',
    hash: 'h2',
    readers: 'Codex',
    notes: [],
    nextStep: 'Start a new session.',
    versions: [],
    sameFile: [],
    ownHooks: [{ declaredIn: '/home/.codex/hooks.json', event: 'SessionStart', at: 0, launch: { shell: 'echo hi' } }],
  };
  const copilot: InstructionFile = {
    tool: 'copilot-cli',
    path: '/home/.copilot/copilot-instructions.md',
    exists: true,
    text: '# Copilot\n',
    hash: 'h3',
    readers: 'Copilot CLI',
    notes: [],
    nextStep: 'Start a new session.',
    versions: [],
    sameFile: [],
    ownHooks: [{ declaredIn: '/home/.copilot/hooks/p.json', event: 'userPromptSubmitted', at: 0, launch: { shell: 'echo p' } }],
  };
  const pi: InstructionFile = {
    tool: 'pi-cli',
    path: '/home/.pi/agent/AGENTS.md',
    exists: true,
    text: '# Pi\n',
    hash: 'h4',
    readers: 'Pi',
    notes: [],
    nextStep: 'Start a new session.',
    versions: [],
    sameFile: [],
    extensions: ['npm:@example/pi-tools@1.0.0'],
  };
  app.home = {
    home: '/home',
    mode: 'actual',
    snapshots: [
      { harness: 'claude-cli', detection: 'Installed', probe: { version: '2.1.330', detail: '' } },
      { harness: 'codex-cli', detection: 'Installed', probe: { version: '0.171.0', detail: '' } },
      { harness: 'copilot-cli', detection: 'Installed', probe: { version: '1.0.114', detail: '' } },
      { harness: 'pi-cli', detection: 'Installed', probe: { version: '1.6.0', detail: '' } },
    ],
    sync: { access: { allowed: true }, gate: { state: 'ready' }, managed: ['claude-cli', 'codex-cli', 'copilot-cli', 'pi-cli'] },
    pluginItems: [],
  } as never;
  app.page = 'instructions';
  app.base = { path: '/home/.central-knot/instructions/base.md', text: '- Shared.\n', hash: 'b1', tools: ['claude-cli'], versions: [], drafters: [] };
  app.instructions = { state: 'ready', data: [claude, codex, copilot, pi], gen: 1 };

  rendered = instructionsPage() as unknown as FakeNode;
  const pageText = textOf(rendered);

  assert.doesNotMatch(pageText, /Only that tool reads these\./);
  assert.doesNotMatch(pageText, /shown as they are, not changed here/);
  const stripText = textOf(findNode(rendered, el => el.className.split(/\s+/).includes('base-strip')));
  assert.doesNotMatch(stripText, /matches the base/);
  assert.equal(findAll(rendered, el => el.className.split(/\s+/).includes('session-about')).length, 0);
  assert.equal(findAll(rendered, el => el.className.split(/\s+/).includes('ins-section-note')).length, 0);

  // Run warning, Codex trust note, Copilot prompt note, and T1.23 three-sentence card stay visible.
  assert.match(pageText, /Run it runs the command for real\. It may change your files\./);
  assert.match(pageText, /Codex: Run it runs a hook even if it isn’t trusted in \/hooks\./);
  assert.match(pageText, /Copilot CLI ignores what prompt hooks print\./);
  const infoCard = findById(rendered, 'session-hooks-info-card');
  assert.equal(
    textOf(infoCard),
    'Session-start and prompt hooks; not URL, MCP, project or organisation. Run it uses your home or the folder the hook names. Plugin hooks can change their installed files and data.',
  );
  // The runnable strip's info mark sits inside a data-info-block that also encloses the warning, so the card clears it.
  const headBlock = findNode(rendered, el => 'data-info-block' in el.attrs && !!findById(el, 'session-hooks-info'));
  assert.ok(headBlock, 'hooks info mark sits in a data-info-block');
  assert.ok(findNode(headBlock, el => el.className.split(/\s+/).includes('session-run-warn')), 'data-info-block encloses the run warning');

  // Shared card (as Harnesses' Instructions tab renders it) also drops the removed phrases.
  const harnessCard = instructionCard(claude, { titled: false }) as unknown as FakeNode;
  const harnessCardText = textOf(harnessCard);
  assert.doesNotMatch(harnessCardText, /shown as they are, not changed here/);
  assert.doesNotMatch(harnessCardText, /matches the base/);
  assert.equal(findAll(harnessCard, el => el.className.split(/\s+/).includes('session-about')).length, 0);
});

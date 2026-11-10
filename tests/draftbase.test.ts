import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyBase, baseView, instructionsView, undoBase } from '../src/instructions.ts';
import { draftCommand, draftPrompt, draftSources, draftTools, parseDraft, writeDraft } from '../src/draftbase.ts';
import { linesNotCarried, splitBase, withBase } from '../src/basetext.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-draft-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const snapshots = () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness })));
  const seen = async () => Object.fromEntries((await instructionsView(context, await snapshots())).map(file => [file.tool, { path: file.path, hash: file.hash }]));
  /** A stand-in for a tool's CLI: a script that reads the prompt and answers as `body` (shell) says. */
  const cli = async (name: string, body: string) => {
    const path = join(base, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  };
  return { base, home, context, snapshots, seen, cli, file: (path: string) => join(home, path), cleanup: () => rm(base, { recursive: true, force: true }) };
}

const answer = (base: string, own: Record<string, string>) => [`<<<CENTRAL KNOT: base>>>`, base, ...Object.entries(own).flatMap(([tool, text]) => [`<<<CENTRAL KNOT: ${tool}>>>`, text]), '<<<CENTRAL KNOT: end>>>'].join('\n');

test('A tool’s answer is read by its marker lines, whatever it says around them; a cut-short or incomplete answer is no draft', () => {
  const sorted = parseDraft(`Here you go:\n\`\`\`\n${answer('\n# Shared\n- Be brief.\n\n', { 'claude-cli': '', 'codex-cli': '\n- Codex only.\n' })}\n\`\`\`\nHope that helps.`, ['claude-cli', 'codex-cli']);
  assert.deepEqual(sorted, { base: '# Shared\n- Be brief.\n', own: { 'claude-cli': '', 'codex-cli': '- Codex only.\n' } });
  // Windows line breaks and loosely typed markers read the same.
  assert.deepEqual(parseDraft('<<< central knot: BASE >>>\r\nShared.\r\n<<<CENTRAL KNOT: claude-cli>>>\r\n  indented stays\r\n<<<CENTRAL KNOT: end>>>\r\n', ['claude-cli']), { base: 'Shared.\n', own: { 'claude-cli': '  indented stays\n' } });
  // No end marker: the answer stopped part-way, so a part may be missing its last lines.
  assert.deepEqual(parseDraft('<<<CENTRAL KNOT: base>>>\nShared.\n<<<CENTRAL KNOT: claude-cli>>>\nMine', ['claude-cli']), { problem: 'cut short' });
  assert.deepEqual(parseDraft(answer('', { 'claude-cli': 'Mine.' }), ['claude-cli']), { problem: 'no base' });
  // A tool's part left out would save as "nothing of its own" and empty that file's own text: no draft instead.
  assert.deepEqual(parseDraft(answer('Shared.', { 'claude-cli': 'Mine.' }), ['claude-cli', 'codex-cli']), { problem: 'left out', tool: 'codex-cli' });
  // A part for a tool that was never asked about comes from no file, so it is kept nowhere.
  assert.deepEqual(parseDraft(answer('Shared.', { 'pi-cli': 'Stray.', 'claude-cli': 'Mine.' }), ['claude-cli']), { base: 'Shared.\n', own: { 'claude-cli': 'Mine.\n' } });
});

test('The prompt gives each file’s own text and the base as it is, and asks for exactly the parts it will read back', () => {
  const prompt = draftPrompt({ base: 'Old base.\n', baseHash: 'x', files: [{ tool: 'claude-cli', path: '/h/.claude/CLAUDE.md', hash: 'a', own: 'Be brief.\nUse the Task tool.' }, { tool: 'codex-cli', path: '/h/.codex/AGENTS.md', hash: 'b', own: 'Be brief.\n' }] });
  assert.ok(prompt.includes('<<<FILE: the base instructions as they are now>>>\nOld base.\n<<<END OF FILE>>>'));
  assert.ok(prompt.includes('<<<FILE: claude-cli, Claude Code’s CLAUDE.md>>>\nBe brief.\nUse the Task tool.\n<<<END OF FILE>>>'));
  assert.ok(prompt.includes('<<<FILE: codex-cli, Codex’s AGENTS.md>>>\nBe brief.\n<<<END OF FILE>>>'));
  // The form it asks for parses as a draft with those two tools' parts.
  const form = prompt.slice(prompt.indexOf('<<<CENTRAL KNOT: base>>>'));
  assert.deepEqual(Object.keys((parseDraft(form, ['claude-cli', 'codex-cli']) as { own: object }).own), ['claude-cli', 'codex-cli']);
  // With no base yet, nothing is said about one.
  assert.ok(!draftPrompt({ base: '', baseHash: '', files: [{ tool: 'pi-cli', path: '/h/.pi/agent/AGENTS.md', hash: 'c', own: 'x' }] }).includes('as they are now'));
});

test('Each tool is run for one answer: prompt on standard input, its own tools off where it has that switch, no session kept', () => {
  assert.deepEqual(draftCommand('claude-cli', '/t/a.md'), { args: ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence'], answer: 'output' });
  assert.deepEqual(draftCommand('codex-cli', '/t/a.md'), { args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-o', '/t/a.md', '-'], answer: 'file' });
  assert.deepEqual(draftCommand('copilot-cli', '/t/a.md'), { args: ['-s', '--no-color', '--no-ask-user'], answer: 'output' });
  assert.deepEqual(draftCommand('pi-cli', '/t/a.md'), { args: ['-p', '--no-tools', '--no-session'], answer: 'output' });
});

test('A draft sorts the files with instructions of their own, and saving it sets the base and each file’s own text in one step that Undo puts back', async () => {
  const box = await sandbox();
  const claude = box.file('.claude/CLAUDE.md'), codex = box.file('.codex/AGENTS.md'), copilot = box.file('.copilot/copilot-instructions.md');
  try {
    await writeFile(claude, '# Style\nBe brief.\n\n# Claude\nUse the Task tool.\n');
    await writeFile(codex, 'Be brief.\nRun codex review before pushing.\n');
    const sources = await draftSources(box.context, await box.snapshots());
    // Copilot CLI has no file: nothing of its own to sort, so the tool is not given it (it still gets the base when saved).
    assert.deepEqual(sources.files.map(file => [file.tool, file.own]), [['claude-cli', '# Style\nBe brief.\n\n# Claude\nUse the Task tool.\n'], ['codex-cli', 'Be brief.\nRun codex review before pushing.\n']]);

    // The stand-in keeps what it was sent, and answers through standard output, in an empty folder of its own.
    const got = join(box.base, 'got');
    const binary = await box.cli('claude', `cat > '${got}'\necho "$*" > '${got}.args'\npwd > '${got}.cwd'\nls -A > '${got}.ls'\ncat <<'EOF'\n${answer('# Style\nBe brief.', { 'claude-cli': '# Claude\nUse the Task tool.', 'codex-cli': 'Run codex review before pushing.' })}\nEOF`);
    const { draft } = await writeDraft(sources, 'claude-cli', binary);
    assert.equal(await readFile(got, 'utf8'), draftPrompt(sources));
    assert.equal((await readFile(`${got}.args`, 'utf8')).trim(), '-p --tools  --strict-mcp-config --no-session-persistence');
    assert.equal((await readFile(`${got}.ls`, 'utf8')).trim(), '');
    // That folder goes once the tool has answered.
    await assert.rejects(readdir((await readFile(`${got}.cwd`, 'utf8')).trim()));
    assert.deepEqual(draft, { by: 'claude-cli', base: '# Style\nBe brief.\n', own: { 'claude-cli': '# Claude\nUse the Task tool.\n', 'codex-cli': 'Run codex review before pushing.\n' },
      read: Object.fromEntries(sources.files.map(file => [file.tool, file.hash])), baseHash: '' });
    // Writing the draft wrote nothing in the home.
    assert.equal(await readFile(claude, 'utf8'), '# Style\nBe brief.\n\n# Claude\nUse the Task tool.\n');
    assert.equal((await baseView(box.context)).text, '');

    // Saved as reviewed: each sorted file holds what the draft kept for it, then the base; the file with nothing gets the base alone.
    const saved = await applyBase(box.context, await box.snapshots(), { text: draft!.base, expected: draft!.baseHash, seen: await box.seen(), tools, own: draft!.own });
    assert.deepEqual([saved.left, saved.written.map(entry => entry.tool)], [[], tools]);
    assert.deepEqual(splitBase(await readFile(claude, 'utf8')), { own: '# Claude\nUse the Task tool.\n', copy: '# Style\nBe brief.\n' });
    assert.deepEqual(splitBase(await readFile(codex, 'utf8')), { own: 'Run codex review before pushing.\n', copy: '# Style\nBe brief.\n' });
    assert.deepEqual(splitBase(await readFile(copilot, 'utf8')), { own: '', copy: '# Style\nBe brief.\n' });
    // What each file held before is among its earlier versions.
    const view = await instructionsView(box.context, await box.snapshots());
    assert.deepEqual(view.map(file => file.versions.length), [1, 0, 1]);

    // Undo: every file as it was, byte for byte, and the file the save created gone.
    const undone = await undoBase(box.context, await box.snapshots(), saved.undo!);
    assert.equal(undone.written.length, 3);
    assert.equal(await readFile(claude, 'utf8'), '# Style\nBe brief.\n\n# Claude\nUse the Task tool.\n');
    assert.equal(await readFile(codex, 'utf8'), 'Be brief.\nRun codex review before pushing.\n');
    await assert.rejects(readFile(copilot, 'utf8'));
    assert.equal((await baseView(box.context)).text, '');
  } finally { await box.cleanup(); }
});

test('A draft changes only the tools ticked for the base, leaves a copy edited in a file alone, and sorts only what is outside the base block', async () => {
  const box = await sandbox();
  const claude = box.file('.claude/CLAUDE.md'), codex = box.file('.codex/AGENTS.md'), copilot = box.file('.copilot/copilot-instructions.md');
  try {
    await writeFile(claude, 'Be brief.\nClaude only.\n');
    await writeFile(codex, 'Be brief.\nCodex only.\n');
    // Not ticked: Codex's file stays byte for byte, its own text included, though the draft sorted it.
    const first = await applyBase(box.context, await box.snapshots(), { text: 'Be brief.\n', expected: '', seen: await box.seen(), tools: ['claude-cli', 'copilot-cli'], own: { 'claude-cli': 'Claude only.\n', 'codex-cli': 'Codex only.\n' } });
    assert.deepEqual(first.written.map(entry => entry.tool), ['claude-cli', 'copilot-cli']);
    assert.equal(await readFile(codex, 'utf8'), 'Be brief.\nCodex only.\n');
    assert.deepEqual(splitBase(await readFile(claude, 'utf8')), { own: 'Claude only.\n', copy: 'Be brief.\n' });

    // A later draft is given each file's own text only, never its base block; and Copilot CLI's copy, edited in its file, keeps
    // that file out of the draft and untouched by the save.
    await writeFile(copilot, withBase('', 'Be brief, mostly.\n'));
    const sources = await draftSources(box.context, await box.snapshots());
    assert.deepEqual(sources.files.map(file => [file.tool, file.own]), [['claude-cli', 'Claude only.\n'], ['codex-cli', 'Be brief.\nCodex only.\n']]);
    assert.equal(sources.base, 'Be brief.\n');
    const before = await readFile(copilot, 'utf8');
    const second = await applyBase(box.context, await box.snapshots(), { text: 'Be brief.\nBe kind.\n', expected: sources.baseHash, seen: await box.seen(), tools, own: { 'claude-cli': '', 'codex-cli': 'Codex only.\n' } });
    assert.deepEqual(second.left, [{ tool: 'copilot-cli', why: 'edited' }]);
    assert.equal(await readFile(copilot, 'utf8'), before);
    // Nothing kept only for Claude Code: its file holds the base alone.
    assert.deepEqual(splitBase(await readFile(claude, 'utf8')), { own: '', copy: 'Be brief.\nBe kind.\n' });
    assert.deepEqual(splitBase(await readFile(codex, 'utf8')), { own: 'Codex only.\n', copy: 'Be brief.\nBe kind.\n' });
  } finally { await box.cleanup(); }
});

test('A tool that fails, answers out of form, takes too long or is stopped gives no draft, says why in its own words, and leaves nothing behind', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.file('.claude/CLAUDE.md'), 'Be brief.\n');
    const sources = await draftSources(box.context, await box.snapshots());
    // Not signed in: it exits before reading the prompt, and what it said is passed on.
    const signedOut = await writeDraft(sources, 'claude-cli', await box.cli('signed-out', 'echo "Not logged in · Please run /login" >&2\nexit 1'));
    assert.equal(signedOut.stopped, 'Claude Code could not write a draft: “Not logged in · Please run /login”. Nothing was changed.');
    const chatty = await writeDraft(sources, 'codex-cli', await box.cli('chatty', 'cat > /dev/null\necho "Sure! Here are some thoughts."'));
    assert.equal(chatty.stopped, 'Codex answered, but its answer stopped before the end, so there is no draft. Nothing was changed. Try again, or have another tool write it.');
    // Codex's answer is the file it is told to write, not what it prints while working.
    const codex = await box.cli('codex', `cat > /dev/null\necho "working…"\nfor last; do :; done\nprev=""\nfor arg; do [ "$prev" = "-o" ] && out="$arg"; prev="$arg"; done\ncat > "$out" <<'EOF'\n${answer('Be brief.', { 'claude-cli': '' })}\nEOF`);
    assert.deepEqual((await writeDraft(sources, 'codex-cli', codex)).draft?.own, { 'claude-cli': '' });
    const slow = await box.cli('slow', 'cat > /dev/null\nsleep 30');
    const started = Date.now();
    assert.equal((await writeDraft(sources, 'pi-cli', slow, { timeoutMs: 300 })).stopped, 'Pi did not finish a draft in time, so it was stopped. Nothing was changed.');
    const stopping = new AbortController();
    setTimeout(() => stopping.abort(), 200);
    assert.deepEqual(await writeDraft(sources, 'pi-cli', slow, { signal: stopping.signal }), { cancelled: true });
    assert.ok(Date.now() - started < 10_000);
    assert.equal((await writeDraft(sources, 'copilot-cli', join(box.base, 'not-there'))).stopped, 'Copilot CLI could not be started, so there is no draft. Nothing was changed.');
    // Nothing to sort: no tool is run at all.
    assert.equal((await writeDraft({ base: '', baseHash: '', files: [] }, 'claude-cli', join(box.base, 'not-there'))).stopped, 'No tool’s file has instructions of its own, so there is nothing to draft from.');
    assert.equal(await readFile(box.file('.claude/CLAUDE.md'), 'utf8'), 'Be brief.\n');
    assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('central-knot-draft-')), []);
  } finally { await box.cleanup(); }
});

test('The tools that can write a draft are those with a CLI on this computer', async () => {
  const box = await sandbox();
  try {
    await mkdir(box.file('.local/bin'), { recursive: true });
    for (const name of ['claude', 'pi']) { await writeFile(box.file(`.local/bin/${name}`), '#!/bin/sh\n'); await chmod(box.file(`.local/bin/${name}`), 0o755); }
    // A file that can't be run is no CLI.
    await writeFile(box.file('.local/bin/codex'), '#!/bin/sh\n');
    const found = await draftTools(box.home, '');
    assert.deepEqual(Object.keys(found).filter(tool => found[tool as HarnessId]!.startsWith(box.home)), ['claude-cli', 'pi-cli']);
  } finally { await box.cleanup(); }
});

test('A file’s lines a draft carries nowhere word for word are found, whichever part would have held them', () => {
  assert.deepEqual(linesNotCarried('# Style\nBe brief.\n\nUse the Task tool.\n  Indented counts the same.\nDropped line.\n', '# Style\nBe brief.\n', 'Use the Task tool.\nIndented counts the same.\n'), ['Dropped line.']);
  assert.deepEqual(linesNotCarried('Be brief.\n', 'Be brief.\n', ''), []);
  // A heading the draft dropped or renamed is not an instruction lost.
  assert.deepEqual(linesNotCarried('# How I work\nBe brief.\n## Git\nNever push to main.\n', '# Style\nBe brief.\n', ''), ['Never push to main.']);
});

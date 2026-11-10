import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { harnessIds } from '../src/harnesses.ts';
import { applyChanges, manageView } from '../src/manage.ts';
import type { ShareContext } from '../src/share.ts';

const text = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`;
const exists = (path: string) => lstat(path).then(() => true, () => false);
const put = async (path: string, content: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); };

test('a tool that has a skill through an installed plugin is shown as that, and gets no separate copy', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-skills-')));
  const home = join(base, 'home');
  try {
    // Pi has the skill as its own item (as a plugin's parts leave it); Copilot CLI is here with nothing.
    await put(join(home, '.pi/agent/skills/triage/SKILL.md'), text('triage'));
    await put(join(home, '.pi/agent/skills/notes/SKILL.md'), text('notes'));
    await mkdir(join(home, '.copilot'), { recursive: true });
    // Claude Code has the plugin: its copy holds `triage` and `notes`, and Claude Code also has its own copy of `notes`.
    const copy = join(home, '.claude/plugins/cache/team/issue-tracker/1.2.0');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'issue-tracker', version: '1.2.0' }));
    await put(join(copy, 'skills/triage/SKILL.md'), text('triage'));
    await put(join(copy, 'skills/notes/SKILL.md'), text('notes'));
    await put(join(home, '.claude/skills/notes/SKILL.md'), text('notes'));
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'issue-tracker@team': [{ scope: 'user', installPath: copy, version: '1.2.0' }] } }));
    const read = () => Promise.all(harnessIds.map(harness => discover({ home, mode: 'custom', harness })));
    const context: ShareContext = { home, mode: 'custom', read, build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };

    const facts = (await manageView(context)).skills;
    const triage = facts.find(skill => skill.key === 'triage')!;
    assert.deepEqual(triage.plugin, { 'claude-cli': { plugin: 'issue-tracker', marketplace: 'team', version: '1.2.0' } });
    assert.match(triage.cannot['claude-cli'] ?? '', /^Claude Code has this skill through the plugin issue-tracker \(version 1\.2\.0\), so no separate copy is placed there\.$/);
    // A copy of its own is an ordinary copy, whatever a plugin also holds.
    assert.equal(facts.find(skill => skill.key === 'notes')!.plugin, undefined);

    // Managed: the tool without it gets a copy; the tool with the plugin gets none beside it.
    const result = await applyChanges(context, [{ key: 'triage', managed: true, off: [] }]);
    assert.equal(result.stopped, undefined);
    assert.deepEqual([await exists(join(home, '.copilot/skills/triage/SKILL.md')), await exists(join(home, '.claude/skills/triage'))], [true, false]);

    // The plugin turned off in Claude Code still holds the skill there: said so, and still no separate copy.
    await put(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'issue-tracker@team': false } }));
    const off = (await manageView(context)).skills.find(skill => skill.key === 'triage')!;
    assert.equal(off.plugin?.['claude-cli']?.off, true);
    assert.match(off.cannot['claude-cli'] ?? '', /turned off there/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

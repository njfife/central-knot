// Worked examples of turning native paths into the `/` form shown to a person or compared as text (machine.ts displayPath,
// shownFromHome), and the POSIX parity proof that macOS and Linux keep every `\` inside a file or folder name unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentsView } from '../src/agents.ts';
import { agentsAt, pluginItems, skillsAt } from '../src/atlink.ts';
import { pluginContents, pluginFiles } from '../src/catalogdetail.ts';
import { discover } from '../src/discovery.ts';
import { displayPath, shownFromHome } from '../src/machine.ts';
import { readPluginItems } from '../src/pluginitems.ts';
import { libraryDocs } from '../src/searchdocs.ts';
import { serversView } from '../src/servers.ts';
import { readTree, type ShareContext } from '../src/share.ts';
import { pathWords, skillsView } from '../src/skills.ts';
import { isDisabled, readSwitchFile } from '../src/skillswitch.ts';
import type { HomeView } from '../src/types.ts';

const put = async (path: string, body: string) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body);
};

test('displayPath turns native backslashes into / on Windows and keeps its argument unchanged on macOS and Linux', () => {
  assert.equal(displayPath('a\\b\\c.md', 'win32'), 'a/b/c.md');
  assert.equal(displayPath('C:\\Users\\x', 'win32'), 'C:/Users/x');
  assert.equal(displayPath('C:\\Users\\x\\.agents\\skills', 'win32'), 'C:/Users/x/.agents/skills');
  assert.equal(displayPath('already/slash.md', 'win32'), 'already/slash.md');
  assert.equal(displayPath('', 'win32'), '');
  for (const platform of ['linux', 'darwin'] as const) {
    assert.equal(displayPath('a\\b\\c.md', platform), 'a\\b\\c.md', platform);
    assert.equal(displayPath('folder/file\\name.md', platform), 'folder/file\\name.md', platform);
    assert.equal(displayPath('C:\\Users\\x', platform), 'C:\\Users\\x', platform);
  }
});

test('shownFromHome shortens the home itself and paths under it with the platform separator and uses / on Windows (app.ts shownPath)', () => {
  assert.equal(shownFromHome('C:\\Users\\x\\.agents\\skills', { home: 'C:\\Users\\x', mode: 'actual' }, 'win32'), '~/.agents/skills');
  assert.equal(shownFromHome('C:\\Users\\x\\.central-knot\\history.json', { home: 'C:\\Users\\x', mode: 'actual' }, 'win32'), '~/.central-knot/history.json');
  assert.equal(shownFromHome('C:\\Users\\x', { home: 'C:\\Users\\x', mode: 'actual' }, 'win32'), '~');
  assert.equal(shownFromHome('C:\\Temp\\home\\.claude\\skills\\notes', { home: 'C:\\Temp\\home', mode: 'custom' }, 'win32'), '…/.claude/skills/notes');
  assert.equal(shownFromHome('C:\\Temp\\practice', { home: 'C:\\Temp\\practice', mode: 'fixture' }, 'win32'), '…');
  // A sibling folder whose name starts with home's name is not under home; outside paths still show with /.
  assert.equal(shownFromHome('C:\\Users\\x2\\notes', { home: 'C:\\Users\\x', mode: 'actual' }, 'win32'), 'C:/Users/x2/notes');
  assert.equal(shownFromHome('D:\\team\\skills\\notes', { home: 'C:\\Users\\x', mode: 'actual' }, 'win32'), 'D:/team/skills/notes');
  assert.equal(shownFromHome('C:\\Users\\x\\notes', undefined, 'win32'), 'C:/Users/x/notes');

  // Recorded from running next (7915120) app.ts shownPath on Linux: POSIX paths keep any \ in a file name unchanged.
  for (const platform of ['linux', 'darwin'] as const) {
    assert.equal(shownFromHome('/home/u/dir/a\\b.md', { home: '/home/u', mode: 'actual' }, platform), '~/dir/a\\b.md', platform);
    assert.equal(shownFromHome('/home/u/dir/a\\b.md', { home: '/home/u', mode: 'custom' }, platform), '…/dir/a\\b.md', platform);
    assert.equal(shownFromHome('/home/u', { home: '/home/u', mode: 'actual' }, platform), '~', platform);
    assert.equal(shownFromHome('/other/a\\b.md', { home: '/home/u', mode: 'actual' }, platform), '/other/a\\b.md', platform);
    assert.equal(shownFromHome('/home/u2/a\\b.md', { home: '/home/u', mode: 'actual' }, platform), '/home/u2/a\\b.md', platform);
    assert.equal(shownFromHome('/other/a\\b.md', undefined, platform), '/other/a\\b.md', platform);
  }
});

test('skills.ts pathWords shortens only paths under home with the platform separator and keeps the home itself as its full path', () => {
  assert.equal(pathWords({ home: 'C:\\Users\\x', mode: 'actual' }, 'C:\\Users\\x\\.agents\\skills', 'win32'), '~/.agents/skills');
  assert.equal(pathWords({ home: 'C:\\Temp\\home', mode: 'custom' }, 'C:\\Temp\\home\\.claude\\skills\\notes', 'win32'), '…/.claude/skills/notes');
  assert.equal(pathWords({ home: 'C:\\Users\\x', mode: 'actual' }, 'C:\\Users\\x', 'win32'), 'C:/Users/x');
  assert.equal(pathWords({ home: 'C:\\Users\\x', mode: 'actual' }, 'C:\\Users\\x2\\notes', 'win32'), 'C:/Users/x2/notes');
  assert.equal(pathWords({ home: 'C:\\Users\\x', mode: 'actual' }, 'D:\\team\\skills\\notes', 'win32'), 'D:/team/skills/notes');

  // Recorded from running next (d4ac5835) skills.ts pathWords on Linux: the home itself is not shortened to ~ or ….
  for (const platform of ['linux', 'darwin'] as const) {
    assert.equal(pathWords({ home: '/home/u', mode: 'actual' }, '/home/u', platform), '/home/u', platform);
    assert.equal(pathWords({ home: '/home/u', mode: 'custom' }, '/home/u', platform), '/home/u', platform);
    assert.equal(pathWords({ home: '/home/u', mode: 'actual' }, '/home/u/dir/a\\b.md', platform), '~/dir/a\\b.md', platform);
    assert.equal(pathWords({ home: '/home/u', mode: 'custom' }, '/home/u/dir/a\\b.md', platform), '…/dir/a\\b.md', platform);
    assert.equal(pathWords({ home: '/home/u', mode: 'actual' }, '/other/a\\b.md', platform), '/other/a\\b.md', platform);
  }
});

test(
  'On POSIX, every changed place keeps a backslash in a file or folder name identical to next',
  { skip: process.platform === 'win32' && 'Backslash is a path separator on Windows, not a filename character; covered on macOS and Linux.' },
  async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-posix-backslash-')));
    try {
      // 1. skills.ts pathWords (via skillsView): link target whose folder name contains \.
      for (const [mode, expected] of [
        ['actual', 'Claude Code has it through a link in its skills folder (to ~/mine/a\\b), which is not Central Knot’s copy.'],
        ['custom', 'Claude Code has it through a link in its skills folder (to …/mine/a\\b), which is not Central Knot’s copy.'],
      ] as const) {
        const home = join(base, `skills-${mode}`);
        await mkdir(join(home, '.claude/skills'), { recursive: true });
        await put(join(home, 'mine', 'a\\b', 'SKILL.md'), '---\nname: notes\ndescription: D.\n---\nBody.\n');
        await symlink(join(home, 'mine', 'a\\b'), join(home, '.claude/skills/notes'));
        const context: ShareContext = {
          home, mode,
          read: () => Promise.all((['claude-cli'] as const).map(harness => discover({ home, mode, harness }))),
          build: 'test', settingsPath: join(base, `settings-${mode}.json`), realHome: home, settleMs: 0,
        };
        const view = await skillsView(context, ['claude-cli']);
        assert.equal(view.items.find(item => item.key === 'notes')?.anotherWay?.['claude-cli'], expected, `skills pathWords (${mode})`);
      }
      // 1b. skills.ts pathWords on the home itself (link resolving to home): next leaves the full home path (unlike app.ts shownPath).
      for (const mode of ['actual', 'custom'] as const) {
        const home = join(base, `skills-root-${mode}`);
        await mkdir(join(home, '.claude/skills'), { recursive: true });
        await put(join(home, '.copilot/skills/notes/SKILL.md'), '---\nname: notes\ndescription: D.\n---\nBody.\n');
        await symlink('../..', join(home, '.claude/skills/notes'));
        const context: ShareContext = {
          home, mode,
          read: () => Promise.all((['claude-cli', 'copilot-cli'] as const).map(harness => discover({ home, mode, harness }))),
          build: 'test', settingsPath: join(base, `settings-root-${mode}.json`), realHome: home, settleMs: 0,
        };
        const view = await skillsView(context, ['claude-cli', 'copilot-cli']);
        assert.equal(
          view.items.find(item => item.key === 'notes')?.anotherWay?.['claude-cli'],
          `Claude Code has it through a link in its skills folder (to ${home}), which is not Central Knot’s copy.`,
          `skills pathWords on home itself (${mode})`,
        );
      }

      // 2. atlink.ts: skillsAt, agentsAt and pluginItems.
      const repo = join(base, 'atlink-repo');
      await put(join(repo, 'skills', 'dir\\skill', 'SKILL.md'), '---\nname: clean\ndescription: Clean.\n---\nBody.\n');
      await put(join(repo, 'agents', 'a\\b.md'), '---\nname: ab\ndescription: AB.\n---\nPrompt.\n');
      await put(join(repo, 'agents', 'bad\\agent.md'), '---\nname: [broken\n---\nBad.\n');
      const skills = await skillsAt(repo, '', 'repo');
      const agents = await agentsAt(repo, '', 'repo', skills);
      assert.deepEqual(
        skills.map(item => ({ folder: item.folder, folderName: item.folderName, files: item.files })),
        [{ folder: 'skills/dir\\skill', folderName: 'dir\\skill', files: ['SKILL.md'] }],
        'atlink skillsAt',
      );
      assert.deepEqual(
        agents.map(item => ({ folder: item.folder, folderName: item.folderName, files: item.files })),
        [
          { folder: 'agents', folderName: 'agents', files: ['a\\b.md'] },
          { folder: 'agents', folderName: 'agents', files: ['bad\\agent.md'] },
        ],
        'atlink agentsAt',
      );
      const brokenAgent = agents.find(item => 'unreadable' in item);
      assert.equal(
        brokenAgent && 'unreadable' in brokenAgent ? brokenAgent.unreadable : undefined,
        'agents/bad\\agent.md can’t be read as an agent (Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1)',
        'atlink agentsAt unreadable',
      );

      const plug = join(base, 'atlink-plugin');
      await put(join(plug, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit', skills: ['./extra/a\\b'], agents: ['./agents'] }));
      await put(join(plug, 'extra', 'a\\b', 'SKILL.md'), '---\nname: tool\ndescription: Tool.\n---\nBody.\n');
      await put(join(plug, 'agents', 'bad\\a.md'), '---\nname: [broken\n---\nBad.\n');
      const fromPlugin = await pluginItems(await pluginFiles(plug, {}, plug), plug, 'kit', 'link');
      assert.deepEqual(
        fromPlugin.skill.items.map(item => ({ folder: item.folder, folderName: item.folderName })),
        [{ folder: 'extra/a\\b', folderName: 'a\\b' }],
        'atlink pluginItems where',
      );
      const brokenPlugAgent = fromPlugin.agent.items[0];
      assert.deepEqual(
        { folder: brokenPlugAgent?.folder, files: brokenPlugAgent?.files, unreadable: brokenPlugAgent && 'unreadable' in brokenPlugAgent ? brokenPlugAgent.unreadable : undefined },
        {
          folder: 'agents',
          files: ['bad\\a.md'],
          unreadable: 'agents/bad\\a.md can’t be read as an agent (Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1)',
        },
        'atlink pluginItems shown',
      );

      // 3. searchdocs.ts: skillText via libraryDocs.
      const searchHome = join(base, 'search-home');
      await put(join(searchHome, '.claude/skills/notes/SKILL.md'), '---\nname: notes\ndescription: Notes.\n---\nBody text.\n');
      await put(join(searchHome, '.claude/skills/notes/templates', 'a\\b.md'), 'Template.');
      const searchContext: ShareContext = {
        home: searchHome, mode: 'custom',
        read: () => Promise.all((['claude-cli'] as const).map(harness => discover({ home: searchHome, mode: 'custom', harness }))),
        build: 'test', settingsPath: join(base, 'search-settings.json'), realHome: searchHome, settleMs: 0, reads: new Map(),
      };
      const searchView = {
        home: searchHome,
        skills: await skillsView(searchContext, ['claude-cli']),
        mcp: await serversView(searchContext, ['claude-cli']),
        agents: await agentsView(searchContext, ['claude-cli']),
        pluginItems: await readPluginItems({ home: searchHome, dataDir: join(base, 'data'), binaries: {}, reads: searchContext.reads }, ['claude-cli']),
      } as HomeView;
      assert.equal((await libraryDocs(searchContext, searchView)).find(doc => doc.id === 'skills-notes')?.text, 'Body text.\n\n\ntemplates/a\\b.md', 'searchdocs libraryDocs');

      // 4. catalogdetail.ts: skillsIn, markdownIn and instructionsIn.
      const cat = join(base, 'catalog');
      await put(join(cat, 'skills', 'a\\b', 'SKILL.md'), '---\nname: sk\ndescription: S.\n---\n');
      await put(join(cat, 'agents', 'a\\b.md'), '---\ndescription: A.\n---\n');
      await put(join(cat, 'commands', 'sub', 'a\\b.md'), '---\ndescription: C.\n---\n');
      await put(join(cat, 'com.github.copilot/rules', 'a\\b.md'), 'Rule.\n');
      const contents = await pluginContents(cat, {}, cat);
      assert.deepEqual(contents.skills.map(part => part.path), ['skills/a\\b'], 'catalogdetail skillsIn');
      assert.deepEqual(contents.agents.map(part => part.path), ['agents/a\\b.md'], 'catalogdetail markdownIn agents');
      assert.deepEqual(contents.commands.map(part => part.path), ['commands/sub/a\\b.md'], 'catalogdetail markdownIn commands');
      assert.deepEqual(contents.instructions.map(part => part.path), ['com.github.copilot/rules/a\\b.md'], 'catalogdetail instructionsIn');

      // 5. skillswitch.ts:287 antigravityExcludes: an exclude entry with \ must not match / on POSIX.
      const agHome = join(base, 'ag-home');
      await put(join(agHome, '.gemini/config/skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: A.\n---\n');
      const agContext: ShareContext = { home: agHome, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'ag.json'), realHome: agHome, settleMs: 0 };
      const agTarget = { folder: 'alpha', name: 'alpha', skillFile: join(agHome, '.gemini/config/skills/alpha/SKILL.md') };
      await put(join(agHome, '.gemini/config/skills.json'), JSON.stringify({ exclude: ['skills\\alpha'] }));
      assert.equal(isDisabled(agContext, await readSwitchFile(agContext, 'antigravity-cli'), agTarget), false, 'antigravity backslash entry on POSIX');
      await put(join(agHome, '.gemini/config/skills.json'), JSON.stringify({ exclude: ['skills/alpha'] }));
      assert.equal(isDisabled(agContext, await readSwitchFile(agContext, 'antigravity-cli'), agTarget), true, 'antigravity slash entry on POSIX');

      // 6. share.ts:160 readTree.
      const treeDir = join(base, 'tree');
      await put(join(treeDir, 'templates', 'a\\b.md'), 'hi');
      assert.deepEqual([...(await readTree(treeDir)).files.keys()].sort(), ['templates/a\\b.md'], 'share readTree');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);

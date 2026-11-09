import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { frontMatter, inside, marketplacePage, pluginContents, pluginDetail, readmeIn, remoteOf, sourceOf } from '../src/catalogdetail.ts';

const noLinks = process.platform === 'win32';
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
async function box() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-detail-')));
  return { base, root: join(base, 'market'), cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Front matter gives name and description, quoted, folded or literal, with Windows line ends', () => {
  assert.deepEqual(frontMatter('---\r\nname: "pdf"\r\ndescription: Reads PDFs\r\n---\r\nbody'), { name: 'pdf', description: 'Reads PDFs' });
  assert.deepEqual(frontMatter('---\nname: x\ndescription: >\n  Reads PDFs\n  and tables\n---\n'), { name: 'x', description: 'Reads PDFs and tables' });
  assert.deepEqual(frontMatter('---\ndescription: |\n  one\n  two\n---\n'), { name: undefined, description: 'one\ntwo' });
  assert.deepEqual(frontMatter('no front matter'), {});
});

test('A strict:false entry holds only the skills it lists, and listed commands too', async () => {
  const { root, cleanup } = await box();
  try {
    for (const name of ['hello', 'unlisted']) await put(join(root, `skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: Says ${name}\n---\n`);
    await put(join(root, 'tools/notes.md'), '---\ndescription: Takes notes\n---\n');
    const contents = await pluginContents(root, { source: './', strict: false, skills: ['./skills/hello'], commands: ['./tools/notes.md'] }, root);
    assert.deepEqual(contents.skills, [{ name: 'hello', description: 'Says hello' }]);
    assert.deepEqual(contents.commands, [{ name: 'notes', description: 'Takes notes' }]);
    // The plugin is the marketplace's own root: its README belongs to the marketplace and is shown there.
    await put(join(root, 'README.md'), '# Market');
    assert.equal((await pluginDetail(root, { source: './' }, root)).readme, undefined);
  } finally { await cleanup(); }
});

test('Hooks and MCP servers given as paths in plugin.json are read, and both counts and names agree', async () => {
  const { root, cleanup } = await box();
  try {
    const plugin = join(root, 'plugins/p');
    await put(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'p', hooks: './config/hooks.json', mcpServers: './config/servers.json' }));
    await put(join(plugin, 'config/hooks.json'), JSON.stringify({ hooks: { SessionStart: [], PreToolUse: [] } }));
    await put(join(plugin, 'config/servers.json'), JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', 'files-mcp', '${CLAUDE_PLUGIN_ROOT}'] } } }));
    const contents = await pluginContents(plugin, {}, root);
    assert.deepEqual(contents.hooks, ['PreToolUse', 'SessionStart']);
    assert.deepEqual(contents.mcpServers, [{ name: 'files', runs: 'npx -y files-mcp ${CLAUDE_PLUGIN_ROOT}' }]);
    assert.equal(contents.mcpUsesPluginRoot, true);
  } finally { await cleanup(); }
});

test('Nothing outside the marketplace is read, through a listed path or a link', { skip: noLinks }, async () => {
  const { base, root, cleanup } = await box();
  try {
    await put(join(base, 'private/notes.txt'), 'private');
    await put(join(base, 'private/SKILL.md'), '---\nname: leaked\n---\n');
    await mkdir(join(root, 'plugins/p/skills'), { recursive: true });
    await symlink(join(base, 'private/notes.txt'), join(root, 'plugins/p/README.md'));
    await symlink(join(base, 'private'), join(root, 'plugins/p/skills/linked'));
    assert.equal(await readmeIn(join(root, 'plugins/p'), root), undefined);
    const contents = await pluginContents(join(root, 'plugins/p'), { skills: ['../../../private'] }, root);
    assert.deepEqual(contents.skills, []);
    assert.deepEqual((await pluginContents(join(root, 'plugins/p'), {}, root)).skills, []);
    assert.equal(await inside(root, join(root, '..foo')), false);
    await mkdir(join(root, '..foo'));
    assert.equal(await inside(root, join(root, '..foo')), true, 'a folder named ..foo is still inside');
  } finally { await cleanup(); }
});

test('Only https links come back for sources and pages', () => {
  assert.deepEqual(sourceOf({ source: 'github', repo: 'example/notes', path: 'plugin' }), { label: 'GitHub · example/notes/plugin', url: 'https://github.com/example/notes/tree/HEAD/plugin' });
  assert.equal(sourceOf({ source: 'url', url: 'git@github.com:example/x.git' })?.url, undefined);
  assert.equal(sourceOf({ source: 'url', url: 'http://example.com/x.git' })?.url, undefined);
  assert.equal(remoteOf({ source: 'url', url: 'file:///etc' }), undefined);
  assert.deepEqual(remoteOf({ source: 'git-subdir', url: 'https://github.com/a/b.git', path: './plugins/x', ref: 'main' }), { url: 'https://github.com/a/b.git', path: 'plugins/x', ref: 'main', sha: undefined });
  assert.equal(marketplacePage('anthropics/skills'), 'https://github.com/anthropics/skills');
  assert.equal(marketplacePage('/Users/me/market'), undefined);
});

test('A skills path may name a folder of skills; a ref or sha that looks like an option is ignored', async () => {
  const { root, cleanup } = await box();
  try {
    for (const name of ['one', 'two']) await put(join(root, `custom/skills/${name}/SKILL.md`), `---\nname: ${name}\n---\n`);
    assert.deepEqual((await pluginContents(root, { skills: './custom/skills/' }, root)).skills.map(skill => skill.name), ['one', 'two']);
    assert.deepEqual(remoteOf({ source: 'github', repo: 'a/b', ref: '--upload-pack=x', sha: 'zz' }), { url: 'https://github.com/a/b.git', path: '', ref: undefined, sha: undefined });
  } finally { await cleanup(); }
});

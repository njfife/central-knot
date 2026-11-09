import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { inside, marketplacePage, pluginContents, readmeIn, remoteOf, sourceOf } from '../src/catalogdetail.ts';

const noLinks = process.platform === 'win32';
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
async function box() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-detail-')));
  return { base, root: join(base, 'market'), cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Paths an entry or plugin.json lists are read instead of the default folders', async () => {
  const { root, cleanup } = await box();
  try {
    for (const name of ['hello', 'unlisted']) await put(join(root, `skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: Says ${name}\n---\n`);
    await put(join(root, 'tools/notes.md'), '---\ndescription: Takes notes\n---\n');
    await put(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ version: '0.9.0', hooks: './config/hooks.json', mcpServers: './config/servers.json' }));
    await put(join(root, 'config/hooks.json'), JSON.stringify({ hooks: { SessionStart: [], PreToolUse: [] } }));
    await put(join(root, 'config/servers.json'), JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', 'files-mcp'] } } }));
    const contents = await pluginContents(root, { source: './', strict: false, version: '1.0.0', skills: ['./skills/hello'], commands: ['./tools/notes.md'] }, root);
    // Each part carries its whole file as written; the entry's version wins over plugin.json's, as the tools read it.
    assert.deepEqual(contents.skills, [{ name: 'hello', description: 'Says hello', text: '---\nname: hello\ndescription: Says hello\n---\n' }]);
    assert.deepEqual(contents.commands, [{ name: 'notes', description: 'Takes notes', text: '---\ndescription: Takes notes\n---\n' }]);
    assert.equal(contents.version, '1.0.0');
    assert.deepEqual(contents.hooks, ['PreToolUse', 'SessionStart']);
    assert.deepEqual(contents.mcpServers, [{ name: 'files', runs: 'npx -y files-mcp' }]);
  } finally { await cleanup(); }
});

test('Server and hook files are read in every shape plugins use: flat or wrapped, a list of paths, and LSP servers', async () => {
  const { root, cleanup } = await box();
  try {
    // A flat .mcp.json (servers at the top, as GitHub's plugin in the official marketplace has it).
    await put(join(root, '.mcp.json'), JSON.stringify({ github: { url: 'https://api.example/mcp' } }));
    await put(join(root, 'extra/one.json'), JSON.stringify({ mcpServers: { one: { command: '${CLAUDE_PLUGIN_ROOT}/one' } } }));
    await put(join(root, 'extra/two.json'), JSON.stringify({ two: { command: 'two' } }));
    await put(join(root, '.lsp.json'), JSON.stringify({ gopls: { command: 'gopls' } }));
    await put(join(root, 'hooks/hooks.json'), JSON.stringify({ PreToolUse: [] }));
    await put(join(root, 'commands/git/commit.md'), '---\ndescription: Commits\n---\n');
    const contents = await pluginContents(root, { mcpServers: ['./extra/one.json', './extra/two.json'], lspServers: { rust: { command: 'ra' } } }, root);
    assert.deepEqual(contents.mcpServers.map(server => server.name), ['github', 'one', 'two']);
    assert.equal(contents.mcpUsesPluginRoot, true);
    assert.deepEqual(contents.lspServers, ['gopls', 'rust']);
    assert.deepEqual(contents.hooks, ['PreToolUse']);
    assert.deepEqual(contents.commands.map(command => command.name), ['commit']);
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
  assert.deepEqual(sourceOf({ source: 'github', repo: 'example/notes', path: 'plugin' }), { label: 'GitHub: example/notes/plugin', url: 'https://github.com/example/notes/tree/HEAD/plugin' });
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

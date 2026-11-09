import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown, trimRepeats, type Block, type Inline } from '../src/markdown.ts';

const text = (parts: Inline[]): string => parts.map(part => part.kind === 'text' || part.kind === 'code' ? part.text : part.kind === 'image' ? part.alt : text(part.kind === 'link' ? part.label : part.children)).join('');
const links = (parts: Inline[]): string[] => parts.flatMap(part => part.kind === 'link' ? [part.url, ...links(part.label)] : part.kind === 'strong' || part.kind === 'em' ? links(part.children) : []);

test('Code spans are kept exactly, angle brackets included, before any HTML is dropped', () => {
  const parts = parseInline('Run `claude plugin install <plugin>@<marketplace>` then <b>restart</b>.');
  assert.deepEqual(parts.find(part => part.kind === 'code'), { kind: 'code', text: 'claude plugin install <plugin>@<marketplace>' });
  assert.equal(text(parts), 'Run claude plugin install <plugin>@<marketplace> then restart.');
});

test('Only https links are links; other schemes and relative paths are just their text', () => {
  const parts = parseInline('[docs](https://example.com/docs) [local](./README.md) [bad](javascript:alert(1)) <https://example.com/x> see https://example.com/y.');
  assert.deepEqual(links(parts), ['https://example.com/docs', 'https://example.com/x', 'https://example.com/y']);
  assert.match(text(parts), /local/);
  assert.doesNotMatch(JSON.stringify(parts), /"url":"(javascript|\.\/)/);
});

test('Underscores inside words stay as they are; emphasis needs a word boundary', () => {
  const parts = parseInline('Set CLAUDE_PLUGIN_ROOT and my_plugin_name, see __init__.py, but _this_ is emphasis and **this** is strong.');
  assert.equal(parts.filter(part => part.kind === 'em').length, 1);
  assert.equal(parts.filter(part => part.kind === 'strong').length, 1);
  assert.match(text(parts), /CLAUDE_PLUGIN_ROOT and my_plugin_name, see __init__\.py/);
});

test('Images become their alt text, and HTML-only lines say nothing', () => {
  const blocks = parseMarkdown('<p align="center"><img src="logo.png"></p>\n\n![Logo](https://example.com/logo.png) Team tools');
  assert.equal(blocks.length, 1);
  assert.deepEqual((blocks[0] as Extract<Block, { kind: 'paragraph' }>).content[0], { kind: 'image', alt: 'Logo' });
});

test('Headings, lists, code, tables and quotes are read', () => {
  const kinds = parseMarkdown('# Title\n\n- one\n- two\n\n1. first\n\n```\ncode <here>\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n\n---').map(block => block.kind);
  assert.deepEqual(kinds, ['heading', 'list', 'list', 'code', 'table', 'quote', 'rule']);
});

test('Deep quotes and hostile text stay cheap: no recursion without limit, no slow scan', () => {
  assert.doesNotThrow(() => parseMarkdown('>'.repeat(60_000)));
  const started = Date.now();
  parseMarkdown('[a](b'.repeat(12_000));
  parseMarkdown('*'.repeat(60_000));
  parseMarkdown('_a'.repeat(30_000));
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});

test('An opening title and lead that only repeat the page are left out', () => {
  const blocks = trimRepeats(parseMarkdown('# document-tools\n\nRead PDFs and tidy spreadsheets.\n\n## Use\n\nMore.'), { skipTitle: 'document-tools', skipLead: ['Read PDFs and tidy spreadsheets.'] });
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'paragraph']);
  assert.equal(text((blocks[0] as Extract<Block, { kind: 'heading' }>).content), 'Use');
});

test('A heading line of thousands of spaces is read at once, and closing #s are dropped only after a space', () => {
  const started = Date.now();
  parseMarkdown(`# a${' '.repeat(16_000)}b${' '.repeat(16_000)}#`);
  assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
  const titles = parseMarkdown('## Title ##\n\n# C#\n\n#nospace').map(block => block.kind === 'heading' ? text(block.content) : block.kind);
  assert.deepEqual(titles, ['Title', 'C#', 'paragraph']);
});

test('A list that only names parts already on the page is left out, with a heading it alone filled', () => {
  const parts = [{ name: 'pdf-reader', description: 'Reads PDFs' }, { name: 'sheet-tidy', description: 'Tidies sheets' }];
  const source = '## Skills\n\n- `pdf-reader`: reads PDFs\n- **sheet-tidy** — tidies sheets\n\n## Setup\n\n- Run pdf-reader on a file\n- Then sheet-tidy it\n\n## More\n\nIncludes:\n\n- pdf-reader\n- sheet-tidy\n';
  const blocks = trimRepeats(parseMarkdown(source), { skipParts: parts });
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'list', 'heading', 'paragraph']);
  assert.equal(text((blocks[0] as Extract<Block, { kind: 'heading' }>).content), 'Setup');
  // Items that start with a part's name but say something of their own (a usage, an option) are the README's.
  const usage = trimRepeats(parseMarkdown('## Usage\n\n- `pdf-reader`: run it with --layout table\n- `sheet-tidy`: add --keep-formulas\n'), { skipParts: parts });
  assert.deepEqual(usage.map(block => block.kind), ['heading', 'list']);
});

test('Under a Skills heading, a skill’s paragraph that repeats its description goes; setup steps and examples stay', () => {
  const source = [
    '## What it does', '', 'Apps.', '',
    '## Skills', '', '### spark-app-template', '', 'Use when the user wants to create a new web application or dashboard.', '',
    '### pdf-reader', '', 'Reads PDF files and pulls out text.', '', 'Before first use, install Poppler and restart the tool.', '', '```', 'pdf read x', '```', '',
    '## Stack variations', '', 'A table.', '',
  ].join('\n');
  const blocks = trimRepeats(parseMarkdown(source), { skipParts: [
    { name: 'spark-app-template', description: 'Comprehensive guidance. Use when the user wants to create a new web application, dashboard, or interface.' },
    { name: 'pdf-reader', description: 'Reads PDF files and pulls out text and tables.' },
  ] });
  const shown = blocks.map(block => block.kind === 'heading' ? text(block.content) : block.kind === 'paragraph' ? text(block.content) : block.kind);
  assert.deepEqual(shown, ['What it does', 'Apps.', 'Skills', 'pdf-reader', 'Before first use, install Poppler and restart the tool.', 'code', 'Stack variations', 'A table.']);
});

test('Common README shapes read right: badges, code in emphasis, a fence in a list, setext headings, escapes', () => {
  const badge = parseInline('[![CI](https://img.example/ci.svg)](https://example.com/ci) done');
  assert.deepEqual(badge[0], { kind: 'link', label: [{ kind: 'text', text: 'CI' }], url: 'https://example.com/ci' });
  const strong = parseInline('**use `x` now**');
  assert.equal(strong.length, 1);
  assert.equal(strong[0]!.kind, 'strong');
  assert.deepEqual((strong[0] as { children: Inline[] }).children.map(part => part.kind), ['text', 'code', 'text']);
  assert.equal(text(parseInline('2 \\* 3 and \\_x\\_')), '2 * 3 and _x_');
  assert.deepEqual(parseMarkdown('1. Run:\n   ```\n   npm test\n   ```\n2. Done').map(block => block.kind), ['list', 'code', 'list']);
  assert.deepEqual(parseMarkdown('Title\n=====\n\nSub\n---\n\nText').map(block => block.kind), ['heading', 'heading', 'paragraph']);
});

test('Loose numbered steps stay one list, a list after a code block keeps counting, and placeholders in angle brackets stay', () => {
  assert.deepEqual(parseMarkdown('1. one\n\n2. two\n\n3. three').map(block => block.kind), ['list']);
  const blocks = parseMarkdown('1. Run:\n   ```\n   npm test\n   ```\n2. Done');
  assert.equal((blocks[2] as Extract<Block, { kind: 'list' }>).start, 2);
  assert.equal(text(parseInline('install <name>@<marketplace> then <b>go</b>')), 'install <name>@<marketplace> then go');
});

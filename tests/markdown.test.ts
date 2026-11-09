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
  const blocks = trimRepeats(parseMarkdown('# document-tools\n\nRead PDFs and tidy spreadsheets.\n\n## Use\n\nMore.'), { skipTitle: 'document-tools', skipLead: 'Read PDFs and tidy spreadsheets.' });
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'paragraph']);
  assert.equal(text((blocks[0] as Extract<Block, { kind: 'heading' }>).content), 'Use');
});

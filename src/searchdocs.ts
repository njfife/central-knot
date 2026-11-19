// What a document is for the Library (search.ts indexes them; this file only gathers them), in main, from the view just
// handed over and that view's own reads. One document per row of the Skills, MCP servers and Agents pages, by the page's
// row id (itemrow.ts rowId), a plugin's own rows too (pluginrows.ts pageRows, whose rule folds a plugin's item onto the
// person's own row: nothing is folded here). A row's names are those it shows: its key and shown name, and a plugin's own
// row its plugin's name; its description is the row's, and its text every distinct text the row has, each once:
// - its current version's, On or Off: a skill's SKILL.md after its frontmatter (whose name and description are the row's)
//   and the names of its other files (the one new reading search adds, once per distinct content), an agent's prompt
//   (agentstore.ts keeps what this view already read); an MCP server's command or address is its description already;
// - each managed tool's copy whose content differs from the current version (an edit not taken in, or a found item's);
// - on a plugin's own row, each tool's copy of the plugin's file (plugins.ts installedCopies, read once for this view). A
//   plugin's item folded onto the person's own row is that row's own content (the same, or the item linked to the plugin).
// Not here: an MCP server's plugin's own description (only its marketplace's catalog has it, which a view doesn't read).
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { readVersion as agentVersion } from './agentstore.ts';
import { bodyOf } from './discovery.ts';
import { kindSource, rowId } from './itemrow.ts';
import type { LibraryItem } from './library.ts';
import { installedCopies } from './plugins.ts';
import { pageRows } from './pluginrows.ts';
import { partOfPage, samePart } from './pluginstatus.ts';
import type { PluginTool } from './presence.ts';
import type { SearchDoc } from './search.ts';
import { notCopied, type ShareContext } from './share.ts';
import { readVersion as skillVersion } from './skillstore.ts';
import type { HomeView, LibraryFacts, PartKind } from './types.ts';

type Page = keyof typeof partOfPage;
const distinct = (texts: (string | undefined)[]) => [...new Set(texts.filter((text): text is string => !!text?.trim()))];

/** Every row of the view as a document. `context`: the view's own (its `reads` hold each tool's installed plugins). */
export async function libraryDocs(context: ShareContext, view: HomeView): Promise<SearchDoc[]> {
  const plugins = { home: context.home, dataDir: '', binaries: {}, overrides: context.overrides, reads: context.reads ?? new Map() };
  /** The file of a plugin's skill or agent in one tool's copy of that plugin, after its frontmatter (an MCP server's launch is its row's description). */
  const pluginText = async (tool: string, plugin: string, marketplace: string, kind: PartKind, name: string) => {
    const contents = (await installedCopies(plugins, tool as PluginTool).catch(() => [])).find(copy => copy.plugin === plugin && copy.marketplace === marketplace)?.contents;
    const parts = kind === 'skill' ? contents?.skills : kind === 'agent' ? contents?.agents : [];
    const text = parts?.find(part => samePart({ kind, name: part.name }, { kind, name }))?.text;
    return text && bodyOf(text);
  };
  const docs: SearchDoc[] = [];
  for (const page of Object.keys(partOfPage) as Page[]) {
    const { facts, library } = kindSource(view, page);
    for (const fact of facts) {
      const item = library[fact.key]?.deleted ? undefined : library[fact.key];
      docs.push({ id: rowId(page, fact.key), names: distinct([fact.key, fact.name]), description: fact.description, text: distinct(await ownTexts(context, page, fact, item)).join('\n\n') });
    }
    for (const row of pageRows(view, page).rows) {
      const texts = await Promise.all(Object.entries(row.copies).map(([tool, copy]) => pluginText(tool, row.plugin, row.marketName, row.kind, copy!.name)));
      docs.push({ id: rowId(page, row.key), names: [row.name, row.plugin], description: row.description, text: distinct(texts).join('\n\n') });
    }
  }
  return docs;
}

/** A row's own texts: its current version's (`item`, in the library), then each tool's copy whose content differs from it, once each. */
async function ownTexts(context: ShareContext, page: Page, fact: LibraryFacts, item: LibraryItem | undefined): Promise<(string | undefined)[]> {
  const copies = [...new Map(Object.values(fact.copies).filter(copy => copy!.hash !== item?.hash).map(copy => [copy!.hash, copy!])).values()];
  if (page === 'mcp') return copies.map(copy => copy.summary);
  if (page === 'agents') return [item && (await agentVersion(context, fact.key, item.hash))?.prompt, ...copies.map(copy => copy.body)];
  const version = item && await skillVersion(context, fact.key, item.hash);
  const folders = [...(version ? [version.directory] : []), ...copies.map(copy => copy.directory)];
  // A found skill a tool has only another way (a link, the shared folder) has no copy of its own: the folder that tool loads.
  if (!folders.length) folders.push(...new Set(Object.values(fact.loads ?? {}).map(loaded => dirname(loaded!.skillFile))));
  return Promise.all(folders.map(skillText));
}

/** A skill's SKILL.md after its frontmatter, then the names of its other files (a nested .git and editors' leftovers aside, as share.ts readTree); none if it is gone. */
async function skillText(folder: string): Promise<string | undefined> {
  const names: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || notCopied(entry.name, entry.isFile())) continue;
      if (entry.isDirectory()) await visit(join(directory, entry.name));
      else names.push(relative(folder, join(directory, entry.name)));
    }
  };
  try {
    const [skill] = await Promise.all([readFile(join(folder, 'SKILL.md'), 'utf8'), visit(folder)]);
    return [bodyOf(skill), ...names.filter(name => name !== 'SKILL.md').sort()].join('\n');
  } catch { return undefined; }
}

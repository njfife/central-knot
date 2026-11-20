// What a document is for the Library (search.ts indexes them; this file only gathers them), in main, from the view just
// handed over and that view's own reads. One document per row of the Skills, MCP servers and Agents pages, by the page's
// row id (itemrow.ts rowId), a plugin's own rows too (pluginrows.ts pageRows, whose rule folds a plugin's item onto the
// person's own row: nothing is folded here). A row's names are its own that it shows: its key and shown name (a plugin's own
// row gives its plugin's name apart: search.ts SearchDoc plugin); its description is the row's, and its text every distinct
// text the row has, each once:
// - its current version's, On or Off: a skill's SKILL.md after its frontmatter (whose name and description are the row's)
//   and the names of its other files (the one new reading search adds: at each view, once per distinct content of a row),
//   an agent's prompt (agentstore.ts keeps what this view already read); an MCP server's command or address is its
//   description already;
// - each managed tool's copy whose content differs from the current version (an edit not taken in, or a found item's), and
//   each folder a tool loads that is none of its copies (the shared folder, a link);
// - each tool's copy of a plugin's item, on the plugin's own row or on the person's own row the Library folds it onto
//   (pluginrows.ts pageRows `folded`): its file (plugins.ts installedCopies, read once for this view), and its description
//   or launch where the row's description doesn't already say it. A plugin's skill's other files are not named: its folder
//   is never listed at a view, and listing it would be a walk of every plugin skill's folder at every view.
// Not here: an MCP server's plugin's own description (only its marketplace's catalog has it, which a view doesn't read).
// And the items of listed plugins installed in no managed tool (catalogDocs), from the plugin text the job keeps (plugintext.ts),
// gathered beside the view's own at each follow and as the text changes (main.ts followSearch).
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { readVersion as agentVersion } from './agentstore.ts';
import { bodyOf } from './discovery.ts';
import { kindSource, rowId } from './itemrow.ts';
import type { LibraryItem } from './library.ts';
import { installedCopies, sameSource, sourceKey } from './plugins.ts';
import { onOwnRow, pageRows, type PluginRow } from './pluginrows.ts';
import { installedNowhere, partOfPage, samePart } from './pluginstatus.ts';
import type { PluginText } from './plugintext.ts';
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
  /** The file of a plugin's skill or agent in one tool's copy of that plugin, after its frontmatter (an MCP server has none). */
  const pluginText = async (tool: string, plugin: string, marketplace: string, kind: PartKind, name: string) => {
    const contents = (await installedCopies(plugins, tool as PluginTool).catch(() => [])).find(copy => copy.plugin === plugin && copy.marketplace === marketplace)?.contents;
    const parts = kind === 'skill' ? contents?.skills : kind === 'agent' ? contents?.agents : [];
    const text = parts?.find(part => samePart({ kind, name: part.name }, { kind, name }))?.text;
    return text && bodyOf(text);
  };
  /**
   * Each tool's copy of a plugin's item: its file, and its description or launch unless it is the one `shown` (the row's
   * description: a copy's description, or "Command · " or "URL · " and a copy's launch), compared whole.
   */
  const copyTexts = (row: PluginRow, shown: string) => Promise.all(Object.entries(row.copies).flatMap(([tool, copy]) =>
    [pluginText(tool, row.plugin, row.marketName, row.kind, copy!.name), ...[copy!.description, copy!.runs].filter(said => said && said !== shown && !shown.endsWith(` · ${said}`))]));
  const docs: SearchDoc[] = [];
  for (const page of Object.keys(partOfPage) as Page[]) {
    const { facts, library } = kindSource(view, page), { rows, folded } = pageRows(view, page);
    for (const fact of facts) {
      const item = library[fact.key]?.deleted ? undefined : library[fact.key];
      const given = await Promise.all((folded.get(fact.key) ?? []).map(row => copyTexts(row, fact.description)));
      const texts = [...await ownTexts(context, page, fact, item), ...given.flat()];
      docs.push({ id: rowId(page, fact.key), names: distinct([fact.key, fact.name]), description: fact.description, text: distinct(texts).join('\n\n') });
    }
    for (const row of rows) {
      docs.push({ id: rowId(page, row.key), names: [row.name], plugin: row.plugin, description: row.description, text: distinct(await copyTexts(row, row.description)).join('\n\n') });
    }
  }
  return docs;
}

/**
 * The items of listed plugins installed in no managed tool (pluginstatus.ts installedNowhere), each a document of its own: its
 * id `catalog:` and the JSON of [its marketplace's canonical source (plugins.ts sourceKey), the plugin, the kind, the item's path
 * in it or a server's name], which no Library row's id (skills-, agents-, mcp-) can be; its name, and its plugin's apart; its
 * description (a server's launch); its text, the first 1,000 characters of its file as kept (a skill's or agent's after its
 * frontmatter, as a Library row's: the name and description are the document's already); and what its row draws (types.ts
 * CatalogItem). One already a Library row (linked to that plugin in Pi or OpenCode: pluginrows.ts onOwnRow) is left to that row.
 * `texts`: as the job keeps them (plugintext.ts texts()), whatever pin each was read at; only those of a marketplace the open home
 * lists (`listed`, marketplaces.ts listings) are used: another home's stay kept until the job matches them to this home's listing.
 */
export function catalogDocs(view: HomeView, texts: PluginText[], listed: string[]): SearchDoc[] {
  const markets = new Set(listed.map(sourceKey));
  const linked = Object.fromEntries((Object.keys(partOfPage) as Page[]).map(page => [partOfPage[page], kindSource(view, page).facts.filter(fact => fact.fromSource || fact.plugin)]));
  return texts.flatMap(text => {
    const market = sourceKey(text.source), named = { plugin: text.plugin, marketName: text.marketName };
    if (!markets.has(market) || !installedNowhere(view, text.plugin, source => sameSource(source, text.source))) return [];
    return text.items.filter(item => !linked[item.kind]!.some(fact => onOwnRow(fact, { ...item, ...named }))).map(item => {
      const description = item.kind === 'mcp' ? item.runs ?? '' : item.description;
      return { id: `catalog:${JSON.stringify([market, text.plugin, item.kind, item.path ?? item.name])}`, names: [item.name], plugin: text.plugin, description, text: item.kind === 'mcp' ? item.start : bodyOf(item.start),
        catalog: { kind: item.kind, name: item.name, description, ...named, source: text.source } };
    });
  });
}

/** A row's own texts: its current version's (`item`, in the library), then each tool's copy whose content differs from it, once each. */
async function ownTexts(context: ShareContext, page: Page, fact: LibraryFacts, item: LibraryItem | undefined): Promise<(string | undefined)[]> {
  const copies = [...new Map(Object.values(fact.copies).filter(copy => copy!.hash !== item?.hash).map(copy => [copy!.hash, copy!])).values()];
  if (page === 'mcp') return copies.map(copy => copy.summary);
  if (page === 'agents') return [item && (await agentVersion(context, fact.key, item.hash))?.prompt, ...copies.map(copy => copy.body)];
  const version = item && await skillVersion(context, fact.key, item.hash);
  // Each folder a tool loads that is none of the row's copies (the shared folder, a link): its words may be none of these.
  const own = new Set(Object.values(fact.copies).map(copy => copy!.directory));
  const loaded = Object.values(fact.loads ?? {}).map(load => dirname(load!.skillFile)).filter(folder => !own.has(folder));
  return (await Promise.all([...new Set([...(version ? [version.directory] : []), ...copies.map(copy => copy.directory), ...loaded])].map(skillText))).flat();
}

/**
 * A skill's two texts: its SKILL.md after its frontmatter, and the names of its other files (a nested .git and editors'
 * leftovers aside, as share.ts readTree), so a body is compared with bodies; none if it is gone.
 */
async function skillText(folder: string): Promise<string[]> {
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
    return [bodyOf(skill), names.filter(name => name !== 'SKILL.md').sort().join('\n')];
  } catch { return []; }
}

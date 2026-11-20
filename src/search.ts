// Word search, in main: documents indexed in memory with SQLite's own full-text search (FTS5 through node:sqlite, as usage.ts
// opens a database), and a typed text answered from that index, best first. Owns:
// - how text becomes words. Both sides are first put in one Unicode form (NFC). A name or description keeps its words and
//   gets each camelCase word's parts added (`indexed`: "TypeScript" stays, "Type Script" is added); a file's text is indexed
//   as written, its camelCase parts in a column of their own (`partsOf`), so an excerpt holds only the file's words. SQLite's
//   unicode61 cuts at every character that is not a letter or a digit, and Porter stems (`kubernetes`, `kubernets` →
//   `kubernet`). `words` makes the same cut for what is typed (camelCase apart, marks kept): `pr-review`,
//   `mcp__server__tool`, a path and a URL's parts split, and `k8s` stays one word. The words kept for corrections are the
//   names' and descriptions' as indexed, whole and in parts (`cut(indexed(…))`);
// - the query's rule (`Index.ask`): a text with no words asks nothing; a row one of whose names is the typed text whole comes
//   first; then every word, the last as a prefix (the person is still typing it); if nothing, each word that finds nothing
//   (the first LOOKED_UP of them) gets the known words nearest it (`nearest`) beside it and every word is asked again; if
//   still nothing, any of the typed words. Every word is quoted, so nothing typed reaches MATCH as syntax. Ranked by bm25()
//   with the name weighted most (`WEIGHTS`), ties by row id: ids alone, as many as are found;
// - the excerpt of a row found in its text alone, asked apart from the ranking and only for the rows named (`Index.excerpts`):
//   the file's own words from BEFORE words before the first that matched, EXCERPT_WORDS in all, "…" where cut; where more of
//   the typed words matched in a camelCase word's parts than in the text, around that word (`markWord`);
// - the one index main keeps (`searchFollower`): built from a view's documents in slices that give way to main's other work,
//   superseded by a newer view while it gathers or builds, tagged again (not rebuilt) when the content is the same, closed
//   when replaced or superseded, when another home opens and at quit; its answer excerpts only the rows the page draws at
//   once (`drawnAtOnce`), and sends a catalog item's details only for those.
// Nothing is written to disk and nothing is fetched. A document's id is opaque here (a Library row's id, or a catalog item's,
// which carries what its row draws: `catalog`). Not here: what a document is (searchdocs.ts libraryDocs, catalogDocs), the
// answer's shape (types.ts SearchAnswer), the page's use of it.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CatalogItem, PartKind, SearchAnswer, SearchHit } from './types.ts';

/** One thing to find: its id on the page, the names its row shows, its description and its text; a catalog item's, what its row draws. */
export interface SearchDoc { id: string; names: string[]; description: string; text: string; catalog?: CatalogItem }

/**
 * bm25()'s weight for the names, the description, the text and the text's camelCase parts (at the text's weight): tuned on
 * tests/search.test.ts's query set, then frozen.
 */
const WEIGHTS = [10, 4, 1, 1];
/** How many words an excerpt of the text holds around its match, and how many of them before the first word that matched. */
const EXCERPT_WORDS = 12, BEFORE = 3;
/** The marks SQLite puts around each word that matched in a snippet, taken out of an excerpt once it is cut (`around`). */
const OPEN = '\u0001', CLOSE = '\u0002';
/** Documents indexed between two give-ways of main's event loop: 3,394 public plugin items held it 44 ms at most, unsliced 440 ms. */
const SLICE = 100;
/** How many of the typed words that find nothing are looked up for nearest words: a pasted paragraph asks no more. */
const LOOKED_UP = 8;
/** Ordered by id, so equal ranks fall in row id order, and the same documents always make the same index. */
const byId = (first: SearchDoc, second: SearchDoc) => (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);

/** camelCase apart ("useState" → "use State", "HTMLParser" → "HTML Parser"). */
const apart = (text: string) => text.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
/** Where `apart` would part a word: a camelCase boundary. */
const CAMEL = /\p{Ll}\p{Lu}|\p{Lu}\p{Lu}\p{Ll}/u;
/** Where unicode61 cuts: at what is not a letter or a digit (a mark stays with its letter). */
const NOT_A_WORD = /[^\p{L}\p{N}\p{M}]+/u;
/** Cut as unicode61 cuts, in lower case. */
const cut = (text: string) => text.toLowerCase().split(NOT_A_WORD).filter(Boolean);
/** The parts of each camelCase word in a text already in the index's Unicode form ("TypeScript" → "Type Script"), each word once. */
const partsOf = (normal: string) => [...new Set(normal.split(NOT_A_WORD).filter(word => CAMEL.test(word)))].map(apart).join(' ');
/** A name or description as the index holds it: in one Unicode form, with its camelCase words' parts added, so both are found. */
const indexed = (text: string) => { const normal = text.normalize('NFC'); return `${normal}\n${partsOf(normal)}`; };
/** What is typed, as words: in the index's Unicode form, camelCase apart, cut as the index cuts. */
export const words = (text: string) => cut(apart(text.normalize('NFC')));
/** A word without its accents, as unicode61 folds it: what the nearest words are compared in. */
const unaccented = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '');
/** One word as MATCH reads it: quoted, so it is only ever a word; a prefix with `*`. */
const term = (word: string, prefix = false) => `"${word.replaceAll('"', '""')}"${prefix ? '*' : ''}`;

/** A built index: its answer to a typed text, rows in rank order with no excerpt (`ask`); the excerpts of the rows named that matched in their text alone (`excerpts`); `close` frees it. */
export interface Index { ask(typed: string): SearchHit[]; excerpts(typed: string, ids: string[]): Map<string, string>; close(): void }

/**
 * Indexes `docs` in memory, giving way to main's other work every SLICE documents; none once `wanted` says a newer view
 * replaced it. Its database is closed when it gives none, or throws.
 */
export async function buildIndex(docs: SearchDoc[], wanted = () => true): Promise<Index | undefined> {
  const db = new DatabaseSync(':memory:');
  let index: Index | undefined;
  try { index = await fill(db, docs, wanted); } finally { if (!index) db.close(); }
  return index;
}

/** The index in `db`. The words for nearest words are kept beside it: those of names and descriptions, and the stems. */
async function fill(db: DatabaseSync, docs: SearchDoc[], wanted: () => boolean): Promise<Index | undefined> {
  const sorted = [...docs].sort(byId);
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(names, description, text, parts, tokenize = 'porter unicode61'); CREATE VIRTUAL TABLE stems USING fts5vocab(docs, 'row');");
  const add = db.prepare('INSERT INTO docs (rowid, names, description, text, parts) VALUES (?, ?, ?, ?, ?)');
  const byName = new Map<string, number[]>(), surface = new Set<string>();
  db.exec('BEGIN');
  for (const [at, doc] of sorted.entries()) {
    if (at && at % SLICE === 0) await new Promise(resolve => setImmediate(resolve));
    if (!wanted()) return undefined;
    const text = doc.text.normalize('NFC');
    add.run(at + 1, indexed(doc.names.join('\n')), indexed(doc.description), text, partsOf(text));
    for (const name of new Set(doc.names.map(each => each.normalize('NFC').toLowerCase()))) byName.set(name, [...(byName.get(name) ?? []), at + 1]);
    for (const word of cut(indexed(`${doc.names.join(' ')} ${doc.description}`))) surface.add(unaccented(word));
  }
  db.exec('COMMIT');
  // Only the ids (and a catalog item's row) are kept of the documents (a row's rowid is its place here, from 1): their texts are in the index.
  const ids = sorted.map(doc => doc.id), rowids = new Map(ids.map((id, at) => [id, at + 1])), catalog = sorted.map(doc => doc.catalog);
  const stems = (db.prepare('SELECT term FROM stems ORDER BY term').all() as { term: string }[]).map(row => row.term);
  const known = [...surface].sort();
  const ranked = db.prepare(`SELECT rowid FROM docs WHERE docs MATCH ? ORDER BY bm25(docs, ${WEIGHTS.join(', ')}), rowid`);
  // The text's snippet and its camelCase parts', each matched word marked, for the rows asked for that their names and description
  // don't explain. One pass over what the text matches: asked row by row (rowid = ?), a prefix is looked up again for each row.
  const excerpted = db.prepare(`SELECT rowid, CASE WHEN rowid IN (SELECT value FROM json_each(?)) AND rowid NOT IN (SELECT rowid FROM docs WHERE docs MATCH ?)
    THEN snippet(docs, 2, char(1), char(2), '…', ${EXCERPT_WORDS}) || char(0) || snippet(docs, 3, char(1), char(2), '', 2) END AS excerpt FROM docs WHERE docs MATCH ?`);
  const textOf = db.prepare('SELECT text FROM docs WHERE rowid = ?');
  /** A row's excerpt: around the first word of its text that matched; where more words matched in camelCase words' parts, around such a word (markWord). */
  const excerptOf = (rowid: number, snippets: string) => {
    const [text, parts] = snippets.split('\0');
    return marked(text).length >= marked(parts).length ? around(text) : around(markWord((textOf.get(rowid) as { text: string }).text, parts));
  };
  const any = db.prepare('SELECT 1 FROM docs WHERE docs MATCH ? LIMIT 1');
  /** A known word as MATCH asks it: whole, or as a prefix where Porter changes that stem again so that, whole, it finds nothing. */
  const asked = (word: string) => (any.get(term(word)) ? term(word) : term(word, true));
  /** Each typed word as MATCH asks it (`asTyped`), or with its nearest known words beside it where it finds nothing alone. */
  function withNearest(said: string[], asTyped: string[]) {
    const lookedUp = asTyped.map((own, at) => (any.get(own) ? undefined : at)).filter(at => at !== undefined).slice(0, LOOKED_UP);
    return asTyped.map((own, at) => {
      const near = lookedUp.includes(at) ? nearest(unaccented(said[at]), known, stems) : [];
      return near.length ? `(${[own, ...near.map(asked)].join(' OR ')})` : own;
    });
  }

  /** What MATCH asks for a typed text: the first of the query's tries that finds a row; none for no words, or when none does. The last one worked out is kept (ask, then excerpts). */
  let last: { typed: string; expr?: string } | undefined;
  function matchFor(typed: string) {
    if (last?.typed === typed) return last.expr;
    const said = words(typed);
    // Every word as typed, the last a prefix: the person is still typing it.
    const asTyped = said.map((word, at) => term(word, at === said.length - 1));
    const tries = said.length ? [() => asTyped.join(' AND '), () => withNearest(said, asTyped).join(' AND '), () => asTyped.join(' OR ')] : [];
    last = { typed };
    for (const expr of tries) if (any.get(last.expr = expr())) return last.expr;
    return (last.expr = undefined);
  }
  /** The rows one of whose names is the typed text whole: first, and with no excerpt. */
  const exactFor = (typed: string) => byName.get(typed.trim().normalize('NFC').toLowerCase()) ?? [];

  return {
    ask(typed) {
      if (!words(typed).length) return [];
      const expr = matchFor(typed), exact = exactFor(typed);
      const found = expr ? (ranked.all(expr) as { rowid: number }[]).map(row => row.rowid) : [];
      return [...exact, ...found.filter(rowid => !exact.includes(rowid))].map(rowid => { const item = catalog[rowid - 1]; return { id: ids[rowid - 1]!, ...(item ? { kind: item.kind, item } : {}) }; });
    },
    excerpts(typed, wanted) {
      const expr = matchFor(typed), exact = exactFor(typed);
      const asked = wanted.map(id => rowids.get(id)).filter((rowid): rowid is number => rowid !== undefined && !exact.includes(rowid));
      if (!expr || !asked.length) return new Map();
      const rows = (excerpted.all(JSON.stringify(asked), `{names description} : (${expr})`, expr) as { rowid: number; excerpt: string | null }[]).filter(row => row.excerpt);
      return new Map(rows.map(({ rowid, excerpt }) => [ids[rowid - 1]!, excerptOf(rowid, excerpt!)]));
    },
    close: () => db.close(),
  };
}

/**
 * An excerpt of `marked` (text with the words that matched marked) that shows the first of them: from BEFORE words before it, to
 * EXCERPT_WORDS words in all, "…" where cut, on one line, the marks taken out.
 */
function around(marked: string) {
  const cutBefore = marked.startsWith('…'), text = cutBefore ? marked.slice(1) : marked;
  const start = text.slice(0, Math.max(0, text.indexOf(OPEN))).search(/\S*$/);
  const before = text.slice(0, start).split(/\s+/).filter(Boolean), after = text.slice(start).split(/\s+/).filter(Boolean);
  const kept = before.slice(-BEFORE), shown = after.slice(0, EXCERPT_WORDS - kept.length);
  const lead = cutBefore || kept.length < before.length ? '…' : '', tail = shown.length < after.length ? '…' : '';
  return `${lead}${[...kept, ...shown].join(' ')}${tail}`.replaceAll(OPEN, '').replaceAll(CLOSE, '');
}
/** The different words a snippet has marked, in lower case, in the order first marked. */
const marked = (snippet: string) => [...new Set([...snippet.matchAll(/\u0001([^\u0002]*)\u0002/gu)].map(match => match[1].toLowerCase()))];
/** `text` with one camelCase word marked: the first whose parts hold every part marked in `parts`, else the first that holds the first. */
function markWord(text: string, parts: string) {
  const wanted = marked(parts), all = text.split(/\s+/), pieces = (word: string) => (CAMEL.test(word) ? cut(apart(word)) : []);
  const every = all.findIndex(word => wanted.every(part => pieces(word).includes(part)));
  const at = every >= 0 ? every : all.findIndex(word => pieces(word).includes(wanted[0]));
  return all.map((word, each) => (each === at ? `${OPEN}${word}${CLOSE}` : word)).join(' ');
}

/**
 * The known words nearest a word that finds nothing: the words of names and descriptions as written first, else the index's
 * stems. A file's text gives stems only, so a mistyped word only a text has is compared with its stem ("deploymnet" with
 * `deploy`: too far). One letter off from four letters, two from eight, a transposition counting one; a number, or a word
 * under four letters, is never replaced. At most three, nearest first, then alphabetical.
 */
function nearest(word: string, known: string[], stems: string[]): string[] {
  const allowed = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
  if (!allowed || /^\p{N}+$/u.test(word)) return [];
  const within = (list: string[]) => list.map(each => ({ each, off: distance(word, each, allowed) })).filter(({ off }) => off <= allowed)
    .sort((first, second) => first.off - second.off || (first.each < second.each ? -1 : 1)).slice(0, 3).map(({ each }) => each);
  const written = within(known);
  return written.length ? written : within(stems);
}

/** Letters to change, add, remove or swap with the next to make `from` into `to` (optimal string alignment); `most + 1` once past `most`. */
function distance(from: string, to: string, most: number): number {
  if (Math.abs(from.length - to.length) > most) return most + 1;
  let before: number[] = [], previous = [...Array(to.length + 1).keys()];
  for (let i = 1; i <= from.length; i++) {
    const row = [i];
    for (let j = 1; j <= to.length; j++) {
      const cost = from[i - 1] === to[j - 1] ? 0 : 1;
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && from[i - 1] === to[j - 2] && from[i - 2] === to[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
    }
    if (Math.min(...row) > most) return most + 1;
    [before, previous] = [previous, row];
  }
  return previous[to.length];
}

/** What a published index answers for: the home and the read of the view its documents came from. */
export interface Published { home: string; readId: number }

/**
 * The rows of an answer whose excerpts are asked for: those the page draws as soon as it has the answer (matrix.ts): every row
 * of the Library's own, and of the catalog's, the first `shown` of every kind together and of each kind alone (a segment of the
 * kind switch). The others are ranked only, for the counts; "Show 10 more" asks again with ten more (matrix.ts catalogGroup).
 */
function drawnAtOnce(rows: SearchHit[], shown: number): Set<string> {
  const catalog = rows.filter(row => row.kind), first = (kind?: PartKind) => catalog.filter(row => !kind || row.kind === kind).slice(0, shown);
  return new Set([...rows.filter(row => !row.kind), ...first(), ...first('skill'), ...first('agent'), ...first('mcp')].map(row => row.id));
}

/**
 * The one index main keeps. `follow` takes each new view of a home: its documents gathered, then built, or (the same content)
 * the index tagged with the new read; a newer `follow` supersedes one still gathering or building; another home closes the
 * old index at once. `published` hears each build or new tag. `ask` answers from the index as published, never waiting on a
 * build: every row ranked, the excerpts and a catalog item's details of those drawnAtOnce. `build`: how an index is made (a test counts them).
 */
export function searchFollower(published: (tag: Published) => void, build = buildIndex) {
  let current: (Published & { digest: string; index: Index }) | undefined;
  let turn = 0;
  return {
    async follow(home: string, readId: number, gather: () => Promise<SearchDoc[]>): Promise<void> {
      const mine = ++turn;
      if (current && current.home !== home) { current.index.close(); current = undefined; }
      const docs = await gather();
      if (mine !== turn) return;
      const digest = createHash('sha256').update(JSON.stringify([...docs].sort(byId))).digest('hex');
      if (current?.digest === digest) current = { ...current, readId };
      else {
        const index = await build(docs, () => mine === turn);
        if (!index) return;
        current?.index.close();
        current = { home, readId, digest, index };
      }
      published({ home, readId });
    },
    ask(typed: string, shown = 0): SearchAnswer {
      if (!current) return { ready: false };
      const rows = current.index.ask(typed), drawn = drawnAtOnce(rows, shown), excerpts = current.index.excerpts(typed, [...drawn]);
      // A catalog row not drawn at once goes as its id and kind: the counts need no more (3,332 rows for "a": 0.3 MB, not 2.2).
      const sent = (row: SearchHit): SearchHit => (!drawn.has(row.id) ? { id: row.id, ...(row.kind ? { kind: row.kind } : {}) } : excerpts.has(row.id) ? { ...row, excerpt: excerpts.get(row.id) } : row);
      return { ready: true, home: current.home, readId: current.readId, rows: rows.map(sent) };
    },
    close() { turn++; current?.index.close(); current = undefined; },
  };
}

// Word search, in main: documents indexed in memory with SQLite's own full-text search (FTS5 through node:sqlite, as usage.ts
// opens a database), and a typed text answered from that index, best first. Owns:
// - how text becomes words (`words`), the same for documents and queries: camelCase apart, then cut where SQLite's
//   unicode61 cuts (at every character that is not a letter or a digit), so `pr-review`, `mcp__server__tool`, a path and a
//   URL's parts split and `k8s` stays one word; the index stems with Porter (`kubernetes`, `kubernets` → `kubernet`);
// - the query's rule (`Index.ask`): a row one of whose names is the typed text whole comes first; then every word, the
//   last as a prefix (the person is still typing it); if nothing, each word that finds nothing is replaced by the known words
//   nearest it (`nearest`) and every word is asked again; if still nothing, any of the typed words. Every word is quoted, so
//   nothing typed reaches MATCH as syntax. Ranked by bm25() with the name weighted most (`WEIGHTS`), ties by row id;
// - the one index main keeps (`searchFollower`): built from a view's documents in slices that give way to main's other work,
//   superseded by a newer view while it gathers or builds, tagged again (not rebuilt) when the content is the same, closed
//   when replaced or superseded, when another home opens and at quit.
// Nothing is written to disk and nothing is fetched. A document's id is opaque here (the page's row id). Not here: what a
// document is for the Library (searchdocs.ts libraryDocs), the answer's shape (types.ts SearchAnswer), the page's use of it.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { SearchAnswer, SearchHit } from './types.ts';

/** One thing to find: its id on the page, the names its row shows, its description and its text. */
export interface SearchDoc { id: string; names: string[]; description: string; text: string }

/** bm25()'s weight for the names, the description and the text: tuned on tests/search.test.ts's query set, then frozen. */
const WEIGHTS = [10, 4, 1];
/** How many words an excerpt of the text holds around its match. */
const EXCERPT_WORDS = 12;
/** Documents indexed between two give-ways of main's event loop: 3,394 public plugin items held it 44 ms at most, unsliced 440 ms. */
const SLICE = 100;
/** Ordered by id, so equal ranks fall in row id order, and the same documents always make the same index. */
const byId = (first: SearchDoc, second: SearchDoc) => (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);

/** camelCase apart ("useState" → "use State", "HTMLParser" → "HTML Parser"), before SQLite's tokenizer cuts the rest. */
const apart = (text: string) => text.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
/** A text's words, as the index cuts them: camelCase apart, cut at what is not a letter or a digit, in lower case. */
export const words = (text: string) => apart(text.normalize('NFC')).toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
/** A word without its accents, as unicode61 folds it: what the nearest words are compared in. */
const folded = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '');
/** One word as MATCH reads it: quoted, so it is only ever a word; a prefix with `*`. */
const term = (word: string, prefix = false) => `"${word.replaceAll('"', '""')}"${prefix ? '*' : ''}`;

/** A built index: its answer to a typed text, rows in rank order; `close` frees it. */
export interface Index { ask(typed: string): SearchHit[]; close(): void }

/**
 * Indexes `docs` in memory, giving way to main's other work every SLICE documents; none, and the database closed, once
 * `wanted` says a newer view replaced it. The vocabulary for nearest words is kept beside it: the names' words, the stems.
 */
export async function buildIndex(docs: SearchDoc[], wanted = () => true): Promise<Index | undefined> {
  const sorted = [...docs].sort(byId);
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(names, description, text, tokenize = 'porter unicode61'); CREATE VIRTUAL TABLE stems USING fts5vocab(docs, 'row');");
  const add = db.prepare('INSERT INTO docs (rowid, names, description, text) VALUES (?, ?, ?, ?)');
  const byName = new Map<string, number[]>(), nameWords = new Set<string>();
  db.exec('BEGIN');
  for (const [at, doc] of sorted.entries()) {
    if (at && at % SLICE === 0) await new Promise(resolve => setImmediate(resolve));
    if (!wanted()) { db.close(); return undefined; }
    add.run(at + 1, apart(doc.names.join('\n')), apart(doc.description), apart(doc.text));
    for (const name of new Set(doc.names.map(each => each.normalize('NFC').toLowerCase()))) byName.set(name, [...(byName.get(name) ?? []), at + 1]);
    for (const word of words(doc.names.join(' '))) nameWords.add(folded(word));
  }
  db.exec('COMMIT');
  // Only the ids are kept of the documents (a row's rowid is its place here, from 1): their texts are in the index.
  const ids = sorted.map(doc => doc.id);
  const stems = (db.prepare('SELECT term FROM stems ORDER BY term').all() as { term: string }[]).map(row => row.term);
  const names = [...nameWords].sort();
  const ranked = db.prepare(`SELECT rowid, CASE WHEN rowid IN (SELECT rowid FROM docs WHERE docs MATCH ?) THEN NULL
    ELSE snippet(docs, 2, '', '', '…', ${EXCERPT_WORDS}) END AS excerpt FROM docs WHERE docs MATCH ? ORDER BY bm25(docs, ${WEIGHTS.join(', ')}), rowid`);
  const any = db.prepare('SELECT 1 FROM docs WHERE docs MATCH ? LIMIT 1');
  /** The rows `expr` finds, best first; an excerpt for a row its names and description alone don't explain. */
  const find = (expr: string) => ranked.all(`{names description} : (${expr})`, expr) as { rowid: number; excerpt: string | null }[];
  /** A known word as MATCH asks it: whole, or as a prefix where Porter changes that stem again so that, whole, it finds nothing. */
  const asked = (known: string) => (any.get(term(known)) ? term(known) : term(known, true));
  /** Each typed word as MATCH asks it (`asTyped`), or with its nearest known words beside it where it finds nothing alone. */
  const withNearest = (said: string[], asTyped: string[]) => asTyped.map((own, at) => {
    if (any.get(own)) return own;
    const near = nearest(folded(said[at]), names, stems);
    return near.length ? `(${[own, ...near.map(asked)].join(' OR ')})` : own;
  });

  return {
    ask(typed) {
      const said = words(typed);
      // Every word as typed, the last a prefix: the person is still typing it.
      const asTyped = said.map((word, at) => term(word, at === said.length - 1));
      const tries = said.length ? [() => asTyped.join(' AND '), () => withNearest(said, asTyped).join(' AND '), () => asTyped.join(' OR ')] : [];
      let found: { rowid: number; excerpt: string | null }[] = [];
      for (const expr of tries) if ((found = find(expr())).length) break;
      const exact = byName.get(typed.trim().normalize('NFC').toLowerCase()) ?? [];
      const rows = [...exact.map(rowid => ({ rowid, excerpt: null })), ...found.filter(row => !exact.includes(row.rowid))];
      return rows.map(({ rowid, excerpt }) => ({ id: ids[rowid - 1], ...(excerpt ? { excerpt: excerpt.replace(/\s+/g, ' ').trim() } : {}) }));
    },
    close: () => db.close(),
  };
}

/**
 * The known words nearest a word that finds nothing: a name's words first, else the index's stems. One letter off from four
 * letters, two from eight, a transposition counting one; a number, or a word under four letters, is never replaced. At most
 * three, nearest first, then alphabetical.
 */
function nearest(word: string, names: string[], stems: string[]): string[] {
  const allowed = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
  if (!allowed || /^\p{N}+$/u.test(word)) return [];
  const within = (known: string[]) => known.map(each => ({ each, off: distance(word, each, allowed) })).filter(({ off }) => off <= allowed)
    .sort((first, second) => first.off - second.off || (first.each < second.each ? -1 : 1)).slice(0, 3).map(({ each }) => each);
  const named = within(names);
  return named.length ? named : within(stems);
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
 * The one index main keeps. `follow` takes each new view of a home: its documents gathered, then built, or (the same content)
 * the index tagged with the new read; a newer `follow` supersedes one still gathering or building; another home closes the
 * old index at once. `published` hears each build or new tag. `ask` answers from the index as published, never waiting on a build.
 * `build`: how an index is made (a test counts them).
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
    ask: (typed: string): SearchAnswer => (current ? { ready: true, home: current.home, readId: current.readId, rows: current.index.ask(typed) } : { ready: false }),
    close() { turn++; current?.index.close(); current = undefined; },
  };
}

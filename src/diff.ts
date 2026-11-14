// Line and word diffs for reviewing a change: exact, small, with long unchanged runs folded. Pure: drawing them is the caller's
// (the Instructions page's cards; an item's versions and copies: versionlist.ts, matrix.ts, copywords.ts).
/** A line diff, small and exact: unchanged, removed and added lines in order (longest common subsequence). */
export function lineDiff(before: string, after: string): { kind: 'same' | 'removed' | 'added'; text: string }[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n');
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const out: { kind: 'same' | 'removed' | 'added'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) out.push({ kind: 'removed', text: a[i++] });
    else out.push({ kind: 'added', text: b[j++] });
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] });
  while (j < b.length) out.push({ kind: 'added', text: b[j++] });
  return out;
}

export type Line = { kind: 'same' | 'removed' | 'added'; text: string };
/** A long file's unchanged runs fold to one row, keeping three lines of context on each side of a change. */
export function folded(diff: Line[], full: boolean): (Line | { kind: 'fold'; count: number })[] {
  if (full) return diff;
  const near = diff.map((_, index) => diff.slice(Math.max(0, index - 3), index + 4).some(line => line.kind !== 'same'));
  const out: (Line | { kind: 'fold'; count: number })[] = [];
  for (let index = 0; index < diff.length;) {
    if (near[index]) { out.push(diff[index++]); continue; }
    let end = index;
    while (end < diff.length && !near[end]) end++;
    if (end - index < 4) out.push(...diff.slice(index, end)); else out.push({ kind: 'fold', count: end - index });
    index = end;
  }
  return out;
}

/**
 * A word diff of two texts, line breaks kept: each word or run of spaces as unchanged, removed (only in `before`) or added
 * (only in `after`), in order. Reading a version against the current one (versionlist.ts) shows both.
 */
export function wordDiff(before: string, after: string): Line[] {
  // Each token on a line of its own for lineDiff; a line break inside a run of spaces travels as \u0000 and comes back.
  const tokens = (text: string) => text.split(/(\s+)/).filter(Boolean).map(token => token.replace(/\n/g, '\u0000')).join('\n');
  return lineDiff(tokens(before), tokens(after)).map(part => ({ ...part, text: part.text.replace(/\u0000/g, '\n') }));
}

/**
 * What Read shows of a version against the current one (versionlist.ts), line by line: where a line changed a little, its
 * own words tinted (added) and the current one's it lacks struck (removed), neighbouring marks as one; where a line changed
 * mostly (fewer than half its words kept), the current one's line whole, struck, then this one's whole, tinted.
 */
export function readAgainst(current: string, text: string): Line[] {
  const out: Line[] = [];
  const push = (kind: Line['kind'], piece: string) => { const last = out.at(-1); if (last?.kind === kind) last.text += piece; else if (piece) out.push({ kind, text: piece }); };
  const lines = lineDiff(current, text);
  for (let index = 0; index < lines.length;) {
    if (lines[index].kind === 'same') { push('same', `${lines[index++].text}\n`); continue; }
    const gone: string[] = [], came: string[] = [];
    for (; index < lines.length && lines[index].kind !== 'same'; index++) (lines[index].kind === 'removed' ? gone : came).push(lines[index].text);
    const before = gone.join('\n'), after = came.join('\n');
    if (!gone.length || !came.length || mostlyChanged(before, after)) {
      if (gone.length) push('removed', `${before}\n`);
      if (came.length) push('added', `${after}\n`);
    } else {
      for (const run of wordRuns(before, after)) push(run.kind, run.text);
      push('same', '\n');
    }
  }
  // As this version ends: with a line break, or without one.
  const last = out.at(-1);
  if (last && !text.endsWith('\n') && last.text.endsWith('\n')) last.text = last.text.slice(0, -1);
  return out.filter(run => run.text);
}

/** Whether fewer than half the words of the longer of two lines are kept in the other. */
function mostlyChanged(before: string, after: string) {
  const words = wordDiff(before, after).filter(part => part.text.trim()), count = (kind: Line['kind']) => words.filter(part => part.kind === kind).length;
  const kept = count('same');
  return kept * 2 < Math.max(kept + count('removed'), kept + count('added'));
}

/** A line's word marks: a space joins the mark on both its sides, any other space reads plain once; a line break only the current one has is left out. */
function wordRuns(before: string, after: string): Line[] {
  const parts = wordDiff(before, after).filter(part => !(part.kind === 'removed' && part.text.includes('\n') && !part.text.trim()));
  const runs: Line[] = [];
  parts.forEach((part, index) => {
    const previous = parts[index - 1]?.kind, next = parts[index + 1]?.kind;
    const kind = part.text.trim() ? part.kind : previous === next && previous !== 'same' ? previous! : 'same';
    if (runs.at(-1)?.kind === 'removed' && kind === 'added') runs.push({ kind: 'same', text: ' ' });
    if (runs.at(-1)?.kind === kind) runs.at(-1)!.text += part.text;
    else runs.push({ kind, text: kind === 'same' && !part.text.trim() && part.kind === 'removed' ? ' ' : part.text });
  });
  return runs;
}


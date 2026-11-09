// Line diffs for reviewing a change: exact, small, with long unchanged runs folded.
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

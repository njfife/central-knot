// Merge for a skill (library.ts MERGE; the pass asks it through librarypass.ts Kind.merge, as skills.ts skillKind's `merge`):
// three versions' folders read (share.ts readTree), which side each path takes asked of library.ts mergeFiles, the merged
// folder made from those sides, a file both sides changed merged by git merge-file, and the result stored as a version of the
// skill (skillstore.ts storeVersion). Everything it makes on the way is in one folder of its own in .central-knot/
// (merging-…), removed before it returns, whatever happens. Bytes are copied as they are: nothing is normalised.
// Not here: which side a path takes (mergeFiles), what Merge changes in the library and History (librarypass.ts mergeIn), and
// any tool's folder (the plan writes the merged version where the skill is On).
import { chmod, copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mergeFiles, type LibraryItem, type PathIs } from './library.ts';
import type { MergeResult } from './librarypass.ts';
import { runGit } from './plugins.ts';
import { errorCode, plainError, readTree, removeTree, storeDirectory, type ShareContext, type Tree } from './share.ts';
import { readVersion, storeVersion, type SkillContent } from './skillstore.ts';

/** A folder's paths as mergeFiles compares them: each folder, and each file by its bytes' hash and its executable bit. */
const pathsOf = (tree: Tree) => new Map<string, PathIs>([...tree.directories.map(path => [path, 'folder'] as const),
  ...[...tree.files].map(([path, file]) => [path, { sha256: file.sha256, exec: (file.mode & 0o111) !== 0 }] as const)]);

/** Merges the source's version of a skill into yours against the base (librarypass.ts Kind.merge). */
export async function mergeSkill(context: ShareContext, item: LibraryItem, folders: Record<'base' | 'yours' | 'theirs', SkillContent>): Promise<MergeResult<SkillContent>> {
  const trees = { base: await readTree(folders.base.directory), yours: await readTree(folders.yours.directory), theirs: await readTree(folders.theirs.directory) };
  const { merged, conflicts } = mergeFiles(pathsOf(trees.base), pathsOf(trees.yours), pathsOf(trees.theirs));
  if (conflicts.length) return { conflicts };
  const work = await mkdtemp(join(storeDirectory(context.home), 'merging-')), out = join(work, 'skill');
  try {
    await mkdir(out);
    const lines: string[] = [];
    for (const [path, is] of merged) {
      const target = join(out, path);
      if (is === 'folder') { await mkdir(target, { recursive: true }); continue; }
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(folders[is.bytes === 'theirs' ? 'theirs' : 'yours'].directory, path), target);
      if (is.bytes === 'line-merge') lines.push(path);
      await chmod(target, trees[is.mode].files.get(path)!.mode);
    }
    // Yours, copied into place, takes the line merge (git merge-file writes it there): exit 0 is a clean merge, any other a conflict.
    for (const path of lines) {
      const done = await runGit(['merge-file', '-q', join(out, path), join(folders.base.directory, path), join(folders.theirs.directory, path)], 30_000);
      if (done.code === 'missing') return { couldNot: 'Git is not installed, so the files both sides changed can’t be merged. Install Git, then try again.' };
      if (done.code === 'timeout') return { couldNot: 'Git took too long to merge the files both sides changed.' };
      if (done.code !== 0) conflicts.push(path);
    }
    if (conflicts.length) return { conflicts };
    const hash = (await readTree(out)).hash;
    await storeVersion(context, item.key, { directory: out, hash });
    return { merged: (await readVersion(context, item.key, hash))! };
  } catch (error) {
    if (!errorCode(error)) throw error;
    return { couldNot: plainError(error) };
  } finally { await removeTree(work); }
}

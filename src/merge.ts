// Merge for every kind a source brings (library.ts MERGE; the pass asks it through librarypass.ts Kind.merge, which a kind
// in sources.ts's table must have): each kind's merge, and the line merge they share (`lineMerge`: git merge-file on one part
// both sides changed, answering clean, conflict, Git missing or timeout). Which side each part takes is library.ts mergeFiles's
// table, given each kind's parts:
// - a skill's (`mergeSkill`): the paths of its three versions' folders (share.ts readTree); the merged folder is made from
//   those sides, a file both sides changed merged by lineMerge; a conflict is named by its path ("SKILL.md");
// - an agent's (`mergeAgent`): three parts, its name, description and prompt, each compared whole; one both sides changed is
//   merged by lineMerge (a one-line name or description changed both ways conflicts there); a conflict is named in words ("the
//   prompt").
// The merged content is stored as a version of the item (the kind's store) before it is answered. Everything a merge makes on
// the way is in one folder of its own in .central-knot/ (merging-…), removed before it returns (a crash midway can leave it).
// Bytes are copied as they are: nothing is normalised. A conflict found by comparing the parts still lets the line merges run,
// so one answer names every conflicting part.
// Not here: which side a part takes (mergeFiles), what Merge changes in the library and History (librarypass.ts mergeIn), and
// any tool's folder (the plan writes the merged version where the item is On).
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { agentHash, type SharedAgent } from './agentfiles.ts';
import { storeVersion as storeAgentVersion } from './agentstore.ts';
import { mergeFiles, type LibraryItem, type Merged, type PathIs } from './library.ts';
import type { MergeResult } from './librarypass.ts';
import { runGit } from './plugins.ts';
import { errorCode, plainError, readTree, removeTree, sha256, storeDirectory, type ShareContext, type Tree } from './share.ts';
import { readVersion, storeVersion, type SkillContent } from './skillstore.ts';

/**
 * The line merge of one part both sides changed: git merge-file writes it into `yours` (a file, changed in place) from the base
 * and theirs. Clean (`clean`), lines that clash (`conflict`), or why it couldn't run (`couldNot`: Git missing, or too slow).
 */
export async function lineMerge(yours: string, base: string, theirs: string): Promise<'clean' | 'conflict' | { couldNot: string }> {
  const done = await runGit(['merge-file', '-q', yours, base, theirs], 30_000);
  if (done.code === 'missing') return { couldNot: 'Git is not installed, so the files both sides changed can’t be merged. Install Git, then try again.' };
  if (done.code === 'timeout') return { couldNot: 'Git took too long to merge the files both sides changed.' };
  return done.code === 0 ? 'clean' : 'conflict';
}

/** A folder's paths as mergeFiles compares them: each folder, and each file by its bytes' hash and its executable bit. */
const pathsOf = (tree: Tree) => new Map<string, PathIs>([...tree.directories.map(path => [path, 'folder'] as const),
  ...[...tree.files].map(([path, file]) => [path, { sha256: file.sha256, exec: (file.mode & 0o111) !== 0 }] as const)]);

/** Runs a merge in a work folder of its own in .central-knot/ (merging-…), removed after; a file it couldn't read or write is why it couldn't run. */
async function inWorkFolder<Content>(context: ShareContext, merge: (work: string) => Promise<MergeResult<Content>>): Promise<MergeResult<Content>> {
  const work = await mkdtemp(join(storeDirectory(context.home), 'merging-'));
  try { return await merge(work); }
  catch (error) {
    if (!errorCode(error)) throw error;
    return { couldNot: plainError(error) };
  } finally { await removeTree(work); }
}

/** Merges the source's version of a skill into yours against the base (librarypass.ts Kind.merge). */
export async function mergeSkill(context: ShareContext, item: LibraryItem, folders: Record<'base' | 'yours' | 'theirs', SkillContent>): Promise<MergeResult<SkillContent>> {
  const trees = { base: await readTree(folders.base.directory), yours: await readTree(folders.yours.directory), theirs: await readTree(folders.theirs.directory) };
  const { merged, conflicts } = mergeFiles(pathsOf(trees.base), pathsOf(trees.yours), pathsOf(trees.theirs));
  return inWorkFolder<SkillContent>(context, async work => {
    const out = join(work, 'skill');
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
    // Yours, copied into place, takes the line merge.
    for (const path of lines) {
      const done = await lineMerge(join(out, path), join(folders.base.directory, path), join(folders.theirs.directory, path));
      if (typeof done === 'object') return done;
      if (done === 'conflict') conflicts.push(path);
    }
    if (conflicts.length) return { conflicts: conflicts.sort() };
    const hash = (await readTree(out)).hash;
    await storeVersion(context, item.key, { directory: out, hash });
    return { merged: (await readVersion(context, item.key, hash))! };
  });
}

/** An agent's parts as a merge compares them, and each one's words in a conflict. */
const AGENT_PARTS: Record<keyof SharedAgent, string> = { name: 'the name', description: 'the description', prompt: 'the prompt' };

/** Merges the source's version of an agent into yours against the base (librarypass.ts Kind.merge), part by part. */
export async function mergeAgent(context: ShareContext, item: LibraryItem, three: Record<'base' | 'yours' | 'theirs', SharedAgent>): Promise<MergeResult<SharedAgent>> {
  const partsOf = (agent: SharedAgent) => new Map(Object.keys(AGENT_PARTS).map(part => [part, { sha256: sha256(agent[part as keyof SharedAgent]), exec: false }]));
  const { merged, conflicts } = mergeFiles(partsOf(three.base), partsOf(three.yours), partsOf(three.theirs));
  const out: SharedAgent = { ...three.yours }, lines: (keyof SharedAgent)[] = [];
  // A part name holds no "/", so mergeFiles makes no folder of it.
  for (const [part, is] of merged as Map<keyof SharedAgent, Exclude<Merged, 'folder'>>) {
    if (is.bytes === 'theirs') out[part] = three.theirs[part];
    if (is.bytes === 'line-merge') lines.push(part);
  }
  return inWorkFolder<SharedAgent>(context, async work => {
    for (const part of lines) {
      const [yours, base, theirs] = (['yours', 'base', 'theirs'] as const).map(side => join(work, `${part}.${side}`));
      await Promise.all([writeFile(yours, three.yours[part]), writeFile(base, three.base[part]), writeFile(theirs, three.theirs[part])]);
      const done = await lineMerge(yours, base, theirs);
      if (typeof done === 'object') return done;
      if (done === 'conflict') conflicts.push(part);
      else out[part] = await readFile(yours, 'utf8');
    }
    if (conflicts.length) return { conflicts: (Object.keys(AGENT_PARTS) as (keyof SharedAgent)[]).filter(part => conflicts.includes(part)).map(part => AGENT_PARTS[part]) };
    await storeAgentVersion(context, item.key, agentHash(out), out);
    return { merged: out };
  });
}

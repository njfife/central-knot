// Stages a custom build (ORG-01): a build of the app with its own name and identity that can carry a marketplace, every
// plugin's files included. `npm run package:mac -- <inputs>` stages and packages in one go; run by itself, this only stages,
// for a development run of the build on any system:
//
//   node scripts/custom-build.mjs --marketplace acme/plugins --app-name "Acme Knot" [--out build/custom]
//   CK_CUSTOM_BUILD=build/custom npm start
//
// Inputs, all optional (none of them: the standard app, and nothing is staged):
//   --marketplace <owner/repo | Git URL | folder>   the marketplace to carry, fetched with this computer's own Git sign-in
//   --app-name "<name>"                             the app's name (required for a custom build): under its own name it sits beside the standard app
//   --app-id <id>                                   its identity (settings folder, bundle id); made from the app's name when left out
//   --app-icon <file.png | file.icns>               the app's icon (a 1024 by 1024 .png, or a Mac .icns)
//   --marketplace-name "<name>"                     how the carried marketplace is named in the app
//   --marketplace-logo <file.png | .svg | .jpg>     its picture in the app
//   --sequence <number>                             the release's place in the order of releases (default: the time it is made)
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildInputs, isCustom, stageCustomBuild } from '../src/bundlepack.ts';

/** Stages the custom build `inputs` describe in `out`, and returns what was staged with its report. */
export async function stage(inputs, out = 'build/custom') {
  const work = await mkdtemp(join(tmpdir(), 'ck-custom-build-'));
  try { return { ...(await stageCustomBuild(inputs, { out, work })), out: resolve(out) }; }
  finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const { inputs, rest } = buildInputs(process.argv.slice(2));
  const at = rest.findIndex(arg => arg === '--out' || arg.startsWith('--out='));
  const out = at < 0 ? undefined : rest[at].startsWith('--out=') ? rest.splice(at, 1)[0].slice('--out='.length) : rest.splice(at, 2)[1];
  if (rest.length || (at >= 0 && !out)) { console.error(`Not a build input: ${rest.join(' ') || '--out needs a folder'}. The inputs are listed at the top of scripts/custom-build.mjs.`); process.exit(2); }
  if (!isCustom(inputs)) { console.error('No build input was given, so there is nothing to stage: that is the standard app.'); process.exit(2); }
  try {
    const staged = await stage(inputs, out);
    console.log(`${staged.report}\nStaged in ${staged.out}`);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}

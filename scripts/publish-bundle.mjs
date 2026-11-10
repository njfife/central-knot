// Publishes a new release of a bundled build's marketplace to its feed (ORG-05): packs the marketplace as the build does and
// writes the release into the folder the feed serves. Installed copies of the build read that folder's address (the build's
// --feed) and take the release by themselves; no new app build is needed.
//
//   node scripts/publish-bundle.mjs --marketplace acme/plugins --out ./feed
//
//   --marketplace <owner/repo | Git URL | folder>   the marketplace to publish, fetched with this computer's own Git sign-in
//   --out <folder>                                  the folder the feed serves (it keeps release.json and the archive)
//   --sequence <number>                             its place in the order of releases (default: the time it is made); must
//                                                   be higher than the one already in --out
//   --min-app <version>                             the oldest app version that can use it; older apps wait for their update
//
// Nothing is published when the marketplace can't be read or a plugin's files couldn't be fetched this time. A plugin that
// can never be packed (an npm package) is left out and named. The command prints what was published and exits 0, or says
// why nothing was and exits 1.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishRelease } from '../src/bundlepack.ts';

const args = process.argv.slice(2);
const values = {};
for (let at = 0; at < args.length; at++) {
  const [name, inline] = args[at].split(/=(.*)/s);
  if (!['--marketplace', '--out', '--sequence', '--min-app'].includes(name)) { console.error(`Not an input: ${args[at]}. The inputs are listed at the top of scripts/publish-bundle.mjs.`); process.exit(2); }
  const value = inline ?? args[++at];
  if (!value || (inline === undefined && value.startsWith('--'))) { console.error(`${name} needs a value.`); process.exit(2); }
  values[name] = value;
}
if (!values['--marketplace'] || !values['--out']) { console.error('Give the marketplace and the feed’s folder: --marketplace <owner/repo, Git URL or folder> --out <folder>.'); process.exit(2); }
if (values['--sequence'] !== undefined && !/^\d{1,15}$/.test(values['--sequence'])) { console.error('--sequence takes a whole number: a later release has a higher one.'); process.exit(2); }
const work = await mkdtemp(join(tmpdir(), 'ck-publish-'));
try {
  const published = await publishRelease({ source: values['--marketplace'], out: values['--out'], work, sequence: values['--sequence'] === undefined ? undefined : Number(values['--sequence']), minApp: values['--min-app'] });
  if ('problem' in published) { console.error(published.problem); process.exitCode = 1; } else console.log(published.report);
} finally { await rm(work, { recursive: true, force: true }); }

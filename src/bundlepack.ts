// The build side of a custom build (ORG-01, ORG-02, ORG-06): reads the optional build inputs, packs a marketplace into one
// release (bundle.ts), and stages what the app's build then takes in. Nothing here needs a Mac or Electron, so the same code
// runs in a local build, in CI and in tests. What a marketplace holds is copied as it is: only the fetch's own .git folders
// stay behind, and an entry is rewritten only to point at files that were fetched from elsewhere for it.
import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { BUILD_ID, CARRIED_FOLDER, CUSTOM_FILE, RELEASE_FILE, feedAddress, fileDigest, packArchive, pointEntries, readRelease, releaseLabel, type BundleRelease, type CustomBuild } from './bundle.ts';
import { CODEX_MANIFEST, MANIFEST, sourceLabel } from './catalogdetail.ts';
import { parseCatalog, readCatalog, readRemotePlugin, type PluginContext } from './plugins.ts';
import { isFolder, record, text } from './values.ts';
import { downloadName, lineApp } from './updates.ts';
import type { CatalogPlugin } from './types.ts';

// ---------- The build's optional inputs ----------

/** The standard app's name, which no custom build may take. */
export const STANDARD_NAME = 'Central Knot';

/** The optional inputs a build takes. None given: the standard app. */
export interface BuildInputs {
  /** The marketplace to carry: owner/repo, a Git URL or a folder. */
  marketplace?: string;
  appName?: string;
  appId?: string;
  /** The app's icon: a .png (1024 by 1024) or a Mac .icns. */
  appIcon?: string;
  marketplaceName?: string;
  marketplaceLogo?: string;
  /** The release's place in the order of releases; the time it was made when not given. */
  sequence?: number;
  /** Where newer releases of the marketplace will be published: an http or https address of a folder. */
  feed?: string;
}

const OPTIONS: Record<string, keyof BuildInputs> = {
  '--marketplace': 'marketplace', '--app-name': 'appName', '--app-id': 'appId', '--app-icon': 'appIcon',
  '--marketplace-name': 'marketplaceName', '--marketplace-logo': 'marketplaceLogo', '--sequence': 'sequence', '--feed': 'feed',
};

/**
 * The build inputs among a command line's arguments (`--name value` or `--name=value`), and the arguments that are not
 * build inputs, left for the caller. An input given without a value, or twice, is an error said in plain words.
 */
export function buildInputs(args: string[]): { inputs: BuildInputs; rest: string[] } {
  const inputs: BuildInputs = {};
  const rest: string[] = [];
  for (let at = 0; at < args.length; at++) {
    const [name, inline] = args[at]!.split(/=(.*)/s) as [string, string | undefined];
    const key = OPTIONS[name];
    if (!key) { rest.push(args[at]!); continue; }
    const value = inline ?? args[++at];
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) throw new Error(`${name} needs a value.`);
    if (inputs[key] !== undefined) throw new Error(`${name} was given twice.`);
    if (key === 'sequence') {
      if (!/^\d{1,15}$/.test(value)) throw new Error('--sequence takes a whole number: a later release has a higher one.');
      inputs.sequence = Number(value);
    } else inputs[key] = value;
  }
  return { inputs, rest };
}

/** Whether any optional input was given: any one makes the build a custom build, with its own identity (ORG-01). */
export const isCustom = (inputs: BuildInputs) => Object.values(inputs).some(value => value !== undefined);

/** An identity from a name: "Acme Knot" is "acme-knot". */
const slug = (name: string) => name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/**
 * The custom build these inputs describe, or why they describe none. Every custom build is given its name: left with the
 * standard app's, its file would take the standard app's place in Applications. Marketplace branding with no marketplace
 * is refused rather than built without one. The identity is `--app-id`, else made from the name.
 */
export function describeBuild(inputs: BuildInputs): CustomBuild {
  if (!inputs.marketplace && (inputs.marketplaceName || inputs.marketplaceLogo)) throw new Error('--marketplace-name and --marketplace-logo are for a build that carries a marketplace: add --marketplace.');
  if (!inputs.marketplace && inputs.sequence !== undefined) throw new Error('--sequence orders a carried marketplace’s releases: add --marketplace.');
  if (!inputs.marketplace && inputs.feed !== undefined) throw new Error('--feed is where newer releases of a carried marketplace come from: add --marketplace, the release the build starts with.');
  const feed = inputs.feed === undefined ? undefined : feedAddress(inputs.feed);
  if (inputs.feed !== undefined && !feed) throw new Error('--feed takes an http or https address: the folder release.json and its archive are published in.');
  if (inputs.appName === undefined) throw new Error(`A custom build needs its own name: add --app-name "<name>". Under the standard app’s name it would take that app’s place in Applications.`);
  const name = inputs.appName.trim();
  // The name is also the app's file name, so nothing a file name can't hold as written.
  if (!name || name.length > 60 || /[\\/:?*"<>|\n\r\t]/.test(name) || name.startsWith('.') || name.endsWith('.')) throw new Error('--app-name is the app’s name as people see it, and its file’s name: up to 60 characters, without / \\ : ? * " < > | or line breaks, and not starting or ending with a period.');
  // Nor a release line's app's name (the standard app's or the alpha's, updates.ts lineApp): its file would take that app's place.
  for (const taken of [STANDARD_NAME, lineApp('alpha').name]) {
    if (downloadName(name).toLowerCase() === downloadName(taken).toLowerCase()) throw new Error(`--app-name can’t be “${taken}”: under that name the build’s file would take that app’s place in Applications.`);
  }
  const id = inputs.appId ?? slug(name);
  if (!BUILD_ID.test(id) || id === 'central-knot') throw new Error(inputs.appId ? '--app-id is lower-case letters, digits, dots and dashes (not “central-knot”, the standard app’s).' : 'Give the build an identity with --app-id: lower-case letters, digits, dots and dashes.');
  for (const [option, file, kinds] of [['--app-icon', inputs.appIcon, ['.png', '.icns']], ['--marketplace-logo', inputs.marketplaceLogo, ['.png', '.svg', '.jpg', '.jpeg', '.webp']]] as const) {
    if (file && !(kinds as readonly string[]).includes(extname(file).toLowerCase())) throw new Error(`${option} takes a ${kinds.join(' or ')} file.`);
  }
  return { id, name, bundleId: `com.centralknot.custom.${id}`,
    ...(inputs.marketplace ? { marketplace: { ...(inputs.marketplaceName?.trim() ? { displayName: inputs.marketplaceName.trim() } : {}), ...(inputs.marketplaceLogo ? { logo: `marketplace-logo${extname(inputs.marketplaceLogo).toLowerCase()}` } : {}) } } : {}),
    ...(feed ? { feed } : {}) };
}

// ---------- Packing a marketplace ----------

const exists = (path: string) => stat(path).then(() => true, () => false);
/**
 * The commit a folder is at, when it is a Git repository's own top folder (a folder inside some other repository names no
 * commit of its own), with a note when it holds changes that commit doesn't.
 */
const gitCommit = (folder: string) => new Promise<string>(done => execFile('git', ['-C', folder, 'rev-parse', '--show-prefix', 'HEAD'], { encoding: 'utf8' }, (error, out) => {
  const [prefix, head] = error ? [] : out.split('\n');
  if (error || prefix !== '' || !head) { done(''); return; }
  execFile('git', ['-C', folder, 'status', '--porcelain'], { encoding: 'utf8' }, (failed, changes) => done(`${head.slice(0, 10)}${!failed && changes.trim() ? ' with changes not committed' : ''}`));
}));

/**
 * The folder a `--marketplace` value names, as a full path, or undefined when it names a Git source. A folder may be given
 * by a relative path: one that says so (./market, ../market, ~/market) or one that is a marketplace folder here. Otherwise
 * `acme/plugins` is the GitHub repository.
 */
async function folderGiven(source: string): Promise<string | undefined> {
  const given = source.trim();
  if (isFolder(given)) return resolve(given);
  if (/^~([\\/]|$)/.test(given)) return resolve(homedir(), given.slice(2));
  if (/^\.\.?([\\/]|$)/.test(given)) return resolve(given);
  if (/^[\w.-]+@|:\/\//.test(given)) return undefined;
  const here = resolve(given);
  return (await exists(join(here, MANIFEST))) || (await exists(join(here, CODEX_MANIFEST))) ? here : undefined;
}

/** Copies a folder as it is (modes and links kept), without the .git folder at its top: the fetch's own, never content. */
const copyTree = (from: string, to: string) => cp(from, to, { recursive: true, verbatimSymlinks: true, filter: source => resolve(source) !== resolve(from, '.git') });

/** Why a plugin whose files aren't in the marketplace can't be packed, from its entry. */
function whyNotFetched(plugin: CatalogPlugin): string {
  const source = record(plugin.entry?.source);
  const kind = text(source?.source);
  if (typeof plugin.entry?.source === 'string') return `Its folder (${plugin.entry.source}) is not in the marketplace.`;
  if ((kind === 'npm' || kind === 'pip') && text(source?.package)) return `Its files are ${kind === 'npm' ? 'an npm' : 'a pip'} package (${text(source?.package)}), which can’t be packed into the app.`;
  return plugin.from ? `Its files are kept at ${plugin.from.label}, which can’t be packed into the app.` : 'Its entry doesn’t say where its files are.';
}

/**
 * Packs one release of a marketplace into `out`: release.json and the archive it names. `source` is owner/repo, a Git URL
 * (fetched with this computer's own Git sign-in into `work`) or a folder. Every plugin's files go in: one kept in another
 * repository is fetched and its entry pointed at the copy, which sits in a folder of its own in the archive (the manifest
 * is then written again as JSON: every value as it was, its layout not). A plugin that
 * can't be fetched is named in `unpackaged` with the reason; its entry stays as written, and the release is still made.
 */
export async function packRelease({ source, out, work, sequence, minApp, now = new Date(), fetchPlugin = readRemotePlugin }: { source: string; out: string; work: string; sequence?: number; /** The oldest app version that can use the release. */ minApp?: string; now?: Date; /** Fetches a plugin kept in another repository; replaceable in tests. */ fetchPlugin?: typeof readRemotePlugin }): Promise<{ release: BundleRelease; /** What whoever makes the release should know about it, beyond what is packed. */ notes: string[]; /** Plugins left out because fetching their files failed this time (another try may pack them), not because they can never be packed. */ failedNow: string[] } | { problem: string }> {
  const context: PluginContext = { home: work, dataDir: join(work, 'fetched'), binaries: {} };
  const where = (await folderGiven(source)) ?? source.trim();
  const catalog = await readCatalog(context, where);
  if (catalog.problem || !catalog.root) return { problem: `The marketplace (${source}) could not be read: ${catalog.problem ?? 'it has no files.'}` };
  const commit = await gitCommit(catalog.root);
  const stage = join(work, 'snapshot');
  await rm(stage, { recursive: true, force: true });
  await copyTree(catalog.root, stage);

  // Plugins kept elsewhere: fetched, copied into a folder of their own, and their entries pointed there.
  let held = '_bundled';
  for (let n = 2; await exists(join(stage, held)); n++) held = `_bundled-${n}`;
  const moved = new Map<string, string>();
  const unpackaged: BundleRelease['unpackaged'] = [];
  const failedNow: string[] = [];
  for (const plugin of catalog.plugins) {
    if (plugin.folder) {
      // A folder that is there but empty (a submodule, which a fetch leaves empty) holds nothing to install.
      const files = await readdir(plugin.folder).catch(() => undefined);
      if (!files?.length) unpackaged.push({ name: plugin.name, reason: files ? `Its folder (${plugin.entry?.source}) is empty in the marketplace; a plugin kept as a Git submodule isn’t fetched.` : whyNotFetched(plugin) });
      continue;
    }
    if (!plugin.remote) { unpackaged.push({ name: plugin.name, reason: whyNotFetched(plugin) }); continue; }
    const copy = await fetchPlugin(context, plugin.remote);
    if ('problem' in copy) { failedNow.push(plugin.name); unpackaged.push({ name: plugin.name, reason: `Its files couldn’t be fetched from ${plugin.from?.label ?? plugin.remote.url}: ${copy.problem}` }); continue; }
    await mkdir(join(stage, held), { recursive: true });
    await cp(copy.folder, join(stage, held, plugin.name), { recursive: true, verbatimSymlinks: true, filter: path => resolve(path) !== resolve(copy.root, '.git') });
    moved.set(plugin.name, `./${held}/${plugin.name}`);
  }
  if (moved.size) await pointEntries(stage, moved);
  // What the archive holds is read once more, as the app will read it: a plugin counts as packed only if it is found there.
  const packed = await parseCatalog(stage, stage, 'folder', { counts: false });
  if (packed.problem) return { problem: `The packed marketplace could not be read back: ${packed.problem}` };
  const missing = new Set(unpackaged.map(item => item.name));
  for (const plugin of packed.plugins) if (!plugin.folder && !missing.has(plugin.name)) unpackaged.push({ name: plugin.name, reason: 'Its files are not in the packed marketplace.' });
  const left = new Set(unpackaged.map(item => item.name));

  const order = sequence ?? Math.floor(now.getTime() / 1000);
  const archive = `content-${order}.tgz`;
  await mkdir(out, { recursive: true });
  const failed = await packArchive(stage, join(out, archive));
  if (failed) return { problem: `The marketplace could not be packed: ${failed}` };
  const release: BundleRelease = { format: 1, marketplace: packed.name, sequence: order, madeAt: now.toISOString(),
    from: `${sourceLabel(where)}${commit ? ` at ${commit}` : ''}`, archive, ...(await fileDigest(join(out, archive))),
    plugins: packed.plugins.filter(plugin => !left.has(plugin.name)).map(plugin => ({ name: plugin.name, ...(plugin.version ? { version: plugin.version } : {}) })), unpackaged, ...(minApp ? { minApp } : {}) };
  await writeFile(join(out, RELEASE_FILE), `${JSON.stringify(release, null, 2)}\n`);
  await rm(stage, { recursive: true, force: true });
  return { release, failedNow, notes: packed.copilotRefuses ? [`${packed.copilotRefuses} It then installs none of this marketplace’s plugins whole, for anyone, until that entry is taken out of the marketplace.`] : [] };
}

// ---------- Staging a custom build ----------

/** A staged custom build: what the app's build takes in (scripts/build.mjs), and the report of what was made. */
export interface StagedBuild { build: CustomBuild; release?: BundleRelease; /** The app icon as given, copied beside the rest. */ icon?: string; report: string }

/**
 * Stages a custom build in `out` from the inputs: custom-build.json, the carried release under bundle/ with the marketplace's
 * logo, the app icon, and build-report.txt. `work` is scratch space for the fetch. The report says what the build is, what
 * it carries, each plugin that could not be packed, and that it has no update location and no content feed.
 */
export async function stageCustomBuild(inputs: BuildInputs, { out, work, now }: { out: string; work: string; now?: Date }): Promise<StagedBuild> {
  // The inputs are checked before anything is fetched.
  const build = describeBuild(inputs);
  for (const [option, file] of [['--app-icon', inputs.appIcon], ['--marketplace-logo', inputs.marketplaceLogo]] as const) {
    if (file && !(await stat(file).then(found => found.isFile(), () => false))) throw new Error(`${option}: there is no file at ${file}.`);
  }
  // Only a folder staged before (or an empty one) is cleared: any other folder is someone's own.
  const there = await readdir(out).catch(() => [] as string[]);
  if (there.length && !there.includes(CUSTOM_FILE)) throw new Error(`${out} holds other files. Stage into an empty folder, or one staged before.`);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  // Written first: a staging that stops halfway leaves a folder the next one may clear.
  await writeFile(join(out, CUSTOM_FILE), `${JSON.stringify(build, null, 2)}\n`);
  let release: BundleRelease | undefined, notes: string[] = [];
  if (inputs.marketplace) {
    const packed = await packRelease({ source: inputs.marketplace, out: join(out, CARRIED_FOLDER), work, sequence: inputs.sequence, now });
    if ('problem' in packed) throw new Error(packed.problem);
    ({ release, notes } = packed);
  }
  if (inputs.marketplaceLogo && build.marketplace?.logo) await copyFile(inputs.marketplaceLogo, join(out, CARRIED_FOLDER, build.marketplace.logo));
  const icon = inputs.appIcon ? `app-icon${extname(inputs.appIcon).toLowerCase()}` : undefined;
  if (icon) await copyFile(inputs.appIcon!, join(out, icon));
  const report = buildReport(build, release, inputs, notes);
  await writeFile(join(out, 'build-report.txt'), report);
  return { build, release, icon, report };
}

/** The build report: what was built, in plain lines. */
export function buildReport(build: CustomBuild, release: BundleRelease | undefined, inputs: BuildInputs, notes: string[] = []): string {
  const lines = [
    `${build.name}: a custom build of ${STANDARD_NAME}`,
    '',
    `Identity: ${build.id} (${build.bundleId}). Its settings are its own: it installs beside the standard app and never shares its settings.`,
    `App name: ${build.name}`,
    `App icon: ${inputs.appIcon ? basename(inputs.appIcon) : 'the standard icon'}`,
  ];
  if (release) {
    lines.push('',
      `Marketplace: ${release.marketplace}${build.marketplace?.displayName ? `, shown as “${build.marketplace.displayName}”` : ''}${inputs.marketplaceLogo ? `, with the logo ${basename(inputs.marketplaceLogo)}` : ''}`,
      `Release: ${releaseLabel(release)}, sequence ${release.sequence}`,
      `Archive: ${release.archive}, ${release.size} bytes, SHA-256 ${release.sha256}`,
      `Plugins packed (${release.plugins.length}): ${release.plugins.map(plugin => `${plugin.name}${plugin.version ? ` ${plugin.version}` : ''}`).join(', ') || 'none'}`);
    if (release.unpackaged.length) lines.push(`NOT PACKED (${release.unpackaged.length}): the build carries no files for these, and it offers no install of them.`, ...release.unpackaged.map(item => `  - ${item.name}: ${item.reason}`));
    lines.push(...notes.map(note => `Note: ${note}`));
  } else lines.push('', 'Marketplace: none. This build carries no marketplace.');
  lines.push('',
    'App updates: not met. No update location is configured, so this build does not update itself. It never uses the standard app’s updates.',
    !release ? 'Content feed: none (no marketplace is carried).'
      : build.feed ? `Content feed: ${build.feed} The app reads release.json there, and the archive it names, and takes a release with a higher sequence than the one it has. Publish with scripts/publish-bundle.mjs.`
        : 'Content feed: not met. No feed is configured (--feed), so the carried marketplace changes only with a new build.');
  return `${lines.join('\n')}\n`;
}

// ---------- Publishing a release to a feed ----------

/**
 * Publishes a new release of a marketplace into `out`, the folder a feed serves (ORG-05, D-35): the archive first, then
 * release.json, so a copy of the folder taken at any moment never names an archive that isn't there. Nothing is written
 * unless the whole release can be: a plugin whose files couldn't be fetched this time holds the release (another try may
 * pack it, and a release must not lose a plugin to a hiccup), while one that can never be packed (an npm package) is left
 * out and named, as in a build. The sequence must be higher than the one `out` already holds, and the marketplace the same.
 */
export async function publishRelease(input: { source: string; out: string; work: string; sequence?: number; minApp?: string; now?: Date; fetchPlugin?: typeof readRemotePlugin }): Promise<{ release: BundleRelease; report: string } | { problem: string }> {
  if (input.minApp !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(input.minApp)) return { problem: '--min-app takes an app version, such as 0.6.0.' };
  const before = await readRelease(join(input.out, RELEASE_FILE));
  const notHigher = (sequence: number) => `Nothing was published. Its sequence (${sequence}) must be higher than the one already published there (${before!.sequence}): installed copies take only a higher one.`;
  // A number given by hand is checked before anything is fetched; the time-based default, once the release is made.
  if (before && input.sequence !== undefined && input.sequence <= before.sequence) return { problem: notHigher(input.sequence) };
  const packed = await packRelease({ ...input, out: join(input.work, 'publish') });
  if ('problem' in packed) return packed;
  const { release, notes, failedNow } = packed;
  const nothing = 'Nothing was published.';
  if (failedNow.length) return { problem: `${nothing} The files of ${failedNow.length === 1 ? 'one plugin' : `${failedNow.length} plugins`} couldn’t be fetched this time, and a release doesn’t go out without ${failedNow.length === 1 ? 'it' : 'them'}:\n${release.unpackaged.filter(item => failedNow.includes(item.name)).map(item => `  - ${item.name}: ${item.reason}`).join('\n')}\nTry again, or take ${failedNow.length === 1 ? 'that entry' : 'those entries'} out of the marketplace.` };
  if (before && before.marketplace !== release.marketplace) return { problem: `${nothing} ${input.out} holds releases of the marketplace “${before.marketplace}”, and this one is “${release.marketplace}”.` };
  if (before && release.sequence <= before.sequence) return { problem: notHigher(release.sequence) };
  await mkdir(input.out, { recursive: true });
  await copyFile(join(input.work, 'publish', release.archive), join(input.out, release.archive));
  // The manifest goes last and all at once: it is what says there is a release.
  await writeFile(join(input.out, `${RELEASE_FILE}.new`), `${JSON.stringify(release, null, 2)}\n`);
  await rename(join(input.out, `${RELEASE_FILE}.new`), join(input.out, RELEASE_FILE));
  const lines = [
    `Published ${release.marketplace}: ${releaseLabel(release)}, sequence ${release.sequence}${before ? ` (the one before: ${before.sequence})` : ''}`,
    `Archive: ${release.archive}, ${release.size} bytes, SHA-256 ${release.sha256}`,
    `Plugins packed (${release.plugins.length}): ${release.plugins.map(plugin => `${plugin.name}${plugin.version ? ` ${plugin.version}` : ''}`).join(', ') || 'none'}`,
    ...(release.unpackaged.length ? [`NOT PACKED (${release.unpackaged.length}): the release has no files for these. Installed copies keep the ones they have.`, ...release.unpackaged.map(item => `  - ${item.name}: ${item.reason}`)] : []),
    ...(before ? before.plugins.filter(plugin => !release.plugins.some(now => now.name === plugin.name) && !release.unpackaged.some(now => now.name === plugin.name)).map(plugin => `No longer listed: ${plugin.name}. It stays, as it is, where a tool has it installed, and is offered to nobody else.`) : []),
    ...(release.minApp ? [`Needs the app at ${release.minApp} or newer: an older app keeps the plugins it has until it is updated.`] : []),
    ...notes.map(note => `Note: ${note}`),
    '',
    `In ${input.out}: ${release.archive} and ${RELEASE_FILE}. Serve that folder at the address the build was given (--feed). When copying it somewhere, copy the archive before ${RELEASE_FILE}. Earlier archives there are no longer needed.`,
  ];
  return { release, report: `${lines.join('\n')}\n` };
}
